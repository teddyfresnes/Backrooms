import * as THREE from 'three';
import type { ImportedApartmentDoorInteraction } from '../apartment/ImportedApartmentDoorInteraction';
import type { DoorRuntime } from '../apartment/ImportedApartmentEnvironment';
import type { AudioSystem } from '../audio/AudioSystem';
import type { PlayerController } from '../player/PlayerController';
import type { Vec3Data } from '../world/types';
import type { StoryHud } from '../ui/StoryHud';
import type { BacteriaActor } from './BacteriaActor';
import type { BacteriaAudio } from './BacteriaAudio';
import {
  CATCH_RADIUS,
  CHASE_SPEEDS,
  ChasePath,
  CLOSET,
  createChaseWaypoints,
  createEntryWaypoints,
  PLAYER_CENTER_HEIGHT,
  DOOR_BANG_SECONDS,
  REVEAL_TIMELINE as R,
} from './BacteriaLayout';

type Phase =
  | 'dormant' | 'reveal' | 'chase' | 'bang' | 'inside'
  | 'search' | 'leaving' | 'survived' | 'jumpscare' | 'dead';

const EYE_HEIGHT = 0.73;
const UP = new THREE.Vector3(0, 1, 0);
const smooth = (value: number): number => { const t = THREE.MathUtils.clamp(value, 0, 1); return t * t * (3 - 2 * t); };
const lerpAngle = (from: number, to: number, amount: number): number => {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * amount;
};

export interface BacteriaEncounterHost {
  readonly scene: THREE.Scene;
  /** Camera actually rendered (copied from the character rig each frame). */
  readonly renderCamera: THREE.PerspectiveCamera;
  /** Player eye camera (PlayerController), used as the scripted viewpoint. */
  readonly eyeCamera: THREE.PerspectiveCamera;
  readonly player: PlayerController;
  readonly door: ImportedApartmentDoorInteraction;
  readonly closet: DoorRuntime;
  readonly audio: AudioSystem;
  readonly hud: StoryHud;
  setPrompt(label: string | null): void;
  baseFieldOfView(): number;
  sprintKeyLabel(): string;
  /** Hides/shows the player's own avatar (inside the closet). */
  setAvatarHidden(hidden: boolean): void;
  readonly threshold: Readonly<Vec3Data>;
  canStartReveal(): boolean;
  isRevealLampLit(): boolean;
  onReveal(): void;
  onRetry(): void;
  onSurvived(): void;
}

/** The post-outage reveal, chase, breach and hiding sequence. */
export class BacteriaEncounter {
  private phase: Phase = 'dormant';
  private phaseTime = 0;
  private readonly path: ChasePath;
  private readonly entryPath: ChasePath;
  private readonly creatureLight = new THREE.PointLight(0xfff0c2, 0, 7.5, 1.7);
  private revealTime: number | null = null;
  private revealFov = 11.5;
  private distanceAlong = 0;
  private readonly monsterPosition = new THREE.Vector3();
  private monsterYaw = 0;
  private readonly heading = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  private readonly feet = new THREE.Vector3();
  private readonly face = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly lookMatrix = new THREE.Matrix4();
  private readonly lookQuaternion = new THREE.Quaternion();
  private readonly shake = new THREE.Euler();
  private readonly shakeQuaternion = new THREE.Quaternion();
  private readonly raycaster = new THREE.Raycaster();
  private readonly cameraRight = new THREE.Vector3();
  private fov = 0;
  private hidden = false;
  private bangTimer = 0;
  private nextBang = 0;
  private closetAngle = 0;
  private closetTarget = 0;
  private closetSpeed = 6;
  private shakeLevel = 0;
  private searchStage = 0;
  private searchTimer = 0;
  private entryAlong = 0;
  private prompt: string | null = null;
  private closetTimer = 0;
  private seed = 0x51ac7e;
  private deathCause: 'caught' | 'closet' = 'caught';

