import { describe, expect, it } from 'vitest';
import { APARTMENT_FLOOR_Y } from '../apartment/layout';
import { MOVEMENT_TUNING } from '../player/MovementConfig';
import {
  BACKROOMS_CORRIDOR,
  ChasePath,
  CHASE_CHECKPOINT,
  createChaseWaypoints,
  DOOR_BANG_POSITION,
  isChaseTriggerPosition,
  REVEAL_TIMELINE,
} from './BacteriaLayout';

const path = new ChasePath(createChaseWaypoints());
// Player standing where the reveal fires: mail collected, heading for the stairs.
const trigger = { x: -0.55, y: 0, z: -2.9 };
// Turning around after the zoom-out, then opening, entering and closing the door.
const TURN_SECONDS = 0.7;
const DOOR_SECONDS = 2.6;
const releaseDelay = REVEAL_TIMELINE.release - REVEAL_TIMELINE.charge;

const playerSecondsToSafety = (speed: number): number => {
  const start = path.project(trigger).distance;
  return releaseDelay + TURN_SECONDS + (path.length - start) / speed + DOOR_SECONDS;
};

describe('Bacteria chase layout', () => {
  it('climbs all three storeys and stops on the top landing in front of the door', () => {
    const end = path.sample(path.length, { x: 0, y: 0, z: 0 });
    expect(end.y).toBeCloseTo(APARTMENT_FLOOR_Y, 5);
    expect(end.x).toBeCloseTo(DOOR_BANG_POSITION.x, 5);
    const start = path.sample(0, { x: 0, y: 0, z: 0 });
    expect(start.z).toBeLessThan(BACKROOMS_CORRIDOR.nearZ - 10);
  });

  it('gives a sprinting player a real margin to lock themselves in', () => {
    const sprint = MOVEMENT_TUNING.locomotion.sprintSpeed * 0.9;
    const margin = path.timeTo(path.length) - playerSecondsToSafety(sprint);
    expect(margin).toBeGreaterThan(2);
    expect(margin).toBeLessThan(5.5);
  });

  it('catches a player who only walks', () => {
    const walk = MOVEMENT_TUNING.locomotion.walkSpeed;
    expect(path.timeTo(path.length)).toBeLessThan(playerSecondsToSafety(walk));
  });

  it('projects a player onto their own storey, never the flight above', () => {
    const onFirstLanding = path.project({ x: 0, y: 2.88, z: -2.3 });
    const sampled = path.sample(onFirstLanding.distance, { x: 0, y: 0, z: 0 });
    expect(sampled.y).toBeCloseTo(2.88, 1);
  });

  it('arms the reveal near the first flight only, not by the mailboxes', () => {
    expect(isChaseTriggerPosition(trigger)).toBe(true);
    expect(isChaseTriggerPosition({ ...CHASE_CHECKPOINT, y: 0 })).toBe(false);
    expect(isChaseTriggerPosition({ x: 0, y: 2.88, z: -2 })).toBe(false);
  });
});
