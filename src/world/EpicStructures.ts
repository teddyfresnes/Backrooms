import type {
  EpicPassageLevel,
  EpicPassagePreview,
  EpicPassageSide,
  EpicStructureFeature,
  EpicStructureIndex,
  EpicStructureVariant,
  LightSlot,
  Rect,
  StaticCollider,
  Vec3Data,
  WallSegment,
  WorldPlan,
} from './types';
import { pointInRect, rectCenter, rectDepth, rectWidth } from './types';
import { SeededRandom } from './SeededRandom';

const STORY_PITCH = 5.4;
const EPIC_ABYSS_PREVIEW_STORIES = 17;
const EPIC_ABYSS_UPPER_PREVIEW_STORIES = 4;
/** Epic1 hands off to ordinary office rooms, so its openings use office height. */
export const EPIC1_PORTAL_HEIGHT = 2.66;
const EPIC_PASSAGE_HEIGHT = 3.35;
const EPIC1_VOID_HALF_SPAN = 53.35;
const EPIC1_FACADE_HALF_SPAN = 54.4;
const EPIC1_LEDGE_DEPTH = EPIC1_FACADE_HALF_SPAN - EPIC1_VOID_HALF_SPAN;
// Epic3 deliberately spans the two horizontal neighbours of its owner chunk.
// WorldStream keeps those neighbours unmounted while the player is inside the
// fissure, so its 220 m perspective is real geometry rather than a backdrop.
const EPIC3_HALF_LENGTH = 110.8;
const EPIC3_FACADE_HALF_DEPTH = 6;
const EPIC3_OUTER_HALF_DEPTH = 14.5;
const EPIC3_VOID_HALF_LENGTH = 110.35;
const EPIC3_VOID_HALF_DEPTH = EPIC3_FACADE_HALF_DEPTH;
const EPIC3_PREVIEW_DEPTH = EPIC3_OUTER_HALF_DEPTH - EPIC3_FACADE_HALF_DEPTH;
const EPIC3_LOWER_STORIES = 11;
const EPIC3_GALLERY_LANE_DEPTH = 4.15;
const EPIC4_ROOM_HALF_SPAN = 9.6;
const EPIC4_CORE_HALF_SPAN = 4.8;
const EPIC4_STAIR_OUTER_SPAN = 7;
const EPIC4_FLIGHT_RISE = 2.4;
const EPIC4_SHELL_INSET = 0.24;
const EPIC4_SHELL_THICKNESS = 0.34;
const EPIC4_GROUND_PORTAL_WIDTH = 3.8;
const EPIC4_GROUND_PORTAL_HEIGHT = 3.45;
const EPIC4_UPPER_CORRIDOR_MIN_X = -7.5;
const EPIC4_UPPER_CORRIDOR_MAX_X = -4.3;
const EPIC4_UPPER_CORRIDOR_TURN_X = 6.2;
const EPIC4_UPPER_CORRIDOR_NEAR_Z = -15.2;
const EPIC4_UPPER_CORRIDOR_FAR_Z = -18.4;

export interface EpicCoord {
  readonly x: number;
  readonly z: number;
  readonly story: number;
}

export interface EpicStructureContext {
  readonly worldSeed: string;
  readonly coord: Readonly<EpicCoord>;
}

export interface EpicStructureDefinition {
  readonly index: EpicStructureIndex;
  readonly command: `epic${EpicStructureIndex}`;
  readonly variant: EpicStructureVariant;
  readonly label: string;
  readonly aliases: readonly string[];
  readonly height: number;
}

export const EPIC_STRUCTURE_DEFINITIONS: readonly EpicStructureDefinition[] = [
  {
    index: 1,
    command: 'epic1',
    variant: 'endless-abyss',
    label: 'le gouffre monumental aux corniches superposees',
    aliases: ['epic-1', 'abyss', 'abysse', 'gouffre', 'puits-sans-fond'],
    height: STORY_PITCH,
  },
  {
    index: 2,
    command: 'epic2',
    variant: 'lost-ceiling',
    label: 'la salle aux piliers et au plafond perdu',
    aliases: ['epic-2', 'plafond-infini', 'lost-ceiling', 'salle-infinie'],
    height: 72,
  },
  {
    index: 3,
    command: 'epic3',
    variant: 'ascending-passages',
    label: 'la longue halle aux passages ascendants',
    aliases: ['epic-3', 'passages-hauts', 'ascending-passages', 'mille-passages'],
    height: 64,
  },
  {
    index: 4,
    command: 'epic4',
    variant: 'impossible-stairwell',
    label: 'la tour d escalier autour du noyau',
    aliases: ['epic-4', 'tour-escalier', 'impossible-stairwell', 'cage-escalier'],
    height: 60,
  },
  {
    index: 5,
    command: 'epic5',
    variant: 'vanishing-concourse',
    label: 'la galerie des seuils alignes',
    aliases: ['epic-5', 'galerie-seuils', 'vanishing-concourse', 'concourse'],
    height: STORY_PITCH * 2,
  },
];

const EPIC_DEFINITION_BY_INDEX = new Map(
  EPIC_STRUCTURE_DEFINITIONS.map((definition) => [definition.index, definition] as const),
);

/** Five monuments per 32x32 chunks: 0.488%, with a guaranteed empty halo. */
export const EPIC_MACRO_SIZE = 32;

const EPIC_MACRO_ANCHORS = [
  { x: 4, z: 8 },
  { x: 12, z: 8 },
  { x: 20, z: 8 },
  { x: 28, z: 8 },
  { x: 4, z: 24 },
  { x: 12, z: 24 },
  { x: 20, z: 24 },
  { x: 28, z: 24 },
] as const;

export interface EpicStructureSlot {
  readonly index: EpicStructureIndex;
  readonly x: number;
  readonly z: number;
}

const transformMacroAnchor = (
  anchor: Readonly<{ x: number; z: number }>,
  transform: number,
): { x: number; z: number } => {
  let x = anchor.x - EPIC_MACRO_SIZE * 0.5;
  let z = anchor.z - EPIC_MACRO_SIZE * 0.5;
  if (transform >= 4) x = -x;
  for (let turn = 0; turn < transform % 4; turn += 1) {
    [x, z] = [-z, x];
  }
  return {
    x: Math.round(x + EPIC_MACRO_SIZE * 0.5),
    z: Math.round(z + EPIC_MACRO_SIZE * 0.5),
  };
};

export const getEpicStructureSlotsForMacro = (
  seed: string,
  macroX: number,
  macroZ: number,
): readonly EpicStructureSlot[] => {
  const root = new SeededRandom(`${seed}::epic-layout:v3:${macroX}:${macroZ}`);
  const transform = root.fork('transform').int(0, 7);
  const offsetRng = root.fork('offset');
  const offsetX = offsetRng.int(-2, 2);
  const offsetZ = offsetRng.int(-2, 2);
  const anchors = root.fork('positions').shuffle(EPIC_MACRO_ANCHORS).slice(
    0,
    EPIC_STRUCTURE_DEFINITIONS.length,
  );
  const definitions = root.fork('types').shuffle(EPIC_STRUCTURE_DEFINITIONS);
  return definitions.map((definition, index) => {
    const transformed = transformMacroAnchor(anchors[index]!, transform);
    return Object.freeze({
      index: definition.index,
      x: macroX * EPIC_MACRO_SIZE + transformed.x + offsetX,
      z: macroZ * EPIC_MACRO_SIZE + transformed.z + offsetZ,
    });
  });
};

export const epicStructureIndexForCoord = (
  seed: string,
  coord: Pick<EpicCoord, 'x' | 'z'>,
): EpicStructureIndex | null => {
  const macroX = Math.floor(coord.x / EPIC_MACRO_SIZE);
  const macroZ = Math.floor(coord.z / EPIC_MACRO_SIZE);
  return getEpicStructureSlotsForMacro(seed, macroX, macroZ).find(
    (slot) => slot.x === coord.x && slot.z === coord.z,
  )?.index ?? null;
};

export const getNearestEpicStructureCoord = (
  seed: string,
  index: EpicStructureIndex,
  origin: Readonly<EpicCoord>,
): Readonly<EpicCoord> => {
  const originMacroX = Math.floor(origin.x / EPIC_MACRO_SIZE);
  const originMacroZ = Math.floor(origin.z / EPIC_MACRO_SIZE);
  let best: EpicStructureSlot | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let macroZ = originMacroZ - 2; macroZ <= originMacroZ + 2; macroZ += 1) {
    for (let macroX = originMacroX - 2; macroX <= originMacroX + 2; macroX += 1) {
      const candidate = getEpicStructureSlotsForMacro(seed, macroX, macroZ).find(
        (slot) => slot.index === index,
      )!;
      const distance = (candidate.x - origin.x) ** 2 + (candidate.z - origin.z) ** 2;
      if (
        distance < bestDistance ||
        (
          distance === bestDistance &&
          (!best || candidate.z < best.z || (candidate.z === best.z && candidate.x < best.x))
        )
      ) {
        best = candidate;
        bestDistance = distance;
      }
    }
  }
  if (!best) throw new Error(`Unable to resolve epic${index}.`);
  return Object.freeze({ x: best.x, z: best.z, story: origin.story });
};

export const getEpicStructureDefinition = (
  index: EpicStructureIndex,
): EpicStructureDefinition => {
  const definition = EPIC_DEFINITION_BY_INDEX.get(index);
  if (!definition) throw new Error(`Unknown epic structure index: ${String(index)}.`);
  return definition;
};

const instanceSeed = (
  fallbackSeed: string,
  context?: EpicStructureContext,
): string => context
  ? `${context.worldSeed}::epic-instance:v3:${context.coord.x}:${context.coord.z}`
  : `${fallbackSeed}::epic-instance:v3`;

