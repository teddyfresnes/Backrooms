import * as THREE from 'three';
import { CombatProceduralPose, easeCombat, solveCombatTwoBone } from './CombatRig';
import { RPS_REVEAL_SECONDS, type PairAction, type RpsChoice } from './PairInteractionRules';

type HandShape = RpsChoice | 'clasp';
const up = new THREE.Vector3(0, 1, 0);
const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const windowWeight = (time: number, duration: number) => easeCombat(time / .48) * (1 - easeCombat((time - duration + .5) / .5));

/** A shared world-space contact drives both actors. Anatomical limb lengths are
 * retained; local rotations are rebuilt from the authored pose every frame. */
export class PairInteractionRig {
  readonly bones = new Map<string, THREE.Bone>();
  readonly hand: THREE.Bone;
  readonly hips: THREE.Bone;
  readonly head: THREE.Bone;
  private readonly upper: THREE.Bone;
  private readonly lower: THREE.Bone;
  private readonly fingerRest = new Map<THREE.Bone, THREE.Quaternion>();
  private readonly palmBasisInverse: THREE.Quaternion;
  private readonly pose = new CombatProceduralPose();
  private readonly headForwardLocal = new THREE.Vector3(0, 0, 1);
  private floorY: number;
  constructor(readonly root: THREE.Group, readonly character: THREE.Group) {
    this.floorY = root.position.y;
    character.traverse(object => { if ((object as THREE.Bone).isBone) this.bones.set(normalizeName(object.name), object as THREE.Bone); });
    this.hand = this.require('righthand'); this.upper = this.require('rightarm');
    this.lower = this.require('rightforearm'); this.hips = this.require('hips'); this.head = this.require('head');
    // FBX inverse bind matrices provide the genuinely open phalanges, rather
    // than treating the curled idle take as an open paper/high-five hand.
    character.traverse(object => {
      const mesh = object as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      const skeleton = mesh.skeleton;
      const headIndex = skeleton.bones.indexOf(this.head);
      if (headIndex >= 0) {
        const bind = skeleton.boneInverses[headIndex]!.clone().invert();
        const rotation = new THREE.Quaternion(); bind.decompose(new THREE.Vector3(), rotation, new THREE.Vector3());
        this.headForwardLocal.set(0, 0, 1).applyQuaternion(rotation.invert());
      }
      skeleton.bones.forEach((bone, index) => {
        if (!/hand(?:thumb|index|middle|ring|pinky)[123]$/i.test(bone.name)) return;
        const parentIndex = skeleton.bones.indexOf(bone.parent as THREE.Bone);
        if (parentIndex < 0) return;
        const local = skeleton.boneInverses[parentIndex]!.clone()
          .multiply(skeleton.boneInverses[index]!.clone().invert());
        this.fingerRest.set(bone, new THREE.Quaternion().setFromRotationMatrix(local).normalize());
      });
    });
    for (const bone of this.bones.values()) if (/hand(?:thumb|index|middle|ring|pinky)[123]$/i.test(bone.name)
      && !this.fingerRest.has(bone)) this.fingerRest.set(bone, bone.quaternion.clone());
    const finger = this.require('righthandmiddle1').position.clone().normalize();
    const width = this.require('righthandindex1').position.clone().sub(this.require('righthandpinky1').position);
    width.addScaledVector(finger, -width.dot(finger)).normalize();
    const normal = finger.clone().cross(width).normalize();
    this.palmBasisInverse = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(finger.clone().cross(normal), finger, normal)).invert();
  }
  find(suffix: string): THREE.Bone | undefined { return [...this.bones.entries()].find(([name]) => name.endsWith(suffix))?.[1]; }
  private require(suffix: string): THREE.Bone { const bone = this.find(suffix); if (!bone) throw new Error(`Pair interaction: missing ${suffix}`); return bone; }
  restore(): void { this.pose.restore(); }
  capture(): void { this.pose.capture(this.character); }
  getHead(target = new THREE.Vector3()): THREE.Vector3 { this.head.updateWorldMatrix(true, false); return this.head.getWorldPosition(target); }
  getFacing(target = new THREE.Vector3()): THREE.Vector3 {
    this.head.updateWorldMatrix(true, false);
    const head = this.getHead(), hips = this.hips.getWorldPosition(new THREE.Vector3());
    if (head.y - hips.y < .65) {
      target.copy(head).sub(hips); target.y = 0;
      if (target.lengthSq() > .01) return target.normalize();
    }
    target.copy(this.headForwardLocal).applyQuaternion(this.head.getWorldQuaternion(new THREE.Quaternion()));
    target.y = 0;
    if (target.lengthSq() < .05) { target.copy(this.getHead()).sub(this.hips.getWorldPosition(new THREE.Vector3())); target.y = 0; }
    if (target.lengthSq() < .01) target.set(0, 0, 1).applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()));
    return target.normalize();
  }
  getChest(target = new THREE.Vector3()): THREE.Vector3 {
    this.character.updateWorldMatrix(true, true);
    return this.hips.getWorldPosition(target).lerp(this.head.getWorldPosition(new THREE.Vector3()), .68);
  }
  get armLength(): number {
    this.upper.updateWorldMatrix(true, true);
    const elbow = this.lower.getWorldPosition(new THREE.Vector3());
    return this.upper.getWorldPosition(new THREE.Vector3()).distanceTo(elbow)
      + this.hand.getWorldPosition(new THREE.Vector3()).distanceTo(elbow);
  }
  ground(groundY: number, soleOffset: number): void {
    this.floorY = groundY;
    this.character.updateWorldMatrix(true, true);
    const bottom = Math.min(...['left', 'right'].map(side => this.require(`${side}foot`).getWorldPosition(new THREE.Vector3()).y - soleOffset));
    const lift = Math.max(0, groundY + .003 - bottom);
    if (lift <= 1e-6) return;
    const world = this.hips.getWorldPosition(new THREE.Vector3());
    const before = this.hips.parent!.worldToLocal(world.clone());
    const after = this.hips.parent!.worldToLocal(world.addScaledVector(up, lift));
    this.hips.position.add(after.sub(before)); this.hips.updateWorldMatrix(false, true);
  }
  getContactPoint(shape: HandShape = 'paper', target = new THREE.Vector3()): THREE.Vector3 {
    this.hand.updateWorldMatrix(true, true); target.set(0, 0, 0);
    const names = shape === 'rock' ? ['index1', 'middle1', 'ring1'] : ['index1', 'middle1', 'pinky1'];
    for (const name of names) target.add(this.require(`righthand${name}`).getWorldPosition(new THREE.Vector3()));
    if (shape !== 'rock') target.add(this.hand.getWorldPosition(new THREE.Vector3()));
    return target.divideScalar(shape === 'rock' ? names.length : names.length + 1);
  }
  private rotateWorld(bone: THREE.Bone | undefined, axis: THREE.Vector3, angle: number): void {
    if (!bone || Math.abs(angle) < 1e-7) return;
    bone.updateWorldMatrix(true, false);
    const world = bone.getWorldQuaternion(new THREE.Quaternion())
      .premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world)).normalize();
    bone.updateWorldMatrix(false, true);
  }
  private orientHand(normal: THREE.Vector3, finger: THREE.Vector3, weight: number): void {
    const f = finger.clone().addScaledVector(normal, -finger.dot(normal)).normalize();
    const desired = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.clone().cross(normal), f, normal))
      .multiply(this.palmBasisInverse);
    const local = this.hand.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desired).normalize();
    this.hand.quaternion.slerp(local, weight).normalize(); this.hand.updateWorldMatrix(false, true);
  }
  private fingers(shape: HandShape, normal: THREE.Vector3, finger: THREE.Vector3, weight: number): void {
    const axis = finger.clone().cross(normal).normalize();
    for (const name of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
      const extended = shape === 'paper' || (shape === 'scissors' && (name === 'index' || name === 'middle'));
      for (let joint = 1; joint <= 3; joint++) {
        const bone = this.find(`righthand${name}${joint}`); if (!bone) continue;
        bone.quaternion.slerp(this.fingerRest.get(bone)!, weight).normalize(); bone.updateWorldMatrix(false, true);
        const curl = extended ? 0 : name === 'thumb' ? [.55, .85, .3][joint - 1]!
          : shape === 'clasp' ? [.6, .85, .45][joint - 1]! : [1.12, 1.48, .72][joint - 1]!;
        this.rotateWorld(bone, axis, curl * weight);
        if (joint === 1 && extended && name !== 'thumb') {
          const spread = shape === 'scissors' ? name === 'index' ? -.15 : .13
            : name === 'index' ? -.07 : name === 'ring' ? .035 : name === 'pinky' ? .08 : 0;
          this.rotateWorld(bone, normal, spread * weight);
        }
      }
    }
  }
  /** Two iterations align palm/knuckle centres, rather than just wrist origins. */
  reach(contact: THREE.Vector3, normal: THREE.Vector3, finger: THREE.Vector3, shape: HandShape,
    weight: number, forward: THREE.Vector3): void {
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    const pole = right.clone().addScaledVector(up, -.55);
    this.orientHand(normal, finger, weight); this.fingers(shape, normal, finger, weight);
    for (let i = 0; i < 2; i++) {
      const wrist = this.hand.getWorldPosition(new THREE.Vector3());
      const offset = this.getContactPoint(shape).sub(wrist);
      solveCombatTwoBone(this.upper, this.lower, this.hand, contact.clone().sub(offset), weight, pole, .975, Math.PI / 2);
      this.orientHand(normal, finger, weight);
    }
  }
  lookAt(point: THREE.Vector3, _forward: THREE.Vector3, weight: number): void {
    const direction = point.clone().sub(this.getHead()).normalize();
    const world = this.head.getWorldQuaternion(new THREE.Quaternion());
    const current = this.headForwardLocal.clone().applyQuaternion(world).normalize();
    const correction = new THREE.Quaternion().setFromUnitVectors(current, direction);
    const angle = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(correction.w), 0, 1));
    const limited = new THREE.Quaternion().slerp(correction, Math.min(1, .45 / Math.max(angle, 1e-6)) * weight * .7);
    world.premultiply(limited);
    this.head.quaternion.copy(this.head.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world)).normalize();
    this.head.updateWorldMatrix(false, true);
  }
  standing(kind: Exclude<PairAction, 'help-up'>, time: number, common: THREE.Vector3,
    forward: THREE.Vector3, choice?: RpsChoice): void {
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    if (kind === 'rps') {
      const weight = windowWeight(time, 3.85);
      const beat = THREE.MathUtils.clamp((time - .45) / .55, 0, 3);
      const pump = beat < 3 ? .095 * (1 - Math.cos(beat * Math.PI * 2)) / 2 : 0;
      const target = this.getChest().addScaledVector(forward, .30).addScaledVector(right, .19);
      target.y -= .13 + pump;
      const revealed = time >= RPS_REVEAL_SECONDS && choice;
      const reveal = easeCombat((time - RPS_REVEAL_SECONDS) / .16);
      // Every choice remains a fist until the SAME reveal instant on both rigs.
      this.reach(target, up.clone().negate(), forward, 'rock', weight, forward);
      if (revealed) this.fingers(choice, up.clone().negate(), forward, reveal * weight);
      this.rotateWorld(this.find('spine2'), right, .025 * weight);
      return;
    }
    const high = kind === 'high-five', duration = high ? 2.8 : 2.5;
    const weight = windowWeight(time, duration);
    const strike = easeCombat((time - (high ? .68 : .5)) / (high ? .46 : .48));
    const recoil = easeCombat((time - (high ? 1.3 : 1.18)) / .65);
    const target = common.clone().addScaledVector(forward, -.13 * (1 - strike) - .20 * recoil);
    target.y -= (high ? .18 : .07) * (1 - strike) + .13 * recoil;
    this.rotateWorld(this.find('spine2'), right, .055 * weight * strike * (1 - recoil));
    this.reach(target, high ? forward : up.clone().negate(), high ? up : forward,
      high ? 'paper' : 'rock', weight, forward);
  }
  helpStance(contact: THREE.Vector3, forward: THREE.Vector3, weight: number): void {
      this.character.updateWorldMatrix(true, true);
      const legs = ['left', 'right'].map(side => ({ upper: this.require(`${side}upleg`), lower: this.require(`${side}leg`),
        foot: this.require(`${side}foot`), point: this.require(`${side}foot`).getWorldPosition(new THREE.Vector3()),
        rotation: this.require(`${side}foot`).getWorldQuaternion(new THREE.Quaternion()) }));
      const hipWorld = this.hips.getWorldPosition(new THREE.Vector3());
      const floorY = this.floorY;
      const crouch = Math.min(THREE.MathUtils.clamp((this.getChest().y - contact.y - .38) * 1.1, 0, .62) * weight,
        Math.max(0, hipWorld.y - floorY - .26));
      const localBefore = this.hips.parent!.worldToLocal(hipWorld.clone());
      const localAfter = this.hips.parent!.worldToLocal(hipWorld.addScaledVector(up, -crouch));
      this.hips.position.add(localAfter.sub(localBefore)); this.hips.updateWorldMatrix(false, true);
      const right = new THREE.Vector3(forward.z, 0, -forward.x);
      const bend = THREE.MathUtils.clamp(crouch / .45, 0, 1);
      this.rotateWorld(this.hips, right, .20 * bend);
      this.rotateWorld(this.find('spine1'), right, .40 * bend);
      for (const leg of legs) {
        solveCombatTwoBone(leg.upper, leg.lower, leg.foot, leg.point, 1, forward, .995, .4);
        leg.foot.quaternion.copy(leg.foot.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(leg.rotation)).normalize();
        leg.foot.updateWorldMatrix(false, true);
      }
  }
  help(contact: THREE.Vector3, forward: THREE.Vector3, weight: number): void {
    const normal = new THREE.Vector3(-forward.z, 0, forward.x);
    this.reach(contact, normal, forward, 'clasp', weight, forward);
    this.lookAt(contact, forward, weight);
  }
}
