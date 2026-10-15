import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createLab, setupDuel, stepLab, THREE } from './support/headless-character.mjs';

let lab;
before(async () => { lab = await createLab(); });
after(() => lab?.dispose());
function duel(view = 'third-person', distance = .71) {
  lab.player.input.clear(); setupDuel(lab, distance, view);
  for (const c of lab.corpses) { c.ragdoll.dispose(); lab.scene.remove(c.root); } lab.corpses.length = 0;
  lab.idleNpcAnchor.position.set(-14, 0, -12); lab.idleNpcAnchor.rotation.y = Math.PI;
  lab.idleNpcAnchor.updateMatrixWorld(true); lab.syncNpcPlayerBlocker(true);
  lab.player.teleport({ x:-14, y:.865, z:-12-distance }); lab.updateAvatarTransform(0, true);
  lab.npcAttackCooldown = 100;
}
function start(actor, variant) {
  if (actor === 'player') lab.startCombatAttackLayer('punch', variant, false, 'close', .71);
  else {
    lab.npcCombatEnabled = true; const choose = lab.chooseNpcCombatAttackVariant;
    try { lab.chooseNpcCombatAttackVariant = () => variant; lab.startNpcAttack('punch', .71); }
    finally { lab.chooseNpcCombatAttackVariant = choose; }
    lab.npcComboTargetLength = 1;
  }
  return actor === 'player' ? lab.combatAttack : lab.npcAttack;
}
function actorBones(actor) {
  return actor === 'player'
    ? { hips:lab.hipsBone, head:lab.headBone, arms:[lab.leftUpperArmBone, lab.rightUpperArmBone], hands:[lab.leftHandBone, lab.rightHandBone] }
    : { hips:lab.idleNpcHipsBone, head:lab.idleNpcHeadBone, arms:[lab.idleNpcLeftUpperArmBone, lab.idleNpcRightUpperArmBone], hands:[lab.idleNpcLeftHandBone, lab.idleNpcRightHandBone] };
}
const curl = hands => hands.reduce((sum, hand) => {
  hand.traverse(bone => { if (bone.isBone && /hand(?:middle|index|ring|pinky)[123]$/i.test(bone.name)) sum += bone.quaternion.angleTo(new THREE.Quaternion()); });
  return sum;
}, 0);
for (const actor of ['player','npc']) for (const variant of ['shove-a','shove-b']) for (const fps of [30,60,120]) {
  test(`${actor} ${variant} opens both hands, transfers weight and recovers smoothly at ${fps} fps`, () => {
    duel(); const bones = actorBones(actor), initialHip = bones.hips.getWorldPosition(new THREE.Vector3());
    const initialHands = bones.hands.map(b => b.getWorldPosition(new THREE.Vector3()));
    const initialCurl = curl(bones.hands), attack = start(actor, variant);
    let previous = initialHands.map(p => p.clone()), maxTravel = 0, openedCurl = Infinity, events = 0, health = 100, recoveredHands;
    for (let i = 0; i < fps; i++) {
      stepLab(lab, 1 / fps);
      const phase = attack.elapsed / attack.duration;
      const next = bones.hands.map(b => b.getWorldPosition(new THREE.Vector3()));
      next.forEach((p,j) => {
        assert.ok(p.distanceTo(previous[j]) < 8 / fps + .008, `palm snapped ${p.distanceTo(previous[j])} m`);
        maxTravel = Math.max(maxTravel, p.distanceTo(initialHands[j]));
      }); previous = next;
      if (!recoveredHands && (actor === 'player' ? lab.combatAttack : lab.npcAttack) !== attack) recoveredHands = next.map(p => p.clone());
      const hip = bones.hips.getWorldPosition(new THREE.Vector3());
      assert.ok(new THREE.Vector2(hip.x-initialHip.x, hip.z-initialHip.z).length() < .19, 'push dragged the pelvis away from its supports');
      assert.ok(bones.head.getWorldPosition(new THREE.Vector3()).sub(hip).normalize().y > .72, 'push folded the torso');
      if (phase > .30 && phase < .57) openedCurl = Math.min(openedCurl, curl(bones.hands));
      const hp = actor === 'player' ? lab.npcHealth : lab.health;
      if (hp !== health) { events++; health = hp; assert.ok(attack.contactPoint); }
    }
    assert.equal(events, 1); assert.ok(health >= 94, 'space-making push did punch damage');
    assert.ok(maxTravel > .10, 'hands never left the guard');
    assert.ok(openedCurl < initialCurl * .65, `hands stayed clenched: ${openedCurl} / ${initialCurl}`);
    assert.notEqual(actor === 'player' ? lab.combatAttack : lab.npcAttack, attack, 'push failed to finish before the next action');
    assert.ok(recoveredHands, 'push never returned control');
    recoveredHands.forEach((point,j) => assert.ok(point.distanceTo(initialHands[j]) < .16, 'arm stayed extended after recovery'));
  });
}

