import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { limitKneeLateralBend, solveCombatTwoBone } from './CombatRig';

export const CROUCH_GAIT_REFERENCE_SPEED = 1.24;
export const CROUCH_LOCOMOTION_IDS = [
  'crouch-idle', 'crouch-walking', 'crouch-backward', 'crouch-strafe-left', 'crouch-strafe-right',
  'crouch-forward-left', 'crouch-forward-right', 'crouch-backward-left', 'crouch-backward-right',
] as const;
export type CrouchLocomotionId = typeof CROUCH_LOCOMOTION_IDS[number];

const suffix = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const bone = (rig: THREE.Object3D, name: string): THREE.Bone => {
  let found: THREE.Bone | undefined;
  rig.traverse(object => {
    if ((object as THREE.Bone).isBone && suffix(object.name).endsWith(suffix(name))) found = object as THREE.Bone;
  });
  if (!found) throw new Error(`Crouch retarget bone missing: ${name}`);
  return found;
};
const rotation = (pitch: number, yaw = 0, roll = 0): THREE.Quaternion =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
const setWorldRotation = (joint: THREE.Bone, q: THREE.Quaternion): void => {
  joint.quaternion.copy(joint.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q)).normalize();
  joint.updateWorldMatrix(false, true);
};
const averageRotation = (values: THREE.Quaternion[]): THREE.Quaternion => {
  const q = new THREE.Quaternion(0, 0, 0, 0), reference = values[0]!;
  for (const value of values) {
    const sign = reference.dot(value) < 0 ? -1 : 1;
    q.x += sign * value.x; q.y += sign * value.y; q.z += sign * value.z; q.w += sign * value.w;
  }
  return q.normalize();
};

interface Capture {
  hip: THREE.Vector3;
  body: THREE.Euler[];
  feet: THREE.Vector3[];
  pitch: number[];
  clearance: number[];
  arms: THREE.Quaternion[];
}

interface CrouchLocomotion {
  clips: Map<CrouchLocomotionId, THREE.AnimationClip>;
  referenceSpeeds: Map<CrouchLocomotionId, number>;
}

/** Retarget the supplied moving FBX poses, rather than animating a fixed squat.
 * The captured heel lift, knee recovery, pelvis rise and shoulder counterturn
 * remain in phase. IK adapts that motion to this rig and keeps soles aligned;
 * it does not invent a sine-wave gait or lock both knees at the same depth. */
