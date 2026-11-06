import { useEffect, useRef } from 'react'
import { siteAudio } from '../../../audio/SiteAudio'
import { CHARACTER_VOICES, effectiveCharacterVoice, randomConfirmationUrl } from '../../../audio/VoiceCatalog'
import { useCharacterState } from '../state/CharacterState'

export function VoicePicker() {
  const selected = useCharacterState(s => effectiveCharacterVoice(s.config))
  const setVoice = useCharacterState(s => s.setVoice)
  const confirmation = useRef<HTMLAudioElement | null>(null)
  useEffect(() => () => {
    confirmation.current?.pause()
    siteAudio.stopVoice()
  }, [])

  function selectVoice(voice: typeof selected) {
    setVoice(voice)
    siteAudio.stopVoice()
    confirmation.current?.pause()
    const audio = new Audio(randomConfirmationUrl(voice))
    audio.volume = 0.82
    confirmation.current = audio
    void audio.play().catch(() => undefined)
  }

  function playCue(cue: 'hmm' | 'gasp') {
    confirmation.current?.pause()
    void siteAudio.unlock()
    siteAudio.playVoice(selected, cue)
  }
  return <fieldset className="wardrobe-voices">
    <legend>Voix</legend>
    <div className="wardrobe-voice-options">
      {CHARACTER_VOICES.map(voice => <label key={voice.id}>
        <input type="radio" name="character-voice" checked={voice.id === selected} onChange={() => selectVoice(voice.id)} />
        <span>{voice.name}</span>
      </label>)}
    </div>
    <div className="wardrobe-voice-preview">
      <button type="button" onClick={() => playCue('hmm')}>Écouter la voix</button>
      <button type="button" onClick={() => playCue('gasp')}>Écouter le souffle</button>
    </div>
    <small>Super Dialogue Audio Pack · Dillon Becker · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a></small>
  </fieldset>
}
