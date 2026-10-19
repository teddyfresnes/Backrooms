import { describe, expect, it } from 'vitest';
import { cleanWallJunctions } from './WallJunctions';
import type { ColumnSlot, WallSegment, WorldPlan } from './types';

const wall = (id: string, overrides: Partial<WallSegment> = {}): WallSegment => ({
  id, x: 0, z: 0, orientation: 'x', length: 8, thickness: 1, bottom: 0,
  height: 3, tint: 1, collision: true, kind: 'wallpaper', ...overrides,
});
const planWith = (walls: WallSegment[], columns: ColumnSlot[] = [], seed = 'CLEAN-JUNCTIONS'): WorldPlan => ({
  version: 10, seed, size: 112, wallHeight: 3, rooms: [], walls, columns,
  solidMasses: [], lights: [], missingCeilingTiles: [], features: [], detailSockets: [],
  floorRects: [], spawn: { x: 0, y: 1, z: 0 },
  colliders: [
    ...walls.map(w => ({ id: `collider-${w.id}`, kind: 'wall' as const,
      center: { x: w.x, y: 1.5, z: w.z }, halfExtents: {
        x: (w.orientation === 'x' ? w.length : w.thickness) / 2, y: 1.5,
        z: (w.orientation === 'z' ? w.length : w.thickness) / 2,
      } })),
    ...columns.map((c, i) => ({ id: `column-${i}`, kind: 'column' as const,
      center: { x: c.x, y: c.height / 2, z: c.z },
      halfExtents: { x: c.width / 2, y: c.height / 2, z: c.depth / 2 } })),
  ],
});
const covers = (w: WallSegment, x: number, z: number) =>
  Math.abs(x - w.x) <= (w.orientation === 'x' ? w.length : w.thickness) / 2 + 1e-6
  && Math.abs(z - w.z) <= (w.orientation === 'z' ? w.length : w.thickness) / 2 + 1e-6;

function expectCollidersMatch(plan: WorldPlan) {
  for (const w of plan.walls) {
    const c = plan.colliders.find(c => c.id === `collider-${w.id}`)!;
    expect(c.center.x).toBe(w.x);
    expect(c.center.z).toBe(w.z);
    expect(c.halfExtents.x).toBe((w.orientation === 'x' ? w.length : w.thickness) / 2);
    expect(c.halfExtents.z).toBe((w.orientation === 'z' ? w.length : w.thickness) / 2);
  }
}

describe('clean architectural wall junctions', () => {
  it.each([-1, 1].flatMap(x => [-1, 1].map(z => [x, z])))('closes the recessed L corner in quadrant %s, %s with matching collisions', (sx, sz) => {
    const plan = planWith([
      wall('horizontal', { x: -sx * 2, length: 4, thickness: 1.2 }),
      wall('vertical', { z: -sz * 2, orientation: 'z', length: 4, thickness: .8 }),
    ]);
    cleanWallJunctions(plan);
    // Formerly this exterior corner was a small square recess.
    expect(plan.walls.some(w => covers(w, sx * .35, sz * .55))).toBe(true);
    expect(plan.walls.map(w => w.id)).toEqual(['horizontal', 'vertical']);
    expectCollidersMatch(plan);
    const once = structuredClone(plan);
    cleanWallJunctions(plan);
    expect(plan).toEqual(once);
  });

  it('removes a nearly buried wall fragment and its collider, retaining a substantial return', () => {
    const plan = planWith([
      wall('host', { orientation: 'z', thickness: 1.3 }),
      wall('nib', { x: .325, length: .79, thickness: .3 }),
      wall('real-return', { x: 1.2, z: 2, length: 2.4, thickness: .3 }),
    ]);
    cleanWallJunctions(plan);
    expect(plan.walls.some(w => w.id === 'nib')).toBe(false);
    expect(plan.colliders.some(c => c.id === 'collider-nib')).toBe(false);
    expect(plan.walls.find(w => w.id === 'real-return')?.length).toBe(2.4);
    expectCollidersMatch(plan);
  });

  it('makes centimetre shoulders rare while preserving deterministic variation', () => {
    let retained = 0;
    for (let i = 0; i < 240; i++) {
      const make = () => planWith([
        wall('long', { x: -2, length: 4 }),
        wall('short', { x: 1, z: .02, length: 2, thickness: 1.04 }),
      ], [], `SHOULDER-${i}`);
      const plan = make(), repeat = make();
      cleanWallJunctions(plan); cleanWallJunctions(repeat);
      expect(plan).toEqual(repeat);
      if (plan.walls[1]!.z !== 0) retained++;
      else expect(plan.walls[1]!.thickness).toBe(1);
      expectCollidersMatch(plan);
    }
    expect(retained).toBeGreaterThan(0);
    expect(retained).toBeLessThan(20);
  });

  it('removes buried pilaster strips, keeping real columns and visible architectural bays', () => {
    const plan = planWith([wall('host', { thickness: 1.4 })], [
      { x: -2, z: .4, width: .9, depth: .64, height: 3, tint: 1, kind: 'pilaster' },
      { x: 0, z: .5, width: 1.2, depth: 1.2, height: 3, tint: 1, kind: 'pilaster' },
      { x: 2, z: .4, width: .9, depth: .64, height: 3, tint: 1, kind: 'column' },
    ]);
    cleanWallJunctions(plan);
    expect(plan.columns.map(c => c.x)).toEqual([0, 2]);
    expect(plan.colliders.filter(c => c.kind === 'column').map(c => c.center.x)).toEqual([0, 2]);
    const once = structuredClone(plan);
    cleanWallJunctions(plan);
    expect(plan).toEqual(once);
  });

  it('leaves boundary seams, authored details and door-bearing walls alone', () => {
    const protectedWall = wall('door-host', { orientation: 'z' });
    const plan = planWith([
      protectedWall, wall('door-nib', { x: .25, length: .6, thickness: .3 }),
      wall('boundary', { z: 56 }), wall('detail', { x: 4, detail: 'crawl-tunnel' }),
    ]);
    plan.features = [{ kind: 'interactive-door', bounds: { minX: -.6, maxX: .6, minZ: -.2, maxZ: .2 } } as WorldPlan['features'][number]];
    const before = structuredClone(plan);
    cleanWallJunctions(plan);
    expect(plan).toEqual(before);
  });

  it('removes barely exposed decorative corner posts as one mirrored group, keeping structural columns', () => {
    const columns = [-3, -1, 1, 3, 0].map(x => ({ x, z: .4, width: .9, depth: .64, height: 3, tint: 1, kind: 'column' as const }));
    const plan = planWith([wall('host', { thickness: 1.4 })], columns);
    plan.colliders.filter(c => c.kind === 'column').slice(0, 4).forEach((c, i) => { c.id = `formal-corner-hall-${i}`; });
    cleanWallJunctions(plan);
    expect(plan.columns.map(c => c.x)).toEqual([0]);
    expect(plan.colliders.filter(c => c.kind === 'column').map(c => c.center.x)).toEqual([0]);
  });
});
