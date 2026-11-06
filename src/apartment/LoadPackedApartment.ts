import { decodeApartmentBinary } from './ApartmentBinary';

export interface ApartmentLoadEvent { phase: 'network' | 'decode'; progress?: number; durationMs?: number; receivedBytes?: number; totalBytes?: number }

interface ApartmentParts {
  version: number;
  compression: string;
  encoding?: string;
  runtimeSha256?: string;
  parts: Array<{ file: string; bytes?: number }>;
}

/** Download compressed bytes only. Keep the 349 MB JSON and geometry conversion
 * out of the photographic phase, including their memory/GC pressure. */
export async function downloadPackedApartment(manifestUrl: string, suppliedManifest?: Response, onProgress?: (event: ApartmentLoadEvent) => void): Promise<Blob> {
  const response = suppliedManifest ?? await fetch(manifestUrl);
  if (!response.ok) throw new Error('Le modèle de l’appartement est indisponible.');
  const manifest = await response.json() as ApartmentParts;
  if (![1, 2].includes(manifest.version) || manifest.compression !== 'gzip' || !Array.isArray(manifest.parts)
    || manifest.parts.length === 0 || manifest.parts.some(part => !/^apartment-(?:runtime-)?\d{3}\.bin$/.test(part.file))) {
    throw new Error('Le modèle de l’appartement est incomplet.');
  }
  if (manifest.version === 2 && manifest.encoding !== 'apartment-binary-v1') throw new Error('Format d’appartement inconnu.');
  const totalBytes = manifest.parts.every(part => Number.isFinite(part.bytes) && part.bytes! > 0)
    ? manifest.parts.reduce((sum, part) => sum + part.bytes!, 0) : undefined;
  const started = performance.now();
  let receivedBytes = 0, reportedBytes = 0;
  const notify = (done = false): void => onProgress?.({ phase: 'network',
    progress: done ? 1 : totalBytes ? Math.min(.999, receivedBytes / totalBytes) : undefined,
    receivedBytes, totalBytes, ...(done ? { durationMs: performance.now() - started } : {}) });
  notify();
  const base = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);
  const abort = new AbortController();
  const parts: Blob[] = new Array(manifest.parts.length);
  let index = 0;
  try {
    // Two low-priority downloads; blob storage avoids JS byte-array copies.
    await Promise.all(Array.from({ length: Math.min(2, manifest.parts.length) }, async () => {
      while (index < manifest.parts.length) {
        const current = index++;
        const revision = manifest.version===2&&/^[a-f0-9]{64}$/.test(manifest.runtimeSha256??'')?`?v=${manifest.runtimeSha256}`:'';
        const response = await fetch(base + manifest.parts[current]!.file + revision, { signal: abort.signal, priority: 'low' });
        if (!response.ok || !response.body) throw new Error('Le chargement de l’appartement a été interrompu. Réessaie.');
        const measured = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            receivedBytes += chunk.byteLength;
            if (receivedBytes - reportedBytes >= 256 * 1024) { reportedBytes = receivedBytes; notify(); }
            controller.enqueue(chunk);
          },
        }));
        parts[current] = await new Response(measured).blob();
        const expected = manifest.parts[current]!.bytes;
        if (expected !== undefined && parts[current]!.size !== expected) throw new Error('Données d’appartement incomplètes.');
      }
    }));
    notify(true);
    return new Blob(parts, { type: manifest.version === 2 ? 'application/x-apartment-binary-gzip' : 'application/gzip' });
  }
  finally { abort.abort(); }
}

export async function decodePackedApartment(packed: Blob): Promise<unknown> {
  const response = new Response(packed.stream().pipeThrough(new DecompressionStream('gzip')));
  return packed.type === 'application/x-apartment-binary-gzip'
    ? decodeApartmentBinary(await response.arrayBuffer()) : await response.json() as unknown;
}

/** A single gzip stream split into static files; no geometry is transformed. */
export async function loadPackedApartmentJson(manifestUrl: string, suppliedManifest?: Response): Promise<unknown> {
  return decodePackedApartment(await downloadPackedApartment(manifestUrl, suppliedManifest));
}