  constructor(
    private readonly host: BacteriaEncounterHost,
    private readonly actor: BacteriaActor,
    private readonly sound: BacteriaAudio,
  ) {
    this.path = new ChasePath(createChaseWaypoints(host.threshold));
    this.entryPath = new ChasePath(createEntryWaypoints(host.threshold));
    this.creatureLight.name = 'bacteria-creature-light';
    actor.setVisible(false);
    host.scene.add(actor.root, this.creatureLight);
  }

  /** True from the reveal until the outcome: no save, no portal, no other prompt. */
  get isActive(): boolean {
    return this.phase !== 'dormant' && this.phase !== 'survived';
  }

  get isHidden(): boolean { return this.hidden; }

  /** Quest line for the objective tracker (null = let the story decide). */
  get questText(): { text: string; tone: 'calm' | 'urgent' | 'hidden' } | null {
    const inside = this.playerInside();
    switch (this.phase) {
      case 'reveal': return null;
      case 'chase':
        if (inside && !this.host.door.isSecured()) return { text: 'Ferme la porte de l’appartement !', tone: 'urgent' };
        if (inside) return { text: 'Cache-toi dans le placard de l’entrée !', tone: 'urgent' };
        return { text: 'COURS ! Retourne dans l’appartement', tone: 'urgent' };
      case 'bang':
      case 'inside':
        if (this.hidden) return { text: 'Ne bouge plus. Pas un bruit…', tone: 'hidden' };
        return { text: inside ? 'Cache-toi dans le placard de l’entrée !' : 'Il est là. Fuis !', tone: 'urgent' };
      case 'search':
      case 'leaving':
        return { text: 'Ne bouge plus. Pas un bruit…', tone: 'hidden' };
      case 'survived':
        return this.hidden ? { text: 'Il est parti… Sors du placard', tone: 'calm' } : null;
      default: return null;
    }
  }

  update(delta: number): void {
    const dt = Math.max(0, Math.min(0.05, delta));
    this.phaseTime += dt;
    const host = this.host;
    host.eyeCamera.getWorldPosition(this.eye);
    this.feet.copy(host.player.position);
    this.feet.y -= PLAYER_CENTER_HEIGHT;

    if (this.locksInput && host.player.isInputEnabled) host.player.setInputEnabled(false);
    if (this.phase === 'dormant' || this.phase === 'survived') {
      if (this.phase === 'dormant' && host.canStartReveal()) this.startReveal();
      this.animateCloset(dt);
      return;
    }

    switch (this.phase) {
      case 'reveal': this.updateReveal(dt); break;
      case 'chase': this.updateChase(dt); break;
      case 'bang': this.updateBang(dt); break;
      case 'inside': this.updateInside(dt); break;
      case 'search': this.updateSearch(dt); break;
      case 'leaving': this.updateLeaving(dt); break;
      case 'jumpscare': this.updateJumpscare(dt); break;
      case 'dead': this.updateDead(); break;
    }
    // A death resets to the checkpoint inside the switch above.
    if ((this.phase as Phase) === 'dormant') return;
    this.animateCloset(dt);
    this.actor.update(dt);
    this.updateCreatureLight();
    this.updateSound();
    this.shakeLevel = Math.max(0, this.shakeLevel - dt * 2.4);
  }

