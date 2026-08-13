import * as THREE from 'three';

const normalizedTrackBone = (trackName: string): string => {
  const dot = trackName.lastIndexOf('.');
  const bone = dot >= 0 ? trackName.slice(0, dot) : trackName;
  return bone.toLowerCase().replace(/[^a-z0-9]/g, '');
};

const isHips = (name: string): boolean => name.endsWith('hips');
const isLowerBody = (name: string): boolean =>
  name.endsWith('leftupleg')
  || name.endsWith('leftleg')
  || name.endsWith('leftfoot')
  || name.endsWith('lefttoebase')
  || name.endsWith('rightupleg')
  || name.endsWith('rightleg')
  || name.endsWith('rightfoot')
  || name.endsWith('righttoebase');

/**
 * Strike overlays include the upper torso plus the arm chain, but never Hips or
 * lower body. The torso contribution is converted to a bounded additive delta,
 * so punches can carry through the chest/shoulders without importing the large
 * absolute turns/leans that used to snap the whole avatar sideways.
 */
const isStrikeTorsoBone = (name: string): boolean =>
  name.endsWith('spine') || name.endsWith('spine1') || name.endsWith('spine2');

const isStrikeArmBone = (name: string): boolean => {
  const sided = name.includes('left') || name.includes('right');
  if (!sided) return false;
  return name.endsWith('shoulder')
    || name.endsWith('arm')
    || name.endsWith('forearm')
    || name.endsWith('hand')
    || name.includes('thumb')
    || name.includes('index')
    || name.includes('middle')
    || name.includes('ring')
    || name.includes('pinky');
};

const isStrikeAnimatedBone = (name: string): boolean =>
  isStrikeTorsoBone(name) || isStrikeArmBone(name);

const firstQuaternionForNormalizedBone = (
  clip: THREE.AnimationClip,
  normalizedBone: string,
): THREE.Quaternion | null => {
  const track = clip.tracks.find((candidate) =>
    candidate instanceof THREE.QuaternionKeyframeTrack
    && candidate.name.endsWith('.quaternion')
    && normalizedTrackBone(candidate.name) === normalizedBone
  ) as THREE.QuaternionKeyframeTrack | undefined;
  if (!track || track.values.length < 4) return null;
  return new THREE.Quaternion(
    track.values[0]!, track.values[1]!, track.values[2]!, track.values[3]!,
  ).normalize();
};

export const firstQuaternionForBone = (
  clip: THREE.AnimationClip,
  suffix: string,
): THREE.Quaternion | null => {
  const normalizedSuffix = suffix.toLowerCase().replace(/[^a-z0-9]/g, '');
  const track = clip.tracks.find((candidate) =>
    candidate instanceof THREE.QuaternionKeyframeTrack
    && candidate.name.endsWith('.quaternion')
    && normalizedTrackBone(candidate.name).endsWith(normalizedSuffix)
  ) as THREE.QuaternionKeyframeTrack | undefined;
  if (!track || track.values.length < 4) return null;
  return new THREE.Quaternion(
    track.values[0]!, track.values[1]!, track.values[2]!, track.values[3]!,
  ).normalize();
};

export const createCombatUpperClip = (
  source: THREE.AnimationClip,
  name: string,
): THREE.AnimationClip => new THREE.AnimationClip(
  name,
  source.duration,
  source.tracks
    .filter((track) => {
      const bone = normalizedTrackBone(track.name);
      return !isHips(bone) && !isLowerBody(bone);
    })
    .map((track) => track.clone()),
);

export const createCombatLowerClip = (
  source: THREE.AnimationClip,
  name: string,
): THREE.AnimationClip => new THREE.AnimationClip(
  name,
  source.duration,
  source.tracks
    .filter((track) => {
      const bone = normalizedTrackBone(track.name);
      return isHips(bone) || isLowerBody(bone);
    })
    .map((track) => track.clone()),
);


interface DirectionalBlendClipOptions {
  readonly lowerBodyLateralWeight: number;
  readonly upperBodyLateralWeight: number;
  readonly sampleCount?: number;
}

