import * as THREE from 'three';
import { STAIRWELL_BOUNDS, STAIRWELL_WALL_THICKNESS } from './layout';

/** Preserve all source hinges while facing the opposite wall into the hall. */
export function createHallMailbox(template: THREE.Object3D, entranceWallZ: number): THREE.Object3D {
  template.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(template).getSize(new THREE.Vector3());
  if (Math.min(size.x, size.y, size.z) <= .0001) throw new Error('Modèle de boîtes aux lettres invalide.');
  const mailbox = template.clone(true);
  mailbox.name = 'hall-entrance-mailbox';
  mailbox.rotation.y = Math.PI / 2;
  mailbox.scale.setScalar(Math.min(1.95 / size.x, 1.38 / size.y));
  mailbox.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(mailbox);
  const center = bounds.getCenter(new THREE.Vector3());
  mailbox.position.set(
    STAIRWELL_BOUNDS.minX + STAIRWELL_WALL_THICKNESS + .006 - bounds.min.x,
    1.42 - center.y, entranceWallZ + 1.18 - center.z,
  );
  mailbox.traverse(object => { object.userData.noBatch = true; });
  mailbox.updateMatrixWorld(true);
  return mailbox;
}
