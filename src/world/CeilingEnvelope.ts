import { profilePrism, profileY } from './SpatialGeometry';
import { cutRects } from './WalkableTopology';
import { surfaceY, surfaceUndersideY, type HeightProfile, type WalkableSurface } from './WalkableTopology';
import type { SpatialPrism } from './SpatialTypes';
import { rectWidth, rectDepth, type Rect, type WorldPlan } from './types';

const EPS = .001;
const restricted = (bounds: Rect, p: HeightProfile, r: Rect): HeightProfile => p.kind === 'flat' ? p
  : { ...p, startY: profileY(bounds, p, r.minX, r.minZ), endY: profileY(bounds, p, r.maxX, r.maxZ) };

/** Split at band crossings before clipping. Adjacent owners retain disjoint
 * solid bands even when one flight rises through more than a logical story. */
export const ownedProfilePrisms = (id: string, bounds: Rect, bottom: HeightProfile, top: HeightProfile, bandBottom: number, bandTop: number): SpatialPrism[] => {
  const xs = new Set([bounds.minX, bounds.maxX]), zs = new Set([bounds.minZ, bounds.maxZ]);
  for (const p of [bottom, top]) if (p.kind === 'linear' && Math.abs(p.endY - p.startY) > EPS) for (const y of [bandBottom, bandTop]) {
    const fraction = (y - p.startY) / (p.endY - p.startY);
    if (fraction <= EPS || fraction >= 1 - EPS) continue;
    (p.axis === 'x' ? xs : zs).add((p.axis === 'x' ? bounds.minX : bounds.minZ) + fraction * (p.axis === 'x' ? rectWidth(bounds) : rectDepth(bounds)));
  }
  const x = [...xs].sort((a, b) => a - b), z = [...zs].sort((a, b) => a - b), result: SpatialPrism[] = [];
  for (let ix = 0; ix < x.length - 1; ix++) for (let iz = 0; iz < z.length - 1; iz++) {
    const b = { minX: x[ix]!, maxX: x[ix + 1]!, minZ: z[iz]!, maxZ: z[iz + 1]! };
    const clip = (p: HeightProfile, lower: boolean): HeightProfile => {
      const r = restricted(bounds, p, b), clamp = (v: number) => lower ? Math.max(v, bandBottom) : Math.min(v, bandTop);
      return r.kind === 'flat' ? { kind: 'flat', y: clamp(r.y) } : { ...r, startY: clamp(r.startY), endY: clamp(r.endY) };
    };
    const lo = clip(bottom, true), hi = clip(top, false), gaps = [[b.minX, b.minZ], [b.minX, b.maxZ], [b.maxX, b.minZ], [b.maxX, b.maxZ]]
      .map(([px, pz]) => profileY(b, hi, px!, pz!) - profileY(b, lo, px!, pz!));
    if (Math.max(...gaps) <= EPS || Math.min(...gaps) < -EPS) continue;
    result.push(profilePrism(`${id}/${ix}-${iz}`, b, lo, hi, 'plaster'));
  }
  return result;
};

interface Edge { roof: WalkableSurface; axis: 'x' | 'z'; fixed: number; min: number; max: number; side: 'n' | 's' | 'w' | 'e'; sign: number; floor: number }
/** Seal exposed edges of a low ceiling into the actual neighbouring high roof.
 * A suspended 3cm tile is not a complete bulkhead. Never fill atrium voids,
 * intentional crawl tunnels, or facades between different regional datums. */
