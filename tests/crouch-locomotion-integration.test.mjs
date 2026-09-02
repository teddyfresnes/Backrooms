import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createLab, setupDuel, stepLab, THREE } from './support/headless-lab.mjs';

let lab;
before(async () => { lab = await createLab(); });
after(() => lab?.dispose());
const run = (seconds, dt = 1 / 60) => { for (let t = 0; t < seconds; t += dt) stepLab(lab, dt); };
function explore(view = 'third-person') {
  lab.player.input.clear(); setupDuel(lab, 1.05, view); lab.resetCombatState(true); lab.player.input.clear();
  lab.physics.setCrouched(false); lab.player.teleport({ x: -14, y: .865, z: -12 });
  lab.player.crouchRequested = false; lab.player.crouching = false;
  lab.player.lookCamera.rotation.set(0, Math.PI, 0); lab.player.continuousAimYaw = Math.PI;
  lab.bodyYaw = 0; lab.updateAvatarTransform(0, true);
  lab.autoOneShot = null; lab.wasSliding = false; lab.slideVisualSettled = false; lab.postureStateInitialized = false;
  lab.gaitTransition.release(0); lab.mixer.stopAllAction(); lab.firstPersonMixer.stopAllAction();
  lab.playAnimation('idle-action', true, 1, false, true); run(.3);
}
function crouch(view) {
  explore(view); lab.player.input.justPressed.add(lab.player.input.bindings.crouch);
  stepLab(lab);
  for (let i = 0; i < 210 && lab.currentAnimation !== 'crouch-idle'; i++) stepLab(lab);
  run(.4); assert.equal(lab.currentAnimation, 'crouch-idle');
}
const keys = names => names.forEach(name => lab.player.input.pressed.add(lab.player.input.bindings[name]));
const joints = () => [lab.hipsBone, lab.leftUpperLegBone, lab.rightUpperLegBone, lab.leftLowerLegBone, lab.rightLowerLegBone];
const pose = () => joints().map(joint => joint.quaternion.clone().normalize());
function weightsAndViews() {
  const sum = [...lab.animations.values()].reduce((n, { action }) => n + (action.isScheduled() ? action.getEffectiveWeight() : 0), 0);
  assert.ok(Math.abs(sum - 1) < 1e-5, `pose weight sum ${sum}`);
  assert.ok(Math.abs(lab.currentAction.time - lab.firstPersonCurrentAction.time) < 1e-7);
  for (const [a, b] of [[lab.leftUpperLegBone, lab.firstPersonLeftUpperLegBone], [lab.rightUpperLegBone, lab.firstPersonRightUpperLegBone],
    [lab.leftLowerLegBone, lab.firstPersonLeftLowerLegBone], [lab.rightLowerLegBone, lab.firstPersonRightLowerLegBone]]) {
    assert.ok(a.quaternion.clone().normalize().angleTo(b.quaternion.clone().normalize()) < 1e-6, 'views use different steps');
  }
}

for (const view of ['first-person', 'third-person']) for (const fps of [30, 60, 120]) {
  test(`crouch start, direction changes and braking retain continuous appuis in ${view} at ${fps} fps`, () => {
    for (const direction of [['forward'], ['backward'], ['left'], ['right'], ['forward', 'left'], ['forward', 'right'], ['backward', 'left'], ['backward', 'right']]) {
      crouch(view); const dt = 1 / fps;
      let previous = pose(), previousHip = lab.hipsBone.getWorldPosition(new THREE.Vector3()).y;
      let maxJointStep = 0, maxHipStep = 0, moving = false;
      keys(direction); stepLab(lab, dt);
      // A 120 Hz render can precede the next 60 Hz input/physics tick.
      if (lab.currentAnimation === 'crouch-idle') stepLab(lab, dt);
      assert.ok(lab.player.getDebugState().horizontalSpeed < .35, 'crouch starts at full speed');
      assert.ok(lab.currentAction.getEffectiveTimeScale() < .45, 'crouch starts at full cadence');
      assert.ok(lab.currentAction.getEffectiveWeight() < .10, 'moving pose replaces rest instantly');
      for (let i = 0; i < Math.ceil(fps * 1.05); i++) {
        stepLab(lab, dt); const current = pose(), hip = lab.hipsBone.getWorldPosition(new THREE.Vector3()).y;
        maxJointStep = Math.max(maxJointStep, ...current.map((q, j) => q.angleTo(previous[j])));
        maxHipStep = Math.max(maxHipStep, Math.abs(hip - previousHip)); previous = current; previousHip = hip;
        moving ||= lab.currentAnimation !== 'crouch-idle'; weightsAndViews();
        assert.ok(Math.abs(lab.avatarAnchor.position.y) < .005, 'capsule resize moves the supporting plane');
        const gaze = lab.combatHeadLocalForward.clone().applyQuaternion(lab.headBone.getWorldQuaternion(new THREE.Quaternion()));
        assert.ok(Math.abs(Math.atan2(gaze.x, gaze.z)) < .35, 'crouch gait looks sideways');
      }
      assert.ok(moving);
      assert.ok(maxJointStep < 22 / fps, `${direction} joint snaps ${maxJointStep}rad at ${fps}fps`);
      assert.ok(maxHipStep < 1.1 / fps, `${direction} pelvis jumps ${maxHipStep}m`);
      if (direction.length === 2) assert.ok(lab.currentAnimation.startsWith(`crouch-${direction[0]}-`), 'diagonal uses a pure sidestep');
      lab.player.input.clear(); run(.65, dt);
      assert.equal(lab.currentAnimation, 'crouch-idle'); weightsAndViews();
    }
  });
}

