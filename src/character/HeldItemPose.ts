import * as THREE from 'three';
import { solveCombatTwoBone } from './CombatRig';

export type HeldArmChain = readonly [THREE.Bone | undefined, THREE.Bone | undefined, THREE.Bone | undefined];
export type HeldItemKind = 'compass' | 'torch';

/** A rendered frame for the held object (world space). */
export interface PalmFrame { position: THREE.Vector3; quaternion: THREE.Quaternion }

/** How the right hand meets the object: palm centre, out-of-palm normal, finger direction, curl. */
export interface HandGrip {
  readonly palm: THREE.Vector3;
  readonly normal: THREE.Vector3;
  readonly fingers: THREE.Vector3;
  /** Elbow bend direction (down and out). */
  readonly pole: THREE.Vector3;
  /** 0 open palm .. 1 closed around a handle. */
  readonly curl: number;
}

interface HandMarkers { index?: THREE.Bone; middle?: THREE.Bone; pinky?: THREE.Bone; fingers: THREE.Bone[][] }

const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
/** Per joint curl (radians) for a full grip; the thumb only half closes. */
const CURL: Record<(typeof FINGER_NAMES)[number], readonly number[]> = {
  thumb: [0.35, 0.45, 0.3], index: [1.05, 1.25, 0.65], middle: [1.1, 1.3, 0.7], ring: [1.15, 1.32, 0.7], pinky: [1.2, 1.35, 0.72],
};

const findMarkers = (hand: THREE.Bone): HandMarkers => {
  const markers: HandMarkers = { fingers: [] };
  const byName = new Map<string, THREE.Bone>();
  hand.traverse(object => {
    const bone = object as THREE.Bone;
    if (bone.isBone && bone !== hand) byName.set(bone.name.toLowerCase().replace(/[^a-z0-9]/g, ''), bone);
  });
  const find = (suffix: string) => [...byName.entries()].find(([name]) => name.endsWith(suffix))?.[1];
  markers.index = find('index1'); markers.middle = find('middle1'); markers.pinky = find('pinky1');
  for (const finger of FINGER_NAMES) markers.fingers.push([1, 2, 3].map(joint => find(`${finger}${joint}`)).filter((bone): bone is THREE.Bone => !!bone));
  return markers;
};

/**
 * Presentation pose of the right arm holding a small object. The object's
 * frame is decided first (stable in the view, or in front of the chest), then
 * the arm is solved to meet it: wrist by two-bone IK, palm oriented from the
 * real finger bones, fingers curled around a handle when asked. Applied after
 * the animation on whichever rig is drawn; the world capsule is untouched.
 */
export class HeldItemPose {
  private weight = 0;
  private readonly markers = new WeakMap<THREE.Bone, HandMarkers>();
  private readonly wrist = new THREE.Vector3();
  private readonly palmNow = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private readonly fingers = new THREE.Vector3();
  private readonly thumbSide = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly wantedFingers = new THREE.Vector3();
  private readonly wantedThumb = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly current = new THREE.Matrix4();
  private readonly wanted = new THREE.Matrix4();
  private readonly rotation = new THREE.Quaternion();
  private readonly handWorld = new THREE.Quaternion();
  private readonly posed = new THREE.Quaternion();
  private readonly parent = new THREE.Quaternion();
  private readonly boneWorld = new THREE.Quaternion();
  private readonly turn = new THREE.Quaternion();

  get active(): boolean { return this.weight > 0.001; }
  get blend(): number { return this.weight; }

  /** Eases the grip in and out; returns the current blend. */
  advance(holding: boolean, delta: number): number {
    const rate = holding ? 9 : 10;
    this.weight = THREE.MathUtils.lerp(this.weight, holding ? 1 : 0, 1 - Math.exp(-Math.max(0, delta) * rate));
    if (holding && this.weight > 0.995) this.weight = 1;
    if (!holding && this.weight < 0.002) this.weight = 0;
    return this.weight;
  }

  apply(chain: HeldArmChain, grip: HandGrip): void {
    const [upper, lower, hand] = chain;
    if (!upper || !lower || !hand?.parent || this.weight <= 0.001 || !this.palmBasis(hand)) return;
    const markers = this.markers.get(hand)!;
    this.wantedFingers.copy(grip.fingers).addScaledVector(grip.normal, -grip.fingers.dot(grip.normal)).normalize();
    // Right hand: the thumb side is fingers × palm normal.
    this.wantedThumb.crossVectors(this.wantedFingers, grip.normal);
    // Two passes: reach with the current palm offset, orient, then correct for the new offset.
    for (let pass = 0; pass < 2; pass++) {
      hand.getWorldPosition(this.wrist);
      this.palmCentre(hand, markers, this.palmNow);
      this.target.copy(grip.palm).sub(this.palmNow.sub(this.wrist));
      hand.getWorldQuaternion(this.handWorld);
      solveCombatTwoBone(upper, lower, hand, this.target, this.weight, grip.pole, 0.985, Math.PI / 3);
      hand.parent.getWorldQuaternion(this.parent);
      hand.quaternion.copy(this.parent.clone().invert().multiply(this.handWorld)).normalize();
      hand.updateWorldMatrix(false, true);
      if (!this.palmBasis(hand)) return;
      this.current.makeBasis(this.fingers, this.thumbSide, this.normal);
      this.wanted.makeBasis(this.wantedFingers, this.wantedThumb, grip.normal);
      this.rotation.setFromRotationMatrix(this.wanted.multiply(this.current.transpose()));
      hand.getWorldQuaternion(this.handWorld);
      this.posed.copy(this.rotation).multiply(this.handWorld);
      this.handWorld.slerp(this.posed, this.weight);
      hand.parent.getWorldQuaternion(this.parent);
      hand.quaternion.copy(this.parent.invert().multiply(this.handWorld)).normalize();
      hand.updateWorldMatrix(false, true);
      this.palmBasis(hand);
    }
    if (grip.curl <= 0) return;
    // Close the fingers toward the palm, joint by joint, about the knuckle axis.
    this.axis.crossVectors(this.fingers, this.normal).normalize();
    FINGER_NAMES.forEach((name, finger) => {
      markers.fingers[finger]!.forEach((bone, joint) => {
        const angle = CURL[name][joint]! * grip.curl * this.weight;
        if (!bone.parent || angle < 1e-5) return;
        bone.updateWorldMatrix(true, false);
        bone.getWorldQuaternion(this.boneWorld).premultiply(this.turn.setFromAxisAngle(this.axis, angle));
        bone.parent.getWorldQuaternion(this.parent);
        bone.quaternion.copy(this.parent.invert().multiply(this.boneWorld)).normalize();
        bone.updateWorldMatrix(false, true);
      });
    });
  }

