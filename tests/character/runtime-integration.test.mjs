import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createLab, stepLab, setupDuel, THREE } from './support/headless-character.mjs';
import { viewmodelCommand } from '../../.character-test-dist/character/ViewmodelCommand.js';
import { analyzePitEdge } from '../../.character-test-dist/character/PitEdgeRagdoll.js';
const runtime = await createLab();
after(() => runtime.dispose());
const run = seconds => { for (let i = 0; i < Math.ceil(seconds * 60); i++) stepLab(runtime); };

test('/viewmodel toggles the rendered camera twice without teleporting or changing aim', () => {
  setupDuel(runtime, 2.4, 'first-person'); runtime.resetCombatState(true); run(.3);
  const position = runtime.player.position.clone(), aim = runtime.player.getLookQuaternion().clone();
  assert.equal(viewmodelCommand(runtime, []).close, true);
  assert.equal(runtime.cameraMode, 'third-person');
  assert.ok(runtime.host.renderCamera.position.distanceTo(runtime.host.playerCamera.position) > .5);
  assert.equal(viewmodelCommand(runtime, []).close, true);
  assert.equal(runtime.cameraMode, 'first-person');
  assert.ok(position.distanceTo(runtime.player.position) < 1e-8);
  assert.ok(aim.angleTo(runtime.player.getLookQuaternion()) < 1e-7);
  assert.ok(runtime.host.renderCamera.position.distanceTo(runtime.host.playerCamera.position) < 1e-8);
  assert.equal(viewmodelCommand(runtime, ['on']).close, false);
  assert.equal(runtime.cameraMode, 'first-person');
});

test('the host owns the only canvas and receives one world step per fixed tick', () => {
  setupDuel(runtime); runtime.resetCombatState(true);
  assert.equal(runtime.root.querySelector('canvas'), null);
  assert.equal(runtime.root.querySelector('button[data-action="bot-interact"], [data-animation], [data-range], .animation-lab__hint'), null);
  assert.equal(runtime.host.container.querySelectorAll('canvas').length, 1);
  const physics = runtime.physics, step = physics.world.step.bind(physics.world);
  let steps = 0; physics.world.step = (...args) => { steps++; return step(...args); };
  try { runtime.accumulator = 0; runtime.update(1 / 60); assert.equal(steps, 1); }
  finally { physics.world.step = step; }
});

test('pausing freezes character physics and Tab; resuming restores movement', () => {
  setupDuel(runtime); runtime.resetCombatState(true);
  const playing = runtime.host.isPlaying;
  runtime.host.isPlaying = () => false; runtime.setActive(false);
  const pose = runtime.player.position.clone(), clock = runtime.combatClock;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab', cancelable: true }));
  runtime.update(1);
  assert.equal(runtime.emoteMenu.isOpen, false); assert.equal(runtime.root.hidden, true);
  assert.ok(runtime.player.position.equals(pose)); assert.equal(runtime.combatClock, clock);
  runtime.host.isPlaying = playing; runtime.setActive(true);
  window.dispatchEvent(new KeyboardEvent('keydown', { code: runtime.settings.controls.forward, key: 'z' }));
  runtime.update(1 / 30); runtime.update(1 / 30);
  assert.ok(runtime.player.position.distanceTo(pose) > .005);
  runtime.player.input.clear();
});

test('removing a streamed partner removes its blocker and contextual interactions', () => {
  setupDuel(runtime, 1.05); runtime.resetCombatState(true); run(.3);
  assert.equal(runtime.hasPairTarget(), true);
  runtime.setInteractionPartner(null);
  assert.equal(runtime.hasPairTarget(), false);
  assert.equal(runtime.combatTargetDirection(new THREE.Vector3()), null);
  assert.equal(runtime.getInteractionPartnerPosition(), null);
  runtime.emoteMenu.open();
  assert.equal(runtime.emoteMenu.element.querySelectorAll('[data-pair]').length, 0);
  assert.equal(runtime.emoteMenu.element.querySelectorAll('[data-slot]').length, 8);
  runtime.emoteMenu.close();
});

test('the third-person boom uses actual host wall colliders', () => {
  setupDuel(runtime, 2.4); runtime.resetCombatState(true);
  const feet = runtime.physics.getFeetPosition(new THREE.Vector3());
  runtime.physics.addChunk('camera-wall', [{id: 'wall', kind: 'wall', center: {x:feet.x,y:feet.y+1.4,z:feet.z-1.8}, halfExtents:{x:3,y:1.4,z:.1}}], {x:0,y:0,z:0});
  try {
    runtime.player.setLookQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI));
    runtime.setViewMode('third-person'); run(.7);
    assert.ok(runtime.thirdPersonCamera.position.z > feet.z - 1.7, String(runtime.thirdPersonCamera.position.z));
  } finally { runtime.physics.removeChunk('camera-wall'); }
});

const pit = {id:'real-story',minX:-1,maxX:1,minZ:-1,maxZ:1,bottom:-5.4,rimY:-54};
const sample = {x:0,y:-54.1,z:0,velocityX:0,velocityY:-3,velocityZ:0,grounded:false,falling:true,fallDistance:1,
  viewX:0,viewZ:1,viewPitchDegrees:0,manualLean:0,crouching:false,lowPosture:false};
test('pit detection follows the world rim height and accepts openings without stairs', () => {
  assert.equal(analyzePitEdge(sample,[pit])?.immediate,true);
  assert.equal(analyzePitEdge({...sample,y:.865},[pit]),null);
  assert.equal(analyzePitEdge({...sample,y:-61},[pit]),null);
});


test('a nearby survivor offers help once after a real physical fall, with no laboratory button', () => {
  setupDuel(runtime, 2, 'third-person'); runtime.resetCombatState(true);
  runtime.host.automaticHelp = true;
  try {
    runtime.startRagdoll({fatal:false});
    for (let i=0;i<420&&!runtime.pairCoordinator.invitation;i++) stepLab(runtime);
    assert.equal(runtime.pairCoordinator.invitation?.kind,'help-up');
    assert.equal(runtime.pairCoordinator.session,null);
    runtime.cancelPairInteraction(); run(1);
    assert.equal(runtime.pairCoordinator.invitation,null);
  } finally {
    runtime.host.automaticHelp = false; runtime.cancelPairInteraction();
    if (runtime.ragdoll) runtime.respawnPlayer();
  }
});
