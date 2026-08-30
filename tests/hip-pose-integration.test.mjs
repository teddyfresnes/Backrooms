import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createLab, setupDuel, stepLab, THREE } from './support/headless-lab.mjs';

let lab;
before(async () => { lab = await createLab(); });
after(() => lab?.dispose());
const run = (frames, dt = 1 / 60) => { for (let i = 0; i < frames; i++) stepLab(lab, dt); };
const chains = () => ['left', 'right'].map(side => ({
  side, upper: lab[side + 'UpperLegBone'], knee: lab[side + 'LowerLegBone'], foot: lab[side + 'FootBone'],
}));
const sample = chain => ({
  hip: chain.upper.getWorldPosition(new THREE.Vector3()),
  knee: chain.knee.getWorldPosition(new THREE.Vector3()),
  foot: chain.foot.getWorldPosition(new THREE.Vector3()),
  rotation: chain.upper.getWorldQuaternion(new THREE.Quaternion()),
});
function axialTwist(old, now) {
  const swing = new THREE.Quaternion().setFromUnitVectors(
    old.knee.clone().sub(old.hip).normalize(), now.knee.clone().sub(now.hip).normalize(),
  );
  return now.rotation.clone().multiply(old.rotation.clone().invert()).multiply(swing.invert())
    .normalize().angleTo(new THREE.Quaternion());
}

for (const fps of [30, 60, 120]) for (const movement of ['idle', 'left', 'right']) {
  test(`real ${movement} strikes retain thigh rotation and foot placement at ${fps} fps`, () => {
    lab.player.input.clear(); setupDuel(lab, 1.05);
    if (movement !== 'idle') { lab.player.input.pressed.add(lab.player.input.bindings[movement]); run(14); }
    const original = lab.applyCombatStrikeAimCorrection;
    let corrections = 0, maxTwist = 0, maxFootError = 0;
    lab.applyCombatStrikeAimCorrection = function () {
      const limbs = chains(), old = limbs.map(sample);
      original.call(this);
      if (!this.combatAttack) return;
      for (let i = 0; i < limbs.length; i++) {
        const now = sample(limbs[i]);
        maxTwist = Math.max(maxTwist, axialTwist(old[i], now));
        maxFootError = Math.max(maxFootError, old[i].foot.distanceTo(now.foot));
        assert.ok(Math.abs(old[i].hip.distanceTo(old[i].knee) - now.hip.distanceTo(now.knee)) < 1e-6);
        assert.ok(Math.abs(old[i].knee.distanceTo(old[i].foot) - now.knee.distanceTo(now.foot)) < 1e-6);
      }
      corrections++;
    };
    try {
      for (const variant of ['jab-a', 'cross-b', 'hook-b']) {
        lab.startCombatAttackLayer(variant.startsWith('hook') ? 'hook-counter' : 'punch', variant, false, 'medium', 1.05);
        run(fps, 1 / fps);
      }
      assert.ok(corrections > fps);
      assert.ok(maxTwist <= 13 * Math.PI / 180, `hip wound up ${maxTwist * 180 / Math.PI} degrees`);
      assert.ok(maxFootError < .10, `foot placement moved ${maxFootError} m`);
    } finally { lab.applyCombatStrikeAimCorrection = original; lab.player.input.clear(); }
  });
}

for (const side of ['left', 'right']) for (const movement of ['idle', 'left', 'right']) {
  test(`${side} ground kick preserves a relaxed support hip after ${movement} movement`, () => {
    lab.player.input.clear(); setupDuel(lab);
    // Keep moving kick trials on the wide flat area, away from pit-edge
    // ragdoll triggers. Those interrupts are verified by separate scenarios.
    lab.idleNpcAnchor.position.set(-14, 0, -12);
    lab.idleNpcAnchor.updateMatrixWorld(true);
    lab.syncNpcPlayerBlocker(true);
    lab.player.teleport({ x: -14, y: .865, z: -13.05 });
    lab.lastGroundKickSide = side === 'left' ? 'right' : 'left';
    lab.startNpcRagdoll('punch', new THREE.Vector3(0, 0, 1), 12, 'body');
    lab.npcGroundKickRecoveryDelay = 100; run(180);
    const point = new THREE.Vector3(); lab.resolveGroundKickTarget(point);
    lab.player.teleport({ x: point.x, y: .865, z: point.z - .65 });
    lab.player.setLookQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0, 'YXZ')));
    lab.bodyYaw = 0; lab.updateAvatarTransform(0, true);
    if (movement !== 'idle') { lab.player.input.pressed.add(lab.player.input.bindings[movement]); run(5); }
    const original = lab.applyGroundKickPose;
    let maxSupportTwist = 0, maxKickTwist = 0, sampled = 0;
    lab.applyGroundKickPose = function () {
      const limbs = chains(), old = limbs.map(sample), active = this.groundKick;
      original.call(this);
      if (!active) return;
      for (let i = 0; i < limbs.length; i++) {
        const now = sample(limbs[i]), twist = axialTwist(old[i], now);
        if (limbs[i].side === side) maxKickTwist = Math.max(maxKickTwist, twist);
        else maxSupportTwist = Math.max(maxSupportTwist, twist);
        assert.ok([...limbs[i].upper.quaternion, ...limbs[i].knee.quaternion].every(Number.isFinite));
      }
      sampled++;
    };
    try {
      assert.ok(lab.tryStartGroundKick());
      run(75);
      assert.ok(sampled > 30, JSON.stringify({ sampled, health: lab.health, ragdoll: !!lab.ragdoll }));
      assert.ok(maxSupportTwist < 13 * Math.PI / 180, `support hip twisted ${maxSupportTwist * 180 / Math.PI}`);
      assert.ok(maxKickTwist < 19 * Math.PI / 180, `kicking hip twisted ${maxKickTwist * 180 / Math.PI}`);
      assert.equal(lab.groundKick, null);
      assert.ok(lab.player.isLocked);
    } finally { lab.applyGroundKickPose = original; lab.player.input.clear(); }
  });
}

test('the first anticipation frame does not snap the thighs into an IK stance', () => {
  lab.player.input.clear(); setupDuel(lab, 1.05);
  const original = lab.applyCombatStrikeAimCorrection;
  let angularChange = 0;
  lab.applyCombatStrikeAimCorrection = function () {
    const before = chains().map(c => c.upper.quaternion.clone());
    original.call(this);
    chains().forEach((c, i) => { angularChange = Math.max(angularChange, c.upper.quaternion.angleTo(before[i])); });
  };
  try {
    lab.startCombatAttackLayer('punch', 'cross-b', false, 'medium', 1.05);
    stepLab(lab, 1 / 60);
    assert.ok(angularChange < 3 * Math.PI / 180, `anticipation snapped thighs by ${angularChange * 180 / Math.PI}`);
  } finally { lab.applyCombatStrikeAimCorrection = original; }
});
