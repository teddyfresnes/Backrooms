export type MeleeAttackKind = 'punch' | 'big-punch' | 'hook-counter';
export type HitReactionClass = 'light' | 'medium' | 'big' | 'body' | 'groin';
export type CombatHitZone = 'head' | 'upper-body' | 'body';

export type CombatMeleeSpacing = 'close' | 'medium' | 'far' | 'out';

// Contextual melee spacing. Distances are horizontal root-to-root distances,
// not camera distances. Close creates space, medium uses ordinary boxing range,
// far commits with a collision-safe step-in, and out never magnetizes the player.
// "close" is now true clinch distance only. Anything beyond this should
// remain a real punch and may use collision-safe footwork to make the knuckles
// meet the opponent instead of turning every short-range click into a shove.
export const COMBAT_MELEE_CLOSE_MAX_DISTANCE = 0.78;
// Capsule radii plus skin leave about 0.685 m between touching roots.
export const COMBAT_MELEE_CLINCH_DISTANCE = 0.76;
export const COMBAT_MELEE_MEDIUM_MAX_DISTANCE = 1.58;
export const COMBAT_MELEE_FAR_MAX_DISTANCE = 2.62;

// Scripted melee tries to arrive at roughly arm's-length range before impact.
// This is horizontal root-to-root distance; the arm solver then finishes the
// last few centimetres against the live head/chest target.
export const COMBAT_MELEE_IDEAL_PUNCH_DISTANCE = 0.80;
export const COMBAT_MELEE_IDEAL_STEP_DISTANCE = 0.84;
export const COMBAT_MELEE_WHIF_FORWARD_METERS = 0.58;
export const COMBAT_MELEE_WHIF_DRIVE_SECONDS = 0.38;


// Soft lock-on only acquires an opponent that is already broadly in front of
// the reticle. Once acquired it gets a little hysteresis so tiny mouse movement
// does not drop the target, but looking genuinely away always breaks the lock.
export const COMBAT_LOCK_ON_ACQUIRE_MIN_DOT = 0.22;
export const COMBAT_LOCK_ON_RETAIN_MIN_DOT = -0.08;

export const combatLockOnFacingAllowed = (aimDot: number, alreadyLocked = false): boolean =>
  Number.isFinite(aimDot)
  && aimDot >= (alreadyLocked ? COMBAT_LOCK_ON_RETAIN_MIN_DOT : COMBAT_LOCK_ON_ACQUIRE_MIN_DOT);

// Ordinary attack assistance is stricter than target-lock retention. Contextual
// spacing/lunges must never pull the player toward somebody behind the camera.
export const COMBAT_ATTACK_TARGET_MIN_DOT = 0.18;
export const combatAttackTargetFacingAllowed = (aimDot: number): boolean =>
  Number.isFinite(aimDot) && aimDot >= COMBAT_ATTACK_TARGET_MIN_DOT;

export const combatMeleeSpacingForDistance = (distance: number): CombatMeleeSpacing => {
  if (!Number.isFinite(distance) || distance < 0) return 'out';
  if (distance <= COMBAT_MELEE_CLOSE_MAX_DISTANCE) return 'close';
  if (distance <= COMBAT_MELEE_MEDIUM_MAX_DISTANCE) return 'medium';
  if (distance <= COMBAT_MELEE_FAR_MAX_DISTANCE) return 'far';
  return 'out';
};

/**
 * A guard strike at body-to-body distance is a space-making shove. This helper
 * is intentionally explicit so adding a solid opponent capsule does not create
 * the old failure mode where both actors are touching but the hand sweep starts
 * a few centimetres inside/outside the visual mesh and no push is produced.
 */
export const combatCloseGuardShoveEligible = (
  guardActive: boolean,
  spacing: CombatMeleeSpacing,
  horizontalDistance: number,
): boolean => guardActive
  && spacing === 'close'
  && Number.isFinite(horizontalDistance)
  && horizontalDistance >= 0
  && horizontalDistance <= COMBAT_MELEE_CLOSE_MAX_DISTANCE + 0.08;

