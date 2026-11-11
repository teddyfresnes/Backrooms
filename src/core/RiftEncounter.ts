import * as THREE from 'three';
import type { CharacterRuntime } from '../character/CharacterRuntime';
import type { BacteriaActor } from '../monster/BacteriaActor';
import type { BacteriaAudio } from '../monster/BacteriaAudio';
import { BackroomsHunt } from '../monster/BackroomsHunt';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { PlayerController } from '../player/PlayerController';
import type { RiftAudio } from '../audio/RiftAudio';
import type { BalanceMeter } from '../ui/BalanceMeter';
import type { StoryHud } from '../ui/StoryHud';
import { EPIC3_FACADE_HALF_DEPTH, EPIC3_OUTER_HALF_DEPTH } from '../world/EpicStructures';
import { SeededRandom } from '../world/SeededRandom';
import type { StaticCollider } from '../world/types';
import {
  BalanceModel,
  freshRiftProgress,
  isInRiftGallery,
  nearestRiftLane,
  northProgress,
  PLANK_BEARING,
  PLANK_LENGTH,
  PLANK_THICKNESS,
  PLANK_WIDTH,
  RIFT_CENTER_Z,
  RIFT_LINES,
  riftBank,
  riftEdgeDistance,
  riftFloorY,
  riftLaneX,
  type RiftLineId,
  type RiftProgress,
} from '../story/RiftJourney';

const EYE = 0.865;
const PLANK_KEY = 'rift-plank';
const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const smooth = (value: number): number => { const t = THREE.MathUtils.clamp(value, 0, 1); return t * t * (3 - 2 * t); };
const wrap = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));
const lerpAngle = (from: number, to: number, amount: number): number => from + wrap(to - from) * amount;
const crossed = (time: number, delta: number, mark: number): boolean => time >= mark && time - delta < mark;
/** Camera yaw (Euler YXZ) looking along a horizontal direction. */
const viewYaw = (x: number, z: number): number => Math.atan2(-x, -z);
/** Body / creature yaw facing a horizontal direction (+Z forward). */
const bodyYaw = (x: number, z: number): number => Math.atan2(x, z);

type Phase =
  | 'arrival' | 'north' | 'edge' | 'plank' | 'crossing' | 'crossed' | 'turn'
  | 'standoff' | 'dropping' | 'chase' | 'falling' | 'caught' | 'dead' | 'done' | 'stalk';

/** At the edge, how long it rears and screams before stepping onto the board. */
const STANDOFF_WAIT = 0.9;
const CREATURE_PLANK_SPEED = 1.8;
const CREATURE_RUN_SPEED = 5.35;
/** It first appears this far down the lane corridor behind the far portal. */
const CREATURE_APPROACH_DEPTH = 21;
const CREATURE_CHARGE_SPEED = 6.4;
const CREATURE_FLEE_SPEED = 7;
/** The far-bank hunt (monster/BackroomsHunt) starts this far from the rift's centre. */
const HUNT_RIFT_CLEARANCE = 26;
const CATCH_RADIUS = 1.15;
const GIVE_UP_GAP = 30;
const GIVE_UP_SECONDS = 20;
/** Over the void the walk is slowed this much; on the board's bearings it is normal. */
const CROSSING_SPEED_SCALE = 0.62;
/** First person until here, then the exterior shot from the void. */
const EDGE_EXTERIOR = 1.75;
const EDGE_DURATION = 6.7;
const TURN_DURATION = 4.3;
const FALL_DURATION = 3.3;
const DEATH_HOLD = 3;

export interface RiftEncounterHost {
  readonly scene: THREE.Scene;
  /** Camera actually presented (the character rig copies into it each frame). */
  readonly renderCamera: THREE.PerspectiveCamera;
  readonly player: PlayerController;
  readonly physics: PhysicsWorld;
  readonly character?: CharacterRuntime;
  readonly hud: StoryHud;
  readonly balanceMeter: BalanceMeter;
  readonly sound: RiftAudio;
  readonly creatureSound: BacteriaAudio;
  readonly seed: string;
  creature(): BacteriaActor | undefined;
  baseFieldOfView(): number;
  reducedMotion(): boolean;
  keyLabel(action: 'interact' | 'left' | 'right'): string;
  /** A thought of the character (silent caption). */
  say(text: string): void;
  captionBusy(): boolean;
  /** Progress changed at a stable point: persist it. */
  onProgress(progress: RiftProgress): void;
  /** 0 lit .. 1 pitch dark at a world point (dead lamps, unlit zones). */
  darknessAt?(x: number, y: number, z: number): number;
  /** Changes when the mounted world changes (the hunt re-probes its nav cells). */
  worldRevision?(): number;
}

interface Plank {
  lane: number;
  story: number;
  bank: 1 | -1;
  readonly root: THREE.Group;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  readonly rest: Float32Array;
  mounted: boolean;
  /** Seconds since it was pushed (null = resting). */
  thrown: number | null;
  readonly fall: { position: THREE.Vector3; velocity: THREE.Vector3; spin: THREE.Vector3; free: boolean };
}

interface Checkpoint { position: THREE.Vector3; look: THREE.Quaternion; phase: Phase }

/**
 * The rift sequence of the Backrooms runtime, from the first words after the
 * fall to the far bank. It drives the player through PlayerController
 * (constraints, look, scripted pose), poses the character for its single
 * third-person shot, and owns the plank (mesh and collider), the creature's
 * placement and every death in the rift. Game calls `update` before the
 * character rig and `applyCamera` after it.
 */
export class RiftEncounter {
  private progress: RiftProgress;
  private phase: Phase;
  private phaseTime = 0;
  private plank?: Plank;
  private balance?: BalanceModel;
  private crossFrom: 1 | -1 = 1;
  private fallOff = 0;
  private lastCreak = 0;
  private arrivalZ: number | null = null;
  private maxNorth = 0;
  private standingTime = 0;
  private walkedFloorY: number | null = null;
  private walkedBank: 1 | -1 = 1;
  private owns = false;
  private fade = 0;
  private pendingLines: RiftLineId[] = [];
  private readonly random: SeededRandom;
  private readonly look = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly lookQuaternion = new THREE.Quaternion();
  private readonly startLook = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly vector = new THREE.Vector3();
  private readonly vectorB = new THREE.Vector3();
  private readonly viewDirection = new THREE.Vector3();
  private readonly frustum = new THREE.Frustum();
  private readonly projection = new THREE.Matrix4();
  private readonly box = new THREE.Box3();
  private readonly quaternion = new THREE.Quaternion();
  private cameraLean = 0;
  private cameraRoll = 0;
  private cameraSag = 0;
  private fovOverride: number | null = null;
  // Edge cinematic.
  private readonly edge = {
    across: 0, bank: 1 as 1 | -1, side: 1, presenting: false,
    feet: new THREE.Vector3(), from: new THREE.Vector3(), fromQuaternion: new THREE.Quaternion(),
  };
  // Death fall.
  private readonly fallCamera = { position: new THREE.Vector3(), velocity: 0, yaw: 0, pitch: 0, roll: 0, sign: 1 };
  private death: { title: string; detail: string; respawn: Checkpoint } | null = null;
  // Third-person turn.
  private readonly turn = { feet: new THREE.Vector3(), yawFrom: 0, yawTo: 0, from: new THREE.Quaternion(), fromPosition: new THREE.Vector3() };
  private readonly shot = new THREE.PerspectiveCamera();
  private readonly pov = new THREE.PerspectiveCamera();
  // Creature.
  private readonly creaturePosition = new THREE.Vector3();
  private creatureYaw = 0;
  private creatureAlong = 0;
  private creatureMode:
    | 'hidden' | 'distant' | 'rear' | 'charge' | 'wait' | 'plank' | 'run' | 'falling' | 'flee' | 'retreat'
    | 'hunt' = 'hidden';
  /** The far-bank hunter (created when the creature first hunts). */
  private hunt?: BackroomsHunt;
  /** 0..1 dread this frame (the host paces the heartbeat with it). */
  private fear = 0;
  private creatureTime = 0;
  private readonly creatureVelocity = new THREE.Vector3();
  private readonly creatureSpin = new THREE.Vector3();
  private readonly trail: THREE.Vector3[] = [];
  private trailIndex = 0;
  private chaseTime = 0;

  /** A faint sickly glow just in front of the creature (present from the warm-up, so no recompile). */
  private readonly creatureLight = new THREE.PointLight(0xd9c79a, 0, 7.5, 2);

  constructor(private readonly host: RiftEncounterHost, saved: RiftProgress | undefined, arrivedByFall: boolean) {
    this.random = new SeededRandom(`${host.seed}::rift-encounter`);
    this.creatureLight.name = 'rift-creature-glow';
    this.creatureLight.castShadow = false;
    host.scene.add(this.creatureLight);
    this.progress = saved ?? freshRiftProgress(arrivedByFall ? 'arrival' : 'north');
    this.phase = this.progress.stage === 'plank' ? 'plank' : this.progress.stage;
    if (this.progress.plank && (this.progress.stage === 'plank' || this.progress.resolution === 'fled')) {
      this.placePlank(this.progress.plank.lane, this.progress.plank.story, this.progress.plank.bank);
    }
  }

