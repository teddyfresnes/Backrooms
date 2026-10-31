import * as THREE from 'three';
import type { Vec3Data } from '../world/types';
import type { HallArrivalState } from '../core/SaveHistory';

export const MAIL_REMINDER = 'Mon courrier… Je dois le récupérer avant de monter.';
export const HOME_REMINDER = 'Il est temps de rentrer chez moi. Au dernier étage.';

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

  constructor(
    private readonly mailbox: THREE.Object3D,
    private readonly ui: StoryUI,
    private readonly caption: StoryCaption,
    private state: HallArrivalState,
    private readonly voice: (cue: 'hmm' | 'gasp') => void,
    private readonly onChange: () => void,
  ) {
    const door = mailbox.getObjectByName('Door_3');
    if (!door) throw new Error('Le portillon du courrier est absent.');
    this.door = door;
    this.closed = door.quaternion.clone();
    this.restoredMail = state === 'mail';
    this.progress = state === 'home' ? 1 : 0;
    const meshes: THREE.Mesh[] = [];
    door.traverse(object => { if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh); });
    const material = new THREE.LineBasicMaterial({ color: 0xf0d7a4, transparent: true, opacity: .85, depthWrite: false });
    for (const mesh of meshes) {
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 40), material);
      edge.matrix.copy(mesh.matrix); edge.matrixAutoUpdate = false; edge.matrixWorldNeedsUpdate = true;
      this.highlight.add(edge);
    }
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
    this.letter.visible = state === 'approach' || state === 'mail';
  }

  getState(): HallArrivalState { return this.state; }

  update(delta: number, position: Readonly<Vec3Data>, direction: THREE.Vector3, playing: boolean): void {
    if (this.disposed) return;
    this.caption.update(delta, playing);
    if (!playing) { this.hidePrompt(); return; }
    const lookingAtMail = this.hitsDoor(position, direction);
    if (this.state === 'approach' && position.y < 1.5 && position.z < -1.2 && (position.z > -3.65 || lookingAtMail)) {
      this.state = 'mail';
      this.caption.say(MAIL_REMINDER);
      this.voice('hmm');
      this.onChange();
    } else if (this.restoredMail && this.state === 'mail' && this.captionNeedsRestore) {
      this.captionNeedsRestore = false;
      this.caption.say(MAIL_REMINDER);
    }
    this.highlight.visible = this.state === 'mail';
    this.animate(delta);
    if (this.state === 'mail' && lookingAtMail) {
      this.ui.setInteraction('Récupérer le courrier'); this.prompted = true;
    } else this.hidePrompt();
  }
  private captionNeedsRestore = true;

  interact(position: Readonly<Vec3Data>, direction: THREE.Vector3, playing: boolean): boolean {
    if (this.disposed || !playing || this.state !== 'mail' || !this.hitsDoor(position, direction)) return false;
    this.state = 'home';
    this.highlight.visible = false;
    this.hidePrompt();
    this.caption.say(HOME_REMINDER);
    this.voice('gasp');
    this.onChange();
    return true;
  }

  suspend(): void { this.caption.hide(); this.hidePrompt(); }

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
    if (this.state === 'home') this.progress = Math.min(1, this.progress + Math.max(0, delta) / .7);
    const eased = 1 - (1 - this.progress) ** 3;
    // The source's local Z is vertical and its existing origin is the hinge.
    this.door.quaternion.copy(this.closed).multiply(this.turn.setFromAxisAngle(this.axis, eased * 1.15));
    this.letter.visible = this.state === 'approach' || this.state === 'mail' || (this.state === 'home' && this.progress < .5);
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
      const line = object as THREE.LineSegments;
      if (!line.isLineSegments) return;
      line.geometry.dispose();
      for (const material of Array.isArray(line.material) ? line.material : [line.material]) materials.add(material);
    });
    materials.forEach(material => material.dispose());
    this.highlight.removeFromParent();
    this.letter.geometry.dispose(); this.letter.material.dispose(); this.letter.removeFromParent();
  }
}
