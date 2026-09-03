import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { solveCombatTwoBone } from './CombatRig';

export interface GaitActionPair {
  thirdPerson: THREE.AnimationAction;
  firstPerson: THREE.AnimationAction;
}

/** Interruptible crossfade from the complete visible mixture, not just its
 * most recently selected action. Rapid direction changes retain their pose. */
export class GaitTransition {
  private entries: Array<{ pair: GaitActionPair; from: number; to: number }> = [];
  private elapsed = 0;
  private duration = 0.2;

  begin(pairs: GaitActionPair[], target: THREE.AnimationAction, duration: number): void {
    const active = pairs.filter(({ thirdPerson: action }) => action === target
      || (action.isScheduled() && action.enabled && action.getEffectiveWeight() > 0.0001));
    const weights = active.map(({ thirdPerson: action }) => action.isScheduled() && action.enabled
      ? action.getEffectiveWeight() : 0);
    const sum = Math.max(0.0001, weights.reduce((a, b) => a + b, 0));
    this.entries = active.map((pair, i) => ({ pair, from: weights[i]! / sum,
      to: pair.thirdPerson === target ? 1 : 0 }));
    this.elapsed = 0;
    this.duration = Math.max(0.05, duration);
  }

  update(delta: number): void {
    if (!this.entries.length) return;
    this.elapsed += Math.max(0, delta);
    const t = Math.min(1, this.elapsed / this.duration);
    const blend = t * t * (3 - 2 * t);
    for (const { pair, from, to } of this.entries) {
      const weight = from + (to - from) * blend;
      for (const action of [pair.thirdPerson, pair.firstPerson]) {
        action.setEffectiveWeight(weight);
        if (t === 1 && to === 0) action.stop();
      }
    }
    if (t === 1) this.entries = [];
  }

  release(duration: number): void {
    for (const { pair } of this.entries) {
      for (const action of [pair.thirdPerson, pair.firstPerson]) action.fadeOut(duration);
    }
    this.entries = [];
  }
}

/** A left-foot swing landmark makes unrelated FBX cycles share a gait phase. */
export function sampleGaitPhase(rig: THREE.Object3D, clip: THREE.AnimationClip): number {
  let left: THREE.Bone | undefined, right: THREE.Bone | undefined;
  rig.traverse((object) => {
    const bone = object as THREE.Bone;
    if (!bone.isBone) return;
    if (/leftfoot$/i.test(bone.name)) left = bone;
    if (/rightfoot$/i.test(bone.name)) right = bone;
  });
  if (!left || !right) return 0;
  const mixer = new THREE.AnimationMixer(rig);
  const action = mixer.clipAction(clip).play();
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  let best = -Infinity, phase = 0;
  for (let i = 0; i < 96; i++) {
    action.time = clip.duration * i / 96;
    mixer.update(0); rig.updateMatrixWorld(true);
    // Subtract the opposite ankle so pelvis bounce cannot shift this landmark.
    const height = left.getWorldPosition(a).y - right.getWorldPosition(b).y;
    if (height > best) { best = height; phase = i / 96; }
  }
  mixer.stopAllAction(); mixer.uncacheRoot(rig);
  return phase;
}

export const alignGaitPhase = (phase: number, oldLandmark: number, newLandmark: number): number =>
  ((phase - oldLandmark + newLandmark) % 1 + 1) % 1;

/** Reverse the forward placement while a backward diagonal's lateral cycle
 * still travels in its requested direction. Reversing the finished diagonal
 * would reverse its sidestep as well. */
export function reverseLocomotionClip(source: THREE.AnimationClip): THREE.AnimationClip {
  const tracks = source.tracks.map(track => {
    const next = track.clone(), size = track.getValueSize();
    for (let i = 0; i < track.times.length; i++) {
      const j = track.times.length - 1 - i;
      next.times[i] = source.duration - track.times[j]!;
      for (let k = 0; k < size; k++) next.values[i * size + k] = track.values[j * size + k]!;
    }
    return next;
  });
  return new THREE.AnimationClip(`${source.name}_reverse`, source.duration, tracks);
}

/** Match posture endpoints to the same crouch stance used by the gait cycles.
 * Retain the authored descent/rise, without its incompatible deep-squat tail. */
