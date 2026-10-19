import { SeededRandom } from './SeededRandom';
import type { ColumnSlot, Rect, WallSegment, WorldPlan } from './types';

const EPS = 1e-6;
const SMALL_RETURN = .14;
const RARE_IRREGULARITY = .025;
const footprint = (wall: WallSegment): Rect => ({
  minX: wall.x - (wall.orientation === 'x' ? wall.length : wall.thickness) / 2,
  maxX: wall.x + (wall.orientation === 'x' ? wall.length : wall.thickness) / 2,
  minZ: wall.z - (wall.orientation === 'z' ? wall.length : wall.thickness) / 2,
  maxZ: wall.z + (wall.orientation === 'z' ? wall.length : wall.thickness) / 2,
});
const fixed = (wall: WallSegment) => wall.orientation === 'x' ? wall.z : wall.x;
const along = (wall: WallSegment) => wall.orientation === 'x' ? wall.x : wall.z;
const setSpan = (wall: WallSegment, min: number, max: number) => {
  wall.length = max - min;
  if (wall.orientation === 'x') wall.x = (min + max) / 2;
  else wall.z = (min + max) / 2;
};
const intersects = (a: Rect, b: Rect) => a.minX < b.maxX - EPS && a.maxX > b.minX + EPS
  && a.minZ < b.maxZ - EPS && a.maxZ > b.minZ + EPS;

function subtract(rect: Rect, cut: Rect): Rect[] {
  if (!intersects(rect, cut)) return [rect];
  const x0 = Math.max(rect.minX, cut.minX), x1 = Math.min(rect.maxX, cut.maxX);
  const z0 = Math.max(rect.minZ, cut.minZ), z1 = Math.min(rect.maxZ, cut.maxZ);
  return [
    { ...rect, maxX: x0 }, { ...rect, minX: x1 },
    { minX: x0, maxX: x1, minZ: rect.minZ, maxZ: z0 },
    { minX: x0, maxX: x1, minZ: z1, maxZ: rect.maxZ },
  ].filter(r => r.maxX - r.minX > EPS && r.maxZ - r.minZ > EPS);
}

/** Remove accidental centimetre-wide returns before deriving upper/lower skins.
 * Keep the same wall IDs and update their actual collision shapes. Authored
 * passages, doors, boundary seams and monuments retain their own dimensions.
 */
