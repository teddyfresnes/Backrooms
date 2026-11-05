type DataRecord = Record<string, unknown>;
export interface ApartmentDocument extends DataRecord { geometries?: DataRecord[] }

/** Decode the very large source away from the presentation thread. */
export async function fetchApartmentDocument(url: string): Promise<ApartmentDocument> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Le modèle de l’appartement est indisponible.');
  if (!url.endsWith('.parts.json')) return await response.json() as ApartmentDocument;
  const manifest = await response.json() as { version: number; compression: string; parts: { file: string }[] };
  if (manifest.version !== 1 || manifest.compression !== 'gzip' || !Array.isArray(manifest.parts)
    || !manifest.parts.length || manifest.parts.some(part => !/^apartment-\d{3}\.bin$/.test(part.file))) {
    throw new Error('Le modèle de l’appartement est incomplet.');
  }
  const base = url.slice(0, url.lastIndexOf('/') + 1);
  let index = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>> | undefined;
  const stream = new ReadableStream<BufferSource>({
    async pull(controller) {
      while (true) {
        if (!reader) {
          if (index === manifest.parts.length) { controller.close(); return; }
          const part = await fetch(base + manifest.parts[index++]!.file);
          if (!part.ok || !part.body) throw new Error('Le chargement de l’appartement a été interrompu. Réessaie.');
          reader = part.body.getReader();
        }
        const item = await reader.read();
        if (item.done) { reader.releaseLock(); reader = undefined; continue; }
        controller.enqueue(item.value); return;
      }
    },
    async cancel(reason) { await reader?.cancel(reason); },
  });
  return await new Response(stream.pipeThrough(new DecompressionStream('gzip'))).json() as ApartmentDocument;
}

const ARRAY_TYPES = { Float32Array, Float64Array, Uint32Array, Uint16Array, Uint8Array, Uint8ClampedArray, Int32Array, Int16Array, Int8Array };

/** Same conversions as BufferGeometryLoader, transferred instead of cloned as
 * millions of JS numbers. IDs, groups, UVs, normals and scene metadata survive. */
export function prepareApartmentTransfers(document: ApartmentDocument): ArrayBuffer[] {
  const buffers: ArrayBuffer[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const child of value) if (child && typeof child === 'object') visit(child);
      return;
    }
    const entry = value as DataRecord;
    if (typeof entry.type === 'string' && Object.hasOwn(ARRAY_TYPES, entry.type) && Array.isArray(entry.array)) {
      const Constructor = ARRAY_TYPES[entry.type as keyof typeof ARRAY_TYPES];
      const typed = new Constructor(entry.array as number[]);
      entry.array = typed;
      buffers.push(typed.buffer);
      return;
    }
    for (const child of Object.values(entry)) visit(child);
  };
  visit(document.geometries);
  return buffers;
}
