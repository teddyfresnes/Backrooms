// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { CinematicCaption } from './CinematicCaption';
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });
it('keeps full words laid out and reveals them with native animation even when the JS frame clock stalls', () => {
  const animations: { currentTime: number; playState: string; pause: ReturnType<typeof vi.fn>; play: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }[] = [];
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: vi.fn(() => {
    const animation = { currentTime: 0, playState: 'running', pause: vi.fn(), play: vi.fn(), cancel: vi.fn() };
    animation.pause.mockImplementation(() => { animation.playState = 'paused'; });
    animation.play.mockImplementation(() => { animation.playState = 'running'; });
    animations.push(animation); return animation;
  }) });
  const element = document.createElement('span'); document.body.append(element);
  const caption = new CinematicCaption(element);
  try {
    caption.show('A B', [10, 20, 30], 100, false);
    expect(element.textContent).toBe('A B'); expect(element.querySelectorAll('.film-caption-word')).toHaveLength(2);
    const nodes = [...element.querySelectorAll('[data-film-letter]')];
    animations.forEach(animation => { animation.currentTime = 31; });
    expect(caption.update(0)).toBe(3); expect(caption.ready(20)).toBe(false);
    expect([...element.querySelectorAll('[data-film-letter]')]).toEqual(nodes);
    animations.forEach(animation => { animation.currentTime = 51; }); expect(caption.ready(20)).toBe(true);
    caption.setPaused(true); expect(animations.every(animation => animation.pause.mock.calls.length === 1)).toBe(true);
    caption.setPaused(false); expect(animations.every(animation => animation.play.mock.calls.length === 1)).toBe(true);
    caption.stop(); expect(animations.every(animation => animation.cancel.mock.calls.length === 1)).toBe(true);
    expect(nodes.every(node => (node as HTMLElement).style.opacity === '1')).toBe(true);
  } finally {
    caption.stop(); if (original) Object.defineProperty(HTMLElement.prototype, 'animate', original);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).animate;
  }
});
it('holds the completed fallback sentence for the whole reading interval and shows reduced motion without typing', () => {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: undefined });
  const element = document.createElement('span'); const caption = new CinematicCaption(element);
  try {
  caption.show('ABC', [10, 20, 30], 100, false);
  expect(caption.update(30)).toBe(2); expect(caption.update(70)).toBe(3);
  expect(caption.ready(20)).toBe(false); caption.update(89); expect(caption.ready(20)).toBe(false);
  caption.update(90); expect(caption.ready(20)).toBe(true);
  caption.show('ABC', [10, 20, 30], 100, true); expect(caption.update(650)).toBe(3); caption.stop();
  } finally {
    if (original) Object.defineProperty(HTMLElement.prototype, 'animate', original);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).animate;
  }
});
