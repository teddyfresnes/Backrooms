import { generateWorld, worldHasDeepShaft } from './generateWorld';
import { SeededRandom } from './SeededRandom';
import type {
  GridPitFeature,
  Rect,
  StaticCollider,
  Vec3Data,
  WallSegment,
  WorldFeature,
  WorldPlan,
} from './types';
import { pointInRect, rectArea, rectCenter, rectDepth, rectWidth } from './types';

export const INFINITE_CHUNK_SIZE = 112;
export const INFINITE_STORY_PITCH = 5.4;

const HALF_CHUNK_SIZE = INFINITE_CHUNK_SIZE * 0.5;
const BOUNDARY_EPSILON = 0.075;
const WRAPPER_VERSION = 1;

export interface ChunkCoord {
  readonly x: number;
  readonly z: number;
  readonly story: number;
}

export type ChunkKey = `${number}:${number}:${number}`;
export type ChunkEdge = 'north' | 'east' | 'south' | 'west';
export type InfiniteBiome =
  | 'classic-maze'
  | 'pillar-hall'
  | 'tight-threshold'
  | 'quiet-expanse'
  | 'symmetric-gallery'
  | 'vertical-atrium';

export interface EdgeGate {
  /** Position along the edge in chunk-local coordinates. */
  readonly offset: number;
  readonly width: number;
}

export type InfiniteEdgeGates = Readonly<Record<ChunkEdge, readonly EdgeGate[]>>;

export interface InfiniteChunkMetadata {
  readonly key: ChunkKey;
  readonly coord: Readonly<ChunkCoord>;
  /** Translation to apply to the local plan in the un-rebased logical world. */
  readonly worldOffset: Readonly<Vec3Data>;
  readonly edgeGates: InfiniteEdgeGates;
  readonly biome: InfiniteBiome;
  /** Holes cut in this story's ceiling by the chunk directly above it. */
  readonly ceilingOpenings: readonly Readonly<Rect>[];
  readonly wrapperVersion: number;
}

interface CanonicalEdgeAddress {
  readonly axis: 'horizontal' | 'vertical';
  readonly line: number;
  readonly lane: number;
  readonly story: number;
}

const metadataByPlan = new WeakMap<WorldPlan, InfiniteChunkMetadata>();

const quantize = (value: number, step: number): number =>
  Math.round(value / step) * step;

