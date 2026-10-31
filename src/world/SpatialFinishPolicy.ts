import { RectIndex } from './RectIndex';
import type { TrimInterval } from './BaseboardZones';
import { overlapRect, type WalkableSurface } from './WalkableTopology';
import type { WorldPlan } from './types';

interface FinishFace extends TrimInterval { axis: 'x' | 'z'; fixed: number; sign: -1 | 1 }
export interface FinishInterval extends TrimInterval { datum: number }

/** Floors may be tiled before BSP IDs are restored (lower mazes, thresholds,
 * galleries). An inherited roomId is a fallback, not a whole-surface policy.
 * Resolve the canonical room at every exposed face interval and real level.
 * No connectivity flood fill: an open doorway cannot recolour the labyrinth. */
export const createSpatialFinishResolver = (world: WorldPlan) => {
  const rooms = new Map(world.rooms.map(r => [r.id, r]));
  const index = new RectIndex(world.rooms, r => r.bounds);
  const ambiguous = new Set(world.rooms.filter(r => index.query(r.bounds).some(other => other !== r
    && Math.abs((other.floorY ?? 0) - (r.floorY ?? 0)) < .05
    && overlapRect(r.bounds, other.bounds, 1e-6))).map(r => r.id));
  return (face: FinishFace, floor: WalkableSurface): FinishInterval[] => {
    const source = floor.roomId ? rooms.get(floor.roomId) : undefined;
    const profile = floor.profile, height = profile.kind === 'flat' ? profile.y : Math.min(profile.startY, profile.endY);
    const cross = face.fixed + face.sign * .015;
    if (source && !ambiguous.has(source.id) && (profile.kind === 'linear' || Math.abs((source.floorY ?? 0) - height) < .05)) {
      const b = source.bounds, f = floor.bounds;
      // Strict containment keeps the general resolver's endpoint ownership,
      // including a room boundary differing by the last bit of a double.
      if (f.minX >= b.minX && f.maxX <= b.maxX && f.minZ >= b.minZ && f.maxZ <= b.maxZ
        && cross >= (face.axis === 'x' ? b.minZ : b.minX) && cross <= (face.axis === 'x' ? b.maxZ : b.maxX)) {
        return source.baseboards === false ? [] : [{ min: face.min, max: face.max, datum: source.floorY ?? height }];
      }
    }
    const search = face.axis === 'x' ? { minX: face.min, maxX: face.max, minZ: cross, maxZ: cross }
      : { minZ: face.min, maxZ: face.max, minX: cross, maxX: cross };
    const nearby = index.query(search).filter(r => {
      const b = r.bounds, min = face.axis === 'x' ? b.minZ : b.minX, max = face.axis === 'x' ? b.maxZ : b.maxX;
      return cross >= min - 1e-6 && cross <= max + 1e-6;
    });
    // A raised landing can have an actual room at its height. Otherwise it
    // inherits its architectural space's finish, including a sloping approach.
    const datum = profile.kind === 'flat' && nearby.some(r => Math.abs((r.floorY ?? 0) - height) < .05)
      ? height : source?.floorY ?? height;
    const candidates = nearby.filter(r => Math.abs((r.floorY ?? 0) - datum) < .05)
      .sort((a, b) => (a.bounds.maxX - a.bounds.minX) * (a.bounds.maxZ - a.bounds.minZ)
        - (b.bounds.maxX - b.bounds.minX) * (b.bounds.maxZ - b.bounds.minZ) || a.id.localeCompare(b.id));
    const events = [...new Set([face.min, face.max, ...candidates.flatMap(r => face.axis === 'x'
      ? [r.bounds.minX, r.bounds.maxX] : [r.bounds.minZ, r.bounds.maxZ])])]
      .filter(n => n >= face.min && n <= face.max).sort((a, b) => a - b);
    const result: FinishInterval[] = [];
    for (let i = 1; i < events.length; i++) {
      const min = events[i - 1]!, max = events[i]!, at = (min + max) / 2;
      const room = candidates.find(r => at > (face.axis === 'x' ? r.bounds.minX : r.bounds.minZ) - 1e-6
        && at < (face.axis === 'x' ? r.bounds.maxX : r.bounds.maxZ) + 1e-6);
      if ((room ?? source)?.baseboards === false || max - min < 1e-6) continue;
      result.push({ min, max, datum: room?.floorY ?? source?.floorY ?? height });
    }
    return result;
  };
};
