import * as THREE from 'three';
import { easeCombat, solveCombatTwoBone } from './CombatRig';
import { combatStrikeReachEnvelope } from './CombatAnimationLayers';

export type CombatLimb = readonly [THREE.Bone | undefined, THREE.Bone | undefined, THREE.Bone | undefined];

/** Weight travels over the feet, for either actor; the capsule keeps its momentum. */
export function transferCombatStance(
  hips: THREE.Bone | undefined, legs: readonly CombatLimb[], forward: THREE.Vector3,
  commitment: number, load: number,
): void {
  if (!hips?.parent) return;
  const feet = legs.filter((chain): chain is readonly [THREE.Bone, THREE.Bone, THREE.Bone] => chain.every(Boolean))
    .map(chain => ({ chain, point: chain[2].getWorldPosition(new THREE.Vector3()),
      rotation: chain[2].getWorldQuaternion(new THREE.Quaternion()) }));
  const pelvis = hips.getWorldPosition(new THREE.Vector3()).addScaledVector(forward, commitment);
  pelvis.y -= 0.028 * load;
  hips.position.copy(hips.parent.worldToLocal(pelvis));
  hips.updateWorldMatrix(false, true);
  const weight = easeCombat(THREE.MathUtils.clamp((Math.abs(commitment) + 0.028 * load) / 0.025, 0, 1));
  for (const { chain, point, rotation } of feet) {
    solveCombatTwoBone(...chain, point, weight, undefined, 0.997, THREE.MathUtils.degToRad(12));
    chain[2].quaternion.copy(chain[2].parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation)).normalize();
  }
}

/** The push starts from guard, not from a repurposed circular hook. */
export function createCombatPushClip(fight: THREE.AnimationClip, name: string): THREE.AnimationClip {
  const chest = fight.tracks.find(track => /spine2\.quaternion$/i.test(track.name));
  if (!chest) throw new Error('A chest track is required for the close push.');
  const clip = new THREE.AnimationClip(name, 1, [
    new THREE.QuaternionKeyframeTrack(chest.name, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
  ]);
  clip.blendMode = THREE.AdditiveAnimationBlendMode;
  return clip;
}

/** Both palms load against the chest, extend, then return to the existing guard. */
export function applyCombatPushPose(
  arms: readonly CombatLimb[], chest: THREE.Vector3, forward: THREE.Vector3,
  phase: number, impact: number, lead: 'left' | 'right',
): void {
  const right = arms[1]?.[0]?.getWorldPosition(new THREE.Vector3())
    .sub(arms[0]?.[0]?.getWorldPosition(new THREE.Vector3()) ?? chest) ?? new THREE.Vector3(-forward.z, 0, forward.x);
  right.y = 0; right.normalize();
  for (let i = 0; i < arms.length; i++) {
    const [upper, forearm, hand] = arms[i]!;
    if (!upper || !forearm || !hand) continue;
    const delayed = (i === 0 ? 'left' : 'right') === lead ? phase : phase - 0.012;
    const reach = combatStrikeReachEnvelope(delayed, false, impact);
    const target = chest.clone().addScaledVector(right, i === 0 ? -0.105 : 0.105)
      .addScaledVector(forward, 0.045);
    target.y -= 0.015;
    const palm = hand.children.find(child => /middle1$/i.test(child.name));
    const offset = palm ? palm.getWorldPosition(new THREE.Vector3()).sub(hand.getWorldPosition(new THREE.Vector3())) : new THREE.Vector3();
    solveCombatTwoBone(upper, forearm, hand, target.sub(offset), reach, undefined, 0.975, Math.PI / 2);
    // Open fingers gradually. Never roll the wrist toward a new Euler heading.
    hand.traverse(object => {
      if ((object as THREE.Bone).isBone && /hand(?:index|middle|ring|pinky)[123]$/i.test(object.name)) {
        object.quaternion.slerp(new THREE.Quaternion(), reach * 0.88).normalize();
      }
    });
  }
}
