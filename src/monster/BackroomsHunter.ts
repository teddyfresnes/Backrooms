import type { SeededRandom } from '../world/SeededRandom';
import type { Vec3Data } from '../world/types';
import type { NavGrid, NavSteer } from './BackroomsNav';

/**
 * The decisions of the creature that hunts the far bank, as plain numbers:
 *
 *   dormant → lurk (placed out of sight, waiting to be stumbled upon)
 *           → notice (head snaps round, posture changes)
 *           → chase (descends the nav field, brakes into corners, lunges)
 *           → search (last seen point, nearby rooms, sniffing, ears open)
 *           → shadow (follows out of sight) → withdraw → dormant.
 *
 * It never vanishes while it can be seen: it only goes dormant out of the
 * line of sight, more than `vanishDistance` away. Speeds are tuned against
 * the player (walk 3.0 m/s, sprint 6.65 m/s): a walker is caught, a sprinter
 * who chains corners loses it, a sprinter on a long straight keeps it on his
 * heels until his breath gives out.
 */

export type HunterState = 'dormant' | 'lurk' | 'notice' | 'chase' | 'search' | 'shadow' | 'withdraw';
export type LurkStyle = 'still' | 'prowl' | 'cross' | 'ambush';
export type HunterMotion = 'idle' | 'stalk' | 'run' | 'crouch' | 'lunge';
export type HunterEvent =
  | 'appear' | 'notice' | 'scream' | 'lunge' | 'lost' | 'heard' | 'sniff'
  | 'gave-up' | 'gone' | 'caught' | 'surge' | 'step';

export const HUNTER_TUNING = {
  /** Chase: cruise on reaching contact, top speed after `straightRamp` s of straight line. */
  chaseCruise: 6.1,
  chaseTop: 7.25,
  straightRamp: 2.4,
  acceleration: 2.8,
  braking: 10,
  /** Braking into a corner closer than `cornerReach` m: `cornerFast` at `cornerAngle` rad, `cornerSlow` from `cornerSharp` rad. */
  cornerFast: 5.1,
  cornerSlow: 3.5,
  cornerReach: 2.5,
  cornerAngle: 0.55,
  cornerSharp: 1.4,
  /** Rubber band: beyond `rubberFar` m of path it gains `rubberGain` m/s per metre (≤ `rubberMax`). */
  rubberFar: 12,
  rubberGain: 0.14,
  rubberMax: 1.7,
  /** Glued to a runner (< `closeGap` m) it matches his pace plus `closeMargin`. */
  closeGap: 3.4,
  closeMargin: 0.4,
  lungeRange: 2.7,
  lungeSpeed: 9.4,
  lungeTime: 0.38,
  lungeRecover: 0.5,
  lungeRecoverSpeed: 3.4,
  lungeCooldown: 2.4,
  catchRadius: 1.15,
  /** Contact lost: unseen and unheard this long, at least `loseGap` m of path behind. */
  loseUnseen: 2.5,
  loseGap: 9.5,
  chaseMax: 50,
  /** Footsteps are heard over `hearRange` × loudness metres (sprint ≈ 1, walk ≈ 0.42). */
  hearRange: 13,
  /** While it runs (its own racket), only this far: a sprinter out of sight beyond it is lost. */
  chaseHearRange: 7,
  searchSpeed: 3.6,
  searchSlowest: 2.3,
  heardSpeed: 4.8,
  searchPoints: [3, 5] as const,
  searchPause: [1.1, 2.2] as const,
  searchTime: [16, 26] as const,
  shadowNear: 15,
  shadowFar: 30,
  shadowSpeed: 3.2,
  shadowTime: [18, 34] as const,
  withdrawSpeed: 3.4,
  vanishDistance: 25,
  /** A still lurker wakes when he comes this close (path), or stares from this close. */
  lurkWake: 9,
  lurkStareWake: 13,
  /** Stared at from farther than this, it freezes mid-gesture. */
  stareFreeze: 14,
  lurkPatience: 45,
  prowlSpeed: 1.35,
  crossSpeed: 2.1,
  ambushSpeed: 5.6,
  ambushDelay: [2, 5] as const,
  awarenessNear: 3.2,
  awarenessFar: 0.55,
  awarenessDecay: 0.2,
  noticeTime: { still: 0.55, prowl: 0.9, cross: 0.8, ambush: 0.35, search: 0.5 } as const,
  /** Gait reference speeds (the animation cadence scales with real speed). */
  runPace: 6.4,
  stalkPace: 1.6,
} as const;

