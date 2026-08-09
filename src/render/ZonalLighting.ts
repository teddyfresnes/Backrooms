import * as THREE from 'three';
import type { MaterialSet } from './MaterialLibrary';
import type { Rect, VisualBiome, WorldPlan } from '../world/types';

const MAX_UNLIT_ZONES = 8;
const ZONE_EDGE_FEATHER = 0.72;
const DARK_VISIBILITY_NEAR = 6.5;
const DARK_VISIBILITY_FAR = 27;
const LIGHT_FIELD_RESOLUTION = 96;
const LIGHT_FIELD_BASE = 0.38;
const CONTACT_DISTANCE = 1.7;

const BIOME_LIGHTING: Record<VisualBiome, {
  fluorescentTint: number;
  darknessColor: number;
  biomeMix: number;
}> = {
  yellow: {
    fluorescentTint: 0xffefb8,
    darknessColor: 0x050504,
    biomeMix: 0.05,
  },
  red: {
    fluorescentTint: 0xff8b78,
    darknessColor: 0x080100,
    biomeMix: 0.16,
  },
  white: {
    fluorescentTint: 0xf2f8ff,
    darknessColor: 0x050809,
    biomeMix: 0.04,
  },
};

interface SurfaceLightingProfile {
  readonly litGain: number;
  readonly darkFloor: number;
  readonly fluorescentLift: number;
  readonly surfaceOffset: number;
  readonly proximityOcclusion: number;
  readonly verticalRelief: number;
}

const DECOR_LIGHTING_PROFILE: SurfaceLightingProfile = {
  litGain: 0.94,
  darkFloor: 0.055,
  fluorescentLift: 0.012,
  surfaceOffset: 0,
  proximityOcclusion: 0,
  verticalRelief: 0,
};

interface ZonalShaderUniforms {
  readonly zoneCount: THREE.IUniform<number>;
  readonly zones: THREE.IUniform<THREE.Vector4[]>;
  readonly zoneFeather: THREE.IUniform<number>;
  readonly darkNear: THREE.IUniform<number>;
  readonly darkFar: THREE.IUniform<number>;
  readonly darkColor: THREE.IUniform<THREE.Color>;
  readonly fluorescentTint: THREE.IUniform<THREE.Color>;
  readonly biomeMix: THREE.IUniform<number>;
  readonly litGain: THREE.IUniform<number>;
  readonly darkFloor: THREE.IUniform<number>;
  readonly fluorescentLift: THREE.IUniform<number>;
  readonly surfaceOffset: THREE.IUniform<number>;
  readonly chunkWorldOffset: THREE.IUniform<THREE.Vector3>;
  readonly zoneMinY: THREE.IUniform<number>;
  readonly zoneMaxY: THREE.IUniform<number>;
  readonly lightField: THREE.IUniform<THREE.DataTexture>;
  readonly chunkSize: THREE.IUniform<number>;
  readonly proximityOcclusion: THREE.IUniform<number>;
  readonly verticalRelief: THREE.IUniform<number>;
}

export interface ZonalLightingContext {
  readonly zoneCount: number;
  readonly zones: THREE.Vector4[];
  readonly fluorescentTint: THREE.Color;
  readonly darknessColor: THREE.Color;
  readonly biomeMix: number;
  readonly zoneMinY: number;
  readonly zoneMaxY: number;
  readonly worldOffset: THREE.Vector3;
  readonly lightField: THREE.DataTexture;
  readonly chunkSize: number;
}

export interface ZonalMaterialSet {
  readonly materials: MaterialSet;
  readonly ownedMaterials: THREE.MeshStandardMaterial[];
  readonly context: ZonalLightingContext;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Signed distance to the nearest edge of an axis-aligned room rectangle.
 * Positive values are inside, negative values are outside.
 */
export const signedDistanceInsideRect = (x: number, z: number, rect: Rect): number =>
  Math.min(x - rect.minX, rect.maxX - x, z - rect.minZ, rect.maxZ - z);

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const ratio = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return ratio * ratio * (3 - 2 * ratio);
};

/**
 * Samples the same feathered blackout field used by the surface shader. It is
 * intentionally spatial: crossing a threshold changes the room, never a fog
 * sphere centred on the player.
 */
export const unlitZoneInfluence = (
  zones: readonly Rect[],
  x: number,
  z: number,
  feather = ZONE_EDGE_FEATHER,
): number => {
  let influence = 0;
  for (const zone of zones) {
    const zoneInfluence = smoothstep(
      -feather,
      feather,
      signedDistanceInsideRect(x, z, zone),
    );
    influence = 1 - (1 - influence) * (1 - zoneInfluence);
  }
  return influence;
};

