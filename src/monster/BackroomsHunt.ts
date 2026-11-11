import * as THREE from 'three';
import type { RiftAudio } from '../audio/RiftAudio';
import { LightFlicker } from '../render/LightDisturbance';
import { SeededRandom } from '../world/SeededRandom';
import type { Vec3Data } from '../world/types';
import type { BacteriaActor } from './BacteriaActor';
import { PRESENCE_LOOP_END, PRESENCE_LOOP_START, type BacteriaAudio } from './BacteriaAudio';
import { chooseLurkSpot, TensionDirector, type PlacementContext } from './BackroomsDirector';
import { BackroomsHunter, type HunterSenses, type HunterState } from './BackroomsHunter';
import { NavGrid } from './BackroomsNav';

/** Eye height above the player's feet in the rift runtime (capsule centre offset). */
const EYE = 0.865;
const HEAD = 1.95;
const CHEST = 1.2;
const SIGHT_INTERVAL = 0.1;
const CHASE_LINES = ['Non… pas encore !', 'Elle est là !', 'Merde, merde, merde…', 'Cours. COURS !'] as const;
const LOST_LINE = 'Je… je crois que je l’ai semée.';
/** Presence drone level by state, before distance (0 = silent approach). */
const PRESENCE_LEVEL: Readonly<Record<HunterState, number>> = {
  dormant: 0, lurk: 0.75, notice: 0.9, chase: 0.45, search: 0.8, shadow: 0.6, withdraw: 0.5,
};

export interface BackroomsHuntHost {
  /** Camera actually presented: the player's eyes. */
  readonly renderCamera: THREE.PerspectiveCamera;
  readonly player: {
    readonly position: THREE.Vector3;
    readonly isSprinting?: boolean;
    readonly isMoving?: boolean;
    readonly horizontalSpeed?: number;
    getViewDirection(target?: THREE.Vector3): THREE.Vector3;
  };
  readonly physics: {
    castEnvironmentRay(origin: Vec3Data, direction: Vec3Data, maxDistance: number): { distance: number } | null;
    probeWalkableCell?(x: number, z: number, floorY: number): number;
  };
  readonly creatureSound: BacteriaAudio;
  readonly sound: Pick<RiftAudio, 'stinger'>;
  readonly hud: { pulseFlash(amount: number): void };
  readonly seed: string;
  creature(): BacteriaActor | undefined;
  say(text: string): void;
  darknessAt?(x: number, y: number, z: number): number;
  /** Changes when the mounted world changes (chunk hand-off): the nav cells are probed again. */
  worldRevision?(): number;
}

/**
 * Runtime of the far-bank hunt: wires the pure hunter, nav grid and director
 * to Rapier (cell probes, sight lines), the BacteriaActor, its sound layer,
 * the lamps' flicker uniforms and the camera interference. RiftEncounter calls
 * `update` each frame on the far bank and takes the creature back for a capture.
 */
