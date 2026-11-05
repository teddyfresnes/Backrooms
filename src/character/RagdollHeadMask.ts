import * as THREE from 'three';

/** Prepared at avatar load. Live and third-person shaders ignore this render
 * attribute; bone poses and shared geometry positions remain unchanged. */
export const prepareRagdollHeadMask = (character: THREE.Object3D): void => character.traverse(object => {
  const mesh = object as THREE.SkinnedMesh;
  if (!mesh.isSkinnedMesh || mesh.geometry.hasAttribute('ragdollHeadMask')) return;
  const indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
  if (!indices || !weights) return;
  const headBones = new Set<number>();
  mesh.skeleton.bones.forEach((bone, index) => {
    for (let parent: THREE.Object3D | null = bone; parent; parent = parent.parent) {
      if (parent.name.toLowerCase().replace(/[^a-z0-9]/g, '').endsWith('head')) { headBones.add(index); break; }
    }
  });
  const mask = new Float32Array(indices.count);
  for (let v = 0; v < indices.count; v++) for (let i = 0; i < 4; i++)
    if (headBones.has(indices.getComponent(v, i))) mask[v]! += weights.getComponent(v, i);
  mesh.geometry.setAttribute('ragdollHeadMask', new THREE.BufferAttribute(mask, 1));
});

/** Only the active player's head is masked in first person. */
export const installRagdollHeadMask = (material: THREE.Material, enabled: { value: number }): void => {
  material.onBeforeCompile = shader => {
    shader.uniforms.ragdollHideHead = enabled;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float ragdollHeadMask; varying float vRagdollHeadMask;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRagdollHeadMask = ragdollHeadMask;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float ragdollHideHead; varying float vRagdollHeadMask;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (ragdollHideHead > 0.5 && vRagdollHeadMask > 0.18) discard;');
  };
  material.customProgramCacheKey = () => 'ragdoll-head-mask-v1';
};
