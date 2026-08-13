export type GroundKickKind = 'stomp' | 'get-up-kick';

export interface GroundKickProfile {
  readonly duration: number;
  readonly impactFraction: number;
  readonly contactStartFraction: number;
  readonly contactEndFraction: number;
  readonly damage: number;
  readonly maxTargetDistance: number;
  readonly contactRadius: number;
}

export interface GroundKickPose {
  readonly chamber: number;
  readonly drive: number;
  readonly recover: number;
  readonly supportLoad: number;
}

const smooth01 = (value: number): number => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

export const GROUND_KICK_PROFILES: Readonly<Record<GroundKickKind, GroundKickProfile>> = {
  stomp: {
    duration: 0.84,
    impactFraction: 0.54,
    contactStartFraction: 0.32,
    contactEndFraction: 0.55,
    damage: 14,
    maxTargetDistance: 1.72,
    contactRadius: 0.29,
  },
  'get-up-kick': {
    duration: 0.78,
    impactFraction: 0.50,
    contactStartFraction: 0.32,
    contactEndFraction: 0.55,
    damage: 18,
    maxTargetDistance: 1.82,
    contactRadius: 0.29,
  },
};

export const groundKickPose = (normalized: number, kind: GroundKickKind): GroundKickPose => {
  const t = Math.max(0, Math.min(1, normalized));
  const chamberIn = smooth01((t - 0.05) / 0.23);
  const chamberOut = 1 - smooth01((t - 0.34) / 0.20);
  const chamber = chamberIn * chamberOut;
  const driveIn = smooth01((t - 0.27) / (kind === 'get-up-kick' ? 0.19 : 0.23));
  const driveOut = 1 - smooth01((t - (kind === 'get-up-kick' ? 0.58 : 0.62)) / 0.20);
  const drive = driveIn * driveOut;
  const recover = smooth01((t - 0.62) / 0.32);
  const supportLoad = smooth01((t - 0.02) / 0.18) * (1 - smooth01((t - 0.67) / 0.27));
  return { chamber, drive, recover, supportLoad };
};

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
