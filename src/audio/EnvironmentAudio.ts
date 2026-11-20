import { SeededRandom } from '../world/SeededRandom';
import type { Vec3Data } from '../world/types';
import type { AudioOutput } from '../monster/BacteriaAudio';

export type EnvironmentSound = 'alarm' | 'ring' | 'breath' | 'splash' | 'drip' | 'servo' | 'click' | 'hangup' | 'step' | 'ballast' | 'warning';
export const ALARM_PERIOD = 2.4;
export const ENVIRONMENT_AUDIO_URLS = {
  warning: '/assets/audio/environment/telephone-warning.ogg',
  alarm: '/assets/audio/environment/danger-alarm.ogg',
} as const;
const smooth = (value: number, from: number, to: number): number => {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};
/** Additional range and floor isolation, on top of the panner's continuous falloff. */
export const alarmAudibility = (distance: number, floorDelta: number, occlusion = 0): number =>
  .85 * (1 - smooth(distance, 24, 48)) * (1 - smooth(Math.abs(floorDelta), .4, 2.2))
    * (1 - .65 * Math.max(0, Math.min(1, occlusion)));
export const alarmPulse = (seconds: number): number => {
  const phase = ((seconds % ALARM_PERIOD) + ALARM_PERIOD) % ALARM_PERIOD;
  return [0, .35, .7].some(start => phase >= start && phase < start + .18) ? 1 : 0;
};
const durations: Record<Exclude<EnvironmentSound, 'warning'>, number> = {
  alarm: ALARM_PERIOD, ring: 4.6, breath: 4.4, splash: .42, drip: .28, servo: 1.6, click: .1, hangup: .22, step: .32, ballast: .09,
};

/** Small authored mono signals. They are cached once per AudioContext; they are
 * actual continuous fire horns, struck bells, resonant water and motor sounds,
 * rather than oscillators/timers left alive in every generated chunk. */
export const synthesizeEnvironmentSound = (context: BaseAudioContext, kind: Exclude<EnvironmentSound, 'warning'>): AudioBuffer => {
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * durations[kind]), context.sampleRate);
  const data = buffer.getChannelData(0), rng = new SeededRandom(`environment-audio-v1:${kind}`);
  let low = 0, band = 0, phase = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / context.sampleRate, noise = rng.float(-1, 1);
    low += .09 * (noise - low); band += .35 * (noise - band);
    let v = 0;
    switch (kind) {
      case 'alarm': {
        const p = t % .35, edge = Math.min(1, p / .008, Math.max(0, (.18 - p) / .012));
        phase += 2 * Math.PI * (840 + 95 * Math.sin(t * Math.PI * 5)) / context.sampleRate;
        v = alarmPulse(t) * edge * (Math.sin(phase) * .45 + Math.sin(phase * 3) * .13 + Math.sin(phase * 5) * .045); break;
      }
      case 'ring': {
        if (t >= 1.9) break;
        const strike = t % .043, envelope = Math.exp(-strike * 70);
        v = envelope * (Math.sin(t * 2 * Math.PI * 1650) * .28 + Math.sin(t * 2 * Math.PI * 2146) * .18 + Math.sin(t * 2 * Math.PI * 2813) * .1); break;
      }
      case 'breath': {
        const p = t / durations.breath;
        const envelope = Math.pow(Math.max(0, Math.sin(p * 2 * Math.PI)), 1.4) * .7
          + Math.pow(Math.max(0, -Math.sin(p * 2 * Math.PI)), 1.7) * .48;
        v = (band - low) * envelope * .7; break;
      }
      case 'splash': {
        const bubbles = Math.sin((720 * t - 1050 * t * t) * Math.PI * 2) * .23;
        v = (noise * .38 + low * 1.8 + bubbles) * Math.exp(-t * 13) * Math.min(1, t * 400); break;
      }
      case 'drip': v = Math.sin(2 * Math.PI * (1600 * t - 1700 * t * t)) * Math.exp(-t * 30) * .4 + noise * Math.exp(-t * 160) * .15; break;
      case 'servo': v = (Math.sin(t * 2 * Math.PI * 173) + Math.sin(t * 2 * Math.PI * 349) * .28 + noise * .13) * (.8 + .2 * Math.sin(t * Math.PI * 46)) * .055; break;
      case 'step': v = (low * 2.2 + Math.sin(t * 440)) * Math.exp(-t * 24) * Math.min(1, t * 260) * .32; break;
      case 'hangup': v = (noise * .3 + Math.sin(t * 1320) * .5) * Math.exp(-t * 38) + (t > .085 ? noise * .35 * Math.exp(-(t - .085) * 85) : 0); break;
      case 'click': case 'ballast': v = (noise + Math.sin(t * 7900) * .4) * Math.exp(-t * 110) * .32; break;
    }
    data[i] = Math.max(-.9, Math.min(.9, v));
  }
  return buffer;
};

export class EnvironmentVoice {
  private stopped = false;
  constructor(readonly source: AudioBufferSourceNode, readonly gain: GainNode, readonly panner: PannerNode, private readonly filter: BiquadFilterNode) {
    source.addEventListener('ended', () => { source.disconnect(); gain.disconnect(); panner.disconnect(); filter.disconnect(); }, { once: true });
  }
  setPosition(p: Vec3Data, time: number): void {
    this.panner.positionX.setTargetAtTime(p.x, time, .025);
    this.panner.positionY.setTargetAtTime(p.y, time, .025);
    this.panner.positionZ.setTargetAtTime(p.z, time, .025);
  }
  setGain(value: number, time: number, smoothing = .04): void { if (!this.stopped) this.gain.gain.setTargetAtTime(Math.max(0, value), time, smoothing); }
  muffle(value: number, time: number): void { this.filter.frequency.setTargetAtTime(14000 - value * 13000, time, .15); }
  stop(time: number, fade = .06): void {
    if (this.stopped) return;
    this.stopped = true;
    this.gain.gain.cancelScheduledValues(time);
    this.gain.gain.setTargetAtTime(0, time, Math.max(.005, fade / 4));
    try { this.source.stop(time + fade); } catch { /* already ended */ }
  }
}

