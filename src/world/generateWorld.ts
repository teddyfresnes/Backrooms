import { createDefaultFeatureRegistry } from './FeatureRegistry';
import { SeededRandom } from './SeededRandom';
import { getStairCollisionShapes, STAIR_STORY_RISE } from './StairLayout';
import type {
  GridPitFeature,
  LightSlot,
  PassageHole,
  PassageHump,
  PitHole,
  RaisedZoneFeature,
  Rect,
  RoomKind,
  RoomRecord,
  StairSocketFeature,
  StaticCollider,
  SurfaceStyle,
  VistaFeature,
  WallSegment,
  WorldPlan,
} from './types';
import { pointInRect, rectArea, rectCenter, rectDepth, rectWidth } from './types';

const GENERATOR_VERSION = 8;
const WORLD_SIZE = 112;
const WALL_HEIGHT = 2.74;
const WALL_THICKNESS = 0.22;
const MIN_ROOM_SPAN = 7;
const PIT_STORY_PITCH = 5.4;
export const MAX_PIT_STORIES = 12;
export const PIT_PRESENCE_RATE = 0.12;
export const UNLIT_ZONE_PRESENCE_RATE = 0.09;
const VISTA_LENGTH = 58;
const VISTA_WIDTH = 22;
const VISTA_HEIGHT = 9.5;

interface MutablePlan {
  walls: WallSegment[];
  rooms: RoomRecord[];
  colliders: StaticCollider[];
  portals: Array<{ x: number; z: number; orientation: 'x' | 'z'; width: number }>;
  wallIndex: number;
}

interface Gap {
  min: number;
  max: number;
}

const quantize = (value: number, step = 0.25): number => Math.round(value / step) * step;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const choosePitStoryDepth = (rng: SeededRandom): number => rng.weighted([
  { value: 1, weight: 0.31 },
  { value: 2, weight: 0.18 },
  { value: 3, weight: 0.13 },
  { value: 4, weight: 0.1 },
  { value: 5, weight: 0.075 },
  { value: 6, weight: 0.06 },
  { value: 7, weight: 0.045 },
  { value: 8, weight: 0.035 },
  { value: 9, weight: 0.025 },
  { value: 10, weight: 0.02 },
  { value: 11, weight: 0.012 },
  { value: 12, weight: 0.008 },
]);

export const worldHasPit = (seed: string): boolean => {
  const rootRng = new SeededRandom(`${seed}:v${GENERATOR_VERSION}`);
  return rootRng.fork('feature:grid-pit:presence').chance(PIT_PRESENCE_RATE);
};

export const worldMaxPitStories = (seed: string): number => {
  if (!worldHasPit(seed)) return 0;
  const rootRng = new SeededRandom(`${seed}:v${GENERATOR_VERSION}`);
  let stories = choosePitStoryDepth(rootRng.fork('feature:grid-pit:depth'));
  const voidRng = rootRng.fork('feature:grid-pit:void');
  if (voidRng.chance(0.055)) stories = Math.max(stories, voidRng.int(8, MAX_PIT_STORIES));
  return stories;
};

const addColliderForWall = (
  colliders: StaticCollider[],
  wall: WallSegment,
  id = `collider-${wall.id}`,
): void => {
  const alongX = wall.orientation === 'x';
  colliders.push({
    id,
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
    kind: wall.kind === 'vista-frame' ? 'barrier' : 'wall',
  });
};

const addWall = (
  plan: MutablePlan,
  rng: SeededRandom,
  input: Omit<WallSegment, 'id' | 'tint'> & { tint?: number },
): WallSegment | null => {
  if (input.length < 0.18 || input.height < 0.08) return null;
  const wall: WallSegment = {
    ...input,
    id: `wall-${plan.wallIndex++}`,
    tint: input.tint ?? rng.float(0.84, 1.08),
  };
  plan.walls.push(wall);
  if (wall.collision) addColliderForWall(plan.colliders, wall);
  return wall;
};

const normalizeGaps = (gaps: Gap[], min: number, max: number): Gap[] => {
  const sorted = gaps
    .map((gap) => ({ min: clamp(gap.min, min, max), max: clamp(gap.max, min, max) }))
    .filter((gap) => gap.max - gap.min > 0.2)
    .sort((a, b) => a.min - b.min);
  const merged: Gap[] = [];
  for (const gap of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && gap.min <= previous.max + 0.35) previous.max = Math.max(previous.max, gap.max);
    else merged.push({ ...gap });
  }
  return merged;
};

const wallAroundGaps = (
  plan: MutablePlan,
  rng: SeededRandom,
  orientation: 'x' | 'z',
  fixed: number,
  spanMin: number,
  spanMax: number,
  gaps: Gap[],
  kind: WallSegment['kind'] = 'wallpaper',
  thickness = WALL_THICKNESS,
): void => {
  const normalized = normalizeGaps(gaps, spanMin, spanMax);
  for (const gap of normalized) {
    if (gap.max - gap.min < 2) continue;
    plan.portals.push({
      x: orientation === 'x' ? (gap.min + gap.max) * 0.5 : fixed,
      z: orientation === 'z' ? (gap.min + gap.max) * 0.5 : fixed,
      orientation,
      width: gap.max - gap.min,
    });
  }
  let cursor = spanMin;
  for (const gap of normalized) {
    const length = gap.min - cursor;
    if (length > 0.18) {
      const center = (cursor + gap.min) * 0.5;
      addWall(plan, rng, {
        x: orientation === 'x' ? center : fixed,
        z: orientation === 'z' ? center : fixed,
        length,
        orientation,
        bottom: 0,
        height: WALL_HEIGHT,
        thickness,
        collision: true,
        kind,
      });
    }
    cursor = gap.max;
  }
  if (spanMax - cursor > 0.18) {
    const center = (cursor + spanMax) * 0.5;
    addWall(plan, rng, {
      x: orientation === 'x' ? center : fixed,
      z: orientation === 'z' ? center : fixed,
      length: spanMax - cursor,
      orientation,
      bottom: 0,
      height: WALL_HEIGHT,
      thickness,
      collision: true,
      kind,
    });
  }
};

const choosePartitionThickness = (rng: SeededRandom, span: number): number => {
  const roll = rng.float();
  if (span > 18 && roll < 0.035) return 1.1;
  if (roll < 0.11) return 0.72;
  if (roll < 0.31) return 0.42;
  return WALL_THICKNESS;
};

const subtractInterval = (
  intervals: Array<{ min: number; max: number }>,
  cutMin: number,
  cutMax: number,
): Array<{ min: number; max: number }> =>
  intervals.flatMap((interval) => {
    if (cutMax <= interval.min || cutMin >= interval.max) return [interval];
    const pieces: Array<{ min: number; max: number }> = [];
    if (cutMin - interval.min > 0.18) pieces.push({ min: interval.min, max: cutMin });
    if (interval.max - cutMax > 0.18) pieces.push({ min: cutMax, max: interval.max });
    return pieces;
  });

const enforcePortalClearances = (plan: MutablePlan): void => {
  const rebuilt: WallSegment[] = [];
  for (const wall of plan.walls) {
    // Portal lanes only describe walkable openings at floor level. Cutting an
    // elevated shell with those lanes leaves an unsupported hole above the
    // doorway, which is especially visible from neighbouring low rooms.
    if (wall.detail === 'upper-shell') {
      rebuilt.push(wall);
      continue;
    }
    const wallMin = (wall.orientation === 'x' ? wall.x : wall.z) - wall.length * 0.5;
    const wallMax = (wall.orientation === 'x' ? wall.x : wall.z) + wall.length * 0.5;
    let intervals = [{ min: wallMin, max: wallMax }];
    for (const portal of plan.portals) {
      if (portal.orientation === wall.orientation) continue;
      const laneHalfWidth = Math.max(0.52, portal.width * 0.5 - 0.34);
      const wallFixed = wall.orientation === 'x' ? wall.z : wall.x;
      const portalLaneCenter = portal.orientation === 'z' ? portal.z : portal.x;
      if (Math.abs(wallFixed - portalLaneCenter) > laneHalfWidth) continue;
      const approachCenter = portal.orientation === 'z' ? portal.x : portal.z;
      intervals = subtractInterval(intervals, approachCenter - 1.42, approachCenter + 1.42);
    }
    for (const interval of intervals) {
      const center = (interval.min + interval.max) * 0.5;
      rebuilt.push({
        ...wall,
        id: `wall-${plan.wallIndex++}`,
        x: wall.orientation === 'x' ? center : wall.x,
        z: wall.orientation === 'z' ? center : wall.z,
        length: interval.max - interval.min,
      });
    }
  }
  plan.walls = rebuilt;
  plan.colliders = plan.colliders.filter((collider) => !collider.id.startsWith('collider-wall-'));
  for (const wall of plan.walls) {
    if (wall.collision) addColliderForWall(plan.colliders, wall);
  }
};

const chooseRoomKind = (bounds: Rect, rng: SeededRandom): RoomKind => {
  const width = rectWidth(bounds);
  const depth = rectDepth(bounds);
  const aspect = Math.max(width / depth, depth / width);
  const area = rectArea(bounds);
  if (aspect >= 1.4 || (Math.min(width, depth) <= 8.25 && Math.max(width, depth) >= 11)) {
    return 'corridor';
  }
  if (area >= 480 && Math.min(width, depth) >= 15 && rng.chance(0.28)) return 'open-hall';
  if (area >= 175 && Math.min(width, depth) >= 10.5 && rng.chance(0.08)) return 'open-hall';
  return rng.weighted([
    { value: 'office' as const, weight: 5.5 },
    { value: 'nested' as const, weight: 3.2 },
    { value: 'threshold' as const, weight: 2.6 },
    { value: 'sparse' as const, weight: 0.35 },
  ]);
};

const partitionGaps = (
  rng: SeededRandom,
  spanMin: number,
  spanMax: number,
): Gap[] => {
  const span = spanMax - spanMin;
  const count = span >= 42
    ? rng.weighted([
        { value: 1, weight: 0.16 },
        { value: 2, weight: 0.5 },
        { value: 3, weight: 0.34 },
      ])
    : span >= 27
      ? (rng.chance(0.42) ? 2 : 1)
      : 1;
  const mirrored = count > 1 && rng.chance(0.72);
  const jitter = mirrored ? rng.float(-0.055, 0.055) : 0;
  const gaps: Gap[] = [];
  for (let index = 0; index < count; index += 1) {
    const evenLane = (index + 1) / (count + 1);
    const lane = mirrored
      ? evenLane + (index < count * 0.5 ? jitter : -jitter)
      : clamp(evenLane + rng.float(-0.12, 0.12), 0.14, 0.86);
    const center = quantize(spanMin + span * lane, 0.25);
    const width = rng.chance(0.14) ? rng.float(3.5, 5.2) : rng.float(2.15, 3.2);
    gaps.push({ min: center - width * 0.5, max: center + width * 0.5 });
  }
  return gaps;
};

const splitPartitions = (
  bounds: Rect,
  depth: number,
  path: string,
  rootRng: SeededRandom,
  plan: MutablePlan,
): void => {
  const rng = rootRng.fork(`partition:${path}`);
  const width = rectWidth(bounds);
  const roomDepth = rectDepth(bounds);
  const canSplitX = width >= MIN_ROOM_SPAN * 2 + 1;
  const canSplitZ = roomDepth >= MIN_ROOM_SPAN * 2 + 1;
  const shortSpan = Math.min(width, roomDepth);
  const longSpan = Math.max(width, roomDepth);
  const corridorLeaf = depth >= 2 && shortSpan <= 10.5 && longSpan >= 17 && longSpan <= 64;
  const compactLeaf = depth >= 4 && rectArea(bounds) <= 210 && longSpan <= 18;
  const broadLiminalLeaf = depth >= 3 && shortSpan >= 15 && rectArea(bounds) >= 480 && longSpan <= 48;
  const stopChance = corridorLeaf
    ? (longSpan >= 30 ? 0.9 : 0.76)
    : broadLiminalLeaf
      ? 0.2
      : compactLeaf
        ? 0.42 + Math.max(0, depth - 4) * 0.08
        : 0;

  if ((!canSplitX && !canSplitZ) || depth >= 9 || (stopChance > 0 && rng.chance(stopChance))) {
    const kind = chooseRoomKind(bounds, rng.fork('kind'));
    plan.rooms.push({
      id: `room-${path}`,
      bounds,
      kind,
      level: 0,
      ceilingHeight: WALL_HEIGHT,
      detailDensity: rng.float(0.25, 1),
    });
    return;
  }

  let splitX: boolean;
  if (!canSplitZ) splitX = true;
  else if (!canSplitX) splitX = false;
  else if (width > roomDepth * 1.22) splitX = true;
  else if (roomDepth > width * 1.22) splitX = false;
  else splitX = rng.chance(0.5);

  if (splitX) {
    const split = quantize(
      clamp(
        bounds.minX + width * rng.float(0.3, 0.7),
        bounds.minX + MIN_ROOM_SPAN,
        bounds.maxX - MIN_ROOM_SPAN,
      ),
      0.5,
    );
    const span = roomDepth;
    const gaps = partitionGaps(rng.fork('gaps'), bounds.minZ, bounds.maxZ);
    wallAroundGaps(
      plan,
      rng.fork('wall'),
      'z',
      split,
      bounds.minZ,
      bounds.maxZ,
      gaps,
      'wallpaper',
      choosePartitionThickness(rng.fork('thickness'), span),
    );
    splitPartitions({ ...bounds, maxX: split }, depth + 1, `${path}L`, rootRng, plan);
    splitPartitions({ ...bounds, minX: split }, depth + 1, `${path}R`, rootRng, plan);
  } else {
    const split = quantize(
      clamp(
        bounds.minZ + roomDepth * rng.float(0.3, 0.7),
        bounds.minZ + MIN_ROOM_SPAN,
        bounds.maxZ - MIN_ROOM_SPAN,
      ),
      0.5,
    );
    const span = width;
    const gaps = partitionGaps(rng.fork('gaps'), bounds.minX, bounds.maxX);
    wallAroundGaps(
      plan,
      rng.fork('wall'),
      'x',
      split,
      bounds.minX,
      bounds.maxX,
      gaps,
      'wallpaper',
      choosePartitionThickness(rng.fork('thickness'), span),
    );
    splitPartitions({ ...bounds, maxZ: split }, depth + 1, `${path}T`, rootRng, plan);
    splitPartitions({ ...bounds, minZ: split }, depth + 1, `${path}B`, rootRng, plan);
  }
};

