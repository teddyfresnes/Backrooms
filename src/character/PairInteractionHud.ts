import { RPS_LABELS, type RpsChoice } from './PairInteractionRules';
import './PairInteractionHud.css';

export interface PairHudState {
  mode: 'invitation' | 'waiting' | 'choosing' | 'playing' | 'result' | 'message';
  title: string; detail: string; remaining?: number; choiceLocked?: boolean;
}
export class PairInteractionHud {
  readonly element = document.createElement('aside');
  private state: PairHudState | null = null;
  private signature = '';
  private readonly cursor = document.createElement('span');
  private pointerX = 0;
  private pointerY = 0;
  constructor(root: HTMLElement, private readonly callbacks: {
    accept(): boolean; cancel(): void; choose(choice: RpsChoice): void;
    hasSession(): boolean; isMovement(code: string): boolean; isPointerLocked(): boolean;
  }) {
    this.element.className = 'pair-hud'; this.element.hidden = true;
    this.element.setAttribute('role', 'status');
    this.element.addEventListener('click', event => {
      const button = (event.target as Element).closest<HTMLButtonElement>('button');
      if (button?.dataset.pairAccept !== undefined) callbacks.accept();
      else if (button?.dataset.pairCancel !== undefined) callbacks.cancel();
      else if (button?.dataset.pairChoice) callbacks.choose(button.dataset.pairChoice as RpsChoice);
    });
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('mousemove', this.onMouseMove, true);
    window.addEventListener('mousedown', this.onMouseDown, true);
    window.addEventListener('blur', this.onBlur);
    root.append(this.element);
    this.cursor.className = 'pair-hud-cursor'; this.cursor.hidden = true; root.append(this.cursor);
  }
  show(state: PairHudState | null): void {
    this.state = state; this.element.hidden = !state;
    this.cursor.hidden = state?.mode !== 'choosing' || !this.callbacks.isPointerLocked();
    if (!state) { this.signature = ''; return; }
    const signature = JSON.stringify({ ...state, remaining: undefined });
    if (signature !== this.signature) {
      this.signature = signature;
      this.element.innerHTML = '<div class="pair-hud__eyebrow">À DEUX</div><strong data-pair-title></strong><p data-pair-detail></p>'
        + (state.mode === 'invitation' ? '<div class="pair-hud__buttons"><button type="button" data-pair-accept><kbd>Tab</kbd> Accepter</button><button type="button" data-pair-cancel><kbd>Échap</kbd> Refuser</button></div>'
        : state.mode === 'choosing' ? `<div class="pair-hud__choices">${Object.entries(RPS_LABELS).map(([id, label], index) => `<button type="button" data-pair-choice="${id}" ${state.choiceLocked ? 'disabled' : ''}><kbd>${index + 1}</kbd>${label}</button>`).join('')}</div>` : '')
        + '<div class="pair-hud__timer" aria-hidden="true"><span data-pair-timer></span></div>';
      this.element.querySelector('[data-pair-title]')!.textContent = state.title;
      this.element.querySelector('[data-pair-detail]')!.textContent = state.detail;
      if (state.mode === 'choosing') {
        const box = this.element.querySelector('[data-pair-choice="paper"]')!.getBoundingClientRect();
        this.pointerX = box.width ? box.left + box.width / 2 : window.innerWidth / 2;
        this.pointerY = box.height ? box.top + box.height / 2 : window.innerHeight - 85;
        this.updatePointer();
      }
    }
    const timer = this.element.querySelector<HTMLElement>('[data-pair-timer]')!;
    timer.style.transform = `scaleX(${Math.max(0, Math.min(1, (state.remaining ?? 4) / 4))})`;
    timer.parentElement!.hidden = state.remaining === undefined;
  }
  private updatePointer(): void {
    this.cursor.style.transform = `translate(${this.pointerX}px, ${this.pointerY}px)`;
    const target = document.elementFromPoint?.(this.pointerX, this.pointerY)?.closest<HTMLButtonElement>('[data-pair-choice]');
    this.element.querySelectorAll('[data-pair-choice]').forEach(button => button.classList.toggle('is-hovered', button === target));
  }
  private readonly onMouseMove = (event: MouseEvent): void => {
    if (this.state?.mode !== 'choosing' || !this.callbacks.isPointerLocked()) return;
    this.pointerX = Math.max(0, Math.min(window.innerWidth - 1, this.pointerX + (event.movementX || 0)));
    this.pointerY = Math.max(0, Math.min(window.innerHeight - 1, this.pointerY + (event.movementY || 0)));
    this.updatePointer();
  };
  private readonly onMouseDown = (event: MouseEvent): void => {
    if (this.state?.mode !== 'choosing' || !this.callbacks.isPointerLocked() || event.button !== 0) return;
    const button = document.elementFromPoint?.(this.pointerX, this.pointerY)?.closest<HTMLButtonElement>('[data-pair-choice]');
    if (!button || !this.element.contains(button)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    this.callbacks.choose(button.dataset.pairChoice as RpsChoice);
  };
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || (event.target instanceof HTMLElement
      && event.target.closest('input,textarea,select,[contenteditable="true"]'))) return;
    if (event.code === 'Tab' && (this.state?.mode === 'invitation' || this.callbacks.hasSession())) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat && this.state?.mode === 'invitation') this.callbacks.accept();
    } else if (event.code === 'Escape' && (this.callbacks.hasSession() || this.state?.mode === 'invitation' || this.state?.mode === 'waiting')) {
      event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) this.callbacks.cancel();
    } else if (this.state?.mode === 'choosing' && /^(?:Digit|Numpad)[1-3]$/.test(event.code)) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) this.callbacks.choose((['rock', 'paper', 'scissors'] as const)[Number(event.code.at(-1)) - 1]!);
    } else if (this.callbacks.hasSession() && this.callbacks.isMovement(event.code)) this.callbacks.cancel();
  };
  private readonly onBlur = (): void => { this.callbacks.cancel(); };
  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown, true); window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('mousemove', this.onMouseMove, true); window.removeEventListener('mousedown', this.onMouseDown, true);
    this.element.remove(); this.cursor.remove();
  }
}
