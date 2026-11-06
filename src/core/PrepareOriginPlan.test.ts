import { afterEach, expect, it, vi } from 'vitest';
import { generateInfiniteChunk, getInfiniteChunkMetadata } from '../world/InfiniteWorld';
import { prepareOriginPlan } from './PrepareOriginPlan';

afterEach(() => vi.unstubAllGlobals());

it('restores origin metadata lost in the worker structured clone without regenerating geometry', async () => {
  const seed = 'ORIGIN-WORKER-REGRESSION';
  const source = generateInfiniteChunk(seed, { x: 0, z: 0, story: 0 });
  const cloned = structuredClone(source);
  expect(getInfiniteChunkMetadata(cloned)).toBeUndefined();
  const terminate = vi.fn();
  class WorkerResponse {
    onmessage?: (event: { data: { plan: typeof cloned } }) => void;
    terminate = terminate;
    postMessage() { queueMicrotask(() => this.onmessage?.({ data: { plan: cloned } })); }
  }
  vi.stubGlobal('Worker', WorkerResponse);

  const prepared = await prepareOriginPlan(seed);
  expect(prepared).toBe(cloned);
  expect(prepared).toEqual(source);
  const metadata = getInfiniteChunkMetadata(prepared);
  expect(metadata).toBeDefined();
  expect(metadata).toEqual(getInfiniteChunkMetadata(source));
  expect(metadata?.coord).toEqual({ x: 0, z: 0, story: 0 });
  expect(terminate).toHaveBeenCalledOnce();
});

it('terminates an interrupted origin worker and permits a subsequent retry', async () => {
  const terminate = vi.fn();
  class PendingWorker {
    terminate = terminate;
    postMessage() {}
  }
  vi.stubGlobal('Worker', PendingWorker);
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const pending = prepareOriginPlan('CANCELLED-ORIGIN', controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
  }
  expect(terminate).toHaveBeenCalledTimes(2);
});