export interface MeleeAttackProfile {
  readonly damage: number;
  readonly reach: number;
  readonly impactFraction: number;
  readonly knockdownChance: number;
  readonly playbackRate: number;
  readonly unblockable: boolean;
}

export const HEAVY_DOUBLE_TAP_MIN_SECONDS = 0.085;
export const HEAVY_DOUBLE_TAP_MAX_SECONDS = 0.26;
export const HEAVY_DOUBLE_TAP_QUIET_SECONDS = 0.30;
export const HEAVY_DOUBLE_TAP_CONFIRM_SECONDS = 0.12;
export const HEAVY_DOUBLE_TAP_SPAM_LOCKOUT_SECONDS = 0.50;
export const HEAVY_DOUBLE_TAP_MAX_PRESS_SECONDS = 0.34;

export interface HeavyTapResult {
  readonly normalPunch: boolean;
  readonly pendingHeavy: boolean;
  readonly cancelledBySpam: boolean;
}

/**
 * Exact double-click detector for heavy punches. A normal first punch is allowed
 * immediately, but the heavy upgrade is only confirmed after exactly two short
 * taps following a quiet period. A third rapid tap cancels the heavy and stays
 * in the normal-punch path, so mouse spam can never farm heavy attacks.
 */
export class CombatHeavyTapDetector {
  private lastAnyTap = Number.NEGATIVE_INFINITY;
  private firstTap = Number.NEGATIVE_INFINITY;
  private pendingConfirmationAt = Number.POSITIVE_INFINITY;
  private pending = false;
  private lockoutUntil = Number.NEGATIVE_INFINITY;

  tap(now: number, pressDuration: number): HeavyTapResult {
    if (!Number.isFinite(now)) return { normalPunch: true, pendingHeavy: false, cancelledBySpam: false };
    const shortPress = Number.isFinite(pressDuration)
      && pressDuration >= 0
      && pressDuration <= HEAVY_DOUBLE_TAP_MAX_PRESS_SECONDS;

    if (this.pending && now <= this.pendingConfirmationAt) {
      this.pending = false;
      this.firstTap = Number.NEGATIVE_INFINITY;
      this.pendingConfirmationAt = Number.POSITIVE_INFINITY;
      this.lockoutUntil = now + HEAVY_DOUBLE_TAP_SPAM_LOCKOUT_SECONDS;
      this.lastAnyTap = now;
      return { normalPunch: true, pendingHeavy: false, cancelledBySpam: true };
    }

    if (!shortPress || now < this.lockoutUntil) {
      this.firstTap = Number.NEGATIVE_INFINITY;
      this.lastAnyTap = now;
      return { normalPunch: true, pendingHeavy: false, cancelledBySpam: false };
    }

    const quietBefore = now - this.lastAnyTap >= HEAVY_DOUBLE_TAP_QUIET_SECONDS;
    const hasFirst = Number.isFinite(this.firstTap);
    const gap = hasFirst ? now - this.firstTap : Number.POSITIVE_INFINITY;
    this.lastAnyTap = now;

    if (hasFirst && gap >= HEAVY_DOUBLE_TAP_MIN_SECONDS && gap <= HEAVY_DOUBLE_TAP_MAX_SECONDS) {
      this.pending = true;
      this.pendingConfirmationAt = now + HEAVY_DOUBLE_TAP_CONFIRM_SECONDS;
      this.firstTap = Number.NEGATIVE_INFINITY;
      return { normalPunch: false, pendingHeavy: true, cancelledBySpam: false };
    }

    this.firstTap = quietBefore ? now : Number.NEGATIVE_INFINITY;
    return { normalPunch: true, pendingHeavy: false, cancelledBySpam: false };
  }

