import { SeededRandom } from './SeededRandom';
import type { Rect, RoomRecord, WallSegment, WorldPlan } from './types';
import { pointInRect, rectCenter, rectDepth, rectWidth } from './types';
import { classifySurfaceAccess, cutRects, findSurface, MIN_CLEARANCE, MIN_ROUTE_WIDTH, overlapRect, CEILING_TILE_THICKNESS,
  SLAB_THICKNESS, surfaceCollider, surfaceRange, surfaceY, TOPOLOGY_VERSION,
  type SurfaceConnection, type WalkableSurface } from './WalkableTopology';

export interface VerticalPortal {
  portal: { x: number; z: number; orientation: 'x' | 'z'; width: number };
  firstRoom: RoomRecord; secondRoom: RoomRecord;
}
export const wallBounds = (w: WallSegment): Rect => ({
  minX: w.x - (w.orientation === 'x' ? w.length : w.thickness) / 2,
  maxX: w.x + (w.orientation === 'x' ? w.length : w.thickness) / 2,
  minZ: w.z - (w.orientation === 'z' ? w.length : w.thickness) / 2,
  maxZ: w.z + (w.orientation === 'z' ? w.length : w.thickness) / 2 });
/** Read actual partition openings, including widened and corner portals. */
export const discoverVerticalPortals = (world: WorldPlan): VerticalPortal[] => {
  const rooms = world.rooms.filter(r => r.level === 0), result: VerticalPortal[] = [];
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    let first = rooms[i]!, second = rooms[j]!;
    let orientation: 'x' | 'z', fixed: number, lo: number, hi: number;
    if (Math.abs(first.bounds.maxX - second.bounds.minX) < .01 || Math.abs(second.bounds.maxX - first.bounds.minX) < .01) {
      if (first.bounds.minX > second.bounds.minX) [first, second] = [second, first];
      orientation = 'z'; fixed = first.bounds.maxX; lo = Math.max(first.bounds.minZ, second.bounds.minZ); hi = Math.min(first.bounds.maxZ, second.bounds.maxZ);
    } else if (Math.abs(first.bounds.maxZ - second.bounds.minZ) < .01 || Math.abs(second.bounds.maxZ - first.bounds.minZ) < .01) {
      if (first.bounds.minZ > second.bounds.minZ) [first, second] = [second, first];
      orientation = 'x'; fixed = first.bounds.maxZ; lo = Math.max(first.bounds.minX, second.bounds.minX); hi = Math.min(first.bounds.maxX, second.bounds.maxX);
    } else continue;
    if (hi - lo < .75) continue;
    let gaps = [{ min: lo, max: hi }];
    for (const wall of world.walls) {
      if (!wall.collision || wall.bottom > Math.max(first.floorY ?? 0, second.floorY ?? 0) + 1.75 || wall.bottom + wall.height < -.85) continue;
      const b = wallBounds(wall), crossMin = orientation === 'x' ? b.minZ : b.minX, crossMax = orientation === 'x' ? b.maxZ : b.maxX;
      if (fixed < crossMin - .05 || fixed > crossMax + .05) continue;
      const min = orientation === 'x' ? b.minX : b.minZ, max = orientation === 'x' ? b.maxX : b.maxZ;
      gaps = gaps.flatMap(g => max <= g.min || min >= g.max ? [g] :
        [{ min: g.min, max: Math.min(g.max, min) }, { min: Math.max(g.min, max), max: g.max }].filter(g => g.max - g.min > .01));
    }
    for (const g of gaps.filter(g => g.max - g.min >= .75)) result.push({ firstRoom: first, secondRoom: second,
      portal: { orientation, x: orientation === 'x' ? (g.min + g.max) / 2 : fixed, z: orientation === 'z' ? (g.min + g.max) / 2 : fixed, width: g.max - g.min } });
  }
  return result;
};
const quantize = (y: number) => Math.round(y * 20) / 20;
const routeBounds = (s: WalkableSurface, extension = 1): Rect => s.profile.kind !== 'linear' ? s.bounds : s.profile.axis === 'x'
  ? { ...s.bounds, minX: s.bounds.minX - extension, maxX: s.bounds.maxX + extension }
  : { ...s.bounds, minZ: s.bounds.minZ - extension, maxZ: s.bounds.maxZ + extension };
const rampForEdge = (edge: VerticalPortal, a: number, b: number, index: number): WalkableSurface | undefined => {
  const { portal: p, firstRoom: first, secondRoom: second } = edge, axis = p.orientation === 'x' ? 'z' : 'x';
  const width = Math.min(3.4, p.width - .16), run = Math.max(2.4, Math.abs(b - a) / .3);
  const fixed = axis === 'x' ? p.x : p.z, before = Math.min(run / 2, fixed - (axis === 'x' ? first.bounds.minX : first.bounds.minZ) - 1.1), after = run - before;
  if (width < MIN_ROUTE_WIDTH || before < .75 || after < .75 || (axis === 'x' ? second.bounds.maxX : second.bounds.maxZ) - fixed - after < 1.1) return;
  const cross = axis === 'x' ? p.z : p.x;
  const bounds = axis === 'x' ? { minX: fixed - before, maxX: fixed + after, minZ: cross - width / 2, maxZ: cross + width / 2 }
    : { minZ: fixed - before, maxZ: fixed + after, minX: cross - width / 2, maxX: cross + width / 2 };
  return { id: `vertical/ramp-${index}`, roomId: first.id, ownerStory: 0, layer: 'ground', role: 'ramp', bounds,
    profile: { kind: 'linear', axis, startY: a, endY: b }, ceilingY: Math.max(first.ceilingHeight, second.ceilingHeight, Math.max(a, b) + MIN_CLEARANCE),
    thickness: SLAB_THICKNESS, support: 'solid', supportBottom: Math.min(a, b) - SLAB_THICKNESS, access: 'open', edges: 'architecture' };
};

