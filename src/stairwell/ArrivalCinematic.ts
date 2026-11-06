import * as THREE from 'three';
import { solveCombatTwoBone } from '../character/CombatRig';
import { EntranceDoorMotion } from './EntranceDoorMotion';
import { retargetEntryMotion, type EntryMotions } from './EntryMotion';
import './arrival-cinematic.css';

const smooth = (value: number): number => { const t = THREE.MathUtils.clamp(value, 0, 1); return t * t * (3 - 2 * t); };
// Finger-depth maxima measured on entry-motion.bin at 120 Hz. The tiny 3.77 /
// 3.83 s double peak belongs to one held key, hence one audible contact at 3.8.
export const KEYPAD_CONTACT_TIMES = [3.033333,3.366667,3.8,4.233333,4.5,4.933333] as const;

/** Uses the host renderer. The selected avatar is a presentation clone only;
 * physics/input stay at the safe interior endpoint until the POV handoff. */
export class ArrivalCinematic {
  readonly root = new THREE.Group();
  readonly finalStandingPosition = new THREE.Vector3();
  readonly warmupRoots: readonly THREE.Object3D[];
  private readonly mixer: THREE.AnimationMixer;
  private readonly code: ReturnType<typeof retargetEntryMotion>;
  private readonly door: ReturnType<typeof retargetEntryMotion>;
  private readonly actions: THREE.AnimationAction[];
  private readonly entrance: EntranceDoorMotion;
  private readonly fill = new THREE.PointLight(0xe3e9e5, 1.1, 4, 2);
  private readonly overlay = document.createElement('div');
  private readonly keypad = new THREE.Group();
  private readonly led = new THREE.MeshBasicMaterial({ color: 0x93733d });
  private readonly blackout = document.createElement('div');
  private readonly caption = document.createElement('p');
  private readonly privateMaterials = new Set<THREE.Material>();
  private readonly origin = new THREE.Vector3(.65, .026, 0);
  private readonly rootMotion = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly headPosition = new THREE.Vector3();
  private readonly contact = new THREE.Vector3();
  private readonly wrist = new THREE.Vector3();
  private readonly handRotation = new THREE.Quaternion();
  private readonly parentRotation = new THREE.Quaternion();
  private readonly contactRotation = new THREE.Quaternion();
  private readonly openingPalm = new THREE.Quaternion();
  private readonly closingPalm = new THREE.Quaternion();
  private readonly head: THREE.Object3D | undefined;
  private readonly arm: THREE.Bone | undefined;
  private readonly forearm: THREE.Bone | undefined;
  private readonly hand: THREE.Bone | undefined;
  private readonly finger: THREE.Object3D | undefined;
  private readonly leftArm: THREE.Bone | undefined;
  private readonly leftForearm: THREE.Bone | undefined;
  private readonly leftHand: THREE.Bone | undefined;
  private readonly leftFinger: THREE.Object3D | undefined;
  private readonly cameraRig = new THREE.PerspectiveCamera();
  private readonly correctedBones: { bone: THREE.Object3D; authored: THREE.Quaternion }[] = [];
  private poseCaptured = false;
  private readonly blendFrom = new THREE.PerspectiveCamera();
  private readonly pov = new THREE.PerspectiveCamera();
  private elapsed = -.7;
  private showing = false;
  private finished = false;
  private disposed = false;
  private previousPhase = '';
  private blending = false;
  private skipped = false;
  private povRevealed = false;
  private keypadCursor = 0;
  private readonly keyMeshes: THREE.Mesh[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    container: HTMLElement,
    private readonly avatar: THREE.Group,
    idle: THREE.AnimationClip,
    motions: EntryMotions,
    entranceDoor: THREE.Object3D,
    private readonly callbacks: { onPOVBlend(): void; onComplete(): void; onDoorSound(opening: boolean): void;
      onAmbienceBlend?(): void; onPOVReveal?(): void; onDispose?(): void;
      onKeypadPress?(position:THREE.Vector3):void; onStopKeypad?():void },
  ) {
    this.root.name = 'arrival-cinematic-actor';
    this.fill.name = 'arrival-cinematic-fill';
    this.root.add(avatar); this.scene.add(this.root, this.fill);
    this.entrance = new EntranceDoorMotion(entranceDoor);
    this.code = retargetEntryMotion(motions.code, avatar);
    this.door = retargetEntryMotion(motions.door, avatar);
    this.mixer = new THREE.AnimationMixer(avatar);
    this.actions = [this.code.clip, this.door.clip, idle].map(clip => {
      const action = this.mixer.clipAction(clip); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play(); action.enabled = false; return action;
    });
    this.head = avatar.getObjectByName('mixamorigHead');
    this.arm = avatar.getObjectByName('mixamorigRightArm') as THREE.Bone | undefined;
    this.forearm = avatar.getObjectByName('mixamorigRightForeArm') as THREE.Bone | undefined;
    this.hand = avatar.getObjectByName('mixamorigRightHand') as THREE.Bone | undefined;
    this.finger = avatar.getObjectByName('mixamorigRightHandIndex2') ?? this.hand;
    this.leftArm = avatar.getObjectByName('mixamorigLeftArm') as THREE.Bone | undefined;
    this.leftForearm = avatar.getObjectByName('mixamorigLeftForeArm') as THREE.Bone | undefined;
    this.leftHand = avatar.getObjectByName('mixamorigLeftHand') as THREE.Bone | undefined;
    this.leftFinger = avatar.getObjectByName('mixamorigLeftHandIndex3') ?? this.leftHand;
    for (const bone of [this.head, this.arm, this.forearm, this.hand, this.leftArm, this.leftForearm, this.leftHand]) {
      if (bone) this.correctedBones.push({ bone, authored: bone.quaternion.clone() });
    }
    // Place the physical keypad at the authored typing finger, on the right
    // leaf, instead of letting the hand enter a code in empty space.
    this.root.position.copy(this.origin).add(this.code.translation(this.code.clip.duration * .48, this.rootMotion));
    this.pose(0, this.code.clip.duration * .48);
    this.root.updateMatrixWorld(true);
    const finger = avatar.getObjectByName('mixamorigLeftHandIndex3') ?? avatar.getObjectByName('mixamorigLeftHand');
    if (!finger) throw new Error('Main du personnage absente.');
    const target = finger.getWorldPosition(new THREE.Vector3());
    const panelZ = this.entrance.closedBounds.min.z - .026;
    this.origin.z = panelZ - .032 - target.z;
    this.root.position.copy(this.origin); target.z = panelZ;
    this.buildKeypad(target);
    this.door.translation(this.door.clip.duration, this.rootMotion);
    this.finalStandingPosition.copy(this.origin).add(this.rootMotion).add(new THREE.Vector3(.45, 0, .45)); this.finalStandingPosition.y = .865;
    // Capture palms relative to the leaf once. Contact then follows the moving
    // door's orientation as well as its position, without accumulating IK.
    for (const [time, opening, hand, palm] of [[1.9, 0, this.hand, this.openingPalm], [5.1, 1, this.leftHand, this.closingPalm]] as const) {
      this.pose(1, time); this.placeActor(time); this.entrance.setOpen(opening);
      if (hand) { hand.getWorldQuaternion(palm); this.entrance.pivot.getWorldQuaternion(this.parentRotation).invert(); palm.premultiply(this.parentRotation); }
    }
    this.fill.position.set(this.origin.x + .5, 2.1, this.origin.z - .35);
    this.sample(0, this.cameraRig);
    this.root.visible = false;
    this.warmupRoots = [this.root];
    this.overlay.className = 'arrival-cinematic'; this.overlay.hidden = true;
    this.overlay.setAttribute('role', 'dialog'); this.overlay.setAttribute('aria-label', 'Entrée dans l’immeuble');
    this.overlay.innerHTML = '<i class="arrival-letterbox top"></i><i class="arrival-letterbox bottom"></i><button type="button">Passer</button>';
    this.blackout.className = 'arrival-blackout'; this.blackout.setAttribute('aria-hidden', 'true');
    this.caption.className = 'arrival-code-caption'; this.caption.setAttribute('aria-live', 'polite');
    this.overlay.append(this.caption, this.blackout);
    container.append(this.overlay);
    this.overlay.querySelector('button')!.addEventListener('click', this.skip);
  }