const createAbyssPassages = (seed: string): EpicPassagePreview[] => {
  const rng = new SeededRandom(seed);
  const lanes = [-43, -28.5, -14, 0, 14, 28.5, 43] as const;
  return (['north', 'south', 'west', 'east'] as const).flatMap((side) => {
    const sideRng = rng.fork(`side-${side}`);
    const count = sideRng.fork('count').int(2, 3);
    const shuffled = sideRng.fork('lanes').shuffle(lanes);
    const selected = side === 'north'
      ? [0, ...shuffled.filter((lane) => lane !== 0)].slice(0, count)
      : shuffled.slice(0, count);
    return selected.map((lane, index) => {
      const passageRng = sideRng.fork(`passage-${index}`);
      return {
        side,
        along: Math.round((lane + passageRng.float(-1.1, 1.1)) * 10) / 10,
        width: Math.round(passageRng.float(3.4, 6.4) * 10) / 10,
        platformDepth: EPIC1_LEDGE_DEPTH,
        corridorDepth: Math.round(passageRng.float(1.12, 1.22) * 100) / 100,
      };
    });
  });
};

export const getEpicAbyssPassagesForStory = (
  worldSeed: string,
  coord: Readonly<EpicCoord>,
): EpicPassagePreview[] => createAbyssPassages(
  `${worldSeed}::epic1-passages:v4:${coord.x}:${coord.z}:${coord.story}`,
);

const createAbyssPassageLevels = (
  planSeed: string,
  context?: EpicStructureContext,
): EpicPassageLevel[] => Array.from(
  { length: EPIC_ABYSS_PREVIEW_STORIES + EPIC_ABYSS_UPPER_PREVIEW_STORIES + 1 },
  (_, index): EpicPassageLevel => {
    const storyOffset = EPIC_ABYSS_UPPER_PREVIEW_STORIES - index;
    const levelSeed = context
      ? `${context.worldSeed}::epic1-passages:v4:${context.coord.x}:${context.coord.z}:${context.coord.story + storyOffset}`
      : `${planSeed}::epic1-passages:v4:${storyOffset}`;
    return {
      y: storyOffset * STORY_PITCH,
      passages: context
        ? getEpicAbyssPassagesForStory(context.worldSeed, {
            ...context.coord,
            story: context.coord.story + storyOffset,
          })
        : createAbyssPassages(levelSeed),
    };
  },
);

interface AscendingLayout {
  readonly bounds: Rect;
  readonly facadeBounds: Rect;
  readonly voidBounds: Rect;
  readonly passageLevels: EpicPassageLevel[];
  readonly entryLevel: number;
  readonly bottomless: boolean;
  readonly destination: Vec3Data;
}

const createAscendingLayout = (seed: string): AscendingLayout => {
  const rng = new SeededRandom(`${seed}::ascending-layout`);
  const bounds: Rect = {
    minX: -EPIC3_HALF_LENGTH,
    minZ: -EPIC3_OUTER_HALF_DEPTH,
    maxX: EPIC3_HALF_LENGTH,
    maxZ: EPIC3_OUTER_HALF_DEPTH,
  };
  const facadeBounds: Rect = {
    minX: -EPIC3_HALF_LENGTH,
    minZ: -EPIC3_FACADE_HALF_DEPTH,
    maxX: EPIC3_HALF_LENGTH,
    maxZ: EPIC3_FACADE_HALF_DEPTH,
  };
  const voidBounds: Rect = {
    minX: -EPIC3_VOID_HALF_LENGTH,
    minZ: -EPIC3_VOID_HALF_DEPTH,
    maxX: EPIC3_VOID_HALF_LENGTH,
    maxZ: EPIC3_VOID_HALF_DEPTH,
  };
  const entryLevel = rng.fork('entry-level').int(4, 7);
  const rowCount = Math.floor((64 - 3.8) / STORY_PITCH);
  const laneRng = rng.fork('symmetric-passage-template');
  const lanes = Array.from({ length: 17 }, (_, index) => (index - 8) * 12.5);
  const passageTemplate = lanes.flatMap((along, laneIndex): EpicPassagePreview[] => {
    const width = along === 0
      ? 5.8
      : laneRng.fork(`lane-${laneIndex}`).float(4.1, 5.5);
    const common = {
      along,
      width,
      platformDepth: 0,
      corridorDepth: EPIC3_PREVIEW_DEPTH,
    } as const;
    return [
      { ...common, side: 'north' },
      { ...common, side: 'south' },
    ];
  });
  const passageLevels: EpicPassageLevel[] = [];
  for (let level = -EPIC3_LOWER_STORIES; level <= rowCount; level += 1) {
    passageLevels.push({
      y: level * STORY_PITCH,
      passages: passageTemplate.map((passage) => ({ ...passage })),
    });
  }
  return {
    bounds,
    facadeBounds,
    voidBounds,
    passageLevels,
    entryLevel,
    bottomless: true,
    destination: {
      x: 0,
      y: entryLevel * STORY_PITCH + 0.865,
      z: -(EPIC3_FACADE_HALF_DEPTH + 2.2),
    },
  };
};

export const getEpicVoidBounds = (
  index: EpicStructureIndex,
  layoutSeed?: string,
): Rect | undefined => {
  if (index === 1) return {
    minX: -EPIC1_VOID_HALF_SPAN,
    minZ: -EPIC1_VOID_HALF_SPAN,
    maxX: EPIC1_VOID_HALF_SPAN,
    maxZ: EPIC1_VOID_HALF_SPAN,
  };
  if (index === 3 && layoutSeed) return createAscendingLayout(layoutSeed).voidBounds;
  return undefined;
};

export const getEpicLocateDestination = (
  worldSeed: string,
  coord: Readonly<EpicCoord>,
  index: EpicStructureIndex,
): Vec3Data => {
  if (index === 3) {
    return createAscendingLayout(instanceSeed('', { worldSeed, coord })).destination;
  }
  if (index === 1) {
    return { x: 0, y: 0.865, z: -(EPIC1_VOID_HALF_SPAN + EPIC1_FACADE_HALF_SPAN) * 0.5 };
  }
  if (index === 4) return { x: -7.55, y: 0.865, z: -7.55 };
  return { x: 0, y: 0.865, z: -45 };
};

export const getEpicStructureVoidBounds = (
  worldSeed: string,
  coord: Readonly<EpicCoord>,
  index: EpicStructureIndex,
): Rect | undefined => getEpicVoidBounds(
  index,
  instanceSeed('', { worldSeed, coord }),
);

export const getEpicAbyssBottom = (feature: EpicStructureFeature): number =>
  -Math.max(EPIC_ABYSS_PREVIEW_STORIES * STORY_PITCH, feature.height + 18);

export const isInsideEpicAbyssFall = (
  feature: EpicStructureFeature,
  position: { x: number; y: number; z: number },
): boolean =>
  feature.variant === 'endless-abyss' &&
  feature.voidBounds !== undefined &&
  position.y < 0.08 &&
  position.y > getEpicAbyssBottom(feature) &&
  pointInRect(position.x, position.z, feature.voidBounds, 0.08);

export const isInsideEpicStoryVolume = (
  feature: EpicStructureFeature,
  position: { x: number; y: number; z: number },
): boolean => {
  // epic1 deliberately hands off to the next logical story like an ordinary pit.
  if (feature.variant === 'endless-abyss') return false;
  if (
    feature.variant === 'ascending-passages' &&
    feature.bottomless &&
    feature.voidBounds &&
    position.y < 0.08 &&
    position.y > -(EPIC3_LOWER_STORIES + 1) * STORY_PITCH &&
    pointInRect(position.x, position.z, feature.voidBounds, 0.08)
  ) return true;
  const insideHorizontalVolume = pointInRect(position.x, position.z, feature.bounds, 0.4);
  return position.y >= 0.08 &&
    position.y < feature.height - 0.08 &&
    insideHorizontalVolume;
};

export interface EpicObstacle {
  readonly id: string;
  readonly bounds: Rect;
  readonly bottom: number;
  readonly height: number;
  readonly tint: number;
}

const obstacle = (
  id: string,
  x: number,
  z: number,
  width: number,
  depth: number,
  height: number,
  tint = 0.92,
  bottom = 0,
): EpicObstacle => ({
  id,
  bounds: {
    minX: x - width * 0.5,
    maxX: x + width * 0.5,
    minZ: z - depth * 0.5,
    maxZ: z + depth * 0.5,
  },
  bottom,
  height,
  tint,
});

/** Ground-touching masses shared by rendering and physics. */
export const getEpicGroundObstacles = (
  feature: EpicStructureFeature,
): EpicObstacle[] => {
  const obstacles: EpicObstacle[] = [];
  if (feature.variant === 'lost-ceiling') {
    for (const x of [-45, -33, -21, -9, 9, 21, 33, 45]) {
      for (const z of [-38, -25, -12, 1, 14, 27, 40]) {
        if (Math.abs(x) < 12 && z < -30) continue;
        obstacles.push(obstacle(
          `lost-ceiling-pillar-${x}-${z}`,
          x,
          z,
          2.6,
          2.6,
          feature.height,
          0.88 + ((Math.abs(x + z) / 10) % 3) * 0.025,
        ));
      }
    }
  } else if (feature.variant === 'impossible-stairwell') {
    const coreSize = EPIC4_CORE_HALF_SPAN * 2;
    obstacles.push(obstacle('stairwell-core', 0, 0, coreSize, coreSize, feature.height, 0.82));
  }
  return obstacles;
};

const floorCellsAroundVoid = (bounds: Rect, opening: Rect): Rect[] => [
  { minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.minZ, maxZ: opening.minZ },
  { minX: bounds.minX, maxX: bounds.maxX, minZ: opening.maxZ, maxZ: bounds.maxZ },
  { minX: bounds.minX, maxX: opening.minX, minZ: opening.minZ, maxZ: opening.maxZ },
  { minX: opening.maxX, maxX: bounds.maxX, minZ: opening.minZ, maxZ: opening.maxZ },
].filter((rect) => rectWidth(rect) > 0.1 && rectDepth(rect) > 0.1);

