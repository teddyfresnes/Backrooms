export const EMOTES = [
  { id: 'emote-greeting', label: 'Saluer', file: 'greeting', mode: 'once', sample: .28 },
  { id: 'emote-clapping', label: 'Applaudir', file: 'clapping', mode: 'loop', sample: .35 },
  { id: 'emote-pointing', label: 'Pointer', file: 'pointing', mode: 'once', sample: .45 },
  { id: 'emote-salute', label: 'Salut militaire', file: 'salute', mode: 'once', sample: .38 },
  { id: 'emote-hip-hop', label: 'Hip-hop', file: 'hip-hop', mode: 'loop', sample: .3 },
  { id: 'emote-wave', label: 'Vague', file: 'wave', mode: 'loop', sample: .42 },
  { id: 'emote-freeze', label: 'Freeze', file: 'freeze', mode: 'once', sample: .6 },
  { id: 'emote-sweat', label: 'S’essuyer le front', file: 'sweat', mode: 'once', sample: .45 },
  { id: 'emote-laying', label: 'S’allonger', file: 'laying', mode: 'hold', sample: .5 },
  { id: 'emote-kip-up', label: 'Kip-up', file: 'kip-up', mode: 'once', sample: .35 },
  { id: 'emote-middle-finger', label: 'Doigt d’honneur', file: 'middle-finger', icon: 'middle-finger.svg', gesture: 'middle-finger', mode: 'once', sample: .4 },
  { id: 'emote-follow-me', label: 'Suis-moi', file: 'follow-me', icon: 'follow-me.svg', gesture: 'follow-me', mode: 'once', sample: .4 },
  { id: 'emote-wait', label: 'Attends', file: 'wait', icon: 'wait.svg', gesture: 'wait', mode: 'once', sample: .4 },
] as const;

export type EmotePosture = 'standing' | 'ground';
export const getEmotePosture = (id: EmoteId): EmotePosture =>
  id === 'emote-laying' || id === 'emote-kip-up' ? 'ground' : 'standing';
export type Emote = typeof EMOTES[number];
export type EmoteId = Emote['id'];
export const EMOTE_SLOTS = 8;
export const EMOTE_STORAGE_KEY = 'backrooms.emote-favorites.v1';
export const GROUND_EMOTE_STORAGE_KEY = 'backrooms.ground-emote-favorites.v1';

export function loadEmoteFavorites(posture: EmotePosture = 'standing'): (EmoteId | null)[] {
  const entries = EMOTES.filter(emote => getEmotePosture(emote.id) === posture);
  const slots = posture === 'ground' ? entries.length : EMOTE_SLOTS;
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(posture === 'ground' ? GROUND_EMOTE_STORAGE_KEY : EMOTE_STORAGE_KEY) ?? 'null');
    if (Array.isArray(saved)) {
      const seen = new Set<string>();
      return Array.from({ length: slots }, (_, i) => {
        const id: unknown = saved[i];
        if (!entries.some(emote => emote.id === id) || seen.has(id as string)) return null;
        seen.add(id as string);
        return id as EmoteId;
      });
    }
  } catch { /* Storage can be unavailable; the wheel remains usable. */ }
  return entries.slice(0, slots).map(emote => emote.id);
}
