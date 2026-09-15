import { EMOTES, EMOTE_STORAGE_KEY, GROUND_EMOTE_STORAGE_KEY, getEmotePosture, loadEmoteFavorites, type EmoteId, type EmotePosture } from './EmoteCatalog';
import { controlCodeFromKeyboardEvent } from '../input/ControlBindings';
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
const sectorPath = (index: number, slots: number): string => {
  const angle = 360 / slots;
  const a = (index * angle - angle / 2 + 2) * Math.PI / 180, b = (index * angle + angle / 2 - 2) * Math.PI / 180;
  const [ax, ay] = polar(174, a), [bx, by] = polar(174, b), [cx, cy] = polar(70, b), [dx, dy] = polar(70, a);
  return `M${ax},${ay} A174,174 0 0 1 ${bx},${by} L${cx},${cy} A70,70 0 0 0 ${dx},${dy}Z`;
};

interface EmoteMenuCallbacks {
  onOpen(): void;
  onClose(): void;
  onPlay(id: EmoteId): boolean;
  isPointerLocked(): boolean;
  isGameControl(code: string): boolean;
  isMovementControl(code: string): boolean;
  isMoving(): boolean;
  getPosture(): EmotePosture;
  getUnavailableReason(id: EmoteId): string | null;
}

/** A HUD picker: never takes ownership of movement, aim, or the game clock. */
export class EmoteMenu {
  readonly element = document.createElement('div');
  favorites = loadEmoteFavorites();
  private groundFavorites = loadEmoteFavorites('ground');
  private posture: EmotePosture = 'standing';
  private elapsed = 0;
  isOpen = false;
  private ready = false;
  private view: 'wheel' | 'collection' = 'wheel';
  private selectedIndex = -1;
  private replacement: EmoteId | null = null;
  private readonly available = new Set<EmoteId>();
  private readonly unavailable = new Map<EmoteId, string>();
  private nextAvailabilityCheck = 0;
  private previousFocus: HTMLElement | null = null;
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

  open(): void {
    if (this.isOpen || !this.ready || this.callbacks.isMoving()) return;
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.isOpen = true;
    this.selectedIndex = -1;
    this.posture = this.callbacks.getPosture();
    this.resetLifetime();
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
    this.replacement = null;
    this.element.hidden = true;
    this.hoveredButton = null;
    this.callbacks.onClose();
    if (document.activeElement instanceof HTMLElement && this.element.contains(document.activeElement)) this.previousFocus?.focus({ preventScroll: true });
  }

  private get wheelFavorites(): (EmoteId | null)[] {
    return this.posture === 'ground' ? this.groundFavorites : this.favorites.map(id => id && getEmotePosture(id) === 'standing' ? id : null);
  }

