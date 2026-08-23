import { describe, expect, it } from 'vitest'
import { compatibleVoiceId, randomConfirmationUrl, voicesForSex } from './voices'

describe('wardrobe voices', () => {
  it('only exposes voices matching the selected sex', () => {
    expect(voicesForSex('female').map((voice) => voice.id)).toEqual(['karen-cenon', 'meghan-christian'])
    expect(voicesForSex('male').map((voice) => voice.id)).toEqual(['alex-brodie', 'ian-lampert', 'sean-lenhart'])
  })

  it('replaces an incompatible saved voice with the default for that sex', () => {
    expect(compatibleVoiceId('karen-cenon', 'male')).toBe('alex-brodie')
    expect(compatibleVoiceId('ian-lampert', 'male')).toBe('ian-lampert')
  })

  it('selects a confirmation clip from the chosen performer', () => {
    expect(randomConfirmationUrl('meghan-christian', () => 0)).toContain('confirmation_1_meghan.mp3')
    expect(randomConfirmationUrl('meghan-christian', () => 0.999)).toContain('confirmation_10_meghan.mp3')
  })
})
