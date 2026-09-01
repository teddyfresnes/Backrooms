import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createLab, setupDuel, stepLab, THREE } from './support/headless-lab.mjs';

let lab;
before(async () => { lab = await createLab(); });
after(() => lab?.dispose());
const run = (seconds, dt = 1 / 60) => { for (let t = 0; t < seconds; t += dt) stepLab(lab, dt); };
const body = (distance, side, view, resting = true) => {
  lab.player.input.clear(); setupDuel(lab, 1.05, view);
  lab.idleNpcAnchor.position.set(-14, 0, -12); lab.idleNpcAnchor.updateMatrixWorld(true);
  lab.syncNpcPlayerBlocker(true); lab.player.teleport({ x: -14, y: .865, z: -13.05 }); run(.3);
  // Start the target from the lying frame of its real FBX. These tests exercise
  // ground strikes, not the randomized balance/brace response of an upright fall.
  lab.stopNpcCombatGuardLayers(0); lab.idleNpcMixer.stopAllAction();
  lab.playNpcAnimation('stand-up-back', false, 1, true);
  lab.npcCurrentAction.time = 0; lab.idleNpcMixer.update(0);
  lab.idleNpcAnchor.updateMatrixWorld(true); lab.npcMotionHistory.reset();
  // Fix the fall variation; contact rate/rig side are the variables under test.
  const random = Math.random;
  try {
    Math.random = () => .5;
    lab.startNpcRagdoll('punch', new THREE.Vector3(0, 0, 1), 12, 'body');
  } finally { Math.random = random; }
  lab.npcRagdoll.activeResponseScale = 0;
  lab.npcGroundKickRecoveryDelay = 100; run(4);
  // A resting-body strike must start after the articulated fall has settled.
  // Test moving targets separately rather than depending on a random fall's phase.
  if (resting) {
    for (let i = 0; i < 360 && !lab.npcRagdoll.traversalBody?.isEnabled(); i++) stepLab(lab);
    const core = lab.npcRagdoll.bodies.get('core').body;
    assert.ok(lab.npcRagdoll.traversalBody?.isEnabled(), JSON.stringify({
      position: core.translation(), velocity: core.linvel(), angular: core.angvel() }));
  }
  const point = new THREE.Vector3(); lab.resolveGroundKickTarget(point);
  lab.player.teleport({ x: point.x, y: .865, z: point.z - distance });
  lab.player.setLookQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0, 'YXZ')));
  lab.bodyYaw = 0; lab.updateAvatarTransform(0, true);
  lab.lastGroundKickSide = side === 'left' ? 'right' : 'left';
};
const momentum = () => {
  const p = new THREE.Vector3();
  for (const part of lab.npcRagdoll.bodies.values()) {
    const v = part.body.linvel(); p.addScaledVector(new THREE.Vector3(v.x, v.y, v.z), part.body.mass());
  }
  return p;
};

