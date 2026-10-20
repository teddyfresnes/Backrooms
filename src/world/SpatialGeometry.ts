import type { Rect, StaticCollider } from './types';
import { SLAB_INDICES, surfaceY, type HeightProfile, type WalkableSurface } from './WalkableTopology';
import type { SpatialPrism } from './SpatialTypes';

export const profileY = (bounds: Rect, profile: HeightProfile, x: number, z: number): number =>
  surfaceY({ bounds, profile } as WalkableSurface, x, z);
export const offsetProfile = (p: HeightProfile, y: number): HeightProfile => p.kind === 'flat'
  ? { kind: 'flat', y: p.y + y } : { ...p, startY: p.startY + y, endY: p.endY + y };
export const profilePrism = (id: string, bounds: Rect, bottom: HeightProfile, top: HeightProfile,
  material: SpatialPrism['material'] = 'wall', collision = true): SpatialPrism => {
  const vertices: number[] = [];
  for (const p of [top, bottom]) for (const [x, z] of [[bounds.minX, bounds.minZ], [bounds.minX, bounds.maxZ], [bounds.maxX, bounds.maxZ], [bounds.maxX, bounds.minZ]])
    vertices.push(x!, profileY(bounds, p, x!, z!), z!);
  return { id, vertices, material, collision };
};
export const prismCollider = (p: SpatialPrism, kind: StaticCollider['kind'] = 'wall'): StaticCollider => {
  const v = p.vertices, range = (axis: number) => v.filter((_, i) => i % 3 === axis);
  const xs = range(0), ys = range(1), zs = range(2);
  const center = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 };
  return { id: p.id, kind, center, halfExtents: { x: (Math.max(...xs) - Math.min(...xs)) / 2, y: (Math.max(...ys) - Math.min(...ys)) / 2, z: (Math.max(...zs) - Math.min(...zs)) / 2 },
    vertices: v.map((n, i) => n - (i % 3 === 0 ? center.x : i % 3 === 1 ? center.y : center.z)), indices: [...SLAB_INDICES] };
};

/** Treads share their exact solids with Rapier; no invisible inclined proxy. */
export const endpointStairRun = (bounds: Rect, axis: 'x' | 'z', startY: number, endY: number,
  maxRiser = .175): { bounds: Rect; profile: HeightProfile; index: number; count: number }[] => {
  const count = Math.max(1, Math.ceil(Math.abs(endY - startY) / maxRiser));
  const min = axis === 'x' ? bounds.minX : bounds.minZ, max = axis === 'x' ? bounds.maxX : bounds.maxZ;
  return Array.from({ length: count }, (_, index) => ({ index, count,
    bounds: axis === 'x' ? { ...bounds, minX: min + (max - min) * index / count, maxX: min + (max - min) * (index + 1) / count }
      : { ...bounds, minZ: min + (max - min) * index / count, maxZ: min + (max - min) * (index + 1) / count },
    profile: { kind: 'flat' as const, y: startY + (endY - startY) * (index + .5) / count },
  }));
};
