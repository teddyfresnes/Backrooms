import { describe, expect, it } from 'vitest';
import { INFINITE_CHUNK_SIZE, INFINITE_STORY_PITCH } from '../world/InfiniteWorld';
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
