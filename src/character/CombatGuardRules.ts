import { forwardDiagonalAnimation } from './DirectionalLocomotionRules.js';
export type CombatViewMode = 'first-person' | 'third-person';
export type CombatLatchReason = 'manual' | 'hit' | null;
export type CombatIdleResumeMode = 'action' | 'sleeping';
export type CombatLowerAnimation =
  | 'fight-idle'
  | 'walking'
  | 'walking-backward'
  | 'walking-forward-left'
  | 'walking-forward-right'
  | 'left-strafe-walking'
  | 'right-strafe-walking';

export const MANUAL_GUARD_RELEASE_SECONDS = 1.5;
export const MANUAL_GUARD_MOVEMENT_RELEASE_SECONDS = 0.30;
export const COMBAT_HIT_GUARD_LATCH_SECONDS = 5;
// Backward-compatible name used by older integration/tests. Manual guard now
// follows the same 1.5 s release grace in both camera modes.
export const FIRST_PERSON_GUARD_RELEASE_SECONDS = MANUAL_GUARD_RELEASE_SECONDS;
export const THIRD_PERSON_GUARD_LATCH_SECONDS = MANUAL_GUARD_RELEASE_SECONDS;

export interface CombatGuardPersistenceSample {
  readonly viewMode: CombatViewMode;
  readonly pointerHeld: boolean;
  readonly latchSeconds: number;
  readonly latchReason: CombatLatchReason;
  readonly moving: boolean;
  readonly eligible: boolean;
}

export const combatGuardShouldPersist = (sample: CombatGuardPersistenceSample): boolean => {
  if (!sample.eligible) return false;
  if (sample.pointerHeld) return true;
  return sample.latchSeconds > 0;
};

export const combatGuardBlocksSprint = (active: boolean): boolean => active;

export const combatEntryTransition = (resume: CombatIdleResumeMode):
  'action-idle-to-fight-idle' | 'standing-idle-to-fight-idle' =>
  resume === 'action' ? 'action-idle-to-fight-idle' : 'standing-idle-to-fight-idle';

export const combatExitTransition = (resume: CombatIdleResumeMode):
  'fight-idle-to-action-idle' | 'fight-idle-to-standing-idle' =>
  resume === 'action' ? 'fight-idle-to-action-idle' : 'fight-idle-to-standing-idle';

export interface CombatLowerSelection {
  readonly id: CombatLowerAnimation;
  readonly reverse: boolean;
}

export const combatLowerSelection = (
  forward: number,
  right: number,
  moving: boolean,
): CombatLowerSelection => {
  if (!moving && Math.abs(forward) <= 0.05 && Math.abs(right) <= 0.05) {
    return { id: 'fight-idle', reverse: false };
  }
  const diagonal = forwardDiagonalAnimation(forward, right, false);
  if (diagonal === 'walking-forward-left' || diagonal === 'walking-forward-right') {
    return { id: diagonal, reverse: false };
  }
  const lateral = Math.abs(right) > 0.15 && Math.abs(right) >= Math.abs(forward) * 0.72;
  if (lateral) return { id: right >= 0 ? 'right-strafe-walking' : 'left-strafe-walking', reverse: false };
  return forward < -0.05
    ? { id: 'walking-backward', reverse: true }
    : { id: 'walking', reverse: false };
};

/**
 * Strike locomotion follows the ACTUAL local travel vector instead of blindly
 * switching the legs to a forward walk. The combat drive bends old momentum
 * toward the punch over time, so the lower body can naturally pass through a
 * strafe/diagonal/plant before it becomes a forward step. That transition is
 * what prevents a turn+punch from looking like a bot snapping onto rails.
 *
 * `forward` / `right` are expected to be the current horizontal velocity
 * expressed in body-local space during a committed strike. Outside a strike the
 * same helper still accepts ordinary movement intent for backwards compatibility.
 */
export const combatStrikeLowerSelection = (
  forward: number,
  right: number,
  moving: boolean,
  committedForwardStep: boolean,
): CombatLowerSelection => {
  if (!committedForwardStep) return combatLowerSelection(forward, right, moving);
  const magnitude = Math.hypot(forward, right);
  if (!moving || !Number.isFinite(magnitude) || magnitude <= 0.08) {
    return { id: 'fight-idle', reverse: false };
  }
  return combatLowerSelection(forward / magnitude, right / magnitude, true);
};

export const COMBAT_TORSO_COUNTER_YAW_MAX_RADIANS = Math.PI * (100 / 180);

const wrapRadians = (value: number): number => {
  const tau = Math.PI * 2;
  let wrapped = (value + Math.PI) % tau;
  if (wrapped < 0) wrapped += tau;
  return wrapped - Math.PI;
};

/**
 * Keeps the guard facing the same direction when a lower-body locomotion clip
 * carries its own pelvis yaw (the strafe FBXs are roughly +/-60 degrees).
 * The actual correction is distributed over the three spine joints at runtime.
 */
export const combatTorsoCounterYaw = (
  fightReferenceYaw: number,
  locomotionPelvisYaw: number,
): number => {
  if (!Number.isFinite(fightReferenceYaw) || !Number.isFinite(locomotionPelvisYaw)) return 0;
  return Math.max(
    -COMBAT_TORSO_COUNTER_YAW_MAX_RADIANS,
    Math.min(
      COMBAT_TORSO_COUNTER_YAW_MAX_RADIANS,
      wrapRadians(fightReferenceYaw - locomotionPelvisYaw),
    ),
  );
};
