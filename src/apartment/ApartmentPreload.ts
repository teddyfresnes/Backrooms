import type { ApartmentDocument } from './ApartmentData';

/** The worker retains large prepared data until the photographic film is over.
 * No Three.js import, renderer, physics or large main-thread clone during it. */
export class ApartmentPreload {
  private readonly worker: Worker;
  private failure?: unknown;
  private result?: Promise<ApartmentDocument>;
  private resolve?: (data: ApartmentDocument) => void;
  private reject?: (reason: unknown) => void;
  private disposed = false;

  constructor(url: string) {
    this.worker = new Worker(new URL('./apartment.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<{ data?: ApartmentDocument; ready?: boolean; error?: string }>) => {
      if (this.disposed) return;
      if (event.data.ready) return;
      if (event.data.error || !event.data.data) { this.fail(new Error(event.data.error ?? 'Appartement indisponible')); return; }
      this.resolve?.(event.data.data);
      this.worker.terminate();
    };
    this.worker.onerror = () => this.fail(new Error('Le chargement de l’appartement a échoué.'));
    this.worker.onmessageerror = () => this.fail(new Error('Les données de l’appartement sont illisibles.'));
    this.worker.postMessage({ type: 'prepare', url: new URL(url, window.location.href).href, hold: true });
  }

  take(signal?: AbortSignal): Promise<ApartmentDocument> {
    if (this.disposed || this.failure) return Promise.reject(this.failure ?? new DOMException('Cancelled', 'AbortError'));
    signal?.throwIfAborted();
    if (!this.result) {
      this.result = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
      this.worker.postMessage({ type: 'take' });
    }
    const abort = () => this.dispose(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    return this.result.finally(() => {
      signal?.removeEventListener('abort', abort);
      this.result = undefined; this.resolve = undefined; this.reject = undefined;
      this.disposed = true;
    });
  }

  private fail(error: unknown): void {
    this.failure = error; this.worker.terminate(); this.reject?.(error);
  }

  dispose(reason: unknown = new DOMException('Cancelled', 'AbortError')): void {
    if (this.disposed) return;
    this.disposed = true; this.failure = reason;
    this.worker.terminate(); this.reject?.(reason);
    this.result = undefined; this.resolve = undefined; this.reject = undefined;
  }
}