export const shaderUnlitZones = (zones: readonly Rect[]): readonly Rect[] =>
  zones.slice(0, MAX_UNLIT_ZONES);

/**
 * Builds a tiny, occlusion-free exposure field from the real fluorescent
 * panels. Its second channel stores a low-frequency structural proximity field
 * for subtle contact darkening. It costs one RG8 texture sample per fragment
 * (18 KiB per chunk at the current resolution), with no rays or occlusion bake.
 */
export const createFluorescentLightField = (plan: WorldPlan): THREE.DataTexture => {
  const pixelCount = LIGHT_FIELD_RESOLUTION * LIGHT_FIELD_RESOLUTION;
  const data = new Uint8Array(pixelCount * 2);
  for (let index = 0; index < pixelCount; index += 1) {
    data[index * 2] = Math.round(LIGHT_FIELD_BASE * 255);
  }
  const halfSize = plan.size * 0.5;
  const metresPerPixel = plan.size / LIGHT_FIELD_RESOLUTION;
  for (const light of plan.lights) {
    if (light.dead || light.level !== 0) continue;
    const radius = THREE.MathUtils.clamp(7 + light.width * 1.6, 8, 11);
    const minX = Math.max(0, Math.floor((light.x - radius + halfSize) / metresPerPixel));
    const maxX = Math.min(
      LIGHT_FIELD_RESOLUTION - 1,
      Math.ceil((light.x + radius + halfSize) / metresPerPixel),
    );
    const minZ = Math.max(0, Math.floor((light.z - radius + halfSize) / metresPerPixel));
    const maxZ = Math.min(
      LIGHT_FIELD_RESOLUTION - 1,
      Math.ceil((light.z + radius + halfSize) / metresPerPixel),
    );
    const peak = THREE.MathUtils.clamp(0.72 + (light.intensity - 0.8) * 0.35, 0.7, 0.94);
    for (let zIndex = minZ; zIndex <= maxZ; zIndex += 1) {
      const z = (zIndex + 0.5) * metresPerPixel - halfSize;
      for (let xIndex = minX; xIndex <= maxX; xIndex += 1) {
        const x = (xIndex + 0.5) * metresPerPixel - halfSize;
        const distance = Math.hypot(x - light.x, z - light.z);
        const ratio = clamp01(1 - distance / radius);
        const falloff = ratio * ratio * (3 - 2 * ratio);
        const exposure = LIGHT_FIELD_BASE + (peak - LIGHT_FIELD_BASE) * falloff;
        const index = (zIndex * LIGHT_FIELD_RESOLUTION + xIndex) * 2;
        data[index] = Math.max(data[index], Math.round(exposure * 255));
      }
    }
  }

  const structuralRects: Rect[] = [];
  for (const wall of plan.walls) {
    if (wall.bottom > 0.12 || wall.bottom + wall.height < 0.2) continue;
    const halfLength = wall.length * 0.5;
    const halfThickness = Math.max(0.08, wall.thickness * 0.5);
    structuralRects.push(wall.orientation === 'x'
      ? {
          minX: wall.x - halfLength,
          minZ: wall.z - halfThickness,
          maxX: wall.x + halfLength,
          maxZ: wall.z + halfThickness,
        }
      : {
          minX: wall.x - halfThickness,
          minZ: wall.z - halfLength,
          maxX: wall.x + halfThickness,
          maxZ: wall.z + halfLength,
        });
  }
  for (const column of plan.columns) {
    const bottom = column.bottom ?? 0;
    if (bottom > 0.12 || bottom + column.height < 0.2) continue;
    structuralRects.push({
      minX: column.x - column.width * 0.5,
      minZ: column.z - column.depth * 0.5,
      maxX: column.x + column.width * 0.5,
      maxZ: column.z + column.depth * 0.5,
    });
  }
  for (const mass of plan.solidMasses) {
    if (mass.height >= 0.2) structuralRects.push(mass.bounds);
  }

  const proximity = new Float32Array(pixelCount);
  proximity.fill(Number.POSITIVE_INFINITY);
  for (const rect of structuralRects) {
    const minX = THREE.MathUtils.clamp(
      Math.floor((rect.minX + halfSize) / metresPerPixel),
      0,
      LIGHT_FIELD_RESOLUTION - 1,
    );
    const maxX = THREE.MathUtils.clamp(
      Math.floor((rect.maxX + halfSize) / metresPerPixel),
      0,
      LIGHT_FIELD_RESOLUTION - 1,
    );
    const minZ = THREE.MathUtils.clamp(
      Math.floor((rect.minZ + halfSize) / metresPerPixel),
      0,
      LIGHT_FIELD_RESOLUTION - 1,
    );
    const maxZ = THREE.MathUtils.clamp(
      Math.floor((rect.maxZ + halfSize) / metresPerPixel),
      0,
      LIGHT_FIELD_RESOLUTION - 1,
    );
    for (let zIndex = minZ; zIndex <= maxZ; zIndex += 1) {
      for (let xIndex = minX; xIndex <= maxX; xIndex += 1) {
        proximity[zIndex * LIGHT_FIELD_RESOLUTION + xIndex] = 0;
      }
    }
  }
  const diagonal = Math.SQRT2;
  const relax = (index: number, neighbour: number, cost: number): void => {
    if (neighbour < 0 || neighbour >= pixelCount) return;
    proximity[index] = Math.min(proximity[index], proximity[neighbour] + cost);
  };
  for (let zIndex = 0; zIndex < LIGHT_FIELD_RESOLUTION; zIndex += 1) {
    for (let xIndex = 0; xIndex < LIGHT_FIELD_RESOLUTION; xIndex += 1) {
      const index = zIndex * LIGHT_FIELD_RESOLUTION + xIndex;
      if (xIndex > 0) relax(index, index - 1, 1);
      if (zIndex > 0) relax(index, index - LIGHT_FIELD_RESOLUTION, 1);
      if (xIndex > 0 && zIndex > 0) relax(index, index - LIGHT_FIELD_RESOLUTION - 1, diagonal);
      if (xIndex + 1 < LIGHT_FIELD_RESOLUTION && zIndex > 0) {
        relax(index, index - LIGHT_FIELD_RESOLUTION + 1, diagonal);
      }
    }
  }
  for (let zIndex = LIGHT_FIELD_RESOLUTION - 1; zIndex >= 0; zIndex -= 1) {
    for (let xIndex = LIGHT_FIELD_RESOLUTION - 1; xIndex >= 0; xIndex -= 1) {
      const index = zIndex * LIGHT_FIELD_RESOLUTION + xIndex;
      if (xIndex + 1 < LIGHT_FIELD_RESOLUTION) relax(index, index + 1, 1);
      if (zIndex + 1 < LIGHT_FIELD_RESOLUTION) {
        relax(index, index + LIGHT_FIELD_RESOLUTION, 1);
      }
      if (xIndex + 1 < LIGHT_FIELD_RESOLUTION && zIndex + 1 < LIGHT_FIELD_RESOLUTION) {
        relax(index, index + LIGHT_FIELD_RESOLUTION + 1, diagonal);
      }
      if (xIndex > 0 && zIndex + 1 < LIGHT_FIELD_RESOLUTION) {
        relax(index, index + LIGHT_FIELD_RESOLUTION - 1, diagonal);
      }
    }
  }
  for (let index = 0; index < pixelCount; index += 1) {
    const distance = proximity[index] * metresPerPixel;
    data[index * 2 + 1] = Math.round(
      (1 - smoothstep(0.18, CONTACT_DISTANCE, distance)) * 255,
    );
  }
  const texture = new THREE.DataTexture(
    data,
    LIGHT_FIELD_RESOLUTION,
    LIGHT_FIELD_RESOLUTION,
    THREE.RGFormat,
    THREE.UnsignedByteType,
  );
  texture.name = `fluorescent-exposure-${plan.seed}`;
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
};

