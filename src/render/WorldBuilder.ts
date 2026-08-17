import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MaterialSet } from './MaterialLibrary';
import {
  bakedLightMapJunctionNeedsRepair,
  bakedLightMapTexelSize,
  createBakedLightMaps,
  createBakedMaterialSet,
  ensureBakedLightUv,
} from './BakedLighting';
import type { BakedLightMapData, BakedLightMaps } from './BakedLighting';
import type { LightingMode } from './LightingMode';
import { applyZonalLighting, createZonalMaterialSet } from './ZonalLighting';
import type { ZonalLightingContext } from './ZonalLighting';
import { createGraffitiMesh, selectWallGraffiti } from './WallGraffiti';
import { WorldDoorLayer } from './WorldDoors';
import type { DoorStateSnapshot } from './WorldDoors';
import { WorldPropLayer } from './WorldProps';
import type {
  DoorOpenMode,
  EpicPassagePreview,
  EpicStructureFeature,
  GridPitFeature,
  LightSlot,
  RampSurface,
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
import {
  EPIC1_PORTAL_HEIGHT,
  getEpicAbyssBottom,
  getEpicAbyssPassageLayout,
  getEpicAbyssRoomPreviewLayout,
  getEpicAbyssThroughPassageLayout,
  getEpic1FunnelStoryBounds,
  getEpic3BackroomsGalleryLayout,
  getEpicStairRoomWalls,
  getEpicStairwellLayout,
} from '../world/EpicStructures';
import { INFINITE_STORY_PITCH, getInfiniteChunkCeilingOpenings } from '../world/InfiniteWorld';
import {
  getPassageHoleAbyssBottom,
  getPassageHolePreviewBounds,
  PASSAGE_HOLE_LOWER_CEILING_Y,
  PASSAGE_HOLE_LOWER_FLOOR_Y,
} from '../world/PassageHoleLayout';
import { SeededRandom } from '../world/SeededRandom';
import {
  getStairCageWalls,
  getStairFloorOpening,
  getStairSlabs,
  STAIR_STEPS_PER_FLIGHT,
  STAIR_STORY_RISE,
} from '../world/StairLayout';
import { pointInRect, rectCenter, rectDepth, rectWidth } from '../world/types';

const setGeometryTint = (geometry: THREE.BufferGeometry, tint: number): void => {
  const count = geometry.getAttribute('position').count;
  // Generation keeps broad tint variation for authored features. Compress the
  // ordinary wallpaper range at render time so adjacent merged segments read
  // as one surface instead of looking like separate exposure zones.
  const visualTint = tint >= 0.8
    ? THREE.MathUtils.clamp(1 + (tint - 1) * 0.4, 0.925, 1.035)
    : tint;
  const color = new THREE.Color().setRGB(visualTint, visualTint, visualTint);
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

const removeBottomCap = <T extends THREE.BufferGeometry>(geometry: T): T => {
  const index = geometry.getIndex();
  const normals = geometry.getAttribute('normal');
  if (!index || !normals) return geometry;
  const retainedIndices: number[] = [];
  for (let offset = 0; offset < index.count; offset += 3) {
    const first = index.getX(offset);
    if (normals.getY(first) > -0.5) {
      retainedIndices.push(first, index.getX(offset + 1), index.getX(offset + 2));
    }
  }
  geometry.setIndex(retainedIndices);
  geometry.clearGroups();
  return geometry;
};

const removeWallEndCaps = <T extends THREE.BufferGeometry>(
  geometry: T,
  orientation: WallSegment['orientation'],
): T => {
  const index = geometry.getIndex();
  const normals = geometry.getAttribute('normal');
  if (!index || !normals) return geometry;
  const retainedIndices: number[] = [];
  for (let offset = 0; offset < index.count; offset += 3) {
    const first = index.getX(offset);
    const pointsAlongWall = orientation === 'x'
      ? Math.abs(normals.getX(first)) > 0.5
      : Math.abs(normals.getZ(first)) > 0.5;
    if (!pointsAlongWall) {
      retainedIndices.push(first, index.getX(offset + 1), index.getX(offset + 2));
    }
  }
  geometry.setIndex(retainedIndices);
  geometry.clearGroups();
  return geometry;
};

const createWallGeometry = (
  wall: WallSegment,
  capless = false,
  patternScale = 1,
  openEnds = false,
  texturePhase = { u: 0, v: 0 },
): THREE.BoxGeometry => {
  const alongX = wall.orientation === 'x';
  const width = alongX ? wall.length : wall.thickness;
  const depth = alongX ? wall.thickness : wall.length;
  const geometry = new THREE.BoxGeometry(
    width,
    wall.height,
    depth,
  );
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  const worldVOffset = (wall.bottom / 2.45) * patternScale + texturePhase.v;
  // BoxGeometry mirrors the U direction on opposing faces. These offsets map
  // every vertical face into world space in the matching direction, so two
  // adjacent or vertically stacked boxes do not restart the wallpaper tile.
  const faceWorldUOffsets = [
    -(wall.z + depth * 0.5) / 2.05,
    (wall.z - depth * 0.5) / 2.05,
    0,
    0,
    (wall.x - width * 0.5) / 2.05,
    -(wall.x + width * 0.5) / 2.05,
  ];
  const faceScales: Array<[number, number]> = [
    [depth / 2.05, wall.height / 2.45],
    [depth / 2.05, wall.height / 2.45],
    [width / 2.05, depth / 2.05],
    [width / 2.05, depth / 2.05],
    [width / 2.05, wall.height / 2.45],
    [width / 2.05, wall.height / 2.45],
  ];
  for (let face = 0; face < 6; face += 1) {
    const [baseUScale, baseVScale] = faceScales[face]!;
    const verticalFace = face !== 2 && face !== 3;
    const uScale = (verticalFace ? baseUScale : Math.max(0.12, baseUScale)) * patternScale;
    const vScale = (verticalFace ? baseVScale : Math.max(0.12, baseVScale)) * patternScale;
    const worldUOffset = verticalFace
      ? faceWorldUOffsets[face]! * patternScale + texturePhase.u
      : 0;
    for (let vertex = 0; vertex < 4; vertex += 1) {
      const index = face * 4 + vertex;
      uv.setXY(
        index,
        uv.getX(index) * uScale + worldUOffset,
        uv.getY(index) * vScale + (verticalFace ? worldVOffset : 0),
      );
    }
  }
  if (capless) removeHorizontalCaps(geometry);
  if (openEnds) removeWallEndCaps(geometry, wall.orientation);
  geometry.translate(wall.x, wall.bottom + wall.height * 0.5, wall.z);
  setGeometryTint(geometry, wall.tint);
  return geometry;
};

const wallpaperPhaseForWall = (
  seed: string,
  wall: WallSegment,
): { u: number; v: number } => {
  const fixed = wall.orientation === 'x' ? wall.z : wall.x;
  // A plane-sized phase varies where a roll starts from wall to wall, while
  // keeping every fragment of one continuous plane on exactly the same motif.
  const planeAddress = `${wall.orientation}:${(Math.round(fixed * 20) / 20).toFixed(2)}`;
  const rng = new SeededRandom(`${seed}::wallpaper-plane:v1:${planeAddress}`);
  return {
    u: rng.float(0, 1),
    v: rng.float(0, 1),
  };
};

const wallIsShaftLining = (wall: WallSegment): boolean =>
  (
    wall.id.includes('inherited-shaft-') &&
    !wall.id.includes('inherited-shaft-enclosure-')
  ) || wall.id.includes('ceiling-shaft-collar-');

const wallNeedsOpenVerticalShell = (wall: WallSegment): boolean =>
  wallIsShaftLining(wall);

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
 * Builds four thin, capless shaft walls. Their inward textured faces land
 * exactly on the opening bounds, so the surrounding ceiling underside and the
 * vertical lining share one edge when viewed from below. Keeping both vertical
 * sides opaque prevents back-face holes, while removing horizontal caps avoids
 * a raised kerb and coplanar blinking at either end.
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
  patternScale = 1,
  quarterTurn = false,
  surfaceOffset = 0.0012,
  seamOverlap = 0.018,
): THREE.BufferGeometry => {
  const { bounds, axis, riseDirection } = ramp;
  const yAt = (x: number, z: number): number => {
    const rawProgress = axis === 'x'
      ? (x - bounds.minX) / Math.max(1e-6, rectWidth(bounds))
      : (z - bounds.minZ) / Math.max(1e-6, rectDepth(bounds));
    const progress = THREE.MathUtils.clamp(rawProgress, 0, 1);
    return elevation * (riseDirection > 0 ? progress : 1 - progress);
  };
  const renderBounds: Rect = {
    minX: bounds.minX - seamOverlap,
    maxX: bounds.maxX + seamOverlap,
    minZ: bounds.minZ - seamOverlap,
    maxZ: bounds.maxZ + seamOverlap,
  };
  const corners = [
    [renderBounds.minX, renderBounds.minZ],
    [renderBounds.maxX, renderBounds.minZ],
    [renderBounds.maxX, renderBounds.maxZ],
    [renderBounds.minX, renderBounds.maxZ],
  ] as const;
  const positions = corners.flatMap(([x, z]) => [x, yAt(x, z) + surfaceOffset, z]);
  const textureCoords = (x: number, z: number): [number, number] => quarterTurn
    ? [(z / 2.15) * patternScale, (-x / 2.15) * patternScale]
    : [(x / 2.15) * patternScale, (z / 2.15) * patternScale];
  const uvs = corners.flatMap(([x, z]) => textureCoords(x, z));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex([0, 2, 1, 0, 3, 2]);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};

const createSlopedUndersideGeometry = (
  elevation: number,
  ramp: RaisedZoneFeature['ramp'],
  patternScale = 1,
  undersideOffset = -0.16,
): THREE.BufferGeometry => {
  const geometry = createSlopedSurfaceGeometry(
    elevation,
    ramp,
    patternScale,
    false,
    undersideOffset,
    0,
  );
  const sourceIndex = geometry.getIndex();
  if (sourceIndex) {
    const reversed: number[] = [];
    for (let index = 0; index < sourceIndex.count; index += 3) {
      reversed.push(
        sourceIndex.getX(index),
        sourceIndex.getX(index + 2),
        sourceIndex.getX(index + 1),
      );
    }
    geometry.setIndex(reversed);
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};

const createRampSkirtGeometry = (
  elevation: number,
  ramp: RampSurface,
  side: -1 | 1,
  thickness: number,
  patternScale = 1,
): THREE.BufferGeometry => {
  const alongMin = ramp.axis === 'x' ? ramp.bounds.minX : ramp.bounds.minZ;
  const alongMax = ramp.axis === 'x' ? ramp.bounds.maxX : ramp.bounds.maxZ;
  const crossBoundary = ramp.axis === 'x'
    ? side < 0 ? ramp.bounds.minZ : ramp.bounds.maxZ
    : side < 0 ? ramp.bounds.minX : ramp.bounds.maxX;
  const outerCross = crossBoundary + side * thickness * 0.5;
  const innerCross = crossBoundary - side * thickness * 0.5;
  const yAt = (along: number): number => {
    const progress = THREE.MathUtils.clamp(
      (along - alongMin) / Math.max(1e-6, alongMax - alongMin),
      0,
      1,
    );
    return elevation * (ramp.riseDirection > 0 ? progress : 1 - progress);
  };
  const point = (along: number, cross: number, y: number): THREE.Vector3 =>
    ramp.axis === 'x'
      ? new THREE.Vector3(along, y, cross)
      : new THREE.Vector3(cross, y, along);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const appendCurtain = (cross: number, normalSign: -1 | 1): void => {
    const corners = [
      point(alongMin, cross, 0),
      point(alongMax, cross, 0),
      point(alongMax, cross, yAt(alongMax)),
      point(alongMin, cross, yAt(alongMin)),
    ];
    const desiredNormal = ramp.axis === 'x'
      ? new THREE.Vector3(0, 0, normalSign)
      : new THREE.Vector3(normalSign, 0, 0);
    const first = positions.length / 3;
    for (const corner of corners) {
      positions.push(corner.x, corner.y, corner.z);
      normals.push(desiredNormal.x, desiredNormal.y, desiredNormal.z);
      const along = ramp.axis === 'x' ? corner.x : corner.z;
      uvs.push(
        (along / 2.05) * patternScale,
        (corner.y / 2.45) * patternScale,
      );
    }
    const rawNormal = new THREE.Vector3()
      .subVectors(corners[1]!, corners[0]!)
      .cross(new THREE.Vector3().subVectors(corners[2]!, corners[0]!));
    if (rawNormal.lengthSq() < 1e-10) {
      rawNormal
        .subVectors(corners[2]!, corners[0]!)
        .cross(new THREE.Vector3().subVectors(corners[3]!, corners[0]!));
    }
    if (rawNormal.dot(desiredNormal) >= 0) {
      indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
    } else {
      indices.push(first, first + 2, first + 1, first, first + 3, first + 2);
    }
  };

  // Only the two vertical curtains are needed. A horizontal or sloped cap
  // would overlap the carpet's seam extension and flicker through it.
  appendCurtain(outerCross, side);
  appendCurtain(innerCross, side < 0 ? 1 : -1);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  setGeometryTint(geometry, 0.96);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};

/** Thin wall-papered edge joining an epic stair tread to its underside. */
const createSlopedStairFasciaGeometry = (
  elevation: number,
  ramp: RampSurface,
  side: -1 | 1,
  depth = 0.184,
  patternScale = 1,
): THREE.BufferGeometry => {
  const alongMin = ramp.axis === 'x' ? ramp.bounds.minX : ramp.bounds.minZ;
  const alongMax = ramp.axis === 'x' ? ramp.bounds.maxX : ramp.bounds.maxZ;
  const cross = ramp.axis === 'x'
    ? side < 0 ? ramp.bounds.minZ : ramp.bounds.maxZ
    : side < 0 ? ramp.bounds.minX : ramp.bounds.maxX;
  const yAt = (along: number): number => {
    const progress = (along - alongMin) / Math.max(1e-6, alongMax - alongMin);
    return elevation * (ramp.riseDirection > 0 ? progress : 1 - progress);
  };
  const point = (along: number, y: number): THREE.Vector3 => ramp.axis === 'x'
    ? new THREE.Vector3(along, y, cross)
    : new THREE.Vector3(cross, y, along);
  const topOffset = 0.004;
  const corners = [
    point(alongMin, yAt(alongMin) - depth),
    point(alongMax, yAt(alongMax) - depth),
    point(alongMax, yAt(alongMax) + topOffset),
    point(alongMin, yAt(alongMin) + topOffset),
  ];
  const desiredNormal = ramp.axis === 'x'
    ? new THREE.Vector3(0, 0, side)
    : new THREE.Vector3(side, 0, 0);
  const rawNormal = new THREE.Vector3()
    .subVectors(corners[1]!, corners[0]!)
    .cross(new THREE.Vector3().subVectors(corners[2]!, corners[0]!));
  const indices = rawNormal.dot(desiredNormal) >= 0
    ? [0, 1, 2, 0, 2, 3]
    : [0, 2, 1, 0, 3, 2];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(
    corners.flatMap((corner) => [corner.x, corner.y, corner.z]),
    3,
  ));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(
    corners.flatMap(() => [desiredNormal.x, desiredNormal.y, desiredNormal.z]),
    3,
  ));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(
    corners.flatMap((corner) => {
      const along = ramp.axis === 'x' ? corner.x : corner.z;
      return [(along / 2.05) * patternScale, (corner.y / 2.45) * patternScale];
    }),
    2,
  ));
  geometry.setIndex(indices);
  setGeometryTint(geometry, 0.96);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};

