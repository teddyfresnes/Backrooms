import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { NeighborDoorInteraction, neighborReply } from './NeighborDoorInteraction';
import { neighborActor, neighborProfile } from './NeighborProfiles';
import { PLAYER_APARTMENT_DOOR_ID } from '../apartment/DoorIdentity';
const resources:Array<()=>void>=[];
afterEach(()=>resources.splice(0).reverse().forEach(dispose=>dispose()));
function fixture(){
 const root=new THREE.Group(),geometry=new THREE.BoxGeometry(.1,2.2,1),material=new THREE.MeshBasicMaterial();
 for(const [id,x,z] of [['west-neighbor-door-1-leaf',-1.8,-3],['east-neighbor-door-1-leaf',1.8,0],['west-neighbor-door-0-leaf',-1.8,0],['east-neighbor-door-0-leaf',1.8,-3]] as const){
  const leaf=new THREE.Mesh(geometry,material);leaf.name=id;leaf.position.set(x,1.3,z);leaf.userData.neighborHinge=[x,.2,z+.5];root.add(leaf);
 }
 const callbacks={sound:vi.fn((kind:string)=>kind==='bell'?4:.8),say:vi.fn(),speak:vi.fn((..._args:[string,unknown,string,unknown,unknown?])=>true),voiceDuration:()=>1,stopVoice:vi.fn(),hideCaption:vi.fn(),soundCaptions:()=>true,changed:vi.fn()};
 const ui={setInteraction:vi.fn()};
 const create=(progress?:ReturnType<NeighborDoorInteraction['getProgress']>,bells:ConstructorParameters<typeof NeighborDoorInteraction>[3]=[],own?:THREE.Object3D)=>{
  const interaction=new NeighborDoorInteraction(root,ui,callbacks,bells,progress,'alex',own);resources.push(()=>interaction.dispose());return interaction;
 };
 resources.push(()=>{geometry.dispose();material.dispose();});return{root,callbacks,ui,create};
}
it('does not offer a knock on an invisible leaf or a hidden parent',()=>{
 const f=fixture(),i=f.create(),leaf=f.root.getObjectByName('west-neighbor-door-1-leaf')!;
 const parent=new THREE.Group();f.root.add(parent);parent.add(leaf);parent.visible=false;
 expect(i.interact(p,left,true)).toBe(false);i.update(.1,p,left,true);
 expect(f.ui.setInteraction).not.toHaveBeenCalledWith('Toquer');expect(f.callbacks.sound).not.toHaveBeenCalled();
 parent.visible=true;leaf.visible=false;expect(i.interact(p,left,true)).toBe(false);
 leaf.visible=true;expect(i.interact(p,left,true)).toBe(true);
});
const p=new THREE.Vector3(0,.865,-3),left=new THREE.Vector3(-1,0,0),right=new THREE.Vector3(1,0,0);
const advance=(i:NeighborDoorInteraction,seconds:number,point=p,direction=left)=>{for(let t=0;t<seconds;t+=.02)i.update(.02,point,direction,true);};
it('answers promptly, counts presses during speech, escalates by cadence and coalesces the response queue',()=>{
 const f=fixture(),i=f.create();i.interact(p,left,true);advance(i,3);
 expect(f.callbacks.speak).toHaveBeenCalledTimes(1);
 const first=f.callbacks.say.mock.calls[0]![0];
 for(let n=0;n<60;n++){i.interact(p,left,true,n%2?'fast':'slow');i.update(.06,p,left,true);}
 expect(i.getProgress().attempts['west-neighbor-door-1-leaf']).toBe(61);
 expect(f.callbacks.sound.mock.calls.length).toBeGreaterThan(7);expect(f.callbacks.sound.mock.calls.length).toBeLessThan(20);
 expect(f.callbacks.speak.mock.calls.length).toBeGreaterThan(1);expect(f.callbacks.speak.mock.calls.length).toBeLessThan(5);
 expect(i.getProgress().reactions!['west-neighbor-door-1-leaf']!.annoyance).toBeGreaterThan(10);
 expect(f.callbacks.say.mock.calls.slice(1).some(([text])=>(/[A-ZÉÈÊ’ ]{8}/.test(text)||/putain|foutre|merde|chier|regretter|bordel|dégage|tuer|crever|casse/i.test(text)))).toBe(true);
 expect(f.callbacks.say.mock.calls.at(-1)![0]).not.toBe(first);
 const count=f.callbacks.speak.mock.calls.length;advance(i,10);expect(f.callbacks.speak.mock.calls.length).toBeLessThanOrEqual(count+1);
 advance(i,40);expect(i.getProgress().reactions!['west-neighbor-door-1-leaf']!.annoyance).toBe(0);
 expect(f.callbacks.changed.mock.calls.length).toBeLessThan(5);
});
it('keeps an empty door empty through 1000 audible requests and a save round trip',()=>{
 const f=fixture(),i=f.create(),silent=new THREE.Vector3(0,.865,0);
 for(let n=0;n<1000;n++){i.interact(silent,left,true,n%2?'fast':'slow');i.update(.5,silent,left,true);}
 expect(f.callbacks.sound).toHaveBeenCalledTimes(1000);expect(f.callbacks.speak).not.toHaveBeenCalled();expect(f.callbacks.say).not.toHaveBeenCalled();
 const saved=i.getProgress();expect(saved.voices!['west-neighbor-door-0-leaf']).toBeUndefined();expect(saved.attempts['west-neighbor-door-0-leaf']).toBe(1000);
 i.dispose();const loaded=f.create(saved);loaded.interact(silent,left,true);advance(loaded,8,silent);expect(f.callbacks.speak).not.toHaveBeenCalled();
});
it('freezes pending speech in pause and abandons it on disposal',()=>{
 const f=fixture(),i=f.create();i.interact(p,left,true);i.suspend();i.update(100,p,left,false);expect(f.callbacks.speak).not.toHaveBeenCalled();
 advance(i,3);expect(f.callbacks.speak).toHaveBeenCalledOnce();
 i.interact(p,left,true);i.dispose();i.update(10,p,left,true);expect(f.callbacks.speak).toHaveBeenCalledOnce();expect(f.callbacks.stopVoice).toHaveBeenCalled();
});
it('keeps the same resident, temperament, agitation and nonrepeating cursor across reloads',()=>{
 const f=fixture(),i=f.create();i.interact(p,left,true);advance(i,3);
 const first=f.callbacks.say.mock.calls[0]![0],saved=i.getProgress();i.dispose();const loaded=f.create(saved);
 loaded.interact(p,left,true);advance(loaded,3);expect(f.callbacks.say.mock.calls.at(-1)![0]).not.toBe(first);
 expect(loaded.getProgress().voices).toEqual(saved.voices);
 expect(new Set(f.callbacks.speak.mock.calls.map(call=>call[1])).size).toBe(1);
 for(const voice of ['alex','ian','sean','karen','meghan'] as const)expect(neighborActor('west-neighbor-door-1-leaf',voice)).not.toBe(voice);
});
it('has variable response delays, compatible nonverbal captions and no immediate repeat in any agitation band',()=>{
 const delays=new Set<number>();
 for(const id of ['west-neighbor-door-1-leaf','west-neighbor-door-2-leaf','east-neighbor-door-1-leaf']){
  let previous=-1,lastCue='';
  for(let n=1;n<=40;n++){
   const reply=neighborReply(id,n,n%2?'knock':'bell',n%12,previous);if(!reply)continue;
   delays.add(reply.delay);expect(reply.index).not.toBe(previous);expect(reply.cue).not.toBe(lastCue);
   if(reply.nonverbal)expect(reply.cue).toMatch(/^miscellaneous-/);
   previous=reply.index;lastCue=reply.cue;
  }
 }
 expect(delays.size).toBeGreaterThan(10);expect(Math.min(...delays)).toBeGreaterThanOrEqual(.3);expect(Math.max(...delays)).toBeGreaterThan(2);
 expect(neighborProfile(PLAYER_APARTMENT_DOOR_ID)).toBe('silent');
});
it('never gives the real own leaf or bell a resident, even with contaminated old save data',()=>{
 const f=fixture(),own=new THREE.Mesh(new THREE.BoxGeometry(.05,2,.9),new THREE.MeshBasicMaterial());
 own.name=PLAYER_APARTMENT_DOOR_ID;own.userData.doorId=PLAYER_APARTMENT_DOOR_ID;own.position.set(-1,1.3,-3);f.root.add(own);
 resources.push(()=>{own.geometry.dispose();own.material.dispose();});
 const bell={id:PLAYER_APARTMENT_DOOR_ID,position:new THREE.Vector3(-1,1.595,-2.7),own:false};
 const i=f.create({specialDoorConsumed:false,attempts:{[PLAYER_APARTMENT_DOOR_ID]:999},voices:{[PLAYER_APARTMENT_DOOR_ID]:'karen'}},[bell],own);
 for(let n=0;n<30;n++){i.interact(p,left,true,'fast',undefined,true);i.update(.5,p,left,true);}
 const bellDirection=bell.position.clone().sub(new THREE.Vector3(p.x,p.y+.73,p.z)).normalize();
 for(let n=0;n<30;n++){i.interact(p,bellDirection,true);i.update(.5,p,bellDirection,true);}
 expect(f.callbacks.sound).toHaveBeenCalled();expect(f.callbacks.speak).not.toHaveBeenCalled();expect(f.callbacks.say).not.toHaveBeenCalled();
 expect(i.getProgress().voices![PLAYER_APARTMENT_DOOR_ID]).toBeUndefined();expect(i.getProgress().attempts[PLAYER_APARTMENT_DOOR_ID]).toBeUndefined();
});
it('opens the special leaf visibly within half a second, slams once and persists consumption through interruption',()=>{
 const f=fixture(),i=f.create(),leaf=f.root.getObjectByName('east-neighbor-door-0-leaf')!;
 i.interact(p,right,true);const saved=i.getProgress();expect(saved.specialDoorConsumed).toBe(true);
 advance(i,.5,p,right);expect(Math.abs(leaf.parent!.rotation.y)).toBeGreaterThan(.25);
 expect(f.root.getObjectByName('neighbor-recess-backing')).toBeUndefined();expect(f.root.getObjectByName('neighbor-alcove-floor')).toBeDefined();
 advance(i,.8,p,right);expect(f.callbacks.sound.mock.calls.filter(c=>c[0]==='slam')).toHaveLength(1);
 i.dispose();expect(leaf.parent).toBe(f.root);const restored=f.create(saved);restored.interact(p,right,true);advance(restored,3,p,right);
 expect(f.callbacks.sound.mock.calls.filter(c=>c[0]==='slam')).toHaveLength(1);
});
it('keeps the first credible answer deadline during a burst and ignores follow-up requests during the spoken cooldown',()=>{
  const f=fixture(),interaction=f.create();interaction.interact(p,left,true);
  const delay=neighborReply('west-neighbor-door-1-leaf',1,'knock',.15,-1)!.delay;
  advance(interaction,.2);for(let n=0;n<100;n++)interaction.interact(p,left,true);
  advance(interaction,delay-.25);expect(f.callbacks.speak).not.toHaveBeenCalled();
  advance(interaction,.1);expect(f.callbacks.speak).toHaveBeenCalledOnce();
  for(let n=0;n<100;n++)interaction.interact(p,left,true);
  advance(interaction,8);expect(f.callbacks.speak).toHaveBeenCalledOnce();
  expect(interaction.getProgress().attempts['west-neighbor-door-1-leaf']).toBe(201);
});

