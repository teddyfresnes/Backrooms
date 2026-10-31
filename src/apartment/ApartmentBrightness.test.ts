import { expect, it } from 'vitest';
import * as THREE from 'three';
import { ImportedApartmentEnvironment } from './ImportedApartmentEnvironment';
import { resolveLightingBrightness } from '../render/LightingBrightness';

it('keeps the apartment switch authoritative through brightness changes and restores the chosen source intensity', () => {
  // Exercise the real public controls with a fixture-only scene: model parsing
  // and door construction are unrelated to the light-switch state contract.
  const apartment = Object.create(ImportedApartmentEnvironment.prototype) as ImportedApartmentEnvironment;
  const light = new THREE.PointLight(), indicator = new THREE.MeshBasicMaterial(), fixture = new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: 1.18 });
  Object.assign(apartment, { interiorLightsEnabled: false, interiorLights: [{ light, intensity: 1.35 }],
    interiorMaterialStates: [{ material: fixture, litColor: fixture.color.clone(), litEmissive: fixture.emissive.clone(), litEmissiveIntensity: 1.18 }],
    lightSwitch: new THREE.Group(), lightSwitchIndicator: indicator });
  try {
    for (const value of [0, 50, 100]) {
      apartment.setBrightness(value); expect(apartment.areInteriorLightsEnabled).toBe(false); expect(light.intensity).toBe(0);
      apartment.setInteriorLightsEnabled(true); expect(light.intensity).toBeCloseTo(1.35 * resolveLightingBrightness(value).relativeGain);
      expect(fixture.emissiveIntensity).toBe(1.18);
      apartment.setInteriorLightsEnabled(false); expect(light.intensity).toBe(0);
    }
    apartment.setInteriorLightsEnabled(true); apartment.setBrightness(0); expect(apartment.areInteriorLightsEnabled).toBe(true);
    apartment.setBrightness(100); expect(light.intensity).toBeCloseTo(1.35); expect(fixture.emissiveIntensity).toBe(1.18);
  } finally { indicator.dispose(); fixture.dispose(); }
});
