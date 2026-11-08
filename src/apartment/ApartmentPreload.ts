import type { ApartmentLoadEvent } from './LoadPackedApartment';
import { downloadApartmentDocument, prepareApartmentTransfers, type ApartmentDocument } from './ApartmentData';

/** The worker holds compressed downloads until take() permits decoding.
 * Typed arrays then transfer without a main-thread clone; cancellation stops downloads. */
export class ApartmentPreload {
  // One compressed immutable Blob, shared by reference through worker messages.
  // Repeated new games/saves avoid both another download and a giant JSON cache.
  private static cached?: { url: string; bytes: Blob };
  private worker?: Worker;
  private readonly cacheKey: string;
  private readonly fallbackAbort = new AbortController();
  private fallback = false;
  private fallbackStarted = false;
  private workerFailure?: unknown;
  private failure?: unknown;
  private result?: Promise<ApartmentDocument>;
  private resolve?: (data: ApartmentDocument) => void;
  private reject?: (reason: unknown) => void;
  private disposed = false;
  private timeout: ReturnType<typeof setTimeout>;

  constructor(url: string, private readonly onProgress?: (event: ApartmentLoadEvent) => void) {
    const absoluteUrl = this.cacheKey = new URL(url, window.location.href).href;
    this.timeout = setTimeout(() => this.fail(new Error('Le chargement de l’appartement a été interrompu.')), 180000);
    try {
      const worker = this.worker = new Worker(new URL('./apartment.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<{ data?: ApartmentDocument; ready?: boolean; error?: string; progress?: ApartmentLoadEvent; downloaded?: Blob }>) => {
        if (this.disposed || this.fallback) return;
        if (event.data.downloaded) { ApartmentPreload.cached = { url: absoluteUrl, bytes: event.data.downloaded }; return; }
        if (event.data.progress) { onProgress?.(event.data.progress); return; }
        if (event.data.ready) { if (!this.result) clearTimeout(this.timeout); return; }
        if (event.data.error || !event.data.data) { this.fail(new Error(event.data.error ?? 'Appartement indisponible')); return; }
        this.complete(event.data.data);
      };
      worker.onerror = event => {
        event?.preventDefault?.();
        this.recoverWorker(new Error(event?.message || 'Le worker de l’appartement est indisponible.'));
      };
      worker.onmessageerror = () => this.recoverWorker(new Error('Le transfert de l’appartement a échoué.'));
      worker.postMessage({ type: 'prepare', url: absoluteUrl, hold: true, ...(ApartmentPreload.cached?.url === absoluteUrl ? { packed: ApartmentPreload.cached.bytes } : {}) });
    } catch (error) { this.recoverWorker(error); }
  }

  /** A stale/blocked worker module must not make every saved game unloadable.
   * Recovery is gated by take(), just like worker decoding: never under the photos. */
  private recoverWorker(error: unknown): void {
    if (this.disposed || this.failure || this.fallback) return;
    this.workerFailure = error; this.fallback = true;
    this.worker?.terminate(); this.worker = undefined;
    if (this.result) void this.loadWithoutWorker();
  }

  private async loadWithoutWorker(): Promise<void> {
    if (this.fallbackStarted || this.disposed) return;
    this.fallbackStarted = true;
    try {
      const decode = await downloadApartmentDocument(this.cacheKey,
        event => { if (!this.disposed) this.onProgress?.(event); },
        ApartmentPreload.cached?.url === this.cacheKey ? ApartmentPreload.cached.bytes : undefined,
        bytes => { if (!this.disposed) ApartmentPreload.cached = { url: this.cacheKey, bytes }; },
        this.fallbackAbort.signal);
      const data = await decode();
      this.fallbackAbort.signal.throwIfAborted();
      prepareApartmentTransfers(data);
      this.complete(data);
    } catch (error) {
      if (!this.disposed) this.fail(new Error(error instanceof Error ? error.message : 'Appartement indisponible', { cause: this.workerFailure }));
    }
  }

  private complete(data: ApartmentDocument): void {
    if (this.disposed) return;
    clearTimeout(this.timeout);
    this.worker?.terminate(); this.worker = undefined;
    this.resolve?.(data);
  }

  take(signal?: AbortSignal): Promise<ApartmentDocument> {
    if (this.disposed || this.failure) return Promise.reject(this.failure ?? new DOMException('Cancelled', 'AbortError'));
    signal?.throwIfAborted();
    if (!this.result) {
      clearTimeout(this.timeout);
      this.timeout = setTimeout(() => this.fail(new Error('La préparation de l’appartement a été interrompue.')), 180000);
      this.result = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
      if (this.fallback) void this.loadWithoutWorker();
      else try { this.worker?.postMessage({ type: 'take' }); } catch (error) { this.recoverWorker(error); }
    }
    const abort = () => this.dispose(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    return this.result.finally(() => {
      signal?.removeEventListener('abort', abort);
      this.result = undefined; this.resolve = undefined; this.reject = undefined;
      this.disposed = true;
      this.fallbackAbort.abort();
    });
  }

  private fail(error: unknown): void {
    if (ApartmentPreload.cached?.url === this.cacheKey) ApartmentPreload.cached = undefined;
    clearTimeout(this.timeout);
    this.failure = error; this.worker?.terminate(); this.worker = undefined;
    this.fallbackAbort.abort(error); this.reject?.(error);
  }

  dispose(reason: unknown = new DOMException('Cancelled', 'AbortError')): void {
    if (this.disposed) return;
    this.disposed = true; this.failure = reason;
    clearTimeout(this.timeout);
    this.worker?.terminate(); this.worker = undefined;
    this.fallbackAbort.abort(reason); this.reject?.(reason);
    this.result = undefined; this.resolve = undefined; this.reject = undefined;
  }
}