  get isShowing(): boolean { return this.showing && !this.finished; }
  /** The hinged right leaf, reused by later scripted scenes once the arrival has ended. */
  get entranceMotion(): EntranceDoorMotion { return this.entrance; }

  start(pov: THREE.PerspectiveCamera): void {
    if (this.disposed || this.showing) return;
    this.pov.copy(pov); this.showing = true; this.elapsed = -.7;
    this.root.visible = true; this.overlay.hidden = false;
    this.overlay.querySelector('button')!.focus({ preventScroll: true });
    window.addEventListener('keydown', this.onKey, true);
  }

  update(delta: number, camera: THREE.PerspectiveCamera): void {
    if (!this.isShowing || this.disposed) return;
    // Keep authored speed on a slow frame; background time is filtered by the host.
    this.elapsed += Math.min(.25, Math.max(0, delta));
    const time = Math.max(0, this.elapsed), end = this.code.clip.duration + this.door.clip.duration;
    while(this.keypadCursor<KEYPAD_CONTACT_TIMES.length&&KEYPAD_CONTACT_TIMES[this.keypadCursor]!<=time){
      this.keypadCursor++;
      this.callbacks.onKeypadPress?.(this.keypad.getWorldPosition(new THREE.Vector3()));
    }
    if (time <= end) this.sample(time, camera);
    else {
      if (this.skipped) { camera.position.copy(this.cameraRig.position); camera.quaternion.copy(this.cameraRig.quaternion); camera.fov = this.cameraRig.fov; this.skipped = false; }
      if (!this.blending) this.beginBlend(camera);
      const progress = smooth((time - end) / .95);
      this.pose(2, Math.min(time - end, .5), 1 - smooth((time - end) / .45));
      this.root.position.copy(this.finalStandingPosition); this.root.position.y = .026;
      this.fill.intensity = 1.1 * (1 - progress);
      this.entrance.setOpen(0);
      this.blackout.style.opacity = String(progress < .45 ? smooth(progress / .45) : 1 - smooth((progress - .45) / .55));
      // Cut only under complete occlusion. No visible camera ever enters a head,
      // and ordinary eye/hair meshes need no special transparency shader.
      if (progress >= .45) {
        if (!this.povRevealed) { this.povRevealed = true; this.root.visible = false; this.callbacks.onPOVReveal?.(); }
        this.pov.aspect = camera.aspect; camera.copy(this.pov);
      } else {
        camera.position.lerpVectors(this.blendFrom.position, this.pov.position, progress * .18);
        camera.quaternion.slerpQuaternions(this.blendFrom.quaternion, this.pov.quaternion, progress * .18);
      }
      camera.updateProjectionMatrix();
      if (progress >= 1) { this.pov.aspect = camera.aspect; camera.copy(this.pov); camera.updateProjectionMatrix(); this.finish(); }
    }
  }

