import * as THREE from 'three';
import type { Vec3Data, DoorOpenMode } from '../world/types';
import type { DoorbellTarget } from './StairwellDetails';
import type { HallNeighborProgress } from '../core/SaveHistory';
import type { CharacterVoiceId } from '../audio/VoiceCatalog';
import type { NeighborCue } from '../audio/NeighborVoice';
import { neighborActor, neighborBreakingPoint, neighborProfile, neighborReply, SPECIAL_NEIGHBOR_DOOR } from './NeighborProfiles';
import { SpecialNeighborDoor } from './SpecialNeighborDoor';
import { isPlayerApartmentDoor } from '../apartment/DoorIdentity';
import { PLAYER_APARTMENT_DOOR_ID } from '../apartment/DoorIdentity';
export { NEIGHBOR_LINES, neighborReply } from './NeighborProfiles';

const isDisplayed = (object: THREE.Object3D): boolean => {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) if (!current.visible) return false;
  return true;
};

interface DoorState {
  id:string; bounds:THREE.Box3; center:THREE.Vector3; voice?:CharacterVoiceId;
  soundCooldown:number; responseCooldown:number; annoyance:number; quiet:number;
  cursor:number; lastLine:number; pending?:{delay:number; kind:'knock'|'bell'; special:boolean};
  leaf:THREE.Object3D; recent:number[];
  /** Seconds until the armed resident opens up, after the final threat. */
  armed?:number;
}
interface Callbacks {
  sound(kind:'knock'|'bell'|'slam', position:Readonly<Vec3Data>, doorId:string):number|void;
  say(text:string):void;
  speak(doorId:string, voice:CharacterVoiceId, cue:NeighborCue, position:Readonly<Vec3Data>,delivery?:'normal'|'mutter'):boolean|void;
  voiceDuration?(voice:CharacterVoiceId,cue:NeighborCue):number;
  stopVoice():void;
  hideCaption?():void;
  soundCaptions?():boolean;
  subtitles?():boolean;
  changed?():void;
  /** The resident has had enough: opens the door a crack and fires. */
  gunfire?(doorId:string,leaf:THREE.Object3D,center:Readonly<Vec3Data>):void;
}

/** One resident and one coalesced pending answer per address. Input is always
 * counted; audio and speech have separate, bounded cadences in played time. */
export class NeighborDoorInteraction {
  private readonly doors:DoorState[]=[];
  private readonly attempts=new Map<string,number>();
  private readonly eye=new THREE.Vector3();
  private readonly ray=new THREE.Ray();
  private readonly hit=new THREE.Vector3();
  private readonly ownCooldowns=new Map<string,number>();
  private readonly bellBounds=new THREE.Box3();
  private prompted=false;
  private disposed=false;
  private specialDoorConsumed=false;
  private special?:SpecialNeighborDoor;
  private captionDoor?:DoorState;
  private captionRemaining=0;
  private saveDelay=0;
  private dirty=false;
  readonly voices:readonly CharacterVoiceId[];

  constructor(root:THREE.Object3D,private readonly ui:{setInteraction(label:string|null):void},
    private readonly callbacks:Callbacks,private readonly bells:readonly DoorbellTarget[]=[],
    progress?:HallNeighborProgress,playerVoice:CharacterVoiceId='alex',
    private readonly ownLeaf?:THREE.Object3D) {
    this.specialDoorConsumed=progress?.specialDoorConsumed??false;
    for(const [key,value] of Object.entries(progress?.attempts??{}))if(!isPlayerApartmentDoor(key))this.attempts.set(key,value);
    root.updateWorldMatrix(true,true);
    const leaves:THREE.Object3D[]=[];
    root.traverse(leaf=>{if(/^(?:west|east|north)-neighbor-door-\d+-leaf$/.test(leaf.name)&&!isPlayerApartmentDoor(leaf.userData.doorId??leaf.name))leaves.push(leaf);});
    for(const leaf of leaves){
      const bounds=new THREE.Box3().setFromObject(leaf);
      const voice=neighborProfile(leaf.name)==='silent'?undefined:progress?.voices?.[leaf.name]??neighborActor(leaf.name,playerVoice);
      const saved=progress?.reactions?.[leaf.name];
      const door:DoorState={id:leaf.name,bounds,center:bounds.getCenter(new THREE.Vector3()),voice,
        soundCooldown:0,responseCooldown:0,annoyance:saved?.annoyance??0,quiet:Infinity,
        cursor:saved?.cursor??this.attempts.get(leaf.name)??0,lastLine:saved?.lastLine??-1,leaf,recent:[]};
      this.doors.push(door);
      if(leaf.name===SPECIAL_NEIGHBOR_DOOR)this.special=new SpecialNeighborDoor(leaf,()=>this.callbacks.sound('slam',door.center,door.id));
    }
    this.voices=[...new Set(this.doors.flatMap(door=>door.voice?[door.voice]:[]))];
  }

