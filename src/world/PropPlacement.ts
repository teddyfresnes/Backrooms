import {
  getPropAsset,
  PROP_ASSETS,
  propAssetsInCategory,
} from './PropCatalog';
import type {
  PropAssetDefinition,
  PropCategory,
} from './PropCatalog';
import { SeededRandom } from './SeededRandom';
import type {
  PropPlacement,
  Rect,
  RoomRecord,
  StaticCollider,
  WallSegment,
  WorldPlan,
} from './types';
import { pointInRect, rectArea, rectCenter, rectDepth, rectWidth } from './types';

export const PROP_CHUNK_PRESENCE_RATE = 0.22;

interface SceneSlot {
  choices: readonly string[];
  x: number;
  z: number;
  y?: number;
  rotation?: number;
  scale?: number;
}

interface SceneRecipe {
  id: string;
  minSpan: number;
  slots: readonly SceneSlot[];
}

const furnitureIds = (...names: string[]): string[] =>
  names.map((name) => `furniture:${name}`);
const retroIds = (...names: string[]): string[] =>
  names.map((name) => `retro:${name}`);

const CHAIRS = furnitureIds(
  'chair',
  'chairCushion',
  'chairDesk',
  'chairModernCushion',
  'chairModernFrameCushion',
  'chairRounded',
  'loungeChair',
  'loungeChairRelax',
  'loungeDesignChair',
);
const SOFAS = furnitureIds(
  'loungeSofa',
  'loungeSofaLong',
  'loungeDesignSofa',
  'loungeSofaCorner',
  'loungeDesignSofaCorner',
);
const DESKS = [
  ...furnitureIds('desk', 'deskCorner'),
  'polyhaven:metal-office-desk',
];
const SCREENS = [
  ...furnitureIds('computerScreen', 'televisionModern', 'televisionVintage'),
  'polyhaven:crt-television',
];
const SMALL_ELECTRONICS = [
  ...furnitureIds('radio', 'laptop'),
  'polyhaven:cassette-player',
];
const BOXES = furnitureIds('cardboardBoxClosed', 'cardboardBoxOpen');
const TABLE_LAMPS = furnitureIds('lampRoundTable', 'lampSquareTable');
const FLOOR_LAMPS = furnitureIds('lampRoundFloor', 'lampSquareFloor');
const SIDE_TABLES = furnitureIds('sideTable', 'sideTableDrawers', 'tableCoffeeSquare');
const DINING_TABLES = furnitureIds('table', 'tableCross', 'tableGlass', 'tableRound');
const STORAGE = furnitureIds(
  'bookcaseClosed',
  'bookcaseClosedDoors',
  'bookcaseOpen',
  'bookcaseOpenLow',
  'cabinetBed',
  'cabinetTelevision',
);
const CONSTRUCTION = [
  ...retroIds(
    'detail-barrier-strong-damaged',
    'detail-barrier-strong-type-a',
    'detail-barrier-type-a',
    'detail-bricks-type-a',
    'detail-bricks-type-b',
    'detail-cables-type-a',
    'detail-cables-type-b',
    'pallet',
    'pallet-small',
    'planks',
  ),
  'polyhaven:fire-extinguisher',
];

