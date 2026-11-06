import './narrative-caption.css';
import { CAPTION_CHARACTER_SECONDS, interruptionPlan, interruptionProgress, type InterruptionProgress } from '../story/InterruptedNarration';

/** Silent in-world captions, advanced by the host's played time, with no extra loop. */
export class NarrativeCaption {
  private readonly root = document.createElement('div');
  private readonly copy = document.createElement('span');
  private readonly announcement = document.createElement('span');
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private letters: string[] = [];
  private elapsed = 0;
  private active = false;
  private instant = false;
  private interrupted = false;
  get interruption(): InterruptionProgress | undefined { return this.interrupted ? interruptionProgress(this.letters.join(''), this.elapsed, this.reduced) : undefined; }
  sayInterrupted(text: string, resumeAt=0): void { this.say(text,false,resumeAt);this.interrupted=true;this.renderInterrupted();this.announcement.textContent=this.letters.slice(0,interruptionPlan(text).cutAt).join(''); }
  private renderInterrupted(): void { this.copy.textContent=this.letters.slice(0,this.interruption!.visibleCharacters).join(''); }

  constructor(container: HTMLElement) {
    this.root.className = 'narrative-caption';
    this.root.hidden = true;
    this.copy.setAttribute('aria-hidden', 'true');
    this.announcement.className = 'narrative-caption-announcement';
    this.announcement.setAttribute('aria-live', 'polite');
    this.root.append(this.copy, this.announcement);
    container.append(this.root);
  }

  get isActive(): boolean { return this.active; }

  say(text: string, instant = false, resumeAt = 0): void {
    this.interrupted = false;
    this.instant = instant;
    this.letters = Array.from(text);
    this.elapsed = Math.max(0, resumeAt);
    this.active = true;
    this.root.hidden = false;
    this.copy.textContent = this.reduced || instant ? text : this.letters.slice(0, Math.floor(this.elapsed / CAPTION_CHARACTER_SECONDS)).join('');
    this.announcement.textContent = text;
    this.root.style.opacity = '1';
  }

  update(delta: number, playing: boolean): void {
    this.root.hidden = !playing || !this.active;
    if (!playing || !this.active) return;
    this.elapsed += Math.min(.05, Math.max(0, delta));
    if(this.interrupted){this.renderInterrupted();return;}
    const typingDuration = this.reduced || this.instant ? 0 : this.letters.length * CAPTION_CHARACTER_SECONDS;
    this.copy.textContent = this.letters.slice(0, this.reduced || this.instant ? this.letters.length : Math.floor(this.elapsed / CAPTION_CHARACTER_SECONDS)).join('');
    const afterReading = this.elapsed - typingDuration - 3.5;
    if (afterReading > 0) this.root.style.opacity = String(Math.max(0, 1 - afterReading / .3));
    if (afterReading >= .3) { this.active = false; this.root.hidden = true; }
  }

  hide(): void { this.root.hidden = true; }
  clear(): void { this.active = false; this.root.hidden = true; this.copy.textContent = ''; this.announcement.textContent = ''; }
  dispose(): void { this.active = false; this.root.remove(); }
}
