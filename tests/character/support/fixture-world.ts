import type { StaticCollider, WorldPlan } from '../../../src/world/types';

const FLOOR_HALF_THICKNESS = 0.1;
const WALL_HALF_THICKNESS = 0.12;
const WALL_HEIGHT = 3.6;

const LAB_MIN_X = -18;
const LAB_MAX_X = 18;
const LAB_MIN_Z = -15;
const LAB_MAX_Z = 15;
const TILE_SIZE = 3;

const box = (
  id: string,
  center: StaticCollider['center'],
  halfExtents: StaticCollider['halfExtents'],
  kind: StaticCollider['kind'],
): StaticCollider => ({ id, center, halfExtents, kind });

const floorBox = (
  id: string,
  x: number,
  z: number,
  width: number,
  depth: number,
  top = 0,
): StaticCollider => box(
  id,
  { x, y: top - FLOOR_HALF_THICKNESS, z },
  { x: width * 0.5, y: FLOOR_HALF_THICKNESS, z: depth * 0.5 },
  'floor',
);

const wallX = (id: string, x: number, z: number, length: number, height = WALL_HEIGHT): StaticCollider =>
  box(id, { x, y: height * 0.5, z }, { x: length * 0.5, y: height * 0.5, z: WALL_HALF_THICKNESS }, 'wall');

const wallZ = (id: string, x: number, z: number, length: number, height = WALL_HEIGHT): StaticCollider =>
  box(id, { x, y: height * 0.5, z }, { x: WALL_HALF_THICKNESS, y: height * 0.5, z: length * 0.5 }, 'wall');

const step = (
  id: string,
  x: number,
  z: number,
  width: number,
  depth: number,
  top: number,
): StaticCollider => box(id, { x, y: top * 0.5, z }, { x: width * 0.5, y: top * 0.5, z: depth * 0.5 }, 'step');

export type PitStairDirection = 'x+' | 'x-' | 'z+' | 'z-';

export interface MovementLabPitSpec {
  readonly id: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly bottom: number;
  readonly stairs: PitStairDirection;
}

// Every opening is its own enclosed shaft with a unique lower floor. There is
// deliberately no giant hidden floor underneath the whole map anymore.
export const MOVEMENT_LAB_PITS: readonly MovementLabPitSpec[] = [
  { id: 'small',  minX: -12, maxX: -6, minZ: -9,  maxZ: 0,  bottom: -4.2, stairs: 'z+' },
  { id: 'medium', minX: 3,   maxX: 12, minZ: -12, maxZ: 0,  bottom: -5.4, stairs: 'z-' },
  // Keep one genuinely lethal test shaft after raising the global death threshold.
  { id: 'deep',   minX: -15, maxX: -3, minZ: 6,   maxZ: 15, bottom: -12.6, stairs: 'x+' },
  { id: 'narrow', minX: -3,  maxX: 3,  minZ: 6,   maxZ: 12, bottom: -3.6, stairs: 'x-' },
  { id: 'wide',   minX: 6,   maxX: 15, minZ: 6,   maxZ: 15, bottom: -4.8, stairs: 'z+' },
];

export const MOVEMENT_LAB_PIT_BOTTOM = Math.min(...MOVEMENT_LAB_PITS.map((pit) => pit.bottom));
export const MOVEMENT_LAB_SPAWN = { x: -15, y: 0, z: -12 } as const;
// Comparison mannequin: deliberately parked on an intact surface tile, away
// from every pit opening. Keeping this alongside the plan makes it testable.
export const MOVEMENT_LAB_IDLE_NPC = { x: -10.5, y: 0, z: -10.8 } as const;

