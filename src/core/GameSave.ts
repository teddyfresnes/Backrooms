export const GAME_SAVE_STORAGE_KEY = 'backrooms-random-story-russian-stairwell-save-v1';
export const GAME_SAVE_BACKUP_STORAGE_KEY = `${GAME_SAVE_STORAGE_KEY}.backup`;
export const GAME_SAVE_SCHEMA_VERSION = 1 as const;
export const RUSSIAN_STAIRWELL_EXPERIENCE_ID = 'russian-stairwell' as const;
export const RUSSIAN_STAIRWELL_CONTENT_VERSION = 23 as const;

const MAX_POSITION_COORDINATE = 1_000;
const MIN_QUATERNION_LENGTH = 1e-8;

export interface GameSaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface GameSaveVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface GameSaveQuaternion extends GameSaveVec3 {
  readonly w: number;
}

export interface RussianStairwellSaveInput {
  readonly playTimeSeconds: number;
  readonly player: {
    readonly safePosition: Readonly<GameSaveVec3>;
    readonly quaternion: Readonly<GameSaveQuaternion>;
  };
  readonly entranceDoor: {
    readonly progress: number;
    readonly targetProgress: 0 | 1;
  };
}

export interface RussianStairwellSave extends RussianStairwellSaveInput {
  readonly schemaVersion: typeof GAME_SAVE_SCHEMA_VERSION;
  readonly experienceId: typeof RUSSIAN_STAIRWELL_EXPERIENCE_ID;
  readonly contentVersion: typeof RUSSIAN_STAIRWELL_CONTENT_VERSION;
  readonly savedAt: string;
}

export interface RussianStairwellSaveMetadata {
  readonly experienceId: typeof RUSSIAN_STAIRWELL_EXPERIENCE_ID;
  readonly contentVersion: typeof RUSSIAN_STAIRWELL_CONTENT_VERSION;
  readonly savedAt: string;
  readonly playTimeSeconds: number;
}

export type GameSaveWriteResult =
  | { readonly ok: true; readonly save: RussianStairwellSave }
  | { readonly ok: false; readonly reason: 'invalid-save' | 'storage-error' };

export type GameSaveRemoveResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'storage-error' };

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (value: JsonRecord, keys: readonly string[]): boolean => {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const sanitizePosition = (value: unknown): GameSaveVec3 | null => {
  if (!isRecord(value) || !hasExactKeys(value, ['x', 'y', 'z'])) return null;
  const { x, y, z } = value;
  if (![x, y, z].every(isFiniteNumber)) return null;
  if (Math.abs(x as number) > MAX_POSITION_COORDINATE
    || Math.abs(y as number) > MAX_POSITION_COORDINATE
    || Math.abs(z as number) > MAX_POSITION_COORDINATE) return null;
  return Object.freeze({ x: x as number, y: y as number, z: z as number });
};

const sanitizeQuaternion = (value: unknown): GameSaveQuaternion | null => {
  if (!isRecord(value) || !hasExactKeys(value, ['x', 'y', 'z', 'w'])) return null;
  const { x, y, z, w } = value;
  if (![x, y, z, w].every(isFiniteNumber)) return null;

  const length = Math.hypot(x as number, y as number, z as number, w as number);
  if (!Number.isFinite(length) || length < MIN_QUATERNION_LENGTH) return null;

  return Object.freeze({
    x: (x as number) / length,
    y: (y as number) / length,
    z: (z as number) / length,
    w: (w as number) / length,
  });
};

const sanitizeTimestamp = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  try {
    return new Date(parsed).toISOString() === value ? value : null;
  } catch {
    return null;
  }
};

const sanitizeSave = (value: unknown): RussianStairwellSave | null => {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schemaVersion',
    'experienceId',
    'contentVersion',
    'savedAt',
    'playTimeSeconds',
    'player',
    'entranceDoor',
  ])) return null;
  if (value.schemaVersion !== GAME_SAVE_SCHEMA_VERSION
    || value.experienceId !== RUSSIAN_STAIRWELL_EXPERIENCE_ID
    || value.contentVersion !== RUSSIAN_STAIRWELL_CONTENT_VERSION) return null;

  const savedAt = sanitizeTimestamp(value.savedAt);
  if (savedAt === null
    || !isFiniteNumber(value.playTimeSeconds)
    || value.playTimeSeconds < 0
    || value.playTimeSeconds > Number.MAX_SAFE_INTEGER) return null;

  if (!isRecord(value.player)
    || !hasExactKeys(value.player, ['safePosition', 'quaternion'])) return null;
  const safePosition = sanitizePosition(value.player.safePosition);
  const quaternion = sanitizeQuaternion(value.player.quaternion);
  if (safePosition === null || quaternion === null) return null;

  if (!isRecord(value.entranceDoor)
    || !hasExactKeys(value.entranceDoor, ['progress', 'targetProgress'])
    || !isFiniteNumber(value.entranceDoor.progress)
    || value.entranceDoor.progress < 0
    || value.entranceDoor.progress > 1
    || (value.entranceDoor.targetProgress !== 0
      && value.entranceDoor.targetProgress !== 1)) return null;

  return Object.freeze({
    schemaVersion: GAME_SAVE_SCHEMA_VERSION,
    experienceId: RUSSIAN_STAIRWELL_EXPERIENCE_ID,
    contentVersion: RUSSIAN_STAIRWELL_CONTENT_VERSION,
    savedAt,
    playTimeSeconds: value.playTimeSeconds,
    player: Object.freeze({ safePosition, quaternion }),
    entranceDoor: Object.freeze({
      progress: value.entranceDoor.progress,
      targetProgress: value.entranceDoor.targetProgress,
    }),
  });
};

