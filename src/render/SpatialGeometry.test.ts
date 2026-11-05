import { expect, it } from 'vitest';
import { generateWorld } from '../world/generateWorld';
import { createWalkableBatch, createWalkableGeometry } from './WalkableGeometry';
import { createSpatialPrismBatch, createSpatialPrismGeometry } from './SpatialGeometry';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

it('preserves every vertex, UV, tint and normal when batching a full regional architecture directly', () => {
  const plan = generateWorld('BSP-GEOMETRY-BATCH-EQUIVALENCE');
  for (const face of ['top', 'underside', 'sides'] as const) {
    const pieces = plan.topology!.surfaces.map(s => createWalkableGeometry(s, face, .87, true));
    const old = mergeGeometries(pieces), batch = createWalkableBatch(plan.topology!.surfaces, face, .87, true);
    for (const name of ['position', 'normal', 'uv', 'color']) expect(batch.getAttribute(name).array).toEqual(old.getAttribute(name).array);
    old.dispose(); batch.dispose(); pieces.forEach(g => g.dispose());
  }
  const pieces = plan.spatial!.prisms.map(p => createSpatialPrismGeometry(p, 1.23));
  const old = mergeGeometries(pieces), batch = createSpatialPrismBatch(plan.spatial!.prisms, 1.23);
  for (const name of ['position', 'normal', 'uv', 'color']) expect(batch.getAttribute(name).array).toEqual(old.getAttribute(name).array);
  old.dispose(); batch.dispose(); pieces.forEach(g => g.dispose());
});
