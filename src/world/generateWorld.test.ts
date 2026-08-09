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
import { pointInRect, rectCenter, rectDepth, rectWidth } from './types';
import type {
  GridPitFeature,
  LightSlot,
  StairSocketFeature,
  StaticCollider,
  WallSegment,
  WorldPlan,
} from './types';
import { getStairCageWalls, getStairSlabs, STAIR_STORY_RISE } from './StairLayout';

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

const boundaryOpenings = (
  world: WorldPlan,
  room: WorldPlan['rooms'][number],
  side: 'north' | 'south' | 'west' | 'east',
): Array<{ min: number; max: number }> => {
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
  const openings: Array<{ min: number; max: number }> = [];
  let cursor = spanMin;
  for (const interval of merged) {
    if (interval.min - cursor > 0.65) openings.push({ min: cursor, max: interval.min });
    cursor = Math.max(cursor, interval.max);
  }
  if (spanMax - cursor > 0.65) openings.push({ min: cursor, max: spanMax });
  return openings;
};

const boundaryOpeningWidths = (
  world: WorldPlan,
  room: WorldPlan['rooms'][number],
  side: 'north' | 'south' | 'west' | 'east',
): number[] => boundaryOpenings(world, room, side).map((opening) => opening.max - opening.min);

const reachableRoomIds = (seed: string): Set<string> => {
  const world = generateWorld(seed);
  const interactiveDoorColliders = new Set(
    world.features
      .filter((feature) => feature.kind === 'interactive-door')
      .map((feature) => feature.colliderId),
  );
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
      // Interactive doors are reachable topology that starts closed and can be
      // removed from collision by the player, rather than permanent walls.
      if (interactiveDoorColliders.has(collider.id)) return false;
      // Audit the navigation graph with the crouched capsule (1.08 m tall), so
      // a wallpaper lintel above a crawl opening does not count as a closed wall.
      if (collider.center.y < 0 || collider.center.y - collider.halfExtents.y > 1.12) return false;
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

  it.each(seeds)('keeps public rooms connected while sealing deliberate pockets for %s', (seed) => {
    const world = generateWorld(seed);
    expect(validateWorldPlan(world)).toEqual([]);
    const reached = reachableRoomIds(seed);
    const sealedRooms = world.rooms.filter((room) => room.access === 'sealed');
    const secretRooms = world.rooms.filter((room) => room.access === 'secret');
    expect(sealedRooms.length).toBeGreaterThanOrEqual(1);
    expect(sealedRooms.length + secretRooms.length).toBeGreaterThanOrEqual(2);
    expect(world.rooms.every(
      (room) => room.access === 'sealed' ? !reached.has(room.id) : reached.has(room.id),
    )).toBe(true);
    expect(world.lights.every((light) =>
      !sealedRooms.some((room) => room.id === light.roomId)
    )).toBe(true);
    expect(world.detailSockets.every((socket) =>
      !sealedRooms.some((room) => room.id === socket.roomId)
    )).toBe(true);
    expect(secretRooms.every((room) =>
      world.features.some(
        (feature) =>
          feature.kind === 'squeeze-view' &&
          feature.passageStyle === 'wall-breach' &&
          feature.roomId === room.id,
      )
    )).toBe(true);
    expect(world.rooms.length).toBeGreaterThanOrEqual(24);
    const narrowRooms = world.rooms.filter(
      (room) => Math.min(rectWidth(room.bounds), rectDepth(room.bounds)) <= 8.25,
    );
    expect(narrowRooms.length / world.rooms.length).toBeGreaterThanOrEqual(0.14);
    expect(world.rooms.filter((room) => room.kind === 'corridor').length / world.rooms.length)
      .toBeGreaterThanOrEqual(0.3);
    const openHalls = world.rooms.filter((room) => room.kind === 'open-hall');
    expect(openHalls.length).toBeLessThanOrEqual(Math.max(5, Math.ceil(world.rooms.length * 0.1)));
    expect(openHalls.some((room) => rectWidth(room.bounds) * rectDepth(room.bounds) >= 450)).toBe(true);
    expect(world.walls.some((wall) => wall.thickness >= 1.9)).toBe(true);
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
  }, 20_000);

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
  }, 30_000);

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

  it('keeps ordinary passages away from room corners in almost every layout', () => {
    const cornerDistances: number[] = [];
    for (const world of hazardSeeds.map(hazardWorld)) {
      for (const room of world.rooms) {
        for (const side of ['north', 'south', 'west', 'east'] as const) {
          const horizontal = side === 'north' || side === 'south';
          const spanMin = horizontal ? room.bounds.minX : room.bounds.minZ;
          const spanMax = horizontal ? room.bounds.maxX : room.bounds.maxZ;
          for (const opening of boundaryOpenings(world, room, side)) {
            const width = opening.max - opening.min;
            if (width < 2 || width > 6) continue;
            cornerDistances.push(Math.min(
              opening.min - spanMin,
              spanMax - opening.max,
            ));
          }
        }
      }
    }

    const cornerAdjacentCount = cornerDistances.filter((distance) => distance < 1.25).length;
    expect(cornerDistances.length).toBeGreaterThan(10_000);
    expect(cornerAdjacentCount).toBeGreaterThan(0);
    expect(cornerAdjacentCount / cornerDistances.length).toBeLessThan(0.12);
  });

  it('varies grand-hall connectivity instead of making every side a universal hub', () => {
    const mainHalls = hazardSeeds.map((seed) => {
      const world = hazardWorld(seed);
      const hall = world.rooms.find((room) => room.id === 'room-grand-hall');
      expect(hall).toBeDefined();
      if (!hall) throw new Error('Missing room-grand-hall');
      const openSides = (['north', 'south', 'west', 'east'] as const).filter(
        (side) => boundaryOpeningWidths(world, hall, side).length > 0,
      ).length;
      expect(openSides).toBeGreaterThanOrEqual(2);
      return { hall, openSides };
    });
    const aspects = mainHalls.map(({ hall }) => {
      const width = rectWidth(hall.bounds);
      const depth = rectDepth(hall.bounds);
      return Math.max(width / depth, depth / width);
    });
    const areas = mainHalls.map(({ hall }) => rectWidth(hall.bounds) * rectDepth(hall.bounds));
    expect(mainHalls.some(({ openSides }) => openSides < 4)).toBe(true);
    expect(mainHalls.some(({ openSides }) => openSides === 4)).toBe(true);
    expect(Math.min(...aspects)).toBeLessThan(1.6);
    expect(Math.max(...aspects)).toBeGreaterThan(3);
    expect(Math.min(...areas)).toBeLessThan(1_000);
    expect(Math.max(...areas)).toBeGreaterThan(5_000);
  });

  it('keeps formal halls exactly mirrored and closes every architectural corner', () => {
    const worlds = hazardSeeds.map(hazardWorld);
    let formalColumnCount = 0;
    for (const world of worlds) {
      const hall = world.rooms.find((room) => room.id === 'room-grand-hall');
      expect(hall).toBeDefined();
      if (!hall) continue;
      const center = {
        x: (hall.bounds.minX + hall.bounds.maxX) * 0.5,
        z: (hall.bounds.minZ + hall.bounds.maxZ) * 0.5,
      };
      const columns = world.columns.filter((column) =>
        pointInRect(column.x, column.z, hall.bounds, 0.6)
      );
      formalColumnCount += columns.length;
      for (const column of columns) {
        for (const mirror of [
          { x: center.x * 2 - column.x, z: column.z },
          { x: column.x, z: center.z * 2 - column.z },
        ]) {
          expect(columns.some((candidate) =>
            Math.abs(candidate.x - mirror.x) <= 0.06 &&
            Math.abs(candidate.z - mirror.z) <= 0.06 &&
            Math.abs(candidate.width - column.width) <= 1e-6 &&
            Math.abs(candidate.depth - column.depth) <= 1e-6
          )).toBe(true);
        }
      }
      for (const [orientation, fixed, points] of [
        ['x', hall.bounds.minZ, [hall.bounds.minX + 0.25, hall.bounds.maxX - 0.25]],
        ['x', hall.bounds.maxZ, [hall.bounds.minX + 0.25, hall.bounds.maxX - 0.25]],
        ['z', hall.bounds.minX, [hall.bounds.minZ + 0.25, hall.bounds.maxZ - 0.25]],
        ['z', hall.bounds.maxX, [hall.bounds.minZ + 0.25, hall.bounds.maxZ - 0.25]],
      ] as const) {
        for (const point of points) {
          const cornerX = orientation === 'x' ? point : fixed;
          const cornerZ = orientation === 'x' ? fixed : point;
          const coveredByWall = world.walls.some((wall) => {
            if (wall.orientation !== orientation) return false;
            const wallFixed = orientation === 'x' ? wall.z : wall.x;
            const along = orientation === 'x' ? wall.x : wall.z;
            return (
              Math.abs(wallFixed - fixed) < 0.06 &&
              point >= along - wall.length * 0.5 &&
              point <= along + wall.length * 0.5
            );
          });
          const coveredByPost = world.columns.some((column) =>
            Math.abs(cornerX - column.x) <= column.width * 0.5 &&
            Math.abs(cornerZ - column.z) <= column.depth * 0.5
          );
          expect(coveredByWall || coveredByPost).toBe(true);
        }
      }
    }
    expect(formalColumnCount).toBeGreaterThan(200);
  });

  it('builds connected multi-room ceiling districts from medium to colossal', () => {
    const worlds = hazardSeeds.map(hazardWorld);
    const raisedRooms = worlds.flatMap((world) => world.rooms.filter(
      (room) => room.ceilingHeight > world.wallHeight + 0.1,
    ));
    const zones = worlds.flatMap((world) => world.ceilingZones ?? []);
    const portalLintels = worlds.flatMap((world) =>
      world.walls.filter((wall) => wall.detail === 'upper-portal-lintel')
    );

    expect(raisedRooms.length).toBeGreaterThan(200);
    expect(raisedRooms.some((room) => room.ceilingHeight >= 12)).toBe(true);
    expect(Math.max(...raisedRooms.map((room) => rectWidth(room.bounds) * rectDepth(room.bounds))))
      .toBeGreaterThan(1_500);
    expect(zones.length).toBeGreaterThan(hazardSeeds.length);
    expect(zones.every((zone) => zone.roomIds.length >= 2)).toBe(true);
    expect(new Set(zones.map((zone) => zone.scale)))
      .toEqual(new Set(['medium', 'high', 'vast', 'colossal']));
    expect(portalLintels.length).toBeGreaterThan(200);
    expect(portalLintels.some((wall) => wall.thickness >= 1)).toBe(true);
    expect(portalLintels.every((wall) =>
      wall.kind === 'wallpaper' &&
      wall.bottom >= 2.74 &&
      wall.bottom < 2.76 &&
      wall.bottom + wall.height > 3.2
    )).toBe(true);
    expect(worlds.every((world) => world.walls.every((wall) => wall.detail !== 'ceiling-drop'))).toBe(true);
    for (const world of worlds) {
      const elevated = world.rooms.filter((room) => room.ceilingHeight > world.wallHeight + 0.1);
      const shells = world.walls.filter((wall) =>
        wall.detail === 'upper-shell' || wall.detail === 'upper-portal-lintel'
      );
      expect(shells.every((wall) => wall.kind === 'wallpaper')).toBe(true);
      for (const zone of world.ceilingZones ?? []) {
        const zoneRooms = zone.roomIds.map((roomId) =>
          world.rooms.find((room) => room.id === roomId)
        ).filter((room) => room !== undefined);
        expect(zoneRooms).toHaveLength(zone.roomIds.length);
        expect(zoneRooms.every((room) => room.ceilingHeight === zone.height)).toBe(true);
        const reached = new Set<string>(zoneRooms[0] ? [zoneRooms[0].id] : []);
        const queue = zoneRooms[0] ? [zoneRooms[0]] : [];
        for (let cursor = 0; cursor < queue.length; cursor += 1) {
          const room = queue[cursor]!;
          for (const candidate of zoneRooms) {
            if (reached.has(candidate.id)) continue;
            const sharedVertical =
              (
                Math.abs(room.bounds.maxX - candidate.bounds.minX) < 0.08 ||
                Math.abs(candidate.bounds.maxX - room.bounds.minX) < 0.08
              ) &&
              Math.min(room.bounds.maxZ, candidate.bounds.maxZ) -
              Math.max(room.bounds.minZ, candidate.bounds.minZ) > 0.7;
            const sharedHorizontal =
              (
                Math.abs(room.bounds.maxZ - candidate.bounds.minZ) < 0.08 ||
                Math.abs(candidate.bounds.maxZ - room.bounds.minZ) < 0.08
              ) &&
              Math.min(room.bounds.maxX, candidate.bounds.maxX) -
              Math.max(room.bounds.minX, candidate.bounds.minX) > 0.7;
            if (!sharedVertical && !sharedHorizontal) continue;
            reached.add(candidate.id);
            queue.push(candidate);
          }
        }
        expect(reached.size).toBe(zoneRooms.length);
      }
      for (const room of elevated) {
        const sides = [
          { orientation: 'x' as const, fixed: room.bounds.minZ, min: room.bounds.minX, max: room.bounds.maxX },
          { orientation: 'x' as const, fixed: room.bounds.maxZ, min: room.bounds.minX, max: room.bounds.maxX },
          { orientation: 'z' as const, fixed: room.bounds.minX, min: room.bounds.minZ, max: room.bounds.maxZ },
          { orientation: 'z' as const, fixed: room.bounds.maxX, min: room.bounds.minZ, max: room.bounds.maxZ },
        ] as const;
        for (const side of sides) {
          const intervals = shells
            .filter((wall) =>
              wall.orientation === side.orientation &&
              Math.abs((wall.orientation === 'x' ? wall.z : wall.x) - side.fixed) < 0.06 &&
              wall.bottom <= world.wallHeight + 0.02 &&
              wall.bottom + wall.height >= room.ceilingHeight - 0.03
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
            expect(interval.min).toBeLessThanOrEqual(coveredUntil + 0.03);
            coveredUntil = Math.max(coveredUntil, interval.max);
          }
          expect(coveredUntil).toBeGreaterThanOrEqual(side.max - 0.03);
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
  }, 20_000);

  it('builds projecting and flush wall passages with turns, dead ends, slopes and holes', () => {
    // PhysicsWorld uses a capsule radius of 0.32 m.
    const playerDiameter = 0.64;
    const samples = hazardSeeds.flatMap((seed) => {
      const world = hazardWorld(seed);
      return world.features
        .filter((feature) => feature.kind === 'squeeze-view')
        .map((feature) => ({ world, feature }));
    });
    const squeezes = samples.map(({ feature }) => feature);
    const wallBreaches = samples.filter(
      ({ feature }) => feature.passageStyle === 'wall-breach',
    );
    const roomNetworks = squeezes.filter(
      (feature) => feature.passageStyle !== 'wall-breach',
    );
    const projectingBreaches = wallBreaches.filter(
      ({ feature }) => (feature.breachProfile ?? 'projecting') === 'projecting',
    );
    const flushBreaches = wallBreaches.filter(
      ({ feature }) => feature.breachProfile === 'flush',
    );

    expect(squeezes.length).toBeGreaterThan(0);
    expect(wallBreaches.length).toBeGreaterThan(hazardSeeds.length);
    expect(projectingBreaches.length).toBeGreaterThan(0);
    expect(flushBreaches.length).toBeGreaterThan(0);
    expect(squeezes.every((feature) => feature.apertureWidth > playerDiameter)).toBe(true);
    expect(squeezes.every((feature) => {
      const clearance = feature.clearanceHeight ?? 10;
      if (feature.breachProfile === 'flush') return clearance >= 1.58 && clearance <= 2.12;
      if (!feature.hump) return clearance >= 1.36 && clearance <= 1.49;
      const headroom = clearance - feature.hump.elevation;
      return headroom >= 1.15 && headroom <= 1.43;
    })).toBe(true);
    expect(samples.every(({ world, feature }) =>
      world.colliders.some((collider) => collider.id === `${feature.id}-low-ceiling`)
    )).toBe(true);
    expect(new Set(roomNetworks.map((feature) => feature.layout)))
      .toEqual(new Set([
        'through',
        'side-exits',
        'chambers',
        'dead-end',
        'loop',
        'multi-exit',
      ]));
    const flushLayouts = new Set(flushBreaches.map(({ feature }) => feature.layout));
    expect(flushLayouts).toEqual(new Set([
      'through',
      'dead-end',
      'left-turn',
      'right-turn',
      't-junction',
    ]));
    expect(squeezes.some((feature) =>
      feature.layout === 'dead-end' && (feature.exitCount ?? 0) === 0
    )).toBe(true);
    expect(squeezes.some((feature) => feature.hump !== undefined)).toBe(true);
    expect(Math.max(...squeezes.flatMap((feature) =>
      feature.hump ? [feature.hump.elevation] : []
    ))).toBeGreaterThan(0.7);
    expect(squeezes.some((feature) => (feature.holes?.length ?? 0) > 0)).toBe(true);
    const passageHoleKinds = new Set<'drop' | 'void'>();
    for (const { world, feature } of samples) {
      for (const hole of feature.holes ?? []) {
        expect(hole.kind === 'drop' || hole.kind === 'void').toBe(true);
        passageHoleKinds.add(hole.kind ?? 'drop');
        expect(hole.depth).toBeCloseTo((hole.stories ?? 1) * 5.4, 6);
        expect(world.floorOpenings?.some((opening) =>
          opening.minX === hole.minX &&
          opening.maxX === hole.maxX &&
          opening.minZ === hole.minZ &&
          opening.maxZ === hole.maxZ
        )).toBe(true);
        expect(world.lights.some((light) => lightPanelOverlapsRect(light, hole))).toBe(false);
        expect(world.colliders.some((collider) =>
          collider.id === `${feature.id}-hole-bottom`
        )).toBe(hole.kind !== 'void');
        const shaftColliders = world.colliders.filter((collider) =>
          collider.id.startsWith(`${feature.id}-hole-`) &&
          collider.kind === 'wall'
        );
        expect(shaftColliders).toHaveLength(4);
        expect(Math.min(...shaftColliders.map((collider) =>
          collider.center.y - collider.halfExtents.y
        ))).toBeLessThanOrEqual(
          hole.kind === 'void' ? -54 : -2.71,
        );
        if (feature.breachProfile === 'flush') {
          const holeCrossWidth = feature.axis === 'x' ? rectDepth(hole) : rectWidth(hole);
          expect(holeCrossWidth).toBeCloseTo(feature.apertureWidth, 6);
          expect(feature.layout).toBe('dead-end');
          expect(feature.exitCount).toBe(0);
        }
      }
    }
    expect(passageHoleKinds).toEqual(new Set(['drop', 'void']));
    expect(squeezes.some((feature) =>
      (feature.axis === 'x' ? rectWidth(feature.bounds) : rectDepth(feature.bounds)) >= 16,
    )).toBe(true);
    expect(wallBreaches.some(({ world, feature }) =>
      world.rooms.find((room) => room.id === feature.roomId)?.access === 'secret'
    )).toBe(true);
    for (const { world, feature } of wallBreaches) {
      const hostRoom = world.rooms.find((room) => room.id === feature.roomId);
      expect(hostRoom).toBeDefined();
      expect(hostRoom?.kind === 'open-hall' || hostRoom?.kind === 'pit-gallery').toBe(false);
      expect(world.features.some((candidate) =>
        candidate.id !== feature.id &&
        'roomId' in candidate &&
        candidate.roomId === feature.roomId
      )).toBe(false);
      const lintels = world.walls.filter(
        (wall) => wall.detail === 'crawl-lintel' && wall.roomId === feature.roomId,
      );
      const tunnelSides = world.walls.filter(
        (wall) => wall.detail === 'crawl-tunnel' && wall.roomId === feature.roomId,
      );
      expect(lintels.some((wall) =>
        wall.kind === 'wallpaper' &&
        wall.bottom >= (feature.clearanceHeight ?? 0) - 0.01
      )).toBe(true);
      const passageRects = feature.passageRects ?? [feature.bounds];
      if ((feature.breachProfile ?? 'projecting') === 'projecting') {
        expect(tunnelSides.length).toBeGreaterThanOrEqual(2);
        expect(tunnelSides.every((wall) => wall.kind === 'wallpaper')).toBe(true);
        const crossMin = feature.axis === 'x' ? feature.bounds.minZ : feature.bounds.minX;
        const crossMax = feature.axis === 'x' ? feature.bounds.maxZ : feature.bounds.maxX;
        const crossCenter = (crossMin + crossMax) * 0.5;
        expect(tunnelSides.every((wall) => {
          const center = feature.axis === 'x' ? wall.z : wall.x;
          const innerFace = center < crossCenter
            ? center + wall.thickness * 0.5
            : center - wall.thickness * 0.5;
          return center < crossCenter
            ? innerFace < crossMin - 0.005
            : innerFace > crossMax + 0.005;
        })).toBe(true);
        expect(
          feature.axis === 'x' ? rectDepth(feature.bounds) : rectWidth(feature.bounds),
        ).toBeCloseTo(feature.apertureWidth, 2);
      } else {
        const flushWalls = world.walls.filter(
          (wall) => wall.detail === 'crawl-flush-wall' && wall.roomId === feature.roomId,
        );
        expect(flushWalls.length).toBeGreaterThanOrEqual(2);
        expect(feature.passageRects).toBeDefined();
        expect(passageRects.every((rect) => rectWidth(rect) > 0.6 && rectDepth(rect) > 0.6))
          .toBe(true);
        expect(feature.layout === 'left-turn' || feature.layout === 'right-turn' || feature.layout === 't-junction'
          ? passageRects.length === 2
          : passageRects.length === 1).toBe(true);
        expect(feature.layout === 't-junction' ? feature.exitCount === 2 : true).toBe(true);
      }
      expect(world.columns.some((column) =>
        passageRects.some((rect) =>
          column.x + column.width * 0.5 > rect.minX &&
          column.x - column.width * 0.5 < rect.maxX &&
          column.z + column.depth * 0.5 > rect.minZ &&
          column.z - column.depth * 0.5 < rect.maxZ
        )
      )).toBe(false);
    }
  }, 20_000);

  it('creates bare districts and concentrated pilaster districts', () => {
    const worlds = hazardSeeds.map(hazardWorld);
    const counts = worlds.map(
      (world) => world.columns.filter((column) => column.kind === 'pilaster').length,
    );
    const pilasters = worlds.flatMap(
      (world) => world.columns.filter((column) => column.kind === 'pilaster'),
    );
    const smallPilasters = pilasters.filter(
      (column) => Math.max(column.width, column.depth) < 0.8,
    );
    const broadPilasters = pilasters.filter(
      (column) => Math.max(column.width, column.depth) >= 1.05,
    );
    const massivePilasters = pilasters.filter(
      (column) => Math.max(column.width, column.depth) >= 1.8,
    );
    expect(Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(Math.max(...counts)).toBeGreaterThan((pilasters.length / worlds.length) * 2);
    expect(smallPilasters.length).toBeLessThan(pilasters.length * 0.15);
    expect(broadPilasters.length).toBeGreaterThan(pilasters.length * 0.8);
    expect(massivePilasters.length).toBeGreaterThan(pilasters.length * 0.25);
    expect(worlds.every((world) => (world.baseboardlessZones?.length ?? 0) >= 2)).toBe(true);
    for (const world of worlds) {
      const bareZones = world.baseboardlessZones ?? [];
      expect(world.columns.filter((column) =>
        column.kind === 'pilaster' &&
        bareZones.some((zone) => pointInRect(column.x, column.z, zone, 0.05))
      )).toHaveLength(0);
    }
    expect(pilasters.some((column) => Math.abs(column.width - column.depth) > 0.2)).toBe(true);
  });

  it('carves rare deterministic interactive doorways', () => {
    const worlds = hazardSeeds.map(hazardWorld);
    const doors = worlds.flatMap((world) =>
      world.features
        .filter((feature) => feature.kind === 'interactive-door')
        .map((feature) => ({ feature, world }))
    );
    const counts = worlds.map((world) =>
      world.features.filter((feature) => feature.kind === 'interactive-door').length
    );
    expect(doors.length).toBeGreaterThan(0);
    expect(doors.length).toBeLessThan(hazardSeeds.length * 0.12);
    expect(counts.some((count) => count === 0)).toBe(true);
    expect(counts.some((count) => count === 1)).toBe(true);
    expect(counts.every((count) => count <= 1)).toBe(true);

    for (const { feature, world } of doors) {
      expect(['empty', 'message', 'object', 'passage', 'crawl', 'hole'])
        .toContain(feature.content);
      expect(world.rooms.some((room) => room.id === feature.sourceRoomId)).toBe(true);
      expect(world.rooms.some((room) => room.id === feature.targetRoomId)).toBe(true);
      expect(world.colliders.some((collider) => collider.id === feature.colliderId)).toBe(true);
      expect(world.walls.some((wall) => {
        const fixed = wall.orientation === 'x' ? wall.z : wall.x;
        const along = wall.orientation === 'x' ? feature.position.x : feature.position.z;
        const wallAlong = wall.orientation === 'x' ? wall.x : wall.z;
        const doorFixed = feature.orientation === 'x'
          ? feature.position.z
          : feature.position.x;
        return (
          wall.orientation === feature.orientation &&
          Math.abs(fixed - doorFixed) < 0.03 &&
          wall.bottom >= feature.height - 0.03 &&
          Math.abs(along - wallAlong) <= wall.length * 0.5 + 0.02
        );
      })).toBe(true);
    }
  });

  it('adds connected raised and sunken districts reached through varied physical ramps', () => {
    const worlds = hazardSeeds.map(hazardWorld);
    const samples = worlds.flatMap((world) =>
      world.features
        .filter((feature) => feature.kind === 'raised-zone')
        .map((feature) => ({ world, feature })),
    );
    expect(samples.length).toBeGreaterThan(120);
    expect(samples.every(({ world, feature }) =>
      (feature.roomIds ?? [feature.roomId]).every((roomId) =>
        world.rooms.some((room) =>
          room.id === roomId &&
          room.ceilingHeight - feature.elevation >= 2.4
        )
      )
    )).toBe(true);
    expect(samples.every(({ feature }) =>
      (feature.roomIds?.length ?? 1) >= 2 &&
      (feature.platformRects?.length ?? 1) === (feature.roomIds?.length ?? 1)
    )).toBe(true);
    const ramps = samples.flatMap(({ world, feature }) =>
      (feature.ramps ?? [feature.ramp]).map((ramp, index) => ({ world, feature, ramp, index }))
    );
    for (const { world, feature, ramp, index } of ramps) {
      expect(feature.approachRoomIds).toHaveLength((feature.ramps ?? [feature.ramp]).length);
      expect(new Set(feature.approachRoomIds).size).toBe(feature.approachRoomIds?.length);
      const approachRoomId = feature.approachRoomIds?.[index];
      const approachRoom = world.rooms.find((room) => room.id === approachRoomId);
      expect(approachRoom).toBeDefined();
      if (!approachRoom) continue;

      const rampCrossWidth = ramp.axis === 'x'
        ? rectDepth(ramp.bounds)
        : rectWidth(ramp.bounds);
      const roomCrossSpan = ramp.axis === 'x'
        ? rectDepth(approachRoom.bounds)
        : rectWidth(approachRoom.bounds);
      expect(approachRoom.kind).not.toBe('corridor');
      expect(roomCrossSpan).toBeGreaterThanOrEqual(rampCrossWidth + 2.55);
      expect(world.ceilingZones?.some((zone) => zone.roomIds.includes(approachRoom.id)) ?? false)
        .toBe(false);
      expect(world.features.some((candidate) =>
        candidate.kind === 'squeeze-view' && candidate.roomId === approachRoom.id
      )).toBe(false);
      expect(world.features.some((candidate) =>
        candidate.kind === 'interactive-door' &&
        (candidate.sourceRoomId === approachRoom.id || candidate.targetRoomId === approachRoom.id)
      )).toBe(false);
      expect(world.solidMasses.some((mass) =>
        mass.bounds.minX < ramp.bounds.maxX &&
        mass.bounds.maxX > ramp.bounds.minX &&
        mass.bounds.minZ < ramp.bounds.maxZ &&
        mass.bounds.maxZ > ramp.bounds.minZ
      )).toBe(false);
      expect(world.columns.some((column) =>
        column.x - column.width * 0.5 < ramp.bounds.maxX &&
        column.x + column.width * 0.5 > ramp.bounds.minX &&
        column.z - column.depth * 0.5 < ramp.bounds.maxZ &&
        column.z + column.depth * 0.5 > ramp.bounds.minZ
      )).toBe(false);
    }
    const runs = ramps.map(({ ramp }) =>
      ramp.axis === 'x' ? rectWidth(ramp.bounds) : rectDepth(ramp.bounds)
    );
    const angles = ramps.map(({ feature, ramp }) => {
      const run = ramp.axis === 'x' ? rectWidth(ramp.bounds) : rectDepth(ramp.bounds);
      return Math.atan2(Math.abs(feature.elevation), run) * 180 / Math.PI;
    });
    expect(Math.min(...runs)).toBeLessThan(3);
    expect(Math.max(...runs)).toBeGreaterThan(10);
    expect(Math.min(...angles)).toBeLessThan(10);
    expect(Math.max(...angles)).toBeGreaterThan(25);
    expect(samples.some(({ feature }) => feature.elevation <= -1.2)).toBe(true);
    expect(samples.some(({ feature }) => feature.elevation >= 1.2)).toBe(true);
    const repairedWallDetails = new Set<WallSegment['detail']>();
    let repairedColumnCount = 0;
    for (const { world, feature } of samples) {
      for (const [index] of (feature.ramps ?? [feature.ramp]).entries()) {
        expect(world.colliders.find(
          (collider) => collider.id === `${feature.id}-ramp-${index}`,
        )?.rotation).toBeDefined();
      }
      for (const platform of feature.platformRects ?? [feature.platformBounds]) {
        const center = rectCenter(platform);
        expect(world.floorRects.some((floor) => pointInRect(center.x, center.z, floor))).toBe(false);
      }
      if (feature.elevation < 0) {
        const platforms = feature.platformRects ?? [feature.platformBounds];
        const lowerShells = world.walls.filter((wall) =>
          wall.detail === 'lower-shell' &&
          wall.bottom <= feature.elevation + 0.02
        );
        expect(lowerShells.length).toBeGreaterThan(0);
        expect(lowerShells.every((shell) =>
          !shell.collision ||
          world.colliders.some((collider) => collider.id === `collider-${shell.id}`)
        )).toBe(true);
        for (const wall of world.walls.filter((candidate) =>
          Math.abs(candidate.bottom) < 0.04 &&
          candidate.height > 0.08 &&
          candidate.detail !== 'upper-shell' &&
          candidate.detail !== 'upper-portal-lintel' &&
          candidate.detail !== 'elevation-seal'
        )) {
          const alongCenter = wall.orientation === 'x' ? wall.x : wall.z;
          const fixed = wall.orientation === 'x' ? wall.z : wall.x;
          const wallMin = alongCenter - wall.length * 0.5;
          const wallMax = alongCenter + wall.length * 0.5;
          const crossTolerance = wall.thickness * 0.5 + 0.025;
          for (const platform of platforms) {
            const crossMin = wall.orientation === 'x' ? platform.minZ : platform.minX;
            const crossMax = wall.orientation === 'x' ? platform.maxZ : platform.maxX;
            if (fixed < crossMin - crossTolerance || fixed > crossMax + crossTolerance) continue;
            const claimMin = Math.max(
              wallMin,
              wall.orientation === 'x' ? platform.minX : platform.minZ,
            );
            const claimMax = Math.min(
              wallMax,
              wall.orientation === 'x' ? platform.maxX : platform.maxZ,
            );
            if (claimMax - claimMin <= 0.01) continue;
            repairedWallDetails.add(wall.detail);
            const intervals = lowerShells
              .filter((shell) => {
                if (shell.orientation !== wall.orientation) return false;
                const shellFixed = shell.orientation === 'x' ? shell.z : shell.x;
                return Math.abs(shellFixed - fixed) < 0.12;
              })
              .map((shell) => {
                const center = shell.orientation === 'x' ? shell.x : shell.z;
                return {
                  min: center - shell.length * 0.5,
                  max: center + shell.length * 0.5,
                };
              })
              .sort((left, right) => left.min - right.min);
            let coveredUntil = claimMin;
            for (const interval of intervals) {
              if (interval.max <= coveredUntil + 0.02) continue;
              if (interval.min > coveredUntil + 0.02) break;
              coveredUntil = Math.max(coveredUntil, interval.max);
            }
            expect(coveredUntil).toBeGreaterThanOrEqual(claimMax - 0.02);
          }
        }
        for (const column of world.columns) {
          const columnBounds = {
            minX: column.x - column.width * 0.5,
            maxX: column.x + column.width * 0.5,
            minZ: column.z - column.depth * 0.5,
            maxZ: column.z + column.depth * 0.5,
          };
          if (!platforms.some((platform) =>
            columnBounds.minX < platform.maxX - 0.01 &&
            columnBounds.maxX > platform.minX + 0.01 &&
            columnBounds.minZ < platform.maxZ - 0.01 &&
            columnBounds.maxZ > platform.minZ + 0.01
          )) continue;
          repairedColumnCount += 1;
          expect(column.bottom).toBeLessThanOrEqual(feature.elevation + 0.02);
          expect(world.colliders.some((collider) =>
            collider.kind === 'column' &&
            Math.abs(collider.center.x - column.x) < 0.025 &&
            Math.abs(collider.center.z - column.z) < 0.025 &&
            collider.center.y - collider.halfExtents.y <= feature.elevation + 0.02
          )).toBe(true);
        }
      }
    }
    // Recesses are added after elevation selection and used to be the most
    // common source of visibly floating walls in lowered districts.
    expect(repairedWallDetails.has('recess')).toBe(true);
    expect(repairedColumnCount).toBeGreaterThan(20);
  });

  it('varies complete straight and switchback stairs that reach the next 5.4m story', () => {
    const samples = hazardSeeds.flatMap((seed) => {
      const world = hazardWorld(seed);
      return world.features
        .filter((feature): feature is StairSocketFeature =>
          feature.kind === 'stair-socket' && feature.inherited !== true
        )
        .map((feature) => ({ world, feature }));
    });
    expect(samples.length).toBeGreaterThan(30);
    expect(new Set(samples.map(({ feature }) => feature.layout))).toEqual(
      new Set(['straight', 'switchback']),
    );
    expect(new Set(
      samples
        .map(({ feature }) => feature)
        .filter((feature) => feature.layout === 'switchback')
        .map((feature) => feature.switchbackJoin),
    )).toEqual(new Set(['joined', 'divider']));
    for (const { world, feature } of samples) {
      const slabs = getStairSlabs(feature);
      expect(slabs.filter((slab) => slab.kind === 'step')).toHaveLength(30);
      expect(Math.max(...slabs.map((slab) => slab.top))).toBeCloseTo(STAIR_STORY_RISE, 6);
      expect(world.colliders.filter((collider) =>
        collider.id.startsWith(`${feature.id}-flight-ramp-`)
      )).toHaveLength(feature.layout === 'straight' ? 1 : 2);
      expect(world.colliders.filter((collider) =>
        collider.id.startsWith(`${feature.id}-`) &&
        collider.kind === 'step'
      )).toHaveLength(feature.layout === 'straight' ? 2 : 4);
      expect(world.colliders.filter((collider) =>
        collider.id.startsWith(`${feature.id}-cage-wall-`) &&
        collider.kind === 'wall'
      )).toHaveLength(
        feature.layout === 'straight'
          ? 2
          : feature.switchbackJoin === 'divider' ? 4 : 3,
      );
      expect(world.lights.some((light) => lightPanelOverlapsRect(light, feature.bounds)))
        .toBe(false);
      expect(world.colliders.some((collider) =>
        collider.id === `${feature.id}-terminal-wall`
      )).toBe(false);

      const cageWalls = getStairCageWalls(feature);
      if (feature.layout === 'straight') {
        expect(slabs.some((slab) => slab.kind === 'mid-landing')).toBe(false);
        expect(cageWalls.some((wall) => wall.kind === 'divider')).toBe(false);
      } else if (feature.switchbackJoin === 'divider') {
        expect(cageWalls.filter((wall) => wall.kind === 'divider')).toHaveLength(1);
      } else {
        const firstLaneStep = slabs[0]!;
        const secondLaneStep = slabs[30]!;
        const alongX = feature.heading.startsWith('x');
        expect(alongX
          ? firstLaneStep.bounds.maxZ
          : firstLaneStep.bounds.maxX
        ).toBeCloseTo(
          alongX ? secondLaneStep.bounds.minZ : secondLaneStep.bounds.minX,
          6,
        );
      }
    }
  });

  it('keeps Level 0 walls textured instead of inserting isolated grey plaster districts', () => {
    const worlds = hazardSeeds.map(hazardWorld);
    expect(worlds.every((world) => (world.plasterZones?.length ?? 0) === 0)).toBe(true);
    expect(worlds.every((world) => world.walls.every((wall) => wall.kind !== 'plaster'))).toBe(true);
  });

  it('uses massive structural walls while preserving a minority of thin partitions', () => {
    const structuralWalls = hazardSeeds.flatMap((seed) =>
      hazardWorld(seed).walls.filter((wall) =>
        wall.kind === 'wallpaper' &&
        wall.bottom === 0 &&
        wall.detail !== 'crawl-lintel' &&
        wall.detail !== 'crawl-tunnel' &&
        wall.detail !== 'recess'
      )
    );
    const orderedThicknesses = structuralWalls
      .map((wall) => wall.thickness)
      .sort((left, right) => left - right);
    const median = orderedThicknesses[Math.floor(orderedThicknesses.length * 0.5)]!;
    const thickShare = structuralWalls.filter((wall) => wall.thickness >= 0.68).length /
      structuralWalls.length;
    const massiveShare = structuralWalls.filter((wall) => wall.thickness >= 1.5).length /
      structuralWalls.length;
    const thinShare = structuralWalls.filter((wall) => wall.thickness <= 0.42).length /
      structuralWalls.length;
    expect(median).toBeGreaterThanOrEqual(1.1);
    expect(thickShare).toBeGreaterThanOrEqual(0.72);
    expect(massiveShare).toBeGreaterThanOrEqual(0.22);
    expect(thinShare).toBeGreaterThanOrEqual(0.04);
    expect(thinShare).toBeLessThanOrEqual(0.24);
    expect(Math.max(...orderedThicknesses)).toBeGreaterThanOrEqual(2.7);
  });
});