const splitWorldWithGrandHall = (
  bounds: Rect,
  rootRng: SeededRandom,
  plan: MutablePlan,
): void => {
  const rng = rootRng.fork('grand-hall-reservation');
  const longAlongX = rng.chance(0.5);
  const shape = rng.weighted([
    { value: 'compact' as const, weight: 0.16 },
    { value: 'long' as const, weight: 0.34 },
    { value: 'broad' as const, weight: 0.29 },
    { value: 'monumental' as const, weight: 0.17 },
    { value: 'enormous' as const, weight: 0.04 },
  ]);
  const longRange = shape === 'compact'
    ? { min: 22, max: 38 }
    : shape === 'long'
      ? { min: 52, max: 88 }
      : shape === 'broad'
        ? { min: 34, max: 68 }
        : shape === 'monumental'
          ? { min: 68, max: 92 }
          : { min: 86, max: 95 };
  const crossRange = shape === 'compact'
    ? { min: 21, max: 30 }
    : shape === 'long'
      ? { min: 13, max: 25 }
      : shape === 'broad'
        ? { min: 29, max: 56 }
        : shape === 'monumental'
          ? { min: 32, max: 67 }
          : { min: 58, max: 82 };
  const minimumMargin = 8.5;
  const maximumWidth = rectWidth(bounds) - minimumMargin * 2;
  const maximumDepth = rectDepth(bounds) - minimumMargin * 2;
  const longSpan = quantize(
    Math.min(rng.float(longRange.min, longRange.max), longAlongX ? maximumWidth : maximumDepth),
    0.5,
  );
  const crossSpan = quantize(
    Math.min(rng.float(crossRange.min, crossRange.max), longAlongX ? maximumDepth : maximumWidth),
    0.5,
  );
  const hallWidth = longAlongX ? longSpan : crossSpan;
  const hallDepth = longAlongX ? crossSpan : longSpan;
  const centerLimitX = Math.max(
    0,
    (rectWidth(bounds) - hallWidth) * 0.5 - minimumMargin,
  );
  const centerLimitZ = Math.max(
    0,
    (rectDepth(bounds) - hallDepth) * 0.5 - minimumMargin,
  );
  const worldCenter = rectCenter(bounds);
  const hallCenter = {
    x: quantize(worldCenter.x + rng.float(-centerLimitX, centerLimitX), 0.5),
    z: quantize(worldCenter.z + rng.float(-centerLimitZ, centerLimitZ), 0.5),
  };
  const hall: Rect = {
    minX: hallCenter.x - hallWidth * 0.5,
    maxX: hallCenter.x + hallWidth * 0.5,
    minZ: hallCenter.z - hallDepth * 0.5,
    maxZ: hallCenter.z + hallDepth * 0.5,
  };

  const symmetricGaps = (
    min: number,
    max: number,
    pairCount: number,
    width: number,
  ): Gap[] => {
    const center = (min + max) * 0.5;
    const span = max - min;
    const gaps: Gap[] = [];
    for (let pair = 0; pair < pairCount; pair += 1) {
      const distance = span * (0.18 + pair * 0.19);
      for (const side of [-1, 1] as const) {
        const gapCenter = center + side * distance;
        gaps.push({ min: gapCenter - width * 0.5, max: gapCenter + width * 0.5 });
      }
    }
    return gaps;
  };
  const endGapWidth = rng.float(2.8, 5.4);
  const endGaps = crossSpan >= 34 && rng.chance(0.48)
    ? symmetricGaps(
        longAlongX ? hall.minZ : hall.minX,
        longAlongX ? hall.maxZ : hall.maxX,
        1,
        endGapWidth,
      )
    : [{
        min: (longAlongX ? hallCenter.z : hallCenter.x) - endGapWidth * 0.5,
        max: (longAlongX ? hallCenter.z : hallCenter.x) + endGapWidth * 0.5,
      }];
  const longMin = longAlongX ? hall.minX : hall.minZ;
  const longMax = longAlongX ? hall.maxX : hall.maxZ;
  const sidePairCount = longSpan >= 72 ? 3 : longSpan >= 42 ? 2 : 1;
  const sideGaps = symmetricGaps(longMin, longMax, sidePairCount, rng.float(2.35, 4.4));

  if (longAlongX) {
    wallAroundGaps(plan, rng.fork('north-hall-wall'), 'x', hall.minZ, hall.minX, hall.maxX, sideGaps, 'wallpaper', 0.42);
    wallAroundGaps(plan, rng.fork('south-hall-wall'), 'x', hall.maxZ, hall.minX, hall.maxX, sideGaps, 'wallpaper', 0.42);
    wallAroundGaps(plan, rng.fork('west-hall-wall'), 'z', hall.minX, hall.minZ, hall.maxZ, endGaps, 'wallpaper', 0.42);
    wallAroundGaps(plan, rng.fork('east-hall-wall'), 'z', hall.maxX, hall.minZ, hall.maxZ, endGaps, 'wallpaper', 0.42);
  } else {
    wallAroundGaps(plan, rng.fork('west-hall-wall'), 'z', hall.minX, hall.minZ, hall.maxZ, sideGaps, 'wallpaper', 0.42);
    wallAroundGaps(plan, rng.fork('east-hall-wall'), 'z', hall.maxX, hall.minZ, hall.maxZ, sideGaps, 'wallpaper', 0.42);
    wallAroundGaps(plan, rng.fork('north-hall-wall'), 'x', hall.minZ, hall.minX, hall.maxX, endGaps, 'wallpaper', 0.42);
    wallAroundGaps(plan, rng.fork('south-hall-wall'), 'x', hall.maxZ, hall.minX, hall.maxX, endGaps, 'wallpaper', 0.42);
  }

  plan.rooms.push({
    id: 'room-grand-hall',
    bounds: hall,
    kind: 'open-hall',
    level: 0,
    ceilingHeight: WALL_HEIGHT,
    detailDensity: rng.float(0.18, 0.42),
  });
  const surrounding = [
    { bounds: { ...bounds, maxX: hall.minX }, path: 'W' },
    { bounds: { ...bounds, minX: hall.maxX }, path: 'E' },
    {
      bounds: {
        minX: hall.minX,
        maxX: hall.maxX,
        minZ: bounds.minZ,
        maxZ: hall.minZ,
      },
      path: 'N',
    },
    {
      bounds: {
        minX: hall.minX,
        maxX: hall.maxX,
        minZ: hall.maxZ,
        maxZ: bounds.maxZ,
      },
      path: 'S',
    },
  ];
  for (const region of surrounding) {
    splitPartitions(region.bounds, 1, region.path, rootRng, plan);
  }
};

const buildGridPit = (
  room: RoomRecord,
  rng: SeededRandom,
  lowerBounds: Rect,
  dropStories: number,
  deepVoidRng?: SeededRandom,
): GridPitFeature => {
  const center = rectCenter(room.bounds);
  const roomArea = rectArea(room.bounds);
  const monumental = roomArea >= 430;
  const pattern = rng.weighted([
    { value: 'single' as const, weight: 0.025 },
    { value: 'small-grid' as const, weight: 0.3 },
    { value: 'large-grid' as const, weight: 0.27 },
    { value: 'dense-grid' as const, weight: monumental ? 0.24 : 0.19 },
    { value: 'mixed-grid' as const, weight: 0.025 },
    { value: 'large-cluster' as const, weight: monumental ? 0.075 : 0.045 },
  ]);
  const holes: PitHole[] = [];
  const dropDepth = PIT_STORY_PITCH;
  const margin = monumental ? 1.35 : 1.15;
  const usableWidth = Math.max(4.2, rectWidth(room.bounds) - margin * 2);
  const usableDepth = Math.max(4.2, rectDepth(room.bounds) - margin * 2);
  const roomFilling = rng.chance(0.82);
  const targetWidth = usableWidth * (roomFilling ? rng.float(0.78, 0.98) : rng.float(0.38, 0.7));
  const targetDepth = usableDepth * (roomFilling ? rng.float(0.78, 0.98) : rng.float(0.38, 0.7));
  let footprintWidth = targetWidth;
  let footprintDepth = targetDepth;

  const addRegularGrid = (
    holeWidth: number,
    holeDepth: number,
    preferredGapX: number,
    preferredGapZ: number,
    maximumColumns: number,
    maximumRows: number,
    skipChance: number,
  ): void => {
    holeWidth = Math.min(holeWidth, Math.max(0.9, (targetWidth - 0.45) * 0.5));
    holeDepth = Math.min(holeDepth, Math.max(0.9, (targetDepth - 0.45) * 0.5));
    const columns = clamp(
      Math.floor((targetWidth + preferredGapX) / (holeWidth + preferredGapX)),
      2,
      maximumColumns,
    );
    const rows = clamp(
      Math.floor((targetDepth + preferredGapZ) / (holeDepth + preferredGapZ)),
      2,
      maximumRows,
    );
    const gapX = Math.max(0.78, (targetWidth - holeWidth * columns) / Math.max(1, columns - 1));
    const gapZ = Math.max(0.78, (targetDepth - holeDepth * rows) / Math.max(1, rows - 1));
    footprintWidth = holeWidth * columns + gapX * (columns - 1);
    footprintDepth = holeDepth * rows + gapZ * (rows - 1);
    const originX = center.x - footprintWidth * 0.5;
    const originZ = center.z - footprintDepth * 0.5;
    for (let xIndex = 0; xIndex < columns; xIndex += 1) {
      for (let zIndex = 0; zIndex < rows; zIndex += 1) {
        const interior = xIndex > 0 && xIndex < columns - 1 && zIndex > 0 && zIndex < rows - 1;
        if (interior && rng.chance(skipChance)) continue;
        const minX = originX + xIndex * (holeWidth + gapX);
        const minZ = originZ + zIndex * (holeDepth + gapZ);
        holes.push({
          minX,
          maxX: minX + holeWidth,
          minZ,
          maxZ: minZ + holeDepth,
          depth: dropDepth,
        });
      }
    }
  };

  if (pattern === 'single') {
    const width = targetWidth;
    const depth = targetDepth;
    footprintWidth = width;
    footprintDepth = depth;
    holes.push({
      minX: center.x - width * 0.5,
      maxX: center.x + width * 0.5,
      minZ: center.z - depth * 0.5,
      maxZ: center.z + depth * 0.5,
      depth: dropDepth,
    });
  } else if (pattern === 'small-grid') {
    addRegularGrid(
      rng.float(1.05, 1.75),
      rng.float(1.05, 1.75),
      rng.float(0.45, 4.8),
      rng.float(0.45, 4.8),
      monumental ? 16 : 10,
      monumental ? 16 : 10,
      0.04,
    );
  } else if (pattern === 'large-grid') {
    addRegularGrid(
      rng.float(3.1, 7.4),
      rng.float(3.1, 7.4),
      rng.float(0.7, 5.8),
      rng.float(0.7, 5.8),
      monumental ? 11 : 7,
      monumental ? 11 : 7,
      0.07,
    );
  } else if (pattern === 'dense-grid') {
    addRegularGrid(
      rng.float(2.25, 4.8),
      rng.float(2.25, 4.8),
      rng.float(0.38, 1.2),
      rng.float(0.38, 1.2),
      monumental ? 16 : 9,
      monumental ? 16 : 9,
      0.025,
    );
  } else if (pattern === 'mixed-grid') {
    const pitchX = targetWidth / 3;
    const pitchZ = targetDepth / 3;
    const sizeX = pitchX * rng.float(0.34, 0.55);
    const sizeZ = pitchZ * rng.float(0.34, 0.55);
    footprintWidth = targetWidth;
    footprintDepth = targetDepth;
    const originX = center.x - targetWidth * 0.5;
    const originZ = center.z - targetDepth * 0.5;
    holes.push({
      minX: originX,
      maxX: originX + pitchX + sizeX,
      minZ: originZ,
      maxZ: originZ + pitchZ + sizeZ,
      depth: dropDepth,
    });
    for (const [xIndex, zIndex] of [[2, 0], [2, 1], [0, 2], [1, 2], [2, 2]] as const) {
      const minX = originX + xIndex * pitchX;
      const minZ = originZ + zIndex * pitchZ;
      holes.push({ minX, maxX: minX + sizeX, minZ, maxZ: minZ + sizeZ, depth: dropDepth });
    }
  } else {
    // An irregular cluster still uses one size family; only the gaps and a few
    // interior islands break the grid rhythm.
    addRegularGrid(
      rng.float(3.5, 7.8),
      rng.float(3.5, 7.8),
      rng.float(1.4, 7.2),
      rng.float(1.4, 7.2),
      monumental ? 10 : 6,
      monumental ? 10 : 6,
      0.22,
    );
  }

  // A large grid no longer repeats one twelve-storey shaft dozens of times.
  // One aperture carries the exceptional depth while its neighbours terminate
  // on varied, readable landings over the next few levels.
  const depthAnchor = holes.length > 0 ? rng.pick(holes) : undefined;
  const secondaryStories = new Map<PitHole, number>();
  if (dropStories > 1) {
    const secondaryCandidates = rng.shuffle(holes.filter((hole) => hole !== depthAnchor));
    const maximumSecondaryCount = Math.min(
      8,
      Math.max(1, Math.floor(Math.sqrt(secondaryCandidates.length))),
    );
    const secondaryCount = rng.int(0, maximumSecondaryCount);
    for (const hole of secondaryCandidates.slice(0, secondaryCount)) {
      secondaryStories.set(hole, rng.weighted([
        { value: 2, weight: 0.7 },
        { value: Math.min(3, dropStories), weight: 0.23 },
        { value: Math.min(4, dropStories), weight: 0.07 },
      ]));
    }
  }
  for (const hole of holes) {
    const stories = hole === depthAnchor
      ? dropStories
      : secondaryStories.get(hole) ?? 1;
    hole.kind = 'drop';
    hole.stories = stories;
    hole.depth = stories * dropDepth;
  }
  if (deepVoidRng) {
    const abyss = depthAnchor ??
      [...holes].sort((a, b) => rectWidth(b) * rectDepth(b) - rectWidth(a) * rectDepth(a))[0];
    if (abyss) {
      abyss.kind = 'void';
      abyss.stories = deepVoidRng.int(8, MAX_PIT_STORIES);
      abyss.depth = abyss.stories * dropDepth;
    }
  }

  const safeWidth = rectWidth(room.bounds) - 2.3;
  const safeDepth = rectDepth(room.bounds) - 2.3;
  const scale = Math.min(1, safeWidth / footprintWidth, safeDepth / footprintDepth);
  if (scale < 0.999) {
    for (const hole of holes) {
      hole.minX = center.x + (hole.minX - center.x) * scale;
      hole.maxX = center.x + (hole.maxX - center.x) * scale;
      hole.minZ = center.z + (hole.minZ - center.z) * scale;
      hole.maxZ = center.z + (hole.maxZ - center.z) * scale;
    }
    footprintWidth *= scale;
    footprintDepth *= scale;
  }

  // Rotate, mirror and offset every template. Repeated pattern names therefore
  // describe a family of silhouettes rather than one recognisable stamp.
  const rotate = footprintDepth <= safeWidth && footprintWidth <= safeDepth && rng.chance(0.5);
  const mirrorX = rng.chance(0.5) ? -1 : 1;
  const mirrorZ = rng.chance(0.5) ? -1 : 1;
  for (const hole of holes) {
    const corners = [
      [hole.minX - center.x, hole.minZ - center.z],
      [hole.minX - center.x, hole.maxZ - center.z],
      [hole.maxX - center.x, hole.minZ - center.z],
      [hole.maxX - center.x, hole.maxZ - center.z],
    ] as const;
    const transformed = corners.map(([x, z]) => ({
      x: rotate ? mirrorX * z : mirrorX * x,
      z: rotate ? mirrorZ * x : mirrorZ * z,
    }));
    hole.minX = center.x + Math.min(...transformed.map((point) => point.x));
    hole.maxX = center.x + Math.max(...transformed.map((point) => point.x));
    hole.minZ = center.z + Math.min(...transformed.map((point) => point.z));
    hole.maxZ = center.z + Math.max(...transformed.map((point) => point.z));
  }
  if (rotate) [footprintWidth, footprintDepth] = [footprintDepth, footprintWidth];

  const currentMinX = Math.min(...holes.map((hole) => hole.minX));
  const currentMaxX = Math.max(...holes.map((hole) => hole.maxX));
  const currentMinZ = Math.min(...holes.map((hole) => hole.minZ));
  const currentMaxZ = Math.max(...holes.map((hole) => hole.maxZ));
  const shiftMinX = room.bounds.minX + margin - currentMinX;
  const shiftMaxX = room.bounds.maxX - margin - currentMaxX;
  const shiftMinZ = room.bounds.minZ + margin - currentMinZ;
  const shiftMaxZ = room.bounds.maxZ - margin - currentMaxZ;
  const shiftX = shiftMinX <= shiftMaxX ? rng.float(shiftMinX, shiftMaxX) : (shiftMinX + shiftMaxX) * 0.5;
  const shiftZ = shiftMinZ <= shiftMaxZ ? rng.float(shiftMinZ, shiftMaxZ) : (shiftMinZ + shiftMaxZ) * 0.5;
  for (const hole of holes) {
    hole.minX = quantize(hole.minX + shiftX, 0.01);
    hole.maxX = quantize(hole.maxX + shiftX, 0.01);
    hole.minZ = quantize(hole.minZ + shiftZ, 0.01);
    hole.maxZ = quantize(hole.maxZ + shiftZ, 0.01);
  }

  const minHoleX = Math.min(...holes.map((hole) => hole.minX));
  const maxHoleX = Math.max(...holes.map((hole) => hole.maxX));
  const minHoleZ = Math.min(...holes.map((hole) => hole.minZ));
  const maxHoleZ = Math.max(...holes.map((hole) => hole.maxZ));

  const bounds: Rect = {
    minX: quantize(minHoleX - 0.72, 0.05),
    maxX: quantize(maxHoleX + 0.72, 0.05),
    minZ: quantize(minHoleZ - 0.72, 0.05),
    maxZ: quantize(maxHoleZ + 0.72, 0.05),
  };
  const previewPadding = clamp(
    Math.max(rectWidth(bounds), rectDepth(bounds)) * 0.2 + 3.2,
    4.5,
    8.5,
  );
  const previewBounds: Rect = {
    minX: Math.max(lowerBounds.minX, bounds.minX - previewPadding),
    maxX: Math.min(lowerBounds.maxX, bounds.maxX + previewPadding),
    minZ: Math.max(lowerBounds.minZ, bounds.minZ - previewPadding),
    maxZ: Math.min(lowerBounds.maxZ, bounds.maxZ + previewPadding),
  };
  return {
    kind: 'grid-pit',
    id: `grid-pit-${room.id}`,
    roomId: room.id,
    bounds,
    holes,
    depth: Math.max(...holes.map((hole) => hole.depth)),
    pattern,
    lowerBounds: previewBounds,
    lowerFloorY: -5.4,
    lowerCeilingY: -2.66,
  };
};

