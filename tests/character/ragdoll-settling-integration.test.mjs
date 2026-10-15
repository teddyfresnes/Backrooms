import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { createLab, THREE } from './support/headless-character.mjs';

let lab, Ragdoll, Physics;
before(async () => {
  lab = await createLab();
  lab.startRagdoll({ fatal: false });
  Ragdoll = lab.ragdoll.constructor;
  Physics = lab.physics.constructor;
  // Optional previous-source bundle for auditing that these regressions fail
  // against the publication that preceded the fix.
  if (process.env.RAGDOLL_BASELINE_MODULE) Ragdoll = (await import(process.env.RAGDOLL_BASELINE_MODULE)).RagdollSystem;
});
after(() => lab?.dispose());

async function fixture({ caseId = 2, stairs = false, height = 1, floor = true } = {}) {
  const colliders = floor ? [{ id: 'floor', kind: 'floor', center: { x: 0, y: -4.1, z: 0 }, halfExtents: { x: 15, y: .1, z: 15 } }] : [];
  if (stairs) for (let i = 0; i < 20; i++) colliders.push({
    id: `step-${i}`, kind: 'step', center: { x: 0, y: -4 + (i + 1) * .1, z: i * .35 },
    halfExtents: { x: 1.5, y: (i + 1) * .1, z: .175 },
  });
  const physics = await Physics.create({ colliders, spawn: { x: 10, y: .865, z: 10 } });
  physics.setPlayerColliderEnabled(false);
  const root = new THREE.Group();
  root.position.set(caseId % 3 * .4, height, stairs ? 5 : 0);
  root.rotation.set((caseId % 4 - 1) * .42, caseId * .83, (caseId % 3 - 1) * .45);
  root.scale.copy(lab.avatarAnchor.scale);
  const character = clone(lab.character);
  root.add(character);
  const mixer = new THREE.AnimationMixer(character);
  const pose = ['falling-idle', 'running', 'idle-action', 'fight-idle'][Math.floor(caseId / 6) % 4];
  const action = mixer.clipAction(lab.animations.get(pose).clip);
  action.play(); action.time = .12 + caseId % 6 * .13; mixer.update(0);
  root.updateMatrixWorld(true);
  const random = Math.random;
  let seed = 2026 + caseId;
  Math.random = () => (seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32;
  let ragdoll;
  try {
    ragdoll = Ragdoll.create(physics, character, {
      velocity: new THREE.Vector3(stairs ? .2 : 1, -1, stairs ? -3.2 : 2),
      yawRateRadians: (caseId % 3 - 1) * 1.8, activeResponseScale: 1,
    });
  } finally { Math.random = random; }
  return { physics, ragdoll, dispose() { ragdoll.dispose(); physics.dispose(); } };
}

function tick(body, delta, shared) {
  if (shared) { body.physics.stepDynamics(delta); body.ragdoll.passiveUpdate(delta); }
  else body.ragdoll.fixedUpdate(delta);
}
function run(body, seconds, fps = 60, shared = false) {
  for (let frame = 0; frame < Math.ceil(seconds * fps); frame++) tick(body, 1 / fps, shared);
}
const position = body => new THREE.Vector3().copy(body.translation());
const rotation = body => new THREE.Quaternion().copy(body.rotation()).normalize();
const snapshot = ragdoll => ragdoll.ownedBodies.map(body => ({ position: position(body), rotation: rotation(body) }));
function assertRest(body, fps, shared) {
  assert.ok(body.ragdoll.isSettled, 'the grounded articulated island never entered rest');
  assert.ok(body.ragdoll.ownedBodies.every(part => part.isSleeping()), 'an auxiliary joint frame remained awake');
  const captured = snapshot(body.ragdoll);
  run(body, 12, fps, shared);
  assert.ok(body.ragdoll.isSettled);
  body.ragdoll.ownedBodies.forEach((part, index) => {
    assert.ok(part.isSleeping());
    assert.ok(position(part).distanceTo(captured[index].position) < 1e-6, 'a resting part drifted');
    assert.ok(rotation(part).angleTo(captured[index].rotation) < 1e-6, 'a resting part resumed rolling');
  });
}

for (const shared of [false, true]) for (const stairs of [false, true]) for (const fps of [30, 60, 120]) {
  test(`${shared ? 'shared-world' : 'player'} nonfatal ${stairs ? 'stair' : 'floor'} fall rests for twelve seconds at ${fps} Hz`, async () => {
    const body = await fixture({ caseId: stairs ? 1 : 2, stairs });
    try {
      const core = body.ragdoll.bodies.get('core').body;
      const start = position(core);
      run(body, .5, fps, shared);
      assert.equal(body.ragdoll.isSettled, false, 'the body was frozen during its actual fall');
      assert.ok(position(core).y < start.y - .35, 'gravity no longer carries the initial fall');
      run(body, 9.5, fps, shared);
      assertRest(body, fps, shared);
    } finally { body.dispose(); }
  });
}

for (const caseId of [3, 5, 9, 13, 19, 23]) test(`stair rest survives asymmetric real FBX handoff ${caseId}`, async () => {
  const body = await fixture({ caseId, stairs: true });
  try { run(body, 10); assertRest(body, 60, false); }
  finally { body.dispose(); }
});

for (const shared of [false, true]) test(`an unsupported ${shared ? 'shared-world' : 'player'} body keeps falling after the settle deadline`, async () => {
  const body = await fixture({ floor: false });
  try {
    run(body, 4, 60, shared);
    const core = body.ragdoll.bodies.get('core').body, before = position(core);
    assert.equal(body.ragdoll.isSettled, false);
    run(body, 1, 60, shared);
    assert.ok(position(core).y < before.y - 8, 'the unsupported body was suspended in the air');
    assert.equal(body.ragdoll.isSettled, false);
  } finally { body.dispose(); }
});

test('a real new ground impact wakes every part, keeps its follow-through, then settles again', async () => {
  const body = await fixture();
  try {
    run(body, 10); assert.ok(body.ragdoll.isSettled);
    const core = body.ragdoll.bodies.get('core').body, before = position(core);
    body.ragdoll.applyGroundKickImpact(new THREE.Vector3(1, 0, .3), 1, false, before, 'soccer-kick');
    assert.equal(body.ragdoll.isSettled, false);
    assert.ok(body.ragdoll.ownedBodies.every(part => !part.isSleeping()));
    run(body, .2);
    assert.equal(body.ragdoll.isSettled, false, 'the new impact was immediately cancelled');
    assert.ok(position(core).distanceTo(before) > .01, 'the new physical impact was suppressed');
    run(body, 8);
    assertRest(body, 60, false);
  } finally { body.dispose(); }
});

test('removing the floor lets a previously resting island fall again', async () => {
  const body = await fixture();
  try {
    run(body, 10); assert.ok(body.ragdoll.isSettled);
    const core = body.ragdoll.bodies.get('core').body, before = position(core);
    body.physics.removeChunk('origin');
    run(body, .5);
    assert.equal(body.ragdoll.isSettled, false);
    assert.ok(position(core).y < before.y - .4, 'terminal rest behaved like an invisible fixed anchor');
  } finally { body.dispose(); }
});

test('fatal settling continues when the corpse switches to the shared world before rest', async () => {
  const body = await fixture({ height: 12 });
  try {
    let impact = false;
    for (let i = 0; i < 300 && !impact; i++) {
      tick(body, 1 / 60, false);
      impact = body.ragdoll.drainImpactEvents().some(event => event.position.y < -2 && event.velocityBefore.y < -7);
      if (!impact) assert.equal(body.ragdoll.isSettled, false);
    }
    assert.ok(impact, 'the actual high-fall impact was not reached');
    body.ragdoll.beginFatalFallSettling(12);
    run(body, .15); assert.equal(body.ragdoll.isSettled, false, 'the impact lost its physical follow-through');
    run(body, 10, 60, true);
    assertRest(body, 60, true);
  } finally { body.dispose(); }
});

function multiplyInertia(body, omega) {
  const inertia = body.effectiveAngularInertia();
  return new THREE.Vector3(
    inertia.m11 * omega.x + inertia.m12 * omega.y + inertia.m13 * omega.z,
    inertia.m21 * omega.x + inertia.m22 * omega.y + inertia.m23 * omega.z,
    inertia.m31 * omega.x + inertia.m32 * omega.y + inertia.m33 * omega.z,
  );
}
const momentum = bodies => bodies.reduce((sum, body) => sum.add(multiplyInertia(body, body.angvel())), new THREE.Vector3());
const energy = bodies => bodies.reduce((sum, body) => sum + .5 * new THREE.Vector3().copy(body.angvel()).dot(multiplyInertia(body, body.angvel())), 0);

for (const vector of [[1, 0, 0], [0, 1, 0], [.3, .8, -.4]]) test(`joint brake removes energy and conserves unequal-inertia momentum along ${vector}`, async () => {
  const body = await fixture();
  try {
    const parent = body.ragdoll.bodies.get('core'), child = body.ragdoll.bodies.get('right-lower-leg');
    const axis = new THREE.Vector3(...vector).normalize();
    const spin = new THREE.Vector3(.4, .3, -.2);
    parent.body.setAngvel(spin, false);
    child.body.setAngvel(spin.clone().addScaledVector(axis, 4), false);
    const pair = [parent.body, child.body], beforeMomentum = momentum(pair), beforeEnergy = energy(pair);
    body.ragdoll.setRelativeAngularSpeed(parent, child, axis, 0, 20);
    const afterEnergy = energy(pair), error = momentum(pair).distanceTo(beforeMomentum);
    assert.ok(afterEnergy <= beforeEnergy + 1e-5, `the brake injected rotational energy: ${beforeEnergy} -> ${afterEnergy}`);
    assert.ok(error < 1e-4, `the brake injected angular momentum: ${error}`);
    const relative = new THREE.Vector3().copy(child.body.angvel()).sub(parent.body.angvel()).dot(axis);
    assert.ok(Math.abs(relative) < 1e-4, `relative rotation did not stop: ${relative}`);
  } finally { body.dispose(); }
});
