import * as THREE from 'three';
import { GET_UP_BLEND_SECONDS, getUpProgress, getUpYawFromDirection, type GetUpSide } from './GetUpRecoveryRules';

interface BonePose {
  bone: THREE.Bone;
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
}

/**
 * Temporary, animation-only presentation of the same skeleton that was ragdolled.
 * No physical body is moved toward a pose. Rapier is released only after a safe
 * standing location has been found and the player explicitly requests recovery.
 */
export class GetUpRecovery {
  readonly side: GetUpSide;
  readonly standingPosition: THREE.Vector3;
  readonly duration: number;
  readonly root: THREE.Group;

  private readonly character: THREE.Group;
  private readonly hips: THREE.Bone;
  private readonly head: THREE.Bone;
  private readonly mixer: THREE.AnimationMixer;
  private readonly action: THREE.AnimationAction;
  private readonly snapshot: BonePose[] = [];
  private readonly startPosition: THREE.Vector3;
  private readonly startRotation: THREE.Quaternion;
  private readonly targetPosition: THREE.Vector3;
  private readonly targetRotation: THREE.Quaternion;
  private readonly holdClip: THREE.AnimationClip;
  private readonly playbackRate: number;
  private elapsed = 0;
  private started = false;

  constructor(
    root: THREE.Group,
    character: THREE.Group,
    clip: THREE.AnimationClip,
    side: GetUpSide,
    groundY: number,
  ) {
    this.root = root;
    this.character = character;
    this.side = side;
    const find = (suffix: string): THREE.Bone => {
      let result: THREE.Bone | undefined;
      character.traverse((object) => {
        const bone = object as THREE.Bone;
        if (bone.isBone && bone.name.toLowerCase().replace(/[^a-z0-9]/g, '').endsWith(suffix)) result = bone;
      });
      if (!result) throw new Error(`Get-up: missing ${suffix} bone`);
      return result;
    };
    this.hips = find('hips');
    this.head = find('head');
    this.startPosition = root.position.clone();
    this.startRotation = root.quaternion.clone();
    character.updateMatrixWorld(true);
    const physicalHipPosition = this.hips.getWorldPosition(new THREE.Vector3());
    const physicalHipRotation = this.hips.getWorldQuaternion(new THREE.Quaternion());

    character.traverse((object) => {
      const bone = object as THREE.Bone;
      if (bone.isBone) this.snapshot.push({
        bone, position: bone.position.clone(), rotation: bone.quaternion.clone(),
      });
    });
    this.holdClip = new THREE.AnimationClip('GetUp_PhysicalPose', 1, this.snapshot.flatMap(({ bone, position, rotation }) => [
      new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, [0, 1], [
        rotation.x, rotation.y, rotation.z, rotation.w,
        rotation.x, rotation.y, rotation.z, rotation.w,
      ]),
      ...(bone === this.hips ? [new THREE.VectorKeyframeTrack(`${bone.name}.position`, [0, 1], [
        position.x, position.y, position.z, position.x, position.y, position.z,
      ])] : []),
    ]));

    this.mixer = new THREE.AnimationMixer(character);
    this.action = this.mixer.clipAction(clip);
    this.action.reset().setLoop(THREE.LoopOnce, 1);
    this.action.clampWhenFinished = true;
    this.action.play();
    this.mixer.update(0);
    character.updateMatrixWorld(true);

    const initialHipPosition = this.hips.getWorldPosition(new THREE.Vector3());
    const initialHipRotation = this.hips.getWorldQuaternion(new THREE.Quaternion());
    const delta = physicalHipRotation.clone().multiply(initialHipRotation.invert()).normalize();
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(delta);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(delta);
    const yaw = Math.hypot(forward.x, forward.z) > 0.24
      ? getUpYawFromDirection(forward.x, forward.z, 0)
      : getUpYawFromDirection(-right.z, right.x, 0);
    const yawRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.targetRotation = yawRotation.clone().multiply(this.startRotation);
    const relativeHipPosition = initialHipPosition.clone().sub(this.startPosition).applyQuaternion(yawRotation);
    this.targetPosition = physicalHipPosition.clone().sub(relativeHipPosition);

