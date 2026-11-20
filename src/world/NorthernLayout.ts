/** Transverse progression bands: infinite in X, present on every owner story.
 * A northbound player cannot miss a stage by choosing another corridor/lane. */
export const NORTHERN_LAYOUT = {
  version: 2,
  chunkSize: 112,
  riftRow: -3,
  redFirstRow: -4,
  redRows: 2,
  slidesRow: -5,
  slidesColumnSpacing: 4,
} as const;
export const redZoneEntryZ = (NORTHERN_LAYOUT.redFirstRow + .5) * NORTHERN_LAYOUT.chunkSize;
export const redZoneExitZ = (NORTHERN_LAYOUT.redFirstRow - NORTHERN_LAYOUT.redRows + 1 - .5) * NORTHERN_LAYOUT.chunkSize;
export const isRedZoneRow = (z: number): boolean => z <= NORTHERN_LAYOUT.redFirstRow && z > NORTHERN_LAYOUT.redFirstRow - NORTHERN_LAYOUT.redRows;
export const isSlidesRow = (z: number): boolean => z === NORTHERN_LAYOUT.slidesRow;
export const isNorthernReservedRow = (z: number): boolean => isRedZoneRow(z) || isSlidesRow(z);
/** One landmark per 448 m transverse sector, on every physical owner story. */
export const slidesColumnAt = (x: number): number => Math.floor((x + NORTHERN_LAYOUT.slidesColumnSpacing / 2) / NORTHERN_LAYOUT.slidesColumnSpacing) * NORTHERN_LAYOUT.slidesColumnSpacing;
export const isSlidesStructureCoord = (c: { x: number; z: number }): boolean => isSlidesRow(c.z) && c.x === slidesColumnAt(c.x);
export const nearestSlidesCoord = (c: { x: number; story: number }): { x: number; z: number; story: number } => ({ x: slidesColumnAt(c.x), z: NORTHERN_LAYOUT.slidesRow, story: c.story });
