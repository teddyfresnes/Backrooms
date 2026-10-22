import type { SpatialPrism } from '../world/SpatialTypes';
import { cutRects } from '../world/WalkableTopology';
import { SLAB_INDICES } from '../world/WalkableTopology';
import type { Rect } from '../world/types';

export interface PrismFacePatches { axes: [number, number]; source: Rect; patches: Rect[] }
export type PrismExposure = (prism: SpatialPrism, face: number) => PrismFacePatches | undefined;

/** Coplanar BSP partitions, facade ends and trims must own each pixel once.
 * Cut the overlapping rectangles rather than offsetting their depth. Sloping
 * and trapezoidal faces retain their exact original vertices. */
export const prismExposure = (prisms: readonly SpatialPrism[]): PrismExposure => {
  const planes = new Map<string, Rect[]>(), result = new Map<SpatialPrism, Map<number, PrismFacePatches>>();
  for (const prism of prisms) for (let face = 0; face < 6; face++) {
    const indices = [...new Set(SLAB_INDICES.slice(face * 6, face * 6 + 6))], v = prism.vertices;
    const ranges = [0, 1, 2].map(axis => indices.map(i => v[i * 3 + axis]!));
    const fixed = ranges.findIndex(r => Math.max(...r) - Math.min(...r) < .000001);
    if (fixed < 0) continue;
    const axes = [0, 1, 2].filter(a => a !== fixed) as [number, number];
    const [a, b] = axes.map(axis => ({ min: Math.min(...ranges[axis]!), max: Math.max(...ranges[axis]!) }));
    if (a!.max - a!.min < .000001 || b!.max - b!.min < .000001) continue;
    if (indices.some(i => axes.some((axis, k) => Math.min(Math.abs(v[i * 3 + axis]! - [a, b][k]!.min), Math.abs(v[i * 3 + axis]! - [a, b][k]!.max)) > .000001))) continue;
    const tri = SLAB_INDICES.slice(face * 6, face * 6 + 3), u = [0, 1, 2].map(axis => v[tri[1]! * 3 + axis]! - v[tri[0]! * 3 + axis]!);
    const w = [0, 1, 2].map(axis => v[tri[2]! * 3 + axis]! - v[tri[0]! * 3 + axis]!);
    const normal = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    const key = `${fixed}/${Math.sign(normal[fixed]!)}/${Math.round(ranges[fixed]![0]! * 100000)}`;
    const source = { minX: a!.min, maxX: a!.max, minZ: b!.min, maxZ: b!.max }, previous = planes.get(key) ?? [];
    const overlapping = previous.filter(r => r.minX < source.maxX - .000001 && r.maxX > source.minX + .000001 && r.minZ < source.maxZ - .000001 && r.maxZ > source.minZ + .000001);
    if (overlapping.length) {
      const faces = result.get(prism) ?? new Map<number, PrismFacePatches>();
      faces.set(face, { axes, source, patches: cutRects([source], overlapping) }); result.set(prism, faces);
    }
    previous.push(source); planes.set(key, previous);
  }
  return (prism, face) => result.get(prism)?.get(face);
};
