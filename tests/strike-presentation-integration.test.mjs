import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createLab, setupDuel, stepLab, THREE } from './support/headless-lab.mjs';

let lab;
before(async () => { lab = await createLab(); });
after(() => lab?.dispose());
const run = (frames, dt = 1 / 60) => { for (let i = 0; i < frames; i++) stepLab(lab, dt); };
const duel = (distance, view = 'third-person') => { lab.player.input.clear(); setupDuel(lab, distance, view); };

for (const fps of [30, 60, 120]) for (const side of ['left', 'right']) {
  test(`a ${side} strafe never snaps the face when a punch ends at ${fps} fps`, () => {
    for (const variant of ['jab-a', 'cross-b', 'hook-a']) {
      duel(1.3);
      lab.player.input.pressed.add(lab.player.input.bindings[side]);
      run(30);
      const faceYaw = () => {
        const face = lab.combatHeadLocalForward.clone().applyQuaternion(lab.headBone.getWorldQuaternion(new THREE.Quaternion()));
        return Math.atan2(face.x, face.z);
      };
      let previous = faceYaw(), maximumStep = 0, endStep = 0;
      lab.startCombatAttackLayer(variant === 'hook-a' ? 'hook-counter' : 'punch', variant, false, 'medium', 1.3);
      const attack = lab.combatAttack;
      let ended = false;
      for (let i = 0; i < Math.ceil(fps * 1.2); i++) {
        const active = lab.combatAttack === attack;
        stepLab(lab, 1 / fps);
        const yaw = faceYaw();
        const difference = Math.abs(Math.atan2(Math.sin(yaw - previous), Math.cos(yaw - previous)));
        maximumStep = Math.max(maximumStep, difference);
        if (active && lab.combatAttack !== attack) { endStep = difference; ended = true; }
        previous = yaw;
      }
      assert.ok(ended, `${variant} never finished`);
      assert.ok(endStep < 6 * Math.PI / 180, `${variant} face jumped ${endStep * 180 / Math.PI}° on return`);
      assert.ok(maximumStep < (320 / fps + 1) * Math.PI / 180,
        `${variant} face jumped ${maximumStep * 180 / Math.PI}° during the orbit`);
    }
  });
}

for (const fps of [30, 60, 120]) for (const side of ['left', 'right']) {
  test(`a ${side} orbit keeps its lateral momentum through a cross at ${fps} fps`, () => {
    duel(1.3);
    lab.player.input.pressed.add(lab.player.input.bindings[side]);
    run(16);
    const entry = lab.player.velocity.clone();
    const lateral = entry.clone().normalize();
    const start = lab.player.position.clone();
    lab.startCombatAttackLayer('punch', 'cross-b', false, 'medium', 1.3);
    assert.ok(lab.player.velocity.distanceTo(entry) < 1e-8, 'mouse-down changed momentum');
    let retained = Infinity;
    for (let i = 0; i < Math.ceil(fps * .22); i++) {
      stepLab(lab, 1 / fps);
      retained = Math.min(retained, lab.player.velocity.dot(lateral));
    }
    assert.ok(retained > entry.length() * .60, `lateral speed collapsed to ${retained}`);
    assert.ok(lab.player.position.clone().sub(start).dot(lateral) > .38, 'strike replaced the orbit with a forward rail');
    assert.ok(lab.player.velocity.length() < 3.4, 'the additive step accumulated every frame');
  });
}

test('stationary punches at boxing distance and air punches do not author a forward step', () => {
  for (const distance of [.9, 1.05, 3]) {
    duel(distance);
    const start = lab.player.position.clone();
    lab.startCombatAttackLayer('punch', 'jab-a', false, 'medium', distance);
    for (let i = 0; i < 24; i++) { stepLab(lab); assert.equal(lab.player.combatDriveTimer, 0); }
    const move = lab.player.position.clone().sub(start);
    assert.ok(Math.hypot(move.x, move.z) < .01, `stationary punch moved ${move.length()} m`);
  }
});

test('a deliberate retreat is preserved and an interrupted step keeps its current momentum', () => {
  duel(1.4);
  lab.combatPointerHeld = false;
  lab.player.input.pressed.add(lab.player.input.bindings.backward);
  run(18);
  assert.ok(lab.player.velocity.z < -1);
  lab.player.applyCombatLunge(new THREE.Vector3(0, 0, 1), 1.2, .3);
  for (let i = 0; i < 12; i++) { stepLab(lab); assert.ok(lab.player.velocity.z < -1, 'punch pulled a retreating player forward'); }
  const before = lab.player.velocity.clone();
  lab.player.cancelCombatLunge();
  assert.ok(lab.player.velocity.distanceTo(before) < 1e-9);
  assert.equal(lab.player.combatDriveTimer, 0);
});

