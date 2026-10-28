import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createLab, stepLab, THREE } from './support/headless-character.mjs';
import { EnvironmentCameraGuard } from '../../.character-test-dist/character/EnvironmentCameraGuard.js';
import { CharacterEnvironment } from '../../.character-test-dist/character/CharacterEnvironment.js';

let lab;
before(async () => { lab = await createLab(); lab.setInteractionPartner(null); });
after(() => lab?.dispose());
const clear = (environment, camera, guard) => {
  const p = camera.position.clone();
  assert.ok(environment.resolveSphereOverlap(p, guard.radius(camera)), 'no feasible camera sphere');
  assert.ok(p.distanceTo(camera.position) < .0002, `camera still penetrates: ${p.distanceTo(camera.position)}`);
};

test('guards the complete near plane against floors, walls, a ceiling, slopes, steps and a moving door', () => {
  const environment = new CharacterEnvironment(lab.physics);
  const cases = [
    { name: 'floor', size: [4, .16, 4], at: [40, -.08, 40], anchor: [40, .15, 40], eye: [40, -.12, 40] },
    { name: 'wall', size: [.6, 4, 4], at: [40, 2, 40], anchor: [39.5, 1, 40], eye: [40.1, 1, 40] },
    { name: 'ceiling', size: [4, .16, 4], at: [40, 2.08, 40], anchor: [40, 1.82, 40], eye: [40, 2.15, 40] },
    { name: 'slope', size: [4, .16, 4], at: [40, 0, 40], roll: .3, anchor: [40, .25, 40], eye: [40, -.15, 40] },
    { name: 'step edge', size: [1, .3, 3], at: [40.5, .15, 40], anchor: [39.85, .22, 40], eye: [40.2, .22, 40] },
    { name: 'door', size: [.1, 2.4, 1], at: [40, 1.2, 40], anchor: [39.8, 1, 40], eye: [40.2, 1, 40] },
  ];
  for (const fixture of cases) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...fixture.size)); mesh.position.fromArray(fixture.at);
    mesh.rotation.z = fixture.roll ?? 0; mesh.updateMatrixWorld(true); lab.environmentMeshes.push(mesh);
    try {
      for (const aspect of [1, 16 / 9, 32 / 9]) {
        const camera = new THREE.PerspectiveCamera(95, aspect, .04, 140), guard = new EnvironmentCameraGuard();
        camera.position.fromArray(fixture.eye);
        guard.constrain(camera, new THREE.Vector3(...fixture.anchor), environment); clear(environment, camera, guard);
        assert.ok(camera.position.distanceTo(new THREE.Vector3(...fixture.anchor)) < .48, fixture.name);
        // Start overlapping, and change target across the obstacle in one frame.
        camera.position.fromArray(fixture.at);
        guard.constrain(camera, new THREE.Vector3(...fixture.anchor), environment); clear(environment, camera, guard);
      }
    } finally { lab.environmentMeshes.pop(); mesh.geometry.dispose(); mesh.material.dispose(); }
  }
});

test('leaves a real pit opening visible and excludes the owned ragdoll from queries without changing its bodies', () => {
  const camera = new THREE.PerspectiveCamera(72, 16 / 9, .04, 140), guard = new EnvironmentCameraGuard();
  camera.position.set(-9, -1, -5);
  const environment = new CharacterEnvironment(lab.physics), expected = camera.position.clone();
  guard.constrain(camera, camera.position.clone(), environment);
  assert.ok(camera.position.distanceTo(expected) < 1e-5, 'the pit was closed by a camera clamp');
  lab.startRagdoll({ fatal: false });
  const head = lab.ragdoll.getHeadCollisionCenter(new THREE.Vector3());
  const before = [...lab.ragdoll.bodies.values()].map(p => ({ p: p.body.translation(), v: p.body.linvel() }));
  camera.position.copy(head); guard.reset(); guard.constrain(camera, head, environment);
  assert.deepEqual([...lab.ragdoll.bodies.values()].map(p => ({ p: p.body.translation(), v: p.body.linvel() })), before);
  clear(environment, camera, guard);
});

for (const fps of [30, 60, 120]) test(`the real FBX camera stays outside solids after the final presentation at ${fps} Hz`, () => {
  if (lab.ragdoll) lab.respawnPlayer();
  lab.player.teleport({ x: -15, y: 9.865, z: -12 });
  lab.avatarAnchor.position.set(-15, 9, -12); lab.avatarAnchor.updateMatrixWorld(true);
  lab.viewMode = 'first-person'; lab.startRagdoll({ fatal: false, addedVelocity: new THREE.Vector3(0, -4, 0) });
  const environment = new CharacterEnvironment(lab.physics);
  let ticks = 0, steps = 0;
  const original = lab.physics.world.step.bind(lab.physics.world);
  lab.physics.world.step = (...args) => { steps++; return original(...args); };
  try {
    for (let i = 0; i < fps * 3; i++) {
      const previousSteps = steps; stepLab(lab, 1 / fps);
      assert.ok(steps - previousSteps <= (fps === 30 ? 15 : 10), 'unbounded fixed-step catch-up');
      if (lab.ragdoll) {
        clear(environment, lab.firstPersonCamera, lab.deadCameraGuard);
        assert.ok(lab.host.renderCamera.position.distanceTo(lab.firstPersonCamera.position) < 1e-7);
        assert.ok(lab.ragdoll.getPelvisPosition(new THREE.Vector3()).y > -.2, 'the body crossed the intact floor');
      }
      ticks++;
    }
    assert.equal(ticks, fps * 3);
    const frozen = steps; stepLab(lab, 0); assert.equal(steps, frozen, 'zero delta advanced the world');
    stepLab(lab, 4); assert.ok(steps - frozen <= 20, 'resume attempted all missed frames');
  } finally { lab.physics.world.step = original; }
});
