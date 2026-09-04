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
    [lab.leftLowerLegBone, lab.firstPersonLeftLowerLegBone], [lab.rightLowerLegBone, lab.firstPersonRightLowerLegBone],
    [lab.leftFootBone, lab.firstPersonLeftFootBone], [lab.rightFootBone, lab.firstPersonRightFootBone]]) {
    assert.ok(a.quaternion.clone().normalize().angleTo(b.quaternion.clone().normalize()) < 1e-6, 'views use different steps');
  }
}

const directions = [['forward'], ['backward'], ['left'], ['right'], ['forward', 'left'],
  ['forward', 'right'], ['backward', 'left'], ['backward', 'right']];
const toeOf = foot => {
  let toe; foot.traverse(bone => { if (/toe_?end$/i.test(bone.name)) toe = bone; });
  assert.ok(toe, 'avatar has no toe endpoint'); return toe;
};
const toeHeading = (foot, anchor) => {
  const forward = toeOf(foot).getWorldPosition(new THREE.Vector3()).sub(foot.getWorldPosition(new THREE.Vector3()));
  forward.applyQuaternion(anchor.getWorldQuaternion(new THREE.Quaternion()).invert());
  return Math.atan2(forward.x, forward.z);
};

for (const view of ['first-person', 'third-person']) {
  test(`standing/crouched posture keeps both soles supported in ${view}`, () => {
    explore(view);
    for (const entering of [true, false]) {
      lab.player.input.justPressed.add(lab.player.input.bindings.crouch);
      let transitioned = false;
      for (let frame = 0; frame < 150; frame++) {
        stepLab(lab, 1 / 120);
        if (lab.currentAnimation !== (entering ? 'standing-to-crouched' : 'crouched-to-standing')) continue;
        transitioned = true;
        for (const foot of [lab.leftFootBone, lab.rightFootBone]) {
          const toeY = toeOf(foot).getWorldPosition(new THREE.Vector3()).y - lab.avatarAnchor.position.y;
          const ankleY = foot.getWorldPosition(new THREE.Vector3()).y - lab.avatarAnchor.position.y;
          assert.ok(toeY > -.008, `posture buries the toes ${toeY}`);
          assert.ok(Math.min(toeY, ankleY - lab.firstPersonFootToSole) < .025,
            `posture floats above its sole contact: ankle ${ankleY}, toe ${toeY}`);
        }
      }
      assert.ok(transitioned, 'posture transition was not exercised');
    }
  });
}

for (const view of ['first-person', 'third-person']) {
  test(`rebuilt crouch feet face ahead with forward knee bends in all eight directions in ${view}`, () => {
    for (const direction of directions) {
      crouch(view); keys(direction);
      for (let frame = 0; frame < 240; frame++) {
        stepLab(lab, 1 / 120);
        for (const [feet, anchor] of [
          [[lab.leftFootBone, lab.rightFootBone], lab.avatarAnchor],
          [[lab.firstPersonLeftFootBone, lab.firstPersonRightFootBone], lab.firstPersonAvatarAnchor],
        ]) {
          const headings = feet.map(foot => toeHeading(foot, anchor));
          assert.ok(headings.every(yaw => Math.abs(yaw) < .20), `${direction}: toes turn sideways ${headings}`);
          assert.ok(Math.abs(headings[0] + headings[1]) / 2 < .065,
            `${direction}: both feet lean to one side ${headings}`);
        }
        const legs = [[lab.leftUpperLegBone, lab.leftLowerLegBone, lab.leftFootBone],
          [lab.rightUpperLegBone, lab.rightLowerLegBone, lab.rightFootBone]];
        for (const [upper, lower, foot] of legs) {
          const hip = upper.getWorldPosition(new THREE.Vector3());
          const axis = foot.getWorldPosition(new THREE.Vector3()).sub(hip).normalize();
          const bend = lower.getWorldPosition(new THREE.Vector3()).sub(hip);
          bend.addScaledVector(axis, -bend.dot(axis));
          bend.applyQuaternion(lab.avatarAnchor.getWorldQuaternion(new THREE.Quaternion()).invert());
          // The support knee extends through a walking step; requiring a deep
          // bend throughout the cycle would encode the rejected squat gait.
          assert.ok(bend.z > .035 && Math.abs(bend.x) < bend.z * .85,
            `${direction}: knee hinge twists sideways ${bend.toArray()}`);
          assert.ok(toeOf(foot).getWorldPosition(new THREE.Vector3()).y >= lab.avatarAnchor.position.y - .002,
            `${direction}: toe penetrates the floor`);
        }
        const a = lab.leftFootBone.getWorldPosition(new THREE.Vector3());
        const b = lab.rightFootBone.getWorldPosition(new THREE.Vector3());
        // A lateral recovery can pass behind the loaded foot. Check actual
        // clearance, not just X ordering, which prohibits a human cross-step.
        assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > .12,
          `${direction}: feet overlap on their supporting plane ${a.distanceTo(b)}`);
        if (view === 'first-person') assert.ok(Math.abs(lab.firstPersonAvatarAnchor.rotation.y - lab.bodyYaw) < 1e-6,
          'legacy first-person crouch compensation still turns the whole rig');
      }
      if (direction.length === 1 && direction[0] === 'backward') {
        assert.equal(lab.currentAnimation, 'crouch-backward', 'backwards motion reverses a forwards toe-off');
        assert.ok(lab.currentAction.getEffectiveTimeScale() > 0);
      }
      lab.player.input.clear(); run(.65);
    }
  });
}

