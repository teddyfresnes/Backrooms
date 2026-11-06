import type { Rect } from './types';

export interface TrimInterval { min: number; max: number }

/** Strict cross-face membership and positive-length overlap preserve the other
 * room's trim and endpoint contacts. Shared by spatial and historical paths. */
export const baseboardExclusions = (zones: readonly Rect[], axis: 'x' | 'z', sampleFixed: number,
  min: number, max: number, inset = .002): TrimInterval[] => {
  const claims: TrimInterval[] = [];
  for (const zone of zones) {
    const crossMin = axis === 'x' ? zone.minZ : zone.minX, crossMax = axis === 'x' ? zone.maxZ : zone.maxX;
    if (sampleFixed < crossMin + inset || sampleFixed > crossMax - inset) continue;
    const lo = Math.max(min, axis === 'x' ? zone.minX : zone.minZ), hi = Math.min(max, axis === 'x' ? zone.maxX : zone.maxZ);
    // A partial finish exclusion must not leave a two-millimetre end scrap.
    // This tolerance only resolves trim policy, never structural coordinates.
    if (hi - lo > 1e-6) claims.push({ min: lo - min < .02 ? min : lo, max: max - hi < .02 ? max : hi });
  }
  claims.sort((a, b) => a.min - b.min || a.max - b.max);
  const merged: TrimInterval[] = [];
  for (const claim of claims) {
    const last = merged.at(-1);
    if (last && claim.min <= last.max + 1e-6) last.max = Math.max(last.max, claim.max);
    else merged.push({ ...claim });
  }
  return merged;
};

export const subtractTrimIntervals = (ranges: readonly TrimInterval[], cuts: readonly TrimInterval[]): TrimInterval[] => {
  let result = ranges.map(r => ({ ...r }));
  for (const c of cuts) result = result.flatMap(r => c.max <= r.min || c.min >= r.max ? [r]
    : [{ min: r.min, max: Math.min(r.max, c.min) }, { min: Math.max(r.min, c.max), max: r.max }].filter(p => p.max - p.min > 1e-6));
  return result;
};
