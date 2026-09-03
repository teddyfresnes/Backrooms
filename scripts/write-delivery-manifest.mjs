import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const names = [];
const collect = relative => {
  for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name.endsWith('.tmp')) continue;
    const name = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) collect(name);
    else if (entry.isFile()) names.push(name);
  }
};
for (const directory of ['src', 'tests', 'scripts', 'assets', 'public', 'dist', 'reference', '.openai']) collect(directory);
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (entry.isFile() && entry.name !== 'MANIFEST-SHA256.json'
    && (/\.(?:md|txt|json|html|bat)$/.test(entry.name) || entry.name === '.npmrc' || entry.name === '.gitignore')) names.push(entry.name);
}
const files = Object.fromEntries(names.sort().map(name => [name,
  createHash('sha256').update(readFileSync(path.join(root, name))).digest('hex')]));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
writeFileSync(path.join(root, 'MANIFEST-SHA256.json'), JSON.stringify({ release: `${pkg.name}@${pkg.version}`, files }, null, 2) + '\n');
console.log(`Manifest actualise : ${names.length} fichiers.`);
