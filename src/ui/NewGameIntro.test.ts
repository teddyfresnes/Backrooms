// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const audio = vi.hoisted(() => ({ unlock: vi.fn(), playStoryTypingTick: vi.fn(), stopStoryTyping: vi.fn() }));
vi.mock('../audio/SiteAudio', () => ({ siteAudio: audio }));
import { NewGameIntro, NEW_GAME_SHOTS } from './NewGameIntro';

let intro: NewGameIntro;
let app: HTMLElement;
let frames: Map<number, FrameRequestCallback>;
let now = 0;
let next = 0;
const settle = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const step = (delta = 50) => {
  now += delta;
  const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(now));
};
const images = () => [...document.querySelectorAll<HTMLImageElement>('.new-game-film-stage img')];
const copy = () => document.querySelector('[data-film-copy]')!.textContent;
const button = () => document.querySelector<HTMLButtonElement>('[data-film-action]')!;
const decode = async () => { images().forEach(img => img.dispatchEvent(new Event('load'))); await settle(); };

beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  frames = new Map(); now = 0; next = 0;
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++next, fn); return next; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(undefined);
  audio.unlock.mockResolvedValue(true);
  app = document.createElement('main'); document.body.append(app);
});
afterEach(() => {
  intro?.dispose(); document.body.replaceChildren();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('new game photographic prologue', () => {
  it('decodes six ordered images, types every exact sentence and automatically hands over to the ready hall', async () => {
    intro = new NewGameIntro(app); intro.setSceneReady();
    expect(app.inert).toBe(true);
    expect(images().map(img => img.src.split('/').at(-1))).toEqual(['01.webp', '02.webp', '03.webp', '04.webp', '05.webp', '06.webp']);
    step(10000); expect(copy()).toBe(''); expect(audio.playStoryTypingTick).not.toHaveBeenCalled();
    await decode();
    const seen = new Set<string>(); let done = false;
    void intro.finished.then(() => { done = true; });
    for (let i = 0; i < 1000; i++) { step(); if (copy()) seen.add(copy()!); }
    for (const shot of NEW_GAME_SHOTS) expect(seen.has(shot.text), shot.text).toBe(true);
    expect(copy()).toBe("Plus qu'à monter.");
    expect(images()[5]!.style.transform).toContain('scale(');
    await settle(); expect(done).toBe(true);
    expect(audio.playStoryTypingTick).toHaveBeenCalled();
    const enter = vi.fn(() => expect(app.inert).toBe(false));
    const leaving = intro.reveal(enter);
    expect(enter).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(700); await leaving;
    expect(document.querySelector('.new-game-film')).toBeNull(); expect(frames.size).toBe(0);
  });

  it('keeps a blocked frame and a hidden tab from skipping text or producing catch-up sound', async () => {
    intro = new NewGameIntro(app); await decode();
    for (let i = 0; i < 25; i++) step();
    const before = copy()!, sound = audio.playStoryTypingTick.mock.calls.length;
    step(20000);
    expect(copy()!.length - before.length).toBeLessThanOrEqual(2);
    expect(audio.playStoryTypingTick.mock.calls.length - sound).toBeLessThanOrEqual(1);
    const frozen = copy(), transform = images()[0]!.style.transform;
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    for (let i = 0; i < 10; i++) step(30000);
    expect(copy()).toBe(frozen); expect(images()[0]!.style.transform).toBe(transform);
    hidden.mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange')); step(30000);
    expect(copy()).toBe(frozen);
    step(); expect(copy()!.length - frozen!.length).toBeLessThanOrEqual(2);
  });

  it('allows skipping while loading, waits for the real scene and cleans up an obsolete transition', async () => {
    intro = new NewGameIntro(app);
    let finished = false; void intro.finished.then(() => { finished = true; });
    button().click(); await settle();
    expect(finished).toBe(false); expect(button().disabled).toBe(true);
    intro.setProgress(.7); expect(document.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('70');
    intro.setSceneReady(); await settle(); expect(finished).toBe(true);
    intro.dispose(); await decode(); step();
    expect(frames.size).toBe(0); expect(vi.getTimerCount()).toBe(0); expect(app.inert).toBe(false);
    expect(document.querySelector('.new-game-film')).toBeNull();
  });

  it('shows every image and readable phrase with reduced motion, without invisible typing sounds', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    intro = new NewGameIntro(app); await decode();
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) { step(); if (copy()) seen.add(copy()!); }
    NEW_GAME_SHOTS.forEach(shot => expect(seen.has(shot.text)).toBe(true));
    expect(images()[5]!.style.transform).toBe('none');
    expect(audio.playStoryTypingTick).not.toHaveBeenCalled();
  });

  it('offers a retry for a failed image and prevents keystrokes reaching the loading game', async () => {
    intro = new NewGameIntro(app);
    const underlyingKey = vi.fn(); window.addEventListener('keydown', underlyingKey);
    try {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', cancelable: true }));
      expect(underlyingKey).not.toHaveBeenCalled();
      images()[1]!.dispatchEvent(new Event('error')); await settle();
      const retry = document.querySelector<HTMLButtonElement>('[data-film-retry]')!;
      expect(retry.hidden).toBe(false);
      retry.click(); await decode(); step();
      expect(retry.hidden).toBe(true); expect(document.querySelector('.new-game-film')!.getAttribute('data-shot')).toBe('1');
      intro.dispose(); expect(vi.getTimerCount()).toBe(0);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' })); expect(underlyingKey).toHaveBeenCalledOnce();
    } finally { window.removeEventListener('keydown', underlyingKey); }
  });
});
