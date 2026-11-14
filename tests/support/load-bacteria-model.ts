// @ts-expect-error Node builtins are restricted to tests.
import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Actual creature geometry and skeleton, without network textures. */
export async function loadBacteriaModel() {
  const bytes = await readFile(new URL('../../public/assets/bacteria/bacteria.glb', import.meta.url));
  const jsonLength = bytes.readUInt32LE(12);
  const data = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  data.buffers[0].uri = 'data:application/octet-stream;base64,' + bytes.subarray(28 + jsonLength).toString('base64');
  data.images = []; data.textures = [];
  data.materials = data.materials.map((material: { name: string }) => ({ name: material.name }));
  return (await new GLTFLoader().parseAsync(JSON.stringify(data), '')).scene;
}
