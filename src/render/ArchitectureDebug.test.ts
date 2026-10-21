import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { ArchitectureDebug } from './ArchitectureDebug';
import { createWalkableBatch } from './WalkableGeometry';
import type { WalkableSurface } from '../world/WalkableTopology';
import { generateInfiniteChunk } from '../world/InfiniteWorld';
const base: WalkableSurface = { id: 'a', bounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 }, profile: { kind: 'flat', y: 0 },
  ownerStory: 0, layer: 'test', role: 'floor', ceilingY: 3, thickness: .16, support: 'slab', access: 'open', edges: 'architecture' };

it('removes common slab faces and the buried part of a solid riser', () => {
  const next = { ...base, id: 'b', bounds: { ...base.bounds, minX: 2, maxX: 4 } };
  const all = createWalkableBatch([base, next], 'sides');
  const exposed = createWalkableBatch([base, next], 'sides', 1, false, undefined, true);
  expect(all.getAttribute('position').count - exposed.getAttribute('position').count).toBe(12);
  const step = { ...next, support: 'solid' as const, supportBottom: -.16, profile: { kind: 'flat' as const, y: 1.2 } };
  const solids = createWalkableBatch([base, step], 'sides', 1, false, undefined, true), pos = solids.getAttribute('position');
  for (let i = 0; i < pos.count; i += 3) if ([0, 1, 2].every(j => Math.abs(pos.getX(i + j) - 2) < .0001))
    for (let j = 0; j < 3; j++) expect(pos.getY(i + j)).toBeGreaterThanOrEqual(0);
  all.dispose(); exposed.dispose(); solids.dispose();
});

it('restores materials and releases all temporary diagnostic resources', () => {
  const root = new THREE.Group(), material = new THREE.MeshBasicMaterial(), geometry = new THREE.BoxGeometry();
  const mesh = new THREE.Mesh(geometry, material); mesh.name = 'regional-carpet-floors'; root.add(mesh);
  const debug = new ArchitectureDebug(root, generateInfiniteChunk('REGIONAL-AUDIT-12', { x: 0, z: 0, story: 0 }));
  debug.setMode('uv');
  const diagnostic = mesh.material as THREE.MeshBasicMaterial, disposeMap = vi.spyOn(diagnostic.map!, 'dispose'), disposeMaterial = vi.spyOn(diagnostic, 'dispose');
  expect(diagnostic).not.toBe(material);
  debug.setMode('volumes'); expect(mesh.material).toBe(material); expect(root.children).toHaveLength(2);
  expect(disposeMap).toHaveBeenCalledOnce(); expect(disposeMaterial).toHaveBeenCalledOnce();
  debug.setMode('off'); expect(root.children).toHaveLength(1); expect(mesh.material).toBe(material);
  debug.dispose(); geometry.dispose(); material.dispose();
});
