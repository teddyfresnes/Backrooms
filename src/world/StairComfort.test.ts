import { expect, it, vi } from 'vitest';
vi.mock('@dimforge/rapier3d', async () => import('../../node_modules/@dimforge/rapier3d/rapier.js'));
import { generateInfiniteChunk } from './InfiniteWorld';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { RAMP_MAX_GRADE, STAIR_MAX_RISER, STAIR_TREAD } from './SpatialGeometry';
import { surfaceRange, validateTopology, type WalkableSurface } from './WalkableTopology';
import { rectCenter, rectDepth, rectWidth } from './types';
import type { TransitionLayout } from './TransitionLayout';

const cases = [...Array.from({ length: 14 }, (_, i) => ({ seed: `REGIONAL-AUDIT-${i}`, x: 0, z: 0, story: 0 })),
  { seed: 'LIMINAL-A', x: -1, z: 0, story: 0 }, { seed: 'LIMINAL-A', x: -1, z: 2, story: 0 }, { seed: 'LIMINAL-A', x: 1, z: 0, story: 0 },
  { seed: 'LIMINAL-B', x: 0, z: 0, story: 0 }, { seed: 'LIMINAL-C', x: 0, z: 0, story: 0 }];
const family = (id: string) => id.includes('/route') ? 'regional' : id.includes('/atrium-stairs/') ? 'atrium' : id.includes('fractional-stair') ? 'terrace' : 'other';

it('bounds pitch, going and riser of every generated flight and the grade of every ramp', () => {
  const flights: Record<string, number> = {}; let ramps = 0;
  for (const c of cases) {
    const w = generateInfiniteChunk(c.seed, c);
    expect(validateTopology(w), c.seed).toEqual([]);
    const groups = new Map<string, WalkableSurface[]>();
    for (const s of w.topology!.surfaces) {
      if (s.role === 'stair') { const key = s.id.replace(/\/step-\d+.*$/, '').replace(/fractional-stair-\d+.*$/, 'fractional-stair'); groups.set(key, [...(groups.get(key) ?? []), s]); }
      else if (s.profile.kind === 'linear' && s.locomotion !== 'crouch') {
        ramps++; const run = s.profile.axis === 'x' ? rectWidth(s.bounds) : rectDepth(s.bounds);
        expect(Math.abs(s.profile.endY - s.profile.startY) / run, s.id).toBeLessThanOrEqual(RAMP_MAX_GRADE + .001);
      }
    }
    for (const [key, steps] of groups) {
      if (steps.length < 2) continue;
      flights[family(key)] = (flights[family(key)] ?? 0) + 1;
      const alongX = Math.abs(steps[0]!.bounds.minX - steps[1]!.bounds.minX) > Math.abs(steps[0]!.bounds.minZ - steps[1]!.bounds.minZ);
      const ordered = [...steps].sort((a, b) => alongX ? a.bounds.minX - b.bounds.minX : a.bounds.minZ - b.bounds.minZ);
      for (const [i, s] of ordered.entries()) {
        expect(alongX ? rectWidth(s.bounds) : rectDepth(s.bounds), s.id).toBeCloseTo(STAIR_TREAD, 6);
        if (!i) continue;
        const riser = Math.abs(surfaceRange(s)[0] - surfaceRange(ordered[i - 1]!)[0]);
        expect(riser, s.id).toBeGreaterThanOrEqual(.149); expect(riser, s.id).toBeLessThanOrEqual(STAIR_MAX_RISER + 1e-6);
      }
      const rise = Math.abs(surfaceRange(ordered.at(-1)!)[0] - surfaceRange(ordered[0]!)[0]);
      const length = alongX ? ordered.at(-1)!.bounds.minX - ordered[0]!.bounds.minX : ordered.at(-1)!.bounds.minZ - ordered[0]!.bounds.minZ;
      expect(Math.atan(rise / length) * 180 / Math.PI, key).toBeLessThan(31);
    }
  }
  expect(flights.regional).toBeGreaterThan(15); expect(flights.atrium).toBeGreaterThan(1); expect(ramps).toBeGreaterThan(3);
}, 180000);

it('lets the real capsule walk and run up and down complete links without snagging or leaving the ground', async () => {
  let walked = 0;
  for (const c of cases.slice(0, 10)) {
    const w = generateInfiniteChunk(c.seed, c);
    const links = new Map<string, TransitionLayout[]>();
    for (const t of w.spatial!.transitions!) links.set(t.linkId, [...(links.get(t.linkId) ?? []), t]);
    for (const halves of links.values()) {
      if (halves.length !== 2) continue;
      const [low, high] = halves[0]!.approach.y < halves[1]!.approach.y ? [halves[0]!, halves[1]!] : [halves[1]!, halves[0]!];
      const a = rectCenter(low.approach.bounds), b = rectCenter(high.approach.bounds);
      for (const [from, fromY, to, toY] of [[a, low.approach.y, b, high.approach.y], [b, high.approach.y, a, low.approach.y]] as const)
        // A slow walker (0.9 m/s) used to stay pinned under the first nosing.
        for (const speed of [.015, .05, .11]) {
          const physics = await PhysicsWorld.create({ ...w, spawn: { x: from.x, y: fromY + .9, z: from.z } });
          try {
            for (let tick = 0; tick < 20; tick++) physics.move({ x: 0, y: -.035, z: 0 });
            const distance = Math.hypot(to.x - from.x, to.z - from.z), ux = (to.x - from.x) / distance, uz = (to.z - from.z) / distance;
            let p = physics.getPosition(), blocked = 0, airborne = 0, ticks = 0;
            for (let tick = 0; tick < 2400; tick++) {
              const before = (p.x - from.x) * ux + (p.z - from.z) * uz; if (before >= distance) break; ticks++;
              const result = physics.move({ x: ux * speed, y: -.035, z: uz * speed }); p = result.position;
              if ((p.x - from.x) * ux + (p.z - from.z) * uz - before < speed * .5) blocked++;
              if (!result.grounded) airborne++;
            }
            const label = `${c.seed} ${low.linkId} ${fromY < toY ? 'up' : 'down'} at ${speed}`;
            expect((p.x - from.x) * ux + (p.z - from.z) * uz, label).toBeGreaterThanOrEqual(distance - .01);
            expect(p.y, label).toBeCloseTo(toY + .865, 1); // Rolling over a nosing may halve one tick per riser; it never stalls the walk.
            expect(blocked / ticks, label).toBeLessThan(.08); expect(ticks, label).toBeLessThan(distance / speed * 1.25); expect(airborne, label).toBeLessThan(4);
            walked++;
          } finally { physics.dispose(); }
        }
    }
  }
  expect(walked).toBeGreaterThanOrEqual(24);
}, 240000);
