import { Window } from 'happy-dom';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { resolveObjectURL } from 'node:buffer';

const root = process.cwd();
const out = path.join(root, 'artifact-preview/output');
mkdirSync(out, { recursive: true });
const window = new Window();
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLImageElement = window.HTMLImageElement;
globalThis.HTMLCanvasElement = window.HTMLCanvasElement;
let captureImages = false;
let imageJobs = [];
THREE.TextureLoader.prototype.load = function (url) {
  const texture = new THREE.Texture();
  if (captureImages && url.startsWith('blob:')) {
    const blob = resolveObjectURL(url);
    if (blob) imageJobs.push(blob.arrayBuffer().then(bytes => {
      const image = document.createElement('img');
      image.src = `data:${blob.type || 'image/png'};base64,${Buffer.from(bytes).toString('base64')}`;
      texture.image = image;
    }));
  }
  return texture;
};
const loader = new FBXLoader();
const ready = JSON.parse(readFileSync('public/.character-assets-ready.json', 'utf8'));
const assets = {};
const bareHierarchy = object => ({
  name: object.name,
  bone: !!object.isBone,
  p: object.position.toArray(), q: object.quaternion.toArray(), s: object.scale.toArray(),
  children: object.children.filter(o => !o.isMesh).map(bareHierarchy),
});
const packArray = (values, type = 'Float32Array') => ({ type, binary: Buffer.from(new globalThis[type](values).buffer).toString('base64') });
const packClips = clips => clips.map(clip => {
  const json = THREE.AnimationClip.toJSON(clip.clone().optimize());
  for (const track of json.tracks) {
    track.times = packArray(track.times);
    track.values = packArray(track.values);
  }
  return json;
});
for (const relative of ready.files) {
  const bytes = readFileSync(path.join(root, 'public', relative));
  if (relative.endsWith('.fbx')) {
    captureImages = relative === 'assets/character/character.fbx';
    imageJobs = [];
    const object = loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    await Promise.all(imageJobs);
    if (relative === 'assets/character/character.fbx') {
      object.traverse(node => {
        if (!node.isMesh) return;
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          for (const key of Object.keys(material)) if (material[key]?.isTexture && !material[key].image) material[key] = null;
        }
      });
      const model = object.toJSON();
      for (const geometry of model.geometries ?? []) {
        for (const attr of Object.values(geometry.data?.attributes ?? {})) {
          attr.packed = packArray(attr.array, attr.type);
          delete attr.array;
        }
        if (geometry.data?.index) {
          const attr = geometry.data.index;
          attr.packed = packArray(attr.array, attr.type);
          delete attr.array;
        }
      }
      assets['/' + relative] = { model };
    } else {
      assets['/' + relative] = { hierarchy: bareHierarchy(object), clips: packClips(object.animations) };
    }
  } else if (relative.startsWith('assets/emotes/') && relative.endsWith('.json')) {
    const json = JSON.parse(bytes.toString());
    for (const track of json.tracks ?? []) {
      track.times = packArray(track.times);
      track.values = packArray(track.values);
    }
    assets['/' + relative] = { json };
  }
}
const text = JSON.stringify(assets);
const gzip = gzipSync(text, { level: 9 });
const encoded = gzip.toString('base64');
const parts = [];
for (let start = 0; start < encoded.length; start += 240_000) {
  const name = `data-${String(parts.length).padStart(3, '0')}.mjs`;
  writeFileSync(path.join(out, name), `export default ${JSON.stringify(encoded.slice(start, start + 240_000))};\n`);
  parts.push(name);
}
writeFileSync(path.join(out, 'preview-assets.mjs'), parts.map((name, i) => `import p${i} from './${name}';`).join('\n') + '\nexport default [' + parts.map((_, i) => 'p' + i).join(',') + "].join('');\n");
const summary = { sourceCommit: '5b6194362753a4363d1f65a36e22e3d9200622a7', assets: Object.keys(assets).length, fbx: Object.values(assets).filter(a => a.clips || a.model).length, jsonBytes: Buffer.byteLength(text), gzipBytes: gzip.length, gzipSha256: createHash('sha256').update(gzip).digest('hex'), parts: parts.length, embeddedMaterialTextures: assets['/assets/character/character.fbx'].model.images?.length ?? 0, bloodTextures: 'existing-procedural-fallback', animationResampling: false };
writeFileSync(path.join(out, 'provenance.json'), JSON.stringify(summary, null, 2) + '\n');
writeFileSync(path.join(out, 'assets-check.json'), JSON.stringify({ paths: Object.keys(assets), characterRoot: assets['/assets/character/character.fbx'].model.object.type }));
console.log(JSON.stringify(summary));
