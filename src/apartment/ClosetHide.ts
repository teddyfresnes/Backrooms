import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { ImportedApartmentEnvironment } from './ImportedApartmentEnvironment';
import { matchesControlAction, formatKeyLabel, type ControlBindings } from '../input/ControlBindings';
const INSIDE=new THREE.Vector3(-7.9265,9.44,-5.65),EYE=new THREE.Vector3(-7.9265,9.95,-5.65),OUTSIDE=new THREE.Vector3(-7.9265,9.54,-4.85);
interface Leaf {object:THREE.Object3D;pivot:THREE.Group;parent:THREE.Object3D;matrix:THREE.Matrix4;auto:boolean;key:string;sign:number}
type Phase='idle'|'opening'|'aligning'|'entering'|'hiding'|'hidden'|'opening-exit'|'exiting'|'closing';
/** Scripted motion through the actual hollow furniture; all leaves keep physical colliders. */
export class ClosetHide {
  private readonly leaves:Leaf[]=[];
  private readonly saved=new THREE.PerspectiveCamera();
  private readonly from=new THREE.Vector3();
  private readonly exit=new THREE.Vector3();
  private readonly ray=new THREE.Ray();
  private readonly direction=new THREE.Vector3();
  private readonly target=new THREE.Box3(new THREE.Vector3(-8.27,9.0,-5.42),new THREE.Vector3(-7.58,10.45,-5.26));
  private phase:Phase='idle';
  private phaseTime=0;
  private progress=0;
  private prompted=false;
  private yaw=0;
  private pitch=0;
  private exitRequested=false;
  private disposed=false;
  constructor(private readonly apartment:ImportedApartmentEnvironment,private readonly physics:PhysicsWorld,
    private readonly camera:THREE.PerspectiveCamera,private readonly ui:{setInteraction(label:string|null):void},private readonly host:{
      position():THREE.Vector3;pose(position:THREE.Vector3,confined:boolean):void;presentation(active:boolean):void;active(active:boolean):void;playing():boolean;bindings():ControlBindings;
    },doorProgress=0){
    this.progress=THREE.MathUtils.clamp(doorProgress,0,1);
    const hinges=[new THREE.Vector3(-8.2146,8.7716,-5.3383),new THREE.Vector3(-7.6437,8.7716,-5.3334)];
    apartment.wardrobeDoors.forEach((object,i)=>{
      object.updateWorldMatrix(true,true);const parent=object.parent!,matrix=object.matrix.clone(),auto=object.matrixAutoUpdate,box=new THREE.Box3().setFromObject(object,true),hinge=hinges[i]!,pivot=new THREE.Group(),key=`bedside-closet-leaf-${i}`;
      pivot.position.copy(hinge);apartment.group.add(pivot);pivot.updateWorldMatrix(true,false);pivot.attach(object);object.matrixAutoUpdate=true;
      const center=box.getCenter(new THREE.Vector3()).sub(hinge),half=box.getSize(new THREE.Vector3()).multiplyScalar(.5);
      physics.addKinematicChunk(key,[{id:key,kind:'barrier',center:{x:center.x,y:center.y,z:center.z},halfExtents:{x:half.x,y:half.y,z:Math.max(.012,half.z)}}]);
      this.leaves.push({object,pivot,parent,matrix,auto,key,sign:i===0?-1:1});
    });
    this.syncDoors();window.addEventListener('keydown',this.onKey,true);document.addEventListener('mousemove',this.onMouse,true);
  }
  get isActive():boolean{return this.phase!=='idle';}
  get doorProgress():number{return this.progress;}
  private targeted():boolean {
    if(this.leaves.length!==2)return false;const position=this.host.position();if(position.z< -5.1||Math.abs(position.x-INSIDE.x)>.42)return false;
    this.camera.getWorldDirection(this.direction);this.ray.set(this.camera.position,this.direction);const hit=this.ray.intersectBox(this.target,new THREE.Vector3());return !!hit&&hit.distanceTo(this.camera.position)<1.85;
  }
  interact():boolean {
    if(this.isActive){this.exitRequested=true;if(this.phase==='hidden')this.change('opening-exit');return true;}
    if(!this.targeted())return false;
    this.saved.copy(this.camera);this.exit.copy(this.host.position());this.from.copy(this.exit);this.exitRequested=false;this.yaw=0;this.pitch=0;
    this.host.active(true);this.host.presentation(true);this.change('opening');this.ui.setInteraction(null);return true;
  }
  private change(phase:Phase):void{this.phase=phase;this.phaseTime=0;}
  private syncDoors():void {
    for(const leaf of this.leaves){leaf.pivot.rotation.y=leaf.sign*this.progress*1.62;leaf.pivot.updateMatrixWorld(true);this.physics.setKinematicChunkTransform(leaf.key,leaf.pivot.position,leaf.pivot.quaternion);}
  }
  private move(from:THREE.Vector3,to:THREE.Vector3,t:number):void {
    const ease=t*t*(3-2*t),p=new THREE.Vector3().lerpVectors(from,to,ease);this.host.pose(p,true);
    const outward=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,Math.PI,0)),normalOffset=this.saved.position.y-this.exit.y;
    const offset=this.phase==='aligning'?normalOffset:this.phase==='entering'?THREE.MathUtils.lerp(normalOffset,.51,ease):THREE.MathUtils.lerp(.51,normalOffset,ease);
    this.camera.position.copy(p).add(new THREE.Vector3(0,offset,0));
    if(this.phase==='aligning')this.camera.quaternion.copy(this.saved.quaternion);
    else if(this.phase==='entering')this.camera.quaternion.slerpQuaternions(this.saved.quaternion,outward,ease);
    else this.camera.quaternion.slerpQuaternions(outward,this.saved.quaternion,ease);
  }
  update(dt:number,playing:boolean):void {
    if(!this.isActive){if(playing&&this.targeted()){this.ui.setInteraction('Se cacher dans le placard');this.prompted=true;}else if(this.prompted){this.ui.setInteraction(null);this.prompted=false;}return;}
    this.host.presentation(true);if(!playing)return;this.phaseTime+=dt;this.camera.near=.025;this.camera.fov=THREE.MathUtils.damp(this.camera.fov,62,8,dt);this.camera.updateProjectionMatrix();
    switch(this.phase){
      case 'opening':this.progress=Math.min(1,this.progress+dt*4.4);if(this.progress===1){this.from.copy(this.host.position());this.change('aligning');}break;
      case 'aligning':this.move(this.from,OUTSIDE,Math.min(1,this.phaseTime/.28));if(this.phaseTime>=.28)this.change('entering');break;
      case 'entering':this.move(OUTSIDE,INSIDE,Math.min(1,this.phaseTime/.52));if(this.phaseTime>=.52)this.change('hiding');break;
      case 'hiding':this.progress=Math.max(0,this.progress-dt*3.6);this.hiddenView();if(this.progress===0)this.change(this.exitRequested?'opening-exit':'hidden');break;
      case 'hidden':this.hiddenView();this.ui.setInteraction(`${formatKeyLabel(this.host.bindings().interact)} · Sortir du placard`);break;
      case 'opening-exit':this.hiddenView();this.progress=Math.min(1,this.progress+dt*4.4);if(this.progress===1)this.change('exiting');break;
      case 'exiting':this.move(INSIDE,OUTSIDE,Math.min(1,this.phaseTime/.52));if(this.phaseTime>=.52){this.host.pose(OUTSIDE,false);this.change('closing');}break;
      case 'closing':this.progress=Math.max(0,this.progress-dt*3.8);this.camera.fov=THREE.MathUtils.lerp(this.saved.fov,62,this.progress);this.camera.updateProjectionMatrix();if(this.progress===0)this.finish();break;
    }this.syncDoors();
  }
  private hiddenView():void{this.camera.position.copy(EYE);this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch,Math.PI+this.yaw,0,'YXZ'));}
  private finish():void{const aspect=this.camera.aspect;this.camera.copy(this.saved);this.camera.aspect=aspect;this.camera.updateProjectionMatrix();this.phase='idle';this.host.presentation(false);this.host.active(false);this.ui.setInteraction(null);}
  private onKey=(event:KeyboardEvent):void=>{
    if(!this.isActive||!this.host.playing()||event.ctrlKey||event.metaKey||event.altKey||event.code==='Escape'||event.code==='F11')return;
    event.preventDefault();event.stopImmediatePropagation();if(!event.repeat&&matchesControlAction(event,this.host.bindings(),'interact'))this.interact();
  };
  private onMouse=(event:MouseEvent):void=>{if(!this.isActive||!this.host.playing()||!document.pointerLockElement||document.hidden)return;event.stopImmediatePropagation();this.yaw=THREE.MathUtils.clamp(this.yaw-event.movementX*.0018,-.5,.5);this.pitch=THREE.MathUtils.clamp(this.pitch-event.movementY*.0018,-.38,.38);};
  get debugState(){return {phase:this.phase,progress:this.progress};}
  dispose():void {
    if(this.disposed)return;this.disposed=true;window.removeEventListener('keydown',this.onKey,true);document.removeEventListener('mousemove',this.onMouse,true);
    if(this.isActive){this.host.pose(OUTSIDE,false);this.finish();}
    for(const leaf of this.leaves){this.physics.removeChunk(leaf.key);leaf.parent.add(leaf.object);leaf.object.matrix.copy(leaf.matrix);leaf.matrix.decompose(leaf.object.position,leaf.object.quaternion,leaf.object.scale);leaf.object.matrixAutoUpdate=leaf.auto;leaf.pivot.removeFromParent();}
    this.leaves.length=0;
  }
}
