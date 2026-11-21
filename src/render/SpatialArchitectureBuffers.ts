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
    ...spatial.prisms.map(source => ({ source, vertices: source.vertices, openFaces: source.openFaces })),
  ]);
  // One batch, hence one draw call, per material: every part shares the same
  // world-space UVs, so merging changes no pixel.
  const parts = new Map<ArchitectureBatch['material'], THREE.BufferGeometry[]>();
  const add = (material: ArchitectureBatch['material'], geometry: THREE.BufferGeometry) => {
    if (geometry.getAttribute('position').count) parts.set(material, [...parts.get(material) ?? [], geometry]); else geometry.dispose();
  };
  add('floor', createWalkableBatch(floors, 'top', style?.floorPatternScale ?? 1, style?.floorQuarterTurn ?? false, origin, true, exposure));
  add('ceiling', createWalkableBatch(floors, 'underside', ceilingScale, false, origin, true, exposure));
  add('wall', createWalkableBatch(floors, 'sides', wallScale, false, origin, true, exposure));
  for (const face of ['top', 'underside'] as const) add('ceiling', createWalkableBatch(ceilings, face, ceilingScale, false, origin, true, exposure));
  // Vertical steps between ceilings continue the wallpaper of the walls below
  // them: white plaster bands read as stray partitions.
  add('wall', createWalkableBatch(ceilings, 'sides', wallScale, false, origin, true, exposure));
  for (const material of ['wall', 'plaster', 'ceiling', 'baseboard'] as const) {
    const prisms = spatial.prisms.filter(p => p.material === material);
    if (!prisms.length) continue;
    add(material, createSpatialPrismBatch(prisms, material === 'ceiling' ? ceilingScale : wallScale, origin, exposure,
      material === 'ceiling' ? 'horizontal' : 'all'));
    if (material === 'ceiling') add('wall', createSpatialPrismBatch(prisms, wallScale, origin, exposure, 'sides'));
  }
  const batches: SpatialArchitectureBuffers = [];
  for (const [material, geometries] of parts) {
    const merged = concatenate(geometries);
    merged.computeBoundingBox(); merged.computeBoundingSphere();
    batches.push({ name: ARCHITECTURE_BATCH_NAMES[material], material, position: merged.getAttribute('position').array as Float32Array,
      normal: merged.getAttribute('normal').array as Float32Array, uv: merged.getAttribute('uv').array as Float32Array,
      color: merged.getAttribute('color').array as Float32Array, min: merged.boundingBox!.min.toArray(), max: merged.boundingBox!.max.toArray(),
      sphere: [...merged.boundingSphere!.center.toArray(), merged.boundingSphere!.radius] });
    merged.dispose();
  }
  return batches;
};

export const ARCHITECTURE_BATCH_NAMES: Record<ArchitectureBatch['material'], string> = {
  floor: 'regional-carpet-floors', wall: 'regional-walls', plaster: 'regional-plaster-structures',
  ceiling: 'regional-ceilings', baseboard: 'regional-baseboards',
};

/** Non-indexed triangle soups with identical attribute layouts. */
const concatenate = (geometries: THREE.BufferGeometry[]): THREE.BufferGeometry => {
  if (geometries.length === 1) return geometries[0]!;
  const merged = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2], ['color', 3]] as const) {
    const arrays = geometries.map(g => g.getAttribute(name).array as Float32Array), out = new Float32Array(arrays.reduce((n, a) => n + a.length, 0));
    let offset = 0; for (const a of arrays) { out.set(a, offset); offset += a.length; }
    merged.setAttribute(name, new THREE.BufferAttribute(out, size));
  }
  geometries.forEach(g => g.dispose());
  return merged;
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
