import { expect, it } from 'vitest';
import { resolveShot } from './NeighborGunfire';

const origin = { x: 0, y: 1.4, z: 0 };
const toward = (x: number, y: number, z: number) => { const l = Math.hypot(x, y, z); return { x: x / l, y: y / l, z: z / l }; };

it('hits a player standing in the line of fire', () => {
  const player = { x: 0, y: 0.865, z: 2 };
  const result = resolveShot(origin, toward(0, -0.05, 1), player, null);
  expect(result.kind).toBe('player');
  expect(result.distance).toBeGreaterThan(1.5);
});

it('lets a wall in between stop the bullet', () => {
  const player = { x: 0, y: 0.865, z: 4 };
  expect(resolveShot(origin, toward(0, -0.05, 1), player, 1.2)).toEqual({ kind: 'wall', distance: 1.2 });
});

it('misses a player who stepped out of the line, and the wall behind takes the impact', () => {
  const player = { x: 1.1, y: 0.865, z: 2 };
  expect(resolveShot(origin, toward(0, 0, 1), player, 6).kind).toBe('wall');
  expect(resolveShot(origin, toward(0, 0, 1), player, null).kind).toBe('none');
});