export interface HunterSenses {
  /** Player feet. */
  readonly feet: Readonly<Vec3Data>;
  /** Player horizontal speed (m/s). */
  readonly speed: number;
  /** Footstep loudness 0..1 right now (sprint ≈ 1, walk ≈ 0.42, still 0). */
  readonly noise: number;
  /** Clear line between its head and his eyes. */
  readonly sees: boolean;
  /** On his screen and unoccluded. */
  readonly seen: boolean;
  /** Near the centre of his view. */
  readonly stared: boolean;
  /** A scripted shot owns the player: never engage, slip away. */
  readonly cinematic: boolean;
}

export interface LurkPlacement {
  x: number; y: number; z: number; yaw: number;
  style: LurkStyle;
  /** Hunched under a dead lamp / in the dark. */
  crouched?: boolean;
  /** Head turned this much (rad) round a door frame. */
  peek?: number;
  /** Where a crossing walk ends. */
  crossTo?: { x: number; z: number };
}

const wrap = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const TRAIL = 256;

export class BackroomsHunter {
  state: HunterState = 'dormant';
  style: LurkStyle = 'still';
  readonly position = { x: 0, y: 0, z: 0 };
  yaw = 0;
  speed = 0;
  motion: HunterMotion = 'idle';
  /** Gait cadence scale for the actor (∝ real speed, no sliding). */
  pace = 1;
  /** Stared at from afar: the actor holds its pose. */
  frozen = false;
  lookAtPlayer = false;
  headTwist = 0;
  /** Path metres to the player (or a straight estimate). */
  gap = Infinity;
  awareness = 0;
  stateTime = 0;
  /** Where the player stood when it noticed him (resume point after a capture). */
  readonly chaseStart = { x: 0, y: 0, z: 0 };
  readonly lastKnown = { x: 0, y: 0, z: 0 };
  readonly events: HunterEvent[] = [];
  private readonly lastHeading = { x: 0, z: -1 };
  private noticeLength = 0.6;
  private noticeFrom: LurkStyle | 'search' = 'still';
  private unseen = 0;
  private unheard = 0;
  private seenTime = 0;
  private staredTime = 0;
  private straightTime = 0;
  private lunge = 0;
  private recover = 0;
  private lungeCooldown = 0;
  private fieldTimer = 0;
  private fieldTargetsPlayer = false;
  private readonly goal = { x: 0, z: 0 };
  private readonly anchor = { x: 0, z: 0 };
  private crouched = false;
  private peek = 0;
  private pause = 0;
  private pointsLeft = 0;
  private searchLeft = 0;
  private searchSpeed: number = HUNTER_TUNING.searchSpeed;
  private heardCooldown = 0;
  private shadowLeft = 0;
  private ambushWait = 0;
  private progressTimer = 0;
  private readonly progressFrom = { x: 0, z: 0 };
  private fallback = 0;
  private stepDistance = 0;
  private readonly trail = new Float32Array(TRAIL * 3);
  private trailHead = 0;
  private trailLength = 0;
  private trailCursor = 0;
  private readonly lastFeet = { x: Number.NaN, z: 0 };

  constructor(private readonly nav: NavGrid, private readonly random: SeededRandom) {}

  get visible(): boolean { return this.state !== 'dormant'; }
  /** Running at him or about to. */
  get engaged(): boolean { return this.state === 'chase' || this.state === 'notice'; }
  get blocksSaving(): boolean { return this.engaged || this.state === 'search'; }
  /** The nav field currently measures distances from the player. */
  get fieldIsPlayer(): boolean { return this.fieldTargetsPlayer && this.nav.fieldValid; }

  /** 0..1 how threatened the player is (adrenaline, heartbeat). */
  get threat(): number {
    switch (this.state) {
      case 'chase': return this.unseen < 1.2 || this.gap < 12 ? 1 : 0.7;
      case 'notice': return 0.9;
      case 'search': return this.gap < 10 ? 0.6 : 0.35;
      case 'lurk': return this.seenTime > 0 ? 0.45 : 0;
      case 'shadow': return this.seenTime > 0 ? 0.4 : 0.1;
      case 'withdraw': return this.seenTime > 0 ? 0.3 : 0;
      default: return 0;
    }
  }

  /** 0..1 how much the lamps around it misbehave. */
  get flicker(): number {
    switch (this.state) {
      case 'chase': case 'notice': return 1;
      case 'search': return 0.75;
      case 'lurk': return this.style === 'ambush' ? 0.35 : 0.55;
      case 'shadow': return 0.4;
      case 'withdraw': return 0.3;
      default: return 0;
    }
  }