/** Bounded room potential solve: all edges are validated before a sector commits. */
export const planVerticalTopology = (world: WorldPlan, edges: readonly VerticalPortal[], reserved: Set<string>, root: SeededRandom, reservations: readonly Rect[] = [], subfloor: readonly { bounds: Rect; top: number }[] = []): void => {
  for (const r of world.rooms) { r.structuralCeilingY ??= r.ceilingHeight; r.ceilingHeight = r.structuralCeilingY; r.floorY = 0; }
  const rng = root.fork('vertical-topology:v1'), diagnostics: { id: string; reason: string }[] = [];
  const heights = new Map(world.rooms.map(r => [r.id, 0])), half = world.size / 2;
  const eligible = new Set(world.rooms.filter(r => !reserved.has(r.id) && (r.access ?? 'open') === 'open' && r.level === 0 &&
    edges.some(e => e.firstRoom.id === r.id || e.secondRoom.id === r.id) && r.id !== 'room-grand-hall' && r.ceilingHeight <= 4.4 &&
    r.bounds.minX > -half + 12 && r.bounds.maxX < half - 12 && r.bounds.minZ > -half + 12 && r.bounds.maxZ < half - 12 && rectWidth(r.bounds) >= 4 && rectDepth(r.bounds) >= 4 &&
    !(world.symmetryZones ?? []).some(z => overlapRect(z, r.bounds)) && !world.solidMasses.some(m => overlapRect(m.bounds, r.bounds)) &&
    !world.features.some(f => f.kind !== 'impossible-vista' && f.kind !== 'interactive-door' && overlapRect(f.bounds, r.bounds))).map(r => r.id));
  const candidates = rng.shuffle(world.rooms.filter(r => eligible.has(r.id)));
  let ramps: WalkableSurface[] = [];
  const layout = (values: Map<string, number>): WalkableSurface[] | undefined => {
    const result: WalkableSurface[] = [];
    for (const room of world.rooms) {
      const floor = values.get(room.id) ?? 0;
      if (floor < 0 && subfloor.some(v => overlapRect(v.bounds, room.bounds) && floor - SLAB_THICKNESS < v.top + .002)) return;
    }
    for (const [index, edge] of edges.entries()) {
      const a = values.get(edge.firstRoom.id) ?? 0, b = values.get(edge.secondRoom.id) ?? 0; if (a === b) continue;
      const ramp = rampForEdge(edge, a, b, index);
      if (!ramp || result.some(r => overlapRect(routeBounds(r), routeBounds(ramp), .12)) || reservations.some(r => overlapRect(r, routeBounds(ramp), .35))) return;
      const hall = world.rooms.find(r => r.id === 'room-grand-hall');
      if (hall && world.columns.some(c => pointInRect(c.x, c.z, hall.bounds, .6) && overlapRect(routeBounds(ramp),
        { minX: c.x - c.width / 2, maxX: c.x + c.width / 2, minZ: c.z - c.depth / 2, maxZ: c.z + c.depth / 2 }, .12))) return;
      if (subfloor.some(v => overlapRect(v.bounds, ramp.bounds) && (ramp.supportBottom ?? surfaceRange(ramp)[0] - .16) < v.top + .002)) return;
      if (world.walls.some(w => w.bottom < Math.max(a, b) + 2 && overlapRect(routeBounds(ramp, .7), wallBounds(w), .04))) return;
      result.push(ramp);
    }
    return result;
  };
  let accepted = 0;
  for (let attempt = 0; attempt < Math.min(48, candidates.length * 2) && accepted < 8; attempt++) {
    const adjacent = candidates.filter(r => heights.get(r.id) === 0 && edges.some(e => e.firstRoom.id === r.id && heights.get(e.secondRoom.id) !== 0 || e.secondRoom.id === r.id && heights.get(e.firstRoom.id) !== 0));
    const room = adjacent.length ? adjacent[attempt % adjacent.length]! : candidates[attempt % candidates.length]; if (!room || heights.get(room.id) !== 0) continue;
    const proposed = new Map(heights), level = rng.fork(`height:${attempt}`).pick([-.8, -.45, .4, .9, 1.6]), cluster = [room.id];
    const neighbours = edges.flatMap(e => e.firstRoom.id === room.id ? [e.secondRoom.id] : e.secondRoom.id === room.id ? [e.firstRoom.id] : []);
    for (const id of rng.fork(`cluster:${attempt}`).shuffle(neighbours).slice(0, attempt % 3)) if (eligible.has(id) && heights.get(id) === 0) cluster.push(id);
    for (const id of cluster) proposed.set(id, level);
    let next = layout(proposed);
    if (!next) { for (const id of cluster) proposed.set(id, quantize(level * .5)); next = layout(proposed); }
    if (!next) { diagnostics.push({ id: room.id, reason: 'portal width, landing, obstacle or overlapping approach' }); continue; }
    for (const [id, value] of proposed) heights.set(id, value);
    ramps = next; accepted++;
  }
  for (const r of world.rooms) { r.floorY = heights.get(r.id) ?? 0; r.ceilingHeight = Math.max(r.ceilingHeight, quantize(r.floorY + 2.65)); if (r.floorY !== 0) reserved.add(r.id); }
  const galleryCandidates = rng.fork('gallery-room').shuffle(world.rooms.filter(r => !reserved.has(r.id) && (r.access ?? 'open') === 'open' && r.level === 0 && r.id !== 'room-grand-hall' &&
    heights.get(r.id) === 0 && r.ceilingHeight <= 4.3 && rectWidth(r.bounds) >= 17.5 && rectDepth(r.bounds) >= 13.5 &&
    r.bounds.minX > -half + 1.2 && r.bounds.maxX < half - 1.2 && r.bounds.minZ > -half + 1.2 && r.bounds.maxZ < half - 1.2 &&
    !world.solidMasses.some(m => overlapRect(m.bounds, r.bounds)) && !(world.symmetryZones ?? []).some(z => overlapRect(z, r.bounds)) &&
    !world.features.some(f => f.kind !== 'impossible-vista' && f.kind !== 'interactive-door' && overlapRect(f.bounds, r.bounds)) &&
    !ramps.some(s => overlapRect(s.bounds, r.bounds))));
  const galleries: WalkableSurface[] = [];
  for (const galleryRoom of galleryCandidates.slice(0, 4)) {
    const originalCeiling = galleryRoom.ceilingHeight; galleryRoom.ceilingHeight = 4.3;
    const proposal: WalkableSurface[] = [];
    const b = galleryRoom.bounds, width = rectWidth(b), depth = rectDepth(b), w = 2.2, run = 3;
    const galleryRng = root.fork(`vertical-gallery:v1:${galleryRoom.id}`);
    const family = galleryRng.fork('family').pick(['L', 'U', 'bridge'] as const);
    const add = (name: string, bounds: Rect, profile: WalkableSurface['profile'], role: WalkableSurface['role'], solid: boolean, ground = false) => {
      const underpass = ground && name === 'underpass';
      proposal.push({ id: `vertical/gallery/${galleryRoom.id}/${name}`, roomId: galleryRoom.id, ownerStory: 0, layer: ground ? 'ground' : `gallery/${galleryRoom.id}`,
        role, bounds: { ...bounds }, profile: { ...profile }, ceilingY: underpass ? 1.64 : 4.3, thickness: .16, support: solid ? 'solid' : 'slab',
        ...(solid ? { supportBottom: ground ? -1.06 : -.16 } : {}), access: 'open', edges: ground || role === 'ramp' ? 'drop' : 'guarded' });
    };
    if (family === 'U') {
      const u = 4;
      add('entry', { minX: u, maxX: u + run, minZ: 1, maxZ: 1 + w }, { kind: 'linear', axis: 'x', startY: 0, endY: .9 }, 'ramp', true);
      add('turn', { minX: u + run, maxX: u + run + w, minZ: 1, maxZ: 1 + w * 2 + .4 }, { kind: 'flat', y: .9 }, 'landing', true);
      add('return', { minX: u, maxX: u + run, minZ: 1 + w + .4, maxZ: 1 + w * 2 + .4 }, { kind: 'linear', axis: 'x', startY: 1.8, endY: .9 }, 'ramp', true);
      const platform = { minX: 1, maxX: u, minZ: 1 + w + .4, maxZ: 1 + w * 2 + .4 };
      add('balcony', platform, { kind: 'flat', y: 1.8 }, 'balcony', false);
      add('underpass', platform, { kind: 'flat', y: -.9 }, 'landing', false, true);
      add('underpass-entry', { minX: 1, maxX: 1 + w, minZ: 1, maxZ: platform.minZ }, { kind: 'linear', axis: 'z', startY: 0, endY: -.9 }, 'ramp', true, true);
      add('underpass-exit', { minX: 1, maxX: 1 + w, minZ: platform.maxZ, maxZ: platform.maxZ + run }, { kind: 'linear', axis: 'z', startY: -.9, endY: 0 }, 'ramp', true, true);
    } else {
      add('entry', { minX: 1, maxX: 1 + run, minZ: 1, maxZ: 1 + w }, { kind: 'linear', axis: 'x', startY: 0, endY: .9 }, 'ramp', true);
      add('turn', { minX: 1 + run, maxX: 1 + run + w, minZ: 1, maxZ: 1 + w }, { kind: 'flat', y: .9 }, 'landing', true);
      add('ascending', { minX: 1 + run, maxX: 1 + run + w, minZ: 1 + w, maxZ: 1 + w + run }, { kind: 'linear', axis: 'z', startY: .9, endY: 1.8 }, 'ramp', true);
      const platform = { minX: 1 + run, maxX: family === 'bridge' ? width - 1.72 : 1 + run + w + 3, minZ: 1 + w + run, maxZ: 1 + w * 2 + run };
      add(family === 'bridge' ? 'bridge' : 'balcony', platform, { kind: 'flat', y: 1.8 }, family === 'bridge' ? 'bridge' : 'balcony', false);
      add('underpass', platform, { kind: 'flat', y: -.9 }, 'landing', false, true);
      add('underpass-entry', { minX: platform.minX, maxX: platform.minX + w, minZ: platform.maxZ, maxZ: platform.maxZ + run }, { kind: 'linear', axis: 'z', startY: -.9, endY: 0 }, 'ramp', true, true);
      add('underpass-exit', family === 'bridge'
        ? { minX: platform.maxX - w, maxX: platform.maxX, minZ: platform.minZ - run + .2, maxZ: platform.minZ }
        : { minX: platform.maxX, maxX: platform.maxX + run, minZ: platform.minZ, maxZ: platform.maxZ },
        { kind: 'linear', axis: family === 'bridge' ? 'z' : 'x', startY: family === 'bridge' ? 0 : -.9, endY: family === 'bridge' ? -.9 : 0 }, 'ramp', true, true);
    }
    // Reflect the layout without a new bounding-box occupation, and anchor it to an existing wall.
    const mirrorX = galleryRng.fork('mirror-x').chance(.5), mirrorZ = galleryRng.fork('mirror-z').chance(.5);
    for (const s of proposal) {
      const r = s.bounds;
      if (mirrorX) { const min = width - r.maxX; r.maxX = width - r.minX; r.minX = min; if (s.profile.kind === 'linear' && s.profile.axis === 'x') [s.profile.startY, s.profile.endY] = [s.profile.endY, s.profile.startY]; }
      if (mirrorZ) { const min = depth - r.maxZ; r.maxZ = depth - r.minZ; r.minZ = min; if (s.profile.kind === 'linear' && s.profile.axis === 'z') [s.profile.startY, s.profile.endY] = [s.profile.endY, s.profile.startY]; }
      // One side anchors to the wall; the approach axis retains a full landing
      // before the first slope, including the capsule's forward hemisphere.
      const shiftX = family === 'U' ? -.88 : 1.6, shiftZ = family === 'U' ? 1.6 : -.88;
      const dx = b.minX + (mirrorX ? -shiftX : shiftX), dz = b.minZ + (mirrorZ ? -shiftZ : shiftZ);
      s.bounds = { minX: r.minX + dx, maxX: r.maxX + dx, minZ: r.minZ + dz, maxZ: r.maxZ + dz };
    }
    if (family === 'bridge') for (const s of proposal.filter(s => s.role === 'bridge' || s.id.endsWith('/underpass'))) {
      if (mirrorX) s.bounds.minX = b.minX + .12; else s.bounds.maxX = b.maxX - .12;
    }
    // Reject, rather than clip, an approach that cannot fit inside the room.
    if (proposal.some(s => s.bounds.minX < b.minX + .1 || s.bounds.maxX > b.maxX - .1 || s.bounds.minZ < b.minZ + .1 || s.bounds.maxZ > b.maxZ - .1)) {
      diagnostics.push({ id: galleryRoom.id, reason: 'gallery approach exceeds room footprint' }); proposal.length = 0;
    }
    if (proposal.some(s => subfloor.some(v => overlapRect(v.bounds, s.bounds, .12) && (s.supportBottom ?? surfaceRange(s)[0] - s.thickness) < v.top + .002))) {
      diagnostics.push({ id: galleryRoom.id, reason: 'gallery structure conflicts with a lower owner envelope' }); proposal.length = 0;
    }
    if (proposal.length) { galleries.push(...proposal); reserved.add(galleryRoom.id); break; }
    galleryRoom.ceilingHeight = originalCeiling;
  }
  for (const ramp of ramps) for (const r of world.rooms.filter(r => overlapRect(r.bounds, routeBounds(ramp)))) {
    reserved.add(r.id); r.ceilingHeight = Math.max(r.ceilingHeight, quantize(surfaceRange(ramp)[1] + 2.65));
  }
  for (const zone of world.ceilingZones ?? []) {
    const rooms = world.rooms.filter(r => zone.roomIds.includes(r.id)); zone.height = Math.max(zone.height, ...rooms.map(r => r.ceilingHeight)); for (const r of rooms) r.ceilingHeight = zone.height;
  }
  world.topology = { version: TOPOLOGY_VERSION, ownerStory: 0, surfaces: [...ramps, ...galleries], connections: [], volumes: [], diagnostics,
    portals: edges.map(e => ({ ...e.portal, firstRoomId: e.firstRoom.id, secondRoomId: e.secondRoom.id })) };
};

