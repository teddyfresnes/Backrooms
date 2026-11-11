import * as THREE from 'three';
import { SeededRandom } from '../world/SeededRandom';

const URLS = {
  tension: '/assets/audio/bacteria/tension.mp3',
  scream: '/assets/audio/bacteria/scream-loop.mp3',
  voice: '/assets/audio/bacteria/voice-lines.mp3',
} as const;

type BufferId = keyof typeof URLS;

/** The far-bank drone (owner-provided) and the knock: only the Backrooms runtime loads them. */
const PRESENCE_URL = '/assets/audio/bacteria/backrooms-presence.mp3';
const KNOCK_URL = '/assets/audio/interactions/knock-wood.ogg';
/** The drone has ~1.1 s of silence at the start and a fade at the end: loop inside. */
export const PRESENCE_LOOP_START = 1.13;
export const PRESENCE_LOOP_END = 67.78;
/** Onsets of the three blows in knock-wood.ogg (s). */
const KNOCK_ONSETS = [0.067, 0.272, 0.508] as const;
const KNOCK_RATE = 0.88;

interface SpatialVoice {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  panner: StereoPannerNode;
  gain: GainNode;
}

export interface AudioOutput { readonly context: AudioContext; readonly destination: AudioNode }

/**
 * The creature's sound layer, on the runtime's own context and master bus (so
 * pause, suspension and the volume setting apply). The scream loop never goes
 * fully silent: a far floor keeps it audible anywhere in the building, and it
 * swells, opens up and pans as the creature closes in.
 */
export class BacteriaAudio {
  private readonly buffers: Partial<Record<BufferId, AudioBuffer>> = {};
  private scream?: SpatialVoice;
  private voice?: SpatialVoice;
  private tension?: AudioBufferSourceNode;
  private duck = 1;
  private calm = 0;
  private disposed = false;

  constructor(private readonly output: () => AudioOutput | null) {}

  async load(): Promise<void> {
    const output = this.output();
    if (!output) return;
    await Promise.all((Object.keys(URLS) as BufferId[]).map(async (id) => {
      try {
        const response = await fetch(URLS[id]);
        if (!response.ok) return;
        this.buffers[id] = await output.context.decodeAudioData(await response.arrayBuffer());
      } catch {
        // A missing creature sound must never block the stairwell.
      }
    }));
  }

  playTension(): void {
    const output = this.output();
    const buffer = this.buffers.tension;
    if (!output || !buffer || this.disposed) return;
    this.tension?.stop();
    const source = output.context.createBufferSource();
    const gain = output.context.createGain();
    source.buffer = buffer;
    gain.gain.value = 1.05;
    source.connect(gain).connect(output.destination);
    source.addEventListener('ended', () => { source.disconnect(); gain.disconnect(); }, { once: true });
    source.start();
    this.tension = source;
  }

  startScream(): void {
    if (this.scream || this.disposed) return;
    this.scream = this.createVoice('scream', true, 0);
  }

  /** Voice lines from the creature's position, from the moment the door gives way, looping. */
  startVoice(): void {
    if (this.voice || this.disposed) return;
    this.calm = 0;
    this.voice = this.createVoice('voice', true, 0);
  }

  /** 0 = raving, 1 = settled into low murmurs (it has what it wanted). */
  setVoiceCalm(value: number): void { this.calm = THREE.MathUtils.clamp(value, 0, 1); }

