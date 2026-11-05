import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { ApartmentPickable } from './ApartmentPickables';
import type { ApartmentObjectsProgress, PropPose, BrokenPropKind } from './ApartmentInteractionState';
import { geometryIslands } from './GeometryIslands';
import { ContactDeposits } from './ContactDeposits';
interface MovingProp {
  item: ApartmentPickable; anchor: THREE.Group; body: RAPIER.RigidBody; collider: RAPIER.Collider;
  colliders: RAPIER.Collider[]; radius: number; half: THREE.Vector3;
  impactVelocity: THREE.Vector3; breakGraceSteps: number;
  originals: {part:THREE.Object3D;parent:THREE.Object3D;matrix:THREE.Matrix4;auto:boolean;visible:boolean}[];
}
const RELEASED_GROUPS=(0x4000<<16)|0xffff,HELD_GROUPS=(0x4000<<16)|(0xffff&~0x1000&~0x2000),SHARD_GROUPS=(0x8000<<16)|0x0fff;
export const WHISKY_BREAK_IMPACT_SPEED=3.25;
export interface SinkVolume { minX:number;maxX:number;minZ:number;maxZ:number;bottom:number;surface:number }
/** Authored loose objects all have sleeping, fitted physical bodies before first contact. */
export class ApartmentObjectInteraction {
  private readonly moving=new Map<string,MovingProp>();
  private readonly broken=new Map<string,{kind:BrokenPropKind;position:THREE.Vector3}>();
  private readonly brokenProps:MovingProp[]=[];
  private readonly plants:{id:string;mesh:THREE.Object3D;anchor:THREE.Group;body:RAPIER.RigidBody}[]=[];
  private readonly fragments:{mesh:THREE.Mesh;body:RAPIER.RigidBody;remaining:number}[]=[];
  private readonly shardGeometry=new THREE.TetrahedronGeometry(.045);
  private readonly shardMaterial=new THREE.MeshStandardMaterial({color:0x8b662e,transparent:true,opacity:.78,roughness:.22,metalness:.12});
  private readonly potShardMaterial=new THREE.MeshStandardMaterial({color:0x967547,roughness:.9});
  private readonly ceramicShardMaterial=new THREE.MeshStandardMaterial({color:0xc5ccbe,roughness:.78});
  private readonly glassShardMaterial=new THREE.MeshStandardMaterial({color:0x73957d,transparent:true,opacity:.72,roughness:.22});
  private readonly deposits:ContactDeposits;
  private readonly random;
  private readonly unsubscribe:()=>void;
  private held?:MovingProp;
  private readonly stored=new Set<string>();
  private readonly raycaster=new THREE.Raycaster();
  private readonly direction=new THREE.Vector3();
  private readonly target=new THREE.Vector3();
  private readonly attemptedTarget=new THREE.Vector3();
  private readonly error=new THREE.Vector3();
  private readonly rotation=new THREE.Quaternion();
  private readonly rotationDelta=new THREE.Quaternion();
  private readonly bodyRotation=new THREE.Quaternion();
  private readonly sweepCenter=new THREE.Vector3();
  private readonly sweepHalf=new THREE.Vector3();
  private readonly sweepNormal=new THREE.Vector3();
  private readonly sweepRotation=new THREE.Quaternion();
  private readonly sweepVelocity=new THREE.Vector3();
  private readonly carryMotion=new THREE.Vector3();
  private readonly contactNormal=new THREE.Vector3();
  private readonly heldPrevious=new THREE.Vector3();
  private readonly sweepObstacles:RAPIER.Collider[]=[];
  private distance=1.25;
  private rotating=false;
  private prompted=false;
  private hoverElapsed=.1;
  private blockedTime=0;
  private sweepBlocked=false;
  private breakSoundCooldown=0;
  private readonly buoyantLastTick=new Set<MovingProp>();
  constructor(private readonly physics:PhysicsWorld,private readonly scene:THREE.Object3D,
    private readonly items:readonly ApartmentPickable[],private readonly camera:THREE.Camera,
    private readonly ui:{setInteraction(label:string|null):void;setCarryHint?(label:string|null):void},
    private readonly onBreak:(position:THREE.Vector3,kind?:BrokenPropKind,audible?:boolean)=>void=()=>{},whiskyBroken=false,
    progress?:ApartmentObjectsProgress){
    this.random=physics.createRandom('apartment-glass');this.deposits=new ContactDeposits(physics,scene,progress?.deposits);
    for(const item of items){
      const prop=this.createProp(item,true),saved=progress?.bodies[item.id];if(saved)this.restorePose(prop,saved);
      const broken=progress?.broken[item.id];
      if(broken){prop.body.setTranslation(broken.position,true);this.shatter(prop,true,progress?.bodies[item.id+'/plant']);if(broken.residuePending&&(broken.kind==='pot'||broken.kind==='whisky'))this.deposits.emit(broken.kind==='pot'?'soil':'whisky',new THREE.Vector3().copy(broken.position));}
      else if(item.kind==='whisky'&&whiskyBroken){this.broken.set(item.id,{kind:'whisky',position:new THREE.Vector3().copy(prop.body.translation())});this.moving.delete(item.id);this.brokenProps.push(prop);prop.anchor.visible=false;item.parts.forEach(p=>{p.visible=false;});physics.world.removeRigidBody(prop.body);}
    }
    const before=physics.onBeforeStep(()=>{
      for(const prop of this.moving.values())prop.impactVelocity.copy(prop.body.linvel());
    });
    const after=physics.onAfterStep(dt=>this.afterPhysicsStep(dt));
    this.unsubscribe=()=>{before();after();};
  }
  get isHolding():boolean{return !!this.held;}
  get heldInventoryItem():{id:string;label:string}|undefined {
    const p=this.held;if(!p||p.item.kind==='stool'||p.item.kind==='pot'||p.item.breakable||p.item.appliance||Math.max(p.half.x,p.half.y,p.half.z)*2>.34)return undefined;
    return {id:p.item.id,label:p.item.label};
  }
  setStored(ids:readonly string[]):void {
    const next=new Set(ids);
    for(const p of this.moving.values()){
      const stored=next.has(p.item.id);if(stored&&this.held===p)this.release();
      p.body.setEnabled(!stored);p.anchor.visible=!stored;
    }
    this.stored.clear();for(const id of next)this.stored.add(id);
  }
  /** Equipment reuses the exact stowed mesh; its disabled body never appears in the world twice. */
  presentEquipped(id:string|undefined,position?:THREE.Vector3,rotation?:THREE.Quaternion):void {
    for(const key of this.stored){const p=this.moving.get(key);if(!p)continue;p.anchor.visible=key===id&&!!position;
      if(p.anchor.visible){p.anchor.position.copy(position!);if(rotation)p.anchor.quaternion.copy(rotation);p.anchor.updateMatrixWorld(true);}
    }
  }
  takeStored(id:string):boolean {
    const p=this.moving.get(id);if(!p||!this.stored.has(id)||this.held)return false;
    this.camera.getWorldDirection(this.direction);const point=this.camera.position.clone().addScaledVector(this.direction,.8);
    const hit=this.physics.world.intersectionWithShape(point,{x:0,y:0,z:0,w:1},new RAPIER.Ball(p.radius),undefined,undefined,p.collider,p.body,this.physics.isEnvironmentCollider);
    if(hit)return false;
    this.stored.delete(id);p.body.setEnabled(true);p.body.setTranslation(point,true);p.body.setLinvel({x:0,y:0,z:0},true);p.body.setAngvel({x:0,y:0,z:0},true);
    p.anchor.position.copy(point);p.anchor.visible=true;this.held=p;this.distance=.8;this.rotation.copy(p.body.rotation());this.blockedTime=0;
    for(const c of p.colliders)c.setCollisionGroups(HELD_GROUPS);return true;
  }
  private findTarget():ApartmentPickable|undefined {
    this.camera.getWorldDirection(this.direction);this.raycaster.set(this.camera.position,this.direction);this.raycaster.far=2.15;
    let nearest=2.15,selected:ApartmentPickable|undefined;
    const wall=this.physics.world.castRay(new RAPIER.Ray(this.camera.position,this.direction),nearest,true,undefined,undefined,undefined,undefined,this.physics.isEnvironmentCollider);
    if(wall)nearest=Math.min(nearest,wall.timeOfImpact+.025);
    for(const item of this.items){
      if(this.broken.has(item.id)||this.stored.has(item.id))continue;const moved=this.moving.get(item.id),center=moved?.anchor.position??item.bounds.getCenter(this.target);
      if(center.distanceToSquared(this.camera.position)>7)continue;
      // The bottle's fitted physical hull is already resident in Rapier. The
      // exported bottle has hundreds of thousands of visual triangles: a full
      // Three raycast on each hover/click took ~11 ms on the CPU profile.
      if(item.kind==='whisky'&&moved){
        const ray=new RAPIER.Ray(this.camera.position,this.direction);
        for(const collider of moved.colliders){const distance=collider.castRay(ray,nearest,true);if(distance>=0&&distance<nearest){nearest=distance;selected=item;}}
        continue;
      }
      for(const part of item.parts){let visible=true;for(let p:THREE.Object3D|null=part;p;p=p.parent)visible&&=p.visible;if(!visible)continue;
        const hit=this.raycaster.intersectObject(part,true)[0];if(hit&&hit.distance<nearest){nearest=hit.distance;selected=item;}
      }
    }return selected;
  }
  private createProp(item:ApartmentPickable,sleeping=false):MovingProp {
    const bounds=new THREE.Box3();for(const part of item.parts)bounds.union(new THREE.Box3().setFromObject(part,true));
    const center=bounds.getCenter(new THREE.Vector3()),half=bounds.getSize(new THREE.Vector3()).multiplyScalar(.5).max(new THREE.Vector3(.008,.008,.008));
    const anchor=new THREE.Group();anchor.name=item.id;anchor.position.copy(center);this.scene.add(anchor);anchor.updateWorldMatrix(true,false);
    const originals=item.parts.map(part=>({part,parent:part.parent!,matrix:part.matrix.clone(),auto:part.matrixAutoUpdate,visible:part.visible}));
    const hulls:Float32Array[]=[],all:number[]=[],point=new THREE.Vector3();
    for(const part of item.collisionParts??item.parts)part.traverse(object=>{
      const mesh=object as THREE.Mesh;if(!mesh.isMesh||!mesh.visible)return;mesh.updateWorldMatrix(true,false);const attr=mesh.geometry.getAttribute('position');
      if(item.compound){for(const island of geometryIslands(mesh)){
        const points:number[]=[];for(const i of island.vertices){point.fromBufferAttribute(attr,i).applyMatrix4(mesh.matrixWorld).sub(center);points.push(point.x,point.y,point.z);}if(points.length>=12)hulls.push(new Float32Array(points));
      }}else for(let i=0;i<attr.count;i++){point.fromBufferAttribute(attr,i).applyMatrix4(mesh.matrixWorld).sub(center);all.push(point.x,point.y,point.z);}
    });
    if(all.length>=12)hulls.push(new Float32Array(all));
    for(const part of item.parts){anchor.attach(part);part.matrixAutoUpdate=true;}
    const body=this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(center.x,center.y,center.z)
      .setLinearDamping(.32).setAngularDamping(.8).setCanSleep(true).setSleeping(sleeping).setCcdEnabled(true).setAdditionalSolverIterations(3));
    body.userData={apartmentPropId:item.id,appliance:item.appliance};
    const mass=item.mass??THREE.MathUtils.clamp(half.x*half.y*half.z*8*450,.06,3),colliders:RAPIER.Collider[]=[];
    const shapes=hulls.map(vertices=>RAPIER.ColliderDesc.convexHull(vertices)).filter((d):d is RAPIER.ColliderDesc=>!!d);
    if(!shapes.length)shapes.push(RAPIER.ColliderDesc.cuboid(half.x,half.y,half.z));
    // Component volume prevents the long thin legs weighing as much as the seat.
    const weights=hulls.map(v=>{const b=new THREE.Box3().setFromArray(v),s=b.getSize(new THREE.Vector3());return Math.max(1e-7,s.x*s.y*s.z);});
    const total=weights.reduce((a,b)=>a+b,0);
    shapes.forEach((shape,i)=>{
      const collider=this.physics.world.createCollider(shape.setMass(mass*(weights.length===shapes.length?weights[i]!/total:1/shapes.length)).setFriction(.72).setRestitution(.025).setCollisionGroups(RELEASED_GROUPS),body);
      colliders.push(collider);
    });
    const prop={item,anchor,body,collider:colliders[0]!,colliders,radius:half.length(),half,originals,impactVelocity:new THREE.Vector3(),breakGraceSteps:12};this.moving.set(item.id,prop);return prop;
  }
  private restorePose(prop:MovingProp,pose:PropPose):void {
    prop.body.setTranslation(pose.position,true);prop.body.setRotation(pose.rotation,true);
    prop.anchor.position.copy(pose.position);prop.anchor.quaternion.copy(pose.rotation);prop.anchor.updateMatrixWorld(true);
    if(pose.sleeping)prop.body.sleep();
  }
  interact(throwHeld=false):boolean {
    if(this.held){this.release(throwHeld);return true;}const item=this.findTarget();if(!item)return false;
    const prop=this.moving.get(item.id)!;
    if(item.supportCluster||item.appliance)for(const other of this.moving.values())if(other.item.supportCluster==='books'||other.item.appliance==='radio')other.body.wakeUp();
    for(const c of prop.colliders)c.setCollisionGroups(HELD_GROUPS);prop.body.wakeUp();this.held=prop;this.rotation.copy(prop.body.rotation());this.blockedTime=0;
    this.distance=THREE.MathUtils.clamp(prop.anchor.position.distanceTo(this.camera.position),.7,1.8);this.ui.setCarryHint?.(null);this.ui.setInteraction('Poser l’objet');this.prompted=true;return true;
  }
  beforePhysicsStep():void {
    const prop=this.held;if(!prop)return;this.camera.getWorldDirection(this.direction);
    this.heldPrevious.copy(prop.body.translation());
    this.attemptedTarget.copy(this.camera.position).addScaledVector(this.direction,this.distance);this.target.copy(this.attemptedTarget);
    this.error.copy(this.target).sub(prop.body.translation());const length=this.error.length();this.sweepBlocked=false;
    if(length>4){this.release();return;}
    if(length>.002){
      this.carryMotion.copy(this.error);
      this.sweepCenter.copy(prop.body.translation()).add(this.target).multiplyScalar(.5);
      this.sweepHalf.copy(this.error).multiplyScalar(.5);this.sweepHalf.set(Math.abs(this.sweepHalf.x),Math.abs(this.sweepHalf.y),Math.abs(this.sweepHalf.z)).addScalar(prop.radius+.02);
      this.sweepObstacles.length=0;
      this.physics.world.collidersWithAabbIntersectingAabb(this.sweepCenter,this.sweepHalf,other=>{if(this.physics.isEnvironmentCollider(other))this.sweepObstacles.push(other);return true;});
      // world.castShape(collider.shape) rebuilt the original dense convex hull
      // on EVERY tick. Cast the two resident Rapier colliders instead: the same
      // fitted geometry/CCD and contact clearance, without hull construction.
      // Project the unreachable part onto contact planes, then sweep again from
      // the REAL body pose. Two walls form a corner; no speculative teleport or
      // rebuilt hull is needed to keep the remaining tangent motion available.
      for(let pass=0;pass<3;pass++){
        const distance=this.carryMotion.length();if(distance<.002)break;
        const velocity=this.sweepVelocity.copy(this.carryMotion).divideScalar(distance);let travel=distance,hitObstacle=false;
        for(const collider of prop.colliders)for(const other of this.sweepObstacles){
          const hit=collider.castCollider(velocity,other,{x:0,y:0,z:0},.003,travel,false);
          if(hit&&this.sweepNormal.copy(hit.normal2).applyQuaternion(this.sweepRotation.copy(other.rotation())).dot(velocity)<-.01){
            travel=Math.min(travel,Math.max(0,hit.time_of_impact-.004));this.contactNormal.copy(this.sweepNormal).normalize();hitObstacle=true;
          }
        }
        if(!hitObstacle)break;
        this.sweepBlocked=true;
        const inward=this.carryMotion.dot(this.contactNormal);
        this.carryMotion.addScaledVector(this.contactNormal,-Math.min(0,inward)*(1-travel/distance));
      }
      this.target.copy(prop.body.translation()).add(this.carryMotion);
    }
    const resistance=1+this.blockedTime*1.8;
    this.error.copy(this.target).sub(prop.body.translation()).multiplyScalar(11/resistance).clampLength(0,4/resistance);
    prop.body.setGravityScale(0,true);prop.body.setLinvel(this.error,true);
    this.rotationDelta.copy(this.rotation).multiply(this.bodyRotation.copy(prop.body.rotation()).invert()).normalize();
    if(this.rotationDelta.w<0)this.rotationDelta.set(-this.rotationDelta.x,-this.rotationDelta.y,-this.rotationDelta.z,-this.rotationDelta.w);
    prop.body.setAngvel(this.error.set(this.rotationDelta.x,this.rotationDelta.y,this.rotationDelta.z).multiplyScalar(16/resistance).clampLength(0,6/resistance),true);
  }
  private afterPhysicsStep(dt:number):void {
    this.breakSoundCooldown=Math.max(0,this.breakSoundCooldown-dt);
    if(this.held){
      const prop=this.held,offset=this.attemptedTarget.clone().sub(prop.body.translation());let obstructed=this.sweepBlocked;
      if(offset.lengthSq()>.03)for(const c of prop.colliders){const contacts:RAPIER.Collider[]=[];this.physics.world.contactPairsWith(c,o=>{if(this.physics.isEnvironmentCollider(o))contacts.push(o);});
        for(const other of contacts)this.physics.world.contactPair(c,other,(m,flipped)=>{const normal=new THREE.Vector3().copy(m.normal()).multiplyScalar(flipped?1:-1);if(normal.dot(offset)<-.025)obstructed=true;});
      }
      const progress=this.heldPrevious.distanceTo(new THREE.Vector3().copy(prop.body.translation()));
      const strained=obstructed&&offset.length()>.3&&progress<dt*.07;
      this.blockedTime=strained?this.blockedTime+dt*THREE.MathUtils.clamp((offset.length()-.18)/.5,.2,1):Math.max(0,this.blockedTime-dt*2);
      if(this.blockedTime>1.65)this.release();
    }
    const shattered:MovingProp[]=[];
    for(const prop of this.moving.values()){
      if(prop.breakGraceSteps>0){prop.breakGraceSteps--;continue;}
      if(this.stored.has(prop.item.id)||!prop.item.breakable||prop===this.held||prop.body.isSleeping())continue;
      let impulse=0,impactSpeed=0;for(const c of prop.colliders){const contacts:RAPIER.Collider[]=[];this.physics.world.contactPairsWith(c,o=>{if(!o.isSensor())contacts.push(o);});
        for(const other of contacts)this.physics.world.contactPair(c,other,m=>{
          for(let i=0;i<m.numContacts();i++)impulse+=Math.max(0,m.contactImpulse(i));
          const id=(other.parent()?.userData as {apartmentPropId?:string}|undefined)?.apartmentPropId;
          const otherVelocity=id?this.moving.get(id)?.impactVelocity:undefined;
          const v=prop.impactVelocity,n=m.normal();
          impactSpeed=Math.max(impactSpeed,Math.abs((v.x-(otherVelocity?.x??0))*n.x+(v.y-(otherVelocity?.y??0))*n.y+(v.z-(otherVelocity?.z??0))*n.z));
        });
      }
      const threshold=prop.item.kind==='pot'?3.5:prop.item.kind==='plate'?3.0:WHISKY_BREAK_IMPACT_SPEED;
      if(impactSpeed>=threshold*.5&&impulse/Math.max(.01,prop.body.mass())>=threshold)shattered.push(prop);
    }
    for(const prop of shattered)this.shatter(prop);
    this.deposits.step(dt);
    for(let i=this.fragments.length-1;i>=0;i--){const f=this.fragments[i]!;f.remaining-=dt;if(f.remaining<=0){f.mesh.removeFromParent();this.physics.world.removeRigidBody(f.body);this.fragments.splice(i,1);}}
  }
  private shatter(prop:MovingProp,restoring=false,plantPose?:PropPose):void {
    if(this.broken.has(prop.item.id))return;
    const position=new THREE.Vector3().copy(prop.body.translation()),velocity=prop.body.linvel(),kind:BrokenPropKind=prop.item.kind==='pot'?'pot':prop.item.kind==='whisky'?'whisky':prop.item.kind==='plate'?'ceramic':'glass';
    prop.anchor.position.copy(position);prop.anchor.quaternion.copy(prop.body.rotation());prop.anchor.updateMatrixWorld(true);
    if(kind==='pot'&&prop.item.plant){
      const mesh=prop.item.plant,center=new THREE.Box3().setFromObject(mesh,true).getCenter(new THREE.Vector3()),anchor=new THREE.Group();anchor.name=prop.item.id+'/plant';anchor.position.copy(center);this.scene.add(anchor);anchor.updateWorldMatrix(true,false);anchor.attach(mesh);mesh.matrixAutoUpdate=true;
      const body=this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(center.x,center.y,center.z).setLinearDamping(.8).setAngularDamping(1.3).setCcdEnabled(true));
      this.physics.world.createCollider(RAPIER.ColliderDesc.capsule(.085,.03).setMass(.16).setFriction(.9).setCollisionGroups(SHARD_GROUPS),body);
      if(plantPose){body.setTranslation(plantPose.position,true);body.setRotation(plantPose.rotation,true);if(plantPose.visualMatrix){mesh.matrix.fromArray(plantPose.visualMatrix);mesh.matrix.decompose(mesh.position,mesh.quaternion,mesh.scale);}if(plantPose.sleeping)body.sleep();}
      else body.setAngvel({x:.7,y:.2,z:.4},true);
      this.plants.push({id:prop.item.id+'/plant',mesh,anchor,body});
    }
    this.buoyantLastTick.delete(prop);this.broken.set(prop.item.id,{kind,position});this.moving.delete(prop.item.id);this.brokenProps.push(prop);prop.anchor.visible=false;prop.item.parts.forEach(p=>{p.visible=false;});this.physics.world.removeRigidBody(prop.body);
    if(restoring)return;
    if(kind==='pot'||kind==='whisky')this.deposits.emit(kind==='pot'?'soil':'whisky',position);
    for(let i=0;i<(kind==='pot'?8:9)&&this.fragments.length<24;i++){
      const mesh=new THREE.Mesh(this.shardGeometry,kind==='pot'?this.potShardMaterial:kind==='ceramic'?this.ceramicShardMaterial:kind==='glass'?this.glassShardMaterial:this.shardMaterial);mesh.scale.set(this.random.float(.45,1),this.random.float(.18,.4),this.random.float(.5,1.2));
      const body=this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x+this.random.float(-.04,.04),position.y+this.random.float(-.04,.05),position.z+this.random.float(-.04,.04))
        .setLinvel(velocity.x*.12+this.random.float(-.8,.8),this.random.float(.3,1.2),velocity.z*.12+this.random.float(-.8,.8)).setAngvel({x:this.random.float(-6,6),y:this.random.float(-6,6),z:this.random.float(-6,6)}).setLinearDamping(.7).setAngularDamping(1.2).setCcdEnabled(true));
      this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(.027*mesh.scale.x,.006,.03*mesh.scale.z).setMass(.012).setFriction(.8).setRestitution(.1).setCollisionGroups(SHARD_GROUPS),body);this.scene.add(mesh);this.fragments.push({mesh,body,remaining:9});
    }
    const audible=this.breakSoundCooldown===0;
    if(audible)this.breakSoundCooldown=.12;
    this.onBreak(position,kind,audible);
  }
  applyBuoyancy(water:SinkVolume,dt:number):void {
    for(const prop of this.buoyantLastTick){prop.body.resetForces(false);prop.body.resetTorques(false);}this.buoyantLastTick.clear();
    if(water.surface<=water.bottom+.002)return;
    for(const prop of this.moving.values()){
      if(prop===this.held||this.stored.has(prop.item.id))continue;const p=prop.body.translation();
      const rotation=new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().copy(prop.body.rotation())),e=rotation.elements;
      const halfY=Math.abs(e[1]!)*prop.half.x+Math.abs(e[5]!)*prop.half.y+Math.abs(e[9]!)*prop.half.z;
      if(p.x<water.minX||p.x>water.maxX||p.z<water.minZ||p.z>water.maxZ||p.y+halfY<water.bottom-.02)continue;
      const immersion=THREE.MathUtils.clamp((water.surface-(p.y-halfY))/(halfY*2),0,1);if(immersion<=0)continue;
      const lift=9.81*prop.body.mass()*(prop.item.buoyancy??.38)*immersion;
      if(prop.body.isSleeping()&&lift<prop.body.mass()*9.9)continue;
      const v=prop.body.linvel(),w=prop.body.angvel();
      const drag=Math.exp(-immersion*3*dt),spinDrag=Math.exp(-immersion*5*dt);
      prop.body.addForce({x:0,y:lift,z:0},true);prop.body.setLinvel({x:v.x*drag,y:v.y*drag,z:v.z*drag},false);prop.body.setAngvel({x:w.x*spinDrag,y:w.y*spinDrag,z:w.z*spinDrag},false);
      this.buoyantLastTick.add(prop);
    }
  }
  update(playing:boolean,dt=.1):void {
    for(const p of this.moving.values()){p.anchor.position.copy(p.body.translation());p.anchor.quaternion.copy(p.body.rotation());p.anchor.updateMatrixWorld(true);}
    for(const p of this.plants){p.anchor.position.copy(p.body.translation());p.anchor.quaternion.copy(p.body.rotation());p.anchor.updateMatrixWorld(true);}
    for(const f of this.fragments){f.mesh.position.copy(f.body.translation());f.mesh.quaternion.copy(f.body.rotation());}
    if(!playing){this.rotating=false;return;}if(this.held){this.ui.setInteraction('Poser l’objet');this.prompted=true;return;}
    this.hoverElapsed+=dt;if(this.hoverElapsed<.075)return;this.hoverElapsed=0;const item=this.findTarget();
    if(item){this.ui.setInteraction(`Prendre · ${item.label}`);this.prompted=true;}else if(this.prompted){this.ui.setInteraction(null);this.prompted=false;}
  }
  setRotating(v:boolean):boolean{this.rotating=v&&!!this.held;return !!this.held;}
  rotate(x:number,y:number):boolean{if(!this.rotating||!this.held)return false;this.rotationDelta.setFromEuler(new THREE.Euler(y*.009,x*.009,0,'YXZ'));this.rotation.premultiply(this.rotationDelta).normalize();return true;}
  adjustDistance(delta:number):void{this.distance=THREE.MathUtils.clamp(this.distance+Math.sign(delta)*.12,.65,2.2);}
  release(throwObject=false):void {
    const prop=this.held;if(!prop)return;prop.body.setGravityScale(1,true);this.camera.getWorldDirection(this.direction);
    prop.breakGraceSteps=throwObject?0:2;
    prop.body.setLinvel(throwObject?this.direction.multiplyScalar(6):{x:0,y:0,z:0},true);prop.body.setAngvel({x:0,y:0,z:0},true);
    this.held=undefined;this.rotating=false;this.blockedTime=0;this.prompted=false;this.ui.setInteraction(null);this.ui.setCarryHint?.(null);
  }
  restoreReleasedCollision(playerPosition:THREE.Vector3):void{for(const p of this.moving.values())if(p!==this.held&&p.anchor.position.distanceToSquared(playerPosition)>(p.radius+.55)**2)for(const c of p.colliders)if(c.collisionGroups()!==RELEASED_GROUPS)c.setCollisionGroups(RELEASED_GROUPS);}
  getProgress():ApartmentObjectsProgress {
    const bodies:ApartmentObjectsProgress['bodies']={};for(const p of this.moving.values())bodies[p.item.id]={position:{...p.body.translation()},rotation:{...p.body.rotation()},sleeping:p.body.isSleeping()};
    for(const p of this.plants){p.mesh.updateMatrix();bodies[p.id]={position:{...p.body.translation()},rotation:{...p.body.rotation()},sleeping:p.body.isSleeping(),visualMatrix:p.mesh.matrix.toArray()};}
    const broken:ApartmentObjectsProgress['broken']={};for(const [id,b] of this.broken)broken[id]={kind:b.kind,position:{x:b.position.x,y:b.position.y,z:b.position.z},residuePending:(b.kind==='pot'||b.kind==='whisky')&&this.deposits.hasParticles(b.kind==='pot'?'soil':'whisky')};
    return {version:1,bodies,broken,deposits:this.deposits.snapshot()};
  }
  get debugState(){return {bodies:this.moving.size,broken:this.broken.size,plants:this.plants.length,fragments:this.fragments.length,blockedTime:this.blockedTime,...this.deposits.debugState};}
  dispose():void {
    this.unsubscribe();this.release();this.deposits.dispose();
    for(const p of this.plants){this.physics.world.removeRigidBody(p.body);p.anchor.removeFromParent();}
    for(const prop of [...this.moving.values(),...this.brokenProps]){
      if(!this.broken.has(prop.item.id))this.physics.world.removeRigidBody(prop.body);
      for(const source of prop.originals){source.parent.add(source.part);source.part.matrix.copy(source.matrix);source.part.visible=source.visible;source.matrix.decompose(source.part.position,source.part.quaternion,source.part.scale);source.part.matrixAutoUpdate=source.auto;}
      // The detached plant remains owned by the original pot hierarchy for GPU disposal.
      if(prop.item.plant&&prop.item.parts[0])prop.item.parts[0].add(prop.item.plant);
      prop.anchor.removeFromParent();
    }
    for(const f of this.fragments){this.physics.world.removeRigidBody(f.body);f.mesh.removeFromParent();}
    this.fragments.length=0;this.moving.clear();this.brokenProps.length=0;this.plants.length=0;this.buoyantLastTick.clear();this.shardGeometry.dispose();this.shardMaterial.dispose();this.potShardMaterial.dispose();this.ceramicShardMaterial.dispose();this.glassShardMaterial.dispose();
  }
}
