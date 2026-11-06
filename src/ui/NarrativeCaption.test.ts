// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { NarrativeCaption } from './NarrativeCaption';
const GAS_THOUGHT='Je devrais couper le gaz avant que…';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
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

it.each([false,true])('renders an essential prefix, freezes real pause, and never flashes the final word (reduced=%s)',reduced=>{
  vi.stubGlobal('matchMedia',()=>({matches:reduced}));const caption=new NarrativeCaption(document.body);caption.sayInterrupted(GAS_THOUGHT);
  for(let i=0;i<27;i++)caption.update(.05,true);const atPause=caption.interruption;expect(document.querySelector('.narrative-caption span')!.textContent).toContain('couper le gaz');
  for(let i=0;i<100;i++)caption.update(.05,false);expect(caption.interruption).toEqual(atPause);
  for(let i=0;i<100&&!caption.interruption?.canInterrupt;i++)caption.update(.05,true);
  const text=document.querySelector('.narrative-caption span')!.textContent;expect(text).toContain('gaz');expect(text).not.toContain('que');expect(caption.interruption?.canInterrupt).toBe(true);caption.dispose();
});
