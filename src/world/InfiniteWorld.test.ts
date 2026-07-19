import { describe, expect, it } from 'vitest';
import {
  INFINITE_CHUNK_SIZE,
  INFINITE_STORY_PITCH,
  ceilingOpeningsForChunk,
  createChunkKey,
  generateInfiniteChunk,
  getCanonicalEdgeGates,
  getChunkWorldOffset,
  getFloorOpenings,
  getInfiniteBiome,
  getInfiniteChunkCeilingOpenings,
  getInfiniteChunkMetadata,
  getNeighborChunkKey,
  isInfiniteChunkPlan,
  parseChunkKey,
  type ChunkCoord,
  type ChunkEdge,
  type InfiniteBiome,
} from './InfiniteWorld';

const seed = 'INFINITE-CONTRACT-AUDIT';
const sampleCoords: ChunkCoord[] = [
  { x: 0, z: 0, story: 0 },
  { x: 1, z: -2, story: 0 },
  { x: -9, z: 4, story: 3 },
  { x: 41, z: -27, story: -5 },
];

const opposite: Record<ChunkEdge, ChunkEdge> = {
  north: 'south',
  east: 'west',
  south: 'north',
  west: 'east',
};

describe('InfiniteWorld chunk contracts', () => {
  it('round-trips integer keys and exposes the 112m / 5.4m logical transform', () => {
    const coord = { x: -7, z: 13, story: 4 } as const;
    const key = createChunkKey(coord);
    expect(parseChunkKey(key)).toEqual(coord);
    expect(getChunkWorldOffset(key)).toEqual({
      x: -7 * INFINITE_CHUNK_SIZE,
      y: 4 * INFINITE_STORY_PITCH,
      z: 13 * INFINITE_CHUNK_SIZE,
    });
  });

  it.each(sampleCoords)('shares canonical E/W and N/S gates at $x:$z:$story', (coord) => {
    const key = createChunkKey(coord);
    for (const edge of ['north', 'east', 'south', 'west'] as const) {
      const neighbor = getNeighborChunkKey(key, edge);
      expect(getCanonicalEdgeGates(seed, key, edge)).toEqual(
        getCanonicalEdgeGates(seed, neighbor, opposite[edge]),
      );
    }
  });

  it.each(sampleCoords)('keeps canonical gates usable and away from corners for $x:$z:$story', (coord) => {
    const key = createChunkKey(coord);
    for (const edge of ['north', 'east', 'south', 'west'] as const) {
      const gates = getCanonicalEdgeGates(seed, key, edge);
      expect(gates.length).toBeGreaterThanOrEqual(1);
      expect(gates.length).toBeLessThanOrEqual(2);
      for (const gate of gates) {
        expect(gate.width).toBeGreaterThanOrEqual(2.35);
        expect(Math.abs(gate.offset) + gate.width * 0.5).toBeLessThan(INFINITE_CHUNK_SIZE * 0.5 - 10);
      }
    }
  });

  it('is deterministic while remaining varied from chunk to chunk', () => {
    const key = createChunkKey({ x: 3, z: -8, story: 2 });
    expect(generateInfiniteChunk(seed, key)).toEqual(generateInfiniteChunk(seed, key));

    const fingerprints = new Set(
      Array.from({ length: 20 }, (_, index) => {
        const plan = generateInfiniteChunk(seed, createChunkKey({ x: index - 10, z: index % 4, story: 0 }));
        return plan.rooms
          .map((room) => `${room.kind}:${room.bounds.minX}:${room.bounds.minZ}:${room.bounds.maxX}:${room.bounds.maxZ}`)
          .join('|');
      }),
    );
    expect(fingerprints.size).toBeGreaterThanOrEqual(18);
  });

  it('assigns deterministic and coherent biomes to 3x3 macro regions', () => {
    const biomeSeed = 'INFINITE-BIOME-AUDIT';
    const observed = new Set<InfiniteBiome>();
    const macroCoords = Array.from({ length: 11 * 11 }, (_, index) => ({
      x: (index % 11) - 5,
      z: Math.floor(index / 11) - 5,
      story: index % 3 - 1,
    }));
    const firstPass: InfiniteBiome[] = [];

    for (const macro of macroCoords) {
      const members = Array.from({ length: 9 }, (_, index): ChunkCoord => ({
        x: macro.x * 3 + index % 3,
        z: macro.z * 3 + Math.floor(index / 3),
        story: macro.story,
      }));
      const biomes = members.map((coord) => getInfiniteBiome(biomeSeed, coord));
      expect(new Set(biomes).size).toBe(1);
      firstPass.push(biomes[0]!);
      observed.add(biomes[0]!);
    }

    expect(macroCoords.map((macro) => getInfiniteBiome(biomeSeed, {
      x: macro.x * 3,
      z: macro.z * 3,
      story: macro.story,
    }))).toEqual(firstPass);
    expect(observed.size).toBeGreaterThanOrEqual(3);

    for (const macro of macroCoords.filter((_, index) => index % 40 === 0)) {
      const coord = { x: macro.x * 3 + 1, z: macro.z * 3 + 1, story: macro.story } as const;
      const plan = generateInfiniteChunk(biomeSeed, coord);
      expect(getInfiniteChunkMetadata(plan)?.biome).toBe(getInfiniteBiome(biomeSeed, coord));
    }
  });

  it.each(sampleCoords)('strips finite vistas but preserves the complete lower story for $x:$z:$story', (coord) => {
    const key = createChunkKey(coord);
    const plan = generateInfiniteChunk(seed, key);
    const idPrefix = `chunk-${key}/`;

    expect(plan.features.some((feature) => feature.kind === 'impossible-vista')).toBe(false);
    expect(plan.lights.every((light) => !light.id.includes('vista-light-'))).toBe(true);
    expect(plan.lights.some((light) => light.level === -1)).toBe(true);
    expect(plan.walls.some((wall) => wall.id.includes('/lower-wall-') && wall.bottom < 0)).toBe(true);
    expect(plan.colliders.some((collider) => collider.id.includes('/shaft-'))).toBe(true);
    expect(plan.colliders.some((collider) => collider.id.includes('/lower-level-floor'))).toBe(true);
    expect(plan.colliders.some((collider) => collider.id.includes('/collider-lower-wall-'))).toBe(true);
    expect(plan.colliders.some((collider) => collider.id.includes('vista-'))).toBe(false);
    expect(plan.rooms.every((room) => room.id.startsWith(idPrefix))).toBe(true);
    expect(plan.walls.every((wall) => wall.id.startsWith(idPrefix))).toBe(true);
    expect(plan.colliders.every((collider) => collider.id.startsWith(idPrefix))).toBe(true);
    expect(isInfiniteChunkPlan(plan)).toBe(true);
    expect(getInfiniteChunkMetadata(plan)?.key).toBe(key);
  });

  it('prefixes IDs so neighboring plans do not collide', () => {
    const west = generateInfiniteChunk(seed, createChunkKey({ x: 0, z: 0, story: 0 }));
    const east = generateInfiniteChunk(seed, createChunkKey({ x: 1, z: 0, story: 0 }));
    const westIds = new Set([
      ...west.rooms.map((item) => item.id),
      ...west.walls.map((item) => item.id),
      ...west.colliders.map((item) => item.id),
      ...west.lights.map((item) => item.id),
      ...west.features.map((item) => item.id),
    ]);
    const eastIds = [
      ...east.rooms.map((item) => item.id),
      ...east.walls.map((item) => item.id),
      ...east.colliders.map((item) => item.id),
      ...east.lights.map((item) => item.id),
      ...east.features.map((item) => item.id),
    ];
    expect(eastIds.some((id) => westIds.has(id))).toBe(false);
  });

  it('derives ceiling openings from the canonical chunk directly above', () => {
    const coord = { x: -3, z: 7, story: -2 } as const;
    const key = createChunkKey(coord);
    const aboveKey = createChunkKey({ ...coord, story: coord.story + 1 });
    const plan = generateInfiniteChunk(seed, key);
    const above = generateInfiniteChunk(seed, aboveKey);
    const expected = getFloorOpenings(above);

    expect(ceilingOpeningsForChunk(seed, key)).toEqual(expected);
    expect(getInfiniteChunkCeilingOpenings(plan)).toEqual(expected);
  });

  it('physically leaves every canonical boundary gate open', () => {
    const plan = generateInfiniteChunk(seed, createChunkKey({ x: 2, z: 5, story: 1 }));
    const metadata = getInfiniteChunkMetadata(plan)!;
    const half = INFINITE_CHUNK_SIZE * 0.5;

    for (const [edge, gates] of Object.entries(metadata.edgeGates) as Array<
      [ChunkEdge, readonly { offset: number; width: number }[]]
    >) {
      // North and west own their shared seam. East/south are emitted by the
      // neighboring chunk, preventing coplanar duplicate walls and colliders.
      if (edge === 'east' || edge === 'south') continue;
      for (const level of ['upper', 'lower'] as const) {
        const boundaryWalls = plan.walls.filter((wall) => {
          if (!wall.id.includes(`/infinite-boundary-${edge}-${level}-`)) return false;
          return edge === 'north'
            ? Math.abs(Math.abs(wall.z) - half) < 0.01
            : Math.abs(Math.abs(wall.x) - half) < 0.01;
        });
        expect(boundaryWalls.length).toBeGreaterThan(0);
        expect(boundaryWalls.every((wall) => wall.bottom === (level === 'upper' ? 0 : -INFINITE_STORY_PITCH))).toBe(true);
        for (const gate of gates) {
          const covered = boundaryWalls.some((wall) => {
            const along = wall.orientation === 'x' ? wall.x : wall.z;
            return Math.abs(along - gate.offset) < wall.length * 0.5;
          });
          expect(covered).toBe(false);
        }
      }
    }
  });
});
