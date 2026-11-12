import { expect, it } from 'vitest';
import { DATUM_QUANTUM, planRegionalTransition, transitionTreads } from './TransitionLayout';
import { endpointStairRun, RAMP_MAX_GRADE, STAIR_MAX_RISER, STAIR_TREAD } from './SpatialGeometry';
import { generateInfiniteChunk } from './InfiniteWorld';
import { surfaceRange, validateTopology } from './WalkableTopology';
import { rectCenter, rectDepth, rectWidth } from './types';

it('fixes the pitch first and derives the footprint from the rise in all orientations', () => {
  const widths = new Set<number>(), kinds = new Set<string>(), compositions = new Set<string>();
  for (let i = 0; i < 60; i++) for (const side of ['north', 'east', 'south', 'west'] as const) for (const total of [1, 2, 3, 4].map(n => n * DATUM_QUANTUM)) {
    const cell = { minX: -28, maxX: 0, minZ: -56, maxZ: -28 };
    const t = planRegionalTransition(`TRANSITION-${i}`, -2, -3, -1, side, cell, -DATUM_QUANTUM, -DATUM_QUANTUM + (i % 2 ? total : -total), 'test');
    const treads = transitionTreads(t), run = t.axis === 'x' ? rectWidth(t.run) : rectDepth(t.run), rise = Math.abs(t.endY - t.startY);
    widths.add(t.width); kinds.add(t.kind); compositions.add(t.composition);
    expect(rise).toBeCloseTo(total / 2, 9); expect(t.wallThickness).toBeGreaterThanOrEqual(.6);
    if (t.kind === 'ramp') {
      expect(rise).toBeLessThanOrEqual(DATUM_QUANTUM + 1e-9); expect(rise / run).toBeCloseTo(RAMP_MAX_GRADE, 9); expect(t.steps).toBe(0);
    } else {
      expect(treads).toHaveLength(t.steps); expect(run).toBeCloseTo(t.steps * STAIR_TREAD, 9);
      expect(t.riser).toBeGreaterThanOrEqual(.15 - 1e-9); expect(t.riser).toBeLessThanOrEqual(STAIR_MAX_RISER + 1e-9);
      for (const s of treads) expect(t.axis === 'x' ? rectWidth(s.bounds) : rectDepth(s.bounds)).toBeCloseTo(STAIR_TREAD, 9);
      expect(Math.atan(rise / run) * 180 / Math.PI).toBeLessThan(31);
    }
    // Approach, flight and optional seam landing tile the footprint, which ends on the cell edge and stays inside the cell.
    const along = (r: typeof t.bounds) => t.axis === 'x' ? rectWidth(r) : rectDepth(r);
    expect(along(t.approach.bounds) + along(t.run) + along(t.landing.bounds)).toBeCloseTo(along(t.bounds), 9);
    expect(along(t.approach.bounds)).toBeCloseTo(2.2, 9); expect(along(t.landing.bounds)).toBeCloseTo(t.composition === 'landing' ? 1.6 : 0, 9);
    expect(along(t.bounds)).toBeLessThanOrEqual(14 - t.width / 2 - .55);
    const edge = side === 'east' ? cell.maxX : side === 'west' ? cell.minX : side === 'south' ? cell.maxZ : cell.minZ;
    expect(side === 'east' ? t.bounds.maxX : side === 'west' ? t.bounds.minX : side === 'south' ? t.bounds.maxZ : t.bounds.minZ).toBeCloseTo(edge, 9);
    expect(t.clearance).toBeGreaterThanOrEqual(2.74);
  }
  expect(widths.size).toBe(3); expect([...kinds].sort()).toEqual(['ramp', 'stairs']); expect([...compositions].sort()).toEqual(['landing', 'single']);
});

it('ends every stair exactly at its destination without making oversized risers', () => {
  for (const axis of ['x', 'z'] as const) for (const [start, end] of [[-7.1, -6.45], [2.4, -1.2], [-.1, 8.15]]) {
    const steps = endpointStairRun({ minX: -30, maxX: 14, minZ: -22, maxZ: 22 }, axis, start!, end!);
    expect(steps.at(-1)!.profile).toEqual({ kind: 'flat', y: end });
    let previous = start!;
    for (const s of steps) { const y = s.profile.kind === 'flat' ? s.profile.y : 0; expect(Math.abs(y - previous)).toBeLessThanOrEqual(.17500001); previous = y; }
  }
});

