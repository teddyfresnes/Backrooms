import * as THREE from 'three';
import type { WorldPlan } from '../world/types';
import { slabVertices } from '../world/WalkableTopology';
import { createFaceExposure } from './FaceExposure';
import { createWalkableBatch } from './WalkableGeometry';
import { createSpatialPrismBatch } from './SpatialGeometry';

export interface ArchitectureBatch {
  name: string; material: 'floor' | 'wall' | 'plaster' | 'ceiling' | 'baseboard';
  position: Float32Array; normal: Float32Array; uv: Float32Array; color: Float32Array;
  min: number[]; max: number[]; sphere: number[];
}
export type SpatialArchitectureBuffers = ArchitectureBatch[];

/** CPU-only worker preparation. WorldPlan stays serializable and unchanged;
 * the transferable render buffers are a separate, bounded streaming cache. */
export const prepareSpatialArchitecture = (plan: WorldPlan): SpatialArchitectureBuffers => {
  if (!plan.spatial || !plan.topology) return [];
  const spatial = plan.spatial, floors = plan.topology.surfaces, ceilings = spatial.ceilings;
  const origin = { x: spatial.owner.x * 112, y: spatial.owner.story * 5.4, z: spatial.owner.z * 112 };
  const style = plan.surfaceStyle, wallScale = style?.wallPatternScale ?? 1, ceilingScale = style?.ceilingPatternScale ?? 1;
  const exposure = createFaceExposure([
    ...floors.map(source => ({ source, vertices: slabVertices(source) })),
    ...ceilings.map(source => ({ source, vertices: slabVertices(source) })),
    ...spatial.prisms.map(source => ({ source, vertices: source.vertices })),
  ]);
  const batches: SpatialArchitectureBuffers = [];
  const add = (name: string, material: ArchitectureBatch['material'], geometry: THREE.BufferGeometry) => {
    if (geometry.getAttribute('position').count) {
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      batches.push({ name, material, position: geometry.getAttribute('position').array as Float32Array,
        normal: geometry.getAttribute('normal').array as Float32Array, uv: geometry.getAttribute('uv').array as Float32Array,
        color: geometry.getAttribute('color').array as Float32Array, min: geometry.boundingBox!.min.toArray(), max: geometry.boundingBox!.max.toArray(),
        sphere: [...geometry.boundingSphere!.center.toArray(), geometry.boundingSphere!.radius] });
    }
    geometry.dispose();
  };
  add('regional-carpet-floors', 'floor', createWalkableBatch(floors, 'top', style?.floorPatternScale ?? 1, style?.floorQuarterTurn ?? false, origin, true, exposure));
  add('regional-floor-undersides', 'ceiling', createWalkableBatch(floors, 'underside', ceilingScale, false, origin, true, exposure));
  add('regional-floor-chants', 'wall', createWalkableBatch(floors, 'sides', wallScale, false, origin, true, exposure));
  for (const face of ['top', 'underside', 'sides'] as const)
    add(`regional-ceilings-${face}`, 'ceiling', createWalkableBatch(ceilings, face, ceilingScale, false, origin, true, exposure));
  for (const material of ['wall', 'plaster', 'ceiling', 'baseboard'] as const) {
    const prisms = spatial.prisms.filter(p => p.material === material);
    if (prisms.length) add(`regional-${material}-structures`, material, createSpatialPrismBatch(prisms, material === 'ceiling' ? ceilingScale : wallScale, origin, exposure));
  }
  return batches;
};

/** No copy, clipping, normals or first-frame bounds computation on mount. GPU
 * resources belong exclusively to this new geometry and its WorldView. */
export const mountArchitectureBatch = (batch: ArchitectureBatch): THREE.BufferGeometry => {
  const geometry = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'color'] as const)
    geometry.setAttribute(name, new THREE.BufferAttribute(batch[name], name === 'uv' ? 2 : 3));
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3().fromArray(batch.min), new THREE.Vector3().fromArray(batch.max));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3().fromArray(batch.sphere), batch.sphere[3]);
  return geometry;
};

export const architectureTransferables = (batches: SpatialArchitectureBuffers): ArrayBuffer[] =>
  batches.flatMap(b => [b.position.buffer, b.normal.buffer, b.uv.buffer, b.color.buffer] as ArrayBuffer[]);
