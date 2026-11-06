import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { limitKneeLateralBend, solveCombatTwoBone } from './CombatRig';
import { createDirectionalLocomotionBlendClip } from './CombatAnimationLayers';
import { reverseLocomotionClip, sampleGaitPhase } from './LocomotionBlend';

export const CROUCH_GAIT_REFERENCE_SPEED = 1.62;
export const CROUCH_LOCOMOTION_IDS = [
  'crouch-idle', 'crouch-walking', 'crouch-backward', 'crouch-strafe-left', 'crouch-strafe-right',
  'crouch-forward-left', 'crouch-forward-right', 'crouch-backward-left', 'crouch-backward-right',
] as const;
export type CrouchLocomotionId = typeof CROUCH_LOCOMOTION_IDS[number];

const backwardCrouchClip = (forward: THREE.AnimationClip): THREE.AnimationClip => {
  const reversed = reverseLocomotionClip(forward);
  // The supplied forward take has slightly different endpoint hip heights.
  // Close the derived backwards loop without touching the original forward.
  for (const track of reversed.tracks) {
    const size = track.getValueSize(), quaternion = track.name.endsWith('.quaternion');
    const first = new THREE.Quaternion().fromArray(track.values).normalize();
    for (let frame = 0; frame < track.times.length; frame++) {
      const blend = THREE.MathUtils.smoothstep(track.times[frame]!, reversed.duration * 0.84, reversed.duration);
      if (!blend) continue;
      if (quaternion) {
        const q = new THREE.Quaternion().fromArray(track.values, frame * size).normalize().slerp(first, blend);
        q.toArray(track.values, frame * size);
      } else for (let axis = 0; axis < size; axis++) {
        const i = frame * size + axis;
        track.values[i] = THREE.MathUtils.lerp(track.values[i]!, track.values[axis]!, blend);
      }
    }
  }
  return reversed;
};

/** Keep the supplied idle and forward walk intact. Only lateral motion is
 * adapted: authored step timing, quieter upper body, smaller sideways reach,
 * and sole heading corrected on the actual character skeleton. */
