import * as THREE from 'three';
import { faceProjection, LOCAL_TEXTURE_ORIGIN, type TextureOrigin } from './ArchitecturalUV';
import { SLAB_INDICES } from '../world/WalkableTopology';
import type { SpatialPrism } from '../world/SpatialTypes';

/** The render and Rapier representations consume exactly the same eight corners. */
export const createSpatialPrismGeometry = (prism: SpatialPrism, scale = 1, origin: TextureOrigin = LOCAL_TEXTURE_ORIGIN): THREE.BufferGeometry => {
  return createSpatialPrismBatch([prism], scale, origin);
};

export const createSpatialPrismBatch = (prisms: readonly SpatialPrism[], scale = 1, origin: TextureOrigin = LOCAL_TEXTURE_ORIGIN): THREE.BufferGeometry => {
  const positions: number[] = [], uv: number[] = [], colors: number[] = [];
  for (const prism of prisms) {
    const v = prism.vertices;
    for (let i = 0; i < SLAB_INDICES.length; i += 3) {
      const indices = SLAB_INDICES.slice(i, i + 3);
      const faceStart = Math.floor(i / 6) * 6;
      const projection = i < 12 ? 'y' : faceProjection(v, SLAB_INDICES.slice(faceStart, faceStart + 3));
      for (const n of indices) {
        const x = v[n * 3]!, y = v[n * 3 + 1]!, z = v[n * 3 + 2]!;
        positions.push(x, y, z); colors.push(prism.tint ?? 1, prism.tint ?? 1, prism.tint ?? 1);
        const wx = x + origin.x, wy = y + origin.y, wz = z + origin.z;
        uv.push((projection === 'x' ? wz : wx) * scale / (prism.material === 'ceiling' ? 2.4 : 2.05),
          (projection === 'y' ? wz : wy) * scale / (prism.material === 'ceiling' ? 2.4 : 2.45));
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals(); return geometry;
};
