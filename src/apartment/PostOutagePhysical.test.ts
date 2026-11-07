import {expect,it,vi,afterEach}from 'vitest';
import * as THREE from 'three';
vi.mock('@dimforge/rapier3d',async()=>{const r=await import('@dimforge/rapier3d-compat');await r.init();return r;});
import RAPIER from '@dimforge/rapier3d';
import {PhysicsWorld}from '../physics/PhysicsWorld';
import {createStairwellPlan}from '../stairwell/createStairwellPlan';
import {ImportedApartmentEnvironment}from './ImportedApartmentEnvironment';
import {ImportedApartmentDoorInteraction}from './ImportedApartmentDoorInteraction';
import {loadApartmentModel}from '../../tests/support/load-apartment-model';
import {LongCorridor}from './LongCorridor';
import {Flashlight}from './Flashlight';
import {InventoryState}from './InventoryState';
import {ApartmentObjectInteraction}from './ApartmentObjectInteraction';
import type {MaterialSet}from '../render/MaterialLibrary';
const cleanup:(()=>void)[]=[];afterEach(()=>cleanup.splice(0).reverse().forEach(f=>f()));
async function fixture(){
  const a=new (ImportedApartmentEnvironment as unknown as {new(model:THREE.Object3D):ImportedApartmentEnvironment})(await loadApartmentModel()),p=await PhysicsWorld.create(createStairwellPlan());cleanup.push(()=>p.dispose(),()=>a.dispose());
  const scene=new THREE.Scene();scene.add(a.group);p.addTrimeshChunk('actual-shell',a.shellColliderMeshes);p.addChunk('actual-furniture',a.furnitureColliders,{x:0,y:0,z:0});
  const mat=new THREE.MeshStandardMaterial(),materials=new Proxy({},{get:()=>mat})as MaterialSet,c=new LongCorridor(a.corridorDoorway,a.corridorFloorY,materials,p);cleanup.push(()=>mat.dispose(),()=>c.dispose());
  return{a,p,scene,c};
}
it('replaces the old staircase once, keeps the exact threshold and permits an actual capsule journey beyond 20 m to the far end',async()=>{
  const{a,p,scene,c}=await fixture();const x=a.doorCenter.x,z=a.doorCenter.z,y=c.floorY;
  p.removeChunk('origin');c.activate(scene);c.activate(scene);expect(p.hasChunk('post-outage-corridor')).toBe(true);expect(scene.children.filter(o=>o===c.group)).toHaveLength(1);
  p.teleport({x:x-.65,y:y+.865,z});
  for(let i=0;i<400;i++){p.move({x:.06,y:-.04,z:0});p.stepDynamics(1/60);}
  const position=new THREE.Vector3();p.getPosition(position);expect(position.x-x).toBeGreaterThan(22);expect(position.y-y).toBeCloseTo(.865,1);
  for(let i=0;i<2100;i++){p.move({x:.06,y:-.04,z:0});p.stepDynamics(1/60);}p.getPosition(position);expect(position.x-x).toBeGreaterThan(145);expect(position.y-y).toBeCloseTo(.865,1);
  // Floor contacts remain present all along, not just a distant backdrop.
  for(const distance of [.1,20,80,160]){const hit=p.world.castRay(new RAPIER.Ray({x:x+distance,y:y+1,z},{x:0,y:-1,z:0}),2,true,undefined,undefined,undefined,undefined,p.isEnvironmentCollider);expect(hit).not.toBeNull();expect(hit!.timeOfImpact).toBeCloseTo(1,3);}
  c.setLights(42,1,0,false);c.update(0);const on=c.group.getObjectByName('instanced-luminous-ceiling-tiles')as THREE.InstancedMesh;
  const color=new THREE.Color();on.getColorAt(0,color);expect(color.r).toBe(1);on.getColorAt(41,color);expect(color.r).toBe(1);c.setLights(42);c.update(1/60);on.getColorAt(0,color);expect(color.r).toBe(1);
  let lights=0;c.group.traverse(o=>{if((o as THREE.Light).isLight)lights++;});expect(lights).toBe(0);
});
it('prepares disabled resident corridor colliders and activates the same bodies without a first-use allocation',async()=>{
 const{a,p,scene,c}=await fixture();await c.prepare();await c.prepare();
 p.removeChunk('origin');const origin={x:a.doorCenter.x+20,y:c.floorY+1,z:a.doorCenter.z},direction={x:0,y:-1,z:0};
 expect(p.world.castRay(new RAPIER.Ray(origin,direction),2,true,undefined,undefined,undefined,undefined,p.isEnvironmentCollider)).toBeNull();
 const bodies=p.world.bodies.len(),colliders=p.world.colliders.len(),create=vi.spyOn(p.world,'createRigidBody');
 c.activate(scene);expect(create).not.toHaveBeenCalled();expect(p.world.bodies.len()).toBe(bodies);expect(p.world.colliders.len()).toBe(colliders);
 p.stepDynamics(1/60); // The ordinary fixed tick updates Rapier's broad phase.
 const hit=p.world.castRay(new RAPIER.Ray(origin,direction),2,true,undefined,undefined,undefined,undefined,p.isEnvironmentCollider);
 expect(hit?.timeOfImpact).toBeCloseTo(1,3);create.mockRestore();
});
it('keeps the imported switch/lock reachable, closes the frame perimeter from both sides and supports the complete threshold',async()=>{
  const{a,p,scene,c}=await fixture();p.removeChunk('origin');c.activate(scene);scene.updateMatrixWorld(true);
  const frame=a.corridorDoorway.frameBox,leaf=a.entryDoor.closedBox;
  for(const name of ['corridor-entry-return-left','corridor-entry-return-right','corridor-entry-lintel']){
    const b=new THREE.Box3().setFromObject(c.group.getObjectByName(name)!);expect(b.min.x).toBeGreaterThanOrEqual(frame.max.x-.009);
  }
  const ray=new THREE.Raycaster();
  for(const object of [a.lightSwitch,a.doorLock]){
    const target=new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3()),eye=target.clone().add(new THREE.Vector3(-.7,0,-.1));
    ray.set(eye,target.clone().sub(eye).normalize());ray.far=eye.distanceTo(target);expect(ray.intersectObject(c.group,true)).toHaveLength(0);
  }
  const seamPoints=[new THREE.Vector3(0,a.floorY+1,leaf.min.z-.02),new THREE.Vector3(0,a.floorY+1,leaf.max.z+.02),new THREE.Vector3(0,frame.max.y-.02,a.doorCenter.z)];
  for(const side of [-1,1])for(const point of seamPoints){
    const eye=point.clone();eye.x=a.doorCenter.x+side*.45;ray.set(eye,new THREE.Vector3(-side,0,0));ray.far=.9;
    expect(ray.intersectObjects([a.group,c.group],true).some(h=>h.distance<.75),`frame seam ${side} ${point.toArray()}`).toBe(true);
  }
  for(let x=frame.min.x-.08;x<frame.max.x+.25;x+=.025){
    const hit=p.world.castRay(new RAPIER.Ray({x,y:c.floorY+.6,z:a.doorCenter.z},{x:0,y:-1,z:0}),.8,true,undefined,undefined,undefined,undefined,p.isEnvironmentCollider);
    expect(hit?.timeOfImpact).toBeCloseTo(.6,3);
  }
});
it('keeps an already-open real door open when the missing-lamp hesitation denies a new opening',async()=>{
  const{a,p}=await fixture();let hasLamp=false;const reminder=vi.fn();const door=new ImportedApartmentDoorInteraction(a.entryDoor.pivot,a.entryDoor.leaf,a.entryDoor.closedBox,a.createDoorCollider('door',a.entryDoor.closedBox),p,{setInteraction(){}},{chunkKey:'door',closedAngle:a.entryDoor.closedAngle,openAngle:a.entryDoor.openAngle,beforeOpen:()=>{if(!hasLamp)reminder();return hasLamp;}});cleanup.push(()=>door.dispose());
  door.restoreState({progress:1,targetProgress:1,locked:false});const open=a.entryDoor.pivot.rotation.y;
  // The world swap does not call restoreState or teleport the leaf.
  expect(door.getState().progress).toBe(1);expect(a.entryDoor.pivot.rotation.y).toBe(open);
  door.restoreState({progress:0,targetProgress:0,locked:false});
  const position=new THREE.Vector3(a.doorCenter.x-.9,a.floorY+.865,a.doorCenter.z),eye=position.clone().add(new THREE.Vector3(0,.73,0)),direction=a.doorCenter.clone().sub(eye).normalize();
  expect(door.interact(position,direction,true)).toBe(true);expect(reminder).toHaveBeenCalledOnce();expect(door.getState().targetProgress).toBe(0);
  hasLamp=true;expect(door.interact(position,direction,true)).toBe(true);expect(door.getState().targetProgress).toBe(1);
});
it('places the detailed, reachable flashlight on the actual desk and removes its world instance when acquired with a full bag',async()=>{
  const{a,p,scene}=await fixture();const torch=new Flashlight(scene,p,a.group.getObjectByName('Desk'));cleanup.push(()=>torch.dispose());torch.model.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(torch.model),center=bounds.getCenter(new THREE.Vector3());
  const hit=p.world.castRay(new RAPIER.Ray({x:center.x,y:bounds.min.y+.005,z:center.z},{x:0,y:-1,z:0}),.4,true,undefined,undefined,undefined,undefined,p.isEnvironmentCollider);
  expect(hit,'flashlight must rest on the real desk').not.toBeNull();expect(hit!.timeOfImpact).toBeLessThan(.08);
  const camera=new THREE.PerspectiveCamera();camera.position.set(center.x,a.floorY+1.59,center.z+.9);camera.lookAt(center);camera.updateMatrixWorld(true);expect(torch.isTargeted(camera)).toBe(true);
  const bag=new InventoryState();for(let i=0;i<4;i++)bag.store({id:`prop:${i}`,label:'Disquette'});expect(bag.acquireLamp()).toBe(true);
  torch.update(camera,undefined,true,false,false,.016,false);expect(torch.model.visible).toBe(false);bag.toggleLamp();torch.update(camera,undefined,true,true,bag.state.lampOn,.016,false);expect(torch.light.intensity).toBeGreaterThan(0);expect(torch.light.distance).toBe(28);expect(torch.model.visible).toBe(true);
  expect(new THREE.Box3().setFromObject(torch.model).getCenter(new THREE.Vector3()).distanceTo(center)).toBeGreaterThan(.3);
});
it('stows and retrieves exact real small props without a visible double, collider ghost or duplicated inventory identity',async()=>{
  const{a,p,scene}=await fixture(),camera=new THREE.PerspectiveCamera(),objects=new ApartmentObjectInteraction(p,scene,a.pickables,camera,{setInteraction(){}});cleanup.push(()=>objects.dispose());
  const disk=a.pickables.find(i=>i.kind==='chess')!;expect(disk).toBeDefined();const center=disk.bounds.getCenter(new THREE.Vector3());camera.position.copy(center).add(new THREE.Vector3(0,.4,.7));camera.lookAt(center);camera.updateMatrixWorld(true);
  expect(objects.interact()).toBe(true);expect(objects.heldInventoryItem?.id).toBe(disk.id);const bag=new InventoryState();expect(bag.store(objects.heldInventoryItem!)).toBe(true);objects.setStored(bag.storedIds);expect(objects.isHolding).toBe(false);
  let body:RAPIER.RigidBody|undefined;p.world.forEachRigidBody(b=>{if((b.userData as{apartmentPropId?:string})?.apartmentPropId===disk.id)body=b;});expect(body?.isEnabled()).toBe(false);
  for(let i=0;i<30;i++){bag.select(1);objects.update(false);p.stepDynamics(1/60);}expect(bag.storedIds).toEqual([disk.id]);expect(body?.isEnabled()).toBe(false);
  const anchor=disk.parts[0]!.parent!;objects.presentEquipped(disk.id,new THREE.Vector3(-6.5,10,-4),new THREE.Quaternion());expect(anchor.visible).toBe(true);expect(anchor.position.x).toBe(-6.5);expect(body?.isEnabled()).toBe(false);
  objects.presentEquipped(undefined);expect(anchor.visible).toBe(false);expect(bag.storedIds).toEqual([disk.id]);
  // Bring the same stored item into a clear physical holding position.
  camera.position.set(-6.6,a.floorY+1.5,-3.5);camera.lookAt(-6.6,a.floorY+1.5,-4.5);camera.updateMatrixWorld(true);bag.state.selected=0;
  expect(objects.takeStored(disk.id)).toBe(true);expect(bag.takeSelected()?.id).toBe(disk.id);expect(body?.isEnabled()).toBe(true);expect(objects.isHolding).toBe(true);expect(bag.storedIds).toHaveLength(0);
});
