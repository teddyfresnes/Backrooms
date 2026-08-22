export function audioGainFromSetting(volume: number): number {
  const normalized = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0.6));
  if (normalized === 0) return 0;
  return normalized ** 0.62;
}
