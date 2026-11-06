import { mapWithConcurrency } from '../core/CooperativeWork';
import { siteAudio } from '../audio/SiteAudio';
import { LoadingScreen } from './LoadingScreen';
import { CinematicCaption } from './CinematicCaption';
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
const HOLD_MS = 3000;
export const MIN_PHOTO_DURATION_MS = 6500;
const FADE_MS = 850;
const letterTimes = (text: string): number[] => {
  let at = LEAD_MS;
  return Array.from(text, (letter, i) => {
    at += /[.,:!?]/.test(letter) ? 190 : letter === ' ' ? 28 : 45 + i % 5 * 4;
    return at;
  });
};

/** Photos use compositor animation; visible-time captions never skip a card.
 * Only downloads run underneath; scene construction follows finished.
 * Music then transfers to the animated entrance presentation. */
export class NewGameIntro {
  private static readonly inputOwners = new WeakMap<HTMLElement, NewGameIntro>();
  readonly finished: Promise<void>;
  private readonly root = document.createElement('section');
  private readonly images: HTMLImageElement[] = [];
  private readonly copy: HTMLElement;
  private readonly caption: CinematicCaption;
  private readonly announcement: HTMLElement;
  private readonly action: HTMLButtonElement;
  private readonly retry: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly waiting: HTMLElement;
  private readonly loadingScreen = new LoadingScreen('Vous rentrez chez vous.');
  private readonly animations = new Map<HTMLImageElement, Animation[]>();
  private readonly timedAnimations = new Set<Animation>();
  private readonly pausedAnimations = new Set<Animation>();
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly previousInert: boolean;
  private inputReleased = false;
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
  private disposed = false;
  private imageError = false;
  private musicTransferred = false;
  private readonly decodedImages = new Set<number>();
  private skipped = false;
  private revealing = false;
  private started = false;
  private cancelVisibilityWait?: () => void;
  get wasSkipped(): boolean { return this.skipped; }

