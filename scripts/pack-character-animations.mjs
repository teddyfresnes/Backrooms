import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { Window } from 'happy-dom';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { ensureCharacterAssets } from './unpack-character-assets.mjs';

ensureCharacterAssets();
const ready = JSON.parse(readFileSync('public/.character-assets-ready.json', 'utf8'));
const packedPath = 'public/assets/character-motion.bin';
const manifestPath = 'public/assets/character-motion.json';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const wardrobeFiles = ['OffensiveIdle.fbx', 'BreathingIdle.fbx', 'LookingAround.fbx'].map(file => `assets/characters/animations/${file}`);
const sourceSha256 = hash(ready.sha256 + wardrobeFiles.map(file => hash(readFileSync(`public/${file}`))).join(''));
if (existsSync(packedPath) && existsSync(manifestPath)) {
  const previous = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (previous.version === 2 && previous.sourceSha256 === sourceSha256
    && previous.sha256 === hash(readFileSync(packedPath))) process.exit(0);
}

const window = new Window();
globalThis.window = window;
globalThis.document = window.document;
// Animation FBXs repeat the character mesh and textures. Only their bone
// hierarchy and original clip data are used by CharacterRuntime.
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
const loader = new FBXLoader();
const hierarchy = object => ({
  name: object.name,
  bone: !!object.isBone,
  p: object.position.toArray(),
  q: object.quaternion.toArray(),
  s: object.scale.toArray(),
  children: object.children.filter(child => !child.isMesh).map(hierarchy),
});
const array = values => Buffer.from(new Float32Array(values).buffer).toString('base64');
const assets = {};
for (const relative of [...ready.files, ...wardrobeFiles]) {
  if (relative.endsWith('.fbx') && relative !== 'assets/character/character.fbx') {
    const bytes = readFileSync(`public/${relative}`);
    const object = loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    const clips = object.animations.map(clip => {
      const json = THREE.AnimationClip.toJSON(clip.clone().optimize());
      for (const track of json.tracks) {
        track.times = array(track.times);
        track.values = array(track.values);
      }
      return json;
    });
    assets[`/${relative}`] = { hierarchy: hierarchy(object), clips };
    object.traverse(node => {
      if (!node.isMesh) return;
      node.geometry.dispose();
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose();
    });
  } else if (relative.startsWith('assets/emotes/') && relative.endsWith('.json')) {
    assets[`/${relative}`] = { json: JSON.parse(readFileSync(`public/${relative}`, 'utf8')) };
  }
}
const packed = gzipSync(JSON.stringify({ version: 1, assets }), { level: 9 });
writeFileSync(packedPath, packed);
writeFileSync(manifestPath, JSON.stringify({
  version: 2, sourceSha256, sha256: hash(packed), bytes: packed.length,
  animations: Object.values(assets).filter(asset => asset.clips).length,
  emotes: Object.values(assets).filter(asset => asset.json).length,
  paths: Object.keys(assets),
}, null, 2) + '\n');
console.log(`Animations prepared without duplicate meshes: ${Object.keys(assets).length} assets, ${packed.length} bytes.`);
