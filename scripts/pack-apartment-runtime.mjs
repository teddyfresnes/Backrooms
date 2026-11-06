import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import * as THREE from 'three';
const base = 'public/assets/imported-apartment/';
const hash = data => createHash('sha256').update(data).digest('hex');
const sourceManifest = JSON.parse(readFileSync(base+'apartment.parts.json'));
const previousManifest=existsSync(base+'apartment.runtime.parts.json')?JSON.parse(readFileSync(base+'apartment.runtime.parts.json')):undefined;
const codecSha256 = hash(Buffer.concat(['src/apartment/ApartmentBinary.ts','src/apartment/ApartmentData.ts','src/apartment/SmallPropGeometry.ts','src/apartment/TransferredGeometry.ts','scripts/pack-apartment-runtime.mjs'].map(file=>readFileSync(file))));
if (existsSync(base+'apartment.runtime.parts.json')) {
  const current = JSON.parse(readFileSync(base+'apartment.runtime.parts.json'));
  if (current.sourceSha256 === sourceManifest.sourceSha256 && current.codecSha256 === codecSha256
    && current.parts.every(part=>existsSync(base+part.file)&&hash(readFileSync(base+part.file))===part.sha256)) {
    console.log('Verified existing apartment runtime pack.'); process.exit(0);
  }
  // The source export (apartment-00x.bin, ~90 MB) lives outside Git (see
  // docs/agents/APARTMENT_INTERACTIONS.md). Without it, keep the committed
  // runtime pack as long as its bytes are intact.
  if (!sourceManifest.parts.every(part=>existsSync(base+part.file))) {
    assert(current.sourceSha256 === sourceManifest.sourceSha256, 'Runtime pack does not match apartment.parts.json.');
    assert(current.parts.every(part=>existsSync(base+part.file)&&hash(readFileSync(base+part.file))===part.sha256), 'Apartment runtime pack is incomplete.');
    if (current.codecSha256 !== codecSha256) console.warn('Apartment codec changed but the source export is absent: restore it to regenerate the runtime pack.');
    console.log('Verified committed apartment runtime pack (source export not present).'); process.exit(0);
  }
}
mkdirSync('tmp', {recursive:true});
await build({entryPoints:['src/apartment/ApartmentBinary.ts','src/apartment/ApartmentData.ts','src/apartment/SmallPropGeometry.ts','src/apartment/TransferredGeometry.ts'],outdir:'tmp/apartment-pack',bundle:true,platform:'node',format:'esm',packages:'external'});
const {encodeApartmentBinary,decodeApartmentBinary} = await import('../tmp/apartment-pack/ApartmentBinary.js');
const {prepareApartmentTransfers} = await import('../tmp/apartment-pack/ApartmentData.js');
const {simplifySmallPropGeometry} = await import('../tmp/apartment-pack/SmallPropGeometry.js');
const {transferredGeometry} = await import('../tmp/apartment-pack/TransferredGeometry.js');
const original = sourceManifest;
const compressed = Buffer.concat(original.parts.map(part => readFileSync(base+part.file)));
assert.equal(hash(compressed),original.compressedSha256);
let t = performance.now();
const json = gunzipSync(compressed);
assert.equal(hash(json),original.sourceSha256);
const document = JSON.parse(json.toString());
prepareApartmentTransfers(document);
const beforeMs = performance.now()-t;
// Run the EXISTING <=1.4 mm small-prop preparation at build time, retaining
// authored hierarchy, identities, material definitions, UV seams and scale.
// Book/pot island extraction still consumes its untouched original geometry.
const sourceScene = JSON.stringify(document.object), sourceMaterials = JSON.stringify(document.materials);
const loader=new THREE.ObjectLoader(), inert=new THREE.MeshStandardMaterial();
const geometries=Object.fromEntries(document.geometries.map(source=>[source.uuid,transferredGeometry(source)]));
const materials=Object.fromEntries(document.materials.map(source=>[source.uuid,inert]));
const root=loader.parseObject(document.object,geometries,materials,{});root.updateMatrixWorld(true);
const excluded=new Set();
for(const name of ['flowerpot','books','books1'])root.getObjectByName(name)?.traverse(o=>{if(o.isMesh)excluded.add(o.geometry);});
const optimized=new Map(), sourceById=new Map(document.geometries.map(g=>[g.uuid,g]));
let preparedMeshes=0, savedVertices=0, preparationMs=performance.now();
root.traverse(mesh=>{
  if(!mesh.isMesh||excluded.has(mesh.geometry)||optimized.has(mesh.geometry))return;
  const original=mesh.geometry, geometry=simplifySmallPropGeometry(mesh);optimized.set(original,geometry);
  if(!geometry)return;
  const source=sourceById.get(original.uuid);
  savedVertices+=original.getAttribute('position').count-geometry.getAttribute('position').count;preparedMeshes++;
  source.userData={...source.userData,apartmentSmallPropPrepared:1};
  source.data={...source.data,
    attributes:Object.fromEntries(Object.entries(geometry.attributes).map(([key,a])=>[key,{type:a.array.constructor.name,itemSize:a.itemSize,normalized:a.normalized,array:a.array}])),
    index:{type:geometry.index.array.constructor.name,array:geometry.index.array},
    runtimeBounds:{min:geometry.boundingBox.min.toArray(),max:geometry.boundingBox.max.toArray()}};
});
preparationMs=performance.now()-preparationMs;
assert.equal(JSON.stringify(document.object),sourceScene);assert.equal(JSON.stringify(document.materials),sourceMaterials);
const binary = encodeApartmentBinary(document);
const packed = gzipSync(binary,{level:9});
const restored = gunzipSync(packed);
assert.deepEqual(decodeApartmentBinary(restored.buffer.slice(restored.byteOffset,restored.byteOffset+restored.byteLength)),document);
const parts=[];
for(let i=0;i<packed.length;i+=16*1024*1024){
  const block=packed.subarray(i,i+16*1024*1024),file=`apartment-runtime-${String(parts.length).padStart(3,'0')}.bin`;
  writeFileSync(base+file,block);parts.push({file,bytes:block.length,sha256:hash(block)});
}
const baselineTimings = [beforeMs];
for(let i=0;i<2;i++) {
  globalThis.gc?.();t=performance.now();
  const baseline=JSON.parse(gunzipSync(compressed).toString());prepareApartmentTransfers(baseline);
  baselineTimings.push(performance.now()-t);
}
const timings=[];
for(let i=0;i<3;i++){
  globalThis.gc?.();t=performance.now();const plain=gunzipSync(packed);
  const data=decodeApartmentBinary(plain.buffer.slice(plain.byteOffset,plain.byteOffset+plain.byteLength));
  // Runtime transfer list is unique even when several attributes share a buffer.
  assert.ok(data.geometries.length);timings.push(performance.now()-t);
}
const manifest={codecSha256,version:2,compression:'gzip',encoding:'apartment-binary-v1',bytes:binary.length,
  sourceSha256:original.sourceSha256,runtimeSha256:hash(binary),compressedSha256:hash(packed),parts};
writeFileSync(base+'apartment.runtime.parts.json',JSON.stringify(manifest,null,2)+'\n');
for(const part of previousManifest?.parts??[])if(/^apartment-runtime-\d{3}\.bin$/.test(part.file)&&!parts.some(next=>next.file===part.file)&&existsSync(base+part.file))unlinkSync(base+part.file);
const report={sourceBytes:json.length,beforeCompressedBytes:compressed.length,afterCompressedBytes:packed.length,
  runtimeBytes:binary.length,beforeDecodeAndPrepareMs:baselineTimings,afterDecodeMs:timings,
  runtimeRoundTripVerified:true,sceneAndMaterialsUnchanged:true,
  smallPropPreparation:{preparedMeshes,savedVertices,preparationMs,maxWorldDeviationMetres:.0014,replacesExistingRuntimeWork:true},
  scope:'Node CPU: gzip decode, document parse and typed geometry preparation; no network, WebGL or browser timing.'};
writeFileSync('docs/validation/apartment-runtime.json',JSON.stringify(report,null,2)+'\n');
console.log(report);
