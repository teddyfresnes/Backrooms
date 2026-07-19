import { describe, expect, it } from 'vitest';
import { fingerprintWorld, generateWorld, validateWorldPlan } from './generateWorld';
import { pointInRect, rectDepth, rectWidth } from './types';
import type { GridPitFeature, LightSlot, StaticCollider, WallSegment, WorldPlan } from './types';

const seeds = Array.from({ length: 32 }, (_, index) => `AUTOTEST-${index.toString().padStart(3, '0')}`);
const hazardSeeds = Array.from(
  { length: 160 },
  (_, index) => `HAZARD-AUDIT-${index.toString().padStart(3, '0')}`,
);
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

const reachableRoomIds = (seed: string): Set<string> => {
  const world = generateWorld(seed);
  const step = 0.5;
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
      if (collider.center.y < 0) return false;
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
    const worldX = coordinate(gridX);
    const worldZ = coordinate(gridZ);
    for (const room of world.rooms) {
      if (pointInRect(worldX, worldZ, room.bounds, 0.35)) reached.add(room.id);
    }
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
  return reached;
};

describe('Level 0 procedural generator', () => {
  it.each(seeds)('is deterministic for %s', (seed) => {
    const first = generateWorld(seed);
    const second = generateWorld(seed);
    expect(fingerprintWorld(first)).toBe(fingerprintWorld(second));
    expect(first).toEqual(second);
  });

  it.each(seeds)('produces a valid and connected plan for %s', (seed) => {
    const world = generateWorld(seed);
    expect(validateWorldPlan(world)).toEqual([]);
    expect(reachableRoomIds(seed).size).toBe(world.rooms.length);
    expect(world.rooms.length).toBeGreaterThanOrEqual(70);
    const narrowRooms = world.rooms.filter(
      (room) => Math.min(rectWidth(room.bounds), rectDepth(room.bounds)) <= 8.25,
    );
    expect(narrowRooms.length / world.rooms.length).toBeGreaterThanOrEqual(0.28);
    expect(world.rooms.filter((room) => room.kind === 'corridor').length / world.rooms.length)
      .toBeGreaterThanOrEqual(0.3);
    const openHalls = world.rooms.filter((room) => room.kind === 'open-hall');
    expect(openHalls.length).toBeLessThanOrEqual(Math.max(2, Math.ceil(world.rooms.length * 0.05)));
    expect(openHalls.some((room) => rectWidth(room.bounds) * rectDepth(room.bounds) >= 450)).toBe(true);
    expect(world.walls.some((wall) => wall.thickness >= 0.7)).toBe(true);
    expect(world.solidMasses.length).toBeGreaterThanOrEqual(3);
    expect(world.missingCeilingTiles).toHaveLength(0);
    expect(world.lights.every((light) => !light.dead && !light.unstable)).toBe(true);
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

  it('varies pit silhouettes while keeping both compact and large openings', () => {
    const pits = seeds
      .map((seed) => generateWorld(seed).features.find((feature) => feature.kind === 'grid-pit'))
      .filter((feature): feature is GridPitFeature => feature?.kind === 'grid-pit');
    expect(new Set(pits.map((pit) => pit.pattern)).size).toBe(3);
    expect(pits.some((pit) => pit.holes.some((hole) => Math.max(rectWidth(hole), rectDepth(hole)) >= 3.2)))
      .toBe(true);
    expect(pits.every((pit) => pit.holes.some((hole) => Math.max(rectWidth(hole), rectDepth(hole)) <= 1.7)))
      .toBe(true);
    for (const pit of pits) {
      for (let left = 0; left < pit.holes.length; left += 1) {
        for (let right = left + 1; right < pit.holes.length; right += 1) {
          const a = pit.holes[left]!;
          const b = pit.holes[right]!;
          const overlaps = a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
          expect(overlaps).toBe(false);
        }
      }
    }
  });

  it('never places a floor collider below the center of a deep void', () => {
    let voidCount = 0;
    for (const seed of hazardSeeds) {
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
    for (const seed of hazardSeeds) {
      const world = hazardWorld(seed);
      for (const pit of gridPits(world)) {
        for (const hole of pit.holes.filter((candidate) => candidate.kind !== 'void')) {
          const x = (hole.minX + hole.maxX) * 0.5;
          const z = (hole.minZ + hole.maxZ) * 0.5;
          dropCount += 1;
          expect(lowerFloorCovers(world, pit, x, z)).toBe(true);
        }
      }
    }
    expect(dropCount).toBeGreaterThan(0);
  });

  it('keeps every lower-story light clear of every pit opening', () => {
    let lowerLightCount = 0;
    for (const seed of hazardSeeds) {
      const world = hazardWorld(seed);
      const holes = gridPits(world).flatMap((pit) => pit.holes);
      for (const light of world.lights.filter((candidate) => candidate.level === -1)) {
        lowerLightCount += 1;
        expect(holes.some((hole) => pointInRect(light.x, light.z, hole))).toBe(false);
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
      expect(holes.some((hole) => pointInRect(light.x, light.z, hole, -0.72))).toBe(false);
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
    const firstPass = hazardSeeds.map((seed) => hasVoid(hazardWorld(seed)));
    const secondPass = hazardSeeds.map((seed) => hasVoid(generateWorld(seed)));
    const voidWorldCount = firstPass.filter(Boolean).length;

    expect(secondPass).toEqual(firstPass);
    expect(voidWorldCount).toBeGreaterThan(0);
    expect(voidWorldCount / hazardSeeds.length).toBeLessThan(0.15);
  });

  it('keeps squeeze-view apertures narrower than the player capsule diameter', () => {
    // PhysicsWorld uses a capsule radius of 0.32 m.
    const playerDiameter = 0.64;
    const squeezes = seeds.flatMap((seed) =>
      generateWorld(seed).features.filter((feature) => feature.kind === 'squeeze-view'),
    );

    expect(squeezes.length).toBeGreaterThan(0);
    expect(squeezes.every((feature) => feature.apertureWidth < playerDiameter)).toBe(true);
  });
});
