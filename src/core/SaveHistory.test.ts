import { describe, expect, it } from 'vitest';
import {
  GAME_SAVE_HISTORY_LIMIT,
  GAME_SAVE_HISTORY_SCHEMA_VERSION,
  GAME_SAVE_HISTORY_STORAGE_KEY,
  getGameSaveSummary,
  listGameSaves,
  loadGameSave,
  removeGameSave,
  writeGameSave,
  type BackroomsGameSaveInput,
  type GameSaveStorage,
  type RussianStairwellGameSaveInput,
} from './SaveHistory';

class MemoryStorage implements GameSaveStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const russianInput = (playTimeSeconds = 83): RussianStairwellGameSaveInput => ({
  experienceId: 'russian-stairwell',
  kind: 'manual',
  levelId: 'russian-building',
  levelLabel: 'Immeuble',
  playTimeSeconds,
  payload: {
    safePosition: { x: 3, y: 0.865, z: -4 },
    quaternion: { x: 0, y: 0.5, z: 0, w: 0.5 },
    entranceDoor: { progress: 0.4, targetProgress: 1 },
    apartmentLightOn: true,
  },
});

const backroomsInput = (playTimeSeconds = 120): BackroomsGameSaveInput => ({
  experienceId: 'backrooms',
  kind: 'autosave',
  levelId: 'backrooms-level-0',
  levelLabel: 'Niveau 0',
  playTimeSeconds,
  payload: {
    seed: 'TEST-SEED_01',
    chunk: { x: -2, z: 7, story: 1 },
    localPosition: { x: 14, y: 0.865, z: -22 },
    quaternion: { x: 0, y: 0, z: 0, w: 2 },
  },
});

