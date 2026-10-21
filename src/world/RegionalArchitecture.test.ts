import { expect, it, vi } from 'vitest';
vi.mock('@dimforge/rapier3d', async () => import('../../node_modules/@dimforge/rapier3d/rapier.js'));
import RAPIER from '@dimforge/rapier3d';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { generateWorld } from './generateWorld';
import { generateInfiniteChunk, getCanonicalEdgeGates } from './InfiniteWorld';
import { clearRegionalPlanCache, regionalDatum } from './RegionalPlan';
import { findSurface, surfaceY, validateTopology } from './WalkableTopology';
import { rectCenter } from './types';
import { getEpicStructureSlotsForMacro } from './EpicStructures';

it('plans ordinary regional plateaus across chunk boundaries without a privileged zero floor', () => {
  const cells = Array.from({ length: 40 }, (_, x) => Array.from({ length: 40 }, (_, z) => regionalDatum('REGIONAL-AUDIT-0', x - 20, z - 20))).flat();
  const counts = new Map<string, number>(); for (const c of cells) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
  expect(Math.max(...counts.values())).toBeGreaterThan(20);
  expect(new Set(cells.map(c => c.y)).size).toBeGreaterThan(20);
  expect(cells.filter(c => c.y === 0).length / cells.length).toBeLessThan(.1);
  expect(Math.max(...cells.map(c => c.y)) - Math.min(...cells.map(c => c.y))).toBeGreaterThan(12);
  const a = generateInfiniteChunk('REGIONAL-AUDIT-0', { x: -1, z: 1, story: 0 }), b = generateInfiniteChunk('REGIONAL-AUDIT-0', { x: 0, z: 1, story: 0 });
  expect(a.spatial?.version).toBe(2); expect(b.spatial?.version).toBe(2);
  const regionChunks = new Map<string, Set<string>>();
  for (let z = -8; z < 8; z++) for (let x = -8; x < 8; x++) {
    const r = regionalDatum('REGIONAL-AUDIT-0', x, z), chunks = regionChunks.get(r.id) ?? new Set(); chunks.add(`${Math.floor(x / 4)}:${Math.floor(z / 4)}`); regionChunks.set(r.id, chunks);
  }
  expect(Math.max(...[...regionChunks.values()].map(s => s.size))).toBeGreaterThanOrEqual(4);
  expect(generateWorld('REGIONAL-AUDIT-0').spatial).toBeDefined();
});

it('shares actual nonzero seam heights and preserves order and structured cloning', () => {
  const seed = 'REGIONAL-NEGATIVE-SEAMS', c = { x: -1, z: -1, story: -3 };
  expect(getCanonicalEdgeGates(seed, c, 'east')).toEqual(getCanonicalEdgeGates(seed, { ...c, x: 0 }, 'west'));
  const a = generateInfiniteChunk(seed, c); expect(validateTopology(a)).toEqual([]); expect(structuredClone(a)).toEqual(a);
  clearRegionalPlanCache(); generateInfiniteChunk(seed, { ...c, x: 0 }); expect(generateInfiniteChunk(seed, c)).toEqual(a);
  for (const gate of a.edgeGates!.east) {
    const s = findSurface(a, { x: 55.9, z: gate.offset, referenceY: gate.floorY, maxAbove: .2, maxBelow: .2 });
    expect(s, `gate ${gate.offset}`).toBeDefined(); expect(surfaceY(s!, 55.9, gate.offset)).toBeCloseTo(gate.floorY, 5);
  }
});

it('uses real lower plans for open atria and directed drops, never orphan previews', () => {
  let drops = 0, stairLinks = 0, overlapping = 0;
  for (const i of [...Array.from({ length: 16 }, (_, i) => i), 23, 69]) {
    const w = generateInfiniteChunk(`REGIONAL-AUDIT-${i}`, { x: 0, z: 0, story: 0 });
    expect(validateTopology(w), w.seed).toEqual([]);
    const destinations = new Map<string, ReturnType<typeof generateInfiniteChunk>>();
    for (const c of w.topology!.connections.filter(c => c.toOwner)) {
      const key = JSON.stringify(c.toOwner);
      let other = destinations.get(key);
      if (!other) { other = generateInfiniteChunk(w.seed, c.toOwner!); destinations.set(key, other); }
      expect(c.targetKind === 'portal' ? other.spatial?.interfaces.some(p => p.id === c.to) : other.topology?.surfaces.some(s => s.id === c.to), c.to).toBe(true);
      if (c.kind === 'drop') { expect(c.direction).toBe('forward'); drops++; }
      if (c.kind === 'stairs') stairLinks++;
      const p = c.arrival!, localY = p.y - (c.toOwner!.story - w.spatial!.owner.story) * 5.4;
      const surface = findSurface(other, { x: p.x - (c.toOwner!.x - w.spatial!.owner.x) * 112, z: p.z - (c.toOwner!.z - w.spatial!.owner.z) * 112, referenceY: localY }); expect(surface).toBeDefined();
      overlapping++;
    }
  }
  expect(drops).toBeGreaterThan(8); expect(stairLinks).toBeGreaterThan(0); expect(overlapping).toBeGreaterThan(8);
});