export const wallCollider = (w: WallSegment) => ({ id: `collider-${w.id}`, kind: 'wall' as const,
  center: { x: w.x, y: w.bottom + w.height / 2, z: w.z },
  halfExtents: { x: (w.orientation === 'x' ? w.length : w.thickness) / 2, y: w.height / 2, z: (w.orientation === 'z' ? w.length : w.thickness) / 2 } });
/** Cut the actual footprint, never the bounding rectangle of a turned route. */
export const clipVerticalArchitecture = (world: WorldPlan, cuts: readonly Rect[], predicate: (w: WallSegment) => boolean = () => true): void => {
  const removed = new Set<string>(), added: WallSegment[] = [];
  world.walls = world.walls.flatMap(w => {
    if (!predicate(w) || !cuts.some(r => overlapRect(wallBounds(w), r))) return [w];
    removed.add(`collider-${w.id}`);
    const pieces = cutRects([wallBounds(w)], cuts).map((r, i) => ({ ...w, id: `${w.id}/vertical-cut-${i}`,
      x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2,
      length: w.orientation === 'x' ? rectWidth(r) : rectDepth(r), thickness: w.orientation === 'x' ? rectDepth(r) : rectWidth(r) }));
    added.push(...pieces); return pieces;
  });
  world.colliders = world.colliders.filter(c => !removed.has(c.id));
  world.colliders.push(...added.filter(w => w.collision).map(wallCollider));
};

