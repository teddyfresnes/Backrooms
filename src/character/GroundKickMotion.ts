import * as THREE from 'three';
import { easeCombat } from './CombatRig';
import type { GroundKickKind, GroundKickPose } from './GroundKickRules';

interface GroundKickFlight {
  readonly point: THREE.Vector3;
  readonly anklePitch: number;
  readonly footAlignment: number;
}

const boundFollowThrough = (carry: THREE.Vector3, maximum: number): THREE.Vector3 => {
  const distance = carry.length();
  if (distance > 1e-8) carry.multiplyScalar(maximum * (1 - Math.exp(-distance / maximum)) / distance);
  return carry;
};

/** A loaded knee, accelerating boot, short deceleration and lifted withdrawal.
 * The miss trajectory continues through contact; only a physical hit arrests it.
 * All coordinates are world-space, independent of the FBX joint axes. */
export function sampleGroundKickFlight(
  kind: GroundKickKind, phase: number, pose: GroundKickPose,
  start: Readonly<THREE.Vector3>, landing: Readonly<THREE.Vector3>,
  hipHeight: number, forward: Readonly<THREE.Vector3>,
): GroundKickFlight {
  const t = THREE.MathUtils.clamp(phase, 0, 1);
  const point = new THREE.Vector3();
  const chamber = new THREE.Vector3().copy(start);
  const driveStart = kind === 'stomp' ? .43 : kind === 'soccer-kick' ? .38 : .32;
  const driveEnd = kind === 'stomp' ? .58 : kind === 'soccer-kick' ? .62 : .53;
  const withdrawal = kind === 'get-up-kick' ? .60 : .68;
  const through = new THREE.Vector3().copy(landing);
  if (kind === 'soccer-kick') {
    chamber.addScaledVector(forward, -.12);
    chamber.y = Math.max(start.y + .14, landing.y + .06);
    through.addScaledVector(forward, .10);
  } else {
    chamber.lerp(landing, kind === 'stomp' ? 1 : .65);
    chamber.y = Math.min(hipHeight - .14,
      Math.max(start.y + (kind === 'stomp' ? .50 : .38), landing.y + (kind === 'stomp' ? .38 : .24)));
  }
  if (t < driveStart) {
    const lift = kind === 'get-up-kick' ? easeCombat(t / driveStart)
      : easeCombat((t - .12) / (driveStart - .12));
    point.lerpVectors(start, chamber, lift);
    if (kind === 'get-up-kick') point.y += Math.sin(Math.PI * lift) * .06;
  } else if (t < driveEnd) {
    const drive = (t - driveStart) / (driveEnd - driveStart);
    point.lerpVectors(chamber, through, kind === 'get-up-kick' ? easeCombat(drive) : drive * drive);
    if (kind === 'soccer-kick') point.y += Math.sin(Math.PI * drive * drive) * .025;
  } else if (t < withdrawal) {
    // Continue with the incoming velocity, then decelerate continuously. An
    // instantaneous stop at the authored impact frame made a whiff robotic.
    const u = (t - driveEnd) / (withdrawal - driveEnd);
    const velocity = kind === 'get-up-kick' ? 0 : 2 / (driveEnd - driveStart);
    const carry = new THREE.Vector3().copy(through).sub(chamber)
      .multiplyScalar(velocity * (withdrawal - driveEnd) * (u - u * u + u * u * u / 3));
    boundFollowThrough(carry, kind === 'stomp' ? .06 : .08);
    point.copy(through).add(carry);
  } else {
    const velocity = kind === 'get-up-kick' ? 0 : 2 / (driveEnd - driveStart);
    const carry = new THREE.Vector3().copy(through).sub(chamber)
      .multiplyScalar(velocity * (withdrawal - driveEnd) / 3);
    boundFollowThrough(carry, kind === 'stomp' ? .06 : .08);
    const recovery = easeCombat((t - withdrawal) / (.98 - withdrawal));
    point.copy(through).add(carry).lerp(new THREE.Vector3().copy(start), recovery);
    // Retract the knee before placing the heel. A lifted arc clears the body
    // instead of sliding the boot backwards through it in a straight line.
    point.y += Math.sin(Math.PI * recovery) * (kind === 'stomp' ? .18 : .15);
  }
  const retract = easeCombat((t - withdrawal) / (.96 - withdrawal));
  const pitch = kind === 'stomp' ? -10 * pose.chamber - 9 * Math.sin(Math.PI * retract)
    : kind === 'soccer-kick' ? 13 * pose.chamber + 18 * pose.drive - 7 * Math.sin(Math.PI * retract)
      : -8 * pose.chamber - 10 * pose.drive;
  return { point, anklePitch: THREE.MathUtils.degToRad(pitch),
    footAlignment: easeCombat((t - .10) / .26) };
}

/** Calibrated neutral shoe frame, not the captured sideways fighting stance.
 * Turn the boot while lifting, keep its sole/instep aligned with the knee, and
 * let the animation blend restore the resting foot only during placement. */
export function groundKickFootRotation(
  neutral: Readonly<THREE.Quaternion>, captured: Readonly<THREE.Quaternion>,
  yaw: number, side: 'left' | 'right', pitch: number, alignment: number,
): THREE.Quaternion {
  const out = (side === 'left' ? -1 : 1) * THREE.MathUtils.degToRad(4);
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const aim = new THREE.Quaternion().copy(neutral)
    .premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + out))
    .premultiply(new THREE.Quaternion().setFromAxisAngle(right, pitch));
  return new THREE.Quaternion().copy(captured).slerp(aim, alignment).normalize();
}
