import { SeededRandom } from '../world/SeededRandom';
import type { ApartmentProgress } from '../story/ApartmentQuest';
import { doorAudioChain, type SpatialAudioBus } from './SpatialDoorAudio';
import type { Vec3Data } from '../world/types';

export const RADIO_PLAYLIST = [
  '/assets/audio/apartment/Waiting.mp3', '/assets/audio/apartment/sleepwalking.mp3',
  '/assets/audio/apartment/Sarah.mp3', '/assets/audio/apartment/Fallen-Down-Slowed-Version.mp3',
] as const;
export const COOKING_LEVEL = .0075;
export const pressureDistanceGain = (distance: number): number => { const t = Math.max(0, Math.min(1, (distance - 14) / 18)); return 1 - t * t * (3 - 2 * t); };
export const PRESSURE_URL = '/assets/audio/apartment/Pressure.mp3';
interface Stream {
  element: HTMLAudioElement; source?: MediaElementAudioSourceNode; chain?: ReturnType<typeof doorAudioChain>;
  url?: string; pending: boolean; blocked: boolean; wanted: boolean;
}
export interface DeviceAudioPositions { tv: Vec3Data; radio: Vec3Data; pc: Vec3Data; gas: Vec3Data; panel?: Vec3Data }

/** Two streamed media elements share the existing context/master bus. No song
 * is fetched or decoded at startup. Changing a radio track loads only that song. */
