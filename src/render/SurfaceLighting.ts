import * as THREE from 'three';
import type { WorldPlan } from '../world/types';
import { surfaceRange } from '../world/WalkableTopology';

/** Shared overhang occlusion for modern and classic cloned chunk materials. */
export const applySurfaceLighting = (material: THREE.Material, plan: WorldPlan): void => {
  const slabs = plan.topology?.surfaces.filter(s => s.role === 'balcony' || s.role === 'bridge') ?? []; if (!slabs.length) return;
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey.bind(material);
  const bounds = slabs.map(s => new THREE.Vector4(s.bounds.minX, s.bounds.minZ, s.bounds.maxX, s.bounds.maxZ)), heights = slabs.map(s => surfaceRange(s)[0] - s.thickness);
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer); shader.uniforms.walkableOverhangs = { value: bounds }; shader.uniforms.walkableUndersides = { value: heights };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWalkablePosition;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vWalkablePosition = transformed;
        #ifdef USE_INSTANCING
          vWalkablePosition = (instanceMatrix * vec4(transformed, 1.0)).xyz;
        #endif`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWalkablePosition;
      uniform vec4 walkableOverhangs[${slabs.length}];
      uniform float walkableUndersides[${slabs.length}];`)
      .replace('#include <opaque_fragment>', `
        float exposureBelowSlab = 1.0;
        for (int i = 0; i < ${slabs.length}; i++) {
          vec4 b = walkableOverhangs[i];
          float inside = step(b.x, vWalkablePosition.x) * step(vWalkablePosition.x, b.z) * step(b.y, vWalkablePosition.z) * step(vWalkablePosition.z, b.w);
          exposureBelowSlab *= mix(1.0, 0.43, inside * step(vWalkablePosition.y, walkableUndersides[i] + 0.02));
        }
        outgoingLight *= exposureBelowSlab;
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => `${key()}|walkable-overhangs-${slabs.length}`; material.needsUpdate = true;
};
