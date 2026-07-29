import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { MaterialSet } from './MaterialLibrary';
import { WorldView, createOpenShaftWallGeometries } from './WorldBuilder';
import type { GridPitFeature, RaisedZoneFeature, Rect, WorldPlan } from '../world/types';
import { rectCenter, rectWidth } from '../world/types';

const createTestMaterials = (): MaterialSet => {
  const wall = new THREE.MeshStandardMaterial();
  wall.name = 'test-wall';
  const ceiling = new THREE.MeshStandardMaterial({ side: THREE.FrontSide });
  ceiling.name = 'test-ceiling';
  return {
    wall,
    plaster: new THREE.MeshStandardMaterial(),
    floor: new THREE.MeshStandardMaterial(),
    ceiling,
    baseboard: new THREE.MeshStandardMaterial(),
    pitWall: new THREE.MeshStandardMaterial(),
    pitBottom: new THREE.MeshStandardMaterial(),
    metal: new THREE.MeshStandardMaterial(),
    fixtureFrame: new THREE.MeshStandardMaterial(),
    fixtureGlow: new THREE.MeshBasicMaterial(),
    void: new THREE.MeshBasicMaterial(),
  };
};

const horizontalQuadBounds = (geometry: THREE.BufferGeometry): Rect[] => {
  const positions = geometry.getAttribute('position');
  expect(positions.count % 4).toBe(0);
  const bounds: Rect[] = [];
  for (let offset = 0; offset < positions.count; offset += 4) {
    const xValues = Array.from({ length: 4 }, (_, index) => positions.getX(offset + index));
    const zValues = Array.from({ length: 4 }, (_, index) => positions.getZ(offset + index));
    bounds.push({
      minX: Math.min(...xValues),
      maxX: Math.max(...xValues),
      minZ: Math.min(...zValues),
      maxZ: Math.max(...zValues),
    });
  }
  return bounds;
};

const vertexUvsAt = (
  geometry: THREE.BufferGeometry,
  point: THREE.Vector3,
  normal: THREE.Vector3,
): THREE.Vector2[] => {
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const uvs = geometry.getAttribute('uv');
  const matches: THREE.Vector2[] = [];
  for (let index = 0; index < positions.count; index += 1) {
    if (
      Math.abs(positions.getX(index) - point.x) < 1e-5 &&
      Math.abs(positions.getY(index) - point.y) < 1e-5 &&
      Math.abs(positions.getZ(index) - point.z) < 1e-5 &&
      Math.abs(normals.getX(index) - normal.x) < 1e-5 &&
      Math.abs(normals.getY(index) - normal.y) < 1e-5 &&
      Math.abs(normals.getZ(index) - normal.z) < 1e-5
    ) {
      matches.push(new THREE.Vector2(uvs.getX(index), uvs.getY(index)));
    }
  }
  return matches;
};

describe('wallpaper mapping', () => {
  it('keeps one UV field across adjacent and vertically stacked wall fragments', () => {
    const wall = (
      id: string,
      x: number,
      z: number,
      bottom: number,
    ): WorldPlan['walls'][number] => ({
      id,
      x,
      z,
      length: 4,
      orientation: 'x',
      bottom,
      height: bottom === 0 ? 2.74 : 3,
      thickness: 0.22,
      tint: 1,
      collision: true,
      kind: 'wallpaper',
    });
    const plan: WorldPlan = {
      version: 1,
      seed: 'SEAMLESS-WALLPAPER-UV-AUDIT',
      size: 16,
      wallHeight: 2.74,
      rooms: [],
      walls: [
        wall('base-left', -2, 0, 0),
        wall('base-right', 2, 0, 0),
        wall('upper-left', -2, 0, 2.74),
        wall('upper-right', 2, 0, 2.74),
        wall('parallel-plane', -2, 4, 0),
      ],
      columns: [],
      solidMasses: [],
      lights: [],
      missingCeilingTiles: [],
      features: [],
      detailSockets: [],
      colliders: [],
      floorRects: [{ minX: -8, maxX: 8, minZ: -8, maxZ: 8 }],
      spawn: { x: 0, y: 0.9, z: -4 },
    };
    const materials = createTestMaterials();
    const view = new WorldView(plan, materials, {
      bakedLightMaps: {
        resolution: 1,
        general: Uint8Array.of(255, 255, 255, 255),
        ceiling: Uint8Array.of(255, 255, 255, 255),
      },
    });
    const walls = view.group.getObjectByName('merged-wallpaper-walls') as THREE.Mesh;
    const junctionUvs = vertexUvsAt(
      walls.geometry,
      new THREE.Vector3(0, 2.74, 0.11),
      new THREE.Vector3(0, 0, 1),
    );
    expect(junctionUvs).toHaveLength(4);
    for (const uv of junctionUvs.slice(1)) {
      expect(uv.x).toBeCloseTo(junctionUvs[0]!.x, 5);
      expect(uv.y).toBeCloseTo(junctionUvs[0]!.y, 5);
    }

    const firstPlaneUv = vertexUvsAt(
      walls.geometry,
      new THREE.Vector3(-4, 0, 0.11),
      new THREE.Vector3(0, 0, 1),
    )[0]!;
    const parallelPlaneUv = vertexUvsAt(
      walls.geometry,
      new THREE.Vector3(-4, 0, 4.11),
      new THREE.Vector3(0, 0, 1),
    )[0]!;
    expect(parallelPlaneUv.y).not.toBeCloseTo(firstPlaneUv.y, 5);

    view.dispose();
    Object.values(materials).forEach((material) => material.dispose());
  });
});

