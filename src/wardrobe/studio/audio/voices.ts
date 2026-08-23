import type { BiologicalSex } from '../core/humanMeasurements'
import type { CharacterVoiceId } from '../core/types'

export interface CharacterVoice {
  id: CharacterVoiceId
  label: string
  sex: BiologicalSex
  confirmationUrls: readonly string[]
}

const ROOT = '/assets/audio/voices/super-dialogue/confirmation'

function confirmations(sex: BiologicalSex, speaker: string, fileStem: string) {
  return Array.from({ length: 10 }, (_, index) => `${ROOT}/${sex}/${speaker}/confirmation_${index + 1}_${fileStem}.mp3`)
}

export const CHARACTER_VOICES: readonly CharacterVoice[] = [
  { id: 'karen-cenon', label: 'Karen Cenon', sex: 'female', confirmationUrls: confirmations('female', 'karen-cenon', 'karen') },
  { id: 'meghan-christian', label: 'Meghan Christian', sex: 'female', confirmationUrls: confirmations('female', 'meghan-christian', 'meghan') },
  { id: 'alex-brodie', label: 'Alex Brodie', sex: 'male', confirmationUrls: confirmations('male', 'alex-brodie', 'alex') },
  { id: 'ian-lampert', label: 'Ian Lampert', sex: 'male', confirmationUrls: confirmations('male', 'ian-lampert', 'ian') },
  { id: 'sean-lenhart', label: 'Sean Lenhart', sex: 'male', confirmationUrls: confirmations('male', 'sean-lenhart', 'sean') },
]

export function voicesForSex(sex: BiologicalSex) {
  return CHARACTER_VOICES.filter((voice) => voice.sex === sex)
}

export function defaultVoiceIdForSex(sex: BiologicalSex): CharacterVoiceId {
  return sex === 'female' ? 'karen-cenon' : 'alex-brodie'
}

export function compatibleVoiceId(voiceId: CharacterVoiceId | undefined, sex: BiologicalSex): CharacterVoiceId {
  return CHARACTER_VOICES.some((voice) => voice.id === voiceId && voice.sex === sex)
    ? voiceId!
    : defaultVoiceIdForSex(sex)
}

export function randomConfirmationUrl(voiceId: CharacterVoiceId, random = Math.random) {
  const clips = CHARACTER_VOICES.find((voice) => voice.id === voiceId)?.confirmationUrls
  if (!clips?.length) return null
  const index = Math.min(clips.length - 1, Math.floor(Math.max(0, random()) * clips.length))
  return clips[index]
}