  private target(position:Readonly<Vec3Data>,direction:THREE.Vector3,eyePosition?:THREE.Vector3,knockOwn=false):{id:string;bell:boolean;own?:boolean}|undefined {
    if(eyePosition)this.eye.copy(eyePosition);else this.eye.set(position.x,position.y+.73,position.z);
    this.ray.set(this.eye,direction);
    let closest=2.3,target:{id:string;bell:boolean;own?:boolean}|undefined;
    // The real leaf is an occluder even though opening it is owned by the door
    // controller. Never let a ray through it select a neighbour across the hall.
    if(this.ownLeaf&&isDisplayed(this.ownLeaf)){
      this.ownLeaf.updateWorldMatrix(true,true);
      const ownBounds=new THREE.Box3().setFromObject(this.ownLeaf);
      const hit=this.ray.intersectBox(ownBounds,this.hit);
      if(hit&&hit.distanceTo(this.eye)<closest){closest=hit.distanceTo(this.eye);if(knockOwn)target={id:PLAYER_APARTMENT_DOOR_ID,bell:false,own:true};}
    }
    for(const bell of this.bells){
      this.bellBounds.setFromCenterAndSize(bell.position,new THREE.Vector3(.10,.12,.10));
      const hit=this.ray.intersectBox(this.bellBounds,this.hit),distance=hit?.distanceTo(this.eye)??Infinity;
      if(distance<Math.min(2.1,closest+.04)){closest=distance;target={id:bell.id,bell:true,own:bell.own||isPlayerApartmentDoor(bell.id)};}
    }
    for(const door of this.doors){
      if(!isDisplayed(door.leaf))continue;
      if(Math.abs(this.eye.y-door.center.y)>1.5||this.eye.distanceToSquared(door.center)>9)continue;
      const hit=this.ray.intersectBox(door.bounds,this.hit),distance=hit?.distanceTo(this.eye)??Infinity;
      if(distance>.08&&distance<closest){closest=distance;target={id:door.id,bell:false};}
    }
    return target;
  }

  update(delta:number,position:Readonly<Vec3Data>,direction:THREE.Vector3,playing:boolean,eyePosition?:THREE.Vector3):void {
    if(this.disposed)return;
    if(!playing){this.hidePrompt();return;}
    const dt=Math.max(0,delta);
    this.special?.update(dt);
    this.saveDelay=Math.max(0,this.saveDelay-dt);
    for(const [id,left] of this.ownCooldowns)this.ownCooldowns.set(id,Math.max(0,left-dt));
    for(const door of this.doors){
      door.soundCooldown=Math.max(0,door.soundCooldown-dt);
      door.responseCooldown=Math.max(0,door.responseCooldown-dt);
      door.quiet+=dt;
      // No abrupt reset: a burst stays irritating, then slowly fades over ~35s.
      if(door.quiet>2.5)door.annoyance=Math.max(0,door.annoyance-dt*.32);
      if(door.armed!==undefined){
        door.armed-=dt;
        if(door.armed<=0){door.armed=undefined;this.callbacks.gunfire?.(door.id,door.leaf,door.center);}
      }
      if(!door.pending)continue;
      door.pending.delay-=dt;
      if(door.pending.delay>0||door.responseCooldown>0)continue;
      const pending=door.pending;door.pending=undefined;
      if(pending.special){this.special?.start();door.responseCooldown=1.1;continue;}
      if(!door.voice)continue;
      const reply=neighborReply(door.id,door.cursor+1,pending.kind,door.annoyance,door.lastLine,door.recent);
      if(!reply){door.cursor=Math.min(door.cursor+1,neighborBreakingPoint(door.id)+1);continue;}
      const audible=this.callbacks.speak(door.id,door.voice,reply.cue,door.center,reply.delivery)!==false;
      door.cursor++;door.lastLine=reply.index;
      door.recent.push(reply.index);if(door.recent.length>8)door.recent.shift();
      const duration=this.callbacks.voiceDuration?.(door.voice,reply.cue)??1.3;
      door.responseCooldown=Math.max(2,duration+1.1);
      if(reply.final&&this.callbacks.gunfire)door.armed=duration+.9;
      this.dirty=true;
      if(audible&&door.center.distanceToSquared(position)<81&&(this.callbacks.subtitles?.()??true)&&(!reply.nonverbal||this.callbacks.soundCaptions?.())){
        this.callbacks.say(reply.nonverbal?reply.text:`« ${reply.text} »`);this.captionDoor=door;this.captionRemaining=Math.max(2.2,duration+.2);
      }
    }
    if(this.dirty&&this.saveDelay<=0){this.dirty=false;this.saveDelay=8;this.callbacks.changed?.();}
    if(this.captionDoor){
      this.captionRemaining-=dt;
      if(this.captionRemaining<=0||this.captionDoor.center.distanceToSquared(position)>81){this.callbacks.hideCaption?.();this.captionDoor=undefined;}
    }
    const target=this.target(position,direction,eyePosition);
    if(target){this.ui.setInteraction(target.bell?'Sonner':'Toquer');this.prompted=true;}else this.hidePrompt();
  }

