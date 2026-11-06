import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { generateInfiniteChunk, getChunkWorldOffset, clearInfiniteWorldCaches } from '../src/world/InfiniteWorld';
import { validateWorldPlan } from '../src/world/generateWorld';
import { prepareSpatialArchitecture, mountArchitectureBatch } from '../src/render/SpatialArchitectureBuffers';
import { auditAxisPlaneTriangles } from '../tests/support/geometry-audit';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { rectArea, rectCenter } from '../src/world/types';
import { surfaceY } from '../src/world/WalkableTopology';
import { ceilingFixturePose } from '../src/render/CeilingFixture';

const count=Number(process.argv[2]??64),out=process.argv[3]??'.fall-audit/transition-volumes.json';
if(!Number.isInteger(count)||count<1||count>512)throw Error('Expected 1..512 ordinary worlds.');
const errors:unknown[]=[],examples:Record<string,unknown>={},records:unknown[]=[];
const material=new THREE.MeshBasicMaterial();
try {
  for(const [corpus,total]of [['ORDINARY',count],['HOLDOUT',Math.ceil(count/2)]]as const){
    const policies:Record<string,number>={},enclosures:Record<string,number>={};
    let worlds=0,flights=0,probes=0,lamps=0,returns=0,bspArea=0,floorArea=0,maxBatches=0,triangles=0,minClearance=Infinity;
    for(let i=0;i<total;i++){
      const seed=`VOLUME-${corpus}-${i}`,coord={x:i%3-1,z:Math.floor(i/3)%3-1,story:i%5-2};
      clearInfiniteWorldCaches();const plan=generateInfiniteChunk(seed,coord);if(!plan.spatial)continue;worlds++;
      const issues=validateWorldPlan(plan);if(issues.length)errors.push({seed,coord,issues});
      const upper=generateInfiniteChunk(seed,{...coord,story:coord.story+1}),offset=getChunkWorldOffset(coord);
      const plans=[plan,upper],meshes=plans.flatMap((w,index)=>{
        const batches=prepareSpatialArchitecture(w);maxBatches=Math.max(maxBatches,batches.length);
        const built=batches.map(b=>({name:b.name,geometry:mountArchitectureBatch(b)})),audit=auditAxisPlaneTriangles(built);
        triangles+=audit.triangleCount;if(audit.errors.length)errors.push({seed,coord,owner:index,reason:'coplanar triangles',issues:audit.errors});
        return built.map(b=>{const m=new THREE.Mesh(b.geometry,material);m.name=b.name;m.position.set(offset.x,offset.y+index*5.4,offset.z);m.updateMatrixWorld();return m;});
      });
      const physics=await PhysicsWorld.create({...plan,colliders:[]}),retained=physics.world.colliders.len();
      try{
        physics.batchChunkChanges(()=>plans.forEach((w,index)=>physics.addChunk(String(index),w.colliders,getChunkWorldOffset(w.spatial!.owner))));
        const links=new Map<string,number>();
        for(const sf of plan.topology!.surfaces){floorArea+=rectArea(sf.bounds);if(sf.roomId?.includes('/bsp/'))bspArea+=rectArea(sf.bounds);}
        returns+=plan.spatial.prisms.filter(p=>p.id.includes('/open-slab-return-')).length;
        if(new Set(plan.colliders.map(c=>c.id)).size!==plan.colliders.length)errors.push({seed,reason:'duplicate collider IDs'});
        for(const t of plan.spatial.transitions??[]){
          flights++;policies[t.roofPolicy]=(policies[t.roofPolicy]??0)+1;enclosures[t.enclosure]=(enclosures[t.enclosure]??0)+1;
          links.set(t.linkId,(links.get(t.linkId)??0)+1);
          const p=rectCenter(t.run);
          examples[t.roofPolicy]??={seed,coord,id:t.id,position:{x:p.x+offset.x,z:p.z+offset.z,y:surfaceY({bounds:t.run,profile:t.profile}as never,p.x,p.z)+offset.y+.865}};
          if(plan.spatial.ceilings.some(s=>s.id===t.id+'/roof')!==(t.roofPolicy==='flight'))errors.push({seed,id:t.id,reason:'independent roof policy'});
          if(t.roofPolicy==='upper-slab'&&!plan.spatial.dependencies.some(d=>d.owner.story===coord.story+1&&d.reason==='stairs'))errors.push({seed,id:t.id,reason:'missing physical ceiling owner'});
          const route=plan.topology!.surfaces.filter(s=>s.id===t.id||s.id.startsWith(t.id+'/step-'));
          for(const sf of route.filter((_,j,a)=>j===0||j===a.length-1||j===Math.floor(a.length/2))){
            const p=rectCenter(sf.bounds),floor=surfaceY(sf,p.x,p.z),roof=surfaceY({...sf,profile:sf.ceilingProfile!},p.x,p.z);
            const origin=new THREE.Vector3(p.x+offset.x,floor+offset.y+.2,p.z+offset.z),direction=new THREE.Vector3(0,1,0);
            const hit=new THREE.Raycaster(origin,direction,0,8).intersectObjects(meshes)[0];
            const solid=physics.world.castRay(new RAPIER.Ray(origin,direction),8,true,undefined,undefined,undefined,undefined,physics.isEnvironmentCollider);
            if(!hit||!solid||Math.abs(hit.point.y-roof-offset.y)>.003||Math.abs(solid.timeOfImpact-(roof-floor-.2))>.003)
              errors.push({seed,coord,id:sf.id,reason:'roof/mesh/physical owner disagreement',expected:roof+offset.y,rendered:hit?.point.y,physical:solid?.timeOfImpact});
            minClearance=Math.min(minClearance,roof-floor);probes++;
          }
          const slot=plan.lights.find(l=>l.id===t.id+'/light');if(slot){
            const position=new THREE.Vector3(),rotation=new THREE.Quaternion();ceilingFixturePose(plan,slot,position,rotation);
            for(const x of [-slot.width/2,slot.width/2])for(const z of [-.5,.5]){
              const corner=new THREE.Vector3(x,0,z).applyQuaternion(rotation).add(position).add(new THREE.Vector3(offset.x,offset.y,offset.z));
              const up=new THREE.Vector3(0,1,0).applyQuaternion(rotation),hit=new THREE.Raycaster(corner,up,0,.2).intersectObjects(meshes)[0];
              if(!hit||Math.abs(hit.distance-.036)>.003)errors.push({seed,id:slot.id,reason:'floating or intersecting fixture',distance:hit?.distance});
              lamps++;
            }
          }
        }
        if([...links.values()].some(n=>n>2))errors.push({seed,reason:'more than two canonical halves'});
        physics.batchChunkChanges(()=>{physics.removeChunk('0');physics.removeChunk('1');});
        if(physics.world.colliders.len()!==retained)errors.push({seed,reason:'collider leak'});
      }finally{physics.dispose();meshes.forEach(m=>m.geometry.dispose());}
      if(i%16===15)writeFileSync(out+'.progress',`${corpus} ${i+1}/${total}\n`);
    }
    records.push({corpus,worlds,flights,policies,enclosures,probes,fixtureCorners:lamps,returns,bspArea,floorArea,bspShare:bspArea/floorArea,maxBatches,triangles,minClearance});
  }
}finally{material.dispose();}
writeFileSync(out,JSON.stringify({records,examples,errors,limits:'Actual Three Float32 worker buffers and Rapier colliders, mounted from real owners. CPU geometry audit; no WebGL image, GPU time or FPS.'},null,2));
console.log(JSON.stringify({out,records,errors:errors.length}));if(errors.length)process.exitCode=1;
