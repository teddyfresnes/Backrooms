import type { Rect, WallSegment, WorldPlan } from './types';
import { cutRects, overlapRect } from './WalkableTopology';

const footprint = (w: WallSegment): Rect => ({
  minX: w.x - (w.orientation === 'x' ? w.length : w.thickness) / 2, maxX: w.x + (w.orientation === 'x' ? w.length : w.thickness) / 2,
  minZ: w.z - (w.orientation === 'z' ? w.length : w.thickness) / 2, maxZ: w.z + (w.orientation === 'z' ? w.length : w.thickness) / 2,
});

/** Reconcile imported upper shells after the regional reservations and doors
 * have changed their bearing walls. A high pier cannot exceed its support. */
export const reconcileStructuralSupports = (world: WorldPlan, add: (id: string, b: Rect, bottom: number, top: number, tint: number, detail?: WallSegment['detail']) => void): void => {
  const lintels = world.walls.filter(w => w.detail === 'upper-portal-lintel');
  const anchoredEnd = (beam: WallSegment, sign: -1 | 1, visited = new Set<WallSegment>()): boolean => {
    if (visited.has(beam)) return false;
    visited.add(beam);
    const alongX = beam.orientation === 'x', b = footprint(beam), end = alongX ? sign < 0 ? b.minX : b.maxX : sign < 0 ? b.minZ : b.maxZ;
    if (Math.abs(Math.abs(end) - world.size / 2) < .002) return true; // canonical continuation into the next chunk
    const crossMin = alongX ? b.minZ : b.minX, crossMax = alongX ? b.maxZ : b.maxX;
    const touching = (wall: WallSegment) => {
      const r = footprint(wall), lo = alongX ? r.minX : r.minZ, hi = alongX ? r.maxX : r.maxZ;
      return end >= lo - .02 && end <= hi + .02 && Math.min(crossMax, alongX ? r.maxZ : r.maxX) - Math.max(crossMin, alongX ? r.minZ : r.minX) > Math.min(.1, beam.thickness * .5);
    };
    if (world.walls.some(w => w !== beam && w.bottom < beam.bottom - .02 && w.bottom + w.height >= beam.bottom - .02 && touching(w))) return true;
    return lintels.some(peer => peer !== beam && peer.orientation === beam.orientation && Math.abs(peer.bottom - beam.bottom) < .02 && touching(peer)
      && (alongX ? sign * (peer.x - beam.x) : sign * (peer.z - beam.z)) > .01 && anchoredEnd(peer, sign, new Set(visited)));
  };
  const shells = world.walls.filter(w => w.detail === 'upper-shell' || w.detail === 'upper-portal-lintel' && !(anchoredEnd(w, -1) && anchoredEnd(w, 1)));
  for (const shell of shells) {
    const b = footprint(shell);
    const supports = world.walls.filter(w => w !== shell && w.bottom < shell.bottom - .02 && w.bottom + w.height >= shell.bottom - .02 && overlapRect(footprint(w), b));
    const pieces: Rect[] = [];
    for (const wall of supports) {
      const p = footprint(wall), intersection = { minX: Math.max(b.minX, p.minX), maxX: Math.min(b.maxX, p.maxX), minZ: Math.max(b.minZ, p.minZ), maxZ: Math.min(b.maxZ, p.maxZ) };
      pieces.push(...cutRects([intersection], pieces));
    }
    const uncovered = cutRects([b], pieces);
    if (!uncovered.length) continue;
    world.walls = world.walls.filter(w => w !== shell);
    world.colliders = world.colliders.filter(c => c.id !== shell.id);
    world.spatial!.prisms = world.spatial!.prisms.filter(p => p.id !== shell.id);
    pieces.forEach((p, i) => add(`${shell.id}/bearing-${i}`, p, shell.bottom, shell.bottom + shell.height, shell.tint, 'upper-shell'));
  }
};
