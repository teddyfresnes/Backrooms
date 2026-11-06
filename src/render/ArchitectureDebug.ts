import * as THREE from 'three';
import type { WorldPlan } from '../world/types';
export type ArchitectureDebugMode = 'off' | 'uv' | 'volumes';

/** Opt-in console diagnostics; owns all temporary GPU objects and restores the
 * original materials before the normal view disposes them. */
export class ArchitectureDebug {
  private readonly original = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private overlay?: THREE.Group;
  private grid?: THREE.DataTexture;
  private uvMaterial?: THREE.MeshBasicMaterial;
  constructor(private readonly root: THREE.Group, private readonly plan: WorldPlan) {}
  setMode(mode: ArchitectureDebugMode): void {
    this.dispose();
    if (mode === 'uv') {
      const size = 64, pixels = new Uint8Array(size * size * 4);
      for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
        const edge = x % 16 < 1 || z % 16 < 1, checker = ((x >> 4) + (z >> 4)) % 2;
        const at = (z * size + x) * 4;
        pixels[at] = edge ? 240 : checker ? 70 : 160;
        pixels[at + 1] = edge ? 100 : checker ? 140 : 190;
        pixels[at + 2] = edge ? 40 : checker ? 190 : 220;
        pixels[at + 3] = 255;
      }
      this.grid = new THREE.DataTexture(pixels, size, size); this.grid.wrapS = this.grid.wrapT = THREE.RepeatWrapping;
      this.grid.magFilter = THREE.NearestFilter; this.grid.colorSpace = THREE.SRGBColorSpace; this.grid.needsUpdate = true;
      this.uvMaterial = new THREE.MeshBasicMaterial({ map: this.grid });
      this.root.traverse(o => { if (o instanceof THREE.Mesh && /^(regional-|merged-|walkable-)/.test(o.name)) {
        this.original.set(o, o.material); o.material = this.uvMaterial!;
      } });
    } else if (mode === 'volumes') {
      this.overlay = new THREE.Group(); this.overlay.name = 'architecture-diagnostic-volumes';
      const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ wireframe: true, depthTest: false }), this.plan.topology?.volumes.length ?? 0);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion();
      for (const [i, v] of (this.plan.topology?.volumes ?? []).entries()) {
        m.compose(new THREE.Vector3((v.bounds.minX + v.bounds.maxX) / 2, (v.bottom + v.top) / 2, (v.bounds.minZ + v.bounds.maxZ) / 2), q,
          new THREE.Vector3(v.bounds.maxX - v.bounds.minX, v.top - v.bottom, v.bounds.maxZ - v.bounds.minZ));
        boxes.setMatrixAt(i, m); boxes.setColorAt(i, new THREE.Color(v.purpose === 'clearance' ? 0x55dd88 : 0xffaa44));
      }
      boxes.renderOrder = 100; this.overlay.add(boxes);
      const collisionMaterial = new THREE.MeshBasicMaterial({ color: 0xff4488, wireframe: true, depthTest: false });
      for (const collider of this.plan.colliders) {
        const geometry = collider.vertices ? new THREE.BufferGeometry() : new THREE.BoxGeometry(collider.halfExtents.x * 2, collider.halfExtents.y * 2, collider.halfExtents.z * 2);
        if (collider.vertices) { geometry.setAttribute('position', new THREE.Float32BufferAttribute(collider.vertices, 3));
          geometry.setIndex(collider.indices ?? [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0]); }
        const mesh = new THREE.Mesh(geometry, collisionMaterial); mesh.position.set(collider.center.x, collider.center.y, collider.center.z);
        if (collider.rotation) mesh.quaternion.set(collider.rotation.x, collider.rotation.y, collider.rotation.z, collider.rotation.w);
        mesh.renderOrder = 101; this.overlay.add(mesh);
      }
      this.root.add(this.overlay);
    }
  }
  dispose(): void {
    for (const [mesh, material] of this.original) mesh.material = material;
    this.original.clear(); this.uvMaterial?.dispose(); this.grid?.dispose(); this.uvMaterial = undefined; this.grid = undefined;
    if (this.overlay) {
      const materials = new Set<THREE.Material>();
      this.overlay.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); for (const material of Array.isArray(o.material) ? o.material : [o.material]) materials.add(material); } });
      materials.forEach(m => m.dispose()); this.overlay.removeFromParent(); this.overlay = undefined;
    }
  }
}
