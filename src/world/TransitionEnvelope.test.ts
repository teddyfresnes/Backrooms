import { expect, it } from 'vitest';
import { DATUM_QUANTUM, planRegionalTransition, transitionTreads } from './TransitionLayout';
import { generateInfiniteChunk } from './InfiniteWorld';
import { spatialCellBounds } from './RegionalPlan';
import { surfaceY } from './WalkableTopology';
import { rectCenter, rectDepth, rectWidth } from './types';

const directions = [['east', 1, 0, 'west'], ['west', -1, 0, 'east'], ['north', 0, -1, 'south'], ['south', 0, 1, 'north']] as const;
const totals = [1, 2, 3, 4].map(n => n * DATUM_QUANTUM);

it('gives both halves of a link the same finish, enclosure, roof and seam in all directions', () => {
  for (let n = 0; n < 24; n++) for (const total of totals) for (const [side, dx, dz, opposite] of directions) {
    const low = -DATUM_QUANTUM, high = low + total, seed = `ROOF-ENDPOINTS-${n}`;
    const a = planRegionalTransition(seed, 0, 0, 0, side, spatialCellBounds(0, 0), low, high, 'a');
    const b = planRegionalTransition(seed, dx, dz, 0, opposite, spatialCellBounds(dx, dz), high, low, 'b');
    expect([b.kind, b.enclosure, b.wallSide, b.roofPolicy, b.width, b.composition, b.steps, b.wallThickness])
      .toEqual([a.kind, a.enclosure, a.wallSide, a.roofPolicy, a.width, a.composition, a.steps, a.wallThickness]);
    expect(a.landing.y).toBeCloseTo((low + high) / 2, 9); expect(b.landing.y).toBeCloseTo(a.landing.y, 9);
    expect(a.landingCeilingY).toBeCloseTo(b.landingCeilingY, 9);
    // The seam is the shared cell edge: both roofs and both runs meet there.
    const edge = (t: typeof a) => t.axis === 'x'
      ? { x: Math.abs(t.bounds.minX - t.approach.bounds.minX) < 1e-9 ? t.bounds.maxX : t.bounds.minX, z: rectCenter(t.bounds).z }
      : { z: Math.abs(t.bounds.minZ - t.approach.bounds.minZ) < 1e-9 ? t.bounds.maxZ : t.bounds.minZ, x: rectCenter(t.bounds).x };
    const p = edge(a), q = edge(b);
    expect([p.x, p.z]).toEqual([q.x, q.z]);
    for (const [t, at] of [[a, p], [b, q]] as const) {
      const nearSeam = rectWidth(t.landing.bounds) > .005 && rectDepth(t.landing.bounds) > .005 ? t.landingCeilingY : surfaceY({ bounds: t.run, profile: t.roof } as never, at.x, at.z);
      expect(nearSeam).toBeCloseTo(a.landingCeilingY, 9);
      for (const s of transitionTreads(t)) for (const x of [s.bounds.minX, s.bounds.maxX]) for (const z of [s.bounds.minZ, s.bounds.maxZ])
        expect(surfaceY({ bounds: t.run, profile: t.roof } as never, x, z) - surfaceY(s as never, x, z)).toBeGreaterThanOrEqual(2.74);
    }
  }
});

it('keeps every half between its own floor slab and the next one', () => {
  for (let n = 0; n < 24; n++) for (const total of totals) for (const [side] of directions) for (const rising of [true, false]) {
    const floor = rising ? 0 : total, other = rising ? total : 0;
    const t = planRegionalTransition(`BAND-${n}`, 4, -7, 2, side, spatialCellBounds(4, -7), floor, other, 't');
    const base = Math.min(floor, t.landing.y) - .16, roofs = [t.approachCeilingY, t.landingCeilingY,
      ...(t.roof.kind === 'flat' ? [t.roof.y] : [t.roof.startY, t.roof.endY])];
    // Suspended tiles (3 cm) stay under the slab of the owner above this half.
    for (const y of roofs) expect(y + .03).toBeLessThanOrEqual(base + 5.4 + 1e-9);
    // A sunken half never digs deeper than two quanta below its own floor.
    expect(floor - t.landing.y).toBeLessThanOrEqual(DATUM_QUANTUM * 2 + 1e-9);
    if (total > DATUM_QUANTUM * 2 + .001) expect([t.enclosure, t.roofPolicy]).toEqual(['chamber', 'flight']);
    if (t.roofPolicy === 'flight') expect(t.enclosure).toBe('chamber');
    expect(t.wallSide === undefined).toBe(t.enclosure !== 'wall');
  }
});

