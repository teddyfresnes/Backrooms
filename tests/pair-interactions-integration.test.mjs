import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createLab, stepLab, setupDuel, THREE } from './support/headless-lab.mjs';
const lab=await createLab();
const key=code=>window.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true,cancelable:true}));
const run=(seconds,fps=60)=>{for(let i=0;i<Math.ceil(seconds*fps);i++)stepLab(lab,1/fps);};
function ready(view='third-person',distance=1.05){
  lab.cancelPairInteraction();if(lab.recovery){run(8);}if(lab.ragdoll)lab.respawnPlayer();
  lab.recoveryCameraBlend=-1;setupDuel(lab,distance,view);lab.resetCombatState(true);
  lab.npcCombatEnabled=false;lab.stopNpcCombatGuardLayers(0);
  lab.playNpcAnimation('idle',true,1,true);lab.playAnimation('idle',true,1,false,true);run(.6);
}
afterEach(()=>{lab.cancelPairInteraction();lab.emoteMenu.close();lab.player.input.clear();});
after(()=>lab.dispose());

test('Tab directly exposes only paired invitations when looking at a nearby partner',()=>{
  ready();key('Tab');
  assert.equal(lab.emoteMenu.element.querySelectorAll('[data-pair]').length,4);
  assert.equal(lab.emoteMenu.element.querySelector('[data-emote], [data-slot], [data-action="wheel"], [data-action="collection"]'),null);
  assert.equal(lab.emoteMenu.element.querySelector('[data-pair="high-five"]').disabled,false);
  assert.equal(lab.emoteMenu.element.querySelector('[data-pair="help-up"]').disabled,true);
  lab.emoteMenu.element.querySelector('[data-pair="high-five"]').click();
  assert.ok(lab.pairCoordinator.invitation);assert.equal(lab.pairCoordinator.session,null);
  lab.cancelPairInteraction();lab.player.setLookQuaternion(new THREE.Quaternion());
  assert.equal(lab.requestPairInteraction('high-five','player'),false);
});
test('Tab keeps solo emotes when the nearby person is behind the player',()=>{
  ready();lab.player.setLookQuaternion(new THREE.Quaternion());key('Tab');
  assert.equal(lab.emoteMenu.element.querySelectorAll('[data-pair]').length,0);
  assert.equal(lab.emoteMenu.element.querySelectorAll('[data-slot]').length,8);
});
test('Tab keeps solo emotes when the person is out of reach',()=>{
  ready('third-person',2.4);key('Tab');
  assert.equal(lab.emoteMenu.element.querySelectorAll('[data-pair]').length,0);
  assert.equal(lab.emoteMenu.element.querySelectorAll('[data-slot]').length,8);
});
test('paired menu closes when its partner moves away instead of exposing solo shortcuts',()=>{
  ready();key('Tab');lab.idleNpcAnchor.position.z+=3;stepLab(lab);
  assert.equal(lab.emoteMenu.isOpen,false);assert.equal(lab.pairCoordinator.invitation,null);
});
test('selecting in the paired menu moves the game cursor while keeping aim on the partner',()=>{
  ready();key('Tab');const before=lab.player.getLookQuaternion().clone(),x=lab.emoteMenu.pointerX;
  const event=new MouseEvent('mousemove',{bubbles:true,cancelable:true});
  Object.defineProperties(event,{movementX:{value:120},movementY:{value:20}});document.dispatchEvent(event);
  stepLab(lab);assert.equal(event.defaultPrevented,true);assert.equal(lab.emoteMenu.pointerX,x+120);
  assert.ok(before.angleTo(lab.player.getLookQuaternion())<1e-8);
  assert.equal(lab.emoteMenu.element.querySelector('[data-pair="high-five"]').disabled,false);
});
test('incoming Tab takes priority over an already-open emote overlay',()=>{
  ready();assert.equal(lab.requestPairInteraction('high-five','npc'),true);lab.emoteMenu.open();
  key('Tab');assert.ok(lab.pairCoordinator.session);assert.equal(lab.emoteMenu.isOpen,false);
});
test('an unaccepted incoming invitation disappears after four real seconds, including a stalled frame',()=>{
  ready();lab.requestPairInteraction('fist-bump','npc');assert.equal(lab.pairHud.element.hidden,false);
  stepLab(lab,4.01);assert.equal(lab.pairCoordinator.invitation,null);assert.equal(lab.pairCoordinator.session,null);
  assert.equal(lab.pairHud.element.hidden,true);
});
test('moving away cancels an incoming invitation before its deadline',()=>{
  ready();lab.requestPairInteraction('high-five','npc');
  lab.player.teleport({x:lab.idleNpcAnchor.position.x,y:.865,z:lab.idleNpcAnchor.position.z-3});
  stepLab(lab);assert.equal(lab.pairCoordinator.invitation,null);assert.equal(lab.pairHud.element.hidden,true);
});

