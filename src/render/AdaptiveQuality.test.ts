import { describe, expect, it } from 'vitest';
import { AdaptiveRenderScale, renderScaleLimits } from './AdaptiveQuality';

const advance = (
  controller: AdaptiveRenderScale,
  fps: number,
  seconds: number,
): number[] => {
  const changes: number[] = [];
  const delta = 0.1;
  for (let elapsed = 0; elapsed < seconds; elapsed += delta) {
    const next = controller.update(fps, delta);
    if (next !== null) changes.push(next);
  }
  return changes;
};

describe('adaptive render scale', () => {
  it('starts native on a normal desktop viewport', () => {
    expect(renderScaleLimits(1280, 720, 1, false)).toEqual({
      initial: 1,
      min: 0.68,
      max: 1,
    });
  });

  it('limits the first-frame pixel count on very large displays', () => {
    const limits = renderScaleLimits(3840, 2160, 2, false);
    expect(limits.initial).toBe(0.55);
    expect(limits.min).toBe(0.55);
    expect(limits.max).toBe(1);
    expect(3840 * 2160 * limits.initial ** 2).toBeLessThan(2_600_000);
  });

  it('reduces scale after a sustained miss and never below its floor', () => {
    const controller = new AdaptiveRenderScale({ initial: 1, min: 0.68, max: 1 });
    const changes = advance(controller, 40, 20);
    expect(changes.length).toBeGreaterThan(0);
    expect(controller.value).toBe(0.68);
    expect(Math.min(...changes)).toBeGreaterThanOrEqual(0.68);
  });

  it('does not react to a short frame-time spike', () => {
    const controller = new AdaptiveRenderScale({ initial: 1, min: 0.68, max: 1 });
    advance(controller, 60, 3);
    expect(advance(controller, 35, 0.7)).toEqual([]);
    expect(controller.value).toBe(1);
  });

  it('does not settle permanently in the high-fifties below the 60 FPS target', () => {
    const controller = new AdaptiveRenderScale({ initial: 0.84, min: 0.68, max: 1 });
    advance(controller, 57, 6);
    expect(controller.value).toBeLessThan(0.84);
  });

  it('restores detail slowly after performance becomes stable', () => {
    const controller = new AdaptiveRenderScale({ initial: 0.76, min: 0.68, max: 1 });
    const changes = advance(controller, 60, 11);
    expect(changes).toEqual([0.79]);
  });
});
