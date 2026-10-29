import { RectIndex } from './RectIndex';
import { prismCollider, profilePrism } from './SpatialGeometry';
import { cutRects, overlapRect } from './WalkableTopology';
import type { Rect, WallSegment, WorldPlan } from './types';

const EPS = 1e-6;
// Coordinates are metres: numerical equality is one micrometre; only ordinary
// partition shoulders/gaps up to 25 mm and buried returns up to 40 mm qualify.
// A readable niche, an authored opening and an owner cut are different roles.
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
export const cleanSpatialWallJunctions = (world: WorldPlan, closeReturns = true): boolean => {
  if (!world.spatial) return false;
  const protectedBounds = new RectIndex([
    ...world.features, ...(world.topology?.reservations ?? []),
    ...(world.floorOpenings ?? []).map(bounds => ({ bounds })),
    ...(world.spatial.transitions ?? []).flatMap(t => [t.bounds, t.approach.bounds, t.landing.bounds].map(bounds => ({ bounds }))),
  ], f => f.bounds);
  const half = world.size / 2;
  const safe = (b: Rect) => b.minX > -half + .08 && b.maxX < half - .08 && b.minZ > -half + .08 && b.maxZ < half - .08
    && !protectedBounds.query({ minX: b.minX - .04, maxX: b.maxX + .04, minZ: b.minZ - .04, maxZ: b.maxZ + .04 }).some(f => overlapRect(b, f.bounds, .04));
  const prisms = new Map(world.spatial.prisms.map(p => [p.id, p]));
  // Never turn an arched/sheared volume's bounding box into a solid wall.
  const boxes = world.walls.filter(w => {
    const p = prisms.get(w.id); if (!p || !p.collision) return false;
    const b = boundsOf(w);
    return p.vertices.every((n, i) => {
      const low = i % 3 === 0 ? b.minX : i % 3 === 2 ? b.minZ : w.bottom;
      const high = i % 3 === 0 ? b.maxX : i % 3 === 2 ? b.maxZ : w.bottom + w.height;
      return Math.abs(n - low) < EPS || Math.abs(n - high) < EPS;
    });
  });
  const walls = boxes.filter(w => !w.detail && !w.junctionRole && w.collision && w.kind !== 'vista-frame' && w.height > .3 && safe(boundsOf(w)));
  const editable = new Set(walls);
  // Include the whole possible corner ownership change, not just a tiny snap.
  const partitionThickness = 2.8; // Maximum ordinary BSP thickness, not a mass.
  const margin = partitionThickness + SHOULDER;
  const index = new RectIndex(boxes, w => {
    const b = boundsOf(w); return { minX: b.minX - margin, maxX: b.maxX + margin, minZ: b.minZ - margin, maxZ: b.maxZ + margin };
  });
  const changed = new Set<WallSegment>(), removed = new Set<WallSegment>();
  const setBounds = (w: WallSegment, b: Rect) => {
    w.x = (b.minX + b.maxX) / 2; w.z = (b.minZ + b.maxZ) / 2;
    w.length = w.orientation === 'x' ? b.maxX - b.minX : b.maxZ - b.minZ;
    w.thickness = w.orientation === 'x' ? b.maxZ - b.minZ : b.maxX - b.minX;
    changed.add(w);
  };
  const rank = (a: WallSegment, b: WallSegment) => b.length - a.length || a.id.localeCompare(b.id);
  for (const w of [...walls].sort(rank)) for (const peer of index.query(boundsOf(w)).sort(rank)) {
    if (peer === w || !editable.has(peer) || rank(w, peer) >= 0 || peer.orientation !== w.orientation || peer.kind !== w.kind
      || Math.abs(peer.bottom - w.bottom) > EPS || Math.abs(peer.height - w.height) > EPS) continue;
    const alongX = w.orientation === 'x', gap = Math.abs((alongX ? w.x - peer.x : w.z - peer.z)) - (w.length + peer.length) / 2;
    const offset = Math.abs(alongX ? w.z - peer.z : w.x - peer.x);
    if (Math.min(w.thickness, peer.thickness) < .12 || Math.max(w.thickness, peer.thickness) > partitionThickness
      || gap > (closeReturns ? SHOULDER : EPS) || gap < -.12 || offset > SHOULDER
      || offset + Math.abs(w.thickness - peer.thickness) / 2 > RESIDUAL) continue;
    if (offset < EPS && Math.abs(w.thickness - peer.thickness) < EPS && gap <= EPS) continue;
    const b = boundsOf(peer), host = boundsOf(w);
    if (alongX) { b.minZ = host.minZ; b.maxZ = host.maxZ; }
    else { b.minX = host.minX; b.maxX = host.maxX; }
    if (gap > EPS) {
      if (alongX) { if (peer.x > w.x) b.minX = host.maxX; else b.maxX = host.minX; }
      else { if (peer.z > w.z) b.minZ = host.maxZ; else b.maxZ = host.minZ; }
    }
    if (safe(b)) setBounds(peer, b);
  }
  // Cell cuts can introduce new centre-ended Ls after the template cleanup.
  // One box owns the corner; its peer butts on the exact inside face.
  for (const a of closeReturns ? walls.filter(w => w.orientation === 'x').sort(rank) : []) for (const b of index.query(boundsOf(a))) {
    if (!editable.has(b) || b.orientation !== 'z' || Math.max(a.thickness, b.thickness) > partitionThickness
      || Math.abs(a.bottom - b.bottom) > EPS || Math.abs(a.height - b.height) > EPS) continue;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const ar = boundsOf(a), br = boundsOf(b), x = sx < 0 ? ar.minX : ar.maxX, z = sz < 0 ? br.minZ : br.maxZ;
      if (Math.abs(x - b.x) > SHOULDER || Math.abs(z - a.z) > SHOULDER) continue;
      const continues = index.query({ minX: b.x - SHOULDER, maxX: b.x + SHOULDER, minZ: a.z - SHOULDER, maxZ: a.z + SHOULDER }).some(w => w !== a && w !== b
        && w.bottom <= a.bottom + EPS && w.bottom + w.height >= a.bottom + a.height - EPS
        && (w.orientation === 'x' ? Math.abs(w.z - a.z) < SHOULDER && sx * (w.x - b.x) > EPS && Math.abs(w.x - b.x) - w.length / 2 < SHOULDER
          : Math.abs(w.x - b.x) < SHOULDER && sz * (w.z - a.z) > EPS && Math.abs(w.z - a.z) - w.length / 2 < SHOULDER));
      if (continues) continue;
      if (sx < 0) ar.minX = br.minX; else ar.maxX = br.maxX;
      if (sz < 0) br.minZ = ar.maxZ; else br.maxZ = ar.minZ;
      if (br.maxZ - br.minZ < .4 || !safe(ar) || !safe(br)) continue;
      setBounds(a, ar); setBounds(b, br);
    }
  }
  // Fill only a small near-miss or absorb a small exposed end, with a host
  // covering the complete section and height. No filling across a doorway.
  for (const w of closeReturns ? walls : []) for (const host of index.query(boundsOf(w))) {
    if (host === w || host.orientation === w.orientation || host.bottom > w.bottom + EPS
      || host.bottom + host.height < w.bottom + w.height - EPS) continue;
    const b = boundsOf(w), h = boundsOf(host), alongX = w.orientation === 'x';
    const crossLow = alongX ? b.minZ : b.minX, crossHigh = alongX ? b.maxZ : b.maxX;
    if (crossLow < (alongX ? h.minZ : h.minX) - EPS || crossHigh > (alongX ? h.maxZ : h.maxX) + EPS) continue;
    let min = alongX ? b.minX : b.minZ, max = alongX ? b.maxX : b.maxZ;
    const near = alongX ? h.minX : h.minZ, far = alongX ? h.maxX : h.maxZ;
    const originalMin = min, originalMax = max;
    if (max < near - EPS && near - max <= SHOULDER) max = near;
    if (min > far + EPS && min - far <= SHOULDER) min = far;
    if (min < near - EPS && near - min <= RESIDUAL && max > near) min = near;
    if (max > far + EPS && max - far <= RESIDUAL && min < far) max = far;
    if (min === originalMin && max === originalMax) continue;
    if (alongX) { b.minX = min; b.maxX = max; } else { b.minZ = min; b.maxZ = max; }
    if (max - min > EPS && safe(b)) setBounds(w, b);
  }
  for (const w of [...walls].sort((a, b) => area(boundsOf(a)) - area(boundsOf(b)) || b.id.localeCompare(a.id))) {
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
