import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {auditComputerPose} from './support/pc-pose-audit.mjs';
import {createLab,THREE} from './support/headless-character.mjs';
await build({entryPoints:['src/apartment/ComputerUseSequence.ts','src/apartment/ComputerChair.ts','src/apartment/ImportedApartmentEnvironment.ts','tests/support/load-apartment-model.ts'],outbase:'.',outdir:'.character-test-dist/pc',bundle:true,platform:'node',format:'esm',packages:'external',plugins:[{name:'rapier',setup(b){b.onResolve({filter:/^@dimforge\/rapier3d$/},()=>({path:path.resolve('tests/character/support/rapier-headless.mjs')}));
  b.onResolve({filter:/^virtual:public-manifests$/},()=>({path:'public-manifests',namespace:'pc-test'}));
  b.onLoad({filter:/.*/,namespace:'pc-test'},()=>({contents:`export const apartmentRuntimeSha256 = ${JSON.stringify(JSON.parse(readFileSync('public/assets/imported-apartment/apartment.runtime.parts.json','utf8')).runtimeSha256)};`}));
}}]});
const {ComputerUseSequence,planComputerApproach}=await import('../../.character-test-dist/pc/src/apartment/ComputerUseSequence.js');
const {ComputerChair}=await import('../../.character-test-dist/pc/src/apartment/ComputerChair.js');
const {ImportedApartmentEnvironment}=await import('../../.character-test-dist/pc/src/apartment/ImportedApartmentEnvironment.js');
const {loadApartmentModel}=await import('../../.character-test-dist/pc/tests/support/load-apartment-model.js');
const RAPIER=(await import('@dimforge/rapier3d-compat')).default;
const lab=await createLab({useWardrobe:true});lab.setInteractionPartner(null);
const apartment=new ImportedApartmentEnvironment(await loadApartmentModel(new URL('../../public/assets/imported-apartment/',import.meta.url)));lab.scene.add(apartment.group);
lab.physics.addTrimeshChunk('pc-real-shell',apartment.shellColliderMeshes);lab.physics.addChunk('pc-real-furniture',apartment.furnitureColliders,{x:0,y:0,z:0});
const audited=new Set();
let sequence,desktop=false,opens=0,ends=0,blocked=false;const frames=[],overlaps=[];let reduced=false;
const camera=lab.host.renderCamera;const framing=[];
function begin(start,progress,consumed=false){
  sequence?.dispose();lab.player.teleport(start);lab.player.setLookQuaternion(new THREE.Quaternion());lab.getArrivalPOV(camera);lab.setActive(false);desktop=false;opens=0;ends=0;blocked=consumed;frames.length=0;overlaps.length=0;framing.length=0;
  sequence=new ComputerUseSequence(new ComputerChair(apartment.computerChair,apartment.group,lab.physics),lab.physics,camera,{
    position:()=>lab.player.position,pose:(p,narrow,shape)=>{lab.player.setScriptedPose(p,narrow,shape);const hit=lab.physics.world.intersectionWithShape(p,{x:0,y:0,z:0,w:1},new RAPIER.Capsule(shape?.halfHeight??(narrow?.42:.52),shape?.radius??(narrow?.23:.32)),undefined,undefined,undefined,undefined,lab.physics.isEnvironmentCollider);if(hit)overlaps.push({phase:sequence.state,body:hit.parent()?.handle,point:{...p}});},
    begin:()=>lab.beginComputerPresentation(),sample:(s,fp)=>lab.sampleComputerPresentation(s,fp),end:fp=>{ends++;lab.player.setLookQuaternion(camera.quaternion);lab.endComputerPresentation(fp);return camera.clone();},modal:()=>{},openDesktop:()=>{desktop=true;opens++;},closeDesktop:()=>{desktop=false;},resume:()=>{},blocked:()=>blocked,hint:()=>{},reducedMotion:()=>reduced,
  },progress);
}
function step(count){for(let i=0;i<count;i++){sequence.update(1/60,true);lab.physics.stepDynamics(1/60);const d=sequence.debugState;if(d.frame&&['pull-chair','align','sitting','settling'].includes(d.phase)){camera.updateMatrixWorld(true);for(const point of [d.frame.head,...d.frame.feet]){const ndc=point.clone().project(camera);framing.push({phase:d.phase,x:ndc.x,y:ndc.y});}}
 if(d.frame)frames.push({phase:d.phase,chairOffset:d.chairOffset,camera:camera.position.clone(),...d.frame});
 const auditPhase=d.phase==='sitting'&&d.frame?.hips.y<9.48?'lowering':d.phase==='using'?'seated':d.phase==='rising'&&d.frame?.hips.y>9.48?'rising':null;
 if(process.env.PC_VISUAL_AUDIT&&auditPhase&&!audited.has(auditPhase)){audited.add(auditPhase);auditComputerPose(auditPhase,lab,apartment);}}}