/** Four capless wallpaper faces around a landing slab. */
const createRectFasciaGeometry = (
  rect: Rect,
  bottom: number,
  top: number,
  patternScale = 1,
  outsideOpening = false,
): THREE.BufferGeometry => {
  const offset = outsideOpening ? 0.01 : 0;
  const geometries = [
    createTexturedBoxGeometry(rectWidth(rect), top - bottom, 0.02, rectCenter(rect).x, bottom, rect.minZ - offset, 0.94, patternScale),
    createTexturedBoxGeometry(rectWidth(rect), top - bottom, 0.02, rectCenter(rect).x, bottom, rect.maxZ + offset, 0.94, patternScale),
    createTexturedBoxGeometry(0.02, top - bottom, rectDepth(rect), rect.minX - offset, bottom, rectCenter(rect).z, 0.94, patternScale),
    createTexturedBoxGeometry(0.02, top - bottom, rectDepth(rect), rect.maxX + offset, bottom, rectCenter(rect).z, 0.94, patternScale),
  ].map(removeHorizontalCaps);
  return mergeOrSingle(geometries)!;
};

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

const wallFootprint = (wall: WallSegment): Rect => {
  const halfLength = wall.length * 0.5;
  const halfThickness = wall.thickness * 0.5;
  return wall.orientation === 'x'
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
};

const subtractRect = (source: Rect, cut: Rect): Rect[] => {
  const overlap = intersectRects(source, cut);
  if (!overlap) return [source];
  const pieces: Rect[] = [];
  if (source.minX < overlap.minX - 1e-4) {
    pieces.push({
      minX: source.minX,
      maxX: overlap.minX,
      minZ: source.minZ,
      maxZ: source.maxZ,
    });
  }
  if (overlap.maxX < source.maxX - 1e-4) {
    pieces.push({
      minX: overlap.maxX,
      maxX: source.maxX,
      minZ: source.minZ,
      maxZ: source.maxZ,
    });
  }
  if (source.minZ < overlap.minZ - 1e-4) {
    pieces.push({
      minX: overlap.minX,
      maxX: overlap.maxX,
      minZ: source.minZ,
      maxZ: overlap.minZ,
    });
  }
  if (overlap.maxZ < source.maxZ - 1e-4) {
    pieces.push({
      minX: overlap.minX,
      maxX: overlap.maxX,
      minZ: overlap.maxZ,
      maxZ: source.maxZ,
    });
  }
  return pieces;
};

const subtractRects = (sources: readonly Rect[], cuts: readonly Rect[]): Rect[] =>
  cuts.reduce<Rect[]>(
    (pieces, cut) => pieces.flatMap((piece) => subtractRect(piece, cut)),
    [...sources],
  );

