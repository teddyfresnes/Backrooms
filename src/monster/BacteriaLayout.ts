import { APARTMENT_ENTRY_DOOR, APARTMENT_FLOOR_Y } from '../apartment/layout';
import { BACTERIA_REVEAL_LAMP, corridorLampDistance } from '../story/CorridorProgress';
import {
  floorY,
  midLandingY,
  STAIRWELL_BOUNDS,
  STAIRWELL_ENTRANCE_HEIGHT,
  STAIRWELL_ENTRANCE_WIDTH,
  STAIRWELL_FLIGHT_COUNT,
  STAIRWELL_WALL_THICKNESS,
} from '../stairwell/layout';
import type { Vec3Data } from '../world/types';

/**
 * Pure geometry and timing of the Bacteria encounter. Kept free of Three.js so
 * the fairness of every chase (sprinting escapes with margin, walking gets
 * caught) stays covered by unit tests whenever a speed or a point is tuned.
 */

/** Under the reveal troffer, far down the post-outage corridor. */
export const BACTERIA_SPAWN_DISTANCE = corridorLampDistance(BACTERIA_REVEAL_LAMP);
export const PLAYER_CENTER_HEIGHT = 0.865;

export interface ChaseWaypoint extends Vec3Data {
  /** Monster speed (m/s) on the segment that starts at this waypoint. */
  readonly speed: number;
}

const point = (x: number, y: number, z: number, speed: number): ChaseWaypoint => ({ x, y, z, speed });

export const CHASE_SPEEDS = {
  /** Inside the apartment once the door is open or broken. */
  apartment: 5.6,
  stalk: 1.15,
  /** Down the stairwell: a hair slower than a sprinting player on the flights. */
  stairs: 4.9,
  landing: 5.3,
} as const;

/**
 * The corridor charge: it lurches off at a run, then accelerates to a speed no
 * person can match. A sprinting player still reaches the door with margin.
 */
export const CORRIDOR_CHARGE = { start: 5.5, acceleration: 6.5, top: 14.5 } as const;
export const corridorChargeSpeed = (seconds: number): number =>
  Math.min(CORRIDOR_CHARGE.top, CORRIDOR_CHARGE.start + CORRIDOR_CHARGE.acceleration * Math.max(0, seconds));
/** Metres covered after `seconds` of charge (closed form of the ramp above). */
export const corridorChargeDistance = (seconds: number): number => {
  const t = Math.max(0, seconds), ramp = (CORRIDOR_CHARGE.top - CORRIDOR_CHARGE.start) / CORRIDOR_CHARGE.acceleration;
  if (t <= ramp) return CORRIDOR_CHARGE.start * t + 0.5 * CORRIDOR_CHARGE.acceleration * t * t;
  return CORRIDOR_CHARGE.start * ramp + 0.5 * CORRIDOR_CHARGE.acceleration * ramp * ramp + CORRIDOR_CHARGE.top * (t - ramp);
};

/** Seconds the creature hammers the shut apartment door before it bursts. */
export const DOOR_BANG_SECONDS = 4.4;
export const CATCH_RADIUS = 1.2;

export const CLOSET = {
  /** Interior standing point of the player capsule, behind the leaf. */
  hidePosition: { x: -2.63, y: APARTMENT_FLOOR_Y + 0.865, z: -0.16 } as Vec3Data,
  /** Where the monster stops: in front of the leaf, right in the line of the crack. */
  frontPosition: { x: -2.28, y: APARTMENT_FLOOR_Y, z: -2.0 } as Vec3Data,
  /** What the hidden player looks at through the crack. */
  // The crack opens on the east jamb: from inside, only a 18°–41° cone sees out.
  peekTarget: { x: -1.95, y: APARTMENT_FLOOR_Y + 1.5, z: -1.45 } as Vec3Data,
  /** Where the player stands once out of the closet, facing the entry. */
  exitPosition: { x: -2.66, y: APARTMENT_FLOOR_Y + 0.865, z: -1.42 } as Vec3Data,
  /** Crack left open while hiding, so the entry can be watched. */
  peekAngle: 0.6,
  interactDistance: 2.8,
} as const;

/**
 * The bedroom wardrobe: the flat's real hiding place ("Se cacher dans le
 * placard"), driven by ClosetHide. The creature sniffs right in front of it.
 */
