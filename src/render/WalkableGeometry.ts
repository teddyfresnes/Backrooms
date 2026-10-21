import { surfaceExposure } from './SurfaceExposure';
import * as THREE from 'three';
import { horizontalUv, LOCAL_TEXTURE_ORIGIN, type TextureOrigin } from './ArchitecturalUV';
import { slabVertices, SLAB_INDICES, type WalkableSurface } from '../world/WalkableTopology';

/** The render triangles use precisely the same prism vertices as Rapier. */
export const createWalkableGeometry = (surface: WalkableSurface, face: 'top' | 'underside' | 'sides' = 'top', scale = 1, quarterTurn = false, origin: TextureOrigin = LOCAL_TEXTURE_ORIGIN, exposedOnly = false): THREE.BufferGeometry => {
  return createWalkableBatch([surface], face, scale, quarterTurn, origin, exposedOnly);
};

/** Build a material batch directly, avoiding one GPU geometry per floor fragment. */
export const createWalkableBatch = (surfaces: readonly WalkableSurface[], face: 'top' | 'underside' | 'sides' = 'top', scale = 1, quarterTurn = false, origin: TextureOrigin = LOCAL_TEXTURE_ORIGIN, exposedOnly = false): THREE.BufferGeometry => {
  const indices = face === 'top' ? SLAB_INDICES.slice(0, 6) : face === 'underside' ? SLAB_INDICES.slice(6, 12) : SLAB_INDICES.slice(12);
  const exposure = face === 'sides' && exposedOnly ? surfaceExposure(surfaces) : undefined;
  const positions: number[] = [], uv: number[] = [], colors: number[] = [];
  for (const surface of surfaces) {
    const raw = slabVertices(surface);
    for (let t = 0; t < indices.length; t += 3) {
      const vertices = exposure ? exposure(surface, Math.floor(t / 6), raw) : raw;
      if (!vertices) continue;
      const corners = indices.slice(t, t + 3), xs = corners.map(i => vertices[i * 3]!), zs = corners.map(i => vertices[i * 3 + 2]!);
      const alongX = Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs);
      for (const index of indices.slice(t, t + 3)) {
        const x = vertices[index * 3]!, y = vertices[index * 3 + 1]!, z = vertices[index * 3 + 2]!;
        positions.push(x, y, z); colors.push(1, 1, 1);
        const wx = x + origin.x, wy = y + origin.y, wz = z + origin.z;
        uv.push(...(face === 'sides' ? [(alongX ? wx : wz) / 2.05 * scale, wy / 2.45 * scale]
          : horizontalUv(wx, wz, scale, face === 'underside' || surface.access === 'sealed', quarterTurn)));
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals(); return geometry;
};
