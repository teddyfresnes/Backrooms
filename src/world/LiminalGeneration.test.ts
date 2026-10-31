import { expect, it, vi } from 'vitest';
vi.mock('@dimforge/rapier3d', async () => import('../../node_modules/@dimforge/rapier3d/rapier.js'));
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { generateInfiniteChunk, clearInfiniteWorldCaches, getChunkWorldOffset, getCanonicalEdgeGates } from './InfiniteWorld';
import { regionalAtrium } from './RegionalPlan';
import { liminalGalleryPresent } from './LiminalAtrium';
import { insetAtrium } from './AtriumEnvelope';
import { findSurface, surfaceY, validateTopology } from './WalkableTopology';
import { pointInRect, rectCenter, type WorldPlan } from './types';

const rooms = [[42, -1, 1, 0, 'opposed'], [276, -1, 1, -1, 'corner'], [40, 0, 0, -2, 'end'], [82, 0, -1, 0, 'side']] as const;
const fBounds = (w: WorldPlan, layout: string) => w.features.find(f => f.kind === 'liminal-architecture' && f.composition === layout)!.bounds;

it('constructs partial galleries, real tunnels and canonical lower destinations in ordinary chunks', async () => {
  let drops = 0, views = 0, partial = 0;
  for (const [i, x, z, story, layout] of rooms) {
    const seed = `LIMINAL-ORDINARY-${i}`, top = generateInfiniteChunk(seed, { x, z, story });
    const f = top.features.find(f => f.kind === 'liminal-architecture' && f.family === 'partial-gallery' && f.composition === layout)!;
    expect(f?.kind).toBe('liminal-architecture'); if (f.kind !== 'liminal-architecture') continue;
    const match = /cell\/(-?\d+)\/(-?\d+)\//.exec(f.id)!, a = regionalAtrium(seed, +match[1]!, +match[2]!, story)!;
    const plans = new Map<number, WorldPlan>();
    for (let s = a.lower; s <= a.owner; s++) plans.set(s, generateInfiniteChunk(seed, { x, z, story: s }));
    for (const [s, w] of plans) {
      expect(validateTopology(w), `${seed}/${s}`).toEqual([]);
      const feature = w.features.find(f => f.kind === 'liminal-architecture' && f.composition === layout && f.bounds.minX === fBounds(top, layout).minX && f.bounds.minZ === fBounds(top, layout).minZ)!;
      expect(feature?.kind).toBe('liminal-architecture'); if (feature.kind !== 'liminal-architecture') continue;
      expect(feature.visibleSides.length).toBe(layout === 'side' || layout === 'end' ? 1 : 2);
      expect(feature.stairCount).toBeLessThanOrEqual(1); partial++;
      const physics = await PhysicsWorld.create(w);
      try {
        const entry = { x: feature.bounds.minX + 14, z: feature.bounds.minZ + .8 }, h = feature.floorLevels[0]!;
        expect(findSurface(w, { ...entry, referenceY: h, maxAbove: .05, maxBelow: .05 })).toBeDefined();
        expect(physics.canStandAt({ ...entry, y: h + .865 }), `${seed}/${s} canonical entry`).toBe(true);
        if (layout === 'corner' && liminalGalleryPresent(a, s)) {
          const inner = insetAtrium(feature.bounds, a.ringWidth), offset = (a.owner - s) * 2.4 + .8;
          const corner = { x: feature.visibleSides.includes('east') ? inner.maxX - offset : inner.minX + offset,
            z: feature.visibleSides.includes('south') ? inner.maxZ - offset : inner.minZ + offset };
          expect(findSurface(w, { ...corner, referenceY: h, maxAbove: .05, maxBelow: .05 }), 'continuous visible L').toBeDefined();
          expect(physics.canStandAt({ ...corner, y: h + .865 })).toBe(true);
        }
        for (const wall of feature.walls.filter(w => w.id.includes('/inner-'))) for (const opening of wall.openings) {
          const along = (opening.min + opening.max) / 2, alongX = wall.axis === 'x', floor = feature.floorLevels[0]!;
          for (const sign of [-1, 1]) {
            const cross = (alongX ? wall.bounds.minZ + wall.bounds.maxZ : wall.bounds.minX + wall.bounds.maxX) / 2 + sign * .5;
            const p = { x: alongX ? along : cross, z: alongX ? cross : along };
            if (opening.access === 'view') {
              views++; expect(opening.bottom).toBeGreaterThan(floor + 1);
              expect(w.topology!.connections.filter(c => c.id.startsWith(`${wall.id}/opening-`)).every(c => c.kind === 'view')).toBe(true);
            } else {
              expect(findSurface(w, { ...p, referenceY: floor, maxAbove: .05, maxBelow: .05 }), `${wall.id}/${sign}`).toBeDefined();
              expect(physics.canStandAt({ ...p, y: floor + .91 }), `${wall.id}/${sign}`).toBe(true);
            }
          }
        }
      } finally { physics.dispose(); }
      const stem = feature.id.replace(/\/liminal$/, '/');
      for (const c of w.topology!.connections.filter(c => c.id.startsWith(stem) && c.toOwner && c.kind === 'drop')) {
        const other = plans.get(c.toOwner!.story)!, target = other.topology!.surfaces.find(t => t.id === c.to);
        expect(target, c.to).toBeDefined(); expect(c.direction).toBe('forward');
        const arrival = c.arrival!, localY = arrival.y - (c.toOwner!.story - s) * 5.4;
        expect(pointInRect(arrival.x, arrival.z, target!.bounds)).toBe(true);
        expect(surfaceY(target!, arrival.x, arrival.z)).toBeCloseTo(localY, 5); drops++;
      }
      if (!liminalGalleryPresent(a, s) && s > a.lower) expect(w.topology!.surfaces.some(t => t.id.startsWith(stem) && t.role === 'balcony')).toBe(false);
    }
    const source = top.topology!.connections.find(c => c.id.includes('/gallery-drop-') && c.toOwner?.story !== undefined && c.id.includes(f.id.replace(/\/liminal$/, '/')))!;
    expect(source).toBeDefined(); const physics = await PhysicsWorld.create({ ...top, colliders: [] });
    try {
      physics.batchChunkChanges(() => { for (const [s, plan] of plans) physics.addChunk(String(s), plan.colliders, getChunkWorldOffset({ x, z, story: s })); });
      const p = source.arrival!, offset = getChunkWorldOffset({ x, z, story });
      physics.teleport({ x: p.x + offset.x, z: p.z + offset.z, y: f.floorLevels[0]! + offset.y + .865 });
      let velocity = 0, actual = { x: 0, y: Infinity, z: 0 };
      for (let t = 0; t < 260; t++) { velocity = Math.max(-50, velocity - 22 / 60); const r = physics.move({ x: 0, y: velocity / 60, z: 0 }); actual = { ...r.position }; if (r.grounded) velocity = -.9; }
      expect(actual.y, seed).toBeCloseTo(p.y + offset.y + .865, 1);
    } finally { physics.dispose(); }
  }
  expect(partial).toBeGreaterThan(8); expect(drops).toBeGreaterThan(8); expect(views).toBeGreaterThan(0);
}, 30000);

