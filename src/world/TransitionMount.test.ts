import { expect, it, vi } from 'vitest';
vi.mock('@dimforge/rapier3d', async () => import('../../node_modules/@dimforge/rapier3d/rapier.js'));
import { generateInfiniteChunk, getChunkWorldOffset } from './InfiniteWorld';
import { PhysicsWorld } from '../physics/PhysicsWorld';

// This real four-layer load sequence reproduced a Rapier BVH panic on its
// second/third cycle. Keep varied rooms and both signs of vertical ownership.
it.each([2, 7, 12, 17, 23, 43, 69, 101])('releases and remounts complete owner layers repeatedly on seed %i', async i => {
  const world = generateInfiniteChunk(`REGIONAL-AUDIT-${i}`, { x: 0, z: 0, story: 0 });
  const physics = await PhysicsWorld.create({ ...world, colliders: [] });
  const owners = [0, -1, 1, -2, 2];
  const plans = new Map(owners.map(story => [story, generateInfiniteChunk(world.seed, { x: 0, z: 0, story })]));
  const before = physics.world.colliders.len();
  try {
    for (let cycle = 0; cycle < 5; cycle++) {
      physics.addChunk('0:0:0', world.colliders, { x: 0, y: 0, z: 0 });
      physics.batchChunkChanges(() => {
        for (const story of owners.slice(1)) physics.addChunk(`0:0:${story}`, plans.get(story)!.colliders, getChunkWorldOffset({ x: 0, z: 0, story }));
      });
      expect(physics.canStandAt(world.spawn)).toBe(true);
      physics.batchChunkChanges(() => { for (const story of owners) physics.removeChunk(`0:0:${story}`); });
      expect(physics.world.colliders.len()).toBe(before);
    }
  } finally { physics.dispose(); }
}, 30000);

it('keeps a mounted support stable while neighbouring layers unload and reload', async () => {
  const w = generateInfiniteChunk('REGIONAL-AUDIT-7', { x: 0, z: 0, story: 0 });
  const physics = await PhysicsWorld.create({ ...w, colliders: [] });
  physics.addChunk('source', w.colliders, { x: 0, y: 0, z: 0 });
  try {
    for (let cycle = 0; cycle < 8; cycle++) {
      physics.batchChunkChanges(() => { for (const story of [-1, 1, 2]) physics.addChunk(String(story),
        generateInfiniteChunk(w.seed, { x: 0, z: 0, story }).colliders, getChunkWorldOffset({ x: 0, z: 0, story })); });
      expect(physics.canStandAt(w.spawn)).toBe(true);
      physics.batchChunkChanges(() => { for (const story of [-1, 1, 2]) physics.removeChunk(String(story)); });
      expect(physics.canStandAt(w.spawn)).toBe(true);
    }
  } finally { physics.dispose(); }
}, 30000);

it('walks through the side entrance of a flat approach out of the corner between two chambers', async () => {
  const w = generateInfiniteChunk('BSP-CONNECTIVITY-6', { x: 0, z: 0, story: 0 });
  const route = w.spatial!.transitions!.find(t => t.id.includes('/cell/3/1/0/east/route'))!;
  const b = route.approach.bounds, x = (b.minX + b.maxX) / 2;
  const physics = await PhysicsWorld.create({ ...w, spawn: { x, y: route.approach.y + .9, z: b.minZ - route.wallThickness - .5 } });
  try {
    for (let tick = 0; tick < 20; tick++) physics.move({ x: 0, y: -.035, z: 0 });
    let p = physics.getPosition();
    for (let tick = 0; tick < 100 && p.z < b.minZ + .8; tick++) p = physics.move({ x: 0, y: -.035, z: .05 }).position;
    expect(p.z).toBeGreaterThan(b.minZ + .7);
    expect(p.y).toBeCloseTo(route.approach.y + .865, 1);
  } finally { physics.dispose(); }
});