for(const kind of ['high-five','fist-bump'])for(const fps of [30,60,120])for(const view of ['third-person','first-person'])
test(`${kind} aligns anatomical contacts and preserves the arm lengths at ${fps} Hz in ${view}`,()=>{
  ready(view);const rigs=[lab.pairPlayerRig,lab.pairNpcRig];
  const lengths=rigs.map(r=>{const a=r.find('rightarm').getWorldPosition(new THREE.Vector3()),b=r.find('rightforearm').getWorldPosition(new THREE.Vector3()),c=r.hand.getWorldPosition(new THREE.Vector3());return[a.distanceTo(b),b.distanceTo(c)];});
  assert.equal(lab.requestPairInteraction(kind,'player'),true);
  let contactFrames=0,maxContact=0,maxViewGap=0;
  for(let i=0;i<Math.ceil(5*fps);i++){
    stepLab(lab,1/fps);const s=lab.pairCoordinator.session;
    if(s?.stage==='playing'&&s.elapsed>=1.145&&s.elapsed<=1.175){
      const shape=kind==='high-five'?'paper':'rock';
      maxContact=Math.max(maxContact,rigs[0].getContactPoint(shape).distanceTo(rigs[1].getContactPoint(shape)));contactFrames++;
      if(contactFrames===1){
        lab.scene.updateMatrixWorld(true);
        for(const rig of rigs){rig.character.traverse(mesh=>{if(mesh.isSkinnedMesh)mesh.skeleton.update();});
          assert.ok(new THREE.Box3().setFromObject(rig.character,true).min.y>-.015,'the skinned feet sank into the actual floor');}
      }
      const world=lab.rightHandBone.getWorldPosition(new THREE.Vector3());
      maxViewGap=Math.max(maxViewGap,world.distanceTo(lab.firstPersonRightHandBone.getWorldPosition(new THREE.Vector3())));
    }
    if(s?.stage==='playing')rigs.forEach((r,n)=>{
      const a=r.find('rightarm').getWorldPosition(new THREE.Vector3()),b=r.find('rightforearm').getWorldPosition(new THREE.Vector3()),c=r.hand.getWorldPosition(new THREE.Vector3());
      assert.ok(Math.abs(a.distanceTo(b)-lengths[n][0])<1e-6,'upper arm stretched');
      assert.ok(Math.abs(b.distanceTo(c)-lengths[n][1])<1e-6,'forearm stretched');
    });
  }
  assert.ok(contactFrames>0);assert.ok(maxContact<.018,`hands miss by ${maxContact} m`);
  assert.ok(maxViewGap<.012,`first-person wrist differs by ${maxViewGap} m`);
  assert.equal(lab.pairCoordinator.session,null);assert.equal(lab.pairHud.element.hidden,true);
  assert.equal(lab.health,100);assert.equal(lab.npcHealth,100);
});

