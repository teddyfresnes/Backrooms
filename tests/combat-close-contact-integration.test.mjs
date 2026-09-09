import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createLab, setupDuel, stepLab, THREE } from './support/headless-lab.mjs';

let lab;
before(async () => { lab = await createLab(); });
after(() => lab?.dispose());
const run = (seconds, fps = 60) => { for (let i = 0; i < Math.ceil(seconds * fps); i++) stepLab(lab, 1 / fps); };
function duel(distance, view = 'third-person') {
  lab.player.input.clear(); setupDuel(lab, distance, view);
  lab.idleNpcAnchor.position.set(-14, 0, -12); lab.idleNpcAnchor.rotation.y = Math.PI;
  lab.idleNpcAnchor.updateMatrixWorld(true); lab.syncNpcPlayerBlocker(true);
  lab.player.teleport({ x: -14, y: .865, z: -12 - distance }); lab.updateAvatarTransform(0, true);
  lab.npcAttackCooldown = 100;
}

for (const actor of ['player', 'npc']) for (const view of ['first-person', 'third-person']) for (const fps of [30, 60, 120]) {
  test(`${actor} chest-to-chest push creates real space once in ${view} at ${fps} fps`, () => {
    duel(.71, view);
    if (actor === 'player') lab.requestNormalCombatPunch();
    else { lab.npcCombatEnabled = true; lab.startNpcAttack('punch', .71); lab.npcComboTargetLength = 1; }
    const attack = actor === 'player' ? lab.combatAttack : lab.npcAttack;
    assert.ok(attack && attack.animation.startsWith('shove-'), 'close input was silently discarded');
    const source = actor === 'player' ? lab.avatarAnchor : lab.idleNpcAnchor;
    const victim = actor === 'player' ? lab.idleNpcAnchor : lab.avatarAnchor;
    const away = victim.position.clone().sub(source.position).normalize();
    const start = victim.position.clone(); let damageEvents = 0, hp = 100;
    for (let i = 0; i < Math.ceil(.60 * fps); i++) {
      stepLab(lab, 1 / fps);
      const health = actor === 'player' ? lab.npcHealth : lab.health;
      if (health !== hp) {
        damageEvents++; hp = health;
        assert.ok(attack.impactApplied);
        assert.ok(attack.elapsed / attack.duration <= attack.contactEndFraction + 1 / fps);
      }
      const hips = actor === 'player' ? lab.hipsBone : lab.idleNpcHipsBone;
      const head = actor === 'player' ? lab.headBone : lab.idleNpcHeadBone;
      assert.ok(head.getWorldPosition(new THREE.Vector3()).sub(hips.getWorldPosition(new THREE.Vector3())).normalize().y > .72);
      const phase = attack.elapsed / attack.duration;
      if (actor === 'player' && lab.combatAttack && phase >= attack.contactStartFraction && phase <= attack.contactEndFraction) {
        for (const side of ['Left', 'Right']) assert.ok(
          lab[side.toLowerCase() + 'UpperArmBone'].quaternion.angleTo(lab['firstPerson' + side + 'UpperArmBone'].quaternion) < 1e-6);
      }
    }
    assert.equal(damageEvents, 1);
    assert.ok(victim.position.clone().sub(start).dot(away) > .20, `no space: ${victim.position.distanceTo(start)}`);
    assert.ok(hp >= 85, 'a spacing push became a power punch');
  });
}

const variants = ['jab-a', 'cross-b', 'long-a', 'compact-b', 'cross-a', 'jab-b', 'straight-c', 'cross-d',
  'body-cross-a', 'body-cross-b', 'overhand-a', 'overhand-b', 'step-a', 'step-b', 'step-c', 'step-d',
  'power-a', 'power-b', 'hook-a', 'hook-b', 'hook-c'];
for (const actor of ['player', 'npc']) for (const variant of variants) {
  test(`${actor} ${variant} reaches a stationary opponent with its visible fist at 1.1 m`, () => {
    duel(1.1);
    const kind = variant.startsWith('power') ? 'big-punch' : variant.startsWith('hook-') ? 'hook-counter' : 'punch';
    if (actor === 'player') lab.startCombatAttackLayer(kind, variant, false, 'medium', 1.1);
    else {
      lab.npcCombatEnabled = true;
      const choose = lab.chooseNpcCombatAttackVariant;
      try { lab.chooseNpcCombatAttackVariant = () => variant; lab.startNpcAttack(kind, 1.1); }
      finally { lab.chooseNpcCombatAttackVariant = choose; }
      lab.npcComboTargetLength = 1;
    }
    const attack = actor === 'player' ? lab.combatAttack : lab.npcAttack;
    let events = 0, hp = 100;
    for (let i = 0; i < 48; i++) {
      stepLab(lab);
      const health = actor === 'player' ? lab.npcHealth : lab.health;
      if (health !== hp) { events++; hp = health; assert.ok(attack.impactApplied); }
      if (attack.impactApplied) break;
    }
    assert.equal(events, 1, 'visible extension stopped short');
  });
}

