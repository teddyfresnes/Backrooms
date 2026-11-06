import './letter-reader.css';

export class LetterReader {
  private readonly root = document.createElement('section');
  private opened = false;
  private frame?: number;

  /** `onClose` receives the trusted click that closed the letter, so pointer capture can be requested inside that gesture. */
  constructor(private readonly container: HTMLElement, private readonly onOpen: () => void, private readonly onClose: (event?: MouseEvent) => void) {
    this.root.className = 'letter-reader'; this.root.hidden = true;
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Lire le courrier');
    this.root.innerHTML = `<article class="mail-paper" tabindex="0">
      <p class="mail-date">À l’occupant du dernier étage</p>
      <h2>Un mot entre voisins</h2>
      <p>Bonsoir,</p>
      <p>J’ai accroché votre voiture en manœuvrant ce soir. Le rétroviseur côté conducteur est cassé. Je suis vraiment désolé.</p>
      <p>Je repasserai demain pour qu’on règle ça ensemble.</p>
      <p class="mail-signature">Votre voisin du dessous.</p>
      <button type="button">Ranger la lettre</button>
      <small>Échap / P : pause · bouton pour ranger la lettre</small>
    </article>`;
    container.append(this.root);
    this.root.querySelector('button')!.addEventListener('click', this.close);
    window.addEventListener('keydown', this.onKey, true);
  }

  get isOpen(): boolean { return this.opened; }
  setPaused(paused: boolean): void { this.root.hidden = !this.opened || paused; this.root.inert = paused; }

  open(onVisible: () => void): void {
    if (this.opened) return;
    this.opened = true; this.root.hidden = false; this.container.classList.add('is-reading-letter');
    this.onOpen(); this.root.querySelector<HTMLButtonElement>('button')!.focus({ preventScroll: true });
    this.frame = requestAnimationFrame(() => { this.frame = undefined; if (this.opened) onVisible(); });
  }

  private close = (event?: Event): void => {
    if (!this.opened) return;
    // The closing click must not fall through to the world behind the letter.
    event?.preventDefault(); event?.stopPropagation();
    this.opened = false; this.root.hidden = true; this.container.classList.remove('is-reading-letter');
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined; this.onClose(event instanceof MouseEvent ? event : undefined);
  };

  private onKey = (event: KeyboardEvent): void => {
    if (!this.opened || this.root.hidden || event.ctrlKey || event.metaKey || event.altKey || event.key === 'F11') return;
    if (event.key === 'Tab') { event.preventDefault(); this.root.querySelector<HTMLButtonElement>('button')!.focus(); }
    if (event.key === 'Escape') { event.preventDefault(); if (!event.repeat) this.close(); }
    event.stopImmediatePropagation();
  };

  dispose(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    window.removeEventListener('keydown', this.onKey, true);
    this.root.querySelector('button')!.removeEventListener('click', this.close);
    this.root.remove(); this.container.classList.remove('is-reading-letter'); this.opened = false;
  }
}
