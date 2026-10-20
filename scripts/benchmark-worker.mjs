import { build } from 'esbuild';
import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Node worker_threads exercise the production generation/bake functions and
// structured-clone boundary. This is a CPU proxy, not a browser Worker/frame test.
const output = resolve('.vertical-audit/worker-benchmark.mjs');
mkdirSync(resolve('.vertical-audit'), { recursive: true });
await build({ stdin: { contents: `
  import { parentPort } from 'node:worker_threads';
  import { performance } from 'node:perf_hooks';
  import { getHeapStatistics } from 'node:v8';
  import { generateInfiniteChunk, clearInfiniteWorldCaches } from './src/world/InfiniteWorld';
  import { bakeLightMapData } from './src/render/BakedLighting';
  parentPort.postMessage({ ready: true });
  parentPort.on('message', ({ seed, warm, legacy, warmup }) => {
    if (!warm) clearInfiniteWorldCaches();
    const coord = { x: -1, z: 1, story: 0 };
    if (warmup) { generateInfiniteChunk(seed, coord); parentPort.postMessage({ ready: true }); return; }
    const start = performance.now(), plan = generateInfiniteChunk(seed, coord);
    const generated = performance.now(), lightMaps = legacy ? bakeLightMapData(plan) : undefined;
    parentPort.postMessage({ plan, lightMaps, generationMs: generated - start,
      bakeMs: performance.now() - generated, heapBytes: getHeapStatistics().used_heap_size });
  });
`, resolveDir: process.cwd(), loader: 'ts' }, outfile: output, bundle: true, platform: 'node', format: 'esm', packages: 'external' });
const started = performance.now(), worker = new Worker(output);
const receive = () => new Promise((resolve, reject) => {
  const done = value => { worker.off('error', failed); resolve(value); };
  const failed = error => { worker.off('message', done); reject(error); };
  worker.once('message', done); worker.once('error', failed);
});
await receive();
const startupMs = performance.now() - started;
const summary = xs => { const a = [...xs].sort((a, b) => a - b); return { median: a[Math.floor(a.length / 2)], p95: a[Math.ceil(a.length * .95) - 1] }; };
const seeds = Array.from({ length: 24 }, (_, i) => `VERTICAL-PROMPT-AUDIT-${i}`), modes = {};
try {
  for (const mode of ['cold-modern', 'warm-modern', 'cold-legacy']) {
    const values = [];
    for (const seed of seeds) {
      if (mode.startsWith('warm')) {
        const ready = receive(); worker.postMessage({ seed, warmup: true }); await ready;
      }
      const start = performance.now(), next = receive();
      worker.postMessage({ seed, warm: mode.startsWith('warm'), legacy: mode.endsWith('legacy') });
      const result = await next, roundTripMs = performance.now() - start;
      values.push({ generationMs: result.generationMs, bakeMs: result.bakeMs, roundTripMs,
        transferAndDispatchMs: roundTripMs - result.generationMs - result.bakeMs,
        heapBytes: result.heapBytes, clonedBytes: Buffer.byteLength(JSON.stringify(result.plan)) });
    }
    modes[mode] = Object.fromEntries(Object.keys(values[0]).map(key => [key, summary(values.map(v => v[key]))]));
  }
} finally { await worker.terminate(); }
console.log(JSON.stringify({ node: process.version, seeds, startupMs, modes,
  limitation: 'Node worker_threads CPU/structured-clone proxy; no browser Worker scheduling, GPU, draw calls or frame latency.' }, null, 2));
