export type FirstPersonIdlePose = 'action' | 'sleeping';

export const FIRST_PERSON_BODY_LOOK_TUNING = {
  // Action/standing idle is intentionally very asymmetric. The authored stance
  // tolerates a much wider head-only glance to the LEFT, while looking RIGHT
  // should bring the feet in sooner. This is camera/head freedom only; once a
  // directional threshold is crossed the normal body-follow logic takes over.
  idleActionLeftTurnStartDegrees: 85,
  idleActionRightTurnStartDegrees: 30,
  idleActionLeftBigTurnStartDegrees: 108,
  idleActionRightBigTurnStartDegrees: 52,

  // Sleeping idle has its own authored turn set. Keep a useful head-only glance
  // first, then use the sleeping turn clips instead of waking into Action Idle.
  idleSleepingTurnStartDegrees: 34,
  idleSleepingBigTurnStartDegrees: 58,

  // Once an Action-Idle turn has brought the POV comfortably back inside the
  // anatomical free-look arc, do not force the stance to square up perfectly
  // with the camera. Keeping a small residual yaw makes the forward leg/body
  // stance feel flexible instead of mechanically parallel to the POV.
  idleActionTurnStopDegrees: 18,
  idleActionResidualDegrees: 16,

  // Sleeping Idle keeps its older near-centered recovery.
  idleTurnStopDegrees: 4,
  idleResidualDegrees: 0,

  // If a slow mouse sweep has already committed the pelvis/body follow while
  // another idle one-shot was occupying the animation slot, keep a smaller
  // recovery window for the light turn clip. This prevents gentle long turns
  // from becoming a silent procedural rotation with no footwork at all.
  idleTurnContinuationCueDegrees: 12,
  // Once stationary body-follow is committed, continued mouse rotation means
  // the feet are still physically turning even if the residual head/body yaw
  // has already been consumed. Keep authored light footwork alive for any
  // deliberate continued sweep instead of letting the pelvis glide silently.
  idleTurnContinuousMouseCueDegrees: 0.02,

  // Locomotion stays tighter so the body remains movement-led.
  movingTurnStartDegrees: 28,
  movingTurnStopDegrees: 3,
  movingResidualDegrees: 0,

  // Sprinting is tighter again; no authored idle turn is used while moving.
  sprintTurnStartDegrees: 20,
  sprintTurnStopDegrees: 2,
  sprintResidualDegrees: 0,

  idleBodyResponse: 14.0,
  movingBodyResponse: 18.0,
  sprintBodyResponse: 22.0,
  idleMaxDegreesPerSecond: 360,
  movingMaxDegreesPerSecond: 480,
  sprintMaxDegreesPerSecond: 620,
} as const;

export type FirstPersonIdleTurnCue = 'low-left' | 'low-right' | 'big-left' | 'big-right';

const idleThresholds = (
  signedOffsetDegrees: number,
  idlePose: FirstPersonIdlePose,
): { start: number; big: number } => {
  if (idlePose === 'sleeping') {
    return {
      start: FIRST_PERSON_BODY_LOOK_TUNING.idleSleepingTurnStartDegrees,
      big: FIRST_PERSON_BODY_LOOK_TUNING.idleSleepingBigTurnStartDegrees,
    };
  }
  if (signedOffsetDegrees < 0) {
    return {
      start: FIRST_PERSON_BODY_LOOK_TUNING.idleActionLeftTurnStartDegrees,
      big: FIRST_PERSON_BODY_LOOK_TUNING.idleActionLeftBigTurnStartDegrees,
    };
  }
  return {
    start: FIRST_PERSON_BODY_LOOK_TUNING.idleActionRightTurnStartDegrees,
    big: FIRST_PERSON_BODY_LOOK_TUNING.idleActionRightBigTurnStartDegrees,
  };
};

/**
 * Select the authored stationary turn that matches the amount of yaw the body
 * must recover. The returned tier is generic; AnimationLab maps it to the
 * Action-Idle clips or the Sleeping-Idle clips depending on the current pose.
 */
export const firstPersonIdleTurnCue = (
  signedOffsetDegrees: number,
  moving: boolean,
  sprinting: boolean,
  idlePose: FirstPersonIdlePose = 'action',
  bodyAlreadyTurning = false,
  viewYawDeltaDegrees = 0,
): FirstPersonIdleTurnCue | null => {
  if (moving || sprinting) return null;
  const thresholds = idleThresholds(signedOffsetDegrees, idlePose);
  const absolute = Math.abs(signedOffsetDegrees);
  const side = signedOffsetDegrees < 0 ? 'left' : 'right';
  if (absolute >= thresholds.big) return `big-${side}`;
  if (absolute >= thresholds.start) return `low-${side}`;

  // A gentle sweep can cross the body-follow threshold while a wait/look/idle
  // transition is still playing. Once the pelvis is demonstrably turning, a
  // meaningful remaining offset is enough to recover the light foot-turn cue.
  // Tiny corrections stay silent, so this does not make normal mouse aim twitchy.
  if (bodyAlreadyTurning
    && absolute >= FIRST_PERSON_BODY_LOOK_TUNING.idleTurnContinuationCueDegrees
    && (idlePose !== 'action'
      || absolute > FIRST_PERSON_BODY_LOOK_TUNING.idleActionTurnStopDegrees)) {
    return `low-${side}`;
  }

  // During a very slow continuous sweep, body-follow can consume essentially
  // all of the head/body residual every frame. Angle-only triggering then sees
  // ~0 degrees and lets the avatar rotate with planted feet. If the stationary
  // body turn is already committed and the mouse is still deliberately moving,
  // request the light authored turn in the mouse direction so footwork never
  // drops out merely because the sweep is gentle.
  if (bodyAlreadyTurning
    && Math.abs(viewYawDeltaDegrees) >= FIRST_PERSON_BODY_LOOK_TUNING.idleTurnContinuousMouseCueDegrees) {
    return viewYawDeltaDegrees < 0 ? 'low-left' : 'low-right';
  }
  return null;
};

