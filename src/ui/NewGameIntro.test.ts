// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const audio = vi.hoisted(() => ({ unlock: vi.fn(), playStoryTypingTick: vi.fn(), stopStoryTyping: vi.fn(),
  startStoryMusic: vi.fn(), stopStoryMusic: vi.fn(), fadeStoryMusicOut: vi.fn(), setStoryMusicPaused: vi.fn() }));
vi.mock('../audio/SiteAudio', () => ({ siteAudio: audio }));
import { NewGameIntro, NEW_GAME_SHOTS } from './NewGameIntro';
import { InputManager } from '../input/InputManager';

let intro: NewGameIntro;
let app: HTMLElement;
let frames: Map<number, FrameRequestCallback>;
let now = 0;
let next = 0;
const nativeAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
const settle = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const step = (delta = 50) => {
  now += delta;
  const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(now));
};
const images = () => [...document.querySelectorAll<HTMLImageElement>('.new-game-film-stage img')];
const copy = () => {
  const element = document.querySelector('[data-film-copy]')!;
  const letters = [...element.querySelectorAll<HTMLElement>('[data-film-letter]')];
  return letters.length ? letters.filter(letter => letter.style.opacity === '1').map(letter => letter.textContent).join('') : element.textContent;
};
const button = () => document.querySelector<HTMLButtonElement>('[data-film-action]')!;
const decode = async () => { for (let i = 0; i < 4; i++) { await settle(); images().forEach(img => img.dispatchEvent(new Event('load'))); await settle(); } };

beforeEach(() => {
  // The DOM harness has no compositor clock; exercise the explicit fallback.
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: undefined });
  vi.useFakeTimers(); vi.resetAllMocks();
  frames = new Map(); now = 0; next = 0;
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++next, fn); return next; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('scheduler', { yield: async () => {} });
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(undefined);
  audio.unlock.mockResolvedValue(true);
  app = document.createElement('main'); document.body.append(app);
});
afterEach(() => {
  intro?.dispose(); document.body.replaceChildren();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  if (nativeAnimate) Object.defineProperty(HTMLElement.prototype, 'animate', nativeAnimate);
  else delete (HTMLElement.prototype as unknown as Record<string, unknown>).animate;
});

