import { createDefaultFeatureRegistry } from './FeatureRegistry';
import {
  getPassageHoleAbyssBottom,
  getPassageHolePreviewBounds,
  PASSAGE_HOLE_LOWER_CEILING_Y,
  PASSAGE_HOLE_LOWER_FLOOR_Y,
} from './PassageHoleLayout';
import { SeededRandom } from './SeededRandom';
import { getStairCageWalls, getStairCollisionShapes } from './StairLayout';
import type {
  CeilingZone,
  DoorRoomContent,
  GridPitFeature,
  InteractiveDoorFeature,
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

const GENERATOR_VERSION = 10;
const WORLD_SIZE = 112;
const WALL_HEIGHT = 2.74;
const WALL_THICKNESS = 0.22;
const MAX_STRUCTURAL_WALL_THICKNESS = 2.8;
const MIN_ROOM_SPAN = 7;
const PARTITION_ENDPOINT_PORTAL_CLEARANCE = 1.45;
const CORNER_PORTAL_JUNCTION_RATE = 0.025;
const PIT_STORY_PITCH = 5.4;
export const MAX_PIT_STORIES = 12;
const PASSAGE_VOID_PRESENCE_RATE = 0.12;
const WALL_BREACH_VOID_PRESENCE_RATE = 0.07;
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
  { value: 1, weight: 0.39 },
  { value: 2, weight: 0.24 },
  { value: 3, weight: 0.17 },
  { value: 4, weight: 0.12 },
  { value: 5, weight: 0.08 },
]);

export const worldHasPit = (seed: string): boolean => {
  const rootRng = new SeededRandom(`${seed}:v${GENERATOR_VERSION}`);
  return rootRng.fork('feature:grid-pit:presence').chance(PIT_PRESENCE_RATE);
};

export const worldMaxPitStories = (seed: string): number => {
  if (!worldHasPit(seed)) return 0;
  const rootRng = new SeededRandom(`${seed}:v${GENERATOR_VERSION}`);
  const voidRng = rootRng.fork('feature:grid-pit:void');
  return voidRng.chance(0.055)
    ? MAX_PIT_STORIES
    : choosePitStoryDepth(rootRng.fork('feature:grid-pit:depth'));
};

const worldMayHavePassageVoid = (seed: string): boolean => {
  const rootRng = new SeededRandom(`${seed}:v${GENERATOR_VERSION}`);
  return (
    rootRng.fork('feature:squeeze-hole:void').chance(PASSAGE_VOID_PRESENCE_RATE) ||
    rootRng.fork('feature:wall-breach-hole:void').chance(WALL_BREACH_VOID_PRESENCE_RATE)
  );
};

export const worldMaxShaftStories = (seed: string): number =>
  Math.max(
    worldMaxPitStories(seed),
    worldMayHavePassageVoid(seed) ? MAX_PIT_STORIES : 0,
  );

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
  minimumLength = 0.18,
): WallSegment | null => {
  if (input.length < minimumLength || input.height < 0.08) return null;
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
  const compact = span < 10;
  const profile = rng.weighted([
    { value: 'thin' as const, weight: compact ? 0.14 : 0.09 },
    { value: 'solid' as const, weight: compact ? 0.24 : 0.18 },
    { value: 'thick' as const, weight: compact ? 0.48 : 0.45 },
    { value: 'massive' as const, weight: compact ? 0.14 : 0.28 },
  ]);
  const thickness = profile === 'thin'
    ? rng.pick([WALL_THICKNESS, 0.32, 0.42])
    : profile === 'solid'
      ? rng.float(0.68, compact ? 0.96 : 1.08)
      : profile === 'thick'
        ? rng.float(compact ? 1.02 : 1.16, compact ? 1.48 : 1.78)
        : rng.float(compact ? 1.56 : 1.92, compact ? 1.94 : MAX_STRUCTURAL_WALL_THICKNESS);
  return quantize(thickness, 0.05);
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
    if (wall.detail === 'upper-shell' || wall.detail === 'upper-portal-lintel') {
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
        { value: 1, weight: 0.62 },
        { value: 2, weight: 0.3 },
        { value: 3, weight: 0.08 },
      ])
    : span >= 27
      ? (rng.chance(0.2) ? 2 : 1)
      : 1;
  const mirrored = count > 1 && rng.chance(0.72);
  const jitter = mirrored ? rng.float(-0.055, 0.055) : 0;
  const gaps: Gap[] = [];
  for (let index = 0; index < count; index += 1) {
    const evenLane = (index + 1) / (count + 1);
    const lane = mirrored
      ? evenLane + (index < count * 0.5 ? jitter : -jitter)
      : clamp(evenLane + rng.float(-0.12, 0.12), 0.14, 0.86);
    const width = rng.chance(0.14) ? rng.float(3.5, 5.2) : rng.float(2.15, 3.2);
    const endReturn = Math.min(1.15, Math.max(0.72, span * 0.045));
    const center = quantize(
      clamp(
        spanMin + span * lane,
        spanMin + endReturn + width * 0.5,
        spanMax - endReturn - width * 0.5,
      ),
      0.25,
    );
    gaps.push({ min: center - width * 0.5, max: center + width * 0.5 });
  }
  return gaps;
};

const partitionEndsNearPortal = (
  plan: MutablePlan,
  orientation: 'x' | 'z',
  split: number,
  bounds: Rect,
): boolean => {
  const endpointMin = orientation === 'z' ? bounds.minZ : bounds.minX;
  const endpointMax = orientation === 'z' ? bounds.maxZ : bounds.maxX;
  return plan.portals.some((portal) => {
    if (portal.orientation === orientation) return false;
    const fixed = portal.orientation === 'x' ? portal.z : portal.x;
    if (
      Math.abs(fixed - endpointMin) >= 0.08 &&
      Math.abs(fixed - endpointMax) >= 0.08
    ) return false;
    const along = portal.orientation === 'x' ? portal.x : portal.z;
    return Math.abs(split - along) < portal.width * 0.5 + PARTITION_ENDPOINT_PORTAL_CLEARANCE;
  });
};

