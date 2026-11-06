import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import * as THREE from 'three';
vi.mock('@dimforge/rapier3d',async()=>{const r=await import('@dimforge/rapier3d-compat');await r.init();return r;});
import RAPIER from '@dimforge/rapier3d';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { createStairwellPlan } from '../stairwell/createStairwellPlan';
import { loadApartmentModel } from '../../tests/support/load-apartment-model';
import { ImportedApartmentEnvironment } from './ImportedApartmentEnvironment';
import { ApartmentObjectInteraction } from './ApartmentObjectInteraction';
import { ApartmentFixtures, SINK } from './ApartmentFixtures';
import { ClosetHide } from './ClosetHide';
import { freshFixtures } from './ApartmentInteractionState';
import { defaultControlBindings } from '../input/ControlBindings';
const cleanup:(()=>void)[]=[];
const domModule:string='happy-dom';let dom:any;
beforeAll(async()=>{const {Window}=await import(/* @vite-ignore */ domModule);dom=new Window();vi.stubGlobal('window',dom);vi.stubGlobal('document',dom.document);vi.stubGlobal('KeyboardEvent',dom.KeyboardEvent);});
afterEach(()=>cleanup.splice(0).reverse().forEach(fn=>fn()));afterAll(()=>{dom?.close();vi.unstubAllGlobals();});
async function fixture(){
  const environment=new (ImportedApartmentEnvironment as unknown as {new(m:THREE.Object3D):ImportedApartmentEnvironment})(await loadApartmentModel());
  const physics=await PhysicsWorld.create(createStairwellPlan());cleanup.push(()=>physics.dispose(),()=>environment.dispose());
  const scene=new THREE.Scene();scene.add(environment.group);physics.addTrimeshChunk('actual-apartment',environment.shellColliderMeshes);physics.addChunk('furniture',environment.furnitureColliders,{x:0,y:0,z:0});
  const camera=new THREE.PerspectiveCamera(),ui={setInteraction:vi.fn(),setCarryHint:vi.fn()},broke=vi.fn();
  const objects=new ApartmentObjectInteraction(physics,scene,environment.pickables,camera,ui,broke);cleanup.push(()=>objects.dispose());
  const audio={fixture:vi.fn(),fixtureClick:vi.fn()},power={on:true};
  const appliances=(overrides:Partial<ReturnType<typeof freshFixtures>>={})=>{const fixtures=new ApartmentFixtures(environment,physics,objects,camera,ui,audio as never,()=>power.on,{...freshFixtures(),...overrides});cleanup.push(()=>fixtures.dispose());return fixtures;};
  const body=(id:string)=>{let result:RAPIER.RigidBody|undefined;physics.world.forEachRigidBody(b=>{if((b.userData as {apartmentPropId?:string})?.apartmentPropId===id)result=b;});return result!;};
  const step=(count:number)=>{for(let i=0;i<count;i++){physics.stepDynamics(1/60);objects.update(false);}};
  return {environment,physics,scene,camera,ui,objects,broke,appliances,power,body,step};
}
it('prepares individual real chess pieces, compound stools and ceramic-only pot bodies; the pan stays static',async()=>{
  const f=await fixture(),pieces=f.environment.pickables.filter(p=>p.kind==='chess'),stools=f.environment.pickables.filter(p=>p.kind==='stool'),pot=f.environment.pickables.find(p=>p.kind==='pot')!;
  expect(pieces).toHaveLength(32);expect(stools).toHaveLength(2);expect(new Set(f.environment.pickables.map(p=>p.id)).size).toBe(f.environment.pickables.length);
  for(const p of stools){expect(f.body(p.id).numColliders()).toBe(8);expect(f.body(p.id).mass()).toBeCloseTo(2.8,3);}
  expect(f.environment.pickables.some(p=>p.parts.includes(f.environment.pan!))).toBe(false);expect(f.environment.pan?.userData.staticPan).toBe(true);
  const bounds=new THREE.Box3().setFromObject(pot.collisionParts![0]!,true);expect(bounds.max.y-bounds.min.y).toBeCloseTo(.293,2);
  const poses=pieces.map(p=>new THREE.Vector3().copy(f.body(p.id).translation()));f.step(180);
  pieces.forEach((p,i)=>{expect(f.body(p.id).isSleeping()).toBe(true);expect(new THREE.Vector3().copy(f.body(p.id).translation()).distanceTo(poses[i]!)).toBeLessThan(.003);});
});
it('allows an untouched physical chess piece to be knocked by another loose piece',async()=>{
  const f=await fixture(),pieces=f.environment.pickables.filter(p=>p.kind==='chess'),a=f.body(pieces[0]!.id),b=f.body(pieces[1]!.id),p=b.translation(),before=new THREE.Vector3().copy(p);
  a.setTranslation({x:p.x-.12,y:p.y+.004,z:p.z},true);a.setLinvel({x:3,y:0,z:0},true);f.step(45);
  expect(new THREE.Vector3().copy(b.translation()).distanceTo(before)).toBeGreaterThan(.015);
});
it('fills the actual sink below the rim and advances only with the shared fixed step',async()=>{
  const f=await fixture(),fixtures=f.appliances({tapOn:true,waterLevel:.95});f.step(240);fixtures.update(.01,true,false);
  expect(fixtures.debugState.waterLevel).toBe(1);expect(fixtures.debugState.surface).toBeLessThan(9.664);expect(fixtures.debugState.stream).toBe(true);
  const before=fixtures.getProgress();for(let i=0;i<90;i++)fixtures.update(.05,false,false);expect(fixtures.getProgress()).toEqual(before);
  const basin=f.physics.world.castRay(new RAPIER.Ray({x:-5.18,y:9.6,z:0},{x:0,y:-1,z:0}),.3,true,undefined,undefined,undefined,undefined,f.physics.isEnvironmentCollider);expect(9.6-basin!.timeOfImpact).toBeCloseTo(9.422,2);
});
it('floats a light real chess piece with forces while dense glass stays near the basin floor',async()=>{
  const f=await fixture();f.appliances({waterLevel:1});const light=f.body(f.environment.pickables.find(p=>p.kind==='chess')!.id),glass=f.body(f.environment.pickables.find(p=>p.label==='Verre')!.id);
  light.setTranslation({x:-5.36,y:9.48,z:0},true);glass.setTranslation({x:-5.04,y:9.5,z:0},true);light.setLinvel({x:0,y:0,z:0},true);glass.setLinvel({x:0,y:0,z:0},true);f.step(300);
  expect(light.translation().y).toBeGreaterThan(9.58);expect(light.translation().y).toBeLessThan(SINK.maxSurface+.08);expect(glass.translation().y).toBeLessThan(9.53);
});
it('uses real fan blades, keeps the cage still, coasts down and preserves the independent lamp switch through a power cut',async()=>{
  const f=await fixture(),fixtures=f.appliances(),blades=f.environment.fan!.getObjectByName('Bone003_03')!,cage=f.environment.fan!.getObjectByName('Protection')!,q=blades.quaternion.clone(),cageMatrix=cage.matrixWorld.clone();
  f.camera.position.set(-8.15,9.7,-1.15);f.camera.lookAt(-8.15225,9.61575,-.16555);expect(fixtures.interact()).toBe(true);f.step(120);fixtures.update(.01,true,false);
  expect(fixtures.debugState.fanSpeed).toBeGreaterThan(20);expect(blades.quaternion.angleTo(q)).toBeGreaterThan(.1);expect(cage.matrixWorld.elements).toEqual(cageMatrix.elements);
  f.camera.position.set(-6.0921,9.8,-4.8);f.camera.lookAt(-6.0921,9.54,-5.7631);expect(fixtures.interact()).toBe(true);expect(fixtures.debugState.light).toBeGreaterThan(0);
  f.power.on=false;fixtures.update(.01,true,false);expect(fixtures.debugState.light).toBe(0);const speed=fixtures.debugState.fanSpeed;f.step(30);expect(fixtures.debugState.fanSpeed).toBeLessThan(speed);expect(fixtures.debugState.fanSpeed).toBeGreaterThan(0);
  fixtures.setBrightness(1.4);fixtures.update(.01,true,false);expect(fixtures.debugState.light).toBe(0);expect(fixtures.getProgress().deskLampOn).toBe(true);
});
it('breaks the actual pot on a strong contact, leaves soil and a physical plant, and restores the broken state',async()=>{
  const f=await fixture(),pot=f.environment.pickables.find(p=>p.kind==='pot')!,body=f.body(pot.id),p=body.translation();
  body.setTranslation({x:p.x,y:p.y+.015,z:p.z},true);f.step(120);expect(f.broke).not.toHaveBeenCalled();
  body.setTranslation({x:p.x,y:11.05,z:p.z},true);body.setLinvel({x:0,y:-.2,z:0},true);f.step(180);
  expect(f.broke).toHaveBeenCalledWith(expect.any(THREE.Vector3),'pot',true);expect(f.objects.debugState.plants).toBe(1);
  const saved=f.objects.getProgress();expect(saved.broken[pot.id]?.kind).toBe('pot');expect(saved.deposits.some(d=>d.kind==='soil')).toBe(true);expect(saved.bodies[pot.id+'/plant']).toBeDefined();
  // A fresh model/session must restore one plant, no intact pot and no duplicate break event.
  const model=await loadApartmentModel(),e=new (ImportedApartmentEnvironment as unknown as {new(m:THREE.Object3D):ImportedApartmentEnvironment})(model);cleanup.push(()=>e.dispose());const scene=new THREE.Scene();scene.add(e.group);
  const restored=new ApartmentObjectInteraction(f.physics,scene,e.pickables,f.camera,f.ui,f.broke,false,saved);cleanup.push(()=>restored.dispose());expect(restored.debugState.plants).toBe(1);expect(restored.getProgress().broken[pot.id]).toBeDefined();expect(e.pickables.find(p=>p.id===pot.id)!.parts[0]!.visible).toBe(false);
});
it('opens both actual closet leaves, traverses the real clear gap, pauses, and always exits without extra physics ticks',async()=>{
  const f=await fixture();let position=new THREE.Vector3(-7.9265,9.54,-4.85),active=false;const overlaps:number[]=[];
  f.camera.position.copy(position).add(new THREE.Vector3(0,.7,0));f.camera.lookAt(-7.9265,9.9,-5.33);
  const closet=new ClosetHide(f.environment,f.physics,f.camera,f.ui,{position:()=>position,pose:(p,narrow)=>{position.copy(p);f.physics.setScriptedPlayerPose(p,narrow);const hit=f.physics.world.intersectionWithShape(p,{x:0,y:0,z:0,w:1},new RAPIER.Capsule(narrow?.42:.52,narrow?.23:.32),undefined,undefined,undefined,undefined,f.physics.isEnvironmentCollider);if(hit)overlaps.push(hit.handle);},presentation:()=>{},active:a=>{active=a;},playing:()=>true,bindings:()=>defaultControlBindings()});cleanup.push(()=>closet.dispose());
  const steps=vi.spyOn(f.physics.world,'step');expect(closet.interact()).toBe(true);expect(active).toBe(true);
  for(let i=0;i<110;i++){closet.update(1/60,true);f.physics.stepDynamics(1/60);}expect(closet.debugState.phase).toBe('hidden');expect(f.camera.position.distanceTo(new THREE.Vector3(-7.9265,9.95,-5.65))).toBeLessThan(.001);
  const before=closet.debugState;closet.update(1,false);expect(closet.debugState).toEqual(before);const escape=new KeyboardEvent('keydown',{code:'Escape',cancelable:true});window.dispatchEvent(escape);expect(escape.defaultPrevented).toBe(false);
  closet.interact();for(let i=0;i<200;i++){closet.update(1/60,true);f.physics.stepDynamics(1/60);}expect(closet.isActive).toBe(false);expect(active).toBe(false);expect(position.z).toBeGreaterThan(-5.1);expect(steps).toHaveBeenCalledTimes(310);expect(overlaps).toEqual([]);
});
