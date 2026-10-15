import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createLab, setupDuel, stepLab, THREE } from './support/headless-character.mjs';

let lab;
before(async () => { lab = await createLab(); });
after(() => lab?.dispose());
const angle = x => Math.atan2(Math.sin(x), Math.cos(x));
const run = (seconds, fps = 60) => { for (let i = 0; i < Math.ceil(seconds * fps); i++) stepLab(lab, 1 / fps); };
const mouse = (button, down = true) => lab[down ? 'onCombatMouseDown' : 'onCombatMouseUp']({
  button, target: lab.host.canvas, preventDefault() {},
});
const unguard = () => {
  lab.resetCombatState(true);
  lab.mixer.stopAllAction(); lab.firstPersonMixer.stopAllAction();
  lab.playAnimation('idle-action', true, 1, false, true);
};
const aim = yaw => lab.player.setLookQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw - Math.PI, 0, 'YXZ')));
const headYaw = () => {
  const face = lab.combatHeadLocalForward.clone().applyQuaternion(lab.headBone.getWorldQuaternion(new THREE.Quaternion()));
  return Math.atan2(face.x, face.z);
};

for (const view of ['first-person', 'third-person']) {
  test(`unguarded left clicks cannot raise guard, punch or create a delayed strike in ${view}`, () => {
    setupDuel(lab, .95, view); unguard();
    for (let i = 0; i < 4; i++) { mouse(0); run(.045); mouse(0, false); }
    assert.equal(lab.combatAttack, null);
    assert.equal(lab.groundKick, null);
    assert.equal(lab.combatPhase, 'none');
    assert.equal(lab.combatBufferedPunchSeconds, 0);
    mouse(0); mouse(2); run(.5);
    assert.equal(lab.combatAttack, null, 'raising guard resurrected the rejected held press');
    mouse(0, false); run(.15);
    assert.equal(lab.combatAttack, null, 'release converted the rejected press into an attack');
    mouse(0);
    assert.ok(lab.combatAttack, 'a fresh guarded click did not attack');
    mouse(0, false);
  });
}

test('a ground target cannot bypass the LMB guard requirement', () => {
  setupDuel(lab); lab.startNpcRagdoll('punch', new THREE.Vector3(0, 0, 1), 12, 'body');
  lab.npcGroundKickRecoveryDelay = 100; run(2.6);
  const target = new THREE.Vector3(); assert.ok(lab.resolveGroundKickTarget(target));
  lab.player.teleport({ x: target.x, y: .865, z: target.z - .60 }); lab.updateAvatarTransform(0, true);
  unguard(); mouse(0);
  assert.equal(lab.groundKick, null); assert.equal(lab.combatAttack, null);
  mouse(0, false); mouse(2); run(.35); mouse(0);
  assert.ok(lab.groundKick, 'the same target was not kickable after raising guard');
  mouse(0, false); run(1.3);
});

for (const view of ['first-person', 'third-person']) {
  test(`a guarded ground kick catches a diagonal target without a root snap in ${view}`, () => {
    setupDuel(lab, 1.05, view);
    lab.startNpcRagdoll('punch', new THREE.Vector3(0, 0, 1), 12, 'body');
    lab.npcGroundKickRecoveryDelay = 100; run(2.6);
    const target = new THREE.Vector3(); assert.ok(lab.resolveGroundKickTarget(target));
    lab.player.teleport({ x: target.x + .62, y: .865, z: target.z });
    aim(-Math.PI / 2); lab.bodyYaw = -Math.PI / 2 + .55;
    lab.avatarAnchor.rotation.y = lab.bodyYaw; lab.updateAvatarTransform(0);
    mouse(0); assert.ok(lab.groundKick, 'contextual kick did not start'); mouse(0, false);
    let previous = lab.bodyYaw, maxStep = 0;
    for (let i = 0; i < 85; i++) {
      stepLab(lab); maxStep = Math.max(maxStep, Math.abs(angle(lab.bodyYaw - previous))); previous = lab.bodyYaw;
      if (view === 'first-person') assert.ok(Math.abs(angle(lab.firstPersonAvatarAnchor.rotation.y - lab.bodyYaw)) < 1e-7);
    }
    assert.equal(lab.groundKick, null);
    assert.ok(maxStep <= 241 / 60 * Math.PI / 180, `ground kick turned ${maxStep * 180 / Math.PI}° in one frame`);
  });
}