const createHorizontalJunctionRepairGeometry = (
  walls: readonly WallSegment[],
  clipRects: readonly Rect[],
  worldSize: number,
  wallHeight: number,
  surface: 'floor' | 'ceiling',
  patternScale = 1,
  floorQuarterTurn = false,
): { geometry: THREE.BufferGeometry | null; patches: Rect[] } => {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const lightMapUvs: number[] = [];
  const indices: number[] = [];
  const halfWorld = worldSize * 0.5;
  const texelSize = bakedLightMapTexelSize(worldSize);
  const repairWidth = texelSize * 1.05;
  const y = surface === 'floor' ? 0.002 : wallHeight;
  const normalY = surface === 'floor' ? 1 : -1;
  const occupiedPatches: Rect[] = [];

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
        if (floorQuarterTurn) {
          uvs.push((z / 2.15) * patternScale, (-x / 2.15) * patternScale);
        } else {
          uvs.push((x / 2.15) * patternScale, (z / 2.15) * patternScale);
        }
      } else {
        uvs.push((x / 2.4) * patternScale, (z / 2.4) * patternScale);
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

  const addVisiblePatch = (rect: Rect, wall: WallSegment, side: -1 | 1): void => {
    let visiblePieces = [rect];
    for (const occupied of occupiedPatches) {
      visiblePieces = visiblePieces.flatMap((piece) => subtractRect(piece, occupied));
      if (visiblePieces.length === 0) return;
    }
    for (const piece of visiblePieces) {
      addPatch(piece, wall, side);
      occupiedPatches.push(piece);
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
        if (clipped) addVisiblePatch(clipped, wall, side);
      }
    }
  }

  if (positions.length === 0) return { geometry: null, patches: [] };
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('uv1', new THREE.Float32BufferAttribute(lightMapUvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, patches: occupiedPatches };
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
    const x = center.x + (uv.getX(index) - 0.5) * width;
    const z = center.z + (uv.getY(index) - 0.5) * depth;
    uv.setXY(
      index,
      (x / 2.4) * patternScale,
      (z / 2.4) * patternScale,
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

interface RectBoundarySegment {
  orientation: 'x' | 'z';
  fixed: number;
  min: number;
  max: number;
  inward: -1 | 1;
}

const subtractInterval = (
  intervals: Array<{ min: number; max: number }>,
  cutMin: number,
  cutMax: number,
): Array<{ min: number; max: number }> =>
  intervals.flatMap((interval) => {
    if (cutMax <= interval.min + 1e-4 || cutMin >= interval.max - 1e-4) return [interval];
    const pieces: Array<{ min: number; max: number }> = [];
    if (cutMin > interval.min + 1e-4) {
      pieces.push({ min: interval.min, max: Math.min(interval.max, cutMin) });
    }
    if (cutMax < interval.max - 1e-4) {
      pieces.push({ min: Math.max(interval.min, cutMax), max: interval.max });
    }
    return pieces;
  });

const exposedRectBoundaries = (
  rects: readonly Rect[],
  rampOpenings: readonly RampSurface[] = [],
): RectBoundarySegment[] => {
  const result: RectBoundarySegment[] = [];
  for (const [rectIndex, rect] of rects.entries()) {
    const sides = [
      {
        orientation: 'x' as const,
        fixed: rect.minZ,
        min: rect.minX,
        max: rect.maxX,
        inward: 1 as const,
        adjacent: (other: Rect) => Math.abs(other.maxZ - rect.minZ) < 0.02,
        overlap: (other: Rect) => ({ min: other.minX, max: other.maxX }),
      },
      {
        orientation: 'x' as const,
        fixed: rect.maxZ,
        min: rect.minX,
        max: rect.maxX,
        inward: -1 as const,
        adjacent: (other: Rect) => Math.abs(other.minZ - rect.maxZ) < 0.02,
        overlap: (other: Rect) => ({ min: other.minX, max: other.maxX }),
      },
      {
        orientation: 'z' as const,
        fixed: rect.minX,
        min: rect.minZ,
        max: rect.maxZ,
        inward: 1 as const,
        adjacent: (other: Rect) => Math.abs(other.maxX - rect.minX) < 0.02,
        overlap: (other: Rect) => ({ min: other.minZ, max: other.maxZ }),
      },
      {
        orientation: 'z' as const,
        fixed: rect.maxX,
        min: rect.minZ,
        max: rect.maxZ,
        inward: -1 as const,
        adjacent: (other: Rect) => Math.abs(other.minX - rect.maxX) < 0.02,
        overlap: (other: Rect) => ({ min: other.minZ, max: other.maxZ }),
      },
    ];
    for (const side of sides) {
      let intervals = [{ min: side.min, max: side.max }];
      for (const [otherIndex, other] of rects.entries()) {
        if (otherIndex === rectIndex || !side.adjacent(other)) continue;
        const overlap = side.overlap(other);
        intervals = subtractInterval(intervals, overlap.min, overlap.max);
      }
      for (const ramp of rampOpenings) {
        const touchesBoundary = side.orientation === 'x'
          ? ramp.axis === 'z' &&
            (
              Math.abs(ramp.bounds.minZ - side.fixed) < 0.02 ||
              Math.abs(ramp.bounds.maxZ - side.fixed) < 0.02
            )
          : ramp.axis === 'x' &&
            (
              Math.abs(ramp.bounds.minX - side.fixed) < 0.02 ||
              Math.abs(ramp.bounds.maxX - side.fixed) < 0.02
            );
        if (!touchesBoundary) continue;
        intervals = subtractInterval(
          intervals,
          side.orientation === 'x' ? ramp.bounds.minX : ramp.bounds.minZ,
          side.orientation === 'x' ? ramp.bounds.maxX : ramp.bounds.maxZ,
        );
      }
      for (const interval of intervals) {
        if (interval.max - interval.min <= 1e-4) continue;
        result.push({
          orientation: side.orientation,
          fixed: side.fixed,
          min: interval.min,
          max: interval.max,
          inward: side.inward,
        });
      }
    }
  }
  return result;
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

type EpicFacadeSide = 'north' | 'south' | 'west' | 'east';

const createEpicGlowPanel = (
  width: number,
  depth: number,
  x: number,
  y: number,
  z: number,
): THREE.PlaneGeometry => {
  const geometry = new THREE.PlaneGeometry(width, depth);
  geometry.rotateX(Math.PI * 0.5);
  geometry.translate(x, y, z);
  return geometry;
};

interface EpicFogMaterialOptions {
  readonly name: string;
  readonly color: THREE.Color;
  readonly nearY: number;
  readonly farY: number;
  readonly nearOpacity: number;
  readonly farOpacity: number;
}

const createEpicFogMaterial = (
  options: EpicFogMaterialOptions,
): THREE.ShaderMaterial => new THREE.ShaderMaterial({
  name: options.name,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  fog: false,
  toneMapped: false,
  uniforms: {
    fogColor: { value: options.color },
    nearY: { value: options.nearY },
    farY: { value: options.farY },
    nearOpacity: { value: options.nearOpacity },
    farOpacity: { value: options.farOpacity },
    fogTime: { value: 0 },
  },
  vertexShader: `
    uniform float nearY;
    uniform float farY;
    varying vec2 vFogUv;
    varying vec2 vFogPosition;
    varying float vFogDepth;
    void main() {
      vFogUv = uv;
      vFogPosition = position.xz;
      vFogDepth = clamp((position.y - nearY) / (farY - nearY), 0.0, 1.0);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 fogColor;
    uniform float nearOpacity;
    uniform float farOpacity;
    uniform float fogTime;
    varying vec2 vFogUv;
    varying vec2 vFogPosition;
    varying float vFogDepth;

    float fogHash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float fogNoise(vec2 p) {
      vec2 cell = floor(p);
      vec2 local = fract(p);
      local = local * local * (3.0 - 2.0 * local);
      return mix(
        mix(fogHash(cell), fogHash(cell + vec2(1.0, 0.0)), local.x),
        mix(fogHash(cell + vec2(0.0, 1.0)), fogHash(cell + vec2(1.0)), local.x),
        local.y
      );
    }

    float fogFbm(vec2 p) {
      float value = 0.0;
      float amplitude = 0.55;
      for (int octave = 0; octave < 2; octave++) {
        value += amplitude * fogNoise(p);
        p = p * 2.03 + vec2(7.13, 3.71);
        amplitude *= 0.48;
      }
      return value;
    }

    void main() {
      float border = min(
        min(vFogUv.x, 1.0 - vFogUv.x),
        min(vFogUv.y, 1.0 - vFogUv.y)
      );
      float edgeFade = smoothstep(0.0, 0.105, border);
      vec2 drift = vec2(fogTime * 0.011, -fogTime * 0.007);
      float body = fogFbm(vFogPosition * 0.052 + drift + vFogDepth * vec2(2.7, -1.9));
      float detail = fogNoise(vFogPosition * 0.19 - drift * 1.7 + body * 2.4);
      float density = mix(nearOpacity, farOpacity, smoothstep(0.0, 1.0, vFogDepth));
      float wisps = mix(0.56, 1.22, clamp(body * 0.78 + detail * 0.22, 0.0, 1.0));
      float alpha = clamp(edgeFade * density * wisps, 0.0, 0.82);
      gl_FragColor = vec4(fogColor, alpha);
    }
  `,
});

const createEpicVerticalPreviewPanel = (
  width: number,
  height: number,
  x: number,
  bottom: number,
  z: number,
  faceTowardPositiveZ: boolean,
): THREE.PlaneGeometry => {
  const geometry = new THREE.PlaneGeometry(width, height);
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  for (let index = 0; index < uv.count; index += 1) {
    const worldX = x + (uv.getX(index) - 0.5) * width;
    const worldY = bottom + uv.getY(index) * height;
    uv.setXY(index, worldX / 2.05, worldY / 2.45);
  }
  if (!faceTowardPositiveZ) geometry.rotateY(Math.PI);
  geometry.translate(x, bottom + height * 0.5, z);
  return geometry;
};

const createEpicPassagePreviewPanel = (
  passage: EpicPassagePreview,
  facade: Rect,
  bottom: number,
  recess = 0.78,
): THREE.PlaneGeometry => {
  const outward = passage.side === 'north' || passage.side === 'west' ? -1 : 1;
  const fixed = passage.side === 'north'
    ? facade.minZ
    : passage.side === 'south'
      ? facade.maxZ
      : passage.side === 'west'
        ? facade.minX
        : facade.maxX;
  const geometry = new THREE.PlaneGeometry(passage.width, EPIC1_PORTAL_HEIGHT);
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  for (let index = 0; index < uv.count; index += 1) {
    uv.setXY(
      index,
      (passage.along + (uv.getX(index) - 0.5) * passage.width) / 2.05,
      (bottom + uv.getY(index) * EPIC1_PORTAL_HEIGHT) / 2.45,
    );
  }
  if (passage.side === 'south') geometry.rotateY(Math.PI);
  else if (passage.side === 'west') geometry.rotateY(Math.PI * 0.5);
  else if (passage.side === 'east') geometry.rotateY(-Math.PI * 0.5);
  geometry.translate(
    passage.side === 'west' || passage.side === 'east'
      ? fixed + outward * recess
      : passage.along,
    bottom + EPIC1_PORTAL_HEIGHT * 0.5,
    passage.side === 'north' || passage.side === 'south'
      ? fixed + outward * recess
      : passage.along,
  );
  return geometry;
};

const createEpicPortalSoffit = (
  passage: EpicPassagePreview,
  facade: Rect,
  floorY: number,
  patternScale: number,
): THREE.BufferGeometry => {
  const halfWidth = passage.width * 0.5;
  const revealDepth = 0.46;
  const fixed = passage.side === 'north'
    ? facade.minZ
    : passage.side === 'south'
      ? facade.maxZ
      : passage.side === 'west'
        ? facade.minX
        : facade.maxX;
  const rect: Rect = passage.side === 'north' || passage.side === 'south'
    ? {
        minX: passage.along - halfWidth,
        maxX: passage.along + halfWidth,
        minZ: fixed - revealDepth * 0.5,
        maxZ: fixed + revealDepth * 0.5,
      }
    : {
        minX: fixed - revealDepth * 0.5,
        maxX: fixed + revealDepth * 0.5,
        minZ: passage.along - halfWidth,
        maxZ: passage.along + halfWidth,
      };
  // A real reveal sits below the tiled corridor ceiling. This is a separate
  // construction layer, not a coplanar offset used to hide z-fighting.
  return createCeilingGeometry(rect, floorY + EPIC1_PORTAL_HEIGHT - 0.018, patternScale);
};

const splitEpicFacadeIntervals = (
  min: number,
  max: number,
  passages: readonly EpicPassagePreview[],
): Array<{ min: number; max: number }> => {
  let intervals = [{ min, max }];
  for (const passage of passages) {
    const openingMin = passage.along - passage.width * 0.5;
    const openingMax = passage.along + passage.width * 0.5;
    intervals = intervals.flatMap((interval) => {
      if (openingMax <= interval.min || openingMin >= interval.max) return [interval];
      const fragments: Array<{ min: number; max: number }> = [];
      if (openingMin - interval.min > 0.04) fragments.push({ min: interval.min, max: openingMin });
      if (interval.max - openingMax > 0.04) fragments.push({ min: openingMax, max: interval.max });
      return fragments;
    });
  }
  return intervals;
};

const createEpicFacadeBandGeometries = (
  bounds: Rect,
  passages: readonly EpicPassagePreview[],
  bottom: number,
  bandHeight: number,
  portalHeight: number,
  sides: readonly EpicFacadeSide[],
  tint: number,
  removeFloorCaps = false,
): THREE.BufferGeometry[] => {
  const geometries: THREE.BufferGeometry[] = [];
  const thickness = 0.36;
  for (const side of sides) {
    const horizontal = side === 'north' || side === 'south';
    const fixed = side === 'north'
      ? bounds.minZ
      : side === 'south'
        ? bounds.maxZ
        : side === 'west'
          ? bounds.minX
          : bounds.maxX;
    const sidePassages = passages.filter((passage) => passage.side === side);
    const min = horizontal ? bounds.minX : bounds.minZ;
    const max = horizontal ? bounds.maxX : bounds.maxZ;
    for (const interval of splitEpicFacadeIntervals(min, max, sidePassages)) {
      const length = interval.max - interval.min;
      const along = (interval.min + interval.max) * 0.5;
      const geometry = createTexturedBoxGeometry(
        horizontal ? length : thickness,
        bandHeight,
        horizontal ? thickness : length,
        horizontal ? along : fixed,
        bottom,
        horizontal ? fixed : along,
        tint,
      );
      geometries.push(removeFloorCaps ? removeHorizontalCaps(geometry) : geometry);
    }
    const lintelHeight = bandHeight - portalHeight;
    if (lintelHeight <= 0.04) continue;
    for (const passage of sidePassages) {
      const lintel = createTexturedBoxGeometry(
        horizontal ? passage.width : thickness,
        lintelHeight,
        horizontal ? thickness : passage.width,
        horizontal ? passage.along : fixed,
        bottom + portalHeight,
        horizontal ? fixed : passage.along,
        Math.min(1, tint + 0.035),
      );
      geometries.push(removeFloorCaps ? removeHorizontalCaps(lintel) : lintel);
    }
  }
  return geometries;
};

const createEpicCorridorPreviewGeometries = (
  passage: EpicPassagePreview,
  facade: Rect,
  floorY: number,
  portalHeight: number,
  layout = getEpicAbyssPassageLayout(passage, facade),
): { floors: THREE.BufferGeometry[]; walls: THREE.BufferGeometry[]; ceilings: THREE.BufferGeometry[] } => {
  const boxForRect = (
    rect: Rect,
    height: number,
    bottom: number,
    tint: number,
  ): THREE.BufferGeometry => {
    const center = rectCenter(rect);
    return createTexturedBoxGeometry(
      rectWidth(rect),
      height,
      rectDepth(rect),
      center.x,
      bottom,
      center.z,
      tint,
    );
  };
  return {
    floors: layout.floorRects.map((rect) => boxForRect(rect, 0.2, floorY - 0.2, 0.86)),
    walls: layout.wallRects.map((rect) =>
      removeHorizontalCaps(boxForRect(rect, portalHeight, floorY, 0.9))
    ),
    ceilings: layout.ceilingRects.map((rect) =>
      boxForRect(rect, 0.18, floorY + portalHeight, 0.91)
    ),
  };
};

const createPreviewMaterial = (
  source: THREE.MeshStandardMaterial,
  name: string,
  emissive: number,
  emissiveIntensity: number,
): THREE.MeshStandardMaterial => {
  const legacyBakedSource = source.lightMap !== null;
  const material = source.clone();
  material.name = name;
  material.lightMap = null;
  material.emissive.setHex(emissive);
  material.emissiveIntensity = Math.max(material.emissiveIntensity, emissiveIntensity);
  if (name === 'preview-ceiling') {
    // A uniform emissive lift washes the tile grid out when this surface is
    // viewed through a shaft. Modulating it with the albedo keeps the preview
    // bright while making the upper ceiling unmistakably readable.
    if (material.map) material.emissiveMap = material.map;
    if (legacyBakedSource) material.fog = false;
  }
  material.onBeforeCompile = source.onBeforeCompile;
  material.customProgramCacheKey = source.customProgramCacheKey;
  material.needsUpdate = true;
  return material;
};

const createLowerStoreyMaterial = (
  source: THREE.MeshStandardMaterial,
  name: string,
): THREE.MeshStandardMaterial => {
  const material = source.clone();
  material.name = name;
  material.lightMap = null;
  material.onBeforeCompile = source.onBeforeCompile;
  material.customProgramCacheKey = source.customProgramCacheKey;
  material.needsUpdate = true;
  return material;
};

const DISTANT_CEILING_THRESHOLD = 18;

const distantCeilingPatternScale = (
  baseScale: number,
  ceilingHeight: number,
): number => baseScale * THREE.MathUtils.clamp(14 / ceilingHeight, 0.24, 1);

const createElevatedCeilingMaterial = (
  source: THREE.MeshStandardMaterial,
  name: string,
): THREE.MeshStandardMaterial => {
  const material = source.clone();
  material.name = name;
  // Elevated ceilings must react to light exactly like the ordinary ceiling.
  // Only the double-sided rendering differs because these planes can also be
  // seen from connecting shafts and upper passages.
  material.lightMap = null;
  material.side = THREE.DoubleSide;
  material.onBeforeCompile = source.onBeforeCompile;
  material.customProgramCacheKey = source.customProgramCacheKey;
  material.needsUpdate = true;
  return material;
};

export interface TraversalWorldInteraction {
  kind: 'traversal';
  label: string;
  path: Vec3Data[];
  duration: number;
  duckDepth: number;
}

export interface DoorWorldInteraction {
  kind: 'door';
  label: string;
  doorId: string;
  colliderId: string;
}

export type WorldInteraction = TraversalWorldInteraction | DoorWorldInteraction;

const DEFAULT_SURFACE_STYLE: SurfaceStyle = {
  wallTint: 1,
  floorTint: 1,
  ceilingTint: 1,
  wallPatternScale: 1,
  floorPatternScale: 1,
  ceilingPatternScale: 1,
  floorQuarterTurn: false,
};

export interface WorldViewOptions {
  lightingMode?: LightingMode;
  bakedLightMaps?: BakedLightMapData;
}

export class WorldView {
  readonly group = new THREE.Group();
  readonly ready: Promise<void>;
  private readonly emitterMesh: THREE.InstancedMesh;
  private readonly fixtureSlots: LightSlot[];
  private readonly previewMaterials: Pick<
    MaterialSet,
    'wall' | 'floor' | 'ceiling' | 'baseboard'
  >;
  private readonly lowerMaterials: Pick<
    MaterialSet,
    'wall' | 'floor' | 'ceiling' | 'baseboard'
  >;
  private readonly materials: MaterialSet;
  private readonly elevatedCeilingMaterial: THREE.MeshStandardMaterial;
  private readonly distantCeilingMaterial: THREE.MeshStandardMaterial;
  private readonly previewFixtureGlowMaterial: THREE.MeshBasicMaterial;
  private readonly lightingContext?: ZonalLightingContext;
  private readonly bakedLightMaps?: BakedLightMaps;
  private readonly ownedMaterials: THREE.Material[];
  private readonly animatedFogMaterials: THREE.ShaderMaterial[] = [];
  private readonly graffitiTextures: THREE.CanvasTexture[] = [];
  private readonly graffitiMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly surfaceStyle: SurfaceStyle;
  private readonly propLayer: WorldPropLayer;
  private readonly doorLayer: WorldDoorLayer;

  constructor(
    readonly plan: WorldPlan,
    sourceMaterials: MaterialSet,
    options: WorldViewOptions = {},
  ) {
    this.group.name = `world-${plan.seed}`;
    if (options.lightingMode === 'legacy') {
      this.bakedLightMaps = createBakedLightMaps(plan, options.bakedLightMaps);
      const baked = createBakedMaterialSet(sourceMaterials, this.bakedLightMaps, plan.size);
      this.materials = baked.materials;
      this.ownedMaterials = baked.ownedMaterials;
    } else {
      const zonal = createZonalMaterialSet(sourceMaterials, plan);
      this.materials = zonal.materials;
      this.lightingContext = zonal.context;
      this.ownedMaterials = zonal.ownedMaterials;
    }
    this.surfaceStyle = plan.surfaceStyle ?? DEFAULT_SURFACE_STYLE;
    this.materials.wall.color.multiplyScalar(this.surfaceStyle.wallTint);
    this.materials.plaster.color.multiplyScalar(this.surfaceStyle.wallTint);
    this.materials.floor.color.multiplyScalar(this.surfaceStyle.floorTint);
    this.materials.ceiling.color.multiplyScalar(this.surfaceStyle.ceilingTint);
    this.materials.baseboard.color.multiplyScalar(
      (this.surfaceStyle.wallTint + this.surfaceStyle.floorTint) * 0.5,
    );
    this.elevatedCeilingMaterial = createElevatedCeilingMaterial(
      this.materials.ceiling,
      'elevated-tiled-ceiling',
    );
    this.distantCeilingMaterial = createElevatedCeilingMaterial(
      this.materials.ceiling,
      'distant-tiled-ceiling',
    );
    this.previewFixtureGlowMaterial = this.materials.fixtureGlow.clone();
    this.previewFixtureGlowMaterial.name = 'preview-fluorescent-diffuser';
    this.previewFixtureGlowMaterial.side = THREE.FrontSide;
    this.ownedMaterials.push(
      this.elevatedCeilingMaterial,
      this.distantCeilingMaterial,
      this.previewFixtureGlowMaterial,
    );
    this.lowerMaterials = {
      wall: createLowerStoreyMaterial(this.materials.wall, 'lower-storey-wallpaper'),
      floor: createLowerStoreyMaterial(this.materials.floor, 'lower-storey-carpet'),
      ceiling: createLowerStoreyMaterial(this.materials.ceiling, 'lower-storey-ceiling'),
      baseboard: createLowerStoreyMaterial(this.materials.baseboard, 'lower-storey-baseboard'),
    };
    const previewGlow = plan.visualBiome === 'red'
      ? {
          wall: 0x6f0906,
          floor: 0x510604,
          ceiling: 0x790c08,
          baseboard: 0x4e0504,
        }
      : plan.visualBiome === 'white'
        ? {
            wall: 0x465052,
            floor: 0x3b4446,
            ceiling: 0x566165,
            baseboard: 0x3d4547,
          }
        : {
            wall: 0x77713a,
            floor: 0x686331,
            ceiling: 0x918743,
            baseboard: 0x5f592b,
          };
    this.previewMaterials = {
      wall: createPreviewMaterial(this.materials.wall, 'preview-wallpaper', previewGlow.wall, 0.13),
      floor: createPreviewMaterial(this.materials.floor, 'preview-carpet', previewGlow.floor, 0.09),
      ceiling: createPreviewMaterial(this.materials.ceiling, 'preview-ceiling', previewGlow.ceiling, 0.16),
      baseboard: createPreviewMaterial(this.materials.baseboard, 'preview-baseboard', previewGlow.baseboard, 0.1),
    };
    this.previewMaterials.wall.color.multiplyScalar(this.surfaceStyle.wallTint);
    this.previewMaterials.floor.color.multiplyScalar(this.surfaceStyle.floorTint);
    this.previewMaterials.ceiling.color.multiplyScalar(this.surfaceStyle.ceilingTint);
    // A lower-storey preview is also observed from above through the stair
    // opening. Its ceiling must still occlude the fixtures and room floor from
    // that back side instead of disappearing through face culling.
    this.previewMaterials.ceiling.side = THREE.DoubleSide;
    this.previewMaterials.baseboard.color.multiplyScalar(this.surfaceStyle.wallTint);
    this.ownedMaterials.push(
      ...Object.values(this.lowerMaterials),
      ...Object.values(this.previewMaterials),
    );
    this.fixtureSlots = plan.lights;
    this.buildArchitecture();
    this.buildEpicStructures();
    this.buildWallGraffiti();
    this.buildRaisedZones();
    this.buildLowPassages();
    this.emitterMesh = this.buildFixtures();
    this.buildPitFeatures();
    this.buildStairs();
    this.buildCeilingDamage();
    this.buildImpossibleVista();
    if (this.bakedLightMaps) {
      this.group.traverse((object) => {
        if (!(object instanceof THREE.Mesh || object instanceof THREE.InstancedMesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) ensureBakedLightUv(object.geometry, material, 0.28);
      });
    }
    this.doorLayer = new WorldDoorLayer(plan, this.lightingContext ?? null);
    this.group.add(this.doorLayer.group);
    this.propLayer = new WorldPropLayer(plan, this.lightingContext ?? null);
    this.group.add(this.propLayer.group);
    this.ready = Promise.all([this.doorLayer.ready, this.propLayer.ready]).then(() => undefined);
  }

  private buildWallGraffiti(): void {
    const placements = selectWallGraffiti(this.plan);
    if (placements.length === 0 || typeof document === 'undefined') return;
    const group = new THREE.Group();
    group.name = 'procedural-handwritten-wall-graffiti';
    for (const placement of placements) {
      const created = createGraffitiMesh(placement);
      if (!created) continue;
      if (this.lightingContext) applyZonalLighting(created.mesh.material, this.lightingContext);
      group.add(created.mesh);
      this.graffitiTextures.push(created.texture);
      this.graffitiMaterials.push(created.mesh.material);
    }
    if (group.children.length > 0) this.group.add(group);
  }

  private buildArchitecture(): void {
    const wallGeometries: THREE.BufferGeometry[] = [];
    const lowerWallGeometries: THREE.BufferGeometry[] = [];
    const shaftCarpetGeometries: THREE.BufferGeometry[] = [];
    const plasterGeometries: THREE.BufferGeometry[] = [];
    const baseboardGeometries: THREE.BufferGeometry[] = [];
    const lowerBaseboardGeometries: THREE.BufferGeometry[] = [];
    const baseboardlessZones = this.plan.baseboardlessZones ?? [];
    const elevationFeatures = this.plan.features.filter(
      (feature): feature is RaisedZoneFeature => feature.kind === 'raised-zone',
    );
    const highCeilingRooms = this.plan.rooms.filter(
      (room) => room.level >= 0 && room.ceilingHeight > this.plan.wallHeight + 0.1,
    );
    const portalLintels = this.plan.walls.filter(
      (wall) => wall.detail === 'upper-portal-lintel',
    );
    const lintelDirectlyHasHighCeilingOnBothSides = (wall: WallSegment): boolean => {
      const along = wall.orientation === 'x' ? wall.x : wall.z;
      const fixed = wall.orientation === 'x' ? wall.z : wall.x;
      const sampleOffset = wall.thickness * 0.5 + 0.04;
      return ([-1, 1] as const).every((side) => {
        const x = wall.orientation === 'x' ? along : fixed + side * sampleOffset;
        const z = wall.orientation === 'x' ? fixed + side * sampleOffset : along;
        return highCeilingRooms.some((room) => pointInRect(x, z, room.bounds, 0.02));
      });
    };
    const lintelGroups = new Map<string, boolean>();
    const visitedLintelIds = new Set<string>();
    const lintelsTouch = (left: WallSegment, right: WallSegment): boolean => {
      if (left.orientation !== right.orientation) return false;
      if (
        Math.abs(left.bottom - right.bottom) >= 0.03 ||
        Math.abs(left.bottom + left.height - right.bottom - right.height) >= 0.03 ||
        Math.abs(left.thickness - right.thickness) >= 0.03
      ) return false;
      const leftFixed = left.orientation === 'x' ? left.z : left.x;
      const rightFixed = right.orientation === 'x' ? right.z : right.x;
      if (Math.abs(leftFixed - rightFixed) >= 0.12) return false;
      const leftAlong = left.orientation === 'x' ? left.x : left.z;
      const rightAlong = right.orientation === 'x' ? right.x : right.z;
      const leftMin = leftAlong - left.length * 0.5;
      const leftMax = leftAlong + left.length * 0.5;
      const rightMin = rightAlong - right.length * 0.5;
      const rightMax = rightAlong + right.length * 0.5;
      return leftMin <= rightMax + 0.03 && leftMax >= rightMin - 0.03;
    };
    for (const lintel of portalLintels) {
      if (visitedLintelIds.has(lintel.id)) continue;
      const group: WallSegment[] = [];
      const queue = [lintel];
      visitedLintelIds.add(lintel.id);
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const current = queue[cursor]!;
        group.push(current);
        for (const candidate of portalLintels) {
          if (visitedLintelIds.has(candidate.id) || !lintelsTouch(current, candidate)) continue;
          visitedLintelIds.add(candidate.id);
          queue.push(candidate);
        }
      }
      const entirelyBetweenHighRooms = group.every(lintelDirectlyHasHighCeilingOnBothSides);
      for (const member of group) lintelGroups.set(member.id, entirelyBetweenHighRooms);
    }
    const portalLintelHasHighCeilingOnBothSides = (wall: WallSegment): boolean =>
      wall.detail === 'upper-portal-lintel' && lintelGroups.get(wall.id) === true;
    const districtFloorElevations = elevationFeatures.map((feature) => feature.elevation);
    const isInsideBaseboardlessZone = (x: number, z: number): boolean =>
      baseboardlessZones.some((zone) => pointInRect(x, z, zone, 0.02));
    const baseboardlessClaimsForWall = (
      wall: WallSegment,
    ): Array<{ min: number; max: number; side: -1 | 1 }> => {
      const alongCenter = wall.orientation === 'x' ? wall.x : wall.z;
      const fixed = wall.orientation === 'x' ? wall.z : wall.x;
      const wallMin = alongCenter - wall.length * 0.5;
      const wallMax = alongCenter + wall.length * 0.5;
      const sampleOffset = wall.thickness * 0.5 + 0.04;
      const claims = baseboardlessZones.flatMap((zone) => {
        const crossMin = wall.orientation === 'x' ? zone.minZ : zone.minX;
        const crossMax = wall.orientation === 'x' ? zone.maxZ : zone.maxX;
        const min = Math.max(
          wallMin,
          wall.orientation === 'x' ? zone.minX : zone.minZ,
        );
        const max = Math.min(
          wallMax,
          wall.orientation === 'x' ? zone.maxX : zone.maxZ,
        );
        if (max - min <= 0.02) return [];
        return ([-1, 1] as const).flatMap((side) => {
          const sampleFixed = fixed + side * sampleOffset;
          if (sampleFixed < crossMin + 0.02 || sampleFixed > crossMax - 0.02) return [];
          return [{ min, max, side }];
        });
      }).sort((left, right) => left.side - right.side || left.min - right.min);
      const merged: Array<{ min: number; max: number; side: -1 | 1 }> = [];
      for (const claim of claims) {
        const previous = merged[merged.length - 1];
        if (
          previous &&
          previous.side === claim.side &&
          claim.min <= previous.max + 0.02
        ) {
          previous.max = Math.max(previous.max, claim.max);
        } else {
          merged.push({ ...claim });
        }
      }
      return merged;
    };
    const elevationClaimsForWall = (
      wall: WallSegment,
    ): Array<{ min: number; max: number; elevation: number; side: -1 | 1 }> => {
      if (Math.abs(wall.bottom) > 0.12) return [];
      const alongCenter = wall.orientation === 'x' ? wall.x : wall.z;
      const fixed = wall.orientation === 'x' ? wall.z : wall.x;
      const wallMin = alongCenter - wall.length * 0.5;
      const wallMax = alongCenter + wall.length * 0.5;
      const sampleOffset = wall.thickness * 0.5 + 0.04;
      const claims = elevationFeatures.flatMap((feature) =>
        (feature.platformRects ?? [feature.platformBounds]).flatMap((platform) => {
          const crossMin = wall.orientation === 'x' ? platform.minZ : platform.minX;
          const crossMax = wall.orientation === 'x' ? platform.maxZ : platform.maxX;
          const min = Math.max(
            wallMin,
            wall.orientation === 'x' ? platform.minX : platform.minZ,
          );
          const max = Math.min(
            wallMax,
            wall.orientation === 'x' ? platform.maxX : platform.maxZ,
          );
          if (max - min <= 0.02) return [];
          return ([-1, 1] as const).flatMap((side) => {
            const sampleFixed = fixed + side * sampleOffset;
            if (sampleFixed < crossMin - 0.02 || sampleFixed > crossMax + 0.02) return [];
            return [{ min, max, elevation: feature.elevation, side }];
          });
        })
      ).sort((left, right) => left.side - right.side || left.min - right.min);
      const merged: Array<{
        min: number;
        max: number;
        elevation: number;
        side: -1 | 1;
      }> = [];
      for (const claim of claims) {
        const previous = merged[merged.length - 1];
        if (
          previous &&
          previous.side === claim.side &&
          Math.abs(previous.elevation - claim.elevation) < 0.02 &&
          claim.min <= previous.max + 0.02
        ) {
          previous.max = Math.max(previous.max, claim.max);
        } else {
          merged.push({ ...claim });
        }
      }
      return merged;
    };
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
      const isShaftLining = wallIsShaftLining(wall);
      const isLowerStoreyWall = wall.bottom < -INFINITE_STORY_PITCH * 0.55;
      const restsOnWalkableFloor =
        Math.abs(wall.bottom) < 0.12 ||
        Math.abs(wall.bottom + INFINITE_STORY_PITCH) < 0.12 ||
        districtFloorElevations.some((elevation) => Math.abs(wall.bottom - elevation) < 0.12);
      const geometry = createWallGeometry(
        wall,
        wallNeedsOpenVerticalShell(wall) ||
          continuesIntoUpperShell(wall) ||
          wall.detail === 'biome-boundary-skin' ||
          wall.detail === 'biome-boundary-band',
        isShaftLining
          ? this.surfaceStyle.floorPatternScale
          : this.surfaceStyle.wallPatternScale,
        wall.detail === 'biome-boundary-band' ||
          (
            wall.detail === 'biome-boundary-skin' &&
            wall.id.includes('-return-')
          ),
        wallpaperPhaseForWall(this.plan.seed, wall),
      );
      if (
        restsOnWalkableFloor ||
        (
          wall.detail === 'upper-portal-lintel' &&
          !portalLintelHasHighCeilingOnBothSides(wall)
        )
      ) {
        removeBottomCap(geometry);
      }
      const wallMaterial = wall.kind === 'plaster' ? this.materials.plaster : this.materials.wall;
      if (isShaftLining) {
        shaftCarpetGeometries.push(geometry);
      } else if (isLowerStoreyWall) {
        lowerWallGeometries.push(geometry);
      } else {
        ensureBakedLightUv(geometry, wallMaterial, 0.42);
        (wall.kind === 'plaster' ? plasterGeometries : wallGeometries).push(geometry);
      }

      const suppressBaseboard =
        wall.detail === 'lower-shell' ||
        wall.detail === 'biome-boundary-band' ||
        (
          wall.detail === 'biome-boundary-skin' &&
          wall.id.includes('-return-')
        );
      if (wall.height > 1.3 && restsOnWalkableFloor && !suppressBaseboard) {
        const alongX = wall.orientation === 'x';
        const wallAlong = alongX ? wall.x : wall.z;
        const wallMin = wallAlong - wall.length * 0.5;
        const wallMax = wallAlong + wall.length * 0.5;
        const elevationClaims = elevationClaimsForWall(wall);
        const baseboardlessClaims = baseboardlessClaimsForWall(wall);
        const addTrim = (
          min: number,
          max: number,
          bottom: number,
          lowerStorey: boolean,
          side?: -1 | 1,
        ): void => {
          if (max - min <= 0.02) return;
          const length = max - min;
          const alongCenter = (min + max) * 0.5;
          const trimDepth = side === undefined ? wall.thickness + 0.055 : 0.055;
          const trim = new THREE.BoxGeometry(
            alongX ? length + 0.025 : trimDepth,
            0.115,
            alongX ? trimDepth : length + 0.025,
          );
          trim.translate(
            alongX
              ? alongCenter
              : wall.x + (side === undefined ? 0 : side * wall.thickness * 0.5),
            bottom + 0.0575,
            alongX
              ? wall.z + (side === undefined ? 0 : side * wall.thickness * 0.5)
              : alongCenter,
          );
          if (lowerStorey) {
            lowerBaseboardGeometries.push(trim);
          } else {
            ensureBakedLightUv(trim, this.materials.baseboard, 0.36);
            baseboardGeometries.push(trim);
          }
        };
        if (elevationClaims.length === 0 && baseboardlessClaims.length === 0) {
          addTrim(wallMin, wallMax, wall.bottom, isLowerStoreyWall);
        } else {
          for (const side of [-1, 1] as const) {
            const sideElevationClaims = elevationClaims.filter((claim) => claim.side === side);
            const sideBaseboardlessClaims = baseboardlessClaims.filter(
              (claim) => claim.side === side,
            );
            let ordinaryIntervals = [{ min: wallMin, max: wallMax }];
            for (const claim of [...sideElevationClaims, ...sideBaseboardlessClaims]) {
              ordinaryIntervals = subtractInterval(ordinaryIntervals, claim.min, claim.max);
            }
            for (const interval of ordinaryIntervals) {
              addTrim(interval.min, interval.max, wall.bottom, isLowerStoreyWall, side);
            }
            for (const claim of sideElevationClaims) {
              let raisedIntervals = [{ min: claim.min, max: claim.max }];
              for (const baseboardlessClaim of sideBaseboardlessClaims) {
                raisedIntervals = subtractInterval(
                  raisedIntervals,
                  baseboardlessClaim.min,
                  baseboardlessClaim.max,
                );
              }
              for (const interval of raisedIntervals) {
                addTrim(interval.min, interval.max, claim.elevation, false, side);
              }
            }
          }
        }
      }
    }

    for (const column of this.plan.columns) {
      const columnBottom = column.bottom ?? 0;
      const geometry = createTexturedBoxGeometry(
        column.width,
        column.height,
        column.depth,
        column.x,
        columnBottom,
        column.z,
        column.tint,
        this.surfaceStyle.wallPatternScale,
      );
      ensureBakedLightUv(geometry, this.materials.wall, 0.32);
      wallGeometries.push(geometry);
      if (!isInsideBaseboardlessZone(column.x, column.z)) {
        const trim = new THREE.BoxGeometry(column.width + 0.055, 0.115, column.depth + 0.055);
        trim.translate(column.x, columnBottom + 0.0575, column.z);
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
      if (!isInsideBaseboardlessZone(center.x, center.z)) {
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
        for (const trim of massTrims) {
          ensureBakedLightUv(trim, this.materials.baseboard, 0.28);
        }
        baseboardGeometries.push(...massTrims);
      }
    }

    makeMesh(mergeOrSingle(wallGeometries), this.materials.wall, 'merged-wallpaper-walls', this.group);
    makeMesh(
      mergeOrSingle(lowerWallGeometries),
      this.lowerMaterials.wall,
      'lower-storey-wallpaper-walls',
      this.group,
    );
    makeMesh(
      mergeOrSingle(shaftCarpetGeometries),
      this.lowerMaterials.floor,
      'carpet-lined-through-shaft-walls',
      this.group,
    );
    makeMesh(mergeOrSingle(plasterGeometries), this.materials.plaster, 'merged-plaster-walls', this.group);
    makeMesh(mergeOrSingle(baseboardGeometries), this.materials.baseboard, 'merged-baseboards', this.group);
    makeMesh(
      mergeOrSingle(lowerBaseboardGeometries),
      this.lowerMaterials.baseboard,
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
    if ((this.plan.floorOpenings?.length ?? 0) > 0) {
      makeMesh(
        mergeOrSingle(this.plan.floorRects.map((rect) =>
          createCeilingGeometry(rect, -0.12, this.surfaceStyle.ceilingPatternScale)
        )),
        this.lowerMaterials.ceiling,
        'current-floor-structural-underside',
        this.group,
      );
    }

    const worldBounds: Rect = {
      minX: -this.plan.size * 0.5,
      maxX: this.plan.size * 0.5,
      minZ: -this.plan.size * 0.5,
      maxZ: this.plan.size * 0.5,
    };
    const endlessAbyssFeatures = this.plan.features.filter(
      (feature): feature is EpicStructureFeature =>
        feature.kind === 'epic-structure' && feature.variant === 'endless-abyss',
    );
    const endlessAbyssRoomIds = new Set(endlessAbyssFeatures.map((feature) => feature.roomId));
    const tallRooms = this.plan.rooms.filter(
      (room) =>
        room.level >= 0 &&
        room.ceilingHeight > this.plan.wallHeight + 0.1 &&
        !endlessAbyssRoomIds.has(room.id),
    );
    const inheritedCeilingOpenings = [...getInfiniteChunkCeilingOpenings(this.plan)];
    const stairCeilingOpenings = this.plan.stairCeilingOpenings ?? [];
    // A portal adjoining a normal-height room continues that room's ceiling.
    // Between two high rooms, the lintel keeps its wallpaper bottom cap instead,
    // so the suspended ceiling texture does not float across the opening.
    const portalLintelSoffits = this.plan.walls
      .filter((wall) =>
        wall.detail === 'upper-portal-lintel' &&
        !portalLintelHasHighCeilingOnBothSides(wall)
      )
      .flatMap((wall) => {
        const bounds = intersectRects(worldBounds, wallFootprint(wall));
        return bounds ? [{ bounds, y: this.plan.wallHeight }] : [];
      });
    const upperShellSoffits = upperShells.flatMap((wall) => {
      const bounds = intersectRects(worldBounds, wallFootprint(wall));
      return bounds ? [bounds] : [];
    });
    const ceilingOpenings = [
      ...inheritedCeilingOpenings,
      ...stairCeilingOpenings,
      ...tallRooms.map((room) => room.bounds),
      ...endlessAbyssFeatures.map((feature) => feature.bounds),
      ...portalLintelSoffits.map((soffit) => soffit.bounds),
      ...upperShellSoffits,
    ];
    const ceilingRects = ceilingOpenings.length > 0
      ? cellsAroundHoles(worldBounds, ceilingOpenings)
      : [worldBounds];
    const ceilingJunctionRepair = this.bakedLightMaps
      ? createHorizontalJunctionRepairGeometry(
          this.plan.walls,
          ceilingRects,
          this.plan.size,
          this.plan.wallHeight,
          'ceiling',
          this.surfaceStyle.ceilingPatternScale,
        )
      : { geometry: null, patches: [] };
    const visibleCeilingRects = subtractRects(ceilingRects, ceilingJunctionRepair.patches);
    makeMesh(
      mergeOrSingle([
        ...visibleCeilingRects.map((rect) =>
          createCeilingGeometry(rect, this.plan.wallHeight, this.surfaceStyle.ceilingPatternScale)
        ),
        ...portalLintelSoffits.map((soffit) =>
          createCeilingGeometry(soffit.bounds, soffit.y, this.surfaceStyle.ceilingPatternScale)
        ),
      ]),
      this.materials.ceiling,
      'office-drop-ceiling',
      this.group,
    );
    const createElevatedCeilings = (
      rooms: typeof tallRooms,
      distant: boolean,
    ): THREE.BufferGeometry[] => rooms.flatMap((room) => {
          const clippedOpenings = [...inheritedCeilingOpenings, ...stairCeilingOpenings]
            .map((opening) => intersectRects(room.bounds, opening))
            .filter((opening): opening is Rect => opening !== null);
          const rects = clippedOpenings.length > 0
            ? cellsAroundHoles(room.bounds, clippedOpenings)
            : [room.bounds];
          return rects.map((rect) =>
            createCeilingGeometry(
              rect,
              room.ceilingHeight,
              distant
                ? distantCeilingPatternScale(
                    this.surfaceStyle.ceilingPatternScale,
                    room.ceilingHeight,
                  )
                : this.surfaceStyle.ceilingPatternScale,
            )
          );
        });
    const distantRooms = tallRooms.filter(
      (room) =>
        room.ceilingHeight >= DISTANT_CEILING_THRESHOLD &&
        !this.plan.features.some(
          (feature) =>
            feature.kind === 'epic-structure' &&
            feature.variant === 'ascending-passages' &&
            feature.roomId === room.id,
        ),
    );
    const raisedRooms = tallRooms.filter(
      (room) =>
        room.ceilingHeight < DISTANT_CEILING_THRESHOLD &&
        !this.plan.features.some(
          (feature) =>
            feature.kind === 'epic-structure' &&
            feature.variant === 'ascending-passages' &&
            feature.roomId === room.id,
        ),
    );
    makeMesh(
      mergeOrSingle(createElevatedCeilings(raisedRooms, false)),
      this.elevatedCeilingMaterial,
      'elevated-atrium-ceilings',
      this.group,
    );
    makeMesh(
      mergeOrSingle(createElevatedCeilings(distantRooms, true)),
      this.distantCeilingMaterial,
      'distant-elevated-tiled-ceilings',
      this.group,
    );
    if (inheritedCeilingOpenings.length > 0 && endlessAbyssFeatures.length === 0) {
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
    if (this.bakedLightMaps) {
      const floorJunctionRepair = createHorizontalJunctionRepairGeometry(
        this.plan.walls,
        this.plan.floorRects,
        this.plan.size,
        this.plan.wallHeight,
        'floor',
        this.surfaceStyle.floorPatternScale,
        this.surfaceStyle.floorQuarterTurn,
      );
      makeMesh(
        floorJunctionRepair.geometry,
        this.materials.floor,
        'floor-lightmap-junction-repairs',
        this.group,
      );
      makeMesh(
        ceilingJunctionRepair.geometry,
        this.materials.ceiling,
        'ceiling-lightmap-junction-repairs',
        this.group,
      );
    }
  }

  private buildEpicStructures(): void {
    const features = this.plan.features.filter(
      (feature): feature is EpicStructureFeature => feature.kind === 'epic-structure',
    );
    for (const feature of features) {
      const group = new THREE.Group();
      group.name = `epic-structure-${feature.index}-${feature.variant}`;
      if (feature.variant !== 'ascending-passages') {
        this.buildEpicUpperShell(feature, group);
      }

      if (feature.variant === 'endless-abyss') {
        this.buildEpicEndlessAbyss(feature, group);
      } else if (feature.variant === 'ascending-passages') {
        this.buildEpicAscendingPassages(feature, group);
      } else if (feature.variant === 'impossible-stairwell') {
        this.buildEpicImpossibleStairwell(feature, group);
      }
      this.group.add(group);
    }
  }

  private buildEpicUpperShell(
    feature: EpicStructureFeature,
    group: THREE.Group,
  ): void {
    const center = rectCenter(feature.bounds);
    const width = rectWidth(feature.bounds);
    const depth = rectDepth(feature.bounds);
    const thickness = 0.34;
    // Neighbouring epic chunks build their own shell. Keeping each face just
    // inside its chunk avoids coplanar double walls on the shared seam.
    const seamInset = 0.24;
    const bottom = feature.variant === 'impossible-stairwell'
      ? 0
      : this.plan.wallHeight - 0.04;
    const height = feature.height - bottom + 0.03;
    if (height <= 0.08) return;
    const walls: WallSegment[] = [
      {
        id: `${feature.id}-upper-north`,
        x: center.x,
        z: feature.bounds.minZ + seamInset,
        length: width - seamInset * 2 + thickness * 2,
        orientation: 'x',
        bottom,
        height,
        thickness,
        tint: 0.9,
        collision: false,
        kind: 'wallpaper',
      },
      {
        id: `${feature.id}-upper-south`,
        x: center.x,
        z: feature.bounds.maxZ - seamInset,
        length: width - seamInset * 2 + thickness * 2,
        orientation: 'x',
        bottom,
        height,
        thickness,
        tint: 0.92,
        collision: false,
        kind: 'wallpaper',
      },
      {
        id: `${feature.id}-upper-west`,
        x: feature.bounds.minX + seamInset,
        z: center.z,
        length: depth - seamInset * 2,
        orientation: 'z',
        bottom,
        height,
        thickness,
        tint: 0.9,
        collision: false,
        kind: 'wallpaper',
      },
      {
        id: `${feature.id}-upper-east`,
        x: feature.bounds.maxX - seamInset,
        z: center.z,
        length: depth - seamInset * 2,
        orientation: 'z',
        bottom,
        height,
        thickness,
        tint: 0.92,
        collision: false,
        kind: 'wallpaper',
      },
    ];
    if (feature.variant === 'impossible-stairwell') {
      walls.splice(0, walls.length, ...getEpicStairRoomWalls(feature));
    }
    makeMesh(
      mergeOrSingle(walls.map((wall) =>
        createWallGeometry(
          wall,
          false,
          this.surfaceStyle.wallPatternScale,
          true,
          wallpaperPhaseForWall(this.plan.seed, wall),
        )
      )),
      this.materials.wall,
      `epic-${feature.index}-upper-shell`,
      group,
    );
  }

  private buildEpicEndlessAbyss(
    feature: EpicStructureFeature,
    group: THREE.Group,
  ): void {
    if (!feature.voidBounds || !feature.passageLevels) return;
    const abyssBottom = getEpicAbyssBottom(feature);
    const halfSize = this.plan.size * 0.5;
    const previewFloorBounds: Rect = {
      minX: -halfSize,
      maxX: halfSize,
      minZ: -halfSize,
      maxZ: halfSize,
    };
    const currentWalls: THREE.BufferGeometry[] = [];
    const lowerWalls: THREE.BufferGeometry[] = [];
    const lowerLedges: THREE.BufferGeometry[] = [];
    const funnelSupportWalls: THREE.BufferGeometry[] = [];
    const currentPortalSoffits: THREE.BufferGeometry[] = [];
    const lowerPortalSoffits: THREE.BufferGeometry[] = [];
    const currentCorridorWalls: THREE.BufferGeometry[] = [];
    const lowerCorridorWalls: THREE.BufferGeometry[] = [];
    const currentCorridorCeilings: THREE.BufferGeometry[] = [];
    const lowerCorridorCeilings: THREE.BufferGeometry[] = [];
    const detailedPreviewFloors: THREE.BufferGeometry[] = [];
    const distantPreviewCaps: THREE.BufferGeometry[] = [];
    const corridorLights: THREE.BufferGeometry[] = [];
    const detailedPassagesFor = (
      passages: readonly EpicPassagePreview[],
      levelY: number,
      storyFacadeBounds: Rect,
    ): EpicPassagePreview[] => {
      if (Math.abs(levelY) > INFINITE_STORY_PITCH * 3 + 0.01) return [];
      const focus = feature.destination;
      const ranked = passages.map((passage) => {
        const portal = passage.side === 'north'
          ? { x: passage.along, z: storyFacadeBounds.minZ }
          : passage.side === 'south'
            ? { x: passage.along, z: storyFacadeBounds.maxZ }
            : passage.side === 'west'
              ? { x: storyFacadeBounds.minX, z: passage.along }
              : { x: storyFacadeBounds.maxX, z: passage.along };
        const horizontalDistance = Math.hypot(portal.x - focus.x, portal.z - focus.z);
        const directlyBelow = levelY < 0 && horizontalDistance < 8;
        return {
          passage,
          score: horizontalDistance + (directlyBelow ? 80 : 0),
        };
      }).filter(({ score }) => score <= 70)
        .sort((left, right) => left.score - right.score)
        .slice(0, 4);
      return ranked.map(({ passage }) => passage);
    };
    const levelYs = new Set(feature.passageLevels.map((level) => level.y.toFixed(3)));
    for (const [levelIndex, level] of feature.passageLevels.entries()) {
      if (level.y < abyssBottom - 0.1) continue;
      const tint = 0.71 + (levelIndex % 4) * 0.035;
      const storyShell = getEpic1FunnelStoryBounds(feature, level.y);
      const facade = createEpicFacadeBandGeometries(
        storyShell.facadeBounds,
        level.passages,
        level.y,
        INFINITE_STORY_PITCH,
        EPIC1_PORTAL_HEIGHT,
        ['north', 'south', 'west', 'east'],
        tint,
        true,
      );
      (level.y === 0 ? currentWalls : lowerWalls).push(...facade);
      if (levelYs.has((level.y - INFINITE_STORY_PITCH).toFixed(3))) {
        funnelSupportWalls.push(...createOpenShaftWallGeometries(
          storyShell.voidBounds,
          level.y - INFINITE_STORY_PITCH,
          level.y - 0.22,
          Math.min(0.92, tint + 0.08),
          this.surfaceStyle.wallPatternScale,
        ));
      }
      if (Math.abs(level.y) > 0.01) {
        // The ledge stops at the facade. Only entrances with a detailed preview
        // receive floor beyond it, so distant sealed openings cannot expose a
        // stray carpet tongue or a coplanar surface at the threshold.
        for (const ledge of cellsAroundHoles(
          storyShell.facadeBounds,
          [storyShell.voidBounds],
        )) {
          lowerLedges.push(createTexturedBoxGeometry(
            rectWidth(ledge),
            0.22,
            rectDepth(ledge),
            rectCenter(ledge).x,
            level.y - 0.22,
            rectCenter(ledge).z,
            tint,
            this.surfaceStyle.floorPatternScale,
          ));
        }
      }
      const detailedPassages = new Set(
        Math.abs(level.y) <= 0.01
          ? level.passages
          : detailedPassagesFor(level.passages, level.y, storyShell.facadeBounds),
      );
      for (const passage of level.passages) {
        (Math.abs(level.y) <= 0.01 ? currentPortalSoffits : lowerPortalSoffits).push(
          createEpicPortalSoffit(
            passage,
            storyShell.facadeBounds,
            level.y,
            this.surfaceStyle.wallPatternScale,
          ),
        );
        if (Math.abs(level.y) > 0.01 && !detailedPassages.has(passage)) {
          distantPreviewCaps.push(createEpicPassagePreviewPanel(
            passage,
            storyShell.facadeBounds,
            level.y,
          ));
          continue;
        }
        const layout = Math.abs(level.y) <= 0.01
          ? getEpicAbyssThroughPassageLayout(
              passage,
              storyShell.facadeBounds,
              previewFloorBounds,
            )
          : getEpicAbyssRoomPreviewLayout(passage, storyShell.facadeBounds);
        const preview = createEpicCorridorPreviewGeometries(
          passage,
          storyShell.facadeBounds,
          level.y,
          EPIC1_PORTAL_HEIGHT,
          layout,
        );
        (level.y === 0 ? currentCorridorWalls : lowerCorridorWalls).push(...preview.walls);
        (level.y === 0 ? currentCorridorCeilings : lowerCorridorCeilings).push(...preview.ceilings);
        if (Math.abs(level.y) > 0.01) {
          const visibleFloorRects = subtractRects(
            layout.floorRects,
            [storyShell.facadeBounds],
          );
          if (visibleFloorRects.length > 0) {
            detailedPreviewFloors.push(createFloorGeometry(
              visibleFloorRects,
              level.y,
              this.surfaceStyle.floorPatternScale,
              this.surfaceStyle.floorQuarterTurn,
            ));
          }
        }
        const horizontal = passage.side === 'north' || passage.side === 'south';
        const outward = passage.side === 'north' || passage.side === 'west' ? -1 : 1;
        const fixed = passage.side === 'north'
          ? storyShell.facadeBounds.minZ
          : passage.side === 'south'
            ? storyShell.facadeBounds.maxZ
            : passage.side === 'west'
              ? storyShell.facadeBounds.minX
              : storyShell.facadeBounds.maxX;
        const lightFixed = fixed + outward * Math.max(0.42, passage.corridorDepth * 0.58);
        corridorLights.push(createEpicGlowPanel(
          horizontal ? Math.min(2.1, passage.width * 0.48) : 0.42,
          horizontal ? 0.42 : Math.min(2.1, passage.width * 0.48),
          horizontal ? passage.along : lightFixed,
          level.y + EPIC1_PORTAL_HEIGHT - 0.025,
          horizontal ? lightFixed : passage.along,
        ));
      }
    }
    makeMesh(
      mergeOrSingle(currentWalls),
      this.materials.wall,
      'epic-endless-abyss-upper-passage-walls',
      group,
    );
    makeMesh(
      mergeOrSingle(lowerWalls),
      this.lowerMaterials.wall,
      'epic-endless-abyss-stacked-passage-walls',
      group,
    );
    makeMesh(
      mergeOrSingle(lowerLedges),
      this.lowerMaterials.floor,
      'epic-endless-abyss-story-ledges',
      group,
    );
    makeMesh(
      mergeOrSingle(currentCorridorWalls),
      this.materials.wall,
      'epic-endless-abyss-current-corridor-walls',
      group,
    );
    makeMesh(
      mergeOrSingle(lowerCorridorWalls),
      this.previewMaterials.wall,
      'epic-endless-abyss-corridor-previews',
      group,
    );
    makeMesh(
      mergeOrSingle(currentCorridorCeilings),
      this.materials.ceiling,
      'epic-endless-abyss-current-corridor-ceilings',
      group,
    );
    makeMesh(
      mergeOrSingle(lowerCorridorCeilings),
      this.previewMaterials.ceiling,
      'epic-endless-abyss-corridor-ceilings',
      group,
    );
    makeMesh(
      mergeOrSingle(detailedPreviewFloors),
      this.previewMaterials.floor,
      'epic-endless-abyss-detailed-preview-floors',
      group,
    );
    makeMesh(
      mergeOrSingle(distantPreviewCaps),
      this.previewMaterials.wall,
      'epic-endless-abyss-distant-entry-caps',
      group,
    );
    makeMesh(
      mergeOrSingle(corridorLights),
      this.materials.fixtureGlow,
      'epic-endless-abyss-corridor-lights',
      group,
    );
    makeMesh(
      mergeOrSingle(funnelSupportWalls),
      this.previewMaterials.wall,
      'epic-endless-abyss-funnel-support-walls',
      group,
    );
    makeMesh(
      mergeOrSingle(currentPortalSoffits),
      this.materials.wall,
      'epic-endless-abyss-current-portal-soffits',
      group,
    );
    makeMesh(
      mergeOrSingle(lowerPortalSoffits),
      this.previewMaterials.wall,
      'epic-endless-abyss-stacked-portal-soffits',
      group,
    );
    const topLevelY = Math.max(...feature.passageLevels.map((level) => level.y));
    const topCeilingY = topLevelY + INFINITE_STORY_PITCH;
    makeMesh(
      createCeilingGeometry(
        feature.bounds,
        topCeilingY,
        distantCeilingPatternScale(this.surfaceStyle.ceilingPatternScale, topCeilingY),
      ),
      this.distantCeilingMaterial,
      'epic-endless-abyss-top-ceiling',
      group,
    );
    const mistTop = -3.2 * INFINITE_STORY_PITCH;
    const mistBottom = abyssBottom - 8;
    const mistLayerCount = 11;
    const mistTint = this.plan.visualBiome === 'red'
      ? new THREE.Color(0x170302)
      : this.plan.visualBiome === 'white'
        ? new THREE.Color(0x071016)
        : new THREE.Color(0x100f08);
    const mistMaterial = createEpicFogMaterial({
      name: 'epic-endless-abyss-depth-mist-material',
      color: mistTint,
      nearY: mistTop,
      farY: mistBottom,
      nearOpacity: 0.025,
      farOpacity: 0.38,
    });
    this.ownedMaterials.push(mistMaterial);
    this.animatedFogMaterials.push(mistMaterial);
    const mistPlanes = Array.from({ length: mistLayerCount }, (_, index) => {
      const progress = index / (mistLayerCount - 1);
      const y = THREE.MathUtils.lerp(mistBottom, mistTop, progress);
      const fogShell = getEpic1FunnelStoryBounds(feature, y);
      const fogCenter = rectCenter(fogShell.voidBounds);
      const inset = 0.42 + (1 - progress) * 0.52;
      return createEpicGlowPanel(
        rectWidth(fogShell.voidBounds) - inset,
        rectDepth(fogShell.voidBounds) - inset,
        fogCenter.x,
        y,
        fogCenter.z,
      );
    });
    const mist = makeMesh(
      mergeOrSingle(mistPlanes),
      mistMaterial,
      'epic-endless-abyss-depth-mist',
      group,
    );
    if (mist) mist.renderOrder = 4;
  }

  private buildEpicAscendingPassages(
    feature: EpicStructureFeature,
    group: THREE.Group,
  ): void {
    if (!feature.passageLevels || !feature.voidBounds) return;
    const facadeBounds = feature.passageFacadeBounds ?? feature.bounds;
    const voidBounds = feature.voidBounds;
    const facades: THREE.BufferGeometry[] = [];
    const previewFloors: THREE.BufferGeometry[] = [];
    const previewWalls: THREE.BufferGeometry[] = [];
    const distantPreviewCaps: THREE.BufferGeometry[] = [];
    const previewCeilings: THREE.BufferGeometry[] = [];
    const entryY = (feature.entryLevel ?? 0) * INFINITE_STORY_PITCH;
    const nearbyPreviewBand = (y: number): boolean =>
      Math.abs(y) < 0.01 ||
      (
        y >= entryY - INFINITE_STORY_PITCH * 4 - 0.01 &&
        y <= entryY + INFINITE_STORY_PITCH * 3 + 0.01
      );
    const boxForRect = (
      rect: Rect,
      height: number,
      bottom: number,
      tint: number,
    ): THREE.BufferGeometry => {
      const center = rectCenter(rect);
      return createTexturedBoxGeometry(
        rectWidth(rect),
        height,
        rectDepth(rect),
        center.x,
        bottom,
        center.z,
        tint,
      );
    };
    for (const [rowIndex, level] of feature.passageLevels.entries()) {
      if (level.y >= feature.height - 0.1) continue;
      const bandHeight = Math.min(INFINITE_STORY_PITCH, feature.height - level.y);
      facades.push(...createEpicFacadeBandGeometries(
        facadeBounds,
        level.passages,
        level.y,
        bandHeight,
        3.35,
        ['north', 'south'],
        0.84 + (rowIndex % 4) * 0.025,
        true,
      ));
      if (nearbyPreviewBand(level.y)) {
        for (const side of ['north', 'south'] as const) {
          const layout = getEpic3BackroomsGalleryLayout(
            level.passages,
            feature.bounds,
            facadeBounds,
            side,
          );
          if (Math.abs(level.y) > 0.01) {
            previewFloors.push(...layout.floorRects.map((rect) =>
              boxForRect(rect, 0.2, level.y - 0.2, 0.86)
            ));
          }
          previewWalls.push(...layout.wallRects.map((rect) =>
            removeHorizontalCaps(boxForRect(rect, 3.35, level.y, 0.88))
          ));
          previewCeilings.push(...layout.ceilingRects.map((rect) =>
            boxForRect(rect, 0.18, level.y + 3.35, 0.91)
          ));
        }
        continue;
      }
      for (const passage of level.passages) {
        const outward = passage.side === 'north' ? -1 : 1;
        const fixed = passage.side === 'north' ? facadeBounds.minZ : facadeBounds.maxZ;
        const capCenterZ = fixed + outward * 1.15;
        distantPreviewCaps.push(createEpicVerticalPreviewPanel(
          passage.width,
          3.35,
          passage.along,
          level.y,
          capCenterZ,
          passage.side === 'north',
        ));
      }
    }
    const minimumY = Math.min(...feature.passageLevels.map((level) => level.y));
    facades.push(...createEpicFacadeBandGeometries(
      feature.bounds,
      [],
      minimumY,
      -minimumY,
      0,
      ['west', 'east'],
      0.88,
      true,
    ));
    facades.push(...createEpicFacadeBandGeometries(
      feature.bounds,
      [],
      0,
      INFINITE_STORY_PITCH,
      3.35,
      ['west', 'east'],
      0.88,
      true,
    ));
    facades.push(...createEpicFacadeBandGeometries(
      feature.bounds,
      [],
      INFINITE_STORY_PITCH,
      feature.height - INFINITE_STORY_PITCH,
      0,
      ['west', 'east'],
      0.88,
      true,
    ));
    makeMesh(
      mergeOrSingle(facades),
      this.materials.wall,
      'epic-ascending-passages-facades',
      group,
    );
    makeMesh(
      mergeOrSingle(previewFloors),
      this.materials.floor,
      'epic-ascending-passages-corridor-floors',
      group,
    );
    makeMesh(
      mergeOrSingle(previewWalls),
      this.materials.wall,
      'epic-ascending-passages-corridor-previews',
      group,
    );
    makeMesh(
      mergeOrSingle(distantPreviewCaps),
      this.previewMaterials.wall,
      'epic-ascending-passages-distant-maze-hints',
      group,
    );
    makeMesh(
      mergeOrSingle(previewCeilings),
      this.materials.ceiling,
      'epic-ascending-passages-corridor-ceilings',
      group,
    );
    const fogCenter = rectCenter(voidBounds);
    const fogTint = this.plan.visualBiome === 'red'
      ? new THREE.Color(0x160302)
      : this.plan.visualBiome === 'white'
        ? new THREE.Color(0x071016)
        : new THREE.Color(0x0f0e08);
    const makeVerticalFog = (
      name: string,
      layers: readonly { y: number; inset: number }[],
      nearY: number,
      farY: number,
      nearOpacity: number,
      farOpacity: number,
    ): void => {
      const material = createEpicFogMaterial({
        name: `${name}-material`,
        color: fogTint.clone(),
        nearY,
        farY,
        nearOpacity,
        farOpacity,
      });
      this.ownedMaterials.push(material);
      this.animatedFogMaterials.push(material);
      const geometry = layers.map(({ y, inset }) => createEpicGlowPanel(
        rectWidth(voidBounds) - inset * 2,
        rectDepth(voidBounds) - inset * 2,
        fogCenter.x,
        y,
        fogCenter.z,
      ));
      const fog = makeMesh(mergeOrSingle(geometry), material, name, group);
      if (fog) fog.renderOrder = 4;
    };
    const fogLayerCount = 5;
    makeVerticalFog(
      'epic-ascending-passages-upper-fog',
      Array.from({ length: fogLayerCount }, (_, index) => {
        const progress = index / (fogLayerCount - 1);
        return {
          y: THREE.MathUtils.lerp(feature.height - 0.45, feature.height - 16, progress),
          inset: THREE.MathUtils.lerp(1.15, 0.22, progress),
        };
      }),
      feature.height - 16,
      feature.height,
      0.035,
      0.29,
    );
    makeVerticalFog(
      'epic-ascending-passages-lower-fog',
      Array.from({ length: fogLayerCount }, (_, index) => {
        const progress = index / (fogLayerCount - 1);
        return {
          y: THREE.MathUtils.lerp(minimumY + 0.45, minimumY + 13, progress),
          inset: THREE.MathUtils.lerp(1.15, 0.22, progress),
        };
      }),
      minimumY + 13,
      minimumY,
      0.03,
      0.27,
    );
  }

  private buildEpicImpossibleStairwell(
    feature: EpicStructureFeature,
    group: THREE.Group,
  ): void {
    const layout = getEpicStairwellLayout(feature);
    const treads: THREE.BufferGeometry[] = [];
    const slopes: THREE.BufferGeometry[] = [];
    const undersides: THREE.BufferGeometry[] = [];
    const skirts: THREE.BufferGeometry[] = [];
    const landings: THREE.BufferGeometry[] = [];
    const landingUndersides: THREE.BufferGeometry[] = [];
    const landingFascias: THREE.BufferGeometry[] = [];
    const rails: THREE.BufferGeometry[] = [];
    const balustrades: THREE.BufferGeometry[] = [];
    const upperWalls: THREE.BufferGeometry[] = [];
    const upperCeilings: THREE.BufferGeometry[] = [];
    const stepsPerFlight = 12;
    const railHeight = 1.02;

    for (const [flightIndex, flight] of layout.flights.entries()) {
      const run = flight.axis === 'x' ? rectWidth(flight.bounds) : rectDepth(flight.bounds);
      const cross = flight.axis === 'x' ? rectDepth(flight.bounds) : rectWidth(flight.bounds);
      const stepRun = run / stepsPerFlight;
      const stepRise = flight.rise / stepsPerFlight;
      const center = rectCenter(flight.bounds);
      const ramp: RampSurface = {
        bounds: flight.bounds,
        axis: flight.axis,
        riseDirection: flight.riseDirection,
      };
      const slope = createSlopedSurfaceGeometry(
        flight.rise,
        ramp,
        this.surfaceStyle.floorPatternScale,
        this.surfaceStyle.floorQuarterTurn,
        0.004,
        0.01,
      );
      slope.translate(0, flight.bottom, 0);
      slopes.push(slope);
      const underside = createSlopedUndersideGeometry(
        flight.rise,
        ramp,
        this.surfaceStyle.wallPatternScale,
        -0.18,
      );
      underside.translate(0, flight.bottom, 0);
      undersides.push(underside);
      for (const side of [-1, 1] as const) {
        const skirt = createSlopedStairFasciaGeometry(
          flight.rise,
          ramp,
          side,
          0.184,
          this.surfaceStyle.wallPatternScale,
        );
        skirt.translate(0, flight.bottom, 0);
        skirts.push(skirt);
      }

      const outerCross = flight.axis === 'x'
        ? (flight.outerEdge < 0 ? flight.bounds.minZ : flight.bounds.maxZ)
        : (flight.outerEdge < 0 ? flight.bounds.minX : flight.bounds.maxX);

      for (let step = 0; step < stepsPerFlight; step += 1) {
        const progress = (step + 0.5) / stepsPerFlight;
        const alongMin = flight.axis === 'x' ? flight.bounds.minX : flight.bounds.minZ;
        const along = alongMin + run * progress;
        const top = flight.bottom + stepRise * (
          flight.riseDirection > 0 ? step + 1 : stepsPerFlight - step
        );
        treads.push(createTexturedBoxGeometry(
          flight.axis === 'x' ? stepRun + 0.022 : cross,
          0.14,
          flight.axis === 'x' ? cross : stepRun + 0.022,
          flight.axis === 'x' ? along : center.x,
          top - 0.14,
          flight.axis === 'x' ? center.z : along,
          0.9 + ((flightIndex + step) % 5) * 0.018,
          this.surfaceStyle.floorPatternScale,
        ));
        balustrades.push(createTexturedBoxGeometry(
          flight.axis === 'x' ? stepRun + 0.018 : 0.12,
          0.72,
          flight.axis === 'x' ? 0.12 : stepRun + 0.018,
          flight.axis === 'x' ? along : outerCross,
          top,
          flight.axis === 'x' ? outerCross : along,
          0.86,
          this.surfaceStyle.wallPatternScale,
        ));
      }

      const signedAngle = Math.atan2(flight.rise, run) * flight.riseDirection;
      const rail = new THREE.BoxGeometry(
        flight.axis === 'x' ? Math.hypot(run, flight.rise) : 0.1,
        0.1,
        flight.axis === 'x' ? 0.1 : Math.hypot(run, flight.rise),
      );
      if (flight.axis === 'x') rail.rotateZ(signedAngle);
      else rail.rotateX(-signedAngle);
      rail.translate(
        flight.axis === 'x' ? center.x : outerCross,
        flight.bottom + flight.rise * 0.5 + railHeight,
        flight.axis === 'x' ? outerCross : center.z,
      );
      setGeometryTint(rail, 0.78);
      rails.push(rail);
      for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
        const directed = flight.riseDirection > 0 ? progress : 1 - progress;
        const alongMin = flight.axis === 'x' ? flight.bounds.minX : flight.bounds.minZ;
        const along = alongMin + run * progress;
        rails.push(createTexturedBoxGeometry(
          0.1,
          railHeight,
          0.1,
          flight.axis === 'x' ? along : outerCross,
          flight.bottom + directed * flight.rise,
          flight.axis === 'x' ? outerCross : along,
          0.78,
        ));
      }
    }

    for (const landing of layout.landings) {
      const center = rectCenter(landing.bounds);
      landings.push(createFloorGeometry(
        [landing.bounds],
        landing.top,
        this.surfaceStyle.floorPatternScale,
        this.surfaceStyle.floorQuarterTurn,
      ));
      landingUndersides.push(createCeilingGeometry(
        landing.bounds,
        landing.top - 0.18,
        this.surfaceStyle.ceilingPatternScale,
      ));
      landingFascias.push(createRectFasciaGeometry(
        landing.bounds,
        landing.top - 0.18,
        landing.top,
        this.surfaceStyle.wallPatternScale,
      ));
      const outerX = center.x < 0 ? landing.bounds.minX : landing.bounds.maxX;
      const outerZ = center.z < 0 ? landing.bounds.minZ : landing.bounds.maxZ;
      rails.push(
        createTexturedBoxGeometry(rectWidth(landing.bounds), 0.1, 0.1, center.x, landing.top + railHeight, outerZ, 0.78),
        createTexturedBoxGeometry(0.1, 0.1, rectDepth(landing.bounds), outerX, landing.top + railHeight, center.z, 0.78),
        createTexturedBoxGeometry(0.1, railHeight, 0.1, outerX, landing.top, outerZ, 0.78),
      );
      balustrades.push(
        createTexturedBoxGeometry(rectWidth(landing.bounds), 0.72, 0.12, center.x, landing.top, outerZ, 0.86, this.surfaceStyle.wallPatternScale),
        createTexturedBoxGeometry(0.12, 0.72, rectDepth(landing.bounds), outerX, landing.top, center.z, 0.86, this.surfaceStyle.wallPatternScale),
      );
    }

    for (const rect of layout.summitRects) {
      landings.push(createFloorGeometry(
        [rect],
        layout.summitY,
        this.surfaceStyle.floorPatternScale,
        this.surfaceStyle.floorQuarterTurn,
      ));
      landingUndersides.push(createCeilingGeometry(
        rect,
        layout.summitY - 0.2,
        this.surfaceStyle.ceilingPatternScale,
      ));
      landingFascias.push(createRectFasciaGeometry(
        rect,
        layout.summitY - 0.2,
        layout.summitY,
        this.surfaceStyle.wallPatternScale,
      ));
    }
    for (const rect of layout.upperFloorRects) {
      landings.push(createFloorGeometry(
        [rect],
        layout.summitY,
        this.surfaceStyle.floorPatternScale,
        this.surfaceStyle.floorQuarterTurn,
      ));
      landingUndersides.push(createCeilingGeometry(
        rect,
        layout.summitY - 0.2,
        this.surfaceStyle.ceilingPatternScale,
      ));
      landingFascias.push(createRectFasciaGeometry(
        rect,
        layout.summitY - 0.2,
        layout.summitY,
        this.surfaceStyle.wallPatternScale,
      ));
      upperCeilings.push(createCeilingGeometry(
        rect,
        layout.upperCeilingY,
        this.surfaceStyle.ceilingPatternScale,
      ));
    }
    upperWalls.push(...layout.upperWalls.map((wall) => createWallGeometry(
      wall,
      false,
      this.surfaceStyle.wallPatternScale,
      false,
      wallpaperPhaseForWall(this.plan.seed, wall),
    )));
    const summitOuter = Math.max(...layout.summitRects.map((rect) => rect.maxX));
    const northRailMin = -4.3;
    rails.push(
      createTexturedBoxGeometry(summitOuter - northRailMin, 0.1, 0.1, (summitOuter + northRailMin) * 0.5, layout.summitY + railHeight, -summitOuter, 0.78),
      createTexturedBoxGeometry(summitOuter * 2, 0.1, 0.1, 0, layout.summitY + railHeight, summitOuter, 0.78),
      createTexturedBoxGeometry(0.1, 0.1, summitOuter * 2, -summitOuter, layout.summitY + railHeight, 0, 0.78),
      createTexturedBoxGeometry(0.1, 0.1, summitOuter * 2, summitOuter, layout.summitY + railHeight, 0, 0.78),
    );
    balustrades.push(
      createTexturedBoxGeometry(summitOuter - northRailMin, 0.72, 0.12, (summitOuter + northRailMin) * 0.5, layout.summitY, -summitOuter, 0.86, this.surfaceStyle.wallPatternScale),
      createTexturedBoxGeometry(summitOuter * 2, 0.72, 0.12, 0, layout.summitY, summitOuter, 0.86, this.surfaceStyle.wallPatternScale),
      createTexturedBoxGeometry(0.12, 0.72, summitOuter * 2, -summitOuter, layout.summitY, 0, 0.86, this.surfaceStyle.wallPatternScale),
      createTexturedBoxGeometry(0.12, 0.72, summitOuter * 2, summitOuter, layout.summitY, 0, 0.86, this.surfaceStyle.wallPatternScale),
    );
    makeMesh(
      mergeOrSingle(treads),
      this.materials.floor,
      'epic4-stair-treads',
      group,
    );
    makeMesh(
      mergeOrSingle(slopes),
      this.materials.floor,
      'epic4-stair-walkable-slopes',
      group,
    );
    makeMesh(
      mergeOrSingle(undersides),
      this.lowerMaterials.wall,
      'epic4-stair-textured-undersides',
      group,
    );
    makeMesh(
      mergeOrSingle(skirts),
      this.lowerMaterials.wall,
      'epic4-stair-support-skirts',
      group,
    );
    makeMesh(
      mergeOrSingle(landings),
      this.materials.floor,
      'epic4-stair-landings-and-summit',
      group,
    );
    makeMesh(
      mergeOrSingle(landingUndersides),
      this.lowerMaterials.ceiling,
      'epic4-stair-landing-undersides',
      group,
    );
    makeMesh(
      mergeOrSingle(landingFascias),
      this.lowerMaterials.wall,
      'epic4-stair-landing-fascias',
      group,
    );
    makeMesh(
      mergeOrSingle(rails),
      this.materials.metal,
      'epic4-stair-guardrails',
      group,
    );
    makeMesh(
      mergeOrSingle(balustrades),
      this.lowerMaterials.wall,
      'epic4-stair-textured-balustrades',
      group,
    );
    makeMesh(
      mergeOrSingle(upperWalls),
      this.materials.wall,
      'epic4-upper-maze-walls',
      group,
    );
    makeMesh(
      mergeOrSingle(upperCeilings),
      this.materials.ceiling,
      'epic4-upper-maze-ceiling',
      group,
    );
  }

  private buildRaisedZones(): void {
    const features = this.plan.features.filter(
      (feature): feature is RaisedZoneFeature => feature.kind === 'raised-zone',
    );
    const topGeometries: THREE.BufferGeometry[] = [];
    const rampGeometries: THREE.BufferGeometry[] = [];
    const skirtGeometries: THREE.BufferGeometry[] = [];
    const supportWallGeometries: THREE.BufferGeometry[] = [];
    for (const feature of features) {
      const platforms = feature.platformRects ?? [feature.platformBounds];
      const ramps = feature.ramps ?? [feature.ramp];
      topGeometries.push(...platforms.map((platform) =>
        createFloorGeometry(
          [platform],
          feature.elevation,
          this.surfaceStyle.floorPatternScale,
          this.surfaceStyle.floorQuarterTurn,
        )
      ));
      rampGeometries.push(...ramps.map((ramp) =>
        createSlopedSurfaceGeometry(
          feature.elevation,
          ramp,
          this.surfaceStyle.floorPatternScale,
          this.surfaceStyle.floorQuarterTurn,
        )
      ));
      const skirtBottom = Math.min(0, feature.elevation);
      const skirtHeight = Math.abs(feature.elevation);
      const skirtThickness = 0.12;
      const supportThickness = 0.1;
      const supportBottom = skirtBottom - 0.012;
      const supportHeight = skirtHeight + 0.024;
      const supportBoundaries = exposedRectBoundaries(
        platforms,
        feature.elevation < 0 ? ramps : [],
      );
      for (const boundary of supportBoundaries) {
        const length = boundary.max - boundary.min;
        const alongCenter = (boundary.min + boundary.max) * 0.5;
        const fixedCenter = boundary.fixed + boundary.inward * supportThickness * 0.5;
        supportWallGeometries.push(removeHorizontalCaps(createTexturedBoxGeometry(
          boundary.orientation === 'x' ? length : supportThickness,
          supportHeight,
          boundary.orientation === 'x' ? supportThickness : length,
          boundary.orientation === 'x' ? alongCenter : fixedCenter,
          supportBottom,
          boundary.orientation === 'x' ? fixedCenter : alongCenter,
          0.94,
          this.surfaceStyle.wallPatternScale,
        )));
      }
      for (const ramp of ramps) {
        for (const side of [-1, 1] as const) {
          skirtGeometries.push(createRampSkirtGeometry(
            feature.elevation,
            ramp,
            side,
            skirtThickness,
            this.surfaceStyle.wallPatternScale,
          ));
        }
      }
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
    makeMesh(
      mergeOrSingle(supportWallGeometries),
      this.materials.wall,
      'wallpaper-elevation-support-walls',
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
    const lowerFloorGeometries: THREE.BufferGeometry[] = [];
    const lowerWallGeometries: THREE.BufferGeometry[] = [];
    const lowerCeilingGeometries: THREE.BufferGeometry[] = [];
    for (const feature of features) {
      const room = this.plan.rooms.find((candidate) => candidate.id === feature.roomId);
      const clearance = feature.clearanceHeight ?? 1.42;
      const ceilingY = room?.ceilingHeight ?? this.plan.wallHeight;
      if (ceilingY > clearance + 0.08) {
        // Bleed the roof into the surrounding walls. A face exactly aligned
        // with a tunnel wall or doorway jamb produces visible z-fighting.
        const wallBleed = 0.018;
        const visibleRoofRects: Rect[] = [];
        for (const passageRect of feature.passageRects ?? [feature.bounds]) {
          const expanded: Rect = {
            minX: passageRect.minX - wallBleed,
            maxX: passageRect.maxX + wallBleed,
            minZ: passageRect.minZ - wallBleed,
            maxZ: passageRect.maxZ + wallBleed,
          };
          const pieces = subtractRects([expanded], visibleRoofRects);
          visibleRoofRects.push(...pieces);
        }
        roofGeometries.push(...visibleRoofRects.map((roofBounds) =>
          createTexturedBoxGeometry(
            rectWidth(roofBounds),
            ceilingY - clearance,
            rectDepth(roofBounds),
            rectCenter(roofBounds).x,
            clearance,
            rectCenter(roofBounds).z,
            0.96,
            this.surfaceStyle.wallPatternScale,
          )
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
            createSlopedSurfaceGeometry(
              feature.hump!.elevation,
              ramp,
              this.surfaceStyle.floorPatternScale,
              this.surfaceStyle.floorQuarterTurn,
              0.0052,
            )
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
        const holeKind = hole.kind ?? 'drop';
        const shaftTop = 0.012;
        const shaftBottom = holeKind === 'void'
          ? getPassageHoleAbyssBottom(hole)
          : PASSAGE_HOLE_LOWER_CEILING_Y - 0.06;
        shaftGeometries.push(
          ...createOpenShaftWallGeometries(
            hole,
            shaftBottom,
            shaftTop,
            0.82,
            this.surfaceStyle.wallPatternScale,
          ),
        );
        if (holeKind === 'void') continue;

        const previewBounds = getPassageHolePreviewBounds(hole, this.plan.size);
        lowerFloorGeometries.push(createFloorGeometry(
          [previewBounds],
          PASSAGE_HOLE_LOWER_FLOOR_Y,
          this.surfaceStyle.floorPatternScale,
          this.surfaceStyle.floorQuarterTurn,
        ));
        lowerWallGeometries.push(...createOpenShaftWallGeometries(
          previewBounds,
          PASSAGE_HOLE_LOWER_FLOOR_Y,
          PASSAGE_HOLE_LOWER_CEILING_Y,
          0.92,
          this.surfaceStyle.wallPatternScale,
        ));
        lowerCeilingGeometries.push(
          ...cellsAroundHoles(previewBounds, [hole]).map((cell) =>
            createCeilingGeometry(
              cell,
              PASSAGE_HOLE_LOWER_CEILING_Y,
              this.surfaceStyle.ceilingPatternScale,
            )
          ),
        );
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
      this.lowerMaterials.wall,
      'low-passage-hole-walls',
      this.group,
    );
    makeMesh(
      mergeOrSingle(lowerFloorGeometries),
      this.lowerMaterials.floor,
      'low-passage-lower-floors',
      this.group,
    );
    makeMesh(
      mergeOrSingle(lowerWallGeometries),
      this.lowerMaterials.wall,
      'low-passage-lower-walls',
      this.group,
    );
    makeMesh(
      mergeOrSingle(lowerCeilingGeometries),
      this.lowerMaterials.ceiling,
      'low-passage-lower-ceilings',
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
      // white rectangle that merely stopped illuminating the room.
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
      const lowerFloor = new THREE.Mesh(lowerFloorGeometry, this.lowerMaterials.floor);
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
      this.lowerMaterials.floor,
      'open-pit-shaft-walls',
      this.group,
    );
    makeMesh(
      mergeOrSingle(abyssSideGeometries),
      this.lowerMaterials.floor,
      'open-abyss-shaft-walls',
      this.group,
    );
    makeMesh(
      mergeOrSingle(abyssStoreyGeometries),
      this.lowerMaterials.floor,
      'abyss-storey-edges',
      this.group,
    );
    makeMesh(
      mergeOrSingle(lowerCeilingGeometries),
      this.lowerMaterials.ceiling,
      'lower-office-ceiling',
      this.group,
    );
  }

  private buildStairs(): void {
    const stairFeatures = this.plan.features.filter(
      (feature): feature is StairSocketFeature => feature.kind === 'stair-socket',
    );
    const treadGeometries: THREE.BufferGeometry[] = [];
    const bodyGeometries: THREE.BufferGeometry[] = [];
    const undersideGeometries: THREE.BufferGeometry[] = [];
    const cageGeometries: THREE.BufferGeometry[] = [];
    const upperFloorGeometries: THREE.BufferGeometry[] = [];
    const upperUndersideGeometries: THREE.BufferGeometry[] = [];
    const upperFloorFasciaGeometries: THREE.BufferGeometry[] = [];
    const upperWallGeometries: THREE.BufferGeometry[] = [];
    const upperCeilingGeometries: THREE.BufferGeometry[] = [];
    const upperLightGeometries: THREE.BufferGeometry[] = [];
    const upperLightFrameGeometries: THREE.BufferGeometry[] = [];
    const lowerFloorGeometries: THREE.BufferGeometry[] = [];
    const lowerWallGeometries: THREE.BufferGeometry[] = [];
    const lowerCeilingGeometries: THREE.BufferGeometry[] = [];
    const lowerArrivalFasciaGeometries: THREE.BufferGeometry[] = [];
    const lowerLightGeometries: THREE.BufferGeometry[] = [];
    const lowerLightFrameGeometries: THREE.BufferGeometry[] = [];
    const worldHalf = this.plan.size * 0.5;
    const previewZoneFor = (bounds: Rect): Rect => ({
      minX: Math.max(-worldHalf, bounds.minX - 6),
      maxX: Math.min(worldHalf, bounds.maxX + 6),
      minZ: Math.max(-worldHalf, bounds.minZ - 6),
      maxZ: Math.min(worldHalf, bounds.maxZ + 6),
    });
    const addPreviewLights = (
      zone: Rect,
      ceilingY: number,
      openings: readonly Rect[],
      glowTarget: THREE.BufferGeometry[],
      frameTarget: THREE.BufferGeometry[],
    ): void => {
      const columns = Math.max(1, Math.min(3, Math.floor(rectWidth(zone) / 5.2)));
      const rows = Math.max(1, Math.min(3, Math.floor(rectDepth(zone) / 5.2)));
      for (let xIndex = 0; xIndex < columns; xIndex += 1) {
        for (let zIndex = 0; zIndex < rows; zIndex += 1) {
          const x = zone.minX + ((xIndex + 0.5) / columns) * rectWidth(zone);
          const z = zone.minZ + ((zIndex + 0.5) / rows) * rectDepth(zone);
          const quarterTurn = (xIndex + zIndex) % 2 === 1;
          const panelWidth = quarterTurn ? 0.72 : 1.72;
          const panelDepth = quarterTurn ? 1.72 : 0.72;
          const panelBounds: Rect = {
            minX: x - panelWidth * 0.5 - 0.12,
            maxX: x + panelWidth * 0.5 + 0.12,
            minZ: z - panelDepth * 0.5 - 0.12,
            maxZ: z + panelDepth * 0.5 + 0.12,
          };
          if (openings.some((opening) =>
            panelBounds.minX < opening.maxX && panelBounds.maxX > opening.minX &&
            panelBounds.minZ < opening.maxZ && panelBounds.maxZ > opening.minZ
          )) continue;
          const frame = new THREE.BoxGeometry(panelWidth + 0.18, 0.045, panelDepth + 0.18);
          frame.translate(x, ceilingY - 0.0225, z);
          frameTarget.push(frame);
          const light = new THREE.PlaneGeometry(1.72, 0.72);
          if (quarterTurn) light.rotateZ(Math.PI * 0.5);
          light.rotateX(Math.PI * 0.5);
          light.translate(x, ceilingY - 0.048, z);
          glowTarget.push(light);
        }
      }
    };
    for (const stairs of stairFeatures) {
      const slabs = getStairSlabs(stairs);
      for (const slab of slabs) {
        const bodyHeight = slab.kind === 'step' ? 0.3 : 0.2;
        bodyGeometries.push(removeHorizontalCaps(createTexturedBoxGeometry(
          rectWidth(slab.bounds),
          bodyHeight,
          rectDepth(slab.bounds),
          rectCenter(slab.bounds).x,
          slab.top - bodyHeight,
          rectCenter(slab.bounds).z,
          slab.kind === 'step' ? 0.94 : 0.98,
          this.surfaceStyle.wallPatternScale,
        )));
        treadGeometries.push(createFloorGeometry(
          [slab.bounds],
          slab.top + 0.0012,
          this.surfaceStyle.floorPatternScale,
          this.surfaceStyle.floorQuarterTurn,
        ));
      }
      const stepSlabs = slabs.filter((slab) => slab.kind === 'step');
      const flights = (stairs.layout ?? 'switchback') === 'straight'
        ? [stepSlabs]
        : [
            stepSlabs.slice(0, STAIR_STEPS_PER_FLIGHT),
            stepSlabs.slice(STAIR_STEPS_PER_FLIGHT),
          ];
      const axis = stairs.heading.startsWith('x') ? 'x' : 'z';
      for (const flight of flights) {
        if (flight.length === 0) continue;
        const bounds: Rect = {
          minX: Math.min(...flight.map((slab) => slab.bounds.minX)),
          maxX: Math.max(...flight.map((slab) => slab.bounds.maxX)),
          minZ: Math.min(...flight.map((slab) => slab.bounds.minZ)),
          maxZ: Math.max(...flight.map((slab) => slab.bounds.maxZ)),
        };
        const first = flight[0]!;
        const last = flight.at(-1)!;
        const firstAlong = axis === 'x' ? rectCenter(first.bounds).x : rectCenter(first.bounds).z;
        const lastAlong = axis === 'x' ? rectCenter(last.bounds).x : rectCenter(last.bounds).z;
        const bottom = Math.min(...flight.map((slab) => slab.top)) - STAIR_STORY_RISE / 30;
        const rise = Math.max(...flight.map((slab) => slab.top)) - bottom;
        const underside = createSlopedUndersideGeometry(
          rise,
          { bounds, axis, riseDirection: lastAlong >= firstAlong ? 1 : -1 },
          this.surfaceStyle.ceilingPatternScale,
        );
        underside.translate(0, bottom, 0);
        undersideGeometries.push(underside);
      }
      for (const landing of slabs.filter((slab) => slab.kind !== 'step')) {
        undersideGeometries.push(createCeilingGeometry(
          landing.bounds,
          landing.top - 0.16,
          this.surfaceStyle.ceilingPatternScale,
        ));
      }
      const baseY = stairs.baseY ?? 0;
      for (const wall of getStairCageWalls(stairs, this.plan.wallHeight)) {
        const geometry = createTexturedBoxGeometry(
          rectWidth(wall.bounds),
          wall.top - wall.bottom,
          rectDepth(wall.bounds),
          rectCenter(wall.bounds).x,
          wall.bottom,
          rectCenter(wall.bounds).z,
          wall.kind === 'divider' ? 0.96 : 0.92,
          this.surfaceStyle.wallPatternScale,
        );
        cageGeometries.push(
          wall.kind === 'divider' ? geometry : removeHorizontalCaps(geometry),
        );
      }

      const opening = getStairFloorOpening(stairs);
      const previewZone = previewZoneFor(stairs.bounds);
      if (!stairs.inherited && Math.abs(baseY) < 0.1) {
        const previewFloorY = baseY + STAIR_STORY_RISE;
        const previewCeilingY = previewFloorY + this.plan.wallHeight;
        upperFloorGeometries.push(createFloorGeometry(
          cellsAroundHoles(previewZone, [stairs.bounds]),
          previewFloorY,
          this.surfaceStyle.floorPatternScale,
          this.surfaceStyle.floorQuarterTurn,
        ));
        upperUndersideGeometries.push(...cellsAroundHoles(previewZone, [stairs.bounds]).map((rect) =>
          createCeilingGeometry(
            rect,
            previewFloorY - 0.12,
            this.surfaceStyle.ceilingPatternScale,
          )
        ));
        upperFloorFasciaGeometries.push(createRectFasciaGeometry(
          stairs.bounds,
          previewFloorY - 0.12,
          previewFloorY,
          this.surfaceStyle.wallPatternScale,
          true,
        ));
        // The real cage already lines the shaft through the plenum. Preview
        // walls begin on the next floor; extending this large rectangle down
        // to the current ceiling produced the floating blank panel seen from
        // inside the stairs.
        upperWallGeometries.push(
          ...createOpenShaftWallGeometries(
            previewZone,
            previewFloorY,
            previewCeilingY,
            0.96,
            this.surfaceStyle.wallPatternScale,
          ),
        );
        upperCeilingGeometries.push(...cellsAroundHoles(previewZone, [stairs.bounds]).map((rect) =>
          createCeilingGeometry(
            rect,
            previewCeilingY,
            this.surfaceStyle.ceilingPatternScale,
          )
        ));
        addPreviewLights(
          previewZone,
          previewCeilingY,
          [stairs.bounds],
          upperLightGeometries,
          upperLightFrameGeometries,
        );
      }
      if (stairs.inherited || baseY < -0.1) {
        const previewFloorY = baseY;
        const previewCeilingY = previewFloorY + this.plan.wallHeight;
        lowerFloorGeometries.push(createFloorGeometry(
          [previewZone],
          previewFloorY,
          this.surfaceStyle.floorPatternScale,
          this.surfaceStyle.floorQuarterTurn,
        ));
        // Keep the synthetic room shell below its actual drop ceiling. The
        // stair cage supplies the narrow textured lining up to the current
        // floor without closing either walkable end of the flight.
        lowerWallGeometries.push(...createOpenShaftWallGeometries(
          previewZone,
          previewFloorY,
          previewCeilingY,
          0.96,
          this.surfaceStyle.wallPatternScale,
        ));
        lowerCeilingGeometries.push(...cellsAroundHoles(previewZone, [stairs.bounds]).map((rect) =>
          createCeilingGeometry(
            rect,
            previewCeilingY,
            this.surfaceStyle.ceilingPatternScale,
          )
        ));
        lowerArrivalFasciaGeometries.push(createRectFasciaGeometry(
          stairs.bounds,
          baseY + STAIR_STORY_RISE - 0.12,
          baseY + STAIR_STORY_RISE,
          this.surfaceStyle.wallPatternScale,
          true,
        ));
        addPreviewLights(
          previewZone,
          previewCeilingY,
          [opening],
          lowerLightGeometries,
          lowerLightFrameGeometries,
        );
      }
    }
    makeMesh(
      mergeOrSingle(treadGeometries),
      this.materials.floor,
      'inter-storey-stair-flights',
      this.group,
    );
    makeMesh(
      mergeOrSingle(bodyGeometries),
      this.materials.wall,
      'inter-storey-stair-bodies',
      this.group,
    );
    makeMesh(
      mergeOrSingle(undersideGeometries),
      this.materials.ceiling,
      'inter-storey-stair-textured-undersides',
      this.group,
    );
    makeMesh(mergeOrSingle(cageGeometries), this.materials.wall, 'inter-storey-stair-cages', this.group);
    makeMesh(
      mergeOrSingle(upperFloorGeometries),
      this.previewMaterials.floor,
      'upper-stair-preview-floor',
      this.group,
    );
    makeMesh(
      mergeOrSingle(upperUndersideGeometries),
      this.previewMaterials.ceiling,
      'upper-stair-preview-floor-underside',
      this.group,
    );
    makeMesh(
      mergeOrSingle(upperFloorFasciaGeometries),
      this.previewMaterials.wall,
      'upper-stair-preview-floor-fascias',
      this.group,
    );
    makeMesh(
      mergeOrSingle(upperWallGeometries),
      this.previewMaterials.wall,
      'upper-stair-preview-wallpaper-walls',
      this.group,
    );
    makeMesh(
      mergeOrSingle(upperCeilingGeometries),
      this.previewMaterials.ceiling,
      'upper-stair-preview-ceiling',
      this.group,
    );
    makeMesh(
      mergeOrSingle(upperLightGeometries),
      this.previewFixtureGlowMaterial,
      'upper-stair-preview-lights',
      this.group,
    );
    makeMesh(
      mergeOrSingle(upperLightFrameGeometries),
      this.materials.fixtureFrame,
      'upper-stair-preview-light-frames',
      this.group,
    );
    makeMesh(
      mergeOrSingle(lowerFloorGeometries),
      this.previewMaterials.floor,
      'lower-stair-preview-floor',
      this.group,
    );
    makeMesh(
      mergeOrSingle(lowerWallGeometries),
      this.previewMaterials.wall,
      'lower-stair-preview-wallpaper-walls',
      this.group,
    );
    makeMesh(
      mergeOrSingle(lowerCeilingGeometries),
      this.previewMaterials.ceiling,
      'lower-stair-preview-ceiling',
      this.group,
    );
    makeMesh(
      mergeOrSingle(lowerArrivalFasciaGeometries),
      this.lowerMaterials.wall,
      'lower-stair-arrival-floor-fascias',
      this.group,
    );
    makeMesh(
      mergeOrSingle(lowerLightGeometries),
      this.previewFixtureGlowMaterial,
      'lower-stair-preview-lights',
      this.group,
    );
    makeMesh(
      mergeOrSingle(lowerLightFrameGeometries),
      this.materials.fixtureFrame,
      'lower-stair-preview-light-frames',
      this.group,
    );
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
    void playerPosition;
    for (const material of this.animatedFogMaterials) {
      material.uniforms.fogTime!.value = time;
    }
    this.doorLayer.update(delta);
  }

  setWorldOffset(offset: Readonly<THREE.Vector3>): void {
    this.lightingContext?.worldOffset.copy(offset);
  }

  getInteraction(
    playerPosition: THREE.Vector3,
    lookDirection: THREE.Vector3,
  ): WorldInteraction | null {
    const door = this.doorLayer.getInteraction(playerPosition, lookDirection);
    if (door) return { kind: 'door', ...door };
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
          kind: 'traversal',
          path: [vista.destination],
          duration: 0.72,
          duckDepth: 0.34,
          label: 'SE GLISSER DANS L’OUVERTURE',
        }
      : {
          kind: 'traversal',
          path: [vista.returnDestination],
          duration: 0.72,
          duckDepth: 0.34,
          label: 'REVENIR DANS LE LEVEL 0',
        };
  }

  openDoor(doorId: string, mode: DoorOpenMode): string | null {
    return this.doorLayer.open(doorId, mode);
  }

  getDoorStates(): DoorStateSnapshot[] {
    return this.doorLayer.getDoorStates();
  }

  restoreDoorStates(states: readonly DoorStateSnapshot[]): void {
    this.doorLayer.restoreDoorStates(states);
  }

  consumePassableDoorColliderIds(): string[] {
    return this.doorLayer.consumePassableColliderIds();
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
    this.doorLayer.dispose();
    this.propLayer.dispose();
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.InstancedMesh) object.geometry.dispose();
    });
    this.ownedMaterials.forEach((material) => material.dispose());
    this.graffitiMaterials.forEach((material) => material.dispose());
    this.graffitiTextures.forEach((texture) => texture.dispose());
    this.lightingContext?.lightField.dispose();
    this.bakedLightMaps?.general.dispose();
    this.bakedLightMaps?.ceiling.dispose();
    this.group.removeFromParent();
  }
}
