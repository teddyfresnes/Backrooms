import type { MovementMode } from '../player/MovementConfig';
import type { Vec3Data } from '../world/types';

export type DiagnosticsCardinalDirection = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export interface DiagnosticsView {
  direction: Vec3Data;
  yaw: number;
  pitch: number;
  cardinal: DiagnosticsCardinalDirection;
}

export interface PlayerDiagnostics extends Vec3Data {
  position: Vec3Data;
  velocity: Vec3Data;
  horizontalSpeed: number;
  verticalSpeed: number;
  horizontalAcceleration: number;
  grounded: boolean;
  airborne: boolean;
  falling: boolean;
  incapacitated: boolean;
  airborneTime: number;
  fallDistance: number;
  moving: boolean;
  sprinting: boolean;
  crouching: boolean;
  sliding: boolean;
  lowPosture: boolean;
  postSpecialRiseLock: number;
  specialCooldown: number;
  noclip: boolean;
  traversing: boolean;
  pointerLocked: boolean;
  movementMode: MovementMode;
  fieldOfView: number;
  turnIntensity: number;
  manualLean: number;
  view: DiagnosticsView;
}

const CARDINAL_DIRECTIONS: readonly DiagnosticsCardinalDirection[] = ['N','NE','E','SE','S','SW','W','NW'];
const degrees = (radians: number): number => radians * 180 / Math.PI;

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
