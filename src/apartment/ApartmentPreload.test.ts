import { afterEach, expect, it, vi } from 'vitest';
import { ApartmentPreload } from './ApartmentPreload';

class WorkerMock {
  static latest: WorkerMock; onmessage?: (event: MessageEvent) => void;
  onerror?: () => void; onmessageerror?: () => void;
  terminate = vi.fn(); postMessage = vi.fn();
  constructor() { WorkerMock.latest = this; }
}
afterEach(() => vi.unstubAllGlobals());
it('prepares without transferring large data until the film has finished, then releases the worker', async () => {
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
  const preload = new ApartmentPreload('/apartment.json'); WorkerMock.latest.onerror?.();
  await expect(preload.take()).rejects.toThrow('échoué');
  const cancelled = new ApartmentPreload('/apartment.json'); cancelled.dispose();
  await expect(cancelled.take()).rejects.toMatchObject({ name: 'AbortError' });
});
