import type { WorldPlan } from '../world/types';
import { attachInfiniteChunkMetadata } from '../world/InfiniteWorld';

/** Use the existing generator worker for the menu's origin plan too. */
export async function prepareOriginPlan(seed: string, signal?: AbortSignal): Promise<WorldPlan> {
  signal?.throwIfAborted();
  if (typeof Worker === 'undefined') return (await import('../world/InfiniteWorld')).generateInfiniteChunk(seed, { x: 0, z: 0, story: 0 });
  const plan = await new Promise<WorldPlan>((resolve, reject) => {
    const worker = new Worker(new URL('../world/infinite.worker.ts', import.meta.url), { type: 'module' });
    const close = () => { clearTimeout(timeout); signal?.removeEventListener('abort', abort); worker.terminate(); };
    const abort = () => { close(); reject(signal?.reason); };
    const timeout = setTimeout(() => { close(); reject(new Error('Préparation du menu interrompue.')); }, 120000);
    worker.onmessage = event => { close(); event.data.plan ? resolve(event.data.plan) : reject(new Error(event.data.error ?? 'Plan indisponible.')); };
    worker.onerror = error => { close(); reject(new Error(error.message)); };
    signal?.addEventListener('abort', abort, { once: true });
    worker.postMessage({ id: 1, seed, key: { x: 0, z: 0, story: 0 }, planOnly: true });
  });
  signal?.throwIfAborted();
  // The worker's WeakMap does not survive structured cloning. Restore the
  // runtime contract required by WorldStream, just as it does for neighbours.
  attachInfiniteChunkMetadata(seed, plan, { x: 0, z: 0, story: 0 });
  return plan;
}
