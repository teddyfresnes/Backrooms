import * as THREE from 'three';
import type { WorldPlan } from '../world/types';
import { surfaceY } from '../world/WalkableTopology';
import { createFluorescentLightField, unlitZoneInfluence } from './ZonalLighting';

export interface RegionalLightData { bounds: Float32Array; lighting: Uint8Array; layers: number; size: number }

export interface RegionalLightField {
  texture: THREE.DataTexture;
  lighting: THREE.DataTexture;
  layers: number;
  size: number;
  offset: THREE.Vector3;
  data: RegionalLightData;
}
const RESOLUTION = 96;

/** Select the historical fluorescent field belonging to the actual volume.
 * This replaces the old extra exposure multiplier; it never grades the light
 * a second time. Layer count follows actual overlap instead of truncating at 3.
 */
export const bakeRegionalLightData = (plan: WorldPlan): RegionalLightData => {
  const half = plan.size / 2;
  type Volume = { floor: number; ceiling: number; key: string };
  const pixels: Volume[][] = Array.from({ length: RESOLUTION ** 2 }, () => []);
  const groups = new Map<string, Volume>();
  for (const s of plan.topology?.surfaces ?? []) {
    const minX = Math.max(0, Math.floor((s.bounds.minX + half) / plan.size * RESOLUTION));
    const maxX = Math.min(RESOLUTION - 1, Math.floor((s.bounds.maxX + half) / plan.size * RESOLUTION));
    const minZ = Math.max(0, Math.floor((s.bounds.minZ + half) / plan.size * RESOLUTION));
    const maxZ = Math.min(RESOLUTION - 1, Math.floor((s.bounds.maxZ + half) / plan.size * RESOLUTION));
    for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
      const px = (x + .5) / RESOLUTION * plan.size - half, pz = (z + .5) / RESOLUTION * plan.size - half;
      if (px < s.bounds.minX || px > s.bounds.maxX || pz < s.bounds.minZ || pz > s.bounds.maxZ) continue;
      const floor = surfaceY(s, px, pz);
      const ceiling = s.ceilingProfile ? surfaceY({ ...s, profile: s.ceilingProfile }, px, pz) : s.ceilingY;
      const values = pixels[z * RESOLUTION + x]!;
      if (values.some(v => Math.abs(v.floor - floor) < .03)) continue;
      const key = `${Math.round(floor * 20)}/${Math.round(ceiling * 20)}`;
      const v = { floor, ceiling, key }; values.push(v); groups.set(key, v);
    }
  }
  // Structural faces and props also need a volume at pixels occupied by a
  // thick wall. Fill only missing pixels: room bounds must never overwrite
  // a real stair/ramp profile or invent an extra floor across a void.
  for (let z = 0; z < RESOLUTION; z++) for (let x = 0; x < RESOLUTION; x++) {
    const values = pixels[z * RESOLUTION + x]!; if (values.length) continue;
    const px = (x + .5) / RESOLUTION * plan.size - half, pz = (z + .5) / RESOLUTION * plan.size - half;
    const room = plan.rooms.find(r => px >= r.bounds.minX && px <= r.bounds.maxX && pz >= r.bounds.minZ && pz <= r.bounds.maxZ);
    if (!room) continue;
    const floor = room.floorY ?? 0, ceiling = room.ceilingHeight;
    if (ceiling < floor + .3) continue;
    const key = `${Math.round(floor * 20)}/${Math.round(ceiling * 20)}`, v = { floor, ceiling, key };
    values.push(v); groups.set(key, v);
  }
  const layers = Math.max(1, ...pixels.map(p => p.length));
  const bounds = new Float32Array(RESOLUTION ** 2 * layers * 4);
  const lighting = new Uint8Array(bounds.length);
  for (let i = 0; i < bounds.length; i += 4) { bounds[i] = 1e6; bounds[i + 1] = -1e6; }
  const fields = new Map<string, { data: Uint8Array; zones: NonNullable<WorldPlan['unlitZones']> }>();
  const sharedFields = new Map<string, Uint8Array>();
  for (const v of groups.values()) {
    const selected: WorldPlan = { ...plan, spatial: undefined,
      lights: plan.lights.filter(l => l.ceilingY > v.floor + .25 && l.ceilingY <= v.ceiling + .15),
      walls: plan.walls.filter(w => w.bottom <= v.floor + .12 && w.bottom + w.height > v.floor + .2)
        .map(w => ({ ...w, bottom: w.bottom - v.floor })),
      columns: plan.columns.filter(c => (c.bottom ?? 0) <= v.floor + .12 && (c.bottom ?? 0) + c.height > v.floor + .2)
        .map(c => ({ ...c, bottom: (c.bottom ?? 0) - v.floor })) };
    // Adjacent treads often have different heights but exactly the same
    // contributing sources and structures. Reuse the historical field; its
    // exposure/proximity is independent of that vertical translation.
    const signature = `${selected.lights.map(l => l.id).join(',')}|${selected.walls.map(w => w.id).join(',')}|${selected.columns.map(c => `${c.x}/${c.z}`).join(',')}`;
    let data = sharedFields.get(signature);
    if (!data) { const field = createFluorescentLightField(selected); data = field.image.data as Uint8Array; sharedFields.set(signature, data); field.dispose(); }
    const zones = (plan.unlitZones ?? []).filter(b => {
      const rooms = plan.rooms.filter(r => r.bounds.minX < b.maxX && r.bounds.maxX > b.minX && r.bounds.minZ < b.maxZ && r.bounds.maxZ > b.minZ);
      return !rooms.length || rooms.some(r => Math.abs((r.floorY ?? 0) - v.floor) < .2);
    });
    fields.set(v.key, { data, zones });
  }
  pixels.forEach((values, pixel) => {
    const x = pixel % RESOLUTION, z = Math.floor(pixel / RESOLUTION);
    values.sort((a, b) => a.floor - b.floor).forEach((v, layer) => {
      const i = (layer * RESOLUTION ** 2 + pixel) * 4, field = fields.get(v.key)!;
      bounds[i] = v.floor; bounds[i + 1] = v.ceiling;
      lighting[i] = field.data[pixel * 2]!; lighting[i + 1] = field.data[pixel * 2 + 1]!;
      lighting[i + 2] = Math.round(255 * unlitZoneInfluence(field.zones, (x + .5) / RESOLUTION * plan.size - half, (z + .5) / RESOLUTION * plan.size - half));
      lighting[i + 3] = 255;
    });
  });
  return { bounds, lighting, layers, size: plan.size };
};