test('a shove interrupted in anticipation cannot displace or damage its opponent', () => {
  duel(.71); lab.requestNormalCombatPunch(); run(.06);
  const start = lab.idleNpcAnchor.position.clone();
  lab.receivePlayerMeleeHit('punch', new THREE.Vector3(0, 0, -1), 6, 'body'); run(.7);
  assert.equal(lab.combatAttack, null); assert.equal(lab.npcHealth, 100);
  assert.ok(lab.idleNpcAnchor.position.distanceTo(start) < .001);
});

test('a wall blocks the close push and a double click cannot turn it into a power punch', () => {
  duel(.71); lab.requestNormalCombatPunch(); const attack = lab.combatAttack;
  lab.confirmHeavyDoubleClick(); assert.equal(attack.kind, 'punch');
  const wall = new THREE.Mesh(new THREE.BoxGeometry(2, 2, .04), new THREE.MeshBasicMaterial());
  wall.position.set(-14, 1, -12.35); wall.updateMatrixWorld(true); lab.environmentMeshes.push(wall);
  try { run(.65); assert.equal(attack.impactApplied, false); assert.equal(lab.npcHealth, 100); }
  finally { lab.environmentMeshes.pop(); wall.geometry.dispose(); wall.material.dispose(); }
});

test('bot push adds recoil without erasing existing lateral momentum', () => {
  duel(.71); lab.player.velocity.set(1.5, 0, 0);
  const entry = lab.player.velocity.clone();
  lab.player.applyCombatLunge(new THREE.Vector3(0, 0, -1), 2.6, .23, .48, 'shove');
  assert.ok(Math.abs(lab.player.velocity.x - entry.x) < 1e-8);
  run(.15); assert.ok(lab.player.position.z < -12.71);
});

for (const actor of ['player', 'npc']) test(`${actor} power intent in a clinch still creates space with a push`, () => {
  duel(.71);
  if (actor === 'player') lab.startCombatAttackLayer('big-punch', undefined, false, 'close', .71);
  else { lab.npcCombatEnabled = true; lab.startNpcAttack('big-punch', .71); }
  const attack = actor === 'player' ? lab.combatAttack : lab.npcAttack;
  assert.ok(attack.animation.startsWith('shove-')); assert.equal(attack.kind, 'punch');
});

for (const previousReaction of ['hit-head-medium-b', 'hit-head-light', 'hit-head-medium-a']) for (const fps of [30, 60, 120]) {
  test(`rear-hand follow-up connects through the next reaction after ${previousReaction} at ${fps} fps`, () => {
    duel(.9); lab.lastNpcHitReaction = previousReaction;
    lab.startCombatAttackLayer('punch', 'jab-a', false, 'medium', .9);
    const first = lab.combatAttack; run(.20, fps);
    const choose = lab.chooseCombatAttackVariant; let next;
    try {
      lab.chooseCombatAttackVariant = () => 'cross-b'; lab.requestNormalCombatPunch();
      for (let i = 0; i < fps; i++) {
        stepLab(lab, 1 / fps);
        if (lab.combatAttack && lab.combatAttack !== first) { next = lab.combatAttack; break; }
      }
    } finally { lab.chooseCombatAttackVariant = choose; }
    assert.ok(first.impactApplied && next); run(.8, fps);
    assert.ok(next.impactApplied, `cross lost the ${lab.npcHitReaction} target`);
  });
}

for (const distance of [.71, .92, 1.4]) for (const fps of [30, 60, 120]) {
  test(`enabled bot initiates physical exchanges from ${distance} m at ${fps} fps`, () => {
    duel(distance); lab.npcCombatEnabled = true; lab.npcAttackCooldown = 0;
    let contacts = 0, firstAttack, firstImpact, hp = 100;
    for (let i = 0; i < fps * 2.7; i++) {
      stepLab(lab, 1 / fps);
      if (!firstAttack && lab.npcAttack) firstAttack = lab.npcAttack;
      if (lab.health !== hp) { contacts++; hp = lab.health; firstImpact ??= i / fps; }
      if (lab.ragdoll) break;
    }
    assert.ok(firstAttack); assert.ok(contacts >= 2, `only ${contacts} contacts`);
    assert.ok(firstImpact < 1.3, 'enabled bot played repeated empty actions');
  });
}
