import { describe, expect, it, vi } from 'vitest';
import { FALL_WIND_FULL, FALL_WIND_ONSET, FallAudio, fallWindShape } from './FallAudio';

class Param { value = 0; setTargetAtTime = vi.fn((v: number) => { this.value = v; }); }
const node = () => ({ connect: vi.fn(function (this: unknown, next: unknown) { return next; }), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(),
  gain: new Param(), frequency: new Param(), Q: new Param(), pan: new Param(), playbackRate: new Param(), type: '', loop: false, buffer: null as unknown });
const setup = () => {
  const nodes: ReturnType<typeof node>[] = [], make = () => { const n = node(); nodes.push(n); return n; };
  const context = { sampleRate: 8000, currentTime: 0, createBuffer: (channels: number, length: number) => {
    const data = Array.from({ length: channels }, () => new Float32Array(length)); return { getChannelData: (c: number) => data[c]! }; },
  createBufferSource: make, createBiquadFilter: make, createGain: make, createOscillator: make, createStereoPanner: make };
  const audio = new FallAudio(() => ({ context: context as unknown as AudioContext, destination: make() as unknown as AudioNode }));
  return { audio, nodes };
};
const fall = (audio: FallAudio, from: number, speed: number, seconds: number, step = 1 / 60) => {
  let y = from;
  for (let t = 0; t < seconds; t += step) { y -= speed * step; audio.update(step, y, true); }
  return y;
};
describe('rushing air while falling', () => {
  it('stays silent for steps and jumps, then builds a dark roar with the descent speed', () => {
    expect(fallWindShape(FALL_WIND_ONSET - .5).level).toBe(0);
    expect(fallWindShape(10).level).toBeGreaterThan(0);
    expect(fallWindShape(20).level).toBeGreaterThan(fallWindShape(10).level);
    expect(fallWindShape(FALL_WIND_FULL * 2).level).toBeLessThanOrEqual(.5);
    // Never a whistle: the brightest roar stays under 1.7 kHz.
    expect(fallWindShape(80).cutoff).toBeLessThan(1700);
  });
  it('creates no audio graph for ordinary movement, follows a real fall and ignores teleports', () => {
    const { audio, nodes } = setup();
    fall(audio, 10, 3, 2);
    expect(nodes).toHaveLength(0);
    const y = fall(audio, 10, 15, 1);
    const roar = nodes.find(n => n.gain.setTargetAtTime.mock.calls.length > 0 && n.gain.value > .05);
    expect(roar).toBeDefined();
    audio.update(1 / 60, y + 50, true); audio.update(1 / 60, y + 50, true);
    for (let i = 0; i < 60; i++) audio.update(1 / 60, y + 50, true);
    expect(roar!.gain.value).toBeLessThan(.02);
    audio.dispose(); expect(nodes.filter(n => n.stop.mock.calls.length).length).toBe(3);
  });
});
