import * as THREE from 'three';
import type { RagdollAnimationMotion } from '../physics/RagdollSystem';

export const easeCombat = (value: number): number => {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** AnimationMixer skips unchanged tracks. Restore the animation pose before
 * evaluating another frame so IK, look and impact offsets never feed back. */
export class CombatProceduralPose {
  private root?: THREE.Object3D;
  private bones: Array<{ bone: THREE.Bone; rotation: THREE.Quaternion; position: THREE.Vector3 }> = [];
  private captured = false;
  restore(enabled = true): void {
    if (this.captured && enabled) for (const pose of this.bones) {
      pose.bone.quaternion.copy(pose.rotation);
      pose.bone.position.copy(pose.position);
    }
    this.captured = false;
  }
  capture(root: THREE.Object3D | undefined): void {
    if (!root) return;
    if (root !== this.root) {
      this.root = root;
      this.bones = [];
      root.traverse(object => {
        if ((object as THREE.Bone).isBone) this.bones.push({ bone: object as THREE.Bone,
          rotation: new THREE.Quaternion(), position: new THREE.Vector3() });
      });
    }
    for (const pose of this.bones) {
      pose.rotation.copy(pose.bone.quaternion);
      pose.position.copy(pose.bone.position);
    }
    this.captured = true;
  }
}

const hingeNormals = new WeakMap<THREE.Bone, THREE.Vector3>();

function aimBone(bone: THREE.Bone, direction: THREE.Vector3, wanted: THREE.Vector3): void {
  if (direction.lengthSq() < 1e-10 || wanted.lengthSq() < 1e-10) return;
  const correction = new THREE.Quaternion().setFromUnitVectors(direction.normalize(), wanted.normalize());
  const world = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(correction);
  const parent = bone.parent?.getWorldQuaternion(new THREE.Quaternion()).invert() ?? new THREE.Quaternion();
  bone.quaternion.copy(parent.multiply(world)).normalize();
  bone.updateWorldMatrix(false, true);
}

/** Analytic two-link solve. Keeps the authored bend plane and never stretches a limb. */
export function solveCombatTwoBone(
  upper: THREE.Bone, lower: THREE.Bone, end: THREE.Bone,
  target: Readonly<THREE.Vector3>, weight: number, pole?: Readonly<THREE.Vector3>,
  maxReachFraction = 0.975,
  maxTwistRadians = Math.PI,
): void {
  const blend = THREE.MathUtils.clamp(weight, 0, 1);
  if (blend <= 1e-6 || !Number.isFinite(target.x + target.y + target.z)) return;
  upper.updateWorldMatrix(true, true);
  const a = upper.getWorldPosition(new THREE.Vector3());
  const b = lower.getWorldPosition(new THREE.Vector3());
  const c = end.getWorldPosition(new THREE.Vector3());
  const lengthA = a.distanceTo(b), lengthB = b.distanceTo(c);
  if (Math.min(lengthA, lengthB) < 1e-5) return;
  const upperBefore = upper.quaternion.clone(), lowerBefore = lower.quaternion.clone();
  const axis = new THREE.Vector3().copy(target).sub(a);
  if (axis.lengthSq() < 1e-9) return;
  const reach = THREE.MathUtils.clamp(axis.length(), Math.abs(lengthA - lengthB) + 0.035,
    (lengthA + lengthB) * THREE.MathUtils.clamp(maxReachFraction, 0.90, 0.999));
  axis.normalize();
  const bend = pole ? new THREE.Vector3().copy(pole) : b.clone().sub(a);
  bend.addScaledVector(axis, -bend.dot(axis));
  if (bend.lengthSq() < 1e-6) {
    bend.set(0, -1, 0).addScaledVector(axis, axis.y);
    if (bend.lengthSq() < 1e-6) bend.set(1, 0, 0).addScaledVector(axis, -axis.x);
  }
  bend.normalize();
  const along = (lengthA * lengthA + reach * reach - lengthB * lengthB) / (2 * reach);
  const height = Math.sqrt(Math.max(0, lengthA * lengthA - along * along));
  const elbow = a.clone().addScaledVector(axis, along).addScaledVector(bend, height);
  const tip = a.clone().addScaledVector(axis, reach);
  // Preserve the anatomical hinge plane, not just the joint positions. A swing
  // alone can reach the right point while rolling the thigh/elbow by 90 degrees.
  let localNormal = hingeNormals.get(upper);
  if (!localNormal) {
    const normal = b.clone().sub(a).cross(c.clone().sub(b));
    if (normal.lengthSq() < 1e-8) normal.copy(b).sub(a).cross(bend);
    localNormal = normal.normalize().applyQuaternion(upper.getWorldQuaternion(new THREE.Quaternion()).invert());
    hingeNormals.set(upper, localNormal);
  }
  aimBone(upper, b.clone().sub(a), elbow.clone().sub(a));
  const upperAxis = elbow.clone().sub(a).normalize();
  const desiredNormal = elbow.clone().sub(a).cross(tip.clone().sub(elbow)).normalize();
  const currentNormal = localNormal.clone().applyQuaternion(upper.getWorldQuaternion(new THREE.Quaternion()));
  currentNormal.addScaledVector(upperAxis, -currentNormal.dot(upperAxis)).normalize();
  const wantedTwist = Math.atan2(upperAxis.dot(currentNormal.clone().cross(desiredNormal)), currentNormal.dot(desiredNormal));
  // A support leg must retain the authored hip rotation, especially while
  // strafing. Forcing its entire hinge plane toward a new pole can twist the
  // thigh by 80 degrees and collapse the pelvis skin even with correct feet.
  // Arm/contact solves retain the full anatomical correction by default.
  const twist = THREE.MathUtils.clamp(wantedTwist, -Math.abs(maxTwistRadians), Math.abs(maxTwistRadians));
  const worldRotation = upper.getWorldQuaternion(new THREE.Quaternion())
    .premultiply(new THREE.Quaternion().setFromAxisAngle(upperAxis, twist));
  const parentRotation = upper.parent?.getWorldQuaternion(new THREE.Quaternion()).invert() ?? new THREE.Quaternion();
  upper.quaternion.copy(parentRotation.multiply(worldRotation)).normalize();
  upper.updateWorldMatrix(false, true);
  lower.getWorldPosition(b);
  end.getWorldPosition(c);
  aimBone(lower, c.sub(b), tip.sub(b));
  upper.quaternion.slerpQuaternions(upperBefore, upper.quaternion.clone(), blend).normalize();
  lower.quaternion.slerpQuaternions(lowerBefore, lower.quaternion.clone(), blend).normalize();
  upper.updateWorldMatrix(false, true);
}

/** Short pose handoff preserves the exact evaluated limbs when an action is interrupted. */
export class CombatPoseHandoff {
  private poses: Array<{
    bone: THREE.Bone; rotation: THREE.Quaternion; position: THREE.Vector3;
    targetPosition?: THREE.Vector3; appliedPosition?: THREE.Vector3;
  }> = [];
  private elapsed = 0;
  private duration = 0.09;
  capture(root: THREE.Object3D, duration = 0.09): void {
    this.poses = [];
    root.traverse(object => {
      if ((object as THREE.Bone).isBone) this.poses.push({ bone: object as THREE.Bone, rotation: object.quaternion.clone(), position: object.position.clone() });
    });
    this.elapsed = 0;
    this.duration = duration;
  }
  apply(delta: number): void {
    this.elapsed += Math.max(0, delta);
    const weight = easeCombat(this.elapsed / this.duration);
    for (const pose of this.poses) {
      pose.bone.quaternion.slerpQuaternions(pose.rotation, pose.bone.quaternion.clone(), weight).normalize();
      // Most in-place clips have no position channel. Do not mistake the
      // preceding blended position for a new animation target and retain drift.
      if (pose.targetPosition && pose.appliedPosition
        && pose.bone.position.distanceToSquared(pose.appliedPosition) < 1e-12) {
        pose.bone.position.copy(pose.targetPosition);
      }
      pose.targetPosition = pose.bone.position.clone();
      pose.bone.position.lerpVectors(pose.position, pose.targetPosition, weight);
      pose.appliedPosition = pose.bone.position.clone();
    }
    if (weight >= 1) this.poses = [];
  }
  reset(): void { this.poses = []; }
}

interface MotionPose { position: THREE.Vector3; rotation: THREE.Quaternion }
export class CombatMotionHistory {
  private previous = new Map<string, MotionPose>();
  private motion: RagdollAnimationMotion | undefined;
  capture(root: THREE.Object3D, delta: number): void {
    root.updateWorldMatrix(true, true);
    const next = new Map<string, MotionPose>();
    const bones: Record<string, { linearVelocity: THREE.Vector3; angularVelocity: THREE.Vector3 }> = {};
    root.traverse(object => {
      if (!(object as THREE.Bone).isBone) return;
      const name = object.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const pose = { position: object.getWorldPosition(new THREE.Vector3()), rotation: object.getWorldQuaternion(new THREE.Quaternion()) };
      const old = this.previous.get(name);
      next.set(name, pose);
      if (!old || delta <= 0 || delta > 0.12) return;
      const linearVelocity = pose.position.clone().sub(old.position).divideScalar(delta).clampLength(0, 12);
      const q = pose.rotation.clone().multiply(old.rotation.clone().invert()).normalize();
      if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      const sin = Math.hypot(q.x, q.y, q.z);
      const angularVelocity = new THREE.Vector3(q.x, q.y, q.z);
      if (sin > 1e-7) angularVelocity.multiplyScalar(2 * Math.atan2(sin, q.w) / (sin * delta)).clampLength(0, 16);
      bones[name] = { linearVelocity, angularVelocity };
    });
    this.previous = next;
    this.motion = Object.keys(bones).length ? { bones } : undefined;
  }
  getMotion(): RagdollAnimationMotion | undefined { return this.motion; }
  reset(): void { this.previous.clear(); this.motion = undefined; }
}
