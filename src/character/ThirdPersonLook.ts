export const THIRD_PERSON_LOOK_TUNING = {
  // Stationary: roughly a 170° viewing arc (about ±85°) can be absorbed by
  // upper torso / neck / head before the body has to follow.
  headLimitDegrees: 85,
  idleTurnStartDegrees: 88,
  idleTurnStopDegrees: 66,
  idleResidualDegrees: 64,

  // Authored idle-action turns are tiered. A normal turn only starts once the
  // player is clearly looking behind a shoulder; Big Turn is reserved for a
  // near-reversal. The procedural body already begins following at ~88°, so
  // neither authored clip can fire from an ordinary glance.
  authoredTurnStartDegrees: 106,
  authoredBigTurnStartDegrees: 146,
  authoredTurnResetDegrees: 68,

  // Once a turn clip starts, do not let locomotion/idle instantly cut it. The
  // animation must advance and the physical body yaw must actually rotate a
  // useful amount first. This keeps the pose and the controlled body aligned.
  authoredTurnMinSeconds: 0.42,
  authoredBigTurnMinSeconds: 0.58,
  authoredTurnMinBodyDegrees: 28,
  authoredBigTurnMinBodyDegrees: 52,
  authoredTurnMinClipFraction: 0.58,
  // Horizontal movement stays buffered until the body is close enough to the
  // camera direction. Releasing merely on elapsed time/body degrees allowed a
  // held Z/Q/S/D to launch camera-relative while the avatar still faced mostly
  // sideways, which looked like broken/inverted movement.
  authoredTurnMovementReleaseDegrees: 22,
  authoredBigTurnMovementReleaseDegrees: 28,
  authoredTurnCancelReleaseDegrees: 12,
  authoredTurnResidualDegrees: 8,
  authoredTurnStopDegrees: 10,
  authoredTurnBodyResponse: 8.8,
  authoredTurnMaxDegreesPerSecond: 225,

  // As soon as the player is actually moving, the body aligns much sooner so
  // locomotion still reads naturally instead of moonwalking sideways.
  movingTurnStartDegrees: 16,
  movingTurnStopDegrees: 6,
  movingResidualDegrees: 4,
  sprintTurnStartDegrees: 9,
  sprintTurnStopDegrees: 3,
  sprintResidualDegrees: 1.5,

  idleBodyResponse: 5.8,
  movingBodyResponse: 10.8,
  sprintBodyResponse: 14.5,
  idleMaxTurnDegreesPerSecond: 145,
  movingMaxTurnDegreesPerSecond: 250,
  sprintMaxTurnDegreesPerSecond: 340,
  headResponse: 11.5,
  // Authored strafe clips turn the face a little toward travel. On a forward
  // diagonal, counter only part of that yaw so the player reads as advancing
  // while still glancing naturally into the sidestep. Pure strafes are untouched.
  diagonalStrafeHeadCorrectionDegrees: 16,
  animationCandidateHoldSeconds: 0.075,
} as const;

export const wrapAngleRadians = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

/**
 * Lift a wrapped [-π, π] yaw onto the nearest equivalent angle around a
 * continuous yaw. This keeps repeated full mouse turns monotonic instead of
 * flipping direction whenever atan2 crosses the ±π branch cut.
 */
export const unwrapAngleRadians = (continuous: number, nextWrapped: number): number =>
  continuous + wrapAngleRadians(nextWrapped - wrapAngleRadians(continuous));

/**
 * Re-express an angle on the nearest 2π-equivalent turn around a continuous
 * reference. This changes only the numeric turn count, never the visible yaw.
 * It prevents several fast 360° mouse sweeps from leaving the avatar with a
 * multi-revolution "debt" that later makes the body lag or twist.
 */
export const rebaseAngleNear = (reference: number, angle: number): number => {
  if (!Number.isFinite(reference) || !Number.isFinite(angle)) return Number.isFinite(angle) ? angle : 0;
  return reference + wrapAngleRadians(angle - reference);
};

/** Angle-aware smoothing: never lerp from +π to -π through a giant rotation. */
export const dampAngleRadians = (current: number, target: number, alpha: number): number =>
  wrapAngleRadians(current + wrapAngleRadians(target - current) * Math.min(1, Math.max(0, alpha)));

export const turnThresholds = (moving: boolean, sprinting: boolean): { start: number; stop: number } => {
  if (sprinting) {
    return {
      start: THIRD_PERSON_LOOK_TUNING.sprintTurnStartDegrees,
      stop: THIRD_PERSON_LOOK_TUNING.sprintTurnStopDegrees,
    };
  }
  if (moving) {
    return {
      start: THIRD_PERSON_LOOK_TUNING.movingTurnStartDegrees,
      stop: THIRD_PERSON_LOOK_TUNING.movingTurnStopDegrees,
    };
  }
  return {
    start: THIRD_PERSON_LOOK_TUNING.idleTurnStartDegrees,
    stop: THIRD_PERSON_LOOK_TUNING.idleTurnStopDegrees,
  };
};

export const updateTurnGate = (
  absoluteOffsetDegrees: number,
  currentlyTurning: boolean,
  moving: boolean,
  sprinting: boolean,
): boolean => {
  const thresholds = turnThresholds(moving, sprinting);
  if (currentlyTurning) return absoluteOffsetDegrees > thresholds.stop;
  return absoluteOffsetDegrees >= thresholds.start;
};

export const residualLookDegrees = (moving: boolean, sprinting: boolean): number => {
  if (sprinting) return THIRD_PERSON_LOOK_TUNING.sprintResidualDegrees;
  if (moving) return THIRD_PERSON_LOOK_TUNING.movingResidualDegrees;
  return THIRD_PERSON_LOOK_TUNING.idleResidualDegrees;
};

export type StrongTurnDirection = 'left' | 'right' | 'big-left' | 'big-right';

export const strongTurnDirection = (
  signedOffsetDegrees: number,
  latched: boolean,
  moving: boolean,
  crouched: boolean,
): StrongTurnDirection | null => {
  if (moving || crouched || latched) return null;
  const absolute = Math.abs(signedOffsetDegrees);
  if (absolute < THIRD_PERSON_LOOK_TUNING.authoredTurnStartDegrees) return null;
  const side = signedOffsetDegrees < 0 ? 'left' : 'right';
  return absolute >= THIRD_PERSON_LOOK_TUNING.authoredBigTurnStartDegrees ? `big-${side}` : side;
};

export const canResetStrongTurnLatch = (absoluteOffsetDegrees: number): boolean =>
  absoluteOffsetDegrees <= THIRD_PERSON_LOOK_TUNING.authoredTurnResetDegrees;
