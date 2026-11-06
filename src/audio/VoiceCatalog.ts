export const CHARACTER_VOICES = [
  { id: 'alex', assetId: 'alex-brodie', sex: 'male', name: 'Alex Brodie' },
  { id: 'ian', assetId: 'ian-lampert', sex: 'male', name: 'Ian Lampert' },
  { id: 'sean', assetId: 'sean-lenhart', sex: 'male', name: 'Sean Lenhart' },
  { id: 'karen', assetId: 'karen-cenon', sex: 'female', name: 'Karen Cenon' },
  { id: 'meghan', assetId: 'meghan-christian', sex: 'female', name: 'Meghan Christian' },
] as const;

export type CharacterVoiceId = typeof CHARACTER_VOICES[number]['id'];
export type CharacterVoiceCue = 'hmm' | 'gasp';

/** MPFB gender macro: >= 0 is male (1), < 0 is female (-1). */
export const defaultCharacterVoice = (gender = -1): CharacterVoiceId => gender >= 0 ? 'alex' : 'karen';

export const characterVoiceSex = (voice: CharacterVoiceId): 'male' | 'female' =>
  CHARACTER_VOICES.find(entry => entry.id === voice)!.sex;

export function resolveCharacterVoice(value: unknown, gender = -1): CharacterVoiceId {
  return CHARACTER_VOICES.find(voice => voice.id === value || voice.assetId === value)?.id ?? defaultCharacterVoice(gender);
}

/** The voice actually heard in game. Older saves stored the (then inverted)
 * default as if picked: only an explicit choice may differ from the body. */
export function effectiveCharacterVoice(config: { voiceId?: unknown; voiceChosen?: boolean; body?: { gender?: number } }): CharacterVoiceId {
  const gender = config.body?.gender ?? -1;
  return config.voiceChosen ? resolveCharacterVoice(config.voiceId, gender) : defaultCharacterVoice(gender);
}

export const characterVoiceUrl = (voice: CharacterVoiceId, cue: CharacterVoiceCue): string =>
  `/assets/audio/voices/${voice}/${cue}.ogg`;

export function randomConfirmationUrl(voiceId: CharacterVoiceId, random = Math.random): string {
  const voice = CHARACTER_VOICES.find(voice => voice.id === voiceId)!;
  const clip = Math.min(10, Math.max(1, Math.floor(random() * 10) + 1));
  return `/assets/audio/voices/super-dialogue/confirmation/${voice.sex}/${voice.assetId}/confirmation_${clip}_${voice.id}.mp3`;
}
