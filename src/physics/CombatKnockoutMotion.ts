/** A brief impact contraction, followed by loss of muscle tone. */
export function combatKnockoutEnvelope(elapsed: number): number {
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= .36) return 0;
  const rise = Math.min(1, elapsed / .028);
  const release = Math.min(1, Math.max(0, (.36 - elapsed) / .25));
  return rise * rise * (3 - 2 * rise) * release * release * (3 - 2 * release);
}
