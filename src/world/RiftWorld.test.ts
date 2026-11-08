import { describe, expect, it } from 'vitest';
import {
  EPIC3_DOORWAY_LANES,
  EPIC3_DOORWAY_WIDTH,
  EPIC3_FACADE_HALF_DEPTH,
  EPIC3_LANES,
  EPIC3_OUTER_HALF_DEPTH,
  EPIC3_RIFT_CHUNK_Z,
  epicStructureIndexForCoord,
  getEpicStructureSlotsForMacro,
  getNearestEpicStructureCoord,
  isInsideEpicStoryVolume,
} from './EpicStructures';
import { generateInfiniteChunk, getChunkWorldOffset, INFINITE_CHUNK_SIZE } from './InfiniteWorld';
import type { EpicStructureFeature, StaticCollider, WorldPlan } from './types';
import { pointInRect } from './types';

const SEED = 'RIFT-WORLD-AUDIT';
const riftFeature = (plan: WorldPlan): EpicStructureFeature =>
  plan.features.find((feature): feature is EpicStructureFeature =>
    feature.kind === 'epic-structure' && feature.variant === 'ascending-passages')!;

/** Player-sized flood fill at standing height over a plan's floors and solids. */
const walkableComponents = (plan: WorldPlan, step = 0.25, radius = 0.3) => {
  const half = plan.size * 0.5, cells = Math.round(plan.size / step);
  const solids = plan.colliders.filter((collider) =>
    collider.kind !== 'floor'
    && collider.center.y - collider.halfExtents.y < 1.7
    && collider.center.y + collider.halfExtents.y > 0.25);
  const blocked = (x: number, z: number, solid: StaticCollider): boolean =>
    Math.abs(x - solid.center.x) < solid.halfExtents.x + radius
    && Math.abs(z - solid.center.z) < solid.halfExtents.z + radius;
  const open = new Uint8Array(cells * cells);
  for (let i = 0; i < cells; i += 1) {
    for (let j = 0; j < cells; j += 1) {
      const x = -half + (i + 0.5) * step, z = -half + (j + 0.5) * step;
      if (!plan.floorRects.some((rect) => pointInRect(x, z, rect))) continue;
      if (solids.some((solid) => blocked(x, z, solid))) continue;
      open[i * cells + j] = 1;
    }
  }
  const label = new Int32Array(cells * cells).fill(-1);
  let count = 0;
  for (let start = 0; start < open.length; start += 1) {
    if (!open[start] || label[start]! >= 0) continue;
    const queue = [start]; label[start] = count;
    while (queue.length) {
      const cell = queue.pop()!, i = Math.floor(cell / cells), j = cell % cells;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= cells || nj >= cells) continue;
        const next = ni * cells + nj;
        if (open[next] && label[next]! < 0) { label[next] = count; queue.push(next); }
      }
    }
    count += 1;
  }
  return { at: (x: number, z: number) => label[Math.floor((x + half) / step) * cells + Math.floor((z + half) / step)]! };
};

