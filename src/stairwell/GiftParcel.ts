import * as THREE from 'three';
import { createCompassModel, disposeObjectTree } from '../apartment/CompassModel';
import type { Vec3Data } from '../world/types';

const BOX = { width: 0.3, depth: 0.24, height: 0.17 } as const;
const LID_HEIGHT = 0.045;
const OPEN_SECONDS = 1.15;

const kraftTexture = (): THREE.Texture | null => {
  if (typeof document === 'undefined') return null;
  const size = 128, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#a27a4e'; context.fillRect(0, 0, size, size);
  // Paper fibres and a few darker creases: deterministic strokes, no randomness at runtime.
  for (let i = 0; i < 420; i++) {
    const x = (i * 37) % size, y = (i * 61 + (i % 7) * 13) % size, length = 3 + (i % 9);
    context.strokeStyle = i % 3 ? 'rgba(80,52,26,.16)' : 'rgba(214,180,130,.2)';
    context.lineWidth = 1;
    context.beginPath(); context.moveTo(x, y); context.lineTo(x + length, y + ((i % 5) - 2) * .6); context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
};

/**
 * The parcel Chloé left on the landing: a kraft box tied with a ribbon. Opening
 * it lifts the lid off beside the box and shows the compass and a folded note.
 */
export class GiftParcel {
  readonly group = new THREE.Group();
  private readonly lid = new THREE.Group();
  private readonly contents = new THREE.Group();
  private readonly compass: THREE.Group;
  private readonly ray = new THREE.Raycaster();
  private readonly marker: THREE.Mesh;
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private opening = -1;
  private opened: boolean;
  private prompted = false;

  constructor(position: Vec3Data, yaw: number, opened: boolean, private readonly ui: { setInteraction(label: string | null): void }) {
    this.opened = opened;
    this.group.name = 'chloe-gift-parcel';
    this.group.position.set(position.x, position.y, position.z);
    this.group.rotation.y = yaw;
    const map = kraftTexture();
    const kraft = this.material(new THREE.MeshStandardMaterial({ name: 'gift-kraft', color: map ? 0xffffff : 0xa27a4e, map, roughness: 0.93, metalness: 0 }));
    const inside = this.material(new THREE.MeshStandardMaterial({ name: 'gift-kraft-inside', color: 0x6e5236, roughness: 0.96, metalness: 0 }));
    const ribbon = this.material(new THREE.MeshStandardMaterial({ name: 'gift-ribbon', color: 0x7d1424, roughness: 0.42, metalness: 0.05 }));
    const tissue = this.material(new THREE.MeshStandardMaterial({ name: 'gift-tissue', color: 0xe9e1d2, roughness: 0.88, metalness: 0, side: THREE.DoubleSide }));
    const paper = this.material(new THREE.MeshStandardMaterial({ name: 'gift-note', color: 0xf0e8d6, roughness: 0.95, metalness: 0 }));

    // Open box: floor and four walls, so the inside reads once the lid is off.
    const wall = 0.006, w = BOX.width, d = BOX.depth, h = BOX.height - LID_HEIGHT * 0.6;
    const part = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.group): THREE.Mesh => {
      this.geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
    };
    part(new THREE.BoxGeometry(w, wall, d), kraft, 0, wall / 2, 0);
    for (const side of [-1, 1]) {
      const outer = part(new THREE.BoxGeometry(wall, h, d), kraft, side * (w - wall) / 2, h / 2, 0);
      outer.name = 'gift-wall';
      part(new THREE.BoxGeometry(w, h, wall), kraft, 0, h / 2, side * (d - wall) / 2);
    }
    part(new THREE.BoxGeometry(w - wall * 2.2, 0.002, d - wall * 2.2), inside, 0, wall + 0.001, 0);
    // Lid with its ribbon cross and bow.
    this.lid.name = 'gift-lid';
    this.lid.position.set(0, BOX.height - LID_HEIGHT / 2, 0);
    part(new THREE.BoxGeometry(w + 0.012, 0.006, d + 0.012), kraft, 0, LID_HEIGHT / 2 - 0.003, 0, this.lid);
    for (const side of [-1, 1]) {
      part(new THREE.BoxGeometry(0.006, LID_HEIGHT, d + 0.012), kraft, side * (w + 0.006) / 2, 0, 0, this.lid);
      part(new THREE.BoxGeometry(w + 0.012, LID_HEIGHT, 0.006), kraft, 0, 0, side * (d + 0.006) / 2, this.lid);
    }
    part(new THREE.BoxGeometry(0.03, 0.002, d + 0.016), ribbon, 0, LID_HEIGHT / 2 + 0.001, 0, this.lid);
    part(new THREE.BoxGeometry(w + 0.016, 0.0022, 0.03), ribbon, 0, LID_HEIGHT / 2 + 0.0012, 0, this.lid);
    for (const side of [-1, 1]) {
      const loop = part(new THREE.TorusGeometry(0.028, 0.007, 8, 20), ribbon, side * 0.026, LID_HEIGHT / 2 + 0.012, 0, this.lid);
      loop.scale.set(1, 0.55, 0.42); loop.rotation.set(0, 0, side * 0.35);
      const tail = part(new THREE.BoxGeometry(0.05, 0.0015, 0.022), ribbon, side * 0.04, LID_HEIGHT / 2 + 0.003, side * 0.03, this.lid);
      tail.rotation.y = side * 0.6;
    }
    part(new THREE.SphereGeometry(0.011, 12, 8), ribbon, 0, LID_HEIGHT / 2 + 0.008, 0, this.lid);
    this.group.add(this.lid);

    // Inside: crumpled tissue, the compass in a hollow, the folded note.
    this.contents.name = 'gift-contents';
    const crumple = new THREE.IcosahedronGeometry(0.06, 1);
    const positions = crumple.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      const k = 0.78 + ((i * 7919) % 13) / 40;
      positions.setXYZ(i, positions.getX(i) * k * 1.9, positions.getY(i) * k * 0.45, positions.getZ(i) * k * 1.5);
    }
    crumple.computeVertexNormals();
    for (const [x, z] of [[-0.075, -0.05], [0.08, 0.05], [0.07, -0.06], [-0.08, 0.06]] as const)
      part(crumple.clone(), tissue, x, wall + 0.03, z, this.contents);
    crumple.dispose();
    this.compass = createCompassModel();
    this.compass.position.set(-0.02, wall + 0.035, 0.005);
    this.compass.rotation.set(-0.12, 0.4, 0);
    this.contents.add(this.compass);
    const note = part(new THREE.BoxGeometry(0.11, 0.003, 0.075), paper, 0.07, wall + 0.06, -0.02, this.contents);
    note.rotation.set(-0.35, -0.3, 0.08);
    this.group.add(this.contents);

    // A small pale dot on the bow, like the mailbox marker.
    const markerGeometry = new THREE.SphereGeometry(0.01, 8, 6);
    const markerMaterial = this.material(new THREE.MeshBasicMaterial({ color: 0xc5d2b8 }));
    this.geometries.push(markerGeometry);
    this.marker = new THREE.Mesh(markerGeometry, markerMaterial);
    this.marker.position.set(0, BOX.height + 0.04, 0);
    this.group.add(this.marker);
    this.group.traverse(object => { const mesh = object as THREE.Mesh; if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; } });
    this.applyState(opened ? 1 : 0);
  }

  get isOpened(): boolean { return this.opened; }
  get isOpening(): boolean { return this.opening >= 0; }

  /** Eye position and view direction. */
  isTargeted(eye: THREE.Vector3, direction: THREE.Vector3): boolean {
    if (this.opened || this.opening >= 0 || !this.group.visible) return false;
    this.ray.set(eye, direction); this.ray.near = 0; this.ray.far = 2.1;
    return this.ray.intersectObject(this.group, true).length > 0;
  }

  updatePrompt(eye: THREE.Vector3, direction: THREE.Vector3, allowed: boolean): boolean {
    const show = allowed && this.isTargeted(eye, direction);
    if (show) { this.ui.setInteraction('Ouvrir le cadeau'); this.prompted = true; }
    else if (this.prompted) { this.ui.setInteraction(null); this.prompted = false; }
    return show;
  }

  /** Starts the lid; `onOpened` once the contents are visible. */
  open(): boolean {
    if (this.opened || this.opening >= 0) return false;
    this.opening = 0;
    if (this.prompted) { this.ui.setInteraction(null); this.prompted = false; }
    return true;
  }

  /** Returns true on the frame the opening finishes. */
  update(delta: number): boolean {
    if (this.opening < 0) return false;
    this.opening = Math.min(OPEN_SECONDS, this.opening + Math.max(0, delta));
    this.applyState(this.opening / OPEN_SECONDS);
    if (this.opening < OPEN_SECONDS) return false;
    this.opening = -1; this.opened = true;
    // The compass goes to the inventory; the note is read.
    this.compass.visible = false;
    return true;
  }

  private applyState(t: number): void {
    const lift = THREE.MathUtils.smoothstep(t, 0, 0.45), aside = THREE.MathUtils.smoothstep(t, 0.3, 1);
    this.lid.position.set(0.34 * aside, BOX.height - LID_HEIGHT / 2 + 0.16 * lift * (1 - aside) - (BOX.height - LID_HEIGHT * 1.1) * aside, -0.05 * aside);
    this.lid.rotation.set(0.25 * lift * (1 - aside), 0.5 * aside, -0.12 * aside);
    this.contents.visible = t > 0.05;
    this.marker.visible = t === 0;
    if (this.opened || t >= 1) this.compass.visible = false;
  }

  private material<T extends THREE.Material>(material: T): T { this.materials.push(material); return material; }

  dispose(): void {
    if (this.prompted) this.ui.setInteraction(null);
    this.group.removeFromParent();
    disposeObjectTree(this.compass);
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
      material.dispose();
    }
  }
}
