import { describe, expect, it } from 'vitest';
import { distanceToRainOpening, rainOpeningAt, rainOpeningFromBlind } from './RainAcoustics';
import { interiorRainGainForDistance, rainExposureForBlindClosure } from './AudioSystem';

describe('rain around an actual window aperture', () => {
  const opening = rainOpeningAt({ x: 0, y: 1.4, z: 0 }, 2.46, 1.42);
  const gainAt = (x: number, z = .65) => interiorRainGainForDistance('stairwell-concrete',
    distanceToRainOpening({ x, y: 1.1, z }, opening));

  it('stays equally audible across the pane and remains audible beside the frame', () => {
    expect(gainAt(-1)).toBeCloseTo(gainAt(0));
    expect(gainAt(1)).toBeCloseTo(gainAt(0));
    expect(gainAt(1.9)).toBeGreaterThan(gainAt(0) * .85);
    expect(gainAt(2.6)).toBeGreaterThan(gainAt(0) * .65);
  });

  it('has no audible edge or distance cutoff and keeps close rain restrained', () => {
    for (let x = 1; x < 7; x += .1) expect(Math.abs(gainAt(x + .1) - gainAt(x))).toBeLessThan(.009);
    expect(gainAt(0, 6)).toBeGreaterThan(.05);
    expect(gainAt(0, 0)).toBeLessThan(.27);
    expect(gainAt(0, 15)).toBeLessThan(.03);
    expect(distanceToRainOpening({ x: 0, y: 5, z: .6 }, opening)).toBeGreaterThan(2.8);
  });

  it('uses the original full opening even while the imported blind changes height', () => {
    const bounds = { min: { x: -14, y: 10.1, z: 1 }, max: { x: -13.98, y: 10.5, z: 3.2 } };
    const fixed = rainOpeningFromBlind(bounds, 4);
    expect(fixed.min.y).toBeCloseTo(8.9);
    expect(distanceToRainOpening({ x: -13.4, y: 9.5, z: 2.9 }, fixed)).toBeCloseTo(.58);
    const open = interiorRainGainForDistance('apartment-wood', .58);
    const closed = interiorRainGainForDistance('apartment-wood', .58, rainExposureForBlindClosure(1));
    expect(closed).toBeLessThan(open * .11);
    bounds.min.z = 2;
    expect(fixed.min.z).toBe(1);
  });
});