const copyBounds = (target: Float32Array | Uint16Array, at: number, source: Float32Array, index: number, offset = 0) => {
  if (target instanceof Uint16Array) {
    const valid = source[index]! <= source[index + 1]!;
    target[at] = valid ? THREE.DataUtils.toHalfFloat(source[index]! + offset) : 0;
    target[at + 1] = valid ? THREE.DataUtils.toHalfFloat(source[index + 1]! + offset) : 0;
    target[at + 2] = 0; target[at + 3] = valid ? THREE.DataUtils.toHalfFloat(1) : 0;
  } else {
    target.set(source.subarray(index, index + 4), at);
    target[at] = target[at]! + offset; target[at + 1] = target[at + 1]! + offset;
  }
};

/** GPU ownership starts here, after the worker has transferred plain buffers. */
export const createRegionalLightField = (plan: WorldPlan, supplied?: RegionalLightData): RegionalLightField => {
  const { bounds, lighting, layers, size } = supplied ?? bakeRegionalLightData(plan);
  // WebGL2 linearly filters RGBA16F without OES_texture_float_linear.
  // One-layer regions can interpolate premultiplied heights/validity directly:
  // two texture fetches, with no per-fragment volume search.
  const paddedBounds = layers === 1 ? new Uint16Array(98 * 98 * 4) : new Float32Array(98 * 98 * layers * 4);
  const paddedLighting = new Uint8Array(paddedBounds.length);
  for (let layer = 0; layer < layers; layer++) for (let z = -1; z <= 96; z++) for (let x = -1; x <= 96; x++) {
    const source = (layer * 96 * 96 + Math.max(0, Math.min(95, z)) * 96 + Math.max(0, Math.min(95, x))) * 4;
    const target = (layer * 98 * 98 + (z + 1) * 98 + x + 1) * 4;
    copyBounds(paddedBounds, target, bounds, source); paddedLighting.set(lighting.subarray(source, source + 4), target);
  }
  const texture = new THREE.DataTexture(paddedBounds, 98, 98 * layers, THREE.RGBAFormat, layers === 1 ? THREE.HalfFloatType : THREE.FloatType);
  texture.name = 'regional-volume-bounds'; texture.minFilter = texture.magFilter = layers === 1 ? THREE.LinearFilter : THREE.NearestFilter;
  const lightTexture = new THREE.DataTexture(paddedLighting, 98, 98 * layers, THREE.RGBAFormat);
  lightTexture.name = 'regional-fluorescent-field'; lightTexture.minFilter = lightTexture.magFilter = layers === 1 ? THREE.LinearFilter : THREE.NearestFilter;
  for (const t of [texture, lightTexture]) { t.generateMipmaps = false; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; }
  return { texture, lighting: lightTexture, layers, size, offset: new THREE.Vector3(), data: { bounds, lighting, layers, size } };
};

