import { characterRandom } from './CharacterRandom';
import { doorAudioChain, setDoorAudioListener } from '../audio/SpatialDoorAudio';
import type { Vec3Data } from '../world/types';
/** Contact resistance affects the attacking limb's clock, never the world or input. */
export function advanceStrikeClock(delta: number, compression: number): { step: number; remaining: number } {
  const dt = Math.max(0, delta);
  const resisted = Math.min(dt, Math.max(0, compression));
  return { step: dt - resisted * 0.72, remaining: Math.max(0, compression - dt) };
}

/** Quiet, short body-contact transients. No sound is emitted for a missed hit. */
export class CombatImpactAudio {
  constructor(private readonly random = characterRandom('impact-audio')) {}
  private volume = 1;
  setVolume(volume: number): void { this.volume = Math.max(0, Math.min(1, volume)); }
  private context?: AudioContext;
  private noise?: AudioBuffer;
  private suspended=false;
  private lastWall=-1;
  private readonly wallEffects=new Set<()=>void>();
  setSuspended(suspended:boolean):void {
    this.suspended=suspended;
    if(suspended)void this.context?.suspend().catch(()=>{});else if(this.context?.state==='suspended')void this.context.resume().catch(()=>{});
  }
  unlock(): void {
    try {
      if (!this.context && typeof window.AudioContext === 'function') this.context = new window.AudioContext();
      if (!this.suspended && this.context?.state === 'suspended') void this.context.resume().catch(() => {});
    } catch { /* Audio is optional; gameplay remains available. */ }
  }
  contact(heavy: boolean, body: boolean): void {
    const context = this.context;
    if (!context || this.suspended || context.state !== 'running' || this.volume <= 0) return;
    const now = context.currentTime;
    const duration = heavy ? 0.135 : 0.095;
    if (!this.noise) {
      this.noise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.18), context.sampleRate);
      const samples = this.noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = this.random() * 2 - 1;
    }
    const source = context.createBufferSource(), filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = this.noise;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(body ? 2100 : 2800, now);
    filter.frequency.exponentialRampToValueAtTime(body ? 700 : 1200, now + 0.045);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime((heavy ? 0.38 : 0.25) * this.volume, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter).connect(gain).connect(context.destination);
    source.start(now); source.stop(now + duration);
    const thud = context.createOscillator(), bass = context.createGain();
    const bassDuration = heavy ? 0.08 : 0.06;
    thud.frequency.setValueAtTime(heavy ? 85 : 110, now);
    thud.frequency.exponentialRampToValueAtTime(55, now + bassDuration);
    bass.gain.setValueAtTime(0.001, now);
    bass.gain.linearRampToValueAtTime((body ? 0.22 : 0.14) * this.volume, now + 0.002);
    bass.gain.exponentialRampToValueAtTime(0.001, now + bassDuration);
    thud.connect(bass).connect(context.destination); thud.start(now); thud.stop(now + bassDuration);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    thud.onended = () => { thud.disconnect(); bass.disconnect(); };
  }
  wall(heavy:boolean,position:Vec3Data,listener:Vec3Data,forward:Vec3Data):void {
    const context=this.context;
    if(!context||this.suspended||context.state!=='running'||this.volume<=0||context.currentTime-this.lastWall<.09||this.wallEffects.size>=6)return;
    this.lastWall=context.currentTime;
    if(!this.noise){this.noise=context.createBuffer(1,Math.ceil(context.sampleRate*.18),context.sampleRate);const samples=this.noise.getChannelData(0);for(let i=0;i<samples.length;i++)samples[i]=this.random()*2-1;}
    const bus={context,destination:context.destination};setDoorAudioListener(bus,listener,forward);
    const chain=doorAudioChain(bus,position,this.volume,false,{refDistance:1,maxDistance:12,rolloff:1.35});
    const source=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain(),thud=context.createOscillator(),bass=context.createGain();
    const now=context.currentTime,variation=.9+this.random()*.2,duration=(heavy?.19:.14)*variation;
    source.buffer=this.noise;source.playbackRate.value=.92+this.random()*.16;
    filter.type='lowpass';filter.frequency.setValueAtTime(3600*variation,now);filter.frequency.exponentialRampToValueAtTime(850,now+duration);
    gain.gain.setValueAtTime(.001,now);gain.gain.linearRampToValueAtTime((heavy?.64:.47)*variation,now+.003);gain.gain.exponentialRampToValueAtTime(.001,now+duration);
    thud.frequency.setValueAtTime((heavy?105:135)*variation,now);thud.frequency.exponentialRampToValueAtTime(48,now+.11);
    bass.gain.setValueAtTime(.001,now);bass.gain.linearRampToValueAtTime((heavy?.31:.22)*variation,now+.003);bass.gain.exponentialRampToValueAtTime(.001,now+.12);
    source.connect(filter).connect(gain).connect(chain.input);thud.connect(bass).connect(chain.input);
    const cleanup=()=>{source.disconnect();filter.disconnect();gain.disconnect();thud.disconnect();bass.disconnect();chain.dispose();this.wallEffects.delete(cleanup);};
    this.wallEffects.add(cleanup);source.onended=cleanup;source.start(now);source.stop(now+duration);thud.start(now);thud.stop(now+.12);
  }
  dispose(): void { for(const cleanup of this.wallEffects)cleanup();void this.context?.close().catch(() => {}); }
}