const floorCellsAroundHoles = (world: Rect, holes: PitHole[]): Rect[] => {
  const xValues = [...new Set([world.minX, world.maxX, ...holes.flatMap((hole) => [hole.minX, hole.maxX])])].sort(
    (a, b) => a - b,
  );
  const zValues = [...new Set([world.minZ, world.maxZ, ...holes.flatMap((hole) => [hole.minZ, hole.maxZ])])].sort(
    (a, b) => a - b,
  );
  const result: Rect[] = [];
  for (let xIndex = 0; xIndex < xValues.length - 1; xIndex += 1) {
    for (let zIndex = 0; zIndex < zValues.length - 1; zIndex += 1) {
      const rect = {
        minX: xValues[xIndex]!,
        maxX: xValues[xIndex + 1]!,
        minZ: zValues[zIndex]!,
        maxZ: zValues[zIndex + 1]!,
      };
      const center = rectCenter(rect);
      if (!holes.some((hole) => pointInRect(center.x, center.z, hole))) result.push(rect);
    }
  }
  return result;
};

const addOuterShellAndVista = (
  plan: MutablePlan,
  bounds: Rect,
  rng: SeededRandom,
): VistaFeature => {
  const apertureCenterZ = quantize(rng.float(bounds.minZ * 0.35, bounds.maxZ * 0.35), 0.5);
  const apertureWidth = 0.82;
  const openingBottom = 0.58;
  const openingHeight = 0.98;
  const sideGap: Gap = {
    min: apertureCenterZ - apertureWidth * 0.5,
    max: apertureCenterZ + apertureWidth * 0.5,
  };
  const standardEntryZ = apertureCenterZ + (rng.chance(0.5) ? 7.2 : -7.2);
  const standardEntryGap: Gap = { min: standardEntryZ - 1.35, max: standardEntryZ + 1.35 };

  wallAroundGaps(plan, rng.fork('north'), 'x', bounds.minZ, bounds.minX, bounds.maxX, []);
  wallAroundGaps(plan, rng.fork('south'), 'x', bounds.maxZ, bounds.minX, bounds.maxX, []);
  wallAroundGaps(plan, rng.fork('west'), 'z', bounds.minX, bounds.minZ, bounds.maxZ, []);
  wallAroundGaps(plan, rng.fork('east'), 'z', bounds.maxX, bounds.minZ, bounds.maxZ, [sideGap, standardEntryGap]);

  addWall(plan, rng.fork('sill'), {
    x: bounds.maxX,
    z: apertureCenterZ,
    length: apertureWidth,
    orientation: 'z',
    bottom: 0,
    height: openingBottom,
    thickness: WALL_THICKNESS,
    collision: false,
    kind: 'vista-frame',
    tint: 0.96,
  });
  addWall(plan, rng.fork('header'), {
    x: bounds.maxX,
    z: apertureCenterZ,
    length: apertureWidth,
    orientation: 'z',
    bottom: openingBottom + openingHeight,
    height: WALL_HEIGHT - openingBottom - openingHeight,
    thickness: WALL_THICKNESS,
    collision: false,
    kind: 'vista-frame',
    tint: 0.96,
  });

  plan.colliders.push({
    id: 'vista-aperture-barrier',
    center: { x: bounds.maxX, y: WALL_HEIGHT * 0.5, z: apertureCenterZ },
    halfExtents: { x: WALL_THICKNESS * 0.75, y: WALL_HEIGHT * 0.5, z: apertureWidth * 0.5 },
    kind: 'barrier',
  });

  const vistaMinX = bounds.maxX + 0.15;
  const vistaMaxX = vistaMinX + VISTA_LENGTH;
  const vistaBounds: Rect = {
    minX: vistaMinX,
    maxX: vistaMaxX,
    minZ: apertureCenterZ - VISTA_WIDTH * 0.5,
    maxZ: apertureCenterZ + VISTA_WIDTH * 0.5,
  };
  plan.colliders.push(
    {
      id: 'vista-floor',
      center: { x: (vistaMinX + vistaMaxX) * 0.5, y: -0.12, z: apertureCenterZ },
      halfExtents: { x: VISTA_LENGTH * 0.5, y: 0.12, z: VISTA_WIDTH * 0.5 },
      kind: 'floor',
    },
    {
      id: 'vista-entry-bridge',
      center: { x: (bounds.maxX + vistaMinX) * 0.5, y: -0.12, z: apertureCenterZ },
      halfExtents: { x: (vistaMinX - bounds.maxX) * 0.5, y: 0.12, z: VISTA_WIDTH * 0.5 },
      kind: 'floor',
    },
    {
      id: 'vista-upper-facade',
      center: {
        x: vistaMinX,
        y: WALL_HEIGHT + (VISTA_HEIGHT - WALL_HEIGHT) * 0.5,
        z: apertureCenterZ,
      },
      halfExtents: {
        x: 0.14,
        y: (VISTA_HEIGHT - WALL_HEIGHT) * 0.5,
        z: VISTA_WIDTH * 0.5,
      },
      kind: 'wall',
    },
    {
      id: 'vista-side-north',
      center: { x: (vistaMinX + vistaMaxX) * 0.5, y: VISTA_HEIGHT * 0.5, z: vistaBounds.minZ },
      halfExtents: { x: VISTA_LENGTH * 0.5, y: VISTA_HEIGHT * 0.5, z: 0.16 },
      kind: 'wall',
    },
    {
      id: 'vista-side-south',
      center: { x: (vistaMinX + vistaMaxX) * 0.5, y: VISTA_HEIGHT * 0.5, z: vistaBounds.maxZ },
      halfExtents: { x: VISTA_LENGTH * 0.5, y: VISTA_HEIGHT * 0.5, z: 0.16 },
      kind: 'wall',
    },
    {
      id: 'vista-end-wall',
      center: { x: vistaMaxX, y: VISTA_HEIGHT * 0.5, z: apertureCenterZ },
      halfExtents: { x: 0.16, y: VISTA_HEIGHT * 0.5, z: VISTA_WIDTH * 0.5 },
      kind: 'wall',
    },
  );
  for (let lane = -1; lane <= 1; lane += 2) {
    for (let index = 0; index < 7; index += 1) {
      const x = bounds.maxX + 5.5 + index * 7.1;
      plan.colliders.push({
        id: `vista-column-${lane}-${index}`,
        center: { x, y: VISTA_HEIGHT * 0.5, z: apertureCenterZ + lane * 6.3 },
        halfExtents: { x: 0.575, y: VISTA_HEIGHT * 0.5, z: 0.575 },
        kind: 'column',
      });
    }
  }

  return {
    kind: 'impossible-vista',
    id: 'impossible-vista-east',
    aperture: {
      minX: bounds.maxX - 0.2,
      maxX: bounds.maxX + 0.2,
      minZ: sideGap.min,
      maxZ: sideGap.max,
    },
    wallX: bounds.maxX,
    centerZ: apertureCenterZ,
    openingBottom,
    openingHeight,
    standardEntryZ,
    viewDirection: 1,
    bounds: vistaBounds,
    height: VISTA_HEIGHT,
    destination: { x: bounds.maxX + 2.25, y: 0.865, z: apertureCenterZ },
    returnDestination: { x: bounds.maxX - 1.35, y: 0.865, z: apertureCenterZ },
  };
};

const rectsOverlap = (left: Rect, right: Rect, padding = 0): boolean =>
  left.minX < right.maxX + padding &&
  left.maxX > right.minX - padding &&
  left.minZ < right.maxZ + padding &&
  left.maxZ > right.minZ - padding;

const addCeilingVariations = (
  plan: MutablePlan,
  world: WorldPlan,
  reservedRoomIds: Set<string>,
  rootRng: SeededRandom,
): void => {
  const rng = rootRng.fork('ceiling-variations');
  const profile = rng.weighted([
    { value: 'none' as const, weight: 0.27 },
    { value: 'pocket' as const, weight: 0.43 },
    { value: 'district' as const, weight: 0.24 },
    { value: 'cavernous' as const, weight: 0.06 },
  ]);
  if (profile === 'none') return;

  const elevated: RoomRecord[] = [];
  const half = world.size * 0.5;
  const insetCandidates = world.rooms.filter(
    (room) =>
      !reservedRoomIds.has(room.id) &&
      room.bounds.minX > -half + 0.85 &&
      room.bounds.minZ > -half + 0.85 &&
      room.bounds.maxX < half - 0.85 &&
      room.bounds.maxZ < half - 0.85,
  );
  if (insetCandidates.length === 0) return;
  const anchorPool = insetCandidates.filter(
    (room) => room.kind === 'open-hall' || room.kind === 'sparse' || rectArea(room.bounds) >= 180,
  );
  const availableAnchors = anchorPool.length > 0 ? anchorPool : insetCandidates;
  const anchor = profile === 'cavernous'
    ? [...availableAnchors].sort((left, right) => rectArea(right.bounds) - rectArea(left.bounds))[0]!
    : profile === 'district' && rng.chance(0.68)
      ? rng.pick(
          [...availableAnchors]
            .sort((left, right) => rectArea(right.bounds) - rectArea(left.bounds))
            .slice(0, Math.min(4, availableAnchors.length)),
        )
      : rng.pick(availableAnchors);
  const anchorCenter = rectCenter(anchor.bounds);
  const zoneRadius = profile === 'pocket'
    ? rng.float(18, 34)
    : profile === 'district'
      ? rng.float(34, 58)
      : rng.float(48, 82);
  const candidates = rng.shuffle(insetCandidates.filter((room) => {
    const center = rectCenter(room.bounds);
    return Math.hypot(center.x - anchorCenter.x, center.z - anchorCenter.z) <= zoneRadius;
  }));
  candidates.sort((left, right) => Number(right === anchor) - Number(left === anchor));
  const maximumElevated = profile === 'pocket'
    ? rng.int(1, 3)
    : profile === 'district'
      ? rng.int(3, 7)
      : rng.int(5, 10);
  for (const room of candidates) {
    if (elevated.length >= maximumElevated) break;
    const chance = room.kind === 'open-hall'
      ? 0.88
      : room.kind === 'sparse'
        ? 0.58
        : room.kind === 'corridor'
          ? 0.24
          : 0.19;
    if (room !== anchor && !rng.fork(`height:${room.id}`).chance(chance)) continue;
    if (elevated.some((other) => rectsOverlap(room.bounds, other.bounds, 0.18))) continue;
    const roomRng = rng.fork(`height-value:${room.id}`);
    const heightClass = room === anchor && profile === 'cavernous'
      ? 'cavernous'
      : roomRng.weighted([
          { value: 'raised' as const, weight: profile === 'pocket' ? 0.68 : 0.38 },
          { value: 'high' as const, weight: profile === 'pocket' ? 0.24 : 0.36 },
          { value: 'monumental' as const, weight: profile === 'cavernous' ? 0.3 : 0.2 },
          { value: 'cavernous' as const, weight: profile === 'cavernous' ? 0.2 : 0.06 },
        ]);
    room.ceilingHeight = quantize(
      heightClass === 'raised'
        ? roomRng.float(3.15, 3.8)
        : heightClass === 'high'
          ? roomRng.float(3.85, 4.45)
          : heightClass === 'monumental'
            ? roomRng.float(4.5, 4.9)
            : roomRng.float(4.95, 5.25),
      0.05,
    );
    elevated.push(room);
  }

  for (const room of elevated) {
    const center = rectCenter(room.bounds);
    const sides = [
      { x: center.x, z: room.bounds.minZ, length: rectWidth(room.bounds), orientation: 'x' as const },
      { x: center.x, z: room.bounds.maxZ, length: rectWidth(room.bounds), orientation: 'x' as const },
      { x: room.bounds.minX, z: center.z, length: rectDepth(room.bounds), orientation: 'z' as const },
      { x: room.bounds.maxX, z: center.z, length: rectDepth(room.bounds), orientation: 'z' as const },
    ];
    for (const [index, side] of sides.entries()) {
      const fixed = side.orientation === 'x' ? side.z : side.x;
      const sideMin = (side.orientation === 'x' ? side.x : side.z) - side.length * 0.5;
      const sideMax = (side.orientation === 'x' ? side.x : side.z) + side.length * 0.5;
      const supportingWalls = plan.walls.filter((wall) => {
        if (wall.bottom !== 0 || wall.orientation !== side.orientation) return false;
        const wallFixed = wall.orientation === 'x' ? wall.z : wall.x;
        const wallMin = (wall.orientation === 'x' ? wall.x : wall.z) - wall.length * 0.5;
        const wallMax = (wall.orientation === 'x' ? wall.x : wall.z) + wall.length * 0.5;
        return Math.abs(wallFixed - fixed) < 0.12 && wallMin < sideMax && wallMax > sideMin;
      });
      const tint = supportingWalls.length > 0
        ? supportingWalls.reduce((sum, wall) => sum + wall.tint, 0) / supportingWalls.length
        : 0.96;
      const thickness = supportingWalls.length > 0
        ? supportingWalls.reduce((sum, wall) => sum + wall.thickness, 0) / supportingWalls.length
        : WALL_THICKNESS;
      const shellBottom = WALL_HEIGHT - 0.04;
      addWall(plan, rng.fork(`upper-shell:${room.id}:${index}`), {
        ...side,
        roomId: room.id,
        bottom: shellBottom,
        height: room.ceilingHeight - shellBottom + 0.03,
        thickness: clamp(thickness, WALL_THICKNESS, 0.72),
        collision: true,
        tint,
        kind: 'wallpaper',
        detail: 'upper-shell',
      });
    }
  }
};

