import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createMovementLabPlan, MOVEMENT_LAB_IDLE_NPC, MOVEMENT_LAB_PITS, MOVEMENT_LAB_SPAWN } from '../.movement-test-dist/dev/MovementLabPlan.js';
import { MOVEMENT_TUNING, validateMovementTuning } from '../.movement-test-dist/player/MovementConfig.js';
import { directionChangeSeverity, expSmoothing, forwardBiasedDiagonalAxes, manualLeanAxis, movementBasisFromYaw, moveSpeedAlongDirection2D, moveTowards2D, normalizedSpeed } from '../.movement-test-dist/player/MovementKinematics.js';
import {
  THIRD_PERSON_LOOK_TUNING,
  canResetStrongTurnLatch,
  dampAngleRadians,
  strongTurnDirection,
  updateTurnGate,
  unwrapAngleRadians,
  wrapAngleRadians,
} from '../.movement-test-dist/dev/ThirdPersonLook.js';
import {
  PIT_EDGE_RAGDOLL_THRESHOLD,
  analyzePitEdge,
  integratePitEdgeRisk,
  pitRagdollDamageForDrop,
} from '../.movement-test-dist/dev/PitEdgeRagdoll.js';
import { activeRagdollAnimationCarry, activeRagdollEnvelope, activeRagdollProfile } from '../.movement-test-dist/physics/ActiveRagdollMotion.js';
import {
  FATAL_FALL_TERMINAL_REST_HOLD_SECONDS,
  FATAL_FALL_TERMINAL_REST_MIN_SECONDS,
  FINAL_RELAX_START_SECONDS,
  FINAL_SETTLE_START_SECONDS,
  fatalFallTerminalRestEligible,
  ragdollFinalRelaxationEnvelope,
  ragdollFinalSupportRelease,
  ragdollLegScissorClosure,
} from '../.movement-test-dist/physics/RagdollFinalSettling.js';
import { damageVisualState, ragdollBodyImpactPart, ragdollDropIsFatal, ragdollImpactDamage, ragdollImpactNeedsBlood } from '../.movement-test-dist/dev/DamageSystem.js';
import {
  FIRST_PERSON_BODY_LOOK_TUNING,
  firstPersonIdleTurnCue,
  updateFirstPersonBodyFollow,
} from '../.movement-test-dist/dev/FirstPersonLook.js';

test('movement tuning is internally coherent', () => {
  assert.deepEqual(validateMovementTuning(MOVEMENT_TUNING), []);
  assert.ok(MOVEMENT_TUNING.locomotion.sprintSpeed > MOVEMENT_TUNING.locomotion.walkSpeed);
  assert.ok(MOVEMENT_TUNING.locomotion.lowSpeed < MOVEMENT_TUNING.locomotion.crouchSpeed);
  assert.ok(MOVEMENT_TUNING.slide.minStartSpeed < MOVEMENT_TUNING.locomotion.sprintSpeed);
  assert.ok(MOVEMENT_TUNING.locomotion.sprintForwardMin > 0, 'sprint must require forward intent');
  assert.ok(MOVEMENT_TUNING.locomotion.sprintStrafeScale < 1, 'sprint lateral authority must be reduced');
});

test('forward+strafe is biased toward forward while pure strafes and reverse diagonals stay untouched', () => {
  const scale = MOVEMENT_TUNING.locomotion.forwardDiagonalStrafeScale;
  assert.ok(scale > 0.55 && scale < 0.75, 'diagonal lateral authority should stay readable but clearly below 45 degrees');

  const forwardLeft = forwardBiasedDiagonalAxes(1, -1, scale);
  const forwardRight = forwardBiasedDiagonalAxes(1, 1, scale);
  assert.deepEqual(forwardLeft, { forward: 1, right: -scale });
  assert.deepEqual(forwardRight, { forward: 1, right: scale });
  assert.ok(Math.atan2(Math.abs(forwardRight.right), forwardRight.forward) < Math.PI / 4);

  assert.deepEqual(forwardBiasedDiagonalAxes(0, 1, scale), { forward: 0, right: 1 }, 'pure strafe must remain pure');
  assert.deepEqual(forwardBiasedDiagonalAxes(-1, 1, scale), { forward: -1, right: 1 }, 'backward diagonals are not part of this forward-bias change');

  const controller = readFileSync(new URL('../src/player/PlayerController.ts', import.meta.url), 'utf8');
  assert.match(controller, /forwardBiasedDiagonalAxes/);
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /diagonalStrafeHeadCorrectionDegrees/);
  assert.match(lab, /Math\.abs\(travelRight\) > 0\.54/);
});

test('forward diagonal locomotion has dedicated walk/run animation states', async () => {
  const { forwardDiagonalAnimation } = await import('../.movement-test-dist/dev/DirectionalLocomotionRules.js');
  assert.equal(forwardDiagonalAnimation(1, -1, false), 'walking-forward-left');
  assert.equal(forwardDiagonalAnimation(1, 1, false), 'walking-forward-right');
  assert.equal(forwardDiagonalAnimation(1, -1, true), 'running-forward-left');
  assert.equal(forwardDiagonalAnimation(1, 1, true), 'running-forward-right');
  assert.equal(forwardDiagonalAnimation(0, 1, false), null, 'pure strafe keeps its authored strafe animation');
  assert.equal(forwardDiagonalAnimation(-1, 1, true), null, 'reverse diagonal is intentionally unchanged');

  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const layers = readFileSync(new URL('../src/dev/CombatAnimationLayers.ts', import.meta.url), 'utf8');
  assert.match(lab, /prepareDirectionalLocomotionAnimations\(\)/);
  assert.match(lab, /walking-forward-left/);
  assert.match(lab, /walking-forward-right/);
  assert.match(lab, /running-forward-left/);
  assert.match(lab, /running-forward-right/);
  assert.match(layers, /createDirectionalLocomotionBlendClip/);
  assert.match(layers, /lowerBodyLateralWeight/);
  assert.match(layers, /upperBodyLateralWeight/);
});

test('walk is slightly slower and speed camera effects are sprint-only', () => {
  assert.equal(MOVEMENT_TUNING.locomotion.walkSpeed, 3.0);
  const controller = readFileSync(new URL('../src/player/PlayerController.ts', import.meta.url), 'utf8');
  assert.match(controller, /Walking keeps the bodycam motion\/bob, but speed-specific camera effects/);
  assert.match(controller, /if \(this\.sprinting\) \{/);
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /if \(!state\.sprinting\) \{/);
  assert.match(lab, /speed blur is a sprint-only cue|Walking keeps natural bob\/inertia but no speed blur/);
});

test('acceleration helper preserves inertia instead of snapping to target velocity', () => {
  const firstTick = moveTowards2D(
    0,
    0,
    0,
    -MOVEMENT_TUNING.locomotion.sprintSpeed,
    MOVEMENT_TUNING.locomotion.sprintAcceleration / 60,
  );
  assert.ok(Math.hypot(firstTick.x, firstTick.z) > 0);
  assert.ok(Math.hypot(firstTick.x, firstTick.z) < 1);

  const stopTick = moveTowards2D(
    0,
    -MOVEMENT_TUNING.locomotion.sprintSpeed,
    0,
    0,
    MOVEMENT_TUNING.locomotion.groundDeceleration / 60,
  );
  assert.ok(Math.abs(stopTick.z) > MOVEMENT_TUNING.locomotion.sprintSpeed - 0.5);
});

test('camera-forward and sprint heading use one yaw and discard obsolete sideways momentum', () => {
  const turnStep = MOVEMENT_TUNING.locomotion.sprintAcceleration / 60;
  const turned = moveSpeedAlongDirection2D(
    0,
    -MOVEMENT_TUNING.locomotion.sprintSpeed,
    1,
    0,
    MOVEMENT_TUNING.locomotion.sprintSpeed,
    turnStep,
  );
  assert.ok(Math.abs(turned.z) < 1e-9, 'old world-space heading must not survive a sprint turn');
  assert.ok(turned.x > 0 && turned.x <= turnStep + 1e-9, 'a 90° turn must rebuild speed instead of teleporting the old magnitude sideways');

  const reversed = moveSpeedAlongDirection2D(
    0,
    -MOVEMENT_TUNING.locomotion.sprintSpeed,
    0,
    1,
    MOVEMENT_TUNING.locomotion.sprintSpeed,
    turnStep,
  );
  assert.ok(reversed.z > 0 && reversed.z <= turnStep + 1e-9, 'a 180° turn must brake old momentum before accelerating forward again');

  for (const yaw of [0, Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI * 2, Math.PI * 3.5, -Math.PI * 2.5]) {
    const basis = movementBasisFromYaw(yaw);
    assert.ok(Math.abs(Math.hypot(basis.forward.x, basis.forward.z) - 1) < 1e-9);
    assert.ok(Math.abs(Math.hypot(basis.right.x, basis.right.z) - 1) < 1e-9);
    assert.ok(Math.abs(basis.forward.x * basis.right.x + basis.forward.z * basis.right.z) < 1e-9);
    assert.ok(Math.abs(basis.forward.x + Math.sin(yaw)) < 1e-9);
    assert.ok(Math.abs(basis.forward.z + Math.cos(yaw)) < 1e-9);
  }

  const controller = readFileSync(new URL('../src/player/PlayerController.ts', import.meta.url), 'utf8');
  assert.match(controller, /movementBasisFromYaw\(this\.continuousAimYaw\)/, 'movement must use the same unbounded yaw as 3P body following');
  assert.doesNotMatch(controller.slice(controller.indexOf('private updateBasis'), controller.indexOf('private buildInputDirection')), /controls\.getDirection/, 'movement basis must not use a separate quaternion extraction path');
  assert.match(controller, /moveSpeedAlongDirection2D/);
});

test('sprint release decelerates more gradually than an input release stop', () => {
  assert.ok(MOVEMENT_TUNING.locomotion.sprintReleaseDeceleration < MOVEMENT_TUNING.locomotion.groundDeceleration);
  const releaseTick = moveTowards2D(
    0,
    -MOVEMENT_TUNING.locomotion.sprintSpeed,
    0,
    -MOVEMENT_TUNING.locomotion.walkSpeed,
    MOVEMENT_TUNING.locomotion.sprintReleaseDeceleration / 60,
  );
  const stopTick = moveTowards2D(
    0,
    -MOVEMENT_TUNING.locomotion.sprintSpeed,
    0,
    0,
    MOVEMENT_TUNING.locomotion.groundDeceleration / 60,
  );
  assert.ok(Math.abs(releaseTick.z) > Math.abs(stopTick.z));
});

test('direction severity distinguishes straight, perpendicular and reversal inputs', () => {
  assert.equal(directionChangeSeverity(0, -1, 0, -1), 0);
  assert.ok(Math.abs(directionChangeSeverity(0, -1, 1, 0) - 0.5) < 1e-9);
  assert.equal(directionChangeSeverity(0, -1, 0, 1), 1);
});

test('camera/body smoothing and speed normalization remain bounded', () => {
  const smoothing = expSmoothing(1 / 60, MOVEMENT_TUNING.camera.bodyLagResponse);
  assert.ok(smoothing > 0 && smoothing < 1);
  assert.equal(normalizedSpeed(0, 3, 7), 0);
  assert.equal(normalizedSpeed(9, 3, 7), 1);
  assert.ok(MOVEMENT_TUNING.camera.maxTurnYawKick < 0.02, 'turn kick must stay subtle enough for precise aim');
  assert.ok(MOVEMENT_TUNING.camera.bodyLagResponse < 9, 'bodycam should keep a slightly looser positional lag');
  assert.ok(MOVEMENT_TUNING.camera.bobSprint > 0.045, 'sprint bodycam should read more organically');
});

test('A/E dedicated lean axis is additive, cancellable and bodycam-bounded', () => {
  assert.equal(manualLeanAxis(true, false), -1);
  assert.equal(manualLeanAxis(false, true), 1);
  assert.equal(manualLeanAxis(true, true), 0);
  assert.equal(manualLeanAxis(false, false), 0);
  assert.ok(MOVEMENT_TUNING.camera.manualLeanAngleRadians < 0.12, 'lean roll must stay readable without becoming arcade-like');
  assert.ok(MOVEMENT_TUNING.camera.manualLeanMeters < 0.12, 'lean camera shift must stay tight to the player capsule');
  assert.ok(MOVEMENT_TUNING.camera.manualLeanReturnResponse > MOVEMENT_TUNING.camera.manualLeanResponse);
});

test('slide exits directly into crouch movement while sprint/stand and jump spam stay gated', () => {
  assert.equal(MOVEMENT_TUNING.posture.postSpecialRiseLockDuration, 0.22);
  assert.equal(MOVEMENT_TUNING.locomotion.jumpGroundRearmSeconds, 0.24);
  assert.ok(MOVEMENT_TUNING.slide.repeatCooldown > 0.2);
  const controller = readFileSync(new URL('../src/player/PlayerController.ts', import.meta.url), 'utf8');
  const endSlide = controller.slice(controller.indexOf('private endSlide'), controller.indexOf('private enterLowPosture'));
  assert.match(endSlide, /this\.lowPosture = false/);
  assert.match(endSlide, /this\.crouchRequested = true/);
  assert.match(endSlide, /this\.physics\.setCrouched\(true\)/);
  assert.match(controller, /jumpGroundRearmTimer/);
  assert.match(controller, /jumpGroundRearmSeconds/);
});

test('Movement Lab is compact and gives every differently-sized hole its own floor and direct return stairs', () => {
  const plan = createMovementLabPlan();
  const ids = plan.colliders.map((collider) => collider.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('stairs-01'));
  assert.ok(ids.includes('stairs-platform'));
  assert.ok(ids.includes('impact-low'));
  assert.ok(ids.includes('impact-high'));
  assert.ok(!ids.includes('fall-pit-bottom'), 'there must not be one giant under-map floor');
  const bottoms = plan.colliders.filter((collider) => collider.id.startsWith('pit-bottom-'));
  assert.equal(bottoms.length, plan.floorOpenings?.length ?? 0, 'every opening needs one isolated textured bottom');
  assert.ok(bottoms.length >= 5, 'lab should expose several actual fall holes');
  const openingSizes = new Set((plan.floorOpenings ?? []).map((opening) => `${opening.maxX - opening.minX}x${opening.maxZ - opening.minZ}`));
  assert.ok(openingSizes.size >= 3, 'holes should have visibly different sizes');
  for (const bottom of bottoms) {
    const suffix = bottom.id.slice('pit-bottom-'.length);
    assert.ok(ids.some((id) => id.startsWith(`pit-stair-${suffix}-`)), `${suffix} pit needs direct return stairs`);
  }
  assert.ok(plan.size <= 36, 'lab should stay substantially smaller than the old test arena');
  assert.deepEqual(plan.spawn, MOVEMENT_LAB_SPAWN);
  const npcOverOpening = (plan.floorOpenings ?? []).some((opening) => (
    MOVEMENT_LAB_IDLE_NPC.x > opening.minX && MOVEMENT_LAB_IDLE_NPC.x < opening.maxX
    && MOVEMENT_LAB_IDLE_NPC.z > opening.minZ && MOVEMENT_LAB_IDLE_NPC.z < opening.maxZ
  ));
  assert.equal(npcOverOpening, false, 'idle mannequin must spawn on intact flat floor');
  for (const collider of plan.colliders) {
    assert.ok(Object.values(collider.center).every(Number.isFinite));
    assert.ok(Object.values(collider.halfExtents).every((value) => Number.isFinite(value) && value > 0));
  }
});



test('pit-edge balance risk catches careless edge movement but leaves the stair entrance safe', () => {
  const medium = MOVEMENT_LAB_PITS.find((pit) => pit.id === 'medium');
  assert.ok(medium);
  const base = {
    y: 0.865,
    velocityY: 0,
    grounded: true,
    falling: false,
    fallDistance: 0,
    viewX: 0,
    viewZ: -1,
    viewPitchDegrees: 0,
    manualLean: 0,
    crouching: false,
    lowPosture: false,
  };

  const skimming = analyzePitEdge({
    ...base,
    x: medium.minX - 0.09,
    z: (medium.minZ + medium.maxZ) * 0.5,
    velocityX: 0,
    velocityZ: 2.4,
  }, MOVEMENT_LAB_PITS);
  assert.ok(skimming && !skimming.safeStairEntry);
  assert.ok(skimming.riskRate > 0.25, 'uncommanded fast drift parallel to a close edge should build instability');
  let risk = 0;
  for (let frame = 0; frame < 180 && risk < PIT_EDGE_RAGDOLL_THRESHOLD; frame += 1) {
    risk = integratePitEdgeRisk(risk, skimming, 1 / 60);
  }
  assert.equal(risk, PIT_EDGE_RAGDOLL_THRESHOLD, 'lingering close to the edge must eventually lose balance');

  const safeStair = analyzePitEdge({
    ...base,
    x: (medium.minX + medium.maxX) * 0.5,
    z: medium.minZ - 0.08,
    velocityX: 0,
    velocityZ: 1.6,
  }, MOVEMENT_LAB_PITS);
  assert.ok(safeStair?.safeStairEntry, 'the authored stair mouth must be recognized');
  assert.equal(safeStair?.riskRate, 0, 'walking normally onto the stairs must not trigger an edge ragdoll');
});


test('leaning the body over a close pit edge builds balance risk even while standing still', () => {
  const small = MOVEMENT_LAB_PITS.find((pit) => pit.id === 'small');
  assert.ok(small);
  const leaning = analyzePitEdge({
    x: small.minX - 0.11,
    y: 0.865,
    z: (small.minZ + small.maxZ) * 0.5,
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
    grounded: true,
    falling: false,
    fallDistance: 0,
    viewX: 0,
    viewZ: -1,
    viewPitchDegrees: -28,
    manualLean: 1,
    crouching: false,
    lowPosture: false,
  }, MOVEMENT_LAB_PITS);
  assert.ok(leaning);
  assert.ok(leaning.leanExposure > 0.5, 'a deliberate body lean whose probe crosses the edge must be visible to the risk model');
  assert.ok(leaning.riskRate > 0.3, 'an extreme sustained body lean can still become unsafe, but should be slower-burn');
});

test('stepping into a real opening hands the fall to ragdoll after a small committed drop', () => {
  const small = MOVEMENT_LAB_PITS.find((pit) => pit.id === 'small');
  assert.ok(small);
  const falling = analyzePitEdge({
    x: (small.minX + small.maxX) * 0.5,
    y: 0.58,
    z: (small.minZ + small.maxZ) * 0.5,
    velocityX: 0.5,
    velocityY: -2.1,
    velocityZ: 1.1,
    grounded: false,
    falling: true,
    fallDistance: 0.34,
    viewX: 0,
    viewZ: -1,
    viewPitchDegrees: 0,
    manualLean: 0,
    crouching: false,
    lowPosture: false,
  }, MOVEMENT_LAB_PITS);
  assert.ok(falling?.inside);
  assert.equal(falling?.immediate, true);
  assert.equal(integratePitEdgeRisk(0, falling, 1 / 60), PIT_EDGE_RAGDOLL_THRESHOLD);
});



test('a deliberate jump stays animated instead of becoming an edge ragdoll', () => {
  const small = MOVEMENT_LAB_PITS.find((pit) => pit.id === 'small');
  assert.ok(small);
  const jumping = analyzePitEdge({
    x: (small.minX + small.maxX) * 0.5,
    y: 0.54,
    z: (small.minZ + small.maxZ) * 0.5,
    velocityX: 1.4,
    velocityY: -2.4,
    velocityZ: 0,
    grounded: false,
    falling: true,
    fallDistance: 0.34,
    viewX: 1,
    viewZ: 0,
    viewPitchDegrees: 0,
    manualLean: 0,
    crouching: false,
    lowPosture: false,
    inputForward: 1,
    inputRight: 0,
    jumpGraceSeconds: 0.9,
    controlGraceSeconds: 0,
  }, MOVEMENT_LAB_PITS);
  assert.ok(jumping?.inside);
  assert.equal(jumping?.controlledApproach, true);
  assert.equal(jumping?.immediate, false);
  assert.equal(jumping?.riskRate, 0);
});

test('looking down and deliberately walking into a drop is treated as a controlled descent', () => {
  const small = MOVEMENT_LAB_PITS.find((pit) => pit.id === 'small');
  assert.ok(small);
  const approach = analyzePitEdge({
    x: small.minX - 0.08,
    y: 0.865,
    z: (small.minZ + small.maxZ) * 0.5,
    velocityX: 1.45,
    velocityY: 0,
    velocityZ: 0,
    grounded: true,
    falling: false,
    fallDistance: 0,
    viewX: 1,
    viewZ: 0,
    viewPitchDegrees: -28,
    manualLean: 0,
    crouching: false,
    lowPosture: false,
    inputForward: 1,
    inputRight: 0,
    jumpGraceSeconds: 0,
    controlGraceSeconds: 0,
  }, MOVEMENT_LAB_PITS);
  assert.ok(approach && !approach.safeStairEntry);
  assert.equal(approach.controlledApproach, true);
  assert.equal(approach.refreshControlGrace, true);
  assert.equal(approach.riskRate, 0);

  const committedDrop = analyzePitEdge({
    x: small.minX + 0.22,
    y: 0.56,
    z: (small.minZ + small.maxZ) * 0.5,
    velocityX: 1.1,
    velocityY: -2.2,
    velocityZ: 0,
    grounded: false,
    falling: true,
    fallDistance: 0.31,
    viewX: 1,
    viewZ: 0,
    viewPitchDegrees: -30,
    manualLean: 0,
    crouching: false,
    lowPosture: false,
    inputForward: 1,
    inputRight: 0,
    jumpGraceSeconds: 0,
    controlGraceSeconds: 0.8,
  }, MOVEMENT_LAB_PITS);
  assert.ok(committedDrop?.inside);
  assert.equal(committedDrop?.controlledApproach, true);
  assert.equal(committedDrop?.immediate, false);
});

test('clean intentional movement parallel to a pit lip does not randomly ragdoll', () => {
  const medium = MOVEMENT_LAB_PITS.find((pit) => pit.id === 'medium');
  assert.ok(medium);
  const controlledSkim = analyzePitEdge({
    x: medium.minX - 0.09,
    y: 0.865,
    z: (medium.minZ + medium.maxZ) * 0.5,
    velocityX: 0,
    velocityY: 0,
    velocityZ: 2.3,
    grounded: true,
    falling: false,
    fallDistance: 0,
    viewX: 0,
    viewZ: 1,
    viewPitchDegrees: 0,
    manualLean: 0,
    crouching: false,
    lowPosture: false,
    inputForward: 1,
    inputRight: 0,
    jumpGraceSeconds: 0,
    controlGraceSeconds: 0,
  }, MOVEMENT_LAB_PITS);
  assert.ok(controlledSkim && !controlledSkim.safeStairEntry);
  assert.equal(controlledSkim.controlledApproach, true);
  assert.equal(controlledSkim.riskRate, 0);
});

test('pit ragdoll damage hurts shallow tumbles without making every fall lethal', () => {
  assert.ok(pitRagdollDamageForDrop(0.3) > 0);
  assert.ok(pitRagdollDamageForDrop(1.2) < 25);
  assert.ok(pitRagdollDamageForDrop(4.2) < 100, 'ordinary lab pits should be survivable from full health');
  assert.ok(pitRagdollDamageForDrop(12.6) >= 100, 'the deep shaft should remain capable of killing');
  assert.ok(pitRagdollDamageForDrop(4) > pitRagdollDamageForDrop(2));
});

test('non-lethal pit ragdolls stay down instead of using the death respawn timer', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /ragdollMode === 'dead'/);
  assert.match(lab, /Surviving pit tumbles deliberately stay down/);
  assert.match(lab, /pitRagdollDamageForDrop/);
  assert.match(lab, /addedVelocity: this\.pitRagdollExtraVelocity/);
  assert.match(lab, /RAGDOLL · PERTE D’ÉQUILIBRE/);
});

