import { useEffect } from 'react'
import { siteAudio } from '../../../audio/SiteAudio'
import { CHARACTER_VOICES, resolveCharacterVoice } from '../../../audio/VoiceCatalog'
import { useCharacterState } from '../state/CharacterState'

export function VoicePicker() {
  const selected = useCharacterState(s => resolveCharacterVoice(s.config.voiceId, s.config.body.gender))
  const setVoice = useCharacterState(s => s.setVoice)
  useEffect(() => () => siteAudio.stopVoice(), [])
  return <fieldset className="wardrobe-voices">
    <legend>Voix</legend>
    <div className="wardrobe-voice-options">
      {CHARACTER_VOICES.map(voice => <label key={voice.id}>
        <input type="radio" name="character-voice" checked={voice.id === selected} onChange={() => { siteAudio.stopVoice(); setVoice(voice.id) }} />
        <span>{voice.name}</span>
      </label>)}
    </div>
    <div className="wardrobe-voice-preview">
      <button type="button" onClick={() => { void siteAudio.unlock(); siteAudio.playVoice(selected, 'hmm') }}>Écouter la voix</button>
      <button type="button" onClick={() => { void siteAudio.unlock(); siteAudio.playVoice(selected, 'gasp') }}>Écouter le souffle</button>
    </div>
    <small>Super Dialogue Audio Pack · Dillon Becker · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a></small>
  </fieldset>
}