/** A one-texel gutter permits the SAME four samples on both sides of a chunk
 * boundary. Neighbour slots are matched by real height, never by atlas row.
 * Missing/unmounted neighbours repeat the edge until their data is available. */
export const setRegionalLightNeighbor = (field: RegionalLightField, dx: number, dz: number, neighbor?: RegionalLightData, yOffset = 0): void => {
  if ((!dx && !dz) || Math.abs(dx) > 1 || Math.abs(dz) > 1) return;
  const bounds = field.texture.image.data as Float32Array | Uint16Array, lighting = field.lighting.image.data as Uint8Array;
  const xs = dx ? [dx < 0 ? -1 : 96] : Array.from({ length: 96 }, (_, i) => i);
  const zs = dz ? [dz < 0 ? -1 : 96] : Array.from({ length: 96 }, (_, i) => i);
  for (const z of zs) for (const x of xs) for (let layer = 0; layer < field.layers; layer++) {
    const own = (layer * 96 * 96 + Math.max(0, Math.min(95, z)) * 96 + Math.max(0, Math.min(95, x))) * 4;
    const target = (layer * 98 * 98 + (z + 1) * 98 + x + 1) * 4;
    let source = own, data = field.data, offset = 0;
    if (neighbor) {
      const nx = dx < 0 ? 95 : dx > 0 ? 0 : x, nz = dz < 0 ? 95 : dz > 0 ? 0 : z;
      let best = Infinity, selected = -1;
      for (let n = 0; n < neighbor.layers; n++) {
        const i = (n * 96 * 96 + nz * 96 + nx) * 4;
        if (neighbor.bounds[i]! > neighbor.bounds[i + 1]!) continue;
        const score = field.data.bounds[own]! <= field.data.bounds[own + 1]!
          ? Math.abs(neighbor.bounds[i]! + yOffset - field.data.bounds[own]!) : Math.abs(n - layer);
        if (score < best) { best = score; selected = i; }
      }
      if (selected >= 0) { data = neighbor; source = selected; offset = yOffset; }
    }
    copyBounds(bounds, target, data.bounds, source, offset);
    lighting.set(data.lighting.subarray(source, source + 4), target);
  }
  field.texture.needsUpdate = true; field.lighting.needsUpdate = true;
};

/** Extend only the zonal shader: retain its original pool/contact/tint tuning.
 * Classic materials retain their historical baked-light shader unchanged. */