const sampleNumericTrack = (
  track: THREE.KeyframeTrack,
  normalizedTime: number,
  target: number[],
): void => {
  const valueSize = track.getValueSize();
  const times = track.times;
  const values = track.values;
  if (times.length === 0 || values.length < valueSize) {
    for (let i = 0; i < valueSize; i += 1) target[i] = i === valueSize - 1 && valueSize === 4 ? 1 : 0;
    return;
  }
  if (times.length === 1) {
    for (let i = 0; i < valueSize; i += 1) target[i] = values[i] ?? 0;
    return;
  }
  const lastIndex = times.length - 1;
  const clipTime = THREE.MathUtils.clamp(normalizedTime, 0, 1) * Math.max(1e-6, times[lastIndex]!);
  let upper = 1;
  while (upper < times.length && times[upper]! < clipTime) upper += 1;
  upper = Math.min(lastIndex, upper);
  const lower = Math.max(0, upper - 1);
  const t0 = times[lower]!;
  const t1 = times[upper]!;
  const alpha = t1 > t0 ? THREE.MathUtils.clamp((clipTime - t0) / (t1 - t0), 0, 1) : 0;

  if (track instanceof THREE.QuaternionKeyframeTrack && valueSize === 4) {
    const qa = new THREE.Quaternion(
      values[lower * 4]!, values[lower * 4 + 1]!, values[lower * 4 + 2]!, values[lower * 4 + 3]!,
    ).normalize();
    const qb = new THREE.Quaternion(
      values[upper * 4]!, values[upper * 4 + 1]!, values[upper * 4 + 2]!, values[upper * 4 + 3]!,
    ).normalize();
    qa.slerp(qb, alpha).normalize();
    target[0] = qa.x; target[1] = qa.y; target[2] = qa.z; target[3] = qa.w;
    return;
  }

  for (let i = 0; i < valueSize; i += 1) {
    const a = values[lower * valueSize + i] ?? 0;
    const b = values[upper * valueSize + i] ?? a;
    target[i] = THREE.MathUtils.lerp(a, b, alpha);
  }
};

const createBlendedTrack = (
  forwardTrack: THREE.KeyframeTrack,
  lateralTrack: THREE.KeyframeTrack | undefined,
  times: Float32Array,
  lateralWeight: number,
): THREE.KeyframeTrack => {
  const valueSize = forwardTrack.getValueSize();
  const values = new Float32Array(times.length * valueSize);
  const forwardSample = new Array<number>(valueSize).fill(0);
  const lateralSample = new Array<number>(valueSize).fill(0);
  const quaternion = forwardTrack instanceof THREE.QuaternionKeyframeTrack && valueSize === 4;

  for (let frame = 0; frame < times.length; frame += 1) {
    const phase = times.length <= 1 ? 0 : frame / (times.length - 1);
    sampleNumericTrack(forwardTrack, phase, forwardSample);
    if (lateralTrack && lateralTrack.constructor === forwardTrack.constructor && lateralTrack.getValueSize() === valueSize) {
      sampleNumericTrack(lateralTrack, phase, lateralSample);
    } else {
      for (let i = 0; i < valueSize; i += 1) lateralSample[i] = forwardSample[i]!;
    }

    if (quaternion) {
      const q = new THREE.Quaternion(
        forwardSample[0]!, forwardSample[1]!, forwardSample[2]!, forwardSample[3]!,
      ).normalize();
      const l = new THREE.Quaternion(
        lateralSample[0]!, lateralSample[1]!, lateralSample[2]!, lateralSample[3]!,
      ).normalize();
      q.slerp(l, lateralWeight).normalize();
      q.toArray(values, frame * 4);
    } else {
      for (let i = 0; i < valueSize; i += 1) {
        values[frame * valueSize + i] = THREE.MathUtils.lerp(
          forwardSample[i]!, lateralSample[i]!, lateralWeight,
        );
      }
    }
  }

  if (forwardTrack instanceof THREE.QuaternionKeyframeTrack) {
    return new THREE.QuaternionKeyframeTrack(forwardTrack.name, times, values);
  }
  if (forwardTrack instanceof THREE.VectorKeyframeTrack) {
    return new THREE.VectorKeyframeTrack(forwardTrack.name, times, values);
  }
  if (forwardTrack instanceof THREE.NumberKeyframeTrack) {
    return new THREE.NumberKeyframeTrack(forwardTrack.name, times, values);
  }
  return forwardTrack.clone();
};

/**
 * Builds a real reusable diagonal locomotion clip from two already-retargeted
 * in-place clips. Lower-body bones receive more of the strafe source while the
 * torso stays biased toward the forward walk/run, avoiding the old binary
 * "crab sideways OR straight ahead" look.
 */
