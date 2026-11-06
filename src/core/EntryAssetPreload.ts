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

export function preloadEntryAssets(): () => void {
  const links = ENTRY_ASSETS.map(href => {
    const link = document.createElement('link');
    link.rel = 'preload'; link.as = 'fetch'; link.fetchPriority = 'low'; link.crossOrigin = 'anonymous'; link.href = href;
    document.head.append(link); return link;
  });
  return () => links.forEach(link => link.remove());
}