export const epicPassagePlatformRect = (
  passage: EpicPassagePreview,
  facade: Rect,
): Rect => {
  const halfWidth = passage.width * 0.5;
  if (passage.side === 'north') {
    return {
      minX: passage.along - halfWidth,
      maxX: passage.along + halfWidth,
      minZ: facade.minZ,
      maxZ: facade.minZ + passage.platformDepth,
    };
  }
  if (passage.side === 'south') {
    return {
      minX: passage.along - halfWidth,
      maxX: passage.along + halfWidth,
      minZ: facade.maxZ - passage.platformDepth,
      maxZ: facade.maxZ,
    };
  }
  if (passage.side === 'west') {
    return {
      minX: facade.minX,
      maxX: facade.minX + passage.platformDepth,
      minZ: passage.along - halfWidth,
      maxZ: passage.along + halfWidth,
    };
  }
  return {
    minX: facade.maxX - passage.platformDepth,
    maxX: facade.maxX,
    minZ: passage.along - halfWidth,
    maxZ: passage.along + halfWidth,
  };
};

const floorCollider = (rect: Rect, id: string, top = 0): StaticCollider => {
  const center = rectCenter(rect);
  return {
    id,
    center: { x: center.x, y: top - 0.12, z: center.z },
    halfExtents: { x: rectWidth(rect) * 0.5, y: 0.12, z: rectDepth(rect) * 0.5 },
    kind: 'floor',
  };
};

const rectsOverlap = (left: Rect, right: Rect, padding = 0): boolean =>
  left.minX < right.maxX + padding &&
  left.maxX > right.minX - padding &&
  left.minZ < right.maxZ + padding &&
  left.maxZ > right.minZ - padding;

const wallFootprint = (wall: WallSegment): Rect => wall.orientation === 'x'
  ? {
      minX: wall.x - wall.length * 0.5,
      maxX: wall.x + wall.length * 0.5,
      minZ: wall.z - wall.thickness * 0.5,
      maxZ: wall.z + wall.thickness * 0.5,
    }
  : {
      minX: wall.x - wall.thickness * 0.5,
      maxX: wall.x + wall.thickness * 0.5,
      minZ: wall.z - wall.length * 0.5,
      maxZ: wall.z + wall.length * 0.5,
    };

const colliderFootprint = (collider: StaticCollider): Rect => ({
  minX: collider.center.x - collider.halfExtents.x,
  maxX: collider.center.x + collider.halfExtents.x,
  minZ: collider.center.z - collider.halfExtents.z,
  maxZ: collider.center.z + collider.halfExtents.z,
});

const expandRect = (rect: Rect, amount: number): Rect => ({
  minX: rect.minX - amount,
  maxX: rect.maxX + amount,
  minZ: rect.minZ - amount,
  maxZ: rect.maxZ + amount,
});

export interface EpicStairFlight {
  readonly id: string;
  readonly bounds: Rect;
  readonly axis: 'x' | 'z';
  readonly riseDirection: 1 | -1;
  readonly outerEdge: -1 | 1;
  readonly bottom: number;
  readonly rise: number;
}

export interface EpicStairLanding {
  readonly id: string;
  readonly bounds: Rect;
  readonly top: number;
}

export interface EpicStairwellLayout {
  readonly coreBounds: Rect;
  readonly flights: readonly EpicStairFlight[];
  readonly landings: readonly EpicStairLanding[];
  readonly summitRects: readonly Rect[];
  /** Aperture left above the final flight instead of covering it with the summit slab. */
  readonly summitOpening: Rect;
  /** Small L-shaped continuation beyond the upper doorway. */
  readonly upperFloorRects: readonly Rect[];
  readonly upperWalls: readonly WallSegment[];
  readonly upperCeilingY: number;
  readonly summitY: number;
}

/** One square helix used by both the mesh builder and Rapier colliders. */
export const getEpicStairwellLayout = (
  feature: Pick<EpicStructureFeature, 'height'>,
): EpicStairwellLayout => {
  const inner = EPIC4_CORE_HALF_SPAN;
  const outer = EPIC4_STAIR_OUTER_SPAN;
  const flightCount = Math.max(4, Math.floor((feature.height - EPIC4_FLIGHT_RISE) / EPIC4_FLIGHT_RISE));
  const flights: EpicStairFlight[] = [];
  const landings: EpicStairLanding[] = [];
  for (let index = 0; index < flightCount; index += 1) {
    const side = index % 4;
    const bottom = index * EPIC4_FLIGHT_RISE;
    const common = {
      id: `epic4-stair-flight-${index}`,
      bottom,
      rise: EPIC4_FLIGHT_RISE,
    } as const;
    const flight: EpicStairFlight = side === 0
      ? { ...common, bounds: { minX: -inner, maxX: inner, minZ: -outer, maxZ: -inner }, axis: 'x', riseDirection: 1, outerEdge: -1 }
      : side === 1
        ? { ...common, bounds: { minX: inner, maxX: outer, minZ: -inner, maxZ: inner }, axis: 'z', riseDirection: 1, outerEdge: 1 }
        : side === 2
          ? { ...common, bounds: { minX: -inner, maxX: inner, minZ: inner, maxZ: outer }, axis: 'x', riseDirection: -1, outerEdge: 1 }
          : { ...common, bounds: { minX: -outer, maxX: -inner, minZ: -inner, maxZ: inner }, axis: 'z', riseDirection: -1, outerEdge: -1 };
    flights.push(flight);
    if (index < flightCount - 1) {
      const bounds: Rect = side === 0
        ? { minX: inner, maxX: outer, minZ: -outer, maxZ: -inner }
        : side === 1
          ? { minX: inner, maxX: outer, minZ: inner, maxZ: outer }
          : side === 2
            ? { minX: -outer, maxX: -inner, minZ: inner, maxZ: outer }
            : { minX: -outer, maxX: -inner, minZ: -outer, maxZ: -inner };
      landings.push({ id: `epic4-stair-landing-${index}`, bounds, top: bottom + EPIC4_FLIGHT_RISE });
    }
  }
  const summitY = flightCount * EPIC4_FLIGHT_RISE;
  const upperFloorRects: Rect[] = [
    {
      minX: EPIC4_UPPER_CORRIDOR_MIN_X,
      maxX: EPIC4_UPPER_CORRIDOR_MAX_X,
      minZ: EPIC4_UPPER_CORRIDOR_NEAR_Z,
      maxZ: -outer,
    },
    {
      minX: EPIC4_UPPER_CORRIDOR_MIN_X,
      maxX: EPIC4_UPPER_CORRIDOR_TURN_X,
      minZ: EPIC4_UPPER_CORRIDOR_FAR_Z,
      maxZ: EPIC4_UPPER_CORRIDOR_NEAR_Z,
    },
  ];
  const upperWallHeight = Math.max(2.15, feature.height - summitY);
  const upperWall = (
    id: string,
    orientation: 'x' | 'z',
    x: number,
    z: number,
    length: number,
  ): WallSegment => ({
    id,
    x,
    z,
    length,
    orientation,
    bottom: summitY,
    height: upperWallHeight,
    thickness: 0.24,
    tint: 0.88,
    collision: true,
    kind: 'wallpaper',
  });
  return {
    coreBounds: { minX: -inner, maxX: inner, minZ: -inner, maxZ: inner },
    flights,
    landings,
    summitY,
    summitOpening: { minX: -outer, maxX: -inner, minZ: -inner, maxZ: inner },
    summitRects: [
      { minX: -outer, maxX: outer, minZ: -outer, maxZ: -inner },
      { minX: -outer, maxX: outer, minZ: inner, maxZ: outer },
      { minX: inner, maxX: outer, minZ: -inner, maxZ: inner },
    ],
    upperFloorRects,
    upperWalls: [
      upperWall(
        'epic4-upper-maze-stem-west',
        'z',
        EPIC4_UPPER_CORRIDOR_MIN_X,
        (EPIC4_UPPER_CORRIDOR_NEAR_Z - EPIC4_ROOM_HALF_SPAN) * 0.5,
        -EPIC4_ROOM_HALF_SPAN - EPIC4_UPPER_CORRIDOR_NEAR_Z,
      ),
      upperWall(
        'epic4-upper-maze-stem-east',
        'z',
        EPIC4_UPPER_CORRIDOR_MAX_X,
        (EPIC4_UPPER_CORRIDOR_NEAR_Z - EPIC4_ROOM_HALF_SPAN) * 0.5,
        -EPIC4_ROOM_HALF_SPAN - EPIC4_UPPER_CORRIDOR_NEAR_Z,
      ),
      upperWall(
        'epic4-upper-maze-north',
        'x',
        (EPIC4_UPPER_CORRIDOR_MIN_X + EPIC4_UPPER_CORRIDOR_TURN_X) * 0.5,
        EPIC4_UPPER_CORRIDOR_FAR_Z,
        EPIC4_UPPER_CORRIDOR_TURN_X - EPIC4_UPPER_CORRIDOR_MIN_X,
      ),
      upperWall(
        'epic4-upper-maze-south',
        'x',
        (EPIC4_UPPER_CORRIDOR_MAX_X + EPIC4_UPPER_CORRIDOR_TURN_X) * 0.5,
        EPIC4_UPPER_CORRIDOR_NEAR_Z,
        EPIC4_UPPER_CORRIDOR_TURN_X - EPIC4_UPPER_CORRIDOR_MAX_X,
      ),
      upperWall(
        'epic4-upper-maze-east',
        'z',
        EPIC4_UPPER_CORRIDOR_TURN_X,
        (EPIC4_UPPER_CORRIDOR_FAR_Z + EPIC4_UPPER_CORRIDOR_NEAR_Z) * 0.5,
        EPIC4_UPPER_CORRIDOR_NEAR_Z - EPIC4_UPPER_CORRIDOR_FAR_Z,
      ),
      upperWall(
        'epic4-upper-maze-west',
        'z',
        EPIC4_UPPER_CORRIDOR_MIN_X,
        (EPIC4_UPPER_CORRIDOR_FAR_Z + EPIC4_UPPER_CORRIDOR_NEAR_Z) * 0.5,
        EPIC4_UPPER_CORRIDOR_NEAR_Z - EPIC4_UPPER_CORRIDOR_FAR_Z,
      ),
    ],
    upperCeilingY: feature.height,
  };
};

