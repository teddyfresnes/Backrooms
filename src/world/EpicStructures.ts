import type {
  EpicStructureFeature,
  EpicStructureIndex,
  EpicStructureVariant,
  LightSlot,
  Rect,
  StaticCollider,
  WorldPlan,
} from './types';
import { pointInRect, rectCenter, rectDepth, rectWidth } from './types';

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
    label: 'le puits sans fond',
    aliases: ['epic-1', 'abyss', 'abysse', 'gouffre', 'puits-sans-fond'],
    height: 54,
  },
  {
    index: 2,
    command: 'epic2',
    variant: 'lost-ceiling',
    label: 'la salle au plafond perdu',
    aliases: ['epic-2', 'plafond-infini', 'lost-ceiling', 'salle-infinie'],
    height: 72,
  },
  {
    index: 3,
    command: 'epic3',
    variant: 'ascending-passages',
    label: 'les mille passages ascendants',
    aliases: ['epic-3', 'passages-hauts', 'ascending-passages', 'mille-passages'],
    height: 64,
  },
  {
    index: 4,
    command: 'epic4',
    variant: 'endless-pillars',
    label: 'la foret de piliers',
    aliases: ['epic-4', 'piliers-infinis', 'endless-pillars', 'foret-piliers'],
    height: 68,
  },
  {
    index: 5,
    command: 'epic5',
    variant: 'impossible-stairwell',
    label: 'la cage d escalier impossible',
    aliases: ['epic-5', 'escaliers-infinis', 'impossible-stairwell', 'cage-escalier'],
    height: 60,
  },
  {
    index: 6,
    command: 'epic6',
    variant: 'suspended-rooms',
    label: 'les chambres suspendues',
    aliases: ['epic-6', 'salles-suspendues', 'suspended-rooms', 'chambres-hautes'],
    height: 62,
  },
  {
    index: 7,
    command: 'epic7',
    variant: 'nested-gates',
    label: 'la galerie des seuils',
    aliases: ['epic-7', 'portes-infinies', 'nested-gates', 'galerie-seuils'],
    height: 42,
  },
  {
    index: 8,
    command: 'epic8',
    variant: 'light-cathedral',
    label: 'la cathedrale fluorescente',
    aliases: ['epic-8', 'cathedrale', 'light-cathedral', 'fluorescent'],
    height: 70,
  },
];

const EPIC_INDEX_BY_RESIDUE: Readonly<Record<string, EpicStructureIndex>> = {
  '1:0': 1,
  '2:0': 2,
  '0:1': 3,
  '1:1': 4,
  '2:1': 5,
  '0:2': 6,
  '1:2': 7,
  '2:2': 8,
};

const euclideanModulo = (value: number, modulus: number): number =>
  ((value % modulus) + modulus) % modulus;

/**
 * Every horizontal 3x3 neighborhood contains one ordinary chunk and exactly
 * one instance of epic1..epic8. Story is deliberately ignored: the landmarks
 * continue vertically when the streamer changes logical floor.
 */
export const epicStructureIndexForCoord = (
  coord: Pick<{ x: number; z: number }, 'x' | 'z'>,
): EpicStructureIndex | null => {
  const residueX = euclideanModulo(coord.x, 3);
  const residueZ = euclideanModulo(coord.z, 3);
  if (residueX === 0 && residueZ === 0) return null;
  return EPIC_INDEX_BY_RESIDUE[`${residueX}:${residueZ}`] ?? null;
};

export const getEpicStructureDefinition = (
  index: EpicStructureIndex,
): EpicStructureDefinition => {
  const definition = EPIC_STRUCTURE_DEFINITIONS[index - 1];
  if (!definition || definition.index !== index) {
    throw new Error(`Unknown epic structure index: ${String(index)}.`);
  }
  return definition;
};

export const getEpicVoidBounds = (
  index: EpicStructureIndex,
): Rect | undefined =>
  index === 1 ? { minX: -32, minZ: -32, maxX: 32, maxZ: 32 } : undefined;

export const getEpicAbyssBottom = (feature: EpicStructureFeature): number =>
  -Math.max(72, feature.height + 18);

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
): boolean =>
  isInsideEpicAbyssFall(feature, position) ||
  (
    position.y >= 0.08 &&
    position.y < feature.height - 0.08 &&
    pointInRect(position.x, position.z, feature.bounds, 0.4)
  );

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

/**
 * Ground-touching masses are shared by the plan collider builder and renderer.
 * Upper, unreachable illusions remain render-only.
 */
