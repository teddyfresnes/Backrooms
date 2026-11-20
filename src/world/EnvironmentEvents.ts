import { SeededRandom } from './SeededRandom';
import { ADDRESS_PITCH, regionalAtrium, regionalCellId, regionalDatum, regionalStyle, spatialCellAt, spatialCellBounds } from './RegionalPlan';
import { isNorthernReservedRow } from './NorthernLayout';
import { planSpatialFeature } from './SpatialFeatures';
import { clipRect, cutRects, findSurface, overlapRect, surfaceY } from './WalkableTopology';
import { pointInRect, rectArea, rectCenter, rectDepth, rectWidth } from './types';
import type { Rect, RoomRecord, Vec3Data, WorldPlan } from './types';

export type EnvironmentEventKind = 'fire-alarm' | 'flicker' | 'flood' | 'telephone' | 'lonely-chair' | 'surveillance';
export interface WallMount { position: Vec3Data; yaw: number; wallId: string }
export interface EnvironmentEventPlan {
  id: string;
  kind: EnvironmentEventKind;
  /** Fragment that contains the zone centre (historical single-room field). */
  roomId: string;
  /** Every BSP fragment of the same physical room: cell slices share no wall. */
  roomIds: string[];
  bounds: Rect;
  floorY: number;
  ceilingY: number;
  /** Stable independent runtime randomness; all positions remain chunk-local. */
  seed: string;
  mount?: WallMount;
  /** Further synchronized alarm units of a long zone. */
  extraMounts?: WallMount[];
  lightIds: string[];
  waterRects?: Rect[];
  drips?: Vec3Data[];
  apparition?: { start: Vec3Data; end: Vec3Data; approach: Vec3Data };
  /** Chair stations: index 0 is the first visit, later ones follow each departure. */
  chair?: { positions: Vec3Data[]; yaws: number[] };
}

export interface EnvironmentEventConfig {
  /** Mean chance per 28 m planning cell, the generator's real granularity. */
  probabilities: Record<EnvironmentEventKind, number>;
  dripChance: number;
  /** Minimum horizontal distance between two zone centres. */
  minSpacing: number;
  /** Zones at least this far apart vertically (two storeys) never meet. */
  verticalSeparation: number;
}
export const ENVIRONMENT_EVENT_CONFIG: Readonly<EnvironmentEventConfig> = {
  probabilities: { 'fire-alarm': .0015, flicker: .005, flood: .006, telephone: .004, 'lonely-chair': .003, surveillance: .005 },
  dripChance: .1,
  minSpacing: 36,
  verticalSeparation: 9,
};
/** A merged room's centre may sit this far from its cell centre (half a cell). */
export const MAX_ROOM_DRIFT = 14;
const kinds = Object.keys(ENVIRONMENT_EVENT_CONFIG.probabilities) as EnvironmentEventKind[];
type Address = { x: number; z: number; story: number };
const mod4 = (n: number) => ((n % 4) + 4) % 4;
/** The four cells that touch no chunk edge: a hall there is always complete. */
const interiorCell = (x: number, z: number) => mod4(x) >= 1 && mod4(x) <= 2 && mod4(z) >= 1 && mod4(z) <= 2;
/** The lonely hall replaces a whole interior cell. Its budget is concentrated on
 * the four interior cells of each chunk, keeping the configured mean density. */
const cellWeight = (kind: EnvironmentEventKind, cell: Address, config: Readonly<EnvironmentEventConfig>): number => {
  const p = Math.max(0, Math.min(1, config.probabilities[kind]));
  return kind !== 'lonely-chair' ? p : interiorCell(cell.x, cell.z) ? p * 4 : 0;
};

