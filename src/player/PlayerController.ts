import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { describeViewDirection } from '../core/Diagnostics';
import type { PlayerDiagnostics } from '../core/Diagnostics';
import { InputManager } from '../input/InputManager';
import type { ControlBindings } from '../input/ControlBindings';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import type { DoorOpenMode, QuaternionData, Vec3Data } from '../world/types';
import { MOVEMENT_TUNING, type MovementMode } from './MovementConfig';
import { directionChangeSeverity, expSmoothing, forwardBiasedDiagonalAxes, manualLeanAxis, movementBasisFromYaw, moveSpeedAlongDirection2D, moveTowards2D, normalizedSpeed } from './MovementKinematics';

export interface LandingImpact {
  readonly strength: number;
  readonly impactSpeed: number;
  readonly fallDistance: number;
  readonly airborneTime: number;
  readonly severe: boolean;
}

export interface PlayerCallbacks {
  onLockChange(locked: boolean): void;
  onFootstep(strength: number): void;
  onInteract(mode: DoorOpenMode): void;
  onLand(strength: number, impact?: LandingImpact): void;
  onSafePosition(position: Readonly<Vec3Data>): void;
  onFallReset(): void;
}

interface TraversalState {
  points: THREE.Vector3[];
  cumulativeLengths: number[];
  totalLength: number;
  elapsed: number;
  duration: number;
  duckDepth: number;
  lookQuaternion: THREE.Quaternion;
}

const FIXED_X_AXIS = new THREE.Vector3(1, 0, 0);
const FIXED_Z_AXIS = new THREE.Vector3(0, 0, 1);
const FIXED_Y_AXIS = new THREE.Vector3(0, 1, 0);
const MAX_UNBROKEN_FALL = 48;
const NOCLIP_SPEED = 8.5;
const NOCLIP_SPRINT_SPEED = 22;
const MIN_LOOK_QUATERNION_LENGTH = 1e-8;
const SLOW_INTERACTION_HOLD = 1;
const EPSILON = 1e-6;
// Three PointerLockControls 0.185.1 applies yaw at 0.002 rad per movementX pixel.
// Keep a continuous copy so third-person aiming never depends on wrapped Euler/vector extraction.
const POINTER_LOCK_RADIANS_PER_PIXEL = 0.002;
const DOWNED_LOOK_YAW_LIMIT = THREE.MathUtils.degToRad(24);
const DOWNED_LOOK_PITCH_UP_LIMIT = THREE.MathUtils.degToRad(18);
const DOWNED_LOOK_PITCH_DOWN_LIMIT = THREE.MathUtils.degToRad(24);
const COMBAT_GUARD_LOOK_DOWN_LIMIT = THREE.MathUtils.degToRad(58);

