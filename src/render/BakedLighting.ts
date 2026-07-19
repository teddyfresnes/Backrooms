import * as THREE from 'three';
import type { MaterialSet } from './MaterialLibrary';
import type { Rect, WorldPlan } from '../world/types';

// The generator places its main partitions on a 0.5 m grid. Two texels per
// metre keep those partitions between samples instead of turning one 0.7 m
// texel into a dark stripe shared by both the floor and the ceiling.
const LIGHTMAP_RESOLUTION = 224;
const LIGHTMAP_UV_CHANNEL = 1;
const NEIGHBOUR_LIGHT_REACH = 9.2;
const INDIRECT_LIGHT = [0.008, 0.008, 0.004] as const;
const LIGHT_SAMPLES = [
  [0, 0],
  [0.18, 0.09],
  [-0.16, -0.11],
  [0.07, -0.18],
  [-0.09, 0.17],
] as const;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

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

const worldOccluders = (plan: WorldPlan): Rect[] => [
  ...plan.walls
    .filter((wall) => wall.bottom >= -1 && wall.height > 1.2)
    .map((wall) => {
      const halfLength = wall.length * 0.5;
      const halfThickness = wall.thickness * 0.5;
      return wall.orientation === 'x'
        ? { minX: wall.x - halfLength, maxX: wall.x + halfLength, minZ: wall.z - halfThickness, maxZ: wall.z + halfThickness }
        : { minX: wall.x - halfThickness, maxX: wall.x + halfThickness, minZ: wall.z - halfLength, maxZ: wall.z + halfLength };
    }),
  ...plan.columns.map((column) => ({
    minX: column.x - column.width * 0.5,
    maxX: column.x + column.width * 0.5,
    minZ: column.z - column.depth * 0.5,
    maxZ: column.z + column.depth * 0.5,
  })),
  ...plan.solidMasses.map((mass) => mass.bounds),
];

const softVisibility = (
  lightX: number,
  lightZ: number,
  pointX: number,
  pointZ: number,
  occluders: readonly Rect[],
): number => {
  if (occluders.length === 0) return 1;
  let visible = 0;
  for (const [offsetX, offsetZ] of LIGHT_SAMPLES) {
    const sourceX = lightX + offsetX;
    const sourceZ = lightZ + offsetZ;
    if (!occluders.some((occluder) => segmentHitsRect(sourceX, sourceZ, pointX, pointZ, occluder))) {
      visible += 1;
    }
  }
  return visible / LIGHT_SAMPLES.length;
};

/**
 * Bakes diffuse fluorescent lighting into a tiny per-chunk light field. Each
 * texel traces to the room's fixtures against walls, columns and solid masses,
 * giving the infinite world stable soft shadows without runtime light popping.
 */
