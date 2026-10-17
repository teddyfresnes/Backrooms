import { renderScaleLimits, type RenderScaleLimits } from './AdaptiveQuality';
import type { RenderQualityPreference } from '../ui/settings';

/** Large displays can fall back to a real 720p-class budget on a slow GPU. */
export function stairwellRenderScaleLimits(width: number, height: number, dpr: number, coarse: boolean): RenderScaleLimits {
  const limits = renderScaleLimits(width, height, dpr, coarse);
  const fallback = Math.floor(Math.sqrt(850_000 / Math.max(1, width * height)) * 100) / 100;
  return { ...limits, min: Math.max(.25, Math.min(limits.min, fallback)) };
}

/** Resolution alone cannot remove the cost of SSAO, SMAA and shadow sampling. */
export class StairwellQuality {
  private slowSeconds = 0;
  private fastSeconds = 0;
  private compact = false;

  update(preference: RenderQualityPreference, fps: number, delta: number): boolean {
    if (preference !== 'auto') {
      this.slowSeconds = this.fastSeconds = 0;
      this.compact = preference === 'performance';
      return this.compact;
    }
    if (!Number.isFinite(fps) || !Number.isFinite(delta) || delta <= 0) return this.compact;
    const dt = Math.min(delta, .1);
    this.slowSeconds = fps < 48 ? this.slowSeconds + dt : 0;
    this.fastSeconds = fps >= 59 ? this.fastSeconds + dt : 0;
    if (this.slowSeconds >= 1.5) this.compact = true;
    if (this.fastSeconds >= 20) this.compact = false;
    return this.compact;
  }
}
