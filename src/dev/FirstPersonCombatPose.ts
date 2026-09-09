import * as THREE from 'three';
import { solveCombatTwoBone } from './CombatRig';
import type { CombatLimb } from './CombatPushMotion';

/** The eyes may move freely; a raised guard follows only part of that motion. */
export class FirstPersonCombatPose {
  private pitch = 0;

  applyGuard(camera: THREE.Camera, arms: readonly CombatLimb[], weights: readonly number[], delta: number): void {
    const rotation = camera.getWorldQuaternion(new THREE.Quaternion());
    const look = new THREE.Euler().setFromQuaternion(rotation, 'YXZ');
    const wantedPitch = THREE.MathUtils.clamp(look.x * 0.62, -0.78, 0.65);
    this.pitch = THREE.MathUtils.lerp(this.pitch, wantedPitch, 1 - Math.exp(-14 * Math.max(0, delta)));
    const horizontal = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, look.y, 0, 'YXZ'));
    const frame = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, look.y, 0, 'YXZ'));
    const wristPitch = frame.clone().multiply(horizontal.clone().invert());
    const eye = camera.getWorldPosition(new THREE.Vector3());
    for (let i = 0; i < arms.length; i++) {
      const [upper, forearm, hand] = arms[i]!;
      const weight = THREE.MathUtils.clamp(weights[i] ?? 0, 0, 1);
      if (!upper || !forearm || !hand?.parent || weight < 1e-6) continue;
      const side = i === 0 ? -1 : 1;
      const target = new THREE.Vector3(side * 0.255, -0.225 - (i === 1 ? 0.025 : 0), -0.43 - (i === 0 ? 0.025 : 0))
        .applyQuaternion(frame).add(eye);
      // A fixed outward/downward elbow pole cannot flip as the gaze crosses
      // the forearm axis. The wrist rotates with the guard, never with an Euler
      // roll copied from the IK elbow.
      const pole = new THREE.Vector3(side * 0.55, -0.85, 0.08).applyQuaternion(horizontal);
      const authored = hand.getWorldQuaternion(new THREE.Quaternion());
      const wrist = authored.clone().slerp(wristPitch.clone().multiply(authored), weight);
      solveCombatTwoBone(upper, forearm, hand, target, weight, pole, 0.96, THREE.MathUtils.degToRad(45));
      hand.quaternion.copy(hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(wrist)).normalize();
      hand.updateWorldMatrix(false, true);
    }
  }
}

/** Move only the hidden chest/arm parent; feet and pelvis keep their world pose. */
export function offsetFirstPersonUpperBody(spine: THREE.Bone | undefined, offset: THREE.Vector3): void {
  if (!spine?.parent || offset.lengthSq() < 1e-10) return;
  const point = spine.getWorldPosition(new THREE.Vector3()).add(offset);
  spine.position.copy(spine.parent.worldToLocal(point));
  spine.updateWorldMatrix(false, true);
}
