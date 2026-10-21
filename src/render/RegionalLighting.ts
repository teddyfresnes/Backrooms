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
    });
  });
  return { bounds, lighting, layers, size: plan.size };
};

/** GPU ownership starts here, after the worker has transferred plain buffers. */
export const createRegionalLightField = (plan: WorldPlan, supplied?: RegionalLightData): RegionalLightField => {
  const { bounds, lighting, layers, size } = supplied ?? bakeRegionalLightData(plan);
  const texture = new THREE.DataTexture(bounds, RESOLUTION, RESOLUTION * layers, THREE.RGBAFormat, THREE.FloatType);
  texture.name = 'regional-volume-bounds'; texture.minFilter = texture.magFilter = THREE.NearestFilter;
  const lightTexture = new THREE.DataTexture(lighting, RESOLUTION, RESOLUTION * layers, THREE.RGBAFormat);
  lightTexture.name = 'regional-fluorescent-field'; lightTexture.minFilter = lightTexture.magFilter = THREE.LinearFilter;
  for (const t of [texture, lightTexture]) { t.generateMipmaps = false; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; }
  return { texture, lighting: lightTexture, layers, size, offset: new THREE.Vector3() };
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
      uniform sampler2D regionalFluorescent;`)
      .replace('vec2 localField = texture2D(lightField, lightFieldUv).rg;', `
        vec4 localVolume = vec4(0.0, 3.05, 0.0, 0.0);
        vec3 localLighting = vec3(0.22, 0.0, 0.0);
        float bestVolumeDistance = 1000000.0;
        for (int layer = 0; layer < ${field.layers}; layer++) {
          vec2 volumeUv = vec2(lightFieldUv.x, (clamp(lightFieldUv.y, 0.5/96.0, 95.5/96.0) + float(layer)) / ${field.layers}.0);
          vec4 volume = texture2D(regionalBounds, volumeUv);
          float volumeDistance = abs(zonalChunkPosition.y - clamp(zonalChunkPosition.y, volume.x, volume.y));
          if (volume.x <= volume.y && volumeDistance < bestVolumeDistance) {
            localVolume = volume; bestVolumeDistance = volumeDistance;
            localLighting = texture2D(regionalFluorescent, volumeUv).rgb;
          }
        }
        vec2 localField = localLighting.rg;
        blackout = localLighting.b;`)
      .replace('float wallHeight = max(0.1, zoneMaxY - 0.55);', 'float wallHeight = max(0.1, localVolume.y - localVolume.x);')
      .replace('clamp(zonalChunkPosition.y / wallHeight, 0.0, 1.0)', 'clamp((zonalChunkPosition.y - localVolume.x) / wallHeight, 0.0, 1.0)');
  };
  material.customProgramCacheKey = () => `${key()}|regional-zonal-volumes-${field.layers}`;
  material.needsUpdate = true;
};
