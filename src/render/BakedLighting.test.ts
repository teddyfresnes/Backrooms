import { describe, expect, it } from 'vitest';
import {
  bakeLightMapData,
  bakedCrossRoomTransmission,
  bakedLightMapJunctionNeedsRepair,
  bakedLightMapTexelSize,
  bakedOccluderIntersectsLitStory,
  bakedOccluderReachesCeiling,
} from './BakedLighting';
import type { WorldPlan } from '../world/types';

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
  it('does not project shaft collars above the ceiling onto the room below', () => {
    expect(bakedOccluderIntersectsLitStory(2.74, 2.66, 2.74)).toBe(false);
    expect(bakedOccluderIntersectsLitStory(-2.66, 8.06, 2.74)).toBe(false);
    expect(bakedOccluderIntersectsLitStory(0, 2.74, 2.74)).toBe(true);
  });

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

describe('zonal baked lighting', () => {
  it('keeps a lit room bright while forcing an intentional unlit zone dark', () => {
    const plan: WorldPlan = {
      version: 1,
      seed: 'ZONAL-LIGHTING-AUDIT',
      size: 2,
      wallHeight: 2.74,
      rooms: [{
        id: 'room',
        bounds: { minX: -1, minZ: -1, maxX: 1, maxZ: 1 },
        kind: 'office',
        level: 0,
        ceilingHeight: 2.74,
        detailDensity: 0,
      }],
      walls: [],
      columns: [],
      solidMasses: [],
      lights: [{
        id: 'light',
        x: 0,
        z: 0,
        ceilingY: 2.74,
        rotation: 0,
        width: 1.55,
        intensity: 1,
        color: 0xfff4c8,
        dead: false,
        unstable: false,
        phase: 0,
        roomId: 'room',
        level: 0,
      }],
      missingCeilingTiles: [],
      features: [],
      detailSockets: [],
      colliders: [],
      floorRects: [{ minX: -1, minZ: -1, maxX: 1, maxZ: 1 }],
      floorOpenings: [],
      spawn: { x: 0, y: 0.9, z: 0 },
    };
    const lit = bakeLightMapData(plan);
    const dark = bakeLightMapData({
      ...plan,
      unlitZones: [{ minX: -1, minZ: -1, maxX: 1, maxZ: 1 }],
    });
    const centerPixel = (112 * 224 + 112) * 4;
    expect(lit.general[centerPixel]!).toBeGreaterThan(dark.general[centerPixel]! + 10);
    expect(dark.general[centerPixel]!).toBeLessThanOrEqual(1);
  });
});
