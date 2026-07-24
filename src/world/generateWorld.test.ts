import { describe, expect, it } from 'vitest';
import {
  PIT_PRESENCE_RATE,
  UNLIT_ZONE_PRESENCE_RATE,
  fingerprintWorld,
  generateWorld,
  lightPanelOverlapsRect,
  validateWorldPlan,
  worldHasPit,
} from './generateWorld';
import { pointInRect, rectDepth, rectWidth } from './types';
import type {
  GridPitFeature,
  LightSlot,
  StairSocketFeature,
  StaticCollider,
  WallSegment,
  WorldPlan,
} from './types';
import { getStairSlabs, STAIR_STORY_RISE } from './StairLayout';

const seeds = Array.from({ length: 32 }, (_, index) => `AUTOTEST-${index.toString().padStart(3, '0')}`);
const hazardSeeds = Array.from(
  { length: 160 },
  (_, index) => `HAZARD-AUDIT-${index.toString().padStart(3, '0')}`,
);
const pitAuditSeeds: string[] = [];
for (let index = 0; pitAuditSeeds.length < 160; index += 1) {
  const seed = `PIT-AUDIT-${index.toString().padStart(5, '0')}`;
  if (worldHasPit(seed)) pitAuditSeeds.push(seed);
}
const hazardWorldCache = new Map<string, WorldPlan>();
const hazardWorld = (seed: string): WorldPlan => {
  const cached = hazardWorldCache.get(seed);
  if (cached) return cached;
  const world = generateWorld(seed);
  hazardWorldCache.set(seed, world);
  return world;
};

const gridPits = (world: WorldPlan): GridPitFeature[] =>
  world.features.filter((feature): feature is GridPitFeature => feature.kind === 'grid-pit');

const colliderCovers = (collider: StaticCollider, x: number, z: number): boolean =>
  collider.kind === 'floor' &&
  Math.abs(x - collider.center.x) <= collider.halfExtents.x + 1e-6 &&
  Math.abs(z - collider.center.z) <= collider.halfExtents.z + 1e-6;

const lowerFloorCovers = (
  world: WorldPlan,
  pit: GridPitFeature,
  x: number,
  z: number,
): boolean => world.colliders.some(
  (collider) =>
    colliderCovers(collider, x, z) &&
    Math.abs(collider.center.y + collider.halfExtents.y - pit.lowerFloorY) < 1e-6,
);

const hasVoid = (world: WorldPlan): boolean =>
  gridPits(world).some((pit) => pit.holes.some((hole) => hole.kind === 'void'));

const lightFootprint = (light: LightSlot): { halfX: number; halfZ: number } => {
  const longHalf = light.width * 0.5 + 0.32;
  const shortHalf = (light.width > 1.65 ? 0.58 : 0.46) + 0.32;
  const alongX = Math.abs(Math.cos(light.rotation)) >= Math.abs(Math.sin(light.rotation));
  return alongX
    ? { halfX: longHalf, halfZ: shortHalf }
    : { halfX: shortHalf, halfZ: longHalf };
};

const lightOverlapsWall = (light: LightSlot, wall: WallSegment): boolean => {
  if ((wall.bottom < -1) !== (light.level < 0)) return false;
  const footprint = lightFootprint(light);
  const halfX = wall.orientation === 'x' ? wall.length * 0.5 : wall.thickness * 0.5;
  const halfZ = wall.orientation === 'z' ? wall.length * 0.5 : wall.thickness * 0.5;
  return (
    Math.abs(light.x - wall.x) <= halfX + footprint.halfX &&
    Math.abs(light.z - wall.z) <= halfZ + footprint.halfZ
  );
};

