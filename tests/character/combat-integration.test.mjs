import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createLab,setupDuel,stepLab,THREE} from './support/headless-character.mjs';
let lab;
before(async()=>{lab=await createLab();});
after(()=>lab?.dispose());
const run=(seconds,dt=1/60)=>{for(let time=0;time<seconds;time+=dt)stepLab(lab,dt);};
const strike=(variant='jab-a',kind='punch')=>{lab.startCombatAttackLayer(kind,variant,false,'medium',1.05);assert.ok(lab.combatAttack);return lab.combatAttack;};
for(const view of ['first-person','third-person'])for(const fps of [30,60,120]){
 test(`real FBX ${view} punch contacts once at ${fps} fps`,()=>{
  setupDuel(lab,1.05,view);const attack=strike();let changes=0,old=100;
  for(let i=0;i<fps;i++){
   stepLab(lab,1/fps);
   if(lab.npcHealth!==old){changes++;old=lab.npcHealth;assert.ok(attack.impactApplied);assert.ok(lab.npcHitReaction);assert.ok(attack.elapsed/attack.duration<=attack.contactEndFraction+1/fps);}
   if(lab.combatAttack){
    const phase=attack.elapsed/attack.duration;
    if(phase>=attack.contactStartFraction&&phase<=attack.contactEndFraction){
     const world=attack.strikingSide==='left'?lab.leftUpperArmBone:lab.rightUpperArmBone;
     const pov=attack.strikingSide==='left'?lab.firstPersonLeftUpperArmBone:lab.firstPersonRightUpperArmBone;
     assert.ok(world.quaternion.angleTo(pov.quaternion)<1e-6,'the striking arm must share its physical contact pose in both views');
    }
    assert.ok(lab.headBone.getWorldPosition(new THREE.Vector3()).sub(lab.hipsBone.getWorldPosition(new THREE.Vector3())).normalize().y>.7,'punch inverted the torso');
   }
  }
  assert.equal(changes,1);assert.ok(lab.npcHealth<100&&lab.npcHealth>=80);
 });
}
for(const variant of ['jab-a','cross-b','compact-b','jab-b','cross-a','cross-d','body-cross-a','body-cross-b','overhand-a','overhand-b','hook-a','hook-b','hook-c']){
 test(`authored ${variant} has a physical contact at boxing distance`,()=>{
  setupDuel(lab,.9);const kind=variant.startsWith('hook')?'hook-counter':'punch';strike(variant,kind);run(.9);
  assert.ok(lab.npcHealth<100,`${variant} did not reach a target at 0.9 m`);
 });
}
test('a remote target, even acquired by guard lock, cannot receive fallback damage',()=>{
 setupDuel(lab,3.0);strike();run(1);assert.equal(lab.npcHealth,100);
});
test('a real wall between the shoulder and contact blocks melee damage',()=>{
 setupDuel(lab,1.05);const wall=new THREE.Mesh(new THREE.BoxGeometry(2,2,.05),new THREE.MeshBasicMaterial());
 wall.position.set(lab.avatarAnchor.position.x,1,lab.avatarAnchor.position.z+.52);wall.updateMatrixWorld(true);lab.environmentMeshes.push(wall);
 strike();run(.8);lab.environmentMeshes.pop();wall.geometry.dispose();wall.material.dispose();assert.equal(lab.npcHealth,100);
});
test('a target evading after commitment is missed without rotating the punch to chase it',()=>{
 setupDuel(lab,1.05);const attack=strike();while(attack.elapsed/attack.duration<.24)stepLab(lab);
 lab.idleNpcAnchor.position.x+=1.5;lab.syncNpcPlayerBlocker(true);run(.8);assert.equal(lab.npcHealth,100);
});
test('incoming hit cancels punch, buffered follow-up, dodge and lunge immediately',()=>{
 setupDuel(lab);const attack=strike();run(.09);lab.requestNormalCombatPunch();
 lab.receivePlayerMeleeHit('punch',new THREE.Vector3(0,0,-1),8,'head');
 assert.equal(lab.combatAttack,null);assert.equal(lab.combatBufferedPunchSeconds,0);assert.equal(lab.combatDodge,null);assert.equal(lab.player.combatDriveTimer,0);
 lab.commitPlayerSweepImpact(attack,{direction:new THREE.Vector3(0,0,1),point:new THREE.Vector3(),distance:.9,fistSpeed:5,zone:'head',fraction:.4});
 run(1);assert.equal(lab.npcHealth,100);assert.equal(lab.health,92);
});
test('zero-damage integration events never interrupt a live attack',()=>{
 setupDuel(lab);const attack=strike();lab.receivePlayerMeleeHit('punch',new THREE.Vector3(0,0,-1),0,'head');assert.equal(lab.combatAttack,attack);
});
test('a buffered follow-up starts during recoil once and uses a fresh sweep',()=>{
 setupDuel(lab,.9);const first=strike();run(.20);lab.requestNormalCombatPunch();let next;
 for(let i=0;i<60;i++){stepLab(lab);if(lab.combatAttack&&lab.combatAttack!==first){next=lab.combatAttack;break;}}
 assert.ok(next);assert.notEqual(next.strikingSide,first.strikingSide);assert.equal(next.impactApplied,false);assert.equal(lab.combatBufferedPunchSeconds,0);
 run(1.1);assert.equal(lab.combatAttack,null);
 assert.ok(first.impactApplied && next.impactApplied, `${next.animation} missed the reacting opponent (HP ${lab.npcHealth})`);
});
test('taking a body shot selects a body reaction and a head shot never selects a groin reaction',()=>{
 setupDuel(lab);lab.receiveNpcMeleeHit('punch',new THREE.Vector3(0,0,1),5,'body');assert.equal(lab.npcHitReaction,'hit-body');
 run(.1);lab.receiveNpcMeleeHit('punch',new THREE.Vector3(.3,0,1),5,'head');assert.ok(lab.npcHitReaction.startsWith('hit-head'));
});
test('NPC uses the same evaluated strike phase and immediate physical contact rule',()=>{
 setupDuel(lab,.9);lab.npcCombatEnabled=true;lab.npcAttackCooldown=100;lab.startNpcAttack('punch',.9);lab.npcComboTargetLength=1;
 const attack=lab.npcAttack;assert.ok(attack);run(.8);assert.ok(lab.health<100);assert.ok(attack.impactApplied);
});
test('interrupted NPC cannot commit a contact already collected in this frame',()=>{
 setupDuel(lab,.9);lab.npcCombatEnabled=true;lab.startNpcAttack('punch',.9);const attack=lab.npcAttack;
 lab.receiveNpcMeleeHit('punch',new THREE.Vector3(0,0,1),8,'head');assert.equal(lab.npcAttack,null);
 lab.commitNpcSweepImpact(attack,{direction:new THREE.Vector3(0,0,-1),point:new THREE.Vector3(),distance:.9,fistSpeed:5,zone:'head',fraction:.6});assert.equal(lab.health,100);
});
test('blur invalidates an attack and cannot replay its buffered click on focus',()=>{
 setupDuel(lab);strike();run(.1);lab.requestNormalCombatPunch();lab.onCombatWindowBlur();run(.7);assert.equal(lab.npcHealth,100);assert.equal(lab.combatAttack,null);
});
function momentum(ragdoll){const sum=new THREE.Vector3();for(const part of ragdoll.bodies.values()){const v=part.body.linvel();sum.add(new THREE.Vector3(v.x,v.y,v.z).multiplyScalar(part.body.mass()));}return sum;}
test('ragdoll melee impulse adds physical momentum once and preserves existing inertia',()=>{
 setupDuel(lab);run(.1);lab.startNpcRagdoll('punch',new THREE.Vector3(0,0,1),12,'head');const ragdoll=lab.npcRagdoll;assert.ok(ragdoll);
 const before=momentum(ragdoll);ragdoll.applyMeleeImpact(new THREE.Vector3(1,0,0),1,'body',lab.combatNpcChestPoint);const change=momentum(ragdoll).sub(before);
 assert.ok(Math.abs(change.x-25)<.02);assert.ok(Math.abs(change.y)<.02&&Math.abs(change.z)<.02);
 lab.npcGroundKickRecoveryDelay=100;run(2);
 for(const part of ragdoll.bodies.values()){const p=part.body.translation();assert.ok(Number.isFinite(p.x+p.y+p.z));assert.ok(Math.hypot(...Object.values(part.body.linvel()))<20);}
});
test('ground kick wakes a resting articulated body with one downward contact impulse',()=>{
 setupDuel(lab);lab.startNpcRagdoll('punch',new THREE.Vector3(0,0,1),12,'body');lab.npcGroundKickRecoveryDelay=100;run(2.5);
 const r=lab.npcRagdoll,before=momentum(r);r.applyGroundKickImpact(new THREE.Vector3(0,0,1),1,false,lab.groundKickTargetPoint);const change=momentum(r).sub(before);
 assert.ok(change.y<0);assert.ok(Math.abs(change.length()-30)<.02);assert.equal(r.isSettled,false);
});
test('actual ground-kick trajectory keeps finite limbs, limits yaw and can be interrupted without damage',()=>{
 setupDuel(lab);lab.startNpcRagdoll('punch',new THREE.Vector3(0,0,1),12,'body');lab.npcGroundKickRecoveryDelay=100;run(2.4);
 const target=new THREE.Vector3();lab.resolveGroundKickTarget(target);lab.player.teleport({x:target.x,y:.865,z:target.z-.7});lab.bodyYaw=0;lab.updateAvatarTransform(0,true);
 assert.equal(lab.tryStartGroundKick(),true);const kick=lab.groundKick;const health=lab.npcHealth;
 run(.12);lab.receivePlayerMeleeHit('punch',new THREE.Vector3(0,0,-1),8,'body');assert.equal(lab.groundKick,null);run(.8);assert.equal(lab.npcHealth,health);
 assert.ok(Math.abs(kick.targetYaw-kick.startYaw)<=22*Math.PI/180+.001);
});
for(const kind of ['stomp','get-up-kick'])for(const fps of [30,60,120])for(const side of ['left','right'])test(`completed ${side} ${kind==='stomp'?'downed-body kick':kind} at ${fps} fps contacts once and returns control`,()=>{
 setupDuel(lab,1.05,side==='left'?'first-person':'third-person');lab.lastGroundKickSide=side==='left'?'right':'left';lab.startNpcRagdoll('punch',new THREE.Vector3(0,0,1),12,'body');lab.npcGroundKickRecoveryDelay=100;run(2.8);
 if(kind==='get-up-kick'){lab.startNpcGroundRecovery();assert.ok(lab.npcRecovery);run(.28);}
 const target=new THREE.Vector3();lab.resolveGroundKickTarget(target);
 lab.player.teleport({x:target.x,y:.865,z:target.z-.65});lab.player.lookCamera.rotation.set(0,Math.PI,0);lab.player.continuousAimYaw=Math.PI;lab.bodyYaw=0;lab.updateAvatarTransform(0,true);
 const expectedKind=kind==='get-up-kick'||target.y-lab.avatarAnchor.position.y>=.68?'get-up-kick':'stomp';
 assert.equal(lab.tryStartGroundKick(),true);const kick=lab.groundKick,health=lab.npcHealth;assert.equal(kick.kind,expectedKind);
 let damageEvents=0,lastHealth=health,maxYaw=0,minFoot=99,minData=null;
 for(let i=0;i<fps*1.25;i++){stepLab(lab,1/fps);if(lastHealth!==lab.npcHealth){damageEvents++;lastHealth=lab.npcHealth;}if(lab.groundKick)maxYaw=Math.max(maxYaw,Math.abs(lab.bodyYaw-kick.startYaw));
  if(lab.groundKick && kick.elapsed/kick.duration>.32 && kick.elapsed/kick.duration<.55){
   const foot=(side==='left'?lab.leftFootBone:lab.rightFootBone).getWorldPosition(new THREE.Vector3()),point=new THREE.Vector3();lab.resolveGroundKickTarget(point);const d=foot.distanceTo(point);if(d<minFoot){minFoot=d;minData={phase:kick.elapsed/kick.duration,foot:foot.toArray(),point:point.toArray(),aim:kick.targetPoint.toArray()};}
  }
  for(const bone of [lab.leftUpperLegBone,lab.leftLowerLegBone,lab.rightUpperLegBone,lab.rightLowerLegBone])assert.ok([...bone.quaternion].every(Number.isFinite));
  const pelvis=lab.hipsBone.getWorldPosition(new THREE.Vector3()).sub(lab.avatarAnchor.position);
  assert.ok(Math.hypot(pelvis.x,pelvis.z)<.32,'pelvis offset accumulated between frames');assert.ok(pelvis.y>.4&&pelvis.y<1.4);
 }
 assert.equal(damageEvents,1,JSON.stringify({minFoot,minData}));assert.ok(kick.impactApplied);assert.equal(lab.groundKick,null);assert.ok(maxYaw<=22*Math.PI/180+.001);assert.ok(lab.player.isLocked);
 if(kind==='get-up-kick')assert.ok(lab.npcRagdoll);
});