  private get entries() { return EMOTES.filter(emote => getEmotePosture(emote.id) === this.posture); }
  private get title(): string { return this.posture === 'ground' ? 'Emotes au sol' : 'Emotes'; }
  private get help(): string { return `<kbd>1–${this.wheelFavorites.length}</kbd> ou clic · disparaît en 2 s`; }
  private resetLifetime(): void { this.elapsed = 0; this.element.style.opacity = '1'; }

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
    if (this.isOpen) { this.refreshAvailability(true); this.resetPointer(); }
  }

  private wheelMarkup(): string {
    return `<div class="emote-wheel"><svg class="emote-ring" viewBox="0 0 360 360" aria-hidden="true">${this.wheelFavorites.map((_id, index) => `<path d="${sectorPath(index, this.wheelFavorites.length)}" data-ring-slot="${index}"/>`).join('')}</svg>${this.wheelFavorites.map((id, index) => {
      const angle = index * Math.PI * 2 / this.wheelFavorites.length;
      return `<button type="button" class="emote-slot${id ? '' : ' is-empty'}" style="--slot-x:${Math.sin(angle) * 34}%;--slot-y:${-Math.cos(angle) * 34}%" data-slot="${index}"${id ? ` data-emote="${id}"` : ' data-action="collection"'} aria-label="${index + 1} : ${EMOTES.find(e => e.id === id)?.label ?? 'Ajouter un favori'}"><kbd>${index + 1}</kbd>${this.image(id)}<span>${id ? shortLabel[id] : 'Ajouter'}</span></button>`;
    }).join('')}<button type="button" class="emote-wheel-center" data-action="collection">${icon('grid')}<span>Tout voir</span></button></div><div class="emote-caption"><strong data-wheel-caption aria-live="polite">${this.title}</strong><span data-wheel-help>${this.help}</span></div>`;
  }

  private collectionMarkup(): string {
    return `<header class="emote-header"><button type="button" data-action="wheel" class="emote-icon-button" aria-label="Revenir à la roue">${icon('back')}</button><h2>${this.posture === 'ground' ? 'Au sol' : 'Debout'}</h2><button type="button" data-action="close" class="emote-icon-button" aria-label="Fermer">${icon('close')}</button></header><div class="emote-card-grid">${this.entries.map(emote => `<div class="emote-card" data-card="${emote.id}"><button type="button" class="emote-card-select" data-emote="${emote.id}" aria-label="Jouer : ${emote.label}">${this.image(emote.id)}<span>${emote.label}<small data-emote-reason></small></span></button><button type="button" class="emote-favorite" data-favorite="${emote.id}" aria-label="${this.wheelFavorites.includes(emote.id) ? 'Retirer' : 'Ajouter'} ${emote.label} ${this.wheelFavorites.includes(emote.id) ? 'des' : 'aux'} favoris" aria-pressed="${this.wheelFavorites.includes(emote.id)}">${icon('star')}</button></div>`).join('')}</div><div class="emote-favorites"><div class="emote-favorites-heading"><strong>Favoris <span>${this.wheelFavorites.filter(Boolean).length}/${this.wheelFavorites.length}</span></strong>${this.replacement ? '<button type="button" data-action="cancel-replace">Annuler</button>' : ''}</div><p role="status" data-favorite-status>${this.replacement ? `Remplacer quel favori par « ${EMOTES.find(e => e.id === this.replacement)!.label} » ?` : '☆ pour personnaliser votre roue'}</p><div class="emote-favorite-strip${this.replacement ? ' is-replacing' : ''}">${this.wheelFavorites.map((id, index) => `<button type="button" class="emote-mini-slot" data-replace="${index}" aria-label="${this.replacement ? 'Remplacer' : 'Retirer'} le favori ${index + 1} : ${EMOTES.find(e => e.id === id)?.label ?? 'Libre'}"><kbd>${index + 1}</kbd><span>${id ? shortLabel[id] : '+'}</span></button>`).join('')}</div></div><footer class="emote-footer">Clic : jouer · <kbd>Tab</kbd> fermer</footer>`;
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
  update(delta = 0): void {
    if (!this.isOpen) return;
    this.elapsed += Math.max(0, delta);
    if (this.elapsed >= 2 || this.callbacks.isMoving()) { this.close(); return; }
    this.element.style.opacity = String(1 - this.elapsed / 2);
    const posture = this.callbacks.getPosture();
    if (posture !== this.posture) {
      this.posture = posture; this.selectedIndex = -1; this.replacement = null; this.render();
    }
    this.refreshAvailability();
    if (!this.dirtyPointer) return;
    this.dirtyPointer = false;
    const cursor = this.element.querySelector<HTMLElement>('[data-cursor]');
    if (cursor) cursor.style.transform = `translate(${this.pointerX}px,${this.pointerY}px)`;
    if (this.view === 'wheel') {
      const dx = (this.pointerX - this.wheelRect.left - this.wheelRect.width / 2) * 360 / this.wheelRect.width;
      const dy = (this.pointerY - this.wheelRect.top - this.wheelRect.height / 2) * 360 / this.wheelRect.height;
      const distance = Math.hypot(dx, dy);
      const index = distance > 70 && distance < 186 ? Math.round((Math.atan2(dx, -dy) * 180 / Math.PI + 360) / (360 / this.wheelFavorites.length)) % this.wheelFavorites.length : -1;
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
    const id = this.wheelFavorites[index];
    const caption = this.element.querySelector('[data-wheel-caption]');
    if (caption) caption.textContent = id ? EMOTES.find(emote => emote.id === id)!.label : this.title;
    this.updateWheelHelp();
  }

  private updateWheelHelp(): void {
    const help = this.element.querySelector<HTMLElement>('[data-wheel-help]');
    if (!help) return;
    const id = this.wheelFavorites[this.selectedIndex];
    const reason = id ? this.unavailable.get(id) : null;
    help.classList.toggle('is-warning', !!reason);
    help.innerHTML = reason ?? this.help;
  }

  private refreshAvailability(force = false): void {
    if (!this.isOpen || (!force && performance.now() < this.nextAvailabilityCheck)) return;
    this.nextAvailabilityCheck = performance.now() + 200;
    for (const emote of this.entries) {
      const reason = this.available.has(emote.id) ? this.callbacks.getUnavailableReason(emote.id) : 'Animation indisponible';
      if (reason) this.unavailable.set(emote.id, reason); else this.unavailable.delete(emote.id);
    }
    this.element.querySelectorAll<HTMLButtonElement>('[data-emote]').forEach(button => {
      const reason = this.unavailable.get(button.dataset.emote as EmoteId);
      button.disabled = !!reason;
      button.setAttribute('aria-disabled', String(!!reason));
      button.title = reason ?? '';
      button.classList.toggle('is-unavailable', !!reason);
      button.closest('[data-card]')?.classList.toggle('is-unavailable', !!reason);
      const note = button.querySelector('[data-emote-reason]');
      if (note) note.textContent = reason ?? '';
    });
    this.element.querySelectorAll<SVGElement>('[data-ring-slot]').forEach(sector => {
      const id = this.wheelFavorites[Number(sector.dataset.ringSlot)];
      sector.classList.toggle('is-unavailable', !!id && this.unavailable.has(id));
    });
    this.updateWheelHelp();
  }

  private saveFavorites(): void {
    try { localStorage.setItem(this.posture === 'ground' ? GROUND_EMOTE_STORAGE_KEY : EMOTE_STORAGE_KEY, JSON.stringify(this.wheelFavorites)); } catch { /* Device-local preference. */ }
    const point = [this.pointerX, this.pointerY];
    this.render();
    [this.pointerX, this.pointerY] = point;
    this.dirtyPointer = true;
  }

  private toggleFavorite(id: EmoteId): void {
    const existing = this.wheelFavorites.indexOf(id), free = this.wheelFavorites.indexOf(null);
    this.replacement = null;
    const favorites = this.posture === 'ground' ? this.groundFavorites : this.favorites;
    if (existing >= 0) favorites[existing] = null;
    else if (free >= 0) favorites[free] = id;
    else { this.replacement = id; this.render(); return; }
    this.saveFavorites();
  }

  private play(id: EmoteId): void {
    if (!this.available.has(id) || getEmotePosture(id) !== this.posture) return;
    this.refreshAvailability(true);
    const reason = this.unavailable.get(id);
    if (reason) {
      const status = this.element.querySelector('[data-favorite-status], [data-wheel-caption]');
      if (status) status.textContent = `${EMOTES.find(emote => emote.id === id)!.label} · ${reason}`;
      return;
    }
    if (this.callbacks.onPlay(id)) this.close();
    else {
      const status = this.element.querySelector('[data-favorite-status], [data-wheel-caption]');
      if (status) status.textContent = 'Animation momentanément indisponible.';
    }
  }

  private activate(button: HTMLButtonElement): void {
    if (button.disabled) return;
    this.resetLifetime();
    const { action, emote, favorite, replace } = button.dataset;
    if (action === 'close') this.close();
    else if (action === 'wheel' || action === 'collection') {
      this.view = action === 'wheel' ? 'wheel' : 'collection'; this.selectedIndex = -1; this.replacement = null; this.render();
    } else if (action === 'cancel-replace') { this.replacement = null; this.render(); }
    else if (favorite) this.toggleFavorite(favorite as EmoteId);
    else if (replace !== undefined) {
      const index = Number(replace);
      const favorites = this.posture === 'ground' ? this.groundFavorites : this.favorites;
      if (this.replacement) { favorites[index] = this.replacement; this.replacement = null; }
      else favorites[index] = null;
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
    if (button.dataset.slot !== undefined) { this.selectSlot(Number(button.dataset.slot)); }
  };

  private consume(event: Event): void { event.preventDefault(); event.stopImmediatePropagation(); }
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.isOpen) return;
    if (this.callbacks.isMovementControl(controlCodeFromKeyboardEvent(event))) { this.close(); return; }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Tab' || event.code === 'Escape') {
      this.consume(event); if (!event.repeat) this.close();
    } else if (/^(?:Digit|Numpad)[1-8]$/.test(event.code) && !this.callbacks.isGameControl(event.code)) {
      this.consume(event); const id = this.wheelFavorites[Number(event.code.at(-1)) - 1]; if (id && !event.repeat) this.play(id);
    } else if (event.code === 'Enter') {
      this.consume(event); this.update(); if (!event.repeat) (this.hoveredButton ?? this.element.querySelector<HTMLButtonElement>('[data-action="collection"]'))?.click();
    } else if (event.code.startsWith('Arrow') && !this.callbacks.isGameControl(event.code)) {
      this.consume(event);
      const buttons = [...this.element.querySelectorAll<HTMLButtonElement>(this.view === 'wheel' ? '[data-slot]' : this.replacement ? '[data-replace]' : '[data-emote]')].filter(button => !button.disabled);
      const index = buttons.indexOf(this.hoveredButton!);
      const step = event.code === 'ArrowLeft' ? -1 : event.code === 'ArrowRight' ? 1 : this.view === 'collection' ? (event.code === 'ArrowUp' ? -2 : 2) : event.code === 'ArrowUp' ? -1 : 1;
      const button = buttons[(index + step + buttons.length) % buttons.length];
      if (button) { button.focus({ preventScroll: true }); this.hoverButton(button); if (button.dataset.slot !== undefined) this.selectSlot(Number(button.dataset.slot)); }
    }
    // Movement keys, jump, and guard keep their ordinary gameplay behavior.
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.isOpen || !this.callbacks.isPointerLocked()) return;
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
    this.resetLifetime();
    event.preventDefault(); this.element.querySelector<HTMLElement>('.emote-panel')!.scrollTop += event.deltaY; this.dirtyPointer = true;
  };
  private readonly onResize = (): void => { if (this.isOpen) this.resetPointer(); };
  private readonly onBlur = (): void => { this.swallowRelease = false; this.swallowClick = false; this.close(); };

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('mousemove', this.onMouseMove, true); window.removeEventListener('mousedown', this.onMouseDown, true);
    window.removeEventListener('mouseup', this.onMouseUp, true); window.removeEventListener('click', this.onWindowClick, true);
    window.removeEventListener('wheel', this.onScroll, true); window.removeEventListener('resize', this.onResize); window.removeEventListener('blur', this.onBlur);
    this.element.remove();
  }
}
