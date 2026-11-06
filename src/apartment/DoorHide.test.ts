import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import * as THREE from 'three';
vi.mock('@dimforge/rapier3d', async () => { const m = await import('@dimforge/rapier3d-compat'); await m.default.init(); return { ...m, default: m.default }; });
import RAPIER from '@dimforge/rapier3d';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { createStairwellPlan } from '../stairwell/createStairwellPlan';
import { loadApartmentModel } from '../../tests/support/load-apartment-model';
import { ImportedApartmentEnvironment } from './ImportedApartmentEnvironment';
import { DoorHide } from './DoorHide';
import { defaultControlBindings } from '../input/ControlBindings';
const cleanup: (() => void)[] = [];
const domModule: string = 'happy-dom'; let dom: { close(): void; document: unknown; KeyboardEvent: unknown } | undefined;
beforeAll(async () => { const { Window } = await import(/* @vite-ignore */ domModule); dom = new Window(); vi.stubGlobal('window', dom); vi.stubGlobal('document', dom!.document); vi.stubGlobal('KeyboardEvent', dom!.KeyboardEvent); });
afterEach(() => cleanup.splice(0).reverse().forEach(fn => fn())); afterAll(() => { dom?.close(); vi.unstubAllGlobals(); });

const SPOTS = {
  closet: { inside: [-2.63, -.12], outside: [-2.66, -1.42] },
  bathroom: { inside: [-3.9, -4.6], outside: [-4.05, -3.5] },
} as const;

async function fixture(spot: keyof typeof SPOTS) {
  const environment = new (ImportedApartmentEnvironment as unknown as { new(m: THREE.Object3D): ImportedApartmentEnvironment })(await loadApartmentModel());
  const physics = await PhysicsWorld.create(createStairwellPlan()); cleanup.push(() => physics.dispose(), () => environment.dispose());
  physics.addTrimeshChunk('actual-apartment', environment.shellColliderMeshes);
  physics.addChunk('furniture', environment.furnitureColliders, { x: 0, y: 0, z: 0 });
  const floor = environment.floorY + .031, layout = SPOTS[spot], door = spot === 'closet' ? environment.closetDoor : environment.bathroomDoor;
  const outside = new THREE.Vector3(layout.outside[0], floor + .865, layout.outside[1]);
  const position = outside.clone(), overlaps: string[] = []; let active = false;
  const camera = new THREE.PerspectiveCamera(); camera.position.copy(position).add(new THREE.Vector3(0, .7, 0));
  camera.lookAt(environment.hideDoors[spot].box.getCenter(new THREE.Vector3()));
  const ui = { setInteraction: vi.fn() };
  const hide = new DoorHide({ key: environment.hideDoors[spot].key, label: 'Se cacher', pivot: door.pivot, leafBox: environment.hideDoors[spot].box, openAngle: door.openAngle,
    inside: new THREE.Vector3(layout.inside[0], floor + .67, layout.inside[1]), outside,
    eye: new THREE.Vector3(layout.inside[0], environment.floorY + 1.31, layout.inside[1]) }, physics, camera, ui, {
    position: () => position,
    pose: (p, narrow) => {
      position.copy(p); physics.setScriptedPlayerPose(p, narrow);
      const hit = physics.world.intersectionWithShape(p, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Capsule(narrow ? .42 : .52, narrow ? .23 : .32), undefined, undefined, undefined, undefined, physics.isEnvironmentCollider);
      if (hit) overlaps.push(`${p.toArray().map(v => v.toFixed(2))}`);
    },
    presentation: () => {}, active: a => { active = a; }, playing: () => true, bindings: () => defaultControlBindings(),
  });
  cleanup.push(() => hide.dispose());
  const run = (frames: number) => { for (let i = 0; i < frames; i++) { hide.update(1 / 60, true); physics.stepDynamics(1 / 60); } };
  return { hide, run, position, overlaps, ui, isActive: () => active, layout, door };
}

it.each(['closet', 'bathroom'] as const)('hides behind the real %s door, shuts it and comes out with the hold', async spot => {
  const f = await fixture(spot);
  expect(f.hide.isTargeted).toBe(true);
  expect(f.hide.interact()).toBe(true); expect(f.isActive()).toBe(true);
  f.run(150);
  expect(f.hide.debugState.phase).toBe('hidden'); expect(f.hide.doorProgress).toBe(0);
  expect(Math.hypot(f.position.x - f.layout.inside[0], f.position.z - f.layout.inside[1])).toBeLessThan(.01);
  // Half a hold: the leaf is open, the player not yet out.
  f.hide.holdExit(.35); f.run(2); expect(f.hide.doorProgress).toBeGreaterThan(.8);
  expect(Math.hypot(f.position.x - f.layout.inside[0], f.position.z - f.layout.inside[1])).toBeLessThan(.01);
  f.hide.holdExit(.7); f.run(1);
  const mid = Math.hypot(f.position.x - f.layout.inside[0], f.position.z - f.layout.inside[1]);
  expect(mid).toBeGreaterThan(.2);
  f.hide.holdExit(1); f.run(120);
  expect(f.hide.isActive).toBe(false); expect(f.isActive()).toBe(false);
  expect(Math.hypot(f.position.x - f.layout.outside[0], f.position.z - f.layout.outside[1])).toBeLessThan(.01);
  expect(f.overlaps).toEqual([]);
});

it.each(['closet', 'bathroom'] as const)('bursts out of the %s at once when the hold is released', async spot => {
  const f = await fixture(spot);
  f.hide.interact(); f.run(150); f.hide.exitLocked = true;
  f.hide.interact(); f.run(10); expect(f.hide.debugState.phase).toBe('hidden');
  f.hide.holdExit(.2); f.run(1); f.hide.burstOut(); f.run(30);
  expect(f.hide.isActive).toBe(false);
  expect(Math.hypot(f.position.x - f.layout.outside[0], f.position.z - f.layout.outside[1])).toBeLessThan(.01);
  expect(f.overlaps).toEqual([]);
});