export const createDirectionalLocomotionBlendClip = (
  forward: THREE.AnimationClip,
  lateral: THREE.AnimationClip,
  name: string,
  options: DirectionalBlendClipOptions,
): THREE.AnimationClip => {
  const sampleCount = Math.max(17, Math.min(81, Math.round(options.sampleCount ?? 49)));
  const duration = Math.max(1e-4, forward.duration);
  const times = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) times[i] = duration * i / (sampleCount - 1);
  const lateralTracks = new Map(lateral.tracks.map((track) => [track.name, track] as const));
  const tracks = forward.tracks.map((track) => {
    const bone = normalizedTrackBone(track.name);
    const lower = isHips(bone) || isLowerBody(bone);
    const weight = THREE.MathUtils.clamp(
      lower ? options.lowerBodyLateralWeight : options.upperBodyLateralWeight,
      0,
      1,
    );
    return createBlendedTrack(track, lateralTracks.get(track.name), times, weight);
  });
  const clip = new THREE.AnimationClip(name, duration, tracks);
  clip.optimize();
  return clip;
};

export type CombatStrikeCharacter = 'jab' | 'cross' | 'long' | 'compact' | 'body' | 'overhand' | 'step' | 'shove' | 'power' | 'hook' | 'counter';
export type CombatStrikeSide = 'left' | 'right';

export interface CombatStrikeClipOptions {
  readonly heavy?: boolean;
  readonly character?: CombatStrikeCharacter;
  readonly strikingSide?: CombatStrikeSide;
  readonly impactFraction?: number;
  readonly sourcePeakPhase?: number;
  /** Mirror the additive motion across the avatar sagittal plane and swap L/R tracks. */
  readonly mirror?: boolean;
}


const mirrorCombatTrackName = (trackName: string): string => {
  // Mixamo/retargeted tracks consistently carry Left/Right in the bone name.
  // Use sentinels so a single pass cannot turn both sides into the same name.
  return trackName
    .replace(/Left/g, '__COMBAT_LEFT__')
    .replace(/Right/g, 'Left')
    .replace(/__COMBAT_LEFT__/g, 'Right')
    .replace(/left/g, '__combat_left__')
    .replace(/right/g, 'left')
    .replace(/__combat_left__/g, 'right');
};

/**
 * Mirror an additive rotation through the character sagittal (YZ) plane.
 * Quaternion vector parts transform like an axial vector under reflection:
 * X stays, Y/Z flip. Because strike clips are deltas around identity this is
 * stable and does not depend on the bind-pose orientation of the source FBX.
 */
const mirrorCombatDelta = (rotation: THREE.Quaternion): THREE.Quaternion => {
  rotation.y = -rotation.y;
  rotation.z = -rotation.z;
  return rotation.normalize();
};

export interface CombatStrikeSourceAnalysis {
  readonly strikingSide: CombatStrikeSide;
  readonly sourcePeakPhase: number;
  readonly leftMotion: number;
  readonly rightMotion: number;
}

const strikeBoneSide = (normalizedBone: string): CombatStrikeSide | null => {
  if (normalizedBone.includes('left')) return 'left';
  if (normalizedBone.includes('right')) return 'right';
  return null;
};

const strikeMotionWeight = (normalizedBone: string): number => {
  if (normalizedBone.endsWith('arm') && !normalizedBone.endsWith('forearm')) return 1.0;
  if (normalizedBone.endsWith('forearm')) return 0.82;
  if (normalizedBone.endsWith('shoulder')) return 0.46;
  if (normalizedBone.endsWith('hand')) return 0.22;
  return 0;
};

/**
 * Inspect the authored punch reference once and lock its actual striking arm.
 * We also detect the phase where that arm has the largest combined shoulder /
 * upper-arm / forearm excursion. Generated combat clips then time-warp this
 * source peak onto their authored impact phase instead of assuming every FBX
 * reaches extension at the same time.
 */
export const analyzeCombatStrikeSource = (source: THREE.AnimationClip): CombatStrikeSourceAnalysis => {
  const tracks = source.tracks.filter((track): track is THREE.QuaternionKeyframeTrack => {
    if (!(track instanceof THREE.QuaternionKeyframeTrack)) return false;
    const bone = normalizedTrackBone(track.name);
    return strikeMotionWeight(bone) > 0 && strikeBoneSide(bone) !== null;
  });
  if (tracks.length === 0) {
    return { strikingSide: 'right', sourcePeakPhase: 0.5, leftMotion: 0, rightMotion: 0 };
  }

  const origins = new Map<THREE.QuaternionKeyframeTrack, THREE.Quaternion>();
  const values = [0, 0, 0, 1];
  for (const track of tracks) {
    sampleNumericTrack(track, 0, values);
    origins.set(track, new THREE.Quaternion(values[0]!, values[1]!, values[2]!, values[3]!).normalize());
  }

  let bestLeft = 0;
  let bestRight = 0;
  let bestLeftPhase = 0.5;
  let bestRightPhase = 0.5;
  const sample = new THREE.Quaternion();
  const sampleCount = 49;
  for (let index = 1; index < sampleCount; index += 1) {
    const phase = index / (sampleCount - 1);
    let left = 0;
    let right = 0;
    for (const track of tracks) {
      const bone = normalizedTrackBone(track.name);
      const side = strikeBoneSide(bone);
      if (!side) continue;
      sampleNumericTrack(track, phase, values);
      sample.set(values[0]!, values[1]!, values[2]!, values[3]!).normalize();
      const origin = origins.get(track)!;
      const motion = origin.angleTo(sample) * strikeMotionWeight(bone);
      if (side === 'left') left += motion;
      else right += motion;
    }
    if (left > bestLeft) { bestLeft = left; bestLeftPhase = phase; }
    if (right > bestRight) { bestRight = right; bestRightPhase = phase; }
  }

  const strikingSide: CombatStrikeSide = bestLeft > bestRight ? 'left' : 'right';
  const rawPeak = strikingSide === 'left' ? bestLeftPhase : bestRightPhase;
  return {
    strikingSide,
    sourcePeakPhase: THREE.MathUtils.clamp(rawPeak, 0.28, 0.76),
    leftMotion: bestLeft,
    rightMotion: bestRight,
  };
};