  /** Deterministic absolute-time pose/camera sampling, also used by geometry tests. */
  sample(time: number, camera: THREE.PerspectiveCamera): void {
    const codeStage = time < this.code.clip.duration;
    const local = codeStage ? time : Math.min(this.door.clip.duration, time - this.code.clip.duration);
    const motion = codeStage ? this.code : this.door, fraction = local / motion.clip.duration;
    this.pose(codeStage ? 0 : 1, local);
    if (codeStage) this.root.position.copy(this.origin).add(motion.translation(local, this.rootMotion));
    else this.placeActor(local);
    this.root.updateMatrixWorld(true);
    if(codeStage){
      const contact=KEYPAD_CONTACT_TIMES.find(t=>Math.abs(local-t)<.065);
      this.keyMeshes.forEach(key=>{key.position.z=-.004;});
      if(contact!==undefined&&this.leftFinger){
        const finger=this.keypad.worldToLocal(this.leftFinger.getWorldPosition(this.contact));
        const key=this.keyMeshes.reduce((best,key)=>Math.hypot(key.position.x-finger.x,key.position.y-finger.y)<Math.hypot(best.position.x-finger.x,best.position.y-finger.y)?key:best);
        key.position.z=0;
      }
    }
    const phase = codeStage ? 'code' : 'door';
    if (this.showing && phase !== this.previousPhase) {
      if (!codeStage) this.callbacks.onAmbienceBlend?.();
      this.previousPhase = phase;
    }
    this.led.color.set(codeStage && fraction < .65 ? 0x93733d : 0x85b5a0);
    const opening = codeStage || local < 1.9 ? 0 : local < 2.8
      ? .21 * smooth((local - 1.9) / .9) : local < 3.6 ? .21 + .79 * smooth((local - 2.8) / .8)
      : 1 - smooth((local - 5) / .85);
    this.entrance.setOpen(opening);
    if (!codeStage) {
      this.matchDoorHand(local);
      if (this.showing && this.previousPhase === 'door' && opening > 0 && !this.doorSoundPlayed) {
        this.doorSoundPlayed = true; this.callbacks.onDoorSound(true);
      }
      if (this.showing && local >= 5 && this.doorSoundPlayed && !this.doorCloseSoundPlayed) {
        this.doorCloseSoundPlayed = true; this.callbacks.onDoorSound(false);
      }
    }
    const text = codeStage && local >= .45 ? 'Encore ce code… Je veux juste rentrer chez moi.' : '';
    if (this.caption.textContent !== text) this.caption.textContent = text;
    if (codeStage) {
      const target = this.keypad.getWorldPosition(this.look);
      const close = smooth((fraction - .12) / .68);
      this.head?.getWorldPosition(this.headPosition);
      this.headPosition.y += .075;
      camera.position.set(this.headPosition.x + THREE.MathUtils.lerp(1.05, .45, close), this.headPosition.y + .06,
        Math.min(this.headPosition.z + THREE.MathUtils.lerp(-1.2, .4, close), this.entrance.closedBounds.min.z - .20));
      target.lerp(this.headPosition, close);
      camera.lookAt(target); camera.fov = THREE.MathUtils.lerp(52, 38, close);
    } else {
      const p = smooth(fraction);
      camera.position.set(THREE.MathUtils.lerp(-1.05, this.finalStandingPosition.x - .3, p), 1.72, THREE.MathUtils.lerp(this.origin.z - 1.35, this.finalStandingPosition.z - .9, p));
      this.look.copy(this.root.position); this.look.y += THREE.MathUtils.lerp(1.22, 1.55, p);
      // Move around the actor for the closing gesture: the actual leaf remains
      // visible behind the shoulder instead of closing outside the shot.
      const closingShot = smooth((local - 4.45) / .5);
      camera.position.lerp(this.headPosition.set(this.root.position.x - 1.05, 1.72, this.root.position.z + 1), closingShot);
      this.look.z = THREE.MathUtils.lerp(this.look.z, this.entrance.closedBounds.max.z + .5, closingShot * .45);
      camera.lookAt(this.look); camera.fov = 58;
    }
    camera.updateProjectionMatrix();
  }

