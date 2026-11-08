import { decodePackedApartment, downloadPackedApartment, type ApartmentLoadEvent } from './LoadPackedApartment';

type DataRecord = Record<string, unknown>;
export interface ApartmentDocument extends DataRecord { geometries?: DataRecord[] }

/** Download only; the returned decoder is explicitly gated by the film's end. */
export async function downloadApartmentDocument(url: string, onProgress?: (event: ApartmentLoadEvent) => void,
  cachedBytes?: Blob, onDownloaded?: (bytes: Blob) => void, signal?: AbortSignal): Promise<() => Promise<ApartmentDocument>> {
  signal?.throwIfAborted();
  const packed = url.split(/[?#]/,1)[0]!.endsWith('.parts.json');
  let bytes = cachedBytes;
  if (!bytes) {
    const response = await fetch(url, { priority: 'low', signal });
    if (!response.ok) throw new Error('Le modèle de l’appartement est indisponible.');
    bytes = packed ? await downloadPackedApartment(url, response, onProgress, signal) : await response.blob();
  } else onProgress?.({ phase: 'network', progress: 1, durationMs: 0, receivedBytes: bytes.size, totalBytes: bytes.size });
  onDownloaded?.(bytes);
  return async () => {
    signal?.throwIfAborted();
    const start = performance.now(); onProgress?.({ phase: 'decode', progress: 0 });
    const data = (packed ? await decodePackedApartment(bytes!, signal) : await new Response(bytes).json()) as ApartmentDocument;
    signal?.throwIfAborted();
    onProgress?.({ phase: 'decode', progress: 1, durationMs: performance.now() - start });
    return data;
  };
}

/** Decode the very large source away from the presentation thread. */
export async function fetchApartmentDocument(url: string): Promise<ApartmentDocument> {
  return (await downloadApartmentDocument(url))();
}

const ARRAY_TYPES = { Float32Array, Float64Array, Uint32Array, Uint16Array, Uint8Array, Uint8ClampedArray, Int32Array, Int16Array, Int8Array };

/** Same conversions as BufferGeometryLoader, transferred instead of cloned as
 * millions of JS numbers. IDs, groups, UVs, normals and scene metadata survive. */
export function prepareApartmentTransfers(document: ApartmentDocument): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const child of value) if (child && typeof child === 'object') visit(child);
      return;
    }
    if (ArrayBuffer.isView(value)) { buffers.add(value.buffer as ArrayBuffer); return; }
    const entry = value as DataRecord;
    if (typeof entry.type === 'string' && Object.hasOwn(ARRAY_TYPES, entry.type) && Array.isArray(entry.array)) {
      const Constructor = ARRAY_TYPES[entry.type as keyof typeof ARRAY_TYPES];
      const typed = new Constructor(entry.array as number[]);
      entry.array = typed;
      buffers.add(typed.buffer);
      return;
    }
    for (const child of Object.values(entry)) visit(child);
  };
  visit(document.geometries);
  // Bounds are CPU work too; compute them on the worker before transferring.
  for (const geometry of document.geometries ?? []) {
    const data = geometry.data as { attributes?: { position?: { array: ArrayLike<number>; itemSize: number } }; runtimeBounds?: unknown } | undefined;
    const position = data?.attributes?.position;
    if (!position || position.itemSize < 3 || data?.runtimeBounds) continue;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < position.array.length; i += position.itemSize) for (let axis = 0; axis < 3; axis++) {
      const value = position.array[i + axis]!; min[axis] = Math.min(min[axis]!, value); max[axis] = Math.max(max[axis]!, value);
    }
    if (min.every(Number.isFinite) && max.every(Number.isFinite)) data!.runtimeBounds = { min, max };
  }
  return [...buffers];
}
