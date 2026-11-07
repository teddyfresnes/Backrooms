import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { ComputerPoseSample, ComputerPoseFrame } from '../character/SeatedCharacterPose';
import { ComputerChair, COMPUTER_FLOOR, COMPUTER_SEAT, COMPUTER_STANDING } from './ComputerChair';
import type { ComputerUsePhase, ComputerUseProgress } from './ComputerUseState';
const IDENTITY={x:0,y:0,z:0,w:1};
const smooth=(v:number)=>{const t=THREE.MathUtils.clamp(v,0,1);return t*t*(3-2*t);};
const WAIT=[new THREE.Vector3(-7.58,COMPUTER_STANDING.y,-4.30),new THREE.Vector3(-6.36,COMPUTER_STANDING.y,-4.30)];
const BIG_OBSTACLE=(physics:PhysicsWorld,c:RAPIER.Collider)=>physics.isEnvironmentCollider(c)||physics.isInteractionObstacle(c)&&(c.parent()?.mass()??0)>.8;
export function computerPathClear(physics:PhysicsWorld,a:THREE.Vector3,b:THREE.Vector3):boolean {
  const direction=b.clone().sub(a),length=direction.length();if(length<.001)return true;direction.normalize();
  const hit=physics.world.castShape(a,IDENTITY,direction,new RAPIER.Capsule(.52,.32),.004,length,false,undefined,undefined,undefined,undefined,c=>BIG_OBSTACLE(physics,c));
  return !hit||hit.time_of_impact>=length-.008||new THREE.Vector3().copy(hit.normal1).dot(direction)>-.1;
}
/** Dijkstra over actual free capsule sweeps; either side can win or be obstructed. */
export function planComputerApproach(physics:PhysicsWorld,from:THREE.Vector3):{points:THREE.Vector3[];side:number}|null {
  const start=from.clone();start.y=COMPUTER_STANDING.y;
  const nodes=[start,...WAIT.map(p=>p.clone()),new THREE.Vector3(-7.70,start.y,-3.65),new THREE.Vector3(-6.25,start.y,-3.65),new THREE.Vector3(-6.97,start.y,-3.65),new THREE.Vector3(-7.70,start.y,-4.72),new THREE.Vector3(-6.25,start.y,-4.72)];
  const distance=nodes.map(()=>Infinity),previous=nodes.map(()=>-1),done=new Set<number>();distance[0]=0;
  for(let k=0;k<nodes.length;k++){
    let index=-1;for(let i=0;i<nodes.length;i++)if(!done.has(i)&&(index<0||distance[i]!<distance[index]!))index=i;
    if(index<0||!Number.isFinite(distance[index]))break;done.add(index);
    for(let i=1;i<nodes.length;i++)if(!done.has(i)&&computerPathClear(physics,nodes[index]!,nodes[i]!)){
      const candidate=distance[index]!+nodes[index]!.distanceTo(nodes[i]!);if(candidate<distance[i]!){distance[i]=candidate;previous[i]=index;}
    }
  }
  const target=distance[1]!<=distance[2]!?1:2;if(!Number.isFinite(distance[target]))return null;
  const points:THREE.Vector3[]=[];for(let i=target;i>=0;i=previous[i]!){points.unshift(nodes[i]!.clone());if(i===0)break;}
  return{points,side:target-1};
}
export interface ComputerSequenceHost {
  position():THREE.Vector3; pose(position:THREE.Vector3,confined:boolean,shape?:{halfHeight:number;radius:number}):void;
  begin():void; sample(sample:ComputerPoseSample,firstPerson:boolean):ComputerPoseFrame; end(forceFirstPerson:boolean):THREE.PerspectiveCamera;
  modal(active:boolean):void; openDesktop():void; closeDesktop():void; resume():void; blocked():boolean;
  hint(text:string|null):void; chairSound?():void; changed?():void; reducedMotion():boolean;
}
/** One host-driven clock for chair, dressed rig, camera, cursor and stable recovery. */
export class ComputerUseSequence {
  private phase:ComputerUsePhase='standing';
  private elapsed=0;
  private clock=0;
  private side=1;
  private route:THREE.Vector3[]=[];
  private routeDistance=0;
  private routeLength=0;
  private readonly position=new THREE.Vector3();
  private readonly safePosition=new THREE.Vector3();
  private readonly savedCamera=new THREE.PerspectiveCamera();
  private readonly cameraFrom=new THREE.PerspectiveCamera();
  private readonly cameraTarget=new THREE.PerspectiveCamera();
  private frame?:ComputerPoseFrame;
  private firstPerson=false;
  private shock=false;
  private standingShock=false;
  private exitRequested=false;
  private disposed=false;
  private finishPresentation=false;
  private lastSeated=0;
  private riseFrom=1;
  private exitOffset=.025;
  private shockElapsed=0;
  private yaw=Math.PI;
  private targetYaw=Math.PI;
  constructor(readonly chair:ComputerChair,private readonly physics:PhysicsWorld,private readonly camera:THREE.PerspectiveCamera,private readonly host:ComputerSequenceHost,progress?:ComputerUseProgress){
    this.safePosition.copy(progress?.safePosition??host.position());this.position.copy(host.position());this.phase=host.blocked()?'blocked':'standing';if(progress&&['standing','blocked'].includes(progress.phase))this.chair.setOffset(progress.chairOffset);
  }
  get isActive():boolean{return this.phase!=='standing'&&this.phase!=='blocked';}
  get state():ComputerUsePhase{return this.phase;}
  get isUsing():boolean{return this.phase==='using';}
  private change(phase:ComputerUsePhase):void{this.phase=phase;this.elapsed=0;this.host.changed?.();}
  start():boolean {
    if(this.disposed)return false;if(this.isActive)return true;if(this.host.blocked()){this.phase='blocked';this.host.hint('Le PC ne répond plus.');return true;}
    const standing=this.host.position().clone();standing.y=COMPUTER_STANDING.y;
    if(!this.physics.canStandAt(standing)){this.host.hint('Pas assez de place pour s’installer.');return true;}
    const approach=planComputerApproach(this.physics,this.host.position());if(!approach||!this.chair.canMoveTo(.35)){this.host.hint('Le passage près de la chaise est encombré.');return true;}
    this.side=approach.side;this.safePosition.copy(WAIT[this.side]!);this.savedCamera.copy(this.camera);this.cameraFrom.copy(this.camera);this.position.copy(approach.points[0]!);
    this.clock=0;this.yaw=Math.PI;this.targetYaw=Math.PI;
    this.shock=false;this.standingShock=false;this.exitRequested=false;this.firstPerson=false;this.finishPresentation=false;
    this.host.modal(true);this.host.begin();
    // Straight to the seat when nothing is in the way: no detour around the chair.
    const here=this.host.position().clone();here.y=COMPUTER_STANDING.y;
    this.setRoute(computerPathClear(this.physics,here,COMPUTER_STANDING)?[here,COMPUTER_STANDING.clone()]:approach.points);this.position.copy(this.route[0]!);
    this.change('approach');this.host.hint(null);return true;
  }
  close():void {
    if(!this.isActive)return;this.exitRequested=true;
    if(this.phase==='using'){this.riseFrom=1;this.exitOffset=this.chair.offset;this.cameraFrom.copy(this.camera);this.host.closeDesktop();this.host.resume();this.host.chairSound?.();this.change('exit-chair');}
  }
  powerCut():void {
    if(this.shock||this.disposed)return;const wasActive=this.isActive;this.shock=true;this.shockElapsed=0;this.host.closeDesktop();this.firstPerson=true;
    this.standingShock=!wasActive||this.lastSeated<.05;this.riseFrom=this.lastSeated;this.exitOffset=this.chair.offset;
    if(!wasActive){this.position.copy(this.host.position());this.safePosition.copy(this.position);this.savedCamera.copy(this.camera);this.host.modal(true);this.host.begin();}
    if(!this.standingShock)this.host.chairSound?.();this.cameraFrom.copy(this.camera);this.change(this.standingShock?'rising':this.phase==='rising'?'rising':'exit-chair');this.host.resume();
  }
  /** Same urgent rise, while the room and computer still have electricity. */
  riseQuickly():void{if(this.isActive)this.powerCut();}
  private setRoute(points:THREE.Vector3[]):void{this.route=points;this.routeDistance=0;this.routeLength=points.slice(1).reduce((sum,p,i)=>sum+p.distanceTo(points[i]!),0);}
  private travel(dt:number,speed:number):boolean {
    this.routeDistance=Math.min(this.routeLength,this.routeDistance+dt*speed);let remaining=this.routeDistance;
    for(let i=1;i<this.route.length;i++){const a=this.route[i-1]!,b=this.route[i]!,length=a.distanceTo(b);if(remaining<=length||i===this.route.length-1){this.position.lerpVectors(a,b,length>.001?remaining/length:1);this.targetYaw=this.phase==='align'&&this.routeLength-this.routeDistance<.32?Math.PI:Math.atan2(b.x-a.x,b.z-a.z);return this.routeDistance>=this.routeLength;}remaining-=length;}
    this.position.copy(this.route.at(-1)??this.position);return true;
  }
  private pose(seated:number,lean:number,walking=0,chairHand=false,hands=0):void {
    // The head (hair, eyes) is hidden only while the camera is really at the
    // eye: a camera still travelling out of or into the head must see a head.
    if(this.phase==='approach'||this.phase==='camera-in')this.firstPerson=!!this.frame&&this.camera.position.distanceTo(this.frame.eye)<.2;
    const feet=this.position.clone();feet.y=this.standingShock?this.position.y-.865:COMPUTER_FLOOR;
    const yaw=this.yaw;this.lastSeated=seated;
    const left=new THREE.Vector3(-7.16,9.53,-5.09),right=new THREE.Vector3(-6.79,9.53,-5.09);
    if(chairHand){const hand=this.side===0?left:right;hand.set(this.side===0?-7.15:-6.79,9.69,-4.24+this.chair.offset);}
    this.frame=this.host.sample({feet,yaw,seated,seat:this.chair.seat,lean,time:this.clock,walking,
      leftHand:chairHand&&this.side!==0?undefined:left,rightHand:chairHand&&this.side!==1?undefined:right,handWeight:chairHand?1:hands},this.firstPerson);
    const physical=this.position.clone(),shapeBlend=smooth(Math.min(1,seated*3));
    if(seated>0){physical.y=THREE.MathUtils.lerp(COMPUTER_STANDING.y,this.frame.hips.y+.32,shapeBlend);physical.z=THREE.MathUtils.lerp(physical.z,this.frame.hips.z,seated);}
    // The seated torso rests above the seat; a standing cylinder through the
    // lower legs would overlap the chair even when the actual dressed rig fits.
    this.host.pose(physical,seated>0,seated>0?{halfHeight:THREE.MathUtils.lerp(.52,.18,shapeBlend),radius:THREE.MathUtils.lerp(.32,.17,shapeBlend)}:undefined);
  }
  private cameraView(blendToEye=0):void {
    if(!this.frame)return;
    const eye=this.frame.eye,aim=this.frame.hips.clone();aim.y=COMPUTER_FLOOR+.88;
    const offset=this.side===0?new THREE.Vector3(-1.13,.55,1.10):new THREE.Vector3(1.52,.50,.95);offset.setLength(2.05);const desired=aim.clone().add(offset);
    this.cameraTarget.copy(this.savedCamera);this.cameraTarget.position.copy(desired);this.cameraTarget.lookAt(aim);this.cameraTarget.fov=60;this.cameraTarget.near=.035;
    if(this.host.reducedMotion())this.cameraTarget.fov=this.savedCamera.fov;
    const t=blendToEye;
    if(t>0){const pov=this.cameraTarget.clone();pov.position.copy(eye);pov.lookAt(new THREE.Vector3(-7.0259,9.745,-5.455));pov.fov=60;this.cameraTarget.position.lerp(eye,t);this.cameraTarget.quaternion.slerp(pov.quaternion,t);}
    if(this.phase==='approach'){const mix=smooth(Math.min(1,this.clock/.3));this.camera.position.lerpVectors(this.savedCamera.position,this.cameraTarget.position,mix);this.camera.quaternion.slerpQuaternions(this.savedCamera.quaternion,this.cameraTarget.quaternion,mix);}
    else{this.camera.position.copy(this.cameraTarget.position);this.camera.quaternion.copy(this.cameraTarget.quaternion);}
    this.camera.fov=this.cameraTarget.fov;this.camera.near=.035;this.camera.updateProjectionMatrix();this.guardCamera(this.frame.head);
  }
  private eyeView():void {
    if(!this.frame)return;this.camera.position.copy(this.frame.eye);this.camera.lookAt(this.camera.position.clone().add(this.host.reducedMotion()?new THREE.Vector3(0,-.08,-1):new THREE.Vector3(Math.sin(this.yaw),-.08,Math.cos(this.yaw))));
    if(this.shock&&!this.host.reducedMotion()){const kick=Math.sin(Math.min(1,this.shockElapsed/.14)*Math.PI)*.022;this.camera.rotateX(kick);}
    this.camera.near=.025;this.camera.fov=this.savedCamera.fov;this.camera.updateProjectionMatrix();this.guardCamera(this.frame.head);
    if(this.phase==='exit-chair'){
      const t=smooth(this.elapsed/(this.shock?.24:.48));
      this.camera.position.lerpVectors(this.cameraFrom.position,this.camera.position.clone(),t);
      this.camera.quaternion.slerpQuaternions(this.cameraFrom.quaternion,this.camera.quaternion.clone(),t);
    }
  }
  private guardCamera(head:THREE.Vector3):void {
    const direction=this.camera.position.clone().sub(head),length=direction.length();if(length<.001)return;direction.normalize();
    const hit=this.physics.world.castShape(head,IDENTITY,direction,new RAPIER.Ball(.075),.002,length,false,undefined,undefined,undefined,undefined,this.physics.isEnvironmentCollider);
    if(hit&&hit.time_of_impact<length)this.camera.position.copy(head).addScaledVector(direction,Math.max(.035,hit.time_of_impact-.01));
  }
  update(dt:number,playing:boolean,covered=false):void {
    if(!this.isActive||!playing||this.disposed)return;const delta=Math.min(.05,Math.max(0,dt));this.elapsed+=delta;this.clock+=delta;if(this.phase==='using'&&covered)return;if(this.shock)this.shockElapsed+=delta;
    if(!['approach','align','step-away'].includes(this.phase))this.targetYaw=['pull-chair','return-chair'].includes(this.phase)?Math.atan2(COMPUTER_SEAT.x-this.position.x,-4.24-this.position.z):Math.PI;
    const difference=Math.atan2(Math.sin(this.targetYaw-this.yaw),Math.cos(this.targetYaw-this.yaw));this.yaw+=THREE.MathUtils.clamp(difference,-delta*4.5,delta*4.5);
    switch(this.phase){
      case 'approach':{
        const arrived=this.travel(delta,1.5);
        const left=this.routeLength-this.routeDistance;this.chair.setOffset(.35*smooth(Math.min(1,this.clock/.45)));
        // A short shuffle, never a full stride cycle.
        this.pose(0,0,arrived?0:Math.min(.35,left/.6*.35));this.cameraView();
        if(arrived){this.host.chairSound?.();this.targetYaw=Math.PI;this.change('sitting');}break;}
      case 'pull-chair':this.chair.setOffset(.35*smooth(this.elapsed/.55));this.pose(0,.12,0,true);this.cameraView();if(this.elapsed>=.55){this.setRoute([this.position.clone(),new THREE.Vector3(WAIT[this.side]!.x,COMPUTER_STANDING.y,-4.72),COMPUTER_STANDING.clone()]);this.change('align');}break;
      case 'align':{const done=this.travel(delta,.7);this.pose(0,.05,done?0:Math.min(1,(this.routeLength-this.routeDistance)/.22));this.cameraView();if(done&&Math.abs(Math.atan2(Math.sin(this.yaw-Math.PI),Math.cos(this.yaw-Math.PI)))<.035)this.change('sitting');break;}
      case 'sitting':{const t=Math.min(1,this.elapsed/1.2);this.pose(t,.10*Math.sin(Math.PI*t)+.08*t);this.cameraView();if(t===1)this.change('settling');break;}
      case 'settling':{const t=smooth(this.elapsed/.4);this.chair.setOffset(THREE.MathUtils.lerp(.35,.025,t));this.pose(1,.20,0,false,t);this.cameraView();if(t===1){this.cameraFrom.copy(this.camera);this.change('camera-in');}break;}
      case 'camera-in':{const t=smooth(this.elapsed/.3);this.pose(1,.20,0,false,1);this.cameraView(t);if(t===1){this.firstPerson=true;this.change('using');this.host.openDesktop();if(this.exitRequested)this.close();}break;}
      case 'using':this.pose(1,.20+Math.sin(this.clock*1.3)*.004,0,false,1);this.cameraView(1);break;
      case 'exit-chair':{const t=smooth(this.elapsed/(this.shock?.22:.3));this.chair.setOffset(THREE.MathUtils.lerp(this.exitOffset,.35,t));this.firstPerson=true;this.pose(this.riseFrom,.20,0,false,1-t);this.eyeView();if(t===1)this.change('rising');break;}
      case 'rising':{const t=smooth(this.elapsed/(this.shock?.5:.55));this.pose(this.standingShock?0:this.riseFrom*(1-t),this.standingShock?Math.sin(t*Math.PI)*-.10:.20*(1-t)+Math.sin(t*Math.PI)*.28,0,false,0);this.eyeView();if(t===1){if(!this.standingShock)this.position.y=COMPUTER_STANDING.y;const side=WAIT[this.side]!.clone();const route=this.standingShock?[this.position.clone()]:[this.position.clone(),new THREE.Vector3(side.x,side.y,-4.72),side];if(route.slice(1).every((p,i)=>computerPathClear(this.physics,route[i]!,p)))this.setRoute(route);else this.setRoute([this.position.clone()]);this.change('step-away');}break;}
      case 'step-away':{const done=this.travel(delta,this.shock?.95:1.55);this.pose(0,0,done?0:1);this.eyeView();if(done){
        this.safePosition.copy(this.position);
        this.prepareHandoff();
      }break;}
      case 'return-chair':{const t=smooth(this.elapsed/.48);this.chair.setOffset(.35*(1-t));this.pose(0,.08,0,true);this.eyeView();if(t===1)this.prepareHandoff();break;}
      case 'handoff':{const t=smooth(this.elapsed/.15);this.camera.position.lerpVectors(this.cameraFrom.position,this.cameraTarget.position,t);this.camera.quaternion.slerpQuaternions(this.cameraFrom.quaternion,this.cameraTarget.quaternion,t);this.camera.fov=THREE.MathUtils.lerp(this.cameraFrom.fov,this.cameraTarget.fov,t);this.camera.near=this.cameraTarget.near;this.camera.updateProjectionMatrix();if(t===1){this.phase=this.host.blocked()?'blocked':'standing';this.host.modal(false);this.host.changed?.();}break;}
    }
  }
  private prepareHandoff():void {
    this.host.pose(this.position,false);this.cameraFrom.copy(this.camera);this.cameraTarget.copy(this.host.end(this.shock));this.finishPresentation=true;this.change('handoff');
  }
  getProgress():ComputerUseProgress{return{version:1,phase:this.phase,safePosition:{x:this.safePosition.x,y:this.safePosition.y,z:this.safePosition.z},chairOffset:this.chair.offset};}
  get debugState(){return{phase:this.phase,shock:this.shock,firstPerson:this.firstPerson,chairOffset:this.chair.offset,frame:this.frame};}
  dispose():void{if(this.disposed)return;this.disposed=true;if(this.isActive){this.host.closeDesktop();if(!this.finishPresentation)this.host.end(this.shock);this.host.modal(false);}this.chair.dispose();}
}
