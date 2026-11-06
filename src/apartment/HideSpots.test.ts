import { describe, expect, it } from 'vitest';
import { HideSpots, type HidingPlace } from './HideSpots';

const place = (): HidingPlace & { active: boolean } => ({
  active: false, exitLocked: false, isTargeted: false, doorProgress: 0,
  get isActive() { return this.active; },
  interact() { return true; }, enterNow() { this.active = true; }, requestExit() { this.exitLocked = false; },
  forceFinish() { this.active = false; }, holdExit() {}, burstOut() {}, update() {}, dispose() {},
});

describe('hiding places', () => {
  it('locks only the place in use, so the others still open with E after a scripted hide', () => {
    const wardrobe = place(), bathroom = place(), closet = place();
    const spots = new HideSpots({ wardrobe, bathroom, closet });
    spots.enterNow('wardrobe');
    spots.exitLocked = true;
    expect(wardrobe.exitLocked).toBe(true);
    expect(bathroom.exitLocked).toBe(false); expect(closet.exitLocked).toBe(false);
    spots.requestExit(); wardrobe.active = false;
    expect([wardrobe, bathroom, closet].every(spot => !spot.exitLocked)).toBe(true);
  });
});
