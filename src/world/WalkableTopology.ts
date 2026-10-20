import type { Rect, RoomAccess, StaticCollider, WorldPlan } from './types';
import { pointInRect, rectDepth, rectWidth } from './types';
import type { SpatialAddress } from './SpatialTypes';

export const TOPOLOGY_VERSION = 2;
export const SURFACE_EPSILON = .002;
export const HEIGHT_QUANTUM = .05;
export const MIN_CLEARANCE = 2.5;
export const MIN_ROUTE_WIDTH = 1.6;
export const MAX_RAMP_GRADE = .42;
export const SLAB_THICKNESS = .16;
/** Suspended ceiling tiles are separate from the structural floor above. */
export const CEILING_TILE_THICKNESS = .03;
export const LOWEST_STRUCTURE_Y = -1.06;
export type HeightProfile = { kind: 'flat'; y: number } | { kind: 'linear'; axis: 'x' | 'z'; startY: number; endY: number };
export interface WalkableSurface {
  id: string; roomId?: string; ownerStory: number; layer: string;
  role: 'floor' | 'ramp' | 'stair' | 'landing' | 'balcony' | 'bridge'; bounds: Rect; profile: HeightProfile;
  ceilingProfile?: HeightProfile;
  ceilingY: number; thickness: number; support: 'slab' | 'solid'; supportBottom?: number;
  access: RoomAccess; edges: 'architecture' | 'guarded' | 'drop'; reachable?: boolean; locomotion?: 'stand' | 'crouch';
  reachability?: 'local' | 'regional' | 'visible-only' | 'isolated';
  openEdges?: ('north' | 'east' | 'south' | 'west')[];
}
export interface SurfaceConnection {
  id: string; from: string; to: string; at: { x: number; z: number }; width: number; access: RoomAccess;
  kind?: 'walk' | 'ramp' | 'stairs' | 'crouch' | 'jump' | 'drop' | 'view';
  direction?: 'both' | 'forward';
  arrival?: { x: number; y: number; z: number };
  /** External endpoints belong to real generated plans, never previews. */
  toOwner?: SpatialAddress;
  targetKind?: 'surface' | 'portal';
}
export interface StructuralVolume { id: string; surfaceId: string; bounds: Rect; bottom: number; top: number; purpose: 'clearance' | 'structure'; ownerStory: number }
export interface VerticalReservation { id: string; bounds: Rect; bottom: number; top: number; ownerStory: number }
export interface WalkableTopology {
  version: number; ownerStory: number; surfaces: WalkableSurface[]; connections: SurfaceConnection[];
  volumes: StructuralVolume[]; diagnostics: { id: string; reason: string }[]; reservations?: VerticalReservation[];
  portals?: { x: number; z: number; width: number; orientation: 'x' | 'z'; firstRoomId: string; secondRoomId: string }[];
}
export const overlapRect = (a: Rect, b: Rect, padding = 0): boolean => a.minX < b.maxX + padding && a.maxX > b.minX - padding && a.minZ < b.maxZ + padding && a.maxZ > b.minZ - padding;
export const clipRect = (a: Rect, b: Rect): Rect | undefined => overlapRect(a, b) ? {
  minX: Math.max(a.minX, b.minX), maxX: Math.min(a.maxX, b.maxX), minZ: Math.max(a.minZ, b.minZ), maxZ: Math.min(a.maxZ, b.maxZ) } : undefined;
