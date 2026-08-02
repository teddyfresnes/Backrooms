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

export interface StaticCollider {
  id: string;
  center: Vec3Data;
  halfExtents: Vec3Data;
  kind: 'wall' | 'column' | 'floor' | 'step' | 'barrier';
  rotation?: QuaternionData;
}

export type DoorOpenMode = 'fast' | 'slow';

export type VisualBiome = 'yellow' | 'red' | 'white' | 'dim';

export interface WorldPlan {
  version: number;
  seed: string;
  size: number;
  wallHeight: number;
  rooms: unknown[];
  walls: unknown[];
  columns: unknown[];
  solidMasses: unknown[];
  lights: unknown[];
  missingCeilingTiles: unknown[];
  features: unknown[];
  detailSockets: unknown[];
  propPlacements?: unknown[];
  colliders: StaticCollider[];
  floorRects: Rect[];
  floorOpenings?: Rect[];
  ceilingOpenings?: Rect[];
  lowerPreviewOpenings?: Rect[];
  stairCeilingOpenings?: Rect[];
  unlitZones?: Rect[];
  baseboardlessZones?: Rect[];
  symmetryZones?: Rect[];
  plasterZones?: Rect[];
  ceilingZones?: unknown[];
  visualBiome?: VisualBiome;
  surfaceStyle?: unknown;
  spawn: Vec3Data;
}