  /** Placed out of sight by the director. */
  place(spot: LurkPlacement): void {
    this.position.x = spot.x; this.position.y = spot.y; this.position.z = spot.z;
    this.yaw = spot.yaw;
    this.style = spot.style;
    this.crouched = !!spot.crouched;
    this.peek = spot.peek ?? 0;
    this.anchor.x = spot.x; this.anchor.z = spot.z;
    if (spot.crossTo) { this.goal.x = spot.crossTo.x; this.goal.z = spot.crossTo.z; }
    else if (spot.style === 'prowl') this.pickProwlGoal();
    this.speed = 0;
    this.awareness = 0;
    this.ambushWait = this.random.float(HUNTER_TUNING.ambushDelay[0], HUNTER_TUNING.ambushDelay[1]);
    this.enter('lurk');
    this.events.push('appear');
  }

  /** Takes over a creature already in the world (e.g. after the plank chase) in a given state. */
  adopt(position: Readonly<Vec3Data>, yaw: number, state: 'withdraw' | 'chase' | 'search'): void {
    this.position.x = position.x; this.position.y = position.y; this.position.z = position.z;
    this.yaw = yaw;
    this.speed = state === 'chase' ? HUNTER_TUNING.chaseCruise : 0;
    this.enter(state);
    if (state === 'search') this.beginSearch();
  }

  /** Back to nothing (capture handled, reload, cinematic cleanup). */
  reset(): void {
    this.enter('dormant');
    this.speed = 0;
    this.awareness = 0;
    this.trailLength = 0;
    this.trailCursor = 0;
  }

  update(delta: number, senses: HunterSenses): void {
    this.events.length = 0;
    const dt = Math.max(0, Math.min(0.1, delta));
    this.stateTime += dt;
    this.frozen = false;
    this.lungeCooldown = Math.max(0, this.lungeCooldown - dt);
    this.heardCooldown = Math.max(0, this.heardCooldown - dt);
    if (this.state === 'dormant') { this.motion = 'idle'; this.speed = 0; return; }
    const feet = senses.feet;
    this.seenTime = senses.seen ? this.seenTime + dt : 0;
    this.staredTime = senses.stared ? this.staredTime + dt : 0;
    // A few unknown cells per frame: the field keeps growing without a frame spike.
    this.nav.warm(24);
    this.refreshField(dt, feet);
    const straight = Math.hypot(feet.x - this.position.x, feet.z - this.position.z);
    const fieldGap = this.fieldIsPlayer ? this.nav.distanceAt(this.position.x, this.position.z) : Infinity;
    this.gap = Number.isFinite(fieldGap) ? Math.max(straight, fieldGap) : straight * 1.3;
    const heard = senses.noise > 0.02 && senses.noise * HUNTER_TUNING.hearRange >= this.gap;
    if (senses.sees) {
      this.lastKnown.x = feet.x; this.lastKnown.y = feet.y; this.lastKnown.z = feet.z;
    }
    if (!Number.isNaN(this.lastFeet.x)) {
      const mx = feet.x - this.lastFeet.x, mz = feet.z - this.lastFeet.z, moved = Math.hypot(mx, mz);
      if (moved > 0.05) { this.lastHeading.x = mx / moved; this.lastHeading.z = mz / moved; }
    }
    this.lastFeet.x = feet.x; this.lastFeet.z = feet.z;

    if (senses.cinematic && this.state !== 'withdraw') {
      // A scripted shot: it never presses on, it slinks out of the frame.
      this.enter('withdraw');
    }
    switch (this.state) {
      case 'lurk': this.updateLurk(dt, senses, heard); break;
      case 'notice': this.updateNotice(dt, senses); break;
      case 'chase': this.updateChase(dt, senses, senses.noise > 0.02 && senses.noise * HUNTER_TUNING.chaseHearRange >= this.gap, straight); break;
      case 'search': this.updateSearch(dt, senses, heard); break;
      case 'shadow': this.updateShadow(dt, senses, heard); break;
      case 'withdraw': this.updateWithdraw(dt, senses, straight); break;
      default: break;
    }
    this.updatePace();
  }

  // ------------------------------------------------------------- states

