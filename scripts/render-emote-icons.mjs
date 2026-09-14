import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

// Offline projection of the actual avatar poses; no browser or GPU is needed.
const output = process.argv[2];
if (!output) throw new Error('Usage: node scripts/render-emote-icons.mjs <intermediate JSON>');
globalThis.window = { URL: { createObjectURL: () => '' } };
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
const bytes = fs.readFileSync(new URL('../public/assets/animation-lab/character.fbx', import.meta.url));
const rig = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
let hips;
rig.traverse(object => { if (object.isBone && /hips$/i.test(object.name)) hips = object; });
const rest = hips.position.clone();
const mixer = new THREE.AnimationMixer(rig);
const cameraForward = new THREE.Vector3(.17, .08, 1).normalize();
const cameraRight = new THREE.Vector3(0, 1, 0).cross(cameraForward).normalize();
const cameraUp = cameraForward.clone().cross(cameraRight).normalize();
const samples = { greeting: .28, clapping: .35, pointing: .45, salute: .38, 'hip-hop': .3, wave: .42, freeze: .6, sweat: .45, laying: .5, 'kip-up': .35 };
const frames = [];
for (const [name, sample] of Object.entries(samples)) {
  mixer.stopAllAction();
  const data = JSON.parse(fs.readFileSync(new URL(`../public/assets/emotes/${name}.json`, import.meta.url), 'utf8'));
  const clip = THREE.AnimationClip.parse(data.clip);
  const hipTrack = clip.tracks.find(track => /hips\.position$/i.test(track.name));
  for (let i = 0; i < hipTrack.values.length; i += 3) {
    hipTrack.values[i] = rest.x;
    hipTrack.values[i + 1] *= rest.y / data.sourceHipRestY;
    hipTrack.values[i + 2] = rest.z;
  }
  mixer.clipAction(clip).play();
  mixer.setTime(clip.duration * sample);
  rig.updateMatrixWorld(true);
  const vertices = [], triangles = [], point = new THREE.Vector3();
  rig.traverse(mesh => {
    if (!mesh.isMesh || !mesh.visible) return;
    const geometry = mesh.geometry, offset = vertices.length;
    for (let i = 0; i < geometry.attributes.position.count; i++) {
      mesh.getVertexPosition(i, point); point.applyMatrix4(mesh.matrixWorld);
      vertices.push([point.dot(cameraRight), point.dot(cameraUp), point.dot(cameraForward)]);
    }
    const index = geometry.index;
    const count = index ? index.count : geometry.attributes.position.count;
    for (let i = 0; i < count; i += 3) triangles.push([offset + (index ? index.getX(i) : i), offset + (index ? index.getX(i + 1) : i + 1), offset + (index ? index.getX(i + 2) : i + 2)]);
  });
  frames.push({ name, vertices, triangles });
}
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(frames, (_key, value) => typeof value === 'number' ? Math.round(value * 1e5) / 1e5 : value));
console.log(`${frames.length} poses projected.`);
