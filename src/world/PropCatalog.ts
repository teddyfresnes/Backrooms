export type PropCategory =
  | 'appliance'
  | 'bathroom'
  | 'bed'
  | 'clutter'
  | 'construction'
  | 'electronics'
  | 'lamp'
  | 'plant'
  | 'seating'
  | 'storage'
  | 'table'
  | 'vehicle';

export interface PropAssetDefinition {
  id: string;
  path: string;
  format: 'gltf' | 'obj';
  texturePath?: string;
  category: PropCategory;
  /** Maximum normalized envelope in metres. */
  size: Readonly<{ x: number; y: number; z: number }>;
  collidable: boolean;
  weight: number;
}

type Size = Readonly<{ x: number; y: number; z: number }>;

const asset = (
  id: string,
  path: string,
  category: PropCategory,
  size: Size,
  collidable = true,
  weight = 1,
  extra: Pick<PropAssetDefinition, 'format' | 'texturePath'> = { format: 'gltf' },
): PropAssetDefinition => ({
  id,
  path,
  category,
  size,
  collidable,
  weight,
  ...extra,
});

const furniture = (
  name: string,
  category: PropCategory,
  size: Size,
  collidable = true,
  weight = 1,
): PropAssetDefinition => asset(
  `furniture:${name}`,
  `/assets/models/props/kenney-furniture/${name}.glb`,
  category,
  size,
  collidable,
  weight,
);

const retro = (
  name: string,
  category: PropCategory,
  size: Size,
  collidable = true,
  weight = 1,
): PropAssetDefinition => asset(
  `retro:${name}`,
  `/assets/models/props/kenney-retro-urban/${name}.glb`,
  category,
  size,
  collidable,
  weight,
);

const sameSize = (
  names: readonly string[],
  category: PropCategory,
  size: Size,
  collidable = true,
  weight = 1,
): PropAssetDefinition[] =>
  names.map((name) => furniture(name, category, size, collidable, weight));

const chairSize = { x: 0.72, y: 0.98, z: 0.78 };
const loungeChairSize = { x: 0.92, y: 0.95, z: 1.02 };
const cabinetSize = { x: 1.05, y: 1.85, z: 0.58 };

/**
 * More than a hundred small CC0 models are available to the generator. Most
 * are embedded GLBs, so a chunk downloads only the few files it actually uses.
 */