for(const choice of ['rock','paper','scissors'])test(`RPS keeps both choices private, then reveals the real ${choice} fingers together`,()=>{
  ready();lab.requestPairInteraction('rps','player');run(.7);assert.equal(lab.pairCoordinator.session.stage,'choosing');
  const botChoiceBefore=lab.pairCoordinator.hasChosen('npc');assert.ok(botChoiceBefore);
  lab.choosePairHand(choice);assert.equal(lab.pairCoordinator.choose('player','rock'),false);
  let hiddenFrames=0,revealed=false;
  for(let i=0;i<300;i++){
    stepLab(lab);const s=lab.pairCoordinator.session;if(!s)break;
    if(s.stage==='playing'&&s.elapsed>1.8&&s.elapsed<2.12){
      assert.equal(lab.pairCoordinator.visibleChoices(),null);assert.ok(!lab.pairHud.element.textContent.includes('Toi :'));
      const r=lab.pairPlayerRig;assert.ok(r.find('righthandindex1').quaternion.angleTo(r.fingerRest.get(r.find('righthandindex1')))>.8);hiddenFrames++;
    }
    if(s.stage==='playing'&&s.elapsed>2.4&&s.elapsed<2.8){
      assert.equal(lab.pairCoordinator.visibleChoices().player,choice);assert.ok(lab.pairHud.element.textContent.includes(`Toi :`));
      const r=lab.pairPlayerRig,angle=name=>r.find(`righthand${name}1`).quaternion.angleTo(r.fingerRest.get(r.find(`righthand${name}1`)));
      if(choice==='rock'){assert.ok(angle('index')>.8);assert.ok(angle('middle')>.8);}
      else if(choice==='paper'){assert.ok(angle('index')<.15);assert.ok(angle('pinky')<.15);}
      else{assert.ok(angle('index')<.25);assert.ok(angle('middle')<.25);assert.ok(angle('ring')>.8);assert.ok(angle('pinky')>.8);}
      revealed=true;
    }
  }
  assert.ok(hiddenFrames>0);assert.ok(revealed);assert.equal(lab.pairCoordinator.session,null);
});
for(const choice of ['rock','paper','scissors'])for(const fps of [30,120])for(const view of ['first-person','third-person'])
test(`RPS ${choice} keeps both arms outside the torso and blends without wrist snaps at ${fps} Hz in ${view}`,()=>{
  ready(view);
  if(view==='first-person'){
    const p=lab.idleNpcAnchor.position,yaw=1.2;
    lab.player.teleport({x:p.x-Math.sin(yaw)*1.05,y:.865,z:p.z-Math.cos(yaw)*1.05});
    const eye=lab.pairActorPosition('player').add(new THREE.Vector3(0,1.5,0));
    lab.player.setLookQuaternion(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(eye,p.clone().add(new THREE.Vector3(0,1.25,0)),new THREE.Vector3(0,1,0))));run(.6);
  }
  const rigs=[lab.pairPlayerRig,lab.pairNpcRig],lengths=rigs.map(r=>r.armLength),previous=[];
  assert.equal(lab.requestPairInteraction('rps','player'),true);run(.7);lab.choosePairHand(choice);
  let frames=0,maxSpeed=0,maxAngularSpeed=0;
  for(let i=0;i<Math.ceil(5*fps);i++){
    stepLab(lab,1/fps);const s=lab.pairCoordinator.session;if(s?.stage!=='playing')continue;
    rigs.forEach((r,n)=>{
      const a=r.find('rightarm').getWorldPosition(new THREE.Vector3()),b=r.find('leftarm').getWorldPosition(new THREE.Vector3());
      const center=a.clone().lerp(b,.5),side=a.clone().sub(b);side.y=0;const halfSpan=side.length()/2;side.normalize();
      for(const arm of ['right','left'])for(const suffix of ['forearm','hand']){
        const point=r.find(arm+suffix).getWorldPosition(new THREE.Vector3());
        const clearance=point.sub(center).dot(side)*(arm==='right'?1:-1);
        assert.ok(clearance>halfSpan*.75,`${arm} ${suffix} crossed the torso at ${s.elapsed}s: ${clearance}m`);
      }
      assert.ok(Math.abs(r.armLength-lengths[n])<1e-6,'RPS stretched an arm');
      const wrist=r.hand.getWorldPosition(new THREE.Vector3()),rotation=r.hand.getWorldQuaternion(new THREE.Quaternion());
      if(previous[n]){
        maxSpeed=Math.max(maxSpeed,wrist.distanceTo(previous[n].wrist)*fps);
        maxAngularSpeed=Math.max(maxAngularSpeed,rotation.angleTo(previous[n].rotation)*fps);
      }
      previous[n]={wrist,rotation};
    });
    assert.ok(lab.rightHandBone.getWorldPosition(new THREE.Vector3()).distanceTo(lab.firstPersonRightHandBone.getWorldPosition(new THREE.Vector3()))<.012);
    frames++;
  }
  assert.ok(frames>fps*3);assert.ok(maxSpeed<3,`hand velocity ${maxSpeed}m/s`);
  assert.ok(maxAngularSpeed<10,`wrist snapped at ${maxAngularSpeed}rad/s`);
  assert.equal(lab.pairCoordinator.session,null);
});
test('RPS without a player choice exits cleanly after four seconds',()=>{
  ready();lab.requestPairInteraction('rps','npc');key('Tab');run(4.1);
  assert.equal(lab.pairCoordinator.session,null);assert.ok(!lab.player.getDebugState().incapacitated);
});
test('the locked-pointer cursor can choose RPS without leaking a combat click',()=>{
  ready();lab.requestPairInteraction('rps','npc');key('Tab');
  const button=lab.pairHud.element.querySelector('[data-pair-choice="paper"]');
  const previous=document.elementFromPoint;document.elementFromPoint=()=>button;
  try{window.dispatchEvent(new MouseEvent('mousedown',{button:0,bubbles:true,cancelable:true}));}
  finally{document.elementFromPoint=previous;}
  assert.equal(lab.pairCoordinator.session.stage,'aligning');assert.equal(lab.combatAttack,null);
  run(3);assert.equal(lab.pairCoordinator.visibleChoices().player,'paper');
});
test('the bot button approaches, sends an actual invitation, and waits for Tab',()=>{
  ready();lab.root.querySelector('[data-action="bot-interact"]').click();
  for(let i=0;i<600&&!lab.pairCoordinator.invitation;i++)stepLab(lab);
  assert.ok(lab.pairCoordinator.invitation);assert.equal(lab.pairCoordinator.invitation.to,'player');
  assert.equal(lab.pairCoordinator.session,null);key('Tab');assert.ok(lab.pairCoordinator.session);
});
test('moving during a paired gesture restores ordinary movement without leaving a hidden anchor',()=>{
  ready();lab.requestPairInteraction('fist-bump','player');run(1.5);assert.ok(lab.pairCoordinator.session);
  const start=lab.physics.getPosition(new THREE.Vector3());key(lab.settings.controls.right);run(.4);
  assert.equal(lab.pairCoordinator.session,null);assert.ok(lab.physics.getPosition(new THREE.Vector3()).distanceTo(start)>.05);
});

