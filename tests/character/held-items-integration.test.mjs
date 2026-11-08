import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createLab, setupDuel, stepLab, THREE } from './support/headless-character.mjs';

let lab;
before(async () => { lab = await createLab({ useWardrobe: true }); });
after(() => lab?.dispose());

const frame = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
const point = bone => bone.getWorldPosition(new THREE.Vector3());
function palm() {
  const hand = lab.firstPersonRightHandBone;
  let middle;
  hand.traverse(bone => { if (/righthandmiddle1$/i.test(bone.name.replace(/[^a-z0-9]/gi, ''))) middle = bone; });
  assert.ok(middle);
  return point(hand).lerp(point(middle), .62);
}
function equip(kind, fps = 60) {
  lab.player.input.clear(); setupDuel(lab, 1.05, 'first-person');
  lab.resetCombatState(true); lab.combatPointerHeld = false; lab.combatLatchSeconds = 0;
  lab.setInteractionPartner(null); lab.playAutoImmediate('idle', true, 1);
  lab.player.teleport({ x: -14, y: .865, z: -12 });
  lab.player.setLookQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0, 'YXZ')));
  lab.setHeldItem(kind);
  for (let i = 0; i < fps; i++) stepLab(lab, 1 / fps);
}
function desiredPalm(kind) {
  lab.firstPersonCamera.updateMatrixWorld(true);
  const right = new THREE.Vector3().setFromMatrixColumn(lab.firstPersonCamera.matrixWorld, 0);
  const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(frame.quaternion);
  const side = right.addScaledVector(axis, -right.dot(axis)).normalize();
  if (kind === 'compass') return frame.position.clone().addScaledVector(axis, -.047);
  const hand = lab.firstPersonRightHandBone;
  let middle; hand.traverse(b => { if (/righthandmiddle1$/i.test(b.name)) middle = b; });
  const scale = point(hand).distanceTo(point(middle)) / .0826;
  const fingers = new THREE.Vector3().setFromMatrixColumn(lab.firstPersonCamera.matrixWorld, 1);
  fingers.addScaledVector(axis, -fingers.dot(axis)).normalize();
  return frame.position.clone().addScaledVector(side, .0193 + .0197 * scale).addScaledVector(fingers, -.018 * scale);
}

function handSkinSamples(root) {
  const samples = [];
  root.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const skin = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight, vertices = [];
    for (let v = 0; v < skin.count; v++) {
      let total = 0, greatest = 0, group;
      for (let j = 0; j < 4; j++) {
        const name = mesh.skeleton.bones[skin.getComponent(v, j)].name, weight = weights.getComponent(v, j);
        if (!/righthand/i.test(name)) continue;
        total += weight;
        if (weight > greatest) { greatest = weight; group = /righthand(thumb|index|middle|ring|pinky)/i.exec(name)?.[1]?.toLowerCase() ?? 'palm'; }
      }
      if (total > .8) vertices.push([v, group]);
    }
    if (vertices.length) samples.push({ mesh, vertices });
  });
  return samples;
}

