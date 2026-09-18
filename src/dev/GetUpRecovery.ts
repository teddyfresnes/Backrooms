import * as THREE from 'three';
import { GET_UP_BLEND_SECONDS, getUpProgress, getUpYawFromDirection, type GetUpSide } from './GetUpRecoveryRules';
import { GET_UP_SETTLE_SECONDS } from './GetUpMotion';

interface BonePose {
  bone: THREE.Bone;
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
}

interface RecoveryOptions {
  preparationSeconds?: number;
  holdFinalPose?: boolean;
  rootMotion?: { sample(seconds: number, loop: boolean, target: THREE.Vector3): THREE.Vector3 };
}

/**
 * Temporary, animation-only presentation of the same skeleton that was ragdolled.
 * No physical body is moved toward a pose. Ground emotes first align the body
 * with the source's initial pose, then play it. A held lying pose stays down;
 * a completed rise hands control back to the validated standing capsule.
 */
export class GetUpRecovery {
  readonly side: GetUpSide;
  readonly standingPosition: THREE.Vector3;
  readonly duration: number;
  readonly root: THREE.Group;
  readonly preparationBounds = new THREE.Box3();
  readonly groundOrigin = new THREE.Vector3();
  readonly targetYaw: number;

  private readonly character: THREE.Group;
  private readonly hips: THREE.Bone;
  private readonly head: THREE.Bone;
  private readonly mixer: THREE.AnimationMixer;
  private readonly action: THREE.AnimationAction;
  private readonly snapshot: BonePose[] = [];
  private readonly alignmentPose: BonePose[] = [];
  private readonly contacts: THREE.Bone[] = [];
  private readonly landmarks: THREE.Bone[] = [];
  private readonly groundPoint = new THREE.Vector3();
  private readonly startPosition: THREE.Vector3;
  private readonly startRotation: THREE.Quaternion;
  private readonly targetPosition: THREE.Vector3;
  private readonly targetRotation: THREE.Quaternion;
  private readonly holdClip: THREE.AnimationClip;
  private readonly alignmentClip: THREE.AnimationClip;
  private readonly preparationSeconds: number;
  private readonly rootOffset = new THREE.Vector3();
  private preparationLift = 0;
  private elapsed = 0;
  private started = false;

