import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from './support/rapier-headless.mjs';
import { createLab, setupDuel, stepLab, THREE } from './support/headless-lab.mjs';

let lab;
before(async () => { lab = await createLab(); });
after(() => lab?.dispose());
const angle = x => Math.atan2(Math.sin(x), Math.cos(x));
const run = (seconds, dt = 1 / 60) => { for (let t = 0; t < seconds; t += dt) stepLab(lab, dt); };
const explore = (view = 'third-person') => {
  lab.player.input.clear(); setupDuel(lab, 1.05, view);
  lab.resetCombatState(true); lab.player.input.clear();
  lab.player.teleport({ x: -14, y: .865, z: -12 });
  lab.player.lookCamera.rotation.set(0, Math.PI, 0); lab.player.continuousAimYaw = Math.PI;
  lab.bodyYaw = 0; lab.updateAvatarTransform(0, true);
  lab.autoOneShot = null; lab.wasSliding = false; lab.slideVisualSettled = false;
  lab.postureStateInitialized = false; lab.gaitTransition.release(0);
  lab.mixer.stopAllAction(); lab.firstPersonMixer.stopAllAction();
  lab.playAnimation('idle-action', true, 1, false, true);
  run(.3);
};
const sprintSlide = () => {
  lab.player.input.pressed.add(lab.player.input.bindings.forward);
  lab.player.input.pressed.add(lab.player.input.bindings.sprint);
  run(.46);
  assert.ok(lab.player.getDebugState().horizontalSpeed > 4.45);
  lab.player.input.justPressed.add(lab.player.input.bindings.crouch);
};

for (const view of ['first-person', 'third-person']) for (const fps of [30, 60, 120]) {
  test(`held sprint exits a real slide through its complete recovery in ${view} at ${fps} fps`, () => {
    explore(view); sprintSlide();
    let slid = false, recovered = false, recoverySeconds = 0, returnedToRun = false;
    let previousHip = lab.hipsBone.position.y, previousLeg = lab.leftUpperLegBone.quaternion.clone();
    let maxRiseStep = 0, maxRunEntryStep = 0;
    for (let i = 0; i < Math.ceil(fps * 1.65); i++) {
      const wasRecovery = lab.currentAnimation === 'slide-to-running';
      stepLab(lab, 1 / fps);
      const state = lab.player.getDebugState();
      slid ||= state.sliding;
      if (slid && !state.sliding) assert.equal(state.crouching, false, 'held sprint fell back into crouch walk');
      if (lab.currentAnimation === 'slide-to-running') {
        recovered = true; recoverySeconds += 1 / fps;
        maxRiseStep = Math.max(maxRiseStep, Math.abs(lab.hipsBone.position.y - previousHip));
        assert.ok(Math.abs(lab.currentAction.time - lab.firstPersonCurrentAction.time) < 1e-7);
        assert.ok(lab.leftUpperLegBone.quaternion.clone().normalize().angleTo(lab.firstPersonLeftUpperLegBone.quaternion.clone().normalize()) < 1e-6);
      }
      if (recovered && lab.currentAnimation === 'running') {
        returnedToRun = true;
        if (wasRecovery) maxRunEntryStep = lab.leftUpperLegBone.quaternion.angleTo(previousLeg);
      }
      previousHip = lab.hipsBone.position.y; previousLeg.copy(lab.leftUpperLegBone.quaternion);
    }
    assert.ok(slid && recovered && returnedToRun, `missing slide/recovery/run: ${slid}/${recovered}/${returnedToRun}`);
    assert.ok(recoverySeconds >= .51 && recoverySeconds <= .68, `recovery was cut at ${recoverySeconds}s`);
    assert.ok(maxRiseStep < 3.8 / fps, `pelvis jumped ${maxRiseStep}m`);
    assert.ok(maxRunEntryStep < .45, `run entry snapped ${maxRunEntryStep}rad`);
    lab.player.input.clear();
  });
}

test('releasing sprint during the slide keeps the normal crouched exit', () => {
  explore(); sprintSlide(); stepLab(lab); lab.player.input.pressed.delete(lab.player.input.bindings.sprint);
  run(1);
  assert.equal(lab.player.getDebugState().crouching, true);
  assert.notEqual(lab.currentAnimation, 'slide-to-running');
  assert.ok(lab.currentAnimation.startsWith('crouch-'));
  lab.player.input.clear();
});

test('a real low ceiling prevents both capsule expansion and the sprint recovery pose', () => {
  explore();
  const ceiling = lab.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(1, .12, 8).setTranslation(-14, 1.48, -6));
  try {
    // Enter already crouched, so the ceiling does not overlap a standing capsule.
    lab.player.physics.setCrouched(true); lab.player.crouching = true;
    lab.player.velocity.set(0, 0, 5.8); lab.player.startSlide(5.8);
    lab.player.input.pressed.add(lab.player.input.bindings.forward);
    lab.player.input.pressed.add(lab.player.input.bindings.sprint);
    let recovery = false;
    for (let i = 0; i < 76; i++) { stepLab(lab); recovery ||= lab.currentAnimation === 'slide-to-running'; }
    assert.equal(recovery, false);
    assert.equal(lab.player.getDebugState().crouching, true);
    assert.equal(lab.player.getDebugState().sprinting, false);
  } finally { lab.physics.world.removeCollider(ceiling, true); lab.player.input.clear(); }
});