  update(now: number): boolean {
    if (!this.pending || !Number.isFinite(now) || now < this.pendingConfirmationAt) return false;
    this.pending = false;
    this.pendingConfirmationAt = Number.POSITIVE_INFINITY;
    this.firstTap = Number.NEGATIVE_INFINITY;
    this.lockoutUntil = now + HEAVY_DOUBLE_TAP_SPAM_LOCKOUT_SECONDS;
    return true;
  }

  isAwaitingSecondTap(now: number): boolean {
    return Number.isFinite(now)
      && Number.isFinite(this.firstTap)
      && now >= this.firstTap
      && now - this.firstTap <= HEAVY_DOUBLE_TAP_MAX_SECONDS;
  }

  cancel(): void {
    this.lastAnyTap = Number.NEGATIVE_INFINITY;
    this.firstTap = Number.NEGATIVE_INFINITY;
    this.pending = false;
    this.pendingConfirmationAt = Number.POSITIVE_INFINITY;
    this.lockoutUntil = Number.NEGATIVE_INFINITY;
  }
}

export const COUNTER_DOUBLE_TAP_MIN_SECONDS = 0.085;
export const COUNTER_DOUBLE_TAP_MAX_SECONDS = 0.28;
export const COUNTER_FIRST_TAP_QUIET_SECONDS = 0.30;
export const COUNTER_CONFIRM_DELAY_SECONDS = 0.18;
export const COUNTER_SPAM_LOCKOUT_SECONDS = 0.55;
export const NPC_COUNTER_WINDOW_BEFORE_IMPACT = 0.48;
export const NPC_COUNTER_WINDOW_CLOSE_BEFORE_IMPACT = 0.22;


// GTA-style melee is readable because a strike has an anticipation, a short
// contact window and a recovery instead of applying damage at one arbitrary
// timer tick. The runtime samples the real fist path only inside this window.
export const COMBAT_STRIKE_CONTACT_WINDOW: Readonly<Record<MeleeAttackKind, readonly [number, number]>> = {
  punch: [0.16, 0.80],
  'big-punch': [0.18, 0.82],
  'hook-counter': [0.16, 0.80],
};

export const combatStrikeContactWindowOpen = (
  kind: MeleeAttackKind,
  normalizedTime: number,
): boolean => {
  if (!Number.isFinite(normalizedTime)) return false;
  const [start, end] = COMBAT_STRIKE_CONTACT_WINDOW[kind];
  return normalizedTime >= start && normalizedTime <= end;
};

// A visible dodge/counter spends the first half getting the head/torso out of
// the incoming line, holds low briefly, then rises into the counter strike.
export const COMBAT_DODGE_COUNTER_DURATION_SECONDS = 0.74;
export const COMBAT_DODGE_COUNTER_STRIKE_AT_SECONDS = 0.43;
export const COMBAT_DODGE_COUNTER_MOVE_SECONDS = 0.34;
export const COMBAT_DODGE_COUNTER_SIDE_SPEED = 2.35;
export const COMBAT_DODGE_COUNTER_BACK_SPEED = 1.18;

export const COMBAT_ATTACK_TARGET_DURATION_SECONDS: Readonly<Record<MeleeAttackKind, number>> = {
  // Readable natural beats: visible load, committed extension and recoil. Recovery is handled inside the authored/additive
  // strike itself; do not keep the player trapped for a long dead tail.
  // A punch now has enough room for a readable load, extension and recoil.
  // Flow comes from an explicit late-recoil chain window rather than crushing
  // every strike into a 0.5 s arcade jab.
  punch: 0.66,
  'big-punch': 0.79,
  'hook-counter': 0.70,
};

