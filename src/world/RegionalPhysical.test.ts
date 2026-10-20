import { expect, it, vi } from 'vitest';
vi.mock('@dimforge/rapier3d', async () => import('../../node_modules/@dimforge/rapier3d/rapier.js'));
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { MOVEMENT_TUNING } from '../player/MovementConfig';
import { generateInfiniteChunk, getChunkWorldOffset } from './InfiniteWorld';
import { atriumCirculation } from './SpatialConnectors';
import { regionalAtrium, spatialCellAt } from './RegionalPlan';
import { rectCenter } from './types';
import type { WorldPlan, Vec3Data } from './types';
import { createSpatialPrismGeometry } from '../render/SpatialGeometry';
import { surfaceY } from './WalkableTopology';

const dt = 1 / 60, tuning = MOVEMENT_TUNING.locomotion;
const sample = (kind: string) => {
  for (let i = 0; i < 64; i++) {
    const seed = `REGIONAL-AUDIT-${i}`, world = generateInfiniteChunk(seed, { x: 0, z: 0, story: 0 });
    const landmark = world.spatial!.landmarks.find(l => l.kind === kind);
    if (landmark) return { world, landmark };
  }
  throw new Error(`Missing procedural example: ${kind}`);
};
const mount = async (world: WorldPlan) => {
  const physics = await PhysicsWorld.create({ ...world, colliders: [] });
  const worlds = new Map([[`${world.spatial!.owner.story}`, world]]);
  for (const d of world.spatial!.dependencies) if (!worlds.has(`${d.owner.story}`)) worlds.set(`${d.owner.story}`, generateInfiniteChunk(world.seed, d.owner));
  for (const [key, w] of worlds) physics.addChunk(key, w.colliders, getChunkWorldOffset(w.spatial!.owner));
  return physics;
};
const walkTo = (physics: PhysicsWorld, start: Vec3Data, target: { x: number; z: number }, speed = tuning.walkSpeed): Vec3Data => {
  let p = { ...start };
  for (let i = 0; i < 1500; i++) {
    const x = target.x - p.x, z = target.z - p.z, distance = Math.hypot(x, z);
    if (distance < .06) return p;
    const step = Math.min(speed * dt, distance);
    p = { ...physics.move({ x: x / distance * step, y: -.035, z: z / distance * step }).position };
  }
  throw new Error(`Traversal blocked at ${JSON.stringify(p)} toward ${JSON.stringify(target)}`);
};

it.each(['l', 'u', 'bridge'])('walks the entire generated %s atrium stair down and back through three mounted addresses', async variant => {
  const { world, landmark } = sample(`escalier-${variant}`), physics = await mount(world);
  const cell = world.spatial!.cells.find(c => c.mode === 'gallery' && c.bounds.minX < landmark.position.x && c.bounds.maxX > landmark.position.x && c.bounds.minZ < landmark.position.z && c.bounds.maxZ > landmark.position.z)!;
  const center = rectCenter(cell.bounds), c = spatialCellAt(center.x, center.z), a = regionalAtrium(world.seed, c.x, c.z, 0)!;
  const route = atriumCirculation(cell.bounds, cell.floorY, a), first = route.legs[0]!;
  let p: Vec3Data = { x: rectCenter(first.bounds).x, y: cell.floorY + .865, z: first.bounds.minZ - .6 };
  physics.teleport(p);
  try {
    for (let i = 0; i < 20; i++) p = { ...physics.move({ x: 0, y: -.035, z: 0 }).position };
    const waypoints = route.landing ? [{ x: rectCenter(first.bounds).x, z: rectCenter(route.landing.bounds).z },
      { x: route.exit.x, z: route.landing.bounds.minZ + 1.6 }, route.exit] : [route.exit];
    for (const point of waypoints) p = walkTo(physics, p, point);
    expect(p.y).toBeCloseTo(cell.floorY - 10.8 + .865, 1);
    for (const point of [...waypoints.slice(0, -1)].reverse()) p = walkTo(physics, p, point);
    p = walkTo(physics, p, { x: rectCenter(first.bounds).x, z: first.bounds.minZ - .6 });
    expect(p.y).toBeCloseTo(cell.floorY + .865, 1);
  } finally { physics.dispose(); }
});

