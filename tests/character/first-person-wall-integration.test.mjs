import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createLab, setupDuel, stepLab, THREE } from './support/headless-character.mjs';

let lab;
const walls = [];
before(async () => { lab = await createLab({ useWardrobe: true }); });
afterEach(() => {
  for (const wall of walls.splice(0)) {
    lab.environmentMeshes.pop(); wall.geometry.dispose(); wall.material.dispose();
  }
});
after(() => lab?.dispose());
const run = (seconds, fps = 60) => { for (let i = 0; i < Math.ceil(seconds * fps); i++) stepLab(lab, 1 / fps); };
const point = bone => bone.getWorldPosition(new THREE.Vector3());
function prepare(guard = true, view = 'first-person') {
  lab.player.input.clear(); setupDuel(lab, 1.2, view); lab.setInteractionPartner(null);
  if (!guard) { lab.resetCombatState(true); lab.playAutoImmediate('idle', true, 1); }
  lab.player.setLookQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0, 'YXZ')));
  run(.7);
  return lab.player.position.clone();
}
function wallAt(center, normal, width = 4, thickness = .025) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(width, 3.2, thickness), new THREE.MeshBasicMaterial());
  wall.position.copy(center); wall.position.y = 1.6;
  wall.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), normal);
  lab.environmentMeshes.push(wall); walls.push(wall);
  return { center: wall.position.clone().addScaledVector(normal, thickness / 2), normal };
}
function assertArmsOutside(plane, tolerance = .004) {
  for (const hand of lab.firstPersonHandBones) hand.traverse(bone => {
    if (!bone.isBone) return;
    const clearance = point(bone).sub(plane.center).dot(plane.normal);
    assert(clearance > .016 - tolerance, `${bone.name} crossed the wall: clearance ${clearance}; position ${point(bone).toArray()}; pose ${lab.currentAnimation}; eye ${lab.firstPersonCamera.position.toArray()}`);
  });
  for (const elbow of lab.firstPersonForearmBones) {
    const clearance = point(elbow).sub(plane.center).dot(plane.normal);
    assert(clearance > .045 - tolerance, `elbow crossed the wall: clearance ${clearance}`);
  }
}
function assertVisibleSkinOutside(plane) {
  let vertices = 0, worst = Infinity;
  lab.firstPersonCharacter.updateMatrixWorld(true);
  lab.firstPersonCharacter.traverse(mesh => {
    if (!mesh.isSkinnedMesh || !mesh.visible) return;
    mesh.skeleton.update();
    const skin = mesh.geometry.attributes.skinIndex, weight = mesh.geometry.attributes.skinWeight;
    for (let i = 0; i < skin.count; i++) {
      let armWeight = 0;
      for (let j = 0; j < 4; j++) if (/((left|right)(forearm|hand))/i.test(mesh.skeleton.bones[skin.getComponent(i, j)].name))
        armWeight += weight.getComponent(i, j);
      if (armWeight < .85) continue;
      const position = mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
      worst = Math.min(worst, position.sub(plane.center).dot(plane.normal)); vertices++;
    }
  });
  assert(vertices > 100, 'the actual wardrobe hands/sleeves were not checked');
  assert(worst >= -.003, `the wardrobe skin penetrated the wall by ${-worst} m`);
}

for (const fps of [30, 60, 120]) for (const side of [-1, 1]) {
  test(`walking beside the ${side < 0 ? 'left' : 'right'} wall keeps hands and sleeves inside at ${fps} fps`, () => {
    const position = prepare();
    const normal = new THREE.Vector3(-side, 0, 0);
    const plane = wallAt(position.clone().add(new THREE.Vector3(side * .36, 0, 0)), normal, 12);
    lab.player.input.pressed.add(lab.player.input.bindings.forward);
    for (let i = 0; i < fps * .45; i++) { stepLab(lab, 1 / fps); assertArmsOutside(plane); }
    lab.player.input.clear(); assertVisibleSkinOutside(plane);
  });
}