test('site launches the integrated movement + animation lab directly', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(main, /startIntegratedLab/);
  assert.match(main, /AnimationLab/);
  assert.doesNotMatch(main, /movement-lab=1|animation-lab=1/);
});

test('third-person look supports a wide stationary glance without angle-wrap spins', () => {
  assert.ok(THIRD_PERSON_LOOK_TUNING.headLimitDegrees >= 84);
  assert.ok(THIRD_PERSON_LOOK_TUNING.headLimitDegrees < THIRD_PERSON_LOOK_TUNING.idleTurnStartDegrees);
  assert.equal(updateTurnGate(80, false, false, false), false, 'stationary glance should stay in upper body/head');
  assert.equal(updateTurnGate(90, false, false, false), true, 'body follows only past the wide stationary look arc');
  assert.equal(updateTurnGate(20, false, true, false), true, 'moving player should realign body much earlier');
  assert.equal(updateTurnGate(4, true, true, false), false, 'moving hysteresis must settle near forward');
  const almostPi = Math.PI - 0.02;
  const smoothed = dampAngleRadians(almostPi, -almostPi, 0.5);
  assert.ok(Math.abs(wrapAngleRadians(smoothed - Math.PI)) < 0.05, 'angle damping must take the short path across ±π');
});

test('authored idle turns use normal/big tiers and only fire on strong stationary reorientation', () => {
  assert.ok(THIRD_PERSON_LOOK_TUNING.authoredTurnStartDegrees > THIRD_PERSON_LOOK_TUNING.idleTurnStartDegrees);
  assert.ok(THIRD_PERSON_LOOK_TUNING.authoredBigTurnStartDegrees > THIRD_PERSON_LOOK_TUNING.authoredTurnStartDegrees);
  assert.equal(strongTurnDirection(95, false, false, false), null, 'wide glance must not fire a turn clip');
  assert.equal(strongTurnDirection(118, false, false, false), 'right');
  assert.equal(strongTurnDirection(-118, false, false, false), 'left');
  assert.equal(strongTurnDirection(155, false, false, false), 'big-right');
  assert.equal(strongTurnDirection(-155, false, false, false), 'big-left');
  assert.equal(strongTurnDirection(160, true, false, false), null, 'latched turn cannot retrigger');
  assert.equal(strongTurnDirection(160, false, true, false), null, 'locomotion must stay procedural');
  assert.equal(strongTurnDirection(160, false, false, true), null, 'crouch must keep its flexible head look');
  assert.ok(THIRD_PERSON_LOOK_TUNING.authoredTurnMinSeconds >= 0.4);
  assert.ok(THIRD_PERSON_LOOK_TUNING.authoredBigTurnMinBodyDegrees >= 45);
  assert.ok(THIRD_PERSON_LOOK_TUNING.authoredTurnResidualDegrees <= 10, 'committed turns must nearly align the body to the view');
  assert.equal(canResetStrongTurnLatch(THIRD_PERSON_LOOK_TUNING.authoredTurnResetDegrees), true);
});

