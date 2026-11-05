import { APARTMENT_ENTRY_DOOR, APARTMENT_FLOOR_Y } from '../apartment/layout';
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
 * Pure geometry and timing of the Bacteria encounter. Kept free of Three.js
 * so the chase fairness (sprinting escapes with margin, walking gets caught)
 * stays covered by unit tests whenever a speed or a waypoint is tuned.
 */

/** Exterior face of the south facade, where the hall door opens onto the corridor. */
export const FACADE_OUTER_Z = STAIRWELL_BOUNDS.minZ - STAIRWELL_WALL_THICKNESS * 0.5;

export const BACKROOMS_CORRIDOR = {
  /** Starts a hair outside the facade so no face is coplanar with the wall. */
  nearZ: FACADE_OUTER_Z - 0.035,
  // Ends short of the block across the street (front face z ≈ -21.4).
  farZ: FACADE_OUTER_Z - 13.4,
  halfWidth: STAIRWELL_ENTRANCE_WIDTH * 0.5 + 0.07,
  // Raised over the entrance curb (0.16 m): reads as a threshold step.
  floorY: 0.17,
  height: STAIRWELL_ENTRANCE_HEIGHT + 0.06,
  panelCount: 6,
} as const;

export const corridorPanelZ = (index: number): number => {
  const span = BACKROOMS_CORRIDOR.nearZ - BACKROOMS_CORRIDOR.farZ;
  // Index 0 is the farthest panel: the first one to switch on behind the monster.
  return BACKROOMS_CORRIDOR.farZ + span * ((index + 0.62) / BACKROOMS_CORRIDOR.panelCount);
};

export interface ChaseWaypoint extends Vec3Data {
  /** Monster speed (m/s) on the segment that starts at this waypoint. */
  readonly speed: number;
}

const point = (x: number, y: number, z: number, speed: number): ChaseWaypoint => ({ x, y, z, speed });

export const CHASE_SPEEDS = {
  corridor: 7.0,
  hall: 5.0,
  stairs: 3.6,
  landing: 4.15,
  /** Inside the apartment once the door is open or broken. */
  apartment: 5.6,
  stalk: 1.15,
} as const;

/** Where the monster stands, hammering the closed apartment door. */
export const DOOR_BANG_POSITION: Vec3Data = { x: APARTMENT_ENTRY_DOOR.centerX + 0.56, y: APARTMENT_FLOOR_Y, z: APARTMENT_ENTRY_DOOR.centerZ };

export const CLOSET = {
  /** Interior standing point of the player capsule, behind the leaf. */
  hidePosition: { x: -2.63, y: APARTMENT_FLOOR_Y + 0.865, z: -0.16 } as Vec3Data,
  /** Where the monster stops: in front of the leaf, right in the line of the crack. */
  frontPosition: { x: -2.28, y: APARTMENT_FLOOR_Y, z: -2.0 } as Vec3Data,
  /** What the hidden player looks at through the crack. */
  // The crack opens on the east jamb: from inside, only a 18°–41° cone sees out.
  peekTarget: { x: -1.95, y: APARTMENT_FLOOR_Y + 1.5, z: -1.45 } as Vec3Data,
  /** Where the player is put back when leaving the closet. */
  exitPosition: { x: -2.66, y: APARTMENT_FLOOR_Y + 0.865, z: -1.42 } as Vec3Data,
  /** Crack left open while hiding, so the entry can be watched. */
  peekAngle: 0.6,
  interactDistance: 2.1,
} as const;

/** Fixed hall checkpoint after a death: back by the mailboxes, facing the stairs. */
export const CHASE_CHECKPOINT: Vec3Data = { x: 0.42, y: 0.865, z: -4.45 };

/** The reveal starts once the player, mail in hand, walks toward the first flight. */
export const isChaseTriggerPosition = (position: Readonly<Vec3Data>): boolean =>
  position.y < 1.1 && position.z > -2.95 && position.z < 1.25 && Math.abs(position.x) < 2.0;

export const MONSTER_START: Vec3Data = { x: 0.42, y: BACKROOMS_CORRIDOR.floorY, z: BACKROOMS_CORRIDOR.farZ + 1.1 };

