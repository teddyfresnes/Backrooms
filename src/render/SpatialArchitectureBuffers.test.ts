import { expect, it } from 'vitest';
import * as THREE from 'three';
import { generateInfiniteChunk } from '../world/InfiniteWorld';
import { architectureTransferables, mountArchitectureBatch, prepareSpatialArchitecture } from './SpatialArchitectureBuffers';
import { WorldView } from './WorldBuilder';
import { bakeRegionalLightData } from './RegionalLighting';
import type { MaterialSet } from './MaterialLibrary';

it('transfers exact clipped geometry and bounds, then mounts the same arrays without preparing them again', async () => {
  const plan = generateInfiniteChunk('WORKER-ARCHITECTURE-TRANSFERS', { x: -1, z: 1, story: 2 }); plan.propPlacements = [];
  const before = JSON.stringify(plan), prepared = prepareSpatialArchitecture(plan), buffers = architectureTransferables(prepared);
  expect(prepared.length).toBeGreaterThan(4); expect(new Set(buffers).size).toBe(buffers.length);
  const clone = structuredClone(prepared, { transfer: buffers }); expect(buffers.every(b => b.byteLength === 0)).toBe(true);
  expect(JSON.stringify(plan)).toBe(before);
  const materials = Object.fromEntries(['wall', 'plaster', 'floor', 'ceiling', 'baseboard', 'pitWall', 'pitBottom', 'metal', 'fixtureFrame', 'fixtureGlow', 'void']
    .map(name => [name, name === 'fixtureGlow' || name === 'void' ? new THREE.MeshBasicMaterial() : new THREE.MeshStandardMaterial()])) as unknown as MaterialSet;
  const view = new WorldView(plan, materials, { architectureData: clone, regionalLightData: bakeRegionalLightData(plan), architectureOnly: true });
  try {
    await view.ready;
    for (const batch of clone) {
      const mesh = view.group.getObjectByName(batch.name) as THREE.Mesh;
      for (const name of ['position', 'normal', 'uv', 'color'] as const) expect(mesh.geometry.getAttribute(name).array).toBe(batch[name]);
      expect(mesh.geometry.boundingBox!.min.toArray()).toEqual(batch.min);
      expect(mesh.geometry.boundingSphere!.radius).toBe(batch.sphere[3]);
    }
    const floor = view.group.getObjectByName('regional-carpet-floors') as THREE.Mesh;
    const saved = floor.geometry;
    await view.promoteDetails(); expect(floor.geometry).toBe(saved);
  } finally { view.dispose(); Object.values(materials).forEach(m => m.dispose()); }
  // CPU arrays survive GPU disposal and can be mounted after leaving/re-entering.
  const restored = mountArchitectureBatch(clone[0]!); expect(restored.getAttribute('position').array).toBe(clone[0]!.position); restored.dispose();
});