// Player melee is deliberately paced rather than mashable. A click made during
// the current strike or this post-strike recovery is ignored, never buffered.
// Counters keep a shorter recovery so defensive timing still feels responsive.
export const COMBAT_ATTACK_RECOVERY_SECONDS: Readonly<Record<MeleeAttackKind, number>> = {
  // Tiny anti-mash lock only. The visible clip already contains its recoil back
  // to guard; a second long cooldown made every hit feel delayed and sticky.
  // Only a tiny safety lock remains after the visible recoil. Normal flow is
  // handled by an immediate chain during the late recoil, never by a queued hit.
  punch: 0.025,
  'big-punch': 0.045,
  'hook-counter': 0.030,
};

export const combatAttackRecoverySeconds = (kind: MeleeAttackKind): number =>
  COMBAT_ATTACK_RECOVERY_SECONDS[kind];

/**
 * Normalizes authored FBXs to a compact combat tempo. Some supplied clips are
 * much slower than others; using one fixed playbackRate makes those variants
 * feel like slow motion. This targets a consistent real-world strike duration
 * while retaining a small safety clamp for unusually short/long source clips.
 */
export const combatAttackPlaybackRate = (
  kind: MeleeAttackKind,
  clipDuration: number,
  tempoMultiplier = 1,
): number => {
  if (!Number.isFinite(clipDuration) || clipDuration <= 0) return 1;
  const safeTempo = Number.isFinite(tempoMultiplier)
    ? Math.max(0.72, Math.min(1.45, tempoMultiplier))
    : 1;
  const target = COMBAT_ATTACK_TARGET_DURATION_SECONDS[kind] * safeTempo;
  return Math.max(0.90, Math.min(4.25, clipDuration / Math.max(0.12, target)));
};

export const MELEE_ATTACKS: Readonly<Record<MeleeAttackKind, MeleeAttackProfile>> = {
  punch: {
    damage: 12,
    reach: 1.88,
    impactFraction: 0.48,
    knockdownChance: 0.20,
    playbackRate: 1.0,
    unblockable: false,
  },
  'big-punch': {
    damage: 27,
    reach: 2.00,
    impactFraction: 0.52,
    knockdownChance: 0.50,
    playbackRate: 1.0,
    unblockable: false,
  },
  'hook-counter': {
    damage: 22,
    reach: 1.94,
    impactFraction: 0.46,
    knockdownChance: 0.36,
    playbackRate: 1.0,
    unblockable: true,
  },
};




/**
 * Player-to-NPC damage is contextual instead of one flat number. A cramped
 * shove creates space but does little damage, a clean boxing-range straight is
 * the baseline, and a committed step-in carries a little more energy. The
 * contact-distance factor gently penalizes glancing hits at the absolute edge
 * of reach without introducing random damage spikes.
 */
export const combatContextualDamage = (
  kind: MeleeAttackKind,
  spacing: CombatMeleeSpacing,
  contactDistance: number,
  reach = MELEE_ATTACKS[kind].reach,
): number => {
  if (!Number.isFinite(contactDistance) || contactDistance < 0 || !Number.isFinite(reach) || reach <= 0) return 0;
  if (contactDistance > reach) return 0;

  const base = kind === 'hook-counter'
    ? 19
    : kind === 'big-punch'
      ? spacing === 'close' ? 15 : spacing === 'far' ? 24 : 21
      : spacing === 'close' ? 6 : spacing === 'far' ? 14 : 11;
  const edgeStart = reach * 0.76;
  const edgeSpan = Math.max(0.08, reach - edgeStart);
  const edge = Math.max(0, contactDistance - edgeStart) / edgeSpan;
  const contactQuality = 1 - Math.min(1, edge) * 0.22;
  return Math.max(1, Math.round(base * contactQuality));
};


/**
 * Physical strike damage. The timer no longer grants a hit: the hand sweep must
 * overlap the opponent first, then speed/contact zone only modulate the amount.
 * This keeps body shots readable, rewards a clean head contact modestly and
 * prevents slow/glancing animation edges from doing full damage.
 */