test('a blocked additive step cannot bounce backward or pass through a standing opponent', () => {
  duel(.71);
  lab.combatPointerHeld = false;
  const start = lab.player.position.clone();
  lab.player.applyCombatLunge(new THREE.Vector3(0, 0, 1), 3.5, .40);
  for (let i = 0; i < 40; i++) {
    stepLab(lab);
    assert.ok(lab.player.velocity.z >= -.01, `blocked drive became a reverse impulse: ${lab.player.velocity.z}`);
    assert.ok(lab.player.position.z <= lab.idleNpcAnchor.position.z - .60, 'step penetrated the opponent');
  }
  assert.ok(lab.player.position.z - start.z < .13);
});

for (const variant of ['jab-a', 'cross-b', 'hook-a', 'body-cross-a', 'overhand-a']) {
  test(`${variant} keeps the head facing the live opponent while the shoulders turn`, () => {
    duel(.95);
    lab.startCombatAttackLayer(variant.startsWith('hook') ? 'hook-counter' : 'punch', variant, false, 'medium', .95);
    let maxYaw = 0, maxChestYaw = 0;
    for (let i = 0; i < 40; i++) {
      stepLab(lab);
      if (!lab.combatAttack) continue;
      const head = lab.headBone.getWorldPosition(new THREE.Vector3());
      const target = lab.idleNpcHeadBone.getWorldPosition(new THREE.Vector3()).sub(head);
      const face = lab.combatHeadLocalForward.clone().applyQuaternion(lab.headBone.getWorldQuaternion(new THREE.Quaternion()));
      const error = Math.atan2(Math.sin(Math.atan2(face.x, face.z) - Math.atan2(target.x, target.z)), Math.cos(Math.atan2(face.x, face.z) - Math.atan2(target.x, target.z)));
      maxYaw = Math.max(maxYaw, Math.abs(error));
      maxChestYaw = Math.max(maxChestYaw, Math.abs(lab.quaternionTwistYaw(lab.combatSpine2Bone.getWorldQuaternion(new THREE.Quaternion()))));
    }
    assert.ok(maxYaw < 12 * Math.PI / 180, `face turned ${maxYaw * 180 / Math.PI} degrees away`);
    if (variant === 'cross-b') assert.ok(maxChestYaw > .35, 'head correction removed the shoulder commitment');
  });
}

for (const pitch of [-.7, 0, .45]) test(`both guard fists stay outside the central POV at pitch ${pitch}`, () => {
  duel(1.05, 'first-person');
  lab.player.setLookQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, Math.PI, 0, 'YXZ')));
  const scenarios = [null, 'left', null, 'right', null];
  for (const movement of scenarios) {
    lab.player.input.clear();
    if (movement) lab.player.input.pressed.add(lab.player.input.bindings[movement]);
    for (let i = 0; i < 32; i++) {
      stepLab(lab);
      if (i < 15) continue;
      lab.firstPersonCamera.updateMatrixWorld(true);
      for (const hand of lab.firstPersonHandBones) {
        const knuckle = new THREE.Vector3(); lab.sampleCombatKnuckle(hand, knuckle);
        const local = lab.firstPersonCamera.worldToLocal(knuckle.clone());
        const projected = knuckle.project(lab.firstPersonCamera);
        // Optical depth shrinks when the eyes look up past a low rear fist.
        // Eye clearance is a physical distance, independent of camera pitch.
        assert.ok(local.length() > .25, `fist reached the eye: ${local.toArray()}, ${hand.name}, movement ${movement}, frame ${i}`);
        assert.ok(Math.abs(projected.x) > .24 || projected.y < -.32, `fist blocked the reticle: ${projected.toArray()}`);
        assert.ok([...hand.quaternion].every(Number.isFinite));
      }
    }
  }
});

test('first-person guard releases smoothly into a shared physical strike pose and returns without a pop', () => {
  duel(.95, 'first-person'); run(30);
  const start = lab.firstPersonLeftHandBone.getWorldPosition(new THREE.Vector3());
  lab.startCombatAttackLayer('punch', 'jab-a', false, 'medium', .95);
  const attack = lab.combatAttack;
  let previous = start, maxStep = 0, contactFrames = 0;
  for (let i = 0; i < 100; i++) {
    stepLab(lab, 1 / 120);
    const point = lab.firstPersonLeftHandBone.getWorldPosition(new THREE.Vector3());
    maxStep = Math.max(maxStep, point.distanceTo(previous)); previous = point;
    if (lab.combatAttack && attack.elapsed / attack.duration >= attack.contactStartFraction && attack.elapsed / attack.duration <= attack.contactEndFraction) {
      contactFrames++;
      assert.ok(lab.leftUpperArmBone.quaternion.angleTo(lab.firstPersonLeftUpperArmBone.quaternion) < 1e-6);
    }
  }
  assert.ok(contactFrames > 2);
  assert.ok(maxStep < .15, `wrist teleported ${maxStep} m in one frame`);
});
