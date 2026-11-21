import * as THREE from 'three';
import type { StairwellLightingProfile } from './StairwellEnvironment';
import { DEFAULT_BRIGHTNESS, resolveLightingBrightness } from '../render/LightingBrightness';
import { floorY, midLandingY, STAIRWELL_BOUNDS, STAIRWELL_FLIGHT_COUNT, STAIRWELL_LEVEL_COUNT, STAIRWELL_ROOF_Y, STAIRWELL_FLOOR_FINISH_THICKNESS } from './layout';

/** One stationary, shadowless source per authored fixture in this finite cage.
 * A fixed count of seven avoids both observer-dependent dark floors and shader
 * recompilation while walking. No sorting, movement or work on each frame. */
export class StairwellLightPool {
  readonly lights: THREE.PointLight[] = [];
  private readonly sources: Array<{ kind: 'main' | 'wall'; position: THREE.Vector3 }> = [];
  private gain = resolveLightingBrightness(DEFAULT_BRIGHTNESS).relativeGain;
  private power = 1;
  private chaseLighting = false;

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

  setPowered(powered: boolean): void { this.setPower(powered ? 1 : 0); }

  /** Scripted mains power (0 = blackout, 1 = normal); stays a scalar, never a light count change. */
  setPower(power: number): void {
    const next = Math.max(0, Math.min(1, Number.isFinite(power) ? power : 1));
    if (next === this.power) return;
    this.power = next;
    this.applyProfile();
  }

  /** Borrow the existing sources to outline treads, turns and the open hall door during the chase. */
  setChaseLighting(active: boolean): void {
    if (active === this.chaseLighting) return;
    this.chaseLighting = active;
    this.applyProfile();
  }

  private applyProfile(): void {
    this.lights.forEach((light, index) => {
      if (index === 0 && this.chaseLighting) {
        light.color.setHex(0xffe3a0);
        light.intensity = 1.85 * this.gain;
        light.distance = 8.5;
        light.position.set(0, 1.6, STAIRWELL_BOUNDS.minZ + 1.15);
        return;
      }
      const source = this.sources[index]!;
      const main = source.kind === 'main';
      light.position.copy(source.position);
      if (this.chaseLighting) {
        // Light the turns and nosings from closer to the walking surface.
        light.position.y = main ? floorY(index) + 1.55 : source.position.y - 0.45;
        light.position.z = main ? -1.65 : 1.9;
      }
      const guidance = this.chaseLighting ? (main ? 0.85 : 0.95) : 0;
      light.color.setHex(guidance > this.power ? 0xb8c7dc : main ? this.profile.mainColor : this.profile.wallColor);
      light.intensity = (main ? this.profile.mainIntensity : this.profile.wallIntensity) * this.gain * Math.max(this.power, guidance);
      light.distance = this.chaseLighting ? 6.5 : main ? this.profile.mainDistance : this.profile.wallDistance;
    });
  }
}