const slopedFloorCollider = (flight: EpicStairFlight): StaticCollider => {
  const run = flight.axis === 'x' ? rectWidth(flight.bounds) : rectDepth(flight.bounds);
  const cross = flight.axis === 'x' ? rectDepth(flight.bounds) : rectWidth(flight.bounds);
  const signedAngle = Math.atan2(flight.rise, run) * flight.riseDirection;
  const center = rectCenter(flight.bounds);
  const halfThickness = 0.09;
  const halfAngle = signedAngle * 0.5;
  return {
    id: flight.id,
    center: {
      x: center.x,
      y: flight.bottom + flight.rise * 0.5 - Math.cos(signedAngle) * halfThickness,
      z: center.z,
    },
    halfExtents: flight.axis === 'x'
      ? { x: Math.hypot(run, flight.rise) * 0.5, y: halfThickness, z: cross * 0.5 }
      : { x: cross * 0.5, y: halfThickness, z: Math.hypot(run, flight.rise) * 0.5 },
    kind: 'floor',
    rotation: flight.axis === 'x'
      ? { x: 0, y: 0, z: Math.sin(halfAngle), w: Math.cos(halfAngle) }
      : { x: Math.sin(-halfAngle), y: 0, z: 0, w: Math.cos(halfAngle) },
  };
};

const stairOuterBarrierCollider = (flight: EpicStairFlight): StaticCollider => {
  const center = rectCenter(flight.bounds);
  const thickness = 0.12;
  const height = flight.rise + 1.12;
  const cross = flight.axis === 'x'
    ? (flight.outerEdge < 0 ? flight.bounds.minZ : flight.bounds.maxZ)
    : (flight.outerEdge < 0 ? flight.bounds.minX : flight.bounds.maxX);
  return {
    id: `${flight.id}-outer-guard`,
    center: {
      x: flight.axis === 'x' ? center.x : cross,
      y: flight.bottom + height * 0.5,
      z: flight.axis === 'x' ? cross : center.z,
    },
    halfExtents: flight.axis === 'x'
      ? { x: rectWidth(flight.bounds) * 0.5, y: height * 0.5, z: thickness * 0.5 }
      : { x: thickness * 0.5, y: height * 0.5, z: rectDepth(flight.bounds) * 0.5 },
    kind: 'barrier',
  };
};

const edgeBarrierCollider = (
  id: string,
  orientation: 'x' | 'z',
  alongCenter: number,
  fixed: number,
  length: number,
  bottom: number,
): StaticCollider => ({
  id,
  center: orientation === 'x'
    ? { x: alongCenter, y: bottom + 0.56, z: fixed }
    : { x: fixed, y: bottom + 0.56, z: alongCenter },
  halfExtents: orientation === 'x'
    ? { x: length * 0.5, y: 0.56, z: 0.06 }
    : { x: 0.06, y: 0.56, z: length * 0.5 },
  kind: 'barrier',
});

const stairLandingBarrierColliders = (landing: EpicStairLanding): StaticCollider[] => {
  const center = rectCenter(landing.bounds);
  const outerX = center.x < 0 ? landing.bounds.minX : landing.bounds.maxX;
  const outerZ = center.z < 0 ? landing.bounds.minZ : landing.bounds.maxZ;
  return [
    edgeBarrierCollider(`${landing.id}-outer-x`, 'x', center.x, outerZ, rectWidth(landing.bounds), landing.top),
    edgeBarrierCollider(`${landing.id}-outer-z`, 'z', center.z, outerX, rectDepth(landing.bounds), landing.top),
  ];
};

interface Epic4FacadeOpening {
  readonly alongMin: number;
  readonly alongMax: number;
  readonly bottom: number;
  readonly top: number;
}

/**
 * Shared textured shell for epic4. Each ground face has a real doorway, while
 * the north face also opens onto the small maze reached at the summit.
 */
export const getEpicStairRoomWalls = (
  feature: Pick<EpicStructureFeature, 'id' | 'bounds' | 'height'>,
): WallSegment[] => {
  const layout = getEpicStairwellLayout(feature);
  const walls: WallSegment[] = [];
  for (const side of ['north', 'south', 'west', 'east'] as const) {
    const horizontal = side === 'north' || side === 'south';
    const alongMin = horizontal ? feature.bounds.minX : feature.bounds.minZ;
    const alongMax = horizontal ? feature.bounds.maxX : feature.bounds.maxZ;
    const openings: Epic4FacadeOpening[] = [{
      alongMin: -EPIC4_GROUND_PORTAL_WIDTH * 0.5,
      alongMax: EPIC4_GROUND_PORTAL_WIDTH * 0.5,
      bottom: 0,
      top: EPIC4_GROUND_PORTAL_HEIGHT,
    }];
    if (side === 'north') {
      openings.push({
        alongMin: EPIC4_UPPER_CORRIDOR_MIN_X,
        alongMax: EPIC4_UPPER_CORRIDOR_MAX_X,
        bottom: layout.summitY,
        top: feature.height,
      });
    }
    const alongCuts = [...new Set([
      alongMin,
      alongMax,
      ...openings.flatMap((opening) => [opening.alongMin, opening.alongMax]),
    ])].sort((left, right) => left - right);
    const verticalCuts = [...new Set([
      0,
      feature.height,
      ...openings.flatMap((opening) => [opening.bottom, opening.top]),
    ])].sort((left, right) => left - right);
    let pieceIndex = 0;
    for (let alongIndex = 0; alongIndex < alongCuts.length - 1; alongIndex += 1) {
      const pieceMin = alongCuts[alongIndex]!;
      const pieceMax = alongCuts[alongIndex + 1]!;
      for (let verticalIndex = 0; verticalIndex < verticalCuts.length - 1; verticalIndex += 1) {
        const bottom = verticalCuts[verticalIndex]!;
        const top = verticalCuts[verticalIndex + 1]!;
        if (pieceMax - pieceMin < 0.05 || top - bottom < 0.05) continue;
        const alongCenter = (pieceMin + pieceMax) * 0.5;
        const verticalCenter = (bottom + top) * 0.5;
        if (openings.some((opening) =>
          alongCenter > opening.alongMin &&
          alongCenter < opening.alongMax &&
          verticalCenter > opening.bottom &&
          verticalCenter < opening.top
        )) continue;
        const fixed = side === 'north'
          ? feature.bounds.minZ + EPIC4_SHELL_INSET
          : side === 'south'
            ? feature.bounds.maxZ - EPIC4_SHELL_INSET
            : side === 'west'
              ? feature.bounds.minX + EPIC4_SHELL_INSET
              : feature.bounds.maxX - EPIC4_SHELL_INSET;
        walls.push({
          id: `${feature.id}-room-${side}-${pieceIndex}`,
          x: horizontal ? alongCenter : fixed,
          z: horizontal ? fixed : alongCenter,
          length: pieceMax - pieceMin,
          orientation: horizontal ? 'x' : 'z',
          bottom,
          height: top - bottom,
          thickness: EPIC4_SHELL_THICKNESS,
          tint: side === 'south' || side === 'east' ? 0.92 : 0.9,
          collision: true,
          kind: 'wallpaper',
        });
        pieceIndex += 1;
      }
    }
  }
  return walls;
};

const obstacleCollider = (entry: EpicObstacle): StaticCollider => {
  const center = rectCenter(entry.bounds);
  return {
    id: `epic-obstacle-${entry.id}`,
    center: { x: center.x, y: entry.bottom + entry.height * 0.5, z: center.z },
    halfExtents: {
      x: rectWidth(entry.bounds) * 0.5,
      y: entry.height * 0.5,
      z: rectDepth(entry.bounds) * 0.5,
    },
    kind: 'column',
  };
};

const subtractPortalIntervals = (
  min: number,
  max: number,
  passages: readonly EpicPassagePreview[],
): Array<{ min: number; max: number }> => {
  let intervals = [{ min, max }];
  for (const passage of passages) {
    const openingMin = passage.along - passage.width * 0.5;
    const openingMax = passage.along + passage.width * 0.5;
    intervals = intervals.flatMap((interval) => {
      if (openingMax <= interval.min || openingMin >= interval.max) return [interval];
      const result: Array<{ min: number; max: number }> = [];
      if (openingMin - interval.min > 0.08) result.push({ min: interval.min, max: openingMin });
      if (interval.max - openingMax > 0.08) result.push({ min: openingMax, max: interval.max });
      return result;
    });
  }
  return intervals;
};

