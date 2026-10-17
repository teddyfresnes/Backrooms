import * as THREE from 'three';

/** Dispose an owned avatar, once per shared resource across all its views. */
export function disposeAvatarResources(roots: readonly THREE.Object3D[], texturesOwned = true): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  for (const root of roots) {
    root.removeFromParent();
    root.traverse(object => {
      const mesh = object as THREE.SkinnedMesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.isSkinnedMesh) skeletons.add(mesh.skeleton);
      for (const material of Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
    });
  }
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  skeletons.forEach(skeleton => skeleton.dispose());
  if (texturesOwned) textures.forEach(texture => texture.dispose());
}