it('keeps the standing capsule free on generated floors and across real stairs', async () => {
  for (let i = 0; i < 5; i++) {
    const w = generateInfiniteChunk(`REGIONAL-AUDIT-${i}`, { x: 0, z: 0, story: 0 }), physics = await PhysicsWorld.create(w);
    try {
      expect(physics.canStandAt(w.spawn), w.seed).toBe(true);
      for (const s of w.topology!.surfaces.filter(s => s.role === 'floor' && s.locomotion !== 'crouch' && s.bounds.maxX - s.bounds.minX > 3 && s.bounds.maxZ - s.bounds.minZ > 3)) {
        const p = rectCenter(s.bounds), y = surfaceY(s, p.x, p.z);
        const blocker = physics.world.intersectionWithShape({ ...p, y: y + .91 }, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Capsule(.52, .32),
          undefined, undefined, undefined, undefined, physics.isEnvironmentCollider);
        expect(blocker, `${w.seed} ${s.id}`).toBeNull();
      }
      const stairs = w.topology!.surfaces.filter(s => s.role === 'stair');
      if (!stairs.length) continue;
      const first = stairs.find(s => s.id.endsWith('/step-0') && !s.id.includes('atrium-stairs'));
      if (!first) continue;
      const group = stairs.filter(s => s.id.startsWith(first.id.replace(/step-0$/, 'step-'))), last = group.at(-1)!;
      const a = rectCenter(first.bounds), b = rectCenter(last.bounds), alongX = Math.abs(a.x - b.x) > Math.abs(a.z - b.z);
      const start = { x: a.x, y: surfaceY(first, a.x, a.z) + .94, z: a.z }; physics.teleport(start);
      for (let t = 0; t < 20; t++) physics.move({ x: 0, y: -.035, z: 0 });
      let actual = start;
      for (let t = 0; t < 240; t++) actual = { ...physics.move({ x: alongX ? .06 : 0, z: alongX ? 0 : .06, y: -.035 }).position };
      expect(alongX ? actual.x : actual.z, first.id).toBeGreaterThan((alongX ? b.x : b.z) - .5);
    } finally { physics.dispose(); }
  }
});

it('keeps every canonical opening body-free across its full useful width after thick walls and hall merges', async () => {
  for (let i = 0; i < 20; i++) {
    const w = generateInfiniteChunk(`REGIONAL-AUDIT-${i}`, { x: 0, z: 0, story: 0 }), physics = await PhysicsWorld.create(w);
    try {
      for (const edge of ['north', 'east', 'south', 'west'] as const) for (const gate of w.edgeGates![edge]) for (const t of [0, .25, .5, .75, 1]) {
        const along = gate.offset + (2 * t - 1) * (gate.width / 2 - .35), x = edge === 'west' ? -55.6 : edge === 'east' ? 55.6 : along, z = edge === 'north' ? -55.6 : edge === 'south' ? 55.6 : along;
        const blocker = physics.world.intersectionWithShape({ x, y: gate.floorY + .91, z }, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Capsule(.52, .32), undefined, undefined, undefined, undefined, physics.isEnvironmentCollider);
        expect(blocker, `${w.seed} ${edge} ${gate.offset} t=${t}`).toBeNull();
      }
    } finally { physics.dispose(); }
  }
});

it('preserves the real approach widths of all five legacy monument interfaces', async () => {
  const seed = 'REGIONAL-EPIC-INTERFACES', slots = getEpicStructureSlotsForMacro(seed, 0, 0);
  for (const slot of slots) for (const [edge, dx, dz, opposite] of [
    ['north', 0, -1, 'south'], ['east', 1, 0, 'west'], ['south', 0, 1, 'north'], ['west', -1, 0, 'east'],
  ] as const) {
    const epic = { x: slot.x, z: slot.z, story: 0 }, neighbor = { ...epic, x: epic.x + dx, z: epic.z + dz };
    const w = generateInfiniteChunk(seed, neighbor), gates = getCanonicalEdgeGates(seed, epic, edge);
    expect(w.spatial, `epic${slot.index} ${edge}`).toBeDefined();
    expect(w.edgeGates![opposite]).toEqual(gates);
    const physics = await PhysicsWorld.create(w);
    try {
      for (const gate of gates) for (const depth of [.4, 2.4, 3.8]) for (const t of [0, .5, 1]) {
        const along = gate.offset + (2 * t - 1) * (gate.width / 2 - .35);
        const x = opposite === 'west' ? -56 + depth : opposite === 'east' ? 56 - depth : along;
        const z = opposite === 'north' ? -56 + depth : opposite === 'south' ? 56 - depth : along;
        expect(physics.canStandAt({ x, y: gate.floorY + .865, z }), `epic${slot.index} ${edge} ${gate.offset} d=${depth} t=${t}`).toBe(true);
      }
    } finally { physics.dispose(); }
  }
});