test('a rendered wall between the two actors blocks an invitation',()=>{
  ready();const wall=new THREE.Mesh(new THREE.BoxGeometry(2,2,.12),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  wall.position.copy(lab.avatarAnchor.position).lerp(lab.idleNpcAnchor.position,.5);wall.position.y=1;wall.updateMatrixWorld(true);
  lab.environmentMeshes.push(wall);
  try{assert.ok(lab.getPairUnavailableReason('high-five','player'));assert.equal(lab.requestPairInteraction('high-five','player'),false);
    key('Tab');assert.equal(lab.emoteMenu.element.querySelectorAll('[data-pair]').length,0);}
  finally{lab.environmentMeshes.splice(lab.environmentMeshes.indexOf(wall),1);wall.geometry.dispose();wall.material.dispose();}
});

for(const yaw of [-.9,1.2])test(`world-space hand alignment also works with the pair rotated by ${yaw} radians`,()=>{
  ready();const p=lab.idleNpcAnchor.position;
  lab.player.teleport({x:p.x-Math.sin(yaw)*1.05,y:.865,z:p.z-Math.cos(yaw)*1.05});
  const eye=lab.physics.getFeetPosition(new THREE.Vector3()).add(new THREE.Vector3(0,1.5,0));
  lab.player.setLookQuaternion(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(eye,p.clone().add(new THREE.Vector3(0,1.25,0)),new THREE.Vector3(0,1,0))));
  run(.35);assert.equal(lab.requestPairInteraction('high-five','player'),true);let touched=false;
  for(let i=0;i<300;i++){stepLab(lab);const s=lab.pairCoordinator.session;if(s?.stage==='playing'&&s.elapsed>1.145&&s.elapsed<1.175){assert.ok(lab.pairPlayerRig.getContactPoint().distanceTo(lab.pairNpcRig.getContactPoint())<.02);touched=true;}}
  assert.ok(touched);
});