const SCENE_RECIPES: readonly SceneRecipe[] = [
  {
    id: 'abandoned-office',
    minSpan: 6.8,
    slots: [
      { choices: DESKS, x: 0, z: -0.3 },
      { choices: CHAIRS, x: 0, z: 1.05, rotation: Math.PI },
      { choices: SCREENS, x: 0, z: -0.4, y: 0.8, scale: 0.78 },
      { choices: furnitureIds('computerKeyboard'), x: 0, z: 0.05, y: 0.81 },
      { choices: BOXES, x: 1.22, z: -0.5, scale: 0.86 },
    ],
  },
  {
    id: 'dead-workstation',
    minSpan: 7.2,
    slots: [
      { choices: DESKS, x: -0.95, z: 0 },
      { choices: DESKS, x: 0.95, z: 0, rotation: Math.PI },
      { choices: CHAIRS, x: -0.95, z: 1.12, rotation: Math.PI },
      { choices: CHAIRS, x: 0.95, z: -1.12 },
      { choices: SCREENS, x: -0.95, z: -0.08, y: 0.8, scale: 0.72 },
      { choices: SMALL_ELECTRONICS, x: 0.95, z: 0.08, y: 0.8 },
    ],
  },
  {
    id: 'crt-audience',
    minSpan: 7.4,
    slots: [
      { choices: SCREENS, x: 0, z: -1.72, scale: 1.08 },
      { choices: CHAIRS, x: -1.15, z: 0.62, rotation: Math.PI },
      { choices: CHAIRS, x: 0, z: 0.85, rotation: Math.PI },
      { choices: CHAIRS, x: 1.15, z: 0.62, rotation: Math.PI },
      { choices: SMALL_ELECTRONICS, x: 0.86, z: -1.55 },
    ],
  },
  {
    id: 'waiting-fragment',
    minSpan: 7.5,
    slots: [
      { choices: CHAIRS, x: -1.45, z: -0.55, rotation: Math.PI * 0.5 },
      { choices: CHAIRS, x: -1.45, z: 0.55, rotation: Math.PI * 0.5 },
      { choices: CHAIRS, x: 1.45, z: -0.55, rotation: -Math.PI * 0.5 },
      { choices: CHAIRS, x: 1.45, z: 0.55, rotation: -Math.PI * 0.5 },
      { choices: SIDE_TABLES, x: 0, z: 0 },
      { choices: furnitureIds('books', 'bear'), x: 0, z: 0, y: 0.67 },
    ],
  },
  {
    id: 'meeting-remnant',
    minSpan: 8.4,
    slots: [
      { choices: DINING_TABLES, x: 0, z: 0, scale: 1.18 },
      { choices: CHAIRS, x: -1.55, z: 0, rotation: Math.PI * 0.5 },
      { choices: CHAIRS, x: 1.55, z: 0, rotation: -Math.PI * 0.5 },
      { choices: CHAIRS, x: -0.5, z: 1.25, rotation: Math.PI },
      { choices: CHAIRS, x: 0.5, z: -1.25 },
      { choices: SMALL_ELECTRONICS, x: 0, z: 0, y: 0.8 },
    ],
  },
  {
    id: 'lounge-loop',
    minSpan: 8.2,
    slots: [
      { choices: SOFAS, x: 0, z: 1.55, rotation: Math.PI },
      { choices: furnitureIds('tableCoffee', 'tableCoffeeGlass'), x: 0, z: 0 },
      { choices: SCREENS, x: 0, z: -1.62 },
      { choices: FLOOR_LAMPS, x: 1.55, z: 1.45 },
      { choices: furnitureIds('pillow', 'pillowBlue', 'pillowLong'), x: -0.5, z: 1.2, y: 0.48 },
    ],
  },
  {
    id: 'bedroom-without-walls',
    minSpan: 8.4,
    slots: [
      { choices: furnitureIds('bedSingle', 'bedDouble'), x: 0, z: 0 },
      { choices: SIDE_TABLES, x: 1.35, z: -0.45 },
      { choices: TABLE_LAMPS, x: 1.35, z: -0.45, y: 0.67 },
      { choices: CHAIRS, x: -1.42, z: 0.6, rotation: Math.PI * 0.5 },
      { choices: furnitureIds('bear', 'books'), x: 0.2, z: 0.15, y: 0.52 },
    ],
  },
  {
    id: 'bathroom-displaced',
    minSpan: 8,
    slots: [
      { choices: furnitureIds('bathtub'), x: -0.65, z: 0 },
      { choices: furnitureIds('toilet'), x: 1.05, z: -0.55 },
      { choices: furnitureIds('bathroomSink'), x: 1.12, z: 0.78, rotation: Math.PI },
      { choices: CHAIRS, x: -0.55, z: 1.35, rotation: Math.PI },
      { choices: BOXES, x: -1.65, z: -0.75, scale: 0.78 },
    ],
  },
  {
    id: 'laundry-island',
    minSpan: 7.5,
    slots: [
      { choices: furnitureIds('washer', 'dryer'), x: -0.72, z: 0 },
      { choices: furnitureIds('washer', 'dryer'), x: 0.72, z: 0 },
      { choices: furnitureIds('trashcan'), x: 1.35, z: 0.72 },
      { choices: BOXES, x: -1.35, z: 0.78, scale: 0.84 },
      { choices: furnitureIds('books', 'pillowLong'), x: 0, z: 0.05, y: 1.03 },
    ],
  },
  {
    id: 'storage-collapse',
    minSpan: 8,
    slots: [
      { choices: STORAGE, x: -1.05, z: -0.7 },
      { choices: STORAGE, x: 1.05, z: -0.7 },
      { choices: BOXES, x: -0.75, z: 0.95 },
      { choices: BOXES, x: 0, z: 1.15, scale: 0.82 },
      { choices: BOXES, x: 0.75, z: 0.88, scale: 1.08 },
      { choices: FLOOR_LAMPS, x: 1.78, z: 0.62 },
    ],
  },
  {
    id: 'construction-stop',
    minSpan: 8.2,
    slots: [
      { choices: retroIds('detail-barrier-strong-damaged', 'detail-barrier-strong-type-a'), x: 0, z: -0.75 },
      { choices: retroIds('pallet', 'pallet-small'), x: -1.38, z: 0.72, rotation: 0.24 },
      { choices: retroIds('planks', 'detail-bricks-type-a', 'detail-bricks-type-b'), x: 0.2, z: 0.8, rotation: -0.18 },
      { choices: retroIds('detail-cables-type-a', 'detail-cables-type-b'), x: 1.25, z: 0.7 },
      { choices: furnitureIds('trashcan'), x: 1.62, z: -0.62 },
      { choices: ['polyhaven:fire-extinguisher'], x: -1.25, z: -0.65 },
    ],
  },
  {
    id: 'bike-rest',
    minSpan: 7.5,
    slots: [
      { choices: ['bike:low-poly'], x: -0.72, z: 0, rotation: 0.1 },
      { choices: furnitureIds('bench', 'benchCushion'), x: 0.75, z: 1.1, rotation: Math.PI },
      { choices: furnitureIds('trashcan'), x: 1.55, z: 0.42 },
      { choices: BOXES, x: 0.85, z: -0.75, scale: 0.82 },
    ],
  },
  {
    id: 'kitchen-orphan',
    minSpan: 8.4,
    slots: [
      { choices: furnitureIds('kitchenFridge', 'kitchenFridgeSmall'), x: -1.15, z: -0.5 },
      { choices: furnitureIds('kitchenStove', 'kitchenStoveElectric'), x: 0, z: -0.5 },
      { choices: furnitureIds('kitchenCabinet', 'kitchenCabinetDrawer'), x: 1.08, z: -0.5 },
      { choices: furnitureIds('kitchenMicrowave', 'toaster', 'kitchenCoffeeMachine'), x: 1.08, z: -0.5, y: 1.2 },
      { choices: CHAIRS, x: 0.4, z: 1.05, rotation: Math.PI },
      { choices: furnitureIds('trashcan'), x: -1.3, z: 0.72 },
    ],
  },
];

