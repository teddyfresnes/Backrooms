import * as THREE from 'three';
import { COMPASS_NEEDLE, createCompassModel, disposeObjectTree } from './CompassModel';
import { SeededRandom } from '../world/SeededRandom';

/** World direction the needle settles on ("north"): toward the street side of the building. */
const NORTH = new THREE.Vector3(0, 0, -1);
const TWO_PI = Math.PI * 2;
const wrap = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

/**
 * Damped magnetic needle. Calm, it swings and settles on north as the case
 * turns. Near the creature it loses north: it spins, kicks back and forth
 * and trembles on its jewel.
 */
export class CompassNeedle {
  angle = 0;
  velocity = 0;
  private time = 0;
  private readonly random = new SeededRandom('compass').fork('needle');
  private kick = 0;
  private kickTimer = 0;

  /** `target` is north in the case frame; `danger` is 0 (calm) .. 1 (on top of it). */
  step(delta: number, target: number, danger: number): number {
    const dt = Math.min(0.05, Math.max(0, delta));
    if (dt === 0) return this.angle;
    this.time += dt;
    const panic = THREE.MathUtils.clamp(danger, 0, 1);
    // The pull toward north fades as the field is overwhelmed.
    const stiffness = 38 * (1 - 0.9 * panic), damping = 3.4 + 2 * (1 - panic);
    let acceleration = stiffness * wrap(target - this.angle) - damping * this.velocity;
    if (panic > 0) {
      // A spinning drive plus erratic reversals, stronger the closer it is.
      this.kickTimer -= dt;
      if (this.kickTimer <= 0) {
        this.kickTimer = THREE.MathUtils.lerp(0.6, 0.08, panic) * this.random.float(0.5, 1.4);
        this.kick = this.random.float(-1, 1) * 260 * panic;
      }
      acceleration += this.kick + Math.sin(this.time * 21) * 90 * panic + 70 * panic * panic;
    }
    this.velocity = THREE.MathUtils.clamp(this.velocity + acceleration * dt, -40, 40);
    this.angle = (this.angle + this.velocity * dt) % TWO_PI;
    return this.angle;
  }
}

/** The compass Chloé left at the door: held in the right palm when selected. */
export class Compass {
  readonly model = createCompassModel();
  private readonly needle: THREE.Object3D;
  private readonly physics = new CompassNeedle();
  private readonly inverse = new THREE.Quaternion();
  private readonly local = new THREE.Vector3();
  private readonly shake = new THREE.Euler();
  private readonly shakeQuaternion = new THREE.Quaternion();
  private readonly fallback = new THREE.Vector3();
  private readonly fallbackRotation = new THREE.Quaternion();
  private readonly tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.95);
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.needle = this.model.getObjectByName(COMPASS_NEEDLE)!;
    this.model.visible = false;
    scene.add(this.model);
  }

  /**
   * `palm` gives the holding hand's palm frame (position and a rotation whose
   * +Y is the palm normal and -Z the fingers); without a rig the compass sits
   * low in the view.
   */
  update(camera: THREE.Camera, palm: { position: THREE.Vector3; quaternion: THREE.Quaternion } | undefined, visible: boolean, danger: number, delta: number): void {
    this.model.visible = visible;
    if (!visible) return;
    this.time += delta;
    if (palm) {
      this.model.position.copy(palm.position);
      this.model.quaternion.copy(palm.quaternion);
    } else {
      this.fallback.set(0.11, -0.2, -0.32).applyMatrix4(camera.matrixWorld);
      camera.getWorldQuaternion(this.fallbackRotation).multiply(this.tilt);
      this.model.position.copy(this.fallback);
      this.model.quaternion.copy(this.fallbackRotation);
    }
    if (danger > 0.05) {
      // The whole case buzzes a little in the hand.
      const amount = danger * danger * 0.05;
      this.shake.set(Math.sin(this.time * 47) * amount, 0, Math.cos(this.time * 39) * amount);
      this.model.quaternion.multiply(this.shakeQuaternion.setFromEuler(this.shake));
    }
    this.model.updateMatrixWorld(true);
    // North in the case frame, projected on the dial plane.
    this.inverse.copy(this.model.quaternion).invert();
    this.local.copy(NORTH).applyQuaternion(this.inverse);
    const flat = Math.hypot(this.local.x, this.local.z);
    // Held on edge, the needle has no meaningful north: it keeps its momentum.
    const target = flat > 0.2 ? Math.atan2(-this.local.x, -this.local.z) : this.physics.angle;
    this.needle.rotation.y = this.physics.step(delta, target, danger);
    this.needle.position.y = 0.0028 + (danger > 0.05 ? Math.sin(this.time * 63) * 0.00025 * danger : 0);
  }

  dispose(): void {
    this.model.removeFromParent();
    disposeObjectTree(this.model);
  }
}