export class PlayerController {
  readonly controls: PointerLockControls;
  readonly position = new THREE.Vector3();
  private readonly lookCamera = new THREE.PerspectiveCamera();
  private readonly input = new InputManager();
  private readonly desired = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly renderForward = new THREE.Vector3();
  private readonly renderRight = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly previousHorizontalVelocity = new THREE.Vector3();
  private readonly previousPosition = new THREE.Vector3();
  private readonly renderedPosition = new THREE.Vector3();
  private readonly lastSafePosition = new THREE.Vector3();
  private readonly slideDirection = new THREE.Vector3();
  private readonly inputDirection = new THREE.Vector3();
  private readonly renderLookQuaternion = new THREE.Quaternion();
  private readonly pitchQuaternion = new THREE.Quaternion();
  private readonly rollQuaternion = new THREE.Quaternion();
  private readonly yawQuaternion = new THREE.Quaternion();
  private readonly lookEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly pointerDocument: Document;
  private readonly pointerElement: HTMLElement;
  private grounded = true;
  private verticalVelocity = -0.5;
  private gaitPhase = 0;
  private previousGaitPhase = 0;
  private stepDistance = 0;
  private moving = false;
  private sprinting = false;
  private sprintSuppressed = false;
  private movementSpeedScale = 1;
  private blockedMotionFraction = 0;
  private crouching = false;
  private crouchRequested = false;
  private targetStrafeLean = 0;
  private targetAccelerationPitch = 0;
  private targetLateralAccelerationLean = 0;
  private motionBlend = 0;
  private cameraBobAmplitude = 0;
  private crouchBlend = 0;
  private previousCapsuleCenterOffset = 0;
  private renderedCapsuleCenterOffset = 0;
  private lowBlend = 0;
  private slideBlend = 0;
  private strafeLean = 0;
  private targetManualLean = 0;
  private manualLean = 0;
  private accelerationPitch = 0;
  private lateralAccelerationLean = 0;
  private lookRoll = 0;
  private lookLift = 0;
  private fastTurnRoll = 0;
  private turnIntensity = 0;
  private turnYawKick = 0;
  private turnPitchKick = 0;
  private traversal?: TraversalState;
  private traversalProgress = 0;
  private previousTraversalProgress = 0;
  private landingKick = 0;
  private landingPitch = 0;
  private landingRecoveryTimer = 0;
  private landingRecoveryStrength = 0;
  private landingRecoveryBlend = 0;
  private collisionPitch = 0;
  private collisionRoll = 0;
  private slideTimer = 0;
  private slideElapsed = 0;
  private postSpecialRiseLockTimer = 0;
  private specialCooldown = 0;
  private lowPosture = false;
  private lowPostureElapsed = 0;
  private groundedTime = 0.2;
  private jumpGroundRearmTimer = 0;
  // Explicit jumps get a short "this was intentional" window so the pit-edge
  // system does not turn ordinary traversal into an accidental ragdoll.
  private deliberateJumpGraceTimer = 0;
  private airborneTime = 0;
  private fallPeakY = 0;
  private fallDistance = 0;
  private falling = false;
  private incapacitated = false;
  private incapacitatedBlend = 0;
  private highFallCameraBlend = 0;
  private noclipEnabled = false;
  private interactionHoldElapsed?: number;
  private interactionHoldTriggered = false;
  private continuousAimYaw = 0;
  private lookActivitySerial = 0;
  private downedLookYawCenter = 0;
  private downedLookPitchCenter = 0;
  private combatGuardLookConstraint = false;
  private readonly combatDriveDirection = new THREE.Vector3();
  private readonly combatDriveTargetDirection = new THREE.Vector3();
  private readonly combatDriveVelocity = new THREE.Vector3();
  private combatDriveTimer = 0;
  private combatDriveDuration = 0;
  private combatDriveElapsed = 0;
  private combatDriveSpeed = 0;
  private combatDriveImpactFraction = 0.48;
  private combatDriveMode: 'strike' | 'impulse' | 'shove' = 'strike';
  private baseFov: number;
  private horizontalAcceleration = 0;
  private targetBodyLagForward = 0;
  private targetBodyLagLateral = 0;
  private bodyLagForward = 0;
  private bodyLagLateral = 0;
  private sprintBurst = 0;
  private landingFovCompression = 0;
  private cameraClock = 0;
  private cameraMotionEnabled = true;
  private fallbackPlaying = false;
  private readonly onFallbackPause = (): void => {
    if (!this.fallbackPlaying) return;
    this.fallbackPlaying = false;
    this.callbacks.onLockChange(false);
  };
  private readonly onFallbackKey = (event: KeyboardEvent): void => {
    if (event.code === 'Escape') this.onFallbackPause();
  };
  private readonly onPointerLock = (): void => {
    this.fallbackPlaying = false;
    this.callbacks.onLockChange(true);
  };
  private readonly onPointerUnlock = (): void => this.callbacks.onLockChange(false);

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    private readonly physics: PhysicsWorld,
    private readonly callbacks: PlayerCallbacks,
  ) {
    this.lookCamera.quaternion.copy(camera.quaternion);
    this.lookCamera.up.copy(camera.up);
    this.syncContinuousAimYawFromLookQuaternion(true);
    this.renderLookQuaternion.copy(camera.quaternion);
    this.controls = new PointerLockControls(this.lookCamera, domElement);
    this.baseFov = camera.fov;
    this.pointerDocument = domElement.ownerDocument;
    this.pointerElement = domElement;
    this.physics.getPosition(this.position);
    this.previousPosition.copy(this.position);
    this.renderedPosition.copy(this.position);
    this.previousCapsuleCenterOffset = this.renderedCapsuleCenterOffset = this.physics.crouchCenterOffset;
    this.anchorSafePosition(this.position);
    this.renderUpdate(0, 1);
    this.controls.addEventListener('lock', this.onPointerLock);
    this.controls.addEventListener('unlock', this.onPointerUnlock);
    this.pointerDocument.addEventListener('mousemove', this.onMouseMove);
    this.pointerDocument.addEventListener('keydown', this.onFallbackKey);
    window.addEventListener('blur', this.onFallbackPause);
  }

  get isLocked(): boolean { return this.controls.isLocked || this.fallbackPlaying; }
  get isTraversing(): boolean { return this.traversal !== undefined; }
  get isNoclipEnabled(): boolean { return this.noclipEnabled; }
  get isIncapacitated(): boolean { return this.incapacitated; }
  get isLandingRecovering(): boolean { return this.landingRecoveryTimer > 0; }
  lock(): void {
    // Starting gameplay must not depend on optional browser pointer capture.
    this.fallbackPlaying = true;
    this.callbacks.onLockChange(true);
    try {
      const request = this.pointerElement.requestPointerLock?.();
      void Promise.resolve(request).catch(() => { /* Keep ordinary mouse controls. */ });
    } catch { /* Embedded browsers may deny pointer capture synchronously. */ }
  }

  setIncapacitated(enabled: boolean): void {
    this.incapacitated = enabled;
    if (!enabled) return;
    this.syncContinuousAimYawFromLookQuaternion(false);
    this.lookEuler.setFromQuaternion(this.lookCamera.quaternion, 'YXZ');
    this.downedLookYawCenter = this.continuousAimYaw;
    this.downedLookPitchCenter = this.lookEuler.x;
    this.velocity.set(0, 0, 0);
    this.previousHorizontalVelocity.set(0, 0, 0);
    this.landingRecoveryTimer = 0;
    this.landingRecoveryStrength = 0;
    this.landingRecoveryBlend = 0;
    this.moving = false;
    this.sprinting = false;
    this.slideTimer = 0;
    this.lowPosture = false;
    this.lowPostureElapsed = 0;
    this.crouchRequested = false;
    this.crouching = false;
    this.physics.setCrouched(false);
    this.targetStrafeLean = 0;
    this.targetManualLean = 0;
    this.combatDriveTimer = 0;
    this.combatDriveDuration = 0;
    this.combatDriveElapsed = 0;
    this.combatDriveSpeed = 0;
    this.combatDriveMode = 'strike';
    this.combatDriveDirection.set(0, 0, 0);
    this.combatDriveTargetDirection.set(0, 0, 0);
    this.combatDriveVelocity.set(0, 0, 0);
  }

  beginLandingRecovery(duration: number, strength: number): void {
    if (this.incapacitated || !this.grounded) return;
    this.landingRecoveryTimer = Math.max(this.landingRecoveryTimer, Math.max(0, duration));
    this.landingRecoveryStrength = Math.max(this.landingRecoveryStrength, THREE.MathUtils.clamp(strength, 0, 1));
    // The landing owns this short grounded phase, but a human does not lose all
    // horizontal momentum in one simulation tick. Keep only a small fraction of
    // the incoming speed so the impact feels heavy rather than like an invisible
    // wall. The recovery branch continues to bleed this residual speed smoothly.
    this.velocity.x *= 0.12;
    this.velocity.z *= 0.12;
    this.previousHorizontalVelocity.set(this.velocity.x, 0, this.velocity.z);
    this.moving = false;
    this.sprinting = false;
    this.targetStrafeLean = 0;
    this.targetAccelerationPitch = 0;
    this.targetLateralAccelerationLean = 0;
    this.targetBodyLagForward = 0;
    this.targetBodyLagLateral = 0;
  }

  setFieldOfView(fieldOfView: number): void {
    this.baseFov = THREE.MathUtils.clamp(fieldOfView, 60, 100);
    if (!this.sprinting && !this.crouching && !this.lowPosture && this.slideTimer <= 0) {
      this.camera.fov = this.baseFov;
      this.camera.updateProjectionMatrix();
    }
  }
  setLookSensitivity(sensitivity: number): void {
    this.controls.pointerSpeed = THREE.MathUtils.clamp(sensitivity, 0.3, 2);
  }
  setCameraMotionEnabled(enabled: boolean): void {
    this.cameraMotionEnabled = enabled;
    if (!enabled) {
      this.lookRoll = 0;
      this.lookLift = 0;
      this.fastTurnRoll = 0;
      this.turnIntensity = 0;
      this.turnYawKick = 0;
      this.turnPitchKick = 0;
      this.targetBodyLagForward = 0;
      this.targetBodyLagLateral = 0;
      this.bodyLagForward = 0;
      this.bodyLagLateral = 0;
      this.sprintBurst = 0;
      this.landingFovCompression = 0;
      this.strafeLean = 0;
      this.targetManualLean = 0;
      this.manualLean = 0;
      this.accelerationPitch = 0;
      this.lateralAccelerationLean = 0;
      this.landingKick = 0;
      this.landingPitch = 0;
      this.collisionPitch = 0;
      this.collisionRoll = 0;
      this.renderLookQuaternion.copy(this.lookCamera.quaternion);
    }
  }
  setInputEnabled(enabled: boolean, preserveMomentum = false): void {
    this.input.setEnabled(enabled);
    if (!enabled) {
      if (!preserveMomentum) {
        this.velocity.set(0, 0, 0);
        this.cancelCombatLunge();
      }
      this.moving = false;
      this.sprinting = false;
      this.targetStrafeLean = 0;
      this.targetManualLean = 0;
      this.manualLean = 0;
      this.targetAccelerationPitch = 0;
      this.targetLateralAccelerationLean = 0;
      this.targetBodyLagForward = 0;
      this.targetBodyLagLateral = 0;
      this.horizontalAcceleration = 0;
    }
  }
  setControlBindings(bindings: ControlBindings): void { this.input.setBindings(bindings); }
  setSprintSuppressed(suppressed: boolean): void {
    this.sprintSuppressed = suppressed;
    if (suppressed) this.sprinting = false;
  }
  setMovementSpeedScale(scale: number): void {
    this.movementSpeedScale = Number.isFinite(scale)
      ? THREE.MathUtils.clamp(scale, 0.55, 1.15)
      : 1;
  }
  isSprintRequested(): boolean { return this.input.axes.sprint; }

  setNoclipEnabled(enabled: boolean): boolean {
    if (this.noclipEnabled === enabled) return this.noclipEnabled;
    this.noclipEnabled = enabled;
    this.resetTransientMovement();
    this.crouchRequested = false;
    this.crouching = false;
    this.anchorSafePosition(this.position);
    this.physics.teleport(this.position);
    this.physics.getPosition(this.position);
    this.previousPosition.copy(this.position);
    this.renderedPosition.copy(this.position);
    this.renderUpdate(0, 1);
    return this.noclipEnabled;
  }
  toggleNoclip(): boolean { return this.setNoclipEnabled(!this.noclipEnabled); }
  getViewDirection(target = new THREE.Vector3()): THREE.Vector3 { return this.controls.getDirection(target); }
  /** The mesh and camera must consume the same interpolated capsule pose. */
  getRenderedFeetPosition(target = new THREE.Vector3()): THREE.Vector3 {
    this.physics.getFeetPosition(target);
    return target.add(this.renderedPosition).sub(this.position);
  }
  /** Read-only movement intent for animation selection; PlayerController remains the sole input owner. */
  getMovementIntent(): { forward: number; right: number; sprint: boolean; crouch: boolean } {
    const axes = this.input.axes;
    return { forward: axes.forward, right: axes.right, sprint: axes.sprint && !this.sprintSuppressed, crouch: axes.crouch };
  }
  /** Read-only control evidence used by the dev pit-stumble model. */
  getPitControlIntent(): { forward: number; right: number; jumpGraceSeconds: number } {
    const axes = this.input.axes;
    return {
      forward: axes.forward,
      right: axes.right,
      jumpGraceSeconds: this.deliberateJumpGraceTimer,
    };
  }
  getLookQuaternion(target = new THREE.Quaternion()): THREE.Quaternion { return target.copy(this.lookCamera.quaternion); }
  /** Unbounded pointer-lock yaw. Body/animation code may follow it but must never write it. */
  getContinuousAimYawRadians(): number { return this.continuousAimYaw; }
  /** Monotonic raw pointer-lock mouse activity counter for AFK/idle logic. */
  getLookActivitySerial(): number { return this.lookActivitySerial; }

  /**
   * Soft melee lock-on. `targetBodyYaw` uses the avatar convention (+Z = 0),
   * while PointerLockControls uses camera forward -Z, hence the PI conversion.
   * The correction is rate-limited and only touches yaw, so the player keeps
   * full pitch control while guard gently tracks the opponent GTA-style.
   */
  focusCombatAimYaw(
    targetBodyYaw: number,
    delta: number,
    response = 13,
    maxDegreesPerSecond = 250,
  ): void {
    if (!Number.isFinite(targetBodyYaw) || !Number.isFinite(delta) || delta <= 0 || this.incapacitated) return;
    const targetLookYawWrapped = Math.atan2(
      Math.sin(targetBodyYaw - Math.PI),
      Math.cos(targetBodyYaw - Math.PI),
    );
    const currentWrapped = Math.atan2(Math.sin(this.continuousAimYaw), Math.cos(this.continuousAimYaw));
    const error = Math.atan2(
      Math.sin(targetLookYawWrapped - currentWrapped),
      Math.cos(targetLookYawWrapped - currentWrapped),
    );
    const responseStep = error * (1 - Math.exp(-Math.max(0.01, response) * delta));
    const maxStep = THREE.MathUtils.degToRad(Math.max(1, maxDegreesPerSecond)) * delta;
    const step = THREE.MathUtils.clamp(responseStep, -maxStep, maxStep);
    if (Math.abs(step) < 1e-7) return;

    this.lookEuler.setFromQuaternion(this.lookCamera.quaternion, 'YXZ');
    this.lookEuler.y += step;
    this.lookEuler.z = 0;
    this.lookCamera.quaternion.setFromEuler(this.lookEuler);
    this.continuousAimYaw += step;
  }

  /**
   * A small collision-safe step adds to live locomotion. It never rotates or
   * replaces the player's existing momentum. Evasions alone use an immediate
   * impulse; strikes begin at zero drive and load before their forward step.
   */
  applyCombatLunge(
    direction: Readonly<Vec3Data>,
    targetSpeed: number,
    durationSeconds = 0.12,
    impactFraction = 0.48,
    mode: 'strike' | 'impulse' | 'shove' = 'strike',
  ): void {
    if (
      this.incapacitated || this.traversal || !this.grounded || this.crouching
      || this.lowPosture || this.slideTimer > 0 || !Number.isFinite(targetSpeed)
    ) return;
    const length = Math.hypot(direction.x, direction.z);
    if (!Number.isFinite(length) || length < 1e-6) return;
    const x = direction.x / length;
    const z = direction.z / length;
    const safeTarget = THREE.MathUtils.clamp(targetSpeed, 0, MOVEMENT_TUNING.locomotion.walkSpeed * 1.58);
    const safeDuration = THREE.MathUtils.clamp(durationSeconds, 0.04, 0.50);
    const freshDrive = this.combatDriveTimer <= 0 || safeDuration >= this.combatDriveTimer - 1e-4;

    this.combatDriveTargetDirection.set(x, 0, z);
    if (freshDrive) {
      // End any old additive step without subtracting its momentum. A fresh
      // action must not resurrect a cached entry vector or reset a live strafe.
      this.combatDriveVelocity.set(0, 0, 0);
      this.combatDriveDirection.copy(this.combatDriveTargetDirection);
      this.combatDriveDuration = safeDuration;
      this.combatDriveElapsed = 0;
      this.combatDriveImpactFraction = THREE.MathUtils.clamp(impactFraction, 0.30, 0.68);
      this.combatDriveSpeed = safeTarget;
      this.combatDriveMode = mode;
    } else {
      this.combatDriveDuration = Math.max(this.combatDriveDuration, safeDuration);
      this.combatDriveSpeed = Math.max(this.combatDriveSpeed, safeTarget);
      this.combatDriveMode = mode;
    }
    this.combatDriveTimer = Math.max(this.combatDriveTimer, safeDuration);
    this.applyCombatDriveVelocity();
  }

  /** Cancel only the attack-authored drive. Existing world velocity is kept so
   * taking a hit does not teleport/stop the capsule, but an interrupted punch
   * can no longer continue pushing the player through its old lunge envelope. */
  cancelCombatLunge(): void {
    this.combatDriveTimer = 0;
    this.combatDriveDuration = 0;
    this.combatDriveElapsed = 0;
    this.combatDriveSpeed = 0;
    this.combatDriveVelocity.set(0, 0, 0);
  }

  /**
   * Retarget only the small additive step. Live input and existing locomotion
   * retain their own direction throughout the attack.
   */
  retargetCombatLunge(direction: Readonly<Vec3Data>, targetSpeed: number): void {
    if (
      this.combatDriveTimer <= 0 || this.incapacitated || this.traversal
      || !this.grounded || this.crouching || this.lowPosture || this.slideTimer > 0
      || !Number.isFinite(targetSpeed)
    ) return;
    const length = Math.hypot(direction.x, direction.z);
    if (!Number.isFinite(length) || length < 1e-6) return;
    this.combatDriveTargetDirection.set(direction.x / length, 0, direction.z / length);
    this.combatDriveSpeed = THREE.MathUtils.clamp(
      targetSpeed,
      0,
      MOVEMENT_TUNING.locomotion.walkSpeed * 1.58,
    );
    this.applyCombatDriveVelocity();
  }

  private combatDrivePhase(): number {
    if (this.combatDriveDuration <= 1e-5) return 1;
    return THREE.MathUtils.clamp(this.combatDriveElapsed / this.combatDriveDuration, 0, 1);
  }

  private combatDriveEnvelope(phase = this.combatDrivePhase()): number {
    if (this.combatDriveMode === 'impulse') return 1;
    const impact = THREE.MathUtils.clamp(this.combatDriveImpactFraction, 0.30, 0.68);
    const loadEnd = Math.max(0.10, impact - 0.24);
    const peakStart = Math.max(loadEnd + 0.04, impact - 0.075);
    const peakEnd = Math.min(0.84, impact + 0.075);
    const brakeEnd = Math.min(1, impact + 0.30);
    if (phase <= loadEnd) {
      return THREE.MathUtils.lerp(0, 0.35, THREE.MathUtils.smoothstep(phase, 0, loadEnd));
    }
    if (phase < peakStart) {
      return THREE.MathUtils.lerp(0.35, 1, THREE.MathUtils.smoothstep(phase, loadEnd, peakStart));
    }
    if (phase <= peakEnd) return 1;
    if (phase < brakeEnd) {
      return THREE.MathUtils.lerp(1, 0.18, THREE.MathUtils.smoothstep(phase, peakEnd, brakeEnd));
    }
    return THREE.MathUtils.lerp(0.18, 0, THREE.MathUtils.smoothstep(phase, brakeEnd, 1));
  }

  private removeCombatDriveVelocity(): void {
    this.velocity.sub(this.combatDriveVelocity);
    this.combatDriveVelocity.set(0, 0, 0);
  }

  private applyCombatDriveVelocity(): void {
    if (this.combatDriveTimer <= 0) return;
    this.removeCombatDriveVelocity();
    if (this.combatDriveMode === 'impulse') {
      this.combatDriveDirection.copy(this.combatDriveTargetDirection);
      this.velocity.x = this.combatDriveDirection.x * this.combatDriveSpeed;
      this.velocity.z = this.combatDriveDirection.z * this.combatDriveSpeed;
      return;
    }

    const phase = this.combatDrivePhase();
    this.combatDriveDirection.copy(this.combatDriveTargetDirection);
    if (this.combatDriveMode === 'shove') {
      // External contact adds recoil to live lateral momentum. KCC resolves the
      // displacement against walls and the other capsule on every frame.
      this.combatDriveVelocity.copy(this.combatDriveDirection)
        .multiplyScalar(this.combatDriveSpeed * Math.sin(Math.PI * Math.min(1, phase)));
      this.velocity.add(this.combatDriveVelocity);
      return;
    }
    const driveSpeed = this.combatDriveSpeed * this.combatDriveEnvelope(phase);
    const forwardSpeed = this.velocity.dot(this.combatDriveDirection);
    // Never pull a deliberately retreating player toward their opponent. A
    // forward approach already supplies the step; adding it again causes skating.
    const retreating = this.inputDirection.dot(this.combatDriveDirection) < -0.15 || forwardSpeed < -0.30;
    const addedSpeed = retreating ? 0 : Math.max(0, driveSpeed - Math.max(0, forwardSpeed));
    this.combatDriveVelocity.copy(this.combatDriveDirection).multiplyScalar(addedSpeed);
    this.velocity.add(this.combatDriveVelocity);
  }

  private updateCombatDrive(delta: number): void {
    if (this.combatDriveTimer <= 0) return;
    if (this.incapacitated || this.traversal || !this.grounded || this.crouching || this.lowPosture || this.slideTimer > 0) {
      this.combatDriveTimer = 0;
      this.combatDriveDuration = 0;
      this.combatDriveElapsed = 0;
      this.combatDriveSpeed = 0;
      this.combatDriveVelocity.set(0, 0, 0);
      this.combatDriveImpactFraction = 0.48;
      this.combatDriveMode = 'strike';
      return;
    }
    const safeDelta = Math.max(0, delta);
    this.combatDriveElapsed += safeDelta;
    this.applyCombatDriveVelocity();
    this.combatDriveTimer = Math.max(0, this.combatDriveTimer - safeDelta);
    if (this.combatDriveTimer <= 0) {
      this.combatDriveDuration = 0;
      this.combatDriveElapsed = 0;
      this.combatDriveSpeed = 0;
      this.combatDriveVelocity.set(0, 0, 0);
      this.combatDriveImpactFraction = 0.48;
      this.combatDriveMode = 'strike';
    }
  }

  /**
   * Restrict only the extreme downward part of first-person look while combat guard is up.
   * PointerLockControls owns raw mouse look, so changing its polar bound avoids a second
   * competing mouse handler and restores the full range immediately when guard drops.
   */
  setCombatGuardLookConstraint(enabled: boolean): void {
    if (this.combatGuardLookConstraint === enabled) return;
    this.combatGuardLookConstraint = enabled;
    this.controls.minPolarAngle = 0;
    this.controls.maxPolarAngle = enabled
      ? Math.PI * 0.5 + COMBAT_GUARD_LOOK_DOWN_LIMIT
      : Math.PI;
    if (!enabled) return;

    // If guard is raised while already staring almost straight down, clamp immediately
    // instead of waiting for the next mouse event. Preserve yaw exactly.
    this.lookEuler.setFromQuaternion(this.lookCamera.quaternion, 'YXZ');
    const minimumPitch = -COMBAT_GUARD_LOOK_DOWN_LIMIT;
    if (this.lookEuler.x >= minimumPitch) return;
    this.lookEuler.set(minimumPitch, this.lookEuler.y, 0, 'YXZ');
    this.lookCamera.quaternion.setFromEuler(this.lookEuler);
    this.syncContinuousAimYawFromLookQuaternion(false);
    this.renderLookQuaternion.copy(this.lookCamera.quaternion);
    this.lookRoll = 0;
    this.lookLift = 0;
    this.turnPitchKick = 0;
  }

  setLookQuaternion(quaternion: Readonly<QuaternionData>): boolean {
    const { x, y, z, w } = quaternion;
    if (![x, y, z, w].every(Number.isFinite)) return false;
    const length = Math.hypot(x, y, z, w);
    if (!Number.isFinite(length) || length < MIN_LOOK_QUATERNION_LENGTH) return false;
    this.lookCamera.quaternion.set(x / length, y / length, z / length, w / length);
    this.syncContinuousAimYawFromLookQuaternion(false);
    this.renderLookQuaternion.copy(this.lookCamera.quaternion);
    this.traversal?.lookQuaternion.copy(this.lookCamera.quaternion);
    this.lookRoll = 0;
    this.lookLift = 0;
    this.fastTurnRoll = 0;
    this.turnIntensity = 0;
    this.turnYawKick = 0;
    this.turnPitchKick = 0;
    this.targetStrafeLean = 0;
    this.strafeLean = 0;
    this.targetManualLean = 0;
    this.manualLean = 0;
    this.pitchQuaternion.identity();
    this.rollQuaternion.identity();
    this.renderUpdate(0, 1);
    return true;
  }

  getDebugState(): PlayerDiagnostics {
    const view = describeViewDirection(this.getViewDirection());
    const verticalSpeed = this.noclipEnabled ? 0 : this.verticalVelocity;
    return {
      x: this.position.x, y: this.position.y, z: this.position.z,
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      velocity: { x: this.velocity.x, y: verticalSpeed, z: this.velocity.z },
      horizontalSpeed: Math.hypot(this.velocity.x, this.velocity.z),
      verticalSpeed,
      horizontalAcceleration: this.horizontalAcceleration,
      grounded: this.grounded,
      airborne: !this.grounded,
      falling: this.falling,
      incapacitated: this.incapacitated,
      airborneTime: this.airborneTime,
      fallDistance: this.fallDistance,
      moving: this.moving,
      sprinting: this.sprinting,
      crouching: this.crouching,
      sliding: this.slideTimer > 0,
      lowPosture: this.lowPosture,
      postSpecialRiseLock: this.postSpecialRiseLockTimer,
      specialCooldown: this.specialCooldown,
      noclip: this.noclipEnabled,
      traversing: this.isTraversing,
      pointerLocked: this.isLocked,
      movementMode: this.getMovementMode(),
      fieldOfView: this.camera.fov,
      turnIntensity: this.turnIntensity,
      manualLean: this.manualLean,
      view,
    };
  }

  teleport(destination: Vec3Data): void {
    this.incapacitated = false;
    this.incapacitatedBlend = 0;
    this.highFallCameraBlend = 0;
    this.resetTransientMovement();
    this.motionBlend = 0;
    this.physics.teleport(destination);
    this.physics.getPosition(this.position);
    this.previousPosition.copy(this.position);
    this.renderedPosition.copy(this.position);
    this.anchorSafePosition(this.position);
    this.renderLookQuaternion.copy(this.lookCamera.quaternion);
    this.renderUpdate(0, 1);
  }

  private resetTransientMovement(): void {
    this.traversal = undefined;
    this.traversalProgress = 0;
    this.previousTraversalProgress = 0;
    this.velocity.set(0, 0, 0);
    this.previousHorizontalVelocity.set(0, 0, 0);
    this.verticalVelocity = -0.5;
    this.grounded = true;
    this.groundedTime = 0.2;
    this.jumpGroundRearmTimer = 0;
    this.deliberateJumpGraceTimer = 0;
    this.landingRecoveryTimer = 0;
    this.landingRecoveryStrength = 0;
    this.landingRecoveryBlend = 0;
    this.airborneTime = 0;
    this.fallPeakY = this.position.y;
    this.fallDistance = 0;
    this.falling = false;
    this.moving = false;
    this.sprinting = false;
    this.targetStrafeLean = 0;
    this.targetManualLean = 0;
    this.manualLean = 0;
    this.targetAccelerationPitch = 0;
    this.targetLateralAccelerationLean = 0;
    this.targetBodyLagForward = 0;
    this.targetBodyLagLateral = 0;
    this.bodyLagForward = 0;
    this.bodyLagLateral = 0;
    this.horizontalAcceleration = 0;
    this.slideTimer = 0;
    this.slideElapsed = 0;
    this.postSpecialRiseLockTimer = 0;
    this.specialCooldown = 0;
    this.lowPosture = false;
    this.lowPostureElapsed = 0;
    this.landingKick = 0;
    this.landingPitch = 0;
    this.landingFovCompression = 0;
    this.highFallCameraBlend = 0;
    this.collisionPitch = 0;
    this.collisionRoll = 0;
    this.sprintBurst = 0;
    this.combatDriveTimer = 0;
    this.combatDriveDuration = 0;
    this.combatDriveElapsed = 0;
    this.combatDriveSpeed = 0;
    this.combatDriveVelocity.set(0, 0, 0);
  }

  private anchorSafePosition(position: Readonly<Vec3Data>): void {
    this.lastSafePosition.set(position.x, position.y, position.z);
    this.callbacks.onSafePosition(this.lastSafePosition);
  }

  beginTraversal(destinationOrPath: Vec3Data | readonly Vec3Data[], duration = 0.72, duckDepth = 0.34): boolean {
    if (this.traversal) return false;
    const requested = Array.isArray(destinationOrPath) ? destinationOrPath : [destinationOrPath];
    const points = [
      this.position.clone(),
      ...requested
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z))
        .map((point) => new THREE.Vector3(point.x, point.y, point.z)),
    ];
    if (points.length < 2) return false;
    const cumulativeLengths = [0];
    for (let index = 1; index < points.length; index += 1) {
      cumulativeLengths.push(cumulativeLengths[index - 1]! + points[index - 1]!.distanceTo(points[index]!));
    }
    const totalLength = cumulativeLengths[cumulativeLengths.length - 1]!;
    if (totalLength < 0.001) return false;
    this.traversal = {
      points, cumulativeLengths, totalLength, elapsed: 0, duration: Math.max(0.2, duration),
      duckDepth: Math.max(0, duckDepth), lookQuaternion: this.lookCamera.quaternion.clone(),
    };
    this.traversalProgress = 0;
    this.previousTraversalProgress = 0;
    this.velocity.set(0, 0, 0);
    this.verticalVelocity = -0.5;
    this.moving = false;
    this.sprinting = false;
    this.slideTimer = 0;
    this.lowPosture = false;
    this.lowPostureElapsed = 0;
    return true;
  }

  fixedUpdate(delta: number): void {
    this.previousPosition.copy(this.position);
    this.previousCapsuleCenterOffset = this.physics.crouchCenterOffset;
    this.previousGaitPhase = this.gaitPhase;
    this.previousTraversalProgress = this.traversalProgress;
    this.previousHorizontalVelocity.set(this.velocity.x, 0, this.velocity.z);
    const wasSprinting = this.sprinting;

    if (!this.isLocked) {
      this.consumeInactiveActions();
      this.velocity.multiplyScalar(0.82);
      this.moving = false;
      this.sprinting = false;
      this.horizontalAcceleration = 0;
      this.targetStrafeLean = 0;
      this.targetManualLean = 0;
      this.targetAccelerationPitch = 0;
      this.targetLateralAccelerationLean = 0;
      this.targetBodyLagForward = 0;
      this.targetBodyLagLateral = 0;
      return;
    }

    this.targetManualLean = manualLeanAxis(
      this.input.isPressed('KeyA'),
      this.input.isPressed('KeyE'),
    );

    if (this.noclipEnabled) {
      this.consumeInactiveActions();
      this.updateNoclip(delta);
      return;
    }

    this.updateInteraction(delta);

    if (this.traversal) {
      this.updateTraversal(delta);
      return;
    }

    if (this.incapacitated) {
      this.input.consumeActionPress('crouch');
      this.input.consumeActionPress('jump');
      this.velocity.set(0, 0, 0);
      this.moving = false;
      this.sprinting = false;
      this.horizontalAcceleration = 0;
      this.targetStrafeLean = 0;
      this.targetManualLean = 0;
      this.verticalVelocity = -0.9;
      this.grounded = true;
      this.falling = false;
      this.airborneTime = 0;
      this.fallDistance = 0;
      return;
    }

    this.postSpecialRiseLockTimer = Math.max(0, this.postSpecialRiseLockTimer - delta);
    this.jumpGroundRearmTimer = Math.max(0, this.jumpGroundRearmTimer - delta);
    this.deliberateJumpGraceTimer = Math.max(0, this.deliberateJumpGraceTimer - delta);
    this.specialCooldown = Math.max(0, this.specialCooldown - delta);
    this.landingRecoveryTimer = Math.max(0, this.landingRecoveryTimer - delta);
    if (this.landingRecoveryTimer <= 0) this.landingRecoveryStrength = 0;

    if (this.landingRecoveryTimer > 0) {
      // Keep contact resolution alive while the authored landing plays. Input is
      // temporarily suppressed, but the tiny retained horizontal momentum is
      // allowed to continue and decays instead of snapping to zero.
      this.input.consumeActionPress('crouch');
      this.input.consumeActionPress('jump');
      const landingDrag = Math.exp(-Math.max(0, delta) * 2.8);
      this.velocity.x *= landingDrag;
      this.velocity.z *= landingDrag;
      this.verticalVelocity = -0.9;
      const recoveryMove = this.physics.move({
        x: this.velocity.x * delta,
        y: this.verticalVelocity * delta,
        z: this.velocity.z * delta,
      });
      this.position.copy(recoveryMove.position);
      this.grounded = recoveryMove.grounded;
      this.groundedTime = this.grounded ? this.groundedTime + delta : 0;
      this.moving = false;
      this.sprinting = false;
      this.horizontalAcceleration = 0;
      this.targetStrafeLean = 0;
      this.targetAccelerationPitch = 0;
      this.targetLateralAccelerationLean = 0;
      this.targetBodyLagForward = 0;
      this.targetBodyLagLateral = 0;
      if (this.grounded) this.anchorSafePosition(this.position);
      return;
    }
    if (this.lowPosture) this.lowPostureElapsed += delta;
    else this.lowPostureElapsed = 0;

    const axes = this.input.axes;
    const sprintRequested = !this.sprintSuppressed
      && axes.sprint
      && axes.forward >= MOVEMENT_TUNING.locomotion.sprintForwardMin;
    const diagonalAxes = forwardBiasedDiagonalAxes(
      axes.forward,
      axes.right,
      MOVEMENT_TUNING.locomotion.forwardDiagonalStrafeScale,
    );
    const movementRightAxis = sprintRequested
      ? axes.right * MOVEMENT_TUNING.locomotion.sprintStrafeScale
      : diagonalAxes.right;
    const crouchPressed = this.input.consumeActionPress('crouch');
    const jumpRequested = this.input.consumeActionPress('jump');

    this.updateBasis();
    // Sprint is forward-led: backward/side-only input stays at walk speed.
    // Q/D remain available during a forward sprint, but their contribution is
    // deliberately reduced so sprint still reads as a committed forward launch.
    // Movement is always camera-relative and owned exclusively by PlayerController.
    // Rendering/animation code is not allowed to buffer, scale, rotate, or rewrite Z/Q/S/D.
    this.buildInputDirection(diagonalAxes.forward, movementRightAxis);

    if (
      this.lowPosture
      && this.grounded
      && sprintRequested
      && this.postSpecialRiseLockTimer <= 0
      && axes.forward >= MOVEMENT_TUNING.posture.sprintRiseForwardThreshold
      && this.lowPostureElapsed >= MOVEMENT_TUNING.posture.lowAutoRiseDelay
    ) {
      this.tryExitLowPosture(true);
    }

    // Sprint is also an explicit stand intent from an ordinary crouch. This is
    // ceiling-safe because PhysicsWorld keeps the capsule crouched if there is
    // not enough room to expand.
    if (
      !this.lowPosture
      && this.grounded
      && this.slideTimer <= 0
      && this.postSpecialRiseLockTimer <= 0
      && sprintRequested
      && axes.forward >= MOVEMENT_TUNING.posture.sprintRiseForwardThreshold
      && (this.crouching || this.crouchRequested)
    ) {
      this.tryStandFromCrouch(true);
    }

    let crouchHandled = false;
    if (crouchPressed && this.lowPosture && this.slideTimer <= 0) {
      if (
        this.postSpecialRiseLockTimer <= 0
        && this.lowPostureElapsed >= MOVEMENT_TUNING.posture.lowManualRiseDelay
      ) this.tryExitLowPosture(false);
      crouchHandled = true;
    }

    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const canSlide = !crouchHandled
      && this.grounded
      && this.groundedTime >= MOVEMENT_TUNING.posture.groundedSpecialGrace
      && !this.lowPosture
      && this.postSpecialRiseLockTimer <= 0
      && this.specialCooldown <= 0
      && sprintRequested
      && axes.forward > 0
      && horizontalSpeed >= MOVEMENT_TUNING.slide.minStartSpeed;

    if (crouchPressed && canSlide && this.slideTimer <= 0) {
      this.startSlide(horizontalSpeed);
    } else if (crouchPressed && !crouchHandled && this.slideTimer <= 0) {
      this.crouchRequested = !this.crouchRequested;
    }

    if (this.slideTimer > 0) {
      if (jumpRequested && this.slideElapsed >= MOVEMENT_TUNING.slide.minDuration) this.launchSlideJump();
      else this.updateSlide(delta);
    }

    if (this.slideTimer <= 0) {
      this.crouching = this.physics.setCrouched(this.lowPosture || this.crouchRequested);
      if (this.grounded && jumpRequested && !this.lowPosture && this.jumpGroundRearmTimer <= 0) this.startJump();
      // Remove only last tick's authored step before normal locomotion runs.
      // Otherwise the small addition would accumulate on every physics tick.
      this.removeCombatDriveVelocity();
      this.updateHorizontalVelocity(
        delta,
        sprintRequested && this.postSpecialRiseLockTimer <= 0,
        movementRightAxis,
      );
      this.updateCombatDrive(delta);
    }

    this.verticalVelocity -= MOVEMENT_TUNING.locomotion.gravity * delta;
    this.verticalVelocity = Math.max(this.verticalVelocity, -MOVEMENT_TUNING.locomotion.terminalFallSpeed);
    const impactVelocity = this.verticalVelocity;
    const wasGrounded = this.grounded;
    const intendedX = this.velocity.x * delta;
    const intendedZ = this.velocity.z * delta;

    const result = this.physics.move({
      x: intendedX,
      y: this.verticalVelocity * delta,
      z: intendedZ,
    });
    this.position.copy(result.position);
    this.grounded = result.grounded;
    this.groundedTime = this.grounded ? (wasGrounded ? this.groundedTime + delta : 0) : 0;

    const horizontalDistance = Math.hypot(result.moved.x, result.moved.z);
    this.blockedMotionFraction = 0;
    this.handleBlockedMotion(delta, intendedX, intendedZ, result.moved.x, result.moved.z);
    // Only a collision may trim the recorded additive step. A free strafe can
    // oppose one component of that step; it still has to be removed next tick,
    // otherwise that component accumulates and silently brakes the orbit.
    if (this.blockedMotionFraction >= MOVEMENT_TUNING.collision.hardBlockFraction) {
      for (const axis of ['x', 'z'] as const) {
        const drive = this.combatDriveVelocity[axis];
        this.combatDriveVelocity[axis] = drive * this.velocity[axis] > 0
          ? Math.sign(drive) * Math.min(Math.abs(drive), Math.abs(this.velocity[axis]))
          : 0;
      }
    }

    const wasTrackingAirborne = this.airborneTime > 0;
    if (!this.grounded) {
      if (!wasTrackingAirborne) {
        this.airborneTime = delta;
        this.fallPeakY = this.position.y;
        this.fallDistance = 0;
      } else {
        this.airborneTime += delta;
        this.fallPeakY = Math.max(this.fallPeakY, this.position.y);
        this.fallDistance = Math.max(this.fallDistance, this.fallPeakY - this.position.y);
      }
      this.falling = this.verticalVelocity < -0.65 && this.fallDistance > 0.04;
    } else {
      if (wasTrackingAirborne && this.airborneTime >= 0.045) {
        this.jumpGroundRearmTimer = Math.max(
          this.jumpGroundRearmTimer,
          MOVEMENT_TUNING.locomotion.jumpGroundRearmSeconds,
        );
        this.handleLanding(impactVelocity, this.fallDistance, this.airborneTime);
      }
      this.airborneTime = 0;
      this.fallPeakY = this.position.y;
      this.fallDistance = 0;
      this.falling = false;
      // Once a normal jump has landed, keep only a tiny residual grace instead
      // of making the player immune to edge mistakes for the rest of the 1.8 s.
      this.deliberateJumpGraceTimer = Math.min(this.deliberateJumpGraceTimer, 0.22);
      if (this.verticalVelocity < 0) this.verticalVelocity = -0.9;
      this.anchorSafePosition(this.position);
    }

    this.moving = horizontalDistance > 0.00015 && this.grounded;
    this.sprinting = sprintRequested
      && axes.forward > 0
      && !this.crouching
      && !this.lowPosture
      && this.moving
      && this.blockedMotionFraction < MOVEMENT_TUNING.collision.sprintCancelBlockFraction
      && this.slideTimer <= 0
      && this.postSpecialRiseLockTimer <= 0;

    if (!wasSprinting && this.sprinting) this.sprintBurst = Math.max(this.sprintBurst, 1);

    const referenceSpeed = this.sprinting ? MOVEMENT_TUNING.locomotion.sprintSpeed : MOVEMENT_TUNING.locomotion.walkSpeed;
    this.targetStrafeLean = this.moving
      ? THREE.MathUtils.clamp(this.velocity.dot(this.right) / Math.max(1, referenceSpeed), -1, 1)
      : 0;

    this.updateAccelerationCameraTargets(delta);
    this.updateGait(horizontalDistance);

    if (this.position.y < this.lastSafePosition.y - MAX_UNBROKEN_FALL) {
      this.physics.teleport(this.lastSafePosition);
      this.physics.getPosition(this.position);
      this.previousPosition.copy(this.position);
      this.resetTransientMovement();
      this.callbacks.onFallReset();
    }
  }

  private consumeInactiveActions(): void {
    this.input.consumeActionPress('interact');
    this.input.consumeActionRelease('interact');
    this.interactionHoldElapsed = undefined;
    this.interactionHoldTriggered = false;
    this.input.consumeActionPress('jump');
    this.input.consumeActionPress('crouch');
  }

  private updateInteraction(delta: number): void {
    if (this.input.consumeActionPress('interact')) {
      this.interactionHoldElapsed = 0;
      this.interactionHoldTriggered = false;
    }
    if (this.interactionHoldElapsed !== undefined && this.input.isActionPressed('interact')) {
      this.interactionHoldElapsed += delta;
      if (!this.interactionHoldTriggered && this.interactionHoldElapsed >= SLOW_INTERACTION_HOLD) {
        this.interactionHoldTriggered = true;
        this.callbacks.onInteract('slow');
      }
    }
    if (this.input.consumeActionRelease('interact')) {
      if (this.interactionHoldElapsed !== undefined && !this.interactionHoldTriggered) this.callbacks.onInteract('fast');
      this.interactionHoldElapsed = undefined;
      this.interactionHoldTriggered = false;
    }
  }

  private updateTraversal(delta: number): void {
    const traversal = this.traversal!;
    traversal.elapsed = Math.min(traversal.duration, traversal.elapsed + delta);
    this.traversalProgress = traversal.elapsed / traversal.duration;
    const eased = this.traversalProgress * this.traversalProgress * (3 - 2 * this.traversalProgress);
    const distance = traversal.totalLength * eased;
    let segment = 0;
    while (segment < traversal.points.length - 2 && traversal.cumulativeLengths[segment + 1]! < distance) segment += 1;
    const segmentStart = traversal.cumulativeLengths[segment]!;
    const segmentEnd = traversal.cumulativeLengths[segment + 1]!;
    const local = THREE.MathUtils.clamp((distance - segmentStart) / Math.max(EPSILON, segmentEnd - segmentStart), 0, 1);
    this.position.lerpVectors(traversal.points[segment]!, traversal.points[segment + 1]!, local);
    this.lookCamera.quaternion.copy(traversal.lookQuaternion);
    this.syncContinuousAimYawFromLookQuaternion(false);
    this.physics.teleport(this.position);
    this.physics.getPosition(this.position);
    this.moving = false;
    this.sprinting = false;
    this.crouching = false;
    this.lowPosture = false;
    this.lowPostureElapsed = 0;
    this.horizontalAcceleration = 0;
    this.targetStrafeLean = 0;
    this.targetManualLean = 0;
    this.targetAccelerationPitch = 0;
    this.targetLateralAccelerationLean = 0;
    if (this.traversalProgress >= 1) {
      this.position.copy(traversal.points[traversal.points.length - 1]!);
      this.previousPosition.copy(this.position);
      this.traversal = undefined;
      this.previousTraversalProgress = 1;
      this.traversalProgress = 1;
    }
  }

  private updateBasis(): void {
    // Movement, 3P body-follow and authored turns now share one yaw source.
    // Do not rebuild movement from PointerLockControls' quaternion/Euler path:
    // repeated fast ±180° turns must never put input and avatar in different
    // horizontal reference frames for even a single fixed step.
    const basis = movementBasisFromYaw(this.continuousAimYaw);
    this.forward.set(basis.forward.x, 0, basis.forward.z);
    this.right.set(basis.right.x, 0, basis.right.z);
  }

  private buildInputDirection(forwardAxis: number, rightAxis: number): void {
    const magnitude = Math.hypot(forwardAxis, rightAxis);
    if (magnitude < EPSILON) {
      this.inputDirection.set(0, 0, 0);
      return;
    }
    this.inputDirection
      .copy(this.forward)
      .multiplyScalar(forwardAxis / magnitude)
      .addScaledVector(this.right, rightAxis / magnitude);
    if (this.inputDirection.lengthSq() > EPSILON) this.inputDirection.normalize();
  }

  private startSlide(horizontalSpeed: number): void {
    this.slideTimer = MOVEMENT_TUNING.slide.duration;
    this.slideElapsed = 0;
    this.specialCooldown = Math.max(
      this.specialCooldown,
      MOVEMENT_TUNING.slide.duration + MOVEMENT_TUNING.slide.repeatCooldown,
    );
    this.lowPosture = false;
    this.lowPostureElapsed = 0;
    this.crouchRequested = false;
    this.crouching = this.physics.setCrouched(true);
    this.slideDirection.set(this.velocity.x, 0, this.velocity.z);
    if (this.slideDirection.lengthSq() < EPSILON) this.slideDirection.copy(this.forward);
    else this.slideDirection.normalize();
    const boostedSpeed = Math.min(MOVEMENT_TUNING.slide.maxSpeed, horizontalSpeed * MOVEMENT_TUNING.slide.startBoost);
    this.velocity.x = this.slideDirection.x * boostedSpeed;
    this.velocity.z = this.slideDirection.z * boostedSpeed;
    this.sprintBurst = Math.max(this.sprintBurst, 0.5);
    this.landingPitch = Math.min(this.landingPitch, -0.01);
  }

  private updateSlide(delta: number): void {
    this.slideTimer = Math.max(0, this.slideTimer - delta);
    this.slideElapsed += delta;
    this.crouching = this.physics.setCrouched(true);

    if (this.inputDirection.lengthSq() > EPSILON) {
      const steer = expSmoothing(delta, MOVEMENT_TUNING.slide.steeringResponse);
      this.slideDirection.lerp(this.inputDirection, steer);
      this.slideDirection.y = 0;
      if (this.slideDirection.lengthSq() > EPSILON) this.slideDirection.normalize();
    }

    const currentSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const nextSpeed = Math.max(0, currentSpeed - MOVEMENT_TUNING.slide.deceleration * delta);
    this.velocity.x = this.slideDirection.x * nextSpeed;
    this.velocity.z = this.slideDirection.z * nextSpeed;

    if (this.slideTimer <= 0 || (this.slideElapsed >= MOVEMENT_TUNING.slide.minDuration && nextSpeed <= MOVEMENT_TUNING.slide.minExitSpeed)) {
      this.endSlide(true);
    }
  }

  private launchSlideJump(): void {
    const currentSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const exitSpeed = Math.min(
      MOVEMENT_TUNING.slide.maxSpeed,
      Math.max(MOVEMENT_TUNING.locomotion.sprintSpeed, currentSpeed * MOVEMENT_TUNING.slide.jumpSpeedMultiplier),
    );
    this.velocity.x = this.slideDirection.x * exitSpeed;
    this.velocity.z = this.slideDirection.z * exitSpeed;
    this.verticalVelocity = MOVEMENT_TUNING.slide.jumpVerticalSpeed;
    this.grounded = false;
    this.groundedTime = 0;
    this.jumpGroundRearmTimer = Math.max(this.jumpGroundRearmTimer, 0.08);
    this.deliberateJumpGraceTimer = Math.max(this.deliberateJumpGraceTimer, 1.8);
    this.endSlide(false);
    this.landingPitch = Math.min(this.landingPitch, -0.014);
  }

  private endSlide(stayLow: boolean): void {
    this.slideTimer = 0;
    this.slideElapsed = 0;
    this.postSpecialRiseLockTimer = Math.max(
      this.postSpecialRiseLockTimer,
      MOVEMENT_TUNING.posture.postSpecialRiseLockDuration,
    );
    if (stayLow) {
      // Held forward+sprint is a continuous launch, not a request to crouch-walk
      // for a few ticks first. Expand only through the usual clearance check;
      // a low ceiling still keeps the ordinary crouched exit and its lock.
      const axes = this.input.axes;
      if (this.grounded && !this.sprintSuppressed && axes.sprint
        && axes.forward >= MOVEMENT_TUNING.posture.sprintRiseForwardThreshold
        && this.tryStandFromCrouch(true)) {
        this.lowPosture = false;
        this.lowPostureElapsed = 0;
        this.postSpecialRiseLockTimer = 0;
        return;
      }
      // A completed slide becomes an ordinary crouch immediately. Movement input
      // can therefore go straight into Crouch Walk; only automatic sprint/stand
      // is held back for the short post-slide lock.
      this.lowPosture = false;
      this.lowPostureElapsed = 0;
      this.crouchRequested = true;
      this.crouching = this.physics.setCrouched(true);
    } else {
      this.crouching = this.physics.setCrouched(this.crouchRequested);
    }
  }

  private enterLowPosture(): void {
    this.lowPosture = true;
    this.lowPostureElapsed = 0;
    this.crouchRequested = false;
    this.crouching = this.physics.setCrouched(true);
  }

  private applySprintRiseFeedback(): void {
    this.sprintBurst = Math.max(this.sprintBurst, 0.55);
    this.landingPitch = Math.min(this.landingPitch, -0.007);
  }

  private tryStandFromCrouch(fromSprint: boolean): boolean {
    const stillCrouched = this.physics.setCrouched(false);
    this.crouching = stillCrouched;
    if (stillCrouched) return false;
    this.crouchRequested = false;
    if (fromSprint) this.applySprintRiseFeedback();
    return true;
  }

  private tryExitLowPosture(fromSprint: boolean): boolean {
    if (!this.lowPosture) return true;
    if (this.postSpecialRiseLockTimer > 0) return false;
    if (!this.tryStandFromCrouch(false)) return false;
    this.lowPosture = false;
    this.lowPostureElapsed = 0;
    if (fromSprint) this.applySprintRiseFeedback();
    return true;
  }

  private startJump(): void {
    this.deliberateJumpGraceTimer = Math.max(this.deliberateJumpGraceTimer, 1.8);
    this.verticalVelocity = this.crouching
      ? MOVEMENT_TUNING.locomotion.crouchedJumpSpeed
      : MOVEMENT_TUNING.locomotion.standingJumpSpeed;
    this.grounded = false;
    this.groundedTime = 0;
  }

  private updateHorizontalVelocity(delta: number, sprintHeld: boolean, rightAxis: number): void {
    const movingInput = this.inputDirection.lengthSq() > EPSILON;
    const currentSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const baseTargetSpeed: number = this.lowPosture
      ? MOVEMENT_TUNING.locomotion.lowSpeed
      : this.crouching
        ? MOVEMENT_TUNING.locomotion.crouchSpeed
        : sprintHeld
          ? MOVEMENT_TUNING.locomotion.sprintSpeed
          : MOVEMENT_TUNING.locomotion.walkSpeed;
    const crouchLateral = this.crouching && !this.lowPosture
      ? Math.abs(this.inputDirection.dot(this.right)) : 0;
    // A low cross-step is shorter than a forwards stride. Keep acceleration
    // and directional inertia, with a speed that the authored feet can cover.
    const crouchPace = THREE.MathUtils.lerp(1, MOVEMENT_TUNING.locomotion.crouchStrafeSpeedScale,
      crouchLateral * crouchLateral);
    const targetSpeed = (sprintHeld
      ? baseTargetSpeed
      : baseTargetSpeed * this.movementSpeedScale) * crouchPace;

    if (movingInput) {
      this.desired.copy(this.inputDirection).multiplyScalar(targetSpeed);

      const severity = directionChangeSeverity(this.velocity.x, this.velocity.z, this.desired.x, this.desired.z);
      const speedHeavyTurn = currentSpeed >= MOVEMENT_TUNING.locomotion.sharpTurnSpeedThreshold
        ? severity
        : severity * (currentSpeed / Math.max(EPSILON, MOVEMENT_TUNING.locomotion.sharpTurnSpeedThreshold));
      const traction = THREE.MathUtils.lerp(1, MOVEMENT_TUNING.locomotion.reverseTraction, speedHeavyTurn);

      let acceleration: number = this.grounded
        ? this.lowPosture
          ? MOVEMENT_TUNING.locomotion.lowAcceleration
          : this.crouching
            ? MOVEMENT_TUNING.locomotion.crouchAcceleration
            : sprintHeld
              ? MOVEMENT_TUNING.locomotion.sprintAcceleration
              : MOVEMENT_TUNING.locomotion.groundAcceleration
        : MOVEMENT_TUNING.locomotion.airAcceleration;

      if (!this.grounded) {
        const distanceBlend = THREE.MathUtils.clamp(
          this.fallDistance / MOVEMENT_TUNING.locomotion.fallAirControlDistance,
          0,
          1,
        );
        const speedBlend = THREE.MathUtils.clamp(
          Math.max(0, -this.verticalVelocity - 2.5) / MOVEMENT_TUNING.locomotion.fallAirControlSpeed,
          0,
          1,
        );
        const longFallBlend = Math.max(distanceBlend, speedBlend * 0.8);
        acceleration *= THREE.MathUtils.lerp(1, MOVEMENT_TUNING.locomotion.fallAirControlMin, longFallBlend);
      }

      const desiredLength = Math.hypot(this.desired.x, this.desired.z);
      const alignment = currentSpeed > EPSILON && desiredLength > EPSILON
        ? (this.velocity.x * this.desired.x + this.velocity.z * this.desired.z) / (currentSpeed * desiredLength)
        : 1;
      if (
        this.grounded
        && !this.crouching
        && !sprintHeld
        && currentSpeed > desiredLength
        && alignment > 0.45
      ) {
        acceleration = MOVEMENT_TUNING.locomotion.sprintReleaseDeceleration;
      }

      acceleration *= traction;

      // Direction must stay authoritative when the player asks for straight
      // camera-relative travel, and during every sprint. Keep inertia in the
      // speed scalar, not in an obsolete world-space heading: this prevents Z
      // from drifting left/right after turns and removes sprint ice-skating.
      const lockHeadingToInput = this.grounded && (sprintHeld || Math.abs(rightAxis) < 0.05);
      const next = lockHeadingToInput
        ? moveSpeedAlongDirection2D(
            this.velocity.x,
            this.velocity.z,
            this.inputDirection.x,
            this.inputDirection.z,
            targetSpeed,
            acceleration * delta,
          )
        : moveTowards2D(
            this.velocity.x,
            this.velocity.z,
            this.desired.x,
            this.desired.z,
            acceleration * delta,
          );
      this.velocity.x = next.x;
      this.velocity.z = next.z;
    } else {
      const deceleration = this.grounded
        ? this.lowPosture
          ? MOVEMENT_TUNING.locomotion.lowDeceleration
          : this.crouching
            ? MOVEMENT_TUNING.locomotion.crouchDeceleration
            : MOVEMENT_TUNING.locomotion.groundDeceleration
        : MOVEMENT_TUNING.locomotion.airAcceleration * 0.18;
      const next = moveTowards2D(this.velocity.x, this.velocity.z, 0, 0, deceleration * delta);
      this.velocity.x = next.x;
      this.velocity.z = next.z;
    }
  }

  private handleLanding(impactVelocity: number, fallDistance: number, airborneTime: number): void {
    const impactSpeed = Math.abs(Math.min(0, impactVelocity));
    if (impactSpeed < 3.4 && fallDistance < 0.55) return;

    const velocityStrength = THREE.MathUtils.clamp((impactSpeed - 3.2) / 12.5, 0, 1);
    const distanceStrength = THREE.MathUtils.clamp(fallDistance / 6.0, 0, 1);
    const durationStrength = THREE.MathUtils.clamp((airborneTime - 0.18) / 1.2, 0, 1);
    const strength = THREE.MathUtils.clamp(
      Math.max(velocityStrength, distanceStrength * 0.95, durationStrength * 0.42),
      0.18,
      1,
    );
    this.landingKick = Math.max(this.landingKick, MOVEMENT_TUNING.camera.landingPositionKick * strength);
    this.landingPitch = Math.max(this.landingPitch, MOVEMENT_TUNING.camera.landingPitchKick * strength);
    this.landingFovCompression = Math.max(
      this.landingFovCompression,
      MOVEMENT_TUNING.camera.landingFovCompression * strength,
    );
    const severe = fallDistance >= MOVEMENT_TUNING.locomotion.highFallImpactDistance
      || impactSpeed >= MOVEMENT_TUNING.locomotion.highFallImpactSpeed;
    const impact: LandingImpact = { strength, impactSpeed, fallDistance, airborneTime, severe };
    this.callbacks.onLand(strength, impact);
  }

  private handleBlockedMotion(
    delta: number,
    intendedX: number,
    intendedZ: number,
    movedX: number,
    movedZ: number,
  ): void {
    const intendedDistance = Math.hypot(intendedX, intendedZ);
    if (intendedDistance < EPSILON || delta <= 0) return;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (speed < MOVEMENT_TUNING.collision.hardBlockSpeed) return;

    const directionX = intendedX / intendedDistance;
    const directionZ = intendedZ / intendedDistance;
    const progressedDistance = Math.max(0, movedX * directionX + movedZ * directionZ);
    const blockedFraction = THREE.MathUtils.clamp(1 - progressedDistance / intendedDistance, 0, 1);
    this.blockedMotionFraction = Math.max(this.blockedMotionFraction, blockedFraction);
    if (blockedFraction < MOVEMENT_TUNING.collision.hardBlockFraction) return;

    const impact = blockedFraction * MOVEMENT_TUNING.collision.cameraImpactScale;
    const actualVelocityX = movedX / delta;
    const actualVelocityZ = movedZ / delta;
    const retain = MOVEMENT_TUNING.collision.retainedSpeedOnImpact;
    this.velocity.x = THREE.MathUtils.lerp(actualVelocityX, this.velocity.x, retain);
    this.velocity.z = THREE.MathUtils.lerp(actualVelocityZ, this.velocity.z, retain);
    this.collisionPitch = Math.max(this.collisionPitch, MOVEMENT_TUNING.camera.collisionPitchKick * impact);
    const lateralSign = Math.sign(directionX * this.right.x + directionZ * this.right.z) || 1;
    this.collisionRoll += lateralSign * 0.011 * impact;
    if (this.slideTimer > 0) this.slideTimer = Math.min(this.slideTimer, 0.1);
  }

  private updateAccelerationCameraTargets(delta: number): void {
    if (delta <= 0) return;
    const accelerationX = (this.velocity.x - this.previousHorizontalVelocity.x) / delta;
    const accelerationZ = (this.velocity.z - this.previousHorizontalVelocity.z) / delta;
    const previousSpeed = Math.hypot(this.previousHorizontalVelocity.x, this.previousHorizontalVelocity.z);
    const currentSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    this.horizontalAcceleration = (currentSpeed - previousSpeed) / delta;

    const longitudinal = accelerationX * this.forward.x + accelerationZ * this.forward.z;
    const lateral = accelerationX * this.right.x + accelerationZ * this.right.z;
    const longitudinalScale = longitudinal >= 0
      ? MOVEMENT_TUNING.camera.accelerationPitchRadians
      : MOVEMENT_TUNING.camera.brakingPitchRadians;
    this.targetAccelerationPitch = THREE.MathUtils.clamp(
      -(longitudinal / 24) * longitudinalScale,
      -MOVEMENT_TUNING.camera.brakingPitchRadians,
      MOVEMENT_TUNING.camera.brakingPitchRadians,
    );
    this.targetLateralAccelerationLean = THREE.MathUtils.clamp(
      -(lateral / 28) * MOVEMENT_TUNING.camera.lateralAccelerationLeanRadians,
      -MOVEMENT_TUNING.camera.lateralAccelerationLeanRadians,
      MOVEMENT_TUNING.camera.lateralAccelerationLeanRadians,
    );
    this.targetBodyLagForward = THREE.MathUtils.clamp(
      -(longitudinal / 20) * MOVEMENT_TUNING.camera.bodyLagForwardMeters,
      -MOVEMENT_TUNING.camera.bodyLagForwardMeters,
      MOVEMENT_TUNING.camera.bodyLagForwardMeters,
    );
    this.targetBodyLagLateral = THREE.MathUtils.clamp(
      -(lateral / 22) * MOVEMENT_TUNING.camera.bodyLagLateralMeters,
      -MOVEMENT_TUNING.camera.bodyLagLateralMeters,
      MOVEMENT_TUNING.camera.bodyLagLateralMeters,
    );
  }

  private updateGait(horizontalDistance: number): void {
    if (!this.moving || this.slideTimer > 0) return;
    const stepLength = this.sprinting ? 1.18 : this.crouching ? 0.72 : 0.94;
    this.stepDistance += horizontalDistance;
    this.gaitPhase += (horizontalDistance / stepLength) * Math.PI;
    while (this.stepDistance >= stepLength) {
      this.stepDistance -= stepLength;
      this.callbacks.onFootstep(this.sprinting ? 1 : this.crouching ? 0.45 : 0.72);
    }
  }

  private updateNoclip(delta: number): void {
    const axes = this.input.axes;
    this.controls.getDirection(this.forward);
    this.forward.normalize();
    this.right.set(1, 0, 0).applyQuaternion(this.lookCamera.quaternion);
    this.right.y = 0;
    if (this.right.lengthSq() < EPSILON) this.right.set(1, 0, 0);
    else this.right.normalize();
    this.desired.set(0, 0, 0)
      .addScaledVector(this.forward, axes.forward)
      .addScaledVector(this.right, axes.right)
      .addScaledVector(FIXED_Y_AXIS, axes.vertical);
    const moving = this.desired.lengthSq() > EPSILON;
    if (moving) {
      this.desired.normalize().multiplyScalar((axes.sprint ? NOCLIP_SPRINT_SPEED : NOCLIP_SPEED) * delta);
      this.position.add(this.desired);
    }
    this.physics.teleport(this.position);
    this.physics.getPosition(this.position);
    this.grounded = true;
    this.verticalVelocity = -0.5;
    this.anchorSafePosition(this.position);
    this.moving = false;
    this.sprinting = false;
    this.crouching = false;
    this.lowPosture = false;
    this.lowPostureElapsed = 0;
    this.horizontalAcceleration = 0;
    this.targetStrafeLean = 0;
    this.targetAccelerationPitch = 0;
    this.targetLateralAccelerationLean = 0;
    this.targetBodyLagForward = 0;
    this.targetBodyLagLateral = 0;
  }

  private constrainDownedLook(): void {
    if (!this.incapacitated) return;
    this.lookEuler.setFromQuaternion(this.lookCamera.quaternion, 'YXZ');
    const wrappedYaw = this.lookEuler.y;
    const centerWrapped = Math.atan2(Math.sin(this.downedLookYawCenter), Math.cos(this.downedLookYawCenter));
    const yawDelta = Math.atan2(Math.sin(wrappedYaw - centerWrapped), Math.cos(wrappedYaw - centerWrapped));
    const clampedYawDelta = THREE.MathUtils.clamp(yawDelta, -DOWNED_LOOK_YAW_LIMIT, DOWNED_LOOK_YAW_LIMIT);
    const clampedPitch = THREE.MathUtils.clamp(
      this.lookEuler.x,
      this.downedLookPitchCenter - DOWNED_LOOK_PITCH_DOWN_LIMIT,
      this.downedLookPitchCenter + DOWNED_LOOK_PITCH_UP_LIMIT,
    );
    const clampedYaw = centerWrapped + clampedYawDelta;
    this.lookEuler.set(clampedPitch, clampedYaw, 0, 'YXZ');
    this.lookCamera.quaternion.setFromEuler(this.lookEuler);
    this.continuousAimYaw = this.downedLookYawCenter + clampedYawDelta;
    // A downed player can only move their head; bodycam lean/turn impulses must
    // not make the whole prone body appear to rotate around the impact pose.
    this.lookRoll = 0;
    this.lookLift = 0;
    this.fastTurnRoll = 0;
    this.turnYawKick = 0;
    this.turnPitchKick = 0;
    this.targetManualLean = 0;
    this.manualLean = 0;
  }

  renderUpdate(delta: number, interpolationAlpha: number): void {
    const frameDelta = THREE.MathUtils.clamp(delta, 0, 0.05);
    const alpha = THREE.MathUtils.clamp(interpolationAlpha, 0, 1);
    this.cameraClock += frameDelta;
    const centerOffset = this.physics.crouchCenterOffset;
    const previousRenderY = this.renderedPosition.y + this.renderedCapsuleCenterOffset;
    this.renderedPosition.lerpVectors(this.previousPosition, this.position, alpha);
    // Interpolate the supporting plane. A slide changes center height by 30 cm
    // in one physics tick; interpolating those unlike centers launched/sank the
    // avatar for a frame even though its physical feet never left the floor.
    this.renderedPosition.y += this.previousCapsuleCenterOffset * (1 - alpha) + centerOffset * alpha;
    // KCC autostep moves the physical capsule up in one tick. Absorb that small
    // grounded height change in the shared visual pose; jumps/falls stay direct.
    if (frameDelta > 0 && this.grounded && !this.traversal
      && !this.noclipEnabled && Math.abs(this.renderedPosition.y - previousRenderY) < 0.43) {
      this.renderedPosition.y = THREE.MathUtils.lerp(previousRenderY,
        this.renderedPosition.y, 1 - Math.exp(-frameDelta * 22));
    }
    this.renderedPosition.y -= centerOffset;
    this.renderedCapsuleCenterOffset = centerOffset;
    const gait = THREE.MathUtils.lerp(this.previousGaitPhase, this.gaitPhase, alpha);
    const cameraMotion = this.cameraMotionEnabled ? 1 : 0;

    // PointerLockControls owns the aim quaternion directly. Bodycam inertia is added
    // as tiny bounded impulses/offsets instead of low-pass filtering the mouse aim.
    // Severe impacts are the exception: only a small head-look cone remains while
    // the body stays pinned to its impact orientation.
    this.constrainDownedLook();
    this.renderLookQuaternion.copy(this.lookCamera.quaternion);

    this.motionBlend = THREE.MathUtils.lerp(
      this.motionBlend,
      this.moving || this.slideTimer > 0 ? 1 : 0,
      expSmoothing(frameDelta, this.moving ? MOVEMENT_TUNING.camera.motionBlendResponse : 8.5),
    );
    this.crouchBlend = THREE.MathUtils.lerp(
      this.crouchBlend,
      this.crouching ? 1 : 0,
      expSmoothing(frameDelta, MOVEMENT_TUNING.camera.crouchBlendResponse),
    );
    this.lowBlend = THREE.MathUtils.lerp(
      this.lowBlend,
      this.lowPosture ? 1 : 0,
      expSmoothing(frameDelta, MOVEMENT_TUNING.camera.lowBlendResponse),
    );
    this.slideBlend = THREE.MathUtils.lerp(this.slideBlend, this.slideTimer > 0 ? 1 : 0, expSmoothing(frameDelta, 13));
    this.strafeLean = THREE.MathUtils.lerp(
      this.strafeLean,
      this.targetStrafeLean,
      expSmoothing(frameDelta, MOVEMENT_TUNING.camera.leanResponse),
    );
    const manualLeanResponse = Math.abs(this.targetManualLean) > Math.abs(this.manualLean)
      ? MOVEMENT_TUNING.camera.manualLeanResponse
      : MOVEMENT_TUNING.camera.manualLeanReturnResponse;
    this.manualLean = THREE.MathUtils.lerp(
      this.manualLean,
      this.targetManualLean,
      expSmoothing(frameDelta, manualLeanResponse),
    );
    if (Math.abs(this.manualLean) < 0.0001 && this.targetManualLean === 0) this.manualLean = 0;
    this.accelerationPitch = THREE.MathUtils.lerp(
      this.accelerationPitch,
      this.targetAccelerationPitch,
      expSmoothing(frameDelta, MOVEMENT_TUNING.camera.leanResponse),
    );
    this.lateralAccelerationLean = THREE.MathUtils.lerp(
      this.lateralAccelerationLean,
      this.targetLateralAccelerationLean,
      expSmoothing(frameDelta, MOVEMENT_TUNING.camera.leanResponse),
    );

    const bodyLagTargeted = Math.abs(this.targetBodyLagForward) + Math.abs(this.targetBodyLagLateral) > 0.001;
    const bodyLagResponse = bodyLagTargeted
      ? MOVEMENT_TUNING.camera.bodyLagResponse
      : MOVEMENT_TUNING.camera.bodyLagReturnResponse;
    this.bodyLagForward = THREE.MathUtils.lerp(
      this.bodyLagForward,
      this.targetBodyLagForward,
      expSmoothing(frameDelta, bodyLagResponse),
    );
    this.bodyLagLateral = THREE.MathUtils.lerp(
      this.bodyLagLateral,
      this.targetBodyLagLateral,
      expSmoothing(frameDelta, bodyLagResponse),
    );

    const landingRecoveryTarget = this.landingRecoveryTimer > 0 ? this.landingRecoveryStrength : 0;
    this.landingRecoveryBlend = THREE.MathUtils.lerp(
      this.landingRecoveryBlend,
      landingRecoveryTarget,
      expSmoothing(frameDelta, landingRecoveryTarget > this.landingRecoveryBlend ? 14 : 5.5),
    );

    const impulseDecay = Math.exp(-frameDelta * MOVEMENT_TUNING.camera.impulseDecay);
    this.lookRoll *= impulseDecay;
    this.lookLift *= impulseDecay;
    this.fastTurnRoll *= impulseDecay;
    this.landingPitch *= impulseDecay;
    this.collisionPitch *= impulseDecay;
    this.collisionRoll *= impulseDecay;
    const turnKickDecay = Math.exp(-frameDelta * MOVEMENT_TUNING.camera.turnKickDecay);
    this.turnYawKick *= turnKickDecay;
    this.turnPitchKick *= turnKickDecay;
    this.turnIntensity *= Math.exp(-frameDelta * MOVEMENT_TUNING.camera.turnIntensityDecay);
    this.sprintBurst *= Math.exp(-frameDelta * MOVEMENT_TUNING.camera.sprintBurstDecay);
    this.landingFovCompression *= Math.exp(-frameDelta * 10.5);
    this.landingKick = THREE.MathUtils.lerp(this.landingKick, 0, expSmoothing(frameDelta, 12));

    const mode = this.getMovementMode();
    this.cameraBobAmplitude = THREE.MathUtils.lerp(this.cameraBobAmplitude,
      this.getBobAmplitude(mode), expSmoothing(frameDelta, 10));
    const bobAmplitude = this.cameraBobAmplitude * this.motionBlend * cameraMotion;
    const verticalBob = (0.48 - Math.abs(Math.cos(gait))) * bobAmplitude;
    const lateralBob = Math.sin(gait) * bobAmplitude * MOVEMENT_TUNING.camera.bobLateralScale;
    const forwardBob = Math.cos(gait * 2) * bobAmplitude * MOVEMENT_TUNING.camera.bobForwardScale;
    const idleBlend = (1 - this.motionBlend * 0.82) * cameraMotion;
    const idleSwayX = Math.sin(this.cameraClock * 1.25) * MOVEMENT_TUNING.camera.idleSwayPosition * idleBlend;
    const idleSwayY = Math.sin(this.cameraClock * 0.92 + 1.1) * MOVEMENT_TUNING.camera.idleSwayPosition * 0.55 * idleBlend;
    const idleSwayRoll = Math.sin(this.cameraClock * 0.78 + 0.5) * MOVEMENT_TUNING.camera.idleSwayRoll * idleBlend;
    const idleSwayPitch = Math.sin(this.cameraClock * 0.63 + 2.0) * MOVEMENT_TUNING.camera.idleSwayPitch * idleBlend;
    const manualLeanPostureScale = 1 - this.lowBlend * 0.2 - this.slideBlend * 0.16;
    const manualLeanAmount = this.manualLean * manualLeanPostureScale * cameraMotion;
    const manualLeanAbs = Math.abs(manualLeanAmount);
    const manualLeanPulse = Math.sin(
      this.cameraClock * MOVEMENT_TUNING.camera.manualLeanSwayFrequency + this.manualLean * 0.7,
    ) * manualLeanAbs;
    const manualLeanSwayPosition = manualLeanPulse * MOVEMENT_TUNING.camera.manualLeanSwayPosition;
    const manualLeanSwayRoll = manualLeanPulse * MOVEMENT_TUNING.camera.manualLeanSwayRoll;

    this.renderRight.set(1, 0, 0).applyQuaternion(this.renderLookQuaternion);
    this.renderRight.y = 0;
    if (this.renderRight.lengthSq() < EPSILON) this.renderRight.set(1, 0, 0);
    else this.renderRight.normalize();
    this.renderForward.set(0, 0, -1).applyQuaternion(this.renderLookQuaternion);
    this.renderForward.y = 0;
    if (this.renderForward.lengthSq() < EPSILON) this.renderForward.set(0, 0, -1);
    else this.renderForward.normalize();

    this.incapacitatedBlend = THREE.MathUtils.lerp(
      this.incapacitatedBlend,
      this.incapacitated ? 1 : 0,
      expSmoothing(frameDelta, this.incapacitated ? 9 : 12),
    );
    const renderTraversalProgress = THREE.MathUtils.lerp(this.previousTraversalProgress, this.traversalProgress, alpha);
    const traversalDuck = this.traversal ? -Math.sin(renderTraversalProgress * Math.PI) * this.traversal.duckDepth : 0;
    const fallVelocityBlend = THREE.MathUtils.clamp(Math.max(0, -this.verticalVelocity - 2.5) / 10.5, 0, 1);
    const fallDistanceBlend = THREE.MathUtils.clamp(this.fallDistance / 5.5, 0, 1);
    const fallBlend = this.falling ? Math.max(fallVelocityBlend, fallDistanceBlend * 0.9) : 0;
    const highFallDistanceBlend = THREE.MathUtils.smoothstep(
      this.fallDistance,
      MOVEMENT_TUNING.locomotion.highFallAnimationStartDistance * 0.9,
      MOVEMENT_TUNING.locomotion.highFallImpactDistance * 0.82,
    );
    const highFallSpeedBlend = THREE.MathUtils.smoothstep(
      Math.max(0, -this.verticalVelocity),
      MOVEMENT_TUNING.locomotion.highFallAnimationStartSpeed * 0.92,
      MOVEMENT_TUNING.locomotion.highFallImpactSpeed * 0.96,
    );
    const highFallTarget = this.falling ? Math.max(highFallDistanceBlend, highFallSpeedBlend) : 0;
    this.highFallCameraBlend = THREE.MathUtils.lerp(
      this.highFallCameraBlend,
      highFallTarget,
      expSmoothing(frameDelta, highFallTarget > this.highFallCameraBlend ? 5.2 : 11.5),
    );
    const eyeOffset = MOVEMENT_TUNING.camera.eyeHeight
      - this.crouchBlend * (MOVEMENT_TUNING.camera.crouchDrop + this.physics.crouchedCenterDrop)
      - this.lowBlend * MOVEMENT_TUNING.camera.lowExtraDrop
      + traversalDuck
      - this.landingKick * cameraMotion
      - this.landingRecoveryBlend * 0.075 * cameraMotion
      - fallBlend * MOVEMENT_TUNING.camera.fallCameraDropMeters * cameraMotion
      - this.highFallCameraBlend * MOVEMENT_TUNING.camera.fallHighCameraDropMeters * cameraMotion
      - this.incapacitatedBlend * MOVEMENT_TUNING.camera.incapacitatedCameraDropMeters * cameraMotion;

    this.camera.position
      .copy(this.renderedPosition)
      .addScaledVector(
        this.renderRight,
        lateralBob
          + this.bodyLagLateral * cameraMotion
          + idleSwayX
          - this.lookRoll * 0.4 * cameraMotion
          + manualLeanAmount * MOVEMENT_TUNING.camera.manualLeanMeters
          + manualLeanSwayPosition,
      )
      .addScaledVector(
        this.renderForward,
        forwardBob
          + this.bodyLagForward * cameraMotion
          + manualLeanAbs * MOVEMENT_TUNING.camera.manualLeanForwardMeters
          + this.highFallCameraBlend * MOVEMENT_TUNING.camera.fallHighForwardMeters * cameraMotion
          + this.incapacitatedBlend * MOVEMENT_TUNING.camera.incapacitatedCameraForwardMeters * cameraMotion,
      );
    this.camera.position.y += centerOffset + eyeOffset
      + verticalBob
      + this.lookLift * cameraMotion
      + idleSwayY
      - manualLeanAbs * MOVEMENT_TUNING.camera.manualLeanDropMeters;

    const gaitRoll = -Math.sin(gait) * bobAmplitude * MOVEMENT_TUNING.camera.gaitRollScale;
    const roll = (
      this.lookRoll
      + this.fastTurnRoll
      - this.strafeLean * MOVEMENT_TUNING.camera.strafeLeanRadians
      - manualLeanAmount * MOVEMENT_TUNING.camera.manualLeanAngleRadians
      - manualLeanSwayRoll
      + this.lateralAccelerationLean
      + this.collisionRoll
      + this.incapacitatedBlend * MOVEMENT_TUNING.camera.incapacitatedRollRadians
      + gaitRoll
      + idleSwayRoll
    ) * cameraMotion;
    const pitch = (
      this.accelerationPitch
      + this.landingPitch
      + this.landingRecoveryBlend * 0.065
      + fallBlend * MOVEMENT_TUNING.camera.fallPitchRadians
      + this.highFallCameraBlend * MOVEMENT_TUNING.camera.fallHighPitchRadians
      + this.incapacitatedBlend * MOVEMENT_TUNING.camera.incapacitatedPitchRadians
      + this.collisionPitch
      + this.turnPitchKick
      + idleSwayPitch
    ) * cameraMotion;
    const yaw = this.turnYawKick * cameraMotion;
    this.yawQuaternion.setFromAxisAngle(FIXED_Y_AXIS, yaw);
    this.pitchQuaternion.setFromAxisAngle(FIXED_X_AXIS, pitch);
    this.rollQuaternion.setFromAxisAngle(FIXED_Z_AXIS, roll);
    this.camera.quaternion
      .copy(this.renderLookQuaternion)
      .multiply(this.yawQuaternion)
      .multiply(this.pitchQuaternion)
      .multiply(this.rollQuaternion);

    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const speedBlend = normalizedSpeed(
      horizontalSpeed,
      MOVEMENT_TUNING.locomotion.walkSpeed,
      MOVEMENT_TUNING.slide.maxSpeed,
    );
    const accelerationBlend = THREE.MathUtils.clamp(this.horizontalAcceleration / 12, 0, 1);
    // Walking keeps the bodycam motion/bob, but speed-specific camera effects
    // only engage during an actual sprint. Slide keeps its own short boost.
    let fovBoost = 0;
    if (this.sprinting) {
      fovBoost += speedBlend * MOVEMENT_TUNING.camera.speedFovBoost;
      fovBoost += MOVEMENT_TUNING.camera.sprintFovBoost * this.motionBlend;
      fovBoost += this.sprintBurst * MOVEMENT_TUNING.camera.sprintBurstFovBoost;
      fovBoost += accelerationBlend * MOVEMENT_TUNING.camera.accelerationFovBoost;
    }
    fovBoost += this.slideBlend * MOVEMENT_TUNING.camera.slideFovBoost;
    fovBoost += fallBlend * MOVEMENT_TUNING.camera.fallFovBoost;
    fovBoost += this.turnIntensity * MOVEMENT_TUNING.camera.fastTurnFovBoost;
    fovBoost = Math.min(MOVEMENT_TUNING.camera.maxFovBoost, fovBoost) * cameraMotion;
    const targetFov = this.baseFov
      + fovBoost
      - this.landingFovCompression * cameraMotion
      - this.landingRecoveryBlend * 1.25 * cameraMotion
      - this.crouchBlend * 0.55 * cameraMotion
      - this.lowBlend * 0.3 * cameraMotion;
    const nextFov = THREE.MathUtils.lerp(this.camera.fov, targetFov, expSmoothing(frameDelta, MOVEMENT_TUNING.camera.fovResponse));
    if (Math.abs(nextFov - this.camera.fov) > 0.0001) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
  }

  private getBobAmplitude(mode: MovementMode): number {
    switch (mode) {
      case 'sprint': return MOVEMENT_TUNING.camera.bobSprint;
      case 'crouch': return MOVEMENT_TUNING.camera.bobCrouch;
      case 'low': return MOVEMENT_TUNING.camera.bobCrouch * 0.55;
      case 'slide': return MOVEMENT_TUNING.camera.bobSlide;
      case 'airborne': return 0;
      case 'walk': return MOVEMENT_TUNING.camera.bobWalk;
      default: return 0;
    }
  }

  private getMovementMode(): MovementMode {
    if (this.incapacitated) return 'downed';
    if (this.slideTimer > 0) return 'slide';
    if (!this.grounded) return 'airborne';
    if (this.lowPosture) return 'low';
    if (this.crouching) return 'crouch';
    if (this.sprinting) return 'sprint';
    if (this.moving) return 'walk';
    return 'idle';
  }

  private syncContinuousAimYawFromLookQuaternion(reset: boolean): void {
    this.lookEuler.setFromQuaternion(this.lookCamera.quaternion, 'YXZ');
    const wrappedYaw = this.lookEuler.y;
    if (reset || !Number.isFinite(this.continuousAimYaw)) {
      this.continuousAimYaw = wrappedYaw;
      return;
    }
    const currentWrapped = Math.atan2(Math.sin(this.continuousAimYaw), Math.cos(this.continuousAimYaw));
    const shortestDelta = Math.atan2(
      Math.sin(wrappedYaw - currentWrapped),
      Math.cos(wrappedYaw - currentWrapped),
    );
    this.continuousAimYaw += shortestDelta;
  }

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.isLocked || this.traversal) return;
    if (!this.controls.isLocked) {
      // Right-drag looks around without locking the cursor; left click attacks.
      if (event.target !== this.pointerElement || !(event.buttons & 2)) return;
      this.lookEuler.setFromQuaternion(this.lookCamera.quaternion, 'YXZ');
      this.lookEuler.y -= event.movementX * POINTER_LOCK_RADIANS_PER_PIXEL * this.controls.pointerSpeed;
      this.lookEuler.x = THREE.MathUtils.clamp(
        this.lookEuler.x - event.movementY * POINTER_LOCK_RADIANS_PER_PIXEL * this.controls.pointerSpeed,
        -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01,
      );
      this.lookCamera.quaternion.setFromEuler(this.lookEuler);
    }
    const rawHorizontal = Number.isFinite(event.movementX) ? event.movementX : 0;
    const rawVertical = Number.isFinite(event.movementY) ? event.movementY : 0;
    if (rawHorizontal !== 0 || rawVertical !== 0) this.lookActivitySerial += 1;
    const horizontal = THREE.MathUtils.clamp(rawHorizontal, -140, 140);
    const vertical = THREE.MathUtils.clamp(rawVertical, -140, 140);
    const sensitivity = this.controls.pointerSpeed;
    // Mirror PointerLockControls' yaw delta before any bodycam clamping. This is
    // the immutable aiming reference used by third-person body/camera following.
    this.continuousAimYaw -= rawHorizontal * POINTER_LOCK_RADIANS_PER_PIXEL * sensitivity;
    this.lookRoll = THREE.MathUtils.clamp(
      this.lookRoll - horizontal * MOVEMENT_TUNING.camera.mouseRollPerPixel * sensitivity,
      -MOVEMENT_TUNING.camera.maxMouseRoll,
      MOVEMENT_TUNING.camera.maxMouseRoll,
    );
    this.lookLift = THREE.MathUtils.clamp(
      this.lookLift - vertical * MOVEMENT_TUNING.camera.mouseLiftPerPixel * sensitivity,
      -MOVEMENT_TUNING.camera.maxMouseLift,
      MOVEMENT_TUNING.camera.maxMouseLift,
    );
    this.fastTurnRoll = THREE.MathUtils.clamp(
      this.fastTurnRoll - horizontal * MOVEMENT_TUNING.camera.fastTurnRollPerPixel * sensitivity,
      -MOVEMENT_TUNING.camera.maxFastTurnRoll,
      MOVEMENT_TUNING.camera.maxFastTurnRoll,
    );
    this.turnYawKick = THREE.MathUtils.clamp(
      this.turnYawKick - horizontal * MOVEMENT_TUNING.camera.turnYawKickPerPixel * sensitivity,
      -MOVEMENT_TUNING.camera.maxTurnYawKick,
      MOVEMENT_TUNING.camera.maxTurnYawKick,
    );
    this.turnPitchKick = THREE.MathUtils.clamp(
      this.turnPitchKick - vertical * MOVEMENT_TUNING.camera.turnPitchKickPerPixel * sensitivity,
      -MOVEMENT_TUNING.camera.maxTurnPitchKick,
      MOVEMENT_TUNING.camera.maxTurnPitchKick,
    );
    const turnStrength = THREE.MathUtils.clamp(Math.hypot(horizontal, vertical * 0.72) / 68, 0, 1);
    this.turnIntensity = Math.max(this.turnIntensity, turnStrength);
  };

  dispose(): void {
    this.pointerDocument.removeEventListener('mousemove', this.onMouseMove);
    this.pointerDocument.removeEventListener('keydown', this.onFallbackKey);
    window.removeEventListener('blur', this.onFallbackPause);
    this.controls.removeEventListener('lock', this.onPointerLock);
    this.controls.removeEventListener('unlock', this.onPointerUnlock);
    this.controls.disconnect();
    if (this.pointerDocument.pointerLockElement === this.pointerElement && typeof this.pointerDocument.exitPointerLock === 'function') {
      this.pointerDocument.exitPointerLock();
    }
    this.input.dispose();
  }
}
