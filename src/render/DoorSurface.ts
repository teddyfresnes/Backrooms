import * as THREE from 'three';
import { applyMatteSurface } from './MatteSurface';

/** Dry painted doors keep texture detail without point-light mirror highlights. */
export function softenDoorSurface(material: THREE.Material): void {
  if (!(material instanceof THREE.MeshStandardMaterial) || material.transparent) return;
  material.roughness = .95; material.metalness = .025; material.envMapIntensity = .05;
  if (material instanceof THREE.MeshPhysicalMaterial) {
    material.clearcoat = 0; material.transmission = 0; material.specularIntensity = .1;
  }
  applyMatteSurface(material, [.86, .99]);
}
