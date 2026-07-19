import { generateWorld } from './generateWorld';
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
export type InfiniteBiome = 'classic-maze' | 'pillar-hall' | 'tight-threshold' | 'quiet-expanse';

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
    { value: 'classic-maze' as const, weight: 0.58 },
    { value: 'tight-threshold' as const, weight: 0.2 },
    { value: 'pillar-hall' as const, weight: 0.14 },
    { value: 'quiet-expanse' as const, weight: 0.08 },
  ]);
};

const applyBiome = (plan: WorldPlan, biome: InfiniteBiome, seed: string): void => {
  const hall = [...plan.rooms]
    .filter((room) => room.kind === 'open-hall')
    .sort((a, b) => rectArea(b.bounds) - rectArea(a.bounds))[0];
  if (!hall) return;

  if (biome === 'quiet-expanse') {
    const removed = new Set(
      plan.colliders
        .filter((collider) => collider.kind === 'column' && pointInRect(collider.center.x, collider.center.z, hall.bounds))
        .map((collider) => collider.id),
    );
    plan.columns = plan.columns.filter((column) => !pointInRect(column.x, column.z, hall.bounds));
    plan.colliders = plan.colliders.filter((collider) => !removed.has(collider.id));
    return;
  }

  if (biome === 'pillar-hall') {
    const rng = new SeededRandom(`${seed}::pillar-hall`);
    const center = rectCenter(hall.bounds);
    const columnsX = Math.max(2, Math.min(5, Math.floor((rectWidth(hall.bounds) - 6) / 6.2)));
    const columnsZ = Math.max(2, Math.min(5, Math.floor((rectDepth(hall.bounds) - 6) / 6.2)));
    const added: typeof plan.columns = [];
    for (let xIndex = 0; xIndex < columnsX; xIndex += 1) {
      for (let zIndex = 0; zIndex < columnsZ; zIndex += 1) {
        const x = hall.bounds.minX + ((xIndex + 0.5) / columnsX) * rectWidth(hall.bounds);
        const z = hall.bounds.minZ + ((zIndex + 0.5) / columnsZ) * rectDepth(hall.bounds);
        if (Math.hypot(x - center.x, z - center.z) < 2.2 && (columnsX * columnsZ) % 2 === 1) continue;
        if (plan.columns.some((column) => Math.hypot(column.x - x, column.z - z) < 1.8)) continue;
        added.push({
          x: quantize(x, 0.05),
          z: quantize(z, 0.05),
          width: rng.float(0.92, 1.22),
          depth: rng.float(0.92, 1.22),
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

const extractPitHoles = (plan: WorldPlan): Rect[] =>
  plan.features.flatMap((feature) =>
    feature.kind === 'grid-pit' ? feature.holes.map(cloneRect) : [],
  );

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
  return freezeRects(extractPitHoles(generateWorld(derivedChunkSeed(seed, aboveKey))));
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
  applyBiome(plan, biome, derivedChunkSeed(seed, normalizedKey));
  stripFiniteLandmarks(plan);
  const edgeGates = getInfiniteEdgeGates(seed, coord);
  for (const level of ['upper', 'lower'] as const) {
    emitBoundary(plan, seed, coord, 'north', edgeGates.north, level);
    emitBoundary(plan, seed, coord, 'west', edgeGates.west, level);
  }
  prefixPlanIds(plan, normalizedKey);

  let cachedCeilingOpenings: readonly Readonly<Rect>[] | undefined;
  const metadata: InfiniteChunkMetadata = Object.freeze({
    key: normalizedKey,
    coord: freezeCoord(coord),
    worldOffset: getChunkWorldOffset(coord),
    edgeGates,
    biome,
    get ceilingOpenings(): readonly Readonly<Rect>[] {
      cachedCeilingOpenings ??= ceilingOpeningsForChunk(seed, coord);
      return cachedCeilingOpenings;
    },
    wrapperVersion: WRAPPER_VERSION,
  });
  metadataByPlan.set(plan, metadata);
  return plan;
};

export const getInfiniteChunkMetadata = (
  plan: WorldPlan,
): InfiniteChunkMetadata | undefined => metadataByPlan.get(plan);

export const getInfiniteChunkCeilingOpenings = (
  plan: WorldPlan,
): readonly Readonly<Rect>[] => metadataByPlan.get(plan)?.ceilingOpenings ?? Object.freeze([]);

export const isInfiniteChunkPlan = (plan: WorldPlan): boolean => metadataByPlan.has(plan);

export const getFloorOpenings = (plan: WorldPlan): readonly Readonly<Rect>[] =>
  freezeRects(
    plan.features.flatMap((feature): Rect[] =>
      feature.kind === 'grid-pit'
        ? (feature as GridPitFeature).holes.map(cloneRect)
        : [],
    ),
  );
