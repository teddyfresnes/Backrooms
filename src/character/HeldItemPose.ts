import * as THREE from 'three';
import { solveCombatTwoBone } from './CombatRig';

export type HeldArmChain = readonly [THREE.Bone | undefined, THREE.Bone | undefined, THREE.Bone | undefined];

/** Where the wrist goes and how the palm faces, in an eye/body basis (all unit vectors). */
export interface HeldItemBasis {
  readonly origin: THREE.Vector3;
  readonly forward: THREE.Vector3;
  readonly up: THREE.Vector3;
  readonly right: THREE.Vector3;
  /** Metres along forward, right and up from the origin. */
  readonly reach: { forward: number; right: number; up: number };
}

interface HandMarkers { index?: THREE.Bone; middle?: THREE.Bone; pinky?: THREE.Bone }

/** Palm frame: +Y is the palm normal, -Z along the fingers, at the centre of the palm. */
export interface PalmFrame { position: THREE.Vector3; quaternion: THREE.Quaternion }

const findMarkers = (hand: THREE.Bone): HandMarkers => {
  const markers: HandMarkers = {};
  hand.traverse(object => {
    const bone = object as THREE.Bone;
    if (!bone.isBone || bone === hand) return;
    const name = bone.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!markers.index && /index1$/.test(name)) markers.index = bone;
    if (!markers.middle && /middle1$/.test(name)) markers.middle = bone;
    if (!markers.pinky && /pinky1$/.test(name)) markers.pinky = bone;
  });
  return markers;
};

/**
 * Presentation pose for a small object held flat in the right palm, in front
 * of the chest and tilted toward the eyes (a compass being read). Applied after
 * the animation on whichever rig is drawn; the world capsule is untouched.
 */
export class HeldItemPose {
  private weight = 0;
  private readonly markers = new WeakMap<THREE.Bone, HandMarkers>();
  private readonly target = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  private readonly wrist = new THREE.Vector3();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private readonly fingers = new THREE.Vector3();
  private readonly thumbSide = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly wantedFingers = new THREE.Vector3();
  private readonly wantedNormal = new THREE.Vector3();
  private readonly wantedThumb = new THREE.Vector3();
  private readonly current = new THREE.Matrix4();
  private readonly wanted = new THREE.Matrix4();
  private readonly rotation = new THREE.Quaternion();
  private readonly handWorld = new THREE.Quaternion();
  private readonly posed = new THREE.Quaternion();
  private readonly parent = new THREE.Quaternion();

  get active(): boolean { return this.weight > 0.001; }

  /** Eases the grip in and out; returns the current blend. */
  advance(holding: boolean, delta: number): number {
    const rate = holding ? 7 : 9;
    this.weight = THREE.MathUtils.lerp(this.weight, holding ? 1 : 0, 1 - Math.exp(-Math.max(0, delta) * rate));
    if (!holding && this.weight < 0.002) this.weight = 0;
    return this.weight;
  }

  apply(chain: HeldArmChain, basis: HeldItemBasis): void {
    const [upper, lower, hand] = chain;
    if (!upper || !lower || !hand?.parent || this.weight <= 0.001) return;
    this.target.copy(basis.origin)
      .addScaledVector(basis.forward, basis.reach.forward)
      .addScaledVector(basis.right, basis.reach.right)
      .addScaledVector(basis.up, basis.reach.up);
    // Elbow down and a little out, never up into the view.
    this.pole.copy(basis.right).multiplyScalar(0.55).addScaledVector(basis.up, -1).addScaledVector(basis.forward, -0.15);
    hand.getWorldQuaternion(this.handWorld);
    solveCombatTwoBone(upper, lower, hand, this.target, this.weight, this.pole, 0.97, Math.PI / 3);
    hand.parent.getWorldQuaternion(this.parent);
    hand.quaternion.copy(this.parent.clone().invert().multiply(this.handWorld)).normalize();
    hand.updateWorldMatrix(false, true);

    // Palm up, tilted toward the eyes, fingers pointing ahead and slightly inward.
    if (!this.palmBasis(hand)) return;
    this.wantedNormal.copy(basis.up).multiplyScalar(0.72).addScaledVector(basis.forward, -0.69).normalize();
    this.wantedFingers.copy(basis.forward).multiplyScalar(0.9).addScaledVector(basis.right, -0.42);
    this.wantedFingers.addScaledVector(this.wantedNormal, -this.wantedFingers.dot(this.wantedNormal)).normalize();
    // Right hand, palm up, fingers ahead: the thumb points out to the right.
    this.wantedThumb.crossVectors(this.wantedFingers, this.wantedNormal);
    this.current.makeBasis(this.fingers, this.thumbSide, this.normal);
    this.wanted.makeBasis(this.wantedFingers, this.wantedThumb, this.wantedNormal);
    this.rotation.setFromRotationMatrix(this.wanted.multiply(this.current.transpose()));
    hand.getWorldQuaternion(this.handWorld);
    this.posed.copy(this.rotation).multiply(this.handWorld);
    this.handWorld.slerp(this.posed, this.weight);
    hand.parent.getWorldQuaternion(this.parent);
    hand.quaternion.copy(this.parent.invert().multiply(this.handWorld)).normalize();
    hand.updateWorldMatrix(false, true);
  }

  /** The palm of the right hand as a frame for the held object. */
  palmFrame(hand: THREE.Bone | undefined, output: PalmFrame): boolean {
    if (!hand || !this.palmBasis(hand)) return false;
    const markers = this.markers.get(hand)!;
    hand.getWorldPosition(this.a);
    markers.middle!.getWorldPosition(this.b);
    output.position.copy(this.a).lerp(this.b, 0.62).addScaledVector(this.normal, 0.024);
    // Case basis: x = thumb side, y = out of the palm, z = back toward the wrist.
    this.wanted.makeBasis(this.thumbSide, this.normal, this.fingers.clone().negate());
    output.quaternion.setFromRotationMatrix(this.wanted);
    return true;
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
    // Right hand: thumb side × fingers points out of the palm (not the back of the hand).
    this.normal.crossVectors(this.thumbSide, this.fingers).normalize();
    this.thumbSide.crossVectors(this.fingers, this.normal).normalize();
    return true;
  }
}