const addRaisedZones = (
  world: WorldPlan,
  reservedRoomIds: Set<string>,
  rootRng: SeededRandom,
): void => {
  const rng = rootRng.fork('feature:raised-zones');
  if (!rng.chance(0.68)) return;
  const candidates = rng.shuffle(world.rooms.filter(
    (room) =>
      !reservedRoomIds.has(room.id) &&
      rectWidth(room.bounds) >= 13 &&
      rectDepth(room.bounds) >= 10 &&
      Math.hypot(
        rectCenter(room.bounds).x - world.spawn.x,
        rectCenter(room.bounds).z - world.spawn.z,
      ) > 12,
  ));
  const targetCount = Math.min(
    candidates.length,
    rng.weighted([
      { value: 1, weight: 0.58 },
      { value: 2, weight: 0.31 },
      { value: 3, weight: 0.11 },
    ]),
  );
  for (let index = 0; index < targetCount; index += 1) {
    const room = candidates[index]!;
    const roomRng = rng.fork(room.id);
    const axis = roomRng.chance(0.7)
      ? (rectWidth(room.bounds) >= rectDepth(room.bounds) ? 'x' : 'z')
      : (rectWidth(room.bounds) >= rectDepth(room.bounds) ? 'z' : 'x');
    const riseDirection = roomRng.chance(0.5) ? 1 : -1;
    const alongMin = axis === 'x' ? room.bounds.minX : room.bounds.minZ;
    const alongMax = axis === 'x' ? room.bounds.maxX : room.bounds.maxZ;
    const crossMin = axis === 'x' ? room.bounds.minZ : room.bounds.minX;
    const crossMax = axis === 'x' ? room.bounds.maxZ : room.bounds.maxX;
    const alongSpan = alongMax - alongMin;
    const crossSpan = crossMax - crossMin;
    const tallRoom = room.ceilingHeight >= world.wallHeight + 0.45;
    const elevation = quantize(
      Math.min(
        room.ceilingHeight - 2.18,
        tallRoom ? roomRng.float(0.28, 1.55) : roomRng.float(0.15, 0.48),
      ),
      0.05,
    );
    if (elevation < 0.14) continue;
    const slopeAngle = roomRng.float(2.5, 27) * Math.PI / 180;
    const margin = roomRng.float(1.2, 2.15);
    const maximumRampRun = Math.min(18, Math.max(1.8, alongSpan - margin * 2 - 3.4));
    const longRamp = maximumRampRun >= 10 && roomRng.chance(0.32);
    const rampRun = quantize(
      longRamp
        ? roomRng.float(10, maximumRampRun)
        : clamp(elevation / Math.tan(slopeAngle), 1.8, maximumRampRun),
      0.05,
    );
    const platformLength = quantize(
      clamp(
        roomRng.float(alongSpan * 0.38, alongSpan * 0.74),
        3.4,
        alongSpan - rampRun - margin * 2,
      ),
      0.05,
    );
    if (platformLength < 3.2) continue;
    const crossWidth = quantize(
      clamp(roomRng.float(crossSpan * 0.55, crossSpan * 0.94), 3.4, crossSpan - margin * 2),
      0.05,
    );
    if (crossWidth < 3.2) continue;
    const crossCenter = roomRng.float(
      crossMin + margin + crossWidth * 0.5,
      crossMax - margin - crossWidth * 0.5,
    );
    const crossLow = quantize(crossCenter - crossWidth * 0.5, 0.05);
    const crossHigh = quantize(crossCenter + crossWidth * 0.5, 0.05);
    const highEdge = riseDirection > 0 ? alongMax - margin : alongMin + margin;
    const platformLow = riseDirection > 0 ? highEdge - platformLength : highEdge;
    const platformHigh = riseDirection > 0 ? highEdge : highEdge + platformLength;
    const rampLow = riseDirection > 0 ? platformLow - rampRun : platformHigh;
    const rampHigh = riseDirection > 0 ? platformLow : platformHigh + rampRun;
    const platformBounds: Rect = axis === 'x'
      ? { minX: platformLow, maxX: platformHigh, minZ: crossLow, maxZ: crossHigh }
      : { minX: crossLow, maxX: crossHigh, minZ: platformLow, maxZ: platformHigh };
    const rampBounds: Rect = axis === 'x'
      ? { minX: rampLow, maxX: rampHigh, minZ: crossLow, maxZ: crossHigh }
      : { minX: crossLow, maxX: crossHigh, minZ: rampLow, maxZ: rampHigh };
    const bounds: Rect = {
      minX: Math.min(platformBounds.minX, rampBounds.minX),
      maxX: Math.max(platformBounds.maxX, rampBounds.maxX),
      minZ: Math.min(platformBounds.minZ, rampBounds.minZ),
      maxZ: Math.max(platformBounds.maxZ, rampBounds.maxZ),
    };
    const feature: RaisedZoneFeature = {
      kind: 'raised-zone',
      id: `raised-zone-${room.id}`,
      roomId: room.id,
      bounds,
      platformBounds,
      elevation,
      ramp: {
        bounds: rampBounds,
        axis,
        riseDirection,
      },
    };
    world.features.push(feature);

    world.colliders.push({
      id: `raised-platform-${room.id}`,
      center: {
        x: rectCenter(platformBounds).x,
        y: (elevation - 0.12) * 0.5,
        z: rectCenter(platformBounds).z,
      },
      halfExtents: {
        x: rectWidth(platformBounds) * 0.5,
        y: (elevation + 0.12) * 0.5,
        z: rectDepth(platformBounds) * 0.5,
      },
      kind: 'floor',
    });

    const slopeLength = Math.hypot(rampRun, elevation);
    const signedAngle = Math.atan2(elevation, rampRun) * riseDirection;
    const halfThickness = 0.08;
    const quaternion = axis === 'x'
      ? {
          x: 0,
          y: 0,
          z: Math.sin(signedAngle * 0.5),
          w: Math.cos(signedAngle * 0.5),
        }
      : {
          x: Math.sin(-signedAngle * 0.5),
          y: 0,
          z: 0,
          w: Math.cos(signedAngle * 0.5),
        };
    world.colliders.push({
      id: `raised-ramp-${room.id}`,
      center: {
        x: rectCenter(rampBounds).x,
        y: elevation * 0.5 - Math.cos(signedAngle) * halfThickness,
        z: rectCenter(rampBounds).z,
      },
      halfExtents: axis === 'x'
        ? { x: slopeLength * 0.5, y: halfThickness, z: crossWidth * 0.5 }
        : { x: crossWidth * 0.5, y: halfThickness, z: slopeLength * 0.5 },
      rotation: quaternion,
      kind: 'floor',
    });
    reservedRoomIds.add(room.id);
  }
};

const portalNear = (plan: MutablePlan, x: number, z: number, radius: number): boolean =>
  plan.portals.some((portal) => Math.hypot(portal.x - x, portal.z - z) < radius);

type PilasterProfile = 'none' | 'sparse' | 'regular' | 'dense' | 'clustered';

const addPilasterSeries = (
  plan: MutablePlan,
  world: WorldPlan,
  room: RoomRecord,
  rng: SeededRandom,
  profile: Exclude<PilasterProfile, 'none'>,
): void => {
  const longX = rectWidth(room.bounds) >= rectDepth(room.bounds);
  const span = longX ? rectWidth(room.bounds) : rectDepth(room.bounds);
  if (span < 12) return;
  const spacing = profile === 'sparse'
    ? rng.float(9, 15)
    : profile === 'regular'
      ? rng.float(5.8, 10)
      : profile === 'dense'
        ? rng.float(2.2, 4.1)
        : rng.float(3.2, 6.8);
  const bothSides = rng.chance(
    profile === 'dense'
      ? 0.82
      : profile === 'clustered'
        ? 0.68
        : room.kind === 'corridor'
          ? 0.62
          : 0.32,
  );
  const firstSide = rng.chance(0.5) ? -1 : 1;
  const sides = bothSides ? [-1, 1] as const : [firstSide] as const;
  const basePositions: number[] = [];
  let cursor = -span * 0.5 + rng.float(0.7, spacing);
  while (cursor <= span * 0.5 - 0.7 && basePositions.length < 36) {
    if (profile === 'clustered') {
      const clusterSize = rng.int(2, 4);
      const clusterSpacing = rng.float(0.65, 1.45);
      for (let member = 0; member < clusterSize; member += 1) {
        const along = cursor + (member - (clusterSize - 1) * 0.5) * clusterSpacing;
        if (Math.abs(along) <= span * 0.5 - 0.6) basePositions.push(along);
      }
      cursor += spacing * rng.float(1.15, 1.85);
    } else {
      basePositions.push(cursor + rng.float(-spacing * 0.18, spacing * 0.18));
      cursor += spacing * rng.float(0.78, 1.24);
    }
  }
  for (const side of sides) {
    for (const along of basePositions) {
      const width = rng.float(
        profile === 'dense' ? 0.3 : 0.42,
        profile === 'clustered' ? 1.45 : profile === 'dense' ? 1.15 : 0.9,
      );
      const projection = rng.float(
        profile === 'dense' ? 0.22 : 0.28,
        profile === 'clustered' ? 0.92 : 0.68,
      );
      const x = longX
        ? rectCenter(room.bounds).x + along
        : (side < 0 ? room.bounds.minX + projection * 0.5 : room.bounds.maxX - projection * 0.5);
      const z = longX
        ? (side < 0 ? room.bounds.minZ + projection * 0.5 : room.bounds.maxZ - projection * 0.5)
        : rectCenter(room.bounds).z + along;
      if (portalNear(plan, x, z, 1.35)) continue;
      const column = {
        x: quantize(x, 0.05),
        z: quantize(z, 0.05),
        width: longX ? width : projection,
        depth: longX ? projection : width,
        height: room.ceilingHeight,
        tint: rng.float(0.86, 1.04),
        kind: 'pilaster' as const,
      };
      world.columns.push(column);
      plan.colliders.push({
        id: `pilaster-${world.columns.length - 1}`,
        center: { x: column.x, y: column.height * 0.5, z: column.z },
        halfExtents: { x: column.width * 0.5, y: column.height * 0.5, z: column.depth * 0.5 },
        kind: 'column',
      });
    }
  }
};

const addWallRecess = (
  plan: MutablePlan,
  room: RoomRecord,
  rng: SeededRandom,
): void => {
  const longX = rectWidth(room.bounds) >= rectDepth(room.bounds);
  const sideCandidates: Array<{ orientation: 'x' | 'z'; fixed: number; outward: number }> = longX
    ? [
        { orientation: 'x' as const, fixed: room.bounds.minZ, outward: -1 },
        { orientation: 'x' as const, fixed: room.bounds.maxZ, outward: 1 },
      ]
    : [
        { orientation: 'z' as const, fixed: room.bounds.minX, outward: -1 },
        { orientation: 'z' as const, fixed: room.bounds.maxX, outward: 1 },
      ];
  const side = rng.pick(sideCandidates);
  if (Math.abs(side.fixed) > WORLD_SIZE * 0.5 - 1.4) return;
  const roomMin = side.orientation === 'x' ? room.bounds.minX : room.bounds.minZ;
  const roomMax = side.orientation === 'x' ? room.bounds.maxX : room.bounds.maxZ;
  const candidates = plan.walls.filter((wall) => {
    if (wall.orientation !== side.orientation || wall.bottom !== 0 || wall.height < WALL_HEIGHT - 0.1) return false;
    const fixed = wall.orientation === 'x' ? wall.z : wall.x;
    const wallMin = (wall.orientation === 'x' ? wall.x : wall.z) - wall.length * 0.5;
    const wallMax = (wall.orientation === 'x' ? wall.x : wall.z) + wall.length * 0.5;
    return Math.abs(fixed - side.fixed) < 0.08 &&
      Math.min(wallMax, roomMax - 0.8) - Math.max(wallMin, roomMin + 0.8) >= 3.2;
  });
  if (candidates.length === 0) return;
  const source = [...candidates].sort((a, b) => b.length - a.length)[0]!;
  const sourceMin = (source.orientation === 'x' ? source.x : source.z) - source.length * 0.5;
  const sourceMax = (source.orientation === 'x' ? source.x : source.z) + source.length * 0.5;
  const usableMin = Math.max(sourceMin, roomMin + 0.8);
  const usableMax = Math.min(sourceMax, roomMax - 0.8);
  const width = Math.min(rng.float(1.6, 3.8), usableMax - usableMin - 0.4);
  if (width < 1.25) return;
  const center = rng.float(usableMin + width * 0.5, usableMax - width * 0.5);
  const openingMin = center - width * 0.5;
  const openingMax = center + width * 0.5;
  const depth = rng.float(0.48, 1.05);
  const fixed = side.fixed;
  const backFixed = fixed + side.outward * depth;

  plan.walls = plan.walls.filter((wall) => wall !== source);
  plan.colliders = plan.colliders.filter((collider) => collider.id !== `collider-${source.id}`);
  const addFragment = (min: number, max: number, label: string): void => {
    if (max - min <= 0.18) return;
    addWall(plan, rng.fork(label), {
      x: source.orientation === 'x' ? (min + max) * 0.5 : source.x,
      z: source.orientation === 'z' ? (min + max) * 0.5 : source.z,
      length: max - min,
      orientation: source.orientation,
      bottom: source.bottom,
      height: source.height,
      thickness: source.thickness,
      tint: source.tint,
      collision: source.collision,
      kind: source.kind,
      detail: source.detail,
    });
  };
  addFragment(sourceMin, openingMin, 'left');
  addFragment(openingMax, sourceMax, 'right');

  addWall(plan, rng.fork('back'), {
    x: side.orientation === 'x' ? center : backFixed,
    z: side.orientation === 'x' ? backFixed : center,
    length: width,
    orientation: side.orientation,
    bottom: 0,
    height: room.ceilingHeight,
    thickness: 0.2,
    collision: true,
    kind: 'wallpaper',
    detail: 'recess',
  });
  for (const edge of [openingMin, openingMax]) {
    addWall(plan, rng.fork(`return:${edge}`), {
      x: side.orientation === 'x' ? edge : (fixed + backFixed) * 0.5,
      z: side.orientation === 'x' ? (fixed + backFixed) * 0.5 : edge,
      length: depth,
      orientation: side.orientation === 'x' ? 'z' : 'x',
      bottom: 0,
      height: room.ceilingHeight,
      thickness: 0.2,
      collision: true,
      kind: 'wallpaper',
      detail: 'recess',
    });
  }
};