export const getEpicConcourseWalls = (
  feature: Pick<EpicStructureFeature, 'bounds' | 'height' | 'roomId'>,
): WallSegment[] => {
  const portalHeight = 3.65;
  // Meet the enclosing shell instead of stopping in the middle of the hall.
  // The small inset matches WorldBuilder's shell seam and avoids coplanar end
  // caps flickering through the outer wallpaper.
  const lineMin = feature.bounds.minZ + 0.24;
  const lineMax = feature.bounds.maxZ - 0.24;
  const openings = [
    { along: -28, width: 9 },
    { along: 0, width: 12 },
    { along: 28, width: 9 },
  ];
  const openingPassages: EpicPassagePreview[] = openings.map((opening) => ({
    side: 'west',
    along: opening.along,
    width: opening.width,
    platformDepth: 0,
    corridorDepth: 0,
  }));
  const walls: WallSegment[] = [];
  for (const [lineIndex, x] of [-33, -11, 11, 33].entries()) {
    const tint = 0.86 + (lineIndex % 2) * 0.045;
    for (const [pieceIndex, interval] of subtractPortalIntervals(lineMin, lineMax, openingPassages).entries()) {
      walls.push({
        id: `epic5-concourse-line-${lineIndex}-pier-${pieceIndex}`,
        roomId: feature.roomId,
        x,
        z: (interval.min + interval.max) * 0.5,
        length: interval.max - interval.min,
        orientation: 'z',
        bottom: 0,
        height: feature.height,
        thickness: 0.42,
        tint,
        collision: true,
        kind: 'wallpaper',
      });
    }
    for (const [openingIndex, opening] of openings.entries()) {
      walls.push({
        id: `epic5-concourse-line-${lineIndex}-lintel-${openingIndex}`,
        roomId: feature.roomId,
        x,
        z: opening.along,
        length: opening.width,
        orientation: 'z',
        bottom: portalHeight,
        height: feature.height - portalHeight,
        thickness: 0.42,
        tint: Math.min(1, tint + 0.025),
        collision: true,
        kind: 'wallpaper',
      });
    }
  }
  return walls;
};

const epicWallCollider = (wall: WallSegment): StaticCollider => ({
  id: `collider-${wall.id}`,
  center: {
    x: wall.x,
    y: wall.bottom + wall.height * 0.5,
    z: wall.z,
  },
  halfExtents: wall.orientation === 'x'
    ? { x: wall.length * 0.5, y: wall.height * 0.5, z: wall.thickness * 0.5 }
    : { x: wall.thickness * 0.5, y: wall.height * 0.5, z: wall.length * 0.5 },
  kind: 'wall',
});

const facadeWallColliders = (
  bounds: Rect,
  passages: readonly EpicPassagePreview[],
  bottom: number,
  height: number,
  idPrefix: string,
): StaticCollider[] => {
  const result: StaticCollider[] = [];
  const thickness = 0.16;
  for (const side of ['north', 'south', 'west', 'east'] as const) {
    const sidePassages = passages.filter((passage) => passage.side === side);
    const horizontal = side === 'north' || side === 'south';
    const min = horizontal ? bounds.minX : bounds.minZ;
    const max = horizontal ? bounds.maxX : bounds.maxZ;
    for (const [index, interval] of subtractPortalIntervals(min, max, sidePassages).entries()) {
      const along = (interval.min + interval.max) * 0.5;
      const length = interval.max - interval.min;
      result.push({
        id: `${idPrefix}-${side}-${index}`,
        center: {
          x: horizontal ? along : side === 'west' ? bounds.minX : bounds.maxX,
          y: bottom + height * 0.5,
          z: horizontal ? side === 'north' ? bounds.minZ : bounds.maxZ : along,
        },
        halfExtents: {
          x: horizontal ? length * 0.5 : thickness,
          y: height * 0.5,
          z: horizontal ? thickness : length * 0.5,
        },
        kind: 'wall',
      });
    }
  }
  return result;
};

export interface EpicAbyssPassageLayout {
  readonly floorRects: readonly Rect[];
  readonly ceilingRects: readonly Rect[];
  readonly wallRects: readonly Rect[];
  readonly turnDirection: -1 | 1;
}

/**
 * A shallow L-shaped corridor that fits inside epic1's outer rim. Rectangles
 * only meet at their edges: none overlap the facade or one another, avoiding
 * z-fighting while keeping rendering and physics on the same layout.
 */
export const getEpicAbyssPassageLayout = (
  passage: EpicPassagePreview,
  facade: Rect,
): EpicAbyssPassageLayout => {
  const horizontal = passage.side === 'north' || passage.side === 'south';
  const outward = passage.side === 'north' || passage.side === 'west' ? -1 : 1;
  const fixed = passage.side === 'north'
    ? facade.minZ
    : passage.side === 'south'
      ? facade.maxZ
      : passage.side === 'west'
        ? facade.minX
        : facade.maxX;
  const halfWidth = passage.width * 0.5;
  const wallThickness = 0.16;
  const facadeHalfThickness = 0.18;
  const depth = Math.max(1.15, passage.corridorDepth);
  const turnDirection: -1 | 1 = passage.along > 1
    ? -1
    : passage.along < -1
      ? 1
      : passage.side === 'north' || passage.side === 'east' ? 1 : -1;
  const branchLength = Math.min(3.6, Math.max(2.2, passage.width * 0.62));
  const turnOpening = Math.min(passage.width * 0.42, Math.max(1.35, passage.width * 0.34));

  const rectFromLocal = (
    alongMin: number,
    alongMax: number,
    depthMin: number,
    depthMax: number,
  ): Rect => {
    const fixedA = fixed + outward * depthMin;
    const fixedB = fixed + outward * depthMax;
    return horizontal
      ? {
          minX: passage.along + alongMin,
          maxX: passage.along + alongMax,
          minZ: Math.min(fixedA, fixedB),
          maxZ: Math.max(fixedA, fixedB),
        }
      : {
          minX: Math.min(fixedA, fixedB),
          maxX: Math.max(fixedA, fixedB),
          minZ: passage.along + alongMin,
          maxZ: passage.along + alongMax,
        };
  };

  const turnEdge = turnDirection * halfWidth;
  const branchEnd = turnEdge + turnDirection * branchLength;
  const branchMin = Math.min(turnEdge, branchEnd);
  const branchMax = Math.max(turnEdge, branchEnd);
  const returnMin = turnDirection > 0 ? -halfWidth : -halfWidth + turnOpening;
  const returnMax = turnDirection > 0 ? halfWidth - turnOpening : halfWidth;
  const sideWalls = ([-turnDirection] as Array<-1 | 1>).map((edge) => {
    const sideMin = edge < 0 ? -halfWidth : halfWidth - wallThickness;
    const sideMax = edge < 0 ? -halfWidth + wallThickness : halfWidth;
    return rectFromLocal(
      sideMin,
      sideMax,
      facadeHalfThickness,
      depth - wallThickness,
    );
  });
  const farCapMin = turnDirection > 0 ? branchMax - wallThickness : branchMin;
  const farCapMax = turnDirection > 0 ? branchMax : branchMin + wallThickness;
  const branchOuterMin = turnDirection > 0 ? branchMin : branchMin + wallThickness;
  const branchOuterMax = turnDirection > 0 ? branchMax - wallThickness : branchMax;

  return {
    floorRects: [
      rectFromLocal(-halfWidth, halfWidth, 0, depth),
      rectFromLocal(branchMin, branchMax, facadeHalfThickness, depth),
    ],
    ceilingRects: [
      rectFromLocal(-halfWidth, halfWidth, facadeHalfThickness, depth),
      rectFromLocal(branchMin, branchMax, facadeHalfThickness, depth),
    ],
    wallRects: [
      ...sideWalls,
      rectFromLocal(returnMin, returnMax, depth - wallThickness, depth),
      rectFromLocal(branchOuterMin, branchOuterMax, depth - wallThickness, depth),
      rectFromLocal(farCapMin, farCapMax, facadeHalfThickness, depth),
      // Distant stories are never mounted as navigable geometry. A second
      // recessed return closes the straight sightline through the turn without
      // sharing a plane with the actual L-shaped walls.
      rectFromLocal(-halfWidth, halfWidth, depth + 0.04, depth + 0.18),
    ],
    turnDirection,
  };
};

/**
 * A deeper but still bounded room hint for the few epic1 entrances that are
 * close enough to the arrival ledge to be inspected. It may extend beyond the
 * owner chunk horizontally because only its vertical preview story is drawn.
 */
export const getEpicAbyssRoomPreviewLayout = (
  passage: EpicPassagePreview,
  facade: Rect,
): EpicAbyssPassageLayout => {
  const horizontal = passage.side === 'north' || passage.side === 'south';
  const outward = passage.side === 'north' || passage.side === 'west' ? -1 : 1;
  const fixed = passage.side === 'north'
    ? facade.minZ
    : passage.side === 'south'
      ? facade.maxZ
      : passage.side === 'west'
        ? facade.minX
        : facade.maxX;
  const halfWidth = passage.width * 0.5;
  const wallThickness = 0.16;
  const corridorDepth = 2.55;
  const roomDepth = 7.4;
  const turnDirection: -1 | 1 = passage.along > 1
    ? -1
    : passage.along < -1
      ? 1
      : passage.side === 'north' || passage.side === 'east' ? 1 : -1;
  const roomShift = turnDirection * 0.85;
  const roomHalfWidth = Math.max(3.7, halfWidth + 1.25);
  const roomMin = roomShift - roomHalfWidth;
  const roomMax = roomShift + roomHalfWidth;
  const rectFromLocal = (
    alongMin: number,
    alongMax: number,
    depthMin: number,
    depthMax: number,
  ): Rect => {
    const fixedA = fixed + outward * depthMin;
    const fixedB = fixed + outward * depthMax;
    return horizontal
      ? {
          minX: passage.along + alongMin,
          maxX: passage.along + alongMax,
          minZ: Math.min(fixedA, fixedB),
          maxZ: Math.max(fixedA, fixedB),
        }
      : {
          minX: Math.min(fixedA, fixedB),
          maxX: Math.max(fixedA, fixedB),
          minZ: passage.along + alongMin,
          maxZ: passage.along + alongMax,
        };
  };
  const dividerStart = turnDirection > 0 ? roomMin + 0.7 : roomShift + 0.35;
  const dividerEnd = turnDirection > 0 ? roomShift - 0.35 : roomMax - 0.7;
  return {
    floorRects: [
      rectFromLocal(-halfWidth, halfWidth, 0, corridorDepth),
      rectFromLocal(roomMin, roomMax, corridorDepth, roomDepth),
    ],
    ceilingRects: [
      rectFromLocal(-halfWidth, halfWidth, 0.18, corridorDepth),
      rectFromLocal(roomMin, roomMax, corridorDepth, roomDepth),
    ],
    wallRects: [
      rectFromLocal(-halfWidth, -halfWidth + wallThickness, 0.18, corridorDepth),
      rectFromLocal(halfWidth - wallThickness, halfWidth, 0.18, corridorDepth),
      rectFromLocal(roomMin, roomMin + wallThickness, corridorDepth, roomDepth),
      rectFromLocal(roomMax - wallThickness, roomMax, corridorDepth, roomDepth),
      rectFromLocal(roomMin + wallThickness, roomMax - wallThickness, roomDepth - wallThickness, roomDepth),
      rectFromLocal(dividerStart, dividerEnd, 4.55, 4.71),
    ],
    turnDirection,
  };
};