const rectsOverlap = (left: Rect, right: Rect, padding = 0): boolean =>
  left.minX < right.maxX + padding &&
  left.maxX > right.minX - padding &&
  left.minZ < right.maxZ + padding &&
  left.maxZ > right.minZ - padding;

const rectContains = (outer: Rect, inner: Rect, margin = 0): boolean =>
  inner.minX >= outer.minX + margin &&
  inner.maxX <= outer.maxX - margin &&
  inner.minZ >= outer.minZ + margin &&
  inner.maxZ <= outer.maxZ - margin;

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

const placementBounds = (
  definition: PropAssetDefinition,
  x: number,
  z: number,
  rotationY: number,
  scale: number,
): Rect => {
  const cosine = Math.abs(Math.cos(rotationY));
  const sine = Math.abs(Math.sin(rotationY));
  const halfX = (definition.size.x * cosine + definition.size.z * sine) * scale * 0.5;
  const halfZ = (definition.size.x * sine + definition.size.z * cosine) * scale * 0.5;
  return {
    minX: x - halfX,
    maxX: x + halfX,
    minZ: z - halfZ,
    maxZ: z + halfZ,
  };
};

const weightedAsset = (
  rng: SeededRandom,
  choices: readonly PropAssetDefinition[],
  used: ReadonlySet<string>,
): PropAssetDefinition => {
  const unused = choices.filter((definition) => !used.has(definition.id));
  const pool = unused.length > 0 ? unused : choices;
  return rng.weighted(pool.map((definition) => ({
    value: definition,
    weight: definition.weight,
  })));
};

