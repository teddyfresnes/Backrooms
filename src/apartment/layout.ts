import type { Rect, Vec3Data } from '../world/types';
import { floorY, STAIRWELL_LEVEL_COUNT } from '../stairwell/layout';

export const APARTMENT_LEVEL = STAIRWELL_LEVEL_COUNT - 1;
export const APARTMENT_FLOOR_Y = floorY(APARTMENT_LEVEL);
export const APARTMENT_CEILING_HEIGHT = 2.68;
export const APARTMENT_WALL_HEIGHT = APARTMENT_CEILING_HEIGHT;
export const APARTMENT_OUTER_WALL = 0.22;
export const APARTMENT_INNER_WALL = 0.12;
export const APARTMENT_STRUCTURE_THICKNESS = 0.16;
export const APARTMENT_FLOOR_FINISH = 0.026;

// V23.9 / package 1.12.0: keep the merged north room, but refine the entry
// finish and replace the loggia guard with a more typical barred HLM railing.
export const APARTMENT_BOUNDS: Rect = {
  minX: -15.02,
  maxX: -2.05,
  minZ: -3.9,
  maxZ: 7.8,
};

export const APARTMENT_NORTH_ROOM_DIVIDER_X = -6.05;
export const APARTMENT_CORRIDOR_WEST_X = -7.35;

export const ENTRY_DOOR_FRAME_JAMB = 0.018;
export const ENTRY_DOOR_LEAF_GAP = 0.002;
export const ENTRY_DOOR_LEAF_DEPTH = 0.032;
export const ENTRY_DOOR_FRAME_REVEAL_DEPTH = APARTMENT_OUTER_WALL - 0.036;
export const ENTRY_DOOR_WALL_FACE_X = APARTMENT_BOUNDS.maxX + APARTMENT_OUTER_WALL * 0.5;

const ENTRY_DOOR_CENTER_Z = -2.712;
// Measured directly from the current imported Sketchfab door. The wall cutout
// slightly overlaps the real outer frame so the frame cleanly masks the masonry
// edge and no daylight gap can appear above it.
const ENTRY_DOOR_OPENING_WIDTH = 0.924;
const ENTRY_DOOR_VISIBLE_LEAF_WIDTH = 0.894;
const ENTRY_DOOR_HINGE_Z = ENTRY_DOOR_CENTER_Z - ENTRY_DOOR_VISIBLE_LEAF_WIDTH * 0.5;

export const APARTMENT_ENTRY_DOOR = {
  centerX: APARTMENT_BOUNDS.maxX,
  centerZ: ENTRY_DOOR_CENTER_Z,
  width: ENTRY_DOOR_OPENING_WIDTH,
  height: 2.231,
  bottom: 0.04,
  frameJamb: ENTRY_DOOR_FRAME_JAMB,
  leafGap: ENTRY_DOOR_LEAF_GAP,
  leafDepth: ENTRY_DOOR_LEAF_DEPTH,
  leafWidth: ENTRY_DOOR_VISIBLE_LEAF_WIDTH,
  leafHeight: 2.185,
  wallFaceX: ENTRY_DOOR_WALL_FACE_X,
  hingeZ: ENTRY_DOOR_HINGE_Z,
} as const;

export const INTERIOR_DOOR_FRAME_JAMB = 0.038;
export const INTERIOR_DOOR_LEAF_GAP = 0.004;
export const INTERIOR_DOOR_LEAF_DEPTH = 0.042;
export const INTERIOR_DOOR_HEADER_GAP = 0.006;
export const INTERIOR_DOOR_LEAF_BOTTOM = 0.014;

export const APARTMENT_EXTRA_ROOM_DOOR = {
  wallZ: -0.55,
  centerX: -12.45,
  width: 0.92,
  height: 2.12,
  bottom: 0.01,
} as const;

export const APARTMENT_NORTH_ROOM_DOOR = {
  wallX: APARTMENT_NORTH_ROOM_DIVIDER_X,
  centerZ: 1.92,
  width: 0.9,
  height: 2.12,
  bottom: 0.01,
} as const;

const BEDROOM_TERRACE_MIN_X = APARTMENT_NORTH_ROOM_DIVIDER_X + 0.06;
const BEDROOM_TERRACE_MAX_X = -2.16;
const BEDROOM_TERRACE_MIN_Z = 5.92;
const BEDROOM_TERRACE_MAX_Z = 7.69;
const BEDROOM_TERRACE_CENTER_X = (BEDROOM_TERRACE_MIN_X + BEDROOM_TERRACE_MAX_X) * 0.5;
const BEDROOM_TERRACE_OPENING_WIDTH = 3.59;
const BEDROOM_TERRACE_PANEL_WIDTH = 1.86;
const BEDROOM_TERRACE_OPENING_LEFT = BEDROOM_TERRACE_CENTER_X - BEDROOM_TERRACE_OPENING_WIDTH * 0.5;
const BEDROOM_TERRACE_OPENING_RIGHT = BEDROOM_TERRACE_CENTER_X + BEDROOM_TERRACE_OPENING_WIDTH * 0.5;
const BEDROOM_TERRACE_FIXED_PANEL_CENTER_X = BEDROOM_TERRACE_OPENING_LEFT + BEDROOM_TERRACE_PANEL_WIDTH * 0.5;
const BEDROOM_TERRACE_MOVING_CLOSED_CENTER_X = BEDROOM_TERRACE_OPENING_RIGHT - BEDROOM_TERRACE_PANEL_WIDTH * 0.5;

