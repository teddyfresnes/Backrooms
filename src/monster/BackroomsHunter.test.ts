import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../world/SeededRandom';
import { BackroomsHunter, HUNTER_TUNING, type HunterEvent, type HunterState } from './BackroomsHunter';
import { mazeProbe, NavGrid } from './BackroomsNav';
import { alongRoute, carve, CELL, mazeSight, racingLine, rooms, routeLength, squareWave, staircase, type Maze } from './BackroomsMazes.test-helpers';

const DT = 1 / 30;
const SPRINT = 6.65;
const WALK = 3.0;

interface Run { caught: boolean; lost: boolean; lostAt: number; states: Set<HunterState>; events: HunterEvent[]; hunter: BackroomsHunter; minGap: number; meanGap: number }

/**
 * The player runs (or walks) the maze's route; the hunter starts on his heels
 * at the route's start, already chasing. Sight is the maze's own line test.
 */
const chase = (maze: Maze, pace: 'sprint' | 'walk', seconds: number, head = 5, seed = 'fair'): Run => {
  const nav = new NavGrid(mazeProbe(maze.rows), 128, CELL);
  const hunter = new BackroomsHunter(nav, new SeededRandom(seed));
  // He runs like a person does: the inside of each corner.
  const line = racingLine(maze.route, 1.4);
  const total = routeLength(line);
  const player = { x: 0, z: 0, corner: 0 };
  let travelled = head;
  alongRoute(line, travelled, player);
  nav.follow(player.x, player.z, 0);
  const start = maze.route[0]!, next = maze.route[1]!;
  hunter.adopt({ x: start.x, y: 0, z: start.z }, Math.atan2(next.x - start.x, next.z - start.z), 'chase');
  const top = pace === 'sprint' ? SPRINT : WALK;
  let speed = top, lost = false, lostAt = -1, caught = false, gapSum = 0, samples = 0, minGap = Infinity;
  const states = new Set<HunterState>(), events: HunterEvent[] = [];
  const senses = { feet: { x: 0, y: 0, z: 0 }, speed: 0, noise: 0, sees: false, seen: false, stared: false, cinematic: false };
  for (let t = 0; t < seconds; t += DT) {
    // A sprinting body loses some speed in each corner, then picks up again.
    if (pace === 'sprint') speed = player.corner < 0.7 ? Math.max(5.4, speed - 20 * DT) : Math.min(top, speed + 15 * DT);
    travelled = Math.min(total, travelled + speed * DT);
    alongRoute(line, travelled, player);
    nav.follow(player.x, player.z, 0);
    senses.feet.x = player.x; senses.feet.z = player.z;
    senses.speed = travelled >= total ? 0 : speed;
    senses.noise = senses.speed <= 0 ? 0 : pace === 'sprint' ? 1 : 0.42;
    senses.sees = mazeSight(maze.rows, hunter.position.x, hunter.position.z, player.x, player.z);
    hunter.update(DT, senses);
    states.add(hunter.state);
    events.push(...hunter.events);
    if (hunter.events.includes('caught')) { caught = true; break; }
    if (hunter.state === 'search' && !lost) { lost = true; lostAt = t; }
    if (hunter.state === 'chase') { gapSum += hunter.gap; samples += 1; minGap = Math.min(minGap, hunter.gap); }
    // Every position it takes lies in a free cell.
    expect(maze.rows[Math.floor(hunter.position.z / CELL)]![Math.floor(hunter.position.x / CELL)]).toBe('.');
  }
  return { caught, lost, lostAt, states, events, hunter, minGap, meanGap: samples ? gapSum / samples : Infinity };
};

const MAZES: [string, Maze][] = [
  ['staircase', staircase(18)],
  ['square wave', squareWave(18)],
  ['rooms and doors', rooms(24)],
];

describe('backrooms hunter fairness', () => {
  for (const [name, maze] of MAZES) {
    it(`is shaken off by a sprint that chains corners (${name})`, () => {
      const run = chase(maze, 'sprint', 26);
      expect(run.caught).toBe(false);
      expect(run.lost).toBe(true);
      // Not instantly either: it stays on him for a while first.
      expect(run.lostAt).toBeGreaterThan(3);
    });

    it(`catches a player who only walks (${name})`, () => {
      const run = chase(maze, 'walk', 20);
      expect(run.caught).toBe(true);
    });
  }

  it('hangs on a sprinter down a long straight without catching him', () => {
    const corridor: Maze = { rows: carve(360, 12, [[1, 1, 179, 5]]), route: [{ x: 2, z: 3 }, { x: 178, z: 3 }] };
    const run = chase(corridor, 'sprint', 16, 8);
    expect(run.caught).toBe(false);
    expect(run.lost).toBe(false);
    expect(run.meanGap).toBeLessThan(7);
    expect(run.events).toContain('lunge');
  });

  it('is deterministic for a seed', () => {
    const maze = squareWave(10);
    const a = chase(maze, 'sprint', 15, 8, 'same'), b = chase(maze, 'sprint', 15, 8, 'same');
    expect(a.hunter.position).toEqual(b.hunter.position);
    expect(a.events).toEqual(b.events);
  });
});

