import type { PassageHole, Rect } from './types';

export const PASSAGE_HOLE_STORY_PITCH = 5.4;
export const PASSAGE_HOLE_LOWER_FLOOR_Y = -PASSAGE_HOLE_STORY_PITCH;
export const PASSAGE_HOLE_LOWER_CEILING_Y = -2.66;

export const getPassageHolePreviewBounds = (
  hole: PassageHole,
  worldSize: number,
): Rect => {
  const halfWorld = worldSize * 0.5;
  const padding = 3.2;
  return {
    minX: Math.max(-halfWorld, hole.minX - padding),
    maxX: Math.min(halfWorld, hole.maxX + padding),
    minZ: Math.max(-halfWorld, hole.minZ - padding),
    maxZ: Math.min(halfWorld, hole.maxZ + padding),
  };
};

export const getPassageHoleAbyssBottom = (hole: PassageHole): number =>
  -Math.max(54, hole.depth + PASSAGE_HOLE_STORY_PITCH * 2);
