import { auditAxisPlaneTriangles } from '../../tests/support/geometry-audit';
import { expect, it } from 'vitest';
import * as THREE from 'three';
import { generateInfiniteChunk } from '../world/InfiniteWorld';
import { profilePrism } from '../world/SpatialGeometry';
import { slabVertices, type WalkableSurface } from '../world/WalkableTopology';
import { createFaceExposure, faceTriangles } from './FaceExposure';
import { createWalkableBatch } from './WalkableGeometry';
import { createSpatialPrismBatch } from './SpatialGeometry';
import { mountArchitectureBatch, prepareSpatialArchitecture } from './SpatialArchitectureBuffers';

const flat = (y: number) => ({ kind: 'flat' as const, y });
const slab: WalkableSurface = { id: 'slab', ownerStory: 0, layer: 'room', role: 'floor', bounds: { minX: 0, maxX: 6, minZ: 0, maxZ: 4 },
  profile: flat(3), ceilingY: 6, thickness: .16, support: 'slab', access: 'open', edges: 'architecture' };

it('discards seam triangles whose distinct double-precision corners collapse in the GPU buffer', () => {
  const triangle = [-49.7791557, 6.69, -16.4, -49.7783126, 6.72, -16.4, -49.7783125, 6.72, -16.4];
  expect(faceTriangles([], 0, [triangle])).toEqual([]);
});

it('owns the floor/lintel seam once and removes the internal wall/slab interface without opening a hole', () => {
  const lintel = profilePrism('lintel', { minX: 4, maxX: 7, minZ: 0, maxZ: 4 }, flat(2), flat(3));
  const wall = profilePrism('support', { minX: 0, maxX: 2, minZ: 0, maxZ: 4 }, flat(0), flat(2.84));
  const exposure = createFaceExposure([{ source: slab, vertices: slabVertices(slab) }, ...[lintel, wall].map(source => ({ source, vertices: source.vertices }))]);
  const geometries = [createWalkableBatch([slab], 'top', 1, false, undefined, true, exposure), createWalkableBatch([slab], 'underside', 1, false, undefined, true, exposure),
    createSpatialPrismBatch([lintel, wall], 1, undefined, exposure)];
  const material = new THREE.MeshBasicMaterial(), meshes = geometries.map(g => { const m = new THREE.Mesh(g, material); m.updateMatrixWorld(); return m; });
  try {
    for (const x of [1.137, 3.137, 5.137, 6.137]) {
      const hits = new THREE.Raycaster(new THREE.Vector3(x, 4, 1.317), new THREE.Vector3(0, -1, 0), 0, 1.01).intersectObjects(meshes);
      expect(hits).toHaveLength(1); expect(hits[0]!.point.y).toBeCloseTo(3);
    }
    const underside = new THREE.Raycaster(new THREE.Vector3(1.137, 2.5, 1.317), new THREE.Vector3(0, 1, 0), 0, .4).intersectObjects(meshes);
    expect(underside).toHaveLength(0); // Inside the solid support: neither internal face survives.
  } finally { geometries.forEach(g => g.dispose()); material.dispose(); }
});

it('clips a trapezoidal ramp cheek against its neighbouring ceiling and retains the exact slope and UV phase', () => {
  const ramp: WalkableSurface = { ...slab, id: 'roof-ramp', profile: { kind: 'linear', axis: 'x', startY: 3, endY: 5 } };
  const neighbor = profilePrism('roof-lintel', { minX: 4, maxX: 7, minZ: 0, maxZ: 4 }, flat(4.5), flat(5));
  const exposure = createFaceExposure([{ source: ramp, vertices: slabVertices(ramp) }, { source: neighbor, vertices: neighbor.vertices }]);
  const g = createSpatialPrismBatch([neighbor], 1, { x: 224, y: 10.8, z: -112 }, exposure);
  const material = new THREE.MeshBasicMaterial(), mesh = new THREE.Mesh(g, material); mesh.updateMatrixWorld();
  try {
    // On the north cheek the sloping ceiling and lintel overlap only a thin
    // trapezoid. AABB clipping would incorrectly delete this exposed point.
    const hits = new THREE.Raycaster(new THREE.Vector3(4.137, 4.85, -1), new THREE.Vector3(0, 0, 1), 0, 1.01).intersectObject(mesh);
    expect(hits).toHaveLength(1); expect(hits[0]!.uv!.x).toBeCloseTo((4.137 + 224) / 2.05, 4);
    expect(exposure(neighbor, 5)).toBeDefined();
  } finally { g.dispose(); material.dispose(); }
});

it('emits no overlapping axis-plane triangles across floors, roofs and structure in normal rooms and atrium/stair entrances', () => {
  let triangleCount = 0;
  for (let n = 0; n < 16; n++) {
    const plan = generateInfiniteChunk(`REGIONAL-AUDIT-${n}`, { x: 0, z: 0, story: 0 });
    const batches = prepareSpatialArchitecture(plan).map(batch => ({ name: batch.name, geometry: mountArchitectureBatch(batch) }));
    try { const audit = auditAxisPlaneTriangles(batches); triangleCount += audit.triangleCount; expect(audit.errors, plan.seed).toEqual([]); }
    finally { batches.forEach(b => b.geometry.dispose()); }
  }
  expect(triangleCount).toBeGreaterThan(100000);
}, 30000);
