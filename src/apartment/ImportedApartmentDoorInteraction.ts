import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { StaticCollider } from '../world/types';

const EYE_OFFSET = 0.73;
const OPEN_RESPONSE = 10.5;
const CLOSE_RESPONSE = 12;
const LOCK_STOP_RESPONSE = 18;
const LOCK_STOP_PROGRESS = 0.12;
const SETTLED_ANGLE_EPSILON = 0.0015;
const SETTLED_VELOCITY_EPSILON = 0.012;
const PLAYER_RADIUS = 0.32;
const PLAYER_HALF_HEIGHT = 0.86;
const CONTACT_SKIN = 0.025;

type DoorState = 'closed' | 'opening' | 'open' | 'closing' | 'blocked-opening' | 'blocked-closing';

export interface ImportedDoorInteractionOptions {
  chunkKey: string;
  openAngle: number;
  closedAngle?: number;
  maxRayDistance?: number;
  lockTarget?: THREE.Object3D;
  onLockChange?: (locked: boolean) => void;
  onSound?: (sound: 'open' | 'close' | 'blocked' | 'lock' | 'unlock') => void;
  onPush?: (delta: Readonly<{ x: number; y: number; z: number }>) => void;
}

export interface ImportedDoorInteractionUI {
  setInteraction(message: string | null): void;
}

export interface ImportedApartmentDoorStateSnapshot {
  readonly progress: number;
  readonly targetProgress: 0 | 1;
  readonly locked?: boolean;
}

export class ImportedApartmentDoorInteraction {
  private readonly raycaster = new THREE.Raycaster();
  private currentAngle: number;
  private targetAngle: number;
  private angularVelocity = 0;
  private state: DoorState = 'closed';
  private lastPrompt: string | null = null;
  private readonly closedAngle: number;
  private readonly maxRayDistance: number;
  private doorLocked = false;
  private readonly closedPivotInverse = new THREE.Matrix4();
  private readonly closedPivotQuaternion = new THREE.Quaternion();
  private readonly closedPivotQuaternionInverse = new THREE.Quaternion();
  private readonly colliderCenterAtPivot = new THREE.Vector3();
  private readonly colliderCenter = new THREE.Vector3();
  private readonly previousColliderCenter = new THREE.Vector3();
  private readonly colliderTranslation = new THREE.Vector3();
  private readonly colliderRotation = new THREE.Quaternion();
  private readonly colliderLongAxis = new THREE.Vector3();
  private readonly currentLongAxis = new THREE.Vector3();
  private readonly contactPoint = new THREE.Vector3();
  private readonly pushDelta = new THREE.Vector3();
  private readonly colliderHalfLength: number;
  private readonly colliderHalfThickness: number;

  constructor(
    private readonly pivot: THREE.Group,
    private readonly leaf: THREE.Object3D,
    private readonly closedBox: THREE.Box3,
    private readonly closedCollider: StaticCollider,
    private readonly physics: PhysicsWorld,
    private readonly ui: ImportedDoorInteractionUI,
    private readonly options: ImportedDoorInteractionOptions,
  ) {
    this.closedAngle = options.closedAngle ?? 0;
    this.currentAngle = this.closedAngle;
    this.targetAngle = this.closedAngle;
    this.maxRayDistance = options.maxRayDistance ?? 2.65;
    this.pivot.rotation.y = this.closedAngle;
    this.pivot.updateMatrixWorld(true);

    this.closedPivotInverse.copy(this.pivot.matrixWorld).invert();
    this.pivot.getWorldQuaternion(this.closedPivotQuaternion);
    this.closedPivotQuaternionInverse.copy(this.closedPivotQuaternion).invert();
    this.colliderCenterAtPivot
      .set(this.closedCollider.center.x, this.closedCollider.center.y, this.closedCollider.center.z)
      .applyMatrix4(this.closedPivotInverse);
    this.colliderHalfLength = Math.max(this.closedCollider.halfExtents.x, this.closedCollider.halfExtents.z);
    this.colliderHalfThickness = Math.min(this.closedCollider.halfExtents.x, this.closedCollider.halfExtents.z);
    this.colliderLongAxis.set(
      this.closedCollider.halfExtents.x >= this.closedCollider.halfExtents.z ? 1 : 0,
      0,
      this.closedCollider.halfExtents.x >= this.closedCollider.halfExtents.z ? 0 : 1,
    );
    if (this.closedCollider.rotation) {
      this.colliderLongAxis.applyQuaternion(new THREE.Quaternion(
        this.closedCollider.rotation.x,
        this.closedCollider.rotation.y,
        this.closedCollider.rotation.z,
        this.closedCollider.rotation.w,
      ));
    }

    if (!this.physics.hasChunk(this.options.chunkKey)) {
      this.physics.addKinematicChunk(this.options.chunkKey, [this.closedCollider]);
    }
    this.syncCollider();
  }

