import * as THREE from 'three';
import type { StairwellLightingProfile } from './StairwellEnvironment';
import { floorY, midLandingY, STAIRWELL_FLIGHT_COUNT, STAIRWELL_LEVEL_COUNT, STAIRWELL_ROOF_Y, STAIRWELL_FLOOR_FINISH_THICKNESS } from './layout';

/** A constant shader light count, independent of the number of storeys. */
export class StairwellLightPool {
  readonly lights = Array.from({ length: 4 }, (_, index) => {
    const light = new THREE.PointLight(0xffffff, 0, 5.8, 2);
    light.name = `stairwell-local-light-${index}`;
    return light;
  });
  private readonly sources: Array<{ kind: 'main' | 'wall'; position: THREE.Vector3 }> = [];
  private readonly candidates: number[] = [];
  private viewerHeight = Infinity;

  constructor(private profile: StairwellLightingProfile) {
    for (let level = 0; level < STAIRWELL_LEVEL_COUNT; level++) {
      const ceiling = level < STAIRWELL_LEVEL_COUNT - 1
        ? floorY(level + 1) - STAIRWELL_FLOOR_FINISH_THICKNESS - .16 : STAIRWELL_ROOF_Y;
      this.sources.push({ kind: 'main', position: new THREE.Vector3(0, ceiling - .17, -2.35) });
    }
    for (let level = 0; level < STAIRWELL_FLIGHT_COUNT; level++) {
      this.sources.push({ kind: 'wall', position: new THREE.Vector3(0, midLandingY(level) + 2, 3.36) });
    }
    this.candidates = this.sources.map((_, index) => index);
    this.update(floorY(STAIRWELL_LEVEL_COUNT - 1) + 1.65);
  }

  setProfile(profile: StairwellLightingProfile): void {
    this.profile = profile;
    const y = this.viewerHeight; this.viewerHeight = Infinity; this.update(y);
  }

  update(height: number): void {
    if (!Number.isFinite(height) || Math.abs(height - this.viewerHeight) < .12) return;
    this.viewerHeight = height;
    this.candidates.sort((a, b) => Math.abs(this.sources[a]!.position.y - height) - Math.abs(this.sources[b]!.position.y - height));
    this.lights.forEach((light, index) => {
      const source = this.sources[this.candidates[index]!]!;
      light.position.copy(source.position);
      light.color.setHex(source.kind === 'main' ? this.profile.mainColor : this.profile.wallColor);
      light.intensity = source.kind === 'main' ? this.profile.mainIntensity : this.profile.wallIntensity;
      light.distance = source.kind === 'main' ? this.profile.mainDistance : this.profile.wallDistance;
    });
  }
}