/** One trial per existing 28m planning cell, never per floor tile or per frame. */
export const eventProposal = (seed: string, cell: Address, config = ENVIRONMENT_EVENT_CONFIG) => {
  const rng = new SeededRandom(`${seed}:environment:v2:${cell.x}:${cell.z}:${cell.story}`);
  let roll = rng.float(), kind: EnvironmentEventKind | undefined;
  for (const candidate of kinds) {
    roll -= cellWeight(candidate, cell, config);
    if (roll < 0) { kind = candidate; break; }
  }
  const center = rectCenter(spatialCellBounds(cell.x, cell.z));
  return { kind, priority: rng.float(), x: center.x, z: center.z,
    y: regionalDatum(seed, cell.x, cell.z).y + cell.story * ADDRESS_PITCH };
};

/** Matérn thinning: no neighbour generation, cache, or exploration-order dependency.
 * Reserve the maximum displacement of BOTH zone centres, including across chunks.
 * Zones two storeys apart cannot be perceived together and do not compete.
 * Incompatible winning cells simply stay empty. */
export const eventCellAccepted = (seed: string, cell: Address, config = ENVIRONMENT_EVENT_CONFIG): boolean => {
  const own = eventProposal(seed, cell, config);
  if (!own.kind) return false;
  const distance = config.minSpacing + MAX_ROOM_DRIFT * 2 + .1;
  const reach = Math.ceil(distance / 28), vertical = Math.ceil(config.verticalSeparation / ADDRESS_PITCH) + 1;
  for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) {
    if (Math.hypot(dx * 28, dz * 28) >= distance) continue;
    const x = cell.x + dx, z = cell.z + dz;
    const base = regionalDatum(seed, x, z).y;
    const middle = Math.round((own.y - base) / ADDRESS_PITCH);
    for (let story = middle - vertical; story <= middle + vertical; story++) {
      if (x === cell.x && z === cell.z && story === cell.story) continue;
      const next = eventProposal(seed, { x, z, story }, config);
      if (!next.kind || Math.abs(next.y - own.y) >= config.verticalSeparation || Math.hypot(next.x - own.x, next.z - own.z) >= distance) continue;
      if (next.priority < own.priority || (next.priority === own.priority && `${x}:${z}:${story}` < `${cell.x}:${cell.z}:${cell.story}`)) return false;
    }
  }
  return true;
};

/** SpatialWorld asks before partitioning a cell: an accepted lonely-chair cell
 * becomes one empty hall, walled like a district facade with a gate on each
 * side. Only interior maze cells of a single district, with no atrium, no
 * inherited feature and no story reservation, are converted; never forced. */
export const lonelyHallCell = (seed: string, x: number, z: number, story: number): boolean => {
  if (!interiorCell(x, z) || isNorthernReservedRow(Math.floor(z / 4))) return false;
  if (eventProposal(seed, { x, z, story }).kind !== 'lonely-chair') return false;
  const datum = regionalDatum(seed, x, z);
  if (!datum.id.startsWith('district/') || regionalAtrium(seed, x, z, story) || regionalStyle(seed, datum.id).family !== 'maze') return false;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const)
    if (regionalDatum(seed, x + dx, z + dz).id !== datum.id || regionalAtrium(seed, x + dx, z + dz, story)) return false;
  // Same local rectangle as SpatialWorld: the feature planner memoizes by cell.
  const b = spatialCellBounds(x, z), ox = Math.floor(x / 4) * 112, oz = Math.floor(z / 4) * 112;
  if (planSpatialFeature(seed, x, z, story, { minX: b.minX - ox, maxX: b.maxX - ox, minZ: b.minZ - oz, maxZ: b.maxZ - oz })) return false;
  return eventCellAccepted(seed, { x, z, story });
};
export const LONELY_HALL_SUFFIX = '/lonely-hall';
export const lonelyHallRoomId = (x: number, z: number, story: number): string => `${regionalCellId(x, z, story)}${LONELY_HALL_SUFFIX}`;

