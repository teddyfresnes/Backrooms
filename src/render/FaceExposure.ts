import { SLAB_INDICES } from '../world/WalkableTopology';

export type FaceExposure = (source: object, face: number) => readonly number[][] | undefined;
interface Face { source: object; index: number; polygon: number[]; axes: number[]; bounds: number[]; sign: number }
const EPS = 1e-7;
const corners = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
const area = (p: readonly number[], axes: readonly number[]) => {
  let a = 0;
  for (let i = 0; i < p.length; i += 3) { const j = (i + 3) % p.length; a += p[i + axes[0]!]! * p[j + axes[1]!]! - p[j + axes[0]!]! * p[i + axes[1]!]!; }
  return a / 2;
};

/** Clip in the face's projection, interpolating all three coordinates. This
 * retains sloping roofs and the trapezoidal cheeks of extruded ramp slabs. */
const halfPlane = (p: number[], a: number[], b: number[], axes: number[], sign: number, inside: boolean): number[] => {
  const distance = (v: number[]) => sign * ((b[axes[0]!]! - a[axes[0]!]!) * (v[axes[1]!]! - a[axes[1]!]!)
    - (b[axes[1]!]! - a[axes[1]!]!) * (v[axes[0]!]! - a[axes[0]!]!));
  const result: number[] = [];
  for (let i = 0; i < p.length; i += 3) {
    const v = p.slice(i, i + 3), j = (i + 3) % p.length, w = p.slice(j, j + 3), d = distance(v), e = distance(w);
    const keepV = inside ? d >= -EPS : d <= EPS, keepW = inside ? e >= -EPS : e <= EPS;
    if (keepV) result.push(...v);
    if (keepV !== keepW && Math.abs(d - e) > EPS) { const t = d / (d - e); result.push(...v.map((x, axis) => x + (w[axis]! - x) * t)); }
  }
  return result;
};
const subtract = (p: number[], cut: Face): number[][] => {
  let remaining = p; const result: number[][] = [], sign = Math.sign(area(cut.polygon, cut.axes));
  for (let i = 0; i < cut.polygon.length && remaining.length >= 9; i += 3) {
    const a = cut.polygon.slice(i, i + 3), j = (i + 3) % cut.polygon.length, b = cut.polygon.slice(j, j + 3);
    const outside = halfPlane(remaining, a, b, cut.axes, sign, false);
    if (outside.length >= 9 && Math.abs(area(outside, cut.axes)) > EPS) result.push(outside);
    remaining = halfPlane(remaining, a, b, cut.axes, sign, true);
  }
  return result;
};

/** One ownership pass across floors, ceilings and walls, before material
 * batching. Shared internal faces disappear on both sides; coincident outward
 * faces retain the first material. No depth offset or collision change. */
export const createFaceExposure = (solids: readonly { source: object; vertices: readonly number[] }[]): FaceExposure => {
  const planes = new Map<string, Face[]>(), result = new Map<object, Map<number, number[][]>>();
  for (const { source, vertices: v } of solids) for (const [index, ids] of corners.entries()) {
    const polygon = ids.flatMap(i => [v[i * 3]!, v[i * 3 + 1]!, v[i * 3 + 2]!]);
    const u = [0, 1, 2].map(i => polygon[i + 3]! - polygon[i]!), w = [0, 1, 2].map(i => polygon[i + 6]! - polygon[i]!);
    const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!], length = Math.hypot(...n);
    if (length < EPS) continue;
    const dominant = n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs))), sign = Math.sign(n[dominant]!);
    const normal = n.map(x => x / length * sign), d = normal.reduce((s, x, i) => s + x * polygon[i]!, 0);
    const key = [...normal, d].map(x => Math.round(x * 100000)).join('/'), axes = [0, 1, 2].filter(i => i !== dominant);
    const bounds = axes.flatMap(a => { const values = ids.map(i => v[i * 3 + a]!); return [Math.min(...values), Math.max(...values)]; });
    const faces = planes.get(key) ?? []; faces.push({ source, index, polygon, axes, bounds, sign }); planes.set(key, faces);
  }
  for (const faces of planes.values()) {
    // Broad phase in each plane. Most floor/roof fragments are disjoint, so
    // scanning the entire plateau for every face wastes worker preview time.
    const cells = new Map<string, number[]>();
    const keys = (bounds: number[]) => {
      const result: string[] = [];
      for (let z = Math.floor(bounds[2]! / 8); z <= Math.floor((bounds[3]! - EPS) / 8); z++)
        for (let x = Math.floor(bounds[0]! / 8); x <= Math.floor((bounds[1]! - EPS) / 8); x++) result.push(`${x}/${z}`);
      return result;
    };
    const faceCells = faces.map(f => keys(f.bounds));
    for (let i = 0; i < faces.length; i++) for (const key of faceCells[i]!) { const list = cells.get(key) ?? []; list.push(i); cells.set(key, list); }
    for (let i = 0; i < faces.length; i++) {
      const own = faces[i]!; let patches = [own.polygon], changed = false;
      const candidates = [...new Set(faceCells[i]!.flatMap(key => cells.get(key)!))].sort((a, b) => a - b);
      for (const j of candidates) {
        if (!patches.length) break;
        const other = faces[j]!;
        if (own.source === other.source || own.sign === other.sign && j >= i) continue;
        if (own.bounds[0]! >= other.bounds[1]! - EPS || own.bounds[1]! <= other.bounds[0]! + EPS
          || own.bounds[2]! >= other.bounds[3]! - EPS || own.bounds[3]! <= other.bounds[2]! + EPS) continue;
        const next = patches.flatMap(p => subtract(p, other));
        if (next.reduce((s, p) => s + Math.abs(area(p, own.axes)), 0) < patches.reduce((s, p) => s + Math.abs(area(p, own.axes)), 0) - EPS) { patches = next; changed = true; }
      }
      if (changed) { const saved = result.get(own.source) ?? new Map<number, number[][]>(); saved.set(own.index, patches); result.set(own.source, saved); }
    }
  }
  return (source, face) => result.get(source)?.get(face);
};

export const faceTriangles = (vertices: readonly number[], face: number, fragments?: readonly number[][]): number[] => {
  if (!fragments) return SLAB_INDICES.slice(face * 6, face * 6 + 6).flatMap(i => [vertices[i * 3]!, vertices[i * 3 + 1]!, vertices[i * 3 + 2]!]);
  return fragments.flatMap(p => {
    const triangles: number[] = [];
    for (let i = 3; i < p.length - 3; i += 3) triangles.push(...p.slice(0, 3), ...p.slice(i, i + 6));
    return triangles;
  });
};
