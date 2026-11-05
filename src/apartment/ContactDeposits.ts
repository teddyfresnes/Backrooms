import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { DepositState } from './ApartmentInteractionState';

type Kind=DepositState['kind'];
/** Short ballistic paths stop on actual furniture triangles, then leave bounded contact patches. */
export class ContactDeposits {
  private readonly droplets:{mesh:THREE.Mesh;velocity:THREE.Vector3;life:number;kind:Kind}[]=[];
  private readonly patches:{mesh:THREE.Mesh;state:DepositState;life:number}[]=[];
  private readonly random;
  private readonly particleGeometry=new THREE.IcosahedronGeometry(.009,0);
  private readonly soilGeometry=new THREE.SphereGeometry(1,8,4);
  private readonly patchGeometry=new THREE.CircleGeometry(1,14);
  private readonly materials={whisky:new THREE.MeshStandardMaterial({color:0x9d5e19,emissive:0x2b1302,emissiveIntensity:.12,transparent:true,opacity:.68,roughness:.16,metalness:.12,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2}),soil:new THREE.MeshStandardMaterial({color:0x39271a,roughness:1,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2})};
  constructor(private readonly physics:PhysicsWorld,private readonly scene:THREE.Object3D,restored:readonly DepositState[]=[]){
    this.random=physics.createRandom('contact-deposits');for(const d of restored)this.patch(d.kind,new THREE.Vector3().copy(d.position),new THREE.Vector3().copy(d.normal),d.radius);
  }
  emit(kind:Kind,position:THREE.Vector3):void {
    const support=this.physics.world.castRayAndGetNormal(new RAPIER.Ray(position,{x:0,y:-1,z:0}),.45,true,undefined,undefined,undefined,undefined,this.physics.isEnvironmentCollider);
    if(support&&support.normal.y>.4)this.patch(kind,position.clone().add(new THREE.Vector3(0,-support.timeOfImpact,0)),new THREE.Vector3().copy(support.normal),kind==='whisky'?.16:.1);
    for(let i=0;i<18&&this.droplets.length<36;i++){
      const mesh=new THREE.Mesh(this.particleGeometry,this.materials[kind]);mesh.position.copy(position);mesh.scale.setScalar(kind==='soil'?1.8:1);this.scene.add(mesh);
      this.droplets.push({mesh,velocity:new THREE.Vector3(this.random.float(-1.1,1.1),this.random.float(.25,1.8),this.random.float(-1.1,1.1)),life:2.1,kind});
    }
  }
  private patch(kind:Kind,position:THREE.Vector3,normal:THREE.Vector3,radius:number):void {
    if(normal.y<.4)return;normal.normalize();
    // All eight footprint samples must be supported; never hang a puddle over a table edge.
    const tangent=new THREE.Vector3(1,0,0).projectOnPlane(normal).normalize(),bitangent=new THREE.Vector3().crossVectors(normal,tangent);let supported=false;
    for(let pass=0;pass<4;pass++){
      supported=true;
      for(let j=0;j<8;j++){
        const a=j*Math.PI/4,start=position.clone().addScaledVector(tangent,Math.cos(a)*radius).addScaledVector(bitangent,Math.sin(a)*radius).addScaledVector(normal,.035);
        const hit=this.physics.world.castRay(new RAPIER.Ray(start,normal.clone().negate()),.07,true,undefined,undefined,undefined,undefined,this.physics.isEnvironmentCollider);
        if(!hit||Math.abs(hit.timeOfImpact-.035)>.025){supported=false;break;}
      }
      if(supported)break;radius*=.64;
    }
    if(!supported||radius<.008)return;
    const nearby=this.patches.find(p=>p.state.kind===kind&&p.mesh.position.distanceToSquared(position)<.012&&new THREE.Vector3().copy(p.state.normal).dot(normal)>.95);
    if(nearby){nearby.life=240;return;}
    while(this.patches.length>=48)this.patches.shift()!.mesh.removeFromParent();
    const mesh=new THREE.Mesh(kind==='soil'?this.soilGeometry:this.patchGeometry,this.materials[kind]);mesh.position.copy(position).addScaledVector(normal,.0025);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);mesh.scale.set(radius,radius,kind==='soil'?Math.min(.018,radius*.18):radius);mesh.renderOrder=2;this.scene.add(mesh);
    const state:DepositState={kind,position:{x:position.x,y:position.y,z:position.z},normal:{x:normal.x,y:normal.y,z:normal.z},radius};this.patches.push({mesh,state,life:240});
  }
  step(dt:number):void {
    for(let i=this.droplets.length-1;i>=0;i--){
      const p=this.droplets[i]!;p.life-=dt;p.velocity.y-=9.81*dt;const delta=p.velocity.clone().multiplyScalar(dt),distance=delta.length();
      const hit=distance>0?this.physics.world.castRayAndGetNormal(new RAPIER.Ray(p.mesh.position,delta.clone().normalize()),distance+.006,true,undefined,undefined,undefined,undefined,this.physics.isEnvironmentCollider):null;
      if(hit){const contact=p.mesh.position.clone().addScaledVector(delta.normalize(),hit.timeOfImpact);this.patch(p.kind,contact,new THREE.Vector3().copy(hit.normal),p.kind==='whisky'?this.random.float(.055,.13):this.random.float(.035,.075));}
      else p.mesh.position.add(delta);
      if(hit||p.life<=0){p.mesh.removeFromParent();this.droplets.splice(i,1);}
    }
    for(let i=this.patches.length-1;i>=0;i--){const p=this.patches[i]!;p.life-=dt;const scale=Math.min(1,p.life/4),r=p.state.radius;p.mesh.scale.set(r*scale,r*scale,(p.state.kind==='soil'?Math.min(.018,r*.18):r)*scale);if(p.life<=0){p.mesh.removeFromParent();this.patches.splice(i,1);}}
  }
  hasParticles(kind:Kind):boolean{return this.droplets.some(p=>p.kind===kind);}
  snapshot():DepositState[]{return this.patches.map(p=>({...p.state,position:{...p.state.position},normal:{...p.state.normal}}));}
  get debugState(){return {particles:this.droplets.length,deposits:this.patches.length};}
  dispose():void{for(const p of [...this.patches,...this.droplets])p.mesh.removeFromParent();this.patches.length=0;this.droplets.length=0;this.patchGeometry.dispose();this.soilGeometry.dispose();this.particleGeometry.dispose();Object.values(this.materials).forEach(m=>m.dispose());}
}
