import type {
  GameSaveQuaternion,
  GameSaveStorage,
  GameSaveVec3,
} from './GameSave';

export type { GameSaveQuaternion, GameSaveStorage, GameSaveVec3 } from './GameSave';

export const GAME_SAVE_HISTORY_STORAGE_KEY = 'backrooms-random-story-save-history-v2';
export const GAME_SAVE_HISTORY_SCHEMA_VERSION = 2 as const;
export const GAME_SAVE_HISTORY_LIMIT = 12;
export const MAX_GAME_SAVE_HISTORY_ENTRIES = GAME_SAVE_HISTORY_LIMIT;

export type GameSaveKind = 'manual' | 'autosave';
export type GameSaveExperienceId = 'russian-stairwell' | 'backrooms';

export interface GameSaveDoorState {
  readonly progress: number;
  readonly targetProgress: 0 | 1;
}

export interface RussianStairwellSavePayload {
  readonly safePosition: Readonly<GameSaveVec3>;
  readonly quaternion: Readonly<GameSaveQuaternion>;
  readonly entranceDoor: Readonly<GameSaveDoorState>;
}

export interface BackroomsSavePayload {
  readonly seed: string;
  readonly chunk: {
    readonly x: number;
    readonly z: number;
    readonly story: number;
  };
  readonly localPosition: Readonly<GameSaveVec3>;
  readonly quaternion: Readonly<GameSaveQuaternion>;
}

interface GameSaveInputBase {
  readonly kind: GameSaveKind;
  readonly levelId: string;
  readonly levelLabel: string;
  readonly playTimeSeconds: number;
}

export interface RussianStairwellGameSaveInput extends GameSaveInputBase {
  readonly experienceId: 'russian-stairwell';
  readonly payload: RussianStairwellSavePayload;
}

export interface BackroomsGameSaveInput extends GameSaveInputBase {
  readonly experienceId: 'backrooms';
  readonly payload: BackroomsSavePayload;
}

export type GameSaveInput = RussianStairwellGameSaveInput | BackroomsGameSaveInput;

interface GameSaveEntryBase extends GameSaveInputBase {
  readonly schemaVersion: typeof GAME_SAVE_HISTORY_SCHEMA_VERSION;
  readonly id: string;
  readonly savedAt: string;
}

export interface RussianStairwellGameSave extends GameSaveEntryBase {
  readonly experienceId: 'russian-stairwell';
  readonly payload: RussianStairwellSavePayload;
}

export interface BackroomsGameSave extends GameSaveEntryBase {
  readonly experienceId: 'backrooms';
  readonly payload: BackroomsSavePayload;
}

export type GameSaveEntry = RussianStairwellGameSave | BackroomsGameSave;

export interface GameSaveSummary {
  readonly id: string;
  readonly experienceId: GameSaveExperienceId;
  readonly kind: GameSaveKind;
  readonly levelId: string;
  readonly levelLabel: string;
  readonly savedAt: string;
  readonly playTimeSeconds: number;
}

export type WriteGameSaveResult =
  | { readonly ok: true; readonly save: GameSaveEntry }
  | { readonly ok: false; readonly reason: 'invalid-save' | 'storage-error' };

export type RemoveGameSaveResult =
  | { readonly ok: true; readonly removed: boolean }
  | { readonly ok: false; readonly reason: 'storage-error' };

export type GameSaveWriteResult = WriteGameSaveResult;
export type GameSaveRemoveResult = RemoveGameSaveResult;

interface StoredGameSaveHistory {
  readonly schemaVersion: typeof GAME_SAVE_HISTORY_SCHEMA_VERSION;
  readonly entries: readonly GameSaveEntry[];
}

type JsonRecord = Record<string, unknown>;

const ENTRY_KEYS = [
  'schemaVersion',
  'id',
  'experienceId',
  'kind',
  'levelId',
  'levelLabel',
  'savedAt',
  'playTimeSeconds',
  'payload',
] as const;
const INPUT_KEYS = [
  'experienceId',
  'kind',
  'levelId',
  'levelLabel',
  'playTimeSeconds',
  'payload',
] as const;
const MAX_POSITION_COORDINATE = 1_000_000;
const MAX_CHUNK_COORDINATE = 1_000_000;
const MAX_LEVEL_ID_LENGTH = 96;
const MAX_LEVEL_LABEL_LENGTH = 160;
const MAX_SAVE_ID_LENGTH = 128;
const MAX_SEED_LENGTH = 64;
const MIN_QUATERNION_LENGTH = 1e-8;

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
  if (
    Math.abs(x as number) > MAX_POSITION_COORDINATE
    || Math.abs(y as number) > MAX_POSITION_COORDINATE
    || Math.abs(z as number) > MAX_POSITION_COORDINATE
  ) return null;
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

const sanitizeLevelId = (value: unknown): string | null => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_LEVEL_ID_LENGTH
    || value.trim() !== value
    || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(value)
  ) return null;
  return value;
};