  private updateLurk(dt: number, senses: HunterSenses, heard: boolean): void {
    const tuning = HUNTER_TUNING;
    this.accrueAwareness(dt, senses, heard);
    if (this.style === 'still') {
      this.motion = this.crouched ? 'crouch' : 'idle';
      this.speed = 0;
      this.headTwist = this.awareness > 0.25 ? 0 : this.peek;
      this.lookAtPlayer = this.awareness > 0.25 || this.seenTime > 1.2;
      this.frozen = senses.stared && this.gap > tuning.stareFreeze;
      if (this.gap <= tuning.lurkWake || (this.staredTime > 0.8 && this.gap <= tuning.lurkStareWake) || this.awareness >= 1) {
        this.beginNotice('still');
        return;
      }
    } else if (this.style === 'prowl') {
      this.headTwist = 0;
      this.lookAtPlayer = this.awareness > 0.3;
      if (senses.stared && this.gap > tuning.stareFreeze) {
        // Stares back, motionless.
        this.frozen = this.staredTime < 2.5;
        this.speed = 0;
        this.motion = 'idle';
      } else if (this.pause > 0) {
        this.pause -= dt;
        this.speed = 0;
        this.motion = 'idle';
      } else {
        this.motion = 'stalk';
        const arrived = this.walkTo(dt, this.goal.x, this.goal.z, tuning.prowlSpeed, 0.6);
        if (arrived) {
          this.pause = this.random.float(1.2, 2.6);
          const x = this.goal.x, z = this.goal.z;
          this.goal.x = this.anchor.x; this.goal.z = this.anchor.z;
          this.anchor.x = x; this.anchor.z = z;
        }
      }
      if (this.awareness >= 1 || this.gap <= tuning.lurkWake * 0.7) { this.beginNotice('prowl'); return; }
    } else if (this.style === 'cross') {
      // Crossing far down a corridor, not looking: only a close or loud player is noticed.
      this.motion = 'stalk';
      this.lookAtPlayer = false;
      this.headTwist = 0;
      if (this.gap > 10 && !(heard && senses.noise > 0.8)) this.awareness = Math.min(this.awareness, 0.5);
      if (this.awareness >= 1 || this.gap <= 7) { this.beginNotice('cross'); return; }
      if (this.walkTo(dt, this.goal.x, this.goal.z, tuning.crossSpeed, 0.5)) { this.enter('withdraw'); return; }
    } else {
      // Ambush: the knock, a few seconds of nothing, then it comes for him.
      this.lookAtPlayer = false;
      if (this.ambushWait > 0) {
        this.ambushWait -= dt;
        this.motion = 'crouch';
        this.speed = 0;
        if (this.ambushWait <= 0) this.events.push('surge');
      } else {
        this.motion = 'run';
        this.speed += (tuning.ambushSpeed - this.speed) * (1 - Math.exp(-dt * 3));
        const steer = this.steerToPlayer(senses.feet);
        if (steer) this.advance(dt, steer.x, steer.z, this.speed, 10);
        if (senses.sees || this.stateTime > 14) { this.beginNotice('ambush'); return; }
      }
    }
    if (this.state === 'lurk' && this.stateTime > tuning.lurkPatience && this.style !== 'ambush' && this.canVanish(senses)) this.vanish();
  }

  private beginNotice(from: LurkStyle | 'search'): void {
    this.noticeFrom = from;
    this.noticeLength = HUNTER_TUNING.noticeTime[from];
    this.chaseStart.x = this.lastFeet.x; this.chaseStart.z = this.lastFeet.z;
    this.chaseStart.y = this.lastKnown.y;
    this.enter('notice');
    this.events.push('notice');
  }

  private updateNotice(dt: number, senses: HunterSenses): void {
    const t = this.stateTime / this.noticeLength;
    this.lookAtPlayer = true;
    this.headTwist = 0;
    this.speed = Math.max(0, this.speed - dt * 8);
    // Head first, then the whole body turns and drops into its crouch.
    this.motion = this.noticeFrom === 'ambush' ? 'lunge' : t < 0.4 ? 'idle' : 'crouch';
    const target = Math.atan2(senses.feet.x - this.position.x, senses.feet.z - this.position.z);
    this.yaw += wrap(target - this.yaw) * (1 - Math.exp(-dt * (t < 0.4 ? 2 : 9)));
    if (this.stateTime < this.noticeLength) return;
    this.chaseStart.y = senses.feet.y;
    this.enter('chase');
    this.speed = Math.max(this.speed, 4.4);
    this.unseen = 0;
    this.unheard = 0;
    this.trailLength = 0;
    this.trailCursor = 0;
    this.events.push('scream');
  }