for (const kind of ['stomp', 'soccer-kick']) for (const side of ['left', 'right']) for (const fps of [30, 60, 120]) {
  test(`${kind} with the ${side} foot has a prepared strike and one real impact at ${fps} fps`, () => {
    body(kind === 'stomp' ? .62 : .96, side, fps === 60 ? 'first-person' : 'third-person');
    assert.ok(lab.tryStartGroundKick()); const kick = lab.groundKick;
    assert.equal(kick.kind, kind, JSON.stringify({ target: kick.targetPoint.toArray(), player: lab.avatarAnchor.position.toArray() }));
    const foot = side === 'left' ? lab.leftFootBone : lab.rightFootBone;
    const lower = side === 'left' ? lab.leftLowerLegBone : lab.rightLowerLegBone;
    const firstFoot = side === 'left' ? lab.firstPersonLeftFootBone : lab.firstPersonRightFootBone;
    const beforeKnee = lower.quaternion.clone().normalize();
    const start = foot.getWorldPosition(new THREE.Vector3());
    const health = lab.npcHealth;
    let previous = start.clone(), firstFrameStep = 0, earlyLift = 0, maxDownSpeed = 0;
    let damageEvents = 0, previousHealth = health, contacts = 0, impulse, contactPhase, maxBootStep = 0, maxBootPhase;
    let previousBoot = foot.getWorldQuaternion(new THREE.Quaternion());
    const drive = []; let closest = Infinity, closestPose;
    const physicalImpact = lab.npcRagdoll.applyGroundKickImpact;
    lab.npcRagdoll.applyGroundKickImpact = function (...args) {
      const before = momentum(); physicalImpact.apply(this, args);
      impulse = momentum().sub(before); contacts++; contactPhase = kick.elapsed / kick.duration;
    };
    try {
      for (let i = 0; i < Math.ceil(fps * 1.22); i++) {
        stepLab(lab, 1 / fps);
        if (i === 0) firstFrameStep = beforeKnee.angleTo(lower.quaternion.clone().normalize());
        const point = foot.getWorldPosition(new THREE.Vector3());
        const phase = kick.elapsed / kick.duration;
        if (kick.elapsed <= .11) earlyLift = Math.max(earlyLift, point.y - start.y);
        if (lab.groundKick && phase > (kind === 'stomp' ? .43 : .38) && !kick.impactApplied) {
          maxDownSpeed = Math.max(maxDownSpeed, (previous.y - point.y) * fps);
          drive.push(point.clone());
          const distance = point.distanceTo(lab.groundKickTargetPoint);
          if (distance < closest) {
            closest = distance;
            closestPose = { phase, foot: point.toArray(), target: lab.groundKickTargetPoint.toArray(),
              committed: kick.targetPoint.toArray(), hip: (side === 'left' ? lab.leftUpperLegBone : lab.rightUpperLegBone).getWorldPosition(new THREE.Vector3()).toArray(),
              drop: kick.pelvisDrop, velocity: lab.npcRagdoll.bodies.get('core').body.linvel() };
          }
        }
        if (lab.npcHealth !== previousHealth) { damageEvents++; previousHealth = lab.npcHealth; }
        const boot = foot.getWorldQuaternion(new THREE.Quaternion());
        const bootStep = boot.angleTo(previousBoot);
        if (bootStep > maxBootStep) { maxBootStep = bootStep; maxBootPhase = phase; }
        previousBoot.copy(boot);
        if (lab.groundKick) assert.ok(foot.quaternion.clone().normalize().angleTo(firstFoot.quaternion.clone().normalize()) < 1e-6);
        assert.ok([...lower.quaternion, ...foot.quaternion].every(Number.isFinite));
        previous.copy(point);
      }
      assert.equal(contacts, 1, JSON.stringify({ closest, closestPose })); assert.equal(damageEvents, 1);
      assert.equal(health - lab.npcHealth, kind === 'stomp' ? 22 : 20);
      assert.ok(firstFrameStep < 5 * Math.PI / 180, `knee snapped ${firstFrameStep * 180 / Math.PI} degrees`);
      assert.ok(earlyLift < .04, `foot popped up ${earlyLift}m before loading`);
      assert.ok(maxBootStep < 25 / fps, `boot rotated ${maxBootStep}rad at ${maxBootPhase}`);
      assert.ok(contactPhase > .44 && contactPhase < .65, `contact at ${contactPhase}`);
      if (kind === 'stomp') {
        assert.ok(maxDownSpeed > 2.3, `slow stomp: ${maxDownSpeed}m/s`);
        assert.ok(impulse.y < -28, `weak vertical impulse ${impulse.toArray()}`);
      } else {
        assert.ok(drive.length >= 2);
        const swing = drive.at(-1).clone().sub(drive[0]);
        assert.ok(Math.hypot(swing.x, swing.z) > .17, `no forward swing: ${swing.toArray()}`);
        assert.ok(Math.hypot(impulse.x, impulse.z) > 30, `weak horizontal impulse ${impulse.toArray()}`);
        assert.ok(Math.abs(impulse.y) < Math.hypot(impulse.x, impulse.z) * .2, 'football strike became a downward stomp');
      }
      assert.equal(lab.groundKick, null); assert.ok(lab.player.isLocked);
    } finally { lab.npcRagdoll.applyGroundKickImpact = physicalImpact; }
  });
}

for (const kind of ['stomp', 'soccer-kick']) test(`${kind} misses a body that moves away after the wind-up`, () => {
  body(kind === 'stomp' ? .62 : .96, 'right', 'third-person', false); assert.ok(lab.tryStartGroundKick());
  const kick = lab.groundKick, health = lab.npcHealth;
  while (kick.elapsed / kick.duration < .34) stepLab(lab);
  for (const part of lab.npcRagdoll.bodies.values()) {
    const p = part.body.translation(); part.body.setTranslation({ x: p.x + 2.5, y: p.y, z: p.z }, true);
  }
  run(1.05);
  assert.equal(lab.npcHealth, health, 'a committed miss dealt phantom damage');
  assert.equal(kick.impactApplied, false);
});

test('a missing collider ray hit cannot create a ground-kick surface in empty space', () => {
  body(.62, 'right', 'third-person', false);
  const colliders = lab.npcRagdoll.bodies.get('core').colliders;
  const original = colliders.map(collider => collider.castRay);
  const point = new THREE.Vector3(20, 30, 40);
  try {
    for (const collider of colliders) collider.castRay = () => null;
    assert.equal(lab.npcRagdoll.getGroundKickSurface(lab.avatarAnchor.position, point), false);
    assert.equal(lab.npcRagdoll.getGroundKickSideSurface(lab.avatarAnchor.position, point), false);
    assert.deepEqual(point.toArray(), [20, 30, 40]);
  } finally { colliders.forEach((collider, i) => { collider.castRay = original[i]; }); }
});

test('being hit during a football wind-up cancels its pending contact and preserves control', () => {
  body(.96, 'right', 'first-person');
  assert.ok(lab.tryStartGroundKick()); assert.equal(lab.groundKick.kind, 'soccer-kick');
  const kick = lab.groundKick, health = lab.npcHealth;
  run(.32);
  lab.receivePlayerMeleeHit('punch', new THREE.Vector3(0, 0, -1), 8, 'body');
  assert.equal(lab.groundKick, null);
  run(1.25);
  assert.equal(lab.npcHealth, health); assert.equal(kick.impactApplied, false);
  assert.ok(lab.player.isLocked); assert.equal(lab.combatAttack, null);
});
