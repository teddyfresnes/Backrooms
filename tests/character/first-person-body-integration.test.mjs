import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createLab, setupDuel, stepLab, THREE } from './support/headless-character.mjs';

let lab;
before(async () => { lab = await createLab(); });
after(() => lab?.dispose());
const run = (seconds, fps) => { for (let i = 0; i < Math.ceil(seconds * fps); i++) stepLab(lab, 1 / fps); };
const look = pitch => lab.player.setLookQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, Math.PI, 0, 'YXZ')));
const meshes = () => { const out = []; lab.firstPersonCharacter.traverse(m => { if (m.isSkinnedMesh) out.push(m); }); return out; };
const feetMatchWorld = () => {
  for (const [physical, visible] of [[lab.leftFootBone, lab.firstPersonLeftFootBone], [lab.rightFootBone, lab.firstPersonRightFootBone]]) {
    const error = visible.getWorldPosition(new THREE.Vector3()).distanceTo(physical.getWorldPosition(new THREE.Vector3()));
    assert.ok(error < .018, `visible foot moved ${error} m away from the physical gait`);
  }
};
function eyeClearance() {
  const eye = lab.firstPersonCamera.position;
  for (const chain of [[lab.firstPersonLeftUpperArmBone, lab.firstPersonLeftForearmBone, lab.firstPersonLeftHandBone],
    [lab.firstPersonRightUpperArmBone, lab.firstPersonRightForearmBone, lab.firstPersonRightHandBone]]) {
    for (let i = 0; i < 2; i++) {
      const line = new THREE.Line3(chain[i].getWorldPosition(new THREE.Vector3()), chain[i + 1].getWorldPosition(new THREE.Vector3()));
      const distance = line.closestPointToPoint(eye, true, new THREE.Vector3()).distanceTo(eye);
      assert.ok(distance > .105, `eye entered an arm segment at ${distance} m`);
    }
  }
}

for (const fps of [30, 60, 120]) for (const pitch of [-1.32, -.7, 0, .7, 1.32]) {
  test(`guard has a grounded body and safe arms at pitch ${pitch}, ${fps} fps`, () => {
    lab.player.input.clear(); setupDuel(lab, 1.05, 'first-person'); look(pitch); run(1.2, fps);
    const eye = lab.firstPersonCamera.position.clone();
    for (let i = 0; i < Math.ceil(fps * .4); i++) {
      stepLab(lab, 1 / fps); feetMatchWorld(); eyeClearance();
      assert.ok(lab.firstPersonCamera.position.distanceTo(eye) < .008, 'guard framing moved the gameplay eye');
    }
    if (pitch < -1) {
      lab.firstPersonCamera.updateMatrixWorld(true);
      let visibleLegVertices = 0;
      for (const mesh of meshes()) {
        mesh.skeleton.update();
        const leg = mesh.geometry.attributes.fpLowerBodyMask, body = mesh.geometry.attributes.fpCombatBodyMask;
        for (let j = 0; j < leg.count; j += 3) if (leg.getX(j) > .7 && body.getX(j) > .7) {
          const p = mesh.getVertexPosition(j, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).project(lab.firstPersonCamera);
          if (Math.abs(p.x) < .95 && Math.abs(p.y) < .95 && p.z > -1 && p.z < 1) visibleLegVertices++;
        }
      }
      assert.ok(visibleLegVertices > 100, `legs left the look-down viewport: ${visibleLegVertices}`);
    }
  });
}

for (const fps of [30, 60, 120]) for (const variant of ['jab-a', 'cross-b', 'hook-a', 'shove-a']) {
  test(`${variant} retains its contact and grounded body while looking down at ${fps} fps`, () => {
    lab.player.input.clear(); setupDuel(lab, variant === 'shove-a' ? .71 : .92, 'first-person'); run(1, fps);
    lab.startCombatAttackLayer(variant === 'hook-a' ? 'hook-counter' : 'punch', variant, false,
      variant === 'shove-a' ? 'close' : 'medium', variant === 'shove-a' ? .71 : .92);
    const attack = lab.combatAttack;
    // Look away once the strike is committed. Starting a strike while aiming
    // at the floor is a different physical action and may legitimately miss.
    for (let i = 0; i < Math.ceil(fps * .6) && attack.elapsed / attack.duration < attack.contactStartFraction; i++) stepLab(lab, 1 / fps);
    look(-1.1);
    for (let i = 0; i < Math.ceil(fps * .9); i++) {
      stepLab(lab, 1 / fps); feetMatchWorld(); eyeClearance();
      for (const hand of lab.firstPersonHandBones) assert.ok([...hand.quaternion].every(Number.isFinite));
    }
    assert.ok(attack.impactApplied, 'presentation suppressed the physical contact');
  });
}

