import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createLab, setupDuel, stepLab, THREE } from './support/headless-character.mjs';
import { ClinchAttackVariation } from '../../.character-test-dist/character/CombatHeadbutt.js';

let lab;
before(async () => { lab = await createLab(); });
after(() => lab?.dispose());
const run = (seconds, fps = 60) => { for (let i = 0; i < Math.ceil(seconds * fps); i++) stepLab(lab, 1 / fps); };
function duel(view = 'third-person', distance = .71) {
  lab.player.input.clear(); setupDuel(lab, distance, view);
  for (const corpse of lab.corpses) { corpse.ragdoll.dispose(); lab.scene.remove(corpse.root); }
  lab.corpses.length = 0;
  lab.playerClinchVariation.reset(); lab.npcClinchVariation.reset();
  lab.idleNpcAnchor.position.set(-14, 0, -12); lab.idleNpcAnchor.rotation.y = Math.PI;
  lab.idleNpcAnchor.updateMatrixWorld(true); lab.syncNpcPlayerBlocker(true);
  lab.player.teleport({ x: -14, y: .865, z: -12 - distance }); lab.updateAvatarTransform(0, true);
  lab.npcAttackCooldown = 100;
}
function headbutt(actor) {
  if (actor === 'player') lab.startCombatAttackLayer('punch', 'headbutt', false, 'close', .71);
  else {
    lab.npcCombatEnabled = true;
    const choose = lab.chooseNpcCombatAttackVariant;
    try { lab.chooseNpcCombatAttackVariant = () => 'headbutt'; lab.startNpcAttack('punch', .71); }
    finally { lab.chooseNpcCombatAttackVariant = choose; }
    lab.npcComboTargetLength = 1;
  }
  const attack = actor === 'player' ? lab.combatAttack : lab.npcAttack;
  assert.equal(attack?.animation, 'headbutt'); return attack;
}
const health = actor => actor === 'player' ? lab.npcHealth : lab.health;

for (const actor of ['player', 'npc']) for (const view of ['first-person', 'third-person']) for (const fps of [30, 60, 120]) {
  test(`${actor} forehead makes one physical head contact in ${view} at ${fps} fps`, () => {
    duel(view); assert.ok(lab.headbuttTargetAligned(actor === 'npc'));
    const attack = headbutt(actor), anchor = actor === 'player' ? lab.avatarAnchor : lab.idleNpcAnchor;
    const hips = actor === 'player' ? lab.hipsBone : lab.idleNpcHipsBone;
    const head = actor === 'player' ? lab.headBone : lab.idleNpcHeadBone;
    const feet = actor === 'player' ? [lab.leftFootBone, lab.rightFootBone] : [lab.idleNpcLeftFootBone, lab.idleNpcRightFootBone];
    const initial = anchor.position.clone(); let hp = 100, events = 0;
    let previous = head.getWorldPosition(new THREE.Vector3());
    for (let i = 0; i < Math.ceil(.75 * fps); i++) {
      stepLab(lab, 1 / fps);
      const next = head.getWorldPosition(new THREE.Vector3());
      assert.ok(next.distanceTo(previous) < 7 / fps + .015, 'head teleported between animation samples'); previous = next;
      assert.ok(next.clone().sub(hips.getWorldPosition(new THREE.Vector3())).normalize().y > .70, 'torso inverted');
      for (const foot of feet) {
        const p = foot.getWorldPosition(new THREE.Vector3());
        assert.ok(Number.isFinite(p.x + p.y + p.z)); assert.ok(p.y > -.03 && p.y < .28, `foot left its support: ${p.y}`);
      }
      if (health(actor) !== hp) {
        events++; hp = health(actor); assert.ok(attack.impactApplied);
        const phase = attack.elapsed / attack.duration;
        assert.ok(phase >= attack.contactStartFraction && phase <= attack.contactEndFraction + 1 / fps);
        const tip = new THREE.Vector3(); lab.sampleCombatForehead(head, tip);
        assert.ok(attack.contactPoint.distanceTo(tip) < .035, 'damage point came from a fist or a timed fallback');
        const hand = actor === 'player' ? lab.leftHandBone : lab.idleNpcLeftHandBone;
        assert.ok(attack.contactPoint.distanceTo(hand.getWorldPosition(new THREE.Vector3())) > .15, 'head attack reused hand contact');
      }
      if (actor === 'player' && lab.combatAttack) {
        const phase = attack.elapsed / attack.duration;
        if (phase >= attack.contactStartFraction && phase <= attack.contactEndFraction) {
          for (const side of ['Left', 'Right']) assert.ok(lab[side.toLowerCase() + 'UpperArmBone'].quaternion
            .angleTo(lab['firstPerson' + side + 'UpperArmBone'].quaternion) < 1e-6);
        }
      }
    }
    assert.equal(events, 1); assert.ok(hp >= 85 && hp <= 90);
    assert.ok(anchor.position.distanceTo(initial) < .08, 'headbutt introduced a straight capsule lunge');
  });
}

