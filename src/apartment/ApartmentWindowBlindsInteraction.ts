import * as THREE from 'three';
import type { Vec3Data } from '../world/types';
import type { ApartmentWindowBlindRuntime } from './ImportedApartmentEnvironment';

const EYE_OFFSET = 0.73;
const ANIMATION_RESPONSE = 8.5;
const SETTLED_EPSILON = 0.005;

export interface ApartmentWindowBlindsUI {
  setInteraction(message: string | null): void;
}

export type ApartmentWindowBlindsState = readonly [boolean, boolean];

interface BlindState {
  progress: number;
  targetProgress: 0 | 1;
}

/** Independent raycast and roll animation for the apartment's two blinds. */
export class ApartmentWindowBlindsInteraction {
  private readonly raycaster = new THREE.Raycaster();
  private readonly states: [BlindState, BlindState] = [
    { progress: 0, targetProgress: 0 },
    { progress: 0, targetProgress: 0 },
  ];
  private lastPrompt: string | null = null;

  constructor(
    private readonly blinds: readonly [ApartmentWindowBlindRuntime, ApartmentWindowBlindRuntime],
    private readonly ui: ApartmentWindowBlindsUI,
    private readonly maxRayDistance = 2.8,
    private readonly onToggle?: (opening: boolean) => void,
  ) {
    this.applyProgress(0, 0);
    this.applyProgress(1, 0);
  }

  update(
    delta: number,
    playerPosition: Readonly<Vec3Data>,
    viewDirection: THREE.Vector3,
    controlsLocked: boolean,
  ): void {
    const blend = 1 - Math.exp(-ANIMATION_RESPONSE * Math.max(0, delta));
    for (let index = 0; index < this.states.length; index += 1) {
      const state = this.states[index]!;
      if (Math.abs(state.progress - state.targetProgress) <= SETTLED_EPSILON) {
        state.progress = state.targetProgress;
      } else {
        state.progress = THREE.MathUtils.lerp(state.progress, state.targetProgress, blend);
      }
      this.applyProgress(index, state.progress);
    }

    const targetIndex = controlsLocked
      ? this.findTarget(playerPosition, viewDirection)
      : null;
    if (targetIndex === null || !this.isSettled(targetIndex)) {
      this.setPrompt(null);
      return;
    }
    this.setPrompt(this.states[targetIndex]!.targetProgress === 0
      ? 'Fermer les stores'
      : 'Ouvrir les stores');
  }

  interact(
    playerPosition: Readonly<Vec3Data>,
    viewDirection: THREE.Vector3,
    controlsLocked: boolean,
  ): boolean {
    if (!controlsLocked) return false;
    const targetIndex = this.findTarget(playerPosition, viewDirection);
    if (targetIndex === null || !this.isSettled(targetIndex)) return false;
    const state = this.states[targetIndex]!;
    state.targetProgress = state.targetProgress === 0 ? 1 : 0;
    this.onToggle?.(state.targetProgress === 0);
    this.setPrompt(null);
    return true;
  }

  getState(): ApartmentWindowBlindsState {
    return [
      this.states[0].targetProgress === 0,
      this.states[1].targetProgress === 0,
    ];
  }

  getClosureProgress(): readonly [number, number] {
    return [this.states[0].progress, this.states[1].progress];
  }

  restoreState(state: readonly boolean[]): boolean {
    if (state.length !== 2 || state.some((open) => typeof open !== 'boolean')) return false;
    state.forEach((open, index) => {
      const progress = open ? 0 : 1;
      this.states[index]!.progress = progress;
      this.states[index]!.targetProgress = progress;
      this.applyProgress(index, progress);
    });
    this.setPrompt(null);
    return true;
  }

  dispose(): void {
    this.setPrompt(null);
  }

  private isSettled(index: number): boolean {
    const state = this.states[index]!;
    return Math.abs(state.progress - state.targetProgress) <= SETTLED_EPSILON;
  }

  private applyProgress(index: number, progress: number): void {
    const blind = this.blinds[index]!;
    blind.pivot.scale.y = THREE.MathUtils.lerp(
      1,
      blind.closedScaleY,
      THREE.MathUtils.clamp(progress, 0, 1),
    );
    blind.pivot.updateMatrixWorld(true);
  }

  private findTarget(
    playerPosition: Readonly<Vec3Data>,
    viewDirection: THREE.Vector3,
  ): number | null {
    if (viewDirection.lengthSq() < 1e-5) return null;
    this.raycaster.set(
      new THREE.Vector3(playerPosition.x, playerPosition.y + EYE_OFFSET, playerPosition.z),
      viewDirection.clone().normalize(),
    );
    this.raycaster.near = 0;
    this.raycaster.far = this.maxRayDistance;

    let closestIndex: number | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    this.blinds.forEach((blind, index) => {
      blind.blind.updateWorldMatrix(true, true);
      const hit = this.raycaster.intersectObject(blind.blind, true)[0];
      if (hit && hit.distance < closestDistance) {
        closestDistance = hit.distance;
        closestIndex = index;
      }
    });
    return closestIndex;
  }

  private setPrompt(message: string | null): void {
    if (this.lastPrompt === message && message === null) return;
    this.lastPrompt = message;
    this.ui.setInteraction(message);
  }
}
