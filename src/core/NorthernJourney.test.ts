import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@dimforge/rapier3d', async () => import('../../node_modules/@dimforge/rapier3d/rapier.js'));
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { environmentFixture } from '../../tests/support/environment-fixture';
import { findEventWallMount } from '../world/EnvironmentEvents';
import { EnvironmentStateStore } from '../environment/EnvironmentBehavior';
import { EnvironmentAudio } from '../audio/EnvironmentAudio';
import { NorthernLighting } from '../render/NorthernLighting';
import type { WorldView } from '../render/WorldBuilder';
import { NorthernJourney } from './NorthernJourney';

const cleanup: (()=>void)[] = [];
afterEach(()=>cleanup.splice(0).reverse().forEach(f=>f()));
const setup = async () => {
  const plan = environmentFixture('telephone'), mount = findEventWallMount(plan,plan.rooms[0]!,false)!;
  plan.environmentEvents=[];
  plan.northern={kind:'red-zone',circuits:[
    {id:'test/circuit-a',roomId:'room',bounds:{minX:-4,maxX:4,minZ:-9.96,maxZ:-2},floorY:0,ceilingY:3.05,mode:'repair',mount},
    {id:'test/circuit-b',roomId:'room',bounds:{minX:-4,maxX:4,minZ:2,maxZ:9.96},floorY:0,ceilingY:3.05,mode:'repair',mount:{...mount,position:{...mount.position,x:5}}},
  ]};
  const physics=await PhysicsWorld.create(plan), scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(), position=new THREE.Vector3(0,.865,0), offset=new THREE.Vector3(0,0,-448);
  physics.addChunk('target',plan.colliders,offset);
  const storage=new Map<string,string>(), states=new EnvironmentStateStore('circuits',{getItem:k=>storage.get(k)??null,setItem:(k,v)=>{storage.set(k,v);}});
  const audio=new EnvironmentAudio(()=>null), caption=vi.fn(), checkpoint=vi.fn(); let visible=false, available=true;
  const runtime=new NorthernJourney({scene,camera,physics,audio,position:()=>position,owner:()=>({x:0,story:0}),available:()=>available,riftResolved:()=>true,
    compassVisible:()=>visible,caption,revealCompass:vi.fn(),checkpoint},states);
  const view={northernLighting:new NorthernLighting(plan),decorLightingContext:null} as WorldView, chunk={key:'0:-4:0',plan,view,offset};
  runtime.mount(chunk); cleanup.push(()=>physics.dispose(),()=>audio.dispose(),()=>runtime.dispose());
  return {plan,mount,physics,scene,camera,position,offset,states,storage,runtime,chunk,caption,checkpoint,setVisible:(v:boolean)=>{visible=v;},setAvailable:(v:boolean)=>{available=v;}};
};
describe('red-zone circuit runtime and destination hook',()=>{
  it('migrates an old completed empty approach to the actual red-zone landmark without replaying the compass glitch',()=>{
    const host={} as ConstructorParameters<typeof NorthernJourney>[0];
    const runtime=new NorthernJourney(host,new EnvironmentStateStore('migration',null),{version:1,stage:'slides-ready',walkedRed:8,compassSeconds:3.2,target:{x:7,story:2}});
    expect(runtime.snapshot).toMatchObject({stage:'slides',target:{x:8,story:2},compassSeconds:3.2,slidesLayout:2});runtime.dispose();
  });
  it('cuts only the entered circuit, respects ray occlusion, restores once, and survives view/stream/save changes',async()=>{
    const h=await setup(), initial=h.physics.world.colliders.len();
    h.position.set(0,.865,-454); h.runtime.update(.1);
    expect(h.chunk.view.northernLighting.slots.map(s=>s.height.z)).toEqual([0,1]);
    const target=new THREE.Vector3().copy(h.mount.position).add(h.offset), normal=new THREE.Vector3(Math.sin(h.mount.yaw),0,Math.cos(h.mount.yaw));
    h.camera.position.copy(target).addScaledVector(normal,1.4); h.camera.position.y+=.1; h.camera.lookAt(target); h.camera.updateMatrixWorld(true);
    h.position.copy(h.camera.position).setY(.865);
    expect(h.runtime.getInteraction()?.label).toBe('Rétablir la lumière');
    h.camera.position.copy(target).addScaledVector(normal,-1); h.camera.lookAt(target); h.camera.updateMatrixWorld(true);
    expect(h.runtime.getInteraction()).toBeNull();
    h.camera.position.copy(target).addScaledVector(normal,1.4); h.camera.lookAt(target); h.camera.updateMatrixWorld(true);
    expect(h.runtime.interact()).toBe(true); expect(h.runtime.interact()).toBe(false);
    expect(h.states.read('test/circuit-a').circuit).toBe('restored');
    for(let i=0;i<8;i++){
      const chunk={...h.chunk,view:{northernLighting:new NorthernLighting(h.plan),decorLightingContext:null} as WorldView};
      h.runtime.mount(chunk); h.runtime.mount(chunk); h.runtime.update(.1);
      expect(chunk.view.northernLighting.slots[0]!.height.z).toBe(1);
      expect(h.physics.world.colliders.len()).toBe(initial);
    }
    h.runtime.unmount(h.chunk.key); h.runtime.mount(h.chunk); h.runtime.update(.1);
    expect(h.chunk.view.northernLighting.slots[0]!.height.z).toBe(1);
    const reloaded=new EnvironmentStateStore('circuits',{getItem:k=>h.storage.get(k)??null,setItem:()=>{}});
    expect(reloaded.read('test/circuit-a').circuit).toBe('restored');
    h.runtime.dispose(); expect(h.scene.children).toHaveLength(0); expect(h.physics.world.colliders.len()).toBe(initial-2);
  });
  it('waits for consultation, freezes unequipped/blocked, resolves a walkable slides target and checkpoints arrival',async()=>{
    const h=await setup(); h.position.set(0,.865,-420); h.runtime.update(.1);
    expect(h.caption).toHaveBeenCalledWith('Putain… la boussole vibre.');
    expect(h.runtime.questText?.text).toBe('Regarder la boussole');
    for(let i=0;i<60;i++)h.runtime.update(.1); expect(h.runtime.snapshot.compassSeconds).toBe(0);
    h.setVisible(true);h.runtime.update(.1);expect(h.runtime.anomaly).toBe(1);
    h.setAvailable(false);for(let i=0;i<40;i++)h.runtime.update(.1); expect(h.runtime.snapshot.compassSeconds).toBe(.1);
    h.setAvailable(true);for(let i=0;i<49;i++)h.runtime.update(.1);expect(h.runtime.snapshot.stage).toBe('slides');
    const slides=environmentFixture('telephone');slides.environmentEvents=[];
    slides.spatial={version:2,owner:{x:0,z:-5,story:0},cells:[],ceilings:[],prisms:[],dependencies:[],interfaces:[],landmarks:[],transitions:[]};
    slides.northern={kind:'red-zone',circuits:[],slides:{id:'slides',kind:'slides',roomId:'room',bounds:slides.rooms[0]!.bounds,position:{x:9,y:0,z:4}}};
    h.runtime.mount({key:'0:-5:0',plan:slides,offset:new THREE.Vector3(0,0,-560),view:{northernLighting:new NorthernLighting(slides)} as WorldView});
    const expected=new THREE.Vector3(9,0,-136).normalize();expect(h.runtime.compassDirection.distanceTo(expected)).toBeLessThan(.001);
    h.position.set(9,.865,-556);h.runtime.update(.1);expect(h.runtime.snapshot.stage).toBe('slides-ready');
    const count=h.caption.mock.calls.length;h.runtime.update(.1);expect(h.caption.mock.calls).toHaveLength(count);
  });
});