export const WARDROBE = {
  frontPosition: { x: -7.93, y: APARTMENT_FLOOR_Y, z: -4.45 } as Vec3Data,
  /** Inside, at head height: what it sniffs at. */
  hideEye: { x: -7.93, y: APARTMENT_FLOOR_Y + 1.31, z: -5.65 } as Vec3Data,
  exitPosition: { x: -7.93, y: APARTMENT_FLOOR_Y + 0.9, z: -4.85 } as Vec3Data,
} as const;

export type HideSpotId = 'wardrobe' | 'closet' | 'bathroom';

export interface HideSpotLayout {
  /** Where the creature stops to sniff, in front of the leaf. */
  readonly frontPosition: Vec3Data;
  /** The hidden player's head: what it sniffs at. */
  readonly hideEye: Vec3Data;
  /** Player capsule centre just outside, for checkpoint restarts. */
  readonly exitPosition: Vec3Data;
  /** Free floor points between the entry and the front (door → front). */
  readonly approach: readonly Vec3Data[];
  /** Free floor points from the front to the television stand. */
  readonly toTelevision: readonly Vec3Data[];
}

const floor = (x: number, z: number): Vec3Data => ({ x, y: APARTMENT_FLOOR_Y, z });

/** Every place the hunted player can hide, each with the creature's own route. */
export const HIDE_SPOTS: Readonly<Record<HideSpotId, HideSpotLayout>> = {
  wardrobe: {
    ...WARDROBE,
    approach: [floor(-3.4, -2.75), floor(-6.3, -3.3), floor(-7.6, -4.15)],
    toTelevision: [floor(-7.6, -3.4), floor(-7.9, -2.2)],
  },
  /** The entry closet left of the fridge. */
  closet: {
    frontPosition: CLOSET.frontPosition,
    hideEye: { x: -2.63, y: APARTMENT_FLOOR_Y + 1.31, z: -0.16 },
    exitPosition: CLOSET.exitPosition,
    approach: [],
    toTelevision: [floor(-3.4, -2.75), floor(-6.3, -3.3), floor(-7.9, -2.2)],
  },
  /** Behind the bathroom door, away from its hinge. */
  bathroom: {
    frontPosition: floor(-4.05, -3.3),
    hideEye: { x: -3.9, y: APARTMENT_FLOOR_Y + 1.31, z: -4.6 },
    exitPosition: { x: -4.05, y: APARTMENT_FLOOR_Y + 0.9, z: -3.5 },
    approach: [floor(-3.4, -2.9)],
    toTelevision: [floor(-4.6, -3.1), floor(-6.3, -3.3), floor(-7.9, -2.2)],
  },
};

/** The television on its sideboard, north-west corner of the main room. */
export const TELEVISION = {
  /** Where the creature stands to take it, and later cradles it, back to the closet. */
  standPosition: { x: -8.25, y: APARTMENT_FLOOR_Y, z: -1.2 } as Vec3Data,
  /** Approximate centre of the set (refined from the real model at runtime). */
  center: { x: -9.55, y: APARTMENT_FLOOR_Y + 1.18, z: 0.1 } as Vec3Data,
} as const;

/** Silent exit: holding the sprint key this long eases the leaf open without a sound. */
export const SNEAK_HOLD_SECONDS = 3;
/** Voice lines need this long, once the TV is in its hands, to settle into murmurs. */
export const CALM_SECONDS = 4.5;

/** The imported door opens onto a straight corridor along +X. */
export function createChaseWaypoints(threshold: Readonly<Vec3Data>): Vec3Data[] {
  return [
    { x: threshold.x + BACTERIA_SPAWN_DISTANCE, y: threshold.y, z: threshold.z },
    { x: threshold.x + 0.65, y: threshold.y, z: threshold.z },
  ];
}

/** Door → entry → across the main room → in front of the chosen hiding place. */
export function createEntryWaypoints(threshold: Readonly<Vec3Data>, spot: HideSpotId = 'wardrobe'): ChaseWaypoint[] {
  const layout = HIDE_SPOTS[spot];
  return [
    { ...createChaseWaypoints(threshold)[1]!, speed: 1 },
    point(threshold.x - 0.7, threshold.y, threshold.z, 1),
    ...layout.approach.map(p => point(p.x, threshold.y, p.z, 1)),
    { ...layout.frontPosition, y: threshold.y, speed: 1 },
  ];
}

