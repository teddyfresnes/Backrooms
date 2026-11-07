import * as THREE from 'three';
import type { ImportedApartmentDoorInteraction } from '../apartment/ImportedApartmentDoorInteraction';
import type { DoorRuntime } from '../apartment/ImportedApartmentEnvironment';
import type { AudioSystem } from '../audio/AudioSystem';
import type { PlayerController } from '../player/PlayerController';
import type { Vec3Data } from '../world/types';
import type { StoryHud } from '../ui/StoryHud';
import type { BacteriaActor } from './BacteriaActor';
import type { BacteriaAudio } from './BacteriaAudio';
import { BackroomsBelow, BELOW_TOP_Y } from './BackroomsBelow';
import {
  BACTERIA_SPAWN_DISTANCE,
  CALM_SECONDS,
  CATCH_RADIUS,
  ChasePath,
  CHASE_SPEEDS,
  CLOSET,
  HIDE_SPOTS,
  type HideSpotId,
  corridorChargeSpeed,
  createEntryWaypoints,
  createEscapeWaypoints,
  createLureWaypoints,
  DOOR_BANG_SECONDS,
  ESCAPE_RUN,
  isOutsideHall,
  FACADE_OUTER_Z,
  isTripPosition,
  PLAYER_CENTER_HEIGHT,
  REVEAL_TIMELINE as R,
  SNEAK_HOLD_SECONDS,
  SPOTTED_TIMELINE as S,
  TELEVISION,
} from './BacteriaLayout';

type Phase =
  | 'dormant' | 'reveal' | 'chase' | 'bang' | 'inside' | 'search' | 'lure' | 'grab' | 'carry'
  | 'sneak' | 'burst' | 'spotted' | 'escape' | 'escaped' | 'aftermath' | 'over' | 'jumpscare' | 'dead';
type DeathCause = 'caught' | 'closet' | 'silence' | 'noise' | 'stairs';
type Checkpoint = 'corridor' | 'closet';

const EYE_HEIGHT = 0.73;
/** The player may keep running at it during the reveal, but never closer than this. */
const REVEAL_CLOSEST = 14;
const UP = new THREE.Vector3(0, 1, 0);
const smooth = (value: number): number => { const t = THREE.MathUtils.clamp(value, 0, 1); return t * t * (3 - 2 * t); };
const lerpAngle = (from: number, to: number, amount: number): number => {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * amount;
};
const crossed = (time: number, delta: number, mark: number): boolean => time >= mark && time - delta < mark;
/** After the roar, this long before the head whips round to the flight down. */
const SPOTTED_STAIR_TURN_DELAY = 0.2;
/** Down the stairs it hangs this far behind a running player (path metres). */
const ESCAPE_FOLLOW_GAP = 3.4;
/** Slower than this along the route for this long, and the gap closes. */
const ESCAPE_STALL_RATE = 2.4;
const ESCAPE_STALL_SECONDS = 1.2;
/** A point a couple of treads down the flight leaving the apartment landing. */
const STAIR_LOOK_TARGET = { x: 1.05, z: -0.9 } as const;
const STAIR_LOOK_DROP = 0.75;
/** The kill: the face hits the lens, the player is thrown down, then mauled. */
const KILL_IMPACT = 0.24;
const KILL_STRIKES = [KILL_IMPACT, 0.58, 0.84, 1.04, 1.22, 1.38, 1.52] as const;
const KILL_CUT = 1.72;
const ROLL_AXIS = new THREE.Vector3(0, 0, 1);
/** Out in the dark street: the foot catches, the body hits the ground and
 * keeps going, through it: a long fall in the black, turning over to see the
 * yellow maze of the Backrooms far below, rushing up, then the cut. */
const FALL_HIT = 0.4;
const FALL_SINK = 0.5;
const FALL_GRAVITY = 12;
/** Looking back up at the hole, then turning over to face the drop. */
const FALL_TURN_START = 1.25;
const FALL_TURN_END = 2.25;
/** Just under the wall tops: into a corridor, the light floods everything. */
const FALL_CUT_DEPTH = 1.2;
const FALL_FADE = 0.45;

export interface BacteriaEncounterHost {
  readonly scene: THREE.Scene;
  /** Camera actually rendered (copied from the character rig each frame). */
  readonly renderCamera: THREE.PerspectiveCamera;
  /** Player eye camera (PlayerController), used as the scripted viewpoint. */
  readonly eyeCamera: THREE.PerspectiveCamera;
  readonly player: PlayerController;
  readonly door: ImportedApartmentDoorInteraction;
  /** The bedroom wardrobe (ClosetHide): the hunt decides when the player may leave it. */
  readonly hideSpot: {
    canHide(): boolean;
    /** The place in use (or the one just chosen). Defaults to the wardrobe. */
    current?(): HideSpotId;
    /** Climb in now (also on a checkpoint restart), into `spot` when given. */
    hide(spot?: HideSpotId): void;
    /** The careful exit follows the held key (0..1). */
    holdExit?(progress: number): void;
    /** Let go too early: out at once, noisily. */
    burstOut?(): void;
    /** Climb out (the silent exit). */
    release(): void;
    /** Out at once, without animation (a restart elsewhere). */
    forceOut(): void;
  };
  readonly audio: AudioSystem;
  readonly hud: StoryHud;
  /** The real set on its sideboard; carried away when it lures the creature. */
  readonly television?: THREE.Object3D;
  setPrompt(label: string | null): void;
  baseFieldOfView(): number;
  sprintKeyLabel(): string;
  /** Label of the interact key (E): the silent exit from a hiding place is held on it. */
  interactKeyLabel?(): string;
  /** Whether interact is physically held right now (works while input is locked). */
  isInteractHeld?(): boolean;
  /** The set switches itself on: the lure no longer depends on the player's noise. */
  turnTelevisionOn?(): void;
  /** Whether the sprint key is physically held right now (works while input is locked). */
  isSprintHeld(): boolean;
  /** Hides/shows the player's own avatar (inside the closet). */
  setAvatarHidden(hidden: boolean): void;
  readonly threshold: Readonly<Vec3Data>;
  canStartReveal(): boolean;
  isRevealLampLit(): boolean;
  isTelevisionOn(): boolean;
  onReveal(): void;
  /** The door just gave way: the corridor lamps die behind the creature. */
  onBreach(): void;
  /** Hidden for good, creature deep inside: the stairwell takes the corridor's place. */
  restoreStairwell(): void;
  /** The ground-floor hall door swings open on the dark, rainy street. */
  openEscape(): void;
  /** Falling through the world: 0 (black void) .. 1 (the fluorescent yellow below). */
  setFallTint?(level: number): void;
  /** Screen to black at the end of the fall (0..1), before the loading screen. */
  setFade?(level: number): void;
  onRetry(checkpoint: Checkpoint): void;
  /** Through the hall door: hand over to the Backrooms. */
  onEscaped(): void;
}

