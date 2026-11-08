import { afterEach, expect, it, vi } from 'vitest';
import { ApartmentPreload } from './ApartmentPreload';

class WorkerMock {
  static latest: WorkerMock; onmessage?: (event: MessageEvent) => void;
  onerror?: () => void; onmessageerror?: () => void;
  terminate = vi.fn(); postMessage = vi.fn();
  constructor() { WorkerMock.latest = this; }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('downloads without decoding until the film has finished, then releases the worker', async () => {
  vi.stubGlobal('Worker', WorkerMock); vi.stubGlobal('window', { location: { href: 'https://game.test/' } });
  const preload = new ApartmentPreload('/apartment.parts.json'), worker = WorkerMock.latest;
  expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'prepare', url: 'https://game.test/apartment.parts.json', hold: true });
  worker.onmessage?.({ data: { ready: true } } as MessageEvent);
  expect(worker.terminate).not.toHaveBeenCalled(); expect(worker.postMessage).toHaveBeenCalledTimes(1);
  const pending = preload.take(); expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'take' });
  const model = { object: { name: 'Original apartment' } };
  worker.onmessage?.({ data: { data: model } } as MessageEvent);
  await expect(pending).resolves.toBe(model); expect(worker.terminate).toHaveBeenCalled();
});
it('contains preparation errors until consumption and aborts an obsolete preload without an unhandled rejection', async () => {
  vi.stubGlobal('Worker', WorkerMock); vi.stubGlobal('window', { location: { href: 'https://game.test/' } });
  const preload = new ApartmentPreload('/apartment.json'); WorkerMock.latest.onmessage?.({ data: { error: 'Appartement incomplet' } } as MessageEvent);
  await expect(preload.take()).rejects.toThrow('incomplet');
  const cancelled = new ApartmentPreload('/apartment.json'); cancelled.dispose();
  await expect(cancelled.take()).rejects.toMatchObject({ name: 'AbortError' });
});

it('loads a saved-game scene when the worker module fails, without decoding during the intro', async () => {
  vi.stubGlobal('Worker', WorkerMock); vi.stubGlobal('window', { location: { href: 'https://game.test/' } });
  const document = { object: { name: 'Saved apartment' }, geometries: [{ data: { attributes: { position: { type: 'Float32Array', itemSize: 3, array: [0, 0, 0, 1, 2, 3] } } } }] };
  const fetch = vi.fn(async () => new Response(JSON.stringify(document)));
  vi.stubGlobal('fetch', fetch);
  const preload = new ApartmentPreload('/fallback-apartment.json'), worker = WorkerMock.latest;
  worker.onerror?.();
  expect(worker.terminate).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  const loaded = await preload.take();
  expect(loaded.object).toEqual(document.object);
  const geometry = loaded.geometries![0]!.data as { attributes: { position: { array: Float32Array } }; runtimeBounds: unknown };
  expect(geometry.attributes.position.array).toBeInstanceOf(Float32Array);
  expect(geometry.runtimeBounds).toEqual({ min: [0, 0, 0], max: [1, 2, 3] });
  expect(fetch).toHaveBeenCalledOnce();
});

it('aborts a fallback download when a save load is cancelled', async () => {
  vi.stubGlobal('Worker', WorkerMock); vi.stubGlobal('window', { location: { href: 'https://game.test/' } });
  let downloadSignal: AbortSignal | undefined;
  vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
    downloadSignal = options.signal!;
    downloadSignal.addEventListener('abort', () => reject(downloadSignal!.reason), { once: true });
  })));
  const preload = new ApartmentPreload('/cancel-fallback.json'); WorkerMock.latest.onerror?.();
  const abort = new AbortController(), pending = preload.take(abort.signal);
  abort.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(downloadSignal?.aborted).toBe(true);
});
it('can hold downloaded bytes through a long hidden-tab pause, with a fresh deadline for decoding', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('Worker', WorkerMock); vi.stubGlobal('window', { location: { href: 'https://game.test/' } });
  const preload = new ApartmentPreload('/apartment.parts.json'), worker = WorkerMock.latest;
  worker.onmessage?.({ data: { ready: true } } as MessageEvent);
  vi.advanceTimersByTime(300000); expect(worker.terminate).not.toHaveBeenCalled();
  const pending = preload.take();
  const failed = expect(pending).rejects.toThrow('préparation');
  // A previously queued download-ready event must not cancel the decode deadline.
  worker.onmessage?.({ data: { ready: true } } as MessageEvent);
  vi.advanceTimersByTime(180000); await failed;
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it('reuses one compressed download on successive new-game and save loads without caching a mutable scene', async () => {
  vi.stubGlobal('Worker', WorkerMock); vi.stubGlobal('window', { location: { href: 'https://game.test/' } });
  const bytes = new Blob(['compressed immutable bytes']);
  const first = new ApartmentPreload('/cached-apartment.parts.json');
  WorkerMock.latest.onmessage?.({ data: { downloaded: bytes } } as MessageEvent);
  first.dispose();
  const second = new ApartmentPreload('/cached-apartment.parts.json');
  expect(WorkerMock.latest.postMessage).toHaveBeenCalledWith({ type: 'prepare', url: 'https://game.test/cached-apartment.parts.json', hold: true, packed: bytes });
  second.dispose();
  const other = new ApartmentPreload('/different-apartment.parts.json');
  expect(WorkerMock.latest.postMessage.mock.calls[0]![0]).not.toHaveProperty('packed'); other.dispose();
});
