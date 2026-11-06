import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

mkdirSync('.asset-cache', { recursive: true });
await build({ entryPoints: ['src/wardrobe/studio/makehuman/MhcloRuntime.ts'], outfile: '.asset-cache/verify-mhclo.mjs',
  bundle: true, packages: 'external', platform: 'node', format: 'esm' });
const { parseObjTopology, parseMhclo } = await import(pathToFileURL(path.resolve('.asset-cache/verify-mhclo.mjs')).href);
const entries = JSON.parse(readFileSync('dist/assets/hosted-wardrobe.json', 'utf8'));
let objects = 0, clothing = 0;
for (const entry of entries) {
  if (entry.source !== entry.url) assert(!existsSync(`dist${entry.source}`), `Duplicate source: ${entry.source}`);
  const raw = readFileSync(`public${entry.source}`);
  const original = entry.source.endsWith('.gz') ? gunzipSync(raw) : raw;
  const hosted = gunzipSync(readFileSync(`dist${entry.url}`));
  if (entry.topologyOnly) {
    assert.deepEqual(parseObjTopology(hosted.toString()), parseObjTopology(original.toString()), entry.source);
    objects++;
  } else {
    assert.deepEqual(hosted, original, entry.source);
    assert.deepEqual(parseMhclo(hosted.toString()), parseMhclo(original.toString()));
    clothing++;
  }
}
const manifest = JSON.parse(readFileSync('dist/assets/characters/assets-manifest.json', 'utf8'));
function visit(value) {
  if (typeof value === 'string' && value.startsWith('/assets/')) assert(readFileSync(`dist${value}`).length > 0, value);
  else if (value && typeof value === 'object') for (const child of Object.values(value)) visit(child);
}
visit(manifest);
console.log(JSON.stringify({ wardrobeObjectsVerified: objects, clothingFilesLossless: clothing, manifestAssetsPresent: true }));
