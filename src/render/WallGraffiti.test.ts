import { describe, expect, it } from 'vitest';
import { generateWorld } from '../world/generateWorld';
import type { WorldPlan } from '../world/types';
import { selectWallGraffiti } from './WallGraffiti';

const makePlan = (
  seed: string,
  withTargets = false,
): WorldPlan => {
  const walls = Array.from({ length: 36 }, (_, index) => {
    const horizontal = index % 2 === 0;
    const lane = Math.floor(index / 2) - 9;
    return {
      id: `wall-${index}`,
      x: horizontal ? 0 : lane * 2.8,
      z: horizontal ? lane * 2.8 : 0,
      length: 8 + (index % 5),
      orientation: horizontal ? 'x' as const : 'z' as const,
      bottom: 0,
      height: 2.74,
      thickness: 0.22,
      tint: 1,
      collision: true,
      kind: 'wallpaper' as const,
    };
  });
  return {
    version: 1,
    seed,
    size: 112,
    wallHeight: 2.74,
    rooms: [{
      id: 'room',
      bounds: { minX: -50, minZ: -50, maxX: 50, maxZ: 50 },
      kind: 'office',
      level: 0,
      ceilingHeight: 2.74,
      detailDensity: 0,
    }],
    walls,
    columns: [],
    solidMasses: [],
    lights: [],
    missingCeilingTiles: [],
    features: withTargets
      ? [
          {
            kind: 'grid-pit',
            id: 'pit-a',
            roomId: 'room',
            bounds: { minX: 11, minZ: 8, maxX: 17, maxZ: 14 },
            holes: [{
              minX: 12,
              minZ: 9,
              maxX: 15,
              maxZ: 12,
              depth: 5.4,
              stories: 1,
            }],
            depth: 5.4,
            pattern: 'single',
            lowerBounds: { minX: 9, minZ: 6, maxX: 19, maxZ: 16 },
            lowerFloorY: -5.4,
            lowerCeilingY: -2.74,
          },
          {
            kind: 'stair-socket',
            id: 'stairs-a',
            roomId: 'room',
            bounds: { minX: -18, minZ: -13, maxX: -10, maxZ: -8 },
            heading: 'x+',
            baseY: 0,
          },
        ]
      : [],
    detailSockets: [],
    colliders: [],
    floorRects: [{ minX: -56, minZ: -56, maxX: 56, maxZ: 56 }],
    spawn: { x: 0, y: 0.865, z: 0 },
  };
};

const fingerprint = (plan: WorldPlan) => selectWallGraffiti(plan).map((placement) => ({
  id: placement.id,
  side: placement.side,
  along: placement.along,
  centerY: placement.centerY,
  width: placement.width,
  height: placement.height,
  kind: placement.kind,
  lines: placement.lines,
  symbol: placement.symbol,
  arrowDirection: placement.arrowDirection,
  arrowCount: placement.arrowCount,
  targetKind: placement.targetKind,
  targetFeatureId: placement.targetFeatureId,
  ink: placement.ink,
  opacity: placement.opacity,
  seed: placement.seed,
}));

describe('procedural wall graffiti selection', () => {
  it('is deterministic for a streamed chunk seed', () => {
    const plan = makePlan('GRAFFITI-DETERMINISM');
    expect(fingerprint(plan)).toEqual(fingerprint(plan));
  });

  it('keeps ambient markings rare across otherwise dense wall plans', () => {
    const plans = Array.from({ length: 240 }, (_, index) =>
      makePlan(`GRAFFITI-DENSITY-${index}`)
    );
    const counts = plans.map((plan) => selectWallGraffiti(plan).length);
    const totalWalls = plans.reduce((sum, plan) => sum + plan.walls.length, 0);
    const emptyRatio = counts.filter((count) => count === 0).length / counts.length;
    expect(emptyRatio).toBeGreaterThan(0.35);
    expect(emptyRatio).toBeLessThan(0.62);
    expect(Math.max(...counts)).toBeLessThanOrEqual(3);
    expect(counts.reduce((sum, count) => sum + count, 0) / totalWalls).toBeLessThan(0.03);
  });

  it('produces a large vocabulary instead of repeating a short decal list', () => {
    const messages = new Set<string>();
    const styleSeeds = new Set<string>();
    for (let index = 0; index < 720; index += 1) {
      for (const placement of selectWallGraffiti(makePlan(`GRAFFITI-VOCAB-${index}`))) {
        styleSeeds.add(placement.seed);
        if (placement.kind === 'message') messages.add(placement.lines.join(' / '));
      }
    }
    expect(messages.size).toBeGreaterThan(100);
    expect(styleSeeds.size).toBeGreaterThan(400);
  });

  it('occasionally creates multi-arrow signs that point toward real stairs and pitfalls', () => {
    const directions = Array.from({ length: 560 }, (_, index) =>
      selectWallGraffiti(makePlan(`GRAFFITI-DIRECTION-${index}`, true))
    ).flat().filter((placement) => placement.kind === 'direction');
    expect(directions.filter((placement) => placement.targetKind === 'stairs').length)
      .toBeGreaterThan(90);
    expect(directions.filter((placement) => placement.targetKind === 'pitfall').length)
      .toBeGreaterThan(55);

    for (const placement of directions) {
      expect(placement.arrowCount).toBeGreaterThanOrEqual(2);
      expect(placement.arrowCount).toBeLessThanOrEqual(5);
      const target = placement.targetKind === 'stairs'
        ? { x: -14, z: -10.5 }
        : { x: 13.5, z: 10.5 };
      const origin = placement.wall.orientation === 'x'
        ? { x: placement.along, z: placement.wall.z }
        : { x: placement.wall.x, z: placement.along };
      const localRight = placement.wall.orientation === 'x'
        ? { x: placement.side, z: 0 }
        : { x: 0, z: -placement.side };
      const signedTargetDirection =
        (target.x - origin.x) * localRight.x +
        (target.z - origin.z) * localRight.z;
      expect(signedTargetDirection * (placement.arrowDirection ?? 0)).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps every marking inside the usable part of its wall', () => {
    for (let index = 0; index < 180; index += 1) {
      const plan = makePlan(`GRAFFITI-FIT-${index}`, true);
      for (const placement of selectWallGraffiti(plan)) {
        const wallAlong = placement.wall.orientation === 'x'
          ? placement.wall.x
          : placement.wall.z;
        expect(Math.abs(placement.along - wallAlong) + placement.width * 0.5)
          .toBeLessThanOrEqual(placement.wall.length * 0.5);
        expect(placement.centerY - placement.height * 0.5).toBeGreaterThan(0.1);
        expect(placement.centerY + placement.height * 0.5)
          .toBeLessThan(placement.wall.bottom + placement.wall.height);
      }
    }
  });

  it('stays sparse and attached to surviving walls in real generated maps', () => {
    const worlds = Array.from({ length: 48 }, (_, index) =>
      generateWorld(`REAL-GRAFFITI-AUDIT-${index}`)
    );
    const placements = worlds.flatMap((plan) =>
      selectWallGraffiti(plan).map((placement) => ({ placement, plan }))
    );
    expect(placements.length).toBeGreaterThan(20);
    expect(placements.length).toBeLessThan(90);
    expect(placements.some(({ placement }) => placement.kind === 'message')).toBe(true);
    expect(placements.some(({ placement }) => placement.kind === 'symbol')).toBe(true);
    expect(placements.some(({ placement }) => placement.kind === 'direction')).toBe(true);
    for (const { placement, plan } of placements) {
      expect(plan.walls).toContain(placement.wall);
    }
  });
});