const inset = (b: Rect, n: number): Rect => ({ minX: b.minX + n, maxX: b.maxX - n, minZ: b.minZ + n, maxZ: b.maxZ - n });
const colliderRect = (c: WorldPlan['colliders'][number], padding = 0): Rect => {
  // Rotated hulls are conservatively rejected; do not place on stairs/ramps.
  const r = c.rotation ? Math.hypot(c.halfExtents.x, c.halfExtents.z) : 0;
  return { minX: c.center.x - (r || c.halfExtents.x) - padding, maxX: c.center.x + (r || c.halfExtents.x) + padding,
    minZ: c.center.z - (r || c.halfExtents.z) - padding, maxZ: c.center.z + (r || c.halfExtents.z) + padding };
};
const wallRect = (w: WorldPlan['walls'][number]): Rect => ({
  minX: w.x - (w.orientation === 'x' ? w.length : w.thickness) / 2, maxX: w.x + (w.orientation === 'x' ? w.length : w.thickness) / 2,
  minZ: w.z - (w.orientation === 'z' ? w.length : w.thickness) / 2, maxZ: w.z + (w.orientation === 'z' ? w.length : w.thickness) / 2 });
export const clearEventFootprint = (plan: WorldPlan, b: Rect, floor: number, height = 2.5): boolean => {
  if ((plan.floorOpenings ?? []).some(h => overlapRect(b, h, .15))) return false;
  if (plan.colliders.some(c => c.kind !== 'floor' && c.center.y + c.halfExtents.y > floor + .08
    && c.center.y - c.halfExtents.y < floor + height && overlapRect(b, colliderRect(c)))) return false;
  for (const x of [b.minX, (b.minX + b.maxX) / 2, b.maxX]) for (const z of [b.minZ, (b.minZ + b.maxZ) / 2, b.maxZ]) {
    const s = findSurface(plan, { x, z, referenceY: floor + .1, maxAbove: .05, maxBelow: .25 });
    if (!s || s.profile.kind !== 'flat' || s.access !== 'open' || Math.abs(surfaceY(s, x, z) - floor) > .02) return false;
  }
  return true;
};

/** Full-height walls along one segment: walled fraction and longest opening. */
const segmentEnclosure = (plan: WorldPlan, alongZ: boolean, line: number, lo: number, hi: number, floor: number): { covered: number; gap: number } => {
  const spans: [number, number][] = [];
  for (const w of plan.walls) {
    if (!w.collision || w.bottom > floor + .2 || w.bottom + w.height < floor + 2) continue;
    const r = wallRect(w);
    if (alongZ ? r.minX - .35 > line || r.maxX + .35 < line : r.minZ - .35 > line || r.maxZ + .35 < line) continue;
    const a = Math.max(lo, alongZ ? r.minZ : r.minX), c = Math.min(hi, alongZ ? r.maxZ : r.maxX);
    if (c > a) spans.push([a, c]);
  }
  spans.sort((p, q) => p[0] - q[0]);
  let covered = 0, cursor = lo, gap = 0;
  for (const [a, c] of spans) { if (c <= cursor) continue; gap = Math.max(gap, a - cursor); covered += c - Math.max(a, cursor); cursor = c; }
  gap = Math.max(gap, hi - cursor);
  return { covered: hi > lo ? covered / (hi - lo) : 1, gap };
};
/** A zone whose lighting or water stops at its bounds must be a closed room:
 * doorways are fine, an open side would draw a straight seam through a space. */
export const zoneEnclosed = (plan: WorldPlan, b: Rect, floor: number, maxGap = 4.6): boolean =>
  ([[true, b.minX, b.minZ, b.maxZ], [true, b.maxX, b.minZ, b.maxZ], [false, b.minZ, b.minX, b.maxX], [false, b.maxZ, b.minX, b.maxX]] as const)
    .every(([alongZ, line, lo, hi]) => { const e = segmentEnclosure(plan, alongZ, line, lo, hi, floor); return e.covered >= .5 && e.gap <= maxGap; });

export interface EventZone { room: RoomRecord; roomIds: string[]; bounds: Rect; floorY: number; ceilingY: number }
const bspSource = (room: RoomRecord): string | undefined => { const i = room.id.indexOf('/bsp/'); return i < 0 ? undefined : room.id.slice(i + 5); };
/** Regional cells crop one canonical BSP room into several records. Merge the
 * fragments of the same source room that meet on an unwalled seam, so an event
 * covers the room the player actually sees. Non-rectangular unions are dropped. */
