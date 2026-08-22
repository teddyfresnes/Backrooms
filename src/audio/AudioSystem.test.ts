import { describe, expect, it } from 'vitest';
import {
  interiorRainGainForDistance,
  interiorRainRoomBleedGain,
  landingKindForSpeed,
  rainExposureForBlindClosure,
  sprintFootstepGain,
  walkingFootstepGain,
} from './AudioSystem';

describe('landingKindForSpeed', () => {
  it('keeps tiny, ordinary, heavy and extreme falls acoustically distinct', () => {
    expect(landingKindForSpeed(2.5)).toBe('light');
    expect(landingKindForSpeed(6)).toBe('medium');
    expect(landingKindForSpeed(12)).toBe('heavy');
    expect(landingKindForSpeed(17.5)).toBe('traumatic');
  });

  it('uses stable category boundaries', () => {
    expect(landingKindForSpeed(4.5)).toBe('medium');
    expect(landingKindForSpeed(9)).toBe('heavy');
    expect(landingKindForSpeed(17)).toBe('traumatic');
  });
});

describe('movement footstep mix', () => {
  it('keeps crouching quiet and makes sprinting clearly dominate walking', () => {
    const crouch = walkingFootstepGain(0.45);
    const walk = walkingFootstepGain(0.72);

    expect(crouch).toBeLessThan(walk * 0.4);
    expect(sprintFootstepGain).toBeGreaterThan(walk * 7);
  });
});

describe('interiorRainGainForDistance', () => {
  it('raises the rain continuously throughout the approach to an apartment window', () => {
    const gains = [5, 4, 3, 2, 1].map((distance) =>
      interiorRainGainForDistance('apartment-wood', distance));

    for (let index = 1; index < gains.length; index += 1) {
      expect(gains[index]).toBeGreaterThan(gains[index - 1]!);
    }
    expect(interiorRainGainForDistance('stairwell-concrete', 0))
      .toBe(interiorRainGainForDistance('apartment-wood', 0));
  });

  it('raises the same exterior rain near hall doors and windows', () => {
    const far = interiorRainGainForDistance('stairwell-concrete', 6);
    const approaching = interiorRainGainForDistance('stairwell-concrete', 2.5);
    const againstGlass = interiorRainGainForDistance('stairwell-concrete', 0.4);

    expect(approaching).toBeGreaterThan(far);
    expect(againstGlass).toBeGreaterThan(approaching);
  });

  it('drastically muffles an apartment window as its blind closes', () => {
    const open = interiorRainGainForDistance(
      'apartment-wood',
      0,
      rainExposureForBlindClosure(0),
    );
    const halfClosed = interiorRainGainForDistance(
      'apartment-wood',
      0,
      rainExposureForBlindClosure(0.5),
    );
    const closed = interiorRainGainForDistance(
      'apartment-wood',
      0,
      rainExposureForBlindClosure(1),
    );

    expect(halfClosed).toBeLessThan(open);
    expect(closed).toBeLessThan(open * 0.1);
  });

  it('keeps a quiet room-wide rain bed while at least one blind is open', () => {
    const openRoom = interiorRainRoomBleedGain(rainExposureForBlindClosure(0));
    const closedRoom = interiorRainRoomBleedGain(rainExposureForBlindClosure(1));

    expect(openRoom).toBeGreaterThan(0.06);
    expect(openRoom).toBeLessThan(interiorRainGainForDistance('apartment-wood', 1));
    expect(closedRoom).toBeLessThan(openRoom * 0.3);
  });
});
