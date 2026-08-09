import { describe, expect, it } from 'vitest';
import {
  EPIC_MACRO_SIZE,
  EPIC_STRUCTURE_DEFINITIONS,
  epicStructureIndexForCoord,
  getEpicLocateDestination,
  getEpicStructureDefinition,
  getEpicStructureSlotsForMacro,
  getNearestEpicStructureCoord,
  isInsideEpicStoryVolume,
} from '../world/EpicStructures';
import type { EpicStructureFeature } from '../world/types';
import {
  getChunkWorldOffset,
  INFINITE_CHUNK_SIZE,
  INFINITE_STORY_PITCH,
} from '../world/InfiniteWorld';
import {
  nextEpicAbyssPrefetchCoord,
  locateWarmupCoords,
  shouldDeferStoryTransition,
  streamChunkCoordAt,
  streamedCoordsAround,
  streamedCoordsAroundLongitudinalEpic,
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

  it('keeps only the north/south column around a longitudinal epic owner', () => {
    expect(streamedCoordsAroundLongitudinalEpic({ x: 8, z: -12, story: 4 })).toEqual([
      { x: 8, z: -12, story: 4 },
      { x: 8, z: -13, story: 4 },
      { x: 8, z: -11, story: 4 },
    ]);
  });

  it('keeps the small preview active until the worker destination is ready', () => {
    const current = { x: 2, z: -4, story: 0 };
    const below = { ...current, story: -1 };
    expect(shouldDeferStoryTransition(current, below, false, true)).toBe(true);
    expect(shouldDeferStoryTransition(current, below, true, true)).toBe(false);
    expect(shouldDeferStoryTransition(current, below, false, false)).toBe(false);
    expect(shouldDeferStoryTransition(current, current, false, true)).toBe(false);
  });

  it('prepares epic1 one story at a time instead of generating a vertical burst', () => {
    expect(nextEpicAbyssPrefetchCoord({ x: 8, z: -12, story: -7 })).toEqual({
      x: 8,
      z: -12,
      story: -8,
    });
  });

  it('warms the maze chunk behind epic1 before completing a locate teleport', () => {
    expect(locateWarmupCoords({ command: 'epic1', chunkKey: '8:-12:-7' })).toEqual([
      { x: 8, z: -12, story: -7 },
      { x: 8, z: -13, story: -7 },
    ]);
    expect(locateWarmupCoords({ command: 'epic3', chunkKey: '8:-12:-7' })).toEqual([
      { x: 8, z: -12, story: -7 },
    ]);
  });
});

describe('sparse epic structure slots', () => {
  const seed = 'SPARSE-EPIC-STREAM-AUDIT';
  const activeIndices = [1, 2, 3, 4, 5] as const;

  it('publishes only the active locate commands and resolves sparse definition indices', () => {
    expect(EPIC_STRUCTURE_DEFINITIONS.map((definition) => definition.command)).toEqual([
      'epic1',
      'epic2',
      'epic3',
      'epic4',
      'epic5',
    ]);
    expect(getEpicStructureDefinition(4)).toMatchObject({
      index: 4,
      command: 'epic4',
      variant: 'impossible-stairwell',
    });
    expect(getEpicStructureDefinition(5)).toMatchObject({
      index: 5,
      command: 'epic5',
      variant: 'vanishing-concourse',
    });
  });

  it('places exactly five epic chunks in every 32x32 macrocell', () => {
    for (const [macroX, macroZ] of [[0, 0], [-1, -1], [3, -4]] as const) {
      const slots = getEpicStructureSlotsForMacro(seed, macroX, macroZ);
      expect(slots).toHaveLength(5);
      expect(slots.map((slot) => slot.index).sort((left, right) => left - right))
        .toEqual(activeIndices);

      const observed: number[] = [];
      for (let z = macroZ * EPIC_MACRO_SIZE; z < (macroZ + 1) * EPIC_MACRO_SIZE; z += 1) {
        for (let x = macroX * EPIC_MACRO_SIZE; x < (macroX + 1) * EPIC_MACRO_SIZE; x += 1) {
          const index = epicStructureIndexForCoord(seed, { x, z });
          if (index !== null) observed.push(index);
        }
      }
      expect(observed).toHaveLength(5);
      expect(observed.sort((left, right) => left - right)).toEqual(activeIndices);
    }
  });

  it('keeps an empty Chebyshev halo around every epic, including macro seams', () => {
    const slots = [];
    for (let macroZ = -2; macroZ <= 2; macroZ += 1) {
      for (let macroX = -2; macroX <= 2; macroX += 1) {
        slots.push(...getEpicStructureSlotsForMacro(seed, macroX, macroZ));
      }
    }

    for (let leftIndex = 0; leftIndex < slots.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < slots.length; rightIndex += 1) {
        const left = slots[leftIndex]!;
        const right = slots[rightIndex]!;
        const distance = Math.max(Math.abs(left.x - right.x), Math.abs(left.z - right.z));
        expect(distance).toBeGreaterThan(1);
      }
    }
  });

  it('keeps horizontal epic addresses stable between stories', () => {
    const lowerOrigin = { x: -71, z: 53, story: -12 };
    const upperOrigin = { ...lowerOrigin, story: 19 };
    for (const index of activeIndices) {
      const lower = getNearestEpicStructureCoord(seed, index, lowerOrigin);
      const upper = getNearestEpicStructureCoord(seed, index, upperOrigin);
      expect({ x: upper.x, z: upper.z }).toEqual({ x: lower.x, z: lower.z });
      expect(lower.story).toBe(lowerOrigin.story);
      expect(upper.story).toBe(upperOrigin.story);
      expect(epicStructureIndexForCoord(seed, lower)).toBe(index);
      expect(epicStructureIndexForCoord(seed, upper)).toBe(index);
    }
  });

  it('reclassifies every locate destination into the same epic column', () => {
    const origin = { x: -71, z: 53, story: -8 };
    for (const index of activeIndices) {
      const coord = getNearestEpicStructureCoord(seed, index, origin);
      const localDestination = getEpicLocateDestination(seed, coord, index);
      const offset = getChunkWorldOffset(coord);
      const classified = streamChunkCoordAt({
        x: offset.x + localDestination.x,
        y: offset.y + localDestination.y,
        z: offset.z + localDestination.z,
      });
      expect({ x: classified.x, z: classified.z }).toEqual({ x: coord.x, z: coord.z });
      expect(epicStructureIndexForCoord(seed, classified)).toBe(index);
    }
  });

  it('hands epic1 to normal story streaming but pins the high epic3 volume', () => {
    const epic1: EpicStructureFeature = {
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
    const epic3: EpicStructureFeature = {
      kind: 'epic-structure',
      id: 'epic3-ascending-passages',
      roomId: 'epic3-room',
      index: 3,
      variant: 'ascending-passages',
      bounds: { minX: -52, minZ: -17, maxX: 52, maxZ: 17 },
      height: 64,
      destination: { x: 0, y: 0.865, z: -13.2 },
    };

    expect(isInsideEpicStoryVolume(epic1, { x: 0, y: 30, z: 0 })).toBe(false);
    expect(isInsideEpicStoryVolume(epic3, { x: 0, y: 30, z: 0 })).toBe(true);
    expect(isInsideEpicStoryVolume(epic3, { x: 53, y: 30, z: 0 })).toBe(false);
  });
});
