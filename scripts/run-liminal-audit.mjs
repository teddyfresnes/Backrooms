import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
mkdirSync('.vertical-audit', { recursive: true });
const output = resolve('.vertical-audit/liminal.mjs');
await build({ entryPoints: ['scripts/audit-liminal-architecture.ts'], outfile: output, bundle: true, platform: 'node', format: 'esm', packages: 'external' });
const child = spawnSync(process.execPath, [output, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exitCode = child.status ?? 1;
