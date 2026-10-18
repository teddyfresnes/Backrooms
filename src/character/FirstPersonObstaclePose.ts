import * as THREE from 'three';
import type { CharacterEnvironment, EnvironmentSphereHit } from './CharacterEnvironment';
import type { CombatLimb } from './CombatPushMotion';
import { solveCombatTwoBone } from './CombatRig';

const SKIN = .012;
const UPPER_RADIUS = .085;
const FOREARM_RADIUS = .065;

class ArmContact {
  hand?: THREE.Bone;
  readonly fingers: THREE.Bone[] = [];
  readonly offset = new THREE.Vector3();
  readonly previous = new THREE.Vector3();
  ready = false;
  bind(hand: THREE.Bone): void {
    if (this.hand === hand) return;
    this.hand = hand; this.fingers.length = 0;
    hand.traverse(object => { if ((object as THREE.Bone).isBone) this.fingers.push(object as THREE.Bone); });
    this.reset();
  }
  reset(): void { this.ready = false; this.offset.set(0, 0, 0); }
}

/** Final presentation-only correction. The world rig, eye, pelvis and feet are
 * untouched; the two arms fold against real collision volumes instead of being
 * drawn through them. All probes use the same mounted world as the player.
 */
export class FirstPersonObstaclePose {
  private readonly arms = [new ArmContact(), new ArmContact()];
  private readonly eye = new THREE.Vector3();
  private readonly previousEye = new THREE.Vector3();
  private readonly origin = new THREE.Vector3();
  private readonly shoulder = new THREE.Vector3();
  private readonly elbow = new THREE.Vector3();
  private readonly wrist = new THREE.Vector3();
  private readonly center = new THREE.Vector3();
  private readonly authoredCenter = new THREE.Vector3();
  private readonly handOffset = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly wristTarget = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly normalInPlane = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly parentRotation = new THREE.Quaternion();
  private readonly bounds = new THREE.Box3();
  private readonly hit: EnvironmentSphereHit = { center: new THREE.Vector3(), normal: new THREE.Vector3() };

  reset(): void { for (const arm of this.arms) arm.reset(); }

  private sampleHand(arm: ArmContact): number {
    this.bounds.makeEmpty();
    for (const bone of arm.fingers) this.bounds.expandByPoint(this.point.setFromMatrixPosition(bone.matrixWorld));
    this.bounds.getCenter(this.center);
    let radiusSq = 0;
    for (const bone of arm.fingers)
      radiusSq = Math.max(radiusSq, this.point.setFromMatrixPosition(bone.matrixWorld).distanceToSquared(this.center));
    // Finger joints follow both an open palm and a closed fist; include the skin
    // beyond the last phalanx rather than checking the wrist as a single point.
    return Math.max(.065, Math.sqrt(radiusSq) + .026);
  }

  private constrain(environment: CharacterEnvironment, from: THREE.Vector3, target: THREE.Vector3, radius: number): boolean {
    if (!environment.sweepSphere(from, target, radius + SKIN, this.hit)) return false;
    target.copy(this.hit.center).addScaledVector(this.hit.normal, .004);
    return true;
  }

  /** Nearest feasible bend on the two-link elbow circle. A side wall should tuck
   * the elbow inward, not flip it or roll the wrist along with the upper arm.
   */
  private constrainElbow(lengthA: number, lengthB: number): void {
    this.axis.copy(this.wristTarget).sub(this.shoulder);
    const reach = THREE.MathUtils.clamp(this.axis.length(), Math.abs(lengthA - lengthB) + .035, (lengthA + lengthB) * .975);
    this.axis.normalize();
    const along = (lengthA * lengthA + reach * reach - lengthB * lengthB) / (2 * reach);
    const height = Math.sqrt(Math.max(0, lengthA * lengthA - along * along));
    this.point.copy(this.shoulder).addScaledVector(this.axis, along);
    this.normalInPlane.copy(this.hit.normal).addScaledVector(this.axis, -this.hit.normal.dot(this.axis));
    const span = this.normalInPlane.length();
    const deficit = this.hit.normal.dot(this.hit.center) + .004 - this.hit.normal.dot(this.point);
    if (height * span < 1e-6 || deficit >= height * span * .99) {
      // A nearly straight arm has no remaining bend corridor. Retract the wrist
      // into the free half-space and give the next solve room to bend.
      this.wristTarget.addScaledVector(this.hit.normal, Math.max(.015, deficit - height * span + .02));
      return;
    }
    this.normalInPlane.divideScalar(span);
    this.pole.addScaledVector(this.axis, -this.pole.dot(this.axis)).normalize();
    const component = Math.max(-1, deficit / (height * span));
    if (this.pole.dot(this.normalInPlane) >= component) return;
    this.tangent.copy(this.axis).cross(this.normalInPlane).normalize();
    if (this.tangent.dot(this.pole) < 0) this.tangent.negate();
    this.pole.copy(this.normalInPlane).multiplyScalar(component)
      .addScaledVector(this.tangent, Math.sqrt(Math.max(0, 1 - component * component)));
  }