test('clinch variation stays rare, has intervening pushes and an eight-second cooldown', () => {
  for (let seed = 0; seed < 24; seed++) {
    const variation = new ClinchAttackVariation(); let last = -Infinity, pushes = 0, heads = 0;
    for (let i = 0; i < 240; i++) {
      const now = i * .55;
      if (variation.chooseHeadbutt(now, .71)) {
        assert.ok(pushes >= 7); assert.ok(now - last >= 8); last = now; pushes = 0; heads++;
      } else pushes++;
    }
    assert.ok(heads >= 10 && heads <= 17, `${heads} headbutts in 240 close actions`);
    variation.reset(); assert.equal(variation.chooseHeadbutt(500, .71), false);
  }
});
for (const actor of ['player', 'npc']) test(`${actor} actual close selector mostly pushes and rejects a turned or distant opponent`, () => {
  duel(); const npc = actor === 'npc';
  const policy = npc ? lab.npcClinchVariation : lab.playerClinchVariation;
  const choose = npc ? lab.chooseNpcCombatAttackVariant.bind(lab) : lab.chooseCombatAttackVariant.bind(lab);
  const choices = [];
  for (let i = 0; i < 12; i++) choices.push(choose('punch', 'close', .71));
  assert.equal(choices.filter(c => c === 'headbutt').length, 1);
  assert.ok(choices.filter(c => c.startsWith('shove-')).length >= 11);
  policy.reset();
  const anchor = npc ? lab.idleNpcAnchor : lab.avatarAnchor;
  anchor.rotation.y += Math.PI; anchor.updateMatrixWorld(true);
  assert.equal(lab.headbuttTargetAligned(npc), false);
  for (let i = 0; i < 20; i++) assert.ok(choose('punch', 'close', .71).startsWith('shove-'));
  for (const distance of [.9, 1.4, 2.5]) assert.notEqual(choose('punch', 'medium', distance), 'headbutt');
});

for (const actor of ['player', 'npc']) {
  test(`${actor} headbutt misses a retreating target without homing or fallback damage`, () => {
    duel(); const attack = headbutt(actor); run(.08);
    if (actor === 'player') { lab.idleNpcAnchor.position.x += 1.5; lab.syncNpcPlayerBlocker(true); }
    else { lab.player.teleport({ x: -15.5, y: .865, z: -12.71 }); lab.updateAvatarTransform(0, true); }
    run(.65); assert.equal(attack.impactApplied, false); assert.equal(health(actor), 100);
  });
  test(`${actor} headbutt is interrupted immediately with no later damage`, () => {
    duel(); const attack = headbutt(actor); run(.07);
    if (actor === 'player') lab.receivePlayerMeleeHit('punch', new THREE.Vector3(0, 0, -1), 6, 'body');
    else lab.receiveNpcMeleeHit('punch', new THREE.Vector3(0, 0, 1), 6, 'body');
    run(.7); assert.equal(attack.impactApplied, false); assert.equal(health(actor), 100);
    assert.equal(actor === 'player' ? lab.combatAttack : lab.npcAttack, null);
  });
  test(`${actor} forehead sweep respects a wall at close range`, () => {
    duel(); const attack = headbutt(actor);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(2, 2, .04), new THREE.MeshBasicMaterial());
    wall.position.set(-14, 1, -12.35); wall.updateMatrixWorld(true); lab.environmentMeshes.push(wall);
    try { run(.7); assert.equal(attack.impactApplied, false); assert.equal(health(actor), 100); }
    finally { lab.environmentMeshes.pop(); wall.geometry.dispose(); wall.material.dispose(); }
  });
}
test('headbutt keeps normal strength on double click and cannot start without guard', () => {
  duel(); const attack = headbutt('player'); lab.confirmHeavyDoubleClick();
  assert.equal(attack.kind, 'punch'); assert.equal(attack.animation, 'headbutt');
  lab.resetCombatState(true); lab.combatPointerHeld = false; lab.combatLatchSeconds = 0;
  lab.requestNormalCombatPunch(); assert.equal(lab.combatAttack, null);
});

