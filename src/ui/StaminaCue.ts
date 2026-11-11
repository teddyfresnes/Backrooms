import './rift-hud.css';

/**
 * The only visible trace of the player's breath: a thin, faint line under
 * the crosshair that appears in the critical zone and pulses while the
 * sprint is cut. Everything else (panting, heart, vignette, bob) is felt.
 */
export class StaminaCue {
  private readonly root = document.createElement('div');
  private readonly fill = document.createElement('i');
  private visible = false;
  private exhausted = false;
  private lastLevel = -1;

  constructor(container: HTMLElement) {
    this.root.className = 'stamina-cue';
    this.root.setAttribute('aria-hidden', 'true');
    this.root.append(this.fill);
    container.append(this.root);
  }

  update(show: boolean, level: number, exhausted: boolean): void {
    if (show !== this.visible) { this.visible = show; this.root.classList.toggle('is-visible', show); }
    if (exhausted !== this.exhausted) { this.exhausted = exhausted; this.root.classList.toggle('is-exhausted', exhausted); }
    if (!show) return;
    const rounded = Math.round(Math.max(0, Math.min(1, level)) * 100) / 100;
    if (rounded === this.lastLevel) return;
    this.lastLevel = rounded;
    this.root.style.setProperty('--breath', rounded.toFixed(2));
  }

  dispose(): void { this.root.remove(); }
}