export class BackroomsHunt {
  readonly nav: NavGrid;
  readonly hunter: BackroomsHunter;
  readonly director: TensionDirector;
  private readonly random: SeededRandom;
  private readonly flicker: LightFlicker;
  private readonly feet = new THREE.Vector3();
  private readonly senses = {
    feet: { x: 0, y: 0, z: 0 }, speed: 0, noise: 0, sees: false, seen: false, stared: false, cinematic: false,
  };
  private readonly heading = { x: 0, z: -1 };
  private readonly eye = new THREE.Vector3();
  private readonly view = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly frustum = new THREE.Frustum();
  private readonly projection = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), 0.55);
  private readonly lastFeet = new THREE.Vector3(Number.NaN, 0, 0);
  private readonly lightCentre = { x: 0, y: 0, z: 0 };
  private sightTimer = 0;
  private fieldTimer = 0;
  private revision = Number.NaN;
  private silent = false;
  private chased = false;
  private lineSaid = false;
  private glitch = 0;
  private wasSeen = false;
  private occlusion = 1;
  private disturbance = 0;
  private clickTimer = 3;
  private lastBallast = 0;
  private time = 0;
  private presenceStarted = false;
  private caught = false;
  /** Screen kick when it screams (RiftEncounter applies it to the lens). */
  kick = 0;

  constructor(private readonly host: BackroomsHuntHost, private readonly glow: THREE.PointLight) {
    this.random = new SeededRandom(`${host.seed}::backrooms-hunt`);
    this.flicker = new LightFlicker(this.random.fork('flicker'));
    const physics = host.physics;
    // Without a cell probe (tests of other sequences) the floor is open everywhere.
    this.nav = new NavGrid(physics.probeWalkableCell
      ? (x, z, floorY) => physics.probeWalkableCell!(x, z, floorY)
      : (_x, _z, floorY) => floorY);
    this.hunter = new BackroomsHunter(this.nav, this.random.fork('hunter'));
    this.director = new TensionDirector(this.random.fork('director'));
  }

  get state(): HunterState { return this.hunter.state; }
  get position(): Readonly<Vec3Data> { return this.hunter.position; }
  get yaw(): number { return this.hunter.yaw; }
  get visible(): boolean { return this.hunter.visible; }
  get engaged(): boolean { return this.hunter.engaged; }
  get blocksSaving(): boolean { return this.hunter.blocksSaving; }
  get threat(): number { return this.hunter.threat; }
  get fear(): number {
    switch (this.hunter.state) {
      case 'chase': return 0.9;
      case 'notice': return 0.85;
      case 'search': return this.hunter.gap < 12 ? 0.6 : 0.35;
      default: return this.wasSeen ? 0.45 : 0;
    }
  }
  /** VHS interference 0..1. */
  get cameraDisturbance(): number { return this.disturbance; }
  /** Where to resume after a capture (feet + eye height), facing north. */
  respawnPoint(target: THREE.Vector3): THREE.Vector3 {
    const start = this.hunter.chaseStart;
    return Number.isFinite(start.x) ? target.set(start.x, start.y + EYE, start.z) : target.copy(this.host.player.position);
  }

  /** The creature of the plank chase, still in sight: it slinks away instead of vanishing. */
  adoptWithdraw(position: Readonly<Vec3Data>, yaw: number): void {
    this.prepareNav(true);
    this.hunter.adopt(position, yaw, 'withdraw');
    this.director.encounterStarted();
  }

  /** After a capture, a reload or a fall: nothing in the world, then the guaranteed quiet. */
  reset(): void {
    const wasActive = this.hunter.state !== 'dormant' || this.caught;
    this.caught = false;
    this.hunter.reset();
    this.host.creature()?.setPace(1);
    this.host.creatureSound.stopPresence(0.5);
    this.host.creatureSound.setScreamActive(false);
    this.glow.intensity = 0;
    this.flicker.update(1, 0);
    LightFlicker.clear();
    this.disturbance = 0;
    this.glitch = 0;
    this.presenceStarted = false;
    if (this.director.phase !== 'relief' && (wasActive || this.director.phase === 'encounter')) this.director.startRelief();
  }

  /**
   * @param armed the far bank, away from the rift: encounters may start
   * @param cinematic a scripted shot owns the player
   * @returns 'caught' when it reached him (the caller plays the capture)
   */
  update(delta: number, armed: boolean, cinematic: boolean): 'caught' | null {
    const dt = Math.max(0, Math.min(0.1, delta));
    this.time += dt;
    const creature = this.host.creature();
    const hunter = this.hunter;
    if (!creature) return null;
    const camera = this.host.renderCamera;
    this.feet.copy(this.host.player.position).setY(this.host.player.position.y - EYE);
    const active = hunter.state !== 'dormant';
    if (!armed && !active) { this.quiet(dt); return null; }
    this.prepareNav(false);
    this.senseSpeed(dt);
    this.eye.copy(camera.position);
    camera.getWorldDirection(this.view);
    this.updateFrustum();
    this.senses.cinematic = cinematic;
    this.senses.feet.x = this.feet.x; this.senses.feet.y = this.feet.y; this.senses.feet.z = this.feet.z;
    this.sightTimer -= dt;
    if (active && this.sightTimer <= 0) { this.sightTimer = SIGHT_INTERVAL; this.sense(); }
    else if (!active) { this.senses.sees = false; this.senses.seen = false; this.senses.stared = false; }

    // The director paces the encounters; while nothing is out there it needs the player's field.
    const walked = Number.isNaN(this.lastFeet.x) ? 0 : Math.hypot(this.feet.x - this.lastFeet.x, this.feet.z - this.lastFeet.z);
    this.lastFeet.copy(this.feet);
    if (!active) {
      this.fieldTimer -= dt;
      if (this.fieldTimer <= 0) { this.fieldTimer = 0.5; this.nav.computeField(this.feet.x, this.feet.z, 48); }
    }
    const cue = this.director.update(dt, { armed, cinematic, walked: Math.min(walked, 1), hunterDormant: !active });
    if (cue?.kind === 'spawn') this.trySpawn(cue.style, cue.silent);
    else if (cue?.kind === 'false-knock') this.falseKnock();

    hunter.update(dt, this.senses);
    const caught = this.handleEvents(creature);
    if (caught) return 'caught';
    this.drive(creature, dt);
    this.updateSound(dt);
    this.updateLights(dt);
    this.updateDisturbance(dt);
    return null;
  }

  dispose(): void {
    LightFlicker.clear();
    this.host.creatureSound.stopPresence(0);
  }

  // ------------------------------------------------------------- senses

  private prepareNav(force: boolean): void {
    const revision = this.host.worldRevision?.() ?? 0;
    if (revision !== this.revision) { this.revision = revision; this.nav.invalidate(); }
    this.nav.follow(this.feet.x, this.feet.z, this.feet.y);
    // Fill in the cells the last field could not afford, a few per frame (the hunter adds its own).
    this.nav.warm(force ? 400 : this.hunter.state === 'dormant' ? 40 : 16);
  }

  private senseSpeed(dt: number): void {
    const player = this.host.player;
    let speed = player.horizontalSpeed;
    if (speed === undefined) speed = Number.isNaN(this.lastFeet.x) || dt <= 0 ? 0 : Math.hypot(this.feet.x - this.lastFeet.x, this.feet.z - this.lastFeet.z) / dt;
    const moving = player.isMoving ?? speed > 0.3;
    const sprinting = player.isSprinting ?? speed > 5;
    this.senses.speed = speed;
    this.senses.noise = !moving ? 0 : sprinting ? 1 : speed > 2.2 ? 0.42 : 0.18;
    if (speed > 0.5 && !Number.isNaN(this.lastFeet.x)) {
      const dx = this.feet.x - this.lastFeet.x, dz = this.feet.z - this.lastFeet.z, length = Math.hypot(dx, dz);
      if (length > 1e-4) { this.heading.x += (dx / length - this.heading.x) * 0.1; this.heading.z += (dz / length - this.heading.z) * 0.1; }
    }
  }

  private updateFrustum(): void {
    const camera = this.host.renderCamera;
    camera.updateMatrixWorld();
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projection);
  }

  /** Clear line from the player's eyes to a world point (walls only). */
  private lineOfSight(x: number, y: number, z: number): boolean {
    this.direction.set(x - this.eye.x, y - this.eye.y, z - this.eye.z);
    const distance = this.direction.length();
    if (distance < 0.3) return true;
    const hit = this.host.physics.castEnvironmentRay(this.eye, this.direction.multiplyScalar(1 / distance), distance);
    return !hit || hit.distance > distance - 0.35;
  }

  private inView(x: number, y: number, z: number): boolean {
    this.sphere.center.set(x, y, z);
    return this.frustum.intersectsSphere(this.sphere);
  }

  private sense(): void {
    const position = this.hunter.position;
    const head = this.lineOfSight(position.x, position.y + HEAD, position.z);
    const chest = head || this.lineOfSight(position.x, position.y + CHEST, position.z);
    this.senses.sees = head || chest;
    this.senses.seen = this.senses.sees && (this.inView(position.x, position.y + HEAD, position.z) || this.inView(position.x, position.y + CHEST, position.z));
    this.point.set(position.x, position.y + 1.5, position.z).sub(this.eye);
    const distance = this.point.length();
    this.senses.stared = this.senses.seen && distance > 0.1 && this.point.dot(this.view) / distance > 0.985;
  }

  // ----------------------------------------------------------- director

  private placementContext(cinematic: boolean): PlacementContext {
    return {
      player: this.feet,
      heading: this.heading,
      north: { x: 0, z: -1 },
      cinematic,
      lineOfSight: (x, y, z) => this.lineOfSight(x, y, z),
      inView: (x, y, z) => this.inView(x, y, z),
      darkness: this.host.darknessAt ? (x, y, z) => this.host.darknessAt!(x, y, z) : undefined,
    };
  }

  private trySpawn(style: Parameters<typeof chooseLurkSpot>[3], silent: boolean): void {
    if (!this.nav.fieldValid) return;
    const spot = chooseLurkSpot(this.nav, this.placementContext(this.senses.cinematic), this.random, style);
    if (!spot) return;
    this.hunter.place(spot);
    this.director.encounterStarted();
    this.sightTimer = 0;
    this.silent = silent;
    this.chased = false;
    this.lineSaid = false;
    this.wasSeen = false;
    this.occlusion = 1;
    this.presenceStarted = false;
    // The ambush is announced: three knocks from where it will come, a few seconds before.
    if (style === 'ambush') this.knockFrom(spot.x, spot.y, spot.z);
  }

  private falseKnock(): void {
    // Nothing behind it: knocks from somewhere ahead and to the side, behind the walls.
    const angle = Math.atan2(this.heading.x, this.heading.z) + this.random.float(-1.6, 1.6);
    const distance = this.random.float(14, 26);
    this.knockFrom(this.feet.x + Math.sin(angle) * distance, this.feet.y, this.feet.z + Math.cos(angle) * distance);
  }

  private knockFrom(x: number, y: number, z: number): void {
    const distance = Math.hypot(x - this.eye.x, z - this.eye.z);
    this.host.creatureSound.knock(distance, this.pan(x, y + 1.4, z), 1);
  }

  // ------------------------------------------------------------- events

  private handleEvents(creature: BacteriaActor): boolean {
    const sound = this.host.creatureSound;
    for (const event of this.hunter.events) {
      switch (event) {
        case 'notice':
          creature.snapHead();
          this.glitch = Math.max(this.glitch, 0.55);
          this.clicks();
          break;
        case 'scream':
          this.chased = true;
          sound.startScream();
          sound.setScreamActive(true);
          sound.roar();
          this.host.sound.stinger();
          this.host.hud.pulseFlash(0.6);
          this.kick = 1;
          this.glitch = Math.max(this.glitch, 0.7);
          if (!this.lineSaid) { this.lineSaid = true; this.host.say(CHASE_LINES[this.random.int(0, CHASE_LINES.length - 1)]!); }
          break;
        case 'lunge':
          creature.snapHead();
          sound.roar();
          this.glitch = Math.max(this.glitch, 0.35);
          break;
        case 'lost':
          // Out of its sight: the howl dies down, it starts to search.
          sound.setScreamActive(false);
          break;
        case 'heard': case 'sniff':
          this.clicks();
          break;
        case 'gave-up':
          if (this.chased) this.host.say(LOST_LINE);
          this.chased = false;
          break;
        case 'gone':
          creature.setVisible(false);
          creature.setPace(1);
          sound.setScreamActive(false);
          sound.stopPresence(2.5);
          this.presenceStarted = false;
          break;
        case 'caught':
          this.caught = true;
          creature.setPace(1);
          this.glow.intensity = 1.1;
          return true;
        default: break;
      }
    }
    return false;
  }

  private clicks(): void {
    const position = this.hunter.position;
    const distance = Math.hypot(position.x - this.eye.x, position.z - this.eye.z);
    this.host.creatureSound.clicks(distance, this.pan(position.x, position.y + 1.6, position.z), this.occlusion);
    this.clickTimer = this.random.float(4, 9);
  }

  // -------------------------------------------------------------- actor

  private drive(creature: BacteriaActor, dt: number): void {
    const hunter = this.hunter;
    if (!hunter.visible) {
      if (creature.isVisible) creature.setVisible(false);
      this.glow.intensity = 0;
      return;
    }
    if (!creature.isVisible) creature.setVisible(true);
    creature.setMotion(hunter.motion);
    creature.setPace(hunter.pace);
    creature.setHeadTwist(hunter.headTwist, hunter.headTwist === 0 ? 4 : 1.6);
    creature.setLookTarget(hunter.lookAtPlayer ? this.eye : null);
    creature.root.rotation.x = 0;
    creature.root.rotation.z = 0;
    creature.setPlacement(hunter.position, hunter.yaw);
    // Stared at from afar it holds still, mid-gesture.
    if (!hunter.frozen) creature.update(dt);
    // A faint sickly glow in front of its face, brighter when it runs.
    this.direction.set(this.eye.x - hunter.position.x, 0, this.eye.z - hunter.position.z);
    if (this.direction.lengthSq() > 1e-4) this.direction.normalize();
    this.glow.position.set(hunter.position.x, hunter.position.y + 1.9, hunter.position.z).addScaledVector(this.direction, 1.1);
    this.glow.intensity = hunter.engaged ? 1.1 : 0.5;
  }

  // -------------------------------------------------------------- sound

  private pan(x: number, y: number, z: number): number {
    this.point.set(x, y, z).sub(this.eye);
    const length = this.point.length();
    if (length < 0.01) return 0;
    this.direction.crossVectors(this.view, THREE.Object3D.DEFAULT_UP).normalize();
    return this.direction.dot(this.point.multiplyScalar(1 / length));
  }

  private updateSound(dt: number): void {
    const hunter = this.hunter, sound = this.host.creatureSound;
    if (!hunter.visible) { sound.setBreath(0, 99, 0, 1); return; }
    const position = hunter.position;
    const distance = Math.hypot(position.x - this.eye.x, position.y + 1.4 - this.eye.y, position.z - this.eye.z);
    const pan = this.pan(position.x, position.y + 1.4, position.z);
    this.occlusion += ((this.senses.sees ? 0 : 1) - this.occlusion) * (1 - Math.exp(-dt * 4));
    if (!this.presenceStarted && sound.hasPresence) {
      this.presenceStarted = true;
      sound.startPresence(this.random.float(0, PRESENCE_LOOP_END - PRESENCE_LOOP_START));
    }
    // A silent approach keeps the drone off until it runs at him.
    const level = this.silent && !this.chased ? 0 : PRESENCE_LEVEL[hunter.state];
    sound.setPresence(level, distance, pan, this.occlusion);
    const breathing = hunter.state === 'lurk' || hunter.state === 'search' || hunter.state === 'shadow' || hunter.state === 'notice';
    sound.setBreath(breathing ? (this.silent && !this.chased ? 0.45 : 0.85) : 0, distance, pan, this.occlusion);
    if (breathing && hunter.state !== 'notice') {
      this.clickTimer -= dt;
      if (this.clickTimer <= 0) this.clicks();
    }
    if (sound.isScreaming) sound.updateSpatial(distance, pan, this.occlusion * 0.85);
  }

  // ------------------------------------------------------------ lights

  private updateLights(dt: number): void {
    const hunter = this.hunter, position = hunter.position;
    this.flicker.update(dt, hunter.visible ? hunter.flicker : 0);
    this.lightCentre.x = position.x; this.lightCentre.y = position.y + 2.6; this.lightCentre.z = position.z;
    if (this.flicker.amplitude < 0.003) { LightFlicker.clear(); this.flicker.takeClacks(); this.host.creatureSound.setBuzz(0, 0); return; }
    this.flicker.apply(this.lightCentre);
    const distance = Math.hypot(position.x - this.eye.x, position.z - this.eye.z);
    const pan = this.pan(position.x, position.y + 2.6, position.z);
    const clacks = this.flicker.takeClacks();
    if (clacks > 0 && this.time - this.lastBallast > 0.09) {
      this.lastBallast = this.time;
      // Somewhere among the tubes around it, not exactly on it.
      this.host.creatureSound.ballast(distance + this.random.float(-3, 3), THREE.MathUtils.clamp(pan + this.random.float(-0.3, 0.3), -1, 1), this.occlusion * 0.6);
    }
    const near = THREE.MathUtils.clamp(1 - (distance - 4) / 18, 0, 1);
    const level = (this.flicker.levelA + this.flicker.levelB) * 0.5;
    this.host.creatureSound.setBuzz(this.flicker.amplitude * near * (0.35 + 0.65 * level), pan);
  }

  // --------------------------------------------------------- interference

  private updateDisturbance(dt: number): void {
    const hunter = this.hunter;
    this.glitch = Math.max(0, this.glitch - dt * 2.2);
    this.kick = Math.max(0, this.kick - dt * 2.4);
    const seen = hunter.visible && this.senses.seen;
    // Crossing into the frame tears the picture for an instant.
    if (seen && !this.wasSeen) this.glitch = Math.max(this.glitch, 0.45);
    this.wasSeen = seen;
    if (!hunter.visible) { this.disturbance = this.glitch; return; }
    const position = hunter.position;
    this.point.set(position.x, position.y + 1.4, position.z).sub(this.eye);
    const distance = this.point.length();
    const near = THREE.MathUtils.clamp(1 - distance / 18, 0, 1);
    const facing = seen && distance > 0.1 ? THREE.MathUtils.clamp((this.point.dot(this.view) / distance - 0.8) / 0.18, 0, 1) : 0;
    const gaze = facing * (0.4 + 0.6 * THREE.MathUtils.clamp(1 - distance / 50, 0, 1));
    const chase = hunter.engaged ? 0.1 : 0;
    this.disturbance = THREE.MathUtils.clamp(near * near * 0.5 + gaze * 0.3 + chase + this.glitch, 0, 0.75);
  }

  /** Nothing out there: lamps, drone and interference settle. */
  private quiet(dt: number): void {
    this.glitch = Math.max(0, this.glitch - dt * 2.2);
    this.kick = Math.max(0, this.kick - dt * 2.4);
    this.disturbance = this.glitch;
    if (this.flicker.amplitude > 0.003) {
      this.flicker.update(dt, 0);
      if (this.flicker.amplitude < 0.003) LightFlicker.clear(); else this.flicker.apply(this.lightCentre);
    }
  }
}
