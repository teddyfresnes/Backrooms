import { slabVertices, type WalkableSurface } from '../world/WalkableTopology';
interface Edge { surface: WalkableSurface; face: number; lo: number; hi: number; bottom: number; top: number; sign: number; key: string }
const sides = [[0, 1, 4, 5, 'x', -1], [1, 2, 5, 6, 'z', 1], [2, 3, 6, 7, 'x', 1], [3, 0, 7, 4, 'z', -1]] as const;
/** Cull common solid faces in bounded coordinate bins. A slab above a passage
 * cannot hide the lower wall: coverage includes the underside height. */
export const surfaceExposure = (surfaces: readonly WalkableSurface[]): ((s: WalkableSurface, face: number, v: number[]) => number[] | undefined) => {
  const bins = new Map<string, Edge[]>(), byFace = new Map<string, Edge>();
  for (const surface of surfaces) {
    const v = slabVertices(surface);
    for (const [face, [a, b, c, d, axis, sign]] of sides.entries()) {
      const fixedAxis = axis === 'x' ? 0 : 2, alongAxis = axis === 'x' ? 2 : 0, ids = [a, b, c, d];
      const fixed = ids.map(i => v[i * 3 + fixedAxis]!);
      if (Math.max(...fixed) - Math.min(...fixed) > .0001) continue;
      const key = `${axis}/${Math.round(fixed[0]! * 10000)}`;
      const edge: Edge = { surface, face, key, sign, lo: Math.min(...ids.map(i => v[i * 3 + alongAxis]!)), hi: Math.max(...ids.map(i => v[i * 3 + alongAxis]!)),
        bottom: Math.max(v[c * 3 + 1]!, v[d * 3 + 1]!), top: Math.min(v[a * 3 + 1]!, v[b * 3 + 1]!) };
      const list = bins.get(key) ?? []; list.push(edge); bins.set(key, list); byFace.set(`${surface.id}/${face}`, edge);
    }
  }
  return (surface, face, vertices) => {
    const own = byFace.get(`${surface.id}/${face}`); if (!own) return vertices;
    const [a, b, c, d] = sides[face]!, ownLow = Math.min(vertices[c * 3 + 1]!, vertices[d * 3 + 1]!), ownHigh = Math.max(vertices[a * 3 + 1]!, vertices[b * 3 + 1]!);
    const neighbors = bins.get(own.key)!.filter(e => e.surface !== surface && e.sign !== own.sign && e.bottom <= ownLow + .0001 && e.hi > own.lo && e.lo < own.hi);
    let gaps = [{ lo: own.lo, hi: own.hi }];
    for (const e of neighbors.filter(e => e.top >= ownHigh - .0001)) gaps = gaps.flatMap(g => e.hi <= g.lo || e.lo >= g.hi ? [g]
      : [{ lo: g.lo, hi: Math.min(g.hi, e.lo) }, { lo: Math.max(g.lo, e.hi), hi: g.hi }].filter(v => v.hi - v.lo > .0001));
    if (!gaps.length) return;
    const cut = neighbors.filter(e => e.lo <= own.lo + .0001 && e.hi >= own.hi - .0001 && e.top < own.top - .0001)
      .reduce((height, e) => Math.max(height, e.top), ownLow);
    if (cut <= ownLow + .0001) return vertices;
    const result = [...vertices]; result[c * 3 + 1] = Math.max(result[c * 3 + 1]!, cut); result[d * 3 + 1] = Math.max(result[d * 3 + 1]!, cut);
    return result;
  };
};
