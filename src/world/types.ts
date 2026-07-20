export type RoomKind =
  | 'office'
  | 'corridor'
  | 'open-hall'
  | 'nested'
  | 'threshold'
  | 'sparse'
  | 'pit-gallery'
  | 'lower-maze'
  | 'vista-hall';

export interface Rect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface Vec3Data {
  x: number;
  y: number;
  z: number;
}

export interface WallSegment {
  id: string;
  x: number;
  z: number;
  length: number;
  orientation: 'x' | 'z';
  bottom: number;
  height: number;
  thickness: number;
  tint: number;
  collision: boolean;
  kind: 'wallpaper' | 'plaster' | 'vista-frame';
}

export interface StaticCollider {
  id: string;
  center: Vec3Data;
  halfExtents: Vec3Data;
  kind: 'wall' | 'column' | 'floor' | 'step' | 'barrier';
}

export interface RoomRecord {
  id: string;
  bounds: Rect;
  kind: RoomKind;
  level: number;
  ceilingHeight: number;
  detailDensity: number;
}

export interface ColumnSlot {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  tint: number;
}

export interface SolidMass {
  id: string;
  bounds: Rect;
  height: number;
  tint: number;
}

export interface LightSlot {
  id: string;
  x: number;
  /** Absolute ceiling plane used by the fixture. Rendering offsets are applied once in WorldBuilder. */
  ceilingY: number;
  z: number;
  rotation: number;
  width: number;
  intensity: number;
  color: number;
  dead: boolean;
  unstable: boolean;
  phase: number;
  roomId: string;
  level: number;
}

export interface MissingCeilingTile {
  x: number;
  z: number;
  rotation: number;
  hanging: boolean;
}

export interface PitHole extends Rect {
  depth: number;
  kind?: 'drop' | 'void';
  stories?: number;
}

export interface GridPitFeature {
  kind: 'grid-pit';
  id: string;
  roomId: string;
  bounds: Rect;
  holes: PitHole[];
  depth: number;
  pattern:
    | 'single'
    | 'small-grid'
    | 'large-grid'
    | 'dense-grid'
    | 'mixed-grid'
    | 'large-cluster';
  lowerBounds: Rect;
  lowerFloorY: number;
  lowerCeilingY: number;
}

export interface VistaFeature {
  kind: 'impossible-vista';
  id: string;
  aperture: Rect;
  wallX: number;
  centerZ: number;
  openingBottom: number;
  openingHeight: number;
  standardEntryZ: number;
  viewDirection: 1 | -1;
  bounds: Rect;
  height: number;
  destination: Vec3Data;
  returnDestination: Vec3Data;
}

export interface StairSocketFeature {
  kind: 'stair-socket';
  id: string;
  roomId: string;
  bounds: Rect;
  heading: 'x+' | 'x-' | 'z+' | 'z-';
}

export interface SqueezeViewFeature {
  kind: 'squeeze-view';
  id: string;
  roomId: string;
  bounds: Rect;
  axis: 'x' | 'z';
  apertureWidth: number;
}

export type WorldFeature = GridPitFeature | VistaFeature | StairSocketFeature | SqueezeViewFeature;

export interface DetailSocket {
  id: string;
  roomId: string;
  kind: 'item' | 'decal' | 'prop' | 'audio' | 'future-entity';
  position: Vec3Data;
  clearance: number;
  tags: string[];
}

export interface WorldPlan {
  version: number;
  seed: string;
  size: number;
  wallHeight: number;
  rooms: RoomRecord[];
  walls: WallSegment[];
  columns: ColumnSlot[];
  solidMasses: SolidMass[];
  lights: LightSlot[];
  missingCeilingTiles: MissingCeilingTile[];
  features: WorldFeature[];
  detailSockets: DetailSocket[];
  colliders: StaticCollider[];
  floorRects: Rect[];
  /** Canonical apertures cut from this story's walkable floor. */
  floorOpenings?: Rect[];
  /** Serialized so worker-generated chunks do not recompute vertical topology on mount. */
  ceilingOpenings?: Rect[];
  spawn: Vec3Data;
}

export const rectWidth = (rect: Rect): number => rect.maxX - rect.minX;
export const rectDepth = (rect: Rect): number => rect.maxZ - rect.minZ;
export const rectArea = (rect: Rect): number => rectWidth(rect) * rectDepth(rect);
export const rectCenter = (rect: Rect): { x: number; z: number } => ({
  x: (rect.minX + rect.maxX) * 0.5,
  z: (rect.minZ + rect.maxZ) * 0.5,
});

export const pointInRect = (x: number, z: number, rect: Rect, margin = 0): boolean =>
  x >= rect.minX + margin &&
  x <= rect.maxX - margin &&
  z >= rect.minZ + margin &&
  z <= rect.maxZ - margin;
