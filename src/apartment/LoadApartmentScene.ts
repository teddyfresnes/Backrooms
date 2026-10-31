import * as THREE from 'three';
import type { ApartmentDocument } from './ApartmentData';

export function loadApartmentDocument(url: string, signal?: AbortSignal): Promise<ApartmentDocument> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./apartment.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => { worker.terminate(); signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(signal?.reason ?? new DOMException('Cancelled', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ data?: ApartmentDocument; error?: string }>) => {
      cleanup();
      if (event.data.data) resolve(event.data.data);
      else reject(new Error(event.data.error ?? 'Appartement indisponible'));
    };
    worker.onerror = () => { cleanup(); reject(new Error('Le chargement de l’appartement a échoué.')); };
    worker.onmessageerror = () => { cleanup(); reject(new Error('Les données de l’appartement sont illisibles.')); };
    worker.postMessage({ url: new URL(url, window.location.href).href });
  });
}

const yieldTask = (): Promise<void> => {
  const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield(): Promise<void> } }).scheduler;
  return scheduler?.yield ? scheduler.yield() : new Promise(resolve => setTimeout(resolve, 0));
};

/** Geometry creation yields between small batches. Image loading stays async;
 * the source scene and its original material/door hierarchy remain unchanged. */
export async function parseApartmentScene(
  data: ApartmentDocument,
  resourcePath: string,
  signal?: AbortSignal,
  yieldWork: () => Promise<void> = yieldTask,
): Promise<THREE.Object3D> {
  const loader = new THREE.ObjectLoader().setResourcePath(resourcePath);
  const geometries: ReturnType<THREE.ObjectLoader['parseGeometries']> = {};
  let deadline = performance.now() + 3;
  let model: THREE.Object3D | undefined;
  try {
    for (const geometry of data.geometries ?? []) {
      signal?.throwIfAborted();
      Object.assign(geometries, loader.parseGeometries([geometry]));
      if (performance.now() >= deadline) { await yieldWork(); deadline = performance.now() + 3; }
    }
    loader.parseGeometries = () => geometries;
    await yieldWork(); signal?.throwIfAborted();
    model = await loader.parseAsync(data);
    signal?.throwIfAborted();
    return model;
  } catch (error) {
    Object.values(geometries).forEach(geometry => geometry.dispose());
    model?.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
        material.dispose();
      }
    });
    throw error;
  }
}

export async function loadApartmentScene(url: string, signal?: AbortSignal): Promise<THREE.Object3D> {
  const data = await loadApartmentDocument(url, signal);
  return parseApartmentScene(data, url.slice(0, url.lastIndexOf('/') + 1), signal);
}
