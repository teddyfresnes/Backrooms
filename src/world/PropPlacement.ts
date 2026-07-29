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
  InteractiveDoorFeature,
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
  chance?: number;
  jitter?: number;
  rotationJitter?: number;
}

interface SceneRecipe {
  id: string;
  minSpan: number;
  slots: readonly SceneSlot[];
}

const polyIds = (...names: string[]): string[] =>
  names.map((name) => `polyhaven:${name}`);
const kenneyFurnitureIds = (...names: string[]): string[] =>
  names.map((name) => `kenney-furniture:${name}`);
const kenneyUrbanIds = (...names: string[]): string[] =>
  names.map((name) => `kenney-urban:${name}`);

const CHAIRS = polyIds(
  'armchair_01',
  'dining_chair_02',
  'greenchair_01',
  'mid_century_lounge_chair',
  'painted_wooden_chair_01',
  'plastic_monobloc_chair_01',
  'schoolchair_01',
  'woodenchair_01',
);
const SOFAS = polyIds('sofa_01', 'sofa_02');
const DESKS = polyIds('metal_office_desk', 'schooldesk_01');
const TABLES = polyIds('woodentable_01', 'woodentable_02');
const SIDE_TABLES = polyIds('side_table_01', 'side_table_tall_01');
const TELEVISIONS = polyIds('television_01', 'television_02');
const SMALL_ELECTRONICS = polyIds(
  'boombox',
  'portable_cassette_player',
  'vintage_radio_transceiver',
);
const STORAGE = polyIds(
  'drawer_cabinet',
  'industrial_storage_cart',
  'modern_wooden_cabinet',
  'painted_wooden_cabinet_02',
  'shelf_01',
  'tool_cart',
  'vintage_cabinet_01',
);
const BOXES = [
  ...polyIds(
    'cardboard_box_01',
    'plastic_crate_02',
    'utility_box_01',
    'utility_box_02',
    'wooden_crate_01',
    'wooden_crate_02',
  ),
  ...kenneyFurnitureIds('cardboardBoxClosed', 'cardboardBoxOpen'),
];
const DESK_CLUTTER = [
  ...kenneyFurnitureIds('books', 'computerKeyboard', 'computerMouse'),
  ...SMALL_ELECTRONICS,
];

