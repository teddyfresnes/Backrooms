import * as THREE from 'three';
import { afterEach,expect,it,vi } from 'vitest';
vi.mock('@dimforge/rapier3d',async()=>import('../../node_modules/@dimforge/rapier3d/rapier.js'));
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { generateInfiniteChunk,getChunkWorldOffset } from './InfiniteWorld';
import { NorthernJourney } from '../core/NorthernJourney';
import { EnvironmentStateStore } from '../environment/EnvironmentBehavior';
import { EnvironmentAudio } from '../audio/EnvironmentAudio';
import { NorthernLighting } from '../render/NorthernLighting';
import { sanitizeNorthernProgress } from '../story/NorthernProgress';
import type { SlideDiveRequest } from '../core/SlideDive';
import type { WorldView } from '../render/WorldBuilder';
const cleanup:(()=>void)[]=[];afterEach(()=>cleanup.splice(0).reverse().forEach(f=>f()));

it('stands the three mouths in one solid wall: entered by the dive only, approached from the hall and bypassed around the shaft',async()=>{
  const plan=generateInfiniteChunk('SLIDES-PHYSICAL',{x:0,z:-5,story:0}),physics=await PhysicsWorld.create(plan);
  cleanup.push(()=>physics.dispose());const feature=plan.features.find(f=>f.kind==='slides-structure')!;
  if(feature.kind!=='slides-structure')throw new Error('No slides');
  expect(physics.canStandAt(feature.approach)).toBe(true);
  expect(feature.entries.map(e=>e.key)).toEqual(['this-way','unknown','exit']);
  for(const e of feature.entries){
    // Standing in front of the mouth, inside its trigger, on the hall's carpet.
    expect(physics.canStandAt({x:e.position.x,y:.865,z:feature.wallZ+1.3})).toBe(true);
    expect(e.trigger.minZ).toBeCloseTo(feature.wallZ,9);expect(e.position.z).toBe(feature.wallZ);
    // The mouth is physically closed: nobody walks or jumps into the bore.
    const hit=physics.castEnvironmentRay({x:e.position.x,y:e.position.y,z:feature.wallZ+1},{x:0,y:0,z:-1},1.5);
    expect(hit).not.toBeNull();expect(hit!.distance).toBeCloseTo(1,1);
  }
  // Hall front and sides, then around the closed shaft to the north row.
  for(const p of[{x:0,z:30},{x:0,z:27},{x:22,z:0},{x:25,z:0},{x:-30,z:-20},{x:0,z:-30}])expect(physics.canStandAt({...p,y:.865})).toBe(true);
  // No floor in the shaft behind the wall: the tubes fall through it.
  expect(plan.topology!.surfaces.some(s=>s.bounds.minZ<feature.wallZ-.01&&s.bounds.maxZ>-27.75&&s.bounds.minX<0&&s.bounds.maxX>0)).toBe(false);
});

it('offers each slide through the actual interaction flow: the host dives, the choice is kept where the body lands',async()=>{
  const owner={x:4,z:-5,story:-2},plan=generateInfiniteChunk('SLIDES-HOOK',owner),o=getChunkWorldOffset(owner),offset=new THREE.Vector3(o.x,o.y,o.z);
  const physics=await PhysicsWorld.create({...plan,colliders:[]});physics.addChunk('slides',plan.colliders,offset);
  const order:string[]=[],camera=new THREE.PerspectiveCamera(),position=new THREE.Vector3(),audio=new EnvironmentAudio(()=>null),choice=vi.fn(()=>{order.push('route');});
  const dives:SlideDiveRequest[]=[];let diving=true;
  const runtime=new NorthernJourney({scene:new THREE.Scene(),camera,physics,audio,position:()=>position,owner:()=>owner,available:()=>true,riftResolved:()=>true,compassVisible:()=>false,caption:vi.fn(),revealCompass(){},checkpoint(){order.push('save');},slideChoice:choice,
    diveIntoSlide:request=>{dives.push(request);return diving;}},new EnvironmentStateStore('slides',null));
  cleanup.push(()=>physics.dispose(),()=>audio.dispose(),()=>runtime.dispose());
  runtime.mount({key:'4:-5:-2',plan,offset,view:{northernLighting:new NorthernLighting(plan),decorLightingContext:null} as WorldView});
  const feature=plan.features.find(f=>f.kind==='slides-structure')!;if(feature.kind!=='slides-structure')throw new Error('No slides');
  const aim=(e:typeof feature.entries[number])=>{position.set(e.position.x,.865,feature.wallZ+1.2).add(offset);camera.position.copy(position).add(new THREE.Vector3(0,.7,0));
    camera.lookAt(new THREE.Vector3().copy(e.position).add(offset));camera.updateMatrixWorld(true);};
  for(const [i,e] of feature.entries.entries()){
    aim(e);expect(runtime.getInteraction()?.label).toBe(`Sauter dans « ${e.label} »`);
    // The dive is played by the host: nothing is saved or routed before it lands.
    expect(runtime.interact()).toBe(true);expect(dives).toHaveLength(i+1);expect(order).toHaveLength(i*2);
    const request=dives.at(-1)!;expect(request.entry.id).toBe(e.id);expect(request.owner).toEqual(owner);expect(request.offset.equals(offset)).toBe(true);
    runtime.completeSlide(request,{x:owner.x,story:owner.story-1});
    expect(choice).toHaveBeenLastCalledWith({structureId:feature.id,entryId:e.id,key:e.key,transitionKey:e.transitionKey});
    expect(sanitizeNorthernProgress(runtime.snapshot)?.selectedSlide).toBe(e.key);expect(runtime.snapshot.target).toEqual({x:4,story:-3});
    expect(order.slice(-2)).toEqual(['save','route']);
  }
  // Without a dive (no character, a host that declines), the choice applies on the spot.
  diving=false;aim(feature.entries[0]!);expect(runtime.interact()).toBe(true);expect(runtime.snapshot.target).toEqual({x:4,story:-2});
  camera.lookAt(camera.position.clone().add(new THREE.Vector3(0,0,1)));camera.updateMatrixWorld(true);expect(runtime.getInteraction()).toBeNull();
});