const addColumnsAndPartialWalls = (
  plan: MutablePlan,
  world: WorldPlan,
  reservedRoomIds: Set<string>,
  rootRng: SeededRandom,
): void => {
  const profileRng = rootRng.fork('architecture:pilaster-profile');
  const pilasterProfile = profileRng.weighted([
    { value: 'none' as const, weight: 0.24 },
    { value: 'sparse' as const, weight: 0.19 },
    { value: 'regular' as const, weight: 0.31 },
    { value: 'dense' as const, weight: 0.17 },
    { value: 'clustered' as const, weight: 0.09 },
  ]);
  for (const room of world.rooms) {
    if (reservedRoomIds.has(room.id)) continue;
    const rng = rootRng.fork(`architecture:${room.id}`);
    const width = rectWidth(room.bounds);
    const depth = rectDepth(room.bounds);

    if (room.kind === 'open-hall' && width > 12 && depth > 12) {
      const columnStyle = rng.weighted([
        { value: 'none' as const, weight: 0.29 },
        { value: 'field' as const, weight: 0.39 },
        { value: 'sparse' as const, weight: 0.16 },
        { value: 'dense' as const, weight: 0.1 },
        { value: 'clustered' as const, weight: 0.06 },
      ]);
      const sparse = columnStyle === 'sparse';
      const dense = columnStyle === 'dense';
      const clustered = columnStyle === 'clustered';
      const spacingX = rng.float(
        sparse ? 8.5 : dense ? 3.7 : clustered ? 4.3 : 5.2,
        sparse ? 12 : dense ? 5.2 : clustered ? 7.2 : 8.4,
      );
      const spacingZ = rng.float(
        sparse ? 8.5 : dense ? 3.7 : clustered ? 4.3 : 5.2,
        sparse ? 12 : dense ? 5.2 : clustered ? 7.2 : 8.4,
      );
      const center = rectCenter(room.bounds);
      const clearCross = columnStyle !== 'none' && rng.chance(0.42);
      let hallColumnCount = 0;
      for (
        let x = room.bounds.minX + spacingX * 0.5;
        columnStyle !== 'none' && x <= room.bounds.maxX - spacingX * 0.5;
        x += spacingX * rng.float(0.82, 1.2)
      ) {
        for (
          let z = room.bounds.minZ + spacingZ * 0.5;
          z <= room.bounds.maxZ - spacingZ * 0.5 && hallColumnCount < 260;
          z += spacingZ * rng.float(0.8, 1.22)
        ) {
          if (
            rng.chance(sparse ? 0.34 : clustered ? 0.26 : dense ? 0.06 : 0.12) ||
            Math.hypot(x - world.spawn.x, z - world.spawn.z) < 3.4 ||
            portalNear(plan, x, z, 2.2) ||
            (clearCross && (Math.abs(x - center.x) < 2.1 || Math.abs(z - center.z) < 2.1))
          ) continue;
          const column = {
            x: quantize(x + rng.float(clustered ? -0.85 : -0.38, clustered ? 0.85 : 0.38), 0.05),
            z: quantize(z + rng.float(clustered ? -0.85 : -0.38, clustered ? 0.85 : 0.38), 0.05),
            width: rng.float(dense ? 0.42 : 0.65, width > 35 ? 2.05 : 1.45),
            depth: rng.float(dense ? 0.38 : 0.62, depth > 35 ? 2.35 : 1.65),
            height: room.ceilingHeight,
            tint: rng.float(0.82, 1.07),
            kind: 'column' as const,
          };
          world.columns.push(column);
          hallColumnCount += 1;
          plan.colliders.push({
            id: `column-${world.columns.length - 1}`,
            center: { x: column.x, y: column.height * 0.5, z: column.z },
            halfExtents: { x: column.width * 0.5, y: column.height * 0.5, z: column.depth * 0.5 },
            kind: 'column',
          });
        }
      }
    }

    if (Math.max(width, depth) >= 12 && Math.min(width, depth) >= 4.8) {
      const relief = pilasterProfile === 'none'
        ? rng.weighted([
            { value: 'none' as const, weight: 0.74 },
            { value: 'recess' as const, weight: 0.26 },
          ])
        : rng.weighted([
            {
              value: 'none' as const,
              weight: pilasterProfile === 'dense' ? 0.06 : pilasterProfile === 'clustered' ? 0.11 : 0.35,
            },
            {
              value: 'pilasters' as const,
              weight: pilasterProfile === 'dense' ? 0.68 : pilasterProfile === 'clustered' ? 0.57 : 0.4,
            },
            { value: 'recess' as const, weight: 0.15 },
            {
              value: 'both' as const,
              weight: pilasterProfile === 'dense' ? 0.22 : pilasterProfile === 'clustered' ? 0.17 : 0.1,
            },
          ]);
      if (relief === 'pilasters' || relief === 'both') {
        if (pilasterProfile !== 'none') {
          addPilasterSeries(plan, world, room, rng.fork('pilasters'), pilasterProfile);
        }
      }
      if (relief === 'recess' || relief === 'both') {
        addWallRecess(plan, room, rng.fork('recess'));
      }
    }

    const acceptsReturnWalls =
      room.kind === 'nested' ||
      room.kind === 'threshold' ||
      (room.kind === 'office' && rng.chance(0.58));
    if (acceptsReturnWalls && width > 10 && depth > 10) {
      const count = room.kind === 'nested' ? rng.int(1, 3) : room.kind === 'threshold' ? rng.int(1, 2) : 1;
      for (let index = 0; index < count; index += 1) {
        const alongX = index % 2 === 0 ? width >= depth : width < depth;
        const mirrored = index === 0 && rng.chance(0.68);
        if (alongX) {
          const length = rng.float(width * 0.38, width * 0.68);
          const centerX = rng.float(room.bounds.minX + length * 0.5 + 1.8, room.bounds.maxX - length * 0.5 - 1.8);
          const z = rng.float(room.bounds.minZ + 3, room.bounds.maxZ - 3);
          const positions = mirrored ? [z, rectCenter(room.bounds).z * 2 - z] : [z];
          for (const [mirrorIndex, wallZ] of positions.entries()) {
            addWall(plan, rng.fork(`return-${index}-${mirrorIndex}`), {
              x: centerX,
              z: wallZ,
              length,
              orientation: 'x',
              bottom: 0,
              height: rng.chance(0.18) ? room.ceilingHeight * 0.68 : room.ceilingHeight,
              thickness: WALL_THICKNESS,
              collision: true,
              kind: 'wallpaper',
            });
          }
        } else {
          const length = rng.float(depth * 0.38, depth * 0.68);
          const centerZ = rng.float(room.bounds.minZ + length * 0.5 + 1.8, room.bounds.maxZ - length * 0.5 - 1.8);
          const x = rng.float(room.bounds.minX + 3, room.bounds.maxX - 3);
          const positions = mirrored ? [x, rectCenter(room.bounds).x * 2 - x] : [x];
          for (const [mirrorIndex, wallX] of positions.entries()) {
            addWall(plan, rng.fork(`return-${index}-${mirrorIndex}`), {
              x: wallX,
              z: centerZ,
              length,
              orientation: 'z',
              bottom: 0,
              height: rng.chance(0.18) ? room.ceilingHeight * 0.68 : room.ceilingHeight,
              thickness: WALL_THICKNESS,
              collision: true,
              kind: 'wallpaper',
            });
          }
        }
      }
    }
  }
};

const addSolidMasses = (
  world: WorldPlan,
  reservedRoomIds: Set<string>,
  rootRng: SeededRandom,
): void => {
  const rng = rootRng.fork('sealed-masses');
  const candidates = rng.shuffle(
    world.rooms.filter(
      (room) =>
        !reservedRoomIds.has(room.id) &&
        room.kind !== 'corridor' &&
        room.kind !== 'open-hall' &&
        rectWidth(room.bounds) >= 10.8 &&
        rectDepth(room.bounds) >= 10.2 &&
        Math.hypot(rectCenter(room.bounds).x - world.spawn.x, rectCenter(room.bounds).z - world.spawn.z) > 12,
    ),
  );
  const targetCount = Math.min(candidates.length, rng.int(5, 8));
  let placed = 0;
  for (const room of candidates) {
    if (placed >= targetCount) break;
    const roomRng = rng.fork(`mass:${room.id}`);
    let bounds: Rect | undefined;
    for (let attempt = 0; attempt < 12 && !bounds; attempt += 1) {
      const slab = roomRng.chance(0.32);
      const width = slab
        ? roomRng.float(2.4, Math.min(8.4, rectWidth(room.bounds) - 4.8))
        : roomRng.float(3.1, Math.min(6.8, rectWidth(room.bounds) - 4.8));
      const depth = slab
        ? roomRng.float(2.4, Math.min(8.1, rectDepth(room.bounds) - 4.8))
        : roomRng.float(3, Math.min(6.4, rectDepth(room.bounds) - 4.8));
      const centerX = roomRng.float(room.bounds.minX + width * 0.5 + 1.35, room.bounds.maxX - width * 0.5 - 1.35);
      const centerZ = roomRng.float(room.bounds.minZ + depth * 0.5 + 1.35, room.bounds.maxZ - depth * 0.5 - 1.35);
      const candidate: Rect = {
        minX: quantize(centerX - width * 0.5, 0.05),
        maxX: quantize(centerX + width * 0.5, 0.05),
        minZ: quantize(centerZ - depth * 0.5, 0.05),
        maxZ: quantize(centerZ + depth * 0.5, 0.05),
      };
      const intersectsWall = world.walls.some((wall) => {
        const halfX = wall.orientation === 'x' ? wall.length * 0.5 : wall.thickness * 0.5;
        const halfZ = wall.orientation === 'z' ? wall.length * 0.5 : wall.thickness * 0.5;
        return (
          candidate.minX < wall.x + halfX + 0.38 &&
          candidate.maxX > wall.x - halfX - 0.38 &&
          candidate.minZ < wall.z + halfZ + 0.38 &&
          candidate.maxZ > wall.z - halfZ - 0.38
        );
      });
      if (!intersectsWall) bounds = candidate;
    }
    if (!bounds) continue;
    world.solidMasses.push({
      id: `solid-mass-${world.solidMasses.length}`,
      bounds,
      height: WALL_HEIGHT,
      tint: roomRng.float(0.82, 1.02),
    });
    world.colliders.push({
      id: `solid-mass-collider-${world.solidMasses.length - 1}`,
      center: { x: rectCenter(bounds).x, y: WALL_HEIGHT * 0.5, z: rectCenter(bounds).z },
      halfExtents: { x: rectWidth(bounds) * 0.5, y: WALL_HEIGHT * 0.5, z: rectDepth(bounds) * 0.5 },
      kind: 'wall',
    });
    placed += 1;
  }
};

