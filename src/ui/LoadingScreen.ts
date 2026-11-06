/** A tiny, deterministic maze. The runner retraces a walk through connected
 * cell centres, so it never crosses a wall or jumps at the loop boundary. */
export function loadingMaze(): { walls: string; route: string } {
  const columns = 12, rows = 6, size = 12;
  const visited = new Set<number>();
  const passages = new Set<string>();
  const points: string[] = [];
  const edge = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;
  const point = (cell: number) => `${cell % columns * size + 6},${Math.floor(cell / columns) * size + 6}`;
  const walk = (cell: number): void => {
    visited.add(cell); points.push(point(cell));
    const x = cell % columns, y = Math.floor(cell / columns);
    const neighbours = [x < columns - 1 ? cell + 1 : -1, y < rows - 1 ? cell + columns : -1,
      x > 0 ? cell - 1 : -1, y > 0 ? cell - columns : -1];
    const turn = (x * 7 + y * 3) % 4;
    for (let i = 0; i < 4; i++) {
      const next = neighbours[(i + turn) % 4]!;
      if (next < 0 || visited.has(next)) continue;
      passages.add(edge(cell, next)); walk(next); points.push(point(cell));
    }
  };
  walk(0);
  let walls = 'M0 0H144V72H0Z';
  for (let cell = 0; cell < columns * rows; cell++) {
    const x = cell % columns * size, y = Math.floor(cell / columns) * size;
    if (cell % columns < columns - 1 && !passages.has(edge(cell, cell + 1))) walls += `M${x + size} ${y}v${size}`;
    if (cell < columns * (rows - 1) && !passages.has(edge(cell, cell + columns))) walls += `M${x} ${y + size}h${size}`;
  }
  return { walls, route: `M${points.join('L')}` };
}

/** One measured, event-driven loading view for the launcher, saves and prologue. */
export class LoadingScreen {
  readonly element = document.createElement('div');
  private readonly track: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly percent: HTMLElement;
  private readonly phase: HTMLElement;
  private progress = 0;
  constructor(detail: string) {
    const maze = loadingMaze();
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.element.className = 'loading-screen';
    this.element.innerHTML = `<div class="loading-screen-content">
      <div class="loading-screen-heading"><span>Chargement</span><span data-loading-percent>0 %</span></div>
      <div class="loading-screen-track" role="progressbar" aria-label="Chargement" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
      <p class="loading-screen-phase" role="status" aria-live="polite"></p>
      <svg class="loading-maze" viewBox="-3 -3 150 78" aria-hidden="true" focusable="false">
        <path d="${maze.walls}" fill="none" stroke="currentColor" stroke-width=".65"/>
        <circle r="1.9" fill="#e2dbb2" ${reduced ? 'cx="6" cy="6"' : ''}>
          ${reduced ? '' : `<animateMotion dur="28s" repeatCount="indefinite" calcMode="paced" path="${maze.route}"/>`}
        </circle>
      </svg></div>`;
    this.track = this.element.querySelector('[role="progressbar"]')!;
    this.fill = this.track.querySelector('i')!;
    this.percent = this.element.querySelector('[data-loading-percent]')!;
    this.phase = this.element.querySelector('.loading-screen-phase')!;
    this.setPhase(detail);
  }
  setPhase(phase: string): void { if (this.phase.textContent !== phase) this.phase.textContent = phase; }
  setProgress(value: number, phase?: string): void {
    if (!Number.isFinite(value)) return;
    this.progress = Math.max(this.progress, Math.min(1, Math.max(0, value)));
    const percentage = Math.floor(this.progress * 100);
    this.fill.style.width = `${this.progress * 100}%`;
    this.track.setAttribute('aria-valuenow', String(percentage));
    this.percent.textContent = `${percentage} %`;
    if (phase) this.setPhase(phase);
  }
}