  private updateChase(dt: number, senses: HunterSenses, heard: boolean, straight: number): void {
    const tuning = HUNTER_TUNING;
    this.lookAtPlayer = senses.sees;
    this.headTwist = 0;
    this.unseen = senses.sees ? 0 : this.unseen + dt;
    this.unheard = heard || senses.sees ? 0 : this.unheard + dt;
    if (heard) { this.lastKnown.x = senses.feet.x; this.lastKnown.y = senses.feet.y; this.lastKnown.z = senses.feet.z; }
    this.recordTrail(senses.feet);
    if (straight < tuning.catchRadius && Math.abs(senses.feet.y - this.position.y) < 1.3) {
      this.events.push('caught');
      this.enter('dormant');
      return;
    }
    const lost = this.unseen > tuning.loseUnseen && this.unheard > 1 && this.gap > tuning.loseGap;
    if (lost || (this.stateTime > tuning.chaseMax && !senses.sees)) {
      this.events.push('lost');
      this.enter('search');
      this.beginSearch();
      return;
    }
    this.chaseToward(dt, senses, true);
  }

  /** Runs down the field at him: cruise, straight-line ramp, rubber band, corner braking, lunge. */
  private chaseToward(dt: number, senses: HunterSenses, lunges: boolean): void {
    const tuning = HUNTER_TUNING;
    if (this.lunge > 0) {
      this.lunge -= dt;
      this.motion = 'lunge';
      this.speed = tuning.lungeSpeed;
      if (this.lunge <= 0) this.recover = tuning.lungeRecover;
    } else if (this.recover > 0) {
      this.recover -= dt;
      this.motion = 'run';
      this.speed = Math.min(this.speed, tuning.lungeRecoverSpeed);
    } else if (lunges && senses.sees && this.gap < tuning.lungeRange && this.lungeCooldown <= 0) {
      this.lunge = tuning.lungeTime;
      this.lungeCooldown = tuning.lungeCooldown;
      this.motion = 'lunge';
      this.events.push('lunge');
    }
    const steer = this.steerToPlayer(senses.feet);
    let desired: number = tuning.chaseCruise;
    if (steer && steer.turn < 0.35) this.straightTime += dt; else this.straightTime = 0;
    desired += clamp01(this.straightTime / tuning.straightRamp) * (tuning.chaseTop - tuning.chaseCruise);
    const contact = this.unseen < 1.5 || this.unheard < 1;
    if (contact && this.gap > tuning.rubberFar) desired += Math.min(tuning.rubberMax, (this.gap - tuning.rubberFar) * tuning.rubberGain);
    if (this.gap < tuning.closeGap) desired = Math.min(desired, senses.speed + tuning.closeMargin);
    if (steer && !steer.direct && steer.reach < tuning.cornerReach && steer.turn > tuning.cornerAngle) {
      const sharp = clamp01((steer.turn - tuning.cornerAngle) / (tuning.cornerSharp - tuning.cornerAngle));
      desired = Math.min(desired, tuning.cornerFast + (tuning.cornerSlow - tuning.cornerFast) * sharp);
    }
    if (this.lunge <= 0 && this.recover <= 0) {
      const change = desired - this.speed;
      this.speed += change > 0 ? Math.min(change, tuning.acceleration * dt) : Math.max(change, -tuning.braking * dt);
      this.motion = this.speed > 0.4 ? 'run' : 'crouch';
    }
    if (steer && this.fallback <= 0) {
      // In the open, at him as he is now, not where the field was last computed.
      const live = steer.direct && this.nav.clearLine(this.position.x, this.position.z, senses.feet.x, senses.feet.z);
      this.advance(dt, live ? senses.feet.x : steer.x, live ? senses.feet.z : steer.z, this.speed, 12);
    } else this.followTrail(dt, senses.feet);
    this.watchProgress(dt);
  }

  private beginSearch(): void {
    const tuning = HUNTER_TUNING;
    this.goal.x = this.lastKnown.x; this.goal.z = this.lastKnown.z;
    this.pointsLeft = this.random.int(tuning.searchPoints[0], tuning.searchPoints[1]);
    this.searchLeft = this.random.float(tuning.searchTime[0], tuning.searchTime[1]);
    this.searchSpeed = tuning.searchSpeed;
    this.pause = 0;
    this.awareness = 0;
    this.lunge = 0; this.recover = 0;
    this.fieldTimer = 0;
  }