export const eventZones = (plan: WorldPlan): EventZone[] => {
  const groups = new Map<string, RoomRecord[]>();
  for (const room of plan.rooms) {
    const source = bspSource(room);
    const key = source ? `${source}|${(room.floorY ?? 0).toFixed(3)}|${room.ceilingHeight.toFixed(3)}` : `solo|${room.id}`;
    groups.set(key, [...(groups.get(key) ?? []), room]);
  }
  const zones: EventZone[] = [];
  for (const rooms of groups.values()) {
    const parent = rooms.map((_, i) => i), find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]!));
    for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i]!.bounds, b = rooms[j]!.bounds, floor = rooms[i]!.floorY ?? 0;
      const seamX = Math.abs(a.maxX - b.minX) < .01 ? a.maxX : Math.abs(b.maxX - a.minX) < .01 ? a.minX : undefined;
      const seamZ = Math.abs(a.maxZ - b.minZ) < .01 ? a.maxZ : Math.abs(b.maxZ - a.minZ) < .01 ? a.minZ : undefined;
      let open = false;
      if (seamX !== undefined) { const lo = Math.max(a.minZ, b.minZ), hi = Math.min(a.maxZ, b.maxZ); open = hi - lo > .5 && segmentEnclosure(plan, true, seamX, lo, hi, floor).covered < .5; }
      else if (seamZ !== undefined) { const lo = Math.max(a.minX, b.minX), hi = Math.min(a.maxX, b.maxX); open = hi - lo > .5 && segmentEnclosure(plan, false, seamZ, lo, hi, floor).covered < .5; }
      if (open) parent[find(i)] = find(j);
    }
    const components = new Map<number, RoomRecord[]>();
    rooms.forEach((room, i) => components.set(find(i), [...(components.get(find(i)) ?? []), room]));
    for (const parts of components.values()) {
      const bounds = { minX: Math.min(...parts.map(r => r.bounds.minX)), maxX: Math.max(...parts.map(r => r.bounds.maxX)),
        minZ: Math.min(...parts.map(r => r.bounds.minZ)), maxZ: Math.max(...parts.map(r => r.bounds.maxZ)) };
      if (Math.abs(parts.reduce((sum, r) => sum + rectArea(r.bounds), 0) - rectArea(bounds)) > .5) continue;
      const c = rectCenter(bounds), room = parts.find(r => pointInRect(c.x, c.z, r.bounds)) ?? parts[0]!;
      zones.push({ room, roomIds: parts.map(r => r.id).sort(), bounds, floorY: room.floorY ?? 0, ceilingY: room.ceilingHeight });
    }
  }
  return zones;
};