test('rapid crouched left/right reversals preserve the visible mixture without a knee or pelvis snap', () => {
  crouch('third-person'); let previous = pose(), maxStep = 0, maxHeight = 0, previousHip = lab.hipsBone.position.y;
  for (let i = 0; i < 240; i++) {
    lab.player.input.pressed.clear(); keys([Math.floor(i / 11) % 2 ? 'left' : 'right']); stepLab(lab, 1 / 120);
    const current = pose(); maxStep = Math.max(maxStep, ...current.map((q, j) => q.angleTo(previous[j]))); previous = current;
    maxHeight = Math.max(maxHeight, Math.abs(lab.hipsBone.position.y - previousHip)); previousHip = lab.hipsBone.position.y;
    weightsAndViews();
  }
  assert.ok(maxStep < .20, `rapid reversal joint snap ${maxStep}rad`);
  assert.ok(maxHeight < .012, `rapid reversal pelvis snap ${maxHeight}m`);
  lab.player.input.clear();
});

test('a loaded crouched foot remains near its world contact, including lateral steps', () => {
  for (const direction of ['forward', 'left', 'right']) {
    crouch(); keys([direction]); run(.6);
    const feet = [lab.leftFootBone, lab.rightFootBone], previous = feet.map(foot => foot.getWorldPosition(new THREE.Vector3()));
    let contacts = 0, speed = 0;
    for (let i = 0; i < 180; i++) {
      const loaded = lab.gaitFootPlants.map(p => p.locked && p.weight > .90); stepLab(lab, 1 / 120);
      feet.forEach((foot, j) => {
        const position = foot.getWorldPosition(new THREE.Vector3()), plant = lab.gaitFootPlants[j];
        if (loaded[j] && plant.locked && plant.weight > .90) { contacts++; speed += position.distanceTo(previous[j]) * 120; }
        previous[j].copy(position);
      });
    }
    assert.ok(contacts > 15, `${direction} has no supporting foot`);
    assert.ok(speed / contacts < .75, `${direction} supporting foot slides at ${speed / contacts}m/s`);
    lab.player.input.clear();
  }
});

test('releasing movement during a slide settles into crouch rest without a phantom walking cycle', () => {
  explore(); keys(['forward', 'sprint']); run(.46);
  lab.player.input.justPressed.add(lab.player.input.bindings.crouch); stepLab(lab); run(.25);
  lab.player.input.clear(); let ended = false;
  for (let i = 0; i < 90; i++) {
    stepLab(lab); ended ||= !lab.player.getDebugState().sliding;
    if (ended) assert.ok(!['crouch-walking', 'crouch-strafe-left', 'crouch-strafe-right'].includes(lab.currentAnimation));
  }
  assert.ok(ended); assert.equal(lab.currentAnimation, 'crouch-idle');
});

for (const view of ['first-person', 'third-person']) for (const fps of [30, 60, 120]) {
  test(`slide capsule changes keep the avatar on the floor and the eye continuous in ${view} at ${fps} fps`, () => {
    explore(view); keys(['forward', 'sprint']); run(.46);
    lab.player.input.justPressed.add(lab.player.input.bindings.crouch);
    let previousEye = lab.player.camera.position.y, maxEyeStep = 0, maxFeet = 0, sliding = false, recovery = false;
    for (let i = 0; i < Math.ceil(fps * 1.6); i++) {
      stepLab(lab, 1 / fps); const state = lab.player.getDebugState();
      sliding ||= state.sliding; recovery ||= lab.currentAnimation === 'slide-to-running';
      maxFeet = Math.max(maxFeet, Math.abs(lab.avatarAnchor.position.y));
      maxEyeStep = Math.max(maxEyeStep, Math.abs(lab.player.camera.position.y - previousEye)); previousEye = lab.player.camera.position.y;
    }
    assert.ok(sliding && recovery);
    assert.ok(maxFeet < .005, `interpolated feet jump ${maxFeet}m while the capsule resizes`);
    assert.ok(maxEyeStep < 9 / fps, `eye jumps ${maxEyeStep}m while the capsule resizes`);
    lab.player.input.clear();
  });
}
