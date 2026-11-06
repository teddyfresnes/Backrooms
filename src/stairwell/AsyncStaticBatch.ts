import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CooperativeWork } from '../core/CooperativeWork';

/** Loading-only batching in small tasks. Large authored meshes already draw in
 * one call and stay in place, avoiding a huge clone/transform/merge allocation. */
export async function batchStaticMeshesAsync(root: THREE.Object3D, cellSize?: number, signal?: AbortSignal): Promise<void> {
  const work = new CooperativeWork(signal), maxVertices = 16384;
  root.updateMatrixWorld(true); const inverse = root.matrixWorld.clone().invert();
  const buckets = new Map<string, THREE.Mesh[]>(), meshes: THREE.Mesh[] = [];
  root.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object); });
  for (const object of meshes) {
    await work.checkpoint();
    if (object instanceof THREE.SkinnedMesh || object instanceof THREE.InstancedMesh || Array.isArray(object.material)
      || object.material.transparent || object.userData.noBatch || object.geometry.getAttribute('position').count > maxVertices) continue;
    let excluded = false;
    for (let parent: THREE.Object3D | null = object; parent && parent !== root; parent = parent.parent) {
      if (!parent.visible || parent.userData.noBatch || parent instanceof THREE.LOD) { excluded = true; break; }
    }
    if (excluded) continue;
    const layout = Object.keys(object.geometry.attributes).sort().map(name => {
      const a = object.geometry.getAttribute(name), array = a instanceof THREE.InterleavedBufferAttribute ? a.data.array : a.array;
      return `${name}/${a.itemSize}/${array.constructor.name}/${a.normalized}`;
    }).join(',');
    let cell = '';
    if (cellSize) {
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      const center = object.geometry.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(object.matrixWorld);
      cell = `${Math.floor(center.x / cellSize)},${Math.floor(center.y / cellSize)},${Math.floor(center.z / cellSize)}`;
    }
    const key = `${object.material.uuid}:${object.castShadow}:${object.receiveShadow}:${layout}:${!!object.geometry.index}:${cell}`;
    const bucket = buckets.get(key) ?? []; bucket.push(object); buckets.set(key, bucket);
  }
  const merge = async (parts: THREE.Mesh[]): Promise<void> => {
    if (parts.length < 2) return;
    const geometries: THREE.BufferGeometry[] = [];
    try {
      for (const mesh of parts) {
        await work.checkpoint();
        const transform = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld), geometry = mesh.geometry.clone();
        geometries.push(geometry);
        if (transform.determinant() < 0) {
          if (!geometry.index) geometry.setIndex(Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i));
          const index = geometry.index!;
          for (let i = 0; i < index.count; i += 3) { const a = index.getX(i); index.setX(i, index.getX(i + 2)); index.setX(i + 2, a); }
        }
        geometry.applyMatrix4(transform);
      }
      await work.checkpoint();
      const merged = mergeGeometries(geometries, false); if (!merged) return;
      merged.computeBoundingBox(); merged.computeBoundingSphere();
      const material = parts[0]!.material as THREE.Material;
      const batch = new THREE.Mesh(merged, material); batch.name = `static-batch-${material.name || material.uuid.slice(0, 8)}`;
      batch.castShadow = parts[0]!.castShadow; batch.receiveShadow = parts[0]!.receiveShadow;
      for (const mesh of parts) { mesh.removeFromParent(); mesh.geometry.dispose(); }
      root.add(batch);
    } finally { geometries.forEach(geometry => geometry.dispose()); }
  };
  for (const bucket of buckets.values()) {
    let parts: THREE.Mesh[] = [], vertices = 0;
    for (const mesh of bucket) {
      const count = mesh.geometry.getAttribute('position').count;
      if (vertices + count > maxVertices) { await merge(parts); parts = []; vertices = 0; }
      parts.push(mesh); vertices += count;
    }
    await merge(parts);
  }
}