/** Every usable mount on the real faces bounding a zone, nearest the centre first. */
export const findEventWallMounts = (plan: WorldPlan, room: RoomRecord, high: boolean): WallMount[] => {
  const floor = room.floorY ?? 0, h = room.ceilingHeight - floor, mounts: WallMount[] = [];
  const y = high ? floor + Math.min(h - .48, 2.55) : floor + 1.45;
  const center = rectCenter(room.bounds);
  for (const wall of plan.walls) {
    if (!wall.collision || wall.junctionRole || wall.length < 1.2 || wall.bottom > y - .35 || wall.bottom + wall.height < y + .35) continue;
    const along = wall.orientation === 'x' ? Math.max(wall.x - wall.length / 2 + .55, Math.min(center.x, wall.x + wall.length / 2 - .55))
      : Math.max(wall.z - wall.length / 2 + .55, Math.min(center.z, wall.z + wall.length / 2 - .55));
    for (const sign of [-1, 1]) {
      const position = wall.orientation === 'x'
        ? { x: along, y, z: wall.z + sign * (wall.thickness / 2 + .015) }
        : { x: wall.x + sign * (wall.thickness / 2 + .015), y, z: along };
      const nx = wall.orientation === 'x' ? 0 : sign, nz = wall.orientation === 'x' ? sign : 0;
      const approach = { x: position.x + nx * .9, z: position.z + nz * .9 };
      if (!pointInRect(approach.x, approach.z, room.bounds, .3)) continue;
      const b = { minX: approach.x - .4, maxX: approach.x + .4, minZ: approach.z - .4, maxZ: approach.z + .4 };
      if (!clearEventFootprint(plan, b, floor)) continue;
      // Ensure the whole casing is on the room side, with no perpendicular wall.
      const body = { minX: position.x + nx * .22 - .3, maxX: position.x + nx * .22 + .3,
        minZ: position.z + nz * .22 - .3, maxZ: position.z + nz * .22 + .3 };
      if (plan.walls.some(w => w !== wall && w.collision && w.bottom < y + .4 && w.bottom + w.height > y - .4 && overlapRect(body, wallRect(w)))) continue;
      mounts.push({ position, yaw: Math.atan2(nx, nz), wallId: wall.id });
    }
  }
  return mounts;
};
/** Historical single mount: the first valid face in wall order. */
export const findEventWallMount = (plan: WorldPlan, room: RoomRecord, high: boolean): WallMount | undefined => findEventWallMounts(plan, room, high)[0];

