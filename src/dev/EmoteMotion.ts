import * as THREE from 'three';

/** Metre-scale authored translation, separated from the pose so Rapier owns it. */
export class EmoteMotion {
  readonly bounds = new THREE.Box3();
  readonly groundPoints: THREE.Vector3[] = [];
  groundOffset = 0;
  private readonly interpolant: THREE.Interpolant;
  private readonly cycleOffset = new THREE.Vector3();

  constructor(readonly duration: number, readonly rootTrack: THREE.VectorKeyframeTrack) {
    this.interpolant = new THREE.LinearInterpolant(rootTrack.times, rootTrack.values, 3);
    this.cycleOffset.fromArray(this.interpolant.evaluate(duration));
    if (this.cycleOffset.length() < .001) this.cycleOffset.set(0, 0, 0);
  }

  sample(seconds: number, loop: boolean, target = new THREE.Vector3()): THREE.Vector3 {
    const elapsed = Math.max(0, seconds);
    const cycles = loop ? Math.floor(elapsed / this.duration) : 0;
    const time = loop ? elapsed - cycles * this.duration : Math.min(elapsed, this.duration);
    return target.fromArray(this.interpolant.evaluate(time)).addScaledVector(this.cycleOffset, cycles);
  }
}

/** Bake once at load time: no skinned meshes or pose sampling in the picker. */
export function prepareEmoteMotion(
  character: THREE.Group,
  pose: THREE.AnimationClip,
  source: THREE.AnimationClip,
  sourceHipRestY: number,
  hips: THREE.Bone,
  groundPose = false,
  staysLow = false,
): EmoteMotion {
  const sourcePosition = source.tracks.find(track => /hips\.position$/i.test(track.name));
  if (!sourcePosition) throw new Error(`Missing root motion: ${pose.name}`);
  const values = new Float32Array(sourcePosition.values.length);
  const delta = new THREE.Vector3();
  const scale = hips.position.y / sourceHipRestY;
  for (let i = 0; i < values.length; i += 3) {
    delta.set(sourcePosition.values[i]! - sourcePosition.values[0]!, 0,
      sourcePosition.values[i + 2]! - sourcePosition.values[2]!);
    delta.multiplyScalar(scale).multiply(character.scale).applyQuaternion(character.quaternion);
    values[i] = delta.x; values[i + 2] = delta.z;
  }
  const motion = new EmoteMotion(pose.duration, new THREE.VectorKeyframeTrack('emote-root', sourcePosition.times, values));
  const saved: { bone: THREE.Bone; position: THREE.Vector3; rotation: THREE.Quaternion }[] = [];
  const landmarks: THREE.Bone[] = [];
  character.traverse(object => {
    const bone = object as THREE.Bone;
    if (!bone.isBone) return;
    saved.push({ bone, position: bone.position.clone(), rotation: bone.quaternion.clone() });
    if (/(hips|spine\d*|neck|head|shoulder|arm|forearm|hand|upleg|leg|foot|toebase)$/i.test(bone.name)) landmarks.push(bone);
  });
  const mixer = new THREE.AnimationMixer(character);
  const action = mixer.clipAction(pose).setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true; action.play();
  const root = new THREE.Vector3(), point = new THREE.Vector3();
  const padding = new THREE.Vector3();
  const groundCells = new Set<string>();
  character.updateWorldMatrix(true, true);
  const parentInverse = character.parent?.matrixWorld.clone().invert() ?? new THREE.Matrix4();
  const steps = Math.ceil(pose.duration * 30);
  try {
    for (let i = 0; i <= steps; i++) {
      const time = Math.min(pose.duration, i / 30);
      mixer.setTime(time); character.updateWorldMatrix(true, true);
      motion.sample(time, false, root);
      const cell = `${Math.round(root.x / .12)},${Math.round(root.z / .12)}`;
      if (!groundCells.has(cell)) { groundCells.add(cell); motion.groundPoints.push(root.clone()); }
      if (i === 0 && groundPose) motion.groundOffset = -new THREE.Box3().setFromObject(character, true).applyMatrix4(parentInverse).min.y;
      // Only poses which stand up need room for the live standing capsule.
      for (const sign of staysLow ? [] : [-1, 1]) {
        motion.bounds.expandByPoint(point.set(root.x + sign * .35, .07, root.z + sign * .35));
        motion.bounds.expandByPoint(point.set(root.x + sign * .35, 1.73, root.z + sign * .35));
      }
      for (const bone of landmarks) {
        bone.getWorldPosition(point).applyMatrix4(parentInverse).add(root);
        const radius = /head|hips|spine\d*$/i.test(bone.name) ? .16 : .10;
        padding.setScalar(radius);
        motion.bounds.expandByPoint(point.clone().sub(padding));
        motion.bounds.expandByPoint(point.add(padding));
      }
    }
    // Shoes and hands may touch the floor; never treat their contact as a wall.
    motion.bounds.translate(new THREE.Vector3(0, motion.groundOffset, 0));
    motion.bounds.min.y = Math.max(.07, motion.bounds.min.y);
  } finally {
    mixer.stopAllAction(); mixer.uncacheRoot(character);
    for (const { bone, position, rotation } of saved) { bone.position.copy(position); bone.quaternion.copy(rotation); }
    character.updateWorldMatrix(true, true);
  }
  return motion;
}
