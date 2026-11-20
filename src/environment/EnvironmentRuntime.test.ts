import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@dimforge/rapier3d', async () => import('../../node_modules/@dimforge/rapier3d/rapier.js'));
vi.mock('../render/WorldProps', () => ({
  createPropInstance: async () => new THREE.Group(), disposePropInstance: (o: THREE.Object3D) => o.removeFromParent(),
}));
import { PhysicsWorld } from '../physics/PhysicsWorld';
import type { WorldView } from '../render/WorldBuilder';
import { EnvironmentLighting } from '../render/EnvironmentLighting';
import { NorthernLighting } from '../render/NorthernLighting';
import { EnvironmentRuntime } from './EnvironmentRuntime';
import { EnvironmentStateStore } from './EnvironmentBehavior';
import { environmentFixture } from '../../tests/support/environment-fixture';
import type { EnvironmentEventKind } from '../world/EnvironmentEvents';

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(f => f()); });
const mounted = async (kind: EnvironmentEventKind) => {
  const plan = environmentFixture(kind), physics = await PhysicsWorld.create(plan), scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, 1.3, .04, 180), player = new THREE.Vector3(0, .865, 8), offset = new THREE.Vector3(224, -10.8, -336);
  physics.addChunk('target', plan.colliders, offset);
  player.add(offset); camera.position.copy(player).add(new THREE.Vector3(0, .8, 0)); camera.lookAt(offset); camera.updateMatrixWorld(true);
  const values = new Map<string, string>(), states = new EnvironmentStateStore('runtime', { getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); } });
  const runtime = new EnvironmentRuntime({ scene, camera, physics, output: () => null, playerPosition: () => player, canDiscover: () => true,
    prepareChase() {}, startChase: () => false, caption() {} }, states);
  const view = { environmentLighting: new EnvironmentLighting(plan), northernLighting: new NorthernLighting(plan), decorLightingContext: null } as WorldView;
  const chunk = { key: '2:-3:-2', plan, offset, view }; runtime.mount(chunk); await runtime.ready();
  cleanup.push(() => physics.dispose(), () => runtime.dispose());
  return { runtime, physics, scene, plan, camera, player, offset, states, chunk };
};
describe('mounted environmental encounters with Rapier', () => {
  it('keeps one alarm loop across approaches, fades continuously and silences it on the floor below',async()=>{
    const h=await mounted('fire-alarm');
    const setGain=vi.fn(),muffle=vi.fn(),stop=vi.fn();
    const voice={setGain,muffle,stop,source:{addEventListener:vi.fn()}};
    const play=vi.spyOn(h.runtime.audio,'play').mockReturnValue(voice as never);
    const m=h.plan.environmentEvents![0]!.mount!,emitter=new THREE.Vector3().copy(m.position).add(h.offset);
    const levels:number[]=[];
    for(const d of [49,48,47,46,40,30,20,10,2]) {
      h.camera.position.copy(emitter).add(new THREE.Vector3(0,0,d));
      h.player.copy(h.camera.position).setY(h.offset.y+.865);h.runtime.update(.1);
      levels.push(setGain.mock.lastCall![0]);
    }
    expect(play).toHaveBeenCalledOnce();expect(play.mock.calls[0]![2]).toBe(0);
    expect(levels[0]).toBe(0);expect(levels[1]).toBe(0);
    // The 3D panner applies another ~90% attenuation at this distance.
    expect(levels[2]!).toBeLessThan(.006);expect(levels.at(-1)!).toBeGreaterThan(levels[2]!);
    h.player.y-=5.4;h.camera.position.y-=5.4;h.runtime.update(.1);
    expect(setGain.mock.lastCall![0]).toBe(0);expect(play).toHaveBeenCalledOnce();
    h.player.y+=5.4;h.camera.position.y+=5.4;h.runtime.update(.1);
    expect(setGain.mock.lastCall![0]).toBeGreaterThan(0);expect(play).toHaveBeenCalledOnce();
    h.runtime.unmount(h.chunk.key);expect(stop).toHaveBeenCalledOnce();
  });
  it('allows the shared interaction through its own phone casing, but not through a wall', async () => {
    const h = await mounted('telephone'), m = h.plan.environmentEvents![0]!.mount!;
    const normal = new THREE.Vector3(Math.sin(m.yaw), 0, Math.cos(m.yaw));
    const target = new THREE.Vector3().copy(m.position).add(h.offset);
    h.camera.position.copy(target).addScaledVector(normal, 1.6); h.camera.position.y += .2;
    h.camera.lookAt(target); h.player.copy(h.camera.position).setY(h.offset.y + .865);
    h.runtime.update(.016);
    expect(h.runtime.getInteraction()?.label).toContain('Décrocher');
    h.camera.position.addScaledVector(normal, 2); h.camera.lookAt(target);
    expect(h.runtime.getInteraction()?.label).toContain('Décrocher'); // Third-person reach follows the body.
    expect(h.runtime.interact()).toBe(true); expect(h.runtime.blocksSaving).toBe(true);
    expect(h.runtime.getInteraction()).toBeNull();
    h.runtime.unmount(h.chunk.key); expect(h.runtime.blocksSaving).toBe(false);
    h.runtime.mount(h.chunk); expect(h.runtime.getInteraction()).toBeNull();
    expect(h.states.read(h.plan.environmentEvents![0]!.id).consumed).toBe(true);
  });
  it('switches footsteps on the actual water support and restores them at the edge or on another floor', async () => {
    const h = await mounted('flood'); h.runtime.update(.016);
    expect(h.runtime.inWater).toBe(true); expect(h.runtime.footstep(1)).toBe(true);
    h.player.x = h.offset.x + 10.2; expect(h.runtime.footstep(.72)).toBe(false);
    h.player.x = h.offset.x; h.player.y += 5.4; expect(h.runtime.inWater).toBe(false);
    h.runtime.unmount(h.chunk.key); expect(h.scene.children).toHaveLength(0);
  });
  it('keeps the chair still while seen, moves it after leaving, and retains its collider on return', async () => {
    const h = await mounted('lonely-chair'); h.runtime.update(.1);
    expect(h.states.read(h.plan.environmentEvents![0]!.id).visited).toBe(true);
    h.player.z = h.offset.z + 27; h.camera.position.copy(h.player).add(new THREE.Vector3(0, .8, 0)); h.camera.lookAt(h.offset);
    for (let i = 0; i < 25; i++) h.runtime.update(.1);
    expect(h.states.read(h.plan.environmentEvents![0]!.id).chairMoved).not.toBe(true);
    h.camera.lookAt(h.camera.position.clone().add(new THREE.Vector3(0, 0, 10)));
    for (let i = 0; i < 25; i++) h.runtime.update(.1);
    expect(h.states.read(h.plan.environmentEvents![0]!.id).chairMoved).toBe(true);
    const count = h.physics.world.colliders.len(); h.runtime.unmount(h.chunk.key); h.runtime.mount(h.chunk); await h.runtime.ready();
    expect(h.physics.world.colliders.len()).toBe(count);
  });
  it('rebinds lighting without duplicating devices, then frees resources over repeated streams', async () => {
    const h = await mounted('fire-alarm'), initial = h.physics.world.colliders.len();
    h.runtime.update(.05);
    for (let i = 0; i < 50; i++) {
      h.runtime.mount({ ...h.chunk, view: { environmentLighting: new EnvironmentLighting(h.plan), northernLighting: new NorthernLighting(h.plan), decorLightingContext: null } as WorldView });
      expect(h.physics.world.colliders.len()).toBe(initial);
      h.runtime.unmount(h.chunk.key); expect(h.scene.children).toHaveLength(0);
      h.runtime.mount(h.chunk);
    }
    expect(h.physics.world.colliders.len()).toBe(initial);
    h.runtime.unmount(h.chunk.key); expect(h.physics.hasChunk(`environment-collider:${h.plan.environmentEvents![0]!.id}`)).toBe(false);
  });
});
