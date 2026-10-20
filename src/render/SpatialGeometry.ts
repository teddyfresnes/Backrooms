import * as THREE from 'three';
import { SLAB_INDICES } from '../world/WalkableTopology';
import type { SpatialPrism } from '../world/SpatialTypes';

/** The render and Rapier representations consume exactly the same eight corners. */
export const createSpatialPrismGeometry = (prism: SpatialPrism, scale = 1): THREE.BufferGeometry => {
  const positions: number[] = [], uv: number[] = [], colors: number[] = [], v = prism.vertices;
  for (let i = 0; i < SLAB_INDICES.length; i += 3) {
    const indices = SLAB_INDICES.slice(i, i + 3), xs = indices.map(n => v[n * 3]!), ys = indices.map(n => v[n * 3 + 1]!), zs = indices.map(n => v[n * 3 + 2]!);
    const horizontal = Math.max(...ys) - Math.min(...ys) < .0001;
    const alongX = Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs);
    for (const n of indices) {
      const x = v[n * 3]!, y = v[n * 3 + 1]!, z = v[n * 3 + 2]!;
      positions.push(x, y, z); colors.push(1, 1, 1);
      uv.push((horizontal ? x : alongX ? x : z) * scale / 2.05, (horizontal ? z : y) * scale / 2.45);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals(); return geometry;
};