const addPitWalls = (colliders: StaticCollider[], pit: MovementLabPitSpec): void => {
  const centerX = (pit.minX + pit.maxX) * 0.5;
  const centerZ = (pit.minZ + pit.maxZ) * 0.5;
  const width = pit.maxX - pit.minX;
  const depth = pit.maxZ - pit.minZ;
  const height = Math.abs(pit.bottom);
  const centerY = pit.bottom + height * 0.5;
  colliders.push(
    box(`pit-wall-${pit.id}-north`, { x: centerX, y: centerY, z: pit.minZ }, { x: width * 0.5, y: height * 0.5, z: WALL_HALF_THICKNESS }, 'wall'),
    box(`pit-wall-${pit.id}-south`, { x: centerX, y: centerY, z: pit.maxZ }, { x: width * 0.5, y: height * 0.5, z: WALL_HALF_THICKNESS }, 'wall'),
    box(`pit-wall-${pit.id}-west`, { x: pit.minX, y: centerY, z: centerZ }, { x: WALL_HALF_THICKNESS, y: height * 0.5, z: depth * 0.5 }, 'wall'),
    box(`pit-wall-${pit.id}-east`, { x: pit.maxX, y: centerY, z: centerZ }, { x: WALL_HALF_THICKNESS, y: height * 0.5, z: depth * 0.5 }, 'wall'),
  );
};

const addDirectPitStairs = (colliders: StaticCollider[], pit: MovementLabPitSpec): void => {
  const width = pit.maxX - pit.minX;
  const depth = pit.maxZ - pit.minZ;
  const alongX = pit.stairs.startsWith('x');
  const positive = pit.stairs.endsWith('+');
  const runLength = (alongX ? width : depth) - 0.72;
  const crossLength = alongX ? depth : width;
  const count = Math.max(10, Math.ceil(Math.abs(pit.bottom) / 0.235));
  const tread = runLength / count;
  const rise = Math.abs(pit.bottom) / count;
  const stairWidth = Math.min(2.25, Math.max(1.55, crossLength - 1.25));
  const slabThickness = 0.14;
  const centerX = (pit.minX + pit.maxX) * 0.5;
  const centerZ = (pit.minZ + pit.maxZ) * 0.5;
  const alongMin = alongX ? pit.minX : pit.minZ;
  const alongMax = alongX ? pit.maxX : pit.maxZ;

  for (let index = 0; index < count; index += 1) {
    const distanceFromLowEnd = 0.36 + tread * (index + 0.5);
    const along = positive
      ? alongMin + distanceFromLowEnd
      : alongMax - distanceFromLowEnd;
    const top = pit.bottom + rise * (index + 1);
    const x = alongX ? along : centerX;
    const z = alongX ? centerZ : along;
    colliders.push(box(
      `pit-stair-${pit.id}-${String(index + 1).padStart(2, '0')}`,
      { x, y: top - slabThickness * 0.5, z },
      {
        x: (alongX ? tread : stairWidth) * 0.5,
        y: slabThickness * 0.5,
        z: (alongX ? stairWidth : tread) * 0.5,
      },
      'step',
    ));
  }
};

const tileInsidePit = (x: number, z: number): boolean => MOVEMENT_LAB_PITS.some((pit) => (
  x > pit.minX && x < pit.maxX && z > pit.minZ && z < pit.maxZ
));