/** Real, open corridor used only by the active epic1 story. */
export const getEpicAbyssThroughPassageLayout = (
  passage: EpicPassagePreview,
  facade: Rect,
  outerBounds: Rect,
): EpicAbyssPassageLayout => {
  const horizontal = passage.side === 'north' || passage.side === 'south';
  const outward = passage.side === 'north' || passage.side === 'west' ? -1 : 1;
  const fixed = passage.side === 'north'
    ? facade.minZ
    : passage.side === 'south'
      ? facade.maxZ
      : passage.side === 'west'
        ? facade.minX
        : facade.maxX;
  const outerFixed = passage.side === 'north'
    ? outerBounds.minZ
    : passage.side === 'south'
      ? outerBounds.maxZ
      : passage.side === 'west'
        ? outerBounds.minX
        : outerBounds.maxX;
  const halfWidth = passage.width * 0.5;
  const thickness = 0.16;
  const depth = Math.abs(outerFixed - fixed);
  const rectFromLocal = (
    alongMin: number,
    alongMax: number,
    depthMin: number,
    depthMax: number,
  ): Rect => {
    const fixedA = fixed + outward * depthMin;
    const fixedB = fixed + outward * depthMax;
    return horizontal
      ? {
          minX: passage.along + alongMin,
          maxX: passage.along + alongMax,
          minZ: Math.min(fixedA, fixedB),
          maxZ: Math.max(fixedA, fixedB),
        }
      : {
          minX: Math.min(fixedA, fixedB),
          maxX: Math.max(fixedA, fixedB),
          minZ: passage.along + alongMin,
          maxZ: passage.along + alongMax,
        };
  };
  return {
    floorRects: [rectFromLocal(-halfWidth, halfWidth, 0, depth)],
    ceilingRects: [rectFromLocal(-halfWidth, halfWidth, 0.18, depth)],
    wallRects: [
      rectFromLocal(-halfWidth, -halfWidth + thickness, 0.18, depth),
      rectFromLocal(halfWidth - thickness, halfWidth, 0.18, depth),
    ],
    turnDirection: 1,
  };
};

const abyssPassageColliders = (
  passage: EpicPassagePreview,
  facade: Rect,
  bottom: number,
  idPrefix: string,
  layout: EpicAbyssPassageLayout = getEpicAbyssPassageLayout(passage, facade),
): StaticCollider[] => {
  return [
    ...layout.wallRects.map((rect, index): StaticCollider => {
      const center = rectCenter(rect);
      return {
        id: `${idPrefix}-wall-${index}`,
        center: { x: center.x, y: bottom + EPIC1_PORTAL_HEIGHT * 0.5, z: center.z },
        halfExtents: {
          x: rectWidth(rect) * 0.5,
          y: EPIC1_PORTAL_HEIGHT * 0.5,
          z: rectDepth(rect) * 0.5,
        },
        kind: 'wall',
      };
    }),
    ...layout.ceilingRects.map((rect, index): StaticCollider => {
      const center = rectCenter(rect);
      return {
        id: `${idPrefix}-ceiling-${index}`,
        center: { x: center.x, y: bottom + EPIC1_PORTAL_HEIGHT + 0.1, z: center.z },
        halfExtents: { x: rectWidth(rect) * 0.5, y: 0.1, z: rectDepth(rect) * 0.5 },
        kind: 'barrier',
      };
    }),
  ];
};

export interface Epic3PassagePreviewLayout {
  readonly floorRects: readonly Rect[];
  readonly ceilingRects: readonly Rect[];
  readonly wallRects: readonly Rect[];
}

/**
 * One continuous Backrooms gallery behind an epic3 facade. Every portal opens
 * onto the same navigable lane; partition fins break the long sightline without
 * sealing an entrance into a private dead end.
 */
export const getEpic3BackroomsGalleryLayout = (
  passages: readonly EpicPassagePreview[],
  envelope: Rect,
  facade: Rect,
  side: 'north' | 'south',
): Epic3PassagePreviewLayout => {
  const sidePassages = passages
    .filter((passage) => passage.side === side)
    .sort((left, right) => left.along - right.along);
  if (sidePassages.length === 0) {
    return { floorRects: [], ceilingRects: [], wallRects: [] };
  }
  const wallThickness = 0.18;
  const innerZ = side === 'north' ? facade.minZ : facade.maxZ;
  const outerZ = side === 'north' ? envelope.minZ : envelope.maxZ;
  const gallery: Rect = {
    minX: envelope.minX,
    maxX: envelope.maxX,
    minZ: Math.min(innerZ, outerZ),
    maxZ: Math.max(innerZ, outerZ),
  };
  const outerWall: Rect = side === 'north'
    ? { ...gallery, maxZ: gallery.minZ + wallThickness }
    : { ...gallery, minZ: gallery.maxZ - wallThickness };
  const finOuterZ = side === 'north'
    ? gallery.minZ + wallThickness
    : gallery.maxZ - wallThickness;
  const finInnerZ = side === 'north'
    ? facade.minZ - EPIC3_GALLERY_LANE_DEPTH
    : facade.maxZ + EPIC3_GALLERY_LANE_DEPTH;
  const dividerWalls = sidePassages.slice(0, -1).map((passage, index): Rect => {
    const next = sidePassages[index + 1]!;
    const x = (passage.along + next.along) * 0.5;
    return {
      minX: x - wallThickness * 0.5,
      maxX: x + wallThickness * 0.5,
      minZ: Math.min(finOuterZ, finInnerZ),
      maxZ: Math.max(finOuterZ, finInnerZ),
    };
  });
  return {
    floorRects: [gallery],
    ceilingRects: [gallery],
    wallRects: [outerWall, ...dividerWalls],
  };
};

const epic3GalleryColliders = (
  layout: Epic3PassagePreviewLayout,
  bottom: number,
  idPrefix: string,
): StaticCollider[] => layout.wallRects.map((rect, wallIndex): StaticCollider => {
  const center = rectCenter(rect);
  return {
    id: `${idPrefix}-${wallIndex}`,
    center: { x: center.x, y: bottom + EPIC_PASSAGE_HEIGHT * 0.5, z: center.z },
    halfExtents: {
      x: rectWidth(rect) * 0.5,
      y: EPIC_PASSAGE_HEIGHT * 0.5,
      z: rectDepth(rect) * 0.5,
    },
    kind: 'wall',
  };
});

