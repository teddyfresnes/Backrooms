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
import {
  EPIC1_PORTAL_HEIGHT,
  EPIC_STRUCTURE_DEFINITIONS,
  epicStructureIndexForCoord,
  getEpic1FunnelStoryBounds,
  getEpicStairwellLayout,
  getEpicStructureSlotsForMacro,
} from './EpicStructures';
import type {
  EpicStructureFeature,
  PitHole,
  Rect,
  StairSocketFeature,
  StaticCollider,
  WallSegment,
} from './types';
import { rectArea, rectDepth, rectWidth } from './types';
import { getStairFloorOpening, getStairSlabs } from './StairLayout';

const overlaps = (left: Rect, right: Rect): boolean =>
  left.minX < right.maxX && left.maxX > right.minX &&
  left.minZ < right.maxZ && left.maxZ > right.minZ;

const sameRect = (left: Rect, right: Rect): boolean =>
  Math.abs(left.minX - right.minX) < 0.02 &&
  Math.abs(left.maxX - right.maxX) < 0.02 &&
  Math.abs(left.minZ - right.minZ) < 0.02 &&
  Math.abs(left.maxZ - right.maxZ) < 0.02;

const containsPoint = (rect: Rect, point: { x: number; z: number }): boolean =>
  point.x > rect.minX && point.x < rect.maxX &&
  point.z > rect.minZ && point.z < rect.maxZ;

const colliderFootprint = (collider: StaticCollider): Rect => ({
  minX: collider.center.x - collider.halfExtents.x,
  maxX: collider.center.x + collider.halfExtents.x,
  minZ: collider.center.z - collider.halfExtents.z,
  maxZ: collider.center.z + collider.halfExtents.z,
});

const wallFootprint = (wall: WallSegment): Rect => {
  const halfLength = wall.length * 0.5;
  const halfThickness = wall.thickness * 0.5;
  return wall.orientation === 'x'
    ? {
        minX: wall.x - halfLength,
        maxX: wall.x + halfLength,
        minZ: wall.z - halfThickness,
        maxZ: wall.z + halfThickness,
      }
    : {
        minX: wall.x - halfThickness,
        maxX: wall.x + halfThickness,
        minZ: wall.z - halfLength,
        maxZ: wall.z + halfLength,
      };
};

const colliderContainsPoint = (
  collider: StaticCollider,
  point: { x: number; z: number },
): boolean =>
  Math.abs(point.x - collider.center.x) < collider.halfExtents.x &&
  Math.abs(point.z - collider.center.z) < collider.halfExtents.z;

const epicMarker = (
  plan: ReturnType<typeof generateInfiniteChunk>,
): EpicStructureFeature | undefined =>
  plan.features.find(
    (feature): feature is EpicStructureFeature => feature.kind === 'epic-structure',
  );

const floorOpeningsThatPierceTheStoryBelow = (
  plan: ReturnType<typeof generateInfiniteChunk>,
): readonly Readonly<Rect>[] => {
  const inheritedStairOpenings = plan.features
    .filter((feature): feature is StairSocketFeature =>
      feature.kind === 'stair-socket' && feature.inherited === true
    )
    .map((feature) => getStairFloorOpening(feature));
  const localOnlyOpenings = inheritedStairOpenings;
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
      Math.abs(wall.length - (opening.maxX - opening.minX + wall.thickness * 2)) < 0.03 &&
      (Math.abs(wall.z - opening.minZ) < 0.08 || Math.abs(wall.z - opening.maxZ) < 0.08);
  }
  return Math.abs(wall.z - centerZ) < 0.03 &&
    Math.abs(wall.length - (opening.maxZ - opening.minZ + wall.thickness * 2)) < 0.03 &&
    (Math.abs(wall.x - opening.minX) < 0.08 || Math.abs(wall.x - opening.maxX) < 0.08);
});

const inheritedShaftEnclosures = (
  plan: ReturnType<typeof generateInfiniteChunk>,
): Array<{ bounds: Rect; walls: WallSegment[] }> => {
  const groups = new Map<string, WallSegment[]>();
  for (const wall of plan.walls) {
    const match = wall.id.match(/inherited-shaft-enclosure-(\d+)-(north|south|west|east)$/);
    if (!match) continue;
    const group = groups.get(match[1]!) ?? [];
    group.push(wall);
    groups.set(match[1]!, group);
  }
  return [...groups.values()].flatMap((walls) => {
    const north = walls.find((wall) => wall.id.endsWith('-north'));
    const south = walls.find((wall) => wall.id.endsWith('-south'));
    const west = walls.find((wall) => wall.id.endsWith('-west'));
    const east = walls.find((wall) => wall.id.endsWith('-east'));
    if (!north || !south || !west || !east) return [];
    return [{
      bounds: {
        minX: west.x,
        maxX: east.x,
        minZ: north.z,
        maxZ: south.z,
      },
      walls,
    }];
  });
};

const seed = 'INFINITE-CONTRACT-AUDIT';
const sampleCoords: ChunkCoord[] = [
  { x: 0, z: 0, story: 0 },
  { x: 1, z: -2, story: 0 },
  { x: -9, z: 4, story: 3 },
  { x: 41, z: -27, story: -5 },
];

