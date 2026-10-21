import { expect, it } from 'vitest';
import { planRegionalTransition, transitionTreads } from './TransitionLayout';
import { endpointStairRun } from './SpatialGeometry';
import { generateInfiniteChunk } from './InfiniteWorld';
import { surfaceRange, surfaceY, validateTopology } from './WalkableTopology';
import { rectCenter, rectDepth, rectWidth } from './types';

it('solves variable chambers with shared widths, partial rises and continuous roofs in all orientations', () => {
  const lengths = new Set<string>(), widths = new Set<number>(), kinds = new Set<string>();
  for (let i = 0; i < 40; i++) for (const side of ['north', 'east', 'south', 'west'] as const) {
    const t = planRegionalTransition(`TRANSITION-${i}`, -2, -3, -1, side, { minX: -28, maxX: 0, minZ: -56, maxZ: -28 }, -3.7, i % 3 === 0 ? -2.5 : 4.3, 'test');
    const count = transitionTreads(t).length, run = t.axis === 'x' ? rectWidth(t.run) : rectDepth(t.run);
    expect(run).toBeGreaterThan(2); widths.add(t.width); lengths.add(run.toFixed(2)); kinds.add(t.kind);
    expect(t.wallThickness).toBeGreaterThanOrEqual(.6);
    expect(t.roof.kind).toBe('linear');
    if (t.roof.kind === 'linear') {
      expect(t.roof.startY - t.startY).toBeCloseTo(3.05, 10);
      expect(t.roof.endY - t.endY).toBeCloseTo(3.05, 10);
    }
    if (t.kind === 'ramp') expect(Math.abs(t.endY - t.startY) / run).toBeLessThanOrEqual(.4);
    else expect(Math.abs(t.endY - t.startY) / count).toBeLessThanOrEqual(.175);
  }
  expect(lengths.size).toBeGreaterThan(30); expect(widths.size).toBe(3); expect([...kinds].sort()).toEqual(['ramp', 'stairs']);
});

it('ends every stair exactly at its destination without making oversized risers', () => {
  for (const axis of ['x', 'z'] as const) for (const [start, end] of [[-7.1, -6.45], [2.4, -1.2], [-.1, 8.15]]) {
    const steps = endpointStairRun({ minX: -30, maxX: 14, minZ: -22, maxZ: 22 }, axis, start!, end!);
    expect(steps.at(-1)!.profile).toEqual({ kind: 'flat', y: end });
    let previous = start!;
    for (const s of steps) { const y = s.profile.kind === 'flat' ? s.profile.y : 0; expect(Math.abs(y - previous)).toBeLessThanOrEqual(.17500001); previous = y; }
  }
});

it('constructs one roof per generated flight, closed risers and roof-bounded thick side walls', () => {
  let stairs = 0, ramps = 0;
  for (let i = 0; i < 12; i++) {
    const w = generateInfiniteChunk(`REGIONAL-AUDIT-${i}`, { x: 0, z: 0, story: 0 });
    expect(validateTopology(w)).toEqual([]);
    for (const t of w.spatial!.transitions!) {
      const roof = w.spatial!.ceilings.filter(s => s.id === `${t.id}/roof`); expect(roof).toHaveLength(1);
      const route = w.topology!.surfaces.filter(s => s.id === t.id || s.id.startsWith(`${t.id}/step-`));
      expect(route.length).toBeGreaterThan(0);
      for (const s of route) {
        const p = rectCenter(s.bounds), roofY = surfaceY({ ...roof[0]!, profile: t.roof, bounds: t.run }, p.x, p.z);
        expect(roofY - surfaceY(s, p.x, p.z)).toBeGreaterThan(2.85);
        if (s.role === 'stair') { stairs++; expect(s.thickness).toBeGreaterThan(.175); }
        else ramps++;
        expect(w.spatial!.ceilings.some(c => c.id.startsWith(`${s.id}/ceiling`))).toBe(false);
      }
      const panels = w.spatial!.prisms.filter(p => p.id.startsWith(`${t.id}/`) && p.id.includes('/side-'));
      expect(panels).toHaveLength(6);
      for (const p of panels) for (const y of p.vertices.filter((_, j) => j % 3 === 1)) expect(y).toBeLessThanOrEqual(Math.max(t.startY, t.endY) + 3.080001);
    }
  }
  expect(stairs).toBeGreaterThan(20); expect(ramps).toBeGreaterThan(5);
}, 30000);

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
  for (let i = 0; i < 24; i++) {
    const w = generateInfiniteChunk(`REGIONAL-AUDIT-${i}`, { x: 0, z: 0, story: 0 });
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
    const a = planRegionalTransition(...args, -1, 'east', b, -3, 5, 'a');
    const c = planRegionalTransition(...args, 0, 'east', b, -3, 5, 'b');
    expect([a.run, a.bounds, a.width, a.profile, a.roof]).toEqual([c.run, c.bounds, c.width, c.profile, c.roof]);
  }
});