describe('backrooms hunter behaviour', () => {
  const room = carve(120, 120, [[1, 1, 59, 59]]);

  const senseAt = (x: number, z: number, overrides: Partial<{ sees: boolean; seen: boolean; stared: boolean; noise: number; speed: number; cinematic: boolean }> = {}) => ({
    feet: { x, y: 0, z }, speed: 0, noise: 0, sees: false, seen: false, stared: false, cinematic: false, ...overrides,
  });

  it('waits still until he comes close, then notices, screams and runs', () => {
    const nav = new NavGrid(mazeProbe(room), 128, CELL);
    nav.follow(30, 30, 0);
    const hunter = new BackroomsHunter(nav, new SeededRandom('still'));
    hunter.place({ x: 30, y: 0, z: 10, yaw: 0, style: 'still' });
    const events: HunterEvent[] = [];
    // Far off and unseen: nothing happens.
    for (let t = 0; t < 5; t += DT) { hunter.update(DT, senseAt(30, 40)); events.push(...hunter.events); }
    expect(hunter.state).toBe('lurk');
    expect(hunter.position).toMatchObject({ x: 30, z: 10 });
    // Stared at from afar it freezes.
    hunter.update(DT, senseAt(30, 40, { sees: true, seen: true, stared: true }));
    expect(hunter.frozen).toBe(true);
    // He walks up to it.
    let z = 40;
    for (let t = 0; t < 15 && hunter.state !== 'chase'; t += DT) {
      z = Math.max(16, z - WALK * DT);
      hunter.update(DT, senseAt(30, z, { sees: true, seen: true, noise: 0.42, speed: WALK }));
      events.push(...hunter.events);
    }
    expect(events).toContain('notice');
    expect(events).toContain('scream');
    expect(hunter.state).toBe('chase');
    expect(Math.abs(hunter.position.z - 10)).toBeLessThan(0.5);
  });

  it('searches the last place it saw him, reacts to a sprint, never vanishes in sight', () => {
    const nav = new NavGrid(mazeProbe(room), 128, CELL);
    nav.follow(30, 30, 0);
    const hunter = new BackroomsHunter(nav, new SeededRandom('search'));
    hunter.adopt({ x: 10, y: 0, z: 10 }, 0, 'search');
    hunter.lastKnown.x = 20; hunter.lastKnown.z = 20;
    const events: HunterEvent[] = [];
    // Seen the whole time from 40 m: it may slink off, but never goes dormant while in sight.
    for (let t = 0; t < 60; t += DT) {
      hunter.update(DT, senseAt(50, 50, { sees: false, seen: true }));
      events.push(...hunter.events);
      expect(hunter.state).not.toBe('dormant');
    }
    expect(events).toContain('sniff');
    // A sprint close by: it heads there.
    const before = Math.hypot(hunter.position.x - 40, hunter.position.z - 40);
    for (let t = 0; t < 2; t += DT) { hunter.update(DT, senseAt(40, 40, { noise: 1, speed: SPRINT })); events.push(...hunter.events); }
    if (hunter.state === 'search') {
      expect(events).toContain('heard');
      expect(Math.hypot(hunter.position.x - 40, hunter.position.z - 40)).toBeLessThan(before);
    }
  });

  it('withdraws during a scripted shot and only vanishes out of sight, far enough', () => {
    const nav = new NavGrid(mazeProbe(room), 128, CELL);
    nav.follow(30, 30, 0);
    const hunter = new BackroomsHunter(nav, new SeededRandom('withdraw'));
    hunter.adopt({ x: 30, y: 0, z: 25 }, 0, 'chase');
    hunter.update(DT, senseAt(30, 30, { cinematic: true, sees: true, seen: true }));
    expect(hunter.state).toBe('withdraw');
    let vanishedAt = -1;
    for (let t = 0; t < 30 && vanishedAt < 0; t += DT) {
      const far = Math.hypot(hunter.position.x - 30, hunter.position.z - 30) >= HUNTER_TUNING.vanishDistance;
      // In view until it is far; then a wall hides it.
      hunter.update(DT, senseAt(30, 30, { cinematic: true, sees: !far, seen: !far }));
      if (hunter.state === 'dormant') vanishedAt = t;
    }
    expect(vanishedAt).toBeGreaterThan(0);
    expect(Math.hypot(hunter.position.x - 30, hunter.position.z - 30)).toBeGreaterThanOrEqual(HUNTER_TUNING.vanishDistance - 1);
  });
});
