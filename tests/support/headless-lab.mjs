import { build } from 'esbuild';
import { Window } from 'happy-dom';
import * as THREE from 'three';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const out=path.join(root,'.movement-test-dist/headless-lab.mjs');
mkdirSync(path.dirname(out),{recursive:true});
await build({entryPoints:[path.join(root,'src/dev/AnimationLab.ts')],outfile:out,bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'},plugins:[{
 name:'headless-surfaces',setup(b){
  b.onResolve({filter:/^three$/},args=>/\/AnimationLab\.ts$/.test(args.importer)?{path:path.join(root,'tests/support/three-headless.mjs')}:undefined);
  b.onResolve({filter:/^@dimforge\/rapier3d$/},()=>({path:path.join(root,'tests/support/rapier-headless.mjs')}));
 }
}]});
const window=new Window({url:'http://localhost/'});
for(const key of ['window','document','HTMLElement','HTMLCanvasElement','MouseEvent','KeyboardEvent','Event','localStorage'])globalThis[key]=key==='window'?window:window[key];
globalThis.requestAnimationFrame=()=>0;globalThis.cancelAnimationFrame=()=>{};
window.HTMLCanvasElement.prototype.getContext=function(){return new Proxy({canvas:this,getImageData:()=>({data:new Uint8ClampedArray(this.width*this.height*4)}),createImageData:()=>({data:new Uint8ClampedArray(this.width*this.height*4)}),createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}}),createPattern:()=>({setTransform(){}})}, {get:(t,k)=>t[k]??(()=>{}),set:(t,k,v)=>(t[k]=v,true)});};
THREE.TextureLoader.prototype.load=function(url,onLoad){const texture=new THREE.Texture();queueMicrotask(()=>onLoad?.(texture));return texture;};
THREE.FileLoader.prototype.load=function(url,onLoad,_progress,onError){try{const data=readFileSync(path.join(root,'public',url));const result=this.responseType==='json'?JSON.parse(data.toString('utf8')):this.responseType==='text'?data.toString('utf8'):data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);queueMicrotask(()=>onLoad(result));}catch(e){queueMicrotask(()=>onError?.(e));}};
export const {AnimationLab}=await import(out);
export async function createLab(){const app=document.createElement('div');document.body.append(app);const lab=new AnimationLab(app);await lab.initialize();lab.renderer.setAnimationLoop(null);return lab;}
export function stepLab(lab,delta=1/60){lab.frame(lab.previousTime+delta*1000);}
export {THREE};
export function setupDuel(lab,distance=1.05,view='third-person'){
 if(lab.ragdoll)lab.respawnPlayer();
 lab.resetCombatState(true);lab.playerBalance.reset();lab.playerHitHandoff.reset();lab.firstPersonHitHandoff.reset();
 lab.playerImpactPitch=[0,0];lab.playerImpactRoll=[0,0];lab.combatHitReaction=null;
 lab.health=100;lab.secondsSinceDamage=0;lab.combatPreviousTargets={player:null,npc:null};
 lab.resetNpcOpponent(false);lab.npcAttackCooldown=100;lab.npcGroundKickRecoveryDelay=100;
 lab.player.controls.isLocked=true;lab.player.setInputEnabled(true);lab.player.setIncapacitated(false);
 lab.player.teleport({x:lab.idleNpcAnchor.position.x,y:.865,z:lab.idleNpcAnchor.position.z-distance});
 lab.player.lookCamera.rotation.set(0,Math.PI,0);lab.player.continuousAimYaw=Math.PI;
 lab.bodyYaw=0;lab.avatarAnchor.rotation.y=0;lab.idleNpcAnchor.rotation.y=Math.PI;
 lab.viewMode=view;lab.applyViewMode(true);
 lab.combatPointerHeld=true;lab.combatLatchReason='manual';lab.combatLatchSeconds=10;lab.startCombatLayers();lab.startNpcCombatGuardLayers();
 for(let i=0;i<24;i++)stepLab(lab);
}
