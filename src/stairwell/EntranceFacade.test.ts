import { expect, it } from 'vitest';
import * as THREE from 'three';
import { createEntranceFacade } from './EntranceFacade';
import { STAIRWELL_BOUNDS, STAIRWELL_ENTRANCE_WIDTH, STAIRWELL_FLOOR_HEIGHT } from './layout';

it('fills both visible jamb gaps with masonry while preserving the entrance and upper windows', () => {
  const material = new THREE.MeshBasicMaterial(), facade = createEntranceFacade(material); facade.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  for (const side of [-1, 1]) for (const y of [.6, 1.6, 2.2]) {
    const x = side * (STAIRWELL_ENTRANCE_WIDTH / 2 + Math.abs(STAIRWELL_BOUNDS.maxX)) / 2;
    ray.set(new THREE.Vector3(x, y, STAIRWELL_BOUNDS.minZ - 2), new THREE.Vector3(0, 0, 1));
    expect(ray.intersectObject(facade, true).length).toBeGreaterThan(0);
  }
  for (const y of [1.6, STAIRWELL_FLOOR_HEIGHT + 1.6]) {
    ray.set(new THREE.Vector3(0, y, STAIRWELL_BOUNDS.minZ - 2), new THREE.Vector3(0, 0, 1));
    expect(ray.intersectObject(facade, true)).toHaveLength(0);
  }
  facade.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); }); material.dispose();
});
