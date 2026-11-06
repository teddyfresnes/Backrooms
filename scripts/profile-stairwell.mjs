import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.stairwell-profile.mjs');
await build({ entryPoints: [path.join(root, 'scripts/profile-stairwell.ts')], outfile: output,
  bundle: true, platform: 'node', format: 'esm', packages: 'external',
  alias: { '@dimforge/rapier3d': '@dimforge/rapier3d-compat' } });
const result = spawnSync(process.execPath, [output, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
