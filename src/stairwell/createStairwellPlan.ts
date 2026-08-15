import type { RoomRecord, StaticCollider, WorldPlan } from '../world/types';
import { APARTMENT_ENTRY_DOOR } from '../apartment/layout';
import {
  floorY,
  midLandingY,
  STAIRWELL_BOUNDS,
  STAIRWELL_FLIGHT_COUNT,
  STAIRWELL_FLOOR_HEIGHT,
  STAIRWELL_LEFT_FLIGHT,
  STAIRWELL_LEVEL_COUNT,
  STAIRWELL_MAIN_LANDING,
  STAIRWELL_MID_LANDING,
  STAIRWELL_RIGHT_FLIGHT,
  STAIRWELL_ROOF_Y,
  STAIRWELL_SPAWN,
  STAIRWELL_STEP_DEPTH,
  STAIRWELL_STEP_RISE,
  STAIRWELL_STEPS_PER_FLIGHT,
  STAIRWELL_WALL_THICKNESS,
  STAIRWELL_WINDOW_HEIGHT,
  STAIRWELL_WINDOW_SILL,
  STAIRWELL_WINDOW_WIDTH,
} from './layout';

const collider = (
  id: string,
  x: number,
  y: number,
  z: number,
  halfX: number,
  halfY: number,
  halfZ: number,
  kind: StaticCollider['kind'],
): StaticCollider => ({
  id,
  center: { x, y, z },
  halfExtents: { x: halfX, y: halfY, z: halfZ },
  kind,
});

const floorCollider = (
  id: string,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  topY: number,
): StaticCollider => collider(
  id,
  (minX + maxX) * 0.5,
  topY - 0.1,
  (minZ + maxZ) * 0.5,
  (maxX - minX) * 0.5,
  0.1,
  (maxZ - minZ) * 0.5,
  'floor',
);

// Chaque marche est une dalle mince de 18 cm. Elle ne descend plus jusqu'au
// palier inférieur : le dessous de la volée reste ouvert et praticable.
const stepCollider = (
  id: string,
  minX: number,
  maxX: number,
  z: number,
  topY: number,
): StaticCollider => collider(
  id,
  (minX + maxX) * 0.5,
  topY - STAIRWELL_STEP_RISE * 0.5,
  z,
  (maxX - minX) * 0.5,
  STAIRWELL_STEP_RISE * 0.5,
  STAIRWELL_STEP_DEPTH * 0.5,
  'step',
);

const railingBarrier = (
  id: string,
  x: number,
  z: number,
  treadTopY: number,
): StaticCollider => collider(
  id,
  x,
  treadTopY + 0.49,
  z,
  0.04,
  0.49,
  STAIRWELL_STEP_DEPTH * 0.48,
  'barrier',
);

