import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { describeViewDirection } from '../core/Diagnostics';
import type { PlayerDiagnostics } from '../core/Diagnostics';
import { InputManager } from '../input/InputManager';
import type { ControlBindings } from '../input/ControlBindings';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import type { DoorOpenMode, QuaternionData, Vec3Data } from '../world/types';

export interface PlayerCallbacks {
  onLockChange(locked: boolean): void;
  onFootstep(strength: number): void;
  onMovementAudioState?(state: 'idle' | 'sprint'): void;
  onInteract(mode: DoorOpenMode): void;
  onLand(impactSpeed: number): void;
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

const FIXED_Z_AXIS = new THREE.Vector3(0, 0, 1);
const FIXED_Y_AXIS = new THREE.Vector3(0, 1, 0);
const MAX_UNBROKEN_FALL = 48;
const NOCLIP_SPEED = 8.5;
const NOCLIP_SPRINT_SPEED = 22;
const STANDING_JUMP_SPEED = 5.45;
const CROUCHED_JUMP_SPEED = 4.25;
const MIN_LOOK_QUATERNION_LENGTH = 1e-8;
const SLOW_INTERACTION_HOLD = 1;

export class PlayerController {
  readonly controls: PointerLockControls;
  readonly position = new THREE.Vector3();
  private readonly lookCamera = new THREE.PerspectiveCamera();
  private readonly input = new InputManager();
  private readonly desired = new THREE.Vector3();
  private readonly externalMotion = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly renderForward = new THREE.Vector3();
  private readonly renderRight = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly previousPosition = new THREE.Vector3();
  private readonly renderedPosition = new THREE.Vector3();
  private readonly lastSafePosition = new THREE.Vector3();
  private readonly rollQuaternion = new THREE.Quaternion();
  private readonly pointerDocument: Document;
  private readonly pointerElement: HTMLElement;
  private grounded = true;
  private verticalVelocity = -0.5;
  private gaitPhase = 0;
  private previousGaitPhase = 0;
  private stepDistance = 0;
  private moving = false;
  private sprinting = false;
  private crouching = false;
  private crouchRequested = false;
  private targetStrafeLean = 0;
  private motionBlend = 0;
  private crouchBlend = 0;
  private strafeLean = 0;
  private lookRoll = 0;
  private lookLift = 0;
  private traversal?: TraversalState;
  private traversalProgress = 0;
  private previousTraversalProgress = 0;
  private landingKick = 0;
  private noclipEnabled = false;
  private interactionHoldElapsed?: number;
  private interactionHoldTriggered = false;
  private baseFov: number;
  private cameraMotionEnabled = true;
  private readonly onPointerLock = (): void => this.callbacks.onLockChange(true);
  private readonly onPointerUnlock = (): void => this.callbacks.onLockChange(false);

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    private readonly physics: PhysicsWorld,
    private readonly callbacks: PlayerCallbacks,
  ) {
    // PointerLockControls pilots an invisible look target. The rendered camera
    // can then receive locomotion and mouse inertia without fighting the
    // control's quaternion updates.
    this.lookCamera.quaternion.copy(camera.quaternion);
    this.lookCamera.up.copy(camera.up);
    this.controls = new PointerLockControls(this.lookCamera, domElement);
    this.baseFov = camera.fov;
    this.pointerDocument = domElement.ownerDocument;
    this.pointerElement = domElement;
    this.physics.getPosition(this.position);
    this.previousPosition.copy(this.position);
    this.renderedPosition.copy(this.position);
    this.anchorSafePosition(this.position);
    this.renderUpdate(0, 1);
    this.controls.addEventListener('lock', this.onPointerLock);
    this.controls.addEventListener('unlock', this.onPointerUnlock);
    this.pointerDocument.addEventListener('mousemove', this.onMouseMove);
  }

  get isLocked(): boolean {
    return this.controls.isLocked;
  }

  get isTraversing(): boolean {
    return this.traversal !== undefined;
  }

  get isNoclipEnabled(): boolean {
    return this.noclipEnabled;
  }

  lock(): void {
    this.controls.lock();
  }

  setFieldOfView(fieldOfView: number): void {
    this.baseFov = THREE.MathUtils.clamp(fieldOfView, 60, 100);
    if (!this.sprinting && !this.crouching) {
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
      this.strafeLean = 0;
      this.landingKick = 0;
    }
  }

  setInputEnabled(enabled: boolean): void {
    this.input.setEnabled(enabled);
    if (!enabled) {
      this.velocity.set(0, 0, 0);
      this.moving = false;
      this.sprinting = false;
      this.callbacks.onMovementAudioState?.('idle');
      this.targetStrafeLean = 0;
    }
  }