export class EnvironmentAudio {
  private readonly buffers = new Map<EnvironmentSound, AudioBuffer>();
  private readonly voices = new Set<EnvironmentVoice>();
  private bus?: DynamicsCompressorNode;
  private disposed = false;
  private loadReady?: Promise<void>;
  private readonly abort = new AbortController();
  private alarmEnvelope?: Float32Array;
  constructor(private readonly output: () => AudioOutput | null) {}
  get time(): number { return this.output()?.context.currentTime ?? 0; }
  get warningDuration(): number { return this.buffers.get('warning')?.duration ?? 2.7; }
  alarmLevel(seconds: number): number {
    const envelope = this.alarmEnvelope, duration = this.buffers.get('alarm')?.duration;
    if (!envelope || !duration) return alarmPulse(seconds);
    const phase = ((seconds % duration) + duration) % duration;
    return envelope[Math.min(envelope.length - 1, Math.floor(phase / duration * envelope.length))]!;
  }
  load(): Promise<void> {
    return this.loadReady ??= (async () => {
      const out = this.output(); if (!out) return;
      await Promise.all((Object.keys(ENVIRONMENT_AUDIO_URLS) as (keyof typeof ENVIRONMENT_AUDIO_URLS)[]).map(async kind => {
        const response = await fetch(ENVIRONMENT_AUDIO_URLS[kind], { signal: this.abort.signal });
        if (!response.ok) throw new Error(`Son environnemental introuvable : ${kind}`);
        const decoded = await out.context.decodeAudioData(await response.arrayBuffer());
        if (this.disposed) return;
        this.buffers.set(kind, decoded);
        if (kind === 'alarm') {
          const samples = decoded.getChannelData(0), count = Math.ceil(decoded.duration * 25);
          const envelope = new Float32Array(count); let peak = .001;
          for (let i = 0; i < count; i++) {
            const from = Math.floor(i * samples.length / count), to = Math.floor((i + 1) * samples.length / count);
            let energy = 0; for (let sample = from; sample < to; sample++) energy += samples[sample]! ** 2;
            envelope[i] = Math.sqrt(energy / Math.max(1, to - from)); peak = Math.max(peak, envelope[i]!);
          }
          for (let i = 0; i < count; i++) envelope[i] = envelope[i]! / peak;
          this.alarmEnvelope = envelope;
        }
      }));
    })();
  }
  updateListener(position: Vec3Data, forward: Vec3Data, up: Vec3Data): void {
    const context = this.output()?.context; if (!context) return;
    const l = context.listener, now = context.currentTime;
    if (l.positionX) {
      for (const [param, v] of [[l.positionX, position.x], [l.positionY, position.y], [l.positionZ, position.z],
        [l.forwardX, forward.x], [l.forwardY, forward.y], [l.forwardZ, forward.z], [l.upX, up.x], [l.upY, up.y], [l.upZ, up.z]] as const) param.setValueAtTime(v, now);
    } else { l.setPosition(position.x, position.y, position.z); l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z); }
  }
  play(kind: EnvironmentSound, position: Vec3Data, gainValue = .4, loop = false, offset = 0, referenceDistance = 1.5, rate = 1): EnvironmentVoice | undefined {
    const out = this.output(); if (!out || this.disposed) return;
    const { context } = out;
    let buffer = this.buffers.get(kind);
    if (!buffer && kind !== 'warning') { buffer = synthesizeEnvironmentSound(context, kind); this.buffers.set(kind, buffer); }
    if (!buffer) return;
    if (!this.bus) {
      this.bus = context.createDynamicsCompressor();
      this.bus.threshold.value = -10; this.bus.knee.value = 12; this.bus.ratio.value = 5;
      this.bus.attack.value = .008; this.bus.release.value = .22;
      this.bus.connect(out.destination);
    }
    // Hard budget includes transient sounds. Distant drips never accumulate.
    if (this.voices.size >= 28) return;
    const source = context.createBufferSource(), gain = context.createGain(), panner = context.createPanner(), filter = context.createBiquadFilter();
    source.buffer = buffer; source.loop = loop; source.playbackRate.value = rate;
    gain.gain.value = Math.max(0, Math.min(1.2, gainValue));
    panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse'; panner.refDistance = referenceDistance; panner.rolloffFactor = 1.2; panner.maxDistance = 10000;
    panner.positionX.value = position.x; panner.positionY.value = position.y; panner.positionZ.value = position.z;
    filter.type = 'lowpass'; filter.frequency.value = 14000; filter.Q.value = .3;
    source.connect(filter).connect(gain).connect(panner).connect(this.bus);
    const voice = new EnvironmentVoice(source, gain, panner, filter);
    this.voices.add(voice);
    source.addEventListener('ended', () => this.voices.delete(voice), { once: true });
    source.start(context.currentTime, loop ? ((offset % buffer.duration) + buffer.duration) % buffer.duration : 0);
    return voice;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.abort.abort();
    for (const voice of this.voices) voice.stop(this.time, 0);
    this.voices.clear(); this.buffers.clear(); this.alarmEnvelope = undefined; this.bus?.disconnect();
  }
}
