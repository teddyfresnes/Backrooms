import { expect, it, vi } from 'vitest';
vi.mock('@dimforge/rapier3d', async () => import('../../node_modules/@dimforge/rapier3d/rapier.js'));
import RAPIER from '@dimforge/rapier3d';
import * as THREE from 'three';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { createSpatialPrismBatch } from '../render/SpatialGeometry';
import { createFaceExposure } from '../render/FaceExposure';
import { auditAxisPlaneTriangles } from '../../tests/support/geometry-audit';
import { appendOpeningWall, openingProfile, openingTopAt, type OpeningWall } from './ArchitecturalOpenings';
import { passageRow } from './LiminalArchitecture';
import { SeededRandom } from './SeededRandom';
import { slabMeshCollider } from './SpatialGeometry';
import type { WalkableSurface } from './WalkableTopology';
import type { WorldPlan } from './types';

const fixture = (): WorldPlan => {
  const surface: WalkableSurface = { id: 'floor', ownerStory: 0, layer: 'room', role: 'floor', bounds: { minX: -12, maxX: 12, minZ: -12, maxZ: 12 },
    profile: { kind: 'flat', y: 0 }, ceilingY: 4.5, thickness: .16, support: 'slab', access: 'open', edges: 'architecture' };
  return { version: 17, seed: 'ARCH-PHYSICS', size: 112, wallHeight: 4.5, rooms: [], walls: [], columns: [], solidMasses: [], lights: [],
    missingCeilingTiles: [], features: [], detailSockets: [], colliders: [slabMeshCollider(surface)], floorRects: [surface.bounds], spawn: { x: 0, y: .865, z: -3 },
    topology: { version: 2, ownerStory: 0, surfaces: [surface], connections: [], volumes: [], diagnostics: [] },
    spatial: { version: 2, owner: { x: 0, z: 0, story: 0 }, cells: [], ceilings: [], prisms: [], dependencies: [], interfaces: [], landmarks: [] } };
};

it('uses the same sampled intrados in both axes for visible faces and real standing traversal', async () => {
  for (const axis of ['x', 'z'] as const) {
    const w = fixture(), wall: OpeningWall = { id: 'arch', axis, bottom: -.16, top: 4.5,
      bounds: axis === 'x' ? { minX: -8, maxX: 8, minZ: -.6, maxZ: .6 } : { minZ: -8, maxZ: 8, minX: -.6, maxX: .6 },
      openings: [{ min: -2, max: 2, bottom: 0, height: 3.15, rise: .85, shape: 'arch', segments: 8, access: 'walk' },
        { min: 4, max: 6, bottom: 1.4, height: 1.1, rise: 0, shape: 'rect', segments: 1, access: 'view' }] };
    appendOpeningWall(w, wall);
    const prisms = w.spatial!.prisms, exposure = createFaceExposure(prisms.map(source => ({ source, vertices: source.vertices })));
    const geometry = createSpatialPrismBatch(prisms, 1, undefined, exposure), material = new THREE.MeshBasicMaterial(), mesh = new THREE.Mesh(geometry, material);
    mesh.updateMatrixWorld(); const physics = await PhysicsWorld.create(w);
    const point = (along: number, cross: number, y: number) => ({ x: axis === 'x' ? along : cross, z: axis === 'x' ? cross : along, y });
    try {
      expect(auditAxisPlaneTriangles([{ name: 'arch', geometry }]).errors).toEqual([]);
      for (const n of geometry.getAttribute('uv').array) expect(Number.isFinite(n)).toBe(true);
      for (const along of [-1.55, -.7, .17, .83, 1.55]) for (const cross of [-.4, 0, .4]) {
        const origin = point(along, cross, 1.8), ray = new THREE.Raycaster(new THREE.Vector3(origin.x, origin.y, origin.z), new THREE.Vector3(0, 1, 0), 0, 3);
        const visible = ray.intersectObject(mesh)[0], hit = physics.world.castRay(new RAPIER.Ray(origin, { x: 0, y: 1, z: 0 }), 3, true,
          undefined, undefined, undefined, undefined, physics.isEnvironmentCollider);
        expect(visible).toBeDefined(); expect(hit).not.toBeNull();
        expect(visible!.point.y).toBeCloseTo(openingTopAt(wall.openings[0]!, along), 5);
        expect(origin.y + hit!.timeOfImpact).toBeCloseTo(visible!.point.y, 4);
        expect(physics.canStandAt(point(along, cross, .91))).toBe(true);
      }
      for (const along of [-5, 3, 7, 5]) expect(physics.canStandAt(point(along, -.8, .91)), `${axis}/${along}`).toBe(false);
      for (const sign of [-1, 1]) {
        physics.teleport(point(0, sign * 2, .865)); let actual = point(0, sign * 2, .865);
        for (let t = 0; t < 80; t++) actual = { ...physics.move({ x: axis === 'x' ? 0 : -sign * .06, z: axis === 'x' ? -sign * .06 : 0, y: -.035 }).position };
        expect((axis === 'x' ? actual.z : actual.x) * -sign).toBeGreaterThan(1.8);
      }
    } finally { physics.dispose(); geometry.dispose(); material.dispose(); }
  }
});

it('bounds tessellation and leaves massive piers between deterministic grouped openings', () => {
  for (const span of [10, 22, 42]) for (const pattern of ['single', 'rhythm', 'right-cluster', 'two-clusters', 'mixed', 'high-windows', 'rect-rhythm', 'wide-and-small', 'mixed-levels'] as const) {
    const seed = `ROW/${span}/${pattern}`, row = passageRow(new SeededRandom(seed), 0, span, 0, 3.3, pattern);
    expect(row).toEqual(passageRow(new SeededRandom(seed), 0, span, 0, 3.3, pattern));
    expect(row.length).toBeGreaterThan(0); expect(row.length).toBeLessThanOrEqual(6);
    for (const [i, o] of row.entries()) {
      expect(o.min).toBeGreaterThanOrEqual(.19); expect(o.max).toBeLessThanOrEqual(span - .19);
      if (i) expect(o.min - row[i - 1]!.max).toBeGreaterThanOrEqual(.64999);
      expect(openingProfile({ ...o, segments: 999 }).length).toBeLessThanOrEqual(13);
      expect(o.access).toBe(pattern === 'high-windows' || pattern === 'mixed-levels' && i % 2 === 1 ? 'view' : 'walk');
      if (o.access === 'walk') expect(Math.min(...openingProfile(o).map(p => p.top))).toBeGreaterThanOrEqual(2.14999);
    }
  }
});
