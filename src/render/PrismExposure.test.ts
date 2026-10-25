import { auditAxisPlaneTriangles } from '../../tests/support/geometry-audit';
import { expect, it } from 'vitest';
import * as THREE from 'three';
import { profilePrism } from '../world/SpatialGeometry';
import { prismExposure } from './PrismExposure';
import { createSpatialPrismBatch } from './SpatialGeometry';
import { ceilingFixturePose } from './CeilingFixture';
import { generateInfiniteChunk } from '../world/InfiniteWorld';
import { surfaceY } from '../world/WalkableTopology';

it('cuts partial coplanar wall/facade overlap once without changing its plane or texture phase', () => {
  const flat = (y: number) => ({ kind: 'flat' as const, y });
  const a = profilePrism('partition', { minX: 0, maxX: 6, minZ: 0, maxZ: 1 }, flat(0), flat(3));
  const b = profilePrism('facade', { minX: 3, maxX: 9, minZ: 0, maxZ: 1 }, flat(0), flat(3));
  const exposure = prismExposure([a, b]), g = createSpatialPrismBatch([a, b], 1, { x: 0, y: 0, z: 0 }, exposure);
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial()); mesh.updateMatrixWorld();
  try {
    for (const x of [1.13, 4.17, 7.19]) {
      const hit = new THREE.Raycaster(new THREE.Vector3(x, 1.31, -1), new THREE.Vector3(0, 0, 1), 0, 1.01).intersectObject(mesh);
      expect(hit).toHaveLength(1); expect(hit[0]!.point.z).toBe(0); expect(hit[0]!.uv!.x).toBeCloseTo(x / 2.05, 5);
    }
  } finally { g.dispose(); (mesh.material as THREE.Material).dispose(); }
});

it('leaves every corner of a sloping fluorescent panel below and parallel to the actual roof', () => {
  let checked = 0;
  for (let n = 0; n < 24; n++) {
    const w = generateInfiniteChunk(`REGIONAL-AUDIT-${n}`, { x: 0, z: 0, story: 0 });
    for (const t of w.spatial!.transitions!) {
      const slot = w.lights.find(l => l.id === `${t.id}/light`); if (!slot) continue;
      const position = new THREE.Vector3(), rotation = new THREE.Quaternion(); ceilingFixturePose(w, slot, position, rotation);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation);
      for (const x of [-slot.width / 2, slot.width / 2]) for (const z of [-.5, .5]) {
        const corner = new THREE.Vector3(x, 0, z).applyQuaternion(rotation).add(position);
        const roof = w.spatial!.ceilings.find(s => s.id === `${t.id}/roof`)!;
        const roofY = surfaceY(roof, corner.x, corner.z);
        expect((roofY - corner.y) * up.y - roof.thickness).toBeCloseTo(.036, 5);
      }
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(5);
}, 30000);

it('keeps the final rendered ceiling above the entire useful width of isolated flights', async () => {
  const { createWalkableBatch } = await import('./WalkableGeometry');
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }); let samples = 0;
  try {
    for (let n = 0; n < 12; n++) {
      const w = generateInfiniteChunk(`REGIONAL-AUDIT-${n}`, { x: 0, z: 0, story: 0 });
      const geometries = [createWalkableBatch(w.spatial!.ceilings, 'underside'), createWalkableBatch(w.topology!.surfaces, 'underside'),
        createSpatialPrismBatch(w.spatial!.prisms, 1, { x: 0, y: 0, z: 0 }, prismExposure(w.spatial!.prisms))];
      const meshes = geometries.map(g => { const m = new THREE.Mesh(g, material); m.updateMatrixWorld(); return m; });
      try {
        for (const t of w.spatial!.transitions!) for (const along of [.05, .25, .5, .75, .95]) for (const across of [.4 / t.width, .5, 1 - .4 / t.width]) {
          const b = t.run, x = b.minX + (b.maxX - b.minX) * (t.axis === 'x' ? along : across), z = b.minZ + (b.maxZ - b.minZ) * (t.axis === 'z' ? along : across);
          const floor = w.topology!.surfaces.find(s => (s.id === t.id || s.id.startsWith(`${t.id}/step-`)) && x >= s.bounds.minX && x <= s.bounds.maxX && z >= s.bounds.minZ && z <= s.bounds.maxZ)!;
          expect(floor, `${w.seed}/${t.id}`).toBeDefined();
          const foot = surfaceY(floor, x, z), hits = new THREE.Raycaster(new THREE.Vector3(x, foot + .01, z), new THREE.Vector3(0, 1, 0), 0, 6).intersectObjects(meshes);
          expect(hits[0], `${w.seed}/${t.id} ${along}/${across}`).toBeDefined();
          expect(hits[0]!.point.y - foot, `${w.seed}/${t.id}`).toBeGreaterThan(2.5); samples++;
        }
      } finally { geometries.forEach(g => g.dispose()); }
    }
  } finally { material.dispose(); }
  expect(samples).toBeGreaterThan(100);
}, 30000);

it('emits no overlapping coplanar faces in complete BSP/facade/trim batches, including clipped wedges', () => {
  let triangles = 0;
  for (let n = 0; n < 8; n++) {
    const w = generateInfiniteChunk(`REGIONAL-AUDIT-${n}`, { x: 0, z: 0, story: 0 });
    const geometry = createSpatialPrismBatch(w.spatial!.prisms, 1, { x: 0, y: 0, z: 0 }, prismExposure(w.spatial!.prisms));
    try { const audit = auditAxisPlaneTriangles([{ name: w.seed, geometry }]); triangles += audit.triangleCount; expect(audit.errors).toEqual([]); }
    finally { geometry.dispose(); }
  }
  expect(triangles).toBeGreaterThan(20000);
}, 30000);