export const fitVerticalArchitecture = (world: WorldPlan): void => {
  const t = world.topology; if (!t) return;
  const routes = t.surfaces.filter(s => s.role !== 'floor' && !s.id.startsWith('vertical/crawl/'));
  const gallery = routes.filter(s => s.id.startsWith('vertical/gallery/'));
  if (gallery.length) clipVerticalArchitecture(world, gallery.map(s => {
    const r = world.rooms.find(r => r.id === s.roomId)?.bounds, b = routeBounds(s, 1.1);
    return r ? { minX: Math.max(b.minX, r.minX + .12), maxX: Math.min(b.maxX, r.maxX - .12), minZ: Math.max(b.minZ, r.minZ + .12), maxZ: Math.min(b.maxZ, r.maxZ - .12) } : b;
  }), w => !w.id.includes('shaft-enclosure') && !w.id.startsWith('inherited-'));
  // A shared lintel can span several openings. Raise only the exact portion
  // above this route, preserving every unrelated part of the facade.
  for (const [i, route] of routes.filter(s => s.role === 'ramp').entries()) {
    const cut = routeBounds(route, .12), bottom = surfaceRange(route)[1] + 2.55;
    const headers = world.walls.filter(w => w.detail === 'upper-portal-lintel' && w.bottom < bottom - .001 && overlapRect(wallBounds(w), cut, -.002));
    if (!headers.length) continue;
    const ids = new Set(headers.map(w => w.id));
    clipVerticalArchitecture(world, [cut], w => ids.has(w.id));
    for (const original of headers) {
      const top = original.bottom + original.height; if (top <= bottom + .01) continue;
      const b = wallBounds(original), r = { minX: Math.max(b.minX, cut.minX), maxX: Math.min(b.maxX, cut.maxX), minZ: Math.max(b.minZ, cut.minZ), maxZ: Math.min(b.maxZ, cut.maxZ) };
      const wall = { ...original, id: `${original.id}/vertical-head-${i}`, bottom, height: top - bottom,
        x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2,
        length: original.orientation === 'x' ? rectWidth(r) : rectDepth(r), thickness: original.orientation === 'x' ? rectDepth(r) : rectWidth(r) };
      world.walls.push(wall); if (wall.collision) world.colliders.push(wallCollider(wall));
    }
  }
  const removed = new Set<string>();
  world.walls = world.walls.flatMap(w => {
    if (w.id.startsWith('inherited-') || w.id.includes('shaft-enclosure') || w.id.startsWith('vertical-guard/')) return [w];
    const footprint = wallBounds(w), adjacent = world.rooms.filter(r => r.level === 0 && overlapRect(footprint, r.bounds, .08));
    const top = w.bottom + w.height;
    if (w.bottom <= .04 && w.bottom > -1.5 && adjacent.length) w.bottom = Math.min(w.bottom, ...adjacent.map(r => r.floorY ?? 0));
    w.height = top - w.bottom;
    removed.add(`collider-${w.id}`);
    return w.height > .01 ? [w] : [];
  });
  world.colliders = world.colliders.filter(c => !removed.has(c.id));
  world.colliders.push(...world.walls.filter(w => w.collision && removed.has(`collider-${w.id}`)).map(wallCollider));
  const oldColumns = world.columns;
  world.columns = oldColumns.filter(c => !routes.some(s => overlapRect(routeBounds(s, .15),
    { minX: c.x - c.width / 2, maxX: c.x + c.width / 2, minZ: c.z - c.depth / 2, maxZ: c.z + c.depth / 2 }, .12)));
  world.colliders = world.colliders.filter(c => c.kind !== 'column' || !oldColumns.some(p => Math.abs(c.center.x - p.x) < .01 && Math.abs(c.center.z - p.z) < .01));
  for (const [i, c] of world.columns.entries()) {
    const r = world.rooms.find(r => r.level === 0 && pointInRect(c.x, c.z, r.bounds));
    c.bottom = r?.floorY ?? c.bottom ?? 0; c.height = Math.max(.1, (r?.ceilingHeight ?? world.wallHeight) - c.bottom);
    world.colliders.push({ id: `vertical-column-${i}`, kind: 'column', center: { x: c.x, y: c.bottom + c.height / 2, z: c.z }, halfExtents: { x: c.width / 2, y: c.height / 2, z: c.depth / 2 } });
  }
};