test('F without an active guard cannot bypass the left-click gate', () => {
  setupDuel(lab); unguard(); lab.combatCounterModifierHeld = true;
  const check = lab.npcCounterWindowIsOpen;
  lab.npcCounterWindowIsOpen = () => true;
  try { mouse(0); assert.equal(lab.combatAttack, null); assert.equal(lab.combatDodge, null); }
  finally { lab.npcCounterWindowIsOpen = check; lab.combatCounterModifierHeld = false; mouse(0, false); }
});

test('a visible manual guard grace still permits an immediate light strike', () => {
  setupDuel(lab); mouse(2, false); run(.2);
  assert.ok(lab.combatAttackGuardActive());
  mouse(0); assert.equal(lab.combatAttack?.kind, 'punch'); mouse(0, false);
});

test('a queued follow-up is discarded when guard is no longer active', () => {
  setupDuel(lab); lab.startCombatAttackLayer('punch', 'cross-b');
  const strike = lab.combatAttack;
  strike.elapsed = strike.duration * .82;
  lab.combatPointerHeld = false; lab.combatCounterModifierHeld = false;
  lab.combatLatchReason = null; lab.combatLatchSeconds = 0;
  lab.combatLeftPointerHeld = false; lab.combatBufferedPunchSeconds = .25;
  let started = 0;
  const start = lab.startCombatAttackLayer.bind(lab);
  lab.startCombatAttackLayer = (...args) => { started++; start(...args); };
  try { run(.3); assert.equal(started, 0, 'a follow-up escaped the guard gate'); }
  finally { lab.startCombatAttackLayer = start; }
});

for (const view of ['first-person', 'third-person']) for (const fps of [30, 60, 120]) {
  test(`punch/release/continued look bounds the actual render rig and gaze in ${view} at ${fps} fps`, () => {
    setupDuel(lab, .95, view);
    lab.combatLockOnActive = false;
    lab.startCombatAttackLayer('punch', 'cross-b');
    const strike = lab.combatAttack;
    while (strike.elapsed / strike.duration < .62) stepLab(lab, 1 / fps);
    lab.combatPointerHeld = false; lab.combatLatchReason = null; lab.combatLatchSeconds = 0;
    let previousBody = lab.bodyYaw, previousRig = lab.firstPersonAvatarAnchor.rotation.y, previousHead = headYaw();
    let maxBody = 0, maxRig = 0, maxHead = 0, ended = false;
    for (let i = 0; i < Math.ceil(fps * 1.25); i++) {
      // Repeated large look changes include a crossing of the ±π seam while
      // the attack/guard exit owns the body. Mouse input remains immediate.
      const yaw = i < fps * .12 ? 2.8 : i < fps * .23 ? -2.8 : -2.35;
      aim(yaw); stepLab(lab, 1 / fps);
      maxBody = Math.max(maxBody, Math.abs(angle(lab.bodyYaw - previousBody)));
      previousBody = lab.bodyYaw;
      if (view === 'first-person') {
        maxRig = Math.max(maxRig, Math.abs(angle(lab.firstPersonAvatarAnchor.rotation.y - previousRig)));
        previousRig = lab.firstPersonAvatarAnchor.rotation.y;
        assert.ok(Math.abs(angle(previousRig - lab.bodyYaw)) < 1e-7, '1P render rig bypassed the physical facing');
      }
      const head = headYaw(); maxHead = Math.max(maxHead, Math.abs(angle(head - previousHead))); previousHead = head;
      ended ||= !lab.combatAttack && lab.combatPhase !== 'guard';
    }
    assert.ok(ended, 'guard exit never completed');
    assert.ok(maxBody <= 241 / fps * Math.PI / 180, `body jump: ${maxBody * 180 / Math.PI}°`);
    assert.ok(maxRig <= 241 / fps * Math.PI / 180, `1P rig jump: ${maxRig * 180 / Math.PI}°`);
    assert.ok(maxHead <= 420 / fps * Math.PI / 180, `head jump: ${maxHead * 180 / Math.PI}°`);
    assert.ok(Math.abs(angle(lab.bodyYaw + 2.35)) < .06, 'body did not finish following the look');
    assert.ok(Math.abs(angle(Math.PI + lab.player.getContinuousAimYawRadians() + 2.35)) < 1e-7, 'body follow changed the aim');
  });
}

