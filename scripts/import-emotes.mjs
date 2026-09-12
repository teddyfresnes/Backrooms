import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/import-emotes.mjs <FBX folder>');
// Only animation channels are exported. Embedded images and source meshes are unnecessary.
globalThis.window = { URL: { createObjectURL: () => '' } };
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
const files = {
  greeting: 'Standing Greeting(1).fbx', clapping: 'Clapping(1).fbx',
  pointing: 'Pointing(1).fbx', salute: 'Salute(1).fbx',
  'hip-hop': 'Hip Hop Dancing(1).fbx', wave: 'Wave Hip Hop Dance(1).fbx',
  freeze: 'Breakdance Freeze Var 3(1).fbx', sweat: 'Wiping Sweat(1).fbx',
  laying: 'Male Laying Pose(1).fbx', 'kip-up': 'Kip Up(1).fbx',
};
const destination = new URL('../public/assets/emotes/', import.meta.url);
mkdirSync(destination, { recursive: true });
for (const [id, file] of Object.entries(files)) {
  const bytes = readFileSync(path.join(source, file));
  const rig = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const animation = rig.animations.find(clip => clip.tracks.length > 0 && clip.duration > 0);
  if (!animation) throw new Error(`Missing animation: ${file}`);
  let sourceHipRestY = 0;
  rig.traverse(bone => {
    if (bone.isBone && /hips$/i.test(bone.name) && bone.position.y > sourceHipRestY) sourceHipRestY = bone.position.y;
  });
  const tracks = animation.tracks.filter(track => track.name.endsWith('.quaternion') || /hips\.position$/i.test(track.name));
  const clip = new THREE.AnimationClip(`emote-${id}`, animation.duration, tracks).optimize();
  if (!sourceHipRestY || !tracks.length) throw new Error(`Invalid skeleton: ${file}`);
  writeFileSync(new URL(`${id}.json`, destination), JSON.stringify({ sourceHipRestY, clip: THREE.AnimationClip.toJSON(clip) },
    (_key, value) => typeof value === 'number' ? Math.round(value * 1e6) / 1e6 : value));
  console.log(`${id}: ${clip.duration.toFixed(2)}s, ${clip.tracks.length} tracks`);
}