const addSqueezeViews = (
  plan: MutablePlan,
  world: WorldPlan,
  reservedRoomIds: Set<string>,
  rootRng: SeededRandom,
): void => {
  const rng = rootRng.fork('feature:squeeze-views');
  if (!rng.chance(0.76)) return;
  const candidates = rng.shuffle(
    world.rooms.filter((room) => {
      if (
        reservedRoomIds.has(room.id) ||
        room.kind === 'corridor' ||
        room.kind === 'open-hall'
      ) return false;
      const long = Math.max(rectWidth(room.bounds), rectDepth(room.bounds));
      const short = Math.min(rectWidth(room.bounds), rectDepth(room.bounds));
      return long >= 14 && short >= 7.5;
    }),
  );
  const count = Math.min(candidates.length, rng.int(1, 3));
  for (let index = 0; index < count; index += 1) {
    const room = candidates[index]!;
    const roomRng = rng.fork(room.id);
    const alongX = rectWidth(room.bounds) >= rectDepth(room.bounds);
    const longSpan = alongX ? rectWidth(room.bounds) : rectDepth(room.bounds);
    const shortSpan = alongX ? rectDepth(room.bounds) : rectWidth(room.bounds);
    const layout = shortSpan >= 9.2
      ? roomRng.weighted([
          { value: 'through' as const, weight: 0.17 },
          { value: 'side-exits' as const, weight: 0.19 },
          { value: 'chambers' as const, weight: 0.17 },
          { value: 'dead-end' as const, weight: 0.14 },
          { value: 'loop' as const, weight: 0.16 },
          { value: 'multi-exit' as const, weight: 0.17 },
        ])
      : roomRng.weighted([
          { value: 'through' as const, weight: 0.45 },
          { value: 'side-exits' as const, weight: 0.33 },
          { value: 'dead-end' as const, weight: 0.22 },
        ]);
    const monumental = room.kind === 'open-hall' || (longSpan >= 24 && roomRng.chance(0.42));
    const minimumLength =
      layout === 'chambers' || layout === 'loop' || layout === 'multi-exit'
        ? 12
        : layout === 'dead-end'
          ? 6.5
          : 8.5;
    const length = Math.min(
      longSpan - 4.8,
      roomRng.float(
        minimumLength,
        monumental ? Math.min(44, longSpan - 4.8) : Math.min(23, longSpan - 4.8),
      ),
    );
    if (length < minimumLength - 0.1) continue;
    const widthMinimum =
      layout === 'loop'
        ? 5.4
        : layout === 'chambers' || layout === 'multi-exit'
          ? 5.2
          : layout === 'side-exits'
            ? 3.2
            : 2.15;
    const widthMaximum = Math.max(
      widthMinimum,
      Math.min(
        shortSpan - 3.2,
        layout === 'chambers' || layout === 'loop' || layout === 'multi-exit'
          ? 9.5
          : monumental
            ? 7.2
            : 4.6,
      ),
    );
    const corridorWidth = roomRng.float(widthMinimum, widthMaximum);
    const apertureWidth = roomRng.float(
      layout === 'through' ? 1.1 : 1.35,
      Math.min(corridorWidth - 0.9, monumental ? 3.9 : 2.8),
    );
    const roomCenter = rectCenter(room.bounds);
    const crossOffset = roomRng.float(-0.65, 0.65);
    const bounds: Rect = alongX
      ? {
          minX: roomCenter.x - length * 0.5,
          maxX: roomCenter.x + length * 0.5,
          minZ: roomCenter.z + crossOffset - corridorWidth * 0.5,
          maxZ: roomCenter.z + crossOffset + corridorWidth * 0.5,
        }
      : {
          minX: roomCenter.x + crossOffset - corridorWidth * 0.5,
          maxX: roomCenter.x + crossOffset + corridorWidth * 0.5,
          minZ: roomCenter.z - length * 0.5,
          maxZ: roomCenter.z + length * 0.5,
        };
    const featureId = `squeeze-view-${room.id}`;
    const wall = (label: string, input: Omit<WallSegment, 'id' | 'tint' | 'collision' | 'kind'>): void => {
      addWall(plan, roomRng.fork(label), {
        ...input,
        tint: roomRng.float(0.88, 1.02),
        collision: true,
        kind: 'wallpaper',
      });
    };
    const emitBoundary = (
      label: string,
      orientation: 'x' | 'z',
      fixed: number,
      spanMin: number,
      spanMax: number,
      gaps: Gap[],
      thickness: number,
    ): void => {
      const normalized = normalizeGaps(gaps, spanMin, spanMax);
      for (const gap of normalized) {
        plan.portals.push({
          x: orientation === 'x' ? (gap.min + gap.max) * 0.5 : fixed,
          z: orientation === 'z' ? (gap.min + gap.max) * 0.5 : fixed,
          orientation,
          width: gap.max - gap.min,
        });
      }
      let cursor = spanMin;
      for (const [fragmentIndex, gap] of normalized.entries()) {
        if (gap.min - cursor > 0.18) {
          const center = (cursor + gap.min) * 0.5;
          wall(`${label}-${fragmentIndex}`, {
            x: orientation === 'x' ? center : fixed,
            z: orientation === 'z' ? center : fixed,
            length: gap.min - cursor,
            orientation,
            bottom: 0,
            height: room.ceilingHeight,
            thickness,
          });
        }
        cursor = gap.max;
      }
      if (spanMax - cursor > 0.18) {
        const center = (cursor + spanMax) * 0.5;
        wall(`${label}-last`, {
          x: orientation === 'x' ? center : fixed,
          z: orientation === 'z' ? center : fixed,
          length: spanMax - cursor,
          orientation,
          bottom: 0,
          height: room.ceilingHeight,
          thickness,
        });
      }
    };

    const crossCenter = alongX
      ? (bounds.minZ + bounds.maxZ) * 0.5
      : (bounds.minX + bounds.maxX) * 0.5;
    const entryGap = {
      min: crossCenter - apertureWidth * 0.5,
      max: crossCenter + apertureWidth * 0.5,
    };
    const farGapWidth = roomRng.float(
      Math.max(1.2, apertureWidth * 0.9),
      Math.min(corridorWidth - 0.7, apertureWidth * 1.65),
    );
    const farGap = {
      min: crossCenter - farGapWidth * 0.5,
      max: crossCenter + farGapWidth * 0.5,
    };
    const secondaryOffsets =
      layout === 'chambers'
        ? [-length * 0.24, length * 0.24]
        : layout === 'multi-exit'
          ? [-length * 0.3, 0, length * 0.3]
          : [roomRng.float(-length * 0.22, length * 0.22)];
    const sideGapWidth = roomRng.float(1.25, Math.min(3.2, length * 0.22));
    const sideGaps = secondaryOffsets.map((offset) => ({
      min: (alongX ? roomCenter.x : roomCenter.z) + offset - sideGapWidth * 0.5,
      max: (alongX ? roomCenter.x : roomCenter.z) + offset + sideGapWidth * 0.5,
    }));
    const openFarEnd =
      layout === 'through' ||
      layout === 'chambers' ||
      layout === 'loop' ||
      layout === 'multi-exit' ||
      (layout === 'side-exits' && roomRng.chance(0.52));
    const hasSideExits =
      layout === 'side-exits' || layout === 'chambers' || layout === 'multi-exit';
    const openBothSides =
      layout === 'chambers' ||
      layout === 'multi-exit' ||
      (layout === 'side-exits' && roomRng.chance(0.58));

    if (alongX) {
      emitBoundary('side-north', 'x', bounds.minZ, bounds.minX, bounds.maxX, hasSideExits ? sideGaps : [], 0.22);
      emitBoundary('side-south', 'x', bounds.maxZ, bounds.minX, bounds.maxX, hasSideExits && openBothSides ? sideGaps : [], 0.22);
      emitBoundary('front', 'z', bounds.minX, bounds.minZ, bounds.maxZ, [entryGap], 0.3);
      emitBoundary('end', 'z', bounds.maxX, bounds.minZ, bounds.maxZ, openFarEnd ? [farGap] : [], 0.3);
    } else {
      emitBoundary('side-west', 'z', bounds.minX, bounds.minZ, bounds.maxZ, hasSideExits ? sideGaps : [], 0.22);
      emitBoundary('side-east', 'z', bounds.maxX, bounds.minZ, bounds.maxZ, hasSideExits && openBothSides ? sideGaps : [], 0.22);
      emitBoundary('front', 'x', bounds.minZ, bounds.minX, bounds.maxX, [entryGap], 0.3);
      emitBoundary('end', 'x', bounds.maxZ, bounds.minX, bounds.maxX, openFarEnd ? [farGap] : [], 0.3);
    }

    if (layout === 'chambers') {
      const partitionCount = length >= 24 ? 2 : 1;
      for (let partitionIndex = 0; partitionIndex < partitionCount; partitionIndex += 1) {
        const along = (alongX ? bounds.minX : bounds.minZ) +
          ((partitionIndex + 1) / (partitionCount + 1)) * length;
        const partitionGapWidth = roomRng.float(1.4, Math.min(3.2, corridorWidth * 0.48));
        const offset = (partitionIndex % 2 === 0 ? -1 : 1) * corridorWidth * 0.16;
        const gap = {
          min: crossCenter + offset - partitionGapWidth * 0.5,
          max: crossCenter + offset + partitionGapWidth * 0.5,
        };
        emitBoundary(
          `chamber-${partitionIndex}`,
          alongX ? 'z' : 'x',
          along,
          alongX ? bounds.minZ : bounds.minX,
          alongX ? bounds.maxZ : bounds.maxX,
          [gap],
          0.22,
        );
      }
    }
    if (layout === 'loop') {
      const partitionLength = length * roomRng.float(0.52, 0.68);
      wall('loop-divider', {
        x: alongX ? roomCenter.x + length * 0.04 : crossCenter,
        z: alongX ? crossCenter : roomCenter.z + length * 0.04,
        length: partitionLength,
        orientation: alongX ? 'x' : 'z',
        bottom: 0,
        height: room.ceilingHeight,
        thickness: roomRng.float(0.22, 0.36),
      });
    }
    const exitCount =
      Number(openFarEnd) +
      (hasSideExits ? sideGaps.length : 0) +
      (hasSideExits && openBothSides ? sideGaps.length : 0);
    const clearanceHeight = quantize(roomRng.float(1.36, 1.49), 0.01);
    world.colliders.push({
      id: `${featureId}-low-ceiling`,
      center: {
        x: rectCenter(bounds).x,
        y: clearanceHeight + (room.ceilingHeight - clearanceHeight) * 0.5,
        z: rectCenter(bounds).z,
      },
      halfExtents: {
        x: rectWidth(bounds) * 0.5,
        y: (room.ceilingHeight - clearanceHeight) * 0.5,
        z: rectDepth(bounds) * 0.5,
      },
      kind: 'barrier',
    });

    const rectAlong = (minimum: number, maximum: number, crossPadding = 0.28): Rect =>
      alongX
        ? {
            minX: minimum,
            maxX: maximum,
            minZ: bounds.minZ + crossPadding,
            maxZ: bounds.maxZ - crossPadding,
          }
        : {
            minX: bounds.minX + crossPadding,
            maxX: bounds.maxX - crossPadding,
            minZ: minimum,
            maxZ: maximum,
          };
    const longMinimum = alongX ? bounds.minX : bounds.minZ;
    const longMaximum = alongX ? bounds.maxX : bounds.maxZ;
    let hump: PassageHump | undefined;
    if (length >= 12 && roomRng.chance(0.36)) {
      const elevation = quantize(roomRng.float(0.1, 0.18), 0.01);
      const rampRun = quantize(roomRng.float(1.35, Math.min(2.8, length * 0.18)), 0.05);
      const platformLength = quantize(roomRng.float(1.6, Math.min(4.2, length * 0.24)), 0.05);
      const centerLong = (longMinimum + longMaximum) * 0.5 + roomRng.float(-length * 0.1, length * 0.1);
      const platformMin = centerLong - platformLength * 0.5;
      const platformMax = centerLong + platformLength * 0.5;
      const platformBounds = rectAlong(platformMin, platformMax);
      const ascentBounds = rectAlong(platformMin - rampRun, platformMin);
      const descentBounds = rectAlong(platformMax, platformMax + rampRun);
      hump = {
        platformBounds,
        elevation,
        ramps: [
          { bounds: ascentBounds, axis: alongX ? 'x' : 'z', riseDirection: 1 },
          { bounds: descentBounds, axis: alongX ? 'x' : 'z', riseDirection: -1 },
        ],
      };
      world.colliders.push({
        id: `${featureId}-hump-platform`,
        center: {
          x: rectCenter(platformBounds).x,
          y: (elevation - 0.12) * 0.5,
          z: rectCenter(platformBounds).z,
        },
        halfExtents: {
          x: rectWidth(platformBounds) * 0.5,
          y: (elevation + 0.12) * 0.5,
          z: rectDepth(platformBounds) * 0.5,
        },
        kind: 'floor',
      });
      for (const [rampIndex, ramp] of hump.ramps.entries()) {
        const run = ramp.axis === 'x' ? rectWidth(ramp.bounds) : rectDepth(ramp.bounds);
        const cross = ramp.axis === 'x' ? rectDepth(ramp.bounds) : rectWidth(ramp.bounds);
        const slopeLength = Math.hypot(run, elevation);
        const signedAngle = Math.atan2(elevation, run) * ramp.riseDirection;
        const halfThickness = 0.06;
        world.colliders.push({
          id: `${featureId}-hump-ramp-${rampIndex}`,
          center: {
            x: rectCenter(ramp.bounds).x,
            y: elevation * 0.5 - Math.cos(signedAngle) * halfThickness,
            z: rectCenter(ramp.bounds).z,
          },
          halfExtents: ramp.axis === 'x'
            ? { x: slopeLength * 0.5, y: halfThickness, z: cross * 0.5 }
            : { x: cross * 0.5, y: halfThickness, z: slopeLength * 0.5 },
          rotation: ramp.axis === 'x'
            ? {
                x: 0,
                y: 0,
                z: Math.sin(signedAngle * 0.5),
                w: Math.cos(signedAngle * 0.5),
              }
            : {
                x: Math.sin(-signedAngle * 0.5),
                y: 0,
                z: 0,
                w: Math.cos(signedAngle * 0.5),
              },
          kind: 'floor',
        });
      }
    }

    const passageHoles: PassageHole[] = [];
    if (!hump && length >= 9 && corridorWidth >= 2.5 && roomRng.chance(0.2)) {
      const holeLength = roomRng.float(0.95, Math.min(1.65, length * 0.14));
      const holeCenter = longMinimum + length * roomRng.float(0.42, 0.68);
      const crossPadding = corridorWidth * roomRng.float(0.17, 0.25);
      const hole = {
        ...rectAlong(holeCenter - holeLength * 0.5, holeCenter + holeLength * 0.5, crossPadding),
        depth: quantize(roomRng.float(0.45, 0.78), 0.01),
      };
      passageHoles.push(hole);
      world.colliders.push({
        id: `${featureId}-hole-bottom`,
        center: {
          x: rectCenter(hole).x,
          y: -hole.depth - 0.1,
          z: rectCenter(hole).z,
        },
        halfExtents: {
          x: rectWidth(hole) * 0.5,
          y: 0.1,
          z: rectDepth(hole) * 0.5,
        },
        kind: 'floor',
      });
      const shaftThickness = 0.1;
      const shaftHeight = hole.depth;
      for (const [side, collider] of [
        ['north', {
          x: rectCenter(hole).x,
          z: hole.minZ - shaftThickness * 0.5,
          halfX: rectWidth(hole) * 0.5,
          halfZ: shaftThickness * 0.5,
        }],
        ['south', {
          x: rectCenter(hole).x,
          z: hole.maxZ + shaftThickness * 0.5,
          halfX: rectWidth(hole) * 0.5,
          halfZ: shaftThickness * 0.5,
        }],
        ['west', {
          x: hole.minX - shaftThickness * 0.5,
          z: rectCenter(hole).z,
          halfX: shaftThickness * 0.5,
          halfZ: rectDepth(hole) * 0.5,
        }],
        ['east', {
          x: hole.maxX + shaftThickness * 0.5,
          z: rectCenter(hole).z,
          halfX: shaftThickness * 0.5,
          halfZ: rectDepth(hole) * 0.5,
        }],
      ] as const) {
        world.colliders.push({
          id: `${featureId}-hole-${side}`,
          center: { x: collider.x, y: -shaftHeight * 0.5, z: collider.z },
          halfExtents: {
            x: collider.halfX,
            y: shaftHeight * 0.5,
            z: collider.halfZ,
          },
          kind: 'wall',
        });
      }
    }

    world.features.push({
      kind: 'squeeze-view',
      id: featureId,
      roomId: room.id,
      bounds,
      axis: alongX ? 'x' : 'z',
      apertureWidth,
      layout,
      exitCount,
      clearanceHeight,
      hump,
      holes: passageHoles,
    });
    addWorldLight(world, {
      id: `light-${featureId}`,
      x: alongX ? bounds.minX + length * 0.68 : (bounds.minX + bounds.maxX) * 0.5,
      ceilingY: clearanceHeight - 0.025,
      z: alongX ? (bounds.minZ + bounds.maxZ) * 0.5 : bounds.minZ + length * 0.68,
      rotation: alongX ? 0 : Math.PI * 0.5,
      width: 1.18,
      intensity: roomRng.float(0.9, 1.08),
      color: roomRng.pick(temperatureColors),
      dead: false,
      unstable: false,
      phase: roomRng.float(0, Math.PI * 2),
      roomId: featureId,
      level: 0,
    }, bounds);
    reservedRoomIds.add(room.id);
  }
};

