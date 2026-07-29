import { describe, expect, it } from 'vitest';
import { generateInfiniteChunk } from './InfiniteWorld';
import {
  populateRareProps,
  PROP_CHUNK_PRESENCE_RATE,
  propCatalogSize,
} from './PropPlacement';
import { getPropAsset } from './PropCatalog';
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

    expect(propCatalogSize()).toBeGreaterThan(45);
    expect(occupied / samples).toBeGreaterThan(PROP_CHUNK_PRESENCE_RATE - 0.07);
    expect(occupied / samples).toBeLessThan(PROP_CHUNK_PRESENCE_RATE + 0.07);
    expect(assets.size).toBeGreaterThan(34);
    expect(scenes.size).toBeGreaterThan(5);
    for (const expectedScene of [
      'abandoned-office-corner',
      'meeting-left-behind',
      'dead-television-corner',
      'storage-overflow',
      'abandoned-lounge',
      'maintenance-cache',
    ]) {
      expect(scenes.has(expectedScene)).toBe(true);
    }
    expect([...assets].every((id) =>
      id.startsWith('polyhaven:') || id.startsWith('kenney-')
    )).toBe(true);
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
      const definition = getPropAsset(placement.assetId);
      if (definition.collidable && placement.position.y <= 0.12) {
        expect(first.colliders.some((collider) =>
          collider.id === `prop-collider-${placement.id}`
        )).toBe(true);
      }
    }
  });

  it('places a real catalog object in rooms designated by a door', () => {
    const plan = testPlan();
    plan.features.push({
      kind: 'interactive-door',
      id: 'object-door',
      sourceRoomId: 'approach-room',
      targetRoomId: 'room',
      position: { x: 0, y: 0, z: -10 },
      orientation: 'x',
      width: 1.38,
      height: 2.32,
      openingDirection: 1,
      style: 'office-windowed',
      content: 'object',
      colliderId: 'object-door-collider',
      bounds: { minX: -0.69, maxX: 0.69, minZ: -10.12, maxZ: -9.88 },
    });

    populateRareProps(plan, 'PROP-BEHIND-DOOR');

    expect(plan.propPlacements?.length).toBeGreaterThan(0);
    expect(plan.propPlacements?.some((placement) => placement.roomId === 'room')).toBe(true);
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

  it('prefixes placement, room, scene and collider IDs in infinite chunks', () => {
    let plan: WorldPlan | undefined;
    for (let index = 0; index < 64; index += 1) {
      const candidate = generateInfiniteChunk('PROP-PREFIX', {
        x: index - 32,
        z: (index * 3) % 11,
        story: 0,
      });
      if (candidate.propPlacements?.some((placement) => placement.sceneId)) {
        plan = candidate;
        break;
      }
    }

    const scenePlacements = plan?.propPlacements?.filter((placement) => placement.sceneId) ?? [];
    expect(scenePlacements.length).toBeGreaterThan(1);
    for (const placement of scenePlacements) {
      expect(placement.id).toMatch(/^chunk-/);
      expect(placement.roomId).toMatch(/^chunk-/);
      expect(placement.sceneId).toMatch(/^chunk-/);
      const collider = plan?.colliders.find((candidate) =>
        candidate.id.endsWith(`prop-collider-${placement.id.split('/').at(-1)}`)
      );
      if (getPropAsset(placement.assetId).collidable && placement.position.y <= 0.12) {
        expect(collider?.id).toMatch(/^chunk-/);
      }
    }
  });
});
