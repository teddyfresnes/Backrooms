import { APARTMENT_FLOOR_Y } from '../apartment/layout';
import { BACTERIA_REVEAL_LAMP, CORRIDOR_SPACING } from '../story/CorridorProgress';
import type { Vec3Data } from '../world/types';

export const BACTERIA_SPAWN_DISTANCE = 2 + BACTERIA_REVEAL_LAMP * CORRIDOR_SPACING;
export const PLAYER_CENTER_HEIGHT = 0.865;

export interface ChaseWaypoint extends Vec3Data {
  /** Monster speed (m/s) on the segment that starts at this waypoint. */
  readonly speed: number;
}

const point = (x: number, y: number, z: number, speed: number): ChaseWaypoint => ({ x, y, z, speed });

export const CHASE_SPEEDS = { corridor: 4.9, apartment: 5.6, stalk: 1.15 } as const;

export const CLOSET = {
  /** Interior standing point of the player capsule, behind the leaf. */
  hidePosition: { x: -2.63, y: APARTMENT_FLOOR_Y + 0.865, z: -0.16 } as Vec3Data,
  /** Where the monster stops: in front of the leaf, right in the line of the crack. */
  frontPosition: { x: -2.28, y: APARTMENT_FLOOR_Y, z: -2.0 } as Vec3Data,
  /** What the hidden player looks at through the crack. */
  // The crack opens on the east jamb: from inside, only a 18°–41° cone sees out.
  peekTarget: { x: -1.95, y: APARTMENT_FLOOR_Y + 1.5, z: -1.45 } as Vec3Data,
  /** Crack left open while hiding, so the entry can be watched. */
  peekAngle: 0.6,
  interactDistance: 2.1,
} as const;

/** The imported door opens onto a straight corridor along +X. */
export function createChaseWaypoints(threshold: Readonly<Vec3Data>): ChaseWaypoint[] {
  return [
    point(threshold.x + BACTERIA_SPAWN_DISTANCE, threshold.y, threshold.z, CHASE_SPEEDS.corridor),
    point(threshold.x + 0.65, threshold.y, threshold.z, CHASE_SPEEDS.corridor),
  ];
}

export function createEntryWaypoints(threshold: Readonly<Vec3Data>): ChaseWaypoint[] {
  return [
    createChaseWaypoints(threshold)[1]!,
    point(threshold.x - 0.7, threshold.y, threshold.z, 1),
    point(-2.92, threshold.y, -2.5, 1),
    { ...CLOSET.frontPosition, y: threshold.y, speed: 1 },
  ];
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

}

export const distance = (a: Readonly<Vec3Data>, b: Readonly<Vec3Data>): number =>
  Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

/** Timing after the distant ceiling fixture reveals the creature. */
export const REVEAL_TIMELINE = {
  zoomDuration: 4.6,
  headSnap: 6.05,
  charge: 7.35,
  dezoomDuration: 0.38,
  releaseDelay: 0.25,
} as const;

/** Seconds of hammering before the apartment door gives way. */
export const DOOR_BANG_SECONDS = 4.6;
export const CATCH_RADIUS = 1.2;
