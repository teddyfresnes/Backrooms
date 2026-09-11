import * as THREE from 'three';
import { EMOTES, EMOTE_SLOTS, EMOTE_STORAGE_KEY, loadEmoteFavorites, type EmoteId } from './EmoteCatalog';
import { EmotePreview } from './EmotePreview';
import './EmoteMenu.css';

const icon = (name: 'star' | 'grid' | 'close' | 'back' | 'play') => {
  const paths = {
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
    grid: '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    back: '<path d="m14 6-6 6 6 6"/>',
    play: '<path d="m9 5 10 7-10 7Z"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
};

interface EmoteMenuCallbacks { onOpen(): void; onClose(resume: boolean): void; onPlay(id: EmoteId): boolean }

export class EmoteMenu {
  readonly element = document.createElement('div');
  readonly launcher = document.createElement('button');
  favorites = loadEmoteFavorites();
  isOpen = false;
  private view: 'wheel' | 'collection' = 'wheel';
  private selected: EmoteId = EMOTES[0].id;
  private replacement: EmoteId | null = null;
  private preview?: EmotePreview;
  private durations = new Map<EmoteId, number>();
  private available = new Set<EmoteId>();
  private previousFocus: HTMLElement | null = null;

  constructor(root: HTMLElement, private readonly callbacks: EmoteMenuCallbacks) {
    this.element.className = 'emote-overlay';
    this.element.hidden = true;
    this.launcher.type = 'button';
    this.launcher.className = 'emote-launcher';
    this.launcher.disabled = true;
    this.launcher.setAttribute('aria-label', 'Ouvrir les emotes (C)');
    this.launcher.setAttribute('aria-haspopup', 'dialog');
    this.launcher.setAttribute('aria-expanded', 'false');
    this.launcher.innerHTML = `${icon('grid')}<span>Emotes</span><kbd>C</kbd>`;
    this.launcher.addEventListener('click', () => this.open());
    this.element.addEventListener('click', this.onClick);
    this.element.addEventListener('pointerover', this.onHover);
    this.element.addEventListener('focusin', this.onHover);
    window.addEventListener('keydown', this.onKeyDown, true);
    root.append(this.launcher, this.element);
  }

  prepare(character: THREE.Group, clips: ReadonlyMap<EmoteId, THREE.AnimationClip>): void {
    for (const [id, clip] of clips) { this.durations.set(id, clip.duration); this.available.add(id); }
    // A preview failure must not prevent the game or the picker from working.
    try { this.preview = new EmotePreview(character, clips); }
    catch (error) { console.warn('Aperçus des emotes indisponibles', error); }
    this.launcher.disabled = false;
  }

  open(): void {
    if (this.isOpen || this.launcher.disabled) return;
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.isOpen = true;
    this.view = 'wheel';
    this.replacement = null;
    this.element.hidden = false;
    this.launcher.setAttribute('aria-expanded', 'true');
    this.callbacks.onOpen();
    this.render();
    this.element.querySelector<HTMLButtonElement>('[data-action="collection"]')?.focus();
  }

  close(resume = true): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.replacement = null;
    this.element.hidden = true;
    this.launcher.setAttribute('aria-expanded', 'false');
    this.callbacks.onClose(resume);
    this.previousFocus?.focus({ preventScroll: true });
  }

  update(delta: number): void { if (this.isOpen && this.view === 'collection') this.preview?.update(delta); }

  private image(id: EmoteId | null): string {
    const source = id ? this.preview?.thumbnails.get(id) : undefined;
    return source ? `<img src="${source}" alt="" draggable="false">` : `<span class="emote-placeholder" aria-hidden="true">${icon(id ? 'play' : 'star')}</span>`;
  }

  private render(): void {
    const count = this.favorites.filter(Boolean).length;
    this.element.innerHTML = `<section class="emote-dialog emote-dialog--${this.view}" role="dialog" aria-modal="true" aria-labelledby="emote-heading">
      <header class="emote-header"><div class="emote-heading-group">${this.view === 'collection' ? `<button type="button" class="emote-icon-button" data-action="wheel" aria-label="Revenir à la roue">${icon('back')}</button>` : ''}<div><p class="emote-eyebrow">${this.view === 'wheel' ? 'VOS FAVORIS' : 'LA COLLECTION'}</p><h2 id="emote-heading">${this.view === 'wheel' ? 'Emotes' : 'Toutes les emotes'}</h2></div></div><button type="button" class="emote-close" data-action="close" aria-label="Fermer les emotes">${icon('close')}<kbd>Échap</kbd></button></header>
      ${this.view === 'wheel' ? this.wheelMarkup() : this.collectionMarkup()}
      <footer class="emote-footer"><span>${this.view === 'wheel' ? '<kbd>1–8</kbd> Jouer un favori' : '<span class="emote-star-hint">☆</span> Ajouter ou retirer un favori'}</span><span>${this.view === 'wheel' ? `${count}/${EMOTE_SLOTS} favoris` : `${this.available.size} emotes`}</span></footer>
    </section>`;
    if (this.view === 'collection') {
      const target = this.element.querySelector('[data-preview]');
      if (target && this.preview) target.append(this.preview.canvas);
      this.select(this.selected);
    }
  }

  private wheelMarkup(): string {
    return `<div class="emote-wheel" aria-label="Roue de favoris">${this.favorites.map((id, index) => {
      const emote = EMOTES.find(entry => entry.id === id);
      const angle = (index * 45 - 90) * Math.PI / 180;
      return `<button type="button" class="emote-slot${id ? '' : ' is-empty'}" style="--slot-x:${Math.cos(angle) * 34}%;--slot-y:${Math.sin(angle) * 34}%" data-slot="${index}"${id ? ` data-emote="${id}"` : ' data-action="collection"'} aria-label="${index + 1} : ${emote?.label ?? 'Choisir un favori'}"><kbd>${index + 1}</kbd>${this.image(id)}<span>${emote?.label ?? 'Ajouter'}</span></button>`;
    }).join('')}<button type="button" class="emote-wheel-center" data-action="collection">${icon('grid')}<span>Toutes les<br>emotes</span><small>${this.available.size} à découvrir</small></button></div><p class="emote-wheel-caption" aria-live="polite" data-wheel-caption>Choisissez une emote</p>`;
  }

  private collectionMarkup(): string {
    return `<div class="emote-collection"><aside class="emote-inspector"><div class="emote-preview-stage" data-preview>${this.preview ? '' : this.image(this.selected)}</div><div class="emote-inspector-info"><p class="emote-eyebrow" data-preview-kind></p><h3 data-preview-label></h3><button type="button" class="emote-play" data-action="play">${icon('play')}<span>Jouer l’emote</span></button><p class="emote-stop-hint">Déplacez-vous pour arrêter</p></div></aside><div class="emote-card-grid" aria-label="Choisir une emote">${EMOTES.map(emote => `<div class="emote-card${emote.id === this.selected ? ' is-selected' : ''}" data-card="${emote.id}"><button type="button" class="emote-card-select" data-emote="${emote.id}" aria-label="Aperçu : ${emote.label}" aria-pressed="${emote.id === this.selected}">${this.image(emote.id)}<span>${emote.label}</span></button><button type="button" class="emote-favorite" data-favorite="${emote.id}" aria-label="${this.favorites.includes(emote.id) ? 'Retirer' : 'Ajouter'} ${emote.label} ${this.favorites.includes(emote.id) ? 'des' : 'aux'} favoris" aria-pressed="${this.favorites.includes(emote.id)}">${icon('star')}</button></div>`).join('')}</div></div><div class="emote-favorites"><div class="emote-favorites-heading"><strong>Votre roue <span>${this.favorites.filter(Boolean).length}/${EMOTE_SLOTS}</span></strong><p role="status" data-favorite-status>${this.replacement ? `Choisissez le favori à remplacer par « ${EMOTES.find(e => e.id === this.replacement)!.label} »` : 'Cliquez sur une étoile pour personnaliser'}</p>${this.replacement ? '<button type="button" data-action="cancel-replace">Annuler</button>' : ''}</div><div class="emote-favorite-strip${this.replacement ? ' is-replacing' : ''}">${this.favorites.map((id, index) => `<button type="button" class="emote-mini-slot" data-replace="${index}" aria-label="${this.replacement ? 'Remplacer' : 'Aperçu du favori'} ${index + 1} : ${EMOTES.find(e => e.id === id)?.label ?? 'Emplacement libre'}"><kbd>${index + 1}</kbd>${this.image(id)}<span>${EMOTES.find(e => e.id === id)?.label ?? 'Libre'}</span></button>`).join('')}</div></div>`;
  }

  private select(id: EmoteId): void {
    this.selected = id;
    const emote = EMOTES.find(entry => entry.id === id)!;
    const caption = this.element.querySelector('[data-wheel-caption]');
    if (caption) caption.textContent = emote.label;
    this.element.querySelectorAll<HTMLElement>('[data-emote]').forEach(button => {
      const active = button.dataset.emote === id;
      button.classList.toggle('is-selected', active);
      if (this.view === 'collection') button.setAttribute('aria-pressed', String(active));
    });
    if (this.view !== 'collection') return;
    this.element.querySelectorAll<HTMLElement>('[data-card]').forEach(card => card.classList.toggle('is-selected', card.dataset.card === id));
    this.element.querySelector('[data-preview-label]')!.textContent = emote.label;
    this.element.querySelector('[data-preview-kind]')!.textContent = emote.mode === 'hold' ? 'POSE' : emote.mode === 'loop' ? 'EN BOUCLE' : `${(this.durations.get(id) ?? 0).toFixed(1).replace('.', ',')} S`;
    const play = this.element.querySelector<HTMLButtonElement>('[data-action="play"]')!;
    play.disabled = !this.available.has(id);
    this.preview?.select(id);
  }

  private saveFavorites(focusId?: EmoteId): void {
    try { localStorage.setItem(EMOTE_STORAGE_KEY, JSON.stringify(this.favorites)); } catch { /* Device-local preference only. */ }
    this.render();
    if (focusId) this.element.querySelector<HTMLButtonElement>(`[data-favorite="${focusId}"]`)?.focus();
  }

  private toggleFavorite(id: EmoteId): void {
    const existing = this.favorites.indexOf(id);
    const free = this.favorites.indexOf(null);
    this.replacement = null;
    if (existing >= 0) this.favorites[existing] = null;
    else if (free >= 0) this.favorites[free] = id;
    else {
      this.replacement = id;
      this.render();
      this.element.querySelector<HTMLButtonElement>('[data-replace]')?.focus();
      return;
    }
    this.saveFavorites(id);
  }

  private play(id: EmoteId): void {
    if (!this.available.has(id)) return;
    if (this.callbacks.onPlay(id)) this.close(true);
    else {
      const status = this.element.querySelector('[data-favorite-status], [data-wheel-caption]');
      if (status) status.textContent = 'Les emotes se jouent debout, au sol.';
    }
  }

  private readonly onClick = (event: MouseEvent): void => {
    if (event.target === this.element) { this.close(); return; }
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || !this.element.contains(button)) return;
    const { action, emote, favorite, replace } = button.dataset;
    if (action === 'close') this.close();
    else if (action === 'wheel' || action === 'collection') {
      this.view = action === 'wheel' ? 'wheel' : 'collection'; this.replacement = null; this.render();
      this.element.querySelector<HTMLButtonElement>(this.view === 'wheel' ? '[data-action="collection"]' : '[data-emote]')?.focus();
    } else if (action === 'play') this.play(this.selected);
    else if (action === 'cancel-replace') { this.replacement = null; this.render(); this.element.querySelector<HTMLButtonElement>('[data-favorite]')?.focus(); }
    else if (favorite) this.toggleFavorite(favorite as EmoteId);
    else if (replace !== undefined) {
      const index = Number(replace);
      if (this.replacement) { const id = this.replacement; this.favorites[index] = id; this.replacement = null; this.saveFavorites(id); }
      else if (this.favorites[index]) this.select(this.favorites[index]!);
    } else if (emote) { if (this.view === 'wheel') this.play(emote as EmoteId); else this.select(emote as EmoteId); }
  };

  private readonly onHover = (event: Event): void => {
    if (this.view !== 'wheel') return;
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-emote]');
    if (button?.dataset.emote) this.select(button.dataset.emote as EmoteId);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.isOpen) return;
    event.stopImmediatePropagation();
    if (event.code === 'Escape' || event.code === 'KeyC' || event.key.toLowerCase() === 'c') {
      event.preventDefault();
      if (!event.repeat) { if (this.view === 'collection' && event.code === 'Escape') { this.view = 'wheel'; this.replacement = null; this.render(); this.element.querySelector<HTMLButtonElement>('[data-action="collection"]')?.focus(); } else this.close(); }
    } else if (event.code === 'Tab') {
      const buttons = [...this.element.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    } else if (this.view === 'wheel' && /^(?:Digit|Numpad)[1-8]$/.test(event.code)) {
      event.preventDefault(); const id = this.favorites[Number(event.code.at(-1)) - 1]; if (id && !event.repeat) this.play(id);
    } else if (event.code.startsWith('Arrow')) {
      event.preventDefault();
      const buttons = [...this.element.querySelectorAll<HTMLButtonElement>(this.view === 'wheel' ? '[data-slot]' : '[data-emote]')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const rowStart = buttons.findIndex(button => button.getBoundingClientRect().top > buttons[0]!.getBoundingClientRect().top + 2);
      const columns = rowStart > 0 ? rowStart : 5;
      const offset = event.code === 'ArrowLeft' ? -1 : event.code === 'ArrowRight' ? 1 : this.view === 'collection' ? (event.code === 'ArrowUp' ? -columns : columns) : (event.code === 'ArrowUp' ? -1 : 1);
      buttons[(index + offset + buttons.length) % buttons.length]?.focus();
      if (this.view === 'collection') { const id = (document.activeElement as HTMLElement).dataset.emote; if (id) this.select(id as EmoteId); }
    }
  };

  dispose(): void { window.removeEventListener('keydown', this.onKeyDown, true); this.preview?.dispose(); this.element.remove(); this.launcher.remove(); }
}