export const createZonalLightingContext = (plan: WorldPlan): ZonalLightingContext => {
  const biome = plan.visualBiome ?? 'yellow';
  const palette = BIOME_LIGHTING[biome];
  const zones = shaderUnlitZones(plan.unlitZones ?? []).map(
    (zone) => new THREE.Vector4(zone.minX, zone.minZ, zone.maxX, zone.maxZ),
  );
  while (zones.length < MAX_UNLIT_ZONES) zones.push(new THREE.Vector4());
  return {
    zoneCount: Math.min(plan.unlitZones?.length ?? 0, MAX_UNLIT_ZONES),
    zones,
    fluorescentTint: new THREE.Color(palette.fluorescentTint),
    darknessColor: new THREE.Color(palette.darknessColor),
    biomeMix: palette.biomeMix,
    zoneMinY: -0.55,
    zoneMaxY: plan.wallHeight + 0.55,
    worldOffset: new THREE.Vector3(),
    lightField: createFluorescentLightField(plan),
    chunkSize: plan.size,
  };
};

const makeUniforms = (
  context: ZonalLightingContext,
  profile: SurfaceLightingProfile,
): ZonalShaderUniforms => {
  return {
    zoneCount: { value: context.zoneCount },
    zones: { value: context.zones },
    zoneFeather: { value: ZONE_EDGE_FEATHER },
    darkNear: { value: DARK_VISIBILITY_NEAR },
    darkFar: { value: DARK_VISIBILITY_FAR },
    darkColor: { value: context.darknessColor },
    fluorescentTint: { value: context.fluorescentTint },
    biomeMix: { value: context.biomeMix },
    litGain: { value: profile.litGain },
    darkFloor: { value: profile.darkFloor },
    fluorescentLift: { value: profile.fluorescentLift },
    surfaceOffset: { value: profile.surfaceOffset },
    chunkWorldOffset: { value: context.worldOffset },
    zoneMinY: { value: context.zoneMinY },
    zoneMaxY: { value: context.zoneMaxY },
    lightField: { value: context.lightField },
    chunkSize: { value: context.chunkSize },
    proximityOcclusion: { value: profile.proximityOcclusion },
    verticalRelief: { value: profile.verticalRelief },
  };
};

