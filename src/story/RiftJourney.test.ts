import { describe, expect, it } from 'vitest';
import { getChunkWorldOffset } from '../world/InfiniteWorld';
import { EPIC3_LANES, EPIC3_RIFT_CHUNK_Z } from '../world/EpicStructures';
import {
  BalanceModel,
  isInRiftGallery,
  isOverRiftVoid,
  nearestRiftLane,
  RIFT_CENTER_Z,
  riftBank,
  riftLaneX,
} from './RiftJourney';
import { freshRiftProgress, sanitizeRiftProgress } from './RiftProgress';

describe('rift journey geometry', () => {
  it('maps every portal pair of every segment to one global lane index', () => {
    expect(RIFT_CENTER_Z).toBe(getChunkWorldOffset({ x: 0, z: EPIC3_RIFT_CHUNK_Z, story: 0 }).z);
    for (const chunkX of [-3, 0, 2]) {
      const offset = getChunkWorldOffset({ x: chunkX, z: EPIC3_RIFT_CHUNK_Z, story: 0 }).x;
      for (const along of EPIC3_LANES) {
        const lane = nearestRiftLane(offset + along + 0.6);
        expect(riftLaneX(lane)).toBeCloseTo(offset + along, 6);
      }
    }
  });

  it('tells banks, galleries and the void apart', () => {
    expect(riftBank(RIFT_CENTER_Z + 8)).toBe(1);
    expect(riftBank(RIFT_CENTER_Z - 8)).toBe(-1);
    expect(isOverRiftVoid(RIFT_CENTER_Z + 5.9)).toBe(true);
    expect(isOverRiftVoid(RIFT_CENTER_Z + 6.1)).toBe(false);
    expect(isInRiftGallery(RIFT_CENTER_Z - 10)).toBe(true);
    expect(isInRiftGallery(RIFT_CENTER_Z - 15)).toBe(false);
  });
});

describe('plank balance', () => {
  const simulate = (control: (model: BalanceModel) => number, seconds: number, walking = 1): BalanceModel => {
    const model = new BalanceModel('BALANCE-AUDIT');
    for (let t = 0; t < seconds && !model.fallen; t += 1 / 60) model.step(1 / 60, control(model), walking, t / seconds);
    return model;
  };

  it('tips over when nobody holds it', () => {
    expect(simulate(() => 0, 8).fallen).toBe(true);
  });

  it('is kept up by a late, coarse human correction', () => {
    // Reacts only past a quarter of the limit, with plain full key presses.
    let held = 0;
    const model = simulate((m) => {
      if (Math.abs(m.lean) > BalanceModel.LIMIT * 0.25) held = -Math.sign(m.lean);
      else if (Math.abs(m.lean) < BalanceModel.LIMIT * 0.08) held = 0;
      return held;
    }, 14);
    expect(model.fallen).toBe(false);
  });

  it('pushes the wrong way into a fall', () => {
    expect(simulate((m) => Math.sign(m.lean), 6).fallen).toBe(true);
  });
});

describe('rift progress', () => {
  it('round-trips and rejects inconsistent snapshots', () => {
    const plank = { version: 1, stage: 'plank', plank: { lane: -3, story: 2, bank: 1 }, spoken: ['wake', 'wrongWay'] };
    expect(sanitizeRiftProgress(plank)).toEqual(plank);
    expect(sanitizeRiftProgress(freshRiftProgress())).toEqual(freshRiftProgress());
    expect(sanitizeRiftProgress({ ...plank, plank: undefined })).toBeNull();
    expect(sanitizeRiftProgress({ ...plank, plank: { lane: 1.5, story: 0, bank: 1 } })).toBeNull();
    expect(sanitizeRiftProgress({ ...plank, stage: 'flying' })).toBeNull();
    expect(sanitizeRiftProgress({ ...plank, stage: 'crossed', crossedSeconds: 3.25 }))
      .toEqual({ ...plank, stage: 'crossed', crossedSeconds: 3.25 });
    for (const crossedSeconds of [-1, Infinity, 8]) expect(sanitizeRiftProgress({ ...plank, stage: 'crossed', crossedSeconds })).toBeNull();
    expect(sanitizeRiftProgress({ ...plank, crossedSeconds: 2 })).toBeNull();
    expect(sanitizeRiftProgress({ ...plank, spoken: ['<script>'] })).toBeNull();
    expect(sanitizeRiftProgress({ version: 1, stage: 'done', resolution: 'dropped', spoken: [] }))
      .toEqual({ version: 1, stage: 'done', resolution: 'dropped', spoken: [] });
  });
});