  /** Runs after the character rig copied its camera: scripted FOV, framing and shake. */
  applyCamera(): void {
    const camera = this.host.renderCamera;
    const base = this.host.baseFieldOfView();
    if (this.phase === 'reveal' || (this.phase === 'chase' && this.phaseTime < R.dezoomDuration + 0.3)) {
      camera.fov = this.fov || base;
      camera.updateProjectionMatrix();
    }
    if (this.hidden && this.phase !== 'jumpscare' && this.phase !== 'dead') {
      // Crouched behind the leaf, watching the entry through the crack.
      const breathe = Math.sin(this.phaseTime * 1.9) * 0.008;
      camera.position.set(CLOSET.hidePosition.x, this.host.threshold.y + 1.5 + breathe, CLOSET.hidePosition.z);
      this.target.set(CLOSET.peekTarget.x, CLOSET.peekTarget.y, CLOSET.peekTarget.z);
      this.lookMatrix.lookAt(camera.position, this.target, UP);
      camera.quaternion.setFromRotationMatrix(this.lookMatrix);
      camera.fov = base * 0.86;
      camera.updateProjectionMatrix();
    }
    if (this.phase === 'jumpscare') {
      camera.position.copy(this.viewer());
      this.actor.getFacePosition(this.target);
      this.lookMatrix.lookAt(camera.position, this.target, UP);
      camera.quaternion.setFromRotationMatrix(this.lookMatrix);
      const t = this.phaseTime;
      camera.fov = base + 22 * Math.exp(-t * 5) + 4;
      camera.updateProjectionMatrix();
    }
    if (this.shakeLevel > 0) {
      const amount = this.shakeLevel * this.shakeLevel * 0.045;
      this.shake.set((this.noise() - 0.5) * amount, (this.noise() - 0.5) * amount, (this.noise() - 0.5) * amount * 1.4);
      camera.quaternion.multiply(this.shakeQuaternion.setFromEuler(this.shake));
    }
  }

  get locksInput(): boolean {
    return this.phase === 'reveal' || this.phase === 'jumpscare' || this.phase === 'dead'
      || this.hidden || (this.phase === 'chase' && this.phaseTime < R.releaseDelay);
  }

  // ---------------------------------------------------------------- reveal

  private startReveal(): void {
    const host = this.host;
    this.setPhase('reveal');
    host.player.prepareScriptedStanding();
    host.player.setInputEnabled(false);
    host.player.setLookLocked(true);
    host.onReveal();
    host.hud.hideHint();
    this.fov = host.baseFieldOfView();
    this.revealTime = null;
    this.distanceAlong = 0;
    this.path.sample(0, this.monsterPosition);
    this.monsterYaw = -Math.PI / 2;
    this.actor.setPlacement(this.monsterPosition, this.monsterYaw);
    this.actor.setMotion('idle');
    this.actor.setLookTarget(null);
  }

  private updateReveal(dt: number): void {
    const host = this.host;
    if (this.revealTime === null && host.isRevealLampLit()) {
      this.revealTime = this.phaseTime;
      this.actor.setVisible(true);
      this.actor.setLookTarget(this.eye);
      this.sound.playTension();
      this.revealFov = THREE.MathUtils.clamp(
        THREE.MathUtils.radToDeg(2 * Math.atan(2.15 / this.eye.distanceTo(this.monsterPosition))),
        10, 24,
      );
    }

    this.target.copy(this.monsterPosition).addScaledVector(UP, 1.6);
    if (this.revealTime !== null) this.actor.getHeadPosition(this.target).addScaledVector(UP, -.32);
    this.lookMatrix.lookAt(this.eye, this.target, UP);
    this.lookQuaternion.setFromRotationMatrix(this.lookMatrix);
    const current = host.player.getLookQuaternion();
    const next = new THREE.Quaternion(current.x, current.y, current.z, current.w)
      .slerp(this.lookQuaternion, 1 - Math.exp(-dt * 5));
    host.player.setLookQuaternion(next);

    if (this.revealTime === null) return;
    const t = this.phaseTime - this.revealTime;
    if (t >= R.headSnap && t - dt < R.headSnap) {
      this.actor.snapHead();
      this.shakeLevel = .35;
    }
    const zoom = smooth(t / R.zoomDuration);
    this.fov = THREE.MathUtils.lerp(host.baseFieldOfView(), this.revealFov, zoom * zoom);
    if (t >= R.charge) this.startChase();
  }

  // ----------------------------------------------------------------- chase

