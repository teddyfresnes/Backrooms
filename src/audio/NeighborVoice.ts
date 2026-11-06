import { loadAudioAsset } from './AudioAssetQueue';
import { mapWithConcurrency } from '../core/CooperativeWork';
import { doorAudioChain, type SpatialAudioBus } from './SpatialDoorAudio';
import type { Vec3Data } from '../world/types';
import type { CharacterVoiceId } from './VoiceCatalog';

export type NeighborCue = `refusal-${number}` | 'miscellaneous-13' | 'miscellaneous-15' | 'hmm';
export const NEIGHBOR_CUES: readonly NeighborCue[] = [...Array.from({length:10}, (_,i) => `refusal-${i+1}` as NeighborCue), 'miscellaneous-13', 'miscellaneous-15', 'hmm'];
export const neighborClipUrl = (voice: CharacterVoiceId, cue: NeighborCue): string => `/assets/audio/${cue==='hmm'?'voices':'neighbors'}/${voice}/${cue}.ogg`;

/** Recorded actors only. Shares the runtime's audio bus and master gain. */
export class NeighborVoice {
  private bus?: SpatialAudioBus;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly sources = new Map<string, AudioBufferSourceNode>();
  private readonly abort = new AbortController();
  private volume = .6;
  private disposed = false;

  async prepare(bus: SpatialAudioBus, voices: readonly CharacterVoiceId[]): Promise<void> {
    this.bus = bus;
    const clips = [...new Set(voices)].flatMap(voice => NEIGHBOR_CUES.map(cue => neighborClipUrl(voice, cue)));
    await mapWithConcurrency(clips, 2, async url => {
      this.abort.signal.throwIfAborted();
      const buffer = await loadAudioAsset(bus.context, url, this.abort.signal);
      if (!this.disposed) this.buffers.set(url, buffer);
    });
  }
  setVolume(volume: number): void { this.volume = volume; if (volume <= 0) this.stop(); }
  duration(voice:CharacterVoiceId,cue:NeighborCue):number {return this.buffers.get(neighborClipUrl(voice,cue))?.duration??1.3;}
  play(doorId: string, voice: CharacterVoiceId, cue: NeighborCue, position: Readonly<Vec3Data>,delivery:'normal'|'mutter'='normal'): boolean {
    const bus = this.bus, buffer = this.buffers.get(neighborClipUrl(voice, cue));
    if (!bus || !buffer || this.disposed || this.volume <= 0 || document.hidden || bus.context.state !== 'running' || this.sources.has(doorId) || this.sources.size>=2) return false;
    const chain = doorAudioChain(bus, position, delivery==='mutter'?.34:.52, delivery==='mutter'?'mutter':true), source = bus.context.createBufferSource();
    source.buffer = buffer; source.connect(chain.input);
    source.onended = () => { if (this.sources.get(doorId) === source) this.sources.delete(doorId); source.disconnect(); chain.dispose(); };
    this.sources.set(doorId, source); source.start();
    return true;
  }
  stop(): void { for (const source of this.sources.values()) { try { source.stop(); } catch { /* already ended */ } } this.sources.clear(); }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.abort.abort(); this.stop(); this.buffers.clear(); this.bus = undefined; }
}
