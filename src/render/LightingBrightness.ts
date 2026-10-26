export const DEFAULT_BRIGHTNESS = 50;

/** Zero is a valid setting. Old saves and malformed values start at 50. */
export const normalizeBrightness = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : DEFAULT_BRIGHTNESS;

/** The modern Backrooms endpoints are the actual pre/post v17 calibrations.
 * Other pipelines keep their own palette, sources and bake; their relative
 * attenuation follows the same combined rig/pool response, with 100 unchanged. */
export const resolveLightingBrightness = (value: unknown = DEFAULT_BRIGHTNESS) => {
  const amount = normalizeBrightness(value) / 100;
  const mix = (a: number, b: number) => a + (b - a) * amount;
  const rig = { hemisphere: mix(.14, .32), ambient: mix(.055, .10), key: mix(.22, .34) };
  const pool = { min: mix(.50, .72), max: mix(1.42, 1.85) };
  const energy = (rig.hemisphere + rig.ambient + rig.key) * (pool.min + pool.max) / 2;
  const relativeGain = energy / ((.32 + .10 + .34) * (.72 + 1.85) / 2);
  return { rig, pool, relativeGain };
};