export const applyZonalLighting = (
  material: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial,
  context: ZonalLightingContext,
  profile: SurfaceLightingProfile = DECOR_LIGHTING_PROFILE,
): void => {
  const uniforms = makeUniforms(context, profile);
  if (material instanceof THREE.MeshStandardMaterial) material.lightMap = null;
  const supportsSurfaceNormal = material instanceof THREE.MeshStandardMaterial;
  material.userData.zonalLighting = {
    zoneCount: uniforms.zoneCount.value,
    zoneFeather: uniforms.zoneFeather.value,
    darkNear: uniforms.darkNear.value,
    darkFar: uniforms.darkFar.value,
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float surfaceOffset;
        varying vec3 vZonalWorldPosition;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 zonalPosition = transformed${supportsSurfaceNormal ? ' + objectNormal * surfaceOffset' : ''};
        #ifdef USE_INSTANCING
          zonalPosition = ( instanceMatrix * vec4( zonalPosition, 1.0 ) ).xyz;
        #endif
        vZonalWorldPosition = ( modelMatrix * vec4( zonalPosition, 1.0 ) ).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform int zoneCount;
        uniform vec4 zones[${MAX_UNLIT_ZONES}];
        uniform float zoneFeather;
        uniform float darkNear;
        uniform float darkFar;
        uniform vec3 darkColor;
        uniform vec3 fluorescentTint;
        uniform float biomeMix;
        uniform float litGain;
        uniform float darkFloor;
        uniform float fluorescentLift;
        uniform vec3 chunkWorldOffset;
        uniform float zoneMinY;
        uniform float zoneMaxY;
        uniform sampler2D lightField;
        uniform float chunkSize;
        uniform float proximityOcclusion;
        uniform float verticalRelief;
        varying vec3 vZonalWorldPosition;

        float blackoutInfluence( const in vec2 point ) {
          float influence = 0.0;
          for ( int index = 0; index < ${MAX_UNLIT_ZONES}; index ++ ) {
            if ( index >= zoneCount ) break;
            vec4 zone = zones[index];
            float signedEdge = min(
              min(point.x - zone.x, zone.z - point.x),
              min(point.y - zone.y, zone.w - point.y)
            );
            float zoneInfluence = smoothstep(-zoneFeather, zoneFeather, signedEdge);
            influence = 1.0 - (1.0 - influence) * (1.0 - zoneInfluence);
          }
          return influence;
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `vec3 zonalChunkPosition = vZonalWorldPosition - chunkWorldOffset;
        float storyMask = step(zoneMinY, zonalChunkPosition.y)
          * step(zonalChunkPosition.y, zoneMaxY);
        float blackout = blackoutInfluence(zonalChunkPosition.xz) * storyMask;
        vec2 lightFieldUv = clamp(zonalChunkPosition.xz / chunkSize + 0.5, 0.0, 1.0);
        vec2 localField = texture2D(lightField, lightFieldUv).rg;
        float localExposure = localField.r;
        float fluorescentBandA = abs(
          fract(dot(zonalChunkPosition.xz, vec2(0.037, 0.019))) - 0.5
        );
        float fluorescentBandB = abs(
          fract(dot(zonalChunkPosition.xz, vec2(-0.013, 0.043))) - 0.5
        );
        float fluorescentVariation = 1.0
          + (fluorescentBandA - 0.25) * 0.05
          + (fluorescentBandB - 0.25) * 0.035;
        float poolLight = mix(0.72, 1.08, localExposure);
        float surfaceLight = mix(litGain * fluorescentVariation * poolLight, darkFloor, blackout);
        outgoingLight *= surfaceLight;
        float wallHeight = max(0.1, zoneMaxY - 0.55);
        float heightRatio = clamp(zonalChunkPosition.y / wallHeight, 0.0, 1.0);
        float verticalContact = 1.0 - smoothstep(
          0.025,
          0.16,
          min(heightRatio, 1.0 - heightRatio)
        );
        float contactShade = clamp(
          localField.g * proximityOcclusion + verticalContact * verticalRelief,
          0.0,
          0.18
        );
        outgoingLight *= 1.0 - contactShade * (1.0 - blackout);
        outgoingLight *= mix(vec3(1.0), fluorescentTint, biomeMix);
        outgoingLight += diffuseColor.rgb * fluorescentTint
          * fluorescentLift * (1.0 - blackout);

        float viewDistance = distance(vZonalWorldPosition, cameraPosition);
        float darkDistance = smoothstep(darkNear, darkFar, viewDistance) * blackout;
        outgoingLight = mix(outgoingLight, darkColor, darkDistance * 0.94);
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () =>
    `zonal-fluorescent-lighting-v4-${supportsSurfaceNormal ? 'lit' : 'basic'}`;
  material.needsUpdate = true;
};

const withZonalLighting = <T extends THREE.MeshStandardMaterial>(
  source: T,
  context: ZonalLightingContext,
  profile: SurfaceLightingProfile,
): T => {
  const material = source.clone() as T;
  material.name = `${source.name}-zonal`;
  applyZonalLighting(material, context, profile);
  return material;
};

export const createZonalMaterialSet = (
  source: MaterialSet,
  plan: WorldPlan,
): ZonalMaterialSet => {
  const context = createZonalLightingContext(plan);
  const wall = withZonalLighting(source.wall, context, {
    litGain: 1.12,
    darkFloor: 0.085,
    fluorescentLift: 0.012,
    surfaceOffset: 0.24,
    proximityOcclusion: 0,
    verticalRelief: 0.065,
  });
  const plaster = withZonalLighting(source.plaster, context, {
    litGain: 1.1,
    darkFloor: 0.08,
    fluorescentLift: 0.01,
    surfaceOffset: 0.24,
    proximityOcclusion: 0,
    verticalRelief: 0.06,
  });
  const floor = withZonalLighting(source.floor, context, {
    litGain: 0.92,
    darkFloor: 0.065,
    fluorescentLift: 0.006,
    surfaceOffset: 0,
    proximityOcclusion: 0.12,
    verticalRelief: 0,
  });
  const ceiling = withZonalLighting(source.ceiling, context, {
    litGain: 1.12,
    darkFloor: 0.075,
    fluorescentLift: 0.02,
    surfaceOffset: 0,
    proximityOcclusion: 0.055,
    verticalRelief: 0,
  });
  const baseboard = withZonalLighting(source.baseboard, context, {
    litGain: 0.9,
    darkFloor: 0.055,
    fluorescentLift: 0.005,
    surfaceOffset: 0.16,
    proximityOcclusion: 0.04,
    verticalRelief: 0.02,
  });
  const pitWall = withZonalLighting(source.pitWall, context, {
    litGain: 0.54,
    darkFloor: 0.035,
    fluorescentLift: 0.004,
    surfaceOffset: 0.2,
    proximityOcclusion: 0,
    verticalRelief: 0.045,
  });
  const pitBottom = withZonalLighting(source.pitBottom, context, {
    litGain: 0.18,
    darkFloor: 0.018,
    fluorescentLift: 0,
    surfaceOffset: 0,
    proximityOcclusion: 0.04,
    verticalRelief: 0,
  });
  const metal = withZonalLighting(source.metal, context, {
    litGain: 0.72,
    darkFloor: 0.04,
    fluorescentLift: 0.006,
    surfaceOffset: 0.12,
    proximityOcclusion: 0.035,
    verticalRelief: 0,
  });
  const fixtureFrame = withZonalLighting(source.fixtureFrame, context, {
    litGain: 1.04,
    darkFloor: 0.07,
    fluorescentLift: 0.008,
    surfaceOffset: 0.08,
    proximityOcclusion: 0,
    verticalRelief: 0.02,
  });
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
    context,
  };
};
