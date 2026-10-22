import { planRegionalTransition } from './TransitionLayout';
import { SeededRandom } from './SeededRandom';
import { epicStructureIndexForCoord } from './EpicStructures';
import { pointInRect, type Rect } from './types';
import type { SpatialAddress } from './SpatialTypes';

export const SPATIAL_VERSION = 2;
export const SPATIAL_CELL_SIZE = 28;
export const SPATIAL_CHUNK_SIZE = 112;
export const ADDRESS_PITCH = 5.4;
export const SPATIAL_CLEARANCE = 3.05;
export const SPATIAL_ROUTE_WIDTH = 4;
const REGION_CELLS = 6;
const q = (v: number) => Math.round(v * 20) / 20;
const randomAt = (seed: string, key: string) => new SeededRandom(`${seed}::regional-space:v${SPATIAL_VERSION}:${key}`);
const coordForCell = (x: number, z: number): SpatialAddress => ({ x: Math.floor(x / 4), z: Math.floor(z / 4), story: 0 });
export const spatialCellAt = (x: number, z: number) => ({ x: Math.floor((x + 56) / 28), z: Math.floor((z + 56) / 28) });
export const spatialCellBounds = (x: number, z: number): Rect => ({ minX: x * 28 - 56, maxX: x * 28 - 28, minZ: z * 28 - 56, maxZ: z * 28 - 28 });

export interface RegionalDatum { id: string; y: number }
const datumCache = new Map<string, RegionalDatum>();
/** A world-space Voronoi district, shared by all chunks and independent of stories.
 * The 168m sites make plateaus span tens of rooms and multiple source chunks.
 * Their datums are quantized continuous draws, never offsets from a default floor.
 */
export const regionalDatum = (seed: string, x: number, z: number): RegionalDatum => {
  const key = `${seed}:${x}:${z}`, cached = datumCache.get(key); if (cached) return cached;
  const chunk = coordForCell(x, z);
  // The explicit compatibility collar preserves the existing monumental entrances.
  // Only cells adjacent to an epic column use that monument's fixed datum.
  const protectedColumn = epicStructureIndexForCoord(seed, chunk) !== null ||
    (x % 4 === 0 && epicStructureIndexForCoord(seed, { ...chunk, x: chunk.x - 1 }) !== null) ||
    ((x % 4 + 4) % 4 === 3 && epicStructureIndexForCoord(seed, { ...chunk, x: chunk.x + 1 }) !== null) ||
    (z % 4 === 0 && epicStructureIndexForCoord(seed, { ...chunk, z: chunk.z - 1 }) !== null) ||
    ((z % 4 + 4) % 4 === 3 && epicStructureIndexForCoord(seed, { ...chunk, z: chunk.z + 1 }) !== null);
  let result: RegionalDatum = { id: 'monument-interface', y: 0 };
  if (!protectedColumn) {
    const rx = Math.floor(x / REGION_CELLS), rz = Math.floor(z / REGION_CELLS); let closest = Infinity;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const ax = rx + dx, az = rz + dz, rng = randomAt(seed, `district:${ax}:${az}`);
      const px = ax * REGION_CELLS + rng.float(.7, 5.3), pz = az * REGION_CELLS + rng.float(.7, 5.3);
      const distance = (x + .5 - px) ** 2 + (z + .5 - pz) ** 2;
      if (distance < closest) { closest = distance; result = { id: `district/${ax}/${az}`, y: q(rng.float(-7.5, 7.5)) }; }
    }
  }
  datumCache.set(key, result); if (datumCache.size > 2048) datumCache.delete(datumCache.keys().next().value!);
  return result;
};
export const regionalStyle = (seed: string, regionId: string) => {
  const rng = new SeededRandom(`${seed}:spatial-style:v2:${regionId}`);
  return { family: rng.weighted([{ value: 'maze' as const, weight: .88 }, { value: 'hall' as const, weight: .08 }, { value: 'pillars' as const, weight: .04 }]),
    wallHalf: rng.weighted([{ value: .12, weight: .12 }, { value: .6, weight: .58 }, { value: 1.2, weight: .3 }]) };
};
const transitionCache = new Map<string, boolean>();
/** One isolated connection wins a bounded neighbourhood. Both endpoints and
 * every vertical owner derive the same decision without reading a chunk. */
export const hasRegionalTransition = (seed: string, x: number, z: number, side: 'north' | 'east' | 'south' | 'west'): boolean => {
  const axis = side === 'east' || side === 'west' ? 'x' : 'z';
  const ax = x - Number(side === 'west'), az = z - Number(side === 'north');
  const key = `${seed}/${ax}/${az}/${axis}`, cached = transitionCache.get(key);
  if (cached !== undefined) return cached;
  const candidate = (gx: number, gz: number, a: 'x' | 'z') => {
    if (Math.abs(regionalDatum(seed, gx, gz).y - regionalDatum(seed, gx + Number(a === 'x'), gz + Number(a === 'z')).y) < .001) return;
    return { x: gx + (a === 'x' ? 1 : .5), z: gz + (a === 'z' ? 1 : .5),
      rank: new SeededRandom(`${seed}:isolated-transition:v1:${gx}:${gz}:${a}`).float(0, 1), id: `${gx}/${gz}/${a}` };
  };
  const own = candidate(ax, az, axis); let selected = own !== undefined;
  if (own) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) for (const a of ['x', 'z'] as const) {
    const other = candidate(ax + dx, az + dz, a);
    if (!other || other.id === own.id || Math.hypot(own.x - other.x, own.z - other.z) >= 1.75) continue;
    if (other.rank < own.rank || other.rank === own.rank && other.id < own.id) selected = false;
  }
  transitionCache.set(key, selected); if (transitionCache.size > 2048) transitionCache.delete(transitionCache.keys().next().value!);
  return selected;
};
export const clearRegionalPlanCache = () => { datumCache.clear(); transitionCache.clear(); };
export const regionalCellId = (x: number, z: number, story: number) => `cell/${x}/${z}/${story}`;

