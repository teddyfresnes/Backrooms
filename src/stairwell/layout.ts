import type { Rect, Vec3Data } from '../world/types';

export const STAIRWELL_FLOOR_HEIGHT = 2.88;
export const STAIRWELL_HALF_LEVEL = STAIRWELL_FLOOR_HEIGHT * 0.5;
export const STAIRWELL_LEVEL_COUNT = 4;
export const STAIRWELL_FLIGHT_COUNT = STAIRWELL_LEVEL_COUNT - 1;
export const STAIRWELL_STEPS_PER_FLIGHT = 8;
export const STAIRWELL_STEP_RISE = STAIRWELL_HALF_LEVEL / STAIRWELL_STEPS_PER_FLIGHT;
export const STAIRWELL_STEP_DEPTH = 0.3;
export const STAIRWELL_WALL_THICKNESS = 0.22;
export const STAIRWELL_ROOF_Y = STAIRWELL_FLOOR_HEIGHT * STAIRWELL_LEVEL_COUNT;
export const STAIRWELL_LANDING_STRUCTURE_THICKNESS = 0.16;
export const STAIRWELL_FLOOR_FINISH_THICKNESS = 0.026;

// The south/window side is intentionally deeper than the original shell so
// the imported apartment remains fully enveloped behind the stairwell facade.
export const STAIRWELL_BOUNDS: Rect = {
  minX: -2.05,
  maxX: 2.05,
  minZ: -6.25,
  maxZ: 4,
};

export const STAIRWELL_MAIN_LANDING: Rect = {
  minX: -1.95,
  maxX: 1.95,
  minZ: -6.15,
  maxZ: -1.2,
};

export const STAIRWELL_MID_LANDING: Rect = {
  minX: -1.95,
  maxX: 1.95,
  minZ: 1.2,
  maxZ: 3.9,
};

export const STAIRWELL_LEFT_FLIGHT: Rect = {
  minX: -1.95,
  maxX: -0.15,
  minZ: -1.2,
  maxZ: 1.2,
};

export const STAIRWELL_RIGHT_FLIGHT: Rect = {
  minX: 0.15,
  maxX: 1.95,
  minZ: -1.2,
  maxZ: 1.2,
};

// Rez-de-chaussée, dans le hall d'entrée. Le regard initial est orienté vers +Z,
// donc directement vers la première volée.
export const STAIRWELL_SPAWN: Vec3Data = {
  x: -0.72,
  y: 0.865,
  z: -3.15,
};

export const STAIRWELL_ENTRANCE_WIDTH = 2.34;
export const STAIRWELL_ENTRANCE_HEIGHT = 2.72;
export const STAIRWELL_WINDOW_WIDTH = 2.46;
export const STAIRWELL_WINDOW_HEIGHT = 1.42;
export const STAIRWELL_WINDOW_SILL = 0.7;

export const floorY = (level: number): number => level * STAIRWELL_FLOOR_HEIGHT;
export const midLandingY = (level: number): number => floorY(level) + STAIRWELL_HALF_LEVEL;