const boundaryOpeningWidths = (
  world: WorldPlan,
  room: WorldPlan['rooms'][number],
  side: 'north' | 'south' | 'west' | 'east',
): number[] => {
  const horizontal = side === 'north' || side === 'south';
  const fixed = side === 'north'
    ? room.bounds.minZ
    : side === 'south'
      ? room.bounds.maxZ
      : side === 'west'
        ? room.bounds.minX
        : room.bounds.maxX;
  const spanMin = horizontal ? room.bounds.minX : room.bounds.minZ;
  const spanMax = horizontal ? room.bounds.maxX : room.bounds.maxZ;
  const intervals = world.walls
    .filter((wall) => {
      if (wall.bottom > 0.1 || wall.orientation !== (horizontal ? 'x' : 'z')) return false;
      const wallFixed = horizontal ? wall.z : wall.x;
      return Math.abs(wallFixed - fixed) < 0.04;
    })
    .map((wall) => {
      const center = horizontal ? wall.x : wall.z;
      return {
        min: Math.max(spanMin, center - wall.length * 0.5),
        max: Math.min(spanMax, center + wall.length * 0.5),
      };
    })
    .filter((interval) => interval.max - interval.min > 0.01)
    .sort((left, right) => left.min - right.min);
  const merged: Array<{ min: number; max: number }> = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (previous && interval.min <= previous.max + 0.03) {
      previous.max = Math.max(previous.max, interval.max);
    } else {
      merged.push({ ...interval });
    }
  }
  const openings: number[] = [];
  let cursor = spanMin;
  for (const interval of merged) {
    if (interval.min - cursor > 0.65) openings.push(interval.min - cursor);
    cursor = Math.max(cursor, interval.max);
  }
  if (spanMax - cursor > 0.65) openings.push(spanMax - cursor);
  return openings;
};

const reachableRoomIds = (seed: string): Set<string> => {
  const world = generateWorld(seed);
  // Dense pit bridges can be only 0.70 m wide. Sampling at 0.25 m keeps the
  // capsule-clearance audit from aliasing a valid narrow bridge out of existence.
  const step = 0.25;
  const half = world.size * 0.5;
  const count = Math.floor(world.size / step);
  const toIndex = (x: number, z: number): number => z * count + x;
  const blocked = (x: number, z: number): boolean =>
    world.features.some(
      (feature) =>
        feature.kind === 'grid-pit' &&
        feature.holes.some((hole) => pointInRect(x, z, hole, -0.29)),
    ) ||
    world.colliders.some((collider) => {
      if (collider.kind === 'floor' || collider.kind === 'step') return false;
      if (collider.center.y < 0 || collider.center.y - collider.halfExtents.y > 1.8) return false;
      return (
        Math.abs(x - collider.center.x) < collider.halfExtents.x + 0.29 &&
        Math.abs(z - collider.center.z) < collider.halfExtents.z + 0.29
      );
    });
  const coordinate = (index: number): number => -half + (index + 0.5) * step;
  const spawnX = Math.max(0, Math.min(count - 1, Math.floor((world.spawn.x + half) / step)));
  const spawnZ = Math.max(0, Math.min(count - 1, Math.floor((world.spawn.z + half) / step)));
  const queue: Array<[number, number]> = [[spawnX, spawnZ]];
  const visited = new Uint8Array(count * count);
  visited[toIndex(spawnX, spawnZ)] = 1;
  const reached = new Set<string>();

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const [gridX, gridZ] = queue[cursor]!;
    for (const [offsetX, offsetZ] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nextX = gridX + offsetX;
      const nextZ = gridZ + offsetZ;
      if (nextX < 0 || nextZ < 0 || nextX >= count || nextZ >= count) continue;
      const index = toIndex(nextX, nextZ);
      if (visited[index] || blocked(coordinate(nextX), coordinate(nextZ))) continue;
      visited[index] = 1;
      queue.push([nextX, nextZ]);
    }
  }

  // Rooms partition almost all of the plan, so scanning each room once is far
  // cheaper than testing every reached cell against every room during the BFS.
  for (const room of world.rooms) {
    const minX = Math.max(0, Math.ceil((room.bounds.minX + 0.35 + half) / step - 0.5));
    const maxX = Math.min(count - 1, Math.floor((room.bounds.maxX - 0.35 + half) / step - 0.5));
    const minZ = Math.max(0, Math.ceil((room.bounds.minZ + 0.35 + half) / step - 0.5));
    const maxZ = Math.min(count - 1, Math.floor((room.bounds.maxZ - 0.35 + half) / step - 0.5));
    roomScan:
    for (let gridZ = minZ; gridZ <= maxZ; gridZ += 1) {
      for (let gridX = minX; gridX <= maxX; gridX += 1) {
        if (!visited[toIndex(gridX, gridZ)]) continue;
        reached.add(room.id);
        break roomScan;
      }
    }
  }
  return reached;
};