export interface AtriumPlan {
  owner: number; lower: number; variant: 'L' | 'U' | 'bridge'; stairs: boolean;
  anchorX: number; anchorZ: number; cellsX: number; cellsZ: number;
  ringWidth: number; routeWidth: number; midFraction: number;
  routeKind: 'ramp' | 'stairs'; openLower: boolean;
  composition: 'gallery' | 'terraces' | 'mounds';
}
/** Canonical 2x2 planning domains choose one 1..4-cell room. Domains align
 * with chunk boundaries; its clipped BSP neighbours need no generated state. */
export const regionalAtrium = (seed: string, x: number, z: number, story: number): AtriumPlan | undefined => {
  const ax = Math.floor(x / 2) * 2, az = Math.floor(z / 2) * 2;
  const rng = randomAt(seed, `atrium-room:v3:${ax}:${az}`);
  if (!rng.chance(.5)) return;
  const shape = rng.weighted([{ value: [1, 1], weight: .4 }, { value: [2, 1], weight: .25 },
    { value: [1, 2], weight: .2 }, { value: [2, 2], weight: .15 }]);
  const cellsX = shape[0]!, cellsZ = shape[1]!;
  const anchorX = ax + (cellsX === 1 ? rng.int(0, 1) : 0), anchorZ = az + (cellsZ === 1 ? rng.int(0, 1) : 0);
  if (x < anchorX || z < anchorZ || x >= anchorX + cellsX || z >= anchorZ + cellsZ) return;
  const datum = regionalDatum(seed, anchorX, anchorZ);
  if (datum.id === 'monument-interface') return;
  for (let iz = anchorZ - 1; iz <= anchorZ + cellsZ; iz++) for (let ix = anchorX - 1; ix <= anchorX + cellsX; ix++) {
    // Only cells sharing a facade need its datum. Rejecting the four diagonal
    // corners unnecessarily suppressed big rooms near a jagged district edge.
    if ((ix < anchorX || ix >= anchorX + cellsX) && (iz < anchorZ || iz >= anchorZ + cellsZ)) continue;
    if (regionalDatum(seed, ix, iz).id !== datum.id) return;
  }
  const phase = rng.int(0, 3), owner = Math.floor((story - phase + 2) / 4) * 4 + phase;
  const depth = rng.fork('depth').weighted([{ value: 1, weight: .28 }, { value: 2, weight: .72 }]);
  if (story > owner || story < owner - depth) return;
  return { owner, lower: owner - depth, anchorX, anchorZ, cellsX, cellsZ,
    variant: rng.fork('circulation-variant').pick(['L', 'U', 'bridge'] as const), stairs: rng.chance(.8),
    ringWidth: rng.float(2.7, 4.8), routeWidth: rng.float(2.4, 3.8), midFraction: rng.float(.4, .6),
    routeKind: rng.chance(.55) ? 'ramp' : 'stairs', openLower: rng.chance(.6),
    composition: rng.weighted([{ value: 'gallery' as const, weight: .55 }, { value: 'terraces' as const, weight: .25 }, { value: 'mounds' as const, weight: .2 }]) };
};

/** Physical base at a world point, including inter-district approaches.
 * This inverse is used only when no mounted support or clearance volume owns the body.
 */
export const regionalBaseAt = (seed: string, x: number, z: number): number => {
  const c = spatialCellAt(x, z), b = spatialCellBounds(c.x, c.z), h = regionalDatum(seed, c.x, c.z).y;
  for (const [side, dx, dz] of [['north', 0, -1], ['east', 1, 0], ['south', 0, 1], ['west', -1, 0]] as const) {
    const next = regionalDatum(seed, c.x + dx, c.z + dz).y; if (Math.abs(next - h) < .001) continue;
    if (!hasRegionalTransition(seed, c.x, c.z, side)) continue;
    const t = planRegionalTransition(seed, c.x, c.z, 0, side, b, h, next, 'inverse');
    if (!pointInRect(x, z, t.bounds)) continue;
    if (pointInRect(x, z, t.approach.bounds)) return t.approach.y;
    if (pointInRect(x, z, t.landing.bounds)) return t.landing.y;
    const along = t.axis === 'x' ? x - t.run.minX : z - t.run.minZ;
    const run = t.axis === 'x' ? t.run.maxX - t.run.minX : t.run.maxZ - t.run.minZ;
    return t.startY + (t.endY - t.startY) * Math.max(0, Math.min(1, along / run));
  }
  return h;
};
export const regionalOwnerAt = (seed: string, x: number, y: number, z: number): SpatialAddress => ({
  x: Math.floor((x + 56) / 112), z: Math.floor((z + 56) / 112),
  story: Math.floor((y - .865 - regionalBaseAt(seed, x, z) + ADDRESS_PITCH / 2) / ADDRESS_PITCH),
});
