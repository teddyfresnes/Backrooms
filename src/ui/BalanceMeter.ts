import './rift-hud.css';

/** Gauge of the walk on the plank: where the body leans, which keys push it back. */
export class BalanceMeter {
  private readonly root = document.createElement('div');
  private readonly left = document.createElement('kbd');
  private readonly right = document.createElement('kbd');
  private readonly track = document.createElement('div');
  private readonly marker = document.createElement('i');

  constructor(container: HTMLElement) {
    this.root.className = 'rift-balance';
    this.root.setAttribute('aria-hidden', 'true');
    const vignette = document.createElement('div');
    vignette.className = 'rift-balance-vignette';
    const gauge = document.createElement('div');
    gauge.className = 'rift-balance-gauge';
    this.track.className = 'rift-balance-track';
    this.marker.className = 'rift-balance-marker';
    this.track.append(this.marker);
    gauge.append(this.left, this.track, this.right);
    const caption = document.createElement('div');
    caption.className = 'rift-balance-caption';
    caption.textContent = 'Équilibre';
    this.root.append(vignette, gauge, caption);
    container.append(this.root);
  }

  /** `lean` -1 (falling left) .. 1 (falling right); `input` the key held (-1/0/1). */
  update(visible: boolean, lean: number, input: number, leftKey: string, rightKey: string): void {
    this.root.classList.toggle('is-visible', visible);
    if (!visible) return;
    const clamped = Math.max(-1, Math.min(1, lean));
    this.root.style.setProperty('--lean', clamped.toFixed(3));
    this.root.style.setProperty('--danger', Math.max(0, (Math.abs(clamped) - 0.35) / 0.65).toFixed(3));
    this.root.classList.toggle('is-critical', Math.abs(clamped) > 0.75);
    if (this.left.textContent !== leftKey) this.left.textContent = leftKey;
    if (this.right.textContent !== rightKey) this.right.textContent = rightKey;
    this.left.classList.toggle('is-pressed', input < -0.1);
    this.right.classList.toggle('is-pressed', input > 0.1);
  }

  dispose(): void { this.root.remove(); }
}