/** In front of the hiding place → back into the main room → the television. */
export function createLureWaypoints(spot: HideSpotId = 'wardrobe'): ChaseWaypoint[] {
  const layout = HIDE_SPOTS[spot];
  return [
    { ...layout.frontPosition, speed: 1 },
    ...layout.toTelevision.map(p => point(p.x, p.y, p.z, 1)),
    { ...TELEVISION.standPosition, speed: 1 },
  ];
}

/** Ground floor: the hall door gives onto the dark, rain-soaked street. */
export const FACADE_OUTER_Z = STAIRWELL_BOUNDS.minZ - STAIRWELL_WALL_THICKNESS * 0.5;
/**
 * The run out of the hall door: an invisible strip of street, walled on both
 * sides, long enough that the trip always happens before its end.
 */
export const ESCAPE_RUN = {
  halfWidth: 3.2,
  floorY: 0,
  /** Far end of the strip (the block across the street starts near -21.4). */
  endZ: FACADE_OUTER_Z - 26,
  /** Out in the dark this far, the foot catches. */
  tripDistance: 14,
  /** ...or after this long outside, whatever the pace. */
  tripDelay: 4.6,
} as const;
/** Out of the hall door, in the street. */
export const isOutsideHall = (position: Readonly<Vec3Data>): boolean =>
  position.y < 1.4 && position.z < FACADE_OUTER_Z - 0.25 && Math.abs(position.x) < ESCAPE_RUN.halfWidth + 0.5;
/** Far enough out in the dark: the player trips and falls through the world. */
export const isTripPosition = (position: Readonly<Vec3Data>): boolean =>
  isOutsideHall(position) && position.z < FACADE_OUTER_Z - ESCAPE_RUN.tripDistance;

/** In front of the apartment door, on the top landing. */
export const DOOR_LANDING: Vec3Data = { x: APARTMENT_ENTRY_DOOR.centerX + 0.56, y: APARTMENT_FLOOR_Y, z: APARTMENT_ENTRY_DOOR.centerZ };

/**
 * From the television, out of the apartment and down every flight to the
 * hall door. Feet positions; the flights alternate right (down from a main
 * landing) and left (down from a mid landing).
 */
export function createEscapeWaypoints(): ChaseWaypoint[] {
  const points: ChaseWaypoint[] = [
    { ...TELEVISION.standPosition, speed: CHASE_SPEEDS.apartment },
    point(-6.4, APARTMENT_FLOOR_Y, -2.1, CHASE_SPEEDS.apartment),
    point(-3.4, APARTMENT_FLOOR_Y, -2.62, CHASE_SPEEDS.apartment),
    point(APARTMENT_ENTRY_DOOR.centerX - 0.5, APARTMENT_FLOOR_Y, APARTMENT_ENTRY_DOOR.centerZ, CHASE_SPEEDS.landing),
    { ...DOOR_LANDING, speed: CHASE_SPEEDS.landing },
    point(-0.35, APARTMENT_FLOOR_Y, -2.62, CHASE_SPEEDS.landing),
  ];
  for (let level = STAIRWELL_FLIGHT_COUNT - 1; level >= 0; level -= 1) {
    const top = floorY(level + 1), mid = midLandingY(level), base = floorY(level);
    points.push(
      point(1.05, top, -1.42, CHASE_SPEEDS.stairs),
      point(1.05, mid, 1.42, CHASE_SPEEDS.landing),
      point(0, mid, 2.5, CHASE_SPEEDS.landing),
      point(-1.05, mid, 1.42, CHASE_SPEEDS.stairs),
      point(-1.05, base, -1.42, CHASE_SPEEDS.landing),
    );
    if (level > 0) points.push(point(0, base, -2.35, CHASE_SPEEDS.landing));
  }
  points.push(
    point(-0.35, 0, -3.15, CHASE_SPEEDS.landing),
    // Through the open right leaf of the hall door.
    point(0.55, 0.02, STAIRWELL_BOUNDS.minZ + 0.75, CHASE_SPEEDS.landing),
    point(0.55, ESCAPE_RUN.floorY, FACADE_OUTER_Z - 1.2, CHASE_SPEEDS.landing),
    // Out into the street, straight on into the dark.
    point(0, ESCAPE_RUN.floorY, ESCAPE_RUN.endZ + 1, CHASE_SPEEDS.landing),
  );
  return points;
}

export class ChasePath {
  readonly cumulative: number[] = [0];
  readonly length: number;

