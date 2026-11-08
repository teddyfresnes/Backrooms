import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

import {createFlashlightModel} from './FlashlightModel';
export {createFlashlightModel} from './FlashlightModel';

export class Flashlight {
  readonly model=createFlashlightModel();
  readonly light=new THREE.SpotLight(0xfff2dc,0,28,.52,.68,1);
  private readonly target=new THREE.Object3D();
  private readonly ray=new THREE.Raycaster();
  private readonly direction=new THREE.Vector3(0,0,-1);
  private readonly smoothed=new THREE.Quaternion();
  private initialized=false;
  private readonly deskPosition=new THREE.Vector3(-7.47,9.54,-5.10);
  constructor(private readonly scene:THREE.Scene,private readonly physics:PhysicsWorld,desk?:THREE.Object3D){
    if(desk){
      desk.updateWorldMatrix(true,true);const box=new THREE.Box3().setFromObject(desk,true),point=new THREE.Vector3(box.max.x-.28,box.max.y+.3,box.max.z-.16);
      const hit=physics.world.castRay(new RAPIER.Ray(point,{x:0,y:-1,z:0}),.7,true,undefined,undefined,undefined,undefined,physics.isEnvironmentCollider);
      if(hit)this.deskPosition.set(point.x-.134,point.y-hit.timeOfImpact+.038,point.z);
    }
    this.model.position.copy(this.deskPosition);this.model.rotation.z=-Math.PI/2;scene.add(this.model,this.light,this.target);
    this.light.target=this.target;this.light.castShadow=false;
  }
  isTargeted(camera:THREE.Camera):boolean{
    camera.getWorldDirection(this.direction);this.ray.set(camera.position,this.direction);this.ray.far=2.15;
    const hit=this.ray.intersectObject(this.model,true)[0];if(!hit)return false;
    const wall=this.physics.world.castRay(new RAPIER.Ray(camera.position,this.direction),hit.distance,true,undefined,undefined,undefined,undefined,this.physics.isEnvironmentCollider);
    return !wall||wall.timeOfImpact>=hit.distance-.035;
  }
  /** `grip`, when the rig holds it, is the stable frame of the rubber grip (+Y toward the lens). */
  update(camera:THREE.Camera,hand:THREE.Vector3|undefined,owned:boolean,equipped:boolean,on:boolean,delta:number,reduced:boolean,grip?:{position:THREE.Vector3;quaternion:THREE.Quaternion},aimFromGrip=false):void {
    this.model.visible=!owned||equipped;this.light.intensity=owned&&equipped&&on?32:0;
    if(!owned){this.model.position.copy(this.deskPosition);return;}
    if(!equipped)return;
    const desired=new THREE.Quaternion();camera.getWorldDirection(this.direction);desired.setFromUnitVectors(new THREE.Vector3(0,1,0),this.direction);
    if(grip){this.smoothed.copy(grip.quaternion);this.initialized=true;}
    else if(!this.initialized||reduced){this.smoothed.copy(desired);this.initialized=true;}else this.smoothed.slerp(desired,1-Math.exp(-delta*19));
    const at=grip?.position??hand??new THREE.Vector3(.23,-.29,-.35).applyMatrix4(camera.matrixWorld);
    this.model.quaternion.copy(this.smoothed);this.model.position.copy(at).addScaledVector(new THREE.Vector3(0,1,0).applyQuaternion(this.smoothed),-.09);
    this.light.position.set(0,.277,0).applyQuaternion(this.smoothed).add(this.model.position);
    // Aim from the real lens toward the view ray, compensating the equipped
    // hand offset rather than sending a parallel beam past the crosshair.
    if(grip&&aimFromGrip)this.target.position.copy(this.light.position).addScaledVector(new THREE.Vector3(0,1,0).applyQuaternion(this.smoothed),12);
    else this.target.position.copy(camera.position).addScaledVector(this.direction,12);
    const beam=this.target.position.clone().sub(this.light.position).normalize();
    const obstruction=this.physics.world.castRay(new RAPIER.Ray(this.light.position,beam),28,true,undefined,undefined,undefined,undefined,this.physics.isEnvironmentCollider);
    // Keep the usable range; shortening distance to the nearest wall made the
    // cone's cutoff extinguish the very surface the player was trying to read.
    this.light.distance=28;
    if(obstruction)this.light.intensity*=THREE.MathUtils.lerp(.09,1,THREE.MathUtils.smoothstep(obstruction.timeOfImpact,.20,1.5));
    (this.model.getObjectByName('torch-lens') as THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>).material.emissiveIntensity=on?1.2:0;
    this.model.updateMatrixWorld(true);
  }
  dispose():void{this.model.removeFromParent();this.light.removeFromParent();this.target.removeFromParent();this.light.shadow.dispose();const materials=new Set<THREE.Material>();this.model.traverse(o=>{const m=o as THREE.Mesh;if(m.isMesh){m.geometry.dispose();for(const a of Array.isArray(m.material)?m.material:[m.material])materials.add(a);}});for(const m of materials)m.dispose();}
}