  private rayHitsDoor(playerPosition: THREE.Vector3, viewDirection: THREE.Vector3): boolean {
    if (viewDirection.lengthSq() < 0.00001) return false;
    const origin = playerPosition.clone();
    origin.y += EYE_OFFSET;
    this.raycaster.set(origin, viewDirection.clone().normalize());
    this.raycaster.near = 0;
    this.raycaster.far = this.maxRayDistance;
    return this.raycaster.intersectObject(this.leaf, true).length > 0;
  }

  private rayHitsLock(playerPosition: THREE.Vector3, viewDirection: THREE.Vector3): boolean {
    const target = this.options.lockTarget;
    if (!target || viewDirection.lengthSq() < 0.00001) return false;
    target.updateWorldMatrix(true, true);
    const lockPosition = target.getWorldPosition(new THREE.Vector3());
    // The surface bolt is mounted on the apartment side of the entrance wall.
    // Do not allow it to be operated through the frame from the stairwell.
    if (playerPosition.x > lockPosition.x - 0.045) return false;
    const origin = playerPosition.clone();
    origin.y += EYE_OFFSET;
    this.raycaster.set(origin, viewDirection.clone().normalize());
    this.raycaster.near = 0;
    this.raycaster.far = this.maxRayDistance;
    return this.raycaster.intersectObject(target, true).length > 0;
  }

  private doorwayClear(playerPosition: THREE.Vector3): boolean {
    const expanded = this.closedBox.clone().expandByVector(new THREE.Vector3(0.48, 0, 0.42));
    return !(
      playerPosition.x >= expanded.min.x && playerPosition.x <= expanded.max.x
      && playerPosition.z >= expanded.min.z && playerPosition.z <= expanded.max.z
    );
  }

  getState(): ImportedApartmentDoorStateSnapshot {
    const angleRange = this.options.openAngle - this.closedAngle;
    const progress = angleRange === 0
      ? (this.state === 'closed' ? 0 : 1)
      : THREE.MathUtils.clamp((this.currentAngle - this.closedAngle) / angleRange, 0, 1);
    return {
      progress,
      targetProgress: this.state === 'blocked-opening' || this.state === 'blocked-closing'
        ? 0
        : this.targetAngle === this.closedAngle ? 0 : 1,
      locked: this.doorLocked,
    };
  }

  restoreState(snapshot: Readonly<ImportedApartmentDoorStateSnapshot>): boolean {
    const keys = typeof snapshot === 'object' && snapshot !== null && !Array.isArray(snapshot)
      ? Object.keys(snapshot)
      : [];
    const hasLegacyKeys = keys.length === 2
      && Object.hasOwn(snapshot, 'progress')
      && Object.hasOwn(snapshot, 'targetProgress');
    const hasCurrentKeys = keys.length === 3
      && Object.hasOwn(snapshot, 'progress')
      && Object.hasOwn(snapshot, 'targetProgress')
      && Object.hasOwn(snapshot, 'locked');
    if (typeof snapshot !== 'object'
      || snapshot === null
      || Array.isArray(snapshot)
      || (!hasLegacyKeys && !hasCurrentKeys)
      || !Number.isFinite(snapshot.progress)
      || snapshot.progress < 0
      || snapshot.progress > 1
      || (snapshot.targetProgress !== 0 && snapshot.targetProgress !== 1)
      || (hasCurrentKeys && typeof snapshot.locked !== 'boolean')) return false;

    const { progress, targetProgress } = snapshot;
    const restoredLocked = hasCurrentKeys ? snapshot.locked === true : false;
    if (restoredLocked && targetProgress === 1) return false;
    this.currentAngle = THREE.MathUtils.lerp(this.closedAngle, this.options.openAngle, progress);
    this.targetAngle = targetProgress === 0 ? this.closedAngle : this.options.openAngle;
    this.angularVelocity = 0;
    if (progress === 0 && targetProgress === 0) this.state = 'closed';
    else if (progress === 1 && targetProgress === 1) this.state = 'open';
    else if (restoredLocked && targetProgress === 0) this.state = 'blocked-closing';
    else this.state = targetProgress === 0 ? 'closing' : 'opening';
    this.doorLocked = restoredLocked;
    this.options.onLockChange?.(restoredLocked);

    this.pivot.rotation.y = this.currentAngle;
    this.pivot.updateMatrixWorld(true);
    this.syncCollider();
    this.setPrompt(null);
    return true;
  }

