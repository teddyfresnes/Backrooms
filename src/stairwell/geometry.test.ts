import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { batchStaticMeshes, disposeObject3D, makeBox } from './geometry';

describe('static geometry batching', () => {
  it('keeps distant apartment cells separate so batching does not defeat frustum culling', () => {
    const material = new THREE.MeshBasicMaterial(), root = new THREE.Group();
    for (const x of [0, 1, 14, 15]) root.add(makeBox(String(x), [.5, .5, .5], [x, 0, 0], material));
    batchStaticMeshes(root, 3.5);
    expect(root.children).toHaveLength(2);
    root.updateMatrixWorld(true);
    const boxes = root.children.map(child => new THREE.Box3().setFromObject(child));
    expect(boxes.every(box => box.max.x - box.min.x < 2)).toBe(true);
    disposeObject3D(root); material.dispose();
  });

  it('preserves front faces and world-space hits for mirrors under a transformed root', () => {
    const material = new THREE.MeshBasicMaterial();
    const root = new THREE.Group(); root.position.set(7, 3, -4); root.rotation.y = .6;
    for (const x of [-1, 1]) {
      const mesh = makeBox(`test-${x}`, [.8, 1, .5], [x, 0, 0], material);
      mesh.scale.x = x; root.add(mesh);
    }
    root.updateMatrixWorld(true);
    const rays = [-1, 1].map(x => new THREE.Raycaster(root.localToWorld(new THREE.Vector3(x, 0, 2)),
      new THREE.Vector3(0, 0, -1).transformDirection(root.matrixWorld), 0, 5));
    const before = rays.map(ray => ray.intersectObject(root, true)[0]!.point.clone());
    batchStaticMeshes(root); root.updateMatrixWorld(true);
    expect(root.children).toHaveLength(1);
    rays.forEach((ray, i) => expect(ray.intersectObject(root, true)[0]!.point.distanceTo(before[i]!)).toBeLessThan(.00001));
    disposeObject3D(root); material.dispose();
  });

  it('leaves hidden and moving branches attached and preserves per-mesh shadow flags', () => {
    const root = new THREE.Group(), moving = new THREE.Group(), hidden = new THREE.Group();
    const material = new THREE.MeshBasicMaterial(); moving.userData.noBatch = true; hidden.visible = false;
    const movingMesh = makeBox('moving', [1, 1, 1], [0, 0, 0], material);
    const hiddenMesh = movingMesh.clone(); moving.add(movingMesh); hidden.add(hiddenMesh); root.add(moving, hidden);
    for (let i = 0; i < 4; i++) root.add(makeBox(`static-${i}`, [1, 1, 1], [i + 3, 0, 0], material, i > 1, i > 1));
    batchStaticMeshes(root);
    expect(movingMesh.parent).toBe(moving); expect(hiddenMesh.parent).toBe(hidden);
    const batches = root.children.filter(o => o instanceof THREE.Mesh) as THREE.Mesh[];
    expect(batches).toHaveLength(2);
    expect(batches.map(m => m.castShadow).sort()).toEqual([false, true]);
    expect(batches.map(m => m.receiveShadow).sort()).toEqual([false, true]);
    disposeObject3D(root); material.dispose();
  });
});
