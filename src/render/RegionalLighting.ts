import * as THREE from 'three';
import type { WorldPlan } from '../world/types';
import { surfaceY } from '../world/WalkableTopology';

const RESOLUTION = 64, LAYERS = 3;
export interface RegionalLightField { texture: THREE.DataTexture; size: number; offset: THREE.Vector3 }
/** A small height-tagged atlas preserves stacked circulation volumes. Unlike a
 * projected light map, a lamp above a solid slab cannot illuminate its lower layer.
 * It is an exposure approximation, not a GPU shadow or path-tracing solution.
 */
export const createRegionalLightField = (plan: WorldPlan): RegionalLightField => {
  const data = new Float32Array(RESOLUTION * RESOLUTION * LAYERS * 4), half = plan.size / 2;
  for (let i = 0; i < data.length; i += 4) { data[i] = 1e6; data[i + 1] = -1e6; }
  const lights = plan.lights.filter(l => !l.dead);
  const slots: { floor: number; ceiling: number }[][] = Array.from({ length: RESOLUTION * RESOLUTION }, () => []);
  for (const s of plan.topology?.surfaces ?? []) {
    const b = s.bounds, minX = Math.max(0, Math.floor((b.minX + half) / plan.size * RESOLUTION)), maxX = Math.min(RESOLUTION - 1, Math.floor((b.maxX + half) / plan.size * RESOLUTION));
    const minZ = Math.max(0, Math.floor((b.minZ + half) / plan.size * RESOLUTION)), maxZ = Math.min(RESOLUTION - 1, Math.floor((b.maxZ + half) / plan.size * RESOLUTION));
    for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
      const px = (x + .5) / RESOLUTION * plan.size - half, pz = (z + .5) / RESOLUTION * plan.size - half;
      if (px < b.minX || px > b.maxX || pz < b.minZ || pz > b.maxZ) continue;
      const floor = surfaceY(s, px, pz), ceiling = s.ceilingProfile ? surfaceY({ ...s, profile: s.ceilingProfile }, px, pz) : s.ceilingY;
      const pixel = slots[z * RESOLUTION + x]!, existing = pixel.find(p => Math.abs(p.floor - floor) < .03);
      if (existing) existing.ceiling = Math.min(existing.ceiling, ceiling); else pixel.push({ floor, ceiling });
    }
  }
  for (let z = 0; z < RESOLUTION; z++) for (let x = 0; x < RESOLUTION; x++) {
    const px = (x + .5) / RESOLUTION * plan.size - half, pz = (z + .5) / RESOLUTION * plan.size - half;
    const values = slots[z * RESOLUTION + x]!.sort((a, b) => a.floor - b.floor).slice(0, LAYERS);
    values.forEach((v, layer) => {
      let exposure = .18, emitter = -1e4;
      for (const l of lights) {
        const emitterY = l.ceilingY - .15;
        if (emitterY > v.ceiling + .12 || emitterY < v.floor + .3) continue;
        const distance = Math.hypot(px - l.x, pz - l.z, (v.floor + 1 - emitterY) * .8), falloff = Math.max(0, 1 - distance / 13);
        const energy = .18 + Math.min(1, l.intensity) * falloff * falloff;
        if (energy > exposure) { exposure = energy; emitter = emitterY; }
      }
      if (plan.unlitZones?.some(b => px >= b.minX && px <= b.maxX && pz >= b.minZ && pz <= b.maxZ)) exposure = .12;
      const i = ((layer * RESOLUTION + z) * RESOLUTION + x) * 4;
      data[i] = v.floor; data[i + 1] = v.ceiling; data[i + 2] = exposure; data[i + 3] = emitter;
    });
  }
  const texture = new THREE.DataTexture(data, RESOLUTION, RESOLUTION * LAYERS, THREE.RGBAFormat, THREE.FloatType);
  texture.name = 'regional-layer-exposure'; texture.minFilter = texture.magFilter = THREE.NearestFilter; texture.generateMipmaps = false; texture.needsUpdate = true;
  return { texture, size: plan.size, offset: new THREE.Vector3() };
};

export const applyRegionalLighting = (material: THREE.Material, field: RegionalLightField): void => {
  const before = material.onBeforeCompile, key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.uniforms.regionalLightField = { value: field.texture }; shader.uniforms.regionalWorldSize = { value: field.size }; shader.uniforms.regionalChunkOffset = { value: field.offset };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRegionalPosition;\nuniform vec3 regionalChunkOffset;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 regionalVertex = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          regionalVertex = instanceMatrix * regionalVertex;
        #endif
        vRegionalPosition = (modelMatrix * regionalVertex).xyz - regionalChunkOffset;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vRegionalPosition;
      uniform sampler2D regionalLightField;
      uniform float regionalWorldSize;`)
      .replace('#include <opaque_fragment>', `
        vec2 regionalUv = clamp(vRegionalPosition.xz / regionalWorldSize + 0.5, 0.001, 0.999);
        float regionalExposure = 0.18;
        float regionalBest = 1000000.0;
        for (int layer = 0; layer < 3; layer++) {
          vec4 volume = texture2D(regionalLightField, vec2(regionalUv.x, (regionalUv.y + float(layer)) / 3.0));
          float volumeDistance = abs(vRegionalPosition.y - clamp(vRegionalPosition.y, volume.x, volume.y));
          if (volume.x <= volume.y && volumeDistance < regionalBest) {
            regionalBest = volumeDistance;
            float verticalEnergy = pow(clamp(1.0 - abs(vRegionalPosition.y - volume.w) / 13.0, 0.0, 1.0), 2.0);
            regionalExposure = volume.z < 0.18 ? volume.z : 0.18 + (volume.z - 0.18) * verticalEnergy;
          }
        }
        outgoingLight *= mix(0.35, 1.14, clamp(regionalExposure, 0.0, 1.0));
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => `${key()}|regional-exposure-v2`; material.needsUpdate = true;
};
