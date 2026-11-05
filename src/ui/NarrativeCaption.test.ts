// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { NarrativeCaption } from './NarrativeCaption';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
describe('silent narrative captions', () => {
  it('types on played time, hides on pause, keeps its place and cleans up without timers or sound', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const caption = new NarrativeCaption(document.body);
    caption.say('Mon courrier…');
    const root=document.querySelector<HTMLElement>('.narrative-caption')!, copy=root.firstElementChild!;
    caption.update(.05,true); expect(copy.textContent).toBe('M');
    caption.update(20,false); expect(root.hidden).toBe(true); expect(copy.textContent).toBe('M');
    caption.update(20,true); expect(copy.textContent).toBe('Mo');
    for(let i=0;i<100;i++) caption.update(.05,true);
    expect(root.hidden).toBe(true); expect(raf).not.toHaveBeenCalled();
    caption.say('Chez moi.'); expect(root.hidden).toBe(false);
    caption.dispose(); expect(document.querySelector('.narrative-caption')).toBeNull();
  });
});
