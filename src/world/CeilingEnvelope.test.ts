import { expect, it, vi } from 'vitest';
vi.mock('@dimforge/rapier3d', async () => import('../../node_modules/@dimforge/rapier3d/rapier.js'));
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { generateInfiniteChunk } from './InfiniteWorld';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { prepareSpatialArchitecture, mountArchitectureBatch } from '../render/SpatialArchitectureBuffers';
import { completeCeilingEnvelope, ownedProfilePrisms } from './CeilingEnvelope';
import { applySpatialRelief } from './SpatialRelief';
import { regionalStyle } from './RegionalPlan';
import { surfaceY, type WalkableSurface } from './WalkableTopology';
import type { WorldPlan } from './types';

it('closes the reproduced LATE-OFFICE niche into the high roof, with the same mesh and physical solid', async () => {
  const plan=generateInfiniteChunk('LATE-OFFICE-1950',{x:0,z:0,story:0}),x=-36.83,z=23.75;
  const roof=plan.spatial!.ceilings.find(s=>s.id.includes('/bsp-8/ceiling')&&x>s.bounds.minX&&x<s.bounds.maxX&&z>s.bounds.minZ&&z<s.bounds.maxZ)!;
  expect(roof.roomId).toContain('room-WTBLBRBTL');expect(surfaceY(roof,x,z)-roof.thickness).toBeCloseTo(-2.11,6);
  const returns=plan.spatial!.prisms.filter(p=>p.id.startsWith(`${roof.id}/ceiling-return-n`));expect(returns.length).toBeGreaterThan(0);
  const material=new THREE.MeshBasicMaterial(),meshes=prepareSpatialArchitecture(plan).map(b=>{const m=new THREE.Mesh(mountArchitectureBatch(b),material);m.name=b.name;m.updateMatrixWorld();return m;});
  const physics=await PhysicsWorld.create(plan);
  try {
    for(const y of [-2.0,-1.3,-.55]) {
      const hit=new THREE.Raycaster(new THREE.Vector3(x,y,22),new THREE.Vector3(0,0,1),0,2).intersectObjects(meshes)[0];
      expect(hit?.object.name).toBe('regional-plaster-structures');expect(hit!.point.z).toBeCloseTo(23.5,5);
      const solid=physics.world.intersectionWithShape({x,y,z:23.5},{x:0,y:0,z:0,w:1},new RAPIER.Ball(.025),undefined,undefined,undefined,undefined,physics.isEnvironmentCollider);
      expect(solid).not.toBeNull();
    }
    // The new return stays above the low ceiling: the alcove remains usable.
    expect(physics.canStandAt({x:-36.57,y:-4.85+.865,z:20.14})).toBe(true);
  } finally {physics.dispose();meshes.forEach(m=>m.geometry.dispose());material.dispose();}
});

it('splits sloping returns at owner-band crossings, with no gap or volume overlap between owners', () => {
  const b={minX:0,maxX:18,minZ:0,maxZ:.12},low={kind:'flat' as const,y:2.77},high={kind:'linear' as const,axis:'x' as const,startY:3.05,endY:13};
  const groups=[[-.16,5.24],[5.24,10.64],[10.64,16.04]].map(([lo,hi],i)=>ownedProfilePrisms(`band-${i}`,b,low,high,lo!,hi!));
  for(let x=.17;x<18;x+=.37) {
    const bands=groups.flatMap(g=>g.filter(p=>x>=p.vertices[0]!-.00001&&x<=p.vertices[6]!+.00001).map(p=>{
      const b={minX:p.vertices[0]!,maxX:p.vertices[6]!,minZ:0,maxZ:.12},t=(x-b.minX)/(b.maxX-b.minX);
      return {lo:p.vertices[13]!+(p.vertices[19]!-p.vertices[13]!)*t,hi:p.vertices[1]!+(p.vertices[7]!-p.vertices[1]!)*t};
    })).filter(b=>b.hi-b.lo>.00001).sort((a,b)=>a.lo-b.lo);
    expect(bands[0]!.lo).toBeCloseTo(2.77,5);expect(bands.at(-1)!.hi).toBeCloseTo(3.05+(13-3.05)*x/18,5);
    for(let i=1;i<bands.length;i++)expect(bands[i]!.lo).toBeCloseTo(bands[i-1]!.hi,5);
  }
});