for (const view of ['first-person', 'third-person']) for (const fps of [30, 60, 120]) {
  test(`a newly aimed combo strike cannot spin the body toward a rear view in ${view} at ${fps} fps`, () => {
    setupDuel(lab, 4.0, view); lab.combatLockOnActive = false;
    lab.startCombatAttackLayer('punch', 'cross-b'); const first = lab.combatAttack;
    while (first.elapsed / first.duration < .76) stepLab(lab, 1 / fps);
    aim(2.7); mouse(0); mouse(0, false);
    for (let i = 0; i < 8 && lab.combatAttack === first; i++) stepLab(lab, 1 / fps);
    assert.ok(lab.combatAttack && lab.combatAttack !== first, 'the guarded combo was not queued');
    let previousBody = lab.bodyYaw, previousHead = headYaw(), maxBody = 0, maxHead = 0;
    for (let i = 0; i < Math.ceil(fps * 1.15); i++) {
      stepLab(lab, 1 / fps);
      maxBody = Math.max(maxBody, Math.abs(angle(lab.bodyYaw - previousBody))); previousBody = lab.bodyYaw;
      const head = headYaw(); maxHead = Math.max(maxHead, Math.abs(angle(head - previousHead))); previousHead = head;
      if (view === 'first-person') assert.ok(Math.abs(angle(lab.firstPersonAvatarAnchor.rotation.y - lab.bodyYaw)) < 1e-7);
    }
    assert.ok(maxBody <= 241 / fps * Math.PI / 180, `combo body snapped ${maxBody * 180 / Math.PI}°`);
    assert.ok(maxHead <= 420 / fps * Math.PI / 180, `combo head snapped ${maxHead * 180 / Math.PI}°`);
    assert.ok(Math.abs(angle(lab.bodyYaw - 2.7)) < .06);
  });
}

