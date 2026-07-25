import { describe, expect, it } from 'vitest';
import { generateInfiniteChunk } from './InfiniteWorld';
import {
  populateRareProps,
  PROP_CHUNK_PRESENCE_RATE,
  propCatalogSize,
} from './PropPlacement';
import type { Rect, WorldPlan } from './types';

const roomBounds: Rect = { minX: -10, minZ: -10, maxX: 10, maxZ: 10 };

const testPlan = (): WorldPlan => ({
  version: 1,
  seed: 'PROP-TEST',
  size: 24,
  wallHeight: 2.74,
  rooms: [{
    id: 'room',
    bounds: roomBounds,
    kind: 'open-hall',
    level: 0,
    ceilingHeight: 2.74,
    detailDensity: 0.4,
  }],
  walls: [
    {
      id: 'north',
      x: 0,
      z: -10,
      length: 20,
      orientation: 'x',
      bottom: 0,
      height: 2.74,
      thickness: 0.22,
      tint: 1,
      collision: true,
      kind: 'wallpaper',
    },
    {
      id: 'south',
      x: 0,
      z: 10,
      length: 20,
      orientation: 'x',
      bottom: 0,
      height: 2.74,
      thickness: 0.22,
      tint: 1,
      collision: true,
      kind: 'wallpaper',
    },
    {
      id: 'west',
      x: -10,
      z: 0,
      length: 20,
      orientation: 'z',
      bottom: 0,
      height: 2.74,
      thickness: 0.22,
      tint: 1,
      collision: true,
      kind: 'wallpaper',
    },
    {
      id: 'east',
      x: 10,
      z: 0,
      length: 20,
      orientation: 'z',
      bottom: 0,
      height: 2.74,
      thickness: 0.22,
      tint: 1,
      collision: true,
      kind: 'wallpaper',
    },
  ],
  columns: [],
  solidMasses: [],
  lights: [],
  missingCeilingTiles: [],
  features: [],
  detailSockets: [],
  propPlacements: [],
  colliders: [],
  floorRects: [roomBounds],
  spawn: { x: 30, y: 0.9, z: 30 },
});

const overlaps = (left: Rect, right: Rect): boolean =>
  left.minX < right.maxX &&
  left.maxX > right.minX &&
  left.minZ < right.maxZ &&
  left.maxZ > right.minZ;

describe('rare decorative props', () => {
  it('keeps prop clusters rare while drawing broadly from the catalog', () => {
    const samples = 500;
    let occupied = 0;
    const assets = new Set<string>();
    const scenes = new Set<string>();
    for (let index = 0; index < samples; index += 1) {
      const plan = testPlan();
      populateRareProps(plan, `PROP-DISTRIBUTION-${index}`);
      if ((plan.propPlacements?.length ?? 0) > 0) occupied += 1;
      for (const placement of plan.propPlacements ?? []) {
        assets.add(placement.assetId);
        if (placement.sceneId) scenes.add(placement.sceneId);
      }
    }

    expect(propCatalogSize()).toBeGreaterThan(100);
    expect(occupied / samples).toBeGreaterThan(PROP_CHUNK_PRESENCE_RATE - 0.07);
    expect(occupied / samples).toBeLessThan(PROP_CHUNK_PRESENCE_RATE + 0.07);
    expect(assets.size).toBeGreaterThan(45);
    expect(scenes.size).toBeGreaterThan(9);
  });

  it('is deterministic and keeps every footprint on clear floor', () => {
    const first = testPlan();
    const second = testPlan();
    populateRareProps(first, 'PROP-DETERMINISM-38');
    populateRareProps(second, 'PROP-DETERMINISM-38');
    expect(first.propPlacements).toEqual(second.propPlacements);
    expect(first.colliders).toEqual(second.colliders);

    for (const placement of first.propPlacements ?? []) {
      expect(placement.bounds.minX).toBeGreaterThan(roomBounds.minX);
      expect(placement.bounds.maxX).toBeLessThan(roomBounds.maxX);
      expect(placement.bounds.minZ).toBeGreaterThan(roomBounds.minZ);
      expect(placement.bounds.maxZ).toBeLessThan(roomBounds.maxZ);
    }
  });

  it('runs after inherited topology and never covers a final opening', () => {
    let plan: WorldPlan | undefined;
    for (let index = 0; index < 28; index += 1) {
      const candidate = generateInfiniteChunk('PROP-INTEGRATION', {
        x: index - 14,
        z: index % 5,
        story: 0,
      });
      if ((candidate.propPlacements?.length ?? 0) > 0) {
        plan = candidate;
        break;
      }
    }
    expect(plan).toBeDefined();
    for (const placement of plan?.propPlacements ?? []) {
      expect((plan?.floorOpenings ?? []).some((opening) => overlaps(
        placement.bounds,
        opening,
      ))).toBe(false);
      expect((plan?.ceilingOpenings ?? []).some((opening) => overlaps(
        placement.bounds,
        opening,
      ))).toBe(false);
    }
  });
});