export const combatPhysicalContactDamage = (
  kind: MeleeAttackKind,
  spacing: CombatMeleeSpacing,
  contactDistance: number,
  fistSpeed: number,
  zone: CombatHitZone,
  reach = MELEE_ATTACKS[kind].reach,
): number => {
  const contextual = combatContextualDamage(kind, spacing, contactDistance, reach);
  if (contextual <= 0 || !Number.isFinite(fistSpeed)) return 0;
  const speed01 = Math.max(0, Math.min(1, (fistSpeed - 1.35) / 5.25));
  const speedScale = 0.72 + speed01 * 0.34;
  const zoneScale = zone === 'head' ? 1.16 : zone === 'upper-body' ? 1.02 : 0.94;
  return Math.max(1, Math.round(contextual * speedScale * zoneScale));
};

export const combatNormalAttackAllowed = (defensiveGuardActive: boolean, counterModifierHeld: boolean): boolean =>
  defensiveGuardActive && !counterModifierHeld;

export const combatHookCounterAllowed = (counterModifierHeld: boolean, counterWindowOpen: boolean): boolean =>
  counterModifierHeld && counterWindowOpen;

/** Counter input is front-facing only: an attacker behind the player cannot be
 * auto-countered by holding the defensive modifier and mashing LMB. */
export const combatCounterFacingAllowed = (aimDot: number): boolean =>
  Number.isFinite(aimDot) && aimDot >= 0.45;

export const shouldKnockDownFromPunch = (
  kind: MeleeAttackKind,
  roll: number,
): boolean => {
  const chance = MELEE_ATTACKS[kind].knockdownChance;
  return Number.isFinite(roll) && roll >= 0 && roll < chance;
};


export const NPC_KNOCKDOWN_CHANCE: Readonly<Record<MeleeAttackKind, number>> = {
  punch: 0.08,
  'big-punch': 0.30,
  'hook-counter': 0.16,
};

/**
 * The test NPC should not fall over on most ordinary hits. Player-facing combat
 * keeps the original 20% / 50% profiles; this lower NPC-only roll makes a first
 * clean hit usually play one of the supplied hit reactions instead. A second
 * hit during that reaction is still a guaranteed knockdown in AnimationLab.
 */
export const shouldNpcKnockDownFromPunch = (
  kind: MeleeAttackKind,
  roll: number,
): boolean => {
  const chance = NPC_KNOCKDOWN_CHANCE[kind];
  return Number.isFinite(roll) && roll >= 0 && roll < chance;
};

export const HIT_REACTION_TARGET_DURATION_SECONDS: Readonly<Record<MeleeAttackKind, number>> = {
  punch: 0.58,
  'big-punch': 0.74,
  'hook-counter': 0.66,
};

export const hitReactionPlaybackRate = (
  kind: MeleeAttackKind,
  clipDuration: number,
): number => {
  if (!Number.isFinite(clipDuration) || clipDuration <= 0) return 1;
  const target = HIT_REACTION_TARGET_DURATION_SECONDS[kind];
  return Math.max(0.95, Math.min(3.8, clipDuration / Math.max(0.18, target)));
};

export const hitReactionClassForAttack = (
  kind: MeleeAttackKind,
  roll: number,
): HitReactionClass => {
  const safe = Number.isFinite(roll) ? Math.max(0, Math.min(0.999999, roll)) : 0.5;
  if (kind === 'big-punch') return safe < 0.78 ? 'big' : 'body';
  if (kind === 'hook-counter') return safe < 0.72 ? 'medium' : 'big';
  if (safe < 0.08) return 'groin';
  if (safe < 0.34) return 'body';
  if (safe < 0.72) return 'light';
  return 'medium';
};

export interface CounterTapResult {
  readonly armed: boolean;
  readonly pending: boolean;
  readonly cancelledBySpam: boolean;
}

/**
 * A counter is intentionally stricter than a normal dblclick event. The first
 * tap must follow a quiet period, exactly two short taps must land in the timing
 * window, then a small confirmation delay makes a third spam tap cancel it.
 */