  apply(camera: THREE.Camera, chains: readonly CombatLimb[], environment: CharacterEnvironment, delta: number): void {
    camera.getWorldPosition(this.eye);
    if (this.eye.distanceToSquared(this.previousEye) > .64) this.reset();
    this.previousEye.copy(this.eye);
    for (let i = 0; i < Math.min(chains.length, this.arms.length); i++) {
      const [upper, lower, hand] = chains[i]!, arm = this.arms[i]!;
      if (!upper?.parent || !lower || !hand?.parent) { arm.reset(); continue; }
      arm.bind(hand);
      upper.updateWorldMatrix(true, true);
      this.shoulder.setFromMatrixPosition(upper.matrixWorld);
      this.origin.copy(this.eye); this.origin.y = this.shoulder.y;
      // Near a side wall, tuck the presentation shoulder by the few centimetres
      // that its skin extends beyond the capsule. Do not translate the chest.
      this.target.copy(this.shoulder);
      const shoulderBlocked = this.constrain(environment, this.origin, this.target, UPPER_RADIUS);
      if (shoulderBlocked) {
        upper.position.copy(upper.parent.worldToLocal(this.target));
        upper.updateWorldMatrix(false, true);
        this.shoulder.setFromMatrixPosition(upper.matrixWorld);
      }
      this.elbow.setFromMatrixPosition(lower.matrixWorld);
      this.wrist.setFromMatrixPosition(hand.matrixWorld);
      const lengthA = this.shoulder.distanceTo(this.elbow), lengthB = this.elbow.distanceTo(this.wrist);
      const radius = this.sampleHand(arm);
      this.authoredCenter.copy(this.center); this.handOffset.copy(this.center).sub(this.wrist);
      this.target.copy(this.center);
      let blocked = this.constrain(environment, this.origin, this.target, radius);
      if (arm.ready && environment.sweepSphere(arm.previous, this.target, radius + SKIN, this.hit)) {
        this.target.copy(this.hit.center).addScaledVector(this.hit.normal, .004); blocked = true;
      }
      if (blocked) arm.offset.copy(this.target).sub(this.authoredCenter);
      else arm.offset.multiplyScalar(Math.exp(-14 * Math.max(0, delta)));
      this.target.copy(this.authoredCenter).add(arm.offset);
      blocked = this.constrain(environment, this.origin, this.target, radius) || blocked;
      this.wristTarget.copy(this.target).sub(this.handOffset);
      this.pole.copy(this.elbow).sub(this.shoulder);
      const elbowBlocked = environment.sweepSphere(this.origin, this.elbow, UPPER_RADIUS + SKIN, this.hit)
        || environment.sweepSphere(this.shoulder, this.elbow, UPPER_RADIUS + SKIN, this.hit);
      if (elbowBlocked) this.constrainElbow(lengthA, lengthB);
      if (environment.sweepSphere(this.elbow, this.target, FOREARM_RADIUS + SKIN, this.hit)) {
        const deficit = this.hit.normal.dot(this.hit.center) + radius - FOREARM_RADIUS + .004
          - this.hit.normal.dot(this.target);
        if (deficit > 0) this.target.addScaledVector(this.hit.normal, deficit);
        this.wristTarget.copy(this.target).sub(this.handOffset); blocked = true;
      }
      if (blocked || shoulderBlocked || elbowBlocked || arm.offset.lengthSq() > 1e-8) {
        hand.getWorldQuaternion(this.rotation);
        // A fixed iteration cap bounds the work even in corners. Most contacts
        // need one solve; clear space does not run IK at all.
        for (let iteration = 0; iteration < 4; iteration++) {
          solveCombatTwoBone(upper, lower, hand, this.wristTarget, 1, this.pole, .975, Math.PI / 4);
          hand.parent.getWorldQuaternion(this.parentRotation);
          hand.quaternion.copy(this.parentRotation.invert().multiply(this.rotation)).normalize();
          hand.updateWorldMatrix(false, true);
          this.elbow.setFromMatrixPosition(lower.matrixWorld);
          this.wrist.setFromMatrixPosition(hand.matrixWorld);
          this.center.copy(this.wrist).add(this.handOffset);
          this.target.copy(this.center);
          let retry = this.constrain(environment, this.origin, this.target, radius);
          if (environment.sweepSphere(this.elbow, this.target, FOREARM_RADIUS + SKIN, this.hit)) {
            const deficit = this.hit.normal.dot(this.hit.center) + radius - FOREARM_RADIUS + .004
              - this.hit.normal.dot(this.target);
            if (deficit > 0) this.target.addScaledVector(this.hit.normal, deficit);
            retry = true;
          }
          this.wristTarget.copy(this.target).sub(this.handOffset);
          if (environment.sweepSphere(this.shoulder, this.elbow, UPPER_RADIUS + SKIN, this.hit)) {
            this.constrainElbow(lengthA, lengthB); retry = true;
          }
          if (!retry) break;
        }
        this.center.setFromMatrixPosition(hand.matrixWorld).add(this.handOffset);
        arm.offset.copy(this.center).sub(this.authoredCenter);
      }
      arm.previous.copy(this.center); arm.ready = true;
    }
  }
}
