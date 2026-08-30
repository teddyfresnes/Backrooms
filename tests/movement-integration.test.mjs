import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createLab, setupDuel, stepLab, THREE } from './support/headless-lab.mjs';

let lab;
before(async () => { lab = await createLab(); });
after(() => lab?.dispose());
const run = (seconds, dt = 1 / 60) => { for (let t = 0; t < seconds; t += dt) stepLab(lab, dt); };
const makeBody = () => {
  setupDuel(lab);
  // These cases measure a resting body on flat ground. Keep the impact away
  // from pits/ramps so a still-rolling corpse cannot invalidate that fixture.
  lab.player.input.clear();
  lab.idleNpcAnchor.position.set(-14, 0, -12);
  lab.idleNpcAnchor.updateMatrixWorld(true);
  lab.syncNpcPlayerBlocker(true);
  lab.player.teleport({ x: -14, y: .865, z: -13.05 });
  run(.3);
  lab.startNpcRagdoll('punch', new THREE.Vector3(0, 0, 1), 12, 'body');
  lab.npcGroundKickRecoveryDelay = 100;
  run(4);
  for (let i = 0; i < 360 && !lab.npcRagdoll.traversalBody?.isEnabled(); i++) stepLab(lab);
  const core = lab.npcRagdoll.bodies.get('core').body;
  assert.ok(lab.npcRagdoll.traversalBody?.isEnabled(), JSON.stringify({ quiet: lab.npcRagdoll.traversalQuietSeconds, position: core.translation(), velocity: core.linvel(), angular: core.angvel() }));
  return lab.npcRagdoll;
};
const exploration = () => {
  setupDuel(lab);
  lab.resetCombatState(true);
  lab.player.input.clear();
  lab.player.setInputEnabled(true);
  lab.player.teleport({ x: -14, y: 0.865, z: -12 });
  lab.player.lookCamera.rotation.set(0, Math.PI, 0);
  lab.player.continuousAimYaw = Math.PI;
  lab.bodyYaw = 0; lab.updateAvatarTransform(0, true);
  lab.gaitTransition.release(0);
  lab.mixer.stopAllAction(); lab.firstPersonMixer.stopAllAction();
  lab.playAnimation('idle-action', true, 1, false, true);
  run(0.3);
};

test('the live capsule crosses a quiet body from four directions without getting stuck or launched', () => {
  const body = makeBody(), center = body.traversalBody.translation();
  for (const heading of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const dx = Math.sin(heading), dz = Math.cos(heading);
    const start = new THREE.Vector3(center.x - dx * 1.25, 0.865, center.z - dz * 1.25);
    lab.physics.teleport(start);
    let maxY = 0, minForward = Infinity;
    for (let i = 0; i < 130; i++) {
      const move = lab.physics.move({ x: dx * 0.025, y: -0.015, z: dz * 0.025 });
      body.passiveUpdate(1 / 60);
      maxY = Math.max(maxY, move.position.y);
      minForward = Math.min(minForward, move.moved.x * dx + move.moved.z * dz);
    }
    const progress = lab.physics.getPosition().clone().sub(start).dot(new THREE.Vector3(dx, 0, dz));
    assert.ok(progress > 2.45, `only ${progress.toFixed(3)} m crossed`);
    assert.ok(minForward > 0.003, `blocked frame: ${minForward}`);
    assert.ok(maxY > 0.98 && maxY < 1.13, `support height ${maxY}`);
  }
});

test('standing on a body stays still, and a real impact/recovery removes its support immediately', () => {
  const body = makeBody(), support = body.traversalBody, center = support.translation();
  lab.physics.teleport({ x: center.x, y: 1.15, z: center.z });
  for (let i = 0; i < 30; i++) { lab.physics.move({ x: 0, y: -0.015, z: 0 }); body.passiveUpdate(1 / 60); }
  const positions = [];
  for (let i = 0; i < 180; i++) {
    const move = lab.physics.move({ x: 0, y: -0.015, z: 0 });
    body.nudgeFromPlayer(move.position, new THREE.Vector3());
    body.passiveUpdate(1 / 60); positions.push(move.position.clone());
    assert.ok(move.grounded);
  }
  assert.ok(Math.max(...positions.map(p => p.y)) - Math.min(...positions.map(p => p.y)) < 0.002);
  assert.ok(positions[0].distanceTo(positions.at(-1)) < 0.002);
  body.applyGroundKickImpact(new THREE.Vector3(0, 0, 1), 1, false, new THREE.Vector3(center.x, center.y, center.z));
  assert.equal(support.isEnabled(), false);
  body.suspendForRecovery();
  assert.equal(support.isEnabled(), false);
});

test('player collision filtering still blocks the standing opponent', () => {
  setupDuel(lab, 1.2);
  const npc = lab.idleNpcAnchor.position;
  lab.physics.teleport({ x: npc.x, y: 0.865, z: npc.z - 1.2 });
  for (let i = 0; i < 100; i++) lab.physics.move({ x: 0, y: -0.015, z: 0.025 });
  assert.ok(lab.physics.getPosition().z < npc.z - 0.60);
});

