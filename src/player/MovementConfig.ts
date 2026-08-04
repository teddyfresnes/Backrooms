/**
 * Single source of truth for Movement Lab locomotion/camera tuning.
 * Keep values grouped by feel so iteration never requires changing state logic.
 */
export const MOVEMENT_TUNING = {
  locomotion: {
    walkSpeed: 3.0,
    sprintSpeed: 6.65,
    sprintForwardMin: 0.45,
    sprintStrafeScale: 0.58,
    // Forward + strafe should read as a committed diagonal advance, not an
    // equal 45° sidestep. Pure Q/D strafing remains full-strength.
    forwardDiagonalStrafeScale: 0.64,
    crouchSpeed: 1.62,
    lowSpeed: 1.18,
    groundAcceleration: 20.5,
    sprintAcceleration: 15.2,
    crouchAcceleration: 17.5,
    lowAcceleration: 11.5,
    airAcceleration: 4.0,
    fallAirControlMin: 0.48,
    fallAirControlDistance: 5.5,
    fallAirControlSpeed: 10.5,
    fallAnimationStartDistance: 0.95,
    // Start the authored high-fall pose well before a fall can become lethal.
    // This gives the body/camera a readable falling phase instead of switching
    // almost straight from Falling Idle to the terminal impact.
    highFallAnimationStartDistance: 4.6,
    highFallAnimationStartSpeed: 12.2,
    // Lethal falls are intentionally much higher than before. The speed gate
    // sits just above normal terminal velocity so ordinary gameplay deaths are
    // governed by actual fall height rather than a low velocity threshold.
    highFallImpactDistance: 11.5,
    highFallImpactSpeed: 20.8,
    groundDeceleration: 16.2,
    sprintReleaseDeceleration: 11.2,
    crouchDeceleration: 19.0,
    lowDeceleration: 17.0,
    reverseTraction: 0.5,
    sharpTurnSpeedThreshold: 3.05,
    gravity: 19.2,
    terminalFallSpeed: 20.5,
    standingJumpSpeed: 5.45,
    crouchedJumpSpeed: 4.2,
    // Short ground re-arm prevents bunny-hopping / jump-animation spam while
    // keeping ordinary consecutive jumps responsive.
    jumpGroundRearmSeconds: 0.24,
    // A readable non-lethal fall uses the authored landing before locomotion
    // is returned. This also prevents Falling Idle from leaking into movement.
    // Ordinary jumps / tiny ledges should not enter the authored landing state.
    // Reserve it for a visibly heavier drop, then keep the light end of that
    // recovery very short so locomotion comes back quickly.
    landingRecoveryMinDistance: 1.35,
    landingRecoveryMinImpactSpeed: 6.6,
    landingRecoveryMinSeconds: 0.10,
    landingRecoveryMaxSeconds: 0.54,
    // Damage starts clearly above normal traversal/jump heights. The speed gate
    // mirrors roughly the same drop so stepping off small props never chips HP.
    fallDamageStartDistance: 2.8,
    fallDamageStartImpactSpeed: 9.6,
  },
  posture: {
    // A slide still finishes low, but the player regains stand/sprint control
    // almost immediately instead of being trapped crouched for a full second.
    postSpecialRiseLockDuration: 0.22,
    lowAutoRiseDelay: 0.06,
    lowManualRiseDelay: 0.04,
    sprintRiseForwardThreshold: 0.55,
    groundedSpecialGrace: 0.08,
  },
  slide: {
    minStartSpeed: 4.45,
    startBoost: 1.055,
    maxSpeed: 7.3,
    duration: 0.82,
    minDuration: 0.25,
    deceleration: 4.65,
    minExitSpeed: 2.85,
    steeringResponse: 1.65,
    jumpVerticalSpeed: 4.9,
    jumpSpeedMultiplier: 1.06,
    repeatCooldown: 0.34,
  },
  collision: {
    hardBlockSpeed: 3.35,
    hardBlockFraction: 0.42,
    // A runner pressing into a wall should stop reading as a sprint even if the
    // KCC slides a few centimetres sideways along the contact plane.
    sprintCancelBlockFraction: 0.48,
    retainedSpeedOnImpact: 0.45,
    cameraImpactScale: 0.88,
  },
  camera: {
    eyeHeight: 0.73,
    crouchDrop: 0.46,
    lowExtraDrop: 0.16,
    bobWalk: 0.029,
    bobSprint: 0.049,
    bobCrouch: 0.013,
    bobSlide: 0.01,
    bobLateralScale: 0.48,
    bobForwardScale: 0.12,
    gaitRollScale: 0.24,
    strafeLeanRadians: 0.018,
    accelerationPitchRadians: 0.019,
    brakingPitchRadians: 0.028,
    lateralAccelerationLeanRadians: 0.017,
    bodyLagForwardMeters: 0.06,
    bodyLagLateralMeters: 0.043,
    bodyLagResponse: 7.8,
    bodyLagReturnResponse: 10.2,
    idleSwayPosition: 0.0036,
    idleSwayRoll: 0.00155,
    idleSwayPitch: 0.00115,
    mouseRollPerPixel: 0.000132,
    mouseLiftPerPixel: 0.000036,
    maxMouseRoll: 0.025,
    maxMouseLift: 0.010,
    fastTurnRollPerPixel: 0.000172,
    maxFastTurnRoll: 0.029,
    turnYawKickPerPixel: 0.000038,
    turnPitchKickPerPixel: 0.000021,
    maxTurnYawKick: 0.0062,
    maxTurnPitchKick: 0.004,
    turnKickDecay: 11.8,
    motionBlendResponse: 11,
    crouchBlendResponse: 12,
    lowBlendResponse: 10,
    leanResponse: 9.5,
    manualLeanAngleRadians: 0.087,
    manualLeanMeters: 0.085,
    manualLeanDropMeters: 0.014,
    manualLeanForwardMeters: 0.012,
    manualLeanResponse: 10.5,
    manualLeanReturnResponse: 14.0,
    manualLeanSwayPosition: 0.0045,
    manualLeanSwayRoll: 0.0042,
    manualLeanSwayFrequency: 5.4,
    impulseDecay: 9.8,
    landingPositionKick: 0.14,
    landingPitchKick: 0.042,
    landingFovCompression: 1.15,
    fallPitchRadians: -0.045,
    fallCameraDropMeters: 0.034,
    fallHighPitchRadians: -0.32,
    fallHighCameraDropMeters: 0.11,
    fallHighForwardMeters: 0.09,
    fallFovBoost: 1.15,
    incapacitatedCameraDropMeters: 1.39,
    incapacitatedCameraForwardMeters: 0.08,
    incapacitatedPitchRadians: -0.12,
    incapacitatedRollRadians: 0.31,
    collisionPitchKick: 0.032,
    sprintFovBoost: 3.35,
    sprintBurstFovBoost: 1.35,
    sprintBurstDecay: 5.8,
    accelerationFovBoost: 1.05,
    speedFovBoost: 2.15,
    slideFovBoost: 1.6,
    fastTurnFovBoost: 2.65,
    maxFovBoost: 8.7,
    fovResponse: 9.5,
    turnIntensityDecay: 10.2,
    turnBlurMaxPx: 1.15,
  },
} as const;

