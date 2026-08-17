import * as THREE from 'three';
import type { Vec3Data } from '../world/types';

const EYE_OFFSET = 0.73;

export interface HallExitInteractionUI {
  setInteraction(message: string | null): void;
}

/** Turns the imported ground-floor hall door into a one-way level portal. */
export class HallExitInteraction {
  private readonly raycaster = new THREE.Raycaster();
  private lastPrompt: string | null = null;
  private activated = false;

  constructor(
    private readonly door: THREE.Object3D,
    private readonly ui: HallExitInteractionUI,
    private readonly onEnterBackrooms: () => void,
    private readonly maxRayDistance = 3.2,
  ) {}

  update(
    playerPosition: Readonly<Vec3Data>,
    viewDirection: THREE.Vector3,
    locked: boolean,
  ): void {
    this.setPrompt(
      !this.activated && locked && this.rayHitsDoor(playerPosition, viewDirection)
        ? 'Entrer dans les Backrooms'
        : null,
    );
  }

  interact(
    playerPosition: Readonly<Vec3Data>,
    viewDirection: THREE.Vector3,
    locked: boolean,
  ): boolean {
    if (this.activated || !locked || !this.rayHitsDoor(playerPosition, viewDirection)) {
      return false;
    }
    this.activated = true;
    this.setPrompt(null);
    this.onEnterBackrooms();
    return true;
  }

  dispose(): void {
    this.activated = true;
    this.setPrompt(null);
  }

  private rayHitsDoor(
    playerPosition: Readonly<Vec3Data>,
    viewDirection: THREE.Vector3,
  ): boolean {
    if (viewDirection.lengthSq() < 1e-5) return false;
    this.door.updateWorldMatrix(true, true);
    this.raycaster.set(
      new THREE.Vector3(playerPosition.x, playerPosition.y + EYE_OFFSET, playerPosition.z),
      viewDirection.clone().normalize(),
    );
    this.raycaster.near = 0;
    this.raycaster.far = this.maxRayDistance;
    return this.raycaster.intersectObject(this.door, true).length > 0;
  }

  private setPrompt(message: string | null): void {
    if (message === this.lastPrompt && message === null) return;
    this.lastPrompt = message;
    this.ui.setInteraction(message);
  }
}
