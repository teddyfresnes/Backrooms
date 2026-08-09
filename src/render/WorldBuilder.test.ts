import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { MaterialSet } from './MaterialLibrary';
import { WorldView, createOpenShaftWallGeometries } from './WorldBuilder';
import type {
  EpicStructureFeature,
  EpicStructureIndex,
  GridPitFeature,
  RaisedZoneFeature,
  WorldPlan,
} from '../world/types';
import { rectCenter, rectDepth, rectWidth } from '../world/types';
import {
  EPIC1_PORTAL_HEIGHT,
  applyEpicStructure,
  getEpic1FunnelStoryBounds,
  getEpicAbyssPassageLayout,
  getEpicAbyssRoomPreviewLayout,
  getEpic3BackroomsGalleryLayout,
  getEpicConcourseWalls,
  getEpicGroundObstacles,
  getEpicStairRoomWalls,
  getEpicStairwellLayout,
} from '../world/EpicStructures';

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

const downwardTriangleHeights = (geometry: THREE.BufferGeometry): number[] => {
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const index = geometry.getIndex();
  if (!index) return [];
  const heights: number[] = [];
  for (let offset = 0; offset < index.count; offset += 3) {
    const indices = [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)];
    if (indices.every((vertex) => normals.getY(vertex) < -0.9)) {
      heights.push(indices.reduce((sum, vertex) => sum + positions.getY(vertex), 0) / 3);
    }
  }
  return heights;
};