export function matchCrouchPostureClip(
  source: THREE.AnimationClip, idle: THREE.AnimationClip, entering: boolean,
  character?: THREE.Object3D, ankleHeight = 0.09,
): THREE.AnimationClip {
  const idleTracks = new Map(idle.tracks.map(track => [track.name, track]));
  const hipTrack = source.tracks.find(track => /hips\.position$/i.test(track.name));
  const targetHip = hipTrack && idleTracks.get(hipTrack.name);
  const duration = Math.min(source.duration, 0.62);
  const times = Array.from({ length: 65 }, (_, i) => duration * i / 64);
  const tracks = source.tracks.map(track => {
    const quaternion = track.name.endsWith('.quaternion'), size = track.getValueSize();
    const sample = quaternion ? new THREE.QuaternionLinearInterpolant(track.times, track.values, 4)
      : new THREE.LinearInterpolant(track.times, track.values, size);
    const target = idleTracks.get(track.name);
    const values: number[] = [];
    const q = new THREE.Quaternion(), b = new THREE.Quaternion();
    let previous: THREE.Quaternion | undefined;
    let lastHeight = entering ? Infinity : -Infinity;
    for (const time of times) {
      const progress = time / duration;
      const blend = entering ? THREE.MathUtils.smoothstep(progress, 0.28, 1)
        : 1 - THREE.MathUtils.smoothstep(progress, 0, 0.72);
      const value = sample.evaluate(progress * source.duration);
      if (quaternion) {
        q.fromArray(value).normalize();
        if (target) q.slerp(b.fromArray(target.values).normalize(), blend);
        if (previous && previous.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        values.push(q.x, q.y, q.z, q.w); previous = q.clone();
      } else {
        for (let i = 0; i < size; i++) {
          let next = THREE.MathUtils.lerp(value[i]!, target?.values[i] ?? value[i]!, blend);
          if (track === hipTrack && i === 1 && targetHip) {
            const standing = entering ? hipTrack.values[1]! : hipTrack.values[hipTrack.values.length - 2]!;
            const crouched = targetHip.values[1]!;
            const sourceCrouch = entering ? hipTrack.values[hipTrack.values.length - 2]! : hipTrack.values[1]!;
            const range = sourceCrouch - standing;
            const authored = Math.abs(range) > 1e-5 ? THREE.MathUtils.clamp((value[i]! - standing) / range, 0, 1)
              : entering ? progress : 1 - progress;
            const descent = THREE.MathUtils.lerp(authored,
              THREE.MathUtils.smoothstep(entering ? progress : 1 - progress, 0, 1), 0.25);
            next = THREE.MathUtils.lerp(standing, crouched, descent);
            next = entering ? Math.min(lastHeight, next) : Math.max(lastHeight, next);
            lastHeight = next;
          }
          values.push(next);
        }
      }
    }
    return quaternion ? new THREE.QuaternionKeyframeTrack(track.name, times, values)
      : new THREE.VectorKeyframeTrack(track.name, times, values);
  });
  const matched = new THREE.AnimationClip(source.name, duration, tracks);
  if (!character) return matched;
  // Changing the crouch height while retaining deep-squat leg rotations lifts
  // both shoes off the floor. Retarget each authored posture frame onto its
  // actual sole contact, retaining foot roll and the original knee hinge.
  const rig = clone(character), bones: THREE.Bone[] = [];
  rig.traverse(object => { if ((object as THREE.Bone).isBone) bones.push(object as THREE.Bone); });
  rig.updateMatrixWorld(true);
  const joint = (name: string): THREE.Bone => bones.find(bone =>
    bone.name.toLowerCase().replace(/[^a-z0-9]/g, '').endsWith(name))!;
  const legs = ['left', 'right'].map(side =>
    [joint(`${side}upleg`), joint(`${side}leg`), joint(`${side}foot`), joint(`${side}toeend`)]);
  const rest = bones.map(bone => ({ p: bone.position.clone(), q: bone.quaternion.clone() }));
  const heels = legs.map(leg => new THREE.Vector3(0, -ankleHeight, -0.055)
    .applyQuaternion(leg[2]!.getWorldQuaternion(new THREE.Quaternion()).invert()));
  const channels = tracks.map(track => ({ track,
    bone: bones.find(bone => track.name === `${bone.name}.${track.name.endsWith('.quaternion') ? 'quaternion' : 'position'}`),
    sample: track.name.endsWith('.quaternion') ? new THREE.QuaternionLinearInterpolant(track.times, track.values, 4)
      : new THREE.LinearInterpolant(track.times, track.values, track.getValueSize()),
  }));
  const values = bones.map(() => [] as number[]), previous = bones.map(() => undefined as THREE.Quaternion | undefined);
  for (const time of times) {
    bones.forEach((bone, i) => { bone.position.copy(rest[i]!.p); bone.quaternion.copy(rest[i]!.q); });
    for (const { track, bone, sample } of channels) {
      if (!bone) continue;
      const value = sample.evaluate(time);
      if (track.name.endsWith('.quaternion')) bone.quaternion.fromArray(value).normalize();
      else bone.position.fromArray(value);
    }
    rig.updateMatrixWorld(true);
    for (const [side, leg] of legs.entries()) {
      const [upper, lower, foot, toe] = leg as [THREE.Bone, THREE.Bone, THREE.Bone, THREE.Bone];
      const point = foot.getWorldPosition(new THREE.Vector3()), q = foot.getWorldQuaternion(new THREE.Quaternion());
      const heelY = point.y + heels[side]!.clone().applyQuaternion(q).y;
      const toeY = toe.getWorldPosition(new THREE.Vector3()).y;
      point.y -= Math.min(heelY, toeY);
      solveCombatTwoBone(upper, lower, foot, point, 1, undefined, 0.997, 0);
      foot.quaternion.copy(foot.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q)).normalize();
      foot.updateWorldMatrix(false, true);
    }
    bones.forEach((bone, i) => {
      const q = bone.quaternion.clone().normalize();
      if (previous[i] && previous[i]!.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      values[i]!.push(q.x, q.y, q.z, q.w); previous[i] = q;
    });
  }
  return new THREE.AnimationClip(source.name, duration, [
    ...bones.map((bone, i) => new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values[i]!)),
    ...tracks.filter(track => !track.name.endsWith('.quaternion')),
  ]);
}

