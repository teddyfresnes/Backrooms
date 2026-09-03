import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { solveCombatTwoBone } from './CombatRig';

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
const setWorldRotation = (joint: THREE.Bone, rotation: THREE.Quaternion): void => {
  joint.quaternion.copy(joint.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation)).normalize();
  joint.updateWorldMatrix(false, true);
};
const rotation = (pitch: number, yaw = 0, roll = 0): THREE.Quaternion =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));

interface Step { travel: number; lift: number; pitch: number; swing: number }
const SUPPORT_FRACTION = 0.62;

/** The support foot travels backwards at ground speed. Hermite swing has the
 * same velocity at both contacts, so neither touchdown nor the loop seam snaps.
 * Both feet overlap on the floor before weight transfers to the next support. */
function sampleStep(phase: number, halfTravel: number, clearance: number, forward: number): Step {
  if (phase < SUPPORT_FRACTION) return {
    travel: halfTravel * (1 - 2 * phase / SUPPORT_FRACTION), lift: 0, pitch: 0, swing: 0,
  };
  const t = (phase - SUPPORT_FRACTION) / (1 - SUPPORT_FRACTION);
  const t2 = t * t, t3 = t2 * t;
  const tangent = -2 * halfTravel * (1 - SUPPORT_FRACTION) / SUPPORT_FRACTION;
  const travel = (2 * t3 - 3 * t2 + 1) * -halfTravel + (t3 - 2 * t2 + t) * tangent
    + (-2 * t3 + 3 * t2) * halfTravel + (t3 - t2) * tangent;
  const arc = Math.sin(Math.PI * t);
  return { travel, lift: clearance * arc * arc,
    pitch: forward * 0.17 * arc * arc * Math.cos(Math.PI * t), swing: arc * arc };
}

/** New crouch motions built from the avatar's neutral anatomy, rather than
 * transplanting the pack's twisted squat/strafe poses. Each direction gets its
 * own supported foot path; backwards walking retains a forwards knee hinge.
 * Foot orientation comes from the neutral sole and toe geometry, independently
 * of pelvis/leg IK, including the symmetrical small natural toe-out. */
