import * as THREE from 'three';
import { expressionTargets } from '../wardrobe/studio/core/expressions';
import type { CharacterConfig } from '../wardrobe/studio/core/types';
import { loadMakeHumanBase, loadSparseTarget } from '../wardrobe/studio/makehuman/TargetLoader';

/** Only the cinematic clone owns these positions. The saved face, live body,
 * skinning, clothes and shared source geometry remain reusable. */
export async function prepareSadArrivalExpression(avatar: THREE.Group, signal?: AbortSignal): Promise<() => void> {
  const config = avatar.userData.wardrobeProfile as CharacterConfig | undefined;
  const body = avatar.getObjectByName('MakeHuman_HM08_Body') as THREE.SkinnedMesh | undefined;
  if (!config || !body) return () => {};
  const [base, targets] = await Promise.all([
    loadMakeHumanBase(),
    Promise.all(expressionTargets('sad', config.body).map(async entry => ({ ...entry, target: await loadSparseTarget(entry.path) }))),
  ]);
  signal?.throwIfAborted();
  const delta = new Float32Array(base.fullPositions.length);
  for (const { weight, target } of targets) for (let i = 0; i < target.indices.length; i++) {
    const index = target.indices[i]! * 3;
    for (let axis = 0; axis < 3; axis++) delta[index + axis]! += target.delta[i * 3 + axis]! * weight;
  }
  const original = body.geometry, geometry = original.clone();
  const position = geometry.getAttribute('position');
  for (let vertex = 0; vertex < position.count; vertex++) {
    const source = base.renderSource[vertex]! * 3;
    position.setXYZ(vertex, position.getX(vertex) + delta[source]!, position.getY(vertex) + delta[source + 1]!, position.getZ(vertex) + delta[source + 2]!);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals(); geometry.computeBoundingSphere(); geometry.computeBoundingBox();
  body.geometry = geometry;
  return () => { body.geometry = original; geometry.dispose(); };
}
