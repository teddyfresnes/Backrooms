import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@dimforge/rapier3d', async () =>
  import('../../node_modules/@dimforge/rapier3d/rapier.js'),
);

import { PhysicsWorld } from './PhysicsWorld';
import { getStairCollisionShapes } from '../world/StairLayout';
import type { StairSocketFeature, StaticCollider, WorldPlan } from '../world/types';

const activeWorlds: PhysicsWorld[] = [];

const makePlan = (colliders: StaticCollider[] = []): WorldPlan => ({
  version: 1,
  seed: 'PHYSICS-CHUNK-TEST',
  size: 32,
  wallHeight: 2.74,
  rooms: [],
  walls: [],
  columns: [],
  solidMasses: [],
  lights: [],
  missingCeilingTiles: [],
  features: [],
  detailSockets: [],
  colliders,
  floorRects: [],
  // Keep the player away from chunk ray-casts unless a test teleports it.
  spawn: { x: 50, y: 0.865, z: 0 },
});

const floorCollider = (
  id: string,
  centerX = 0,
  halfWidth = 3,
): StaticCollider => ({
  id,
  center: { x: centerX, y: -0.12, z: 0 },
  halfExtents: { x: halfWidth, y: 0.12, z: 3 },
  kind: 'floor',
});

const createPhysics = async (colliders: StaticCollider[] = []): Promise<PhysicsWorld> => {
  const physics = await PhysicsWorld.create(makePlan(colliders));
  activeWorlds.push(physics);
  return physics;
};

const castDownAt = (
  physics: PhysicsWorld,
  x: number,
  originY: number,
  z = 0,
) => {
  const ray = {
    origin: { x, y: originY, z },
    dir: { x: 0, y: -1, z: 0 },
    pointAt: (time: number) => ({ x, y: originY - time, z }),
  };
  return physics.world.castRay(ray, 100, true);
};

const castDown = (
  physics: PhysicsWorld,
  x: number,
  originY: number,
) => castDownAt(physics, x, originY);

afterEach(() => {
  activeWorlds.splice(0).forEach((physics) => physics.dispose());
});

