import test,{after}from 'node:test';
import assert from 'node:assert/strict';
import {build}from 'esbuild';
import {createLab,THREE}from './support/headless-character.mjs';
await build({entryPoints:['src/apartment/CorridorReaction.ts','src/story/CorridorProgress.ts'],outbase:'.',outdir:'.character-test-dist/corridor',bundle:true,platform:'node',format:'esm',packages:'external'});
const{CorridorReaction}=await import('../../.character-test-dist/corridor/src/apartment/CorridorReaction.js');
const{CorridorStory,corridorLampTime}=await import('../../.character-test-dist/corridor/src/story/CorridorProgress.js');
const lab=await createLab({useWardrobe:true});lab.setInteractionPartner(null);after(()=>lab.dispose());
const doorway=new THREE.Vector3(-30,0,-8),position=new THREE.Vector3(-9.9,.865,-8),camera=lab.host.renderCamera;
function story(){const s=new CorridorStory();s.activate();for(let i=0;i<=202;i++)s.observe({x:-30+i*.1,y:.865,z:-8},doorway,true,Math.PI/2);assert.equal(s.state.triggered,true);return s;}
function prepare(){lab.player.teleport(position);lab.player.setLookQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-Math.PI/2));lab.getArrivalPOV(camera);lab.setHeldItem('torch');}
test('turns the selected dressed character root and head, frames the actual body, then blends to its eyes while lamps continue',()=>{
  prepare();const s=story(),reaction=new CorridorReaction(lab.scene,s,lab,lab.player,camera,doorway),original=lab.character;
  assert.ok(original.userData.wardrobeProfile);let startYaw,turnedYaw,headStart,headTurned,previous,maximumStep=0;
  let framed=0;for(let i=0;i<620;i++){
    const wasModal=s.modal;s.update(1/60,true);if(wasModal)reaction.update(false);
    if(wasModal&&lab.computerPose){
      const grip={position:new THREE.Vector3(),quaternion:new THREE.Quaternion()};
      assert.ok(lab.getHeldItemFrame(grip),'the cinematic must expose the animated grip');
      const wrist=lab.rightHandBone.getWorldPosition(new THREE.Vector3());
      assert.ok(wrist.distanceTo(grip.position)<.15,`torch floating away from the hand at ${i}`);
    }
    if(i===5){startYaw=lab.avatarAnchor.rotation.y;headStart=lab.headBone.getWorldQuaternion(new THREE.Quaternion());}
    if(i===210){turnedYaw=lab.avatarAnchor.rotation.y;headTurned=lab.headBone.getWorldQuaternion(new THREE.Quaternion());}
    if(i>60&&s.state.elapsed<corridorLampTime(s.firstLamp,s.firstLamp)){camera.updateMatrixWorld(true);for(const p of [lab.headBone.getWorldPosition(new THREE.Vector3()),lab.leftFootBone.getWorldPosition(new THREE.Vector3()),lab.rightFootBone.getWorldPosition(new THREE.Vector3())]){const ndc=p.project(camera);assert.ok(Math.abs(ndc.x)<1&&Math.abs(ndc.y)<1,`body outside frame ${i}: ${ndc.toArray()}`);framed++;}}
    if(previous&&wasModal)maximumStep=Math.max(maximumStep,camera.position.distanceTo(previous));previous=camera.position.clone();
  }
  assert.ok(Math.abs(turnedYaw-startYaw)>2.2);assert.ok(headStart.angleTo(headTurned)>2.1);assert.equal(lab.character,original);assert.ok(framed>200);assert.ok(maximumStep<.22,`camera step ${maximumStep}`);
  assert.equal(s.state.returned,true);assert.equal(lab.cameraMode,'first-person');assert.equal(lab.computerPose,undefined);assert.ok(s.litCount>6&&s.litCount<42);assert.ok(lab.player.position.distanceTo(position)<.15);reaction.dispose();
});
test('resumes a saved reaction at its elapsed pose and never resets the wave or repeats the trigger',()=>{
  prepare();const first=story();for(let i=0;i<190;i++)first.update(1/60,true);const snapshot=first.snapshot(),restored=new CorridorStory(snapshot),reaction=new CorridorReaction(lab.scene,restored,lab,lab.player,camera,doorway);
  assert.equal(restored.observe(position,doorway,true,0),false);reaction.update(true);assert.ok(Math.abs(lab.avatarAnchor.rotation.y-(snapshot.reactionYaw-Math.PI))<.2);
  const clock=restored.snapshot();restored.update(.05,false);assert.deepEqual(restored.snapshot(),clock);
  for(let i=0;i<400;i++){const modal=restored.modal;restored.update(1/60,true);if(modal)reaction.update(true);}
  assert.equal(restored.state.returned,true);assert.ok(restored.state.elapsed>snapshot.elapsed);assert.equal(lab.cameraMode,'first-person');assert.equal(lab.headMaskWarmup.value,0);reaction.dispose();
});
