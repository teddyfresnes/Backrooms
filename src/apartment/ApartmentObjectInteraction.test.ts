import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
vi.mock('@dimforge/rapier3d', async () => { const rapier=await import('@dimforge/rapier3d-compat'); await rapier.init(); return rapier; });
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { createStairwellPlan } from '../stairwell/createStairwellPlan';
import { collectApartmentPickables } from './ApartmentPickables';
import { ApartmentObjectInteraction } from './ApartmentObjectInteraction';
import { batchStaticMeshes } from '../stairwell/geometry';
import {sanitizeApartmentObjects}from './ApartmentInteractionState';
import type {ApartmentPickable}from './ApartmentPickables';
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).reverse().forEach(fn => fn()));
async function fixture(wall = false) {
  const physics = await PhysicsWorld.create(createStairwellPlan()); cleanup.push(() => physics.dispose());
  if (wall) physics.addChunk('test-wall', [{ id: 'wall', center: { x: 0, y: 1.4, z: -4.6 }, halfExtents: { x: .8, y: 1.4, z: .06 }, kind: 'wall' }], { x: 0, y: 0, z: 0 });
  const scene = new THREE.Scene(), kitchen = new THREE.Group(); kitchen.name = 'KitchenStuff'; scene.add(kitchen);
  const bottle = new THREE.Mesh(new THREE.BoxGeometry(.08, .3, .08), new THREE.MeshStandardMaterial());
  bottle.name = 'bottle'; bottle.position.set(0, 1.4, -3.9); kitchen.add(bottle);
  const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 1.6, -3); camera.lookAt(bottle.position);
  const items = collectApartmentPickables(scene), ui = { setInteraction: vi.fn(), setCarryHint: vi.fn() };
  const interaction = new ApartmentObjectInteraction(physics, scene, items, camera, ui);
  cleanup.push(() => { interaction.dispose(); bottle.geometry.dispose(); (bottle.material as THREE.Material).dispose(); });
  return { physics, scene, kitchen, bottle, camera, items, ui, interaction };
}
it('keeps glass, label and hidden props intact when preparing static batches', () => {
  const root = new THREE.Group(), kitchen = new THREE.Group(), glass = new THREE.Group(); kitchen.name = 'KitchenStuff'; glass.name = 'use_KitchenStuff'; root.add(kitchen, glass);
  const bottle = new THREE.Mesh(new THREE.BoxGeometry(.08, .3, .08), new THREE.MeshBasicMaterial());
  const label = new THREE.Mesh(new THREE.BoxGeometry(.081, .12, .081), bottle.material); glass.add(bottle); kitchen.add(label);
  const hidden = bottle.clone(); hidden.visible = false; kitchen.add(hidden);
  const large = bottle.clone(); large.scale.setScalar(20); large.position.x = 8; kitchen.add(large);
  const items = collectApartmentPickables(root); expect(items).toHaveLength(1); expect(items[0]!.parts).toEqual(expect.arrayContaining([bottle, label]));
  batchStaticMeshes(root, 3.5); expect(bottle.parent).toBe(glass); expect(label.parent).toBe(kitchen);
  bottle.geometry.dispose(); label.geometry.dispose(); (bottle.material as THREE.Material).dispose();
});
it('carries, rotates and drops a real body without extra physics steps, then cleans up ownership', async () => {
  const { physics, bottle, kitchen, ui, interaction } = await fixture(); const count = physics.world.bodies.len(), step = vi.spyOn(physics.world, 'step');
  interaction.update(true); expect(ui.setInteraction).toHaveBeenLastCalledWith('Prendre · Objet de cuisine');
  expect(interaction.interact()).toBe(true); expect(interaction.isHolding).toBe(true); expect(physics.world.bodies.len()).toBe(count);
  interaction.setRotating(true); expect(interaction.rotate(80, 0)).toBe(true);
  for (let tick = 0; tick < 60; tick++) { interaction.beforePhysicsStep(); physics.move({ x: 0, y: -.015, z: 0 }); interaction.update(true); }
  expect(step).toHaveBeenCalledTimes(60); expect(bottle.parent!.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(.2);
  const y = bottle.getWorldPosition(new THREE.Vector3()).y; interaction.interact(); expect(interaction.isHolding).toBe(false);
  for (let tick = 0; tick < 90; tick++) { physics.move({ x: 0, y: -.015, z: 0 }); interaction.update(true); }
  expect(bottle.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(y - .5); expect(bottle.getWorldPosition(new THREE.Vector3()).y).toBeGreaterThan(.03);
  interaction.dispose(); expect(physics.world.bodies.len()).toBe(count - 1); expect(bottle.parent).toBe(kitchen);
});
it('stops a carried prop at a solid wall and cannot pick it up through the wall', async () => {
  const { physics, bottle, camera, interaction } = await fixture(true); expect(interaction.interact()).toBe(true);
  camera.position.z = -4; camera.lookAt(0, 1.4, -8); interaction.adjustDistance(1); interaction.adjustDistance(1);
  for (let tick = 0; tick < 120; tick++) { interaction.beforePhysicsStep(); physics.move({ x: 0, y: -.015, z: 0 }); interaction.update(true); }
  expect(bottle.getWorldPosition(new THREE.Vector3()).z).toBeGreaterThan(-4.5);
  interaction.release(); camera.position.z = -5.2; camera.lookAt(bottle.getWorldPosition(new THREE.Vector3())); expect(interaction.interact()).toBe(false);
});
it('lets a held object push a never-grabbed neighbour without losing the grip at a light contact',async()=>{
  const {physics,scene,interaction,camera}=await fixture();interaction.dispose();
  physics.addChunk('support-table',[{id:'table-top',center:{x:0,y:1.2,z:-3.9},halfExtents:{x:1,y:.05,z:.5},kind:'barrier'}],{x:0,y:0,z:0});
  const kitchen=scene.getObjectByName('KitchenStuff')!,second=new THREE.Mesh(new THREE.BoxGeometry(.08,.3,.08),new THREE.MeshStandardMaterial());second.name='untouched';second.position.set(.22,1.4,-3.9);kitchen.add(second);
  const objects=new ApartmentObjectInteraction(physics,scene,collectApartmentPickables(scene),camera,{setInteraction(){}});cleanup.push(()=>{objects.dispose();second.geometry.dispose();(second.material as THREE.Material).dispose();});
  expect(objects.interact()).toBe(true);const before=second.getWorldPosition(new THREE.Vector3());camera.position.x+=.3;
  for(let i=0;i<60;i++){objects.beforePhysicsStep();physics.stepDynamics(1/60);objects.update(false);}
  expect(objects.isHolding).toBe(true);expect(second.getWorldPosition(new THREE.Vector3()).x-before.x).toBeGreaterThan(.07);
});

it('tolerates brief and sliding wall contact, pulls an object out of a two-wall corner, and releases a sustained jam gently',async()=>{
  const {physics,bottle,camera,interaction}=await fixture(true);
  physics.addChunk('corner-side',[{id:'side',center:{x:.86,y:1.4,z:-4.1},halfExtents:{x:.06,y:1.4,z:.5},kind:'wall'}],{x:0,y:0,z:0});
  const tick=()=>{interaction.beforePhysicsStep();physics.stepDynamics(1/60);interaction.update(false);};
  expect(interaction.interact()).toBe(true);
  camera.position.z=-4;camera.lookAt(0,1.4,-6);
  for(let i=0;i<24;i++)tick();expect(interaction.isHolding).toBe(true);
  const start=bottle.getWorldPosition(new THREE.Vector3());
  for(let i=0;i<60;i++){camera.position.x+=.008;tick();expect(interaction.isHolding).toBe(true);expect(bottle.getWorldPosition(new THREE.Vector3()).z).toBeGreaterThan(-4.51);}
  expect(bottle.getWorldPosition(new THREE.Vector3()).x-start.x).toBeGreaterThan(.2);
  camera.position.x=.67;for(let i=0;i<24;i++)tick();expect(interaction.isHolding).toBe(true);
  camera.position.set(.1,1.75,-3);camera.lookAt(.1,1.5,-3.8);
  for(let i=0;i<45;i++)tick();expect(interaction.isHolding).toBe(true);expect(bottle.getWorldPosition(new THREE.Vector3()).z).toBeGreaterThan(-4.35);
  camera.position.set(.1,1.75,-4.15);camera.lookAt(.1,1.5,-7);
  for(let i=0;i<210;i++)tick();expect(interaction.isHolding).toBe(false);
  const body=[...(interaction as unknown as {moving:Map<string,{body:import('@dimforge/rapier3d').RigidBody}>}).moving.values()][0]!.body;
  expect(new THREE.Vector3().copy(body.linvel()).length()).toBeLessThan(4);expect(bottle.getWorldPosition(new THREE.Vector3()).z).toBeGreaterThan(-4.51);
});

it('bounds a simultaneous twenty-glass break to 24 fragments and one sound while saving every broken identity',async()=>{
  const physics=await PhysicsWorld.create(createStairwellPlan()),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();
  const geometry=new THREE.BoxGeometry(.06,.12,.06),material=new THREE.MeshStandardMaterial(),items:ApartmentPickable[]=[];
  for(let i=0;i<20;i++){
    const mesh=new THREE.Mesh(geometry,material);mesh.position.set((i%5-2)*.18,2.5,-3.4-Math.floor(i/5)*.18);scene.add(mesh);mesh.updateMatrixWorld(true);
    items.push({id:`prop:stress/glass-${i}`,label:'Verre',parts:[mesh],bounds:new THREE.Box3().setFromObject(mesh,true),kind:'glass',breakable:true,mass:.12});
  }
  const broke=vi.fn(),objects=new ApartmentObjectInteraction(physics,scene,items,camera,{setInteraction(){}},broke);
  try{
    const moving=(objects as unknown as {moving:Map<string,{body:import('@dimforge/rapier3d').RigidBody}>}).moving;
    for(const prop of moving.values())prop.body.setLinvel({x:0,y:-3,z:0},true);
    for(let i=0;i<120;i++){physics.stepDynamics(1/60);objects.update(false);}
    expect(objects.debugState.broken).toBe(20);expect(objects.debugState.fragments).toBe(24);
    expect(broke.mock.calls.filter(call=>call[2]!==false)).toHaveLength(1);
    const saved=sanitizeApartmentObjects(JSON.parse(JSON.stringify(objects.getProgress())));expect(Object.keys(saved!.broken)).toHaveLength(20);
  }finally{objects.dispose();physics.dispose();geometry.dispose();material.dispose();}
});