export function createCrouchLocomotionClips(
  character: THREE.Object3D,
  ankleHeight: number,
  upperReference: THREE.AnimationClip,
  headLocalForward: Readonly<THREE.Vector3>,
): Map<CrouchLocomotionId, THREE.AnimationClip> {
  const rig = clone(character);
  rig.updateMatrixWorld(true);
  const hips = bone(rig, 'hips');
  const spine = [bone(rig, 'spine'), bone(rig, 'spine1'), bone(rig, 'spine2')];
  const neck = bone(rig, 'neck'), head = bone(rig, 'head');
  const legs = [
    [bone(rig, 'leftupleg'), bone(rig, 'leftleg'), bone(rig, 'leftfoot'), bone(rig, 'lefttoe_end')],
    [bone(rig, 'rightupleg'), bone(rig, 'rightleg'), bone(rig, 'rightfoot'), bone(rig, 'righttoe_end')],
  ] as const;
  const arms = [
    [bone(rig, 'leftarm'), bone(rig, 'leftforearm'), bone(rig, 'lefthand')],
    [bone(rig, 'rightarm'), bone(rig, 'rightforearm'), bone(rig, 'righthand')],
  ] as const;
  const joints: THREE.Bone[] = [];
  rig.traverse(object => { if ((object as THREE.Bone).isBone) joints.push(object as THREE.Bone); });
  const rest = joints.map(joint => ({ rotation: joint.quaternion.clone(), position: joint.position.clone() }));
  const restWorld = new Map(joints.map(joint => [joint, joint.getWorldQuaternion(new THREE.Quaternion())]));
  const restHipPoint = hips.getWorldPosition(new THREE.Vector3());
  const pelvisHeight = restHipPoint.y * 0.735;
  const ankleFloor = THREE.MathUtils.clamp(ankleHeight, 0.065, 0.11);
  const soleFrames = legs.map(leg => {
    const toe = leg[3].getWorldPosition(new THREE.Vector3()).sub(leg[2].getWorldPosition(new THREE.Vector3()));
    const heading = Math.atan2(toe.x, toe.z);
    return rotation(0, -heading).multiply(restWorld.get(leg[2])!);
  });
  const headFrame = restWorld.get(head)!.clone();
  const gaze = new THREE.Vector3().copy(headLocalForward).applyQuaternion(headFrame);
  headFrame.premultiply(rotation(0, -Math.atan2(gaze.x, gaze.z))).normalize();
  const fingers = new Map<THREE.Bone, THREE.Quaternion>();
  for (const track of upperReference.tracks) {
    if (!track.name.endsWith('.quaternion') || !/hand(?:thumb|index|middle|ring|pinky)/i.test(track.name)) continue;
    const joint = joints.find(joint => `${joint.name}.quaternion` === track.name);
    if (joint) fingers.set(joint, new THREE.Quaternion().fromArray(track.values).normalize());
  }
  const directions: Record<CrouchLocomotionId, readonly [number, number]> = {
    'crouch-idle': [0, 0], 'crouch-walking': [0, 1], 'crouch-backward': [0, -1],
    'crouch-strafe-left': [1, 0], 'crouch-strafe-right': [-1, 0],
    'crouch-forward-left': [Math.SQRT1_2, Math.SQRT1_2],
    'crouch-forward-right': [-Math.SQRT1_2, Math.SQRT1_2],
    'crouch-backward-left': [Math.SQRT1_2, -Math.SQRT1_2],
    'crouch-backward-right': [-Math.SQRT1_2, -Math.SQRT1_2],
  };
  const result = new Map<CrouchLocomotionId, THREE.AnimationClip>();
  for (const id of CROUCH_LOCOMOTION_IDS) {
    const idle = id === 'crouch-idle';
    const [lateral, forward] = directions[id];
    const duration = idle ? 3.4 : THREE.MathUtils.lerp(0.78, 0.56, Math.abs(lateral));
    const halfTravel = CROUCH_GAIT_REFERENCE_SPEED * duration * SUPPORT_FRACTION / 2;
    const width = 0.18 + Math.abs(lateral) * 0.05;
    const frames = 120;
    const times = Array.from({ length: frames + 1 }, (_, i) => duration * i / frames);
    const rotations = joints.map(() => [] as number[]), positions: number[] = [];
    const previous = joints.map(() => undefined as THREE.Quaternion | undefined);
    for (let frame = 0; frame <= frames; frame++) {
      joints.forEach((joint, i) => {
        joint.quaternion.copy(rest[i]!.rotation); joint.position.copy(rest[i]!.position);
      });
      for (const [joint, q] of fingers) joint.quaternion.copy(q);
      const cycle = (frame % frames) / frames;
      const steps = [0, 0.5].map(offset => sampleStep((cycle + offset) % 1, halfTravel,
        THREE.MathUtils.lerp(0.085, 0.065, Math.abs(lateral)), forward));
      const transfer = idle ? 0 : steps[1]!.swing - steps[0]!.swing;
      const counterSwing = idle ? 0 : Math.sin(cycle * Math.PI * 2);
      const breath = idle ? Math.sin(cycle * Math.PI * 2) : 0;
      const hipPoint = new THREE.Vector3(transfer * 0.032,
        pelvisHeight + (idle ? breath * 0.002 : -Math.cos(cycle * Math.PI * 4) * 0.008),
        restHipPoint.z - 0.045 + (idle ? 0 : forward * 0.012));
      setWorldRotation(hips, rotation(0.09 + forward * 0.025, counterSwing * 0.035,
        transfer * -0.023).multiply(restWorld.get(hips)!));
      hips.position.copy(hips.parent!.worldToLocal(hipPoint));
      hips.updateWorldMatrix(false, true);
      // Relaxed forward lean with a quiet, opposing shoulder turn. The head
      // counterbalances through the neck and keeps looking ahead in all gaits.
      spine.forEach((joint, i) => setWorldRotation(joint,
        rotation([0.18, 0.26, 0.34][i]! + forward * 0.035 + breath * 0.003,
          -counterSwing * (0.015 + i * 0.012), transfer * 0.012).multiply(restWorld.get(joint)!)));
      setWorldRotation(neck, rotation(0.16 + breath * 0.002).multiply(restWorld.get(neck)!));
      setWorldRotation(head, rotation(0.025, 0, transfer * 0.008).multiply(headFrame));
      for (const [side, leg] of legs.entries()) {
        const sign = side === 0 ? 1 : -1, step = steps[side]!;
        const travel = idle ? 0 : step.travel;
        const pitch = idle ? 0 : step.pitch;
        // Roll around the sole, not the ankle: even the beginning/end of swing
        // must not put the toe or heel through the floor.
        const soleLift = ankleFloor * (Math.cos(pitch) - 1)
          + Math.max(0.205 * Math.sin(pitch), -0.060 * Math.sin(pitch));
        const target = new THREE.Vector3(sign * width + lateral * travel,
          ankleFloor + (idle ? 0 : step.lift) + soleLift,
          restHipPoint.z + forward * travel);
        const toeYaw = sign * 0.065 + (idle ? 0 : lateral * step.swing * 0.055);
        const kneePole = new THREE.Vector3(Math.sin(sign * 0.065), 0, Math.cos(sign * 0.065));
        solveCombatTwoBone(leg[0], leg[1], leg[2], target, 1, kneePole, 0.997);
        setWorldRotation(leg[2], rotation(pitch, toeYaw).multiply(soleFrames[side]!));
      }
      for (const [side, arm] of arms.entries()) {
        const sign = side === 0 ? 1 : -1;
        const swing = counterSwing * sign;
        const hand = new THREE.Vector3(sign * (0.23 + Math.abs(lateral) * 0.008),
          pelvisHeight + 0.025 + (idle ? breath * 0.001 : swing * 0.007),
          restHipPoint.z + 0.235 - swing * (0.035 * Math.abs(forward) + 0.012));
        solveCombatTwoBone(arm[0], arm[1], arm[2], hand, 1,
          new THREE.Vector3(sign * 0.35, -0.8, -0.35), 0.99);
        // Keep the relaxed wrist relative to its forearm. A world-locked bind
        // hand would dangle sharply when the newly bent elbow moves forward.
      }
      joints.forEach((joint, j) => {
        const q = joint.quaternion.clone().normalize();
        if (previous[j] && previous[j]!.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        rotations[j]!.push(q.x, q.y, q.z, q.w); previous[j] = q;
      });
      positions.push(hips.position.x, hips.position.y, hips.position.z);
    }
    const tracks: THREE.KeyframeTrack[] = joints.map((joint, i) =>
      new THREE.QuaternionKeyframeTrack(`${joint.name}.quaternion`, times, rotations[i]!));
    tracks.push(new THREE.VectorKeyframeTrack(`${hips.name}.position`, times, positions));
    result.set(id, new THREE.AnimationClip(`AnimationLab_${id}`, duration, tracks));
  }
  return result;
}
