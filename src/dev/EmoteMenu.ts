import { EMOTES, EMOTE_SLOTS, EMOTE_STORAGE_KEY, loadEmoteFavorites, type EmoteId } from './EmoteCatalog';
import './EmoteMenu.css';

const icon = (name: 'star' | 'grid' | 'close' | 'back') => {
  const paths = {
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
    grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>', back: '<path d="m14 6-6 6 6 6"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
};
const shortLabel: Record<EmoteId, string> = {
  'emote-greeting': 'Saluer', 'emote-clapping': 'Bravo', 'emote-pointing': 'Pointer',
  'emote-salute': 'Salut', 'emote-hip-hop': 'Hip-hop', 'emote-wave': 'Vague',
  'emote-freeze': 'Freeze', 'emote-sweat': 'Ouf', 'emote-laying': 'Au sol', 'emote-kip-up': 'Kip-up',
};
const polar = (radius: number, angle: number) => [180 + radius * Math.sin(angle), 180 - radius * Math.cos(angle)];
const sectorPath = (index: number): string => {
  const a = (index * 45 - 21) * Math.PI / 180, b = (index * 45 + 21) * Math.PI / 180;
  const [ax, ay] = polar(174, a), [bx, by] = polar(174, b), [cx, cy] = polar(70, b), [dx, dy] = polar(70, a);
  return `M${ax},${ay} A174,174 0 0 1 ${bx},${by} L${cx},${cy} A70,70 0 0 0 ${dx},${dy}Z`;
};

interface EmoteMenuCallbacks {
  onOpen(): void;
  onClose(): void;
  onPlay(id: EmoteId): boolean;
  isPointerLocked(): boolean;
  isGameControl(code: string): boolean;
}

/** A HUD picker: never takes ownership of movement, aim, or the game clock. */
export class EmoteMenu {
  readonly element = document.createElement('div');
  favorites = loadEmoteFavorites();
  isOpen = false;
  private ready = false;
  private view: 'wheel' | 'collection' = 'wheel';
  private selectedIndex = -1;
  private replacement: EmoteId | null = null;
  private readonly available = new Set<EmoteId>();
  private previousFocus: HTMLElement | null = null;
  private heldAt: number | null = null;
  private pointerMoved = false;
  private pointerX = 0;
  private pointerY = 0;
  private wheelRect = { left: 0, top: 0, width: 360, height: 360 };
  private dirtyPointer = false;
  private hoveredButton: HTMLButtonElement | null = null;
  private swallowRelease = false;
  private swallowClick = false;

  constructor(root: HTMLElement, private readonly callbacks: EmoteMenuCallbacks) {
    this.element.className = 'emote-overlay';
    this.element.hidden = true;
    this.element.addEventListener('click', this.onClick);
    this.element.addEventListener('pointerover', this.onHover);
    this.element.addEventListener('focusin', this.onHover);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('mousemove', this.onMouseMove, true);
    window.addEventListener('mousedown', this.onMouseDown, true);
    window.addEventListener('mouseup', this.onMouseUp, true);
    window.addEventListener('click', this.onWindowClick, true);
    window.addEventListener('wheel', this.onScroll, { capture: true, passive: false });
    window.addEventListener('resize', this.onResize);
    window.addEventListener('blur', this.onBlur);
    root.append(this.element);
  }

  prepare(clips: ReadonlyMap<EmoteId, { duration: number }>): void {
    for (const [id] of clips) this.available.add(id);
    this.ready = true;
    this.render();
  }

  open(fromKey = false): void {
    if (this.isOpen || !this.ready) return;
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.isOpen = true;
    this.selectedIndex = -1;
    this.heldAt = fromKey ? performance.now() : null;
    this.pointerMoved = false;
    this.view = 'wheel';
    this.replacement = null;
    this.element.hidden = false;
    // Opening does not focus a modal or release the gameplay pointer.
    this.render();
    this.callbacks.onOpen();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.heldAt = null;
    this.replacement = null;
    this.element.hidden = true;
    this.hoveredButton = null;
    this.callbacks.onClose();
    if (document.activeElement instanceof HTMLElement && this.element.contains(document.activeElement)) this.previousFocus?.focus({ preventScroll: true });
  }

  private image(id: EmoteId | null): string {
    const emote = EMOTES.find(entry => entry.id === id);
    return emote ? `<img src="/assets/emotes/icons/${emote.file}.png" alt="" draggable="false" width="64" height="64">` : '<span class="emote-empty">+</span>';
  }

  private render(): void {
    this.hoveredButton = null;
    this.element.classList.toggle('has-game-pointer', this.callbacks.isPointerLocked());
    this.element.innerHTML = `<section class="emote-panel emote-panel--${this.view}" role="region" aria-label="${this.view === 'wheel' ? 'Roue des emotes' : 'Toutes les emotes'}">
      ${this.view === 'wheel' ? this.wheelMarkup() : this.collectionMarkup()}
    </section><span class="emote-cursor" aria-hidden="true" data-cursor></span>`;
    if (this.isOpen) this.resetPointer();
  }

  private wheelMarkup(): string {
    return `<div class="emote-wheel"><svg class="emote-ring" viewBox="0 0 360 360" aria-hidden="true">${this.favorites.map((_id, index) => `<path d="${sectorPath(index)}" data-ring-slot="${index}"/>`).join('')}</svg>${this.favorites.map((id, index) => {
      const angle = index * Math.PI / 4;
      return `<button type="button" class="emote-slot${id ? '' : ' is-empty'}" style="--slot-x:${Math.sin(angle) * 34}%;--slot-y:${-Math.cos(angle) * 34}%" data-slot="${index}"${id ? ` data-emote="${id}"` : ' data-action="collection"'} aria-label="${index + 1} : ${EMOTES.find(e => e.id === id)?.label ?? 'Ajouter un favori'}"><kbd>${index + 1}</kbd>${this.image(id)}<span>${id ? shortLabel[id] : 'Ajouter'}</span></button>`;
    }).join('')}<button type="button" class="emote-wheel-center" data-action="collection">${icon('grid')}<span>Tout voir</span></button></div><div class="emote-caption"><strong data-wheel-caption aria-live="polite">Emotes</strong><span data-wheel-help>${this.heldAt !== null ? '<kbd>C</kbd> maintenu : viser puis relâcher' : '<kbd>1–8</kbd> ou clic · <kbd>C</kbd> fermer'}</span></div>`;
  }

  private collectionMarkup(): string {
    return `<header class="emote-header"><button type="button" data-action="wheel" class="emote-icon-button" aria-label="Revenir à la roue">${icon('back')}</button><h2>Toutes les emotes</h2><button type="button" data-action="close" class="emote-icon-button" aria-label="Fermer">${icon('close')}</button></header><div class="emote-card-grid">${EMOTES.map(emote => `<div class="emote-card" data-card="${emote.id}"><button type="button" class="emote-card-select" data-emote="${emote.id}" aria-label="Jouer : ${emote.label}">${this.image(emote.id)}<span>${emote.label}</span></button><button type="button" class="emote-favorite" data-favorite="${emote.id}" aria-label="${this.favorites.includes(emote.id) ? 'Retirer' : 'Ajouter'} ${emote.label} ${this.favorites.includes(emote.id) ? 'des' : 'aux'} favoris" aria-pressed="${this.favorites.includes(emote.id)}">${icon('star')}</button></div>`).join('')}</div><div class="emote-favorites"><div class="emote-favorites-heading"><strong>Favoris <span>${this.favorites.filter(Boolean).length}/${EMOTE_SLOTS}</span></strong>${this.replacement ? '<button type="button" data-action="cancel-replace">Annuler</button>' : ''}</div><p role="status" data-favorite-status>${this.replacement ? `Remplacer quel favori par « ${EMOTES.find(e => e.id === this.replacement)!.label} » ?` : '☆ pour personnaliser votre roue'}</p><div class="emote-favorite-strip${this.replacement ? ' is-replacing' : ''}">${this.favorites.map((id, index) => `<button type="button" class="emote-mini-slot" data-replace="${index}" aria-label="${this.replacement ? 'Remplacer' : 'Retirer'} le favori ${index + 1} : ${EMOTES.find(e => e.id === id)?.label ?? 'Libre'}"><kbd>${index + 1}</kbd><span>${id ? shortLabel[id] : '+'}</span></button>`).join('')}</div></div><footer class="emote-footer">Clic : jouer · <kbd>C</kbd> fermer</footer>`;
  }

  private resetPointer(): void {
    const wheel = this.element.querySelector<HTMLElement>('.emote-wheel');
    const box = (wheel ?? this.element.querySelector<HTMLElement>('.emote-panel')!).getBoundingClientRect();
    this.wheelRect = box.width > 0 ? box : { left: window.innerWidth - 390, top: (window.innerHeight - 360) / 2, width: 360, height: 360 };
    this.pointerX = this.wheelRect.left + this.wheelRect.width / 2;
    this.pointerY = this.wheelRect.top + (this.view === 'wheel' ? this.wheelRect.height / 2 : 80);
    this.dirtyPointer = true;
    this.update();
  }

  /** Only DOM updates, once per game frame. No preview renderer or skeleton sampling. */
  update(): void {
    if (!this.isOpen || !this.dirtyPointer) return;
    this.dirtyPointer = false;
    const cursor = this.element.querySelector<HTMLElement>('[data-cursor]');
    if (cursor) cursor.style.transform = `translate(${this.pointerX}px,${this.pointerY}px)`;
    if (this.view === 'wheel') {
      const dx = (this.pointerX - this.wheelRect.left - this.wheelRect.width / 2) * 360 / this.wheelRect.width;
      const dy = (this.pointerY - this.wheelRect.top - this.wheelRect.height / 2) * 360 / this.wheelRect.height;
      const distance = Math.hypot(dx, dy);
      const index = distance > 70 && distance < 186 ? Math.round((Math.atan2(dx, -dy) * 180 / Math.PI + 360) / 45) % 8 : -1;
      this.selectSlot(index);
      this.hoverButton(distance < 70 ? this.element.querySelector('[data-action="collection"]') : index >= 0 ? this.element.querySelector(`[data-slot="${index}"]`) : null);
    } else {
      const target = document.elementFromPoint?.(this.pointerX, this.pointerY);
      const button = target?.closest<HTMLButtonElement>('button') ?? null;
      this.hoverButton(button && this.element.contains(button) ? button : null);
    }
  }

  private hoverButton(button: HTMLButtonElement | null): void {
    if (this.hoveredButton === button) return;
    this.hoveredButton?.classList.remove('is-hovered');
    this.hoveredButton = button;
    button?.classList.add('is-hovered');
  }

  private selectSlot(index: number): void {
    if (this.selectedIndex === index) return;
    this.selectedIndex = index;
    this.element.querySelectorAll<HTMLElement>('[data-slot], [data-ring-slot]').forEach(node => node.classList.toggle('is-selected', Number(node.dataset.slot ?? node.dataset.ringSlot) === index));
    const id = this.favorites[index];
    const caption = this.element.querySelector('[data-wheel-caption]');
    if (caption) caption.textContent = id ? EMOTES.find(emote => emote.id === id)!.label : 'Emotes';
  }

  private saveFavorites(): void {
    try { localStorage.setItem(EMOTE_STORAGE_KEY, JSON.stringify(this.favorites)); } catch { /* Device-local preference. */ }
    const point = [this.pointerX, this.pointerY];
    this.render();
    [this.pointerX, this.pointerY] = point;
    this.dirtyPointer = true;
  }

  private toggleFavorite(id: EmoteId): void {
    const existing = this.favorites.indexOf(id), free = this.favorites.indexOf(null);
    this.replacement = null;
    if (existing >= 0) this.favorites[existing] = null;
    else if (free >= 0) this.favorites[free] = id;
    else { this.replacement = id; this.render(); return; }
    this.saveFavorites();
  }

  private play(id: EmoteId): void {
    if (!this.available.has(id)) return;
    if (this.callbacks.onPlay(id)) this.close();
    else {
      const status = this.element.querySelector('[data-favorite-status], [data-wheel-caption]');
      if (status) status.textContent = 'Disponible debout, au sol.';
    }
  }

  private activate(button: HTMLButtonElement): void {
    const { action, emote, favorite, replace } = button.dataset;
    if (action === 'close') this.close();
    else if (action === 'wheel' || action === 'collection') {
      this.view = action === 'wheel' ? 'wheel' : 'collection'; this.selectedIndex = -1; this.replacement = null; this.heldAt = null; this.render();
    } else if (action === 'cancel-replace') { this.replacement = null; this.render(); }
    else if (favorite) this.toggleFavorite(favorite as EmoteId);
    else if (replace !== undefined) {
      const index = Number(replace);
      if (this.replacement) { this.favorites[index] = this.replacement; this.replacement = null; }
      else this.favorites[index] = null;
      this.saveFavorites();
    } else if (emote) this.play(emote as EmoteId);
  }

  private readonly onClick = (event: MouseEvent): void => {
    const target = event.target as Element;
    const button = target.closest<HTMLButtonElement>('button');
    if (button && this.element.contains(button)) this.activate(button);
    else if (target.hasAttribute('data-ring-slot')) {
      const button = this.element.querySelector<HTMLButtonElement>(`[data-slot="${target.getAttribute('data-ring-slot')}"]`);
      if (button) this.activate(button);
    }
  };

  private readonly onHover = (event: Event): void => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!button || !this.element.contains(button)) return;
    this.hoverButton(button);
    if (button.dataset.slot !== undefined) { this.pointerMoved = true; this.selectSlot(Number(button.dataset.slot)); }
  };

  private consume(event: Event): void { event.preventDefault(); event.stopImmediatePropagation(); }
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.isOpen || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'KeyC' || event.key.toLowerCase() === 'c' || event.code === 'Escape') {
      this.consume(event); if (!event.repeat) this.close();
    } else if (/^(?:Digit|Numpad)[1-8]$/.test(event.code) && !this.callbacks.isGameControl(event.code)) {
      this.consume(event); const id = this.favorites[Number(event.code.at(-1)) - 1]; if (id && !event.repeat) this.play(id);
    } else if (event.code === 'Enter') {
      this.consume(event); this.update(); if (!event.repeat) (this.hoveredButton ?? this.element.querySelector<HTMLButtonElement>('[data-action="collection"]'))?.click();
    } else if (event.code.startsWith('Arrow') && !this.callbacks.isGameControl(event.code)) {
      this.consume(event);
      const buttons = [...this.element.querySelectorAll<HTMLButtonElement>(this.view === 'wheel' ? '[data-slot]' : this.replacement ? '[data-replace]' : '[data-emote]')];
      const index = buttons.indexOf(this.hoveredButton!);
      const step = event.code === 'ArrowLeft' ? -1 : event.code === 'ArrowRight' ? 1 : this.view === 'collection' ? (event.code === 'ArrowUp' ? -2 : 2) : event.code === 'ArrowUp' ? -1 : 1;
      const button = buttons[(index + step + buttons.length) % buttons.length];
      if (button) { button.focus({ preventScroll: true }); this.hoverButton(button); if (button.dataset.slot !== undefined) this.selectSlot(Number(button.dataset.slot)); }
    }
    // Movement keys, jump, guard, and Tab keep their ordinary gameplay behavior.
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (!this.isOpen || this.heldAt === null || event.code !== 'KeyC') return;
    const held = performance.now() - this.heldAt; this.heldAt = null;
    if (held < 160 || this.view !== 'wheel') {
      const help = this.element.querySelector('[data-wheel-help]');
      if (help) help.innerHTML = '<kbd>1–8</kbd> ou clic · <kbd>C</kbd> fermer';
      return;
    }
    this.consume(event);
    this.update();
    const id = this.pointerMoved ? this.favorites[this.selectedIndex] : null;
    if (id) this.play(id); else this.close();
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.isOpen || !this.callbacks.isPointerLocked()) return;
    this.pointerMoved ||= event.movementX !== 0 || event.movementY !== 0;
    this.pointerX += event.movementX || 0;
    this.pointerY += event.movementY || 0;
    if (this.view === 'wheel') {
      // A fast flick stays on its sector instead of overshooting the wheel.
      const cx = this.wheelRect.left + this.wheelRect.width / 2, cy = this.wheelRect.top + this.wheelRect.height / 2;
      const dx = this.pointerX - cx, dy = this.pointerY - cy;
      const scale = Math.min(1, this.wheelRect.width * 154 / 360 / Math.hypot(dx, dy));
      this.pointerX = cx + dx * scale; this.pointerY = cy + dy * scale;
    } else {
      this.pointerX = Math.max(0, Math.min(window.innerWidth - 1, this.pointerX));
      this.pointerY = Math.max(0, Math.min(window.innerHeight - 1, this.pointerY));
    }
    this.dirtyPointer = true;
    // Do not consume mousemove: PointerLockControls and PlayerController still aim normally.
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (!this.isOpen || !this.callbacks.isPointerLocked() || (event.button !== 0 && event.button !== 2)) return;
    this.update();
    if (event.button === 2) { this.consume(event); this.swallowRelease = true; this.close(); }
    else if (this.hoveredButton) { this.consume(event); this.swallowRelease = true; this.activate(this.hoveredButton); }
  };
  private readonly onMouseUp = (event: MouseEvent): void => {
    if (!this.swallowRelease) return;
    this.consume(event); this.swallowRelease = false; this.swallowClick = event.button === 0;
  };
  private readonly onWindowClick = (event: MouseEvent): void => {
    if (!this.swallowClick) return;
    this.consume(event); this.swallowClick = false;
  };
  private readonly onScroll = (event: WheelEvent): void => {
    if (!this.isOpen || this.view !== 'collection' || !this.callbacks.isPointerLocked()) return;
    event.preventDefault(); this.element.querySelector<HTMLElement>('.emote-panel')!.scrollTop += event.deltaY; this.dirtyPointer = true;
  };
  private readonly onResize = (): void => { if (this.isOpen) this.resetPointer(); };
  private readonly onBlur = (): void => { this.swallowRelease = false; this.swallowClick = false; this.close(); };

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown, true); window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('mousemove', this.onMouseMove, true); window.removeEventListener('mousedown', this.onMouseDown, true);
    window.removeEventListener('mouseup', this.onMouseUp, true); window.removeEventListener('click', this.onWindowClick, true);
    window.removeEventListener('wheel', this.onScroll, true); window.removeEventListener('resize', this.onResize); window.removeEventListener('blur', this.onBlur);
    this.element.remove();
  }
}