it('keeps intentional datum boundaries and isolated ceilings open instead of inventing an enclosing height', () => {
  const base:WalkableSurface={id:'a',roomId:'cell/0/0/0/a',ownerStory:0,layer:'test',role:'floor',bounds:{minX:0,maxX:6,minZ:0,maxZ:6},profile:{kind:'flat',y:2.77},ceilingY:2.74,thickness:.03,support:'slab',access:'open',edges:'architecture'};
  const world={walls:[],spatial:{cells:[{id:'cell/0/0/0',mode:'rooms',floorY:0},{id:'cell/1/0/0',mode:'rooms',floorY:4}],ceilings:[base,{...base,id:'b',roomId:'cell/1/0/0/b',bounds:{minX:6,maxX:12,minZ:0,maxZ:6},profile:{kind:'flat',y:9}}],prisms:[]}} as unknown as WorldPlan;
  const made:unknown[]=[];completeCeilingEnvelope(world,p=>made.push(p));expect(made).toEqual([]);
});

it('raises only a relief host room and keeps every associated roof and light at the same physical altitude', () => {
  let checked=false;
  for(let n=0;n<256&&!checked;n++) {
    const seed=`RELIEF-SCOPE-${n}`;if(regionalStyle(seed,'fixture').family==='maze')continue;
    const host:WalkableSurface={id:'host-floor',roomId:'host',ownerStory:0,layer:'fixture',role:'floor',bounds:{minX:0,maxX:28,minZ:0,maxZ:15},profile:{kind:'flat',y:0},ceilingY:2.74,ceilingProfile:{kind:'flat',y:2.74},thickness:.16,support:'slab',access:'open',edges:'architecture'};
    const other={...host,id:'other-floor',roomId:'other',bounds:{minX:0,maxX:28,minZ:15,maxZ:28},ceilingY:4.35,ceilingProfile:{kind:'flat' as const,y:4.35}};
    const w={seed,walls:[],colliders:[],features:[],lights:[{roomId:'host',ceilingY:2.74},{roomId:'other',ceilingY:4.35}],
      rooms:[{id:'host',bounds:host.bounds,floorY:0,ceilingHeight:2.74,structuralCeilingY:2.74},{id:'other',bounds:other.bounds,floorY:0,ceilingHeight:4.35,structuralCeilingY:4.35}],
      topology:{surfaces:[host,other]},spatial:{owner:{x:0,z:0,story:0},cells:[{id:'cell/0/0/0',regionId:'fixture',mode:'rooms',bounds:{minX:0,maxX:28,minZ:0,maxZ:28},floorY:0}],transitions:[],landmarks:[],ceilings:[{...host,id:'host-roof',profile:{kind:'flat',y:2.77}},{...other,id:'other-roof',profile:{kind:'flat',y:4.38}}]}} as unknown as WorldPlan;
    applySpatialRelief(w,[]);if(!w.spatial!.reliefs!.length)continue;
    checked=true;const roof=w.rooms[0]!.ceilingHeight;
    expect(roof).toBeGreaterThan(2.74);expect(w.rooms[1]!.ceilingHeight).toBe(4.35);expect(w.lights[1]!.ceilingY).toBe(4.35);
    expect(w.topology!.surfaces.find(s=>s.id==='other-floor')!.ceilingY).toBe(4.35);
    const ceiling=w.spatial!.ceilings[0]!;expect(surfaceY(ceiling,1,1)-ceiling.thickness).toBeCloseTo(roof,7);expect(ceiling.ceilingY).toBe(roof);expect(w.lights[0]!.ceilingY).toBe(roof);
  }
  expect(checked).toBe(true);
});
