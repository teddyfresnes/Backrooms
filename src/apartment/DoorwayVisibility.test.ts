import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { loadApartmentModel } from '../../tests/support/load-apartment-model';
import { ImportedApartmentEnvironment } from './ImportedApartmentEnvironment';
import { SpecialNeighborDoor } from '../stairwell/SpecialNeighborDoor';
import { SPECIAL_NEIGHBOR_DOOR } from '../stairwell/NeighborProfiles';
import { StairwellEnvironment } from '../stairwell/StairwellEnvironment';
import type { StairwellMaterialSet } from '../stairwell/StairwellMaterials';
const cleanup:(()=>void)[]=[];
afterEach(()=>{cleanup.splice(0).reverse().forEach(fn=>fn());vi.unstubAllGlobals();});
async function fixture(){
 const e=new (ImportedApartmentEnvironment as unknown as {new(m:THREE.Object3D):ImportedApartmentEnvironment})(await loadApartmentModel());cleanup.push(()=>e.dispose());
 await (e as unknown as {prepareRuntime():Promise<void>}).prepareRuntime();return e;
}
function visibleMeshes(root:THREE.Object3D):THREE.Mesh[]{const meshes:THREE.Mesh[]=[];root.traverseVisible(o=>{if(o instanceof THREE.Mesh&&!(o.material as THREE.Material).transparent)meshes.push(o);});return meshes;}
it('keeps the real batched doorway free of static screens from both sides and throughout opening/closing',async()=>{
 const e=await fixture(),ray=new THREE.Raycaster();
 for(const powered of [true,false])for(const lit of [true,false]){
  e.setPowerAvailable(powered);e.setInteriorLightsEnabled(lit);
  for(const angle of [-.0001,-.15,-.7,-1.63,-.7,-.15,-.0001]){
   e.entryDoor.pivot.rotation.y=angle;e.group.updateMatrixWorld(true);
   for(const x of [-1.1,-3.1]){
    const viewer=new THREE.Vector3(x,e.floorY+1.6,e.doorCenter.z);e.updateVisibility(viewer);
    // At every angle the interior participates. If it vanished the camera
    // would see the scene background in place of an actual unlit room.
    expect(e.group.getObjectByName('imported-sketchfab-apartment')!.visible).toBe(true);
    if(angle===-1.63)for(const offset of [-.2,0,.2]){
     ray.set(new THREE.Vector3(x,viewer.y,e.doorCenter.z+offset),new THREE.Vector3(x>-2?-1:1,0,0));ray.far=x>-2?1.3:1.35;
     const hits=ray.intersectObjects(visibleMeshes(e.group),false);
     expect(hits.map(h=>h.object.name),`threshold ${x}, ${offset}`).toEqual([]);
    }
   }
  }
 }
});
it('preserves surface reflectance when the circuit is off, while its actual lights and fixture emissions go off',async()=>{
 const e=await fixture();e.setInteriorLightsEnabled(true);
 const meshes=visibleMeshes(e.group).filter(m=>m.material instanceof THREE.MeshStandardMaterial&&(m.material as THREE.Material).name.endsWith('light-responsive'));
 expect(meshes.length).toBeGreaterThan(10);
 const colors=meshes.map(m=>(m.material as THREE.MeshStandardMaterial).color.clone());
 e.setInteriorLightsEnabled(false);e.setPowerAvailable(false);
 meshes.forEach((m,i)=>expect((m.material as THREE.MeshStandardMaterial).color.equals(colors[i]!)).toBe(true));
 const light=e.group.getObjectByName('imported-apartment-main-ceiling-light') as THREE.PointLight;expect(light.intensity).toBe(0);
 const diffuser=meshes.find(m=>(m.material as THREE.MeshStandardMaterial).name.includes('main-fixture-luminous'));
 if(diffuser)expect((diffuser.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0);
});
it('keeps the complete exterior facade out of the doorway from both sides, through partial opening and at oblique angles',async()=>{
 const e=await fixture(),gradient={addColorStop(){}};
 const context=new Proxy({createLinearGradient:()=>gradient,createRadialGradient:()=>gradient},{get:(t,k)=>Reflect.get(t,k)??(()=>undefined)});
 vi.stubGlobal('document',{createElement:()=>({width:0,height:0,getContext:()=>context})});
 const material=new THREE.MeshStandardMaterial(),materials=new Proxy({},{get:()=>material}) as StairwellMaterialSet;
 const hall=new StairwellEnvironment(materials);cleanup.push(()=>material.dispose(),()=>hall.dispose());
 const scene=new THREE.Scene();scene.add(hall.group,e.group);scene.updateMatrixWorld(true);
 const ray=new THREE.Raycaster();
 for(const angle of [-.15,-.7,e.entryDoor.openAngle])for(const x of [-.8,-1.4,-3.2])for(const offset of [-.22,0,.22])for(const skew of [-.08,0,.08]){
  e.entryDoor.pivot.rotation.y=angle;e.group.updateMatrixWorld(true);
  const viewer=new THREE.Vector3(x,e.floorY+1.6,e.doorCenter.z+offset);e.updateVisibility(viewer);
  ray.set(viewer,new THREE.Vector3(x>-2?-1:1,0,skew).normalize());ray.far=x>-2?(-x+4.2):1.6;
  const hits=ray.intersectObjects(visibleMeshes(scene),false);
  expect(hits.filter(h=>h.object.name==='static-batch-exterior-facade'),`angle ${angle}, x ${x}, offset ${offset}, skew ${skew}`).toEqual([]);
  if(angle===e.entryDoor.openAngle&&skew===0)expect(hits.filter(h=>h.distance<Math.abs(x+2.05)+.35)).toEqual([]);
 }
});
it('keeps both reparented blinds physically lit matte cloth, with no emission or baked light during a power cut',async()=>{
 const e=await fixture();e.setInteriorLightsEnabled(true);e.setPowerAvailable(false);
 for(const blind of e.windowBlinds)blind.blind.traverse(o=>{
  if(!(o instanceof THREE.Mesh))return;
  for(const material of Array.isArray(o.material)?o.material:[o.material]){
   expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
   const cloth=material as THREE.MeshStandardMaterial;expect(cloth.name).toContain('light-responsive');
   expect(cloth.metalness).toBe(0);expect(cloth.roughness).toBeGreaterThanOrEqual(.9);expect(cloth.emissiveIntensity).toBe(0);expect(cloth.emissive.getHex()).toBe(0);expect(cloth.lightMap).toBeNull();
  }
 });
});
it('reveals a real recessed back wall through the special opening, beyond the moving leaf and masonry reveal',async()=>{
 const e=await fixture(),leaf=e.group.getObjectByName(SPECIAL_NEIGHBOR_DOOR)!;
 const box=new THREE.Box3().setFromObject(leaf),ray=new THREE.Raycaster();
 const special=new SpecialNeighborDoor(leaf,()=>{});cleanup.push(()=>special.dispose());special.start();special.update(.3);e.group.updateMatrixWorld(true);
 ray.set(new THREE.Vector3(1.1,box.min.y+1.5,box.min.z+.025),new THREE.Vector3(1,0,0));ray.far=4;
 const hits=ray.intersectObjects(visibleMeshes(e.group),false);
 expect(hits[0]?.object.name).toBe('neighbor-alcove-back-wall');
 expect(hits[0]!.point.x).toBeGreaterThan(box.max.x+1);
});
