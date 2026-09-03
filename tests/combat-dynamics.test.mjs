import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { sweepCombatContact, combatChainReady, CombatBalance, stepCombatSpring } from '../.movement-test-dist/dev/CombatContact.js';
import { solveCombatTwoBone, limitKneeLateralBend, CombatPoseHandoff, CombatMotionHistory, CombatProceduralPose } from '../.movement-test-dist/dev/CombatRig.js';
import { groundKickContactAccepted } from '../.movement-test-dist/dev/GroundKickRules.js';
const v = (x=0,y=0,z=0)=>({x,y,z});
const sweep=(a,b,c=v(0.5),d=c,r=.10,dt=1/30,p0=.3,p1=.6)=>sweepCombatContact(a,b,c,d,r,dt,p0,p1,.35,.55);

test('a fast fist crossing the entire target registers at entry, never at a later timer',()=>{
 const hit=sweep(v(),v(.7)); assert.ok(hit); assert.ok(Math.abs(hit.fraction-4/7)<1e-8);
 assert.ok(Math.abs(hit.point.x-.4)<1e-8);
});
test('a moving target crossing a committed fist is swept in relative space',()=>{
 const hit=sweep(v(),v(.2),v(.5),v(.1),.10,1/30);
 assert.ok(hit);assert.ok(Math.abs(hit.fraction-2/3)<1e-8);
});
test('a hand missing the body never receives an intended-target or range fallback',()=>{
 assert.equal(sweep(v(0,.5),v(.7,.5)),null);
});
test('anticipation and recoil segments outside the contact interval are clipped out',()=>{
 assert.equal(sweep(v(),v(.7),v(.3),v(.3),.10,1/30,.0,.3),null);
 assert.equal(sweep(v(),v(.7),v(.3),v(.3),.10,1/30,.6,.8),null);
 // Overlap occurred before activation and is already exiting when the window opens.
 assert.equal(sweep(v(),v(.7),v(.1),v(.1)),null);
});
test('retraction, idle overlap, teleports and invalid input never deal damage',()=>{
 assert.equal(sweep(v(.52),v(.7)),null);
 assert.equal(sweep(v(.5),v(.5)),null);
 assert.equal(sweep(v(),v(8)),null);
 assert.equal(sweep(v(NaN),v(.7)),null);
 assert.equal(sweep(v(),v(.7),v(.5),v(.5),.1,0),null);
});
test('continuous contact time is stable at 30, 60, 120 and 240 fps',()=>{
 const times=[];
 for (const fps of [30,60,120,240]) {
  let hitTime=null;
  for (let f=1;f<=fps;f++) {
   const a=(f-1)/fps,b=f/fps;
   const hit=sweepCombatContact(v(a*2),v(b*2),v(1),v(1),.10,1/fps,a,b,.3,.7);
   if(hit){hitTime=a+hit.fraction/fps;break;}
  }
  times.push(hitTime);assert.ok(Math.abs(hitTime-.45)<1e-7);
 }
});
test('a frame spanning both contact-window boundaries retains a genuine contact',()=>{
 const hit=sweepCombatContact(v(.0),v(.7),v(.40),v(.40),.10,.05,.30,.65,.36,.51);
 assert.ok(hit);assert.ok(hit.fraction<.5);
});
test('combo windows require actual recoil and stay available at the end of recovery',()=>{
 assert.equal(combatChainReady(.35,.7,.55,.45),false);
 assert.equal(combatChainReady(.50,.7,.55,.45),true);
 assert.equal(combatChainReady(.68,.7,.55,.45),true);
});
test('balance loss depends on actual zone, force and time, and clears on reset',()=>{
 const body=new CombatBalance(),head=new CombatBalance();
 assert.ok(head.hit(0,14,'head',false)>body.hit(0,14,'body',false));
 assert.ok(head.hit(.4,14,'head',false)>25);
 assert.ok(head.hit(.8,20,'head',true)>37);
 assert.ok(head.hit(8,5,'body',false)<5);
 head.reset();assert.equal(head.hit(9,10,'upper-body',false),10);
});
test('impact spring decay is independent of render rate and has no jittering tail',()=>{
 let coarse=[0,5],fine=[0,5];
 for(let i=0;i<30;i++) coarse=stepCombatSpring(...coarse,1/30);
 for(let i=0;i<240;i++) fine=stepCombatSpring(...fine,1/240);
 assert.ok(Math.abs(coarse[0]-fine[0])<1e-10);assert.ok(Math.abs(fine[0])<1e-6);
});
function limb(){const root=new THREE.Group(),a=new THREE.Bone(),b=new THREE.Bone(),c=new THREE.Bone();root.add(a);a.add(b);b.add(c);b.position.set(0,-.42,0);c.position.set(0,-.43,0);root.updateMatrixWorld(true);return {root,a,b,c};}
test('two-bone solve reaches a target while preserving both anatomical segment lengths',()=>{
 const {root,a,b,c}=limb();const target=new THREE.Vector3(.1,-.5,.4);
 solveCombatTwoBone(a,b,c,target,1,new THREE.Vector3(0,0,1));root.updateMatrixWorld(true);
 const p=a.getWorldPosition(new THREE.Vector3()),q=b.getWorldPosition(new THREE.Vector3()),r=c.getWorldPosition(new THREE.Vector3());
 assert.ok(r.distanceTo(target)<1e-6);assert.ok(Math.abs(p.distanceTo(q)-.42)<1e-6);assert.ok(Math.abs(q.distanceTo(r)-.43)<1e-6);
});
test('high close contacts keep the lifted knee in front without moving the foot target or stretching the leg',()=>{
 for(const side of [-1,1])for(const yaw of [-Math.PI+.01,0,Math.PI-.01]) {
  const {root,a,b,c}=limb();root.rotation.y=yaw;root.updateMatrixWorld(true);
  const target=new THREE.Vector3(side*.14,.10,.26).applyQuaternion(root.quaternion);
  const forward=new THREE.Vector3(Math.sin(yaw),0,Math.cos(yaw));
  const pole=limitKneeLateralBend(a,b,c,target,forward,.997);
  solveCombatTwoBone(a,b,c,target,1,pole,.997);root.updateMatrixWorld(true);
  const hip=a.getWorldPosition(new THREE.Vector3()),knee=b.getWorldPosition(new THREE.Vector3()),foot=c.getWorldPosition(new THREE.Vector3());
  const relative=knee.clone().sub(hip).applyQuaternion(root.quaternion.clone().invert());
  assert.ok(Math.abs(relative.x)<=.085001,`high contact splays the knee ${relative.x}m`);
  assert.ok(relative.z>0,'high contact folds the knee backwards');
  assert.ok(foot.distanceTo(target)<1e-6,'knee correction fabricates foot reach');
  assert.ok(Math.abs(hip.distanceTo(knee)-.42)<1e-6&&Math.abs(knee.distanceTo(foot)-.43)<1e-6);
 }
});
test('unreachable, near-singular and turned kick targets keep a bent finite knee without stretching',()=>{
 for(const target of [new THREE.Vector3(0,-5,.1),new THREE.Vector3(.001,0,0),new THREE.Vector3(-.5,-.1,.5)]) {
  for(const yaw of [-Math.PI*5,-Math.PI+.01,0,Math.PI-.01,Math.PI*5]) {
   const {root,a,b,c}=limb();root.rotation.y=yaw;root.updateMatrixWorld(true);
   solveCombatTwoBone(a,b,c,target,1,new THREE.Vector3(Math.sin(yaw),0,Math.cos(yaw)));
   assert.ok([...a.quaternion,...b.quaternion].every(Number.isFinite));
   assert.ok(c.getWorldPosition(new THREE.Vector3()).distanceTo(a.getWorldPosition(new THREE.Vector3()))<=.85*.976);
  }
 }
});
test('pose handoff starts at the interrupted pose and converges without changing bone lengths',()=>{
 const {root,a,b}=limb(),handoff=new CombatPoseHandoff();a.rotation.z=.6;handoff.capture(root,.1);a.quaternion.identity();handoff.apply(0);
 assert.ok(Math.abs(a.rotation.z-.6)<1e-6);a.quaternion.identity();handoff.apply(.1);assert.ok(a.quaternion.angleTo(new THREE.Quaternion())<1e-6);assert.equal(b.position.length(),.42);
});
test('NPC pose history preserves motion and treats opposite quaternion signs as identical',()=>{
 const {root,a}=limb();a.name='mixamorigHips';const history=new CombatMotionHistory();history.capture(root,1/60);root.position.x=.02;a.quaternion.set(0,0,0,-1);history.capture(root,1/60);
 const motion=history.getMotion().bones.mixamorighips;assert.ok(Math.abs(motion.linearVelocity.x-1.2)<1e-5);assert.equal(motion.angularVelocity.length(),0);
 history.reset();assert.equal(history.getMotion(),undefined);
});
test('interrupted pelvis returns to its base when the next clip has no position track',()=>{
 const {root,a}=limb(),handoff=new CombatPoseHandoff();a.position.set(.12,-.1,0);handoff.capture(root,.1);a.position.set(0,0,0);
 for(let i=0;i<7;i++)handoff.apply(1/60);
 assert.ok(a.position.length()<1e-8);
});
test('ground kick validation rejects nonfinite and negative distances',()=>{
 assert.equal(groundKickContactAccepted(.5,'stomp',NaN,.5),false);
 assert.equal(groundKickContactAccepted(.5,'stomp',-.1,.5),false);
 assert.equal(groundKickContactAccepted(.5,'stomp',.1,-1),false);
});

