import {
  addStepColliders,
  generateWorld,
  lightPanelOverlapsRect,
  MAX_PIT_STORIES,
  worldMaxPitStories,
} from './generateWorld';
import { SeededRandom } from './SeededRandom';
import type {
  GridPitFeature,
  Rect,
  StaticCollider,
  StairSocketFeature,
  Vec3Data,
  WallSegment,
  WorldFeature,
  WorldPlan,
  VisualBiome,
} from './types';
import { pointInRect, rectArea, rectCenter, rectDepth, rectWidth } from './types';
import { getStairFloorOpening, getStairLandingClearance } from './StairLayout';

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
  | 'symmetric-gallery';

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
  readonly visualBiome: VisualBiome;
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

export const derivedChunkSeed = (seed: string, key: ChunkKey): string =>
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
    { value: 'quiet-expanse' as const, weight: 0.1 },
    { value: 'symmetric-gallery' as const, weight: 0.15 },
  ]);
};

/**
 * Visual palettes occupy 2x2 chunk regions so a biome reads as a place rather
 * than flickering at every doorway. The topology biome remains independent.
 */
export const getInfiniteVisualBiome = (
  seed: string,
  key: ChunkKey | ChunkCoord,
): VisualBiome => {
  const coord = resolveCoord(key);
  const macroX = Math.floor(coord.x / 2);
  const macroZ = Math.floor(coord.z / 2);
  if (macroX === 0 && macroZ === 0 && coord.story === 0) return 'yellow';
  const roll = new SeededRandom(
    `${seed}::infinite-visual-biome:v${WRAPPER_VERSION}:${macroX}:${macroZ}:${coord.story}`,
  ).float(0, 1);
  if (roll < 0.8) return 'yellow';
  return roll < 0.9 ? 'red' : 'white';
};

