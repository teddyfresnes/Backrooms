/** Network-only preparation during the photographic prologue. No Three scene,
 * texture decode, Rapier mount or second renderer runs under the photographs. */
const ENTRY_ASSETS = [
  '/assets/character/character.fbx',
  '/assets/character-motion.bin',
  '/assets/cinematics/entry-motion.bin',
  '/assets/mpfb/base.runtime.json.gz',
  '/assets/characters/assets-manifest.json',
  '/assets/stairwell-hall-door/double_doors_with_windows.glb',
  '/assets/stairwell-mailbox/old_soviet_mailbox.glb',
  '/assets/stairwell-window/window.glb',
] as const;

/** Warms the HTTP cache with low-priority fetches. `<link rel="preload">` did
 * the same but Firefox warned for every file not consumed within seconds,
 * which is by design here: they are used only after the photographs. */
export function preloadEntryAssets(): () => void {
  const abort = new AbortController();
  for (const href of ENTRY_ASSETS) {
    void fetch(href, { signal: abort.signal, priority: 'low' } as RequestInit)
      .then(response => response.ok ? response.blob() : undefined)
      .catch(() => undefined);
  }
  return () => abort.abort();
}
