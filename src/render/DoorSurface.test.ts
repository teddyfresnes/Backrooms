import * as THREE from 'three';
import { expect, it } from 'vitest';
import { softenDoorSurface } from './DoorSurface';

it('makes opaque imported doors matte even with a dark roughness map, keeping glass intact', () => {
  const map = new THREE.Texture(), material = new THREE.MeshPhysicalMaterial({ metalness: 1, roughness: .05, roughnessMap: map, clearcoat: 1 });
  softenDoorSurface(material);
  expect(material.metalness).toBeLessThan(.05); expect(material.clearcoat).toBe(0);
  expect(material.specularIntensity).toBeLessThan(.2); expect(material.roughnessMap).toBe(map);
  expect(material.userData.matteRoughness[0]).toBeGreaterThan(.8);
  const glass = new THREE.MeshPhysicalMaterial({ transparent: true, opacity: .2, roughness: .4 }); softenDoorSurface(glass);
  expect(glass.opacity).toBe(.2); expect(glass.roughness).toBe(.4);
  material.dispose(); glass.dispose(); map.dispose();
});
