import { describe, expect, it } from 'vitest';
import {
  EPIC_STRUCTURE_DEFINITIONS,
  epicStructureIndexForCoord,
  isInsideEpicAbyssFall,
  isInsideEpicStoryVolume,
} from '../world/EpicStructures';
import type { EpicStructureFeature } from '../world/types';
import {
  getChunkWorldOffset,
  INFINITE_CHUNK_SIZE,
  INFINITE_STORY_PITCH,
} from '../world/InfiniteWorld';
import {
  shouldDeferStoryTransition,
  streamChunkCoordAt,
  streamedCoordsAround,
} from './WorldStream';

describe('multi-storey world streaming coordinates', () => {
  it('tracks horizontal chunks without a finite edge', () => {
    expect(streamChunkCoordAt({ x: INFINITE_CHUNK_SIZE * 400 + 1, y: 0.865, z: -1 })).toEqual({
      x: 400,
      z: 0,
      story: 0,
    });
  });

  it('switches story halfway through a vertical shaft', () => {
    expect(streamChunkCoordAt({ x: 0, y: -INFINITE_STORY_PITCH * 0.49, z: 0 }).story).toBe(0);
    expect(streamChunkCoordAt({ x: 0, y: -INFINITE_STORY_PITCH * 0.51, z: 0 }).story).toBe(-1);
    expect(streamChunkCoordAt({ x: 0, y: INFINITE_STORY_PITCH + 0.865, z: 0 }).story).toBe(1);
  });

  it('uses stable half-open boundaries for negative and positive chunks', () => {
    const epsilon = 1e-6;
    const halfChunk = INFINITE_CHUNK_SIZE * 0.5;
    const cases = [
      { x: -halfChunk - epsilon, expected: -1 },
      { x: -halfChunk, expected: 0 },
      { x: halfChunk - epsilon, expected: 0 },
      { x: halfChunk, expected: 1 },
      { x: INFINITE_CHUNK_SIZE * -25 - halfChunk - epsilon, expected: -26 },
      { x: INFINITE_CHUNK_SIZE * 25 + halfChunk, expected: 26 },
    ];

    for (const { x, expected } of cases) {
      expect(streamChunkCoordAt({ x, y: 0, z: x }).x).toBe(expected);
      expect(streamChunkCoordAt({ x, y: 0, z: x }).z).toBe(expected);
    }
  });

  it('selects the destination story exactly at every shaft midpoint', () => {
    const epsilon = 1e-6;
    for (let story = -12; story <= 12; story += 1) {
      const lowerMidpoint = (story - 0.5) * INFINITE_STORY_PITCH;
      const upperMidpoint = (story + 0.5) * INFINITE_STORY_PITCH;
      expect(streamChunkCoordAt({ x: 0, y: lowerMidpoint, z: 0 }).story).toBe(story);
      expect(streamChunkCoordAt({ x: 0, y: upperMidpoint - epsilon, z: 0 }).story).toBe(story);
      expect(streamChunkCoordAt({ x: 0, y: upperMidpoint, z: 0 }).story).toBe(story + 1);
    }
  });

  it('streams a complete 3x3 neighborhood on the current story', () => {
    const coords = streamedCoordsAround({ x: 8, z: -12, story: -7 });
    expect(coords).toHaveLength(9);
    expect(coords[0]).toEqual({ x: 8, z: -12, story: -7 });
    expect(new Set(coords.map((coord) => coord.story))).toEqual(new Set([-7]));
    expect(new Set(coords.map((coord) => `${coord.x}:${coord.z}`)).size).toBe(9);
    expect(coords).toEqual(expect.arrayContaining([
      { x: 7, z: -13, story: -7 },
      { x: 9, z: -13, story: -7 },
      { x: 7, z: -11, story: -7 },
      { x: 9, z: -11, story: -7 },
    ]));
  });

  it('keeps the small preview active until the worker destination is ready', () => {
    const current = { x: 2, z: -4, story: 0 };
    const below = { ...current, story: -1 };
    expect(shouldDeferStoryTransition(current, below, false, true)).toBe(true);
    expect(shouldDeferStoryTransition(current, below, true, true)).toBe(false);
    expect(shouldDeferStoryTransition(current, below, false, false)).toBe(false);
    expect(shouldDeferStoryTransition(current, current, false, true)).toBe(false);
  });
});