const SCENE_RECIPES: readonly SceneRecipe[] = [
  {
    id: 'abandoned-office-corner',
    minSpan: 8,
    slots: [
      { choices: DESKS, x: 0, z: -0.45 },
      { choices: CHAIRS, x: -0.15, z: 0.92, rotation: Math.PI, jitter: 0.14, rotationJitter: 0.16 },
      { choices: TELEVISIONS, x: -0.28, z: -0.48, y: 0.8, scale: 0.72, chance: 0.48 },
      { choices: DESK_CLUTTER, x: 0.34, z: -0.38, y: 0.81, scale: 0.82 },
      { choices: polyIds('desk_lamp_arm_01'), x: 0.58, z: -0.46, y: 0.81, scale: 0.84, chance: 0.62 },
      { choices: BOXES, x: 1.26, z: 0.2, scale: 0.86, chance: 0.78, jitter: 0.16 },
    ],
  },
  {
    id: 'meeting-left-behind',
    minSpan: 8.6,
    slots: [
      { choices: TABLES, x: 0, z: 0, scale: 1.08 },
      { choices: CHAIRS, x: -1.35, z: 0.1, rotation: Math.PI * 0.5, jitter: 0.12 },
      { choices: CHAIRS, x: 1.38, z: -0.12, rotation: -Math.PI * 0.5, jitter: 0.16, rotationJitter: 0.12 },
      { choices: CHAIRS, x: -0.38, z: 1.12, rotation: Math.PI, chance: 0.72, jitter: 0.14 },
      { choices: CHAIRS, x: 0.48, z: -1.18, chance: 0.55, jitter: 0.16, rotationJitter: 0.18 },
      { choices: SMALL_ELECTRONICS, x: 0.2, z: 0.05, y: 0.79, scale: 0.82, chance: 0.62 },
    ],
  },
  {
    id: 'dead-television-corner',
    minSpan: 8.2,
    slots: [
      { choices: polyIds('television_01'), x: 0, z: -1.02, scale: 1.08, rotationJitter: 0.16 },
      { choices: SIDE_TABLES, x: 1.05, z: -0.92, chance: 0.42, jitter: 0.1 },
      { choices: CHAIRS, x: -1.18, z: 0.72, rotation: Math.PI * 0.84, jitter: 0.18, rotationJitter: 0.22 },
      { choices: CHAIRS, x: 0.72, z: 0.92, rotation: Math.PI, chance: 0.58, jitter: 0.2, rotationJitter: 0.22 },
      { choices: SMALL_ELECTRONICS, x: 0.82, z: -0.88, chance: 0.68, jitter: 0.1 },
      { choices: BOXES, x: 1.32, z: 0.18, scale: 0.82, chance: 0.74, jitter: 0.16 },
    ],
  },
  {
    id: 'storage-overflow',
    minSpan: 8.6,
    slots: [
      { choices: STORAGE, x: -1.05, z: -0.78, jitter: 0.12 },
      { choices: STORAGE, x: 0.85, z: -0.72, rotation: Math.PI, chance: 0.62, jitter: 0.16 },
      { choices: BOXES, x: -0.9, z: 0.82, scale: 1.02, jitter: 0.14 },
      { choices: BOXES, x: 0, z: 1.08, scale: 0.82, jitter: 0.14 },
      { choices: BOXES, x: 0.86, z: 0.72, scale: 0.94, chance: 0.8, jitter: 0.18 },
      { choices: kenneyUrbanIds('pallet', 'pallet-small'), x: 1.5, z: 0.02, rotation: 0.22, chance: 0.55 },
    ],
  },
  {
    id: 'abandoned-lounge',
    minSpan: 9,
    slots: [
      { choices: SOFAS, x: 0, z: 1.28, rotation: Math.PI, jitter: 0.12 },
      { choices: SIDE_TABLES, x: 0.08, z: 0.05, jitter: 0.1 },
      { choices: TELEVISIONS, x: 0, z: -1.35, scale: 0.96, chance: 0.78, rotationJitter: 0.12 },
      { choices: CHAIRS, x: 1.62, z: 0.42, rotation: -Math.PI * 0.54, chance: 0.68, jitter: 0.15, rotationJitter: 0.2 },
      { choices: BOXES, x: -1.56, z: 0.18, scale: 0.82, chance: 0.6, jitter: 0.18 },
      { choices: DESK_CLUTTER, x: 0.08, z: 0.05, y: 0.61, scale: 0.82, chance: 0.62 },
    ],
  },
  {
    id: 'maintenance-cache',
    minSpan: 8.8,
    slots: [
      { choices: polyIds('tool_cart', 'industrial_storage_cart'), x: -0.82, z: -0.62, jitter: 0.12 },
      { choices: polyIds('hand_truck'), x: 0.92, z: -0.62, rotation: 0.18, chance: 0.72 },
      { choices: kenneyUrbanIds('pallet', 'pallet-small'), x: -1.02, z: 0.88, rotation: -0.18, chance: 0.72 },
      { choices: kenneyUrbanIds('detail-cables-type-a', 'detail-cables-type-b', 'planks'), x: 0.2, z: 0.92, rotation: 0.14, jitter: 0.16 },
      { choices: kenneyUrbanIds('detail-bricks-type-a', 'detail-bricks-type-b'), x: 1.15, z: 0.78, rotation: -0.12, chance: 0.72 },
      { choices: polyIds('portable_searchlight'), x: -0.28, z: -0.2, chance: 0.64 },
    ],
  },
  {
    id: 'sealed-carton-drop',
    minSpan: 8.2,
    slots: [
      { choices: STORAGE, x: -1.18, z: -0.62, jitter: 0.1 },
      { choices: BOXES, x: -0.72, z: 0.68, scale: 1.08, jitter: 0.18 },
      { choices: BOXES, x: 0.05, z: 0.94, scale: 0.84, jitter: 0.18 },
      { choices: BOXES, x: 0.82, z: 0.72, scale: 0.96, jitter: 0.2 },
      { choices: BOXES, x: 1.28, z: -0.12, scale: 0.74, chance: 0.68, jitter: 0.18 },
      { choices: polyIds('metal_trash_can', 'wetfloorsign_01'), x: 1.15, z: -0.9, chance: 0.52, jitter: 0.14 },
    ],
  },
  {
    id: 'school-office-remnant',
    minSpan: 8.8,
    slots: [
      { choices: DESKS, x: -1.05, z: -0.48, jitter: 0.1 },
      { choices: DESKS, x: 1.05, z: 0.42, rotation: Math.PI, chance: 0.58, jitter: 0.12 },
      { choices: polyIds('schoolchair_01'), x: -1.05, z: 0.72, rotation: Math.PI, jitter: 0.12, rotationJitter: 0.16 },
      { choices: polyIds('schoolchair_01'), x: 1.05, z: -0.82, chance: 0.58, jitter: 0.12, rotationJitter: 0.16 },
      { choices: kenneyFurnitureIds('books'), x: -0.95, z: -0.38, y: 0.81, chance: 0.74 },
      { choices: BOXES, x: 1.48, z: 0.85, scale: 0.82, chance: 0.65, jitter: 0.14 },
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
    .flatMap((feature) =>
      feature.kind === 'raised-zone'
        ? [
            ...(feature.platformRects ?? [feature.platformBounds]),
            ...(feature.ramps ?? [feature.ramp]).map((ramp) => ramp.bounds),
          ]
        : [feature.bounds]
    ),
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
  const colliderScale = definition.colliderScale;
  return {
    id: `prop-collider-${placement.id}`,
    center: {
      x: placement.position.x,
      y: placement.position.y + height * colliderScale.y * 0.5,
      z: placement.position.z,
    },
    halfExtents: {
      x: definition.size.x * placement.scale * colliderScale.x * 0.5,
      y: Math.max(0.18, height * colliderScale.y * 0.5),
      z: definition.size.z * placement.scale * colliderScale.z * 0.5,
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
  'clutter',
  'construction',
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
      tone: rng.float(0.9, 1.02),
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
      for (const slot of recipe.slots) {
        if (slot.chance !== undefined && !rng.chance(slot.chance)) continue;
        const definition = weightedAsset(rng, choicesByIds(slot.choices), localUsed);
        localUsed.add(definition.id);
        const jitter = slot.jitter ?? 0;
        const offset = rotateOffset(
          slot.x + (jitter > 0 ? rng.float(-jitter, jitter) : 0),
          slot.z + (jitter > 0 ? rng.float(-jitter, jitter) : 0),
          angle,
        );
        const scale = (slot.scale ?? 1) * rng.float(0.9, 1.1);
        const rotationJitter = slot.rotationJitter ?? 0.055;
        const rotationY = angle +
          (slot.rotation ?? 0) +
          rng.float(-rotationJitter, rotationJitter);
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
          id: `rare-prop-${placementIndex + candidates.length}`,
          assetId: definition.id,
          roomId: room.id,
          position: { x, y: slot.y ?? 0, z },
          rotationY,
          scale,
          bounds,
          kind: 'scene',
          sceneId: recipe.id,
          tone: rng.float(0.9, 1.02),
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
    if (room.access === 'sealed') return false;
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
  const usedAssets = new Set<string>();
  let placementIndex = 0;
  const objectDoors = plan.features.filter(
    (feature): feature is InteractiveDoorFeature =>
      feature.kind === 'interactive-door' && feature.content === 'object',
  );
  for (const door of objectDoors) {
    const room = plan.rooms.find((candidate) => candidate.id === door.targetRoomId);
    if (!room) continue;
    const placement = tryWallPlacement(
      plan,
      room,
      rng.fork(`door-room:${door.id}`),
      placementIndex,
      usedAssets,
    );
    if (!placement) continue;
    appendPlacements(plan, [placement]);
    placementIndex += 1;
  }

  if (!rng.chance(PROP_CHUNK_PRESENCE_RATE)) return;
  const rooms = rng.shuffle(eligibleRooms(plan));
  if (rooms.length === 0) return;

  const desiredClusters = rng.chance(0.12) ? 2 : 1;
  const usedRooms = new Set<string>();
  for (let cluster = 0; cluster < desiredClusters; cluster += 1) {
    const candidates = rooms.filter((candidate) => !usedRooms.has(candidate.id)).slice(0, 14);
    if (candidates.length === 0) break;
    for (const room of candidates) {
      usedRooms.add(room.id);
      const roomRng = rng.fork(`cluster-${cluster}:${room.id}`);
      const scene = roomRng.chance(0.47)
        ? tryScenePlacement(
            plan,
            room,
            roomRng.fork('scene'),
            placementIndex,
            usedAssets,
          )
        : null;
      if (scene && scene.length > 0) {
        appendPlacements(plan, scene);
        placementIndex += scene.length;
        break;
      }
      const isolated = tryWallPlacement(
        plan,
        room,
        roomRng.fork('wall'),
        placementIndex,
        usedAssets,
      );
      if (isolated) {
        appendPlacements(plan, [isolated]);
        placementIndex += 1;
        break;
      }
    }
  }
};

/** Useful for debug panels and generation tests without exposing catalog maps. */
export const propCatalogSize = (): number => PROP_ASSETS.length;
