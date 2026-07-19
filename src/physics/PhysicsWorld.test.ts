import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@dimforge/rapier3d', async () =>
  import('../../node_modules/@dimforge/rapier3d/rapier.js'),
);

import { PhysicsWorld } from './PhysicsWorld';
import type { StaticCollider, WorldPlan } from '../world/types';

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

const castDown = (
  physics: PhysicsWorld,
  x: number,
  originY: number,
) => {
  const ray = {
    origin: { x, y: originY, z: 0 },
    dir: { x: 0, y: -1, z: 0 },
    pointAt: (time: number) => ({ x, y: originY - time, z: 0 }),
  };
  return physics.world.castRay(ray, 100, true);
};

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
});
