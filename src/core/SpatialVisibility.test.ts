import { expect, it } from 'vitest';
import { selectSpatialVisibleOwners } from './SpatialVisibility';
import { WorldStream } from './WorldStream';
import type { SpatialDependency } from '../world/SpatialTypes';
import type { WorldPlan } from '../world/types';

const plan = (dependencies: SpatialDependency[]) => ({ seed: 'VISIBILITY', features: [], spatial: { dependencies } }) as unknown as WorldPlan;
const dependency = (x: number, z: number, story: number, reason: SpatialDependency['reason'] = 'view'): SpatialDependency => ({
  owner: { x, z, story }, bounds: { minX: x * 25 - 1, maxX: x * 25 + 1, minZ: z * 25 - 1, maxZ: z * 25 + 1 }, bottom: -12, top: 12, reason });

it('prioritizes real nearby floor/support owners and the openings being looked at within the same budget', () => {
  const w = plan([dependency(0, 0, -1, 'atrium'), dependency(0, 0, -2, 'atrium'), dependency(0, 1, -1), dependency(0, -1, -1)]);
  const sources = [{ coord: { x: 0, z: 0, story: 0 }, plan: w }], position = { x: 0, y: 1, z: 0 };
  const south = selectSpatialVisibleOwners(sources, position, { direction: { x: 0, y: 0, z: 1 }, limit: 3 });
  const north = selectSpatialVisibleOwners(sources, position, { direction: { x: 0, y: 0, z: -1 }, limit: 3 });
  expect(south).toEqual([{ x: 0, z: 0, story: -2 }, { x: 0, z: 0, story: -1 }, { x: 0, z: 1, story: -1 }]);
  expect(north).toContainEqual({ x: 0, z: -1, story: -1 });
  expect(north).not.toContainEqual({ x: 0, z: 1, story: -1 });
});

it('deduplicates shared owners, excludes the base neighbourhood from the extra budget and remains bounded', () => {
  const entries = Array.from({ length: 30 }, (_, i) => dependency(0, 0, i - 15, 'atrium'));
  const sources = [{ coord: { x: 0, z: 0, story: 0 }, plan: plan([...entries, ...entries]) }];
  const visible = selectSpatialVisibleOwners(sources, { x: 0, y: 1, z: 0 }, { base: new Set(['0:0:0']) });
  expect(visible).toHaveLength(12); expect(new Set(visible.map(c => c.story)).size).toBe(12); expect(visible.some(c => c.story === 0)).toBe(false);
});

it('retains worker completions as bounded CPU plans without mounting a view inside the message callback', () => {
  const w = plan([]), stream = new WorldStream('VISIBILITY', w, {} as never, {} as never, {} as never);
  type Probe = { workerInFlight: { id: number; key: string; coord: { x: number; z: number; story: number }; prefetch: boolean };
    preparedChunks: Map<string, unknown>; mountChunk: (...args: unknown[]) => void; onWorkerMessage: (e: MessageEvent) => void };
  const probe = stream as unknown as Probe; let mounts = 0; probe.mountChunk = () => { mounts++; };
  for (let story = 0; story < 16; story++) {
    const key = `0:0:${story}`; probe.workerInFlight = { id: story, key, coord: { x: 0, z: 0, story }, prefetch: false };
    probe.onWorkerMessage({ data: { id: story, key, plan: w } } as MessageEvent);
  }
  expect(mounts).toBe(0); expect(probe.preparedChunks.size).toBe(12); expect(probe.preparedChunks.has('0:0:15')).toBe(true);
});
