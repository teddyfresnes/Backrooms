import type { ApartmentLoadEvent } from './LoadPackedApartment';
import type { ApartmentDocument } from './ApartmentData';

/** The worker holds compressed downloads until take() permits decoding.
 * Typed arrays then transfer without a main-thread clone; cancellation stops downloads. */
export class ApartmentPreload {
  // One compressed immutable Blob, shared by reference through worker messages.
  // Repeated new games/saves avoid both another download and a giant JSON cache.
  private static cached?: { url: string; bytes: Blob };
  private readonly worker: Worker;
  private readonly cacheKey: string;
  private failure?: unknown;
  private result?: Promise<ApartmentDocument>;
  private resolve?: (data: ApartmentDocument) => void;
  private reject?: (reason: unknown) => void;
  private disposed = false;
  private timeout: ReturnType<typeof setTimeout>;

  constructor(url: string, onProgress?: (event: ApartmentLoadEvent) => void) {
    const absoluteUrl = this.cacheKey = new URL(url, window.location.href).href;
    this.worker = new Worker(new URL('./apartment.worker.ts', import.meta.url), { type: 'module' });
    this.timeout = setTimeout(() => this.fail(new Error('Le chargement de l’appartement a été interrompu.')), 180000);
    this.worker.onmessage = (event: MessageEvent<{ data?: ApartmentDocument; ready?: boolean; error?: string; progress?: ApartmentLoadEvent; downloaded?: Blob }>) => {
      if (this.disposed) return;
      if (event.data.downloaded) { ApartmentPreload.cached = { url: absoluteUrl, bytes: event.data.downloaded }; return; }
      if (event.data.progress) { onProgress?.(event.data.progress); return; }
      if (event.data.ready) { if (!this.result) clearTimeout(this.timeout); return; }
      if (event.data.error || !event.data.data) { this.fail(new Error(event.data.error ?? 'Appartement indisponible')); return; }
      this.resolve?.(event.data.data);
      clearTimeout(this.timeout);
      this.worker.terminate();
    };
    this.worker.onerror = () => this.fail(new Error('Le chargement de l’appartement a échoué.'));
    this.worker.onmessageerror = () => this.fail(new Error('Les données de l’appartement sont illisibles.'));
    this.worker.postMessage({ type: 'prepare', url: absoluteUrl, hold: true, ...(ApartmentPreload.cached?.url === absoluteUrl ? { packed: ApartmentPreload.cached.bytes } : {}) });
  }

  take(signal?: AbortSignal): Promise<ApartmentDocument> {
    if (this.disposed || this.failure) return Promise.reject(this.failure ?? new DOMException('Cancelled', 'AbortError'));
    signal?.throwIfAborted();
    if (!this.result) {
      clearTimeout(this.timeout);
      this.timeout = setTimeout(() => this.fail(new Error('La préparation de l’appartement a été interrompue.')), 180000);
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
    if (ApartmentPreload.cached?.url === this.cacheKey) ApartmentPreload.cached = undefined;
    clearTimeout(this.timeout);
    this.failure = error; this.worker.terminate(); this.reject?.(error);
  }

  dispose(reason: unknown = new DOMException('Cancelled', 'AbortError')): void {
    if (this.disposed) return;
    this.disposed = true; this.failure = reason;
    clearTimeout(this.timeout);
    this.worker.terminate(); this.reject?.(reason);
    this.result = undefined; this.resolve = undefined; this.reject = undefined;
  }
}