it('escalates through five tiers of exchanges, shouts the last in capitals, threatens once at 10–15 exchanges, then falls silent',async()=>{
 const {neighborBreakingPoint,neighborTier}=await import('./NeighborProfiles');
 for(const id of ['west-neighbor-door-1-leaf','west-neighbor-door-2-leaf','east-neighbor-door-1-leaf']){
  const breaking=neighborBreakingPoint(id);expect(breaking).toBeGreaterThanOrEqual(10);expect(breaking).toBeLessThanOrEqual(15);
  let previous=-1;const recent:number[]=[];const tiers:number[]=[];const seen=new Set<string>();
  for(let cursor=1;cursor<breaking;cursor++){
   const reply=neighborReply(id,cursor,'knock',0,previous,recent);if(!reply)continue;
   tiers.push(neighborTier(id,cursor));expect(reply.final).toBe(false);
   expect(seen.has(reply.text)).toBe(false);seen.add(reply.text);previous=reply.index;recent.push(reply.index);
  }
  for(let i=1;i<tiers.length;i++)expect(tiers[i]).toBeGreaterThanOrEqual(tiers[i-1]!);
  expect(neighborTier(id,breaking-1)).toBe(4);
  const shout=neighborReply(id,breaking-1,'knock',0,-1)!;expect(shout.text).toBe(shout.text.toUpperCase());
  const threat=neighborReply(id,breaking,'knock',0,previous)!;expect(threat.final).toBe(true);
  expect(neighborReply(id,breaking+1,'knock',12,threat.index)).toBeNull();
 }
 // The empty flat never threatens anyone.
 expect(neighborReply('west-neighbor-door-0-leaf',12,'knock',12)).toBeNull();
});
it('opens fire once after the threat, at the speaking resident only, whatever the spam',()=>{
 const f=fixture();const gunfire=vi.fn();(f.callbacks as Record<string,unknown>).gunfire=gunfire;
 const i=f.create();
 for(let n=0;n<400&&!gunfire.mock.calls.length;n++){i.interact(p,left,true);advance(i,.6);}
 expect(gunfire).toHaveBeenCalledOnce();expect(gunfire.mock.calls[0]![0]).toBe('west-neighbor-door-1-leaf');
 for(let n=0;n<40;n++){i.interact(p,left,true);advance(i,.6);}
 expect(gunfire).toHaveBeenCalledOnce();
});