interface EventDefinition {
  /** Lighting, water and the hall cover the zone: it has to be a closed room. */
  enclosed: boolean;
  eligible(zone: EventZone): boolean;
  prepare(plan: WorldPlan, event: EnvironmentEventPlan, zone: EventZone, rng: SeededRandom, config: Readonly<EnvironmentEventConfig>): boolean;
}
const zoneRoom = (zone: EventZone): RoomRecord => ({ ...zone.room, bounds: zone.bounds });
const ordinary = (zone: EventZone) => rectWidth(zone.bounds) >= 4 && rectDepth(zone.bounds) >= 4;
const wallEvent = (high: boolean): EventDefinition => ({ enclosed: false, eligible: ordinary, prepare(plan, event, zone) {
  event.mount = findEventWallMount(plan, zoneRoom(zone), high); return !!event.mount;
} });
const wrapAngle = (r: number) => Math.atan2(Math.sin(r), Math.cos(r));
export const ENVIRONMENT_EVENT_DEFINITIONS: Readonly<Record<EnvironmentEventKind, EventDefinition>> = {
  'fire-alarm': { enclosed: true, eligible: ordinary, prepare(plan, event, zone) {
    const mounts = findEventWallMounts(plan, zoneRoom(zone), true);
    event.mount = mounts[0]; if (!event.mount) return false;
    // A long zone gets a second synchronized unit, far from the first, so the
    // red pulse reaches its whole length without one oversized light radius.
    if (Math.max(rectWidth(zone.bounds), rectDepth(zone.bounds)) >= 16) {
      const first = event.mount.position, far = mounts.map(m => ({ m, d: Math.hypot(m.position.x - first.x, m.position.z - first.z) }))
        .filter(c => c.d >= 10).sort((a, b) => b.d - a.d || a.m.wallId.localeCompare(b.m.wallId))[0];
      if (far) event.extraMounts = [far.m];
    }
    return true;
  } },
  telephone: wallEvent(false), surveillance: wallEvent(true),
  flicker: { enclosed: true, eligible: z => Math.max(rectWidth(z.bounds), rectDepth(z.bounds)) >= 11 && Math.min(rectWidth(z.bounds), rectDepth(z.bounds)) >= 4,
    prepare(plan, event, zone) {
      if (event.lightIds.length < 2) return false;
      const b = inset(zone.bounds, 1.5), c = rectCenter(b), alongX = rectWidth(b) > rectDepth(b);
      const start = { x: alongX ? b.maxX - 1 : c.x - .8, y: event.floorY, z: alongX ? c.z - .8 : b.maxZ - 1 };
      const end = { ...start, x: start.x + (alongX ? 0 : .4), z: start.z + (alongX ? .4 : 0) };
      const approach = { x: alongX ? b.minX : c.x, y: event.floorY + 1.65, z: alongX ? c.z : b.minZ };
      const path = { minX: Math.min(start.x, end.x, approach.x) - .75, maxX: Math.max(start.x, end.x, approach.x) + .75,
        minZ: Math.min(start.z, end.z, approach.z) - .75, maxZ: Math.max(start.z, end.z, approach.z) + .75 };
      if (!clearEventFootprint(plan, path, event.floorY)) return false;
      event.apparition = { start, end, approach }; return true;
    } },
  flood: { enclosed: true, eligible: ordinary, prepare(plan, event, zone, rng, config) {
    const ids = new Set(zone.roomIds);
    const surfaces = plan.topology?.surfaces.filter(s => !!s.roomId && ids.has(s.roomId) && s.profile.kind === 'flat' && Math.abs(s.profile.y - event.floorY) < .02 && s.access === 'open') ?? [];
    const cuts = plan.colliders.filter(c => c.kind !== 'floor' && c.center.y + c.halfExtents.y > event.floorY + .01 && c.center.y - c.halfExtents.y < event.floorY + .07).map(c => colliderRect(c, .025));
    const boundary = inset(zone.bounds, .025);
    const patches = surfaces.flatMap(s => { const clipped = clipRect(s.bounds, boundary); return clipped ? [clipped] : []; });
    event.waterRects = cutRects(patches, [...cuts, ...(plan.floorOpenings ?? []).map(h => inset(h, -.05))], .12).filter(b => rectArea(b) > .3);
    if (!event.waterRects.length || event.waterRects.length > 32) return false;
    event.drips = [];
    if (rng.chance(config.dripChance)) for (const rect of rng.shuffle(event.waterRects).slice(0, rng.int(1, 3))) {
      if (rectWidth(rect) < 1 || rectDepth(rect) < 1) continue;
      const c = rectCenter(rect);
      if (!(plan.ceilingOpenings ?? []).some(h => pointInRect(c.x, c.z, h, -.1))) event.drips.push({ x: c.x, y: event.ceilingY - .06, z: c.z });
    }
    return true;
  } },
  // Only the hall that SpatialWorld built for this very cell; never a borrowed room.
  'lonely-chair': { enclosed: true, eligible: z => z.room.id.endsWith(LONELY_HALL_SUFFIX) && Math.min(rectWidth(z.bounds), rectDepth(z.bounds)) >= 18,
    prepare(plan, event, zone, rng) {
      // The hall owns the inner half of its facades (up to 1.2 m thick).
      if (!clearEventFootprint(plan, inset(zone.bounds, 1.35), event.floorY)) return false;
      // A short wandering path near the middle: each step is subtle but plain
      // (1.6-3.4 m, a quarter turn or so), always far from walls and doorways.
      const c = rectCenter(zone.bounds), y = event.floorY, walk = rng.fork('chair-walk');
      const positions: Vec3Data[] = [{ ...c, y }], yaws = [walk.float(-.35, .35)];
      for (let i = 1; i < 6; i++) {
        const previous = positions[i - 1]!;
        for (let attempt = 0; attempt < 16; attempt++) {
          const angle = walk.float(0, Math.PI * 2), step = walk.float(1.6, 3.4);
          const p = { x: previous.x + Math.cos(angle) * step, y, z: previous.z + Math.sin(angle) * step };
          if (!pointInRect(p.x, p.z, zone.bounds, 6) || Math.hypot(p.x - c.x, p.z - c.z) > 7) continue;
          positions.push(p); yaws.push(wrapAngle(yaws[i - 1]! + (walk.chance(.5) ? 1 : -1) * walk.float(.5, 1.4))); break;
        }
        if (positions.length === i) { positions.push({ x: c.x + (i % 2 ? 2 : -2), y, z: c.z + (i % 3 ? 1.5 : -1.5) }); yaws.push(wrapAngle(yaws[i - 1]! + .9)); }
      }
      event.chair = { positions, yaws };
      return true;
    } },
};