  private updateSearch(dt: number, senses: HunterSenses, heard: boolean): void {
    const tuning = HUNTER_TUNING;
    this.searchLeft -= dt;
    this.lookAtPlayer = senses.sees && this.awareness > 0.2;
    if (senses.sees && this.gap < 26) {
      this.awareness += dt * this.awarenessRate();
      if (this.awareness >= 0.6) { this.beginNotice('search'); return; }
    } else this.awareness = Math.max(0, this.awareness - dt * tuning.awarenessDecay);
    if (heard && this.heardCooldown <= 0) {
      // Footsteps: straight there, faster.
      this.heardCooldown = 1.5;
      this.goal.x = senses.feet.x; this.goal.z = senses.feet.z;
      this.searchSpeed = tuning.heardSpeed;
      this.pointsLeft = Math.max(this.pointsLeft, 2);
      this.pause = 0;
      this.fieldTimer = 0;
      this.events.push('heard');
    }
    if (this.pause > 0) {
      // Sniffing the air, head turning on its neck.
      this.pause -= dt;
      this.speed = 0;
      this.motion = 'crouch';
      this.headTwist = Math.sin(this.stateTime * 1.7) * 1.15;
      if (this.pause <= 0) {
        if (this.pointsLeft <= 0 || this.searchLeft <= 0) { this.events.push('gave-up'); this.beginShadow(); return; }
        this.pickSearchGoal();
        this.searchSpeed = Math.max(tuning.searchSlowest, this.searchSpeed - 0.35);
      }
      return;
    }
    this.headTwist = 0;
    this.motion = this.searchSpeed > 4 ? 'run' : 'stalk';
    if (this.walkTo(dt, this.goal.x, this.goal.z, this.searchSpeed, 0.7)) {
      this.pointsLeft -= 1;
      this.pause = this.random.float(tuning.searchPause[0], tuning.searchPause[1]);
      this.events.push('sniff');
    }
    if (this.searchLeft <= -8) { this.events.push('gave-up'); this.beginShadow(); }
  }

  private beginShadow(): void {
    this.enter('shadow');
    this.shadowLeft = this.random.float(HUNTER_TUNING.shadowTime[0], HUNTER_TUNING.shadowTime[1]);
    this.awareness = 0;
  }

  private updateShadow(dt: number, senses: HunterSenses, heard: boolean): void {
    const tuning = HUNTER_TUNING;
    this.shadowLeft -= dt;
    this.headTwist = 0;
    this.lookAtPlayer = senses.sees;
    if (senses.sees && this.gap < 11) this.awareness += dt * this.awarenessRate() * 1.5;
    else this.awareness = Math.max(0, this.awareness - dt * tuning.awarenessDecay);
    if (this.awareness >= 0.7) { this.beginNotice('search'); return; }
    if (senses.seen) {
      // Caught looking: it holds still; close, it comes; far, it slips away.
      this.speed = 0;
      this.motion = 'idle';
      this.frozen = this.gap > tuning.stareFreeze;
      if (this.seenTime > 1.5 && this.gap < 20) { this.beginNotice('search'); return; }
      if (this.seenTime > 0.6 && this.gap >= 20) { this.enter('withdraw'); return; }
      return;
    }
    const near = heard ? tuning.shadowNear * 0.6 : tuning.shadowNear;
    if (this.gap > tuning.shadowFar) {
      this.motion = 'stalk';
      const steer = this.steerToPlayer(senses.feet);
      if (steer) this.advance(dt, steer.x, steer.z, tuning.shadowSpeed, 9);
    } else if (this.gap < near) {
      this.motion = 'stalk';
      this.retreat(dt, senses.feet, 2.6);
    } else {
      this.speed = 0;
      this.motion = 'crouch';
    }
    if (this.shadowLeft <= 0) this.enter('withdraw');
  }

  private updateWithdraw(dt: number, senses: HunterSenses, straight: number): void {
    this.lookAtPlayer = false;
    this.headTwist = 0;
    if (!senses.cinematic && this.gap < 7 && senses.sees) { this.beginNotice('search'); return; }
    if (this.canVanish(senses, straight)) { this.vanish(); return; }
    this.motion = 'stalk';
    this.retreat(dt, senses.feet, HUNTER_TUNING.withdrawSpeed);
  }

  // ------------------------------------------------------------- helpers

  private canVanish(senses: HunterSenses, straight = Math.hypot(senses.feet.x - this.position.x, senses.feet.z - this.position.z)): boolean {
    return !senses.sees && !senses.seen && straight >= HUNTER_TUNING.vanishDistance;
  }