const choicesByIds = (ids: readonly string[]): PropAssetDefinition[] =>
  ids.map(getPropAsset);

const structuralRects = (plan: WorldPlan): Rect[] => [
  ...(plan.floorOpenings ?? []),
  ...(plan.ceilingOpenings ?? []),
  ...(plan.stairCeilingOpenings ?? []),
  ...plan.features
    .filter((feature) => feature.kind !== 'impossible-vista')
    .map((feature) => feature.bounds),
];

const placementIsSafe = (
  plan: WorldPlan,
  room: RoomRecord,
  bounds: Rect,
  placed: readonly PropPlacement[],
  allowPropOverlap = false,
  roomMargin = 0.38,
  propPadding = 0.28,
): boolean => {
  if (!rectContains(room.bounds, bounds, roomMargin)) return false;
  if (!plan.floorRects.some((floor) => rectContains(floor, bounds, 0.04))) return false;
  if (structuralRects(plan).some((rect) => rectsOverlap(bounds, rect, 0.62))) return false;
  if (plan.solidMasses.some((mass) => rectsOverlap(bounds, mass.bounds, 0.48))) return false;
  if (plan.columns.some((column) => rectsOverlap(bounds, {
    minX: column.x - column.width * 0.5,
    maxX: column.x + column.width * 0.5,
    minZ: column.z - column.depth * 0.5,
    maxZ: column.z + column.depth * 0.5,
  }, 0.42))) return false;
  if (plan.walls.some((wall) =>
    wall.bottom < 1.2 &&
    wall.bottom + wall.height > 0.1 &&
    rectsOverlap(bounds, wallBounds(wall), 0.08)
  )) return false;
  if (!allowPropOverlap && placed.some((placement) => rectsOverlap(bounds, placement.bounds, propPadding))) {
    return false;
  }
  const center = rectCenter(bounds);
  if (Math.hypot(center.x - plan.spawn.x, center.z - plan.spawn.z) < 4.8) return false;
  return true;
};

const propCollider = (
  placement: PropPlacement,
  definition: PropAssetDefinition,
): StaticCollider | null => {
  if (!definition.collidable || placement.position.y > 0.12) return null;
  const height = definition.size.y * placement.scale;
  return {
    id: `prop-collider-${placement.id}`,
    center: {
      x: placement.position.x,
      y: placement.position.y + height * 0.44,
      z: placement.position.z,
    },
    halfExtents: {
      x: definition.size.x * placement.scale * 0.4,
      y: Math.max(0.18, height * 0.44),
      z: definition.size.z * placement.scale * 0.4,
    },
    kind: 'barrier',
    rotation: {
      x: 0,
      y: Math.sin(placement.rotationY * 0.5),
      z: 0,
      w: Math.cos(placement.rotationY * 0.5),
    },
  };
};

const appendPlacements = (
  plan: WorldPlan,
  placements: readonly PropPlacement[],
): void => {
  plan.propPlacements ??= [];
  for (const placement of placements) {
    plan.propPlacements.push(placement);
    const collider = propCollider(placement, getPropAsset(placement.assetId));
    if (collider) plan.colliders.push(collider);
  }
};

type RoomSide = 'north' | 'east' | 'south' | 'west';

const wallCandidatesForRoom = (
  plan: WorldPlan,
  room: RoomRecord,
): Array<{ wall: WallSegment; side: RoomSide }> => {
  const tolerance = 0.48;
  const candidates: Array<{ wall: WallSegment; side: RoomSide }> = [];
  for (const wall of plan.walls) {
    if (wall.bottom > 0.15 || wall.bottom + wall.height < 1.4) continue;
    if (wall.orientation === 'x') {
      if (Math.abs(wall.z - room.bounds.minZ) <= tolerance) candidates.push({ wall, side: 'north' });
      else if (Math.abs(wall.z - room.bounds.maxZ) <= tolerance) candidates.push({ wall, side: 'south' });
    } else {
      if (Math.abs(wall.x - room.bounds.minX) <= tolerance) candidates.push({ wall, side: 'west' });
      else if (Math.abs(wall.x - room.bounds.maxX) <= tolerance) candidates.push({ wall, side: 'east' });
    }
  }
  return candidates;
};

