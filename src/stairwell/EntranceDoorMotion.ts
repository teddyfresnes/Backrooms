import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** The original imported model is many CAD pieces. Group just the right leaf
 * around its outer jamb, keeping the frame and the other leaf stationary. */
export class EntranceDoorMotion {
  readonly pivot = new THREE.Group();
  readonly closedBounds: THREE.Box3;
  readonly movedPieces: number;
  readonly grip = new THREE.Object3D();
  readonly closingGrip = new THREE.Object3D();
  private readonly originals: { mesh: THREE.Mesh; parent: THREE.Object3D }[] = [];
  private readonly renderBatches: THREE.Mesh[] = [];
  private readonly batchedParts: THREE.Mesh[] = [];

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
    const handle = door.getObjectByName('Body131_Marble_(White)_0');
    const handleBox = handle ? new THREE.Box3().setFromObject(handle) : bounds.clone();
    const contact = handleBox.getCenter(new THREE.Vector3());
    if (!handle) { contact.x = center.x + size.x * .25; contact.y = bounds.min.y + size.y * .5; }
    contact.z = handleBox.min.z - .015;
    this.grip.name = 'entrance-door-hand-contact';
    this.grip.position.copy(this.pivot.worldToLocal(contact)); this.pivot.add(this.grip);
    const leafBounds = new THREE.Box3();
    for (const { mesh } of this.originals) leafBounds.union(new THREE.Box3().setFromObject(mesh));
    const closingContact = new THREE.Vector3(leafBounds.min.x + .10, bounds.min.y + 1.08, leafBounds.max.z + .018);
    this.closingGrip.name = 'entrance-door-closing-contact';
    this.closingGrip.position.copy(this.pivot.worldToLocal(closingContact)); this.pivot.add(this.closingGrip);
    this.batchParts(parts);
  }

  setOpen(progress: number): void {
    this.pivot.rotation.y = Math.max(0, Math.min(1, progress)) * Math.PI * .48;
    this.door.updateWorldMatrix(true, true);
  }

  attach(object: THREE.Object3D): void { this.pivot.attach(object); }

  /** CAD pieces retain their original hierarchy/resources for restoration;
   * only the visible presentation is merged, separately for frame and leaf. */
  private batchParts(parts: THREE.Mesh[]): void {
    const moving = new Set(this.originals.map(part => part.mesh));
    const buckets = new Map<string, THREE.Mesh[]>();
    for (const mesh of parts) {
      if (!mesh.visible || Array.isArray(mesh.material) || mesh.material.transparent) continue;
      const layout = Object.keys(mesh.geometry.attributes).sort().map(name => {
        const attribute = mesh.geometry.getAttribute(name);
        return `${name}:${attribute.itemSize}:${attribute.normalized}`;
      }).join(',');
      const key = `${moving.has(mesh)}:${mesh.material.uuid}:${!!mesh.geometry.index}:${layout}`;
      const bucket = buckets.get(key) ?? []; bucket.push(mesh); buckets.set(key, bucket);
    }
    for (const meshes of buckets.values()) {
      if (meshes.length < 2) continue;
      const parent = moving.has(meshes[0]!) ? this.pivot : this.door;
      const inverse = parent.matrixWorld.clone().invert();
      const geometries = meshes.map(mesh => {
        const transform = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
        const geometry = mesh.geometry.clone();
        if (!geometry.index) geometry.setIndex(Array.from({ length: geometry.getAttribute('position').count }, (_, index) => index));
        if (transform.determinant() < 0) {
          const index = geometry.index!;
          for (let i = 0; i < index.count; i += 3) {
            const a = index.getX(i); index.setX(i, index.getX(i + 2)); index.setX(i + 2, a);
          }
        }
        return geometry.applyMatrix4(transform);
      });
      const merged = mergeGeometries(geometries, false); geometries.forEach(geometry => geometry.dispose());
      if (!merged) continue;
      merged.computeBoundingBox(); merged.computeBoundingSphere();
      const batch = new THREE.Mesh(merged, meshes[0]!.material);
      batch.name = moving.has(meshes[0]!) ? 'entrance-leaf-render-batch' : 'entrance-frame-render-batch';
      batch.userData.noBatch = true; parent.add(batch); this.renderBatches.push(batch);
      for (const mesh of meshes) { mesh.visible = false; this.batchedParts.push(mesh); }
    }
  }

  dispose(): void {
    this.setOpen(0);
    for (const batch of this.renderBatches) { batch.geometry.dispose(); batch.removeFromParent(); }
    for (const mesh of this.batchedParts) mesh.visible = true;
    for (const { mesh, parent } of this.originals) parent.attach(mesh);
    this.pivot.removeFromParent();
  }
}
