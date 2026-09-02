import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { solveCombatTwoBone } from './CombatRig';

const suffix = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const bone = (rig: THREE.Object3D, name: string): THREE.Bone => {
  let found: THREE.Bone | undefined;
  rig.traverse(object => {
    if ((object as THREE.Bone).isBone && suffix(object.name).endsWith(name)) found = object as THREE.Bone;
  });
  if (!found) throw new Error(`Crouch retarget bone missing: ${name}`);
  return found;
};
const setWorldRotation = (joint: THREE.Bone, rotation: THREE.Quaternion): void => {
  joint.quaternion.copy(joint.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation)).normalize();
  joint.updateWorldMatrix(false, true);
};

/** Bake the authored cycles onto one supported crouch stance. The pack's idle
 * was a deep squat while its walk was almost standing; lateral clips also used
 * different pelvis heights. A shared height and anatomical step corridor allow
 * phase-aligned crossfades without lifting the body or crossing the knees. */
export function createCrouchLocomotionClips(
  character: THREE.Object3D,
  sources: ReadonlyMap<string, THREE.AnimationClip>,
  ankleHeight: number,
  upperReference: THREE.AnimationClip,
  headLocalForward: Readonly<THREE.Vector3>,
): Map<string, THREE.AnimationClip> {
  const rig = clone(character);
  rig.updateMatrixWorld(true);
  const hips = bone(rig, 'hips');
  const neck = bone(rig, 'neck'), head = bone(rig, 'head');
  const left = [bone(rig, 'leftupleg'), bone(rig, 'leftleg'), bone(rig, 'leftfoot')] as const;
  const right = [bone(rig, 'rightupleg'), bone(rig, 'rightleg'), bone(rig, 'rightfoot')] as const;
  const joints: THREE.Bone[] = [];
  rig.traverse(object => { if ((object as THREE.Bone).isBone) joints.push(object as THREE.Bone); });
  const rest = joints.map(joint => ({ rotation: joint.quaternion.clone(), position: joint.position.clone() }));
  const restHipsWorld = hips.getWorldQuaternion(new THREE.Quaternion());
  const restHeight = hips.getWorldPosition(new THREE.Vector3()).y;
  const pelvisHeight = restHeight * 0.71;
  const ankleFloor = THREE.MathUtils.clamp(ankleHeight, 0.065, 0.11);
  const restore = (): void => joints.forEach((joint, i) => {
    joint.quaternion.copy(rest[i]!.rotation); joint.position.copy(rest[i]!.position);
  });
  const namedJoints = new Map(joints.map(joint => [joint.name, joint]));
  const samplers = new Map<THREE.AnimationClip, Array<{ joint: THREE.Bone; quaternion: boolean; sample: THREE.Interpolant }>>();
  const samplePose = (clip: THREE.AnimationClip, time: number): void => {
    let tracks = samplers.get(clip);
    if (!tracks) {
      tracks = clip.tracks.flatMap(track => {
        const dot = track.name.lastIndexOf('.');
        const joint = namedJoints.get(track.name.slice(0, dot));
        if (!joint) return [];
        const quaternion = track.name.endsWith('.quaternion');
        return [{ joint, quaternion, sample: quaternion
          ? new THREE.QuaternionLinearInterpolant(track.times, track.values, 4)
          : new THREE.LinearInterpolant(track.times, track.values, track.getValueSize()) }];
      });
      samplers.set(clip, tracks);
    }
    restore();
    // Direct sampling matters for the held idle pose: AnimationMixer caches an
    // unchanged track value and would leave last frame's procedural IK in place.
    for (const { joint, quaternion, sample } of tracks) {
      const value = sample.evaluate(time);
      if (quaternion) joint.quaternion.fromArray(value).normalize();
      else joint.position.fromArray(value);
    }
    rig.updateMatrixWorld(true);
  };
  // Find a calm double-support pose for rest and each direction's first step.
  const startPhase = (source: THREE.AnimationClip): number => {
    let best = Infinity, phase = 0;
    for (let i = 0; i < 96; i++) {
      samplePose(source, source.duration * i / 96);
      const a = left[2].getWorldPosition(new THREE.Vector3());
      const b = right[2].getWorldPosition(new THREE.Vector3());
      const cost = Math.abs(a.y - b.y) * 4 + Math.abs(a.z - b.z) * 0.6
        + Math.abs(Math.abs(a.x - b.x) - 0.30) * 0.3;
      if (cost < best) { best = cost; phase = i / 96; }
    }
    return phase;
  };
  const idleSource = sources.get('crouch-strafe-left')!;
  const idlePhase = startPhase(idleSource);
  samplePose(upperReference, 0);
  const quietUpper = new Map(joints.map(joint => [joint.name, joint.quaternion.clone()]));
  const quietHeadWorld = head.getWorldQuaternion(new THREE.Quaternion());
  const neutralGaze = new THREE.Vector3().copy(headLocalForward).applyQuaternion(quietHeadWorld);
  quietHeadWorld.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0),
    -Math.atan2(neutralGaze.x, neutralGaze.z))).normalize();
  const result = new Map<string, THREE.AnimationClip>();
  for (const [id, original] of sources) {
    const idle = id === 'crouch-idle';
    const source = idle ? idleSource : original;
    const phase = idle ? idlePhase : startPhase(source);
    const duration = original.duration;
    const frames = 96;
    const times = Array.from({ length: frames + 1 }, (_, i) => duration * i / frames);
    const rotations = joints.map(() => [] as number[]);
    const positions: number[] = [];
    const previous = joints.map(() => undefined as THREE.Quaternion | undefined);
    for (let i = 0; i <= frames; i++) {
      samplePose(source, ((phase + (idle ? 0 : (i % frames) / frames)) % 1) * source.duration);
      for (const joint of joints) {
        const name = suffix(joint.name);
        const weight = /neck|head/.test(name) ? 0.75
          : /spine/.test(name) ? (idle ? 0.55 : 0.18)
            : /shoulder|arm|hand/.test(name) ? (idle ? 0.65 : 0.20) : 0;
        if (weight) joint.quaternion.slerp(quietUpper.get(joint.name)!, weight).normalize();
      }
      rig.updateMatrixWorld(true);
      const hipPoint = hips.getWorldPosition(new THREE.Vector3());
      const feet = [left, right].map(leg => ({
        point: leg[2].getWorldPosition(new THREE.Vector3()),
        rotation: leg[2].getWorldQuaternion(new THREE.Quaternion()),
      }));
      const lowest = Math.min(feet[0]!.point.y, feet[1]!.point.y);
      const delta = hips.getWorldQuaternion(new THREE.Quaternion()).multiply(restHipsWorld.clone().invert());
      const tilt = new THREE.Euler().setFromQuaternion(delta, 'YXZ');
      tilt.y = THREE.MathUtils.clamp(tilt.y, -0.16, 0.16);
      tilt.z = THREE.MathUtils.clamp(tilt.z, -0.065, 0.065);
      setWorldRotation(hips, new THREE.Quaternion().setFromEuler(tilt).multiply(restHipsWorld));
      // Retain a small authored weight transfer and quiet breathing, rather than
      // the 40 cm idle/walk height difference of the original FBX files.
      hipPoint.y = pelvisHeight + (idle ? Math.sin(i / frames * Math.PI * 2) * 0.002
        : THREE.MathUtils.clamp((hipPoint.y - lowest) - 0.66, -0.035, 0.035) * 0.45);
      hips.position.copy(hips.parent!.worldToLocal(hipPoint));
      hips.updateWorldMatrix(false, true);
      // The lateral files carry a pronounced side glance. Keep the gaze ahead
      // while sharing its counter-turn through the neck, rather than copying a
      // local head rotation from an unrelated spine orientation.
      const glance = new THREE.Euler().setFromQuaternion(head.getWorldQuaternion(new THREE.Quaternion())
        .multiply(quietHeadWorld.clone().invert()), 'YXZ');
      const neckWorld = neck.getWorldQuaternion(new THREE.Quaternion())
        .premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -glance.y * 0.55));
      setWorldRotation(neck, neckWorld);
      const gaze = new THREE.Euler(THREE.MathUtils.clamp(glance.x, -0.12, 0.15), 0,
        THREE.MathUtils.clamp(glance.z, -0.055, 0.055), 'YXZ');
      setWorldRotation(head, new THREE.Quaternion().setFromEuler(gaze).multiply(quietHeadWorld));
      for (const [side, leg] of [left, right].entries()) {
        const target = feet[side]!.point.clone();
        const sign = side === 0 ? 1 : -1;
        target.x = idle ? sign * 0.16 : sign * THREE.MathUtils.clamp(sign * target.x * 0.80, 0.065, 0.36);
        if (idle) target.z = -0.12;
        target.y = ankleFloor + (idle ? 0 : THREE.MathUtils.clamp(feet[side]!.point.y - lowest, 0, 0.125));
        // Preserve the current bend plane: a lateral pole can rotate the thigh
        // into the pelvis even when the endpoint looks correct.
        solveCombatTwoBone(leg[0], leg[1], leg[2], target, 1, undefined, 0.997, 12 * Math.PI / 180);
        setWorldRotation(leg[2], feet[side]!.rotation);
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