  private startChase(): void {
    this.setPhase('chase');
    this.actor.setMotion('run');
    this.sound.startScream();
    this.shakeLevel = 0.6;
  }

  private updateChase(dt: number): void {
    const host = this.host;
    const t = this.phaseTime;
    const release = R.releaseDelay;
    if (t < R.dezoomDuration + 0.3) {
      const base = host.baseFieldOfView();
      const out = smooth(t / R.dezoomDuration);
      this.fov = THREE.MathUtils.lerp(this.revealFov, base + 9, out) - 9 * smooth((t - R.dezoomDuration) / 0.3);
    }
    if (t >= release && t - dt < release) {
      host.player.setLookLocked(false);
      host.player.setInputEnabled(true);
      host.hud.showHint(host.sprintKeyLabel(), 'COURS !', 4.5, true);
      }

    const inside = this.playerInside();
    if (!inside && this.distanceAlong >= this.path.length) {
      this.pursue(dt, CHASE_SPEEDS.corridor);
    } else {
      this.distanceAlong = Math.min(this.path.length, this.distanceAlong + this.path.speedAt(this.distanceAlong) * dt);
      this.path.sample(this.distanceAlong, this.monsterPosition);
      this.path.heading(this.distanceAlong, this.heading);
      this.faceAlong(this.heading, dt, 12);
    }
    this.actor.setLookTarget(this.eye);
    this.actor.setPlacement(this.monsterPosition, this.monsterYaw);
    if (!inside && this.checkCaught()) return;
    if (inside && this.distanceAlong >= this.path.length - 1e-3) {
      if (host.door.isSecured()) this.startBang();
      else this.enterApartment(false);
    }
  }

  // ------------------------------------------------------------------ door

  private startBang(): void {
    this.setPhase('bang');
    this.bangTimer = DOOR_BANG_SECONDS;
    this.nextBang = 0.1;
    this.path.sample(this.path.length, this.monsterPosition);
    this.monsterYaw = -Math.PI / 2;
    this.actor.setPlacement(this.monsterPosition, this.monsterYaw);
    this.actor.setMotion('bang');
    this.actor.setLookTarget(null);
  }

  private updateBang(dt: number): void {
    const host = this.host;
    this.bangTimer -= dt;
    this.nextBang -= dt;
    if (!host.door.isSecured()) { this.enterApartment(false); return; }
    if (this.nextBang <= 0) {
      this.nextBang = 0.36 + this.noise() * 0.3;
      host.door.jolt(0.9);
      host.audio.impact('door-bang', this.playerInside() ? 0.18 : 0);
      if (this.eye.distanceTo(this.monsterPosition) < 6) this.shakeLevel = Math.max(this.shakeLevel, 0.42);
    }
    this.actor.setPlacement(this.monsterPosition, this.monsterYaw);
    if (this.bangTimer <= 0) this.enterApartment(true);
  }

  private enterApartment(breach: boolean): void {
    const host = this.host;
    if (breach) {
      host.door.breach();
      host.audio.impact('door-burst');
      host.hud.pulseFlash(0.25);
      this.shakeLevel = 1;
    }
    this.sound.startVoice();
    this.entryAlong = 0;
    this.path.sample(this.path.length, this.monsterPosition);
    if (this.hidden) {
      this.setPhase('search');
      this.searchStage = 0;
      this.actor.setMotion('stalk');
    } else {
      this.setPhase('inside');
      this.actor.setMotion('run');
    }
  }

  // --------------------------------------------------------------- inside

