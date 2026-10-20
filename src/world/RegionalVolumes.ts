import type { Rect, WorldPlan } from './types';
import { pointInRect, rectCenter, rectDepth, rectWidth } from './types';
import { overlapRect, CEILING_TILE_THICKNESS, LOWEST_STRUCTURE_Y, SLAB_THICKNESS, type VerticalReservation } from './WalkableTopology';
import { clipVerticalArchitecture, wallCollider } from './VerticalPlanner';

export interface RegionalClaim { id: string; roomId: string; story: number; bounds: Rect; bottom: number; top: number }
const PITCH = 5.4, MAX_REACH = 4;
/** Raw lower-owner priority gives bounded, order-independent coordination. */
export const planRegionalVolumes = (story: number, rawAt: (owner: number) => WorldPlan, compatible: (claim: RegionalClaim) => boolean): RegionalClaim[] => {
  const candidates: RegionalClaim[] = [];
  for (let owner = story - MAX_REACH * 2; owner <= story; owner++) {
    const raw = rawAt(owner);
    for (const room of raw.rooms.filter(r => r.level === 0 && r.ceilingHeight > 4.3)) candidates.push({
      id: `regional/${owner}/${room.id}`, roomId: room.id, story: owner, bounds: { ...room.bounds }, bottom: owner * PITCH - .16,
      top: owner * PITCH + Math.min(room.ceilingHeight, MAX_REACH * PITCH - CEILING_TILE_THICKNESS) + CEILING_TILE_THICKNESS });
  }
  return candidates.filter(c => c.top > story * PITCH + LOWEST_STRUCTURE_Y && c.story >= story - MAX_REACH &&
    !candidates.some(p => p.story < c.story && p.top > c.bottom && overlapRect(p.bounds, c.bounds, .16)) && compatible(c));
};

export const applyRegionalClaims = (world: WorldPlan, story: number, claims: readonly RegionalClaim[]): void => {
  const topology = world.topology; if (!topology) return;
  const local = claims.filter(c => c.story === story), incoming = claims.filter(c => c.story < story);
  for (const r of world.rooms.filter(r => r.level === 0)) {
    const claim = local.find(c => c.roomId === r.id);
    const original = Math.max(r.ceilingHeight, r.structuralCeilingY ?? r.ceilingHeight);
    if (claim) r.ceilingHeight = claim.top - story * PITCH - CEILING_TILE_THICKNESS;
    else if (original > 4.3) {
      r.ceilingHeight = Math.max(4.3, (r.floorY ?? 0) + 2.65);
      topology.diagnostics.push({ id: r.id, reason: 'regional envelope conflicts with an older owner, shaft, entrance or protected architecture' });
    } else r.ceilingHeight = Math.max(original, (r.floorY ?? 0) + 2.65);
  }
  const reservations: VerticalReservation[] = incoming.map(c => ({ id: c.id, bounds: { ...c.bounds }, ownerStory: c.story, bottom: c.bottom - story * PITCH, top: c.top - story * PITCH }));
  topology.reservations = reservations;
  const active = reservations.filter(v => v.top > -SLAB_THICKNESS + .002);
  if (!active.length) return;
  const cuts = active.map(v => v.bounds); clipVerticalArchitecture(world, cuts, w => !w.id.startsWith('inherited-'));
  world.columns = world.columns.filter(c => !cuts.some(b => pointInRect(c.x, c.z, b, -.3)));
  world.colliders = world.colliders.filter(c => c.kind !== 'column' || !cuts.some(b => overlapRect(b,
    { minX: c.center.x - c.halfExtents.x, maxX: c.center.x + c.halfExtents.x, minZ: c.center.z - c.halfExtents.z, maxZ: c.center.z + c.halfExtents.z }, .15)));
  world.lights = world.lights.filter(l => !cuts.some(b => pointInRect(l.x, l.z, b, -.5)));
  world.detailSockets = world.detailSockets.filter(d => !cuts.some(b => pointInRect(d.position.x, d.position.z, b, -.2)));
  for (const [i, v] of active.entries()) {
    const b = v.bounds, p = rectCenter(b), thickness = .24;
    const ceiling = Math.max(world.wallHeight, ...world.rooms.filter(r => overlapRect(r.bounds, b, .2)).map(r => r.ceilingHeight));
    const sides = [
      { x: p.x, z: b.minZ - thickness / 2, length: rectWidth(b) + thickness * 2, orientation: 'x' as const },
      { x: p.x, z: b.maxZ + thickness / 2, length: rectWidth(b) + thickness * 2, orientation: 'x' as const },
      { x: b.minX - thickness / 2, z: p.z, length: rectDepth(b), orientation: 'z' as const },
      { x: b.maxX + thickness / 2, z: p.z, length: rectDepth(b), orientation: 'z' as const },
    ];
    for (const [j, side] of sides.entries()) {
      const wall = { ...side, id: `regional-enclosure/${i}/${j}`, bottom: 0, height: ceiling, thickness, tint: .96, collision: true, kind: 'wallpaper' as const };
      world.walls.push(wall); world.colliders.push(wallCollider(wall));
    }
  }
};
