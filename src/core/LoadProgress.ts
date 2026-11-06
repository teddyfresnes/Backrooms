import type { ApartmentLoadEvent } from '../apartment/LoadPackedApartment';
/** Wall-clock prefix (HH:MM:SS) so pasted console logs read as a timeline. */
const clock = (): string => new Date().toLocaleTimeString('fr-FR', { hour12: false });
export type LoadProgressCallback = (progress: number, phase?: string) => void;
export const ENTRY_LOAD_TASKS = {
  network: { weight: 32, label: 'Téléchargement des ressources' },
  decode: { weight: 10, label: 'Décompression' },
  materials: { weight: 5, label: 'Textures' },
  scene: { weight: 12, label: 'Création de la scène' },
  physics: { weight: 8, label: 'Préparation de la physique' },
  character: { weight: 12, label: 'Préparation du personnage' },
  audio: { weight: 8, label: 'Préparation du son' },
  gpu: { weight: 11, label: 'Préparation de l’affichage' },
  ready: { weight: 2, label: 'Prêt' },
} as const;
export type EntryLoadTask = keyof typeof ENTRY_LOAD_TASKS;

/** Completed work, never elapsed-time interpolation. Parallel phase durations
 * deliberately overlap; the report includes wall time rather than summing them. */
export class LoadProgress {
  private readonly started = performance.now();
  private readonly progress = new Map<EntryLoadTask, number>();
  private readonly begins = new Map<EntryLoadTask, number>();
  private readonly timings: Partial<Record<EntryLoadTask, number>> = {};
  private readonly operationsMs: Record<string, number> = {};
  private phase = 'Préparation';
  private downloadBytes?: { received: number; total?: number };
  private listener: LoadProgressCallback = () => {};
  private readonly stalls: Array<{ atS: number; ms: number; phase: string }> = [];
  private heartbeat?: ReturnType<typeof setTimeout>;
  private lastBeat = performance.now();
  private beatPhase = 'Préparation';
  constructor(private readonly log: boolean = typeof window !== 'undefined' && !(import.meta as { vitest?: unknown }).vitest) {
    if (this.log) this.beat();
  }
  private seconds(at = performance.now()): string { return `${((at - this.started) / 1000).toFixed(1)} s`; }
  /** A 250 ms timer that fires late measures a frozen main thread and names
   * the phase it froze in (Firefox has no long-task observer). */
  private beat = (): void => {
    const now = performance.now(), gap = now - this.lastBeat - 250;
    if (gap >= 400) {
      // The phase that was running when the thread stopped, not the one after.
      const phase = this.beatPhase === this.phase ? this.phase : `${this.beatPhase} → ${this.phase}`;
      this.stalls.push({ atS: Math.round((this.lastBeat - this.started) / 100) / 10, ms: Math.round(gap), phase });
      console.info(`${clock()} [loading] main thread frozen ${(gap / 1000).toFixed(1)} s during "${phase}" (t+${this.seconds(this.lastBeat)})`);
    }
    this.lastBeat = now; this.beatPhase = this.phase;
    if (now - this.started < 600000) this.heartbeat = setTimeout(this.beat, 250);
  };
  dispose(): void { clearTimeout(this.heartbeat); this.heartbeat = undefined; }
  apartment(event: ApartmentLoadEvent): void {
    if (event.progress === 0) this.start(event.phase);
    if (event.receivedBytes !== undefined) this.downloadBytes = { received: event.receivedBytes, total: event.totalBytes };
    if (event.progress !== undefined) this.report(event.phase, event.progress);
    if (event.durationMs !== undefined) this.timings[event.phase] = event.durationMs;
  }
  subscribe(listener: LoadProgressCallback): void { this.listener = listener; this.emit(); }
  start(task: EntryLoadTask): void {
    if (!this.begins.has(task)) {
      this.begins.set(task, performance.now());
      if (this.log) console.info(`${clock()} [loading] ▶ ${ENTRY_LOAD_TASKS[task].label} (t+${this.seconds()})`);
    }
    this.phase = ENTRY_LOAD_TASKS[task].label; this.emit();
  }
  report(task: EntryLoadTask, value: number, phase?: string): void {
    if (!Number.isFinite(value)) return;
    const next = Math.max(this.progress.get(task) ?? 0, Math.min(1, Math.max(0, value)));
    this.progress.set(task, next);
    if (next === 1) this.end(task);
    else if (phase) this.phase = phase;
    this.emit();
  }
  end(task: EntryLoadTask): void {
    const begin = this.begins.get(task);
    if (begin === undefined) return;
    this.timings[task] = (this.timings[task] ?? 0) + performance.now() - begin;
    if (this.log) console.info(`${clock()} [loading] ✓ ${ENTRY_LOAD_TASKS[task].label} in ${((performance.now() - begin) / 1000).toFixed(1)} s (t+${this.seconds()})`);
    this.begins.delete(task);
    const next = (['network','decode','materials','scene','physics','character','gpu','audio'] as EntryLoadTask[]).find(id => this.begins.has(id));
    this.phase = next ? ENTRY_LOAD_TASKS[next].label : 'Finalisation';
  }
  complete(task: EntryLoadTask): void { this.report(task, 1); }
  recordOperation(name: string, durationMs: number): void { this.operationsMs[name] = (this.operationsMs[name] ?? 0) + durationMs; }
  async measure<T>(task: EntryLoadTask, work: () => Promise<T>): Promise<T> {
    this.start(task); const value = await work(); this.complete(task); return value;
  }
  private emit(): void {
    const fraction = Object.entries(ENTRY_LOAD_TASKS).reduce((sum, [id, task]) => sum + task.weight * (this.progress.get(id as EntryLoadTask) ?? 0), 0) / 100;
    this.listener(fraction, this.phase);
  }
  finish(): void {
    this.phase = 'Prêt';
    this.complete('ready');
    const resources = performance.getEntriesByType('resource').filter(entry => entry.startTime >= this.started) as PerformanceResourceTiming[];
    this.dispose();
    const report = { stalls: [...this.stalls], apartmentBytes: this.downloadBytes, totalMs: performance.now() - this.started, phasesMs: { ...this.timings }, operationsMs: { ...this.operationsMs },
      resources: resources.map(entry => ({ url: entry.name, durationMs: entry.duration, transferredBytes: entry.transferSize, decodedBytes: entry.decodedBodySize })) };
    Object.assign(window, { __BACKROOMS_LOAD__: report });
    if (this.log) {
      const ms = (value: number) => Math.round(value);
      console.info(`${clock()} [loading] ready in ${this.seconds()} — frozen ${(this.stalls.reduce((sum, stall) => sum + stall.ms, 0) / 1000).toFixed(1)} s in total`);
      console.table(Object.fromEntries(Object.entries(this.timings).map(([phase, value]) => [phase, { ms: ms(value!) }])));
      console.table(Object.fromEntries(Object.entries(this.operationsMs).sort((a, b) => b[1] - a[1]).map(([name, value]) => [name, { value: ms(value) }])));
      if (this.stalls.length) console.table(this.stalls);
      // One line to copy back for profiling.
      console.info(`${clock()} [loading] report JSON`, JSON.stringify({ ...report, resources: report.resources.filter(entry => entry.durationMs > 200) }));
    }
  }
}
