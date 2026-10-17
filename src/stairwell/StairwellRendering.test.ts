import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { StairwellEnvironment, STAIRWELL_LIGHTING_PROFILES } from './StairwellEnvironment';
import { StairwellLightPool } from './StairwellLightPool';
import type { StairwellMaterialSet } from './StairwellMaterials';
import { mapStairwellWallUV } from './StairwellSurfaceFinish';
import { makeBox } from './geometry';
import { floorY, midLandingY, STAIRWELL_LEVEL_COUNT } from './layout';

const names = ['upperPlaster', 'lowerPaint', 'landingTerrazzo', 'stairTerrazzo', 'slabUnderside',
  'ceiling', 'railing', 'doorSteel', 'doorInset', 'frameMetal', 'galvanized', 'glass', 'windowFrame',
  'fixtureBody', 'fixtureGlow', 'rubber', 'pipe'];
const environments: StairwellEnvironment[] = [];
const sets: THREE.Material[][] = [];
const create = () => {
  const materials = Object.fromEntries(names.map(name => [name, new THREE.MeshStandardMaterial({ name })])) as unknown as StairwellMaterialSet;
  sets.push(Object.values(materials));
  const env = new StairwellEnvironment(materials); environments.push(env); return env;
};

beforeEach(() => {
  // Canvas drawing is tested separately with the real 2D runtime. Geometry,
  // raycasts and light/shadow budgets here use real Three.js without WebGL.
  const gradient = { addColorStop() {} };
  const ctx = new Proxy({ createLinearGradient: () => gradient, createRadialGradient: () => gradient },
    { get: (target, key) => Reflect.get(target, key) ?? (() => undefined) });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
});
afterEach(() => {
  environments.splice(0).forEach(env => env.dispose());
  sets.splice(0).flat().forEach(material => material.dispose());
  vi.unstubAllGlobals();
});

describe('stairwell surfaces and complete procedural scene budget', () => {
  it('has one opaque wall skin at flight/landing junctions, without coplanar paint panels', () => {
    const env = create(); env.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    for (let y = .23; y < 11; y += .31) for (let z = -5.8; z < 3.7; z += .17) {
      for (const side of [-1, 1]) {
        ray.set(new THREE.Vector3(0, y, z), new THREE.Vector3(side, 0, 0)); ray.far = 2.1;
        const walls = ray.intersectObject(env.group, true).filter(hit =>
          ((hit.object as THREE.Mesh).material as THREE.Material).name === 'stairwell-worn-masonry');
        const opening = z > -3.174 && z < -2.25 && y % 2.88 > .04 && y % 2.88 < 2.271;
        if (!opening) expect(walls.length, `wall ${side},${y},${z}`).toBeGreaterThan(0);
        if (walls.length > 1) expect(walls[1]!.distance - walls[0]!.distance).toBeGreaterThan(.00001);
      }
    }
  });

  it('keeps all seven landing finishes continuous, flat and aligned to collision height', () => {
    const env = create(); env.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const landings = Array.from({ length: STAIRWELL_LEVEL_COUNT }, (_, i) => ({ y: floorY(i), min: -5.9, max: -1.205 }));
    for (let i = 0; i < STAIRWELL_LEVEL_COUNT - 1; i++) landings.push({ y: midLandingY(i), min: 1.205, max: 3.7 });
    for (const landing of landings) for (let x = -1.7; x < 1.71; x += .23) for (let z = landing.min; z < landing.max; z += .19) {
      ray.set(new THREE.Vector3(x, landing.y + .08, z), new THREE.Vector3(0, -1, 0)); ray.far = .2;
      const hits = ray.intersectObject(env.group, true).filter(hit =>
        ((hit.object as THREE.Mesh).material as THREE.Material).name === 'landingTerrazzo');
      expect(hits.length, `landing ${landing.y},${x},${z}`).toBeGreaterThan(0);
      expect(hits[0]!.point.y).toBeCloseTo(landing.y, 5);
    }
  });

  it('uses four fixed local lights and cached exterior shadows, with bounded static geometry', () => {
    const env = create(); let pointLights = 0, triangles = 0, meshes = 0;
    env.group.traverse(object => {
      if (object instanceof THREE.PointLight) pointLights++;
      if (object instanceof THREE.DirectionalLight || object instanceof THREE.SpotLight) {
        expect(object.shadow.autoUpdate).toBe(false); expect(object.shadow.needsUpdate).toBe(true);
      }
      if (object instanceof THREE.Mesh) {
        meshes++; triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3;
      }
    });
    expect(pointLights).toBe(4); expect(meshes).toBeLessThan(160); expect(triangles).toBeLessThan(100_000);
    for (let height = 1; height < 11; height += .2) env.update(height / 2, height);
    expect(env.group.children.filter(o => o instanceof THREE.PointLight)).toHaveLength(4);
  });

  it('keeps wall texture coordinates identical across shell segment joins', () => {
    const material = new THREE.MeshStandardMaterial();
    const a = mapStairwellWallUV(makeBox('a', [.22, 2.88, 2], [-2.05, 1.44, -5.25], material), 'west');
    const b = mapStairwellWallUV(makeBox('b', [.22, 2.88, 2], [-2.05, 4.32, -5.25], material), 'west');
    const samples = (mesh: THREE.Mesh) => {
      const p = mesh.geometry.getAttribute('position'), uv = mesh.geometry.getAttribute('uv');
      const out: Array<[number, number]> = [];
      for (let i = 0; i < p.count; i++) if (Math.abs(p.getY(i) + mesh.position.y - 2.88) < .0001 && p.getX(i) > 0)
        out.push([uv.getX(i), uv.getY(i)]);
      return out.sort((a, b) => a[0] - b[0]);
    };
    expect(samples(a)).toEqual(samples(b));
    a.geometry.dispose(); b.geometry.dispose(); material.dispose();
  });

  it('retains the same light objects while following floors and changing lighting style', () => {
    const pool = new StairwellLightPool(STAIRWELL_LIGHTING_PROFILES.modern), ids = pool.lights.map(light => light.uuid);
    for (const height of [1.6, 4.4, 7.2, 10.2]) {
      pool.update(height);
      expect(pool.lights.map(light => light.uuid)).toEqual(ids);
      expect(pool.lights.some(light => Math.abs(light.position.y - height) < 2)).toBe(true);
      expect(pool.lights.every(light => !light.castShadow && light.intensity > 0)).toBe(true);
    }
    pool.setProfile(STAIRWELL_LIGHTING_PROFILES.legacy);
    expect(pool.lights.map(light => light.uuid)).toEqual(ids);
  });
});