after(()=>{sequence?.dispose();apartment.dispose();lab.dispose();});

test('uses the selected dressed rig, enters from either free side and opens the desktop only after actual seating',()=>{
  assert.ok(lab.character.userData.wardrobeProfile);let clothing=0;lab.character.traverse(o=>{if(o.userData.wardrobeSlot&&o.isSkinnedMesh)clothing++;});assert.ok(clothing>=2,'A real dressed wardrobe avatar must be used');
  for(const start of [new THREE.Vector3(-6.1,9.5363203,-3.6),new THREE.Vector3(-7.8,9.5363203,-3.6)]){
    begin(start);assert.equal(planComputerApproach(lab.physics,start)?.side,start.x< -7?0:1);assert.equal(sequence.start(),true);assert.equal(desktop,false);for(let i=0;i<20;i++)sequence.start();step(25);assert.equal(desktop,false);
    const paused=sequence.getProgress(),position=camera.position.clone();sequence.update(2,false);assert.deepEqual(sequence.getProgress(),paused);assert.ok(camera.position.distanceTo(position)<1e-9);
    step(650);assert.equal(sequence.state,'using');assert.equal(desktop,true);assert.equal(opens,1);assert.equal(lab.avatarAnchor.visible,true);assert.equal(lab.firstPersonAvatarAnchor.visible,false);assert.equal(lab.idleNpcAnchor.visible,false);assert.equal(lab.headMaskWarmup.value,1);
    assert.deepEqual([...new Set(frames.map(f=>f.phase))],['approach','pull-chair','align','sitting','settling','camera-in','using']);
    const d=sequence.debugState.frame;assert.ok(Math.abs(d.hips.y-9.2389808)<.015);assert.ok(d.knees.every(p=>p.y<d.hips.y+.08&&p.y>8.8));assert.ok(d.feet.every(p=>p.y>8.70&&p.y<8.85));
    assert.ok(d.head.y>new THREE.Box3().setFromObject(apartment.group.getObjectByName('Desk')).max.y+.18,'Seated head must remain above the real desk');assert.ok(d.hands.every(p=>p.y>9.46&&p.y<9.58),'Hands rest around the keyboard height');
    const planted=frames.filter(f=>['sitting','settling','camera-in','using'].includes(f.phase));
    for(const foot of [0,1]){const first=planted[0].feet[foot];assert.ok(planted.every(f=>f.feet[foot].distanceTo(first)<.035),'Planted foot slides while sitting or moving the chair towards the desk');}
    assert.equal(lab.computerPose.sit.getClip().name,'computer-sit-retargeted-fbx');assert.equal(overlaps.length,0,JSON.stringify(overlaps.slice(0,5)));assert.ok(framing.every(p=>Math.abs(p.x)<1&&Math.abs(p.y)<1),JSON.stringify(framing.filter(p=>Math.abs(p.x)>=1||Math.abs(p.y)>=1).slice(0,8)));lab.setSettings(lab.settings);assert.equal(lab.firstPersonAvatarAnchor.visible,false);
    sequence.close();assert.equal(desktop,false);step(400);assert.equal(sequence.state,'standing');assert.equal(ends,1);assert.ok(lab.physics.canStandAt(lab.player.position));
  }
});
test('uses the computer again without snapping an already pulled-out chair back under the desk',()=>{
  begin(new THREE.Vector3(-6.1,9.5363203,-3.6));sequence.start();step(650);sequence.close();step(400);
  assert.equal(sequence.state,'standing');const offset=sequence.chair.offset;assert.ok(offset>.34);
  frames.length=0;sequence.start();step(650);assert.equal(sequence.state,'using');assert.equal(opens,2);
  const entry=frames.filter(f=>['approach','pull-chair','align','sitting'].includes(f.phase));assert.ok(entry.length>60);
  assert.ok(entry.every(f=>f.chairOffset>=offset-.001),'Chair jumps forward before the second sit');
  assert.equal(overlaps.length,0,JSON.stringify(overlaps.slice(0,5)));
});
test('cuts the desktop immediately and rises in first person with the real head and hips before returning full control',()=>{
  begin(new THREE.Vector3(-6.1,9.5363203,-3.6));sequence.start();step(650);const seated=sequence.debugState.frame,headY=seated.head.y;
  blocked=true;sequence.powerCut();assert.equal(desktop,false);assert.equal(sequence.debugState.firstPerson,true);sequence.powerCut();step(400);
  assert.equal(sequence.state,'blocked');assert.equal(ends,1);assert.equal(lab.cameraMode,'first-person');assert.ok(lab.physics.canStandAt(lab.player.position));
  const rises=frames.filter(f=>f.phase==='rising');assert.ok(rises.length>12);assert.ok(rises.at(-1).head.y-headY>.25);assert.ok(rises.every(f=>Math.abs(f.camera.y-(f.head.y+.075))<.12));
  for(let i=1;i<rises.length;i++)assert.ok(rises[i].camera.distanceTo(rises[i-1].camera)<.13,'Continuous head-camera motion');
  assert.equal(overlaps.length,0,JSON.stringify(overlaps.slice(0,8)));assert.equal(sequence.start(),true);assert.equal(desktop,false);assert.equal(opens,1);
  mkdirSync('.asset-cache',{recursive:true});writeFileSync('.asset-cache/pc-motion-frames.json',JSON.stringify(frames));
});

