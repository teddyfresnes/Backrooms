import { ensureDeliveryAssets } from './unpack-assets.mjs';
ensureDeliveryAssets();
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('MANIFEST-SHA256.json', root), 'utf8'));
let errors = 0;
for (const [name, expected] of Object.entries(manifest.files)) {
  try {
    const hash = createHash('sha256').update(readFileSync(path.join(fileURLToPath(root), name))).digest('hex');
    if (hash !== expected) { console.error(`MODIFIE OU CORROMPU : ${name}`); errors++; }
  } catch { console.error(`ABSENT : ${name}`); errors++; }
}
console.log(`${Object.keys(manifest.files).length} fichiers controles ; ${errors} erreur(s).`);
process.exitCode = errors ? 1 : 0;
