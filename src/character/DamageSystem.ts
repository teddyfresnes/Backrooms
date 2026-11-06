export type RagdollImpactPart =
  | 'head'
  | 'core'
  | 'upper-arm'
  | 'forearm'
  | 'upper-leg'
  | 'lower-leg';

export type RagdollImpactSurface = 'wall' | 'floor' | 'step' | 'other';

export interface DamageVisualState {
  readonly grayscale: number;
  readonly saturation: number;
  readonly vignette: number;
  readonly bloodOpacity: number;
  readonly bloodScale: number;
  readonly contrast: number;
  readonly brightness: number;
  readonly deathVeil: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Persistent damage presentation driven by current HP, not by a timer.
 * Regeneration therefore clears each visual stage only after its HP threshold
 * has actually been crossed again.
 */
export const damageVisualState = (
  health: number,
  maxHealth = 100,
  includeDeathEffect = true,
): DamageVisualState => {
  const ratio = clamp01(maxHealth > 0 ? health / maxHealth : 0);
  const hurt = 1 - ratio;
  const low = clamp01((0.46 - ratio) / 0.46);
  const critical = clamp01((0.22 - ratio) / 0.22);
  // The death look is deliberately separate from the ordinary low-HP effect:
  // being critically wounded is dirty/desaturated, while 0 HP crushes the
  // exposure and contrast into a much harsher tunnel-vision frame.
  const deathVeil = includeDeathEffect ? clamp01((0.035 - ratio) / 0.035) : 0;
  return {
    grayscale: clamp01(low * 0.62 + critical * 0.60 + deathVeil * 0.30),
    saturation: Math.max(0.04, 1 - low * 0.48 - critical * 0.58 - deathVeil * 0.24),
    vignette: clamp01(hurt * 0.20 + low * 0.42 + critical * 0.30 + deathVeil * 0.36),
    // Keep plenty of persistent injury detail, but the CSS renders it as dark,
    // dried edge smears rather than a bright-red arcade flash.
    bloodOpacity: clamp01(
      ratio > 0.76 ? 0
        : ratio > 0.52 ? (0.76 - ratio) / 0.24 * 0.12
          : ratio > 0.30 ? 0.12 + (0.52 - ratio) / 0.22 * 0.18
            : ratio > 0.12 ? 0.30 + (0.30 - ratio) / 0.18 * 0.22
              : 0.52 + (0.12 - ratio) / 0.12 * 0.08,
    ),
    bloodScale: 1 + low * 0.035 + critical * 0.025,
    contrast: 1 + low * 0.06 + critical * 0.09 + deathVeil * 0.20,
    brightness: Math.max(0.60, 1 - low * 0.06 - critical * 0.10 - deathVeil * 0.24),
    deathVeil,
  };
};

const partProfile = (part: RagdollImpactPart): { threshold: number; scale: number } => {
  switch (part) {
    case 'head': return { threshold: 3.35, scale: 3.15 };
    case 'core': return { threshold: 5.15, scale: 1.34 };
    case 'upper-leg': return { threshold: 6.0, scale: 0.72 };
    case 'lower-leg': return { threshold: 6.3, scale: 0.58 };
    case 'upper-arm': return { threshold: 6.4, scale: 0.46 };
    case 'forearm': return { threshold: 6.8, scale: 0.38 };
  }
};

/** Damage from the normal component of a physical ragdoll impact. */
export const ragdollImpactDamage = (
  part: RagdollImpactPart,
  impactSpeed: number,
  surface: RagdollImpactSurface,
): number => {
  const profile = partProfile(part);
  const surfaceBias = surface === 'wall' ? -0.20 : surface === 'step' ? 0.18 : 0;
  const excess = Math.max(0, impactSpeed - (profile.threshold + surfaceBias));
  if (excess <= 0) return 0;
  // Progressive, deliberately non-linear: bumping a wall is cheap, a high-speed
  // head strike can be catastrophic without making ordinary stair contacts hurt.
  const raw = Math.pow(excess, 1.55) * profile.scale;
  return Math.max(1, Math.round(Math.min(100, raw)));
};

export const ragdollImpactNeedsBlood = (
  part: RagdollImpactPart,
  impactSpeed: number,
  damage: number,
): boolean => {
  if (part === 'head') return impactSpeed >= 4.6 && damage >= 5;
  if (part === 'core') return impactSpeed >= 7.2 && damage >= 12;
  return impactSpeed >= 8.8 && damage >= 15;
};

export const ragdollImpactGuaranteesBlood = (
  part: RagdollImpactPart,
  impactSpeed: number,
  damage: number,
  surface: RagdollImpactSurface,
  landingDamage = 0,
  fatalDrop = false,
  wouldKill = false,
): boolean => {
  if (fatalDrop) return true;
  if (part === 'head') return impactSpeed >= 4.1 && damage >= 3;
  if (wouldKill && damage >= 6) return true;
  if ((surface === 'floor' || surface === 'step') && landingDamage >= 24) return true;
  if (part === 'core') return impactSpeed >= 6.6 && damage >= 10;
  return (surface === 'floor' || surface === 'step') && impactSpeed >= 7.8 && damage >= 12;
};

export const ragdollImpactPrefersBurst = (
  part: RagdollImpactPart,
  impactSpeed: number,
  damage: number,
  surface: RagdollImpactSurface,
  landingDamage = 0,
  fatalDrop = false,
  wouldKill = false,
): boolean => {
  if (fatalDrop) return true;
  if (part === 'head' && (impactSpeed >= 5.8 || damage >= 10 || wouldKill)) return true;
  if (wouldKill && damage >= 8) return true;
  if ((surface === 'floor' || surface === 'step') && landingDamage >= 40) return true;
  if (part === 'core' && (surface === 'floor' || surface === 'step') && impactSpeed >= 8.0 && damage >= 14) return true;
  return false;
};

/** A fall this deep is fatal regardless of remaining HP. */
export const ragdollDropIsFatal = (dropMeters: number): boolean => dropMeters >= 8.25;

export const bloodDecalSizeForImpact = (
  part: RagdollImpactPart,
  damage: number,
): number => {
  const base = part === 'head' ? 0.50 : part === 'core' ? 0.42 : 0.30;
  return Math.min(1.05, base + Math.sqrt(Math.max(0, damage)) * 0.035);
};

export const ragdollBodyImpactPart = (bodyId: string): RagdollImpactPart => {
  if (bodyId === 'head') return 'head';
  if (bodyId === 'core') return 'core';
  if (bodyId.includes('forearm')) return 'forearm';
  if (bodyId.includes('upper-arm')) return 'upper-arm';
  if (bodyId.includes('upper-leg')) return 'upper-leg';
  return 'lower-leg';
};
