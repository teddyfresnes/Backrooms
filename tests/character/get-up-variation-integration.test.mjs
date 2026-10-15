import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createLab, setupDuel, stepLab, THREE } from './support/headless-character.mjs';
import { GetUpVariationSelector } from '../../.character-test-dist/character/GetUpVariationRules.js';
import { chooseGetUpSide } from '../../.character-test-dist/character/GetUpRecoveryRules.js';

let lab, rig, bones, mixer;
before(async () => {
  lab = await createLab(); rig = clone(lab.character); rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
  bones = new Map(); rig.traverse(b => { if (b.isBone) bones.set(b.name, b); });
  mixer = new THREE.AnimationMixer(rig);
});
after(() => { mixer?.stopAllAction(); lab?.dispose(); });
const bone = suffix => [...bones.values()].find(b => b.name.endsWith(suffix));
const position = suffix => bone(suffix).getWorldPosition(new THREE.Vector3());
const sample = (clip, t) => {
  mixer.stopAllAction(); const action = mixer.clipAction(clip); action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true; action.play(); mixer.setTime(t); rig.updateMatrixWorld(true);
};
const run = (seconds, fps = 60) => { for (let i = 0; i < Math.ceil(seconds * fps); i++) stepLab(lab, 1 / fps); };
const angle = x => Math.atan2(Math.sin(x), Math.cos(x));

for (const side of ['back', 'belly']) {
  test(`${side} shuffled recoveries exhaust all four choices without adjacent repeats`, () => {
    const choices = lab.getUpVariants.get(side), selector = new GetUpVariationSelector(() => .61);
    let last, cycle = [];
    for (let i = 0; i < 24; i++) {
      const choice = selector.choose(side, 0, choices);
      assert.notEqual(choice.id, last); cycle.push(choice.id); selector.commit(side, choice); last = choice.id;
      if (cycle.length === 4) { assert.equal(new Set(cycle).size, 4); cycle = []; }
    }
  });
  for (const [rightUp, support] of [[.8, 'left'], [-.8, 'right']]) {
    test(`${side} side-lying recovery keeps ${support} support while alternating gestures`, () => {
      const choices = lab.getUpVariants.get(side), selector = new GetUpVariationSelector(() => .4);
      let last;
      for (let i = 0; i < 12; i++) {
        const choice = selector.choose(side, rightUp, choices);
        assert.equal(choice.support, support); assert.notEqual(choice.id, last);
        selector.commit(side, choice); last = choice.id;
      }
    });
  }
}
test('actor histories are independent and blocked choices are not consumed', () => {
  const player = new GetUpVariationSelector(() => .4), npc = new GetUpVariationSelector(() => .4);
  const choices = lab.getUpVariants.get('back');
  const first = player.choose('back', 0, choices);
  assert.equal(player.choose('back', 0, choices).id, first.id);
  player.commit('back', first);
  assert.notEqual(player.choose('back', 0, choices).id, first.id);
  assert.equal(npc.choose('back', 0, choices).id, first.id);
});

test('NPC lying/support classification is anatomical at every heading', () => {
  assert.ok(lab.npcRecoveryRestHipsRotation.angleTo(lab.recoveryRestHipsRotation) < .001);
  for (const yaw of [-2.7, -1.3, 0, 1.8, 3.0]) for (const side of ['back', 'belly']) {
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(side === 'back' ? -Math.PI / 2 : Math.PI / 2, yaw, 0, 'YXZ'));
    const physical = rotation.clone().multiply(lab.recoveryRestHipsRotation);
    const anatomical = physical.multiply(lab.npcRecoveryRestHipsRotation.clone().invert());
    const front = new THREE.Vector3(0, 0, 1).applyQuaternion(anatomical);
    assert.equal(chooseGetUpSide(front.y), side, `wrong posture at heading ${yaw}`);
  }
});

