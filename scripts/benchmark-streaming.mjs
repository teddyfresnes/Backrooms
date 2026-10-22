import { build } from 'esbuild';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Optional source root permits the same harness to measure an older checkout.
const sourceRoot = resolve(process.argv[2] ?? '.'), output = resolve('.vertical-audit/stream-mount-benchmark.mjs');
mkdirSync(resolve('.vertical-audit'), { recursive: true });
const file = path => JSON.stringify(resolve(sourceRoot, path));
const prepared = existsSync(resolve(sourceRoot, 'src/render/SpatialArchitectureBuffers.ts'));
await build({ stdin: { contents: `
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { generateInfiniteChunk, clearInfiniteWorldCaches } from ${file('src/world/InfiniteWorld.ts')};
import { bakeRegionalLightData } from ${file('src/render/RegionalLighting.ts')};
import { WorldView } from ${file('src/render/WorldBuilder.ts')};
${prepared ? `import { prepareSpatialArchitecture } from ${file('src/render/SpatialArchitectureBuffers.ts')};` : 'const prepareSpatialArchitecture = () => undefined;'}
const results = [], seeds = Array.from({ length: 24 }, (_, i) => 'VERTICAL-PROMPT-AUDIT-' + i);
const materials = Object.fromEntries(['wall','plaster','floor','ceiling','baseboard','pitWall','pitBottom','metal','fixtureFrame','fixtureGlow','void']
  .map(name => [name, name === 'fixtureGlow' || name === 'void' ? new THREE.MeshBasicMaterial() : new THREE.MeshStandardMaterial()]));
for (const seed of seeds) {
  clearInfiniteWorldCaches();
  const start = performance.now(), plan = generateInfiniteChunk(seed, { x: -1, z: 1, story: 0 });
  const generationMs = performance.now() - start, hash = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  const bakeStart = performance.now(), regionalLightData = plan.spatial ? bakeRegionalLightData(plan) : undefined;
  const lightBakeMs = performance.now() - bakeStart, prepareStart = performance.now(), architectureData = plan.spatial ? prepareSpatialArchitecture(plan) : undefined;
  const workerGeometryMs = performance.now() - prepareStart, mountStart = performance.now();
  const view = new WorldView({ ...plan, propPlacements: [] }, materials, { regionalLightData, architectureData, architectureOnly: true });
  await view.ready; const mainThreadMountMs = performance.now() - mountStart;
  let triangles=0,batches=0,architectureBytes=0;
  view.group.traverse(o=> { if(o instanceof THREE.Mesh){ const n=o.geometry.index?.count??o.geometry.getAttribute('position')?.count??0;
    triangles+=n/3*(o instanceof THREE.InstancedMesh?o.count:1);if(n)batches++; }});
  for(const b of architectureData??[]) for(const name of ['position','normal','uv','color']) architectureBytes+=b[name].byteLength;
  results.push({seed,hash,generationMs,lightBakeMs,workerGeometryMs,mainThreadMountMs,triangles,batches,architectureBytes,colliders:plan.colliders.length});
  view.dispose(); globalThis.gc?.();
}
Object.values(materials).forEach(m=>m.dispose());
const summary = values => { const a=[...values].sort((a,b)=>a-b);return {median:a[Math.floor(a.length/2)],p95:a[Math.ceil(a.length*.95)-1]};};
console.log(JSON.stringify({preparedGeometry:${prepared},sourceRoot:${JSON.stringify(sourceRoot)},node:process.version,
  summary:Object.fromEntries(['generationMs','lightBakeMs','workerGeometryMs','mainThreadMountMs','triangles','batches','architectureBytes','colliders'].map(k=>[k,summary(results.map(r=>r[k]))])),results,
  limitation:'CPU proxy: no browser scheduling, real asset textures/props, GPU uploads, shader compilation or FPS measurement. Geometry preparation is timed separately as work executed by infinite.worker in production.'},null,2));
`, resolveDir: sourceRoot, loader: 'ts' }, outfile: output, bundle: true, platform: 'node', format: 'esm', packages: 'external' });
const child=spawnSync(process.execPath,['--expose-gc',output],{stdio:'inherit'});process.exitCode=child.status??1;