export type FirstPersonBodyFollowResult = {
  bodyYaw: number;
  turning: boolean;
  lookOffsetRadians: number;
  turnRateDegreesPerSecond: number;
};

const degreesToRadians = (degrees: number): number => degrees * Math.PI / 180;
const radiansToDegrees = (radians: number): number => radians * 180 / Math.PI;

const tuningForMotion = (
  moving: boolean,
  sprinting: boolean,
  signedOffsetDegrees: number,
  idlePose: FirstPersonIdlePose,
) => {
  if (sprinting) {
    return {
      start: FIRST_PERSON_BODY_LOOK_TUNING.sprintTurnStartDegrees,
      stop: FIRST_PERSON_BODY_LOOK_TUNING.sprintTurnStopDegrees,
      residual: FIRST_PERSON_BODY_LOOK_TUNING.sprintResidualDegrees,
      response: FIRST_PERSON_BODY_LOOK_TUNING.sprintBodyResponse,
      maxRate: FIRST_PERSON_BODY_LOOK_TUNING.sprintMaxDegreesPerSecond,
    };
  }
  if (moving) {
    return {
      start: FIRST_PERSON_BODY_LOOK_TUNING.movingTurnStartDegrees,
      stop: FIRST_PERSON_BODY_LOOK_TUNING.movingTurnStopDegrees,
      residual: FIRST_PERSON_BODY_LOOK_TUNING.movingResidualDegrees,
      response: FIRST_PERSON_BODY_LOOK_TUNING.movingBodyResponse,
      maxRate: FIRST_PERSON_BODY_LOOK_TUNING.movingMaxDegreesPerSecond,
    };
  }
  const thresholds = idleThresholds(signedOffsetDegrees, idlePose);
  const actionIdle = idlePose === 'action';
  return {
    start: thresholds.start,
    stop: actionIdle
      ? FIRST_PERSON_BODY_LOOK_TUNING.idleActionTurnStopDegrees
      : FIRST_PERSON_BODY_LOOK_TUNING.idleTurnStopDegrees,
    residual: actionIdle
      ? FIRST_PERSON_BODY_LOOK_TUNING.idleActionResidualDegrees
      : FIRST_PERSON_BODY_LOOK_TUNING.idleResidualDegrees,
    response: FIRST_PERSON_BODY_LOOK_TUNING.idleBodyResponse,
    maxRate: FIRST_PERSON_BODY_LOOK_TUNING.idleMaxDegreesPerSecond,
  };
};

/**
 * Follow an unbounded first-person camera yaw with a controlled anatomical
 * free-look arc. Once the directional arc is exceeded, the pelvis/feet catch
 * back up only far enough to restore a comfortable Action-Idle glance; they do
 * not have to become perfectly parallel to the camera. Both inputs stay continuous (they
 * may exceed ±π), so repeated full mouse turns never flip at the atan2 cut.
 */
export const updateFirstPersonBodyFollow = (
  viewYaw: number,
  bodyYaw: number,
  delta: number,
  moving: boolean,
  sprinting: boolean,
  currentlyTurning: boolean,
  viewYawDelta = 0,
  idlePose: FirstPersonIdlePose = 'action',
): FirstPersonBodyFollowResult => {
  let offset = viewYaw - bodyYaw;
  const signedOffsetDegrees = radiansToDegrees(offset);
  const tuning = tuningForMotion(moving, sprinting, signedOffsetDegrees, idlePose);
  const absoluteOffsetDegrees = Math.abs(signedOffsetDegrees);
  // Once a committed body turn has started, keep it latched while the mouse is
  // still moving. Otherwise the body can catch the POV, unlatch for a frame,
  // then let the camera run ahead again, which reads as a delayed/slipping turn.
  const viewIsStillTurning = Math.abs(viewYawDelta) > degreesToRadians(0.02);
  const turning = currentlyTurning
    ? absoluteOffsetDegrees > tuning.stop || viewIsStillTurning
    : absoluteOffsetDegrees >= tuning.start;

  if (!turning || delta <= 0) {
    return {
      bodyYaw,
      turning,
      lookOffsetRadians: offset,
      turnRateDegreesPerSecond: 0,
    };
  }

  // Feed the current mouse/camera yaw delta straight into the pelvis once the
  // turn is committed. The corrective term below only consumes yaw accumulated
  // during free-look, keeping the visual body turn live with the cursor.
  bodyYaw += viewYawDelta;
  offset = viewYaw - bodyYaw;

  const residualMagnitude = degreesToRadians(tuning.residual);
  // Residual yaw is a permission to stop short, never a target that can pull
  // the body away from an already-better alignment. This preserves direct live
  // mouse inheritance during a committed turn and simply stops consuming the
  // remaining offset once the stance is comfortably inside the residual band.
  const bodyError = Math.abs(offset) > residualMagnitude
    ? offset - residualMagnitude * Math.sign(offset || 1)
    : 0;
  const alpha = 1 - Math.exp(-Math.max(0, delta) * tuning.response);
  const proposedStep = bodyError * alpha;
  const maxStep = degreesToRadians(tuning.maxRate) * delta;
  const step = Math.max(-maxStep, Math.min(maxStep, proposedStep));
  bodyYaw += step;
  offset = viewYaw - bodyYaw;

  return {
    bodyYaw,
    turning,
    lookOffsetRadians: offset,
    turnRateDegreesPerSecond: radiansToDegrees(step / delta),
  };
};
