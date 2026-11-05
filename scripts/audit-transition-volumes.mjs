import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
mkdirSync('.fall-audit',{recursive:true});
await build({entryPoints:['scripts/audit-transition-volumes.ts'],outfile:'.fall-audit/volumes.mjs',bundle:true,platform:'node',format:'esm',packages:'external',
  plugins:[{name:'rapier-headless',setup(b){b.onResolve({filter:/^@dimforge\/rapier3d$/},()=>({path:resolve('tests/character/support/rapier-headless.mjs')}));}}]});
const child=spawnSync(process.execPath,['.fall-audit/volumes.mjs',...process.argv.slice(2)],{stdio:'inherit'});process.exitCode=child.status??1;
