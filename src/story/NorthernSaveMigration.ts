import { NORTHERN_LAYOUT } from '../world/NorthernLayout';
import type { RiftProgress } from './RiftProgress';

/** Old plank checkpoints followed the rift row at -4. Move the address with
 * that rift once; the northern checkpoint is the new layout's save marker. */
export const migrateNorthernSaveCoord = <T extends { x: number; z: number; story: number }>(
  chunk: T, localZ: number, rift: RiftProgress | undefined, hasNorthern: boolean,
): T => {
  if (hasNorthern || !rift || rift.stage === 'arrival' || rift.stage === 'done') return chunk;
  const globalZ = chunk.z * NORTHERN_LAYOUT.chunkSize + localZ;
  if (globalZ > (NORTHERN_LAYOUT.riftRow + .5) * NORTHERN_LAYOUT.chunkSize) return chunk;
  return { ...chunk, z: chunk.z + 1 };
};