export function createCrouchLocomotionClips(
  character: THREE.Object3D,
  ankleHeight: number,
  references: { forward: THREE.AnimationClip; left: THREE.AnimationClip; right: THREE.AnimationClip;
    walking: THREE.AnimationClip },
  headLocalForward: Readonly<THREE.Vector3>,
): CrouchLocomotion {
  const rig = clone(character);
  rig.updateMatrixWorld(true);
  const hips = bone(rig, 'hips');
  const torso = [hips, bone(rig, 'spine'), bone(rig, 'spine1'), bone(rig, 'spine2'), bone(rig, 'neck'), bone(rig, 'head')];
  const legs = [
    [bone(rig, 'leftupleg'), bone(rig, 'leftleg'), bone(rig, 'leftfoot'), bone(rig, 'lefttoe_end')],
    [bone(rig, 'rightupleg'), bone(rig, 'rightleg'), bone(rig, 'rightfoot'), bone(rig, 'righttoe_end')],
  ] as const;
  const joints: THREE.Bone[] = [];
  rig.traverse(object => { if ((object as THREE.Bone).isBone) joints.push(object as THREE.Bone); });
  const armJoints = joints.filter(joint => /shoulder|(?:left|right)(?:arm|forearm|hand)/i.test(joint.name));
  const gravityArms = armJoints.map(joint => /(?:left|right)(?:arm|forearm|hand)$/i.test(joint.name));
  const rest = joints.map(joint => ({ q: joint.quaternion.clone(), p: joint.position.clone() }));
  const restWorld = new Map(joints.map(joint => [joint, joint.getWorldQuaternion(new THREE.Quaternion())]));
  const restHip = hips.getWorldPosition(new THREE.Vector3());
  const floor = THREE.MathUtils.clamp(ankleHeight, 0.065, 0.11);
  const soleFrames = legs.map(leg => {
    const toe = leg[3].getWorldPosition(new THREE.Vector3()).sub(leg[2].getWorldPosition(new THREE.Vector3()));
    return rotation(0, -Math.atan2(toe.x, toe.z)).multiply(restWorld.get(leg[2])!);
  });
  const restToePitch = legs.map(leg => {
    const toe = leg[3].getWorldPosition(new THREE.Vector3()).sub(leg[2].getWorldPosition(new THREE.Vector3()));
    return Math.atan2(toe.y, Math.hypot(toe.x, toe.z));
  });
  const headFrame = restWorld.get(torso[5]!)!.clone();
  const gaze = new THREE.Vector3().copy(headLocalForward).applyQuaternion(headFrame);
  headFrame.premultiply(rotation(0, -Math.atan2(gaze.x, gaze.z))).normalize();
  const reset = (): void => joints.forEach((joint, i) => { joint.quaternion.copy(rest[i]!.q); joint.position.copy(rest[i]!.p); });
  const frames = 120;

  function capture(clip: THREE.AnimationClip): Capture[] {
    const samples = clip.tracks.map(track => ({ track,
      joint: joints.find(joint => `${joint.name}.${track.name.endsWith('.quaternion') ? 'quaternion' : 'position'}` === track.name),
      sample: track.name.endsWith('.quaternion') ? new THREE.QuaternionLinearInterpolant(track.times, track.values, 4)
        : new THREE.LinearInterpolant(track.times, track.values, track.getValueSize()),
    }));
    const poses: Capture[] = [];
    for (let i = 0; i < frames; i++) {
      reset();
      for (const { track, joint, sample } of samples) {
        if (!joint) continue;
        const value = sample.evaluate(clip.duration * i / frames);
        if (track.name.endsWith('.quaternion')) joint.quaternion.fromArray(value).normalize();
        else if (joint === hips) joint.position.fromArray(value);
      }
      rig.updateMatrixWorld(true);
      const feet = legs.map(leg => leg[2].getWorldPosition(new THREE.Vector3()));
      const toes = legs.map((leg, side) => leg[3].getWorldPosition(new THREE.Vector3()).sub(feet[side]!));
      poses.push({ hip: hips.getWorldPosition(new THREE.Vector3()), feet,
        body: torso.map(joint => new THREE.Euler().setFromQuaternion(joint.getWorldQuaternion(new THREE.Quaternion()), 'YXZ')),
        pitch: toes.map((toe, side) => restToePitch[side]! - Math.atan2(toe.y, Math.hypot(toe.x, toe.z))),
        clearance: feet.map((foot, side) => Math.min(foot.y - floor, foot.y + toes[side]!.y)),
        arms: armJoints.map((joint, j) => gravityArms[j] ? joint.getWorldQuaternion(new THREE.Quaternion()) : joint.quaternion.clone()),
      });
    }
    return poses;
  }

  const forward = capture(references.forward), left = capture(references.left), right = capture(references.right);
  const walk = capture(references.walking);
  // Both FBX strafe clips have their own timing. Align their actual raised-foot
  // landmark before combining them, so a diagonal never mixes opposite appuis.
  const landmark = (poses: Capture[]): number => poses.reduce((best, pose, i) =>
    pose.clearance[0]! - pose.clearance[1]! > poses[best]!.clearance[0]! - poses[best]!.clearance[1]! ? i : best, 0);
  const referencePhase = landmark(forward);
  const align = (poses: Capture[]): Capture[] => {
    const offset = landmark(poses) - referencePhase;
    return poses.map((_, i) => poses[(i + offset + frames) % frames]!);
  };
  const lateral = [align(left), align(right)], walking = align(walk);
  const captures = [forward, ...lateral];
  const meanHips = captures.map(poses => poses.reduce((sum, pose) => sum + pose.hip.y, 0) / frames);
  const meanBodies = captures.map(poses => torso.map((_, joint) => {
    const sine = new THREE.Vector3(), cosine = new THREE.Vector3();
    for (const pose of poses) {
      const e = pose.body[joint]!;
      sine.add(new THREE.Vector3(Math.sin(e.x), Math.sin(e.y), Math.sin(e.z)));
      cosine.add(new THREE.Vector3(Math.cos(e.x), Math.cos(e.y), Math.cos(e.z)));
    }
    return new THREE.Vector3(Math.atan2(sine.x, cosine.x), Math.atan2(sine.y, cosine.y), Math.atan2(sine.z, cosine.z));
  }));
  const meanArms = armJoints.map((_, joint) => averageRotation(walking.map(pose => pose.arms[joint]!)));
  const meanFeet = (poses: Capture[]): THREE.Vector3[] => legs.map((_, side) =>
    poses.reduce((sum, pose) => sum.add(pose.feet[side]!), new THREE.Vector3()).divideScalar(frames));
  const footCenters = [meanFeet(forward), ...lateral.map(meanFeet)];
  const floorOffsets = captures.map(poses => legs.map((_, side) =>
    [...poses.map(pose => pose.clearance[side]!)].sort((a, b) => a - b)[Math.floor(frames * 0.12)]!));
  const liftRanges = captures.map((poses, ref) => legs.map((_, side) =>
    Math.max(0.035, ...poses.map(pose => pose.clearance[side]! - floorOffsets[ref]![side]!))));
  const directions: Record<CrouchLocomotionId, readonly [number, number]> = {
    'crouch-idle': [0, 0], 'crouch-walking': [0, 1], 'crouch-backward': [0, -1],
    'crouch-strafe-left': [1, 0], 'crouch-strafe-right': [-1, 0],
    'crouch-forward-left': [0.54, 0.842],
    'crouch-forward-right': [-0.54, 0.842],
    'crouch-backward-left': [Math.SQRT1_2, -Math.SQRT1_2],
    'crouch-backward-right': [-Math.SQRT1_2, -Math.SQRT1_2],
  };
  const pelvisHeight = restHip.y * 0.852;
  const result = new Map<CrouchLocomotionId, THREE.AnimationClip>();
  const referenceSpeeds = new Map<CrouchLocomotionId, number>();
  for (const id of CROUCH_LOCOMOTION_IDS) {
    const idle = id === 'crouch-idle', [sideways, ahead] = directions[id];
    const sideIndex = sideways >= 0 ? 0 : 1;
    const sideWeight = Math.abs(sideways), frontWeight = Math.abs(ahead);
    const duration = idle ? 3.4 : THREE.MathUtils.lerp(0.92, 0.82, sideWeight);
    const times = Array.from({ length: frames + 1 }, (_, i) => duration * i / frames);
    const rotations = joints.map(() => [] as number[]), positions: number[] = [];
    const previous = joints.map(() => undefined as THREE.Quaternion | undefined);
    const supports: Array<Array<{ point: THREE.Vector3; flat: boolean }>> = [];
    let startFrame = 0, startCost = Infinity;
    for (let frame = 0; frame <= frames; frame++) {
      reset();
      const phase = frame % frames, pose = forward[phase]!, sidePose = lateral[sideIndex]![phase]!;
      const breath = idle ? Math.sin(frame / frames * Math.PI * 2) : 0;
      const footPaths = legs.map((_, side) => {
        if (idle) return { point: new THREE.Vector3((side === 0 ? 1 : -1) * 0.115, floor, restHip.z + 0.015), pitch: 0, lift: 0 };
        const sign = side === 0 ? 1 : -1;
        const f = pose.feet[side]!.clone().sub(footCenters[0]![side]!);
        const s = sidePose.feet[side]!.clone().sub(footCenters[sideIndex + 1]![side]!);
        const lift = THREE.MathUtils.lerp(Math.max(0, pose.clearance[side]! - floorOffsets[0]![side]!) / liftRanges[0]![side]! * 0.085,
          Math.max(0, sidePose.clearance[side]! - floorOffsets[sideIndex + 1]![side]!) / liftRanges[sideIndex + 1]![side]! * 0.075, sideWeight);
        const pitch = THREE.MathUtils.clamp(pose.pitch[side]! * ahead + sidePose.pitch[side]! * sideWeight * 0.35, -0.23, 0.42);
        return { point: new THREE.Vector3(sign * 0.105 + f.x * frontWeight * 0.24 + s.x * sideWeight * 0.56,
          floor + lift, restHip.z + f.z * ahead * 0.84
            + (s.z * 0.70 - sign * Math.sign(sideways) * 0.085) * sideWeight), pitch, lift };
      });
      // The recovering foot passes behind the supporting foot, including in a
      // diagonal. Preserve clearance instead of widening both knees or letting
      // the toes sweep through the other shoe.
      const separation = footPaths[0]!.point.clone().sub(footPaths[1]!.point); separation.y = 0;
      if (sideWeight > 0) {
        const sign = -Math.sign(sideways);
        const blend = 1 - THREE.MathUtils.smoothstep(Math.abs(separation.x), 0.15, 0.32);
        const clearance = sign * Math.max(0.18, separation.z * sign);
        const correction = (clearance - separation.z) * blend / 2;
        footPaths[0]!.point.z += correction; footPaths[1]!.point.z -= correction;
      }
      if (!idle && frame < frames) {
        const cost = footPaths.reduce((sum, path, side) => sum
          + (path.point.x - (side === 0 ? 0.115 : -0.115)) ** 2
          + (path.point.z - restHip.z - 0.015) ** 2 + path.lift ** 2 * 8 + path.pitch ** 2 * 0.02, 0)
          + Math.max(0, 0.16 - separation.x) ** 2 * 4;
        if (cost < startCost) { startCost = cost; startFrame = frame; }
      }
      const transfer = idle ? 0 : (footPaths[1]!.lift - footPaths[0]!.lift) * 0.24;
      const rise = THREE.MathUtils.lerp((pose.hip.y - meanHips[0]!) * 0.50,
        (sidePose.hip.y - meanHips[sideIndex + 1]!) * 1.05, sideWeight);
      const hip = new THREE.Vector3(transfer, pelvisHeight + (idle ? breath * 0.0015 : rise),
        restHip.z - 0.045 + (idle ? 0 : ahead * 0.014));
      hips.position.copy(hips.parent!.worldToLocal(hip));
      hips.updateWorldMatrix(false, true);
      torso.forEach((joint, i) => {
        const mean = meanBodies[0]![i]!, source = pose.body[i]!;
        const sideMean = meanBodies[sideIndex + 1]![i]!, sideSource = sidePose.body[i]!;
        const variation = (axis: 'x' | 'y' | 'z'): number => THREE.MathUtils.lerp(
          THREE.MathUtils.euclideanModulo(source[axis] - mean[axis] + Math.PI, Math.PI * 2) - Math.PI,
          THREE.MathUtils.euclideanModulo(sideSource[axis] - sideMean[axis] + Math.PI, Math.PI * 2) - Math.PI, sideWeight);
        const pitch = [0.22, 0.35, 0.54, 0.72, 0.40, 0.07][i]!
          + (idle ? breath * 0.002 : variation('x') * 0.65);
        const yaw = idle ? 0 : variation('y') * 0.85 + sideways * [0.16, 0.12, 0.08, 0.04, 0, 0][i]!;
        const roll = idle ? 0 : variation('z') * 0.55;
        setWorldRotation(joint, rotation(pitch, i === 5 ? 0 : yaw, roll)
          .multiply(i === 5 ? headFrame : restWorld.get(joint)!));
      });
      // Quiet, recorded arm swing. The shoulders oppose the hips and elbows
      // change flexion through the step, instead of keeping the hands frozen.
      armJoints.forEach((joint, i) => {
        const q = meanArms[i]!.clone().slerp(walking[phase]!.arms[i]!, idle ? 0 : 0.65 * frontWeight + 0.28 * sideWeight);
        if (gravityArms[i]) setWorldRotation(joint, q);
        else joint.quaternion.copy(q);
      });
      rig.updateMatrixWorld(true);
      for (const [side, leg] of legs.entries()) {
        const sign = side === 0 ? 1 : -1, path = footPaths[side]!;
        setWorldRotation(leg[2], rotation(path.pitch, sign * 0.04).multiply(soleFrames[side]!));
        // Pivot a planted sole around its contact. A lifted ankle is not proof
        // of an airborne foot: preserve authored toe-off and heel arrival.
        const toeOffset = leg[3].getWorldPosition(new THREE.Vector3()).sub(leg[2].getWorldPosition(new THREE.Vector3()));
        const heelOffset = new THREE.Vector3(0, -floor, -0.055).applyQuaternion(rotation(path.pitch));
        path.point.y += Math.max(0, -floor - Math.min(toeOffset.y, heelOffset.y));
        const pole = limitKneeLateralBend(leg[0], leg[1], leg[2], path.point,
          new THREE.Vector3(0, 0, 1), 0.997, 0.105);
        solveCombatTwoBone(leg[0], leg[1], leg[2], path.point, 1, pole, 0.997);
        setWorldRotation(leg[2], rotation(path.pitch, sign * 0.04).multiply(soleFrames[side]!));
      }
      if (frame < frames) supports.push(footPaths.map(path => ({ point: path.point.clone(),
        flat: path.lift < 0.007 && Math.abs(path.pitch) < 0.15 })));
      joints.forEach((joint, j) => {
        const q = joint.quaternion.clone().normalize();
        if (previous[j] && previous[j]!.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        rotations[j]!.push(q.x, q.y, q.z, q.w); previous[j] = q;
      });
      positions.push(hips.position.x, hips.position.y, hips.position.z);
    }
    const startOnSupport = (values: number[], size: number): number[] => Array.from({ length: frames + 1 }, (_, i) => {
      const offset = ((i + startFrame) % frames) * size;
      return values.slice(offset, offset + size);
    }).flat();
    const tracks: THREE.KeyframeTrack[] = joints.map((joint, i) =>
      new THREE.QuaternionKeyframeTrack(`${joint.name}.quaternion`, times, startOnSupport(rotations[i]!, 4)));
    tracks.push(new THREE.VectorKeyframeTrack(`${hips.name}.position`, times, startOnSupport(positions, 3)));
    result.set(id, new THREE.AnimationClip(`AnimationLab_${id}`, duration, tracks));
    // Retargeting shortens a lateral stride. Measure the backwards velocity of
    // its flat support foot instead of playing every direction at walk cadence.
    const direction = new THREE.Vector3(sideways, 0, ahead).normalize(), speeds: number[] = [];
    if (!idle) for (let i = 0; i < frames; i++) for (let side = 0; side < 2; side++) {
      const before = supports[(i + frames - 1) % frames]![side]!, next = supports[(i + 1) % frames]![side]!;
      if (!supports[i]![side]!.flat || !before.flat || !next.flat) continue;
      const speed = -next.point.clone().sub(before.point).dot(direction) * frames / (2 * duration);
      if (speed > 0.20 && speed < 2.4) speeds.push(speed);
    }
    speeds.sort((a, b) => a - b);
    referenceSpeeds.set(id, THREE.MathUtils.clamp(speeds[Math.floor(speeds.length / 2)]
      ?? CROUCH_GAIT_REFERENCE_SPEED, 0.72, 1.45));
  }
  return { clips: result, referenceSpeeds };
}
