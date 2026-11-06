import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  GAME_SAVE_SCHEMA_VERSION,
  GAME_SAVE_BACKUP_STORAGE_KEY,
  GAME_SAVE_STORAGE_KEY,
  RUSSIAN_STAIRWELL_CONTENT_VERSION,
  RUSSIAN_STAIRWELL_EXPERIENCE_ID,
  getRussianStairwellSaveMetadata,
  loadRussianStairwellGame,
  loadRussianStairwellSaveMetadata,
  removeRussianStairwellGame,
  saveRussianStairwellGame,
  type GameSaveStorage,
  type RussianStairwellSaveInput,
} from './GameSave';

class MemoryStorage implements GameSaveStorage {
  readonly values = new Map<string, string>();
  failWrites = false;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('quota exceeded');
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const validInput = (): RussianStairwellSaveInput => ({
  playTimeSeconds: 83.25,
  player: {
    safePosition: { x: 12, y: 4.2, z: -19 },
    quaternion: { x: 0, y: 0.5, z: 0, w: 0.5 },
  },
  entranceDoor: { progress: 0.4, targetProgress: 1 },
});

const makeStoredSave = (): Record<string, unknown> => ({
  schemaVersion: GAME_SAVE_SCHEMA_VERSION,
  experienceId: RUSSIAN_STAIRWELL_EXPERIENCE_ID,
  contentVersion: RUSSIAN_STAIRWELL_CONTENT_VERSION,
  savedAt: '2026-08-13T12:34:56.000Z',
  playTimeSeconds: 83.25,
  player: {
    safePosition: { x: 12, y: 4.2, z: -19 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
  },
  entranceDoor: { progress: 0.4, targetProgress: 1 },
});

const storeRaw = (storage: MemoryStorage, value: unknown): void => {
  storage.setItem(GAME_SAVE_STORAGE_KEY, JSON.stringify(value));
};

describe('Russian Stairwells game saves', () => {
  it('round-trips a versioned snapshot and normalizes copied state', () => {
    const storage = new MemoryStorage();
    const input = validInput();
    const result = saveRussianStairwellGame(
      storage,
      input,
      new Date('2026-08-13T12:34:56.000Z'),
    );

    expect(result.ok).toBe(true);
    const loaded = loadRussianStairwellGame(storage);
    expect(loaded).toMatchObject({
      schemaVersion: 1,
      experienceId: 'russian-stairwell',
      contentVersion: 23,
      savedAt: '2026-08-13T12:34:56.000Z',
      playTimeSeconds: 83.25,
      player: {
        safePosition: { x: 12, y: 4.2, z: -19 },
      },
      entranceDoor: { progress: 0.4, targetProgress: 1 },
    });
    expect(loaded?.player.quaternion.x).toBe(0);
    expect(loaded?.player.quaternion.y).toBeCloseTo(Math.SQRT1_2, 12);
    expect(loaded?.player.quaternion.z).toBe(0);
    expect(loaded?.player.quaternion.w).toBeCloseTo(Math.SQRT1_2, 12);
    expect(loaded?.player.safePosition).not.toBe(input.player.safePosition);
    expect(Object.isFrozen(loaded?.player.quaternion)).toBe(true);
    expect(storage.values.has('backrooms-random-story-settings-v1')).toBe(false);
  });

  it('serializes real Three.js vectors and quaternions through the strict envelope', () => {
    const storage = new MemoryStorage();
    const result = saveRussianStairwellGame(storage, {
      ...validInput(),
      player: {
        safePosition: new THREE.Vector3(2, 6.625, -3),
        quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.4, 0)),
      },
    });

    expect(result.ok).toBe(true);
    expect(loadRussianStairwellGame(storage)?.player.safePosition).toEqual({
      x: 2,
      y: 6.625,
      z: -3,
    });
    expect(loadRussianStairwellGame(storage)?.player.quaternion).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
      z: expect.any(Number),
      w: expect.any(Number),
    });
  });

  it('bounds door progress when writing while preserving an exact target', () => {
    const storage = new MemoryStorage();
    const input = validInput();
    const result = saveRussianStairwellGame(storage, {
      ...input,
      entranceDoor: { progress: 12, targetProgress: 0 },
    });

    expect(result.ok).toBe(true);
    expect(loadRussianStairwellGame(storage)?.entranceDoor).toEqual({
      progress: 1,
      targetProgress: 0,
    });
  });

  it('returns null when no save exists', () => {
    const storage = new MemoryStorage();
    expect(loadRussianStairwellGame(storage)).toBeNull();
    expect(loadRussianStairwellSaveMetadata(storage)).toBeNull();
  });

  it('rotates two snapshots and falls back when the newest slot is corrupt', () => {
    const storage = new MemoryStorage();
    expect(saveRussianStairwellGame(
      storage,
      { ...validInput(), playTimeSeconds: 10 },
      new Date('2026-08-13T12:00:00.000Z'),
    ).ok).toBe(true);
    expect(saveRussianStairwellGame(
      storage,
      { ...validInput(), playTimeSeconds: 20 },
      new Date('2026-08-13T12:01:00.000Z'),
    ).ok).toBe(true);

    expect(loadRussianStairwellGame(storage)?.playTimeSeconds).toBe(20);
    storage.setItem(GAME_SAVE_BACKUP_STORAGE_KEY, '{interrupted');
    expect(loadRussianStairwellGame(storage)?.playTimeSeconds).toBe(10);

    expect(saveRussianStairwellGame(
      storage,
      { ...validInput(), playTimeSeconds: 30 },
      new Date('2026-08-13T12:02:00.000Z'),
    ).ok).toBe(true);
    expect(loadRussianStairwellGame(storage)?.playTimeSeconds).toBe(30);
  });

  it('keeps the last valid snapshot when a later write is interrupted', () => {
    const storage = new MemoryStorage();
    expect(saveRussianStairwellGame(
      storage,
      { ...validInput(), playTimeSeconds: 10 },
      new Date('2026-08-13T12:00:00.000Z'),
    ).ok).toBe(true);

    storage.failWrites = true;
    expect(saveRussianStairwellGame(
      storage,
      { ...validInput(), playTimeSeconds: 20 },
      new Date('2026-08-13T12:01:00.000Z'),
    )).toEqual({ ok: false, reason: 'storage-error' });
    storage.failWrites = false;

    expect(loadRussianStairwellGame(storage)?.playTimeSeconds).toBe(10);
  });

  it.each(['{broken', 'null', '[]', '"save"'])(
    'rejects corrupt or structurally invalid JSON: %s',
    (serialized) => {
      const storage = new MemoryStorage();
      storage.setItem(GAME_SAVE_STORAGE_KEY, serialized);
      expect(loadRussianStairwellGame(storage)).toBeNull();
    },
  );

  it.each([
    ['schema version', (save: Record<string, unknown>) => { save.schemaVersion = 2; }],
    ['experience mode', (save: Record<string, unknown>) => { save.experienceId = 'backrooms'; }],
    ['content version', (save: Record<string, unknown>) => { save.contentVersion = 22; }],
  ] as const)('rejects an unknown %s', (_label, mutate) => {
    const storage = new MemoryStorage();
    const save = makeStoredSave();
    mutate(save);
    storeRaw(storage, save);
    expect(loadRussianStairwellGame(storage)).toBeNull();
  });

  it.each([
    ['non-finite play time', (save: Record<string, any>) => { save.playTimeSeconds = 1e999; }],
    ['negative play time', (save: Record<string, any>) => { save.playTimeSeconds = -1; }],
    ['absurd coordinate', (save: Record<string, any>) => { save.player.safePosition.x = 1_001; }],
    ['non-finite coordinate', (save: Record<string, any>) => { save.player.safePosition.y = 1e999; }],
    ['degenerate quaternion', (save: Record<string, any>) => {
      save.player.quaternion = { x: 0, y: 0, z: 0, w: 0 };
    }],
    ['invalid timestamp', (save: Record<string, any>) => { save.savedAt = 'yesterday'; }],
    ['non-canonical timestamp', (save: Record<string, any>) => {
      save.savedAt = '2026-08-13T12:34:56Z';
    }],
    ['out-of-range door progress', (save: Record<string, any>) => {
      save.entranceDoor.progress = 1.01;
    }],
    ['unknown door target', (save: Record<string, any>) => {
      save.entranceDoor.targetProgress = 0.5;
    }],
  ] as const)('rejects %s', (_label, mutate) => {
    const storage = new MemoryStorage();
    const save = makeStoredSave();
    mutate(save);
    storeRaw(storage, save);
    expect(loadRussianStairwellGame(storage)).toBeNull();
  });

  it('rejects extra fields rather than silently accepting another schema', () => {
    const storage = new MemoryStorage();
    storeRaw(storage, { ...makeStoredSave(), mode: 'unknown' });
    expect(loadRussianStairwellGame(storage)).toBeNull();
  });

  it('returns explicit failures when storage or input fails', () => {
    const throwingStorage: GameSaveStorage = {
      getItem: () => { throw new Error('read denied'); },
      setItem: () => { throw new Error('write denied'); },
      removeItem: () => { throw new Error('remove denied'); },
    };

    expect(loadRussianStairwellGame(throwingStorage)).toBeNull();
    expect(saveRussianStairwellGame(throwingStorage, validInput())).toEqual({
      ok: false,
      reason: 'storage-error',
    });
    expect(removeRussianStairwellGame(throwingStorage)).toEqual({
      ok: false,
      reason: 'storage-error',
    });

    const storage = new MemoryStorage();
    expect(saveRussianStairwellGame(storage, {
      ...validInput(),
      player: {
        ...validInput().player,
        quaternion: { x: 0, y: 0, z: 0, w: 0 },
      },
    })).toEqual({ ok: false, reason: 'invalid-save' });
    expect(storage.values.size).toBe(0);
  });

  it('removes a save and exposes compact metadata for the home screen', () => {
    const storage = new MemoryStorage();
    const result = saveRussianStairwellGame(
      storage,
      validInput(),
      new Date('2026-08-13T12:34:56.000Z'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const expected = {
      experienceId: 'russian-stairwell',
      contentVersion: 23,
      savedAt: '2026-08-13T12:34:56.000Z',
      playTimeSeconds: 83.25,
    };
    expect(getRussianStairwellSaveMetadata(result.save)).toEqual(expected);
    expect(loadRussianStairwellSaveMetadata(storage)).toEqual(expected);
    expect(removeRussianStairwellGame(storage)).toEqual({ ok: true });
    expect(loadRussianStairwellGame(storage)).toBeNull();
    expect(storage.values.has(GAME_SAVE_STORAGE_KEY)).toBe(false);
    expect(storage.values.has(GAME_SAVE_BACKUP_STORAGE_KEY)).toBe(false);
  });
});