describe('new game photographic prologue', () => {
  it.each(['skip', 'natural'])('hands the real movement keys back immediately after %s', async mode => {
    const input = new InputManager();
    try {
      intro = new NewGameIntro(app); intro.setSceneReady();
      const move = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ' }));
      move(); expect(input.axes.forward).toBe(0);
      if (mode === 'skip') button().click();
      else { await decode(); for (let i = 0; i < 1000; i++) step(); }
      await intro.finished;
      const reveal = intro.reveal(() => {
        expect(app.inert).toBe(false);
        move(); expect(input.axes.forward).toBe(1);
      });
      await vi.advanceTimersByTimeAsync(700); await reveal;
    } finally { input.dispose(); }
  });
  it('releases controls after a replacement film and ignores late disposal of the old film', async () => {
    const previous = new NewGameIntro(app);
    intro = new NewGameIntro(app);
    previous.dispose();
    expect(app.inert).toBe(true);
    button().click(); intro.setSceneReady();
    await intro.reveal(() => expect(app.inert).toBe(false));
    previous.dispose();
    expect(app.inert).toBe(false);
  });

  it('does not let the fading film overwrite the next film input lock', async () => {
    const previous = new NewGameIntro(app);
    const reveal = previous.reveal(() => {});
    expect(app.inert).toBe(false);
    intro = new NewGameIntro(app);
    await vi.advanceTimersByTimeAsync(700); await reveal;
    expect(app.inert).toBe(true);
    intro.dispose(); expect(app.inert).toBe(false);
  });
  it('runs photo transforms in browser animations, pauses them in background and never rewrites zoom on text frames', async () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
    const animations: { target: HTMLElement; currentTime: number; playState: string; pause: ReturnType<typeof vi.fn>; play: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }[] = [];
    const animate = vi.fn(function (this: HTMLElement) {
      const animation = { target: this, currentTime: 0, playState: 'running', finished: new Promise<void>(() => undefined), pause: vi.fn(), play: vi.fn(), cancel: vi.fn() };
      animation.pause.mockImplementation(() => { animation.playState = 'paused'; }); animation.play.mockImplementation(() => { animation.playState = 'running'; });
      animation.cancel.mockImplementation(() => { animation.playState = 'idle'; });
      animations.push(animation); return animation as unknown as Animation;
    });
    const advance = () => { for (const animation of animations) if (animation.target.hasAttribute('data-film-letter') && animation.playState === 'running') animation.currentTime += 50; step(); };
    const photos = () => animations.filter(animation => animation.target instanceof HTMLImageElement);
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
    try {
      intro = new NewGameIntro(app); await decode();
      const transform = images()[0]!.style.transform;
      for (let i = 0; i < 20; i++) advance();
      expect(images()[0]!.style.transform).toBe(transform); expect(photos()).toHaveLength(2);
      const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange'));
      expect(animations.every(animation => animation.pause.mock.calls.length === 1)).toBe(true);
      hidden.mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange'));
      expect(photos().every(animation => animation.play.mock.calls.length === 0)).toBe(true);
      for (let i = 0; i < 140; i++) advance();
      const outgoingZoomTime = photos()[0]!.currentTime;
      advance(); expect(photos()[0]!.currentTime).toBe(outgoingZoomTime);
      intro.dispose(); expect(animations.every(animation => animation.cancel.mock.calls.length === 1)).toBe(true);
    } finally { if (original) Object.defineProperty(HTMLElement.prototype, 'animate', original); else delete (HTMLElement.prototype as unknown as Record<string, unknown>).animate; }
  });
  it('decodes six ordered images, types every exact sentence and automatically hands over to the ready hall', async () => {
    intro = new NewGameIntro(app); intro.setSceneReady();
    expect(app.inert).toBe(true);
    expect(images().map(img => img.dataset.src!.split('/').at(-1))).toEqual(['01.webp', '02.webp', '03.webp', '04.webp', '05.webp', '06.webp']);
    step(10000); expect(copy()).toBe(''); expect(audio.playStoryTypingTick).not.toHaveBeenCalled();
    await decode();
    const seen = new Set<string>(); let done = false;
    void intro.finished.then(() => { done = true; });
    for (let i = 0; i < 1000; i++) { step(); if (copy()) seen.add(copy()!); }
    for (const shot of NEW_GAME_SHOTS) expect(seen.has(shot.text), shot.text).toBe(true);
    expect(copy()).toBe("Plus qu'à monter.");
    expect(images()[5]!.style.transform).toContain('scale(');
    await settle(); expect(done).toBe(true);
    expect(document.querySelector('.new-game-film')!.classList.contains('is-waiting')).toBe(false);
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
    expect(finished).toBe(true); expect(button().hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('.new-game-film-wait')!.hidden).toBe(false);
    intro.setProgress(.6); expect(document.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('60');
    intro.setSceneReady(); await settle(); expect(finished).toBe(true);
    intro.dispose(); await decode(); step();
    expect(frames.size).toBe(0); expect(vi.getTimerCount()).toBe(0); expect(app.inert).toBe(false);
    expect(document.querySelector('.new-game-film')).toBeNull();
  });

  it('stops film music and animations immediately when the whole prologue is skipped', async () => {
    intro = new NewGameIntro(app); await decode();
    expect(document.querySelector<HTMLElement>('.new-game-film-wait')!.hidden).toBe(true);
    button().click(); intro.setSceneReady();
    const entering = intro.reveal(vi.fn(), { continueMusic: false });
    await vi.advanceTimersByTimeAsync(700); await entering;
    expect(intro.wasSkipped).toBe(true); expect(audio.stopStoryMusic).toHaveBeenCalled();
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

  it('keeps every photograph visible for at least 6.5 seconds even when the scene is already ready', async () => {
    intro = new NewGameIntro(app); await decode(); intro.setSceneReady();
    step(); const startShot = document.querySelector<HTMLElement>('.new-game-film')!.dataset.shot;
    for (let i = 0; i < 120; i++) step();
    expect(document.querySelector<HTMLElement>('.new-game-film')!.dataset.shot).toBe(startShot);
    for (let i = 0; i < 20; i++) step();
    expect(document.querySelector<HTMLElement>('.new-game-film')!.dataset.shot).toBe('2');
  });

  it('offers a retry for a failed image and prevents keystrokes reaching the loading game', async () => {
    intro = new NewGameIntro(app);
    const underlyingKey = vi.fn(); window.addEventListener('keydown', underlyingKey);
    try {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', cancelable: true }));
      expect(underlyingKey).not.toHaveBeenCalled();
      await settle(); images()[1]!.dispatchEvent(new Event('error')); await settle();
      const retry = document.querySelector<HTMLButtonElement>('[data-film-retry]')!;
      expect(retry.hidden).toBe(false);
      retry.click(); await decode(); step();
      expect(retry.hidden).toBe(true); expect(document.querySelector('.new-game-film')!.getAttribute('data-shot')).toBe('1');
      intro.dispose(); expect(vi.getTimerCount()).toBe(0);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' })); expect(underlyingKey).toHaveBeenCalledOnce();
    } finally { window.removeEventListener('keydown', underlyingKey); }
  });
  it('retries only missing photos without clearing a sentence already being shown or restarting the film', async () => {
    intro = new NewGameIntro(app); await settle();
    images()[0]!.dispatchEvent(new Event('load')); await settle();
    images()[1]!.dispatchEvent(new Event('load')); await settle();
    images()[2]!.dispatchEvent(new Event('error')); await settle();
    for (let i = 0; i < 160; i++) step();
    expect(document.querySelector<HTMLElement>('.new-game-film')!.dataset.shot).toBe('2');
    const visible = copy(); expect(visible!.length).toBeGreaterThan(0);
    document.querySelector<HTMLButtonElement>('[data-film-retry]')!.click(); await settle();
    images()[2]!.dispatchEvent(new Event('load')); await settle();
    expect(document.querySelector<HTMLElement>('.new-game-film')!.dataset.shot).toBe('2');
    expect(copy()).toBe(visible);
  });
});

it.each([0,7000,21000,38000])('skips the complete film once at %s ms and never advances an old timeline afterward',async at=>{
 intro=new NewGameIntro(app);await decode();
 for(let t=0;t<at;t+=50)step();
 const finished=vi.fn();void intro.finished.then(finished);button().click();button().click();
 window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',cancelable:true}));await settle();
 expect(finished).toHaveBeenCalledOnce();expect(intro.wasSkipped).toBe(true);expect(frames.size).toBe(0);
 const before=copy();for(let t=0;t<50;t++)step();expect(copy()).toBe(before);
 intro.setSceneReady();const enter=vi.fn();await intro.reveal(enter);await intro.reveal(enter);expect(enter).toHaveBeenCalledOnce();
});
it('waits for a visible tab before handing over and releases that wait on disposal',async()=>{
 intro=new NewGameIntro(app);await decode();button().click();intro.setSceneReady();
 const hidden=vi.spyOn(document,'hidden','get').mockReturnValue(true),enter=vi.fn();
 const transition=intro.reveal(enter);await settle();expect(enter).not.toHaveBeenCalled();
 intro.dispose();await transition;hidden.mockReturnValue(false);document.dispatchEvent(new Event('visibilitychange'));expect(enter).not.toHaveBeenCalled();
});
