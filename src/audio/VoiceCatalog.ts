export const CHARACTER_VOICES = [
  { id: 'alex', assetId: 'alex-brodie', sex: 'male', name: 'Alex Brodie' },
  { id: 'ian', assetId: 'ian-lampert', sex: 'male', name: 'Ian Lampert' },
  { id: 'sean', assetId: 'sean-lenhart', sex: 'male', name: 'Sean Lenhart' },
  { id: 'karen', assetId: 'karen-cenon', sex: 'female', name: 'Karen Cenon' },
  { id: 'meghan', assetId: 'meghan-christian', sex: 'female', name: 'Meghan Christian' },
] as const;

export type CharacterVoiceId = typeof CHARACTER_VOICES[number]['id'];
export type CharacterVoiceCue = 'hmm' | 'gasp';

export function resolveCharacterVoice(value: unknown, gender = -1): CharacterVoiceId {
  return CHARACTER_VOICES.find(voice => voice.id === value || voice.assetId === value)?.id ?? (gender > 0 ? 'karen' : 'alex');
}

export const characterVoiceUrl = (voice: CharacterVoiceId, cue: CharacterVoiceCue): string =>
  `/assets/audio/voices/${voice}/${cue}.ogg`;

export function randomConfirmationUrl(voiceId: CharacterVoiceId, random = Math.random): string {
  const voice = CHARACTER_VOICES.find(voice => voice.id === voiceId)!;
  const clip = Math.min(10, Math.max(1, Math.floor(random() * 10) + 1));
  return `/assets/audio/voices/super-dialogue/confirmation/${voice.sex}/${voice.assetId}/confirmation_${clip}_${voice.id}.mp3`;
}
