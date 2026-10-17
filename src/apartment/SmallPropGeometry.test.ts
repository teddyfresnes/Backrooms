import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { simplifySmallPropGeometry } from './SmallPropGeometry';

describe('sub-millimetre small-prop tessellation', () => {
  it('reduces dense static props without moving the silhouette more than 1.4 mm', () => {
    const original = new THREE.TorusGeometry(.02, .004, 64, 256);
    const material = new THREE.MeshStandardMaterial();
    const mesh = new THREE.Mesh(original, material);
    mesh.scale.set(1.5, .5, 2); mesh.rotation.set(.3, .5, .1); mesh.position.set(-6, 10, -2);
    mesh.updateMatrixWorld(true);
    const copy = original.getAttribute('position').array.slice();
    const simplified = simplifySmallPropGeometry(mesh)!;
    expect(simplified).not.toBeNull();
    expect(simplified.index!.count).toBeLessThan(original.index!.count * .8);
    expect(original.getAttribute('position').array).toEqual(copy);
    expect(mesh.geometry).toBe(original); expect(mesh.material).toBe(material);
    const source = original.getAttribute('position'), target = simplified.getAttribute('position');
    const point = new THREE.Vector3(), candidate = new THREE.Vector3();
    for (let i = 0; i < source.count; i += 79) {
      point.fromBufferAttribute(source, i).applyMatrix4(mesh.matrixWorld);
      let closest = Infinity;
      for (let j = 0; j < target.count; j++) {
        candidate.fromBufferAttribute(target, j).applyMatrix4(mesh.matrixWorld);
        closest = Math.min(closest, point.distanceToSquared(candidate));
      }
      expect(Math.sqrt(closest)).toBeLessThan(.0014);
    }
    const uv = simplified.getAttribute('uv');
    expect(Math.min(...uv.array)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...uv.array)).toBeLessThanOrEqual(1);
    expect(Math.max(...uv.array)).toBeGreaterThan(.99);
    simplified.dispose(); original.dispose(); material.dispose();
  });

  it('keeps architecture, ordinary props, skinned meshes and multiple-material geometry untouched', () => {
    const geometry = new THREE.TorusGeometry(1, .1, 64, 256), material = new THREE.MeshStandardMaterial();
    expect(simplifySmallPropGeometry(new THREE.Mesh(geometry, material))).toBeNull();
    const small = new THREE.BoxGeometry(.1, .1, .1);
    expect(simplifySmallPropGeometry(new THREE.Mesh(small, material))).toBeNull();
    const tiny = new THREE.TorusGeometry(.02, .004, 64, 256);
    expect(simplifySmallPropGeometry(new THREE.SkinnedMesh(tiny, material))).toBeNull();
    expect(simplifySmallPropGeometry(new THREE.Mesh(tiny, [material, material]))).toBeNull();
    for (const g of [geometry, small, tiny]) g.dispose(); material.dispose();
  });
});