const addLowerWall = (
  world: WorldPlan,
  feature: GridPitFeature,
  input: { x: number; z: number; length: number; orientation: 'x' | 'z'; thickness?: number },
): void => {
  const height = feature.lowerCeilingY - feature.lowerFloorY;
  const wall: WallSegment = {
    id: `lower-wall-${world.walls.length}`,
    x: input.x,
    z: input.z,
    length: input.length,
    orientation: input.orientation,
    bottom: feature.lowerFloorY,
    height,
    thickness: input.thickness ?? 0.3,
    tint: 0.82 + ((world.walls.length * 37) % 17) / 100,
    collision: true,
    kind: 'wallpaper',
  };
  world.walls.push(wall);
  addColliderForWall(world.colliders, wall, `collider-${wall.id}`);
};

const addLowerLevel = (world: WorldPlan, feature: GridPitFeature, rootRng: SeededRandom): void => {
  const rng = rootRng.fork('lower-level');
  const bounds = feature.lowerBounds;
  const center = rectCenter(bounds);

  addLowerWall(world, feature, { x: center.x, z: bounds.minZ, length: rectWidth(bounds), orientation: 'x', thickness: 0.42 });
  addLowerWall(world, feature, { x: center.x, z: bounds.maxZ, length: rectWidth(bounds), orientation: 'x', thickness: 0.42 });
  addLowerWall(world, feature, { x: bounds.minX, z: center.z, length: rectDepth(bounds), orientation: 'z', thickness: 0.42 });
  addLowerWall(world, feature, { x: bounds.maxX, z: center.z, length: rectDepth(bounds), orientation: 'z', thickness: 0.42 });

  // This geometry is only the glimpse visible from the story above. Keep it
  // deliberately neutral: a lit landing shell, floor and shaft walls. The
  // canonical maze for the destination seed replaces it at the midpoint, so
  // omitting a second random maze prevents obvious walls from popping shape.

  const continuingHoles = feature.holes.filter(
    (hole) => hole.kind === 'void' || (hole.stories ?? 1) > 1,
  );
  for (const [index, floor] of floorCellsAroundHoles(bounds, continuingHoles).entries()) {
    world.colliders.push({
      id: `lower-level-floor-${index}`,
      center: {
        x: (floor.minX + floor.maxX) * 0.5,
        y: feature.lowerFloorY - 0.12,
        z: (floor.minZ + floor.maxZ) * 0.5,
      },
      halfExtents: { x: rectWidth(floor) * 0.5, y: 0.12, z: rectDepth(floor) * 0.5 },
      kind: 'floor',
    });
  }

  const shaftHeight = -feature.lowerCeilingY;
  for (const [holeIndex, hole] of feature.holes.entries()) {
    const holeCenter = rectCenter(hole);
    const wallY = feature.lowerCeilingY + shaftHeight * 0.5;
    const side = 0.055;
    world.colliders.push(
      {
        id: `shaft-${holeIndex}-north`,
        center: { x: holeCenter.x, y: wallY, z: hole.minZ },
        halfExtents: { x: rectWidth(hole) * 0.5, y: shaftHeight * 0.5, z: side },
        kind: 'wall',
      },
      {
        id: `shaft-${holeIndex}-south`,
        center: { x: holeCenter.x, y: wallY, z: hole.maxZ },
        halfExtents: { x: rectWidth(hole) * 0.5, y: shaftHeight * 0.5, z: side },
        kind: 'wall',
      },
      {
        id: `shaft-${holeIndex}-west`,
        center: { x: hole.minX, y: wallY, z: holeCenter.z },
        halfExtents: { x: side, y: shaftHeight * 0.5, z: rectDepth(hole) * 0.5 },
        kind: 'wall',
      },
      {
        id: `shaft-${holeIndex}-east`,
        center: { x: hole.maxX, y: wallY, z: holeCenter.z },
        halfExtents: { x: side, y: shaftHeight * 0.5, z: rectDepth(hole) * 0.5 },
        kind: 'wall',
      },
    );
    if (hole.kind === 'void') {
      // The collision shell extends below the player's death plane so the
      // bottom of a lethal crevasse can never be exposed during a fall.
      const abyssBottom = -Math.max(54, hole.depth + 10.8);
      const abyssHeight = feature.lowerFloorY - abyssBottom;
      const abyssY = abyssBottom + abyssHeight * 0.5;
      world.colliders.push(
        {
          id: `abyss-${holeIndex}-north`,
          center: { x: holeCenter.x, y: abyssY, z: hole.minZ },
          halfExtents: { x: rectWidth(hole) * 0.5, y: abyssHeight * 0.5, z: side },
          kind: 'wall',
        },
        {
          id: `abyss-${holeIndex}-south`,
          center: { x: holeCenter.x, y: abyssY, z: hole.maxZ },
          halfExtents: { x: rectWidth(hole) * 0.5, y: abyssHeight * 0.5, z: side },
          kind: 'wall',
        },
        {
          id: `abyss-${holeIndex}-west`,
          center: { x: hole.minX, y: abyssY, z: holeCenter.z },
          halfExtents: { x: side, y: abyssHeight * 0.5, z: rectDepth(hole) * 0.5 },
          kind: 'wall',
        },
        {
          id: `abyss-${holeIndex}-east`,
          center: { x: hole.maxX, y: abyssY, z: holeCenter.z },
          halfExtents: { x: side, y: abyssHeight * 0.5, z: rectDepth(hole) * 0.5 },
          kind: 'wall',
        },
      );
    }
  }

  const lowerWalls = world.walls.filter((wall) => wall.bottom === feature.lowerFloorY);
  const lightColumns = Math.max(2, Math.floor(rectWidth(bounds) / rng.float(5.8, 7.2)));
  const lightRows = Math.max(2, Math.floor(rectDepth(bounds) / rng.float(5.8, 7.2)));
  for (let xIndex = 0; xIndex < lightColumns; xIndex += 1) {
    for (let zIndex = 0; zIndex < lightRows; zIndex += 1) {
      const x = bounds.minX + ((xIndex + 0.5) / lightColumns) * rectWidth(bounds) + rng.float(-0.32, 0.32);
      const z = bounds.minZ + ((zIndex + 0.5) / lightRows) * rectDepth(bounds) + rng.float(-0.32, 0.32);
      if (feature.holes.some((hole) => pointInRect(x, z, hole, -0.45))) continue;
      const intersectsWall = lowerWalls.some((wall) => {
        const halfX = wall.orientation === 'x' ? wall.length * 0.5 : wall.thickness * 0.5;
        const halfZ = wall.orientation === 'z' ? wall.length * 0.5 : wall.thickness * 0.5;
        return Math.abs(x - wall.x) <= halfX + 0.55 && Math.abs(z - wall.z) <= halfZ + 0.55;
      });
      if (intersectsWall) continue;
      addWorldLight(world, {
        id: `lower-light-${xIndex}-${zIndex}`,
        x,
        ceilingY: feature.lowerCeilingY,
        z,
        rotation: xIndex % 2 === 0 ? 0 : Math.PI * 0.5,
        width: 1.55,
        intensity: rng.float(0.82, 1.02),
        color: rng.pick(temperatureColors),
        dead: false,
        unstable: false,
        phase: rng.float(0, Math.PI * 2),
        roomId: feature.id,
        level: -1,
      }, bounds);
    }
  }
};

const temperatureColors = [0xfffbd5, 0xffffe4, 0xf8f8d0, 0xfff4c4, 0xf4f5d7] as const;
const CEILING_TILE_SIZE = 2.4;

const snapToCeilingTileCenter = (value: number, worldSize: number): number => {
  const origin = -worldSize * 0.5;
  const index = Math.floor((value - origin) / CEILING_TILE_SIZE);
  return quantize(origin + (index + 0.5) * CEILING_TILE_SIZE, 0.05);
};

export const lightPanelFootprint = (light: LightSlot): { halfX: number; halfZ: number } => {
  const longHalf = light.width * 0.5 + 0.32;
  const shortHalf = (light.width > 1.65 ? 0.58 : 0.46) + 0.32;
  const alongX = Math.abs(Math.cos(light.rotation)) >= Math.abs(Math.sin(light.rotation));
  return alongX
    ? { halfX: longHalf, halfZ: shortHalf }
    : { halfX: shortHalf, halfZ: longHalf };
};

export const lightPanelOverlapsRect = (light: LightSlot, rect: Rect): boolean => {
  const footprint = lightPanelFootprint(light);
  return (
    light.x + footprint.halfX >= rect.minX &&
    light.x - footprint.halfX <= rect.maxX &&
    light.z + footprint.halfZ >= rect.minZ &&
    light.z - footprint.halfZ <= rect.maxZ
  );
};

const lightOverlapsWall = (light: LightSlot, wall: WallSegment): boolean => {
  const lowerLight = light.level < 0;
  if ((wall.bottom < -1) !== lowerLight) return false;
  const footprint = lightPanelFootprint(light);
  const halfX = wall.orientation === 'x' ? wall.length * 0.5 : wall.thickness * 0.5;
  const halfZ = wall.orientation === 'z' ? wall.length * 0.5 : wall.thickness * 0.5;
  return (
    Math.abs(light.x - wall.x) <= halfX + footprint.halfX &&
    Math.abs(light.z - wall.z) <= halfZ + footprint.halfZ
  );
};

const lightIsBlocked = (world: WorldPlan, light: LightSlot): boolean => {
  const footprint = lightPanelFootprint(light);
  if (world.walls.some((wall) => lightOverlapsWall(light, wall))) return true;
  if (world.features.some(
    (feature) =>
      feature.kind === 'grid-pit' &&
      feature.holes.some((hole) => lightPanelOverlapsRect(light, hole)),
  )) return true;
  if (light.level < 0) return false;
  return world.solidMasses.some(
    (mass) =>
      light.x >= mass.bounds.minX - footprint.halfX &&
      light.x <= mass.bounds.maxX + footprint.halfX &&
      light.z >= mass.bounds.minZ - footprint.halfZ &&
      light.z <= mass.bounds.maxZ + footprint.halfZ,
  ) || world.columns.some(
    (column) =>
      Math.abs(light.x - column.x) <= column.width * 0.5 + footprint.halfX &&
      Math.abs(light.z - column.z) <= column.depth * 0.5 + footprint.halfZ,
  );
};

const addWorldLight = (world: WorldPlan, light: LightSlot, bounds?: Rect): void => {
  const snapped: LightSlot = {
    ...light,
    x: snapToCeilingTileCenter(light.x, world.size),
    z: snapToCeilingTileCenter(light.z, world.size),
  };
  if (bounds && !pointInRect(snapped.x, snapped.z, bounds, 0.58)) return;
  if (lightIsBlocked(world, snapped)) return;
  world.lights.push(snapped);
};

const addLight = (world: WorldPlan, room: RoomRecord, rng: SeededRandom, x: number, z: number, rotation: number): void => {
  addWorldLight(world, {
    id: `light-${world.lights.length}`,
    x,
    ceilingY: room.ceilingHeight,
    z,
    rotation,
    width: rng.chance(0.2) ? 1.18 : 1.55,
    intensity: rng.float(0.98, 1.18),
    color: rng.pick(temperatureColors),
    // This exploration build has no entities yet: all installed fixtures are
    // reliable. Their failure state remains in the data model for a later
    // monster/power-system pass.
    dead: false,
    unstable: false,
    phase: rng.float(0, Math.PI * 2),
    roomId: room.id,
    level: 0,
  }, room.bounds);
};

const populateLightsAndDetails = (world: WorldPlan, rootRng: SeededRandom): void => {
  for (const room of world.rooms) {
    const rng = rootRng.fork(`lighting:${room.id}`);
    const width = rectWidth(room.bounds);
    const depth = rectDepth(room.bounds);
    const center = rectCenter(room.bounds);
    const longX = width >= depth;

    if (room.kind === 'corridor') {
      const span = longX ? width : depth;
      const count = Math.max(2, Math.floor(span / rng.float(4.4, 5.8)));
      for (let index = 0; index < count; index += 1) {
        const along = -span * 0.5 + ((index + 0.5) / count) * span;
        const side = rng.chance(0.3) ? rng.float(-0.45, 0.45) : 0;
        addLight(
          world,
          room,
          rng.fork(`slot-${index}`),
          center.x + (longX ? along : side),
          center.z + (longX ? side : along),
          longX ? 0 : Math.PI * 0.5,
        );
      }
    } else if (room.kind === 'sparse') {
      const count = Math.max(1, Math.floor(rectArea(room.bounds) / 120));
      for (let index = 0; index < count; index += 1) {
        addLight(
          world,
          room,
          rng.fork(`slot-${index}`),
          rng.float(room.bounds.minX + 2.2, room.bounds.maxX - 2.2),
          rng.float(room.bounds.minZ + 2.2, room.bounds.maxZ - 2.2),
          rng.pick([0, Math.PI * 0.5]),
        );
      }
    } else {
      const spacingX = room.kind === 'open-hall' ? rng.float(5.8, 7.4) : rng.float(4.1, 5.4);
      const spacingZ = room.kind === 'open-hall' ? rng.float(5.6, 7.1) : rng.float(4.2, 5.5);
      const countX = Math.max(1, Math.floor((width - 2.6) / spacingX));
      const countZ = Math.max(1, Math.floor((depth - 2.6) / spacingZ));
      for (let xIndex = 0; xIndex < countX; xIndex += 1) {
        for (let zIndex = 0; zIndex < countZ; zIndex += 1) {
          if (countX * countZ > 4 && rng.chance(room.kind === 'threshold' ? 0.08 : 0.035)) continue;
          const x = room.bounds.minX + ((xIndex + 0.5) / countX) * width + rng.float(-0.25, 0.25);
          const z = room.bounds.minZ + ((zIndex + 0.5) / countZ) * depth + rng.float(-0.25, 0.25);
          addLight(world, room, rng.fork(`slot-${xIndex}-${zIndex}`), x, z, rng.pick([0, Math.PI * 0.5]));
        }
      }
    }

    const socketCount = Math.floor(room.detailDensity * rectArea(room.bounds) / 95);
    for (let index = 0; index < socketCount; index += 1) {
      let position: { x: number; y: number; z: number } | undefined;
      for (let attempt = 0; attempt < 8 && !position; attempt += 1) {
        const candidate = {
          x: rng.float(room.bounds.minX + 1.4, room.bounds.maxX - 1.4),
          y: 0,
          z: rng.float(room.bounds.minZ + 1.4, room.bounds.maxZ - 1.4),
        };
        if (!world.solidMasses.some((mass) => pointInRect(candidate.x, candidate.z, mass.bounds, -0.55))) {
          position = candidate;
        }
      }
      if (!position) continue;
      world.detailSockets.push({
        id: `socket-${room.id}-${index}`,
        roomId: room.id,
        kind: rng.weighted([
          { value: 'decal' as const, weight: 3 },
          { value: 'prop' as const, weight: 1.5 },
          { value: 'item' as const, weight: 0.6 },
          { value: 'audio' as const, weight: 0.8 },
          { value: 'future-entity' as const, weight: 0.1 },
        ]),
        position,
        clearance: rng.float(0.8, 1.7),
        tags: [room.kind, rng.pick(['dry', 'damp', 'quiet', 'exposed', 'liminal'])],
      });
    }
  }
};

