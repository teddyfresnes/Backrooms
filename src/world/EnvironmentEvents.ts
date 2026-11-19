import { SeededRandom } from './SeededRandom';
import { ADDRESS_PITCH, regionalDatum, spatialCellAt, spatialCellBounds } from './RegionalPlan';
import { clipRect, cutRects, findSurface, overlapRect, surfaceY } from './WalkableTopology';
import { pointInRect, rectArea, rectCenter, rectDepth, rectWidth } from './types';
import type { Rect, RoomRecord, Vec3Data, WorldPlan } from './types';

export type EnvironmentEventKind = 'fire-alarm' | 'flicker' | 'flood' | 'telephone' | 'lonely-chair' | 'surveillance';
export interface WallMount { position: Vec3Data; yaw: number; wallId: string }
export interface EnvironmentEventPlan {
  id: string;
  kind: EnvironmentEventKind;
  roomId: string;
  bounds: Rect;
  floorY: number;
  ceilingY: number;
  /** Stable independent runtime randomness; all positions remain chunk-local. */
  seed: string;
  mount?: WallMount;
  lightIds: string[];
  waterRects?: Rect[];
  drips?: Vec3Data[];
  apparition?: { start: Vec3Data; end: Vec3Data; approach: Vec3Data };
  chair?: { positions: Vec3Data[]; yaws: number[] };
}

export interface EnvironmentEventConfig {
  probabilities: Record<EnvironmentEventKind, number>;
  dripChance: number;
  minSpacing: number;
}
export const ENVIRONMENT_EVENT_CONFIG: Readonly<EnvironmentEventConfig> = {
  probabilities: { 'fire-alarm': .0015, flicker: .005, flood: .006, telephone: .004, 'lonely-chair': .003, surveillance: .005 },
  dripChance: .1,
  minSpacing: 36,
};
const MAX_ROOM_DRIFT = 8;
const kinds = Object.keys(ENVIRONMENT_EVENT_CONFIG.probabilities) as EnvironmentEventKind[];
type Address = { x: number; z: number; story: number };

/** One trial per existing 28m planning cell, never per floor tile or per frame. */
export const eventProposal = (seed: string, cell: Address, config = ENVIRONMENT_EVENT_CONFIG) => {
  const rng = new SeededRandom(`${seed}:environment:v1:${cell.x}:${cell.z}:${cell.story}`);
  let roll = rng.float(), kind: EnvironmentEventKind | undefined;
  for (const candidate of kinds) {
    roll -= Math.max(0, Math.min(1, config.probabilities[candidate]));
    if (roll < 0) { kind = candidate; break; }
  }
  const center = rectCenter(spatialCellBounds(cell.x, cell.z));
  return { kind, priority: rng.float(), x: center.x, z: center.z,
    y: regionalDatum(seed, cell.x, cell.z).y + cell.story * ADDRESS_PITCH };
};

/** Matérn thinning: no neighbour generation, cache, or exploration-order dependency.
 * Reserve the maximum displacement of BOTH room centres, including across chunks
 * and vertically offset districts. Incompatible winning cells simply stay empty. */
export const eventCellAccepted = (seed: string, cell: Address, config = ENVIRONMENT_EVENT_CONFIG): boolean => {
  const own = eventProposal(seed, cell, config);
  if (!own.kind) return false;
  const distance = config.minSpacing + MAX_ROOM_DRIFT * 2 + .1;
  const reach = Math.ceil(distance / 28), vertical = Math.ceil(distance / ADDRESS_PITCH);
  for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) {
    if (Math.hypot(dx * 28, dz * 28) >= distance) continue;
    const x = cell.x + dx, z = cell.z + dz;
    const base = regionalDatum(seed, x, z).y;
    const middle = Math.round((own.y - base) / ADDRESS_PITCH);
    for (let story = middle - vertical; story <= middle + vertical; story++) {
      if (x === cell.x && z === cell.z && story === cell.story) continue;
      const next = eventProposal(seed, { x, z, story }, config);
      if (!next.kind || Math.hypot(next.x - own.x, next.y - own.y, next.z - own.z) >= distance) continue;
      if (next.priority < own.priority || (next.priority === own.priority && `${x}:${z}:${story}` < `${cell.x}:${cell.z}:${cell.story}`)) return false;
    }
  }
  return true;
};

