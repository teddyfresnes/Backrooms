import * as THREE from 'three';
import type { Vec3Data } from '../world/types';

const EYE_OFFSET = 0.73;

export interface ApartmentLightSwitchUI {
  setInteraction(message: string | null): void;
}

/** Raycast interaction for the switch mounted inside the imported apartment. */
export class ApartmentLightSwitchInteraction {
  private readonly raycaster = new THREE.Raycaster();
  private readonly switchWorldPosition = new THREE.Vector3();
  private lastPrompt: string | null = null;

  constructor(
    private readonly target: THREE.Object3D,
    private readonly ui: ApartmentLightSwitchUI,
    private readonly isEnabled: () => boolean,
    private readonly setEnabled: (enabled: boolean) => void,
    private readonly maxRayDistance = 2.2,
  ) {}

  update(
    playerPosition: Readonly<Vec3Data>,
    viewDirection: THREE.Vector3,
    locked: boolean,
  ): void {
    this.setPrompt(locked && this.rayHitsSwitch(playerPosition, viewDirection)
      ? this.isEnabled() ? 'Éteindre la lumière' : 'Allumer la lumière'
      : null);
  }

  interact(
    playerPosition: Readonly<Vec3Data>,
    viewDirection: THREE.Vector3,
    locked: boolean,
  ): boolean {
    if (!locked || !this.rayHitsSwitch(playerPosition, viewDirection)) return false;
    this.setEnabled(!this.isEnabled());
    this.setPrompt(null);
    return true;
  }

  dispose(): void {
    this.setPrompt(null);
  }

  private rayHitsSwitch(
    playerPosition: Readonly<Vec3Data>,
    viewDirection: THREE.Vector3,
  ): boolean {
    if (viewDirection.lengthSq() < 1e-5) return false;
    this.target.updateWorldMatrix(true, true);
    this.target.getWorldPosition(this.switchWorldPosition);
    // The plate is mounted on the apartment-facing side of the east wall.
    // Reject rays coming from the landing so it cannot be operated through the
    // closed wall or door frame.
    if (playerPosition.x > this.switchWorldPosition.x - 0.045) return false;
    this.raycaster.set(
      new THREE.Vector3(playerPosition.x, playerPosition.y + EYE_OFFSET, playerPosition.z),
      viewDirection.clone().normalize(),
    );
    this.raycaster.near = 0;
    this.raycaster.far = this.maxRayDistance;
    return this.raycaster.intersectObject(this.target, true).length > 0;
  }

  private setPrompt(message: string | null): void {
    if (message === this.lastPrompt && message === null) return;
    this.lastPrompt = message;
    this.ui.setInteraction(message);
  }
}
