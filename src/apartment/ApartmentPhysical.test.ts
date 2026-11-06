import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
vi.mock('@dimforge/rapier3d', async () => {
  const rapier = await import('@dimforge/rapier3d-compat'); await rapier.init(); return rapier;
});
import RAPIER from '@dimforge/rapier3d';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { createStairwellPlan } from '../stairwell/createStairwellPlan';
import { ImportedApartmentEnvironment } from './ImportedApartmentEnvironment';
import { ApartmentObjectInteraction } from './ApartmentObjectInteraction';
import { collectApartmentPickables } from './ApartmentPickables';
import { loadApartmentModel } from '../../tests/support/load-apartment-model';
import {sanitizeApartmentObjects,type ApartmentObjectsProgress}from './ApartmentInteractionState';
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).reverse().forEach(fn => fn()));
const step = (physics: PhysicsWorld, objects: ApartmentObjectInteraction, count: number, holding = false) => {
  for (let i = 0; i < count; i++) { if (holding) objects.beforePhysicsStep(); physics.stepDynamics(1 / 60); objects.update(false); }
};
async function apartmentFixture(progress?:ApartmentObjectsProgress) {
  const model = await loadApartmentModel();
  const environment = new (ImportedApartmentEnvironment as unknown as { new(model: THREE.Object3D): ImportedApartmentEnvironment })(model);
  const physics = await PhysicsWorld.create(createStairwellPlan()); cleanup.push(() => physics.dispose()); cleanup.push(() => environment.dispose());
  const scene = new THREE.Scene(); scene.add(environment.group);
  physics.addTrimeshChunk('actual-apartment', environment.shellColliderMeshes);
  physics.addChunk('actual-furniture', environment.furnitureColliders, { x: 0, y: 0, z: 0 });
  const camera = new THREE.PerspectiveCamera(), ui = { setInteraction: vi.fn(), setCarryHint: vi.fn() };
  const objects = new ApartmentObjectInteraction(physics, scene, environment.pickables, camera, ui,undefined,false,progress); cleanup.push(() => objects.dispose());
  return { environment, physics, scene, camera, objects, ui };
}
it('leaves the real cabinet working space clear while retaining the exact counter surface', async () => {
  const { environment, physics } = await apartmentFixture();
  expect(environment.furnitureColliders.some(c => c.id === 'imported-cabinets')).toBe(false);
  const aboveCounter = physics.world.castRay(new RAPIER.Ray({ x: -6.2, y: 9.95, z: -.9 }, { x: 0, y: 0, z: 1 }), 1.0, true,
    undefined, undefined, undefined, undefined, physics.isEnvironmentCollider);
  expect(aboveCounter).toBeNull();
  const worktop = physics.world.castRay(new RAPIER.Ray({ x: -6.2, y: 10, z: .15 }, { x: 0, y: -1, z: 0 }), 1, true,
    undefined, undefined, undefined, undefined, physics.isEnvironmentCollider);
  expect(worktop).not.toBeNull(); expect(10 - worktop!.timeOfImpact).toBeCloseTo(9.575, 2);
});
it('picks, places and picks up a real exported glass on the actual kitchen counter', async () => {
  const { environment, physics, camera, objects, ui } = await apartmentFixture();
  const item = environment.pickables.find(item => item.parts.some(part => part.name === 'pCylinder60'))!;
  expect(item).toBeDefined(); const center = item.bounds.getCenter(new THREE.Vector3());
  camera.position.set(center.x, 10.1, -.95); camera.lookAt(center); objects.update(true);
  expect(ui.setInteraction).toHaveBeenLastCalledWith('Prendre · Verre'); expect(objects.interact()).toBe(true);
  step(physics, objects, 50, true);
  camera.position.set(center.x, 9.96, -.53); camera.lookAt(center.x, 9.61, .15); step(physics, objects, 90, true);
  objects.release(); step(physics, objects, 180);
  const placed = item.parts[0]!.getWorldPosition(new THREE.Vector3()), bounds = new THREE.Box3().setFromObject(item.parts[0]!, true);
  expect(bounds.min.y).toBeGreaterThan(9.56); expect(bounds.min.y).toBeLessThan(9.60);
  camera.lookAt(placed); expect(objects.interact()).toBe(true); expect(objects.isHolding).toBe(true);
});
it('creates every real book body before the first grab, rests without jitter, and drops the stack when its bottom book is removed', async () => {
  const { environment, physics, camera, objects } = await apartmentFixture();
  const books = environment.pickables.filter(item => item.supportCluster === 'books'); expect(books).toHaveLength(9);
  const poses = books.map(item => item.parts[0]!.getWorldPosition(new THREE.Vector3())); step(physics, objects, 180);
  for (let i = 0; i < books.length; i++) expect(books[i]!.parts[0]!.getWorldPosition(new THREE.Vector3()).distanceTo(poses[i]!)).toBeLessThan(.003);
  const stack = books.filter(item => item.id.startsWith('apartment-book-books1-')).sort((a, b) => a.bounds.min.y - b.bounds.min.y);
  const support = stack[0]!, upper = stack[2]!, topBefore = upper.parts[0]!.getWorldPosition(new THREE.Vector3()).y;
  const center = support.bounds.getCenter(new THREE.Vector3()); camera.position.set(center.x, center.y, center.z + .8); camera.lookAt(center);
  expect(objects.interact()).toBe(true); camera.position.z += .6;
  step(physics, objects, 180, true);
  expect(upper.parts[0]!.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(topBefore - .025);
});
it('keeps the radio a fixed appliance: never pickable, one static body', async () => {
  const { environment } = await apartmentFixture();
  expect(environment.pickables.find(item => item.appliance === 'radio')).toBeUndefined();
  expect(environment.furnitureColliders.filter(c => c.id === 'imported-radio-fixed')).toHaveLength(1);
});
async function bottleFixture(wall = false, restoredBroken = false) {
  const physics = await PhysicsWorld.create(createStairwellPlan()); cleanup.push(() => physics.dispose());
  physics.addChunk('high-floor', [{ id: 'floor-20', center: { x: 0, y: 19.9, z: -4 }, halfExtents: { x: 3, y: .1, z: 3 }, kind: 'floor' },
    ...(wall ? [{ id: 'impact-wall', center: { x: 0, y: 21, z: -5 }, halfExtents: { x: 1, y: 1, z: .05 }, kind: 'wall' as const }] : [])], { x: 0, y: 0, z: 0 });
  const scene = new THREE.Scene(), bottle = new THREE.Mesh(new THREE.BoxGeometry(.08, .3, .08), new THREE.MeshStandardMaterial()); bottle.name = 'whisky'; bottle.position.set(0, 20.15, -3.9); scene.add(bottle);
  const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 20.5, -3); camera.lookAt(bottle.position);
  const broke = vi.fn(), objects = new ApartmentObjectInteraction(physics, scene, collectApartmentPickables(scene), camera, { setInteraction() {} }, broke, restoredBroken);
  cleanup.push(() => { objects.dispose(); bottle.geometry.dispose(); (bottle.material as THREE.Material).dispose(); });
  return { physics, camera, objects, bottle, broke };
}
it('keeps a gentle bottle placement intact even on a floor at world altitude 20', async () => {
  const { physics, objects, broke } = await bottleFixture(); expect(objects.interact()).toBe(true); objects.release(); step(physics, objects, 180);
  expect(broke).not.toHaveBeenCalled();
});
it('does not break the bottle from carrying motion or pressure against a wall while held', async () => {
  const { physics, camera, objects, broke } = await bottleFixture(true);
  expect(objects.interact()).toBe(true); camera.position.z = -4.8; camera.lookAt(0, 20.5, -7);
  step(physics, objects, 140, true); expect(objects.isHolding).toBe(false); expect(broke).not.toHaveBeenCalled();
});
it('breaks a bottle at the actual high-drop impact, hides its interaction and cleans every fragment body', async () => {
  const { physics, camera, objects, bottle, broke } = await bottleFixture(); const initial = physics.world.bodies.len();
  expect(objects.interact()).toBe(true); camera.position.y = 22.6; camera.lookAt(0, 22.25, -3.9); step(physics, objects, 100, true);
  expect(broke).not.toHaveBeenCalled(); objects.release(); expect(broke).not.toHaveBeenCalled(); step(physics, objects, 6); expect(broke).not.toHaveBeenCalled();
  step(physics, objects, 160); expect(broke).toHaveBeenCalledOnce(); expect(bottle.visible).toBe(false); expect(objects.interact()).toBe(false);
  expect(objects.getProgress().deposits.some(d=>d.kind==='whisky'&&Math.abs(d.position.y-20)<.02)).toBe(true);
  step(physics, objects, 560); expect(physics.world.bodies.len()).toBe(initial - 1);
});
it('breaks a sufficiently fast throw only on contact, and never resurrects a saved broken bottle', async () => {
  const { physics, objects, broke } = await bottleFixture(true); expect(objects.interact()).toBe(true); objects.release(true);
  expect(broke).not.toHaveBeenCalled(); step(physics, objects, 120); expect(broke).toHaveBeenCalledOnce();
  const restored = await bottleFixture(false, true); expect(restored.bottle.visible).toBe(false); expect(restored.objects.interact()).toBe(false);
});

