import { siteAudio } from './SiteAudio';

/** Delegate inside each DOM/shadow root so retargeting cannot hide controls. */
export function bindButtonSounds(root: HTMLElement): () => void {
  const buttonAt = (event: Event): HTMLButtonElement | null => {
    if (!(event.target instanceof Element)) return null;
    const button = event.target.closest<HTMLButtonElement>('button:not(:disabled)');
    return button && root.contains(button) ? button : null;
  };
  const hover = (event: PointerEvent): void => {
    const button = buttonAt(event);
    if (!button || event.relatedTarget instanceof Node && button.contains(event.relatedTarget)) return;
    siteAudio.playMenuHover();
  };
  const click = (event: MouseEvent): void => {
    if (buttonAt(event)) siteAudio.playMenuClick();
  };
  root.addEventListener('pointerover', hover);
  root.addEventListener('click', click, true);
  return () => {
    root.removeEventListener('pointerover', hover);
    root.removeEventListener('click', click, true);
  };
}