/** Post-outage reveal, chase, breach, hiding, silent exit and escape down the stairwell. */
export class BacteriaEncounter {
  private phase: Phase = 'dormant';
  private phaseTime = 0;
  private spot: HideSpotId = 'wardrobe';
  private readonly entryPaths: Record<HideSpotId, ChasePath>;
  private readonly lurePaths = Object.fromEntries((Object.keys(HIDE_SPOTS) as HideSpotId[])
    .map(id => [id, new ChasePath(createLureWaypoints(id))])) as Record<HideSpotId, ChasePath>;
  /** Door → front of the hiding place actually in use. */
  private get entryPath(): ChasePath { return this.entryPaths[this.spot]; }
  private get lurePath(): ChasePath { return this.lurePaths[this.spot]; }
  private get hideLayout() { return HIDE_SPOTS[this.spot]; }
  private readonly escapePath = new ChasePath(createEscapeWaypoints());
  private readonly creatureLight = new THREE.PointLight(0xfff0c2, 0, 7.5, 1.7);
  private revealTime: number | null = null;
  private revealFov = 11.5;
  private chargeTime = 0;
  private distanceAlong = 0;
  private readonly monsterPosition = new THREE.Vector3();
  private monsterYaw = 0;
  private targetYaw: number | null = null;
  private yawRate = 10;
  private readonly heading = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  private readonly feet = new THREE.Vector3();
  private readonly previousFeet = new THREE.Vector3();
  private readonly face = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private readonly gazeToward = new THREE.Vector3();
  private readonly gazeView = new THREE.Vector3();
  private readonly lookMatrix = new THREE.Matrix4();
  private readonly lookQuaternion = new THREE.Quaternion();
  private readonly nextLook = new THREE.Quaternion();
  private readonly shake = new THREE.Euler();
  private readonly shakeQuaternion = new THREE.Quaternion();
  private readonly raycaster = new THREE.Raycaster();
  private readonly closetBox = new THREE.Box3();
  private readonly cameraRight = new THREE.Vector3();
  private fov = 0;
  private hidden = false;
  private bangTimer = 0;
  private nextBang = 0;
  private closetAngle = 0;
  private closetTarget = 0;
  private closetSpeed = 6;
  private shakeLevel = 0;
  /** Decaying jolt of the last blow (camera roll and FOV punch). */
  private hitKick = 0;
  private hitSign = 1;
  private readonly rollQuaternion = new THREE.Quaternion();
  private searchStage = 0;
  private searchTimer = 0;
  private entryAlong = 0;
  private lureAlong = 0;
  private prompt: string | null = null;
  private closetTimer = 0;
  private seed = 0x51ac7e;
  private deathCause: DeathCause = 'caught';
  private checkpoint: Checkpoint = 'corridor';
  private stairwellRestored = false;
  private calm = 0;
  private hold = 0;
  private holdWasDown = false;
  private runningTime = 0;
  private outsideTime = 0;
  private readonly fallFrom = new THREE.Vector3();
  private readonly fallForward = new THREE.Vector3();
  private readonly fallEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private fallYaw = 0;
  private lastPlayerAlong = Number.NaN;
  private playerRate = 0;
  private stallTime = 0;
  /** Time into the fall when the camera reaches the maze (computed at the trip). */
  private fallCut = 4;
  private readonly below = new BackroomsBelow();
  private television?: {
    readonly object: THREE.Object3D; readonly parent: THREE.Object3D;
    readonly position: THREE.Vector3; readonly quaternion: THREE.Quaternion; readonly scale: THREE.Vector3;
    readonly pivot: THREE.Group; readonly from: THREE.Vector3; readonly fromQuaternion: THREE.Quaternion;
    state: 'shelf' | 'lifting' | 'held' | 'falling' | 'floor'; time: number; velocity: number;
  };

  constructor(
    private readonly host: BacteriaEncounterHost,
    private readonly actor: BacteriaActor,
    private readonly sound: BacteriaAudio,
  ) {
    this.entryPaths = Object.fromEntries((Object.keys(HIDE_SPOTS) as HideSpotId[])
      .map(id => [id, new ChasePath(createEntryWaypoints(host.threshold, id))])) as Record<HideSpotId, ChasePath>;
    this.creatureLight.name = 'bacteria-creature-light';
    actor.setVisible(false);
    host.scene.add(actor.root, this.creatureLight, this.below.group);
  }

  /** The maze under the street: compiled with the rest at load. */
  get warmupRoots(): readonly THREE.Object3D[] { return [this.below.warmupRoot]; }

  /** True from the reveal until the outcome: no save, no portal, no other prompt. */
  get isActive(): boolean {
    return this.phase !== 'dormant' && this.phase !== 'aftermath' && this.phase !== 'over';
  }

  get isHidden(): boolean { return this.hidden; }

  /** 0 (nowhere near) .. 1 (on top of the player): what drives Chloé's compass mad. */
  get creatureProximity(): number {
    if (this.phase === 'dormant' || this.phase === 'over' || this.phase === 'aftermath' || this.phase === 'dead' || !this.actor.root.visible) return 0;
    const distance = this.monsterPosition.distanceTo(this.feet);
    return 1 - THREE.MathUtils.smoothstep(distance, 3, 24);
  }

  /** How badly the "camera" degrades, 0..1: rises as the creature gets close
   * or fills the view, and peaks during the kill. Drives the VHS layer. */
  get cameraDisturbance(): number {
    if (this.phase === 'escaped') {
      const t = this.phaseTime;
      // Heavy through the ground, then clearing so the maze below reads.
      return t < FALL_SINK ? 0.3 + 0.45 * smooth(t / FALL_HIT) : THREE.MathUtils.lerp(0.78, 0.36, smooth((t - FALL_TURN_START) / 1.6));
    }
    if (this.phase === 'jumpscare') return Math.min(1, 0.74 + this.hitKick * 0.18 + Math.abs(Math.sin(this.phaseTime * 19)) * 0.08);
    if (this.phase === 'dormant' || this.phase === 'dead' || this.phase === 'over' || this.phase === 'aftermath') return 0;
    if ((this.actor as { isVisible?: boolean }).isVisible === false) return 0;
    if (this.phase === 'reveal' && this.revealTime === null) return 0;
    const camera = this.host.renderCamera;
    const toward = this.gazeToward.copy(this.monsterPosition).addScaledVector(UP, 1.2).sub(camera.position);
    const distance = toward.length();
    const near = THREE.MathUtils.clamp(1 - distance / 16, 0, 1);
    camera.getWorldDirection(this.gazeView);
    const facing = THREE.MathUtils.clamp((this.gazeView.dot(toward.normalize()) - 0.82) / 0.16, 0, 1);
    // Looked at, even from afar, it still corrupts the picture a little.
    const gaze = facing * (0.35 + 0.4 * THREE.MathUtils.clamp(1 - distance / 120, 0, 1));
    const hidden = this.hidden ? 0.1 : 0;
    return THREE.MathUtils.clamp(near * near * 0.52 + gaze * 0.34 + hidden + this.shakeLevel * 0.08, 0, 0.6);
  }

  /** Quest line for the objective tracker (null = let the story decide). */
  get questText(): { text: string; tone: 'calm' | 'urgent' | 'hidden' } | null {
    const inside = this.playerInside();
    switch (this.phase) {
      case 'reveal': return null;
      case 'chase':
        if (inside && !this.host.door.isSecured()) return { text: 'Ferme la porte de l’appartement !', tone: 'urgent' };
        if (inside) return { text: 'Cache-toi dans le placard de la chambre ! (E)', tone: 'urgent' };
        return { text: 'COURS ! Retourne dans l’appartement', tone: 'urgent' };
      case 'bang':
      case 'inside':
        if (this.hidden) return { text: 'Ne bouge plus. Pas un bruit…', tone: 'hidden' };
        return { text: inside ? 'Cache-toi dans le placard de la chambre ! (E)' : 'Il est là. Fuis !', tone: 'urgent' };
      case 'search':
      case 'lure':
      case 'grab':
        return { text: 'Ne bouge plus. Pas un bruit…', tone: 'hidden' };
      case 'carry':
        return this.calm >= 1
          ? { text: `Sortir sans bruit — maintenir ${this.exitKeyLabel()}`, tone: 'hidden' }
          : { text: 'Attends qu’il se calme…', tone: 'hidden' };
      case 'sneak': return { text: 'Sors de l’appartement… sans courir.', tone: 'hidden' };
      case 'spotted':
      case 'escape': return { text: 'Descends l’escalier ! Sors dans la rue !', tone: 'urgent' };
      case 'aftermath': return { text: 'Descendre et sortir dans la rue.', tone: 'calm' };
      default: return null;
    }
  }

  get locksInput(): boolean {
    return this.phase === 'jumpscare' || this.phase === 'dead' || this.phase === 'escaped'
      || this.hidden || (this.phase === 'spotted' && this.phaseTime < S.release);
  }

