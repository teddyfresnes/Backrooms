import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { createLab, THREE } from './support/headless-character.mjs';
import { generateInfiniteChunk, getChunkWorldOffset } from '../../.character-test-dist/regional-world.js';

let lab, Ragdoll, Physics;
before(async () => {
  lab = await createLab(); lab.startRagdoll({ fatal: false });
  Ragdoll = lab.ragdoll.constructor; Physics = lab.physics.constructor;
});
after(() => lab?.dispose());

for (const shared of [false, true]) test(`the real ${shared ? 'shared' : 'player'} FBX ragdoll falls through three regional owners and lands on their actual lower maze`, async () => {
  let world, cell;
  for (let i = 0; i < 32 && !cell; i++) {
    world = generateInfiniteChunk(`REGIONAL-AUDIT-${i}`, { x: 0, z: 0, story: 0 });
    cell = world.spatial.cells.find(c => c.mode === 'gallery');
  }
  assert.ok(cell);
  const physics = await Physics.create({ ...world, colliders: [] });
  physics.setPlayerColliderEnabled(false);
  for (const story of [0, -1, -2]) {
    const owner = { x: 0, z: 0, story }, plan = generateInfiniteChunk(world.seed, owner);
    physics.addChunk(String(story), plan.colliders, getChunkWorldOffset(owner));
  }
  const root = new THREE.Group(); root.scale.copy(lab.avatarAnchor.scale);
  root.position.set((cell.bounds.minX + cell.bounds.maxX) / 2, cell.floorY + 1, (cell.bounds.minZ + cell.bounds.maxZ) / 2 - 5);
  const character = clone(lab.character); root.add(character);
  const mixer = new THREE.AnimationMixer(character), action = mixer.clipAction(lab.animations.get('falling-idle').clip);
  action.play(); action.time = .25; mixer.update(0); root.updateMatrixWorld(true);
  const ragdoll = Ragdoll.create(physics, character, { velocity: new THREE.Vector3(0, -1, 0), yawRateRadians: 0, activeResponseScale: 1 });
  const lowerY = cell.floorY - 10.8;
  let passedMiddle = false, landed = false;
  try {
    for (let i = 0; i < 480; i++) {
      if (shared) { physics.stepDynamics(1 / 60); ragdoll.passiveUpdate(1 / 60); }
      else ragdoll.fixedUpdate(1 / 60);
      const core = ragdoll.bodies.get('core').body.translation();
      assert.ok(Number.isFinite(core.y), `nonfinite articulated body at frame ${i}`);
      if (core.y < cell.floorY - 6) passedMiddle = true;
      landed ||= ragdoll.drainImpactEvents().some(e => e.position.y < lowerY + 1.5 && e.velocityBefore.y < -4);
      // Passive corpses do not emit the player-owned impact event stream.
      // Inspect Rapier's actual contacts with floor colliders instead.
      if (shared && passedMiddle && !landed) for (const part of ragdoll.bodies.values()) for (let n = 0; n < part.body.numColliders(); n++) {
        const collider = part.body.collider(n);
        physics.world.contactPairsWith(collider, other => {
          if (!physics.isEnvironmentCollider(other) || physics.getEnvironmentKind(other) !== 'floor') return;
          physics.world.contactPair(collider, other, manifold => { if (manifold.numSolverContacts() > 0) landed = true; });
        });
      }
    }
    const core = ragdoll.bodies.get('core').body.translation();
    assert.ok(passedMiddle, 'an unintended middle slab stopped the articulated body');
    assert.ok(landed, 'no physical impact reached the real lower plan');
    assert.ok(core.y > lowerY && core.y < lowerY + 1.6, JSON.stringify({ core, lowerY }));
    for (let i = 0; i < 120; i++) { physics.stepDynamics(1 / 60); ragdoll.passiveUpdate(1 / 60); }
    assert.ok(Number.isFinite(ragdoll.bodies.get('core').body.translation().y));
  } finally {
    ragdoll.dispose();
    for (const story of [0, -1, -2]) physics.removeChunk(String(story));
    // Existing ragdoll disposal quarantines disabled Rapier bodies until
    // world.free(), avoiding its active-joint WASM removal bug.
    physics.world.colliders.forEach(collider => assert.equal(collider.isEnabled(), false));
    physics.dispose();
  }
});
