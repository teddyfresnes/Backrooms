import * as THREE from 'three';
import type { CharacterEnvironment, EnvironmentSphereHit } from './CharacterEnvironment';

/** A presentation constraint after all head offsets and smoothing. Its sphere
 * encloses the whole near plane, including wide aspect ratios. The physical
 * head remains the anchor; only the camera is corrected. */
export class EnvironmentCameraGuard {
  private ready = false;
  private readonly previous = new THREE.Vector3();
  private readonly anchor = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly from = new THREE.Vector3();
  private readonly remaining = new THREE.Vector3();
  private readonly hit: EnvironmentSphereHit = { center: new THREE.Vector3(), normal: new THREE.Vector3() };
  reset(): void { this.ready = false; }
  radius(camera: THREE.PerspectiveCamera): number {
    const height = camera.near * Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV()) / 2);
    return Math.hypot(camera.near, height, height * camera.aspect) + .006;
  }
  private sweep(environment: CharacterEnvironment, from: THREE.Vector3, target: THREE.Vector3, radius: number): void {
    this.from.copy(from);
    for (let i = 0; i < 3; i++) {
      if (!environment.sweepSphere(this.from, target, radius, this.hit)) return;
      this.remaining.copy(target).sub(this.hit.center);
      this.remaining.addScaledVector(this.hit.normal, -Math.min(0, this.remaining.dot(this.hit.normal)));
      this.from.copy(this.hit.center).addScaledVector(this.hit.normal, .003);
      target.copy(this.from).add(this.remaining);
      if (this.remaining.lengthSq() < 1e-8) return;
    }
    target.copy(this.from);
  }
  constrain(camera: THREE.PerspectiveCamera, headCenter: Readonly<THREE.Vector3>, environment: CharacterEnvironment): boolean {
    const radius = this.radius(camera);
    this.anchor.copy(headCenter);
    const anchorSafe = environment.resolveSphereOverlap(this.anchor, radius);
    if (!anchorSafe && this.ready && this.previous.distanceToSquared(headCenter) < .64) this.anchor.copy(this.previous);
    this.target.copy(camera.position);
    this.remaining.copy(this.target).sub(this.anchor).clampLength(0, .45);
    this.target.copy(this.anchor).add(this.remaining);
    this.sweep(environment, this.anchor, this.target, radius);
    if (this.ready) this.sweep(environment, this.previous, this.target, radius);
    if (!environment.resolveSphereOverlap(this.target, radius)) this.target.copy(this.anchor);
    const changed = this.target.distanceToSquared(camera.position) > 1e-8;
    camera.position.copy(this.target);
    this.previous.copy(this.target); this.ready = true;
    return changed;
  }
}
