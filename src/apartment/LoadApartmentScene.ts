import type { LoadProgress } from '../core/LoadProgress';
import * as THREE from 'three';
import { transferredGeometry } from './TransferredGeometry';
import type { ApartmentDocument } from './ApartmentData';
import { ApartmentPreload } from './ApartmentPreload';
import { apartmentImageUrls } from './ApartmentImages';

export function loadApartmentDocument(url: string, signal?: AbortSignal): Promise<ApartmentDocument> {
  signal?.throwIfAborted();
  return new ApartmentPreload(url).take(signal);
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
  const releaseImages = apartmentImageUrls(data);
  try {
    for (const geometry of data.geometries ?? []) {
      signal?.throwIfAborted();
      const direct = transferredGeometry(geometry);
      if (direct) geometries[direct.uuid] = direct;
      else Object.assign(geometries, loader.parseGeometries([geometry]));
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
  } finally { releaseImages(); }
}

export async function loadApartmentScene(url: string, signal?: AbortSignal, preload?: ApartmentPreload, progress?: LoadProgress): Promise<THREE.Object3D> {
  const data = await (preload?.take(signal) ?? loadApartmentDocument(url, signal));
  progress?.start('scene');
  return parseApartmentScene(data, url.slice(0, url.lastIndexOf('/') + 1), signal);
}