const sanitizeLevelLabel = (value: unknown): string | null => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_LEVEL_LABEL_LENGTH
    || value.trim() !== value
  ) return null;
  return value;
};

const sanitizeSaveId = (value: unknown): string | null => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_SAVE_ID_LENGTH
    || !/^[a-zA-Z0-9._:-]+$/.test(value)
  ) return null;
  return value;
};

const sanitizePlayTime = (value: unknown): number | null =>
  isFiniteNumber(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : null;

const sanitizeDoorState = (value: unknown): GameSaveDoorState | null => {
  if (!isRecord(value) || !hasExactKeys(value, ['progress', 'targetProgress'])) return null;
  if (
    !isFiniteNumber(value.progress)
    || value.progress < 0
    || value.progress > 1
    || (value.targetProgress !== 0 && value.targetProgress !== 1)
  ) return null;
  return Object.freeze({
    progress: value.progress,
    targetProgress: value.targetProgress,
  });
};

const sanitizeRussianPayload = (value: unknown): RussianStairwellSavePayload | null => {
  if (!isRecord(value) || !hasExactKeys(value, ['safePosition', 'quaternion', 'entranceDoor'])) {
    return null;
  }
  const safePosition = sanitizePosition(value.safePosition);
  const quaternion = sanitizeQuaternion(value.quaternion);
  const entranceDoor = sanitizeDoorState(value.entranceDoor);
  if (!safePosition || !quaternion || !entranceDoor) return null;
  return Object.freeze({ safePosition, quaternion, entranceDoor });
};

const sanitizeChunk = (value: unknown): BackroomsSavePayload['chunk'] | null => {
  if (!isRecord(value) || !hasExactKeys(value, ['x', 'z', 'story'])) return null;
  const { x, z, story } = value;
  if (![x, z, story].every((coordinate) =>
    Number.isSafeInteger(coordinate)
    && Math.abs(coordinate as number) <= MAX_CHUNK_COORDINATE)) return null;
  return Object.freeze({ x: x as number, z: z as number, story: story as number });
};

const sanitizeBackroomsPayload = (value: unknown): BackroomsSavePayload | null => {
  if (!isRecord(value) || !hasExactKeys(value, ['seed', 'chunk', 'localPosition', 'quaternion'])) {
    return null;
  }
  if (
    typeof value.seed !== 'string'
    || value.seed.length === 0
    || value.seed.length > MAX_SEED_LENGTH
    || value.seed.trim() !== value.seed
    || !/^[a-zA-Z0-9_-]+$/.test(value.seed)
  ) return null;
  const chunk = sanitizeChunk(value.chunk);
  const localPosition = sanitizePosition(value.localPosition);
  const quaternion = sanitizeQuaternion(value.quaternion);
  if (!chunk || !localPosition || !quaternion) return null;
  return Object.freeze({ seed: value.seed, chunk, localPosition, quaternion });
};

const sanitizeEntry = (value: unknown): GameSaveEntry | null => {
  if (!isRecord(value) || !hasExactKeys(value, ENTRY_KEYS)) return null;
  if (value.schemaVersion !== GAME_SAVE_HISTORY_SCHEMA_VERSION) return null;
  const id = sanitizeSaveId(value.id);
  const savedAt = sanitizeTimestamp(value.savedAt);
  const levelId = sanitizeLevelId(value.levelId);
  const levelLabel = sanitizeLevelLabel(value.levelLabel);
  const playTimeSeconds = sanitizePlayTime(value.playTimeSeconds);
  const kind = value.kind === 'manual' || value.kind === 'autosave' ? value.kind : null;
  if (!id || !savedAt || !levelId || !levelLabel || playTimeSeconds === null || !kind) return null;

  if (value.experienceId === 'russian-stairwell') {
    const payload = sanitizeRussianPayload(value.payload);
    if (!payload) return null;
    return Object.freeze({
      schemaVersion: GAME_SAVE_HISTORY_SCHEMA_VERSION,
      id,
      experienceId: 'russian-stairwell',
      kind,
      levelId,
      levelLabel,
      savedAt,
      playTimeSeconds,
      payload,
    });
  }
  if (value.experienceId === 'backrooms') {
    const payload = sanitizeBackroomsPayload(value.payload);
    if (!payload) return null;
    return Object.freeze({
      schemaVersion: GAME_SAVE_HISTORY_SCHEMA_VERSION,
      id,
      experienceId: 'backrooms',
      kind,
      levelId,
      levelLabel,
      savedAt,
      playTimeSeconds,
      payload,
    });
  }
  return null;
};

const sortAndLimitEntries = (entries: readonly GameSaveEntry[]): GameSaveEntry[] => {
  const sorted = [...entries].sort((left, right) => {
    const byDate = Date.parse(right.savedAt) - Date.parse(left.savedAt);
    return byDate !== 0 ? byDate : right.id.localeCompare(left.id);
  });
  const seen = new Set<string>();
  const result: GameSaveEntry[] = [];
  for (const entry of sorted) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    result.push(entry);
    if (result.length === GAME_SAVE_HISTORY_LIMIT) break;
  }
  return result;
};