for (const view of ['first-person', 'third-person']) test(`every finger grips the actual torch barrel during motion and crouching in ${view}`, () => {
  equip('torch'); lab.viewMode = view; lab.applyViewMode(true);
  const rig = view === 'first-person' ? lab.firstPersonCharacter : lab.character;
  const samples = handSkinSamples(rig), p = new THREE.Vector3();
  let worstGap = 0, worstPenetration = 0, minOpposition = Infinity, worst, deepest;
  for (const crouching of [false, true, false]) {
    lab.player.input.clear();
    if (crouching) lab.player.input.pressed.add(lab.player.input.bindings.crouch);
    for (let i = 0; i < 120; i++) {
      if (i > 50) lab.player.input.pressed.add(lab.player.input.bindings.forward);
      const pitch = Math.sin(i / 120 * Math.PI) * .8 - .6;
      lab.player.setLookQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, Math.PI + Math.sin(i / 90) * .2, 0, 'YXZ')));
      stepLab(lab);
      if (i % 5 !== 0) continue;
      assert.ok(lab.getHeldItemFrame(frame));
      lab.scene.updateMatrixWorld(true);
      const inverse = frame.quaternion.clone().invert(), contact = new Map();
      for (const { mesh, vertices } of samples) {
        mesh.skeleton.update();
        for (const [v, group] of vertices) {
          mesh.getVertexPosition(v, p).applyMatrix4(mesh.matrixWorld).sub(frame.position).applyQuaternion(inverse);
          if (Math.abs(p.y) > .075) continue;
          const gap = Math.hypot(p.x, p.z) - .0193;
          contact.set(group, Math.min(contact.get(group) ?? Infinity, Math.abs(gap)));
          if (-gap > worstPenetration) { worstPenetration = -gap; deepest = { group, crouching, i, p: p.toArray() }; }
        }
      }
      assert.ok(contact.has('palm'), 'missing palm skin samples');
      // The five digits carry the barrel. The palm may leave a small hollow,
      // but all its vertices still participate in the penetration check above.
      for (const finger of ['index', 'middle', 'ring', 'pinky', 'thumb']) {
        assert.ok(contact.has(finger), `missing skin samples for ${finger}`);
        if (contact.get(finger) > worstGap) {
          worstGap = contact.get(finger);
          const bone = view === 'first-person' ? lab.firstPersonRightHandBone : lab.rightHandBone;
          const middle = bone.getObjectByName('mixamorigRightHandMiddle1').getWorldPosition(new THREE.Vector3());
          const palm = bone.getWorldPosition(new THREE.Vector3()).lerp(middle, .62);
          worst = { finger, crouching, i, pitch, span: point(bone).distanceTo(middle), palm: palm.toArray(), desired: lab.heldGrip.palm.toArray(), blend: lab.heldPose.blend };
        }
      }
      const hand = view === 'first-person' ? lab.firstPersonRightHandBone : lab.rightHandBone;
      const middleTip = hand.getObjectByName('mixamorigRightHandMiddle4').getWorldPosition(new THREE.Vector3());
      const thumbTip = hand.getObjectByName('mixamorigRightHandThumb4').getWorldPosition(new THREE.Vector3());
      const side = hand.getWorldPosition(new THREE.Vector3()).sub(frame.position);
      const barrel = new THREE.Vector3(0, 1, 0).applyQuaternion(frame.quaternion);
      side.addScaledVector(barrel, -side.dot(barrel)).normalize();
      minOpposition = Math.min(minOpposition, thumbTip.sub(middleTip).dot(side));
    }
  }
  lab.player.input.clear();
  assert.ok(worstGap < .006, `a finger floats ${worstGap} m away from the barrel: ${JSON.stringify(worst)}`);
  assert.ok(worstPenetration < .0025, `skin penetrates the barrel by ${worstPenetration} m: ${JSON.stringify(deepest)}`);
  assert.ok(minOpposition > .01, `thumb/fingers do not oppose around the handle: ${minOpposition}`);
});

test('equipping either item preserves the exploration pelvis and body scale', () => {
  equip(null);
  lab.updateAvatarTransform(0, true); lab.applyViewMode(true);
  lab.mixer.timeScale = 0; lab.firstPersonMixer.timeScale = 0;
  stepLab(lab);
  const body = lab.firstPersonHipsBone.getWorldPosition(new THREE.Vector3()).sub(lab.player.position);
  const scale = lab.firstPersonViewmodelScale;
  try {
    for (const kind of ['compass', 'torch']) {
      lab.setHeldItem(kind);
      for (let i = 0; i < 120; i++) stepLab(lab);
      const relative = point(lab.firstPersonHipsBone).sub(lab.player.position);
      assert.ok(relative.distanceTo(body) < .01, `the ${kind} dragged the torso toward the camera: ${JSON.stringify({body:body.toArray(),relative:relative.toArray(),blend:lab.firstPersonCombatPoseBlend,scale:lab.firstPersonViewmodelScale,animation:lab.currentAnimation})}`);
      assert.ok(Math.abs(lab.firstPersonViewmodelScale - scale) < .001, 'equipment changed the body framing');
    }
  } finally { lab.mixer.timeScale = 1; lab.firstPersonMixer.timeScale = 1; }
});

test('combat keeps the rendered eye ahead of the neck without moving the gameplay eye', () => {
  equip(null); setupDuel(lab, 1.05, 'first-person');
  const eye = lab.firstPersonCamera.position.clone();
  for (const pitch of [-1.4, -1.1, -.7, 0, .7]) {
    lab.player.setLookQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, Math.PI, 0, 'YXZ')));
    for (let i = 0; i < 90; i++) stepLab(lab);
    const camera = lab.host.renderCamera;
    camera.updateMatrixWorld(true);
    const neck = point(lab.firstPersonNeckBone).project(camera);
    assert.ok(Math.abs(neck.x) > 1 || Math.abs(neck.y) > 1 || Math.abs(neck.z) > 1, `the neck enters the view at pitch ${pitch}: ${neck.toArray()}`);
    assert.ok(lab.firstPersonCamera.position.distanceTo(eye) < .01, 'combat camera framing altered the movement/aim authority');
  }
});