  constructor(readonly points: readonly ChaseWaypoint[]) {
    if (points.length < 2) throw new Error('Un chemin de poursuite demande deux points.');
    for (let index = 1; index < points.length; index += 1) {
      this.cumulative.push(this.cumulative[index - 1]! + distance(points[index - 1]!, points[index]!));
    }
    this.length = this.cumulative[this.cumulative.length - 1]!;
  }

  private segmentAt(distanceAlong: number): number {
    const clamped = Math.min(this.length, Math.max(0, distanceAlong));
    let index = 0;
    while (index < this.points.length - 2 && this.cumulative[index + 1]! < clamped) index += 1;
    return index;
  }

  sample<T extends { x: number; y: number; z: number }>(distanceAlong: number, out: T): T {
    const index = this.segmentAt(distanceAlong);
    const start = this.points[index]!, end = this.points[index + 1]!;
    const span = this.cumulative[index + 1]! - this.cumulative[index]!;
    const t = span > 1e-6 ? (Math.min(this.length, Math.max(0, distanceAlong)) - this.cumulative[index]!) / span : 1;
    out.x = start.x + (end.x - start.x) * t;
    out.y = start.y + (end.y - start.y) * t;
    out.z = start.z + (end.z - start.z) * t;
    return out;
  }

  /** Horizontal travel direction (unit, y = 0) at a distance along the path. */
  heading<T extends { x: number; y: number; z: number }>(distanceAlong: number, out: T): T {
    const index = this.segmentAt(distanceAlong);
    const start = this.points[index]!, end = this.points[index + 1]!;
    const dx = end.x - start.x, dz = end.z - start.z, length = Math.hypot(dx, dz) || 1;
    out.x = dx / length; out.y = 0; out.z = dz / length;
    return out;
  }

  speedAt(distanceAlong: number): number { return this.points[this.segmentAt(distanceAlong)]!.speed; }

  /** Seconds the monster needs, from the start, to cover `distanceAlong`. */
  timeTo(distanceAlong: number): number {
    const target = Math.min(this.length, Math.max(0, distanceAlong));
    let time = 0;
    for (let index = 0; index < this.points.length - 1; index += 1) {
      const from = this.cumulative[index]!, to = this.cumulative[index + 1]!;
      if (target <= from) break;
      time += (Math.min(to, target) - from) / this.points[index]!.speed;
    }
    return time;
  }

  /** Distance along the path of the point nearest to `position` (3D). */
  project(position: Readonly<Vec3Data>): number {
    let best = 0, bestDistance = Infinity;
    for (let index = 0; index < this.points.length - 1; index += 1) {
      const a = this.points[index]!, b = this.points[index + 1]!;
      const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
      const span = abx * abx + aby * aby + abz * abz;
      const t = span > 1e-9 ? Math.min(1, Math.max(0, ((position.x - a.x) * abx + (position.y - a.y) * aby + (position.z - a.z) * abz) / span)) : 0;
      const dx = a.x + abx * t - position.x, dy = a.y + aby * t - position.y, dz = a.z + abz * t - position.z;
      const d = dx * dx + dy * dy * 1.6 + dz * dz;
      if (d < bestDistance) { bestDistance = d; best = this.cumulative[index]! + Math.sqrt(span) * t; }
    }
    return best;
  }
}

export const distance = (a: Readonly<Vec3Data>, b: Readonly<Vec3Data>): number =>
  Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

/**
 * The far reveal, synchronised with the 7.7 s tension sting (it swells to a
 * peak around 6.5 s). Times are seconds after the reveal troffer strikes.
 */
export const REVEAL_TIMELINE = {
  /** Push in from the player's field of view to a long-lens close-up, quick
   * once the far tubes light it. */
  zoomDuration: 1.6,
  /** Feeding stops dead: it has heard something. */
  freeze: 3.6,
  /** The head starts to come round, alone, much too far. */
  headTurn: 4.3,
  /** The body whips round to follow the head. */
  bodySnap: 6.3,
  /** Scream, fast pull-out, charge. */
  charge: 7.55,
  dezoomDuration: 0.36,
  releaseDelay: 0.22,
} as const;

/** The escape: the creature sees the player on the landing, then gives chase. */
export const SPOTTED_TIMELINE = { dropTelevision: 0.25, whip: 0.55, roar: 0.75, release: 1.7 } as const;