interface StrikeBoneStability {
  readonly gain: number;
  readonly maxRadians: number;
}

interface StrikeCharacterTuning {
  readonly motionGain: number;
  readonly torsoGain: number;
  readonly shoulderGain: number;
  readonly upperArmGain: number;
  readonly distalGain: number;
  readonly phaseExponent: number;
  readonly sampleCount: number;
}

const strikeCharacterTuning = (character: CombatStrikeCharacter): StrikeCharacterTuning => {
  switch (character) {
    case 'jab':
      return {
        motionGain: 0.88,
        torsoGain: 0.76,
        shoulderGain: 0.90,
        upperArmGain: 0.96,
        distalGain: 0.80,
        phaseExponent: 0.78,
        sampleCount: 25,
      };
    case 'cross':
      return {
        motionGain: 1.00,
        torsoGain: 1.10,
        shoulderGain: 1.02,
        upperArmGain: 1.02,
        distalGain: 0.82,
        phaseExponent: 0.92,
        sampleCount: 29,
      };
    case 'long':
      return {
        motionGain: 0.96,
        torsoGain: 1.02,
        shoulderGain: 1.04,
        upperArmGain: 1.10,
        distalGain: 0.84,
        phaseExponent: 0.84,
        sampleCount: 27,
      };
    case 'compact':
      return {
        motionGain: 0.82,
        torsoGain: 0.88,
        shoulderGain: 0.88,
        upperArmGain: 0.90,
        distalGain: 0.80,
        phaseExponent: 0.72,
        sampleCount: 23,
      };
    case 'body':
      return {
        motionGain: 0.96,
        torsoGain: 1.12,
        shoulderGain: 1.04,
        upperArmGain: 1.08,
        distalGain: 0.82,
        phaseExponent: 0.84,
        sampleCount: 31,
      };
    case 'overhand':
      return {
        motionGain: 1.04,
        torsoGain: 1.20,
        shoulderGain: 1.12,
        upperArmGain: 1.16,
        distalGain: 0.84,
        phaseExponent: 0.96,
        sampleCount: 33,
      };
    case 'step':
      return {
        motionGain: 1.02,
        torsoGain: 1.16,
        shoulderGain: 1.08,
        upperArmGain: 1.14,
        distalGain: 0.86,
        phaseExponent: 0.88,
        sampleCount: 31,
      };
    case 'shove':
      return {
        motionGain: 0.72,
        torsoGain: 1.18,
        shoulderGain: 0.78,
        upperArmGain: 0.74,
        distalGain: 0.62,
        phaseExponent: 0.66,
        sampleCount: 25,
      };
    case 'power':
      return {
        motionGain: 1.06,
        torsoGain: 1.20,
        shoulderGain: 1.05,
        upperArmGain: 1.08,
        distalGain: 0.82,
        phaseExponent: 0.98,
        sampleCount: 31,
      };
    case 'hook':
      return {
        motionGain: 0.94,
        torsoGain: 1.18,
        shoulderGain: 1.02,
        upperArmGain: 1.00,
        distalGain: 0.76,
        phaseExponent: 0.90,
        sampleCount: 31,
      };
    case 'counter':
      return {
        motionGain: 1.00,
        torsoGain: 1.22,
        shoulderGain: 1.05,
        upperArmGain: 1.04,
        distalGain: 0.78,
        phaseExponent: 0.92,
        sampleCount: 33,
      };
  }
};

