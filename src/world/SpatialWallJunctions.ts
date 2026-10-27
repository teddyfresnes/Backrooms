import { RectIndex } from './RectIndex';
import { prismCollider, profilePrism } from './SpatialGeometry';
import { cutRects, overlapRect } from './WalkableTopology';
import type { Rect, WallSegment, WorldPlan } from './types';

const EPS = 1e-6;
const SHOULDER = .025;
const RESIDUAL = .04;
const boundsOf = (w: WallSegment): Rect => ({
  minX: w.x - (w.orientation === 'x' ? w.length : w.thickness) / 2, maxX: w.x + (w.orientation === 'x' ? w.length : w.thickness) / 2,
  minZ: w.z - (w.orientation === 'z' ? w.length : w.thickness) / 2, maxZ: w.z + (w.orientation === 'z' ? w.length : w.thickness) / 2,
});
const area = (r: Rect) => (r.maxX - r.minX) * (r.maxZ - r.minZ);

/** A bounded second pass after reservations/doors. Only largely buried ordinary
 * fragments and already-touching collinear shoulders change. Canonical seams,
 * authored details, openings and substantial architectural returns are protected. */
export const cleanSpatialWallJunctions = (world: WorldPlan): boolean => {
  if (!world.spatial) return false;
  const protectedBounds = world.features.map(f => f.bounds);
  const half = world.size / 2;
  const eligible = (w: WallSegment) => {
    const b = boundsOf(w);
    return !w.detail && w.collision && w.kind !== 'vista-frame' && w.thickness >= .12 && w.height > .3
      && b.minX > -half + .08 && b.maxX < half - .08 && b.minZ > -half + .08 && b.maxZ < half - .08
      && !protectedBounds.some(p => overlapRect(b, p, .04));
  };
  const walls = world.walls.filter(eligible), index = new RectIndex(world.walls, w => {
    const b = boundsOf(w); return { minX: b.minX - SHOULDER, maxX: b.maxX + SHOULDER, minZ: b.minZ - SHOULDER, maxZ: b.maxZ + SHOULDER };
  });
  const changed = new Set<WallSegment>(), removed = new Set<WallSegment>(), order = new Map(world.walls.map((w, i) => [w, i]));
  for (const w of walls) for (const peer of index.query(boundsOf(w))) {
    if (peer === w || !eligible(peer) || peer.orientation !== w.orientation || peer.kind !== w.kind
      || Math.abs(peer.bottom - w.bottom) > EPS || Math.abs(peer.height - w.height) > EPS) continue;
    const alongX = w.orientation === 'x', gap = Math.abs((alongX ? w.x - peer.x : w.z - peer.z)) - (w.length + peer.length) / 2;
    if (gap > EPS || gap < -.12 || Math.abs(alongX ? w.z - peer.z : w.x - peer.x) > SHOULDER || Math.abs(w.thickness - peer.thickness) > .06) continue;
    const source = w.length > peer.length || w.length === peer.length && order.get(w)! < order.get(peer)! ? w : peer, target = source === w ? peer : w;
    if (Math.abs(target.thickness - source.thickness) < EPS && Math.abs(alongX ? target.z - source.z : target.x - source.x) < EPS) continue;
    target.thickness = source.thickness;
    if (alongX) target.z = source.z; else target.x = source.x;
    changed.add(target);
  }
  for (const w of walls) {
    const b = boundsOf(w);
    const hosts = index.query(b).filter(host => host !== w && !removed.has(host) && host.bottom <= w.bottom + EPS
      && host.bottom + host.height >= w.bottom + w.height - EPS && overlapRect(b, boundsOf(host)));
    const visible = cutRects([b], hosts.map(boundsOf));
    if (!visible.length || visible.every(r => Math.min(r.maxX - r.minX, r.maxZ - r.minZ) <= RESIDUAL)
      && visible.reduce((n, r) => n + area(r), 0) <= area(b) * .35) removed.add(w);
  }
  const affected = new Set([...changed, ...removed].map(w => w.id));
  if (!affected.size) return false;
  const originals = new Map(world.spatial.prisms.filter(p => affected.has(p.id)).map(p => [p.id, p]));
  world.walls = world.walls.filter(w => !removed.has(w));
  world.spatial.prisms = world.spatial.prisms.filter(p => !affected.has(p.id));
  world.colliders = world.colliders.filter(c => !affected.has(c.id));
  for (const w of world.walls.filter(w => changed.has(w))) {
    const original = originals.get(w.id);
    if (!original) continue;
    const prism = { ...original, ...profilePrism(w.id, boundsOf(w), { kind: 'flat' as const, y: w.bottom }, { kind: 'flat' as const, y: w.bottom + w.height }, original.material, original.collision), tint: w.tint };
    world.spatial.prisms.push(prism); if (prism.collision) world.colliders.push(prismCollider(prism));
  }
  return true;
};