test('continuous vertical free-look cannot flip elbows or drag the feet', () => {
  lab.player.input.clear(); setupDuel(lab, 1.05, 'first-person'); run(1, 120);
  const elbows = [lab.firstPersonLeftForearmBone, lab.firstPersonRightForearmBone];
  let previous = elbows.map(b => b.getWorldPosition(new THREE.Vector3()));
  for (let i = 0; i < 360; i++) {
    look(Math.sin(i / 360 * Math.PI * 4) * 1.35); stepLab(lab, 1 / 120);
    feetMatchWorld(); eyeClearance();
    const next = elbows.map(b => b.getWorldPosition(new THREE.Vector3()));
    next.forEach((p, j) => assert.ok(p.distanceTo(previous[j]) < .055, `elbow flipped ${p.distanceTo(previous[j])} m`));
    previous = next;
  }
});

test('guard strafes keep the real foot poses with the visible body', () => {
  for (const direction of ['left', 'right', 'forward', 'backward']) {
    lab.player.input.clear(); setupDuel(lab, 1.05, 'first-person'); run(1, 60); look(-1.25);
    lab.player.input.pressed.add(lab.player.input.bindings[direction]);
    for (let i = 0; i < 36; i++) { stepLab(lab); feetMatchWorld(); eyeClearance(); }
  }
});

test('raising and lowering the guard keeps continuous wrists and a clear eye', () => {
  for (const fps of [30, 60, 120]) {
    lab.player.input.clear(); setupDuel(lab, 1.05, 'first-person');
    lab.resetCombatState(true); lab.playAutoImmediate('idle', true, 1); look(-.7); run(1, fps);
    const hands = lab.firstPersonHandBones;
    let previous = hands.map(b => b.getWorldPosition(new THREE.Vector3()));
    const sample = () => {
      stepLab(lab, 1 / fps); eyeClearance();
      const next = hands.map(b => b.getWorldPosition(new THREE.Vector3()));
      next.forEach((p, j) => assert.ok(p.distanceTo(previous[j]) < 8 / fps + .015,
        `guard transition teleported a wrist ${p.distanceTo(previous[j])} m at ${fps} fps`));
      previous = next;
    };
    lab.combatPointerHeld = true; lab.combatLatchReason = 'manual'; lab.combatLatchSeconds = 10;
    lab.requestCombatGuard('manual');
    for (let i = 0; i < fps * 4; i++) sample();
    assert.equal(lab.combatPhase, 'guard'); feetMatchWorld();
    lab.combatPointerHeld = false; lab.combatLatchSeconds = 0;
    for (let i = 0; i < fps * 4; i++) sample();
    assert.equal(lab.combatPhase, 'none');
  }
});

test('combat mesh closes cut boundaries, keeps skin weights valid, and hides the head', () => {
  for (const mesh of meshes()) {
    const g = mesh.geometry;
    const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <project_vertex>', fragmentShader: '#include <common>\n#include <clipping_planes_fragment>' };
    mesh.material.onBeforeCompile(shader);
    assert.ok(shader.fragmentShader.includes('vFpCombatBodyMask'), 'the renderer never enables the lower-body region');
    const original = lab.character.getObjectByName(mesh.name);
    assert.ok(g.attributes.position.count > original.geometry.attributes.position.count, 'cut sleeves have no closing geometry');
    const skin = g.attributes.skinIndex, weights = g.attributes.skinWeight, body = g.attributes.fpCombatBodyMask, arm = g.attributes.fpCombatArmMask;
    for (let i = 0; i < skin.count; i++) {
      let sum = 0, headWeight = 0;
      for (let j = 0; j < 4; j++) {
        const bone = skin.getComponent(i, j), weight = weights.getComponent(i, j); sum += weight;
        assert.ok(Number.isInteger(bone) && bone >= 0 && bone < mesh.skeleton.bones.length);
        if (/head/i.test(mesh.skeleton.bones[bone].name)) headWeight += weight;
      }
      assert.ok(Math.abs(sum - 1) < .0001);
      if (headWeight > .9) assert.ok(Math.max(body.getX(i), arm.getX(i)) < .19);
    }
  }
});
