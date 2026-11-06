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

const MAZE_SCALE = 1.2; // 150×78 viewBox units drawn in a 180×94 px box.

/** The maze is deterministic: one CSS @keyframes rule per page drives every
 * runner dot (CSS transform animations run on the compositor). */
function installRunnerKeyframes(route: string): void {
  if (typeof document === 'undefined' || document.getElementById('loading-runner-keyframes')) return;
  const points = route.slice(1).split('L').map(point => point.split(',').map(Number) as [number, number]);
  // Every step is one 12-unit cell edge, so evenly spaced keyframes are paced.
  const frames = points.map(([x, y], index) =>
    `${(index / (points.length - 1) * 100).toFixed(3)}%{transform:translate(${((x + 3) * MAZE_SCALE).toFixed(1)}px,${((y + 3) * MAZE_SCALE).toFixed(1)}px)}`).join('');
  const style = document.createElement('style');
  style.id = 'loading-runner-keyframes';
  style.textContent = `@keyframes loading-run{${frames}}`;
  document.head.append(style);
}

/** One measured, event-driven loading view for the launcher, saves and prologue.
 * Every moving part animates transform/opacity only: the compositor keeps them
 * moving while scene preparation occupies the main thread (SVG SMIL froze). */
export class LoadingScreen {
  readonly element = document.createElement('div');
  private readonly track: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly percent: HTMLElement;
  private readonly phase: HTMLElement;
  private readonly hint: HTMLElement;
  private progress = 0;
  constructor(detail: string) {
    const maze = loadingMaze();
    this.element.className = 'loading-screen';
    this.element.innerHTML = `<div class="loading-screen-content">
      <div class="loading-screen-heading"><span>Chargement</span><span data-loading-percent>0 %</span></div>
      <div class="loading-screen-track" role="progressbar" aria-label="Chargement" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i><b></b></div>
      <p class="loading-screen-phase" role="status" aria-live="polite"></p>
      <div class="loading-maze" aria-hidden="true">
        <svg viewBox="-3 -3 150 78" focusable="false"><path d="${maze.walls}" fill="none" stroke="currentColor" stroke-width=".65" stroke-linecap="square"/></svg>
        <span class="loading-runner is-trail"></span><span class="loading-runner is-trail"></span><span class="loading-runner is-trail"></span>
        <span class="loading-runner"></span>
      </div>
      <p class="loading-screen-hint">La première préparation peut prendre un moment sur ce navigateur.</p></div>`;
    this.track = this.element.querySelector('[role="progressbar"]')!;
    this.fill = this.track.querySelector('i')!;
    this.percent = this.element.querySelector('[data-loading-percent]')!;
    this.phase = this.element.querySelector('.loading-screen-phase')!;
    this.hint = this.element.querySelector('.loading-screen-hint')!;
    this.setPhase(detail);
    installRunnerKeyframes(maze.route);
  }
  setPhase(phase: string): void { if (this.phase.textContent !== phase) this.phase.textContent = phase; }
  setProgress(value: number, phase?: string): void {
    if (!Number.isFinite(value)) return;
    this.progress = Math.max(this.progress, Math.min(1, Math.max(0, value)));
    const percentage = Math.floor(this.progress * 100);
    this.fill.style.transform = `scaleX(${this.progress})`;
    this.track.setAttribute('aria-valuenow', String(percentage));
    this.percent.textContent = `${percentage} %`;
    if (this.progress >= 1) this.hint.hidden = true;
    if (phase) this.setPhase(phase);
  }
}