for (const fps of [30, 60, 120]) for (const distance of [.40, .62]) for (const variant of ['jab-a', 'cross-b', 'hook-a', 'shove-a']) {
  test(`${variant} stops at a thin wall ${distance} m away at ${fps} fps`, () => {
    const position = prepare();
    const plane = wallAt(position.clone().add(new THREE.Vector3(0, 0, distance)), new THREE.Vector3(0, 0, -1), 4, .012);
    run(.2);
    lab.startCombatAttackLayer(variant === 'hook-a' ? 'hook-counter' : 'punch', variant, false,
      variant === 'shove-a' ? 'close' : 'medium', variant === 'shove-a' ? .71 : .92);
    const attack = lab.combatAttack; assert(attack, 'the strike never started');
    for (let i = 0; i < Math.ceil(fps * 1.2); i++) {
      stepLab(lab, 1 / fps); assertArmsOutside(plane);
      for (const [physical, visible] of [[lab.leftFootBone, lab.firstPersonLeftFootBone], [lab.rightFootBone, lab.firstPersonRightFootBone]])
        assert(point(physical).distanceTo(point(visible)) < .018, 'wall adaptation displaced a foot');
      if (i === Math.floor(fps * .3) || i === Math.floor(fps * .5)) assertVisibleSkinOutside(plane);
    }
    assert(lab.player.position.distanceTo(position) < .03, 'presentation correction pushed the gameplay capsule');
    assert(attack.elapsed >= attack.contactStartFraction * attack.duration, 'the contact phase was not exercised');
  });
}

test('a diagonal wall and a corner constrain both hands during turning and free look', () => {
  const position = prepare();
  const plane = wallAt(position.clone().add(new THREE.Vector3(0, 0, .52)), new THREE.Vector3(-.5, 0, -1).normalize());
  const side = wallAt(position.clone().add(new THREE.Vector3(-.36, 0, 0)), new THREE.Vector3(1, 0, 0));
  run(.2);
  const joints = [...lab.firstPersonForearmBones, ...lab.firstPersonHandBones];
  let previous = joints.map(point);
  for (let i = 0; i < 180; i++) {
    const yaw = Math.PI + Math.sin(i / 180 * Math.PI * 2) * .45, pitch = Math.sin(i / 180 * Math.PI * 4) * 1.15;
    lab.player.setLookQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')));
    stepLab(lab); assertArmsOutside(plane); assertArmsOutside(side);
    const current = joints.map(point);
    current.forEach((p, j) => assert(p.distanceTo(previous[j]) < .1, 'wall contact flipped an elbow or teleported a wrist'));
    previous = current;
    for (const [upper, elbow, hand] of [
      [lab.firstPersonLeftUpperArmBone, lab.firstPersonLeftForearmBone, lab.firstPersonLeftHandBone],
      [lab.firstPersonRightUpperArmBone, lab.firstPersonRightForearmBone, lab.firstPersonRightHandBone],
    ]) for (const [a, b] of [[upper, elbow], [elbow, hand]]) {
      const nearest = new THREE.Line3(point(a), point(b)).closestPointToPoint(lab.firstPersonCamera.position, true, new THREE.Vector3());
      assert(nearest.distanceTo(lab.firstPersonCamera.position) > .10, 'a folded arm entered the eye');
    }
  }
  assertVisibleSkinOutside(plane); assertVisibleSkinOutside(side);
});

test('lowered exploration hands and sprint poses also stay out of side walls', () => {
  prepare(false);
  // Run across the intact north strip, parallel to the test wall; the original
  // movement fixture has an open pit in front of its comparison mannequin.
  lab.player.setLookQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0, 'YXZ')));
  run(.8);
  const position = lab.player.position.clone();
  const plane = wallAt(position.clone().add(new THREE.Vector3(0, 0, .36)), new THREE.Vector3(0, 0, -1), 12);
  lab.player.input.pressed.add(lab.player.input.bindings.forward);
  lab.player.input.pressed.add(lab.player.input.bindings.sprint);
  for (let i = 0; i < 60; i++) {
    stepLab(lab); assert(lab.firstPersonAvatarAnchor.visible, 'the sprint left the live first-person rig'); assertArmsOutside(plane);
  }
  lab.player.input.clear(); assertVisibleSkinOutside(plane);
});

