import { audioGainFromSetting } from './volume';

export type IntroCue = 'warning' | 'headphones' | 'credit' | 'title';

const INTRO_CLIPS: Record<IntroCue, { offset: number; duration: number; gain: number; rate: number }> = {
  warning: { offset: 0.18, duration: 0.55, gain: 0.24, rate: 0.94 },
  headphones: { offset: 0.93, duration: 0.72, gain: 0.2, rate: 1.04 },
  credit: { offset: 0, duration: 0.94, gain: 0.16, rate: 1 },
  title: { offset: 0, duration: 2.3, gain: 0.28, rate: 1 },
};

const MENU_GAIN = 0.48;

class SiteAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private introBuffer?: AudioBuffer;
  private introCreditBuffer?: AudioBuffer;
  private introTitleBuffer?: AudioBuffer;
  private hoverBuffer?: AudioBuffer;
  private clickBuffer?: AudioBuffer;
  private buffersLoading?: Promise<void>;
  private menu?: HTMLAudioElement;
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
      this.fadeMenuTo(audioGainFromSetting(this.masterVolume) * MENU_GAIN);
    }
  }

  async unlock(): Promise<void> {
    if (this.disposed) return;
    if (!this.context) {
      const context = new AudioContext({ latencyHint: 'interactive' });
      const master = context.createGain();
      master.gain.value = audioGainFromSetting(this.masterVolume);
      master.connect(context.destination);
      this.context = context;
      this.master = master;
      this.buffersLoading = this.loadBuffers(context);
    }
    if (!this.menu) {
      const menu = new Audio('/assets/audio/music/menu.mp3');
      menu.loop = true;
      menu.preload = 'auto';
      menu.volume = 0;
      this.menu = menu;
      // Prime media playback inside the explicit launch gesture. It is paused
      // again immediately unless the menu is already meant to be audible.
      void menu.play().then(() => {
        if (!this.menuActive || document.hidden) menu.pause();
      }).catch(() => undefined);
    }
    try {
      await this.context.resume();
      if (this.menuActive && !document.hidden) this.playMenu();
    } catch {
      // A browser can still reject audio if the gesture was synthetic.
    }
  }

  async playIntroCue(cue: IntroCue): Promise<void> {
    await this.unlock();
    await this.buffersLoading;
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
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(clip.gain, now + 0.012);
    gain.gain.setValueAtTime(clip.gain, now + Math.max(0.012, clip.duration - 0.07));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + clip.duration);
    source.connect(gain).connect(this.master);
    source.addEventListener('ended', () => {
      source.disconnect();
      gain.disconnect();
    }, { once: true });
    source.start(now, clip.offset, clip.duration);
  }

  playMenuHover(): void {
    const now = performance.now();
    if (now - this.lastHoverAt < 42) return;
    this.lastHoverAt = now;
    this.playUiClip(this.hoverBuffer, 0.16, 1.025);
  }

  playMenuClick(): void {
    this.playUiClip(this.clickBuffer, 0.28, 1);
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
    const load = async (url: string): Promise<AudioBuffer | undefined> => {
      try {
        const response = await fetch(url);
        if (!response.ok) return undefined;
        return await context.decodeAudioData(await response.arrayBuffer());
      } catch {
        return undefined;
      }
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

  private playUiClip(buffer: AudioBuffer | undefined, gainValue: number, rate: number): void {
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
  }

  private playMenu(): void {
    if (!this.menu) return;
    void this.menu.play().then(() => {
      if (this.menuActive && !document.hidden) {
        this.fadeMenuTo(audioGainFromSetting(this.masterVolume) * MENU_GAIN);
      }
    }).catch(() => undefined);
  }

  private fadeMenuTo(target: number, pauseAtEnd = false): void {
    if (!this.menu) return;
    if (this.menuFadeFrame !== undefined) cancelAnimationFrame(this.menuFadeFrame);
    const menu = this.menu;
    const startedAt = performance.now();
    const startVolume = menu.volume;
    const duration = target > startVolume ? 650 : 220;
    const update = (now: number): void => {
      if (this.disposed || this.menu !== menu) return;
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - (1 - progress) ** 3;
      menu.volume = Math.min(1, Math.max(0, startVolume + (target - startVolume) * eased));
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
    if (this.menuFadeFrame !== undefined) cancelAnimationFrame(this.menuFadeFrame);
    this.menu?.pause();
    this.menu?.removeAttribute('src');
    this.menu?.load();
    const context = this.context;
    this.context = undefined;
    this.master = undefined;
    this.introBuffer = undefined;
    this.introCreditBuffer = undefined;
    this.introTitleBuffer = undefined;
    this.hoverBuffer = undefined;
    this.clickBuffer = undefined;
    this.buffersLoading = undefined;
    this.menu = undefined;
    this.menuFadeFrame = undefined;
    void context?.close().catch(() => undefined);
  }
}

export const siteAudio = new SiteAudio();
