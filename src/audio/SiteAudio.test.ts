// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SiteAudio } from './SiteAudio';
import { chooseMenuTrack } from './MenuMusic';
import { connectAudioOutput } from './output';

class Param {
  value = 0;
  setTargetAtTime(value: number) { this.value = value; }
  setValueAtTime(value: number) { this.value = value; }
  exponentialRampToValueAtTime(value: number) { this.value = value; }
}
class AudioNodeMock extends EventTarget {
  gain = new Param(); playbackRate = new Param();
  threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param();
  connections: AudioNodeMock[] = [];
  buffer?: AudioBuffer;
  starts: number[][] = [];
  connect(target: AudioNodeMock) { this.connections.push(target); return target; }
  disconnect = vi.fn();
  start(...args: number[]) { this.starts.push(args); }
  stop() { this.dispatchEvent(new Event('ended')); }
}
class ContextMock {
  static latest: ContextMock;
  state = 'suspended'; currentTime = 0; sampleRate = 8000;
  destination = new AudioNodeMock();
  gains: AudioNodeMock[] = []; sources: AudioNodeMock[] = []; compressors: AudioNodeMock[] = [];
  media?: AudioNodeMock;
  constructor() { ContextMock.latest = this; }
  createGain() { const node = new AudioNodeMock(); this.gains.push(node); return node; }
  createDynamicsCompressor() { const node = new AudioNodeMock(); this.compressors.push(node); return node; }
  createMediaElementSource() { return this.media = new AudioNodeMock(); }
  createBufferSource() { const node = new AudioNodeMock(); this.sources.push(node); return node; }
  createBuffer(channels: number, length: number, rate: number) {
    const samples = new Float32Array(length);
    return { duration: length / rate, length, sampleRate: rate, numberOfChannels: channels,
      getChannelData: () => samples, copyFromChannel() {}, copyToChannel() {} } as AudioBuffer;
  }
  decodeAudioData = vi.fn(async () => this.createBuffer(1, 120000, this.sampleRate));
  resume = vi.fn(async () => { this.state = 'running'; });
  close = vi.fn(async () => { this.state = 'closed'; });
}
class MediaMock {
  static items: MediaMock[] = [];
  loop = false; preload = ''; volume = 1;
  constructor(readonly src: string) { MediaMock.items.push(this); }
  play = vi.fn(async () => {}); pause = vi.fn(); load = vi.fn(); removeAttribute = vi.fn();
}
let audio: SiteAudio;
let frame: FrameRequestCallback | undefined;
beforeEach(() => {
  MediaMock.items = [];
  vi.stubGlobal('AudioContext', ContextMock); vi.stubGlobal('Audio', MediaMock);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2]))));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => { frame = undefined; });
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  audio = new SiteAudio();
});
afterEach(() => { audio.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('prepared and calibrated site audio', () => {
  it('decodes once before labels and triggers every cue immediately with valid offsets', async () => {
    await audio.prepare(); await audio.unlock();
    const context = ContextMock.latest;
    for (const cue of ['warning', 'headphones', 'credit', 'title'] as const) audio.playIntroCue(cue);
    expect(context.decodeAudioData).toHaveBeenCalledTimes(5);
    expect(context.sources).toHaveLength(4);
    for (const source of context.sources) {
      expect(source.starts).toHaveLength(1);
      expect(source.starts[0][1] + source.starts[0][2]).toBeLessThanOrEqual(source.buffer!.duration);
    }
  });

  it('retries failed recordings and retains a valid local cue when both requests fail', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
    await audio.prepare(); await audio.unlock();
    expect(fetch).toHaveBeenCalledTimes(10);
    for (const cue of ['warning', 'headphones', 'credit', 'title'] as const) audio.playIntroCue(cue);
    audio.playMenuClick();
    expect(ContextMock.latest.sources).toHaveLength(5);
    for (const source of ContextMock.latest.sources.slice(0, 4)) {
      const [, offset, duration] = source.starts[0];
      expect(duration).toBeGreaterThan(0);
      expect(offset + duration).toBeLessThanOrEqual(source.buffer!.duration);
    }
  });

  it('routes louder music and UI through the same master, preserves mute and does not replace music on menu reopen', async () => {
    audio.setMasterVolume(1); await audio.prepare(); await audio.unlock();
    const context = ContextMock.latest;
    const master = context.gains[0], boost = context.gains[1];
    expect(boost.gain.value).toBe(3.2);
    expect(master.connections).toContain(boost);
    expect(boost.connections).toContain(context.compressors[0]);
    expect(context.compressors[0].ratio.value).toBe(20);
    const musicGain = context.media!.connections[0];
    expect(musicGain.connections).toContain(master);
    audio.setMenuActive(true); await Promise.resolve(); frame?.(performance.now() + 1000);
    expect(musicGain.gain.value).toBeCloseTo(.9);
    audio.setMasterVolume(0);
    expect(master.gain.value).toBe(0);
    audio.setMenuActive(false); audio.setMenuActive(true); await audio.unlock();
    expect(MediaMock.items).toHaveLength(1);
  });

  it('uses the same output calibration for the in-game mix', () => {
    const context = new ContextMock(), master = context.createGain();
    connectAudioOutput(context as unknown as AudioContext, master as unknown as GainNode);
    expect(master.connections[0].gain.value).toBe(3.2);
    expect(context.compressors[0].connections).toContain(context.destination);
  });

  it('can choose either supplied menu track, including the last random interval', () => {
    const tracks = ['one.mp3', 'two.mp3'];
    expect(chooseMenuTrack(tracks, () => 0)).toBe(tracks[0]);
    expect(chooseMenuTrack(tracks, () => .49)).toBe(tracks[0]);
    expect(chooseMenuTrack(tracks, () => .5)).toBe(tracks[1]);
    expect(chooseMenuTrack(tracks, () => .999999)).toBe(tracks[1]);
  });
});