it('walks out of an actual high wall opening, lands in the real lower maze and cannot jump back up', async () => {
  const { world } = sample('ouverture-haute'), physics = await mount(world);
  const drop = world.topology!.connections.find(c => c.kind === 'drop' && c.id.endsWith('west'))!;
  const source = world.topology!.surfaces.find(s => s.id === drop.from)!, p0 = rectCenter(source.bounds), h = surfaceY(source, p0.x, p0.z);
  let p = { ...p0, y: h + .865 }, vy = -.9;
  physics.teleport(p);
  try {
    for (let i = 0; i < 180; i++) {
      vy = Math.max(-tuning.terminalFallSpeed, vy - tuning.gravity * dt);
      const result = physics.move({ x: p.x < drop.arrival!.x + 1 ? tuning.walkSpeed * dt : 0, y: vy * dt, z: 0 });
      p = { ...result.position }; if (result.grounded) vy = -.9;
    }
    expect(p.y).toBeCloseTo(h - 5.4 + .865, 1);
    vy = tuning.standingJumpSpeed; let maximum = p.y;
    for (let i = 0; i < 60; i++) {
      vy -= tuning.gravity * dt; p = { ...physics.move({ x: -tuning.walkSpeed * dt, y: vy * dt, z: 0 }).position }; maximum = Math.max(maximum, p.y);
    }
    expect(maximum).toBeLessThan(h - 2);
    expect(drop.direction).toBe('forward');
  } finally { physics.dispose(); }
});

it('requires and permits a real running jump over a generated bridge gap in both directions', async () => {
  const { world } = sample('saut-passerelle'), physics = await mount(world), link = world.topology!.connections.find(c => c.kind === 'jump')!;
  const surface = world.topology!.surfaces.find(s => s.id === link.from)!, h = surfaceY(surface, link.at.x, link.at.z);
  try {
    for (const direction of [1, -1]) {
      const start = direction === 1 ? { ...link.at, y: h + .865 } : { ...link.arrival!, y: h + .865 };
      let p = { ...start }, vy = tuning.standingJumpSpeed;
      physics.teleport(p);
      for (let i = 0; i < 50; i++) {
        vy -= tuning.gravity * dt;
        p = { ...physics.move({ x: direction * tuning.sprintSpeed * dt, y: vy * dt, z: 0 }).position };
      }
      expect(p.y).toBeCloseTo(h + .865, 1);
      expect(direction * (p.x - start.x)).toBeGreaterThan(2.2);
    }
    physics.teleport({ ...link.at, y: h + .865 }); let vy = -.9, p = { ...link.at, y: h + .865 };
    for (let i = 0; i < 35; i++) {
      vy -= tuning.gravity * dt; p = { ...physics.move({ x: tuning.walkSpeed * dt, y: vy * dt, z: 0 }).position };
    }
    expect(p.y).toBeLessThan(h + .4);
  } finally { physics.dispose(); }
});

it('uses the same wall faces in Three and Rapier, including sheared floor-to-stair joints', async () => {
  const world = generateInfiniteChunk('REGIONAL-AUDIT-3', { x: 0, z: 0, story: 0 }), physics = await PhysicsWorld.create(world);
  try {
    const walls = world.spatial!.prisms.filter(p => p.id.includes('/side-')).slice(0, 24); expect(walls.length).toBeGreaterThan(0);
    for (const p of walls) {
      const geometry = createSpatialPrismGeometry(p), mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); mesh.updateMatrixWorld();
      const pos = geometry.getAttribute('position');
      for (let i = 12; i < pos.count; i += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(pos, i), b = new THREE.Vector3().fromBufferAttribute(pos, i + 1), c = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
        const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize(), center = a.clone().add(b).add(c).multiplyScalar(1 / 3);
        if (n.y > .8 || n.y < -.8) continue;
        const origin = center.clone().addScaledVector(n, .2), direction = n.clone().negate();
        const hit = new THREE.Raycaster(origin, direction, 0, 1).intersectObject(mesh)[0];
        expect(hit?.distance).toBeCloseTo(.2, 3);
        const physical = physics.world.castRay(new RAPIER.Ray(origin, direction), 1, true, undefined, undefined, undefined, undefined, physics.isEnvironmentCollider);
        expect(physical?.timeOfImpact, p.id).toBeCloseTo(.2, 3);
      }
      geometry.dispose(); (mesh.material as THREE.Material).dispose();
    }
  } finally { physics.dispose(); }
});