  private updateInside(dt: number): void {
    if (this.hidden) {
      // Saw you go in: straight for the closet, then tear it open.
      const arrived = this.walkEntry(dt, CHASE_SPEEDS.apartment);
      this.actor.setLookTarget(this.target.set(CLOSET.hidePosition.x, this.host.threshold.y + 1.5, CLOSET.hidePosition.z));
      if (arrived) {
        this.closetTarget = 1.55;
        this.closetSpeed = 22;
        this.host.audio.impact('closet-rip');
        this.deathCause = 'closet';
        this.startJumpscare();
      }
      return;
    }
    if (this.entryAlong < this.entryPath.cumulative[1]!) {
      this.walkEntry(dt, CHASE_SPEEDS.apartment);
      return;
    }
    this.pursue(dt, CHASE_SPEEDS.apartment);
    this.actor.setLookTarget(this.eye);
    this.actor.setPlacement(this.monsterPosition, this.monsterYaw);
    this.checkCaught();
  }

  /** Follows door → entry → closet front. Returns true once at the closet. */
  private walkEntry(dt: number, speed: number): boolean {
    this.entryAlong = Math.min(this.entryPath.length, this.entryAlong + speed * dt);
    this.entryPath.sample(this.entryAlong, this.monsterPosition);
    this.entryPath.heading(this.entryAlong, this.heading);
    this.faceAlong(this.heading, dt, 8);
    this.actor.setPlacement(this.monsterPosition, this.monsterYaw);
    return this.entryAlong >= this.entryPath.length - 1e-3;
  }

  private updateSearch(dt: number): void {
    const closetEye = this.target.set(CLOSET.hidePosition.x, this.host.threshold.y + 1.45, CLOSET.hidePosition.z);
    if (this.searchStage === 0) {
      // Rushes in, then slows to a broken, sniffing walk.
      const speed = this.entryAlong < 1.6 ? 3.2 : CHASE_SPEEDS.stalk;
      if (this.entryAlong >= 1.6) this.actor.setMotion('stalk');
      this.actor.setLookTarget(this.entryAlong > 2.2 ? closetEye : null);
      if (this.walkEntry(dt, speed)) { this.searchStage = 1; this.searchTimer = 0; this.actor.setMotion('idle'); }
      return;
    }
    this.searchTimer += dt;
    const lean = this.searchStage === 1 ? smooth((this.searchTimer - 1.1) / 1.3) : 1 - smooth(this.searchTimer / 0.9);
    // Faces the crack, not the middle of the leaf: it knows.
    this.monsterYaw = lerpAngle(this.monsterYaw, Math.atan2(CLOSET.hidePosition.x - this.monsterPosition.x, CLOSET.hidePosition.z - this.monsterPosition.z), 1 - Math.exp(-dt * 5));
    this.monsterPosition.set(CLOSET.frontPosition.x + lean * 0.08, CLOSET.frontPosition.y, CLOSET.frontPosition.z + lean * 0.44);
    this.actor.setPlacement(this.monsterPosition, this.monsterYaw);
    this.actor.setLookTarget(closetEye);
    this.sound.setDuck(1 - lean * 0.75);
    if (this.searchStage === 1) {
      if (this.searchTimer > 1.1) this.actor.setMotion('crouch');
      if (this.searchTimer > 1.1 + 1.3 + 2.6) { this.searchStage = 2; this.searchTimer = 0; this.actor.snapHead(); }
    } else if (this.searchTimer > 0.9) {
      this.actor.setMotion('stalk');
      this.actor.setLookTarget(null);
      this.sound.setDuck(1);
      this.setPhase('leaving');
    }
  }

  private updateLeaving(dt: number): void {
    // Back through the door, then away down the stairs.
    if (this.entryAlong > 0) {
      this.entryAlong = Math.max(0, this.entryAlong - (this.entryAlong < 1.6 ? 2.6 : 1.5) * dt);
      this.entryPath.sample(this.entryAlong, this.monsterPosition);
      this.entryPath.heading(this.entryAlong, this.heading).multiplyScalar(-1);
      this.faceAlong(this.heading, dt, 6);
      if (this.entryAlong <= 0) { this.distanceAlong = this.path.length; this.actor.setMotion('run'); }
    } else {
      this.distanceAlong = Math.max(0, this.distanceAlong - 4.4 * dt);
      this.path.sample(this.distanceAlong, this.monsterPosition);
      this.path.heading(this.distanceAlong, this.heading).multiplyScalar(-1);
      this.faceAlong(this.heading, dt, 10);
      if (this.distanceAlong < this.path.length - 14) this.finishSurvived();
    }
    this.actor.setPlacement(this.monsterPosition, this.monsterYaw);
  }