// This regressed only on constant animation keys: the mixer legitimately skips
// reapplying them, so a render correction must never become the next base pose.
test('constant tracks cannot accumulate procedural rotations or translation',()=>{
 const {root,a}=limb(), layer=new CombatProceduralPose();
 const mixer=new THREE.AnimationMixer(root);a.name='leg';
 mixer.clipAction(new THREE.AnimationClip('idle',1,[new THREE.QuaternionKeyframeTrack('leg.quaternion',[0,1],[0,0,0,1,0,0,0,1])])).play();
 for(let i=0;i<240;i++){
  layer.restore();mixer.update(1/120);layer.capture(root);
  a.rotateX(.07);a.position.x+=.02;
  assert.ok(Math.abs(a.rotation.x-.07)<1e-6);assert.ok(Math.abs(a.position.x-.02)<1e-6);
 }
 layer.restore();assert.ok(a.quaternion.angleTo(new THREE.Quaternion())<1e-6);assert.equal(a.position.x,0);
});
test('procedural restoration does not retain the interrupted pose during a constant-track handoff',()=>{
 const {root,a}=limb(),layer=new CombatProceduralPose(),handoff=new CombatPoseHandoff();a.rotation.x=.7;handoff.capture(root,.1);a.quaternion.identity();
 for(let i=0;i<12;i++){layer.restore();layer.capture(root);handoff.apply(1/60);a.rotateX(.02);}
 layer.restore();assert.ok(a.quaternion.angleTo(new THREE.Quaternion())<1e-6);
});