export const completeCeilingEnvelope = (world: WorldPlan, add: (p: SpatialPrism) => void): void => {
  const spatial = world.spatial!, bins = new Map<string, Edge[]>();
  for (const roof of spatial.ceilings) {
    if (roof.id.includes('/heritage/')) continue;
    const cell = spatial.cells.find(c => c.mode === 'rooms' && roof.roomId?.startsWith(`${c.id}/`));
    if (!cell) continue;
    const b = roof.bounds;
    for (const [side, axis, fixed, min, max, sign] of [['n', 'x', b.minZ, b.minX, b.maxX, -1], ['s', 'x', b.maxZ, b.minX, b.maxX, 1],
      ['w', 'z', b.minX, b.minZ, b.maxZ, -1], ['e', 'z', b.maxX, b.minZ, b.maxZ, 1]] as const) {
      const key = `${axis}/${Math.round(fixed * 1000)}/${Math.round(cell.floorY * 1000)}`, edges = bins.get(key) ?? [];
      edges.push({ roof, side, axis, fixed, min, max, sign, floor: cell.floorY }); bins.set(key, edges);
    }
  }
  for (const edges of bins.values()) for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const a = edges[i]!, b = edges[j]!;
    if (a.sign === b.sign || a.roof === b.roof || Math.abs(a.fixed - b.fixed) > EPS) continue;
    const min = Math.max(a.min, b.min), max = Math.min(a.max, b.max); if (max - min <= EPS) continue;
    for (const [lower, higher] of [[a, b], [b, a]]) {
      const point = (at: number) => lower!.axis === 'x' ? { x: at, z: lower!.fixed } : { x: lower!.fixed, z: at };
      const under = (roof: WalkableSurface, at: number) => { const p = point(at); return surfaceUndersideY(roof, p.x, p.z); };
      const gap = (at: number) => { const p = point(at); return under(higher!.roof, at) - surfaceY(lower!.roof, p.x, p.z); };
      let lo = min, hi = max; const g0 = gap(lo), g1 = gap(hi);
      if (Math.max(g0, g1) <= EPS) continue;
      if (Math.min(g0, g1) <= EPS) { const cross = lo + (hi - lo) * (EPS - g0) / (g1 - g0); if (g0 <= EPS) lo = cross; else hi = cross; }
      if (hi - lo <= EPS) continue;
      const r = lower!.roof.bounds, depth = Math.min(.12, (lower!.axis === 'x' ? rectDepth(r) : rectWidth(r)) / 2);
      const strip = lower!.axis === 'x'
        ? { minX: lo, maxX: hi, minZ: lower!.side === 'n' ? lower!.fixed : lower!.fixed - depth, maxZ: lower!.side === 'n' ? lower!.fixed + depth : lower!.fixed }
        : { minZ: lo, maxZ: hi, minX: lower!.side === 'w' ? lower!.fixed : lower!.fixed - depth, maxX: lower!.side === 'w' ? lower!.fixed + depth : lower!.fixed };
      const top: HeightProfile = Math.abs(under(higher!.roof, lo) - under(higher!.roof, hi)) < EPS ? { kind: 'flat', y: under(higher!.roof, lo) }
        : { kind: 'linear', axis: lower!.axis, startY: under(higher!.roof, lo), endY: under(higher!.roof, hi) };
      const bottom = restricted(lower!.roof.bounds, lower!.roof.profile, strip);
      const lowY = Math.min(profileY(strip, bottom, strip.minX, strip.minZ), profileY(strip, bottom, strip.maxX, strip.maxZ));
      const highY = Math.max(profileY(strip, top, strip.minX, strip.minZ), profileY(strip, top, strip.maxX, strip.maxZ));
      const occupied = world.walls.filter(w => w.bottom <= lowY + EPS && w.bottom + w.height >= highY - EPS).map(w => ({
        minX: w.x - (w.orientation === 'x' ? w.length : w.thickness) / 2, maxX: w.x + (w.orientation === 'x' ? w.length : w.thickness) / 2,
        minZ: w.z - (w.orientation === 'z' ? w.length : w.thickness) / 2, maxZ: w.z + (w.orientation === 'z' ? w.length : w.thickness) / 2 }));
      for (const [part, bounds] of cutRects([strip], occupied).entries())
        for (const prism of ownedProfilePrisms(`${lower!.roof.id}/ceiling-return-${lower!.side}-${i}-${j}-${part}`, bounds,
          restricted(strip, bottom, bounds), restricted(strip, top, bounds), lower!.floor - .16, lower!.floor + 5.24)) add(prism);
    }
  }
};
