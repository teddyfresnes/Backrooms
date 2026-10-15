import type { Vec3Data } from '../world/types';
import type { MovementMode } from './MovementConfig';
import type { DiagnosticsView } from '../core/Diagnostics';

export interface PlayerMovementDiagnostics extends Vec3Data {
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