import { expect, it } from 'vitest';
import { hasRegionalTransition, regionalDatum, spatialCellBounds } from './RegionalPlan';
import { planRegionalTransition, transitionTreads } from './TransitionLayout';
import { generateInfiniteChunk } from './InfiniteWorld';
import { cutRects, surfaceY } from './WalkableTopology';
import { rectArea } from './types';

it('selects isolated canonical links with at most one cage per cell in both generation directions', () => {
  let candidates = 0, selected = 0;
  for (let seed = 0; seed < 24; seed++) {
    const name = `CAGE-ISOLATION-${seed}`, links: { x: number; z: number }[] = [];
    for (let z = -5; z < 5; z++) for (let x = -5; x < 5; x++) {
      let degree = 0;
      for (const [side, dx, dz, opposite] of [['east', 1, 0, 'west'], ['west', -1, 0, 'east'], ['south', 0, 1, 'north'], ['north', 0, -1, 'south']] as const) {
        const yes = hasRegionalTransition(name, x, z, side);
        expect(yes).toBe(hasRegionalTransition(name, x + dx, z + dz, opposite));
        degree += Number(yes);
        if (side !== 'east' && side !== 'south') continue;
        if (Math.abs(regionalDatum(name, x, z).y - regionalDatum(name, x + dx, z + dz).y) > .001) candidates++;
        if (yes) { selected++; links.push({ x: x + dx / 2, z: z + dz / 2 }); }
      }
      expect(degree).toBeLessThanOrEqual(1);
    }
    for (let i = 0; i < links.length; i++) for (let j = i + 1; j < links.length; j++)
      expect(Math.hypot(links[i]!.x - links[j]!.x, links[i]!.z - links[j]!.z)).toBeGreaterThanOrEqual(1.75);
  }
  expect(selected).toBeGreaterThan(20); expect(selected / candidates).toBeLessThan(.3);
});

it('makes a single continuous straight flight across cell and owner cuts, and sometimes plans a true intermediate landing', () => {
  const kinds = new Set<string>();
  for (let n = 0; n < 64; n++) {
    const seed = `SINGLE-FLIGHT-${n}`, a = planRegionalTransition(seed, 3, -2, 0, 'east', spatialCellBounds(3, -2), -2, 4, 'a');
    const b = planRegionalTransition(seed, 4, -2, 0, 'west', spatialCellBounds(4, -2), 4, -2, 'b');
    kinds.add(a.composition); expect(a.linkId).toBe(b.linkId); expect(a.kind).toBe(b.kind); expect(a.clearance).toBe(b.clearance);
    expect(a.clearance).toBeGreaterThanOrEqual(3.8);
    if (a.composition === 'single') {
      expect(a.run.maxX).toBe(b.run.minX);
      expect(a.landing.bounds.maxX - a.landing.bounds.minX).toBe(0);
      expect(b.landing.bounds.maxX - b.landing.bounds.minX).toBe(0);
      expect(surfaceY({ bounds: a.run, profile: a.profile } as never, a.run.maxX, a.run.minZ)).toBeCloseTo(surfaceY({ bounds: b.run, profile: b.profile } as never, b.run.minX, b.run.minZ), 8);
    }
    for (const t of [a, b]) for (const step of transitionTreads(t)) {
      const x = (step.bounds.minX + step.bounds.maxX) / 2, z = (step.bounds.minZ + step.bounds.maxZ) / 2;
      const headroom = surfaceY({ bounds: t.run, profile: t.roof } as never, x, z) - surfaceY(step as never, x, z);
      expect(headroom).toBeGreaterThan(3.6);
    }
  }
  expect([...kinds].sort()).toEqual(['landing', 'single']);
});

