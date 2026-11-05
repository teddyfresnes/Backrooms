import * as THREE from 'three';
import type { CharacterRuntime } from '../character/CharacterRuntime';
import type { PlayerController } from '../player/PlayerController';
import { corridorLampTime, CORRIDOR_SPACING, type CorridorStory } from '../story/CorridorProgress';
const smooth=(t:number)=>{t=THREE.MathUtils.clamp(t,0,1);return t*t*(3-2*t);};
const angle=(a:number,b:number,t:number)=>a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*t;
/** Samples the same dressed rig used for play. The root, head and camera all turn. */
export class CorridorReaction {
  private began=false;private finished=false;
  private readonly from=new THREE.PerspectiveCamera();
  private readonly pov=new THREE.PerspectiveCamera();
  private readonly wide=new THREE.PerspectiveCamera();
  private readonly fill=new THREE.PointLight(0xe1dfc8,0,5,2);
  constructor(private readonly scene:THREE.Scene,private readonly story:CorridorStory,private readonly character:CharacterRuntime,private readonly player:PlayerController,private readonly camera:THREE.PerspectiveCamera,private readonly doorway:THREE.Vector3,private readonly floorY?:number){scene.add(this.fill);}
  update(reduced:boolean):void {
    const s=this.story.state;if(!s.triggered||this.finished||!s.reactionPosition)return;
    const p=new THREE.Vector3().copy(s.reactionPosition);if(this.floorY!==undefined)p.y=this.floorY+.865;
    if(!this.began){this.began=true;this.from.copy(this.camera);this.player.prepareScriptedStanding();this.player.setScriptedPose(p,false);this.player.setInputEnabled(false);this.character.setActive(false);this.character.beginComputerPresentation();}
    const time=s.elapsed,doorYaw=Math.atan2(this.doorway.x-p.x,this.doorway.z-p.z),start=s.reactionYaw??Math.PI/2;
    const playerLamp=Math.floor(s.distance/CORRIDOR_SPACING),blendStart=corridorLampTime(Math.max(this.story.firstLamp,playerLamp-1),this.story.firstLamp);
    const blendEnd=corridorLampTime(playerLamp,this.story.firstLamp);
    const turn=smooth((time-.55)/2.65),back=smooth((time-blendStart)/Math.max(.1,blendEnd-blendStart));
    const yaw=angle(angle(start,doorYaw,turn),Math.PI/2,back),head=angle(0,Math.atan2(Math.sin(doorYaw-yaw),Math.cos(doorYaw-yaw)),smooth((time-.2)/.9))*(1-back)*.35;
    const frame=this.character.sampleCorridorPresentation(p,yaw,head,time,back>.86);
    this.wide.copy(this.from);this.wide.position.set(p.x+2.3,p.y+.85,p.z+1.6);this.wide.lookAt(new THREE.Vector3(p.x-4,p.y+.28,this.doorway.z));this.wide.fov=59;
    if(reduced)this.wide.fov=this.player.fieldOfView;
    this.pov.copy(this.from);this.pov.fov=this.player.fieldOfView;this.pov.position.copy(frame.eye);this.pov.lookAt(frame.eye.clone().add(new THREE.Vector3(Math.sin(yaw),-.035,Math.cos(yaw))));
    const reveal=reduced?1:smooth(time/.65);
    this.camera.position.lerpVectors(this.from.position,this.wide.position,reveal);this.camera.quaternion.slerpQuaternions(this.from.quaternion,this.wide.quaternion,reveal);
    this.camera.position.lerp(frame.eye,back);this.camera.quaternion.slerp(this.pov.quaternion,back);this.camera.fov=THREE.MathUtils.lerp(this.wide.fov,this.pov.fov,back);this.camera.near=.025;this.camera.updateProjectionMatrix();
    this.fill.intensity=s.returned?0:.7;this.fill.position.copy(this.camera.position);
    if(s.returned){this.finished=true;this.player.setLookQuaternion(this.pov.quaternion);this.character.endComputerPresentation(true);this.camera.copy(this.pov);}
  }
  dispose():void{if(this.began&&!this.finished)this.character.endComputerPresentation(true);this.fill.removeFromParent();}
}