  isLocked(): boolean {
    return this.doorLocked;
  }

  setLocked(locked: boolean): boolean {
    if (this.state !== 'closed') return false;
    this.doorLocked = locked;
    this.options.onLockChange?.(locked);
    this.options.onSound?.(locked ? 'lock' : 'unlock');
    this.setPrompt(null);
    return true;
  }

  update(delta: number, playerPosition: THREE.Vector3, viewDirection: THREE.Vector3, locked: boolean): void {
    const distanceFromClosed = Math.abs(this.currentAngle - this.closedAngle);
    if (this.state === 'closing' && distanceFromClosed < 0.22 && !this.doorwayClear(playerPosition)) {
      this.state = 'opening';
      this.targetAngle = this.options.openAngle;
    }

    if (Math.abs(this.currentAngle - this.targetAngle) > SETTLED_ANGLE_EPSILON
      || Math.abs(this.angularVelocity) > SETTLED_VELOCITY_EPSILON) {
      // Exact critically damped spring. Unlike the previous exponential lerp,
      // this starts without an abrupt angular-speed jump and still comes to a
      // decisive stop at the jamb. It is also stable across variable frames.
      const response = this.state === 'blocked-opening' || this.state === 'blocked-closing'
        ? LOCK_STOP_RESPONSE
        : this.state === 'closing' ? CLOSE_RESPONSE : OPEN_RESPONSE;
      const frameDelta = Math.max(0, delta);
      const displacement = this.currentAngle - this.targetAngle;
      const decay = Math.exp(-response * frameDelta);
      const springStep = (this.angularVelocity + response * displacement) * frameDelta;
      this.currentAngle = this.targetAngle + (displacement + springStep) * decay;
      this.angularVelocity = (this.angularVelocity - response * springStep) * decay;

      if (Math.abs(this.currentAngle - this.targetAngle) < SETTLED_ANGLE_EPSILON
        && Math.abs(this.angularVelocity) < SETTLED_VELOCITY_EPSILON) {
        this.currentAngle = this.targetAngle;
        this.angularVelocity = 0;
        if (this.state === 'opening') this.state = 'open';
        if (this.state === 'blocked-opening') {
          this.state = 'blocked-closing';
          this.targetAngle = this.closedAngle;
        } else if (this.state === 'blocked-closing') {
          this.state = 'closed';
        }
        if (this.state === 'closing') {
          if (!this.doorwayClear(playerPosition)) {
            this.state = 'opening';
            this.targetAngle = this.options.openAngle;
          } else {
            this.state = 'closed';
          }
        }
      }
      this.pivot.rotation.y = this.currentAngle;
      this.pivot.updateMatrixWorld(true);
      this.syncCollider(playerPosition, true);
    }

    if (!locked
      || this.state === 'blocked-opening'
      || this.state === 'blocked-closing') {
      this.setPrompt(null);
      return;
    }
    if (this.state === 'closed' && this.rayHitsLock(playerPosition, viewDirection)) {
      this.setPrompt(this.doorLocked ? 'Déverrouiller' : 'Verrouiller');
      return;
    }
    if (!this.rayHitsDoor(playerPosition, viewDirection)) {
      this.setPrompt(null);
      return;
    }
    this.setPrompt(this.state === 'open' || this.state === 'opening'
      ? 'Fermer la porte'
      : 'Ouvrir la porte');
  }