const horizontalTriangleHeights = (geometry: THREE.BufferGeometry): number[] => {
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const index = geometry.getIndex();
  if (!index) return [];
  const heights: number[] = [];
  for (let offset = 0; offset < index.count; offset += 3) {
    const indices = [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)];
    if (indices.every((vertex) => Math.abs(normals.getY(vertex)) > 0.9)) {
      heights.push(indices.reduce((sum, vertex) => sum + positions.getY(vertex), 0) / 3);
    }
  }
  return heights;
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
    const view = new WorldView(plan, materials);
    const walls = view.group.getObjectByName('merged-wallpaper-walls') as THREE.Mesh;
    expect(downwardTriangleHeights(walls.geometry).some((height) =>
      Math.abs(height) < 1e-5
    )).toBe(false);
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
        {
          id: 'inherited-shaft-enclosure-0-east',
          roomId: 'pit-room',
          x: 4,
          z: 0,
          length: 8,
          orientation: 'z',
          bottom: 0,
          height: 2.74,
          thickness: 0.24,
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
    const enclosureWalls = view.group.getObjectByName('merged-wallpaper-walls') as THREE.Mesh;
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
    const enclosureMaterial = enclosureWalls.material as THREE.MeshStandardMaterial;
    expect(enclosureMaterial.map).toBe(wallpaperTexture);
    expect(enclosureMaterial.map).not.toBe(carpetTexture);
    expect(throughShaft.geometry.getAttribute('position').count).toBe(24);
    expect(enclosureWalls.geometry.getAttribute('position').count).toBe(24);
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
    const ceilingTexture = new THREE.DataTexture(Uint8Array.of(180, 170, 95, 255), 1, 1);
    ceilingTexture.needsUpdate = true;
    materials.ceiling.map = ceilingTexture;
    const view = new WorldView(plan, materials);
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
    const previewCeilingMaterial = (view.group.getObjectByName(
      'upper-story-preview-ceiling',
    ) as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(previewCeilingMaterial.map).toBe(ceilingTexture);
    expect(previewCeilingMaterial.emissiveMap).toBe(ceilingTexture);
    expect(previewCeilingMaterial.fog).toBe(true);

    raycaster.set(new THREE.Vector3(2, 1, 0), new THREE.Vector3(0, 1, 0));
    raycaster.far = 6;
    const solidHits = raycaster.intersectObject(view.group, true);
    expect(solidHits.some((hit) => hit.object.name === 'office-drop-ceiling')).toBe(true);
    expect(solidHits.some((hit) => hit.object.name === 'upper-story-floor-underside-preview')).toBe(true);

    view.dispose();
    ceilingTexture.dispose();
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
    const ceilingMap = new THREE.DataTexture(Uint8Array.of(210, 198, 112, 255), 1, 1);
    ceilingMap.needsUpdate = true;
    materials.ceiling.map = ceilingMap;
    const view = new WorldView(plan, materials);
    const elevatedCeiling = view.group.getObjectByName(
      'elevated-atrium-ceilings',
    ) as THREE.Mesh;
    const elevatedMaterial = elevatedCeiling.material as THREE.MeshStandardMaterial;
    expect(elevatedMaterial.name).toBe('elevated-tiled-ceiling');
    expect(elevatedMaterial.map).toBe(ceilingMap);
    expect(elevatedMaterial.emissiveMap).toBe(ceilingMap);
    expect(elevatedMaterial.lightMap).toBeNull();
    expect(elevatedMaterial.emissive.getHex()).not.toBe(0);
    expect(elevatedMaterial.emissiveIntensity).toBeGreaterThanOrEqual(0.22);
    expect(elevatedMaterial.side).toBe(THREE.DoubleSide);
    expect(elevatedMaterial.fog).toBe(true);
    const raycaster = new THREE.Raycaster();
    raycaster.far = 2.2;
    raycaster.set(new THREE.Vector3(0, 3, 0), new THREE.Vector3(0, 1, 0));
    expect(raycaster.intersectObject(view.group, true)
      .some((hit) => hit.object.name === 'elevated-atrium-ceilings')).toBe(false);

    raycaster.set(new THREE.Vector3(2, 3, 0), new THREE.Vector3(0, 1, 0));
    expect(raycaster.intersectObject(view.group, true)
      .some((hit) => hit.object.name === 'elevated-atrium-ceilings')).toBe(true);

    view.dispose();
    ceilingMap.dispose();
    Object.values(materials).forEach((material) => material.dispose());
  });

  it('keeps textured end caps on fragmented upper shells', () => {
    const plan: WorldPlan = {
      version: 1,
      seed: 'UPPER-SHELL-END-CAP-AUDIT',
      size: 12,
      wallHeight: 2.74,
      rooms: [{
        id: 'high-room',
        bounds: { minX: -3, maxX: 3, minZ: -3, maxZ: 3 },
        kind: 'office',
        level: 0,
        ceilingHeight: 4.8,
        detailDensity: 0,
      }],
      walls: [{
        id: 'upper-fragment',
        roomId: 'high-room',
        x: 0,
        z: 0,
        length: 2,
        orientation: 'x',
        bottom: 2.746,
        height: 2.06,
        thickness: 0.22,
        tint: 1,
        collision: true,
        kind: 'wallpaper',
        detail: 'upper-shell',
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
      spawn: { x: 0, y: 0.865, z: 0 },
    };
    const materials = createTestMaterials();
    const view = new WorldView(plan, materials);
    const walls = view.group.getObjectByName('merged-wallpaper-walls') as THREE.Mesh;
    const ray = new THREE.Raycaster(
      new THREE.Vector3(1.5, 3.5, 0),
      new THREE.Vector3(-1, 0, 0),
      0,
      1,
    );
    expect(ray.intersectObject(walls).length).toBeGreaterThan(0);
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
  it('keeps textured undersides and closes the ends of upper portal fragments', () => {
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
    const view = new WorldView(plan, materials);
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
      expect(Array.from({ length: wallIndex.count }, (_, offset) =>
        Math.abs(wallNormals.getX(wallIndex.getX(offset)))
      ).some((normalX) => normalX > 0.9)).toBe(true);
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

describe('lightmap-free ceiling rendering', () => {
  it('keeps one continuous ceiling without coplanar lighting repair meshes', () => {
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
    const view = new WorldView(plan, materials);
    const ceiling = view.group.getObjectByName('office-drop-ceiling') as THREE.Mesh;
    expect(view.group.getObjectByName('ceiling-lightmap-junction-repairs')).toBeUndefined();
    expect(view.group.getObjectByName('floor-lightmap-junction-repairs')).toBeUndefined();
    expect(ceiling).toBeDefined();
    const positions = ceiling.geometry.getAttribute('position');
    const uvs = ceiling.geometry.getAttribute('uv');
    for (let index = 0; index < positions.count; index += 1) {
      expect(positions.getY(index)).toBeCloseTo(plan.wallHeight, 6);
      expect(uvs.getX(index)).toBeCloseTo((positions.getX(index) / 2.4) * 1.23, 5);
      expect(uvs.getY(index)).toBeCloseTo((positions.getZ(index) / 2.4) * 1.23, 5);
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
    const retainingNormals = retainingWalls.geometry.getAttribute('normal');
    for (let index = 0; index < retainingNormals.count; index += 1) {
      expect(Math.abs(retainingNormals.getY(index))).toBeLessThan(1e-6);
    }
    const retainingWallTopRay = new THREE.Raycaster(
      new THREE.Vector3(7.5, 1, ramp.bounds.maxZ),
      new THREE.Vector3(0, -1, 0),
      0,
      2,
    );
    expect(retainingWallTopRay.intersectObject(retainingWalls)).toHaveLength(0);
    const retainingWallSideRay = new THREE.Raycaster(
      new THREE.Vector3(7.5, -0.3, ramp.bounds.maxZ + 1),
      new THREE.Vector3(0, 0, -1),
      0,
      2,
    );
    expect(retainingWallSideRay.intersectObject(retainingWalls).length).toBeGreaterThan(0);
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
    expect(raisedRetainingWallTopRay.intersectObject(raisedRetainingWalls)).toHaveLength(0);
    const raisedRetainingWallSideRay = new THREE.Raycaster(
      new THREE.Vector3(7.5, 0.3, ramp.bounds.maxZ + 1),
      new THREE.Vector3(0, 0, -1),
      0,
      2,
    );
    expect(raisedRetainingWallSideRay.intersectObject(raisedRetainingWalls).length)
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
          passageStyle: 'wall-breach',
          breachProfile: 'flush',
          passageRects: [
            { minX: -8, maxX: -5, minZ: -0.75, maxZ: 0.75 },
            { minX: -5, maxX: -3, minZ: -2, maxZ: 2 },
          ],
          layout: 'left-turn',
          exitCount: 1,
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
    const stairCeilingTexture = new THREE.DataTexture(Uint8Array.of(120, 110, 60, 255), 1, 1);
    stairCeilingTexture.needsUpdate = true;
    materials.ceiling.map = stairCeilingTexture;
    const view = new WorldView(plan, materials);
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
    const stairUndersides = view.group.getObjectByName(
      'inter-storey-stair-textured-undersides',
    ) as THREE.Mesh;
    const stairCage = view.group.getObjectByName('inter-storey-stair-cages') as THREE.Mesh;
    const stairLights = view.group.getObjectByName('inter-storey-stair-lights');
    const upperFloor = view.group.getObjectByName('upper-stair-preview-floor') as THREE.Mesh;
    const upperUnderside = view.group.getObjectByName(
      'upper-stair-preview-floor-underside',
    ) as THREE.Mesh;
    const upperFloorFascias = view.group.getObjectByName(
      'upper-stair-preview-floor-fascias',
    ) as THREE.Mesh;
    const upperWalls = view.group.getObjectByName(
      'upper-stair-preview-wallpaper-walls',
    ) as THREE.Mesh;
    const upperCeiling = view.group.getObjectByName(
      'upper-stair-preview-ceiling',
    ) as THREE.Mesh;
    const upperLightFrames = view.group.getObjectByName(
      'upper-stair-preview-light-frames',
    ) as THREE.Mesh;
    expect(roof).toBeDefined();
    expect(passageShaft).toBeDefined();
    expect(passageLowerFloor).toBeDefined();
    expect(passageLowerWalls).toBeDefined();
    expect(passageLowerCeiling).toBeDefined();
    expect(view.group.getObjectByName('low-passage-hole-bottoms')).toBeUndefined();
    expect(stairs).toBeDefined();
    expect(stairBodies).toBeDefined();
    expect(stairUndersides).toBeDefined();
    expect(stairCage).toBeDefined();
    expect(stairLights).toBeUndefined();
    expect(upperFloor).toBeDefined();
    expect(upperUnderside).toBeDefined();
    expect(upperFloorFascias).toBeDefined();
    expect(upperWalls).toBeDefined();
    expect(upperCeiling).toBeDefined();
    expect(upperLightFrames).toBeDefined();
    expect((roof.material as THREE.Material).name).toBe('test-wall-zonal');
    expect((passageShaft.material as THREE.Material).name).toBe('lower-storey-wallpaper');
    expect((passageLowerFloor.material as THREE.Material).name).toBe('lower-storey-carpet');
    expect((stairBodies.material as THREE.Material).name).toBe('test-wall-zonal');
    expect((stairUndersides.material as THREE.MeshStandardMaterial).map)
      .toBe(stairCeilingTexture);
    expect((upperFloor.material as THREE.Material).name).toBe('preview-carpet');
    expect((upperWalls.material as THREE.Material).name).toBe('preview-wallpaper');
    roof.geometry.computeBoundingBox();
    passageShaft.geometry.computeBoundingBox();
    passageLowerFloor.geometry.computeBoundingBox();
    passageLowerWalls.geometry.computeBoundingBox();
    passageLowerCeiling.geometry.computeBoundingBox();
    stairs.geometry.computeBoundingBox();
    stairUndersides.geometry.computeBoundingBox();
    stairCage.geometry.computeBoundingBox();
    upperFloor.geometry.computeBoundingBox();
    upperUnderside.geometry.computeBoundingBox();
    upperFloorFascias.geometry.computeBoundingBox();
    upperWalls.geometry.computeBoundingBox();
    upperCeiling.geometry.computeBoundingBox();
    expect(roof.geometry.boundingBox?.min.y).toBeCloseTo(1.4, 5);
    expect(roof.geometry.boundingBox?.min.x).toBeLessThan(-8.01);
    expect(roof.geometry.boundingBox?.max.x).toBeGreaterThan(-2.99);
    expect(roof.geometry.boundingBox?.min.z).toBeLessThan(-2.01);
    expect(roof.geometry.boundingBox?.max.z).toBeGreaterThan(2.01);
    const roofLegRay = new THREE.Raycaster(
      new THREE.Vector3(-7, 1, 0),
      new THREE.Vector3(0, 1, 0),
      0,
      1,
    );
    const emptyBoundingCornerRay = new THREE.Raycaster(
      new THREE.Vector3(-7, 1, 1.5),
      new THREE.Vector3(0, 1, 0),
      0,
      1,
    );
    expect(roofLegRay.intersectObject(roof)).not.toHaveLength(0);
    expect(emptyBoundingCornerRay.intersectObject(roof)).toHaveLength(0);
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
    expect(stairUndersides.geometry.boundingBox?.min.y).toBeLessThan(0);
    expect(stairUndersides.geometry.boundingBox?.max.y).toBeGreaterThan(5.2);
    expect(stairCage.geometry.boundingBox?.max.x).toBeGreaterThan(8.15);
    expect(upperFloor.geometry.boundingBox?.min.y).toBeCloseTo(5.4, 5);
    expect(upperUnderside.geometry.boundingBox?.min.y).toBeCloseTo(5.28, 5);
    expect(upperFloorFascias.geometry.boundingBox?.min.y).toBeCloseTo(5.28, 5);
    expect(upperFloorFascias.geometry.boundingBox?.max.y).toBeCloseTo(5.4, 5);
    expect(upperWalls.geometry.boundingBox?.min.y).toBeCloseTo(5.4, 5);
    expect(upperWalls.geometry.boundingBox?.max.y).toBeCloseTo(8.14, 5);
    expect(upperCeiling.geometry.boundingBox?.min.y).toBeCloseTo(8.14, 5);
    const unsupportedUpperPreviewWallRay = new THREE.Raycaster(
      new THREE.Vector3(-5.5, 4, 0),
      new THREE.Vector3(-1, 0, 0),
      0,
      1,
    );
    expect(unsupportedUpperPreviewWallRay.intersectObject(upperWalls)).toHaveLength(0);
    const bodyIndex = stairBodies.geometry.getIndex();
    const bodyNormals = stairBodies.geometry.getAttribute('normal');
    expect(bodyIndex).not.toBeNull();
    if (bodyIndex) {
      for (let offset = 0; offset < bodyIndex.count; offset += 3) {
        expect(Math.abs(bodyNormals.getY(bodyIndex.getX(offset)))).toBeLessThan(0.5);
      }
    }
    const cageIndex = stairCage.geometry.getIndex();
    const cageNormals = stairCage.geometry.getAttribute('normal');
    expect(cageIndex).not.toBeNull();
    if (cageIndex) {
      for (let offset = 0; offset < cageIndex.count; offset += 3) {
        expect(Math.abs(cageNormals.getY(cageIndex.getX(offset)))).toBeLessThan(0.5);
      }
    }

    view.dispose();
    stairCeilingTexture.dispose();
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
    const lowerCeilingTexture = new THREE.DataTexture(Uint8Array.of(120, 110, 60, 255), 1, 1);
    lowerCeilingTexture.needsUpdate = true;
    materials.ceiling.map = lowerCeilingTexture;
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
    const lowerLightFrames = view.group.getObjectByName(
      'lower-stair-preview-light-frames',
    ) as THREE.Mesh;
    const floorUnderside = view.group.getObjectByName(
      'current-floor-structural-underside',
    ) as THREE.Mesh;
    const arrivalFascias = view.group.getObjectByName(
      'lower-stair-arrival-floor-fascias',
    ) as THREE.Mesh;

    expect(lowerFloor).toBeDefined();
    expect(lowerWalls).toBeDefined();
    expect(lowerCeiling).toBeDefined();
    expect(lowerLights).toBeDefined();
    expect(lowerLightFrames).toBeDefined();
    expect(floorUnderside).toBeDefined();
    expect(arrivalFascias).toBeDefined();
    expect((lowerFloor.material as THREE.Material).name).toBe('preview-carpet');
    expect((lowerWalls.material as THREE.Material).name).toBe('preview-wallpaper');
    expect((lowerCeiling.material as THREE.MeshStandardMaterial).map)
      .toBe(lowerCeilingTexture);
    expect((lowerCeiling.material as THREE.MeshStandardMaterial).side).toBe(THREE.DoubleSide);
    stairs.geometry.computeBoundingBox();
    lowerFloor.geometry.computeBoundingBox();
    lowerWalls.geometry.computeBoundingBox();
    lowerCeiling.geometry.computeBoundingBox();
    floorUnderside.geometry.computeBoundingBox();
    arrivalFascias.geometry.computeBoundingBox();
    expect(stairs.geometry.boundingBox?.min.y).toBeCloseTo(-5.2188, 5);
    expect(stairs.geometry.boundingBox?.max.y).toBeCloseTo(0.0012, 5);
    expect(lowerFloor.geometry.boundingBox?.min.y).toBeCloseTo(-5.4, 5);
    expect(lowerWalls.geometry.boundingBox?.min.y).toBeCloseTo(-5.4, 5);
    expect(lowerWalls.geometry.boundingBox?.max.y).toBeCloseTo(-2.66, 5);
    expect(lowerCeiling.geometry.boundingBox?.min.y).toBeCloseTo(-2.66, 5);
    expect(floorUnderside.geometry.boundingBox?.min.y).toBeCloseTo(-0.12, 5);
    expect(arrivalFascias.geometry.boundingBox?.min.y).toBeCloseTo(-0.12, 5);
    expect(arrivalFascias.geometry.boundingBox?.max.y).toBeCloseTo(0, 5);
    const openingCenter = rectCenter(plan.floorOpenings![0]!);
    const edgeRay = new THREE.Raycaster(
      new THREE.Vector3(openingCenter.x, -0.06, openingCenter.z),
      new THREE.Vector3(1, 0, 0),
      0,
      5,
    );
    expect(edgeRay.intersectObject(arrivalFascias).length).toBeGreaterThan(0);
    const unsupportedLowerPreviewWallRay = new THREE.Raycaster(
      new THREE.Vector3(0, -1, 8),
      new THREE.Vector3(0, 0, 1),
      0,
      1,
    );
    expect(unsupportedLowerPreviewWallRay.intersectObject(lowerWalls)).toHaveLength(0);
    const openingLightRay = new THREE.Raycaster(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, -1, 0),
      0,
      4,
    );
    expect(openingLightRay.intersectObject(lowerLights)).toHaveLength(0);

    view.dispose();
    lowerCeilingTexture.dispose();
    Object.values(materials).forEach((material) => material.dispose());
  });
});

const createEpicPlan = (
  index: EpicStructureIndex,
  seed = `EPIC-${index}-RENDER-AUDIT`,
): WorldPlan => {
  const plan: WorldPlan = {
    version: 1,
    seed,
    size: 112,
    wallHeight: 2.74,
    rooms: [],
    walls: [],
    columns: [],
    solidMasses: [],
    lights: [],
    missingCeilingTiles: [],
    features: [],
    detailSockets: [],
    colliders: [],
    floorRects: [{ minX: -56, maxX: 56, minZ: -56, maxZ: 56 }],
    spawn: { x: 0, y: 0.865, z: -45 },
  };
  applyEpicStructure(plan, index);
  return plan;
};

const createEpicView = (
  index: EpicStructureIndex,
  seed?: string,
  texturedCeiling = false,
): { materials: MaterialSet; plan: WorldPlan; view: WorldView } => {
  const plan = createEpicPlan(index, seed);
  const materials = createTestMaterials();
  if (texturedCeiling) {
    const texture = new THREE.DataTexture(Uint8Array.of(255, 255, 255, 255), 1, 1);
    texture.needsUpdate = true;
    materials.ceiling.map = texture;
  }
  const view = new WorldView(plan, materials);
  return { materials, plan, view };
};

describe('epic structure rendering', () => {
  it('renders epic1 with selective room previews, visible upper stories and layered depth mist', () => {
    const { materials, plan, view } = createEpicView(1);
    const feature = plan.features.find(
      (candidate): candidate is EpicStructureFeature =>
        candidate.kind === 'epic-structure',
    )!;
    const root = view.group.getObjectByName(
      'epic-structure-1-endless-abyss',
    ) as THREE.Group;
    const upperShell = root.getObjectByName('epic-1-upper-shell') as THREE.Mesh;
    const currentWalls = root.getObjectByName(
      'epic-endless-abyss-upper-passage-walls',
    ) as THREE.Mesh;
    const stackedWalls = root.getObjectByName(
      'epic-endless-abyss-stacked-passage-walls',
    ) as THREE.Mesh;
    const storyLedges = root.getObjectByName(
      'epic-endless-abyss-story-ledges',
    ) as THREE.Mesh;
    const corridorPreviews = root.getObjectByName(
      'epic-endless-abyss-corridor-previews',
    ) as THREE.Mesh;
    const currentCorridorWalls = root.getObjectByName(
      'epic-endless-abyss-current-corridor-walls',
    ) as THREE.Mesh;
    const corridorLights = root.getObjectByName(
      'epic-endless-abyss-corridor-lights',
    ) as THREE.Mesh;
    const detailedPreviewFloors = root.getObjectByName(
      'epic-endless-abyss-detailed-preview-floors',
    ) as THREE.Mesh;
    const distantEntryCaps = root.getObjectByName(
      'epic-endless-abyss-distant-entry-caps',
    ) as THREE.Mesh;
    const depthMist = root.getObjectByName(
      'epic-endless-abyss-depth-mist',
    ) as THREE.Mesh;
    const topCeiling = root.getObjectByName(
      'epic-endless-abyss-top-ceiling',
    ) as THREE.Mesh;
    const funnelSupports = root.getObjectByName(
      'epic-endless-abyss-funnel-support-walls',
    ) as THREE.Mesh;
    const currentPortalSoffits = root.getObjectByName(
      'epic-endless-abyss-current-portal-soffits',
    ) as THREE.Mesh;
    const stackedPortalSoffits = root.getObjectByName(
      'epic-endless-abyss-stacked-portal-soffits',
    ) as THREE.Mesh;
    expect(root).toBeDefined();
    expect(upperShell).toBeDefined();
    expect(currentWalls).toBeDefined();
    expect(stackedWalls).toBeDefined();
    expect(storyLedges).toBeDefined();
    expect(corridorPreviews).toBeDefined();
    expect(currentCorridorWalls).toBeDefined();
    expect(corridorLights).toBeDefined();
    expect(detailedPreviewFloors).toBeDefined();
    expect(distantEntryCaps).toBeDefined();
    expect(depthMist).toBeDefined();
    expect(topCeiling).toBeDefined();
    expect(funnelSupports).toBeDefined();
    expect(currentPortalSoffits).toBeDefined();
    expect(stackedPortalSoffits).toBeDefined();
    expect(root.getObjectByName('epic-endless-abyss-shaft')).toBeUndefined();
    expect(root.getObjectByName('epic-endless-abyss-strata')).toBeUndefined();

    upperShell.geometry.computeBoundingBox();
    stackedWalls.geometry.computeBoundingBox();
    storyLedges.geometry.computeBoundingBox();
    corridorPreviews.geometry.computeBoundingBox();
    currentCorridorWalls.geometry.computeBoundingBox();
    depthMist.geometry.computeBoundingBox();
    topCeiling.geometry.computeBoundingBox();
    funnelSupports.geometry.computeBoundingBox();
    currentPortalSoffits.geometry.computeBoundingBox();
    expect(upperShell.geometry.boundingBox?.min.y).toBeCloseTo(plan.wallHeight - 0.04, 5);
    expect(upperShell.geometry.boundingBox?.max.y).toBeCloseTo(5.43, 5);
    expect(stackedWalls.geometry.boundingBox?.min.x).toBeLessThanOrEqual(-54.4);
    expect(stackedWalls.geometry.boundingBox?.max.x).toBeGreaterThanOrEqual(54.4);
    expect(stackedWalls.geometry.boundingBox?.min.z).toBeLessThanOrEqual(-54.4);
    expect(stackedWalls.geometry.boundingBox?.max.z).toBeGreaterThanOrEqual(54.4);
    expect(stackedWalls.geometry.boundingBox?.min.y).toBeLessThan(-85);
    expect(stackedWalls.geometry.boundingBox?.max.y).toBeGreaterThan(20);
    expect(storyLedges.geometry.boundingBox?.min.y).toBeLessThan(-85);
    expect(storyLedges.geometry.boundingBox?.max.y).toBeGreaterThan(20);
    expect(storyLedges.geometry.boundingBox?.min.x).toBeGreaterThanOrEqual(-55.13);
    expect(storyLedges.geometry.boundingBox?.max.x).toBeLessThanOrEqual(55.13);
    expect(storyLedges.geometry.boundingBox?.min.z).toBeGreaterThanOrEqual(-55.13);
    expect(storyLedges.geometry.boundingBox?.max.z).toBeLessThanOrEqual(55.13);
    expect(corridorPreviews.geometry.boundingBox?.min.y).toBeLessThan(-15);
    expect(corridorPreviews.geometry.boundingBox?.max.y).toBeGreaterThan(15);
    expect(currentCorridorWalls.geometry.boundingBox?.min.y).toBeCloseTo(0, 5);
    expect(currentCorridorWalls.geometry.boundingBox?.max.y).toBeCloseTo(EPIC1_PORTAL_HEIGHT, 5);
    expect(horizontalTriangleHeights(currentWalls.geometry)).toHaveLength(0);
    expect(horizontalTriangleHeights(stackedWalls.geometry)).toHaveLength(0);
    expect(horizontalTriangleHeights(currentCorridorWalls.geometry)).toHaveLength(0);
    expect(horizontalTriangleHeights(corridorPreviews.geometry)).toHaveLength(0);
    expect(horizontalTriangleHeights(funnelSupports.geometry)).toHaveLength(0);
    expect(downwardTriangleHeights(currentPortalSoffits.geometry).length).toBeGreaterThan(0);
    expect((currentPortalSoffits.material as THREE.Material).name).toBe('test-wall-zonal');
    expect(currentPortalSoffits.geometry.boundingBox?.min.y)
      .toBeCloseTo(EPIC1_PORTAL_HEIGHT - 0.018, 5);
    const currentFunnel = getEpic1FunnelStoryBounds(feature, 0);
    const firstLowerFunnel = getEpic1FunnelStoryBounds(feature, -5.4);
    const bottomFunnel = getEpic1FunnelStoryBounds(
      feature,
      Math.min(...feature.passageLevels!.map((level) => level.y)),
    );
    expect(firstLowerFunnel.ledgeDepth).toBeLessThan(currentFunnel.ledgeDepth);
    expect(rectWidth(firstLowerFunnel.facadeBounds))
      .toBeLessThan(rectWidth(currentFunnel.facadeBounds));
    expect(rectWidth(firstLowerFunnel.voidBounds))
      .toBeLessThan(rectWidth(currentFunnel.voidBounds));
    expect(rectWidth(bottomFunnel.voidBounds))
      .toBeLessThan(rectWidth(firstLowerFunnel.voidBounds));
    expect(funnelSupports.geometry.boundingBox?.min.y)
      .toBeCloseTo(Math.min(...feature.passageLevels!.map((level) => level.y)), 5);
    expect(depthMist.geometry.boundingBox?.min.y).toBeLessThan(-99);
    expect(depthMist.geometry.boundingBox?.max.y).toBeCloseTo(-17.28, 4);
    expect(depthMist.geometry.getAttribute('position').count).toBe(11 * 4);
    const topLevelY = Math.max(...feature.passageLevels!.map((level) => level.y));
    expect(topCeiling.geometry.boundingBox?.min.y)
      .toBeCloseTo(topLevelY + 5.4, 5);
    const mistMaterial = depthMist.material as THREE.ShaderMaterial;
    expect(mistMaterial.name).toBe('epic-endless-abyss-depth-mist-material');
    expect(mistMaterial.transparent).toBe(true);
    expect(mistMaterial.depthWrite).toBe(false);
    expect(mistMaterial.fragmentShader).toContain('edgeFade');
    expect(mistMaterial.fragmentShader).toContain('fogFbm');
    expect(mistMaterial.fragmentShader).toContain('fogTime');
    view.update(2.5, new THREE.Vector3());
    expect(mistMaterial.uniforms.fogTime?.value).toBe(2.5);
    const roofRay = new THREE.Raycaster(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 1, 0),
      0,
      35,
    );
    expect(roofRay.intersectObject(topCeiling).length).toBeGreaterThan(0);

    const lowerLevel = feature.passageLevels?.find((level) => level.y < 0);
    const lowerPassage = lowerLevel && feature.passageFacadeBounds
      ? [...lowerLevel.passages].sort((left, right) => {
          const distance = (passage: typeof left): number => {
            const portal = passage.side === 'north'
              ? { x: passage.along, z: feature.passageFacadeBounds!.minZ }
              : passage.side === 'south'
                ? { x: passage.along, z: feature.passageFacadeBounds!.maxZ }
                : passage.side === 'west'
                  ? { x: feature.passageFacadeBounds!.minX, z: passage.along }
                  : { x: feature.passageFacadeBounds!.maxX, z: passage.along };
            const horizontal = Math.hypot(
              portal.x - feature.destination.x,
              portal.z - feature.destination.z,
            );
            return horizontal + (horizontal < 8 ? 80 : 0);
          };
          return distance(left) - distance(right);
        })[0]
      : undefined;
    expect(feature.voidBounds).toBeDefined();
    expect(feature.passageFacadeBounds).toBeDefined();
    expect(lowerLevel).toBeDefined();
    expect(lowerPassage).toBeDefined();
    expect(feature.passageLevels?.some((level) => level.y > 20)).toBe(true);
    expect(feature.voidBounds && rectWidth(feature.voidBounds) * rectDepth(feature.voidBounds) / (plan.size * plan.size))
      .toBeGreaterThan(0.9);
    expect(feature.passageLevels?.flatMap((level) => level.passages).every(
      (passage) => passage.width >= 3.4 && passage.corridorDepth <= 1.22,
    )).toBe(true);
    expect(root.getObjectByName('epic-endless-abyss-corridor-floors')).toBeUndefined();
    expect(view.group.getObjectByName('office-drop-ceiling')).toBeUndefined();
    expect(view.group.getObjectByName('elevated-atrium-ceilings')).toBeUndefined();
    expect(view.group.getObjectByName('upper-story-floor-underside-preview')).toBeUndefined();
    expect(view.group.getObjectByName('upper-story-preview-ceiling')).toBeUndefined();
    if (feature.voidBounds && feature.passageFacadeBounds && lowerLevel && lowerPassage) {
      const lowerShell = getEpic1FunnelStoryBounds(feature, lowerLevel.y);
      const previewLayout = getEpicAbyssPassageLayout(
        lowerPassage,
        lowerShell.facadeBounds,
      );
      expect(previewLayout.floorRects).toHaveLength(2);
      expect(previewLayout.ceilingRects).toHaveLength(2);
      expect(previewLayout.wallRects).toHaveLength(5);
      const roomPreviewLayout = getEpicAbyssRoomPreviewLayout(
        lowerPassage,
        lowerShell.facadeBounds,
      );
      expect(roomPreviewLayout.floorRects).toHaveLength(2);
      expect(roomPreviewLayout.wallRects).toHaveLength(6);
      expect(roomPreviewLayout.floorRects.some((rect) =>
        rect.minX < -plan.size * 0.5 || rect.maxX > plan.size * 0.5 ||
        rect.minZ < -plan.size * 0.5 || rect.maxZ > plan.size * 0.5
      )).toBe(true);
      for (let first = 0; first < previewLayout.wallRects.length; first += 1) {
        for (let second = first + 1; second < previewLayout.wallRects.length; second += 1) {
          const left = previewLayout.wallRects[first]!;
          const right = previewLayout.wallRects[second]!;
          const overlapX = Math.min(left.maxX, right.maxX) - Math.max(left.minX, right.minX);
          const overlapZ = Math.min(left.maxZ, right.maxZ) - Math.max(left.minZ, right.minZ);
          expect(overlapX > 1e-5 && overlapZ > 1e-5).toBe(false);
        }
      }
      for (const wall of previewLayout.wallRects) {
        if (lowerPassage.side === 'north') {
          expect(wall.maxZ).toBeLessThanOrEqual(lowerShell.facadeBounds.minZ - 0.18 + 1e-5);
        } else if (lowerPassage.side === 'south') {
          expect(wall.minZ).toBeGreaterThanOrEqual(lowerShell.facadeBounds.maxZ + 0.18 - 1e-5);
        } else if (lowerPassage.side === 'west') {
          expect(wall.maxX).toBeLessThanOrEqual(lowerShell.facadeBounds.minX - 0.18 + 1e-5);
        } else {
          expect(wall.minX).toBeGreaterThanOrEqual(lowerShell.facadeBounds.maxX + 0.18 - 1e-5);
        }
      }
      const shellInnerEdge = plan.size * 0.5;
      expect(previewLayout.wallRects.every((wall) =>
        wall.minX >= -shellInnerEdge && wall.maxX <= shellInnerEdge &&
        wall.minZ >= -shellInnerEdge && wall.maxZ <= shellInnerEdge
      )).toBe(true);
      const entryFloor = previewLayout.floorRects[0]!;
      const branchFloor = previewLayout.floorRects[1]!;
      if (lowerPassage.side === 'north' || lowerPassage.side === 'south') {
        expect(branchFloor.minX < entryFloor.minX || branchFloor.maxX > entryFloor.maxX).toBe(true);
      } else {
        expect(branchFloor.minZ < entryFloor.minZ || branchFloor.maxZ > entryFloor.maxZ).toBe(true);
      }
      const ledgeCenter = new THREE.Vector3(
        0,
        lowerLevel.y + 2,
        (lowerShell.voidBounds.minZ + lowerShell.facadeBounds.minZ) * 0.5,
      );
      const ledgeRay = new THREE.Raycaster(
        ledgeCenter,
        new THREE.Vector3(0, -1, 0),
        0,
        4,
      );
      expect(ledgeRay.intersectObject(storyLedges).length).toBeGreaterThan(0);

      const horizontal = lowerPassage.side === 'north' || lowerPassage.side === 'south';
      const outward = lowerPassage.side === 'north' || lowerPassage.side === 'west' ? -1 : 1;
      const facadeFixed = lowerPassage.side === 'north'
        ? lowerShell.facadeBounds.minZ
        : lowerPassage.side === 'south'
          ? lowerShell.facadeBounds.maxZ
          : lowerPassage.side === 'west'
            ? lowerShell.facadeBounds.minX
            : lowerShell.facadeBounds.maxX;
      const outwardDirection = horizontal
        ? new THREE.Vector3(0, 0, outward)
        : new THREE.Vector3(outward, 0, 0);
      for (const offset of [-lowerPassage.width * 0.24, lowerPassage.width * 0.24]) {
        const previewRay = new THREE.Raycaster(
          horizontal
            ? new THREE.Vector3(lowerPassage.along + offset, lowerLevel.y + 1.6, facadeFixed - outward * 0.42)
            : new THREE.Vector3(facadeFixed - outward * 0.42, lowerLevel.y + 1.6, lowerPassage.along + offset),
          outwardDirection,
          0,
          10,
        );
        expect(previewRay.intersectObject(corridorPreviews).length).toBeGreaterThan(0);
      }
      const corridorFloorRay = new THREE.Raycaster(
        horizontal
          ? new THREE.Vector3(lowerPassage.along, lowerLevel.y + 1, facadeFixed + outward * 0.62)
          : new THREE.Vector3(facadeFixed + outward * 0.62, lowerLevel.y + 1, lowerPassage.along),
        new THREE.Vector3(0, -1, 0),
        0,
        2,
      );
      const floorHits = corridorFloorRay.intersectObject(detailedPreviewFloors);
      expect(floorHits.length).toBeGreaterThan(0);
      expect(new Set(floorHits.map((hit) => hit.object.name)))
        .toEqual(new Set(['epic-endless-abyss-detailed-preview-floors']));
    }

    const down = new THREE.Raycaster(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, -1, 0),
      0,
      100,
    );
    const centralHits = down.intersectObject(view.group, true);
    expect(centralHits.some((hit) => hit.object === depthMist)).toBe(true);
    expect(centralHits.every((hit) => hit.object === depthMist)).toBe(true);

    const passageCount = feature.passageLevels
      ?.reduce((total, level) => total + level.passages.length, 0) ?? 0;
    const currentPassageCount = feature.passageLevels
      ?.find((level) => Math.abs(level.y) < 0.01)?.passages.length ?? 0;
    expect(corridorLights.geometry.getAttribute('position').count)
      .toBeGreaterThan(currentPassageCount * 4);
    expect(corridorLights.geometry.getAttribute('position').count).toBeLessThan(passageCount * 4);
    expect(distantEntryCaps.geometry.getAttribute('position').count).toBeGreaterThan(passageCount * 2);
    expect(downwardTriangleHeights(currentCorridorWalls.geometry)).toHaveLength(0);
    expect(downwardTriangleHeights(corridorPreviews.geometry)).toHaveLength(0);
    const storyFloorYs = new Set(feature.passageLevels?.map((level) => level.y.toFixed(4)));
    expect(downwardTriangleHeights(stackedWalls.geometry).every(
      (height) => !storyFloorYs.has(height.toFixed(4)),
    )).toBe(true);
    expect((corridorPreviews.material as THREE.Material).name).toBe('preview-wallpaper');

    const dispose = vi.spyOn(corridorPreviews.geometry, 'dispose');
    view.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    Object.values(materials).forEach((material) => material.dispose());
  });

  it('renders epic2 as 54 simple pillars under fixtures attached to the giant ceiling', () => {
    const { materials, plan, view } = createEpicView(2, undefined, true);
    const feature = plan.features.find(
      (candidate): candidate is EpicStructureFeature =>
        candidate.kind === 'epic-structure',
    )!;
    const root = view.group.getObjectByName('epic-structure-2-lost-ceiling') as THREE.Group;
    const upperShell = root.getObjectByName('epic-2-upper-shell') as THREE.Mesh;
    const distantCeiling = view.group.getObjectByName(
      'distant-elevated-tiled-ceilings',
    ) as THREE.Mesh;
    const architecturalColumns = view.group.getObjectByName(
      'merged-wallpaper-walls',
    ) as THREE.Mesh;

    expect(root).toBeDefined();
    expect(upperShell).toBeDefined();
    expect(distantCeiling).toBeDefined();
    expect(root.getObjectByName('epic-lost-ceiling-height-rings')).toBeUndefined();
    expect(root.getObjectByName('epic-lost-ceiling-distant-lights')).toBeUndefined();
    expect(getEpicGroundObstacles(feature)).toHaveLength(54);
    expect(plan.columns).toHaveLength(54);
    expect(architecturalColumns.geometry.getAttribute('position').count).toBe(54 * 24);
    expect(plan.lights).toHaveLength(25);
    expect(plan.lights.every((light) => Math.abs(light.ceilingY - 71.965) < 1e-6))
      .toBe(true);
    expect([...new Set(plan.lights.map((light) => light.x))].sort((left, right) => left - right))
      .toEqual([-42, -18, 0, 18, 42]);

    const distantMaterial = distantCeiling.material as THREE.MeshStandardMaterial;
    expect(distantMaterial.name).toBe('distant-tiled-ceiling');
    expect(distantMaterial.map).toBe(materials.ceiling.map);
    expect(distantMaterial.emissiveMap).toBe(materials.ceiling.map);
    expect(distantMaterial.lightMap).toBeNull();
    expect(distantMaterial.side).toBe(THREE.DoubleSide);
    expect(distantMaterial.fog).toBe(true);
    expect(distantMaterial.emissiveIntensity).toBeGreaterThanOrEqual(0.2);

    distantCeiling.geometry.computeBoundingBox();
    expect(distantCeiling.geometry.boundingBox?.min.y).toBeCloseTo(feature.height, 5);
    expect(distantCeiling.geometry.boundingBox?.max.y).toBeCloseTo(feature.height, 5);
    const ceilingUvs = distantCeiling.geometry.getAttribute('uv');
    const uValues = Array.from({ length: ceilingUvs.count }, (_, index) => ceilingUvs.getX(index));
    const visibleRepeatSpan = Math.max(...uValues) - Math.min(...uValues);
    const ordinaryRepeatSpan = rectWidth(feature.bounds) / 2.4;
    expect(visibleRepeatSpan).toBeGreaterThan(0);
    expect(visibleRepeatSpan).toBeLessThan(ordinaryRepeatSpan * 0.3);

    const rayOrigin = new THREE.Vector3(plan.spawn.x, plan.spawn.y, plan.spawn.z);
    const ceilingCenter = new THREE.Vector3(
      rectCenter(feature.bounds).x,
      feature.height,
      rectCenter(feature.bounds).z,
    );
    const ceilingRay = new THREE.Raycaster(
      rayOrigin,
      ceilingCenter.clone().sub(rayOrigin).normalize(),
      0,
      180,
    );
    expect(ceilingRay.intersectObject(distantCeiling).length).toBeGreaterThan(0);

    upperShell.geometry.computeBoundingBox();
    expect(upperShell.geometry.boundingBox?.max.y).toBeCloseTo(72.03, 5);

    view.dispose();
    materials.ceiling.map?.dispose();
    Object.values(materials).forEach((material) => material.dispose());
  });

  it('renders epic3 as a long fissure connected to continuous Backrooms galleries', () => {
    const { materials, plan, view } = createEpicView(3, 'EPIC3-HIGH-0');
    const feature = plan.features.find(
      (candidate): candidate is EpicStructureFeature =>
        candidate.kind === 'epic-structure',
    )!;
    const root = view.group.getObjectByName(
      'epic-structure-3-ascending-passages',
    ) as THREE.Group;
    const facades = root.getObjectByName('epic-ascending-passages-facades') as THREE.Mesh;
    const previews = root.getObjectByName(
      'epic-ascending-passages-corridor-previews',
    ) as THREE.Mesh;
    const previewFloors = root.getObjectByName(
      'epic-ascending-passages-corridor-floors',
    ) as THREE.Mesh;
    const previewCeilings = root.getObjectByName(
      'epic-ascending-passages-corridor-ceilings',
    ) as THREE.Mesh;
    const distantHints = root.getObjectByName(
      'epic-ascending-passages-distant-maze-hints',
    ) as THREE.Mesh;
    const upperFog = root.getObjectByName(
      'epic-ascending-passages-upper-fog',
    ) as THREE.Mesh;
    const lowerFog = root.getObjectByName(
      'epic-ascending-passages-lower-fog',
    ) as THREE.Mesh;

    expect(root).toBeDefined();
    expect(facades).toBeDefined();
    expect(previews).toBeDefined();
    expect(previewFloors).toBeDefined();
    expect(previewCeilings).toBeDefined();
    expect(distantHints).toBeDefined();
    expect(upperFog).toBeDefined();
    expect(lowerFog).toBeDefined();
    expect(root.getObjectByName('epic-ascending-passages-platforms')).toBeUndefined();
    expect(root.getObjectByName('epic-ascending-passages-distant-floor-slivers')).toBeUndefined();
    expect(root.getObjectByName('epic-ascending-passages-dark-openings')).toBeUndefined();
    expect(root.getObjectByName('epic-3-upper-shell')).toBeUndefined();
    expect(view.group.getObjectByName('distant-elevated-tiled-ceilings')).toBeUndefined();
    expect(plan.columns).toHaveLength(0);
    expect(getEpicGroundObstacles(feature)).toHaveLength(0);
    expect(rectWidth(feature.bounds) / rectDepth(feature.bounds)).toBeGreaterThan(7.5);
    expect(rectWidth(feature.bounds)).toBeGreaterThan(220);
    expect(rectDepth(feature.bounds)).toBeCloseTo(29, 5);
    expect(feature.passageFacadeBounds).toBeDefined();
    expect(feature.voidBounds).toBeDefined();
    expect(rectDepth(feature.passageFacadeBounds!)).toBeCloseTo(12, 5);
    expect(rectDepth(feature.voidBounds!)).toBeCloseTo(12, 5);
    expect(plan.floorRects.every((floor) =>
      floor.minX >= feature.bounds.minX - 1e-6 &&
      floor.maxX <= feature.bounds.maxX + 1e-6 &&
      floor.minZ >= feature.bounds.minZ - 1e-6 &&
      floor.maxZ <= feature.bounds.maxZ + 1e-6
    )).toBe(true);
    expect(plan.floorRects.every((floor) =>
      floor.maxZ <= feature.voidBounds!.minZ + 1e-6 ||
      floor.minZ >= feature.voidBounds!.maxZ - 1e-6
    )).toBe(true);
    expect(plan.floorRects).toHaveLength(2);
    expect(plan.floorRects.every((floor) =>
      rectWidth(floor) === rectWidth(feature.bounds) &&
      Math.abs(rectDepth(floor) - 8.5) < 1e-6
    )).toBe(true);

    facades.geometry.computeBoundingBox();
    previews.geometry.computeBoundingBox();
    upperFog.geometry.computeBoundingBox();
    lowerFog.geometry.computeBoundingBox();
    expect(facades.geometry.boundingBox?.max.y).toBeCloseTo(feature.height, 5);
    expect(facades.geometry.boundingBox?.min.y).toBeLessThan(-59);
    expect(previews.geometry.boundingBox?.max.y).toBeLessThan(feature.height);
    expect(previews.geometry.boundingBox?.min.y).toBeCloseTo(0, 5);
    expect(lowerFog.geometry.boundingBox?.min.y).toBeLessThan(-58);
    expect(upperFog.geometry.boundingBox?.max.y).toBeGreaterThan(63);
    expect(upperFog.geometry.getAttribute('position').count).toBe(5 * 4);
    expect(lowerFog.geometry.getAttribute('position').count).toBe(5 * 4);
    const upperFogMaterial = upperFog.material as THREE.ShaderMaterial;
    const lowerFogMaterial = lowerFog.material as THREE.ShaderMaterial;
    expect(upperFogMaterial.transparent).toBe(true);
    expect(upperFogMaterial.fragmentShader).toContain('fogFbm');
    expect(lowerFogMaterial.fragmentShader).toContain('fogFbm');
    expect(upperFogMaterial.uniforms.farOpacity?.value)
      .toBeGreaterThan(lowerFogMaterial.uniforms.farOpacity?.value);

    const levels = feature.passageLevels ?? [];
    expect(levels).toHaveLength(23);
    expect(levels[0]?.y).toBeCloseTo(-59.4, 5);
    expect(levels.at(-1)?.y).toBeCloseTo(59.4, 5);
    const template = levels[0]?.passages;
    expect(template).toHaveLength(34);
    for (const level of levels) {
      expect(level.passages).toEqual(template);
      const north = level.passages.filter((passage) => passage.side === 'north');
      const south = level.passages.filter((passage) => passage.side === 'south');
      expect(north).toHaveLength(17);
      expect(south).toHaveLength(17);
      expect(south.map(({ along, width }) => ({ along, width })))
        .toEqual(north.map(({ along, width }) => ({ along, width })));
      expect(level.passages.every((passage) => {
        const outwardEdge = passage.side === 'north'
          ? feature.passageFacadeBounds!.minZ - passage.corridorDepth
          : feature.passageFacadeBounds!.maxZ + passage.corridorDepth;
        return outwardEdge >= feature.bounds.minZ - 1e-6 &&
          outwardEdge <= feature.bounds.maxZ + 1e-6;
      })).toBe(true);
    }

    const entryY = (feature.entryLevel ?? 0) * 5.4;
    const galleryLevels = levels.filter((level) =>
      Math.abs(level.y) < 0.01 ||
      (
        level.y >= entryY - 4 * 5.4 - 0.01 &&
        level.y <= entryY + 3 * 5.4 + 0.01
      )
    );
    expect(galleryLevels.length).toBeGreaterThanOrEqual(8);
    const galleryLayouts = (['north', 'south'] as const).map((side) =>
      getEpic3BackroomsGalleryLayout(
        template ?? [],
        feature.bounds,
        feature.passageFacadeBounds!,
        side,
      )
    );
    for (const [sideIndex, layout] of galleryLayouts.entries()) {
      expect(layout.floorRects).toHaveLength(1);
      expect(layout.ceilingRects).toHaveLength(1);
      expect(layout.wallRects).toHaveLength(17);
      for (const rect of [...layout.floorRects, ...layout.ceilingRects, ...layout.wallRects]) {
        expect(rect.minX).toBeGreaterThanOrEqual(feature.bounds.minX - 1e-6);
        expect(rect.maxX).toBeLessThanOrEqual(feature.bounds.maxX + 1e-6);
        expect(rect.minZ).toBeGreaterThanOrEqual(feature.bounds.minZ - 1e-6);
        expect(rect.maxZ).toBeLessThanOrEqual(feature.bounds.maxZ + 1e-6);
      }
      const side = sideIndex === 0 ? 'north' : 'south';
      const laneZ = side === 'north'
        ? feature.passageFacadeBounds!.minZ - 2.2
        : feature.passageFacadeBounds!.maxZ + 2.2;
      expect(layout.wallRects.every((wall) => laneZ < wall.minZ || laneZ > wall.maxZ))
        .toBe(true);
      for (const passage of template?.filter((candidate) => candidate.side === side) ?? []) {
        expect(layout.floorRects.some((floor) =>
          passage.along >= floor.minX && passage.along <= floor.maxX &&
          laneZ >= floor.minZ && laneZ <= floor.maxZ
        )).toBe(true);
      }
    }
    const distantPassageCount = levels
      .filter((level) => !galleryLevels.includes(level))
      .reduce((total, level) => total + level.passages.length, 0);
    expect(previews.geometry.getAttribute('position').count)
      .toBe(galleryLevels.length * 2 * 17 * 24);
    expect(previewFloors.geometry.getAttribute('position').count)
      .toBe(galleryLevels.filter((level) => Math.abs(level.y) > 0.01).length * 2 * 24);
    expect(previewCeilings.geometry.getAttribute('position').count)
      .toBe(galleryLevels.length * 2 * 24);
    expect(horizontalTriangleHeights(facades.geometry)).toHaveLength(0);
    expect(horizontalTriangleHeights(previews.geometry)).toHaveLength(0);
    expect(horizontalTriangleHeights(previewFloors.geometry).some((height) =>
      Math.abs(height) < 1e-5
    )).toBe(false);
    expect(distantHints.geometry.getAttribute('position').count).toBe(distantPassageCount * 4);
    expect((distantHints.material as THREE.Material).name).toBe('preview-wallpaper');
    const distantLevel = levels.find((level) => !galleryLevels.includes(level))!;
    const distantPassage = distantLevel.passages.find((passage) => passage.side === 'north')!;
    for (const offset of [-distantPassage.width * 0.42, distantPassage.width * 0.42]) {
      const ray = new THREE.Raycaster(
        new THREE.Vector3(
          distantPassage.along + offset,
          distantLevel.y + 1.6,
          feature.passageFacadeBounds!.minZ + 0.4,
        ),
        new THREE.Vector3(0, 0, -1),
        0,
        3,
      );
      expect(ray.intersectObject(distantHints).length).toBeGreaterThan(0);
    }
    expect(plan.lights.length).toBeGreaterThan(0);
    expect(plan.lights.every((light) =>
      !feature.voidBounds ||
      light.x < feature.voidBounds.minX || light.x > feature.voidBounds.maxX ||
      light.z < feature.voidBounds.minZ || light.z > feature.voidBounds.maxZ
    )).toBe(true);
    expect(plan.lights.every((light) => {
      const rowY = light.level * 5.4;
      return Math.abs(light.ceilingY - (rowY + 3.35)) < 1e-5;
    })).toBe(true);

    expect(feature.destination.y).toBeGreaterThan(1);
    const arrivalFloor = plan.colliders.find(
      (collider) =>
        collider.id.startsWith('epic3-elevated-gallery-floor-') &&
        Math.abs(feature.destination.x - collider.center.x) <= collider.halfExtents.x &&
        Math.abs(feature.destination.z - collider.center.z) <= collider.halfExtents.z,
    );
    const elevatedFacade = plan.colliders.filter((collider) =>
      collider.id.startsWith('epic3-elevated-facade-')
    );
    expect(arrivalFloor).toBeDefined();
    expect(plan.colliders.some((collider) =>
      collider.id.includes('gallery-back') || collider.id.includes('ledge-floor')
    )).toBe(false);
    expect(elevatedFacade.length).toBeGreaterThan(0);
    expect(elevatedFacade.every((collider) =>
      collider.id.includes('-north-') || collider.id.includes('-south-')
    )).toBe(true);
    for (const collider of elevatedFacade) {
      expect(collider.center.y - collider.halfExtents.y)
        .toBeCloseTo((feature.entryLevel ?? 0) * 5.4, 5);
    }
    const northOpeningIsClear = elevatedFacade
      .filter((collider) => collider.id.includes('-north-'))
      .every((collider) =>
        Math.abs(feature.destination.x - collider.center.x) > collider.halfExtents.x + 0.02 ||
        Math.abs(feature.destination.y - collider.center.y) > collider.halfExtents.y + 0.02
      );
    expect(northOpeningIsClear).toBe(true);
    if (arrivalFloor) {
      expect(arrivalFloor.center.y + arrivalFloor.halfExtents.y)
        .toBeCloseTo(feature.destination.y - 0.865, 5);
      expect(Math.abs(feature.destination.x - arrivalFloor.center.x))
        .toBeLessThan(arrivalFloor.halfExtents.x);
      expect(Math.abs(feature.destination.z - arrivalFloor.center.z))
        .toBeLessThan(arrivalFloor.halfExtents.z);
    }

    view.dispose();
    Object.values(materials).forEach((material) => material.dispose());
  });

  it('keeps the infinite epic3 chasm physically enclosed without an opaque shaft mesh', () => {
    const { materials, plan, view } = createEpicView(3, 'EPIC3-BOTTOMLESS');
    const feature = plan.features.find(
      (candidate): candidate is EpicStructureFeature =>
        candidate.kind === 'epic-structure',
    )!;
    const root = view.group.getObjectByName(
      'epic-structure-3-ascending-passages',
    ) as THREE.Group;
    const upperFog = root.getObjectByName('epic-ascending-passages-upper-fog') as THREE.Mesh;
    const lowerFog = root.getObjectByName('epic-ascending-passages-lower-fog') as THREE.Mesh;
    const shaftWalls = plan.colliders.filter((collider) =>
      collider.id.startsWith('epic3-bottomless-shaft-wall-')
    );

    expect(feature.bottomless).toBe(true);
    expect(feature.voidBounds).toBeDefined();
    expect(upperFog).toBeDefined();
    expect(lowerFog).toBeDefined();
    expect(root.getObjectByName('epic-ascending-passages-bottomless-shaft')).toBeUndefined();
    expect(shaftWalls).toHaveLength(4);
    for (const collider of shaftWalls) {
      expect(collider.center.y - collider.halfExtents.y).toBeCloseTo(-64.8, 5);
      expect(collider.center.y + collider.halfExtents.y).toBeCloseTo(0, 5);
    }

    view.dispose();
    Object.values(materials).forEach((material) => material.dispose());
  });

  it('builds epic4 as a compact, fully supported stair tower reaching its summit', () => {
    const { materials, plan, view } = createEpicView(4);
    const feature = plan.features.find(
      (candidate): candidate is EpicStructureFeature =>
        candidate.kind === 'epic-structure',
    )!;
    const layout = getEpicStairwellLayout(feature);
    const root = view.group.getObjectByName('epic-structure-4-impossible-stairwell') as THREE.Group;
    const upperShell = root.getObjectByName('epic-4-upper-shell') as THREE.Mesh;
    const treads = root.getObjectByName('epic4-stair-treads') as THREE.Mesh;
    const slopes = root.getObjectByName('epic4-stair-walkable-slopes') as THREE.Mesh;
    const undersides = root.getObjectByName('epic4-stair-textured-undersides') as THREE.Mesh;
    const stairFascias = root.getObjectByName('epic4-stair-support-skirts') as THREE.Mesh;
    const landingUndersides = root.getObjectByName('epic4-stair-landing-undersides') as THREE.Mesh;
    const landingFascias = root.getObjectByName('epic4-stair-landing-fascias') as THREE.Mesh;
    expect(root).toBeDefined();
    expect(upperShell).toBeDefined();
    expect(treads).toBeDefined();
    expect(slopes).toBeDefined();
    expect(stairFascias).toBeDefined();
    expect(undersides).toBeDefined();
    expect(landingUndersides).toBeDefined();
    expect(landingFascias).toBeDefined();
    expect(root.getObjectByName('epic4-stair-textured-balustrades')).toBeDefined();
    expect(root.getObjectByName('epic4-stair-landings-and-summit')).toBeDefined();
    expect(root.getObjectByName('epic4-stair-guardrails')).toBeDefined();
    expect(root.getObjectByName('epic4-upper-maze-walls')).toBeDefined();
    expect(root.getObjectByName('epic4-upper-maze-ceiling')).toBeDefined();
    expect(root.getObjectByName('epic-impossible-stairwell-floating-flights')).toBeUndefined();

    treads.geometry.computeBoundingBox();
    slopes.geometry.computeBoundingBox();
    upperShell.geometry.computeBoundingBox();
    expect(treads.geometry.boundingBox!.min.y).toBeLessThan(0.1);
    expect(treads.geometry.boundingBox!.max.y).toBeCloseTo(layout.summitY, 5);
    expect(slopes.geometry.boundingBox!.min.y).toBeCloseTo(0.004, 5);
    expect(slopes.geometry.boundingBox!.max.y).toBeCloseTo(layout.summitY + 0.004, 5);
    undersides.geometry.computeBoundingBox();
    expect(undersides.geometry.boundingBox!.min.y).toBeCloseTo(-0.18, 5);
    expect(undersides.geometry.boundingBox!.max.y).toBeCloseTo(layout.summitY - 0.18, 5);
    expect((undersides.material as THREE.Material).name).toBe('lower-storey-wallpaper');
    const fasciaPositions = stairFascias.geometry.getAttribute('position');
    expect(fasciaPositions.count).toBe(layout.flights.length * 2 * 4);
    for (let offset = 0; offset < fasciaPositions.count; offset += 4) {
      expect(fasciaPositions.getY(offset + 2) - fasciaPositions.getY(offset + 1))
        .toBeCloseTo(0.188, 5);
      expect(fasciaPositions.getY(offset + 3) - fasciaPositions.getY(offset))
        .toBeCloseTo(0.188, 5);
    }
    expect((stairFascias.material as THREE.Material).name).toBe('lower-storey-wallpaper');
    const landingNormals = landingUndersides.geometry.getAttribute('normal');
    expect(Array.from({ length: landingNormals.count }, (_, index) => landingNormals.getY(index))
      .every((normalY) => normalY < -0.9)).toBe(true);
    expect((landingUndersides.material as THREE.Material).name).toBe('lower-storey-ceiling');
    expect(downwardTriangleHeights(landingFascias.geometry)).toHaveLength(0);
    expect((landingFascias.material as THREE.Material).name).toBe('lower-storey-wallpaper');
    expect(upperShell.geometry.boundingBox!.min.y).toBeCloseTo(0, 5);
    expect(upperShell.geometry.boundingBox!.max.y).toBeCloseTo(feature.height, 5);

    expect(rectWidth(feature.bounds)).toBeCloseTo(19.2, 5);
    expect(rectDepth(feature.bounds)).toBeCloseTo(19.2, 5);
    expect(plan.floorRects).toEqual([{ minX: -56, maxX: 56, minZ: -56, maxZ: 56 }]);
    expect(layout.flights).toHaveLength(24);
    expect(layout.summitY).toBeCloseTo(57.6, 5);
    expect(layout.summitRects.some((rect) =>
      rect.minX < layout.summitOpening.maxX &&
      rect.maxX > layout.summitOpening.minX &&
      rect.minZ < layout.summitOpening.maxZ &&
      rect.maxZ > layout.summitOpening.minZ
    )).toBe(false);
    expect(layout.upperFloorRects).toHaveLength(2);
    expect(layout.upperWalls).toHaveLength(6);
    const shellWalls = getEpicStairRoomWalls(feature);
    expect(shellWalls.filter((wall) => wall.bottom === 0).length).toBeGreaterThanOrEqual(8);
    expect(shellWalls.some((wall) => wall.bottom >= layout.summitY)).toBe(true);
    expect(plan.colliders.filter((collider) => collider.id.startsWith('epic4-stair-flight-') && !collider.id.endsWith('guard')))
      .toHaveLength(layout.flights.length);
    expect(plan.colliders.filter((collider) => collider.id.startsWith('epic4-stair-flight-') && collider.rotation))
      .toHaveLength(layout.flights.length);

    const obstacles = getEpicGroundObstacles(feature);
    expect(obstacles.map((obstacle) => obstacle.id)).toEqual(['stairwell-core']);
    const architecturalColumns = view.group.getObjectByName(
      'merged-wallpaper-walls',
    ) as THREE.Mesh;
    expect(architecturalColumns.geometry.getAttribute('position').count)
      .toBe(obstacles.length * 24);
    expect(root.getObjectByName('epic-4-ground-obstacles'))
      .toBeUndefined();

    view.dispose();
    Object.values(materials).forEach((material) => material.dispose());
  });

  it('builds epic5 as a clean liminal concourse with aligned thresholds and attached lights', () => {
    const { materials, plan, view } = createEpicView(5, 'EPIC5-CONCOURSE-AUDIT', true);
    const feature = plan.features.find(
      (candidate): candidate is EpicStructureFeature => candidate.kind === 'epic-structure',
    )!;
    const root = view.group.getObjectByName('epic-structure-5-vanishing-concourse') as THREE.Group;
    const upperShell = root.getObjectByName('epic-5-upper-shell') as THREE.Mesh;
    const architecturalWalls = view.group.getObjectByName('merged-wallpaper-walls') as THREE.Mesh;
    const ceiling = view.group.getObjectByName('elevated-atrium-ceilings') as THREE.Mesh;
    const fixtures = view.group.getObjectByName('instanced-luminous-ceiling-tiles') as THREE.InstancedMesh;
    expect(root).toBeDefined();
    expect(upperShell).toBeDefined();
    expect(architecturalWalls).toBeDefined();
    expect(ceiling).toBeDefined();
    expect(fixtures).toBeDefined();
    expect(root.getObjectByName('epic-light-cathedral-vault-ribs')).toBeUndefined();
    expect(root.getObjectByName('epic-light-cathedral-fluorescent-nave')).toBeUndefined();

    architecturalWalls.geometry.computeBoundingBox();
    ceiling.geometry.computeBoundingBox();
    upperShell.geometry.computeBoundingBox();
    expect(architecturalWalls.geometry.boundingBox!.min.y).toBeCloseTo(0, 5);
    expect(architecturalWalls.geometry.boundingBox!.max.y).toBeCloseTo(feature.height, 5);
    expect(ceiling.geometry.boundingBox!.min.y).toBeCloseTo(feature.height, 5);
    expect(ceiling.geometry.boundingBox!.max.y).toBeCloseTo(feature.height, 5);
    expect(upperShell.geometry.boundingBox!.min.y).toBeCloseTo(plan.wallHeight - 0.04, 5);
    expect(upperShell.geometry.boundingBox!.max.y).toBeCloseTo(feature.height + 0.03, 5);

    const walls = getEpicConcourseWalls(feature);
    expect(walls).toHaveLength(28);
    const fullHeightPiers = walls.filter((wall) => wall.bottom === 0);
    for (const x of [-33, -11, 11, 33]) {
      const line = fullHeightPiers.filter((wall) => wall.x === x);
      expect(Math.min(...line.map((wall) => wall.z - wall.length * 0.5)))
        .toBeCloseTo(feature.bounds.minZ + 0.24, 5);
      expect(Math.max(...line.map((wall) => wall.z + wall.length * 0.5)))
        .toBeCloseTo(feature.bounds.maxZ - 0.24, 5);
    }
    expect(plan.walls).toEqual(walls);
    expect(plan.columns).toHaveLength(0);
    const obstacles = getEpicGroundObstacles(feature);
    expect(obstacles).toHaveLength(0);
    expect(architecturalWalls.geometry.getAttribute('position').count).toBe(walls.length * 24);
    expect(plan.colliders.filter((collider) => collider.id.startsWith('collider-epic5-concourse-')))
      .toHaveLength(walls.length);

    for (const x of [-33, -11, 11, 33]) {
      for (const z of [-28, 0, 28]) {
        expect(plan.colliders.some((collider) =>
          collider.id.startsWith('collider-epic5-concourse-') &&
          Math.abs(x - collider.center.x) <= collider.halfExtents.x &&
          Math.abs(1.8 - collider.center.y) <= collider.halfExtents.y &&
          Math.abs(z - collider.center.z) <= collider.halfExtents.z
        )).toBe(false);
      }
    }

    expect(plan.lights).toHaveLength(25);
    expect(plan.lights.every((light) =>
      light.ceilingY === feature.height - 0.035 &&
      !light.dead &&
      !light.unstable
    )).toBe(true);
    const fixtureMatrix = new THREE.Matrix4();
    const fixturePosition = new THREE.Vector3();
    for (let index = 0; index < fixtures.count; index += 1) {
      fixtures.getMatrixAt(index, fixtureMatrix);
      fixturePosition.setFromMatrixPosition(fixtureMatrix);
      expect(fixturePosition.y).toBeCloseTo(feature.height - 0.071, 5);
    }

    view.dispose();
    materials.ceiling.map?.dispose();
    Object.values(materials).forEach((material) => material.dispose());
  });
});