export const APARTMENT_BEDROOM_TERRACE = {
  minX: BEDROOM_TERRACE_MIN_X,
  maxX: BEDROOM_TERRACE_MAX_X,
  minZ: BEDROOM_TERRACE_MIN_Z,
  maxZ: BEDROOM_TERRACE_MAX_Z,
  centerX: BEDROOM_TERRACE_CENTER_X,
  width: BEDROOM_TERRACE_MAX_X - BEDROOM_TERRACE_MIN_X,
  depth: BEDROOM_TERRACE_MAX_Z - BEDROOM_TERRACE_MIN_Z,

  // Near-full-width interior sliding facade, widened together with the room.
  openingCenterX: BEDROOM_TERRACE_CENTER_X,
  openingWidth: BEDROOM_TERRACE_OPENING_WIDTH,
  openingBottom: 0,
  openingHeight: 2.46,
  openingZ: BEDROOM_TERRACE_MIN_Z,
  panelWidth: BEDROOM_TERRACE_PANEL_WIDTH,
  panelHeight: 2.31,
  panelBottom: 0.07,
  fixedPanelCenterX: BEDROOM_TERRACE_FIXED_PANEL_CENTER_X,
  movingClosedCenterX: BEDROOM_TERRACE_MOVING_CLOSED_CENTER_X,
  movingOpenCenterX: BEDROOM_TERRACE_FIXED_PANEL_CENTER_X + 0.035,
  fixedPanelZ: BEDROOM_TERRACE_MIN_Z + 0.026,
  movingPanelZ: BEDROOM_TERRACE_MIN_Z - 0.026,

  // Cold, partially open exterior facade above a low concrete parapet.
  facadeOpeningCenterX: BEDROOM_TERRACE_CENTER_X,
  facadeOpeningWidth: 3.67,
  facadeOpeningBottom: 0.18,
  facadeOpeningHeight: 2.24,
  guardTop: 1.08,
} as const;

export const APARTMENT_DOOR_FOCUS: Vec3Data = {
  x: -1.98,
  y: APARTMENT_FLOOR_Y + 1.18,
  z: APARTMENT_ENTRY_DOOR.centerZ,
};

export const APARTMENT_ENTRY_LOCK_FOCUS: Vec3Data = {
  x: APARTMENT_ENTRY_DOOR.wallFaceX - 0.185,
  y: APARTMENT_FLOOR_Y + 1.02,
  z: APARTMENT_ENTRY_DOOR.centerZ + 0.27,
};

// Spawn on the last-floor landing, directly in front of the apartment door.
export const APARTMENT_ENTRY_SPAWN: Vec3Data = {
  x: -1.14,
  y: APARTMENT_FLOOR_Y + 0.865,
  z: APARTMENT_ENTRY_DOOR.centerZ,
};

export const APARTMENT_SLIDING_TERRACE_DOOR_FOCUS: Vec3Data = {
  x: APARTMENT_BEDROOM_TERRACE.openingCenterX,
  y: APARTMENT_FLOOR_Y + 1.2,
  z: APARTMENT_BEDROOM_TERRACE.openingZ - 0.02,
};

const INNER_WEST_X = APARTMENT_BOUNDS.minX + APARTMENT_OUTER_WALL * 0.5;
const INNER_NORTH_Z = APARTMENT_BOUNDS.maxZ - APARTMENT_OUTER_WALL * 0.5;

export const APARTMENT_ROOMS = {
  entry: { minX: -5.4, maxX: -2.16, minZ: -3.79, maxZ: -1.7 },
  kitchen: { minX: -10.0, maxX: -5.4, minZ: -3.79, maxZ: -1.7 },
  extraRoom: { minX: INNER_WEST_X, maxX: -10.0, minZ: -3.79, maxZ: -0.55 },
  livingSouth: { minX: -10.0, maxX: APARTMENT_CORRIDOR_WEST_X, minZ: -1.7, maxZ: -0.55 },
  northRoom: { minX: APARTMENT_NORTH_ROOM_DIVIDER_X, maxX: -2.16, minZ: -1.7, maxZ: INNER_NORTH_Z },
  corridor: { minX: APARTMENT_CORRIDOR_WEST_X, maxX: APARTMENT_NORTH_ROOM_DIVIDER_X, minZ: -1.7, maxZ: INNER_NORTH_Z },
  living: { minX: INNER_WEST_X, maxX: APARTMENT_CORRIDOR_WEST_X, minZ: -0.55, maxZ: INNER_NORTH_Z },
} as const;
