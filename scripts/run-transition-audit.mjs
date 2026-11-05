import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = process.cwd(), output = resolve(root, '.vertical-audit/transitions.mjs');
mkdirSync(resolve(root, '.vertical-audit'), { recursive: true });
await build({ entryPoints: [resolve(root, 'scripts/audit-transitions.ts')], outfile: output, bundle: true,
  platform: 'node', format: 'esm', packages: 'external' });
const result = spawnSync(process.execPath, [output, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
