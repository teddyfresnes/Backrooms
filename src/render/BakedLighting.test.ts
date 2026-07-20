import { describe, expect, it } from 'vitest';
import {
  bakedCrossRoomTransmission,
  bakedLightMapJunctionNeedsRepair,
  bakedLightMapTexelSize,
  bakedOccluderReachesCeiling,
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

describe('baked light transport across rooms', () => {
  const room = { minX: 0, minZ: 0, maxX: 10, maxZ: 8 };

  it('has no artificial discontinuity at an open room boundary', () => {
    expect(bakedCrossRoomTransmission(-3, 4, 0, 4, room)).toBeCloseTo(1, 6);
  });

  it('falls off gradually inside the neighbouring room', () => {
    const nearOpening = bakedCrossRoomTransmission(-3, 4, 1, 4, room);
    const deepInside = bakedCrossRoomTransmission(-3, 4, 9, 4, room);
    expect(nearOpening).toBeGreaterThan(deepInside);
    expect(deepInside).toBeGreaterThanOrEqual(0.2);
  });

  it('handles a light across a perpendicular boundary symmetrically', () => {
    const fromWest = bakedCrossRoomTransmission(-3, 4, 2, 4, room);
    const fromNorth = bakedCrossRoomTransmission(2, -3, 2, 2, room);
    expect(fromWest).toBeCloseTo(fromNorth, 6);
  });
});

describe('ceiling-specific baked occlusion', () => {
  it('ignores a partition that physically ends below the ceiling', () => {
    expect(bakedOccluderReachesCeiling(0, 1.8, 2.65)).toBe(false);
  });

  it('keeps full-height walls as ceiling occluders', () => {
    expect(bakedOccluderReachesCeiling(0, 2.65, 2.65)).toBe(true);
  });

  it('keeps a suspended header that occupies the ceiling plane', () => {
    expect(bakedOccluderReachesCeiling(1.75, 0.9, 2.65)).toBe(true);
  });
});
