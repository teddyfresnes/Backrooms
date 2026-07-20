import * as THREE from 'three';
import type { MaterialSet } from './MaterialLibrary';
import type { Rect, WorldPlan } from '../world/types';

// The generator places its main partitions on a 0.5 m grid. Two texels per
// metre keep those partitions between samples instead of turning one 0.7 m
// texel into a dark stripe shared by both the floor and the ceiling.
const LIGHTMAP_RESOLUTION = 224;
const LIGHTMAP_UV_CHANNEL = 1;
const NEIGHBOUR_LIGHT_REACH = 12.5;
const LIGHT_RADIUS = 12.5;
const INDIRECT_LIGHT = [0.012, 0.011, 0.006] as const;
const EMITTER_SAMPLE_PATTERN = [
  [0, 0],
  [-0.82, -0.72],
  [0.82, -0.72],
  [-0.82, 0.72],
  [0.82, 0.72],
] as const;

interface BakedOccluder extends Rect {
  bottom: number;
  top: number;
}

interface SurfaceVisibility {
  general: number;
  ceiling: number;
}

export interface BakedLightMaps {
  general: THREE.Texture;
  ceiling: THREE.Texture;
}

export interface BakedLightMapData {
  readonly resolution: number;
  readonly general: Uint8Array;
  readonly ceiling: Uint8Array;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export const bakedLightMapTexelSize = (worldSize: number): number =>
  worldSize / LIGHTMAP_RESOLUTION;

export const bakedLightMapJunctionNeedsRepair = (
  fixedCoordinate: number,
  thickness: number,
  worldSize: number,
): boolean => {
  const texelSize = bakedLightMapTexelSize(worldSize);
  const half = worldSize * 0.5;
  const nearestIndex = Math.round((fixedCoordinate + half) / texelSize - 0.5);
  const nearestSample = -half + (nearestIndex + 0.5) * texelSize;
  return Math.abs(nearestSample - fixedCoordinate) <= thickness * 0.5 + 1e-5;
};

export const bakedOccluderReachesCeiling = (
  bottom: number,
  height: number,
  ceilingY: number,
): boolean => bottom <= ceilingY + 0.02 && bottom + height >= ceilingY - 0.04;

const rectsIntersect = (left: Rect, right: Rect, padding = 0): boolean =>
  left.minX - padding <= right.maxX &&
  left.maxX + padding >= right.minX &&
  left.minZ - padding <= right.maxZ &&
  left.maxZ + padding >= right.minZ;

const pointDistanceToRect = (x: number, z: number, rect: Rect): number => {
  const deltaX = Math.max(rect.minX - x, 0, x - rect.maxX);
  const deltaZ = Math.max(rect.minZ - z, 0, z - rect.maxZ);
  return Math.hypot(deltaX, deltaZ);
};

/**
 * Keeps light transport continuous when a sample crosses a room boundary.
 * Visibility still decides whether an actual aperture exists; this term only
 * models the gradual loss of direct spill and low-frequency bounce beyond it.
 */
export const bakedCrossRoomTransmission = (
  lightX: number,
  lightZ: number,
  pointX: number,
  pointZ: number,
  room: Rect,
): number => {
  const depthX = lightX < room.minX
    ? Math.max(0, pointX - room.minX)
    : lightX > room.maxX
      ? Math.max(0, room.maxX - pointX)
      : 0;
  const depthZ = lightZ < room.minZ
    ? Math.max(0, pointZ - room.minZ)
    : lightZ > room.maxZ
      ? Math.max(0, room.maxZ - pointZ)
      : 0;
  const penetrationDepth = Math.hypot(depthX, depthZ);
  return 0.2 + 0.8 * Math.exp(-penetrationDepth / 4.6);
};

const segmentHitsRect = (
  originX: number,
  originZ: number,
  targetX: number,
  targetZ: number,
  rect: Rect,
): boolean => {
  const directionX = targetX - originX;
  const directionZ = targetZ - originZ;
  let enter = 0;
  let exit = 1;
  for (const [origin, direction, min, max] of [
    [originX, directionX, rect.minX, rect.maxX],
    [originZ, directionZ, rect.minZ, rect.maxZ],
  ] as const) {
    if (Math.abs(direction) < 1e-5) {
      if (origin < min || origin > max) return false;
      continue;
    }
    const first = (min - origin) / direction;
    const second = (max - origin) / direction;
    enter = Math.max(enter, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
    if (enter > exit) return false;
  }
  // Ignore only the tiny portion occupied by the fixture itself. Any partition
  // reached before the sampled surface must stop the ray, including thin walls.
  return exit > 0.055 && enter < 0.999;
};

const worldOccluders = (plan: WorldPlan): BakedOccluder[] => [
  ...plan.walls
    .filter((wall) => wall.bottom >= -1 && wall.height > 1.2)
    .map((wall) => {
      const halfLength = wall.length * 0.5;
      const halfThickness = wall.thickness * 0.5;
      return wall.orientation === 'x'
        ? {
            minX: wall.x - halfLength,
            maxX: wall.x + halfLength,
            minZ: wall.z - halfThickness,
            maxZ: wall.z + halfThickness,
            bottom: wall.bottom,
            top: wall.bottom + wall.height,
          }
        : {
            minX: wall.x - halfThickness,
            maxX: wall.x + halfThickness,
            minZ: wall.z - halfLength,
            maxZ: wall.z + halfLength,
            bottom: wall.bottom,
            top: wall.bottom + wall.height,
          };
    }),
  ...plan.columns.map((column) => ({
    minX: column.x - column.width * 0.5,
    maxX: column.x + column.width * 0.5,
    minZ: column.z - column.depth * 0.5,
    maxZ: column.z + column.depth * 0.5,
    bottom: 0,
    top: column.height,
  })),
  ...plan.solidMasses.map((mass) => ({
    ...mass.bounds,
    bottom: 0,
    top: mass.height,
  })),
];

const emitterSamples = (
  lightX: number,
  lightZ: number,
  rotation: number,
  width: number,
): ReadonlyArray<readonly [number, number]> => {
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const halfWidth = Math.max(0.42, width * 0.46);
  const halfDepth = width > 1.65 ? 0.54 : 0.43;
  return EMITTER_SAMPLE_PATTERN.map(([patternX, patternZ]) => {
    const localX = patternX * halfWidth;
    const localZ = patternZ * halfDepth;
    return [
      lightX + localX * cosine - localZ * sine,
      lightZ + localX * sine + localZ * cosine,
    ] as const;
  });
};

const surfaceVisibility = (
  samples: ReadonlyArray<readonly [number, number]>,
  pointX: number,
  pointZ: number,
  generalOccluders: readonly BakedOccluder[],
  ceilingOccluders: readonly BakedOccluder[],
): SurfaceVisibility => {
  if (generalOccluders.length === 0) return { general: 1, ceiling: 1 };
  let generalVisible = 0;
  let ceilingVisible = 0;
  for (const [sourceX, sourceZ] of samples) {
    const generallyBlocked = generalOccluders.some(
      (occluder) => segmentHitsRect(sourceX, sourceZ, pointX, pointZ, occluder),
    );
    if (!generallyBlocked) {
      generalVisible += 1;
      ceilingVisible += 1;
      continue;
    }
    // A half-height partition can shadow the floor and walls, but light rays
    // travelling just below the suspended ceiling pass safely above it.
    const ceilingBlocked = ceilingOccluders.some(
      (occluder) => segmentHitsRect(sourceX, sourceZ, pointX, pointZ, occluder),
    );
    if (!ceilingBlocked) {
      ceilingVisible += 1;
    }
  }
  return {
    general: generalVisible / samples.length,
    ceiling: ceilingVisible / samples.length,
  };
};

const createPixelField = (): Float32Array => {
  const pixels = new Float32Array(LIGHTMAP_RESOLUTION * LIGHTMAP_RESOLUTION * 3);
  for (let index = 0; index < pixels.length; index += 3) {
    pixels[index] = INDIRECT_LIGHT[0];
    pixels[index + 1] = INDIRECT_LIGHT[1];
    pixels[index + 2] = INDIRECT_LIGHT[2];
  }
  return pixels;
};

const encodeLightMapPixels = (pixels: Float32Array): Uint8Array => {
  const data = new Uint8Array(LIGHTMAP_RESOLUTION * LIGHTMAP_RESOLUTION * 4);
  for (let index = 0; index < LIGHTMAP_RESOLUTION * LIGHTMAP_RESOLUTION; index += 1) {
    const source = index * 3;
    const target = index * 4;
    data[target] = Math.round(clamp01(pixels[source]!) * 255);
    data[target + 1] = Math.round(clamp01(pixels[source + 1]!) * 255);
    data[target + 2] = Math.round(clamp01(pixels[source + 2]!) * 255);
    data[target + 3] = 255;
  }
  return data;
};

const lightMapTextureFromData = (
  data: Uint8Array,
  resolution: number,
  name: string,
): THREE.DataTexture => {
  const texture = new THREE.DataTexture(data, resolution, resolution, THREE.RGBAFormat);
  texture.name = name;
  texture.channel = LIGHTMAP_UV_CHANNEL;
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  // Match CanvasTexture's historical orientation; the bake stores +Z in its
  // first scanline while light-map UVs use +Z at v=1.
  texture.flipY = true;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
};

/**
 * Bakes two diffuse fluorescent fields in one traversal. General surfaces keep
 * the broad architectural shadows, while the ceiling field only accepts
 * occluders that physically reach the ceiling plane.
 */
export const bakeLightMapData = (plan: WorldPlan): BakedLightMapData => {
  const scale = LIGHTMAP_RESOLUTION / plan.size;
  const half = plan.size * 0.5;
  const pixels = createPixelField();
  const ceilingPixels = createPixelField();

  const occluders = worldOccluders(plan);
  const ceilingOccluders = occluders.filter((occluder) =>
    bakedOccluderReachesCeiling(occluder.bottom, occluder.top - occluder.bottom, plan.wallHeight),
  );
  const activeUpperLights = plan.lights.filter((light) => !light.dead && light.level >= 0);
  for (const room of plan.rooms) {
    if (room.level < 0) continue;
    const directLights = activeUpperLights.filter((light) => light.roomId === room.id);
    const neighbouringLights = activeUpperLights
      .filter((light) => light.roomId !== room.id)
      .map((light) => ({ light, distance: pointDistanceToRect(light.x, light.z, room.bounds) }))
      .filter((candidate) => candidate.distance <= NEIGHBOUR_LIGHT_REACH)
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 4)
      .map((candidate) => candidate.light);
    const lights = [...directLights, ...neighbouringLights]
      .map((light) => {
        const color = new THREE.Color(light.color).convertLinearToSRGB();
        const crossRoom = light.roomId !== room.id;
        const pathBounds: Rect = {
          minX: Math.min(room.bounds.minX, light.x),
          maxX: Math.max(room.bounds.maxX, light.x),
          minZ: Math.min(room.bounds.minZ, light.z),
          maxZ: Math.max(room.bounds.maxZ, light.z),
        };
        return {
          ...light,
          red: color.r * 0.985,
          green: color.g * 1.015,
          blue: color.b * 1.055,
          energy: THREE.MathUtils.clamp(light.intensity, 0.8, 1.55),
          crossRoom,
          samples: emitterSamples(light.x, light.z, light.rotation, light.width),
          visibilityOccluders: occluders.filter((occluder) =>
            rectsIntersect(pathBounds, occluder, 0.35),
          ),
          ceilingVisibilityOccluders: ceilingOccluders.filter((occluder) =>
            rectsIntersect(pathBounds, occluder, 0.35),
          ),
        };
      });
    if (lights.length === 0) continue;
    const minX = Math.max(0, Math.floor((room.bounds.minX + half) * scale));
    const maxX = Math.min(LIGHTMAP_RESOLUTION - 1, Math.ceil((room.bounds.maxX + half) * scale) - 1);
    const minY = Math.max(0, Math.floor(LIGHTMAP_RESOLUTION - (room.bounds.maxZ + half) * scale));
    const maxY = Math.min(LIGHTMAP_RESOLUTION - 1, Math.ceil(LIGHTMAP_RESOLUTION - (room.bounds.minZ + half) * scale) - 1);
    for (let y = minY; y <= maxY; y += 1) {
      const worldZ = half - (y + 0.5) / scale;
      for (let x = minX; x <= maxX; x += 1) {
        const worldX = -half + (x + 0.5) / scale;
        const pixel = (y * LIGHTMAP_RESOLUTION + x) * 3;
        let roomRed = INDIRECT_LIGHT[0];
        let roomGreen = INDIRECT_LIGHT[1];
        let roomBlue = INDIRECT_LIGHT[2];
        let ceilingRed = INDIRECT_LIGHT[0];
        let ceilingGreen = INDIRECT_LIGHT[1];
        let ceilingBlue = INDIRECT_LIGHT[2];
        for (const light of lights) {
          const distance = Math.hypot(worldX - light.x, worldZ - light.z);
          if (distance >= LIGHT_RADIUS) continue;
          const falloff = 1 - distance / LIGHT_RADIUS;
          const visibility = surfaceVisibility(
            light.samples,
            worldX,
            worldZ,
            light.visibilityOccluders,
            light.ceilingVisibilityOccluders,
          );
          const visibleEnergy = light.crossRoom
            ? visibility.general
            : 0.08 + visibility.general * 0.92;
          const ceilingVisibleEnergy = light.crossRoom
            ? visibility.ceiling
            : 0.08 + visibility.ceiling * 0.92;
          const roomContribution = light.crossRoom
            ? bakedCrossRoomTransmission(light.x, light.z, worldX, worldZ, room.bounds)
            : 1;
          const baseEnergy =
            light.energy *
            roomContribution *
            falloff *
            falloff *
            0.62;
          const energy = baseEnergy * visibleEnergy;
          const ceilingEnergy = baseEnergy * ceilingVisibleEnergy;
          roomRed += light.red * energy;
          roomGreen += light.green * energy;
          roomBlue += light.blue * energy;
          ceilingRed += light.red * ceilingEnergy;
          ceilingGreen += light.green * ceilingEnergy;
          ceilingBlue += light.blue * ceilingEnergy;
        }
        // Room rectangles deliberately overlap around connections. Merging the
        // fields by their maximum prevents the same fixture from being added a
        // second time and producing a bright oval in the doorway.
        pixels[pixel] = Math.max(pixels[pixel]!, roomRed);
        pixels[pixel + 1] = Math.max(pixels[pixel + 1]!, roomGreen);
        pixels[pixel + 2] = Math.max(pixels[pixel + 2]!, roomBlue);
        ceilingPixels[pixel] = Math.max(ceilingPixels[pixel]!, ceilingRed);
        ceilingPixels[pixel + 1] = Math.max(ceilingPixels[pixel + 1]!, ceilingGreen);
        ceilingPixels[pixel + 2] = Math.max(ceilingPixels[pixel + 2]!, ceilingBlue);
      }
    }
  }
  return {
    resolution: LIGHTMAP_RESOLUTION,
    general: encodeLightMapPixels(pixels),
    ceiling: encodeLightMapPixels(ceilingPixels),
  };
};

export const createBakedLightMaps = (
  plan: WorldPlan,
  supplied?: BakedLightMapData,
): BakedLightMaps => {
  const data = supplied ?? bakeLightMapData(plan);
  return {
    general: lightMapTextureFromData(
      data.general,
      data.resolution,
      `baked-fluorescent-field-${plan.seed}`,
    ),
    ceiling: lightMapTextureFromData(
      data.ceiling,
      data.resolution,
      `baked-fluorescent-ceiling-field-${plan.seed}`,
    ),
  };
};

const withLightMap = <T extends THREE.MeshStandardMaterial>(
  source: T,
  lightMap: THREE.Texture,
  worldSize: number,
  intensity: number,
  shadowFloor: number,
  surfaceOffset = 0,
): T => {
  const material = source.clone() as T;
  material.name = `${source.name}-baked`;
  material.lightMap = lightMap;
  material.lightMapIntensity = intensity;
  material.userData.bakedLightMapWorldSize = worldSize;
  material.userData.bakedShadowFloor = shadowFloor;
  material.userData.bakedLightMapSurfaceOffset = surfaceOffset;
  // A standard Three lightMap only adds indirect light; it cannot make the
  // global fill darker. Use its luminance as a stable multiplicative mask too
  // so carpet, walls and ceiling share the same baked penumbra.
  material.onBeforeCompile = (shader) => {
    shader.uniforms.bakedShadowFloor = { value: shadowFloor };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float bakedShadowFloor;',
      )
      .replace(
        '#include <opaque_fragment>',
        `#ifdef USE_LIGHTMAP
          // lights_fragment_maps already sampled this texel for irradiance.
          // Reusing it avoids a second light-map fetch on every opaque pixel.
          float bakedLightLevel = dot( lightMapTexel.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
          float bakedSurfaceMask = mix( bakedShadowFloor, 1.0, smoothstep( 0.012, 0.29, bakedLightLevel ) );
          outgoingLight *= bakedSurfaceMask;
        #endif
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => 'baked-light-surface-mask-v2';
  material.needsUpdate = true;
  return material;
};

export interface BakedMaterialSet {
  materials: MaterialSet;
  ownedMaterials: THREE.MeshStandardMaterial[];
}

export const createBakedMaterialSet = (
  source: MaterialSet,
  lightMaps: BakedLightMaps,
  worldSize: number,
): BakedMaterialSet => {
  const wall = withLightMap(source.wall, lightMaps.general, worldSize, 0.9, 0.7, 0.48);
  const plaster = withLightMap(source.plaster, lightMaps.general, worldSize, 0.82, 0.7, 0.48);
  // The carpet receives less direct energy than vertical surfaces. This keeps
  // it visibly light without bringing back the old glowing-floor look.
  const floor = withLightMap(source.floor, lightMaps.general, worldSize, 0.7, 0.68);
  const ceiling = withLightMap(source.ceiling, lightMaps.ceiling, worldSize, 0.78, 0.72);
  const baseboard = withLightMap(source.baseboard, lightMaps.general, worldSize, 0.68, 0.66, 0.32);
  const pitWall = withLightMap(source.pitWall, lightMaps.general, worldSize, 0.48, 0.66, 0.42);
  const pitBottom = withLightMap(source.pitBottom, lightMaps.general, worldSize, 0.12, 0.64);
  const metal = withLightMap(source.metal, lightMaps.general, worldSize, 0.38, 0.64);
  const fixtureFrame = withLightMap(source.fixtureFrame, lightMaps.general, worldSize, 0.72, 0.7);
  const ownedMaterials = [
    wall,
    plaster,
    floor,
    ceiling,
    baseboard,
    pitWall,
    pitBottom,
    metal,
    fixtureFrame,
  ];
  return {
    materials: {
      ...source,
      wall,
      plaster,
      floor,
      ceiling,
      baseboard,
      pitWall,
      pitBottom,
      metal,
      fixtureFrame,
    },
    ownedMaterials,
  };
};

export const ensureBakedLightUv = (
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  edgeInset = 0,
): void => {
  if (!(material instanceof THREE.MeshStandardMaterial) || material.lightMap === null) return;
  if (geometry.hasAttribute('uv1')) return;
  const worldSize = material.userData.bakedLightMapWorldSize;
  if (typeof worldSize !== 'number' || !Number.isFinite(worldSize) || worldSize <= 0) return;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const storedSurfaceOffset = material.userData.bakedLightMapSurfaceOffset;
  const surfaceOffset = typeof storedSurfaceOffset === 'number' ? storedSurfaceOffset : 0;
  if (edgeInset > 0 && geometry.boundingBox === null) geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  const values = new Float32Array(position.count * 2);
  const half = worldSize * 0.5;
  for (let index = 0; index < position.count; index += 1) {
    const normalX = normal ? normal.getX(index) : 0;
    const normalZ = normal ? normal.getZ(index) : 0;
    let sampleX = position.getX(index) + normalX * surfaceOffset;
    let sampleZ = position.getZ(index) + normalZ * surfaceOffset;
    // A side face ending in a perpendicular wall used to sample inside that
    // second wall. Pull only its longitudinal endpoints slightly into the room.
    if (bounds && Math.abs(normalZ) > 0.5 && bounds.max.x - bounds.min.x > edgeInset * 2) {
      sampleX = THREE.MathUtils.clamp(sampleX, bounds.min.x + edgeInset, bounds.max.x - edgeInset);
    }
    if (bounds && Math.abs(normalX) > 0.5 && bounds.max.z - bounds.min.z > edgeInset * 2) {
      sampleZ = THREE.MathUtils.clamp(sampleZ, bounds.min.z + edgeInset, bounds.max.z - edgeInset);
    }
    values[index * 2] = clamp01((sampleX + half) / worldSize);
    values[index * 2 + 1] = clamp01((sampleZ + half) / worldSize);
  }
  geometry.setAttribute('uv1', new THREE.BufferAttribute(values, 2));
};