export const applyRegionalLighting = (material: THREE.Material, field: RegionalLightField): void => {
  const before = material.onBeforeCompile, key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.uniforms.regionalBounds = { value: field.texture };
    shader.uniforms.regionalFluorescent = { value: field.lighting };
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D regionalBounds;
      uniform sampler2D regionalFluorescent;
      // Resolve the volume at EACH texel before interpolation. Atlas rows may
      // change layer when a balcony ends: hardware filtering would mix floors.
      vec4 regionalTap(vec2 pixel, float y, out vec2 height) {
        vec2 xy = clamp(pixel, vec2(-1.0), vec2(96.0));
        vec4 lighting = vec4(0.0);
        height = vec2(0.0);
        float best = 1.0e20;
        vec2 selectedUv = vec2(0.0);
        float valid = 0.0;
        for (int layer = 0; layer < ${field.layers}; layer++) {
          vec2 uv = vec2((xy.x + 1.5) / 98.0, (xy.y + 1.5 + float(layer) * 98.0) / (98.0 * ${field.layers}.0));
          vec4 volume = texture2D(regionalBounds, uv);
          float outside = abs(y - clamp(y, volume.x, volume.y));
          float score = outside * 10000.0 + abs(y - volume.x);
          if (volume.x <= volume.y && score < best) {
            best = score; height = volume.xy;
            selectedUv = uv; valid = 1.0;
          }
        }
        if (valid > 0.5) lighting = vec4(texture2D(regionalFluorescent, selectedUv).rgb, 1.0);
        return lighting;
      }`)
      .replace('vec2 localField = texture2D(lightField, lightFieldUv).rg;', field.layers === 1 ? `
        vec2 volumeUv = (lightFieldUv * 96.0 + 1.0) / 98.0;
        vec4 heightSample = texture2D(regionalBounds, volumeUv);
        vec4 lightSample = texture2D(regionalFluorescent, volumeUv);
        vec3 localLighting = lightSample.a > 0.00001 ? lightSample.rgb / lightSample.a : vec3(0.22, 0.0, 0.0);
        vec2 localHeight = heightSample.a > 0.00001 ? heightSample.xy / heightSample.a : vec2(0.0, 3.05);
        vec4 localVolume = vec4(localHeight, 0.0, 0.0);
        vec2 localField = localLighting.rg;
        blackout = localLighting.b;` : `
        vec2 pixel = lightFieldUv * 96.0 - 0.5;
        vec2 basePixel = floor(pixel), weight = fract(pixel);
        vec2 h00, h10, h01, h11;
        vec4 a = regionalTap(basePixel, zonalChunkPosition.y, h00);
        vec4 b = regionalTap(basePixel + vec2(1.0, 0.0), zonalChunkPosition.y, h10);
        vec4 c = regionalTap(basePixel + vec2(0.0, 1.0), zonalChunkPosition.y, h01);
        vec4 d = regionalTap(basePixel + vec2(1.0, 1.0), zonalChunkPosition.y, h11);
        vec4 weights = vec4((1.0-weight.x)*(1.0-weight.y), weight.x*(1.0-weight.y), (1.0-weight.x)*weight.y, weight.x*weight.y);
        // Empty texels at shafts and thick walls have no light contribution;
        // normalize the valid neighbours rather than interpolating black.
        float coverage = dot(weights, vec4(a.a, b.a, c.a, d.a));
        vec4 blended = a*weights.x + b*weights.y + c*weights.z + d*weights.w;
        vec3 localLighting = coverage > 0.00001 ? blended.rgb / coverage : vec3(0.22, 0.0, 0.0);
        vec2 localHeight = coverage > 0.00001 ? (h00*weights.x + h10*weights.y + h01*weights.z + h11*weights.w) / coverage : vec2(0.0, 3.05);
        vec4 localVolume = vec4(localHeight, 0.0, 0.0);
        vec2 localField = localLighting.rg;
        blackout = localLighting.b;`)
      .replaceAll('fract(dot(zonalChunkPosition.xz', 'fract(dot(vZonalWorldPosition.xz')
      .replace('float wallHeight = max(0.1, zoneMaxY - 0.55);', 'float wallHeight = max(0.1, localVolume.y - localVolume.x);')
      .replace('clamp(zonalChunkPosition.y / wallHeight, 0.0, 1.0)', 'clamp((zonalChunkPosition.y - localVolume.x) / wallHeight, 0.0, 1.0)');
  };
  material.customProgramCacheKey = () => `${key()}|regional-zonal-volumes-v2-${field.layers}`;
  material.needsUpdate = true;
};
