import type * as THREE from 'three';

const applied = new WeakSet<THREE.MeshStandardMaterial>();
type RoughnessRange = readonly [number, number];

/** Remap the effective roughness AFTER the texture's green channel. Merely
 * raising material.roughness still multiplies it by a potentially glossy map.
 * Keep all source pixels and texture variation; only dry surfaces opt in. */
export const applyMatteSurface = (material: THREE.MeshStandardMaterial, range?: RoughnessRange): void => {
  if (range) material.userData.matteRoughness = [...range];
  const bounds = material.userData.matteRoughness as RoughnessRange | undefined;
  if (!bounds || applied.has(material)) return;
  const previous = material.onBeforeCompile.bind(material), key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>\nroughnessFactor = mix(${bounds[0].toFixed(4)}, ${bounds[1].toFixed(4)}, clamp(roughnessFactor, 0.0, 1.0));`);
  };
  material.customProgramCacheKey = () => `${key()}|dry-surface-${bounds.join('-')}`;
  applied.add(material);
  material.needsUpdate = true;
};
