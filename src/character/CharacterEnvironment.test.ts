import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
vi.mock('@dimforge/rapier3d', async () => { const rapier = await import('@dimforge/rapier3d-compat'); await rapier.init(); return rapier; });
import { PhysicsWorld } from '../physics/PhysicsWorld';
import type { WorldPlan } from '../world/types';
import { CharacterEnvironment } from './CharacterEnvironment';
const worlds: PhysicsWorld[] = [];
afterEach(() => worlds.splice(0).forEach(world => world.dispose()));
const create = async () => {
  const plan: WorldPlan = {version:1,seed:'CHARACTER-WORLD',size:20,wallHeight:3,rooms:[],walls:[],columns:[],solidMasses:[],lights:[],missingCeilingTiles:[],features:[],detailSockets:[],floorRects:[],
    spawn:{x:0,y:-9.135,z:0},colliders:[{id:'floor',kind:'floor',center:{x:0,y:-10.1,z:0},halfExtents:{x:8,y:.1,z:8}}]};
  const physics = await PhysicsWorld.create(plan); worlds.push(physics);
  return {physics,environment:new CharacterEnvironment(physics)};
};
describe('character queries in the host collision world', () => {
  it('respects the actual spawn height and ignores character capsules', async () => {
    const {physics,environment} = await create();
    expect(physics.getPosition().y).toBeCloseTo(-9.135);
    physics.setMeleeOpponentBlocker({x:0,y:-9.16,z:-1});
    const hits=environment.raycast(new THREE.Raycaster(new THREE.Vector3(0,-8,0),new THREE.Vector3(0,-1,0),0,4));
    expect(hits).toHaveLength(1);expect(hits[0]!.point.y).toBeCloseTo(-10);
    expect(environment.nearbyBoxes(physics.getPosition())).toHaveLength(1);
  });
  it('uses imported trimeshes and drops removed chunk colliders', async () => {
    const {physics,environment}=await create();
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(2,2,.1));mesh.position.set(0,-9,-2);
    physics.addTrimeshChunk('imported-wall',[mesh]);
    const ray=new THREE.Raycaster(new THREE.Vector3(0,-9,0),new THREE.Vector3(0,0,-1),.02,4);
    expect(environment.raycast(ray)[0]!.distance).toBeCloseTo(1.95);
    physics.removeChunk('imported-wall');expect(environment.raycast(ray)).toHaveLength(0);
    mesh.geometry.dispose();
  });
  it('places the survivor on a clear real floor and refuses an empty void', async () => {
    const {physics,environment}=await create();
    const position=environment.findPartnerSpawn(physics.getPosition(),new THREE.Vector3(0,0,-1));
    expect(position?.y).toBeCloseTo(-10);expect(position!.distanceTo(physics.getPosition())).toBeGreaterThan(2);
    physics.removeChunk('origin');expect(environment.findPartnerSpawn(physics.getPosition(),new THREE.Vector3(0,0,-1))).toBeNull();
  });
  it('sweeps hand-sized volumes against thin imported walls, with world-space normals and no actor self-hit', async () => {
    const { physics, environment } = await create();
    const out = { center: new THREE.Vector3(), normal: new THREE.Vector3() };
    const from = new THREE.Vector3(0, -8.8, 0), to = new THREE.Vector3(0, -8.8, -3);
    physics.setMeleeOpponentBlocker({ x: 0, y: -9.16, z: -1 });
    expect(environment.sweepSphere(from, to, .09, out)).toBe(false);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(3, 3, .015));
    wall.position.set(0, -9, -1); wall.rotation.y = Math.PI / 5;
    physics.addTrimeshChunk('thin-wall', [wall]);
    expect(environment.sweepSphere(from, to, .09, out)).toBe(true);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(wall.quaternion);
    expect(out.normal.dot(normal)).toBeGreaterThan(.999);
    expect(out.center.clone().sub(wall.position).dot(normal)).toBeCloseTo(.0975, 3);
    physics.removeChunk('thin-wall');
    expect(environment.sweepSphere(from, to, .09, out)).toBe(false);
    wall.geometry.dispose(); (wall.material as THREE.Material).dispose();
  });
});