const createEpicLights = (
  feature: EpicStructureFeature,
  visualBiome: WorldPlan['visualBiome'],
): LightSlot[] => {
  const definition = getEpicStructureDefinition(feature.index);
  if (feature.variant === 'impossible-stairwell') {
    return getEpicStairwellLayout(feature).landings
      .filter((_, index) => index % 2 === 0)
      .map((landing, index): LightSlot => {
        const center = rectCenter(landing.bounds);
        return {
          id: `${definition.command}-landing-light-${index}`,
          x: center.x,
          ceilingY: landing.top - 0.19,
          z: center.z,
          rotation: index % 2 === 0 ? 0 : Math.PI * 0.5,
          width: 1.25,
          intensity: 1.32,
          color: visualBiome === 'red' ? 0xff241c : visualBiome === 'white' ? 0xe9f1f2 : 0xfff4c2,
          dead: false,
          unstable: index % 7 === 3,
          phase: (index + 1) * 0.73 + feature.index,
          roomId: feature.roomId,
          level: 0,
        };
      });
  }
  if (feature.variant === 'ascending-passages') {
    const rows = [...new Set([0, (feature.entryLevel ?? 0) * STORY_PITCH])];
    const facade = feature.passageFacadeBounds ?? feature.bounds;
    const template = feature.passageLevels
      ?.find((level) => Math.abs(level.y) < 0.01)
      ?.passages.filter((passage) => passage.side === 'north' && Math.abs(passage.along) <= 55)
      .filter((_, index) => index % 2 === 0) ?? [];
    const positions = rows.flatMap((rowY) =>
      template.flatMap((passage) => [
        { x: passage.along, z: facade.minZ - 2.4, rowY },
        { x: passage.along, z: facade.maxZ + 2.4, rowY },
      ])
    );
    return positions.map(({ x, z, rowY }, index): LightSlot => ({
      id: `${definition.command}-gallery-light-${index}`,
      x,
      ceilingY: rowY + EPIC_PASSAGE_HEIGHT,
      z,
      rotation: 0,
      width: 2.2,
      intensity: 1.38,
      color: visualBiome === 'red' ? 0xff241c : visualBiome === 'white' ? 0xe9f1f2 : 0xfff4c2,
      dead: false,
      unstable: index % 8 === 5,
      phase: (index + 1) * 0.73 + feature.index,
      roomId: feature.roomId,
      level: Math.round(rowY / STORY_PITCH),
    }));
  }
  if (feature.variant === 'vanishing-concourse') {
    const positions = [-44, -22, 0, 22, 44].flatMap((x) =>
      [-38, -19, 0, 19, 38].map((z) => [x, z] as const)
    );
    return positions.map(([x, z], index): LightSlot => ({
      id: `${definition.command}-ceiling-light-${index}`,
      x,
      ceilingY: feature.height - 0.035,
      z,
      rotation: index % 2 === 0 ? 0 : Math.PI * 0.5,
      width: 3.1,
      intensity: 1.34,
      color: visualBiome === 'red' ? 0xff241c : visualBiome === 'white' ? 0xe9f1f2 : 0xfff4c2,
      dead: false,
      unstable: false,
      phase: (index + 1) * 0.73 + feature.index,
      roomId: feature.roomId,
      level: 0,
    }));
  }
  const positions = feature.variant === 'endless-abyss'
    ? [
        ...[-42, -21, 0, 21, 42].flatMap((along) => [
          [along, -55.05] as const,
          [along, 55.05] as const,
        ]),
        ...[-32, 0, 32].flatMap((along) => [
          [-55.05, along] as const,
          [55.05, along] as const,
        ]),
      ]
    : feature.variant === 'lost-ceiling'
      ? [-42, -18, 0, 18, 42].flatMap((x) => [-40, -20, 0, 20, 40].map((z) => [x, z] as const))
    : [
      [-36, -43], [-12, -43], [12, -43], [36, -43],
      [-36, 43], [-12, 43], [12, 43], [36, 43],
      [-43, -20], [-43, 20], [43, -20], [43, 20],
    ] as const;
  const ceilingY = feature.variant === 'endless-abyss'
    ? 5.2
    : feature.variant === 'lost-ceiling'
      ? feature.height - 0.035
      : Math.min(14, Math.max(7.5, feature.height * 0.2));
  return positions.map(([x, z], index): LightSlot => ({
    id: `${definition.command}-light-${index}`,
    x,
    ceilingY,
    z,
    rotation: index % 2 === 0 ? 0 : Math.PI * 0.5,
    width: feature.variant === 'endless-abyss'
      ? 1.55
      : feature.variant === 'lost-ceiling'
        ? 3.4
        : index % 4 === 0 ? 2.6 : 2.05,
    intensity: feature.variant === 'endless-abyss' ? 1.25 : 1.55,
    color: visualBiome === 'red'
      ? 0xff241c
      : visualBiome === 'white'
        ? 0xe9f1f2
        : 0xfff4c2,
    dead: feature.variant === 'endless-abyss' && index % 5 === 0,
    unstable: index % 7 === feature.index % 7,
    phase: (index + 1) * 0.73 + feature.index,
    roomId: feature.roomId,
    level: 0,
  }));
};

const createFeature = (
  plan: WorldPlan,
  index: EpicStructureIndex,
  context?: EpicStructureContext,
): EpicStructureFeature => {
  const definition = getEpicStructureDefinition(index);
  const halfSize = plan.size * 0.5;
  const planBounds: Rect = { minX: -halfSize, minZ: -halfSize, maxX: halfSize, maxZ: halfSize };
  const layoutSeed = instanceSeed(plan.seed, context);
  const ascending = index === 3 ? createAscendingLayout(layoutSeed) : undefined;
  const bounds = ascending?.bounds ?? (index === 4
    ? {
        minX: -EPIC4_ROOM_HALF_SPAN,
        minZ: -EPIC4_ROOM_HALF_SPAN,
        maxX: EPIC4_ROOM_HALF_SPAN,
        maxZ: EPIC4_ROOM_HALF_SPAN,
      }
    : planBounds);
  const voidBounds = index === 1
    ? getEpicVoidBounds(1)
    : ascending?.voidBounds;
  const passageFacadeBounds = index === 1
    ? {
        minX: -EPIC1_FACADE_HALF_SPAN,
        minZ: -EPIC1_FACADE_HALF_SPAN,
        maxX: EPIC1_FACADE_HALF_SPAN,
        maxZ: EPIC1_FACADE_HALF_SPAN,
      }
    : ascending?.facadeBounds;
  const passageLevels = index === 1
    ? createAbyssPassageLevels(plan.seed, context)
    : ascending?.passageLevels;
  return {
    kind: 'epic-structure',
    id: `${definition.command}-${definition.variant}`,
    roomId: `${definition.command}-room`,
    index,
    variant: definition.variant,
    bounds: { ...bounds },
    height: definition.height,
    destination: ascending?.destination ?? (index === 1
      ? { x: 0, y: 0.865, z: -(EPIC1_VOID_HALF_SPAN + EPIC1_FACADE_HALF_SPAN) * 0.5 }
      : index === 4
        ? { x: -7.55, y: 0.865, z: -7.55 }
        : { x: 0, y: 0.865, z: -45 }),
    ...(voidBounds ? { voidBounds: { ...voidBounds } } : {}),
    ...(passageFacadeBounds ? { passageFacadeBounds } : {}),
    ...(passageLevels ? { passageLevels } : {}),
    ...(ascending
      ? {
        entryLevel: ascending.entryLevel,
        bottomless: ascending.bottomless,
      }
      : {}),
  };
};

