import { describe, expect, it } from 'vitest';
import { mazeProbe, NavGrid } from './BackroomsNav';
import { carve, CELL, rooms } from './BackroomsMazes.test-helpers';

const walk = (nav: NavGrid, from: { x: number; z: number }, to: { x: number; z: number }, speed = 4, seconds = 30) => {
  const position = { ...from };
  const path: { x: number; z: number }[] = [{ ...position }];
  let length = 0;
  for (let t = 0; t < seconds; t += 1 / 30) {
    if (Math.floor(t * 4) !== Math.floor((t - 1 / 30) * 4)) nav.computeField(to.x, to.z, 1e6);
    if (Math.hypot(to.x - position.x, to.z - position.z) < 0.3) break;
    const steer = nav.steer(position.x, position.z, 16);
    if (!steer) break;
    const dx = steer.x - position.x, dz = steer.z - position.z, distance = Math.hypot(dx, dz);
    const step = Math.min(distance, speed / 30);
    length += nav.move(position, dx / distance * step, dz / distance * step);
    path.push({ ...position });
  }
  return { position, path, length };
};

describe('backrooms nav grid', () => {
  // A room split by a wall (x 10..10.5 m) with a single gap at the far end (z > 17 m).
  const walled = carve(40, 40, [[1, 1, 19, 19]]).map((row, j) => (j < 34 ? `${row.slice(0, 20)}#${row.slice(21)}` : row));

  it('routes around a wall through its only gap and never enters a blocked cell', () => {
    const nav = new NavGrid(mazeProbe(walled), 64, CELL);
    nav.follow(10, 10, 0);
    nav.computeField(15, 5, 1e6);
    const straight = Math.hypot(15 - 5, 0);
    expect(nav.distanceAt(5, 5)).toBeGreaterThan(straight + 15);
    const { position, path } = walk(nav, { x: 5, z: 5 }, { x: 15, z: 5 }, 4, 40);
    expect(Math.hypot(position.x - 15, position.z - 5)).toBeLessThan(0.4);
    for (const point of path) {
      const i = Math.floor(point.x / CELL), j = Math.floor(point.z / CELL);
      expect(walled[j]![i]).toBe('.');
    }
    // It went through the gap (row 34+), the only way round.
    expect(Math.max(...path.map((point) => point.z))).toBeGreaterThan(17);
  });

  it('cuts corners: an L-shaped room is crossed nearly on the straight line', () => {
    // An L: a 16 × 4 m arm and a 4 × 16 m arm sharing the corner square.
    const l = carve(40, 40, [[1, 1, 17, 5], [13, 1, 17, 17]]);
    const nav = new NavGrid(mazeProbe(l), 64, CELL);
    nav.follow(9, 9, 0);
    const from = { x: 2, z: 3 }, to = { x: 15, z: 16 };
    nav.computeField(to.x, to.z, 1e6);
    const { position, length } = walk(nav, from, to, 4, 30);
    expect(Math.hypot(position.x - to.x, position.z - to.z)).toBeLessThan(0.4);
    const manhattan = Math.abs(to.x - from.x) + Math.abs(to.z - from.z);
    // The shortest any-angle route hugs the inner corner (13, 5).
    const shortest = Math.hypot(13 - from.x, 5 - from.z) + Math.hypot(to.x - 13, to.z - 5);
    expect(length).toBeLessThan(manhattan - 3);
    expect(length).toBeLessThan(shortest * 1.08);
  });

  it('passes a 1 m door, refuses diagonal corner squeezes and probes each cell once', () => {
    const maze = rooms(4);
    let probes = 0;
    const probe = mazeProbe(maze.rows);
    const nav = new NavGrid((x, z, y) => { probes += 1; return probe(x, z, y); }, 128, CELL);
    const start = maze.route[0]!, end = maze.route[maze.route.length - 1]!;
    nav.follow((start.x + end.x) / 2, (start.z + end.z) / 2, 0);
    nav.computeField(end.x, end.z, 1e6);
    expect(Number.isFinite(nav.distanceAt(start.x, start.z))).toBe(true);
    const before = probes;
    nav.computeField(end.x, end.z, 1e6);
    expect(probes).toBe(before);
    const { position, path } = walk(nav, start, end, 4, 60);
    expect(Math.hypot(position.x - end.x, position.z - end.z)).toBeLessThan(0.4);
    for (const point of path) expect(maze.rows[Math.floor(point.z / CELL)]![Math.floor(point.x / CELL)]).toBe('.');
  });

  it('keeps what it knows when the window slides, forgets it on another floor', () => {
    const open = carve(200, 200, [[1, 1, 99, 99]]);
    let probes = 0;
    const probe = mazeProbe(open);
    const nav = new NavGrid((x, z, y) => { probes += 1; return probe(x, z, y); }, 64, CELL);
    nav.follow(20, 20, 0);
    nav.computeField(20, 20, 1e6);
    const first = probes;
    expect(first).toBeGreaterThan(3000);
    nav.follow(32, 20, 0, 10);
    nav.computeField(32, 20, 1e6);
    // Only the new strip (12 m of 32) was probed again.
    expect(probes - first).toBeLessThan(first * 0.5);
    nav.follow(32, 20, 5.4);
    expect(nav.isKnown(nav.indexAt(32, 20))).toBe(false);
  });

  it('defers probes beyond its budget to warm-up instead of stalling a frame', () => {
    const open = carve(200, 200, [[1, 1, 99, 99]]);
    let probes = 0;
    const probe = mazeProbe(open);
    const nav = new NavGrid((x, z, y) => { probes += 1; return probe(x, z, y); }, 128, CELL);
    nav.follow(50, 50, 0);
    nav.computeField(50, 50, 40);
    expect(probes).toBeLessThanOrEqual(41);
    expect(nav.pendingProbes).toBeGreaterThan(0);
    for (let frame = 0; frame < 400 && nav.pendingProbes > 0; frame += 1) { nav.warm(60); nav.computeField(50, 50, 40); }
    expect(Number.isFinite(nav.distanceAt(70, 70))).toBe(true);
  });
});
