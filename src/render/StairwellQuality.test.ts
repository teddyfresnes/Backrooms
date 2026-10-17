import { describe, expect, it } from 'vitest';
import { StairwellQuality, stairwellRenderScaleLimits } from './StairwellQuality';

describe('stairwell performance fallback', () => {
  it('can reach a modest pixel budget on a 4K display while starting at the normal quality', () => {
    const limits = stairwellRenderScaleLimits(3840, 2160, 2, false);
    expect(limits.initial).toBe(.55);
    expect(3840 * 2160 * limits.min ** 2).toBeLessThanOrEqual(850_000);
    expect(stairwellRenderScaleLimits(1280, 720, 1, false).min).toBe(.68);
  });

  it('drops costly effects on sustained low FPS and resists flickering quality changes', () => {
    const quality = new StairwellQuality();
    for (let i = 0; i < 8; i++) expect(quality.update('auto', 25, .1)).toBe(false);
    for (let i = 0; i < 12; i++) quality.update('auto', 25, .1);
    expect(quality.update('auto', 60, .1)).toBe(true);
    for (let i = 0; i < 100; i++) expect(quality.update('auto', 60, .1)).toBe(true);
    for (let i = 0; i < 110; i++) quality.update('auto', 60, .1);
    expect(quality.update('auto', 60, .1)).toBe(false);
  });

  it('honors explicit settings and ignores a stalled/hidden tab', () => {
    const quality = new StairwellQuality();
    expect(quality.update('performance', 60, 0)).toBe(true);
    expect(quality.update('quality', 15, 0)).toBe(false);
    expect(quality.update('auto', 1, 120)).toBe(false);
    expect(quality.update('auto', NaN, .1)).toBe(false);
  });
});