export const createMovementLabPlan = (): WorldPlan => {
  const colliders: StaticCollider[] = [];
  const floorRects: WorldPlan['floorRects'] = [];
  const floorOpenings: NonNullable<WorldPlan['floorOpenings']> = MOVEMENT_LAB_PITS.map((pit) => ({
    minX: pit.minX, minZ: pit.minZ, maxX: pit.maxX, maxZ: pit.maxZ,
  }));

  // Smaller 3 m surface slabs let the openings have genuinely different sizes
  // while still using simple box colliders and preserving crisp hole edges.
  for (let z = LAB_MIN_Z + TILE_SIZE * 0.5; z < LAB_MAX_Z; z += TILE_SIZE) {
    for (let x = LAB_MIN_X + TILE_SIZE * 0.5; x < LAB_MAX_X; x += TILE_SIZE) {
      if (tileInsidePit(x, z)) continue;
      const minX = x - TILE_SIZE * 0.5;
      const maxX = x + TILE_SIZE * 0.5;
      const minZ = z - TILE_SIZE * 0.5;
      const maxZ = z + TILE_SIZE * 0.5;
      colliders.push(floorBox(`floor-${x}-${z}`, x, z, TILE_SIZE, TILE_SIZE));
      floorRects.push({ minX, minZ, maxX, maxZ });
    }
  }

  colliders.push(
    wallX('wall-north', 0, LAB_MIN_Z, LAB_MAX_X - LAB_MIN_X),
    wallX('wall-south', 0, LAB_MAX_Z, LAB_MAX_X - LAB_MIN_X),
    wallZ('wall-west', LAB_MIN_X, 0, LAB_MAX_Z - LAB_MIN_Z),
    wallZ('wall-east', LAB_MAX_X, 0, LAB_MAX_Z - LAB_MIN_Z),

    // A few real collidable partitions/columns make the test floor read like a
    // small Level-0 slice instead of an empty arena, while deliberately keeping
    // broad routes around every pit for repeated fall / recovery testing.
    wallX('backrooms-partition-west', -14.0, 3.0, 5.5),
    wallZ('backrooms-partition-center', -1.5, -4.5, 6.0),
    wallX('backrooms-partition-east', 8.0, 3.0, 8.0),
    wallZ('backrooms-partition-far-east', 15.0, -4.5, 6.0),
    box('backrooms-column-01', { x: -15.0, y: WALL_HEIGHT * 0.5, z: -4.5 }, { x: 0.28, y: WALL_HEIGHT * 0.5, z: 0.28 }, 'column'),
    box('backrooms-column-02', { x: -7.5, y: WALL_HEIGHT * 0.5, z: 3.0 }, { x: 0.28, y: WALL_HEIGHT * 0.5, z: 0.28 }, 'column'),
    box('backrooms-column-03', { x: 1.5, y: WALL_HEIGHT * 0.5, z: 3.0 }, { x: 0.28, y: WALL_HEIGHT * 0.5, z: 0.28 }, 'column'),
    box('backrooms-column-04', { x: 15.0, y: WALL_HEIGHT * 0.5, z: 3.0 }, { x: 0.28, y: WALL_HEIGHT * 0.5, z: 0.28 }, 'column'),

    // A compact surface stair and two blocks remain for controlled jump/impact tests.
    step('stairs-01', -3.0, -12, 0.7, 3.0, 0.18),
    step('stairs-02', -2.3, -12, 0.7, 3.0, 0.36),
    step('stairs-03', -1.6, -12, 0.7, 3.0, 0.54),
    step('stairs-04', -0.9, -12, 0.7, 3.0, 0.72),
    step('stairs-05', -0.2, -12, 0.7, 3.0, 0.90),
    step('stairs-platform', 1.35, -12, 2.4, 3.0, 0.90),
    step('impact-low', 13.5, -9, 2.4, 2.4, 0.46),
    step('impact-high', 15.8, -6, 2.0, 2.0, 1.15),
  );

  for (const pit of MOVEMENT_LAB_PITS) {
    const centerX = (pit.minX + pit.maxX) * 0.5;
    const centerZ = (pit.minZ + pit.maxZ) * 0.5;
    colliders.push(floorBox(`pit-bottom-${pit.id}`, centerX, centerZ, pit.maxX - pit.minX, pit.maxZ - pit.minZ, pit.bottom));
    addPitWalls(colliders, pit);
    addDirectPitStairs(colliders, pit);
  }

  return {
    version: 1,
    seed: 'movement-lab-backrooms-surface-pits-v11',
    size: LAB_MAX_X - LAB_MIN_X,
    wallHeight: WALL_HEIGHT,
    rooms: [],
    walls: [],
    columns: [],
    solidMasses: [],
    lights: [],
    missingCeilingTiles: [],
    features: [],
    detailSockets: [],
    colliders,
    floorRects,
    floorOpenings,
    visualBiome: 'yellow',
    spawn: { ...MOVEMENT_LAB_SPAWN },
  };
};
