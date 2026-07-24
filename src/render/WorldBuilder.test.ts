import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { MaterialSet } from './MaterialLibrary';
import { WorldView, createOpenShaftWallGeometries } from './WorldBuilder';
import type { WorldPlan } from '../world/types';

const createTestMaterials = (): MaterialSet => ({
  wall: new THREE.MeshStandardMaterial(),
  plaster: new THREE.MeshStandardMaterial(),
  floor: new THREE.MeshStandardMaterial(),
  ceiling: new THREE.MeshStandardMaterial({ side: THREE.FrontSide }),
  baseboard: new THREE.MeshStandardMaterial(),
  pitWall: new THREE.MeshStandardMaterial(),
  pitBottom: new THREE.MeshStandardMaterial(),
  metal: new THREE.MeshStandardMaterial(),
  fixtureFrame: new THREE.MeshStandardMaterial(),
  fixtureGlow: new THREE.MeshBasicMaterial(),
  void: new THREE.MeshBasicMaterial(),
});

describe('open pit shaft rendering', () => {
  it('uses capless vertical faces that remain below the walkable floor', () => {
    const bottom = -2.72;
    const top = -0.004;
    const geometries = createOpenShaftWallGeometries(
      { minX: -2, maxX: 3, minZ: 4, maxZ: 7 },
      bottom,
      top,
      0.72,
    );

    expect(geometries).toHaveLength(4);
    for (const geometry of geometries) {
      geometry.computeBoundingBox();
      expect(geometry.boundingBox?.min.y).toBeCloseTo(bottom, 5);
      expect(geometry.boundingBox?.max.y).toBeCloseTo(top, 5);
      const normals = geometry.getAttribute('normal');
      const geometryIndex = geometry.getIndex();
      expect(geometryIndex).not.toBeNull();
      for (let offset = 0; offset < geometryIndex!.count; offset += 1) {
        expect(Math.abs(normals.getY(geometryIndex!.getX(offset)))).toBeLessThan(1e-6);
      }
      geometry.dispose();
    }
  });

  it('keeps shaft contours opaque from both the hole and the room below', () => {
    const geometries = createOpenShaftWallGeometries(
      { minX: -2, maxX: 2, minZ: -2, maxZ: 2 },
      -2.7,
      2.7,
      0.9,
    );
    const material = new THREE.MeshStandardMaterial({ side: THREE.FrontSide });
    const group = new THREE.Group();
    for (const geometry of geometries) group.add(new THREE.Mesh(geometry, material));
    const raycaster = new THREE.Raycaster();
    raycaster.far = 4;

    raycaster.set(new THREE.Vector3(0, 0, -3), new THREE.Vector3(0, 0, 1));
    expect(raycaster.intersectObject(group, true).length).toBeGreaterThan(0);
    raycaster.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));
    expect(raycaster.intersectObject(group, true).length).toBeGreaterThan(0);

    for (const geometry of geometries) geometry.dispose();
    material.dispose();
  });

  it('keeps inherited ceiling apertures open and reveals a lit upper storey', () => {
    const opening = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
    const plan: WorldPlan = {
      version: 1,
      seed: 'CEILING-APERTURE-RENDER-AUDIT',
      size: 12,
      wallHeight: 2.66,
      rooms: [],
      walls: [{
        id: 'ceiling-shaft-collar-0-west',
        x: opening.minX,
        z: 0,
        length: 2,
        orientation: 'z',
        bottom: 2.66,
        height: 2.74,
        thickness: 0.14,
        tint: 1,
        collision: false,
        kind: 'wallpaper',
      }],
      columns: [],
      solidMasses: [],
      lights: [],
      missingCeilingTiles: [],
      features: [],
      detailSockets: [],
      colliders: [],
      floorRects: [{ minX: -6, maxX: 6, minZ: -6, maxZ: 6 }],
      floorOpenings: [],
      ceilingOpenings: [opening],
      spawn: { x: 0, y: 0.9, z: 0 },
    };
    const materials = createTestMaterials();
    const whitePixel = Uint8Array.of(255, 255, 255, 255);
    const view = new WorldView(plan, materials, {
      bakedLightMaps: {
        resolution: 1,
        general: whitePixel,
        ceiling: whitePixel,
      },
    });
    const raycaster = new THREE.Raycaster();
    raycaster.set(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0));
    raycaster.far = 10;
    const throughOpening = raycaster.intersectObject(view.group, true);
    expect(throughOpening.some((hit) => hit.object.name === 'office-drop-ceiling')).toBe(false);
    expect(throughOpening.some((hit) => hit.object.name === 'upper-story-floor-underside-preview'))
      .toBe(false);
    expect(throughOpening.some((hit) => hit.object.name === 'upper-story-preview-ceiling')).toBe(true);
    expect(
      ((view.group.getObjectByName('upper-story-floor-underside-preview') as THREE.Mesh)
        .material as THREE.Material).name,
    ).toBe('preview-ceiling');
    expect(
      ((view.group.getObjectByName('upper-story-preview-wallpaper-walls') as THREE.Mesh)
        .material as THREE.Material).name,
    ).toBe('preview-wallpaper');

    raycaster.set(new THREE.Vector3(2, 1, 0), new THREE.Vector3(0, 1, 0));
    raycaster.far = 6;
    const solidHits = raycaster.intersectObject(view.group, true);
    expect(solidHits.some((hit) => hit.object.name === 'office-drop-ceiling')).toBe(true);
    expect(solidHits.some((hit) => hit.object.name === 'upper-story-floor-underside-preview')).toBe(true);

    view.dispose();
    Object.values(materials).forEach((material) => material.dispose());
  });

  it('subtracts shaft openings from elevated ceilings too', () => {
    const opening = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
    const room = {
      id: 'room-high',
      bounds: { minX: -3, maxX: 3, minZ: -3, maxZ: 3 },
      kind: 'open-hall' as const,
      level: 0,
      ceilingHeight: 4.8,
      detailDensity: 0,
    };
    const plan: WorldPlan = {
      version: 1,
      seed: 'ELEVATED-CEILING-OPENING-AUDIT',
      size: 12,
      wallHeight: 2.74,
      rooms: [room],
      walls: [],
      columns: [],
      solidMasses: [],
      lights: [],
      missingCeilingTiles: [],
      features: [],
      detailSockets: [],
      colliders: [],
      floorRects: [{ minX: -6, maxX: 6, minZ: -6, maxZ: 6 }],
      floorOpenings: [],
      ceilingOpenings: [opening],
      spawn: { x: 0, y: 0.9, z: 0 },
    };
    const materials = createTestMaterials();
    const whitePixel = Uint8Array.of(255, 255, 255, 255);
    const view = new WorldView(plan, materials, {
      bakedLightMaps: {
        resolution: 1,
        general: whitePixel,
        ceiling: whitePixel,
      },
    });
    const raycaster = new THREE.Raycaster();
    raycaster.far = 2.2;
    raycaster.set(new THREE.Vector3(0, 3, 0), new THREE.Vector3(0, 1, 0));
    expect(raycaster.intersectObject(view.group, true)
      .some((hit) => hit.object.name === 'elevated-atrium-ceilings')).toBe(false);

    raycaster.set(new THREE.Vector3(2, 3, 0), new THREE.Vector3(0, 1, 0));
    expect(raycaster.intersectObject(view.group, true)
      .some((hit) => hit.object.name === 'elevated-atrium-ceilings')).toBe(true);

    view.dispose();
    Object.values(materials).forEach((material) => material.dispose());
  });
});

