export type ActiveRagdollReactionStyle = 'brace' | 'windmill' | 'scramble' | 'asymmetric';

export interface ActiveRagdollProfile {
  /** Total time during which the body can still show conscious reflexes. */
  readonly duration: number;
  /** Interrupted walk/run cadence used to continue the current step cycle. */
  readonly gaitFrequencyHz: number;
  /** Strength of the inherited scissor motion in the legs. */
  readonly gaitStrength: number;
  /** Extra single-step attempt used to recover a foot under the falling body. */
  readonly recoveryStepStrength: number;
  /** Protective reach toward the likely impact surface. */
  readonly armBraceStrength: number;
  /** Emergency circular arm motion used to recover balance. */
  readonly armWindmillStrength: number;
  /** Opposing upper-body sway that makes the person fight the fall. */
  readonly counterBalanceStrength: number;
  readonly torsoResponseStrength: number;
  readonly style: ActiveRagdollReactionStyle;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const lerp = (from: number, to: number, alpha: number): number => from + (to - from) * alpha;

/**
 * Short-lived active-ragdoll response used immediately after the animation ->
 * physics handoff. The profile deliberately contains only *reaction strengths*.
 * RagdollSystem converts those strengths to tiny velocity changes, so Rapier
 * contacts and anatomical joint limits always remain authoritative.
 *
 * The important realism rule is continuity: a running person does not become a
 * passive sack on the hand-off frame. Their current gait survives briefly, then
 * balance reflexes and protective reaches take over before everything fades to
 * a normal passive ragdoll.
 */
export const activeRagdollProfile = (
  horizontalSpeed: number,
  verticalSpeed: number,
  hasAnimationMotion: boolean,
  variation01: number,
): ActiveRagdollProfile => {
  const speed = Math.max(0, horizontalSpeed);
  const descent = Math.max(0, -verticalSpeed);
  const locomotion = clamp01((speed - 0.28) / 4.05);
  const falling = clamp01((descent + speed * 0.14) / 4.9);
  const animationCarry = hasAnimationMotion ? 1 : 0.64;
  const variation = clamp01(variation01);

  // Long enough for roughly one recovery step / one arm windmill, but short
  // enough that the character does not look consciously animated on the floor.
  const duration = Math.min(
    1.48,
    Math.max(0.78, 0.82 + locomotion * 0.38 + falling * 0.28),
  );
  const gaitFrequencyHz = lerp(1.38, 2.7, locomotion);
  const gaitStrength = locomotion * animationCarry;
  const recoveryStepStrength = Math.min(1, locomotion * 0.76 + falling * 0.16);
  const armBraceStrength = Math.min(1, 0.18 + falling * 0.76 + locomotion * 0.17);
  const armWindmillStrength = Math.min(
    1,
    (0.12 + locomotion * 0.62 + falling * 0.18) * animationCarry,
  );
  const counterBalanceStrength = Math.min(1, 0.22 + locomotion * 0.5 + falling * 0.28);
  const torsoResponseStrength = Math.min(1, 0.2 + falling * 0.56 + locomotion * 0.34);

  let style: ActiveRagdollReactionStyle;
  if (locomotion > 0.62) {
    // Fast interrupted locomotion most often becomes a scramble, but sometimes
    // produces the classic emergency arm-circle or an uneven one-arm recovery.
    style = variation < 0.56 ? 'scramble' : variation < 0.84 ? 'windmill' : 'asymmetric';
  } else if (falling > 0.42) {
    style = variation < 0.48 ? 'brace' : variation < 0.78 ? 'windmill' : 'asymmetric';
  } else {
    style = variation < 0.38 ? 'windmill' : variation < 0.7 ? 'asymmetric' : 'scramble';
  }

  return {
    duration,
    gaitFrequencyHz,
    gaitStrength,
    recoveryStepStrength,
    armBraceStrength,
    armWindmillStrength,
    counterBalanceStrength,
    torsoResponseStrength,
    style,
  };
};

/** Smooth fast attack / long release: reflexes appear quickly but never snap. */
export const activeRagdollEnvelope = (elapsed: number, duration: number): number => {
  if (duration <= 0 || elapsed < 0 || elapsed >= duration) return 0;
  const normalized = elapsed / duration;
  const attack = clamp01(normalized / 0.065);
  const release = clamp01((1 - normalized) / 0.64);
  const smoothAttack = attack * attack * (3 - 2 * attack);
  const smoothRelease = release * release * (3 - 2 * release);
  return smoothAttack * smoothRelease;
};

/**
 * The captured animation velocity should dominate only the very beginning of
 * the ragdoll. This helper gives that hand-off a smooth ~300 ms tail.
 */
export const activeRagdollAnimationCarry = (elapsed: number): number => {
  if (elapsed < 0 || elapsed >= 0.36) return 0;
  const normalized = clamp01(elapsed / 0.36);
  const release = 1 - normalized;
  return release * release * (3 - 2 * release);
};