export class CombatCounterTapDetector {
  private lastAnyTap = Number.NEGATIVE_INFINITY;
  private firstTap = Number.NEGATIVE_INFINITY;
  private secondTap = Number.NEGATIVE_INFINITY;
  private pendingConfirmationAt = Number.POSITIVE_INFINITY;
  private lockoutUntil = Number.NEGATIVE_INFINITY;
  private tapCount = 0;

  tap(now: number, counterWindowOpen: boolean): CounterTapResult {
    if (!Number.isFinite(now)) return { armed: false, pending: false, cancelledBySpam: false };
    if (!counterWindowOpen || now < this.lockoutUntil) {
      this.resetSequence();
      this.lastAnyTap = now;
      return { armed: false, pending: false, cancelledBySpam: false };
    }

    const quietBeforeFirst = now - this.lastAnyTap >= COUNTER_FIRST_TAP_QUIET_SECONDS;
    this.lastAnyTap = now;

    if (this.tapCount === 0) {
      if (!quietBeforeFirst) return { armed: false, pending: false, cancelledBySpam: false };
      this.firstTap = now;
      this.tapCount = 1;
      return { armed: true, pending: false, cancelledBySpam: false };
    }

    if (this.tapCount === 1) {
      const gap = now - this.firstTap;
      if (gap < COUNTER_DOUBLE_TAP_MIN_SECONDS || gap > COUNTER_DOUBLE_TAP_MAX_SECONDS) {
        this.resetSequence();
        return { armed: false, pending: false, cancelledBySpam: false };
      }
      this.secondTap = now;
      this.tapCount = 2;
      this.pendingConfirmationAt = now + COUNTER_CONFIRM_DELAY_SECONDS;
      return { armed: true, pending: true, cancelledBySpam: false };
    }

    // Any third tap before the confirmation gap is considered spam and cancels
    // the counter rather than accidentally rewarding button mashing.
    if (now <= this.pendingConfirmationAt) {
      this.lockoutUntil = now + COUNTER_SPAM_LOCKOUT_SECONDS;
      this.resetSequence();
      return { armed: false, pending: false, cancelledBySpam: true };
    }

    this.resetSequence();
    return { armed: false, pending: false, cancelledBySpam: false };
  }

  update(now: number, counterWindowOpen: boolean): boolean {
    // Once the second tap was accepted inside the counter window, confirmation
    // is allowed to complete just after the visual window closes. The close
    // margin is larger than the confirmation delay, so this still resolves
    // before the hostile impact while a third tap can cancel spam.
    if (this.tapCount === 2 && now >= this.pendingConfirmationAt) {
      this.resetSequence();
      return true;
    }
    if (!counterWindowOpen) {
      this.resetSequence();
      return false;
    }
    if (this.tapCount === 1 && now - this.firstTap > COUNTER_DOUBLE_TAP_MAX_SECONDS) {
      this.resetSequence();
    }
    return false;
  }

  cancel(now = Number.NEGATIVE_INFINITY): void {
    this.resetSequence();
    if (Number.isFinite(now)) this.lockoutUntil = Math.max(this.lockoutUntil, now);
  }

  private resetSequence(): void {
    this.firstTap = Number.NEGATIVE_INFINITY;
    this.secondTap = Number.NEGATIVE_INFINITY;
    this.pendingConfirmationAt = Number.POSITIVE_INFINITY;
    this.tapCount = 0;
  }
}

export const npcCounterWindowOpen = (
  elapsed: number,
  impactTime: number,
): boolean => {
  if (!Number.isFinite(elapsed) || !Number.isFinite(impactTime) || impactTime <= 0) return false;
  return elapsed >= impactTime - NPC_COUNTER_WINDOW_BEFORE_IMPACT
    && elapsed <= impactTime - NPC_COUNTER_WINDOW_CLOSE_BEFORE_IMPACT;
};