const applyVisualBiome = (
  plan: WorldPlan,
  visualBiome: VisualBiome,
  seed: string,
): void => {
  plan.visualBiome = visualBiome;
  if (visualBiome === 'yellow') return;

  const palette = visualBiome === 'red'
    ? [0xff160d, 0xe30b08, 0xff3218, 0xc60808]
    : [0xf7fbff, 0xeaf3ff, 0xffffff, 0xdfeeff];
  const rng = new SeededRandom(`${seed}::visual-light-palette:${visualBiome}`);
  for (const light of plan.lights) {
    light.color = rng.pick(palette);
    light.intensity *= visualBiome === 'red'
      ? rng.float(0.88, 1.04)
      : rng.float(1.02, 1.16);
  }
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

const addSymmetricGallery = (
  plan: WorldPlan,
  hall: WorldPlan['rooms'][number],
  seed: string,
): void => {
  clearInteriorWallsIn(plan, hall.bounds);
  clearColumnsIn(plan, hall.bounds);
  plan.features = plan.features.filter(
    (feature) => feature.kind !== 'squeeze-view' || feature.roomId !== hall.id,
  );
  const rng = new SeededRandom(`${seed}::symmetric-gallery`);
  const center = rectCenter(hall.bounds);
  const alongX = rectWidth(hall.bounds) >= rectDepth(hall.bounds);
  const spanMin = (alongX ? hall.bounds.minX : hall.bounds.minZ) + 1.4;
  const spanMax = (alongX ? hall.bounds.maxX : hall.bounds.maxZ) - 1.4;
  const span = spanMax - spanMin;
  const exitCount = Math.max(3, Math.min(9, Math.floor(span / rng.float(4.6, 7.2))));
  const gapWidth = Math.min(rng.float(2.2, 4), span / (exitCount + 1) * 0.56);
  const gapCenters = Array.from(
    { length: exitCount },
    (_, index) => spanMin + ((index + 1) / (exitCount + 1)) * span,
  );
  const corridorHalfWidth = Math.min(rng.float(3.1, 5.2), Math.max(2.2, (alongX
    ? rectDepth(hall.bounds)
    : rectWidth(hall.bounds)) * rng.float(0.1, 0.19)));

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

  // Mirrored return walls turn the side strips into paired bays and rooms
  // without ever closing the long central route.
  const crossSpan = alongX ? rectDepth(hall.bounds) : rectWidth(hall.bounds);
  const sideBandDepth = Math.max(0, crossSpan * 0.5 - corridorHalfWidth - 0.8);
  const bayPairs = sideBandDepth >= 2.4
    ? Math.max(1, Math.min(4, Math.floor(span / rng.float(14, 24))))
    : 0;
  for (let pairIndex = 0; pairIndex < bayPairs; pairIndex += 1) {
    const distance = span * ((pairIndex + 1) / (bayPairs + 1)) * 0.43;
    for (const alongSide of [-1, 1] as const) {
      const fixed = (alongX ? center.x : center.z) + alongSide * distance;
      for (const crossSide of [-1, 1] as const) {
        const crossCenter = (alongX ? center.z : center.x) +
          crossSide * (corridorHalfWidth + sideBandDepth * 0.46);
        const wall: WallSegment = {
          id: `symmetric-gallery-bay-${pairIndex}-${alongSide}-${crossSide}`,
          x: alongX ? fixed : crossCenter,
          z: alongX ? crossCenter : fixed,
          length: sideBandDepth * rng.float(0.62, 0.94),
          orientation: alongX ? 'z' : 'x',
          bottom: 0,
          height: plan.wallHeight,
          thickness: rng.chance(0.24) ? 0.42 : 0.24,
          tint: rng.float(0.91, 1.03),
          collision: true,
          kind: 'wallpaper',
        };
        plan.walls.push(wall);
        plan.colliders.push(colliderForWall(wall));
      }
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

const addTightThresholds = (
  plan: WorldPlan,
  hall: WorldPlan['rooms'][number],
  seed: string,
): void => {
  clearInteriorWallsIn(plan, hall.bounds);
  clearColumnsIn(plan, hall.bounds);
  plan.features = plan.features.filter(
    (feature) => feature.kind !== 'squeeze-view' || feature.roomId !== hall.id,
  );
  plan.lights = plan.lights.filter((light) => light.roomId !== hall.id);

  const rng = new SeededRandom(`${seed}::tight-thresholds`);
  const center = rectCenter(hall.bounds);
  const alongX = rectWidth(hall.bounds) >= rectDepth(hall.bounds);
  const longMin = (alongX ? hall.bounds.minX : hall.bounds.minZ) + 3.2;
  const longMax = (alongX ? hall.bounds.maxX : hall.bounds.maxZ) - 3.2;
  const shortMin = (alongX ? hall.bounds.minZ : hall.bounds.minX) + 0.55;
  const shortMax = (alongX ? hall.bounds.maxZ : hall.bounds.maxX) - 0.55;
  const longSpan = longMax - longMin;
  const shortSpan = shortMax - shortMin;
  if (longSpan < 8 || shortSpan < 6) return;

  const layerCount = Math.max(3, Math.min(9, Math.floor(longSpan / rng.float(6.5, 10.5))));
  const addSegment = (layer: number, segment: number, fixed: number, min: number, max: number): void => {
    if (max - min < 0.2) return;
    const wall: WallSegment = {
      id: `tight-threshold-${layer}-${segment}`,
      x: alongX ? fixed : (min + max) * 0.5,
      z: alongX ? (min + max) * 0.5 : fixed,
      length: max - min,
      orientation: alongX ? 'z' : 'x',
      bottom: 0,
      height: hall.ceilingHeight,
      thickness: rng.chance(0.18) ? 0.42 : 0.24,
      tint: rng.float(0.88, 1.03),
      collision: true,
      kind: 'wallpaper',
      detail: 'threshold',
    };
    plan.walls.push(wall);
    plan.colliders.push(colliderForWall(wall));
  };

  for (let layer = 0; layer < layerCount; layer += 1) {
    const fixed = longMin + ((layer + 0.5) / layerCount) * longSpan;
    const doubleGap = shortSpan >= 14 && (layer % 3 === 1 || rng.chance(0.16));
    const gapWidth = rng.float(1.85, Math.min(3.6, shortSpan * 0.24));
    const offset = doubleGap
      ? shortSpan * rng.float(0.18, 0.29)
      : (layer % 2 === 0 ? -1 : 1) * shortSpan * rng.float(0.12, 0.28);
    const gapCenters = doubleGap
      ? [shortMin + shortSpan * 0.5 - offset, shortMin + shortSpan * 0.5 + offset]
      : [shortMin + shortSpan * 0.5 + offset];
    const gaps = gapCenters
      .map((gapCenter) => ({ min: gapCenter - gapWidth * 0.5, max: gapCenter + gapWidth * 0.5 }))
      .sort((left, right) => left.min - right.min);
    let cursor = shortMin;
    for (const [gapIndex, gap] of gaps.entries()) {
      addSegment(layer, gapIndex, fixed, cursor, gap.min);
      cursor = gap.max;
    }
    addSegment(layer, gaps.length, fixed, cursor, shortMax);
  }

  const chamberCount = layerCount + 1;
  for (let index = 0; index < chamberCount; index += 1) {
    const along = longMin + (index / Math.max(1, chamberCount - 1)) * longSpan;
    plan.lights.push({
      id: `tight-threshold-light-${index}`,
      x: alongX ? along : center.x,
      z: alongX ? center.z : along,
      ceilingY: hall.ceilingHeight,
      rotation: alongX ? 0 : Math.PI * 0.5,
      width: 1.7,
      intensity: rng.float(0.92, 1.08),
      color: 0xfff8ce,
      dead: false,
      unstable: index % 4 === 3 && rng.chance(0.3),
      phase: index * 0.79,
      roomId: hall.id,
      level: 0,
    });
  }
};

const applyBiome = (plan: WorldPlan, biome: InfiniteBiome, seed: string): void => {
  const hall = [...plan.rooms]
    .filter((room) => room.kind === 'open-hall')
    .sort((a, b) => rectArea(b.bounds) - rectArea(a.bounds))[0];
  if (!hall) return;
  const hallPit = plan.features.find(
    (feature): feature is GridPitFeature =>
      feature.kind === 'grid-pit' && feature.roomId === hall.id,
  );

  if (biome === 'quiet-expanse') {
    clearInteriorWallsIn(plan, hall.bounds);
    plan.columns = [];
    plan.colliders = plan.colliders.filter((collider) => collider.kind !== 'column');
    plan.features = plan.features.filter(
      (feature) => feature.kind !== 'squeeze-view' || feature.roomId !== hall.id,
    );
    return;
  }

  if (biome === 'symmetric-gallery') {
    if (hallPit) return;
    addSymmetricGallery(plan, hall, seed);
    return;
  }

  if (biome === 'tight-threshold') {
    if (hallPit) return;
    addTightThresholds(plan, hall, seed);
    return;
  }

  if (biome === 'pillar-hall') {
    const rng = new SeededRandom(`${seed}::pillar-hall`);
    const center = rectCenter(hall.bounds);
    clearInteriorWallsIn(plan, hall.bounds);
    clearColumnsIn(plan, hall.bounds);
    plan.features = plan.features.filter(
      (feature) => feature.kind !== 'squeeze-view' || feature.roomId !== hall.id,
    );
    const profile = rng.weighted([
      { value: 'regular' as const, weight: 0.32 },
      { value: 'dense' as const, weight: 0.43 },
      { value: 'clustered' as const, weight: 0.25 },
    ]);
    const baseSpacingX = rng.float(
      profile === 'dense' ? 3.1 : profile === 'clustered' ? 4.2 : 5.4,
      profile === 'dense' ? 4.8 : profile === 'clustered' ? 7.4 : 8.2,
    );
    const baseSpacingZ = rng.float(
      profile === 'dense' ? 3.1 : profile === 'clustered' ? 4.2 : 5.4,
      profile === 'dense' ? 4.8 : profile === 'clustered' ? 7.4 : 8.2,
    );
    const columnsX = Math.max(2, Math.min(28, Math.floor((rectWidth(hall.bounds) - 3) / baseSpacingX)));
    const columnsZ = Math.max(2, Math.min(28, Math.floor((rectDepth(hall.bounds) - 3) / baseSpacingZ)));
    const added: typeof plan.columns = [];
    for (let xIndex = 0; xIndex < columnsX; xIndex += 1) {
      for (let zIndex = 0; zIndex < columnsZ; zIndex += 1) {
        if (added.length >= 360) break;
        const rowOffset = profile === 'clustered' && zIndex % 2 === 1 ? baseSpacingX * 0.34 : 0;
        const x = hall.bounds.minX +
          ((xIndex + 0.5) / columnsX) * rectWidth(hall.bounds) +
          rowOffset +
          rng.float(profile === 'clustered' ? -0.9 : -0.35, profile === 'clustered' ? 0.9 : 0.35);
        const z = hall.bounds.minZ +
          ((zIndex + 0.5) / columnsZ) * rectDepth(hall.bounds) +
          rng.float(profile === 'clustered' ? -0.9 : -0.35, profile === 'clustered' ? 0.9 : 0.35);
        if (!pointInRect(x, z, hall.bounds, 1.05)) continue;
        if (Math.abs(x - center.x) < 2.15 || Math.abs(z - center.z) < 2.15) continue;
        if (hallPit?.holes.some((hole) => pointInRect(x, z, hole, -1.25))) continue;
        if (profile === 'clustered' && rng.chance(0.2)) continue;
        const maximumScale = Math.min(
          profile === 'clustered' ? 2.8 : profile === 'dense' ? 1.8 : 2.25,
          0.9 + Math.min(rectWidth(hall.bounds), rectDepth(hall.bounds)) / 65,
        );
        const width = rng.float(profile === 'dense' ? 0.38 : 0.52, maximumScale);
        const depth = rng.float(profile === 'dense' ? 0.34 : 0.48, maximumScale * 1.12);
        added.push({
          x: quantize(x, 0.05),
          z: quantize(z, 0.05),
          width,
          depth,
          height: hall.ceilingHeight,
          tint: rng.float(0.88, 1.02),
          kind: 'column',
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

const rectsOverlap = (left: Rect, right: Rect, padding = 0): boolean =>
  left.minX < right.maxX + padding &&
  left.maxX > right.minX - padding &&
  left.minZ < right.maxZ + padding &&
  left.maxZ > right.minZ - padding;

/**
 * A vertical opening always wins over a locally raised ceiling. Keeping only
 * part of an upper shell made whole wall sections disappear; normalising the
 * complete room before any clipping preserves a continuous, textured shell.
 */
const demoteTallRoomsIntersecting = (
  plan: WorldPlan,
  openings: readonly Readonly<Rect>[],
): void => {
  if (openings.length === 0) return;
  const roomIds = new Set(
    plan.rooms
      .filter(
        (room) =>
          room.ceilingHeight > plan.wallHeight + 0.1 &&
          openings.some((opening) => rectsOverlap(room.bounds, opening, 0.08)),
      )
      .map((room) => room.id),
  );
  if (roomIds.size === 0) return;

  for (const room of plan.rooms) {
    if (roomIds.has(room.id)) room.ceilingHeight = plan.wallHeight;
  }
  const removedWallIds = new Set(
    plan.walls
      .filter((wall) => wall.detail === 'upper-shell' && wall.roomId && roomIds.has(wall.roomId))
      .map((wall) => wall.id),
  );
  plan.walls = plan.walls.filter((wall) => !removedWallIds.has(wall.id));
  plan.lights = plan.lights.map((light) =>
    roomIds.has(light.roomId) ? { ...light, ceilingY: plan.wallHeight } : light
  );
  plan.features = plan.features.filter(
    (feature) => feature.kind !== 'raised-zone' || !roomIds.has(feature.roomId),
  );
  plan.colliders = plan.colliders.filter((collider) => {
    if (removedWallIds.has(collider.id.replace(/^collider-/, ''))) return false;
    for (const roomId of roomIds) {
      if (
        collider.id === `raised-platform-${roomId}` ||
        collider.id === `raised-ramp-${roomId}`
      ) return false;
    }
    return true;
  });
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

export interface InheritedShaftOpening extends Rect {
  readonly sourceStory: number;
  readonly remainingStories: number;
}

const coalesceInheritedShaftOpenings = (
  claims: readonly InheritedShaftOpening[],
): InheritedShaftOpening[] => {
  const merged: InheritedShaftOpening[] = [];
  for (const claim of claims) {
    let candidate: InheritedShaftOpening = { ...claim };
    for (let index = merged.length - 1; index >= 0; index -= 1) {
      const existing = merged[index]!;
      if (!rectsOverlap(candidate, existing, 0.06)) continue;
      candidate = {
        minX: Math.min(candidate.minX, existing.minX),
        minZ: Math.min(candidate.minZ, existing.minZ),
        maxX: Math.max(candidate.maxX, existing.maxX),
        maxZ: Math.max(candidate.maxZ, existing.maxZ),
        sourceStory: Math.max(candidate.sourceStory, existing.sourceStory),
        remainingStories: Math.max(candidate.remainingStories, existing.remainingStories),
      };
      merged.splice(index, 1);
      // The union may now touch a claim visited earlier. Restarting makes the
      // result independent from the source order.
      index = merged.length;
    }
    merged.push(candidate);
  }
  return merged;
};

export const inheritedShaftOpeningsForChunk = (
  seed: string,
  key: ChunkKey | ChunkCoord,
): readonly InheritedShaftOpening[] => {
  const coord = resolveCoord(key);
  const openings: InheritedShaftOpening[] = [];
  for (let distance = 1; distance < MAX_PIT_STORIES; distance += 1) {
    const sourceCoord = { ...coord, story: coord.story + distance };
    const sourceKey = createChunkKey(sourceCoord);
    const sourceSeed = derivedChunkSeed(seed, sourceKey);
    if (worldMaxPitStories(sourceSeed) <= distance) continue;
    const sourcePlan = generateWorld(sourceSeed);
    for (const feature of sourcePlan.features) {
      if (feature.kind !== 'grid-pit') continue;
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
  return Object.freeze(
    coalesceInheritedShaftOpenings(openings).map((opening) => Object.freeze(opening)),
  );
};

const applyInheritedShaftOpenings = (
  plan: WorldPlan,
  inherited: readonly InheritedShaftOpening[],
): void => {
  if (inherited.length === 0) return;
  const localPits = plan.features.filter(
    (feature): feature is GridPitFeature => feature.kind === 'grid-pit',
  );
  const pitConflicted = localPits.some((feature) =>
    feature.holes.some((hole) =>
      inherited.some((opening) => rectsOverlap(hole, opening, 0.08))
    )
  );
  const combinedClaims = pitConflicted
    ? [
        ...inherited,
        ...localPits.flatMap((feature) =>
          feature.holes.map((hole): InheritedShaftOpening => ({
            ...cloneRect(hole),
            sourceStory: inherited[0]?.sourceStory ?? 0,
            remainingStories: hole.stories ?? 1,
          }))
        ),
      ]
    : [...inherited];
  const canonicalInherited = coalesceInheritedShaftOpenings(combinedClaims);
  const openings = canonicalInherited.map(cloneRect);
  demoteTallRoomsIntersecting(plan, openings);
  const continuingOpenings = canonicalInherited
    .filter((opening) => opening.remainingStories > 1)
    .map(cloneRect);
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
  plan.walls = plan.walls.filter((wall) => {
    const remove = intersectsOpening(wallBounds(wall), 0.06);
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
    (light) => !openings.some((opening) => lightPanelOverlapsRect(light, opening)),
  );
  plan.detailSockets = plan.detailSockets.filter(
    (socket) => !openings.some((opening) => pointInRect(socket.position.x, socket.position.z, opening, -0.6)),
  );
  plan.features = plan.features.filter(
    (feature) => feature.kind === 'impossible-vista' || !intersectsOpening(feature.bounds, 0.4),
  );
  plan.colliders = plan.colliders.filter((collider) => {
    if (collider.id.startsWith('floor-')) return false;
    if (removedWallIds.has(collider.id.replace(/^collider-/, ''))) return false;
    const bounds = {
      minX: collider.center.x - collider.halfExtents.x,
      maxX: collider.center.x + collider.halfExtents.x,
      minZ: collider.center.z - collider.halfExtents.z,
      maxZ: collider.center.z + collider.halfExtents.z,
    };
    if (collider.kind === 'floor' && collider.center.y < -0.5) {
      return !continuingOpenings.some((opening) => rectsOverlap(bounds, opening));
    }
    return !intersectsOpening(bounds);
  });

  plan.floorOpenings = (
    pitConflicted
      ? openings
      : [...(plan.floorOpenings ?? []), ...openings]
  ).map(cloneRect);
  plan.lowerPreviewOpenings = [
    ...(plan.lowerPreviewOpenings ?? []),
    ...continuingOpenings,
  ].map(cloneRect);
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
    const thickness = 0.12;
    const sides = [
      { suffix: 'north', x: center.x, z: opening.minZ - thickness * 0.5, length: rectWidth(opening), orientation: 'x' as const },
      { suffix: 'south', x: center.x, z: opening.maxZ + thickness * 0.5, length: rectWidth(opening), orientation: 'x' as const },
      { suffix: 'west', x: opening.minX - thickness * 0.5, z: center.z, length: rectDepth(opening), orientation: 'z' as const },
      { suffix: 'east', x: opening.maxX + thickness * 0.5, z: center.z, length: rectDepth(opening), orientation: 'z' as const },
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
        thickness,
        tint: 0.96,
        collision: true,
        kind: 'wallpaper',
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
 * Only the raw pit and inherited multi-storey shafts can change a story's
 * floor, so this stays deterministic and cheap to cache.
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
  const inherited = inheritedShaftOpeningsForChunk(seed, coord);
  const localOpenings = extractPitHoles(plan);
  const pitConflicted = localOpenings.some((hole) =>
    inherited.some((opening) => rectsOverlap(hole, opening, 0.08))
  );
  const floorClaims = coalesceInheritedShaftOpenings([
    ...inherited,
    ...(pitConflicted
      ? localOpenings.map((opening): InheritedShaftOpening => ({
          ...opening,
          sourceStory: coord.story,
          remainingStories: 1,
        }))
      : []),
  ]);
  const openings = freezeRects([
    ...(pitConflicted ? [] : localOpenings),
    ...floorClaims.map(cloneRect),
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
  demoteTallRoomsIntersecting(plan, ceilingOpenings);
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
    const protectedWall = wall.id.startsWith('inherited-shaft-');
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
      !landings.some((landing) => lightPanelOverlapsRect(light, landing)),
  );
  plan.detailSockets = plan.detailSockets.filter(
    (socket) =>
      !landings.some((landing) => pointInRect(socket.position.x, socket.position.z, landing, 0.55)),
  );
  plan.features = plan.features.filter(
    (feature) =>
      (
        feature.kind !== 'stair-socket' &&
        feature.kind !== 'squeeze-view' &&
        feature.kind !== 'raised-zone'
      ) ||
      !intersectsLanding(feature.bounds, 0.48),
  );
  plan.colliders = plan.colliders.filter((collider) => {
    if (collider.kind === 'floor' || collider.center.y < -0.5) return true;
    const protectedCollider = collider.id.startsWith('collider-inherited-shaft-');
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
        kind: 'wallpaper',
      });
    }
  }
};

const enforceUnlitZones = (plan: WorldPlan): void => {
  const zones = plan.unlitZones ?? [];
  if (zones.length === 0) return;
  for (const light of plan.lights) {
    if (
      light.level >= 0 &&
      zones.some((zone) => pointInRect(light.x, light.z, zone))
    ) light.dead = true;
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

const inheritedStairCache = new Map<string, StairSocketFeature | null>();
const rawLocalFloorOpeningsCache = new Map<string, readonly Readonly<Rect>[]>();

const rawLocalFloorOpeningsForChunk = (
  seed: string,
  key: ChunkKey | ChunkCoord,
): readonly Readonly<Rect>[] => {
  const coord = resolveCoord(key);
  const normalizedKey = createChunkKey(coord);
  const cacheKey = `${seed}::raw-local-floor-openings::${normalizedKey}`;
  const cached = rawLocalFloorOpeningsCache.get(cacheKey);
  if (cached) return cached;
  const plan = generateWorld(derivedChunkSeed(seed, normalizedKey));
  const openings = freezeRects(plan.floorOpenings ?? []);
  rawLocalFloorOpeningsCache.set(cacheKey, openings);
  if (rawLocalFloorOpeningsCache.size > 192) {
    const oldest = rawLocalFloorOpeningsCache.keys().next().value;
    if (oldest !== undefined) rawLocalFloorOpeningsCache.delete(oldest);
  }
  return openings;
};

export const inheritedStairForChunk = (
  seed: string,
  key: ChunkKey | ChunkCoord,
): StairSocketFeature | undefined => {
  const coord = resolveCoord(key);
  const normalizedKey = createChunkKey(coord);
  const cacheKey = `${seed}::inherited-stair::${normalizedKey}`;
  const cached = inheritedStairCache.get(cacheKey);
  if (cached !== undefined) return cached ?? undefined;

  const sourceCoord = { ...coord, story: coord.story - 1 };
  const sourceKey = createChunkKey(sourceCoord);
  const sourcePlan = generateWorld(derivedChunkSeed(seed, sourceKey));
  const sourceStair = sourcePlan.features.find(
    (feature): feature is StairSocketFeature =>
      feature.kind === 'stair-socket' && (feature.baseY ?? 0) === 0,
  );
  let inherited: StairSocketFeature | null = null;
  if (sourceStair) {
    const opening = getStairFloorOpening(sourceStair);
    const sourceOpenings = [
      ...canonicalFloorOpeningsForChunk(seed, sourceCoord),
      ...(sourcePlan.floorOpenings ?? []),
    ];
    const destinationOpenings = [
      ...canonicalFloorOpeningsForChunk(seed, coord),
      ...rawLocalFloorOpeningsForChunk(seed, coord),
    ];
    if (
      !sourceOpenings.some((candidate) => rectsOverlap(sourceStair.bounds, candidate, 0.45)) &&
      !destinationOpenings.some((candidate) =>
        rectsOverlap(opening, candidate, 0.12) && !rectsEquivalent(opening, candidate)
      )
    ) {
      inherited = {
        ...sourceStair,
        id: `inherited-${sourceKey}-${sourceStair.id}`,
        bounds: cloneRect(sourceStair.bounds),
        baseY: -INFINITE_STORY_PITCH,
        inherited: true,
      };
    }
  }
  inheritedStairCache.set(cacheKey, inherited);
  if (inheritedStairCache.size > 192) {
    const oldest = inheritedStairCache.keys().next().value;
    if (oldest !== undefined) inheritedStairCache.delete(oldest);
  }
  return inherited ?? undefined;
};

const removeLocalStairsBlockedAbove = (
  seed: string,
  coord: Readonly<ChunkCoord>,
  plan: WorldPlan,
): void => {
  const destinationCoord = { ...coord, story: coord.story + 1 };
  const destinationKey = createChunkKey(destinationCoord);
  const destinationOpenings = [
    ...canonicalFloorOpeningsForChunk(seed, destinationCoord),
    ...rawLocalFloorOpeningsForChunk(seed, destinationKey),
  ];
  const removedIds = new Set(
    plan.features
      .filter(
        (feature): feature is StairSocketFeature =>
          feature.kind === 'stair-socket' &&
          !feature.inherited &&
          destinationOpenings.some((opening) =>
            rectsOverlap(getStairFloorOpening(feature), opening, 0.12) &&
            !rectsEquivalent(getStairFloorOpening(feature), opening)
          ),
      )
      .map((feature) => feature.id),
  );
  if (removedIds.size === 0) return;
  plan.features = plan.features.filter(
    (feature) => feature.kind !== 'stair-socket' || !removedIds.has(feature.id),
  );
  plan.colliders = plan.colliders.filter(
    (collider) => ![...removedIds].some((id) => collider.id.startsWith(`${id}-`)),
  );
};

const applyInheritedStair = (
  plan: WorldPlan,
  stairs: StairSocketFeature | undefined,
): void => {
  if (!stairs) return;
  const opening = getStairFloorOpening(stairs);
  if ((plan.floorOpenings ?? []).some((candidate) => rectsOverlap(candidate, opening, 0.12))) {
    return;
  }
  const clearance = getStairLandingClearance(stairs);
  demoteTallRoomsIntersecting(plan, [clearance]);
  const intersectsClearance = (rect: Rect, padding = 0): boolean =>
    rectsOverlap(rect, clearance, padding);
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
    const remove = wall.bottom >= -0.2 && intersectsClearance(wallBounds(wall), 0.18);
    if (remove) removedWallIds.add(wall.id);
    return !remove;
  });
  plan.columns = plan.columns.filter((column) => !intersectsClearance({
    minX: column.x - column.width * 0.5,
    maxX: column.x + column.width * 0.5,
    minZ: column.z - column.depth * 0.5,
    maxZ: column.z + column.depth * 0.5,
  }, 0.2));
  plan.solidMasses = plan.solidMasses.filter(
    (mass) => !intersectsClearance(mass.bounds, 0.2),
  );
  plan.features = plan.features.filter(
    (feature) =>
      feature.kind === 'grid-pit' ||
      feature.kind === 'impossible-vista' ||
      !intersectsClearance(feature.bounds, 0.2),
  );
  plan.lights = plan.lights.filter(
    (light) => !lightPanelOverlapsRect(light, clearance),
  );
  plan.detailSockets = plan.detailSockets.filter(
    (socket) => !pointInRect(socket.position.x, socket.position.z, clearance, -0.45),
  );
  plan.colliders = plan.colliders.filter((collider) => {
    if (collider.id.startsWith('floor-')) return false;
    if (removedWallIds.has(collider.id.replace(/^collider-/, ''))) return false;
    if (collider.center.y < -0.45) return true;
    return !intersectsClearance({
      minX: collider.center.x - collider.halfExtents.x,
      maxX: collider.center.x + collider.halfExtents.x,
      minZ: collider.center.z - collider.halfExtents.z,
      maxZ: collider.center.z + collider.halfExtents.z,
    }, 0.12);
  });

  plan.floorOpenings = [...(plan.floorOpenings ?? []), opening].map(cloneRect);
  plan.floorRects = floorCellsOutsideOpenings(plan.size, plan.floorOpenings);
  for (const [index, floor] of plan.floorRects.entries()) {
    plan.colliders.push({
      id: `floor-${index}`,
      center: {
        x: (floor.minX + floor.maxX) * 0.5,
        y: -0.12,
        z: (floor.minZ + floor.maxZ) * 0.5,
      },
      halfExtents: {
        x: rectWidth(floor) * 0.5,
        y: 0.12,
        z: rectDepth(floor) * 0.5,
      },
      kind: 'floor',
    });
  }
  plan.features.push(stairs);
  addStepColliders(plan, stairs);
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
    kind: 'wallpaper',
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
  if (
    feature.kind === 'stair-socket' ||
    feature.kind === 'squeeze-view' ||
    feature.kind === 'raised-zone'
  ) {
    return { ...feature, id: `${prefix}${feature.id}`, roomId: `${prefix}${feature.roomId}` };
  }
  return { ...feature, id: `${prefix}${feature.id}` };
};

const prefixPlanIds = (plan: WorldPlan, key: ChunkKey): void => {
  const prefix = `chunk-${key}/`;
  plan.rooms = plan.rooms.map((room) => ({ ...room, id: `${prefix}${room.id}` }));
  plan.walls = plan.walls.map((wall) => ({
    ...wall,
    id: `${prefix}${wall.id}`,
    roomId: wall.roomId ? `${prefix}${wall.roomId}` : undefined,
  }));
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
  const visualBiome = getInfiniteVisualBiome(seed, coord);
  applyBiome(plan, biome, derivedChunkSeed(seed, normalizedKey));
  applyVisualBiome(plan, visualBiome, derivedChunkSeed(seed, normalizedKey));
  applyInheritedShaftOpenings(plan, inheritedShaftOpeningsForChunk(seed, coord));
  removeLocalStairsBlockedAbove(seed, coord, plan);
  const ceilingOpenings = ceilingOpeningsForChunk(seed, coord);
  applyCeilingLandingClearance(plan, ceilingOpenings);
  applyInheritedStair(plan, inheritedStairForChunk(seed, coord));
  plan.stairCeilingOpenings = plan.features
    .filter(
      (feature): feature is StairSocketFeature =>
        feature.kind === 'stair-socket' && !feature.inherited && (feature.baseY ?? 0) === 0,
    )
    .map((feature) => cloneRect(feature.bounds));
  enforceUnlitZones(plan);
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

  attachInfiniteChunkMetadata(seed, plan, coord, biome, edgeGates, visualBiome);
  return plan;
};

export const attachInfiniteChunkMetadata = (
  seed: string,
  plan: WorldPlan,
  coordInput: ChunkCoord,
  knownBiome?: InfiniteBiome,
  knownEdgeGates?: InfiniteEdgeGates,
  knownVisualBiome?: VisualBiome,
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
    visualBiome: knownVisualBiome ?? plan.visualBiome ?? getInfiniteVisualBiome(seed, coord),
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