for (const view of ['first-person', 'third-person']) for (const fps of [30, 60, 120]) {
  test(`crouch start, direction changes and braking retain continuous appuis in ${view} at ${fps} fps`, () => {
    for (const direction of directions) {
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

test('crouched walking transfers weight through extending legs instead of moving a wide fixed squat', () => {
  const flexion = ([upper, lower, foot]) => {
    const knee = lower.getWorldPosition(new THREE.Vector3());
    const thigh = upper.getWorldPosition(new THREE.Vector3()).sub(knee).normalize();
    const shin = foot.getWorldPosition(new THREE.Vector3()).sub(knee).normalize();
    return Math.PI - Math.acos(THREE.MathUtils.clamp(thigh.dot(shin), -1, 1));
  };
  for (const direction of ['forward', 'backward', 'left', 'right']) {
    crouch(); keys([direction]); run(.6);
    const heights = [], angles = [[], []];
    const legs = [[lab.leftUpperLegBone, lab.leftLowerLegBone, lab.leftFootBone],
      [lab.rightUpperLegBone, lab.rightLowerLegBone, lab.rightFootBone]];
    for (let frame = 0; frame < 180; frame++) {
      stepLab(lab, 1 / 120);
      const hip = lab.hipsBone.getWorldPosition(new THREE.Vector3()).sub(lab.avatarAnchor.position);
      heights.push(hip.y);
      legs.forEach((leg, side) => angles[side].push(flexion(leg)));
      const left = lab.avatarAnchor.worldToLocal(lab.leftFootBone.getWorldPosition(new THREE.Vector3()));
      const right = lab.avatarAnchor.worldToLocal(lab.rightFootBone.getWorldPosition(new THREE.Vector3()));
      assert.ok(Math.abs(left.x - right.x) < .64, `${direction}: over-wide duck steps ${left.x - right.x}`);
      const kneeLeft = lab.avatarAnchor.worldToLocal(lab.leftLowerLegBone.getWorldPosition(new THREE.Vector3()));
      const kneeRight = lab.avatarAnchor.worldToLocal(lab.rightLowerLegBone.getWorldPosition(new THREE.Vector3()));
      assert.ok(Math.abs(kneeLeft.x - kneeRight.x) < .40, `${direction}: splayed knees ${kneeLeft.x - kneeRight.x}`);
    }
    const mean = heights.reduce((sum, y) => sum + y, 0) / heights.length;
    assert.ok(mean > .83 && mean < .94, `${direction}: pelvis held in a deep squat ${mean}`);
    const rise = Math.max(...heights) - Math.min(...heights);
    assert.ok(rise > .025 && rise < .08, `${direction}: no walking weight transfer or excessive bounce ${rise}`);
    // A cross-step recovers around the loaded foot with less change of knee
    // flexion than a forward stride. Do not force a high-knee marching motion.
    const minimumFlexionChange = direction === 'left' || direction === 'right' ? .15 : .30;
    for (const values of angles) {
      const change = Math.max(...values) - Math.min(...values);
      assert.ok(change > minimumFlexionChange, `${direction}: knee stays fixed through recovery (${change}rad)`);
    }
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
