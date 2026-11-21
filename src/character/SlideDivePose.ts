import * as THREE from 'three';

export interface SlideDiveSample {
  /** Where the feet stand during the walk-up; ignored once `hips` is given. */
  feet: THREE.Vector3;
  yaw: number;
  /** Forward pitch of the whole body (radians): 0 standing, PI/2 head-first. */
  pitch: number;
  /** Desired world position of the pelvis during the leap (pivot of the pitch). */
  hips?: THREE.Vector3;
  walking: number;
  gaitDistance: number;
  /** 0..1 weight of the jump clip, and its normalised time. */
  leap: number;
  leapTime: number;
  time: number;
}
export interface SlideDiveFrame { head: THREE.Vector3; hips: THREE.Vector3; eye: THREE.Vector3 }

const find = (root: THREE.Object3D, suffix: string): THREE.Bone | undefined => {
  let result: THREE.Bone | undefined;
  root.traverse(o => { if ((o as THREE.Bone).isBone && o.name.toLowerCase().replace(/[^a-z0-9]/g, '').endsWith(suffix)) result = o as THREE.Bone; });
  return result;
};

/** The dressed world avatar walking up to a tube and diving into it head first.
 * Its own mixer on the real rig, like the seated pose: no clone, no second
 * skeleton. The gameplay mixer is not stepped while this pose is presented. */
export class SlideDivePose {
  private readonly mixer: THREE.AnimationMixer;
  private readonly idle: THREE.AnimationAction;
  private readonly walk: THREE.AnimationAction;
  private readonly jump: THREE.AnimationAction;
  private readonly originals: { bone: THREE.Bone; position: THREE.Vector3; rotation: THREE.Quaternion }[] = [];
  private readonly hipsBone: THREE.Bone;
  private readonly headBone: THREE.Bone;
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private disposed = false;
  constructor(readonly root: THREE.Object3D, private readonly anchor: THREE.Object3D, idle: THREE.AnimationClip, walk: THREE.AnimationClip, jump: THREE.AnimationClip) {
    root.traverse(o => { if ((o as THREE.Bone).isBone) this.originals.push({ bone: o as THREE.Bone, position: o.position.clone(), rotation: o.quaternion.clone() }); });
    const hips = find(root, 'hips'), head = find(root, 'head');
    if (!hips || !head) throw new Error('Le rig du personnage ne contient pas le bassin et la tête.');
    this.hipsBone = hips; this.headBone = head;
    this.mixer = new THREE.AnimationMixer(root);
    this.idle = this.mixer.clipAction(idle).play();
    this.walk = this.mixer.clipAction(walk).play().setEffectiveWeight(0);
    this.jump = this.mixer.clipAction(jump).setLoop(THREE.LoopOnce, 1).play().setEffectiveWeight(0);
    this.jump.clampWhenFinished = true;
  }
  sample(s: SlideDiveSample): SlideDiveFrame {
    const walk = THREE.MathUtils.clamp(s.walking, 0, 1), leap = THREE.MathUtils.clamp(s.leap, 0, 1);
    this.walk.setEffectiveWeight(walk * (1 - leap));
    this.jump.setEffectiveWeight(leap);
    this.idle.setEffectiveWeight(Math.max(0, 1 - walk) * (1 - leap));
    this.idle.time = s.time % this.idle.getClip().duration;
    // Same 2.05 m/s reference as the ordinary authored walking gait.
    this.walk.time = ((s.gaitDistance / (2.05 * this.walk.getClip().duration)) % 1) * this.walk.getClip().duration;
    this.jump.time = THREE.MathUtils.clamp(s.leapTime, 0, 1) * (this.jump.getClip().duration - 1e-4);
    this.mixer.update(0);
    this.anchor.position.copy(s.feet);
    this.anchor.quaternion.setFromEuler(this.euler.set(s.pitch, s.yaw, 0, 'YXZ'));
    this.anchor.updateMatrixWorld(true);
    if (s.hips) {
      // Pivot about the pelvis: the head goes into the mouth, the feet trail.
      const current = this.hipsBone.getWorldPosition(new THREE.Vector3());
      this.anchor.position.add(s.hips.clone().sub(current));
      this.anchor.updateMatrixWorld(true);
    }
    const head = this.headBone.getWorldPosition(new THREE.Vector3());
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.anchor.quaternion);
    return { head, hips: this.hipsBone.getWorldPosition(new THREE.Vector3()), eye: head.clone().add(new THREE.Vector3(0, .075, 0)).addScaledVector(forward, .095) };
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.root);
    for (const p of this.originals) { p.bone.position.copy(p.position); p.bone.quaternion.copy(p.rotation); }
    this.anchor.updateMatrixWorld(true);
  }
}