  /**
   * The reveal frames the creature on a long lens while the player keeps full
   * control, running at it included; only the last metres are refused.
   */
  constrainMovement(position: THREE.Vector3, movement: THREE.Vector3): void {
    if (this.phase !== 'reveal') return;
    const limit = this.monsterPosition.x - REVEAL_CLOSEST;
    if (movement.x > 0 && position.x + movement.x > limit) movement.x = Math.max(0, limit - position.x);
  }

  update(delta: number): void {
    const dt = Math.max(0, Math.min(0.05, delta));
    this.phaseTime += dt;
    const host = this.host;
    host.eyeCamera.getWorldPosition(this.eye);
    this.previousFeet.copy(this.feet);
    this.feet.copy(host.player.position);
    this.feet.y -= PLAYER_CENTER_HEIGHT;

    if (this.phase === 'over') return;
    if (this.locksInput && host.player.isInputEnabled) host.player.setInputEnabled(false);
    if (this.phase === 'dormant') {
      if (host.canStartReveal()) this.startReveal();
      this.animateCloset(dt);
      return;
    }
    if (this.phase === 'aftermath') {
      if (isTripPosition(host.player.position)) this.startEscaped();
      return;
    }

    switch (this.phase) {
      case 'reveal': this.updateReveal(dt); break;
      case 'chase': this.updateChase(dt); break;
      case 'bang': this.updateBang(dt); break;
      case 'inside': this.updateInside(dt); break;
      case 'search': this.updateSearch(dt); break;
      case 'lure': this.updateLure(dt); break;
      case 'grab': this.updateGrab(dt); break;
      case 'carry': this.updateCarry(dt); break;
      case 'sneak': this.updateSneak(dt); break;
      case 'burst': this.updateBurst(dt); break;
      case 'spotted': this.updateSpotted(dt); break;
      case 'escape': this.updateEscape(dt); break;
      case 'escaped': this.updateEscaped(dt); break;
      case 'jumpscare': this.updateJumpscare(dt); break;
      case 'dead': this.updateDead(); break;
    }
    // A death resets to a checkpoint inside the switch above.
    if ((this.phase as Phase) === 'dormant' || (this.phase as Phase) === 'over') return;
    if (this.targetYaw !== null) this.monsterYaw = lerpAngle(this.monsterYaw, this.targetYaw, 1 - Math.exp(-dt * this.yawRate));
    if (this.phase !== 'jumpscare') this.actor.setPlacement(this.monsterPosition, this.monsterYaw);
    this.animateCloset(dt);
    this.actor.update(dt);
    this.updateTelevision(dt);
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
    if (this.phase === 'jumpscare') {
      const t = this.phaseTime, knock = this.knock(t);
      camera.position.copy(this.viewer());
      // Thrown down: the view drops to the floor, the face looming above it.
      camera.position.y -= knock * (this.hidden ? 0.45 : 1.08);
      this.actor.getFacePosition(this.target);
      this.lookMatrix.lookAt(camera.position, this.target, UP);
      camera.quaternion.setFromRotationMatrix(this.lookMatrix);
      camera.quaternion.multiply(this.rollQuaternion.setFromAxisAngle(ROLL_AXIS, this.hitSign * (knock * 0.95 + this.hitKick * 0.32)));
      camera.fov = base + 26 * Math.exp(-t * 6) + 4 + this.hitKick * 14;
      camera.near = 0.02;
      camera.updateProjectionMatrix();
    }
    if (this.phase === 'escaped') {
      const t = this.phaseTime;
      const trip = smooth(t / FALL_HIT);
      const sink = Math.max(0, t - FALL_SINK);
      // Pitched at the ground, then through it: looking back up at the hole
      // receding (and what stands over it), then turning over to face the drop.
      camera.position.copy(this.fallFrom).addScaledVector(this.fallForward, 0.95 * trip + 0.7 * smooth(sink / 0.7));
      camera.position.y = this.fallFrom.y - 1.2 * trip - 0.5 * FALL_GRAVITY * sink * sink;
      const lookingUp = THREE.MathUtils.lerp(-0.12 - 0.95 * trip, 1.1, smooth(sink / 0.95));
      const pitch = THREE.MathUtils.lerp(lookingUp, -1.5, smooth((t - FALL_TURN_START) / (FALL_TURN_END - FALL_TURN_START)));
      // A slow tumble around the view axis once facing down.
      const roll = this.hitSign * (0.45 * trip + 0.3 * sink);
      this.fallEuler.set(pitch, this.fallYaw + this.hitSign * 0.25 * sink, roll, 'YXZ');
      camera.quaternion.setFromEuler(this.fallEuler);
      camera.fov = base + 8 * trip + 22 * smooth(sink / 1.6) + 10 * smooth((t - (this.fallCut - 1.2)) / 1.2);
      camera.near = 0.03;
      camera.updateProjectionMatrix();
      this.below.update(t >= FALL_SINK, camera.position.y);
    }
    if (this.shakeLevel > 0) {
      // A long lens magnifies every tremor: keep the shake proportional to the view.
      const lens = THREE.MathUtils.clamp(camera.fov / Math.max(1, base), 0.08, 1.4);
      const amount = this.shakeLevel * this.shakeLevel * 0.045 * lens;
      this.shake.set((this.noise() - 0.5) * amount, (this.noise() - 0.5) * amount, (this.noise() - 0.5) * amount * 1.4);
      camera.quaternion.multiply(this.shakeQuaternion.setFromEuler(this.shake));
    }
  }

  // ---------------------------------------------------------------- reveal

  private startReveal(): void {
    const host = this.host;
    this.setPhase('reveal');
    this.checkpoint = 'corridor';
    host.player.prepareScriptedStanding();
    host.player.setLookLocked(true);
    host.onReveal();
    host.hud.hideHint();
    this.fov = host.baseFieldOfView();
    this.revealTime = null;
    this.distanceAlong = 0;
    this.monsterPosition.set(host.threshold.x + BACTERIA_SPAWN_DISTANCE, host.threshold.y, host.threshold.z);
    // Its back to the apartment: it has not noticed anyone yet.
    this.monsterYaw = Math.PI / 2;
    this.targetYaw = null;
    this.actor.setPlacement(this.monsterPosition, this.monsterYaw);
    this.actor.setMotion('feed');
    this.actor.setLookTarget(null);
    this.actor.setHeadTwist(0, 30);
  }