describe('crouch passages and inter-storey stairs', () => {
  it('renders a low physical roof and a stair flight reaching 5.4m', () => {
    const stairBounds = { minX: 0, maxX: 8, minZ: -2.5, maxZ: 2.5 };
    const plan: WorldPlan = {
      version: 1,
      seed: 'LOW-PASSAGE-STAIR-RENDER-AUDIT',
      size: 20,
      wallHeight: 2.74,
      rooms: [{
        id: 'room-a',
        bounds: { minX: -9, maxX: 9, minZ: -9, maxZ: 9 },
        kind: 'office',
        level: 0,
        ceilingHeight: 2.74,
        detailDensity: 0,
      }],
      walls: [],
      columns: [],
      solidMasses: [],
      lights: [],
      missingCeilingTiles: [],
      features: [
        {
          kind: 'squeeze-view',
          id: 'crawl-a',
          roomId: 'room-a',
          bounds: { minX: -8, maxX: -3, minZ: -2, maxZ: 2 },
          axis: 'x',
          apertureWidth: 1.2,
          layout: 'dead-end',
          exitCount: 0,
          clearanceHeight: 1.4,
          holes: [],
        },
        {
          kind: 'stair-socket',
          id: 'stairs-a',
          roomId: 'room-a',
          bounds: stairBounds,
          heading: 'x+',
          baseY: 0,
        },
      ],
      detailSockets: [],
      colliders: [],
      floorRects: [{ minX: -10, maxX: 10, minZ: -10, maxZ: 10 }],
      floorOpenings: [],
      stairCeilingOpenings: [stairBounds],
      spawn: { x: -5, y: 0.865, z: 0 },
    };
    const materials = createTestMaterials();
    const whitePixel = Uint8Array.of(255, 255, 255, 255);
    const view = new WorldView(plan, materials, {
      bakedLightMaps: {
        resolution: 1,
        general: whitePixel,
        ceiling: whitePixel,
      },
    });
    const roof = view.group.getObjectByName('low-passage-ceiling-masses') as THREE.Mesh;
    const stairs = view.group.getObjectByName('inter-storey-stair-flights') as THREE.Mesh;
    expect(roof).toBeDefined();
    expect(stairs).toBeDefined();
    roof.geometry.computeBoundingBox();
    stairs.geometry.computeBoundingBox();
    expect(roof.geometry.boundingBox?.min.y).toBeCloseTo(1.4, 5);
    expect(stairs.geometry.boundingBox?.max.y).toBeCloseTo(5.4, 5);
    expect(view.group.getObjectByName('inter-storey-stair-cages')).toBeDefined();
    expect(view.group.getObjectByName('inter-storey-stair-lights')).toBeDefined();

    view.dispose();
    Object.values(materials).forEach((material) => material.dispose());
  });
});