  stopVoice(fadeSeconds = 0.3): void {
    const output = this.output();
    const voice = this.voice;
    if (!voice || !output) return;
    this.voice = undefined;
    const now = output.context.currentTime;
    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now);
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.02, fadeSeconds));
      voice.source.stop(now + Math.max(0.03, fadeSeconds + 0.02));
    } catch {
      // Already stopped.
    }
  }

  /** A short, unfiltered blast of the scream (it has seen you), then back to its spatial level. */
  roar(): void {
    const output = this.output();
    if (!output) return;
    if (!this.scream) this.startScream();
    const voice = this.scream;
    if (!voice) return;
    const now = output.context.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(1.75, now);
    voice.filter.frequency.cancelScheduledValues(now);
    voice.filter.frequency.setValueAtTime(16000, now);
    voice.panner.pan.setValueAtTime(0, now);
    this.roarUntil = now + 0.65;
  }
  private roarUntil = 0;

  get isScreaming(): boolean { return !!this.scream; }

  /**
   * Only a pursuing creature screams. Calm phases (sniffing, the television,
   * sneaking out) keep its voice alone; the loop fades out and comes back,
   * at its spatial level, the moment it runs at you again.
   */
  setScreamActive(active: boolean): void { this.screamActive = active; }
  private screamActive = true;

  /** 0..1 attenuation of the scream (e.g. while it sniffs at the closet). */
  setDuck(value: number): void { this.duck = THREE.MathUtils.clamp(value, 0, 1); }

  /**
   * @param distance metres between creature and listener
   * @param pan -1 (left) .. 1 (right)
   * @param occlusion 0 = open air, 1 = through a closed door and floors
   */
  updateSpatial(distance: number, pan: number, occlusion: number): void {
    const output = this.output();
    if (!output) return;
    const now = output.context.currentTime;
    const near = Math.pow(THREE.MathUtils.clamp(1 - distance / 24, 0, 1), 1.7);
    const occluded = THREE.MathUtils.clamp(occlusion, 0, 1);
    const level = (0.17 + 0.95 * near) * (1 - 0.42 * occluded);
    const far = Math.pow(THREE.MathUtils.clamp(distance / 30, 0, 1), 0.8);
    const cutoff = THREE.MathUtils.lerp(15500, 850, Math.max(far, occluded * 0.82));
    const voiceActive = !!this.voice;
    const calm = 1 - 0.45 * this.calm;
    for (const [voice, gain] of [
      [this.scream, this.screamActive ? level * this.duck * (voiceActive ? 0.38 : 1) : 0.0001],
      [this.voice, Math.min(1.25, level * 1.25 + 0.12) * this.duck * calm],
    ] as const) {
      if (!voice) continue;
      if (voice === this.scream && now < this.roarUntil) continue;
      voice.gain.gain.setTargetAtTime(gain, now, voice === this.voice ? 0.25 : this.screamActive ? 0.06 : 0.3);
      voice.filter.frequency.setTargetAtTime(voice === this.voice ? Math.min(cutoff, THREE.MathUtils.lerp(15500, 1400, this.calm)) : cutoff, now, 0.08);
      voice.panner.pan.setTargetAtTime(THREE.MathUtils.clamp(pan, -1, 1) * (1 - near * 0.35), now, 0.05);
    }
  }

  /** Full-blast, unfiltered scream in both ears. */
  jumpscare(): void {
    const output = this.output();
    if (!output) return;
    if (!this.scream) this.startScream();
    const now = output.context.currentTime;
    for (const voice of [this.scream, this.voice]) {
      if (!voice) continue;
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice === this.scream ? 1.9 : 1.3, now);
      voice.filter.frequency.cancelScheduledValues(now);
      voice.filter.frequency.setValueAtTime(18000, now);
      voice.panner.pan.setValueAtTime(0, now);
    }
    if (this.scream) this.scream.source.playbackRate.setValueAtTime(0.86, now);
  }

  private wind?: { source: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode };
  /**
   * Air rushing past during the fall (0 silent .. 1 full): filtered noise that
   * opens up with the speed. Synthesised once, seeded by sample index.
   */
  setFallWind(level: number): void {
    const output = this.output();
    if (!output || this.disposed) return;
    const { context } = output, now = context.currentTime, value = Math.min(1, Math.max(0, level));
    if (!this.wind) {
      if (value <= 0) return;
      const length = Math.floor(context.sampleRate * 2), buffer = context.createBuffer(1, length, context.sampleRate), data = buffer.getChannelData(0);
      let state = 0x9e3779b9, brown = 0;
      for (let i = 0; i < length; i++) {
        state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
        brown = brown * 0.985 + ((state >>> 0) / 4294967296 * 2 - 1) * 0.15;
        data[i] = brown;
      }
      const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
      source.buffer = buffer; source.loop = true;
      filter.type = 'bandpass'; filter.Q.value = 0.6; filter.frequency.value = 300;
      gain.gain.value = 0.0001;
      source.connect(filter).connect(gain).connect(output.destination);
      source.start();
      this.wind = { source, filter, gain };
    }
    this.wind.gain.gain.setTargetAtTime(0.0001 + value * 1.6, now, 0.12);
    this.wind.filter.frequency.setTargetAtTime(260 + value * 1400, now, 0.2);
  }
  stopFallWind(fadeSeconds: number): void {
    const wind = this.wind, output = this.output();
    if (!wind || !output) return;
    this.wind = undefined;
    const now = output.context.currentTime;
    try {
      wind.gain.gain.cancelScheduledValues(now);
      wind.gain.gain.setTargetAtTime(0.0001, now, Math.max(0.01, fadeSeconds / 3));
      wind.source.stop(now + Math.max(0.03, fadeSeconds));
    } catch { /* already stopped */ }
    wind.source.addEventListener('ended', () => { wind.source.disconnect(); wind.filter.disconnect(); wind.gain.disconnect(); }, { once: true });
  }

  // ------------------------------------------------ the far-bank presence

  private presenceBuffer?: AudioBuffer;
  private knockBuffer?: AudioBuffer;
  private presence?: SpatialVoice;
  private breath?: SpatialVoice & { lfo: OscillatorNode };
  private buzz?: { oscillators: OscillatorNode[]; filter: BiquadFilterNode; panner: StereoPannerNode; gain: GainNode };
  private noise?: AudioBuffer;
  private readonly clickRandom = new SeededRandom('bacteria-audio-clicks');

  /** Decodes the drone once, downmixed to mono at 32 kHz (it is panned anyway), and the knock. */
  async loadPresence(): Promise<void> {
    const output = this.output();
    if (!output || this.presenceBuffer) return;
    const fetchBuffer = async (url: string): Promise<ArrayBuffer | undefined> => {
      try { const response = await fetch(url); return response.ok ? await response.arrayBuffer() : undefined; } catch { return undefined; }
    };
    const [drone, knock] = await Promise.all([fetchBuffer(PRESENCE_URL), fetchBuffer(KNOCK_URL)]);
    if (this.disposed) return;
    try {
      if (knock) this.knockBuffer = await output.context.decodeAudioData(knock);
    } catch { /* a missing knock never blocks the hunt */ }
    if (!drone) return;
    try {
      const decoder = typeof OfflineAudioContext === 'function' ? new OfflineAudioContext(1, 1, 32000) : output.context;
      const decoded = await decoder.decodeAudioData(drone);
      if (this.disposed) return;
      const mono = output.context.createBuffer(1, decoded.length, decoded.sampleRate);
      const target = mono.getChannelData(0), share = 1 / decoded.numberOfChannels;
      for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
        const source = decoded.getChannelData(channel);
        for (let index = 0; index < source.length; index += 1) target[index] = target[index]! + source[index]! * share;
      }
      this.presenceBuffer = mono;
    } catch { /* the hunt goes on in silence */ }
  }

  get hasPresence(): boolean { return !!this.presenceBuffer; }

  /** The drone, looping between its silences, from `offset` seconds into the loop. */
  startPresence(offset: number): void {
    const output = this.output(), buffer = this.presenceBuffer;
    if (this.presence || !output || !buffer || this.disposed) return;
    const { context } = output;
    const source = context.createBufferSource(), filter = context.createBiquadFilter(), panner = context.createStereoPanner(), gain = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = PRESENCE_LOOP_START;
    source.loopEnd = Math.min(PRESENCE_LOOP_END, buffer.duration);
    filter.type = 'lowpass'; filter.frequency.value = 1200; filter.Q.value = 0.3;
    gain.gain.value = 0.0001;
    source.connect(filter).connect(panner).connect(gain).connect(output.destination);
    source.addEventListener('ended', () => { source.disconnect(); filter.disconnect(); panner.disconnect(); gain.disconnect(); }, { once: true });
    const span = source.loopEnd - PRESENCE_LOOP_START;
    source.start(context.currentTime, PRESENCE_LOOP_START + ((offset % span) + span) % span);
    this.presence = { source, filter, panner, gain };
  }

  /**
   * @param level 0 (muted: a silent approach) .. 1 before distance
   * @param occlusion 0 open .. 1 behind walls (muffled)
   */
  setPresence(level: number, distance: number, pan: number, occlusion: number): void {
    const output = this.output(), voice = this.presence;
    if (!output || !voice) return;
    const now = output.context.currentTime;
    const near = Math.pow(THREE.MathUtils.clamp(1 - distance / 48, 0, 1), 1.5);
    const occluded = THREE.MathUtils.clamp(occlusion, 0, 1);
    const gain = Math.max(0.0001, 0.55 * THREE.MathUtils.clamp(level, 0, 1) * (0.1 + 0.9 * near) * (1 - 0.45 * occluded));
    const far = THREE.MathUtils.clamp(distance / 40, 0, 1);
    voice.gain.gain.setTargetAtTime(gain, now, 0.4);
    voice.filter.frequency.setTargetAtTime(THREE.MathUtils.lerp(9000, 650, Math.max(far, occluded * 0.8)), now, 0.25);
    voice.panner.pan.setTargetAtTime(THREE.MathUtils.clamp(pan, -1, 1) * (0.85 - 0.35 * near), now, 0.1);
  }

  stopPresence(fadeSeconds = 1): void {
    const output = this.output();
    if (output) {
      for (const voice of [this.presence, this.breath]) if (voice) this.fadeOut(voice, output.context.currentTime, fadeSeconds);
      if (this.breath) { try { this.breath.lfo.stop(output.context.currentTime + Math.max(0.03, fadeSeconds + 0.02)); } catch { /* stopped */ } }
    }
    this.presence = undefined;
    this.breath = undefined;
    this.setBuzz(0, 0);
  }

  /** Three dry blows, like someone knocking on a door, from the side it comes from. */
  knock(distance: number, pan: number, occlusion: number): void {
    const output = this.output();
    if (!output || this.disposed) return;
    const { context } = output, now = context.currentTime;
    const blocked = THREE.MathUtils.clamp(occlusion, 0, 1);
    const level = 1.15 * (0.3 + 0.7 * THREE.MathUtils.clamp(1 - distance / 32, 0, 1)) * (1 - 0.35 * blocked);
    const filter = context.createBiquadFilter(), panner = context.createStereoPanner(), gain = context.createGain();
    filter.type = 'lowpass'; filter.frequency.value = THREE.MathUtils.lerp(6500, 1500, blocked);
    panner.pan.value = THREE.MathUtils.clamp(pan, -1, 1) * 0.85;
    gain.gain.value = level;
    filter.connect(panner).connect(gain).connect(output.destination);
    const nodes: AudioNode[] = [filter, panner, gain];
    if (this.knockBuffer) {
      const source = context.createBufferSource();
      source.buffer = this.knockBuffer;
      source.playbackRate.value = KNOCK_RATE;
      source.connect(filter);
      source.start(now);
      nodes.push(source);
    }
    // A low thump under each blow: felt as much as heard.
    let last: OscillatorNode | undefined;
    for (const onset of KNOCK_ONSETS) {
      const at = now + onset / KNOCK_RATE, osc = context.createOscillator(), env = context.createGain();
      osc.type = 'sine'; osc.frequency.setValueAtTime(78, at); osc.frequency.exponentialRampToValueAtTime(42, at + 0.12);
      env.gain.setValueAtTime(0.0001, at); env.gain.exponentialRampToValueAtTime(0.55, at + 0.008); env.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
      osc.connect(env).connect(filter); osc.start(at); osc.stop(at + 0.22);
      nodes.push(env);
      last = osc;
    }
    last?.addEventListener('ended', () => { for (const node of nodes) node.disconnect(); }, { once: true });
  }

  /** A tube striking near it: starter click and ballast thunk, placed in the stereo field. */
  ballast(distance: number, pan: number, occlusion: number): void {
    const output = this.output();
    if (!output || this.disposed) return;
    const { context } = output, now = context.currentTime;
    const level = 0.5 * Math.pow(THREE.MathUtils.clamp(1 - distance / 30, 0, 1), 1.3) * (1 - 0.5 * THREE.MathUtils.clamp(occlusion, 0, 1));
    if (level < 0.01) return;
    const panner = context.createStereoPanner(), gain = context.createGain();
    panner.pan.value = THREE.MathUtils.clamp(pan, -1, 1) * 0.8; gain.gain.value = level;
    panner.connect(gain).connect(output.destination);
    const click = context.createBufferSource(), band = context.createBiquadFilter(), clickEnv = context.createGain();
    click.buffer = this.noiseBuffer(context);
    band.type = 'bandpass'; band.frequency.value = 2400 + this.clickRandom.float(0, 1400); band.Q.value = 2.2;
    clickEnv.gain.setValueAtTime(0.0001, now); clickEnv.gain.exponentialRampToValueAtTime(0.9, now + 0.003); clickEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
    click.connect(band).connect(clickEnv).connect(panner);
    click.start(now, this.clickRandom.float(0, 1)); click.stop(now + 0.05);
    const thunk = context.createOscillator(), thunkEnv = context.createGain();
    thunk.type = 'triangle'; thunk.frequency.setValueAtTime(122, now); thunk.frequency.exponentialRampToValueAtTime(64, now + 0.1);
    thunkEnv.gain.setValueAtTime(0.0001, now); thunkEnv.gain.exponentialRampToValueAtTime(0.6, now + 0.006); thunkEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    thunk.connect(thunkEnv).connect(panner); thunk.start(now); thunk.stop(now + 0.18);
    thunk.addEventListener('ended', () => { for (const node of [click, band, clickEnv, thunk, thunkEnv, panner, gain]) node.disconnect(); }, { once: true });
  }

  /** The mains buzz of the misbehaving tubes around it (0 silent). */
  setBuzz(level: number, pan: number): void {
    const output = this.output();
    if (!output) return;
    const { context } = output, now = context.currentTime, value = this.disposed ? 0 : THREE.MathUtils.clamp(level, 0, 1);
    if (!this.buzz) {
      if (value <= 0.001) return;
      const filter = context.createBiquadFilter(), panner = context.createStereoPanner(), gain = context.createGain();
      filter.type = 'bandpass'; filter.frequency.value = 240; filter.Q.value = 1.4;
      gain.gain.value = 0.0001;
      const oscillators = [context.createOscillator(), context.createOscillator()];
      oscillators[0]!.type = 'sawtooth'; oscillators[0]!.frequency.value = 120;
      oscillators[1]!.type = 'square'; oscillators[1]!.frequency.value = 240.6;
      for (const oscillator of oscillators) { oscillator.connect(filter); oscillator.start(); }
      filter.connect(panner).connect(gain).connect(output.destination);
      this.buzz = { oscillators, filter, panner, gain };
    }
    const buzz = this.buzz;
    buzz.gain.gain.setTargetAtTime(0.0001 + value * 0.05, now, 0.05);
    buzz.panner.pan.setTargetAtTime(THREE.MathUtils.clamp(pan, -1, 1) * 0.7, now, 0.1);
    if (value > 0.001) return;
    this.buzz = undefined;
    for (const oscillator of buzz.oscillators) { try { oscillator.stop(now + 0.3); } catch { /* stopped */ } }
    buzz.oscillators[0]!.addEventListener('ended', () => { for (const node of [...buzz.oscillators, buzz.filter, buzz.panner, buzz.gain]) node.disconnect(); }, { once: true });
  }

  /** Its raspy breathing while it lurks or searches (0 silent). */
  setBreath(level: number, distance: number, pan: number, occlusion: number): void {
    const output = this.output();
    if (!output || this.disposed) return;
    const { context } = output, now = context.currentTime;
    const value = THREE.MathUtils.clamp(level, 0, 1) * Math.pow(THREE.MathUtils.clamp(1 - distance / 22, 0, 1), 1.4);
    if (!this.breath) {
      if (value <= 0.002) return;
      const source = context.createBufferSource(), filter = context.createBiquadFilter(), panner = context.createStereoPanner(), gain = context.createGain();
      const lfo = context.createOscillator(), depth = context.createGain(), body = context.createGain();
      source.buffer = this.noiseBuffer(context); source.loop = true;
      filter.type = 'bandpass'; filter.frequency.value = 520; filter.Q.value = 0.9;
      lfo.frequency.value = 0.34; depth.gain.value = 0.5; body.gain.value = 0.5;
      lfo.connect(depth).connect(body.gain);
      gain.gain.value = 0.0001;
      source.connect(filter).connect(body).connect(panner).connect(gain).connect(output.destination);
      source.start(); lfo.start();
      source.addEventListener('ended', () => { for (const node of [source, filter, body, depth, lfo, panner, gain]) node.disconnect(); }, { once: true });
      this.breath = { source, filter, panner, gain, lfo };
    }
    this.breath.gain.gain.setTargetAtTime(Math.max(0.0001, value * 0.28), now, 0.3);
    this.breath.filter.frequency.setTargetAtTime(THREE.MathUtils.lerp(700, 320, THREE.MathUtils.clamp(occlusion, 0, 1)), now, 0.2);
    this.breath.panner.pan.setTargetAtTime(THREE.MathUtils.clamp(pan, -1, 1) * 0.8, now, 0.1);
  }

  /** A dry rattle of clicks from its throat. */
  clicks(distance: number, pan: number, occlusion: number): void {
    const output = this.output();
    if (!output || this.disposed) return;
    const { context } = output, now = context.currentTime;
    const level = 0.45 * Math.pow(THREE.MathUtils.clamp(1 - distance / 24, 0, 1), 1.2) * (1 - 0.5 * THREE.MathUtils.clamp(occlusion, 0, 1));
    if (level < 0.01) return;
    const panner = context.createStereoPanner(), gain = context.createGain(), band = context.createBiquadFilter();
    band.type = 'bandpass'; band.frequency.value = 2600; band.Q.value = 3;
    panner.pan.value = THREE.MathUtils.clamp(pan, -1, 1) * 0.8; gain.gain.value = level;
    band.connect(panner).connect(gain).connect(output.destination);
    const count = this.clickRandom.int(5, 9);
    const nodes: AudioNode[] = [band, panner, gain];
    let at = now, last: AudioBufferSourceNode | undefined;
    for (let index = 0; index < count; index += 1) {
      const source = context.createBufferSource(), env = context.createGain();
      source.buffer = this.noiseBuffer(context);
      env.gain.setValueAtTime(0.0001, at); env.gain.exponentialRampToValueAtTime(1, at + 0.002); env.gain.exponentialRampToValueAtTime(0.0001, at + 0.012);
      source.connect(env).connect(band); source.start(at, this.clickRandom.float(0, 1)); source.stop(at + 0.02);
      nodes.push(source, env);
      last = source;
      at += this.clickRandom.float(0.035, 0.07);
    }
    last?.addEventListener('ended', () => { for (const node of nodes) node.disconnect(); }, { once: true });
  }

  private noiseBuffer(context: BaseAudioContext): AudioBuffer {
    if (this.noise && this.noise.sampleRate === context.sampleRate) return this.noise;
    const length = Math.floor(context.sampleRate * 1.5), buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let state = 0x51f15e;
    for (let index = 0; index < length; index += 1) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      data[index] = ((state >>> 0) / 4294967296) * 2 - 1;
    }
    this.noise = buffer;
    return buffer;
  }

  private fadeOut(voice: SpatialVoice, now: number, fadeSeconds: number): void {
    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now);
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.02, fadeSeconds));
      voice.source.stop(now + Math.max(0.03, fadeSeconds + 0.02));
    } catch {
      // Already stopped.
    }
  }

  /** Hard cut (death card) or fade (the creature walked away). */
  stopAll(fadeSeconds = 0): void {
    const output = this.output();
    const now = output?.context.currentTime ?? 0;
    this.stopPresence(fadeSeconds);
    for (const voice of [this.scream, this.voice]) {
      if (!voice) continue;
      try {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now);
        voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.02, fadeSeconds));
        voice.source.stop(now + Math.max(0.03, fadeSeconds + 0.02));
      } catch {
        // Already stopped.
      }
    }
    try { this.tension?.stop(now + Math.max(0, fadeSeconds)); } catch { /* ended */ }
    // A fade of the creature's voice leaves the fall wind alone; a hard cut does not.
    if (fadeSeconds === 0) this.stopFallWind(0);
    this.scream = undefined;
    this.voice = undefined;
    this.tension = undefined;
    this.duck = 1;
    this.calm = 0;
    this.roarUntil = 0;
    this.screamActive = true;
  }

  private createVoice(id: BufferId, loop: boolean, offset: number): SpatialVoice | undefined {
    const output = this.output();
    const buffer = this.buffers[id];
    if (!output || !buffer) return undefined;
    const { context } = output;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const panner = context.createStereoPanner();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = loop;
    filter.type = 'lowpass';
    filter.frequency.value = 2000;
    filter.Q.value = 0.3;
    gain.gain.value = 0.0001;
    source.connect(filter).connect(panner).connect(gain).connect(output.destination);
    source.addEventListener('ended', () => {
      source.disconnect(); filter.disconnect(); panner.disconnect(); gain.disconnect();
    }, { once: true });
    source.start(context.currentTime, offset);
    return { source, filter, panner, gain };
  }

  dispose(): void {
    if (this.disposed) return;
    this.stopAll(0);
    this.disposed = true;
  }
}
