import RAPIER from '@dimforge/rapier3d';
import * as THREE from 'three';

export interface GroundKickVolume {
  readonly id: number;
  readonly shape: RAPIER.Shape;
  readonly position: THREE.Vector3;
  readonly rotation: THREE.Quaternion;
}

/** Sweep the visible boot against articulated colliders, including body movement.
 * Rotation is subdivided; discontinuous teleports and withdrawing boots cannot hit. */
export function sweepGroundKickVolumes(
  before: THREE.Vector3, now: THREE.Vector3,
  previous: readonly GroundKickVolume[], current: readonly GroundKickVolume[],
  radius: number, delta: number, phaseBefore: number, phaseNow: number,
  activeStart: number, activeEnd: number,
): { point: THREE.Vector3; fraction: number } | null {
  if (delta <= 0 || delta > 0.12 || phaseNow <= phaseBefore
    || ![...before, ...now, radius, delta, phaseBefore, phaseNow].every(Number.isFinite)) return null;
  const lo = Math.max(0, (activeStart - phaseBefore) / (phaseNow - phaseBefore));
  const hi = Math.min(1, (activeEnd - phaseBefore) / (phaseNow - phaseBefore));
  if (lo > hi) return null;
  const velocity = now.clone().sub(before).divideScalar(delta);
  if (velocity.length() < 0.35 || velocity.length() > 22) return null;
  const boot = new RAPIER.Ball(radius), identity = { x: 0, y: 0, z: 0, w: 1 };
  const old = new Map(previous.map(volume => [volume.id, volume]));
  let result: { point: THREE.Vector3; fraction: number } | null = null;
  for (const volume of current) {
    const start = old.get(volume.id);
    if (!start) continue;
    const motion = volume.position.clone().sub(start.position);
    if (motion.length() / delta > 22) continue;
    const bodyVelocity = motion.clone().divideScalar(delta);
    const relativeVelocity = velocity.clone().sub(bodyVelocity);
    const steps = Math.max(1, Math.ceil(start.rotation.angleTo(volume.rotation) / THREE.MathUtils.degToRad(8)));
    for (let i = 0; i < steps; i++) {
      const a = Math.max(lo, i / steps), b = Math.min(hi, (i + 1) / steps);
      if (a > b || (result && a >= result.fraction)) continue;
      const position = start.position.clone().lerp(volume.position, a);
      const rotation = start.rotation.clone().slerp(volume.rotation, (a + b) / 2);
      const foot = before.clone().lerp(now, a);
      const cast = volume.shape.castShape(position, rotation, bodyVelocity,
        boot, foot, identity, velocity, 0, (b - a) * delta, false);
      if (!cast) continue;
      const fraction = a + cast.time_of_impact / delta;
      if (fraction > b + 1e-6 || (result && fraction >= result.fraction)) continue;
      const at = before.clone().lerp(now, fraction);
      const atBody = start.position.clone().lerp(volume.position, fraction);
      const contact = volume.shape.contactShape(atBody, rotation, boot, at, identity, 0.004);
      if (!contact || relativeVelocity.dot(new THREE.Vector3().copy(contact.normal1)) >= -0.10) continue;
      result = { point: new THREE.Vector3().copy(contact.point1), fraction };
    }
  }
  return result;
}
