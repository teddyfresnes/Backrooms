export type GroundKickKind = 'stomp' | 'soccer-kick' | 'get-up-kick';

export interface GroundKickProfile {
  readonly duration: number;
  readonly impactFraction: number;
  readonly contactStartFraction: number;
  readonly contactEndFraction: number;
  readonly damage: number;
  readonly maxTargetDistance: number;
  readonly contactRadius: number;
  readonly impulseStrength: number;
}

export interface GroundKickPose {
  readonly chamber: number;
  readonly drive: number;
  readonly recover: number;
  readonly supportLoad: number;
  readonly lift: number;
  readonly strike: number;
}

const smooth01 = (value: number): number => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

export const GROUND_KICK_PROFILES: Readonly<Record<GroundKickKind, GroundKickProfile>> = {
  stomp: {
    duration: 1.02,
    impactFraction: 0.58,
    contactStartFraction: 0.49,
    contactEndFraction: 0.63,
    damage: 22,
    maxTargetDistance: 1.12,
    contactRadius: 0.16,
    impulseStrength: 1.20,
  },
  'soccer-kick': {
    duration: 0.96,
    impactFraction: 0.57,
    contactStartFraction: 0.44,
    contactEndFraction: 0.65,
    damage: 20,
    maxTargetDistance: 1.24,
    contactRadius: 0.16,
    impulseStrength: 1.12,
  },
  'get-up-kick': {
    duration: 0.78,
    impactFraction: 0.50,
    contactStartFraction: 0.32,
    contactEndFraction: 0.55,
    damage: 18,
    maxTargetDistance: 1.22,
    contactRadius: 0.18,
    impulseStrength: 1.16,
  },
};

export const groundKickPose = (normalized: number, kind: GroundKickKind): GroundKickPose => {
  const t = Math.max(0, Math.min(1, normalized));
  if (kind !== 'get-up-kick') {
    const lift = smooth01((t - 0.12) / (kind === 'stomp' ? 0.31 : 0.26));
    const strikePhase = Math.max(0, Math.min(1, (t - (kind === 'stomp' ? 0.43 : 0.38)) / (kind === 'stomp' ? 0.15 : 0.24)));
    // Accelerate through contact rather than easing to a stop before the sole
    // reaches the body. The beginning of the lift stays deliberately quiet.
    const strike = strikePhase * strikePhase;
    const recover = smooth01((t - 0.66) / 0.32);
    const supportLoad = smooth01(t / 0.20) * (1 - smooth01((t - 0.74) / 0.24));
    const chamber = lift * (1 - smooth01((t - (kind === 'stomp' ? 0.43 : 0.38)) / 0.20));
    const drive = strike * (1 - recover);
    return { chamber, drive, recover, supportLoad, lift, strike };
  }
  const chamberIn = smooth01((t - 0.05) / 0.23);
  const chamberOut = 1 - smooth01((t - 0.34) / 0.20);
  const chamber = chamberIn * chamberOut;
  const driveIn = smooth01((t - 0.27) / 0.19);
  const driveOut = 1 - smooth01((t - 0.58) / 0.20);
  const drive = driveIn * driveOut;
  const recover = smooth01((t - 0.62) / 0.32);
  const supportLoad = smooth01((t - 0.02) / 0.18) * (1 - smooth01((t - 0.67) / 0.27));
  return { chamber, drive, recover, supportLoad,
    lift: smooth01(t / 0.32), strike: smooth01((t - 0.32) / 0.21) };
};

/** Close overhead contact uses the sole; a low body ahead gets an instep swing. */
export const groundKickKindForTarget = (distance: number, height: number): GroundKickKind =>
  distance >= 0.78 && height < 0.68 ? 'soccer-kick' : 'stomp';

export const groundKickContactWindowOpen = (normalized: number, kind: GroundKickKind): boolean => {
  const profile = GROUND_KICK_PROFILES[kind];
  return normalized >= profile.contactStartFraction && normalized <= profile.contactEndFraction;
};

export const groundKickContactAccepted = (
  normalized: number,
  kind: GroundKickKind,
  footPathDistance: number,
  targetDistance: number,
): boolean => {
  const profile = GROUND_KICK_PROFILES[kind];
  if (![normalized, footPathDistance, targetDistance].every(Number.isFinite) || footPathDistance < 0 || targetDistance < 0) return false;
  if (!groundKickContactWindowOpen(normalized, kind)) return false;
  return targetDistance <= profile.maxTargetDistance + 0.18
    && footPathDistance <= profile.contactRadius;
};

export const npcGroundRecoveryReady = (
  alive: boolean,
  ragdollReady: boolean,
  downSeconds: number,
  kickCooldownSeconds: number,
  groundKickActive: boolean,
): boolean => alive
  && ragdollReady
  && downSeconds >= 2.10
  && kickCooldownSeconds <= 0
  && !groundKickActive;