export class ApartmentDeviceAudio {
  private readonly radio: Stream;
  private readonly pressure: Stream;
  private readonly noise: AudioBuffer;
  private readonly loops: { source: AudioBufferSourceNode; gain: GainNode; chain: ReturnType<typeof doorAudioChain> }[] = [];
  private readonly effects = new Set<{ source: AudioScheduledSourceNode; cleanup(): void }>();
  private disposed = false;
  private state?: Readonly<ApartmentProgress>;
  private active = false;
  private pressureDelay = 0;
  private lastFixtureClick = -1;
  private lastChairMotion = -1;
  private listenerDistance = 0;
  private narrationGain = 1;
  private readonly fixtures = new Map<string, { source: AudioBufferSourceNode; gain: GainNode; chain: ReturnType<typeof doorAudioChain> }>();
  get pressureBroadcastReady(): boolean { return this.pressureDelay === 0; }
  setListenerPosition(position: Vec3Data): void {
    this.listenerDistance = Math.hypot(position.x-this.positions.tv.x, position.y-this.positions.tv.y, position.z-this.positions.tv.z);
    this.pressure.chain?.setLevel(.43 * pressureDistanceGain(this.listenerDistance)*this.narrationGain);
  }
  setNarrationActive(active:boolean):void {
    const gain=active?.28:1;if(gain===this.narrationGain)return;this.narrationGain=gain;
    this.radio.chain?.setLevel(.38*gain);this.pressure.chain?.setLevel(.43*pressureDistanceGain(this.listenerDistance)*gain);
  }
  fixture(kind: 'water' | 'fan', position: Vec3Data, amount: number): void {
    if(this.disposed)return;
    let loop=this.fixtures.get(kind);
    if (!loop && amount > 0) {
      const chain=doorAudioChain(this.bus, position, 1, kind==='fan', {refDistance:.45,maxDistance:6,rolloff:2.2});
      const source=this.bus.context.createBufferSource(),gain=this.bus.context.createGain();
      source.buffer=this.noise;source.loop=true;gain.gain.value=0;source.connect(gain).connect(chain.input);source.start();
      loop={source,gain,chain};this.fixtures.set(kind,loop);
    }
    if(loop){loop.chain.setPosition(position);loop.gain.gain.value=(kind==='water'?.013:.008)*Math.max(0,Math.min(1,amount));}
  }
  fixtureClick(position: Vec3Data): void {
    const now=this.bus.context.currentTime;if(now-this.lastFixtureClick<.08)return;this.lastFixtureClick=now;this.burst(position,.045,.022,1600,'lowpass');
  }
  /** A modular breaker lever snapping up: a short plastic clack. */
  breakerFlip(position: Vec3Data): void {
    if (this.disposed) return;
    this.burst(position, .05, .09, 3400, 'bandpass'); this.burst(position, .03, .05, 900, 'lowpass');
  }
  /** Every lever thrown back at once: a hard double clack and a dry electric snap. */
  breakerTrip(position: Vec3Data): void {
    if (this.disposed) return;
    this.burst(position, .09, .22, 2600, 'bandpass'); this.burst(position, .16, .14, 5200, 'highpass');
    this.tone(position, 180, 60, .12, .03);
  }
  /** The deep, wrong knock that follows: felt more than heard. */
  deepKnock(position: Vec3Data): void {
    if (this.disposed) return;
    const range = { refDistance: 3, maxDistance: 40, rolloff: .6 };
    this.burst(position, .7, .9, 160, 'lowpass', range);
    this.tone(position, 58, 31, 1.3, .32, range); this.tone(position, 92, 44, .55, .12, range);
  }
  chairMotion(position: Vec3Data): void {
    const now=this.bus.context.currentTime;if(now-this.lastChairMotion<.2)return;this.lastChairMotion=now;
    this.burst(position,.32,.045,650,'lowpass');
  }
  corridorImpact(position:Vec3Data):void {
    if(this.disposed)return;
    const range={refDistance:8,maxDistance:80,rolloff:.7};
    this.burst(position,.95,.72,210,'lowpass',range);
    this.tone(position,62,27,1.1,.34,range);this.tone(position,117,41,.65,.14,range);
  }
  corridorFixture(position:Vec3Data):void{if(!this.disposed){this.burst(position,.08,.035,1800,'bandpass');this.tone(position,120,120,.16,.009);}}
  private lastBallast=-1;
  /**
   * A troffer striking: starter click, ballast thunk and a short mains buzz,
   * placed at the lamp. Gentle distance roll-off keeps the far end audible in
   * the silent corridor; strikes closer than ~90 ms apart are thinned out.
   */
  corridorBallast(position:Vec3Data,index:number):void{
    if(this.disposed)return;
    const now=this.bus.context.currentTime,gap=now-this.lastBallast;this.lastBallast=now;
    const thin=gap<.09?.45:1,variant=(index*2654435761>>>0)/4294967296;
    const range={refDistance:2.2,maxDistance:240,rolloff:.42};
    // Louder than before: the strikes are the soundtrack of the wave.
    this.burst(position,.028+variant*.02,.28*thin,2100+variant*1500,'bandpass',range);
    this.burst(position,.13,.19*thin,320+variant*140,'lowpass',range);
    this.tone(position,118+variant*6,96,.42+variant*.2,.04*thin,range);
  }
  ceramic(position: Vec3Data): void { this.burst(position,.4,.16,900,'lowpass'); this.tone(position,420,140,.12,.018); }
  constructor(private readonly bus: SpatialAudioBus, private readonly positions: DeviceAudioPositions,
    private readonly nextRadioTrack: () => void,
    /** Recorded switch click (the light-switch take), layered under synthesized device sounds. */
    private readonly recordedClick?: (on: boolean) => void) {
    const stream = (): Stream => {
      const element = new Audio(); element.preload = 'none'; element.crossOrigin = 'anonymous';
      return { element, pending: false, blocked: false, wanted: false };
    };
    this.radio = stream(); this.pressure = stream(); this.pressure.element.loop = true;
    this.radio.element.addEventListener('ended', this.ended);
    const random = new SeededRandom('apartment-device-noise');
    this.noise = bus.context.createBuffer(1, Math.floor(bus.context.sampleRate * 1.5), bus.context.sampleRate);
    const samples = this.noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = random.float(-1, 1);
    for (const position of [positions.tv, positions.gas]) {
      const chain = doorAudioChain(bus, position, 1, position === positions.gas, position === positions.gas ? {refDistance:.55,maxDistance:6,rolloff:2} : {}), gain = bus.context.createGain(), source = bus.context.createBufferSource();
      gain.gain.value = 0; source.buffer = this.noise; source.loop = true;
      source.connect(gain).connect(chain.input); source.start(); this.loops.push({ source, gain, chain });
    }
  }
  private readonly ended = (): void => {
    if (this.disposed || !this.state?.radioOn || this.state.outageTriggered) return;
    this.nextRadioTrack(); if (this.state) this.sync(this.state, this.active);
  };
  unlock(): void { this.radio.blocked = false; this.pressure.blocked = false; }
  moveRadio(position: Vec3Data): void {
    const p = this.positions.radio;
    if (Math.abs(p.x - position.x) + Math.abs(p.y - position.y) + Math.abs(p.z - position.z) < .00001) return;
    p.x = position.x; p.y = position.y; p.z = position.z;
    this.radio.chain?.setPosition(p);
  }
  sync(state: Readonly<ApartmentProgress>, active: boolean, delta = 0): void {
    if (this.disposed) return;
    this.state = state; this.active = active;
    if (active) this.pressureDelay = Math.max(0, this.pressureDelay - Math.max(0, delta));
    this.loops[0]!.gain.gain.value = active && state.tvOn && !state.outageTriggered ? .022 : 0;
    this.loops[1]!.gain.gain.value = active && state.gasOn ? COOKING_LEVEL : 0;
    this.stream(this.radio, RADIO_PLAYLIST[state.radioTrack]!, this.positions.radio,
      active && state.radioOn && !state.outageTriggered, .38*this.narrationGain);
    this.stream(this.pressure, PRESSURE_URL, this.positions.tv, active && state.outageTriggered && state.tvOn && this.pressureDelay === 0, .43 * pressureDistanceGain(this.listenerDistance)*this.narrationGain);
  }
  private stream(stream: Stream, url: string, position: Vec3Data, wanted: boolean, volume: number): void {
    stream.wanted = wanted;
    if (!wanted) { if (!stream.element.paused) stream.element.pause(); return; }
    if (!stream.source) {
      stream.chain = doorAudioChain(this.bus, position, volume);
      stream.source = this.bus.context.createMediaElementSource(stream.element); stream.source.connect(stream.chain.input);
    }
    if (stream.url !== url) {
      stream.element.pause(); stream.url = url; stream.element.src = url; stream.element.load(); stream.blocked = false;
    }
    if (!stream.element.paused || stream.pending || stream.blocked) return;
    stream.pending = true;
    const playing = stream.element.play();
    const requestedUrl = url;
    void Promise.resolve(playing).then(() => {
      if (this.disposed || !stream.wanted) stream.element.pause();
    }).catch(() => { if (stream.wanted && stream.url === requestedUrl) stream.blocked = true; }).finally(() => {
      stream.pending = false;
      if (!this.disposed && stream.wanted && stream.element.paused && !stream.blocked) {
        this.stream(stream, stream.url!, position, true, volume);
      }
    });
  }
  click(): void { this.burst(this.positions.pc, .026, .04, 1800, 'highpass'); }
  radioStatic(): void { this.burst(this.positions.radio, .24, .27, 1100, 'highpass'); }
  glass(position: Vec3Data): void {
    this.burst(position, .88, .65, 1900, 'highpass');
    for (const [frequency, duration] of [[2280, .36], [3810, .22], [1450, .51]]) this.tone(position, frequency!, 1200, duration!, .055);
  }
  /**
   * The mains trip: a hard breaker clack in the entry panel, the transformer's
   * low thump as the load drops, then a short collapsing hum. Dry and immediate,
   * no synth sweep; it shares the master bus and volume setting.
   */
  powerCut(): void {
    this.pressureDelay = .65;
    const panel = this.positions.panel ?? this.positions.pc;
    const range = { refDistance: 2.5, maxDistance: 40, rolloff: .8 };
    this.burst(panel, .018, .95, 4200, 'bandpass', range);
    this.burst(panel, .045, .55, 1500, 'bandpass', range);
    this.burst(panel, .32, .7, 180, 'lowpass', range);
    this.hum(this.positions.pc, 100, .5, .05);
  }
  /** A plain device button (radio): the recorded click only. */
  buttonClick(on: boolean): void { if (!this.disposed) this.recordedClick?.(on); }
  private lastTelevisionSwitch = -1;
  /** A CRT power button: relay click, degauss thump and (on) a brief static wash; (off) the picture collapsing. */
  televisionSwitch(on: boolean): void {
    if (this.disposed) return;
    this.recordedClick?.(on);
    const now = this.bus.context.currentTime, rapid = now - this.lastTelevisionSwitch < .18;
    this.lastTelevisionSwitch = now;
    const tv = this.positions.tv, range = { refDistance: 1.1, maxDistance: 16, rolloff: 1.3 };
    this.burst(tv, .02, .32, 2600, 'bandpass', range);
    if (rapid) return;
    if (on) {
      this.burst(tv, .16, .26, 140, 'lowpass', range);
      this.burst(tv, .45, .05, 5200, 'highpass', range);
      this.hum(tv, 50, .38, .04);
    } else {
      this.burst(tv, .09, .14, 900, 'lowpass', range);
      this.tone(tv, 520, 70, .22, .02, range);
    }
  }
  /** Short mains hum that decays (pure sine harmonics, not a sweep). */
  private hum(position: Vec3Data, frequency: number, duration: number, level: number): void {
    if (this.disposed || this.bus.context.state !== 'running') return;
    const { context } = this.bus, chain = doorAudioChain(this.bus, position, 1, false);
    const gain = context.createGain(), sources = [frequency, frequency * 2, frequency * 3].map((f, index) => {
      const source = context.createOscillator(); source.type = 'sine'; source.frequency.value = f;
      const partial = context.createGain(); partial.gain.value = [1, .5, .22][index]!; source.connect(partial).connect(gain); return source;
    });
    gain.gain.setValueAtTime(level, context.currentTime); gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + duration);
    gain.connect(chain.input);
    const effect = { source: sources[0]!, cleanup: () => { for (const s of sources) s.disconnect(); gain.disconnect(); chain.dispose(); this.effects.delete(effect); } };
    this.effects.add(effect); sources[0]!.onended = effect.cleanup;
    for (const s of sources) { s.start(); s.stop(context.currentTime + duration); }
  }
  private burst(position: Vec3Data, duration: number, level: number, frequency: number, type: BiquadFilterType,range?:{refDistance:number;maxDistance:number;rolloff:number}): void {
    if (this.disposed || this.bus.context.state !== 'running') return;
    const { context } = this.bus, source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
    const chain = doorAudioChain(this.bus, position, 1,false,range);
    filter.type = type; filter.frequency.value = frequency;
    source.buffer = this.noise; gain.gain.setValueAtTime(level, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + duration);
    source.connect(filter).connect(gain).connect(chain.input);
    const effect = { source, cleanup: () => { source.disconnect(); filter.disconnect(); gain.disconnect(); chain.dispose(); this.effects.delete(effect); } };
    this.effects.add(effect); source.onended = effect.cleanup; source.start(); source.stop(context.currentTime + duration);
  }
  private tone(position: Vec3Data, from: number, to: number, duration: number, level: number,range?:{refDistance:number;maxDistance:number;rolloff:number}): void {
    if (this.disposed || this.bus.context.state !== 'running') return;
    const { context } = this.bus, source = context.createOscillator(), gain = context.createGain(), chain = doorAudioChain(this.bus, position, 1,false,range);
    source.type = 'sawtooth'; source.frequency.setValueAtTime(from, context.currentTime);
    source.frequency.exponentialRampToValueAtTime(to, context.currentTime + duration);
    gain.gain.setValueAtTime(level, context.currentTime); gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + duration);
    source.connect(gain).connect(chain.input);
    const effect = { source, cleanup: () => { source.disconnect(); gain.disconnect(); chain.dispose(); this.effects.delete(effect); } };
    this.effects.add(effect); source.onended = effect.cleanup; source.start(); source.stop(context.currentTime + duration);
  }
  dispose(): void {
    this.disposed = true; this.radio.element.removeEventListener('ended', this.ended);
    for (const stream of [this.radio, this.pressure]) {
      stream.wanted = false; stream.element.pause(); stream.element.removeAttribute('src'); stream.element.load();
      stream.source?.disconnect(); stream.chain?.dispose();
    }
    for (const loop of [...this.loops, ...this.fixtures.values()]) { loop.source.stop(); loop.source.disconnect(); loop.gain.disconnect(); loop.chain.dispose(); }
    for (const effect of [...this.effects]) { try { effect.source.stop(); } catch {} effect.cleanup(); }
    this.loops.length = 0; this.fixtures.clear(); this.effects.clear(); this.state = undefined;
  }
}