  private finishSurvived(): void {
    this.setPhase('survived');
    this.actor.setVisible(false);
    this.sound.stopAll(2.5);
    this.host.door.releaseBroken();
    this.restoreWorld();
  }

  // -------------------------------------------------------------- outcome

  private checkCaught(): boolean {
    const dy = Math.abs(this.monsterPosition.y - this.feet.y);
    const flat = Math.hypot(this.monsterPosition.x - this.feet.x, this.monsterPosition.z - this.feet.z);
    if (dy > 1.3 || flat > CATCH_RADIUS) return false;
    this.deathCause = 'caught';
    this.startJumpscare();
    return true;
  }

  private startJumpscare(): void {
    const host = this.host;
    this.setPhase('jumpscare');
    host.player.setInputEnabled(false);
    host.player.setLookLocked(true);
    host.hud.hideHint();
    this.actor.setMotion('lunge');
    this.actor.snapHead();
    this.actor.setLookTarget(this.eye);
    this.sound.jumpscare();
    host.audio.impact('door-burst');
    host.hud.pulseFlash(1);
    this.shakeLevel = 1.25;
    this.placeLunge(0);
  }

  /** Puts the face right in front of the viewer, closing in over time. */
  private placeLunge(t: number): void {
    const eye = this.cameraRight.copy(this.viewer());
    const toward = this.heading.copy(this.monsterPosition).sub(eye).setY(0);
    if (this.hidden) toward.set(0, 0, -1);
    if (toward.lengthSq() < 1e-4) this.host.player.getViewDirection(toward).setY(0);
    toward.normalize();
    // The hunched skull hangs well ahead of the root: place the face itself,
    // lunging from arm's length to a hand's breadth from the lens.
    const distance = THREE.MathUtils.lerp(1.15, 0.52, smooth(t / 0.32));
    this.monsterYaw = Math.atan2(-toward.x, -toward.z);
    if (t === 0) this.monsterPosition.copy(eye).addScaledVector(toward, distance + 0.35).setY(eye.y - 1.95);
    for (let pass = 0; pass < 2; pass += 1) {
      this.actor.setPlacement(this.monsterPosition, this.monsterYaw);
      const face = this.actor.getFacePosition(this.face).sub(eye);
      const along = face.x * toward.x + face.z * toward.z;
      this.monsterPosition.addScaledVector(toward, distance - along);
      this.monsterPosition.y -= face.y + 0.06;
    }
    this.actor.setPlacement(this.monsterPosition, this.monsterYaw);
    // Key light between the lens and the face, or it is a black blob.
    this.creatureLight.position.copy(eye).addScaledVector(toward, distance * 0.45).addScaledVector(UP, .35);
  }

  private updateJumpscare(dt: number): void {
    const t = this.phaseTime;
    this.placeLunge(t);
    // A strobing key light and a blown-out hide: the face must read, for a split second.
    const strobe = Math.abs(Math.sin(t * 26));
    this.creatureLight.intensity = 5.5 + strobe * 5;
    this.actor.setExposure(0.35 + strobe * 0.65);
    if (t > 0.16 && t - dt <= 0.16) this.host.hud.pulseFlash(0.85);
    if (t > 0.42 && t - dt <= 0.42) this.host.hud.pulseFlash(0.9);
    this.shakeLevel = Math.max(this.shakeLevel, 0.9);
    if (t >= 1.35) {
      this.setPhase('dead');
      this.sound.stopAll(0);
      this.actor.setVisible(false);
      this.creatureLight.intensity = 0;
      this.host.hud.showDeath(true, this.deathCause === 'closet' ? 'Il savait où tu étais.' : 'Retour à l’entrée du couloir…');
    }
  }