  private updateReveal(dt: number): void {
    const host = this.host;
    if (this.revealTime === null && host.isRevealLampLit()) {
      this.revealTime = this.phaseTime;
      this.actor.setVisible(true);
      this.sound.playTension();
    }
    if (this.revealTime !== null) {
      // A long lens: the silhouette fills almost half the frame, ~90 m away,
      // re-aimed as the player keeps walking.
      const range = this.eye.distanceTo(this.monsterPosition);
      this.revealFov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(2.25 / range)), 2.4, 24);
    }

    // Before it shows, the gaze drifts down the corridor; then it frames the hunched back.
    this.target.copy(this.monsterPosition).addScaledVector(UP, 1.45);
    if (this.revealTime !== null && this.phaseTime - this.revealTime > R.headTurn) this.actor.getHeadPosition(this.target).addScaledVector(UP, -0.25);
    this.lookMatrix.lookAt(this.eye, this.target, UP);
    this.lookQuaternion.setFromRotationMatrix(this.lookMatrix);
    const current = host.player.getLookQuaternion();
    this.nextLook.set(current.x, current.y, current.z, current.w).slerp(this.lookQuaternion, 1 - Math.exp(-dt * (this.revealTime === null ? 2.2 : 5)));
    host.player.setLookQuaternion(this.nextLook);

    if (this.revealTime === null) return;
    const t = this.phaseTime - this.revealTime;
    if (crossed(t, dt, R.freeze)) {
      // It stops dead, still folded over, listening.
      this.actor.setMotion('idle');
    }
    if (crossed(t, dt, R.headTurn)) {
      // Only the head comes round, slowly, much too far.
      this.actor.setHeadTwist(2.75, 1.05);
      this.shakeLevel = Math.max(this.shakeLevel, 0.12);
    }
    if (crossed(t, dt, R.bodySnap)) {
      // The body whips round under the head, which never leaves you.
      this.targetYaw = -Math.PI / 2;
      this.yawRate = 16;
      this.actor.setHeadTwist(0, 16);
      this.actor.setLookTarget(this.eye);
      this.actor.snapHead();
      this.shakeLevel = 0.5;
    }
    if (t > R.bodySnap) this.actor.setLookTarget(this.eye);
    const zoom = smooth(t / R.zoomDuration);
    this.fov = THREE.MathUtils.lerp(host.baseFieldOfView(), this.revealFov, zoom * (2 - zoom));
    if (t >= R.charge) this.startChase();
  }

  // ----------------------------------------------------------------- chase

  private startChase(): void {
    this.setPhase('chase');
    this.chargeTime = 0;
    this.targetYaw = null;
    this.monsterYaw = -Math.PI / 2;
    this.actor.setMotion('run');
    this.sound.startScream();
    this.shakeLevel = 0.6;
  }

  private updateChase(dt: number): void {
    const host = this.host;
    const t = this.phaseTime;
    if (t < R.dezoomDuration + 0.3) {
      const base = host.baseFieldOfView();
      const out = smooth(t / R.dezoomDuration);
      this.fov = THREE.MathUtils.lerp(this.revealFov, base + 9, out) - 9 * smooth((t - R.dezoomDuration) / 0.3);
    }
    if (crossed(t, dt, R.releaseDelay)) {
      host.player.setLookLocked(false);
      host.player.setInputEnabled(true);
      host.hud.showHint(host.sprintKeyLabel(), 'COURS !', 4.5, true);
    }

    const inside = this.playerInside();
    const doorX = host.threshold.x + 0.65;
    this.chargeTime += dt;
    if (!inside && this.monsterPosition.x <= doorX + 1e-3) {
      this.pursue(dt, CHASE_SPEEDS.apartment);
    } else {
      this.monsterPosition.x = Math.max(doorX, this.monsterPosition.x - corridorChargeSpeed(this.chargeTime) * dt);
      this.monsterPosition.y = host.threshold.y;
      this.monsterPosition.z = THREE.MathUtils.lerp(this.monsterPosition.z, host.threshold.z, 1 - Math.exp(-dt * 3));
      this.monsterYaw = lerpAngle(this.monsterYaw, -Math.PI / 2, 1 - Math.exp(-dt * 12));
    }
    this.actor.setLookTarget(this.eye);
    if (!inside && this.checkCaught('caught')) return;
    if (inside && this.monsterPosition.x <= doorX + 1e-3) {
      if (host.door.isSecured()) this.startBang();
      else this.enterApartment(false);
    }
  }

  // ------------------------------------------------------------------ door

  private startBang(): void {
    this.setPhase('bang');
    this.bangTimer = DOOR_BANG_SECONDS;
    this.nextBang = 0.1;
    this.monsterPosition.set(this.host.threshold.x + 0.65, this.host.threshold.y, this.host.threshold.z);
    this.monsterYaw = -Math.PI / 2;
    this.actor.setMotion('bang');
    this.actor.setLookTarget(null);
  }

  private updateBang(dt: number): void {
    const host = this.host;
    this.bangTimer -= dt;
    this.nextBang -= dt;
    if (!host.door.isSecured()) { this.enterApartment(false); return; }
    if (this.nextBang <= 0) {
      // Blows come faster and harder as the frame gives.
      const strain = 1 - Math.max(0, this.bangTimer) / DOOR_BANG_SECONDS;
      this.nextBang = (0.42 - strain * 0.16) + this.noise() * 0.26;
      host.door.jolt(0.75 + strain * 0.35);
      host.audio.impact('door-bang', this.playerInside() ? 0.18 : 0);
      if (this.eye.distanceTo(this.monsterPosition) < 6) this.shakeLevel = Math.max(this.shakeLevel, 0.3 + strain * 0.25);
    }
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
    host.onBreach();
    this.sound.startVoice();
    this.entryAlong = 0;
    this.monsterPosition.set(host.threshold.x + 0.65, host.threshold.y, host.threshold.z);
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
      this.actor.setLookTarget(this.target.set(this.hideLayout.hideEye.x, this.hideLayout.hideEye.y, this.hideLayout.hideEye.z));
      if (arrived) this.ripCloset('closet');
      return;
    }
    if (this.entryAlong < this.entryPath.cumulative[1]!) {
      this.walkEntry(dt, CHASE_SPEEDS.apartment);
      return;
    }
    this.pursue(dt, CHASE_SPEEDS.apartment);
    this.actor.setLookTarget(this.eye);
    this.checkCaught('caught');
  }

  /** Follows door → entry → closet front. Returns true once at the closet. */
  private walkEntry(dt: number, speed: number): boolean {
    this.entryAlong = Math.min(this.entryPath.length, this.entryAlong + speed * dt);
    this.entryPath.sample(this.entryAlong, this.monsterPosition);
    this.entryPath.heading(this.entryAlong, this.heading);
    this.faceAlong(this.heading, dt, 8);
    return this.entryAlong >= this.entryPath.length - 1e-3;
  }

  private ripCloset(cause: DeathCause): void {
    this.host.audio.impact('closet-rip');
    this.startJumpscare(cause);
  }

  private updateSearch(dt: number): void {
    const closetEye = this.target.set(this.hideLayout.hideEye.x, this.hideLayout.hideEye.y, this.hideLayout.hideEye.z);
    if (this.searchStage === 0) {
      // Rushes in, then slows to a broken, sniffing walk.
      const speed = this.entryAlong < 1.6 ? 3.2 : CHASE_SPEEDS.stalk;
      if (this.entryAlong >= 1.6) this.actor.setMotion('stalk');
      this.actor.setLookTarget(this.entryAlong > 2.2 ? closetEye : null);
      if (this.walkEntry(dt, speed)) { this.searchStage = 1; this.searchTimer = 0; this.actor.setMotion('idle'); }
      return;
    }
    this.searchTimer += dt;
    const lean = smooth((this.searchTimer - 0.9) / 1.2) * (1 - smooth((this.searchTimer - 3.6) / 0.5));
    // Faces the crack, not the middle of the leaf: it knows.
    this.monsterYaw = lerpAngle(this.monsterYaw, Math.atan2(this.hideLayout.hideEye.x - this.monsterPosition.x, this.hideLayout.hideEye.z - this.monsterPosition.z), 1 - Math.exp(-dt * 5));
    // Leans its head toward the gap, whichever way the hiding place faces.
    const front = this.hideLayout.frontPosition, eyeAt = this.hideLayout.hideEye;
    const toward = Math.atan2(eyeAt.x - front.x, eyeAt.z - front.z);
    this.monsterPosition.set(front.x + Math.sin(toward) * lean * 0.38, front.y, front.z + Math.cos(toward) * lean * 0.38);
    this.actor.setLookTarget(closetEye);
    this.sound.setDuck(1 - lean * 0.75);
    if (this.searchTimer > 0.9) this.actor.setMotion('crouch');
    if (this.searchTimer < 3.9) return;
    // The set clicks on by itself behind it: the lure no longer asks the player
    // to have left a sound running in the flat.
    if (!this.host.isTelevisionOn()) this.host.turnTelevisionOn?.();
    if (!this.host.isTelevisionOn() || !this.host.television) {
      this.sound.setDuck(1);
      this.ripCloset('silence');
      return;
    }
    // The television, behind it: its head snaps round to the noise.
    this.actor.snapHead();
    this.actor.setMotion('stalk');
    this.actor.setLookTarget(this.scratch.set(TELEVISION.center.x, TELEVISION.center.y, TELEVISION.center.z));
    this.sound.setDuck(1);
    this.lureAlong = 0;
    this.setPhase('lure');
    // Deep inside and its back to the door: the landing can come back unseen.
    this.restoreStairwell();
  }

  private updateLure(dt: number): void {
    this.lureAlong = Math.min(this.lurePath.length, this.lureAlong + (this.lureAlong < 1 ? 0.9 : 1.7) * dt);
    this.lurePath.sample(this.lureAlong, this.monsterPosition);
    this.lurePath.heading(this.lureAlong, this.heading);
    this.faceAlong(this.heading, dt, 6);
    this.actor.setLookTarget(this.scratch.set(TELEVISION.center.x, TELEVISION.center.y, TELEVISION.center.z));
    if (this.lureAlong >= this.lurePath.length - 1e-3) {
      this.setPhase('grab');
      this.actor.setMotion('crouch');
      this.targetYaw = this.yawToward(TELEVISION.center);
      this.yawRate = 5;
    }
  }

  private updateGrab(dt: number): void {
    if (this.phaseTime > 0.7 && this.television?.state === 'shelf') this.liftTelevision();
    if (this.phaseTime > 1.5) {
      this.actor.setMotion('carry');
      this.actor.setLookTarget(null);
      this.calm = 0;
      this.setPhase('carry');
      this.checkpoint = 'closet';
    }
    void dt;
  }

  private updateCarry(dt: number): void {
    // Mesmerised by the picture, swaying, its back to the closet.
    this.targetYaw = this.yawToward(TELEVISION.center) + Math.sin(this.phaseTime * 0.7) * 0.12;
    this.yawRate = 2;
    const before = this.calm;
    this.calm = Math.min(1, this.calm + dt / CALM_SECONDS);
    this.sound.setVoiceCalm(this.calm);
    if (!this.hidden) return;
    if (before < 1 && this.calm >= 1) {
      this.host.hud.showHint(this.exitKeyLabel(), 'Maintenir pour sortir sans bruit', 600);
    }
    if (this.calm < 1) { this.holdWasDown = this.exitHeld(); return; }
    const down = this.exitHeld();
    if (down && !this.holdWasDown && this.hold === 0) this.hold = 1e-4;
    if (down && this.hold > 0) {
      this.hold = Math.min(1, this.hold + dt / SNEAK_HOLD_SECONDS);
      this.host.hud.setHold(this.hold);
      // The hold IS the exit: the leaf eases open, then the long step out.
      this.host.hideSpot.holdExit?.(this.hold);
      if (this.hold >= 1) this.leaveClosetSilently();
    } else if (!down && this.hold > 0) {
      // Let go too early: out in a rush, the hinge shrieks.
      this.host.hud.setHold(null);
      this.burstFromHiding();
    }
    this.holdWasDown = down;
  }

  private exitKeyLabel(): string { return this.host.interactKeyLabel?.() ?? this.host.sprintKeyLabel(); }
  private exitHeld(): boolean { return this.host.isInteractHeld ? this.host.isInteractHeld() : this.host.isSprintHeld(); }

  private leaveClosetSilently(): void {
    const host = this.host;
    this.hold = 0;
    host.hud.setHold(null);
    host.hud.hideHint();
    this.hidden = false;
    // The wardrobe doors ease open and the player steps out; controls return after.
    host.hideSpot.release();
    host.player.setLookLocked(false);
    this.runningTime = 0;
    this.feet.copy(host.player.position);
    this.feet.y -= PLAYER_CENTER_HEIGHT;
    this.previousFeet.copy(this.feet);
    this.setPhase('sneak');
  }

  private updateSneak(dt: number): void {
    this.updateCarry(dt);
    const host = this.host;
    // Footsteps at a run carry through the flat; so does brushing past it.
    const speed = dt > 0 ? Math.hypot(this.feet.x - this.previousFeet.x, this.feet.z - this.previousFeet.z) / dt : 0;
    this.runningTime = speed > 4.1 ? this.runningTime + dt : Math.max(0, this.runningTime - dt * 2);
    const near = Math.hypot(this.feet.x - this.monsterPosition.x, this.feet.z - this.monsterPosition.z) < 2.1;
    if (this.runningTime > 0.18 || near) { this.makeNoise(); return; }
    const p = host.player.position;
    if (p.x > host.threshold.x + 0.32 && Math.abs(p.z - host.threshold.z) < 1.6 && Math.abs(p.y - host.threshold.y - PLAYER_CENTER_HEIGHT) < 0.6) this.startSpotted();
  }

  /** The key was let go mid-exit: the player stumbles out and it charges. */
  private burstFromHiding(): void {
    const host = this.host;
    this.hold = 0;
    host.hud.setHold(null);
    host.hud.hideHint();
    host.audio.door('open');
    host.audio.impact('door-bang', 0.35);
    if (host.hideSpot.burstOut) host.hideSpot.burstOut(); else host.hideSpot.release();
    this.hidden = false;
    host.player.setLookLocked(false);
    this.dropTelevision();
    this.actor.snapHead();
    this.actor.setMotion('idle');
    this.actor.setLookTarget(this.eye);
    this.targetYaw = null;
    this.setPhase('burst');
  }

  private updateBurst(dt: number): void {
    // A beat to whirl round at the noise, then straight across the flat.
    if (this.phaseTime < 0.35) {
      this.targetYaw = this.yawToward(this.feet); this.yawRate = 18;
      return;
    }
    this.targetYaw = null;
    this.actor.setMotion('run');
    this.actor.setLookTarget(this.eye);
    this.pursue(dt, CHASE_SPEEDS.apartment);
    const reach = Math.hypot(this.feet.x - this.monsterPosition.x, this.feet.z - this.monsterPosition.z);
    if (reach < CATCH_RADIUS + 0.4 || this.phaseTime > 2.2) this.startJumpscare('noise');
  }

  /** A creak or a footfall: the television drops, it turns, and it comes. */
  private makeNoise(): void {
    const host = this.host;
    this.hold = 0;
    host.hud.setHold(null);
    host.hud.hideHint();
    if (this.hidden) {
      host.audio.door('open');
      this.dropTelevision();
      // Across the flat in two bounds, straight into the closet.
      this.ripCloset('noise');
      return;
    }
    this.dropTelevision();
    this.startJumpscare('noise');
  }

  // ---------------------------------------------------------------- escape

  private startSpotted(): void {
    const host = this.host;
    this.setPhase('spotted');
    // A short shot: the body stops on the landing and glances back into the
    // flat; it has already turned. Then the head whips round to the flight
    // down, so control returns already facing the run.
    host.player.prepareScriptedStanding();
    host.player.setInputEnabled(false);
    host.player.setLookLocked(true);
    host.hud.hideHint();
    host.openEscape();
    this.distanceAlong = 0;
    this.lastPlayerAlong = Number.NaN; this.playerRate = 0; this.stallTime = 0;
  }

  private updateSpotted(dt: number): void {
    const host = this.host;
    const t = this.phaseTime;
    const toStairs = t >= S.roar + SPOTTED_STAIR_TURN_DELAY;
    if (toStairs) this.target.set(STAIR_LOOK_TARGET.x, this.eye.y - STAIR_LOOK_DROP, STAIR_LOOK_TARGET.z);
    else this.actor.getHeadPosition(this.target);
    this.lookMatrix.lookAt(this.eye, this.target, UP);
    this.lookQuaternion.setFromRotationMatrix(this.lookMatrix);
    const current = host.player.getLookQuaternion();
    this.nextLook.set(current.x, current.y, current.z, current.w).slerp(this.lookQuaternion, 1 - Math.exp(-dt * (toStairs ? 15 : 9)));
    host.player.setLookQuaternion(this.nextLook);
    if (crossed(t, dt, S.dropTelevision)) this.dropTelevision();
    if (crossed(t, dt, S.whip)) {
      this.targetYaw = this.yawToward(this.feet);
      this.yawRate = 22;
      this.actor.setMotion('idle');
      this.actor.snapHead();
      this.actor.setLookTarget(this.eye);
      this.sound.stopVoice(0.4);
    }
    if (crossed(t, dt, S.roar)) {
      this.sound.startScream();
      this.sound.roar();
      host.audio.impact('door-burst');
      host.hud.pulseFlash(0.45);
      this.shakeLevel = 0.85;
    }
    if (t >= S.release) {
      this.setPhase('escape');
      this.checkpoint = 'closet';
      this.targetYaw = null;
      this.actor.setMotion('run');
      host.player.setLookLocked(false);
      host.player.setInputEnabled(true);
      host.hud.showHint(host.sprintKeyLabel(), 'COURS ! Descends !', 4, true);
    }
  }

  private updateEscape(dt: number): void {
    const host = this.host;
    this.outsideTime = isOutsideHall(host.player.position) ? this.outsideTime + dt : 0;
    if (isTripPosition(host.player.position) || this.outsideTime > ESCAPE_RUN.tripDelay) { this.startEscaped(); return; }
    const playerAlong = this.escapePath.project(this.feet);
    const gap = playerAlong - this.distanceAlong;
    // How fast the player really progresses down the route (smoothed).
    if (Number.isFinite(this.lastPlayerAlong) && dt > 0) {
      const rate = THREE.MathUtils.clamp((playerAlong - this.lastPlayerAlong) / dt, -12, 12);
      this.playerRate = THREE.MathUtils.lerp(this.playerRate, rate, 1 - Math.exp(-dt * 6));
    }
    this.lastPlayerAlong = playerAlong;
    // Out in the street both are off the route: straight at the player, same elastic.
    const monsterOut = this.monsterPosition.z < FACADE_OUTER_Z - 0.4 && this.monsterPosition.y < 1;
    if (monsterOut && isOutsideHall(host.player.position)) {
      const flat = Math.hypot(this.feet.x - this.monsterPosition.x, this.feet.z - this.monsterPosition.z);
      const moved = dt > 0 ? Math.hypot(this.feet.x - this.previousFeet.x, this.feet.z - this.previousFeet.z) / dt : 0;
      this.playerRate = THREE.MathUtils.lerp(this.playerRate, Math.min(12, moved), 1 - Math.exp(-dt * 6));
      this.stallTime = this.playerRate < ESCAPE_STALL_RATE ? this.stallTime + dt : Math.max(0, this.stallTime - dt * 1.5);
      this.pursue(dt, this.followSpeed(flat));
      this.distanceAlong = this.escapePath.project(this.monsterPosition);
      this.actor.setLookTarget(this.eye);
      this.checkCaught('stairs');
      return;
    }
    this.stallTime = this.playerRate < ESCAPE_STALL_RATE ? this.stallTime + dt : Math.max(0, this.stallTime - dt * 1.5);
    if (Math.abs(gap) < 1.6) {
      // On top of you: no more path, a lunge.
      this.pursue(dt, CHASE_SPEEDS.landing);
      this.distanceAlong = this.escapePath.project(this.monsterPosition);
    } else {
      // Always right behind, never quite on you: it closes fast from afar,
      // then hangs a few metres back at your pace. Stop, and it is on you.
      const speed = this.followSpeed(gap);
      this.distanceAlong = THREE.MathUtils.clamp(this.distanceAlong + Math.sign(gap) * speed * dt, 0, this.escapePath.length);
      this.escapePath.sample(this.distanceAlong, this.monsterPosition);
      this.escapePath.heading(this.distanceAlong, this.heading);
      if (gap < 0) this.heading.multiplyScalar(-1);
      this.faceAlong(this.heading, dt, 12);
    }
    this.actor.setLookTarget(this.eye);
    this.checkCaught('stairs');
  }

  /**
   * The elastic: far behind it runs much faster than any person, close it
   * slows to just under the player's pace, a few metres back. Stopping for
   * more than a second lets the gap close.
   */
  private followSpeed(gap: number): number {
    const desired = this.stallTime > ESCAPE_STALL_SECONDS ? 0 : ESCAPE_FOLLOW_GAP;
    return gap >= desired
      ? THREE.MathUtils.clamp(Math.max(0, this.playerRate) + (gap - desired) * 1.5, 3, 11.5)
      : THREE.MathUtils.clamp(this.playerRate * 0.85, 0, 11.5);
  }

  private startEscaped(): void {
    const host = this.host;
    this.setPhase('escaped');
    this.outsideTime = 0;
    host.player.setInputEnabled(false);
    host.player.setLookLocked(true);
    host.hud.hideHint();
    const camera = host.renderCamera;
    this.fallFrom.copy(camera.position);
    camera.getWorldDirection(this.fallForward).setY(0);
    if (this.fallForward.lengthSq() < 1e-6) this.fallForward.set(0, 0, -1);
    this.fallForward.normalize();
    this.fallYaw = Math.atan2(-this.fallForward.x, -this.fallForward.z);
    this.hitSign = this.noise() < 0.5 ? -1 : 1;
    // The drift ahead is small: centre the open cell under where the body lands.
    this.below.placeUnder(this.fallFrom.x + this.fallForward.x * 1.65, this.fallFrom.z + this.fallForward.z * 1.65);
    const drop = this.fallFrom.y - 1.2 - (BELOW_TOP_Y - FALL_CUT_DEPTH);
    this.fallCut = FALL_SINK + Math.sqrt(Math.max(1, drop) / (0.5 * FALL_GRAVITY));
  }

  /** The trip, the hit, then the noclip: down through the street while it
   * looms over the hole, a long fall in the dark toward the yellow maze, and
   * the cut as the body drops between its walls. */
  private updateEscaped(dt: number): void {
    const host = this.host;
    const t = this.phaseTime;
    if (crossed(t, dt, FALL_HIT)) {
      host.audio.tumble?.(1);
      host.hud.pulseFlash(0.3);
      this.shakeLevel = 0.8;
    }
    if (crossed(t, dt, FALL_SINK)) {
      // Under the ground now: the body left on the ground must not be seen from below.
      host.setAvatarHidden(true);
      if (this.actor.root.visible) this.sound.roar();
    }
    if (crossed(t, dt, 1.05)) this.sound.stopAll(1.4);
    if (crossed(t, dt, FALL_TURN_END + 0.4)) this.actor.setVisible(false);
    if (this.actor.root.visible) {
      // It reaches the spot where you went down and stares into the dark after you.
      const flat = Math.hypot(this.feet.x - this.monsterPosition.x, this.feet.z - this.monsterPosition.z);
      if (flat > 1.3) this.pursue(dt, CHASE_SPEEDS.landing);
      this.actor.setMotion(flat > 1.3 ? 'run' : 'idle');
      this.actor.setLookTarget(host.renderCamera.position);
    }
    const sink = Math.max(0, t - FALL_SINK);
    this.sound.setFallWind(t < this.fallCut ? smooth(sink / 1.4) * (0.55 + 0.45 * smooth((t - FALL_TURN_END) / (this.fallCut - FALL_TURN_END))) : 0);
    // The air turns yellow only in the last instants, as the light below swallows the view.
    host.setFallTint?.(smooth((t - (this.fallCut - 0.35)) / 0.35));
    this.shakeLevel = Math.max(this.shakeLevel, 0.18 * smooth(sink / 2));
    if (crossed(t, dt, this.fallCut)) { host.hud.pulseFlash(0.8); this.sound.stopFallWind(FALL_FADE); }
    host.setFade?.(smooth((t - this.fallCut) / FALL_FADE));
    if (t >= this.fallCut + FALL_FADE + 0.12) {
      this.below.update(false, 0);
      this.restoreWorld();
      this.setPhase('over');
      host.onEscaped();
    }
  }

  // -------------------------------------------------------------- outcome

  private checkCaught(cause: DeathCause): boolean {
    const dy = Math.abs(this.monsterPosition.y - this.feet.y);
    const flat = Math.hypot(this.monsterPosition.x - this.feet.x, this.monsterPosition.z - this.feet.z);
    if (dy > 1.3 || flat > CATCH_RADIUS) return false;
    this.startJumpscare(cause);
    return true;
  }

  private startJumpscare(cause: DeathCause): void {
    const host = this.host;
    this.deathCause = cause;
    this.setPhase('jumpscare');
    this.targetYaw = null;
    host.player.setInputEnabled(false);
    host.player.setLookLocked(true);
    host.hud.hideHint();
    host.hud.setHold(null);
    this.actor.setVisible(true);
    this.actor.setMotion('lunge');
    this.actor.setHeadTwist(0, 40);
    this.actor.snapHead();
    this.actor.setLookTarget(this.eye);
    this.sound.jumpscare();
    host.audio.impact('door-burst');
    host.hud.pulseFlash(0.6);
    this.shakeLevel = 1.25;
    this.hitKick = 0; this.hitSign = this.noise() < 0.5 ? 1 : -1;
    this.placeLunge(0);
  }

  /** 0 → 1 as the blow throws the player to the floor. */
  private knock(t: number): number { return smooth((t - KILL_IMPACT) / 0.2); }

  /** Puts the face right in front of the viewer: it lunges into the lens, then
   * follows the player down and thrashes over them. */
  private placeLunge(t: number): void {
    const eye = this.cameraRight.copy(this.viewer());
    const toward = this.heading.copy(this.monsterPosition).sub(eye).setY(0);
    if (this.hidden) this.host.renderCamera.getWorldDirection(toward).setY(0);
    if (toward.lengthSq() < 1e-4) this.host.player.getViewDirection(toward).setY(0);
    toward.normalize();
    const knock = this.knock(t);
    // The hunched skull hangs well ahead of the root: place the face itself,
    // from arm's length to almost touching the lens at the impact.
    const lunge = THREE.MathUtils.lerp(1.15, 0.2, smooth(t / KILL_IMPACT));
    const thrash = knock * (Math.sin(t * 31) * 0.07 + Math.sin(t * 17.3) * 0.05);
    const distance = THREE.MathUtils.lerp(lunge, 0.42, knock) + thrash;
    const drop = knock * (this.hidden ? 0.3 : 0.78);
    this.monsterYaw = Math.atan2(-toward.x, -toward.z) + knock * Math.sin(t * 23) * 0.16;
    if (t === 0) this.monsterPosition.copy(eye).addScaledVector(toward, distance + 0.35).setY(eye.y - 1.95);
    for (let pass = 0; pass < 2; pass += 1) {
      this.actor.setPlacement(this.monsterPosition, this.monsterYaw);
      const face = this.actor.getFacePosition(this.face).sub(eye);
      const along = face.x * toward.x + face.z * toward.z;
      this.monsterPosition.addScaledVector(toward, distance - along);
      this.monsterPosition.y -= face.y + 0.06 + drop;
    }
    this.actor.setPlacement(this.monsterPosition, this.monsterYaw);
  }

  private updateJumpscare(dt: number): void {
    const t = this.phaseTime;
    this.placeLunge(t);
    this.hitKick = Math.max(0, this.hitKick - dt * 5.5);
    // Each blow: a body slam with a crack of bone, a red burst and a jolt.
    KILL_STRIKES.forEach((mark, index) => {
      if (!crossed(t, dt, mark)) return;
      const first = index === 0;
      this.host.audio.strike(first ? 1.25 : 0.8 + (index % 3) * 0.12, index);
      this.host.hud.pulseFlash(first ? 1 : 0.75);
      this.hitKick = first ? 1.4 : 1;
      this.hitSign = first ? 1 : -this.hitSign;
      this.shakeLevel = first ? 2 : 1.45;
      this.actor.snapHead();
    });
    // A strobing key light and a blown-out hide: the face must read, for a split second.
    const strobe = Math.abs(Math.sin(t * 26));
    // Kept below the level that washed the hide out to a pale pink; the
    // violence is carried by the VHS layer instead.
    this.creatureLight.intensity = 2.2 + strobe * 1.6 + this.hitKick * 1.2;
    this.actor.setExposure(0.45 + strobe * 0.2);
    this.shakeLevel = Math.max(this.shakeLevel, 0.9);
    if (t >= KILL_CUT) {
      // Hard cut to black on the last crack, no fade.
      this.host.audio.strike(1.3, KILL_STRIKES.length);
      this.setPhase('dead');
      this.sound.stopAll(0);
      this.actor.setVisible(false);
      this.creatureLight.intensity = 0;
      this.hitKick = 0;
      const detail: Record<DeathCause, string> = {
        caught: 'Retour à l’entrée du couloir…',
        closet: 'Il t’a vu y entrer.',
        silence: 'Rien d’autre ne faisait de bruit dans l’appartement…',
        noise: 'Il t’a entendu.',
        stairs: 'Retour dans le placard…',
      };
      this.host.hud.showDeath(true, detail[this.deathCause]);
    }
  }

  private updateDead(): void {
    if (this.phaseTime >= 3.2) this.resetToCheckpoint();
  }

  private resetToCheckpoint(): void {
    const host = this.host;
    host.hud.showDeath(false);
    host.hud.setHold(null);
    this.hold = 0;
    this.holdWasDown = false;
    if (this.checkpoint === 'closet' && this.stairwellRestored) {
      this.resetToCloset();
      return;
    }
    this.restoreWorld();
    this.restoreTelevision();
    host.door.repair();
    if (this.hidden) host.hideSpot.forceOut();
    this.hidden = false;
    const threshold = host.threshold;
    host.player.teleport({ x: threshold.x + 1.2, y: threshold.y + PLAYER_CENTER_HEIGHT, z: threshold.z });
    this.lookMatrix.lookAt(this.target.set(0, 0, 0), this.heading.set(1, 0, 0), UP);
    host.player.setLookQuaternion(this.lookQuaternion.setFromRotationMatrix(this.lookMatrix));
    host.player.setLookLocked(false);
    host.player.setInputEnabled(true);
    this.setPhase('dormant');
    host.onRetry('corridor');
  }

  /** Back behind the leaf, the creature cradling the set again, already calm. */
  private resetToCloset(): void {
    const host = this.host;
    this.restoreWorld();
    this.hidden = true;
    host.player.teleport(this.hideLayout.exitPosition);
    host.hideSpot.hide(this.spot);
    this.monsterPosition.set(TELEVISION.standPosition.x, TELEVISION.standPosition.y, TELEVISION.standPosition.z);
    this.monsterYaw = this.yawToward(TELEVISION.center);
    this.targetYaw = this.monsterYaw;
    this.actor.setPlacement(this.monsterPosition, this.monsterYaw);
    this.actor.setVisible(true);
    this.actor.setMotion('carry');
    this.actor.setLookTarget(null);
    this.restoreTelevision();
    this.liftTelevision(true);
    this.sound.startVoice();
    this.sound.setVoiceCalm(1);
    this.calm = 0.75;
    this.setPhase('carry');
    host.onRetry('closet');
  }

  private restoreWorld(): void {
    this.actor.setVisible(false);
    this.actor.setMotion('idle');
    this.actor.setExposure(0);
    this.actor.setHeadTwist(0, 40);
    this.sound.setDuck(1);
    this.creatureLight.intensity = 0;
    this.fov = 0;
    this.targetYaw = null;
  }

  private restoreStairwell(): void {
    if (this.stairwellRestored) return;
    this.stairwellRestored = true;
    this.host.restoreStairwell();
  }

  /** Loaded after the hiding: no creature any more, the hall door is open. */
  resumeAftermath(): void {
    this.stairwellRestored = true;
    this.host.openEscape();
    this.setPhase('aftermath');
  }

  // ------------------------------------------------------------ television

  private liftTelevision(immediate = false): void {
    const tv = this.host.television;
    if (!tv) return;
    if (!this.television) {
      const pivot = new THREE.Group();
      pivot.name = 'bacteria-carried-television';
      this.television = {
        object: tv, parent: tv.parent!, position: tv.position.clone(), quaternion: tv.quaternion.clone(), scale: tv.scale.clone(),
        pivot, from: new THREE.Vector3(), fromQuaternion: new THREE.Quaternion(), state: 'shelf', time: 0, velocity: 0,
      };
    }
    const carried = this.television;
    if (carried.state !== 'shelf') return;
    tv.updateWorldMatrix(true, true);
    new THREE.Box3().setFromObject(tv).getCenter(carried.pivot.position);
    carried.pivot.quaternion.identity();
    this.host.scene.add(carried.pivot);
    carried.pivot.updateMatrixWorld(true);
    carried.pivot.attach(tv);
    carried.from.copy(carried.pivot.position);
    carried.fromQuaternion.copy(carried.pivot.quaternion);
    carried.state = immediate ? 'held' : 'lifting';
    carried.time = 0;
    if (!immediate) this.host.audio.impact('closet-rip', 0.7);
  }

  private dropTelevision(): void {
    const carried = this.television;
    if (!carried || (carried.state !== 'held' && carried.state !== 'lifting')) return;
    carried.state = 'falling';
    carried.velocity = 0;
    carried.time = 0;
  }

  private restoreTelevision(): void {
    const carried = this.television;
    if (!carried || carried.state === 'shelf') return;
    carried.parent.add(carried.object);
    carried.object.position.copy(carried.position);
    carried.object.quaternion.copy(carried.quaternion);
    carried.object.scale.copy(carried.scale);
    carried.object.updateMatrixWorld(true);
    carried.pivot.removeFromParent();
    carried.state = 'shelf';
  }

  private updateTelevision(dt: number): void {
    const carried = this.television;
    if (!carried || carried.state === 'shelf' || carried.state === 'floor') return;
    carried.time += dt;
    if (carried.state === 'falling') {
      carried.velocity += 9.8 * dt;
      carried.pivot.position.y -= carried.velocity * dt;
      carried.pivot.rotateX(dt * 1.6);
      const floor = this.host.threshold.y + 0.22;
      if (carried.pivot.position.y <= floor) {
        carried.pivot.position.y = floor;
        carried.state = 'floor';
        this.host.audio.impact('door-bang');
      }
      carried.pivot.updateMatrixWorld(true);
      return;
    }
    this.actor.getHoldPosition(this.target);
    // Cradled a little in front of the hands, its screen toward the creature.
    this.target.y += 0.12;
    const yaw = this.monsterYaw + Math.PI;
    this.lookQuaternion.setFromAxisAngle(UP, yaw);
    if (carried.state === 'lifting') {
      const t = smooth(carried.time / 0.8);
      carried.pivot.position.lerpVectors(carried.from, this.target, t);
      carried.pivot.quaternion.slerpQuaternions(carried.fromQuaternion, this.lookQuaternion, t);
      if (carried.time >= 0.8) carried.state = 'held';
    } else {
      carried.pivot.position.lerp(this.target, 1 - Math.exp(-dt * 18));
      carried.pivot.quaternion.slerp(this.lookQuaternion, 1 - Math.exp(-dt * 10));
    }
    carried.pivot.updateMatrixWorld(true);
  }

  // --------------------------------------------------------------- closet

  updatePrompt(position: THREE.Vector3, direction: THREE.Vector3): boolean {
    const label = this.canHide(position, direction) ? 'Se cacher dans le placard' : null;
    // Active prompts are republished each frame, like the door ones, so a
    // neighbour clearing its own prompt cannot hide this one.
    if (label !== this.prompt || label) {
      this.prompt = label;
      this.host.setPrompt(label);
    }
    return !!label;
  }

  interact(position: THREE.Vector3, direction: THREE.Vector3): boolean {
    if (!this.canHide(position, direction)) return false;
    this.hidden = true;
    this.host.hud.hideHint();
    this.host.hideSpot.hide();
    const spot = this.host.hideSpot.current?.() ?? 'wardrobe';
    if (spot !== this.spot) {
      // Already on its way in: carry on along the route to this place instead.
      this.spot = spot;
      if (this.phase === 'inside') this.entryAlong = this.entryPath.project(this.monsterPosition);
    }
    this.prompt = null;
    this.host.setPrompt(null);
    return true;
  }

  /**
   * Interact pressed while hidden, outside the held sneak. Still behind the
   * door, the creature has not seen anything: climbing out is allowed and the
   * hunt goes on. Once it is in the flat and before it is lost in the
   * television (the "hold" prompt), climbing out is suicide: it is on you.
   */
  requestHiddenExit(): boolean {
    if (!this.hidden) return false;
    if (this.phase === 'chase' || this.phase === 'bang') {
      this.hidden = false;
      this.host.hud.hideHint();
      this.host.hideSpot.release();
      this.host.player.setLookLocked(false);
      return true;
    }
    // The held exit owns the key once the prompt is up.
    if ((this.phase === 'carry' || this.phase === 'sneak') && this.calm >= 1) return true;
    this.burstFromHiding();
    return true;
  }

  private canHide(_position: THREE.Vector3, _direction: THREE.Vector3): boolean {
    if (this.hidden) return false;
    if (this.phase !== 'chase' && this.phase !== 'bang' && this.phase !== 'inside') return false;
    return this.playerInside() && this.host.hideSpot.canHide();
  }

  /** The wardrobe animates its own doors (ClosetHide). */
  private animateCloset(_dt: number): void {}

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

  private yawToward(point: Readonly<Vec3Data>): number {
    return Math.atan2(point.x - this.monsterPosition.x, point.z - this.monsterPosition.z);
  }

  /** Where the player actually sees from: the closet crack while hidden. */
  private viewer(): THREE.Vector3 {
    return this.hidden ? this.face.copy(this.host.renderCamera.position) : this.eye;
  }

  private playerInside(): boolean {
    const position = this.host.player.position;
    return position.x < this.host.threshold.x - .15 && Math.abs(position.y - this.host.threshold.y - PLAYER_CENTER_HEIGHT) < 1.2;
  }

  private updateCreatureLight(): void {
    if (this.phase === 'jumpscare') return;
    if (!this.actor.root.visible) {
      this.creatureLight.intensity = 0;
      return;
    }
    this.creatureLight.position.copy(this.monsterPosition).addScaledVector(UP, 2.8);
    const reveal = this.phase === 'reveal';
    // Seen from behind, the rim must come from the far side of the troffer.
    this.creatureLight.position.x += reveal ? .55 : -.55;
    const dim = this.phase === 'carry' || this.phase === 'sneak' || this.phase === 'grab' || this.phase === 'escape' || this.phase === 'spotted';
    this.creatureLight.intensity = reveal ? 5.2 : dim ? 1.1 : 3.7;
  }

  private updateSound(): void {
    if (!this.actor.root.visible) return;
    const distance = this.eye.distanceTo(this.scratch.copy(this.monsterPosition).setY(this.monsterPosition.y + 1.6));
    this.host.renderCamera.getWorldDirection(this.heading);
    this.cameraRight.crossVectors(this.heading, UP).normalize();
    const toward = this.target.copy(this.monsterPosition).sub(this.eye).setY(0);
    const pan = toward.lengthSq() > 1e-6 ? toward.normalize().dot(this.cameraRight) : 0;
    const monsterInside = this.monsterPosition.x < this.host.threshold.x - .15 && Math.abs(this.monsterPosition.y - this.host.threshold.y) < 1.2;
    const insideSplit = this.playerInside() !== monsterInside;
    const floors = Math.min(1, Math.abs(this.monsterPosition.y - this.feet.y) / 6);
    const occlusion = (insideSplit && this.host.door.isSecured() ? .62 : 0) + (this.hidden ? .18 : 0) + floors * 0.3;
    this.sound.setScreamActive(this.pursuing());
    this.sound.updateSpatial(distance, pan, occlusion);
  }

  /** Phases where it runs at the player: only then the scream loop plays. */
  private pursuing(): boolean {
    switch (this.phase) {
      case 'chase': case 'bang': case 'escape': case 'jumpscare': return true;
      case 'escaped': return this.phaseTime < FALL_SINK;
      case 'inside': return !this.hidden;
      case 'spotted': return this.phaseTime >= S.roar;
      case 'burst': return this.phaseTime >= 0.35;
      default: return false;
    }
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
    this.restoreTelevision();
    this.actor.dispose();
    this.creatureLight.removeFromParent();
    this.below.dispose();
  }
}