const assertCoordinate = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Infinite chunk ${label} must be a safe integer; received ${String(value)}.`);
  }
};

const freezeCoord = (coord: ChunkCoord): Readonly<ChunkCoord> =>
  Object.freeze({ x: coord.x, z: coord.z, story: coord.story });

const cloneRect = (rect: Rect): Rect => ({
  minX: rect.minX,
  minZ: rect.minZ,
  maxX: rect.maxX,
  maxZ: rect.maxZ,
});

const freezeRects = (rects: readonly Rect[]): readonly Readonly<Rect>[] =>
  Object.freeze(rects.map((rect) => Object.freeze(cloneRect(rect))));

export const createChunkKey = (coord: ChunkCoord): ChunkKey => {
  assertCoordinate(coord.x, 'x');
  assertCoordinate(coord.z, 'z');
  assertCoordinate(coord.story, 'story');
  return `${coord.x}:${coord.z}:${coord.story}`;
};

export const parseChunkKey = (key: ChunkKey): Readonly<ChunkCoord> => {
  const parts = key.split(':');
  if (parts.length !== 3 || parts.some((part) => part.trim() === '')) {
    throw new Error(`Invalid infinite chunk key: ${key}`);
  }
  const [x, z, story] = parts.map(Number);
  assertCoordinate(x!, 'x');
  assertCoordinate(z!, 'z');
  assertCoordinate(story!, 'story');
  return freezeCoord({ x: x!, z: z!, story: story! });
};

const resolveCoord = (key: ChunkKey | ChunkCoord): Readonly<ChunkCoord> => {
  if (typeof key === 'string') return parseChunkKey(key);
  assertCoordinate(key.x, 'x');
  assertCoordinate(key.z, 'z');
  assertCoordinate(key.story, 'story');
  return freezeCoord({ x: key.x, z: key.z, story: key.story });
};

export const getChunkWorldOffset = (key: ChunkKey | ChunkCoord): Readonly<Vec3Data> => {
  const coord = resolveCoord(key);
  return Object.freeze({
    x: coord.x * INFINITE_CHUNK_SIZE,
    y: coord.story * INFINITE_STORY_PITCH,
    z: coord.z * INFINITE_CHUNK_SIZE,
  });
};

export const getNeighborChunkKey = (
  key: ChunkKey | ChunkCoord,
  edge: ChunkEdge,
): ChunkKey => {
  const coord = resolveCoord(key);
  if (edge === 'north') return createChunkKey({ ...coord, z: coord.z - 1 });
  if (edge === 'south') return createChunkKey({ ...coord, z: coord.z + 1 });
  if (edge === 'west') return createChunkKey({ ...coord, x: coord.x - 1 });
  return createChunkKey({ ...coord, x: coord.x + 1 });
};

const canonicalEdgeAddress = (
  coord: Readonly<ChunkCoord>,
  edge: ChunkEdge,
): CanonicalEdgeAddress => {
  if (edge === 'west') {
    return { axis: 'vertical', line: coord.x, lane: coord.z, story: coord.story };
  }
  if (edge === 'east') {
    return { axis: 'vertical', line: coord.x + 1, lane: coord.z, story: coord.story };
  }
  if (edge === 'north') {
    return { axis: 'horizontal', line: coord.z, lane: coord.x, story: coord.story };
  }
  return { axis: 'horizontal', line: coord.z + 1, lane: coord.x, story: coord.story };
};

const edgeAddressSeed = (seed: string, address: CanonicalEdgeAddress, suffix: string): string =>
  `${seed}::infinite-edge:v${WRAPPER_VERSION}:${address.axis}:${address.line}:${address.lane}:${address.story}:${suffix}`;

const gatesForAddress = (seed: string, address: CanonicalEdgeAddress): readonly EdgeGate[] => {
  const rng = new SeededRandom(edgeAddressSeed(seed, address, 'gates'));
  const count = rng.chance(0.38) ? 2 : 1;
  const offsets = count === 1
    ? [quantize(rng.float(-34, 34), 0.25)]
    : [
        quantize(rng.float(-38, -8), 0.25),
        quantize(rng.float(8, 38), 0.25),
      ];
  return Object.freeze(
    offsets.map((offset) =>
      Object.freeze({
        offset,
        width: quantize(rng.float(2.35, 4.6), 0.05),
      }),
    ),
  );
};

export const getCanonicalEdgeGates = (
  seed: string,
  key: ChunkKey | ChunkCoord,
  edge: ChunkEdge,
): readonly EdgeGate[] => {
  const coord = resolveCoord(key);
  return gatesForAddress(seed, canonicalEdgeAddress(coord, edge));
};

export const getInfiniteEdgeGates = (
  seed: string,
  key: ChunkKey | ChunkCoord,
): InfiniteEdgeGates => {
  const coord = resolveCoord(key);
  return Object.freeze({
    north: gatesForAddress(seed, canonicalEdgeAddress(coord, 'north')),
    east: gatesForAddress(seed, canonicalEdgeAddress(coord, 'east')),
    south: gatesForAddress(seed, canonicalEdgeAddress(coord, 'south')),
    west: gatesForAddress(seed, canonicalEdgeAddress(coord, 'west')),
  });
};

const derivedChunkSeed = (seed: string, key: ChunkKey): string =>
  `${seed}::infinite-chunk:v${WRAPPER_VERSION}:${key}`;

export const getInfiniteBiome = (seed: string, key: ChunkKey | ChunkCoord): InfiniteBiome => {
  const coord = resolveCoord(key);
  if (coord.x === 0 && coord.z === 0 && coord.story === 0) return 'classic-maze';
  const macroX = Math.floor(coord.x / 3);
  const macroZ = Math.floor(coord.z / 3);
  return new SeededRandom(`${seed}::infinite-biome:v${WRAPPER_VERSION}:${macroX}:${macroZ}:${coord.story}`).weighted([
    { value: 'classic-maze' as const, weight: 0.44 },
    { value: 'tight-threshold' as const, weight: 0.17 },
    { value: 'pillar-hall' as const, weight: 0.14 },
    { value: 'quiet-expanse' as const, weight: 0.08 },
    { value: 'symmetric-gallery' as const, weight: 0.11 },
    { value: 'vertical-atrium' as const, weight: 0.06 },
  ]);
};

const clearColumnsIn = (plan: WorldPlan, bounds: Rect): void => {
  plan.columns = plan.columns.filter((column) => !pointInRect(column.x, column.z, bounds));
  plan.colliders = plan.colliders.filter(
    (collider) => collider.kind !== 'column' || !pointInRect(collider.center.x, collider.center.z, bounds),
  );
};

const clearInteriorWallsIn = (plan: WorldPlan, bounds: Rect): void => {
  const removed = new Set<string>();
  plan.walls = plan.walls.filter((wall) => {
    const remove =
      wall.bottom >= -1 &&
      pointInRect(wall.x, wall.z, bounds, 0.55);
    if (remove) removed.add(wall.id);
    return !remove;
  });
  plan.colliders = plan.colliders.filter(
    (collider) => !removed.has(collider.id.replace(/^collider-/, '')),
  );
};

const addSymmetricGallery = (plan: WorldPlan, hall: WorldPlan['rooms'][number]): void => {
  clearInteriorWallsIn(plan, hall.bounds);
  clearColumnsIn(plan, hall.bounds);
  plan.features = plan.features.filter(
    (feature) => feature.kind !== 'squeeze-view' || feature.roomId !== hall.id,
  );
  const center = rectCenter(hall.bounds);
  const alongX = rectWidth(hall.bounds) >= rectDepth(hall.bounds);
  const spanMin = (alongX ? hall.bounds.minX : hall.bounds.minZ) + 1.4;
  const spanMax = (alongX ? hall.bounds.maxX : hall.bounds.maxZ) - 1.4;
  const span = spanMax - spanMin;
  const exitCount = Math.max(4, Math.min(7, Math.floor(span / 5.2)));
  const gapWidth = Math.min(3.4, span / (exitCount + 1) * 0.48);
  const gapCenters = Array.from(
    { length: exitCount },
    (_, index) => spanMin + ((index + 1) / (exitCount + 1)) * span,
  );
  const corridorHalfWidth = Math.min(3.1, Math.max(2.2, (alongX
    ? rectDepth(hall.bounds)
    : rectWidth(hall.bounds)) * 0.12));

  for (const side of [-1, 1] as const) {
    let cursor = spanMin;
    for (let index = 0; index <= gapCenters.length; index += 1) {
      const gap = gapCenters[index];
      const end = gap === undefined ? spanMax : gap - gapWidth * 0.5;
      if (end - cursor > 0.2) {
        const wall: WallSegment = {
          id: `symmetric-gallery-${side < 0 ? 'left' : 'right'}-${index}`,
          x: alongX ? (cursor + end) * 0.5 : center.x + side * corridorHalfWidth,
          z: alongX ? center.z + side * corridorHalfWidth : (cursor + end) * 0.5,
          length: end - cursor,
          orientation: alongX ? 'x' : 'z',
          bottom: 0,
          height: plan.wallHeight,
          thickness: 0.3,
          tint: 0.96,
          collision: true,
          kind: 'wallpaper',
        };
        plan.walls.push(wall);
        plan.colliders.push(colliderForWall(wall));
      }
      if (gap !== undefined) cursor = gap + gapWidth * 0.5;
    }
  }

  plan.lights = plan.lights.filter((light) => light.roomId !== hall.id);
  const lightCount = Math.max(4, Math.floor(span / 5.8));
  for (let index = 0; index < lightCount; index += 1) {
    const along = spanMin + ((index + 0.5) / lightCount) * span;
    plan.lights.push({
      id: `symmetric-gallery-light-${index}`,
      x: alongX ? along : center.x,
      z: alongX ? center.z : along,
      ceilingY: plan.wallHeight,
      rotation: alongX ? 0 : Math.PI * 0.5,
      width: 1.9,
      intensity: 1.02,
      color: 0xfffbd5,
      dead: false,
      unstable: false,
      phase: index * 0.83,
      roomId: hall.id,
      level: 0,
    });
  }
};

const addVerticalAtrium = (
  plan: WorldPlan,
  hall: WorldPlan['rooms'][number],
  seed: string,
): void => {
  // The canonical grand hall can touch two chunk seams. Pull only the elevated
  // volume inward so its upper shell is never mistaken for a finite outer
  // boundary and the reserved floor above cannot collide with edge gates.
  const half = plan.size * 0.5;
  const seamInset = 1.15;
  hall.bounds = {
    minX: Math.max(hall.bounds.minX, -half + seamInset),
    minZ: Math.max(hall.bounds.minZ, -half + seamInset),
    maxX: Math.min(hall.bounds.maxX, half - seamInset),
    maxZ: Math.min(hall.bounds.maxZ, half - seamInset),
  };
  clearInteriorWallsIn(plan, hall.bounds);
  clearColumnsIn(plan, hall.bounds);
  plan.features = plan.features.filter(
    (feature) => feature.kind !== 'squeeze-view' || feature.roomId !== hall.id,
  );
  const rng = new SeededRandom(`${seed}::vertical-atrium`);
  const storySpan = rng.chance(0.78) ? 1 : 2;
  const ceilingY = plan.wallHeight + storySpan * INFINITE_STORY_PITCH;
  hall.ceilingHeight = ceilingY;
  const center = rectCenter(hall.bounds);
  const upperHeight = ceilingY - plan.wallHeight;
  const upperBottom = plan.wallHeight;
  const shell = [
    {
      id: 'vertical-atrium-north',
      x: center.x,
      z: hall.bounds.minZ,
      length: rectWidth(hall.bounds),
      orientation: 'x' as const,
    },
    {
      id: 'vertical-atrium-south',
      x: center.x,
      z: hall.bounds.maxZ,
      length: rectWidth(hall.bounds),
      orientation: 'x' as const,
    },
    {
      id: 'vertical-atrium-west',
      x: hall.bounds.minX,
      z: center.z,
      length: rectDepth(hall.bounds),
      orientation: 'z' as const,
    },
    {
      id: 'vertical-atrium-east',
      x: hall.bounds.maxX,
      z: center.z,
      length: rectDepth(hall.bounds),
      orientation: 'z' as const,
    },
  ];
  for (const side of shell) {
    const wall: WallSegment = {
      ...side,
      bottom: upperBottom,
      height: upperHeight,
      thickness: 0.28,
      tint: 0.94,
      collision: true,
      kind: 'wallpaper',
    };
    plan.walls.push(wall);
    plan.colliders.push(colliderForWall(wall));
  }

  plan.lights = plan.lights.filter((light) => light.roomId !== hall.id);
  const columns = Math.max(2, Math.floor(rectWidth(hall.bounds) / 8));
  const rows = Math.max(2, Math.floor(rectDepth(hall.bounds) / 8));
  for (let xIndex = 0; xIndex < columns; xIndex += 1) {
    for (let zIndex = 0; zIndex < rows; zIndex += 1) {
      plan.lights.push({
        id: `vertical-atrium-light-${xIndex}-${zIndex}`,
        x: hall.bounds.minX + ((xIndex + 0.5) / columns) * rectWidth(hall.bounds),
        z: hall.bounds.minZ + ((zIndex + 0.5) / rows) * rectDepth(hall.bounds),
        ceilingY,
        rotation: (xIndex + zIndex) % 2 === 0 ? 0 : Math.PI * 0.5,
        width: 2.2,
        intensity: 1.18,
        color: 0xfff7cf,
        dead: false,
        unstable: false,
        phase: (xIndex * 3 + zIndex) * 0.61,
        roomId: hall.id,
        level: 0,
      });
    }
  }
};

const applyBiome = (plan: WorldPlan, biome: InfiniteBiome, seed: string): void => {
  const hall = [...plan.rooms]
    .filter((room) => room.kind === 'open-hall')
    .sort((a, b) => rectArea(b.bounds) - rectArea(a.bounds))[0];
  if (!hall) return;

  if (biome === 'quiet-expanse') {
    clearColumnsIn(plan, hall.bounds);
    return;
  }

  if (biome === 'symmetric-gallery') {
    addSymmetricGallery(plan, hall);
    return;
  }

  if (biome === 'vertical-atrium') {
    addVerticalAtrium(plan, hall, seed);
    return;
  }

  if (biome === 'pillar-hall') {
    const rng = new SeededRandom(`${seed}::pillar-hall`);
    const center = rectCenter(hall.bounds);
    clearColumnsIn(plan, hall.bounds);
    const columnsX = Math.max(3, Math.min(9, Math.floor((rectWidth(hall.bounds) - 5) / 5.4)));
    const columnsZ = Math.max(3, Math.min(9, Math.floor((rectDepth(hall.bounds) - 5) / 5.4)));
    const added: typeof plan.columns = [];
    for (let xIndex = 0; xIndex < columnsX; xIndex += 1) {
      for (let zIndex = 0; zIndex < columnsZ; zIndex += 1) {
        const x = hall.bounds.minX + ((xIndex + 0.5) / columnsX) * rectWidth(hall.bounds);
        const z = hall.bounds.minZ + ((zIndex + 0.5) / columnsZ) * rectDepth(hall.bounds);
        if (Math.abs(x - center.x) < 1.65 || Math.abs(z - center.z) < 1.65) continue;
        added.push({
          x: quantize(x, 0.05),
          z: quantize(z, 0.05),
          width: 1.08,
          depth: 1.08,
          height: plan.wallHeight,
          tint: rng.float(0.88, 1.02),
        });
      }
    }
    for (const [index, column] of added.entries()) {
      plan.columns.push(column);
      plan.colliders.push({
        id: `biome-pillar-${index}`,
        center: { x: column.x, y: column.height * 0.5, z: column.z },
        halfExtents: { x: column.width * 0.5, y: column.height * 0.5, z: column.depth * 0.5 },
        kind: 'column',
      });
    }
    plan.lights = plan.lights.filter((light) => !added.some(
      (column) => Math.abs(light.x - column.x) < column.width * 0.5 + 0.55 && Math.abs(light.z - column.z) < column.depth * 0.5 + 0.55,
    ));
  }
};

export interface VerticalReservation {
  readonly bounds: Readonly<Rect>;
  readonly sourceStory: number;
  readonly remainingStories: number;
  readonly kind: 'tall-room';
}

const rectsOverlap = (left: Rect, right: Rect, padding = 0): boolean =>
  left.minX < right.maxX + padding &&
  left.maxX > right.minX - padding &&
  left.minZ < right.maxZ + padding &&
  left.maxZ > right.minZ - padding;

interface AtriumClaim {
  readonly bounds: Readonly<Rect>;
  readonly stories: number;
}

const rawAtriumClaimsCache = new Map<string, readonly AtriumClaim[]>();
const atriumClaimsCache = new Map<string, readonly AtriumClaim[]>();

const trimOldestCacheEntry = <T>(cache: Map<string, T>, maximum: number): void => {
  if (cache.size <= maximum) return;
  const oldest = cache.keys().next().value;
  if (oldest !== undefined) cache.delete(oldest);
};

const rawAtriumClaims = (
  seed: string,
  coord: Readonly<ChunkCoord>,
): readonly AtriumClaim[] => {
  const key = `${seed}::${createChunkKey(coord)}`;
  const cached = rawAtriumClaimsCache.get(key);
  if (cached) return cached;
  if (getInfiniteBiome(seed, coord) !== 'vertical-atrium') {
    const empty = Object.freeze([]) as readonly AtriumClaim[];
    rawAtriumClaimsCache.set(key, empty);
    trimOldestCacheEntry(rawAtriumClaimsCache, 192);
    return empty;
  }
  const chunkSeed = derivedChunkSeed(seed, createChunkKey(coord));
  const plan = generateWorld(chunkSeed);
  applyBiome(plan, 'vertical-atrium', chunkSeed);
  const claims = Object.freeze(
    plan.rooms
      .filter((room) => room.ceilingHeight > plan.wallHeight + 0.1)
      .map((room) => Object.freeze({
        bounds: Object.freeze(cloneRect(room.bounds)),
        stories: Math.max(
          1,
          Math.round((room.ceilingHeight - plan.wallHeight) / INFINITE_STORY_PITCH),
        ),
      })),
  );
  rawAtriumClaimsCache.set(key, claims);
  trimOldestCacheEntry(rawAtriumClaimsCache, 192);
  return claims;
};

const canonicalAtriumClaims = (
  seed: string,
  coord: Readonly<ChunkCoord>,
): readonly AtriumClaim[] => {
  const key = `${seed}::${createChunkKey(coord)}`;
  const cached = atriumClaimsCache.get(key);
  if (cached) return cached;
  // Lower candidates always win. Looking only at raw candidates in the two
  // stories they can span gives a local, deterministic rule with no recursive
  // chain and prevents two elevated volumes from carving each other apart.
  const blockers = [1, 2].flatMap((distance) =>
    rawAtriumClaims(seed, { ...coord, story: coord.story - distance })
      .filter((claim) => claim.stories >= distance),
  );
  const claims = Object.freeze(
    rawAtriumClaims(seed, coord).filter(
      (claim) => !blockers.some((blocker) => rectsOverlap(claim.bounds, blocker.bounds, 0.8)),
    ),
  );
  atriumClaimsCache.set(key, claims);
  trimOldestCacheEntry(atriumClaimsCache, 192);
  return claims;
};

export const verticalReservationsForChunk = (
  seed: string,
  key: ChunkKey | ChunkCoord,
): readonly VerticalReservation[] => {
  const coord = resolveCoord(key);
  const reservations: VerticalReservation[] = [];
  for (let distance = 1; distance <= 2; distance += 1) {
    const sourceCoord = { ...coord, story: coord.story - distance };
    for (const claim of canonicalAtriumClaims(seed, sourceCoord)) {
      if (claim.stories < distance) continue;
      reservations.push(Object.freeze({
        bounds: claim.bounds,
        sourceStory: sourceCoord.story,
        remainingStories: claim.stories - distance + 1,
        kind: 'tall-room' as const,
      }));
    }
  }
  return Object.freeze(reservations);
};

const floorCellsOutsideOpenings = (worldSize: number, openings: readonly Rect[]): Rect[] => {
  const half = worldSize * 0.5;
  const bounds: Rect = { minX: -half, minZ: -half, maxX: half, maxZ: half };
  const clipped = openings
    .map((opening): Rect => ({
      minX: Math.max(bounds.minX, opening.minX),
      minZ: Math.max(bounds.minZ, opening.minZ),
      maxX: Math.min(bounds.maxX, opening.maxX),
      maxZ: Math.min(bounds.maxZ, opening.maxZ),
    }))
    .filter((opening) => rectWidth(opening) > 0.05 && rectDepth(opening) > 0.05);
  const xValues = [...new Set([bounds.minX, bounds.maxX, ...clipped.flatMap((rect) => [rect.minX, rect.maxX])])]
    .sort((left, right) => left - right);
  const zValues = [...new Set([bounds.minZ, bounds.maxZ, ...clipped.flatMap((rect) => [rect.minZ, rect.maxZ])])]
    .sort((left, right) => left - right);
  const cells: Rect[] = [];
  for (let xIndex = 0; xIndex < xValues.length - 1; xIndex += 1) {
    for (let zIndex = 0; zIndex < zValues.length - 1; zIndex += 1) {
      const cell: Rect = {
        minX: xValues[xIndex]!,
        maxX: xValues[xIndex + 1]!,
        minZ: zValues[zIndex]!,
        maxZ: zValues[zIndex + 1]!,
      };
      const center = rectCenter(cell);
      if (!clipped.some((opening) => pointInRect(center.x, center.z, opening))) cells.push(cell);
    }
  }
  return cells;
};

const applyVerticalReservations = (
  plan: WorldPlan,
  reservations: readonly VerticalReservation[],
): void => {
  if (reservations.length === 0) return;
  const openings = reservations.map((reservation) => reservation.bounds);
  const intersectsReservation = (rect: Rect, padding = 0): boolean =>
    openings.some((opening) => rectsOverlap(rect, opening, padding));
  const wallBounds = (wall: WallSegment): Rect => {
    const halfLength = wall.length * 0.5;
    const halfThickness = wall.thickness * 0.5;
    return wall.orientation === 'x'
      ? {
          minX: wall.x - halfLength,
          maxX: wall.x + halfLength,
          minZ: wall.z - halfThickness,
          maxZ: wall.z + halfThickness,
        }
      : {
          minX: wall.x - halfThickness,
          maxX: wall.x + halfThickness,
          minZ: wall.z - halfLength,
          maxZ: wall.z + halfLength,
        };
  };

  const pitConflicted = plan.features.some(
    (feature) => feature.kind === 'grid-pit' && intersectsReservation(feature.bounds, 0.8),
  );
  if (pitConflicted) {
    plan.features = plan.features.filter((feature) => feature.kind !== 'grid-pit');
    plan.walls = plan.walls.filter((wall) => wall.bottom >= -1);
    plan.lights = plan.lights.filter((light) => light.level >= 0);
    plan.colliders = plan.colliders.filter(
      (collider) =>
        !collider.id.startsWith('lower-level-floor-') &&
        !collider.id.startsWith('shaft-') &&
        !collider.id.startsWith('abyss-') &&
        !collider.id.startsWith('collider-lower-wall-'),
    );
  }

  const removedWallIds = new Set<string>();
  plan.walls = plan.walls.filter((wall) => {
    const remove = wall.bottom >= -1 && intersectsReservation(wallBounds(wall), 0.08);
    if (remove) removedWallIds.add(wall.id);
    return !remove;
  });
  plan.columns = plan.columns.filter((column) => !intersectsReservation({
    minX: column.x - column.width * 0.5,
    maxX: column.x + column.width * 0.5,
    minZ: column.z - column.depth * 0.5,
    maxZ: column.z + column.depth * 0.5,
  }));
  plan.solidMasses = plan.solidMasses.filter((mass) => !intersectsReservation(mass.bounds));
  plan.lights = plan.lights.filter(
    (light) => light.level < 0 || !openings.some((opening) => pointInRect(light.x, light.z, opening, -0.8)),
  );
  plan.detailSockets = plan.detailSockets.filter(
    (socket) => !openings.some((opening) => pointInRect(socket.position.x, socket.position.z, opening, -0.6)),
  );
  plan.features = plan.features.filter(
    (feature) => feature.kind === 'impossible-vista' || !intersectsReservation(feature.bounds, 0.4),
  );
  plan.colliders = plan.colliders.filter((collider) => {
    if (collider.id.startsWith('floor-')) return false;
    if (removedWallIds.has(collider.id.replace(/^collider-/, ''))) return false;
    if (collider.center.y < -0.5) return true;
    const bounds: Rect = {
      minX: collider.center.x - collider.halfExtents.x,
      maxX: collider.center.x + collider.halfExtents.x,
      minZ: collider.center.z - collider.halfExtents.z,
      maxZ: collider.center.z + collider.halfExtents.z,
    };
    return !intersectsReservation(bounds);
  });

  const ownOpenings = plan.features.flatMap((feature): Rect[] =>
    feature.kind === 'grid-pit' ? feature.holes.map(cloneRect) : [],
  );
  plan.floorOpenings = [...ownOpenings, ...openings].map(cloneRect);
  plan.floorRects = floorCellsOutsideOpenings(plan.size, plan.floorOpenings);
  for (const [index, floor] of plan.floorRects.entries()) {
    plan.colliders.push({
      id: `floor-${index}`,
      center: {
        x: (floor.minX + floor.maxX) * 0.5,
        y: -0.12,
        z: (floor.minZ + floor.maxZ) * 0.5,
      },
      halfExtents: { x: rectWidth(floor) * 0.5, y: 0.12, z: rectDepth(floor) * 0.5 },
      kind: 'floor',
    });
  }

  for (const [reservationIndex, reservation] of reservations.entries()) {
    const bounds = reservation.bounds;
    const center = rectCenter(bounds);
    const sides = [
      { suffix: 'north', x: center.x, z: bounds.minZ, length: rectWidth(bounds), orientation: 'x' as const },
      { suffix: 'south', x: center.x, z: bounds.maxZ, length: rectWidth(bounds), orientation: 'x' as const },
      { suffix: 'west', x: bounds.minX, z: center.z, length: rectDepth(bounds), orientation: 'z' as const },
      { suffix: 'east', x: bounds.maxX, z: center.z, length: rectDepth(bounds), orientation: 'z' as const },
    ];
    for (const side of sides) {
      const wall: WallSegment = {
        id: `vertical-reservation-${reservationIndex}-${side.suffix}`,
        x: side.x,
        z: side.z,
        length: side.length,
        orientation: side.orientation,
        bottom: 0,
        height: plan.wallHeight,
        thickness: 0.34,
        tint: 0.9,
        collision: true,
        kind: 'plaster',
      };
      plan.walls.push(wall);
      plan.colliders.push(colliderForWall(wall));
    }
  }
};

export interface InheritedShaftOpening extends Rect {
  readonly sourceStory: number;
  readonly remainingStories: number;
}

export const inheritedShaftOpeningsForChunk = (
  seed: string,
  key: ChunkKey | ChunkCoord,
): readonly InheritedShaftOpening[] => {
  const coord = resolveCoord(key);
  const openings: InheritedShaftOpening[] = [];
  for (let distance = 1; distance <= 6; distance += 1) {
    const sourceCoord = { ...coord, story: coord.story + distance };
    const sourceKey = createChunkKey(sourceCoord);
    const sourceSeed = derivedChunkSeed(seed, sourceKey);
    if (!worldHasDeepShaft(sourceSeed)) continue;
    const sourcePlan = generateWorld(sourceSeed);
    const sourceReservations = verticalReservationsForChunk(seed, sourceCoord);
    for (const feature of sourcePlan.features) {
      if (feature.kind !== 'grid-pit') continue;
      if (sourceReservations.some((reservation) =>
        rectsOverlap(feature.bounds, reservation.bounds, 0.8)
      )) continue;
      for (const hole of feature.holes) {
        const stories = hole.stories ?? 1;
        if (stories <= distance) continue;
        openings.push(Object.freeze({
          ...cloneRect(hole),
          sourceStory: sourceCoord.story,
          remainingStories: stories - distance,
        }));
      }
    }
  }
  return Object.freeze(openings);
};

const applyInheritedShaftOpenings = (
  plan: WorldPlan,
  inherited: readonly InheritedShaftOpening[],
): void => {
  if (inherited.length === 0) return;
  const openings = inherited.map(cloneRect);
  const intersectsOpening = (rect: Rect, padding = 0): boolean =>
    openings.some((opening) => rectsOverlap(rect, opening, padding));
  const wallBounds = (wall: WallSegment): Rect => {
    const halfLength = wall.length * 0.5;
    const halfThickness = wall.thickness * 0.5;
    return wall.orientation === 'x'
      ? {
          minX: wall.x - halfLength,
          maxX: wall.x + halfLength,
          minZ: wall.z - halfThickness,
          maxZ: wall.z + halfThickness,
        }
      : {
          minX: wall.x - halfThickness,
          maxX: wall.x + halfThickness,
          minZ: wall.z - halfLength,
          maxZ: wall.z + halfLength,
        };
  };
  const removedWallIds = new Set<string>();
  plan.walls = plan.walls.filter((wall) => {
    const remove = wall.bottom >= -1 && intersectsOpening(wallBounds(wall), 0.06);
    if (remove) removedWallIds.add(wall.id);
    return !remove;
  });
  plan.columns = plan.columns.filter((column) => !intersectsOpening({
    minX: column.x - column.width * 0.5,
    maxX: column.x + column.width * 0.5,
    minZ: column.z - column.depth * 0.5,
    maxZ: column.z + column.depth * 0.5,
  }, 0.15));
  plan.solidMasses = plan.solidMasses.filter((mass) => !intersectsOpening(mass.bounds, 0.15));
  plan.lights = plan.lights.filter(
    (light) => light.level < 0 || !openings.some((opening) => pointInRect(light.x, light.z, opening, -0.8)),
  );
  plan.detailSockets = plan.detailSockets.filter(
    (socket) => !openings.some((opening) => pointInRect(socket.position.x, socket.position.z, opening, -0.6)),
  );
  plan.colliders = plan.colliders.filter((collider) => {
    if (collider.id.startsWith('floor-')) return false;
    if (removedWallIds.has(collider.id.replace(/^collider-/, ''))) return false;
    if (collider.center.y < -0.5) return true;
    return !intersectsOpening({
      minX: collider.center.x - collider.halfExtents.x,
      maxX: collider.center.x + collider.halfExtents.x,
      minZ: collider.center.z - collider.halfExtents.z,
      maxZ: collider.center.z + collider.halfExtents.z,
    });
  });

  plan.floorOpenings = [...(plan.floorOpenings ?? []), ...openings].map(cloneRect);
  plan.floorRects = floorCellsOutsideOpenings(plan.size, plan.floorOpenings);
  for (const [index, floor] of plan.floorRects.entries()) {
    plan.colliders.push({
      id: `floor-${index}`,
      center: {
        x: (floor.minX + floor.maxX) * 0.5,
        y: -0.12,
        z: (floor.minZ + floor.maxZ) * 0.5,
      },
      halfExtents: { x: rectWidth(floor) * 0.5, y: 0.12, z: rectDepth(floor) * 0.5 },
      kind: 'floor',
    });
  }

  for (const [openingIndex, opening] of openings.entries()) {
    const center = rectCenter(opening);
    const sides = [
      { suffix: 'north', x: center.x, z: opening.minZ, length: rectWidth(opening), orientation: 'x' as const },
      { suffix: 'south', x: center.x, z: opening.maxZ, length: rectWidth(opening), orientation: 'x' as const },
      { suffix: 'west', x: opening.minX, z: center.z, length: rectDepth(opening), orientation: 'z' as const },
      { suffix: 'east', x: opening.maxX, z: center.z, length: rectDepth(opening), orientation: 'z' as const },
    ];
    for (const side of sides) {
      const wall: WallSegment = {
        id: `inherited-shaft-${openingIndex}-${side.suffix}`,
        x: side.x,
        z: side.z,
        length: side.length,
        orientation: side.orientation,
        // Cover the outgoing plenum, the traversed room and the incoming
        // plenum. Only one story is mounted at a time, so this continuous
        // shell prevents a visible seam while crossing either midpoint.
        bottom: plan.wallHeight - INFINITE_STORY_PITCH,
        height: INFINITE_STORY_PITCH * 2 - plan.wallHeight,
        thickness: 0.12,
        tint: 0.84,
        collision: true,
        kind: 'plaster',
      };
      plan.walls.push(wall);
      plan.colliders.push(colliderForWall(wall));
    }
  }
};

const extractPitHoles = (plan: WorldPlan): Rect[] =>
  plan.features.flatMap((feature) =>
    feature.kind === 'grid-pit' ? feature.holes.map(cloneRect) : [],
  );

const floorOpeningsCache = new Map<string, readonly Readonly<Rect>[]>();

/**
 * Resolves the floor contract without recursively building the chunk above.
 * Only the raw pit, lower-atrium reservations and inherited deep shafts can
 * change a story's floor, so this stays deterministic and cheap to cache.
 */
const canonicalFloorOpeningsForChunk = (
  seed: string,
  key: ChunkKey | ChunkCoord,
): readonly Readonly<Rect>[] => {
  const coord = resolveCoord(key);
  const normalizedKey = createChunkKey(coord);
  const cacheKey = `${seed}::${normalizedKey}`;
  const cached = floorOpeningsCache.get(cacheKey);
  if (cached) return cached;

  const plan = generateWorld(derivedChunkSeed(seed, normalizedKey));
  const reservations = verticalReservationsForChunk(seed, coord);
  const pitConflicted = plan.features.some(
    (feature) =>
      feature.kind === 'grid-pit' &&
      reservations.some((reservation) => rectsOverlap(feature.bounds, reservation.bounds, 0.8)),
  );
  const openings = freezeRects([
    ...(pitConflicted ? [] : extractPitHoles(plan)),
    ...reservations.map((reservation) => cloneRect(reservation.bounds)),
    ...inheritedShaftOpeningsForChunk(seed, coord).map(cloneRect),
  ]);
  floorOpeningsCache.set(cacheKey, openings);
  if (floorOpeningsCache.size > 192) {
    const oldest = floorOpeningsCache.keys().next().value;
    if (oldest !== undefined) floorOpeningsCache.delete(oldest);
  }
  return openings;
};

const rectsEquivalent = (left: Rect, right: Rect): boolean =>
  Math.abs(left.minX - right.minX) <= 0.02 &&
  Math.abs(left.minZ - right.minZ) <= 0.02 &&
  Math.abs(left.maxX - right.maxX) <= 0.02 &&
  Math.abs(left.maxZ - right.maxZ) <= 0.02;

/**
 * A one-storey opening must reveal a clear landing zone below. The floor is
 * deliberately preserved, while walls, masses and props that could behave
 * like an accidental plug are removed from the vertical arrival volume.
 */
const applyCeilingLandingClearance = (
  plan: WorldPlan,
  ceilingOpenings: readonly Readonly<Rect>[],
): void => {
  const structuralVoids: Rect[] = [
    ...(plan.floorOpenings ?? []).map(cloneRect),
    ...plan.rooms
      .filter((room) => room.ceilingHeight > plan.wallHeight + 0.1)
      .map((room) => cloneRect(room.bounds)),
  ];
  const landings = ceilingOpenings
    .filter((opening) => !structuralVoids.some((voidRect) => rectsEquivalent(opening, voidRect)))
    .map(cloneRect);
  if (landings.length === 0) return;

  const intersectsLanding = (rect: Rect, padding = 0): boolean =>
    landings.some((landing) => rectsOverlap(rect, landing, padding));
  const wallBounds = (wall: WallSegment): Rect => {
    const halfLength = wall.length * 0.5;
    const halfThickness = wall.thickness * 0.5;
    return wall.orientation === 'x'
      ? {
          minX: wall.x - halfLength,
          maxX: wall.x + halfLength,
          minZ: wall.z - halfThickness,
          maxZ: wall.z + halfThickness,
        }
      : {
          minX: wall.x - halfThickness,
          maxX: wall.x + halfThickness,
          minZ: wall.z - halfLength,
          maxZ: wall.z + halfLength,
        };
  };

  const removedWallIds = new Set<string>();
  plan.walls = plan.walls.filter((wall) => {
    const protectedWall =
      wall.id.startsWith('vertical-reservation-') ||
      wall.id.startsWith('inherited-shaft-') ||
      wall.id.startsWith('vertical-atrium-');
    const remove =
      !protectedWall &&
      wall.bottom >= -1 &&
      wall.bottom < plan.wallHeight - 0.1 &&
      intersectsLanding(wallBounds(wall), 0.48);
    if (remove) removedWallIds.add(wall.id);
    return !remove;
  });
  plan.columns = plan.columns.filter((column) => !intersectsLanding({
    minX: column.x - column.width * 0.5,
    maxX: column.x + column.width * 0.5,
    minZ: column.z - column.depth * 0.5,
    maxZ: column.z + column.depth * 0.5,
  }, 0.48));
  plan.solidMasses = plan.solidMasses.filter(
    (mass) => !intersectsLanding(mass.bounds, 0.48),
  );
  plan.lights = plan.lights.filter(
    (light) =>
      light.level < 0 ||
      !landings.some((landing) => pointInRect(light.x, light.z, landing, 0.55)),
  );
  plan.detailSockets = plan.detailSockets.filter(
    (socket) =>
      !landings.some((landing) => pointInRect(socket.position.x, socket.position.z, landing, 0.55)),
  );
  plan.features = plan.features.filter(
    (feature) =>
      (feature.kind !== 'stair-socket' && feature.kind !== 'squeeze-view') ||
      !intersectsLanding(feature.bounds, 0.48),
  );
  plan.colliders = plan.colliders.filter((collider) => {
    if (collider.kind === 'floor' || collider.center.y < -0.5) return true;
    const protectedCollider =
      collider.id.startsWith('collider-vertical-reservation-') ||
      collider.id.startsWith('collider-inherited-shaft-') ||
      collider.id.startsWith('collider-vertical-atrium-');
    if (protectedCollider) return true;
    if (removedWallIds.has(collider.id.replace(/^collider-/, ''))) return false;
    return !intersectsLanding({
      minX: collider.center.x - collider.halfExtents.x,
      maxX: collider.center.x + collider.halfExtents.x,
      minZ: collider.center.z - collider.halfExtents.z,
      maxZ: collider.center.z + collider.halfExtents.z,
    }, 0.48);
  });

  // The upper source chunk is released at the shaft midpoint. A lightweight
  // collar keeps the remaining 2.66 m plenum readable when the player looks
  // back up, without retaining an entire extra 112 m storey.
  for (const [landingIndex, landing] of landings.entries()) {
    const center = rectCenter(landing);
    const sides = [
      { suffix: 'north', x: center.x, z: landing.minZ, length: rectWidth(landing), orientation: 'x' as const },
      { suffix: 'south', x: center.x, z: landing.maxZ, length: rectWidth(landing), orientation: 'x' as const },
      { suffix: 'west', x: landing.minX, z: center.z, length: rectDepth(landing), orientation: 'z' as const },
      { suffix: 'east', x: landing.maxX, z: center.z, length: rectDepth(landing), orientation: 'z' as const },
    ];
    for (const side of sides) {
      plan.walls.push({
        id: `ceiling-shaft-collar-${landingIndex}-${side.suffix}`,
        x: side.x,
        z: side.z,
        length: side.length,
        orientation: side.orientation,
        bottom: plan.wallHeight,
        height: INFINITE_STORY_PITCH - plan.wallHeight,
        thickness: 0.1,
        tint: 0.84,
        collision: false,
        kind: 'plaster',
      });
    }
  }
};

/**
 * Returns the apertures that a chunk renderer must cut into this story's
 * ceiling. They are the floor holes of the canonical chunk one story above.
 */
export const ceilingOpeningsForChunk = (
  seed: string,
  key: ChunkKey | ChunkCoord,
): readonly Readonly<Rect>[] => {
  const coord = resolveCoord(key);
  const aboveKey = createChunkKey({ ...coord, story: coord.story + 1 });
  return canonicalFloorOpeningsForChunk(seed, aboveKey);
};

const isBoundaryWall = (wall: WallSegment): boolean => {
  if (wall.orientation === 'x') {
    return Math.abs(Math.abs(wall.z) - HALF_CHUNK_SIZE) <= BOUNDARY_EPSILON;
  }
  return Math.abs(Math.abs(wall.x) - HALF_CHUNK_SIZE) <= BOUNDARY_EPSILON;
};

const boundaryWallStyle = (
  seed: string,
  coord: Readonly<ChunkCoord>,
  edge: ChunkEdge,
): { thickness: number; tint: number; kind: WallSegment['kind'] } => {
  const address = canonicalEdgeAddress(coord, edge);
  const rng = new SeededRandom(edgeAddressSeed(seed, address, 'material'));
  const thicknessRoll = rng.float();
  return {
    thickness: thicknessRoll < 0.08 ? 0.72 : thicknessRoll < 0.3 ? 0.42 : 0.22,
    tint: rng.float(0.84, 1.06),
    kind: rng.chance(0.14) ? 'plaster' : 'wallpaper',
  };
};

const colliderForWall = (wall: WallSegment): StaticCollider => {
  const alongX = wall.orientation === 'x';
  return {
    id: `collider-${wall.id}`,
    center: {
      x: wall.x,
      y: wall.bottom + wall.height * 0.5,
      z: wall.z,
    },
    halfExtents: {
      x: (alongX ? wall.length : wall.thickness) * 0.5,
      y: wall.height * 0.5,
      z: (alongX ? wall.thickness : wall.length) * 0.5,
    },
    kind: 'wall',
  };
};

const emitBoundary = (
  plan: WorldPlan,
  seed: string,
  coord: Readonly<ChunkCoord>,
  edge: ChunkEdge,
  gates: readonly EdgeGate[],
  level: 'upper' | 'lower',
): void => {
  const style = boundaryWallStyle(seed, coord, edge);
  const intervals = gates
    .map((gate) => ({
      min: Math.max(-HALF_CHUNK_SIZE, gate.offset - gate.width * 0.5),
      max: Math.min(HALF_CHUNK_SIZE, gate.offset + gate.width * 0.5),
    }))
    .sort((left, right) => left.min - right.min);
  const solidIntervals: Array<{ min: number; max: number }> = [];
  let cursor = -HALF_CHUNK_SIZE;
  for (const interval of intervals) {
    if (interval.min - cursor > 0.18) solidIntervals.push({ min: cursor, max: interval.min });
    cursor = Math.max(cursor, interval.max);
  }
  if (HALF_CHUNK_SIZE - cursor > 0.18) {
    solidIntervals.push({ min: cursor, max: HALF_CHUNK_SIZE });
  }

  const orientation: WallSegment['orientation'] = edge === 'north' || edge === 'south' ? 'x' : 'z';
  const fixed = edge === 'north' || edge === 'west' ? -HALF_CHUNK_SIZE : HALF_CHUNK_SIZE;
  for (const [index, interval] of solidIntervals.entries()) {
    const center = (interval.min + interval.max) * 0.5;
    const wall: WallSegment = {
      id: `infinite-boundary-${edge}-${level}-${index}`,
      x: orientation === 'x' ? center : fixed,
      z: orientation === 'z' ? center : fixed,
      length: interval.max - interval.min,
      orientation,
      bottom: level === 'upper' ? 0 : -INFINITE_STORY_PITCH,
      height: plan.wallHeight,
      thickness: style.thickness,
      tint: style.tint,
      collision: true,
      kind: style.kind,
    };
    plan.walls.push(wall);
    plan.colliders.push(colliderForWall(wall));
  }
};

const prefixFeature = (feature: WorldFeature, prefix: string): WorldFeature => {
  if (feature.kind === 'grid-pit') {
    return { ...feature, id: `${prefix}${feature.id}`, roomId: `${prefix}${feature.roomId}` };
  }
  if (feature.kind === 'stair-socket' || feature.kind === 'squeeze-view') {
    return { ...feature, id: `${prefix}${feature.id}`, roomId: `${prefix}${feature.roomId}` };
  }
  return { ...feature, id: `${prefix}${feature.id}` };
};

const prefixPlanIds = (plan: WorldPlan, key: ChunkKey): void => {
  const prefix = `chunk-${key}/`;
  plan.rooms = plan.rooms.map((room) => ({ ...room, id: `${prefix}${room.id}` }));
  plan.walls = plan.walls.map((wall) => ({ ...wall, id: `${prefix}${wall.id}` }));
  plan.solidMasses = plan.solidMasses.map((mass) => ({ ...mass, id: `${prefix}${mass.id}` }));
  plan.lights = plan.lights.map((light) => ({
    ...light,
    id: `${prefix}${light.id}`,
    roomId: `${prefix}${light.roomId}`,
  }));
  plan.features = plan.features.map((feature) => prefixFeature(feature, prefix));
  plan.detailSockets = plan.detailSockets.map((socket) => ({
    ...socket,
    id: `${prefix}${socket.id}`,
    roomId: `${prefix}${socket.roomId}`,
  }));
  plan.colliders = plan.colliders.map((collider) => ({
    ...collider,
    id: `${prefix}${collider.id}`,
  }));
};

const stripFiniteLandmarks = (plan: WorldPlan): void => {
  const vistaIds = new Set(
    plan.features
      .filter((feature) => feature.kind === 'impossible-vista')
      .map((feature) => feature.id),
  );
  const removedWallIds = new Set<string>();
  plan.walls = plan.walls.filter((wall) => {
    const remove = isBoundaryWall(wall);
    if (remove) removedWallIds.add(wall.id);
    return !remove;
  });
  plan.features = plan.features.filter((feature) => feature.kind !== 'impossible-vista');
  plan.lights = plan.lights.filter(
    (light) =>
      !light.id.startsWith('vista-light-') &&
      !vistaIds.has(light.roomId),
  );
  plan.colliders = plan.colliders.filter((collider) => {
    if (collider.id.startsWith('vista-')) return false;
    if (collider.id.startsWith('collider-')) {
      return !removedWallIds.has(collider.id.slice('collider-'.length));
    }
    return true;
  });
};

export const generateInfiniteChunk = (
  seed: string,
  key: ChunkKey | ChunkCoord,
): WorldPlan => {
  const coord = resolveCoord(key);
  const normalizedKey = createChunkKey(coord);
  const plan = generateWorld(derivedChunkSeed(seed, normalizedKey));
  if (Math.abs(plan.size - INFINITE_CHUNK_SIZE) > BOUNDARY_EPSILON) {
    throw new Error(
      `InfiniteWorld expects ${INFINITE_CHUNK_SIZE}m plans; generator returned ${plan.size}m.`,
    );
  }

  const biome = getInfiniteBiome(seed, coord);
  const activeBiome = biome === 'vertical-atrium' && canonicalAtriumClaims(seed, coord).length === 0
    ? 'classic-maze'
    : biome;
  applyBiome(plan, activeBiome, derivedChunkSeed(seed, normalizedKey));
  const verticalReservations = verticalReservationsForChunk(seed, coord);
  applyVerticalReservations(plan, verticalReservations);
  applyInheritedShaftOpenings(plan, inheritedShaftOpeningsForChunk(seed, coord));
  const ceilingOpenings = ceilingOpeningsForChunk(seed, coord);
  applyCeilingLandingClearance(plan, ceilingOpenings);
  // WeakMap metadata is runtime-only and is lost through a worker's structured
  // clone. Keeping this tiny contract in the plan prevents main-thread world
  // regeneration when WorldView asks which ceiling cells to remove.
  plan.ceilingOpenings = ceilingOpenings.map(cloneRect);
  stripFiniteLandmarks(plan);
  const edgeGates = getInfiniteEdgeGates(seed, coord);
  // A chunk owns exactly one full story. The compact geometry below its holes
  // is only a local preview and must never receive a second 112 m boundary.
  emitBoundary(plan, seed, coord, 'north', edgeGates.north, 'upper');
  emitBoundary(plan, seed, coord, 'west', edgeGates.west, 'upper');
  prefixPlanIds(plan, normalizedKey);

  attachInfiniteChunkMetadata(seed, plan, coord, biome, edgeGates);
  return plan;
};

export const attachInfiniteChunkMetadata = (
  seed: string,
  plan: WorldPlan,
  coordInput: ChunkCoord,
  knownBiome?: InfiniteBiome,
  knownEdgeGates?: InfiniteEdgeGates,
): InfiniteChunkMetadata => {
  const coord = resolveCoord(coordInput);
  const normalizedKey = createChunkKey(coord);
  let cachedCeilingOpenings: readonly Readonly<Rect>[] | undefined = plan.ceilingOpenings
    ? freezeRects(plan.ceilingOpenings)
    : undefined;
  const metadata: InfiniteChunkMetadata = Object.freeze({
    key: normalizedKey,
    coord: freezeCoord(coord),
    worldOffset: getChunkWorldOffset(coord),
    edgeGates: knownEdgeGates ?? getInfiniteEdgeGates(seed, coord),
    biome: knownBiome ?? getInfiniteBiome(seed, coord),
    get ceilingOpenings(): readonly Readonly<Rect>[] {
      cachedCeilingOpenings ??= ceilingOpeningsForChunk(seed, coord);
      return cachedCeilingOpenings;
    },
    wrapperVersion: WRAPPER_VERSION,
  });
  metadataByPlan.set(plan, metadata);
  return metadata;
};

export const getInfiniteChunkMetadata = (
  plan: WorldPlan,
): InfiniteChunkMetadata | undefined => metadataByPlan.get(plan);

export const getInfiniteChunkCeilingOpenings = (
  plan: WorldPlan,
): readonly Readonly<Rect>[] =>
  metadataByPlan.get(plan)?.ceilingOpenings ?? freezeRects(plan.ceilingOpenings ?? []);

export const isInfiniteChunkPlan = (plan: WorldPlan): boolean => metadataByPlan.has(plan);

export const getFloorOpenings = (plan: WorldPlan): readonly Readonly<Rect>[] =>
  freezeRects(
    plan.floorOpenings ?? plan.features.flatMap((feature): Rect[] =>
      feature.kind === 'grid-pit'
        ? (feature as GridPitFeature).holes.map(cloneRect)
        : [],
    ),
  );