  private updateDead(): void {
    if (this.phaseTime >= 3.2) this.resetToCheckpoint();
  }

  private resetToCheckpoint(): void {
    const host = this.host;
    this.restoreWorld();
    host.hud.showDeath(false);
    host.door.repair();
    this.closetTarget = 0;
    this.closetAngle = 0;
    this.closetTimer = 0;
    this.applyClosetAngle();
    if (this.hidden) host.setAvatarHidden(false);
    this.hidden = false;
    const threshold = host.threshold;
    host.player.teleport({ x: threshold.x + 1.2, y: threshold.y + PLAYER_CENTER_HEIGHT, z: threshold.z });
    this.lookMatrix.lookAt(this.target.set(0, 0, 0), this.heading.set(1, 0, 0), UP);
    host.player.setLookQuaternion(this.lookQuaternion.setFromRotationMatrix(this.lookMatrix));
    host.player.setLookLocked(false);
    host.player.setInputEnabled(true);
    this.setPhase('dormant');
    host.onRetry();
  }

  private restoreWorld(): void {
    this.actor.setVisible(false);
    this.actor.setMotion('idle');
    this.actor.setExposure(0);
    this.sound.setDuck(1);
    this.creatureLight.intensity = 0;
    this.fov = 0;
  }

  // --------------------------------------------------------------- closet

  updatePrompt(position: THREE.Vector3, direction: THREE.Vector3): boolean {
    let label: string | null = null;
    if (this.canHide(position, direction)) label = 'Se cacher dans le placard';
    else if (this.hidden && this.phase === 'survived') label = 'Sortir du placard';
    // Active prompts are republished each frame, like the door ones, so a
    // neighbour clearing its own prompt cannot hide this one.
    if (label !== this.prompt || label) {
      this.prompt = label;
      this.host.setPrompt(label);
    }
    return !!label;
  }

  interact(position: THREE.Vector3, direction: THREE.Vector3): boolean {
    if (this.hidden && this.phase === 'survived') { this.leaveCloset(); return true; }
    if (!this.canHide(position, direction)) return false;
    this.hidden = true;
    this.host.player.setInputEnabled(false);
    this.host.player.setLookLocked(true);
    this.host.setAvatarHidden(true);
    this.host.hud.hideHint();
    this.host.audio.door('open');
    // Swing in, then pull the leaf almost shut behind you.
    this.closetTarget = 1.1;
    this.closetSpeed = 9;
    this.closetTimer = 0.38;
    this.prompt = null;
    this.host.setPrompt(null);
    return true;
  }

  private canHide(position: THREE.Vector3, direction: THREE.Vector3): boolean {
    if (this.hidden) return false;
    if (this.phase !== 'chase' && this.phase !== 'bang' && this.phase !== 'inside') return false;
    if (!this.playerInside()) return false;
    const eye = this.eye.set(position.x, position.y + EYE_HEIGHT, position.z);
    this.raycaster.set(eye, direction.clone().normalize());
    this.raycaster.far = CLOSET.interactDistance;
    return this.raycaster.intersectObject(this.host.closet.leaf, true).length > 0;
  }

  private leaveCloset(): void {
    const host = this.host;
    this.hidden = false;
    host.setAvatarHidden(false);
    host.player.setLookLocked(false);
    host.player.setInputEnabled(true);
    host.audio.door('open');
    this.closetTarget = 0.9;
    this.closetSpeed = 6;
    this.closetTimer = 0.9;
    host.hud.setQuest('Tu as survécu… pour cette nuit.', 'calm');
    this.setPhase('dormant');
    host.onSurvived();
  }

