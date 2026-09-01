/** Contact resistance affects the attacking limb's clock, never the world or input. */
export function advanceStrikeClock(delta: number, compression: number): { step: number; remaining: number } {
  const dt = Math.max(0, delta);
  const resisted = Math.min(dt, Math.max(0, compression));
  return { step: dt - resisted * 0.72, remaining: Math.max(0, compression - dt) };
}

/** Quiet, short body-contact transients. No sound is emitted for a missed hit. */
export class CombatImpactAudio {
  private context?: AudioContext;
  private noise?: AudioBuffer;
  unlock(): void {
    try {
      if (!this.context && typeof window.AudioContext === 'function') this.context = new window.AudioContext();
      if (this.context?.state === 'suspended') void this.context.resume().catch(() => {});
    } catch { /* Audio is optional; gameplay remains available. */ }
  }
  contact(heavy: boolean, body: boolean): void {
    const context = this.context;
    if (!context || context.state !== 'running') return;
    const now = context.currentTime;
    const duration = heavy ? 0.135 : 0.095;
    if (!this.noise) {
      this.noise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.18), context.sampleRate);
      const samples = this.noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    }
    const source = context.createBufferSource(), filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = this.noise;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(body ? 2100 : 2800, now);
    filter.frequency.exponentialRampToValueAtTime(body ? 700 : 1200, now + 0.045);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(heavy ? 0.38 : 0.25, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter).connect(gain).connect(context.destination);
    source.start(now); source.stop(now + duration);
    const thud = context.createOscillator(), bass = context.createGain();
    const bassDuration = heavy ? 0.08 : 0.06;
    thud.frequency.setValueAtTime(heavy ? 85 : 110, now);
    thud.frequency.exponentialRampToValueAtTime(55, now + bassDuration);
    bass.gain.setValueAtTime(0.001, now);
    bass.gain.linearRampToValueAtTime(body ? 0.22 : 0.14, now + 0.002);
    bass.gain.exponentialRampToValueAtTime(0.001, now + bassDuration);
    thud.connect(bass).connect(context.destination); thud.start(now); thud.stop(now + bassDuration);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    thud.onended = () => { thud.disconnect(); bass.disconnect(); };
  }
  dispose(): void { void this.context?.close().catch(() => {}); }
}
