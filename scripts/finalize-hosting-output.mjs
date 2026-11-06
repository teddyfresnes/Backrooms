import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve('dist');
const motion = JSON.parse(readFileSync(path.join(root, 'assets/character-motion.json'), 'utf8'));
const wardrobe = JSON.parse(readFileSync(path.join(root, 'assets/hosted-wardrobe.json'), 'utf8'));
const redundant = [...motion.paths];
// Keep the final pass authoritative even if a copy writer completed after the
// initial prune. The source apartment is retained in Git; its verified runtime
// pack already includes the existing small-prop preparation.
const apartmentSource = JSON.parse(readFileSync('public/assets/imported-apartment/apartment.parts.json', 'utf8'));
const apartmentRuntime = JSON.parse(readFileSync(path.join(root, 'assets/imported-apartment/apartment.runtime.parts.json'), 'utf8'));
assert.equal(apartmentSource.sourceSha256, apartmentRuntime.sourceSha256);
for (const part of apartmentSource.parts) {
  assert(/^apartment-\d{3}\.bin$/.test(part.file));
  redundant.push(`/assets/imported-apartment/${part.file}`);
}
// These two repository PNGs have pixel-identical hosted WebP variants.
const textures = JSON.parse(readFileSync('docs/validation/hosting-lossless-textures.json', 'utf8'));
for (const entry of textures.textures) {
  assert(entry.pixelsIdentical && existsSync(path.join(root, entry.runtime)));
  redundant.push(entry.source);
}
for (const entry of wardrobe) {
  assert(existsSync(path.join(root, entry.url)), `Missing packed wardrobe file: ${entry.url}`);
  if (entry.source !== entry.url) redundant.push(entry.source);
}
let removed = 0;
// Copy tools may leave a random-suffixed partial beside a known source asset.
// Match only exact catalogue filenames, never arbitrary hidden files.
const copyFolders = new Map();
for (const url of [...motion.paths, ...wardrobe.flatMap(entry => [entry.source, entry.url])]) {
  const folder = path.dirname(path.join(root, url)), name = path.basename(url);
  if (!copyFolders.has(folder)) copyFolders.set(folder, new Set());
  copyFolders.get(folder).add(name);
  if (name.endsWith('.gz')) copyFolders.get(folder).add(name.slice(0, -3));
}
for (const [folder, originals] of copyFolders) {
  for (const name of readdirSync(folder)) {
    if (![...originals].some(original => name.startsWith(`.${original}.`)
      && /^[A-Za-z0-9.]+$/.test(name.slice(original.length + 2)))) continue;
    rmSync(path.join(folder, name)); removed++;
  }
}
// Interrupted checkout/copy operations can leave a partial chunk alongside
// the real apartment part. These random-suffixed files are never runtime URLs.
for (const [directory, temporaryName] of [
  ['assets/imported-apartment', /^\.apartment-\d{3}\.bin(?:\.[A-Za-z0-9]+)+$/],
  ['assets/stairwell-mailbox', /^\.old_soviet_mailbox\.glb\.[A-Za-z0-9]+$/],
  ['assets/textures/polyhaven/vintage_cabinet_01', /^\.vintage_cabinet_01\.bin\.[A-Za-z0-9]+$/],
]) {
  const folder = path.join(root, directory);
  for (const name of readdirSync(folder)) {
    if (!temporaryName.test(name)) continue;
    rmSync(path.join(folder, name));
    removed++;
  }
}
// Public files outside the wardrobe catalogue can also acquire a copy-tool
// partial. Remove it only when its exact original exists in public source.
// This touches build output only, and never an arbitrary hidden source file.
function removeVerifiedPartials(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { removeVerifiedPartials(file); continue; }
    const match = entry.name.match(/^\.(.+\.(?:obj|mhclo|fbx|bin|glb)(?:\.gz)?)\.[A-Za-z0-9.]+$/);
    if (!match) continue;
    const original = path.join('public', path.relative(root, directory), match[1]);
    if (existsSync(original)) { rmSync(file); removed++; }
  }
}
removeVerifiedPartials(path.join(root, 'assets'));
// Run after every output writer has finished, including separate build tools.
// All of these source copies are represented by the verified runtime packs.
for (const url of redundant) {
  assert(url.startsWith('/assets/') && !url.includes('..') && !url.includes('\\'));
  assert.notEqual(url, '/assets/character/character.fbx');
  const file = path.join(root, url);
  if (existsSync(file)) removed++;
  rmSync(file, { force: true });
}
for (const url of redundant) assert(!existsSync(path.join(root, url)), `Duplicate source remains: ${url}`);
// Runtime consumers parse these attribution documents as JSON. Compact only
// whitespace, preserving every credit and leaving all binary assets untouched.
let creditBytesSaved = 0;
for (const url of ['assets/licenses.json', 'assets/characters/MATERIALS_CREDITS.json',
  'assets/characters/hair/HAIR_CREDITS.json', 'assets/characters/clothes/makehuman/CLOTHING_CREDITS.json',
  'assets/hosted-wardrobe.json', 'assets/character-motion.json']) {
  const file = path.join(root, url); if (!existsSync(file)) continue;
  const original = readFileSync(file, 'utf8'), data = JSON.parse(original), compact = JSON.stringify(data);
  assert.deepEqual(JSON.parse(compact), data);
  writeFileSync(file, compact); creditBytesSaved += Buffer.byteLength(original) - Buffer.byteLength(compact);
}
// glTF is JSON metadata around unchanged binary buffers and texture URLs.
// Remove formatting only; parsed nodes, accessors and credits must stay exact.
function compactGltf(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) compactGltf(file);
    else if (entry.isFile() && entry.name.endsWith('.gltf')) {
      const original = readFileSync(file, 'utf8'), data = JSON.parse(original), compact = JSON.stringify(data);
      assert.deepEqual(JSON.parse(compact), data);
      writeFileSync(file, compact); creditBytesSaved += Buffer.byteLength(original) - Buffer.byteLength(compact);
    }
  }
}
compactGltf(path.join(root, 'assets'));
console.log(`Removed ${removed} redundant source copies from the hosting output.`);
console.log(`Compacted JSON metadata by ${creditBytesSaved} bytes without changing its content.`);