    // The actual source's initial pose determines its ground offset. This avoids
    // assuming that a lying pelvis is at standing height or pushing it into the floor.
    const bounds = new THREE.Box3().setFromObject(character, true);
    this.targetPosition.y = groundY + this.startPosition.y - bounds.min.y;
    this.standingPosition = new THREE.Vector3(this.targetPosition.x, groundY + 0.865, this.targetPosition.z);
    // The supplied Mixamo takes are intentionally long (roughly 8–11 s).
    // Playing them near source speed feels like the game froze after pressing E.
    // Normalize the authored motion to a compact, readable recovery while still
    // preserving every source keyframe and the back/belly distinction.
    const targetDuration = side === 'back' ? 2.15 : 2.45;
    this.playbackRate = THREE.MathUtils.clamp(clip.duration / targetDuration, 1, 6);
    this.duration = Math.max(0.5, clip.duration / this.playbackRate);

    this.mixer.stopAllAction();
    this.restorePose();
  }

  private restorePose(): void {
    this.root.position.copy(this.startPosition);
    this.root.quaternion.copy(this.startRotation);
    for (const pose of this.snapshot) {
      pose.bone.position.copy(pose.position);
      pose.bone.quaternion.copy(pose.rotation);
    }
    this.character.updateMatrixWorld(true);
  }

  retargetStandingPosition(position: Readonly<THREE.Vector3>): void {
    this.targetPosition.y += position.y - this.standingPosition.y;
    this.targetPosition.x += position.x - this.standingPosition.x;
    this.targetPosition.z += position.z - this.standingPosition.z;
    this.standingPosition.copy(position);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const hold = this.mixer.clipAction(this.holdClip);
    hold.reset().setLoop(THREE.LoopOnce, 1);
    hold.clampWhenFinished = true;
    hold.play();
    this.action.reset().setLoop(THREE.LoopOnce, 1);
    this.action.clampWhenFinished = true;
    this.action.setEffectiveTimeScale(this.playbackRate);
    this.action.play();
    this.action.crossFadeFrom(hold, GET_UP_BLEND_SECONDS, false);
    this.mixer.update(0);
  }

  update(delta: number): void {
    if (!this.started || this.isFinished) return;
    const step = Math.max(0, Math.min(0.05, delta));
    this.elapsed = Math.min(this.duration, this.elapsed + step);
    this.mixer.update(step);
    const t = THREE.MathUtils.smoothstep(
      this.elapsed, 0, GET_UP_BLEND_SECONDS,
    );
    this.root.position.copy(this.startPosition).lerp(this.targetPosition, t);
    this.root.quaternion.copy(this.startRotation).slerp(this.targetRotation, t);
    this.character.updateMatrixWorld(true);
  }

  get progress(): number { return getUpProgress(this.elapsed, this.duration); }
  get isFinished(): boolean { return this.started && this.elapsed >= this.duration - 1e-4; }

  getHeadPose(
    position = new THREE.Vector3(),
    rotation = new THREE.Quaternion(),
  ): { position: THREE.Vector3; rotation: THREE.Quaternion } {
    this.head.updateWorldMatrix(true, false);
    return {
      position: this.head.getWorldPosition(position),
      rotation: this.head.getWorldQuaternion(rotation),
    };
  }

  getPelvisPosition(target = new THREE.Vector3()): THREE.Vector3 {
    this.hips.updateWorldMatrix(true, false);
    return this.hips.getWorldPosition(target);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.character);
  }
}


/** Captures a pose for a short, continuous crossfade between two separate rigs. */
export const captureGetUpPoseClip = (character: THREE.Group, name: string): THREE.AnimationClip => {
  const tracks: THREE.KeyframeTrack[] = [];
  character.traverse((object) => {
    const bone = object as THREE.Bone;
    if (!bone.isBone) return;
    const q = bone.quaternion;
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, [0, 1], [
      q.x, q.y, q.z, q.w, q.x, q.y, q.z, q.w,
    ]));
    if (bone.name.toLowerCase().replace(/[^a-z0-9]/g, '').endsWith('hips')) {
      const p = bone.position;
      tracks.push(new THREE.VectorKeyframeTrack(`${bone.name}.position`, [0, 1], [
        p.x, p.y, p.z, p.x, p.y, p.z,
      ]));
    }
  });
  return new THREE.AnimationClip(name, 1, tracks);
};

export const copyGetUpPose = (source: THREE.Group, target: THREE.Group): void => {
  const bones = new Map<string, THREE.Bone>();
  source.traverse((object) => {
    const bone = object as THREE.Bone;
    if (bone.isBone) bones.set(bone.name, bone);
  });
  target.traverse((object) => {
    const bone = object as THREE.Bone;
    if (!bone.isBone) return;
    const from = bones.get(bone.name);
    if (!from) return;
    bone.quaternion.copy(from.quaternion);
    bone.position.copy(from.position);
  });
  target.updateMatrixWorld(true);
};
