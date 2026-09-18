export const FINAL_SETTLE_START_SECONDS = 1.55;
export const FINAL_SETTLE_RELEASE_THRESHOLD = 0.18;
export const FINAL_RELAX_START_SECONDS = 1.68;
export const FINAL_RELAX_FADE_SECONDS = 3.35;
export const FINAL_LEG_SCISSOR_START_METERS = 0.46;
export const FINAL_LEG_SCISSOR_TARGET_METERS = 0.30;
export const FINAL_LEG_OVERREACH_START_METERS = 0.38;
export const FINAL_LEG_OVERREACH_SHIN_EXTRA_START_METERS = 0.22;

export const FATAL_FALL_TERMINAL_REST_MIN_SECONDS = 0.72;
export const FATAL_FALL_TERMINAL_REST_HOLD_SECONDS = 0.24;

export interface FatalFallTerminalRestSample {
  readonly elapsedSinceImpact: number;
  readonly coreSupported: boolean;
  readonly supportCount: number;
  readonly verticalSpan: number;
  readonly meanHorizontalSpeed: number;
  readonly meanVerticalSpeed: number;
  readonly maxAbsVerticalSpeed: number;
  readonly maxLinearSpeed: number;
  readonly maxAngularSpeed: number;
  readonly coherentAngularSpeed: number;
  /** Absolute world-up component of the torso's anatomical vertical axis. */
  readonly coreUprightness?: number;
  /** Actual fixed contact heights can differ across several stair treads. */
  readonly supportHeightSpan?: number;
}

/**
 * Any fallen ragdoll is allowed to sleep only after it has demonstrably
 * collapsed onto fixed geometry. This is deliberately stricter than a
 * plain speed threshold: a body that is still falling, hanging from a limb, or
 * sliding across the floor must remain dynamic. Once the torso is supported and
 * the full body has stayed low and vertically quiet, we can safely put the whole
 * articulated island to sleep at once. That prevents the solver/joints from
 * sustaining the pathological late "orbit around an invisible point" loop.
 */
export const ragdollTerminalRestEligible = (sample: FatalFallTerminalRestSample): boolean => {
  if (Object.values(sample).some(value => typeof value === 'number' && !Number.isFinite(value))) return false;
  if (sample.elapsedSinceImpact < FATAL_FALL_TERMINAL_REST_MIN_SECONDS) return false;
  if (!sample.coreSupported || sample.supportCount < 3) return false;
  const raisedSpan = sample.verticalSpan - Math.max(0, sample.supportHeightSpan ?? 0);
  if (raisedSpan > 0.92) return false;
  // On stairs an inverted/curled torso can already lie across several treads.
  // Judge its remaining height above those contacts, not the world's Y axis
  // alone. An upright, still-raised torso on flat ground remains ineligible.
  if ((sample.coreUprightness ?? 0) > 0.78 && raisedSpan > 0.55) return false;
  if (Math.abs(sample.meanVerticalSpeed) > 0.28 || sample.maxAbsVerticalSpeed > 0.56) return false;
  if (sample.meanHorizontalSpeed > 0.24) return false;

  const naturallyQuiet = sample.maxLinearSpeed <= 1.12 && sample.maxAngularSpeed <= 2.85;
  const groundedOrbit = sample.coherentAngularSpeed >= 0.42
    && sample.maxLinearSpeed <= 2.75
    && sample.maxAngularSpeed <= 7.2;
  return naturallyQuiet || groundedOrbit;
};

// Kept for the existing callers of the original high-fall eligibility rule.
export const fatalFallTerminalRestEligible = ragdollTerminalRestEligible;

export interface RagdollFinalSettleSample {
  readonly elapsed: number;
  readonly coreY: number;
  readonly headY: number;
  readonly forearmYs: readonly number[];
  readonly lowerLegYs: readonly number[];
  readonly allBodyYs: readonly number[];
  readonly coreLinearSpeed: number;
  readonly coreAngularSpeed: number;
  readonly maxLinearSpeed: number;
}

