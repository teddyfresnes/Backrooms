/** Transverse progression bands: infinite in X, present on every owner story.
 * A northbound player cannot miss a stage by choosing another corridor/lane. */
export const NORTHERN_LAYOUT = {
  version: 1,
  chunkSize: 112,
  riftRow: -3,
  redFirstRow: -4,
  redRows: 2,
  slidesRow: -6,
} as const;
export const redZoneEntryZ = (NORTHERN_LAYOUT.redFirstRow + .5) * NORTHERN_LAYOUT.chunkSize;
export const redZoneExitZ = (NORTHERN_LAYOUT.redFirstRow - NORTHERN_LAYOUT.redRows + 1 - .5) * NORTHERN_LAYOUT.chunkSize;
export const isRedZoneRow = (z: number): boolean => z <= NORTHERN_LAYOUT.redFirstRow && z > NORTHERN_LAYOUT.redFirstRow - NORTHERN_LAYOUT.redRows;
export const isSlidesRow = (z: number): boolean => z === NORTHERN_LAYOUT.slidesRow;
export const isNorthernReservedRow = (z: number): boolean => isRedZoneRow(z) || isSlidesRow(z);