const wallPropCategories: readonly PropCategory[] = [
  'seating',
  'storage',
  'table',
  'electronics',
  'appliance',
  'bathroom',
  'lamp',
  'plant',
  'clutter',
  'construction',
  'vehicle',
];

const tryWallPlacement = (
  plan: WorldPlan,
  room: RoomRecord,
  rng: SeededRandom,
  index: number,
  used: Set<string>,
): PropPlacement | null => {
  const wallCandidates = rng.shuffle(wallCandidatesForRoom(plan, room));
  for (let attempt = 0; attempt < Math.min(18, Math.max(1, wallCandidates.length * 2)); attempt += 1) {
    const { wall, side } = wallCandidates[attempt % wallCandidates.length] ?? {};
    if (!wall || !side) break;
    const category = rng.pick(wallPropCategories);
    const definition = weightedAsset(rng, propAssetsInCategory(category), used);
    const scale = rng.float(0.86, 1.16);
    const wallStart = (wall.orientation === 'x' ? wall.x : wall.z) - wall.length * 0.5;
    const wallEnd = (wall.orientation === 'x' ? wall.x : wall.z) + wall.length * 0.5;
    const alongHalf = definition.size.x * scale * 0.5;
    const alongMin = Math.max(
      wallStart + alongHalf + 0.42,
      (wall.orientation === 'x' ? room.bounds.minX : room.bounds.minZ) + alongHalf + 0.48,
    );
    const alongMax = Math.min(
      wallEnd - alongHalf - 0.42,
      (wall.orientation === 'x' ? room.bounds.maxX : room.bounds.maxZ) - alongHalf - 0.48,
    );
    if (alongMax <= alongMin) continue;
    const along = rng.float(alongMin, alongMax);
    const inward = definition.size.z * scale * 0.5 + 0.2;
    const baseRotation = side === 'north'
      ? 0
      : side === 'south'
        ? Math.PI
        : side === 'west'
          ? -Math.PI * 0.5
          : Math.PI * 0.5;
    const rotationY = baseRotation + rng.float(-0.035, 0.035);
    const x = side === 'north' || side === 'south'
      ? along
      : side === 'west'
        ? room.bounds.minX + inward
        : room.bounds.maxX - inward;
    const z = side === 'west' || side === 'east'
      ? along
      : side === 'north'
        ? room.bounds.minZ + inward
        : room.bounds.maxZ - inward;
    const bounds = placementBounds(definition, x, z, rotationY, scale);
    if (!placementIsSafe(plan, room, bounds, plan.propPlacements ?? [], false, 0.1)) continue;
    used.add(definition.id);
    return {
      id: `rare-prop-${index}`,
      assetId: definition.id,
      roomId: room.id,
      position: { x, y: 0, z },
      rotationY,
      scale,
      bounds,
      kind: 'wall',
      tone: rng.float(0.82, 1.08),
    };
  }
  return null;
};

const rotateOffset = (
  x: number,
  z: number,
  rotation: number,
): { x: number; z: number } => ({
  x: x * Math.cos(rotation) - z * Math.sin(rotation),
  z: x * Math.sin(rotation) + z * Math.cos(rotation),
});

