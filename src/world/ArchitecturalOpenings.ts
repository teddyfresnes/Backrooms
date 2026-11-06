import { profilePrism, prismCollider } from './SpatialGeometry';
import type { SpatialAddress, SpatialPrism } from './SpatialTypes';
import type { HeightProfile } from './WalkableTopology';
import type { Rect, Vec3Data, WorldPlan } from './types';

export interface ArchitecturalOpening {
  min: number; max: number; bottom: number; height: number;
  shape: 'rect' | 'arch'; rise: number; segments: number;
  access: 'walk' | 'crouch' | 'view' | 'drop' | 'jump';
  destination?: { owner: SpatialAddress; surfaceId: string; position: Vec3Data };
}
export interface OpeningWall {
  id: string; bounds: Rect; axis: 'x' | 'z'; bottom: number; top: number;
  openings: ArchitecturalOpening[];
}
export interface LiminalArchitectureFeature {
  kind: 'liminal-architecture'; id: string; roomId: string; bounds: Rect;
  family: 'arcade' | 'grouped-passages' | 'partial-gallery';
  composition: string; walls: OpeningWall[]; floorLevels: number[];
  visibleSides: ('north' | 'south' | 'east' | 'west')[]; stairCount: number;
}

/** The sampled intrados is the one source for visible and physical geometry. */
export const openingProfile = (o: ArchitecturalOpening): { at: number; top: number }[] => {
  const count = o.shape === 'rect' ? 1 : Math.max(4, Math.min(12, Math.round(o.segments)));
  return Array.from({ length: count + 1 }, (_, i) => {
    const t = i / count;
    return { at: o.min + (o.max - o.min) * t,
      top: o.bottom + o.height - (o.shape === 'arch' ? o.rise * (1 - Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2))) : 0) };
  });
};
export const openingTopAt = (o: ArchitecturalOpening, at: number): number => {
  const profile = openingProfile(o);
  for (let i = 1; i < profile.length; i++) if (at <= profile[i]!.at + 1e-8) {
    const a = profile[i - 1]!, b = profile[i]!;
    return a.top + (b.top - a.top) * Math.max(0, Math.min(1, (at - a.at) / (b.at - a.at)));
  }
  return profile.at(-1)!.top;
};
const profile = (axis: 'x' | 'z', a: number, b: number): HeightProfile => Math.abs(a - b) < 1e-8
  ? { kind: 'flat', y: a } : { kind: 'linear', axis, startY: a, endY: b };

/** Extruded convex strips close front, rear, intrados and jambs. Multiple rows
 * share a single wall; coincident interior interfaces are removed by the worker. */
export const openingWallPrisms = (wall: OpeningWall): SpatialPrism[] => {
  const min = wall.axis === 'x' ? wall.bounds.minX : wall.bounds.minZ, max = wall.axis === 'x' ? wall.bounds.maxX : wall.bounds.maxZ;
  const events = [...new Set([min, max, ...wall.openings.flatMap(o => openingProfile(o).map(p => p.at))])]
    .filter(n => n >= min && n <= max).sort((a, b) => a - b);
  const result: SpatialPrism[] = [];
  for (let i = 1; i < events.length; i++) {
    const lo = events[i - 1]!, hi = events[i]!, mid = (lo + hi) / 2;
    if (hi - lo < 1e-5) continue;
    const voids = wall.openings.filter(o => mid > o.min && mid < o.max).sort((a, b) => a.bottom - b.bottom);
    let bottom = [wall.bottom, wall.bottom];
    const bounds = wall.axis === 'x' ? { ...wall.bounds, minX: lo, maxX: hi } : { ...wall.bounds, minZ: lo, maxZ: hi };
    const add = (top: number[]) => {
      if (Math.min(top[0]! - bottom[0]!, top[1]! - bottom[1]!) > 1e-5)
        result.push(profilePrism(`${wall.id}/strip-${i}-${result.length}`, bounds, profile(wall.axis, bottom[0]!, bottom[1]!), profile(wall.axis, top[0]!, top[1]!)));
    };
    for (const o of voids) { add([o.bottom, o.bottom]); bottom = [openingTopAt(o, lo), openingTopAt(o, hi)]; }
    add([wall.top, wall.top]);
  }
  return result;
};

export const appendOpeningWall = (w: WorldPlan, wall: OpeningWall): void => {
  for (const p of openingWallPrisms(wall)) {
    w.spatial!.prisms.push(p); w.colliders.push(prismCollider(p));
    const xs = p.vertices.filter((_, i) => i % 3 === 0), ys = p.vertices.filter((_, i) => i % 3 === 1), zs = p.vertices.filter((_, i) => i % 3 === 2);
    const lo = Math.min(...ys), hi = Math.max(...ys);
    w.walls.push({ id: p.id, x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2,
      orientation: wall.axis, length: wall.axis === 'x' ? Math.max(...xs) - Math.min(...xs) : Math.max(...zs) - Math.min(...zs),
      thickness: wall.axis === 'x' ? Math.max(...zs) - Math.min(...zs) : Math.max(...xs) - Math.min(...xs),
      bottom: lo, height: hi - lo, tint: 1, kind: 'wallpaper', collision: true, detail: 'architectural-opening' });
  }
};