  interact(playerPosition: THREE.Vector3, viewDirection: THREE.Vector3, locked: boolean): boolean {
    if (!locked
      || this.state === 'blocked-opening'
      || this.state === 'blocked-closing') return false;
    if (this.state === 'closed' && this.rayHitsLock(playerPosition, viewDirection)) {
      return this.setLocked(!this.doorLocked);
    }
    if (!this.rayHitsDoor(playerPosition, viewDirection)) return false;

    if (this.state === 'closed') {
      if (this.doorLocked) {
        this.options.onSound?.('blocked');
        this.state = 'blocked-opening';
        this.targetAngle = THREE.MathUtils.lerp(
          this.closedAngle,
          this.options.openAngle,
          LOCK_STOP_PROGRESS,
        );
        this.angularVelocity = 0;
        this.setPrompt(null);
        return true;
      }
      this.state = 'opening';
      this.options.onSound?.('open');
      this.targetAngle = this.options.openAngle;
      this.setPrompt(null);
      return true;
    }

    if (this.state === 'opening') {
      this.state = 'closing';
      this.targetAngle = this.closedAngle;
      this.options.onSound?.('close');
      this.setPrompt(null);
      return true;
    }

    if (this.state === 'closing') {
      this.state = 'opening';
      this.targetAngle = this.options.openAngle;
      this.options.onSound?.('open');
      this.setPrompt(null);
      return true;
    }

    if (this.state === 'open' && this.doorwayClear(playerPosition)) {
      this.state = 'closing';
      this.options.onSound?.('close');
      this.targetAngle = this.closedAngle;
      this.setPrompt(null);
      return true;
    }
    return false;
  }

  dispose(): void {
    this.ui.setInteraction(null);
    this.physics.removeChunk(this.options.chunkKey);
  }

  private syncCollider(playerPosition?: THREE.Vector3, pushPlayer = false): void {
    this.previousColliderCenter.copy(this.colliderCenter);
    this.pivot.updateWorldMatrix(true, false);
    this.colliderCenter.copy(this.colliderCenterAtPivot).applyMatrix4(this.pivot.matrixWorld);
    this.pivot.getWorldQuaternion(this.colliderRotation);
    this.colliderRotation.multiply(this.closedPivotQuaternionInverse).normalize();

    this.colliderTranslation
      .set(this.closedCollider.center.x, this.closedCollider.center.y, this.closedCollider.center.z)
      .applyQuaternion(this.colliderRotation)
      .multiplyScalar(-1)
      .add(this.colliderCenter);
    this.physics.setKinematicChunkTransform(
      this.options.chunkKey,
      this.colliderTranslation,
      this.colliderRotation,
    );

    if (!pushPlayer || !playerPosition || !this.options.onPush) return;
    if (this.colliderCenter.distanceToSquared(this.previousColliderCenter) < 1e-10) return;
    if (Math.abs(playerPosition.y - this.colliderCenter.y)
      > this.closedCollider.halfExtents.y + PLAYER_HALF_HEIGHT) return;

    this.currentLongAxis.copy(this.colliderLongAxis).applyQuaternion(this.colliderRotation);
    this.currentLongAxis.y = 0;
    if (this.currentLongAxis.lengthSq() < 1e-8) return;
    this.currentLongAxis.normalize();
    const relativeX = playerPosition.x - this.colliderCenter.x;
    const relativeZ = playerPosition.z - this.colliderCenter.z;
    const along = THREE.MathUtils.clamp(
      relativeX * this.currentLongAxis.x + relativeZ * this.currentLongAxis.z,
      -this.colliderHalfLength,
      this.colliderHalfLength,
    );
    this.contactPoint.copy(this.colliderCenter).addScaledVector(this.currentLongAxis, along);
    this.contactPoint.y = playerPosition.y;
    this.pushDelta.copy(playerPosition).sub(this.contactPoint);
    this.pushDelta.y = 0;
    const distance = this.pushDelta.length();
    const clearance = PLAYER_RADIUS + this.colliderHalfThickness + CONTACT_SKIN;
    if (distance >= clearance) return;
    if (distance > 1e-5) {
      this.pushDelta.multiplyScalar(1 / distance);
    } else {
      this.pushDelta
        .copy(this.colliderCenter)
        .sub(this.previousColliderCenter)
        .setY(0);
      if (this.pushDelta.lengthSq() < 1e-8) {
        this.pushDelta.set(-this.currentLongAxis.z, 0, this.currentLongAxis.x);
      } else {
        this.pushDelta.normalize();
      }
    }
    this.pushDelta.multiplyScalar(clearance - distance + CONTACT_SKIN);
    this.options.onPush(this.pushDelta);
  }

  private setPrompt(message: string | null): void {
    // Re-publish active prompts so another nearby interaction clearing its own
    // prompt cannot permanently hide this one on the shared UI channel.
    if (this.lastPrompt === message && message === null) return;
    this.lastPrompt = message;
    this.ui.setInteraction(message);
  }
}