const applyLightingZones = (world: WorldPlan, rootRng: SeededRandom): void => {
  const rng = rootRng.fork('lighting-zones');
  const lightsForRoom = (roomId: string): LightSlot[] =>
    world.lights.filter((light) => light.level >= 0 && light.roomId === roomId);
  const isSpawnRoom = (room: RoomRecord): boolean =>
    pointInRect(world.spawn.x, world.spawn.z, room.bounds);
  world.unlitZones = [];
  if (!rng.chance(UNLIT_ZONE_PRESENCE_RATE)) return;

  const candidates = world.rooms.filter((room) => {
    if (
      isSpawnRoom(room) ||
      room.kind === 'open-hall' ||
      room.kind === 'pit-gallery' ||
      rectArea(room.bounds) > 520
    ) return false;
    const center = rectCenter(room.bounds);
    return (
      lightsForRoom(room.id).length > 0 &&
      Math.hypot(center.x - world.spawn.x, center.z - world.spawn.z) >= 20
    );
  });
  if (candidates.length === 0) return;

  const anchor = rng.pick(candidates);
  const anchorCenter = rectCenter(anchor.bounds);
  const radius = rng.float(16, 25);
  const targetCount = rng.int(2, 6);
  const darkRooms = [...candidates]
    .map((room) => ({
      room,
      distance: Math.hypot(
        rectCenter(room.bounds).x - anchorCenter.x,
        rectCenter(room.bounds).z - anchorCenter.z,
      ),
    }))
    .filter(({ distance }) => distance <= radius)
    .sort((left, right) => left.distance - right.distance || left.room.id.localeCompare(right.room.id))
    .slice(0, targetCount)
    .map(({ room }) => room);
  if (darkRooms.length === 0) darkRooms.push(anchor);

  world.unlitZones = darkRooms.map((room) => ({ ...room.bounds }));
  for (const light of world.lights) {
    if (
      light.level >= 0 &&
      world.unlitZones.some((zone) => pointInRect(light.x, light.z, zone))
    ) light.dead = true;
  }
};

const populateVistaLights = (world: WorldPlan, vista: VistaFeature, rootRng: SeededRandom): void => {
  const rng = rootRng.fork('vista-lighting');
  const count = 8;
  for (let index = 0; index < count; index += 1) {
    for (const lane of [-1, 1] as const) {
      addWorldLight(world, {
        id: `vista-light-${lane}-${index}`,
        x: vista.bounds.minX + 4.5 + index * ((rectWidth(vista.bounds) - 9) / Math.max(1, count - 1)),
        ceilingY: vista.height,
        z: vista.centerZ + lane * 3.7,
        rotation: 0,
        width: 1.75,
        intensity: rng.float(1.35, 1.7),
        color: rng.pick(temperatureColors),
        dead: false,
        unstable: false,
        phase: rng.float(0, Math.PI * 2),
        roomId: vista.id,
        level: 0,
      }, vista.bounds);
    }
  }
};

export const addStepColliders = (world: WorldPlan, stairs: StairSocketFeature): void => {
  for (const [index, shape] of getStairCollisionShapes(stairs).entries()) {
    world.colliders.push({
      id: `${stairs.id}-${shape.kind}-${index}`,
      center: shape.center,
      halfExtents: shape.halfExtents,
      rotation: shape.rotation,
      kind: 'step',
    });
  }
  const center = rectCenter(stairs.bounds);
  const alongX = stairs.heading.startsWith('x');
  const wallThickness = 0.16;
  const baseY = stairs.baseY ?? 0;
  const cageWalls = alongX
    ? [
        {
          x: center.x,
          z: stairs.bounds.minZ - wallThickness * 0.5,
          halfX: rectWidth(stairs.bounds) * 0.5,
          halfZ: wallThickness * 0.5,
        },
        {
          x: center.x,
          z: stairs.bounds.maxZ + wallThickness * 0.5,
          halfX: rectWidth(stairs.bounds) * 0.5,
          halfZ: wallThickness * 0.5,
        },
      ]
    : [
        {
          x: stairs.bounds.minX - wallThickness * 0.5,
          z: center.z,
          halfX: wallThickness * 0.5,
          halfZ: rectDepth(stairs.bounds) * 0.5,
        },
        {
          x: stairs.bounds.maxX + wallThickness * 0.5,
          z: center.z,
          halfX: wallThickness * 0.5,
          halfZ: rectDepth(stairs.bounds) * 0.5,
        },
      ];
  for (const [index, wall] of cageWalls.entries()) {
    world.colliders.push({
      id: `${stairs.id}-cage-wall-${index}`,
      center: {
        x: wall.x,
        y: baseY + STAIR_STORY_RISE * 0.5,
        z: wall.z,
      },
      halfExtents: {
        x: wall.halfX,
        y: STAIR_STORY_RISE * 0.5,
        z: wall.halfZ,
      },
      kind: 'wall',
    });
  }
};

export const generateWorld = (seed: string): WorldPlan => {
  const rootRng = new SeededRandom(`${seed}:v${GENERATOR_VERSION}`);
  const surfaceRng = rootRng.fork('surface-style');
  const surfaceProfile = surfaceRng.weighted([
    { value: 'balanced' as const, weight: 0.7 },
    { value: 'faded' as const, weight: 0.16 },
    { value: 'dense' as const, weight: 0.14 },
  ]);
  const surfaceStyle: SurfaceStyle = {
    wallTint: surfaceProfile === 'faded'
      ? surfaceRng.float(0.9, 0.98)
      : surfaceProfile === 'dense'
        ? surfaceRng.float(0.96, 1.08)
        : surfaceRng.float(0.94, 1.04),
    floorTint: surfaceProfile === 'faded'
      ? surfaceRng.float(0.82, 0.94)
      : surfaceProfile === 'dense'
        ? surfaceRng.float(0.96, 1.1)
        : surfaceRng.float(0.9, 1.04),
    ceilingTint: surfaceRng.float(0.93, 1.06),
    wallPatternScale: surfaceRng.float(0.68, 1.48),
    floorPatternScale: surfaceRng.float(0.62, 1.72),
    ceilingPatternScale: surfaceRng.float(0.78, 1.32),
    floorQuarterTurn: surfaceRng.chance(0.5),
  };
  const half = WORLD_SIZE * 0.5;
  const worldBounds: Rect = { minX: -half, minZ: -half, maxX: half, maxZ: half };
  const mutable: MutablePlan = { walls: [], rooms: [], colliders: [], portals: [], wallIndex: 0 };

  const vista = addOuterShellAndVista(mutable, worldBounds, rootRng.fork('outer-shell'));
  splitWorldWithGrandHall(worldBounds, rootRng.fork('topology'), mutable);
  enforcePortalClearances(mutable);

  const spawnCandidates = mutable.rooms.filter((room) => {
    const area = rectArea(room.bounds);
    return area >= 65 && area <= 230 && room.kind !== 'open-hall';
  });
  const spawnRoom = [...(spawnCandidates.length > 0 ? spawnCandidates : mutable.rooms)]
    .sort((a, b) => {
      const aCenter = rectCenter(a.bounds);
      const bCenter = rectCenter(b.bounds);
      const aScore = Math.hypot(aCenter.x, aCenter.z) + Math.abs(rectArea(a.bounds) - 125) * 0.014;
      const bScore = Math.hypot(bCenter.x, bCenter.z) + Math.abs(rectArea(b.bounds) - 125) * 0.014;
      return aScore - bScore;
    })[0] ?? mutable.rooms[0]!;
  spawnRoom.kind = 'office';
  const spawnCenter = rectCenter(spawnRoom.bounds);

  const world: WorldPlan = {
    version: GENERATOR_VERSION,
    seed,
    size: WORLD_SIZE,
    wallHeight: WALL_HEIGHT,
    rooms: mutable.rooms,
    walls: mutable.walls,
    columns: [],
    solidMasses: [],
    lights: [],
    missingCeilingTiles: [],
    features: [vista],
    detailSockets: [],
    colliders: mutable.colliders,
    floorRects: [],
    visualBiome: 'yellow',
    surfaceStyle,
    spawn: { x: spawnCenter.x, y: 0.9, z: spawnCenter.z },
  };

  const reservedRoomIds = new Set<string>([spawnRoom.id]);
  const regularPitRooms = [...world.rooms]
    .filter(
      (room) =>
        room.id !== spawnRoom.id &&
        room.kind !== 'open-hall' &&
        rectWidth(room.bounds) >= 13 &&
        rectDepth(room.bounds) >= 10.5 &&
        Math.hypot(rectCenter(room.bounds).x - world.spawn.x, rectCenter(room.bounds).z - world.spawn.z) > 16,
    )
    .sort((a, b) => rectArea(b.bounds) - rectArea(a.bounds));
  const monumentalPitRoom = [...world.rooms]
    .filter(
      (room) =>
        room.id !== spawnRoom.id &&
        room.kind === 'open-hall' &&
        rectWidth(room.bounds) >= 20 &&
        rectDepth(room.bounds) >= 20,
    )
    .sort((a, b) => rectArea(b.bounds) - rectArea(a.bounds))[0];
  const monumentalPitChance = monumentalPitRoom
    ? rectArea(monumentalPitRoom.bounds) >= 4_500
      ? 0.38
      : rectArea(monumentalPitRoom.bounds) >= 2_200
        ? 0.34
        : rectArea(monumentalPitRoom.bounds) >= 1_000
          ? 0.26
          : 0.16
    : 0;
  const pitRoom = monumentalPitRoom && rootRng.fork('feature:grid-pit:scale').chance(monumentalPitChance)
    ? monumentalPitRoom
    : regularPitRooms[0];

  let pit: GridPitFeature | undefined;
  if (pitRoom && rootRng.fork('feature:grid-pit:presence').chance(PIT_PRESENCE_RATE)) {
    const deepVoidRng = rootRng.fork('feature:grid-pit:void');
    pit = buildGridPit(
      pitRoom,
      rootRng.fork('feature:grid-pit'),
      worldBounds,
      choosePitStoryDepth(rootRng.fork('feature:grid-pit:depth')),
      deepVoidRng.chance(0.055) ? deepVoidRng : undefined,
    );
    if (pitRoom.kind !== 'open-hall') pitRoom.kind = 'pit-gallery';
    reservedRoomIds.add(pitRoom.id);
    world.features.push(pit);
  }

  const registry = createDefaultFeatureRegistry();
  const stairDefinition = registry.get('stair-socket');
  if (stairDefinition && rootRng.fork('feature:stairs:presence').chance(0.84)) {
    const feature = stairDefinition.propose(
      { rooms: world.rooms, seed, worldBounds, reservedRoomIds },
      rootRng.fork('feature:stairs'),
    );
    if (feature?.kind === 'stair-socket') {
      world.features.push(feature);
      reservedRoomIds.add(feature.roomId);
      addStepColliders(world, feature);
    }
  }

  // A single discoverable breathing space keeps the special-room vocabulary
  // without letting open halls replace the Level 0 maze. Prefer a large room
  // that has not already been claimed by the pit, stairs or spawn.
  if (!world.rooms.some((room) => room.kind === 'open-hall')) {
    const hallCandidates = world.rooms
      .filter(
        (room) =>
          !reservedRoomIds.has(room.id) &&
          rectWidth(room.bounds) >= 12 &&
          rectDepth(room.bounds) >= 12 &&
          Math.hypot(rectCenter(room.bounds).x - world.spawn.x, rectCenter(room.bounds).z - world.spawn.z) > 16,
      )
      .sort((a, b) => rectArea(b.bounds) - rectArea(a.bounds));
    if (hallCandidates.length > 0) {
      const shortlist = hallCandidates.slice(0, Math.min(5, hallCandidates.length));
      rootRng.fork('feature:open-hall').pick(shortlist).kind = 'open-hall';
    }
  }

  addCeilingVariations(mutable, world, reservedRoomIds, rootRng);
  addRaisedZones(world, reservedRoomIds, rootRng);
  addSqueezeViews(mutable, world, reservedRoomIds, rootRng);
  addColumnsAndPartialWalls(mutable, world, reservedRoomIds, rootRng);
  enforcePortalClearances(mutable);
  world.walls = mutable.walls;
  world.colliders = mutable.colliders;
  addSolidMasses(world, reservedRoomIds, rootRng);
  populateLightsAndDetails(world, rootRng);
  applyLightingZones(world, rootRng);
  populateVistaLights(world, vista, rootRng);

  const holes = [
    ...(pit?.holes ?? []),
    ...world.features.flatMap((feature) =>
      feature.kind === 'squeeze-view' ? feature.holes ?? [] : []
    ),
  ];
  world.floorOpenings = holes.map((hole) => ({
    minX: hole.minX,
    minZ: hole.minZ,
    maxX: hole.maxX,
    maxZ: hole.maxZ,
  }));
  world.floorRects = floorCellsAroundHoles(worldBounds, holes);
  world.floorRects.forEach((floor, index) => {
    world.colliders.push({
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
  });
  if (pit) addLowerLevel(world, pit, rootRng);

  return world;
};

export const fingerprintWorld = (world: WorldPlan): string => {
  const payload = [
    world.version,
    world.seed,
    world.rooms.map((room) => `${room.id}:${room.kind}:${rectArea(room.bounds).toFixed(2)}`).join('|'),
    world.walls
      .map((wall) => `${wall.orientation}:${wall.x.toFixed(2)}:${wall.z.toFixed(2)}:${wall.length.toFixed(2)}`)
      .join('|'),
    world.features.map((feature) => feature.id).join('|'),
    world.lights.map((light) => `${light.x}:${light.z}:${Number(light.dead)}`).join('|'),
  ].join('::');
  let hash = 2166136261;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const validateWorldPlan = (world: WorldPlan): string[] => {
  const issues: string[] = [];
  if (world.rooms.length < 5) issues.push('The topology contains too few rooms.');
  if (world.lights.length < 8) issues.push('The light field is too sparse.');
  if (!world.floorRects.some((rect) => pointInRect(world.spawn.x, world.spawn.z, rect))) {
    issues.push('Spawn is not located over a valid floor surface.');
  }
  return issues;
};