  private palmCentre(hand: THREE.Bone, markers: HandMarkers, output: THREE.Vector3): THREE.Vector3 {
    hand.getWorldPosition(this.a);
    markers.middle!.getWorldPosition(this.b);
    return output.copy(this.a).lerp(this.b, 0.62);
  }

  private palmBasis(hand: THREE.Bone): boolean {
    let markers = this.markers.get(hand);
    if (!markers) { markers = findMarkers(hand); this.markers.set(hand, markers); }
    if (!markers.middle || !markers.index || !markers.pinky) return false;
    hand.updateWorldMatrix(true, true);
    hand.getWorldPosition(this.wrist);
    markers.middle.getWorldPosition(this.a);
    markers.index.getWorldPosition(this.b);
    markers.pinky.getWorldPosition(this.c);
    this.fingers.subVectors(this.a, this.wrist);
    this.thumbSide.subVectors(this.b, this.c);
    if (this.fingers.lengthSq() < 1e-8 || this.thumbSide.lengthSq() < 1e-8) return false;
    this.fingers.normalize();
    // Right hand: thumb side × fingers points out of the palm (checked on the real rig).
    this.normal.crossVectors(this.thumbSide, this.fingers).normalize();
    this.thumbSide.crossVectors(this.fingers, this.normal).normalize();
    return true;
  }
}

const COMPASS_FACE = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0.6, 0.8), new THREE.Vector3(0, -0.8, 0.6));
const Y = new THREE.Vector3(0, 1, 0);

/**
 * Where the held object sits, from a view basis (camera in first person, or
 * the body in third person). The compass lies flat in the palm, its face turned
 * up toward the eyes; the torch points at what the player looks at.
 */
export function heldItemFrame(kind: HeldItemKind, view: THREE.Matrix4, aim: THREE.Vector3, firstPerson: boolean, output: PalmFrame): PalmFrame {
  const viewQuaternion = new THREE.Quaternion().setFromRotationMatrix(view);
  if (kind === 'compass') {
    output.position.set(firstPerson ? 0.075 : 0.05, firstPerson ? -0.135 : -0.27, firstPerson ? -0.3 : -0.32).applyMatrix4(view);
    output.quaternion.setFromRotationMatrix(COMPASS_FACE).premultiply(viewQuaternion);
  } else {
    output.position.set(firstPerson ? 0.15 : 0.17, firstPerson ? -0.2 : -0.33, firstPerson ? -0.33 : -0.36).applyMatrix4(view);
    const direction = aim.clone().sub(output.position).normalize();
    output.quaternion.setFromUnitVectors(Y, direction);
  }
  return output;
}

/** The hand meeting the object's frame (see heldItemFrame), in world space. */
export function gripForItem(kind: HeldItemKind, frame: PalmFrame, right: THREE.Vector3, up: THREE.Vector3, grip: { palm: THREE.Vector3; normal: THREE.Vector3; fingers: THREE.Vector3; pole: THREE.Vector3 }): number {
  grip.pole.copy(right).multiplyScalar(0.55).addScaledVector(up, -1);
  if (kind === 'compass') {
    grip.normal.set(0, 1, 0).applyQuaternion(frame.quaternion);
    const far = new THREE.Vector3(0, 0, -1).applyQuaternion(frame.quaternion);
    grip.fingers.copy(far).multiplyScalar(0.85).addScaledVector(right, -0.5);
    // The case's bottom rests on the palm.
    grip.palm.copy(frame.position).addScaledVector(grip.normal, -0.02);
    return 0.12;
  }
  // Torch: palm against its right side around the rubber grip, fingers under it, thumb along the barrel.
  const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(frame.quaternion);
  const side = right.clone().addScaledVector(axis, -right.dot(axis)).normalize();
  grip.normal.copy(side).negate();
  grip.fingers.copy(up).negate().addScaledVector(axis, -up.clone().negate().dot(axis)).normalize();
  grip.palm.copy(frame.position).addScaledVector(side, 0.03);
  return 1;
}
