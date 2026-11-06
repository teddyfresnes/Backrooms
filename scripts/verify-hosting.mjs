import { createReadStream, readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { createGunzip, gunzipSync } from 'node:zlib';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve('dist');
const files=[];
function visit(dir) {
  for(const entry of readdirSync(dir,{withFileTypes:true})) {
    const file=path.join(dir,entry.name);
    if(entry.isDirectory()) visit(file);
    else {
      assert(entry.isFile(),'Only regular files may be deployed');
      const size=statSync(file).size;
      assert(!/^\.apartment-\d{3}\.bin(?:\.[A-Za-z0-9]+)+$/.test(entry.name),`Temporary copy in deployment: ${file}`);
      assert(!/^\.old_soviet_mailbox\.glb\.[A-Za-z0-9]+$/.test(entry.name),`Temporary mailbox copy in deployment: ${file}`);
      assert(!/^\.vintage_cabinet_01\.bin\.[A-Za-z0-9]+$/.test(entry.name),`Temporary cabinet copy in deployment: ${file}`);
      assert(!/^\..+\.(?:mhclo|obj|fbx)(?:\.gz)?\.[A-Za-z0-9.]+$/.test(entry.name),`Temporary character copy in deployment: ${file}`);
      assert(size<=25*1024*1024,`Asset exceeds static-hosting size: ${path.relative(root,file)}`);
      if(size<1024) assert(!readFileSync(file).toString().startsWith('version https://git-lfs.github.com/spec/v1'),`Unresolved LFS pointer: ${file}`);
      files.push({file,size});
    }
  }
}
visit(root);assert(files.length<=20000);
const totalBytes=files.reduce((sum,file)=>sum+file.size,0);
// The prologue frames and original-precision entry motion fit this bounded
// static budget; the publication archive is also checked below 256 MiB.
assert(totalBytes<=253*1024*1024,`Expanded deployment exceeds the hosting budget: ${totalBytes} bytes`);
const archiveFlag=process.argv.indexOf('--archive');
let expandedArchiveBytes;
if(archiveFlag!==-1) {
  const archive=process.argv[archiveFlag+1];
  assert(archive && existsSync(archive),'--archive requires an existing gzip tar archive');
  expandedArchiveBytes=0;
  for await(const chunk of createReadStream(archive).pipe(createGunzip())) expandedArchiveBytes+=chunk.length;
  assert(expandedArchiveBytes<=256*1024*1024,`Expanded publication archive exceeds 256 MiB: ${expandedArchiveBytes} bytes`);
}
const html=readFileSync(path.join(root,'index.html'),'utf8');
for(const [,url] of html.matchAll(/(?:src|href)="(\/[^"#?]+)"/g)) assert(existsSync(path.join(root,url)),`Missing entry asset: ${url}`);
const playlist=JSON.parse(readFileSync(path.join(root,'assets/audio/music/playlist.json'),'utf8'));
assert(playlist.tracks.length>0,'Menu playlist must not be empty');
for(const url of playlist.tracks) {
  assert(url.startsWith('/assets/audio/music/')&&!url.includes('..')&&!url.includes('\\'));
  assert(existsSync(path.join(root,url)),`Missing menu music: ${url}`);
}
const motionManifest=JSON.parse(readFileSync(path.join(root,'assets/character-motion.json'),'utf8'));
const motionBytes=readFileSync(path.join(root,'assets/character-motion.bin'));
assert.equal(createHash('sha256').update(motionBytes).digest('hex'),motionManifest.sha256);
const motion=JSON.parse(gunzipSync(motionBytes));
assert.equal(motion.version,1);
assert.equal(motionManifest.animations,72);
assert.equal(motionManifest.emotes,10);
assert.deepEqual(Object.keys(motion.assets),motionManifest.paths);
for(const url of motionManifest.paths) assert(!existsSync(path.join(root,url)),`Redundant animation source in deployment: ${url}`);
assert(existsSync(path.join(root,'assets/character/character.fbx')));
const textures=JSON.parse(readFileSync('docs/validation/hosting-lossless-textures.json','utf8'));
for(const texture of textures.textures) {
  const bytes=readFileSync(path.join(root,texture.runtime));
  assert.equal(bytes.length,texture.runtimeBytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),texture.runtimeSha256);
  assert(texture.pixelsIdentical);
  assert(!existsSync(path.join(root,texture.source)));
}
const entryManifest=JSON.parse(readFileSync('docs/validation/entry-animation-assets.json','utf8'));
const entryBytes=readFileSync(path.join(root,entryManifest.runtime));
assert.equal(entryBytes.length,entryManifest.bytes);
assert.equal(createHash('sha256').update(entryBytes).digest('hex'),entryManifest.sha256);
const entryMotion=JSON.parse(gunzipSync(entryBytes));
assert.equal(entryMotion.version,1);
for(const source of entryManifest.sources) {
  assert.equal(entryMotion.assets[source.id].clip.duration,source.duration);
  assert.equal(entryMotion.assets[source.id].clip.tracks.length,source.tracks);
}
const base=path.join(root,'assets/imported-apartment');
const manifest=JSON.parse(readFileSync(path.join(base,'apartment.runtime.parts.json')));
const packedHash=createHash('sha256');
async function* parts() {
  for(const part of manifest.parts) {
    const partHash=createHash('sha256');let size=0;
    for await(const chunk of createReadStream(path.join(base,part.file))) {
      partHash.update(chunk);packedHash.update(chunk);size+=chunk.length;yield chunk;
    }
    assert.equal(size,part.bytes);assert.equal(partHash.digest('hex'),part.sha256);
  }
}
const originalHash=createHash('sha256');let originalBytes=0;
for await(const chunk of Readable.from(parts()).pipe(createGunzip())) {originalHash.update(chunk);originalBytes+=chunk.length;}
assert.equal(originalHash.digest('hex'),manifest.runtimeSha256);
assert.equal(packedHash.digest('hex'),manifest.compressedSha256);
assert.equal(originalBytes,manifest.bytes);
assert.equal(manifest.encoding,'apartment-binary-v1');
const apartmentSource = JSON.parse(readFileSync('public/assets/imported-apartment/apartment.parts.json'));
for (const part of apartmentSource.parts) assert(!existsSync(path.join(base,part.file)), 'Redundant source apartment download');
assert.equal(manifest.sourceSha256,'1b1864ff763676e6fa4bc0b66e0ae2d854a7bf9ef3e61990d2c9f6fce7067dda');
console.log(JSON.stringify({staticFiles:files.length,totalBytes,expandedArchiveBytes,maxFileBytes:Math.max(...files.map(f=>f.size)),apartmentRuntimeBytes:originalBytes,apartmentPackVerified:true,sourceIdentityVerified:true,entryAssetsPresent:true}));