for (const side of ['back', 'belly']) {
  test(`${side} opposite support reflects the anatomical limbs without twisted ankles`, () => {
    const [base, opposite] = lab.getUpVariants.get(side);
    let maxError = 0;
    for (const u of [0, .12, .25, .40, .52, .65]) {
      sample(base.clip, base.clip.duration * u);
      const positions = new Map([...bones].map(([name, b]) => [name, b.getWorldPosition(new THREE.Vector3())]));
      sample(opposite.clip, opposite.clip.duration * u);
      for (const [name, p] of positions) {
        const other = name.includes('Left') ? name.replace('Left', 'Right') : name.replace('Right', 'Left');
        const q = bones.get(other).getWorldPosition(new THREE.Vector3());
        maxError = Math.max(maxError, new THREE.Vector3(-p.x, p.y, p.z).distanceTo(q));
      }
    }
    assert.ok(maxError < .018, `mirror changed the anatomical chain by ${maxError}m`);
  });
  for (const variant of ['floor', 'floor-opposite', 'thigh', 'thigh-opposite']) {
    test(`${side}/${variant} has finite continuous tracks and the same settled standing endpoint`, () => {
      const clip = lab.getUpVariants.get(side).find(v => v.id === variant).clip;
      const base = lab.getUpVariants.get(side)[0].clip;
      const idle = new Map(lab.animations.get('idle').clip.tracks.map(t => [t.name, t]));
      assert.equal(clip.duration, base.duration);
      let maxEndSpeed = 0, maxFinalHipSpeed = 0;
      for (const track of clip.tracks) {
        assert.ok(Array.from(track.values).every(Number.isFinite), track.name);
        const target = idle.get(track.name), interp = track.createInterpolant();
        if (track.name.endsWith('.quaternion')) {
          const q = new THREE.Quaternion().fromArray(interp.evaluate(clip.duration));
          if (target) assert.ok(q.angleTo(new THREE.Quaternion().fromArray(target.createInterpolant().evaluate(0))) < .001);
          let previous = new THREE.Quaternion().fromArray(interp.evaluate(0));
          for (let t = 1 / 120; t <= clip.duration; t += 1 / 120) {
            const next = new THREE.Quaternion().fromArray(interp.evaluate(t));
            assert.ok(Math.abs(next.length() - 1) < .0001);
            assert.ok(next.angleTo(previous) < .30, `${track.name} jumped at ${t}`);
            previous = next;
          }
          // Start at the actual settle boundary: sampling a grid interval
          // straddling it would include the faster, still weight-bearing rise.
          previous.fromArray(interp.evaluate(clip.duration - .72));
          for (let t = clip.duration - .72 + 1 / 120; t < clip.duration; t += 1 / 120) {
            const next = new THREE.Quaternion().fromArray(interp.evaluate(t));
            maxEndSpeed = Math.max(maxEndSpeed, next.angleTo(previous) * 120); previous = next;
          }
        } else if (/hips\.position$/i.test(track.name)) {
          let previous = new THREE.Vector3().fromArray(interp.evaluate(clip.duration - .72));
          for (let t = clip.duration - .72 + 1 / 120; t < clip.duration; t += 1 / 120) {
            const next = new THREE.Vector3().fromArray(interp.evaluate(t));
            maxFinalHipSpeed = Math.max(maxFinalHipSpeed, next.distanceTo(previous) * 120); previous = next;
          }
        }
      }
      assert.ok(maxEndSpeed < 3.2, `settle sped up to ${maxEndSpeed}rad/s`);
      assert.ok(maxFinalHipSpeed < .23);
    });
  }
  for (const mirrored of [false, true]) {
    test(`${side} ${mirrored ? 'opposite' : 'original'} thigh brace preserves loaded limbs and reaches the thigh`, () => {
      const variants = lab.getUpVariants.get(side), ordinary = variants[mirrored ? 1 : 0], brace = variants[mirrored ? 3 : 2];
      const free = brace.support === 'right' ? 'Left' : 'Right';
      const unchanged = new Map(ordinary.clip.tracks.map(t => [t.name, t]));
      for (const track of brace.clip.tracks) if (!new RegExp(`${free}(Arm|ForeArm|Hand)\\.quaternion$`).test(track.name)) {
        assert.deepEqual(track.values, unchanged.get(track.name).values, `${track.name} changed the support`);
      }
      sample(ordinary.clip, ordinary.clip.duration * .70); const oldHand = position(`${free}Hand`);
      sample(brace.clip, brace.clip.duration * .70);
      const target = position(`${free}UpLeg`).lerp(position(`${free}Leg`), .50).add(new THREE.Vector3(0, .025, .035));
      const nowHand = position(`${free}Hand`);
      assert.ok(nowHand.distanceTo(target) < .055, `hand did not find thigh: ${nowHand.distanceTo(target)}m`);
      assert.ok(oldHand.distanceTo(nowHand) > .10, 'brace was only a nominal animation variation');
    });
  }
}

