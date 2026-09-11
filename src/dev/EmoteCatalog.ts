export const EMOTES = [
  { id: 'emote-greeting', label: 'Saluer', file: 'greeting', mode: 'once', sample: .28 },
  { id: 'emote-clapping', label: 'Applaudir', file: 'clapping', mode: 'loop', sample: .35 },
  { id: 'emote-pointing', label: 'Pointer', file: 'pointing', mode: 'once', sample: .45 },
  { id: 'emote-salute', label: 'Salut militaire', file: 'salute', mode: 'once', sample: .38 },
  { id: 'emote-hip-hop', label: 'Hip-hop', file: 'hip-hop', mode: 'loop', sample: .3 },
  { id: 'emote-wave', label: 'Vague', file: 'wave', mode: 'loop', sample: .42 },
  { id: 'emote-freeze', label: 'Freeze', file: 'freeze', mode: 'hold', sample: .6 },
  { id: 'emote-sweat', label: 'S’essuyer le front', file: 'sweat', mode: 'once', sample: .45 },
  { id: 'emote-laying', label: 'S’allonger', file: 'laying', mode: 'hold', sample: .5 },
  { id: 'emote-kip-up', label: 'Kip-up', file: 'kip-up', mode: 'once', sample: .35 },
] as const;

export type Emote = typeof EMOTES[number];
export type EmoteId = Emote['id'];
export const EMOTE_SLOTS = 8;
export const EMOTE_STORAGE_KEY = 'backrooms.emote-favorites.v1';

export function loadEmoteFavorites(): (EmoteId | null)[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(EMOTE_STORAGE_KEY) ?? 'null');
    if (Array.isArray(saved)) {
      const seen = new Set<string>();
      return Array.from({ length: EMOTE_SLOTS }, (_, i) => {
        const id: unknown = saved[i];
        if (!EMOTES.some(emote => emote.id === id) || seen.has(id as string)) return null;
        seen.add(id as string);
        return id as EmoteId;
      });
    }
  } catch { /* Storage can be unavailable; the wheel remains usable. */ }
  return EMOTES.slice(0, EMOTE_SLOTS).map(emote => emote.id);
}