for (const pitch of [-1.25,0,1.25]) test(`two-palm push keeps a safe 1P eye through free-look ${pitch}`, () => {
  duel('first-person'); const attack = start('player','shove-a');
  for (let i=0;i<9;i++) stepLab(lab,1/120);
  lab.player.setLookQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch,Math.PI,0,'YXZ')));
  for (let i=0;i<120;i++) {
    stepLab(lab,1/120);
    for (const chain of [[lab.firstPersonLeftUpperArmBone,lab.firstPersonLeftForearmBone,lab.firstPersonLeftHandBone],
      [lab.firstPersonRightUpperArmBone,lab.firstPersonRightForearmBone,lab.firstPersonRightHandBone]]) {
      for (let j=0;j<2;j++) assert.ok(new THREE.Line3(chain[j].getWorldPosition(new THREE.Vector3()),chain[j+1].getWorldPosition(new THREE.Vector3()))
        .closestPointToPoint(lab.firstPersonCamera.position,true,new THREE.Vector3()).distanceTo(lab.firstPersonCamera.position) > .105, 'eye entered the pushing arm');
    }
    for (const [physical,visible] of [[lab.leftFootBone,lab.firstPersonLeftFootBone],[lab.rightFootBone,lab.firstPersonRightFootBone]]) {
      assert.ok(physical.getWorldPosition(new THREE.Vector3()).distanceTo(visible.getWorldPosition(new THREE.Vector3())) < .018);
    }
  }
  assert.ok(attack.impactApplied);
});

function momentum(r) {
  const linear = new THREE.Vector3(), angular = new THREE.Vector3(), origin = new THREE.Vector3().copy(r.bodies.get('core').body.worldCom());
  for (const b of r.ownedBodies) {
    const p = new THREE.Vector3().copy(b.linvel()).multiplyScalar(b.mass());
    linear.add(p); angular.add(new THREE.Vector3().copy(b.worldCom()).sub(origin).cross(p));
    const w=b.angvel(), m=b.effectiveAngularInertia();
    angular.add(new THREE.Vector3(m.m11*w.x+m.m12*w.y+m.m13*w.z,m.m21*w.x+m.m22*w.y+m.m23*w.z,m.m31*w.x+m.m32*w.y+m.m33*w.z));
  }
  return {linear,angular};
}
for (const zone of ['head','body']) test(`${zone} wrist contraction flexes the elbow without adding linear or angular launch momentum`, () => {
  duel('third-person',3);
  const point=zone==='head'?lab.idleNpcHeadBone.getWorldPosition(new THREE.Vector3())
    :lab.idleNpcHipsBone.getWorldPosition(new THREE.Vector3()).lerp(lab.idleNpcHeadBone.getWorldPosition(new THREE.Vector3()),.34);
  point.x-=.08; lab.npcHealth=12; lab.receiveNpcMeleeHit('punch',new THREE.Vector3(0,0,1),12,zone,point);
  lab.npcGroundKickRecoveryDelay=100;
  const r=lab.npcRagdoll; r.elapsed=.08;
  const before=momentum(r), rotations=['left-forearm','right-forearm'].map(id=>new THREE.Vector3().copy(r.bodies.get(id).body.angvel()));
  r.applyCombatKnockoutContraction(1/60); const after=momentum(r);
  assert.ok(after.linear.distanceTo(before.linear)<.0001,'wrist reaction generated extra translation');
  assert.ok(after.angular.distanceTo(before.angular)<.0001,'wrist reaction generated whole-body spin');
  assert.ok(['left-forearm','right-forearm'].some((id,j)=>new THREE.Vector3().copy(r.bodies.get(id).body.angvel()).distanceTo(rotations[j])>.01),'no physical elbow flexion');
  r.elapsed=1; const settled=momentum(r); r.applyCombatKnockoutContraction(1/60);
  const released=momentum(r); assert.ok(released.linear.distanceTo(settled.linear)<1e-6 && released.angular.distanceTo(settled.angular)<1e-6,'KO reflex persisted');
});