const inset = (b: Rect, n: number): Rect => ({ minX: b.minX + n, maxX: b.maxX - n, minZ: b.minZ + n, maxZ: b.maxZ - n });
const colliderRect = (c: WorldPlan['colliders'][number], padding = 0): Rect => {
  // Rotated hulls are conservatively rejected; do not place on stairs/ramps.
  const r = c.rotation ? Math.hypot(c.halfExtents.x, c.halfExtents.z) : 0;
  return { minX: c.center.x - (r || c.halfExtents.x) - padding, maxX: c.center.x + (r || c.halfExtents.x) + padding,
    minZ: c.center.z - (r || c.halfExtents.z) - padding, maxZ: c.center.z + (r || c.halfExtents.z) + padding };
};
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

export const findEventWallMount = (plan: WorldPlan, room: RoomRecord, high: boolean): WallMount | undefined => {
  const floor = room.floorY ?? 0, h = room.ceilingHeight - floor;
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
      if (plan.walls.some(w => w !== wall && w.collision && w.bottom < y + .4 && w.bottom + w.height > y - .4 && overlapRect(body, {
        minX: w.x - (w.orientation === 'x' ? w.length : w.thickness) / 2, maxX: w.x + (w.orientation === 'x' ? w.length : w.thickness) / 2,
        minZ: w.z - (w.orientation === 'z' ? w.length : w.thickness) / 2, maxZ: w.z + (w.orientation === 'z' ? w.length : w.thickness) / 2 }))) continue;
      return { position, yaw: Math.atan2(nx, nz), wallId: wall.id };
    }
  }
  return undefined;
};