export interface RagdollFinalRelaxSample {
  readonly elapsed: number;
  readonly coreLinearSpeed: number;
  readonly coreAngularSpeed: number;
  readonly maxLinearSpeed: number;
}

export interface RagdollLegScissorClosure {
  readonly strength: number;
  readonly leftAngularSpeed: number;
  readonly rightAngularSpeed: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const smooth01 = (value: number): number => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

/**
 * Detects the late, almost-static poses where a dead body is being held up by
 * one/two limbs instead of its pelvis/rib cage reaching a real support.
 *
 * This intentionally does nothing during the energetic part of the ragdoll.
 * It only reports a release strength after the active reflex window and when
 * the complete body is nearly still. Two common bad equilibria are covered:
 * - "crutch": core sits far above a distal arm/leg like a rigid support post.
 * - "hanger": feet/shins are caught above the core while the torso hangs in air.
 */
export const ragdollFinalSupportRelease = (sample: RagdollFinalSettleSample): number => {
  if (sample.elapsed < FINAL_SETTLE_START_SECONDS) return 0;
  if (sample.coreLinearSpeed > 0.72 || sample.coreAngularSpeed > 1.05 || sample.maxLinearSpeed > 1.22) return 0;

  const supportYs = [...sample.forearmYs, ...sample.lowerLegYs].filter(Number.isFinite);
  const allYs = sample.allBodyYs.filter(Number.isFinite);
  if (supportYs.length === 0 || allYs.length === 0 || !Number.isFinite(sample.coreY)) return 0;

  const minSupportY = Math.min(...supportYs);
  const maxSupportY = Math.max(...supportYs);
  const minBodyY = Math.min(...allYs);
  const maxBodyY = Math.max(...allYs);
  const verticalSpan = Math.max(0, maxBodyY - minBodyY);

  // A body resting on its back/side has its core close to the lowest limb
  // centers. A large gap means a distal limb is acting as a structural crutch.
  const crutchHeight = sample.coreY - minSupportY;
  const crutch = clamp01((crutchHeight - 0.34) / 0.52)
    * clamp01((verticalSpan - 0.58) / 0.58);

  // In a stair/ledge hang the failure is inverted: shin/forearm centers can be
  // well above the pelvis while the heavy core hangs below them in empty space.
  const hangHeight = maxSupportY - sample.coreY;
  const hanger = clamp01((hangHeight - 0.30) / 0.48)
    * clamp01((verticalSpan - 0.54) / 0.56);

  // The head below the core is extra evidence of an upside-down hanging body,
  // but never enough on its own to trigger a release.
  const invertedTorso = Number.isFinite(sample.headY)
    ? clamp01((sample.coreY - sample.headY - 0.08) / 0.34)
    : 0;

  return clamp01(Math.max(crutch, hanger * (0.82 + invertedTorso * 0.18)));
};

/**
 * Short late relaxation window. It starts only after the active-fall reflexes
 * have gone quiet, and fades back out so a corpse can still enter Rapier sleep.
 * Any renewed motion cancels it immediately instead of fighting a new impact.
 */
export const ragdollFinalRelaxationEnvelope = (sample: RagdollFinalRelaxSample): number => {
  if (sample.elapsed < FINAL_RELAX_START_SECONDS || sample.elapsed >= FINAL_RELAX_FADE_SECONDS) return 0;
  if (sample.coreLinearSpeed > 0.52 || sample.coreAngularSpeed > 0.86 || sample.maxLinearSpeed > 0.96) return 0;

  const fadeIn = smooth01((sample.elapsed - FINAL_RELAX_START_SECONDS) / 0.34);
  const fadeOut = 1 - smooth01((sample.elapsed - 2.92) / (FINAL_RELAX_FADE_SECONDS - 2.92));
  const coreStill = 1 - smooth01(sample.coreLinearSpeed / 0.52);
  const angularStill = 1 - smooth01(sample.coreAngularSpeed / 0.86);
  const islandStill = 1 - smooth01(sample.maxLinearSpeed / 0.96);
  return clamp01(fadeIn * fadeOut * Math.min(coreStill, angularStill, islandStill));
};

/**
 * Returns a *small* late hip angular bias only for extreme final poses:
 * - a classic fore/aft split between both legs;
 * - or one lower leg folded so far over the torso that it approaches the head.
 *
 * It still never tries to align both legs perfectly: the target deliberately
 * keeps about 30 cm of fore/aft separation so a natural asymmetric resting
 * pose survives.
 */
export const ragdollLegScissorClosure = (
  leftUpperForwardOffset: number,
  rightUpperForwardOffset: number,
  leftLowerForwardOffset: number,
  rightLowerForwardOffset: number,
  relaxation: number,
): RagdollLegScissorClosure => {
  const offsets = [
    leftUpperForwardOffset, rightUpperForwardOffset,
    leftLowerForwardOffset, rightLowerForwardOffset,
  ];
  if (offsets.some((value) => !Number.isFinite(value)) || relaxation <= 0) {
    return { strength: 0, leftAngularSpeed: 0, rightAngularSpeed: 0 };
  }

  const leftWeighted = leftUpperForwardOffset * 0.42 + leftLowerForwardOffset * 0.58;
  const rightWeighted = rightUpperForwardOffset * 0.42 + rightLowerForwardOffset * 0.58;
  const upperSpread = Math.abs(leftUpperForwardOffset - rightUpperForwardOffset);
  const lowerSpread = Math.abs(leftLowerForwardOffset - rightLowerForwardOffset);
  const weightedSpread = Math.abs(leftWeighted - rightWeighted);
  const spread = Math.max(upperSpread, lowerSpread * 0.92, weightedSpread);

  const leftShinExtra = leftLowerForwardOffset - leftUpperForwardOffset;
  const rightShinExtra = rightLowerForwardOffset - rightUpperForwardOffset;
  const leftOverreach = smooth01(
    (leftWeighted - FINAL_LEG_OVERREACH_START_METERS) / 0.30,
  ) * smooth01((leftShinExtra - FINAL_LEG_OVERREACH_SHIN_EXTRA_START_METERS) / 0.26);
  const rightOverreach = smooth01(
    (rightWeighted - FINAL_LEG_OVERREACH_START_METERS) / 0.30,
  ) * smooth01((rightShinExtra - FINAL_LEG_OVERREACH_SHIN_EXTRA_START_METERS) / 0.26);
  const overreach = Math.max(leftOverreach, rightOverreach);

  if (spread <= FINAL_LEG_SCISSOR_START_METERS && overreach <= 0.02) {
    return { strength: 0, leftAngularSpeed: 0, rightAngularSpeed: 0 };
  }

  const midpoint = (leftWeighted + rightWeighted) * 0.5;
  const splitNeed = smooth01((spread - FINAL_LEG_SCISSOR_START_METERS) / 0.48);
  const closureNeed = Math.max(splitNeed, overreach * 0.9) * clamp01(relaxation);
  const spreadExcess = Math.max(0, spread - FINAL_LEG_SCISSOR_TARGET_METERS);
  const overreachExcess = Math.max(0, Math.max(leftWeighted, rightWeighted) - FINAL_LEG_SCISSOR_TARGET_METERS);
  const angularSpeed = Math.min(0.66, 0.16 + Math.max(spreadExcess * 0.72, overreachExcess * 0.58)) * closureNeed;

  return {
    strength: closureNeed,
    // With the core-local +X hip axis, positive angular velocity moves a thigh
    // whose centre is in +forward back toward the pelvis, and vice versa.
    leftAngularSpeed: Math.sign(leftWeighted - midpoint) * angularSpeed,
    rightAngularSpeed: Math.sign(rightWeighted - midpoint) * angularSpeed,
  };
};
