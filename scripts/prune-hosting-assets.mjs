import { readFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const root = path.resolve('dist');
const manifest = JSON.parse(readFileSync(path.join(root, 'assets/character-motion.json'), 'utf8'));
const motionBytes = readFileSync(path.join(root, 'assets/character-motion.bin'));
assert.equal(createHash('sha256').update(motionBytes).digest('hex'), manifest.sha256);
for (const url of manifest.paths) {
  assert(/^\/assets\/(character\/[^/]+\.fbx|characters\/animations\/[^/]+\.fbx|emotes\/[^/]+\.json)$/.test(url));
  assert.notEqual(url, '/assets/character/character.fbx');
  rmSync(path.join(root, url), { force: true });
}
assert(existsSync(path.join(root, 'assets/character/character.fbx')));
console.log(`Omitted ${manifest.paths.length} source animation files already included in the motion pack.`);

const wardrobePath = path.join(root, 'assets/characters/assets-manifest.json');
const wardrobe = JSON.parse(readFileSync(wardrobePath, 'utf8'));
const replacements = new Map();
const packed = new Map();
function pack(url, topologyOnly) {
  if (packed.has(url)) return;
  const source = path.join(root, url);
  const bytes = readFileSync(source);
  const plain = url.endsWith('.gz') ? gunzipSync(bytes) : bytes;
  // MakeHuman derives all positions from the fitted body. Its OBJ reader uses
  // only vertex count, texture coordinates and face indices. Keep those exact;
  // omit unused source coordinates, normals and material statements.
  const body = topologyOnly ? Buffer.from(plain.toString('utf8').split(/\r?\n/).flatMap(raw => {
    const line = raw.trim();
    return line.startsWith('v ') ? ['v 0 0 0'] : line.startsWith('vt ') || line.startsWith('f ') ? [line] : [];
  }).join('\n') + '\n') : plain;
  const destination = url.endsWith('.gz') ? url : `${url}.gz`;
  const compressed = gzipSync(body, { level: 9 });
  assert.deepEqual(gunzipSync(compressed), body);
  writeFileSync(path.join(root, destination), compressed);
  if (destination !== url) replacements.set(url, destination);
  // A rebuilt/copied output may already reference its compressed sibling.
  // Keep verification anchored to the actual source checkout on every pass.
  const plainSource = url.endsWith('.gz') ? url.slice(0, -3) : url;
  const originalUrl = !existsSync(path.join('public', url)) && existsSync(path.join('public', plainSource)) ? plainSource : url;
  packed.set(url, { source: originalUrl, url: destination, topologyOnly, originalBytes: plain.length, compressedBytes: compressed.length });
}
function visitAssets(value) {
  if (!value || typeof value !== 'object') return;
  if (value.sourceType === 'mhclo') {
    if (value.objUrl) pack(value.objUrl, true);
    if (value.mhcloUrl) pack(value.mhcloUrl, false);
  }
  for (const child of Object.values(value)) visitAssets(child);
}
visitAssets(wardrobe);
function rewrite(value) {
  if (typeof value === 'string') return replacements.get(value) ?? value;
  if (Array.isArray(value)) return value.map(rewrite);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrite(child)]));
  return value;
}
writeFileSync(wardrobePath, JSON.stringify(rewrite(wardrobe)));
writeFileSync(path.join(root, 'assets/hosted-wardrobe.json'), JSON.stringify([...packed.values()]));
// Remove sources after all compressed siblings have been written.
// Also cover manifests already using .gz when the checkout retains the plain
// original: that fallback is recorded in packed.source, not replacements.
for (const entry of packed.values()) if (entry.source !== entry.url) rmSync(path.join(root, entry.source), { force: true });
for (const url of manifest.paths) rmSync(path.join(root, url), { force: true });
console.log(`Compressed ${packed.size} wardrobe data files; fitted topology is unchanged.`);

// The runtime pack preserves the source geometry and metadata. Only its compact
// representation is needed by players; keep the original export in source Git.
const apartmentBase = path.join(root, 'assets/imported-apartment');
const sourceApartment = JSON.parse(readFileSync(path.join(apartmentBase, 'apartment.parts.json')));
const runtimeApartment = JSON.parse(readFileSync(path.join(apartmentBase, 'apartment.runtime.parts.json')));
assert.equal(runtimeApartment.sourceSha256, sourceApartment.sourceSha256);
for (const part of sourceApartment.parts) rmSync(path.join(apartmentBase, part.file), { force: true });
