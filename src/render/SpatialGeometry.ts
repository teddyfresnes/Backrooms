import * as THREE from 'three';
import { faceProjection, LOCAL_TEXTURE_ORIGIN, type TextureOrigin } from './ArchitecturalUV';
import { SLAB_INDICES } from '../world/WalkableTopology';
import type { SpatialPrism } from '../world/SpatialTypes';
import type { PrismExposure } from './PrismExposure';
import { faceTriangles } from './FaceExposure';

/** The render and Rapier representations consume exactly the same eight corners. */
export const createSpatialPrismGeometry = (prism: SpatialPrism, scale = 1, origin: TextureOrigin = LOCAL_TEXTURE_ORIGIN): THREE.BufferGeometry => {
  return createSpatialPrismBatch([prism], scale, origin);
};

export const createSpatialPrismBatch = (prisms: readonly SpatialPrism[], scale = 1, origin: TextureOrigin = LOCAL_TEXTURE_ORIGIN, exposure?: PrismExposure): THREE.BufferGeometry => {
  const positions: number[] = [], uv: number[] = [], colors: number[] = [];
  for (const prism of prisms) {
    const v = prism.vertices;
    for (let face = 0; face < 6; face++) {
      if (prism.openFaces?.includes(face)) continue;
      const points = faceTriangles(v, face, exposure?.(prism, face));
      const projection = face < 2 ? 'y' : faceProjection(v, SLAB_INDICES.slice(face * 6, face * 6 + 3));
      for (let i = 0; i < points.length; i += 3) {
          const x = points[i]!, y = points[i + 1]!, z = points[i + 2]!;
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
