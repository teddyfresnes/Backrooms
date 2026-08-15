import { describe, expect, it } from 'vitest';
import { createStairwellPlan } from './createStairwellPlan';
import {
  floorY,
  midLandingY,
  STAIRWELL_FLIGHT_COUNT,
  STAIRWELL_LEVEL_COUNT,
  STAIRWELL_SPAWN,
  STAIRWELL_STEP_RISE,
  STAIRWELL_STEPS_PER_FLIGHT,
} from './layout';

describe('Russian residential stairwell plan V23', () => {
  it('describes four static levels without leaking runtime objects into the plan', () => {
    const plan = createStairwellPlan();
    expect(plan.rooms).toHaveLength(STAIRWELL_LEVEL_COUNT);
    expect(plan.detailSockets).toHaveLength(0);
    expect(plan.features).toHaveLength(0);
    expect(() => JSON.stringify(plan)).not.toThrow();
  });

  it('builds two complete flights for every storey transition', () => {
    const plan = createStairwellPlan();
    const steps = plan.colliders.filter((item) => item.kind === 'step');
    expect(steps).toHaveLength(STAIRWELL_FLIGHT_COUNT * STAIRWELL_STEPS_PER_FLIGHT * 2);
  });

  it('uses thin connected step slabs instead of full-height blocks', () => {
    const plan = createStairwellPlan();
    for (let level = 0; level < STAIRWELL_FLIGHT_COUNT; level += 1) {
      for (const side of ['left', 'right'] as const) {
        const steps = plan.colliders
          .filter((item) => item.id.startsWith(`${side}-flight-${level}-step-`))
          .sort((a, b) => Number(a.id.split('-').at(-1)) - Number(b.id.split('-').at(-1)));
        steps.forEach((step, index) => {
          expect(step.halfExtents.y * 2).toBeCloseTo(STAIRWELL_STEP_RISE, 8);
          const expectedBottom = side === 'left'
            ? floorY(level) + STAIRWELL_STEP_RISE * index
            : midLandingY(level) + STAIRWELL_STEP_RISE * index;
          expect(step.center.y - step.halfExtents.y).toBeCloseTo(expectedBottom, 8);
        });
      }
    }
  });

  it('joins every final step exactly to its landing', () => {
    const plan = createStairwellPlan();
    for (let level = 0; level < STAIRWELL_FLIGHT_COUNT; level += 1) {
      const left = plan.colliders.filter((item) => item.id.startsWith(`left-flight-${level}-step-`));
      const right = plan.colliders.filter((item) => item.id.startsWith(`right-flight-${level}-step-`));
      const top = (items: typeof left): number => Math.max(
        ...items.map((item) => item.center.y + item.halfExtents.y),
      );
      expect(top(left)).toBeCloseTo(midLandingY(level), 8);
      expect(top(right)).toBeCloseTo(floorY(level + 1), 8);
    }
  });

  it('aligns physical railing barriers with both central curbs', () => {
    const plan = createStairwellPlan();
    const railingXs = [...new Set(
      plan.colliders
        .filter((item) => item.id.includes('-rail-'))
        .map((item) => Number(item.center.x.toFixed(3))),
    )].sort((a, b) => a - b);
    expect(railingXs).toEqual([-0.075, 0.075]);
  });

  it('spawns the physical capsule in the ground-floor entrance hall', () => {
    expect(STAIRWELL_SPAWN.y).toBeCloseTo(0.865, 8);
    expect(STAIRWELL_SPAWN.z).toBeLessThan(-2.5);
  });
});
