import type { SeededRandom } from '../world/SeededRandom';
import type { Vec3Data } from '../world/types';
import type { NavGrid } from './BackroomsNav';
import type { LurkPlacement, LurkStyle } from './BackroomsHunter';

/**
 * Pacing and placement of the far-bank encounters.
 *
 * `TensionDirector` runs the cadence: quiet → build (false alarms) →
 * encounter → guaranteed relief. `chooseLurkSpot` scores the walkable cells of
 * the nav window and returns a place the player will stumble upon: never on
 * his screen, never within `DIRECTOR_TUNING.minDistance`, never during a
 * scripted shot, ahead on his probable route (compass north, his heading),
 * preferring dark corners, corridor ends, door frames and empty halls.
 * Deterministic for a given seed and inputs.
 */

export const DIRECTOR_TUNING = {
  /** First encounter: not before this many seconds on the far bank and metres walked. */
  firstDelay: 25,
  firstWalk: 35,
  /** Tension gained per second and per metre walked. */
  tensionPerSecond: 0.007,
  tensionPerMetre: 0.006,
  buildAt: 0.3,
  peak: [0.72, 0.95] as const,
  /** Guaranteed quiet after an encounter (s), then metres to walk before the next build. */
  relief: [55, 85] as const,
  reliefWalk: 20,
  /** False alarms while the tension builds. */
  buildCycle: [9, 18] as const,
  falseKnockChance: 0.3,
  /** Encounters whose presence drone stays off until the chase. */
  silentChance: 0.35,
  /** Straight metres from the player. */
  minDistance: 22,
  maxDistance: 44,
  /** Beyond this an out-of-frame spot may stay in the line of sight. */
  openSightDistance: 28,
  retryEvery: 1.2,
} as const;

export type DirectorPhase = 'quiet' | 'build' | 'encounter' | 'relief';
export type DirectorCue =
  | { kind: 'spawn'; style: LurkStyle; silent: boolean }
  | { kind: 'false-knock' };

export interface DirectorInput {
  /** The hunt may happen (far bank, away from the rift). */
  readonly armed: boolean;
  /** A scripted shot or sequence owns the player. */
  readonly cinematic: boolean;
  /** Metres walked this frame. */
  readonly walked: number;
  /** The hunter has nothing in the world. */
  readonly hunterDormant: boolean;
}

const STYLE_WEIGHTS: readonly (readonly { value: LurkStyle; weight: number }[])[] = [
  [{ value: 'still', weight: 0.4 }, { value: 'cross', weight: 0.3 }, { value: 'prowl', weight: 0.2 }, { value: 'ambush', weight: 0.1 }],
  [{ value: 'still', weight: 0.25 }, { value: 'cross', weight: 0.2 }, { value: 'prowl', weight: 0.25 }, { value: 'ambush', weight: 0.3 }],
  [{ value: 'still', weight: 0.2 }, { value: 'cross', weight: 0.15 }, { value: 'prowl', weight: 0.25 }, { value: 'ambush', weight: 0.4 }],
];

export class TensionDirector {
  phase: DirectorPhase = 'quiet';
  tension = 0;
  encounters = 0;
  private wait: number = DIRECTOR_TUNING.firstDelay;
  private walkNeeded: number = DIRECTOR_TUNING.firstWalk;
  private walked = 0;
  private cycle: number;
  private peak: number;
  private relief = 0;
  private retry = 0;
  private readonly random: SeededRandom;

  constructor(random: SeededRandom) {
    this.random = random.fork('tension');
    this.cycle = this.random.float(DIRECTOR_TUNING.buildCycle[0], DIRECTOR_TUNING.buildCycle[1]);
    this.peak = this.random.float(DIRECTOR_TUNING.peak[0], DIRECTOR_TUNING.peak[1]);
  }

  /** True while an encounter may not start (relief, or not built up yet). */
  get resting(): boolean { return this.phase === 'relief' || this.phase === 'quiet'; }

