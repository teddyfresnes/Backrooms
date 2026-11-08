import * as THREE from 'three';

interface HandBones { middle: THREE.Bone; index: THREE.Bone; pinky: THREE.Bone; left: boolean }
interface CurlJoint { bone: THREE.Bone; rest: THREE.Quaternion; axis: THREE.Vector3; angle: number; finger: number; joint: number }
interface ThumbJoint { bone: THREE.Bone; reference: THREE.Quaternion }
export interface HandSurfaceFrame { position: THREE.Vector3; fingers: THREE.Vector3; normal: THREE.Vector3 }
const nameOf = (bone: THREE.Object3D): string => bone.name.toLowerCase().replace(/[^a-z0-9]/g, '');
const FINGERS = ['index', 'middle', 'ring', 'pinky'];
// A single anatomical closure from bind pose, never another curl on an already
// closed animation. The distal phalanx stays short of folding back into itself.
const CLOSURE = [1.05, 1.35, .65];

// Measured skin contact around the rubber barrel, at crouched, physical and
// standing view-model scales. Interpolate by palm span, never animation time.
const TORCH_GRIPS = [
  { span: .05832, angles: [[.45, .22, .295], [.45, .425, .265], [.45, .15, .375], [.175, .02, .12]] },
  { span: .06943, angles: [[.475, .185, .79], [.4, .6, .565], [.45, .28, .46], [.2, .02, .235]] },
  { span: .08471, angles: [[.35, .6, .625], [.4, .85, .375], [.45, .35, .725], [.2, .02, .57]] },
  { span: .10936, angles: [[.7, .23, .975], [.775, .21, 1.275], [.4, .6, .78], [.2, .1, .76]] },
] as const;
export const TORCH_REFERENCE_HAND_SPAN = .0826;
const PHYSICAL_TORCH_GRIP = [[.2, 1.05, .295], [.45, .8, .65], [.35, .6, .815], [.02, .55, .495]] as const;

export class HandPose {
  private readonly hands = new Map<THREE.Bone, HandBones>();
  private readonly curls = new Map<THREE.Bone, CurlJoint[]>();
  private readonly thumbs = new Map<THREE.Bone, ThumbJoint[]>();
  readonly correctedBones: THREE.Bone[] = [];