  private vanish(): void {
    this.enter('dormant');
    this.events.push('gone');
  }

  private enter(state: HunterState): void {
    this.state = state;
    this.stateTime = 0;
    this.fieldTimer = 0;
    this.pause = 0;
    this.straightTime = 0;
    this.progressTimer = 0;
    this.fallback = 0;
    if (state !== 'chase') { this.lunge = 0; this.recover = 0; }
  }

  private awarenessRate(): number {
    const tuning = HUNTER_TUNING;
    return tuning.awarenessFar + (tuning.awarenessNear - tuning.awarenessFar) * (1 - clamp01((this.gap - 4) / 20));
  }

  private accrueAwareness(dt: number, senses: HunterSenses, heard: boolean): void {
    let rate = 0;
    if (senses.sees && this.gap < 18) rate += this.awarenessRate();
    if (heard) rate += senses.noise * 0.9;
    this.awareness = rate > 0 ? this.awareness + rate * dt : Math.max(0, this.awareness - dt * HUNTER_TUNING.awarenessDecay);
  }

  /** Field targets the player in chase / shadow / withdraw / lurk, the goal otherwise. */
  private refreshField(dt: number, feet: Readonly<Vec3Data>): void {
    this.fieldTimer -= dt;
    if (this.fieldTimer > 0) return;
    this.fieldTimer = 0.25;
    const toGoal = this.state === 'search' || (this.state === 'lurk' && (this.style === 'prowl' || this.style === 'cross'));
    if (toGoal) {
      this.nav.computeField(this.goal.x, this.goal.z, 48);
      this.fieldTargetsPlayer = false;
    } else {
      this.nav.computeField(feet.x, feet.z, 48);
      this.fieldTargetsPlayer = true;
    }
  }

  private steerToPlayer(feet: Readonly<Vec3Data>): NavSteer | null {
    if (!this.fieldIsPlayer) { this.nav.computeField(feet.x, feet.z, 48); this.fieldTargetsPlayer = true; this.fieldTimer = 0.25; }
    return this.nav.steer(this.position.x, this.position.z, 24);
  }

  /** Down the goal field; true once within `radius` of the goal (or when there is no route). */
  private walkTo(dt: number, x: number, z: number, speed: number, radius: number): boolean {
    const distance = Math.hypot(x - this.position.x, z - this.position.z);
    if (distance <= radius) { this.speed = 0; return true; }
    if (this.fieldTargetsPlayer || !this.nav.fieldValid || Math.abs(this.nav.targetX - x) > 0.01 || Math.abs(this.nav.targetZ - z) > 0.01) {
      this.nav.computeField(x, z, 48);
      this.fieldTargetsPlayer = false;
      this.fieldTimer = 0.25;
    }
    const steer = this.nav.steer(this.position.x, this.position.z, 16);
    if (!steer) { this.speed = 0; return true; }
    this.speed += (speed - this.speed) * (1 - Math.exp(-dt * 4));
    const moved = this.advance(dt, steer.x, steer.z, this.speed, 8);
    return moved < 1e-4 && this.stateTime > 0.5 && distance < 2.5;
  }

  /** Away from the player: up the player field. */
  private retreat(dt: number, feet: Readonly<Vec3Data>, speed: number): void {
    if (!this.fieldIsPlayer) { this.nav.computeField(feet.x, feet.z, 48); this.fieldTargetsPlayer = true; this.fieldTimer = 0.25; }
    const steer = this.nav.steer(this.position.x, this.position.z, 10, -1);
    this.speed += ((steer ? speed : 0) - this.speed) * (1 - Math.exp(-dt * 4));
    if (steer) this.advance(dt, steer.x, steer.z, this.speed, 7);
  }

  /** Walks toward (x, z) through free cells only, turning the body smoothly. */
  private advance(dt: number, x: number, z: number, speed: number, turnRate: number): number {
    const dx = x - this.position.x, dz = z - this.position.z, distance = Math.hypot(dx, dz);
    if (distance < 1e-4 || speed <= 0) return 0;
    const step = Math.min(distance, speed * dt);
    const moved = this.nav.move(this.position, dx / distance * step, dz / distance * step);
    const floor = this.nav.floorAt(this.position.x, this.position.z);
    if (Number.isFinite(floor)) this.position.y += (floor - this.position.y) * (1 - Math.exp(-dt * 12));
    this.yaw += wrap(Math.atan2(dx, dz) - this.yaw) * (1 - Math.exp(-dt * turnRate));
    this.stepDistance += moved;
    if (this.stepDistance > (this.speed > 4 ? 1.5 : 0.9)) { this.stepDistance = 0; this.events.push('step'); }
    return moved;
  }

