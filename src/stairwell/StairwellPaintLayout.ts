import { APARTMENT_ENTRY_DOOR } from '../apartment/layout';
import { floorY, midLandingY, STAIRWELL_MAIN_LANDING as MAIN, STAIRWELL_MID_LANDING as MID,
  STAIRWELL_LEVEL_COUNT, STAIRWELL_FLIGHT_COUNT, STAIRWELL_ENTRANCE_WIDTH, STAIRWELL_WINDOW_WIDTH,
  STAIRWELL_WINDOW_SILL, STAIRWELL_STEP_DEPTH, STAIRWELL_STEP_RISE, STAIRWELL_STEPS_PER_FLIGHT } from './layout';
import type { StairwellWall } from './StairwellSurfaceFinish';

export interface StairwellPaintPatch {
  wall: StairwellWall;
  points: Array<{ along: number; height: number }>;
}

/** The approved v16 paint footprint, projected onto masonry instead of overlay meshes. */
export function stairwellPaintPatches(): StairwellPaintPatch[] {
  const patches: StairwellPaintPatch[] = [];
  const rectangle = (wall: StairwellWall, min: number, max: number, bottom: number, top: number) => {
    if (max <= min) return;
    patches.push({ wall, points: [{ along: min, height: bottom }, { along: max, height: bottom },
      { along: max, height: top }, { along: min, height: top }] });
  };
  const doorMin = APARTMENT_ENTRY_DOOR.centerZ - APARTMENT_ENTRY_DOOR.width / 2 - .06;
  const doorMax = APARTMENT_ENTRY_DOOR.centerZ + APARTMENT_ENTRY_DOOR.width / 2 + .06;
  for (let level = 0; level < STAIRWELL_LEVEL_COUNT; level++) {
    const y = floorY(level);
    for (const side of ['west', 'east'] as const) {
      rectangle(side, MAIN.minZ + .02, Math.min(MAIN.maxZ - .02, doorMin), y, y + .98);
      const extension = (side === 'west' && level < STAIRWELL_LEVEL_COUNT - 1) || level === 0 ? .28 : 0;
      rectangle(side, Math.max(MAIN.minZ + .02, doorMax), MAIN.maxZ - .02 + extension, y, y + .98);
    }
    const opening = level === 0 ? STAIRWELL_ENTRANCE_WIDTH : STAIRWELL_WINDOW_WIDTH;
    const halfWidth = (MAIN.maxX - MAIN.minX - .04) / 2;
    rectangle('south', -halfWidth, -opening / 2, y, y + .98);
    rectangle('south', opening / 2, halfWidth, y, y + .98);
    if (level > 0) rectangle('south', -(opening + .06) / 2, (opening + .06) / 2,
      y, y + Math.min(.98, STAIRWELL_WINDOW_SILL + .06));
    if (level < STAIRWELL_FLIGHT_COUNT) {
      const mid = midLandingY(level);
      rectangle('west', MID.minZ + .02, MID.maxZ - .02, mid, mid + .98);
      rectangle('east', MID.minZ + .02 - .18, MID.maxZ - .02, mid, mid + .98);
      rectangle('north', MID.minX + .02, MID.maxX - .02, mid, mid + .98);
    }
  }
  const run = STAIRWELL_STEP_DEPTH * STAIRWELL_STEPS_PER_FLIGHT;
  const rise = STAIRWELL_STEP_RISE * STAIRWELL_STEPS_PER_FLIGHT;
  const angle = Math.atan2(rise, run), length = Math.hypot(run, rise) + .34;
  const liftY = Math.cos(angle) * (1.16 - .86) / 2;
  const liftZ = Math.sin(angle) * (1.16 - .86) / 2;
  for (let level = 0; level < STAIRWELL_FLIGHT_COUNT; level++) {
    for (const wall of ['west', 'east'] as const) {
      const rotation = wall === 'west' ? -angle : angle;
      const cy = (wall === 'west' ? floorY(level) : midLandingY(level)) + rise / 2 + 1.16 * .34 + liftY;
      const cz = wall === 'west' ? .17 - liftZ : -.17 + liftZ;
      patches.push({ wall, points: [[-length / 2, -.43], [length / 2, -.43], [length / 2, .43], [-length / 2, .43]]
        .map(([z, y]) => ({ along: cz + y! * Math.sin(rotation) + z! * Math.cos(rotation),
          height: cy + y! * Math.cos(rotation) - z! * Math.sin(rotation) })) });
    }
  }
  return patches;
}

export function containsPaint(patch: StairwellPaintPatch, along: number, height: number): boolean {
  let inside = false;
  for (let i = 0, j = patch.points.length - 1; i < patch.points.length; j = i++) {
    const a = patch.points[i]!, b = patch.points[j]!;
    if ((a.height > height) !== (b.height > height)
      && along < (b.along - a.along) * (height - a.height) / (b.height - a.height) + a.along) inside = !inside;
  }
  return inside;
}