const epicAuditSeed = 'EPIC-PAVING-AUDIT';
const epicAuditMacro = { x: -2, z: 1 } as const;
const epicAuditStory = -4;
const epicAuditSlots = getEpicStructureSlotsForMacro(
  epicAuditSeed,
  epicAuditMacro.x,
  epicAuditMacro.z,
);
const epicAuditStructureCoords: ChunkCoord[] = epicAuditSlots.map((slot) => ({
  x: slot.x,
  z: slot.z,
  story: epicAuditStory,
}));
const epicAuditOrdinaryCoords: ChunkCoord[] = epicAuditSlots.slice(0, 3).map((slot) => ({
  x: slot.x + 1,
  z: slot.z + 1,
  story: epicAuditStory,
}));
const epicAuditCoords = [...epicAuditStructureCoords, ...epicAuditOrdinaryCoords];
const epicAuditPlans = new Map<string, ReturnType<typeof generateInfiniteChunk>>();
const epicAuditPlan = (
  coord: ChunkCoord,
): ReturnType<typeof generateInfiniteChunk> => {
  const key = createChunkKey(coord);
  const cached = epicAuditPlans.get(key);
  if (cached) return cached;
  const plan = generateInfiniteChunk(epicAuditSeed, key);
  epicAuditPlans.set(key, plan);
  return plan;
};

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
        const plan = generateInfiniteChunk(seed, createChunkKey({
          x: (index - 10) * 3,
          z: (index % 4) * 3,
          story: 0,
        }));
        return plan.rooms
          .map((room) => `${room.kind}:${room.bounds.minX}:${room.bounds.minZ}:${room.bounds.maxX}:${room.bounds.maxZ}`)
          .join('|');
      }),
    );
    expect(fingerprints.size).toBeGreaterThanOrEqual(18);
  });

  describe('epic structure paving', () => {
    it('places exactly epic1 through epic5 in a deterministic sparse macro', () => {
      const expectedIndices = [1, 2, 3, 4, 5];
      expect(EPIC_STRUCTURE_DEFINITIONS.map((definition) => definition.index)).toEqual(
        expectedIndices,
      );
      expect(getEpicStructureSlotsForMacro(
        epicAuditSeed,
        epicAuditMacro.x,
        epicAuditMacro.z,
      )).toEqual(epicAuditSlots);
      expect(epicAuditSlots.map((slot) => slot.index).sort((left, right) => left - right))
        .toEqual(expectedIndices);

      for (const coord of epicAuditStructureCoords) {
        const plan = epicAuditPlan(coord);
        const marker = epicMarker(plan);
        const assignedIndex = epicStructureIndexForCoord(epicAuditSeed, coord);
        expect(marker?.index ?? null).toBe(assignedIndex);
        expect(getInfiniteChunkMetadata(plan)?.coord).toEqual(coord);
      }

      for (const coord of epicAuditOrdinaryCoords) {
        expect(epicStructureIndexForCoord(epicAuditSeed, coord)).toBeNull();
        expect(epicMarker(epicAuditPlan(coord))).toBeUndefined();
      }
    });

    it('keeps every Chebyshev neighbour of an epic slot ordinary', () => {
      for (const slot of epicAuditSlots) {
        for (let deltaZ = -1; deltaZ <= 1; deltaZ += 1) {
          for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
            if (deltaX === 0 && deltaZ === 0) continue;
            expect(epicStructureIndexForCoord(epicAuditSeed, {
              x: slot.x + deltaX,
              z: slot.z + deltaZ,
            })).toBeNull();
          }
        }
      }
    });

    it('keeps every epic destination on walkable floor and outside floor openings', () => {
      for (const coord of epicAuditStructureCoords) {
        const plan = epicAuditPlan(coord);
        const marker = epicMarker(plan)!;
        if (marker.index === 3) {
          expect(marker.entryLevel).toBeGreaterThan(0);
          expect(marker.destination.y).toBeGreaterThan(0.865);
          const supportingSurfaceY = marker.destination.y - 0.865;
          expect(plan.colliders.some((collider) =>
            collider.kind === 'floor' &&
            colliderContainsPoint(collider, marker.destination) &&
            Math.abs(
              collider.center.y + collider.halfExtents.y - supportingSurfaceY,
            ) < 0.02
          )).toBe(true);
        } else {
          expect(plan.floorRects.some((floor) =>
            containsPoint(floor, marker.destination)
          )).toBe(true);
        }
        expect(getFloorOpenings(plan).some((opening) =>
          containsPoint(opening, marker.destination)
        )).toBe(false);
      }
    });

    it('lets epic3 cross horizontal chunk seams without rebuilding an outer rim', () => {
      const coord = epicAuditStructureCoords.find(
        (candidate) => epicStructureIndexForCoord(epicAuditSeed, candidate) === 3,
      )!;
      const plan = epicAuditPlan(coord);
      const marker = epicMarker(plan)!;

      expect(rectWidth(marker.bounds)).toBeGreaterThan(INFINITE_CHUNK_SIZE * 1.9);
      expect(rectDepth(marker.passageFacadeBounds!)).toBeCloseTo(
        rectDepth(marker.voidBounds!),
        5,
      );
      expect(plan.walls.some((wall) =>
        wall.id.includes('/infinite-boundary-west-upper-') ||
        wall.id.includes('/biome-transition-west-') ||
        wall.id.includes('/biome-transition-east-')
      )).toBe(false);
      expect(plan.floorRects).toHaveLength(2);
      expect(plan.floorRects.every((floor) =>
        Math.abs(rectWidth(floor) - rectWidth(marker.bounds)) < 1e-5
      )).toBe(true);
      expect(plan.colliders.some((collider) =>
        collider.id.includes('gallery-back') || collider.id.includes('ledge-floor')
      )).toBe(false);
      expect(plan.colliders.some((collider) =>
        collider.id.includes('epic3-ground-gallery-wall-')
      )).toBe(true);
      expect(plan.lights.every((light) =>
        !marker.voidBounds || !containsPoint(marker.voidBounds, light)
      )).toBe(true);
    });

    it('makes epic1 a 90% abyss with continuous story ledges and segmented entrances', () => {
      const plan = epicAuditPlan(
        epicAuditStructureCoords.find(
          (coord) => epicStructureIndexForCoord(epicAuditSeed, coord) === 1,
        )!,
      );
      const marker = epicMarker(plan);
      expect(marker?.index).toBe(1);
      expect(marker?.voidBounds).toBeDefined();
      expect(marker?.passageFacadeBounds).toBeDefined();
      if (!marker?.voidBounds || !marker.passageFacadeBounds) return;
      const voidBounds = marker.voidBounds;
      const facadeBounds = marker.passageFacadeBounds;
      const voidInterior = {
        minX: voidBounds.minX + 0.01,
        minZ: voidBounds.minZ + 0.01,
        maxX: voidBounds.maxX - 0.01,
        maxZ: voidBounds.maxZ - 0.01,
      };

      expect(rectWidth(voidBounds) * rectDepth(voidBounds) / (plan.size * plan.size))
        .toBeGreaterThan(0.9);
      expect(facadeBounds.minX - voidBounds.minX).toBeCloseTo(-1.05, 5);
      expect(voidBounds.maxX - facadeBounds.maxX).toBeCloseTo(-1.05, 5);

      expect(getFloorOpenings(plan).some((opening) => sameRect(opening, voidBounds)))
        .toBe(true);
      expect(getInfiniteChunkCeilingOpenings(plan).some(
        (opening) => sameRect(opening, voidBounds),
      )).toBe(true);
      expect((plan.lowerPreviewOpenings ?? []).some(
        (opening) => sameRect(opening, voidBounds),
      )).toBe(true);

      const currentLevel = marker.passageLevels?.find((level) => Math.abs(level.y) < 0.01);
      const baseFloorColliders = plan.colliders.filter((collider) =>
        collider.id.includes('/floor-epic-')
      );
      expect(baseFloorColliders).toHaveLength(4 + (currentLevel?.passages.length ?? 0));
      for (const collider of baseFloorColliders) {
        expect(overlaps(colliderFootprint(collider), voidInterior)).toBe(false);
      }

      expect(currentLevel?.passages.length).toBeGreaterThanOrEqual(8);
      expect(new Set(currentLevel?.passages.map((passage) => passage.side)))
        .toEqual(new Set(['north', 'south', 'west', 'east']));
      expect(currentLevel?.passages.every((passage) => passage.corridorDepth <= 1.22))
        .toBe(true);
      const northPassages = currentLevel?.passages.filter((passage) => passage.side === 'north') ?? [];
      const uncutOuterFloorX = Array.from({ length: 105 }, (_, index) => -52 + index)
        .find((x) => northPassages.every(
          (passage) => Math.abs(x - passage.along) > passage.width * 0.5 + 0.05,
        ));
      expect(uncutOuterFloorX).toBeDefined();
      expect(plan.floorRects.some((floor) =>
        uncutOuterFloorX !== undefined &&
        uncutOuterFloorX >= floor.minX && uncutOuterFloorX <= floor.maxX &&
        -55.2 >= floor.minZ && -55.2 <= floor.maxZ
      )).toBe(false);
      const sourceCoord = getInfiniteChunkMetadata(plan)!.coord;
      for (const side of ['north', 'south', 'west', 'east'] as const) {
        const expectedGates = currentLevel?.passages
          .filter((passage) => passage.side === side)
          .map((passage) => ({ offset: passage.along, width: passage.width })) ?? [];
        expect(getCanonicalEdgeGates(epicAuditSeed, sourceCoord, side)).toEqual(expectedGates);
        const neighbor = parseChunkKey(getNeighborChunkKey(sourceCoord, side));
        expect(getCanonicalEdgeGates(epicAuditSeed, neighbor, opposite[side]))
          .toEqual(expectedGates);
      }
      const passageFloorColliders = plan.colliders.filter((collider) =>
        collider.id.includes('/epic1-passage-floor-')
      );
      expect(passageFloorColliders).toHaveLength(0);
      const passageWallColliders = plan.colliders.filter((collider) =>
        collider.id.includes('/epic1-passage-') && collider.kind === 'wall'
      );
      expect(passageWallColliders.length).toBeGreaterThan(0);
      expect(passageWallColliders.every((collider) =>
        Math.abs(collider.center.y + collider.halfExtents.y - EPIC1_PORTAL_HEIGHT) < 1e-5
      )).toBe(true);

      const shaftWalls = plan.colliders.filter((collider) =>
        collider.id.includes('/epic1-shaft-wall-')
      );
      expect(shaftWalls.length).toBeGreaterThan(4);
      for (const collider of shaftWalls) {
        expect(collider.center.y - collider.halfExtents.y).toBeCloseTo(0, 5);
        expect(collider.center.y + collider.halfExtents.y).toBeCloseTo(
          INFINITE_STORY_PITCH,
          5,
        );
      }

      for (const passage of currentLevel?.passages ?? []) {
        const portalCenter = passage.side === 'north'
          ? { x: passage.along, z: facadeBounds.minZ }
          : passage.side === 'south'
            ? { x: passage.along, z: facadeBounds.maxZ }
            : passage.side === 'west'
              ? { x: facadeBounds.minX, z: passage.along }
              : { x: facadeBounds.maxX, z: passage.along };
        expect(shaftWalls.some((collider) => colliderContainsPoint(collider, portalCenter)))
          .toBe(false);
        const outward = passage.side === 'north' || passage.side === 'west' ? -1 : 1;
        const corridorPoint = passage.side === 'north' || passage.side === 'south'
          ? { x: passage.along, z: portalCenter.z + outward * 1.15 }
          : { x: portalCenter.x + outward * 1.15, z: passage.along };
        expect(baseFloorColliders.some((collider) => colliderContainsPoint(collider, corridorPoint)))
          .toBe(true);
      }

      const lowerPreview = marker.passageLevels?.find(
        (level) => Math.abs(level.y + INFINITE_STORY_PITCH) < 0.01,
      );
      const lowerPlan = generateInfiniteChunk(epicAuditSeed, {
        ...sourceCoord,
        story: sourceCoord.story - 1,
      });
      const lowerMarker = epicMarker(lowerPlan)!;
      const lowerCurrent = lowerMarker.passageLevels?.find((level) => level.y === 0);
      expect(lowerPreview?.passages).toEqual(lowerCurrent?.passages);
      expect(getEpic1FunnelStoryBounds(marker, -INFINITE_STORY_PITCH))
        .toEqual(getEpic1FunnelStoryBounds(lowerMarker, 0));
      const upperPreview = marker.passageLevels?.find(
        (level) => Math.abs(level.y - INFINITE_STORY_PITCH) < 0.01,
      );
      const upperPlan = generateInfiniteChunk(epicAuditSeed, {
        ...sourceCoord,
        story: sourceCoord.story + 1,
      });
      const upperCurrent = epicMarker(upperPlan)?.passageLevels
        ?.find((level) => level.y === 0);
      expect(upperPreview?.passages).toEqual(upperCurrent?.passages);
      expect(getEpic1FunnelStoryBounds(marker, INFINITE_STORY_PITCH))
        .toEqual(getEpic1FunnelStoryBounds(epicMarker(upperPlan)!, 0));
      expect(marker.passageLevels?.filter((level) => level.y > 0)).toHaveLength(4);
      const previewLedges = plan.colliders.filter((collider) =>
        collider.id.includes('/epic1-lower-preview-ledge-floor-')
      );
      expect(previewLedges).toHaveLength(4);
      const lowerFunnel = getEpic1FunnelStoryBounds(marker, -INFINITE_STORY_PITCH);
      for (const collider of previewLedges) {
        expect(collider.center.y + collider.halfExtents.y)
          .toBeCloseTo(-INFINITE_STORY_PITCH, 5);
        expect(overlaps(colliderFootprint(collider), lowerFunnel.voidBounds)).toBe(false);
      }
      expect(previewLedges.some((collider) =>
        overlaps(colliderFootprint(collider), voidInterior)
      )).toBe(true);
      const funnelSupports = plan.colliders.filter((collider) =>
        collider.id.includes('/epic1-funnel-support-wall-')
      );
      expect(funnelSupports).toHaveLength(4);
      expect(funnelSupports.every((collider) =>
        Math.abs(collider.center.y - collider.halfExtents.y + INFINITE_STORY_PITCH) < 1e-5 &&
        Math.abs(collider.center.y + collider.halfExtents.y + 0.22) < 1e-5
      )).toBe(true);
      const previewCorridors = plan.colliders.filter((collider) =>
        collider.id.includes('/epic1-lower-preview-corridor-floor-')
      );
      expect(previewCorridors).toHaveLength(0);
      expect(plan.lights.every((light) => !lightPanelOverlapsRect(light, voidBounds))).toBe(true);
      expect(plan.lights.every((light) => Math.abs(light.ceilingY - 5.2) < 1e-6)).toBe(true);
    });

    it('embeds epic4 in the ordinary maze and leaves a real opening to its upper continuation', () => {
      const plan = epicAuditPlan(
        epicAuditStructureCoords.find(
          (coord) => epicStructureIndexForCoord(epicAuditSeed, coord) === 4,
        )!,
      );
      const marker = epicMarker(plan)!;
      const layout = getEpicStairwellLayout(marker);
      const clearance = {
        minX: marker.bounds.minX - 3.15,
        maxX: marker.bounds.maxX + 3.15,
        minZ: marker.bounds.minZ - 3.15,
        maxZ: marker.bounds.maxZ + 3.15,
      };
      const retainedMazeWalls = plan.walls.filter((wall) =>
        !wall.id.includes('infinite-boundary-') &&
        !wall.id.includes('biome-boundary-')
      );

      expect(rectWidth(marker.bounds)).toBeCloseTo(19.2, 5);
      expect(plan.floorRects).toEqual([{
        minX: -INFINITE_CHUNK_SIZE * 0.5,
        maxX: INFINITE_CHUNK_SIZE * 0.5,
        minZ: -INFINITE_CHUNK_SIZE * 0.5,
        maxZ: INFINITE_CHUNK_SIZE * 0.5,
      }]);
      expect(plan.rooms.length).toBeGreaterThan(1);
      expect(retainedMazeWalls.length).toBeGreaterThan(0);
      expect(retainedMazeWalls.every((wall) =>
        !overlaps({
          minX: wall.x - (wall.orientation === 'x' ? wall.length : wall.thickness) * 0.5,
          maxX: wall.x + (wall.orientation === 'x' ? wall.length : wall.thickness) * 0.5,
          minZ: wall.z - (wall.orientation === 'z' ? wall.length : wall.thickness) * 0.5,
          maxZ: wall.z + (wall.orientation === 'z' ? wall.length : wall.thickness) * 0.5,
        }, clearance)
      )).toBe(true);
      expect(plan.colliders.some((collider) =>
        collider.id.includes('epic4-upper-maze-floor-')
      )).toBe(true);
      expect(plan.colliders.some((collider) =>
        collider.id.includes('epic4-upper-maze-') && collider.kind === 'wall'
      )).toBe(true);
      expect(plan.colliders.filter((collider) =>
        collider.id.includes('epic4-summit-floor-') &&
        colliderContainsPoint(collider, { x: -5.9, z: 0 })
      )).toHaveLength(0);
      expect(layout.upperFloorRects.some((floor) => containsPoint(floor, { x: -5.9, z: -12 })))
        .toBe(true);
    });

    it('prefixes epic IDs and preserves every serialized marker through structuredClone', () => {
      for (const coord of epicAuditStructureCoords) {
        const plan = epicAuditPlan(coord);
        const marker = epicMarker(plan)!;
        const prefix = `chunk-${createChunkKey(coord)}/`;
        expect(marker.id.startsWith(prefix)).toBe(true);
        expect(marker.roomId.startsWith(prefix)).toBe(true);
        expect(plan.rooms.some((room) => room.id === marker.roomId)).toBe(true);

        const cloned = structuredClone(plan);
        expect(cloned).toEqual(plan);
        expect(epicMarker(cloned)).toEqual(marker);
      }
    });

    it('rebuilds sparse epic and sampled ordinary chunks deterministically', () => {
      for (const coord of epicAuditCoords) {
        expect(generateInfiniteChunk(epicAuditSeed, coord)).toEqual(epicAuditPlan(coord));
      }
    });
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
        for (const story of [-8, -1, 1, 9]) {
          expect(getInfiniteVisualBiome(biomeSeed, { ...members[0]!, story }))
            .toBe(biomes[0]);
        }
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

  it('keeps wall, floor and ceiling treatment stable through vertical connections', () => {
    const columnSeed = 'VERTICAL-SURFACE-CONTINUITY-AUDIT';
    const coords = [-7, -1, 0, 1, 8].map((story) => ({ x: 7, z: -11, story }));
    const plans = coords.map((coord) => generateInfiniteChunk(columnSeed, coord));
    expect(new Set(plans.map((plan) => plan.visualBiome)).size).toBe(1);
    for (const plan of plans.slice(1)) {
      expect(plan.surfaceStyle).toEqual(plans[0]!.surfaceStyle);
    }
  });

  it('serializes the visual biome and applies its fluorescent palette before rendering', () => {
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
    const pillarCoords: ChunkCoord[] = [];
    pillarSearch:
    for (let x = -30; x <= 30; x += 3) {
      for (let z = -30; z <= 30; z += 3) {
        const coord = { x, z, story: 0 };
        if (getInfiniteBiome(biomeSeed, coord) !== 'pillar-hall') continue;
        pillarCoords.push(coord);
        if (pillarCoords.length === 4) break pillarSearch;
      }
    }
    expect(pillarCoords).toHaveLength(4);
    const pillarPlans = pillarCoords.map((coord) => generateInfiniteChunk(biomeSeed, coord));
    let thresholdCoord: ChunkCoord | undefined;
    thresholdSearch:
    for (let x = -30; x <= 30; x += 3) {
      for (let z = -30; z <= 30; z += 3) {
        const coord = { x, z, story: 0 };
        if (getInfiniteBiome(biomeSeed, coord) !== 'tight-threshold') continue;
        thresholdCoord = coord;
        break thresholdSearch;
      }
    }
    expect(thresholdCoord).toBeDefined();
    const thresholdPlan = generateInfiniteChunk(biomeSeed, thresholdCoord!);

    expect(pillarPlans.every(
      (plan) => getInfiniteChunkMetadata(plan)?.biome === 'pillar-hall',
    )).toBe(true);
    expect(pillarPlans.some(
      (plan) => plan.columns.filter((column) => column.kind === 'column').length > 12,
    )).toBe(true);
    const ordinaryPillarPlans = pillarPlans.filter(
      (plan) => !plan.features.some((feature) => feature.kind === 'epic-structure'),
    );
    expect(ordinaryPillarPlans.length).toBeGreaterThan(0);
    for (const plan of ordinaryPillarPlans) {
      const hall = [...plan.rooms]
        .filter((room) => room.kind === 'open-hall')
        .sort((left, right) => rectArea(right.bounds) - rectArea(left.bounds))[0]!;
      const hallLights = plan.lights.filter((light) => light.roomId === hall.id);
      expect(hallLights.length).toBeGreaterThanOrEqual(4);
      expect(hallLights.every((light) => light.id.includes('pillar-hall-light-'))).toBe(true);
      expect(hallLights.every((light) => light.ceilingY === hall.ceilingHeight)).toBe(true);
      for (const light of hallLights) {
        const halfPanelX = light.rotation === 0 ? light.width * 0.5 : 0.64;
        const halfPanelZ = light.rotation === 0 ? 0.64 : light.width * 0.5;
        expect(plan.columns.some(
          (pillar) =>
            Math.abs(light.x - pillar.x) <= pillar.width * 0.5 + halfPanelX + 0.28 &&
            Math.abs(light.z - pillar.z) <= pillar.depth * 0.5 + halfPanelZ + 0.28,
        )).toBe(false);
      }
    }
    const pillars = pillarPlans.flatMap((plan) =>
      plan.columns.filter((column) => column.kind === 'column')
    );
    expect(pillars.filter((column) => Math.max(column.width, column.depth) >= 1.5).length)
      .toBeGreaterThan(pillars.length * 0.6);
    expect(pillars.filter((column) => Math.max(column.width, column.depth) < 0.95).length)
      .toBeLessThan(pillars.length * 0.15);
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
        [
          ...(feature.roomIds ?? [feature.roomId]),
          ...(feature.approachRoomIds ?? []),
        ].every((roomId) =>
          plan.rooms.some((room) => room.id === roomId)
        ),
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

  it('prefixes every cross-reference owned by an interactive door', () => {
    let plan: ReturnType<typeof generateInfiniteChunk> | undefined;
    for (let index = 0; index < 24 && !plan; index += 1) {
      const candidate = generateInfiniteChunk(
        'INFINITE-DOOR-PREFIX',
        createChunkKey({ x: index * 3, z: -index * 3, story: 0 }),
      );
      if (candidate.features.some((feature) => feature.kind === 'interactive-door')) {
        plan = candidate;
      }
    }
    expect(plan).toBeDefined();
    const prefix = `chunk-${getInfiniteChunkMetadata(plan!)!.key}/`;
    for (const door of plan!.features.filter(
      (feature) => feature.kind === 'interactive-door',
    )) {
      expect(door.id.startsWith(prefix)).toBe(true);
      expect(door.sourceRoomId.startsWith(prefix)).toBe(true);
      expect(door.targetRoomId.startsWith(prefix)).toBe(true);
      expect(door.colliderId.startsWith(prefix)).toBe(true);
      expect(plan!.rooms.some((room) => room.id === door.sourceRoomId)).toBe(true);
      expect(plan!.rooms.some((room) => room.id === door.targetRoomId)).toBe(true);
      expect(plan!.colliders.some((collider) => collider.id === door.colliderId)).toBe(true);
    }
  });

  it('derives ceiling openings from the canonical chunk directly above', () => {
    const coord = { x: -3, z: 6, story: -2 } as const;
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

  it('connects crouch-passage drops to the lower storey and keeps voids open', () => {
    const seed = 'PASSAGE-SHAFT-AUDIT';
    const cases: Array<{
      coord: ChunkCoord;
      kind: 'drop' | 'void';
    }> = [
      { coord: { x: -15, z: -27, story: 1 }, kind: 'drop' },
      { coord: { x: -3, z: -21, story: 1 }, kind: 'void' },
    ];
    for (const { coord, kind } of cases) {
      const source = generateInfiniteChunk(seed, coord);
      const sourceFeature = source.features.find(
        (feature) =>
          feature.kind === 'squeeze-view' &&
          feature.holes?.some((hole) => (hole.kind ?? 'drop') === kind),
      );
      expect(sourceFeature?.kind).toBe('squeeze-view');
      if (!sourceFeature || sourceFeature.kind !== 'squeeze-view') continue;
      const hole = sourceFeature.holes?.find(
        (candidate) => (candidate.kind ?? 'drop') === kind,
      );
      expect(hole).toBeDefined();
      if (!hole) continue;

      const destination = generateInfiniteChunk(seed, {
        ...coord,
        story: coord.story - 1,
      });
      expect(getInfiniteChunkCeilingOpenings(destination).some((opening) =>
        sameRect(opening, hole)
      )).toBe(true);
      expect(getFloorOpenings(destination).some((opening) => sameRect(opening, hole)))
        .toBe(kind === 'void');
      expect(wallsAround(
        destination.walls,
        hole,
        kind === 'void' ? '/inherited-shaft-' : '/ceiling-shaft-collar-',
      )).toHaveLength(4);
      const clearArrival: Rect = {
        minX: hole.minX + 0.16,
        maxX: hole.maxX - 0.16,
        minZ: hole.minZ + 0.16,
        maxZ: hole.maxZ - 0.16,
      };
      expect(destination.walls.some((wall) =>
        wall.bottom < destination.wallHeight - 0.1 &&
        overlaps(wallFootprint(wall), clearArrival)
      )).toBe(false);
      expect(destination.colliders.some((collider) =>
        collider.kind !== 'floor' &&
        collider.center.y > -0.5 &&
        overlaps(colliderFootprint(collider), clearArrival)
      )).toBe(false);

      if (kind === 'void') {
        const deeper = generateInfiniteChunk(seed, {
          ...coord,
          story: coord.story - 2,
        });
        expect(getFloorOpenings(deeper).some((opening) => sameRect(opening, hole)))
          .toBe(true);
      }
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
    )).toHaveLength(inherited.layout === 'straight' ? 1 : 2);
    expect(upper.colliders.filter((collider) =>
      collider.id.includes(`${inherited.id}-`) && collider.kind === 'step'
    )).toHaveLength(inherited.layout === 'straight' ? 2 : 4);
    expect(upper.colliders.filter((collider) =>
      collider.id.includes(`${inherited.id}-cage-wall-`) && collider.kind === 'wall'
    )).toHaveLength(
      inherited.layout === 'straight'
        ? 2
        : inherited.switchbackJoin === 'divider' ? 4 : 3,
    );

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
    let elevatedGalleryLightCount = 0;
    for (let index = 0; index < 36; index += 1) {
      const coord = {
        x: index % 6 - 3,
        z: Math.floor(index / 6) - 3,
        story: index % 3 - 1,
      };
      if (epicStructureIndexForCoord('HIGH-CEILING-INVARIANT-AUDIT', coord) !== null) continue;
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
        const shells = plan.walls.filter((wall) =>
          (wall.detail === 'upper-shell' || wall.detail === 'upper-portal-lintel') &&
          wall.kind === 'wallpaper' &&
          wall.bottom <= plan.wallHeight + 0.02 &&
          wall.bottom + wall.height >= room.ceilingHeight - 0.03
        );
        for (const side of [
          { orientation: 'x' as const, fixed: room.bounds.minZ, min: room.bounds.minX, max: room.bounds.maxX },
          { orientation: 'x' as const, fixed: room.bounds.maxZ, min: room.bounds.minX, max: room.bounds.maxX },
          { orientation: 'z' as const, fixed: room.bounds.minX, min: room.bounds.minZ, max: room.bounds.maxZ },
          { orientation: 'z' as const, fixed: room.bounds.maxX, min: room.bounds.minZ, max: room.bounds.maxZ },
        ]) {
          const intervals = shells
            .filter((wall) =>
              wall.orientation === side.orientation &&
              Math.abs((wall.orientation === 'x' ? wall.z : wall.x) - side.fixed) < 0.06
            )
            .map((wall) => {
              const along = wall.orientation === 'x' ? wall.x : wall.z;
              return {
                min: Math.max(side.min, along - wall.length * 0.5),
                max: Math.min(side.max, along + wall.length * 0.5),
              };
            })
            .filter((interval) => interval.max > interval.min)
            .sort((left, right) => left.min - right.min);
          let coveredUntil = side.min;
          for (const interval of intervals) {
            expect(
              interval.min,
              `upper shell gap in ${createChunkKey(coord)} room ${room.id}`,
            ).toBeLessThanOrEqual(coveredUntil + 0.03);
            coveredUntil = Math.max(coveredUntil, interval.max);
          }
          expect(
            coveredUntil,
            `incomplete upper shell in ${createChunkKey(coord)} room ${room.id}`,
          ).toBeGreaterThanOrEqual(side.max - 0.03);
        }
        for (const light of plan.lights.filter((candidate) =>
          candidate.roomId === room.id && candidate.id.includes('symmetric-gallery-light-')
        )) {
          elevatedGalleryLightCount += 1;
          expect(light.ceilingY).toBe(room.ceilingHeight);
        }
      }
      for (const feature of plan.features.filter((candidate) => candidate.kind === 'raised-zone')) {
        expect(openings.some((opening) => overlaps(feature.bounds, opening))).toBe(false);
      }
    }
    expect(tallRoomCount).toBeGreaterThan(0);
    expect(elevatedGalleryLightCount).toBeGreaterThan(0);
  });

  it('preserves signed elevation districts without restoring the zero-height floor beneath them', () => {
    let districtCount = 0;
    let sunkenCount = 0;
    for (let index = 0; index < 36; index += 1) {
      const plan = generateInfiniteChunk('ELEVATION-DISTRICT-INVARIANT-AUDIT', {
        x: (index % 6 - 3) * 3,
        z: (Math.floor(index / 6) - 3) * 3,
        story: index % 3 - 1,
      });
      for (const feature of plan.features.filter(
        (candidate) => candidate.kind === 'raised-zone',
      )) {
        districtCount += 1;
        if (feature.elevation < 0) sunkenCount += 1;
        expect((feature.roomIds ?? [feature.roomId]).length).toBeGreaterThanOrEqual(2);
        for (const [platformIndex, platform] of (
          feature.platformRects ?? [feature.platformBounds]
        ).entries()) {
          const center = {
            x: (platform.minX + platform.maxX) * 0.5,
            z: (platform.minZ + platform.maxZ) * 0.5,
          };
          expect(plan.floorRects.some((floor) => containsPoint(floor, center))).toBe(false);
          expect(plan.colliders.some((collider) =>
            collider.id === `${feature.id}-platform-${platformIndex}` &&
            Math.abs(
              collider.center.y + collider.halfExtents.y - feature.elevation,
            ) < 0.02
          )).toBe(true);
        }
        for (const [rampIndex] of (feature.ramps ?? [feature.ramp]).entries()) {
          expect(plan.colliders.some((collider) =>
            collider.id === `${feature.id}-ramp-${rampIndex}` &&
            collider.rotation !== undefined
          )).toBe(true);
        }
        if (feature.elevation < 0) {
          expect(plan.walls.some((wall) =>
            wall.detail === 'lower-shell' &&
            wall.roomId === feature.roomId &&
            wall.bottom <= feature.elevation + 0.02
          )).toBe(true);
        }
      }
      for (const wall of plan.walls.filter((candidate) =>
        candidate.detail === 'upper-shell' || candidate.detail === 'upper-portal-lintel'
      )) {
        expect(wall.bottom).toBeGreaterThanOrEqual(plan.wallHeight);
        const fixed = wall.orientation === 'x' ? wall.z : wall.x;
        const along = wall.orientation === 'x' ? wall.x : wall.z;
        const wallMin = along - wall.length * 0.5;
        const wallMax = along + wall.length * 0.5;
        expect(plan.rooms.some((room) => {
          if (
            room.ceilingHeight <= plan.wallHeight + 0.1 ||
            wall.bottom + wall.height < room.ceilingHeight - 0.03
          ) return false;
          const sides = wall.orientation === 'x'
            ? [room.bounds.minZ, room.bounds.maxZ]
            : [room.bounds.minX, room.bounds.maxX];
          const roomMin = wall.orientation === 'x' ? room.bounds.minX : room.bounds.minZ;
          const roomMax = wall.orientation === 'x' ? room.bounds.maxX : room.bounds.maxZ;
          return sides.some((side) => Math.abs(side - fixed) < 0.12) &&
            Math.min(wallMax, roomMax) - Math.max(wallMin, roomMin) > 0.02;
        })).toBe(true);
      }
    }
    expect(districtCount).toBeGreaterThan(15);
    expect(sunkenCount).toBeGreaterThan(3);
  });

  it('coalesces inherited shafts so active openings never overlap or explode in count', () => {
    let inheritedCount = 0;
    for (let index = 0; index < 36; index += 1) {
      const inherited = inheritedShaftOpeningsForChunk('SHAFT-COALESCE-AUDIT', {
        x: (index % 6 - 3) * 3,
        z: (Math.floor(index / 6) - 3) * 3,
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
        x: (index % 9 - 4) * 3,
        z: (Math.floor(index / 9) % 9 - 4) * 3,
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
      const enclosureClaims = inheritedShaftEnclosures(plan);
      const allActiveOpenings = inheritedShaftOpeningsForChunk(shaftSeed, coord);
      expect(enclosureClaims.length).toBeGreaterThan(0);
      for (const opening of allActiveOpenings) {
        const enclosure = enclosureClaims.find(({ bounds }) =>
          bounds.minX <= opening.minX - 0.34 &&
          bounds.maxX >= opening.maxX + 0.34 &&
          bounds.minZ <= opening.minZ - 0.34 &&
          bounds.maxZ >= opening.maxZ + 0.34
        );
        expect(enclosure).toBeDefined();
        if (!enclosure) continue;
        expect(enclosure.walls).toHaveLength(4);
        expect(enclosure.walls.every((wall) =>
          wall.kind === 'wallpaper' &&
          wall.collision &&
          Math.abs(wall.bottom) < 0.01 &&
          Math.abs(wall.height - plan.wallHeight) < 0.01
        )).toBe(true);
        const hostRoom = plan.rooms.find((room) => room.id === enclosure.walls[0]!.roomId);
        expect(hostRoom).toBeDefined();
        if (hostRoom) {
          expect(
            Math.min(
              Math.abs(enclosure.bounds.minX - hostRoom.bounds.minX),
              Math.abs(enclosure.bounds.maxX - hostRoom.bounds.maxX),
            ),
          ).toBeLessThan(0.4);
          expect(
            Math.min(
              Math.abs(enclosure.bounds.minZ - hostRoom.bounds.minZ),
              Math.abs(enclosure.bounds.maxZ - hostRoom.bounds.maxZ),
            ),
          ).toBeLessThan(0.4);
        }
        for (const wall of enclosure.walls) {
          const localId = wall.id.slice(wall.id.lastIndexOf('/') + 1);
          expect(plan.colliders.some((collider) =>
            collider.id.endsWith(`/collider-${localId}`)
          )).toBe(true);
        }
      }
      for (const wall of shells) {
        const expectedLength = wall.orientation === 'x'
          ? canonicalOpening.maxX - canonicalOpening.minX + wall.thickness * 2
          : canonicalOpening.maxZ - canonicalOpening.minZ + wall.thickness * 2;
        expect(wall.length).toBeCloseTo(expectedLength, 5);
        if (wall.id.endsWith('-north')) expect(wall.z).toBeCloseTo(canonicalOpening.minZ, 5);
        if (wall.id.endsWith('-south')) expect(wall.z).toBeCloseTo(canonicalOpening.maxZ, 5);
        if (wall.id.endsWith('-west')) expect(wall.x).toBeCloseTo(canonicalOpening.minX, 5);
        if (wall.id.endsWith('-east')) expect(wall.x).toBeCloseTo(canonicalOpening.maxX, 5);
      }
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
    for (const wall of collars) {
      const expectedLength = wall.orientation === 'x'
        ? terminalCeilingOpening.maxX - terminalCeilingOpening.minX + wall.thickness * 2
        : terminalCeilingOpening.maxZ - terminalCeilingOpening.minZ + wall.thickness * 2;
      expect(wall.length).toBeCloseTo(expectedLength, 5);
    }
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

  it('double-lines visual-biome borders while keeping the same passages open', () => {
    const biomeSeed = 'BIOME-DOUBLE-WALL-AUDIT';
    let sourceCoord: ChunkCoord | undefined;
    search:
    for (let z = -12; z <= 12; z += 1) {
      for (let x = -12; x <= 12; x += 1) {
        const candidate = { x, z, story: 0 };
        const neighbor = parseChunkKey(getNeighborChunkKey(candidate, 'east'));
        if (
          getInfiniteVisualBiome(biomeSeed, candidate) !==
          getInfiniteVisualBiome(biomeSeed, neighbor)
        ) {
          sourceCoord = candidate;
          break search;
        }
      }
    }
    expect(sourceCoord).toBeDefined();
    if (!sourceCoord) return;

    const neighborCoord = parseChunkKey(getNeighborChunkKey(sourceCoord, 'east'));
    const source = generateInfiniteChunk(biomeSeed, sourceCoord);
    const neighbor = generateInfiniteChunk(biomeSeed, neighborCoord);
    expect(source.visualBiome).not.toBe(neighbor.visualBiome);

    const sourceFaces = source.walls.filter((wall) =>
      wall.id.includes('/biome-transition-east-face-')
    );
    const neighborFaces = neighbor.walls.filter((wall) =>
      wall.id.includes('/biome-transition-west-face-')
    );
    const sourceReturns = source.walls.filter((wall) =>
      wall.id.includes('/biome-transition-east-gate-') &&
      wall.id.includes('-return-')
    );
    const neighborReturns = neighbor.walls.filter((wall) =>
      wall.id.includes('/biome-transition-west-gate-') &&
      wall.id.includes('-return-')
    );
    const neighborBands = neighbor.walls.filter((wall) =>
      wall.id.includes('/biome-transition-west-gate-') &&
      wall.id.includes('-band-')
    );
    const gates = getInfiniteChunkMetadata(source)!.edgeGates.east;

    expect(sourceFaces).toHaveLength(gates.length + 1);
    expect(neighborFaces).toHaveLength(gates.length + 1);
    expect(sourceReturns).toHaveLength(gates.length * 2);
    expect(neighborReturns).toHaveLength(gates.length * 2);
    expect(neighborBands).toHaveLength(gates.length * 2);
    expect([...sourceFaces, ...neighborFaces, ...sourceReturns, ...neighborReturns]
      .every((wall) =>
        wall.detail === 'biome-boundary-skin' &&
        wall.collision === false &&
        wall.bottom === 0
      )).toBe(true);
    expect(neighborBands.every((wall) =>
      wall.detail === 'biome-boundary-band' &&
      wall.collision === false &&
      Math.abs(wall.length - 0.18) < 1e-6
    )).toBe(true);

    const sourceOffset = getChunkWorldOffset(sourceCoord);
    const neighborOffset = getChunkWorldOffset(neighborCoord);
    const sourceFaceWorldX = sourceOffset.x + sourceFaces[0]!.x;
    const neighborFaceWorldX = neighborOffset.x + neighborFaces[0]!.x;
    expect(sourceFaceWorldX).toBeLessThan(neighborFaceWorldX);
    expect(neighborFaceWorldX - sourceFaceWorldX).toBeGreaterThan(0.25);
    const sharedBoundaryX = sourceOffset.x + INFINITE_CHUNK_SIZE * 0.5;
    for (const gate of gates) {
      for (const along of [
        gate.offset - gate.width * 0.5,
        gate.offset + gate.width * 0.5,
      ]) {
        const sourceReturn = sourceReturns.find((wall) => Math.abs(wall.z - along) < 0.02);
        const neighborReturn = neighborReturns.find((wall) => Math.abs(wall.z - along) < 0.02);
        const band = neighborBands.find((wall) => Math.abs(wall.z - along) < 0.02);
        expect(sourceReturn).toBeDefined();
        expect(neighborReturn).toBeDefined();
        expect(band).toBeDefined();
        if (!sourceReturn || !neighborReturn || !band) continue;
        const sourceReturnMax =
          sourceOffset.x + sourceReturn.x + sourceReturn.length * 0.5;
        const neighborReturnMin =
          neighborOffset.x + neighborReturn.x - neighborReturn.length * 0.5;
        const bandMin = neighborOffset.x + band.x - band.length * 0.5;
        const bandMax = neighborOffset.x + band.x + band.length * 0.5;
        expect(sourceReturnMax).toBeCloseTo(bandMin, 6);
        expect(neighborReturnMin).toBeCloseTo(bandMax, 6);
        expect((bandMin + bandMax) * 0.5).toBeCloseTo(sharedBoundaryX, 6);
      }
    }

    const coreWalls = neighbor.walls.filter((wall) =>
      wall.id.includes('/infinite-boundary-west-upper-')
    );
    expect(coreWalls.length).toBeGreaterThan(0);
    for (const gate of gates) {
      const coversGateCenter = (wall: (typeof sourceFaces)[number]): boolean => {
        const along = wall.orientation === 'x' ? wall.x : wall.z;
        return Math.abs(along - gate.offset) < wall.length * 0.5 - 1e-4;
      };
      expect(sourceFaces.some(coversGateCenter)).toBe(false);
      expect(neighborFaces.some(coversGateCenter)).toBe(false);
      expect(coreWalls.some(coversGateCenter)).toBe(false);
    }
  });

  it('builds chunk seams as deep structural volumes with matching collision depth', () => {
    const plans = Array.from({ length: 36 }, (_, index) =>
      generateInfiniteChunk('BOUNDARY-THICKNESS-AUDIT', {
        x: index - 18,
        z: (index % 7) - 3,
        story: index % 3,
      })
    );
    const boundaryWalls = plans.flatMap((plan) =>
      plan.walls.filter((wall) =>
        wall.id.includes('/infinite-boundary-') &&
        wall.bottom === 0
      ).map((wall) => ({ plan, wall }))
    );
    const ordered = boundaryWalls
      .map(({ wall }) => wall.thickness)
      .sort((left, right) => left - right);
    const median = ordered[Math.floor(ordered.length * 0.5)]!;
    expect(median).toBeGreaterThanOrEqual(1.1);
    expect(boundaryWalls.some(({ wall }) => wall.thickness <= 0.42)).toBe(true);
    expect(boundaryWalls.some(({ wall }) => wall.thickness >= 2.4)).toBe(true);
    expect(boundaryWalls.every(({ plan, wall }) => {
      const separator = wall.id.indexOf('/');
      const colliderId = separator >= 0
        ? `${wall.id.slice(0, separator + 1)}collider-${wall.id.slice(separator + 1)}`
        : `collider-${wall.id}`;
      const collider = plan.colliders.find(
        (candidate) => candidate.id === colliderId,
      );
      if (!collider) return false;
      const collisionDepth = wall.orientation === 'x'
        ? collider.halfExtents.z * 2
        : collider.halfExtents.x * 2;
      return Math.abs(collisionDepth - wall.thickness) < 1e-6;
    })).toBe(true);
    expect(plans.every((plan) => plan.walls.every((wall) => wall.kind !== 'plaster'))).toBe(true);
  });
});