const EXCLUDED_FEATURE = (kind: string) => kind !== 'interactive-door';
export const populateEnvironmentEvents = (plan: WorldPlan, seed: string, owner: Address, config = ENVIRONMENT_EVENT_CONFIG): void => {
  plan.environmentEvents = [];
  if (plan.northern?.kind === 'red-zone' || plan.northern?.kind === 'slides-approach') return;
  if (!plan.spatial || plan.features.some(f => f.kind === 'epic-structure')) return;
  const ox = owner.x * 112, oz = owner.z * 112;
  const used = new Set<string>();
  let zones: EventZone[] | undefined;
  const zoneEligible = (zone: EventZone): boolean => {
    const parts = plan.rooms.filter(r => zone.roomIds.includes(r.id));
    return parts.every(room => room.access !== 'sealed' && room.access !== 'secret' && room.ceilingHeight - (room.floorY ?? 0) >= 2.7
      && !plan.northern?.circuits.some(c => c.roomId === room.id)
      && !plan.topology?.surfaces.some(s => s.roomId === room.id && (s.profile.kind !== 'flat' || s.access !== 'open')))
      && zone.bounds.minX > -55 && zone.bounds.maxX < 55 && zone.bounds.minZ > -55 && zone.bounds.maxZ < 55
      && !plan.features.some(f => EXCLUDED_FEATURE(f.kind) && overlapRect(zone.bounds, f.bounds, .5))
      && !(plan.symmetryZones ?? []).some(b => overlapRect(zone.bounds, b));
  };
  for (let z = owner.z * 4; z < owner.z * 4 + 4; z++) for (let x = owner.x * 4; x < owner.x * 4 + 4; x++) {
    const address = { x, z, story: owner.story }, trial = eventProposal(seed, address, config);
    if (!trial.kind || !eventCellAccepted(seed, address, config)) continue;
    const definition = ENVIRONMENT_EVENT_DEFINITIONS[trial.kind];
    zones ??= eventZones(plan).filter(zoneEligible);
    const drift = (zone: EventZone) => { const c = rectCenter(zone.bounds); return Math.hypot(c.x + ox - trial.x, c.z + oz - trial.z); };
    const candidates = zones.filter(zone => {
      const c = rectCenter(zone.bounds), cell = spatialCellAt(c.x + ox, c.z + oz);
      return cell.x === x && cell.z === z && drift(zone) <= MAX_ROOM_DRIFT
        && Math.abs(zone.floorY + owner.story * ADDRESS_PITCH - trial.y) < .02
        && !zone.roomIds.some(id => used.has(id)) && definition.eligible(zone)
        && (!definition.enclosed || zoneEnclosed(plan, zone.bounds, zone.floorY));
    }).sort((a, b) => drift(a) - drift(b) || a.room.id.localeCompare(b.room.id));
    for (const zone of candidates) {
      const ids = new Set(zone.roomIds);
      const event: EnvironmentEventPlan = { id: `environment/v2/${x}/${z}/${owner.story}`, kind: trial.kind, roomId: zone.room.id, roomIds: [...zone.roomIds],
        bounds: { ...zone.bounds }, floorY: zone.floorY, ceilingY: zone.ceilingY,
        seed: `${seed}:environment:v2:${x}:${z}:${owner.story}`, lightIds: plan.lights.filter(l => ids.has(l.roomId) && !l.dead).map(l => l.id) };
      if (!definition.prepare(plan, event, zone, new SeededRandom(event.seed), config)) continue;
      plan.environmentEvents.push(event); zone.roomIds.forEach(id => used.add(id));
      // Furniture generation consumes the reservation; no decorative sockets in the empty room.
      if (event.kind === 'lonely-chair') plan.detailSockets = plan.detailSockets.filter(s => !ids.has(s.roomId));
      break;
    }
  }
};