test('the torch wrist stays below the knuckles instead of reaching over an inverted hand', () => {
  equip('torch');
  for (const pitch of [-1.2, -.5, 0, .5, 1.2]) {
    lab.player.setLookQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, Math.PI, 0, 'YXZ')));
    for (let i = 0; i < 30; i++) stepLab(lab);
    lab.firstPersonCamera.updateMatrixWorld(true);
    const up = new THREE.Vector3().setFromMatrixColumn(lab.firstPersonCamera.matrixWorld, 1);
    const hand = lab.firstPersonRightHandBone;
    let middle; hand.traverse(b => { if (/righthandmiddle1$/i.test(b.name)) middle = b; });
    const knuckles = point(middle).sub(point(hand)).normalize();
    assert.ok(knuckles.dot(up) > .9, `the wrist folded over the torch at pitch ${pitch}`);
    assert.ok(palm().sub(point(hand)).dot(up) > .025, 'the palm is below the wrist');
  }
});

test('the four guard fingers close once through bounded joints on both real wardrobe hands', () => {
  equip(null); setupDuel(lab, 1.05, 'first-person');
  for (let i = 0; i < 90; i++) stepLab(lab);
  const checked = new Set();
  lab.firstPersonCharacter.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    mesh.skeleton.bones.forEach((bone, index) => {
      const match = /(?:left|right)hand(?:index|middle|ring|pinky)([123])$/i.exec(bone.name);
      if (!match || checked.has(bone)) return;
      checked.add(bone);
      const parent = mesh.skeleton.bones.indexOf(bone.parent);
      const local = mesh.skeleton.boneInverses[parent].clone().multiply(mesh.skeleton.boneInverses[index].clone().invert());
      const rest = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(local));
      const angle = rest.angleTo(bone.quaternion);
      const [min, max] = match[1] === '1' ? [.7, 1.4] : match[1] === '2' ? [.9, 1.7] : [.35, .9];
      assert.ok(angle >= min && angle <= max, `${bone.name} folds ${angle} radians from its neutral joint`);
    });
  });
  assert.equal(checked.size, 24, 'the four fingers of both hands were not inspected');
});

test('a first-person strike briefly bounds real mouse turns and then releases without a queued spin', () => {
  equip(null); setupDuel(lab, .95, 'first-person');
  Object.defineProperty(lab.player, 'isPointerCaptured', { configurable: true, get: () => true });
  try {
    lab.startCombatAttackLayer('punch', 'cross-b');
    const yaw = lab.player.getContinuousAimYawRadians(), body = lab.bodyYaw;
    for (let i = 0; i < 10; i++) {
      lab.player.onMouseMove({ movementX: 140, movementY: 0 });
      stepLab(lab, 1 / 120);
      assert.ok(Math.abs(lab.player.getContinuousAimYawRadians() - yaw) < .25, 'the strike let a sudden half-turn through');
    }
    assert.ok(Math.abs(lab.bodyYaw - body) < .5, 'the presentation body twisted during the contact');
    for (let i = 0; i < 60; i++) stepLab(lab, 1 / 120);
    const released = lab.player.getContinuousAimYawRadians();
    assert.ok(Math.abs(released - yaw) < .25, 'releasing the cone applied rejected mouse motion');
    lab.player.onMouseMove({ movementX: -140, movementY: 0 });
    assert.ok(lab.player.getContinuousAimYawRadians() > released + .25, 'normal free look did not return');
    lab.resetCombatState(true); lab.viewMode = 'third-person'; lab.startCombatLayers();
    lab.startCombatAttackLayer('punch', 'cross-b');
    assert.equal(lab.player.strikeLookSeconds, 0, 'the first-person cone leaked into third person');
  } finally { delete lab.player.isPointerCaptured; }
});

