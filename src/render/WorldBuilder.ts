import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MaterialSet } from './MaterialLibrary';
import type { RuntimeLightSource } from './LocalLightRig';
import {
  bakedLightMapJunctionNeedsRepair,
  bakedLightMapTexelSize,
  createBakedLightMaps,
  createBakedMaterialSet,
  ensureBakedLightUv,
} from './BakedLighting';
import type { BakedLightMapData, BakedLightMaps } from './BakedLighting';
import { createGraffitiMesh, selectWallGraffiti } from './WallGraffiti';
import { WorldPropLayer } from './WorldProps';
import type {
  GridPitFeature,
  LightSlot,
  RaisedZoneFeature,
  Rect,
  StairSocketFeature,
  Vec3Data,
  VistaFeature,
  WallSegment,
  WorldPlan,
  RoomKind,
  SqueezeViewFeature,
  SurfaceStyle,
} from '../world/types';
import { INFINITE_STORY_PITCH, getInfiniteChunkCeilingOpenings } from '../world/InfiniteWorld';
import { getStairSlabs, STAIR_STORY_RISE } from '../world/StairLayout';
import { pointInRect, rectCenter, rectDepth, rectWidth } from '../world/types';

const setGeometryTint = (geometry: THREE.BufferGeometry, tint: number): void => {
  const count = geometry.getAttribute('position').count;
  const color = new THREE.Color().setRGB(tint, tint, tint);
  const values = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    values[index * 3] = color.r;
    values[index * 3 + 1] = color.g;
    values[index * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(values, 3));
};

const removeHorizontalCaps = <T extends THREE.BufferGeometry>(geometry: T): T => {
  const index = geometry.getIndex();
  const normals = geometry.getAttribute('normal');
  if (!index || !normals) return geometry;
  const verticalFaceIndices: number[] = [];
  for (let offset = 0; offset < index.count; offset += 3) {
    const first = index.getX(offset);
    if (Math.abs(normals.getY(first)) < 0.5) {
      verticalFaceIndices.push(first, index.getX(offset + 1), index.getX(offset + 2));
    }
  }
  geometry.setIndex(verticalFaceIndices);
  geometry.clearGroups();
  return geometry;
};

const createWallGeometry = (
  wall: WallSegment,
  capless = false,
  patternScale = 1,
): THREE.BoxGeometry => {
  const alongX = wall.orientation === 'x';
  const geometry = new THREE.BoxGeometry(
    alongX ? wall.length : wall.thickness,
    wall.height,
    alongX ? wall.thickness : wall.length,
  );
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  const normals = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const uScale = Math.max(0.24, wall.length / 2.05) * patternScale;
  const vScale = Math.max(0.2, wall.height / 2.45) * patternScale;
  const worldVOffset = (wall.bottom / 2.45) * patternScale;
  for (let index = 0; index < uv.count; index += 1) {
    const verticalFace = Math.abs(normals.getY(index)) < 0.5;
    uv.setXY(
      index,
      uv.getX(index) * uScale,
      uv.getY(index) * vScale + (verticalFace ? worldVOffset : 0),
    );
  }
  if (capless) removeHorizontalCaps(geometry);
  geometry.translate(wall.x, wall.bottom + wall.height * 0.5, wall.z);
  setGeometryTint(geometry, wall.tint);
  return geometry;
};

const wallNeedsOpenVerticalShell = (wall: WallSegment): boolean =>
  wall.detail === 'upper-shell' ||
  wall.id.includes('inherited-shaft-') ||
  wall.id.includes('ceiling-shaft-collar-');

const createTexturedBoxGeometry = (
  width: number,
  height: number,
  depth: number,
  x: number,
  bottom: number,
  z: number,
  tint = 1,
  patternScale = 1,
): THREE.BoxGeometry => {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  const faceScales: Array<[number, number]> = [
    [depth / 2.05, height / 2.45],
    [depth / 2.05, height / 2.45],
    [width / 2.05, depth / 2.05],
    [width / 2.05, depth / 2.05],
    [width / 2.05, height / 2.45],
    [width / 2.05, height / 2.45],
  ];
  for (let face = 0; face < 6; face += 1) {
    const [baseUScale, baseVScale] = faceScales[face]!;
    const uScale = baseUScale * patternScale;
    const vScale = baseVScale * patternScale;
    for (let vertex = 0; vertex < 4; vertex += 1) {
      const index = face * 4 + vertex;
      uv.setXY(index, uv.getX(index) * uScale, uv.getY(index) * vScale);
    }
  }
  geometry.translate(x, bottom + height * 0.5, z);
  setGeometryTint(geometry, tint);
  return geometry;
};

/**
 * Builds four thin, capless shaft walls. Keeping both vertical sides opaque
 * prevents back-face holes from the room below, while removing horizontal
 * caps avoids a raised kerb and coplanar blinking at either end.
 */
export const createOpenShaftWallGeometries = (
  hole: Rect,
  bottom: number,
  top: number,
  tint: number,
  patternScale = 1,
): THREE.BoxGeometry[] => {
  const height = top - bottom;
  if (height <= 0) return [];
  const width = rectWidth(hole);
  const depth = rectDepth(hole);
  const center = rectCenter(hole);
  const thickness = Math.min(0.12, Math.max(0.075, Math.min(width, depth) * 0.025));
  const walls: WallSegment[] = [
    {
      id: 'open-shaft-north',
      x: center.x,
      z: hole.minZ - thickness * 0.5,
      length: width + thickness * 2,
      orientation: 'x',
      bottom,
      height,
      thickness,
      tint,
      collision: false,
      kind: 'wallpaper',
    },
    {
      id: 'open-shaft-south',
      x: center.x,
      z: hole.maxZ + thickness * 0.5,
      length: width + thickness * 2,
      orientation: 'x',
      bottom,
      height,
      thickness,
      tint,
      collision: false,
      kind: 'wallpaper',
    },
    {
      id: 'open-shaft-west',
      x: hole.minX - thickness * 0.5,
      z: center.z,
      length: depth + thickness * 2,
      orientation: 'z',
      bottom,
      height,
      thickness,
      tint,
      collision: false,
      kind: 'wallpaper',
    },
    {
      id: 'open-shaft-east',
      x: hole.maxX + thickness * 0.5,
      z: center.z,
      length: depth + thickness * 2,
      orientation: 'z',
      bottom,
      height,
      thickness,
      tint,
      collision: false,
      kind: 'wallpaper',
    },
  ];
  // Thin capless boxes expose a textured face from either side. Single planes
  // disappeared when the player looked obliquely at a hole from the room below.
  return walls.map((wall) => createWallGeometry(wall, true, patternScale));
};

