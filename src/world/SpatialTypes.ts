import type { Rect, Vec3Data } from './types';
import type { WalkableSurface } from './WalkableTopology';
import type { SpatialReliefRecord } from './SpatialRelief';
import type { TransitionLayout } from './TransitionLayout';

export interface SpatialAddress { x: number; z: number; story: number }
export interface SpatialPrism {
  id: string;
  /** Four top corners, then four bottom corners, in the shared slab ordering. */
  vertices: number[];
  material: 'wall' | 'ceiling' | 'baseboard' | 'plaster';
  collision: boolean;
  tint?: number;
  /** Hidden contact faces or open owner seams; shared slab face ordering. */
  openFaces?: number[];
}
export interface SpatialDependency {
  owner: SpatialAddress; bounds: Rect; bottom: number; top: number;
  reason: 'atrium' | 'stairs' | 'drop' | 'view';
}
export interface SpatialCellRecord {
  id: string; regionId: string; bounds: Rect; floorY: number;
  mode: 'rooms' | 'gallery' | 'terrace' | 'void' | 'lower-maze';
  atriumOwner?: number;
  atriumLower?: number;
  atriumPerimeter?: 'gallery' | 'stepped';
}
export interface SpatialArchitecture {
  version: 2;
  owner: SpatialAddress;
  cells: SpatialCellRecord[];
  ceilings: WalkableSurface[];
  prisms: SpatialPrism[];
  dependencies: SpatialDependency[];
  interfaces: { id: string; side: 'north' | 'east' | 'south' | 'west'; surfaceId: string; position: Vec3Data; width: number; neighbor: SpatialAddress }[];
  landmarks: { kind: string; position: Vec3Data; destination?: Vec3Data; owner?: SpatialAddress }[];
  transitions?: TransitionLayout[];
  reliefs?: SpatialReliefRecord[];
}
