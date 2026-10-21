import { expect, it, vi } from 'vitest';
vi.mock('@dimforge/rapier3d', async () => import('../../node_modules/@dimforge/rapier3d/rapier.js'));
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { MOVEMENT_TUNING } from '../player/MovementConfig';
import { generateInfiniteChunk, getChunkWorldOffset } from './InfiniteWorld';
import { atriumCirculation } from './SpatialConnectors';
import { regionalAtrium, regionalDatum, spatialCellAt } from './RegionalPlan';
import { rectCenter } from './types';
import type { WorldPlan, Vec3Data } from './types';
import { createSpatialPrismGeometry } from '../render/SpatialGeometry';
import { createWalkableGeometry } from '../render/WalkableGeometry';
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
const walkTo = (physics: PhysicsWorld, start: Vec3Data, target: { x: number; z: number }, speed: number = tuning.walkSpeed): Vec3Data => {
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

it('walks below an unconnected upper bridge and exposes its real underside without a middle floor', async () => {
  const { world } = sample('galerie-bridge'), bridge = world.topology!.surfaces.find(s => s.role === 'bridge' && s.id.endsWith('/bridge'))!;
  const p = rectCenter(bridge.bounds), h = surfaceY(bridge, p.x, p.z), physics = await mount(world);
  const material = new THREE.MeshBasicMaterial(), geometry = createWalkableGeometry(bridge, 'underside');
  const mesh = new THREE.Mesh(geometry, material); mesh.updateMatrixWorld();
  try {
    let at = { x: p.x, y: h - 10.8 + .865, z: p.z - 5 }; physics.teleport(at);
    at = walkTo(physics, at, { x: p.x, z: p.z + 5 });
    expect(at.y).toBeCloseTo(h - 10.8 + .865, 1);
    const origin = new THREE.Vector3(p.x, h - 2, p.z), up = new THREE.Vector3(0, 1, 0);
    const rendered = new THREE.Raycaster(origin, up, 0, 3).intersectObject(mesh)[0];
    const physical = physics.world.castRay(new RAPIER.Ray(origin, up), 3, true, undefined, undefined, undefined, undefined, physics.isEnvironmentCollider);
    expect(rendered?.point.y).toBeCloseTo(h - .16, 4);
    expect(physical?.timeOfImpact).toBeCloseTo(1.84, 4);
    const down = physics.world.castRay(new RAPIER.Ray(origin, { x: 0, y: -1, z: 0 }), 12, true, undefined, undefined, undefined, undefined, physics.isEnvironmentCollider);
    expect(down?.timeOfImpact).toBeCloseTo(8.8, 4);
  } finally { geometry.dispose(); material.dispose(); physics.dispose(); }
});

it('walks and runs a real nonzero regional ramp, stops on it and reverses without changing the controller', async () => {
  const { world } = sample('rampe-regionale'), ramp = world.topology!.surfaces.find(s => s.profile.kind === 'linear' && s.profile.startY !== 0 && s.profile.endY !== 0)!;
  expect(ramp).toBeDefined();
  const p = ramp.profile; if (p.kind !== 'linear') throw new Error('Expected a sloping generated surface');
  const physics = await mount(world), center = rectCenter(ramp.bounds), axis = p.axis;
  const a = { ...center, [axis]: (axis === 'x' ? ramp.bounds.minX : ramp.bounds.minZ) - .5, y: p.startY + .865 };
  const b = { ...center, [axis]: (axis === 'x' ? ramp.bounds.maxX : ramp.bounds.maxZ) + .5 };
  try {
    physics.teleport(a); let at = { ...a };
    for (let i = 0; i < 20; i++) at = { ...physics.move({ x: 0, y: -.035, z: 0 }).position };
    at = walkTo(physics, at, center);
    const stoppedY = at.y;
    for (let i = 0; i < 60; i++) at = { ...physics.move({ x: 0, y: -.035, z: 0 }).position };
    expect(at.y).toBeCloseTo(stoppedY, 1);
    at = walkTo(physics, at, a); expect(at.y).toBeCloseTo(a.y, 1);
    at = walkTo(physics, at, b, tuning.sprintSpeed); expect(at.y).toBeCloseTo(p.endY + .865, 1);
    at = walkTo(physics, at, a, tuning.sprintSpeed); expect(at.y).toBeCloseTo(a.y, 1);
  } finally { physics.dispose(); }
});

it('physically completes a multi-chunk loop through several regional datums in both directions', async () => {
  let sample: { seed: string; cells: { x: number; z: number }[] } | undefined;
  for (let i = 0; i < 8 && !sample; i++) for (let z = -6; z <= 0 && !sample; z++) for (let x = -6; x <= 0 && !sample; x++) {
    const seed = `REGIONAL-AUDIT-${i}`, cells = [];
    for (let dx = 0; dx <= 4; dx++) cells.push({ x: x + dx, z });
    for (let dz = 1; dz <= 3; dz++) cells.push({ x: x + 4, z: z + dz });
    for (let dx = 3; dx >= 0; dx--) cells.push({ x: x + dx, z: z + 3 });
    for (let dz = 2; dz > 0; dz--) cells.push({ x, z: z + dz });
    const datums = cells.map(c => regionalDatum(seed, c.x, c.z));
    if (new Set(datums.map(d => d.id)).size < 3 || Math.max(...datums.map(d => d.y)) - Math.min(...datums.map(d => d.y)) < 8 ||
      cells.some(c => regionalAtrium(seed, c.x, c.z, 0)) || datums.some(d => d.id === 'monument-interface')) continue;
    sample = { seed, cells };
  }
  expect(sample).toBeDefined();
  const { seed, cells } = sample!, coords = [...new Map(cells.map(c => {
    const owner = { x: Math.floor(c.x / 4), z: Math.floor(c.z / 4), story: 0 }; return [`${owner.x}:${owner.z}`, owner] as const;
  })).values()];
  const worlds = coords.map(c => generateInfiniteChunk(seed, c)), physics = await PhysicsWorld.create({ ...worlds[0]!, colliders: [] });
  for (let i = 0; i < coords.length; i++) physics.addChunk(String(i), worlds[i]!.colliders, getChunkWorldOffset(coords[i]!));
  const nodes = new Map(worlds.flatMap((w, i) => w.topology!.surfaces.map(s => [s.id, { s, offset: getChunkWorldOffset(coords[i]!) }] as const)));
  const graph = new Map<string, { to: string; at: Vec3Data }[]>();
  const link = (from: string, to: string, at: Vec3Data) => graph.set(from, [...(graph.get(from) ?? []), { to, at }]);
  const ports = new Map<string, { surfaceId: string; at: Vec3Data }[]>();
  for (let i = 0; i < worlds.length; i++) {
    const w = worlds[i]!, o = getChunkWorldOffset(coords[i]!);
    for (const c of w.topology!.connections) {
      if (!nodes.has(c.from) || !nodes.has(c.to) || c.kind === 'view' || c.kind === 'drop' || c.kind === 'jump' || c.requiresDoorId) continue;
      const n = nodes.get(c.from)!, at = { x: c.at.x + o.x, z: c.at.z + o.z, y: surfaceY(n.s, c.at.x, c.at.z) + o.y + .865 };
      link(c.from, c.to, at); if (c.direction === 'both') link(c.to, c.from, at);
    }
    for (const p of w.spatial!.interfaces) ports.set(p.id, [...(ports.get(p.id) ?? []), { surfaceId: p.surfaceId, at: { x: p.position.x + o.x, z: p.position.z + o.z, y: p.position.y + o.y + .865 } }]);
  }
  for (const values of ports.values()) for (const a of values) for (const b of values) if (a !== b) link(a.surfaceId, b.surfaceId, a.at);
  const points = cells.map(c => {
    const desired = { x: c.x * 28 - 42, z: c.z * 28 - 42 }, y = regionalDatum(seed, c.x, c.z).y;
    const candidates = [...nodes].flatMap(([id, n]) => {
      const p = rectCenter(n.s.bounds), at = { x: p.x + n.offset.x, z: p.z + n.offset.z, y: surfaceY(n.s, p.x, p.z) + n.offset.y + .865 };
      return n.s.role === 'floor' && Math.abs(at.y - y - .865) < .05 && physics.canStandAt(at) ? [{ id, at, distance: Math.hypot(at.x - desired.x, at.z - desired.z) }] : [];
    }).sort((a, b) => a.distance - b.distance);
    expect(candidates[0]).toBeDefined(); return candidates[0]!;
  });
  console.info('REGIONAL_BSP_ROUTE', JSON.stringify({ seed, coords, points: points.map(p => p.at), nominalLength: cells.length * 28 }));
  try {
    let current = points[0]!, at = current.at, travelled = 0; physics.teleport(at);
    for (const route of [[...points.slice(1), points[0]!], [...points.slice(1).reverse(), points[0]!]]) for (const target of route) {
      const queue = [current.id], previous = new Map<string, { from: string; at: Vec3Data }>(); previous.set(current.id, { from: '', at });
      for (let i = 0; i < queue.length && !previous.has(target.id); i++) for (const edge of graph.get(queue[i]!) ?? []) if (!previous.has(edge.to)) { previous.set(edge.to, { from: queue[i]!, at: edge.at }); queue.push(edge.to); }
      expect(previous.has(target.id), `no ordinary BSP path ${current.id} -> ${target.id}`).toBe(true);
      const crossings: Vec3Data[] = []; let cursor = target.id;
      while (cursor !== current.id) { const step = previous.get(cursor)!; crossings.unshift(step.at); cursor = step.from; }
      for (const goal of [...crossings, target.at]) { travelled += Math.hypot(goal.x - at.x, goal.z - at.z); at = walkTo(physics, at, goal, tuning.sprintSpeed); }
      expect(at.y).toBeCloseTo(target.at.y, 1); current = target;
    }
    expect(travelled).toBeGreaterThan(700);
    console.info('REGIONAL_BSP_TRAVERSED_METRES', travelled);
  } finally { physics.dispose(); }
});