  get snapshot(): RiftProgress { return { ...this.progress, spoken: [...this.progress.spoken] }; }
  /** The rig must not run: the shot or the fall owns camera and body. */
  get ownsCharacter(): boolean { return this.owns; }
  get blocksSaving(): boolean {
    // Never while it hunts or searches for him on the far bank.
    if (this.phase === 'done' && this.hunt?.blocksSaving) return true;
    return !['arrival', 'north', 'plank', 'done'].includes(this.phase);
  }
  /** 0..1 dread for the heartbeat (balance, standoff, chase, hunt). */
  get heartFear(): number { return this.fear; }
  /** 0..1 how hunted the player is right now (adrenaline). */
  get threat(): number {
    if (this.phase === 'standoff' || this.phase === 'chase' || this.phase === 'caught') return 1;
    return this.hunt?.threat ?? 0;
  }
  /** VHS interference from the creature 0..1 (proximity, sight, chase, capture). */
  get cameraDisturbance(): number {
    if (this.phase === 'caught') return Math.min(1, 0.7 + this.phaseTime * 0.3);
    if (this.phase === 'dead') return 0;
    const hunt = this.creatureMode === 'hunt' ? this.hunt?.cameraDisturbance ?? 0 : 0;
    const creature = this.host.creature();
    if (this.creatureMode === 'hidden' || this.creatureMode === 'hunt' || !creature?.isVisible) return hunt;
    const near = THREE.MathUtils.clamp(1 - this.creaturePosition.distanceTo(this.host.renderCamera.position) / 18, 0, 1);
    return Math.min(0.6, near * near * 0.5 + (this.phase === 'chase' || this.phase === 'standoff' ? 0.08 : 0));
  }
  get blocksEquipment(): boolean { return this.owns || this.phase === 'edge'; }
  /** Scripted shots: a pause or the console must not hand the controls back. */
  get locksInput(): boolean { return this.owns || this.phase === 'edge'; }
  /** 0..1 how close the creature is, for the compass needle. */
  get creatureProximity(): number {
    const creature = this.host.creature();
    if (!creature?.isVisible) return 0;
    return 1 - THREE.MathUtils.smoothstep(this.creaturePosition.distanceTo(this.host.player.position), 3, 26);
  }
  /** 0 (ordinary maze) .. 1 (at the brink): the rift's own darkness and fog. */
  atmosphereAt(position: Readonly<THREE.Vector3Like>): number {
    return 1 - THREE.MathUtils.smoothstep(Math.abs(position.z - RIFT_CENTER_Z), EPIC3_OUTER_HALF_DEPTH, EPIC3_OUTER_HALF_DEPTH + 24);
  }
  get questText(): { text: string; urgent: boolean } | null {
    switch (this.phase) {
      case 'arrival': return null;
      case 'north': return { text: 'Suivre la boussole vers le nord', urgent: false };
      case 'edge': return { text: 'Trouver un moyen de passer de l’autre côté', urgent: false };
      case 'plank': return { text: 'Traverser la faille sur la planche', urgent: false };
      case 'crossing': return { text: `Garder l’équilibre — ${this.host.keyLabel('left')} / ${this.host.keyLabel('right')}`, urgent: false };
      case 'crossed': return { text: 'Traverser la faille sur la planche', urgent: false };
      case 'standoff': return { text: `Pousser la planche dans le vide (${this.host.keyLabel('interact')}) — ou fuir !`, urgent: true };
      case 'chase': return { text: 'COURS !', urgent: true };
      case 'stalk': return { text: 'Sème-la ! Enchaîne les virages', urgent: true };
      case 'done': return { text: 'Continuer vers le nord', urgent: false };
      default: return null;
    }
  }

  // ------------------------------------------------------------------ frame

  update(delta: number): void {
    const dt = Math.min(0.05, Math.max(0, delta));
    this.phaseTime += dt;
    this.fade = Math.max(0, this.fade - dt / 0.7);
    if (!this.owns) this.host.hud.setFade(this.fade);
    this.flushLines();
    this.trackWalkedFloor();
    this.cameraLean = 0; this.cameraRoll = 0; this.cameraSag = 0; this.fovOverride = null;
    this.fear = 0;
    this.screamerKick = Math.max(0, this.screamerKick - dt * 2.4);
    if (this.phase !== 'falling' && this.phase !== 'dead' && this.phase !== 'caught' && this.detectFall()) return;
    switch (this.phase) {
      case 'arrival': this.updateArrival(dt); break;
      case 'north': this.updateNorth(); break;
      case 'edge': this.updateEdge(dt); break;
      case 'plank': this.updatePlankIdle(); break;
      case 'done':
        // The board is still there (it fled): stepping on it starts the walk, never mid-hunt.
        if (!this.hunt?.engaged) this.updatePlankIdle();
        if (this.phase === 'done') this.updateHunt(dt);
        break;
      case 'stalk': this.updateHunt(dt); break;
      case 'crossing': this.updateCrossing(dt); break;
      case 'crossed': this.updateCrossed(); break;
      case 'turn': this.updateTurn(dt); break;
      case 'standoff': this.updateStandoff(dt); break;
      case 'dropping': this.updateDropping(dt); break;
      case 'chase': this.updateChase(dt); break;
      case 'falling': this.updateFalling(dt); break;
      case 'caught': this.updateCaught(dt); break;
      case 'dead': this.updateDead(); break;
    }
    // Any other scripted phase while it is still out there: it slinks off, never engages.
    if (this.creatureMode === 'hunt' && this.phase !== 'done' && this.phase !== 'stalk' && this.phase !== 'caught' && this.phase !== 'dead') {
      if (this.hunt?.update(dt, false, true) === null) this.creaturePosition.copy(this.hunt.position);
      if (this.hunt && !this.hunt.visible) this.creatureMode = 'hidden';
    }
    this.updatePlankMotion(dt);
    this.updateCreature(dt);
    this.updateAmbience(dt);
  }

  /** After the rig copied its camera: lean over the edge, sway on the board, zoom. */
  applyCamera(): void {
    const camera = this.host.renderCamera;
    if (this.cameraLean !== 0) {
      camera.getWorldDirection(this.vector).setY(0);
      if (this.vector.lengthSq() > 1e-6) camera.position.addScaledVector(this.vector.normalize(), this.cameraLean);
    }
    if (this.cameraSag !== 0) camera.position.y -= this.cameraSag;
    if (this.cameraRoll !== 0) camera.quaternion.multiply(this.quaternion.setFromAxisAngle(Z_AXIS, this.cameraRoll));
    if (this.fovOverride !== null && Math.abs(camera.fov - this.fovOverride) > 1e-3) {
      camera.fov = this.fovOverride;
      camera.updateProjectionMatrix();
    }
    if (this.screamerKick > 0) {
      // The screamer hits the lens: a punch of the field of view and a hard shake.
      const kick = this.screamerKick * this.screamerKick * this.motionScale(), time = this.phaseTime;
      camera.quaternion.multiply(this.quaternion.setFromEuler(new THREE.Euler(
        Math.sin(time * 71) * 0.03 * kick, Math.sin(time * 53 + 1) * 0.03 * kick, Math.sin(time * 37 + 2) * 0.05 * kick)));
      camera.fov += 12 * kick;
      camera.updateProjectionMatrix();
    }
  }

  /** The interact key: shove the board into the void. */
  handleInteract(): boolean {
    if (this.phase !== 'standoff' || !this.plank || this.plank.thrown !== null || !this.nearPlankEnd()) return false;
    this.startDrop();
    return true;
  }

  // ------------------------------------------------------------- narration

  private say(id: RiftLineId, queued = false): void {
    if (this.progress.spoken.includes(id)) return;
    this.progress = { ...this.progress, spoken: [...this.progress.spoken, id] };
    if (queued && this.host.captionBusy()) { this.pendingLines.push(id); return; }
    this.host.say(RIFT_LINES[id]);
  }

  private flushLines(): void {
    if (this.pendingLines.length === 0 || this.host.captionBusy()) return;
    this.host.say(RIFT_LINES[this.pendingLines.shift()!]);
  }

  private setStage(stage: RiftProgress['stage'], extra: Partial<RiftProgress> = {}): void {
    this.progress = { ...this.progress, ...extra, stage };
    this.host.onProgress(this.snapshot);
  }

  private enter(phase: Phase): void { this.phase = phase; this.phaseTime = 0; }

  private updateArrival(dt: number): void {
    const down = this.host.character?.isDown ?? false;
    this.standingTime = down ? 0 : this.standingTime + dt;
    if (this.standingTime < 1.1) return;
    for (const id of ['wake', 'where', 'items', 'north'] as const) this.say(id, true);
    if (this.pendingLines.length > 0 || this.host.captionBusy()) return;
    this.arrivalZ = this.host.player.position.z;
    this.enter('north');
    this.setStage('north');
  }

