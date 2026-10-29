import { expect, it, vi } from 'vitest';
vi.mock('@dimforge/rapier3d', async () => import('../../node_modules/@dimforge/rapier3d/rapier.js'));
import RAPIER from '@dimforge/rapier3d';
import * as THREE from 'three';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { architectureTransferables, mountArchitectureBatch, prepareSpatialArchitecture } from '../render/SpatialArchitectureBuffers';
import { generateInfiniteChunk } from './InfiniteWorld';
import { rectCenter } from './types';
import { surfaceY } from './WalkableTopology';

it.each([
  ['WALL-FINISH-HOLDOUT-0', { x: -1, z: -1, story: -2 }],
  ['WALL-FINISH-HOLDOUT-2', { x: 1, z: -1, story: 0 }],
] as const)('shares repaired floor contacts between worker buffers and actual Rapier: %s', async (seed, owner) => {
  const plan = generateInfiniteChunk(seed, owner);
  const restored = JSON.parse(JSON.stringify(plan)) as typeof plan;
  const patches = restored.topology!.surfaces.filter(s => s.id.includes('/contact-'));
  expect(patches.length).toBeGreaterThan(0);
  const prepared = prepareSpatialArchitecture(restored);
  const transferred = structuredClone(prepared, { transfer: architectureTransferables(prepared) });
  const geometries = transferred.filter(b => b.material === 'floor').map(mountArchitectureBatch);
  const material = new THREE.MeshBasicMaterial(), meshes = geometries.map(g => { const m = new THREE.Mesh(g, material); m.updateMatrixWorld(); return m; });
  const physics = await PhysicsWorld.create({ ...restored, propPlacements: [] });
  try {
    for (const patch of patches) {
      const at = rectCenter(patch.bounds), y = surfaceY(patch, at.x, at.z), origin = { ...at, y: y + .2 }, direction = { x: 0, y: -1, z: 0 };
      const physical = physics.world.castRay(new RAPIER.Ray(origin, direction), .4, true,
        undefined, undefined, undefined, undefined, physics.isEnvironmentCollider);
      const visible = new THREE.Raycaster(new THREE.Vector3(origin.x, origin.y, origin.z), new THREE.Vector3(0, -1, 0), 0, .4).intersectObjects(meshes);
      expect(physical, patch.id).not.toBeNull();
      expect(physical!.timeOfImpact, patch.id).toBeCloseTo(.2, 4);
      expect(visible, patch.id).toHaveLength(1);
      expect(visible[0]!.point.y).toBeCloseTo(y, 5);
    }
  } finally { physics.dispose(); geometries.forEach(g => g.dispose()); material.dispose(); }
});
