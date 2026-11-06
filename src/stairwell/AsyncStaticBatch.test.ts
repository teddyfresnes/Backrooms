import { expect, it } from 'vitest';
import * as THREE from 'three';
import { batchStaticMeshesAsync } from './AsyncStaticBatch';

it('keeps the event loop responsive while batching, preserves mirrored faces and excludes moving objects', async () => {
  const root = new THREE.Group(), geometry = new THREE.BoxGeometry(.1, .1, .1), material = new THREE.MeshBasicMaterial();
  for (let i = 0; i < 2000; i++) { const mesh = new THREE.Mesh(geometry, material); mesh.position.x = i * .1; if (i % 2) mesh.scale.x = -1; root.add(mesh); }
  const moving = new THREE.Mesh(geometry, material); moving.userData.noBatch = true; root.add(moving);
  let frames = 0; const timer = setInterval(() => frames++, 0);
  try { await batchStaticMeshesAsync(root); } finally { clearInterval(timer); }
  expect(frames).toBeGreaterThan(1); expect(root.children).toContain(moving); expect(root.children.length).toBeLessThan(12);
  const bounds = new THREE.Box3().setFromObject(root); expect(bounds.min.x).toBeCloseTo(-.05); expect(bounds.max.x).toBeCloseTo(199.95);
  root.traverse(object => { if (object instanceof THREE.Mesh) { expect(object.geometry.index!.count % 3).toBe(0); object.geometry.dispose(); } }); material.dispose();
});

it('cancels before mutating the original scene', async () => {
  const root = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); root.add(mesh);
  const abort = new AbortController(); abort.abort();
  await expect(batchStaticMeshesAsync(root, undefined, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(root.children).toEqual([mesh]); mesh.geometry.dispose(); mesh.material.dispose();
});
