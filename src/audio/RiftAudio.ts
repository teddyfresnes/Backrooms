import { SeededRandom } from '../world/SeededRandom';

export interface RiftAudioOutput { readonly context: AudioContext; readonly destination: AudioNode }

/**
 * Synthesised layer of the rift: wood creaking under the walker, the heart
 * racing on the plank, the sub-bass hit when something follows, and the board
 * clattering down the shaft. Every voice lives on the runtime's own context
 * and master bus (pause and volume apply) and frees its nodes when it ends.
 */
export class RiftAudio {
  private noise?: AudioBuffer;
  private readonly random = new SeededRandom('rift-audio');
  private heartTimer = 0;
  private breathTimer = 0;
  private inhale = true;
  private disposed = false;

  constructor(private readonly output: () => RiftAudioOutput | null) {}

  private noiseBuffer(context: AudioContext): AudioBuffer {
    if (this.noise && this.noise.sampleRate === context.sampleRate) return this.noise;
    const length = Math.floor(context.sampleRate * 1.5), buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0); let state = 0x2545f491;
    for (let i = 0; i < length; i += 1) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      data[i] = ((state >>> 0) / 4294967296) * 2 - 1;
    }
    this.noise = buffer;
    return buffer;
  }

  private release(nodes: readonly AudioNode[], source: AudioScheduledSourceNode): void {
    source.addEventListener('ended', () => { for (const node of nodes) node.disconnect(); }, { once: true });
  }

  /** A dry wooden groan; `strain` 0..1 lowers and lengthens it. */
  creak(strain = 0.5, gain = 0.5): void {
    const output = this.output(); if (!output || this.disposed) return;
    const { context } = output, now = context.currentTime, s = Math.min(1, Math.max(0, strain));
    const source = context.createBufferSource(), band = context.createBiquadFilter(), body = context.createGain();
    source.buffer = this.noiseBuffer(context);
    band.type = 'bandpass'; band.Q.value = 9 + 10 * s;
    const pitch = (620 - 330 * s) * this.random.float(0.85, 1.15), length = 0.18 + 0.32 * s;
    band.frequency.setValueAtTime(pitch * 1.25, now);
    band.frequency.exponentialRampToValueAtTime(pitch * 0.7, now + length);
    // Stick-slip grain: a fast tremolo over the envelope.
    const tremolo = context.createOscillator(), depth = context.createGain();
    tremolo.frequency.value = 38 + 30 * this.random.float(0, 1); depth.gain.value = 0.45;
    body.gain.setValueAtTime(0.0001, now);
    body.gain.exponentialRampToValueAtTime(Math.max(0.001, gain * (0.6 + 0.6 * s)), now + 0.03);
    body.gain.exponentialRampToValueAtTime(0.0001, now + length);
    tremolo.connect(depth).connect(body.gain);
    source.connect(band).connect(body).connect(output.destination);
    source.start(now, this.random.float(0, 1)); source.stop(now + length + 0.05);
    tremolo.start(now); tremolo.stop(now + length + 0.05);
    this.release([band, body, depth, tremolo], source);
  }

  /** Heartbeat paced by fear (0 calm .. 1 panic); call every frame while it matters. */
  heartbeat(delta: number, fear: number): void {
    if (fear <= 0.02) { this.heartTimer = 0; return; }
    this.heartTimer -= delta;
    if (this.heartTimer > 0) return;
    const bpm = 78 + 82 * Math.min(1, fear);
    this.heartTimer = 60 / bpm;
    this.thump(0.32 + 0.5 * fear, 0);
    this.thump(0.22 + 0.35 * fear, 0.16);
  }

  /**
   * The player's own breath, paced by effort (0 rested .. 1 panting); call
   * every frame. Silent when rested, ragged and fast when spent.
   */
  breath(delta: number, effort: number): void {
    const level = Math.min(1, Math.max(0, effort));
    if (level <= 0.12) { this.breathTimer = Math.min(this.breathTimer, 0.4); return; }
    this.breathTimer -= delta;
    if (this.breathTimer > 0) return;
    const cycle = 3.6 - 2.85 * level;
    this.breathTimer = cycle * (this.inhale ? 0.42 : 0.58) * this.random.float(0.88, 1.12);
    this.gasp(this.inhale, level, this.breathTimer);
    this.inhale = !this.inhale;
  }

  private gasp(inhale: boolean, level: number, length: number): void {
    const output = this.output(); if (!output || this.disposed) return;
    const { context } = output, now = context.currentTime, duration = Math.max(0.18, length * 0.82);
    const source = context.createBufferSource(), band = context.createBiquadFilter(), env = context.createGain();
    source.buffer = this.noiseBuffer(context);
    band.type = 'bandpass'; band.Q.value = inhale ? 1.6 : 1.1;
    band.frequency.setValueAtTime(inhale ? 900 : 1250, now);
    band.frequency.linearRampToValueAtTime(inhale ? 1500 : 620, now + duration);
    const peak = Math.max(0.002, 0.2 * Math.pow(level, 1.3) * (inhale ? 0.8 : 1));
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(peak, now + duration * (inhale ? 0.55 : 0.18));
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(band).connect(env).connect(output.destination);
    source.start(now, this.random.float(0, 1)); source.stop(now + duration + 0.05);
    this.release([band, env], source);
  }

  private thump(gain: number, delay: number): void {
    const output = this.output(); if (!output || this.disposed) return;
    const { context } = output, at = context.currentTime + delay;
    const osc = context.createOscillator(), env = context.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(62, at); osc.frequency.exponentialRampToValueAtTime(38, at + 0.14);
    env.gain.setValueAtTime(0.0001, at); env.gain.exponentialRampToValueAtTime(gain, at + 0.012); env.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    osc.connect(env).connect(output.destination); osc.start(at); osc.stop(at + 0.24);
    this.release([env], osc);
  }

  /** The dread hit: a sub-bass drop under a reversed-sounding noise swell. */
  stinger(): void {
    const output = this.output(); if (!output || this.disposed) return;
    const { context } = output, now = context.currentTime;
    const osc = context.createOscillator(), env = context.createGain();
    osc.type = 'triangle'; osc.frequency.setValueAtTime(96, now); osc.frequency.exponentialRampToValueAtTime(27, now + 2.4);
    env.gain.setValueAtTime(0.0001, now); env.gain.exponentialRampToValueAtTime(1.15, now + 0.04); env.gain.exponentialRampToValueAtTime(0.0001, now + 2.8);
    osc.connect(env).connect(output.destination); osc.start(now); osc.stop(now + 2.9);
    this.release([env], osc);
    const source = context.createBufferSource(), filter = context.createBiquadFilter(), swell = context.createGain();
    source.buffer = this.noiseBuffer(context); source.loop = true;
    filter.type = 'bandpass'; filter.Q.value = 1.4; filter.frequency.setValueAtTime(300, now); filter.frequency.exponentialRampToValueAtTime(2600, now + 1.1);
    swell.gain.setValueAtTime(0.0001, now); swell.gain.exponentialRampToValueAtTime(0.42, now + 1.05); swell.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
    source.connect(filter).connect(swell).connect(output.destination); source.start(now); source.stop(now + 1.55);
    this.release([filter, swell], source);
  }

  /** The board scraping off the ledge, then knocking against the shaft as it falls away. */
  plankFall(): void {
    const output = this.output(); if (!output || this.disposed) return;
    const { context } = output, now = context.currentTime;
    const scrape = context.createBufferSource(), band = context.createBiquadFilter(), env = context.createGain();
    scrape.buffer = this.noiseBuffer(context);
    band.type = 'bandpass'; band.Q.value = 3; band.frequency.setValueAtTime(900, now); band.frequency.exponentialRampToValueAtTime(420, now + 0.5);
    env.gain.setValueAtTime(0.0001, now); env.gain.exponentialRampToValueAtTime(0.7, now + 0.05); env.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    scrape.connect(band).connect(env).connect(output.destination); scrape.start(now); scrape.stop(now + 0.65);
    this.release([band, env], scrape);
    // Ever fainter knocks: the shaft has no bottom to land on.
    for (let index = 0; index < 6; index += 1) {
      const at = now + 0.75 + index * (0.42 + index * 0.18), level = 0.62 * Math.pow(0.58, index);
      const osc = context.createOscillator(), knock = context.createGain(), lowpass = context.createBiquadFilter();
      osc.type = 'square'; osc.frequency.setValueAtTime(this.random.float(140, 210), at); osc.frequency.exponentialRampToValueAtTime(70, at + 0.09);
      lowpass.type = 'lowpass'; lowpass.frequency.value = 1800 - index * 230;
      knock.gain.setValueAtTime(0.0001, at); knock.gain.exponentialRampToValueAtTime(level, at + 0.005); knock.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      osc.connect(lowpass).connect(knock).connect(output.destination); osc.start(at); osc.stop(at + 0.18);
      this.release([lowpass, knock], osc);
    }
  }

  dispose(): void { this.disposed = true; }
}