it('keeps upper piers entirely on actual bearing walls after the final reservations and doors', () => {
  let checked = 0;
  const bounds = (w: { x: number; z: number; orientation: string; length: number; thickness: number }) => ({ minX: w.x - (w.orientation === 'x' ? w.length : w.thickness) / 2, maxX: w.x + (w.orientation === 'x' ? w.length : w.thickness) / 2,
    minZ: w.z - (w.orientation === 'z' ? w.length : w.thickness) / 2, maxZ: w.z + (w.orientation === 'z' ? w.length : w.thickness) / 2 });
  for (let n = 0; n < 12; n++) {
    const w = generateInfiniteChunk(`REGIONAL-AUDIT-${n}`, { x: 0, z: 0, story: 0 });
    for (const shell of w.walls.filter(w => w.detail === 'upper-shell')) {
      const supports = w.walls.filter(s => s !== shell && s.bottom < shell.bottom - .02 && s.bottom + s.height >= shell.bottom - .02).map(bounds);
      expect(cutRects([bounds(shell)], supports).reduce((a, b) => a + rectArea(b), 0), shell.id).toBeLessThan(.0001); checked++;
    }
  }
  expect(checked).toBeGreaterThan(20);
}, 30000);

it('sometimes gives a solid mound one access ramp and sometimes an opposed, symmetrical pair', () => {
  const access = new Set<string>(); let count = 0;
  for (let n = 0; n < 48; n++) {
    const w = generateInfiniteChunk(`REGIONAL-AUDIT-${n}`, { x: 0, z: 0, story: 0 });
    for (const relief of w.spatial!.reliefs ?? []) if (relief.kind === 'mound') {
      const ramps = w.topology!.surfaces.filter(s => relief.surfaceIds.includes(s.id) && s.profile.kind === 'linear');
      expect(ramps).toHaveLength(relief.access === 'single' ? 1 : 2); access.add(relief.access!); count++;
      for (const ramp of ramps) expect(ramp.supportBottom).toBeCloseTo(relief.baseY - .16, 8);
    }
  }
  expect(count).toBeGreaterThan(5); expect([...access].sort()).toEqual(['opposed', 'single']);
}, 30000);

it('streams enough disjoint bearing-wall bands to enclose the entire flight across vertical owners', () => {
  let checked = 0;
  for (let n = 0; n < 8; n++) {
    const w = generateInfiniteChunk(`REGIONAL-AUDIT-${n}`, { x: 0, z: 0, story: 0 }), plans = new Map([[0, w]]);
    for (const t of w.spatial!.transitions!) {
      const stories = new Set([0, ...w.spatial!.dependencies.filter(d => d.reason === 'stairs' && d.bounds.minX <= t.bounds.minX && d.bounds.maxX >= t.bounds.maxX && d.bounds.minZ <= t.bounds.minZ && d.bounds.maxZ >= t.bounds.maxZ).map(d => d.owner.story)]);
      const bands: { min: number; max: number }[] = [];
      for (const story of stories) {
        let plan = plans.get(story); if (!plan) { plan = generateInfiniteChunk(w.seed, { x: 0, z: 0, story }); plans.set(story, plan); }
        const half = (id: string) => id.split('/cell/')[1]!.replace(/\/-?\d+\/(north|east|south|west)\/route$/, '/$1/route');
        const partner = plan.spatial!.transitions!.find(p => half(p.id) === half(t.id))!;
        expect(partner).toBeDefined(); expect(partner.bounds).toEqual(t.bounds);
        const wall = plan.spatial!.prisms.find(p => p.id === `${partner.id}/run/side--1/0`)!;
        expect(wall).toBeDefined();
        const ys = wall.vertices.filter((_, i) => i % 3 === 1).map(y => y + story * 5.4);
        bands.push({ min: Math.min(...ys), max: Math.max(...ys) });
      }
      bands.sort((a, b) => a.min - b.min);
      for (let i = 1; i < bands.length; i++) expect(bands[i]!.min - bands[i - 1]!.max).toBeCloseTo(0, 7);
      expect(bands[0]!.min).toBeLessThanOrEqual(Math.min(t.startY, t.endY) - .16 + .00001);
      expect(bands.at(-1)!.max).toBeGreaterThanOrEqual(Math.max(t.startY, t.endY) + t.clearance + .03 - .00001); checked++;
    }
  }
  expect(checked).toBeGreaterThan(5);
}, 30000);