  private pose(stage: number, time: number, previousWeight = 0): void {
    // AnimationMixer caches unchanged samples. Undo our previous correction
    // before evaluating a held frame, otherwise the head/IK rotates repeatedly.
    if (this.poseCaptured) for (const { bone, authored } of this.correctedBones) bone.quaternion.copy(authored);
    this.actions.forEach(action => { action.enabled = false; action.setEffectiveWeight(0); });
    const current = this.actions[stage]!; current.enabled = true; current.time = time; current.setEffectiveWeight(1);
    if (stage === 1 && time < .2) {
      const w = smooth(time / .2), prior = this.actions[0]!; prior.enabled = true; prior.time = this.code.clip.duration; prior.setEffectiveWeight(1 - w); current.setEffectiveWeight(w);
    } else if (stage === 2 && previousWeight > 0) {
      const prior = this.actions[1]!; prior.enabled = true; prior.time = this.door.clip.duration; prior.setEffectiveWeight(previousWeight); current.setEffectiveWeight(1 - previousWeight);
    }
    this.mixer.update(0);
    for (const { bone, authored } of this.correctedBones) authored.copy(bone.quaternion);
    this.poseCaptured = true;
    this.head?.rotateX(.08);
  }

  private doorSoundPlayed = false;
  private doorCloseSoundPlayed = false;

  private placeActor(time: number): void {
    this.root.position.copy(this.origin).add(this.door.translation(time, this.rootMotion));
    this.root.position.z += .45 * smooth((time - 3.15) / 1.15);
    this.root.position.x += .45 * smooth((time - 3.55) / 1.2);
    this.root.updateMatrixWorld(true);
  }

  private matchDoorHand(time: number): void {
    const weight = smooth((time - 1.5) / .4) * (1 - smooth((time - 2.8) / .3));
    this.matchContact(this.arm, this.forearm, this.hand, this.finger, this.entrance.grip, this.openingPalm, weight);
    const closingWeight = smooth((time - 4.92) / .16) * (1 - smooth((time - 5.2) / .24));
    this.matchContact(this.leftArm, this.leftForearm, this.leftHand, this.leftFinger, this.entrance.closingGrip, this.closingPalm, closingWeight);
  }

