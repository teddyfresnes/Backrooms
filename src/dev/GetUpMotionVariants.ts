import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createGetUpMotionClip } from './GetUpMotion';
import { easeCombat, solveCombatTwoBone } from './CombatRig';
import type { GetUpSide } from './GetUpRecoveryRules';
import type { GetUpSupportSide, GetUpVariantChoice } from './GetUpVariationRules';

export interface GetUpMotionVariant extends GetUpVariantChoice { clip: THREE.AnimationClip }

const sampler = (clip: THREE.AnimationClip) => new Map(clip.tracks.map(track => [track.name,
  track.name.endsWith('.quaternion')
    ? new THREE.QuaternionLinearInterpolant(track.times, track.values, 4)
    : new THREE.LinearInterpolant(track.times, track.values, track.getValueSize()),
]));
const bonesOf = (root: THREE.Object3D): THREE.Bone[] => {
  const bones: THREE.Bone[] = [];
  root.traverse(object => { if ((object as THREE.Bone).isBone) bones.push(object as THREE.Bone); });
  return bones;
};
const evaluate = (bones: THREE.Bone[], tracks: ReturnType<typeof sampler>, t: number): void => {
  for (const bone of bones) {
    const q = tracks.get(`${bone.name}.quaternion`), p = tracks.get(`${bone.name}.position`);
    if (q) bone.quaternion.fromArray(q.evaluate(t)).normalize();
    if (p) bone.position.fromArray(p.evaluate(t));
  }
};
const oppositeName = (name: string): string => /Left/.test(name)
  ? name.replace('Left', 'Right') : name.replace('Right', 'Left');

/** Reflect world motion relative to the neutral skeleton, then re-express it
 * in the opposite bone's axes. Swapping local quaternions would twist knees
 * and ankles because this FBX has different rest axes on the two sides. */
export const mirrorGetUpSource = (character: THREE.Group, source: THREE.AnimationClip): THREE.AnimationClip => {
  const rig = cloneSkeleton(character) as THREE.Group;
  const bones = bonesOf(rig), byName = new Map(bones.map(bone => [bone.name, bone]));
  rig.updateMatrixWorld(true);
  const rest = new Map(bones.map(bone => [bone, { q: bone.getWorldQuaternion(new THREE.Quaternion()), p: bone.position.clone() }]));
  const rootQ = rig.getWorldQuaternion(new THREE.Quaternion()), inverseRootQ = rootQ.clone().invert();
  const sourceSamples = sampler(source);
  const count = Math.ceil(source.duration * 30);
  const times = Array.from({ length: count + 1 }, (_, i) => source.duration * i / count);
  const values = new Map(bones.map(bone => [bone, { q: [] as number[], p: [] as number[], previous: new THREE.Quaternion() }]));
  for (const [i, t] of times.entries()) {
    evaluate(bones, sourceSamples, t);
    rig.updateMatrixWorld(true);
    const pose = new Map(bones.map(bone => [bone, bone.getWorldQuaternion(new THREE.Quaternion())]));
    const desired = new Map<THREE.Bone, THREE.Quaternion>();
    for (const bone of bones) {
      const partner = byName.get(oppositeName(bone.name)) ?? bone;
      const delta = pose.get(partner)!.clone().multiply(rest.get(partner)!.q.clone().invert());
      delta.premultiply(inverseRootQ).multiply(rootQ);
      delta.set(delta.x, -delta.y, -delta.z, delta.w);
      const world = delta.premultiply(rootQ).multiply(inverseRootQ).multiply(rest.get(bone)!.q);
      desired.set(bone, world.clone());
      const parentQ = (bone.parent as THREE.Bone)?.isBone
        ? desired.get(bone.parent as THREE.Bone)!
        : bone.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
      const local = parentQ.clone().invert().multiply(world).normalize();
      const data = values.get(bone)!;
      if (i && data.previous.dot(local) < 0) local.set(-local.x, -local.y, -local.z, -local.w);
      data.q.push(local.x, local.y, local.z, local.w); data.previous.copy(local);
      const p = rest.get(bone)!.p;
      data.p.push(/hips$/i.test(bone.name) ? 2 * p.x - bone.position.x : p.x,
        /hips$/i.test(bone.name) ? bone.position.y : p.y,
        /hips$/i.test(bone.name) ? bone.position.z : p.z);
    }
  }
  return new THREE.AnimationClip(`${source.name}_OppositeSupport`, source.duration, bones.flatMap(bone => {
    const data = values.get(bone)!;
    return [new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, data.q),
      new THREE.VectorKeyframeTrack(`${bone.name}.position`, times, data.p)];
  }));
};