const parseHistory = (serialized: string | null): GameSaveEntry[] => {
  if (serialized === null) return [];
  try {
    const value = JSON.parse(serialized) as unknown;
    if (!isRecord(value) || !hasExactKeys(value, ['schemaVersion', 'entries'])) return [];
    if (value.schemaVersion !== GAME_SAVE_HISTORY_SCHEMA_VERSION || !Array.isArray(value.entries)) return [];
    return sortAndLimitEntries(value.entries
      .map((entry) => sanitizeEntry(entry))
      .filter((entry): entry is GameSaveEntry => entry !== null));
  } catch {
    return [];
  }
};

const readHistory = (
  storage: GameSaveStorage,
): { readonly ok: true; readonly entries: GameSaveEntry[] } | { readonly ok: false } => {
  try {
    return { ok: true, entries: parseHistory(storage.getItem(GAME_SAVE_HISTORY_STORAGE_KEY)) };
  } catch {
    return { ok: false };
  }
};

const writeHistory = (storage: GameSaveStorage, entries: readonly GameSaveEntry[]): boolean => {
  const history: StoredGameSaveHistory = {
    schemaVersion: GAME_SAVE_HISTORY_SCHEMA_VERSION,
    entries: sortAndLimitEntries(entries),
  };
  try {
    storage.setItem(GAME_SAVE_HISTORY_STORAGE_KEY, JSON.stringify(history));
    return true;
  } catch {
    return false;
  }
};

const createSaveId = (savedAt: string, entries: readonly GameSaveEntry[]): string => {
  const timestamp = Date.parse(savedAt);
  const encodedTimestamp = timestamp < 0
    ? `n${Math.abs(timestamp).toString(36)}`
    : timestamp.toString(36);
  const prefix = `save-${encodedTimestamp}-`;
  const ids = new Set(entries.map((entry) => entry.id));
  let sequence = 0;
  let candidate = `${prefix}${sequence.toString(36).padStart(2, '0')}`;
  while (ids.has(candidate)) {
    sequence += 1;
    candidate = `${prefix}${sequence.toString(36).padStart(2, '0')}`;
  }
  return candidate;
};

const createEntry = (
  input: GameSaveInput,
  savedAt: string,
  id: string,
): GameSaveEntry | null => {
  if (!isRecord(input) || !hasExactKeys(input, INPUT_KEYS)) return null;
  return sanitizeEntry({
    schemaVersion: GAME_SAVE_HISTORY_SCHEMA_VERSION,
    id,
    experienceId: input.experienceId,
    kind: input.kind,
    levelId: input.levelId,
    levelLabel: input.levelLabel,
    savedAt,
    playTimeSeconds: input.playTimeSeconds,
    payload: input.payload,
  });
};

export const writeGameSave = (
  storage: GameSaveStorage,
  input: GameSaveInput,
  now: Date = new Date(),
): WriteGameSaveResult => {
  let savedAt: string;
  try {
    savedAt = now.toISOString();
  } catch {
    return { ok: false, reason: 'invalid-save' };
  }
  if (!createEntry(input, savedAt, 'save-validation-00')) {
    return { ok: false, reason: 'invalid-save' };
  }
  const history = readHistory(storage);
  if (!history.ok) return { ok: false, reason: 'storage-error' };
  const entry = createEntry(input, savedAt, createSaveId(savedAt, history.entries));
  if (!entry) return { ok: false, reason: 'invalid-save' };
  if (!writeHistory(storage, [entry, ...history.entries])) {
    return { ok: false, reason: 'storage-error' };
  }
  return { ok: true, save: entry };
};

export const listGameSaves = (storage: GameSaveStorage): readonly GameSaveEntry[] => {
  const history = readHistory(storage);
  return Object.freeze(history.ok ? history.entries : []);
};

export const loadGameSave = (
  storage: GameSaveStorage,
  id: string,
): GameSaveEntry | null => listGameSaves(storage).find((entry) => entry.id === id) ?? null;

export const removeGameSave = (
  storage: GameSaveStorage,
  id: string,
): RemoveGameSaveResult => {
  const history = readHistory(storage);
  if (!history.ok) return { ok: false, reason: 'storage-error' };
  const remaining = history.entries.filter((entry) => entry.id !== id);
  if (remaining.length === history.entries.length) return { ok: true, removed: false };
  if (!writeHistory(storage, remaining)) return { ok: false, reason: 'storage-error' };
  return { ok: true, removed: true };
};

export const getGameSaveSummary = (entry: GameSaveEntry): GameSaveSummary => Object.freeze({
  id: entry.id,
  experienceId: entry.experienceId,
  kind: entry.kind,
  levelId: entry.levelId,
  levelLabel: entry.levelLabel,
  savedAt: entry.savedAt,
  playTimeSeconds: entry.playTimeSeconds,
});
