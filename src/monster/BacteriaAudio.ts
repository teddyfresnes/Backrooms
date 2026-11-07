import * as THREE from 'three';

const URLS = {
  tension: '/assets/audio/bacteria/tension.mp3',
  scream: '/assets/audio/bacteria/scream-loop.mp3',
  voice: '/assets/audio/bacteria/voice-lines.mp3',
} as const;

type BufferId = keyof typeof URLS;

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

  /** Hard cut (death card) or fade (the creature walked away). */
  stopAll(fadeSeconds = 0): void {
    const output = this.output();
    const now = output?.context.currentTime ?? 0;
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