it('preserves real legacy holes and their canonical arrival floors through structured cloning', () => {
  let holes = 0, crawl = 0, breach = 0;
  for (let i = 0; i < 32; i++) {
    const w = generateInfiniteChunk(`REGIONAL-AUDIT-${i}`, { x: 0, z: 0, story: 0 });
    expect(validateTopology(w), w.seed).toEqual([]);
    for (const f of w.features) {
      if (f.kind === 'squeeze-view') { crawl++; if (f.passageStyle === 'wall-breach') breach++; }
      if (f.kind !== 'grid-pit' && f.kind !== 'squeeze-view') continue;
      for (const b of f.holes ?? []) {
        holes++; const p = rectCenter(b), h = w.rooms.find(r => r.id === f.roomId)!.floorY!;
        expect(w.topology!.surfaces.some(s => p.x > s.bounds.minX && p.x < s.bounds.maxX && p.z > s.bounds.minZ && p.z < s.bounds.maxZ && Math.abs(surfaceRange(s)[0] - h) < .01)).toBe(false);
      }
    }
    for (const c of w.topology!.connections.filter(c => c.kind === 'drop' && c.id.includes('/heritage/'))) {
      const target = generateInfiniteChunk(w.seed, c.toOwner!);
      const floor = target.topology!.surfaces.find(s => s.id === c.to); expect(floor, c.to).toBeDefined();
      expect(c.arrival!.x).toBeGreaterThanOrEqual(floor!.bounds.minX); expect(c.arrival!.x).toBeLessThanOrEqual(floor!.bounds.maxX);
      expect(c.arrival!.z).toBeGreaterThanOrEqual(floor!.bounds.minZ); expect(c.arrival!.z).toBeLessThanOrEqual(floor!.bounds.maxZ);
    }
    expect(structuredClone(w)).toEqual(w);
  }
  expect(holes).toBeGreaterThan(5); expect(crawl).toBeGreaterThan(0); expect(breach).toBeGreaterThan(0);
}, 60000);

it('anchors every raised relief to the real lower floor and keeps its references valid', () => {
  const kinds = new Set<string>(); let count = 0;
  const cases = [...Array.from({length:24},(_,i)=>({ seed:`REGIONAL-AUDIT-${i}`, x:0,z:0 })),
    {seed:'REGIONAL-AUDIT-12',x:-1,z:-1},{seed:'REGIONAL-AUDIT-12',x:1,z:0},{seed:'REGIONAL-AUDIT-23',x:1,z:1},
    {seed:'REGIONAL-AUDIT-29',x:1,z:0},{seed:'REGIONAL-AUDIT-47',x:0,z:-2}];
  for (const c of cases) {
    const w = generateInfiniteChunk(c.seed, { x: c.x, z: c.z, story: 0 });
    for (const r of w.spatial!.reliefs ?? []) {
      count++; kinds.add(r.kind); expect(w.rooms.some(room => room.id === r.roomId)).toBe(true); expect(r.peakY - r.baseY).toBeGreaterThan(.3);
      for (const id of r.surfaceIds) {
        const s = w.topology!.surfaces.find(s => s.id === id); expect(s, id).toBeDefined();
        expect(s!.support).toBe('solid'); expect(s!.supportBottom).toBeCloseTo(r.baseY - .16, 8);
      }
    }
  }
  expect(count).toBeGreaterThan(5); expect([...kinds].sort()).toEqual(['mound', 'terraces']);
}, 30000);

it('keeps transition footprints identical in vertically adjacent owners', () => {
  for (let i = 0; i < 24; i++) {
    const args = [`COLUMN-${i}`, -3, 2] as const, b = { minX: -28, maxX: 0, minZ: 0, maxZ: 28 };
    const a = planRegionalTransition(...args, -1, 'east', b, -.9, .9, 'a');
    const c = planRegionalTransition(...args, 0, 'east', b, -.9, .9, 'b');
    expect([a.run, a.bounds, a.width, a.profile, a.roof]).toEqual([c.run, c.bounds, c.width, c.profile, c.roof]);
  }
});
