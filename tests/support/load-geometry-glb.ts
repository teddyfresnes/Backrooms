import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Preserve all real geometry/transforms; omit textures for Node-only checks. */
export async function loadGeometryGlb(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), length = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
  json.images = []; json.textures = []; json.materials = [];
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  const text = new TextEncoder().encode(JSON.stringify(json)), padded = (text.length + 3) & ~3;
  const binary = bytes.subarray(28 + length), total = 28 + padded + binary.length, glb = new Uint8Array(total), header = new DataView(glb.buffer);
  glb.fill(32, 20, 20 + padded);
  header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, total, true);
  header.setUint32(12, padded, true); header.setUint32(16, 0x4e4f534a, true); glb.set(text, 20);
  header.setUint32(20 + padded, binary.length, true); header.setUint32(24 + padded, 0x004e4942, true); glb.set(binary, 28 + padded);
  return (await new GLTFLoader().parseAsync(glb.buffer, '')).scene;
}