for (const kind of ['compass', 'torch']) test(`${kind} contacts the skin without passing through the palm or fingers`, () => {
  equip(kind);
  const meshes = [];
  lab.firstPersonCharacter.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const skin = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight, indices = [];
    for (let v = 0; v < skin.count; v++) {
      let hand = 0;
      for (let j = 0; j < 4; j++) if (/righthand/i.test(mesh.skeleton.bones[skin.getComponent(v, j)].name)) hand += weights.getComponent(v, j);
      if (hand > .8) indices.push(v);
    }
    if (indices.length) meshes.push({ mesh, indices });
  });
  let worstDepth = 0, greatestGap = 0;
  const p = new THREE.Vector3();
  for (const pitch of [-1.2, -.6, 0, .6, 1.2]) {
    lab.player.setLookQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, Math.PI, 0, 'YXZ')));
    for (let i = 0; i < 30; i++) stepLab(lab);
    assert.ok(lab.getHeldItemFrame(frame));
    const inverse = frame.quaternion.clone().invert();
    let contactGap = Infinity;
    for (const { mesh, indices } of meshes) {
      mesh.skeleton.update();
      for (const v of indices) {
        mesh.getVertexPosition(v, p).applyMatrix4(mesh.matrixWorld).sub(frame.position).applyQuaternion(inverse);
        if (Math.abs(p.y) > .075) continue;
        const gap = kind === 'compass'
          ? Math.max(Math.hypot(p.x, p.z) - .0286, Math.abs(p.y + .0005) - .006)
          : Math.hypot(p.x, p.z) - .019;
        worstDepth = Math.max(worstDepth, -gap);
        contactGap = Math.min(contactGap, Math.abs(gap));
      }
    }
    greatestGap = Math.max(greatestGap, contactGap);
  }
  assert.ok(worstDepth < .0025, `skin penetrated the ${kind} by ${worstDepth} m`);
  assert.ok(greatestGap < .008, `the ${kind} floats ${greatestGap} m away from the skin`);
});

for (const kind of ['compass', 'torch']) for (const fps of [30, 60]) {
  test(`${kind} stays gripped in first person while walking and turning at ${fps} fps`, () => {
    equip(kind, fps);
    let largestSlip = 0, worst;
    for (let i = 0; i < fps * 3; i++) {
      lab.player.input.clear();
      if (i < fps * 1.5) lab.player.input.pressed.add(lab.player.input.bindings.forward);
      const pitch = Math.sin(i / fps * 1.8) * .8, yaw = Math.PI + Math.sin(i / fps) * .6;
      lab.player.setLookQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')));
      stepLab(lab, 1 / fps);
      assert.ok(lab.getHeldItemFrame(frame), `missing grip at ${i}: ${JSON.stringify({ position: lab.player.position, view: lab.cameraMode, busy: lab.isBusy, combat: lab.combatPhase })}`);
      const wanted = desiredPalm(kind);
      const slip = palm().distanceTo(wanted);
      if (slip > largestSlip) {
        largestSlip = slip;
        const shoulder = point(lab.firstPersonRightUpperArmBone), elbow = point(lab.firstPersonRightForearmBone), wrist = point(lab.firstPersonRightHandBone);
        worst = { i, pitch, target: wanted.toArray(), palm: palm().toArray(), shoulder: shoulder.toArray(), wrist: wrist.toArray(), lengths: [shoulder.distanceTo(elbow), elbow.distanceTo(wrist)], reach: shoulder.distanceTo(wanted), blend: lab.firstPersonHeldPose.blend, scale: lab.firstPersonViewmodelScale };
      }
    }
    assert.ok(largestSlip < .035, `the palm left the ${kind} by ${largestSlip} m: ${JSON.stringify(worst)}`);
    lab.player.input.clear(); lab.setHeldItem(null); stepLab(lab);
    assert.equal(lab.getHeldItemFrame(frame), false);
  });
}

for (const kind of ['compass', 'torch']) test(`${kind} retracts with the hand against a real wall`, () => {
  equip(kind);
  const eye = lab.firstPersonCamera.position.clone();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(2, 3, .12), new THREE.MeshBasicMaterial());
  wall.position.copy(eye).add(new THREE.Vector3(0, -.2, .42));
  lab.scene.add(wall); wall.updateMatrixWorld(true); lab.environmentMeshes.push(wall);
  lab.physics.stepDynamics(1 / 60);
  try {
    for (let i = 0; i < 90; i++) {
      stepLab(lab);
      assert.ok(lab.getHeldItemFrame(frame));
      assert.ok(palm().distanceTo(desiredPalm(kind)) < .035, 'wall contact separated the object from the palm');
      const tip = frame.position.clone().addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(frame.quaternion), kind === 'torch' ? .19 : 0);
      assert.ok(tip.z < wall.position.z - .08, `held object crossed the wall at ${i}: tip=${tip.z}, wall=${wall.position.z - .06}`);
    }
  } finally {
    lab.environmentMeshes.pop(); wall.removeFromParent(); wall.geometry.dispose(); wall.material.dispose(); lab.setHeldItem(null);
  }
});
