import { expect, it, vi } from 'vitest';
vi.mock('@dimforge/rapier3d', async () => import('../../node_modules/@dimforge/rapier3d/rapier.js'));
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { generateInfiniteChunk } from './InfiniteWorld';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { prepareSpatialArchitecture, mountArchitectureBatch } from '../render/SpatialArchitectureBuffers';
import { completeCeilingEnvelope, ownedProfilePrisms } from './CeilingEnvelope';
import { applySpatialRelief } from './SpatialRelief';
import { regionalStyle, openRoomComposition } from './RegionalPlan';
import { surfaceY, type WalkableSurface } from './WalkableTopology';
import type { WorldPlan } from './types';

it('closes low ceiling edges into the adjacent high roof, with the same mesh and physical solid', async () => {
  // The historical LATE-OFFICE niche belonged to one room of the former single
  // BSP. The contract is the same for every return of the real plan.
  const plan=generateInfiniteChunk('LATE-OFFICE-1950',{x:0,z:0,story:0});
  const returns=plan.spatial!.prisms.filter(p=>p.id.includes('/ceiling-return-'));expect(returns.length).toBeGreaterThan(3);
  const material=new THREE.MeshBasicMaterial(),meshes=prepareSpatialArchitecture(plan).map(b=>{const m=new THREE.Mesh(mountArchitectureBatch(b),material);m.name=b.name;m.updateMatrixWorld();return m;});
  const physics=await PhysicsWorld.create(plan);let visible=0;
  try {
    for(const prism of returns) {
      const axis=(i:number)=>prism.vertices.filter((_,j)=>j%3===i),xs=axis(0),ys=axis(1),zs=axis(2);
      const lo={x:Math.min(...xs),y:Math.min(...ys),z:Math.min(...zs)},hi={x:Math.max(...xs),y:Math.max(...ys),z:Math.max(...zs)};
      expect(prism.material).toBe('wall');expect(hi.y-lo.y).toBeGreaterThan(.001);
      const center={x:(lo.x+hi.x)/2,y:(lo.y+hi.y)/2,z:(lo.z+hi.z)/2},thinX=hi.x-lo.x<hi.z-lo.z;
      // Rapier owns the same solid: its hull is met on the face of the return.
      const face={...center,...(thinX?{x:lo.x}:{z:lo.z})};
      expect(physics.world.intersectionWithShape(face,{x:0,y:0,z:0,w:1},new RAPIER.Ball(.025),undefined,undefined,undefined,undefined,physics.isEnvironmentCollider),prism.id).not.toBeNull();
      // And a horizontal ray through its 12 cm meets a wallpaper face on at least one side.
      for(const sign of [-1,1]) {
        const origin=new THREE.Vector3(center.x-(thinX?sign:0),center.y,center.z-(thinX?0:sign)),direction=new THREE.Vector3(thinX?sign:0,0,thinX?0:sign);
        const hit=new THREE.Raycaster(origin,direction,0,2).intersectObjects(meshes).find(h=>h.object.name==='regional-walls'
          &&h.point.x>=lo.x-.002&&h.point.x<=hi.x+.002&&h.point.z>=lo.z-.002&&h.point.z<=hi.z+.002);
        if(hit){visible++;break;}
      }
    }
    expect(visible).toBeGreaterThan(returns.length/2);
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
    const seed=`RELIEF-SCOPE-${n}`,region='district/0/0';if(regionalStyle(seed,region).family==='maze')continue;
    const proposal=openRoomComposition(seed,region).relief;if(!proposal)continue;
    const host:WalkableSurface={id:'host-floor',roomId:'host',ownerStory:0,layer:'fixture',role:'floor',bounds:{minX:0,maxX:28,minZ:0,maxZ:15},profile:{kind:'flat',y:0},ceilingY:2.74,ceilingProfile:{kind:'flat',y:2.74},thickness:.16,support:'slab',access:'open',edges:'architecture'};
    const other={...host,id:'other-floor',roomId:'other',bounds:{minX:0,maxX:28,minZ:15,maxZ:28},ceilingY:4.35,ceilingProfile:{kind:'flat' as const,y:4.35}};
    const w={seed,walls:[],colliders:[],features:[],lights:[{roomId:'host',ceilingY:2.74},{roomId:'other',ceilingY:4.35}],
      rooms:[{id:'host',bounds:host.bounds,floorY:0,ceilingHeight:2.74,structuralCeilingY:2.74},{id:'other',bounds:other.bounds,floorY:0,ceilingHeight:4.35,structuralCeilingY:4.35}],
      topology:{surfaces:[host,other]},spatial:{owner:{x:0,z:0,story:0},cells:[{id:`cell/${proposal.x}/${proposal.z}/0`,regionId:region,mode:'rooms',bounds:{minX:0,maxX:28,minZ:0,maxZ:28},floorY:0}],transitions:[],landmarks:[],ceilings:[{...host,id:'host-roof',profile:{kind:'flat',y:2.77}},{...other,id:'other-roof',profile:{kind:'flat',y:4.38}}]}} as unknown as WorldPlan;
    applySpatialRelief(w,[]);if(!w.spatial!.reliefs!.length)continue;
    checked=true;const roof=w.rooms[0]!.ceilingHeight;
    expect(roof).toBeGreaterThan(2.74);expect(w.rooms[1]!.ceilingHeight).toBe(4.35);expect(w.lights[1]!.ceilingY).toBe(4.35);
    expect(w.topology!.surfaces.find(s=>s.id==='other-floor')!.ceilingY).toBe(4.35);
    const ceiling=w.spatial!.ceilings[0]!;expect(surfaceY(ceiling,1,1)-ceiling.thickness).toBeCloseTo(roof,7);expect(ceiling.ceilingY).toBe(roof);expect(w.lights[0]!.ceilingY).toBe(roof);
  }
  expect(checked).toBe(true);
});