for (const view of ['first-person', 'third-person']) for (const fps of [30, 60, 120]) {
  test(`living get-up turns gradually after the complete rise in ${view} at ${fps} fps`, () => {
    setupDuel(lab, 4.0, view); unguard();
    lab.player.teleport({ x: -14, y: .865, z: -12 }); lab.updateAvatarTransform(0, true);
    lab.startRagdoll({ fatal: false, quietStart: true }); run(1.7, fps);
    lab.refreshRecoveryAvailability(true); lab.startGetUp();
    assert.ok(lab.recovery); const duration = lab.recovery.duration;
    assert.ok(duration >= 3.5 && duration < 4.6, `unnatural compressed recovery ${duration}s`);
    let previousBody, previousHead, maxBody = 0, maxHead = 0, finalYaw, finalHipY, finalHeadY, finalHeadYaw;
    while (lab.recovery) {
      finalYaw = lab.recovery.root.rotation.y;
      finalHipY = lab.recovery.getPelvisPosition().y;
      const sourceHead = lab.recovery.getHeadPose();
      finalHeadY = sourceHead.position.y;
      const face = lab.combatHeadLocalForward.clone().applyQuaternion(sourceHead.rotation);
      finalHeadYaw = Math.atan2(face.x, face.z);
      aim(finalYaw + 2.4); stepLab(lab, 1 / fps);
    }
    previousBody = lab.bodyYaw; previousHead = headYaw();
    assert.ok(Math.abs(angle(previousHead - finalHeadYaw)) <= 420 / fps * Math.PI / 180,
      `head teleported at handoff: ${angle(previousHead - finalHeadYaw) * 180 / Math.PI}°`);
    assert.ok(Math.abs(angle(previousBody - finalYaw)) <= 241 / fps * Math.PI / 180,
      `handoff snapped ${angle(previousBody - finalYaw) * 180 / Math.PI}° to the saved view`);
    assert.ok(Math.abs(lab.hipsBone.getWorldPosition(new THREE.Vector3()).y - finalHipY) < .025, 'standing handoff dropped the pelvis');
    assert.ok(Math.abs(lab.headBone.getWorldPosition(new THREE.Vector3()).y - finalHeadY) < .035, 'standing handoff popped the head');
    for (let i = 0; i < Math.ceil(fps * 1.6); i++) {
      aim(finalYaw + (i < fps * .14 ? -2.6 : 2.1)); stepLab(lab, 1 / fps);
      maxBody = Math.max(maxBody, Math.abs(angle(lab.bodyYaw - previousBody))); previousBody = lab.bodyYaw;
      const head = headYaw(); maxHead = Math.max(maxHead, Math.abs(angle(head - previousHead))); previousHead = head;
      if (view === 'first-person') assert.ok(Math.abs(angle(lab.firstPersonAvatarAnchor.rotation.y - lab.bodyYaw)) < 1e-7);
    }
    assert.ok(maxBody <= 241 / fps * Math.PI / 180, `get-up body jump ${maxBody * 180 / Math.PI}°`);
    assert.ok(maxHead <= 420 / fps * Math.PI / 180, `get-up head jump ${maxHead * 180 / Math.PI}°`);
    assert.ok(Math.abs(angle(lab.bodyYaw - finalYaw - 2.1)) < .08);
    assert.equal(lab.player.isIncapacitated, false);
    assert.equal(lab.physics.playerCollider.isEnabled(), true);
  });
}

for (const side of ['back', 'belly']) {
  test(`the ${side} recovery ends in the ordinary standing pose with a smooth final settle`, () => {
    const clip = lab.animations.get(`stand-up-${side}`).clip;
    const idle = lab.animations.get('idle').clip;
    const idleTracks = new Map(idle.tracks.map(track => [track.name, track]));
    assert.ok(clip.duration > 3.5 && clip.duration < 4.6);
    const settledStart = clip.duration - .72;
    let maxEndAngularSpeed = 0, maxHipSpeed = 0;
    for (const track of clip.tracks) {
      const target = idleTracks.get(track.name);
      if (track.name.endsWith('.quaternion')) {
        const sample = track.createInterpolant(), targetSample = target?.createInterpolant();
        const end = new THREE.Quaternion().fromArray(sample.evaluate(clip.duration));
        if (targetSample) assert.ok(end.angleTo(new THREE.Quaternion().fromArray(targetSample.evaluate(0))) < .001, `${track.name} has an abrupt standing handoff`);
        let last = new THREE.Quaternion().fromArray(sample.evaluate(settledStart));
        for (let t = settledStart + 1 / 120; t < clip.duration; t += 1 / 120) {
          const next = new THREE.Quaternion().fromArray(sample.evaluate(t));
          maxEndAngularSpeed = Math.max(maxEndAngularSpeed, next.angleTo(last) * 120); last = next;
        }
      } else if (/hips\.position$/i.test(track.name)) {
        const sample = track.createInterpolant(); let last = new THREE.Vector3().fromArray(sample.evaluate(settledStart));
        for (let t = settledStart + 1 / 120; t < clip.duration; t += 1 / 120) {
          const next = new THREE.Vector3().fromArray(sample.evaluate(t)); maxHipSpeed = Math.max(maxHipSpeed, next.distanceTo(last) * 120); last = next;
        }
      }
    }
    assert.ok(maxEndAngularSpeed < 3.2, `last settle accelerated a joint to ${maxEndAngularSpeed}rad/s`);
    assert.ok(maxHipSpeed < .23, `final pelvis settle jumped at ${maxHipSpeed}m/s`);
    assert.equal(lab.firstPersonAnimations.get(`stand-up-${side}`).clip, clip);
    assert.equal(lab.idleNpcActions.get(`stand-up-${side}`).getClip(), clip);
  });
}
