import { describe, expect, it } from 'vitest';
import { MOVEMENT_TUNING } from '../player/MovementConfig';
import { BACTERIA_REVEAL_LAMP, CORRIDOR_SPACING, CORRIDOR_TRIGGER } from '../story/CorridorProgress';
import { ChasePath, createChaseWaypoints, createEntryWaypoints, REVEAL_TIMELINE } from './BacteriaLayout';

const threshold = { x: -2.05, y: 8.67, z: -2.712 };
const path = new ChasePath(createChaseWaypoints(threshold));
const TURN_SECONDS = 0.7;
const DOOR_SECONDS = 1.85;

describe('Bacteria chase layout', () => {
  it('reveals the monster under the distant lamp and brings it back to the imported door', () => {
    const start = path.points[0]!;
    const end = path.points[1]!;
    expect(start.x - threshold.x).toBe(2 + BACTERIA_REVEAL_LAMP * CORRIDOR_SPACING);
    expect(start.x - threshold.x - CORRIDOR_TRIGGER).toBeGreaterThan(18);
    expect(end.y).toBe(threshold.y);
    expect(end.z).toBe(threshold.z);
    expect(end.x).toBeGreaterThan(threshold.x);
    expect(createEntryWaypoints(threshold)[1]!.x).toBeLessThan(threshold.x);
  });

  it('leaves time to turn, sprint and close the door, while walking is too slow', () => {
    const secondsToSafety = (speed: number) => REVEAL_TIMELINE.releaseDelay + TURN_SECONDS
      + CORRIDOR_TRIGGER / speed + DOOR_SECONDS;
    const arrival = path.timeTo(path.length);
    const sprint = MOVEMENT_TUNING.locomotion.sprintSpeed * .9;
    expect(arrival - secondsToSafety(sprint)).toBeGreaterThan(2);
    expect(arrival).toBeLessThan(secondsToSafety(MOVEMENT_TUNING.locomotion.walkSpeed));
  });
});