  interact(position:Readonly<Vec3Data>,direction:THREE.Vector3,playing:boolean,mode:DoorOpenMode='fast',eyePosition?:THREE.Vector3,knockOwn=false):boolean {
    if(this.disposed||!playing)return false;
    const target=this.target(position,direction,eyePosition,knockOwn);if(!target)return false;
    const door=this.doors.find(d=>d.id===target.id),kind=target.bell||mode==='slow'?'bell':'knock';
    const source=door?.center??this.bells.find(b=>b.id===target.id)?.position??position;
    if(target.own||isPlayerApartmentDoor(target.id)||!door){
      if((this.ownCooldowns.get(target.id)??0)<=0){this.callbacks.sound(kind,source,target.id);this.ownCooldowns.set(target.id,kind==='bell'?.42:.2);}
      return true;
    }
    this.attempts.set(door.id,Math.min(Number.MAX_SAFE_INTEGER,(this.attempts.get(door.id)??0)+1));
    door.annoyance=Math.min(12,door.annoyance+(door.quiet<1.2?1.3:door.quiet<4?.7:.15));
    door.quiet=0;
    if(door.soundCooldown<=0){this.callbacks.sound(kind,source,target.id);door.soundCooldown=kind==='bell'?.42:.2;}
    const special=door.id===SPECIAL_NEIGHBOR_DOOR&&!this.specialDoorConsumed;
    if(special){this.specialDoorConsumed=true;door.pending={delay:.28,kind,special:true};this.callbacks.changed?.();}
    else if(door.voice&&!door.pending&&door.responseCooldown<=0&&door.armed===undefined){
      const reply=neighborReply(door.id,door.cursor+1,kind,door.annoyance,door.lastLine,door.recent);
      door.pending={delay:reply?.delay??1.2,kind,special:false};
    }else if(door.pending&&!door.pending.special){
      // Coalesce the burst without advancing, restarting or queuing an answer.
      // Presses during speech still affect annoyance/progression, not cadence.
      door.pending.kind=kind;
    }
    this.dirty=true;
    return true;
  }

  getProgress():HallNeighborProgress {
    return {specialDoorConsumed:this.specialDoorConsumed,attempts:Object.fromEntries(this.attempts),
      voices:Object.fromEntries(this.doors.flatMap(door=>door.voice?[[door.id,door.voice]]:[])),
      reactions:Object.fromEntries(this.doors.filter(door=>door.voice).map(door=>[door.id,{annoyance:door.annoyance,cursor:door.cursor,lastLine:door.lastLine}]))};
  }
  private hidePrompt():void {if(this.prompted)this.ui.setInteraction(null);this.prompted=false;}
  suspend():void {this.hidePrompt();this.callbacks.stopVoice();this.callbacks.hideCaption?.();this.captionDoor=undefined;}
  dispose():void {if(this.disposed)return;this.disposed=true;this.suspend();this.special?.dispose();this.doors.length=0;this.attempts.clear();this.ownCooldowns.clear();}
}
