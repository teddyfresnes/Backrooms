/**
 * Serializable progress of the walk to the rift. Kept free of world imports:
 * SaveHistory (loaded by the launcher) depends on it.
 */
export type RiftStage = 'arrival' | 'north' | 'plank' | 'crossed' | 'done';
export interface RiftProgress {
  readonly version: 1;
  readonly stage: RiftStage;
  /** Where the plank lies once the player has been shown it. */
  readonly plank?: { readonly lane: number; readonly story: number; readonly bank: 1 | -1 };
  readonly resolution?: 'dropped' | 'fled';
  /** Time spent on the far bank before the creature reveal. */
  readonly crossedSeconds?: number;
  /** Narration lines already spoken (ids), never replayed after loading. */
  readonly spoken: readonly string[];
}

export const freshRiftProgress = (stage: RiftStage = 'arrival'): RiftProgress =>
  ({ version: 1, stage, spoken: [] });

const STAGES: readonly RiftStage[] = ['arrival', 'north', 'plank', 'crossed', 'done'];

export const sanitizeRiftProgress = (value: unknown): RiftProgress | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<RiftProgress>;
  if (raw.version !== 1 || !STAGES.includes(raw.stage as RiftStage)) return null;
  if (!Array.isArray(raw.spoken) || raw.spoken.length > 64
    || !raw.spoken.every((id) => typeof id === 'string' && /^[a-zA-Z0-9-]{1,40}$/.test(id))) return null;
  let plank: RiftProgress['plank'];
  if (raw.plank !== undefined) {
    const p = raw.plank as Partial<NonNullable<RiftProgress['plank']>> | null;
    if (!p || typeof p !== 'object' || !Number.isSafeInteger(p.lane) || Math.abs(p.lane!) > 1e7
      || !Number.isSafeInteger(p.story) || Math.abs(p.story!) > 1e6 || (p.bank !== 1 && p.bank !== -1)) return null;
    plank = { lane: p.lane!, story: p.story!, bank: p.bank };
  }
  if ((raw.stage === 'plank' || raw.stage === 'crossed') && !plank) return null;
  if (raw.crossedSeconds !== undefined && (raw.stage !== 'crossed' || !Number.isFinite(raw.crossedSeconds)
    || raw.crossedSeconds < 0 || raw.crossedSeconds > 7.1)) return null;
  if (raw.resolution !== undefined && raw.resolution !== 'dropped' && raw.resolution !== 'fled') return null;
  return {
    version: 1, stage: raw.stage as RiftStage, spoken: [...raw.spoken],
    ...(plank ? { plank } : {}), ...(raw.resolution ? { resolution: raw.resolution } : {}),
    ...(raw.crossedSeconds !== undefined ? { crossedSeconds: raw.crossedSeconds } : {}),
  };
};
