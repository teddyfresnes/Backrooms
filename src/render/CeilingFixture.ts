import * as THREE from 'three';
import type { LightSlot, WorldPlan } from '../world/types';
import { surfaceY } from '../world/WalkableTopology';

/** The diffuser sits entirely below the real roof, including sloping cages. */
export const ceilingFixturePose = (plan: WorldPlan, slot: LightSlot, position: THREE.Vector3, quaternion: THREE.Quaternion): void => {
  const roof = plan.spatial?.ceilings.find(s => slot.x >= s.bounds.minX && slot.x <= s.bounds.maxX && slot.z >= s.bounds.minZ && slot.z <= s.bounds.maxZ
    && Math.abs(surfaceY(s, slot.x, slot.z) - s.thickness - slot.ceilingY) < .002);
  const up = new THREE.Vector3(0, 1, 0), normal = up.clone();
  if (roof?.profile.kind === 'linear') {
    const p = roof.profile, b = roof.bounds, slope = (p.endY - p.startY) / (p.axis === 'x' ? b.maxX - b.minX : b.maxZ - b.minZ);
    normal.set(p.axis === 'x' ? -slope : 0, 1, p.axis === 'z' ? -slope : 0).normalize();
  }
  quaternion.setFromUnitVectors(up, normal).multiply(new THREE.Quaternion().setFromAxisAngle(up, slot.rotation));
  position.set(slot.x, roof ? surfaceY(roof, slot.x, slot.z) : slot.ceilingY, slot.z)
    .addScaledVector(normal, -(.036 + (roof?.thickness ?? 0)));
};