describe('Level 0 procedural generator', () => {
  it.each(seeds)('is deterministic for %s', (seed) => {
    const first = generateWorld(seed);
    const second = generateWorld(seed);
    expect(fingerprintWorld(first)).toBe(fingerprintWorld(second));
    expect(first).toEqual(second);
  });

  it('varies wall, floor and ceiling treatments deterministically between chunks', () => {
    const styles = seeds.map((seed) => generateWorld(seed).surfaceStyle);
    expect(styles.every(Boolean)).toBe(true);
    expect(new Set(styles.map((style) => JSON.stringify(style))).size).toBeGreaterThanOrEqual(28);
    for (const style of styles) {
      expect(style!.wallTint).toBeGreaterThanOrEqual(0.9);
      expect(style!.wallTint).toBeLessThanOrEqual(1.08);
      expect(style!.floorTint).toBeGreaterThanOrEqual(0.82);
      expect(style!.floorTint).toBeLessThanOrEqual(1.1);
      expect(style!.ceilingTint).toBeGreaterThanOrEqual(0.93);
      expect(style!.ceilingTint).toBeLessThanOrEqual(1.06);
      expect(style!.wallPatternScale).toBeGreaterThanOrEqual(0.68);
      expect(style!.wallPatternScale).toBeLessThanOrEqual(1.48);
      expect(style!.floorPatternScale).toBeGreaterThanOrEqual(0.62);
      expect(style!.floorPatternScale).toBeLessThanOrEqual(1.72);
      expect(style!.ceilingPatternScale).toBeGreaterThanOrEqual(0.78);
      expect(style!.ceilingPatternScale).toBeLessThanOrEqual(1.32);
    }
    expect(new Set(styles.map((style) => style!.floorQuarterTurn))).toEqual(new Set([true, false]));
  });

  it.each(seeds)('produces a valid and connected plan for %s', (seed) => {
    const world = generateWorld(seed);
    expect(validateWorldPlan(world)).toEqual([]);
    expect(reachableRoomIds(seed).size).toBe(world.rooms.length);
    expect(world.rooms.length).toBeGreaterThanOrEqual(24);
    const narrowRooms = world.rooms.filter(
      (room) => Math.min(rectWidth(room.bounds), rectDepth(room.bounds)) <= 8.25,
    );
    expect(narrowRooms.length / world.rooms.length).toBeGreaterThanOrEqual(0.2);
    expect(world.rooms.filter((room) => room.kind === 'corridor').length / world.rooms.length)
      .toBeGreaterThanOrEqual(0.3);
    const openHalls = world.rooms.filter((room) => room.kind === 'open-hall');
    expect(openHalls.length).toBeLessThanOrEqual(Math.max(5, Math.ceil(world.rooms.length * 0.1)));
    expect(openHalls.some((room) => rectWidth(room.bounds) * rectDepth(room.bounds) >= 450)).toBe(true);
    expect(world.walls.some((wall) => wall.thickness >= 0.7)).toBe(true);
    expect(world.solidMasses.length).toBeGreaterThanOrEqual(1);
    expect(world.missingCeilingTiles).toHaveLength(0);
    const roomLighting = world.rooms.map((room) => ({
      room,
      lights: world.lights.filter((light) => light.level >= 0 && light.roomId === room.id),
    }));
    const blackouts = roomLighting.filter(
      ({ lights }) => lights.length > 0 && lights.every((light) => light.dead),
    );
    const partialFailures = roomLighting.filter(
      ({ lights }) => lights.some((light) => light.dead) && lights.some((light) => !light.dead),
    );
    if ((world.unlitZones?.length ?? 0) === 0) {
      expect(blackouts).toHaveLength(0);
      expect(partialFailures).toHaveLength(0);
    } else {
      expect(blackouts.length + partialFailures.length).toBeGreaterThan(0);
      for (const light of world.lights.filter((candidate) => candidate.level >= 0)) {
        const insideUnlitZone = world.unlitZones!.some((zone) =>
          pointInRect(light.x, light.z, zone)
        );
        if (insideUnlitZone) expect(light.dead).toBe(true);
      }
    }
    expect(world.lights.every((light) => !light.unstable)).toBe(true);
    const spawnLighting = roomLighting.find(({ room }) =>
      pointInRect(world.spawn.x, world.spawn.z, room.bounds),
    );
    expect(spawnLighting?.lights.some((light) => !light.dead)).toBe(true);
    expect(world.features.some((feature) => feature.kind === 'impossible-vista')).toBe(true);
  });

  it.each(seeds)('keeps spawn on solid floor and genuinely carves pit holes for %s', (seed) => {
    const world = generateWorld(seed);
    expect(world.floorRects.some((rect) => pointInRect(world.spawn.x, world.spawn.z, rect))).toBe(true);
    const pits = world.features.filter((feature) => feature.kind === 'grid-pit');
    for (const pit of pits) {
      expect(world.colliders.some((collider) => collider.id.startsWith('lower-level-floor-'))).toBe(true);
      expect(world.lights.some((light) => light.level === -1)).toBe(true);
      for (const hole of pit.holes) {
        const x = (hole.minX + hole.maxX) * 0.5;
        const z = (hole.minZ + hole.maxZ) * 0.5;
        expect(world.floorRects.some((rect) => pointInRect(x, z, rect))).toBe(false);
      }
    }
    const vista = world.features.find((feature) => feature.kind === 'impossible-vista');
    expect(vista).toBeDefined();
    if (vista?.kind === 'impossible-vista') {
      expect(pointInRect(vista.destination.x, vista.destination.z, vista.bounds)).toBe(true);
      expect(world.colliders.some((collider) => collider.id === 'vista-floor')).toBe(true);
      expect(world.colliders.some((collider) => collider.id === 'vista-end-wall')).toBe(true);
    }
  });

  it('changes the world fingerprint when the seed changes', () => {
    const fingerprints = new Set(seeds.map((seed) => fingerprintWorld(generateWorld(seed))));
    expect(fingerprints.size).toBe(seeds.length);
  });

  it('keeps pitfalls exceptional instead of placing one in almost every chunk', () => {
    const presenceSample = Array.from(
      { length: 2_000 },
      (_, index) => worldHasPit(`PIT-PRESENCE-${index.toString().padStart(5, '0')}`),
    );
    const rate = presenceSample.filter(Boolean).length / presenceSample.length;
    expect(Math.abs(rate - PIT_PRESENCE_RATE)).toBeLessThan(0.025);

    const generatedRate = hazardSeeds.filter(
      (seed) => gridPits(hazardWorld(seed)).length > 0,
    ).length / hazardSeeds.length;
    expect(generatedRate).toBeGreaterThan(0.06);
    expect(generatedRate).toBeLessThan(0.2);
  });

  it('uses mostly bright chunks and rare contiguous unlit districts', () => {
    const worlds = hazardSeeds.map(hazardWorld);
    const unlitWorlds = worlds.filter((world) => (world.unlitZones?.length ?? 0) > 0);
    expect(unlitWorlds.length).toBeGreaterThan(0);
    expect(unlitWorlds.length / worlds.length)
      .toBeLessThan(UNLIT_ZONE_PRESENCE_RATE + 0.06);
    expect(unlitWorlds.some((world) => (world.unlitZones?.length ?? 0) >= 2)).toBe(true);

    for (const world of worlds) {
      const zones = world.unlitZones ?? [];
      for (const light of world.lights.filter((candidate) => candidate.level >= 0)) {
        const insideUnlitZone = zones.some((zone) => pointInRect(light.x, light.z, zone));
        expect(light.dead).toBe(insideUnlitZone);
      }
    }
  });

  it('varies pit silhouettes across single holes, grids and mixed clusters', () => {
    const pits = pitAuditSeeds
      .map((seed) => hazardWorld(seed).features.find((feature) => feature.kind === 'grid-pit'))
      .filter((feature): feature is GridPitFeature => feature?.kind === 'grid-pit');
    expect(new Set(pits.map((pit) => pit.pattern))).toEqual(new Set([
      'single',
      'small-grid',
      'large-grid',
      'dense-grid',
      'mixed-grid',
      'large-cluster',
    ]));
    const singlePits = pits.filter((pit) => pit.pattern === 'single');
    expect(singlePits.length).toBeGreaterThan(0);
    expect(singlePits.length / pits.length).toBeLessThanOrEqual(0.06);
    expect(pits.filter((pit) => pit.pattern.includes('grid')).length).toBeGreaterThan(pits.length * 0.8);
    expect(pits.some((pit) => pit.holes.length >= 12)).toBe(true);
    expect(pits.some((pit) => pit.holes.some((hole) => Math.max(rectWidth(hole), rectDepth(hole)) >= 3.2)))
      .toBe(true);
    expect(pits.some((pit) => pit.holes.some((hole) => Math.max(rectWidth(hole), rectDepth(hole)) <= 1.7)))
      .toBe(true);
    for (const pit of pits) {
      expect(pit.lowerBounds.minX).toBeGreaterThanOrEqual(-56);
      expect(pit.lowerBounds.maxX).toBeLessThanOrEqual(56);
      expect(pit.lowerBounds.minZ).toBeGreaterThanOrEqual(-56);
      expect(pit.lowerBounds.maxZ).toBeLessThanOrEqual(56);
      expect(pit.lowerBounds.minX).toBeLessThanOrEqual(pit.bounds.minX);
      expect(pit.lowerBounds.maxX).toBeGreaterThanOrEqual(pit.bounds.maxX);
      expect(pit.lowerBounds.minZ).toBeLessThanOrEqual(pit.bounds.minZ);
      expect(pit.lowerBounds.maxZ).toBeGreaterThanOrEqual(pit.bounds.maxZ);
      for (let left = 0; left < pit.holes.length; left += 1) {
        for (let right = left + 1; right < pit.holes.length; right += 1) {
          const a = pit.holes[left]!;
          const b = pit.holes[right]!;
          const overlaps = a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
          expect(overlaps).toBe(false);
        }
      }
    }
  }, 15_000);

  it('mixes long corridors, radically different hall scales and architectural relief', () => {
    const worlds = hazardSeeds.map(hazardWorld);
    const corridorLengths = worlds.flatMap((world) => world.rooms
      .filter((room) => room.kind === 'corridor')
      .map((room) => Math.max(rectWidth(room.bounds), rectDepth(room.bounds))));
    const hallAreas = worlds.flatMap((world) => world.rooms
      .filter((room) => room.kind === 'open-hall')
      .map((room) => rectWidth(room.bounds) * rectDepth(room.bounds)));

    expect(corridorLengths.some((length) => length >= 40)).toBe(true);
    expect(worlds.filter((world) => world.rooms.some((room) =>
      room.kind === 'corridor' && Math.max(rectWidth(room.bounds), rectDepth(room.bounds)) >= 30
    )).length).toBeGreaterThan(worlds.length * 0.6);
    expect(Math.min(...hallAreas)).toBeLessThan(250);
    expect(Math.max(...hallAreas)).toBeGreaterThan(5_000);
    expect(Math.min(...worlds.map((world) => world.rooms.length))).toBeLessThan(40);
    expect(Math.max(...worlds.map((world) => world.rooms.length))).toBeGreaterThan(80);
    expect(worlds.some((world) => world.columns.some((column) => column.kind === 'pilaster'))).toBe(true);
    expect(worlds.some((world) => world.walls.some((wall) => wall.detail === 'recess'))).toBe(true);
  });

  it('keeps every grand hall traversable on four sides and varies its proportions radically', () => {
    const mainHalls = hazardSeeds.map((seed) => {
      const world = hazardWorld(seed);
      const hall = world.rooms.find((room) => room.id === 'room-grand-hall');
      expect(hall).toBeDefined();
      if (!hall) throw new Error('Missing room-grand-hall');
      for (const side of ['north', 'south', 'west', 'east'] as const) {
        expect(boundaryOpeningWidths(world, hall, side).length).toBeGreaterThan(0);
      }
      return hall;
    });
    const aspects = mainHalls.map((hall) => {
      const width = rectWidth(hall.bounds);
      const depth = rectDepth(hall.bounds);
      return Math.max(width / depth, depth / width);
    });
    const areas = mainHalls.map((hall) => rectWidth(hall.bounds) * rectDepth(hall.bounds));
    expect(Math.min(...aspects)).toBeLessThan(1.6);
    expect(Math.max(...aspects)).toBeGreaterThan(3);
    expect(Math.min(...areas)).toBeLessThan(1_000);
    expect(Math.max(...areas)).toBeGreaterThan(5_000);
  });

  it('varies ceiling height and fully encloses every raised room with textured walls', () => {
    const worlds = hazardSeeds.map(hazardWorld);
    const raisedRooms = worlds.flatMap((world) => world.rooms.filter(
      (room) => room.ceilingHeight > world.wallHeight + 0.1,
    ));

    expect(raisedRooms.length).toBeGreaterThan(200);
    expect(raisedRooms.some((room) => room.ceilingHeight >= 4.35)).toBe(true);
    expect(Math.max(...raisedRooms.map((room) => rectWidth(room.bounds) * rectDepth(room.bounds))))
      .toBeGreaterThan(1_500);
    expect(worlds.every((world) => world.walls.every((wall) => wall.detail !== 'ceiling-drop'))).toBe(true);
    for (const world of worlds) {
      const elevated = world.rooms.filter((room) => room.ceilingHeight > world.wallHeight + 0.1);
      const shells = world.walls.filter((wall) => wall.detail === 'upper-shell');
      expect(shells).toHaveLength(elevated.length * 4);
      expect(shells.every((wall) => wall.kind === 'wallpaper')).toBe(true);
      for (const room of elevated) {
        const roomShells = shells.filter((wall) => wall.roomId === room.id);
        expect(roomShells).toHaveLength(4);
        const centerX = (room.bounds.minX + room.bounds.maxX) * 0.5;
        const centerZ = (room.bounds.minZ + room.bounds.maxZ) * 0.5;
        const expected = [
          { x: centerX, z: room.bounds.minZ, length: rectWidth(room.bounds), orientation: 'x' },
          { x: centerX, z: room.bounds.maxZ, length: rectWidth(room.bounds), orientation: 'x' },
          { x: room.bounds.minX, z: centerZ, length: rectDepth(room.bounds), orientation: 'z' },
          { x: room.bounds.maxX, z: centerZ, length: rectDepth(room.bounds), orientation: 'z' },
        ] as const;
        for (const side of expected) {
          expect(roomShells.some((wall) =>
            wall.orientation === side.orientation &&
            Math.abs(wall.x - side.x) < 0.02 &&
            Math.abs(wall.z - side.z) < 0.02 &&
            Math.abs(wall.length - side.length) < 0.02 &&
            wall.bottom <= world.wallHeight &&
            world.wallHeight - wall.bottom <= 0.06 &&
            wall.bottom + wall.height >= room.ceilingHeight &&
            wall.bottom + wall.height - room.ceilingHeight <= 0.08
          )).toBe(true);
        }
      }
    }
  });

  it('keeps size families coherent and makes mixed grids exceptional', () => {
    const worlds = pitAuditSeeds.map(hazardWorld);
    const pits = worlds.flatMap(gridPits);
    const mixed = pits.filter((pit) => pit.pattern === 'mixed-grid');
    expect(mixed.length / pits.length).toBeLessThan(0.08);
    for (const pit of pits.filter((candidate) => candidate.pattern !== 'mixed-grid')) {
      const widths = pit.holes.map(rectWidth);
      const depths = pit.holes.map(rectDepth);
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(0.03);
      expect(Math.max(...depths) - Math.min(...depths)).toBeLessThanOrEqual(0.03);
    }
  });

  it('spans compact, vast and enormous pit rooms with mostly room-filling layouts', () => {
    const worlds = pitAuditSeeds.map(hazardWorld);
    const samples = worlds.flatMap((world) => gridPits(world).map((pit) => ({
      pit,
      room: world.rooms.find((room) => room.id === pit.roomId),
    }))).filter((sample) => sample.room !== undefined);
    const roomAreas = samples.map(({ room }) => rectWidth(room!.bounds) * rectDepth(room!.bounds));
    const roomFilling = samples.filter(({ pit, room }) =>
      rectWidth(pit.bounds) * rectDepth(pit.bounds) >=
      rectWidth(room!.bounds) * rectDepth(room!.bounds) * 0.5
    );
    expect(Math.max(...roomAreas)).toBeGreaterThan(5_000);
    expect(Math.max(...samples.map(({ pit }) => pit.holes.length))).toBeGreaterThan(100);
    expect(roomFilling.length / samples.length).toBeGreaterThan(0.7);
  });

  it('never places a floor collider below the center of a deep void', () => {
    let voidCount = 0;
    for (const seed of pitAuditSeeds) {
      const world = hazardWorld(seed);
      for (const pit of gridPits(world)) {
        for (const hole of pit.holes.filter((candidate) => candidate.kind === 'void')) {
          const x = (hole.minX + hole.maxX) * 0.5;
          const z = (hole.minZ + hole.maxZ) * 0.5;
          voidCount += 1;
          expect(world.colliders.some((collider) => colliderCovers(collider, x, z))).toBe(false);
        }
      }
    }
    expect(voidCount).toBeGreaterThan(0);
  });

  it('keeps the lower-story landing below every normal one-story drop', () => {
    let dropCount = 0;
    for (const seed of pitAuditSeeds) {
      const world = hazardWorld(seed);
      for (const pit of gridPits(world)) {
        for (const hole of pit.holes.filter(
          (candidate) => candidate.kind !== 'void' && (candidate.stories ?? 1) === 1,
        )) {
          const x = (hole.minX + hole.maxX) * 0.5;
          const z = (hole.minZ + hole.maxZ) * 0.5;
          dropCount += 1;
          expect(lowerFloorCovers(world, pit, x, z)).toBe(true);
        }
      }
    }
    expect(dropCount).toBeGreaterThan(0);
  });

  it('keeps multi-storey drops open and covers every depth from one to twelve stories', () => {
    const observedStories = new Set<number>();
    let shaftCount = 0;
    for (const seed of pitAuditSeeds) {
      const world = hazardWorld(seed);
      for (const pit of gridPits(world)) {
        for (const hole of pit.holes) {
          const stories = hole.stories ?? 1;
          observedStories.add(stories);
          if (stories <= 1) continue;
          shaftCount += 1;
          const x = (hole.minX + hole.maxX) * 0.5;
          const z = (hole.minZ + hole.maxZ) * 0.5;
          expect(lowerFloorCovers(world, pit, x, z)).toBe(false);
          expect(hole.depth).toBeCloseTo(stories * 5.4);
        }
      }
    }
    expect(shaftCount).toBeGreaterThan(0);
    expect([...observedStories].sort((left, right) => left - right))
      .toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    for (const world of pitAuditSeeds.map(hazardWorld)) {
      for (const pit of gridPits(world)) {
        expect(pit.holes.filter((hole) => (hole.stories ?? 1) > 4).length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps every lower-story light clear of every pit opening', () => {
    let lowerLightCount = 0;
    for (const seed of pitAuditSeeds) {
      const world = hazardWorld(seed);
      const holes = gridPits(world).flatMap((pit) => pit.holes);
      for (const light of world.lights.filter((candidate) => candidate.level === -1)) {
        lowerLightCount += 1;
        expect(holes.some((hole) => lightPanelOverlapsRect(light, hole))).toBe(false);
      }
    }
    expect(lowerLightCount).toBeGreaterThan(0);
  });

  it.each(seeds)('keeps ceiling light tiles out of walls, columns and holes for %s', (seed) => {
    const world = generateWorld(seed);
    const holes = gridPits(world).flatMap((pit) => pit.holes);
    for (const light of world.lights) {
      const footprint = lightFootprint(light);
      expect(world.walls.some((wall) => lightOverlapsWall(light, wall))).toBe(false);
      expect(holes.some((hole) => lightPanelOverlapsRect(light, hole))).toBe(false);
      if (light.level < 0) continue;
      expect(world.solidMasses.some(
        (mass) =>
          light.x >= mass.bounds.minX - footprint.halfX &&
          light.x <= mass.bounds.maxX + footprint.halfX &&
          light.z >= mass.bounds.minZ - footprint.halfZ &&
          light.z <= mass.bounds.maxZ + footprint.halfZ,
      )).toBe(false);
      expect(world.columns.some(
        (column) =>
          Math.abs(light.x - column.x) <= column.width * 0.5 + footprint.halfX &&
          Math.abs(light.z - column.z) <= column.depth * 0.5 + footprint.halfZ,
      )).toBe(false);
    }
  });

  it('generates deep voids deterministically but only rarely across a seed sample', () => {
    const firstPass = pitAuditSeeds.map((seed) => hasVoid(hazardWorld(seed)));
    const secondPass = pitAuditSeeds.map((seed) => hasVoid(generateWorld(seed)));
    const voidWorldCount = firstPass.filter(Boolean).length;

    expect(secondPass).toEqual(firstPass);
    expect(voidWorldCount).toBeGreaterThan(0);
    expect(voidWorldCount / pitAuditSeeds.length).toBeLessThan(0.15);
  });

  it('builds varied crouch-only wall passages with loops, dead ends, slopes and holes', () => {
    // PhysicsWorld uses a capsule radius of 0.32 m.
    const playerDiameter = 0.64;
    const samples = hazardSeeds.flatMap((seed) => {
      const world = hazardWorld(seed);
      return world.features
        .filter((feature) => feature.kind === 'squeeze-view')
        .map((feature) => ({ world, feature }));
    });
    const squeezes = samples.map(({ feature }) => feature);

    expect(squeezes.length).toBeGreaterThan(0);
    expect(squeezes.every((feature) => feature.apertureWidth > playerDiameter)).toBe(true);
    expect(squeezes.every((feature) =>
      (feature.clearanceHeight ?? 10) >= 1.36 &&
      (feature.clearanceHeight ?? 0) <= 1.49
    )).toBe(true);
    expect(samples.every(({ world, feature }) =>
      world.colliders.some((collider) => collider.id === `${feature.id}-low-ceiling`)
    )).toBe(true);
    expect(new Set(squeezes.map((feature) => feature.layout)))
      .toEqual(new Set([
        'through',
        'side-exits',
        'chambers',
        'dead-end',
        'loop',
        'multi-exit',
      ]));
    expect(squeezes.some((feature) =>
      feature.layout === 'dead-end' && (feature.exitCount ?? 0) === 0
    )).toBe(true);
    expect(squeezes.some((feature) => feature.hump !== undefined)).toBe(true);
    expect(squeezes.some((feature) => (feature.holes?.length ?? 0) > 0)).toBe(true);
    for (const { world, feature } of samples) {
      for (const hole of feature.holes ?? []) {
        expect(world.floorOpenings?.some((opening) =>
          opening.minX === hole.minX &&
          opening.maxX === hole.maxX &&
          opening.minZ === hole.minZ &&
          opening.maxZ === hole.maxZ
        )).toBe(true);
        expect(world.colliders.some((collider) =>
          collider.id === `${feature.id}-hole-bottom`
        )).toBe(true);
      }
    }
    expect(squeezes.some((feature) =>
      (feature.axis === 'x' ? rectWidth(feature.bounds) : rectDepth(feature.bounds)) >= 16,
    )).toBe(true);
  });

  it('creates zonal pilaster extremes with irregular non-square dimensions', () => {
    const worlds = hazardSeeds.map(hazardWorld);
    const counts = worlds.map(
      (world) => world.columns.filter((column) => column.kind === 'pilaster').length,
    );
    const pilasters = worlds.flatMap(
      (world) => world.columns.filter((column) => column.kind === 'pilaster'),
    );
    expect(counts.some((count) => count === 0)).toBe(true);
    expect(Math.max(...counts)).toBeGreaterThan(80);
    expect(pilasters.some((column) => Math.abs(column.width - column.depth) > 0.2)).toBe(true);
    expect(new Set(pilasters.map((column) => column.width.toFixed(2))).size).toBeGreaterThan(20);
  });

  it('adds raised districts with short, long, low and high physical ramps', () => {
    const worlds = hazardSeeds.map(hazardWorld);
    const samples = worlds.flatMap((world) =>
      world.features
        .filter((feature) => feature.kind === 'raised-zone')
        .map((feature) => ({ world, feature })),
    );
    expect(samples.length).toBeGreaterThan(15);
    expect(samples.every(({ world, feature }) =>
      world.rooms.some((room) => room.id === feature.roomId)
    )).toBe(true);
    const runs = samples.map(({ feature }) =>
      feature.ramp.axis === 'x'
        ? rectWidth(feature.ramp.bounds)
        : rectDepth(feature.ramp.bounds)
    );
    expect(Math.min(...runs)).toBeLessThan(3);
    expect(Math.max(...runs)).toBeGreaterThan(10);
    expect(samples.some(({ feature }) => feature.elevation <= 0.3)).toBe(true);
    expect(samples.some(({ feature }) => feature.elevation >= 0.8)).toBe(true);
    for (const { world, feature } of samples) {
      expect(world.colliders.find((collider) => collider.id === `raised-ramp-${feature.roomId}`)?.rotation)
        .toBeDefined();
    }
  });

  it('builds full two-flight staircases that reach the next 5.4m story', () => {
    const samples = hazardSeeds.flatMap((seed) => {
      const world = hazardWorld(seed);
      return world.features
        .filter((feature): feature is StairSocketFeature =>
          feature.kind === 'stair-socket' && feature.inherited !== true
        )
        .map((feature) => ({ world, feature }));
    });
    expect(samples.length).toBeGreaterThan(30);
    for (const { world, feature } of samples) {
      const slabs = getStairSlabs(feature);
      expect(slabs.filter((slab) => slab.kind === 'step')).toHaveLength(30);
      expect(Math.max(...slabs.map((slab) => slab.top))).toBeCloseTo(STAIR_STORY_RISE, 6);
      expect(world.colliders.filter((collider) =>
        collider.id.startsWith(`${feature.id}-flight-ramp-`)
      )).toHaveLength(2);
      expect(world.colliders.filter((collider) =>
        collider.id.startsWith(`${feature.id}-`) &&
        collider.kind === 'step'
      )).toHaveLength(4);
      expect(world.colliders.some((collider) =>
        collider.id === `${feature.id}-terminal-wall`
      )).toBe(false);
    }
  });

  it('does not generate structural plaster walls', () => {
    expect(hazardSeeds.map(hazardWorld).every(
      (world) => world.walls.every((wall) => wall.kind !== 'plaster'),
    )).toBe(true);
  });
});
