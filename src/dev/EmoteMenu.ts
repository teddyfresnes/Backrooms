import { EMOTES, EMOTE_STORAGE_KEY, GROUND_EMOTE_STORAGE_KEY, getEmotePosture, loadEmoteFavorites, type EmoteId, type EmotePosture } from './EmoteCatalog';
import { controlCodeFromKeyboardEvent } from '../input/ControlBindings';
import './EmoteMenu.css';
import { PAIR_ACTIONS, type PairAction } from './PairInteractionRules';

const icon = (name: 'star' | 'grid' | 'close' | 'back') => {
  const paths = {
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
    grid: '<g fill="currentColor" stroke="none"><circle cx="8" cy="8" r="2"/><circle cx="16" cy="8" r="2"/><circle cx="8" cy="16" r="2"/><circle cx="16" cy="16" r="2"/></g>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>', back: '<path d="m10 6-6 6 6 6M4 12h16"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
};
const shortLabel: Record<EmoteId, string> = {
  'emote-greeting': 'Saluer', 'emote-clapping': 'Bravo', 'emote-pointing': 'Pointer',
  'emote-salute': 'Salut', 'emote-hip-hop': 'Hip-hop', 'emote-wave': 'Vague',
  'emote-freeze': 'Freeze', 'emote-sweat': 'Ouf', 'emote-laying': 'Au sol', 'emote-kip-up': 'Kip-up',
  'emote-middle-finger': 'Doigt', 'emote-follow-me': 'Suis-moi', 'emote-wait': 'Attends',
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
  onGamePointerDown?(event: MouseEvent): void;
  isPointerLocked(): boolean;
  isGameControl(code: string): boolean;
  isMovementControl(code: string): boolean;
  isMoving(): boolean;
  getPosture(): EmotePosture;
  getUnavailableReason(id: EmoteId): string | null;
  getPairUnavailableReason?(id: PairAction): string | null;
  onPair?(id: PairAction): boolean;
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
  private view: 'wheel' | 'collection' | 'pair' = 'wheel';
  private selectedIndex = -1;
  private replacement: EmoteId | null = null;
  private readonly available = new Set<EmoteId>();
  private readonly unavailable = new Map<EmoteId, string>();
  private nextAvailabilityCheck = 0;
  private previousFocus: HTMLElement | null = null;
  private pointerX = 0;
  private pointerY = 0;
  private lastMousePosition: { x: number; y: number } | null = null;
  private pointerActive = false;
  private pointerInside = false;
  private wheelRect = { left: 0, top: 0, width: 360, height: 360 };
  private dirtyPointer = false;
  private hoveredButton: HTMLButtonElement | null = null;
  private swallowRelease = false;
  private swallowClick = false;

  constructor(root: HTMLElement, private readonly callbacks: EmoteMenuCallbacks) {
    this.element.className = 'emote-overlay';
    this.element.hidden = true;
    this.element.addEventListener('click', this.onClick);
    this.element.addEventListener('contextmenu', event => event.preventDefault());
    this.element.addEventListener('pointerover', this.onHover);
    this.element.addEventListener('pointerout', this.onPointerOut);
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
    this.pointerActive = false;
    this.pointerInside = false;
    this.resetLifetime();
    this.view = 'wheel';
    this.replacement = null;
    this.element.hidden = false;
    // Opening does not focus a modal or release the gameplay pointer.
    this.render(true);
    this.callbacks.onOpen();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.replacement = null;
    this.element.hidden = true;
    this.hoveredButton = null;
    this.pointerInside = false;
    this.pointerActive = false;
    this.callbacks.onClose();
    if (document.activeElement instanceof HTMLElement && this.element.contains(document.activeElement)) this.previousFocus?.focus({ preventScroll: true });
  }

  private get wheelFavorites(): (EmoteId | null)[] {
    return this.posture === 'ground' ? this.groundFavorites : this.favorites.map(id => id && getEmotePosture(id) === 'standing' ? id : null);
  }

  private get entries() { return EMOTES.filter(emote => getEmotePosture(emote.id) === this.posture); }
  private get title(): string { return this.posture === 'ground' ? 'Emotes au sol' : 'Emotes'; }
  private get help(): string { return `<kbd>1–${this.wheelFavorites.length}</kbd> ou clic · reste visible au survol`; }
  private resetLifetime(): void { this.elapsed = 0; this.element.style.opacity = '1'; }
  private setPointerInside(inside: boolean): void {
    if (this.pointerInside === inside) return;
    this.pointerInside = inside;
    this.resetLifetime();
  }

  private image(id: EmoteId | null): string {
    const emote = EMOTES.find(entry => entry.id === id);
    return emote ? `<img src="/assets/emotes/icons/${'icon' in emote ? emote.icon : `${emote.file}.png`}" alt="" draggable="false" width="64" height="64">` : '<span class="emote-empty">+</span>';
  }

  private render(resetPosition = false): void {
    this.hoveredButton = null;
    this.element.classList.toggle('has-game-pointer', this.callbacks.isPointerLocked());
    this.element.innerHTML = `<section class="emote-panel emote-panel--${this.view}" role="region" aria-label="${this.view === 'wheel' ? 'Roue des emotes' : 'Toutes les emotes'}">
      ${this.view === 'wheel' ? this.wheelMarkup() + this.pairLauncherMarkup() : this.view === 'pair' ? this.pairMarkup() : this.collectionMarkup()}
    </section><span class="emote-cursor" aria-hidden="true" data-cursor></span>`;
    if (this.isOpen) { this.refreshAvailability(true); this.resetPointer(resetPosition); }
  }

  private wheelMarkup(): string {
    return `<div class="emote-wheel"><svg class="emote-ring" viewBox="0 0 360 360" aria-hidden="true">${this.wheelFavorites.map((_id, index) => `<path d="${sectorPath(index, this.wheelFavorites.length)}" data-ring-slot="${index}"/>`).join('')}</svg>${this.wheelFavorites.map((id, index) => {
      const angle = index * Math.PI * 2 / this.wheelFavorites.length;
      return `<button type="button" class="emote-slot${id ? '' : ' is-empty'}" style="--slot-x:${Math.sin(angle) * 34}%;--slot-y:${-Math.cos(angle) * 34}%" data-slot="${index}"${id ? ` data-emote="${id}"` : ' data-action="collection"'} aria-label="${index + 1} : ${EMOTES.find(e => e.id === id)?.label ?? 'Ajouter un favori'}"><kbd>${index + 1}</kbd>${this.image(id)}<span>${id ? shortLabel[id] : 'Ajouter'}</span></button>`;
    }).join('')}<div class="emote-wheel-center"><button type="button" class="emote-wheel-back" data-action="close" aria-label="Revenir au jeu" title="Revenir au jeu">${icon('back')}</button><button type="button" class="emote-wheel-all" data-action="collection" aria-label="Toutes les emotes et favoris" title="Toutes les emotes et favoris">${icon('grid')}</button></div></div><div class="emote-caption"><strong data-wheel-caption aria-live="polite">${this.title}</strong><span data-wheel-help>${this.help}</span></div>`;
  }

  private collectionMarkup(): string {
    return `<header class="emote-header"><button type="button" data-action="wheel" class="emote-icon-button" aria-label="Revenir à la roue">${icon('back')}</button><h2>${this.posture === 'ground' ? 'Au sol' : 'Debout'}</h2><button type="button" data-action="close" class="emote-icon-button" aria-label="Fermer">${icon('close')}</button></header><div class="emote-card-grid">${this.entries.map(emote => `<div class="emote-card" data-card="${emote.id}"><button type="button" class="emote-card-select" data-emote="${emote.id}" aria-label="Jouer : ${emote.label}">${this.image(emote.id)}<span>${emote.label}<small data-emote-reason></small></span></button><button type="button" class="emote-favorite" data-favorite="${emote.id}" aria-label="${this.wheelFavorites.includes(emote.id) ? 'Retirer' : 'Ajouter'} ${emote.label} ${this.wheelFavorites.includes(emote.id) ? 'des' : 'aux'} favoris" aria-pressed="${this.wheelFavorites.includes(emote.id)}">${icon('star')}</button></div>`).join('')}</div><div class="emote-favorites"><div class="emote-favorites-heading"><strong>Favoris <span>${this.wheelFavorites.filter(Boolean).length}/${this.wheelFavorites.length}</span></strong>${this.replacement ? '<button type="button" data-action="cancel-replace">Annuler</button>' : ''}</div><p role="status" data-favorite-status>${this.replacement ? `Remplacer quel favori par « ${EMOTES.find(e => e.id === this.replacement)!.label} » ?` : '☆ pour personnaliser votre roue'}</p><div class="emote-favorite-strip${this.replacement ? ' is-replacing' : ''}">${this.wheelFavorites.map((id, index) => `<button type="button" class="emote-mini-slot" data-replace="${index}" aria-label="${this.replacement ? 'Remplacer' : 'Retirer'} le favori ${index + 1} : ${EMOTES.find(e => e.id === id)?.label ?? 'Libre'}"><kbd>${index + 1}</kbd><span>${id ? shortLabel[id] : '+'}</span></button>`).join('')}</div></div><footer class="emote-footer">Clic : jouer · <kbd>Tab</kbd> fermer</footer>`;
  }

  private resetPointer(resetPosition = false): void {
    const wheel = this.element.querySelector<HTMLElement>('.emote-wheel');
    const box = (wheel ?? this.element.querySelector<HTMLElement>('.emote-panel')!).getBoundingClientRect();
    const width = this.view === 'wheel' ? Math.min(window.innerWidth <= 600 ? 320 : 360, window.innerWidth - 24,
      window.innerHeight <= 440 ? Math.min(280, window.innerHeight * .75) : Infinity) : Math.min(384, window.innerWidth - 24);
    const height = this.view === 'wheel' ? width : Math.min(640, window.innerHeight * .82);
    this.wheelRect = box.width > 0 ? box : { left: (window.innerWidth - width) / 2, top: (window.innerHeight - height) / 2, width, height };
    if (resetPosition) {
      const mouse = !this.callbacks.isPointerLocked() ? this.lastMousePosition : null;
      this.pointerX = mouse?.x ?? this.wheelRect.left + this.wheelRect.width / 2;
      this.pointerY = mouse?.y ?? this.wheelRect.top + this.wheelRect.height / 2;
      // A parked virtual cursor must not cancel the initial two-second fade.
      this.pointerActive = !!mouse;
    }
    this.dirtyPointer = true;
    this.update();
  }

  private pairLauncherMarkup(): string {
    return this.callbacks.onPair ? '<button type="button" class="emote-pair-link" data-action="pair">À deux <span>Proposer une interaction</span></button>' : '';
  }

  private pairMarkup(): string {
    return `<header class="emote-header"><button type="button" data-action="wheel" class="emote-icon-button" aria-label="Revenir aux emotes">${icon('back')}</button><h2>À deux</h2><button type="button" data-action="close" class="emote-icon-button" aria-label="Fermer">${icon('close')}</button></header><p class="emote-pair-intro">Regarde une personne proche, puis propose-lui un geste. Elle accepte avec <kbd>Tab</kbd>.</p><div class="emote-pair-list">${PAIR_ACTIONS.map(action => `<button type="button" data-pair="${action.id}"><strong>${action.label}</strong><span>${action.detail}</span><small data-pair-reason></small></button>`).join('')}</div><footer class="emote-footer">Invitation valable 4 s · éloignement : annuler</footer>`;
  }

  /** Only DOM updates, once per game frame. No preview renderer or skeleton sampling. */
  update(delta = 0): void {
    if (!this.isOpen) return;
    if (this.callbacks.isMoving()) { this.close(); return; }
    const posture = this.callbacks.getPosture();
    if (posture !== this.posture) {
      this.posture = posture; this.selectedIndex = -1; this.replacement = null; this.render();
    }
    this.refreshAvailability();
    if (this.dirtyPointer) this.updatePointer();
    if (this.pointerInside) this.resetLifetime();
    else {
      this.elapsed += Math.max(0, delta);
      if (this.elapsed >= 2) { this.close(); return; }
      this.element.style.opacity = String(1 - this.elapsed / 2);
    }
  }

  private updatePointer(): void {
    this.dirtyPointer = false;
    this.element.classList.toggle('has-active-pointer', this.pointerActive);
    const cursor = this.element.querySelector<HTMLElement>('[data-cursor]');
    if (cursor) cursor.style.transform = `translate(${this.pointerX}px,${this.pointerY}px)`;
    if (this.view === 'wheel') {
      const dx = (this.pointerX - this.wheelRect.left - this.wheelRect.width / 2) * 360 / this.wheelRect.width;
      const dy = (this.pointerY - this.wheelRect.top - this.wheelRect.height / 2) * 360 / this.wheelRect.height;
      const distance = Math.hypot(dx, dy);
      const pairBox = this.element.querySelector<HTMLElement>('[data-action="pair"]')?.getBoundingClientRect();
      const pairHit = !!this.callbacks.onPair && (pairBox && pairBox.width > 0
        ? this.pointerX >= pairBox.left && this.pointerX <= pairBox.right && this.pointerY >= pairBox.top && this.pointerY <= pairBox.bottom
        : Math.abs(this.pointerX - this.wheelRect.left - this.wheelRect.width / 2) <= 120
          && this.pointerY >= this.wheelRect.top - 55 && this.pointerY <= this.wheelRect.top - 12);
      this.setPointerInside(this.pointerActive && (distance < 186 || pairHit));
      const index = this.pointerActive && distance > 70 && distance < 186 ? Math.round((Math.atan2(dx, -dy) * 180 / Math.PI + 360) / (360 / this.wheelFavorites.length)) % this.wheelFavorites.length : -1;
      this.selectSlot(index);
      // Match the two separate central targets, including under pointer lock.
      const centralAction = this.pointerActive && distance < 62
        ? Math.abs(dx) <= 18 && Math.abs(dy - 37.2) <= 18 ? 'collection'
          : Math.abs(dx) <= 40 && Math.abs(dy + 12.4) <= 36 ? 'close' : null
        : null;
      this.hoverButton(pairHit ? this.element.querySelector('[data-action="pair"]') : centralAction ? this.element.querySelector(`.emote-wheel-center [data-action="${centralAction}"]`)
        : index >= 0 ? this.element.querySelector(`[data-slot="${index}"]`) : null);
    } else {
      this.setPointerInside(this.pointerActive && this.pointerX >= this.wheelRect.left && this.pointerX <= this.wheelRect.left + this.wheelRect.width
        && this.pointerY >= this.wheelRect.top && this.pointerY <= this.wheelRect.top + this.wheelRect.height);
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
    this.element.querySelectorAll<HTMLButtonElement>('[data-pair]').forEach(button => {
      const reason = this.callbacks.getPairUnavailableReason?.(button.dataset.pair as PairAction) ?? null;
      button.disabled = !!reason; button.title = reason ?? '';
      button.querySelector('[data-pair-reason]')!.textContent = reason ?? 'Proposer';
    });
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
    this.render();
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
    const { action, emote, favorite, replace, pair } = button.dataset;
    if (action === 'close') this.close();
    else if (action === 'wheel' || action === 'collection' || action === 'pair') {
      this.view = action; this.selectedIndex = -1; this.replacement = null; this.render();
    } else if (action === 'cancel-replace') { this.replacement = null; this.render(); }
    else if (favorite) this.toggleFavorite(favorite as EmoteId);
    else if (replace !== undefined) {
      const index = Number(replace);
      const favorites = this.posture === 'ground' ? this.groundFavorites : this.favorites;
      if (this.replacement) { favorites[index] = this.replacement; this.replacement = null; }
      else favorites[index] = null;
      this.saveFavorites();
    } else if (pair && this.callbacks.onPair?.(pair as PairAction)) this.close();
    else if (emote) this.play(emote as EmoteId);
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
    if (!this.isOpen) return;
    if (event.type === 'pointerover' && !this.callbacks.isPointerLocked()) {
      this.pointerActive = true;
      this.setPointerInside(true);
    } else if (event.type === 'focusin') this.resetLifetime();
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!button || !this.element.contains(button)) return;
    this.hoverButton(button);
    if (button.dataset.slot !== undefined) { this.selectSlot(Number(button.dataset.slot)); }
  };

  private readonly onPointerOut = (event: PointerEvent): void => {
    if (!this.isOpen || this.callbacks.isPointerLocked()) return;
    const next = event.relatedTarget as Node | null;
    if (next && this.element.querySelector('.emote-panel')?.contains(next)) return;
    this.setPointerInside(false);
    this.hoverButton(null);
    this.selectSlot(-1);
  };

  private consume(event: Event): void { event.preventDefault(); event.stopImmediatePropagation(); }
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.isOpen) return;
    const code = controlCodeFromKeyboardEvent(event);
    if (this.callbacks.isMovementControl(code) || this.callbacks.isGameControl(code)) { this.close(); return; }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Tab' || event.code === 'Escape') {
      this.consume(event); if (!event.repeat) this.close();
    } else if (/^(?:Digit|Numpad)[1-8]$/.test(event.code) && !this.callbacks.isGameControl(event.code)) {
      this.consume(event);
      if (this.view === 'pair') {
        const button = this.element.querySelector<HTMLButtonElement>(`[data-pair="${PAIR_ACTIONS[Number(event.code.at(-1)) - 1]?.id}"]`);
        if (button && !event.repeat) this.activate(button);
      } else { const id = this.wheelFavorites[Number(event.code.at(-1)) - 1]; if (id && !event.repeat) this.play(id); }
    } else if (event.code === 'Enter') {
      this.consume(event); this.update(); if (!event.repeat) (this.hoveredButton ?? this.element.querySelector<HTMLButtonElement>('[data-action="collection"]'))?.click();
    } else if (event.code.startsWith('Arrow') && !this.callbacks.isGameControl(event.code)) {
      this.consume(event);
      this.resetLifetime();
      const buttons = [...this.element.querySelectorAll<HTMLButtonElement>(this.view === 'wheel' ? '[data-slot], [data-action="pair"]' : this.view === 'pair' ? '[data-pair]' : this.replacement ? '[data-replace]' : '[data-emote]')].filter(button => !button.disabled);
      const index = buttons.indexOf(this.hoveredButton!);
      const step = event.code === 'ArrowLeft' ? -1 : event.code === 'ArrowRight' ? 1 : this.view === 'collection' ? (event.code === 'ArrowUp' ? -2 : 2) : event.code === 'ArrowUp' ? -1 : 1;
      const button = buttons[(index + step + buttons.length) % buttons.length];
      if (button) { button.focus({ preventScroll: true }); this.hoverButton(button); if (button.dataset.slot !== undefined) this.selectSlot(Number(button.dataset.slot)); }
    }
    // Movement keys, jump, and guard keep their ordinary gameplay behavior.
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    const locked = this.callbacks.isPointerLocked();
    if (!locked) this.lastMousePosition = { x: event.clientX, y: event.clientY };
    if (!this.isOpen) return;
    this.pointerActive = true;
    if (locked) {
      this.pointerX = Math.max(0, Math.min(window.innerWidth - 1, this.pointerX + (event.movementX || 0)));
      this.pointerY = Math.max(0, Math.min(window.innerHeight - 1, this.pointerY + (event.movementY || 0)));
    } else {
      this.pointerX = event.clientX;
      this.pointerY = event.clientY;
    }
    this.dirtyPointer = true;
    // Do not consume mousemove: PointerLockControls and PlayerController still aim normally.
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (!this.isOpen) return;
    if (event.button !== 0) {
      const fromPicker = this.element.contains(event.target as Node);
      this.close();
      // RMB is always a gameplay press, even when the normal cursor is over UI.
      if (fromPicker) this.callbacks.onGamePointerDown?.(event);
      return;
    }
    if (!this.callbacks.isPointerLocked()) {
      if (!this.element.querySelector('.emote-panel')?.contains(event.target as Node)) this.close();
      return;
    }
    this.pointerActive = true;
    this.dirtyPointer = true;
    this.update();
    if (!this.pointerInside) { this.close(); return; }
    this.consume(event); this.swallowRelease = true;
    if (this.hoveredButton) this.activate(this.hoveredButton);
  };
  private readonly onMouseUp = (event: MouseEvent): void => {
    if (!this.swallowRelease || event.button !== 0) return;
    this.consume(event); this.swallowRelease = false; this.swallowClick = event.button === 0;
  };
  private readonly onWindowClick = (event: MouseEvent): void => {
    if (this.swallowClick && event.button === 0) { this.consume(event); this.swallowClick = false; return; }
    if (!this.isOpen || this.element.contains(event.target as Node)) return;
    if (this.callbacks.isPointerLocked()) {
      this.dirtyPointer = true; this.update();
      if (!this.pointerInside) this.close();
    } else this.close();
  };
  private readonly onScroll = (event: WheelEvent): void => {
    if (!this.isOpen || this.view !== 'collection' || !this.callbacks.isPointerLocked()) return;
    if (!this.pointerInside) return;
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