it.each(['plate','bottle','whisky'] as const)('breaks a real exported %s only at a sufficient impact and restores the broken state without fragments or sound',async(kind)=>{
  const {environment,physics,camera,objects}=await apartmentFixture();
  const items=environment.pickables.filter(item=>item.kind===kind).sort((a,b)=>b.bounds.max.y-a.bounds.max.y);
  expect(items.length).toBeGreaterThan(0);expect(items.every(item=>item.breakable)).toBe(true);
  // All authored sleeping dishes/bottles must survive initial contact solving.
  step(physics,objects,90);expect(objects.debugState.broken).toBe(0);
  const item=items[0]!,center=item.bounds.getCenter(new THREE.Vector3());
  if(kind==='plate')camera.position.set(center.x,center.y+.8,center.z);
  else camera.position.set(center.x,center.y+.1,center.z-.7);
  camera.lookAt(center);expect(objects.interact()).toBe(true);
  step(physics,objects,12,true);expect(objects.debugState.broken).toBe(0);
  camera.position.y+=2;camera.lookAt(center.x,center.y+1.8,center.z);step(physics,objects,110,true);
  expect(objects.isHolding).toBe(true);expect(objects.debugState.broken).toBe(0);
  objects.release();step(physics,objects,160);
  expect(objects.debugState.broken).toBeGreaterThan(0);
  const snapshot=sanitizeApartmentObjects(JSON.parse(JSON.stringify(objects.getProgress())))!;expect(snapshot).not.toBeNull();
  expect(Object.values(snapshot.broken).some(b=>b.kind===(kind==='plate'?'ceramic':kind==='whisky'?'whisky':'glass'))).toBe(true);
  expect(objects.debugState.fragments).toBeLessThanOrEqual(24);
  const restored=await apartmentFixture(snapshot);expect(restored.objects.debugState.broken).toBe(Object.keys(snapshot.broken).length);expect(restored.objects.debugState.fragments).toBe(0);
  for(const brokenId of Object.keys(snapshot.broken))expect(restored.environment.pickables.find(i=>i.id===brokenId)?.parts.every(part=>!part.visible)).toBe(true);
});
