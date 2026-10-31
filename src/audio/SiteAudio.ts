import { audioGainFromSetting } from './volume';
import { connectAudioOutput } from './output';
import { chooseMenuTrack } from './MenuMusic';

export type IntroCue = 'warning' | 'headphones' | 'credit' | 'title';

const INTRO_CLIPS: Record<IntroCue, { offset: number; duration: number; gain: number; rate: number }> = {
  warning: { offset: 0.18, duration: 0.55, gain: 0.65, rate: 0.94 },
  headphones: { offset: 0.93, duration: 0.72, gain: 0.6, rate: 1.04 },
  credit: { offset: 0, duration: 0.94, gain: 1.1, rate: 1 },
  title: { offset: 0, duration: 2.3, gain: 0.85, rate: 1 },
};

const MENU_GAIN = 0.9;

export class SiteAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private introBuffer?: AudioBuffer;
  private introCreditBuffer?: AudioBuffer;
  private introTitleBuffer?: AudioBuffer;
  private hoverBuffer?: AudioBuffer;
  private clickBuffer?: AudioBuffer;
  private typingBuffer?: AudioBuffer;
  private readonly typingSources = new Set<AudioBufferSourceNode>();
  private introSource?: AudioBufferSourceNode;
  private buffersLoading?: Promise<void>;
  private menu?: HTMLAudioElement;
  private menuGain?: GainNode;
  private menuSource?: MediaElementAudioSourceNode;
  private menuFadeFrame?: number;
  private menuActive = false;
  private masterVolume = 0.6;
  private lastHoverAt = 0;
  private disposed = false;

  setMasterVolume(volume: number): void {
    this.masterVolume = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0.6));
    if (this.context && this.master) {
      this.master.gain.setTargetAtTime(
        audioGainFromSetting(this.masterVolume),
        this.context.currentTime,
        0.035,
      );
    }
    if (this.menuActive && !document.hidden) {
      this.fadeMenuTo(MENU_GAIN);
    }
  }

  /** Fetch and decode before the visual timeline starts, including a retry. */
  prepare(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (!this.context) {
      const context = new AudioContext({ latencyHint: 'interactive' });
      const master = context.createGain();
      master.gain.value = audioGainFromSetting(this.masterVolume);
      connectAudioOutput(context, master);
      this.context = context;
      this.master = master;
      this.typingBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * .032), context.sampleRate);
      const samples = this.typingBuffer.getChannelData(0);
      let noise = 0x43a21;
      for (let i = 0; i < samples.length; i++) {
        noise ^= noise << 13; noise ^= noise >>> 17; noise ^= noise << 5;
        const t = i / context.sampleRate;
        samples[i] = ((noise >>> 0) / 0xffffffff * 2 - 1) * Math.exp(-t * 230) * .7
          + Math.sin(t * Math.PI * 2 * 1750) * Math.exp(-t * 160) * .18;
      }
      this.buffersLoading = this.loadBuffers(context);
    }
    return this.buffersLoading!;
  }

  async unlock(): Promise<boolean> {
    if (this.disposed) return false;
    void this.prepare();
    const context = this.context!;
    if (!this.menu) {
      const menu = new Audio(chooseMenuTrack());
      menu.loop = true;
      menu.preload = 'auto';
      menu.volume = 1;
      this.menuGain = context.createGain();
      this.menuGain.gain.value = 0;
      this.menuSource = context.createMediaElementSource(menu);
      this.menuSource.connect(this.menuGain).connect(this.master!);
      this.menu = menu;
      // Prime media playback inside the explicit launch gesture. It is paused
      // again immediately unless the menu is already meant to be audible.
      void menu.play().then(() => {
        if (!this.menuActive || document.hidden) menu.pause();
      }).catch(() => undefined);
    }
    try {
      await context.resume();
      if (this.menuActive && !document.hidden) this.playMenu();
      return context.state === 'running';
    } catch {
      // A browser can still reject audio if the gesture was synthetic.
      return false;
    }
  }

  playIntroCue(cue: IntroCue): void {
    this.stopIntroCue();
    const clip = INTRO_CLIPS[cue];
    const buffer = cue === 'credit'
      ? this.introCreditBuffer
      : cue === 'title' ? this.introTitleBuffer : this.introBuffer;
    if (!this.context || !this.master || !buffer || this.disposed) return;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    source.buffer = buffer;
    source.playbackRate.value = clip.rate;
    const offset = Math.min(clip.offset, Math.max(0, buffer.duration - 0.05));
    const duration = Math.min(clip.duration, buffer.duration - offset);
    const audibleDuration = duration / clip.rate;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(clip.gain, now + 0.012);
    gain.gain.setValueAtTime(clip.gain, now + Math.max(0.012, audibleDuration - 0.07));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + audibleDuration);
    source.connect(gain).connect(this.master);
    source.addEventListener('ended', () => {
      if (this.introSource === source) this.introSource = undefined;
      source.disconnect();
      gain.disconnect();
    }, { once: true });
    source.start(now, offset, duration);
    this.introSource = source;
  }

  stopIntroCue(): void {
    this.introSource?.stop();
    this.introSource = undefined;
  }

  playMenuHover(): void {
    const now = performance.now();
    if (now - this.lastHoverAt < 42) return;
    this.lastHoverAt = now;
    this.playUiClip(this.hoverBuffer, 0.35, 1.025);
  }

  playMenuClick(): void {
    this.playUiClip(this.clickBuffer, 0.65, 1);
  }

  playStoryTypingTick(letter: string, index: number): void {
    if (!letter.trim() || this.masterVolume <= 0 || document.hidden || this.context?.state !== 'running') return;
    const source = this.playUiClip(this.typingBuffer, .13, .9 + index % 7 * .035);
    if (!source) return;
    this.typingSources.add(source);
    source.addEventListener('ended', () => this.typingSources.delete(source), { once: true });
  }

  stopStoryTyping(): void {
    for (const source of this.typingSources) source.stop();
    this.typingSources.clear();
  }

  setMenuActive(active: boolean): void {
    this.menuActive = active;
    if (!this.menu || this.disposed) return;
    if (active && !document.hidden) {
      this.playMenu();
      return;
    }
    this.fadeMenuTo(0, true);
  }

  syncVisibility(): void {
    this.setMenuActive(this.menuActive);
  }

  private async loadBuffers(context: AudioContext): Promise<void> {
    const load = async (url: string): Promise<AudioBuffer> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(12000), ...(attempt ? { cache: 'reload' as const } : {}) });
          if (!response.ok) throw new Error(`Audio HTTP ${response.status}`);
          return await context.decodeAudioData(await response.arrayBuffer());
        } catch {
          if (this.disposed) break;
        }
      }
      // A network hiccup must not leave a whole label/button silent. A short
      // local cue is used only if both attempts to load its recording failed.
      const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.25), context.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) {
        const time = i / context.sampleRate;
        samples[i] = Math.sin(time * 2 * Math.PI * (720 - 900 * time)) * Math.exp(-time * 26) * 0.35;
      }
      return buffer;
    };
    const [intro, introCredit, introTitle, hover, click] = await Promise.all([
      load('/assets/audio/ui/intro-glitch.mp3'),
      load('/assets/audio/ui/intro-credit.mp3'),
      load('/assets/audio/ui/intro-title.mp3'),
      load('/assets/audio/ui/menu-hover.mp3'),
      load('/assets/audio/ui/menu-click.mp3'),
    ]);
    if (this.context !== context || this.disposed) return;
    this.introBuffer = intro;
    this.introCreditBuffer = introCredit;
    this.introTitleBuffer = introTitle;
    this.hoverBuffer = hover;
    this.clickBuffer = click;
  }

  private playUiClip(buffer: AudioBuffer | undefined, gainValue: number, rate: number): AudioBufferSourceNode | undefined {
    if (!buffer || !this.context || !this.master || this.disposed) return;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    gain.gain.value = gainValue;
    source.connect(gain).connect(this.master);
    source.addEventListener('ended', () => {
      source.disconnect();
      gain.disconnect();
    }, { once: true });
    source.start();
    return source;
  }

  private playMenu(): void {
    if (!this.menu) return;
    void this.menu.play().then(() => {
      if (this.menuActive && !document.hidden) {
        this.fadeMenuTo(MENU_GAIN);
      }
    }).catch(() => undefined);
  }

  private fadeMenuTo(target: number, pauseAtEnd = false): void {
    if (!this.menu || !this.menuGain) return;
    if (this.menuFadeFrame !== undefined) cancelAnimationFrame(this.menuFadeFrame);
    const menu = this.menu;
    const startedAt = performance.now();
    const menuGain = this.menuGain;
    const startVolume = menuGain.gain.value;
    const duration = target > startVolume ? 650 : 220;
    const update = (now: number): void => {
      if (this.disposed || this.menu !== menu) return;
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - (1 - progress) ** 3;
      menuGain.gain.value = Math.max(0, startVolume + (target - startVolume) * eased);
      if (progress < 1) {
        this.menuFadeFrame = requestAnimationFrame(update);
      } else {
        this.menuFadeFrame = undefined;
        if (pauseAtEnd && target === 0) menu.pause();
      }
    };
    this.menuFadeFrame = requestAnimationFrame(update);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopIntroCue();
    this.stopStoryTyping();
    if (this.menuFadeFrame !== undefined) cancelAnimationFrame(this.menuFadeFrame);
    this.menu?.pause();
    this.menu?.removeAttribute('src');
    this.menu?.load();
    this.menuSource?.disconnect();
    this.menuGain?.disconnect();
    const context = this.context;
    this.context = undefined;
    this.master = undefined;
    this.introBuffer = undefined;
    this.introCreditBuffer = undefined;
    this.introTitleBuffer = undefined;
    this.hoverBuffer = undefined;
    this.clickBuffer = undefined;
    this.typingBuffer = undefined;
    this.buffersLoading = undefined;
    this.menu = undefined;
    this.menuSource = undefined;
    this.menuGain = undefined;
    this.menuFadeFrame = undefined;
    void context?.close().catch(() => undefined);
  }
}

export const siteAudio = new SiteAudio();
