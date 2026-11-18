import { describe, expect, it, vi } from 'vitest';
import { alarmPulse, EnvironmentAudio, synthesizeEnvironmentSound } from './EnvironmentAudio';

class Param { value = 0; setTargetAtTime(v: number) { this.value = v; } setValueAtTime(v: number) { this.value = v; } cancelScheduledValues() {} }
class AudioNodeStub {
  gain = new Param(); frequency = new Param(); Q = new Param(); playbackRate = new Param();
  threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param();
  positionX = new Param(); positionY = new Param(); positionZ = new Param();
  forwardX = new Param(); forwardY = new Param(); forwardZ = new Param(); upX = new Param(); upY = new Param(); upZ = new Param();
  panningModel = ''; distanceModel = ''; refDistance = 0; maxDistance = 0; rolloffFactor = 0; loop = false; buffer: unknown;
  private ended: (() => void)[] = [];
  disconnect = vi.fn(); connect = vi.fn((next: unknown) => next); start = vi.fn();
  stop = vi.fn(() => { this.ended.forEach(f => f()); });
  addEventListener(_name: string, f: () => void) { this.ended.push(f); }
}
const setup = () => {
  const nodes: AudioNodeStub[] = [], make = () => { const node = new AudioNodeStub(); nodes.push(node); return node; };
  const context = { sampleRate: 8000, currentTime: 10, listener: make(),
    createBuffer: (_channels: number, length: number, rate: number) => { const data = new Float32Array(length); return { getChannelData: () => data, sampleRate: rate, duration: length / rate }; },
    createBufferSource: make, createGain: make, createBiquadFilter: make, createPanner: make, createDynamicsCompressor: make,
  };
  return { context, nodes, audio: new EnvironmentAudio(() => ({ context: context as unknown as AudioContext, destination: make() as unknown as AudioNode })) };
};
describe('environmental spatial sound', () => {
  it('produces a bounded temporal-three fire horn whose strobes match audible pulses', () => {
    const { context } = setup();
    const samples = synthesizeEnvironmentSound(context as unknown as AudioContext, 'alarm').getChannelData(0);
    let peak = 0, on = 0, off = 0;
    for (let i = 0; i < samples.length; i++) {
      peak = Math.max(peak, Math.abs(samples[i]!));
      if (alarmPulse(i / context.sampleRate)) on += samples[i]! ** 2; else off += samples[i]! ** 2;
    }
    expect(peak).toBeGreaterThan(.3); expect(peak).toBeLessThan(.9); expect(on).toBeGreaterThan(100); expect(off).toBe(0);
    expect(alarmPulse(.04)).toBe(1); expect(alarmPulse(.4)).toBe(1); expect(alarmPulse(.75)).toBe(1); expect(alarmPulse(1.4)).toBe(0);
  });
  it('uses real 3D panners on the shared bus and disconnects every owned node', () => {
    const { audio, nodes } = setup();
    const voice = audio.play('ring', { x: 12, y: 3, z: -9 }, .7, true)!;
    expect(voice.panner.panningModel).toBe('HRTF'); expect(voice.panner.distanceModel).toBe('inverse');
    expect(voice.panner.positionX.value).toBe(12); expect(voice.panner.positionZ.value).toBe(-9);
    const owned = nodes.slice(-4); voice.stop(10);
    expect(owned.every(n => n.disconnect.mock.calls.length === 1)).toBe(true);
    audio.dispose(); expect(audio.play('click', { x: 0, y: 0, z: 0 })).toBeUndefined();
  });
  it('bounds active voices during long overlapping splash and drip sequences', () => {
    const { audio } = setup();
    const voices = Array.from({ length: 300 }, () => audio.play('drip', { x: 1, y: 0, z: 2 })).filter(Boolean);
    expect(voices).toHaveLength(28);
    voices[0]!.stop(10);
    expect(audio.play('splash', { x: 0, y: 0, z: 0 })).toBeDefined(); audio.dispose();
  });
});