/** Apertures own their whole body volume after late ceiling-shell reconstruction. */
export const clearVerticalApertures = (world: WorldPlan): void => {
  const cuts = [...(world.floorOpenings ?? []), ...(world.ceilingOpenings ?? []), ...(world.topology?.reservations ?? []).filter(v => v.top > world.wallHeight - .01).map(v => v.bounds)];
  clipVerticalArchitecture(world, cuts, w => w.detail === 'upper-shell' || w.detail === 'upper-portal-lintel');
};

export const finalizeVerticalTopology = (world: WorldPlan): void => {
  const t = world.topology; if (!t) return;
  const edges = (t.portals ?? []).map(p => p);
  const special = t.surfaces.filter(s => s.role !== 'floor' && !s.id.startsWith('vertical/crawl/'));
  for (const f of world.features) {
    if (f.kind !== 'squeeze-view' || !f.hump) continue;
    const ceiling = Math.max(f.clearanceHeight ?? 1.42, f.hump.elevation + 1.28); f.clearanceHeight = ceiling;
    for (const c of world.colliders.filter(c => c.id.startsWith(`${f.id}-low-ceiling`))) {
      const top = c.center.y + c.halfExtents.y; c.center.y = (top + ceiling) / 2; c.halfExtents.y = Math.max(.01, (top - ceiling) / 2);
    }
    world.colliders = world.colliders.filter(c => !c.id.startsWith(`${f.id}-hump-`));
    const common = { roomId: f.roomId, ownerStory: t.ownerStory, layer: 'ground', ceilingY: ceiling, thickness: .16,
      support: 'solid' as const, supportBottom: -.16, access: 'open' as const, edges: 'architecture' as const, locomotion: 'crouch' as const };
    special.push({ ...common, id: `vertical/crawl/${f.id}/platform`, role: 'landing', bounds: f.hump.platformBounds, profile: { kind: 'flat', y: f.hump.elevation } });
    for (const [i, r] of f.hump.ramps.entries()) special.push({ ...common, id: `vertical/crawl/${f.id}/ramp-${i}`, role: 'ramp', bounds: r.bounds,
      profile: { kind: 'linear', axis: r.axis, startY: r.riseDirection > 0 ? 0 : f.hump.elevation, endY: r.riseDirection > 0 ? f.hump.elevation : 0 } });
  }
  const openings = [...(world.floorOpenings ?? []), ...(t.reservations ?? []).filter(v => v.top > -SLAB_THICKNESS + .002).map(v => v.bounds)];
  const groundCuts = special.filter(s => s.layer === 'ground' || s.support === 'solid').map(s => s.bounds);
  const overhead = special.filter(s => s.layer !== 'ground' && s.support === 'slab' && s.profile.kind === 'flat');
  const roofRects = world.features.flatMap(f => f.kind === 'squeeze-view' ? f.passageRects ?? [f.bounds] : []);
  const surfaces: WalkableSurface[] = [], rooms = world.rooms.filter(r => r.level === 0), half = world.size / 2;
  const addFloors = (rect: Rect, y: number, ceilingY: number, id: string, roomId?: string, access: 'open' | 'sealed' | 'secret' = 'open') => {
    let pieces = cutRects([rect], [...openings, ...groundCuts]);
    for (const b of [...overhead.map(s => s.bounds), ...roofRects]) pieces = pieces.flatMap(p => !overlapRect(p, b) ? [p] : [...cutRects([p], [b]),
      { minX: Math.max(p.minX, b.minX), maxX: Math.min(p.maxX, b.maxX), minZ: Math.max(p.minZ, b.minZ), maxZ: Math.min(p.maxZ, b.maxZ) }]);
    for (const [i, b] of pieces.entries()) {
      const p = rectCenter(b), crawl = world.features.find(f => f.kind === 'squeeze-view' && (f.passageRects ?? [f.bounds]).some(r => pointInRect(p.x, p.z, r)));
      const roof = Math.min(ceilingY, crawl?.kind === 'squeeze-view' ? crawl.clearanceHeight ?? 1.42 : Infinity,
        ...overhead.filter(s => pointInRect(p.x, p.z, s.bounds)).map(s => surfaceY(s, p.x, p.z) - s.thickness));
      const s: WalkableSurface = { id: `${id}/${i}`, roomId, ownerStory: t.ownerStory, layer: 'ground', role: 'floor', bounds: b,
        profile: { kind: 'flat', y }, ceilingY: roof, thickness: .16, support: 'slab', access, edges: 'architecture' };
      if (crawl) s.locomotion = 'crouch';
      if (y > 0) { s.support = 'solid'; s.supportBottom = -.16; }
      if (special.some(s => s.roomId === roomId && s.id.endsWith('/underpass'))) { s.support = 'solid'; s.supportBottom = -1.06; }
      surfaces.push(s);
    }
  };
  for (const r of rooms) addFloors(r.bounds, r.floorY ?? 0, r.ceilingHeight, `vertical/room/${r.id}`, r.id, r.accessReason === 'unreachable' ? 'open' : r.access ?? 'open');
  for (const [i, r] of cutRects([{ minX: -half, maxX: half, minZ: -half, maxZ: half }], rooms.map(r => r.bounds)).entries()) addFloors(r, 0, world.wallHeight, `vertical/residual-${i}`);
  for (const s of special) {
    const pieces = s.layer === 'ground' ? cutRects([s.bounds], openings) : [s.bounds];
    for (const [i, b] of pieces.entries()) {
      const copy = { ...s, id: pieces.length === 1 ? s.id : `${s.id}/cut-${i}`, bounds: b };
      if (s.profile.kind === 'linear') copy.profile = { ...s.profile, startY: surfaceY(s, b.minX, b.minZ), endY: surfaceY(s, b.maxX, b.maxZ) };
      copy.ceilingY = Math.min(s.ceilingY, ...rooms.filter(r => overlapRect(r.bounds, b)).map(r => r.ceilingHeight)); surfaces.push(copy);
    }
  }
  const previousConnections = t.connections; t.surfaces = surfaces;
  const connections: SurfaceConnection[] = [];
  const openableDoors = new Set(world.features.flatMap(f => f.kind === 'interactive-door' ? [f.colliderId] : []));
  const linkAt = (x: number, z: number, id: string, width: number) => {
    const touching = surfaces.filter(s => pointInRect(x, z, s.bounds, -.005));
    for (let a = 0; a < touching.length; a++) for (let b = a + 1; b < touching.length; b++) {
      const first = touching[a]!, second = touching[b]!;
      if (Math.abs(surfaceY(first, x, z) - surfaceY(second, x, z)) > .002) continue;
      connections.push({ id: `${id}/${a}-${b}`, from: first.id, to: second.id, at: { x, z }, width, access: first.access === 'open' && second.access === 'open' ? 'open' : 'sealed' });
    }
  };
  for (const [i, e] of edges.entries()) linkAt(e.x, e.z, `vertical/portal-${i}`, e.width);
  for (const [i, e] of previousConnections.entries()) linkAt(e.at.x, e.at.z, `vertical/reconnected-${i}`, e.width);
  for (const s of surfaces) if (s.profile.kind === 'linear') {
    const p = s.profile, b = s.bounds, c = rectCenter(b);
    linkAt(p.axis === 'x' ? b.minX : c.x, p.axis === 'z' ? b.minZ : c.z, `${s.id}/start`, MIN_ROUTE_WIDTH);
    linkAt(p.axis === 'x' ? b.maxX : c.x, p.axis === 'z' ? b.maxZ : c.z, `${s.id}/end`, MIN_ROUTE_WIDTH);
  }
  for (let i = 0; i < surfaces.length; i++) for (let j = i + 1; j < surfaces.length; j++) {
    const a = surfaces[i]!, b = surfaces[j]!;
    if (a.layer !== b.layer || a.profile.kind !== 'flat' || b.profile.kind !== 'flat' || Math.abs(a.profile.y - b.profile.y) > .002) continue;
    const xMin = Math.max(a.bounds.minX, b.bounds.minX), xMax = Math.min(a.bounds.maxX, b.bounds.maxX), zMin = Math.max(a.bounds.minZ, b.bounds.minZ), zMax = Math.min(a.bounds.maxZ, b.bounds.maxZ);
    const join = (axis: 'x' | 'z', fixed: number, min: number, max: number) => {
      let gaps = [{ min, max }]; const foot = a.profile.kind === 'flat' ? a.profile.y : 0, height = a.locomotion === 'crouch' || b.locomotion === 'crouch' ? 1.2 : 1.75;
      for (const c of world.colliders) {
        if (c.kind === 'floor' || openableDoors.has(c.id) || c.center.y + c.halfExtents.y < foot + .05 || c.center.y - c.halfExtents.y > foot + height) continue;
        const cross = axis === 'x' ? c.center.z : c.center.x, crossHalf = axis === 'x' ? c.halfExtents.z : c.halfExtents.x;
        if (Math.abs(cross - fixed) > crossHalf + .34) continue;
        const along = axis === 'x' ? c.center.x : c.center.z, half = (axis === 'x' ? c.halfExtents.x : c.halfExtents.z) + .34;
        gaps = gaps.flatMap(g => along + half <= g.min || along - half >= g.max ? [g] :
          [{ min: g.min, max: Math.min(g.max, along - half) }, { min: Math.max(g.min, along + half), max: g.max }].filter(g => g.max - g.min > .01));
      }
      // The capsule has already eroded each interval; retain a valid centre band.
      for (const [k, g] of gaps.entries()) if (g.max - g.min > .08) {
        const p = (g.min + g.max) / 2; linkAt(axis === 'x' ? p : fixed, axis === 'z' ? p : fixed, `vertical/join-${i}-${j}-${k}`, Math.min(max - min, g.max - g.min + .68));
      }
    };
    if (xMax - xMin > .7 && Math.abs(zMax - zMin) < .002) join('x', zMin, xMin, xMax);
    if (zMax - zMin > .7 && Math.abs(xMax - xMin) < .002) join('z', xMin, zMin, zMax);
  }
  const seen = new Set<string>(); t.connections = connections.filter(c => { const key = [c.from, c.to].sort().join('|') + `|${c.at.x}:${c.at.z}`; if (seen.has(key)) return false; seen.add(key); return true; });
  t.volumes = surfaces.flatMap(s => { const [lo, hi] = surfaceRange(s); return [
    { id: `${s.id}/clearance`, surfaceId: s.id, bounds: s.bounds, bottom: lo, top: s.ceilingY, purpose: 'clearance' as const, ownerStory: t.ownerStory },
    { id: `${s.id}/structure`, surfaceId: s.id, bounds: s.bounds, bottom: s.supportBottom ?? lo - s.thickness, top: hi, purpose: 'structure' as const, ownerStory: t.ownerStory }]; });
  world.colliders = world.colliders.filter(c => !c.id.startsWith('floor-') && !c.id.startsWith('surface/') && !c.id.startsWith('vertical-roof/') && !c.id.startsWith('collider-vertical-guard/'));
  world.colliders.push(...surfaces.map(surfaceCollider));
  world.walls = world.walls.filter(w => !w.id.startsWith('vertical-guard/'));
  for (const s of surfaces.filter(s => s.layer !== 'ground' && s.profile.kind === 'flat' && s.edges === 'guarded')) {
    const b = s.bounds, y = surfaceRange(s)[0];
    for (const [side, axis, fixed, min, max] of [['north', 'x', b.minZ, b.minX, b.maxX], ['south', 'x', b.maxZ, b.minX, b.maxX], ['west', 'z', b.minX, b.minZ, b.maxZ], ['east', 'z', b.maxX, b.minZ, b.maxZ]] as const) {
      let intervals = [{ min, max }];
      for (const other of surfaces.filter(o => o.id !== s.id)) {
        const r = other.bounds, crossMin = axis === 'x' ? r.minZ : r.minX, crossMax = axis === 'x' ? r.maxZ : r.maxX;
        if (Math.abs(crossMin - fixed) > .01 && Math.abs(crossMax - fixed) > .01) continue;
        const lo = Math.max(min, axis === 'x' ? r.minX : r.minZ), hi = Math.min(max, axis === 'x' ? r.maxX : r.maxZ), mid = (lo + hi) / 2;
        if (hi - lo < .01 || Math.abs(surfaceY(other, axis === 'x' ? mid : fixed, axis === 'z' ? mid : fixed) - y) > .002) continue;
        intervals = intervals.flatMap(g => hi <= g.min || lo >= g.max ? [g] : [{ min: g.min, max: Math.min(g.max, lo) }, { min: Math.max(g.min, hi), max: g.max }].filter(g => g.max - g.min > .02));
      }
      for (const [i, r] of intervals.entries()) {
        const w: WallSegment = { id: `vertical-guard/${s.id}/${side}-${i}`, roomId: s.roomId, x: axis === 'x' ? (r.min + r.max) / 2 : fixed,
          z: axis === 'z' ? (r.min + r.max) / 2 : fixed, length: r.max - r.min, orientation: axis, thickness: .12, bottom: y, height: 1.05, tint: .96, collision: true, kind: 'wallpaper' };
        world.walls.push(w); world.colliders.push(wallCollider(w));
      }
    }
  }
  const roofCuts = [...(world.ceilingOpenings ?? []), ...(world.stairCeilingOpenings ?? [])];
  for (const r of rooms) for (const [i, b] of cutRects([r.bounds], [...roofCuts, ...(t.reservations ?? []).filter(v => v.top > r.ceilingHeight - .002).map(v => v.bounds)]).entries()) {
    const p = rectCenter(b); world.colliders.push({ id: `vertical-roof/${r.id}/${i}`, kind: 'barrier', center: { ...p, y: r.ceilingHeight + CEILING_TILE_THICKNESS / 2 }, halfExtents: { x: rectWidth(b) / 2, y: CEILING_TILE_THICKNESS / 2, z: rectDepth(b) / 2 } });
  }
  world.floorRects = surfaces.filter(s => s.layer === 'ground').map(s => s.bounds);
  const free = (x: number, z: number, y: number) => !world.colliders.some(c => c.kind !== 'floor' && c.kind !== 'step' &&
    x > c.center.x - c.halfExtents.x - .34 && x < c.center.x + c.halfExtents.x + .34 && z > c.center.z - c.halfExtents.z - .34 && z < c.center.z + c.halfExtents.z + .34 && c.center.y + c.halfExtents.y > y + .05 && c.center.y - c.halfExtents.y < y + 1.75);
  const spawnSurface = findSurface(world, { x: world.spawn.x, z: world.spawn.z, referenceY: world.spawn.y - .9 });
  if (spawnSurface && free(world.spawn.x, world.spawn.z, surfaceY(spawnSurface, world.spawn.x, world.spawn.z))) world.spawn.y = surfaceY(spawnSurface, world.spawn.x, world.spawn.z) + .9;
  else {
    const candidate = surfaces.filter(s => s.access === 'open' && s.profile.kind === 'flat' && rectWidth(s.bounds) > 1.6 && rectDepth(s.bounds) > 1.6)
      .map(s => ({ s, p: rectCenter(s.bounds) })).filter(({ s, p }) => s.ceilingY - surfaceY(s, p.x, p.z) >= MIN_CLEARANCE && free(p.x, p.z, surfaceY(s, p.x, p.z)))
      .sort((a, b) => Math.hypot(a.p.x - world.spawn.x, a.p.z - world.spawn.z) - Math.hypot(b.p.x - world.spawn.x, b.p.z - world.spawn.z))[0];
    if (candidate) world.spawn = { ...candidate.p, y: surfaceY(candidate.s, candidate.p.x, candidate.p.z) + .9 };
  }
  classifySurfaceAccess(world);
  const inaccessible = new Set(rooms.filter(r => r.access === 'sealed').map(r => r.id));
  world.lights = world.lights.filter(l => !inaccessible.has(l.roomId));
  world.detailSockets = world.detailSockets.filter(d => !inaccessible.has(d.roomId));
};