for (const side of ['back', 'belly']) for (const id of ['floor', 'floor-opposite', 'thigh', 'thigh-opposite']) {
  test(`live player ${side}/${id} preserves height, 1P/3P facing and gradual gaze handoff`, () => {
    setupDuel(lab, 4, 'first-person'); lab.resetCombatState(true);
    lab.player.teleport({ x: -14, y: .865, z: -12 }); lab.updateAvatarTransform(0, true);
    lab.startRagdoll({ fatal: false, quietStart: true }); run(1.7); lab.refreshRecoveryAvailability(true);
    const choices = lab.getUpVariants.get(side), pick = lab.playerGetUpVariation.choose;
    // Isolate each supported lying clip; selection context is tested above.
    const sideClip = lab.animations.get(`stand-up-${side}`).clip;
    const otherSide = side === 'back' ? 'belly' : 'back';
    const originalPool = lab.getUpVariants.get(otherSide);
    lab.getUpVariants.set(otherSide, choices); lab.playerGetUpVariation.choose = () => choices.find(v => v.id === id);
    try {
      lab.startGetUp(); assert.ok(lab.recovery); assert.equal(lab.recovery.action.getClip(), choices.find(v => v.id === id).clip);
      assert.equal(lab.recovery.duration, sideClip.duration);
      let finalYaw, finalHip, finalHead;
      while (lab.recovery) {
        finalYaw = lab.recovery.root.rotation.y; finalHip = lab.recovery.getPelvisPosition().y; finalHead = lab.recovery.getHeadPose().position.y;
        lab.player.setLookQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, finalYaw + 2.4 - Math.PI, 0, 'YXZ')));
        stepLab(lab);
      }
      assert.ok(Math.abs(angle(lab.bodyYaw - finalYaw)) < 241 / 60 * Math.PI / 180);
      assert.ok(Math.abs(lab.hipsBone.getWorldPosition(new THREE.Vector3()).y - finalHip) < .025);
      assert.ok(Math.abs(lab.headBone.getWorldPosition(new THREE.Vector3()).y - finalHead) < .035);
      let previous = lab.bodyYaw;
      for (let i = 0; i < 90; i++) {
        stepLab(lab); assert.ok(Math.abs(angle(lab.bodyYaw - previous)) < 241 / 60 * Math.PI / 180); previous = lab.bodyYaw;
        assert.ok(Math.abs(angle(lab.firstPersonAvatarAnchor.rotation.y - lab.bodyYaw)) < 1e-7);
      }
      assert.equal(lab.player.isIncapacitated, false); assert.equal(lab.physics.playerCollider.isEnabled(), true);
    } finally { lab.playerGetUpVariation.choose = pick; lab.getUpVariants.set(otherSide, originalPool); }
  });
}

for (const side of ['back', 'belly']) for (const id of ['floor', 'floor-opposite', 'thigh', 'thigh-opposite']) {
  test(`live NPC ${side}/${id} stands without a height pop or an instantaneous turn`, () => {
    setupDuel(lab, 4, 'third-person'); lab.resetCombatState(true);
    lab.idleNpcAnchor.position.set(-14, 0, -10); lab.idleNpcAnchor.updateMatrixWorld(true); lab.syncNpcPlayerBlocker(true);
    lab.player.teleport({ x: -14, y: .865, z: -14 }); lab.updateAvatarTransform(0, true);
    lab.npcCombatEnabled = id.startsWith('thigh');
    lab.startNpcRagdoll('punch', new THREE.Vector3(0, 0, 1), 12, 'body');
    lab.npcGroundKickRecoveryDelay = 100; run(1.8);
    const choices = lab.getUpVariants.get(side), pick = lab.npcGetUpVariation.choose;
    const otherSide = side === 'back' ? 'belly' : 'back', originalPool = lab.getUpVariants.get(otherSide);
    lab.getUpVariants.set(otherSide, choices); lab.npcGetUpVariation.choose = () => choices.find(v => v.id === id);
    try {
      lab.startNpcGroundRecovery(); assert.ok(lab.npcRecovery);
      assert.equal(lab.npcRecovery.action.getClip(), choices.find(v => v.id === id).clip);
      let finalYaw, finalHip;
      while (lab.npcRecovery) { finalYaw = lab.npcRecovery.root.rotation.y; finalHip = lab.npcRecovery.getPelvisPosition().y; stepLab(lab); }
      assert.ok(Math.abs(lab.idleNpcHipsBone.getWorldPosition(new THREE.Vector3()).y - finalHip) < .03, JSON.stringify({finalHip, now:lab.idleNpcHipsBone.getWorldPosition(new THREE.Vector3()).y, root:lab.idleNpcAnchor.position.toArray(), animation:lab.npcCurrentAnimation, npcAttack:!!lab.npcAttack}));
      let previous = finalYaw, previousHip = lab.idleNpcHipsBone.getWorldPosition(new THREE.Vector3()).y;
      for (let i = 0; i < 35; i++) {
        stepLab(lab); const yaw = lab.idleNpcAnchor.rotation.y;
        assert.ok(Math.abs(angle(yaw - previous)) < 241 / 60 * Math.PI / 180); previous = yaw;
        const hip = lab.idleNpcHipsBone.getWorldPosition(new THREE.Vector3()).y;
        assert.ok(Math.abs(hip - previousHip) < .025, `NPC dropped ${Math.abs(hip - previousHip)}m in the standing fade`);
        assert.ok(hip > .9, `NPC faded back to ragdoll height ${hip}`); previousHip = hip;
      }
      assert.equal(lab.npcRagdoll, undefined); assert.ok(lab.npcHealth > 0);
    } finally { lab.npcGetUpVariation.choose = pick; lab.getUpVariants.set(otherSide, originalPool); }
  });
}