it('materializes the three roofs, the three enclosures and solid flights in real chunks', () => {
  const roofs = new Set<string>(), enclosures = new Set<string>(); let flights = 0, parapets = 0;
  for (let n = 0; n < 24; n++) {
    const w = generateInfiniteChunk(`REGIONAL-AUDIT-${n}`, { x: 0, z: 0, story: 0 });
    for (const t of w.spatial!.transitions!) {
      flights++; roofs.add(t.roofPolicy); enclosures.add(t.enclosure);
      const cell = w.spatial!.cells.find(c => t.roomId.startsWith(c.id + '/'))!, base = Math.min(cell.floorY, t.landing.y) - .16;
      expect(t.approach.y).toBeCloseTo(cell.floorY, 9);
      // One suspended ceiling covers the whole footprint; a pitched one has flat ends.
      const tiles = w.spatial!.ceilings.filter(s => s.id === `${t.id}/roof` || s.id.startsWith(`${t.id}/approach/ceiling`) || s.id.startsWith(`${t.id}/landing/ceiling`));
      expect(tiles.some(s => s.id === `${t.id}/roof`)).toBe(true);
      if (t.roofPolicy !== 'flight') expect(tiles).toHaveLength(1);
      const route = w.topology!.surfaces.filter(s => s.id === t.id || s.id.startsWith(`${t.id}/step-`));
      expect(route.length).toBe(t.kind === 'ramp' ? 1 : t.steps);
      for (const s of route) {
        // Podium or trench bottom: the mass bears on the lowest floor of its half.
        expect(s.support).toBe('solid'); expect(s.supportBottom).toBeCloseTo(base, 9);
        const p = rectCenter(s.bounds);
        expect(surfaceY({ ...s, profile: s.ceilingProfile! }, p.x, p.z) - surfaceY(s, p.x, p.z)).toBeGreaterThanOrEqual(2.74);
      }
      const sides = w.spatial!.prisms.filter(p => p.id.startsWith(`${t.id}/`) && p.id.includes('/side-'));
      const guards = w.spatial!.prisms.filter(p => p.id.startsWith(`${t.id}/`) && p.id.includes('/parapet-'));
      const parts = rectWidth(t.landing.bounds) > .005 && rectDepth(t.landing.bounds) > .005 ? 2 : 1;
      const walled = t.enclosure === 'chamber' ? 2 : t.enclosure === 'wall' ? 1 : 0, sunken = t.landing.y < cell.floorY - .001;
      expect(sides).toHaveLength(walled * parts); expect(guards).toHaveLength(sunken ? (2 - walled) * parts : 0); parapets += guards.length;
      for (const p of sides) {
        const ys = p.vertices.filter((_, j) => j % 3 === 1);
        expect(Math.min(...ys)).toBeCloseTo(base, 9); expect(Math.max(...ys)).toBeCloseTo(base + 5.4, 9);
      }
      for (const p of guards) expect(Math.max(...p.vertices.filter((_, j) => j % 3 === 1))).toBeCloseTo(cell.floorY + 1.05, 9);
      // Nothing is cut through: a flight needs no other vertical owner.
      expect(w.spatial!.dependencies.some(d => d.reason === 'stairs' && d.bounds.minX <= t.bounds.minX && d.bounds.maxX >= t.bounds.maxX
        && d.bounds.minZ <= t.bounds.minZ && d.bounds.maxZ >= t.bounds.maxZ)).toBe(false);
      const upper = generateInfiniteChunk(w.seed, { x: 0, z: 0, story: 1 });
      const other = upper.spatial!.transitions!.find(p => p.bounds.minX === t.bounds.minX && p.bounds.minZ === t.bounds.minZ && p.axis === t.axis)!;
      expect(other).toBeDefined(); expect([other.enclosure, other.wallSide, other.roofPolicy, other.bounds]).toEqual([t.enclosure, t.wallSide, t.roofPolicy, t.bounds]);
    }
  }
  expect(flights).toBeGreaterThan(20); expect(parapets).toBeGreaterThan(0);
  expect([...roofs].sort()).toEqual(['flight', 'room', 'upper-slab']); expect([...enclosures].sort()).toEqual(['chamber', 'open', 'wall']);
}, 120000);

it('hangs every transition fixture level, under standing clearance', async () => {
  const THREE = await import('three'), { ceilingFixturePose } = await import('../render/CeilingFixture'); let checked = 0;
  for (let n = 0; n < 24; n++) {
    const w = generateInfiniteChunk(`REGIONAL-AUDIT-${n}`, { x: 0, z: 0, story: 0 });
    for (const t of w.spatial!.transitions!) {
      const slot = w.lights.find(l => l.id === `${t.id}/light`); if (!slot) continue;
      const p = new THREE.Vector3(), q = new THREE.Quaternion(); ceilingFixturePose(w, slot, p, q);
      const ys: number[] = [];
      for (const x of [-slot.width / 2, slot.width / 2]) for (const z of [-.5, .5]) {
        const corner = new THREE.Vector3(x, 0, z).applyQuaternion(q).add(p); ys.push(corner.y);
        const floor = w.topology!.surfaces.find(s => s.roomId === t.roomId && corner.x >= s.bounds.minX && corner.x <= s.bounds.maxX && corner.z >= s.bounds.minZ && corner.z <= s.bounds.maxZ)!;
        expect(floor).toBeDefined(); expect(corner.y - surfaceY(floor, corner.x, corner.z), `${w.seed}/${t.id}`).toBeGreaterThanOrEqual(2.5); checked++;
      }
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(.01);
    }
  }
  expect(checked).toBeGreaterThan(40);
}, 120000);
