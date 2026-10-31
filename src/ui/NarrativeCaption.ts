import './narrative-caption.css';

/** Silent in-world captions, advanced by the host's played time, with no extra loop. */
export class NarrativeCaption {
  private readonly root = document.createElement('div');
  private readonly copy = document.createElement('span');
  private readonly announcement = document.createElement('span');
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private letters: string[] = [];
  private elapsed = 0;
  private active = false;

  constructor(container: HTMLElement) {
    this.root.className = 'narrative-caption';
    this.root.hidden = true;
    this.copy.setAttribute('aria-hidden', 'true');
    this.announcement.className = 'narrative-caption-announcement';
    this.announcement.setAttribute('aria-live', 'polite');
    this.root.append(this.copy, this.announcement);
    container.append(this.root);
  }

  say(text: string): void {
    this.letters = Array.from(text);
    this.elapsed = 0;
    this.active = true;
    this.copy.textContent = this.reduced ? text : '';
    this.announcement.textContent = text;
    this.root.hidden = false;
    this.root.style.opacity = '1';
  }

  update(delta: number, playing: boolean): void {
    this.root.hidden = !playing || !this.active;
    if (!playing || !this.active) return;
    this.elapsed += Math.min(.05, Math.max(0, delta));
    const typingDuration = this.reduced ? 0 : this.letters.length * .042;
    this.copy.textContent = this.letters.slice(0, this.reduced ? this.letters.length : Math.floor(this.elapsed / .042)).join('');
    const afterReading = this.elapsed - typingDuration - 3.5;
    if (afterReading > 0) this.root.style.opacity = String(Math.max(0, 1 - afterReading / .3));
    if (afterReading >= .3) { this.active = false; this.root.hidden = true; }
  }

  hide(): void { this.root.hidden = true; }
  dispose(): void { this.active = false; this.root.remove(); }
}
