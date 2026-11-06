// @ts-expect-error Node builtins are restricted to tests.
import { readFile } from 'node:fs/promises';
// @ts-expect-error Node builtins are restricted to tests.
import { gunzipSync } from 'node:zlib';
import * as THREE from 'three';
import { decodeApartmentBinary } from '../../src/apartment/ApartmentBinary';
import { transferredGeometry } from '../../src/apartment/TransferredGeometry';

let template: Promise<THREE.Object3D> | undefined;
/** The exact published apartment geometry, with inert materials instead of
 * network image loading. Useful for collision tests, never for visual QA. */
export async function loadApartmentModel(assetBase?: URL): Promise<THREE.Object3D> {
  template ??= (async () => {
    const base = assetBase ?? new URL('../../public/assets/imported-apartment/', import.meta.url);
    const manifest = JSON.parse(await readFile(new URL('apartment.runtime.parts.json', base), 'utf8')) as { parts: { file: string }[] };
    const parts = await Promise.all(manifest.parts.map(part => readFile(new URL(part.file, base))));
    const bytes = gunzipSync(new Uint8Array(await new Blob(parts).arrayBuffer()));
    const data = decodeApartmentBinary(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const loader = new THREE.ObjectLoader(), geometries: ReturnType<THREE.ObjectLoader['parseGeometries']> = {}, materials: Record<string, THREE.Material> = {};
    for (const source of data.geometries ?? []) {
      const geometry = transferredGeometry(source);
      if (geometry) geometries[geometry.uuid] = geometry; else Object.assign(geometries, loader.parseGeometries([source]));
    }
    for (const material of (data.materials ?? []) as { uuid: string }[]) materials[material.uuid] = new THREE.MeshStandardMaterial();
    const root = loader.parseObject(data.object, geometries, materials, {}); root.updateMatrixWorld(true); return root;
  })();
  return (await template).clone(true);
}