describe('periodic epic structure slots', () => {
  it('publishes the exact locate commands epic1 through epic8', () => {
    expect(EPIC_STRUCTURE_DEFINITIONS.map((definition) => definition.command)).toEqual([
      'epic1',
      'epic2',
      'epic3',
      'epic4',
      'epic5',
      'epic6',
      'epic7',
      'epic8',
    ]);
  });

  it('uses Euclidean residues for negative chunk coordinates', () => {
    const cases = [
      { coord: { x: -3, z: -6 }, expected: null },
      { coord: { x: -2, z: -3 }, expected: 1 },
      { coord: { x: -1, z: -3 }, expected: 2 },
      { coord: { x: -3, z: -2 }, expected: 3 },
      { coord: { x: -2, z: -2 }, expected: 4 },
      { coord: { x: -1, z: -2 }, expected: 5 },
      { coord: { x: -3, z: -1 }, expected: 6 },
      { coord: { x: -2, z: -1 }, expected: 7 },
      { coord: { x: -1, z: -1 }, expected: 8 },
    ] as const;

    for (const { coord, expected } of cases) {
      expect(epicStructureIndexForCoord(coord)).toBe(expected);
    }
  });

  it('places one ordinary chunk and every epic index in any streamed 3x3', () => {
    const centers = [
      { x: 0, z: 0, story: 0 },
      { x: 1, z: 2, story: 7 },
      { x: -1, z: -1, story: -4 },
      { x: -100, z: 37, story: 19 },
    ];

    for (const center of centers) {
      const slots = streamedCoordsAround(center)
        .map((coord) => epicStructureIndexForCoord(coord) ?? 0)
        .sort((left, right) => left - right);
      expect(slots).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    }
  });

  it('keeps every epic destination classified inside its owning chunk', () => {
    const localDestination = { x: 0, y: 0.865, z: -45 };
    const coords = [
      ...streamedCoordsAround({ x: 0, z: 0, story: 0 }),
      ...streamedCoordsAround({ x: -17, z: 24, story: -8 }),
    ];

    for (const coord of coords) {
      if (epicStructureIndexForCoord(coord) === null) continue;
      const offset = getChunkWorldOffset(coord);
      expect(streamChunkCoordAt({
        x: offset.x + localDestination.x,
        y: offset.y + localDestination.y,
        z: offset.z + localDestination.z,
      })).toEqual(coord);
    }
  });

  it('pins the tall epic volume and a real fall inside the lethal opening', () => {
    const feature: EpicStructureFeature = {
      kind: 'epic-structure',
      id: 'epic1-endless-abyss',
      roomId: 'epic1-room',
      index: 1,
      variant: 'endless-abyss',
      bounds: { minX: -56, minZ: -56, maxX: 56, maxZ: 56 },
      voidBounds: { minX: -32, minZ: -32, maxX: 32, maxZ: 32 },
      height: 54,
      destination: { x: 0, y: 0.865, z: -45 },
    };

    expect(isInsideEpicAbyssFall(feature, { x: 0, y: -3, z: 0 })).toBe(true);
    expect(isInsideEpicAbyssFall(feature, { x: 0, y: -73, z: 0 })).toBe(false);
    expect(isInsideEpicAbyssFall(feature, { x: 0, y: 0.865, z: 0 })).toBe(false);
    expect(isInsideEpicAbyssFall(feature, { x: 35, y: -3, z: 0 })).toBe(false);
    expect(isInsideEpicStoryVolume(feature, { x: 0, y: 30, z: 0 })).toBe(true);
    expect(isInsideEpicStoryVolume(feature, { x: 0, y: 55, z: 0 })).toBe(false);
    expect(isInsideEpicStoryVolume(feature, { x: 57, y: 20, z: 0 })).toBe(false);
  });
});
