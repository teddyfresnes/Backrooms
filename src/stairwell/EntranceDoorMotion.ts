import * as THREE from 'three';

/** The original imported model is many CAD pieces. Group just the right leaf
 * around its outer jamb, keeping the frame and the other leaf stationary. */
export class EntranceDoorMotion {
  readonly pivot = new THREE.Group();
  readonly closedBounds: THREE.Box3;
  readonly movedPieces: number;
  private readonly originals: { mesh: THREE.Mesh; parent: THREE.Object3D }[] = [];

  constructor(private readonly door: THREE.Object3D) {
    door.updateWorldMatrix(true, true);
    const bounds = this.closedBounds = new THREE.Box3().setFromObject(door);
    const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
    this.pivot.name = 'entrance-right-leaf-hinge';
    this.pivot.position.copy(door.worldToLocal(new THREE.Vector3(bounds.max.x - .025, bounds.min.y, center.z)));
    door.add(this.pivot); door.updateMatrixWorld(true);
    const parts: THREE.Mesh[] = [];
    door.traverse(object => { if ((object as THREE.Mesh).isMesh) parts.push(object as THREE.Mesh); });
    for (const mesh of parts) {
      const box = new THREE.Box3().setFromObject(mesh), middle = box.getCenter(new THREE.Vector3()), part = box.getSize(new THREE.Vector3());
      if (middle.x <= center.x + .025 || middle.x >= bounds.max.x - .035
        || part.x > size.x * .65 || box.min.y < bounds.min.y + .045 || box.max.y > bounds.max.y - .045) continue;
      this.originals.push({ mesh, parent: mesh.parent! });
      this.pivot.attach(mesh);
    }
    this.movedPieces = this.originals.length;
    if (!this.movedPieces) throw new Error('Le vantail de la porte d’entrée est absent.');
    door.updateMatrixWorld(true);
  }

  setOpen(progress: number): void {
    this.pivot.rotation.y = Math.max(0, Math.min(1, progress)) * Math.PI * .48;
    this.door.updateWorldMatrix(true, true);
  }

  attach(object: THREE.Object3D): void { this.pivot.attach(object); }

  dispose(): void {
    this.setOpen(0);
    for (const { mesh, parent } of this.originals) parent.attach(mesh);
    this.pivot.removeFromParent();
  }
}
