import { describe, expect, it } from 'vitest';
import {
  INFINITE_CHUNK_SIZE,
  INFINITE_STORY_PITCH,
  ceilingOpeningsForChunk,
  createChunkKey,
  derivedChunkSeed,
  generateInfiniteChunk,
  getCanonicalEdgeGates,
  getChunkWorldOffset,
  getFloorOpenings,
  getInfiniteBiome,
  getInfiniteChunkCeilingOpenings,
  getInfiniteChunkMetadata,
  getInfiniteVisualBiome,
  getNeighborChunkKey,
  inheritedShaftOpeningsForChunk,
  inheritedStairForChunk,
  isInfiniteChunkPlan,
  parseChunkKey,
  type ChunkCoord,
  type ChunkEdge,
  type InfiniteBiome,
} from './InfiniteWorld';
import {
  MAX_PIT_STORIES,
  lightPanelOverlapsRect,
  worldMaxPitStories,
} from './generateWorld';
import type { PitHole, Rect, StairSocketFeature } from './types';
import { getStairFloorOpening, getStairSlabs } from './StairLayout';

const overlaps = (left: Rect, right: Rect): boolean =>
  left.minX < right.maxX && left.maxX > right.minX &&
  left.minZ < right.maxZ && left.maxZ > right.minZ;

const containsPoint = (rect: Rect, point: { x: number; z: number }): boolean =>
  point.x > rect.minX && point.x < rect.maxX &&
  point.z > rect.minZ && point.z < rect.maxZ;

const floorOpeningsThatPierceTheStoryBelow = (
  plan: ReturnType<typeof generateInfiniteChunk>,
): readonly Readonly<Rect>[] => {
  const inheritedStairOpenings = plan.features
    .filter((feature): feature is StairSocketFeature =>
      feature.kind === 'stair-socket' && feature.inherited === true
    )
    .map((feature) => getStairFloorOpening(feature));
  const shallowPassageHoles = plan.features.flatMap((feature) =>
    feature.kind === 'squeeze-view' ? feature.holes ?? [] : []
  );
  const localOnlyOpenings = [...inheritedStairOpenings, ...shallowPassageHoles];
  return getFloorOpenings(plan).filter((opening) =>
    !localOnlyOpenings.some((stairOpening) =>
      Math.abs(opening.minX - stairOpening.minX) < 0.02 &&
      Math.abs(opening.minZ - stairOpening.minZ) < 0.02 &&
      Math.abs(opening.maxX - stairOpening.maxX) < 0.02 &&
      Math.abs(opening.maxZ - stairOpening.maxZ) < 0.02
    )
  );
};

