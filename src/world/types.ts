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

export interface QuaternionData extends Vec3Data {
  w: number;
}

export interface WallSegment {
  id: string;
  /** Owning room for generated architectural continuations such as a raised ceiling shell. */
  roomId?: string;
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
  detail?:
    | 'recess'
    | 'ceiling-drop'
    | 'upper-shell'
    | 'upper-portal-lintel'
    | 'threshold'
    | 'sealed-boundary'
    | 'crawl-lintel'
    | 'crawl-tunnel'
    | 'crawl-flush-wall'
    | 'lower-shell'
    | 'elevation-seal'
    | 'biome-boundary-skin'
    | 'biome-boundary-band';
}

export interface StaticCollider {
  id: string;
  center: Vec3Data;
  halfExtents: Vec3Data;
  kind: 'wall' | 'column' | 'floor' | 'step' | 'barrier';
  rotation?: QuaternionData;
}

export type RoomAccess = 'open' | 'sealed' | 'secret';

export interface RoomRecord {
  id: string;
  bounds: Rect;
  kind: RoomKind;
  level: number;
  ceilingHeight: number;
  detailDensity: number;
  /** Restricted rooms are deliberately removed from the ordinary doorway graph. */
  access?: RoomAccess;
}

export interface ColumnSlot {
  x: number;
  z: number;
  width: number;
  depth: number;
  /** Optional base for columns that continue down into a sunken floor district. */
  bottom?: number;
  height: number;
  tint: number;
  kind?: 'column' | 'pilaster';
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

export type EpicStructureIndex = 1 | 2 | 3 | 4 | 5;

export type EpicStructureVariant =
  | 'endless-abyss'
  | 'lost-ceiling'
  | 'ascending-passages'
  | 'impossible-stairwell'
  | 'vanishing-concourse';

export type EpicPassageSide = 'north' | 'south' | 'west' | 'east';
export type EpicPassagePreviewStyle = 'dead-end' | 'left-turn' | 'right-turn' | 'split';

/** A short, deliberately incomplete corridor visible behind a real opening. */
export interface EpicPassagePreview {
  side: EpicPassageSide;
  /** Horizontal coordinate along the owning facade. */
  along: number;
  width: number;
  /** Walkable projection from the facade into the monumental room. */
  platformDepth: number;
  /** Visible depth behind the facade. Upper previews may be only one metre. */
  corridorDepth: number;
  /** Compact topology shown behind the opening without generating a full maze. */
  previewStyle?: EpicPassagePreviewStyle;
}

export interface EpicPassageLevel {
  /** Local floor height for this row of passages. */
  y: number;
  passages: EpicPassagePreview[];
}

/**
 * A chunk-scale landmark. Its repeated geometry is derived from this compact,
 * serializable contract by EpicStructures and WorldBuilder.
 */
export interface EpicStructureFeature {
  kind: 'epic-structure';
  id: string;
  roomId: string;
  index: EpicStructureIndex;
  variant: EpicStructureVariant;
  bounds: Rect;
  height: number;
  destination: Vec3Data;
  /** epic1 is always open; some epic3 layouts deliberately have no bottom. */
  voidBounds?: Rect;
  /** Facade carrying the portals; its gap to voidBounds is the landing ledge. */
  passageFacadeBounds?: Rect;
  /** Serializable layout shared by the renderer and collider builder. */
  passageLevels?: EpicPassageLevel[];
  /** Logical row used by an elevated epic3 arrival. */
  entryLevel?: number;
  /** Distinguishes the occasional real epic3 abyss from its floored layouts. */
  bottomless?: boolean;
}

export interface StairSocketFeature {
  kind: 'stair-socket';
  id: string;
  roomId: string;
  bounds: Rect;
  heading: 'x+' | 'x-' | 'z+' | 'z-';
  /** Defaults to the compact switchback layout for older serialized plans. */
  layout?: 'switchback' | 'straight';
  /** Switchback flights either touch or are separated by a solid central wall. */
  switchbackJoin?: 'joined' | 'divider';
  /** Local height of the first tread; inherited stairs start one story below. */
  baseY?: number;
  inherited?: boolean;
}

export type SqueezeLayout =
  | 'through'
  | 'side-exits'
  | 'chambers'
  | 'dead-end'
  | 'loop'
  | 'multi-exit'
  | 'left-turn'
  | 'right-turn'
  | 't-junction';

export interface PassageHump {
  platformBounds: Rect;
  elevation: number;
  ramps: [RampSurface, RampSurface];
}

export interface PassageHole extends Rect {
  depth: number;
  /** Missing values in older plans are interpreted as a one-storey drop. */
  kind?: 'drop' | 'void';
  stories?: number;
}

export interface SqueezeViewFeature {
  kind: 'squeeze-view';
  id: string;
  roomId: string;
  bounds: Rect;
  axis: 'x' | 'z';
  apertureWidth: number;
  /** Room networks sit inside a room; wall breaches are carved through a host partition. */
  passageStyle?: 'room-network' | 'wall-breach';
  /** Older wall breaches project around the partition; flush breaches begin directly in it. */
  breachProfile?: 'projecting' | 'flush';
  /** Walkable footprint. Missing values in older plans are interpreted as `[bounds]`. */
  passageRects?: Rect[];
  layout?: SqueezeLayout;
  exitCount?: number;
  clearanceHeight?: number;
  hump?: PassageHump;
  holes?: PassageHole[];
}

export interface RampSurface {
  bounds: Rect;
  axis: 'x' | 'z';
  riseDirection: 1 | -1;
}

export interface RaisedZoneFeature {
  kind: 'raised-zone';
  id: string;
  /** Stable representative room kept for command and legacy integrations. */
  roomId: string;
  /** Every connected room whose carpet shares this elevation. */
  roomIds?: string[];
  /** Ordinary rooms kept clear for the complete run-up to each ramp. */
  approachRoomIds?: string[];
  bounds: Rect;
  /** Legacy representative platform; platformRects describes the complete district. */
  platformBounds: Rect;
  platformRects?: Rect[];
  /** Signed world-space floor offset: positive is raised, negative is sunken. */
  elevation: number;
  /** Legacy representative ramp; ramps describes every district entrance. */
  ramp: RampSurface;
  ramps?: RampSurface[];
}

export type DoorRoomContent = 'empty' | 'message' | 'object' | 'hole' | 'crawl' | 'passage';
export type DoorOpenMode = 'fast' | 'slow';

export interface InteractiveDoorFeature {
  kind: 'interactive-door';
  id: string;
  sourceRoomId: string;
  targetRoomId: string;
  position: Vec3Data;
  orientation: 'x' | 'z';
  width: number;
  height: number;
  /** Direction normal to the closed leaf; the door swings into the destination room. */
  openingDirection: -1 | 1;
  style: 'office-windowed';
  content: DoorRoomContent;
  colliderId: string;
  bounds: Rect;
}

export interface CeilingZone {
  id: string;
  roomIds: string[];
  height: number;
  scale: 'medium' | 'high' | 'vast' | 'colossal';
}

export type WorldFeature =
  | GridPitFeature
  | VistaFeature
  | EpicStructureFeature
  | StairSocketFeature
  | SqueezeViewFeature
  | RaisedZoneFeature
  | InteractiveDoorFeature;

export interface DetailSocket {
  id: string;
  roomId: string;
  kind: 'item' | 'decal' | 'prop' | 'audio' | 'future-entity';
  position: Vec3Data;
  clearance: number;
  tags: string[];
}

export type PropPlacementKind = 'wall' | 'room' | 'scene';

/**
 * A deterministic reference to a lazily loaded decorative model. The compact
 * footprint is also used by generation audits and by the optional physics box.
 */
export interface PropPlacement {
  id: string;
  assetId: string;
  roomId: string;
  position: Vec3Data;
  rotationY: number;
  scale: number;
  bounds: Rect;
  kind: PropPlacementKind;
  sceneId?: string;
  tone: number;
}

export type VisualBiome = 'yellow' | 'red' | 'white';

/**
 * Chunk-wide material variation. These values only affect the appearance of
 * repeated surfaces; topology, collision and light-map coordinates stay
 * unchanged.
 */
export interface SurfaceStyle {
  wallTint: number;
  floorTint: number;
  ceilingTint: number;
  wallPatternScale: number;
  floorPatternScale: number;
  ceilingPatternScale: number;
  floorQuarterTurn: boolean;
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
  /** Rare isolated objects and small multi-object tableaux. */
  propPlacements?: PropPlacement[];
  colliders: StaticCollider[];
  floorRects: Rect[];
  /** Canonical apertures cut from this story's walkable floor. */
  floorOpenings?: Rect[];
  /** Serialized so worker-generated chunks do not recompute vertical topology on mount. */
  ceilingOpenings?: Rect[];
  /** Openings that continue through the compact lower-story preview. */
  lowerPreviewOpenings?: Rect[];
  /** Local stair cages that must pierce this story's drop ceiling. */
  stairCeilingOpenings?: Rect[];
  /** Rare contiguous room bounds whose ceiling circuit is intentionally absent. */
  unlitZones?: Rect[];
  /** Coherent districts where wall and column trims are intentionally absent. */
  baseboardlessZones?: Rect[];
  /** Rooms reserved for strict mirrored architecture rather than generic clutter. */
  symmetryZones?: Rect[];
  /** Small coherent districts that replace wallpaper with bare plaster. */
  plasterZones?: Rect[];
  /** Connected multi-room ceiling districts with one shared absolute height. */
  ceilingZones?: CeilingZone[];
  /** Large-scale visual palette selected independently from room topology. */
  visualBiome?: VisualBiome;
  /** Deterministic per-chunk variation of the principal repeated surfaces. */
  surfaceStyle?: SurfaceStyle;
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