  private matchContact(arm: THREE.Bone | undefined, forearm: THREE.Bone | undefined, hand: THREE.Bone | undefined,
    finger: THREE.Object3D | undefined, grip: THREE.Object3D, palm: THREE.Quaternion, weight: number): void {
    if (!arm || !forearm || !hand || !finger || weight <= 0) return;
    hand.getWorldQuaternion(this.handRotation);
    this.entrance.pivot.getWorldQuaternion(this.contactRotation).multiply(palm);
    this.handRotation.slerp(this.contactRotation, weight);
    hand.parent!.getWorldQuaternion(this.parentRotation).invert();
    hand.quaternion.copy(this.parentRotation.multiply(this.handRotation)); arm.updateWorldMatrix(true, true);
    hand.getWorldPosition(this.wrist); finger.getWorldPosition(this.contact);
    this.contact.sub(this.wrist);
    grip.getWorldPosition(this.wrist).sub(this.contact);
    solveCombatTwoBone(arm, forearm, hand, this.wrist, weight, undefined, .985, Math.PI / 4);
    hand.parent!.getWorldQuaternion(this.parentRotation).invert();
    hand.quaternion.copy(this.parentRotation.multiply(this.handRotation)); arm.updateWorldMatrix(false, true);
  }

  private beginBlend(camera: THREE.PerspectiveCamera): void {
    this.blending = true; this.blendFrom.copy(camera); this.callbacks.onPOVBlend();
  }

  private skip = (): void => {
    if (!this.isShowing || this.blending) return;
    this.keypadCursor=KEYPAD_CONTACT_TIMES.length;this.callbacks.onStopKeypad?.();
    this.sample(this.code.clip.duration + this.door.clip.duration, this.cameraRig);
    this.elapsed = this.code.clip.duration + this.door.clip.duration;
    this.skipped = true;
    this.previousPhase = 'door';
  };

  private onKey = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.key === 'F11') return;
    if (['Escape', 'Enter', ' '].includes(event.key) && !event.repeat) { event.preventDefault(); this.skip(); }
    event.stopImmediatePropagation();
  };

  private finish(): void {
    if (this.finished) return;
    this.finished = true; this.root.visible = false; this.overlay.hidden = true; this.fill.intensity = 0;
    this.entrance.setOpen(0);
    if (!this.doorCloseSoundPlayed) { this.doorCloseSoundPlayed = true; this.callbacks.onDoorSound(false); }
    window.removeEventListener('keydown', this.onKey, true);
    this.callbacks.onComplete();
  }

  private buildKeypad(target: THREE.Vector3): void {
    const body = new THREE.MeshStandardMaterial({ color: 0x252c2d, roughness: .9, metalness: .1 });
    const keys = new THREE.MeshStandardMaterial({ color: 0x8e9490, roughness: .85 });
    this.privateMaterials.add(body); this.privateMaterials.add(keys); this.privateMaterials.add(this.led);
    this.keypad.name = 'entrance-code-keypad'; this.keypad.position.copy(target);
    const housing=new THREE.Mesh(new THREE.BoxGeometry(.19,.24,.04),body);housing.position.z=.025;this.keypad.add(housing);
    for (let row = 0; row < 4; row++) for (let column = 0; column < 3; column++) {
      const key = new THREE.Mesh(new THREE.BoxGeometry(.032, .027, .009), keys);
      key.position.set((column - 1) * .05, .05 - row * .044, -.004); this.keypad.add(key);this.keyMeshes.push(key);
    }
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(.08, .012, .007), this.led);
    lamp.position.set(0, .095, -.004); this.keypad.add(lamp);
    this.scene.add(this.keypad); this.scene.updateMatrixWorld(true); this.entrance.attach(this.keypad);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; window.removeEventListener('keydown', this.onKey, true);
    this.callbacks.onStopKeypad?.();
    this.overlay.querySelector('button')!.removeEventListener('click', this.skip); this.overlay.remove();
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.avatar);
    this.keypad.traverse(object => { if ((object as THREE.Mesh).isMesh) (object as THREE.Mesh).geometry.dispose(); });
    this.keypad.removeFromParent(); this.entrance.dispose();
    this.callbacks.onDispose?.();
    this.avatar.traverse(object => { if ((object as THREE.SkinnedMesh).isSkinnedMesh) (object as THREE.SkinnedMesh).skeleton.dispose(); });
    this.privateMaterials.forEach(material => material.dispose());
    // The fill stays parented at zero: removing a PointLight changes Three's
    // light-count shader defines and recompiles every visible material (a 1–2 s
    // hitch on ANGLE/Windows) right when the player takes control.
    this.root.removeFromParent(); this.fill.intensity = 0;
  }
}
