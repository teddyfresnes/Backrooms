import type { AudioOutput } from '../monster/BacteriaAudio';

/** Descent speed (m/s) where air noise starts: steps, stairs and jumps stay silent. */
export const FALL_WIND_ONSET = 4.5;
/** Speed at which the roar reaches its full, still unsaturated level (~5 storeys). */
export const FALL_WIND_FULL = 24;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Level and low-pass cutoff of the rushing air for a descent speed. The cutoff
 * stays under ~1.7 kHz: a falling body hears a dark roar, never a whistle. */
export const fallWindShape = (speed: number): { level: number; cutoff: number; flutter: number } => {
  const t = clamp01((speed - FALL_WIND_ONSET) / (FALL_WIND_FULL - FALL_WIND_ONSET));
  const eased = t * t * (3 - 2 * t);
  return { level: .5 * Math.pow(eased, 1.15), cutoff: 240 + 1450 * eased, flutter: .07 * eased * eased };
};

/** Brown noise (integrated white noise): the deep broadband body of moving air. */
const brownNoise = (context: BaseAudioContext, seconds: number, seed: number): AudioBuffer => {
  const buffer = context.createBuffer(2, Math.ceil(context.sampleRate * seconds), context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let state = seed + channel * 7919, last = 0;
    for (let i = 0; i < data.length; i++) {
      state = (state * 1664525 + 1013904223) >>> 0;
      last = (last + .02 * ((state / 4294967296) * 2 - 1)) / 1.02;
      data[i] = last * 3.2;
    }
    // Crossfade the loop seam so the roar never clicks or pulses.
    const fade = Math.floor(context.sampleRate * .08);
    for (let i = 0; i < fade; i++) { const w = i / fade; data[i] = data[i]! * w + data[data.length - fade + i]! * (1 - w); }
  }
  return buffer;
};

/** Air rushing past a falling body: a low roar whose level and brightness follow
 * the descent, slow turbulent buffeting and a soft cloth flutter at speed. It is
 * filtered noise only (no oscillator tone), on the shared master bus. */
export class FallAudio {
  private graph?: {
    context: BaseAudioContext; roarSource: AudioBufferSourceNode; flutterSource: AudioBufferSourceNode; lfo: OscillatorNode;
    roarFilter: BiquadFilterNode; roarGain: GainNode; flutterGain: GainNode; flutterDepth: GainNode; pan: StereoPannerNode; master: GainNode;
  };
  private speed = 0;
  private time = 0;
  private lastY?: number;
  private disposed = false;
  constructor(private readonly output: () => AudioOutput | null) {}

  /** `y` is the listener's world height this frame; teleports are ignored. */
  update(delta: number, y: number, active: boolean): void {
    if (this.disposed) return;
    const dt = Math.max(0, Math.min(.1, delta));
    let speed = 0;
    if (this.lastY !== undefined && delta > 0) {
      // The real elapsed time: a slow frame must not read as a faster fall.
      const drop = this.lastY - y;
      speed = Math.abs(drop) > 6 ? 0 : Math.max(0, drop / Math.max(delta, 1 / 240));
    }
    this.lastY = y;
    // A short smoothing hides per-frame jitter from the body or the camera rig.
    this.speed += (speed - this.speed) * (1 - Math.exp(-dt * 10));
    this.time += dt;
    const shape = fallWindShape(active ? this.speed : 0);
    if (shape.level <= .0005 && !this.graph) return;
    const graph = this.ensureGraph(); if (!graph) return;
    const now = graph.context.currentTime;
    // Buffeting: two incommensurate slow swells, deeper as the speed builds.
    const gust = 1 + .22 * Math.sin(this.time * 4.3) * Math.sin(this.time * 1.27 + 1.1) * Math.min(1, shape.level * 3);
    const falling = shape.level > graph.roarGain.gain.value;
    graph.roarGain.gain.setTargetAtTime(shape.level * gust, now, falling ? .12 : .07);
    graph.roarFilter.frequency.setTargetAtTime(shape.cutoff * (.92 + .08 * gust), now, .1);
    graph.flutterGain.gain.setTargetAtTime(shape.flutter, now, .15);
    graph.flutterDepth.gain.setTargetAtTime(shape.flutter * .8, now, .15);
    graph.lfo.frequency.setTargetAtTime(9 + 6 * Math.min(1, shape.level * 2), now, .2);
    graph.pan.pan.setTargetAtTime(.18 * Math.sin(this.time * .9), now, .3);
  }

  private ensureGraph() {
    if (this.graph) return this.graph;
    const out = this.output(); if (!out) return undefined;
    const { context } = out;
    const roarSource = context.createBufferSource(), flutterSource = context.createBufferSource();
    roarSource.buffer = brownNoise(context, 7.3, 977); roarSource.loop = true;
    flutterSource.buffer = brownNoise(context, 5.1, 4421); flutterSource.loop = true; flutterSource.playbackRate.value = 3.1;
    const roarFilter = context.createBiquadFilter(); roarFilter.type = 'lowpass'; roarFilter.frequency.value = 240; roarFilter.Q.value = .4;
    const body = context.createBiquadFilter(); body.type = 'lowshelf'; body.frequency.value = 140; body.gain.value = 5;
    const roarGain = context.createGain(); roarGain.gain.value = 0;
    // Cloth flutter: band-limited noise amplitude-modulated around 9-15 Hz.
    const flutterFilter = context.createBiquadFilter(); flutterFilter.type = 'bandpass'; flutterFilter.frequency.value = 650; flutterFilter.Q.value = .9;
    const flutterGain = context.createGain(); flutterGain.gain.value = 0;
    const flutterDepth = context.createGain(); flutterDepth.gain.value = 0;
    const lfo = context.createOscillator(); lfo.frequency.value = 9;
    lfo.connect(flutterDepth).connect(flutterGain.gain);
    const pan = context.createStereoPanner(), master = context.createGain(); master.gain.value = .9;
    roarSource.connect(roarFilter).connect(body).connect(roarGain).connect(pan);
    flutterSource.connect(flutterFilter).connect(flutterGain).connect(pan);
    pan.connect(master).connect(out.destination);
    roarSource.start(); flutterSource.start(); lfo.start();
    this.graph = { context, roarSource, flutterSource, lfo, roarFilter, roarGain, flutterGain, flutterDepth, pan, master };
    return this.graph;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const graph = this.graph; this.graph = undefined;
    if (!graph) return;
    for (const node of [graph.roarSource, graph.flutterSource, graph.lfo]) { try { node.stop(); } catch { /* already stopped */ } }
    graph.master.disconnect(); graph.pan.disconnect();
  }
}
