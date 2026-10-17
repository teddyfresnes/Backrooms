import test from 'node:test';
import assert from 'node:assert/strict';
import { createLab, THREE } from './support/headless-character.mjs';

test('warmup exposes the selected avatar views and motion sampling reuses buffers without changing world poses', async () => {
  const lab = await createLab({ useWardrobe: true });
  try {
    assert.equal(lab.renderWarmupRoots.length, 3);
    assert(lab.renderWarmupRoots.includes(lab.avatarAnchor));
    assert(lab.firstPersonAvatarAnchor.getObjectByName('MakeHuman_HM08_Body'));
    lab.resetRagdollMotionHistory();
    lab.captureRagdollMotionFrame(1 / 60);
    const first = lab.ragdollMotionCurrent;
    lab.avatarAnchor.position.x += .02;
    lab.captureRagdollMotionFrame(1 / 60);
    const second = lab.ragdollMotionCurrent;
    assert.notEqual(first, second);
    const expected = lab.buildRagdollAnimationMotion();
    for (const bone of lab.ragdollMotionBones) {
      const name = bone.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const sample = second.get(name);
      assert(sample.position.distanceTo(bone.getWorldPosition(new THREE.Vector3())) < 1e-8);
      assert(sample.rotation.angleTo(bone.getWorldQuaternion(new THREE.Quaternion())) < 1e-7);
      assert(Math.abs(expected.bones[name].linearVelocity.x - 1.2) < 1e-6);
    }
    const firstSample = [...first.values()][0];
    lab.avatarAnchor.position.x += .02; lab.captureRagdollMotionFrame(1 / 60);
    assert.equal(lab.ragdollMotionCurrent, first);
    assert.equal([...lab.ragdollMotionCurrent.values()][0], firstSample);
    assert.equal(lab.ragdollMotionPrevious, second);
  } finally { lab.dispose(); }
});

test('a despawned partner stops consuming animation work and resumes when spawned again', async () => {
  const lab = await createLab();
  try {
    const position = lab.idleNpcAnchor.position.clone();
    lab.setInteractionPartner(null); lab.player.controls.isLocked = true; lab.setActive(true);
    const npcTime = lab.idleNpcMixer.time, playerTime = lab.mixer.time;
    for (let i = 0; i < 20; i++) lab.update(1 / 60);
    assert.equal(lab.idleNpcMixer.time, npcTime); assert(lab.mixer.time > playerTime);
    lab.setInteractionPartner(position); lab.update(1 / 60);
    assert(lab.idleNpcMixer.time > npcTime); assert(lab.idleNpcAnchor.visible);
  } finally { lab.dispose(); }
});