/**
 * The source FBXs are now treated as motion references, not poses that are
 * replayed verbatim. Each combat variant re-samples one of several clean punch
 * references into a uniformly-timed additive clip, then redistributes the motion:
 * torso/shoulder/upper-arm carry the strike while forearm/wrist/fingers are kept
 * deliberately quiet. This is what prevents the close-camera rubber-hose look.
 */
const strikeBoneStability = (
  normalizedBone: string,
  heavy: boolean,
  tuning: StrikeCharacterTuning,
  strikingSide: CombatStrikeSide,
): StrikeBoneStability => {
  const side = strikeBoneSide(normalizedBone);
  const guardArm = side !== null && side !== strikingSide;
  const heavyBoost = heavy ? 1.04 : 1;
  if (normalizedBone.endsWith('spine')) {
    return {
      gain: 0.10 * tuning.torsoGain * tuning.motionGain * heavyBoost,
      maxRadians: THREE.MathUtils.degToRad(4.5),
    };
  }
  if (normalizedBone.endsWith('spine1')) {
    return {
      gain: 0.15 * tuning.torsoGain * tuning.motionGain * heavyBoost,
      maxRadians: THREE.MathUtils.degToRad(6.5),
    };
  }
  if (normalizedBone.endsWith('spine2')) {
    return {
      gain: 0.20 * tuning.torsoGain * tuning.motionGain * heavyBoost,
      maxRadians: THREE.MathUtils.degToRad(8.5),
    };
  }
  if (normalizedBone.endsWith('shoulder')) {
    return {
      gain: (guardArm ? 0.12 : 0.84) * tuning.shoulderGain * tuning.motionGain * heavyBoost,
      maxRadians: THREE.MathUtils.degToRad(guardArm ? 10 : 48),
    };
  }
  if (normalizedBone.endsWith('arm') && !normalizedBone.endsWith('forearm')) {
    return {
      gain: (guardArm ? 0.09 : 1.06) * tuning.upperArmGain * tuning.motionGain * heavyBoost,
      maxRadians: THREE.MathUtils.degToRad(guardArm ? 13 : 108),
    };
  }
  if (normalizedBone.endsWith('forearm')) {
    return {
      gain: (guardArm ? 0.06 : 0.78) * tuning.distalGain * tuning.motionGain,
      maxRadians: THREE.MathUtils.degToRad(guardArm ? 9 : 62),
    };
  }
  if (normalizedBone.endsWith('hand')) {
    return {
      gain: (guardArm ? 0.02 : 0.065) * tuning.distalGain * tuning.motionGain,
      maxRadians: THREE.MathUtils.degToRad(guardArm ? 3 : 8),
    };
  }
  if (
    normalizedBone.includes('thumb') || normalizedBone.includes('index')
    || normalizedBone.includes('middle') || normalizedBone.includes('ring')
    || normalizedBone.includes('pinky')
  ) {
    return { gain: 0.035, maxRadians: THREE.MathUtils.degToRad(5) };
  }
  return {
    gain: 0.52 * tuning.motionGain,
    maxRadians: THREE.MathUtils.degToRad(48),
  };
};

const strikeBoneTemporalSmoothing = (normalizedBone: string): number => {
  // Preserve a crisp acceleration into contact. Excess temporal averaging made
  // the hand visibly arrive after the body and was read as delayed damage.
  if (normalizedBone.endsWith('hand')) return 0.34;
  if (normalizedBone.endsWith('forearm')) return 0.24;
  if (normalizedBone.endsWith('shoulder')) return 0.17;
  if (normalizedBone.endsWith('arm')) return 0.12;
  if (isStrikeTorsoBone(normalizedBone)) return 0.10;
  return 0.10;
};