  private updateNorth(): void {
    const position = this.host.player.position;
    this.arrivalZ ??= position.z;
    const walked = northProgress(this.arrivalZ, position.z);
    this.maxNorth = Math.max(this.maxNorth, walked);
    if (walked > 140) this.say('endless', true);
    if (walked > 300) this.say('hum', true);
    if (this.maxNorth - walked > 45) this.say('wrongWay', true);
    if (!this.onWalkedRiftFloor()) return;
    const edge = riftEdgeDistance(position.z);
    if (edge > 0 && edge < EPIC3_OUTER_HALF_DEPTH - EPIC3_FACADE_HALF_DEPTH + 24) {
      this.say('draught', true);
      // Out of sight, behind the gallery wall: the board already lies over the void.
      if (!this.plank) this.placePlank(nearestRiftLane(position.x) + (this.random.chance(0.5) ? 1 : -1), this.currentStory(), riftBank(position.z));
    }
    const lane = this.brinkLane();
    if (lane !== null) this.startEdge(lane);
  }

  // ------------------------------------------------------------ geometry

  private currentStory(): number { return Math.round((this.host.player.position.y - EYE) / 5.4); }

  private onWalkedRiftFloor(): boolean {
    const feet = this.host.player.position.y - EYE;
    return Math.abs(feet - riftFloorY(this.currentStory())) < 0.4;
  }

  private trackWalkedFloor(): void {
    const position = this.host.player.position;
    if (isInRiftGallery(position.z) && this.onWalkedRiftFloor() && this.host.player.getDebugState().grounded) {
      this.walkedFloorY = riftFloorY(this.currentStory());
      this.walkedBank = riftBank(position.z);
    }
  }

  /** The lane of the portal the player stands in, at the very edge. */
  private brinkLane(): number | null {
    const position = this.host.player.position, edge = riftEdgeDistance(position.z);
    if (edge < -0.05 || edge > 1.1 || !this.onWalkedRiftFloor()) return null;
    const lane = nearestRiftLane(position.x);
    return Math.abs(position.x - riftLaneX(lane)) < 1.7 ? lane : null;
  }

  private plankCenter(target: THREE.Vector3, plank = this.plank!): THREE.Vector3 {
    return target.set(riftLaneX(plank.lane), riftFloorY(plank.story) + PLANK_THICKNESS * 0.5, RIFT_CENTER_Z);
  }

