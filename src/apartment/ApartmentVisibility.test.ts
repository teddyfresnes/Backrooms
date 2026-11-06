import { describe, expect, it } from 'vitest';
import { isApartmentInteriorVisible } from './ApartmentVisibility';
import { APARTMENT_FLOOR_Y } from './layout';

describe('apartment portal visibility', () => {
  it('keeps the concealed interior out of the render traversal on lower landings and behind a closed door', () => {
    expect(isApartmentInteriorVisible({ x: 0, y: 1.65 }, 1.4, APARTMENT_FLOOR_Y)).toBe(false);
    expect(isApartmentInteriorVisible({ x: -1, y: 10.25 }, 0, APARTMENT_FLOOR_Y)).toBe(false);
  });

  it('shows the model before the door reveals it and keeps it visible from inside', () => {
    expect(isApartmentInteriorVisible({ x: -1, y: 10.25 }, .03, APARTMENT_FLOOR_Y)).toBe(true);
    expect(isApartmentInteriorVisible({ x: -6, y: 10.25 }, 0, APARTMENT_FLOOR_Y)).toBe(true);
    expect(isApartmentInteriorVisible({ x: -2.04, y: 9.1 }, 0, APARTMENT_FLOOR_Y)).toBe(true);
  });
});