for(const target of ['player','npc'])for(const fps of [30,120])test(`helping the ${target} starts the real rise only after a stable clasp at ${fps} Hz`,ctx=>{
  ready(target==='npc'&&fps===120?'first-person':'third-person');lab.health=83;lab.npcHealth=67;
  const healthyArmLength={player:lab.pairPlayerRig.armLength,npc:lab.pairNpcRig.armLength};
  const originalRandom=Math.random;let seed=2026+fps+(target==='npc'?600:0);
  Math.random=()=> (seed=(1664525*seed+1013904223)>>>0)/2**32;
  ctx.after(()=>{Math.random=originalRandom;});
  if(target==='player'){
    lab.idleNpcAnchor.position.z+=1;lab.startRagdoll({fatal:false});run(3);
    lab.root.querySelector('[data-action="bot-interact"]').click();
    for(let i=0;i<600&&!lab.pairCoordinator.invitation;i++)stepLab(lab);
    assert.ok(lab.pairCoordinator.invitation);assert.equal(lab.pairCoordinator.invitation.kind,'help-up');key('Tab');
  }else{
    lab.startNpcRagdoll('punch',new THREE.Vector3(0,0,1),0);lab.npcGroundKickRecoveryDelay=100;run(3);
    for(let i=0;i<240&&!lab.npcRagdoll.isRecoveryReady;i++)stepLab(lab);
    assert.ok(lab.npcRagdoll.isRecoveryReady,'the physical fixture never reached its ground posture');
    const pelvis=lab.pairActorPosition('npc'),player=lab.pairActorPosition('player');
    if(Math.hypot(pelvis.x-player.x,pelvis.z-player.z)>1.65){lab.player.teleport({x:pelvis.x,y:.865,z:pelvis.z-1.25});run(.3);}
    const eye=lab.pairActorPosition('player').add(new THREE.Vector3(0,1.5,0)),p=lab.pairActorPosition('npc').add(new THREE.Vector3(0,.2,0));
    lab.player.setLookQuaternion(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(eye,p,new THREE.Vector3(0,1,0))));
    run(.2);key('Tab');
    assert.equal(lab.emoteMenu.element.querySelector('[data-emote], [data-slot], [data-action="wheel"]'),null);
    assert.equal(lab.emoteMenu.element.querySelector('[data-pair="help-up"]').disabled,false,lab.getPairUnavailableReason('help-up','player'));
    assert.equal(lab.emoteMenu.element.querySelector('[data-pair="high-five"]').disabled,true);
    lab.emoteMenu.element.querySelector('[data-pair="help-up"]').click();assert.ok(lab.pairCoordinator.invitation);
  }
  const hp=lab.health,npcHp=lab.npcHealth,eyeY=lab.firstPersonCamera.position.y;let graspedFrames=0,sawPreparation=false,finished=false,lastGrip={},lowestEye=eyeY;
  for(let i=0;i<Math.ceil(18*fps);i++){
    stepLab(lab,1/fps);const s=lab.pairCoordinator.session;
    if(s?.stage==='playing'){
      const recovery=s.to==='player'?lab.recovery:lab.npcRecovery;
      if(recovery?.isWaitingForAssistGrip){assert.equal(recovery.animationTime,0);sawPreparation=true;
        const helper=s.from==='player'?lab.pairPlayerRig:lab.pairNpcRig;
        lastGrip={reachError:lab.pairHelpReachError,hold:lab.pairHelpGripHold,front:lab.pairHelpFrontWeight,
          gap:helper.getContactPoint('clasp').distanceTo(lab.pairDownRig.getContactPoint('clasp')),
          shoulders:[helper.find('rightarm').getWorldPosition(new THREE.Vector3()).toArray(),lab.pairDownRig.find('rightarm').getWorldPosition(new THREE.Vector3()).toArray()],
          arms:[helper.armLength,lab.pairDownRig.armLength],facing:lab.pairDownRig.getFacing().toArray(),
          helper:lab.pairActorPosition(s.from).toArray(),recipient:lab.pairActorPosition(s.to).toArray()};}
      if(recovery?.animationTime>.05){assert.equal(lab.pairHelpGripStarted,true,'the rise started before the hands met');}
      if(recovery?.isPreparedForAssist)assert.ok(Math.abs(lab.pairDownRig.armLength-healthyArmLength[s.to])<1e-5,'the assisted arm retained distorted ragdoll joint offsets');
      if(lab.pairHelpGripStarted&&s.elapsed<recovery.duration-.05){
        lowestEye=Math.min(lowestEye,lab.firstPersonCamera.position.y);
        const helper=s.from==='player'?lab.pairPlayerRig:lab.pairNpcRig;
        const gap=helper.getContactPoint('clasp').distanceTo(lab.pairDownRig.getContactPoint('clasp'));
        const span=helper.find('rightarm').getWorldPosition(new THREE.Vector3()).distanceTo(lab.pairDownRig.find('rightarm').getWorldPosition(new THREE.Vector3()));
        assert.ok(gap<.03,`the actual clasp separated by ${gap} m at ${s.elapsed} s; shoulder span ${span}`);
        for(const side of ['left','right'])assert.ok(helper.find(side+'foot').getWorldPosition(new THREE.Vector3()).y>-.016,'the helper foot passed under the floor');
        graspedFrames++;
      }
    }
    if(graspedFrames&& !lab.pairCoordinator.session){finished=true;break;}
  }
  assert.ok(sawPreparation);assert.ok(graspedFrames>fps,`${lab.pairMessage}: ${JSON.stringify(lastGrip)}`);assert.ok(finished,'assistance never completed');
  assert.equal(lab.ragdoll,undefined);assert.equal(lab.npcRagdoll,undefined);
  assert.equal(lab.recovery,null);assert.equal(lab.npcRecovery,null);
  assert.equal(lab.health,hp,'help incorrectly acted like a respawn');assert.equal(lab.npcHealth,npcHp);
  assert.ok(!lab.player.getDebugState().incapacitated);
  if(target==='npc'&&fps===120)assert.ok(lowestEye<eyeY-.2,'the kneeling helper camera stayed at standing height');
});

test('cancel during the grip preparation releases the get-up hold and never strands the downed actor',()=>{
  ready();lab.idleNpcAnchor.position.z+=1;lab.startRagdoll({fatal:false});run(3);
  lab.requestBotInteraction();for(let i=0;i<600&&!lab.pairCoordinator.invitation;i++)stepLab(lab);key('Tab');
  for(let i=0;i<180&&!lab.recovery;i++)stepLab(lab);
  assert.ok(lab.recovery);assert.equal(lab.recovery.isWaitingForAssistGrip,true);key('Escape');
  assert.equal(lab.pairCoordinator.session,null);assert.equal(lab.recovery.isWaitingForAssistGrip,false);
  run(8);assert.equal(lab.recovery,null);assert.equal(lab.ragdoll,undefined);
});
