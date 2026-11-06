import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createLab,stepLab} from './support/headless-character.mjs';
import {THREE} from './support/headless-character.mjs';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {RagdollSystem} from '../../.character-test-dist/physics/RagdollSystem.js';
let lab;
before(async()=>{lab=await createLab();lab.setInteractionPartner(null);});
after(()=>lab?.dispose());
const counts=()=>({bodies:lab.physics.world.bodies.len(),colliders:lab.physics.world.colliders.len(),joints:lab.physics.world.impulseJoints.len()});

test('repeated respawns retain four physical corpses and reclaim retired rigs and their cloned materials',()=>{
  let plateau,retiredHandles,retiredRoot,disposedMaterials=0,disposedSkeletonTextures=0;
  for(let cycle=0;cycle<9;cycle++){
    lab.startRagdoll({fatal:true,quietStart:true});stepLab(lab);lab.respawnPlayer();
    assert.ok(lab.corpses.length<=4);
    if(cycle===0){const old=lab.corpses[0];retiredHandles=old.ragdoll.getOwnedBodyHandles();retiredRoot=old.root;
      old.root.traverse(o=>{if(o.isMesh)for(const material of Array.isArray(o.material)?o.material:[o.material])material.addEventListener('dispose',()=>disposedMaterials++);
        if(o.isSkinnedMesh){o.skeleton.computeBoneTexture();o.skeleton.boneTexture.addEventListener('dispose',()=>disposedSkeletonTextures++);}});}
    if(cycle===3)plateau=counts();
    if(cycle>=4){assert.deepEqual(counts(),plateau);assert.equal(retiredRoot.parent,null);for(const handle of retiredHandles){const body=lab.physics.world.getRigidBody(handle);assert.ok(!body||body.handle!==handle||!body.isValid());}}
  }
  assert.equal(lab.corpses.length,4);assert.ok(disposedMaterials>0,'retired materials remained allocated');
  assert.ok(disposedSkeletonTextures>0,'retired skeleton textures remained allocated');
});

const fixture=()=>lab.physics.constructor.create({seed:'RAGDOLL-RESOURCES',spawn:{x:10,y:.865,z:10},colliders:[{id:'ground',kind:'floor',center:{x:0,y:-.1,z:0},halfExtents:{x:20,y:.1,z:20}}]});
const create=(physics,x=0)=>{const root=new THREE.Group(),character=clone(lab.character);root.scale.copy(lab.avatarAnchor.scale);root.position.set(x,2,0);root.add(character);
  const mixer=new THREE.AnimationMixer(character),action=mixer.clipAction(lab.animations.get('falling-idle').clip);action.play();action.time=.25;mixer.update(0);root.updateMatrixWorld(true);
  return RagdollSystem.create(physics,character,{velocity:new THREE.Vector3(0,-2,1),yawRateRadians:.4,activeResponseScale:1});};
const rawCounts=physics=>({bodies:physics.world.bodies.len(),colliders:physics.world.colliders.len(),joints:physics.world.impulseJoints.len()});

test('unlinks owned joints and reclaims every raw allocation across twenty real-FBX fall/get-up cycles',async()=>{
  const physics=await fixture();physics.setPlayerColliderEnabled(false);const initial=rawCounts(physics);
  try{for(let cycle=0;cycle<20;cycle++){
    const ragdoll=create(physics);for(let i=0;i<24;i++)ragdoll.fixedUpdate(1/60);
    assert.ok(physics.world.impulseJoints.len()>initial.joints);
    if(cycle%2)ragdoll.suspendForRecovery();else ragdoll.dispose();
    ragdoll.dispose();assert.deepEqual(rawCounts(physics),initial);
    for(let i=0;i<3;i++)physics.stepDynamics(1/60);
  }}finally{physics.dispose();}
});

test('reclaims one real articulated actor without removing or freezing its shared-world neighbour',async()=>{
  const physics=await fixture();physics.setPlayerColliderEnabled(false);
  const a=create(physics,-4),b=create(physics,4),owned=b.getOwnedBodyHandles(),before=b.getPelvisPosition().y;
  try{
    a.dispose();for(const handle of owned)assert.equal(physics.world.getRigidBody(handle)?.isEnabled(),true);
    for(let i=0;i<60;i++){physics.stepDynamics(1/60);b.passiveUpdate(1/60);}
    const after=b.getPelvisPosition().y;assert.ok(after<before-.5,`neighbour stayed at ${after} from ${before}`);assert.ok(after>-.2,`neighbour crossed the floor: ${after}`);
  }finally{a.dispose();b.dispose();physics.dispose();}
});
