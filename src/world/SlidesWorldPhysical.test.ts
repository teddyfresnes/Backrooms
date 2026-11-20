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
import type { WorldView } from '../render/WorldBuilder';
const cleanup:(()=>void)[]=[];afterEach(()=>cleanup.splice(0).reverse().forEach(f=>f()));

it('keeps four real circular apertures open, supports the approaches and blocks the wall between them',async()=>{
  const plan=generateInfiniteChunk('SLIDES-PHYSICAL',{x:0,z:-5,story:0}),physics=await PhysicsWorld.create(plan);
  cleanup.push(()=>physics.dispose());const feature=plan.features.find(f=>f.kind==='slides-structure')!;
  if(feature.kind!=='slides-structure')throw new Error('No slides');
  expect(physics.canStandAt(feature.approach)).toBe(true);
  for(const e of feature.entries){
    expect(physics.canStandAt({x:e.position.x,y:.865,z:-4.6})).toBe(true);
    expect(physics.castEnvironmentRay({x:e.position.x,y:1.5,z:-5},{x:0,y:0,z:-1},5.15)).toBeNull();
    expect(physics.castEnvironmentRay({x:e.position.x+3.2,y:1.5,z:-5},{x:0,y:0,z:-1},5.15)).not.toBeNull();
  }
  // Front/north circulation and side bypasses remain available.
  for(const p of[{x:0,z:30},{x:0,z:27},{x:22,z:0},{x:25,z:0},{x:0,z:-27},{x:0,z:-30}])expect(physics.canStandAt({...p,y:.865})).toBe(true);
});

it('examines every choice through the actual interaction flow, saves it, and emits the exact future transition key',async()=>{
  const owner={x:4,z:-5,story:-2},plan=generateInfiniteChunk('SLIDES-HOOK',owner),o=getChunkWorldOffset(owner),offset=new THREE.Vector3(o.x,o.y,o.z);
  const physics=await PhysicsWorld.create({...plan,colliders:[]});physics.addChunk('slides',plan.colliders,offset);
  const order:string[]=[],camera=new THREE.PerspectiveCamera(),position=new THREE.Vector3(),audio=new EnvironmentAudio(()=>null),choice=vi.fn(()=>{order.push('route');});
  const runtime=new NorthernJourney({scene:new THREE.Scene(),camera,physics,audio,position:()=>position,owner:()=>owner,available:()=>true,riftResolved:()=>true,compassVisible:()=>false,caption:vi.fn(),revealCompass(){},checkpoint(){order.push('save');},slideChoice:choice},new EnvironmentStateStore('slides',null));
  cleanup.push(()=>physics.dispose(),()=>audio.dispose(),()=>runtime.dispose());
  runtime.mount({key:'4:-5:-2',plan,offset,view:{northernLighting:new NorthernLighting(plan),decorLightingContext:null} as WorldView});
  const feature=plan.features.find(f=>f.kind==='slides-structure')!;if(feature.kind!=='slides-structure')throw new Error('No slides');
  for(const e of feature.entries){
    position.set(e.position.x,.865,-5.3).add(offset);camera.position.copy(position).add(new THREE.Vector3(0,.8,0));camera.lookAt(new THREE.Vector3().copy(e.position).add(offset));camera.updateMatrixWorld(true);
    expect(runtime.getInteraction()?.label).toBe(`Examiner ${e.label}`);expect(runtime.interact()).toBe(true);
    expect(choice).toHaveBeenLastCalledWith({structureId:feature.id,entryId:e.id,key:e.key,transitionKey:e.transitionKey});
    expect(sanitizeNorthernProgress(runtime.snapshot)?.selectedSlide).toBe(e.key);expect(runtime.snapshot.target).toEqual({x:4,story:-2});
    expect(runtime.compassDirection.z).toBeLessThan(-.99);
    expect(order.slice(-2)).toEqual(['save','route']);
  }
  camera.lookAt(camera.position.clone().add(new THREE.Vector3(0,0,1)));camera.updateMatrixWorld(true);expect(runtime.getInteraction()).toBeNull();
});