export const createStairwellColliders = (): StaticCollider[] => {
  const colliders: StaticCollider[] = [];

  // Un seul collider continu au RDC, aligné sur l'unique dalle visuelle.
  // Cela élimine les zones superposées et les coutures physiques.
  const groundInset = STAIRWELL_WALL_THICKNESS * 0.45;
  colliders.push(floorCollider(
    'ground-floor',
    STAIRWELL_BOUNDS.minX + groundInset,
    STAIRWELL_BOUNDS.maxX - groundInset,
    STAIRWELL_BOUNDS.minZ + groundInset,
    STAIRWELL_BOUNDS.maxZ - groundInset,
    floorY(0),
  ));

  for (let level = 1; level < STAIRWELL_LEVEL_COUNT; level += 1) {
    colliders.push(floorCollider(
      `main-landing-${level}`,
      STAIRWELL_MAIN_LANDING.minX,
      STAIRWELL_MAIN_LANDING.maxX,
      STAIRWELL_MAIN_LANDING.minZ,
      STAIRWELL_MAIN_LANDING.maxZ,
      floorY(level),
    ));
  }

  // Keep the newly deepened south/window facade physically closed: the hall
  // windows remain visually transparent, but the player should not be able to
  // walk through them and fall outside.
  for (let level = 1; level < STAIRWELL_LEVEL_COUNT; level += 1) {
    colliders.push(collider(
      `south-window-glass-${level}`,
      0,
      floorY(level) + STAIRWELL_WINDOW_SILL + STAIRWELL_WINDOW_HEIGHT * 0.5,
      STAIRWELL_BOUNDS.minZ + STAIRWELL_WALL_THICKNESS * 0.6,
      STAIRWELL_WINDOW_WIDTH * 0.5,
      STAIRWELL_WINDOW_HEIGHT * 0.5,
      0.05,
      'barrier',
    ));
  }

  for (let level = 0; level < STAIRWELL_FLIGHT_COUNT; level += 1) {
    const base = floorY(level);
    const mid = midLandingY(level);
    colliders.push(floorCollider(
      `mid-landing-${level}`,
      STAIRWELL_MID_LANDING.minX,
      STAIRWELL_MID_LANDING.maxX,
      STAIRWELL_MID_LANDING.minZ,
      STAIRWELL_MID_LANDING.maxZ,
      mid,
    ));

    for (let step = 0; step < STAIRWELL_STEPS_PER_FLIGHT; step += 1) {
      const leftZ = STAIRWELL_LEFT_FLIGHT.minZ + STAIRWELL_STEP_DEPTH * (step + 0.5);
      const leftTop = base + STAIRWELL_STEP_RISE * (step + 1);
      colliders.push(stepCollider(
        `left-flight-${level}-step-${step}`,
        STAIRWELL_LEFT_FLIGHT.minX,
        STAIRWELL_LEFT_FLIGHT.maxX,
        leftZ,
        leftTop,
      ));
      colliders.push(railingBarrier(`left-flight-${level}-rail-${step}`, -0.075, leftZ, leftTop));

      const rightZ = STAIRWELL_RIGHT_FLIGHT.maxZ - STAIRWELL_STEP_DEPTH * (step + 0.5);
      const rightTop = mid + STAIRWELL_STEP_RISE * (step + 1);
      colliders.push(stepCollider(
        `right-flight-${level}-step-${step}`,
        STAIRWELL_RIGHT_FLIGHT.minX,
        STAIRWELL_RIGHT_FLIGHT.maxX,
        rightZ,
        rightTop,
      ));
      colliders.push(railingBarrier(`right-flight-${level}-rail-${step}`, 0.075, rightZ, rightTop));
    }
  }

  const width = STAIRWELL_BOUNDS.maxX - STAIRWELL_BOUNDS.minX;
  const depth = STAIRWELL_BOUNDS.maxZ - STAIRWELL_BOUNDS.minZ;
  const wallHalf = STAIRWELL_WALL_THICKNESS * 0.5;
  const topFloorY = floorY(STAIRWELL_LEVEL_COUNT - 1);
  const westOpeningMinZ = APARTMENT_ENTRY_DOOR.centerZ - APARTMENT_ENTRY_DOOR.width * 0.5;
  const westOpeningMaxZ = APARTMENT_ENTRY_DOOR.centerZ + APARTMENT_ENTRY_DOOR.width * 0.5;
  const westOpeningTopY = topFloorY + APARTMENT_ENTRY_DOOR.bottom + APARTMENT_ENTRY_DOOR.height;
  const westSouthDepth = westOpeningMinZ - STAIRWELL_BOUNDS.minZ;
  const westNorthDepth = STAIRWELL_BOUNDS.maxZ - westOpeningMaxZ;

  colliders.push(
    collider('west-wall-lower', STAIRWELL_BOUNDS.minX, topFloorY * 0.5, 0, wallHalf, topFloorY * 0.5, depth * 0.5, 'wall'),
    collider('west-wall-top-south', STAIRWELL_BOUNDS.minX, topFloorY + STAIRWELL_FLOOR_HEIGHT * 0.5, STAIRWELL_BOUNDS.minZ + westSouthDepth * 0.5, wallHalf, STAIRWELL_FLOOR_HEIGHT * 0.5, westSouthDepth * 0.5, 'wall'),
    collider('west-wall-top-north', STAIRWELL_BOUNDS.minX, topFloorY + STAIRWELL_FLOOR_HEIGHT * 0.5, westOpeningMaxZ + westNorthDepth * 0.5, wallHalf, STAIRWELL_FLOOR_HEIGHT * 0.5, westNorthDepth * 0.5, 'wall'),
    collider('west-wall-top-header', STAIRWELL_BOUNDS.minX, (westOpeningTopY + STAIRWELL_ROOF_Y) * 0.5, APARTMENT_ENTRY_DOOR.centerZ, wallHalf, (STAIRWELL_ROOF_Y - westOpeningTopY) * 0.5, APARTMENT_ENTRY_DOOR.width * 0.5, 'wall'),
    collider('east-wall', STAIRWELL_BOUNDS.maxX, STAIRWELL_ROOF_Y * 0.5, 0, wallHalf, STAIRWELL_ROOF_Y * 0.5, depth * 0.5, 'wall'),
    collider('south-wall', 0, STAIRWELL_ROOF_Y * 0.5, STAIRWELL_BOUNDS.minZ, width * 0.5, STAIRWELL_ROOF_Y * 0.5, wallHalf, 'wall'),
    collider('north-wall', 0, STAIRWELL_ROOF_Y * 0.5, STAIRWELL_BOUNDS.maxZ, width * 0.5, STAIRWELL_ROOF_Y * 0.5, wallHalf, 'wall'),
    collider('roof', 0, STAIRWELL_ROOF_Y + 0.12, 0, width * 0.5, 0.12, depth * 0.5, 'barrier'),
  );

  return colliders;
};

const rooms: RoomRecord[] = Array.from({ length: STAIRWELL_LEVEL_COUNT }, (_, level) => ({
  id: `stairwell-floor-${level}`,
  bounds: STAIRWELL_BOUNDS,
  kind: 'open-hall',
  level,
  ceilingHeight: STAIRWELL_FLOOR_HEIGHT,
  detailDensity: 0.5,
}));

export const createStairwellPlan = (): WorldPlan => ({
  version: 23,
  seed: 'RUSSIAN-STAIRWELL-V23-EMPTY-APARTMENT',
  size: 16,
  wallHeight: STAIRWELL_ROOF_Y,
  rooms,
  walls: [],
  columns: [],
  solidMasses: [],
  lights: [],
  missingCeilingTiles: [],
  features: [],
  detailSockets: [],
  colliders: createStairwellColliders(),
  floorRects: [STAIRWELL_MAIN_LANDING, STAIRWELL_MID_LANDING],
  spawn: { ...STAIRWELL_SPAWN },
});
