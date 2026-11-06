import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { Window } from 'happy-dom';

const inputs=process.argv.slice(2);
if(inputs.length!==2)throw new Error('Usage: node scripts/pack-entry-animations.mjs <Entering Code.fbx> <Opening Door Inwards.fbx>');
globalThis.window=new Window();globalThis.document=window.document;
THREE.TextureLoader.prototype.load=()=>new THREE.Texture();
const loader=new FBXLoader(), assets={}, sources=[];
for(const [index,file] of inputs.entries()){
  const bytes=readFileSync(file), root=loader.parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const clip=root.animations[0];if(!clip)throw new Error(`Missing animation: ${file}`);
  const id=index===0?'code':'door', hips=root.getObjectByName('mixamorigHips');
  if(!hips)throw new Error('Missing source hips');
  const json=THREE.AnimationClip.toJSON(clip.clone().optimize());delete json.uuid;json.name=`Arrival_${id}`;
  const floatBytes=values=>Buffer.from(new Float32Array(values).buffer).toString('base64');
  for(const track of json.tracks){track.times=floatBytes(track.times);track.values=floatBytes(track.values);}
  assets[id]={clip:json,hipsRest:hips.position.toArray()};
  sources.push({id,source:file.split('/').at(-1),source_sha256:createHash('sha256').update(bytes).digest('hex'),duration:clip.duration,tracks:clip.tracks.length});
  root.traverse(object=>{if(!object.isMesh)return;object.geometry.dispose();for(const material of Array.isArray(object.material)?object.material:[object.material])material.dispose();});
}
const packed=gzipSync(JSON.stringify({version:1,assets}),{level:9});
mkdirSync('public/assets/cinematics',{recursive:true});
writeFileSync('public/assets/cinematics/entry-motion.bin',packed);
writeFileSync('docs/validation/entry-animation-assets.json',JSON.stringify({user_provided:true,source_meshes_excluded:true,encoding:'Original Float32 tracks; redundant keys optimized, base64 arrays, gzip.',runtime:'assets/cinematics/entry-motion.bin',bytes:packed.length,sha256:createHash('sha256').update(packed).digest('hex'),sources},null,2)+'\n');
console.log(JSON.stringify({bytes:packed.length,sources}));