interface EventDefinition { eligible(room: RoomRecord): boolean; prepare(plan: WorldPlan, event: EnvironmentEventPlan, room: RoomRecord, rng: SeededRandom, config: Readonly<EnvironmentEventConfig>): boolean }
const ordinary = (room: RoomRecord) => rectWidth(room.bounds) >= 4 && rectDepth(room.bounds) >= 4;
const wallEvent = (high: boolean): EventDefinition => ({ eligible: ordinary, prepare(plan, event, room) {
  event.mount = findEventWallMount(plan, room, high); return !!event.mount;
} });
export const ENVIRONMENT_EVENT_DEFINITIONS: Readonly<Record<EnvironmentEventKind, EventDefinition>> = {
  'fire-alarm': wallEvent(true), telephone: wallEvent(false), surveillance: wallEvent(true),
  flicker: { eligible: r => Math.max(rectWidth(r.bounds), rectDepth(r.bounds)) >= 11 && Math.min(rectWidth(r.bounds), rectDepth(r.bounds)) >= 4,
    prepare(plan, event, room) {
      if (event.lightIds.length < 2) return false;
      const b = inset(room.bounds, 1.5), c = rectCenter(b), alongX = rectWidth(b) > rectDepth(b);
      const start = { x: alongX ? b.maxX - 1 : c.x - .8, y: event.floorY, z: alongX ? c.z - .8 : b.maxZ - 1 };
      const end = { ...start, x: start.x + (alongX ? 0 : .4), z: start.z + (alongX ? .4 : 0) };
      const approach = { x: alongX ? b.minX : c.x, y: event.floorY + 1.65, z: alongX ? c.z : b.minZ };
      const path = { minX: Math.min(start.x, end.x, approach.x) - .75, maxX: Math.max(start.x, end.x, approach.x) + .75,
        minZ: Math.min(start.z, end.z, approach.z) - .75, maxZ: Math.max(start.z, end.z, approach.z) + .75 };
      if (!clearEventFootprint(plan, path, event.floorY)) return false;
      event.apparition = { start, end, approach }; return true;
    } },
  flood: { eligible: ordinary, prepare(plan, event, room, rng, config) {
    const surfaces = plan.topology?.surfaces.filter(s => s.roomId === room.id && s.profile.kind === 'flat' && Math.abs(s.profile.y - event.floorY) < .02 && s.access === 'open') ?? [];
    const cuts = plan.colliders.filter(c => c.kind !== 'floor' && c.center.y + c.halfExtents.y > event.floorY + .01 && c.center.y - c.halfExtents.y < event.floorY + .07).map(c => colliderRect(c, .025));
    const boundary = inset(room.bounds, .025);
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
  'lonely-chair': { eligible: r => Math.min(rectWidth(r.bounds), rectDepth(r.bounds)) >= 12 && rectArea(r.bounds) >= 190,
    prepare(plan, event, room) {
      // Reserve an actual large BSP room, including its full empty circulation.
      if (!clearEventFootprint(plan, inset(room.bounds, .65), event.floorY)) return false;
      const c = rectCenter(room.bounds);
      event.chair = { positions: [{ ...c, y: event.floorY }, { x: c.x + 1.6, y: event.floorY, z: c.z - 1.25 }], yaws: [.18, -.43] };
      return true;
    } },
};

export const populateEnvironmentEvents = (plan: WorldPlan, seed: string, owner: Address, config = ENVIRONMENT_EVENT_CONFIG): void => {
  plan.environmentEvents = [];
  if (plan.northern?.kind === 'red-zone' || plan.northern?.kind === 'slides-approach') return;
  if (!plan.spatial || plan.features.some(f => f.kind === 'epic-structure')) return;
  const ox = owner.x * 112, oz = owner.z * 112;
  const used = new Set<string>();
  for (let z = owner.z * 4; z < owner.z * 4 + 4; z++) for (let x = owner.x * 4; x < owner.x * 4 + 4; x++) {
    const address = { x, z, story: owner.story }, trial = eventProposal(seed, address, config);
    if (!trial.kind || !eventCellAccepted(seed, address, config)) continue;
    const definition = ENVIRONMENT_EVENT_DEFINITIONS[trial.kind];
    const rooms = plan.rooms.filter(room => {
      const c = rectCenter(room.bounds), cell = spatialCellAt(c.x + ox, c.z + oz);
      return cell.x === x && cell.z === z && Math.hypot(c.x + ox - trial.x, c.z + oz - trial.z) <= MAX_ROOM_DRIFT
        && Math.abs((room.floorY ?? 0) + owner.story * ADDRESS_PITCH - trial.y) < .02
        && !used.has(room.id) && !plan.northern?.circuits.some(c => c.roomId === room.id) && room.access !== 'sealed' && room.access !== 'secret' && room.ceilingHeight - (room.floorY ?? 0) >= 2.7
        && room.bounds.minX > -55 && room.bounds.maxX < 55 && room.bounds.minZ > -55 && room.bounds.maxZ < 55
        && !plan.features.some(f => overlapRect(room.bounds, f.bounds, .5))
        && !(plan.symmetryZones ?? []).some(b => overlapRect(room.bounds, b))
        && !plan.topology?.surfaces.some(s => s.roomId === room.id && (s.profile.kind !== 'flat' || s.access !== 'open'))
        && definition.eligible(room);
    }).sort((a, b) => a.id.localeCompare(b.id));
    for (const room of rooms) {
      const event: EnvironmentEventPlan = { id: `environment/${x}/${z}/${owner.story}`, kind: trial.kind, roomId: room.id,
        bounds: { ...room.bounds }, floorY: room.floorY ?? 0, ceilingY: room.ceilingHeight,
        seed: `${seed}:environment:${x}:${z}:${owner.story}`, lightIds: plan.lights.filter(l => l.roomId === room.id && !l.dead).map(l => l.id) };
      if (!definition.prepare(plan, event, room, new SeededRandom(event.seed), config)) continue;
      plan.environmentEvents.push(event); used.add(room.id);
      // Furniture generation consumes the reservation; no decorative sockets in the empty room.
      if (event.kind === 'lonely-chair') plan.detailSockets = plan.detailSockets.filter(s => s.roomId !== room.id);
      break;
    }
  }
};