describe('open pit shaft rendering', () => {
  it('uses capless vertical faces that remain below the walkable floor', () => {
    const bottom = -2.72;
    const top = -0.004;
    const hole = { minX: -2, maxX: 3, minZ: 4, maxZ: 7 };
    const geometries = createOpenShaftWallGeometries(
      hole,
      bottom,
      top,
      0.72,
    );

    expect(geometries).toHaveLength(4);
    for (const [wallIndex, geometry] of geometries.entries()) {
      geometry.computeBoundingBox();
      expect(geometry.boundingBox?.min.y).toBeCloseTo(bottom, 5);
      expect(geometry.boundingBox?.max.y).toBeCloseTo(top, 5);
      if (wallIndex === 0) {
        expect(geometry.boundingBox?.min.z).toBeLessThan(hole.minZ);
        expect(geometry.boundingBox?.max.z).toBeGreaterThan(hole.minZ);
      }
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

  it('overlaps inherited shaft corners without adding a visible rim', () => {
    const opening = { minX: -2, maxX: 2, minZ: -1.5, maxZ: 1.5 };
    const thickness = 0.12;
    const center = {
      x: (opening.minX + opening.maxX) * 0.5,
      z: (opening.minZ + opening.maxZ) * 0.5,
    };
    const sides = [
      {
        suffix: 'north',
        x: center.x,
        z: opening.minZ,
        length: opening.maxX - opening.minX + thickness * 2,
        orientation: 'x' as const,
      },
      {
        suffix: 'south',
        x: center.x,
        z: opening.maxZ,
        length: opening.maxX - opening.minX + thickness * 2,
        orientation: 'x' as const,
      },
      {
        suffix: 'west',
        x: opening.minX,
        z: center.z,
        length: opening.maxZ - opening.minZ + thickness * 2,
        orientation: 'z' as const,
      },
      {
        suffix: 'east',
        x: opening.maxX,
        z: center.z,
        length: opening.maxZ - opening.minZ + thickness * 2,
        orientation: 'z' as const,
      },
    ];
    const plan: WorldPlan = {
      version: 1,
      seed: 'INHERITED-SHAFT-CORNER-AUDIT',
      size: 16,
      wallHeight: 2.74,
      rooms: [],
      walls: sides.map((side) => ({
        id: `inherited-shaft-0-${side.suffix}`,
        x: side.x,
        z: side.z,
        length: side.length,
        orientation: side.orientation,
        bottom: -2.66,
        height: 8.14,
        thickness,
        tint: 0.96,
        collision: true,
        kind: 'wallpaper',
      })),
      columns: [],
      solidMasses: [],
      lights: [],
      missingCeilingTiles: [],
      features: [],
      detailSockets: [],
      colliders: [],
      floorRects: [{ minX: -8, maxX: 8, minZ: -8, maxZ: 8 }],
      ceilingOpenings: [opening],
      spawn: { x: 0, y: 0.9, z: 0 },
    };
    const materials = createTestMaterials();
    const view = new WorldView(plan, materials);
    const shaft = view.group.getObjectByName('carpet-lined-through-shaft-walls') as THREE.Mesh;
    const positions = shaft.geometry.getAttribute('position');
    const normals = shaft.geometry.getAttribute('normal');
    const northInnerXs: number[] = [];
    const westInnerZs: number[] = [];
    for (let index = 0; index < positions.count; index += 1) {
      if (
        normals.getZ(index) > 0.9 &&
        Math.abs(positions.getZ(index) - (opening.minZ + thickness * 0.5)) < 1e-5
      ) northInnerXs.push(positions.getX(index));
      if (
        normals.getX(index) > 0.9 &&
        Math.abs(positions.getX(index) - (opening.minX + thickness * 0.5)) < 1e-5
      ) westInnerZs.push(positions.getZ(index));
    }
    expect(Math.min(...northInnerXs)).toBeLessThan(opening.minX - thickness * 0.9);
    expect(Math.min(...westInnerZs)).toBeLessThan(opening.minZ - thickness * 0.9);

    const geometryIndex = shaft.geometry.getIndex();
    expect(geometryIndex).not.toBeNull();
    for (let offset = 0; offset < geometryIndex!.count; offset += 1) {
      expect(Math.abs(normals.getY(geometryIndex!.getX(offset)))).toBeLessThan(1e-6);
    }

    view.dispose();
    Object.values(materials).forEach((material) => material.dispose());
  });

  it('lines every pit depth with carpet and keeps intermediate storeys non-emissive', () => {
    const carpetTexture = new THREE.DataTexture(
      Uint8Array.of(96, 82, 36, 255),
      1,
      1,
    );
    carpetTexture.needsUpdate = true;
    const wallpaperTexture = new THREE.DataTexture(
      Uint8Array.of(120, 116, 62, 255),
      1,
      1,
    );
    wallpaperTexture.needsUpdate = true;
    const materials = createTestMaterials();
    materials.floor.name = 'test-carpet';
    materials.floor.map = carpetTexture;
    materials.floor.emissive.setHex(0x090806);
    materials.floor.emissiveIntensity = 0.03;
    materials.wall.name = 'test-wallpaper';
    materials.wall.map = wallpaperTexture;
    materials.wall.emissive.setHex(0x080704);
    materials.wall.emissiveIntensity = 0.025;

    const hole = {
      minX: -1.8,
      maxX: 1.8,
      minZ: -1.4,
      maxZ: 1.4,
      depth: 10.8,
      stories: 2,
      kind: 'drop' as const,
    };
    const pit: GridPitFeature = {
      kind: 'grid-pit',
      id: 'deep-pit',
      roomId: 'pit-room',
      bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
      holes: [hole],
      depth: hole.depth,
      pattern: 'single',
      lowerBounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
      lowerFloorY: -5.4,
      lowerCeilingY: -2.66,
    };
    const plan: WorldPlan = {
      version: 1,
      seed: 'CARPET-LINED-DEEP-PIT-AUDIT',
      size: 12,
      wallHeight: 2.74,
      rooms: [{
        id: 'pit-room',
        bounds: pit.bounds,
        kind: 'pit-gallery',
        level: 0,
        ceilingHeight: 2.74,
        detailDensity: 0,
      }],
      walls: [
        {
          id: 'lower-room-wall',
          x: 0,
          z: -5,
          length: 10,
          orientation: 'x',
          bottom: -5.4,
          height: 2.74,
          thickness: 0.42,
          tint: 1,
          collision: true,
          kind: 'wallpaper',
        },
        {
          id: 'inherited-shaft-0-north',
          x: 0,
          z: hole.minZ - 0.06,
          length: hole.maxX - hole.minX,
          orientation: 'x',
          bottom: -2.66,
          height: 8.14,
          thickness: 0.12,
          tint: 1,
          collision: true,
          kind: 'wallpaper',
        },
      ],
      columns: [],
      solidMasses: [],
      lights: [],
      missingCeilingTiles: [],
      features: [pit],
      detailSockets: [],
      colliders: [],
      floorRects: [{ minX: -6, maxX: -1.8, minZ: -6, maxZ: 6 }],
      floorOpenings: [hole],
      spawn: { x: -4, y: 0.9, z: 0 },
    };
    const view = new WorldView(plan, materials);
    const firstShaft = view.group.getObjectByName('open-pit-shaft-walls') as THREE.Mesh;
    const throughShaft = view.group.getObjectByName('carpet-lined-through-shaft-walls') as THREE.Mesh;
    const lowerWalls = view.group.getObjectByName('lower-storey-wallpaper-walls') as THREE.Mesh;
    const lowerFloor = view.group.getObjectByName('lower-carpet-deep-pit') as THREE.Mesh;

    for (const mesh of [firstShaft, throughShaft, lowerFloor]) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      expect(material.name).toBe('lower-storey-carpet');
      expect(material.map).toBe(carpetTexture);
      expect(material.lightMap).toBeNull();
      expect(material.emissive.getHex()).toBe(materials.floor.emissive.getHex());
      expect(material.emissiveIntensity).toBeCloseTo(materials.floor.emissiveIntensity);
    }
    const lowerWallMaterial = lowerWalls.material as THREE.MeshStandardMaterial;
    expect(lowerWallMaterial.name).toBe('lower-storey-wallpaper');
    expect(lowerWallMaterial.map).toBe(wallpaperTexture);
    expect(lowerWallMaterial.lightMap).toBeNull();
    expect(lowerWallMaterial.emissive.getHex()).toBe(materials.wall.emissive.getHex());
    expect(lowerWallMaterial.emissiveIntensity).toBeCloseTo(materials.wall.emissiveIntensity);
    const shaftUvs = firstShaft.geometry.getAttribute('uv');
    expect(shaftUvs).toBeDefined();
    expect(shaftUvs.count).toBeGreaterThan(0);

    view.dispose();
    Object.values(materials).forEach((material) => material.dispose());
    carpetTexture.dispose();
    wallpaperTexture.dispose();
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
      walls: [
        {
          id: 'sunken-room-wall',
          roomId: 'room-a',
          x: -1,
          z: -4.8,
          length: 14,
          orientation: 'x',
          bottom: 0,
          height: 4.5,
          thickness: 0.22,
          tint: 1,
          collision: true,
          kind: 'wallpaper',
        },
        {
          id: 'sunken-room-wall-lower-shell',
          roomId: 'room-a',
          x: -1,
          z: -4.8,
          length: 14,
          orientation: 'x',
          bottom: -1.25,
          height: 1.25,
          thickness: 0.22,
          tint: 1,
          collision: true,
          kind: 'wallpaper',
          detail: 'lower-shell',
        },
      ],
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

describe('baseboard suppression', () => {
  it('omits trim in baseboardless zones and on crawl-tunnel walls', () => {
    const plan: WorldPlan = {
      version: 1,
      seed: 'BASEBOARDLESS-ZONE-RENDER-AUDIT',
      size: 32,
      wallHeight: 2.74,
      rooms: [],
      walls: [
        {
          id: 'wall-with-baseboard',
          x: -8,
          z: 0,
          length: 2,
          orientation: 'x',
          bottom: 0,
          height: 2.74,
          thickness: 0.22,
          tint: 1,
          collision: true,
          kind: 'wallpaper',
        },
        {
          id: 'wall-in-baseboardless-zone',
          x: 0,
          z: 0,
          length: 2,
          orientation: 'x',
          bottom: 0,
          height: 2.74,
          thickness: 0.22,
          tint: 1,
          collision: true,
          kind: 'wallpaper',
        },
        {
          id: 'crawl-tunnel-outside-zone',
          x: 8,
          z: 0,
          length: 2,
          orientation: 'x',
          bottom: 0,
          height: 2.74,
          thickness: 0.22,
          tint: 1,
          collision: true,
          kind: 'wallpaper',
          detail: 'crawl-tunnel',
        },
      ],
      columns: [{
        x: 0,
        z: 4,
        width: 1,
        depth: 1,
        height: 2.74,
        tint: 1,
      }],
      solidMasses: [{
        id: 'mass-in-baseboardless-zone',
        bounds: { minX: 2, maxX: 4, minZ: 2, maxZ: 4 },
        height: 2.74,
        tint: 1,
      }],
      baseboardlessZones: [
        { minX: 1, maxX: 1.5, minZ: -0.2, maxZ: 0.2 },
        { minX: 0.5, maxX: 1, minZ: 3.5, maxZ: 4.5 },
        { minX: 4, maxX: 4.5, minZ: 2, maxZ: 4 },
      ],
      lights: [],
      missingCeilingTiles: [],
      features: [],
      detailSockets: [],
      colliders: [],
      floorRects: [{ minX: -16, maxX: 16, minZ: -16, maxZ: 16 }],
      spawn: { x: -8, y: 0.9, z: 0 },
    };
    const materials = createTestMaterials();
    const view = new WorldView(plan, materials);
    const baseboards = view.group.getObjectByName('merged-baseboards') as THREE.Mesh;

    expect(baseboards).toBeDefined();
    const positions = baseboards.geometry.getAttribute('position');
    expect(positions.count).toBe(24);
    for (let index = 0; index < positions.count; index += 1) {
      expect(positions.getX(index)).toBeLessThan(-6.8);
    }

    view.dispose();
    Object.values(materials).forEach((material) => material.dispose());
  });
});

describe('high-ceiling passage closures', () => {
  it('keeps a textured underside on unsupported upper portal lintels', () => {
    const plan: WorldPlan = {
      version: 1,
      seed: 'HIGH-PORTAL-SOFFIT-RENDER-AUDIT',
      size: 12,
      wallHeight: 2.74,
      rooms: [{
        id: 'tall-room',
        bounds: { minX: -6, maxX: 6, minZ: -6, maxZ: 6 },
        kind: 'open-hall',
        level: 0,
        ceilingHeight: 8,
        detailDensity: 0,
      }],
      walls: [
        {
          id: 'portal-lintel',
          roomId: 'tall-room',
          x: 0,
          z: 0,
          length: 2.4,
          orientation: 'x',
          bottom: 2.7,
          height: 5.3,
          thickness: 1.2,
          tint: 1,
          collision: true,
          kind: 'wallpaper',
          detail: 'upper-portal-lintel',
        },
        {
          id: 'orphaned-upper-shell',
          roomId: 'tall-room',
          x: 3.5,
          z: 0,
          length: 2,
          orientation: 'x',
          bottom: 2.7,
          height: 5.3,
          thickness: 0.8,
          tint: 1,
          collision: true,
          kind: 'wallpaper',
          detail: 'upper-shell',
        },
      ],
      columns: [],
      solidMasses: [],
      lights: [],
      missingCeilingTiles: [],
      features: [],
      detailSockets: [],
      colliders: [],
      floorRects: [{ minX: -6, maxX: 6, minZ: -6, maxZ: 6 }],
      spawn: { x: 3, y: 0.9, z: 3 },
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
    const walls = view.group.getObjectByName('merged-wallpaper-walls') as THREE.Mesh;
    for (const x of [0, 3.5]) {
      const raycaster = new THREE.Raycaster(
        new THREE.Vector3(x, 2.2, 0),
        new THREE.Vector3(0, 1, 0),
        0,
        1,
      );
      const hits = raycaster.intersectObject(walls);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]!.point.y).toBeCloseTo(2.7, 4);
    }
    const wallIndex = walls.geometry.getIndex();
    const wallNormals = walls.geometry.getAttribute('normal');
    expect(wallIndex).not.toBeNull();
    if (wallIndex) {
      for (let offset = 0; offset < wallIndex.count; offset += 3) {
        const first = wallIndex.getX(offset);
        expect(Math.abs(wallNormals.getX(first))).toBeLessThan(0.5);
      }
    }

    view.dispose();
    Object.values(materials).forEach((material) => material.dispose());
  });
});

describe('biome transition passage joins', () => {
  it('renders one capless threshold band without overlapping baseboards', () => {
    const transitionWalls: WorldPlan['walls'] = [
      {
        id: 'biome-transition-east-gate-0-return-0',
        x: -0.545,
        z: 0,
        length: 0.91,
        orientation: 'x',
        bottom: 0,
        height: 2.74,
        thickness: 0.12,
        tint: 1,
        collision: false,
        kind: 'wallpaper',
        detail: 'biome-boundary-skin',
      },
      {
        id: 'biome-transition-west-gate-0-band-0',
        x: 0,
        z: 0,
        length: 0.18,
        orientation: 'x',
        bottom: 0,
        height: 2.74,
        thickness: 0.12,
        tint: 1,
        collision: false,
        kind: 'wallpaper',
        detail: 'biome-boundary-band',
      },
      {
        id: 'biome-transition-west-gate-0-return-0',
        x: 0.545,
        z: 0,
        length: 0.91,
        orientation: 'x',
        bottom: 0,
        height: 2.74,
        thickness: 0.12,
        tint: 1,
        collision: false,
        kind: 'wallpaper',
        detail: 'biome-boundary-skin',
      },
    ];
    const plan: WorldPlan = {
      version: 1,
      seed: 'BIOME-PASSAGE-JOIN-RENDER-AUDIT',
      size: 8,
      wallHeight: 2.74,
      rooms: [],
      walls: transitionWalls,
      columns: [],
      solidMasses: [],
      lights: [],
      missingCeilingTiles: [],
      features: [],
      detailSockets: [],
      colliders: [],
      floorRects: [{ minX: -4, maxX: 4, minZ: -4, maxZ: 4 }],
      spawn: { x: 0, y: 0.865, z: 2 },
    };
    const materials = createTestMaterials();
    const view = new WorldView(plan, materials);
    const walls = view.group.getObjectByName('merged-wallpaper-walls') as THREE.Mesh;
    const index = walls.geometry.getIndex();
    const normals = walls.geometry.getAttribute('normal');
    expect(index).not.toBeNull();
    if (index) {
      for (let offset = 0; offset < index.count; offset += 3) {
        expect(Math.abs(normals.getX(index.getX(offset)))).toBeLessThan(0.5);
        expect(Math.abs(normals.getY(index.getX(offset)))).toBeLessThan(0.5);
      }
    }
    expect(view.group.getObjectByName('merged-baseboards')).toBeUndefined();

    view.dispose();
    Object.values(materials).forEach((material) => material.dispose());
  });
});

describe('coplanar ceiling repair prevention', () => {
  it('cuts crossing lightmap repair strips into non-overlapping ceiling patches', () => {
    const plan: WorldPlan = {
      version: 1,
      seed: 'CEILING-Z-FIGHT-RENDER-AUDIT',
      size: 112,
      wallHeight: 2.74,
      rooms: [],
      walls: [
        {
          id: 'horizontal-off-grid-wall',
          x: 0.18,
          z: 0.18,
          length: 8,
          orientation: 'x',
          bottom: 0,
          height: 2.74,
          thickness: 0.22,
          tint: 1,
          collision: true,
          kind: 'wallpaper',
        },
        {
          id: 'vertical-off-grid-wall',
          x: 0.18,
          z: 0.18,
          length: 8,
          orientation: 'z',
          bottom: 0,
          height: 2.74,
          thickness: 0.22,
          tint: 1,
          collision: true,
          kind: 'wallpaper',
        },
      ],
      columns: [],
      solidMasses: [],
      lights: [],
      missingCeilingTiles: [],
      features: [],
      detailSockets: [],
      colliders: [],
      floorRects: [{ minX: -56, maxX: 56, minZ: -56, maxZ: 56 }],
      spawn: { x: 8, y: 0.9, z: 8 },
      surfaceStyle: {
        wallTint: 1,
        floorTint: 1,
        ceilingTint: 1,
        wallPatternScale: 1,
        floorPatternScale: 1,
        ceilingPatternScale: 1.23,
        floorQuarterTurn: false,
      },
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
    const repairs = view.group.getObjectByName('ceiling-lightmap-junction-repairs') as THREE.Mesh;
    const ceiling = view.group.getObjectByName('office-drop-ceiling') as THREE.Mesh;
    expect(repairs).toBeDefined();
    expect(ceiling).toBeDefined();
    const patches = horizontalQuadBounds(repairs.geometry);
    const ceilingPatches = horizontalQuadBounds(ceiling.geometry);
    expect(patches.length).toBeGreaterThan(2);
    const positions = repairs.geometry.getAttribute('position');
    const uvs = repairs.geometry.getAttribute('uv');
    for (let index = 0; index < positions.count; index += 1) {
      expect(positions.getY(index)).toBeCloseTo(plan.wallHeight, 6);
      expect(uvs.getX(index)).toBeCloseTo((positions.getX(index) / 2.4) * 1.23, 5);
      expect(uvs.getY(index)).toBeCloseTo((positions.getZ(index) / 2.4) * 1.23, 5);
    }
    for (let left = 0; left < patches.length; left += 1) {
      for (let right = left + 1; right < patches.length; right += 1) {
        const first = patches[left]!;
        const second = patches[right]!;
        const overlapX = Math.min(first.maxX, second.maxX) - Math.max(first.minX, second.minX);
        const overlapZ = Math.min(first.maxZ, second.maxZ) - Math.max(first.minZ, second.minZ);
        expect(overlapX > 1e-5 && overlapZ > 1e-5).toBe(false);
      }
      for (const ceilingPatch of ceilingPatches) {
        const repair = patches[left]!;
        const overlapX = Math.min(repair.maxX, ceilingPatch.maxX)
          - Math.max(repair.minX, ceilingPatch.minX);
        const overlapZ = Math.min(repair.maxZ, ceilingPatch.maxZ)
          - Math.max(repair.minZ, ceilingPatch.minZ);
        expect(overlapX > 1e-5 && overlapZ > 1e-5).toBe(false);
      }
    }

    view.dispose();
    Object.values(materials).forEach((material) => material.dispose());
  });
});

describe('multi-room elevation districts', () => {
  it('renders sunken carpet, inclined access and retaining walls below zero', () => {
    const platformA = { minX: -8, maxX: -1, minZ: -5, maxZ: 5 };
    const platformB = { minX: -1, maxX: 6, minZ: -5, maxZ: 5 };
    const ramp = {
      bounds: { minX: 6, maxX: 9, minZ: -1.5, maxZ: 1.5 },
      axis: 'x' as const,
      riseDirection: -1 as const,
    };
    const plan: WorldPlan = {
      version: 1,
      seed: 'SUNKEN-DISTRICT-RENDER-AUDIT',
      size: 24,
      wallHeight: 2.74,
      rooms: [
        {
          id: 'room-a',
          bounds: platformA,
          kind: 'office',
          level: 0,
          ceilingHeight: 4.5,
          detailDensity: 0,
        },
        {
          id: 'room-b',
          bounds: platformB,
          kind: 'corridor',
          level: 0,
          ceilingHeight: 4.5,
          detailDensity: 0,
        },
      ],
      walls: [],
      columns: [{
        x: -2,
        z: 0,
        width: 0.55,
        depth: 0.55,
        bottom: -1.25,
        height: 5.75,
        tint: 1,
        kind: 'pilaster',
      }],
      solidMasses: [],
      lights: [],
      missingCeilingTiles: [],
      features: [{
        kind: 'raised-zone',
        id: 'elevation-zone-a',
        roomId: 'room-a',
        roomIds: ['room-a', 'room-b'],
        bounds: { minX: -8, maxX: 9, minZ: -5, maxZ: 5 },
        platformBounds: platformA,
        platformRects: [platformA, platformB],
        elevation: -1.25,
        ramp,
        ramps: [ramp],
      }],
      detailSockets: [],
      colliders: [],
      floorRects: [{ minX: -12, maxX: 12, minZ: 6, maxZ: 12 }],
      floorOpenings: [],
      spawn: { x: 10, y: 0.865, z: 0 },
    };
    const materials = createTestMaterials();
    const view = new WorldView(plan, materials);
    const floors = view.group.getObjectByName('raised-carpet-platforms-and-ramps') as THREE.Mesh;
    const retainingWalls = view.group.getObjectByName('wallpaper-raised-platform-skirts') as THREE.Mesh;
    const supportWalls = view.group.getObjectByName('wallpaper-elevation-support-walls') as THREE.Mesh;
    const extendedColumns = view.group.getObjectByName('merged-wallpaper-walls') as THREE.Mesh;
    const columnBaseboards = view.group.getObjectByName('merged-baseboards') as THREE.Mesh;

    floors.geometry.computeBoundingBox();
    retainingWalls.geometry.computeBoundingBox();
    supportWalls.geometry.computeBoundingBox();
    extendedColumns.geometry.computeBoundingBox();
    columnBaseboards.geometry.computeBoundingBox();
    expect(floors.geometry.boundingBox?.min.y).toBeCloseTo(-1.25, 3);
    expect(floors.geometry.boundingBox?.max.y).toBeCloseTo(0.0012, 3);
    expect(floors.geometry.boundingBox?.max.x).toBeGreaterThan(9.01);
    expect(retainingWalls.geometry.boundingBox?.min.y).toBeCloseTo(-1.25, 3);
    expect(retainingWalls.geometry.boundingBox?.max.y).toBeCloseTo(0, 3);
    const retainingWallTopRay = new THREE.Raycaster(
      new THREE.Vector3(7.5, 1, ramp.bounds.maxZ),
      new THREE.Vector3(0, -1, 0),
      0,
      2,
    );
    expect(retainingWallTopRay.intersectObject(retainingWalls).length).toBeGreaterThan(0);
    expect(supportWalls.geometry.boundingBox?.min.y).toBeLessThan(-1.25);
    expect(supportWalls.geometry.boundingBox?.max.y).toBeGreaterThan(0);
    expect(supportWalls.geometry.boundingBox?.min.x).toBeCloseTo(-8, 3);
    expect(supportWalls.geometry.boundingBox?.max.x).toBeCloseTo(6, 3);
    expect(extendedColumns.geometry.boundingBox?.min.y).toBeCloseTo(-1.25, 3);
    expect(extendedColumns.geometry.boundingBox?.max.y).toBeCloseTo(4.5, 3);
    expect(columnBaseboards.geometry.boundingBox?.min.y).toBeCloseTo(-1.25, 3);
    expect(columnBaseboards.geometry.boundingBox?.max.y).toBeCloseTo(-1.135, 3);
    for (const point of [
      new THREE.Vector3(6.01, 1, 0),
      new THREE.Vector3(9.01, 1, 0),
      new THREE.Vector3(7.5, 1, 1.51),
    ]) {
      const seamRay = new THREE.Raycaster(
        point,
        new THREE.Vector3(0, -1, 0),
        0,
        3,
      );
      expect(seamRay.intersectObject(floors).length).toBeGreaterThan(0);
    }
    const openingRay = new THREE.Raycaster(
      new THREE.Vector3(8, -0.6, 0),
      new THREE.Vector3(-1, 0, 0),
      0,
      4,
    );
    expect(openingRay.intersectObject(supportWalls)).toHaveLength(0);
    openingRay.ray.origin.z = 3;
    expect(openingRay.intersectObject(supportWalls).length).toBeGreaterThan(0);

    view.dispose();
    Object.values(materials).forEach((material) => material.dispose());

    const raisedMaterials = createTestMaterials();
    const sourceFeature = plan.features[0] as RaisedZoneFeature;
    const raisedPlan: WorldPlan = {
      ...plan,
      seed: 'RAISED-DISTRICT-RENDER-AUDIT',
      features: [{
        ...sourceFeature,
        elevation: 1.25,
      }],
    };
    const raisedView = new WorldView(raisedPlan, raisedMaterials);
    const raisedSupports = raisedView.group.getObjectByName(
      'wallpaper-elevation-support-walls',
    ) as THREE.Mesh;
    const raisedRetainingWalls = raisedView.group.getObjectByName(
      'wallpaper-raised-platform-skirts',
    ) as THREE.Mesh;
    const raisedRetainingWallTopRay = new THREE.Raycaster(
      new THREE.Vector3(7.5, 2, ramp.bounds.maxZ),
      new THREE.Vector3(0, -1, 0),
      0,
      2,
    );
    expect(raisedRetainingWallTopRay.intersectObject(raisedRetainingWalls).length)
      .toBeGreaterThan(0);
    const underRampRay = new THREE.Raycaster(
      new THREE.Vector3(8, 0.6, 0),
      new THREE.Vector3(-1, 0, 0),
      0,
      4,
    );
    expect(underRampRay.intersectObject(raisedSupports).length).toBeGreaterThan(0);

    raisedView.dispose();
    Object.values(raisedMaterials).forEach((material) => material.dispose());
  });

  it.each([
    ['raised', 1],
    ['sunken', -1],
  ] as const)(
    'moves only the baseboard face beside a %s platform',
    (_label, elevation) => {
      const platform = { minX: -3, maxX: 3, minZ: 0, maxZ: 3 };
      const ramp = {
        bounds: { minX: 3, maxX: 5, minZ: 0.75, maxZ: 2.25 },
        axis: 'x' as const,
        riseDirection: -1 as const,
      };
      const plan: WorldPlan = {
        version: 1,
        seed: `ONE-SIDED-BASEBOARD-${elevation}`,
        size: 12,
        wallHeight: 2.74,
        rooms: [{
          id: 'platform-room',
          bounds: platform,
          kind: 'office',
          level: 0,
          ceilingHeight: 2.74,
          detailDensity: 0,
        }],
        walls: [{
          id: 'platform-boundary-wall',
          x: 0,
          z: 0,
          length: 6,
          orientation: 'x',
          bottom: 0,
          height: 2.74,
          thickness: 0.22,
          tint: 1,
          collision: true,
          kind: 'wallpaper',
        }],
        columns: [],
        solidMasses: [],
        lights: [],
        missingCeilingTiles: [],
        features: [{
          kind: 'raised-zone',
          id: 'one-sided-elevation-zone',
          roomId: 'platform-room',
          bounds: { minX: -3, maxX: 5, minZ: 0, maxZ: 3 },
          platformBounds: platform,
          platformRects: [platform],
          elevation,
          ramp,
          ramps: [ramp],
        }],
        detailSockets: [],
        colliders: [],
        floorRects: [{ minX: -6, maxX: 6, minZ: -6, maxZ: 6 }],
        floorOpenings: [],
        spawn: { x: 0, y: 0.865, z: -2 },
      };
      const materials = createTestMaterials();
      const view = new WorldView(plan, materials);
      const baseboards = view.group.getObjectByName('merged-baseboards') as THREE.Mesh;
      const normalFloorY = 0.0575;
      const changedFloorY = elevation + 0.0575;
      const rayFromSide = (side: -1 | 1, y: number): number => {
        const raycaster = new THREE.Raycaster(
          new THREE.Vector3(0, y, side),
          new THREE.Vector3(0, 0, -side),
          0,
          1,
        );
        return raycaster.intersectObject(baseboards).length;
      };

      expect(rayFromSide(-1, normalFloorY)).toBeGreaterThan(0);
      expect(rayFromSide(-1, changedFloorY)).toBe(0);
      expect(rayFromSide(1, changedFloorY)).toBeGreaterThan(0);
      expect(rayFromSide(1, normalFloorY)).toBe(0);

      view.dispose();
      Object.values(materials).forEach((material) => material.dispose());
    },
  );
});

describe('crouch passages and inter-storey stairs', () => {
  it('renders a low physical roof and a stair flight reaching 5.4m', () => {
    const stairBounds = { minX: 0, maxX: 8, minZ: -2.5, maxZ: 2.5 };
    const passageHole = {
      minX: -6.8,
      maxX: -5.7,
      minZ: -0.75,
      maxZ: 0.75,
      depth: 5.4,
      kind: 'drop' as const,
      stories: 1,
    };
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
          holes: [passageHole],
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
      floorRects: [
        { minX: -10, maxX: 10, minZ: -10, maxZ: passageHole.minZ },
        { minX: -10, maxX: 10, minZ: passageHole.maxZ, maxZ: 10 },
        {
          minX: -10,
          maxX: passageHole.minX,
          minZ: passageHole.minZ,
          maxZ: passageHole.maxZ,
        },
        {
          minX: passageHole.maxX,
          maxX: 10,
          minZ: passageHole.minZ,
          maxZ: passageHole.maxZ,
        },
      ],
      floorOpenings: [passageHole],
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
    const passageShaft = view.group.getObjectByName('low-passage-hole-walls') as THREE.Mesh;
    const passageLowerFloor = view.group.getObjectByName(
      'low-passage-lower-floors',
    ) as THREE.Mesh;
    const passageLowerWalls = view.group.getObjectByName(
      'low-passage-lower-walls',
    ) as THREE.Mesh;
    const passageLowerCeiling = view.group.getObjectByName(
      'low-passage-lower-ceilings',
    ) as THREE.Mesh;
    const stairs = view.group.getObjectByName('inter-storey-stair-flights') as THREE.Mesh;
    const stairBodies = view.group.getObjectByName('inter-storey-stair-bodies') as THREE.Mesh;
    const stairCage = view.group.getObjectByName('inter-storey-stair-cages') as THREE.Mesh;
    const stairLights = view.group.getObjectByName('inter-storey-stair-lights');
    const upperFloor = view.group.getObjectByName('upper-stair-preview-floor') as THREE.Mesh;
    const upperUnderside = view.group.getObjectByName(
      'upper-stair-preview-floor-underside',
    ) as THREE.Mesh;
    const upperWalls = view.group.getObjectByName(
      'upper-stair-preview-wallpaper-walls',
    ) as THREE.Mesh;
    const upperCeiling = view.group.getObjectByName(
      'upper-stair-preview-ceiling',
    ) as THREE.Mesh;
    expect(roof).toBeDefined();
    expect(passageShaft).toBeDefined();
    expect(passageLowerFloor).toBeDefined();
    expect(passageLowerWalls).toBeDefined();
    expect(passageLowerCeiling).toBeDefined();
    expect(view.group.getObjectByName('low-passage-hole-bottoms')).toBeUndefined();
    expect(stairs).toBeDefined();
    expect(stairBodies).toBeDefined();
    expect(stairCage).toBeDefined();
    expect(stairLights).toBeUndefined();
    expect(upperFloor).toBeDefined();
    expect(upperUnderside).toBeDefined();
    expect(upperWalls).toBeDefined();
    expect(upperCeiling).toBeDefined();
    expect((roof.material as THREE.Material).name).toBe('test-wall-baked');
    expect((passageShaft.material as THREE.Material).name).toBe('lower-storey-wallpaper');
    expect((passageLowerFloor.material as THREE.Material).name).toBe('lower-storey-carpet');
    expect((stairBodies.material as THREE.Material).name).toBe('test-wall-baked');
    expect((upperFloor.material as THREE.Material).name).toBe('preview-carpet');
    expect((upperWalls.material as THREE.Material).name).toBe('preview-wallpaper');
    roof.geometry.computeBoundingBox();
    passageShaft.geometry.computeBoundingBox();
    passageLowerFloor.geometry.computeBoundingBox();
    passageLowerWalls.geometry.computeBoundingBox();
    passageLowerCeiling.geometry.computeBoundingBox();
    stairs.geometry.computeBoundingBox();
    stairCage.geometry.computeBoundingBox();
    upperFloor.geometry.computeBoundingBox();
    upperUnderside.geometry.computeBoundingBox();
    upperWalls.geometry.computeBoundingBox();
    upperCeiling.geometry.computeBoundingBox();
    expect(roof.geometry.boundingBox?.min.y).toBeCloseTo(1.4, 5);
    expect(roof.geometry.boundingBox?.min.x).toBeLessThan(-8.01);
    expect(roof.geometry.boundingBox?.max.x).toBeGreaterThan(-2.99);
    expect(roof.geometry.boundingBox?.min.z).toBeLessThan(-2.01);
    expect(roof.geometry.boundingBox?.max.z).toBeGreaterThan(2.01);
    expect(passageShaft.geometry.boundingBox?.min.y).toBeCloseTo(-2.72, 5);
    expect(passageShaft.geometry.boundingBox?.max.y).toBeCloseTo(0.012, 5);
    expect(passageLowerFloor.geometry.boundingBox?.min.y).toBeCloseTo(-5.4, 5);
    expect(passageLowerWalls.geometry.boundingBox?.min.y).toBeCloseTo(-5.4, 5);
    expect(passageLowerWalls.geometry.boundingBox?.max.y).toBeCloseTo(-2.66, 5);
    expect(passageLowerCeiling.geometry.boundingBox?.min.y).toBeCloseTo(-2.66, 5);
    const passageCenter = rectCenter(passageHole);
    const topSeamRay = new THREE.Raycaster(
      new THREE.Vector3(passageCenter.x, 0.006, passageCenter.z),
      new THREE.Vector3(-1, 0, 0),
      0,
      rectWidth(passageHole) * 0.5 + 0.08,
    );
    expect(topSeamRay.intersectObject(passageShaft).length).toBeGreaterThan(0);
    expect(stairs.geometry.boundingBox?.max.y).toBeCloseTo(5.4012, 5);
    expect(stairCage.geometry.boundingBox?.max.x).toBeGreaterThan(8.15);
    expect(upperFloor.geometry.boundingBox?.min.y).toBeCloseTo(5.4, 5);
    expect(upperUnderside.geometry.boundingBox?.min.y).toBeCloseTo(5.28, 5);
    expect(upperWalls.geometry.boundingBox?.min.y).toBeCloseTo(2.74, 5);
    expect(upperWalls.geometry.boundingBox?.max.y).toBeCloseTo(8.14, 5);
    expect(upperCeiling.geometry.boundingBox?.min.y).toBeCloseTo(8.14, 5);
    const cageIndex = stairCage.geometry.getIndex();
    const cageNormals = stairCage.geometry.getAttribute('normal');
    expect(cageIndex).not.toBeNull();
    if (cageIndex) {
      for (let offset = 0; offset < cageIndex.count; offset += 3) {
        expect(Math.abs(cageNormals.getY(cageIndex.getX(offset)))).toBeLessThan(0.5);
      }
    }

    view.dispose();
    Object.values(materials).forEach((material) => material.dispose());

    const voidHole = {
      ...passageHole,
      depth: 64.8,
      kind: 'void' as const,
      stories: 12,
    };
    const voidMaterials = createTestMaterials();
    const voidPlan: WorldPlan = {
      ...plan,
      seed: 'LOW-PASSAGE-VOID-RENDER-AUDIT',
      features: plan.features.map((feature) =>
        feature.kind === 'squeeze-view'
          ? { ...feature, holes: [voidHole] }
          : feature
      ),
      floorOpenings: [voidHole],
    };
    const voidView = new WorldView(voidPlan, voidMaterials);
    const voidShaft = voidView.group.getObjectByName(
      'low-passage-hole-walls',
    ) as THREE.Mesh;
    voidShaft.geometry.computeBoundingBox();
    expect(voidShaft.geometry.boundingBox?.min.y).toBeLessThan(-70);
    expect(voidShaft.geometry.boundingBox?.max.y).toBeCloseTo(0.012, 5);
    expect(voidView.group.getObjectByName('low-passage-lower-floors')).toBeUndefined();
    expect(voidView.group.getObjectByName('low-passage-hole-bottoms')).toBeUndefined();

    voidView.dispose();
    Object.values(voidMaterials).forEach((material) => material.dispose());
  });

  it('renders a complete lower-room preview around an inherited stair', () => {
    const stairBounds = { minX: -4, maxX: 4, minZ: -2.5, maxZ: 2.5 };
    const plan: WorldPlan = {
      version: 1,
      seed: 'LOWER-STAIR-PREVIEW-RENDER-AUDIT',
      size: 20,
      wallHeight: 2.74,
      rooms: [],
      walls: [],
      columns: [],
      solidMasses: [],
      lights: [],
      missingCeilingTiles: [],
      features: [{
        kind: 'stair-socket',
        id: 'inherited-stairs-a',
        roomId: 'room-below',
        bounds: stairBounds,
        heading: 'z-',
        baseY: -5.4,
        inherited: true,
      }],
      detailSockets: [],
      colliders: [],
      floorRects: [
        { minX: -10, maxX: -4.08, minZ: -10, maxZ: 10 },
        { minX: 4.08, maxX: 10, minZ: -10, maxZ: 10 },
      ],
      floorOpenings: [{ minX: -3.92, maxX: 3.92, minZ: -2.42, maxZ: 2.42 }],
      spawn: { x: 7, y: 0.865, z: 0 },
    };
    const materials = createTestMaterials();
    const view = new WorldView(plan, materials);
    const stairs = view.group.getObjectByName('inter-storey-stair-flights') as THREE.Mesh;
    const lowerFloor = view.group.getObjectByName('lower-stair-preview-floor') as THREE.Mesh;
    const lowerWalls = view.group.getObjectByName(
      'lower-stair-preview-wallpaper-walls',
    ) as THREE.Mesh;
    const lowerCeiling = view.group.getObjectByName(
      'lower-stair-preview-ceiling',
    ) as THREE.Mesh;
    const lowerLights = view.group.getObjectByName(
      'lower-stair-preview-lights',
    ) as THREE.Mesh;

    expect(lowerFloor).toBeDefined();
    expect(lowerWalls).toBeDefined();
    expect(lowerCeiling).toBeDefined();
    expect(lowerLights).toBeDefined();
    expect((lowerFloor.material as THREE.Material).name).toBe('preview-carpet');
    expect((lowerWalls.material as THREE.Material).name).toBe('preview-wallpaper');
    stairs.geometry.computeBoundingBox();
    lowerFloor.geometry.computeBoundingBox();
    lowerWalls.geometry.computeBoundingBox();
    lowerCeiling.geometry.computeBoundingBox();
    expect(stairs.geometry.boundingBox?.min.y).toBeCloseTo(-5.2188, 5);
    expect(stairs.geometry.boundingBox?.max.y).toBeCloseTo(0.0012, 5);
    expect(lowerFloor.geometry.boundingBox?.min.y).toBeCloseTo(-5.4, 5);
    expect(lowerWalls.geometry.boundingBox?.min.y).toBeCloseTo(-5.4, 5);
    expect(lowerWalls.geometry.boundingBox?.max.y).toBeCloseTo(0, 5);
    expect(lowerCeiling.geometry.boundingBox?.min.y).toBeCloseTo(-2.66, 5);

    view.dispose();
    Object.values(materials).forEach((material) => material.dispose());
  });
});
