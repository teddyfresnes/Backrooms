import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { brotliDecompressSync } from 'node:zlib';

const project = fileURLToPath(new URL('../', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
export function ensureCharacterAssets() {
  const manifest = JSON.parse(readFileSync(path.join(project, 'assets/character-assets.json'), 'utf8'));
  const packed = Buffer.concat(manifest.parts.map(name => readFileSync(path.join(project, 'assets/character', name))));
  if (hash(packed) !== manifest.sha256) throw new Error('Pack personnage corrompu ou incomplet.');
  const signature = hash(packed);
  const publicRoot = path.join(project, 'public');
  const marker = path.join(publicRoot, '.character-assets-ready.json');
  const safePath = name => {
    if (typeof name !== 'string' || !name || name.includes('\\') || name.includes('\0')) throw new Error('Chemin invalide dans le pack.');
    const target = path.resolve(publicRoot, name);
    if (!target.startsWith(publicRoot + path.sep)) throw new Error('Chemin hors du dossier public.');
    return target;
  };
  try {
    const ready = JSON.parse(readFileSync(marker, 'utf8'));
    if (ready.sha256 === signature && Array.isArray(ready.files) && ready.files.length
      && ready.files.every(name => existsSync(safePath(name)))) return;
  } catch { /* First launch or interrupted unpack: validate and restore below. */ }
  console.log('Préparation des modèles et animations du personnage...');
  const raw = brotliDecompressSync(packed);
  if (raw.length < 12 || raw.subarray(0, 8).toString() !== 'BRASSET1') throw new Error('Pack incomplet ou corrompu.');
  const headerLength = raw.readUInt32LE(8);
  if (headerLength > raw.length - 12) throw new Error('Entete du pack incomplet.');
  const index = JSON.parse(raw.subarray(12, 12 + headerLength).toString('utf8'));
  if (index.version !== 1 || !Array.isArray(index.files) || !index.files.length) throw new Error('Format du pack invalide.');
  const payload = raw.subarray(12 + headerLength);
  // Check every byte before installing anything. Each file then uses an atomic rename.
  const entries = index.files.map(entry => {
    if (!Number.isSafeInteger(entry.offset) || !Number.isSafeInteger(entry.size) || entry.offset < 0
      || entry.size < 0 || entry.offset + entry.size > payload.length) throw new Error('Fichier incomplet dans le pack.');
    const bytes = payload.subarray(entry.offset, entry.offset + entry.size);
    if (hash(bytes) !== entry.sha256) throw new Error(`Asset corrompu : ${entry.path}`);
    return { name: entry.path, target: safePath(entry.path), bytes };
  });
  for (const {target, bytes} of entries) {
    mkdirSync(path.dirname(target), {recursive:true});
    writeFileSync(target + '.unpack-tmp', bytes);
    renameSync(target + '.unpack-tmp', target);
  }
  writeFileSync(marker + '.tmp', JSON.stringify({sha256:signature, files:entries.map(e => e.name)}));
  renameSync(marker + '.tmp', marker);
  console.log(`${entries.length} assets restaures et verifies.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) ensureCharacterAssets();