  /** Never stuck: no progress for a while re-probes the cells around and falls back on his footsteps. */
  private watchProgress(dt: number): void {
    this.progressTimer += dt;
    if (this.fallback > 0) this.fallback -= dt;
    if (this.progressTimer < 1.2) return;
    const moved = Math.hypot(this.position.x - this.progressFrom.x, this.position.z - this.progressFrom.z);
    this.progressFrom.x = this.position.x; this.progressFrom.z = this.position.z;
    this.progressTimer = 0;
    if (moved < 0.25 && this.gap > HUNTER_TUNING.catchRadius * 2) {
      this.nav.invalidateAround(this.position.x, this.position.z, 2);
      this.fallback = 2;
      this.fieldTimer = 0;
    }
  }

  private recordTrail(feet: Readonly<Vec3Data>): void {
    if (this.trailLength > 0) {
      const last = ((this.trailHead - 1 + TRAIL) % TRAIL) * 3;
      if (Math.hypot(feet.x - this.trail[last]!, feet.z - this.trail[last + 2]!) < 0.5) return;
    }
    const at = this.trailHead * 3;
    this.trail[at] = feet.x; this.trail[at + 1] = feet.y; this.trail[at + 2] = feet.z;
    this.trailHead = (this.trailHead + 1) % TRAIL;
    if (this.trailLength < TRAIL) this.trailLength += 1;
    else this.trailCursor = Math.max(0, this.trailCursor - 1);
  }

  /** Fallback route: his own footsteps (always walkable), then straight at him. */
  private followTrail(dt: number, feet: Readonly<Vec3Data>): void {
    let budget = this.speed * dt;
    while (budget > 1e-4 && this.trailCursor < this.trailLength) {
      const at = ((this.trailHead - this.trailLength + this.trailCursor + TRAIL) % TRAIL) * 3;
      const x = this.trail[at]!, z = this.trail[at + 2]!;
      const distance = Math.hypot(x - this.position.x, z - this.position.z);
      if (distance < 0.35) { this.trailCursor += 1; continue; }
      const moved = this.advance(dt, x, z, Math.min(this.speed, budget / Math.max(dt, 1e-4)), 10);
      if (moved < 1e-4) { this.trailCursor += 1; continue; }
      budget -= moved;
      if (moved < Math.min(distance, budget)) break;
    }
    if (budget > 1e-4 && this.trailCursor >= this.trailLength) this.advance(dt, feet.x, feet.z, budget / Math.max(dt, 1e-4), 10);
  }

  private pickProwlGoal(): void {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const angle = this.random.float(0, Math.PI * 2), length = this.random.float(5, 9);
      const x = this.anchor.x + Math.sin(angle) * length, z = this.anchor.z + Math.cos(angle) * length;
      if (this.nav.isFreeAt(x, z) && this.nav.clearLine(this.anchor.x, this.anchor.z, x, z, Infinity, 0)) { this.goal.x = x; this.goal.z = z; return; }
    }
    this.goal.x = this.anchor.x; this.goal.z = this.anchor.z;
  }

  /** The rooms around where he was last: biased the way he was heading, reachable from here. */
  private pickSearchGoal(): void {
    let bestScore = -Infinity, bestX = this.lastKnown.x, bestZ = this.lastKnown.z;
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const angle = this.random.float(0, Math.PI * 2), length = this.random.float(3, 12);
      const ux = Math.sin(angle), uz = Math.cos(angle);
      const x = this.lastKnown.x + ux * length, z = this.lastKnown.z + uz * length;
      if (!this.nav.isFreeAt(x, z)) continue;
      const along = ux * this.lastHeading.x + uz * this.lastHeading.z;
      const score = along * 0.8 + this.random.float(0, 0.6) - Math.abs(length - 7) * 0.03;
      if (score > bestScore) { bestScore = score; bestX = x; bestZ = z; }
    }
    this.goal.x = bestX; this.goal.z = bestZ;
    this.fieldTimer = 0;
  }

  private updatePace(): void {
    const tuning = HUNTER_TUNING;
    if (this.motion === 'run') this.pace = Math.max(0.45, Math.min(1.45, this.speed / tuning.runPace));
    else if (this.motion === 'stalk') this.pace = Math.max(0.4, Math.min(1.8, this.speed / tuning.stalkPace));
    else this.pace = 1;
  }
}