describe('game save history', () => {
  it('round-trips both strict payload variants and exposes compact summaries', () => {
    const storage = new MemoryStorage();
    const russian = writeGameSave(
      storage,
      russianInput(),
      new Date('2026-08-15T10:00:00.000Z'),
    );
    const backrooms = writeGameSave(
      storage,
      backroomsInput(),
      new Date('2026-08-15T10:05:00.000Z'),
    );

    expect(russian.ok).toBe(true);
    expect(backrooms.ok).toBe(true);
    if (!russian.ok || !backrooms.ok) throw new Error('Expected valid saves.');

    expect(listGameSaves(storage).map((save) => save.id)).toEqual([
      backrooms.save.id,
      russian.save.id,
    ]);
    const loadedRussian = loadGameSave(storage, russian.save.id);
    expect(loadedRussian).toMatchObject({
      schemaVersion: 2,
      experienceId: 'russian-stairwell',
    });
    expect(loadedRussian?.payload.quaternion.y).toBeCloseTo(Math.SQRT1_2);
    expect(loadedRussian?.payload.quaternion.w).toBeCloseTo(Math.SQRT1_2);
    expect(loadedRussian?.experienceId === 'russian-stairwell'
      ? loadedRussian.payload.apartmentLightOn
      : undefined).toBe(true);
    expect(loadGameSave(storage, backrooms.save.id)).toMatchObject({
      experienceId: 'backrooms',
      payload: {
        seed: 'TEST-SEED_01',
        chunk: { x: -2, z: 7, story: 1 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
      },
    });
    expect(getGameSaveSummary(backrooms.save)).toEqual({
      id: backrooms.save.id,
      experienceId: 'backrooms',
      kind: 'autosave',
      levelId: 'backrooms-level-0',
      levelLabel: 'Niveau 0',
      savedAt: '2026-08-15T10:05:00.000Z',
      playTimeSeconds: 120,
    });
  });

  it('creates collision-safe ids and keeps one current autosave beside manual saves', () => {
    const storage = new MemoryStorage();
    const sameInstant = new Date('2026-08-15T09:00:00.000Z');
    const first = writeGameSave(storage, russianInput(1), sameInstant);
    const second = writeGameSave(storage, russianInput(2), sameInstant);
    expect(first.ok && second.ok && first.save.id).not.toBe(second.ok && second.save.id);

    for (let index = 0; index < GAME_SAVE_HISTORY_LIMIT + 3; index += 1) {
      expect(writeGameSave(
        storage,
        backroomsInput(100 + index),
        new Date(Date.UTC(2026, 7, 15, 10, index)),
      ).ok).toBe(true);
    }

    const saves = listGameSaves(storage);
    expect(saves).toHaveLength(3);
    expect(saves.filter((save) => save.kind === 'autosave')).toHaveLength(1);
    expect(saves.map((save) => save.playTimeSeconds)).toEqual([114, 2, 1]);

    const manualStorage = new MemoryStorage();
    for (let index = 0; index < GAME_SAVE_HISTORY_LIMIT + 3; index += 1) {
      expect(writeGameSave(
        manualStorage,
        russianInput(index),
        new Date(Date.UTC(2026, 7, 16, 10, index)),
      ).ok).toBe(true);
    }
    expect(listGameSaves(manualStorage).map((save) => save.playTimeSeconds)).toEqual(
      Array.from({ length: GAME_SAVE_HISTORY_LIMIT }, (_, index) => 14 - index),
    );
  });

  it('filters corrupt entries, duplicate ids and malformed history envelopes', () => {
    const storage = new MemoryStorage();
    const valid = writeGameSave(
      storage,
      russianInput(),
      new Date('2026-08-15T10:00:00.000Z'),
    );
    if (!valid.ok) throw new Error('Expected valid save.');
    const stored = JSON.parse(storage.values.get(GAME_SAVE_HISTORY_STORAGE_KEY)!) as {
      schemaVersion: number;
      entries: Array<Record<string, unknown>>;
    };
    stored.entries.push(
      { ...stored.entries[0]!, id: 'duplicate-but-newer', savedAt: 'not-a-date' },
      { ...stored.entries[0]!, extra: true },
      { ...stored.entries[0]! },
      { nope: true },
    );
    storage.setItem(GAME_SAVE_HISTORY_STORAGE_KEY, JSON.stringify(stored));

    expect(listGameSaves(storage)).toEqual([valid.save]);

    storage.setItem(GAME_SAVE_HISTORY_STORAGE_KEY, JSON.stringify({
      schemaVersion: GAME_SAVE_HISTORY_SCHEMA_VERSION,
      entries: stored.entries,
      unexpected: true,
    }));
    expect(listGameSaves(storage)).toEqual([]);
    storage.setItem(GAME_SAVE_HISTORY_STORAGE_KEY, '{broken');
    expect(listGameSaves(storage)).toEqual([]);
  });

  it('keeps old stairwell history entries compatible with lights off by default', () => {
    const storage = new MemoryStorage();
    const written = writeGameSave(
      storage,
      russianInput(),
      new Date('2026-08-15T10:00:00.000Z'),
    );
    if (!written.ok) throw new Error('Expected valid save.');
    const history = JSON.parse(storage.getItem(GAME_SAVE_HISTORY_STORAGE_KEY)!) as {
      entries: Array<{ payload: Record<string, unknown> }>;
    };
    delete history.entries[0]!.payload.apartmentLightOn;
    delete history.entries[0]!.payload.windowBlindsOpen;
    storage.setItem(GAME_SAVE_HISTORY_STORAGE_KEY, JSON.stringify(history));

    expect(listGameSaves(storage)[0]?.payload).toMatchObject({
      apartmentLightOn: false,
      windowBlindsOpen: [true, true],
    });
  });

  it('round-trips the two independent apartment blind states', () => {
    const storage = new MemoryStorage();
    const input = russianInput();
    const written = writeGameSave(storage, {
      ...input,
      payload: { ...input.payload, windowBlindsOpen: [false, true] },
    });

    expect(written.ok).toBe(true);
    expect(listGameSaves(storage)[0]?.payload).toMatchObject({
      windowBlindsOpen: [false, true],
    });
  });

  it.each([
    ['extra input field', { ...russianInput(), extra: true }],
    ['unknown kind', { ...russianInput(), kind: 'quick' }],
    ['empty level id', { ...russianInput(), levelId: '' }],
    ['negative play time', { ...russianInput(), playTimeSeconds: -1 }],
    ['invalid door progress', {
      ...russianInput(),
      payload: { ...russianInput().payload, entranceDoor: { progress: 2, targetProgress: 1 } },
    }],
    ['zero quaternion', {
      ...russianInput(),
      payload: { ...russianInput().payload, quaternion: { x: 0, y: 0, z: 0, w: 0 } },
    }],
    ['unsafe chunk coordinate', {
      ...backroomsInput(),
      payload: {
        ...backroomsInput().payload,
        chunk: { x: Number.MAX_SAFE_INTEGER, z: 0, story: 0 },
      },
    }],
    ['invalid seed', {
      ...backroomsInput(),
      payload: { ...backroomsInput().payload, seed: 'seed with spaces' },
    }],
  ])('rejects an invalid save: %s', (_label, input) => {
    const storage = new MemoryStorage();
    expect(writeGameSave(
      storage,
      input as RussianStairwellGameSaveInput,
      new Date('2026-08-15T10:00:00.000Z'),
    )).toEqual({ ok: false, reason: 'invalid-save' });
    expect(listGameSaves(storage)).toEqual([]);
  });

  it('loads by stable id and removes only the selected entry', () => {
    const storage = new MemoryStorage();
    const first = writeGameSave(storage, russianInput(), new Date('2026-08-15T10:00:00.000Z'));
    const second = writeGameSave(storage, backroomsInput(), new Date('2026-08-15T10:01:00.000Z'));
    if (!first.ok || !second.ok) throw new Error('Expected valid saves.');

    expect(removeGameSave(storage, 'missing')).toEqual({ ok: true, removed: false });
    expect(removeGameSave(storage, first.save.id)).toEqual({ ok: true, removed: true });
    expect(loadGameSave(storage, first.save.id)).toBeNull();
    expect(loadGameSave(storage, second.save.id)).toEqual(second.save);
  });

  it('handles unavailable storage and invalid dates without throwing', () => {
    const throwingStorage: GameSaveStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    expect(listGameSaves(throwingStorage)).toEqual([]);
    expect(writeGameSave(throwingStorage, russianInput())).toEqual({
      ok: false,
      reason: 'storage-error',
    });
    expect(removeGameSave(throwingStorage, 'save-id')).toEqual({
      ok: false,
      reason: 'storage-error',
    });

    const storage = new MemoryStorage();
    expect(writeGameSave(storage, russianInput(), new Date(Number.NaN))).toEqual({
      ok: false,
      reason: 'invalid-save',
    });
  });
});
