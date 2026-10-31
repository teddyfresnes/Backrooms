import { regionalOwnerAt } from '../world/RegionalPlan';
import type { SpatialAddress } from '../world/SpatialTypes';
import type { Vec3Data } from '../world/types';

/** A bounded ballistic look-ahead from the physical pelvis. These are real
 * owner addresses to prepare/mount, never temporary landing colliders. */
export const predictFallOwners = (seed: string, position: Vec3Data, velocity?: Vec3Data): SpatialAddress[] => {
  if (!velocity || velocity.y > -2 || ![position.x, position.y, position.z, velocity.x, velocity.y, velocity.z].every(Number.isFinite)) return [];
  const current = regionalOwnerAt(seed, position.x, position.y, position.z), result: SpatialAddress[] = [], seen = new Set([`${current.x}:${current.z}:${current.story}`]);
  for (const t of [.12, .24, .36, .48, .6]) {
    const coord = regionalOwnerAt(seed, position.x + velocity.x * t, position.y + velocity.y * t - 5.7 * t * t, position.z + velocity.z * t);
    const key = `${coord.x}:${coord.z}:${coord.story}`;
    if (!seen.has(key)) { seen.add(key); result.push(coord); }
    if (result.length === 3) break;
  }
  return result;
};