export const applyEpicStructure = (
  plan: WorldPlan,
  index: EpicStructureIndex,
  context?: EpicStructureContext,
): EpicStructureFeature => {
  const definition = getEpicStructureDefinition(index);
  const feature = createFeature(plan, index, context);
  const retained = feature.variant === 'impossible-stairwell'
    ? {
        rooms: [...plan.rooms],
        walls: [...plan.walls],
        columns: [...plan.columns],
        solidMasses: [...plan.solidMasses],
        lights: [...plan.lights],
        detailSockets: [...plan.detailSockets],
        propPlacements: [...(plan.propPlacements ?? [])],
        colliders: [...plan.colliders],
        unlitZones: [...(plan.unlitZones ?? [])],
        baseboardlessZones: [...(plan.baseboardlessZones ?? [])],
        symmetryZones: [...(plan.symmetryZones ?? [])],
        plasterZones: [...(plan.plasterZones ?? [])],
        ceilingZones: [...(plan.ceilingZones ?? [])],
      }
    : null;
  const halfSize = plan.size * 0.5;
  const planBounds: Rect = { minX: -halfSize, minZ: -halfSize, maxX: halfSize, maxZ: halfSize };
  const epic3Facade = feature.passageFacadeBounds ?? feature.bounds;
  const epic3GroundRow = feature.passageLevels?.find((level) => Math.abs(level.y) <= 0.01);
  const abyssFacade = feature.passageFacadeBounds ?? feature.voidBounds;
  const abyssGroundRow = feature.passageLevels?.find((level) => Math.abs(level.y) <= 0.01);
  const floorRects = feature.variant === 'impossible-stairwell'
    ? [{ ...planBounds }]
    : feature.variant === 'ascending-passages'
      ? (['north', 'south'] as const).flatMap((side) =>
          getEpic3BackroomsGalleryLayout(
            epic3GroundRow?.passages ?? [],
            feature.bounds,
            epic3Facade,
            side,
          ).floorRects
        )
    : feature.variant === 'endless-abyss' && feature.voidBounds && abyssFacade
      ? [
          ...floorCellsAroundVoid(abyssFacade, feature.voidBounds),
          ...(abyssGroundRow?.passages ?? []).flatMap((passage) =>
            getEpicAbyssThroughPassageLayout(passage, abyssFacade, planBounds).floorRects
          ),
        ]
    : feature.voidBounds
    ? floorCellsAroundVoid(planBounds, feature.voidBounds)
    : [{ ...planBounds }];
  const colliders: StaticCollider[] = floorRects.map((rect, rectIndex) =>
    floorCollider(rect, `floor-epic-${rectIndex}`)
  );

  if (feature.variant === 'endless-abyss' && feature.voidBounds) {
    const facadeBounds = feature.passageFacadeBounds ?? feature.voidBounds;
    const currentLevel = feature.passageLevels?.find((level) => level.y === 0);
    for (const [passageIndex, passage] of (currentLevel?.passages ?? []).entries()) {
      colliders.push(...abyssPassageColliders(
        passage,
        facadeBounds,
        0,
        `epic1-passage-${passageIndex}`,
        getEpicAbyssThroughPassageLayout(passage, facadeBounds, planBounds),
      ));
    }
    colliders.push(...facadeWallColliders(
      facadeBounds,
      currentLevel?.passages ?? [],
      0,
      STORY_PITCH,
      'epic1-shaft-wall',
    ));
    // Keep one physical preview alive while a worker prepares the destination
    // story. At the midpoint hand-off these shapes line up exactly with the
    // lower chunk's current-level shapes, so landing never depends on timing.
    const lowerPreview = feature.passageLevels?.find(
      (level) => Math.abs(level.y + STORY_PITCH) < 0.01,
    );
    for (const [ledgeIndex, ledge] of floorCellsAroundVoid(
      facadeBounds,
      feature.voidBounds,
    ).entries()) {
      colliders.push(floorCollider(
        ledge,
        `epic1-lower-preview-ledge-floor-${ledgeIndex}`,
        -STORY_PITCH,
      ));
    }
    for (const [passageIndex, passage] of (lowerPreview?.passages ?? []).entries()) {
      colliders.push(
        ...abyssPassageColliders(
          passage,
          facadeBounds,
          -STORY_PITCH,
          `epic1-lower-preview-passage-${passageIndex}`,
        ),
      );
    }
    colliders.push(...facadeWallColliders(
      facadeBounds,
      lowerPreview?.passages ?? [],
      -STORY_PITCH,
      STORY_PITCH,
      'epic1-lower-preview-shaft-wall',
    ));
  }

  if (feature.variant === 'ascending-passages') {
    const facadeBounds = feature.passageFacadeBounds ?? feature.bounds;
    const entryY = (feature.entryLevel ?? 0) * STORY_PITCH;
    const entryRow = feature.passageLevels?.find((level) => Math.abs(level.y - entryY) < 0.01);
    const entry = entryRow?.passages.find(
      (passage) => passage.side === 'north' && Math.abs(passage.along) < 0.01,
    );
    if (entry && feature.entryLevel && feature.entryLevel > 0) {
      const galleryLayouts = (['north', 'south'] as const).map((side) =>
        getEpic3BackroomsGalleryLayout(
          entryRow?.passages ?? [],
          feature.bounds,
          facadeBounds,
          side,
        )
      );
      const galleryFloors = galleryLayouts.flatMap((layout) => layout.floorRects);
      colliders.push(
        ...galleryFloors.map((rect, index) =>
          floorCollider(rect, `epic3-elevated-gallery-floor-${index}`, entryY)
        ),
        ...galleryLayouts.flatMap((layout, sideIndex) =>
          epic3GalleryColliders(layout, entryY, `epic3-elevated-gallery-wall-${sideIndex}`)
        ),
      );
      colliders.push(...facadeWallColliders(
        facadeBounds,
        entryRow?.passages ?? [],
        entryY,
        Math.min(STORY_PITCH, EPIC_PASSAGE_HEIGHT + 1.2),
        'epic3-elevated-facade',
      ).filter((collider) => collider.id.includes('-north-') || collider.id.includes('-south-')));
      colliders.push(...facadeWallColliders(
        feature.bounds,
        [],
        entryY,
        STORY_PITCH,
        'epic3-elevated-end-cap',
      ).filter((collider) => collider.id.includes('-west-') || collider.id.includes('-east-')));
    }
    const groundRow = feature.passageLevels?.find((level) => level.y === 0);
    const groundGalleryLayouts = (['north', 'south'] as const).map((side) =>
      getEpic3BackroomsGalleryLayout(
        groundRow?.passages ?? [],
        feature.bounds,
        facadeBounds,
        side,
      )
    );
    colliders.push(...facadeWallColliders(
      facadeBounds,
      groundRow?.passages ?? [],
      0,
      Math.min(STORY_PITCH, EPIC_PASSAGE_HEIGHT + 1.2),
      'epic3-ground-facade',
    ).filter((collider) => collider.id.includes('-north-') || collider.id.includes('-south-')));
    colliders.push(...groundGalleryLayouts.flatMap((layout, sideIndex) =>
      epic3GalleryColliders(layout, 0, `epic3-ground-gallery-wall-${sideIndex}`)
    ));
    colliders.push(...facadeWallColliders(
      feature.bounds,
      [],
      0,
      STORY_PITCH,
      'epic3-ground-end-cap',
    ).filter((collider) => collider.id.includes('-west-') || collider.id.includes('-east-')));
    if (feature.bottomless && feature.voidBounds) {
      const shaftBottom = -(EPIC3_LOWER_STORIES + 1) * STORY_PITCH;
      colliders.push(...facadeWallColliders(
        feature.voidBounds,
        [],
        shaftBottom,
        -shaftBottom,
        'epic3-bottomless-shaft-wall',
      ));
    }
  }

  if (feature.variant === 'impossible-stairwell') {
    const stairwell = getEpicStairwellLayout(feature);
    const northRailStart = EPIC4_UPPER_CORRIDOR_MAX_X;
    colliders.push(
      ...stairwell.flights.flatMap((flight) => [
        slopedFloorCollider(flight),
        stairOuterBarrierCollider(flight),
      ]),
      ...stairwell.landings.map((landing) => floorCollider(
        landing.bounds,
        landing.id,
        landing.top,
      )),
      ...stairwell.landings.flatMap(stairLandingBarrierColliders),
      ...stairwell.summitRects.map((rect, index) => floorCollider(
        rect,
        `epic4-summit-floor-${index}`,
        stairwell.summitY,
      )),
      ...stairwell.upperFloorRects.map((rect, index) => floorCollider(
        rect,
        `epic4-upper-maze-floor-${index}`,
        stairwell.summitY,
      )),
      ...stairwell.upperWalls.map(epicWallCollider),
      edgeBarrierCollider(
        'epic4-summit-north',
        'x',
        (northRailStart + EPIC4_STAIR_OUTER_SPAN) * 0.5,
        -EPIC4_STAIR_OUTER_SPAN,
        EPIC4_STAIR_OUTER_SPAN - northRailStart,
        stairwell.summitY,
      ),
      edgeBarrierCollider('epic4-summit-south', 'x', 0, EPIC4_STAIR_OUTER_SPAN, EPIC4_STAIR_OUTER_SPAN * 2, stairwell.summitY),
      edgeBarrierCollider('epic4-summit-west', 'z', 0, -EPIC4_STAIR_OUTER_SPAN, EPIC4_STAIR_OUTER_SPAN * 2, stairwell.summitY),
      edgeBarrierCollider('epic4-summit-east', 'z', 0, EPIC4_STAIR_OUTER_SPAN, EPIC4_STAIR_OUTER_SPAN * 2, stairwell.summitY),
      ...getEpicStairRoomWalls(feature).map(epicWallCollider),
    );
  }

  const architecturalWalls = feature.variant === 'vanishing-concourse'
    ? getEpicConcourseWalls(feature)
    : [];
  colliders.push(...architecturalWalls.map(epicWallCollider));
  const groundObstacles = getEpicGroundObstacles(feature);
  colliders.push(...groundObstacles.map(obstacleCollider));
  const epicRoom = {
    id: feature.roomId,
    bounds: { ...feature.bounds },
    kind: definition.variant === 'endless-abyss' ? 'pit-gallery' : 'open-hall',
    level: 0,
    ceilingHeight: definition.height,
    detailDensity: 0,
    access: 'open',
  } as const;
  const epicColumns = groundObstacles.map((entry) => {
    const center = rectCenter(entry.bounds);
    return {
      x: center.x,
      z: center.z,
      width: rectWidth(entry.bounds),
      depth: rectDepth(entry.bounds),
      bottom: entry.bottom,
      height: entry.height,
      tint: entry.tint,
      kind: 'column' as const,
    };
  });
  const epicLights = createEpicLights(feature, plan.visualBiome);
  const clearance = expandRect(feature.bounds, 3.2);
  const keptRooms = retained?.rooms.filter((room) =>
    room.ceilingHeight <= plan.wallHeight + 0.1 || !rectsOverlap(room.bounds, feature.bounds)
  ) ?? [];
  const keptWalls = retained?.walls.filter((wall) => !rectsOverlap(wallFootprint(wall), clearance)) ?? [];
  const keptColumns = retained?.columns.filter((column) => !rectsOverlap({
    minX: column.x - column.width * 0.5,
    maxX: column.x + column.width * 0.5,
    minZ: column.z - column.depth * 0.5,
    maxZ: column.z + column.depth * 0.5,
  }, clearance)) ?? [];
  const keptMasses = retained?.solidMasses.filter((mass) => !rectsOverlap(mass.bounds, clearance)) ?? [];
  const keptRoomIds = new Set(keptRooms.map((room) => room.id));
  const keptLights = retained?.lights.filter((light) =>
    keptRoomIds.has(light.roomId) && !pointInRect(light.x, light.z, feature.bounds)
  ) ?? [];
  const keptColliders = retained?.colliders.filter((collider) =>
    collider.kind !== 'floor' && !rectsOverlap(colliderFootprint(collider), clearance)
  ) ?? [];
  plan.rooms = [...keptRooms, epicRoom];
  plan.walls = [...keptWalls, ...architecturalWalls];
  plan.columns = [...keptColumns, ...epicColumns];
  plan.solidMasses = keptMasses;
  plan.lights = [...keptLights, ...epicLights];
  plan.missingCeilingTiles = [];
  plan.features = [feature];
  plan.detailSockets = retained?.detailSockets.filter((socket) =>
    keptRoomIds.has(socket.roomId) &&
    !pointInRect(socket.position.x, socket.position.z, clearance)
  ) ?? [];
  plan.propPlacements = retained?.propPlacements.filter((placement) =>
    keptRoomIds.has(placement.roomId) && !rectsOverlap(placement.bounds, clearance)
  ) ?? [];
  plan.floorRects = floorRects;
  plan.floorOpenings = feature.voidBounds ? [{ ...feature.voidBounds }] : [];
  plan.ceilingOpenings = feature.variant === 'endless-abyss' && feature.voidBounds
    ? [{ ...feature.voidBounds }]
    : [];
  plan.lowerPreviewOpenings = feature.variant === 'endless-abyss' && feature.voidBounds
    ? [{ ...feature.voidBounds }]
    : [];
  plan.stairCeilingOpenings = [];
  plan.colliders = [...keptColliders, ...colliders];
  plan.unlitZones = retained?.unlitZones.filter((zone) => !rectsOverlap(zone, clearance)) ?? [];
  plan.baseboardlessZones = [
    ...(retained?.baseboardlessZones.filter((zone) => !rectsOverlap(zone, clearance)) ?? []),
    { ...feature.bounds },
  ];
  plan.symmetryZones = ['lost-ceiling', 'ascending-passages', 'vanishing-concourse'].includes(definition.variant)
    ? [{ ...feature.bounds }]
    : [];
  plan.plasterZones = retained?.plasterZones.filter((zone) => !rectsOverlap(zone, clearance)) ?? [];
  plan.ceilingZones = feature.variant === 'ascending-passages'
    ? []
    : [
      ...(retained?.ceilingZones.filter((zone) =>
        zone.roomIds.every((roomId) => keptRooms.some((room) => room.id === roomId))
      ) ?? []),
      {
        id: `${definition.command}-ceiling`,
        roomIds: [feature.roomId],
        height: definition.height,
        scale: 'colossal',
      },
    ];
  plan.spawn = { ...feature.destination };
  return feature;
};