export const PROP_ASSETS: readonly PropAssetDefinition[] = [
  ...sameSize(
    [
      'chair',
      'chairCushion',
      'chairDesk',
      'chairModernCushion',
      'chairModernFrameCushion',
      'chairRounded',
    ],
    'seating',
    chairSize,
  ),
  ...sameSize(
    [
      'loungeChair',
      'loungeChairRelax',
      'loungeDesignChair',
      'loungeSofaOttoman',
    ],
    'seating',
    loungeChairSize,
  ),
  ...sameSize(
    ['loungeSofa', 'loungeSofaLong', 'loungeDesignSofa'],
    'seating',
    { x: 2.05, y: 1.02, z: 0.98 },
  ),
  ...sameSize(
    ['loungeSofaCorner', 'loungeDesignSofaCorner'],
    'seating',
    { x: 1.48, y: 1.02, z: 1.48 },
  ),
  ...sameSize(['bench', 'benchCushion'], 'seating', { x: 1.75, y: 0.92, z: 0.72 }),
  ...sameSize(['stoolBar', 'stoolBarSquare'], 'seating', { x: 0.54, y: 1.05, z: 0.54 }),

  ...sameSize(
    ['table', 'tableCloth', 'tableCross', 'tableGlass'],
    'table',
    { x: 1.55, y: 0.78, z: 1.05 },
  ),
  ...sameSize(
    ['tableCoffee', 'tableCoffeeGlass', 'tableCoffeeSquare'],
    'table',
    { x: 1.16, y: 0.48, z: 0.78 },
  ),
  ...sameSize(
    ['tableRound', 'tableRoundGlass', 'tableRoundSmall'],
    'table',
    { x: 1.18, y: 0.78, z: 1.18 },
  ),
  ...sameSize(['sideTable', 'sideTableDrawers'], 'table', { x: 0.68, y: 0.66, z: 0.62 }),
  ...sameSize(['desk', 'deskCorner'], 'table', { x: 1.72, y: 0.8, z: 0.82 }),

  ...sameSize(
    [
      'bookcaseClosed',
      'bookcaseClosedDoors',
      'bookcaseOpen',
      'cabinetBed',
      'cabinetBedDrawer',
      'cabinetTelevision',
      'cabinetTelevisionDoors',
    ],
    'storage',
    cabinetSize,
  ),
  ...sameSize(
    ['bookcaseClosedWide', 'bookcaseOpenLow'],
    'storage',
    { x: 1.62, y: 1.28, z: 0.55 },
  ),
  ...sameSize(
    ['bathroomCabinet', 'bathroomCabinetDrawer'],
    'storage',
    { x: 0.9, y: 1.35, z: 0.52 },
  ),
  ...sameSize(
    ['kitchenCabinet', 'kitchenCabinetDrawer', 'kitchenCabinetUpper'],
    'storage',
    { x: 1.05, y: 1.2, z: 0.62 },
  ),
  ...sameSize(
    ['kitchenCabinetCorner', 'kitchenCabinetCornerInner'],
    'storage',
    { x: 1.15, y: 1.2, z: 1.08 },
  ),

  ...sameSize(
    ['bedDouble', 'bedSingle', 'bedBunk'],
    'bed',
    { x: 1.72, y: 1.05, z: 2.18 },
  ),

  ...sameSize(
    ['computerScreen', 'televisionModern', 'televisionVintage'],
    'electronics',
    { x: 0.78, y: 0.68, z: 0.48 },
  ),
  ...sameSize(['speaker', 'speakerSmall'], 'electronics', { x: 0.48, y: 0.82, z: 0.44 }),
  ...sameSize(['radio', 'laptop'], 'electronics', { x: 0.48, y: 0.28, z: 0.34 }, false),
  ...sameSize(
    ['computerKeyboard', 'computerMouse', 'televisionAntenna'],
    'electronics',
    { x: 0.48, y: 0.12, z: 0.28 },
    false,
  ),

  ...sameSize(
    ['lampRoundFloor', 'lampSquareFloor'],
    'lamp',
    { x: 0.54, y: 1.72, z: 0.54 },
  ),
  ...sameSize(
    ['lampRoundTable', 'lampSquareTable'],
    'lamp',
    { x: 0.42, y: 0.72, z: 0.42 },
    false,
  ),

  ...sameSize(
    ['kitchenFridge', 'kitchenFridgeBuiltIn', 'kitchenFridgeSmall'],
    'appliance',
    { x: 0.92, y: 1.86, z: 0.82 },
  ),
  ...sameSize(
    ['kitchenStove', 'kitchenStoveElectric'],
    'appliance',
    { x: 0.86, y: 1.05, z: 0.76 },
  ),
  ...sameSize(
    ['dryer', 'washer'],
    'appliance',
    { x: 0.88, y: 1.02, z: 0.78 },
  ),
  furniture('washerDryerStacked', 'appliance', { x: 0.9, y: 2.02, z: 0.8 }),
  ...sameSize(
    ['kitchenMicrowave', 'kitchenCoffeeMachine', 'kitchenBlender', 'toaster'],
    'appliance',
    { x: 0.52, y: 0.46, z: 0.42 },
    false,
  ),

  furniture('bathtub', 'bathroom', { x: 1.82, y: 0.72, z: 0.9 }),
  furniture('bathroomSink', 'bathroom', { x: 0.82, y: 1.02, z: 0.66 }),
  furniture('toilet', 'bathroom', { x: 0.72, y: 0.88, z: 0.92 }),
  furniture('shower', 'bathroom', { x: 1.02, y: 2.05, z: 1.02 }),

  ...sameSize(
    ['cardboardBoxClosed', 'cardboardBoxOpen'],
    'clutter',
    { x: 0.62, y: 0.58, z: 0.62 },
  ),
  ...sameSize(
    ['books', 'pillow', 'pillowBlue', 'pillowLong', 'bear'],
    'clutter',
    { x: 0.48, y: 0.3, z: 0.48 },
    false,
  ),
  furniture('trashcan', 'clutter', { x: 0.54, y: 0.82, z: 0.54 }),
  ...sameSize(
    ['coatRack', 'coatRackStanding'],
    'clutter',
    { x: 0.62, y: 1.78, z: 0.62 },
  ),

  ...sameSize(['plantSmall1', 'plantSmall2', 'plantSmall3'], 'plant', { x: 0.42, y: 0.62, z: 0.42 }, false),
  furniture('pottedPlant', 'plant', { x: 0.72, y: 1.18, z: 0.72 }),

  retro('detail-bench', 'seating', { x: 1.82, y: 0.9, z: 0.68 }),
  ...[
    'detail-barrier-strong-damaged',
    'detail-barrier-strong-type-a',
    'detail-barrier-strong-type-b',
    'detail-barrier-type-a',
    'detail-barrier-type-b',
  ].map((name) => retro(name, 'construction', { x: 1.65, y: 1.02, z: 0.48 })),
  ...['detail-bricks-type-a', 'detail-bricks-type-b', 'detail-cables-type-a', 'detail-cables-type-b']
    .map((name) => retro(name, 'construction', { x: 1.08, y: 0.34, z: 0.72 }, false)),
  ...['detail-dumpster-closed', 'detail-dumpster-open']
    .map((name) => retro(name, 'construction', { x: 1.88, y: 1.42, z: 1.08 })),
  ...['pallet', 'pallet-small', 'planks']
    .map((name) => retro(name, 'construction', { x: 1.28, y: 0.28, z: 0.9 }, false)),
  retro('scaffolding-structure', 'construction', { x: 2.05, y: 2.35, z: 1.25 }),

  asset(
    'bike:low-poly',
    '/assets/models/props/opengameart-bike/bike.obj',
    'vehicle',
    { x: 1.82, y: 1.2, z: 0.52 },
    true,
    0.65,
    {
      format: 'obj',
      texturePath: '/assets/models/props/opengameart-bike/bike.png',
    },
  ),
  asset(
    'polyhaven:crt-television',
    '/assets/models/props/poly-haven/Television_01/Television_01.gltf',
    'electronics',
    { x: 0.72, y: 0.58, z: 0.62 },
    true,
    0.38,
  ),
  asset(
    'polyhaven:metal-office-desk',
    '/assets/models/props/poly-haven/metal_office_desk/metal_office_desk.gltf',
    'table',
    { x: 1.82, y: 0.82, z: 0.84 },
    true,
    0.3,
  ),
  asset(
    'polyhaven:cassette-player',
    '/assets/models/props/poly-haven/cassette_player/cassette_player.gltf',
    'electronics',
    { x: 0.42, y: 0.24, z: 0.28 },
    false,
    0.35,
  ),
  asset(
    'polyhaven:fire-extinguisher',
    '/assets/models/props/poly-haven/korean_fire_extinguisher_01/korean_fire_extinguisher_01.gltf',
    'construction',
    { x: 0.4, y: 0.9, z: 0.4 },
    true,
    0.34,
  ),
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
