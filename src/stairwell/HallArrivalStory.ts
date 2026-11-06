import * as THREE from 'three';
import type { StaticCollider, Vec3Data } from '../world/types';
import type { HallArrivalState } from '../core/SaveHistory';
import { midLandingY, STAIRWELL_LEFT_FLIGHT, STAIRWELL_RIGHT_FLIGHT } from './layout';

export const MAIL_REMINDER = 'Mon courrier… Je dois le récupérer avant de monter.';
export const HOME_REMINDER = 'Il est temps de rentrer chez moi. Au dernier étage.';
export const MAIL_REACTION = 'Merde… le rétroviseur. Il ne manquait plus que ça.';
export const MAIL_STAIR_GATE: StaticCollider = {
  id: 'arrival-mail-stairs-gate', kind: 'barrier',
  center: { x: 0, y: midLandingY(0) + 1, z: STAIRWELL_LEFT_FLIGHT.maxZ + .79 }, halfExtents: { x: 2, y: 1, z: .045 },
};
export const MAIL_SECOND_FLIGHT_GATE: StaticCollider = {
  id: 'arrival-mail-second-flight-gate', kind: 'barrier',
  center: { x: (STAIRWELL_RIGHT_FLIGHT.minX + STAIRWELL_RIGHT_FLIGHT.maxX) / 2, y: midLandingY(0) + 1.1, z: STAIRWELL_RIGHT_FLIGHT.maxZ - .1 },
  halfExtents: { x: (STAIRWELL_RIGHT_FLIGHT.maxX - STAIRWELL_RIGHT_FLIGHT.minX) / 2, y: 1, z: .045 },
};
export const MAIL_SAFE_LANDING = { x: -.9, y: midLandingY(0) + .865, z: STAIRWELL_LEFT_FLIGHT.maxZ + .18 };

interface StoryUI {
  setInteraction(label: string | null): void;
}
interface StoryCaption {
  say(text: string): void;
  update(delta: number, playing: boolean): void;
  hide(): void;
  dispose(): void;
}

/** One selected, already hinged leaf; no scene-wide raycasts or new frame loop. */
export class HallArrivalStory {
  private readonly door: THREE.Object3D;
  private readonly closed: THREE.Quaternion;
  private readonly axis = new THREE.Vector3(0, 0, 1);
  private readonly turn = new THREE.Quaternion();
  private readonly ray = new THREE.Raycaster();
  private readonly eye = new THREE.Vector3();
  private readonly highlight = new THREE.Group();
  private readonly letter = new THREE.Mesh(
    new THREE.BoxGeometry(.22, .008, .115),
    new THREE.MeshStandardMaterial({ color: 0xd9d1bd, roughness: 1, metalness: 0 }),
  );
  private progress = 0;
  private prompted = false;
  private disposed = false;
  private readonly restoredMail: boolean;
  private collecting = false;
  private takeElapsed = 0;
  private reminderCooldown = 0;
  private stairReminderArmed = true;
  private mailGaspPlayed: boolean;
  private readonly letterStart = new THREE.Vector3();
  private readonly letterTarget = new THREE.Vector3();

  constructor(
    private readonly mailbox: THREE.Object3D,
    private readonly ui: StoryUI,
    private readonly caption: StoryCaption,
    private state: HallArrivalState,
    private readonly voice: (cue: 'hmm' | 'gasp') => void,
    private readonly onChange: () => void,
    private readonly options: { showLetter?(onVisible: () => void): void; mailGaspPlayed?: boolean } = {},
  ) {
    const door = mailbox.getObjectByName('Door_3');
    if (!door) throw new Error('Le portillon du courrier est absent.');
    this.door = door;
    this.closed = door.quaternion.clone();
    this.restoredMail = state === 'mail';
    this.mailGaspPlayed = options.mailGaspPlayed ?? (state === 'home' || state === 'done');
    this.progress = state === 'home' ? 1 : 0;
    // A small marker replaces the old full wire outline.
    door.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(door), center = bounds.getCenter(new THREE.Vector3());
    center.x = bounds.max.x + .018;
    const marker = new THREE.Mesh(new THREE.SphereGeometry(.012, 8, 6), new THREE.MeshBasicMaterial({ color: 0xc5d2b8 }));
    marker.position.copy(door.worldToLocal(center));
    const worldScale = door.getWorldScale(new THREE.Vector3());
    marker.scale.set(1 / Math.abs(worldScale.x), 1 / Math.abs(worldScale.y), 1 / Math.abs(worldScale.z));
    this.highlight.add(marker);
    this.highlight.name = 'mail-recipient-highlight';
    door.add(this.highlight);
    this.highlight.visible = state === 'mail';
    this.animate(0);
    mailbox.updateMatrixWorld(true);
    this.letter.name = 'player-mail-envelope';
    this.letter.position.set(-.16, .028, .145);
    door.add(this.letter);
    mailbox.updateMatrixWorld(true);
    // The letter stays in its compartment while the leaf swings on its hinge.
    door.parent!.attach(this.letter);
    this.letterStart.copy(this.letter.position);
    this.letter.visible = state === 'approach' || state === 'mail';
  }

  getState(): HallArrivalState { return this.state; }
  get isTakingLetter(): boolean { return this.collecting; }
  get blocksStairs(): boolean { return this.state === 'approach' || this.state === 'mail'; }
  get hasPlayedMailGasp(): boolean { return this.mailGaspPlayed; }

