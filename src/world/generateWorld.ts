import { createDefaultFeatureRegistry } from './FeatureRegistry';
import { SeededRandom } from './SeededRandom';
import type {
  GridPitFeature,
  LightSlot,
  PitHole,
  Rect,
  RoomKind,
  RoomRecord,
  StairSocketFeature,
  StaticCollider,
  VistaFeature,
  WallSegment,
  WorldPlan,
} from './types';
import { pointInRect, rectArea, rectCenter, rectDepth, rectWidth } from './types';

const GENERATOR_VERSION = 5;
const WORLD_SIZE = 112;
const WALL_HEIGHT = 2.74;
const WALL_THICKNESS = 0.22;
const MIN_ROOM_SPAN = 7;
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
  if (area >= 175 && Math.min(width, depth) >= 10.5 && rng.chance(0.08)) return 'open-hall';
  return rng.weighted([
    { value: 'office' as const, weight: 5.5 },
    { value: 'nested' as const, weight: 3.2 },
    { value: 'threshold' as const, weight: 2.6 },
    { value: 'sparse' as const, weight: 0.35 },
  ]);
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
  const corridorLeaf = depth >= 3 && shortSpan <= 8.25 && longSpan >= 12 && longSpan <= 28;
  const compactLeaf = depth >= 4 && rectArea(bounds) <= 210 && longSpan <= 18;
  const stopChance = corridorLeaf ? 0.7 : compactLeaf ? 0.42 + Math.max(0, depth - 4) * 0.08 : 0;

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
    const gapCount = span > 28 && rng.chance(0.12) ? 2 : 1;
    const gaps: Gap[] = [];
    for (let index = 0; index < gapCount; index += 1) {
      const lane = gapCount === 1 ? 0.5 : index === 0 ? 0.3 : 0.7;
      const center = quantize(
        bounds.minZ + span * clamp(lane + rng.float(-0.12, 0.12), 0.18, 0.82),
        0.25,
      );
      const widthOfGap = rng.chance(0.08) ? rng.float(3.6, 4.8) : rng.float(2.15, 3.05);
      gaps.push({ min: center - widthOfGap * 0.5, max: center + widthOfGap * 0.5 });
    }
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
    const gapCount = span > 28 && rng.chance(0.12) ? 2 : 1;
    const gaps: Gap[] = [];
    for (let index = 0; index < gapCount; index += 1) {
      const lane = gapCount === 1 ? 0.5 : index === 0 ? 0.3 : 0.7;
      const center = quantize(
        bounds.minX + span * clamp(lane + rng.float(-0.12, 0.12), 0.18, 0.82),
        0.25,
      );
      const widthOfGap = rng.chance(0.08) ? rng.float(3.6, 4.8) : rng.float(2.15, 3.05);
      gaps.push({ min: center - widthOfGap * 0.5, max: center + widthOfGap * 0.5 });
    }
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
  const verticalStrip = rng.chance(0.5);
  const nearMinimum = rng.chance(0.5);
  const hallAtMinimum = rng.chance(0.5);
  const stripWidth = quantize(rng.float(22, 27), 0.5);
  const hallDepth = quantize(rng.float(21, 27), 0.5);

  let hall: Rect;
  let stripRemainder: Rect;
  let mainRemainder: Rect;

  if (verticalStrip) {
    const stripSplit = nearMinimum ? bounds.minX + stripWidth : bounds.maxX - stripWidth;
    const strip = nearMinimum ? { ...bounds, maxX: stripSplit } : { ...bounds, minX: stripSplit };
    mainRemainder = nearMinimum ? { ...bounds, minX: stripSplit } : { ...bounds, maxX: stripSplit };
    const hallSplit = hallAtMinimum ? bounds.minZ + hallDepth : bounds.maxZ - hallDepth;
    hall = hallAtMinimum ? { ...strip, maxZ: hallSplit } : { ...strip, minZ: hallSplit };
    stripRemainder = hallAtMinimum ? { ...strip, minZ: hallSplit } : { ...strip, maxZ: hallSplit };

    const mainGaps: Gap[] = [
      { min: rectCenter(hall).z - 2.15, max: rectCenter(hall).z + 2.15 },
      { min: rectCenter(stripRemainder).z - 1.35, max: rectCenter(stripRemainder).z + 1.35 },
    ];
    wallAroundGaps(plan, rng.fork('main-wall'), 'z', stripSplit, bounds.minZ, bounds.maxZ, mainGaps, 'wallpaper', 0.42);
    wallAroundGaps(
      plan,
      rng.fork('hall-wall'),
      'x',
      hallSplit,
      strip.minX,
      strip.maxX,
      [{ min: rectCenter(strip).x - 1.65, max: rectCenter(strip).x + 1.65 }],
      'wallpaper',
      0.72,
    );
  } else {
    const stripSplit = nearMinimum ? bounds.minZ + stripWidth : bounds.maxZ - stripWidth;
    const strip = nearMinimum ? { ...bounds, maxZ: stripSplit } : { ...bounds, minZ: stripSplit };
    mainRemainder = nearMinimum ? { ...bounds, minZ: stripSplit } : { ...bounds, maxZ: stripSplit };
    const hallSplit = hallAtMinimum ? bounds.minX + hallDepth : bounds.maxX - hallDepth;
    hall = hallAtMinimum ? { ...strip, maxX: hallSplit } : { ...strip, minX: hallSplit };
    stripRemainder = hallAtMinimum ? { ...strip, minX: hallSplit } : { ...strip, maxX: hallSplit };

    const mainGaps: Gap[] = [
      { min: rectCenter(hall).x - 2.15, max: rectCenter(hall).x + 2.15 },
      { min: rectCenter(stripRemainder).x - 1.35, max: rectCenter(stripRemainder).x + 1.35 },
    ];
    wallAroundGaps(plan, rng.fork('main-wall'), 'x', stripSplit, bounds.minX, bounds.maxX, mainGaps, 'wallpaper', 0.42);
    wallAroundGaps(
      plan,
      rng.fork('hall-wall'),
      'z',
      hallSplit,
      strip.minZ,
      strip.maxZ,
      [{ min: rectCenter(strip).z - 1.65, max: rectCenter(strip).z + 1.65 }],
      'wallpaper',
      0.72,
    );
  }

  plan.rooms.push({
    id: 'room-grand-hall',
    bounds: hall,
    kind: 'open-hall',
    level: 0,
    ceilingHeight: WALL_HEIGHT,
    detailDensity: rng.float(0.18, 0.42),
  });
  splitPartitions(mainRemainder, 1, 'M', rootRng, plan);
  splitPartitions(stripRemainder, 2, 'S', rootRng, plan);
};

