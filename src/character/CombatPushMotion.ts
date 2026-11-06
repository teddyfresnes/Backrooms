import * as THREE from 'three';
import { easeCombat, solveCombatTwoBone } from './CombatRig';

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

/** A two-handed press has preparation, sustained extension and a full recovery. */
export function combatPushEnvelope(phase: number, impact = .40): { reach: number; load: number; open: number } {
  const t = THREE.MathUtils.clamp(phase, 0, 1);
  const beat = THREE.MathUtils.clamp(impact, .32, .48);
  const release = 1 - easeCombat(THREE.MathUtils.smoothstep(t, beat + .14, .94));
  const reach = easeCombat(THREE.MathUtils.smoothstep(t, .055, beat)) * release;
  const load = easeCombat(THREE.MathUtils.smoothstep(t, .025, beat - .16))
    * (1 - easeCombat(THREE.MathUtils.smoothstep(t, beat - .16, beat)));
  const open = easeCombat(THREE.MathUtils.smoothstep(t, .035, beat - .13)) * release;
  return { reach, load, open };
}

/** Bake an actual guard-to-push animation on the supplied rig, then adapt it to the live chest. */
export function createCombatPushClip(
  fight: THREE.AnimationClip, name: string, rig: THREE.Object3D, lead: 'left' | 'right' = 'left',
): THREE.AnimationClip {
  const reference = rig.clone(true), bones = new Map<string, THREE.Bone>();
  reference.traverse(object => { if ((object as THREE.Bone).isBone) bones.set(object.name, object as THREE.Bone); });
  for (const track of fight.tracks) {
    const bone = bones.get(track.name.replace(/\.quaternion$/, ''));
    if (bone && track instanceof THREE.QuaternionKeyframeTrack) {
      bone.quaternion.fromArray(new THREE.QuaternionLinearInterpolant(track.times, track.values, 4).evaluate(0)).normalize();
    }
  }
  const find = (suffix: string) => [...bones.values()].find(bone => bone.name.toLowerCase().endsWith(suffix));
  const hips = find('hips'), head = find('head');
  if (!hips || !head || !find('spine2')) throw new Error('The push needs the guard skeleton.');
  reference.updateWorldMatrix(true, true);
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(reference.getWorldQuaternion(new THREE.Quaternion()));
  forward.y = 0; forward.normalize();
  const right = new THREE.Vector3(forward.z, 0, -forward.x);
  const target = hips.getWorldPosition(new THREE.Vector3()).lerp(head.getWorldPosition(new THREE.Vector3()), .64)
    .addScaledVector(forward, .71);
  const original = [...bones.values()].map(bone => ({ bone, quaternion: bone.quaternion.clone() }));
  const animated = original.filter(({ bone }) => /(spine\d*|neck|(?:left|right)(?:shoulder|arm|forearm|hand(?:thumb|index|middle|ring|pinky)?\d*))$/i.test(bone.name));
  const values = new Map(animated.map(({ bone }) => [bone, [] as number[]]));
  const times: number[] = [];
  const offset = (bone: THREE.Bone | undefined, axis: THREE.Vector3, angle: number) => {
    if (!bone) return;
    const world = bone.getWorldQuaternion(new THREE.Quaternion())
      .premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world)).normalize();
    bone.updateWorldMatrix(false, true);
  };
  for (let i = 0; i <= 72; i++) {
    for (const pose of original) pose.bone.quaternion.copy(pose.quaternion);
    reference.updateWorldMatrix(true, true);
    const t = i / 72, { reach, load } = combatPushEnvelope(t);
    const pitch = THREE.MathUtils.degToRad(7 * reach - 3 * load);
    for (const [suffix, share] of [['spine', .22], ['spine1', .33], ['spine2', .45]] as const) {
      offset(find(suffix), right, pitch * share);
    }
    offset(find('neck'), right, -pitch * .72);
    offset(find('spine2'), new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(lead === 'left' ? -2 : 2) * load);
    applyCombatPushPose([
      [find('leftarm'), find('leftforearm'), find('lefthand')],
      [find('rightarm'), find('rightforearm'), find('righthand')],
    ], target, forward, t, .40, lead);
    times.push(t);
    for (const { bone, quaternion } of animated) {
      quaternion.clone().invert().multiply(bone.quaternion).normalize().toArray(values.get(bone)!, i * 4);
    }
  }
  const clip = new THREE.AnimationClip(name, 1, animated.map(({ bone }) =>
    new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values.get(bone)!)));
  clip.blendMode = THREE.AdditiveAnimationBlendMode;
  return clip;
}

/** Centre of the open palm, rather than the end of a clenched fist. */
export function sampleCombatPalm(hand: THREE.Bone, out = new THREE.Vector3()): THREE.Vector3 {
  hand.updateWorldMatrix(true, true);
  hand.getWorldPosition(out);
  const middle = hand.children.find(child => /middle1$/i.test(child.name));
  if (middle) out.lerp(middle.getWorldPosition(new THREE.Vector3()), .60);
  return out;
}

function facePalm(hand: THREE.Bone, forward: THREE.Vector3, side: number, weight: number): void {
  const middle = hand.children.find(child => /middle1$/i.test(child.name));
  const index = hand.children.find(child => /index1$/i.test(child.name));
  const pinky = hand.children.find(child => /pinky1$/i.test(child.name));
  if (!middle || !index || !pinky || weight <= 0) return;
  // Construct both frames from anatomical directions, never from Euler angles.
  const finger = middle.position.clone().normalize();
  const width = index.position.clone().sub(pinky.position);
  width.addScaledVector(finger, -width.dot(finger)).normalize();
  const normal = finger.clone().cross(width).multiplyScalar(side < 0 ? -1 : 1).normalize();
  const tangent = finger.clone().cross(normal).normalize();
  const local = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(tangent, finger, normal));
  const wantedNormal = forward.clone().normalize();
  const wantedFinger = new THREE.Vector3(0, 1, 0).addScaledVector(wantedNormal, -wantedNormal.y).normalize();
  const wantedTangent = wantedFinger.clone().cross(wantedNormal).normalize();
  const world = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(wantedTangent, wantedFinger, wantedNormal))
    .multiply(local.invert());
  const target = hand.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world).normalize();
  const angle = hand.quaternion.angleTo(target);
  hand.quaternion.slerp(target, weight * Math.min(1, THREE.MathUtils.degToRad(65) / Math.max(angle, 1e-6))).normalize();
  hand.updateWorldMatrix(false, true);
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
    const { reach, open } = combatPushEnvelope(delayed, impact);
    const target = chest.clone().addScaledVector(right, i === 0 ? -0.105 : 0.105)
      .addScaledVector(forward, -0.018 + .055 * reach);
    target.y -= 0.015;
    facePalm(hand, forward, i === 0 ? -1 : 1, open);
    const palmRotation = hand.getWorldQuaternion(new THREE.Quaternion());
    const offset = sampleCombatPalm(hand).sub(hand.getWorldPosition(new THREE.Vector3()));
    solveCombatTwoBone(upper, forearm, hand, target.sub(offset), reach, undefined, 0.975, Math.PI / 2);
    hand.quaternion.copy(hand.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(palmRotation)).normalize();
    hand.updateWorldMatrix(false, true);
    // Open fingers gradually. Never roll the wrist toward a new Euler heading.
    hand.traverse(object => {
      if ((object as THREE.Bone).isBone && /hand(?:index|middle|ring|pinky)[123]$/i.test(object.name)) {
        object.quaternion.slerp(new THREE.Quaternion(), open * 0.88).normalize();
      }
    });
  }
}