  tryStairs(position: Readonly<Vec3Data>, motionZ: number): boolean {
    if (position.z < STAIRWELL_LEFT_FLIGHT.maxZ - .35) this.stairReminderArmed = true;
    if (!this.blocksStairs || this.collecting || !this.stairReminderArmed || motionZ <= .1 || this.reminderCooldown > 0
      || position.x < STAIRWELL_LEFT_FLIGHT.minX || position.x > STAIRWELL_LEFT_FLIGHT.maxX
      || position.y < midLandingY(0) + .7 || position.y > midLandingY(0) + 1.1
      || position.z < STAIRWELL_LEFT_FLIGHT.maxZ + .23 || position.z > MAIL_STAIR_GATE.center.z) return false;
    this.reminderCooldown = 2;
    this.stairReminderArmed = false;
    this.state = 'mail';
    this.caption.say(MAIL_REMINDER);
    if (!this.mailGaspPlayed) { this.mailGaspPlayed = true; this.voice('gasp'); }
    this.onChange();
    return true;
  }

  update(delta: number, position: Readonly<Vec3Data>, direction: THREE.Vector3, playing: boolean): void {
    if (this.disposed) return;
    this.caption.update(delta, playing);
    if (!playing) { this.hidePrompt(); return; }
    this.reminderCooldown = Math.max(0, this.reminderCooldown - delta);
    const lookingAtMail = this.hitsDoor(position, direction);
    if (this.state === 'approach' && position.y < 1.5 && position.z < -1.2 && (position.z > -3.65 || lookingAtMail)) {
      this.state = 'mail';
      // Make direct collection available, but keep the first reminder and
      // surprise at the actual landing gate, alongside its recoil.
      this.onChange();
    } else if (this.restoredMail && this.state === 'mail' && this.captionNeedsRestore) {
      this.captionNeedsRestore = false;
      this.caption.say(MAIL_REMINDER);
    }
    this.highlight.visible = this.state === 'mail' && !this.collecting;
    this.animate(delta);
    if (this.state === 'mail' && !this.collecting && lookingAtMail) {
      this.ui.setInteraction('Récupérer le courrier'); this.prompted = true;
    } else this.hidePrompt();
  }
  private captionNeedsRestore = true;

  interact(position: Readonly<Vec3Data>, direction: THREE.Vector3, playing: boolean): boolean {
    if (this.disposed || !playing || this.state !== 'mail' || this.collecting || !this.hitsDoor(position, direction)) return false;
    this.collecting = true; this.takeElapsed = 0;
    this.letterTarget.set(position.x, position.y + .45, position.z).addScaledVector(direction, .45);
    this.letter.parent!.worldToLocal(this.letterTarget);
    this.highlight.visible = false;
    this.hidePrompt();
    return true;
  }

  suspend(): void { this.caption.hide(); this.hidePrompt(); }

  /** The way home is over (the Bacteria encounter was survived). */
  complete(): void {
    if (this.disposed || this.state === 'done') return;
    this.state = 'done';
    this.highlight.visible = false;
    this.hidePrompt();
    this.onChange();
  }

  private hitsDoor(position: Readonly<Vec3Data>, direction: THREE.Vector3): boolean {
    // Reject rays from other floors or outside the hall, including through walls.
    if (position.y < .25 || position.y > 1.5 || Math.abs(position.x) > 1.82 || position.z < -6.03 || position.z > -1.2 || direction.lengthSq() < 1e-6) return false;
    this.mailbox.updateWorldMatrix(true, true);
    this.eye.set(position.x, position.y + .73, position.z);
    this.ray.set(this.eye, direction.clone().normalize());
    this.ray.near = 0; this.ray.far = 2.6;
    const hit = this.ray.intersectObject(this.mailbox, true).find(hit => (hit.object as THREE.Mesh).isMesh);
    if (!hit) return false;
    let object: THREE.Object3D | null = hit.object;
    while (object && object !== this.mailbox) { if (object === this.door) return true; object = object.parent; }
    return false;
  }

  private animate(delta: number): void {
    if (this.collecting) {
      this.takeElapsed += Math.max(0, delta);
      this.progress = Math.min(1, this.takeElapsed / .5);
      const t = THREE.MathUtils.clamp((this.takeElapsed - .3) / .5, 0, 1);
      this.letter.position.lerpVectors(this.letterStart, this.letterTarget, t * t * (3 - 2 * t));
      if (this.takeElapsed >= .85) {
        this.collecting = false; this.state = 'home'; this.letter.visible = false;
        this.caption.say(MAIL_REACTION); this.onChange();
        this.options.showLetter?.(() => this.caption.say(MAIL_REACTION));
      }
    }
    const eased = 1 - (1 - this.progress) ** 3;
    // The source's local Z is vertical and its existing origin is the hinge.
    this.door.quaternion.copy(this.closed).multiply(this.turn.setFromAxisAngle(this.axis, eased * 1.15));
    this.letter.visible = this.state === 'approach' || this.state === 'mail';
  }

  private hidePrompt(): void {
    if (this.prompted) this.ui.setInteraction(null);
    this.prompted = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.hidePrompt(); this.caption.dispose();
    const materials = new Set<THREE.Material>();
    this.highlight.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
    });
    materials.forEach(material => material.dispose());
    this.highlight.removeFromParent();
    this.letter.geometry.dispose(); this.letter.material.dispose(); this.letter.removeFromParent();
  }
}