test('the slide recovery lifts first, then turns toward a changed view without snapping', () => {
  explore(); sprintSlide();
  for (let i = 0; i < 75 && lab.currentAnimation !== 'slide-to-running'; i++) stepLab(lab);
  assert.equal(lab.currentAnimation, 'slide-to-running');
  const entry = lab.bodyYaw;
  lab.player.setLookQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI - 1.9, 0, 'YXZ')));
  let previous = lab.bodyYaw, maxStep = 0, uprightTurn = 0;
  for (let i = 0; i < 31; i++) {
    const progress = lab.currentAction.time / lab.currentAction.getClip().duration;
    stepLab(lab);
    maxStep = Math.max(maxStep, Math.abs(angle(lab.bodyYaw - previous))); previous = lab.bodyYaw;
    if (progress < .63) assert.ok(Math.abs(angle(lab.bodyYaw - entry)) < .001, 'turned while lifting off the floor');
    else uprightTurn = Math.abs(angle(lab.bodyYaw - entry));
  }
  assert.ok(uprightTurn > .12);
  assert.ok(maxStep < 4 * Math.PI / 180, `recovery snapped ${maxStep * 180 / Math.PI} degrees`);
  lab.player.input.clear();
});

for (const view of ['first-person', 'third-person']) for (const fps of [30, 60, 120]) {
  test(`a view change during a punch has a bounded body and head return in ${view} at ${fps} fps`, () => {
    lab.player.input.clear(); setupDuel(lab, .95, view);
    lab.combatLockOnActive = false; lab.combatPointerHeld = false;
    lab.combatLatchReason = 'hit'; lab.combatLatchSeconds = 10;
    lab.startCombatAttackLayer('punch', 'cross-b', false, 'medium', .95);
    const strike = lab.combatAttack;
    while (lab.combatAttack && strike.elapsed / strike.duration < .60) stepLab(lab, 1 / fps);
    lab.player.setLookQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI + 2.0, 0, 'YXZ')));
    let previousBody = lab.bodyYaw, previousHead, maxBody = 0, maxHead = 0, sawGuard = false;
    for (let i = 0; i < Math.ceil(fps * .85); i++) {
      stepLab(lab, 1 / fps);
      const face = lab.combatHeadLocalForward.clone().applyQuaternion(lab.headBone.getWorldQuaternion(new THREE.Quaternion()));
      const headYaw = Math.atan2(face.x, face.z);
      maxBody = Math.max(maxBody, Math.abs(angle(lab.bodyYaw - previousBody))); previousBody = lab.bodyYaw;
      if (previousHead !== undefined) maxHead = Math.max(maxHead, Math.abs(angle(headYaw - previousHead)));
      previousHead = headYaw;
      sawGuard ||= !lab.combatAttack && lab.combatPhase === 'guard';
    }
    assert.ok(sawGuard);
    assert.ok(maxBody <= 241 / fps * Math.PI / 180, `body snapped ${maxBody * 180 / Math.PI} degrees`);
    assert.ok(maxHead <= 390 / fps * Math.PI / 180, `head snapped ${maxHead * 180 / Math.PI} degrees`);
    assert.ok(Math.abs(angle(lab.bodyYaw - 2.0)) < .10, 'body never reached the new direction');
    assert.ok(Math.abs(angle(Math.PI + lab.player.getContinuousAimYawRadians() - 2.0)) < .001, 'animation altered the aim');
  });
}

for (const view of ['first-person', 'third-person']) {
  test(`a real living get-up keeps its final orientation before following the saved view in ${view}`, () => {
    explore(view); lab.startRagdoll({ fatal: false, quietStart: true }); run(1.7);
    lab.refreshRecoveryAvailability(true); lab.startGetUp(); assert.ok(lab.recovery, 'could not start physical recovery');
    let handoff;
    const finish = lab.finishGetUp.bind(lab);
    lab.finishGetUp = () => {
      const yaw = lab.recovery.root.rotation.y;
      lab.player.lookCamera.rotation.set(0, yaw - Math.PI + 1.8, 0); lab.player.continuousAimYaw = yaw - Math.PI + 1.8;
      finish(); handoff = { yaw, bodyYaw: lab.bodyYaw };
    };
    try {
      for (let i = 0; i < 190 && lab.recovery; i++) stepLab(lab);
      assert.ok(handoff);
      assert.ok(Math.abs(angle(handoff.bodyYaw - handoff.yaw)) < 1e-7, 'finishGetUp discarded the authored facing');
      const before = lab.bodyYaw; stepLab(lab);
      assert.ok(Math.abs(angle(lab.bodyYaw - before)) < 6.1 * Math.PI / 180, 'next frame snapped to the camera');
      assert.equal(lab.player.isIncapacitated, false);
    } finally { lab.finishGetUp = finish; }
    run(.4);
  });
}
