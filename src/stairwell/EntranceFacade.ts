import * as THREE from 'three';
import { makeBox } from './geometry';
import { STAIRWELL_BOUNDS, STAIRWELL_WALL_THICKNESS, STAIRWELL_ENTRANCE_WIDTH,
  STAIRWELL_ENTRANCE_HEIGHT, STAIRWELL_FLOOR_HEIGHT, STAIRWELL_ROOF_Y } from './layout';

/** Continue the wings up to the real entrance opening. The wing masses start
 * at the cage's outer walls, leaving a visible gap beside each door jamb. */
export function createEntranceFacade(material: THREE.Material): THREE.Group {
  const group = new THREE.Group(); group.name = 'continuous-entrance-facade';
  const halfOpening = STAIRWELL_ENTRANCE_WIDTH / 2;
  const front = STAIRWELL_BOUNDS.minZ - STAIRWELL_WALL_THICKNESS / 2 - .025;
  for (const side of [-1, 1]) {
    const outer = Math.abs(side < 0 ? STAIRWELL_BOUNDS.minX : STAIRWELL_BOUNDS.maxX) + .05;
    const width = outer - halfOpening;
    group.add(makeBox(`entrance-masonry-${side}`, [width, STAIRWELL_ROOF_Y, .24],
      [side * (halfOpening + width / 2), STAIRWELL_ROOF_Y / 2, front + .12], material));
  }
  const header = STAIRWELL_FLOOR_HEIGHT - STAIRWELL_ENTRANCE_HEIGHT;
  if (header > 0) group.add(makeBox('entrance-masonry-lintel', [STAIRWELL_ENTRANCE_WIDTH, header, .24],
    [0, STAIRWELL_ENTRANCE_HEIGHT + header / 2, front + .12], material));
  return group;
}
