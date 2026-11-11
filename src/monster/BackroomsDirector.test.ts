import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../world/SeededRandom';
import { chooseLurkSpot, DIRECTOR_TUNING, spotOccluded, spotVisible, TensionDirector, type PlacementContext } from './BackroomsDirector';
import type { LurkStyle } from './BackroomsHunter';
import { mazeProbe, NavGrid } from './BackroomsNav';
import { carve, CELL, mazeSight } from './BackroomsMazes.test-helpers';

/** City blocks: 2 m streets every 8 m both ways, a few dark squares. */
const blocks = (): string[] => {
  const rects: [number, number, number, number][] = [];
  for (let line = 0; line < 9; line += 1) {
    rects.push([0, line * 8, 66, line * 8 + 2]);
    rects.push([line * 8, 0, line * 8 + 2, 66]);
  }
  rects.push([18, 18, 26, 26]);
  return carve(132, 132, rects);
};

const setup = (viewX: number, viewZ: number, player = { x: 33, y: 0, z: 49 }) => {
  const rows = blocks();
  const nav = new NavGrid(mazeProbe(rows), 128, CELL);
  nav.follow(player.x, player.z, 0);
  nav.computeField(player.x, player.z, 1e6);
  const length = Math.hypot(viewX, viewZ);
  const view = { x: viewX / length, z: viewZ / length };
  const context: PlacementContext = {
    player, heading: view, north: { x: 0, z: -1 }, cinematic: false,
    lineOfSight: (x, _y, z) => mazeSight(rows, player.x, player.z, x, z),
    inView: (x, _y, z) => {
      const dx = x - player.x, dz = z - player.z, distance = Math.hypot(dx, dz);
      return distance < 0.5 || (dx * view.x + dz * view.z) / distance > Math.cos(0.9);
    },
    darkness: (x, _y, z) => (x > 40 && z < 30 ? 1 : 0),
  };
  return { rows, nav, context, player };
};

const STYLES: LurkStyle[] = ['still', 'prowl', 'cross', 'ambush'];

describe('backrooms spawn director', () => {
  it('never places it on screen, never within 20 m, and always ahead', () => {
    let placed = 0;
    for (const [vx, vz] of [[0, -1], [1, 0], [-1, -1], [0, 1]] as const) {
      const { nav, context, player } = setup(vx, vz);
      for (const style of STYLES) {
        for (let seed = 0; seed < 6; seed += 1) {
          const spot = chooseLurkSpot(nav, context, new SeededRandom(`spawn-${seed}`), style);
          if (!spot) continue;
          placed += 1;
          const distance = Math.hypot(spot.x - player.x, spot.z - player.z);
          expect(distance).toBeGreaterThanOrEqual(20);
          expect(distance).toBeGreaterThanOrEqual(DIRECTOR_TUNING.minDistance);
          expect(spotVisible(context, spot.x, spot.y, spot.z)).toBe(false);
          if (style === 'ambush' || distance < DIRECTOR_TUNING.openSightDistance) expect(spotOccluded(context, spot.x, spot.y, spot.z)).toBe(true);
          // Ahead on his way north or along his heading, never behind both.
          const ux = (spot.x - player.x) / distance, uz = (spot.z - player.z) / distance;
          expect(0.5 * -uz + 0.5 * (ux * context.heading.x + uz * context.heading.z)).toBeGreaterThan(-0.16);
          if (style === 'cross') expect(spot.crossTo).toBeDefined();
        }
      }
    }
    expect(placed).toBeGreaterThan(40);
  });

  it('places nothing during a scripted shot', () => {
    const { nav, context } = setup(0, -1);
    for (const style of STYLES) {
      expect(chooseLurkSpot(nav, { ...context, cinematic: true }, new SeededRandom('cinematic'), style)).toBeNull();
    }
  });

  it('is deterministic for a seed and varies between seeds', () => {
    const { nav, context } = setup(0, -1);
    const a = chooseLurkSpot(nav, context, new SeededRandom('same-seed'), 'still');
    const b = chooseLurkSpot(nav, context, new SeededRandom('same-seed'), 'still');
    expect(a).not.toBeNull();
    expect(b).toEqual(a);
    const spots = new Set<string>();
    for (let seed = 0; seed < 12; seed += 1) {
      const spot = chooseLurkSpot(nav, context, new SeededRandom(`vary-${seed}`), 'still');
      if (spot) spots.add(`${spot.x.toFixed(1)}:${spot.z.toFixed(1)}`);
    }
    expect(spots.size).toBeGreaterThan(1);
  });

  it('prefers the dark for a still lurker', () => {
    const { nav, context } = setup(0, -1, { x: 49, y: 0, z: 49 });
    let dark = 0, total = 0;
    for (let seed = 0; seed < 10; seed += 1) {
      const spot = chooseLurkSpot(nav, context, new SeededRandom(`dark-${seed}`), 'still');
      if (!spot) continue;
      total += 1;
      if (context.darkness!(spot.x, spot.y, spot.z) > 0.5) { dark += 1; expect(spot.crouched).toBe(true); }
    }
    expect(total).toBeGreaterThan(5);
    expect(dark / total).toBeGreaterThan(0.5);
  });
});

describe('backrooms tension director', () => {
  const step = (director: TensionDirector, seconds: number, input: { armed?: boolean; cinematic?: boolean; speed?: number; dormant?: boolean } = {}) => {
    const cues: string[] = [];
    for (let t = 0; t < seconds; t += 0.1) {
      const cue = director.update(0.1, { armed: input.armed ?? true, cinematic: input.cinematic ?? false, walked: (input.speed ?? 3) * 0.1, hunterDormant: input.dormant ?? true });
      if (cue) cues.push(cue.kind === 'spawn' ? `spawn:${cue.style}` : cue.kind);
    }
    return cues;
  };

  it('builds up before the first encounter, then guarantees a quiet spell after it', () => {
    const director = new TensionDirector(new SeededRandom('tension'));
    expect(step(director, 24).filter((cue) => cue.startsWith('spawn'))).toHaveLength(0);
    // Standing still never builds the first one.
    const idle = new TensionDirector(new SeededRandom('tension-idle'));
    expect(step(idle, 60, { speed: 0 }).filter((cue) => cue.startsWith('spawn'))).toHaveLength(0);
    const cues = step(director, 200);
    const first = cues.findIndex((cue) => cue.startsWith('spawn'));
    expect(first).toBeGreaterThanOrEqual(0);
    director.encounterStarted();
    expect(step(director, 10, { dormant: false })).toHaveLength(0);
    // It ends (lost, or a capture): the relief lasts at least the minimum.
    expect(step(director, DIRECTOR_TUNING.relief[0] - 1)).toHaveLength(0);
    expect(director.phase).toBe('relief');
  });

  it('holds still during scripted shots and away from the hunting grounds', () => {
    const director = new TensionDirector(new SeededRandom('tension-hold'));
    expect(step(director, 300, { cinematic: true })).toHaveLength(0);
    expect(step(director, 300, { armed: false })).toHaveLength(0);
    expect(director.tension).toBe(0);
  });

  it('sometimes knocks for nothing while the tension builds', () => {
    let falseAlarms = 0;
    for (let seed = 0; seed < 8; seed += 1) {
      const director = new TensionDirector(new SeededRandom(`knock-${seed}`));
      // A busy hunter keeps the build phase going.
      step(director, 40);
      falseAlarms += step(director, 120, { dormant: false }).filter((cue) => cue === 'false-knock').length;
    }
    expect(falseAlarms).toBeGreaterThan(3);
  });
});