const createFloorGeometry = (
  rects: Rect[],
  y = 0,
  patternScale = 1,
  quarterTurn = false,
): THREE.BufferGeometry => {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const rect of rects) {
    const offset = positions.length / 3;
    positions.push(
      rect.minX, y, rect.minZ,
      rect.maxX, y, rect.minZ,
      rect.maxX, y, rect.maxZ,
      rect.minX, y, rect.maxZ,
    );
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    const textureCoords = (
      x: number,
      z: number,
    ): [number, number] => quarterTurn
      ? [(z / 2.15) * patternScale, (-x / 2.15) * patternScale]
      : [(x / 2.15) * patternScale, (z / 2.15) * patternScale];
    uvs.push(
      ...textureCoords(rect.minX, rect.minZ),
      ...textureCoords(rect.maxX, rect.minZ),
      ...textureCoords(rect.maxX, rect.maxZ),
      ...textureCoords(rect.minX, rect.maxZ),
    );
    indices.push(offset, offset + 2, offset + 1, offset, offset + 3, offset + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};

const createSlopedSurfaceGeometry = (
  elevation: number,
  ramp: RaisedZoneFeature['ramp'],
): THREE.BufferGeometry => {
  const { bounds, axis, riseDirection } = ramp;
  const yAt = (x: number, z: number): number => {
    const progress = axis === 'x'
      ? (x - bounds.minX) / Math.max(1e-6, rectWidth(bounds))
      : (z - bounds.minZ) / Math.max(1e-6, rectDepth(bounds));
    return elevation * (riseDirection > 0 ? progress : 1 - progress);
  };
  const corners = [
    [bounds.minX, bounds.minZ],
    [bounds.maxX, bounds.minZ],
    [bounds.maxX, bounds.maxZ],
    [bounds.minX, bounds.maxZ],
  ] as const;
  const positions = corners.flatMap(([x, z]) => [x, yAt(x, z) + 0.004, z]);
  const uvs = corners.flatMap(([x, z]) => [x / 2.15, z / 2.15]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex([0, 2, 1, 0, 3, 2]);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};

const createRampSurfaceGeometry = (feature: RaisedZoneFeature): THREE.BufferGeometry =>
  createSlopedSurfaceGeometry(feature.elevation, feature.ramp);

const intersectRects = (left: Rect, right: Rect): Rect | null => {
  const intersection: Rect = {
    minX: Math.max(left.minX, right.minX),
    maxX: Math.min(left.maxX, right.maxX),
    minZ: Math.max(left.minZ, right.minZ),
    maxZ: Math.min(left.maxZ, right.maxZ),
  };
  return intersection.maxX - intersection.minX > 1e-4 && intersection.maxZ - intersection.minZ > 1e-4
    ? intersection
    : null;
};

const rectsTouchOrOverlap = (left: Rect, right: Rect): boolean =>
  left.minX <= right.maxX + 1e-4 &&
  left.maxX >= right.minX - 1e-4 &&
  left.minZ <= right.maxZ + 1e-4 &&
  left.maxZ >= right.minZ - 1e-4;

/**
 * Covers only the rare half-texel junctions where an off-grid partition makes
 * the shared XZ lightmap sample the hidden space under the wall. The patch
 * keeps the visible texture coordinates unchanged, but projects its lightmap
 * lookup outward on each side so a bright room never borrows from a dark one.
 */
const createHorizontalJunctionRepairGeometry = (
  walls: readonly WallSegment[],
  clipRects: readonly Rect[],
  worldSize: number,
  wallHeight: number,
  surface: 'floor' | 'ceiling',
): THREE.BufferGeometry | null => {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const lightMapUvs: number[] = [];
  const indices: number[] = [];
  const halfWorld = worldSize * 0.5;
  const texelSize = bakedLightMapTexelSize(worldSize);
  const repairWidth = texelSize * 1.05;
  const y = surface === 'floor' ? 0.002 : wallHeight - 0.002;
  const normalY = surface === 'floor' ? 1 : -1;

  const addPatch = (rect: Rect, wall: WallSegment, side: -1 | 1): void => {
    const offset = positions.length / 3;
    const corners = [
      [rect.minX, rect.minZ],
      [rect.maxX, rect.minZ],
      [rect.maxX, rect.maxZ],
      [rect.minX, rect.maxZ],
    ] as const;
    const halfLength = wall.length * 0.5;
    const alongMin = (wall.orientation === 'x' ? wall.x : wall.z) - halfLength;
    const alongMax = (wall.orientation === 'x' ? wall.x : wall.z) + halfLength;
    const endInset = Math.min(texelSize * 0.5, wall.length * 0.5);
    const fixed = wall.orientation === 'x' ? wall.z : wall.x;
    const sampleFixed = fixed + side * (wall.thickness * 0.5 + repairWidth);

    for (const [x, z] of corners) {
      positions.push(x, y, z);
      normals.push(0, normalY, 0);
      if (surface === 'floor') {
        uvs.push(x / 2.15, z / 2.15);
      } else {
        uvs.push((x + halfWorld) / 2.4, (z + halfWorld) / 2.4);
      }
      const along = THREE.MathUtils.clamp(
        wall.orientation === 'x' ? x : z,
        alongMin + endInset,
        alongMax - endInset,
      );
      const sampleX = wall.orientation === 'x' ? along : sampleFixed;
      const sampleZ = wall.orientation === 'x' ? sampleFixed : along;
      lightMapUvs.push(
        THREE.MathUtils.clamp((sampleX + halfWorld) / worldSize, 0, 1),
        THREE.MathUtils.clamp((sampleZ + halfWorld) / worldSize, 0, 1),
      );
    }
    if (surface === 'floor') {
      indices.push(offset, offset + 2, offset + 1, offset, offset + 3, offset + 2);
    } else {
      indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
    }
  };

  for (const wall of walls) {
    if (wall.bottom < -1 || wall.height <= 1.2) continue;
    const touchesSurface = surface === 'floor'
      ? wall.bottom <= 0.02
      : wall.bottom + wall.height >= wallHeight - 0.02;
    if (!touchesSurface) continue;
    const fixed = wall.orientation === 'x' ? wall.z : wall.x;
    if (!bakedLightMapJunctionNeedsRepair(fixed, wall.thickness, worldSize)) continue;

    const halfLength = wall.length * 0.5;
    const halfThickness = wall.thickness * 0.5;
    for (const side of [-1, 1] as const) {
      const inner = fixed + side * halfThickness;
      const outer = inner + side * repairWidth;
      const strip: Rect = wall.orientation === 'x'
        ? {
            minX: wall.x - halfLength,
            maxX: wall.x + halfLength,
            minZ: Math.min(inner, outer),
            maxZ: Math.max(inner, outer),
          }
        : {
            minX: Math.min(inner, outer),
            maxX: Math.max(inner, outer),
            minZ: wall.z - halfLength,
            maxZ: wall.z + halfLength,
          };
      for (const clip of clipRects) {
        const clipped = intersectRects(strip, clip);
        if (clipped) addPatch(clipped, wall, side);
      }
    }
  }

  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('uv1', new THREE.Float32BufferAttribute(lightMapUvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};

const createCeilingGeometry = (
  rect: Rect,
  y: number,
  patternScale = 1,
): THREE.PlaneGeometry => {
  const width = rectWidth(rect);
  const depth = rectDepth(rect);
  const center = rectCenter(rect);
  const geometry = new THREE.PlaneGeometry(width, depth);
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  for (let index = 0; index < uv.count; index += 1) {
    uv.setXY(
      index,
      uv.getX(index) * (width / 2.4) * patternScale,
      uv.getY(index) * (depth / 2.4) * patternScale,
    );
  }
  geometry.rotateX(Math.PI * 0.5);
  geometry.translate(center.x, y, center.z);
  return geometry;
};

const cellsAroundHoles = (bounds: Rect, holes: Rect[]): Rect[] => {
  const xValues = [...new Set([bounds.minX, bounds.maxX, ...holes.flatMap((hole) => [hole.minX, hole.maxX])])].sort(
    (a, b) => a - b,
  );
  const zValues = [...new Set([bounds.minZ, bounds.maxZ, ...holes.flatMap((hole) => [hole.minZ, hole.maxZ])])].sort(
    (a, b) => a - b,
  );
  const cells: Rect[] = [];
  for (let xIndex = 0; xIndex < xValues.length - 1; xIndex += 1) {
    for (let zIndex = 0; zIndex < zValues.length - 1; zIndex += 1) {
      const cell: Rect = {
        minX: xValues[xIndex]!,
        maxX: xValues[xIndex + 1]!,
        minZ: zValues[zIndex]!,
        maxZ: zValues[zIndex + 1]!,
      };
      const center = rectCenter(cell);
      if (!holes.some((hole) => pointInRect(center.x, center.z, hole))) cells.push(cell);
    }
  }
  return cells;
};

const mergeOrSingle = (geometries: THREE.BufferGeometry[]): THREE.BufferGeometry | null => {
  if (geometries.length === 0) return null;
  if (geometries.length === 1) return geometries[0]!;
  return mergeGeometries(geometries, false);
};

const makeMesh = (
  geometry: THREE.BufferGeometry | null,
  material: THREE.Material,
  name: string,
  parent: THREE.Object3D,
): THREE.Mesh | null => {
  if (!geometry) return null;
  ensureBakedLightUv(geometry, material);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  parent.add(mesh);
  return mesh;
};

const createPreviewMaterial = (
  source: THREE.MeshStandardMaterial,
  name: string,
  emissive: number,
  emissiveIntensity: number,
): THREE.MeshStandardMaterial => {
  const material = source.clone();
  material.name = name;
  material.lightMap = null;
  material.emissive.setHex(emissive);
  material.emissiveIntensity = Math.max(material.emissiveIntensity, emissiveIntensity);
  material.needsUpdate = true;
  return material;
};

export interface WorldViewOptions {
  createLightRig?: boolean;
  bakedLightMaps?: BakedLightMapData;
}

export interface WorldInteraction {
  label: string;
  path: Vec3Data[];
  duration: number;
  duckDepth: number;
}

const DEFAULT_SURFACE_STYLE: SurfaceStyle = {
  wallTint: 1,
  floorTint: 1,
  ceilingTint: 1,
  wallPatternScale: 1,
  floorPatternScale: 1,
  ceilingPatternScale: 1,
  floorQuarterTurn: false,
};

export class WorldView {
  readonly group = new THREE.Group();
  readonly ready: Promise<void>;
  private readonly emitterMesh: THREE.InstancedMesh;
  private readonly fixtureSlots: LightSlot[];
  private readonly previewMaterials: Pick<
    MaterialSet,
    'wall' | 'floor' | 'ceiling' | 'baseboard' | 'pitWall'
  >;
  private readonly materials: MaterialSet;
  private readonly bakedLightMaps: BakedLightMaps;
  private readonly ownedMaterials: THREE.MeshStandardMaterial[];
  private readonly graffitiTextures: THREE.CanvasTexture[] = [];
  private readonly graffitiMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly surfaceStyle: SurfaceStyle;
  private readonly propLayer: WorldPropLayer;

  constructor(
    readonly plan: WorldPlan,
    sourceMaterials: MaterialSet,
    options: WorldViewOptions = {},
  ) {
    this.group.name = `world-${plan.seed}`;
    this.bakedLightMaps = createBakedLightMaps(plan, options.bakedLightMaps);
    const baked = createBakedMaterialSet(sourceMaterials, this.bakedLightMaps, plan.size);
    this.materials = baked.materials;
    this.ownedMaterials = baked.ownedMaterials;
    this.surfaceStyle = plan.surfaceStyle ?? DEFAULT_SURFACE_STYLE;
    this.materials.wall.color.multiplyScalar(this.surfaceStyle.wallTint);
    this.materials.plaster.color.multiplyScalar(this.surfaceStyle.wallTint);
    this.materials.floor.color.multiplyScalar(this.surfaceStyle.floorTint);
    this.materials.ceiling.color.multiplyScalar(this.surfaceStyle.ceilingTint);
    this.materials.baseboard.color.multiplyScalar(
      (this.surfaceStyle.wallTint + this.surfaceStyle.floorTint) * 0.5,
    );
    const previewGlow = plan.visualBiome === 'red'
      ? {
          wall: 0x6f0906,
          floor: 0x510604,
          ceiling: 0x790c08,
          baseboard: 0x4e0504,
          pitWall: 0x3d0403,
        }
      : plan.visualBiome === 'white'
        ? {
            wall: 0x465052,
            floor: 0x3b4446,
            ceiling: 0x566165,
            baseboard: 0x3d4547,
            pitWall: 0x343b3d,
          }
        : {
            wall: 0x77713a,
            floor: 0x686331,
            ceiling: 0x918743,
            baseboard: 0x5f592b,
            pitWall: 0x504923,
          };
    this.previewMaterials = {
      wall: createPreviewMaterial(sourceMaterials.wall, 'preview-wallpaper', previewGlow.wall, 0.13),
      floor: createPreviewMaterial(sourceMaterials.floor, 'preview-carpet', previewGlow.floor, 0.09),
      ceiling: createPreviewMaterial(sourceMaterials.ceiling, 'preview-ceiling', previewGlow.ceiling, 0.16),
      baseboard: createPreviewMaterial(sourceMaterials.baseboard, 'preview-baseboard', previewGlow.baseboard, 0.1),
      pitWall: createPreviewMaterial(sourceMaterials.pitWall, 'preview-pit-wall', previewGlow.pitWall, 0.11),
    };
    this.previewMaterials.wall.color.multiplyScalar(this.surfaceStyle.wallTint);
    this.previewMaterials.floor.color.multiplyScalar(this.surfaceStyle.floorTint);
    this.previewMaterials.ceiling.color.multiplyScalar(this.surfaceStyle.ceilingTint);
    this.previewMaterials.baseboard.color.multiplyScalar(this.surfaceStyle.wallTint);
    this.previewMaterials.pitWall.color.multiplyScalar(this.surfaceStyle.wallTint);
    this.ownedMaterials.push(...Object.values(this.previewMaterials));
    this.fixtureSlots = plan.lights;
    this.buildArchitecture();
    this.buildWallGraffiti();
    this.buildRaisedZones();
    this.buildLowPassages();
    this.emitterMesh = this.buildFixtures();
    this.buildPitFeatures();
    this.buildStairs();
    this.buildCeilingDamage();
    this.buildImpossibleVista();
    this.propLayer = new WorldPropLayer(plan);
    this.group.add(this.propLayer.group);
    this.ready = this.propLayer.ready;
    void options;
  }

  private buildWallGraffiti(): void {
    const placements = selectWallGraffiti(this.plan);
    if (placements.length === 0 || typeof document === 'undefined') return;
    const group = new THREE.Group();
    group.name = 'procedural-handwritten-wall-graffiti';
    for (const placement of placements) {
      const created = createGraffitiMesh(placement);
      if (!created) continue;
      group.add(created.mesh);
      this.graffitiTextures.push(created.texture);
      this.graffitiMaterials.push(created.mesh.material);
    }
    if (group.children.length > 0) this.group.add(group);
  }

  private buildArchitecture(): void {
    const wallGeometries: THREE.BufferGeometry[] = [];
    const lowerWallGeometries: THREE.BufferGeometry[] = [];
    const plasterGeometries: THREE.BufferGeometry[] = [];
    const baseboardGeometries: THREE.BufferGeometry[] = [];
    const lowerBaseboardGeometries: THREE.BufferGeometry[] = [];
    const baseboardlessZones = this.plan.baseboardlessZones ?? [];
    const touchesBaseboardlessZone = (bounds: Rect): boolean =>
      baseboardlessZones.some((zone) => rectsTouchOrOverlap(zone, bounds));
    const upperShells = this.plan.walls.filter((wall) => wall.detail === 'upper-shell');
    const continuesIntoUpperShell = (wall: WallSegment): boolean => {
      if (
        wall.detail === 'upper-shell' ||
        wall.bottom > 0.12 ||
        Math.abs(wall.bottom + wall.height - this.plan.wallHeight) > 0.12
      ) return false;
      const fixed = wall.orientation === 'x' ? wall.z : wall.x;
      const min = (wall.orientation === 'x' ? wall.x : wall.z) - wall.length * 0.5;
      const max = (wall.orientation === 'x' ? wall.x : wall.z) + wall.length * 0.5;
      return upperShells.some((shell) => {
        if (shell.orientation !== wall.orientation) return false;
        const shellFixed = shell.orientation === 'x' ? shell.z : shell.x;
        const shellMin = (shell.orientation === 'x' ? shell.x : shell.z) - shell.length * 0.5;
        const shellMax = (shell.orientation === 'x' ? shell.x : shell.z) + shell.length * 0.5;
        return Math.abs(shellFixed - fixed) < 0.12 && shellMin < max && shellMax > min;
      });
    };
    for (const wall of this.plan.walls) {
      const geometry = createWallGeometry(
        wall,
        wallNeedsOpenVerticalShell(wall) || continuesIntoUpperShell(wall),
        this.surfaceStyle.wallPatternScale,
      );
      const wallMaterial = wall.kind === 'plaster' ? this.materials.plaster : this.materials.wall;
      if (wall.bottom < -1) {
        lowerWallGeometries.push(geometry);
      } else {
        ensureBakedLightUv(geometry, wallMaterial, 0.42);
        (wall.kind === 'plaster' ? plasterGeometries : wallGeometries).push(geometry);
      }

      const restsOnWalkableFloor =
        Math.abs(wall.bottom) < 0.12 ||
        Math.abs(wall.bottom + INFINITE_STORY_PITCH) < 0.12;
      const halfLength = wall.length * 0.5;
      const halfThickness = wall.thickness * 0.5;
      const wallBounds: Rect = wall.orientation === 'x'
        ? {
            minX: wall.x - halfLength,
            maxX: wall.x + halfLength,
            minZ: wall.z - halfThickness,
            maxZ: wall.z + halfThickness,
          }
        : {
            minX: wall.x - halfThickness,
            maxX: wall.x + halfThickness,
            minZ: wall.z - halfLength,
            maxZ: wall.z + halfLength,
          };
      const suppressBaseboard =
        wall.detail === 'crawl-tunnel' ||
        touchesBaseboardlessZone(wallBounds);
      if (wall.height > 1.3 && restsOnWalkableFloor && !suppressBaseboard) {
        const alongX = wall.orientation === 'x';
        const trim = new THREE.BoxGeometry(
          alongX ? wall.length + 0.025 : wall.thickness + 0.055,
          0.115,
          alongX ? wall.thickness + 0.055 : wall.length + 0.025,
        );
        trim.translate(wall.x, wall.bottom + 0.0575, wall.z);
        if (wall.bottom < -1) {
          lowerBaseboardGeometries.push(trim);
        } else {
          ensureBakedLightUv(trim, this.materials.baseboard, 0.36);
          baseboardGeometries.push(trim);
        }
      }
    }

    for (const column of this.plan.columns) {
      const geometry = createTexturedBoxGeometry(
        column.width,
        column.height,
        column.depth,
        column.x,
        0,
        column.z,
        column.tint,
        this.surfaceStyle.wallPatternScale,
      );
      ensureBakedLightUv(geometry, this.materials.wall, 0.32);
      wallGeometries.push(geometry);
      const columnBounds: Rect = {
        minX: column.x - column.width * 0.5,
        maxX: column.x + column.width * 0.5,
        minZ: column.z - column.depth * 0.5,
        maxZ: column.z + column.depth * 0.5,
      };
      if (!touchesBaseboardlessZone(columnBounds)) {
        const trim = new THREE.BoxGeometry(column.width + 0.055, 0.115, column.depth + 0.055);
        trim.translate(column.x, 0.0575, column.z);
        ensureBakedLightUv(trim, this.materials.baseboard, 0.26);
        baseboardGeometries.push(trim);
      }
    }

    for (const mass of this.plan.solidMasses) {
      const width = rectWidth(mass.bounds);
      const depth = rectDepth(mass.bounds);
      const center = rectCenter(mass.bounds);
      const massGeometry = createTexturedBoxGeometry(
        width,
        mass.height,
        depth,
        center.x,
        0,
        center.z,
        mass.tint,
        this.surfaceStyle.wallPatternScale,
      );
      ensureBakedLightUv(massGeometry, this.materials.wall, 0.36);
      wallGeometries.push(massGeometry);
      if (!touchesBaseboardlessZone(mass.bounds)) {
        const trimHeight = 0.115;
        const massTrims = [
          new THREE.BoxGeometry(width + 0.055, trimHeight, 0.09).translate(
            center.x,
            trimHeight * 0.5,
            mass.bounds.minZ,
          ),
          new THREE.BoxGeometry(width + 0.055, trimHeight, 0.09).translate(
            center.x,
            trimHeight * 0.5,
            mass.bounds.maxZ,
          ),
          new THREE.BoxGeometry(0.09, trimHeight, depth).translate(
            mass.bounds.minX,
            trimHeight * 0.5,
            center.z,
          ),
          new THREE.BoxGeometry(0.09, trimHeight, depth).translate(
            mass.bounds.maxX,
            trimHeight * 0.5,
            center.z,
          ),
        ];
        for (const trim of massTrims) ensureBakedLightUv(trim, this.materials.baseboard, 0.28);
        baseboardGeometries.push(...massTrims);
      }
    }

    makeMesh(mergeOrSingle(wallGeometries), this.materials.wall, 'merged-wallpaper-walls', this.group);
    makeMesh(
      mergeOrSingle(lowerWallGeometries),
      this.previewMaterials.wall,
      'lower-and-through-shaft-wallpaper-walls',
      this.group,
    );
    makeMesh(mergeOrSingle(plasterGeometries), this.materials.plaster, 'merged-plaster-walls', this.group);
    makeMesh(mergeOrSingle(baseboardGeometries), this.materials.baseboard, 'merged-baseboards', this.group);
    makeMesh(
      mergeOrSingle(lowerBaseboardGeometries),
      this.previewMaterials.baseboard,
      'lower-level-baseboards',
      this.group,
    );

    const floorGeometry = createFloorGeometry(
      this.plan.floorRects,
      0,
      this.surfaceStyle.floorPatternScale,
      this.surfaceStyle.floorQuarterTurn,
    );
    ensureBakedLightUv(floorGeometry, this.materials.floor);
    const floor = new THREE.Mesh(floorGeometry, this.materials.floor);
    floor.name = 'continuous-carpet-floor';
    floor.matrixAutoUpdate = false;
    floor.updateMatrix();
    this.group.add(floor);

    const worldBounds: Rect = {
      minX: -this.plan.size * 0.5,
      maxX: this.plan.size * 0.5,
      minZ: -this.plan.size * 0.5,
      maxZ: this.plan.size * 0.5,
    };
    const tallRooms = this.plan.rooms.filter(
      (room) => room.level >= 0 && room.ceilingHeight > this.plan.wallHeight + 0.1,
    );
    const inheritedCeilingOpenings = [...getInfiniteChunkCeilingOpenings(this.plan)];
    const stairCeilingOpenings = this.plan.stairCeilingOpenings ?? [];
    const ceilingOpenings = [
      ...inheritedCeilingOpenings,
      ...stairCeilingOpenings,
      ...tallRooms.map((room) => room.bounds),
    ];
    const ceilingRects = ceilingOpenings.length > 0
      ? cellsAroundHoles(worldBounds, ceilingOpenings)
      : [worldBounds];
    makeMesh(
      mergeOrSingle(ceilingRects.map((rect) =>
        createCeilingGeometry(rect, this.plan.wallHeight, this.surfaceStyle.ceilingPatternScale)
      )),
      this.materials.ceiling,
      'office-drop-ceiling',
      this.group,
    );
    makeMesh(
      mergeOrSingle(
        tallRooms.flatMap((room) => {
          const clippedOpenings = [...inheritedCeilingOpenings, ...stairCeilingOpenings]
            .map((opening) => intersectRects(room.bounds, opening))
            .filter((opening): opening is Rect => opening !== null);
          const rects = clippedOpenings.length > 0
            ? cellsAroundHoles(room.bounds, clippedOpenings)
            : [room.bounds];
          return rects.map((rect) =>
            createCeilingGeometry(rect, room.ceilingHeight, this.surfaceStyle.ceilingPatternScale)
          );
        }),
      ),
      this.materials.ceiling,
      'elevated-atrium-ceilings',
      this.group,
    );
    if (inheritedCeilingOpenings.length > 0) {
      makeMesh(
        mergeOrSingle(
          cellsAroundHoles(worldBounds, inheritedCeilingOpenings).map((rect) =>
            createCeilingGeometry(
              rect,
              INFINITE_STORY_PITCH - 0.015,
              this.surfaceStyle.ceilingPatternScale,
            ),
          ),
        ),
        this.previewMaterials.ceiling,
        'upper-story-floor-underside-preview',
        this.group,
      );
      const previewZones: Rect[] = [];
      for (const opening of inheritedCeilingOpenings) {
        let candidate: Rect = {
          minX: Math.max(worldBounds.minX, opening.minX - 7),
          maxX: Math.min(worldBounds.maxX, opening.maxX + 7),
          minZ: Math.max(worldBounds.minZ, opening.minZ - 7),
          maxZ: Math.min(worldBounds.maxZ, opening.maxZ + 7),
        };
        let expanded = true;
        while (expanded) {
          expanded = false;
          for (let index = previewZones.length - 1; index >= 0; index -= 1) {
            const zone = previewZones[index]!;
            if (
              candidate.minX <= zone.maxX + 0.5 &&
              candidate.maxX >= zone.minX - 0.5 &&
              candidate.minZ <= zone.maxZ + 0.5 &&
              candidate.maxZ >= zone.minZ - 0.5
            ) {
              candidate = {
                minX: Math.min(candidate.minX, zone.minX),
                maxX: Math.max(candidate.maxX, zone.maxX),
                minZ: Math.min(candidate.minZ, zone.minZ),
                maxZ: Math.max(candidate.maxZ, zone.maxZ),
              };
              previewZones.splice(index, 1);
              expanded = true;
            }
          }
        }
        previewZones.push(candidate);
      }

      const previewFloorY = INFINITE_STORY_PITCH;
      const previewCeilingY = previewFloorY + this.plan.wallHeight;
      makeMesh(
        mergeOrSingle(previewZones.flatMap((zone) =>
          createOpenShaftWallGeometries(
            zone,
            previewFloorY,
            previewCeilingY,
            0.96,
            this.surfaceStyle.wallPatternScale,
          )
        )),
        this.previewMaterials.wall,
        'upper-story-preview-wallpaper-walls',
        this.group,
      );
      makeMesh(
        mergeOrSingle(previewZones.map((zone) =>
          createCeilingGeometry(zone, previewCeilingY, this.surfaceStyle.ceilingPatternScale)
        )),
        this.previewMaterials.ceiling,
        'upper-story-preview-ceiling',
        this.group,
      );
      const previewLightGeometries: THREE.BufferGeometry[] = [];
      for (const zone of previewZones) {
        const columns = Math.max(1, Math.min(6, Math.floor(rectWidth(zone) / 5.8)));
        const rows = Math.max(1, Math.min(6, Math.floor(rectDepth(zone) / 5.8)));
        for (let xIndex = 0; xIndex < columns; xIndex += 1) {
          for (let zIndex = 0; zIndex < rows; zIndex += 1) {
            const x = zone.minX + ((xIndex + 0.5) / columns) * rectWidth(zone);
            const z = zone.minZ + ((zIndex + 0.5) / rows) * rectDepth(zone);
            if (inheritedCeilingOpenings.some((opening) => pointInRect(x, z, opening, -0.9))) {
              continue;
            }
            const geometry = new THREE.PlaneGeometry(1.9, 0.82);
            geometry.rotateX(Math.PI * 0.5);
            if ((xIndex + zIndex) % 2 === 1) geometry.rotateZ(Math.PI * 0.5);
            geometry.translate(x, previewCeilingY - 0.035, z);
            previewLightGeometries.push(geometry);
          }
        }
      }
      makeMesh(
        mergeOrSingle(previewLightGeometries),
        this.materials.fixtureGlow,
        'upper-story-preview-lights',
        this.group,
      );
    }
    makeMesh(
      createHorizontalJunctionRepairGeometry(
        this.plan.walls,
        this.plan.floorRects,
        this.plan.size,
        this.plan.wallHeight,
        'floor',
      ),
      this.materials.floor,
      'floor-lightmap-junction-repairs',
      this.group,
    );
    makeMesh(
      createHorizontalJunctionRepairGeometry(
        this.plan.walls,
        ceilingRects,
        this.plan.size,
        this.plan.wallHeight,
        'ceiling',
      ),
      this.materials.ceiling,
      'ceiling-lightmap-junction-repairs',
      this.group,
    );
  }

  private buildRaisedZones(): void {
    const features = this.plan.features.filter(
      (feature): feature is RaisedZoneFeature => feature.kind === 'raised-zone',
    );
    const topGeometries: THREE.BufferGeometry[] = [];
    const rampGeometries: THREE.BufferGeometry[] = [];
    const skirtGeometries: THREE.BufferGeometry[] = [];
    for (const feature of features) {
      topGeometries.push(createFloorGeometry(
        [feature.platformBounds],
        feature.elevation + 0.004,
        this.surfaceStyle.floorPatternScale,
        this.surfaceStyle.floorQuarterTurn,
      ));
      rampGeometries.push(createRampSurfaceGeometry(feature));
      const platform = feature.platformBounds;
      skirtGeometries.push(removeHorizontalCaps(createTexturedBoxGeometry(
        rectWidth(platform),
        feature.elevation,
        rectDepth(platform),
        rectCenter(platform).x,
        0,
        rectCenter(platform).z,
        0.96,
        this.surfaceStyle.wallPatternScale,
      )));
    }
    makeMesh(
      mergeOrSingle([...topGeometries, ...rampGeometries]),
      this.materials.floor,
      'raised-carpet-platforms-and-ramps',
      this.group,
    );
    makeMesh(
      mergeOrSingle(skirtGeometries),
      this.materials.wall,
      'wallpaper-raised-platform-skirts',
      this.group,
    );
  }

  private buildLowPassages(): void {
    const features = this.plan.features.filter(
      (feature): feature is SqueezeViewFeature => feature.kind === 'squeeze-view',
    );
    const roofGeometries: THREE.BufferGeometry[] = [];
    const floorGeometries: THREE.BufferGeometry[] = [];
    const skirtGeometries: THREE.BufferGeometry[] = [];
    const shaftGeometries: THREE.BufferGeometry[] = [];
    const holeBottomGeometries: THREE.BufferGeometry[] = [];
    for (const feature of features) {
      const room = this.plan.rooms.find((candidate) => candidate.id === feature.roomId);
      const clearance = feature.clearanceHeight ?? 1.42;
      const ceilingY = room?.ceilingHeight ?? this.plan.wallHeight;
      if (ceilingY > clearance + 0.08) {
        roofGeometries.push(createTexturedBoxGeometry(
          rectWidth(feature.bounds),
          ceilingY - clearance,
          rectDepth(feature.bounds),
          rectCenter(feature.bounds).x,
          clearance,
          rectCenter(feature.bounds).z,
          0.96,
          this.surfaceStyle.wallPatternScale,
        ));
      }
      if (feature.hump) {
        floorGeometries.push(
          createFloorGeometry(
            [feature.hump.platformBounds],
            feature.hump.elevation + 0.004,
            this.surfaceStyle.floorPatternScale,
            this.surfaceStyle.floorQuarterTurn,
          ),
          ...feature.hump.ramps.map((ramp) =>
            createSlopedSurfaceGeometry(feature.hump!.elevation, ramp)
          ),
        );
        skirtGeometries.push(removeHorizontalCaps(createTexturedBoxGeometry(
          rectWidth(feature.hump.platformBounds),
          feature.hump.elevation,
          rectDepth(feature.hump.platformBounds),
          rectCenter(feature.hump.platformBounds).x,
          0,
          rectCenter(feature.hump.platformBounds).z,
          0.92,
          this.surfaceStyle.wallPatternScale,
        )));
      }
      for (const hole of feature.holes ?? []) {
        shaftGeometries.push(
          ...createOpenShaftWallGeometries(
            hole,
            -hole.depth,
            -0.004,
            0.82,
            this.surfaceStyle.wallPatternScale,
          ),
        );
        holeBottomGeometries.push(createFloorGeometry(
          [hole],
          -hole.depth,
          this.surfaceStyle.floorPatternScale,
          this.surfaceStyle.floorQuarterTurn,
        ));
      }
    }
    makeMesh(
      mergeOrSingle(roofGeometries),
      this.materials.wall,
      'low-passage-ceiling-masses',
      this.group,
    );
    makeMesh(
      mergeOrSingle(floorGeometries),
      this.materials.floor,
      'low-passage-humps',
      this.group,
    );
    makeMesh(
      mergeOrSingle(skirtGeometries),
      this.materials.wall,
      'low-passage-hump-skirts',
      this.group,
    );
    makeMesh(
      mergeOrSingle(shaftGeometries),
      this.materials.pitWall,
      'low-passage-hole-walls',
      this.group,
    );
    makeMesh(
      mergeOrSingle(holeBottomGeometries),
      this.materials.pitBottom,
      'low-passage-hole-bottoms',
      this.group,
    );
  }

  private buildFixtures(): THREE.InstancedMesh {
    const emitterGeometry = new THREE.PlaneGeometry(2.24, 1.16);
    emitterGeometry.rotateX(Math.PI * 0.5);
    const emitters = new THREE.InstancedMesh(emitterGeometry, this.materials.fixtureGlow, this.fixtureSlots.length);
    emitters.name = 'instanced-luminous-ceiling-tiles';
    emitters.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    emitters.renderOrder = 12;
    // The instance bounds are static and valid; allowing chunk-level frustum
    // culling avoids submitting every fluorescent panel in the 3x3 stream.
    emitters.frustumCulled = true;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const axis = new THREE.Vector3(0, 1, 0);
    this.fixtureSlots.forEach((slot, index) => {
      quaternion.setFromAxisAngle(axis, slot.rotation);
      position.set(slot.x, slot.ceilingY - 0.036, slot.z);
      // A dead slot represents a missing fluorescent panel, not a bright
      // white rectangle that merely stopped contributing to the lightmap.
      scale.set(
        slot.dead ? 0 : slot.width / 2.24,
        slot.dead ? 0 : 1,
        slot.dead ? 0 : slot.width > 1.65 ? 1.08 : 0.86,
      );
      matrix.compose(position, quaternion, scale);
      emitters.setMatrixAt(index, matrix);
    });
    emitters.instanceMatrix.needsUpdate = true;
    emitters.computeBoundingSphere();
    this.group.add(emitters);
    return emitters;
  }

  private buildPitFeatures(): void {
    const features = this.plan.features.filter((feature): feature is GridPitFeature => feature.kind === 'grid-pit');
    const sideGeometries: THREE.BufferGeometry[] = [];
    const abyssSideGeometries: THREE.BufferGeometry[] = [];
    const abyssStoreyGeometries: THREE.BufferGeometry[] = [];
    const lowerCeilingGeometries: THREE.BufferGeometry[] = [];
    for (const feature of features) {
      for (const hole of feature.holes) {
        const width = rectWidth(hole);
        const depth = rectDepth(hole);
        const center = rectCenter(hole);
        // Stay a few millimetres under the carpet and cross the lower ceiling
        // perpendicularly. There is no horizontal face left to form a rim or
        // to become coplanar with either surface.
        const shaftTop = -0.004;
        const shaftBottom = feature.lowerCeilingY - 0.06;

        if (hole.kind === 'void') {
          // Keep the shaft well below the death plane so its geometry never
          // visibly ends while the player is falling. Repeated, recessed slab
          // edges make several impossible office storeys readable from above.
          const abyssBottom = -Math.max(54, hole.depth + 10.8);
          abyssSideGeometries.push(
            ...createOpenShaftWallGeometries(
              hole,
              abyssBottom,
              shaftTop,
              0.66,
              this.surfaceStyle.wallPatternScale,
            ),
          );

          const storeyPitch = 5.4;
          const ledgeDepth = Math.min(0.16, Math.min(width, depth) * 0.035);
          const slabHeight = 0.12;
          for (
            let storeyY = feature.lowerFloorY - storeyPitch;
            storeyY > abyssBottom + storeyPitch * 0.5;
            storeyY -= storeyPitch
          ) {
            abyssStoreyGeometries.push(
              createTexturedBoxGeometry(width, slabHeight, ledgeDepth, center.x, storeyY, hole.minZ + ledgeDepth * 0.5, 0.72),
              createTexturedBoxGeometry(width, slabHeight, ledgeDepth, center.x, storeyY, hole.maxZ - ledgeDepth * 0.5, 0.72),
              createTexturedBoxGeometry(ledgeDepth, slabHeight, Math.max(0.05, depth - ledgeDepth * 2), hole.minX + ledgeDepth * 0.5, storeyY, center.z, 0.72),
              createTexturedBoxGeometry(ledgeDepth, slabHeight, Math.max(0.05, depth - ledgeDepth * 2), hole.maxX - ledgeDepth * 0.5, storeyY, center.z, 0.72),
            );
          }
        } else {
          sideGeometries.push(
            ...createOpenShaftWallGeometries(
              hole,
              shaftBottom,
              shaftTop,
              0.72,
              this.surfaceStyle.wallPatternScale,
            ),
          );
        }
      }
      const continuingHoles = feature.holes.filter(
        (hole) => hole.kind === 'void' || (hole.stories ?? 1) > 1,
      );
      const inheritedPreviewHoles = (this.plan.lowerPreviewOpenings ?? [])
        .filter((opening) =>
          opening.minX < feature.lowerBounds.maxX &&
          opening.maxX > feature.lowerBounds.minX &&
          opening.minZ < feature.lowerBounds.maxZ &&
          opening.maxZ > feature.lowerBounds.minZ
        )
        .map((opening): Rect => ({
          minX: Math.max(opening.minX, feature.lowerBounds.minX),
          maxX: Math.min(opening.maxX, feature.lowerBounds.maxX),
          minZ: Math.max(opening.minZ, feature.lowerBounds.minZ),
          maxZ: Math.min(opening.maxZ, feature.lowerBounds.maxZ),
        }));
      const lowerFloorGeometry = createFloorGeometry(
        cellsAroundHoles(feature.lowerBounds, [...continuingHoles, ...inheritedPreviewHoles]),
        feature.lowerFloorY,
        this.surfaceStyle.floorPatternScale,
        this.surfaceStyle.floorQuarterTurn,
      );
      const lowerFloor = new THREE.Mesh(lowerFloorGeometry, this.previewMaterials.floor);
      lowerFloor.name = `lower-carpet-${feature.id}`;
      lowerFloor.matrixAutoUpdate = false;
      lowerFloor.updateMatrix();
      this.group.add(lowerFloor);
      for (const cell of cellsAroundHoles(feature.lowerBounds, feature.holes)) {
        lowerCeilingGeometries.push(createCeilingGeometry(
          cell,
          feature.lowerCeilingY,
          this.surfaceStyle.ceilingPatternScale,
        ));
      }
    }
    makeMesh(
      mergeOrSingle(sideGeometries),
      this.previewMaterials.pitWall,
      'open-pit-shaft-walls',
      this.group,
    );
    makeMesh(
      mergeOrSingle(abyssSideGeometries),
      this.previewMaterials.pitWall,
      'open-abyss-shaft-walls',
      this.group,
    );
    makeMesh(
      mergeOrSingle(abyssStoreyGeometries),
      this.previewMaterials.ceiling,
      'abyss-storey-edges',
      this.group,
    );
    makeMesh(
      mergeOrSingle(lowerCeilingGeometries),
      this.previewMaterials.ceiling,
      'lower-office-ceiling',
      this.group,
    );
  }

  private buildStairs(): void {
    const stairFeatures = this.plan.features.filter(
      (feature): feature is StairSocketFeature => feature.kind === 'stair-socket',
    );
    const geometries: THREE.BufferGeometry[] = [];
    const cageGeometries: THREE.BufferGeometry[] = [];
    const lightGeometries: THREE.BufferGeometry[] = [];
    for (const stairs of stairFeatures) {
      const center = rectCenter(stairs.bounds);
      const alongX = stairs.heading.startsWith('x');
      for (const slab of getStairSlabs(stairs)) {
        geometries.push(createTexturedBoxGeometry(
          rectWidth(slab.bounds),
          slab.top - slab.bottom,
          rectDepth(slab.bounds),
          rectCenter(slab.bounds).x,
          slab.bottom,
          rectCenter(slab.bounds).z,
          slab.kind === 'step' ? 0.94 : 0.98,
          this.surfaceStyle.floorPatternScale,
        ));
      }
      const baseY = stairs.baseY ?? 0;
      const wallThickness = 0.16;
      for (const lightY of [baseY + 2.52, baseY + 5.18]) {
        const light = new THREE.PlaneGeometry(
          alongX ? 1.55 : 0.72,
          alongX ? 0.72 : 1.55,
        );
        light.rotateX(Math.PI * 0.5);
        light.translate(center.x, lightY, center.z);
        lightGeometries.push(light);
      }
      if (alongX) {
        cageGeometries.push(
          createTexturedBoxGeometry(
            rectWidth(stairs.bounds),
            STAIR_STORY_RISE,
            wallThickness,
            center.x,
            baseY,
            stairs.bounds.minZ - wallThickness * 0.5,
            0.92,
            this.surfaceStyle.wallPatternScale,
          ),
          createTexturedBoxGeometry(
            rectWidth(stairs.bounds),
            STAIR_STORY_RISE,
            wallThickness,
            center.x,
            baseY,
            stairs.bounds.maxZ + wallThickness * 0.5,
            0.92,
            this.surfaceStyle.wallPatternScale,
          ),
        );
      } else {
        cageGeometries.push(
          createTexturedBoxGeometry(
            wallThickness,
            STAIR_STORY_RISE,
            rectDepth(stairs.bounds),
            stairs.bounds.minX - wallThickness * 0.5,
            baseY,
            center.z,
            0.92,
            this.surfaceStyle.wallPatternScale,
          ),
          createTexturedBoxGeometry(
            wallThickness,
            STAIR_STORY_RISE,
            rectDepth(stairs.bounds),
            stairs.bounds.maxX + wallThickness * 0.5,
            baseY,
            center.z,
            0.92,
            this.surfaceStyle.wallPatternScale,
          ),
        );
      }
    }
    makeMesh(mergeOrSingle(geometries), this.materials.floor, 'inter-storey-stair-flights', this.group);
    makeMesh(mergeOrSingle(cageGeometries), this.materials.wall, 'inter-storey-stair-cages', this.group);
    makeMesh(mergeOrSingle(lightGeometries), this.materials.fixtureGlow, 'inter-storey-stair-lights', this.group);
  }

  private buildCeilingDamage(): void {
    if (this.plan.missingCeilingTiles.length === 0) return;
    const holeGeometry = new THREE.PlaneGeometry(1.12, 1.12);
    holeGeometry.rotateX(Math.PI * 0.5);
    const holes = new THREE.InstancedMesh(holeGeometry, this.materials.void, this.plan.missingCeilingTiles.length);
    holes.name = 'missing-ceiling-tiles';
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const hangingPanels: THREE.BufferGeometry[] = [];
    this.plan.missingCeilingTiles.forEach((tile, index) => {
      euler.set(0, tile.rotation, 0);
      quaternion.setFromEuler(euler);
      matrix.compose(
        new THREE.Vector3(tile.x, this.plan.wallHeight - 0.012, tile.z),
        quaternion,
        new THREE.Vector3(1, 1, 1),
      );
      holes.setMatrixAt(index, matrix);
      if (tile.hanging) {
        const panel = new THREE.BoxGeometry(1.06, 0.028, 1.06);
        panel.rotateZ(0.48);
        panel.rotateY(tile.rotation);
        panel.translate(tile.x + 0.28, this.plan.wallHeight - 0.53, tile.z);
        hangingPanels.push(panel);
      }
    });
    holes.instanceMatrix.needsUpdate = true;
    holes.computeBoundingSphere();
    this.group.add(holes);
    makeMesh(mergeOrSingle(hangingPanels), this.materials.ceiling, 'hanging-ceiling-panels', this.group);
  }

  private buildImpossibleVista(): void {
    const vista = this.plan.features.find(
      (feature): feature is VistaFeature => feature.kind === 'impossible-vista',
    );
    if (!vista) return;
    const group = new THREE.Group();
    group.name = 'explorable-vista-hall';
    const center = rectCenter(vista.bounds);
    const length = rectWidth(vista.bounds);
    const width = rectDepth(vista.bounds);

    const vistaFloorGeometry = createFloorGeometry(
      [vista.bounds],
      0,
      this.surfaceStyle.floorPatternScale,
      this.surfaceStyle.floorQuarterTurn,
    );
    ensureBakedLightUv(vistaFloorGeometry, this.materials.floor);
    const floor = new THREE.Mesh(vistaFloorGeometry, this.materials.floor);
    floor.name = 'vista-carpet-floor';
    floor.matrixAutoUpdate = false;
    floor.updateMatrix();
    group.add(floor);
    const entryBridge: Rect = {
      minX: Math.min(vista.wallX, vista.bounds.minX),
      maxX: Math.max(vista.wallX, vista.bounds.minX),
      minZ: vista.bounds.minZ,
      maxZ: vista.bounds.maxZ,
    };
    makeMesh(
      createFloorGeometry(
        [entryBridge],
        0,
        this.surfaceStyle.floorPatternScale,
        this.surfaceStyle.floorQuarterTurn,
      ),
      this.materials.floor,
      'vista-entry-floor-bridge',
      group,
    );
    makeMesh(
      createCeilingGeometry(vista.bounds, vista.height, this.surfaceStyle.ceilingPatternScale),
      this.materials.ceiling,
      'vista-tiled-ceiling',
      group,
    );

    const shellWalls: THREE.BufferGeometry[] = [
      createWallGeometry({
        id: 'vista-north-wall',
        x: center.x,
        z: vista.bounds.minZ,
        length,
        orientation: 'x',
        bottom: 0,
        height: vista.height,
        thickness: 0.26,
        tint: 0.9,
        collision: true,
        kind: 'wallpaper',
      }),
      createWallGeometry({
        id: 'vista-south-wall',
        x: center.x,
        z: vista.bounds.maxZ,
        length,
        orientation: 'x',
        bottom: 0,
        height: vista.height,
        thickness: 0.26,
        tint: 0.94,
        collision: true,
        kind: 'wallpaper',
      }),
      createWallGeometry({
        id: 'vista-end-wall',
        x: vista.bounds.maxX,
        z: center.z,
        length: width,
        orientation: 'z',
        bottom: 0,
        height: vista.height,
        thickness: 0.26,
        tint: 0.86,
        collision: true,
        kind: 'wallpaper',
      }),
    ];
    makeMesh(mergeOrSingle(shellWalls), this.materials.wall, 'vista-wallpaper-shell', group);

    const upperFacadeHeight = vista.height - this.plan.wallHeight;
    const transitionGeometries: THREE.BufferGeometry[] = [
      createTexturedBoxGeometry(
        0.28,
        upperFacadeHeight,
        width,
        vista.bounds.minX,
        this.plan.wallHeight,
        vista.centerZ,
        0.9,
      ),
    ];
    const revealDepth = Math.max(0.22, vista.bounds.minX - vista.wallX + 0.12);
    const revealX = (vista.bounds.minX + vista.wallX) * 0.5;
    const apertureWidth = vista.aperture.maxZ - vista.aperture.minZ;
    transitionGeometries.push(
      createTexturedBoxGeometry(
        revealDepth,
        vista.openingBottom,
        apertureWidth,
        revealX,
        0,
        vista.centerZ,
        0.94,
      ),
      createTexturedBoxGeometry(
        revealDepth,
        this.plan.wallHeight - vista.openingBottom - vista.openingHeight,
        apertureWidth,
        revealX,
        vista.openingBottom + vista.openingHeight,
        vista.centerZ,
        0.94,
      ),
      createTexturedBoxGeometry(
        revealDepth,
        vista.openingHeight,
        0.075,
        revealX,
        vista.openingBottom,
        vista.aperture.minZ,
        0.94,
      ),
      createTexturedBoxGeometry(
        revealDepth,
        vista.openingHeight,
        0.075,
        revealX,
        vista.openingBottom,
        vista.aperture.maxZ,
        0.94,
      ),
    );
    makeMesh(
      mergeOrSingle(transitionGeometries),
      this.materials.wall,
      'vista-complete-entry-facade',
      group,
    );

    const columns: THREE.BufferGeometry[] = [];
    for (let lane = -1; lane <= 1; lane += 2) {
      for (let index = 0; index < 7; index += 1) {
        const x = vista.wallX + vista.viewDirection * (5.5 + index * 7.1);
        columns.push(
          createTexturedBoxGeometry(
            1.15,
            vista.height,
            1.15,
            x,
            0,
            vista.centerZ + lane * 6.3,
            0.84 + index * 0.018,
          ),
        );
      }
    }
    makeMesh(mergeOrSingle(columns), this.materials.wall, 'vista-wallpaper-columns', group);

    const baseboards = [
      new THREE.BoxGeometry(length, 0.115, 0.09).translate(center.x, 0.0575, vista.bounds.minZ),
      new THREE.BoxGeometry(length, 0.115, 0.09).translate(center.x, 0.0575, vista.bounds.maxZ),
      new THREE.BoxGeometry(0.09, 0.115, width).translate(vista.bounds.maxX, 0.0575, center.z),
    ];
    for (let lane = -1; lane <= 1; lane += 2) {
      for (let index = 0; index < 7; index += 1) {
        const x = vista.wallX + vista.viewDirection * (5.5 + index * 7.1);
        const z = vista.centerZ + lane * 6.3;
        baseboards.push(
          new THREE.BoxGeometry(1.23, 0.115, 0.085).translate(x, 0.0575, z - 0.575),
          new THREE.BoxGeometry(1.23, 0.115, 0.085).translate(x, 0.0575, z + 0.575),
          new THREE.BoxGeometry(0.085, 0.115, 1.15).translate(x - 0.575, 0.0575, z),
          new THREE.BoxGeometry(0.085, 0.115, 1.15).translate(x + 0.575, 0.0575, z),
        );
      }
    }
    makeMesh(mergeOrSingle(baseboards), this.materials.baseboard, 'vista-baseboards', group);
    this.group.add(group);
  }

  update(time: number, playerPosition: THREE.Vector3, delta = 1 / 60): void {
    void time;
    void playerPosition;
    void delta;
  }

  getRuntimeLightSources(offset = new THREE.Vector3()): RuntimeLightSource[] {
    return this.fixtureSlots
      .filter((slot) => !slot.dead)
      .map((slot) => ({
        id: `${this.plan.seed}:${slot.id}`,
        x: slot.x + offset.x,
        y: slot.ceilingY - 0.052 + offset.y,
        z: slot.z + offset.z,
        rotation: slot.rotation,
        width: slot.width,
        intensity: slot.intensity,
        color: slot.color,
        level: slot.level,
        zoneId: `${this.plan.seed}:${slot.roomId}`,
      }));
  }

  findZoneIdAt(x: number, y: number, z: number): string {
    const lower = this.plan.features.find(
      (feature): feature is GridPitFeature => feature.kind === 'grid-pit',
    );
    if (lower && y < -1.4 && pointInRect(x, z, lower.lowerBounds)) return `${this.plan.seed}:${lower.id}`;
    const vista = this.plan.features.find(
      (feature): feature is VistaFeature => feature.kind === 'impossible-vista',
    );
    if (vista && pointInRect(x, z, vista.bounds)) return `${this.plan.seed}:${vista.id}`;
    const room = this.plan.rooms.find((candidate) => pointInRect(x, z, candidate.bounds));
    return `${this.plan.seed}:${room?.id ?? 'unclassified'}`;
  }

  private isLightOccluded(player: THREE.Vector3, source: RuntimeLightSource): boolean {
    const intersects = (minX: number, maxX: number, minZ: number, maxZ: number): boolean => {
      const dx = source.x - player.x;
      const dz = source.z - player.z;
      let enter = 0;
      let exit = 1;
      for (const [origin, direction, min, max] of [
        [player.x, dx, minX, maxX],
        [player.z, dz, minZ, maxZ],
      ] as const) {
        if (Math.abs(direction) < 1e-6) {
          if (origin < min || origin > max) return false;
          continue;
        }
        const first = (min - origin) / direction;
        const second = (max - origin) / direction;
        enter = Math.max(enter, Math.min(first, second));
        exit = Math.min(exit, Math.max(first, second));
        if (enter > exit) return false;
      }
      return exit > 0.04 && enter < 0.96;
    };
    const lower = source.level < 0;
    if (this.plan.walls.some((wall) => {
      if ((wall.bottom < -1) !== lower) return false;
      const halfX = wall.orientation === 'x' ? wall.length * 0.5 : wall.thickness * 0.5;
      const halfZ = wall.orientation === 'z' ? wall.length * 0.5 : wall.thickness * 0.5;
      return intersects(wall.x - halfX, wall.x + halfX, wall.z - halfZ, wall.z + halfZ);
    })) return true;
    if (!lower && this.plan.solidMasses.some((mass) => intersects(
      mass.bounds.minX,
      mass.bounds.maxX,
      mass.bounds.minZ,
      mass.bounds.maxZ,
    ))) return true;
    return false;
  }

  getInteraction(
    playerPosition: THREE.Vector3,
    lookDirection: THREE.Vector3,
  ): WorldInteraction | null {
    const vista = this.plan.features.find(
      (feature): feature is VistaFeature => feature.kind === 'impossible-vista',
    );
    if (!vista || Math.abs(playerPosition.z - vista.centerZ) > (vista.aperture.maxZ - vista.aperture.minZ) * 0.5 + 0.62) return null;
    const signedDistance = (playerPosition.x - vista.wallX) * vista.viewDirection;
    if (Math.abs(signedDistance) > 2.45 || playerPosition.y < 0.25 || playerPosition.y > 1.35) return null;
    const target = new THREE.Vector3(
      vista.wallX,
      vista.openingBottom + vista.openingHeight * 0.5,
      vista.centerZ,
    );
    const toOpening = target.sub(playerPosition).normalize();
    if (lookDirection.dot(toOpening) < 0.82) return null;
    return signedDistance < 0
      ? {
          path: [vista.destination],
          duration: 0.72,
          duckDepth: 0.34,
          label: 'SE GLISSER DANS L’OUVERTURE',
        }
      : {
          path: [vista.returnDestination],
          duration: 0.72,
          duckDepth: 0.34,
          label: 'REVENIR DANS LE LEVEL 0',
        };
  }

  findRoomAt(x: number, y: number, z: number): RoomKind {
    const lower = this.plan.features.find(
      (feature): feature is GridPitFeature => feature.kind === 'grid-pit',
    );
    if (lower && y < -1.4 && pointInRect(x, z, lower.lowerBounds)) return 'lower-maze';
    const vista = this.plan.features.find(
      (feature): feature is VistaFeature => feature.kind === 'impossible-vista',
    );
    if (vista && pointInRect(x, z, vista.bounds)) return 'vista-hall';
    const room = this.plan.rooms.find(
      (candidate) =>
        x >= candidate.bounds.minX &&
        x <= candidate.bounds.maxX &&
        z >= candidate.bounds.minZ &&
        z <= candidate.bounds.maxZ,
    );
    return room?.kind ?? 'threshold';
  }

  dispose(): void {
    this.propLayer.dispose();
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.InstancedMesh) object.geometry.dispose();
    });
    this.ownedMaterials.forEach((material) => material.dispose());
    this.graffitiMaterials.forEach((material) => material.dispose());
    this.graffitiTextures.forEach((texture) => texture.dispose());
    this.bakedLightMaps.general.dispose();
    this.bakedLightMaps.ceiling.dispose();
    this.group.removeFromParent();
  }
}