test('a stomp descends almost vertically onto the real torso surface before its one impact', () => {
  makeBody();
  const point = new THREE.Vector3(); lab.resolveGroundKickTarget(point);
  lab.player.teleport({ x: point.x, y: 0.865, z: point.z - 0.65 });
  lab.bodyYaw = 0; lab.updateAvatarTransform(0, true);
  assert.ok(lab.tryStartGroundKick());
  const kick = lab.groundKick, foot = kick.side === 'left' ? lab.leftFootBone : lab.rightFootBone;
  const samples = []; let changes = 0, health = lab.npcHealth;
  for (let i = 0; i < 120; i++) {
    stepLab(lab, 1 / 120);
    const phase = kick.elapsed / kick.duration;
    if (lab.groundKick && phase >= 0.34 && !kick.impactApplied) samples.push(foot.getWorldPosition(new THREE.Vector3()));
    if (lab.npcHealth !== health) { changes++; health = lab.npcHealth; }
  }
  assert.equal(changes, 1);
  assert.ok(samples.length >= 4);
  const displacement = samples.at(-1).clone().sub(samples[0]);
  assert.ok(displacement.y < -0.06, `downstroke ${displacement.toArray()}`);
  assert.ok(Math.hypot(displacement.x, displacement.z) < 0.065, `forward kick ${displacement.toArray()}`);
});

test('rapid gait changes retain normalized full-pose weights and synchronized first/third person phases', () => {
  exploration();
  const sequence = ['walking', 'walking-forward-left', 'walking-forward-right', 'running', 'left-strafe-walking', 'right-strafe-walking'];
  let maxStep = 0;
  for (let i = 0; i < 144; i++) {
    const before = lab.leftUpperLegBone.quaternion.clone();
    if (i % 8 === 0) lab.playAnimation(sequence[Math.floor(i / 8) % sequence.length], true, 1, false, true);
    lab.playerProceduralPose.restore(); lab.firstPersonProceduralPose.restore();
    lab.evaluateCombatMixers(1 / 120);
    maxStep = Math.max(maxStep, before.angleTo(lab.leftUpperLegBone.quaternion));
    const sum = [...lab.animations.values()].reduce((total, { action }) => total + (action.isScheduled() ? action.getEffectiveWeight() : 0), 0);
    assert.ok(Math.abs(sum - 1) < 1e-5, `weight sum ${sum}`);
    assert.ok(Math.abs(lab.currentAction.time - lab.firstPersonCurrentAction.time) < 1e-7);
  }
  assert.ok(maxStep < 0.45, `leg snapped ${maxStep} radians`);
});

test('movement starts below sprint cadence and renders continuously between 60 Hz physics ticks', () => {
  exploration();
  lab.player.input.pressed.add(lab.player.input.bindings.forward);
  lab.player.input.pressed.add(lab.player.input.bindings.sprint);
  stepLab(lab, 1 / 60);
  assert.ok(!lab.currentAnimation.startsWith('running'), 'Shift at rest instantly selected a running pose');
  const displacements = []; let previous = lab.avatarAnchor.position.clone();
  for (let i = 0; i < 70; i++) {
    stepLab(lab, 1 / 120);
    if (i > 30) displacements.push(lab.avatarAnchor.position.distanceTo(previous));
    previous.copy(lab.avatarAnchor.position);
    const rendered = lab.player.getRenderedFeetPosition(new THREE.Vector3());
    assert.ok(rendered.distanceTo(lab.avatarAnchor.position) < 1e-7);
  }
  assert.ok(lab.currentAnimation.startsWith('running'));
  assert.ok(Math.min(...displacements) > 0.005, `mesh froze between fixed ticks: ${Math.min(...displacements)}`);
  lab.player.input.clear();
});

test('walking keeps the loaded foot near its world contact without a knee snap', () => {
  exploration();
  lab.player.input.pressed.add(lab.player.input.bindings.forward);
  run(0.5);
  const feet = [lab.leftFootBone, lab.rightFootBone];
  const knees = [lab.leftLowerLegBone, lab.rightLowerLegBone];
  const previous = feet.map(foot => foot.getWorldPosition(new THREE.Vector3()));
  const rotations = knees.map(knee => knee.getWorldQuaternion(new THREE.Quaternion()));
  let samples = 0, totalSpeed = 0, maxKneeStep = 0;
  const diagnostics = [];
  for (let frame = 0; frame < 120; frame++) {
    if (frame % 12 === 0) diagnostics.push({frame, animation: lab.currentAnimation, speed: lab.player.getDebugState().horizontalSpeed,
      plants: lab.gaitFootPlants.map((p, i) => ({locked:p.locked, weight:p.weight, height:feet[i].getWorldPosition(new THREE.Vector3()).y-lab.avatarAnchor.position.y}))});
    const wasLoaded = lab.gaitFootPlants.map(plant => plant.locked && plant.weight > 0.90);
    stepLab(lab, 1 / 120);
    feet.forEach((foot, i) => {
      const position = foot.getWorldPosition(new THREE.Vector3());
      const plant = lab.gaitFootPlants[i];
      if (wasLoaded[i] && plant.locked && plant.weight > 0.90) {
        samples++; totalSpeed += position.distanceTo(previous[i]) * 120;
      }
      previous[i].copy(position);
      const rotation = knees[i].getWorldQuaternion(new THREE.Quaternion());
      maxKneeStep = Math.max(maxKneeStep, rotation.angleTo(rotations[i])); rotations[i].copy(rotation);
    });
  }
  assert.ok(samples > 8, `no planted steps: ${samples} ${JSON.stringify(diagnostics)}`);
  assert.ok(totalSpeed / samples < 0.65, `support foot slides at ${totalSpeed / samples} m/s`);
  assert.ok(maxKneeStep < 0.65, `knee snapped ${maxKneeStep} radians`);
  lab.player.input.clear();
});