for (const fps of [30,60,120]) test(`a complete kick keeps an upright torso and untwisted knees at ${fps} fps`,()=>{
 setupDuel(lab);lab.startNpcRagdoll('punch',new THREE.Vector3(0,0,1),12,'body');lab.npcGroundKickRecoveryDelay=100;run(2.8);
 const target=new THREE.Vector3();lab.resolveGroundKickTarget(target);lab.player.teleport({x:target.x,y:.865,z:target.z-.65});lab.bodyYaw=0;lab.updateAvatarTransform(0,true);
 assert.equal(lab.tryStartGroundKick(),true);const kick=lab.groundKick;
 const upper=kick.side==='left'?lab.leftUpperLegBone:lab.rightUpperLegBone,lower=kick.side==='left'?lab.leftLowerLegBone:lab.rightLowerLegBone;
 let previous=upper.quaternion.clone();
 for(let i=0;i<fps;i++){
  stepLab(lab,1/fps);
  const up=lab.headBone.getWorldPosition(new THREE.Vector3()).sub(lab.hipsBone.getWorldPosition(new THREE.Vector3())).normalize();
  assert.ok(up.y>.85,`torso tipped: ${up.y}`);
  if(lab.groundKick&&kick.elapsed>.13&&kick.elapsed<kick.duration*.82){
   const knee=lower.getWorldPosition(new THREE.Vector3()).sub(upper.getWorldPosition(new THREE.Vector3()));
   const lateral=knee.x*Math.cos(kick.targetYaw)-knee.z*Math.sin(kick.targetYaw);
   assert.ok(Math.abs(lateral)<.13,`knee twisted sideways: ${JSON.stringify({lateral,phase:kick.elapsed/kick.duration,side:kick.side,kind:kick.kind,knee:knee.toArray(),target:kick.targetPoint.toArray(),footStart:kick.footStart.toArray(),yaw:kick.targetYaw})}`);
  }
  assert.ok(upper.quaternion.angleTo(previous)<1.2,'leg snapped more than 68 degrees in one frame');previous.copy(upper.quaternion);
 }
});
test('held attack starts a combination, release cancels automatic follow-ups, re-press remains responsive',()=>{
 setupDuel(lab,.9);const canvas=lab.host.canvas;
 lab.onCombatMouseDown({button:0,target:canvas,preventDefault(){}});const first=lab.combatAttack;assert.ok(first);
 let next;
 for(let i=0;i<90;i++){stepLab(lab);if(lab.combatAttack&&lab.combatAttack!==first){next=lab.combatAttack;break;}}
 assert.ok(next,'holding never chained');assert.notEqual(next.strikingSide,first.strikingSide);
 run(.05);lab.onCombatMouseUp({button:0});run(1.2);assert.equal(lab.combatAttack,null);assert.equal(lab.combatBufferedPunchSeconds,0);
 setupDuel(lab,.9);lab.onCombatMouseDown({button:0,target:canvas,preventDefault(){}});assert.ok(lab.combatAttack);lab.onCombatMouseUp({button:0});
});
test('holding an attack cannot resume automatically after being interrupted',()=>{
 setupDuel(lab,.9);lab.onCombatMouseDown({button:0,target:lab.host.canvas,preventDefault(){}});run(.1);
 lab.receivePlayerMeleeHit('punch',new THREE.Vector3(0,0,-1),6,'body');run(1.2);
 assert.equal(lab.combatAttack,null);assert.equal(lab.npcHealth,100);assert.equal(lab.combatBufferedPunchSeconds,0);
});
test('confirmed contact compresses the striking arm while misses retain their full motion',()=>{
 setupDuel(lab,.9);const attack=strike();let compressed=false;
 for(let i=0;i<70;i++){stepLab(lab);if(attack.impactApplied&&attack.compressionSeconds>0){compressed=true;assert.ok(attack.contactPoint);assert.equal(lab.player.combatDriveTimer,0);}}
 assert.ok(compressed);
 setupDuel(lab,3);const miss=strike();run(.8);assert.equal(miss.impactApplied,false);assert.equal(miss.contactPoint,undefined);assert.equal(miss.compressionSeconds,0);
});