  constructor(root: THREE.Object3D) {
    const bind = new Map<THREE.Bone, THREE.Matrix4>();
    root.traverse(object => {
      const mesh = object as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      mesh.skeleton.bones.forEach((bone, i) => {
        if (!bind.has(bone)) bind.set(bone, mesh.skeleton.boneInverses[i]!.clone().invert());
      });
    });
    for (const hand of bind.keys()) {
      if (!/hand$/.test(nameOf(hand))) continue;
      const find = (suffix: string) => [...bind.keys()].find(bone => nameOf(bone) === nameOf(hand) + suffix);
      const middle = find('middle1'), index = find('index1'), pinky = find('pinky1');
      if (!middle || !index || !pinky) continue;
      const left = nameOf(hand).includes('left');
      this.hands.set(hand, { middle, index, pinky, left });
      const position = (bone: THREE.Bone) => new THREE.Vector3().setFromMatrixPosition(bind.get(bone)!);
      const forward = position(middle).sub(position(hand)).normalize();
      const thumbSide = position(index).sub(position(pinky));
      const normal = new THREE.Vector3().crossVectors(thumbSide, forward).normalize().multiplyScalar(left ? -1 : 1);
      const flexion = new THREE.Vector3().crossVectors(forward, normal).normalize();
      const joints: CurlJoint[] = [];
      for (const [fingerIndex, finger] of FINGERS.entries()) for (let i = 1; i <= 3; i++) {
        const bone = find(`${finger}${i}`), parent = bone?.parent as THREE.Bone | undefined;
        if (!bone || !parent || !bind.has(parent)) continue;
        const world = bind.get(bone)!;
        const local = bind.get(parent)!.clone().invert().multiply(world);
        const rest = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(local));
        const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(world));
        joints.push({ bone, rest, axis: flexion.clone().applyQuaternion(rotation.invert()), angle: CLOSURE[i - 1]!, finger: fingerIndex, joint: i - 1 });
        this.correctedBones.push(bone);
      }
      this.curls.set(hand, joints);
      const thumbs: ThumbJoint[] = [];
      for (let i = 1; i <= 3; i++) {
        const bone = find(`thumb${i}`), parent = bone?.parent as THREE.Bone | undefined;
        if (!bone || !parent || !bind.has(parent)) continue;
        const local = bind.get(parent)!.clone().invert().multiply(bind.get(bone)!);
        thumbs.push({ bone, reference: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(local)) });
      }
      this.thumbs.set(hand, thumbs);
    }
  }

  setThumbReference(idle: THREE.AnimationClip): void {
    for (const joints of this.thumbs.values()) for (const joint of joints) {
      const track = idle.tracks.find(track => track.name === `${joint.bone.name}.quaternion`);
      if (track) joint.reference.fromArray(new THREE.QuaternionLinearInterpolant(track.times, track.values, 4).evaluate(Math.min(1, idle.duration))).normalize();
    }
  }

  gripTorch(hand: THREE.Bone, span: number, fingers: THREE.Vector3, normal: THREE.Vector3, weight: number, physical = false): void {
    let upperIndex = 1;
    while (upperIndex < TORCH_GRIPS.length - 1 && span > TORCH_GRIPS[upperIndex]!.span) upperIndex++;
    const a = TORCH_GRIPS[upperIndex - 1]!, b = TORCH_GRIPS[upperIndex]!;
    const blend = THREE.MathUtils.clamp((span - a.span) / (b.span - a.span), 0, 1);
    for (const joint of this.curls.get(hand) ?? []) {
      const angle = physical ? PHYSICAL_TORCH_GRIP[joint.finger]![joint.joint]!
        : THREE.MathUtils.lerp(a.angles[joint.finger]![joint.joint]!, b.angles[joint.finger]![joint.joint]!, blend);
      const target = joint.rest.clone().multiply(new THREE.Quaternion().setFromAxisAngle(joint.axis, angle));
      joint.bone.quaternion.slerp(target, weight);
    }
    for (const [i, joint] of (this.thumbs.get(hand) ?? []).entries()) {
      const target = joint.reference.clone();
      if (i === 0 && joint.bone.parent) {
        // Oppose the curled fingers underneath the barrel. Locomotion must
        // never reopen this thumb or change which side carries the light.
        const axis = new THREE.Vector3().crossVectors(fingers, normal).normalize()
          .applyQuaternion(joint.bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
        target.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, physical ? -.35 : -.6));
      }
      joint.bone.quaternion.slerp(target, weight);
    }
    hand.updateWorldMatrix(true, true);
  }

  curl(hand: THREE.Bone | undefined, amount: number, weight: number): void {
    if (!hand || weight <= 0) return;
    for (const joint of this.curls.get(hand) ?? []) {
      const target = joint.rest.clone().multiply(new THREE.Quaternion().setFromAxisAngle(joint.axis, joint.angle * amount));
      joint.bone.quaternion.slerp(target, THREE.MathUtils.clamp(weight, 0, 1));
    }
    hand.updateWorldMatrix(true, true);
  }

  sample(hand: THREE.Bone, out: HandSurfaceFrame): boolean {
    const bones = this.hands.get(hand);
    if (!bones) return false;
    const wrist = hand.getWorldPosition(new THREE.Vector3());
    const middle = bones.middle.getWorldPosition(new THREE.Vector3());
    const thumbSide = bones.index.getWorldPosition(new THREE.Vector3()).sub(bones.pinky.getWorldPosition(new THREE.Vector3()));
    out.position.copy(wrist).lerp(middle, .62);
    out.fingers.copy(middle).sub(wrist).normalize();
    out.normal.crossVectors(thumbSide, out.fingers).normalize().multiplyScalar(bones.left ? -1 : 1);
    return true;
  }

  alignPalm(hand: THREE.Bone, normal: THREE.Vector3, fingers: THREE.Vector3, weight: number): void {
    const frame = { position: new THREE.Vector3(), fingers: new THREE.Vector3(), normal: new THREE.Vector3() };
    if (!hand.parent || !this.sample(hand, frame)) return;
    const wantedFingers = fingers.clone().addScaledVector(normal, -fingers.dot(normal)).normalize();
    const basis = (f: THREE.Vector3, n: THREE.Vector3) => new THREE.Matrix4().makeBasis(f, new THREE.Vector3().crossVectors(n, f).normalize(), n);
    const rotation = new THREE.Quaternion().setFromRotationMatrix(basis(wantedFingers, normal).multiply(basis(frame.fingers, frame.normal).transpose()));
    const authored = hand.getWorldQuaternion(new THREE.Quaternion());
    const target = rotation.multiply(authored);
    authored.slerp(target, weight);
    hand.quaternion.copy(hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(authored));
    hand.updateWorldMatrix(false, true);
  }
}
