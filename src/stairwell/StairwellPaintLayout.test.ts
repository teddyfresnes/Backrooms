import { describe, expect, it } from 'vitest';
import { containsPaint, stairwellPaintPatches } from './StairwellPaintLayout';
import { floorY, midLandingY } from './layout';
import type { StairwellWall } from './StairwellSurfaceFinish';

const patches = stairwellPaintPatches();
const painted = (wall: StairwellWall, along: number, height: number) =>
  patches.some(patch => patch.wall === wall && containsPaint(patch, along, height));

describe('approved stairwell paint footprint', () => {
  it('leaves the wall above the last return landing unpainted', () => {
    for (let height = 9.7; height < 11.5; height += .13) {
      for (let along = -1.8; along < 1.8; along += .13) expect(painted('north', along, height)).toBe(false);
      expect(painted('west', 0, height)).toBe(false);
      expect(painted('east', 2, height)).toBe(false);
    }
  });

  it('wraps the ground entry and both flight junctions without inventing underground repeats', () => {
    for (const side of ['west', 'east'] as const) for (const z of [-5.8, -3.5, -1.25, -1.05])
      expect(painted(side, z, .45), `${side}/${z}`).toBe(true);
    expect(painted('south', -1.5, .45)).toBe(true);
    expect(painted('south', 1.5, .45)).toBe(true);
    expect(painted('south', 0, .45)).toBe(false);
    expect(painted('east', .9, .45)).toBe(false);
  });

  it('keeps the real door and window cutouts and only the three actual return landings', () => {
    for (let level = 0; level < 4; level++) {
      expect(painted('west', -2.712, floorY(level) + .5)).toBe(false);
      expect(painted('east', -2.712, floorY(level) + .5)).toBe(false);
      if (level > 0) {
        expect(painted('south', 0, floorY(level) + .5)).toBe(true);
        expect(painted('south', 0, floorY(level) + .9)).toBe(false);
      }
      if (level < 3) expect(painted('north', 0, midLandingY(level) + .5)).toBe(true);
    }
    expect(painted('north', 0, midLandingY(3) + .5)).toBe(false);
  });
});