export const getEpicGroundObstacles = (
  feature: EpicStructureFeature,
): EpicObstacle[] => {
  const obstacles: EpicObstacle[] = [];
  if (feature.variant === 'lost-ceiling') {
    for (const x of [-34, 0, 34]) {
      for (const z of [-28, 0, 28]) {
        if (x === 0 && z === 0) continue;
        obstacles.push(obstacle(`lost-ceiling-pillar-${x}-${z}`, x, z, 3.4, 3.4, feature.height));
      }
    }
  } else if (feature.variant === 'ascending-passages') {
    for (const z of [-30, 0, 30]) {
      obstacles.push(
        obstacle(`passage-west-${z}`, -44, z, 3.2, 7.5, feature.height, 0.88),
        obstacle(`passage-east-${z}`, 44, z, 3.2, 7.5, feature.height, 0.88),
      );
    }
    for (const x of [-26, 0, 26]) {
      obstacles.push(
        obstacle(`passage-north-${x}`, x, -44, 7.5, 3.2, feature.height, 0.9),
        obstacle(`passage-south-${x}`, x, 44, 7.5, 3.2, feature.height, 0.9),
      );
    }
  } else if (feature.variant === 'endless-pillars') {
    for (const x of [-36, -18, 0, 18, 36]) {
      for (const z of [-36, -18, 0, 18, 36]) {
        if (x === 0 && z === 0) continue;
        obstacles.push(obstacle(`endless-pillar-${x}-${z}`, x, z, 2.5, 2.5, feature.height, 0.86));
      }
    }
  } else if (feature.variant === 'impossible-stairwell') {
    obstacles.push(obstacle('stairwell-core', 0, 0, 13, 13, feature.height, 0.82));
    for (const x of [-25, 25]) {
      for (const z of [-25, 25]) {
        obstacles.push(obstacle(`stairwell-pylon-${x}-${z}`, x, z, 3.2, 3.2, feature.height, 0.9));
      }
    }
  } else if (feature.variant === 'suspended-rooms') {
    for (const x of [-29, 29]) {
      for (const z of [-25, 25]) {
        obstacles.push(obstacle(`suspended-support-${x}-${z}`, x, z, 2.7, 2.7, feature.height, 0.88));
      }
    }
  } else if (feature.variant === 'nested-gates') {
    for (const z of [-30, -12, 6, 24, 42]) {
      obstacles.push(
        obstacle(`nested-gate-left-${z}`, -10, z, 2.1, 4.2, 11 + (z + 30) * 0.18, 0.9),
        obstacle(`nested-gate-right-${z}`, 10, z, 2.1, 4.2, 11 + (z + 30) * 0.18, 0.9),
      );
    }
  } else if (feature.variant === 'light-cathedral') {
    for (const x of [-34, -17, 17, 34]) {
      for (const z of [-30, 0, 30]) {
        obstacles.push(obstacle(`cathedral-pillar-${x}-${z}`, x, z, 2.8, 2.8, feature.height, 0.94));
      }
    }
  }
  return obstacles;
};

const floorCellsAroundVoid = (bounds: Rect, opening: Rect): Rect[] => [
  { minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.minZ, maxZ: opening.minZ },
  { minX: bounds.minX, maxX: bounds.maxX, minZ: opening.maxZ, maxZ: bounds.maxZ },
  { minX: bounds.minX, maxX: opening.minX, minZ: opening.minZ, maxZ: opening.maxZ },
  { minX: opening.maxX, maxX: bounds.maxX, minZ: opening.minZ, maxZ: opening.maxZ },
].filter((rect) => rectWidth(rect) > 0.1 && rectDepth(rect) > 0.1);

const floorCollider = (rect: Rect, index: number): StaticCollider => {
  const center = rectCenter(rect);
  return {
    id: `floor-epic-${index}`,
    center: { x: center.x, y: -0.12, z: center.z },
    halfExtents: { x: rectWidth(rect) * 0.5, y: 0.12, z: rectDepth(rect) * 0.5 },
    kind: 'floor',
  };
};

const obstacleCollider = (entry: EpicObstacle): StaticCollider => {
  const center = rectCenter(entry.bounds);
  return {
    id: `epic-obstacle-${entry.id}`,
    center: {
      x: center.x,
      y: entry.bottom + entry.height * 0.5,
      z: center.z,
    },
    halfExtents: {
      x: rectWidth(entry.bounds) * 0.5,
      y: entry.height * 0.5,
      z: rectDepth(entry.bounds) * 0.5,
    },
    kind: 'column',
  };
};

const abyssShaftColliders = (
  feature: EpicStructureFeature,
): StaticCollider[] => {
  if (!feature.voidBounds) return [];
  const center = rectCenter(feature.voidBounds);
  const bottom = getEpicAbyssBottom(feature);
  const halfHeight = Math.abs(bottom) * 0.5;
  const side = 0.06;
  return [
    {
      id: 'epic-abyss-shaft-north',
      center: { x: center.x, y: bottom + halfHeight, z: feature.voidBounds.minZ },
      halfExtents: {
        x: rectWidth(feature.voidBounds) * 0.5,
        y: halfHeight,
        z: side,
      },
      kind: 'wall',
    },
    {
      id: 'epic-abyss-shaft-south',
      center: { x: center.x, y: bottom + halfHeight, z: feature.voidBounds.maxZ },
      halfExtents: {
        x: rectWidth(feature.voidBounds) * 0.5,
        y: halfHeight,
        z: side,
      },
      kind: 'wall',
    },
    {
      id: 'epic-abyss-shaft-west',
      center: { x: feature.voidBounds.minX, y: bottom + halfHeight, z: center.z },
      halfExtents: {
        x: side,
        y: halfHeight,
        z: rectDepth(feature.voidBounds) * 0.5,
      },
      kind: 'wall',
    },
    {
      id: 'epic-abyss-shaft-east',
      center: { x: feature.voidBounds.maxX, y: bottom + halfHeight, z: center.z },
      halfExtents: {
        x: side,
        y: halfHeight,
        z: rectDepth(feature.voidBounds) * 0.5,
      },
      kind: 'wall',
    },
  ];
};