const moveSplitAwayFromPortalCorners = (
  plan: MutablePlan,
  orientation: 'x' | 'z',
  tentativeSplit: number,
  bounds: Rect,
  splitMin: number,
  splitMax: number,
  rng: SeededRandom,
): number => {
  if (!partitionEndsNearPortal(plan, orientation, tentativeSplit, bounds)) {
    return tentativeSplit;
  }
  // A few awkward T-junctions keep the layout from looking over-designed, but
  // they should be an exception rather than the default result of BSP recursion.
  if (rng.fork('corner-variation').chance(CORNER_PORTAL_JUNCTION_RATE)) {
    return tentativeSplit;
  }

  const candidates: number[] = [];
  for (
    let candidate = Math.ceil(splitMin * 2) * 0.5;
    candidate <= splitMax + 1e-6;
    candidate += 0.5
  ) {
    if (!partitionEndsNearPortal(plan, orientation, candidate, bounds)) {
      candidates.push(candidate);
    }
  }
  if (candidates.length === 0) return tentativeSplit;

  const nearestDistance = Math.min(
    ...candidates.map((candidate) => Math.abs(candidate - tentativeSplit)),
  );
  const nearest = candidates.filter(
    (candidate) => Math.abs(Math.abs(candidate - tentativeSplit) - nearestDistance) < 1e-6,
  );
  return rng.fork('safe-side').pick(nearest);
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
    const splitMin = bounds.minX + MIN_ROOM_SPAN;
    const splitMax = bounds.maxX - MIN_ROOM_SPAN;
    const tentativeSplit = quantize(
      clamp(
        bounds.minX + width * rng.float(0.3, 0.7),
        splitMin,
        splitMax,
      ),
      0.5,
    );
    const split = moveSplitAwayFromPortalCorners(
      plan,
      'z',
      tentativeSplit,
      bounds,
      splitMin,
      splitMax,
      rng.fork('split-clearance'),
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
    const splitMin = bounds.minZ + MIN_ROOM_SPAN;
    const splitMax = bounds.maxZ - MIN_ROOM_SPAN;
    const tentativeSplit = quantize(
      clamp(
        bounds.minZ + roomDepth * rng.float(0.3, 0.7),
        splitMin,
        splitMax,
      ),
      0.5,
    );
    const split = moveSplitAwayFromPortalCorners(
      plan,
      'x',
      tentativeSplit,
      bounds,
      splitMin,
      splitMax,
      rng.fork('split-clearance'),
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
    const endReturn = Math.min(1.5, Math.max(0.82, span * 0.045));
    const usableHalfSpan = Math.max(
      width * 0.5,
      span * 0.5 - width * 0.5 - endReturn,
    );
    const gaps: Gap[] = [];
    for (let pair = 0; pair < pairCount; pair += 1) {
      const distance = usableHalfSpan * ((pair + 1) / (pairCount + 1));
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
  const sidePairCount = longSpan >= 72 ? 2 : 1;
  const sideGaps = symmetricGaps(longMin, longMax, sidePairCount, rng.float(2.15, 3.5));
  const sideWallThickness = choosePartitionThickness(rng.fork('side-wall-thickness'), longSpan);
  const endWallThickness = choosePartitionThickness(rng.fork('end-wall-thickness'), crossSpan);

  if (longAlongX) {
    wallAroundGaps(plan, rng.fork('north-hall-wall'), 'x', hall.minZ, hall.minX, hall.maxX, sideGaps, 'wallpaper', sideWallThickness);
    wallAroundGaps(plan, rng.fork('south-hall-wall'), 'x', hall.maxZ, hall.minX, hall.maxX, sideGaps, 'wallpaper', sideWallThickness);
    wallAroundGaps(plan, rng.fork('west-hall-wall'), 'z', hall.minX, hall.minZ, hall.maxZ, endGaps, 'wallpaper', endWallThickness);
    wallAroundGaps(plan, rng.fork('east-hall-wall'), 'z', hall.maxX, hall.minZ, hall.maxZ, endGaps, 'wallpaper', endWallThickness);
  } else {
    wallAroundGaps(plan, rng.fork('west-hall-wall'), 'z', hall.minX, hall.minZ, hall.maxZ, sideGaps, 'wallpaper', sideWallThickness);
    wallAroundGaps(plan, rng.fork('east-hall-wall'), 'z', hall.maxX, hall.minZ, hall.maxZ, sideGaps, 'wallpaper', sideWallThickness);
    wallAroundGaps(plan, rng.fork('north-hall-wall'), 'x', hall.minZ, hall.minX, hall.maxX, endGaps, 'wallpaper', endWallThickness);
    wallAroundGaps(plan, rng.fork('south-hall-wall'), 'x', hall.maxZ, hall.minX, hall.maxX, endGaps, 'wallpaper', endWallThickness);
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
    );
  } else if (pattern === 'large-grid') {
    addRegularGrid(
      rng.float(3.1, 7.4),
      rng.float(3.1, 7.4),
      rng.float(0.7, 5.8),
      rng.float(0.7, 5.8),
      monumental ? 11 : 7,
      monumental ? 11 : 7,
    );
  } else if (pattern === 'dense-grid') {
    addRegularGrid(
      rng.float(2.25, 4.8),
      rng.float(2.25, 4.8),
      rng.float(0.38, 1.2),
      rng.float(0.38, 1.2),
      monumental ? 16 : 9,
      monumental ? 16 : 9,
    );
  } else if (pattern === 'mixed-grid') {
    // The rare mixed family varies the spacing between rooms, never the cells
    // inside one room: a complete repeated lattice reads as intentional and
    // keeps both reflection axes intact.
    addRegularGrid(
      rng.float(1.6, 3.8),
      rng.float(1.6, 3.8),
      rng.float(1.8, 5.4),
      rng.float(1.8, 5.4),
      monumental ? 12 : 7,
      monumental ? 12 : 7,
    );
  } else {
    // Large clusters keep one size family and a complete lattice. Scale and
    // spacing can change between rooms without creating visual noise locally.
    addRegularGrid(
      rng.float(3.5, 7.8),
      rng.float(3.5, 7.8),
      rng.float(1.4, 7.2),
      rng.float(1.4, 7.2),
      monumental ? 10 : 6,
      monumental ? 10 : 6,
    );
  }

  // Every aperture in a room belongs to one vertical destination. Mixing a
  // shallow landing, a deep shaft and an abyss in the same repeated pattern
  // breaks both its visual rhythm and its streaming contract.
  const holeKind = deepVoidRng ? 'void' as const : 'drop' as const;
  const stories = deepVoidRng ? MAX_PIT_STORIES : dropStories;
  for (const hole of holes) {
    hole.kind = holeKind;
    hole.stories = stories;
    hole.depth = stories * dropDepth;
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

const floorCellsAroundHoles = (world: Rect, holes: readonly Rect[]): Rect[] => {
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
  const northSouthThickness = choosePartitionThickness(rng.fork('north-south-thickness'), rectWidth(bounds));
  const eastWestThickness = choosePartitionThickness(rng.fork('east-west-thickness'), rectDepth(bounds));

  wallAroundGaps(plan, rng.fork('north'), 'x', bounds.minZ, bounds.minX, bounds.maxX, [], 'wallpaper', northSouthThickness);
  wallAroundGaps(plan, rng.fork('south'), 'x', bounds.maxZ, bounds.minX, bounds.maxX, [], 'wallpaper', northSouthThickness);
  wallAroundGaps(plan, rng.fork('west'), 'z', bounds.minX, bounds.minZ, bounds.maxZ, [], 'wallpaper', eastWestThickness);
  wallAroundGaps(plan, rng.fork('east'), 'z', bounds.maxX, bounds.minZ, bounds.maxZ, [sideGap, standardEntryGap], 'wallpaper', eastWestThickness);

  addWall(plan, rng.fork('sill'), {
    x: bounds.maxX,
    z: apertureCenterZ,
    length: apertureWidth,
    orientation: 'z',
    bottom: 0,
    height: openingBottom,
    thickness: eastWestThickness,
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
    thickness: eastWestThickness,
    collision: false,
    kind: 'vista-frame',
    tint: 0.96,
  });

  plan.colliders.push({
    id: 'vista-aperture-barrier',
    center: { x: bounds.maxX, y: WALL_HEIGHT * 0.5, z: apertureCenterZ },
    halfExtents: { x: eastWestThickness * 0.5, y: WALL_HEIGHT * 0.5, z: apertureWidth * 0.5 },
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

interface RoomPortalEdge {
  portal: MutablePlan['portals'][number];
  firstRoom: RoomRecord;
  secondRoom: RoomRecord;
}

const roomPortalEdges = (
  plan: MutablePlan,
  rooms: readonly RoomRecord[],
): RoomPortalEdge[] => {
  const edges: RoomPortalEdge[] = [];
  const seen = new Set<string>();
  for (const portal of plan.portals) {
    const along = portal.orientation === 'x' ? portal.x : portal.z;
    const fixed = portal.orientation === 'x' ? portal.z : portal.x;
    const firstRooms = rooms.filter((room) => {
      const boundary = portal.orientation === 'x' ? room.bounds.maxZ : room.bounds.maxX;
      const min = portal.orientation === 'x' ? room.bounds.minX : room.bounds.minZ;
      const max = portal.orientation === 'x' ? room.bounds.maxX : room.bounds.maxZ;
      return Math.abs(boundary - fixed) < 0.08 && along > min + 0.12 && along < max - 0.12;
    });
    const secondRooms = rooms.filter((room) => {
      const boundary = portal.orientation === 'x' ? room.bounds.minZ : room.bounds.minX;
      const min = portal.orientation === 'x' ? room.bounds.minX : room.bounds.minZ;
      const max = portal.orientation === 'x' ? room.bounds.maxX : room.bounds.maxZ;
      return Math.abs(boundary - fixed) < 0.08 && along > min + 0.12 && along < max - 0.12;
    });
    for (const firstRoom of firstRooms) {
      for (const secondRoom of secondRooms) {
        const key = `${portal.orientation}:${portal.x.toFixed(2)}:${portal.z.toFixed(2)}:${firstRoom.id}:${secondRoom.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ portal, firstRoom, secondRoom });
      }
    }
  }
  return edges;
};

const adjacencyFromPortalEdges = (
  rooms: readonly RoomRecord[],
  edges: readonly RoomPortalEdge[],
): Map<string, Set<string>> => {
  const adjacency = new Map(rooms.map((room) => [room.id, new Set<string>()]));
  for (const edge of edges) {
    adjacency.get(edge.firstRoom.id)?.add(edge.secondRoom.id);
    adjacency.get(edge.secondRoom.id)?.add(edge.firstRoom.id);
  }
  return adjacency;
};

const growConnectedRoomCluster = (
  anchor: RoomRecord,
  desiredCount: number,
  availableIds: ReadonlySet<string>,
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  roomsById: ReadonlyMap<string, RoomRecord>,
  rng: SeededRandom,
): RoomRecord[] => {
  const selected = new Set<string>([anchor.id]);
  const cluster = [anchor];
  while (cluster.length < desiredCount) {
    const frontier = [...selected].flatMap((roomId) =>
      [...(adjacency.get(roomId) ?? [])]
        .filter((neighborId) => availableIds.has(neighborId) && !selected.has(neighborId))
        .map((neighborId) => roomsById.get(neighborId))
        .filter((room): room is RoomRecord => room !== undefined)
    );
    const unique = [...new Map(frontier.map((room) => [room.id, room])).values()];
    if (unique.length === 0) break;
    const next = rng.weighted(unique.map((room) => ({
      value: room,
      weight: Math.max(0.35, Math.sqrt(rectArea(room.bounds)) / 7),
    })));
    selected.add(next.id);
    cluster.push(next);
  }
  return cluster;
};

const addCeilingVariations = (
  plan: MutablePlan,
  world: WorldPlan,
  reservedRoomIds: Set<string>,
  rootRng: SeededRandom,
): void => {
  const rng = rootRng.fork('ceiling-variations');
  const half = world.size * 0.5;
  const elevationFeatures = world.features.filter(
    (feature): feature is RaisedZoneFeature => feature.kind === 'raised-zone',
  );
  const elevationRoomIds = new Set(
    elevationFeatures.flatMap((feature) => feature.roomIds ?? [feature.roomId]),
  );
  const insetCandidates = world.rooms.filter(
    (room) =>
      (!reservedRoomIds.has(room.id) || elevationRoomIds.has(room.id)) &&
      !roomIsRestricted(room) &&
      room.bounds.minX > -half + 0.85 &&
      room.bounds.minZ > -half + 0.85 &&
      room.bounds.maxX < half - 0.85 &&
      room.bounds.maxZ < half - 0.85,
  );
  world.ceilingZones = [];
  if (insetCandidates.length === 0) return;

  const edges = roomPortalEdges(plan, world.rooms);
  const adjacency = adjacencyFromPortalEdges(world.rooms, edges);
  const roomsById = new Map(world.rooms.map((room) => [room.id, room]));
  const availableIds = new Set(insetCandidates.map((room) => room.id));
  for (const [featureIndex, feature] of elevationFeatures.entries()) {
    const zoneRng = rng.fork(`elevation-district:${featureIndex}`);
    const rooms = (feature.roomIds ?? [feature.roomId])
      .map((roomId) => roomsById.get(roomId))
      .filter((room): room is RoomRecord =>
        room !== undefined && availableIds.has(room.id)
      );
    if (rooms.length === 0) continue;
    const scale: CeilingZone['scale'] = zoneRng.weighted([
      { value: 'medium' as const, weight: 0.58 },
      { value: 'high' as const, weight: 0.34 },
      { value: 'vast' as const, weight: 0.08 },
    ]);
    const sampledHeight = scale === 'medium'
      ? zoneRng.float(3.45, 4.45)
      : scale === 'high'
        ? zoneRng.float(4.7, 6.2)
        : zoneRng.float(7.1, 9.2);
    const height = quantize(
      Math.max(sampledHeight, Math.max(0, feature.elevation) + 2.45),
      0.05,
    );
    for (const room of rooms) {
      room.ceilingHeight = height;
      availableIds.delete(room.id);
    }
    world.ceilingZones.push({
      id: `ceiling-elevation-zone-${featureIndex}`,
      roomIds: rooms.map((room) => room.id),
      height,
      scale,
    });
  }
  const zoneCount = Math.min(
    3,
    rng.weighted([
      { value: 1, weight: 0.48 },
      { value: 2, weight: 0.39 },
      { value: 3, weight: 0.13 },
    ]),
  );
  for (let zoneIndex = 0; zoneIndex < zoneCount && availableIds.size > 0; zoneIndex += 1) {
    const zoneRng = rng.fork(`district:${zoneIndex}`);
    const anchors = insetCandidates.filter((room) => availableIds.has(room.id));
    if (anchors.length === 0) break;
    const anchorPool = anchors
      .filter((room) =>
        (adjacency.get(room.id)?.size ?? 0) > 0 &&
        (room.kind === 'open-hall' || room.kind === 'sparse' || rectArea(room.bounds) >= 120)
      );
    const anchor = zoneRng.pick(anchorPool.length > 0 ? anchorPool : anchors);
    const desiredCount = zoneRng.weighted([
      { value: 2, weight: 0.24 },
      { value: 3, weight: 0.31 },
      { value: 4, weight: 0.24 },
      { value: 5, weight: 0.14 },
      { value: 6, weight: 0.07 },
    ]);
    const rooms = growConnectedRoomCluster(
      anchor,
      desiredCount,
      availableIds,
      adjacency,
      roomsById,
      zoneRng,
    );
    if (rooms.length < 2) {
      availableIds.delete(anchor.id);
      zoneIndex -= 1;
      continue;
    }
    const scale: CeilingZone['scale'] = zoneRng.weighted([
      { value: 'medium' as const, weight: 0.34 },
      { value: 'high' as const, weight: 0.3 },
      { value: 'vast' as const, weight: 0.25 },
      { value: 'colossal' as const, weight: 0.11 },
    ]);
    const maximumFloorElevation = Math.max(
      0,
      ...world.features
        .filter((feature): feature is RaisedZoneFeature => feature.kind === 'raised-zone')
        .filter((feature) =>
          (feature.roomIds ?? [feature.roomId]).some((roomId) =>
            rooms.some((room) => room.id === roomId)
          )
        )
        .map((feature) => feature.elevation),
    );
    const sampledHeight = scale === 'medium'
      ? zoneRng.float(3.25, 4.35)
      : scale === 'high'
        ? zoneRng.float(4.7, 6.4)
        : scale === 'vast'
          ? zoneRng.float(7.2, 10.8)
          : zoneRng.float(12, 17.5);
    const height = quantize(Math.max(sampledHeight, maximumFloorElevation + 2.45), 0.05);
    for (const room of rooms) {
      room.ceilingHeight = height;
      availableIds.delete(room.id);
    }
    world.ceilingZones.push({
      id: `ceiling-zone-${zoneIndex}`,
      roomIds: rooms.map((room) => room.id),
      height,
      scale,
    });
  }

  interface UpperShellClaim {
    orientation: 'x' | 'z';
    fixed: number;
    min: number;
    max: number;
    height: number;
    roomId: string;
  }
  const claims: UpperShellClaim[] = [];
  for (const room of world.rooms.filter(
    (candidate) => candidate.ceilingHeight > world.wallHeight + 0.1,
  )) {
    claims.push(
      {
        orientation: 'x',
        fixed: room.bounds.minZ,
        min: room.bounds.minX,
        max: room.bounds.maxX,
        height: room.ceilingHeight,
        roomId: room.id,
      },
      {
        orientation: 'x',
        fixed: room.bounds.maxZ,
        min: room.bounds.minX,
        max: room.bounds.maxX,
        height: room.ceilingHeight,
        roomId: room.id,
      },
      {
        orientation: 'z',
        fixed: room.bounds.minX,
        min: room.bounds.minZ,
        max: room.bounds.maxZ,
        height: room.ceilingHeight,
        roomId: room.id,
      },
      {
        orientation: 'z',
        fixed: room.bounds.maxX,
        min: room.bounds.minZ,
        max: room.bounds.maxZ,
        height: room.ceilingHeight,
        roomId: room.id,
      },
    );
  }
  const groupedClaims = new Map<string, UpperShellClaim[]>();
  for (const claim of claims) {
    const key = `${claim.orientation}:${claim.fixed.toFixed(3)}`;
    const group = groupedClaims.get(key) ?? [];
    group.push(claim);
    groupedClaims.set(key, group);
  }
  let shellIndex = 0;
  for (const group of groupedClaims.values()) {
    const orientation = group[0]!.orientation;
    const fixed = group[0]!.fixed;
    const baseWalls = plan.walls.filter((wall) => {
      if (
        wall.orientation !== orientation ||
        Math.abs(wall.bottom) > 0.02 ||
        wall.bottom + wall.height < world.wallHeight - 0.08
      ) return false;
      const wallFixed = wall.orientation === 'x' ? wall.z : wall.x;
      return Math.abs(wallFixed - fixed) < 0.12;
    });
    const points = [...new Set([
      ...group.flatMap((claim) => [claim.min, claim.max]),
      ...baseWalls.flatMap((wall) => {
        const center = wall.orientation === 'x' ? wall.x : wall.z;
        return [center - wall.length * 0.5, center + wall.length * 0.5];
      }).filter((point) =>
        group.some((claim) => point > claim.min + 0.01 && point < claim.max - 0.01)
      ),
    ])]
      .sort((left, right) => left - right);
    for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex += 1) {
      const min = points[pointIndex]!;
      const max = points[pointIndex + 1]!;
      if (max - min < 0.01) continue;
      const midpoint = (min + max) * 0.5;
      const covering = group.filter((claim) => midpoint > claim.min - 0.02 && midpoint < claim.max + 0.02);
      if (covering.length === 0) continue;
      const owner = [...covering].sort((left, right) => right.height - left.height)[0]!;
      const supportingWalls = baseWalls.filter((wall) => {
        const wallCenter = wall.orientation === 'x' ? wall.x : wall.z;
        return (
          midpoint > wallCenter - wall.length * 0.5 + 0.01 &&
          midpoint < wallCenter + wall.length * 0.5 - 0.01
        );
      });
      const nearestWalls = [...baseWalls].sort((left, right) => {
        const distanceTo = (wall: WallSegment): number => {
          const center = wall.orientation === 'x' ? wall.x : wall.z;
          const wallMin = center - wall.length * 0.5;
          const wallMax = center + wall.length * 0.5;
          return Math.max(wallMin - midpoint, 0, midpoint - wallMax);
        };
        return distanceTo(left) - distanceTo(right);
      });
      const referenceWalls = supportingWalls.length > 0
        ? supportingWalls
        : nearestWalls.slice(0, 2);
      const tint = referenceWalls.length > 0
        ? referenceWalls.reduce((sum, wall) => sum + wall.tint, 0) / referenceWalls.length
        : 0.96;
      const thickness = referenceWalls.length > 0
        ? referenceWalls.reduce((sum, wall) => sum + wall.thickness, 0) / referenceWalls.length
        : WALL_THICKNESS;
      const supported = supportingWalls.length > 0;
      // Both shell variants must meet the office ceiling exactly. The renderer
      // removes a portal lintel's wallpaper bottom cap and replaces it with a
      // disjoint ceiling-material soffit, so no coplanar faces remain here.
      const shellBottom = world.wallHeight;
      addWall(plan, rng.fork(`upper-shell:${shellIndex}`), {
        roomId: owner.roomId,
        x: owner.orientation === 'x' ? midpoint : owner.fixed,
        z: owner.orientation === 'z' ? midpoint : owner.fixed,
        length: max - min,
        orientation: owner.orientation,
        bottom: shellBottom,
        height: owner.height - shellBottom + 0.006,
        thickness: clamp(thickness, WALL_THICKNESS, MAX_STRUCTURAL_WALL_THICKNESS),
        collision: true,
        tint,
        kind: 'wallpaper',
        detail: supported ? 'upper-shell' : 'upper-portal-lintel',
      }, 0.01);
      shellIndex += 1;
    }
  }
};

const addRaisedZones = (
  plan: MutablePlan,
  world: WorldPlan,
  reservedRoomIds: Set<string>,
  rootRng: SeededRandom,
): void => {
  const rng = rootRng.fork('feature:raised-zones');
  if (!rng.chance(0.92)) return;
  const half = world.size * 0.5;
  const candidates = world.rooms.filter(
    (room) =>
      !reservedRoomIds.has(room.id) &&
      !roomIsRestricted(room) &&
      room.kind !== 'open-hall' &&
      room.kind !== 'pit-gallery' &&
      rectWidth(room.bounds) >= 6.5 &&
      rectDepth(room.bounds) >= 6.5 &&
      rectArea(room.bounds) >= 52 &&
      room.bounds.minX > -half + 2.5 &&
      room.bounds.minZ > -half + 2.5 &&
      room.bounds.maxX < half - 2.5 &&
      room.bounds.maxZ < half - 2.5 &&
      Math.hypot(
        rectCenter(room.bounds).x - world.spawn.x,
        rectCenter(room.bounds).z - world.spawn.z,
      ) > 12,
  );
  if (candidates.length === 0) return;
  const edges = roomPortalEdges(plan, world.rooms);
  const adjacency = adjacencyFromPortalEdges(world.rooms, edges);
  const roomsById = new Map(world.rooms.map((room) => [room.id, room]));
  const availableIds = new Set(candidates.map((room) => room.id));
  const targetCount = Math.min(
    candidates.length,
    rng.weighted([
      { value: 1, weight: 0.62 },
      { value: 2, weight: 0.33 },
      { value: 3, weight: 0.05 },
    ]),
  );
  for (let zoneIndex = 0; zoneIndex < targetCount && availableIds.size > 0; zoneIndex += 1) {
    const zoneRng = rng.fork(`district:${zoneIndex}`);
    const anchors = candidates.filter((room) =>
      availableIds.has(room.id) && (adjacency.get(room.id)?.size ?? 0) > 0
    );
    if (anchors.length === 0) break;
    const anchor = zoneRng.weighted(anchors.map((room) => ({
      value: room,
      weight: 1 / Math.max(1, adjacency.get(room.id)?.size ?? 1),
    })));
    const desiredRoomCount = zoneRng.weighted([
      { value: 2, weight: 0.38 },
      { value: 3, weight: 0.34 },
      { value: 4, weight: 0.2 },
      { value: 5, weight: 0.08 },
    ]);
    const rooms = growConnectedRoomCluster(
      anchor,
      desiredRoomCount,
      availableIds,
      adjacency,
      roomsById,
      zoneRng,
    );
    if (rooms.length < 2) {
      availableIds.delete(anchor.id);
      zoneIndex -= 1;
      continue;
    }
    const roomIds = new Set(rooms.map((room) => room.id));
    const boundaryEdges = edges.filter((edge) =>
      roomIds.has(edge.firstRoom.id) !== roomIds.has(edge.secondRoom.id)
    );
    const transitions = boundaryEdges.map((edge) => {
      const zoneIsFirst = roomIds.has(edge.firstRoom.id);
      const outerRoom = zoneIsFirst ? edge.secondRoom : edge.firstRoom;
      const fixed = edge.portal.orientation === 'x' ? edge.portal.z : edge.portal.x;
      const outerOnPositiveSide = zoneIsFirst;
      const outerLimit = edge.portal.orientation === 'x'
        ? outerOnPositiveSide
          ? outerRoom.bounds.maxZ
          : outerRoom.bounds.minZ
        : outerOnPositiveSide
          ? outerRoom.bounds.maxX
          : outerRoom.bounds.minX;
      const availableRun = Math.abs(outerLimit - fixed) - 1;
      return { edge, zoneIsFirst, outerRoom, availableRun };
    });
    const viableByApproachRoom = new Map<string, (typeof transitions)[number]>();
    for (const transition of transitions) {
      const { outerRoom, availableRun, edge } = transition;
      const neighbors = adjacency.get(outerRoom.id) ?? new Set<string>();
      const outsideNeighborCount = [...neighbors].filter((neighborId) => !roomIds.has(neighborId)).length;
      const crossSpan = edge.portal.orientation === 'x'
        ? rectWidth(outerRoom.bounds)
        : rectDepth(outerRoom.bounds);
      const rampWidth = clamp(edge.portal.width - 0.26, 1.2, 3.4);
      if (
        reservedRoomIds.has(outerRoom.id) ||
        roomIsRestricted(outerRoom) ||
        outerRoom.kind === 'corridor' ||
        availableRun < 4.2 ||
        edge.portal.width < 1.5 ||
        crossSpan < rampWidth + 2.6 ||
        neighbors.size > 2 ||
        outsideNeighborCount !== 1
      ) continue;

      // A single approach room must never host two ramps. Apart from looking
      // like a junction, the overlapping slopes would also fight for the same
      // later architectural clearance.
      if (!viableByApproachRoom.has(outerRoom.id)) {
        viableByApproachRoom.set(outerRoom.id, transition);
      }
    }
    const viable = [...viableByApproachRoom.values()];
    if (viable.length === 0) {
      availableIds.delete(anchor.id);
      zoneIndex -= 1;
      continue;
    }

    const minimumAvailableRun = Math.min(...viable.map((transition) => transition.availableRun));
    const magnitudeClass = zoneRng.weighted([
      { value: 'noticeable' as const, weight: 0.3 },
      { value: 'high' as const, weight: 0.48 },
      { value: 'dramatic' as const, weight: 0.22 },
    ]);
    const sampledMagnitude = magnitudeClass === 'noticeable'
      ? zoneRng.float(0.55, 0.9)
      : magnitudeClass === 'high'
        ? zoneRng.float(0.9, 1.38)
        : zoneRng.float(1.38, 1.78);
    const maximumMagnitude = minimumAvailableRun * Math.tan(34 * Math.PI / 180) * 0.94;
    const magnitude = quantize(Math.min(sampledMagnitude, maximumMagnitude), 0.05);
    if (magnitude < 0.5) {
      availableIds.delete(anchor.id);
      zoneIndex -= 1;
      continue;
    }
    const elevation = (zoneRng.chance(0.42) ? -1 : 1) * magnitude;
    const selectedTransitions = viable.slice(0, 4);
    const ramps: RaisedZoneFeature['ramps'] = selectedTransitions.map((transition, rampIndex) => {
      const rampRng = zoneRng.fork(`ramp:${rampIndex}`);
      const angle = rampRng.float(7, 31) * Math.PI / 180;
      const minimumRun = magnitude / Math.tan(34 * Math.PI / 180);
      const run = quantize(
        clamp(
          magnitude / Math.tan(angle),
          Math.max(2.2, minimumRun),
          Math.min(15, transition.availableRun),
        ),
        0.05,
      );
      const crossWidth = quantize(clamp(transition.edge.portal.width - 0.26, 1.2, 3.4), 0.05);
      const crossCenter = transition.edge.portal.orientation === 'x'
        ? transition.edge.portal.x
        : transition.edge.portal.z;
      const crossMin = crossCenter - crossWidth * 0.5;
      const crossMax = crossCenter + crossWidth * 0.5;
      const fixed = transition.edge.portal.orientation === 'x'
        ? transition.edge.portal.z
        : transition.edge.portal.x;
      const minimum = transition.zoneIsFirst ? fixed : fixed - run;
      const maximum = transition.zoneIsFirst ? fixed + run : fixed;
      return {
        bounds: transition.edge.portal.orientation === 'x'
          ? { minX: crossMin, maxX: crossMax, minZ: minimum, maxZ: maximum }
          : { minX: minimum, maxX: maximum, minZ: crossMin, maxZ: crossMax },
        axis: transition.edge.portal.orientation === 'x' ? 'z' : 'x',
        // The signed elevation is reached at the district boundary.
        riseDirection: transition.zoneIsFirst ? -1 : 1,
      };
    });
    const platformRects = rooms.map((room) => ({ ...room.bounds }));
    const allRects = [...platformRects, ...ramps.map((ramp) => ramp.bounds)];
    const bounds: Rect = {
      minX: Math.min(...allRects.map((rect) => rect.minX)),
      maxX: Math.max(...allRects.map((rect) => rect.maxX)),
      minZ: Math.min(...allRects.map((rect) => rect.minZ)),
      maxZ: Math.max(...allRects.map((rect) => rect.maxZ)),
    };
    const featureId = `elevation-zone-${zoneIndex}`;
    const feature: RaisedZoneFeature = {
      kind: 'raised-zone',
      id: featureId,
      roomId: anchor.id,
      roomIds: rooms.map((room) => room.id),
      approachRoomIds: selectedTransitions.map(({ outerRoom }) => outerRoom.id),
      bounds,
      platformBounds: platformRects[0]!,
      platformRects,
      elevation,
      ramp: ramps[0]!,
      ramps,
    };
    world.features.push(feature);

    for (const [platformIndex, platform] of platformRects.entries()) {
      world.colliders.push({
        id: `${featureId}-platform-${platformIndex}`,
        center: {
          x: rectCenter(platform).x,
          y: elevation - 0.08,
          z: rectCenter(platform).z,
        },
        halfExtents: {
          x: rectWidth(platform) * 0.5,
          y: 0.08,
          z: rectDepth(platform) * 0.5,
        },
        kind: 'floor',
      });
    }
    for (const [rampIndex, ramp] of ramps.entries()) {
      const run = ramp.axis === 'x' ? rectWidth(ramp.bounds) : rectDepth(ramp.bounds);
      const crossWidth = ramp.axis === 'x' ? rectDepth(ramp.bounds) : rectWidth(ramp.bounds);
      const slopeLength = Math.hypot(run, elevation);
      const signedAngle = Math.atan2(elevation, run) * ramp.riseDirection;
      const halfThickness = 0.08;
      world.colliders.push({
        id: `${featureId}-ramp-${rampIndex}`,
        center: {
          x: rectCenter(ramp.bounds).x,
          y: elevation * 0.5 - Math.cos(signedAngle) * halfThickness,
          z: rectCenter(ramp.bounds).z,
        },
        halfExtents: ramp.axis === 'x'
          ? { x: slopeLength * 0.5, y: halfThickness, z: crossWidth * 0.5 }
          : { x: crossWidth * 0.5, y: halfThickness, z: slopeLength * 0.5 },
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
      const sideThickness = 0.12;
      const sideBottom = Math.min(0, elevation);
      for (const [sideIndex, side] of ([-1, 1] as const).entries()) {
        world.colliders.push({
          id: `${featureId}-ramp-${rampIndex}-side-${sideIndex}`,
          center: {
            x: ramp.axis === 'x'
              ? rectCenter(ramp.bounds).x
              : side < 0 ? ramp.bounds.minX : ramp.bounds.maxX,
            y: sideBottom + Math.abs(elevation) * 0.5,
            z: ramp.axis === 'x'
              ? side < 0 ? ramp.bounds.minZ : ramp.bounds.maxZ
              : rectCenter(ramp.bounds).z,
          },
          halfExtents: ramp.axis === 'x'
            ? {
                x: rectWidth(ramp.bounds) * 0.5,
                y: Math.abs(elevation) * 0.5,
                z: sideThickness * 0.5,
              }
            : {
                x: sideThickness * 0.5,
                y: Math.abs(elevation) * 0.5,
                z: rectDepth(ramp.bounds) * 0.5,
              },
          kind: 'wall',
        });
      }
    }

    const viableKeys = new Set(selectedTransitions.map(({ edge }) =>
      `${edge.portal.orientation}:${edge.portal.x.toFixed(2)}:${edge.portal.z.toFixed(2)}`
    ));
    for (const [sealIndex, transition] of transitions.entries()) {
      const key = `${transition.edge.portal.orientation}:${transition.edge.portal.x.toFixed(2)}:${transition.edge.portal.z.toFixed(2)}`;
      if (viableKeys.has(key)) continue;
      const bottom = Math.min(0, elevation);
      addWall(plan, zoneRng.fork(`elevation-seal:${sealIndex}`), {
        roomId: anchor.id,
        x: transition.edge.portal.x,
        z: transition.edge.portal.z,
        length: transition.edge.portal.width + 0.12,
        orientation: transition.edge.portal.orientation,
        bottom,
        height: world.wallHeight - bottom,
        thickness: 0.3,
        tint: 0.95,
        collision: true,
        kind: 'wallpaper',
        detail: 'elevation-seal',
      });
    }
    for (const room of rooms) {
      reservedRoomIds.add(room.id);
      availableIds.delete(room.id);
    }
    for (const { outerRoom } of selectedTransitions) {
      // The complete run-up belongs to the elevation feature. Keeping it out
      // of every later room pass prevents low ceilings, return walls, columns,
      // solid masses and a second raised district from occupying the slope.
      reservedRoomIds.add(outerRoom.id);
      availableIds.delete(outerRoom.id);
    }
  }
};

/**
 * Rebuilds every wall and column piece that must continue down to a sunken
 * district.
 *
 * Elevation zones are selected before recesses, sealed rooms and a few other
 * architectural passes modify the wall list. Building the lower continuations
 * at selection time therefore leaves later wall fragments floating at y=0.
 * Running this repair from the final architecture also removes stale wall
 * continuations left behind when a source wall was split or replaced, and
 * extends boundary pilasters whose footprint remains visible from below.
 */
export const rebuildSunkenArchitectureExtensions = (world: WorldPlan): void => {
  const previousShellIds = new Set(
    world.walls
      .filter((wall) => wall.detail === 'lower-shell')
      .map((wall) => wall.id),
  );
  world.walls = world.walls.filter((wall) => wall.detail !== 'lower-shell');
  world.colliders = world.colliders.filter((collider) => {
    if (!collider.id.startsWith('collider-')) return true;
    return !previousShellIds.has(collider.id.slice('collider-'.length));
  });

  const sunkenZones = world.features.filter(
    (feature): feature is RaisedZoneFeature =>
      feature.kind === 'raised-zone' && feature.elevation < -0.04,
  );

  for (const column of world.columns) {
    const currentBottom = column.bottom ?? 0;
    const currentTop = currentBottom + column.height;
    const columnBounds: Rect = {
      minX: column.x - column.width * 0.5,
      maxX: column.x + column.width * 0.5,
      minZ: column.z - column.depth * 0.5,
      maxZ: column.z + column.depth * 0.5,
    };
    const targetBottom = Math.min(
      0,
      ...sunkenZones
        .filter((feature) =>
          (feature.platformRects ?? [feature.platformBounds]).some((platform) =>
            columnBounds.minX < platform.maxX - 0.01 &&
            columnBounds.maxX > platform.minX + 0.01 &&
            columnBounds.minZ < platform.maxZ - 0.01 &&
            columnBounds.maxZ > platform.minZ + 0.01
          )
        )
        .map((feature) => feature.elevation),
    );
    column.height = currentTop - targetBottom;
    if (targetBottom < -0.04) column.bottom = targetBottom;
    else delete column.bottom;
    for (const collider of world.colliders) {
      if (
        collider.kind !== 'column' ||
        Math.abs(collider.center.x - column.x) > 0.025 ||
        Math.abs(collider.center.z - column.z) > 0.025
      ) continue;
      collider.center.y = targetBottom + column.height * 0.5;
      collider.halfExtents.y = column.height * 0.5;
    }
  }
  if (sunkenZones.length === 0) return;

  const sourceWalls = world.walls.filter((wall) =>
    Math.abs(wall.bottom) < 0.04 &&
    wall.height > 0.08 &&
    wall.detail !== 'upper-shell' &&
    wall.detail !== 'upper-portal-lintel' &&
    wall.detail !== 'elevation-seal'
  );
  for (const [zoneIndex, feature] of sunkenZones.entries()) {
    const platforms = feature.platformRects ?? [feature.platformBounds];
    for (const wall of sourceWalls) {
      const alongCenter = wall.orientation === 'x' ? wall.x : wall.z;
      const fixed = wall.orientation === 'x' ? wall.z : wall.x;
      const wallMin = alongCenter - wall.length * 0.5;
      const wallMax = alongCenter + wall.length * 0.5;
      const crossTolerance = wall.thickness * 0.5 + 0.025;
      const intervals = platforms
        .filter((platform) => {
          const crossMin = wall.orientation === 'x' ? platform.minZ : platform.minX;
          const crossMax = wall.orientation === 'x' ? platform.maxZ : platform.maxX;
          return fixed >= crossMin - crossTolerance && fixed <= crossMax + crossTolerance;
        })
        .map((platform) => ({
          min: Math.max(
            wallMin,
            wall.orientation === 'x' ? platform.minX : platform.minZ,
          ),
          max: Math.min(
            wallMax,
            wall.orientation === 'x' ? platform.maxX : platform.maxZ,
          ),
        }))
        .filter((interval) => interval.max - interval.min > 0.01)
        .sort((left, right) => left.min - right.min);
      const merged: Gap[] = [];
      for (const interval of intervals) {
        const previous = merged[merged.length - 1];
        if (previous && interval.min <= previous.max + 0.02) {
          previous.max = Math.max(previous.max, interval.max);
        } else {
          merged.push({ ...interval });
        }
      }
      for (const [pieceIndex, interval] of merged.entries()) {
        const center = (interval.min + interval.max) * 0.5;
        const shell: WallSegment = {
          id: `elevation-lower-shell-${zoneIndex}-${wall.id}-${pieceIndex}`,
          roomId: wall.roomId ?? feature.roomId,
          x: wall.orientation === 'x' ? center : fixed,
          z: wall.orientation === 'z' ? center : fixed,
          length: interval.max - interval.min,
          orientation: wall.orientation,
          bottom: feature.elevation,
          height: -feature.elevation + 0.03,
          thickness: wall.thickness,
          tint: wall.tint,
          collision: wall.collision,
          kind: wall.kind === 'vista-frame' ? 'wallpaper' : wall.kind,
          detail: 'lower-shell',
        };
        world.walls.push(shell);
        if (shell.collision) addColliderForWall(world.colliders, shell);
      }
    }
  }
};

const portalNear = (plan: MutablePlan, x: number, z: number, radius: number): boolean =>
  plan.portals.some((portal) => Math.hypot(portal.x - x, portal.z - z) < radius);

const roomIsRestricted = (room: RoomRecord): boolean =>
  room.access === 'sealed' || room.access === 'secret';

const roomInZones = (room: RoomRecord, zones: readonly Rect[] | undefined): boolean => {
  if (!zones) return false;
  const center = rectCenter(room.bounds);
  return zones.some((zone) => pointInRect(center.x, center.z, zone));
};

const roomPortalGraph = (
  plan: MutablePlan,
  rooms: readonly RoomRecord[],
): Map<string, Set<string>> => {
  const minimumWalkableOpening = 0.72;
  const graph = new Map(rooms.map((room) => [room.id, new Set<string>()]));
  const boundaryHasOpening = (
    orientation: 'x' | 'z',
    fixed: number,
    spanMin: number,
    spanMax: number,
  ): boolean => {
    const intervals = plan.walls
      .filter((wall) => {
        if (
          wall.orientation !== orientation ||
          wall.bottom > 0.08 ||
          wall.bottom + wall.height < 1.12
        ) return false;
        const wallFixed = orientation === 'x' ? wall.z : wall.x;
        return Math.abs(wallFixed - fixed) < 0.08;
      })
      .map((wall) => {
        const center = orientation === 'x' ? wall.x : wall.z;
        return {
          min: Math.max(spanMin, center - wall.length * 0.5),
          max: Math.min(spanMax, center + wall.length * 0.5),
        };
      })
      .filter((interval) => interval.max - interval.min > 0.02)
      .sort((left, right) => left.min - right.min);
    let cursor = spanMin;
    for (const interval of intervals) {
      if (interval.min - cursor >= minimumWalkableOpening) return true;
      cursor = Math.max(cursor, interval.max);
    }
    return spanMax - cursor >= minimumWalkableOpening;
  };
  for (let firstIndex = 0; firstIndex < rooms.length; firstIndex += 1) {
    const first = rooms[firstIndex]!;
    for (let secondIndex = firstIndex + 1; secondIndex < rooms.length; secondIndex += 1) {
      const second = rooms[secondIndex]!;
      let orientation: 'x' | 'z' | undefined;
      let fixed = 0;
      let spanMin = 0;
      let spanMax = 0;
      if (
        Math.abs(first.bounds.maxX - second.bounds.minX) < 0.08 ||
        Math.abs(second.bounds.maxX - first.bounds.minX) < 0.08
      ) {
        orientation = 'z';
        fixed = Math.abs(first.bounds.maxX - second.bounds.minX) < 0.08
          ? first.bounds.maxX
          : second.bounds.maxX;
        spanMin = Math.max(first.bounds.minZ, second.bounds.minZ);
        spanMax = Math.min(first.bounds.maxZ, second.bounds.maxZ);
      } else if (
        Math.abs(first.bounds.maxZ - second.bounds.minZ) < 0.08 ||
        Math.abs(second.bounds.maxZ - first.bounds.minZ) < 0.08
      ) {
        orientation = 'x';
        fixed = Math.abs(first.bounds.maxZ - second.bounds.minZ) < 0.08
          ? first.bounds.maxZ
          : second.bounds.maxZ;
        spanMin = Math.max(first.bounds.minX, second.bounds.minX);
        spanMax = Math.min(first.bounds.maxX, second.bounds.maxX);
      }
      if (
        orientation === undefined ||
        spanMax - spanMin < minimumWalkableOpening ||
        !boundaryHasOpening(orientation, fixed, spanMin, spanMax)
      ) continue;
      graph.get(first.id)?.add(second.id);
      graph.get(second.id)?.add(first.id);
    }
  }
  return graph;
};

const assignRestrictedRooms = (
  plan: MutablePlan,
  world: WorldPlan,
  reservedRoomIds: Set<string>,
  rootRng: SeededRandom,
): void => {
  const rng = rootRng.fork('topology:restricted-rooms');
  const half = world.size * 0.5;
  const graph = roomPortalGraph(plan, world.rooms);
  const candidates = world.rooms.filter((room) => {
    const center = rectCenter(room.bounds);
    return (
      !reservedRoomIds.has(room.id) &&
      room.id !== 'room-grand-hall' &&
      room.kind !== 'open-hall' &&
      room.kind !== 'corridor' &&
      room.kind !== 'pit-gallery' &&
      rectArea(room.bounds) >= 42 &&
      rectArea(room.bounds) <= 300 &&
      room.bounds.minX > -half + 1.2 &&
      room.bounds.maxX < half - 1.2 &&
      room.bounds.minZ > -half + 1.2 &&
      room.bounds.maxZ < half - 1.2 &&
      Math.hypot(center.x - world.spawn.x, center.z - world.spawn.z) >= 17
    );
  });
  const anchor = candidates.length > 0 ? rng.pick(candidates) : undefined;
  const anchorCenter = anchor ? rectCenter(anchor.bounds) : undefined;
  const ordered = anchorCenter
    ? rng
        .shuffle(candidates)
        .sort((left, right) => {
          const leftCenter = rectCenter(left.bounds);
          const rightCenter = rectCenter(right.bounds);
          return (
            Math.hypot(leftCenter.x - anchorCenter.x, leftCenter.z - anchorCenter.z) -
            Math.hypot(rightCenter.x - anchorCenter.x, rightCenter.z - anchorCenter.z)
          );
        })
    : [];
  const targetCount = Math.min(
    candidates.length,
    clamp(Math.round(world.rooms.length * rng.float(0.065, 0.11)), 2, 7),
  );
  const restricted = new Set<string>();
  const spawnRoom = world.rooms.find((room) =>
    pointInRect(world.spawn.x, world.spawn.z, room.bounds, -0.02)
  );
  const reachableWithout = (blocked: ReadonlySet<string>): Set<string> => {
    if (!spawnRoom || blocked.has(spawnRoom.id)) return new Set();
    const reached = new Set<string>([spawnRoom.id]);
    const queue = [spawnRoom.id];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      for (const neighbor of graph.get(queue[cursor]!) ?? []) {
        if (blocked.has(neighbor) || reached.has(neighbor)) continue;
        reached.add(neighbor);
        queue.push(neighbor);
      }
    }
    return reached;
  };
  const baselineReachable = reachableWithout(new Set());
  const preservesPublicConnectivity = (blocked: ReadonlySet<string>): boolean => {
    const reached = reachableWithout(blocked);
    return [...baselineReachable].every((roomId) => blocked.has(roomId) || reached.has(roomId));
  };
  for (const room of ordered) {
    if (restricted.size >= targetCount) break;
    const trial = new Set(restricted);
    trial.add(room.id);
    if (preservesPublicConnectivity(trial)) restricted.add(room.id);
  }
  if (restricted.size < Math.min(2, world.rooms.length - 1)) {
    const fallbackCandidates = rng.shuffle(world.rooms.filter((room) => {
      const center = rectCenter(room.bounds);
      return (
        !reservedRoomIds.has(room.id) &&
        room.id !== 'room-grand-hall' &&
        room.kind !== 'open-hall' &&
        room.kind !== 'pit-gallery' &&
        room.bounds.minX > -half + 1.2 &&
        room.bounds.maxX < half - 1.2 &&
        room.bounds.minZ > -half + 1.2 &&
        room.bounds.maxZ < half - 1.2 &&
        Math.hypot(center.x - world.spawn.x, center.z - world.spawn.z) >= 14
      );
    }));
    fallbackCandidates.sort((left, right) =>
      (graph.get(left.id)?.size ?? 0) - (graph.get(right.id)?.size ?? 0)
    );
    for (const room of fallbackCandidates) {
      if (restricted.size >= 2) break;
      if (restricted.has(room.id)) continue;
      const trial = new Set(restricted);
      trial.add(room.id);
      if (preservesPublicConnectivity(trial)) restricted.add(room.id);
    }
  }
  if (restricted.size === 0) return;

  const restrictedRooms = world.rooms.filter((room) => restricted.has(room.id));
  const secretTarget = restrictedRooms.length >= 4 && rng.chance(0.38) ? 2 : 1;
  const secretCandidates = restrictedRooms.filter((room) =>
    [...(graph.get(room.id) ?? [])].some((neighbor) => !restricted.has(neighbor))
  );
  const secretIds = new Set(
    rng.shuffle(secretCandidates).slice(0, Math.min(secretTarget, secretCandidates.length))
      .map((room) => room.id),
  );
  for (const room of restrictedRooms) {
    room.access = secretIds.has(room.id) ? 'secret' : 'sealed';
    room.detailDensity = 0;
    reservedRoomIds.add(room.id);
  }
};

const selectArchitectureZones = (
  world: WorldPlan,
  rootRng: SeededRandom,
): void => {
  const rng = rootRng.fork('architecture:zones');
  const grandHall = world.rooms.find((room) => room.id === 'room-grand-hall');
  world.symmetryZones = grandHall ? [{ ...grandHall.bounds }] : [];

  const candidates = world.rooms.filter(
    (room) =>
      !roomIsRestricted(room) &&
      room.id !== grandHall?.id &&
      room.kind !== 'pit-gallery' &&
      rectArea(room.bounds) >= 38,
  );
  if (candidates.length === 0) {
    world.baseboardlessZones = [];
    world.plasterZones = [];
    return;
  }
  const baseboardAnchor = rng.pick(candidates);
  const baseboardCenter = rectCenter(baseboardAnchor.bounds);
  const baseboardCount = Math.min(candidates.length, rng.int(2, 6));
  const baseboardRooms = [...candidates]
    .sort((left, right) => {
      const leftCenter = rectCenter(left.bounds);
      const rightCenter = rectCenter(right.bounds);
      return (
        Math.hypot(leftCenter.x - baseboardCenter.x, leftCenter.z - baseboardCenter.z) -
        Math.hypot(rightCenter.x - baseboardCenter.x, rightCenter.z - baseboardCenter.z)
      );
    })
    .slice(0, baseboardCount);
  world.baseboardlessZones = baseboardRooms.map((room) => ({ ...room.bounds }));
  // Level 0 keeps the wallpaper skin throughout. The old plaster districts
  // appeared as isolated, untextured grey walls inside otherwise yellow rooms.
  world.plasterZones = [];
};

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
    ? rng.float(12, 19)
    : profile === 'regular'
      ? rng.float(8, 13)
      : profile === 'dense'
        ? rng.float(5.2, 8.2)
        : rng.float(7, 12);
  const bothSides = rng.chance(
    profile === 'dense'
      ? 0.58
      : profile === 'clustered'
        ? 0.48
        : room.kind === 'corridor'
          ? 0.38
          : 0.2,
  );
  const firstSide = rng.chance(0.5) ? -1 : 1;
  const sides = bothSides ? [-1, 1] as const : [firstSide] as const;
  const basePositions: number[] = [];
  let cursor = -span * 0.5 + rng.float(0.7, spacing);
  while (cursor <= span * 0.5 - 0.7 && basePositions.length < 18) {
    if (profile === 'clustered') {
      const clusterSize = rng.int(2, 3);
      const clusterSpacing = rng.float(2.1, 3.4);
      for (let member = 0; member < clusterSize; member += 1) {
        const along = cursor + (member - (clusterSize - 1) * 0.5) * clusterSpacing;
        if (Math.abs(along) <= span * 0.5 - 0.6) basePositions.push(along);
      }
      cursor += spacing * rng.float(1.35, 2);
    } else {
      basePositions.push(cursor + rng.float(-spacing * 0.18, spacing * 0.18));
      cursor += spacing * rng.float(0.78, 1.24);
    }
  }
  const profiles = basePositions.map((along, index) => {
    const size = profile === 'clustered' && index % 3 === 2
      ? 'subtle' as const
      : rng.weighted([
          { value: 'subtle' as const, weight: 0.1 },
          { value: 'broad' as const, weight: 0.62 },
          { value: 'massive' as const, weight: 0.28 },
        ]);
    return {
      along,
      width: size === 'subtle'
        ? rng.float(0.38, 0.68)
        : size === 'broad'
          ? rng.float(1.05, 1.75)
          : rng.float(1.8, 2.75),
      projection: size === 'subtle'
        ? rng.float(0.16, 0.28)
        : size === 'broad'
          ? rng.float(0.42, 0.72)
          : rng.float(0.68, 1.08),
    };
  });
  for (const side of sides) {
    for (const placement of profiles) {
      const { along, width, projection } = placement;
      const x = longX
        ? rectCenter(room.bounds).x + along
        : (side < 0 ? room.bounds.minX + projection * 0.5 : room.bounds.maxX - projection * 0.5);
      const z = longX
        ? (side < 0 ? room.bounds.minZ + projection * 0.5 : room.bounds.maxZ - projection * 0.5)
        : rectCenter(room.bounds).z + along;
      if (portalNear(plan, x, z, 1.25 + Math.max(width, projection) * 0.55)) continue;
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

const addSymmetricCornerPosts = (
  plan: MutablePlan,
  world: WorldPlan,
  room: RoomRecord,
): void => {
  // Let the posts overlap the boundary skin very slightly. Exact face-to-face
  // contact can leave a hairline seam after floating-point transforms.
  const size = 0.9;
  const inset = 0.42;
  const positions = [
    { x: room.bounds.minX + inset, z: room.bounds.minZ + inset },
    { x: room.bounds.maxX - inset, z: room.bounds.minZ + inset },
    { x: room.bounds.minX + inset, z: room.bounds.maxZ - inset },
    { x: room.bounds.maxX - inset, z: room.bounds.maxZ - inset },
  ];
  for (const [index, position] of positions.entries()) {
    if (world.columns.some((column) =>
      Math.abs(column.x - position.x) < 0.02 &&
      Math.abs(column.z - position.z) < 0.02
    )) continue;
    world.columns.push({
      ...position,
      width: size,
      depth: size,
      height: room.ceilingHeight,
      tint: 0.96,
      kind: 'column',
    });
    plan.colliders.push({
      id: `formal-corner-${room.id}-${index}`,
      center: { ...position, y: room.ceilingHeight * 0.5 },
      halfExtents: { x: size * 0.5, y: room.ceilingHeight * 0.5, z: size * 0.5 },
      kind: 'column',
    });
  }
};

const addFormalSymmetry = (
  plan: MutablePlan,
  world: WorldPlan,
  room: RoomRecord,
  rng: SeededRandom,
): void => {
  addSymmetricCornerPosts(plan, world, room);
  const center = rectCenter(room.bounds);
  const width = rectWidth(room.bounds);
  const depth = rectDepth(room.bounds);
  const longX = width >= depth;
  const longSpan = longX ? width : depth;
  const crossSpan = longX ? depth : width;
  const style = rng.weighted([
    { value: 'empty' as const, weight: 0.28 },
    { value: 'paired-columns' as const, weight: 0.5 },
    { value: 'pilaster-bays' as const, weight: 0.22 },
  ]);
  if (style === 'empty' || longSpan < 16 || crossSpan < 10) return;

  const pairCount = clamp(Math.floor(longSpan / rng.float(9, 14)), 1, 5);
  const crossDistances = style === 'paired-columns' && crossSpan >= 17
    ? [crossSpan * 0.18]
    : [crossSpan * 0.5 - rng.float(0.28, 0.48)];
  const columnKind = style === 'pilaster-bays' ? 'pilaster' as const : 'column' as const;
  const widthAlong = style === 'pilaster-bays' ? rng.float(1.25, 2.2) : rng.float(1.15, 2.1);
  const widthAcross = style === 'pilaster-bays' ? rng.float(0.45, 0.76) : rng.float(1.05, 2);

  for (let pair = 0; pair < pairCount; pair += 1) {
    const distance = longSpan * 0.43 * ((pair + 1) / pairCount);
    for (const crossDistance of crossDistances) {
      const positions = ([-1, 1] as const).flatMap((alongSide) =>
        ([-1, 1] as const).map((crossSide) => {
          const along = alongSide * distance;
          const across = crossSide * crossDistance;
          return {
            x: quantize(center.x + (longX ? along : across), 0.05),
            z: quantize(center.z + (longX ? across : along), 0.05),
          };
        })
      );
      if (positions.some(({ x, z }) =>
        !pointInRect(x, z, room.bounds, 0.26) || portalNear(plan, x, z, 1.5)
      )) continue;
      for (const { x, z } of positions) {
          const column = {
            x,
            z,
            width: longX ? widthAlong : widthAcross,
            depth: longX ? widthAcross : widthAlong,
            height: room.ceilingHeight,
            tint: 0.96,
            kind: columnKind,
          };
          world.columns.push(column);
          plan.colliders.push({
            id: `formal-${columnKind}-${world.columns.length - 1}`,
            center: { x, y: column.height * 0.5, z },
            halfExtents: {
              x: column.width * 0.5,
              y: column.height * 0.5,
              z: column.depth * 0.5,
            },
            kind: 'column',
          });
      }
    }
  }
};

const addColumnsAndPartialWalls = (
  plan: MutablePlan,
  world: WorldPlan,
  reservedRoomIds: Set<string>,
  rootRng: SeededRandom,
): void => {
  const districtRng = rootRng.fork('architecture:pilaster-districts');
  const districtCandidates = world.rooms.filter(
    (room) =>
      !reservedRoomIds.has(room.id) &&
      !roomInZones(room, world.symmetryZones) &&
      !roomInZones(room, world.baseboardlessZones),
  );
  const denseAnchor = districtCandidates.length > 0
    ? districtRng.pick(districtCandidates)
    : undefined;
  const denseCenter = denseAnchor ? rectCenter(denseAnchor.bounds) : undefined;
  const denseRadius = districtRng.float(11, 18);
  for (const room of world.rooms) {
    if (reservedRoomIds.has(room.id)) continue;
    const rng = rootRng.fork(`architecture:${room.id}`);
    const width = rectWidth(room.bounds);
    const depth = rectDepth(room.bounds);

    if (roomInZones(room, world.symmetryZones)) {
      addFormalSymmetry(plan, world, room, rng.fork('formal-symmetry'));
      continue;
    }

    const roomCenter = rectCenter(room.bounds);
    const inDenseDistrict = denseCenter !== undefined &&
      Math.hypot(roomCenter.x - denseCenter.x, roomCenter.z - denseCenter.z) <= denseRadius;
    const pilasterProfile: PilasterProfile = roomInZones(room, world.baseboardlessZones)
      ? 'none'
      : inDenseDistrict
        ? rng.weighted([
            { value: 'none' as const, weight: 0.08 },
            { value: 'sparse' as const, weight: 0.08 },
            { value: 'regular' as const, weight: 0.2 },
            { value: 'dense' as const, weight: 0.34 },
            { value: 'clustered' as const, weight: 0.3 },
          ])
        : rng.weighted([
            { value: 'none' as const, weight: 0.82 },
            { value: 'sparse' as const, weight: 0.12 },
            { value: 'regular' as const, weight: 0.05 },
            { value: 'clustered' as const, weight: 0.01 },
          ]);

    if (room.kind === 'open-hall' && width > 12 && depth > 12) {
      const columnStyle = rng.weighted([
        { value: 'none' as const, weight: 0.36 },
        { value: 'monumental' as const, weight: 0.28 },
        { value: 'field' as const, weight: 0.22 },
        { value: 'sparse' as const, weight: 0.09 },
        { value: 'clustered' as const, weight: 0.05 },
      ]);
      const sparse = columnStyle === 'sparse';
      const monumental = columnStyle === 'monumental';
      const clustered = columnStyle === 'clustered';
      const spacingX = rng.float(
        monumental ? 10 : sparse ? 9 : clustered ? 7 : 6.5,
        monumental ? 17 : sparse ? 14 : clustered ? 12 : 10,
      );
      const spacingZ = rng.float(
        monumental ? 10 : sparse ? 9 : clustered ? 7 : 6.5,
        monumental ? 17 : sparse ? 14 : clustered ? 12 : 10,
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
            rng.chance(sparse ? 0.36 : clustered ? 0.42 : monumental ? 0.08 : 0.16) ||
            Math.hypot(x - world.spawn.x, z - world.spawn.z) < 3.4 ||
            portalNear(plan, x, z, 2.2) ||
            (clearCross && (Math.abs(x - center.x) < 2.1 || Math.abs(z - center.z) < 2.1))
          ) continue;
          const column = {
            x: quantize(x + rng.float(clustered ? -0.85 : -0.38, clustered ? 0.85 : 0.38), 0.05),
            z: quantize(z + rng.float(clustered ? -0.85 : -0.38, clustered ? 0.85 : 0.38), 0.05),
            width: rng.float(
              monumental ? 1.9 : sparse ? 0.62 : clustered ? 0.78 : 1.1,
              monumental
                ? Math.max(2.2, Math.min(3.8, width * 0.09))
                : clustered
                  ? 2.8
                  : width > 35
                    ? 2.65
                    : 2.15,
            ),
            depth: rng.float(
              monumental ? 1.8 : sparse ? 0.56 : clustered ? 0.72 : 1.05,
              monumental
                ? Math.max(2.15, Math.min(4.2, depth * 0.1))
                : clustered
                  ? 3.1
                  : depth > 35
                    ? 2.9
                    : 2.35,
            ),
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
        const anchorSide = rng.chance(0.5) ? -1 : 1;
        const height = rng.chance(0.12) ? room.ceilingHeight * 0.68 : room.ceilingHeight;
        const tint = rng.float(0.88, 1.03);
        if (alongX) {
          const length = rng.float(width * 0.34, width * 0.62);
          const centerX = anchorSide < 0
            ? room.bounds.minX + length * 0.5
            : room.bounds.maxX - length * 0.5;
          const roomCenter = rectCenter(room.bounds);
          const offset = rng.float(2.2, Math.max(2.25, depth * 0.5 - 1.35));
          const z = roomCenter.z + (rng.chance(0.5) ? -1 : 1) * offset;
          const positions = mirrored ? [z, roomCenter.z * 2 - z] : [z];
          const anchorX = anchorSide < 0 ? room.bounds.minX : room.bounds.maxX;
          if (positions.some((wallZ) => portalNear(plan, anchorX, wallZ, 1.35))) continue;
          for (const [mirrorIndex, wallZ] of positions.entries()) {
            addWall(plan, rng.fork(`return-${index}-${mirrorIndex}`), {
              x: centerX,
              z: wallZ,
              length,
              orientation: 'x',
              bottom: 0,
              height,
              thickness: WALL_THICKNESS,
              tint,
              collision: true,
              kind: 'wallpaper',
            });
          }
        } else {
          const length = rng.float(depth * 0.34, depth * 0.62);
          const centerZ = anchorSide < 0
            ? room.bounds.minZ + length * 0.5
            : room.bounds.maxZ - length * 0.5;
          const roomCenter = rectCenter(room.bounds);
          const offset = rng.float(2.2, Math.max(2.25, width * 0.5 - 1.35));
          const x = roomCenter.x + (rng.chance(0.5) ? -1 : 1) * offset;
          const positions = mirrored ? [x, roomCenter.x * 2 - x] : [x];
          const anchorZ = anchorSide < 0 ? room.bounds.minZ : room.bounds.maxZ;
          if (positions.some((wallX) => portalNear(plan, wallX, anchorZ, 1.35))) continue;
          for (const [mirrorIndex, wallX] of positions.entries()) {
            addWall(plan, rng.fork(`return-${index}-${mirrorIndex}`), {
              x: wallX,
              z: centerZ,
              length,
              orientation: 'z',
              bottom: 0,
              height,
              thickness: WALL_THICKNESS,
              tint,
              collision: true,
              kind: 'wallpaper',
            });
          }
        }
      }
    }
  }

  for (const room of world.rooms.filter(
    (candidate) =>
      !reservedRoomIds.has(candidate.id) &&
      roomInZones(candidate, world.symmetryZones),
  )) {
    const removedColumns = world.columns.filter((column) =>
      pointInRect(column.x, column.z, room.bounds)
    );
    if (removedColumns.length > 0) {
      world.columns = world.columns.filter((column) => !removedColumns.includes(column));
      plan.colliders = plan.colliders.filter((collider) =>
        collider.kind !== 'column' ||
        !removedColumns.some((column) =>
          Math.abs(collider.center.x - column.x) < 0.02 &&
          Math.abs(collider.center.z - column.z) < 0.02
        )
      );
    }
    addFormalSymmetry(
      plan,
      world,
      room,
      rootRng.fork(`architecture:${room.id}`).fork('formal-symmetry'),
    );
  }
  for (const room of world.rooms.filter(
    (candidate) =>
      reservedRoomIds.has(candidate.id) &&
      roomInZones(candidate, world.symmetryZones),
  )) {
    addSymmetricCornerPosts(plan, world, room);
  }

  const bareZones = world.baseboardlessZones ?? [];
  if (bareZones.length > 0) {
    const removedPilasters = world.columns.filter(
      (column) =>
        column.kind === 'pilaster' &&
        bareZones.some((zone) => pointInRect(column.x, column.z, zone)),
    );
    if (removedPilasters.length > 0) {
      world.columns = world.columns.filter((column) => !removedPilasters.includes(column));
      plan.colliders = plan.colliders.filter((collider) =>
        collider.kind !== 'column' ||
        !removedPilasters.some((column) =>
          Math.abs(collider.center.x - column.x) < 0.02 &&
          Math.abs(collider.center.z - column.z) < 0.02
        )
      );
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
  const voidPassageEnabled = rootRng
    .fork('feature:squeeze-hole:void')
    .chance(PASSAGE_VOID_PRESENCE_RATE);
  let voidPassageAssigned = false;
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
    let clearanceHeight = quantize(roomRng.float(1.36, 1.49), 0.01);

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
    const reserveForVoid =
      voidPassageEnabled &&
      !voidPassageAssigned &&
      length >= 9 &&
      corridorWidth >= 2.5;
    let hump: PassageHump | undefined;
    if (!reserveForVoid && length >= 10.5 && roomRng.chance(0.52)) {
      const platformLength = quantize(roomRng.float(1.8, Math.min(4.8, length * 0.25)), 0.05);
      const maximumRampRun = Math.max(
        1.8,
        Math.min(6.2, (length - platformLength) * 0.5 - 0.38),
      );
      const elevation = quantize(
        Math.min(
          roomRng.float(0.28, 0.88),
          maximumRampRun * Math.tan(29 * Math.PI / 180),
          room.ceilingHeight - 1.32,
        ),
        0.01,
      );
      const targetAngle = roomRng.float(7, 25) * Math.PI / 180;
      const rampRun = quantize(
        clamp(elevation / Math.tan(targetAngle), 1.8, maximumRampRun),
        0.05,
      );
      const availableCenterOffset = Math.max(
        0,
        length * 0.5 - platformLength * 0.5 - rampRun - 0.25,
      );
      const centerLong = (longMinimum + longMaximum) * 0.5 +
        roomRng.float(-availableCenterOffset, availableCenterOffset);
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
      clearanceHeight = quantize(
        Math.min(
          room.ceilingHeight - 0.08,
          Math.max(clearanceHeight, elevation + roomRng.float(1.16, 1.42)),
        ),
        0.01,
      );
    }

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

    const passageHoles: PassageHole[] = [];
    if (
      !hump &&
      length >= 9 &&
      corridorWidth >= 2.5 &&
      (reserveForVoid || roomRng.chance(0.2))
    ) {
      const holeLength = roomRng.float(0.95, Math.min(1.65, length * 0.14));
      const holeCenter = longMinimum + length * roomRng.float(0.42, 0.68);
      const crossPadding = corridorWidth * roomRng.float(0.17, 0.25);
      const kind = reserveForVoid ? 'void' as const : 'drop' as const;
      const stories = kind === 'void' ? MAX_PIT_STORIES : 1;
      const hole: PassageHole = {
        ...rectAlong(holeCenter - holeLength * 0.5, holeCenter + holeLength * 0.5, crossPadding),
        depth: stories * PIT_STORY_PITCH,
        kind,
        stories,
      };
      passageHoles.push(hole);
      if (kind === 'void') voidPassageAssigned = true;

      const shaftThickness = 0.12;
      const shaftTop = 0;
      const shaftBottom = kind === 'void'
        ? getPassageHoleAbyssBottom(hole)
        : PASSAGE_HOLE_LOWER_CEILING_Y - 0.06;
      const shaftHeight = shaftTop - shaftBottom;
      for (const [side, collider] of [
        ['north', {
          x: rectCenter(hole).x,
          z: hole.minZ - shaftThickness * 0.5,
          halfX: rectWidth(hole) * 0.5 + shaftThickness,
          halfZ: shaftThickness * 0.5,
        }],
        ['south', {
          x: rectCenter(hole).x,
          z: hole.maxZ + shaftThickness * 0.5,
          halfX: rectWidth(hole) * 0.5 + shaftThickness,
          halfZ: shaftThickness * 0.5,
        }],
        ['west', {
          x: hole.minX - shaftThickness * 0.5,
          z: rectCenter(hole).z,
          halfX: shaftThickness * 0.5,
          halfZ: rectDepth(hole) * 0.5 + shaftThickness,
        }],
        ['east', {
          x: hole.maxX + shaftThickness * 0.5,
          z: rectCenter(hole).z,
          halfX: shaftThickness * 0.5,
          halfZ: rectDepth(hole) * 0.5 + shaftThickness,
        }],
      ] as const) {
        world.colliders.push({
          id: `${featureId}-hole-${side}`,
          center: {
            x: collider.x,
            y: shaftBottom + shaftHeight * 0.5,
            z: collider.z,
          },
          halfExtents: {
            x: collider.halfX,
            y: shaftHeight * 0.5,
            z: collider.halfZ,
          },
          kind: 'wall',
        });
      }

      if (kind === 'drop') {
        const previewBounds = getPassageHolePreviewBounds(hole, world.size);
        world.colliders.push({
          id: `${featureId}-hole-bottom`,
          center: {
            x: rectCenter(previewBounds).x,
            y: PASSAGE_HOLE_LOWER_FLOOR_Y - 0.12,
            z: rectCenter(previewBounds).z,
          },
          halfExtents: {
            x: rectWidth(previewBounds) * 0.5,
            y: 0.12,
            z: rectDepth(previewBounds) * 0.5,
          },
          kind: 'floor',
        });
        const lowerWallHeight =
          PASSAGE_HOLE_LOWER_CEILING_Y - PASSAGE_HOLE_LOWER_FLOOR_Y;
        const lowerWallY = PASSAGE_HOLE_LOWER_FLOOR_Y + lowerWallHeight * 0.5;
        for (const [side, collider] of [
          ['north', {
            x: rectCenter(previewBounds).x,
            z: previewBounds.minZ - shaftThickness * 0.5,
            halfX: rectWidth(previewBounds) * 0.5 + shaftThickness,
            halfZ: shaftThickness * 0.5,
          }],
          ['south', {
            x: rectCenter(previewBounds).x,
            z: previewBounds.maxZ + shaftThickness * 0.5,
            halfX: rectWidth(previewBounds) * 0.5 + shaftThickness,
            halfZ: shaftThickness * 0.5,
          }],
          ['west', {
            x: previewBounds.minX - shaftThickness * 0.5,
            z: rectCenter(previewBounds).z,
            halfX: shaftThickness * 0.5,
            halfZ: rectDepth(previewBounds) * 0.5 + shaftThickness,
          }],
          ['east', {
            x: previewBounds.maxX + shaftThickness * 0.5,
            z: rectCenter(previewBounds).z,
            halfX: shaftThickness * 0.5,
            halfZ: rectDepth(previewBounds) * 0.5 + shaftThickness,
          }],
        ] as const) {
          world.colliders.push({
            id: `${featureId}-lower-preview-${side}`,
            center: { x: collider.x, y: lowerWallY, z: collider.z },
            halfExtents: {
              x: collider.halfX,
              y: lowerWallHeight * 0.5,
              z: collider.halfZ,
            },
            kind: 'wall',
          });
        }
      }
    }

    world.features.push({
      kind: 'squeeze-view',
      id: featureId,
      roomId: room.id,
      bounds,
      axis: alongX ? 'x' : 'z',
      apertureWidth,
      passageStyle: 'room-network',
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

const sealRestrictedRooms = (
  plan: MutablePlan,
  world: WorldPlan,
  rootRng: SeededRandom,
): void => {
  const restrictedRooms = world.rooms.filter(roomIsRestricted);
  for (const room of restrictedRooms) {
    const rng = rootRng.fork(`topology:seal:${room.id}`);
    const sides = [
      {
        label: 'north',
        orientation: 'x' as const,
        fixed: room.bounds.minZ,
        min: room.bounds.minX,
        max: room.bounds.maxX,
      },
      {
        label: 'south',
        orientation: 'x' as const,
        fixed: room.bounds.maxZ,
        min: room.bounds.minX,
        max: room.bounds.maxX,
      },
      {
        label: 'west',
        orientation: 'z' as const,
        fixed: room.bounds.minX,
        min: room.bounds.minZ,
        max: room.bounds.maxZ,
      },
      {
        label: 'east',
        orientation: 'z' as const,
        fixed: room.bounds.maxX,
        min: room.bounds.minZ,
        max: room.bounds.maxZ,
      },
    ];
    for (const side of sides) {
      const sideThickness = choosePartitionThickness(
        rng.fork(`${side.label}:thickness`),
        side.max - side.min,
      );
      const intervals = plan.walls
        .filter((wall) => {
          if (
            wall.orientation !== side.orientation ||
            wall.bottom > 0.08 ||
            wall.bottom + wall.height < world.wallHeight - 0.08
          ) return false;
          const fixed = wall.orientation === 'x' ? wall.z : wall.x;
          return Math.abs(fixed - side.fixed) < 0.09;
        })
        .map((wall) => {
          const along = wall.orientation === 'x' ? wall.x : wall.z;
          return {
            min: Math.max(side.min, along - wall.length * 0.5),
            max: Math.min(side.max, along + wall.length * 0.5),
          };
        })
        .filter((interval) => interval.max - interval.min > 0.02)
        .sort((left, right) => left.min - right.min);
      const merged: Gap[] = [];
      for (const interval of intervals) {
        const previous = merged[merged.length - 1];
        if (previous && interval.min <= previous.max + 0.04) {
          previous.max = Math.max(previous.max, interval.max);
        } else {
          merged.push({ ...interval });
        }
      }
      let cursor = side.min;
      for (const [index, interval] of [...merged, { min: side.max, max: side.max }].entries()) {
        if (interval.min - cursor > 0.18) {
          const segmentCenter = (cursor + interval.min) * 0.5;
          addWall(plan, rng.fork(`${side.label}:${index}`), {
            roomId: room.id,
            x: side.orientation === 'x' ? segmentCenter : side.fixed,
            z: side.orientation === 'z' ? segmentCenter : side.fixed,
            length: interval.min - cursor,
            orientation: side.orientation,
            bottom: 0,
            height: room.ceilingHeight,
            thickness: sideThickness,
            tint: rng.float(0.91, 1.01),
            collision: true,
            kind: 'wallpaper',
            detail: 'sealed-boundary',
          });
        }
        cursor = Math.max(cursor, interval.max);
      }
    }
  }
};

interface BoundaryWallCandidate {
  wall: WallSegment;
  firstRoom: RoomRecord;
  secondRoom: RoomRecord;
  min: number;
  max: number;
}

const boundaryWallCandidates = (
  plan: MutablePlan,
  world: WorldPlan,
  acceptsRooms: (first: RoomRecord, second: RoomRecord) => boolean,
): BoundaryWallCandidate[] => {
  const candidates: BoundaryWallCandidate[] = [];
  for (const wall of plan.walls) {
    if (
      Math.abs(wall.bottom) > 0.05 ||
      wall.height < world.wallHeight - 0.08 ||
      wall.length < 2.6 ||
      wall.kind !== 'wallpaper' ||
      (wall.detail !== undefined && wall.detail !== 'sealed-boundary')
    ) continue;
    const fixed = wall.orientation === 'x' ? wall.z : wall.x;
    const wallCenter = wall.orientation === 'x' ? wall.x : wall.z;
    const wallMin = wallCenter - wall.length * 0.5;
    const wallMax = wallCenter + wall.length * 0.5;
    const firstRooms = world.rooms.filter((room) =>
      Math.abs(
        (wall.orientation === 'x' ? room.bounds.maxZ : room.bounds.maxX) - fixed,
      ) < 0.08
    );
    const secondRooms = world.rooms.filter((room) =>
      Math.abs(
        (wall.orientation === 'x' ? room.bounds.minZ : room.bounds.minX) - fixed,
      ) < 0.08
    );
    for (const firstRoom of firstRooms) {
      for (const secondRoom of secondRooms) {
        if (firstRoom.id === secondRoom.id || !acceptsRooms(firstRoom, secondRoom)) continue;
        if (
          firstRoom.ceilingHeight > world.wallHeight + 0.1 ||
          secondRoom.ceilingHeight > world.wallHeight + 0.1
        ) continue;
        const firstMin = wall.orientation === 'x' ? firstRoom.bounds.minX : firstRoom.bounds.minZ;
        const firstMax = wall.orientation === 'x' ? firstRoom.bounds.maxX : firstRoom.bounds.maxZ;
        const secondMin = wall.orientation === 'x' ? secondRoom.bounds.minX : secondRoom.bounds.minZ;
        const secondMax = wall.orientation === 'x' ? secondRoom.bounds.maxX : secondRoom.bounds.maxZ;
        const min = Math.max(wallMin, firstMin, secondMin);
        const max = Math.min(wallMax, firstMax, secondMax);
        if (max - min < 2.6) continue;
        candidates.push({ wall, firstRoom, secondRoom, min, max });
      }
    }
  }
  return candidates;
};

const addInteractiveDoors = (
  plan: MutablePlan,
  world: WorldPlan,
  rootRng: SeededRandom,
): InteractiveDoorFeature[] => {
  const rng = rootRng.fork('feature:interactive-doors');
  const spawnRoom = world.rooms.find((room) =>
    pointInRect(world.spawn.x, world.spawn.z, room.bounds)
  );
  const elevationClearanceRoomIds = new Set(
    world.features
      .filter((feature): feature is RaisedZoneFeature => feature.kind === 'raised-zone')
      .flatMap((feature) => [
        ...(feature.roomIds ?? [feature.roomId]),
        ...(feature.approachRoomIds ?? []),
      ]),
  );
  const candidates = rng.shuffle(boundaryWallCandidates(
    plan,
    world,
    (first, second) =>
      first.id !== spawnRoom?.id &&
      second.id !== spawnRoom?.id &&
      first.level === 0 &&
      second.level === 0 &&
      first.access !== 'sealed' &&
      second.access !== 'sealed' &&
      !elevationClearanceRoomIds.has(first.id) &&
      !elevationClearanceRoomIds.has(second.id) &&
      !roomInZones(first, world.symmetryZones) &&
      !roomInZones(second, world.symmetryZones),
  ));
  // At 5%, a streamed 3x3 neighbourhood still occasionally contains a door,
  // but doors stop reading as a repeated decoration in every room.
  const desired = rng.chance(0.05) ? 1 : 0;
  const added: InteractiveDoorFeature[] = [];
  const usedRoomIds = new Set<string>();

  const explicitContent = (room: RoomRecord): DoorRoomContent | undefined => {
    if (world.features.some(
      (feature) => feature.kind === 'squeeze-view' && feature.roomId === room.id,
    )) return 'crawl';
    if (world.features.some(
      (feature) => feature.kind === 'grid-pit' && feature.roomId === room.id,
    )) return 'hole';
    if (room.kind === 'corridor' || room.kind === 'threshold') return 'passage';
    return undefined;
  };

  for (const [candidateIndex, candidate] of candidates.entries()) {
    if (added.length >= desired) break;
    if (!plan.walls.includes(candidate.wall)) continue;
    const firstContent = explicitContent(candidate.firstRoom);
    const secondContent = explicitContent(candidate.secondRoom);
    const firstDistance = Math.hypot(
      rectCenter(candidate.firstRoom.bounds).x - world.spawn.x,
      rectCenter(candidate.firstRoom.bounds).z - world.spawn.z,
    );
    const secondDistance = Math.hypot(
      rectCenter(candidate.secondRoom.bounds).x - world.spawn.x,
      rectCenter(candidate.secondRoom.bounds).z - world.spawn.z,
    );
    const targetRoom = firstContent && !secondContent
      ? candidate.firstRoom
      : secondContent && !firstContent
        ? candidate.secondRoom
        : firstDistance > secondDistance
          ? candidate.firstRoom
          : candidate.secondRoom;
    const sourceRoom = targetRoom === candidate.firstRoom
      ? candidate.secondRoom
      : candidate.firstRoom;
    if (usedRoomIds.has(sourceRoom.id) || usedRoomIds.has(targetRoom.id)) continue;

    const source = candidate.wall;
    const apertureWidth = 0.96;
    const doorHeight = 2.1;
    const centerMin = candidate.min + apertureWidth * 0.5 + 0.64;
    const centerMax = candidate.max - apertureWidth * 0.5 - 0.64;
    if (centerMax < centerMin || source.height < doorHeight + 0.16) continue;
    let alongCenter = (centerMin + centerMax) * 0.5;
    let foundCenter = false;
    const doorRng = rng.fork(`candidate:${candidateIndex}:${source.id}`);
    for (let attempt = 0; attempt < 10 && !foundCenter; attempt += 1) {
      const proposed = doorRng.float(centerMin, centerMax);
      const x = source.orientation === 'x' ? proposed : source.x;
      const z = source.orientation === 'z' ? proposed : source.z;
      if (!portalNear(plan, x, z, 2.35)) {
        alongCenter = proposed;
        foundCenter = true;
      }
    }
    if (!foundCenter) continue;

    const openingMin = alongCenter - apertureWidth * 0.5;
    const openingMax = alongCenter + apertureWidth * 0.5;
    const sourceAlong = source.orientation === 'x' ? source.x : source.z;
    const sourceMin = sourceAlong - source.length * 0.5;
    const sourceMax = sourceAlong + source.length * 0.5;
    plan.walls = plan.walls.filter((wall) => wall !== source);
    plan.colliders = plan.colliders.filter(
      (collider) =>
        collider.id !== `collider-${source.id}` &&
        collider.id !== `collider-wall-${source.id}`,
    );
    const addFragment = (min: number, max: number, label: string): void => {
      if (max - min <= 0.18) return;
      addWall(plan, doorRng.fork(label), {
        roomId: source.roomId,
        x: source.orientation === 'x' ? (min + max) * 0.5 : source.x,
        z: source.orientation === 'z' ? (min + max) * 0.5 : source.z,
        length: max - min,
        orientation: source.orientation,
        bottom: source.bottom,
        height: source.height,
        thickness: source.thickness,
        tint: source.tint,
        collision: true,
        kind: source.kind,
        detail: source.detail,
      });
    };
    addFragment(sourceMin, openingMin, 'left-jamb');
    addFragment(openingMax, sourceMax, 'right-jamb');
    addWall(plan, doorRng.fork('lintel'), {
      roomId: targetRoom.id,
      x: source.orientation === 'x' ? alongCenter : source.x,
      z: source.orientation === 'z' ? alongCenter : source.z,
      length: apertureWidth,
      orientation: source.orientation,
      bottom: doorHeight,
      height: source.bottom + source.height - doorHeight,
      thickness: source.thickness,
      tint: source.tint,
      collision: true,
      kind: source.kind,
      detail: source.detail,
    });

    const position = {
      x: source.orientation === 'x' ? quantize(alongCenter, 0.01) : source.x,
      y: 0,
      z: source.orientation === 'z' ? quantize(alongCenter, 0.01) : source.z,
    };
    const content = explicitContent(targetRoom) ?? doorRng.weighted([
      { value: 'empty' as const, weight: 0.56 },
      { value: 'message' as const, weight: 0.18 },
      { value: 'object' as const, weight: 0.18 },
      { value: 'passage' as const, weight: 0.08 },
    ]);
    const id = `interactive-door-${added.length}`;
    const crossHalf = source.thickness * 0.5 + 0.08;
    const bounds: Rect = source.orientation === 'x'
      ? {
          minX: position.x - apertureWidth * 0.5,
          maxX: position.x + apertureWidth * 0.5,
          minZ: position.z - crossHalf,
          maxZ: position.z + crossHalf,
        }
      : {
          minX: position.x - crossHalf,
          maxX: position.x + crossHalf,
          minZ: position.z - apertureWidth * 0.5,
          maxZ: position.z + apertureWidth * 0.5,
        };
    const door: InteractiveDoorFeature = {
      kind: 'interactive-door',
      id,
      sourceRoomId: sourceRoom.id,
      targetRoomId: targetRoom.id,
      position,
      orientation: source.orientation,
      width: apertureWidth,
      height: doorHeight,
      openingDirection: targetRoom === candidate.secondRoom ? 1 : -1,
      style: 'office-windowed',
      content,
      colliderId: `interactive-door-collider-${added.length}`,
      bounds,
    };
    added.push(door);
    world.features.push(door);
    plan.portals.push({
      x: position.x,
      z: position.z,
      orientation: source.orientation,
      width: apertureWidth,
    });
    usedRoomIds.add(sourceRoom.id);
    usedRoomIds.add(targetRoom.id);

    const clearance = source.orientation === 'x'
      ? {
          minX: bounds.minX - 0.55,
          maxX: bounds.maxX + 0.55,
          minZ: bounds.minZ - 1.1,
          maxZ: bounds.maxZ + 1.1,
        }
      : {
          minX: bounds.minX - 1.1,
          maxX: bounds.maxX + 1.1,
          minZ: bounds.minZ - 0.55,
          maxZ: bounds.maxZ + 0.55,
        };
    const removedColumns = world.columns.filter((column) => pointInRect(
      column.x,
      column.z,
      clearance,
    ));
    if (removedColumns.length > 0) {
      world.columns = world.columns.filter((column) => !removedColumns.includes(column));
      plan.colliders = plan.colliders.filter((collider) =>
        collider.kind !== 'column' ||
        !removedColumns.some((column) =>
          Math.abs(collider.center.x - column.x) < 0.02 &&
          Math.abs(collider.center.z - column.z) < 0.02
        )
      );
    }
  }
  return added;
};

const addInteractiveDoorColliders = (
  world: WorldPlan,
  doors: readonly InteractiveDoorFeature[],
): void => {
  for (const door of doors) {
    const alongHalf = Math.min(0.56, door.width * 0.42);
    world.colliders.push({
      id: door.colliderId,
      center: {
        x: door.position.x,
        y: door.height * 0.5,
        z: door.position.z,
      },
      halfExtents: {
        x: door.orientation === 'x' ? alongHalf : 0.055,
        y: door.height * 0.5,
        z: door.orientation === 'z' ? alongHalf : 0.055,
      },
      kind: 'barrier',
    });
  }
};

interface PassageBoundarySegment {
  orientation: 'x' | 'z';
  fixed: number;
  min: number;
  max: number;
}

type PassageBoundaryOpening = PassageBoundarySegment;

const subtractPassageInterval = (
  intervals: Array<{ min: number; max: number }>,
  cutMin: number,
  cutMax: number,
): Array<{ min: number; max: number }> =>
  intervals.flatMap((interval) => {
    if (cutMax <= interval.min + 1e-4 || cutMin >= interval.max - 1e-4) return [interval];
    const pieces: Array<{ min: number; max: number }> = [];
    if (cutMin > interval.min + 1e-4) {
      pieces.push({ min: interval.min, max: Math.min(interval.max, cutMin) });
    }
    if (cutMax < interval.max - 1e-4) {
      pieces.push({ min: Math.max(interval.min, cutMax), max: interval.max });
    }
    return pieces;
  });

const exposedPassageBoundaries = (rects: readonly Rect[]): PassageBoundarySegment[] => {
  const result: PassageBoundarySegment[] = [];
  for (const [rectIndex, rect] of rects.entries()) {
    const sides = [
      {
        orientation: 'x' as const,
        fixed: rect.minZ,
        min: rect.minX,
        max: rect.maxX,
        adjacent: (other: Rect) => Math.abs(other.maxZ - rect.minZ) < 0.02,
        overlap: (other: Rect) => ({ min: other.minX, max: other.maxX }),
      },
      {
        orientation: 'x' as const,
        fixed: rect.maxZ,
        min: rect.minX,
        max: rect.maxX,
        adjacent: (other: Rect) => Math.abs(other.minZ - rect.maxZ) < 0.02,
        overlap: (other: Rect) => ({ min: other.minX, max: other.maxX }),
      },
      {
        orientation: 'z' as const,
        fixed: rect.minX,
        min: rect.minZ,
        max: rect.maxZ,
        adjacent: (other: Rect) => Math.abs(other.maxX - rect.minX) < 0.02,
        overlap: (other: Rect) => ({ min: other.minZ, max: other.maxZ }),
      },
      {
        orientation: 'z' as const,
        fixed: rect.maxX,
        min: rect.minZ,
        max: rect.maxZ,
        adjacent: (other: Rect) => Math.abs(other.minX - rect.maxX) < 0.02,
        overlap: (other: Rect) => ({ min: other.minZ, max: other.maxZ }),
      },
    ];
    for (const side of sides) {
      let intervals = [{ min: side.min, max: side.max }];
      for (const [otherIndex, other] of rects.entries()) {
        if (otherIndex === rectIndex || !side.adjacent(other)) continue;
        const overlap = side.overlap(other);
        intervals = subtractPassageInterval(intervals, overlap.min, overlap.max);
      }
      for (const interval of intervals) {
        if (interval.max - interval.min > 1e-4) {
          result.push({
            orientation: side.orientation,
            fixed: side.fixed,
            min: interval.min,
            max: interval.max,
          });
        }
      }
    }
  }
  return result;
};

const passageBounds = (rects: readonly Rect[]): Rect => ({
  minX: Math.min(...rects.map((rect) => rect.minX)),
  maxX: Math.max(...rects.map((rect) => rect.maxX)),
  minZ: Math.min(...rects.map((rect) => rect.minZ)),
  maxZ: Math.max(...rects.map((rect) => rect.maxZ)),
});

const addPassageHoleColliders = (
  colliders: StaticCollider[],
  worldSize: number,
  featureId: string,
  hole: PassageHole,
): void => {
  const shaftThickness = 0.12;
  const shaftTop = 0;
  const shaftBottom = hole.kind === 'void'
    ? getPassageHoleAbyssBottom(hole)
    : PASSAGE_HOLE_LOWER_CEILING_Y - 0.06;
  const shaftHeight = shaftTop - shaftBottom;
  for (const [side, collider] of [
    ['north', {
      x: rectCenter(hole).x,
      z: hole.minZ - shaftThickness * 0.5,
      halfX: rectWidth(hole) * 0.5 + shaftThickness,
      halfZ: shaftThickness * 0.5,
    }],
    ['south', {
      x: rectCenter(hole).x,
      z: hole.maxZ + shaftThickness * 0.5,
      halfX: rectWidth(hole) * 0.5 + shaftThickness,
      halfZ: shaftThickness * 0.5,
    }],
    ['west', {
      x: hole.minX - shaftThickness * 0.5,
      z: rectCenter(hole).z,
      halfX: shaftThickness * 0.5,
      halfZ: rectDepth(hole) * 0.5 + shaftThickness,
    }],
    ['east', {
      x: hole.maxX + shaftThickness * 0.5,
      z: rectCenter(hole).z,
      halfX: shaftThickness * 0.5,
      halfZ: rectDepth(hole) * 0.5 + shaftThickness,
    }],
  ] as const) {
    colliders.push({
      id: `${featureId}-hole-${side}`,
      center: {
        x: collider.x,
        y: shaftBottom + shaftHeight * 0.5,
        z: collider.z,
      },
      halfExtents: {
        x: collider.halfX,
        y: shaftHeight * 0.5,
        z: collider.halfZ,
      },
      kind: 'wall',
    });
  }
  if (hole.kind === 'void') return;

  const previewBounds = getPassageHolePreviewBounds(hole, worldSize);
  colliders.push({
    id: `${featureId}-hole-bottom`,
    center: {
      x: rectCenter(previewBounds).x,
      y: PASSAGE_HOLE_LOWER_FLOOR_Y - 0.12,
      z: rectCenter(previewBounds).z,
    },
    halfExtents: {
      x: rectWidth(previewBounds) * 0.5,
      y: 0.12,
      z: rectDepth(previewBounds) * 0.5,
    },
    kind: 'floor',
  });
  const lowerWallHeight = PASSAGE_HOLE_LOWER_CEILING_Y - PASSAGE_HOLE_LOWER_FLOOR_Y;
  const lowerWallY = PASSAGE_HOLE_LOWER_FLOOR_Y + lowerWallHeight * 0.5;
  for (const [side, collider] of [
    ['north', {
      x: rectCenter(previewBounds).x,
      z: previewBounds.minZ - shaftThickness * 0.5,
      halfX: rectWidth(previewBounds) * 0.5 + shaftThickness,
      halfZ: shaftThickness * 0.5,
    }],
    ['south', {
      x: rectCenter(previewBounds).x,
      z: previewBounds.maxZ + shaftThickness * 0.5,
      halfX: rectWidth(previewBounds) * 0.5 + shaftThickness,
      halfZ: shaftThickness * 0.5,
    }],
    ['west', {
      x: previewBounds.minX - shaftThickness * 0.5,
      z: rectCenter(previewBounds).z,
      halfX: shaftThickness * 0.5,
      halfZ: rectDepth(previewBounds) * 0.5 + shaftThickness,
    }],
    ['east', {
      x: previewBounds.maxX + shaftThickness * 0.5,
      z: rectCenter(previewBounds).z,
      halfX: shaftThickness * 0.5,
      halfZ: rectDepth(previewBounds) * 0.5 + shaftThickness,
    }],
  ] as const) {
    colliders.push({
      id: `${featureId}-lower-preview-${side}`,
      center: { x: collider.x, y: lowerWallY, z: collider.z },
      halfExtents: {
        x: collider.halfX,
        y: lowerWallHeight * 0.5,
        z: collider.halfZ,
      },
      kind: 'wall',
    });
  }
};

interface FlushWallBreachPlan {
  room: RoomRecord;
  layout: 'through' | 'dead-end' | 'left-turn' | 'right-turn' | 't-junction';
  exitCount: number;
  rects: Rect[];
  openings: PassageBoundaryOpening[];
  hole?: PassageHole;
}

const planFlushWallBreach = (
  candidate: BoundaryWallCandidate,
  rng: SeededRandom,
  alongCenter: number,
  apertureWidth: number,
  forceHole: boolean,
  forceVoid: boolean,
): FlushWallBreachPlan | undefined => {
  const source = candidate.wall;
  const fixed = source.orientation === 'x' ? source.z : source.x;
  const hostOptions = [
    { room: candidate.firstRoom, travelSign: -1 as const },
    { room: candidate.secondRoom, travelSign: 1 as const },
  ].filter(({ room, travelSign }) => {
    const availableDepth = source.orientation === 'x'
      ? travelSign < 0 ? fixed - room.bounds.minZ : room.bounds.maxZ - fixed
      : travelSign < 0 ? fixed - room.bounds.minX : room.bounds.maxX - fixed;
    const alongMin = source.orientation === 'x' ? room.bounds.minX : room.bounds.minZ;
    const alongMax = source.orientation === 'x' ? room.bounds.maxX : room.bounds.maxZ;
    return (
      availableDepth >= Math.max(5.85, apertureWidth * 2.75 + 0.62) &&
      alongCenter - alongMin >= apertureWidth * 0.5 + 0.5 &&
      alongMax - alongCenter >= apertureWidth * 0.5 + 0.5
    );
  });
  if (hostOptions.length === 0) return undefined;
  const host = rng.pick(hostOptions);
  const room = host.room;
  const travelSign = host.travelSign;
  const availableDepth = source.orientation === 'x'
    ? travelSign < 0 ? fixed - room.bounds.minZ : room.bounds.maxZ - fixed
    : travelSign < 0 ? fixed - room.bounds.minX : room.bounds.maxX - fixed;
  const alongMin = source.orientation === 'x' ? room.bounds.minX : room.bounds.minZ;
  const alongMax = source.orientation === 'x' ? room.bounds.maxX : room.bounds.maxZ;
  const negativeTurnSpace = alongCenter - alongMin - 0.62;
  const positiveTurnSpace = alongMax - alongCenter - 0.62;
  const minimumTurn = Math.max(3.1, apertureWidth * 1.75);
  const layoutOptions: Array<{
    value: FlushWallBreachPlan['layout'];
    weight: number;
  }> = [
    { value: 'through', weight: 0.15 },
    { value: 'dead-end', weight: 0.3 },
  ];
  if (negativeTurnSpace >= minimumTurn) layoutOptions.push({ value: 'left-turn', weight: 0.22 });
  if (positiveTurnSpace >= minimumTurn) layoutOptions.push({ value: 'right-turn', weight: 0.22 });
  if (negativeTurnSpace >= minimumTurn && positiveTurnSpace >= minimumTurn) {
    layoutOptions.push({ value: 't-junction', weight: 0.16 });
  }
  const layout = forceHole ? 'dead-end' : rng.weighted(layoutOptions);
  const minimumDepth = Math.max(5.2, apertureWidth * 2.75);
  const depth = quantize(
    rng.float(minimumDepth, Math.max(minimumDepth, Math.min(11.5, availableDepth - 0.62))),
    0.05,
  );
  const entryV = -source.thickness * 0.5;
  const halfWidth = apertureWidth * 0.5;
  const localRect = (minU: number, maxU: number, minV: number, maxV: number): Rect => {
    const worldV1 = fixed + travelSign * minV;
    const worldV2 = fixed + travelSign * maxV;
    return source.orientation === 'x'
      ? {
          minX: alongCenter + minU,
          maxX: alongCenter + maxU,
          minZ: Math.min(worldV1, worldV2),
          maxZ: Math.max(worldV1, worldV2),
        }
      : {
          minX: Math.min(worldV1, worldV2),
          maxX: Math.max(worldV1, worldV2),
          minZ: alongCenter + minU,
          maxZ: alongCenter + maxU,
        };
  };
  const crossBoundary = (
    v: number,
    minU = -halfWidth,
    maxU = halfWidth,
  ): PassageBoundaryOpening => ({
    orientation: source.orientation,
    fixed: fixed + travelSign * v,
    min: alongCenter + minU,
    max: alongCenter + maxU,
  });
  const turnBoundary = (
    u: number,
    minV: number,
    maxV: number,
  ): PassageBoundaryOpening => {
    const worldV1 = fixed + travelSign * minV;
    const worldV2 = fixed + travelSign * maxV;
    return {
      orientation: source.orientation === 'x' ? 'z' : 'x',
      fixed: alongCenter + u,
      min: Math.min(worldV1, worldV2),
      max: Math.max(worldV1, worldV2),
    };
  };

  const openings: PassageBoundaryOpening[] = [crossBoundary(entryV)];
  const rects: Rect[] = [];
  let exitCount = 0;
  if (layout === 'left-turn' || layout === 'right-turn' || layout === 't-junction') {
    const turnStart = depth - apertureWidth;
    rects.push(localRect(-halfWidth, halfWidth, entryV, turnStart));
    const leftLength = negativeTurnSpace >= minimumTurn
      ? quantize(rng.float(minimumTurn, Math.min(8.4, negativeTurnSpace)), 0.05)
      : halfWidth;
    const rightLength = positiveTurnSpace >= minimumTurn
      ? quantize(rng.float(minimumTurn, Math.min(8.4, positiveTurnSpace)), 0.05)
      : halfWidth;
    const minU = layout === 'right-turn' ? -halfWidth : -leftLength;
    const maxU = layout === 'left-turn' ? halfWidth : rightLength;
    rects.push(localRect(minU, maxU, turnStart, depth));
    if (layout !== 'right-turn') {
      openings.push(turnBoundary(-leftLength, turnStart, depth));
      exitCount += 1;
    }
    if (layout !== 'left-turn') {
      openings.push(turnBoundary(rightLength, turnStart, depth));
      exitCount += 1;
    }
  } else {
    rects.push(localRect(-halfWidth, halfWidth, entryV, depth));
    if (layout === 'through') {
      openings.push(crossBoundary(depth));
      exitCount = 1;
    }
  }

  let hole: PassageHole | undefined;
  if (layout === 'dead-end' && (forceHole || rng.chance(0.66))) {
    const holeLength = quantize(rng.float(1.25, Math.min(2.45, depth * 0.34)), 0.05);
    const kind = forceVoid ? 'void' as const : 'drop' as const;
    const stories = kind === 'void' ? MAX_PIT_STORIES : 1;
    hole = {
      ...localRect(-halfWidth, halfWidth, depth - holeLength, depth),
      depth: stories * PIT_STORY_PITCH,
      kind,
      stories,
    };
  }
  return { room, layout, exitCount, rects, openings, hole };
};

const carveWallBreach = (
  plan: MutablePlan,
  world: WorldPlan,
  candidate: BoundaryWallCandidate,
  rng: SeededRandom,
  secretRoom?: RoomRecord,
  forceVoid = false,
): boolean => {
  const source = candidate.wall;
  if (!plan.walls.includes(source)) return false;
  const breachProfile = secretRoom || (!forceVoid && !rng.chance(0.62))
    ? 'projecting' as const
    : 'flush' as const;
  const structuralMaximumWidth = candidate.max - candidate.min - 1.35;
  const wideAperture =
    breachProfile === 'flush' &&
    structuralMaximumWidth >= 2.15 &&
    rng.fork('aperture:wide').chance(0.34);
  const maximumWidth = Math.min(
    breachProfile === 'flush' ? wideAperture ? 3.2 : 1.95 : 1.42,
    structuralMaximumWidth,
  );
  if (maximumWidth < 1.02) return false;
  const apertureWidth = quantize(rng.float(
    breachProfile === 'flush'
      ? Math.min(wideAperture ? 2.15 : 1.2, maximumWidth)
      : 1.02,
    maximumWidth,
  ), 0.01);
  const centerMin = candidate.min + apertureWidth * 0.5 + 0.62;
  const centerMax = candidate.max - apertureWidth * 0.5 - 0.62;
  if (centerMax < centerMin) return false;
  let alongCenter = (centerMin + centerMax) * 0.5;
  let foundCenter = secretRoom !== undefined;
  for (let attempt = 0; attempt < 8 && !foundCenter; attempt += 1) {
    const proposed = rng.float(centerMin, centerMax);
    const x = source.orientation === 'x' ? proposed : source.x;
    const z = source.orientation === 'z' ? proposed : source.z;
    if (!portalNear(plan, x, z, 2.25)) {
      alongCenter = proposed;
      foundCenter = true;
    }
  }
  if (!foundCenter) return false;
  const openingMin = alongCenter - apertureWidth * 0.5;
  const openingMax = alongCenter + apertureWidth * 0.5;
  const sourceCenter = source.orientation === 'x' ? source.x : source.z;
  const sourceMin = sourceCenter - source.length * 0.5;
  const sourceMax = sourceCenter + source.length * 0.5;
  const featureId = `wall-breach-${world.features.filter(
    (feature) => feature.kind === 'squeeze-view' && feature.passageStyle === 'wall-breach',
  ).length}`;
  const forceHole = forceVoid || (wideAperture && rng.fork('wide-hole').chance(0.48));
  const flushPlan = breachProfile === 'flush'
    ? planFlushWallBreach(
        candidate,
        rng.fork('flush-layout'),
        alongCenter,
        apertureWidth,
        forceHole,
        forceVoid,
      )
    : undefined;
  if (breachProfile === 'flush' && !flushPlan) return false;
  if (flushPlan && plan.walls.some((wall) => {
    if (wall === source || wall.bottom >= source.height - 0.08) return false;
    const halfX = wall.orientation === 'x' ? wall.length * 0.5 : wall.thickness * 0.5;
    const halfZ = wall.orientation === 'z' ? wall.length * 0.5 : wall.thickness * 0.5;
    return flushPlan.rects.some((rect) =>
      rect.minX < wall.x + halfX + 0.24 &&
      rect.maxX > wall.x - halfX - 0.24 &&
      rect.minZ < wall.z + halfZ + 0.24 &&
      rect.maxZ > wall.z - halfZ - 0.24
    );
  })) return false;
  const roomId = flushPlan?.room.id ?? secretRoom?.id ?? candidate.secondRoom.id;

  plan.walls = plan.walls.filter((wall) => wall !== source);
  plan.colliders = plan.colliders.filter(
    (collider) =>
      collider.id !== `collider-${source.id}` &&
      collider.id !== `collider-wall-${source.id}`,
  );
  const fragment = (min: number, max: number, label: string): void => {
    if (max - min <= 0.18) return;
    addWall(plan, rng.fork(label), {
      roomId: source.roomId,
      x: source.orientation === 'x' ? (min + max) * 0.5 : source.x,
      z: source.orientation === 'z' ? (min + max) * 0.5 : source.z,
      length: max - min,
      orientation: source.orientation,
      bottom: source.bottom,
      height: source.height,
      thickness: source.thickness,
      tint: source.tint,
      collision: true,
      kind: 'wallpaper',
      detail: source.detail,
    });
  };
  fragment(sourceMin, openingMin, 'left-jamb');
  fragment(openingMax, sourceMax, 'right-jamb');

  const clearanceHeight = quantize(
    breachProfile === 'flush'
      ? flushPlan?.hole
        ? rng.float(1.36, 1.49)
        : rng.float(1.58, 2.12)
      : rng.float(1.36, 1.47),
    0.01,
  );
  addWall(plan, rng.fork('lintel'), {
    roomId,
    x: source.orientation === 'x' ? alongCenter : source.x,
    z: source.orientation === 'z' ? alongCenter : source.z,
    length: apertureWidth,
    orientation: source.orientation,
    bottom: clearanceHeight,
    height: source.height - clearanceHeight,
    thickness: source.thickness,
    tint: source.tint,
    collision: true,
    kind: 'wallpaper',
    detail: 'crawl-lintel',
  });

  if (flushPlan) {
    for (const [boundaryIndex, boundary] of exposedPassageBoundaries(flushPlan.rects).entries()) {
      let intervals = [{ min: boundary.min, max: boundary.max }];
      for (const opening of flushPlan.openings) {
        if (
          opening.orientation === boundary.orientation &&
          Math.abs(opening.fixed - boundary.fixed) < 0.02
        ) {
          intervals = subtractPassageInterval(intervals, opening.min, opening.max);
        }
      }
      for (const [intervalIndex, interval] of intervals.entries()) {
        if (interval.max - interval.min <= 0.18) continue;
        addWall(plan, rng.fork(`flush-wall:${boundaryIndex}:${intervalIndex}`), {
          roomId,
          x: boundary.orientation === 'x'
            ? (interval.min + interval.max) * 0.5
            : boundary.fixed,
          z: boundary.orientation === 'z'
            ? (interval.min + interval.max) * 0.5
            : boundary.fixed,
          length: interval.max - interval.min,
          orientation: boundary.orientation,
          bottom: 0,
          height: flushPlan.room.ceilingHeight,
          thickness: 0.18,
          tint: source.tint,
          collision: true,
          kind: 'wallpaper',
          detail: 'crawl-flush-wall',
        });
      }
    }
    const bounds = passageBounds(flushPlan.rects);
    const removedColumns = world.columns.filter((column) =>
      flushPlan.rects.some((rect) =>
        column.x + column.width * 0.5 > rect.minX - 0.08 &&
        column.x - column.width * 0.5 < rect.maxX + 0.08 &&
        column.z + column.depth * 0.5 > rect.minZ - 0.08 &&
        column.z - column.depth * 0.5 < rect.maxZ + 0.08
      )
    );
    if (removedColumns.length > 0) {
      world.columns = world.columns.filter((column) => !removedColumns.includes(column));
      plan.colliders = plan.colliders.filter((collider) =>
        collider.kind !== 'column' ||
        !removedColumns.some((column) =>
          Math.abs(collider.center.x - column.x) < 0.02 &&
          Math.abs(collider.center.z - column.z) < 0.02
        )
      );
    }
    const holes = flushPlan.hole ? [flushPlan.hole] : [];
    world.features.push({
      kind: 'squeeze-view',
      id: featureId,
      roomId,
      bounds,
      axis: source.orientation === 'x' ? 'z' : 'x',
      apertureWidth,
      passageStyle: 'wall-breach',
      breachProfile: 'flush',
      passageRects: flushPlan.rects,
      layout: flushPlan.layout,
      exitCount: flushPlan.exitCount,
      clearanceHeight,
      holes,
    });
    for (const [rectIndex, rect] of flushPlan.rects.entries()) {
      plan.colliders.push({
        id: rectIndex === 0
          ? `${featureId}-low-ceiling`
          : `${featureId}-low-ceiling-${rectIndex}`,
        center: {
          x: rectCenter(rect).x,
          y: clearanceHeight + (flushPlan.room.ceilingHeight - clearanceHeight) * 0.5,
          z: rectCenter(rect).z,
        },
        halfExtents: {
          x: rectWidth(rect) * 0.5,
          y: (flushPlan.room.ceilingHeight - clearanceHeight) * 0.5,
          z: rectDepth(rect) * 0.5,
        },
        kind: 'barrier',
      });
    }
    if (flushPlan.hole) {
      addPassageHoleColliders(plan.colliders, world.size, featureId, flushPlan.hole);
    }
    return true;
  }

  const deepTunnel = secretRoom !== undefined || rng.chance(0.42);
  const sampledTunnelDepth = secretRoom
    ? rng.float(2.2, 4.2)
    : deepTunnel
      ? rng.float(1.35, 2.35)
      : rng.float(0.68, 1.12);
  const tunnelDepth = quantize(
    Math.max(
      sampledTunnelDepth,
      source.thickness + (secretRoom ? 1.3 : deepTunnel ? 0.86 : 0.48),
    ),
    0.05,
  );
  const sideThickness = 0.18;
  const jambOverlap = 0.018;
  const fixed = source.orientation === 'x' ? source.z : source.x;
  const openReveal = secretRoom
    ? Math.max(source.thickness * 0.5 + 0.24, rng.float(0.42, 0.68))
    : tunnelDepth * 0.5;
  const secretOnNegativeSide = secretRoom?.id === candidate.firstRoom.id;
  const travelMin = secretRoom
    ? secretOnNegativeSide
      ? fixed - (tunnelDepth - openReveal)
      : fixed - openReveal
    : fixed - tunnelDepth * 0.5;
  const travelMax = secretRoom
    ? secretOnNegativeSide
      ? fixed + openReveal
      : fixed + (tunnelDepth - openReveal)
    : fixed + tunnelDepth * 0.5;
  const travelCenter = (travelMin + travelMax) * 0.5;
  const bounds: Rect = source.orientation === 'x'
    ? {
        minX: openingMin,
        maxX: openingMax,
        minZ: travelMin,
        maxZ: travelMax,
      }
    : {
        minX: travelMin,
        maxX: travelMax,
        minZ: openingMin,
        maxZ: openingMax,
      };
  const removedColumns = world.columns.filter((column) =>
    column.x + column.width * 0.5 > bounds.minX - 0.08 &&
    column.x - column.width * 0.5 < bounds.maxX + 0.08 &&
    column.z + column.depth * 0.5 > bounds.minZ - 0.08 &&
    column.z - column.depth * 0.5 < bounds.maxZ + 0.08
  );
  if (removedColumns.length > 0) {
    world.columns = world.columns.filter((column) => !removedColumns.includes(column));
    plan.colliders = plan.colliders.filter((collider) =>
      collider.kind !== 'column' ||
      !removedColumns.some((column) =>
        Math.abs(collider.center.x - column.x) < 0.02 &&
        Math.abs(collider.center.z - column.z) < 0.02
      )
    );
  }
  for (const side of [-1, 1] as const) {
    addWall(plan, rng.fork(`tunnel-side:${side}`), {
      roomId,
      x: source.orientation === 'x'
        ? alongCenter + side * (apertureWidth * 0.5 + sideThickness * 0.5 + jambOverlap)
        : travelCenter,
      z: source.orientation === 'x'
        ? travelCenter
        : alongCenter + side * (apertureWidth * 0.5 + sideThickness * 0.5 + jambOverlap),
      length: tunnelDepth,
      orientation: source.orientation === 'x' ? 'z' : 'x',
      bottom: 0,
      height: source.height,
      thickness: sideThickness,
      tint: source.tint,
      collision: true,
      kind: 'wallpaper',
      detail: 'crawl-tunnel',
    });
  }

  world.features.push({
    kind: 'squeeze-view',
    id: featureId,
    roomId,
    bounds,
    axis: source.orientation === 'x' ? 'z' : 'x',
    apertureWidth,
    passageStyle: 'wall-breach',
    breachProfile: 'projecting',
    layout: 'through',
    exitCount: 1,
    clearanceHeight,
    holes: [],
  });
  plan.colliders.push({
    id: `${featureId}-low-ceiling`,
    center: {
      x: rectCenter(bounds).x,
      y: clearanceHeight + (source.height - clearanceHeight) * 0.5,
      z: rectCenter(bounds).z,
    },
    halfExtents: {
      x: rectWidth(bounds) * 0.5,
      y: (source.height - clearanceHeight) * 0.5,
      z: rectDepth(bounds) * 0.5,
    },
    kind: 'barrier',
  });
  return true;
};

const addWallBreaches = (
  plan: MutablePlan,
  world: WorldPlan,
  rootRng: SeededRandom,
): void => {
  const rng = rootRng.fork('feature:wall-breaches');
  const voidPassageEnabled = rootRng
    .fork('feature:wall-breach-hole:void')
    .chance(WALL_BREACH_VOID_PRESENCE_RATE);
  let voidPassageAssigned = false;
  const elevationClearanceRoomIds = new Set(
    world.features
      .filter((feature): feature is RaisedZoneFeature => feature.kind === 'raised-zone')
      .flatMap((feature) => [
        ...(feature.roomIds ?? [feature.roomId]),
        ...(feature.approachRoomIds ?? []),
      ]),
  );
  const featureRoomIds = new Set(world.features.flatMap((feature) =>
    'roomId' in feature ? [feature.roomId] : []
  ));
  const acceptsWallBreachRoom = (room: RoomRecord): boolean =>
    !featureRoomIds.has(room.id) &&
    room.kind !== 'open-hall' &&
    room.kind !== 'pit-gallery';
  const secretRooms = world.rooms.filter((room) => room.access === 'secret');
  const usedRooms = new Set<string>();
  for (const secretRoom of secretRooms) {
    const candidates = rng.shuffle(boundaryWallCandidates(
      plan,
      world,
      (first, second) =>
        !roomInZones(first, world.symmetryZones) &&
        !roomInZones(second, world.symmetryZones) &&
        acceptsWallBreachRoom(first) &&
        acceptsWallBreachRoom(second) &&
        !elevationClearanceRoomIds.has(first.id) &&
        !elevationClearanceRoomIds.has(second.id) &&
        (
          (first.id === secretRoom.id && !roomIsRestricted(second)) ||
          (second.id === secretRoom.id && !roomIsRestricted(first))
        ),
    ));
    const carved = candidates.some((candidate, index) =>
      carveWallBreach(plan, world, candidate, rng.fork(`secret:${secretRoom.id}:${index}`), secretRoom)
    );
    if (carved) usedRooms.add(secretRoom.id);
    else secretRoom.access = 'sealed';
  }

  const desired = rng.int(1, 3);
  let placed = 0;
  const candidates = rng.shuffle(boundaryWallCandidates(
    plan,
    world,
    (first, second) =>
      !roomIsRestricted(first) &&
      !roomIsRestricted(second) &&
      acceptsWallBreachRoom(first) &&
      acceptsWallBreachRoom(second) &&
      !elevationClearanceRoomIds.has(first.id) &&
      !elevationClearanceRoomIds.has(second.id) &&
      !roomInZones(first, world.symmetryZones) &&
      !roomInZones(second, world.symmetryZones),
  ));
  for (const [index, candidate] of candidates.entries()) {
    if (placed >= desired) break;
    if (usedRooms.has(candidate.firstRoom.id) || usedRooms.has(candidate.secondRoom.id)) continue;
    const forceVoid = voidPassageEnabled && !voidPassageAssigned;
    if (!carveWallBreach(
      plan,
      world,
      candidate,
      rng.fork(`ordinary:${index}`),
      undefined,
      forceVoid,
    )) continue;
    if (forceVoid) voidPassageAssigned = true;
    usedRooms.add(candidate.firstRoom.id);
    usedRooms.add(candidate.secondRoom.id);
    placed += 1;
  }
};

const classifyInaccessibleRooms = (
  plan: MutablePlan,
  world: WorldPlan,
): void => {
  const step = 0.25;
  const half = world.size * 0.5;
  const count = Math.floor(world.size / step);
  const indexOf = (gridX: number, gridZ: number): number => gridZ * count + gridX;
  const coordinate = (index: number): number => -half + (index + 0.5) * step;
  const gridRange = (min: number, max: number): [number, number] => [
    clamp(Math.floor((min + half) / step), 0, count - 1),
    clamp(Math.floor((max + half) / step), 0, count - 1),
  ];
  const blocked = new Uint8Array(count * count);
  const markRect = (rect: Rect): void => {
    const [minX, maxX] = gridRange(rect.minX, rect.maxX);
    const [minZ, maxZ] = gridRange(rect.minZ, rect.maxZ);
    for (let gridZ = minZ; gridZ <= maxZ; gridZ += 1) {
      const z = coordinate(gridZ);
      if (z <= rect.minZ || z >= rect.maxZ) continue;
      for (let gridX = minX; gridX <= maxX; gridX += 1) {
        const x = coordinate(gridX);
        if (x > rect.minX && x < rect.maxX) blocked[indexOf(gridX, gridZ)] = 1;
      }
    }
  };
  for (const collider of plan.colliders) {
    if (collider.kind === 'floor' || collider.kind === 'step') continue;
    if (collider.center.y < 0 || collider.center.y - collider.halfExtents.y > 1.12) continue;
    markRect({
      minX: collider.center.x - collider.halfExtents.x - 0.29,
      maxX: collider.center.x + collider.halfExtents.x + 0.29,
      minZ: collider.center.z - collider.halfExtents.z - 0.29,
      maxZ: collider.center.z + collider.halfExtents.z + 0.29,
    });
  }
  for (const feature of world.features) {
    if (feature.kind !== 'grid-pit') continue;
    for (const hole of feature.holes) {
      markRect({
        minX: hole.minX - 0.29,
        maxX: hole.maxX + 0.29,
        minZ: hole.minZ - 0.29,
        maxZ: hole.maxZ + 0.29,
      });
    }
  }
  const spawnX = clamp(Math.floor((world.spawn.x + half) / step), 0, count - 1);
  const spawnZ = clamp(Math.floor((world.spawn.z + half) / step), 0, count - 1);
  const start = indexOf(spawnX, spawnZ);
  const visited = new Uint8Array(count * count);
  const queue = [start];
  visited[start] = 1;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor]!;
    const gridX = index % count;
    const gridZ = Math.floor(index / count);
    for (const [offsetX, offsetZ] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nextX = gridX + offsetX;
      const nextZ = gridZ + offsetZ;
      if (nextX < 0 || nextZ < 0 || nextX >= count || nextZ >= count) continue;
      const next = indexOf(nextX, nextZ);
      if (blocked[next] || visited[next]) continue;
      visited[next] = 1;
      queue.push(next);
    }
  }
  for (const room of world.rooms) {
    const minX = clamp(
      Math.ceil((room.bounds.minX + 0.35 + half) / step - 0.5),
      0,
      count - 1,
    );
    const maxX = clamp(
      Math.floor((room.bounds.maxX - 0.35 + half) / step - 0.5),
      0,
      count - 1,
    );
    const minZ = clamp(
      Math.ceil((room.bounds.minZ + 0.35 + half) / step - 0.5),
      0,
      count - 1,
    );
    const maxZ = clamp(
      Math.floor((room.bounds.maxZ - 0.35 + half) / step - 0.5),
      0,
      count - 1,
    );
    let reachable = false;
    for (let gridZ = minZ; gridZ <= maxZ && !reachable; gridZ += 1) {
      for (let gridX = minX; gridX <= maxX; gridX += 1) {
        if (visited[indexOf(gridX, gridZ)]) {
          reachable = true;
          break;
        }
      }
    }
    if (!reachable) {
      room.access = 'sealed';
      room.detailDensity = 0;
    } else if (room.access === 'sealed') {
      room.access = world.features.some(
        (feature) =>
          feature.kind === 'squeeze-view' &&
          feature.passageStyle === 'wall-breach' &&
          feature.roomId === room.id,
      )
        ? 'secret'
        : 'open';
    }
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
        center: { x: holeCenter.x, y: wallY, z: hole.minZ - side },
        halfExtents: { x: rectWidth(hole) * 0.5 + side * 2, y: shaftHeight * 0.5, z: side },
        kind: 'wall',
      },
      {
        id: `shaft-${holeIndex}-south`,
        center: { x: holeCenter.x, y: wallY, z: hole.maxZ + side },
        halfExtents: { x: rectWidth(hole) * 0.5 + side * 2, y: shaftHeight * 0.5, z: side },
        kind: 'wall',
      },
      {
        id: `shaft-${holeIndex}-west`,
        center: { x: hole.minX - side, y: wallY, z: holeCenter.z },
        halfExtents: { x: side, y: shaftHeight * 0.5, z: rectDepth(hole) * 0.5 + side * 2 },
        kind: 'wall',
      },
      {
        id: `shaft-${holeIndex}-east`,
        center: { x: hole.maxX + side, y: wallY, z: holeCenter.z },
        halfExtents: { x: side, y: shaftHeight * 0.5, z: rectDepth(hole) * 0.5 + side * 2 },
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
          center: { x: holeCenter.x, y: abyssY, z: hole.minZ - side },
          halfExtents: { x: rectWidth(hole) * 0.5 + side * 2, y: abyssHeight * 0.5, z: side },
          kind: 'wall',
        },
        {
          id: `abyss-${holeIndex}-south`,
          center: { x: holeCenter.x, y: abyssY, z: hole.maxZ + side },
          halfExtents: { x: rectWidth(hole) * 0.5 + side * 2, y: abyssHeight * 0.5, z: side },
          kind: 'wall',
        },
        {
          id: `abyss-${holeIndex}-west`,
          center: { x: hole.minX - side, y: abyssY, z: holeCenter.z },
          halfExtents: { x: side, y: abyssHeight * 0.5, z: rectDepth(hole) * 0.5 + side * 2 },
          kind: 'wall',
        },
        {
          id: `abyss-${holeIndex}-east`,
          center: { x: hole.maxX + side, y: abyssY, z: holeCenter.z },
          halfExtents: { x: side, y: abyssHeight * 0.5, z: rectDepth(hole) * 0.5 + side * 2 },
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
      (
        (feature.kind === 'grid-pit' || feature.kind === 'squeeze-view') &&
        (feature.holes ?? []).some((hole) => lightPanelOverlapsRect(light, hole))
      ) ||
      (
        feature.kind === 'stair-socket' &&
        lightPanelOverlapsRect(light, feature.bounds)
      ),
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
    if (room.access === 'sealed') continue;
    const rng = rootRng.fork(`lighting:${room.id}`);
    const width = rectWidth(room.bounds);
    const depth = rectDepth(room.bounds);
    const center = rectCenter(room.bounds);
    const longX = width >= depth;

    if (roomInZones(room, world.symmetryZones)) {
      const countX = Math.max(1, Math.min(9, Math.floor((width - 2.6) / 5.8)));
      const countZ = Math.max(1, Math.min(7, Math.floor((depth - 2.6) / 5.8)));
      for (let xIndex = 0; xIndex < countX; xIndex += 1) {
        for (let zIndex = 0; zIndex < countZ; zIndex += 1) {
          const x = room.bounds.minX + ((xIndex + 0.5) / countX) * width;
          const z = room.bounds.minZ + ((zIndex + 0.5) / countZ) * depth;
          addLight(
            world,
            room,
            rng.fork(`formal-slot-${xIndex}-${zIndex}`),
            x,
            z,
            longX ? 0 : Math.PI * 0.5,
          );
        }
      }
    } else if (room.kind === 'corridor') {
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
  for (const [index, wall] of getStairCageWalls(stairs, world.wallHeight).entries()) {
    const center = rectCenter(wall.bounds);
    world.colliders.push({
      id: `${stairs.id}-cage-wall-${index}`,
      center: {
        x: center.x,
        y: (wall.bottom + wall.top) * 0.5,
        z: center.z,
      },
      halfExtents: {
        x: rectWidth(wall.bounds) * 0.5,
        y: (wall.top - wall.bottom) * 0.5,
        z: rectDepth(wall.bounds) * 0.5,
      },
      kind: 'wall',
    });
  }
};

export const generateSurfaceStyle = (seed: string): SurfaceStyle => {
  const surfaceRng = new SeededRandom(`${seed}:v${GENERATOR_VERSION}`).fork('surface-style');
  const surfaceProfile = surfaceRng.weighted([
    { value: 'balanced' as const, weight: 0.7 },
    { value: 'faded' as const, weight: 0.16 },
    { value: 'dense' as const, weight: 0.14 },
  ]);
  return {
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
};

export const generateWorld = (seed: string): WorldPlan => {
  const rootRng = new SeededRandom(`${seed}:v${GENERATOR_VERSION}`);
  const surfaceStyle = generateSurfaceStyle(seed);
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
  if (stairDefinition && rootRng.fork('feature:stairs:presence').chance(0.28)) {
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

  assignRestrictedRooms(mutable, world, reservedRoomIds, rootRng);
  selectArchitectureZones(world, rootRng);
  addRaisedZones(mutable, world, reservedRoomIds, rootRng);
  addCeilingVariations(mutable, world, reservedRoomIds, rootRng);
  addSqueezeViews(mutable, world, reservedRoomIds, rootRng);
  addColumnsAndPartialWalls(mutable, world, reservedRoomIds, rootRng);
  enforcePortalClearances(mutable);
  sealRestrictedRooms(mutable, world, rootRng);
  const interactiveDoors = addInteractiveDoors(mutable, world, rootRng);
  addWallBreaches(mutable, world, rootRng);
  world.walls = mutable.walls;
  world.colliders = mutable.colliders;
  addSolidMasses(world, reservedRoomIds, rootRng);
  classifyInaccessibleRooms(mutable, world);
  addInteractiveDoorColliders(world, interactiveDoors);
  rebuildSunkenArchitectureExtensions(world);
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
  const elevationCutouts = world.features
    .filter((feature): feature is RaisedZoneFeature => feature.kind === 'raised-zone')
    .flatMap((feature) => [
      ...(feature.platformRects ?? [feature.platformBounds]),
      ...(feature.ramps ?? [feature.ramp]).map((ramp) => ramp.bounds),
    ]);
  world.floorRects = floorCellsAroundHoles(worldBounds, [...holes, ...elevationCutouts]);
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
    world.rooms
      .map((room) => `${room.id}:${room.kind}:${room.access ?? 'open'}:${rectArea(room.bounds).toFixed(2)}`)
      .join('|'),
    world.walls
      .map((wall) => `${wall.orientation}:${wall.x.toFixed(2)}:${wall.z.toFixed(2)}:${wall.length.toFixed(2)}`)
      .join('|'),
    world.features.map((feature) =>
      feature.kind === 'squeeze-view'
        ? `${feature.id}:${feature.passageStyle ?? 'room-network'}:${feature.breachProfile ?? 'none'}:${feature.layout ?? 'through'}:${(feature.passageRects ?? [feature.bounds])
            .map((rect) => `${rect.minX.toFixed(2)},${rect.minZ.toFixed(2)},${rect.maxX.toFixed(2)},${rect.maxZ.toFixed(2)}`)
            .join(';')}:${(feature.holes ?? [])
            .map((hole) => `${hole.kind ?? 'drop'}-${hole.stories ?? 1}`)
            .join(',')}`
        : feature.kind === 'raised-zone'
          ? `${feature.id}:${feature.elevation}:${(feature.roomIds ?? [feature.roomId]).join(',')}:${(feature.approachRoomIds ?? []).join(',')}:${(feature.ramps ?? [feature.ramp]).length}`
          : feature.kind === 'stair-socket'
            ? `${feature.id}:${feature.layout ?? 'switchback'}:${feature.switchbackJoin ?? 'joined'}`
          : feature.id
    ).join('|'),
    (world.ceilingZones ?? []).map((zone) =>
      `${zone.id}:${zone.scale}:${zone.height}:${zone.roomIds.join(',')}`
    ).join('|'),
    (world.baseboardlessZones ?? []).map((zone) =>
      `${zone.minX},${zone.minZ},${zone.maxX},${zone.maxZ}`
    ).join('|'),
    (world.plasterZones ?? []).map((zone) =>
      `${zone.minX},${zone.minZ},${zone.maxX},${zone.maxZ}`
    ).join('|'),
    world.lights.map((light) => `${light.x}:${light.z}:${Number(light.dead)}`).join('|'),
    (world.propPlacements ?? [])
      .map((placement) =>
        `${placement.assetId}:${placement.position.x.toFixed(2)},${placement.position.z.toFixed(2)}`
      )
      .join('|'),
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
