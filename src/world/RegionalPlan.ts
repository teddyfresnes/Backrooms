import { SeededRandom } from './SeededRandom';
import { epicStructureIndexForCoord } from './EpicStructures';
import type { Rect } from './types';
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
export const clearRegionalPlanCache = () => datumCache.clear();
export const regionalCellId = (x: number, z: number, story: number) => `cell/${x}/${z}/${story}`;

export interface AtriumPlan { owner: number; lower: number; variant: 'L' | 'U' | 'bridge'; stairs: boolean }
/** An atrium is a three-address volume, not an extra floor in one room.
 * Only a single owner in each four-address vertical band may claim it.
 */
export const regionalAtrium = (seed: string, x: number, z: number, story: number): AtriumPlan | undefined => {
  const h = regionalDatum(seed, x, z); if (h.id === 'monument-interface') return;
  if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => regionalDatum(seed, x + dx!, z + dz!).id !== h.id)) return;
  const rng = randomAt(seed, `atrium:${x}:${z}`); if (!rng.chance(.19)) return;
  const phase = rng.int(0, 3), owner = Math.floor((story - phase + 2) / 4) * 4 + phase;
  if (story > owner || story < owner - 2) return;
  return { owner, lower: owner - 2, variant: rng.pick(['L', 'U', 'bridge'] as const), stairs: rng.chance(.8) };
};

/** Physical base at a world point, including inter-district approaches.
 * This inverse is used only when no mounted support or clearance volume owns the body.
 */
export const regionalBaseAt = (seed: string, x: number, z: number): number => {
  const c = spatialCellAt(x, z), b = spatialCellBounds(c.x, c.z), cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const h = regionalDatum(seed, c.x, c.z).y, dx = x - cx, dz = z - cz;
  const alongX = Math.abs(dz) <= SPATIAL_ROUTE_WIDTH / 2 && Math.abs(dx) >= 3;
  const alongZ = Math.abs(dx) <= SPATIAL_ROUTE_WIDTH / 2 && Math.abs(dz) >= 3;
  if (!alongX && !alongZ) return h;
  const sign = Math.sign(alongX ? dx : dz), next = regionalDatum(seed, c.x + (alongX ? sign : 0), c.z + (alongZ ? sign : 0)).y;
  const t = Math.max(0, Math.min(1, (Math.abs(alongX ? dx : dz) - 4) / 9));
  return h + ((h + next) / 2 - h) * t;
};
export const regionalOwnerAt = (seed: string, x: number, y: number, z: number): SpatialAddress => ({
  x: Math.floor((x + 56) / 112), z: Math.floor((z + 56) / 112),
  story: Math.floor((y - .865 - regionalBaseAt(seed, x, z) + ADDRESS_PITCH / 2) / ADDRESS_PITCH),
});