it('retains historical grids and falls through all four new pit families and their real owners', async () => {
  const examples = [[73, 0, -1, 1, 'offset-well'], [80, 1, 1, -2, 'sunken-court'], [81, -1, -1, -1, 'paired-wells'], [41, 1, 0, -1, 'fault']] as const;
  for (const [i, x, z, story, family] of examples) {
    const seed = `LIMINAL-${family === 'fault' ? 'HOLDOUT' : 'ORDINARY'}-${i}`, w = generateInfiniteChunk(seed, { x, z, story });
    const f = w.features.find(f => f.kind === 'liminal-pit' && f.family === family)!; expect(f?.kind).toBe('liminal-pit'); if (f.kind !== 'liminal-pit') continue;
    const hole = f.holes[0]!, p = rectCenter(hole), h = w.rooms.find(r => r.id === f.roomId)!.floorY!, offset = getChunkWorldOffset({ x, z, story });
    const physics = await PhysicsWorld.create({ ...w, colliders: [] });
    try {
      physics.batchChunkChanges(() => { for (let s = story - hole.stories!; s <= story; s++) {
        const owner = { x, z, story: s }, plan = generateInfiniteChunk(seed, owner); expect(validateTopology(plan), `${seed}/${s}`).toEqual([]);
        physics.addChunk(String(s), plan.colliders, getChunkWorldOffset(owner));
      } });
      physics.teleport({ x: p.x + offset.x, z: p.z + offset.z, y: h + offset.y + .865 }); let velocity = 0, actualY = Infinity;
      for (let t = 0; t < 330; t++) { velocity = Math.max(-50, velocity - 22 / 60); const r = physics.move({ x: 0, y: velocity / 60, z: 0 }); actualY = r.position.y; if (r.grounded) velocity = -.9; }
      if (hole.kind === 'void') expect(actualY).toBeLessThan(h + offset.y - 50);
      else expect(actualY, family).toBeCloseTo(h + offset.y - f.depth + .865, 1);
    } finally { physics.dispose(); }
  }
  expect(generateInfiniteChunk('REGIONAL-AUDIT-17', { x: 0, z: 0, story: 0 }).features.some(f => f.kind === 'grid-pit')).toBe(true);
}, 30000);