  setControlBindings(bindings: ControlBindings): void {
    this.input.setBindings(bindings);
  }

  setNoclipEnabled(enabled: boolean): boolean {
    if (this.noclipEnabled === enabled) return this.noclipEnabled;
    this.noclipEnabled = enabled;
    this.traversal = undefined;
    this.traversalProgress = 0;
    this.previousTraversalProgress = 0;
    this.velocity.set(0, 0, 0);
    this.verticalVelocity = -0.5;
    this.grounded = true;
    this.moving = false;
    this.sprinting = false;
    this.crouchRequested = false;
    this.crouching = false;
    this.targetStrafeLean = 0;
    this.anchorSafePosition(this.position);
    this.physics.teleport(this.position);
    this.physics.getPosition(this.position);
    this.previousPosition.copy(this.position);
    this.renderedPosition.copy(this.position);
    this.renderUpdate(0, 1);
    return this.noclipEnabled;
  }

  toggleNoclip(): boolean {
    return this.setNoclipEnabled(!this.noclipEnabled);
  }

  getViewDirection(target = new THREE.Vector3()): THREE.Vector3 {
    return this.controls.getDirection(target);
  }

  getLookQuaternion(target = new THREE.Quaternion()): THREE.Quaternion {
    return target.copy(this.lookCamera.quaternion);
  }

  setLookQuaternion(quaternion: Readonly<QuaternionData>): boolean {
    const { x, y, z, w } = quaternion;
    if (![x, y, z, w].every(Number.isFinite)) return false;

    const length = Math.hypot(x, y, z, w);
    if (!Number.isFinite(length) || length < MIN_LOOK_QUATERNION_LENGTH) return false;

    this.lookCamera.quaternion.set(x / length, y / length, z / length, w / length);
    this.traversal?.lookQuaternion.copy(this.lookCamera.quaternion);
    this.lookRoll = 0;
    this.lookLift = 0;
    this.targetStrafeLean = 0;
    this.strafeLean = 0;
    this.rollQuaternion.identity();
    this.renderUpdate(0, 1);
    return true;
  }

  getDebugState(): PlayerDiagnostics {
    const view = describeViewDirection(this.getViewDirection());
    const verticalSpeed = this.noclipEnabled ? 0 : this.verticalVelocity;
    return {
      x: this.position.x,
      y: this.position.y,
      z: this.position.z,
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      velocity: { x: this.velocity.x, y: verticalSpeed, z: this.velocity.z },
      horizontalSpeed: Math.hypot(this.velocity.x, this.velocity.z),
      verticalSpeed,
      grounded: this.grounded,
      moving: this.moving,
      sprinting: this.sprinting,
      crouching: this.crouching,
      noclip: this.noclipEnabled,
      traversing: this.isTraversing,
      pointerLocked: this.isLocked,
      view,
    };
  }

  teleport(destination: Vec3Data): void {
    this.traversal = undefined;
    this.traversalProgress = 0;
    this.previousTraversalProgress = 0;
    this.velocity.set(0, 0, 0);
    this.verticalVelocity = -0.5;
    this.grounded = true;
    this.motionBlend = 0;
    this.landingKick = 0;
    this.externalMotion.set(0, 0, 0);
    this.physics.teleport(destination);
    this.physics.getPosition(this.position);
    this.previousPosition.copy(this.position);
    this.renderedPosition.copy(this.position);
    this.anchorSafePosition(this.position);
    this.renderUpdate(0, 1);
  }