const createSave = (
  input: RussianStairwellSaveInput,
  now: Date,
): RussianStairwellSave | null => {
  try {
    const progress = isFiniteNumber(input.entranceDoor.progress)
      ? Math.min(1, Math.max(0, input.entranceDoor.progress))
      : input.entranceDoor.progress;
    return sanitizeSave({
      schemaVersion: GAME_SAVE_SCHEMA_VERSION,
      experienceId: RUSSIAN_STAIRWELL_EXPERIENCE_ID,
      contentVersion: RUSSIAN_STAIRWELL_CONTENT_VERSION,
      savedAt: now.toISOString(),
      playTimeSeconds: input.playTimeSeconds,
      player: {
        safePosition: {
          x: input.player.safePosition.x,
          y: input.player.safePosition.y,
          z: input.player.safePosition.z,
        },
        quaternion: {
          x: input.player.quaternion.x,
          y: input.player.quaternion.y,
          z: input.player.quaternion.z,
          w: input.player.quaternion.w,
        },
      },
      entranceDoor: {
        progress,
        targetProgress: input.entranceDoor.targetProgress,
      },
    });
  } catch {
    return null;
  }
};

export const saveRussianStairwellGame = (
  storage: GameSaveStorage,
  input: RussianStairwellSaveInput,
  now: Date = new Date(),
): GameSaveWriteResult => {
  const save = createSave(input, now);
  if (save === null) return { ok: false, reason: 'invalid-save' };

  try {
    const primary = loadSaveSlot(storage, GAME_SAVE_STORAGE_KEY);
    const backup = loadSaveSlot(storage, GAME_SAVE_BACKUP_STORAGE_KEY);
    const target = primary === null
      ? GAME_SAVE_STORAGE_KEY
      : backup === null
        ? GAME_SAVE_BACKUP_STORAGE_KEY
        : Date.parse(primary.savedAt) <= Date.parse(backup.savedAt)
          ? GAME_SAVE_STORAGE_KEY
          : GAME_SAVE_BACKUP_STORAGE_KEY;
    // Only replace the older slot. A failed write therefore leaves the most
    // recent valid snapshot untouched, while the next successful write heals
    // a corrupt or missing slot.
    storage.setItem(target, JSON.stringify(save));
    return { ok: true, save };
  } catch {
    return { ok: false, reason: 'storage-error' };
  }
};

const loadSaveSlot = (
  storage: GameSaveStorage,
  key: string,
): RussianStairwellSave | null => {
  try {
    const serialized = storage.getItem(key);
    if (serialized === null) return null;
    return sanitizeSave(JSON.parse(serialized) as unknown);
  } catch {
    return null;
  }
};

export const loadRussianStairwellGame = (
  storage: GameSaveStorage,
): RussianStairwellSave | null => {
  const primary = loadSaveSlot(storage, GAME_SAVE_STORAGE_KEY);
  const backup = loadSaveSlot(storage, GAME_SAVE_BACKUP_STORAGE_KEY);
  if (primary === null) return backup;
  if (backup === null) return primary;
  return Date.parse(primary.savedAt) >= Date.parse(backup.savedAt) ? primary : backup;
};

export const removeRussianStairwellGame = (
  storage: GameSaveStorage,
): GameSaveRemoveResult => {
  let failed = false;
  for (const key of [GAME_SAVE_STORAGE_KEY, GAME_SAVE_BACKUP_STORAGE_KEY]) {
    try {
      storage.removeItem(key);
    } catch {
      failed = true;
    }
  }
  return failed ? { ok: false, reason: 'storage-error' } : { ok: true };
};

export const getRussianStairwellSaveMetadata = (
  save: RussianStairwellSave,
): RussianStairwellSaveMetadata => Object.freeze({
  experienceId: save.experienceId,
  contentVersion: save.contentVersion,
  savedAt: save.savedAt,
  playTimeSeconds: save.playTimeSeconds,
});

export const loadRussianStairwellSaveMetadata = (
  storage: GameSaveStorage,
): RussianStairwellSaveMetadata | null => {
  const save = loadRussianStairwellGame(storage);
  return save === null ? null : getRussianStairwellSaveMetadata(save);
};
