import { describe, expect, it } from 'vitest';
import {
  bakedLightMapJunctionNeedsRepair,
  bakedLightMapTexelSize,
} from './BakedLighting';

describe('baked lightmap junction sampling', () => {
  it('uses the half-metre generator grid at the current world size', () => {
    expect(bakedLightMapTexelSize(112)).toBe(0.5);
  });

  it('leaves aligned partitions alone when no texel centre is hidden below them', () => {
    expect(bakedLightMapJunctionNeedsRepair(0, 0.42, 112)).toBe(false);
    expect(bakedLightMapJunctionNeedsRepair(7.5, 0.22, 112)).toBe(false);
  });

  it('detects rare off-grid partitions that still cover a texel centre', () => {
    expect(bakedLightMapJunctionNeedsRepair(0.18, 0.22, 112)).toBe(true);
    expect(bakedLightMapJunctionNeedsRepair(-0.18, 0.22, 112)).toBe(true);
  });
});