  queueExternalMotion(delta: Readonly<Vec3Data>): void {
    if (this.noclipEnabled || this.traversal) return;
    if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y) || !Number.isFinite(delta.z)) return;
    this.externalMotion.x += delta.x;
    this.externalMotion.y += delta.y;
    this.externalMotion.z += delta.z;
    const horizontalLength = Math.hypot(this.externalMotion.x, this.externalMotion.z);
    if (horizontalLength > 0.55) {
      const scale = 0.55 / horizontalLength;
      this.externalMotion.x *= scale;
      this.externalMotion.z *= scale;
    }
  }

  private anchorSafePosition(position: Readonly<Vec3Data>): void {
    this.lastSafePosition.set(position.x, position.y, position.z);
    this.callbacks.onSafePosition(this.lastSafePosition);
  }

  beginTraversal(
    destinationOrPath: Vec3Data | readonly Vec3Data[],
    duration = 0.72,
    duckDepth = 0.34,
  ): boolean {
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
      points,
      cumulativeLengths,
      totalLength,
      elapsed: 0,
      duration: Math.max(0.2, duration),
      duckDepth: Math.max(0, duckDepth),
      lookQuaternion: this.lookCamera.quaternion.clone(),
    };
    this.traversalProgress = 0;
    this.previousTraversalProgress = 0;
    this.velocity.set(0, 0, 0);
    this.verticalVelocity = -0.5;
    this.moving = false;
    this.sprinting = false;
    return true;
  }

  fixedUpdate(delta: number): void {
    this.previousPosition.copy(this.position);
    this.previousGaitPhase = this.gaitPhase;
    this.previousTraversalProgress = this.traversalProgress;

    if (!this.controls.isLocked) {
      this.externalMotion.set(0, 0, 0);
      this.input.consumeActionPress('interact');
      this.input.consumeActionRelease('interact');
      this.interactionHoldElapsed = undefined;
      this.interactionHoldTriggered = false;
      this.input.consumeActionPress('jump');
      this.input.consumeActionPress('crouch');
      this.velocity.multiplyScalar(0.82);
      this.moving = false;
      this.sprinting = false;
      this.callbacks.onMovementAudioState?.('idle');
      this.targetStrafeLean = 0;
      return;
    }

    if (this.noclipEnabled) {
      this.externalMotion.set(0, 0, 0);
      this.callbacks.onMovementAudioState?.('idle');
      this.input.consumeActionPress('interact');
      this.input.consumeActionRelease('interact');
      this.interactionHoldElapsed = undefined;
      this.interactionHoldTriggered = false;
      this.input.consumeActionPress('jump');
      this.input.consumeActionPress('crouch');
      this.updateNoclip(delta);
      return;
    }

    if (this.input.consumeActionPress('interact')) {
      this.interactionHoldElapsed = 0;
      this.interactionHoldTriggered = false;
    }
    if (this.interactionHoldElapsed !== undefined && this.input.isActionPressed('interact')) {
      this.interactionHoldElapsed += delta;
      if (
        !this.interactionHoldTriggered &&
        this.interactionHoldElapsed >= SLOW_INTERACTION_HOLD
      ) {
        this.interactionHoldTriggered = true;
        this.callbacks.onInteract('slow');
      }
    }
    if (this.input.consumeActionRelease('interact')) {
      if (this.interactionHoldElapsed !== undefined && !this.interactionHoldTriggered) {
        this.callbacks.onInteract('fast');
      }
      this.interactionHoldElapsed = undefined;
      this.interactionHoldTriggered = false;
    }
    if (this.traversal) {
      this.externalMotion.set(0, 0, 0);
      const traversal = this.traversal;
      traversal.elapsed = Math.min(traversal.duration, traversal.elapsed + delta);
      this.traversalProgress = traversal.elapsed / traversal.duration;
      const eased = this.traversalProgress * this.traversalProgress * (3 - 2 * this.traversalProgress);
      const distance = traversal.totalLength * eased;
      let segment = 0;
      while (
        segment < traversal.points.length - 2 &&
        traversal.cumulativeLengths[segment + 1]! < distance
      ) segment += 1;
      const segmentStart = traversal.cumulativeLengths[segment]!;
      const segmentEnd = traversal.cumulativeLengths[segment + 1]!;
      const local = THREE.MathUtils.clamp((distance - segmentStart) / Math.max(1e-6, segmentEnd - segmentStart), 0, 1);
      this.position.lerpVectors(traversal.points[segment]!, traversal.points[segment + 1]!, local);
      this.lookCamera.quaternion.copy(traversal.lookQuaternion);
      this.physics.teleport(this.position);
      this.physics.getPosition(this.position);
      this.moving = false;
      this.sprinting = false;
      this.callbacks.onMovementAudioState?.('idle');
      this.crouching = false;
      this.targetStrafeLean = 0;
      if (this.traversalProgress >= 1) {
        this.position.copy(traversal.points[traversal.points.length - 1]!);
        this.previousPosition.copy(this.position);
        this.traversal = undefined;
        this.previousTraversalProgress = 1;
        this.traversalProgress = 1;
      }
      return;
    }

    const axes = this.input.axes;
    const crouchToggle = this.input.consumeActionPress('crouch');
    if (crouchToggle) this.crouchRequested = !this.crouchRequested;
    this.crouching = this.physics.setCrouched(this.crouchRequested);
    this.controls.getDirection(this.forward);
    this.forward.y = 0;
    this.forward.normalize();
    this.right.crossVectors(this.forward, this.lookCamera.up).normalize();

    const magnitude = Math.hypot(axes.forward, axes.right) || 1;
    const targetSpeed = this.crouching ? 1.55 : axes.sprint ? 6.05 : 3;
    this.desired
      .copy(this.forward)
      .multiplyScalar((axes.forward / magnitude) * targetSpeed)
      .addScaledVector(this.right, (axes.right / magnitude) * targetSpeed);
    const responsiveness = 1 - Math.exp(-delta * (this.grounded ? 15.5 : 5));
    this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, this.desired.x, responsiveness);
    this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, this.desired.z, responsiveness);

    if (axes.forward === 0 && axes.right === 0) {
      const friction = Math.exp(-delta * 15);
      this.velocity.x *= friction;
      this.velocity.z *= friction;
    }

    const jumpRequested = this.input.consumeActionPress('jump');
    if (this.grounded && jumpRequested) {
      this.verticalVelocity = this.crouching ? CROUCHED_JUMP_SPEED : STANDING_JUMP_SPEED;
      this.grounded = false;
    }
    this.verticalVelocity -= 18.5 * delta;
    this.verticalVelocity = Math.max(this.verticalVelocity, -18);
    const impactVelocity = this.verticalVelocity;
    const wasGrounded = this.grounded;
    const result = this.physics.move({
      x: this.velocity.x * delta + this.externalMotion.x,
      y: this.verticalVelocity * delta + this.externalMotion.y,
      z: this.velocity.z * delta + this.externalMotion.z,
    });
    this.externalMotion.set(0, 0, 0);
    this.position.copy(result.position);
    this.grounded = result.grounded;
    if (this.grounded && !wasGrounded && impactVelocity < -2.4) {
      const impactSpeed = Math.abs(impactVelocity);
      const cameraStrength = THREE.MathUtils.clamp(impactSpeed / 14, 0.18, 1);
      this.landingKick = Math.max(this.landingKick, 0.11 * cameraStrength);
      this.callbacks.onLand(impactSpeed);
    }
    if (this.grounded && this.verticalVelocity < 0) this.verticalVelocity = -0.9;
    if (this.grounded) {
      this.anchorSafePosition(this.position);
    }

    const horizontalDistance = Math.hypot(result.moved.x, result.moved.z);
    this.moving = horizontalDistance > 0.00015 && this.grounded;
    this.sprinting = axes.sprint && !this.crouching && this.moving;
    this.callbacks.onMovementAudioState?.(this.sprinting ? 'sprint' : 'idle');
    this.targetStrafeLean = this.moving
      ? THREE.MathUtils.clamp(this.velocity.dot(this.right) / Math.max(1, targetSpeed), -1, 1)
      : 0;

    if (this.moving) {
      const stepLength = this.sprinting ? 1.85 : this.crouching ? 1.02 : 1.35;
      this.stepDistance += horizontalDistance;
      // PI per footfall: a full 2PI gait cycle contains a left and a right step.
      this.gaitPhase += (horizontalDistance / stepLength) * Math.PI;
      while (this.stepDistance >= stepLength) {
        this.stepDistance -= stepLength;
        this.callbacks.onFootstep(this.sprinting ? 1 : this.crouching ? 0.45 : 0.72);
      }
    }

    // The world has no absolute bottom. The watchdog is therefore relative to
    // the last grounded point and only catches an uninterrupted abyss deeper
    // than every supported multi-storey shaft.
    if (this.position.y < this.lastSafePosition.y - MAX_UNBROKEN_FALL) {
      this.physics.teleport(this.lastSafePosition);
      this.physics.getPosition(this.position);
      this.previousPosition.copy(this.position);
      this.velocity.set(0, 0, 0);
      this.verticalVelocity = -0.5;
      this.moving = false;
      this.callbacks.onFallReset();
    }
  }

  private updateNoclip(delta: number): void {
    const axes = this.input.axes;
    this.controls.getDirection(this.forward);
    this.forward.normalize();
    this.right.set(1, 0, 0).applyQuaternion(this.lookCamera.quaternion);
    this.right.y = 0;
    if (this.right.lengthSq() < 1e-6) this.right.set(1, 0, 0);
    else this.right.normalize();

    this.desired
      .set(0, 0, 0)
      .addScaledVector(this.forward, axes.forward)
      .addScaledVector(this.right, axes.right)
      .addScaledVector(FIXED_Y_AXIS, axes.vertical);

    const moving = this.desired.lengthSq() > 1e-6;
    if (moving) {
      this.desired
        .normalize()
        .multiplyScalar((axes.sprint ? NOCLIP_SPRINT_SPEED : NOCLIP_SPEED) * delta);
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
    this.targetStrafeLean = 0;
  }

  renderUpdate(delta: number, interpolationAlpha: number): void {
    const frameDelta = THREE.MathUtils.clamp(delta, 0, 0.05);
    const alpha = THREE.MathUtils.clamp(interpolationAlpha, 0, 1);
    this.renderedPosition.lerpVectors(this.previousPosition, this.position, alpha);
    const gait = THREE.MathUtils.lerp(this.previousGaitPhase, this.gaitPhase, alpha);

    const motionResponse = 1 - Math.exp(-frameDelta * (this.moving ? 10 : 7.5));
    this.motionBlend = THREE.MathUtils.lerp(this.motionBlend, this.moving ? 1 : 0, motionResponse);
    this.crouchBlend = THREE.MathUtils.lerp(
      this.crouchBlend,
      this.crouching ? 1 : 0,
      1 - Math.exp(-frameDelta * 11),
    );
    this.strafeLean = THREE.MathUtils.lerp(
      this.strafeLean,
      this.targetStrafeLean,
      1 - Math.exp(-frameDelta * 8),
    );

    const lookDecay = Math.exp(-frameDelta * 9.5);
    this.lookRoll *= lookDecay;
    this.lookLift *= lookDecay;

    const cameraMotion = this.cameraMotionEnabled ? 1 : 0;
    const bobAmplitude = (
      this.crouching ? 0.014 : this.sprinting ? 0.043 : 0.027
    ) * this.motionBlend * cameraMotion;
    const verticalBob = (0.48 - Math.abs(Math.cos(gait))) * bobAmplitude;
    const lateralBob = Math.sin(gait) * bobAmplitude * 0.42;
    const forwardBob = Math.cos(gait * 2) * bobAmplitude * 0.09;

    this.renderRight.set(1, 0, 0).applyQuaternion(this.lookCamera.quaternion);
    this.renderRight.y = 0;
    this.renderRight.normalize();
    this.renderForward.set(0, 0, -1).applyQuaternion(this.lookCamera.quaternion);
    this.renderForward.y = 0;
    this.renderForward.normalize();

    const renderTraversalProgress = THREE.MathUtils.lerp(
      this.previousTraversalProgress,
      this.traversalProgress,
      alpha,
    );
    const traversalDuck = this.traversal
      ? -Math.sin(renderTraversalProgress * Math.PI) * this.traversal.duckDepth
      : 0;
    this.landingKick = THREE.MathUtils.lerp(this.landingKick, 0, 1 - Math.exp(-frameDelta * 11));
    const eyeOffset = 0.73 - this.crouchBlend * 0.46 + traversalDuck -
      this.landingKick * cameraMotion;
    this.camera.position
      .copy(this.renderedPosition)
      .addScaledVector(this.renderRight, lateralBob - this.lookRoll * 0.42 * cameraMotion)
      .addScaledVector(this.renderForward, forwardBob);
    this.camera.position.y += eyeOffset + verticalBob + this.lookLift * cameraMotion;

    const gaitRoll = -Math.sin(gait) * bobAmplitude * 0.2;
    const roll = (this.lookRoll - this.strafeLean * 0.012 + gaitRoll) * cameraMotion;
    this.rollQuaternion.setFromAxisAngle(FIXED_Z_AXIS, roll);
    this.camera.quaternion.copy(this.lookCamera.quaternion).multiply(this.rollQuaternion);

    const targetFov = this.baseFov + (
      (this.sprinting ? 4.8 * this.motionBlend : 0) - this.crouchBlend * 0.9
    ) * cameraMotion;
    const nextFov = THREE.MathUtils.lerp(
      this.camera.fov,
      targetFov,
      1 - Math.exp(-frameDelta * 7),
    );
    if (Math.abs(nextFov - this.camera.fov) > 0.0001) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
  }

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.controls.isLocked || this.traversal) return;
    const horizontal = THREE.MathUtils.clamp(event.movementX, -120, 120);
    const vertical = THREE.MathUtils.clamp(event.movementY, -120, 120);
    this.lookRoll = THREE.MathUtils.clamp(this.lookRoll - horizontal * 0.000115, -0.021, 0.021);
    this.lookLift = THREE.MathUtils.clamp(this.lookLift - vertical * 0.000035, -0.009, 0.009);
  };

  dispose(): void {
    this.pointerDocument.removeEventListener('mousemove', this.onMouseMove);
    this.controls.removeEventListener('lock', this.onPointerLock);
    this.controls.removeEventListener('unlock', this.onPointerUnlock);
    this.controls.disconnect();
    if (
      this.pointerDocument.pointerLockElement === this.pointerElement
      && typeof this.pointerDocument.exitPointerLock === 'function'
    ) this.pointerDocument.exitPointerLock();
    this.input.dispose();
  }
}
