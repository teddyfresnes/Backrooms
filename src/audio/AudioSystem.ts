import type { RoomKind } from '../world/types';

const createLoopSource = (
  context: AudioContext,
  buffer: AudioBuffer,
  destination: AudioNode,
  offset = 0,
): AudioBufferSourceNode => {
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(destination);
  source.start(0, Math.min(offset, Math.max(0, buffer.duration - 0.01)));
  return source;
};

export class AudioSystem {
  private context?: AudioContext;
  private master?: GainNode;
  private humGain?: GainNode;
  private ventGain?: GainNode;
  private lowpass?: BiquadFilterNode;
  private footstepNoise?: AudioBuffer;
  private sources: AudioScheduledSourceNode[] = [];
  private started = false;
  private stepSide = -1;

  async start(): Promise<void> {
    if (this.started) {
      await this.context?.resume();
      return;
    }
    this.started = true;
    this.context = new AudioContext({ latencyHint: 'interactive' });
    const context = this.context;
    this.master = context.createGain();
    this.master.gain.value = 0.42;
    this.lowpass = context.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 6200;
    this.lowpass.Q.value = 0.25;
    this.lowpass.connect(this.master);
    this.master.connect(context.destination);

    this.humGain = context.createGain();
    this.ventGain = context.createGain();
    this.humGain.gain.value = 0.17;
    this.ventGain.gain.value = 0.12;
    this.humGain.connect(this.lowpass);
    this.ventGain.connect(this.lowpass);

    const [humBuffer, ventilationBuffer] = await Promise.all([
      this.loadBuffer('/assets/audio/fluorescent-hum-cc0.mp3'),
      this.loadBuffer('/assets/audio/ventilation-cc0.mp3'),
    ]);
    if (humBuffer) this.sources.push(createLoopSource(context, humBuffer, this.humGain, 3.7));
    if (ventilationBuffer) this.sources.push(createLoopSource(context, ventilationBuffer, this.ventGain, 8.1));
    this.createElectricalBed();
    this.footstepNoise = this.createNoiseBuffer(0.18);
  }

  private async loadBuffer(url: string): Promise<AudioBuffer | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      return await this.context!.decodeAudioData(await response.arrayBuffer());
    } catch {
      return null;
    }
  }

  private createElectricalBed(): void {
    if (!this.context || !this.lowpass) return;
    const context = this.context;
    const bus = context.createGain();
    bus.gain.value = 0.017;
    bus.connect(this.lowpass);
    [50, 100, 150, 205].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = index % 2 === 0 ? 'sine' : 'triangle';
      oscillator.frequency.value = frequency + index * 0.37;
      gain.gain.value = 1 / (index + 1.2);
      oscillator.connect(gain).connect(bus);
      oscillator.start();
      this.sources.push(oscillator);
    });
  }

  private createNoiseBuffer(duration: number): AudioBuffer {
    const context = this.context!;
    const length = Math.ceil(context.sampleRate * duration);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let state = 0x1234abcd;
    for (let index = 0; index < length; index += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      data[index] = (((state >>> 0) / 2147483648) - 1) * (1 - index / length);
    }
    return buffer;
  }

  footstep(strength: number): void {
    if (!this.context || !this.master || !this.footstepNoise) return;
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    source.buffer = this.footstepNoise;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(520 + strength * 310, now);
    filter.frequency.exponentialRampToValueAtTime(115, now + 0.15);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.15 * strength, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);
    this.stepSide *= -1;
    panner.pan.value = this.stepSide * 0.11;
    source.connect(filter).connect(gain).connect(panner).connect(this.master);
    source.start(now);
    source.stop(now + 0.19);
  }

  update(room: RoomKind): void {
    if (!this.context || !this.humGain || !this.ventGain || !this.lowpass) return;
    const now = this.context.currentTime;
    const sparse = room === 'sparse';
    const cavernous = room === 'open-hall' || room === 'pit-gallery';
    this.humGain.gain.setTargetAtTime(sparse ? 0.105 : 0.17, now, 0.8);
    this.ventGain.gain.setTargetAtTime(cavernous ? 0.19 : sparse ? 0.085 : 0.12, now, 1.3);
    this.lowpass.frequency.setTargetAtTime(cavernous ? 7600 : 5900, now, 0.75);
  }

  impact(): void {
    if (!this.context || !this.master) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(58, now);
    oscillator.frequency.exponentialRampToValueAtTime(27, now + 0.45);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.5);
  }

  async setSuspended(suspended: boolean): Promise<void> {
    if (!this.context) return;
    if (suspended) await this.context.suspend();
    else await this.context.resume();
  }

  dispose(): void {
    this.sources.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    });
    void this.context?.close();
  }
}
