import type { ChunkCoord, ChunkKey } from '../world/InfiniteWorld';
import type { RoomKind, Vec3Data, VisualBiome } from '../world/types';

export type DiagnosticsCardinalDirection =
  | 'N'
  | 'NE'
  | 'E'
  | 'SE'
  | 'S'
  | 'SW'
  | 'W'
  | 'NW';

export interface DiagnosticsView {
  /** Normalized world-space direction. */
  direction: Vec3Data;
  /** Degrees clockwise from world north (-Z), in the [0, 360) range. */
  yaw: number;
  /** Degrees above (positive) or below (negative) the horizon. */
  pitch: number;
  cardinal: DiagnosticsCardinalDirection;
}

export interface PlayerDiagnostics extends Vec3Data {
  position: Vec3Data;
  velocity: Vec3Data;
  horizontalSpeed: number;
  verticalSpeed: number;
  grounded: boolean;
  moving: boolean;
  sprinting: boolean;
  crouching: boolean;
  noclip: boolean;
  traversing: boolean;
  pointerLocked: boolean;
  view: DiagnosticsView;
}

export interface LookTargetDiagnostics {
  chunkKey: ChunkKey;
  object: string;
  path: string[];
  material: string | null;
  instanceId: number | null;
  distance: number;
  point: Vec3Data;
}

export interface WorldDiagnostics {
  room: RoomKind;
  chunkKey: ChunkKey | null;
  chunk: Readonly<ChunkCoord> | null;
  centerChunkKey: ChunkKey;
  localPosition: Vec3Data | null;
  planSeed: string | null;
  planVersion: number | null;
  biome: string | null;
  visualBiome: VisualBiome | null;
  featureKinds: string[];
  featureIds: string[];
  darkness: number;
}

export interface PerformanceDiagnostics {
  fps: number;
  frameTimeMs: number;
  frame: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  jsHeapUsedMb: number | null;
  jsHeapLimitMb: number | null;
}

export interface QualityDiagnostics {
  preset: 'auto' | 'performance' | 'quality';
  pixelRatio: number;
  devicePixelRatio: number;
  renderScalePercent: number;
  viewport: { width: number; height: number };
  renderBuffer: { width: number; height: number };
  antialias: boolean;
  shadows: boolean;
  lightingMode: string;
}

export interface StreamingDiagnostics {
  chunks: number;
  views: number;
  physicsChunks: number;
  rooms: number;
  lights: number;
  lightSources: number;
  colliders: number;
  props: number;
  pendingChunks: number;
  preparedChunks: number;
  verticalPrefetch: number;
  priorityVerticalPrefetch: number;
  workerMode: 'worker' | 'main-thread';
  workerInFlight: ChunkKey | null;
  pendingStory: ChunkKey | null;
  recoveryChunk: ChunkKey | null;
}

export interface SystemDiagnostics {
  browser: string;
  platform: string;
  language: string;
  cpuThreads: number | null;
  deviceMemoryGb: number | null;
  gpu: string;
  gpuVendor: string;
  webgl: string;
  maxTextureSize: number;
}

export interface DiagnosticsSnapshot {
  ready: boolean;
  updatedAt: number;
  session: {
    title: string;
    seed: string;
    originFingerprint: string;
    generatorVersion: number;
    originFeatures: string[];
  };
  player: PlayerDiagnostics;
  world: WorldDiagnostics;
  target: LookTargetDiagnostics | null;
  performance: PerformanceDiagnostics;
  quality: QualityDiagnostics;
  streaming: StreamingDiagnostics;
  system: SystemDiagnostics;

  // Kept as compact aliases for browser automation and older bug reports.
  seed: string;
  fingerprint: string;
  rooms: number;
  lights: number;
  props: number;
  features: string[];
  fps: number;
  pixelRatio: number;
  drawCalls: number;
  triangles: number;
  chunks: number;
  pendingChunks: number;
  noclip: boolean;
  darkness: number;
}

const CARDINAL_DIRECTIONS: readonly DiagnosticsCardinalDirection[] = [
  'N',
  'NE',
  'E',
  'SE',
  'S',
  'SW',
  'W',
  'NW',
];

const degrees = (radians: number): number => radians * 180 / Math.PI;

/** Converts a view vector to the same stable yaw/pitch convention shown by /logs. */
export const describeViewDirection = (source: Readonly<Vec3Data>): DiagnosticsView => {
  const length = Math.hypot(source.x, source.y, source.z);
  const direction = length > 1e-8
    ? { x: source.x / length, y: source.y / length, z: source.z / length }
    : { x: 0, y: 0, z: -1 };
  const yaw = (degrees(Math.atan2(direction.x, -direction.z)) + 360) % 360;
  const pitch = degrees(Math.asin(Math.min(1, Math.max(-1, direction.y))));
  const cardinal = CARDINAL_DIRECTIONS[Math.round(yaw / 45) % CARDINAL_DIRECTIONS.length]!;
  return { direction, yaw, pitch, cardinal };
};

/** Parses the optional /logs mode while keeping command handling independent from the UI. */
export const resolveDiagnosticsVisibility = (
  current: boolean,
  args: readonly string[],
): boolean | null => {
  if (args.length > 1) return null;
  const mode = args[0]?.toLowerCase();
  if (mode === undefined || mode === 'toggle') return !current;
  if (['on', '1', 'true', 'yes', 'oui'].includes(mode)) return true;
  if (['off', '0', 'false', 'no', 'non'].includes(mode)) return false;
  return null;
};
