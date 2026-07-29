export type PropCategory =
  | 'clutter'
  | 'construction'
  | 'electronics'
  | 'lamp'
  | 'seating'
  | 'storage'
  | 'table';

export interface PropAssetDefinition {
  id: string;
  path: string;
  format: 'gltf';
  category: PropCategory;
  /** Maximum normalized envelope in metres. */
  size: Readonly<{ x: number; y: number; z: number }>;
  /** Fraction of the normalized envelope occupied by the simple Rapier box. */
  colliderScale: Readonly<{ x: number; y: number; z: number }>;
  collidable: boolean;
  weight: number;
}

type Size = Readonly<{ x: number; y: number; z: number }>;
type ColliderScale = Readonly<{ x: number; y: number; z: number }>;

const DEFAULT_COLLIDER: ColliderScale = { x: 0.78, y: 0.86, z: 0.78 };

const asset = (
  id: string,
  path: string,
  category: PropCategory,
  size: Size,
  collidable = true,
  weight = 1,
  colliderScale: ColliderScale = DEFAULT_COLLIDER,
): PropAssetDefinition => ({
  id,
  path,
  format: 'gltf',
  category,
  size,
  colliderScale,
  collidable,
  weight,
});

const polyHaven = (
  directory: string,
  file: string,
  category: PropCategory,
  size: Size,
  collidable = true,
  weight = 1,
  colliderScale: ColliderScale = DEFAULT_COLLIDER,
): PropAssetDefinition => asset(
  `polyhaven:${directory}`,
  `/assets/textures/polyhaven/${directory}/${file}`,
  category,
  size,
  collidable,
  weight,
  colliderScale,
);

const kenneyFurniture = (
  name: string,
  category: PropCategory,
  size: Size,
  collidable = false,
  weight = 0.65,
  colliderScale: ColliderScale = DEFAULT_COLLIDER,
): PropAssetDefinition => asset(
  `kenney-furniture:${name}`,
  `/assets/textures/kenney/furniture-kit/Models/GLTF format/${name}.glb`,
  category,
  size,
  collidable,
  weight,
  colliderScale,
);

const kenneyUrban = (
  name: string,
  size: Size,
  collidable = false,
  weight = 0.55,
  colliderScale: ColliderScale = DEFAULT_COLLIDER,
): PropAssetDefinition => asset(
  `kenney-urban:${name}`,
  `/assets/textures/kenney/retro-urban-kit/Models/GLB format/${name}.glb`,
  'construction',
  size,
  collidable,
  weight,
  colliderScale,
);

const CHAIR_COLLIDER: ColliderScale = { x: 0.66, y: 0.82, z: 0.66 };
const TABLE_COLLIDER: ColliderScale = { x: 0.88, y: 0.82, z: 0.72 };
const STORAGE_COLLIDER: ColliderScale = { x: 0.88, y: 0.9, z: 0.82 };
const BOX_COLLIDER: ColliderScale = { x: 0.82, y: 0.82, z: 0.82 };

/**
 * Curated real models only. Large, visible anchors use 1K PBR Poly Haven
 * assets. Kenney remains limited to small clutter and construction fragments
 * whose simpler style does not dominate a room.
 */
