import * as THREE from 'three';

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
