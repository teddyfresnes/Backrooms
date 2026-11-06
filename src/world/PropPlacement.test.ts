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

const fitsOnTabletop = (
  item: NonNullable<WorldPlan['propPlacements']>[number],
  support: NonNullable<WorldPlan['propPlacements']>[number],
): boolean => {
  const itemDefinition = getPropAsset(item.assetId);
  const supportDefinition = getPropAsset(support.assetId);
  const deltaX = item.position.x - support.position.x;
  const deltaZ = item.position.z - support.position.z;
  const cosine = Math.cos(support.rotationY);
  const sine = Math.sin(support.rotationY);
  const localX = deltaX * cosine + deltaZ * sine;
  const localZ = -deltaX * sine + deltaZ * cosine;
  const relativeRotation = item.rotationY - support.rotationY;
  const relativeCosine = Math.abs(Math.cos(relativeRotation));
  const relativeSine = Math.abs(Math.sin(relativeRotation));
  const itemHalfX = (
    itemDefinition.size.x * relativeCosine + itemDefinition.size.z * relativeSine
  ) * item.scale * 0.5;
  const itemHalfZ = (
    itemDefinition.size.x * relativeSine + itemDefinition.size.z * relativeCosine
  ) * item.scale * 0.5;
  const inset = 0.04 * support.scale;
  return Math.abs(localX) + itemHalfX <= supportDefinition.size.x * support.scale * 0.5 - inset &&
    Math.abs(localZ) + itemHalfZ <= supportDefinition.size.z * support.scale * 0.5 - inset;
};

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

  it('keeps every raised scene object in contact with and inside its table', () => {
    const supportedScenes = new Set<string>();
    let raisedObjects = 0;
    for (let index = 0; index < 900; index += 1) {
      const plan = testPlan();
      populateRareProps(plan, `PROP-SURFACE-AUDIT-${index}`);
      for (const item of plan.propPlacements?.filter(({ position }) => position.y > 0.12) ?? []) {
        raisedObjects += 1;
        const support = plan.propPlacements?.find((candidate) => {
          if (candidate.sceneId !== item.sceneId || candidate.position.y > 0.12) return false;
          const definition = getPropAsset(candidate.assetId);
          if (definition.category !== 'table') return false;
          const top = candidate.position.y + definition.size.y * candidate.scale;
          return Math.abs(top - item.position.y) < 1e-9 && fitsOnTabletop(item, candidate);
        });
        expect(support, `${item.sceneId}:${item.assetId}`).toBeDefined();
        supportedScenes.add(item.sceneId!);
      }
    }

    expect(raisedObjects).toBeGreaterThan(25);
    expect(supportedScenes).toEqual(new Set([
      'abandoned-office-corner',
      'meeting-left-behind',
      'dead-television-corner',
      'abandoned-lounge',
      'school-office-remnant',
    ]));
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