export const cutRects = (input: readonly Rect[], cuts: readonly Rect[]): Rect[] => {
  let pieces = [...input];
  for (const cut of cuts) pieces = pieces.flatMap(r => {
    const c = clipRect(r, cut); if (!c) return [r];
    return [{ ...r, maxX: c.minX }, { ...r, minX: c.maxX },
      { minX: c.minX, maxX: c.maxX, minZ: r.minZ, maxZ: c.minZ },
      { minX: c.minX, maxX: c.maxX, minZ: c.maxZ, maxZ: r.maxZ }].filter(p => rectWidth(p) > .001 && rectDepth(p) > .001);
  });
  return pieces;
};
export const surfaceY = (s: WalkableSurface, x: number, z: number): number => {
  const p = s.profile; if (p.kind === 'flat') return p.y;
  const t = p.axis === 'x' ? (x - s.bounds.minX) / rectWidth(s.bounds) : (z - s.bounds.minZ) / rectDepth(s.bounds);
  return p.startY + (p.endY - p.startY) * Math.max(0, Math.min(1, t));
};
export const surfaceRange = (s: WalkableSurface): [number, number] => s.profile.kind === 'flat' ? [s.profile.y, s.profile.y] : [Math.min(s.profile.startY, s.profile.endY), Math.max(s.profile.startY, s.profile.endY)];
export const surfaceNormal = (s: WalkableSurface): { x: number; y: number; z: number } => {
  const p = s.profile; if (p.kind === 'flat') return { x: 0, y: 1, z: 0 };
  const slope = (p.endY - p.startY) / (p.axis === 'x' ? rectWidth(s.bounds) : rectDepth(s.bounds));
  const n = Math.hypot(1, slope); return { x: p.axis === 'x' ? -slope / n : 0, y: 1 / n, z: p.axis === 'z' ? -slope / n : 0 };
};
export const findSurface = (world: Pick<WorldPlan, 'topology'>, q: { x: number; z: number; referenceY: number; layer?: string; maxAbove?: number; maxBelow?: number }): WalkableSurface | undefined => {
  let found: WalkableSurface | undefined, distance = Infinity;
  for (const s of world.topology?.surfaces ?? []) {
    if (q.layer && s.layer !== q.layer || !pointInRect(q.x, q.z, s.bounds, -.001)) continue;
    const delta = surfaceY(s, q.x, q.z) - q.referenceY;
    if (delta > (q.maxAbove ?? .38) || delta < -(q.maxBelow ?? 1.2)) continue;
    if (Math.abs(delta) < distance) { found = s; distance = Math.abs(delta); }
  }
  return found;
};
/** Four top vertices followed by the exact underside, extruded along the normal. */
export const slabVertices = (s: WalkableSurface): number[] => {
  const b = s.bounds, n = surfaceNormal(s), result: number[] = [];
  for (const [x, z] of [[b.minX, b.minZ], [b.minX, b.maxZ], [b.maxX, b.maxZ], [b.maxX, b.minZ]]) result.push(x!, surfaceY(s, x!, z!), z!);
  for (let i = 0; i < 12; i += 3) {
    if (s.support === 'solid') result.push(result[i]!, s.supportBottom ?? surfaceRange(s)[0] - s.thickness, result[i + 2]!);
    else result.push(result[i]! - n.x * s.thickness, result[i + 1]! - n.y * s.thickness, result[i + 2]! - n.z * s.thickness);
  }
  return result;
};
export const SLAB_INDICES = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
export const surfaceCollider = (s: WalkableSurface): StaticCollider => {
  const points = slabVertices(s), xs = points.filter((_, i) => i % 3 === 0), ys = points.filter((_, i) => i % 3 === 1), zs = points.filter((_, i) => i % 3 === 2);
  const lo = { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) }, hi = { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) };
  const center = { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2, z: (lo.z + hi.z) / 2 };
  return { id: `surface/${s.id}`, kind: 'floor', center, halfExtents: { x: (hi.x - lo.x) / 2, y: (hi.y - lo.y) / 2, z: (hi.z - lo.z) / 2 },
    ...(s.profile.kind === 'linear' ? { vertices: points.map((v, i) => v - (i % 3 === 0 ? center.x : i % 3 === 1 ? center.y : center.z)) } : {}) };
};
export const prefixTopology = (world: WorldPlan, prefix: string, story: number): void => {
  const t = world.topology; if (!t) return; t.ownerStory = story;
  for (const s of t.surfaces) { s.id = prefix + s.id; s.layer = prefix + s.layer; s.ownerStory = story; if (s.roomId) s.roomId = prefix + s.roomId; }
  for (const c of t.connections) { c.id = prefix + c.id; c.from = prefix + c.from; c.to = c.targetKind === 'portal' ? c.to : c.toOwner ? `chunk-${c.toOwner.x}:${c.toOwner.z}:${c.toOwner.story}/` + c.to : prefix + c.to; }
  for (const v of t.volumes) { v.id = prefix + v.id; v.surfaceId = prefix + v.surfaceId; v.ownerStory = story; }
  for (const p of t.portals ?? []) { p.firstRoomId = prefix + p.firstRoomId; p.secondRoomId = prefix + p.secondRoomId; }
  for (const r of t.reservations ?? []) r.id = prefix + r.id;
  for (const d of t.diagnostics) d.id = prefix + d.id;
  if (world.spatial) {
    for (const i of world.spatial.interfaces) i.surfaceId = prefix + i.surfaceId;
    for (const p of world.spatial.prisms) p.id = prefix + p.id;
    for (const s of world.spatial.ceilings) { s.id = prefix + s.id; if (s.roomId) s.roomId = prefix + s.roomId; }
    for (const c of world.spatial.cells) c.id = prefix + c.id;
  }
};
export const validateTopology = (w: WorldPlan): string[] => {
  const t = w.topology; if (!t) return [];
  const issues: string[] = [], ids = new Set<string>();
  const issue = (id: string, reason: string) => issues.push(`${w.seed} story=${t.ownerStory} surface=${id}: ${reason}`);
  for (const s of t.surfaces) {
    if (ids.has(s.id)) issue(s.id, 'duplicate ID'); ids.add(s.id);
    const [lo, hi] = surfaceRange(s), crawl = s.locomotion === 'crouch';
    if (![lo, hi, s.ceilingY, ...Object.values(s.bounds)].every(Number.isFinite)) issue(s.id, 'non-finite profile');
    if (rectWidth(s.bounds) <= 0 || rectDepth(s.bounds) <= 0) issue(s.id, 'empty footprint');
    const clearance = s.ceilingProfile ? Math.min(...[[s.bounds.minX, s.bounds.minZ], [s.bounds.maxX, s.bounds.maxZ]].map(([x, z]) =>
      surfaceY({ ...s, profile: s.ceilingProfile! }, x!, z!) - surfaceY(s, x!, z!))) : s.ceilingY - hi;
    if (s.access === 'open' && clearance < (crawl ? 1.28 : MIN_CLEARANCE) - SURFACE_EPSILON) issue(s.id, 'insufficient clearance');
    if (s.profile.kind === 'linear') {
      const run = s.profile.axis === 'x' ? rectWidth(s.bounds) : rectDepth(s.bounds), width = s.profile.axis === 'x' ? rectDepth(s.bounds) : rectWidth(s.bounds);
      if (!crawl && (hi - lo) / run > MAX_RAMP_GRADE + SURFACE_EPSILON) issue(s.id, 'slope exceeds budget');
      if (width < (crawl ? .75 : MIN_ROUTE_WIDTH) - SURFACE_EPSILON) issue(s.id, 'route narrower than budget');
    }
  }
  const byId = new Map(t.surfaces.map(s => [s.id, s]));
  for (const c of t.connections) {
    const a = byId.get(c.from), b = byId.get(c.to);
    if (!a || (!b && !c.toOwner)) { issue(c.id, 'orphan connection'); continue; }
    if (c.toOwner) { if (!c.arrival || !Object.values(c.arrival).every(Number.isFinite)) issue(c.id, 'external connection without a finite arrival'); continue; }
    if (!b) continue;
    if (c.kind === 'view' || c.kind === 'drop' || c.kind === 'jump') {
      if (c.kind === 'drop' && c.direction !== 'forward') issue(c.id, 'drop must be directed');
      continue;
    }
    if (!pointInRect(c.at.x, c.at.z, a.bounds, -.01) || !pointInRect(c.at.x, c.at.z, b.bounds, -.01)) issue(c.id, 'connection outside surface');
    if (Math.abs(surfaceY(a, c.at.x, c.at.z) - surfaceY(b, c.at.x, c.at.z)) > (c.kind === 'stairs' ? .19 : SURFACE_EPSILON)) issue(c.id, 'discontinuous connection');
  }
  return issues;
};
export const classifySurfaceAccess = (world: WorldPlan): void => {
  const t = world.topology; if (!t) return;
  const edges = new Map(t.surfaces.map(s => [s.id, [] as string[]]));
  for (const c of t.connections) if (c.access === 'open' && c.kind !== 'view') { edges.get(c.from)?.push(c.to); if (c.direction !== 'forward') edges.get(c.to)?.push(c.from); }
  const start = findSurface(world, { x: world.spawn.x, z: world.spawn.z, referenceY: world.spawn.y - .9 });
  const queue = t.surfaces.filter(s => s.id.includes('/seam-') && s.role === 'landing').map(s => s.id); if (start) queue.push(start.id);
  const reached = new Set(queue);
  for (let i = 0; i < queue.length; i++) for (const id of edges.get(queue[i]!) ?? []) if (!reached.has(id)) { reached.add(id); queue.push(id); }
  for (const s of t.surfaces) {
    s.reachable = reached.has(s.id) ? true : world.spatial ? undefined : false;
    if (world.spatial) s.reachability = reached.has(s.id) ? 'local' : 'regional';
  }
  // The regional graph includes directed/external routes. A local flood fill
  // cannot classify an entire visible region as sealed or remove its lights.
  if (world.spatial) return;
  for (const room of world.rooms.filter(r => r.level === 0 && r.accessReason !== 'intentional')) {
    if (t.surfaces.some(s => s.roomId === room.id && s.reachable)) {
      room.access = 'open'; if (room.accessReason === 'unreachable') delete room.accessReason;
    } else {
      room.access = 'sealed'; room.accessReason = 'unreachable'; room.detailDensity = 0;
      if (!t.diagnostics.some(d => d.id === room.id && d.reason === 'no body-compatible route from the spawn or a canonical seam')) t.diagnostics.push({ id: room.id, reason: 'no body-compatible route from the spawn or a canonical seam' });
    }
  }
};
