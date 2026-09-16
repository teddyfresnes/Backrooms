import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createLab, stepLab, THREE } from './support/headless-lab.mjs';

const lab = await createLab();
const menu = lab.emoteMenu;
const run = seconds => { for (let i = 0; i < Math.ceil(seconds * 60); i++) stepLab(lab); };
const key = code => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
const down = (view = 'third-person') => {
  menu.close(); lab.player.input.clear(); lab.health = 100;
  lab.player.lock(); lab.npcAttackCooldown = 100; lab.recoveryCameraBlend = -1;
  lab.player.teleport({ x: -14, y: .865, z: -12 }); lab.player.grounded = true;
  lab.setViewMode(view); lab.updateAvatarTransform(0, true);
  lab.startRagdoll({ fatal: false }); run(2.2);
  assert.ok(lab.ragdoll); assert.equal(lab.getPlayerEmotePosture(), 'ground');
};
const obstacle = (center, halfExtents) => lab.physics.addChunk('ground-emote-test', [{
  id: 'obstacle', kind: 'wall', center, halfExtents,
}], { x: 0, y: 0, z: 0 });

afterEach(() => {
  menu.close(); lab.player.input.clear();
  if (lab.physics.hasChunk('ground-emote-test')) lab.physics.removeChunk('ground-emote-test');
  if (lab.ragdoll || lab.recovery?.isHolding) {
    lab.refreshRecoveryAvailability(true); lab.startGetUp();
  }
  if (lab.recovery) run(6);
  assert.ok(!lab.recovery, 'the ordinary recovery did not finish'); assert.ok(!lab.ragdoll, 'a physical ragdoll remained active');
  lab.stopEmote(); lab.resetCombatState(true); lab.player.input.clear();
});
after(() => lab.dispose());

test('a settled ground body sees only two ground emotes, neither blocked by its own physical limbs', () => {
  down(); key('Tab');
  assert.equal(menu.isOpen, true); assert.equal(menu.element.querySelectorAll('[data-slot]').length, 2);
  for (const id of ['emote-laying', 'emote-kip-up']) {
    assert.equal(lab.getEmoteUnavailableReason(id), null);
    assert.equal(menu.element.querySelector(`[data-emote="${id}"]`).disabled, false);
  }
  assert.equal(menu.element.querySelector('[data-emote="emote-hip-hop"]'), null);
  menu.element.querySelector('[data-action="collection"]').click();
  assert.equal(menu.element.querySelectorAll('[data-card]').length, 2);
  assert.equal(menu.element.querySelector('[data-card="emote-clapping"]'), null);
  assert.equal(lab.playEmote('emote-clapping'), false);
});

