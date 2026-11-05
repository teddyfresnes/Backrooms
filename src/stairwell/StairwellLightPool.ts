import * as THREE from 'three';
import type { StairwellLightingProfile } from './StairwellEnvironment';
import { DEFAULT_BRIGHTNESS, resolveLightingBrightness } from '../render/LightingBrightness';
import { floorY, midLandingY, STAIRWELL_FLIGHT_COUNT, STAIRWELL_LEVEL_COUNT, STAIRWELL_ROOF_Y, STAIRWELL_FLOOR_FINISH_THICKNESS } from './layout';

/** One stationary, shadowless source per authored fixture in this finite cage.
 * A fixed count of seven avoids both observer-dependent dark floors and shader
 * recompilation while walking. No sorting, movement or work on each frame. */
export class StairwellLightPool {
  readonly lights: THREE.PointLight[] = [];
  private readonly sources: Array<{ kind: 'main' | 'wall'; position: THREE.Vector3 }> = [];
  private gain = resolveLightingBrightness(DEFAULT_BRIGHTNESS).relativeGain;
  private power = 1;

  constructor(private profile: StairwellLightingProfile) {
    for (let level = 0; level < STAIRWELL_LEVEL_COUNT; level++) {
      const ceiling = level < STAIRWELL_LEVEL_COUNT - 1
        ? floorY(level + 1) - STAIRWELL_FLOOR_FINISH_THICKNESS - .16 : STAIRWELL_ROOF_Y;
      this.sources.push({ kind: 'main', position: new THREE.Vector3(0, ceiling - .17, -2.35) });
    }
    for (let level = 0; level < STAIRWELL_FLIGHT_COUNT; level++) {
      this.sources.push({ kind: 'wall', position: new THREE.Vector3(0, midLandingY(level) + 2, 3.36) });
    }
    this.sources.forEach((source, index) => {
      const light = new THREE.PointLight(0xffffff, 0, 5.8, 2);
      light.name = `stairwell-local-light-${index}`;
      light.position.copy(source.position);
      this.lights.push(light);
    });
    this.applyProfile();
  }

  setProfile(profile: StairwellLightingProfile): void {
    this.profile = profile;
    this.applyProfile();
  }

  setBrightness(value: number): void {
    this.gain = resolveLightingBrightness(value).relativeGain;
    this.applyProfile();
  }

  /** Scripted mains power (0 = blackout, 1 = normal); stays a scalar, never a light count change. */
  setPower(power: number): void {
    const next = Math.max(0, Math.min(1, Number.isFinite(power) ? power : 1));
    if (next === this.power) return;
    this.power = next;
    this.applyProfile();
  }

  private applyProfile(): void {
    this.lights.forEach((light, index) => {
      const source = this.sources[index]!;
      light.color.setHex(source.kind === 'main' ? this.profile.mainColor : this.profile.wallColor);
      light.intensity = (source.kind === 'main' ? this.profile.mainIntensity : this.profile.wallIntensity) * this.gain * this.power;
      light.distance = source.kind === 'main' ? this.profile.mainDistance : this.profile.wallDistance;
    });
  }
}
