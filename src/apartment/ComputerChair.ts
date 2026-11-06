import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { geometryIslands } from './GeometryIslands';
import type { StaticCollider } from '../world/types';
export const COMPUTER_FLOOR=8.6713203;
export const COMPUTER_SEAT=new THREE.Vector3(-6.974,9.1389808,-4.494);
export const COMPUTER_STANDING=new THREE.Vector3(-6.974,COMPUTER_FLOOR+.865,-4.72);
export class ComputerChair {
  private readonly anchor=new THREE.Group();
  private readonly parent:THREE.Object3D;
  private readonly matrix:THREE.Matrix4;
  private readonly auto:boolean;
  private readonly key='computer-chair';
  private progress=0;
  constructor(private readonly chair:THREE.Object3D,container:THREE.Object3D,private readonly physics:PhysicsWorld){
    chair.updateWorldMatrix(true,true);this.parent=chair.parent!;this.matrix=chair.matrix.clone();this.auto=chair.matrixAutoUpdate;
    this.anchor.name='computer-chair-motion';this.anchor.position.copy(COMPUTER_SEAT);container.add(this.anchor);this.anchor.updateWorldMatrix(true,false);
    const colliders:StaticCollider[]=[];
    chair.traverse(o=>{const mesh=o as THREE.Mesh;if(!mesh.isMesh)return;const positions=mesh.geometry.getAttribute('position');
      for(const island of geometryIslands(mesh)){const vertices:number[]=[],v=new THREE.Vector3();for(const i of island.vertices){v.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld).sub(COMPUTER_SEAT);vertices.push(v.x,v.y,v.z);}if(vertices.length>=12)colliders.push({id:`chair-part-${colliders.length}`,center:{x:0,y:0,z:0},halfExtents:{x:1,y:1,z:1},vertices,kind:'barrier'});}
    });
    this.physics.addKinematicChunk(this.key,colliders);this.anchor.attach(chair);chair.matrixAutoUpdate=true;this.setOffset(0);
  }
  canMoveTo(offset:number):boolean {
    const delta=offset-this.progress,length=Math.abs(delta);if(length<.002)return true;
    const body=this.physics.getChunkCollider(this.key,'chair-part-0')?.parent();if(!body)return false;
    const direction=new THREE.Vector3(0,0,Math.sign(delta));
    for(let i=0;i<body.numColliders();i++){const c=body.collider(i),hit=this.physics.world.castShape(c.translation(),c.rotation(),direction,c.shape,.002,length,false,undefined,undefined,c,body,this.physics.isInteractionObstacle);
      if(hit&&hit.time_of_impact<length-.005&&new THREE.Vector3().copy(hit.normal1).dot(direction)<-.3)return false;
    }return true;
  }
  setOffset(offset:number):void{this.progress=THREE.MathUtils.clamp(offset,0,.35);this.anchor.position.copy(COMPUTER_SEAT).add(new THREE.Vector3(0,0,this.progress));this.anchor.updateMatrixWorld(true);this.physics.setKinematicChunkTransform(this.key,this.anchor.position,this.anchor.quaternion);}
  get offset():number{return this.progress;}
  get seat():THREE.Vector3{return COMPUTER_SEAT.clone().add(new THREE.Vector3(0,0,this.progress));}
  dispose():void{this.physics.removeChunk(this.key);this.parent.add(this.chair);this.chair.matrix.copy(this.matrix);this.matrix.decompose(this.chair.position,this.chair.quaternion,this.chair.scale);this.chair.matrixAutoUpdate=this.auto;this.anchor.removeFromParent();}
}
