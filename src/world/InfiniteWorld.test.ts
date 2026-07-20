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
  inheritedShaftOpeningsForChunk,
  isInfiniteChunkPlan,
  parseChunkKey,
  verticalReservationsForChunk,
  type ChunkCoord,
  type ChunkEdge,
  type InfiniteBiome,
} from './InfiniteWorld';
import type { Rect } from './types';

const sameRect = (left: Rect, right: Rect): boolean =>
  Math.abs(left.minX - right.minX) < 0.02 &&
  Math.abs(left.minZ - right.minZ) < 0.02 &&
  Math.abs(left.maxX - right.maxX) < 0.02 &&
  Math.abs(left.maxZ - right.maxZ) < 0.02;

const overlaps = (left: Rect, right: Rect): boolean =>
  left.minX < right.maxX && left.maxX > right.minX &&
  left.minZ < right.maxZ && left.maxZ > right.minZ;

const wallsAround = (
  walls: ReturnType<typeof generateInfiniteChunk>['walls'],
  opening: Rect,
  marker: string,
) => walls.filter((wall) => {
  if (!wall.id.includes(marker)) return false;
  if (wall.orientation === 'x') {
    return Math.abs(wall.length - (opening.maxX - opening.minX)) < 0.03 &&
      (Math.abs(wall.z - opening.minZ) < 0.03 || Math.abs(wall.z - opening.maxZ) < 0.03);
  }
  return Math.abs(wall.length - (opening.maxZ - opening.minZ)) < 0.03 &&
    (Math.abs(wall.x - opening.minX) < 0.03 || Math.abs(wall.x - opening.maxX) < 0.03);
});

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

  it.each(sampleCoords)('strips finite vistas but keeps only a bounded lower preview for $x:$z:$story', (coord) => {
    const key = createChunkKey(coord);
    const plan = generateInfiniteChunk(seed, key);
    const idPrefix = `chunk-${key}/`;
    const pit = plan.features.find((feature) => feature.kind === 'grid-pit');

    expect(plan.features.some((feature) => feature.kind === 'impossible-vista')).toBe(false);
    expect(pit?.kind).toBe('grid-pit');
    if (pit?.kind !== 'grid-pit') throw new Error('Expected the chunk to retain its grid pit');
    expect((pit.lowerBounds.maxX - pit.lowerBounds.minX) * (pit.lowerBounds.maxZ - pit.lowerBounds.minZ))
      .toBeLessThan(plan.size * plan.size * 0.35);
    expect(pit.lowerBounds.minX).toBeLessThanOrEqual(pit.bounds.minX);
    expect(pit.lowerBounds.maxX).toBeGreaterThanOrEqual(pit.bounds.maxX);
    expect(pit.lowerBounds.minZ).toBeLessThanOrEqual(pit.bounds.minZ);
    expect(pit.lowerBounds.maxZ).toBeGreaterThanOrEqual(pit.bounds.maxZ);
    expect(plan.lights.every((light) => !light.id.includes('vista-light-'))).toBe(true);
    expect(plan.lights.some((light) => light.level === -1)).toBe(true);
    expect(plan.walls.some((wall) => wall.id.includes('/lower-wall-') && wall.bottom < 0)).toBe(true);
    expect(plan.colliders.some((collider) => collider.id.includes('/shaft-'))).toBe(true);
    expect(plan.colliders.some((collider) => collider.id.includes('/lower-level-floor'))).toBe(true);
    expect(plan.colliders.some((collider) => collider.id.includes('/collider-lower-wall-'))).toBe(true);
    expect(plan.walls.some((wall) => wall.id.includes('/infinite-boundary-') && wall.id.includes('-lower-')))
      .toBe(false);
    expect(plan.colliders.some((collider) => collider.id.includes('vista-'))).toBe(false);
    expect(plan.rooms.every((room) => room.id.startsWith(idPrefix))).toBe(true);
    expect(plan.walls.every((wall) => wall.id.startsWith(idPrefix))).toBe(true);
    expect(plan.colliders.every((collider) => collider.id.startsWith(idPrefix))).toBe(true);
    expect(isInfiniteChunkPlan(plan)).toBe(true);
    expect(getInfiniteChunkMetadata(plan)?.key).toBe(key);
    const blackedOutRooms = plan.rooms.filter((room) => {
      const lights = plan.lights.filter((light) => light.level >= 0 && light.roomId === room.id);
      return lights.length > 0 && lights.every((light) => light.dead);
    });
    expect(blackedOutRooms).toHaveLength(1);
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

  it('keeps active vertical atriums inset, fully shelled and reserved above', () => {
    const atriumSeed = 'ATRIUM-AUDIT';
    const sourceCoord = { x: 0, z: -12, story: -10 } as const;
    const source = generateInfiniteChunk(atriumSeed, sourceCoord);
    const tallRoom = source.rooms.find(
      (room) => room.ceilingHeight > source.wallHeight + 0.1,
    );
    expect(tallRoom).toBeDefined();
    if (!tallRoom) return;

    const half = source.size * 0.5;
    expect(tallRoom.bounds.minX).toBeGreaterThan(-half + 0.8);
    expect(tallRoom.bounds.minZ).toBeGreaterThan(-half + 0.8);
    expect(tallRoom.bounds.maxX).toBeLessThan(half - 0.8);
    expect(tallRoom.bounds.maxZ).toBeLessThan(half - 0.8);
    expect(source.walls.filter((wall) => wall.id.includes('/vertical-atrium-'))).toHaveLength(4);

    const span = Math.round(
      (tallRoom.ceilingHeight - source.wallHeight) / INFINITE_STORY_PITCH,
    );
    for (let distance = 1; distance <= span; distance += 1) {
      const upperCoord = { ...sourceCoord, story: sourceCoord.story + distance };
      const upper = generateInfiniteChunk(atriumSeed, upperCoord);
      expect(getFloorOpenings(upper).some((opening) => sameRect(opening, tallRoom.bounds))).toBe(true);
      expect(verticalReservationsForChunk(atriumSeed, upperCoord)
        .some((reservation) => sameRect(reservation.bounds, tallRoom.bounds))).toBe(true);
    }
    expect(verticalReservationsForChunk(atriumSeed, {
      ...sourceCoord,
      story: sourceCoord.story + span + 1,
    }).some((reservation) => sameRect(reservation.bounds, tallRoom.bounds))).toBe(false);
  });

  it('suppresses an atrium candidate that overlaps a lower vertical claim', () => {
    const coord = { x: 0, z: 0, story: -9998 } as const;
    const reservations = verticalReservationsForChunk('CHAIN-AUDIT', coord);
    const plan = generateInfiniteChunk('CHAIN-AUDIT', coord);
    const tallRooms = plan.rooms.filter(
      (room) => room.ceilingHeight > plan.wallHeight + 0.1,
    );

    expect(reservations.length).toBeGreaterThan(0);
    expect(tallRooms.every((room) =>
      reservations.every((reservation) => !overlaps(room.bounds, reservation.bounds))
    )).toBe(true);
  });

  it('does not inherit a deep shaft from a pit removed by an atrium claim', () => {
    const inherited = inheritedShaftOpeningsForChunk('PHANTOM-AUDIT', {
      x: 0,
      z: 0,
      story: -11978,
    });
    expect(inherited.some((opening) => opening.sourceStory === -11977)).toBe(false);
  });

  it('propagates a deep shaft through intermediate floors and closes its terminal landing', () => {
    const shaftSeed = 'SHAFT-AUDIT';
    const sourceCoord = { x: 0, z: 0, story: -91 } as const;
    const source = generateInfiniteChunk(shaftSeed, sourceCoord);
    const pit = source.features.find((feature) => feature.kind === 'grid-pit');
    const shaft = pit?.kind === 'grid-pit'
      ? pit.holes.find((hole) => hole.kind === 'void')
      : undefined;
    expect(shaft?.stories).toBe(7);
    if (!shaft?.stories) return;
    const center = {
      x: (shaft.minX + shaft.maxX) * 0.5,
      z: (shaft.minZ + shaft.maxZ) * 0.5,
    };

    for (let distance = 1; distance < shaft.stories; distance += 1) {
      const coord = { ...sourceCoord, story: sourceCoord.story - distance };
      const plan = generateInfiniteChunk(shaftSeed, coord);
      expect(getFloorOpenings(plan).some((opening) => sameRect(opening, shaft))).toBe(true);
      expect(plan.floorRects.some((floor) =>
        center.x >= floor.minX && center.x <= floor.maxX &&
        center.z >= floor.minZ && center.z <= floor.maxZ
      )).toBe(false);
      const shells = wallsAround(plan.walls, shaft, '/inherited-shaft-');
      expect(shells).toHaveLength(4);
      expect(shells.every((wall) =>
        Math.abs(wall.bottom - (plan.wallHeight - INFINITE_STORY_PITCH)) < 0.01 &&
        Math.abs(wall.bottom + wall.height - INFINITE_STORY_PITCH) < 0.01
      )).toBe(true);
      expect(getInfiniteChunkCeilingOpenings(plan)).toEqual(
        getFloorOpenings(generateInfiniteChunk(shaftSeed, {
          ...coord,
          story: coord.story + 1,
        })),
      );
    }

    const terminalCoord = {
      ...sourceCoord,
      story: sourceCoord.story - shaft.stories,
    };
    const terminal = generateInfiniteChunk(shaftSeed, terminalCoord);
    expect(getFloorOpenings(terminal).some((opening) => sameRect(opening, shaft))).toBe(false);
    expect(terminal.floorRects.some((floor) =>
      center.x >= floor.minX && center.x <= floor.maxX &&
      center.z >= floor.minZ && center.z <= floor.maxZ
    )).toBe(true);
    const collars = wallsAround(terminal.walls, shaft, '/ceiling-shaft-collar-');
    expect(collars).toHaveLength(4);
    expect(collars.every((wall) =>
      Math.abs(wall.bottom - terminal.wallHeight) < 0.01 &&
      Math.abs(wall.bottom + wall.height - INFINITE_STORY_PITCH) < 0.01
    )).toBe(true);
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
      const boundaryWalls = plan.walls.filter((wall) => {
        if (!wall.id.includes(`/infinite-boundary-${edge}-upper-`)) return false;
        return edge === 'north'
          ? Math.abs(Math.abs(wall.z) - half) < 0.01
          : Math.abs(Math.abs(wall.x) - half) < 0.01;
      });
      expect(boundaryWalls.length).toBeGreaterThan(0);
      expect(boundaryWalls.every((wall) => wall.bottom === 0)).toBe(true);
      for (const gate of gates) {
        const covered = boundaryWalls.some((wall) => {
          const along = wall.orientation === 'x' ? wall.x : wall.z;
          return Math.abs(along - gate.offset) < wall.length * 0.5;
        });
        expect(covered).toBe(false);
      }
    }
    expect(plan.walls.some((wall) => wall.id.includes('/infinite-boundary-') && wall.id.includes('-lower-')))
      .toBe(false);
  });
});