const createEpicLights = (
  feature: EpicStructureFeature,
  visualBiome: WorldPlan['visualBiome'],
): LightSlot[] => {
  const definition = getEpicStructureDefinition(feature.index);
  const height = feature.variant === 'endless-abyss'
    ? 5.2
    : Math.min(14, Math.max(7.5, feature.height * 0.2));
  const positions = [
    [-36, -43], [-12, -43], [12, -43], [36, -43],
    [-36, 43], [-12, 43], [12, 43], [36, 43],
    [-43, -20], [-43, 20], [43, -20], [43, 20],
  ] as const;
  return positions.map(([x, z], index): LightSlot => ({
    id: `${definition.command}-light-${index}`,
    x,
    ceilingY: height + (index % 3) * 0.14,
    z,
    rotation: index % 2 === 0 ? 0 : Math.PI * 0.5,
    width: index % 4 === 0 ? 2.6 : 2.05,
    intensity: feature.variant === 'endless-abyss' ? 1.25 : 1.55,
    color: visualBiome === 'red'
      ? 0xff241c
      : visualBiome === 'white'
        ? 0xe9f1f2
        : feature.variant === 'light-cathedral' && index % 3 === 0
          ? 0xdcefff
          : 0xfff4c2,
    dead: feature.variant === 'endless-abyss' && index % 5 === 0,
    unstable: index % 7 === feature.index % 7,
    phase: (index + 1) * 0.73 + feature.index,
    roomId: feature.roomId,
    level: 0,
  }));
};

export const applyEpicStructure = (
  plan: WorldPlan,
  index: EpicStructureIndex,
): EpicStructureFeature => {
  const definition = getEpicStructureDefinition(index);
  const halfSize = plan.size * 0.5;
  const bounds: Rect = {
    minX: -halfSize,
    minZ: -halfSize,
    maxX: halfSize,
    maxZ: halfSize,
  };
  const voidBounds = getEpicVoidBounds(index);
  const roomId = `${definition.command}-room`;
  const feature: EpicStructureFeature = {
    kind: 'epic-structure',
    id: `${definition.command}-${definition.variant}`,
    roomId,
    index,
    variant: definition.variant,
    bounds: { ...bounds },
    height: definition.height,
    destination: {
      x: 0,
      y: 0.865,
      z: definition.variant === 'ascending-passages' ? -38 : -45,
    },
    ...(voidBounds ? { voidBounds } : {}),
  };
  const floorRects = voidBounds
    ? floorCellsAroundVoid(bounds, voidBounds)
    : [{ ...bounds }];
  const groundObstacles = getEpicGroundObstacles(feature);

  plan.rooms = [{
    id: roomId,
    bounds: { ...bounds },
    kind: definition.variant === 'endless-abyss' ? 'pit-gallery' : 'open-hall',
    level: 0,
    ceilingHeight: definition.height,
    detailDensity: 0,
    access: 'open',
  }];
  plan.walls = [];
  plan.columns = groundObstacles.map((entry) => {
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
  plan.solidMasses = [];
  plan.lights = createEpicLights(feature, plan.visualBiome);
  plan.missingCeilingTiles = [];
  plan.features = [feature];
  plan.detailSockets = [];
  plan.propPlacements = [];
  plan.floorRects = floorRects;
  plan.floorOpenings = voidBounds ? [{ ...voidBounds }] : [];
  plan.ceilingOpenings = voidBounds ? [{ ...voidBounds }] : [];
  plan.lowerPreviewOpenings = voidBounds ? [{ ...voidBounds }] : [];
  plan.stairCeilingOpenings = [];
  plan.colliders = [
    ...floorRects.map(floorCollider),
    ...groundObstacles.map(obstacleCollider),
    ...abyssShaftColliders(feature),
  ];
  plan.unlitZones = [];
  plan.baseboardlessZones = [{ ...bounds }];
  plan.symmetryZones = [
    'lost-ceiling',
    'endless-pillars',
    'light-cathedral',
  ].includes(definition.variant) ? [{ ...bounds }] : [];
  plan.plasterZones = [];
  plan.ceilingZones = [{
    id: `${definition.command}-ceiling`,
    roomIds: [roomId],
    height: definition.height,
    scale: 'colossal',
  }];
  plan.spawn = { ...feature.destination };
  return feature;
};