/** Change only the released arm: it briefly helps the final rise on the thigh.
 * The floor support, pelvis, knees, feet, timing and standing settle stay in
 * the supplied take. Bake once at load, not as frame-dependent live IK. */
const withThighBrace = (character: THREE.Group, source: THREE.AnimationClip, side: GetUpSide,
  handSide: GetUpSupportSide): THREE.AnimationClip => {
  const rig = cloneSkeleton(character) as THREE.Group, bones = bonesOf(rig);
  const find = (suffix: string) => bones.find(bone => bone.name.endsWith(suffix));
  const prefix = handSide === 'left' ? 'Left' : 'Right';
  const upper = find(`${prefix}Arm`), lower = find(`${prefix}ForeArm`), hand = find(`${prefix}Hand`);
  const thigh = find(`${prefix}UpLeg`), knee = find(`${prefix}Leg`);
  if (!upper || !lower || !hand || !thigh || !knee) return source;
  const tracks = sampler(source), changed = [upper, lower, hand];
  const values = new Map(changed.map(bone => [bone, { values: [] as number[], previous: new THREE.Quaternion() }]));
  const count = Math.ceil(source.duration * 60);
  const times = Array.from({ length: count + 1 }, (_, i) => source.duration * i / count);
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(rig.quaternion);
  // The supplied avatar faces +Z: its anatomical right lies on -X.
  const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(rig.quaternion);
  const pole = right.clone().multiplyScalar(handSide === 'right' ? 1 : -1).addScaledVector(forward, .25);
  const envelope = side === 'back' ? [0.52, 0.65, 0.73, 0.86] : [0.61, 0.71, 0.77, 0.89];
  for (const [i, t] of times.entries()) {
    evaluate(bones, tracks, t); rig.updateMatrixWorld(true);
    const u = t / source.duration;
    const weight = easeCombat((u - envelope[0]!) / (envelope[1]! - envelope[0]!))
      * (1 - easeCombat((u - envelope[2]!) / (envelope[3]! - envelope[2]!)));
    if (weight > 1e-6) {
      const wrist = hand.getWorldQuaternion(new THREE.Quaternion());
      const target = thigh.getWorldPosition(new THREE.Vector3()).lerp(knee.getWorldPosition(new THREE.Vector3()), .50)
        .addScaledVector(forward, .035).add(new THREE.Vector3(0, .025, 0));
      solveCombatTwoBone(upper, lower, hand, target, weight, pole, .985, THREE.MathUtils.degToRad(35));
      // Keep the palm's authored world orientation rather than carrying the
      // forearm's IK rotation into a sudden wrist roll.
      hand.quaternion.copy(hand.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(wrist)).normalize();
    }
    for (const bone of changed) {
      const data = values.get(bone)!, q = bone.quaternion.clone();
      if (i && data.previous.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      data.values.push(q.x, q.y, q.z, q.w); data.previous.copy(q);
    }
  }
  const replacement = new Map(changed.map(bone => [`${bone.name}.quaternion`,
    new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values.get(bone)!.values)]));
  return new THREE.AnimationClip(`${source.name}_ThighSupport`, source.duration,
    source.tracks.map(track => replacement.get(track.name) ?? track.clone()));
};

export const createGetUpMotionVariants = (character: THREE.Group, source: THREE.AnimationClip,
  standing: THREE.AnimationClip, side: GetUpSide): GetUpMotionVariant[] => {
  const floor = createGetUpMotionClip(character, source, standing, side);
  const opposite = createGetUpMotionClip(character, mirrorGetUpSource(character, source), standing, side);
  // Measure the loaded arm during the push rather than assume the same lead
  // for every supplied take. Its opposite can brace once it has left the floor.
  const probe = cloneSkeleton(character) as THREE.Group, probeBones = bonesOf(probe);
  evaluate(probeBones, sampler(floor), floor.duration * .40); probe.updateMatrixWorld(true);
  const left = probeBones.find(bone => bone.name.endsWith('LeftHand'));
  const right = probeBones.find(bone => bone.name.endsWith('RightHand'));
  const support: GetUpSupportSide = left && right
    && left.getWorldPosition(new THREE.Vector3()).y < right.getWorldPosition(new THREE.Vector3()).y ? 'left' : 'right';
  const other: GetUpSupportSide = support === 'right' ? 'left' : 'right';
  return [
    { id: 'floor', support, thighBrace: false, clip: floor },
    { id: 'floor-opposite', support: other, thighBrace: false, clip: opposite },
    { id: 'thigh', support, thighBrace: true, clip: withThighBrace(character, floor, side, other) },
    { id: 'thigh-opposite', support: other, thighBrace: true, clip: withThighBrace(character, opposite, side, support) },
  ];
};