test('sprint keeps limited Q/D steering, rises from crouch, and dive is fully removed', () => {
  const controller = readFileSync(new URL('../src/player/PlayerController.ts', import.meta.url), 'utf8');
  assert.match(controller, /buildInputDirection\(diagonalAxes\.forward, movementRightAxis\)/);
  assert.doesNotMatch(controller, /sprintLaunchLocksStrafe/);
  assert.match(controller, /tryStandFromCrouch\(true\)/);
  assert.match(controller, /startSlide\(/);
  assert.match(controller, /crouchRequested/);
  assert.match(controller, /postSpecialRiseLockTimer/);
  assert.doesNotMatch(controller, /startDive|diveActive|MOVEMENT_TUNING\.dive/);
  const config = readFileSync(new URL('../src/player/MovementConfig.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(config, /\bdive\s*:/);
});


test('sprint is forward-only and keeps reduced lateral steering', () => {
  const controller = readFileSync(new URL('../src/player/PlayerController.ts', import.meta.url), 'utf8');
  assert.match(controller, /const sprintRequested = !this\.sprintSuppressed[\s\S]*axes\.sprint[\s\S]*axes\.forward >= MOVEMENT_TUNING\.locomotion\.sprintForwardMin/);
  assert.match(controller, /movementRightAxis = sprintRequested[\s\S]*axes\.right \* MOVEMENT_TUNING\.locomotion\.sprintStrafeScale/);
  assert.match(controller, /this\.sprinting = sprintRequested/);
  assert.ok(MOVEMENT_TUNING.locomotion.sprintForwardMin >= 0.4);
  assert.ok(MOVEMENT_TUNING.locomotion.sprintStrafeScale <= 0.65);
});

test('first-person crouch walk has presentation-only recentering', () => {
  const source = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(source, /FIRST_PERSON_CROUCH_WALK_OFFSET_RIGHT = -0\.065/);
  assert.match(source, /FIRST_PERSON_CROUCH_WALK_YAW_CORRECTION/);
  assert.match(source, /this\.currentAnimation === 'crouch-walking'/);
  assert.match(source, /this\.firstPersonCrouchWalkBlend/);
});

test('continuous yaw survives repeated ±π crossings without reversing turn direction', () => {
  let yaw = Math.PI - 0.08;
  const samples = [-Math.PI + 0.02, -Math.PI + 0.12, -Math.PI + 0.22, -Math.PI + 0.32];
  const unwrapped = [];
  for (const wrapped of samples) {
    yaw = unwrapAngleRadians(yaw, wrapped);
    unwrapped.push(yaw);
  }
  for (let i = 1; i < unwrapped.length; i += 1) {
    assert.ok(unwrapped[i] > unwrapped[i - 1], 'same-direction mouse turn must stay monotonic across the branch cut');
  }
  assert.ok(unwrapped.at(-1) > Math.PI, 'continuous yaw must be allowed past +π');
});

test('animation uses travel velocity, direct slide-to-crouch-walk and no sprint-strafe clips', () => {
  const controller = readFileSync(new URL('../src/player/PlayerController.ts', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(controller, /getMovementIntent\(\)/);
  assert.doesNotMatch(controller, /locomotionInputScale|setLocomotionInputScale/, 'animation code must never scale or buffer locomotion input');
  assert.match(controller, /buildInputDirection\(diagonalAxes\.forward, movementRightAxis\)/, 'ZQSD must feed camera-relative movement after the forward-diagonal and sprint lateral shaping');
  assert.match(source, /const intent = this\.player\.getMovementIntent\(\)/);
  assert.match(source, /const crouchMoveIntent = Math\.abs\(intent\.forward\) > 0\.05 \|\| Math\.abs\(intent\.right\) > 0\.05/);
  assert.match(source, /const sprintFacingReady = this\.visualRunning && bodyViewOffsetDegrees <= 62/);
  assert.match(source, /if \(sprintFacingReady\) \{[\s\S]*id = 'running'/, 'aligned sprint must keep the normal running clip');
  assert.match(source, /state\.sprinting && bodyCatchupActive[\s\S]*id = 'walking'[\s\S]*reverse = forwardSpeed < -0\.12/, 'rear-facing sprint start must keep animated backward footwork while the body catches up');
  assert.doesNotMatch(source, /id: 'left-strafe'.*sprint|id: 'right-strafe'.*sprint/, 'bad sprint-strafe clips must not be exposed');
  assert.match(source, /const lateralIntent = Math\.abs\(travelRight\) > 0\.54/);
  assert.match(source, /airborneAnimationRate/);
  assert.match(source, /expectedAirSeconds/);
});

test('Animation Lab reuses PlayerController and PhysicsWorld and ships the locomotion FBX pack', () => {
  const source = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(source, /new PlayerController\(/);
  assert.match(source, /PhysicsWorld\.create\(/);
  assert.doesNotMatch(source, /new InputManager\(/, 'Animation Lab must not create a second movement input system');
  assert.match(source, /AUTO LOCOMOTION/);
  assert.match(source, /1ST PERSON/);
  assert.match(source, /3RD PERSON/);
  assert.match(source, /applyHeadLook/);
  assert.match(source, /bodyTurning/);
  assert.match(source, /forceAnimation/);
  assert.match(source, /chooseAirborneAnimation/);
  assert.match(source, /'jumping-up'/);
  assert.match(source, /'running-slide'/);
  assert.match(source, /'crouch-idle'/);
  assert.match(source, /const lateralIntent = Math\.abs\(travelRight\) > 0\.54/);
  assert.match(source, /const strafeRight = travelRight > 0/);
  assert.match(source, /id = strafeRight \? 'right-strafe-walking' : 'left-strafe-walking'/);
  assert.doesNotMatch(source, /id: 'left-strafe'.*sprint|id: 'right-strafe'.*sprint/);
  assert.match(source, /slideRecoveryTiming/);
  assert.doesNotMatch(source, /runningSafeCutoff/, 'running.fbx must remain complete');
  assert.match(source, /slideVisualSettled/);
  assert.match(source, /crouch-strafe-right' \? Math\.PI/);
  assert.match(source, /dampAngleRadians/);
  assert.match(source, /upperSpineBone/);
  assert.match(source, /strongTurnDirection/);
  assert.match(source, /'idle-big-turn-left'/);
  assert.match(source, /authoredTurnMustHold/);
  const turnMethod = source.slice(source.indexOf('private startAuthoredTurn'), source.indexOf('private currentAutoOneShotStillPlaying'));
  assert.doesNotMatch(turnMethod, /setLocomotionInputScale/, 'authored turns must never alter player movement');
  assert.match(turnMethod, /footwork has become readable/);
  assert.match(source, /authoredTurnResidualDegrees/, 'authored turns must override the wide stationary residual');
  assert.match(source, /slideRecoveryBlendStart/);
  assert.match(source, /IDLE_ACTION_WAIT_DELAY_SECONDS = 2\.5/);
  assert.match(source, /IDLE_SLEEPING_LOOK_INTERVAL_SECONDS = 5\.0/);
  assert.match(source, /IDLE_TO_STANDING_RATE = 0\.72/);
  assert.match(source, /'idle-looking'.*'idle-looking-down'.*'idle-looking-behind'/s);
  assert.match(source, /Math\.random\(\) < 0\.5 \? 'idle-wait-1' : 'idle-wait-2'/);
  assert.match(source, /idleSequencePhase === 'sleeping'.*IDLE_SLEEPING_LOOK_INTERVAL_SECONDS.*pickIdleLookAnimation\(\)/s);
  assert.match(source, /idleSequencePhase === 'action'.*IDLE_ACTION_WAIT_DELAY_SECONDS.*idle-wait-1.*idle-wait-2/s);
  assert.match(source, /'idle-action-to-standing-idle'/);
  assert.match(source, /airborneId === 'jumping-up' \? 'sleeping' : 'action'/);
  assert.doesNotMatch(source, /state\.diving|chooseAirborneAnimation\([^)]*diving/);

  const files = [
    'character.fbx', 'idle.fbx', 'idle-action.fbx', 'looking.fbx', 'looking-down.fbx', 'looking-behind.fbx', 'idle-action-wait-1.fbx', 'idle-action-wait-2.fbx', 'idle-action-to-standing-idle.fbx',
    'walking.fbx', 'running.fbx',
    'left-strafe-walking.fbx', 'right-strafe-walking.fbx',
    'crouch-idle.fbx', 'crouch-walking.fbx', 'crouch-strafe-left.fbx', 'crouch-strafe-right.fbx',
    'standing-to-crouched.fbx', 'crouched-to-standing.fbx',
    'jump.fbx', 'jumping-up.fbx', 'running-jump.fbx', 'jump-backward.fbx', 'running-slide.fbx',
    'falling-idle.fbx', 'falling-to-landing.fbx', 'falling-flat-impact.fbx',
    'idle-turn-left.fbx', 'idle-turn-right.fbx', 'idle-big-turn-left.fbx', 'idle-big-turn-right.fbx',
    'left-turn.fbx', 'right-turn.fbx', 'left-turn-90.fbx', 'right-turn-90.fbx',
  ];
  for (const file of files) {
    const url = new URL(`../public/assets/animation-lab/${file}`, import.meta.url);
    assert.ok(existsSync(url), `${file} must be bundled`);
    assert.ok(statSync(url).size > 100_000, `${file} must contain the real FBX blob`);
  }
  assert.equal(existsSync(new URL('../public/assets/animation-lab/falling.fbx', import.meta.url)), false, 'Fall High asset must be removed');
  assert.equal(existsSync(new URL('../public/assets/animation-lab/hard-landing.fbx', import.meta.url)), false, 'Hard Landing asset must not be bundled');
});

test('third-person aim stays mouse-authoritative and orbit smoothing cannot invert left/right', () => {
  const controller = readFileSync(new URL('../src/player/PlayerController.ts', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(controller, /getContinuousAimYawRadians\(\)/, 'PlayerController must expose its unbounded pointer yaw');
  assert.match(controller, /continuousAimYaw\s*-=/, 'raw mouse X must advance the unbounded aim yaw directly');
  assert.match(source, /Math\.PI \+ this\.player\.getContinuousAimYawRadians\(\)/, 'body and camera must follow pointer yaw without feeding back into it');
  assert.match(source, /cameraBoomLength/, 'third-person obstruction smoothing must be scalar-only');
  assert.doesNotMatch(source, /thirdPersonCamera\.position\.lerp\(/, 'world-space camera lerp can cross the player and visually invert mouse direction');
});

test('locomotion cancels turn-in-place but catches body facing up smoothly', () => {
  const source = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(source, /const movementIntentActive = Math\.abs\(intent\.forward\) > 0\.05 \|\| Math\.abs\(intent\.right\) > 0\.05/);
  assert.match(source, /if \(movementIntentActive\) \{[\s\S]*this\.clearAuthoredTurn\(\)[\s\S]*\}/, 'movement must cancel stationary authored turns');
  const movementBranch = source.slice(source.indexOf('if (movementIntentActive) {'), source.indexOf('let lookOffset =', source.indexOf('if (movementIntentActive) {')));
  assert.doesNotMatch(movementBranch, /this\.bodyYaw = aimBodyYaw/, 'movement must not snap the body to a rear-facing camera yaw');
  assert.match(source, /updateTurnGate\(absoluteOffsetDegrees, this\.bodyTurning, moving, sprinting\)/, 'moving body follow must use the normal turn gate');
  assert.match(source, /bodyCatchupActive/);
  assert.match(source, /travelRight = speed > 0\.32 \? rightSpeed \/ speed/);
  assert.match(source, /speed < 0\.08 && !standingMoveIntent/, 'held movement must not fall back to idle during the first acceleration frames');
  assert.match(source, /if \(standingMoveIntent && speed < 0\.24 && !isCycleLocomotionAnimation[\s\S]*this\.playAutoImmediate\(id, true, rate, reverse\)/, 'locomotion animation must start on the input frame');
  assert.match(source, /this\.autoOneShot && isTurnAnimation\(this\.autoOneShot\)[\s\S]*this\.autoOneShot = null/, 'movement must cancel a stationary turn clip immediately');
});

test('Backrooms-style lab keeps isolated climbable pits inside a small Level-0-like test slice', () => {
  const plan = createMovementLabPlan();
  const ids = plan.colliders.map((collider) => collider.id);
  const bottoms = plan.colliders.filter((collider) => collider.id.startsWith('pit-bottom-'));
  assert.ok(bottoms.some((bottom) => bottom.center.y < -8), 'one isolated shaft must remain deep enough for lethal high-fall tests');
  assert.ok((plan.floorOpenings?.length ?? 0) >= 5);
  assert.equal(plan.size, 36);
  assert.equal(plan.visualBiome, 'yellow');
  assert.equal(ids.filter((id) => id.startsWith('stairs-0')).length, 5);
  assert.equal(ids.filter((id) => id.startsWith('big-stair-')).length, 0);
  assert.ok(ids.filter((id) => id.startsWith('pit-stair-')).length > 80, 'each pit should have a direct climb from its own bottom');
  assert.equal(ids.filter((id) => id.startsWith('backrooms-partition-')).length, 4);
  assert.equal(ids.filter((id) => id.startsWith('backrooms-column-')).length, 4);

  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const atmosphere = readFileSync(new URL('../src/render/BackroomsAtmosphere.ts', import.meta.url), 'utf8');
  assert.match(lab, /pit-bottom-/);
  assert.match(lab, /BACKROOMS_ATMOSPHERE/);
  assert.match(lab, /BACKROOMS_LEGACY_ATMOSPHERE/);
  assert.match(atmosphere, /background: 0x282820/);
  assert.match(atmosphere, /fog: 0x555548/);
  assert.match(lab, /renderer\.shadowMap\.enabled = false/);
  assert.match(lab, /addBackroomsLabDecor/);
  assert.match(lab, /fluorescent-diffuser/);
  assert.match(lab, /backrooms-wallpaper-seamless\.webp/);
  assert.match(lab, /carpet-color-v2\.webp/);
  assert.match(lab, /ceiling-color\.webp/);
  assert.doesNotMatch(lab, /PlayerContactShadow|playerShadow/, 'the player must render with no fake contact shadow');
  assert.doesNotMatch(lab, /new THREE\.PointLight/, 'lab lighting must stay aligned with the shadowless production renderer');
  assert.doesNotMatch(lab, /railing-post|railing-bar/, 'the mechanics lab should stay visually rough instead of adding decorative railings around pit tests');
  assert.doesNotMatch(lab, /new THREE\.GridHelper/, 'debug grid should not dominate the Backrooms decor');
});

test('player shadow is removed completely while production-style lighting stays shadowless', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.equal(existsSync(new URL('../src/render/PlayerContactShadow.ts', import.meta.url)), false, 'contact-shadow implementation should be deleted');
  assert.doesNotMatch(lab, /PlayerContactShadow|playerShadow|updatePlayerShadow|findShadowGroundY/);
  assert.match(lab, /renderer\.toneMapping = THREE\.NoToneMapping/);
  assert.match(lab, /renderer\.shadowMap\.enabled = false/);
  assert.match(lab, /legacyLighting \? 0\.17 : 0\.14/);
  assert.match(lab, /legacyLighting \? 0\.018 : 0\.055/);
  assert.match(lab, /legacyLighting \? 0\.07 : 0\.22/);
});

test('small falls keep authored fall/landing while larger falls hand off to living ragdoll', () => {
  assert.ok(MOVEMENT_TUNING.locomotion.fallAirControlMin < 1);
  assert.ok(MOVEMENT_TUNING.locomotion.fallAirControlMin > 0);
  assert.ok(MOVEMENT_TUNING.locomotion.fallAnimationStartDistance > 0.7);
  assert.ok(MOVEMENT_TUNING.locomotion.highFallImpactDistance >= 8);
  assert.ok(MOVEMENT_TUNING.camera.fallPitchRadians < 0);

  const controller = readFileSync(new URL('../src/player/PlayerController.ts', import.meta.url), 'utf8');
  assert.match(controller, /fallDistance/);
  assert.match(controller, /airborneTime/);
  assert.match(controller, /fallAirControlMin/);
  assert.match(controller, /highFallImpactDistance/);
  assert.match(controller, /highFallImpactSpeed/);
  assert.match(controller, /setIncapacitated\(enabled: boolean\)/);
  assert.match(controller, /if \(this\.incapacitated\)/);
  assert.match(controller, /movementMode: this\.getMovementMode\(\)/);

  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /'falling-idle'/);
  assert.match(lab, /'falling-to-landing'/);
  assert.doesNotMatch(lab, /id: 'hard-landing'/);
  assert.match(lab, /'falling-flat-impact'/);
  assert.match(lab, /severeImpactLocked/);
  assert.match(lab, /this\.player\?\.setIncapacitated\(true\)/);
  assert.match(lab, /const needsRecovery = impact\.fallDistance/);
  assert.match(lab, /const ragdollLanding = damage >= RAGDOLL_LANDING_DAMAGE_THRESHOLD/);
  assert.match(lab, /status: 'RAGDOLL · RÉCEPTION LOURDE'/);
  assert.match(lab, /const landingId: AnimationId = 'falling-to-landing'/);
  assert.match(lab, /this\.landingAnimationPending = landingId/);
  assert.match(lab, /state\.incapacitated/);
  assert.match(lab, /this\.playbackMode = 'auto'/, 'heavy landing must override any manually forced clip');
  assert.match(lab, /this\.killPlayer\(\{ quietStart: true \}\)/, 'heavy impact should hand its final floor pose to a quiet ragdoll');
  assert.match(lab, /event\.code !== 'KeyP'/, 'P must be the kill shortcut');
  assert.match(lab, /mesh\.frustumCulled = false/, 'ragdolled skinned meshes must remain visible after bones leave the original FBX bounds');
  assert.match(lab, /material\.transparent = false[\s\S]*material\.opacity = 1[\s\S]*material\.depthWrite = true/);
  assert.match(lab, /tipScale: quietStart \|\| options\.meleeImpact \? 0/);
  assert.match(lab, /variationScale: quietStart/);

  const ragdoll = readFileSync(new URL('../src/physics/RagdollSystem.ts', import.meta.url), 'utf8');
  assert.match(ragdoll, /if \(this\.quietStart\) this\.sleepExactCapturedPose\(\)/, 'finished impact pose must not receive a second physics impact');
  assert.match(ragdoll, /body\.sleep\(\)/, 'quiet impact ragdoll should begin asleep in the exact captured pose');
});


test('high-fall threshold now starts living ragdoll well before lethal height', () => {
  assert.ok(MOVEMENT_TUNING.locomotion.highFallImpactDistance >= 11, 'full-health lethal height should stay high');
  assert.ok(
    MOVEMENT_TUNING.locomotion.highFallAnimationStartDistance <= MOVEMENT_TUNING.locomotion.highFallImpactDistance * 0.5,
    'the former high-fall visual threshold should become ragdoll before lethal height',
  );
  assert.ok(
    MOVEMENT_TUNING.locomotion.highFallAnimationStartSpeed < MOVEMENT_TUNING.locomotion.highFallImpactSpeed,
    'high-fall ragdoll speed gate must precede the lethal speed gate',
  );

  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /const highFallRagdoll = state\.falling/);
  assert.match(lab, /state\.fallDistance >= MOVEMENT_TUNING\.locomotion\.highFallAnimationStartDistance/);
  assert.match(lab, /state\.verticalSpeed <= -MOVEMENT_TUNING\.locomotion\.highFallAnimationStartSpeed/);
  assert.match(lab, /this\.startRagdoll\(\{ fatal: false, status: 'RAGDOLL · CHUTE IMPORTANTE' \}\)/);
  assert.doesNotMatch(lab, /id: 'falling'.*Fall · high/);

  const plan = createMovementLabPlan();
  const lethalBottom = plan.colliders.find((collider) => collider.id === 'pit-bottom-deep');
  assert.ok(lethalBottom, 'the lab should still keep one high-fall test shaft');
  const lethalBottomTop = lethalBottom.center.y + lethalBottom.halfExtents.y;
  assert.ok(
    -lethalBottomTop > MOVEMENT_TUNING.locomotion.highFallImpactDistance,
    'the deepest isolated shaft should still be tall enough to test a lethal ragdoll landing',
  );
});

test('respawn clears severe-impact state and starts from a clean idle', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const start = lab.indexOf('private respawnPlayer(): void');
  const end = lab.indexOf('private updateDeadFirstPersonCamera', start);
  const respawn = lab.slice(start, end);
  assert.match(respawn, /this\.severeImpactLocked = false/);
  assert.match(respawn, /this\.landingVisualImpulse = 0/);
  assert.match(respawn, /this\.landingAnimationPending = null/);
  assert.match(respawn, /this\.player\.setIncapacitated\(false\)/);
  assert.match(respawn, /this\.playAnimation\('idle', true, 1, false, true\)/);
});


test('first-person large falls switch to ragdoll instead of a Fall High body animation', () => {
  assert.ok(MOVEMENT_TUNING.camera.incapacitatedCameraDropMeters >= 1.3, 'downed camera must end near floor level');

  const controller = readFileSync(new URL('../src/player/PlayerController.ts', import.meta.url), 'utf8');
  assert.match(controller, /incapacitatedCameraDropMeters/);

  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /const highFallTarget = 0/);
  assert.doesNotMatch(lab, /this\.currentAnimation === 'falling' && state\.falling/);
  assert.match(lab, /status: 'RAGDOLL · CHUTE IMPORTANTE'/);
  assert.match(lab, /FIRST_PERSON_DOWNED_PELVIS_BELOW_CAMERA/);
});

test('non-lethal falls damage health, heavily slow landing movement, show a red vignette and regenerate later', () => {
  assert.ok(MOVEMENT_TUNING.locomotion.fallDamageStartDistance >= 2.5, 'tiny ledges and ordinary jumps should not deal damage');
  assert.ok(MOVEMENT_TUNING.locomotion.fallDamageStartImpactSpeed >= 9, 'small impact speeds should stay damage-free');
  assert.ok(MOVEMENT_TUNING.locomotion.fallDamageStartDistance < MOVEMENT_TUNING.locomotion.highFallImpactDistance);
  assert.ok(MOVEMENT_TUNING.locomotion.landingRecoveryMinDistance > MOVEMENT_TUNING.locomotion.fallAnimationStartDistance, 'landing recovery should not trigger on every ordinary jump');
  assert.ok(MOVEMENT_TUNING.locomotion.landingRecoveryMinSeconds <= 0.12, 'light landings must return control quickly');
  assert.ok(MOVEMENT_TUNING.locomotion.landingRecoveryMaxSeconds > MOVEMENT_TUNING.locomotion.landingRecoveryMinSeconds);

  const controller = readFileSync(new URL('../src/player/PlayerController.ts', import.meta.url), 'utf8');
  assert.match(controller, /beginLandingRecovery\(duration: number, strength: number\)/);
  assert.match(controller, /this\.velocity\.x \*= 0\.12[\s\S]*this\.velocity\.z \*= 0\.12/);
  assert.match(controller, /const landingDrag = Math\.exp/);
  assert.match(controller, /if \(this\.landingRecoveryTimer > 0\)/);
  assert.match(controller, /landingRecoveryBlend/);

  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /MAX_HEALTH = 100/);
  assert.match(lab, /HEALTH_REGEN_DELAY_SECONDS/);
  assert.match(lab, /HEALTH_REGEN_PER_SECOND/);
  assert.match(lab, /calculateFallDamage/);
  assert.match(lab, /this\.player\?\.beginLandingRecovery/);
  assert.match(lab, /this\.landingAnimationPending = landingId/);
  assert.match(lab, /landingAnimationEndFraction/);
  assert.match(lab, /Math\.max\(0\.08, effectiveLandingSeconds\)/, 'light landing recovery should end with the trimmed animation');
  assert.match(lab, /MOVEMENT_LAB_IDLE_NPC/, 'idle comparison character should use the tested safe-floor spawn');
  assert.match(lab, /animation-lab__damage-fx/);
  const css = readFileSync(new URL('../src/dev/AnimationLab.css', import.meta.url), 'utf8');
  assert.match(css, /animation-lab__damage-fx/);
  assert.match(css, /radial-gradient/);
  assert.doesNotMatch(css, /animation-lab__health/);
  assert.match(lab, /<span>SANTÉ<\/span><b data-stat="health">100 \/ 100<\/b>/, 'health stays in the right debug panel only');
});


test('persistent corpses expose stable support without dynamic limb collision', () => {
  const physics = readFileSync(new URL('../src/physics/PhysicsWorld.ts', import.meta.url), 'utf8');
  assert.match(physics, /PLAYER_COLLISION_GROUP = 0x1000/);
  assert.match(physics, /enableAutostep\(0\.38, 0\.10, false\)/, 'articulated limbs must never become moving autosteps');

  const ragdoll = readFileSync(new URL('../src/physics/RagdollSystem.ts', import.meta.url), 'utf8');
  assert.match(ragdoll, /setPlayerTraversalEnabled\(enabled: boolean\)/);
  assert.match(ragdoll, /PLAYER_COLLISION_GROUP/);
  assert.match(ragdoll, /nudgeFromPlayer/);
  assert.match(ragdoll, /ColliderDesc\.cuboid\(halfTorsoWidth, halfTorsoHeight, halfTorsoDepth\)/, 'rib cage should have broad passive resting faces');

  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /this\.ragdoll\.setPlayerTraversalEnabled\(true\)/, 'only the persistent corpse should opt into player traversal');
  assert.match(lab, /corpse\.ragdoll\.nudgeFromPlayer/);
  assert.match(lab, /<strong>CLIQUER POUR JOUER<\/strong>/);
});

test('first-person body is a dedicated render rig and cannot disturb the third-person avatar', () => {
  const source = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(source, /AnimationLabFirstPersonAvatarAnchor/);
  assert.match(source, /AnimationLabFirstPersonCharacter/);
  assert.match(source, /private firstPersonMixer\?: THREE\.AnimationMixer/);
  assert.match(source, /private readonly firstPersonAnimations = new Map/);
  assert.match(source, /this\.avatarAnchor\.visible = !firstPerson/);
  assert.match(source, /this\.firstPersonAvatarAnchor\.visible = firstPerson/);
  assert.match(source, /const firstPersonCharacter = await this\.loader\.loadAsync\(`\$\{ASSET_ROOT\}\/character\.fbx`\)/);
  assert.match(source, /this\.firstPersonMixer = new THREE\.AnimationMixer\(firstPersonCharacter\)/);
  assert.match(source, /this\.firstPersonMixer!\.clipAction\(clip\)/, '1P skeleton must reuse the exact processed animation clips');
  assert.match(source, /prepareFirstPersonLowerBodyMesh/);
  assert.match(source, /installFirstPersonLowerBodyClip/);
  assert.match(source, /FIRST_PERSON_VIEWMODEL_STAND_SCALE = 1\.22/, 'standing 1P legs should fill the lower frame without the old giant 146% scale');
  assert.match(source, /FIRST_PERSON_VIEWMODEL_CROUCH_SCALE = 0\.84/, 'crouch viewmodel must shrink substantially');
  assert.match(source, /state\.crouching \|\| state\.lowPosture \|\| state\.sliding/);
  assert.match(source, /FIRST_PERSON_PELVIS_BEHIND_CAMERA = -0\.50/, '1P pelvis should sit between the too-close and too-far previous offsets');
  assert.match(source, /FIRST_PERSON_PELVIS_BELOW_CAMERA = 0\.46/);
  assert.match(source, /firstPersonCamera = new THREE\.PerspectiveCamera\(72, 1, 0\.01, 120\)/);
  assert.match(source, /fpLowerBodyMask/, '1P shader must render a dedicated masked viewmodel mesh');
  assert.match(source, /fpArmMask/, '1P viewmodel should include authored arm/hand motion without restoring the torso');
  assert.match(source, /leftforearm|rightforearm/);
  assert.match(source, /this\.firstPersonHipTarget[\s\S]*this\.firstPersonCamera\.position/);
  assert.match(source, /this\.firstPersonAvatarAnchor\.position[\s\S]*copy\(this\.firstPersonHipTarget\)[\s\S]*sub\(this\.firstPersonHipWorld\)/);
  assert.match(source, /applyFirstPersonArmTuning/);
  assert.doesNotMatch(source, /stabilizeFirstPersonPelvisPose|firstPersonHipsRestQuaternion/, '1P pelvis must keep authored animation instead of being forced square');
  assert.match(source, /FIRST_PERSON_SPRINT_ARM_SCALE = 0\.72/);
  assert.match(source, /const sprintArms = this\.currentAnimation === 'running'/, 'only the valid running sprint clip should use the shorter 1P arm reach');
  assert.match(source, /estimatedSoleY[\s\S]*this\.feetPosition\.y/);
  assert.doesNotMatch(source, /AnimationLabFirstPersonWaistCap|FIRST_PERSON_WAIST_CAP_HEIGHT|CylinderGeometry\(0\.145/, '1P waist must not use a primitive cap/occluder');
  assert.match(source, /geometry\.setIndex\(kept\)/, 'mixed torso/leg triangles should be removed instead of leaving shader slivers');
  assert.doesNotMatch(source, /avatarVisualRoot|updateFirstPersonBodyLock|prepareFirstPersonBodyMask/, 'old one-rig body-lock implementation must stay removed');
  const fpMethod = source.slice(source.indexOf('private updateFirstPersonBodyTransform'), source.indexOf('private enableAutoMode'));
  assert.doesNotMatch(fpMethod, /this\.avatarAnchor\.(position|rotation)/, '1P presentation must never modify the world avatar');
  assert.doesNotMatch(fpMethod, /this\.firstPersonCamera\.(position|rotation)\.(copy|set|add|lerp)/, 'animated skeleton must never drive the gameplay POV');
});


test('high-fall 1P body stays close and downed look cannot rotate the body', () => {
  const controller = readFileSync(new URL('../src/player/PlayerController.ts', import.meta.url), 'utf8');
  assert.match(controller, /DOWNED_LOOK_YAW_LIMIT = THREE\.MathUtils\.degToRad\(24\)/);
  assert.match(controller, /DOWNED_LOOK_PITCH_UP_LIMIT = THREE\.MathUtils\.degToRad\(18\)/);
  assert.match(controller, /DOWNED_LOOK_PITCH_DOWN_LIMIT = THREE\.MathUtils\.degToRad\(24\)/);
  assert.match(controller, /private constrainDownedLook\(\)/);
  assert.match(controller, /this\.continuousAimYaw = this\.downedLookYawCenter \+ clampedYawDelta/);
  assert.match(controller, /this\.velocity\.set\(0, 0, 0\)/, 'downed physics must stay immobile');

  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /FIRST_PERSON_HIGH_FALL_PELVIS_BEHIND_CAMERA = -0\.34/);
  assert.match(lab, /FIRST_PERSON_HIGH_FALL_PELVIS_BELOW_CAMERA = 0\.27/);
  assert.match(lab, /const rigBodyYaw = [\s\S]*combatPoseTarget > 0\.001[\s\S]*this\.continuousViewYaw[\s\S]*: this\.bodyYaw/);
  assert.match(lab, /this\.avatarAnchor\.rotation\.y = this\.bodyYaw/);
  assert.match(lab, /if \(this\.player\?\.isIncapacitated\)[\s\S]*this\.neckBone[\s\S]*this\.headBone/);
});

test('active ragdoll profile preserves gait longer when a running fall interrupts locomotion', () => {
  const walking = activeRagdollProfile(1.4, -0.6, true, 0.2);
  const running = activeRagdollProfile(4.2, -1.1, true, 0.2);
  assert.ok(running.gaitStrength > walking.gaitStrength);
  assert.ok(running.gaitFrequencyHz > walking.gaitFrequencyHz);
  assert.ok(running.duration >= walking.duration);
  assert.equal(running.style, 'scramble');
});

test('active ragdoll reflex fades smoothly instead of switching off abruptly', () => {
  const duration = 0.9;
  assert.equal(activeRagdollEnvelope(-0.01, duration), 0);
  assert.equal(activeRagdollEnvelope(duration, duration), 0);
  assert.ok(activeRagdollEnvelope(0.12, duration) > 0.5);
  assert.ok(activeRagdollEnvelope(0.6, duration) > 0);
  assert.ok(activeRagdollEnvelope(0.86, duration) < activeRagdollEnvelope(0.6, duration));
});


test('reactive ragdoll has windmill, recovery-step and bracing strength without extending conscious control too long', () => {
  const run = activeRagdollProfile(4.4, -1.4, true, 0.7);
  const drop = activeRagdollProfile(0.5, -4.2, true, 0.2);
  assert.equal(run.style, 'windmill');
  assert.ok(run.armWindmillStrength > 0.6, 'fast interrupted locomotion should strongly fight balance loss with the arms');
  assert.ok(run.recoveryStepStrength > 0.7, 'running should attempt a physical catch-step before going passive');
  assert.ok(drop.armBraceStrength > run.armBraceStrength * 0.75, 'a steep drop must prioritize protective arm reach');
  assert.ok(run.duration > 1 && run.duration <= 1.48, 'active reflex window should be readable but remain short-lived');
});

test('captured animation dominates the first instant then hands control to fall reflexes', () => {
  assert.equal(activeRagdollAnimationCarry(-0.01), 0);
  assert.equal(activeRagdollAnimationCarry(0), 1);
  assert.ok(activeRagdollAnimationCarry(0.12) > activeRagdollAnimationCarry(0.28));
  assert.equal(activeRagdollAnimationCarry(0.36), 0);
});

test('ragdoll system has a short physical reflex phase without pose motors', () => {
  const ragdoll = readFileSync(new URL('../src/physics/RagdollSystem.ts', import.meta.url), 'utf8');
  assert.match(ragdoll, /applyActiveFallReactions/);
  assert.match(ragdoll, /activeRagdollEnvelope/);
  assert.match(ragdoll, /left-upper-leg/);
  assert.match(ragdoll, /right-upper-leg/);
  assert.match(ragdoll, /left-forearm/);
  assert.match(ragdoll, /right-forearm/);
  assert.match(ragdoll, /profile\.duration/);
  assert.match(ragdoll, /profile\.armWindmillStrength/);
  assert.match(ragdoll, /profile\.recoveryStepStrength/);
  assert.match(ragdoll, /activeRagdollAnimationCarry/);
  assert.match(ragdoll, /braceWindow/);
  assert.doesNotMatch(ragdoll, /setMotorPosition/);

  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /activeResponseScale: quietStart \? 0 : options\.meleeImpact \? 0\.16 : \(options\.fatal \? 0\.76 : 1\)/);
});

test('manual KILL carries evaluated animation inertia into the ragdoll', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /captureRagdollMotionFrame/);
  assert.match(lab, /buildRagdollAnimationMotion/);
  assert.match(lab, /quaternionAngularVelocity/);
  assert.match(lab, /animationMotion,/);
  assert.match(lab, /this\.captureRagdollMotionFrame\(rawDelta\)/);

  const ragdoll = readFileSync(new URL('../src/physics/RagdollSystem.ts', import.meta.url), 'utf8');
  assert.match(ragdoll, /animationMotion\?: RagdollAnimationMotion/);
  assert.match(ragdoll, /inheritedPointVelocity/);
  assert.match(ragdoll, /segmentInheritedAngularVelocity/);
  assert.match(ragdoll, /ANIMATION_LINEAR_INERTIA_SCALE/);
  assert.match(ragdoll, /MAX_ANIMATION_RELATIVE_ANGULAR_SPEED/);
});

test('corpse rest breaks single-arm crutch balances and limits excessive leg spread', () => {
  const ragdoll = readFileSync(new URL('../src/physics/RagdollSystem.ts', import.meta.url), 'utf8');
  assert.match(ragdoll, /HIP_LATERAL_LIMIT_DEGREES = 18/);
  assert.match(ragdoll, /Z_AXIS, -HIP_LATERAL_LIMIT_DEGREES, HIP_LATERAL_LIMIT_DEGREES/);
  assert.match(ragdoll, /ARM_SUPPORT_RELEASE_ANGULAR_SPEED = 0\.16/);
  assert.match(ragdoll, /id\.includes\('shoulder'\)/);
  assert.match(ragdoll, /parent\.id\.includes\('upper-arm'\) && child\.id\.includes\('forearm'\)/);
  assert.match(ragdoll, /mode: 'support'/);
  assert.match(ragdoll, /const contactFriction = isArm \? 0\.64 : 0\.78/);
});

test('first-person Action Idle keeps much more free-look on the left than on the right', () => {
  const startYaw = 1.25;
  const wideLeftGlance = startYaw - 80 * Math.PI / 180;
  const smallRightGlance = startYaw + 26 * Math.PI / 180;
  const left = updateFirstPersonBodyFollow(wideLeftGlance, startYaw, 1 / 60, false, false, false, 0, 'action');
  const right = updateFirstPersonBodyFollow(smallRightGlance, startYaw, 1 / 60, false, false, false, 0, 'action');
  assert.equal(left.bodyYaw, startYaw, 'Action Idle must allow a much wider left-side head freedom');
  assert.equal(right.bodyYaw, startYaw, 'a modest right glance must remain head-only');
  assert.equal(FIRST_PERSON_BODY_LOOK_TUNING.idleActionLeftTurnStartDegrees, 85);
  assert.equal(FIRST_PERSON_BODY_LOOK_TUNING.idleActionRightTurnStartDegrees, 30);
  assert.ok(
    FIRST_PERSON_BODY_LOOK_TUNING.idleActionLeftTurnStartDegrees
      > FIRST_PERSON_BODY_LOOK_TUNING.idleActionRightTurnStartDegrees * 2,
    'left-side Action Idle free-look must be substantially wider than right-side free-look',
  );
});




test('first-person presentation rig does not orbit around the POV during head-only free-look', () => {
  const source = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(source, /FIRST_PERSON_FREELOOK_RECENTER_FRACTION = 0\.22/);
  assert.match(source, /FIRST_PERSON_FREELOOK_RECENTER_MAX = 0\.085/);
  assert.match(source, /const framingYaw = rigBodyYaw/);
  assert.match(source, /this\.firstPersonForward\.set\(Math\.sin\(framingYaw\), 0, Math\.cos\(framingYaw\)\)/);
  assert.match(source, /this\.firstPersonRight\.set\(Math\.cos\(framingYaw\), 0, -Math\.sin\(framingYaw\)\)/);
  assert.match(source, /const pelvisViewLateral = this\.tempDirection[\s\S]*this\.firstPersonHipsBone/);
  assert.match(source, /-pelvisViewLateral \* FIRST_PERSON_FREELOOK_RECENTER_FRACTION/);
  assert.doesNotMatch(source, /const framingYaw = this\.continuousViewYaw/);
  assert.doesNotMatch(source, /firstPersonAbdomenBone|firstPersonTorsoWorld/, 'upper-body breathing must not translate the entire 1P rig');
});

test('stationary first-person idles keep a planted foot locked while breathing', () => {
  const source = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(source, /const firstPersonFootLockGroup =/);
  assert.match(source, /id === 'idle-action'/);
  assert.match(source, /id === 'idle-looking'/);
  assert.match(source, /id === 'idle-wait-1'/);
  assert.match(source, /id === 'crouch-idle'/);
  assert.match(source, /state\.horizontalSpeed < 0\.08/);
  assert.match(source, /!this\.bodyTurning/);
  assert.match(source, /this\.activeAuthoredTurn === null/);
  assert.match(source, /this\.firstPersonFootLockTarget/);
  assert.match(source, /this\.firstPersonAvatarAnchor\.position\.add\(this\.firstPersonFootLockCorrection\)/);
});

test('first-person idle turn tiers use Action clips while Sleeping Idle keeps its own turn set', () => {
  assert.equal(firstPersonIdleTurnCue(-80, false, false, 'action'), null, 'Action Idle allows a much wider left head-only glance');
  assert.equal(firstPersonIdleTurnCue(-90, false, false, 'action'), 'low-left');
  assert.equal(firstPersonIdleTurnCue(26, false, false, 'action'), null, 'Action Idle keeps a smaller right head-only margin');
  assert.equal(firstPersonIdleTurnCue(38, false, false, 'action'), 'low-right');
  assert.equal(firstPersonIdleTurnCue(-112, false, false, 'action'), 'big-left');
  assert.equal(firstPersonIdleTurnCue(58, false, false, 'action'), 'big-right');
  assert.equal(firstPersonIdleTurnCue(-40, false, false, 'sleeping'), 'low-left');
  assert.equal(firstPersonIdleTurnCue(40, false, false, 'sleeping'), 'low-right');
  assert.equal(firstPersonIdleTurnCue(-70, false, false, 'sleeping'), 'big-left');
  assert.equal(firstPersonIdleTurnCue(70, false, false, 'sleeping'), 'big-right');
  assert.equal(firstPersonIdleTurnCue(72, true, false, 'action'), null, 'moving must keep locomotion instead of idle turn clips');
  assert.equal(firstPersonIdleTurnCue(-46, false, false, 'action'), null, 'a plain mid-range glance still stays animation-free');
  assert.equal(firstPersonIdleTurnCue(-46, false, false, 'action', true), 'low-left', 'an already-turning slow left sweep recovers light footwork');
  assert.equal(firstPersonIdleTurnCue(22, false, false, 'action', true), 'low-right', 'an already-turning slow right sweep outside the settled stance recovers light footwork');
  assert.equal(firstPersonIdleTurnCue(18, false, false, 'action', true), null, 'Action Idle may settle inside its residual stance instead of forcing another foot turn');
  assert.equal(firstPersonIdleTurnCue(8, false, false, 'action', true), null, 'tiny residual corrections alone must not spam light turn clips');
  assert.equal(firstPersonIdleTurnCue(1, false, false, 'action', true, -0.025), 'low-left', 'a committed slow left mouse sweep keeps authored footwork even after residual yaw is consumed');
  assert.equal(firstPersonIdleTurnCue(-1, false, false, 'action', true, 0.025), 'low-right', 'a committed slow right mouse sweep keeps authored footwork even after residual yaw is consumed');
  assert.equal(firstPersonIdleTurnCue(1, false, false, 'action', true, 0.005), null, 'sub-threshold pointer jitter must not loop turn clips');

  const source = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(source, /idlePose === 'sleeping'[\s\S]*cue === 'low-left'[\s\S]*'left-turn-90'/);
  assert.match(source, /idlePose === 'sleeping'[\s\S]*cue === 'low-right'[\s\S]*'right-turn-90'/);
  assert.match(source, /idlePose === 'sleeping'[\s\S]*cue === 'big-left'[\s\S]*'left-turn'/);
  assert.match(source, /idlePose === 'sleeping'[\s\S]*cue === 'big-right'[\s\S]*'right-turn'/);
  assert.match(source, /cue === 'low-left'[\s\S]*'idle-turn-left'/);
  assert.match(source, /cue === 'low-right'[\s\S]*'idle-turn-right'/);
  assert.match(source, /cue === 'big-left'[\s\S]*'idle-big-turn-left'/);
  assert.match(source, /cue === 'big-right'[\s\S]*'idle-big-turn-right'/);
  assert.match(source, /firstPersonIdleTurnCue\([\s\S]*idlePose,[\s\S]*wasBodyTurning,[\s\S]*radToDeg\(firstPersonViewYawDelta\)/);
  assert.match(source, /this\.pendingStrongTurn && this\.autoOneShot && !isTurnAnimation\(this\.autoOneShot\)[\s\S]*this\.autoOneShot = null/);
});



test('slow continuous first-person body turns keep light authored footwork instead of sliding', () => {
  assert.equal(
    firstPersonIdleTurnCue(0.6, false, false, 'action', true, 0.024),
    'low-right',
    'once body-follow is committed, a gentle continued right sweep must still request footwork',
  );
  assert.equal(
    firstPersonIdleTurnCue(-0.6, false, false, 'sleeping', true, -0.024),
    'low-left',
    'Sleeping Idle must also keep its light turn footwork during a gentle continued left sweep',
  );
  const source = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(
    source,
    /this\.pendingStrongTurn && this\.autoOneShot && !isTurnAnimation\(this\.autoOneShot\)[\s\S]*this\.autoOneShot = null;[\s\S]*this\.idleSequenceOneShot = null;/,
    'idle waits/looks must yield the mixer immediately when stationary body rotation requires a turn',
  );
});

test('first-person authored turn clips keep their readable motion instead of teleporting out early', () => {
  const source = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(source, /const playableFraction = big \? 0\.90 : 0\.88/);
  assert.match(source, /const startFraction = 0\.01/);
  assert.match(source, /\? big \? 1\.08 : 1\.14/);
  assert.match(source, /\? 0\.17/);
});

test('first-person Action Idle keeps a natural residual stance after an authored body turn', () => {
  const startYaw = -0.5;
  const largeGlance = startYaw + 78 * Math.PI / 180;
  let bodyYaw = startYaw;
  let turning = false;
  for (let i = 0; i < 60; i += 1) {
    const result = updateFirstPersonBodyFollow(largeGlance, bodyYaw, 1 / 60, false, false, turning, 0, 'action');
    bodyYaw = result.bodyYaw;
    turning = result.turning;
  }
  assert.ok(bodyYaw > startYaw + 0.55, 'body should strongly rotate toward a sustained look beyond the Action Idle threshold');
  const residualDegrees = Math.abs((largeGlance - bodyYaw) * 180 / Math.PI);
  assert.ok(
    residualDegrees >= 14 && residualDegrees <= FIRST_PERSON_BODY_LOOK_TUNING.idleActionTurnStopDegrees + 0.5,
    'Action Idle should keep a visible but comfortable body/POV angle instead of squaring the stance to 0 degrees',
  );
  assert.equal(turning, false, 'the body turn must finish cleanly inside the residual stance band');
});

test('first-person Sleeping Idle still recenters after its own turn', () => {
  const startYaw = 0;
  const largeGlance = 70 * Math.PI / 180;
  let bodyYaw = startYaw;
  let turning = false;
  for (let i = 0; i < 60; i += 1) {
    const result = updateFirstPersonBodyFollow(largeGlance, bodyYaw, 1 / 60, false, false, turning, 0, 'sleeping');
    bodyYaw = result.bodyYaw;
    turning = result.turning;
  }
  const residualDegrees = Math.abs((largeGlance - bodyYaw) * 180 / Math.PI);
  assert.ok(residualDegrees < 5, 'Sleeping Idle should keep its near-centered post-turn recovery');
});

test('committed first-person body turns inherit the live mouse yaw delta instead of chasing the cursor', () => {
  const dt = 1 / 60;
  const startYaw = 0;
  const previousViewYaw = 52 * Math.PI / 180;
  let bodyYaw = 8 * Math.PI / 180;
  const mouseDelta = 5 * Math.PI / 180;
  const currentViewYaw = previousViewYaw + mouseDelta;

  const result = updateFirstPersonBodyFollow(
    currentViewYaw,
    bodyYaw,
    dt,
    false,
    false,
    true,
    mouseDelta,
  );

  assert.equal(result.turning, true);
  assert.ok(
    result.bodyYaw - bodyYaw >= mouseDelta - 1e-9,
    'while a turn is committed, the pelvis must receive at least the live POV yaw delta in the same frame',
  );

  // Even after the accumulated free-look offset has nearly been consumed, a
  // continuously moving mouse keeps the committed turn latched instead of
  // allowing the POV to run ahead again.
  const almostSyncedBody = currentViewYaw - 1 * Math.PI / 180;
  const nextMouseDelta = 3 * Math.PI / 180;
  const nextViewYaw = currentViewYaw + nextMouseDelta;
  const next = updateFirstPersonBodyFollow(
    nextViewYaw,
    almostSyncedBody,
    dt,
    false,
    false,
    true,
    nextMouseDelta,
  );
  assert.equal(next.turning, true);
  assert.ok(next.bodyYaw - almostSyncedBody >= nextMouseDelta - 1e-9);
});

test('first-person walking and sprinting keep an even tighter camera/body sync', () => {
  assert.ok(FIRST_PERSON_BODY_LOOK_TUNING.movingTurnStartDegrees < FIRST_PERSON_BODY_LOOK_TUNING.idleActionLeftTurnStartDegrees);
  assert.ok(FIRST_PERSON_BODY_LOOK_TUNING.movingTurnStartDegrees < FIRST_PERSON_BODY_LOOK_TUNING.idleActionRightTurnStartDegrees);
  assert.ok(FIRST_PERSON_BODY_LOOK_TUNING.sprintTurnStartDegrees < FIRST_PERSON_BODY_LOOK_TUNING.movingTurnStartDegrees);
  assert.equal(FIRST_PERSON_BODY_LOOK_TUNING.idleActionResidualDegrees, 16);
  assert.equal(FIRST_PERSON_BODY_LOOK_TUNING.idleActionTurnStopDegrees, 18);
  assert.equal(FIRST_PERSON_BODY_LOOK_TUNING.idleResidualDegrees, 0);
  assert.equal(FIRST_PERSON_BODY_LOOK_TUNING.movingResidualDegrees, 0);
  assert.equal(FIRST_PERSON_BODY_LOOK_TUNING.sprintResidualDegrees, 0);
});

test('first-person head movement resets the AFK idle bridge and 1P turn clips keep their authored footwork', () => {
  const source = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const controller = readFileSync(new URL('../src/player/PlayerController.ts', import.meta.url), 'utf8');
  assert.match(controller, /getLookActivitySerial\(\): number/);
  assert.match(controller, /rawHorizontal !== 0 \|\| rawVertical !== 0[\s\S]*lookActivitySerial \+= 1/);
  assert.match(source, /const rawPointerLookMoved = lookActivitySerial !== this\.previousLookActivitySerial/);
  assert.match(source, /this\.idleLookMovedThisFrame = rawPointerLookMoved \|\|/);
  assert.match(source, /if \(this\.idleLookMovedThisFrame\) \{[\s\S]*this\.idleSequenceElapsed = 0/);
  assert.match(source, /Once Sleeping[\s\S]*must NOT wake[\s\S]*back into Action Idle/);
  assert.match(source, /if \(sleepingPhase\) \{[\s\S]*this\.idleSequencePhase === 'sleeping-look'[\s\S]*this\.playAutoImmediate\('idle'/);
  assert.match(source, /const startFraction = 0\.01/);
  assert.match(source, /const playableFraction = big \? 0\.90 : 0\.88/);
  assert.match(source, /this\.viewMode !== 'first-person'[\s\S]*currentAutoOneShotStillPlaying/);
  assert.match(source, /Sleeping Idle keeps its own footwork/);
});

test('first-person render rig follows bodyYaw normally but combat presentation follows the POV', () => {
  const source = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(source, /const rigBodyYaw = [\s\S]*combatPoseTarget > 0\.001[\s\S]*this\.continuousViewYaw[\s\S]*: this\.bodyYaw/);
  assert.match(source, /if \(this\.viewMode === 'first-person'\)[\s\S]*updateFirstPersonBodyFollow/);
  assert.doesNotMatch(source, /const rigBodyYaw = state\.incapacitated \? this\.bodyYaw : viewBodyYaw/);
});

test('dead first-person camera stays in front of the face during ragdoll rotation', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /const DEAD_CAMERA_FACE_FORWARD = 0\.27;/);
  assert.match(lab, /const DEAD_CAMERA_FACE_SAFE_FORWARD = 0\.225;/);
  assert.match(lab, /forwardDistance < DEAD_CAMERA_FACE_SAFE_FORWARD/);
  assert.match(lab, /DEAD_CAMERA_FACE_SAFE_FORWARD - forwardDistance/);
  assert.match(lab, /this\.firstPersonCamera\.near = DEAD_CAMERA_NEAR_CLIP/);
});

test('third-person Sleeping Idle uses sleeping turns and mouse-only turns never wake Action Idle', () => {
  const source = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(source, /const thirdPersonIdlePose: IdleResumeMode = this\.idleSequencePhase === 'sleeping'[\s\S]*\? 'sleeping'[\s\S]*: 'action'/);
  assert.match(source, /thirdPersonIdlePose === 'sleeping'[\s\S]*strongDirection === 'left'[\s\S]*'left-turn-90'/);
  assert.match(source, /thirdPersonIdlePose === 'sleeping'[\s\S]*strongDirection === 'right'[\s\S]*'right-turn-90'/);
  assert.match(source, /thirdPersonIdlePose === 'sleeping'[\s\S]*strongDirection === 'big-left'[\s\S]*'left-turn'/);
  assert.match(source, /thirdPersonIdlePose === 'sleeping'[\s\S]*else turnId = 'right-turn'/);
  assert.match(source, /const sleepingTurn = isSleepingIdleTurn\(id\);[\s\S]*activeTurnResumeMode = sleepingTurn \? 'sleeping' : 'action'/);
  assert.match(source, /Only locomotion\/gameplay[\s\S]*allowed to arm Action Idle/);
});

test('first-person Action Idle keeps the gameplay camera fixed and offsets only the render body', () => {
  const source = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(source, /FIRST_PERSON_ACTION_IDLE_BODY_RIGHT_OFFSET = 0\.05/);
  assert.match(source, /FIRST_PERSON_ACTION_IDLE_BODY_FORWARD_OFFSET = -0\.055/);
  assert.match(source, /FIRST_PERSON_ACTION_IDLE_BODY_OFFSET_RESPONSE = 12\.0/);
  assert.match(source, /const usesFirstPersonActionIdleFraming[\s\S]*id === 'idle-action'[\s\S]*id === 'idle-wait-1'[\s\S]*id === 'idle-wait-2'[\s\S]*id === 'idle-action-to-standing-idle'[\s\S]*isActionIdleTurn\(id\)/);
  assert.match(source, /usesFirstPersonActionIdleFraming\(this\.currentAnimation\)[\s\S]*!state\.incapacitated/);
  assert.match(source, /this\.firstPersonHipTarget[\s\S]*FIRST_PERSON_ACTION_IDLE_BODY_RIGHT_OFFSET \* this\.firstPersonActionIdleBodyOffsetBlend/);
  assert.match(source, /this\.firstPersonHipTarget[\s\S]*FIRST_PERSON_ACTION_IDLE_BODY_FORWARD_OFFSET \* this\.firstPersonActionIdleBodyOffsetBlend/);
  assert.doesNotMatch(source, /clearFirstPersonActionIdlePovOffset|applyFirstPersonActionIdlePovOffset|firstPersonActionIdlePovAppliedOffset/);
  assert.doesNotMatch(source, /FIRST_PERSON_ACTION_IDLE_POV_RIGHT_OFFSET|FIRST_PERSON_ACTION_IDLE_POV_FORWARD_OFFSET/);
});


test('first-person Action Idle framing persists through waits, action turns, and the return transition', () => {
  const source = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(source, /usesFirstPersonActionIdleFraming[\s\S]*'idle-wait-1'[\s\S]*'idle-wait-2'/);
  assert.match(source, /usesFirstPersonActionIdleFraming[\s\S]*'idle-action-to-standing-idle'/);
  assert.match(source, /usesFirstPersonActionIdleFraming[\s\S]*isActionIdleTurn\(id\)/);
  assert.doesNotMatch(source, /actionIdleBodyOffsetTarget = this\.currentAnimation === 'idle-action'/);
});

test('first-person Action Idle keeps a settled turn stance while the POV remains comfortable', () => {
  const source = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(source, /private settledActionTurnPose: AnimationId \| null = null/);
  assert.match(
    source,
    /private holdSettledActionTurnPose\(id: AnimationId\)[\s\S]*this\.currentAction\.paused = true[\s\S]*this\.firstPersonCurrentAction\.paused = true/,
    'a completed Action turn should be able to freeze its readable final foot stance',
  );
  assert.match(
    source,
    /resumeMode === 'action'[\s\S]*!this\.bodyTurning[\s\S]*idleActionTurnStopDegrees[\s\S]*this\.holdSettledActionTurnPose\(finishedTurn\)/,
    'the final turn stance may only settle when the POV/body angle is already inside the comfortable Action-Idle arc',
  );
  assert.match(
    source,
    /const holdingTurnStance = this\.settledActionTurnPose !== null[\s\S]*if \(!holdingTurnStance\) \{[\s\S]*requestAutoAnimation\('idle-action'/,
    'the idle selector must not immediately force the one-leg-forward idle-action pose over a valid turn stance',
  );
  assert.match(
    source,
    /const restartFromSettledPose = this\.settledActionTurnPose === id[\s\S]*playAnimation\(id, false, rate, false, true\)/,
    'requesting another turn in the same direction must restart the clip instead of resuming its paused end pose',
  );
});


test('jumping onto pit stairs is protected from accidental edge ragdoll', () => {
  const medium = MOVEMENT_LAB_PITS.find((pit) => pit.id === 'medium');
  assert.ok(medium);
  const centerX = (medium.minX + medium.maxX) * 0.5;
  // medium stairs are z-: inside the pit near the north/upper part of the lane.
  const sample = analyzePitEdge({
    x: centerX,
    y: 0.92,
    z: medium.minZ + 0.72,
    velocityX: 0,
    velocityY: -0.8,
    velocityZ: 1.2,
    grounded: false,
    falling: true,
    fallDistance: 0.42,
    viewX: 0,
    viewZ: 1,
    viewPitchDegrees: -18,
    manualLean: 0,
    crouching: false,
    lowPosture: false,
    inputForward: 1,
    inputRight: 0,
    jumpGraceSeconds: 0.18,
    controlGraceSeconds: 0,
  }, MOVEMENT_LAB_PITS);
  assert.ok(sample?.safeStairEntry, 'airborne movement over the authored stair lane should stay protected');
  assert.equal(sample?.immediate, false);
  assert.equal(sample?.riskRate, 0);
});

test('damage presentation stays tied to current HP and becomes strongly desaturated when critical', () => {
  const healthy = damageVisualState(100);
  const wounded = damageVisualState(48);
  const critical = damageVisualState(9);
  assert.equal(healthy.bloodOpacity, 0);
  assert.ok(wounded.bloodOpacity > 0.14, 'mid health should keep a lighter persistent blood edge');
  assert.ok(critical.bloodOpacity > 0.5, 'critical health should still keep a strong persistent blood layer');
  assert.ok(critical.grayscale > 0.8, 'critical health should be nearly grayscale');
  assert.ok(critical.saturation < 0.35);
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /firstPersonDamagePresentation = this\.viewMode === 'first-person'/);
  assert.match(lab, /const opacity = firstPersonDamagePresentation[\s\S]*Math\.max\(visual\.bloodOpacity, flashBlood\)[\s\S]*: 0;/, 'third person should not render the blood-on-screen layer');
});

test('ragdoll physical impact damage is speed based and head strikes are much more dangerous', () => {
  assert.equal(ragdollBodyImpactPart('head'), 'head');
  assert.equal(ragdollBodyImpactPart('left-forearm'), 'forearm');
  assert.equal(ragdollImpactDamage('head', 3.0, 'wall'), 0, 'small head bump should not deal chip damage');
  const head = ragdollImpactDamage('head', 8.0, 'wall');
  const core = ragdollImpactDamage('core', 8.0, 'wall');
  const limb = ragdollImpactDamage('forearm', 8.0, 'wall');
  assert.ok(head > core * 2, 'head impact must be substantially more dangerous');
  assert.ok(core > limb);
  assert.ok(ragdollImpactNeedsBlood('head', 8.0, head));
});

test('very high ragdoll drops are unconditionally fatal', () => {
  assert.equal(ragdollDropIsFatal(6.5), false);
  assert.equal(ragdollDropIsFatal(8.24), false);
  assert.equal(ragdollDropIsFatal(8.25), true);
  assert.equal(ragdollDropIsFatal(12.6), true);
});

test('ragdoll impacts feed damage and pooled blood decals without per-frame raycasts', () => {
  const ragdoll = readFileSync(new URL('../src/physics/RagdollSystem.ts', import.meta.url), 'utf8');
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const decals = readFileSync(new URL('../src/dev/BloodDecalSystem.ts', import.meta.url), 'utf8');
  assert.match(ragdoll, /drainImpactEvents/);
  assert.match(ragdoll, /velocityChange/);
  assert.match(lab, /processRagdollImpactEvents/);
  assert.match(lab, /ragdollImpactDamage/);
  assert.match(lab, /ragdollImpactNeedsBlood/);
  assert.match(decals, /MAX_BLOOD_DECALS = 72/);
  assert.doesNotMatch(decals, /Raycaster|castRay/);
});

test('CC0 blood sources are still fetched as part of the combined predev/prebuild asset pass', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const fetcher = readFileSync(new URL('../scripts/fetch-blood-assets.mjs', import.meta.url), 'utf8');
  assert.ok(pkg.scripts.predev.split('&&').some(command => command.trim() === 'npm run assets:all'));
  assert.ok(pkg.scripts.prebuild.split('&&').some(command => command.trim() === 'npm run assets:all'));
  assert.match(pkg.scripts['assets:all'], /assets:blood/);
  assert.match(fetcher, /opengameart\.org/);
  assert.match(fetcher, /blood_0\.png/);
  assert.match(fetcher, /blood_splat\.png/);
  assert.match(fetcher, /blood_splatter_01_base\.png/);
  assert.match(fetcher, /using runtime fallback/);
});

test('main-repo Backrooms PBR textures are mirrored before dev/build with offline fallbacks', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const fetcher = readFileSync(new URL('../scripts/fetch-backrooms-assets.mjs', import.meta.url), 'utf8');
  assert.match(pkg.scripts['assets:all'], /assets:backrooms/);
  assert.match(fetcher, /raw\.githubusercontent\.com\/teddyfresnes\/Backrooms\/main/);
  assert.match(fetcher, /backrooms-wallpaper-seamless\.webp/);
  assert.match(fetcher, /carpet-color-v2\.webp/);
  assert.match(fetcher, /carpet-normal-gl\.webp/);
  assert.match(fetcher, /ceiling-color\.webp/);
  assert.match(fetcher, /plaster-normal-gl\.webp/);
  assert.match(fetcher, /runtime keeps lab fallback/);
});


test('ragdoll impact damage is committed immediately per physics contact instead of after settling', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /for \(const event of this\.ragdoll\.drainImpactEvents\(\)\)/);
  assert.match(lab, /this\.applyRagdollDamage\([\s\S]*damage,[\s\S]*RAGDOLL · IMPACT/);
  assert.doesNotMatch(lab, /strongestDamage/);
  assert.doesNotMatch(lab, /ragdollImpactDamageCooldown/);
  assert.match(lab, /ragdollDropIsFatal\(drop\)[\s\S]*markRagdollDead\(`RAGDOLL · IMPACT MORTEL/);
  assert.match(lab, /Safety fallback only[\s\S]*missed contact telemetry case/);
});

test('damage visual helper can disable the death veil independently from critical-health grading', () => {
  const firstPersonDead = damageVisualState(0, 100, true);
  const thirdPersonDead = damageVisualState(0, 100, false);
  assert.equal(firstPersonDead.deathVeil, 1);
  assert.equal(thirdPersonDead.deathVeil, 0);
  assert.ok(thirdPersonDead.brightness > firstPersonDead.brightness);
  assert.ok(thirdPersonDead.contrast < firstPersonDead.contrast);
  assert.ok(thirdPersonDead.grayscale > 0.8, 'ordinary critical-health grading can remain in third person');
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /damageVisualState\([\s\S]*firstPersonDamagePresentation/);
});

test('death presentation adds a hard tunnel-vision exposure effect beyond plain grayscale', () => {
  const dead = damageVisualState(0);
  assert.equal(dead.deathVeil, 1);
  assert.ok(dead.grayscale >= 0.99);
  assert.ok(dead.saturation <= 0.05);
  assert.ok(dead.contrast >= 1.3);
  assert.ok(dead.brightness <= 0.62);
  const css = readFileSync(new URL('../src/dev/AnimationLab.css', import.meta.url), 'utf8');
  assert.match(css, /--death-veil/);
  assert.match(css, /animation-lab__damage-fx::after/);
});

test('blood impacts use dark pooled surface decals with satellite droplets', () => {
  const decals = readFileSync(new URL('../src/dev/BloodDecalSystem.ts', import.meta.url), 'utf8');
  assert.match(decals, /0x63322b/);
  assert.match(decals, /satelliteCount/);
  assert.match(decals, /this\.tangent/);
  assert.match(decals, /this\.bitangent/);
  assert.doesNotMatch(decals, /clipsafari|red-blood-splatter/);
});


test('dead third-person view bypasses all critical-health screen grading', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /thirdPersonDead = this\.health <= 0 && !firstPersonDamagePresentation/);
  assert.match(lab, /damageVisualState\([\s\S]*thirdPersonDead \? MAX_HEALTH : this\.health/);
  assert.match(lab, /const opacity = firstPersonDamagePresentation[\s\S]*: 0;/);
});

test('lethal falls and killing impacts use randomized multi-splat blood bursts', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const decals = readFileSync(new URL('../src/dev/BloodDecalSystem.ts', import.meta.url), 'utf8');
  assert.match(decals, /spawnBurst\(/);
  assert.match(decals, /clusterCount/);
  assert.match(decals, /Math\.random\(\)/);
  assert.match(decals, /MAX_BLOOD_DECALS = 72/);
  assert.match(decals, /satelliteCount/);
  assert.match(lab, /ragdollDropIsFatal\(drop\)[\s\S]*bloodDecals\.spawnBurst/);
  assert.match(lab, /impactKills = !alreadyDead && damage >= this\.health/);
  assert.match(lab, /ragdollImpactPrefersBurst/);
  assert.match(lab, /this\.bloodImpactGate\.accept/);
  assert.match(lab, /spawnSevereLandingBlood[\s\S]*bloodDecals\.spawnBurst/);
});

test('surface and pit stair geometry grant control grace instead of random ragdolls', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /authoredStairColliders/);
  assert.match(lab, /playerHasAuthoredStairProtection/);
  assert.match(lab, /this\.pitControlGrace = Math\.max\(this\.pitControlGrace, 0\.82\)/);
});

test('severe authored floor crashes also leave a blood surface mark', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /spawnSevereLandingBlood/);
  assert.match(lab, /impact\.fallDistance < 4\.7/);
  assert.match(lab, /this\.bloodDecals\.spawn/);
});


test('late ragdoll settling releases limb-supported crutches and stair hangs without touching active falls', () => {
  const moving = ragdollFinalSupportRelease({
    elapsed: FINAL_SETTLE_START_SECONDS + 0.3,
    coreY: 0.8,
    headY: 0.55,
    forearmYs: [0.2, 0.4],
    lowerLegYs: [1.4, 1.45],
    allBodyYs: [0.45, 0.55, 0.8, 1.4, 1.45],
    coreLinearSpeed: 1.2,
    coreAngularSpeed: 0.4,
    maxLinearSpeed: 1.3,
  });
  assert.equal(moving, 0, 'energetic ragdoll motion must remain completely untouched');

  const stairHang = ragdollFinalSupportRelease({
    elapsed: FINAL_SETTLE_START_SECONDS + 0.45,
    coreY: 0.55,
    headY: 0.2,
    forearmYs: [0.35, 0.4],
    lowerLegYs: [1.18, 1.28],
    allBodyYs: [0.2, 0.35, 0.4, 0.55, 0.9, 1.18, 1.28],
    coreLinearSpeed: 0.08,
    coreAngularSpeed: 0.12,
    maxLinearSpeed: 0.18,
  });
  assert.ok(stairHang > 0.6, 'legs hooked above a hanging torso should be released strongly');

  const lying = ragdollFinalSupportRelease({
    elapsed: FINAL_SETTLE_START_SECONDS + 1,
    coreY: 0.24,
    headY: 0.22,
    forearmYs: [0.18, 0.2],
    lowerLegYs: [0.16, 0.19],
    allBodyYs: [0.14, 0.16, 0.18, 0.19, 0.2, 0.22, 0.24, 0.28],
    coreLinearSpeed: 0.02,
    coreAngularSpeed: 0.03,
    maxLinearSpeed: 0.04,
  });
  assert.equal(lying, 0, 'a normal body already lying on the floor must be left alone');

  const ragdoll = readFileSync(new URL('../src/physics/RagdollSystem.ts', import.meta.url), 'utf8');
  assert.match(ragdoll, /applyFinalSupportRelease\(substep\)/);
  assert.match(ragdoll, /FINAL_SETTLE_CORE_GRAVITY_SCALE/);
  assert.match(ragdoll, /FINAL_SETTLE_LEG_FRICTION/);
  assert.match(ragdoll, /core\.body\.wakeUp\(\)/);
  assert.doesNotMatch(ragdoll, /lockTranslations|lockRotations\(true/);
});


test('late head/limb relaxation only opens after the ragdoll is genuinely calm', () => {
  assert.equal(ragdollFinalRelaxationEnvelope({
    elapsed: FINAL_RELAX_START_SECONDS - 0.01,
    coreLinearSpeed: 0.02,
    coreAngularSpeed: 0.03,
    maxLinearSpeed: 0.04,
  }), 0);
  assert.equal(ragdollFinalRelaxationEnvelope({
    elapsed: FINAL_RELAX_START_SECONDS + 0.5,
    coreLinearSpeed: 0.7,
    coreAngularSpeed: 0.2,
    maxLinearSpeed: 0.82,
  }), 0, 'new motion must cancel the final relaxation instead of being damped by it');
  assert.ok(ragdollFinalRelaxationEnvelope({
    elapsed: FINAL_RELAX_START_SECONDS + 0.55,
    coreLinearSpeed: 0.04,
    coreAngularSpeed: 0.08,
    maxLinearSpeed: 0.12,
  }) > 0.55, 'a quiet late ragdoll should get a meaningful but temporary relaxation window');
});

test('extreme fore-aft leg scissors close only part-way during final settling', () => {
  const normal = ragdollLegScissorClosure(0.18, -0.14, 0.22, -0.18, 1);
  assert.equal(normal.strength, 0, 'ordinary asymmetric resting legs must be preserved');

  const split = ragdollLegScissorClosure(0.46, -0.42, 0.54, -0.50, 1);
  assert.ok(split.strength > 0.6);
  assert.ok(split.leftAngularSpeed > 0);
  assert.ok(split.rightAngularSpeed < 0);
  assert.ok(Math.abs(split.leftAngularSpeed) <= 0.66);
  assert.ok(Math.abs(split.rightAngularSpeed) <= 0.66);
});

test('final settling also retracts a single lower leg that folds up toward the head', () => {
  const tucked = ragdollLegScissorClosure(0.12, -0.06, 0.74, 0.02, 1);
  assert.ok(tucked.strength > 0.35, 'a shin folded far over the torso should trigger some closure');
  assert.ok(tucked.leftAngularSpeed > 0, 'the overreaching forward leg should be asked to come back');
  assert.ok(tucked.rightAngularSpeed < 0, 'the opposite leg keeps a smaller counter motion');
});

test('final settle lets head weight sag and softly closes only extreme hip splits', () => {
  const ragdoll = readFileSync(new URL('../src/physics/RagdollSystem.ts', import.meta.url), 'utf8');
  assert.match(ragdoll, /applyFinalPoseRelaxation\(substep\)/);
  assert.match(ragdoll, /FINAL_RELAX_HEAD_GRAVITY_SCALE/);
  assert.match(ragdoll, /FINAL_RELAX_HEAD_ANGULAR_DAMPING/);
  assert.match(ragdoll, /finalNeckAnchorCoreLocal/);
  assert.match(ragdoll, /ragdollLegScissorClosure/);
  assert.match(ragdoll, /leftLowerForwardOffset/);
  assert.match(ragdoll, /driveLateHipClosure/);
  assert.match(ragdoll, /FINAL_RELAX_LEG_FRICTION/);
  assert.match(ragdoll, /finalHeadRelaxHold > 0 \|\| this\.finalLegClosureStrength > 0\.07/);
  assert.doesNotMatch(ragdoll, /setTranslation\([^\n]*final|setRotation\([^\n]*final/);
});


test('pit bottoms use the same textured carpet PBR family instead of a black material', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /name: 'pit-carpet-floor'/);
  assert.doesNotMatch(lab, /name: 'pit-darkness'/);
  assert.match(lab, /result\.pitBottom\.map = texture/);
  assert.match(lab, /result\.pitBottom\.normalMap = texture/);
  assert.match(lab, /result\.pitBottom\.roughnessMap = texture/);
  assert.match(lab, /result\.pitBottom\.aoMap = texture/);
});

test('fatal blood bursts use a wider, denser and deliberately irregular decal field', () => {
  const decals = readFileSync(new URL('../src/dev/BloodDecalSystem.ts', import.meta.url), 'utf8');
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(decals, /MAX_BLOOD_DECALS = 72/);
  assert.match(decals, /Math\.min\(\s*16,/);
  assert.match(decals, /second irregular dominant mark/);
  assert.match(decals, /5 \+ Math\.floor\(Math\.random\(\) \* 5\)/);
  assert.match(decals, /1\.85 \* power/);
  assert.match(decals, /this\.flowStrength/);
  assert.match(decals, /this\.flushPending\(12\)/);
  assert.match(lab, /1\.85 \+ \(this\.ragdollFallDistance - 8\.25\) \* 0\.14/);
  assert.match(lab, /part === 'head' \? \(impactKills \? 2\.30 : 1\.88\)/);
});


test('medium/heavy landings ragdoll instead of using Hard Landing, while small landings stay authored', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(lab, /id: 'hard-landing'/);
  assert.doesNotMatch(lab, /file: 'hard-landing\.fbx'/);
  assert.match(lab, /RAGDOLL_LANDING_DAMAGE_THRESHOLD = 12/);
  assert.match(lab, /RAGDOLL_LANDING_RECOVERY_BLEND_THRESHOLD = 0\.34/);
  assert.match(lab, /const ragdollLanding = damage >= RAGDOLL_LANDING_DAMAGE_THRESHOLD/);
  assert.match(lab, /recoveryBlend >= RAGDOLL_LANDING_RECOVERY_BLEND_THRESHOLD/);
  assert.match(lab, /this\.startRagdoll\(\{[\s\S]*status: 'RAGDOLL · RÉCEPTION LOURDE'/);
  assert.match(lab, /const landingId: AnimationId = 'falling-to-landing'/);
});

test('get-up eligibility excludes death, motion, blocked clearance and unavailable input', async () => {
  const { canGetUp } = await import('../.movement-test-dist/dev/GetUpRecoveryRules.js');
  const base = { alive: true, ragdollMode: 'pit-fall', settled: true, recovering: false, groundAvailable: true, inputEnabled: true };
  assert.equal(canGetUp(base), true);
  for (const change of [
    { alive: false }, { ragdollMode: 'dead' }, { ragdollMode: null }, { settled: false },
    { recovering: true }, { groundAvailable: false }, { inputEnabled: false },
  ]) assert.equal(canGetUp({ ...base, ...change }), false);
});

test('living ragdolls always expose the get-up prompt and become recoverable without waiting forever for limb sleep', async () => {
  const ragdoll = readFileSync(new URL('../src/physics/RagdollSystem.ts', import.meta.url), 'utf8');
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const { recoveryReadyForInput, shouldShowGetUpPrompt, GET_UP_FORCE_READY_SECONDS } = await import('../.movement-test-dist/dev/GetUpRecoveryRules.js');
  assert.match(ragdoll, /get isRecoveryReady\(\): boolean/);
  assert.match(ragdoll, /this\.settled/);
  assert.match(ragdoll, /this\.elapsed >= 2\.5/);
  assert.equal(GET_UP_FORCE_READY_SECONDS, 1.25);
  assert.equal(recoveryReadyForInput(false, 1.24), false);
  assert.equal(recoveryReadyForInput(false, 1.25), true);
  assert.equal(shouldShowGetUpPrompt({ alive: true, ragdollMode: 'pit-fall', recovering: false, inputEnabled: true }), true);
  assert.equal(shouldShowGetUpPrompt({ alive: false, ragdollMode: 'pit-fall', recovering: false, inputEnabled: true }), false);
  assert.equal(shouldShowGetUpPrompt({ alive: true, ragdollMode: 'dead', recovering: false, inputEnabled: true }), false);
  assert.doesNotMatch(lab, /!this\.ragdoll\.isRecoveryReady/);
  assert.match(lab, /settled: recoveryReadyForInput\(this\.ragdoll\?\.isRecoveryReady \?\? false, this\.ragdollElapsed\)/);
  assert.match(lab, /const visible = shouldShowGetUpPrompt/);
});

test('get-up chooses back or belly from anatomical front, including sideways rest', async () => {
  const { chooseGetUpSide, getUpYawFromDirection, getUpProgress } = await import('../.movement-test-dist/dev/GetUpRecoveryRules.js');
  assert.equal(chooseGetUpSide(0.9), 'back');
  assert.equal(chooseGetUpSide(-0.9), 'belly');
  assert.equal(chooseGetUpSide(0), 'back');
  assert.equal(chooseGetUpSide(Number.NaN), 'back');
  assert.ok(Math.abs(getUpYawFromDirection(1, 0, 0) - Math.PI / 2) < 1e-8);
  assert.equal(getUpYawFromDirection(0, 0, 1.23), 1.23);
  assert.equal(getUpProgress(0, 8), 0);
  assert.equal(getUpProgress(4, 8), 0.5);
  assert.equal(getUpProgress(10, 8), 1);
});

test('supplied back and belly FBX clips are bundled and have distinct full-length animation data', () => {
  for (const file of ['stand-up-back.fbx', 'stand-up-belly.fbx']) {
    const path = new URL(`../public/assets/animation-lab/${file}`, import.meta.url);
    assert.ok(statSync(path).size > 1000000);
    assert.equal(readFileSync(path).subarray(0, 18).toString(), 'Kaydara FBX Binary');
  }
});

test('get-up flow uses a real E interaction and keeps fatal ragdolls unrecoverable', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const recovery = readFileSync(new URL('../src/dev/GetUpRecovery.ts', import.meta.url), 'utf8');
  assert.match(lab, /className = 'interaction-prompt animation-lab__get-up-prompt'/);
  assert.match(lab, /this\.settings\.controls\.interact/);
  assert.match(lab, /Se relever/);
  assert.match(lab, /this\.ragdollMode !== null && this\.ragdollMode !== 'dead'/);
  assert.match(lab, /inputEnabled: this\.ready/);
  assert.match(lab, /if \(!this\.canStartRecovery\(\)/);
  assert.match(lab, /ragdollMode: this\.ragdollMode/);
  assert.match(lab, /chooseGetUpSide/);
  assert.match(lab, /stand-up-back/);
  assert.match(lab, /stand-up-belly/);
  assert.match(lab, /ragdoll\.suspendForRecovery\(\);[\s\S]*this\.recovery = recovery/);
  assert.match(recovery, /captureGetUpPoseClip/);
  assert.match(recovery, /copyGetUpPose/);
});

test('recovery validates floor/capsule clearance before E, reserves that exact center, and rechecks after animation', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const physics = readFileSync(new URL('../src/physics/PhysicsWorld.ts', import.meta.url), 'utf8');
  assert.match(physics, /findStandingRecoveryPosition/);
  assert.match(physics, /QueryFilterFlags\.ONLY_FIXED/);
  assert.match(physics, /QueryFilterFlags\.EXCLUDE_SENSORS/);
  assert.match(physics, /new RAPIER\.Capsule\(STANDING_HALF_HEIGHT, PLAYER_RADIUS\)/);
  assert.match(physics, /ignoredBodyHandles\.has\(body\.handle\)/);
  assert.match(lab, /this\.recoveryStandPosition = this\.physics\.findStandingRecoveryPosition\([\s\S]*ignoredBodies/);
  assert.match(lab, /const initialStand = this\.recoveryStandPosition\?\.clone\(\)/);
  assert.match(lab, /recovery\.retargetStandingPosition\(initialStand\)/);
  assert.doesNotMatch(lab.slice(lab.indexOf('  private startGetUp(): void'), lab.indexOf('  private finishGetUp(): void')), /findStandingRecoveryPosition\(\s*recovery\.standingPosition/);
  assert.match(lab, /private finishGetUp\(\)[\s\S]*findStandingRecoveryPosition\(recovery\.standingPosition\)/);
});


test('v76 recovery search checks a wider nearby ring without sacrificing standing capsule clearance', () => {
  const physics = readFileSync(new URL('../src/physics/PhysicsWorld.ts', import.meta.url), 'utf8');
  assert.match(physics, /\[0\.58, 0\], \[-0\.58, 0\], \[0, 0\.58\], \[0, -0\.58\]/);
  assert.match(physics, /const sampleOffsets = \[\[0, 0\], \[0\.16, 0\]/);
  assert.match(physics, /const rayOriginY = pelvis\.y \+ 1\.15/);
  assert.match(physics, /new RAPIER\.Capsule\(STANDING_HALF_HEIGHT, PLAYER_RADIUS\)/);
});

test('recovery does not respawn, heal or preserve a duplicate living corpse', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const start = lab.indexOf('  private finishGetUp(): void');
  const end = lab.indexOf('  private killPlayer(', start);
  const recovery = lab.slice(start, end);
  assert.doesNotMatch(recovery, /this\.health = MAX_HEALTH/);
  assert.doesNotMatch(recovery, /this\.corpses\.push/);
  assert.doesNotMatch(recovery, /chooseRespawnPoint/);
  assert.match(recovery, /this\.player\.teleport\(safe\)/);
  assert.match(recovery, /disposeTransientCorpse\(recovery\.root\)/);
  assert.match(recovery, /this\.player\.setInputEnabled\(false\)/);
  assert.match(recovery, /this\.playAnimation\('idle'/);
  assert.match(lab, /this\.recoveryCameraBlend = 0/);
});

test('get-up HUD mirrors the production Backrooms interaction prompt styling', () => {
  const css = readFileSync(new URL('../src/dev/AnimationLab.css', import.meta.url), 'utf8');
  assert.match(css, /\.animation-lab__get-up-prompt/);
  assert.match(css, /bottom: 15%/);
  assert.match(css, /min-height: 40px/);
  assert.match(css, /padding: 7px 11px/);
  assert.match(css, /backdrop-filter: blur\(8px\)/);
  assert.match(css, /border-radius: 3px/);
});


test('distinct blood contacts survive wall-to-floor and stair-to-head sequences', async () => {
  const { BloodImpactGate } = await import('../.movement-test-dist/dev/BloodImpactGate.js');
  const gate = new BloodImpactGate();
  const contact = { bodyId: 'core', surface: 'wall', position: {x:0,y:1,z:0}, speed:8, time:0 };
  assert.equal(gate.accept(contact), true);
  assert.equal(gate.accept({...contact,time:0.02}), false);
  assert.equal(gate.accept({...contact,time:0.08,position:{x:0.4,y:1,z:0}}), true);
  assert.equal(gate.accept({...contact,time:0.10,surface:'floor',position:{x:0.4,y:0,z:0}}), true);
  assert.equal(gate.accept({...contact,time:0.12,bodyId:'head',surface:'step',position:{x:0.5,y:0.2,z:0}}), true);
  assert.equal(gate.accept({...contact,time:0.5,surface:'wall'}), true);
  gate.reset();
  assert.equal(gate.accept(contact), true);
});

test('post-death physical impacts keep blood telemetry without applying HP damage twice', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const start = lab.indexOf('private processRagdollImpactEvents(');
  const end = lab.indexOf('private updateRagdollFallDamage(', start);
  const source = lab.slice(start,end);
  assert.doesNotMatch(source, /this\.ragdollMode === 'dead'\)\s*\{[\s\S]*drainImpactEvents\(\);\s*return;/);
  assert.match(source, /if \(alreadyDead\) continue;/);
  assert.match(source, /this\.bloodImpactGate\.accept/);
  assert.match(source, /impactVelocity: event\.velocityBefore/);
  assert.match(source, /this\.applyRagdollDamage\(/);
});


test('manual guard holds 1.5 seconds in both views and movement uses a 0.3 second release grace', async () => {
  const {
    combatGuardShouldPersist,
    FIRST_PERSON_GUARD_RELEASE_SECONDS,
    THIRD_PERSON_GUARD_LATCH_SECONDS,
    MANUAL_GUARD_RELEASE_SECONDS,
    MANUAL_GUARD_MOVEMENT_RELEASE_SECONDS,
    COMBAT_HIT_GUARD_LATCH_SECONDS,
  } = await import('../.movement-test-dist/dev/CombatGuardRules.js');
  assert.equal(MANUAL_GUARD_RELEASE_SECONDS, 1.5);
  assert.equal(FIRST_PERSON_GUARD_RELEASE_SECONDS, 1.5);
  assert.equal(THIRD_PERSON_GUARD_LATCH_SECONDS, 1.5);
  assert.equal(MANUAL_GUARD_MOVEMENT_RELEASE_SECONDS, 0.30);
  assert.equal(COMBAT_HIT_GUARD_LATCH_SECONDS, 5);
  const base = { viewMode: 'third-person', pointerHeld: false, latchSeconds: 1.5, latchReason: 'manual', moving: false, eligible: true };
  assert.equal(combatGuardShouldPersist(base), true);
  assert.equal(combatGuardShouldPersist({ ...base, moving: true, latchSeconds: 0.3 }), true, 'movement grace stays readable instead of snapping the fists down');
  assert.equal(combatGuardShouldPersist({ ...base, moving: true, latchSeconds: 0 }), false);
  assert.equal(combatGuardShouldPersist({ ...base, latchReason: 'hit', moving: true, latchSeconds: 5 }), true);
  assert.equal(combatGuardShouldPersist({ ...base, viewMode: 'first-person', pointerHeld: true }), true);
  assert.equal(combatGuardShouldPersist({ ...base, eligible: false, pointerHeld: true }), false);
});

test('combat lower-body selection reuses classic walking and strafe legs', async () => {
  const { combatLowerSelection } = await import('../.movement-test-dist/dev/CombatGuardRules.js');
  assert.deepEqual(combatLowerSelection(0, 0, false), { id: 'fight-idle', reverse: false });
  assert.deepEqual(combatLowerSelection(1, 0, true), { id: 'walking', reverse: false });
  assert.deepEqual(combatLowerSelection(-1, 0, true), { id: 'walking-backward', reverse: true });
  assert.deepEqual(combatLowerSelection(1, -1, true), { id: 'walking-forward-left', reverse: false });
  assert.deepEqual(combatLowerSelection(1, 1, true), { id: 'walking-forward-right', reverse: false });
  assert.deepEqual(combatLowerSelection(0.35, 1, true), { id: 'right-strafe-walking', reverse: false });
  assert.deepEqual(combatLowerSelection(0.35, -1, true), { id: 'left-strafe-walking', reverse: false });
});

test('combat mode bundles all five supplied FBX clips and creates split upper/lower mixer layers', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const layers = readFileSync(new URL('../src/dev/CombatAnimationLayers.ts', import.meta.url), 'utf8');
  for (const file of [
    'fight-idle.fbx', 'standing-idle-to-fight-idle.fbx', 'action-idle-to-fight-idle.fbx',
    'fight-idle-to-action-idle.fbx', 'fight-idle-to-standing-idle.fbx',
  ]) {
    const asset = new URL(`../public/assets/animation-lab/${file}`, import.meta.url);
    assert.ok(statSync(asset).size > 1000000, `${file} should contain the uploaded FBX`);
    assert.equal(readFileSync(asset).subarray(0, 18).toString(), 'Kaydara FBX Binary');
  }
  assert.match(lab, /prepareCombatAnimationLayers/);
  assert.match(lab, /createCombatUpperClip\(fight/);
  assert.match(lab, /createCombatLowerClip\(source/);
  assert.match(layers, /!isHips\(bone\) && !isLowerBody\(bone\)/);
  assert.match(layers, /isHips\(bone\) \|\| isLowerBody\(bone\)/);
});

test('right mouse guard blocks sprint and 3P received hits expose a five-second combat hook', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const controller = readFileSync(new URL('../src/player/PlayerController.ts', import.meta.url), 'utf8');
  assert.match(lab, /event\.button === 2/);
  assert.match(lab, /combatPointerHeld = true/);
  assert.match(lab, /combatLatchSeconds = COMBAT_HIT_GUARD_LATCH_SECONDS/);
  assert.match(lab, /notifyCombatHit\(\): void/);
  assert.match(lab, /receiveCombatHit\(amount = 0\): void/);
  assert.match(lab, /this\.combatLatchReason = 'hit'/);
  assert.match(lab, /applyCombatMovementRestriction\(delta, combatGuardBlocksSprint\(guarding\)\)/);
  assert.match(controller, /setSprintSuppressed\(suppressed: boolean\)/);
  assert.match(controller, /const sprintRequested = !this\.sprintSuppressed/);
});

test('manual 3P guard exits immediately into normal locomotion when RMB is released and movement resumes', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /combatGuardShouldPersist\([\s\S]*latchReason: this\.combatLatchReason[\s\S]*moving/);
  assert.match(lab, /if \(this\.combatPhase === 'exit' && moving\)/);
  assert.match(lab, /finishCombatImmediately\(state\)/);
  assert.match(lab, /lower\.id === 'walking-backward' \? 'walking' : lower\.id/);
});


test('combat entry and exit transitions preserve the previous idle family', async () => {
  const { combatEntryTransition, combatExitTransition } = await import('../.movement-test-dist/dev/CombatGuardRules.js');
  assert.equal(combatEntryTransition('sleeping'), 'standing-idle-to-fight-idle');
  assert.equal(combatEntryTransition('action'), 'action-idle-to-fight-idle');
  assert.equal(combatExitTransition('sleeping'), 'fight-idle-to-standing-idle');
  assert.equal(combatExitTransition('action'), 'fight-idle-to-action-idle');
});


test('combat torso counter-yaw keeps the guard anchored when locomotion clips rotate the pelvis', async () => {
  const { combatTorsoCounterYaw, COMBAT_TORSO_COUNTER_YAW_MAX_RADIANS } = await import('../.movement-test-dist/dev/CombatGuardRules.js');
  const deg = (value) => value * Math.PI / 180;
  assert.ok(Math.abs(combatTorsoCounterYaw(deg(-53), deg(0)) - deg(-53)) < 1e-8);
  assert.ok(Math.abs(combatTorsoCounterYaw(deg(-53), deg(-66)) - deg(13)) < 1e-8);
  assert.equal(combatTorsoCounterYaw(deg(-53), deg(66)), -COMBAT_TORSO_COUNTER_YAW_MAX_RADIANS, 'extreme opposite strafe is capped instead of over-twisting the waist');
  assert.equal(combatTorsoCounterYaw(Number.NaN, 0), 0);
});


test('melee profiles keep normal punch at 20% knockdown and double-click big punch at 50%', async () => {
  const { MELEE_ATTACKS, shouldKnockDownFromPunch } = await import('../.movement-test-dist/dev/CombatMeleeRules.js');
  assert.equal(MELEE_ATTACKS.punch.knockdownChance, 0.20);
  assert.equal(MELEE_ATTACKS['big-punch'].knockdownChance, 0.50);
  assert.equal(shouldKnockDownFromPunch('punch', 0.19), true);
  assert.equal(shouldKnockDownFromPunch('punch', 0.20), false);
  assert.equal(shouldKnockDownFromPunch('big-punch', 0.49), true);
  assert.equal(shouldKnockDownFromPunch('big-punch', 0.50), false);
  assert.equal(MELEE_ATTACKS['hook-counter'].unblockable, true);
});


test('v76 test NPC first hits favor hit reactions over instant ragdoll while big punches stay more dangerous', async () => {
  const { NPC_KNOCKDOWN_CHANCE, shouldNpcKnockDownFromPunch } = await import('../.movement-test-dist/dev/CombatMeleeRules.js');
  assert.equal(NPC_KNOCKDOWN_CHANCE.punch, 0.08);
  assert.equal(NPC_KNOCKDOWN_CHANCE['big-punch'], 0.30);
  assert.equal(shouldNpcKnockDownFromPunch('punch', 0.07), true);
  assert.equal(shouldNpcKnockDownFromPunch('punch', 0.08), false);
  assert.equal(shouldNpcKnockDownFromPunch('big-punch', 0.29), true);
  assert.equal(shouldNpcKnockDownFromPunch('big-punch', 0.30), false);
});

test('v76 hit reactions are tempo-normalized so ordinary follow-up punches do not automatically count as overlapping hits', async () => {
  const { hitReactionPlaybackRate, HIT_REACTION_TARGET_DURATION_SECONDS } = await import('../.movement-test-dist/dev/CombatMeleeRules.js');
  assert.equal(HIT_REACTION_TARGET_DURATION_SECONDS.punch, 0.58);
  assert.equal(HIT_REACTION_TARGET_DURATION_SECONDS['big-punch'], 0.74);
  assert.ok(Math.abs(1.45 / hitReactionPlaybackRate('punch', 1.45) - 0.58) < 1e-8);
  assert.ok(Math.abs(2.22 / hitReactionPlaybackRate('big-punch', 2.22) - 0.74) < 1e-8);
});

test('counter hook requires a quiet exact double tap and rejects button mashing', async () => {
  const { CombatCounterTapDetector } = await import('../.movement-test-dist/dev/CombatMeleeRules.js');
  const clean = new CombatCounterTapDetector();
  assert.equal(clean.tap(1.0, true).armed, true);
  assert.equal(clean.tap(1.16, true).pending, true);
  assert.equal(clean.update(1.35, false), true, 'a clean two-tap counter should confirm after the anti-spam quiet gap');

  const spam = new CombatCounterTapDetector();
  spam.tap(2.0, true);
  spam.tap(2.14, true);
  assert.equal(spam.tap(2.30, true).cancelledBySpam, true, 'even ordinary fast mashing should cancel before confirmation');
  assert.equal(spam.update(2.40, true), false, 'a third spam tap must cancel the hook');

  const noQuiet = new CombatCounterTapDetector();
  noQuiet.tap(3.0, false);
  assert.equal(noQuiet.tap(3.10, true).armed, false, 'already-spamming input cannot become a counter when the window opens');
});

test('counter timing only opens immediately before the hostile impact', async () => {
  const { npcCounterWindowOpen } = await import('../.movement-test-dist/dev/CombatMeleeRules.js');
  assert.equal(npcCounterWindowOpen(0.20, 0.70), false);
  assert.equal(npcCounterWindowOpen(0.40, 0.70), true);
  assert.equal(npcCounterWindowOpen(0.67, 0.70), false);
});

test('v67 bundles punch, three counter hooks and the supplied hit reaction library', () => {
  const assets = [
    'punching.fbx', 'hook-a.fbx', 'hook-b.fbx', 'hook-c.fbx',
    'hit-body.fbx', 'hit-groin-a.fbx', 'hit-groin-b.fbx',
    'hit-head-0.fbx', 'hit-head-1.fbx', 'hit-head-2.fbx', 'hit-head-3.fbx',
    'hit-head-4.fbx', 'hit-head-5.fbx', 'hit-head-6.fbx',
    'hit-head-light.fbx', 'hit-head-medium-a.fbx', 'hit-head-medium-b.fbx',
    'hit-head-big-a.fbx', 'hit-head-big-b.fbx', 'hit-head-big-c.fbx',
  ];
  for (const file of assets) {
    const path = new URL(`../public/assets/animation-lab/${file}`, import.meta.url);
    assert.ok(statSync(path).size > 1_000_000, `${file} should be bundled`);
  }
});

test('v99 rebuilds combat punches from four clean punch sources plus bounded hooks and removes authored Big Punch playback', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const assets = new URL('../public/assets/animation-lab/', import.meta.url);

  for (const [sourceId, file] of [
    ['punching-1', 'combat-punch-1.fbx'],
    ['punching-2', 'combat-punch-2.fbx'],
    ['punching-3-clean', 'punching.fbx'],
    ['punching-4-alt', 'punching-alt.fbx'],
  ]) {
    assert.match(lab, new RegExp(`id: '${sourceId}'.*file: '${file.replaceAll('.', '\\.').replaceAll('-', '\\-')}'`));
    assert.ok(readFileSync(new URL(file, assets)).length > 300_000, `${file} should stay bundled as a clean motion reference`);
  }

  assert.doesNotMatch(lab, /id: 'big-punching-[12]'/, 'authored Big Punch FBXs must not be loaded');
  assert.doesNotMatch(lab, /file: 'combat-big-punch-[12]\.fbx'/, 'authored Big Punch files must not participate in combat');
  assert.equal(existsSync(new URL('combat-big-punch-1.fbx', assets)), false, 'Big Punch 1 asset should be removed from the build');
  assert.equal(existsSync(new URL('combat-big-punch-2.fbx', assets)), false, 'Big Punch 2 asset should be removed from the build');
  assert.doesNotMatch(lab, /id: 'punching-3-heavy'/);
  assert.doesNotMatch(lab, /id: 'punching-4-elbow'/);

  assert.match(lab, /PUNCH_ATTACK_VARIANTS = \[[\s\S]*'jab-a'[\s\S]*'straight-c'[\s\S]*'cross-d'[\s\S]*'body-hook-a'[\s\S]*'body-hook-c'/);
  assert.match(lab, /BIG_PUNCH_ATTACK_VARIANTS = \[[\s\S]*'power-a'[\s\S]*'power-b'/);
  assert.match(lab, /COMBAT_ATTACK_VISUAL_PROFILES/);
  assert.match(lab, /character: 'jab'/);
  assert.match(lab, /character: 'cross'/);
  assert.match(lab, /character: 'long'/);
  assert.match(lab, /character: 'compact'/);
  assert.match(lab, /character: 'power'/);
  assert.match(lab, /combatAttackSourceFamily/);
  assert.match(lab, /previousFamily[\s\S]*alternateIndex/);
  assert.match(lab, /combatHeavyTapDetector\.tap\(this\.combatClock, held\)/);
  assert.match(lab, /combatHeavyTapDetector\.update\(this\.combatClock\)[\s\S]*confirmHeavyDoubleClick\(\)/);
});

test('v79 heavy punch needs an exact double click while spam remains normal punches', async () => {
  const { CombatHeavyTapDetector } = await import('../.movement-test-dist/dev/CombatMeleeRules.js');
  const clean = new CombatHeavyTapDetector();
  assert.equal(clean.tap(1.0, 0.06).normalPunch, true, 'first click stays a normal punch');
  const second = clean.tap(1.16, 0.05);
  assert.equal(second.pendingHeavy, true);
  assert.equal(second.normalPunch, false);
  assert.equal(clean.update(1.25), false);
  assert.equal(clean.update(1.29), true, 'exact double click confirms the heavy after the anti-spam gap');

  const spam = new CombatHeavyTapDetector();
  assert.equal(spam.tap(2.0, 0.04).normalPunch, true);
  assert.equal(spam.tap(2.14, 0.05).pendingHeavy, true);
  const third = spam.tap(2.22, 0.04);
  assert.equal(third.cancelledBySpam, true);
  assert.equal(third.normalPunch, true, 'third spam click falls back to ordinary punching');
  assert.equal(spam.update(2.40), false, 'spam can never resolve into a heavy');
  assert.equal(spam.tap(2.46, 0.04).normalPunch, true, 'spam lockout still accepts normal punches');

  const held = new CombatHeavyTapDetector();
  assert.equal(held.tap(3.0, 0.50).normalPunch, true, 'a long hold is no longer a heavy gesture');
  assert.equal(held.tap(3.14, 0.05).pendingHeavy, false);
});

test('guard locomotion uses short direction crossfades, phase-syncs Fight Idle and separates backward action', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /COMBAT_LOWER_IDLE_CROSSFADE_SECONDS = 0\.42/);
  assert.match(lab, /COMBAT_LOWER_DIRECTION_CROSSFADE_SECONDS = 0\.16/);
  assert.match(lab, /\['walking-backward', 'walking'\]/);
  assert.match(lab, /next\.thirdPerson\.time = this\.combatUpperLayer\.thirdPerson\.time % duration/);
  assert.match(lab, /next\.firstPerson\.time = this\.combatUpperLayer\.firstPerson\.time % duration/);
  assert.match(lab, /if \(this\.combatPhase === 'enter'\)[\s\S]*if \(moving\) \{[\s\S]*this\.startCombatLayers\(\)/);
});

test('v79 guard walks slower and raw sprint cleanly cancels guard before the five-second latch', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const player = readFileSync(new URL('../src/player/PlayerController.ts', import.meta.url), 'utf8');
  assert.match(lab, /COMBAT_GUARD_MOVE_SPEED_SCALE = 0\.84/);
  assert.match(lab, /const sprintRequested = this\.player\.isSprintRequested\(\) && intent\.forward > 0\.10/);
  assert.match(lab, /eligible: eligible && !sprintRequested/);
  assert.match(lab, /this\.player\.setMovementSpeedScale\(COMBAT_GUARD_MOVE_SPEED_SCALE\)/);
  assert.match(lab, /COMBAT_POST_GUARD_MOVE_TOTAL_SECONDS/);
  assert.match(player, /private movementSpeedScale = 1/);
  assert.match(player, /isSprintRequested\(\): boolean \{ return this\.input\.axes\.sprint; \}/);
  assert.match(player, /baseTargetSpeed \* this\.movementSpeedScale/);
});

test('v100 every strike is a bounded resampled additive delta with optional anatomical mirroring', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const layers = readFileSync(new URL('../src/dev/CombatAnimationLayers.ts', import.meta.url), 'utf8');
  const strikeStart = layers.indexOf('export const createCombatStrikeUpperClip');
  const strikeEnd = layers.indexOf('export const createCombatDodgeClip', strikeStart);
  const strike = layers.slice(strikeStart, strikeEnd);
  assert.match(lab, /createCombatStrikeUpperClip\([\s\S]*visual\.character/);
  assert.match(strike, /const outputTrackName = mirror \? mirrorCombatTrackName\(sourceTrack\.name\) : sourceTrack\.name/);
  assert.match(strike, /sampleNumericTrack\(sourceTrack, sourcePhase, sampleValues\)/);
  assert.match(strike, /delta\.copy\(inverseOrigin\)\.multiply\(sample\)\.normalize\(\)/);
  assert.match(strike, /if \(mirror\) mirrorCombatDelta\(delta\)/);
  assert.match(strike, /new THREE\.QuaternionKeyframeTrack\(outputTrackName, times, values\)/);
  assert.doesNotMatch(strike, /new THREE\.VectorKeyframeTrack/);
  assert.match(layers, /readonly mirror\?: boolean/);
});

test('first-person combat keeps both fists away from and below the POV without moving the gameplay camera', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /FIRST_PERSON_COMBAT_ARM_SCALE = 0\.97/);
  assert.match(lab, /FIRST_PERSON_COMBAT_BODY_FORWARD_OFFSET = 0\.30/);
  assert.match(lab, /FIRST_PERSON_COMBAT_BODY_UP_OFFSET = -0\.165/);
  assert.match(lab, /FIRST_PERSON_COMBAT_LATERAL_MAX = 0\.32/);
  assert.match(lab, /FIRST_PERSON_COMBAT_NEAR_HAND_DEPTH_TARGET = 0\.53/);
  assert.match(lab, /applyFirstPersonCombatFraming\(delta: number\)/);
  assert.match(lab, /firstPersonCombatHandA/);
  assert.match(lab, /firstPersonCombatHandB/);
  assert.match(lab, /const nearDepth = Math\.min/);
  assert.match(lab, /FIRST_PERSON_COMBAT_NEAR_HAND_DEPTH_TARGET - nearDepth/);
  assert.match(lab, /const rigBodyYaw = [\s\S]*combatPoseTarget > 0\.001[\s\S]*this\.continuousViewYaw/);
  assert.doesNotMatch(lab, /firstPersonCamera\.position[\s\S]{0,160}FIRST_PERSON_COMBAT_BODY_FORWARD_OFFSET/);
});

test('v100 strikes stay bounded additive upper-body deltas over continuously running Fight Idle', () => {
  const layers = readFileSync(new URL('../src/dev/CombatAnimationLayers.ts', import.meta.url), 'utf8');
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(layers, /const isStrikeTorsoBone/);
  assert.match(layers, /if \(!isStrikeAnimatedBone\(sourceBone\)\) continue/);
  assert.match(layers, /if \(!\(sourceTrack instanceof THREE\.QuaternionKeyframeTrack\)\) continue/);
  assert.match(layers, /delta\.copy\(inverseOrigin\)\.multiply\(sample\)/);
  assert.match(layers, /combatStrikeEnvelope/);
  assert.match(layers, /THREE\.AdditiveAnimationBlendMode/);
  assert.match(layers, /values\[offset \+ 3\] = 1/);
  assert.match(lab, /Fight Idle NEVER fades out for a strike/);
  const startAttack = lab.slice(lab.indexOf('private startCombatAttackLayer'), lab.indexOf('private finishCombatAttackLayer'));
  assert.doesNotMatch(startAttack, /combatUpperLayer\?\.thirdPerson\.fadeOut/);
});

test('v103 strike envelope holds contact and gives the arm a readable recoil instead of a tiny arcade snap', () => {
  const layers = readFileSync(new URL('../src/dev/CombatAnimationLayers.ts', import.meta.url), 'utf8');
  assert.match(layers, /const attackEnd = Math\.max\(0\.08, impact - \(heavy \? 0\.22 : 0\.20\)\)/);
  assert.match(layers, /const releaseStart = Math\.min\(0\.82, impact \+ \(heavy \? 0\.135 : 0\.120\)\)/);
  assert.match(layers, /const releaseEnd = Math\.min\(0\.97, impact \+ \(heavy \? 0\.340 : 0\.320\)\)/);
  assert.match(layers, /return 1 - smooth01\(\(t - releaseStart\)/);
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const finish = lab.slice(lab.indexOf('private finishCombatAttackLayer'), lab.indexOf('private setPlayerAimForward'));
  assert.match(finish, /pair\?\.thirdPerson\.fadeOut\(0\.075\)/);
  assert.match(finish, /pair\?\.firstPerson\.fadeOut\(0\.075\)/);
  assert.doesNotMatch(finish, /pair\?\.thirdPerson\.stop\(\)/);
});

test('v103 strikes use human-readable anticipation/contact/recoil durations while chaining removes dead time', async () => {
  const { combatAttackPlaybackRate, COMBAT_ATTACK_TARGET_DURATION_SECONDS } = await import('../.movement-test-dist/dev/CombatMeleeRules.js');
  assert.equal(COMBAT_ATTACK_TARGET_DURATION_SECONDS.punch, 0.66);
  assert.equal(COMBAT_ATTACK_TARGET_DURATION_SECONDS['big-punch'], 0.79);
  assert.equal(COMBAT_ATTACK_TARGET_DURATION_SECONDS['hook-counter'], 0.70);
  assert.ok(Math.abs(combatAttackPlaybackRate('punch', 1.86) - (1.86 / 0.66)) < 1e-8);
  assert.ok(Math.abs(1.86 / combatAttackPlaybackRate('punch', 1.86) - 0.66) < 1e-8);
  assert.ok(combatAttackPlaybackRate('big-punch', 3.2) > 3.0, 'power strike remains decisive without becoming a tiny twitch');
  assert.ok(combatAttackPlaybackRate('punch', 1.86, 0.84) > combatAttackPlaybackRate('punch', 1.86));
  assert.equal(combatAttackPlaybackRate('punch', Number.NaN), 1);
});

test('v117 NPC keeps Fight Idle upper-body guard layered over locomotion and additive strikes', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /idleNpcCombatUpperAction = this\.idleNpcMixer\.clipAction\(this\.combatUpperLayer\.clip\)/);
  assert.match(lab, /idleNpcCombatLowerActions\.set\(id, action\)/);
  assert.match(lab, /this\.startNpcCombatGuardLayers\('walking', walkRate, true\)/);
  assert.match(lab, /this\.startNpcCombatGuardLayers\('fight-idle', 1\)/);
  assert.match(lab, /this\.idleNpcCombatAttackActions\.get\(finished\.animation\)\?\.fadeOut\(0\.075\)/);
  assert.match(lab, /combatAttackPlaybackRate\(kind, pair\.clip\.duration, visual\?\.tempoMultiplier \?\? 1\)/);
});

test('guard and strikes keep shared root axes without per-move yaw offsets', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /const combatFacingActive = this\.combatAttack !== null[\s\S]*this\.combatPhase === 'guard'/);
  // The former direct yaw assignment is intentionally gone. Actual turn-rate
  // and handoff continuity are covered by action-transitions-integration.
  assert.doesNotMatch(lab, /firstPersonCombatStanceYawCorrection/);
  assert.doesNotMatch(lab, /combatAttackForwardYawCorrection/);
});

test('v84 first-person framing uses the real pair of hands and smooth solver responses', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /FIRST_PERSON_COMBAT_LATERAL_MAX = 0\.32/);
  assert.match(lab, /FIRST_PERSON_COMBAT_LATERAL_RESPONSE = 11\.0/);
  assert.match(lab, /firstPersonCombatHandCenter[\s\S]*firstPersonCombatHandA[\s\S]*firstPersonCombatHandB/);
  assert.match(lab, /multiplyScalar\(0\.5\)/);
  assert.match(lab, /lateralTarget = THREE\.MathUtils\.clamp\([\s\S]*-lateral,/);
  assert.match(lab, /firstPersonCombatFramingLocked/);
  assert.match(lab, /FIRST_PERSON_COMBAT_FRAMING_SETTLE_SECONDS = 0\.26/);
  assert.match(lab, /let lateralTarget = combatVisible \? this\.firstPersonCombatLateralOffset : 0/);
});

test('v85 first-person combat rig is pulled slightly back while staying lowered', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /FIRST_PERSON_COMBAT_BODY_FORWARD_OFFSET = 0\.30/);
  assert.match(lab, /FIRST_PERSON_COMBAT_BODY_UP_OFFSET = -0\.165/);
  assert.match(lab, /this\.firstPersonHipTarget\.y \+= FIRST_PERSON_COMBAT_BODY_UP_OFFSET/);
  assert.doesNotMatch(lab, /firstPersonCamera\.position[\s\S]{0,120}FIRST_PERSON_COMBAT_BODY_UP_OFFSET/);
});

test('v77 get-up normalizes long authored takes and cannot deadlock on the final clearance recheck', () => {
  const recovery = readFileSync(new URL('../src/dev/GetUpRecovery.ts', import.meta.url), 'utf8');
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(recovery, /const targetDuration = side === 'back' \? 2\.15 : 2\.45/);
  assert.match(recovery, /clip\.duration \/ targetDuration/);
  assert.match(lab, /const revalidatedSafe = this\.physics\.findStandingRecoveryPosition\(recovery\.standingPosition\)/);
  assert.match(lab, /const safe = revalidatedSafe \?\? this\.recoveryStandPosition\?\.clone\(\) \?\? recovery\.standingPosition\.clone\(\)/);
  const finish = lab.slice(lab.indexOf('  private finishGetUp(): void'), lab.indexOf('  private killPlayer(', lab.indexOf('  private finishGetUp(): void')));
  assert.doesNotMatch(finish, /ESPACE INSUFFISANT · ATTENDEZ/);
});


test('v78 guard prevents extreme downward first-person look and restores full range outside guard', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const player = readFileSync(new URL('../src/player/PlayerController.ts', import.meta.url), 'utf8');
  assert.match(player, /COMBAT_GUARD_LOOK_DOWN_LIMIT = THREE\.MathUtils\.degToRad\(58\)/);
  assert.match(player, /setCombatGuardLookConstraint\(enabled: boolean\)/);
  assert.match(player, /this\.controls\.maxPolarAngle = enabled[\s\S]*Math\.PI \* 0\.5 \+ COMBAT_GUARD_LOOK_DOWN_LIMIT[\s\S]*Math\.PI/);
  assert.match(player, /const minimumPitch = -COMBAT_GUARD_LOOK_DOWN_LIMIT/);
  assert.match(lab, /this\.player\.setCombatGuardLookConstraint\(combatPoseTarget > 0\.001/);
  assert.match(lab, /if \(!firstPerson \|\| this\.ragdoll \|\| this\.recovery\) this\.player\?\.setCombatGuardLookConstraint\(false\)/);
});


test('v85 first-person combat framing protects the nearest fist and locks across locomotion', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /FIRST_PERSON_COMBAT_ARM_SCALE = 0\.97/);
  assert.match(lab, /FIRST_PERSON_COMBAT_HAND_SCALE = 1\.0/);
  assert.match(lab, /FIRST_PERSON_COMBAT_BODY_FORWARD_OFFSET = 0\.30/);
  assert.match(lab, /FIRST_PERSON_COMBAT_BODY_UP_OFFSET = -0\.165/);
  assert.match(lab, /FIRST_PERSON_COMBAT_NEAR_HAND_DEPTH_TARGET = 0\.53/);
  assert.match(lab, /FIRST_PERSON_COMBAT_HAND_Y_TARGET = -0\.18/);
  assert.match(lab, /FIRST_PERSON_PELVIS_BEHIND_CAMERA = -0\.50/);
  assert.match(lab, /Math\.min\([\s\S]*firstPersonCombatHandA[\s\S]*firstPersonCombatHandB/);
  assert.match(lab, /FIRST_PERSON_COMBAT_NEAR_HAND_DEPTH_TARGET - nearDepth/);
  assert.match(lab, /this\.firstPersonCombatFramingLocked = true/);
  assert.match(lab, /this\.firstPersonCombatFramingSettleSeconds/);
  assert.match(lab, /COMBAT_LOWER_IDLE_CROSSFADE_SECONDS = 0\.42/);
  assert.doesNotMatch(lab, /firstPersonCamera\.position[\s\S]{0,160}FIRST_PERSON_COMBAT_BODY_(?:FORWARD|UP)_OFFSET/);
});

test('v81 living get-up disables the articulated ragdoll instead of removing Rapier bodies during gameplay', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const ragdoll = readFileSync(new URL('../src/physics/RagdollSystem.ts', import.meta.url), 'utf8');
  const start = lab.slice(lab.indexOf('  private startGetUp(): void'), lab.indexOf('  private finishGetUp(): void'));
  assert.match(start, /ragdoll\.suspendForRecovery\(\)/);
  assert.doesNotMatch(start, /ragdoll\.dispose\(\)/);
  assert.match(ragdoll, /suspendForRecovery\(\): void/);
  assert.match(ragdoll, /body\.setEnabled\(false\)/);
  assert.match(ragdoll, /body\.setLinvel\(zero, false\)/);
  assert.match(ragdoll, /body\.setAngvel\(zero, false\)/);
  const suspend = ragdoll.slice(ragdoll.indexOf('  suspendForRecovery(): void'), ragdoll.indexOf('  dispose(): void'));
  assert.doesNotMatch(suspend, /removeRigidBody/);
  assert.doesNotMatch(ragdoll, /physics\.world\.removeRigidBody/);
});


test('v82 E get-up request is sticky and retries automatically instead of becoming a no-op', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /private recoveryRequested = false/);
  assert.match(lab, /this\.recoveryRequested = true;[\s\S]{0,220}this\.refreshRecoveryAvailability\(true\)/);
  assert.match(lab, /this\.refreshRecoveryAvailability\(this\.recoveryRequested\);[\s\S]{0,120}this\.recoveryRequested && this\.canStartRecovery\(\)/);
  assert.match(lab, /ragdoll\.suspendForRecovery\(\);[\s\S]{0,80}this\.recoveryRequested = false/);
});

test('v82 recovery retries around the cached pre-ragdoll standing capsule without teleporting out of deep pits', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const physics = readFileSync(new URL('../src/physics/PhysicsWorld.ts', import.meta.url), 'utf8');
  assert.match(lab, /this\.physics\.getStandingPosition\(this\.recoveryEntryStandPosition\)/);
  assert.match(lab, /horizontalDistance <= 3\.25 && verticalDistance <= 1\.45/);
  assert.match(lab, /this\.recoveryEntryStandPosition, ignoredBodies, true/);
  assert.match(physics, /wideSearch = false/);
  assert.match(physics, /\[1\.05, 0\], \[-1\.05, 0\], \[0, 1\.05\], \[0, -1\.05\]/);
});


test('normal punches require an active guard while F+LMB stays defensive-only and front-facing', async () => {
  const { combatNormalAttackAllowed, combatHookCounterAllowed, combatCounterFacingAllowed } = await import('../.movement-test-dist/dev/CombatMeleeRules.js');
  assert.equal(combatNormalAttackAllowed(false, false), false, 'LMB outside guard must not start a punch');
  assert.equal(combatNormalAttackAllowed(true, false), true, 'LMB may punch while the guard is raised');
  assert.equal(combatNormalAttackAllowed(false, true), false, 'F+LMB must never leak into ordinary punches');
  assert.equal(combatHookCounterAllowed(true, true), true);
  assert.equal(combatHookCounterAllowed(true, false), false, 'F spam outside a threat window must do nothing');
  assert.equal(combatHookCounterAllowed(false, true), false, 'the hook needs the F modifier');
  assert.equal(combatCounterFacingAllowed(0.45), true);
  assert.equal(combatCounterFacingAllowed(0.2), false, 'attacks from behind/side must not be countered');

  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /event\.code === 'KeyF'[\s\S]*combatCounterModifierHeld = true/);
  assert.match(lab, /if \(this\.combatCounterModifierHeld\) \{[\s\S]*combatHookCounterAllowed\(true, this\.npcCounterWindowIsOpen\(\)\)[\s\S]*this\.executeHookCounter\(\)/);
  assert.match(lab, /playerFacesNpcForCounter\(\)[\s\S]*combatCounterFacingAllowed/);
  assert.match(lab, /private combatAttackGuardActive\(\): boolean[\s\S]*combatPhase === 'enter'[\s\S]*combatPhase === 'guard'/);
  assert.match(lab, /combatNormalAttackAllowed\(this\.combatAttackGuardActive\(\), false\)/);
  assert.doesNotMatch(lab, /if \(event\.ctrlKey\)/);
});

test('v83 rapid forward Q-D-Q-D animation input falls back to straight walking instead of blending opposite strafes', async () => {
  const { ForwardLateralAnimationGate, FORWARD_LATERAL_ANIMATION_COMMIT_SECONDS } = await import('../.movement-test-dist/dev/DirectionalLocomotionRules.js');
  const gate = new ForwardLateralAnimationGate();
  const dt = 1 / 60;
  let result = 0;
  for (let frame = 0; frame < 30; frame += 1) {
    result = gate.update(1, frame % 2 === 0 ? -1 : 1, dt);
    assert.equal(result, 0, 'rapid opposite-side spam should visually stay on the forward walk');
  }
  const holdFrames = Math.ceil(FORWARD_LATERAL_ANIMATION_COMMIT_SECONDS / dt) + 2;
  for (let frame = 0; frame < holdFrames; frame += 1) result = gate.update(1, 1, dt);
  assert.equal(result, 1, 'a deliberate held side must still enter the forward-right diagonal');
  for (let frame = 0; frame < 20; frame += 1) {
    result = gate.update(1, frame % 2 === 0 ? -1 : 1, dt);
    assert.equal(result, 0, 'spam must stay straight even after a diagonal had already been committed');
  }
  assert.equal(gate.update(0, -1, dt), -1, 'pure strafing remains immediate');

  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /forwardLateralAnimationGate\.update\(/);
  assert.match(lab, /forwardDiagonalAnimation\([\s\S]*travelRight/);
  assert.match(lab, /combatLowerSelection\(intent\.forward, this\.visualMovementRightIntent, moving\)/);
});

test('v83 repeated full turns rebase equivalent yaw and inherit live mouse rotation once the body follows', async () => {
  const { rebaseAngleNear, wrapAngleRadians } = await import('../.movement-test-dist/dev/ThirdPersonLook.js');
  const view = Math.PI * 10.25;
  const samePoseManyTurnsBehind = Math.PI * 0.25;
  const rebased = rebaseAngleNear(view, samePoseManyTurnsBehind);
  assert.ok(Math.abs(wrapAngleRadians(rebased - view)) < 1e-9);
  assert.ok(Math.abs(rebased - view) <= Math.PI + 1e-9, 'numeric body yaw must never keep a multi-revolution debt');

  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /this\.bodyYaw = rebaseAngleNear\(this\.continuousViewYaw, this\.bodyYaw\)/);
  assert.match(lab, /Once the pelvis has committed to a turn[\s\S]*this\.bodyYaw \+= firstPersonViewYawDelta/);
});

test('v83 transient punch stance does not create a five-second defensive guard latch', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const startAttack = lab.slice(lab.indexOf('private startCombatAttackLayer'), lab.indexOf('private finishCombatAttackLayer'));
  assert.doesNotMatch(startAttack, /combatLatchSeconds = THIRD_PERSON_GUARD_LATCH_SECONDS/);
  assert.doesNotMatch(startAttack, /combatLatchReason = 'manual'/);
  assert.match(lab, /private combatDefensiveGuardActive\(\): boolean/);
});


test('manual guard release is 1.5 seconds and moving without RMB shortens it to 0.3 seconds', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const rules = readFileSync(new URL('../src/dev/CombatGuardRules.ts', import.meta.url), 'utf8');
  assert.match(rules, /MANUAL_GUARD_RELEASE_SECONDS = 1\.5/);
  assert.match(rules, /MANUAL_GUARD_MOVEMENT_RELEASE_SECONDS = 0\.30/);
  assert.match(lab, /this\.combatLatchSeconds = MANUAL_GUARD_RELEASE_SECONDS/);
  assert.match(lab, /moving[\s\S]*this\.combatLatchReason === 'manual'[\s\S]*MANUAL_GUARD_MOVEMENT_RELEASE_SECONDS/);
  assert.match(lab, /COMBAT_GUARD_MOVE_RELEASE_BLEND_SECONDS = 0\.14/);
  assert.match(lab, /COMBAT_GUARD_MOVE_UPPER_RELEASE_BLEND_SECONDS = 0\.38/);
  assert.match(lab, /movingManualRelease[\s\S]*combatUpperLayer\?\.thirdPerson\.fadeOut\(COMBAT_GUARD_MOVE_UPPER_RELEASE_BLEND_SECONDS\)/);
  assert.match(lab, /Make the lower combat cycle the source of the normal locomotion[\s\S]*currentAction = releaseLowerPair\.thirdPerson/);
});

test('v85 first-person guard framing is solved once then held through walk and stop', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /FIRST_PERSON_COMBAT_FRAMING_SETTLE_SECONDS = 0\.26/);
  assert.match(lab, /const canSolveGuardFrame = combatVisible[\s\S]*this\.combatPhase === 'guard'[\s\S]*!this\.firstPersonCombatFramingLocked/);
  assert.match(lab, /this\.firstPersonCombatFramingLocked = true/);
  assert.match(lab, /let depthTarget = combatVisible \? this\.firstPersonCombatDepthOffset : 0/);
  assert.doesNotMatch(lab, /firstPersonCombatFramingHoldSeconds/);
});

test('v108 first-person combat isolates the visible guard from shoulder, torso and lower-body geometry', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /fpCombatArmMask/);
  assert.match(lab, /combatDistalArmBoneIndices/);
  assert.match(lab, /combatUpperArmBoneIndices/);
  assert.match(lab, /animation-lab-first-person-viewmodel-v13-ground-kick/);
  assert.match(lab, /float fpCombatKickMask = max\(vFpCombatArmMask, vFpLowerBodyMask\)/);
  assert.match(lab, /float fpVisibleMask = mix\(fpExplorationMask, fpCombatMask, fpCombatIsolation\)/);
  assert.match(lab, /combatPoseTarget > 0\.001[\s\S]*\? 1[\s\S]*smoothstep\(this\.firstPersonCombatPoseBlend, 0\.08, 0\.72\)/);
  const combatMaskStart = lab.indexOf('const combatDistalArmBoneIndices');
  const combatMaskEnd = lab.indexOf('if (!lowerBoneIndices.size)', combatMaskStart);
  const combatMaskSource = lab.slice(combatMaskStart, combatMaskEnd);
  assert.doesNotMatch(combatMaskSource, /combatDistalArmBoneIndices\.add\(index\)[\s\S]*shoulder/);
  assert.doesNotMatch(combatMaskSource, /combatUpperArmBoneIndices\.add\(index\)[\s\S]*shoulder/);
  assert.doesNotMatch(lab, /fpViewDepth/);
});

test('v87 rapid pure strafe reversals keep one walking cycle until the opposite direction is intentional', async () => {
  const { ForwardLateralAnimationGate, STRAFE_DIRECTION_COMMIT_SECONDS } = await import('../.movement-test-dist/dev/DirectionalLocomotionRules.js');
  const gate = new ForwardLateralAnimationGate();
  const dt = 1 / 60;
  assert.equal(gate.update(0, -1, dt), -1);
  for (let frame = 0; frame < 24; frame += 1) {
    const raw = frame % 2 === 0 ? 1 : -1;
    assert.equal(gate.update(0, raw, dt), -1, 'Q-D spam must not restart opposing strafe clips every frame');
  }
  let result = -1;
  for (let elapsed = 0; elapsed < STRAFE_DIRECTION_COMMIT_SECONDS + dt * 2; elapsed += dt) result = gate.update(0, 1, dt);
  assert.equal(result, 1, 'a deliberate held opposite direction must still commit');
});

test('v87 locomotion switches preserve the current gait phase instead of restarting at frame zero', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /preserveLocomotionPhase[\s\S]*next\.time = alignGaitPhase\(previousPhase, oldLandmark, newLandmark\) \* loaded\.clip\.duration/);
  assert.match(lab, /preserveStepPhase[\s\S]*next\.thirdPerson\.time = thirdPersonPhase \* Math\.max\(1e-5, next\.clip\.duration\)/);
});

test('v87 intentional gait changes bypass the generic candidate delay after chatter filtering', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const start = lab.indexOf('private requestAutoAnimation');
  const end = lab.indexOf('private playAutoImmediate', start);
  const source = lab.slice(start, end);
  assert.match(source, /isCycleLocomotionAnimation\(this\.currentAnimation\)[\s\S]*isCycleLocomotionAnimation\(id\)[\s\S]*this\.playAnimation\(id, loop, rate, reverse\)/);
});

test('v93 ordinary punches use six clean variants and never select removed heavy/elbow/big FBX motions', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const poolStart = lab.indexOf('const PUNCH_ATTACK_VARIANTS');
  const poolEnd = lab.indexOf('const BIG_PUNCH_ATTACK_VARIANTS', poolStart);
  const pool = lab.slice(poolStart, poolEnd);
  for (const variant of ['jab-a', 'cross-b', 'long-a', 'compact-b', 'cross-a', 'jab-b']) {
    assert.match(pool, new RegExp(`'${variant}'`));
  }
  assert.doesNotMatch(pool, /punch-3-heavy/);
  assert.doesNotMatch(pool, /punch-4-elbow/);
  assert.doesNotMatch(pool, /big-punch/);
  assert.doesNotMatch(lab, /combat-big-punch-[12]\.fbx/);
});

test('v87 guard stop keeps torso correction active through the Fight Idle crossfade', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const start = lab.indexOf('private applyCombatGuardTorsoAlignment');
  const end = lab.indexOf('private applyWorldYawOffset', start);
  const source = lab.slice(start, end);
  assert.doesNotMatch(source, /combatLowerActive === 'fight-idle'/);
  assert.match(source, /combatTorsoCounterYaw\(fightYaw, pelvisYaw\)/);
});

test('v94 lethal high falls stay passive until a grounded whole-body terminal rest', () => {
  const ragdoll = readFileSync(new URL('../src/physics/RagdollSystem.ts', import.meta.url), 'utf8');
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /fatalDrop[\s\S]*beginFatalFallSettling\(incomingSpeed\)[\s\S]*markRagdollDead/,
    'the fatal floor impact must explicitly switch the active fall ragdoll into the passive settling path');
  assert.match(ragdoll, /beginFatalFallSettling\(impactSpeed: number\)/);
  assert.match(ragdoll, /this\.activeResponseScale = 0/,
    'active fall reflexes must stop injecting motion after the lethal landing');
  const fatalBranchStart = ragdoll.indexOf('if (this.fatalFallImpactElapsed >= 0) {');
  const fatalBranchEnd = ragdoll.indexOf('} else {', fatalBranchStart);
  const fatalBranch = ragdoll.slice(fatalBranchStart, fatalBranchEnd);
  assert.doesNotMatch(fatalBranch, /applyFinalSupportRelease/,
    'violent floor impacts must never reuse the generic anti-perch helper that can create a planted-limb pivot');
  assert.doesNotMatch(ragdoll, /applyFatalFallAntiOrbit/,
    'fatal settling must not project per-limb velocities every substep; that can fight joints and create orbit forces');
  assert.match(ragdoll, /private updateFatalFallTerminalRest\(delta: number\): boolean/);
  assert.match(ragdoll, /RAPIER\.QueryFilterFlags\.ONLY_FIXED/,
    'terminal rest must prove support against fixed world geometry, not another ragdoll limb');
  assert.match(ragdoll, /fatalFallTerminalRestEligible\(\{/);
  assert.match(ragdoll, /fatalFallGroundRestHold < FATAL_FALL_TERMINAL_REST_HOLD_SECONDS/,
    'support must remain stable for a hold window before terminal sleep');
  assert.match(ragdoll, /for \(const body of this\.ownedBodies\)[\s\S]*body\.sleep\(\)/,
    'once genuinely down, the entire articulated island including joint frames must sleep together');
  assert.match(ragdoll, /FATAL_FALL_DAMPING_DELAY_SECONDS = 0\.18/,
    'damping must not clamp the body on the exact impact frame');
  assert.match(ragdoll, /FATAL_FALL_AWAKE_GRACE_SECONDS = 0\.52/,
    'the whole ragdoll must remain dynamic long enough to finish folding onto the floor');
  assert.match(ragdoll, /fatalFallImpactElapsed < FATAL_FALL_SETTLE_GUARD_SECONDS/,
    'a long pre-impact fall must not satisfy the generic settle timer immediately on landing');
});

test('fatal-fall terminal rest rejects mid-air or sliding bodies and accepts grounded late orbit', () => {
  const base = {
    elapsedSinceImpact: FATAL_FALL_TERMINAL_REST_MIN_SECONDS + 0.3,
    coreSupported: true,
    supportCount: 4,
    verticalSpan: 0.54,
    meanHorizontalSpeed: 0.08,
    meanVerticalSpeed: 0.02,
    maxAbsVerticalSpeed: 0.18,
    maxLinearSpeed: 0.72,
    maxAngularSpeed: 1.5,
    coherentAngularSpeed: 0.12,
  };
  assert.equal(fatalFallTerminalRestEligible(base), true, 'a genuinely down quiet corpse may enter terminal rest');
  assert.equal(fatalFallTerminalRestEligible({ ...base, elapsedSinceImpact: 0.2 }), false, 'never freeze immediately after impact');
  assert.equal(fatalFallTerminalRestEligible({ ...base, coreSupported: false }), false, 'unsupported torso must keep falling');
  assert.equal(fatalFallTerminalRestEligible({ ...base, supportCount: 1 }), false, 'one planted limb is not enough support');
  assert.equal(fatalFallTerminalRestEligible({ ...base, verticalSpan: 1.18 }), false, 'half-standing/hanging ragdolls must stay dynamic');
  assert.equal(fatalFallTerminalRestEligible({ ...base, maxAbsVerticalSpeed: 0.9 }), false, 'a limb still dropping vertically must not be frozen');
  assert.equal(fatalFallTerminalRestEligible({ ...base, meanHorizontalSpeed: 1.1 }), false, 'a corpse still sliding across the floor must remain dynamic');
  assert.equal(fatalFallTerminalRestEligible({
    ...base,
    maxLinearSpeed: 2.1,
    maxAngularSpeed: 5.4,
    coherentAngularSpeed: 0.85,
  }), true, 'a grounded coherent orbit is safe to terminate once vertical collapse is complete');
  assert.ok(FATAL_FALL_TERMINAL_REST_HOLD_SECONDS >= 0.2, 'ground support must be continuous, not a one-frame contact');
});


test('v108 first-person arm safety only lets visible fists and forearms push the combat viewmodel', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /FIRST_PERSON_HAND_SAFE_DEPTH = 0\.28/);
  assert.match(lab, /FIRST_PERSON_FOREARM_SAFE_DEPTH = 0\.29/);
  assert.match(lab, /FIRST_PERSON_ARM_SAFETY_MAX_FORWARD = 0\.24/);
  assert.match(lab, /private applyFirstPersonArmCameraSafety\(delta: number\): void/);
  assert.match(lab, /this\.firstPersonCamera\.getWorldDirection\(this\.firstPersonArmSafetyViewForward\)/);
  assert.match(lab, /requireDepth\(this\.firstPersonHandBones, FIRST_PERSON_HAND_SAFE_DEPTH\)/);
  assert.match(lab, /requireDepth\(this\.firstPersonForearmBones, FIRST_PERSON_FOREARM_SAFE_DEPTH\)/);
  assert.doesNotMatch(lab, /requireDepth\(this\.firstPersonUpperArmBones/);
  assert.doesNotMatch(lab, /requireDepth\(this\.firstPersonShoulderBones/);
  assert.doesNotMatch(lab, /FIRST_PERSON_UPPER_ARM_SAFE_DEPTH/);
  assert.doesNotMatch(lab, /FIRST_PERSON_SHOULDER_SAFE_DEPTH/);
  assert.match(lab, /if \(targetForwardOffset > this\.firstPersonArmSafetyForwardOffset\)/);
  assert.match(lab, /addScaledVector\([\s\S]*this\.firstPersonArmSafetyViewForward,[\s\S]*this\.firstPersonArmSafetyForwardOffset/);
});

test('v101 punch layer suppresses torso folding, gives the striking arm authority and keeps the wrist stable', () => {
  const layers = readFileSync(new URL('../src/dev/CombatAnimationLayers.ts', import.meta.url), 'utf8');
  assert.match(layers, /const guardArm = side !== null && side !== strikingSide/);
  assert.match(layers, /gain: \(guardArm \? 0\.12 : 0\.84\)/);
  assert.match(layers, /gain: \(guardArm \? 0\.09 : 1\.06\)/);
  assert.match(layers, /gain: \(guardArm \? 0\.06 : 0\.78\)/);
  assert.match(layers, /gain: \(guardArm \? 0\.02 : 0\.065\)/);
  assert.match(layers, /maxRadians: THREE\.MathUtils\.degToRad\(4\.5\)/);
  assert.match(layers, /maxRadians: THREE\.MathUtils\.degToRad\(8\.5\)/);
  assert.match(layers, /if \(normalizedBone\.endsWith\('hand'\)\) return 0\.34/);
  assert.match(layers, /angularDelta > stability\.maxRadians/);
});

test('v100 first light impact is never delayed for double-click classification', async () => {
  const { CombatHeavyTapDetector, HEAVY_DOUBLE_TAP_MAX_SECONDS } = await import('../.movement-test-dist/dev/CombatMeleeRules.js');
  const detector = new CombatHeavyTapDetector();
  detector.tap(1.00, 0.05);
  assert.equal(detector.isAwaitingSecondTap(1.00 + HEAVY_DOUBLE_TAP_MAX_SECONDS * 0.5), true);
});

test('v103 melee keeps only a tiny post-recoil safety lock because flow happens inside the visible recoil', async () => {
  const { COMBAT_ATTACK_RECOVERY_SECONDS, combatAttackRecoverySeconds } = await import('../.movement-test-dist/dev/CombatMeleeRules.js');
  assert.equal(COMBAT_ATTACK_RECOVERY_SECONDS.punch, 0.025);
  assert.equal(COMBAT_ATTACK_RECOVERY_SECONDS['big-punch'], 0.045);
  assert.equal(COMBAT_ATTACK_RECOVERY_SECONDS['hook-counter'], 0.030);
  assert.equal(combatAttackRecoverySeconds('punch'), 0.025);
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /this\.combatAttackRecoverySeconds = Math\.max\([\s\S]*combatAttackRecoverySeconds\(finished\.kind\)/);
  assert.match(lab, /this\.combatAttackRecoverySeconds - Math\.max\(0, delta\)/);
});

test('v95 guard hold soft-locks the nearby living opponent and accepted strikes step toward the target', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const controller = readFileSync(new URL('../src/player/PlayerController.ts', import.meta.url), 'utf8');
  assert.match(lab, /COMBAT_LOCK_ON_MAX_DISTANCE = 6\.25/);
  assert.match(lab, /!this\.combatPointerHeld[\s\S]*this\.combatLockOnActive = false/);
  assert.match(lab, /this\.player\.focusCombatAimYaw\([\s\S]*COMBAT_LOCK_ON_RESPONSE[\s\S]*COMBAT_LOCK_ON_MAX_DEGREES_PER_SECOND/);
  assert.match(lab, /this\.updateCombatLockOn\(rawDelta\);[\s\S]*this\.updateAvatarTransform\(rawDelta\)/);
  assert.match(lab, /private applyCombatAttackLunge\([\s\S]*this\.player\.applyCombatLunge/);
  assert.match(controller, /focusCombatAimYaw\(/);
  assert.match(controller, /applyCombatLunge\(/);
  assert.match(controller, /private combatDriveDuration = 0/);
  assert.match(controller, /private combatDriveElapsed = 0/);
  assert.match(controller, /combatDriveEnvelope\(phase = this\.combatDrivePhase\(\)\)/);
  assert.match(controller, /MOVEMENT_TUNING\.locomotion\.walkSpeed \* 1\.58/);
});

test('v98 F+LMB performs a visible duck/side evade before launching the counter', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const start = lab.indexOf('private executeHookCounter');
  const end = lab.indexOf('private requestNormalCombatPunch', start);
  const source = lab.slice(start, end);
  assert.match(source, /this\.npcAttack = null/);
  assert.match(source, /COMBAT_DODGE_COUNTER_SIDE_SPEED/);
  assert.match(source, /COMBAT_DODGE_COUNTER_BACK_SPEED/);
  assert.match(source, /this\.player\.applyCombatLunge\(this\.meleeForward, dodgeSpeed, COMBAT_DODGE_COUNTER_MOVE_SECONDS, 0\.48, 'impulse'\)/);
  assert.match(source, /this\.combatCounterDodgeSide \*= -1/);
  assert.match(source, /COMBAT_DODGE_COUNTER_STRIKE_AT_SECONDS[\s\S]*this\.startCombatAttackLayer\('hook-counter'/);
});

test('v102 melee spacing separates clinch shove, scripted boxing range, step-in range and remote whiffs', async () => {
  const rules = await import('../.movement-test-dist/dev/CombatMeleeRules.js');
  assert.equal(rules.combatMeleeSpacingForDistance(0.55), 'close');
  assert.equal(rules.combatMeleeSpacingForDistance(0.70), 'close');
  assert.equal(rules.combatMeleeSpacingForDistance(0.74), 'close');
  assert.equal(rules.combatMeleeSpacingForDistance(0.80), 'medium');
  assert.equal(rules.combatMeleeSpacingForDistance(1.20), 'medium');
  assert.equal(rules.combatMeleeSpacingForDistance(2.10), 'far');
  assert.equal(rules.combatMeleeSpacingForDistance(3.10), 'out');
  assert.equal(rules.COMBAT_MELEE_IDEAL_PUNCH_DISTANCE, 0.80);
  assert.equal(rules.COMBAT_MELEE_IDEAL_STEP_DISTANCE, 0.84);
  assert.equal(rules.COMBAT_MELEE_WHIF_FORWARD_METERS, 0.58);
  assert.equal(rules.COMBAT_MELEE_WHIF_DRIVE_SECONDS, 0.38);
});

test('v97 lock-on acquires only a target already in the forward view cone', async () => {
  const rules = await import('../.movement-test-dist/dev/CombatMeleeRules.js');
  assert.equal(rules.combatLockOnFacingAllowed(0.80, false), true);
  assert.equal(rules.combatLockOnFacingAllowed(0.21, false), false, 'a target outside the acquire cone must not drag the camera around');
  assert.equal(rules.combatLockOnFacingAllowed(-0.07, true), true, 'a tiny hysteresis keeps an existing lock stable');
  assert.equal(rules.combatLockOnFacingAllowed(-0.30, true), false, 'looking genuinely away breaks the lock');
  assert.equal(rules.combatAttackTargetFacingAllowed(-0.5), false, 'contextual lunges must never magnetize toward a target behind the player');

  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /const aimDot = target\.direction\.dot\(this\.meleeForward\)/);
  assert.match(lab, /combatLockOnFacingAllowed\(aimDot, this\.combatLockOnActive\)/);
  assert.match(lab, /requireAttackFacing[\s\S]*combatAttackTargetFacingAllowed/);
});

test('v97 holding F remains defensive across combat resets until the physical key is released', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const resetStart = lab.indexOf('private resetCombatState');
  const resetEnd = lab.indexOf('/** Future melee/enemy systems', resetStart);
  const reset = lab.slice(resetStart, resetEnd);
  assert.doesNotMatch(reset, /combatCounterModifierHeld = false/);
  assert.match(lab, /event\.code === 'KeyF'[\s\S]*combatCounterModifierHeld = true[\s\S]*combatHeavyTapDetector\.cancel\(\)/);
  assert.match(lab, /onGlobalKeyUp[\s\S]*event\.code === 'KeyF'[\s\S]*combatCounterModifierHeld = false/);
  assert.match(lab, /onCombatWindowBlur[\s\S]*combatCounterModifierHeld = false/);
});

test('v100 player damage comes from the locked striking-fist sweep inside that punch own contact beat', async () => {
  const rules = await import('../.movement-test-dist/dev/CombatMeleeRules.js');
  assert.ok(rules.combatPhysicalContactDamage('punch', 'medium', 1.0, 6.0, 'head')
    > rules.combatPhysicalContactDamage('punch', 'medium', 1.0, 2.0, 'body'));
});


test('v98 dodge counter visibly lowers the pelvis before the retaliatory hook', async () => {
  const rules = await import('../.movement-test-dist/dev/CombatMeleeRules.js');
  assert.equal(rules.COMBAT_DODGE_COUNTER_DURATION_SECONDS, 0.74);
  assert.equal(rules.COMBAT_DODGE_COUNTER_STRIKE_AT_SECONDS, 0.43);
  assert.equal(rules.COMBAT_DODGE_COUNTER_MOVE_SECONDS, 0.34);
  assert.ok(rules.COMBAT_DODGE_COUNTER_SIDE_SPEED >= 2.3);
  assert.ok(rules.COMBAT_DODGE_COUNTER_BACK_SPEED >= 1.1);
  assert.ok(rules.COMBAT_DODGE_COUNTER_STRIKE_AT_SECONDS < rules.COMBAT_DODGE_COUNTER_DURATION_SECONDS);
  const layers = readFileSync(new URL('../src/dev/CombatAnimationLayers.ts', import.meta.url), 'utf8');
  assert.match(layers, /createCombatDodgeClip/);
  assert.match(layers, /sampleNumericTrack\(sourceTrack, 0\.46, crouchSample\)/);
  assert.match(layers, /-0\.36, -0\.21/);
  assert.match(layers, /degToRad\(46\)/);
});

test('v126 combat footwork adds a loading step to live locomotion instead of replacing its momentum', () => {
  const controller = readFileSync(new URL('../src/player/PlayerController.ts', import.meta.url), 'utf8');
  assert.match(controller, /private readonly combatDriveVelocity/);
  assert.match(controller, /this\.velocity\.sub\(this\.combatDriveVelocity\)/);
  assert.match(controller, /this\.velocity\.add\(this\.combatDriveVelocity\)/);
  assert.match(controller, /const retreating = this\.inputDirection\.dot/);
  assert.doesNotMatch(controller, /combatDriveTurnBlend|retainedEntrySpeed|pathYaw/);
  assert.match(controller, /const driveSpeed = this\.combatDriveSpeed \* this\.combatDriveEnvelope\(phase\)/);
  assert.match(controller, /mode: 'strike' \| 'impulse' = 'strike'/);
});

test('v103 each strike owns a fuller impact/contact/recoil beat plus deliberate left-right choreography', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /'jab-a':\s+\{ impactFraction: 0\.405, contactStartFraction: 0\.345, contactEndFraction: 0\.475, finishFraction: 0\.850 \}/);
  assert.match(lab, /'cross-b':\s+\{ impactFraction: 0\.475, contactStartFraction: 0\.400, contactEndFraction: 0\.550, finishFraction: 0\.890 \}/);
  assert.match(lab, /'step-c':\s+\{ impactFraction: 0\.565, contactStartFraction: 0\.480, contactEndFraction: 0\.645, finishFraction: 0\.940 \}/);
  assert.match(lab, /'overhand-a':[\s\S]*finishFraction: 0\.925/);
  assert.match(lab, /'body-cross-b':[\s\S]*finishFraction: 0\.905/);
  assert.match(lab, /COMBAT_ATTACK_DESIRED_SIDE/);
  assert.match(lab, /'body-cross-a': 'left'[\s\S]*'overhand-b': 'right'/);
  assert.match(lab, /const mirror = sourceAnalysis\.strikingSide !== desiredSide/);
  assert.match(lab, /COMBAT_ATTACK_DESIRED_SIDE\[candidate\] !== previousSide/);
  assert.match(lab, /endTime: duration \* timing\.finishFraction/);
});

test('v100 mirrored additive strikes swap arm tracks and reflect torso rotation without touching bind pose', () => {
  const layers = readFileSync(new URL('../src/dev/CombatAnimationLayers.ts', import.meta.url), 'utf8');
  assert.match(layers, /mirrorCombatTrackName/);
  assert.match(layers, /replace\(\/Left\/g, '__COMBAT_LEFT__'\)/);
  assert.match(layers, /rotation\.y = -rotation\.y/);
  assert.match(layers, /rotation\.z = -rotation\.z/);
  assert.match(layers, /const analyzedSide: CombatStrikeSide = mirror/);
});

test('v102 punch selection uses authored short sequences while rejecting repeated arm/source/gesture', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /punching-3-clean/);
  assert.match(lab, /punching-4-alt/);
  assert.match(lab, /SCRIPTED_MEDIUM_SEQUENCES/);
  assert.match(lab, /SCRIPTED_OUTER_SEQUENCES/);
  assert.match(lab, /scriptedCombatSequenceVariant/);
  assert.match(lab, /candidate === previous/);
  assert.match(lab, /recent\.includes\(candidate\)/);
  assert.match(lab, /COMBAT_ATTACK_DESIRED_SIDE\[candidate\] === previousSide/);
  assert.match(lab, /candidateProfile\?\.character !== previousCharacter/);
  assert.match(lab, /const sequences = Number\.isFinite\(targetDistance\) && targetDistance > 1\.24/);
});

test('v99 real fist volume and wider safety reach prevent visible close contacts from doing zero damage', async () => {
  const rules = await import('../.movement-test-dist/dev/CombatMeleeRules.js');
  assert.equal(rules.MELEE_ATTACKS.punch.reach, 1.88);
  assert.equal(rules.MELEE_ATTACKS['big-punch'].reach, 2.00);
});

test('v101 NPC and player keep their head on the opponent while shoulders/arms carry strike variation', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /headSlipDegrees/);
  assert.match(lab, /combatHeadLocalForward/);
  assert.match(lab, /this\.applyWorldYawOffset\(this\.neckBone, counterYaw \* 0\.45\)/);
  assert.match(lab, /old per-strike downward head dip/);
  assert.doesNotMatch(lab, /const dipDegrees = visual\.character/);
  assert.match(lab, /this\.idleNpcHeadBone[\s\S]*headSlipDegrees[\s\S]*0\.18/);
});

test('v88 dropping a moving manual guard preserves guarded pace before sprint can resume', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /COMBAT_POST_GUARD_MOVE_HOLD_SECONDS = 0\.26/);
  assert.match(lab, /COMBAT_POST_GUARD_MOVE_RECOVER_SECONDS = 0\.24/);
  assert.match(lab, /preserveGuardMoveSpeed = this\.combatLatchReason === 'manual' && moving/);
  assert.match(lab, /this\.combatPostGuardMoveSeconds = Math\.max\([\s\S]*COMBAT_POST_GUARD_MOVE_TOTAL_SECONDS/);
  assert.match(lab, /this\.player\.setSprintSuppressed\(true\)[\s\S]*this\.player\.setMovementSpeedScale\(speedScale\)/);
});

test('v88 RMB cannot activate manual guard from an active/requested sprint', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const downStart = lab.indexOf('private readonly onCombatMouseDown');
  const downEnd = lab.indexOf('private readonly onCombatMouseUp', downStart);
  const mouseDown = lab.slice(downStart, downEnd);
  assert.match(mouseDown, /state\.sprinting[\s\S]*this\.player\.isSprintRequested\(\)[\s\S]*this\.combatPointerHeld = false/);
  const guardStart = lab.indexOf('private requestCombatGuard');
  const guardEnd = lab.indexOf('private applyCombatMovementRestriction', guardStart);
  assert.match(lab.slice(guardStart, guardEnd), /reason === 'manual'[\s\S]*state\.sprinting/);
});

test('v88 a forward wall contact cancels sprint state and running animation eligibility', () => {
  const controller = readFileSync(new URL('../src/player/PlayerController.ts', import.meta.url), 'utf8');
  const tuning = readFileSync(new URL('../src/player/MovementConfig.ts', import.meta.url), 'utf8');
  assert.match(tuning, /sprintCancelBlockFraction: 0\.48/);
  assert.match(controller, /this\.blockedMotionFraction = Math\.max\(this\.blockedMotionFraction, blockedFraction\)/);
  assert.match(controller, /this\.sprinting = sprintRequested[\s\S]*this\.blockedMotionFraction < MOVEMENT_TUNING\.collision\.sprintCancelBlockFraction/);
});


test('v103 combat library adds body crosses and overhands, weight transfer and animated feet during automatic step-ins', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const layers = readFileSync(new URL('../src/dev/CombatAnimationLayers.ts', import.meta.url), 'utf8');
  assert.match(lab, /'body-cross-a'[\s\S]*character: 'body'/);
  assert.match(lab, /'overhand-a'[\s\S]*character: 'overhand'/);
  assert.match(layers, /case 'body':[\s\S]*case 'overhand':/);
  assert.match(lab, /const loadStart = Math\.max\(0\.02, impact - 0\.34\)/);
  assert.match(lab, /styleYaw = -styleBase \* load/);
  assert.match(lab, /visualProfile\?\.character === 'overhand'[\s\S]*combatStrikeDesiredPoint\.y \+= 0\.18/);
  assert.match(lab, /const committedForwardStep = activeStrike\.spacing !== 'close'[\s\S]*combatStrikeLowerSelection\(/);
  assert.doesNotMatch(lab.slice(lab.indexOf("const committedForwardStep = activeStrike.spacing !== 'close'"), lab.indexOf('const selection = combatStrikeLowerSelection')), /activeStrike\.spacing !== 'out'/);
  assert.match(lab, /const clinched = Number\.isFinite\(targetDistance\) && targetDistance <= 0\.56/);
});


test('v104 live NPC owns a solid player-only blocker and close guard attacks force spacing instead of body overlap', async () => {
  const rules = await import('../.movement-test-dist/dev/CombatMeleeRules.js');
  assert.equal(rules.COMBAT_MELEE_CLOSE_MAX_DISTANCE, 0.78);
  assert.equal(rules.combatCloseGuardShoveEligible(true, 'close', 0.70), true);
  assert.equal(rules.combatCloseGuardShoveEligible(false, 'close', 0.70), false, 'shove must remain a combat-guard action');
  assert.equal(rules.combatCloseGuardShoveEligible(true, 'medium', 0.90), false);
});


test('v105 out-of-range attacks use authored step-in variants and animate the lower body', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const chooseStart = lab.indexOf('private chooseCombatAttackVariant');
  const chooseEnd = lab.indexOf('private startCombatAttackLayer', chooseStart);
  const choose = lab.slice(chooseStart, chooseEnd);
  assert.match(choose, /spacing === 'out'[\s\S]*FAR_STEP_ATTACK_VARIANTS/);
  assert.match(choose, /never the distant opponent/);

  const updateStart = lab.indexOf('const activeStrike = this.combatAttack');
  const updateEnd = lab.indexOf('this.combatAttack.elapsed +=', updateStart);
  const update = lab.slice(updateStart, updateEnd);
  assert.match(update, /const committedForwardStep = activeStrike\.spacing !== 'close'/);
  assert.doesNotMatch(update, /activeStrike\.spacing !== 'out'/);
  assert.match(update, /lowerForward = this\.tempDirection\.dot\(this\.bodyForward\) \/ speed/);
  assert.match(update, /combatStrikeLowerSelection\(/);
});

test('v107 committed strike footwork follows the curved physical trajectory instead of forcing forward legs', async () => {
  const { combatStrikeLowerSelection } = await import('../.movement-test-dist/dev/CombatGuardRules.js');
  assert.deepEqual(
    combatStrikeLowerSelection(0, 1, true, true),
    { id: 'right-strafe-walking', reverse: false },
    'a lateral entry keeps lateral footwork at the beginning of the attack arc',
  );
  assert.deepEqual(
    combatStrikeLowerSelection(-1, 0, true, true),
    { id: 'walking-backward', reverse: true },
    'a genuine backward travel vector remains backward until the physical plant/reversal occurs',
  );
  assert.deepEqual(
    combatStrikeLowerSelection(0, 0, false, true),
    { id: 'fight-idle', reverse: false },
    'the reversal may pass through a planted guard beat instead of skating in place',
  );
  assert.deepEqual(
    combatStrikeLowerSelection(0, -1, true, false),
    { id: 'left-strafe-walking', reverse: false },
    'ordinary guard locomotion keeps directional footwork outside the strike commitment',
  );

  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /COMBAT_LOWER_STRIKE_CROSSFADE_SECONDS = 0\.12/);
  assert.match(lab, /Direction changes inside a strike preserve the current step phase/);
  assert.match(lab, /this\.combatAttackStartBodyYaw = this\.bodyYaw/);
  assert.match(lab, /this\.combatAttackEntryForwardSpeed = this\.tempDirection\.dot\(this\.combatStrikeForwardAxis\)/);
  assert.match(lab, /this\.combatAttackEntryRightSpeed = this\.tempDirection\.dot\(this\.bodyRight\)/);
  assert.match(lab, /const turnBlend = THREE\.MathUtils\.smoothstep\(normalizedStrike, 0\.015, turnEnd\)/);
  assert.match(lab, /lowerRight = this\.tempDirection\.dot\(this\.bodyRight\) \/ speed/);
  assert.match(lab, /const motionRoll = THREE\.MathUtils\.degToRad/);

  const controller = readFileSync(new URL('../src/player/PlayerController.ts', import.meta.url), 'utf8');
  assert.match(controller, /this\.removeCombatDriveVelocity\(\)/);
  assert.match(controller, /const addedSpeed = retreating \? 0 : Math\.max/);
  assert.match(controller, /this\.velocity\.add\(this\.combatDriveVelocity\)/);
  assert.doesNotMatch(controller, /pathYaw|combatDriveEntryDirection/);
  assert.doesNotMatch(controller, /const lateralRetention = along < 0 \? 0\.08 : 0\.18/);
});

test('v115 first-person guard ignores foot-based vertical viewmodel corrections while combat framing is active', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /if \(!state\.incapacitated && combatPoseTarget <= 0\.001 && this\.firstPersonLeftFootBone/);
  assert.match(lab, /this\.activeAuthoredTurn === null[\s\S]*&& combatPoseTarget <= 0\.001[\s\S]*firstPersonFootLockGroup/);
});

test('v116 passive NPCs finish and can retrigger hit reactions instead of freezing after the first punch', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const start = lab.indexOf('private updateNpcCombat');
  const end = lab.indexOf('private startAuthoredTurn', start);
  const source = lab.slice(start, end);
  const reactionIndex = source.indexOf('if (this.npcHitReaction)');
  const passiveReturnIndex = source.indexOf('if (!this.npcCombatEnabled || this.npcHealth <= 0) return');
  assert.ok(reactionIndex >= 0 && passiveReturnIndex > reactionIndex, 'hit reaction lifecycle must run before passive AI return');
  assert.match(source, /this\.npcHitReactionDuration = 0/);
  assert.match(source, /if \(this\.npcCombatEnabled\) this\.startNpcCombatGuardLayers\('fight-idle', 1\)/);
  assert.match(source, /else this\.playNpcAnimation\('idle', true, 1, true\)/);
});

test('v117 repeated NPC hits interrupt player reactions and share combo knockdown inertia', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const start = lab.indexOf('private receivePlayerMeleeHit');
  const end = lab.indexOf('private prepareNpcCombatLoopAction', start);
  const source = lab.slice(start, end);
  assert.match(source, /playerConsecutiveNpcHits/);
  assert.match(source, /PLAYER_REHIT_RAGDOLL_HIT_COUNT/);
  assert.match(source, /const rapidRehit = hitDuringReaction/);
  assert.match(source, /meleeImpact:/);
  assert.match(source, /zone: hitZone/);
  assert.match(lab, /this\.ragdoll\.applyMeleeImpact\(/);
});

test('v118 third-person dodge keeps the world root planted and animates a real side slip', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const layers = readFileSync(new URL('../src/dev/CombatAnimationLayers.ts', import.meta.url), 'utf8');
  assert.match(lab, /createCombatDodgeClip\(crouch, fight, 'AnimationLab_CombatDodge3P', false\)/);
  assert.match(lab, /createCombatDodgeClip\(crouch, fight, 'AnimationLab_CombatDodge1P', true\)/);
  assert.match(layers, /if \(!includeHipsTranslation\) continue/);
  assert.match(lab, /private applyThirdPersonCombatDodgePose\(\)/);
  assert.match(lab, /COMBAT_DODGE_THIRD_PERSON_ROLL/);
  assert.match(lab, /COMBAT_DODGE_THIRD_PERSON_LEG_LOAD/);
  assert.match(lab, /this\.applyThirdPersonCombatDodgePose\(\);/);
});

test('v119 dodge animation offsets legs hips and torso on different phases then drives into the counter', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const layers = readFileSync(new URL('../src/dev/CombatAnimationLayers.ts', import.meta.url), 'utf8');
  assert.match(layers, /const enterEnd = lower \? 0\.16 : hips \? 0\.19 : 0\.23/);
  assert.match(layers, /const holdEnd = lower \? 0\.66 : hips \? 0\.58 : 0\.50/);
  assert.match(layers, /combatDodgePoseEnvelope\(key \/ \(sampleCount - 1\), bone\)/);
  const dodgePose = lab.slice(lab.indexOf('private applyThirdPersonCombatDodgePose'), lab.indexOf('private requestNormalCombatPunch'));
  assert.match(dodgePose, /const counterDrive = THREE\.MathUtils\.smoothstep/);
  assert.match(dodgePose, /COMBAT_DODGE_THIRD_PERSON_COUNTER_TWIST/);
  assert.match(dodgePose, /COMBAT_DODGE_THIRD_PERSON_COUNTER_DRIVE/);
});


test('v120 ground attacks use contextual stomp/get-up kick timings and real foot-path contact', async () => {
  const rules = await import('../.movement-test-dist/dev/GroundKickRules.js');
  assert.ok(rules.GROUND_KICK_PROFILES.stomp.damage > 14, 'a loaded stomp should have a stronger impact');
  assert.equal(rules.GROUND_KICK_PROFILES['get-up-kick'].damage, 18);
  assert.ok(rules.groundKickContactAccepted(0.54, 'stomp', 0.12, 1.0));
  assert.ok(!rules.groundKickContactAccepted(0.20, 'stomp', 0.20, 1.1));
  assert.ok(!rules.groundKickContactAccepted(0.54, 'stomp', 0.80, 1.1));
  const chamber = rules.groundKickPose(0.24, 'get-up-kick');
  const drive = rules.groundKickPose(0.50, 'get-up-kick');
  assert.ok(chamber.chamber > chamber.drive, 'kick visibly chambers before extension');
  assert.ok(drive.drive > 0.65, 'get-up interruption owns a strong extension beat');
});

test('v120 first-person ground kick reveals only legs plus combat arms and never restores the torso mesh', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /uniform float fpGroundKick/);
  assert.match(lab, /fpCombatKickMask = max\(vFpCombatArmMask, vFpLowerBodyMask\)/);
  assert.match(lab, /uniforms\.groundKick\.value = this\.groundKick \? 1 : 0/);
  assert.doesNotMatch(lab, /fpCombatKickMask = fpExplorationMask/);
});

test('v122 ground kicks use a bounded start yaw and never chase a rolling ragdoll root', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  assert.match(lab, /GROUND_KICK_MAX_START_YAW_ERROR = THREE\.MathUtils\.degToRad\(50\)/);
  assert.match(lab, /GROUND_KICK_MAX_ROOT_TURN = THREE\.MathUtils\.degToRad\(22\)/);
  assert.match(lab, /readonly targetYaw: number/);
  assert.match(lab, /const startYawError = wrapAngleRadians\(desiredYaw - startYaw\)/);
  assert.match(lab, /Math\.abs\(startYawError\) > GROUND_KICK_MAX_START_YAW_ERROR/);
  assert.match(lab, /this\.bodyYaw = kick\.startYaw \+ wrapAngleRadians\(kick\.targetYaw - kick\.startYaw\) \* turnBlend/);
  const update = lab.slice(lab.indexOf('private updateGroundKick'), lab.indexOf('private applyGroundKickPose'));
  assert.doesNotMatch(update, /dampAngleRadians\(this\.bodyYaw, targetYaw/);
  assert.doesNotMatch(update, /Math\.atan2\(this\.tempDirection\.x, this\.tempDirection\.z\)/);
  assert.match(update, /this\.player\.cancelCombatLunge\(\)/);
});

test('v121 first-person melee damage gives head kick plus directional blood feedback', () => {
  const lab = readFileSync(new URL('../src/dev/AnimationLab.ts', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/dev/AnimationLab.css', import.meta.url), 'utf8');
  assert.match(lab, /private triggerFirstPersonMeleeHitFeedback/);
  assert.match(lab, /FIRST_PERSON_MELEE_HIT_KICK_SECONDS = 0\.24/);
  assert.match(lab, /this\.triggerFirstPersonMeleeHitFeedback\(direction, damage, hitZone\)/);
  assert.match(lab, /this\.firstPersonCamera\.quaternion\.multiply\(this\.firstPersonMeleeHitKickQuaternion\)/);
  assert.match(lab, /--hit-blood-opacity/);
  assert.match(css, /\.animation-lab__damage-fx::before/);
  assert.match(css, /var\(--hit-blood-opacity\)/);
  assert.match(css, /var\(--hit-blood-side\)/);
});
