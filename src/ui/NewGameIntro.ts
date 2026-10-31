import { siteAudio } from '../audio/SiteAudio';
import './new-game-intro.css';

export const NEW_GAME_SHOTS = [
  { image: '01', text: 'Les autres sont partis depuis longtemps.', pan: -.8, reverse: false },
  { image: '02', text: "J'ai passé la soirée sur ça.", pan: .8, reverse: true },
  { image: '03', text: '00:30. Et demain recommence.', pan: 0, reverse: false },
  { image: '04', text: "L'air est froid. Tant mieux.", pan: -.7, reverse: true },
  { image: '05', text: 'La pluie couvre le reste.', pan: .7, reverse: false },
  { image: '06', text: "Plus qu'à monter.", pan: 0, reverse: false },
] as const;

const LEAD_MS = 650;
const HOLD_MS = 1800;
const FADE_MS = 850;
const letterTimes = (text: string): number[] => {
  let at = LEAD_MS;
  return Array.from(text, (letter, i) => {
    at += /[.,:!?]/.test(letter) ? 190 : letter === ' ' ? 28 : 45 + i % 5 * 4;
    return at;
  });
};

/** A separate presentation above the loading runtime. One visible-time clock
 * drives both camera motion and lettering; loading/hidden tabs cannot skip a
 * sentence or emit a burst of delayed audio. The scene takes over only once
 * both the prologue and the real runtime are ready. */
export class NewGameIntro {
  readonly finished: Promise<void>;
  private readonly root = document.createElement('section');
  private readonly images: HTMLImageElement[] = [];
  private readonly copy: HTMLElement;
  private readonly announcement: HTMLElement;
  private readonly action: HTMLButtonElement;
  private readonly retry: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly previousInert: boolean;
  private readonly times = NEW_GAME_SHOTS.map(shot => letterTimes(shot.text));
  private resolveFinished = (): void => undefined;
  private frame?: number;
  private loading?: AbortController;
  private exitTimer?: number;
  private resolveExit?: () => void;
  private elapsed = 0;
  private previous?: number;
  private shot = 0;
  private letters = 0;
  private sceneReady = false;
  private presentationDone = false;
  private completed = false;
  private disposed = false;
  private imageError = false;

  constructor(private readonly underlay: HTMLElement) {
    this.finished = new Promise(resolve => { this.resolveFinished = resolve; });
    this.previousInert = underlay.inert;
    underlay.inert = true;
    this.root.className = 'new-game-film';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Prologue — une longue soirée');
    this.root.tabIndex = -1;
    this.root.innerHTML = `
      <div class="new-game-film-stage" aria-hidden="true"></div>
      <div class="new-game-film-grain" aria-hidden="true"></div>
      <div class="new-game-film-caption"><span data-film-copy aria-hidden="true"></span>
        <span class="new-game-film-announcement" aria-live="polite"></span></div>
      <div class="new-game-film-controls">
        <div class="new-game-film-loading"><span data-film-status>Préparation des images…</span>
          <div class="new-game-film-track" role="progressbar" aria-label="Préparation du hall" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div></div>
        <button type="button" data-film-retry hidden>Réessayer les images</button>
        <button type="button" data-film-action>Passer <span aria-hidden="true">↗</span></button>
      </div>`;
    this.copy = this.root.querySelector('[data-film-copy]')!;
    this.announcement = this.root.querySelector('.new-game-film-announcement')!;
    this.action = this.root.querySelector('[data-film-action]')!;
    this.retry = this.root.querySelector('[data-film-retry]')!;
    this.status = this.root.querySelector('[data-film-status]')!;
    this.progress = this.root.querySelector('.new-game-film-track')!;
    const stage = this.root.querySelector('.new-game-film-stage')!;
    for (const shot of NEW_GAME_SHOTS) {
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.draggable = false;
      img.hidden = true;
      img.dataset.src = `/assets/new-game/${shot.image}.webp`;
      stage.append(img);
      this.images.push(img);
    }
    if (this.reducedMotion) this.root.classList.add('is-reduced-motion');
    document.body.append(this.root);
    this.root.focus({ preventScroll: true });
    this.action.addEventListener('click', this.advance);
    this.retry.addEventListener('click', this.load);
    window.addEventListener('keydown', this.onKey, true);
    document.addEventListener('visibilitychange', this.onVisibility);
    void siteAudio.unlock().catch(() => undefined);
    this.load();
  }

  setProgress(value: number): void {
    const progress = Math.max(0, Math.min(1, value));
    this.progress.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
    (this.progress.firstElementChild as HTMLElement).style.transform = `scaleX(${progress})`;
  }

  setSceneReady(): void {
    if (this.disposed) return;
    this.sceneReady = true;
    this.setProgress(1);
    this.status.textContent = this.imageError ? 'Une image est indisponible.' : '';
    this.progress.hidden = true;
    this.action.disabled = false;
    this.updateAction();
    if (this.presentationDone) this.advance();
  }