  constructor(
    root: THREE.Group,
    character: THREE.Group,
    clip: THREE.AnimationClip,
    side: GetUpSide,
    private readonly groundY: number,
    private readonly options: RecoveryOptions = {},
  ) {
    this.root = root;
    this.character = character;
    this.side = side;
    this.preparationSeconds = Math.max(0, options.preparationSeconds ?? 0);
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
      if (!bone.isBone) return;
      this.snapshot.push({
        bone, position: bone.position.clone(), rotation: bone.quaternion.clone(),
      });
      if (/(head|hand|leg|foot|toebase)$/i.test(bone.name)) this.contacts.push(bone);
      if (/(hips|spine\d*|neck|head|shoulder|arm|forearm|hand|upleg|leg|foot|toebase)$/i.test(bone.name)) this.landmarks.push(bone);
    });
    this.holdClip = new THREE.AnimationClip('GetUp_PhysicalPose', 1, this.snapshot.flatMap(({ bone, position, rotation }) => [
      new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, [0, 1], [
        rotation.x, rotation.y, rotation.z, rotation.w,
        rotation.x, rotation.y, rotation.z, rotation.w,
      ]),
      new THREE.VectorKeyframeTrack(`${bone.name}.position`, [0, 1], [
        position.x, position.y, position.z, position.x, position.y, position.z,
      ]),
    ]));

    this.mixer = new THREE.AnimationMixer(character);
    this.action = this.mixer.clipAction(clip);
    this.action.reset().setLoop(THREE.LoopOnce, 1);
    this.action.clampWhenFinished = true;
    this.action.play();
    this.mixer.update(0);
    character.updateMatrixWorld(true);
    this.alignmentClip = captureGetUpPoseClip(character, 'GetUp_InitialPose');
    for (const { bone } of this.snapshot) this.alignmentPose.push({
      bone, position: bone.position.clone(), rotation: bone.quaternion.clone(),
    });

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
    this.targetYaw = new THREE.Euler().setFromQuaternion(this.targetRotation, 'YXZ').y;
    const relativeHipPosition = initialHipPosition.clone().sub(this.startPosition).applyQuaternion(yawRotation);
    this.targetPosition = physicalHipPosition.clone().sub(relativeHipPosition);

    // The actual source's initial pose determines its ground offset. This avoids
    // assuming that a lying pelvis is at standing height or pushing it into the floor.
    const bounds = new THREE.Box3().setFromObject(character, true);
    this.targetPosition.y = groundY + this.startPosition.y - bounds.min.y;
    this.groundOrigin.copy(this.targetPosition).setY(groundY);
    this.standingPosition = new THREE.Vector3(this.targetPosition.x, groundY + 0.865, this.targetPosition.z);
    if (options.rootMotion) {
      options.rootMotion.sample(clip.duration, false, this.rootOffset).applyQuaternion(this.targetRotation);
      this.standingPosition.add(this.rootOffset);
    }
    // GetUpMotion already trims waiting and settles into the standing pose.
    // Never accelerate the full source take or rush the last upright frames.
    this.duration = this.preparationSeconds + Math.max(0.5, clip.duration);

    this.mixer.stopAllAction();
    if (this.preparationSeconds > 0) this.bakePreparationBounds();
    this.restorePose();
  }

  /** Keep feet, hands and head above the supporting floor throughout the blend. */
  private supportPreparationPose(delta = Infinity): void {
    this.character.updateMatrixWorld(true);
    let bottom = Infinity;
    for (const bone of this.contacts) bottom = Math.min(bottom, bone.getWorldPosition(this.groundPoint).y);
    let lift = Math.max(0, this.groundY + .015 - bottom);
    if (Number.isFinite(delta)) {
      // Physical toes can already be a little below the floor. Correct that
      // over the first frames instead of popping the whole body upward.
      lift = Math.min(lift, this.preparationLift + Math.max(0, delta) * 4);
      // A newly captured asymmetric resting pose can put a toe deeper than the
      // gradual lift covers on its first frame. Bound that inherited visual
      // penetration while the normal smooth correction finishes the alignment.
      lift = Math.max(lift, this.groundY - .05 - bottom);
      this.preparationLift = lift;
    }
    if (lift > 0) {
      this.root.position.y += lift;
      this.character.updateMatrixWorld(true);
    }
  }

  /** A small, CPU-only sweep prepared once for the current downed pose. */
  private bakePreparationBounds(): void {
    const inverse = this.targetRotation.clone().invert();
    const point = new THREE.Vector3(), padding = new THREE.Vector3();
    for (let sample = 0; sample <= 16; sample++) {
      const t = sample / 16;
      for (let i = 0; i < this.snapshot.length; i++) {
        const from = this.snapshot[i]!, to = this.alignmentPose[i]!;
        from.bone.position.copy(from.position).lerp(to.position, t);
        from.bone.quaternion.copy(from.rotation).slerp(to.rotation, t);
      }
      const rootBlend = THREE.MathUtils.smoothstep(t, 0, 1);
      this.root.position.copy(this.startPosition).lerp(this.targetPosition, rootBlend);
      this.root.quaternion.copy(this.startRotation).slerp(this.targetRotation, rootBlend);
      this.supportPreparationPose();
      for (const bone of this.landmarks) {
        bone.getWorldPosition(point).sub(this.groundOrigin).applyQuaternion(inverse);
        padding.setScalar(/head|hips|spine\d*$/i.test(bone.name) ? .16 : .10);
        this.preparationBounds.expandByPoint(point.clone().sub(padding));
        this.preparationBounds.expandByPoint(point.add(padding));
      }
    }
    this.preparationBounds.min.y = Math.max(.07, this.preparationBounds.min.y);
  }

  /** Invalidates a prepared pose when a physical limb has appreciably moved. */
  matchesCurrentPose(): boolean {
    if (this.started || this.root.position.distanceToSquared(this.startPosition) > 1e-8
      || this.root.quaternion.angleTo(this.startRotation) > 1e-4) return false;
    return this.snapshot.every(pose => pose.bone.position.distanceToSquared(pose.position) < 1e-6
      && pose.bone.quaternion.angleTo(pose.rotation) < .002);
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
    this.restorePose();
    const hold = this.mixer.clipAction(this.holdClip);
    hold.reset().setLoop(THREE.LoopOnce, 1);
    hold.clampWhenFinished = true;
    hold.play();
    const target = this.preparationSeconds > 0 ? this.mixer.clipAction(this.alignmentClip) : this.action;
    target.reset().setLoop(THREE.LoopOnce, 1);
    target.clampWhenFinished = true;
    target.setEffectiveTimeScale(this.preparationSeconds > 0 ? 0 : 1);
    target.play();
    target.crossFadeFrom(hold, this.preparationSeconds || GET_UP_BLEND_SECONDS, false);
    this.mixer.update(0);
  }

  update(delta: number): void {
    if (!this.started || this.isFinished) return;
    const step = Math.max(0, Math.min(0.05, delta));
    const before = this.elapsed;
    this.elapsed = Math.min(this.duration, this.elapsed + step);
    if (before < this.preparationSeconds && this.elapsed >= this.preparationSeconds) {
      this.mixer.update(this.preparationSeconds - before);
      this.mixer.clipAction(this.alignmentClip).stop();
      this.mixer.clipAction(this.holdClip).stop();
      this.action.reset().setLoop(THREE.LoopOnce, 1).setEffectiveTimeScale(1).play();
      this.action.clampWhenFinished = true;
      this.mixer.update(this.elapsed - this.preparationSeconds);
    } else this.mixer.update(step);
    const t = THREE.MathUtils.smoothstep(
      this.elapsed, 0, this.preparationSeconds || GET_UP_BLEND_SECONDS,
    );
    this.root.position.copy(this.startPosition).lerp(this.targetPosition, t);
    // Grounding a prone mesh adds a small root offset. Release that offset
    // while settling upright so the standing capsule handoff cannot drop the
    // whole character abruptly on the last frame.
    const standBlend = THREE.MathUtils.smoothstep(this.elapsed,
      Math.max(GET_UP_BLEND_SECONDS, this.duration - GET_UP_SETTLE_SECONDS), this.duration);
    if (!this.options.holdFinalPose) this.root.position.y = THREE.MathUtils.lerp(this.root.position.y, this.standingPosition.y - 0.865, standBlend);
    this.root.quaternion.copy(this.startRotation).slerp(this.targetRotation, t);
    if (this.preparationSeconds > 0 && this.elapsed <= this.preparationSeconds) this.supportPreparationPose(step);
    if (this.options.rootMotion) {
      this.options.rootMotion.sample(Math.max(0, this.elapsed - this.preparationSeconds), false, this.rootOffset)
        .applyQuaternion(this.targetRotation);
      this.root.position.add(this.rootOffset);
    }
    this.character.updateMatrixWorld(true);
  }

  get progress(): number { return getUpProgress(this.elapsed, this.duration); }
  get isFinished(): boolean { return this.started && this.elapsed >= this.duration - 1e-4; }
  get isHolding(): boolean { return this.options.holdFinalPose === true && this.isFinished; }
  get animationTime(): number { return Math.max(0, this.elapsed - this.preparationSeconds); }

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

  getPelvisPose(position = new THREE.Vector3(), rotation = new THREE.Quaternion()): { position: THREE.Vector3; rotation: THREE.Quaternion } {
    this.hips.updateWorldMatrix(true, false);
    return { position: this.hips.getWorldPosition(position), rotation: this.hips.getWorldQuaternion(rotation) };
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
    const p = bone.position;
    tracks.push(new THREE.VectorKeyframeTrack(`${bone.name}.position`, [0, 1], [
      p.x, p.y, p.z, p.x, p.y, p.z,
    ]));
  });
  return new THREE.AnimationClip(name, 1, tracks);
};

/** Reapply a captured single pose after disposing a mixer. New position
 * bindings must save the standing pose as their original state, otherwise a
 * fading hold with a rotation-only idle blends back toward the ragdoll. */
export const applyCapturedGetUpPose = (character: THREE.Group, pose: THREE.AnimationClip): void => {
  const tracks = new Map(pose.tracks.map(track => [track.name, track]));
  character.traverse(object => {
    const bone = object as THREE.Bone;
    if (!bone.isBone) return;
    const q = tracks.get(`${bone.name}.quaternion`), p = tracks.get(`${bone.name}.position`);
    if (q) bone.quaternion.fromArray(q.values).normalize();
    if (p) bone.position.fromArray(p.values);
  });
  character.updateMatrixWorld(true);
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