const smooth01 = (value: number): number => {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/**
 * Strike pose envelope. It gets to full contribution quickly, but starts
 * releasing earlier than the old FBX pass so chained punches never feel as if
 * the previous arm is still hanging in space.
 */
export const combatStrikeEnvelope = (
  normalizedTime: number,
  heavy = false,
  impactFraction = heavy ? 0.50 : 0.46,
): number => {
  const t = THREE.MathUtils.clamp(normalizedTime, 0, 1);
  const impact = THREE.MathUtils.clamp(impactFraction, 0.32, 0.64);
  const attackEnd = Math.max(0.08, impact - (heavy ? 0.22 : 0.20));
  // Keep the full-body strike alive through contact, then give the arm enough
  // time to visibly recoil instead of snapping back after a tiny jab.
  const releaseStart = Math.min(0.82, impact + (heavy ? 0.135 : 0.120));
  const releaseEnd = Math.min(0.97, impact + (heavy ? 0.340 : 0.320));
  if (t <= attackEnd) return smooth01(t / Math.max(1e-5, attackEnd));
  if (t <= releaseStart) return 1;
  if (t >= releaseEnd) return 0;
  return 1 - smooth01((t - releaseStart) / Math.max(1e-5, releaseEnd - releaseStart));
};

/**
 * Forward commitment is tied to the authored impact phase. The fist reaches its
 * clearest extension just before/through impact, holds for only a few frames,
 * then recoils. This is shared by visuals, aiming, first-person framing and hit
 * detection so damage can never intentionally lag behind the visible strike.
 */
export const combatStrikeReachEnvelope = (
  normalizedTime: number,
  heavy = false,
  impactFraction = heavy ? 0.50 : 0.46,
): number => {
  const t = THREE.MathUtils.clamp(normalizedTime, 0, 1);
  const impact = THREE.MathUtils.clamp(impactFraction, 0.32, 0.64);
  const start = Math.max(0.02, impact - (heavy ? 0.315 : 0.285));
  const peakStart = impact;
  const peakEnd = impact;
  const end = Math.min(0.96, impact + (heavy ? 0.310 : 0.285));
  if (t <= start || t >= end) return 0;
  if (t < peakStart) return smooth01((t - start) / Math.max(1e-5, peakStart - start));
  if (t <= peakEnd) return 1;
  return 1 - smooth01((t - peakEnd) / Math.max(1e-5, end - peakEnd));
};

const warpStrikeSourcePhase = (
  normalizedTime: number,
  impactFraction: number,
  sourcePeakPhase: number,
  exponent: number,
): number => {
  const t = THREE.MathUtils.clamp(normalizedTime, 0, 1);
  const impact = THREE.MathUtils.clamp(impactFraction, 0.32, 0.64);
  const sourcePeak = THREE.MathUtils.clamp(sourcePeakPhase, 0.24, 0.80);
  if (t <= impact) {
    const local = Math.pow(t / Math.max(1e-5, impact), exponent);
    return sourcePeak * local;
  }
  const local = Math.pow((t - impact) / Math.max(1e-5, 1 - impact), Math.max(0.72, 2 - exponent));
  return sourcePeak + (1 - sourcePeak) * local;
};

/**
 * Builds one of the revised strike variants from a clean straight-punch source.
 *
 * The authored file supplies only the broad anatomical direction. We resample it
 * to a fixed number of keys, time-warp it per variant, convert every rotation to
 * an additive delta from the first frame, cap each joint, and smooth the distal
 * chain. Big-punch FBXs are deliberately not involved anywhere in this path.
 */
export const createCombatStrikeUpperClip = (
  source: THREE.AnimationClip,
  _fightReference: THREE.AnimationClip,
  name: string,
  options: CombatStrikeClipOptions = {},
): THREE.AnimationClip => {
  const heavy = options.heavy === true;
  const character = options.character ?? (heavy ? 'power' : 'cross');
  const analysis = analyzeCombatStrikeSource(source);
  const mirror = options.mirror === true;
  const analyzedSide: CombatStrikeSide = mirror
    ? analysis.strikingSide === 'left' ? 'right' : 'left'
    : analysis.strikingSide;
  const strikingSide = options.strikingSide ?? analyzedSide;
  const impactFraction = THREE.MathUtils.clamp(options.impactFraction ?? (heavy ? 0.50 : 0.46), 0.32, 0.64);
  const sourcePeakPhase = THREE.MathUtils.clamp(options.sourcePeakPhase ?? analysis.sourcePeakPhase, 0.24, 0.80);
  const tuning = strikeCharacterTuning(character);
  const duration = Math.max(1e-5, source.duration);
  const identity = new THREE.Quaternion();
  const origin = new THREE.Quaternion();
  const inverseOrigin = new THREE.Quaternion();
  const sample = new THREE.Quaternion();
  const delta = new THREE.Quaternion();
  const enveloped = new THREE.Quaternion();
  const sampleValues = [0, 0, 0, 1];
  const originValues = [0, 0, 0, 1];
  const tracks: THREE.KeyframeTrack[] = [];

  for (const sourceTrack of source.tracks) {
    const sourceBone = normalizedTrackBone(sourceTrack.name);
    if (!isStrikeAnimatedBone(sourceBone)) continue;
    const outputTrackName = mirror ? mirrorCombatTrackName(sourceTrack.name) : sourceTrack.name;
    const bone = normalizedTrackBone(outputTrackName);
    if (!(sourceTrack instanceof THREE.QuaternionKeyframeTrack)) continue;
    if (sourceTrack.values.length < 4 || sourceTrack.times.length === 0) continue;

    sampleNumericTrack(sourceTrack, 0, originValues);
    origin.set(originValues[0]!, originValues[1]!, originValues[2]!, originValues[3]!).normalize();
    inverseOrigin.copy(origin).invert();

    const keyCount = tuning.sampleCount;
    const times = new Float32Array(keyCount);
    const values = new Float32Array(keyCount * 4);
    const stability = strikeBoneStability(bone, heavy, tuning, strikingSide);

    for (let key = 0; key < keyCount; key += 1) {
      const normalizedTime = key / Math.max(1, keyCount - 1);
      times[key] = duration * normalizedTime;
      const sourcePhase = warpStrikeSourcePhase(
        normalizedTime, impactFraction, sourcePeakPhase, tuning.phaseExponent,
      );
      sampleNumericTrack(sourceTrack, sourcePhase, sampleValues);
      sample.set(sampleValues[0]!, sampleValues[1]!, sampleValues[2]!, sampleValues[3]!).normalize();
      delta.copy(inverseOrigin).multiply(sample).normalize();
      if (mirror) mirrorCombatDelta(delta);

      const envelope = combatStrikeEnvelope(normalizedTime, heavy, impactFraction);
      enveloped
        .copy(identity)
        .slerp(delta, THREE.MathUtils.clamp(envelope * stability.gain, 0, 1))
        .normalize();

      const angularDelta = identity.angleTo(enveloped);
      if (angularDelta > stability.maxRadians) {
        enveloped
          .copy(identity)
          .slerp(enveloped, stability.maxRadians / Math.max(1e-5, angularDelta))
          .normalize();
      }

      enveloped.toArray(values, key * 4);
    }

    const temporalSmoothing = strikeBoneTemporalSmoothing(bone);
    if (keyCount >= 3 && temporalSmoothing > 0) {
      const originalValues = values.slice();
      const previous = new THREE.Quaternion();
      const current = new THREE.Quaternion();
      const next = new THREE.Quaternion();
      const neighborMidpoint = new THREE.Quaternion();
      for (let key = 1; key < keyCount - 1; key += 1) {
        const offset = key * 4;
        previous.set(
          originalValues[offset - 4]!, originalValues[offset - 3]!,
          originalValues[offset - 2]!, originalValues[offset - 1]!,
        ).normalize();
        current.set(
          originalValues[offset]!, originalValues[offset + 1]!,
          originalValues[offset + 2]!, originalValues[offset + 3]!,
        ).normalize();
        next.set(
          originalValues[offset + 4]!, originalValues[offset + 5]!,
          originalValues[offset + 6]!, originalValues[offset + 7]!,
        ).normalize();
        neighborMidpoint.copy(previous).slerp(next, 0.5).normalize();
        current.slerp(neighborMidpoint, temporalSmoothing).normalize();
        current.toArray(values, offset);
      }
    }

    // Exact identity endpoints are essential for instant chaining: fading or
    // replacing a strike can never leave residual twist in the wrist or chest.
    for (const offset of [0, values.length - 4]) {
      values[offset] = 0;
      values[offset + 1] = 0;
      values[offset + 2] = 0;
      values[offset + 3] = 1;
    }

    tracks.push(new THREE.QuaternionKeyframeTrack(outputTrackName, times, values));
  }

  return new THREE.AnimationClip(
    name,
    duration,
    tracks,
    THREE.AdditiveAnimationBlendMode,
  );
};



const isCombatDodgeBone = (name: string): boolean =>
  isHips(name)
  || isLowerBody(name)
  || isStrikeTorsoBone(name);

const combatDodgePoseEnvelope = (normalizedTime: number, boneName = ''): number => {
  const t = THREE.MathUtils.clamp(normalizedTime, 0, 1);
  // A believable evade does not move every joint on the same curve. Legs load
  // first and stay planted longest, hips follow, then the chest slips later and
  // begins unwinding early enough to feed the counter hook.
  const bone = boneName;
  const lower = isLowerBody(bone);
  const hips = isHips(bone);
  const enterEnd = lower ? 0.16 : hips ? 0.19 : 0.23;
  const holdEnd = lower ? 0.66 : hips ? 0.58 : 0.50;
  const releaseEnd = lower ? 0.98 : hips ? 0.91 : 0.82;
  if (t <= enterEnd) return smooth01(t / Math.max(1e-5, enterEnd));
  if (t <= holdEnd) return 1;
  return 1 - smooth01((t - holdEnd) / Math.max(1e-5, releaseEnd - holdEnd));
};

/**
 * Builds a short additive duck/evade from the supplied crouch idle. Arms are
 * intentionally excluded so Fight Idle keeps the fists protecting the face;
 * only pelvis, legs and torso lower/coil, then rise into the counter strike.
 */
export const createCombatDodgeClip = (
  crouch: THREE.AnimationClip,
  fight: THREE.AnimationClip,
  name: string,
  includeHipsTranslation = true,
): THREE.AnimationClip => {
  const referenceTracks = new Map(fight.tracks.map((track) => [track.name, track] as const));
  const sampleCount = 19;
  const times = new Float32Array(sampleCount);
  const tracks: THREE.KeyframeTrack[] = [];
  const crouchSample: number[] = [];
  const fightSample: number[] = [];
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  const inv = new THREE.Quaternion();
  const delta = new THREE.Quaternion();
  const identity = new THREE.Quaternion();
  const out = new THREE.Quaternion();

  for (let key = 0; key < sampleCount; key += 1) times[key] = key / (sampleCount - 1);

  for (const sourceTrack of crouch.tracks) {
    const bone = normalizedTrackBone(sourceTrack.name);
    if (!isCombatDodgeBone(bone)) continue;
    const reference = referenceTracks.get(sourceTrack.name);
    if (!reference || reference.constructor !== sourceTrack.constructor) continue;

    if (sourceTrack instanceof THREE.QuaternionKeyframeTrack && reference instanceof THREE.QuaternionKeyframeTrack) {
      const values = new Float32Array(sampleCount * 4);
      sampleNumericTrack(sourceTrack, 0.46, crouchSample);
      sampleNumericTrack(reference, 0.18, fightSample);
      qa.set(crouchSample[0]!, crouchSample[1]!, crouchSample[2]!, crouchSample[3]!).normalize();
      qb.set(fightSample[0]!, fightSample[1]!, fightSample[2]!, fightSample[3]!).normalize();
      inv.copy(qb).invert();
      delta.copy(inv).multiply(qa).normalize();
      const maxRadians = isLowerBody(bone)
        ? THREE.MathUtils.degToRad(46)
        : isHips(bone)
          ? THREE.MathUtils.degToRad(28)
          : THREE.MathUtils.degToRad(31);
      const angle = identity.angleTo(delta);
      if (angle > maxRadians) delta.copy(identity).slerp(delta, maxRadians / Math.max(1e-5, angle));

      for (let key = 0; key < sampleCount; key += 1) {
        const envelope = combatDodgePoseEnvelope(key / (sampleCount - 1), bone);
        out.copy(identity).slerp(delta, envelope).normalize().toArray(values, key * 4);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(sourceTrack.name, times, values));
      continue;
    }

    if (sourceTrack instanceof THREE.VectorKeyframeTrack && reference instanceof THREE.VectorKeyframeTrack && isHips(bone)) {
      // First person may lower the presentation pelvis because its dedicated
      // viewmodel is not the world body. Third person must never translate the
      // skeleton root down through the floor: the physical side/back step plus
      // leg/torso rotations create the dodge while the planted world root stays
      // at the character controller height.
      if (!includeHipsTranslation) continue;
      sampleNumericTrack(sourceTrack, 0.46, crouchSample);
      sampleNumericTrack(reference, 0.18, fightSample);
      const dx = THREE.MathUtils.clamp((crouchSample[0] ?? 0) - (fightSample[0] ?? 0), -0.08, 0.08);
      const rawDy = (crouchSample[1] ?? 0) - (fightSample[1] ?? 0);
      const dy = THREE.MathUtils.clamp(Math.min(rawDy * 1.02, -0.21), -0.36, -0.21);
      const dz = THREE.MathUtils.clamp((crouchSample[2] ?? 0) - (fightSample[2] ?? 0), -0.08, 0.08);
      const values = new Float32Array(sampleCount * 3);
      for (let key = 0; key < sampleCount; key += 1) {
        const envelope = combatDodgePoseEnvelope(key / (sampleCount - 1), bone);
        values[key * 3] = dx * envelope;
        values[key * 3 + 1] = dy * envelope;
        values[key * 3 + 2] = dz * envelope;
      }
      tracks.push(new THREE.VectorKeyframeTrack(sourceTrack.name, times, values));
    }
  }

  return new THREE.AnimationClip(name, 1, tracks, THREE.AdditiveAnimationBlendMode);
};

/**
 * Kept as a compatibility helper for callers that still want a standalone NPC
 * clip. The player/NPC runtime now layers the additive strike over a continuously
 * running Fight Idle instead, which is the fluid path used by the lab.
 */
export const createCombatNpcStrikeClip = (
  upperStrike: THREE.AnimationClip,
  _fightReference: THREE.AnimationClip,
  name: string,
): THREE.AnimationClip => new THREE.AnimationClip(
  name,
  upperStrike.duration,
  upperStrike.tracks.map((track) => track.clone()),
  THREE.AdditiveAnimationBlendMode,
);
