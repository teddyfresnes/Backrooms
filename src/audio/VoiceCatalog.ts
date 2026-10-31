export const CHARACTER_VOICES = [
  { id: 'alex', name: 'Alex Brodie' },
  { id: 'ian', name: 'Ian Lampert' },
  { id: 'sean', name: 'Sean Lenhart' },
  { id: 'karen', name: 'Karen Cenon' },
  { id: 'meghan', name: 'Meghan Christian' },
] as const;

export type CharacterVoiceId = typeof CHARACTER_VOICES[number]['id'];
export type CharacterVoiceCue = 'hmm' | 'gasp';

export function resolveCharacterVoice(value: unknown, gender = -1): CharacterVoiceId {
  return CHARACTER_VOICES.find(voice => voice.id === value)?.id ?? (gender > 0 ? 'karen' : 'alex');
}

export const characterVoiceUrl = (voice: CharacterVoiceId, cue: CharacterVoiceCue): string =>
  `/assets/audio/voices/${voice}/${cue}.ogg`;