test('a wall between the player and partner blocks damage as well as the visible fists', () => {
  lab.player.input.clear(); setupDuel(lab, .92, 'first-person'); run(.7);
  const plane = wallAt(lab.player.position.clone().add(new THREE.Vector3(0, 0, .45)), new THREE.Vector3(0, 0, -1));
  const health = lab.npcHealth;
  lab.startCombatAttackLayer('punch', 'cross-b', false, 'medium', .92);
  assert(lab.combatAttack);
  for (let i = 0; i < 72; i++) { stepLab(lab); assertArmsOutside(plane); }
  assert.equal(lab.npcHealth, health, 'a punch dealt damage through a wall');
});

test('leaving a wall restores the authored pose and third person issues no arm probes', () => {
  const position = prepare();
  wallAt(position.clone().add(new THREE.Vector3(0, 0, .40)), new THREE.Vector3(0, 0, -1));
  run(.5);
  lab.environmentMeshes.pop(); const removed = walls.pop(); removed.geometry.dispose(); removed.material.dispose();
  run(1);
  const before = lab.firstPersonHandBones.map(point);
  lab.firstPersonObstaclePose.reset();
  lab.firstPersonObstaclePose.apply(lab.firstPersonCamera, [
    [lab.firstPersonLeftUpperArmBone, lab.firstPersonLeftForearmBone, lab.firstPersonLeftHandBone],
    [lab.firstPersonRightUpperArmBone, lab.firstPersonRightForearmBone, lab.firstPersonRightHandBone],
  ], lab.environment, 1 / 60);
  lab.firstPersonHandBones.forEach((hand, i) => assert(point(hand).distanceTo(before[i]) < .0001));
  lab.toggleView();
  const sweep = lab.environment.sweepSphere; let probes = 0;
  lab.environment.sweepSphere = (...args) => { probes++; return sweep.apply(lab.environment, args); };
  try { run(.5); assert.equal(probes, 0); }
  finally { lab.environment.sweepSphere = sweep; }
});

test('folding at contact preserves limb lengths, wrists and the world body', () => {
  const position = prepare();
  wallAt(position.clone().add(new THREE.Vector3(.36, 0, .46)), new THREE.Vector3(-1, 0, -1).normalize());
  const chains = [
    [lab.firstPersonLeftUpperArmBone, lab.firstPersonLeftForearmBone, lab.firstPersonLeftHandBone],
    [lab.firstPersonRightUpperArmBone, lab.firstPersonRightForearmBone, lab.firstPersonRightHandBone],
  ];
  const original = lab.firstPersonObstaclePose.apply;
  let corrections = 0;
  lab.firstPersonObstaclePose.apply = function (...args) {
    const before = chains.map(([a, b, c]) => [point(a).distanceTo(point(b)), point(b).distanceTo(point(c)), c.getWorldQuaternion(new THREE.Quaternion())]);
    const eye = lab.firstPersonCamera.position.clone(), worldHands = [point(lab.leftHandBone), point(lab.rightHandBone)];
    original.apply(this, args); corrections++;
    chains.forEach(([a, b, c], i) => {
      assert(Math.abs(point(a).distanceTo(point(b)) - before[i][0]) < 1e-6, 'upper arm stretched');
      assert(Math.abs(point(b).distanceTo(point(c)) - before[i][1]) < 1e-6, 'forearm stretched');
      assert(c.getWorldQuaternion(new THREE.Quaternion()).angleTo(before[i][2]) < 1e-6, 'wall IK rolled the wrist');
    });
    assert(lab.firstPersonCamera.position.distanceTo(eye) < 1e-10, 'wall IK moved the camera');
    [lab.leftHandBone, lab.rightHandBone].forEach((hand, i) => assert(point(hand).distanceTo(worldHands[i]) < 1e-10, 'wall IK changed the authoritative world pose'));
  };
  try { run(.4); assert(corrections > 10); }
  finally { lab.firstPersonObstaclePose.apply = original; }
});