  private plankVisible(): boolean {
    if (!this.plank) return false;
    const camera = this.host.renderCamera;
    camera.updateMatrixWorld();
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projection);
    this.plank.root.updateMatrixWorld(true);
    this.box.setFromObject(this.plank.mesh);
    return this.box.distanceToPoint(camera.position) < 95 && this.frustum.intersectsBox(this.box);
  }

  // ---------------------------------------------------------------- plank

  /** The board exists from the start, hidden and without collider, so its shader is warmed with the scene. */
  private plankModel?: Plank;
  get warmupRoots(): readonly THREE.Object3D[] { return [this.ensurePlankModel().root]; }

  private ensurePlankModel(): Plank {
    if (this.plankModel) return this.plankModel;
    const geometry = new THREE.BoxGeometry(PLANK_WIDTH, PLANK_THICKNESS, PLANK_LENGTH, 1, 1, 28);
    const material = new THREE.MeshStandardMaterial({ name: 'rift-plank-wood', color: 0x8b6a46, roughness: 0.86, metalness: 0, map: createWoodTexture(this.host.seed) });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'rift-plank';
    const root = new THREE.Group();
    root.name = 'rift-plank-root';
    root.visible = false;
    root.add(mesh);
    this.host.scene.add(root);
    this.plankModel = {
      lane: 0, story: 0, bank: 1, root, mesh, rest: Float32Array.from(geometry.getAttribute('position').array as ArrayLike<number>),
      mounted: false, thrown: null,
      fall: { position: new THREE.Vector3(), velocity: new THREE.Vector3(), spin: new THREE.Vector3(), free: false },
    };
    return this.plankModel;
  }

  private placePlank(lane: number, story: number, bank: 1 | -1): void {
    this.plank ??= this.ensurePlankModel();
    const plank = this.plank;
    plank.lane = lane; plank.story = story; plank.bank = bank; plank.thrown = null;
    plank.root.visible = true;
    plank.root.quaternion.identity();
    this.plankCenter(plank.root.position);
    plank.root.updateMatrixWorld(true);
    if (plank.mounted) this.host.physics.removeChunk(PLANK_KEY);
    const collider: StaticCollider = {
      id: 'rift-plank', kind: 'floor',
      center: { x: plank.root.position.x, y: plank.root.position.y, z: plank.root.position.z },
      halfExtents: { x: PLANK_WIDTH * 0.5, y: PLANK_THICKNESS * 0.5, z: PLANK_LENGTH * 0.5 },
    };
    this.host.physics.addChunk(PLANK_KEY, [collider], { x: 0, y: 0, z: 0 });
    plank.mounted = true;
  }

  /** Bow the board under whoever stands on it (rendering only, a few centimetres). */
  private sagAt(z: number, load: number): number {
    const along = THREE.MathUtils.clamp((z - (RIFT_CENTER_Z - EPIC3_FACADE_HALF_DEPTH)) / (EPIC3_FACADE_HALF_DEPTH * 2), 0, 1);
    return Math.sin(Math.PI * along) * 0.075 * load;
  }

  private updatePlankMotion(dt: number): void {
    const plank = this.plank;
    if (!plank || plank.thrown !== null) return;
    const loads: { z: number; load: number }[] = [];
    if (this.phase === 'crossing') loads.push({ z: this.host.player.position.z, load: 1 });
    if (this.creatureMode === 'plank') loads.push({ z: this.creaturePosition.z, load: 1.5 });
    const position = plank.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const array = position.array as Float32Array;
    const wobble = this.phase === 'crossing' && this.balance ? this.balance.rate * 0.004 : 0;
    for (let index = 0; index < array.length; index += 3) {
      const z = plank.root.position.z + plank.rest[index + 2]!;
      let sag = 0;
      for (const { z: at, load } of loads) sag += this.sagAt(z, load) * (1 - Math.min(1, Math.abs(z - at) / 9));
      array[index + 1] = plank.rest[index + 1]! - sag + wobble * Math.sin(Math.PI * ((plank.rest[index + 2]! / PLANK_LENGTH) + 0.5)) * Math.sign(plank.rest[index]!);
    }
    position.needsUpdate = true;
    void dt;
  }

  // ------------------------------------------------------------------ edge

  private startEdge(lane: number): void {
    const story = this.currentStory();
    const offset = this.plank ? this.plank.lane - lane : 0;
    if (!this.plank || this.plank.story !== story || Math.abs(offset) !== 1) {
      // Re-lay the board across the neighbouring portal pair, unless the player already saw it.
      if (!this.plank || !this.plankVisible()) {
        const choices = this.random.chance(0.5) ? [1, -1] : [-1, 1];
        this.placePlank(lane + choices[0]!, story, riftBank(this.host.player.position.z));
        if (this.plankVisible()) this.placePlank(lane + choices[1]!, story, riftBank(this.host.player.position.z));
      }
    }
    const player = this.host.player;
    player.setInputEnabled(false);
    player.setLookLocked(true);
    this.startLook.setFromQuaternion(player.getLookQuaternion(this.quaternion), 'YXZ');
    const bank = riftBank(player.position.z);
    this.edge.bank = bank;
    this.edge.across = viewYaw(0, -bank);
    this.edge.feet.copy(player.position);
    this.edge.side = Math.sign(riftLaneX(this.plank!.lane) - player.position.x) || 1;
    this.edge.presenting = false;
    this.edge.from.copy(this.host.renderCamera.position);
    this.edge.fromQuaternion.copy(this.host.renderCamera.quaternion);
    this.enter('edge');
  }

  /**
   * First person: out over the void, the drop below. Then outside, from the
   * void itself: he looks one way, the other, and the lens slides along the
   * facade to the board across the next pair of portals.
   */
  private updateEdge(dt: number): void {
    const t = this.phaseTime, base = this.host.baseFieldOfView(), edge = this.edge;
    if (crossed(t, dt, 0.3)) this.say('edge');
    if (crossed(t, dt, 4.4)) this.say('plank');
    if (crossed(t, dt, 4.7)) this.host.sound.creak(0.5, 0.25);
    if (t < EDGE_EXTERIOR) {
      const across = smooth(t / 0.7), down = smooth((t - 0.7) / 0.9);
      this.setLook(lerpAngle(this.startLook.y, edge.across, across),
        THREE.MathUtils.lerp(THREE.MathUtils.lerp(this.startLook.x, -0.15, across), -0.62, down));
      this.cameraLean = 0.28 * smooth((t - 0.2) / 0.6);
      return;
    }
    const character = this.host.character, camera = this.host.renderCamera;
    if (!edge.presenting) {
      edge.presenting = true;
      this.owns = true;
      edge.from.copy(camera.position);
      edge.fromQuaternion.copy(camera.quaternion);
      if (character) { character.setActive(false, true); character.beginComputerPresentation(); }
    }
    const shotTime = t - EDGE_EXTERIOR, feet = edge.feet, bank = edge.bank;
    const plankX = riftLaneX(this.plank!.lane), floor = feet.y - EYE;
    const body = bodyYaw(0, -bank);
    const toPlank = wrap(bodyYaw(plankX - feet.x, RIFT_CENTER_Z - feet.z) - body);
    // Looks the other way first, then toward the board.
    const head = THREE.MathUtils.lerp(-Math.sign(toPlank || 1) * 0.75 * smooth((shotTime - 0.35) / 0.55),
      THREE.MathUtils.clamp(toPlank, -0.9, 0.9), smooth((shotTime - 1.35) / 0.7));
    const frame = character?.sampleCorridorPresentation(feet, body, head, t, false);
    const headPoint = frame ? this.vectorB.copy(frame.head) : this.vectorB.copy(feet).add({ x: 0, y: 0.78, z: 0 });
    // Out over the void, a little to the side away from the board, below his eyes.
    const outside = this.shot.position.set(feet.x - edge.side * 2.3, floor + 1.25, RIFT_CENTER_Z + bank * (EPIC3_FACADE_HALF_DEPTH - 3.7));
    const plankPoint = this.vector.set(plankX, floor + 0.15, RIFT_CENTER_Z + bank * 1.5);
    const pan = smooth((shotTime - 2.1) / 1.3);
    this.shot.lookAt(headPoint);
    const onHim = this.quaternion.copy(this.shot.quaternion);
    this.shot.lookAt(plankPoint);
    const onPlank = this.shot.quaternion;
    const enter = smooth(shotTime / 0.35), leave = smooth((shotTime - (EDGE_DURATION - EDGE_EXTERIOR - 0.6)) / 0.6);
    const eye = frame?.eye ?? headPoint;
    // Back in his eyes, turned along the gallery toward that board.
    this.pov.position.copy(eye);
    this.pov.lookAt(plankX, eye.y - 0.25, RIFT_CENTER_Z + bank * (EPIC3_FACADE_HALF_DEPTH + 1.2));
    camera.position.lerpVectors(edge.from, outside, enter).lerp(eye, leave);
    camera.quaternion.slerpQuaternions(edge.fromQuaternion, onHim, enter).slerp(onPlank, pan).slerp(this.pov.quaternion, leave);
    const zoom = smooth((shotTime - 2.3) / 1.2) * (1 - leave);
    camera.fov = THREE.MathUtils.lerp(THREE.MathUtils.lerp(Math.min(base, 62), this.host.reducedMotion() ? 45 : 30, zoom), base, leave);
    camera.near = 0.03;
    camera.updateProjectionMatrix();
    if (t < EDGE_DURATION) return;
    this.host.player.setLookQuaternion(this.pov.quaternion);
    character?.endComputerPresentation(true);
    this.owns = false;
    camera.fov = base; camera.updateProjectionMatrix();
    this.releasePlayer();
    // The new phase first: saving is refused while a scripted phase is running.
    this.enter('plank');
    this.setStage('plank', { plank: { lane: this.plank!.lane, story: this.plank!.story, bank } });
  }

  private setLook(yaw: number, pitch: number, roll = 0): void {
    this.look.set(pitch, yaw, roll, 'YXZ');
    this.host.player.setLookQuaternion(this.lookQuaternion.setFromEuler(this.look));
  }

  private releasePlayer(): void {
    const player = this.host.player;
    player.setMovementConstraint(undefined);
    player.setMovementCapabilities({ sprint: true, jump: true });
    player.setSprintSuppressed(false);
    player.setLookLocked(false);
    player.setInputEnabled(player.isLocked);
    this.host.character?.setActive(player.isLocked, true);
  }

  // --------------------------------------------------------------- crossing

  /** Standing on the board itself (its bearing on the gallery floor included). */
  private onPlank(): boolean {
    const plank = this.plank;
    if (!plank || plank.thrown !== null) return false;
    const position = this.host.player.position;
    return Math.abs(position.x - riftLaneX(plank.lane)) < 0.45
      && riftEdgeDistance(position.z) < 0.6
      && Math.abs(position.y - EYE - riftFloorY(plank.story) - PLANK_THICKNESS) < 0.35;
  }

  private updatePlankIdle(): void {
    if (this.onPlank()) this.startCrossing();
  }

  private startCrossing(): void {
    const player = this.host.player;
    this.crossFrom = riftBank(player.position.z);
    this.balance = new BalanceModel(`${this.host.seed}:${this.plank!.lane}:${this.random.int(0, 1e6)}`);
    this.fallOff = 0;
    this.lastCreak = 0;
    player.setMovementCapabilities({ sprint: false, jump: false });
    player.setSprintSuppressed(true);
    player.setLookLocked(true);
    player.setMovementConstraint(this.constrainOnPlank);
    this.say('steady');
    this.enter('crossing');
  }

  private readonly constrainOnPlank = (position: THREE.Vector3, movement: THREE.Vector3): void => {
    const plank = this.plank, balance = this.balance;
    if (!plank || !balance) return;
    if (this.fallOff > 0) {
      // Gone: the body pitches off the side it leaned to.
      movement.x = Math.sign(balance.lean) * 0.075;
      movement.z *= 0.25;
      return;
    }
    const toward = -this.crossFrom;
    const along = movement.z * toward;
    // Only the part over the void is slow; the ends resting on the floor are walked normally.
    const overVoid = riftEdgeDistance(position.z) < 0;
    const scale = overVoid ? CROSSING_SPEED_SCALE : 1;
    movement.z = toward * along * (along >= 0 ? scale : scale * 0.75);
    const target = riftLaneX(plank.lane) + THREE.MathUtils.clamp(balance.lean * 0.24, -0.15, 0.15);
    movement.x = (target - position.x) * 0.2;
  };

  private updateCrossing(dt: number): void {
    const player = this.host.player, balance = this.balance!;
    const intent = player.getInputIntent();
    const local = this.crossFrom * (player.position.z - RIFT_CENTER_Z);
    const progress = THREE.MathUtils.clamp((EPIC3_FACADE_HALF_DEPTH - local) / (EPIC3_FACADE_HALF_DEPTH * 2), 0, 1);
    const walking = Math.min(1, Math.abs(intent.forward));
    if (this.fallOff > 0) {
      this.fallOff += dt;
      this.cameraRoll = Math.sign(balance.lean) * Math.min(1.1, 0.7 + this.fallOff * 1.6) * this.motionScale();
      // Caught on the edge of the board by the capsule: go anyway.
      if (this.fallOff > 1.1) { this.startFalling(); return; }
    } else if (riftEdgeDistance(player.position.z) < 0) {
      balance.step(dt, intent.right, walking, progress);
      if (balance.fallen) {
        this.fallOff = dt;
        this.host.sound.creak(1, 0.8);
      }
    } else {
      // On a bearing over solid floor: the body steadies itself.
      balance.lean *= Math.exp(-dt * 5);
      balance.rate *= Math.exp(-dt * 8);
    }
    const sway = this.host.reducedMotion() ? 0 : Math.sin(this.phaseTime * 1.7) * 0.04;
    this.setLook(viewYaw(0, -this.crossFrom) + balance.lean * 0.12, -0.6 + sway);
    if (this.fallOff === 0) this.cameraRoll = -balance.lean * 0.85 * this.motionScale();
    this.cameraSag = this.sagAt(player.position.z, 1);
    const travelled = progress * EPIC3_FACADE_HALF_DEPTH * 2;
    if (Math.abs(travelled - this.lastCreak) > 0.85 || (Math.abs(balance.rate) > 0.9 && this.phaseTime % 0.5 < dt)) {
      this.lastCreak = travelled;
      this.host.sound.creak(0.3 + 0.7 * balance.danger, 0.35 + 0.3 * balance.danger);
    }
    this.fear = Math.max(this.fear, 0.3 + 0.7 * balance.danger);
    this.host.balanceMeter.update(this.fallOff === 0, balance.lean / BalanceModel.LIMIT, intent.right,
      this.host.keyLabel('left'), this.host.keyLabel('right'));
    if (this.fallOff > 0) return;
    if (local > EPIC3_FACADE_HALF_DEPTH + 0.75 && !this.onPlank()) {
      // Stepped back off on the near side.
      this.stopCrossing();
      this.enter(this.progress.stage === 'done' ? 'done' : 'plank');
      return;
    }
    // Off the far end of the board (past its bearing on the gallery floor).
    if (local < -(EPIC3_FACADE_HALF_DEPTH + PLANK_BEARING + 0.05)) {
      this.stopCrossing();
      if (this.progress.stage === 'done') { this.enter('done'); return; }
      this.say('across');
      this.enter('crossed');
    }
  }

  private stopCrossing(): void {
    this.host.balanceMeter.update(false, 0, 0, '', '');
    this.releasePlayer();
    this.balance = undefined;
  }

  private updateCrossed(): void {
    const plank = this.plank!, position = this.host.player.position;
    const farEndZ = RIFT_CENTER_Z - this.crossFrom * EPIC3_FACADE_HALF_DEPTH;
    const away = Math.hypot(position.x - riftLaneX(plank.lane), position.z - farEndZ);
    if (away > 2.6 || this.phaseTime > 7 || this.onPlank()) this.startTurn();
  }

  // ------------------------------------------------------------- the turn

  private startTurn(): void {
    const player = this.host.player, character = this.host.character;
    this.owns = true;
    player.setInputEnabled(false);
    player.prepareScriptedStanding();
    this.turn.feet.copy(player.position);
    player.setScriptedPose(this.turn.feet, false);
    player.getViewDirection(this.viewDirection);
    this.turn.yawFrom = bodyYaw(this.viewDirection.x, this.viewDirection.z);
    this.creatureBrink(this.vector);
    this.turn.yawTo = bodyYaw(this.vector.x - this.turn.feet.x, this.vector.z - this.turn.feet.z);
    this.turn.from.copy(this.host.renderCamera.quaternion);
    this.turn.fromPosition.copy(this.host.renderCamera.position);
    if (character) { character.setActive(false, true); character.beginComputerPresentation(); }
    this.host.sound.stinger();
    this.resetCreature();
    this.enter('turn');
  }

  /** Where the creature stops at the edge of the bank the player came from. */
  private creatureBrink(target: THREE.Vector3): THREE.Vector3 {
    const plank = this.plank!;
    return target.set(riftLaneX(plank.lane), riftFloorY(plank.story), RIFT_CENTER_Z + this.crossFrom * (EPIC3_FACADE_HALF_DEPTH + 0.45));
  }

  /** Far down the straight corridor behind the portal the player came through. */
  private resetCreature(): void {
    const plank = this.plank!;
    this.creaturePosition.set(riftLaneX(plank.lane), riftFloorY(plank.story), RIFT_CENTER_Z + this.crossFrom * (EPIC3_OUTER_HALF_DEPTH + CREATURE_APPROACH_DEPTH));
    this.creatureYaw = bodyYaw(0, -this.crossFrom);
    this.creatureMode = 'hidden';
    this.creatureTime = 0;
    this.creatureAlong = 0;
    this.trail.length = 0;
    this.trailIndex = 0;
    this.chaseTime = 0;
    this.host.creature()?.setVisible(false);
  }

  private updateTurn(dt: number): void {
    const t = this.phaseTime, camera = this.host.renderCamera, character = this.host.character;
    const feet = this.turn.feet, plank = this.plank!, toward = this.crossFrom;
    const turnAmount = smooth((t - 0.55) / 1.05);
    const yaw = lerpAngle(this.turn.yawFrom, this.turn.yawTo, turnAmount);
    const headLead = wrap(this.turn.yawTo - yaw) * smooth((t - 0.35) / 0.45) * 0.55;
    const frame = character?.sampleCorridorPresentation(feet, yaw, THREE.MathUtils.clamp(headLead, -0.9, 0.9), t, false);
    const head = frame ? this.vectorB.copy(frame.head) : this.vectorB.copy(feet).add({ x: 0, y: 0.78, z: 0 });
    // Far off, standing in the corridor behind the other portal, then the charge.
    if (crossed(t, dt, 1.6)) { this.creatureMode = 'distant'; this.creatureTime = 0; this.host.creatureSound.startVoice(); }
    if (crossed(t, dt, 2.55)) {
      // It rears and screams at the far end of its corridor; the charge waits for the end of the shot.
      this.host.creature()?.snapHead();
      this.host.creatureSound.roar();
      this.host.hud.pulseFlash(0.45);
      this.creatureMode = 'rear';
      this.creatureTime = 0;
    }
    const facing = new THREE.Vector3(Math.sin(this.turn.yawFrom), 0, Math.cos(this.turn.yawFrom));
    const right = new THREE.Vector3(-Math.cos(this.turn.yawFrom), 0, Math.sin(this.turn.yawFrom));
    // Shot A: in front of him as he freezes and turns round.
    const shotA = this.safeCameraPoint(head, facing.clone().multiplyScalar(2.45).addScaledVector(right, 0.85).add({ x: 0, y: 0.05, z: 0 }));
    // Shot B: on the lane axis behind him, the long lens straight through both
    // portals, the far doorway and down the corridor where it stands.
    const behindZ = RIFT_CENTER_Z - toward * THREE.MathUtils.clamp(Math.abs(feet.z - RIFT_CENTER_Z) + 1.3,
      EPIC3_FACADE_HALF_DEPTH + 1.2, EPIC3_OUTER_HALF_DEPTH - 0.4);
    const shotB = new THREE.Vector3(riftLaneX(plank.lane) + 0.45, riftFloorY(plank.story) + 1.55, behindZ);
    const creatureChest = this.vector.copy(this.creaturePosition).add({ x: 0, y: 1.55, z: 0 });
    const wide = smooth(t / 0.4), cut = smooth((t - 1.7) / 0.25), back = smooth((t - 3.65) / 0.6);
    const base = this.host.baseFieldOfView();
    this.shot.position.copy(shotA);
    this.shot.lookAt(head.x, head.y - 0.05, head.z);
    const quaternionA = this.shot.quaternion.clone();
    this.shot.position.copy(shotB);
    this.shot.lookAt(creatureChest);
    const quaternionB = this.shot.quaternion.clone();
    const eye = frame?.eye ?? head;
    this.pov.position.copy(eye);
    this.pov.lookAt(creatureChest);
    camera.position.lerpVectors(this.turn.fromPosition, shotA, wide).lerp(shotB, cut).lerp(eye, back);
    camera.quaternion.slerpQuaternions(this.turn.from, quaternionA, wide).slerp(quaternionB, cut).slerp(this.pov.quaternion, back);
    camera.fov = THREE.MathUtils.lerp(THREE.MathUtils.lerp(Math.min(base, 58), 26 + 14 * smooth((t - 2.5) / 1.2), cut), base, back);
    camera.near = 0.03;
    camera.updateProjectionMatrix();
    if (t < TURN_DURATION) return;
    const player = this.host.player;
    player.setLookQuaternion(this.pov.quaternion);
    character?.endComputerPresentation(true);
    this.owns = false;
    this.releasePlayer();
    camera.position.copy(this.pov.position);
    camera.quaternion.copy(this.pov.quaternion);
    camera.fov = base; camera.updateProjectionMatrix();
    this.say('followed');
    this.enter('standoff');
  }

  /** A shot offset from the head, pulled in front of any wall between them. */
  private safeCameraPoint(head: THREE.Vector3, offset: THREE.Vector3): THREE.Vector3 {
    const distance = offset.length(), direction = offset.clone().normalize();
    const hit = this.host.physics.castEnvironmentRay(head, direction, distance + 0.3);
    const reach = hit ? Math.max(0.35, hit.distance - 0.3) : distance;
    return head.clone().addScaledVector(direction, Math.min(distance, reach));
  }

  // -------------------------------------------------------- standoff, drop

  private nearPlankEnd(): boolean {
    const plank = this.plank;
    if (!plank) return false;
    const position = this.host.player.position;
    const endZ = RIFT_CENTER_Z - this.crossFrom * (EPIC3_FACADE_HALF_DEPTH + 0.3);
    // From the gallery floor only: never while standing on the part over the void.
    return riftEdgeDistance(position.z) > 0.15
      && Math.hypot(position.x - riftLaneX(plank.lane), position.z - endZ) < 3.1
      && Math.abs(position.y - EYE - riftFloorY(plank.story)) < 0.6;
  }

  private updateStandoff(dt: number): void {
    this.recordTrail();
    if (this.nearPlankEnd()) this.host.hud.showHint(this.host.keyLabel('interact'), 'Pousser la planche dans le vide', 0.3, true);
    this.fear = Math.max(this.fear, 0.55 + 0.45 * this.creatureProximity);
    // Only now, the shot over, does it come up its corridor.
    if (this.creatureMode === 'hidden' || this.creatureMode === 'distant' || this.creatureMode === 'rear') { this.creatureMode = 'charge'; this.creatureTime = 0; }
    if (this.creatureMode === 'charge') {
      const brink = this.creatureBrink(this.vectorB);
      if (Math.abs(this.creaturePosition.z - brink.z) < 0.05) {
        // At the edge: it rears and screams across the void before stepping on.
        this.creatureMode = 'wait';
        this.creatureTime = 0;
        this.host.creatureSound.roar();
        this.host.creature()?.snapHead();
      }
    }
    if (this.creatureMode === 'wait' && this.creatureTime > STANDOFF_WAIT) { this.creatureMode = 'plank'; this.creatureTime = 0; this.creatureAlong = 0; }
    // Walking back out onto the board to meet it.
    const feet = this.vector.copy(this.host.player.position).setY(this.host.player.position.y - EYE);
    if (this.creatureMode === 'plank' && this.creaturePosition.distanceTo(feet) < CATCH_RADIUS) { this.startCaught(); return; }
    if (this.creatureMode === 'plank' && this.creatureAlong >= EPIC3_FACADE_HALF_DEPTH * 2 + 0.9) {
      this.creatureMode = 'run';
      this.host.creatureSound.startScream();
      this.host.creatureSound.setScreamActive(true);
      this.host.hud.hideHint();
      this.enter('chase');
    }
  }

  private startDrop(): void {
    const plank = this.plank!;
    plank.thrown = 0;
    plank.fall.free = false;
    if (plank.mounted) { this.host.physics.removeChunk(PLANK_KEY); plank.mounted = false; }
    this.host.hud.hideHint();
    this.host.sound.plankFall();
    const onBoard = this.creatureMode === 'plank';
    if (onBoard) {
      this.say('dropFall');
    } else {
      // Cut off: a scream of rage across the void, then it runs back the way it came, howling.
      this.say('dropLeave');
      this.creatureMode = 'flee';
      this.creatureTime = 0;
      this.host.creatureSound.startScream();
      this.host.creatureSound.setScreamActive(true);
      this.host.creatureSound.roar();
      this.host.creature()?.snapHead();
    }
    this.enter('dropping');
  }

  private updateDropping(dt: number): void {
    const plank = this.plank!;
    plank.thrown = (plank.thrown ?? 0) + dt;
    const t = plank.thrown, toward = this.crossFrom;
    if (!plank.fall.free) {
      // Shoved toward the far bank: the near end slips off its bearing and the
      // board swings down from the far ledge before sliding off it entirely.
      const slide = 0.8 * smooth(t / 0.3);
      const swing = t < 0.3 ? 0 : Math.min(1.3, 2.3 * (t - 0.3) * (t - 0.3) + 0.4 * (t - 0.3));
      const pivot = this.vector.set(riftLaneX(plank.lane), riftFloorY(plank.story), RIFT_CENTER_Z + toward * EPIC3_FACADE_HALF_DEPTH);
      // The board's centre, slid `slide` toward the far bank, seen from that bank's edge.
      const offset = this.vectorB.set(0, PLANK_THICKNESS * 0.5, -toward * (EPIC3_FACADE_HALF_DEPTH - slide));
      this.quaternion.setFromAxisAngle(X_AXIS, -toward * swing);
      offset.applyQuaternion(this.quaternion);
      plank.root.position.copy(pivot).add(offset);
      plank.root.quaternion.copy(this.quaternion);
      if (this.creatureMode === 'plank' && t > 0.34) this.dropCreature();
      if (swing >= 1.25) {
        plank.fall.free = true;
        plank.fall.velocity.set(0, -3.2, toward * 1.4);
        plank.fall.spin.set(-toward * 2.6, 0.4, 0.9);
      }
    } else {
      plank.fall.velocity.y = Math.max(-30, plank.fall.velocity.y - 9.8 * dt);
      plank.root.position.addScaledVector(plank.fall.velocity, dt);
      this.quaternion.setFromEuler(new THREE.Euler(plank.fall.spin.x * dt, plank.fall.spin.y * dt, plank.fall.spin.z * dt));
      plank.root.quaternion.multiply(this.quaternion);
      if (plank.root.position.y < riftFloorY(plank.story) - 70) plank.root.visible = false;
    }
    if (this.phaseTime < 4.6) return;
    this.enter('done');
    // The creature finishes its own exit (falling out of sight or running off).
    this.finishDrop(false);
  }

  private finishDrop(hideCreature: boolean): void {
    if (this.plank) this.plank.root.visible = false;
    if (hideCreature && this.creatureMode !== 'hidden') {
      this.host.creature()?.setVisible(false);
      this.creatureMode = 'hidden';
      this.host.creatureSound.stopAll(1.2);
    }
    this.setStage('done', { resolution: 'dropped', plank: undefined });
    this.say('onward', true);
  }

  private dropCreature(): void {
    this.creatureMode = 'falling';
    this.creatureTime = 0;
    this.creatureVelocity.set(0, -0.6, -this.crossFrom * 0.8);
    this.creatureSpin.set(this.random.float(1.2, 2.2) * -this.crossFrom, this.random.float(-0.6, 0.6), this.random.float(-1.4, 1.4));
    this.host.creature()?.setMotion('lunge');
    this.host.creatureSound.jumpscare();
  }

  // ---------------------------------------------------------------- chase

  private recordTrail(): void {
    const position = this.host.player.position;
    const last = this.trail[this.trail.length - 1];
    if (!last) {
      const plank = this.plank!;
      this.trail.push(new THREE.Vector3(riftLaneX(plank.lane), riftFloorY(plank.story), RIFT_CENTER_Z - this.crossFrom * (EPIC3_FACADE_HALF_DEPTH + 0.6)));
    }
    const tail = this.trail[this.trail.length - 1]!;
    if (Math.hypot(position.x - tail.x, position.z - tail.z) > 0.5) this.trail.push(new THREE.Vector3(position.x, position.y - EYE, position.z));
    if (this.trail.length > 600) { this.trail.splice(0, 200); this.trailIndex = Math.max(0, this.trailIndex - 200); }
  }

  private trailGap(): number {
    let gap = 0, from = this.creaturePosition;
    for (let index = this.trailIndex; index < this.trail.length; index += 1) {
      gap += Math.hypot(this.trail[index]!.x - from.x, this.trail[index]!.z - from.z);
      from = this.trail[index]!;
    }
    const position = this.host.player.position;
    return gap + Math.hypot(position.x - from.x, position.z - from.z);
  }

  private updateChase(dt: number): void {
    this.recordTrail();
    this.chaseTime += dt;
    this.fear = Math.max(this.fear, 0.85);
    if (this.creatureMode === 'run') {
      const distance = this.creaturePosition.distanceTo(this.vector.copy(this.host.player.position).setY(this.host.player.position.y - EYE));
      if (distance < CATCH_RADIUS) { this.startCaught(); return; }
      if (this.trailGap() > GIVE_UP_GAP || this.chaseTime > GIVE_UP_SECONDS) this.loseTrack();
    }
    if (this.creatureMode === 'hidden' || this.creatureMode === 'retreat' || this.creatureMode === 'hunt') {
      // It gives up: back out of sight, its howl fading behind the walls.
      this.enter('done');
      this.setStage('done', { resolution: 'fled' });
      this.say('lost', true);
      this.say('onward', true);
    }
  }

  /** Lost the scent: gone at once if unseen, otherwise it slinks away out of sight (never fades in view). */
  private loseTrack(): void {
    this.host.creatureSound.roar();
    this.creatureTime = 0;
    if (!this.creatureSeen(true)) {
      this.hideCreature(1.8);
      return;
    }
    const hunt = this.ensureHunt();
    if (hunt) {
      this.host.creatureSound.setScreamActive(false);
      hunt.adoptWithdraw(this.creaturePosition, this.creatureYaw);
      this.creatureMode = 'hunt';
      return;
    }
    this.creatureMode = 'retreat';
  }

  private hideCreature(fade: number): void {
    this.host.creature()?.setVisible(false);
    this.creatureMode = 'hidden';
    this.host.creatureSound.stopAll(fade);
  }

  private seenTimer = 0;
  private lastSeen = false;
  /** Line of sight from its head to the player's eyes (throttled unless forced). */
  private creatureSeen(force = false): boolean {
    if (!force && this.seenTimer > 0) return this.lastSeen;
    this.seenTimer = 0.12;
    const camera = this.host.renderCamera.position;
    const head = this.vector.copy(this.creaturePosition).add({ x: 0, y: 1.95, z: 0 });
    const direction = this.vectorB.copy(camera).sub(head);
    const distance = direction.length();
    if (distance < 0.3) return (this.lastSeen = true);
    const hit = this.host.physics.castEnvironmentRay(head, direction.normalize(), distance);
    this.lastSeen = !hit || hit.distance > distance - 0.35;
    return this.lastSeen;
  }

  // ---------------------------------------------------------------- deaths

  private detectFall(): boolean {
    if (this.walkedFloorY === null) return false;
    const position = this.host.player.position;
    if (riftEdgeDistance(position.z) > -0.25 || position.y - EYE > this.walkedFloorY - 1.1) return false;
    if (Math.abs(position.y - EYE - this.walkedFloorY) > 40) return false;
    this.startFalling();
    return true;
  }

  private startFalling(): void {
    const player = this.host.player, camera = this.host.renderCamera;
    if (this.phase === 'dropping') this.finishDrop(true);
    const respawn = this.checkpoint();
    if (this.phase === 'crossing') this.stopCrossing();
    this.host.hud.hideHint();
    this.owns = true;
    player.setInputEnabled(false);
    player.setLookLocked(true);
    player.setMovementConstraint(undefined);
    this.host.character?.setExternalCameraPresentation(true);
    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    this.fallCamera.position.copy(camera.position);
    this.fallCamera.velocity = Math.min(-2, player.getDebugState().velocity.y);
    this.fallCamera.yaw = euler.y;
    this.fallCamera.pitch = euler.x;
    this.fallCamera.roll = euler.z;
    this.fallCamera.sign = this.random.chance(0.5) ? 1 : -1;
    this.death = { title: 'Tu es tombé.', detail: 'La faille n’a pas de fond. Reprise au bord…', respawn };
    this.enter('falling');
  }

  private updateFalling(dt: number): void {
    const t = this.phaseTime, camera = this.host.renderCamera, fall = this.fallCamera, base = this.host.baseFieldOfView();
    fall.velocity = Math.max(-28, fall.velocity - 11 * dt);
    fall.position.y += fall.velocity * dt;
    // Looking back up at the light shrinking away, the body turning over.
    const up = smooth(t / 1.1), tumble = Math.max(0, t - 0.9);
    const pitch = THREE.MathUtils.lerp(fall.pitch, 1.2, up) - 0.25 * Math.sin(tumble * 1.3) * up;
    const roll = THREE.MathUtils.lerp(fall.roll, fall.sign * 0.5, up) + fall.sign * tumble * 0.55;
    camera.position.copy(fall.position);
    camera.quaternion.setFromEuler(this.look.set(pitch, fall.yaw + fall.sign * tumble * 0.35, roll * this.motionScale(), 'YXZ'));
    camera.fov = base + 20 * smooth(t / 2.2);
    camera.near = 0.03;
    camera.updateProjectionMatrix();
    this.host.creatureSound.setFallWind(Math.min(1, 0.25 + Math.abs(fall.velocity) / 24));
    this.host.hud.setFade(smooth((t - 2) / 1.2));
    if (t < FALL_DURATION) return;
    this.host.creatureSound.stopFallWind(0.6);
    this.host.hud.showDeath(true, this.death!.detail, this.death!.title);
    this.enter('dead');
  }

  private startCaught(stalked?: Checkpoint): void {
    const respawn = stalked ?? this.checkpoint();
    if (this.creatureMode === 'hunt') this.host.creature()?.setPace(1);
    this.owns = true;
    this.host.player.setInputEnabled(false);
    this.host.player.setLookLocked(true);
    this.host.character?.setExternalCameraPresentation(true);
    this.host.hud.hideHint();
    this.host.hud.pulseFlash(1);
    this.host.creatureSound.jumpscare();
    this.creatureMode = 'wait';
    this.host.creature()?.setMotion('lunge');
    this.death = { title: 'Elle t’a eu.', detail: stalked ? 'Reprise un peu plus loin…' : 'Reprise de l’autre côté de la faille…', respawn };
    this.enter('caught');
  }

  private updateCaught(dt: number): void {
    const t = this.phaseTime, camera = this.host.renderCamera, creature = this.host.creature();
    if (creature) {
      creature.getFacePosition(this.vector);
      this.shot.position.copy(camera.position);
      this.shot.lookAt(this.vector);
      camera.quaternion.slerp(this.shot.quaternion, 1 - Math.exp(-dt * 18));
      camera.position.y -= dt * 1.2 * smooth(t / 0.4);
    }
    if (t > 0.25 && t - dt <= 0.25) this.host.hud.pulseFlash(1);
    this.host.hud.setFade(smooth((t - 0.75) / 0.25));
    if (t < 1.05) return;
    this.host.creatureSound.stopAll(0);
    this.host.hud.showDeath(true, this.death!.detail, this.death!.title);
    this.enter('dead');
  }

  private updateDead(): void {
    if (this.phaseTime < DEATH_HOLD || !this.death) return;
    const { respawn } = this.death;
    this.death = null;
    const player = this.host.player;
    this.host.hud.showDeath(false);
    this.fade = 1;
    this.host.hud.setFade(1);
    player.teleport(respawn.position);
    player.setLookQuaternion(respawn.look);
    this.host.character?.setExternalCameraPresentation(false);
    this.owns = false;
    this.releasePlayer();
    const camera = this.host.renderCamera;
    camera.fov = this.host.baseFieldOfView(); camera.updateProjectionMatrix();
    if (respawn.phase === 'standoff') {
      // Down its corridor again, already running.
      this.resetCreature();
      this.creatureMode = 'charge';
      this.host.creatureSound.startVoice();
    } else {
      this.host.creature()?.setVisible(false);
      this.creatureMode = 'hidden';
      // Whatever hunted him is gone; the director guarantees a quiet spell.
      this.hunt?.reset();
    }
    this.enter(respawn.phase);
  }

  /** Where a death in the rift resumes, facing the void. */
  private checkpoint(): Checkpoint {
    const plank = this.plank;
    const afterCrossing = ['crossed', 'turn', 'standoff', 'chase', 'dropping', 'caught'].includes(this.phase) && plank;
    const lookAcross = (bank: 1 | -1): THREE.Quaternion =>
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.16, viewYaw(0, -bank), 0, 'YXZ'));
    if (afterCrossing) {
      const bank = -this.crossFrom as 1 | -1;
      const resolved = this.progress.stage === 'done' || plank!.thrown !== null;
      return {
        position: new THREE.Vector3(riftLaneX(plank!.lane) + 1.1, riftFloorY(plank!.story) + EYE, RIFT_CENTER_Z + bank * (EPIC3_FACADE_HALF_DEPTH + 2.1)),
        look: lookAcross(bank), phase: resolved ? 'done' : 'standoff',
      };
    }
    const bank = this.phase === 'crossing' ? this.crossFrom : this.walkedBank;
    const floor = this.walkedFloorY ?? riftFloorY(this.currentStory());
    if (plank && plank.thrown === null && Math.abs(riftFloorY(plank.story) - floor) < 0.1) {
      return {
        position: new THREE.Vector3(riftLaneX(plank.lane), floor + EYE, RIFT_CENTER_Z + bank * (EPIC3_FACADE_HALF_DEPTH + 1.6)),
        look: lookAcross(bank), phase: this.progress.stage === 'done' ? 'done' : this.progress.stage === 'plank' ? 'plank' : 'north',
      };
    }
    const x = this.host.player.position.x, lane = nearestRiftLane(x);
    return {
      position: new THREE.Vector3(riftLaneX(lane), floor + EYE, RIFT_CENTER_Z + bank * (EPIC3_FACADE_HALF_DEPTH + 2.2)),
      look: lookAcross(bank), phase: this.progress.stage === 'done' ? 'done' : this.progress.stage === 'plank' ? 'plank' : 'north',
    };
  }

  // -------------------------------------------------------------- creature

  private updateCreature(dt: number): void {
    const creature = this.host.creature();
    if (!creature) return;
    this.creatureTime += dt;
    const plank = this.plank;
    const mode = this.creatureMode;
    if (mode === 'hidden') { if (creature.isVisible) creature.setVisible(false); this.creatureLight.intensity = 0; return; }
    // The far-bank hunter drives the actor, its sound and its glow itself.
    if (mode === 'hunt') return;
    if (!creature.isVisible) creature.setVisible(true);
    const eye = this.host.renderCamera.position;
    this.creatureLight.intensity = mode === 'falling' ? Math.max(0, 1.1 - this.creatureTime * 0.4) : 1.1;
    this.vector.copy(eye).sub(this.creaturePosition).setY(0);
    if (this.vector.lengthSq() > 1e-4) this.vector.normalize();
    this.creatureLight.position.copy(this.creaturePosition).addScaledVector(this.vector, 1.1).add({ x: 0, y: 1.9, z: 0 });
    creature.setLookTarget(mode === 'falling' || mode === 'flee' || mode === 'retreat' ? null : eye);
    this.seenTimer -= dt;
    if (mode === 'distant') {
      // Far down the corridor, swaying, staring across at him.
      creature.setMotion('idle');
      this.creatureYaw = bodyYaw(0, -this.crossFrom);
    } else if (mode === 'rear') {
      // Still at the far end of its corridor: it rears, mouth split, then hunches to spring.
      creature.setMotion(this.creatureTime < 0.9 ? 'lunge' : 'crouch');
      this.creatureYaw = bodyYaw(0, -this.crossFrom);
    } else if (mode === 'charge' && plank) {
      // Straight up the clear lane corridor, through the doorway and the bay, to the edge.
      creature.setMotion('run');
      const brink = this.creatureBrink(this.vectorB);
      const remaining = Math.abs(brink.z - this.creaturePosition.z);
      this.creaturePosition.z += Math.sign(brink.z - this.creaturePosition.z) * Math.min(remaining, dt * CREATURE_CHARGE_SPEED);
      this.creaturePosition.x = brink.x;
      this.creatureYaw = bodyYaw(0, -this.crossFrom);
    } else if (mode === 'wait') {
      creature.setMotion(this.phase === 'caught' ? 'lunge' : this.creatureTime < 0.7 ? 'lunge' : 'crouch');
      if (this.phase === 'caught') {
        // In the face: lunge out of the dark at the lens.
        this.host.renderCamera.getWorldDirection(this.vector);
        this.creaturePosition.copy(eye).addScaledVector(this.vector.setY(0).normalize(), 1.05).setY(eye.y - 2.05);
        this.creatureYaw = bodyYaw(-this.vector.x, -this.vector.z);
      }
    } else if (mode === 'plank' && plank) {
      // Long limbs splayed for balance, frozen, then lurching on.
      creature.setMotion('stalk');
      this.creatureAlong += dt * CREATURE_PLANK_SPEED;
      const start = this.creatureBrink(this.vectorB);
      const z = start.z - this.crossFrom * this.creatureAlong;
      this.creaturePosition.set(riftLaneX(plank.lane) + Math.sin(this.creatureTime * 2.1) * 0.05,
        riftFloorY(plank.story) + PLANK_THICKNESS - this.sagAt(z, 1.5), z);
      this.creatureYaw = bodyYaw(0, -this.crossFrom);
      if (Math.floor(this.creatureAlong / 0.8) !== Math.floor((this.creatureAlong - dt * CREATURE_PLANK_SPEED) / 0.8)) {
        this.host.sound.creak(0.75, 0.5);
      }
    } else if (mode === 'run') {
      creature.setMotion('run');
      this.followTrail(dt);
    } else if (mode === 'retreat') {
      // Back the way it came along its own path, out of sight.
      creature.setMotion('run');
      this.followTrailBack(dt);
      if (!this.creatureSeen() || this.creatureTime > 4.5) this.hideCreature(1.8);
    } else if (mode === 'falling') {
      this.creatureVelocity.y = Math.max(-30, this.creatureVelocity.y - 9.8 * dt);
      this.creaturePosition.addScaledVector(this.creatureVelocity, dt);
      creature.root.rotation.x += this.creatureSpin.x * dt;
      creature.root.rotation.z += this.creatureSpin.z * dt;
      this.creatureYaw += this.creatureSpin.y * dt;
      if (this.creatureTime > 3.6) { this.hideCreature(0.8); creature.root.rotation.x = 0; creature.root.rotation.z = 0; }
    } else if (mode === 'flee' && plank) {
      // Rage at the edge for a moment, then it bolts back down its corridor, howling, until it is gone.
      if (this.creatureTime < 0.9) {
        creature.setMotion('lunge');
      } else {
        creature.setMotion('run');
        this.creatureYaw = lerpAngle(this.creatureYaw, bodyYaw(0, this.crossFrom), 1 - Math.exp(-dt * 9));
        if (this.creatureTime > 1.15) this.creaturePosition.z += this.crossFrom * dt * CREATURE_FLEE_SPEED;
        if (crossed(this.creatureTime, dt, 2.4)) this.host.creatureSound.roar();
      }
      const away = Math.abs(this.creaturePosition.z - RIFT_CENTER_Z);
      if (away > EPIC3_OUTER_HALF_DEPTH + 40 || this.creatureTime > 9) this.hideCreature(2.2);
    }
    if (mode !== 'falling') { creature.root.rotation.x = 0; creature.root.rotation.z = 0; }
    const rotationX = creature.root.rotation.x, rotationZ = creature.root.rotation.z;
    creature.setPlacement(this.creaturePosition, this.creatureYaw);
    creature.root.rotation.x = rotationX; creature.root.rotation.z = rotationZ;
    creature.update(dt);
    this.updateCreatureSound();
  }

  private updateCreatureSound(): void {
    const camera = this.host.renderCamera;
    const toward = this.vector.copy(this.creaturePosition).add({ x: 0, y: 1.4, z: 0 }).sub(camera.position);
    const distance = toward.length();
    camera.getWorldDirection(this.viewDirection);
    const right = this.vectorB.crossVectors(this.viewDirection, UP).normalize();
    const pan = distance > 0.01 ? right.dot(toward.normalize()) : 0;
    // In the maze its howl is muffled behind the walls once it loses sight of him.
    const occluded = this.creatureMode === 'retreat' && !this.lastSeen;
    this.host.creatureSound.updateSpatial(distance, pan, occluded ? 0.85 : 0);
  }

  /** Across the plank and along the player's own footsteps (always walkable). */
  private followTrail(dt: number): void {
    let budget = dt * CREATURE_RUN_SPEED;
    while (budget > 0 && this.trailIndex < this.trail.length) {
      const target = this.trail[this.trailIndex]!;
      const dx = target.x - this.creaturePosition.x, dz = target.z - this.creaturePosition.z, distance = Math.hypot(dx, dz);
      this.creatureYaw = lerpAngle(this.creatureYaw, bodyYaw(dx, dz), 1 - Math.exp(-dt * 10));
      if (distance > budget) {
        this.creaturePosition.x += dx / distance * budget;
        this.creaturePosition.z += dz / distance * budget;
        this.creaturePosition.y = THREE.MathUtils.lerp(this.creaturePosition.y, target.y, 0.2);
        break;
      }
      this.creaturePosition.copy(target);
      budget -= distance;
      this.trailIndex += 1;
    }
    if (this.trailIndex < this.trail.length || budget <= 0) return;
    const player = this.host.player.position;
    const dx = player.x - this.creaturePosition.x, dz = player.z - this.creaturePosition.z, distance = Math.hypot(dx, dz);
    if (distance < 0.01) return;
    const move = Math.min(distance, budget);
    this.creaturePosition.x += dx / distance * move;
    this.creaturePosition.z += dz / distance * move;
    this.creatureYaw = bodyYaw(dx, dz);
  }

  /** Back along its own path, away from him. */
  private followTrailBack(dt: number): void {
    let budget = dt * CREATURE_FLEE_SPEED;
    while (budget > 0 && this.trailIndex > 0) {
      const target = this.trail[this.trailIndex - 1]!;
      const dx = target.x - this.creaturePosition.x, dz = target.z - this.creaturePosition.z, distance = Math.hypot(dx, dz);
      this.creatureYaw = lerpAngle(this.creatureYaw, bodyYaw(dx, dz), 1 - Math.exp(-dt * 10));
      if (distance > budget) {
        this.creaturePosition.x += dx / distance * budget;
        this.creaturePosition.z += dz / distance * budget;
        return;
      }
      this.creaturePosition.copy(target);
      budget -= distance;
      this.trailIndex -= 1;
    }
  }

  // --------------------------------------------- the far bank: it hunts him

  private screamerKick = 0;

  private ensureHunt(): BackroomsHunt | undefined {
    if (this.hunt || !this.host.creature()) return this.hunt;
    this.hunt = new BackroomsHunt(this.host, this.creatureLight);
    return this.hunt;
  }

  /**
   * Past the rift (monster/BackroomsHunt): lurking out of sight ahead, the
   * notice, the chase down the nav field, the search, the shadowing. The
   * phase is 'stalk' while it runs at him; a capture resumes where he stood
   * when it noticed him.
   */
  private updateHunt(dt: number): void {
    const hunt = this.ensureHunt();
    if (!hunt) return;
    if (this.creatureMode !== 'hidden' && this.creatureMode !== 'hunt') return;
    const position = this.host.player.position;
    const armed = !this.owns && riftBank(position.z) === -this.crossFrom && Math.abs(position.z - RIFT_CENTER_Z) >= HUNT_RIFT_CLEARANCE;
    if (hunt.update(dt, armed, this.owns) === 'caught') {
      this.creaturePosition.copy(hunt.position);
      this.creatureYaw = hunt.yaw;
      const respawn = hunt.respawnPoint(new THREE.Vector3());
      this.startCaught({ position: respawn, look: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.05, viewYaw(0, -1), 0, 'YXZ')), phase: 'done' });
      return;
    }
    this.creatureMode = hunt.visible ? 'hunt' : 'hidden';
    if (hunt.visible) this.creaturePosition.copy(hunt.position);
    this.screamerKick = Math.max(this.screamerKick, hunt.kick);
    this.fear = Math.max(this.fear, hunt.fear);
    if (hunt.engaged && this.phase === 'done') this.enter('stalk');
    else if (!hunt.engaged && this.phase === 'stalk') this.enter('done');
  }

  private updateAmbience(dt: number): void {
    if (this.phase === 'falling' || this.phase === 'dead') return;
    const near = this.atmosphereAt(this.host.player.position);
    this.host.creatureSound.setFallWind(near > 0.01 ? near * (this.phase === 'crossing' ? 0.13 : 0.07) : 0);
    void dt;
  }

  private motionScale(): number { return this.host.reducedMotion() ? 0.35 : 1; }

  dispose(): void {
    if (this.phase === 'crossing') this.stopCrossing();
    if (this.phase === 'turn') this.host.character?.endComputerPresentation(true);
    this.host.player.setMovementConstraint(undefined);
    // Lamps back to normal, drone stopped.
    this.hunt?.dispose();
    this.hunt = undefined;
    this.creatureLight.removeFromParent();
    this.creatureLight.dispose();
    const model = this.plankModel;
    if (model) {
      if (model.mounted) this.host.physics.removeChunk(PLANK_KEY);
      model.root.removeFromParent();
      model.mesh.geometry.dispose();
      model.mesh.material.map?.dispose();
      model.mesh.material.dispose();
    }
    this.plank = undefined;
    this.plankModel = undefined;
    this.host.balanceMeter.update(false, 0, 0, '', '');
  }
}

/** A plain scaffold board: deterministic grain, two knots, worn ends. */
const createWoodTexture = (seed: string): THREE.CanvasTexture | null => {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const random = new SeededRandom(`${seed}::rift-plank-grain`);
  context.fillStyle = '#9a7650';
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (let line = 0; line < 26; line += 1) {
    const x = random.float(0, 64), shade = random.float(0.55, 0.9);
    context.strokeStyle = `rgba(${Math.round(70 * shade)}, ${Math.round(48 * shade)}, ${Math.round(28 * shade)}, ${random.float(0.18, 0.45).toFixed(2)})`;
    context.lineWidth = random.float(0.6, 2.2);
    context.beginPath();
    for (let y = 0; y <= 512; y += 16) context.lineTo(x + Math.sin(y * 0.02 + line) * random.float(0.5, 2.5), y);
    context.stroke();
  }
  for (let knot = 0; knot < 2; knot += 1) {
    const x = random.float(14, 50), y = random.float(80, 430);
    context.fillStyle = 'rgba(58, 36, 18, 0.7)';
    context.beginPath(); context.ellipse(x, y, random.float(2.5, 4.5), random.float(5, 9), 0, 0, Math.PI * 2); context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
};
