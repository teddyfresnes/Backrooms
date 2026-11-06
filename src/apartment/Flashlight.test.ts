import {expect,it,vi} from 'vitest';
vi.mock('@dimforge/rapier3d',()=>({default:{Ray:class{constructor(readonly origin:unknown,readonly dir:unknown){}}}}));
import * as THREE from 'three';
import {Flashlight} from './Flashlight';
import type {PhysicsWorld} from '../physics/PhysicsWorld';
it('emits from the equipped lens toward the view target, reaches distant surfaces and dims only for close obstacles without shadow maps',()=>{
  let distance=12;const physics={world:{castRay:()=>({timeOfImpact:distance})},isEnvironmentCollider:()=>true}as unknown as PhysicsWorld;
  const scene=new THREE.Scene(),torch=new Flashlight(scene,physics),camera=new THREE.PerspectiveCamera();camera.position.set(0,1.6,0);camera.updateMatrixWorld(true);
  try{
    torch.update(camera,new THREE.Vector3(.24,1.3,-.3),true,true,true,1/60,false);
    const lens=new THREE.Vector3(0,.277,0).applyMatrix4(torch.model.matrixWorld);expect(torch.light.position.distanceTo(lens)).toBeLessThan(.00001);
    expect(torch.light.distance).toBe(28);expect(torch.light.angle).toBeGreaterThan(.45);expect(torch.light.decay).toBe(1);expect(torch.light.intensity).toBe(32);expect(torch.light.castShadow).toBe(false);
    expect(torch.light.target.position.distanceTo(new THREE.Vector3(0,1.6,-12))).toBeLessThan(.00001);
    distance=.25;torch.update(camera,undefined,true,true,true,1/60,false);expect(torch.light.intensity).toBeLessThan(4);expect(torch.light.distance).toBe(28);
    torch.update(camera,undefined,true,false,true,1/60,false);expect(torch.light.intensity).toBe(0);expect(torch.model.visible).toBe(false);
  }finally{torch.dispose();}
});
