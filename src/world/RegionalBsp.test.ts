import { expect, it } from 'vitest';
import { generateInfiniteChunk } from './InfiniteWorld';
import { regionalAtrium, regionalDatum } from './RegionalPlan';
import { rectArea, rectDepth, rectWidth } from './types';
import { lightPanelOverlapsRect } from './generateWorld';

it('restores varied historical architecture in the actual ordinary entry point, with a majority of non-hall area', () => {
  let ordinaryArea = 0, hallArea = 0, thickLength = 0, wallLength = 0, crossCellRooms = 0, lights = 0;
  const dimensions = new Set<string>();
  for (let i = 0; i < 48; i++) {
    // The last 16 seeds are a holdout corpus distinct from the physical demos.
    const w = generateInfiniteChunk(`${i < 32 ? 'BSP-RESTORE' : 'BSP-HOLDOUT'}-${i}`, { x: 0, z: 0, story: 0 });
    expect(w.version).toBe(14);
    expect(w.rooms.some(r => r.id.includes('/quarter-'))).toBe(false);
    const united = new Map<string, { minX: number; maxX: number; minZ: number; maxZ: number }>();
    for (const r of w.rooms.filter(r => r.id.includes('/bsp/') || r.id.endsWith('/hall'))) {
      if (r.kind === 'open-hall') hallArea += rectArea(r.bounds); else ordinaryArea += rectArea(r.bounds);
      dimensions.add(`${rectWidth(r.bounds).toFixed(1)}/${rectDepth(r.bounds).toFixed(1)}`);
      if (!r.id.includes('/bsp/')) continue;
      const key = `${r.id.split('/bsp/')[1]}/${r.floorY}`, old = united.get(key);
      united.set(key, old ? { minX: Math.min(old.minX, r.bounds.minX), maxX: Math.max(old.maxX, r.bounds.maxX), minZ: Math.min(old.minZ, r.bounds.minZ), maxZ: Math.max(old.maxZ, r.bounds.maxZ) } : r.bounds);
    }
    crossCellRooms += [...united.values()].filter(b => rectWidth(b) > 28.1 || rectDepth(b) > 28.1).length;
    for (const wall of w.walls.filter(w => w.id.includes('/bsp/wall-') && w.height > 1.8)) { wallLength += wall.length; if (wall.thickness > .65) thickLength += wall.length; }
    for (const l of w.lights) {
      lights++; expect(l.unstable).toBe(false);
      expect(l.intensity).toBeGreaterThanOrEqual(.98);
      for (const wall of w.walls) {
        if (wall.bottom >= l.ceilingY + .12 || wall.bottom + wall.height <= l.ceilingY - .25) continue;
        const bounds = { minX: wall.x - (wall.orientation === 'x' ? wall.length : wall.thickness) / 2, maxX: wall.x + (wall.orientation === 'x' ? wall.length : wall.thickness) / 2,
          minZ: wall.z - (wall.orientation === 'z' ? wall.length : wall.thickness) / 2, maxZ: wall.z + (wall.orientation === 'z' ? wall.length : wall.thickness) / 2 };
        expect(lightPanelOverlapsRect(l, bounds), `${w.seed} ${l.id} through ${wall.id}`).toBe(false);
      }
    }
    // Cell boundaries within a plateau no longer receive a facade in maze mode.
    for (const cell of w.spatial!.cells.filter(c => c.mode === 'rooms')) {
      const m = /cell\/(-?\d+)\/(-?\d+)\//.exec(cell.id)!, x = Number(m[1]), z = Number(m[2]);
      for (const [side, dx, dz] of [['east', 1, 0], ['south', 0, 1]] as const) if (!regionalAtrium(w.seed, x + dx, z + dz, 0) && regionalDatum(w.seed, x + dx, z + dz).id === cell.regionId) {
        expect(w.walls.some(wall => wall.id.startsWith(`${cell.id}/facade-${side}`))).toBe(false);
      }
    }
  }
  const metrics = { ordinaryShare: ordinaryArea / (ordinaryArea + hallArea), thickWallLengthShare: thickLength / wallLength, dimensions: dimensions.size, crossCellRooms, lights };
  console.info('BSP_RESTORE_DISTRIBUTION', JSON.stringify(metrics));
  expect(metrics.ordinaryShare).toBeGreaterThan(.65); expect(metrics.ordinaryShare).toBeLessThan(.95);
  expect(metrics.thickWallLengthShare).toBeGreaterThan(.6);
  expect(dimensions.size).toBeGreaterThan(200); expect(crossCellRooms).toBeGreaterThan(20); expect(lights).toBeGreaterThan(1000);
}, 60000);

it('keeps all usable ordinary BSP floor connected to a real circulation or boundary opening', () => {
  for (let i = 0; i < 32; i++) {
    const w = generateInfiniteChunk(`BSP-CONNECTIVITY-${i}`, { x: 0, z: 0, story: 0 });
    const graph = new Map<string, string[]>(), add = (a: string, b: string) => graph.set(a, [...(graph.get(a) ?? []), b]);
    for (const c of w.topology!.connections) if (!c.toOwner && !['view', 'drop', 'jump'].includes(c.kind ?? '')) { add(c.from, c.to); if (c.direction === 'both') add(c.to, c.from); }
    const queue = w.topology!.connections.filter(c => c.toOwner && c.kind !== 'view').map(c => c.from), seen = new Set(queue);
    for (let j = 0; j < queue.length; j++) for (const to of graph.get(queue[j]!) ?? []) if (!seen.has(to)) { seen.add(to); queue.push(to); }
    const bad = w.topology!.surfaces.filter(s => s.role === 'floor' && rectWidth(s.bounds) > 1 && rectDepth(s.bounds) > 1 && !seen.has(s.id));
    expect(bad.map(s => ({ id: s.id, bounds: s.bounds })), w.seed).toEqual([]);
    for (const c of w.topology!.connections.filter(c => c.requiresDoorId)) expect(w.features.some(f => f.kind === 'interactive-door' && f.id === c.requiresDoorId)).toBe(true);
  }
}, 60000);