  private animateCloset(dt: number): void {
    // Played time, not wall time: a pause never skips the leaf's second move.
    if (this.closetTimer > 0) {
      this.closetTimer -= dt;
      if (this.closetTimer <= 0) {
        if (this.hidden && this.phase !== 'jumpscare') {
          this.closetTarget = CLOSET.peekAngle; this.closetSpeed = 5; this.host.audio.door('close');
        } else if (!this.hidden) {
          this.closetTarget = 0; this.closetSpeed = 4;
        }
      }
    }
    if (Math.abs(this.closetAngle - this.closetTarget) < 1e-4) return;
    this.closetAngle = THREE.MathUtils.lerp(this.closetAngle, this.closetTarget, 1 - Math.exp(-dt * this.closetSpeed));
    this.applyClosetAngle();
  }

  private applyClosetAngle(): void {
    this.host.closet.pivot.rotation.y = this.host.closet.closedAngle + this.closetAngle;
    this.host.closet.pivot.updateMatrixWorld(true);
  }

  // -------------------------------------------------------------- helpers

  private pursue(dt: number, speed: number): void {
    const toward = this.heading.copy(this.feet).sub(this.monsterPosition);
    const flat = Math.hypot(toward.x, toward.z);
    if (flat > 1e-3) {
      const step = Math.min(flat, speed * dt);
      this.monsterPosition.x += (toward.x / flat) * step;
      this.monsterPosition.z += (toward.z / flat) * step;
      this.faceAlong(toward.setY(0).normalize(), dt, 10);
    }
    this.monsterPosition.y = THREE.MathUtils.lerp(this.monsterPosition.y, this.feet.y, 1 - Math.exp(-dt * 6));
  }

  private faceAlong(direction: THREE.Vector3, dt: number, rate: number): void {
    if (direction.lengthSq() < 1e-6) return;
    this.monsterYaw = lerpAngle(this.monsterYaw, Math.atan2(direction.x, direction.z), 1 - Math.exp(-dt * rate));
  }

  /** Where the player actually sees from: the closet crack while hidden. */
  private viewer(): THREE.Vector3 {
    return this.hidden ? this.face.set(CLOSET.hidePosition.x, this.host.threshold.y + 1.5, CLOSET.hidePosition.z) : this.eye;
  }

  private playerInside(): boolean {
    const position = this.host.player.position;
    return position.x < this.host.threshold.x - .15 && position.y > this.host.threshold.y + .3;
  }

  private updateCreatureLight(): void {
    if (this.phase === 'jumpscare') return;
    if (!this.actor.root.visible) {
      this.creatureLight.intensity = 0;
      return;
    }
    this.creatureLight.position.copy(this.monsterPosition).addScaledVector(UP, 2.8);
    this.creatureLight.position.x += this.phase === 'reveal' ? .55 : -.55;
    this.creatureLight.intensity = this.phase === 'reveal' ? 4.8 : 3.7;
  }

  private updateSound(): void {
    if (!this.actor.root.visible) return;
    const distance = this.eye.distanceTo(this.monsterPosition.clone().setY(this.monsterPosition.y + 1.6));
    this.host.renderCamera.getWorldDirection(this.heading);
    this.cameraRight.crossVectors(this.heading, UP).normalize();
    const toward = this.target.copy(this.monsterPosition).sub(this.eye).setY(0);
    const pan = toward.lengthSq() > 1e-6 ? toward.normalize().dot(this.cameraRight) : 0;
    const insideSplit = this.playerInside() !== (this.monsterPosition.x < this.host.threshold.x - .15);
    const occlusion = (insideSplit && this.host.door.isSecured() ? .62 : 0) + (this.hidden ? .18 : 0);
    this.sound.updateSpatial(distance, pan, occlusion);
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.phaseTime = 0;
  }

  private noise(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  dispose(): void {
    this.sound.dispose();
    this.restoreWorld();
    this.actor.dispose();
    this.creatureLight.removeFromParent();
  }
}