describe('epic3 rift', () => {
  it('owns one whole east-west row on every story, with an empty halo and no tiled copy', () => {
    for (const story of [-3, 0, 2]) {
      for (const x of [-40, -1, 0, 1, 7, 333]) {
        expect(epicStructureIndexForCoord(SEED, { x, z: EPIC3_RIFT_CHUNK_Z })).toBe(3);
        expect(epicStructureIndexForCoord(SEED, { x, z: EPIC3_RIFT_CHUNK_Z - 1 })).toBeNull();
        expect(epicStructureIndexForCoord(SEED, { x, z: EPIC3_RIFT_CHUNK_Z + 1 })).toBeNull();
      }
      expect(getNearestEpicStructureCoord(SEED, 3, { x: 12, z: 40, story }))
        .toEqual({ x: 12, z: EPIC3_RIFT_CHUNK_Z, story });
    }
    for (let macroX = -2; macroX <= 2; macroX += 1) {
      for (let macroZ = -2; macroZ <= 2; macroZ += 1) {
        for (const slot of getEpicStructureSlotsForMacro(SEED, macroX, macroZ)) {
          if (slot.z === EPIC3_RIFT_CHUNK_Z) continue;
          expect(epicStructureIndexForCoord(SEED, slot)).not.toBe(3);
        }
      }
    }
    // About 450 m north of the origin, where the compass leads.
    expect(-getChunkWorldOffset({ x: 0, z: EPIC3_RIFT_CHUNK_Z, story: 0 }).z).toBeGreaterThan(400);
    expect(-getChunkWorldOffset({ x: 0, z: EPIC3_RIFT_CHUNK_Z, story: 0 }).z).toBeLessThan(520);
  });

  it('runs edge to edge with facing portal pairs and no end walls', () => {
    const plan = generateInfiniteChunk(SEED, { x: 0, z: EPIC3_RIFT_CHUNK_Z, story: 0 });
    const rift = riftFeature(plan);
    expect(rift.voidBounds).toEqual({ minX: -56, maxX: 56, minZ: -EPIC3_FACADE_HALF_DEPTH, maxZ: EPIC3_FACADE_HALF_DEPTH });
    const ground = rift.passageLevels!.find((level) => level.y === 0)!;
    for (const along of EPIC3_LANES) {
      const pair = ground.passages.filter((passage) => passage.along === along);
      expect(pair.map((passage) => passage.side).sort()).toEqual(['north', 'south']);
      expect(pair[0]!.width).toBe(pair[1]!.width);
    }
    expect(plan.colliders.some((collider) => /end-cap|shaft-wall-(west|east)/.test(collider.id))).toBe(false);
    expect(plan.floorOpenings).toEqual([rift.voidBounds]);
  });

  it('lets the approach halls reach every portal of the walked story', () => {
    for (const x of [0, 3]) {
      const plan = generateInfiniteChunk(SEED, { x, z: EPIC3_RIFT_CHUNK_Z, story: 0 });
      const walk = walkableComponents(plan);
      for (const sign of [-1, 1] as const) {
        // The far end of the hall, next to the chunk boundary and its gates.
        const hall = walk.at(0.1, sign * 54.5);
        expect(hall).toBeGreaterThanOrEqual(0);
        for (const along of EPIC3_DOORWAY_LANES) {
          // Through the doorway in the gallery back wall...
          expect(walk.at(along, sign * (EPIC3_OUTER_HALF_DEPTH - 0.1))).toBe(hall);
          expect(walk.at(along + EPIC3_DOORWAY_WIDTH, sign * (EPIC3_OUTER_HALF_DEPTH - 0.1))).toBe(-1);
        }
        // ...to the brink of every portal, along the continuous gallery lane.
        for (const along of EPIC3_LANES) expect(walk.at(along, sign * (EPIC3_FACADE_HALF_DEPTH + 0.5))).toBe(hall);
        // A straight sightline stays open along each lane, from the brink to the far end of the hall.
        for (const along of EPIC3_LANES) {
          for (let z = EPIC3_FACADE_HALF_DEPTH + 0.5; z < 53; z += 0.5) {
            // Through the 2.3 m doorway itself only its axis; a wider band beyond it.
            for (const dx of z > EPIC3_OUTER_HALF_DEPTH + 0.5 ? [-1.2, 0, 1.2] : [0]) {
              expect(walk.at(along + dx, sign * z)).toBe(hall);
            }
          }
        }
        // The void itself is never floored.
        expect(walk.at(along0(), 0)).toBe(-1);
      }
    }
  });

  it('pins the stream to exactly one segment on a seam', () => {
    const left = riftFeature(generateInfiniteChunk(SEED, { x: 0, z: EPIC3_RIFT_CHUNK_Z, story: 0 }));
    const seamFromLeft = { x: INFINITE_CHUNK_SIZE * 0.5, y: 1, z: 7 };
    const seamFromRight = { x: -INFINITE_CHUNK_SIZE * 0.5, y: 1, z: 7 };
    expect(isInsideEpicStoryVolume(left, seamFromLeft)).toBe(false);
    expect(isInsideEpicStoryVolume(left, seamFromRight)).toBe(true);
    expect(isInsideEpicStoryVolume(left, { x: 0, y: -20, z: 0 })).toBe(true);
    expect(isInsideEpicStoryVolume(left, { x: 0, y: 1, z: 30 })).toBe(false);
  });
});

const along0 = (): number => EPIC3_LANES[3];