const tryScenePlacement = (
  plan: WorldPlan,
  room: RoomRecord,
  rng: SeededRandom,
  placementIndex: number,
  used: Set<string>,
): PropPlacement[] | null => {
  const span = Math.min(rectWidth(room.bounds), rectDepth(room.bounds));
  const recipes = rng.shuffle(SCENE_RECIPES.filter((recipe) => recipe.minSpan <= span));
  for (const recipe of recipes) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const angle = rng.int(0, 3) * Math.PI * 0.5 + rng.float(-0.12, 0.12);
      const margin = recipe.minSpan * 0.32 + 1.05;
      if (rectWidth(room.bounds) <= margin * 2 || rectDepth(room.bounds) <= margin * 2) continue;
      const anchor = {
        x: rng.float(room.bounds.minX + margin, room.bounds.maxX - margin),
        z: rng.float(room.bounds.minZ + margin, room.bounds.maxZ - margin),
      };
      const candidates: PropPlacement[] = [];
      const localUsed = new Set(used);
      let valid = true;
      for (const [slotIndex, slot] of recipe.slots.entries()) {
        const definition = weightedAsset(rng, choicesByIds(slot.choices), localUsed);
        localUsed.add(definition.id);
        const offset = rotateOffset(slot.x, slot.z, angle);
        const scale = (slot.scale ?? 1) * rng.float(0.9, 1.1);
        const rotationY = angle + (slot.rotation ?? 0) + rng.float(-0.055, 0.055);
        const x = anchor.x + offset.x;
        const z = anchor.z + offset.z;
        const bounds = placementBounds(definition, x, z, rotationY, scale);
        const raised = (slot.y ?? 0) > 0.12;
        if (!placementIsSafe(
          plan,
          room,
          bounds,
          [...(plan.propPlacements ?? []), ...candidates],
          raised,
          0.38,
          0.04,
        )) {
          valid = false;
          break;
        }
        candidates.push({
          id: `rare-prop-${placementIndex + slotIndex}`,
          assetId: definition.id,
          roomId: room.id,
          position: { x, y: slot.y ?? 0, z },
          rotationY,
          scale,
          bounds,
          kind: 'scene',
          sceneId: recipe.id,
          tone: rng.float(0.8, 1.1),
        });
      }
      if (!valid) continue;
      localUsed.forEach((id) => used.add(id));
      return candidates;
    }
  }
  return null;
};

const eligibleRooms = (plan: WorldPlan): RoomRecord[] => {
  const special = structuralRects(plan);
  return plan.rooms.filter((room) => {
    const width = rectWidth(room.bounds);
    const depth = rectDepth(room.bounds);
    if (room.level !== 0 || width < 5.8 || depth < 5.8) return false;
    if (room.kind === 'corridor' || room.kind === 'threshold' || room.kind === 'pit-gallery') {
      return false;
    }
    if (special.some((rect) => rectsOverlap(room.bounds, rect, -0.8))) return false;
    const center = rectCenter(room.bounds);
    if (Math.hypot(center.x - plan.spawn.x, center.z - plan.spawn.z) < 5) return false;
    return rectArea(room.bounds) >= 38;
  });
};

/**
 * Adds sparse, deterministic visual storytelling after all shafts, stairs and
 * chunk boundaries have reached their final topology.
 */
export const populateRareProps = (
  plan: WorldPlan,
  seed = `${plan.seed}:rare-props`,
): void => {
  plan.propPlacements = [];
  const rng = new SeededRandom(seed);
  if (!rng.chance(PROP_CHUNK_PRESENCE_RATE)) return;
  const rooms = rng.shuffle(eligibleRooms(plan));
  if (rooms.length === 0) return;

  const desiredClusters = rng.chance(0.12) ? 2 : 1;
  const usedRooms = new Set<string>();
  const usedAssets = new Set<string>();
  let placementIndex = 0;
  for (let cluster = 0; cluster < desiredClusters; cluster += 1) {
    const room = rooms.find((candidate) => !usedRooms.has(candidate.id));
    if (!room) break;
    usedRooms.add(room.id);
    const scene = rng.chance(0.47)
      ? tryScenePlacement(plan, room, rng.fork(`scene-${cluster}`), placementIndex, usedAssets)
      : null;
    if (scene && scene.length > 0) {
      appendPlacements(plan, scene);
      placementIndex += scene.length;
      continue;
    }
    const isolated = tryWallPlacement(
      plan,
      room,
      rng.fork(`wall-${cluster}`),
      placementIndex,
      usedAssets,
    );
    if (isolated) {
      appendPlacements(plan, [isolated]);
      placementIndex += 1;
    }
  }
};

/** Useful for debug panels and generation tests without exposing catalog maps. */
export const propCatalogSize = (): number => PROP_ASSETS.length;
