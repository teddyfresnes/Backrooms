import * as THREE from 'three';
import { prepareRagdollHeadMask, installRagdollHeadMask } from '../character/RagdollHeadMask';
import { EntranceDoorMotion } from './EntranceDoorMotion';
import { retargetEntryMotion, type EntryMotions } from './EntryMotion';
import './arrival-cinematic.css';

const smooth = (value: number): number => { const t = THREE.MathUtils.clamp(value, 0, 1); return t * t * (3 - 2 * t); };

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
  private readonly headMask = { value: 0 };
  private readonly privateMaterials = new Set<THREE.Material>();
  private readonly origin = new THREE.Vector3(.65, .026, 0);
  private readonly rootMotion = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly cameraRig = new THREE.PerspectiveCamera();
  private readonly blendFrom = new THREE.PerspectiveCamera();
  private readonly pov = new THREE.PerspectiveCamera();
  private elapsed = -.7;
  private showing = false;
  private finished = false;
  private disposed = false;
  private previousPhase = '';
  private blending = false;
  private skipped = false;

  constructor(
    private readonly scene: THREE.Scene,
    container: HTMLElement,
    private readonly avatar: THREE.Group,
    idle: THREE.AnimationClip,
    motions: EntryMotions,
    entranceDoor: THREE.Object3D,
    private readonly callbacks: { onPOVBlend(): void; onComplete(): void; onDoorSound(opening: boolean): void },
  ) {
    this.root.name = 'arrival-cinematic-actor';
    this.root.add(avatar); this.scene.add(this.root, this.fill);
    this.entrance = new EntranceDoorMotion(entranceDoor);
    this.code = retargetEntryMotion(motions.code, avatar);
    this.door = retargetEntryMotion(motions.door, avatar);
    this.mixer = new THREE.AnimationMixer(avatar);
    this.actions = [this.code.clip, this.door.clip, idle].map(clip => {
      const action = this.mixer.clipAction(clip); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play(); action.enabled = false; return action;
    });
    prepareRagdollHeadMask(avatar);
    avatar.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const clone = (source: THREE.Material): THREE.Material => {
        const material = source.clone(); this.privateMaterials.add(material);
        if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) installRagdollHeadMask(material, this.headMask);
        return material;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material);
    });
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
    this.finalStandingPosition.copy(this.origin).add(this.rootMotion); this.finalStandingPosition.y = .865;
    this.fill.position.set(this.origin.x + .5, 2.1, this.origin.z - .35);
    this.sample(0, this.cameraRig);
    this.root.visible = false;
    this.warmupRoots = [this.root];
    this.overlay.className = 'arrival-cinematic'; this.overlay.hidden = true;
    this.overlay.setAttribute('role', 'dialog'); this.overlay.setAttribute('aria-label', 'Entrée dans l’immeuble');
    this.overlay.innerHTML = '<i class="arrival-letterbox top"></i><i class="arrival-letterbox bottom"></i><button type="button">Passer</button>';
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
    this.elapsed += Math.min(.05, Math.max(0, delta));
    const time = Math.max(0, this.elapsed), end = this.code.clip.duration + this.door.clip.duration;
    if (time <= end) this.sample(time, camera);
    else {
      if (this.skipped) { camera.position.copy(this.cameraRig.position); camera.quaternion.copy(this.cameraRig.quaternion); camera.fov = this.cameraRig.fov; this.skipped = false; }
      if (!this.blending) this.beginBlend(camera);
      const progress = smooth((time - end) / .95);
      this.pose(2, Math.min(time - end, .5), 1 - smooth((time - end) / .45));
      this.root.position.copy(this.finalStandingPosition); this.root.position.y = .026;
      this.headMask.value = progress > .55 ? 1 : 0;
      this.fill.intensity = 1.1 * (1 - progress);
      this.entrance.setOpen(1 - smooth((progress - .2) / .8));
      camera.position.lerpVectors(this.blendFrom.position, this.pov.position, progress);
      camera.quaternion.slerpQuaternions(this.blendFrom.quaternion, this.pov.quaternion, progress);
      camera.fov = THREE.MathUtils.lerp(this.blendFrom.fov, this.pov.fov, progress); camera.updateProjectionMatrix();
      if (progress >= 1) { this.pov.aspect = camera.aspect; camera.copy(this.pov); camera.updateProjectionMatrix(); this.finish(); }
    }
  }

  /** Deterministic absolute-time pose/camera sampling, also used by geometry tests. */
  sample(time: number, camera: THREE.PerspectiveCamera): void {
    const codeStage = time < this.code.clip.duration;
    const local = codeStage ? time : Math.min(this.door.clip.duration, time - this.code.clip.duration);
    const motion = codeStage ? this.code : this.door, fraction = local / motion.clip.duration;
    this.pose(codeStage ? 0 : 1, local);
    this.root.position.copy(this.origin).add(motion.translation(local, this.rootMotion));
    this.root.updateMatrixWorld(true);
    const phase = codeStage ? 'code' : 'door';
    if (this.showing && phase !== this.previousPhase) {
      if (!codeStage) this.callbacks.onDoorSound(true);
      this.previousPhase = phase;
    }
    this.led.color.set(codeStage && fraction < .65 ? 0x93733d : 0x85b5a0);
    this.entrance.setOpen(codeStage ? 0 : smooth((fraction - .2) / .34));
    if (codeStage) {
      const target = this.keypad.getWorldPosition(this.look);
      camera.position.set(this.origin.x + THREE.MathUtils.lerp(1.35, .8, smooth(fraction)), THREE.MathUtils.lerp(1.85, 1.55, fraction), this.origin.z - THREE.MathUtils.lerp(1.35, .65, fraction));
      camera.lookAt(target); camera.fov = THREE.MathUtils.lerp(54, 43, smooth(fraction));
    } else {
      const p = smooth(fraction);
      camera.position.set(THREE.MathUtils.lerp(-1.05, this.finalStandingPosition.x - .3, p), 1.72, THREE.MathUtils.lerp(this.origin.z - 1.35, this.finalStandingPosition.z - .9, p));
      this.look.copy(this.root.position).add(new THREE.Vector3(0, THREE.MathUtils.lerp(1.22, 1.55, p), 0));
      camera.lookAt(this.look); camera.fov = 58;
    }
    camera.updateProjectionMatrix();
  }

  private pose(stage: number, time: number, previousWeight = 0): void {
    this.actions.forEach(action => { action.enabled = false; action.setEffectiveWeight(0); });
    const current = this.actions[stage]!; current.enabled = true; current.time = time; current.setEffectiveWeight(1);
    if (stage === 1 && time < .2) {
      const w = smooth(time / .2), prior = this.actions[0]!; prior.enabled = true; prior.time = this.code.clip.duration; prior.setEffectiveWeight(1 - w); current.setEffectiveWeight(w);
    } else if (stage === 2 && previousWeight > 0) {
      const prior = this.actions[1]!; prior.enabled = true; prior.time = this.door.clip.duration; prior.setEffectiveWeight(previousWeight); current.setEffectiveWeight(1 - previousWeight);
    }
    this.mixer.update(0);
  }

  private beginBlend(camera: THREE.PerspectiveCamera): void {
    this.blending = true; this.blendFrom.copy(camera); this.callbacks.onPOVBlend();
  }

  private skip = (): void => {
    if (!this.isShowing || this.blending) return;
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
    this.entrance.setOpen(0); this.callbacks.onDoorSound(false);
    window.removeEventListener('keydown', this.onKey, true);
    this.callbacks.onComplete();
  }

  private buildKeypad(target: THREE.Vector3): void {
    const body = new THREE.MeshStandardMaterial({ color: 0x252c2d, roughness: .9, metalness: .1 });
    const keys = new THREE.MeshStandardMaterial({ color: 0x8e9490, roughness: .85 });
    this.privateMaterials.add(body); this.privateMaterials.add(keys); this.privateMaterials.add(this.led);
    this.keypad.name = 'entrance-code-keypad'; this.keypad.position.copy(target);
    this.keypad.add(new THREE.Mesh(new THREE.BoxGeometry(.19, .24, .04), body));
    for (let row = 0; row < 4; row++) for (let column = 0; column < 3; column++) {
      const key = new THREE.Mesh(new THREE.BoxGeometry(.032, .027, .009), keys);
      key.position.set((column - 1) * .05, .05 - row * .044, -.025); this.keypad.add(key);
    }
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(.08, .012, .007), this.led);
    lamp.position.set(0, .095, -.025); this.keypad.add(lamp);
    this.scene.add(this.keypad); this.scene.updateMatrixWorld(true); this.entrance.attach(this.keypad);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; window.removeEventListener('keydown', this.onKey, true);
    this.overlay.querySelector('button')!.removeEventListener('click', this.skip); this.overlay.remove();
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.avatar);
    this.keypad.traverse(object => { if ((object as THREE.Mesh).isMesh) (object as THREE.Mesh).geometry.dispose(); });
    this.keypad.removeFromParent(); this.entrance.dispose();
    this.avatar.traverse(object => { if ((object as THREE.SkinnedMesh).isSkinnedMesh) (object as THREE.SkinnedMesh).skeleton.dispose(); });
    this.privateMaterials.forEach(material => material.dispose());
    this.root.removeFromParent(); this.fill.removeFromParent();
  }
}
