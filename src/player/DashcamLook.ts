import * as THREE from 'three';

/** Presentation-only spring. Mouse intent, movement and saved aim stay exact;
 * a fast head turn carries the camera, then settles with a small overshoot. */
export class DashcamLook {
  private readonly angles = new THREE.Euler(0, 0, 0, 'YXZ');
  private yaw = 0;
  private pitch = 0;
  private yawSpeed = 0;
  private pitchSpeed = 0;
  private ready = false;
  roll = 0;

  reset(aim: THREE.Quaternion): void {
    this.angles.setFromQuaternion(aim, 'YXZ'); this.yaw = this.angles.y; this.pitch = this.angles.x;
    this.yawSpeed = this.pitchSpeed = this.roll = 0; this.ready = true;
  }

  sample(aim: THREE.Quaternion, delta: number, enabled: boolean, output: THREE.Quaternion): void {
    if (!enabled || !this.ready) this.reset(aim);
    if (!enabled || delta <= 0) { output.copy(aim); return; }
    this.angles.setFromQuaternion(aim, 'YXZ');
    const targetYaw = this.yaw + Math.atan2(Math.sin(this.angles.y - this.yaw), Math.cos(this.angles.y - this.yaw));
    const targetPitch = this.angles.x;
    this.yaw = THREE.MathUtils.clamp(this.yaw, targetYaw - .28, targetYaw + .28);
    this.pitch = THREE.MathUtils.clamp(this.pitch, targetPitch - .15, targetPitch + .15);
    const steps = Math.max(1, Math.ceil(Math.min(.1, delta) * 240));
    const dt = Math.min(.1, delta) / steps, frequency = 22, damping = .78;
    for (let step = 0; step < steps; step++) {
      this.yawSpeed += ((targetYaw - this.yaw) * frequency ** 2 - 2 * damping * frequency * this.yawSpeed) * dt;
      this.pitchSpeed += ((targetPitch - this.pitch) * frequency ** 2 - 2 * damping * frequency * this.pitchSpeed) * dt;
      this.yaw += this.yawSpeed * dt; this.pitch += this.pitchSpeed * dt;
    }
    this.roll = THREE.MathUtils.clamp(-this.yawSpeed * .013, -.065, .065);
    this.angles.set(THREE.MathUtils.clamp(this.pitch, -1.55, 1.55), this.yaw, 0, 'YXZ');
    output.setFromEuler(this.angles);
  }
}