export const PROP_ASSETS: readonly PropAssetDefinition[] = [
  polyHaven('armchair_01', 'ArmChair_01_1k.gltf', 'seating', { x: 0.86, y: 1.02, z: 0.92 }, true, 0.75, CHAIR_COLLIDER),
  polyHaven('dining_chair_02', 'dining_chair_02_1k.gltf', 'seating', { x: 0.56, y: 0.94, z: 0.62 }, true, 1.15, CHAIR_COLLIDER),
  polyHaven('greenchair_01', 'GreenChair_01_1k.gltf', 'seating', { x: 0.7, y: 0.92, z: 0.75 }, true, 0.72, CHAIR_COLLIDER),
  polyHaven('mid_century_lounge_chair', 'mid_century_lounge_chair_1k.gltf', 'seating', { x: 0.78, y: 0.88, z: 0.88 }, true, 0.62, CHAIR_COLLIDER),
  polyHaven('painted_wooden_chair_01', 'painted_wooden_chair_01_1k.gltf', 'seating', { x: 0.55, y: 0.94, z: 0.6 }, true, 1.05, CHAIR_COLLIDER),
  polyHaven('plastic_monobloc_chair_01', 'plastic_monobloc_chair_01_1k.gltf', 'seating', { x: 0.58, y: 0.84, z: 0.62 }, true, 0.9, CHAIR_COLLIDER),
  polyHaven('schoolchair_01', 'SchoolChair_01_1k.gltf', 'seating', { x: 0.54, y: 0.82, z: 0.58 }, true, 0.95, CHAIR_COLLIDER),
  polyHaven('woodenchair_01', 'WoodenChair_01_1k.gltf', 'seating', { x: 0.54, y: 0.94, z: 0.58 }, true, 0.9, CHAIR_COLLIDER),
  polyHaven('painted_wooden_bench', 'painted_wooden_bench_1k.gltf', 'seating', { x: 1.72, y: 0.9, z: 0.66 }, true, 0.55, { x: 0.88, y: 0.82, z: 0.66 }),
  polyHaven('sofa_01', 'Sofa_01_1k.gltf', 'seating', { x: 2.12, y: 0.9, z: 0.98 }, true, 0.34, { x: 0.88, y: 0.78, z: 0.76 }),
  polyHaven('sofa_02', 'sofa_02_1k.gltf', 'seating', { x: 2.18, y: 0.86, z: 1.02 }, true, 0.3, { x: 0.88, y: 0.76, z: 0.76 }),

  polyHaven('metal_office_desk', 'metal_office_desk_1k.gltf', 'table', { x: 1.78, y: 0.8, z: 0.82 }, true, 1.15, TABLE_COLLIDER),
  polyHaven('schooldesk_01', 'SchoolDesk_01_1k.gltf', 'table', { x: 0.72, y: 0.8, z: 0.62 }, true, 0.65, TABLE_COLLIDER),
  polyHaven('side_table_01', 'side_table_01_1k.gltf', 'table', { x: 0.62, y: 0.6, z: 0.62 }, true, 0.75, TABLE_COLLIDER),
  polyHaven('side_table_tall_01', 'side_table_tall_01_1k.gltf', 'table', { x: 0.54, y: 0.72, z: 0.54 }, true, 0.5, TABLE_COLLIDER),
  polyHaven('woodentable_01', 'WoodenTable_01_1k.gltf', 'table', { x: 1.65, y: 0.78, z: 0.92 }, true, 0.78, TABLE_COLLIDER),
  polyHaven('woodentable_02', 'WoodenTable_02_1k.gltf', 'table', { x: 1.55, y: 0.78, z: 0.92 }, true, 0.7, TABLE_COLLIDER),

  polyHaven('drawer_cabinet', 'drawer_cabinet_1k.gltf', 'storage', { x: 0.82, y: 1.18, z: 0.52 }, true, 0.85, STORAGE_COLLIDER),
  polyHaven('industrial_storage_cart', 'industrial_storage_cart_1k.gltf', 'storage', { x: 1.18, y: 1.72, z: 0.62 }, true, 0.58, STORAGE_COLLIDER),
  polyHaven('modern_wooden_cabinet', 'modern_wooden_cabinet_1k.gltf', 'storage', { x: 1.1, y: 1.78, z: 0.52 }, true, 0.62, STORAGE_COLLIDER),
  polyHaven('painted_wooden_cabinet_02', 'painted_wooden_cabinet_02_1k.gltf', 'storage', { x: 1.08, y: 1.84, z: 0.54 }, true, 0.78, STORAGE_COLLIDER),
  polyHaven('shelf_01', 'Shelf_01_1k.gltf', 'storage', { x: 1.22, y: 1.9, z: 0.5 }, true, 1.05, STORAGE_COLLIDER),
  polyHaven('tool_cart', 'tool_cart_1k.gltf', 'storage', { x: 0.9, y: 1.02, z: 0.52 }, true, 0.55, STORAGE_COLLIDER),
  polyHaven('vintage_cabinet_01', 'vintage_cabinet_01_1k.gltf', 'storage', { x: 1.16, y: 1.82, z: 0.58 }, true, 0.38, STORAGE_COLLIDER),

  polyHaven('boombox', 'boombox_1k.gltf', 'electronics', { x: 0.58, y: 0.35, z: 0.25 }, false, 0.72),
  polyHaven('portable_cassette_player', 'portable_cassette_player_1k.gltf', 'electronics', { x: 0.34, y: 0.16, z: 0.24 }, false, 0.72),
  polyHaven('television_01', 'Television_01_1k.gltf', 'electronics', { x: 0.76, y: 0.62, z: 0.62 }, true, 1.15, { x: 0.86, y: 0.84, z: 0.82 }),
  polyHaven('television_02', 'television_02_1k.gltf', 'electronics', { x: 0.68, y: 0.58, z: 0.54 }, true, 0.82, { x: 0.86, y: 0.84, z: 0.82 }),
  polyHaven('vintage_radio_transceiver', 'vintage_radio_transceiver_1k.gltf', 'electronics', { x: 0.48, y: 0.3, z: 0.36 }, false, 0.45),

  polyHaven('cardboard_box_01', 'cardboard_box_01_1k.gltf', 'clutter', { x: 0.62, y: 0.5, z: 0.52 }, true, 1.2, BOX_COLLIDER),
  polyHaven('metal_trash_can', 'metal_trash_can_1k.gltf', 'clutter', { x: 0.48, y: 0.72, z: 0.48 }, true, 0.72, BOX_COLLIDER),
  polyHaven('plastic_crate_02', 'plastic_crate_02_1k.gltf', 'clutter', { x: 0.62, y: 0.42, z: 0.46 }, true, 0.85, BOX_COLLIDER),
  polyHaven('utility_box_01', 'utility_box_01_1k.gltf', 'clutter', { x: 0.52, y: 0.46, z: 0.42 }, true, 0.72, BOX_COLLIDER),
  polyHaven('utility_box_02', 'utility_box_02_1k.gltf', 'clutter', { x: 0.58, y: 0.48, z: 0.46 }, true, 0.72, BOX_COLLIDER),
  polyHaven('wetfloorsign_01', 'WetFloorSign_01_1k.gltf', 'clutter', { x: 0.42, y: 0.62, z: 0.42 }, false, 0.42),
  polyHaven('wooden_crate_01', 'wooden_crate_01_1k.gltf', 'clutter', { x: 0.68, y: 0.58, z: 0.62 }, true, 0.88, BOX_COLLIDER),
  polyHaven('wooden_crate_02', 'wooden_crate_02_1k.gltf', 'clutter', { x: 0.62, y: 0.54, z: 0.58 }, true, 0.82, BOX_COLLIDER),
  polyHaven('hand_truck', 'hand_truck_1k.gltf', 'construction', { x: 0.62, y: 1.32, z: 0.58 }, true, 0.42, { x: 0.68, y: 0.8, z: 0.62 }),

  polyHaven('desk_lamp_arm_01', 'desk_lamp_arm_01_1k.gltf', 'lamp', { x: 0.42, y: 0.62, z: 0.42 }, false, 0.72),
  polyHaven('portable_searchlight', 'portable_searchlight_1k.gltf', 'lamp', { x: 0.5, y: 0.55, z: 0.46 }, false, 0.42),

  kenneyFurniture('cardboardBoxClosed', 'clutter', { x: 0.58, y: 0.52, z: 0.58 }, true, 0.44, BOX_COLLIDER),
  kenneyFurniture('cardboardBoxOpen', 'clutter', { x: 0.58, y: 0.55, z: 0.58 }, true, 0.38, BOX_COLLIDER),
  kenneyFurniture('books', 'clutter', { x: 0.42, y: 0.18, z: 0.32 }, false, 0.52),
  kenneyFurniture('computerKeyboard', 'electronics', { x: 0.46, y: 0.08, z: 0.2 }, false, 0.45),
  kenneyFurniture('computerMouse', 'electronics', { x: 0.12, y: 0.07, z: 0.18 }, false, 0.38),

  kenneyUrban('detail-barrier-strong-damaged', { x: 1.62, y: 1, z: 0.46 }, true, 0.32, { x: 0.88, y: 0.82, z: 0.7 }),
  kenneyUrban('detail-bricks-type-a', { x: 1.02, y: 0.3, z: 0.7 }),
  kenneyUrban('detail-bricks-type-b', { x: 1.02, y: 0.3, z: 0.7 }),
  kenneyUrban('detail-cables-type-a', { x: 1.05, y: 0.22, z: 0.68 }),
  kenneyUrban('detail-cables-type-b', { x: 1.05, y: 0.22, z: 0.68 }),
  kenneyUrban('pallet', { x: 1.22, y: 0.2, z: 0.84 }, true, 0.42, { x: 0.86, y: 0.7, z: 0.82 }),
  kenneyUrban('pallet-small', { x: 0.92, y: 0.18, z: 0.68 }, true, 0.38, { x: 0.84, y: 0.7, z: 0.8 }),
  kenneyUrban('planks', { x: 1.34, y: 0.24, z: 0.72 }, false, 0.42),
];

const assetById = new Map(PROP_ASSETS.map((definition) => [definition.id, definition]));

export const getPropAsset = (id: string): PropAssetDefinition => {
  const definition = assetById.get(id);
  if (!definition) throw new Error(`Unknown prop asset: ${id}`);
  return definition;
};

export const propAssetsInCategory = (
  category: PropCategory,
): readonly PropAssetDefinition[] =>
  PROP_ASSETS.filter((definition) => definition.category === category);
