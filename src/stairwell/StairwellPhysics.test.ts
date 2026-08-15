import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@dimforge/rapier3d', async () =>
  import('../../node_modules/@dimforge/rapier3d/rapier.js'),
);

import { PhysicsWorld } from '../physics/PhysicsWorld';
import { createStairwellPlan } from './createStairwellPlan';
import {
  midLandingY,
  STAIRWELL_LEFT_FLIGHT,
  STAIRWELL_STEPS_PER_FLIGHT,
} from './layout';

const activeWorlds: PhysicsWorld[] = [];

afterEach(() => {
  for (const physics of activeWorlds.splice(0)) physics.dispose();
});

describe('Russian stairwell physics', () => {
  it('walks the Rapier player up the first real stair flight to its mid landing', async () => {
    const plan = createStairwellPlan();
    const firstFlight = plan.colliders.filter((collider) =>
      collider.id.startsWith('left-flight-0-step-'),
    );
    expect(firstFlight).toHaveLength(STAIRWELL_STEPS_PER_FLIGHT);

    const physics = await PhysicsWorld.create(plan);
    activeWorlds.push(physics);

    for (
      let tick = 0;
      tick < 180 && physics.getPosition().z < STAIRWELL_LEFT_FLIGHT.maxZ + 0.4;
      tick += 1
    ) {
      physics.move({ x: 0, y: -0.015, z: 0.045 });
    }

    expect(physics.getPosition().z).toBeGreaterThan(STAIRWELL_LEFT_FLIGHT.maxZ + 0.2);
    expect(physics.getPosition().y).toBeCloseTo(midLandingY(0) + 0.865, 2);
  });
});