  /** Hide the runtime's menu before this fade, keeping the actual scene behind. */
  async reveal(enter: () => void): Promise<void> {
    if (this.disposed) return;
    siteAudio.stopStoryTyping();
    this.underlay.inert = this.previousInert;
    enter();
    this.root.classList.add('is-leaving');
    await new Promise<void>(resolve => {
      this.resolveExit = resolve;
      this.exitTimer = window.setTimeout(resolve, this.reducedMotion ? 180 : 700);
    });
    this.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopTimeline();
    this.loading?.abort();
    if (this.exitTimer !== undefined) window.clearTimeout(this.exitTimer);
    this.resolveExit?.();
    this.resolveFinished();
    window.removeEventListener('keydown', this.onKey, true);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.action.removeEventListener('click', this.advance);
    this.retry.removeEventListener('click', this.load);
    this.root.remove();
    this.underlay.inert = this.previousInert;
    for (const img of this.images) img.removeAttribute('src');
  }

  private load = (): void => {
    this.loading?.abort();
    const controller = this.loading = new AbortController();
    this.imageError = false;
    this.retry.hidden = true;
    this.status.textContent = 'Préparation des images…';
    const decoded = this.images.map(img => new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        img.onload = null; img.onerror = null;
        controller.signal.removeEventListener('abort', abort);
        error ? reject(error) : resolve();
      };
      const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
      const timer = window.setTimeout(() => finish(new Error('Image timeout')), 15000);
      img.onload = () => {
        const decode = typeof img.decode === 'function' ? img.decode() : Promise.resolve();
        void decode.then(() => finish(), finish);
      };
      img.onerror = () => finish(new Error('Image unavailable'));
      controller.signal.addEventListener('abort', abort, { once: true });
      img.src = img.dataset.src!;
      if (img.complete && img.naturalWidth > 0) img.onload(new Event('load'));
    }));
    void Promise.all(decoded).then(() => {
      if (this.disposed || controller.signal.aborted || this.presentationDone) return;
      this.status.textContent = '';
      this.beginShot();
      this.frame = requestAnimationFrame(this.tick);
    }).catch(() => {
      if (this.disposed || controller.signal.aborted || this.presentationDone) return;
      controller.abort();
      this.imageError = true;
      this.status.textContent = 'Une image est indisponible.';
      this.retry.hidden = false;
    });
  };

  private beginShot(): void {
    this.elapsed = 0;
    this.letters = 0;
    this.copy.textContent = '';
    this.announcement.textContent = NEW_GAME_SHOTS[this.shot].text;
    this.root.dataset.shot = String(this.shot + 1);
    this.images.forEach((img, i) => { img.hidden = i !== this.shot && i !== this.shot - 1; });
  }

  private tick = (now: number): void => {
    if (this.disposed || this.presentationDone) return;
    const delta = this.previous === undefined || document.hidden ? 0 : Math.min(50, Math.max(0, now - this.previous));
    this.previous = document.hidden ? undefined : now;
    this.elapsed += delta;
    const shot = NEW_GAME_SHOTS[this.shot];
    const schedule = this.times[this.shot]!;
    const duration = schedule.at(-1)! + HOLD_MS;
    const fraction = Math.min(1, this.elapsed / duration);
    const fade = Math.min(1, this.elapsed / (this.reducedMotion ? 180 : FADE_MS));
    this.images[this.shot]!.style.opacity = String(fade);
    if (this.shot > 0) this.images[this.shot - 1]!.style.opacity = String(1 - fade);
    const zoom = shot.reverse ? 1.11 - .065 * fraction : 1.035 + .075 * fraction;
    this.images[this.shot]!.style.transform = this.reducedMotion ? 'none'
      : `translate3d(${shot.pan * (1 - fraction * 1.5)}%, ${this.shot % 2 ? -.5 * fraction : .5 * fraction}%, 0) scale(${zoom})`;
    const letters = Array.from(shot.text);
    let count = this.letters;
    while (count < schedule.length && this.elapsed >= schedule[count]!) count++;
    if (this.reducedMotion && this.elapsed >= LEAD_MS) count = letters.length;
    if (count !== this.letters) {
      this.copy.textContent = letters.slice(0, count).join('');
      // One audible tick per rendered update, never a burst after a stall.
      if (!this.reducedMotion && !document.hidden) siteAudio.playStoryTypingTick(letters[count - 1]!, count);
      this.letters = count;
    }
    if (this.elapsed >= duration) {
      if (this.shot === NEW_GAME_SHOTS.length - 1) {
        this.advance();
        return;
      }
      this.shot++;
      this.beginShot();
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  private advance = (): void => {
    if (this.disposed || this.completed) return;
    this.presentationDone = true;
    this.stopTimeline();
    this.loading?.abort();
    this.retry.hidden = true;
    if (!this.sceneReady) {
      this.status.textContent = 'Le hall se prépare…';
      this.action.disabled = true;
      this.updateAction();
      return;
    }
    this.completed = true;
    this.action.hidden = true;
    this.resolveFinished();
  };

  private updateAction(): void {
    this.action.innerHTML = this.presentationDone ? 'Préparation…' : 'Passer <span aria-hidden="true">↗</span>';
  }

  private stopTimeline(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    siteAudio.stopStoryTyping();
  }

  private onVisibility = (): void => {
    this.previous = undefined;
    if (document.hidden) siteAudio.stopStoryTyping();
  };

  private onKey = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.key === 'F11') return;
    if (event.key === 'Tab') {
      const buttons = [...this.root.querySelectorAll<HTMLButtonElement>('button:not([hidden]):not(:disabled)')];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = current < 0 ? (event.shiftKey ? buttons.length - 1 : 0)
        : (current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      const target = buttons[next];
      event.preventDefault(); target?.focus();
    } else if (['Escape', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      if (!event.repeat) this.advance();
    }
    event.stopImmediatePropagation();
  };
}
