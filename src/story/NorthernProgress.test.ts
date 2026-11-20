import { describe, expect, it } from 'vitest';
import { NorthernProgression, sanitizeNorthernProgress } from './NorthernProgress';
import { freshRiftProgress } from './RiftProgress';
import { migrateNorthernSaveCoord } from './NorthernSaveMigration';

describe('red-zone story checkpoint', () => {
  const input = { delta: .1, z: -392, redEntryZ: -392, available: true, riftResolved: true, compassVisible: false, owner: { x: 25, story: -2 } };
  it('requires the rift, speaks once after walking, then waits for a real compass consultation', () => {
    const p = new NorthernProgression();
    p.step({ ...input, riftResolved: false }); expect(p.state.stage).toBe('approach');
    p.step(input); expect(p.state.stage).toBe('red-zone');
    for (let i = 1; i < 8; i++) expect(p.step({ ...input, z: input.z - i }).comment).toBe(false);
    expect(p.step({ ...input, z: -400 }).comment).toBe(true);
    expect(p.quest).toBe('Regarder la boussole');
    for (let i = 0; i < 100; i++) p.step({ ...input, z: -400 });
    expect(p.state.compassSeconds).toBe(0);
    const resumed = new NorthernProgression(sanitizeNorthernProgress(p.snapshot)!);
    expect(resumed.step({ ...input, z: -400, compassVisible: true }).comment).toBe(false);
    expect(resumed.anomaly).toBe(1); expect(resumed.state.target).toEqual(input.owner);
    for (let i = 0; i < 90; i++) resumed.step({ ...input, z: -400 });
    expect(resumed.state.compassSeconds).toBe(.1);
    for (let i = 0; i < 49; i++) resumed.step({ ...input, z: -400, compassVisible: true });
    expect(resumed.state.stage).toBe('slides'); expect(resumed.anomaly).toBe(1);
    expect(sanitizeNorthernProgress(resumed.snapshot)?.compassSeconds).toBe(5);
    resumed.state.stage='slides-ready';expect(resumed.anomaly).toBe(0);
  });
  it('ignores cinematics/noclip and large teleports, and catches up a legacy far-bank save', () => {
    const p = new NorthernProgression(); p.step(input);
    p.step({ ...input, z: -450, available: false }); expect(p.state.stage).toBe('red-zone');
    expect(p.step({ ...input, z: -450 }).comment).toBe(true);
    const b = new NorthernProgression(); b.step(input); b.step({ ...input, z: -408 });
    expect(b.state.walkedRed).toBe(0); expect(b.state.stage).toBe('red-zone');
  });
  it('rejects corrupt checkpoints and migrates legacy plank addresses exactly once', () => {
    expect(sanitizeNorthernProgress({ version: 1, stage: 'slides', walkedRed: 8, compassSeconds: 3.2 })).toBeNull();
    expect(sanitizeNorthernProgress({ version: 1, stage: 'approach', walkedRed: NaN, compassSeconds: 0 })).toBeNull();
    const chunk = { x: 19, z: -4, story: -2 }, rift = { ...freshRiftProgress('plank'), plank: { lane: 2, story: -2, bank: 1 as const } };
    expect(migrateNorthernSaveCoord(chunk, 7, rift, false)).toEqual({ ...chunk, z: -3 });
    expect(migrateNorthernSaveCoord(chunk, 7, rift, true)).toBe(chunk);
    expect(migrateNorthernSaveCoord(chunk, -15, freshRiftProgress('done'), false)).toBe(chunk);
    const origin = { x: 0, z: 0, story: 0 };
    expect(migrateNorthernSaveCoord(origin, 0, freshRiftProgress('north'), false)).toBe(origin);
  });
});
