import { describe, expect, it } from 'vitest';
import { BACTERIA_REVEAL_LAMP, CORRIDOR_TRIGGER, corridorLampDistance } from '../story/CorridorProgress';
import {
  BACTERIA_SPAWN_DISTANCE,
  CATCH_RADIUS,
  ChasePath,
  corridorChargeDistance,
  corridorChargeSpeed,
  createChaseWaypoints,
  createEntryWaypoints,
  createEscapeWaypoints,
  createLureWaypoints,
  DOOR_BANG_SECONDS,
  DOOR_LANDING,
  isOutsideHall,
  isTripPosition,
  FACADE_OUTER_Z,
  REVEAL_TIMELINE as R,
  SPOTTED_TIMELINE,
} from './BacteriaLayout';

const threshold = { x: -2.02, y: 8.67, z: -2.71 };
const SPRINT = 6.65, WALK = 3.0;

/** Seconds of charge before the creature covers `metres` (inverse of the ramp). */
const chargeTime = (metres: number): number => {
  let low = 0, high = 60;
  for (let i = 0; i < 60; i += 1) { const mid = (low + high) / 2; if (corridorChargeDistance(mid) < metres) low = mid; else high = mid; }
  return high;
};

describe('Bacteria corridor reveal', () => {
  it('appears far down the corridor, under the reveal troffer, well beyond the trigger', () => {
    const [start, door] = createChaseWaypoints(threshold);
    expect(start!.x - threshold.x).toBe(corridorLampDistance(BACTERIA_REVEAL_LAMP));
    expect(BACTERIA_SPAWN_DISTANCE - CORRIDOR_TRIGGER).toBeGreaterThan(85);
    expect(door!.x).toBeCloseTo(threshold.x + 0.65);
  });

  it('keeps its back turned through the swelling sting, then turns, then charges', () => {
    expect(R.freeze).toBeLessThan(R.headTurn);
    expect(R.headTurn).toBeLessThan(R.bodySnap);
    expect(R.bodySnap).toBeLessThan(R.charge);
    // The sting lasts 7.7 s: the scream takes over as it ends.
    expect(R.charge).toBeGreaterThan(7.2);
    expect(R.charge).toBeLessThan(7.9);
  });

  it('runs far faster than a sprinting player, and accelerates', () => {
    expect(corridorChargeSpeed(0)).toBeLessThan(corridorChargeSpeed(1));
    expect(corridorChargeSpeed(3)).toBeGreaterThan(SPRINT * 2);
    expect(corridorChargeDistance(2)).toBeCloseTo(corridorChargeDistance(1.9) + corridorChargeSpeed(1.95) * 0.1, 1);
  });

  it('lets a sprinting player reach and shut the apartment door with margin, but catches a walker', () => {
    const [, door] = createChaseWaypoints(threshold);
    const monsterToDoor = chargeTime(BACTERIA_SPAWN_DISTANCE - (door!.x - threshold.x));
    const playerDistance = CORRIDOR_TRIGGER + 2.4;
    // Turning round, accelerating, then sprinting back; shutting the door.
    const sprintArrival = R.releaseDelay + 0.7 + 0.35 + playerDistance / SPRINT;
    const shut = 1.4;
    expect(monsterToDoor - (sprintArrival + shut)).toBeGreaterThan(1.2);
    expect(monsterToDoor - (sprintArrival + shut)).toBeLessThan(4);
    // A walker is run down in the corridor before the threshold.
    let caught = false;
    for (let t = 0; t < 15 && !caught; t += 0.02) {
      const player = Math.max(0, playerDistance - Math.max(0, t - R.releaseDelay - 0.7) * WALK);
      const monster = BACTERIA_SPAWN_DISTANCE - corridorChargeDistance(t);
      if (monster - player < CATCH_RADIUS) caught = true;
      if (player <= 0) break;
    }
    expect(caught || monsterToDoor < R.releaseDelay + 0.7 + playerDistance / WALK + shut).toBe(true);
  });

  it('leaves time to hide once the door is shut, but not forever', () => {
    expect(DOOR_BANG_SECONDS).toBeGreaterThan(3.5);
    expect(DOOR_BANG_SECONDS).toBeLessThan(6);
  });
});

describe('Bacteria in the apartment', () => {
  it('walks door → closet, then closet → television, continuously', () => {
    const entry = createEntryWaypoints(threshold), lure = createLureWaypoints();
    expect(entry[entry.length - 1]!.x).toBeCloseTo(lure[0]!.x);
    expect(entry[entry.length - 1]!.z).toBeCloseTo(lure[0]!.z);
    expect(new ChasePath(lure).length).toBeGreaterThan(2.5);
  });
});

describe('Bacteria escape down the stairwell', () => {
  const path = new ChasePath(createEscapeWaypoints());
  const landing = path.project({ ...DOOR_LANDING, x: DOOR_LANDING.x - 0.18 });

  it('descends every flight and ends through the hall door', () => {
    const end = path.points[path.points.length - 1]!;
    expect(path.points[0]!.y).toBeGreaterThan(8);
    expect(end.y).toBeLessThan(0.5);
    // It follows the player out of the hall door, into the street.
    expect(end.z).toBeLessThan(FACADE_OUTER_Z - 8);
    expect(isOutsideHall({ x: 0.1, y: 0.87, z: FACADE_OUTER_Z - 1 })).toBe(true);
    expect(isOutsideHall({ x: 0.1, y: 0.87, z: -3 })).toBe(false);
    expect(isTripPosition({ x: 0.1, y: 0.87, z: FACADE_OUTER_Z - 1 })).toBe(false);
    expect(isTripPosition({ x: 0.1, y: 0.87, z: FACADE_OUTER_Z - 7 })).toBe(true);
    // Always downhill, until the curb of the hall door.
    for (let index = 1; index < path.points.length - 3; index += 1) expect(path.points[index]!.y).toBeLessThanOrEqual(path.points[index - 1]!.y + 1e-6);
  });

  const race = (playerSpeed: number): { caught: boolean; margin: number } => {
    const exit = path.length - 1.2;
    let player = landing, monster = 0, margin = Infinity;
    for (let t = 0; t < 40; t += 0.02) {
      if (t > SPOTTED_TIMELINE.release) player += playerSpeed * 0.02;
      if (t > SPOTTED_TIMELINE.release + 0.1) monster += path.speedAt(monster) * 0.02;
      margin = Math.min(margin, player - monster);
      if (player - monster < CATCH_RADIUS) return { caught: true, margin };
      if (player >= exit) return { caught: false, margin };
    }
    return { caught: true, margin };
  };

  it('a sprinting player stays ahead, with the creature close behind', () => {
    const run = race(5.6);
    expect(run.caught).toBe(false);
    expect(run.margin).toBeGreaterThan(2);
    expect(run.margin).toBeLessThan(9);
  });

  it('a walking player is caught on the stairs', () => {
    expect(race(WALK).caught).toBe(true);
  });
});