  constructor(private readonly underlay: HTMLElement) {
    this.finished = new Promise(resolve => { this.resolveFinished = resolve; });
    this.previousInert = NewGameIntro.inputOwners.get(underlay)?.previousInert ?? underlay.inert;
    NewGameIntro.inputOwners.set(underlay, this);
    underlay.inert = true;
    this.root.className = 'new-game-film';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Prologue — une longue soirée');
    this.root.tabIndex = -1;
    this.root.innerHTML = `
      <div class="new-game-film-stage" aria-hidden="true"></div>
      <div class="new-game-film-caption"><span data-film-copy aria-hidden="true"></span>
        <span class="new-game-film-announcement" aria-live="polite"></span></div>
      <div class="new-game-film-wait" role="status" hidden>
        <span class="new-game-film-spinner" aria-hidden="true"></span><span>Chargement</span>
        <div class="new-game-film-progress" role="progressbar" aria-label="Chargement du niveau" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
      </div>
      <div class="new-game-film-controls">
        <span class="new-game-film-loading" data-film-status role="status"></span>
        <button type="button" data-film-retry hidden>Réessayer les images</button>
        <button type="button" data-film-action>Passer</button>
      </div>`;
    this.copy = this.root.querySelector('[data-film-copy]')!;
    this.caption = new CinematicCaption(this.copy);
    this.announcement = this.root.querySelector('.new-game-film-announcement')!;
    this.action = this.root.querySelector('[data-film-action]')!;
    this.retry = this.root.querySelector('[data-film-retry]')!;
    this.status = this.root.querySelector('[data-film-status]')!;
    this.waiting = this.root.querySelector('.new-game-film-wait')!;
    this.waiting.replaceChildren(this.loadingScreen.element);
    const stage = this.root.querySelector('.new-game-film-stage')!;
    for (const shot of NEW_GAME_SHOTS) {
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.fetchPriority = this.images.length === 0 ? 'high' : 'auto';
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

  setSceneReady(): void {
    if (this.disposed) return;
    this.sceneReady = true;
    this.status.textContent = this.imageError ? 'Une image est indisponible.' : '';
    this.setProgress(1);
  }

  setProgress(value: number, phase?: string): void {
    this.loadingScreen.setProgress(value, phase);
  }

  /** Hide the runtime's menu before this fade, keeping the actual scene behind. */
  async reveal(enter: () => void, options: { continueMusic?: boolean } = {}): Promise<void> {
    if (this.disposed || this.revealing) return;
    this.revealing = true;
    if (document.hidden) await new Promise<void>(resolve => {
      const release = () => { document.removeEventListener('visibilitychange', visible); this.cancelVisibilityWait = undefined; resolve(); };
      const visible = () => { if (!document.hidden) release(); };
      this.cancelVisibilityWait = release;
      document.addEventListener('visibilitychange', visible);
    });
    if (this.disposed) return;
    siteAudio.stopStoryTyping();
    if (!options.continueMusic) siteAudio.fadeStoryMusicOut();
    this.releaseInput();
    enter();
    this.musicTransferred = !!options.continueMusic;
    this.waiting.hidden = true;
    this.root.classList.add('is-leaving');
    if (this.skipped) { this.dispose(); return; }
    await new Promise<void>(resolve => {
      this.resolveExit = resolve;
      this.exitTimer = window.setTimeout(resolve, this.reducedMotion ? 180 : 700);
    });
    this.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelVisibilityWait?.();
    this.stopTimeline();
    this.caption.stop();
    if (!this.musicTransferred) siteAudio.stopStoryMusic();
    for (const list of this.animations.values()) for (const animation of list) animation.cancel();
    this.animations.clear(); this.timedAnimations.clear(); this.pausedAnimations.clear();
    this.loading?.abort();
    if (this.exitTimer !== undefined) window.clearTimeout(this.exitTimer);
    this.resolveExit?.();
    this.resolveFinished();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.action.removeEventListener('click', this.advance);
    this.retry.removeEventListener('click', this.load);
    this.root.remove();
    this.releaseInput();
    for (const img of this.images) img.removeAttribute('src');
  }

  private releaseInput(): void {
    if (this.inputReleased) return;
    this.inputReleased = true;
    window.removeEventListener('keydown', this.onKey, true);
    // An obsolete/fading film must neither unlock its replacement nor restore
    // the replacement's temporary `inert` flag after gameplay has begun.
    if (NewGameIntro.inputOwners.get(this.underlay) !== this) return;
    NewGameIntro.inputOwners.delete(this.underlay);
    this.underlay.inert = this.previousInert;
  }

  private load = (): void => {
    this.loading?.abort();
    const controller = this.loading = new AbortController();
    this.imageError = false;
    this.retry.hidden = true;
    this.status.textContent = '';
    // A retry of a later photo must not clear the current sentence or rewind
    // to the first photograph. Successfully decoded images remain reusable.
    const decoded = mapWithConcurrency(this.images, 2, (img, index) => new Promise<void>((resolve, reject) => {
      if (controller.signal.aborted) { reject(controller.signal.reason); return; }
      if (this.decodedImages.has(index)) { resolve(); return; }
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        img.onload = null; img.onerror = null;
        controller.signal.removeEventListener('abort', abort);
        if (error) reject(error);
        else {
          this.decodedImages.add(index); resolve();
          if (index === 0 && !this.started && !this.disposed && !controller.signal.aborted && !this.presentationDone) {
            this.started = true;
            this.shot = 0; this.previous = undefined;
            siteAudio.startStoryMusic(); this.beginShot(); this.frame = requestAnimationFrame(this.tick);
          }
        }
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
    void decoded.then(() => {
      if (this.disposed || controller.signal.aborted || this.presentationDone) return;
      this.status.textContent = '';
    }).catch(() => {
      if (this.disposed || controller.signal.aborted || this.presentationDone) return;
      controller.abort();
      this.imageError = true;
      this.status.textContent = 'Une image est indisponible.';
      this.retry.hidden = false;
    });
  };

  private beginShot(): void {
    // Freeze the outgoing shot at its final pose. Only the newly created fade
    // should follow the next shot's zero-based clock, not its previous zoom.
    this.timedAnimations.clear();
    this.elapsed = 0;
    this.letters = 0;
    this.announcement.textContent = NEW_GAME_SHOTS[this.shot].text;
    this.root.dataset.shot = String(this.shot + 1);
    this.images.forEach((img, i) => {
      img.hidden = i !== this.shot && i !== this.shot - 1;
      if (i < this.shot - 1) { for (const animation of this.animations.get(img) ?? []) animation.cancel(); this.animations.delete(img); }
    });
    const shot = NEW_GAME_SHOTS[this.shot];
    const image = this.images[this.shot]!;
    const duration = Math.max(MIN_PHOTO_DURATION_MS, this.times[this.shot]!.at(-1)! + HOLD_MS);
    this.caption.show(shot.text, this.times[this.shot]!, duration, this.reducedMotion);
    const transform = (fraction: number): string => `translate3d(${shot.pan * (1 - fraction * 1.5)}%, ${this.shot % 2 ? -.5 * fraction : .5 * fraction}%, 0) scale(${shot.reverse ? 1.11 - .065 * fraction : 1.035 + .075 * fraction})`;
    image.style.transform = this.reducedMotion ? 'none' : transform(0);
    // Transform/opacity run in the compositor, not in the text's JS frame loop.
    if (!this.reducedMotion) this.animate(image, [{ transform: transform(0) }, { transform: transform(1) }], duration);
    this.animate(image, [{ opacity: 0 }, { opacity: 1 }], this.reducedMotion ? 150 : FADE_MS);
    if (this.shot > 0) this.animate(this.images[this.shot - 1]!, [{ opacity: 1 }, { opacity: 0 }], this.reducedMotion ? 150 : FADE_MS);
  }

  private animate(image: HTMLImageElement, frames: Keyframe[], duration: number): void {
    if (typeof image.animate !== 'function') { Object.assign(image.style, frames.at(-1)); return; }
    const animation = image.animate(frames, { duration, fill: 'both', easing: 'linear' });
    void animation.finished.catch(() => undefined);
    this.animations.set(image, [...(this.animations.get(image) ?? []), animation]);
    this.timedAnimations.add(animation);
      // A single visible-time clock drives both the compositor and captions.
      // Paused animations cannot race ahead when a CPU task delays a frame.
      animation.pause();
  }

  private tick = (now: number): void => {
    if (this.disposed || this.presentationDone) return;
    const delta = this.previous === undefined || document.hidden ? 0 : Math.min(50, Math.max(0, now - this.previous));
    this.previous = document.hidden ? undefined : now;
    this.elapsed += delta;
    for (const animation of this.timedAnimations) animation.currentTime = this.elapsed;
    const shot = NEW_GAME_SHOTS[this.shot];
    const schedule = this.times[this.shot]!;
    const duration = Math.max(MIN_PHOTO_DURATION_MS, schedule.at(-1)! + HOLD_MS);
    const letters = Array.from(shot.text);
    const count = this.caption.update(this.elapsed);
    if (count !== this.letters) {
      // One audible tick per rendered update, never a burst after a stall.
      if (!this.reducedMotion && !document.hidden) siteAudio.playStoryTypingTick(letters[count - 1]!, count);
      this.letters = count;
    }
    if (this.elapsed >= duration && this.caption.ready(HOLD_MS) && (this.shot === NEW_GAME_SHOTS.length - 1 || this.decodedImages.has(this.shot + 1))) {
      if (this.shot === NEW_GAME_SHOTS.length - 1) {
        this.finish(false);
        return;
      }
      this.shot++;
      this.beginShot();
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  private advance = (event?: Event): void => {
    event?.preventDefault(); event?.stopPropagation();
    this.finish(true);
  };

  private finish(skipped: boolean): void {
    if (this.disposed || this.presentationDone) return;
    this.presentationDone = true;
    this.skipped = skipped;
    if (skipped) siteAudio.stopStoryMusic();
    this.stopTimeline();
    this.caption.stop();
    for (const list of this.animations.values()) for (const animation of list) animation.cancel();
    this.animations.clear(); this.timedAnimations.clear(); this.pausedAnimations.clear();
    this.loading?.abort();
    this.retry.hidden = true;
    // Preserve the last complete sentence through the fade into a ready scene.
    this.root.classList.toggle('is-waiting', skipped || !this.sceneReady);
    this.waiting.hidden = this.sceneReady;
    this.action.hidden = true;
    this.resolveFinished();
  }

  private stopTimeline(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    siteAudio.stopStoryTyping();
  }

  private onVisibility = (): void => {
    this.previous = undefined;
    this.caption.setPaused(document.hidden);
    if (document.hidden) siteAudio.stopStoryTyping();
    siteAudio.setStoryMusicPaused(document.hidden);
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
