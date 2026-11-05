// @ts-expect-error Node builtins are restricted to tests.
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';

let template: Promise<THREE.Object3D> | undefined;
/** The public repository apartment geometry, with inert materials instead of
 * network image loading. Useful for collision tests, never for visual QA. */
export async function loadApartmentModel(assetBase?: URL): Promise<THREE.Object3D> {
  template ??= (async () => {
    const base = assetBase ?? new URL('../../public/assets/imported-apartment/', import.meta.url);
    const data = JSON.parse(await readFile(new URL('apartment.json', base), 'utf8'));
    const loader = new THREE.ObjectLoader(), geometries = loader.parseGeometries(data.geometries ?? []);
    const materials: Record<string, THREE.Material> = {};
    for (const material of (data.materials ?? []) as { uuid: string }[]) materials[material.uuid] = new THREE.MeshStandardMaterial();
    const root = loader.parseObject(data.object, geometries, materials, {}); root.updateMatrixWorld(true); return root;
  })();
  return (await template).clone(true);
}
