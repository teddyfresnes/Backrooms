import * as THREE from 'three';
import { slabVertices, SLAB_INDICES, type WalkableSurface } from '../world/WalkableTopology';

/** The render triangles use precisely the same prism vertices as Rapier. */
export const createWalkableGeometry = (surface: WalkableSurface, face: 'top' | 'underside' | 'sides' = 'top', scale = 1, quarterTurn = false): THREE.BufferGeometry => {
  return createWalkableBatch([surface], face, scale, quarterTurn);
};

/** Build a material batch directly, avoiding one GPU geometry per floor fragment. */
export const createWalkableBatch = (surfaces: readonly WalkableSurface[], face: 'top' | 'underside' | 'sides' = 'top', scale = 1, quarterTurn = false): THREE.BufferGeometry => {
  const indices = face === 'top' ? SLAB_INDICES.slice(0, 6) : face === 'underside' ? SLAB_INDICES.slice(6, 12) : SLAB_INDICES.slice(12);
  const positions: number[] = [], uv: number[] = [], colors: number[] = [];
  for (const surface of surfaces) {
    const vertices = slabVertices(surface);
    for (let t = 0; t < indices.length; t += 3) {
      const corners = indices.slice(t, t + 3), xs = corners.map(i => vertices[i * 3]!), zs = corners.map(i => vertices[i * 3 + 2]!);
      const alongX = Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs);
      for (const index of indices.slice(t, t + 3)) {
        const x = vertices[index * 3]!, y = vertices[index * 3 + 1]!, z = vertices[index * 3 + 2]!;
        positions.push(x, y, z); colors.push(1, 1, 1);
        uv.push((face === 'sides' ? alongX ? x : z : quarterTurn ? z : x) * .28 * scale,
          (face === 'sides' ? y : quarterTurn ? x : z) * .28 * scale);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals(); return geometry;
};
