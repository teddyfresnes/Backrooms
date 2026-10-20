import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = process.cwd(), output = resolve(root, '.vertical-audit/run.mjs');
mkdirSync(resolve(root, '.vertical-audit'), { recursive: true });
await build({ entryPoints: [resolve(root, 'scripts/audit-vertical.ts')], outfile: output, bundle: true,
  platform: 'node', format: 'esm', packages: 'external', plugins: [{ name: 'real-rapier-headless', setup(b) {
    b.onResolve({ filter: /^@dimforge\/rapier3d$/ }, () => ({ path: resolve(root, 'tests/character/support/rapier-headless.mjs') }));
  } }] });
const result = spawnSync(process.execPath, ['--expose-gc', output, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