const wallsAround = (
  walls: ReturnType<typeof generateInfiniteChunk>['walls'],
  opening: Rect,
  marker: string,
) => walls.filter((wall) => {
  if (!wall.id.includes(marker)) return false;
  const centerX = (opening.minX + opening.maxX) * 0.5;
  const centerZ = (opening.minZ + opening.maxZ) * 0.5;
  if (wall.orientation === 'x') {
    return Math.abs(wall.x - centerX) < 0.03 &&
      Math.abs(wall.length - (opening.maxX - opening.minX)) < 0.03 &&
      (Math.abs(wall.z - opening.minZ) < 0.08 || Math.abs(wall.z - opening.maxZ) < 0.08);
  }
  return Math.abs(wall.z - centerZ) < 0.03 &&
    Math.abs(wall.length - (opening.maxZ - opening.minZ)) < 0.03 &&
    (Math.abs(wall.x - opening.minX) < 0.08 || Math.abs(wall.x - opening.maxX) < 0.08);
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

  it('assigns coherent 2x2 visual regions with an 80/10/10 distribution', () => {
    const biomeSeed = 'VISUAL-BIOME-RATIO-AUDIT';
    const counts = { yellow: 0, red: 0, white: 0 };
    for (let macroX = -30; macroX < 30; macroX += 1) {
      for (let macroZ = -30; macroZ < 30; macroZ += 1) {
        const members = Array.from({ length: 4 }, (_, index): ChunkCoord => ({
          x: macroX * 2 + index % 2,
          z: macroZ * 2 + Math.floor(index / 2),
          story: 0,
        }));
        const biomes = members.map((coord) => getInfiniteVisualBiome(biomeSeed, coord));
        expect(new Set(biomes).size).toBe(1);
        counts[biomes[0]!] += 1;
      }
    }
    const total = counts.yellow + counts.red + counts.white;
    expect(counts.yellow / total).toBeGreaterThan(0.76);
    expect(counts.yellow / total).toBeLessThan(0.84);
    expect(counts.red / total).toBeGreaterThan(0.075);
    expect(counts.red / total).toBeLessThan(0.125);
    expect(counts.white / total).toBeGreaterThan(0.075);
    expect(counts.white / total).toBeLessThan(0.125);
    expect(getInfiniteVisualBiome(biomeSeed, { x: 0, z: 0, story: 0 })).toBe('yellow');
  });

  it('serializes the visual biome and applies its fluorescent palette before baking', () => {
    const biomeSeed = 'VISUAL-BIOME-PALETTE-AUDIT';
    const findCoord = (target: 'red' | 'white'): ChunkCoord => {
      for (let x = -20; x <= 20; x += 2) {
        for (let z = -20; z <= 20; z += 2) {
          const coord = { x, z, story: 0 };
          if (getInfiniteVisualBiome(biomeSeed, coord) === target) return coord;
        }
      }
      throw new Error(`No ${target} visual biome found in audit sample.`);
    };
    const redPlan = generateInfiniteChunk(biomeSeed, findCoord('red'));
    const whitePlan = generateInfiniteChunk(biomeSeed, findCoord('white'));

    expect(redPlan.visualBiome).toBe('red');
    expect(getInfiniteChunkMetadata(redPlan)?.visualBiome).toBe('red');
    expect(whitePlan.visualBiome).toBe('white');
    expect(getInfiniteChunkMetadata(whitePlan)?.visualBiome).toBe('white');
    for (const light of redPlan.lights) {
      const red = (light.color >> 16) & 0xff;
      const green = (light.color >> 8) & 0xff;
      const blue = light.color & 0xff;
      expect(red).toBeGreaterThan(green * 2);
      expect(red).toBeGreaterThan(blue * 2);
    }
    for (const light of whitePlan.lights) {
      const red = (light.color >> 16) & 0xff;
      const green = (light.color >> 8) & 0xff;
      const blue = light.color & 0xff;
      expect(Math.max(red, green, blue) - Math.min(red, green, blue)).toBeLessThan(34);
    }
  });

  it('builds giant pillar fields and repeated threshold halls for liminal biomes', () => {
    const biomeSeed = 'LIMINAL-BIOME-AUDIT';
    const pillarPlan = generateInfiniteChunk(biomeSeed, { x: -15, z: -21, story: 0 });
    const thresholdPlan = generateInfiniteChunk(biomeSeed, { x: -30, z: -18, story: 0 });

    expect(getInfiniteChunkMetadata(pillarPlan)?.biome).toBe('pillar-hall');
    const pillars = pillarPlan.columns.filter((column) => column.kind === 'column');
    expect(pillars.length).toBeGreaterThan(12);
    expect(pillars.some((column) => Math.abs(column.width - column.depth) > 0.12)).toBe(true);
    expect(getInfiniteChunkMetadata(thresholdPlan)?.biome).toBe('tight-threshold');
    expect(thresholdPlan.walls.filter((wall) => wall.detail === 'threshold').length).toBeGreaterThan(0);
  });

  it.each(sampleCoords)('strips finite vistas but keeps only a bounded lower preview for $x:$z:$story', (coord) => {
    const key = createChunkKey(coord);
    const plan = generateInfiniteChunk(seed, key);
    const idPrefix = `chunk-${key}/`;
    const pit = plan.features.find((feature) => feature.kind === 'grid-pit');

    expect(plan.features.some((feature) => feature.kind === 'impossible-vista')).toBe(false);
    if (pit?.kind === 'grid-pit') {
      expect(pit.lowerBounds.minX).toBeGreaterThanOrEqual(-plan.size * 0.5);
      expect(pit.lowerBounds.maxX).toBeLessThanOrEqual(plan.size * 0.5);
      expect(pit.lowerBounds.minZ).toBeGreaterThanOrEqual(-plan.size * 0.5);
      expect(pit.lowerBounds.maxZ).toBeLessThanOrEqual(plan.size * 0.5);
      expect(pit.lowerBounds.minX).toBeLessThanOrEqual(pit.bounds.minX);
      expect(pit.lowerBounds.maxX).toBeGreaterThanOrEqual(pit.bounds.maxX);
      expect(pit.lowerBounds.minZ).toBeLessThanOrEqual(pit.bounds.minZ);
      expect(pit.lowerBounds.maxZ).toBeGreaterThanOrEqual(pit.bounds.maxZ);
    }
    expect(plan.lights.every((light) => !light.id.includes('vista-light-'))).toBe(true);
    if (pit) {
      expect(plan.lights.some((light) => light.level === -1)).toBe(true);
      expect(plan.walls.some((wall) => wall.id.includes('/lower-wall-') && wall.bottom < 0)).toBe(true);
      expect(plan.colliders.some((collider) => collider.id.includes('/shaft-'))).toBe(true);
      expect(
        plan.colliders.some((collider) => collider.id.includes('/lower-level-floor')) ||
        (plan.lowerPreviewOpenings?.length ?? 0) > 0
      ).toBe(true);
      expect(plan.colliders.some((collider) => collider.id.includes('/collider-lower-wall-'))).toBe(true);
    } else if (inheritedShaftOpeningsForChunk(seed, coord).length > 0) {
      expect(plan.walls.some((wall) => wall.id.includes('/inherited-shaft-'))).toBe(true);
    }
    expect(plan.walls.some((wall) => wall.id.includes('/infinite-boundary-') && wall.id.includes('-lower-')))
      .toBe(false);
    expect(plan.colliders.some((collider) => collider.id.includes('vista-'))).toBe(false);
    expect(plan.rooms.every((room) => room.id.startsWith(idPrefix))).toBe(true);
    expect(plan.walls.every((wall) => wall.id.startsWith(idPrefix))).toBe(true);
    expect(plan.colliders.every((collider) => collider.id.startsWith(idPrefix))).toBe(true);
    expect(plan.features.every(
      (feature) =>
        feature.kind !== 'raised-zone' ||
        plan.rooms.some((room) => room.id === feature.roomId),
    )).toBe(true);
    expect(isInfiniteChunkPlan(plan)).toBe(true);
    expect(getInfiniteChunkMetadata(plan)?.key).toBe(key);
    for (const light of plan.lights.filter((candidate) => candidate.level >= 0)) {
      const insideUnlitZone = (plan.unlitZones ?? []).some((zone) =>
        containsPoint(zone, { x: light.x, z: light.z })
      );
      expect(light.dead).toBe(insideUnlitZone);
    }
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
    const expected = floorOpeningsThatPierceTheStoryBelow(above);

    expect(ceilingOpeningsForChunk(seed, key)).toEqual(expected);
    expect(getInfiniteChunkCeilingOpenings(plan)).toEqual(expected);
    for (const light of plan.lights) {
      expect(expected.some((opening) => lightPanelOverlapsRect(light, opening))).toBe(false);
    }
  });

  it('inherits a complete staircase from below and opens both connected storeys', () => {
    const stairSeed = 'INFINITE-STAIR-CONNECTION-AUDIT';
    let destination: ChunkCoord | undefined;
    for (let x = -8; x <= 8 && !destination; x += 1) {
      for (let z = -8; z <= 8 && !destination; z += 1) {
        const candidate = { x, z, story: 1 };
        if (inheritedStairForChunk(stairSeed, candidate)) destination = candidate;
      }
    }
    expect(destination).toBeDefined();
    const upper = generateInfiniteChunk(stairSeed, destination!);
    const inherited = upper.features.find(
      (feature) => feature.kind === 'stair-socket' && feature.inherited,
    );
    expect(inherited).toBeDefined();
    if (!inherited || inherited.kind !== 'stair-socket') return;
    expect(inherited.baseY).toBe(-INFINITE_STORY_PITCH);
    expect(Math.max(...getStairSlabs(inherited).map((slab) => slab.top))).toBeCloseTo(0, 6);
    expect(upper.floorOpenings?.some((opening) => overlaps(opening, inherited.bounds))).toBe(true);
    expect(upper.colliders.filter((collider) =>
      collider.id.includes(`${inherited.id}-flight-ramp-`)
    )).toHaveLength(2);
    expect(upper.colliders.filter((collider) =>
      collider.id.includes(`${inherited.id}-`) && collider.kind === 'step'
    )).toHaveLength(4);

    const lower = generateInfiniteChunk(stairSeed, {
      ...destination!,
      story: destination!.story - 1,
    });
    const local = lower.features.find(
      (feature) => feature.kind === 'stair-socket' && !feature.inherited,
    );
    expect(local).toBeDefined();
    expect(lower.stairCeilingOpenings).toContainEqual(local?.bounds);
  });

  it('retires the old multi-storey atrium and all of its reservations', () => {
    const coords = Array.from({ length: 121 }, (_, index): ChunkCoord => ({
      x: index % 11 - 5,
      z: Math.floor(index / 11) - 5,
      story: index % 5 - 2,
    }));
    for (const coord of coords.filter((_, index) => index % 12 === 0)) {
      const plan = generateInfiniteChunk('ATRIUM-REMOVAL-AUDIT', coord);
      expect(plan.walls.some((wall) =>
        wall.id.includes('vertical-atrium-') || wall.id.includes('vertical-reservation-')
      )).toBe(false);
    }
  });

  it('keeps every surviving high ceiling fully shelled and clear of vertical openings', () => {
    let tallRoomCount = 0;
    for (let index = 0; index < 36; index += 1) {
      const coord = { x: index % 6 - 3, z: Math.floor(index / 6) - 3, story: index % 3 - 1 };
      const plan = generateInfiniteChunk('HIGH-CEILING-INVARIANT-AUDIT', coord);
      const openings = [
        ...getFloorOpenings(plan),
        ...getInfiniteChunkCeilingOpenings(plan),
      ];
      for (const room of plan.rooms.filter(
        (candidate) => candidate.ceilingHeight > plan.wallHeight + 0.1,
      )) {
        tallRoomCount += 1;
        expect(openings.some((opening) => overlaps(room.bounds, opening))).toBe(false);
        const shells = plan.walls.filter(
          (wall) => wall.detail === 'upper-shell' && wall.roomId === room.id,
        );
        expect(shells).toHaveLength(4);
        expect(shells.every((wall) =>
          wall.kind === 'wallpaper' &&
          wall.bottom <= plan.wallHeight &&
          wall.bottom + wall.height >= room.ceilingHeight
        )).toBe(true);
      }
      for (const feature of plan.features.filter((candidate) => candidate.kind === 'raised-zone')) {
        expect(openings.some((opening) => overlaps(feature.bounds, opening))).toBe(false);
      }
    }
    expect(tallRoomCount).toBeGreaterThan(0);
  });

  it('coalesces inherited shafts so active openings never overlap or explode in count', () => {
    let inheritedCount = 0;
    for (let index = 0; index < 36; index += 1) {
      const inherited = inheritedShaftOpeningsForChunk('SHAFT-COALESCE-AUDIT', {
        x: index % 6 - 3,
        z: Math.floor(index / 6) - 3,
        story: index % 4 - 2,
      });
      inheritedCount += inherited.length;
      expect(inherited.length).toBeLessThan(80);
      for (let left = 0; left < inherited.length; left += 1) {
        for (let right = left + 1; right < inherited.length; right += 1) {
          expect(overlaps(inherited[left]!, inherited[right]!)).toBe(false);
        }
      }
    }
    expect(inheritedCount).toBeGreaterThan(0);
  });

  it('propagates a deep shaft through intermediate floors and closes its terminal landing', () => {
    const shaftSeed = 'SHAFT-AUDIT';
    let sourceCoord: ChunkCoord | undefined;
    let shaft: PitHole | undefined;
    for (let index = 0; index < 900 && !shaft; index += 1) {
      const candidate: ChunkCoord = {
        x: index % 9 - 4,
        z: Math.floor(index / 9) % 9 - 4,
        story: -Math.floor(index / 81),
      };
      const key = createChunkKey(candidate);
      if (worldMaxPitStories(derivedChunkSeed(shaftSeed, key)) !== MAX_PIT_STORIES) continue;
      const source = generateInfiniteChunk(shaftSeed, candidate);
      const pit = source.features.find((feature) => feature.kind === 'grid-pit');
      const candidates = pit?.kind === 'grid-pit'
        ? pit.holes.filter((hole) => hole.stories === MAX_PIT_STORIES)
        : [];
      for (const candidateShaft of candidates) {
        const point = {
          x: (candidateShaft.minX + candidateShaft.maxX) * 0.5,
          z: (candidateShaft.minZ + candidateShaft.maxZ) * 0.5,
        };
        const terminal = generateInfiniteChunk(shaftSeed, {
          ...candidate,
          story: candidate.story - MAX_PIT_STORIES,
        });
        if (getFloorOpenings(terminal).some((opening) => containsPoint(opening, point))) continue;
        sourceCoord = candidate;
        shaft = candidateShaft;
        break;
      }
    }
    expect(shaft?.stories).toBe(MAX_PIT_STORIES);
    expect(sourceCoord).toBeDefined();
    if (!shaft?.stories || !sourceCoord) return;
    const center = {
      x: (shaft.minX + shaft.maxX) * 0.5,
      z: (shaft.minZ + shaft.maxZ) * 0.5,
    };

    for (let distance = 1; distance < shaft.stories; distance += 1) {
      const coord = { ...sourceCoord, story: sourceCoord.story - distance };
      const plan = generateInfiniteChunk(shaftSeed, coord);
      const activeOpening = inheritedShaftOpeningsForChunk(shaftSeed, coord)
        .find((opening) => containsPoint(opening, center));
      expect(activeOpening).toBeDefined();
      if (!activeOpening) continue;
      expect(getFloorOpenings(plan).some((opening) => containsPoint(opening, center))).toBe(true);
      expect(plan.floorRects.some((floor) =>
        center.x >= floor.minX && center.x <= floor.maxX &&
        center.z >= floor.minZ && center.z <= floor.maxZ
      )).toBe(false);
      expect(plan.colliders.some((collider) =>
        collider.kind !== 'floor' &&
        Math.abs(center.x - collider.center.x) < collider.halfExtents.x &&
        Math.abs(center.z - collider.center.z) < collider.halfExtents.z
      )).toBe(false);
      const continuesBelowPreview = (plan.lowerPreviewOpenings ?? [])
        .some((opening) => containsPoint(opening, center));
      expect(continuesBelowPreview).toBe(distance < shaft.stories! - 1);
      const canonicalOpening = getFloorOpenings(plan)
        .find((opening) => containsPoint(opening, center));
      expect(canonicalOpening).toBeDefined();
      if (!canonicalOpening) continue;
      const shells = wallsAround(plan.walls, canonicalOpening, '/inherited-shaft-');
      expect(shells).toHaveLength(4);
      expect(shells.every((wall) => wall.kind === 'wallpaper' && wall.tint >= 0.94)).toBe(true);
      expect(shells.every((wall) =>
        Math.abs(wall.bottom - (plan.wallHeight - INFINITE_STORY_PITCH)) < 0.01 &&
        Math.abs(wall.bottom + wall.height - INFINITE_STORY_PITCH) < 0.01
      )).toBe(true);
      expect(getInfiniteChunkCeilingOpenings(plan)).toEqual(
        floorOpeningsThatPierceTheStoryBelow(generateInfiniteChunk(shaftSeed, {
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
    expect(getFloorOpenings(terminal).some((opening) => containsPoint(opening, center))).toBe(false);
    expect(terminal.floorRects.some((floor) =>
      center.x >= floor.minX && center.x <= floor.maxX &&
      center.z >= floor.minZ && center.z <= floor.maxZ
    )).toBe(true);
    const terminalCeilingOpening = getInfiniteChunkCeilingOpenings(terminal)
      .find((opening) => containsPoint(opening, center));
    expect(terminalCeilingOpening).toBeDefined();
    if (!terminalCeilingOpening) return;
    const collars = wallsAround(terminal.walls, terminalCeilingOpening, '/ceiling-shaft-collar-');
    expect(collars).toHaveLength(4);
    expect(collars.every((wall) =>
      Math.abs(wall.bottom - terminal.wallHeight) < 0.01 &&
      Math.abs(wall.bottom + wall.height - INFINITE_STORY_PITCH) < 0.01
    )).toBe(true);
    expect(collars.every((wall) => wall.kind === 'wallpaper')).toBe(true);
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