test('loads transitional snapshots at a stable stand without a second sit or shock, and keeps the blocked PC blocked',()=>{
  begin(new THREE.Vector3(-6.1,9.5363203,-3.6));sequence.start();step(250);const snapshot=sequence.getProgress();assert.ok(!['standing','blocked'].includes(snapshot.phase));
  begin(new THREE.Vector3().copy(snapshot.safePosition),snapshot);assert.equal(sequence.state,'standing');assert.equal(desktop,false);assert.equal(opens,0);assert.ok(lab.physics.canStandAt(lab.player.position));
  begin(new THREE.Vector3().copy(snapshot.safePosition),snapshot,true);assert.equal(sequence.state,'blocked');sequence.start();step(40);assert.equal(opens,0);assert.equal(desktop,false);assert.equal(ends,0);
});

test('chooses the opposite approach when a real obstacle blocks the preferred side',()=>{
  const start=new THREE.Vector3(-6.1,9.5363203,-3.6);begin(start);
  lab.physics.addChunk('pc-blocked-side',[{id:'side-obstacle',center:{x:-6.36,y:9.3,z:-4.3},halfExtents:{x:.22,y:.65,z:.23},kind:'barrier'}],{x:0,y:0,z:0});
  try{assert.equal(planComputerApproach(lab.physics,start)?.side,0);sequence.start();step(650);assert.equal(sequence.state,'using');assert.equal(opens,1);assert.equal(overlaps.length,0,JSON.stringify(overlaps.slice(0,5)));}finally{lab.physics.removeChunk('pc-blocked-side');}
});
test('a cut after leaving the computer reacts at the actual standing location without moving the player to the PC floor',()=>{
  const start=new THREE.Vector3(-6.1,.865,-3.6);begin(start);blocked=true;sequence.powerCut();step(180);
  assert.equal(sequence.state,'blocked');assert.ok(lab.player.position.distanceTo(start)<.01);assert.equal(opens,0);assert.equal(ends,1);
});

test('keeps reduced-motion framing stable, preserves normal third-person exit and freezes a covered rig without stopping the host physics',()=>{
  begin(new THREE.Vector3(-6.1,9.5363203,-3.6));reduced=true;lab.toggleView();const mode=lab.cameraMode;sequence.start();step(650);assert.equal(sequence.state,'using');
  const frame=sequence.debugState.frame;for(let i=0;i<100;i++){sequence.update(.05,true,true);lab.physics.stepDynamics(1/60);}assert.equal(sequence.debugState.frame,frame);
  sequence.close();step(400);assert.equal(sequence.state,'standing');assert.equal(lab.cameraMode,mode);assert.ok(lab.physics.canStandAt(lab.player.position));reduced=false;
});