for (const fps of [30, 60, 120]) for (const pitch of [-1.25, 0, 1.25]) {
  test(`headbutt keeps a clear 1P eye and physical feet with free-look ${pitch} at ${fps} fps`, () => {
    duel('first-person'); const attack = headbutt('player'); run(.07, fps);
    lab.player.setLookQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, Math.PI, 0, 'YXZ')));
    for (let i = 0; i < Math.ceil(fps * .7); i++) {
      stepLab(lab, 1 / fps);
      for (const [physical, visible] of [[lab.leftFootBone, lab.firstPersonLeftFootBone], [lab.rightFootBone, lab.firstPersonRightFootBone]]) {
        assert.ok(visible.getWorldPosition(new THREE.Vector3()).distanceTo(physical.getWorldPosition(new THREE.Vector3())) < .018);
      }
      for (const chain of [[lab.firstPersonLeftUpperArmBone, lab.firstPersonLeftForearmBone, lab.firstPersonLeftHandBone],
        [lab.firstPersonRightUpperArmBone, lab.firstPersonRightForearmBone, lab.firstPersonRightHandBone]]) {
        for (let j = 0; j < 2; j++) {
          const line = new THREE.Line3(chain[j].getWorldPosition(new THREE.Vector3()), chain[j + 1].getWorldPosition(new THREE.Vector3()));
          assert.ok(line.closestPointToPoint(lab.firstPersonCamera.position, true, new THREE.Vector3())
            .distanceTo(lab.firstPersonCamera.position) > .105, 'headbutt put the eye inside an arm');
        }
      }
    }
    assert.ok(attack.impactApplied, 'free-look removed the committed head contact');
  });
}

function knockOut(actor, zone, side = actor === 'player' ? .08 : -.08) {
  duel('third-person', 3);
  if (actor === 'player') {
    lab.player.teleport({ x: -14, y: .865, z: -12 }); lab.updateAvatarTransform(0, true);
    lab.idleNpcAnchor.position.set(-14, 0, -9); lab.idleNpcAnchor.updateMatrixWorld(true); lab.syncNpcPlayerBlocker(true);
  }
  run(.3);
  const head = actor === 'player' ? lab.headBone : lab.idleNpcHeadBone;
  const hips = actor === 'player' ? lab.hipsBone : lab.idleNpcHipsBone;
  const contact = zone === 'head' ? head.getWorldPosition(new THREE.Vector3())
    : hips.getWorldPosition(new THREE.Vector3()).lerp(head.getWorldPosition(new THREE.Vector3()), .34);
  contact.add(new THREE.Vector3(side, .07, 0));
  const direction = new THREE.Vector3(.25, 0, actor === 'player' ? -1 : 1).normalize();
  if (actor === 'player') { lab.health = 15; lab.receivePlayerMeleeHit('punch', direction, 15, zone, contact); }
  else { lab.npcHealth = 15; lab.receiveNpcMeleeHit('punch', direction, 15, zone, contact); }
  lab.npcGroundKickRecoveryDelay = 100;
  const ragdoll = actor === 'player' ? lab.ragdoll : lab.npcRagdoll;
  assert.ok(ragdoll); return ragdoll;
}
const momentum = r => {
  const sum = new THREE.Vector3();
  for (const part of r.bodies.values()) sum.add(new THREE.Vector3().copy(part.body.linvel()).multiplyScalar(part.body.mass()));
  return sum;
};
for (const actor of ['player', 'npc']) for (const zone of ['head', 'body']) for (const fps of [30, 60, 120]) {
  test(`${actor} ${zone} KO recoils then collapses with finite articulated inertia at ${fps} fps`, () => {
    const r = knockOut(actor, zone), head = r.bodies.get('head').body, core = r.bodies.get('core').body;
    assert.equal(r.activeResponseScale, 0, 'KO kept the conscious recovery-step reflex');
    const rotation = new THREE.Quaternion().copy(head.rotation()); let earlyAngle = 0, maxHeadHeight = head.translation().y;
    for (let i = 0; i < Math.ceil(fps * 2.8); i++) {
      stepLab(lab, 1 / fps);
      if (r.elapsed <= .18) earlyAngle = Math.max(earlyAngle, rotation.angleTo(new THREE.Quaternion().copy(head.rotation())));
      maxHeadHeight = Math.max(maxHeadHeight, head.translation().y);
      for (const part of r.bodies.values()) {
        const b = part.body, p = b.translation(), v = b.linvel(), w = b.angvel(), q = b.rotation();
        assert.ok(Number.isFinite(p.x + p.y + p.z + v.x + v.y + v.z + w.x + w.y + w.z + q.x + q.y + q.z + q.w));
        assert.ok(Math.hypot(v.x, v.y, v.z) < 15);
        if (r.elapsed > 0) assert.ok(Math.hypot(w.x, w.y, w.z) < r.angularSpeedCap + .001);
      }
    }
    assert.ok(earlyAngle > .075 && earlyAngle < 1.3, `early recoil ${earlyAngle} rad`);
    assert.ok(core.translation().y < .4, `KO remained propped upright at ${core.translation().y}`);
    assert.ok(maxHeadHeight < 1.85, 'impact launched the KO vertically');
    const before = momentum(r); r.applyCombatKnockoutContraction(1 / 60);
    assert.ok(momentum(r).distanceTo(before) < 1e-5, 'contraction persisted after the initial KO');
  });
}
for (const zone of ['head', 'body']) test(`${zone} contraction draws forearms toward the body without adding whole-body momentum`, () => {
  const r = knockOut('npc', zone); r.elapsed = .08;
  const core = r.bodies.get('core').body, rotation = new THREE.Quaternion().copy(core.rotation());
  const center = new THREE.Vector3().copy(core.worldCom());
  const arms = ['left-forearm', 'right-forearm'].map(id => r.bodies.get(id).body);
  // Remove relative entry motion to isolate the physical contraction. A
  // fast arm already moving inward may legitimately receive a braking impulse.
  const v = new THREE.Vector3().copy(core.linvel()), spin = new THREE.Vector3().copy(core.angvel());
  for (const b of arms) {
    const carried = v.clone().add(spin.clone().cross(new THREE.Vector3().copy(b.worldCom()).sub(center)));
    b.setLinvel(carried, true);
  }
  const old = arms.map(b => new THREE.Vector3().copy(b.linvel())); const before = momentum(r);
  r.applyCombatKnockoutContraction(1 / 60);
  arms.forEach((b, i) => {
    const toward = new THREE.Vector3(i ? .14 : -.14, zone === 'body' ? .04 : .12, .14).applyQuaternion(rotation)
      .add(center).sub(b.worldCom());
    const change = new THREE.Vector3().copy(b.linvel()).sub(old[i]);
    assert.ok(change.dot(toward) > 0, 'reflex flung the arm away from the ribs');
  });
  assert.ok(momentum(r).distanceTo(before) < .0001, 'arm contraction generated an extra body launch');
});