describe('PhysicsWorld chunk ownership', () => {
  it('keeps create(plan) compatible through the origin chunk', async () => {
    const physics = await createPhysics([floorCollider('origin-floor', 50)]);

    expect(physics.hasChunk('origin')).toBe(true);
    expect(physics.world.bodies.len()).toBe(2); // origin plus the player.
    expect(physics.world.colliders.len()).toBe(2); // floor plus the player capsule.

    const result = physics.move({ x: 0, y: -0.1, z: 0 });
    expect(result.grounded).toBe(true);
    expect(result.position.y).toBeCloseTo(0.865, 3);
  });

  it('uses a short capsule while crouched and refuses to stand into a low ceiling', async () => {
    const lowCeiling: StaticCollider = {
      id: 'low-ceiling',
      center: { x: 50, y: 1.5, z: 0 },
      halfExtents: { x: 1.5, y: 0.1, z: 2 },
      kind: 'barrier',
    };
    const physics = await createPhysics([floorCollider('origin-floor', 50), lowCeiling]);

    expect(physics.setCrouched(true)).toBe(true);
    expect(physics.isCrouched).toBe(true);
    expect(physics.getPosition().y).toBeCloseTo(0.565, 3);
    expect(physics.setCrouched(false)).toBe(true);
    expect(physics.getPosition().y).toBeCloseTo(0.565, 3);

    physics.move({ x: 2.3, y: 0, z: 0 });
    expect(physics.setCrouched(false)).toBe(false);
    expect(physics.isCrouched).toBe(false);
    expect(physics.getPosition().y).toBeCloseTo(0.865, 3);
  });

  it.each(['joined', 'divider'] as const)(
    'walks both %s switchback flights up to the next story',
    async (switchbackJoin) => {
      const stairs: StairSocketFeature = {
        kind: 'stair-socket',
        id: 'walkable-stairs',
        roomId: 'test-room',
        bounds: { minX: 0, maxX: 8, minZ: -2.5, maxZ: 2.5 },
        heading: 'x+',
        layout: 'switchback',
        switchbackJoin,
        baseY: 0,
      };
      const colliders: StaticCollider[] = [
        {
          id: 'approach-floor',
          center: { x: 0.45, y: -0.12, z: -1.32 },
          halfExtents: { x: 0.6, y: 0.12, z: 1 },
          kind: 'floor',
        },
        ...getStairCollisionShapes(stairs).map((shape, index): StaticCollider => ({
          id: `walkable-stairs-${shape.kind}-${index}`,
          center: shape.center,
          halfExtents: shape.halfExtents,
          rotation: shape.rotation,
          kind: 'step',
        })),
      ];
      const plan = makePlan(colliders);
      plan.spawn = { x: 0.45, y: 0.865, z: -1.32 };
      const physics = await PhysicsWorld.create(plan);
      activeWorlds.push(physics);

      for (let index = 0; index < 220 && physics.getPosition().x < 7.45; index += 1) {
        physics.move({ x: 0.065, y: -0.015, z: 0 });
      }
      expect(physics.getPosition().y).toBeGreaterThan(3.45);

      for (let index = 0; index < 80 && physics.getPosition().z < 1.32; index += 1) {
        physics.move({ x: 0, y: -0.015, z: 0.065 });
      }
      expect(physics.getPosition().z).toBeGreaterThan(1.1);
      for (let index = 0; index < 220 && physics.getPosition().x > 0.6; index += 1) {
        physics.move({ x: -0.065, y: -0.015, z: 0 });
      }

      expect(physics.getPosition().y).toBeCloseTo(6.265, 1);
    },
  );

  it('walks one continuous stair flight up to the next story', async () => {
    const stairs: StairSocketFeature = {
      kind: 'stair-socket',
      id: 'walkable-straight-stairs',
      roomId: 'test-room',
      bounds: { minX: 0, maxX: 12, minZ: -2.1, maxZ: 2.1 },
      heading: 'x+',
      layout: 'straight',
      baseY: 0,
    };
    const colliders: StaticCollider[] = [
      {
        id: 'straight-approach-floor',
        center: { x: 0.45, y: -0.12, z: 0 },
        halfExtents: { x: 0.6, y: 0.12, z: 1 },
        kind: 'floor',
      },
      ...getStairCollisionShapes(stairs).map((shape, index): StaticCollider => ({
        id: `walkable-straight-stairs-${shape.kind}-${index}`,
        center: shape.center,
        halfExtents: shape.halfExtents,
        rotation: shape.rotation,
        kind: 'step',
      })),
    ];
    const plan = makePlan(colliders);
    plan.spawn = { x: 0.45, y: 0.865, z: 0 };
    const physics = await PhysicsWorld.create(plan);
    activeWorlds.push(physics);

    for (let index = 0; index < 360 && physics.getPosition().x < 11.6; index += 1) {
      physics.move({ x: 0.055, y: -0.015, z: 0 });
    }

    expect(physics.getPosition().x).toBeGreaterThan(11.35);
    expect(physics.getPosition().y).toBeCloseTo(6.265, 1);
  });

  it('adds and removes a chunk together with all its attached colliders', async () => {
    const physics = await createPhysics();
    const initialBodyCount = physics.world.bodies.len();
    const initialColliderCount = physics.world.colliders.len();

    physics.addChunk(
      'sector-a',
      [floorCollider('floor-a'), floorCollider('floor-b', 5, 2)],
      { x: 0, y: 0, z: 0 },
    );

    expect(physics.hasChunk('sector-a')).toBe(true);
    expect(physics.world.bodies.len()).toBe(initialBodyCount + 1);
    expect(physics.world.colliders.len()).toBe(initialColliderCount + 2);
    expect(() =>
      physics.addChunk('sector-a', [], { x: 0, y: 0, z: 0 }),
    ).toThrow(/already exists/i);

    expect(physics.removeChunk('sector-a')).toBe(true);
    expect(physics.removeChunk('sector-a')).toBe(false);
    expect(physics.hasChunk('sector-a')).toBe(false);
    expect(physics.world.bodies.len()).toBe(initialBodyCount);
    expect(physics.world.colliders.len()).toBe(initialColliderCount);
  });

  it('synchronizes a batch of stream mutations with a single Rapier step', async () => {
    const physics = await createPhysics();
    const step = vi.spyOn(physics.world, 'step');

    physics.batchChunkChanges(() => {
      physics.addChunk('batch-a', [floorCollider('batch-floor-a', -4)], { x: 0, y: 0, z: 0 });
      physics.addChunk('batch-b', [floorCollider('batch-floor-b', 4)], { x: 0, y: 0, z: 0 });
      physics.removeChunk('origin');
    });

    expect(step).toHaveBeenCalledTimes(1);
    expect(castDown(physics, -4, 2)).not.toBeNull();
    expect(castDown(physics, 4, 2)).not.toBeNull();
  });

  it('treats collider centers as local coordinates when setting a chunk offset', async () => {
    const physics = await createPhysics();
    physics.addChunk('offset-floor', [floorCollider('local-floor')], { x: 4, y: -3, z: 0 });

    expect(castDown(physics, 4, 2)?.timeOfImpact).toBeCloseTo(5, 4);
    expect(castDown(physics, 0, 2)).toBeNull();

    expect(physics.setChunkOffset('offset-floor', { x: 8, y: -6, z: 0 })).toBe(true);
    expect(physics.setChunkOffset('missing', { x: 0, y: 0, z: 0 })).toBe(false);
    expect(castDown(physics, 4, 2)).toBeNull();
    expect(castDown(physics, 8, 2)?.timeOfImpact).toBeCloseTo(8, 4);
  });

  it('disables an interactive collider without rebuilding its chunk', async () => {
    const doorBarrier: StaticCollider = {
      id: 'interactive-door-barrier',
      center: { x: 0, y: 1, z: 0 },
      halfExtents: { x: 0.08, y: 1, z: 0.7 },
      kind: 'barrier',
    };
    const physics = await createPhysics([doorBarrier]);
    const step = vi.spyOn(physics.world, 'step');
    const ray = {
      origin: { x: -2, y: 1, z: 0 },
      dir: { x: 1, y: 0, z: 0 },
      pointAt: (time: number) => ({ x: -2 + time, y: 1, z: 0 }),
    };

    expect(physics.world.castRay(ray, 4, true)).not.toBeNull();
    expect(physics.setChunkColliderEnabled('origin', doorBarrier.id, false)).toBe(true);
    expect(physics.setChunkColliderEnabled('origin', 'missing-door', false)).toBe(false);
    expect(step).not.toHaveBeenCalled();
    physics.move({ x: 0, y: 0, z: 0 });
    expect(step).toHaveBeenCalledTimes(1);
    expect(physics.world.castRay(ray, 4, true)).toBeNull();
  });

  it('rebases every loaded chunk by the same relative delta', async () => {
    const physics = await createPhysics();
    physics.addChunk('left', [floorCollider('left-floor')], { x: -5, y: -2, z: 0 });
    physics.addChunk('right', [floorCollider('right-floor')], { x: 5, y: -4, z: 0 });

    physics.rebaseChunks({ x: 10, y: -3, z: 0 });

    expect(castDown(physics, 5, 2)?.timeOfImpact).toBeCloseTo(7, 4);
    expect(castDown(physics, 15, 2)?.timeOfImpact).toBeCloseTo(9, 4);
    expect(castDown(physics, -5, 2)).toBeNull();
  });

  it('lands on a segmented lower floor loaded as an independent chunk', async () => {
    const physics = await createPhysics();
    physics.addChunk(
      'story--1',
      [floorCollider('lower-left', -1.5, 1.5), floorCollider('lower-right', 1.5, 1.5)],
      { x: 0, y: -5.4, z: 0 },
    );
    physics.teleport({ x: 0, y: -2, z: 0 });

    let grounded = false;
    for (let step = 0; step < 20 && !grounded; step += 1) {
      grounded = physics.move({ x: 0, y: -0.3, z: 0 }).grounded;
    }

    expect(grounded).toBe(true);
    expect(physics.getPosition().y).toBeCloseTo(-4.535, 3);

    expect(physics.removeChunk('story--1')).toBe(true);
    physics.teleport({ x: 0, y: -2, z: 0 });
    const afterRemoval = physics.move({ x: 0, y: -0.3, z: 0 });
    expect(afterRemoval.grounded).toBe(false);
    expect(afterRemoval.position.y).toBeLessThan(-2.25);
  });

  it('applies rotated ramp colliders in both axes and rise directions', async () => {
    const angle = Math.PI / 9;
    const halfAngle = angle * 0.5;
    const colliders: StaticCollider[] = [
      {
        id: 'ramp-x-positive',
        center: { x: -6, y: 0.7, z: 0 },
        halfExtents: { x: 2, y: 0.08, z: 0.8 },
        rotation: { x: 0, y: 0, z: Math.sin(halfAngle), w: Math.cos(halfAngle) },
        kind: 'floor',
      },
      {
        id: 'ramp-x-negative',
        center: { x: 0, y: 0.7, z: 0 },
        halfExtents: { x: 2, y: 0.08, z: 0.8 },
        rotation: { x: 0, y: 0, z: -Math.sin(halfAngle), w: Math.cos(halfAngle) },
        kind: 'floor',
      },
      {
        id: 'ramp-z-positive',
        center: { x: 6, y: 0.7, z: -3 },
        halfExtents: { x: 0.8, y: 0.08, z: 2 },
        rotation: { x: -Math.sin(halfAngle), y: 0, z: 0, w: Math.cos(halfAngle) },
        kind: 'floor',
      },
      {
        id: 'ramp-z-negative',
        center: { x: 6, y: 0.7, z: 3 },
        halfExtents: { x: 0.8, y: 0.08, z: 2 },
        rotation: { x: Math.sin(halfAngle), y: 0, z: 0, w: Math.cos(halfAngle) },
        kind: 'floor',
      },
    ];
    const physics = await createPhysics(colliders);
    const surfaceY = (x: number, z = 0): number => {
      const hit = castDownAt(physics, x, 3, z);
      expect(hit).not.toBeNull();
      return 3 - hit!.timeOfImpact;
    };

    expect(surfaceY(-4.6)).toBeGreaterThan(surfaceY(-7.4));
    expect(surfaceY(-1.4)).toBeGreaterThan(surfaceY(1.4));
    expect(surfaceY(6, -1.6)).toBeGreaterThan(surfaceY(6, -4.4));
    expect(surfaceY(6, 1.6)).toBeGreaterThan(surfaceY(6, 4.4));
  });
});
