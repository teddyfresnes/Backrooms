import { RectIndex } from './RectIndex';
import { cutRects, overlapRect, type WalkableSurface } from './WalkableTopology';
import type { Rect, WorldPlan } from './types';

const EPS = 1e-6;
// Spatial cell cropping discards pieces below 5 mm. Room/column faces can
// consequently leave a sub-millimetre unsupported floor seam. Close that actual
// floor volume, never hide it with floating trim or a render tolerance.
const CONTACT_GAP = .005;

export const closeSpatialFloorContacts = (world: WorldPlan): void => {
  if (!world.spatial || !world.topology) return;
  const floors = world.topology.surfaces;
  const floorIndex = new RectIndex(floors, s => s.bounds);
  const blockers = new RectIndex([
    ...(world.floorOpenings ?? []).map(bounds => ({ bounds })), ...(world.topology.reservations ?? []),
  ], b => b.bounds);
  const half = world.size / 2;
  const patches: WalkableSurface[] = [];
  for (const prism of world.spatial.prisms) {
    if (!prism.collision || !['wall', 'plaster'].includes(prism.material)) continue;
    const v = prism.vertices, xs = v.filter((_, i) => i % 3 === 0), zs = v.filter((_, i) => i % 3 === 2);
    const b = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
    // Flat boxes only: a sloping cheek/arch never becomes an AABB filler.
    const bottom = v[13]!, top = v[1]!;
    if ([0, 1, 2, 3].some(i => Math.abs(v[i * 3 + 1]! - top) > EPS || Math.abs(v[(i + 4) * 3 + 1]! - bottom) > EPS
      || v[i * 3] !== v[(i + 4) * 3] || v[i * 3 + 2] !== v[(i + 4) * 3 + 2])) continue;
    const search = { minX: b.minX - CONTACT_GAP, maxX: b.maxX + CONTACT_GAP, minZ: b.minZ - CONTACT_GAP, maxZ: b.maxZ + CONTACT_GAP };
    for (const floor of floorIndex.query(search)) {
      if (floor.profile.kind !== 'flat' || !['floor', 'landing', 'balcony', 'bridge'].includes(floor.role)) continue;
      const y = floor.profile.y;
      if (bottom > y + EPS || top < y + .14) continue;
      const f = floor.bounds, proposals: Rect[] = [];
      const x0 = Math.max(b.minX, f.minX), x1 = Math.min(b.maxX, f.maxX), z0 = Math.max(b.minZ, f.minZ), z1 = Math.min(b.maxZ, f.maxZ);
      if (x1 - x0 > EPS) {
        if (b.minZ - f.maxZ > EPS && b.minZ - f.maxZ <= CONTACT_GAP) proposals.push({ minX: x0, maxX: x1, minZ: f.maxZ, maxZ: b.minZ });
        if (f.minZ - b.maxZ > EPS && f.minZ - b.maxZ <= CONTACT_GAP) proposals.push({ minX: x0, maxX: x1, minZ: b.maxZ, maxZ: f.minZ });
      }
      if (z1 - z0 > EPS) {
        if (b.minX - f.maxX > EPS && b.minX - f.maxX <= CONTACT_GAP) proposals.push({ minZ: z0, maxZ: z1, minX: f.maxX, maxX: b.minX });
        if (f.minX - b.maxX > EPS && f.minX - b.maxX <= CONTACT_GAP) proposals.push({ minZ: z0, maxZ: z1, minX: b.maxX, maxX: f.minX });
      }
      for (const proposed of proposals) {
        if (proposed.minX < -half || proposed.maxX > half || proposed.minZ < -half || proposed.maxZ > half
          || blockers.query(proposed).some(b => overlapRect(proposed, b.bounds, EPS))) continue;
        const existing = floorIndex.query(proposed).filter(s => s.profile.kind === 'flat' && Math.abs(s.profile.y - y) < EPS).map(s => s.bounds);
        // cutRects intentionally drops sub-mm ordinary fragments. These are
        // precisely the contact patches being repaired: preserve their width.
        const pieces = cutRects([proposed], existing, EPS);
        for (const bounds of pieces) {
          const patch = { ...floor, id: `${floor.id}/contact-${patches.length}`, bounds };
          patches.push(patch); floorIndex.insert(patch);
        }
      }
    }
  }
  floors.push(...patches);
};