/** Keep the slide's authored push off the floor, then enter the nearest running
 * foot phase. Mixing a crouch walk with a run loses this actual recovery motion. */
export function createSlideSprintRecoveryClip(
  slide: THREE.AnimationClip,
  run: THREE.AnimationClip,
  sourceStart: number,
): { clip: THREE.AnimationClip; runPhase: number } {
  const duration = 0.58;
  const start = Math.min(slide.duration - 0.1, Math.max(0, sourceStart));
  const end = slide.duration * 0.94;
  const sampleTrack = (track: THREE.KeyframeTrack): THREE.Interpolant => track.name.endsWith('.quaternion')
    ? new THREE.QuaternionLinearInterpolant(track.times, track.values, 4)
    : new THREE.LinearInterpolant(track.times, track.values, track.getValueSize());
  const runSamples = new Map(run.tracks.map(track => [track.name, sampleTrack(track)]));
  const slideSamples = new Map(slide.tracks.map(track => [track.name, sampleTrack(track)]));
  let runPhase = 0, bestCost = Infinity;
  const a = new THREE.Quaternion(), b = new THREE.Quaternion();
  for (let i = 0; i < 96; i++) {
    const phase = i / 96;
    let cost = 0;
    for (const track of slide.tracks) {
      if (!/hips|upleg|leg|foot/i.test(track.name) || !track.name.endsWith('.quaternion')) continue;
      const sample = runSamples.get(track.name);
      if (!sample) continue;
      a.fromArray(slideSamples.get(track.name)!.evaluate(end)).normalize();
      b.fromArray(sample.evaluate(phase * run.duration)).normalize();
      cost += a.angleTo(b) ** 2 * (/hips|foot/i.test(track.name) ? 2 : 1);
    }
    if (cost < bestCost) { bestCost = cost; runPhase = phase; }
  }
  const frames = 35;
  const times = Array.from({ length: frames + 1 }, (_, i) => duration * i / frames);
  const tracks = slide.tracks.map(track => {
    const values: number[] = [];
    const source = slideSamples.get(track.name)!;
    const target = runSamples.get(track.name);
    const quaternion = track.name.endsWith('.quaternion');
    const size = track.getValueSize();
    let previous: THREE.Quaternion | undefined;
    for (const time of times) {
      const progress = time / duration;
      const blend = THREE.MathUtils.smoothstep(progress, 0.72, 1);
      const pose = source.evaluate(start + (end - start) * progress);
      // The next loop starts at this exact phase, including the moving tail.
      const runTime = ((runPhase * run.duration + time - duration) % run.duration + run.duration) % run.duration;
      const running = target?.evaluate(runTime);
      if (quaternion) {
        a.fromArray(pose).normalize();
        if (running) a.slerp(b.fromArray(running).normalize(), blend);
        if (previous && previous.dot(a) < 0) a.set(-a.x, -a.y, -a.z, -a.w);
        values.push(a.x, a.y, a.z, a.w); previous = a.clone();
      } else {
        for (let i = 0; i < size; i++) values.push(THREE.MathUtils.lerp(pose[i]!, running?.[i] ?? pose[i]!, blend));
      }
    }
    return quaternion
      ? new THREE.QuaternionKeyframeTrack(track.name, times, values)
      : new THREE.VectorKeyframeTrack(track.name, times, values);
  });
  return { clip: new THREE.AnimationClip('AnimationLab_slide-to-running', duration, tracks), runPhase };
}