const buildGridPit = (room: RoomRecord, rng: SeededRandom, lowerBounds: Rect): GridPitFeature => {
  const center = rectCenter(room.bounds);
  const pattern = rng.weighted([
    { value: 'small-grid' as const, weight: 0.42 },
    { value: 'mixed-grid' as const, weight: 0.4 },
    { value: 'large-cluster' as const, weight: 0.18 },
  ]);
  const holes: PitHole[] = [];
  let footprintWidth: number;
  let footprintDepth: number;
  const dropDepth = 5.4;

  if (pattern === 'small-grid') {
    const size = rng.float(1.16, 1.52);
    const bridge = rng.float(0.82, 1.28);
    const columns = rng.int(2, 5);
    const rows = rng.int(2, 4);
    footprintWidth = size * columns + bridge * (columns - 1);
    footprintDepth = size * rows + bridge * (rows - 1);
    for (let xIndex = 0; xIndex < columns; xIndex += 1) {
      for (let zIndex = 0; zIndex < rows; zIndex += 1) {
        const minX = center.x - footprintWidth * 0.5 + xIndex * (size + bridge);
        const minZ = center.z - footprintDepth * 0.5 + zIndex * (size + bridge);
        holes.push({ minX, maxX: minX + size, minZ, maxZ: minZ + size, depth: dropDepth });
      }
    }
  } else if (pattern === 'mixed-grid') {
    const size = rng.float(1.12, 1.42);
    const bridge = rng.float(0.86, 1.22);
    footprintWidth = size * 3 + bridge * 2;
    footprintDepth = size * 3 + bridge * 2;
    const originX = center.x - footprintWidth * 0.5;
    const originZ = center.z - footprintDepth * 0.5;
    holes.push({
      minX: originX,
      maxX: originX + size * 2 + bridge,
      minZ: originZ,
      maxZ: originZ + size * 2 + bridge,
      depth: dropDepth,
    });
    for (const [xIndex, zIndex] of [[2, 0], [2, 1], [0, 2], [1, 2], [2, 2]] as const) {
      const minX = originX + xIndex * (size + bridge);
      const minZ = originZ + zIndex * (size + bridge);
      holes.push({ minX, maxX: minX + size, minZ, maxZ: minZ + size, depth: dropDepth });
    }
  } else {
    const small = rng.float(1.12, 1.48);
    const bridge = rng.float(0.9, 1.3);
    const largeWidth = rng.float(3.8, 5.9);
    const largeDepth = rng.float(3.6, 5.6);
    const smallGridWidth = small * 2 + bridge;
    footprintWidth = largeWidth + bridge + smallGridWidth;
    footprintDepth = Math.max(largeDepth, small * 2 + bridge);
    const originX = center.x - footprintWidth * 0.5;
    const originZ = center.z - footprintDepth * 0.5;
    holes.push({
      minX: originX,
      maxX: originX + largeWidth,
      minZ: center.z - largeDepth * 0.5,
      maxZ: center.z + largeDepth * 0.5,
      depth: dropDepth,
    });
    const smallOriginX = originX + largeWidth + bridge;
    for (let xIndex = 0; xIndex < 2; xIndex += 1) {
      for (let zIndex = 0; zIndex < 2; zIndex += 1) {
        const minX = smallOriginX + xIndex * (small + bridge);
        const minZ = center.z - footprintDepth * 0.5 + zIndex * (small + bridge);
        holes.push({ minX, maxX: minX + small, minZ, maxZ: minZ + small, depth: dropDepth });
      }
    }
  }

  for (const hole of holes) {
    hole.kind = 'drop';
    hole.stories = 1;
  }
  if (pattern === 'large-cluster' && rng.chance(0.3)) {
    const abyss = [...holes].sort((a, b) => rectWidth(b) * rectDepth(b) - rectWidth(a) * rectDepth(a))[0];
    if (abyss) {
      abyss.kind = 'void';
      abyss.stories = rng.int(4, 7);
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
  const rotate = rng.chance(0.5);
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
  const margin = 1.15;
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
  return {
    kind: 'grid-pit',
    id: `grid-pit-${room.id}`,
    roomId: room.id,
    bounds,
    holes,
    depth: dropDepth,
    pattern,
    lowerBounds: { ...lowerBounds },
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

const addColumnsAndPartialWalls = (
  plan: MutablePlan,
  world: WorldPlan,
  reservedRoomIds: Set<string>,
  rootRng: SeededRandom,
): void => {
  for (const room of world.rooms) {
    if (reservedRoomIds.has(room.id)) continue;
    const rng = rootRng.fork(`architecture:${room.id}`);
    const width = rectWidth(room.bounds);
    const depth = rectDepth(room.bounds);

    if (room.kind === 'open-hall' && width > 12 && depth > 12) {
      const spacing = rng.float(5.2, 7.2);
      for (let x = room.bounds.minX + 3.2; x <= room.bounds.maxX - 3.2; x += spacing) {
        for (let z = room.bounds.minZ + 3.2; z <= room.bounds.maxZ - 3.2; z += spacing) {
          if (rng.chance(0.22) || Math.hypot(x - world.spawn.x, z - world.spawn.z) < 3.4) continue;
          const column = {
            x: quantize(x + rng.float(-0.32, 0.32), 0.05),
            z: quantize(z + rng.float(-0.32, 0.32), 0.05),
            width: rng.float(0.72, 1.15),
            depth: rng.float(0.72, 1.15),
            height: WALL_HEIGHT,
            tint: rng.float(0.82, 1.07),
          };
          world.columns.push(column);
          plan.colliders.push({
            id: `column-${world.columns.length - 1}`,
            center: { x: column.x, y: column.height * 0.5, z: column.z },
            halfExtents: { x: column.width * 0.5, y: column.height * 0.5, z: column.depth * 0.5 },
            kind: 'column',
          });
        }
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
        if (alongX) {
          const length = rng.float(width * 0.38, width * 0.68);
          const centerX = rng.float(room.bounds.minX + length * 0.5 + 1.8, room.bounds.maxX - length * 0.5 - 1.8);
          const z = rng.float(room.bounds.minZ + 3, room.bounds.maxZ - 3);
          addWall(plan, rng.fork(`return-${index}`), {
            x: centerX,
            z,
            length,
            orientation: 'x',
            bottom: 0,
            height: rng.chance(0.18) ? WALL_HEIGHT * 0.68 : WALL_HEIGHT,
            thickness: WALL_THICKNESS,
            collision: true,
            kind: 'wallpaper',
          });
        } else {
          const length = rng.float(depth * 0.38, depth * 0.68);
          const centerZ = rng.float(room.bounds.minZ + length * 0.5 + 1.8, room.bounds.maxZ - length * 0.5 - 1.8);
          const x = rng.float(room.bounds.minX + 3, room.bounds.maxX - 3);
          addWall(plan, rng.fork(`return-${index}`), {
            x,
            z: centerZ,
            length,
            orientation: 'z',
            bottom: 0,
            height: rng.chance(0.18) ? WALL_HEIGHT * 0.68 : WALL_HEIGHT,
            thickness: WALL_THICKNESS,
            collision: true,
            kind: 'wallpaper',
          });
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
  const candidates = rng.shuffle(
    world.rooms.filter((room) => {
      if (reservedRoomIds.has(room.id) || room.kind === 'corridor' || room.kind === 'open-hall') return false;
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
    const length = Math.min(longSpan - 4.2, roomRng.float(8.5, 18));
    const corridorWidth = roomRng.float(2.15, 2.85);
    const apertureWidth = roomRng.float(0.38, 0.48);
    const roomCenter = rectCenter(room.bounds);
    const crossOffset = roomRng.float(-0.45, 0.45);
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
    if (alongX) {
      wall('side-north', { x: roomCenter.x, z: bounds.minZ, length, orientation: 'x', bottom: 0, height: WALL_HEIGHT, thickness: 0.22 });
      wall('side-south', { x: roomCenter.x, z: bounds.maxZ, length, orientation: 'x', bottom: 0, height: WALL_HEIGHT, thickness: 0.22 });
      wall('end', { x: bounds.maxX, z: (bounds.minZ + bounds.maxZ) * 0.5, length: corridorWidth, orientation: 'z', bottom: 0, height: WALL_HEIGHT, thickness: 0.3 });
      const sideLength = (corridorWidth - apertureWidth) * 0.5;
      wall('front-a', { x: bounds.minX, z: bounds.minZ + sideLength * 0.5, length: sideLength, orientation: 'z', bottom: 0, height: WALL_HEIGHT, thickness: 0.3 });
      wall('front-b', { x: bounds.minX, z: bounds.maxZ - sideLength * 0.5, length: sideLength, orientation: 'z', bottom: 0, height: WALL_HEIGHT, thickness: 0.3 });
    } else {
      wall('side-west', { x: bounds.minX, z: roomCenter.z, length, orientation: 'z', bottom: 0, height: WALL_HEIGHT, thickness: 0.22 });
      wall('side-east', { x: bounds.maxX, z: roomCenter.z, length, orientation: 'z', bottom: 0, height: WALL_HEIGHT, thickness: 0.22 });
      wall('end', { x: (bounds.minX + bounds.maxX) * 0.5, z: bounds.maxZ, length: corridorWidth, orientation: 'x', bottom: 0, height: WALL_HEIGHT, thickness: 0.3 });
      const sideLength = (corridorWidth - apertureWidth) * 0.5;
      wall('front-a', { x: bounds.minX + sideLength * 0.5, z: bounds.minZ, length: sideLength, orientation: 'x', bottom: 0, height: WALL_HEIGHT, thickness: 0.3 });
      wall('front-b', { x: bounds.maxX - sideLength * 0.5, z: bounds.minZ, length: sideLength, orientation: 'x', bottom: 0, height: WALL_HEIGHT, thickness: 0.3 });
    }
    world.features.push({
      kind: 'squeeze-view',
      id: featureId,
      roomId: room.id,
      bounds,
      axis: alongX ? 'x' : 'z',
      apertureWidth,
    });
    addWorldLight(world, {
      id: `light-${featureId}`,
      x: alongX ? bounds.minX + length * 0.68 : (bounds.minX + bounds.maxX) * 0.5,
      ceilingY: WALL_HEIGHT,
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

const addLowerWallAroundGap = (
  world: WorldPlan,
  feature: GridPitFeature,
  orientation: 'x' | 'z',
  fixed: number,
  spanMin: number,
  spanMax: number,
  gapCenter: number,
  gapWidth: number,
  thickness: number,
): void => {
  const before = gapCenter - gapWidth * 0.5 - spanMin;
  const after = spanMax - (gapCenter + gapWidth * 0.5);
  if (before > 0.3) {
    addLowerWall(world, feature, {
      x: orientation === 'x' ? spanMin + before * 0.5 : fixed,
      z: orientation === 'z' ? spanMin + before * 0.5 : fixed,
      length: before,
      orientation,
      thickness,
    });
  }
  if (after > 0.3) {
    addLowerWall(world, feature, {
      x: orientation === 'x' ? gapCenter + gapWidth * 0.5 + after * 0.5 : fixed,
      z: orientation === 'z' ? gapCenter + gapWidth * 0.5 + after * 0.5 : fixed,
      length: after,
      orientation,
      thickness,
    });
  }
};

const addLowerLevel = (world: WorldPlan, feature: GridPitFeature, rootRng: SeededRandom): void => {
  const rng = rootRng.fork('lower-level');
  const bounds = feature.lowerBounds;
  const center = rectCenter(bounds);

  addLowerWall(world, feature, { x: center.x, z: bounds.minZ, length: rectWidth(bounds), orientation: 'x', thickness: 0.42 });
  addLowerWall(world, feature, { x: center.x, z: bounds.maxZ, length: rectWidth(bounds), orientation: 'x', thickness: 0.42 });
  addLowerWall(world, feature, { x: bounds.minX, z: center.z, length: rectDepth(bounds), orientation: 'z', thickness: 0.42 });
  addLowerWall(world, feature, { x: bounds.maxX, z: center.z, length: rectDepth(bounds), orientation: 'z', thickness: 0.42 });

  // A seeded connected cell graph replaces the old fixed cross. Every cell is
  // reached by the spanning tree, while extra loops prevent frustrating dead
  // ends and make each lower floor read as a continued Backrooms level.
  const columns = rng.int(7, 10);
  const rows = rng.int(6, 9);
  const cellWidth = rectWidth(bounds) / columns;
  const cellDepth = rectDepth(bounds) / rows;
  const cellIndex = (x: number, z: number): number => z * columns + x;
  const edgeKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const openEdges = new Set<string>();
  const visited = new Set<number>();
  const startX = Math.max(0, Math.min(columns - 1, Math.floor((rectCenter(feature.bounds).x - bounds.minX) / cellWidth)));
  const startZ = Math.max(0, Math.min(rows - 1, Math.floor((rectCenter(feature.bounds).z - bounds.minZ) / cellDepth)));
  const stack = [cellIndex(startX, startZ)];
  visited.add(stack[0]!);
  while (stack.length > 0) {
    const current = stack[stack.length - 1]!;
    const x = current % columns;
    const z = Math.floor(current / columns);
    const neighbours = rng.shuffle([
      x > 0 ? cellIndex(x - 1, z) : -1,
      x < columns - 1 ? cellIndex(x + 1, z) : -1,
      z > 0 ? cellIndex(x, z - 1) : -1,
      z < rows - 1 ? cellIndex(x, z + 1) : -1,
    ].filter((value) => value >= 0 && !visited.has(value)));
    const next = neighbours[0];
    if (next === undefined) {
      stack.pop();
      continue;
    }
    openEdges.add(edgeKey(current, next));
    visited.add(next);
    stack.push(next);
  }
  for (let z = 0; z < rows; z += 1) {
    for (let x = 0; x < columns; x += 1) {
      const current = cellIndex(x, z);
      if (x < columns - 1 && rng.chance(0.42)) openEdges.add(edgeKey(current, cellIndex(x + 1, z)));
      if (z < rows - 1 && rng.chance(0.42)) openEdges.add(edgeKey(current, cellIndex(x, z + 1)));
    }
  }

  const thicknessFor = (): number => rng.weighted([
    { value: 0.24, weight: 0.58 },
    { value: 0.46, weight: 0.27 },
    { value: 0.76, weight: 0.12 },
    { value: 1.08, weight: 0.03 },
  ]);
  for (let boundaryX = 1; boundaryX < columns; boundaryX += 1) {
    const fixedX = bounds.minX + boundaryX * cellWidth;
    for (let z = 0; z < rows; z += 1) {
      const spanMin = bounds.minZ + z * cellDepth;
      const spanMax = spanMin + cellDepth;
      if (
        fixedX >= feature.bounds.minX - 0.8 &&
        fixedX <= feature.bounds.maxX + 0.8 &&
        spanMax >= feature.bounds.minZ - 0.8 &&
        spanMin <= feature.bounds.maxZ + 0.8
      ) continue;
      const left = cellIndex(boundaryX - 1, z);
      const right = cellIndex(boundaryX, z);
      const thickness = thicknessFor();
      if (openEdges.has(edgeKey(left, right))) {
        addLowerWallAroundGap(
          world,
          feature,
          'z',
          fixedX,
          spanMin,
          spanMax,
          rng.float(spanMin + cellDepth * 0.32, spanMax - cellDepth * 0.32),
          rng.float(2.25, 3.45),
          thickness,
        );
      } else {
        addLowerWall(world, feature, { x: fixedX, z: (spanMin + spanMax) * 0.5, length: cellDepth, orientation: 'z', thickness });
      }
    }
  }
  for (let boundaryZ = 1; boundaryZ < rows; boundaryZ += 1) {
    const fixedZ = bounds.minZ + boundaryZ * cellDepth;
    for (let x = 0; x < columns; x += 1) {
      const spanMin = bounds.minX + x * cellWidth;
      const spanMax = spanMin + cellWidth;
      if (
        fixedZ >= feature.bounds.minZ - 0.8 &&
        fixedZ <= feature.bounds.maxZ + 0.8 &&
        spanMax >= feature.bounds.minX - 0.8 &&
        spanMin <= feature.bounds.maxX + 0.8
      ) continue;
      const north = cellIndex(x, boundaryZ - 1);
      const south = cellIndex(x, boundaryZ);
      const thickness = thicknessFor();
      if (openEdges.has(edgeKey(north, south))) {
        addLowerWallAroundGap(
          world,
          feature,
          'x',
          fixedZ,
          spanMin,
          spanMax,
          rng.float(spanMin + cellWidth * 0.32, spanMax - cellWidth * 0.32),
          rng.float(2.25, 3.45),
          thickness,
        );
      } else {
        addLowerWall(world, feature, { x: (spanMin + spanMax) * 0.5, z: fixedZ, length: cellWidth, orientation: 'x', thickness });
      }
    }
  }

  const voidHoles = feature.holes.filter((hole) => hole.kind === 'void');
  for (const [index, floor] of floorCellsAroundHoles(bounds, voidHoles).entries()) {
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
  const lightColumns = Math.max(4, Math.floor(rectWidth(bounds) / rng.float(5.8, 7.2)));
  const lightRows = Math.max(4, Math.floor(rectDepth(bounds) / rng.float(5.8, 7.2)));
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

const temperatureColors = [0xfff0bd, 0xfff6d5, 0xf2f2ca, 0xffe7ae, 0xeeecc5] as const;
const CEILING_TILE_SIZE = 2.4;

const snapToCeilingTileCenter = (value: number, worldSize: number): number => {
  const origin = -worldSize * 0.5;
  const index = Math.floor((value - origin) / CEILING_TILE_SIZE);
  return quantize(origin + (index + 0.5) * CEILING_TILE_SIZE, 0.05);
};

const lightPanelFootprint = (light: LightSlot): { halfX: number; halfZ: number } => {
  const longHalf = light.width * 0.5 + 0.32;
  const shortHalf = (light.width > 1.65 ? 0.58 : 0.46) + 0.32;
  const alongX = Math.abs(Math.cos(light.rotation)) >= Math.abs(Math.sin(light.rotation));
  return alongX
    ? { halfX: longHalf, halfZ: shortHalf }
    : { halfX: shortHalf, halfZ: longHalf };
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
      feature.holes.some((hole) => pointInRect(light.x, light.z, hole, -0.72)),
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

const addStepColliders = (world: WorldPlan, stairs: StairSocketFeature): void => {
  const center = rectCenter(stairs.bounds);
  const alongX = stairs.heading.startsWith('x');
  const positive = stairs.heading.endsWith('+');
  const count = 8;
  const run = 0.38;
  const rise = 0.18;
  for (let index = 0; index < count; index += 1) {
    const height = rise * (index + 1);
    const offset = (index - (count - 1) * 0.5) * run * (positive ? 1 : -1);
    world.colliders.push({
      id: `${stairs.id}-step-${index}`,
      center: {
        x: center.x + (alongX ? offset : 0),
        y: height * 0.5,
        z: center.z + (alongX ? 0 : offset),
      },
      halfExtents: {
        x: (alongX ? run : 2.25) * 0.5,
        y: height * 0.5,
        z: (alongX ? 2.25 : run) * 0.5,
      },
      kind: 'step',
    });
  }
  const endOffset = count * run * 0.5 * (positive ? 1 : -1) + (positive ? 0.66 : -0.66);
  world.colliders.push({
    id: `${stairs.id}-terminal-wall`,
    center: {
      x: center.x + (alongX ? endOffset : 0),
      y: world.wallHeight * 0.5,
      z: center.z + (alongX ? 0 : endOffset),
    },
    halfExtents: {
      x: alongX ? 0.11 : 1.25,
      y: world.wallHeight * 0.5,
      z: alongX ? 1.25 : 0.11,
    },
    kind: 'barrier',
  });
};

export const generateWorld = (seed: string): WorldPlan => {
  const rootRng = new SeededRandom(`${seed}:v${GENERATOR_VERSION}`);
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
    spawn: { x: spawnCenter.x, y: 0.9, z: spawnCenter.z },
  };

  const reservedRoomIds = new Set<string>([spawnRoom.id]);
  const pitRoom = [...world.rooms]
    .filter(
      (room) =>
        room.id !== spawnRoom.id &&
        room.kind !== 'open-hall' &&
        rectWidth(room.bounds) >= 13 &&
        rectDepth(room.bounds) >= 10.5 &&
        Math.hypot(rectCenter(room.bounds).x - world.spawn.x, rectCenter(room.bounds).z - world.spawn.z) > 16,
    )
    .sort((a, b) => rectArea(b.bounds) - rectArea(a.bounds))[0];

  let pit: GridPitFeature | undefined;
  if (pitRoom) {
    pit = buildGridPit(pitRoom, rootRng.fork('feature:grid-pit'), worldBounds);
    pitRoom.kind = 'pit-gallery';
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

  addSqueezeViews(mutable, world, reservedRoomIds, rootRng);
  addColumnsAndPartialWalls(mutable, world, reservedRoomIds, rootRng);
  enforcePortalClearances(mutable);
  world.walls = mutable.walls;
  world.colliders = mutable.colliders;
  addSolidMasses(world, reservedRoomIds, rootRng);
  populateLightsAndDetails(world, rootRng);
  populateVistaLights(world, vista, rootRng);

  const holes = pit?.holes ?? [];
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
