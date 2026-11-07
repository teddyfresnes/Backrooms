// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { GIFT_LETTER, LetterReader } from './LetterReader';

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });
it('shows a readable letter before the gasp callback and closes through Escape without leaking input', () => {
  let visible: FrameRequestCallback | undefined;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { visible = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const open = vi.fn(), close = vi.fn(), gasp = vi.fn();
  const reader = new LetterReader(document.body, open, close);
  reader.open(gasp);
  expect(reader.isOpen).toBe(true); expect(open).toHaveBeenCalledOnce(); expect(gasp).not.toHaveBeenCalled();
  expect(document.querySelector<HTMLElement>('[role="dialog"]')!.hidden).toBe(false);
  expect(document.querySelector('.mail-paper')!.textContent).toContain('Chloé');
  expect(document.querySelector('.mail-paper')!.textContent).toContain('cadeau sur le pas de ta porte');
  visible!(16); expect(gasp).toHaveBeenCalledOnce();
  const gameplay = vi.fn(); window.addEventListener('keydown', gameplay);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
  expect(reader.isOpen).toBe(false); expect(close).toHaveBeenCalledOnce(); expect(gameplay).not.toHaveBeenCalled();
  reader.open(vi.fn(), GIFT_LETTER);
  expect(document.querySelector('.mail-paper')!.textContent).toContain('ça ne va pas trop entre nous');
  expect(document.querySelector('.mail-paper')!.textContent).toContain('boussole');
  reader.dispose(); window.removeEventListener('keydown', gameplay);
  expect(document.querySelector('.letter-reader')).toBeNull();
});