  update(delta: number, input: DirectorInput): DirectorCue | null {
    const tuning = DIRECTOR_TUNING;
    const dt = Math.max(0, Math.min(0.25, delta));
    if (this.phase === 'relief') {
      this.relief -= dt;
      if (this.relief <= 0) {
        this.phase = 'quiet';
        this.wait = 0;
        this.walkNeeded = tuning.reliefWalk;
        this.walked = 0;
        this.peak = this.random.float(tuning.peak[0], tuning.peak[1]);
      }
      return null;
    }
    if (this.phase === 'encounter') {
      if (input.hunterDormant) this.startRelief();
      return null;
    }
    if (!input.armed || input.cinematic) return null;
    this.walked += input.walked;
    this.tension = Math.min(1, this.tension + dt * tuning.tensionPerSecond + input.walked * tuning.tensionPerMetre);
    if (this.phase === 'quiet') {
      this.wait -= dt;
      if (this.wait <= 0 && this.walked >= this.walkNeeded && this.tension >= tuning.buildAt) {
        this.phase = 'build';
        this.cycle = this.random.float(tuning.buildCycle[0], tuning.buildCycle[1]);
      }
      return null;
    }
    // Build-up.
    this.cycle -= dt;
    if (this.cycle <= 0) {
      this.cycle = this.random.float(tuning.buildCycle[0], tuning.buildCycle[1]);
      if (this.random.chance(tuning.falseKnockChance)) return { kind: 'false-knock' };
    }
    if (this.tension < this.peak || !input.hunterDormant) return null;
    this.retry -= dt;
    if (this.retry > 0) return null;
    this.retry = tuning.retryEvery;
    const weights = STYLE_WEIGHTS[Math.min(STYLE_WEIGHTS.length - 1, this.encounters)]!;
    return { kind: 'spawn', style: this.random.weighted(weights), silent: this.random.chance(tuning.silentChance) };
  }

  /** The cue was placed in the world. */
  encounterStarted(): void { this.phase = 'encounter'; }

  /** A chase or a capture ended it early (or a reload): straight to the guaranteed quiet. */
  startRelief(): void {
    this.phase = 'relief';
    this.relief = this.random.float(DIRECTOR_TUNING.relief[0], DIRECTOR_TUNING.relief[1]);
    this.tension = 0.1;
    this.encounters += 1;
  }
}

export interface PlacementContext {
  /** Player feet. */
  readonly player: Readonly<Vec3Data>;
  /** Where he is heading (movement or view, horizontal). */
  readonly heading: { readonly x: number; readonly z: number };
  /** Compass north (the rift's way, −Z). */
  readonly north: { readonly x: number; readonly z: number };
  /** A scripted shot owns the player. */
  readonly cinematic: boolean;
  /** Clear line between his eyes and this point. */
  lineOfSight(x: number, y: number, z: number): boolean;
  /** Inside his camera frustum (with a margin). */
  inView(x: number, y: number, z: number): boolean;
  /** 0 lit .. 1 pitch dark (unlit zone, dead or missing lamp). */
  darkness?(x: number, y: number, z: number): number;
}

interface Candidate { index: number; x: number; z: number; y: number; score: number; yaw: number; dark: number; doorway: boolean; crossX: number; crossZ: number }

const HEAD = 1.95;
const CHEST = 1.2;

/** Visible = on his screen and unoccluded (head or chest). */
export const spotVisible = (context: PlacementContext, x: number, y: number, z: number): boolean =>
  (context.inView(x, y + HEAD, z) && context.lineOfSight(x, y + HEAD, z))
  || (context.inView(x, y + CHEST, z) && context.lineOfSight(x, y + CHEST, z));

/** Behind at least one wall from his eyes. */
export const spotOccluded = (context: PlacementContext, x: number, y: number, z: number): boolean =>
  !context.lineOfSight(x, y + HEAD, z) && !context.lineOfSight(x, y + CHEST, z);

/**
 * The best place for a lurk of `style`, or null. The nav field must measure
 * path distances from the player (computed on his feet).
 */
