const TARGET_FPS = 60;
const DEGRADE_BELOW_FPS = 58;
const RECOVER_ABOVE_FPS = 59;
const DEGRADE_AFTER_SECONDS = 1.1;
const RECOVER_AFTER_SECONDS = 7;
const DEGRADE_STEP = 0.08;
const RECOVER_STEP = 0.03;
const DEGRADE_COOLDOWN_SECONDS = 1.6;
const RECOVER_COOLDOWN_SECONDS = 3.5;
const STARTUP_COOLDOWN_SECONDS = 2.5;
const DESKTOP_PIXEL_BUDGET = 2_100_000;
const COARSE_PIXEL_BUDGET = 1_050_000;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const quantizeRatio = (value: number): number => Math.round(value * 100) / 100;

export interface RenderScaleLimits {
  initial: number;
  min: number;
  max: number;
}

/**
 * Chooses a conservative first-frame resolution for large/high-DPI displays.
 * Smaller viewports begin at native resolution and let measured frame time
 * decide whether any reduction is necessary.
 */
export const renderScaleLimits = (
  width: number,
  height: number,
  devicePixelRatio: number,
  coarsePointer: boolean,
): RenderScaleLimits => {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const safeDeviceRatio = Number.isFinite(devicePixelRatio)
    ? clamp(devicePixelRatio, 0.5, 4)
    : 1;
  const viewportPixels = safeWidth * safeHeight;
  const qualityFloor = viewportPixels >= 3_000_000
    ? (coarsePointer ? 0.5 : 0.55)
    : (coarsePointer ? 0.62 : 0.68);
  const min = Math.min(safeDeviceRatio, qualityFloor);
  const max = Math.min(safeDeviceRatio, coarsePointer ? 0.9 : 1);
  const pixelBudget = coarsePointer ? COARSE_PIXEL_BUDGET : DESKTOP_PIXEL_BUDGET;
  const budgetRatio = Math.sqrt(pixelBudget / viewportPixels);
  return {
    initial: quantizeRatio(clamp(budgetRatio, min, max)),
    min,
    max,
  };
};

/**
 * Slow, hysteretic render-scale controller. It reacts quickly to sustained
 * misses, but only restores detail after several stable seconds. The result is
 * a small number of target reallocations instead of visible resolution pumping.
 */
export class AdaptiveRenderScale {
  private lowFpsSeconds = 0;
  private recoverySeconds = 0;
  private cooldownSeconds = STARTUP_COOLDOWN_SECONDS;
  private current: number;

  constructor(private readonly limits: RenderScaleLimits) {
    this.current = quantizeRatio(clamp(limits.initial, limits.min, limits.max));
  }

  get value(): number {
    return this.current;
  }

  update(fps: number, delta: number): number | null {
    if (!Number.isFinite(fps) || !Number.isFinite(delta) || delta <= 0) return null;
    const safeDelta = Math.min(delta, 0.1);
    this.cooldownSeconds = Math.max(0, this.cooldownSeconds - safeDelta);

    if (fps < DEGRADE_BELOW_FPS) {
      this.lowFpsSeconds += safeDelta;
      this.recoverySeconds = 0;
    } else {
      this.lowFpsSeconds = Math.max(0, this.lowFpsSeconds - safeDelta * 2);
      this.recoverySeconds = fps >= RECOVER_ABOVE_FPS
        ? this.recoverySeconds + safeDelta
        : Math.max(0, this.recoverySeconds - safeDelta * 2);
    }

    if (this.cooldownSeconds > 0) return null;

    if (this.lowFpsSeconds >= DEGRADE_AFTER_SECONDS && this.current > this.limits.min) {
      this.current = quantizeRatio(Math.max(this.limits.min, this.current - DEGRADE_STEP));
      this.lowFpsSeconds = 0;
      this.recoverySeconds = 0;
      this.cooldownSeconds = DEGRADE_COOLDOWN_SECONDS;
      return this.current;
    }

    if (this.recoverySeconds >= RECOVER_AFTER_SECONDS && this.current < this.limits.max) {
      this.current = quantizeRatio(Math.min(this.limits.max, this.current + RECOVER_STEP));
      this.lowFpsSeconds = 0;
      this.recoverySeconds = 0;
      this.cooldownSeconds = RECOVER_COOLDOWN_SECONDS;
      return this.current;
    }

    return null;
  }
}

export const adaptiveRenderTargetFps = TARGET_FPS;