export function cleanWallJunctions(plan: WorldPlan): void {
  const doors = plan.features.filter(f => f.kind === 'interactive-door').map(f => f.bounds);
  const walls = plan.walls.filter(w => !w.detail && w.collision && w.kind !== 'vista-frame'
    && Math.abs(fixed(w)) < plan.size / 2 - .01 && w.bottom >= -.01
    && !doors.some(door => intersects(footprint(w), door)));
  const removed = new Set<WallSegment>();
  const changed = new Set<WallSegment>();
  const random = new SeededRandom(plan.seed).fork('wall-junction-cleanup');
  const rare = (key: string) => random.fork(key).chance(RARE_IRREGULARITY);
  const sameHeight = (a: WallSegment, b: WallSegment) => Math.abs(a.bottom - b.bottom) < EPS && Math.abs(a.height - b.height) < EPS;

  // Adjacent collinear pieces should share a face. Independent thickness
  // rounding and offset placement used to leave 1–4 cm shoulders on long walls.
  for (let i = 0; i < walls.length; i++) for (let j = i + 1; j < walls.length; j++) {
    const a = walls[i]!, b = walls[j]!;
    if (a.orientation !== b.orientation || !sameHeight(a, b) || a.kind !== b.kind) continue;
    const gap = Math.abs(along(a) - along(b)) - (a.length + b.length) / 2;
    const offset = Math.abs(fixed(a) - fixed(b)), thickness = Math.abs(a.thickness - b.thickness);
    if (gap > .025 || gap < -.12 || offset > .025 || thickness > .06 || offset + thickness < EPS) continue;
    if (rare([a.id, b.id].sort().join(':'))) continue;
    const source = a.length >= b.length ? a : b, target = source === a ? b : a;
    target.thickness = source.thickness;
    if (target.orientation === 'x') target.z = source.z;
    else target.x = source.x;
    changed.add(target);
  }

  for (const wall of walls) {
    let min = along(wall) - wall.length / 2, max = along(wall) + wall.length / 2;
    const originalMin = min, originalMax = max;
    for (const host of walls) {
      if (host === wall || host.orientation === wall.orientation || !sameHeight(wall, host) || removed.has(host)) continue;
      const hostMin = along(host) - host.length / 2, hostMax = along(host) + host.length / 2;
      // Only trim a return when the host covers the entire cross-section.
      if (fixed(wall) - wall.thickness / 2 < hostMin - EPS || fixed(wall) + wall.thickness / 2 > hostMax + EPS) continue;
      const near = fixed(host) - host.thickness / 2, far = fixed(host) + host.thickness / 2;
      if (rare(`return:${wall.id}:${host.id}`)) continue;
      if (min < near - EPS && near - min <= SMALL_RETURN && max > near) { min = near; changed.add(wall); }
      if (max > far + EPS && max - far <= SMALL_RETURN && min < far) { max = far; changed.add(wall); }
      if (min >= near - EPS && max <= far + EPS) { removed.add(wall); break; }
    }
    if (!removed.has(wall) && (min !== originalMin || max !== originalMax)) setSpan(wall, min, max);
  }

  // Make a true butt joint at an L: one wall owns the corner, the other ends at
  // its inner face. Two centre-line-ended boxes otherwise leave a recessed nib.
  for (const a of walls) for (const b of walls) {
    if (a.orientation !== 'x' || b.orientation !== 'z' || !sameHeight(a, b) || removed.has(a) || removed.has(b)) continue;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const aEnd = a.x + sx * a.length / 2, bEnd = b.z + sz * b.length / 2;
      if (Math.abs(aEnd - b.x) > EPS || Math.abs(bEnd - a.z) > EPS) continue;
      const continues = walls.some(w => w !== a && w !== b && !removed.has(w) && sameHeight(w, a)
        && (w.orientation === 'x'
          ? Math.abs(w.z - a.z) < EPS && sx * (w.x - b.x) > EPS && Math.abs(w.x - b.x) - w.length / 2 < .01
          : Math.abs(w.x - b.x) < EPS && sz * (w.z - a.z) > EPS && Math.abs(w.z - a.z) - w.length / 2 < .01));
      if (continues || b.length - a.thickness / 2 < .4) continue;
      const aMin = a.x - a.length / 2, aMax = a.x + a.length / 2;
      const bMin = b.z - b.length / 2, bMax = b.z + b.length / 2;
      setSpan(a, sx < 0 ? aMin - b.thickness / 2 : aMin, sx > 0 ? aMax + b.thickness / 2 : aMax);
      setSpan(b, sz < 0 ? bMin + a.thickness / 2 : bMin, sz > 0 ? bMax - a.thickness / 2 : bMax);
      changed.add(a); changed.add(b);
    }
  }

  const nearlyBuried = (column: ColumnSlot): boolean => {
    const rect = { minX: column.x - column.width / 2, maxX: column.x + column.width / 2,
      minZ: column.z - column.depth / 2, maxZ: column.z + column.depth / 2 };
    let visible = [rect];
    for (const wall of plan.walls) {
      if (removed.has(wall) || wall.bottom > (column.bottom ?? 0) + EPS || wall.height + wall.bottom < column.height + (column.bottom ?? 0) - EPS) continue;
      visible = visible.flatMap(piece => subtract(piece, footprint(wall)));
      if (!visible.length) return true;
    }
    // A pilaster mostly buried in a thick partition is a thin vertical strip,
    // not an architectural bay. Keep substantial relief and a few exceptions.
    return visible.every(r => Math.min(r.maxX - r.minX, r.maxZ - r.minZ) < .16)
      && visible.reduce((n, r) => n + (r.maxX - r.minX) * (r.maxZ - r.minZ), 0) < column.width * column.depth * .5;
  };
  // Formal corner posts are decorative too. Remove an entire mirrored group
  // only when every post is buried or barely exposed; independent removal
  // would spoil the deliberately symmetric hall. Real structural columns stay.
  const cornerGroups = new Map<string, ColumnSlot[]>();
  for (const collider of plan.colliders) {
    const group = /^formal-corner-(.+)-\d+$/.exec(collider.id)?.[1];
    if (!group) continue;
    const column = plan.columns.find(c => Math.abs(c.x - collider.center.x) < EPS && Math.abs(c.z - collider.center.z) < EPS
      && Math.abs(c.width / 2 - collider.halfExtents.x) < EPS && Math.abs(c.depth / 2 - collider.halfExtents.z) < EPS);
    if (column) cornerGroups.set(group, [...(cornerGroups.get(group) ?? []), column]);
  }
  const removedCorners = new Set<ColumnSlot>();
  for (const [group, columns] of cornerGroups) {
    if (columns.length === 4 && !rare(`formal-corners:${group}`) && columns.every(nearlyBuried)) {
      columns.forEach(c => removedCorners.add(c));
    }
  }
  const removedColumns = plan.columns.filter(column => removedCorners.has(column)
    || (column.kind === 'pilaster' && !rare(`pilaster:${column.x}:${column.z}:${column.width}:${column.depth}`) && nearlyBuried(column)));
  const removedIds = new Set([...removed].map(w => `collider-${w.id}`));
  const byId = new Map([...changed].filter(w => !removed.has(w)).map(w => [`collider-${w.id}`, w]));
  plan.colliders = plan.colliders.filter(c => !removedIds.has(c.id) && !(c.kind === 'column'
    && removedColumns.some(column => Math.abs(column.x - c.center.x) < EPS && Math.abs(column.z - c.center.z) < EPS
      && Math.abs(column.width / 2 - c.halfExtents.x) < EPS && Math.abs(column.depth / 2 - c.halfExtents.z) < EPS)));
  for (const collider of plan.colliders) {
    const wall = byId.get(collider.id);
    if (!wall) continue;
    collider.center.x = wall.x; collider.center.z = wall.z;
    collider.halfExtents.x = (wall.orientation === 'x' ? wall.length : wall.thickness) / 2;
    collider.halfExtents.z = (wall.orientation === 'z' ? wall.length : wall.thickness) / 2;
  }
  plan.walls = plan.walls.filter(w => !removed.has(w));
  plan.columns = plan.columns.filter(c => !removedColumns.includes(c));
}
