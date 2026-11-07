import * as THREE from 'three';
import type { StaticCollider, Vec3Data } from '../world/types';
import { disposeObjectTree } from './CompassModel';

/** Inside face of the entry wall, south of the front door (measured on the imported model). */
export const FUSE_BOX_MOUNT = { wallX: -2.02, z: -3.6, height: 1.62 } as const;
const SIZE = { width: 0.36, height: 0.46, depth: 0.085 } as const;
const MODULE = 0.0178;
const ROWS = [
  ['Diff. 40A', 'Éclairage', 'Prises séjour', 'Prises ch.', 'Cuisine', 'Four', 'Lave-linge', 'Chauffe-eau', 'Radiateurs', 'VMC'],
  ['Diff. 40A', 'Éclairage 2', 'Prises SdB', 'Plaques', 'Frigo', 'Lave-vaiss.', 'Réserve', 'Réserve', 'Volets', 'Sonnette'],
] as const;
type Stage = 'closed' | 'opening' | 'open' | 'arming' | 'tripped';

const labelTexture = (names: readonly string[]): THREE.Texture | null => {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 32;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#f3efe4'; context.fillRect(0, 0, 512, 32);
  context.strokeStyle = 'rgba(40,40,40,.35)'; context.fillStyle = '#26323e';
  context.font = '600 11px Arial, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
  const cell = 512 / (names.length + 1);
  names.forEach((name, index) => {
    const width = index === 0 ? cell * 2 : cell, x = index === 0 ? 0 : cell * (index + 1);
    context.strokeRect(x + .5, 2.5, width - 1, 27);
    context.save(); context.translate(x + width / 2, 16); context.scale(.82, 1);
    // Handwritten ink for the circuit names, printed for the differential.
    context.font = index === 0 ? '700 11px Arial, sans-serif' : 'italic 12px "Segoe Print", "Comic Sans MS", cursive';
    context.fillText(name, 0, 0); context.restore();
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return texture;
};

/**
 * A household consumer unit flush on the entry wall: white box, smoked hinged
 * door, two DIN rows of breakers under a 40 A differential each. After the
 * power cut it can be opened and re-armed — every lever falls straight back.
 */
export class FuseBox {
  readonly group = new THREE.Group();
  readonly collider: StaticCollider;
  private readonly door = new THREE.Group();
  private readonly levers: THREE.Object3D[] = [];
  private readonly ray = new THREE.Raycaster();
  private stage: Stage = 'closed';
  private time = 0;
  private armed = 0;
  private prompted = false;
  private readonly spark: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly center = new THREE.Vector3();

  constructor(floorY: number, private readonly hooks: {
    ui: { setInteraction(label: string | null): void };
    click(position: Vec3Data): void;
    flip(position: Vec3Data): void;
    trip(position: Vec3Data): void;
  }) {
    this.group.name = 'apartment-fuse-box';
    const { width: W, height: H, depth: D } = SIZE;
    // Built facing +Z with its back at z = 0, then turned to face into the apartment (-X).
    this.group.position.set(FUSE_BOX_MOUNT.wallX, floorY + FUSE_BOX_MOUNT.height, FUSE_BOX_MOUNT.z);
    this.group.rotation.y = -Math.PI / 2;
    this.center.copy(this.group.position).add(new THREE.Vector3(-D / 2, 0, 0));
    this.collider = {
      id: 'apartment-fuse-box', kind: 'wall',
      center: { x: FUSE_BOX_MOUNT.wallX - D / 2, y: floorY + FUSE_BOX_MOUNT.height, z: FUSE_BOX_MOUNT.z },
      halfExtents: { x: D / 2, y: H / 2, z: W / 2 },
    };
    const plastic = new THREE.MeshStandardMaterial({ name: 'fuse-box-plastic', color: 0xe9e8e1, roughness: 0.55, metalness: 0 });
    const plasticShade = new THREE.MeshStandardMaterial({ name: 'fuse-box-plastic-shade', color: 0xc9c7bd, roughness: 0.6, metalness: 0 });
    const smoke = new THREE.MeshPhysicalMaterial({ name: 'fuse-box-door', color: 0x9aa7ad, roughness: 0.18, metalness: 0, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide });
    const breakerWhite = new THREE.MeshStandardMaterial({ name: 'fuse-breaker', color: 0xf4f3ee, roughness: 0.45, metalness: 0 });
    const lever = new THREE.MeshStandardMaterial({ name: 'fuse-lever', color: 0x2d3a46, roughness: 0.5, metalness: 0 });
    const leverDiff = new THREE.MeshStandardMaterial({ name: 'fuse-lever-diff', color: 0x1c5fa8, roughness: 0.45, metalness: 0 });
    const test = new THREE.MeshStandardMaterial({ name: 'fuse-test', color: 0xe3b81c, roughness: 0.5, metalness: 0 });
    const rail = new THREE.MeshStandardMaterial({ name: 'fuse-rail', color: 0x8c9196, roughness: 0.35, metalness: 0.8 });
    const comb = new THREE.MeshStandardMaterial({ name: 'fuse-comb', color: 0x6b6f72, roughness: 0.5, metalness: 0.3 });
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.group): THREE.Mesh => {
      const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
    };
    // Back box: back plate and four bevelled sides.
    add(new THREE.BoxGeometry(W, H, 0.004), plasticShade, 0, 0, 0.002);
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.012, H, D), plastic, side * (W / 2 - 0.006), 0, D / 2);
      add(new THREE.BoxGeometry(W, 0.012, D), plastic, 0, side * (H / 2 - 0.006), D / 2);
    }
    // Front frame around the door opening.
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.03, H, 0.008), plastic, side * (W / 2 - 0.015), 0, D - 0.004);
      add(new THREE.BoxGeometry(W, 0.03, 0.008), plastic, 0, side * (H / 2 - 0.015), D - 0.004);
    }
    // Two DIN rows with their cover plate, combs and labels.
    const rowY = [0.095, -0.1];
    rowY.forEach((y, row) => {
      add(new THREE.BoxGeometry(W - 0.05, 0.035, 0.008), rail, 0, y, 0.02);
      add(new THREE.BoxGeometry(W - 0.04, 0.03, 0.004), plastic, 0, y + 0.06, D - 0.028);
      add(new THREE.BoxGeometry(W - 0.04, 0.03, 0.004), plastic, 0, y - 0.06, D - 0.028);
      const names = ROWS[row]!;
      const map = labelTexture(names);
      const label = add(new THREE.PlaneGeometry(MODULE * (names.length + 1), 0.018), new THREE.MeshStandardMaterial({ name: 'fuse-label', color: map ? 0xffffff : 0xf3efe4, map, roughness: 0.9 }), 0, y + 0.06, D - 0.0255);
      label.name = 'fuse-label';
      let x = -(MODULE * (names.length + 1)) / 2;
      names.forEach((_, index) => {
        const modules = index === 0 ? 2 : 1, w = MODULE * modules - 0.0008, cx = x + (MODULE * modules) / 2;
        add(new THREE.BoxGeometry(w, 0.086, 0.052), breakerWhite, cx, y, 0.026 + 0.026);
        // Raised front shoulder where the lever sits.
        add(new THREE.BoxGeometry(w, 0.045, 0.012), breakerWhite, cx, y, 0.058);
        const pivot = new THREE.Group();
        pivot.position.set(cx, y, 0.064);
        // The toggle sticks out of the shoulder; tilting it shows ON (tip up) or OFF (tip down).
        const handle = add(new THREE.BoxGeometry(index === 0 ? w * 0.72 : w * 0.62, 0.008, 0.017), index === 0 ? leverDiff : lever, 0, 0, 0.0085, pivot);
        handle.name = 'fuse-lever';
        this.group.add(pivot); this.levers.push(pivot);
        if (index === 0) add(new THREE.BoxGeometry(0.008, 0.006, 0.004), test, cx + w * 0.28, y - 0.03, 0.065);
        // Screw terminals above and below.
        for (const ty of [0.036, -0.036]) add(new THREE.CylinderGeometry(0.0028, 0.0028, 0.002, 10).rotateX(Math.PI / 2), comb, cx, y + ty, 0.0645);
        x += MODULE * modules;
      });
    });
    // Smoked door on a left hinge with a moulded pull.
    this.door.name = 'fuse-box-door';
    this.door.position.set(-W / 2 + 0.018, 0, D + 0.002);
    add(new THREE.BoxGeometry(W - 0.036, H - 0.036, 0.003), smoke, (W - 0.036) / 2, 0, 0, this.door);
    add(new THREE.BoxGeometry(0.012, 0.06, 0.008), plastic, W - 0.05, 0, 0.004, this.door);
    this.group.add(this.door);
    // A brief blue-white arc behind the levers when they all fall.
    this.spark = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.06), new THREE.MeshBasicMaterial({ name: 'fuse-spark', color: 0xbfe4ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.spark.position.set(0.04, 0.095, 0.07); this.group.add(this.spark);
    this.group.traverse(object => { const mesh = object as THREE.Mesh; if (mesh.isMesh) { mesh.castShadow = mesh !== this.spark; mesh.receiveShadow = true; } });
    this.setLevers(0);
  }

  get isBusy(): boolean { return this.stage === 'opening' || this.stage === 'arming'; }

  /** All levers: 0 down (tripped), 1 up. */
  private setLevers(up: number): void { for (const pivot of this.levers) pivot.rotation.x = THREE.MathUtils.lerp(0.55, -0.55, up); }

  private targeted(eye: THREE.Vector3, direction: THREE.Vector3): boolean {
    if (eye.distanceTo(this.center) > 2.2) return false;
    this.ray.set(eye, direction); this.ray.near = 0; this.ray.far = 2;
    return this.ray.intersectObject(this.group, true).length > 0;
  }

  /** Prompt only once it is reachable in the story. */
  updatePrompt(eye: THREE.Vector3, direction: THREE.Vector3, enabled: boolean): void {
    const label = !enabled || this.isBusy || !this.targeted(eye, direction) ? null
      : this.stage === 'closed' ? 'Ouvrir le tableau électrique' : 'Réarmer les disjoncteurs';
    if (label) { this.hooks.ui.setInteraction(label); this.prompted = true; }
    else if (this.prompted) { this.hooks.ui.setInteraction(null); this.prompted = false; }
  }

  interact(eye: THREE.Vector3, direction: THREE.Vector3, enabled: boolean): boolean {
    if (!enabled || this.isBusy || !this.targeted(eye, direction)) return false;
    if (this.prompted) { this.hooks.ui.setInteraction(null); this.prompted = false; }
    this.time = 0;
    if (this.stage === 'closed') { this.stage = 'opening'; this.hooks.click(this.center); }
    else { this.stage = 'arming'; this.armed = 0; }
    return true;
  }

  /** Returns 'tripped' on the frame the levers all fall back. */
  update(delta: number): 'tripped' | null {
    const dt = Math.max(0, delta);
    this.time += dt;
    this.spark.material.opacity = Math.max(0, this.spark.material.opacity - dt * 9);
    if (this.stage === 'opening') {
      const t = Math.min(1, this.time / 0.6);
      this.door.rotation.y = -1.85 * (1 - (1 - t) ** 3);
      if (t >= 1) this.stage = 'open';
      return null;
    }
    if (this.stage !== 'arming') return null;
    // One lever after another, each with its own click, then a beat — and they all fall.
    const interval = 0.2, count = this.levers.length;
    while (this.armed < count && this.time >= 0.15 + this.armed * interval) {
      const pivot = this.levers[this.armed]!;
      pivot.rotation.x = -0.55;
      this.hooks.flip(pivot.getWorldPosition(new THREE.Vector3()));
      this.armed += 1;
    }
    const fall = 0.15 + count * interval + 0.55;
    if (this.time >= fall) {
      this.setLevers(0);
      this.spark.material.opacity = 1;
      this.hooks.trip(this.center);
      this.stage = 'tripped';
      return 'tripped';
    }
    return null;
  }

  dispose(): void {
    if (this.prompted) this.hooks.ui.setInteraction(null);
    this.group.removeFromParent();
    disposeObjectTree(this.group);
  }
}