export const createBakedLightMap = (plan: WorldPlan): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = LIGHTMAP_RESOLUTION;
  canvas.height = LIGHTMAP_RESOLUTION;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable for baked lighting.');

  const scale = LIGHTMAP_RESOLUTION / plan.size;
  const half = plan.size * 0.5;
  const pixels = new Float32Array(LIGHTMAP_RESOLUTION * LIGHTMAP_RESOLUTION * 3);
  for (let index = 0; index < pixels.length; index += 3) {
    pixels[index] = INDIRECT_LIGHT[0];
    pixels[index + 1] = INDIRECT_LIGHT[1];
    pixels[index + 2] = INDIRECT_LIGHT[2];
  }

  const occluders = worldOccluders(plan);
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
        const neighbourDistance = pointDistanceToRect(light.x, light.z, room.bounds);
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
          roomContribution: crossRoom
            ? 0.48 * Math.pow(1 - neighbourDistance / NEIGHBOUR_LIGHT_REACH, 1.1)
            : 1,
          visibilityOccluders: occluders.filter((occluder) =>
            rectsIntersect(pathBounds, occluder, 0.35),
          ),
        };
      });
    if (lights.length === 0) continue;
    const minX = Math.max(0, Math.floor((room.bounds.minX + half) * scale));
    const maxX = Math.min(LIGHTMAP_RESOLUTION - 1, Math.ceil((room.bounds.maxX + half) * scale) - 1);
    const minY = Math.max(0, Math.floor(LIGHTMAP_RESOLUTION - (room.bounds.maxZ + half) * scale));
    const maxY = Math.min(LIGHTMAP_RESOLUTION - 1, Math.ceil(LIGHTMAP_RESOLUTION - (room.bounds.minZ + half) * scale) - 1);
    const roomSpan = Math.max(room.bounds.maxX - room.bounds.minX, room.bounds.maxZ - room.bounds.minZ);
    const radius = THREE.MathUtils.clamp(roomSpan * 0.52, 7.2, 11.8);

    for (let y = minY; y <= maxY; y += 1) {
      const worldZ = half - (y + 0.5) / scale;
      for (let x = minX; x <= maxX; x += 1) {
        const worldX = -half + (x + 0.5) / scale;
        const pixel = (y * LIGHTMAP_RESOLUTION + x) * 3;
        let roomRed = INDIRECT_LIGHT[0];
        let roomGreen = INDIRECT_LIGHT[1];
        let roomBlue = INDIRECT_LIGHT[2];
        for (const light of lights) {
          const distance = Math.hypot(worldX - light.x, worldZ - light.z);
          if (distance >= radius) continue;
          const falloff = 1 - distance / radius;
          const visibility = softVisibility(
            light.x,
            light.z,
            worldX,
            worldZ,
            light.visibilityOccluders,
          );
          const visibleEnergy = light.crossRoom ? visibility : 0.08 + visibility * 0.92;
          const energy =
            light.energy *
            light.roomContribution *
            falloff *
            falloff *
            visibleEnergy *
            0.62;
          roomRed += light.red * energy;
          roomGreen += light.green * energy;
          roomBlue += light.blue * energy;
        }
        // Room rectangles deliberately overlap around connections. Merging the
        // fields by their maximum prevents the same fixture from being added a
        // second time and producing a bright oval in the doorway.
        pixels[pixel] = Math.max(pixels[pixel]!, roomRed);
        pixels[pixel + 1] = Math.max(pixels[pixel + 1]!, roomGreen);
        pixels[pixel + 2] = Math.max(pixels[pixel + 2]!, roomBlue);
      }
    }
  }

  const image = context.createImageData(LIGHTMAP_RESOLUTION, LIGHTMAP_RESOLUTION);
  for (let index = 0; index < LIGHTMAP_RESOLUTION * LIGHTMAP_RESOLUTION; index += 1) {
    const source = index * 3;
    const target = index * 4;
    image.data[target] = Math.round(clamp01(pixels[source]!) * 255);
    image.data[target + 1] = Math.round(clamp01(pixels[source + 1]!) * 255);
    image.data[target + 2] = Math.round(clamp01(pixels[source + 2]!) * 255);
    image.data[target + 3] = 255;
  }
  context.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `baked-fluorescent-field-${plan.seed}`;
  texture.channel = LIGHTMAP_UV_CHANNEL;
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
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
          vec3 bakedMaskTexel = texture2D( lightMap, vLightMapUv ).rgb;
          float bakedLightLevel = dot( bakedMaskTexel, vec3( 0.2126, 0.7152, 0.0722 ) );
          float bakedSurfaceMask = mix( bakedShadowFloor, 1.0, smoothstep( 0.018, 0.34, bakedLightLevel ) );
          outgoingLight *= bakedSurfaceMask;
        #endif
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => 'baked-light-surface-mask-v1';
  material.needsUpdate = true;
  return material;
};

export interface BakedMaterialSet {
  materials: MaterialSet;
  ownedMaterials: THREE.MeshStandardMaterial[];
}

export const createBakedMaterialSet = (
  source: MaterialSet,
  lightMap: THREE.Texture,
  worldSize: number,
): BakedMaterialSet => {
  const wall = withLightMap(source.wall, lightMap, worldSize, 0.9, 0.6, 0.48);
  const plaster = withLightMap(source.plaster, lightMap, worldSize, 0.82, 0.6, 0.48);
  // The carpet receives less direct energy than vertical surfaces. This keeps
  // it visibly light without bringing back the old glowing-floor look.
  const floor = withLightMap(source.floor, lightMap, worldSize, 0.7, 0.56);
  const ceiling = withLightMap(source.ceiling, lightMap, worldSize, 0.78, 0.6);
  const baseboard = withLightMap(source.baseboard, lightMap, worldSize, 0.68, 0.58, 0.32);
  const pitWall = withLightMap(source.pitWall, lightMap, worldSize, 0.48, 0.58, 0.42);
  const pitBottom = withLightMap(source.pitBottom, lightMap, worldSize, 0.12, 0.58);
  const metal = withLightMap(source.metal, lightMap, worldSize, 0.38, 0.56);
  const fixtureFrame = withLightMap(source.fixtureFrame, lightMap, worldSize, 0.72, 0.6);
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