export const chooseLurkSpot = (
  nav: NavGrid, context: PlacementContext, seedRandom: SeededRandom, style: LurkStyle,
): LurkPlacement | null => {
  const tuning = DIRECTOR_TUNING;
  if (context.cinematic || !nav.fieldValid) return null;
  const random = seedRandom.fork(`lurk-${style}`);
  const player = context.player;
  const headingLength = Math.hypot(context.heading.x, context.heading.z) || 1;
  const hx = context.heading.x / headingLength, hz = context.heading.z / headingLength;
  const candidates: Candidate[] = [];
  nav.forEachFree(2, (index, x, z) => {
    const dx = x - player.x, dz = z - player.z, straight = Math.hypot(dx, dz);
    if (straight < tuning.minDistance || straight > tuning.maxDistance) return;
    const path = nav.field[index]!;
    if (!Number.isFinite(path) || path > 70) return;
    const ux = dx / straight, uz = dz / straight;
    const ahead = 0.5 * (ux * context.north.x + uz * context.north.z) + 0.5 * (ux * hx + uz * hz);
    if (ahead < -0.15) return;
    const y = nav.heightOf(index);
    const east = nav.openLength(x, z, 1, 0, 24), west = nav.openLength(x, z, -1, 0, 24);
    const south = nav.openLength(x, z, 0, 1, 24), northLength = nav.openLength(x, z, 0, -1, 24);
    const corridor = Math.max(east + west, south + northLength);
    const hall = Math.min(east, west, south, northLength);
    const doorway = (Math.min(east, west) < 0.6 && south > 2 && northLength > 2) || (Math.min(south, northLength) < 0.6 && east > 2 && west > 2);
    const ratio = path / straight;
    let score = 0.45 * Math.max(0, ahead);
    score += 0.25 * Math.max(0, 1 - Math.abs(path - 30) / 16);
    if (ratio > 1.15) score += 0.12;
    score += 0.2 * Math.max(0, Math.min(1, (corridor - 6) / 14));
    if (hall > 5) score += 0.15;
    if (doorway) score += 0.12;
    let crossX = x, crossZ = z;
    if (style === 'prowl') score += hall > 4 ? 0.3 : -0.3;
    else if (style === 'ambush') { if (ratio < 1.2 || path > 34) return; score += 0.25; }
    else if (style === 'cross') {
      // Lateral to his line of approach: a corridor it can walk across.
      const lx = -uz, lz = ux;
      const left = nav.openLength(x, z, lx, lz, 10), right = nav.openLength(x, z, -lx, -lz, 10);
      if (left < 3 || right < 3) return;
      const sign = left >= right ? 1 : -1, reach = Math.min(8, Math.max(left, right) - 0.5);
      crossX = x + lx * sign * reach; crossZ = z + lz * sign * reach;
      score += 0.2;
    } else if (doorway) score += 0.1;
    score += random.float(0, 0.12);
    candidates.push({ index, x, z, y, score, yaw: Math.atan2(-dx, -dz), dark: 0, doorway, crossX, crossZ });
  });
  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  const shortlist = candidates.slice(0, 40);
  if (context.darkness) {
    for (const candidate of shortlist) {
      candidate.dark = Math.max(0, Math.min(1, context.darkness(candidate.x, candidate.y, candidate.z)));
      candidate.score += (style === 'still' ? 0.35 : 0.2) * candidate.dark;
    }
    shortlist.sort((a, b) => b.score - a.score || a.index - b.index);
  }
  for (const candidate of shortlist) {
    const { x, y, z } = candidate;
    if (spotVisible(context, x, y, z)) continue;
    const straight = Math.hypot(x - player.x, z - player.z);
    const occluded = spotOccluded(context, x, y, z);
    // An ambush comes from behind a wall; anything else may wait in the open only far off.
    if (!occluded && (style === 'ambush' || straight < tuning.openSightDistance)) continue;
    if (style === 'cross' && spotVisible(context, candidate.crossX, y, candidate.crossZ) && straight < tuning.openSightDistance) continue;
    const placement: LurkPlacement = { x, y, z, yaw: candidate.yaw, style };
    if (style === 'still') {
      placement.crouched = candidate.dark > 0.5;
      if (candidate.doorway) placement.peek = (random.chance(0.5) ? 1 : -1) * 0.85;
    }
    if (style === 'cross') {
      placement.crossTo = { x: candidate.crossX, z: candidate.crossZ };
      placement.yaw = Math.atan2(candidate.crossX - x, candidate.crossZ - z);
    }
    return placement;
  }
  return null;
};
