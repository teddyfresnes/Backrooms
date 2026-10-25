import { generateBspArchitecture } from './generateWorld';
import { regionalDatum, regionalStyle } from './RegionalPlan';
import { overlapRect } from './WalkableTopology';
import type { Rect, WorldPlan } from './types';
import type { TransitionLayout } from './TransitionLayout';

const templates = new Map<string, WorldPlan>();
export const clearSpatialTemplates = () => templates.clear();
export const spatialTemplate = (seed: string, chunkX: number, chunkZ: number, story: number): WorldPlan => {
  const key = `${seed}:bsp-district:v1:${Math.floor(chunkX / 2)}:${Math.floor(chunkZ / 2)}:${story}`;
  let plan = templates.get(key);
  if (!plan) { plan = generateBspArchitecture(key); templates.set(key, plan); if (templates.size > 32) templates.delete(templates.keys().next().value!); }
  return plan;
};

/** Resolve the real BSP behind an endpoint without generating its neighbour.
 * The same canonical template and shift are used by SpatialWorld itself. */
export const transitionHost = (seed: string, gx: number, gz: number, story: number, t: TransitionLayout, origin: { x: number; z: number }) => {
  const chunkX = Math.floor(gx / 4), chunkZ = Math.floor(gz / 4), floor = regionalDatum(seed, gx, gz).y;
  const shift = { x: Math.floor(chunkX / 2) * 224 + 56 - origin.x, z: Math.floor(chunkZ / 2) * 224 + 56 - origin.z };
  const move = (r: Rect): Rect => ({ minX: r.minX + shift.x, maxX: r.maxX + shift.x, minZ: r.minZ + shift.z, maxZ: r.maxZ + shift.z });
  if (regionalStyle(seed, regionalDatum(seed, gx, gz).id).family !== 'maze') return { ceilingY: floor + 2.74, walls: [0, 0] as [number, number] };
  const template = spatialTemplate(seed, chunkX, chunkZ, story);
  const rooms = template.rooms.filter(r => overlapRect(move(r.bounds), t.approach.bounds));
  const ceilingY = floor + Math.min(...(rooms.length ? rooms.map(r => r.ceilingHeight) : [3.05]));
  // Enclosures are a column decision: inspect canonical structural walls at
  // story zero so adjacent vertical owners never invent different side walls.
  const structure = story === 0 ? template : spatialTemplate(seed, chunkX, chunkZ, 0);
  const alongX = t.axis === 'x', lo = alongX ? t.bounds.minX : t.bounds.minZ, hi = alongX ? t.bounds.maxX : t.bounds.maxZ;
  const coverage = (sign: number) => {
    const cross = alongX ? sign < 0 ? t.bounds.minZ : t.bounds.maxZ : sign < 0 ? t.bounds.minX : t.bounds.maxX;
    const intervals = structure.walls.filter(w => w.orientation === t.axis && w.bottom < .1 && w.height > 2).flatMap(w => {
      const wc = (alongX ? w.z + shift.z : w.x + shift.x), center = alongX ? w.x + shift.x : w.z + shift.z;
      if (Math.abs(wc - cross) > w.thickness / 2 + .4) return [];
      return [{ lo: Math.max(lo, center - w.length / 2), hi: Math.min(hi, center + w.length / 2) }].filter(r => r.hi > r.lo);
    }).sort((a, b) => a.lo - b.lo);
    let end = lo, length = 0;
    for (const r of intervals) { length += Math.max(0, r.hi - Math.max(end, r.lo)); end = Math.max(end, r.hi); }
    return Math.min(1, length / Math.max(.01, hi - lo));
  };
  return { ceilingY, walls: [coverage(-1), coverage(1)] as [number, number] };
};
