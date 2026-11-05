import { APARTMENT_ENTRY_DOOR } from './layout';

/** The opaque landing floor and closed entrance completely conceal this model. */
export function isApartmentInteriorVisible(
  viewer: Readonly<{ x: number; y: number }>, doorAngle: number, floorY: number,
): boolean {
  if (viewer.y < floorY - .08) return false;
  if (viewer.x < APARTMENT_ENTRY_DOOR.wallFaceX + .30) return true;
  // Mount before the first visible crack, including the last closing frame.
  return Math.abs(doorAngle) > .00001;
}
