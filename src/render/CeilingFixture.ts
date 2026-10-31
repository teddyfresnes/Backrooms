import * as THREE from 'three';
import type { LightSlot, WorldPlan } from '../world/types';
import { surfaceNormal, surfaceUndersideY, surfaceY } from '../world/WalkableTopology';

/** The diffuser sits entirely below the real roof, including sloping cages. */
export const ceilingFixturePose = (plan: WorldPlan, slot: LightSlot, position: THREE.Vector3, quaternion: THREE.Quaternion): void => {
  const roof = plan.spatial?.ceilings.find(s => slot.x >= s.bounds.minX && slot.x <= s.bounds.maxX && slot.z >= s.bounds.minZ && slot.z <= s.bounds.maxZ
    && Math.abs(surfaceUndersideY(s, slot.x, slot.z) - slot.ceilingY) < .002);
  const upperSlab = !roof ? plan.topology?.surfaces.find(s => s.ceilingProfile && slot.x >= s.bounds.minX && slot.x <= s.bounds.maxX && slot.z >= s.bounds.minZ && slot.z <= s.bounds.maxZ
    && Math.abs(surfaceY({ ...s, profile: s.ceilingProfile }, slot.x, slot.z) - slot.ceilingY) < .002) : undefined;
  const up = new THREE.Vector3(0, 1, 0), normal = roof ? new THREE.Vector3().copy(surfaceNormal(roof))
    : upperSlab ? new THREE.Vector3().copy(surfaceNormal({ ...upperSlab, profile: upperSlab.ceilingProfile! })) : up.clone();
  quaternion.setFromUnitVectors(up, normal).multiply(new THREE.Quaternion().setFromAxisAngle(up, slot.rotation));
  position.set(slot.x, roof ? surfaceUndersideY(roof, slot.x, slot.z) : slot.ceilingY, slot.z)
    .addScaledVector(normal, -.036);
};