it('serializes new references and preserves negative seams independently of generation order', () => {
  const address = { x: -1, z: 1, story: -1 }, seed = 'LIMINAL-ORDINARY-42', a = generateInfiniteChunk(seed, address);
  expect(a.features.some(f => f.kind === 'liminal-architecture')).toBe(true); expect(structuredClone(a)).toEqual(a);
  clearInfiniteWorldCaches(); generateInfiniteChunk(seed, { ...address, x: -2 }); generateInfiniteChunk(seed, { ...address, story: -2 });
  expect(generateInfiniteChunk(seed, address)).toEqual(a);
  expect(getCanonicalEdgeGates(seed, address, 'west')).toEqual(getCanonicalEdgeGates(seed, { ...address, x: -2 }, 'east'));
  expect(validateTopology(generateInfiniteChunk('LIMINAL-ORDINARY-103', { x: 0, z: 0, story: 1 }))).toEqual([]);
});

it('walks the single fractional stair and retains the historical split bridge', async () => {
  const w = generateInfiniteChunk('LIMINAL-ORDINARY-42', { x: -1, z: 1, story: -2 });
  const f = w.features.find(f => f.kind === 'liminal-architecture' && f.stairCount === 1);
  expect(f?.kind).toBe('liminal-architecture'); if (f?.kind !== 'liminal-architecture') return;
  const stairs = w.topology!.surfaces.filter(s => s.id.startsWith(f.id.replace(/\/liminal$/, '/fractional-stair-')));
  expect(stairs.length).toBeGreaterThan(1); const first = stairs[0]!, last = stairs.at(-1)!, a = rectCenter(first.bounds), b = rectCenter(last.bounds);
  const physics = await PhysicsWorld.create(w);
  try {
    physics.teleport({ ...a, y: surfaceY(first, a.x, a.z) + .865 }); let actual = { x: a.x, y: 0, z: a.z };
    for (let i = 0; i < Math.ceil((b.x - a.x + .2) / .04); i++) actual = { ...physics.move({ x: .04, z: 0, y: -.035 }).position };
    expect(actual.x).toBeGreaterThan(b.x - .15); expect(actual.y).toBeCloseTo(surfaceY(last, b.x, b.z) + .865, 1);
  } finally { physics.dispose(); }
  expect(generateInfiniteChunk('LIMINAL-ORDINARY-18', { x: -1, z: -1, story: 1 }).topology!.connections.some(c => c.kind === 'jump' && c.id.includes('/bridge-jump'))).toBe(true);
});