export type MovementTuning = typeof MOVEMENT_TUNING;
export type MovementMode = 'idle' | 'walk' | 'sprint' | 'crouch' | 'low' | 'slide' | 'airborne' | 'downed';

export const validateMovementTuning = (tuning: MovementTuning = MOVEMENT_TUNING): string[] => {
  const errors: string[] = [];
  const finitePositive = (value: number, label: string): void => {
    if (!Number.isFinite(value) || value <= 0) errors.push(`${label} must be finite and > 0`);
  };

  finitePositive(tuning.locomotion.walkSpeed, 'locomotion.walkSpeed');
  finitePositive(tuning.locomotion.sprintSpeed, 'locomotion.sprintSpeed');
  finitePositive(tuning.locomotion.sprintForwardMin, 'locomotion.sprintForwardMin');
  finitePositive(tuning.locomotion.sprintStrafeScale, 'locomotion.sprintStrafeScale');
  finitePositive(tuning.locomotion.groundAcceleration, 'locomotion.groundAcceleration');
  finitePositive(tuning.locomotion.groundDeceleration, 'locomotion.groundDeceleration');
  finitePositive(tuning.locomotion.sprintReleaseDeceleration, 'locomotion.sprintReleaseDeceleration');
  finitePositive(tuning.locomotion.gravity, 'locomotion.gravity');
  finitePositive(tuning.locomotion.fallAirControlDistance, 'locomotion.fallAirControlDistance');
  finitePositive(tuning.locomotion.fallAirControlSpeed, 'locomotion.fallAirControlSpeed');
  finitePositive(tuning.locomotion.fallAnimationStartDistance, 'locomotion.fallAnimationStartDistance');
  finitePositive(tuning.locomotion.highFallAnimationStartDistance, 'locomotion.highFallAnimationStartDistance');
  finitePositive(tuning.locomotion.highFallAnimationStartSpeed, 'locomotion.highFallAnimationStartSpeed');
  finitePositive(tuning.locomotion.highFallImpactDistance, 'locomotion.highFallImpactDistance');
  finitePositive(tuning.locomotion.highFallImpactSpeed, 'locomotion.highFallImpactSpeed');
  finitePositive(tuning.locomotion.jumpGroundRearmSeconds, 'locomotion.jumpGroundRearmSeconds');
  finitePositive(tuning.locomotion.landingRecoveryMinDistance, 'locomotion.landingRecoveryMinDistance');
  finitePositive(tuning.locomotion.landingRecoveryMinImpactSpeed, 'locomotion.landingRecoveryMinImpactSpeed');
  finitePositive(tuning.locomotion.landingRecoveryMinSeconds, 'locomotion.landingRecoveryMinSeconds');
  finitePositive(tuning.locomotion.landingRecoveryMaxSeconds, 'locomotion.landingRecoveryMaxSeconds');
  finitePositive(tuning.locomotion.fallDamageStartDistance, 'locomotion.fallDamageStartDistance');
  finitePositive(tuning.locomotion.fallDamageStartImpactSpeed, 'locomotion.fallDamageStartImpactSpeed');
  finitePositive(tuning.slide.duration, 'slide.duration');
  finitePositive(tuning.slide.repeatCooldown, 'slide.repeatCooldown');
  finitePositive(tuning.posture.postSpecialRiseLockDuration, 'posture.postSpecialRiseLockDuration');
  finitePositive(tuning.camera.eyeHeight, 'camera.eyeHeight');

  if (tuning.locomotion.walkSpeed >= tuning.locomotion.sprintSpeed) errors.push('walkSpeed must be below sprintSpeed');
  if (tuning.locomotion.landingRecoveryMinSeconds >= tuning.locomotion.landingRecoveryMaxSeconds) errors.push('landing recovery min must be below max');
  if (tuning.locomotion.highFallAnimationStartDistance >= tuning.locomotion.highFallImpactDistance) errors.push('high-fall animation distance must start below lethal distance');
  if (tuning.locomotion.highFallAnimationStartSpeed >= tuning.locomotion.highFallImpactSpeed) errors.push('high-fall animation speed must start below lethal speed');
  if (tuning.locomotion.fallDamageStartDistance >= tuning.locomotion.highFallImpactDistance) errors.push('fall damage distance must start below lethal distance');
  if (tuning.locomotion.fallDamageStartImpactSpeed >= tuning.locomotion.highFallImpactSpeed) errors.push('fall damage speed must start below lethal speed');
  if (tuning.locomotion.sprintForwardMin <= 0 || tuning.locomotion.sprintForwardMin > 1) errors.push('sprintForwardMin must be in (0, 1]');
  if (tuning.locomotion.sprintStrafeScale <= 0 || tuning.locomotion.sprintStrafeScale > 1) errors.push('sprintStrafeScale must be in (0, 1]');
  if (tuning.locomotion.fallAirControlMin <= 0 || tuning.locomotion.fallAirControlMin > 1) errors.push('fallAirControlMin must be in (0, 1]');
  if (tuning.locomotion.lowSpeed >= tuning.locomotion.crouchSpeed) errors.push('lowSpeed must be below crouchSpeed');
  if (tuning.slide.minStartSpeed >= tuning.slide.maxSpeed) errors.push('slide.minStartSpeed must be below slide.maxSpeed');
  if (tuning.slide.minDuration >= tuning.slide.duration) errors.push('slide.minDuration must be below slide.duration');
  if (tuning.posture.lowManualRiseDelay > tuning.posture.postSpecialRiseLockDuration) errors.push('lowManualRiseDelay must not exceed post slide lock');
  if (tuning.posture.lowAutoRiseDelay > tuning.posture.postSpecialRiseLockDuration) errors.push('lowAutoRiseDelay must not exceed post slide lock');

  return errors;
};
