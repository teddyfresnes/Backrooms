import { expect, it, vi } from 'vitest';
vi.mock('@dimforge/rapier3d', async () => import('../../node_modules/@dimforge/rapier3d/rapier.js'));
import RAPIER from '@dimforge/rapier3d';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { clearInfiniteWorldCaches, generateInfiniteChunk, getCanonicalEdgeGates, getChunkWorldOffset } from './InfiniteWorld';
import { validateTopology, findSurface, surfaceY } from './WalkableTopology';
import { rectDepth, rectWidth } from './types';

it('publishes identical nonzero interfaces on every orientation, including a negative four-chunk corner', () => {
  for (const c of [{ x: -1, z: -1, story: -1 }, { x: 0, z: 0, story: 0 }]) {
    expect(getCanonicalEdgeGates('VERTICAL-SEAMS', c, 'east')).toEqual(getCanonicalEdgeGates('VERTICAL-SEAMS', { ...c, x: c.x + 1 }, 'west'));
    expect(getCanonicalEdgeGates('VERTICAL-SEAMS', c, 'south')).toEqual(getCanonicalEdgeGates('VERTICAL-SEAMS', { ...c, z: c.z + 1 }, 'north'));
    expect(getCanonicalEdgeGates('VERTICAL-SEAMS', c, 'east').some(g => g.floorY !== 0)).toBe(true);
  }
});

it('keeps all ordinary infinite surfaces comfortable after biome, shaft and boundary passes', () => {
  for (let i = 0; i < 64; i++) {
    const w = generateInfiniteChunk(`VERTICAL-PROMPT-AUDIT-${i}`, { x: -1, z: 1, story: 0 });
    expect(validateTopology(w), w.seed).toEqual([]); expect(structuredClone(w)).toEqual(w);
    expect(w.colliders.some(c => c.id.includes('/floor-'))).toBe(false);
    expect(w.edgeGates).toBeDefined();
  }
}, 60000);

it('keeps negative corner plans independent of generation order and cache temperature', () => {
  const coords = [{ x: -1, z: -1, story: -1 }, { x: 0, z: -1, story: -1 }, { x: -1, z: 0, story: -1 }, { x: 0, z: 0, story: -1 }];
  const seed = 'VERTICAL-CORNER-ORDER'; clearInfiniteWorldCaches();
  const first = coords.map(c => JSON.stringify(generateInfiniteChunk(seed, c)));
  clearInfiniteWorldCaches(); const second = [...coords].reverse().map(c => JSON.stringify(generateInfiniteChunk(seed, c))).reverse();
  expect(second).toEqual(first); expect(coords.map(c => JSON.stringify(generateInfiniteChunk(seed, c)))).toEqual(first);
}, 30000);

it('sweeps actual infinite slope bodies across their complete useful width', async () => {
  for (const i of [2, 3, 55]) {
    const w = generateInfiniteChunk(`VERTICAL-PROMPT-AUDIT-${i}`, { x: -1, z: 1, story: 0 }), physics = await PhysicsWorld.create(w);
    try {
      for (const s of w.topology!.surfaces) {
        const p = s.profile; if (p.kind !== 'linear') continue;
        const b = s.bounds, width = p.axis === 'x' ? rectDepth(b) : rectWidth(b);
        for (const t of [.05, .25, .5, .75, .95]) for (const across of [.35 / width, .5, 1 - .35 / width]) {
          const x = b.minX + rectWidth(b) * (p.axis === 'x' ? t : across), z = b.minZ + rectDepth(b) * (p.axis === 'z' ? t : across), crouch = s.locomotion === 'crouch';
          const blocked = physics.world.intersectionWithShape({ x, y: surfaceY(s, x, z) + (crouch ? .65 : .91), z }, { x: 0, y: 0, z: 0, w: 1 },
            new RAPIER.Capsule(crouch ? .22 : .52, .32), undefined, undefined, undefined, undefined, physics.isEnvironmentCollider);
          expect(blocked, `${w.seed} ${s.id} ${x},${z}`).toBeNull();
        }
      }
    } finally { physics.dispose(); }
  }
}, 30000);

it('walks a real shared seam after eight collider unload/reload cycles without losing support', async () => {
  const seed = 'VERTICAL-STREAM-SEAM', sourceCoord = { x: -1, z: 0, story: 0 }, destinationCoord = { x: 0, z: 0, story: 0 };
  const source = generateInfiniteChunk(seed, sourceCoord), destination = generateInfiniteChunk(seed, destinationCoord);
  const gate = source.edgeGates!.east[0]!, offset = getChunkWorldOffset(sourceCoord), x = 52, z = gate.offset;
  const surface = findSurface(source, { x, z, referenceY: gate.floorY })!;
  const spawn = { x: offset.x + x, y: surfaceY(surface, x, z) + .9, z };
  const physics = await PhysicsWorld.create({ ...source, colliders: [], spawn });
  try {
    for (let cycle = 0; cycle < 8; cycle++) {
      physics.batchChunkChanges(() => { physics.addChunk('source', source.colliders, offset); physics.addChunk('destination', destination.colliders, getChunkWorldOffset(destinationCoord)); });
      physics.teleport(spawn); for (let i = 0; i < 30; i++) physics.move({ x: 0, y: -.035, z: 0 });
      let p = { ...spawn }; for (let i = 0; i < 180 && p.x < -51; i++) p = { ...physics.move({ x: .08, y: -.035, z: 0 }).position };
      expect(p.x).toBeGreaterThan(-51.1); expect(p.y).toBeGreaterThan(.8); expect(p.y).toBeLessThan(1.6);
      physics.batchChunkChanges(() => { physics.removeChunk('source'); physics.removeChunk('destination'); });
      expect(physics.world.colliders.len()).toBe(1);
    }
  } finally { physics.dispose(); }
}, 30000);