export function createCrouchLocomotionClips(
  character: THREE.Object3D, ankleHeight: number,
  references: { idle: THREE.AnimationClip; forward: THREE.AnimationClip;
    left: THREE.AnimationClip; right: THREE.AnimationClip },
  headLocalForward: Readonly<THREE.Vector3>,
): { clips: Map<CrouchLocomotionId, THREE.AnimationClip>; referenceSpeeds: Map<CrouchLocomotionId, number> } {
  const rig = clone(character), joints: THREE.Bone[] = [];
  rig.traverse(object => { if ((object as THREE.Bone).isBone) joints.push(object as THREE.Bone); });
  const bone = (name: string): THREE.Bone => {
    const found = joints.find(joint => joint.name.toLowerCase().replace(/[^a-z0-9]/g, '').endsWith(name));
    if (!found) throw new Error(`Crouch strafe bone missing: ${name}`);
    return found;
  };
  const hips = bone('hips'), head = bone('head'), neck = bone('neck');
  const legs = ['left', 'right'].map(side =>
    [bone(`${side}upleg`), bone(`${side}leg`), bone(`${side}foot`), bone(`${side}toeend`)]);
  const rest = joints.map(joint => ({ q: joint.quaternion.clone(), p: joint.position.clone() }));
  const reset = (): void => joints.forEach((joint, i) => {
    joint.quaternion.copy(rest[i]!.q); joint.position.copy(rest[i]!.p);
  });
  const channels = (clip: THREE.AnimationClip) => clip.tracks.map(track => ({ track,
    joint: joints.find(joint => track.name === `${joint.name}.${track.name.endsWith('.quaternion') ? 'quaternion' : 'position'}`),
    sample: track.name.endsWith('.quaternion') ? new THREE.QuaternionLinearInterpolant(track.times, track.values, 4)
      : new THREE.LinearInterpolant(track.times, track.values, track.getValueSize()),
  }));
  const apply = (samples: ReturnType<typeof channels>, time: number): void => {
    reset();
    for (const { track, joint, sample } of samples) {
      if (!joint) continue;
      const value = sample.evaluate(time);
      if (track.name.endsWith('.quaternion')) joint.quaternion.fromArray(value).normalize();
      else joint.position.fromArray(value);
    }
    rig.updateMatrixWorld(true);
  };
  const meanHeight = (clip: THREE.AnimationClip): number => {
    const track = clip.tracks.find(track => /hips\.position$/i.test(track.name));
    if (!track) return hips.position.y;
    let sum = 0;
    for (let i = 1; i < track.values.length; i += 3) sum += track.values[i]!;
    return sum / track.times.length;
  };
  const forwardPhase = sampleGaitPhase(rig, references.forward);
  const forwardHeight = meanHeight(references.forward);
  const clips = new Map<CrouchLocomotionId, THREE.AnimationClip>([
    ['crouch-idle', references.idle], ['crouch-walking', references.forward],
    ['crouch-backward', backwardCrouchClip(references.forward)],
  ]);
  const referenceSpeeds = new Map<CrouchLocomotionId, number>();
  for (const id of CROUCH_LOCOMOTION_IDS) referenceSpeeds.set(id, CROUCH_GAIT_REFERENCE_SPEED);

  for (const [id, source] of [['crouch-strafe-left', references.left], ['crouch-strafe-right', references.right]] as const) {
    const lateralPhase = sampleGaitPhase(rig, source);
    const body = createDirectionalLocomotionBlendClip(references.forward, source, `${source.name}_body`, {
      lowerBodyLateralWeight: 0.35, upperBodyLateralWeight: 0.12,
      lateralPhaseOffset: lateralPhase - forwardPhase, sampleCount: 81,
    });
    const sourceChannels = channels(source), bodyChannels = channels(body);
    const heightOffset = forwardHeight - meanHeight(source);
    const frames = 96, times = Array.from({ length: frames + 1 }, (_, i) => source.duration * i / frames);
    const values = joints.map(() => [] as number[]), positions: number[] = [];
    const previous = joints.map(() => undefined as THREE.Quaternion | undefined);
    for (let frame = 0; frame <= frames; frame++) {
      const phase = (frame % frames) / frames;
      apply(sourceChannels, phase * source.duration);
      const hipPosition = hips.position.clone(); hipPosition.y += heightOffset;
      const targets = legs.map(leg => leg[2]!.getWorldPosition(new THREE.Vector3()));
      const center = (targets[0]!.x + targets[1]!.x) / 2;
      for (const point of targets) point.x = center * 0.35 + (point.x - center) * 0.72;
      apply(bodyChannels, THREE.MathUtils.euclideanModulo(phase + forwardPhase - lateralPhase, 1) * body.duration);
      hips.position.copy(hipPosition); rig.updateMatrixWorld(true);
      const forward = new THREE.Vector3(0, 0, 1);
      for (const [side, leg] of legs.entries()) {
        const [upper, lower, foot, toe] = leg as [THREE.Bone, THREE.Bone, THREE.Bone, THREE.Bone];
        const q = foot.getWorldQuaternion(new THREE.Quaternion());
        const direction = toe.getWorldPosition(new THREE.Vector3()).sub(foot.getWorldPosition(new THREE.Vector3()));
        const heading = Math.atan2(direction.x, direction.z);
        const desired = THREE.MathUtils.clamp(heading * 0.15, -0.16, 0.16);
        q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), desired - heading));
        const target = targets[side]!;
        target.y = Math.max(ankleHeight, target.y);
        const pole = limitKneeLateralBend(upper, lower, foot, target, forward, 0.997, 0.13);
        solveCombatTwoBone(upper, lower, foot, target, 1, pole, 0.997, 0.12);
        foot.quaternion.copy(foot.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q)).normalize();
        foot.updateWorldMatrix(false, true);
        const toeY = toe.getWorldPosition(new THREE.Vector3()).y;
        if (toeY < 0.003) {
          target.y += 0.003 - toeY;
          solveCombatTwoBone(upper, lower, foot, target, 1, pole, 0.997, 0.12);
          foot.quaternion.copy(foot.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q)).normalize();
          foot.updateWorldMatrix(false, true);
        }
      }
      // Look remains camera-relative while shoulders retain the quiet authored
      // crouch-walk movement; the original side clip looked 70 degrees away.
      const gaze = new THREE.Vector3().copy(headLocalForward).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()));
      const yaw = Math.atan2(gaze.x, gaze.z), counter = THREE.MathUtils.clamp(yaw * 0.85, -0.55, 0.55);
      for (const [joint, share] of [[neck, 0.4], [head, 0.6]] as const) {
        const world = joint.getWorldQuaternion(new THREE.Quaternion());
        world.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -counter * share));
        joint.quaternion.copy(joint.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world)).normalize();
        joint.updateWorldMatrix(false, true);
      }
      positions.push(hips.position.x, hips.position.y, hips.position.z);
      joints.forEach((joint, i) => {
        const q = joint.quaternion.clone().normalize();
        if (previous[i] && previous[i]!.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        values[i]!.push(q.x, q.y, q.z, q.w); previous[i] = q;
      });
    }
    clips.set(id, new THREE.AnimationClip(`${source.name}_corrected`, source.duration, [
      new THREE.VectorKeyframeTrack(`${hips.name}.position`, times, positions),
      ...joints.map((joint, i) => new THREE.QuaternionKeyframeTrack(`${joint.name}.quaternion`, times, values[i]!)),
    ]));
    referenceSpeeds.set(id, CROUCH_GAIT_REFERENCE_SPEED * 0.70);
  }
  for (const backward of [false, true]) for (const right of [false, true]) {
    const forward = clips.get(backward ? 'crouch-backward' : 'crouch-walking')!;
    const lateral = clips.get(right ? 'crouch-strafe-right' : 'crouch-strafe-left')!;
    const id = `crouch-${backward ? 'backward' : 'forward'}-${right ? 'right' : 'left'}` as CrouchLocomotionId;
    const phase = sampleGaitPhase(rig, lateral) - sampleGaitPhase(rig, forward);
    clips.set(id, createDirectionalLocomotionBlendClip(forward, lateral, `AnimationLab_${id}`, {
      lowerBodyLateralWeight: 0.45, upperBodyLateralWeight: 0.22, lateralPhaseOffset: phase, sampleCount: 81,
    }));
    referenceSpeeds.set(id, CROUCH_GAIT_REFERENCE_SPEED * 0.85);
  }
  return { clips, referenceSpeeds };
}
