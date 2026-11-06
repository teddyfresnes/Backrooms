// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
const audio = vi.hoisted(() => ({ playMenuHover: vi.fn(), playMenuClick: vi.fn() }));
vi.mock('./SiteAudio', () => ({ siteAudio: audio }));
import { bindButtonSounds } from './ButtonSounds';

afterEach(() => { document.body.innerHTML = ''; vi.clearAllMocks(); });

describe('wardrobe button sounds inside its shadow DOM', () => {
  it('sounds nested icons, keyboard clicks and each new button, skips disabled controls, and cleans up', () => {
    const host = document.createElement('div'); document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const root = document.createElement('div'); shadow.append(root);
    root.innerHTML = '<button><span>A</span><i></i></button><button>B</button><button disabled>C</button>';
    const dispose = bindButtonSounds(root);
    const [a, b, disabled] = root.querySelectorAll('button');
    const span = a.querySelector('span')!;
    span.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, composed: true }));
    a.querySelector('i')!.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, relatedTarget: span, composed: true }));
    b.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, relatedTarget: a, composed: true }));
    span.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    b.click(); disabled.click();
    expect(audio.playMenuHover).toHaveBeenCalledTimes(2);
    expect(audio.playMenuClick).toHaveBeenCalledTimes(2);
    dispose(); b.click();
    b.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    expect(audio.playMenuClick).toHaveBeenCalledTimes(2);
    expect(audio.playMenuHover).toHaveBeenCalledTimes(2);
  });
});
