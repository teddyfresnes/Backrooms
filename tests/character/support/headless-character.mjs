import { build } from 'esbuild';
import { Window } from 'happy-dom';
import * as THREE from 'three';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const out=path.join(root,'.character-test-dist/headless-character.mjs');
mkdirSync(path.dirname(out),{recursive:true});
await build({entryPoints:[path.join(root,'src/character/CharacterRuntime.ts')],outfile:out,bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'},plugins:[{
 name:'headless-surfaces',setup(b){
  b.onResolve({filter:/^@dimforge\/rapier3d$/},()=>({path:path.join(root,'tests/character/support/rapier-headless.mjs')}));
 }
}]});
const window=new Window({url:'http://localhost/'});
for(const key of ['window','document','HTMLElement','HTMLCanvasElement','MouseEvent','KeyboardEvent','Event','localStorage'])globalThis[key]=key==='window'?window:window[key];
globalThis.requestAnimationFrame=()=>0;globalThis.cancelAnimationFrame=()=>{};
window.HTMLCanvasElement.prototype.getContext=function(){return new Proxy({canvas:this,getImageData:()=>({data:new Uint8ClampedArray(this.width*this.height*4)}),createImageData:()=>({data:new Uint8ClampedArray(this.width*this.height*4)}),createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}}),createPattern:()=>({setTransform(){}})}, {get:(t,k)=>t[k]??(()=>{}),set:(t,k,v)=>(t[k]=v,true)});};
THREE.TextureLoader.prototype.load=function(url,onLoad){const texture=new THREE.Texture();queueMicrotask(()=>onLoad?.(texture));return texture;};
THREE.FileLoader.prototype.load=function(url,onLoad,_progress,onError){try{const data=readFileSync(path.join(root,'public',url));const result=this.responseType==='json'?JSON.parse(data.toString('utf8')):this.responseType==='text'?data.toString('utf8'):data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);queueMicrotask(()=>onLoad(result));}catch(e){queueMicrotask(()=>onError?.(e));}};
export const {CharacterRuntime}=await import(out);
const { PhysicsWorld } = await import(path.join(root,'.character-test-dist/physics/PhysicsWorld.js'));
const { PlayerController } = await import(path.join(root,'.character-test-dist/player/PlayerController.js'));
const { loadGameSettings } = await import(path.join(root,'.character-test-dist/ui/settings.js'));
const { createMovementLabPlan, MOVEMENT_LAB_PITS, MOVEMENT_LAB_IDLE_NPC } = await import(path.join(root,'.character-test-dist/fixture-world.js'));
export async function createLab(){
 const app=document.createElement('div'),canvas=document.createElement('canvas'); app.append(canvas);document.body.append(app);
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(72,1,.01,140),renderCamera=camera.clone();
 const plan=createMovementLabPlan(), physics=await PhysicsWorld.create(plan); let runtime;
 const player=new PlayerController(camera,canvas,physics,{
  onLockChange:locked=>runtime?.setActive(locked),onFootstep(){},onInteract(){},onSafePosition(){},onFallReset(){},
  onLand:(speed,impact)=>runtime?.handleLanding(speed,impact),
 });
 camera.position.set(plan.spawn.x,1.6,plan.spawn.z);camera.lookAt(-8,1.35,-7);
 runtime=new CharacterRuntime({container:app,canvas,scene,playerCamera:camera,renderCamera,physics,player,
  settings:loadGameSettings(),seed:plan.seed,automaticHelp:false,isPlaying:()=>player.isLocked,getPits:()=>MOVEMENT_LAB_PITS});
 await runtime.initialize();
 runtime.setInteractionPartner(new THREE.Vector3(MOVEMENT_LAB_IDLE_NPC.x,MOVEMENT_LAB_IDLE_NPC.y,MOVEMENT_LAB_IDLE_NPC.z));
 // Legacy test obstacles now go through real Rapier mesh colliders.
 const meshes=[],keys=new Map();let sequence=0;
 meshes.push=(mesh)=>{const key=`fixture-obstacle-${sequence++}`;physics.addTrimeshChunk(key,[mesh]);keys.set(mesh,key);return Array.prototype.push.call(meshes,mesh);};
 meshes.pop=()=>{const mesh=Array.prototype.pop.call(meshes);if(mesh){physics.removeChunk(keys.get(mesh));keys.delete(mesh);}return mesh;};
 meshes.splice=(start,count)=>{const removed=Array.prototype.splice.call(meshes,start,count);for(const mesh of removed){physics.removeChunk(keys.get(mesh));keys.delete(mesh);}return removed;};
 runtime.environmentMeshes=meshes;
 const dispose=runtime.dispose.bind(runtime);runtime.dispose=()=>{dispose();player.dispose();physics.dispose();app.remove();};
 return runtime;
}
export function stepLab(lab,delta=1/60){lab.frame(lab.previousTime+delta*1000);}
export {THREE};
export function setupDuel(lab,distance=1.05,view='third-person'){
 if(lab.ragdoll)lab.respawnPlayer();
 lab.resetCombatState(true);lab.playerBalance.reset();lab.playerHitHandoff.reset();lab.firstPersonHitHandoff.reset();
 lab.playerImpactPitch=[0,0];lab.playerImpactRoll=[0,0];lab.combatHitReaction=null;
 lab.health=100;lab.secondsSinceDamage=0;lab.combatPreviousTargets={player:null,npc:null};
 lab.setInteractionPartner(lab.partnerSpawn.clone(), false);lab.npcAttackCooldown=100;lab.npcGroundKickRecoveryDelay=100;
 lab.player.controls.isLocked=true;lab.player.setInputEnabled(true);lab.player.setIncapacitated(false);
 lab.player.teleport({x:lab.idleNpcAnchor.position.x,y:.865,z:lab.idleNpcAnchor.position.z-distance});
 lab.player.lookCamera.rotation.set(0,Math.PI,0);lab.player.continuousAimYaw=Math.PI;
 lab.bodyYaw=0;lab.avatarAnchor.rotation.y=0;lab.idleNpcAnchor.rotation.y=Math.PI;
 lab.viewMode=view;lab.applyViewMode(true);
 lab.combatPointerHeld=true;lab.combatLatchReason='manual';lab.combatLatchSeconds=10;lab.startCombatLayers();lab.startNpcCombatGuardLayers();
 for(let i=0;i<24;i++)stepLab(lab);
}