for (const side of [-.08, .08]) test(`off-center KO at ${side} m turns the face within the neck's articulation`, () => {
  const r = knockOut('npc', 'head', side), limit = r.limits.find(l => l.child.id === 'head');
  let maxTwist = 0;
  for (let i = 0; i < 14; i++) {
    stepLab(lab, 1 / 120);
    const delta = limit.initialRelative.clone().invert().multiply(new THREE.Quaternion().copy(limit.parent.body.rotation()).invert()
      .multiply(new THREE.Quaternion().copy(limit.child.body.rotation()))).normalize();
    maxTwist = Math.max(maxTwist, Math.abs(2 * Math.atan2(delta.y, delta.w)));
  }
  assert.ok(maxTwist > .025, 'neck yaw stayed locked; face could not turn');
  assert.ok(maxTwist < .65, `neck twisted beyond its contact limits: ${maxTwist}`);
});

test('an impact on an already horizontal rig stays passive and cannot lift it back into a standing pose', () => {
  duel('third-person', 3);
  lab.stopNpcCombatGuardLayers(0); lab.idleNpcMixer.stopAllAction();
  lab.playNpcAnimation('stand-up-back', false, 1, true);
  lab.npcCurrentAction.stopFading(); lab.npcCurrentAction.time = 0; lab.idleNpcMixer.update(0);
  lab.idleNpcAnchor.updateMatrixWorld(true); lab.npcMotionHistory.reset();
  lab.startNpcRagdoll('punch', new THREE.Vector3(0, 0, 1), 12, 'body'); lab.npcGroundKickRecoveryDelay = 100;
  const r = lab.npcRagdoll; assert.equal(r.combatKnockoutCurl, 0);
  for (let i = 0; i < 180; i++) {
    stepLab(lab); assert.ok(r.bodies.get('core').body.translation().y < .45, 'grounded impact reanimated the torso');
  }
});