/** Corridor → hall → three storeys of flights → landing in front of the apartment door. */
export function createChaseWaypoints(): ChaseWaypoint[] {
  const points: ChaseWaypoint[] = [
    point(MONSTER_START.x, MONSTER_START.y, MONSTER_START.z, CHASE_SPEEDS.corridor),
    point(0.5, BACKROOMS_CORRIDOR.floorY, FACADE_OUTER_Z - 0.45, CHASE_SPEEDS.hall),
    point(0.5, 0.02, STAIRWELL_BOUNDS.minZ + 0.75, CHASE_SPEEDS.hall),
    point(-0.35, 0, -3.15, CHASE_SPEEDS.hall),
  ];
  for (let level = 0; level < STAIRWELL_FLIGHT_COUNT; level += 1) {
    const base = floorY(level);
    const mid = midLandingY(level);
    const next = floorY(level + 1);
    points.push(
      point(-1.05, base, -1.42, CHASE_SPEEDS.stairs),
      point(-1.05, mid, 1.42, CHASE_SPEEDS.landing),
      point(0, mid, 2.5, CHASE_SPEEDS.landing),
      point(1.05, mid, 1.42, CHASE_SPEEDS.stairs),
      point(1.05, next, -1.42, CHASE_SPEEDS.landing),
    );
    if (level < STAIRWELL_FLIGHT_COUNT - 1) points.push(point(0, next, -2.35, CHASE_SPEEDS.landing));
  }
  points.push(
    point(-0.35, APARTMENT_FLOOR_Y, -2.62, CHASE_SPEEDS.landing),
    point(DOOR_BANG_POSITION.x, DOOR_BANG_POSITION.y, DOOR_BANG_POSITION.z, CHASE_SPEEDS.landing),
  );
  return points;
}

/** Through the door to the closet, and back out (the monster's search). */
export const APARTMENT_ENTRY_WAYPOINTS: readonly Vec3Data[] = [
  DOOR_BANG_POSITION,
  { x: APARTMENT_ENTRY_DOOR.centerX - 0.1, y: APARTMENT_FLOOR_Y, z: APARTMENT_ENTRY_DOOR.centerZ },
  { x: -2.92, y: APARTMENT_FLOOR_Y, z: -2.5 },
  CLOSET.frontPosition,
];

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

  /**
   * Distance along the path of the closest point to `position`. The vertical
   * gap counts three times, so a player on another storey never projects onto
   * the flight just above or below them.
   */
  project(position: Readonly<Vec3Data>): { distance: number; offset: number } {
    let best = { distance: 0, offset: Number.POSITIVE_INFINITY };
    for (let index = 0; index < this.points.length - 1; index += 1) {
      const a = this.points[index]!, b = this.points[index + 1]!;
      const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
      const lengthSq = abx * abx + aby * aby + abz * abz;
      const t = lengthSq > 1e-9
        ? Math.min(1, Math.max(0, ((position.x - a.x) * abx + (position.y - a.y) * aby + (position.z - a.z) * abz) / lengthSq))
        : 0;
      const px = a.x + abx * t, py = a.y + aby * t, pz = a.z + abz * t;
      const offset = Math.hypot(position.x - px, (position.y - py) * 3, position.z - pz);
      if (offset < best.offset) best = { distance: this.cumulative[index]! + Math.sqrt(lengthSq) * t, offset };
    }
    return best;
  }
}

export const distance = (a: Readonly<Vec3Data>, b: Readonly<Vec3Data>): number =>
  Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

/** Scripted beats of the reveal, in seconds after the trigger. */
export const REVEAL_TIMELINE = {
  flickerEnd: 0.75,
  turnStart: 0.55,
  turnDuration: 1.9,
  doorOpenStart: 1.55,
  doorOpenDuration: 2.2,
  firstPanel: 2.7,
  tensionStart: 2.6,
  zoomStart: 2.85,
  zoomDuration: 4.6,
  panelWaveStart: 4.7,
  panelInterval: 0.42,
  headSnap: 8.65,
  /** The tension track (7.68 s) peaks here: scream, run, fast zoom-out. */
  charge: 9.95,
  dezoomDuration: 0.38,
  release: 10.2,
} as const;

/** Seconds of hammering before the apartment door gives way. */
export const DOOR_BANG_SECONDS = 4.6;
export const CATCH_RADIUS = 1.2;
