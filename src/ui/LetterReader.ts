import './letter-reader.css';

export interface LetterContent {
  readonly heading: string;
  readonly address: string;
  readonly paragraphs: readonly string[];
  readonly signature: string;
}

/** The note left in the mailbox: the gift is waiting upstairs. */
export const MAILBOX_NOTE: LetterContent = {
  address: 'Au dernier étage',
  heading: 'Juste un mot',
  paragraphs: [
    'Coucou,',
    'Ça fait longtemps qu’on ne s’est pas parlé. Trop longtemps. Je ne savais plus trop comment revenir vers toi, alors je suis passée tout à l’heure, mais tu n’étais pas là.',
    'Je t’ai laissé un cadeau sur le pas de ta porte. Ouvre-le avant de rentrer, s’il te plaît.',
  ],
  signature: 'Chloé',
};

/** The letter folded in the parcel, beside the compass. */
export const GIFT_LETTER: LetterContent = {
  address: 'Pour toi',
  heading: 'La boussole',
  paragraphs: [
    'Je sais que ça ne va pas trop entre nous en ce moment. Je n’ai pas su te le dire en face, alors je te l’écris.',
    'Cette boussole était à mon grand-père. Il disait qu’elle ramène toujours quelqu’un à la maison.',
    'Garde-la sur toi. Si un jour tu te sens perdu, suis-la : elle te ramènera vers moi. Moi, je ne bouge pas. Je t’attends.',
  ],
  signature: 'Chloé',
};

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
      <p class="mail-date"></p>
      <h2></h2>
      <div class="mail-body"></div>
      <p class="mail-signature"></p>
      <button type="button">Ranger la lettre</button>
      <small>Échap / P : pause · bouton pour ranger la lettre</small>
    </article>`;
    this.setContent(MAILBOX_NOTE);
    container.append(this.root);
    this.root.querySelector('button')!.addEventListener('click', this.close);
    window.addEventListener('keydown', this.onKey, true);
  }

  get isOpen(): boolean { return this.opened; }

  private setContent(content: LetterContent): void {
    this.root.querySelector('.mail-date')!.textContent = content.address;
    this.root.querySelector('h2')!.textContent = content.heading;
    this.root.querySelector('.mail-signature')!.textContent = content.signature;
    const body = this.root.querySelector('.mail-body')!;
    body.replaceChildren(...content.paragraphs.map(text => { const p = document.createElement('p'); p.textContent = text; return p; }));
  }
  setPaused(paused: boolean): void { this.root.hidden = !this.opened || paused; this.root.inert = paused; }

  open(onVisible: () => void, content: LetterContent = MAILBOX_NOTE): void {
    if (this.opened) return;
    this.setContent(content);
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
