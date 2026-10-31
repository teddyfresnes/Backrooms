import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const baseline = process.argv[2];
if (!baseline) throw new Error('Pass the previous source checkout.');
mkdirSync('.vertical-audit', { recursive: true });
const output = resolve('.vertical-audit/liminal-preservation.mjs'), path = (root, p) => JSON.stringify(resolve(root, p));
await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
import {createHash} from 'node:crypto';
import {planSpatialFeature} from './src/world/SpatialFeatures';
import {planSpatialFeature as beforeFeature} from ${path(baseline, 'src/world/SpatialFeatures.ts')};
import {regionalDatum, regionalStyle, regionalAtrium, spatialCellBounds} from './src/world/RegionalPlan';
import {regionalDatum as beforeDatum, regionalStyle as beforeStyle, regionalAtrium as beforeAtrium} from ${path(baseline, 'src/world/RegionalPlan.ts')};
import {getEpicStructureSlotsForMacro} from './src/world/EpicStructures';
import {generateInfiniteChunk} from './src/world/InfiniteWorld';
import {generateInfiniteChunk as beforeWorld} from ${path(baseline, 'src/world/InfiniteWorld.ts')};
import {SeededRandom} from './src/world/SeededRandom';
import {rectArea} from './src/world/types';
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex'), errors = [], oldFamilies = {}, newFamilies = {}, newDepths = {};
let columns=0, retained=0, datums=0, added=0, atria=0;
for(let i=0;i<512;i++) {
 const seed='LIMINAL-PRESERVATION-'+Math.floor(i/8), x=i%8-4, z=Math.floor(i/8)%7-3;
 const story=new SeededRandom(seed+':legacy-column:v1:'+x+':'+z).int(0,15), bounds=spatialCellBounds(x,z);
 const old=beforeFeature(seed,x,z,story,bounds), now=planSpatialFeature(seed,x,z,story,bounds);columns++;
 if(old){retained++;oldFamilies[old.feature.kind]=(oldFamilies[old.feature.kind]??0)+1;if(hash(old)!==hash(now))errors.push({seed,x,z,story,reason:'historical proposal changed'});}
 else if(now){added++;newFamilies[now.feature.family]=(newFamilies[now.feature.family]??0)+1;newDepths[now.feature.depth]=(newDepths[now.feature.depth]??0)+1;}
 const d=regionalDatum(seed,x,z), b=beforeDatum(seed,x,z);datums++;
 if(hash(d)!==hash(b)||hash(regionalStyle(seed,d.id))!==hash(beforeStyle(seed,b.id)))errors.push({seed,x,z,reason:'datum/style changed'});
 const a=regionalAtrium(seed,x,z,story), ba=beforeAtrium(seed,x,z,story);
 if(!!a!==!!ba||a&&(a.owner!==ba.owner||a.lower!==ba.lower||a.anchorX!==ba.anchorX||a.anchorZ!==ba.anchorZ||a.cellsX!==ba.cellsX||a.cellsZ!==ba.cellsZ||a.perimeter!==ba.perimeter))errors.push({seed,x,z,reason:'atrium ownership changed'});
 if(a)atria++;
}
const monuments=[];
for(const slot of getEpicStructureSlotsForMacro('LIMINAL-EPIC-PRESERVATION',0,0)) {
 const owner={x:slot.x,z:slot.z,story:0}, a=generateInfiniteChunk('LIMINAL-EPIC-PRESERVATION',owner), b=beforeWorld('LIMINAL-EPIC-PRESERVATION',owner);
 const identical=hash(a)===hash(b);monuments.push({index:slot.index,owner,identical});if(!identical)errors.push({owner,reason:'monument changed'});
}
const actualBsp = {owners:0,walkableArea:0,bspArea:0,hallArea:0};
for(let i=0;i<32;i++) {
 const seed='LIMINAL-PRESERVATION-AREA-'+i, w=generateInfiniteChunk(seed,{x:i%3-1,z:Math.floor(i/3)%3-1,story:i%5-2});
 if(!w.spatial)continue;actualBsp.owners++;
 for(const s of w.topology.surfaces){const a=rectArea(s.bounds);actualBsp.walkableArea+=a;if(s.roomId?.includes('/bsp/'))actualBsp.bspArea+=a;if(s.roomId?.endsWith('/hall'))actualBsp.hallArea+=a;}
}
console.log(JSON.stringify({baseline:${JSON.stringify(resolve(baseline))},columns,retained,oldFamilies,added,newFamilies,newDepths,datums,atria,monuments,actualBsp,errors},null,2));
if(errors.length)process.exitCode=1;
` }, outfile: output, bundle: true, platform: 'node', format: 'esm', packages: 'external' });
const child = spawnSync(process.execPath, [output], { stdio: 'inherit' }); process.exitCode = child.status ?? 1;
