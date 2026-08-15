import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { StaticCollider } from '../world/types';

const EYE_OFFSET = 0.73;

type DoorState = 'closed' | 'opening' | 'open' | 'closing';

export interface ImportedDoorInteractionOptions {
  chunkKey: string;
  openAngle: number;
  closedAngle?: number;
  maxRayDistance?: number;
}

export interface ImportedDoorInteractionUI {
  setInteraction(message: string | null): void;
}

export interface ImportedApartmentDoorStateSnapshot {
  readonly progress: number;
  readonly targetProgress: 0 | 1;
}

export class ImportedApartmentDoorInteraction {
  private readonly raycaster = new THREE.Raycaster();
  private currentAngle: number;
  private targetAngle: number;
  private state: DoorState = 'closed';
  private lastPrompt: string | null = null;
  private readonly closedAngle: number;
  private readonly maxRayDistance: number;

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

    if (!this.physics.hasChunk(this.options.chunkKey)) {
      this.physics.addChunk(this.options.chunkKey, [this.closedCollider], { x: 0, y: 0, z: 0 });
    }
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
      targetProgress: this.targetAngle === this.closedAngle ? 0 : 1,
    };
  }

  restoreState(snapshot: Readonly<ImportedApartmentDoorStateSnapshot>): boolean {
    if (typeof snapshot !== 'object'
      || snapshot === null
      || Array.isArray(snapshot)
      || Object.keys(snapshot).length !== 2
      || !Object.hasOwn(snapshot, 'progress')
      || !Object.hasOwn(snapshot, 'targetProgress')
      || !Number.isFinite(snapshot.progress)
      || snapshot.progress < 0
      || snapshot.progress > 1
      || (snapshot.targetProgress !== 0 && snapshot.targetProgress !== 1)) return false;

    const { progress, targetProgress } = snapshot;
    this.currentAngle = THREE.MathUtils.lerp(this.closedAngle, this.options.openAngle, progress);
    this.targetAngle = targetProgress === 0 ? this.closedAngle : this.options.openAngle;
    if (progress === 0 && targetProgress === 0) this.state = 'closed';
    else if (progress === 1 && targetProgress === 1) this.state = 'open';
    else this.state = targetProgress === 0 ? 'closing' : 'opening';

    this.pivot.rotation.y = this.currentAngle;
    this.pivot.updateMatrixWorld(true);
    this.setPrompt(null);
    this.setClosedColliderEnabled(progress === 0 && targetProgress === 0);
    return true;
  }

  update(delta: number, playerPosition: THREE.Vector3, viewDirection: THREE.Vector3, locked: boolean): void {
    const distanceFromClosed = Math.abs(this.currentAngle - this.closedAngle);
    if (this.state === 'closing' && distanceFromClosed < 0.22 && !this.doorwayClear(playerPosition)) {
      this.state = 'opening';
      this.targetAngle = this.options.openAngle;
    }

    if (Math.abs(this.currentAngle - this.targetAngle) > 0.0001) {
      const blend = 1 - Math.exp(-delta * 5.5);
      this.currentAngle = THREE.MathUtils.lerp(this.currentAngle, this.targetAngle, blend);
      if (Math.abs(this.currentAngle - this.targetAngle) < 0.002) {
        this.currentAngle = this.targetAngle;
        if (this.state === 'opening') this.state = 'open';
        if (this.state === 'closing') {
          if (!this.doorwayClear(playerPosition)) {
            this.state = 'opening';
            this.targetAngle = this.options.openAngle;
          } else {
            this.state = 'closed';
            if (!this.physics.hasChunk(this.options.chunkKey)) {
              this.physics.addChunk(this.options.chunkKey, [this.closedCollider], { x: 0, y: 0, z: 0 });
            }
          }
        }
      }
      this.pivot.rotation.y = this.currentAngle;
      this.pivot.updateMatrixWorld(true);
    }

    if (!locked || this.state === 'opening' || this.state === 'closing' || !this.rayHitsDoor(playerPosition, viewDirection)) {
      this.setPrompt(null);
      return;
    }
    this.setPrompt(this.state === 'open'
      ? 'Fermer la porte'
      : 'Ouvrir la porte');
  }

  interact(playerPosition: THREE.Vector3, viewDirection: THREE.Vector3, locked: boolean): boolean {
    if (!locked || this.state === 'opening' || this.state === 'closing') return false;
    if (!this.rayHitsDoor(playerPosition, viewDirection)) return false;

    if (this.state === 'closed') {
      this.state = 'opening';
      this.targetAngle = this.options.openAngle;
      this.setClosedColliderEnabled(false);
      this.setPrompt(null);
      return true;
    }

    if (this.state === 'open' && this.doorwayClear(playerPosition)) {
      this.state = 'closing';
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

  private setClosedColliderEnabled(enabled: boolean): void {
    if (enabled) {
      if (!this.physics.hasChunk(this.options.chunkKey)) {
        this.physics.addChunk(this.options.chunkKey, [this.closedCollider], { x: 0, y: 0, z: 0 });
      }
      return;
    }
    if (this.physics.hasChunk(this.options.chunkKey)) {
      this.physics.removeChunk(this.options.chunkKey);
    }
  }

  private setPrompt(message: string | null): void {
    if (this.lastPrompt === message) return;
    this.lastPrompt = message;
    this.ui.setInteraction(message);
  }
}
