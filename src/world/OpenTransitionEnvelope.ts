import type { SpatialPrism } from './SpatialTypes';
import { ownedProfilePrisms } from './CeilingEnvelope';
import { transitionRoofBounds } from './TransitionLayout';
import { cutRects, surfaceRange } from './WalkableTopology';
import { restrictProfile } from './TransitionLayout';
import { rectDepth, rectWidth, type Rect, type WorldPlan } from './types';
import { profilePrism } from './SpatialGeometry';

/** Close the exposed plenum of a real room slab where an open flight cuts it.
 * The next owner's actual floor is the cap. This is a vertical slab edge, not
 * a suspended flight roof or a wall filling the intentionally open stairwell. */
export const completeOpenTransitionEnvelope = (world: WorldPlan, add: (p: SpatialPrism) => void): void => {
  const spatial = world.spatial!;
  for (const t of spatial.transitions!.filter(t => t.roofPolicy === 'room' && t.roomRoofJoin)) {
    const b = { ...t.bounds }, reverse = t.axis === 'x' ? t.approach.bounds.minX > t.run.minX : t.approach.bounds.minZ > t.run.minZ;
    if (t.axis === 'x') { if (reverse) b.maxX = b.minX + .06; else b.minX = b.maxX - .06; }
    else { if (reverse) b.maxZ = b.minZ + .06; else b.minZ = b.maxZ - .06; }
    add(profilePrism(`${t.id}/room-roof-join`, b, { kind: 'flat', y: t.roomRoofJoin!.bottom }, { kind: 'flat', y: t.roomRoofJoin!.top }, 'plaster'));
  }
  const cuts = spatial.transitions!.filter(t => t.roofPolicy === 'upper-slab').flatMap(t => [
    t.approach.bounds, transitionRoofBounds(t, t.run), transitionRoofBounds(t, t.landing.bounds),
  ]).filter(b => rectWidth(b) > .005 && rectDepth(b) > .005);
  const occupied = world.walls.map(w => ({ minX: w.x - (w.orientation === 'x' ? w.length : w.thickness) / 2,
    maxX: w.x + (w.orientation === 'x' ? w.length : w.thickness) / 2,
    minZ: w.z - (w.orientation === 'z' ? w.length : w.thickness) / 2, maxZ: w.z + (w.orientation === 'z' ? w.length : w.thickness) / 2,
    top: w.bottom + w.height, bottom: w.bottom }));
  const made = new Set<string>();
  for (const roof of spatial.ceilings) {
    const cell = spatial.cells.find(c => c.mode === 'rooms' && roof.roomId?.startsWith(c.id + '/'));
    if (!cell || roof.id.includes('/heritage/')) continue;
    const b = roof.bounds, top = cell.floorY + 5.24;
    for (const cut of cuts) for (const side of ['west', 'east', 'north', 'south'] as const) {
      const alongX = side === 'north' || side === 'south';
      const fixed = side === 'west' ? b.minX : side === 'east' ? b.maxX : side === 'north' ? b.minZ : b.maxZ;
      const opposite = side === 'west' ? cut.maxX : side === 'east' ? cut.minX : side === 'north' ? cut.maxZ : cut.minZ;
      if (Math.abs(fixed - opposite) > .001) continue;
      const lo = Math.max(alongX ? b.minX : b.minZ, alongX ? cut.minX : cut.minZ);
      const hi = Math.min(alongX ? b.maxX : b.maxZ, alongX ? cut.maxX : cut.maxZ);
      if (hi - lo < .005 || surfaceRange(roof)[0] >= top - .005) continue;
      const depth = Math.min(.12, (alongX ? rectDepth(b) : rectWidth(b)) / 2);
      const strip: Rect = alongX ? { minX: lo, maxX: hi, minZ: side === 'north' ? fixed : fixed - depth, maxZ: side === 'north' ? fixed + depth : fixed }
        : { minZ: lo, maxZ: hi, minX: side === 'west' ? fixed : fixed - depth, maxX: side === 'west' ? fixed + depth : fixed };
      const key = JSON.stringify([strip, top]); if (made.has(key)) continue; made.add(key);
      const solidWalls = occupied.filter(w => w.bottom <= surfaceRange(roof)[0] + .001 && w.top >= top - .001);
      for (const [i, bounds] of cutRects([strip], solidWalls).entries())
        for (const prism of ownedProfilePrisms(`${roof.id}/open-slab-return-${side}-${made.size}-${i}`, bounds,
          restrictProfile(roof.bounds, roof.profile, bounds), { kind: 'flat', y: top }, cell.floorY - .16, top)) add(prism);
    }
  }
};