test('the ground overlay fades during physics and closes immediately on a movement key without consuming it', () => {
  down(); key('Tab'); run(1);
  assert.ok(Math.abs(Number(menu.element.style.opacity) - .5) < .001);
  const event = new KeyboardEvent('keydown', { code: lab.settings.controls.forward, bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  assert.equal(menu.isOpen, false); assert.equal(event.defaultPrevented, false);
  assert.ok(lab.ragdoll, 'hiding the picker unexpectedly made the body stand');
  key('Tab'); run(2.02); assert.equal(menu.isOpen, false);
});

test('ground favorites persist independently and never insert a ground animation into the standing wheel', () => {
  down(); const standing = [...menu.favorites]; key('Tab');
  menu.element.querySelector('[data-action="collection"]').click();
  menu.element.querySelector('[data-favorite="emote-kip-up"]').click();
  assert.deepEqual(menu.favorites, standing);
  assert.deepEqual(JSON.parse(localStorage.getItem('backrooms.ground-emote-favorites.v1')), ['emote-laying', null]);
  menu.element.querySelector('[data-favorite="emote-kip-up"]').click();
  assert.deepEqual(menu.groundFavorites, ['emote-laying', 'emote-kip-up']);
});

for (const view of ['first-person', 'third-person']) test(`lying blends from the real ground pose and stays grounded in ${view}`, () => {
  down(view);
  const start = lab.ragdoll.getPelvisPose(new THREE.Vector3(), new THREE.Quaternion());
  const hp = lab.health;
  assert.equal(lab.playEmote('emote-laying'), true);
  assert.ok(!lab.ragdoll, 'a physical ragdoll remained active'); assert.equal(lab.recoveryEmote, 'emote-laying');
  const pose = lab.recovery.getPelvisPose();
  assert.ok(pose.position.distanceTo(start.position) < .00001, 'pose snapped at selection');
  assert.ok(pose.rotation.angleTo(start.rotation) < .001);
  const previous = pose.position.clone(); let maxStep = 0, maxFrame = -1, lowestContact = Infinity;
  const contacts = [];
  lab.activeCorpseRoot.traverse(object => {
    if (object.isBone && /(?:head|hand|leg|foot|toebase)$/i.test(object.name)) contacts.push(object);
  });
  for (let i = 0; i < 58; i++) {
    stepLab(lab); const position = lab.recovery.getPelvisPosition();
    if (previous.distanceTo(position) > maxStep) { maxStep = previous.distanceTo(position); maxFrame = i; } previous.copy(position);
    for (const bone of contacts) lowestContact = Math.min(lowestContact, bone.getWorldPosition(new THREE.Vector3()).y);
  }
  assert.ok(maxStep < .1, `pelvis jumped ${maxStep} metres at preparation frame ${maxFrame}`);
  assert.ok(lowestContact >= -.06, `ground transition put a limb ${-lowestContact} metres below the floor`);
  assert.equal(lab.recovery.isHolding, true); assert.ok(previous.y < .35 && previous.y > .08);
  run(.7); assert.ok(previous.distanceTo(lab.recovery.getPelvisPosition()) < .0001);
  assert.equal(lab.health, hp); assert.equal(lab.viewMode, view);
  assert.equal(lab.recoveryPrompt.getAttribute('aria-hidden'), 'false');
});

for (const view of ['first-person', 'third-person']) test(`kip-up first aligns on the back, then plays and returns control without a position snap in ${view}`, () => {
  down(view); const hp = lab.health; assert.equal(lab.playEmote('emote-kip-up'), true);
  const recovery = lab.recovery;
  run(.3); assert.equal(recovery.animationTime, 0, 'the kip-up started before its initial pose was aligned');
  assert.equal(recovery.isFinished, false);
  run(.2); assert.ok(recovery.animationTime > 0 && recovery.animationTime < .08);
  let previous = recovery.getPelvisPosition(), maxStep = 0;
  while (lab.recovery) {
    stepLab(lab);
    const current = lab.recovery ? lab.recovery.getPelvisPosition() : lab.hipsBone.getWorldPosition(new THREE.Vector3());
    maxStep = Math.max(maxStep, previous.distanceTo(current)); previous = current;
  }
  assert.ok(maxStep < .16, `kip-up or standing handoff jumped ${maxStep} metres`);
  run(.3); assert.equal(lab.player.isIncapacitated, false);
  assert.equal(lab.player.input.enabled, true); assert.equal(lab.health, hp); assert.equal(lab.viewMode, view);
  assert.equal(lab.getPlayerEmotePosture(), 'standing');
});

test('a low ceiling allows a lying pose but grays kip-up because the rise needs more height', () => {
  down(); assert.equal(lab.playEmote('emote-laying'), true); run(1);
  const plan = lab.getGroundEmotePlacement('emote-laying');
  obstacle({ x: plan.origin.x, y: .9, z: plan.origin.z }, { x: 2, y: .08, z: 2 });
  assert.equal(lab.getEmoteUnavailableReason('emote-laying'), null);
  assert.equal(lab.getEmoteUnavailableReason('emote-kip-up'), 'Pas assez de place');
  key('Tab'); assert.equal(menu.element.querySelector('[data-emote="emote-kip-up"]').disabled, true);
  assert.equal(lab.playEmote('emote-kip-up'), false); assert.equal(lab.recovery.isHolding, true);
  assert.equal(lab.playEmote('emote-laying'), true); run(1);
  assert.equal(lab.recovery.isHolding, true);
  lab.refreshRecoveryAvailability(); assert.equal(lab.recoveryGroundAvailable, false);
});

test('a held lying pose can start kip-up or the ordinary E recovery with a continuous handoff', () => {
  down(); assert.equal(lab.playEmote('emote-laying'), true); run(1);
  const start = lab.recovery.getPelvisPose();
  key('Tab'); menu.element.querySelector('[data-emote="emote-kip-up"]').click();
  assert.equal(menu.isOpen, false); assert.equal(lab.recoveryEmote, 'emote-kip-up');
  assert.ok(lab.recovery.getPelvisPosition().distanceTo(start.position) < .00001);
  run(3); assert.ok(!lab.recovery, 'the ordinary recovery did not finish');
  down(); assert.equal(lab.playEmote('emote-laying'), true); run(1);
  key(lab.settings.controls.interact);
  assert.ok(lab.recovery && !lab.recovery.isHolding); assert.equal(lab.recoveryEmote, null);
  run(5); assert.ok(!lab.recovery, 'the ordinary recovery did not finish'); assert.equal(lab.player.isIncapacitated, false);
});
