import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createLab, setupDuel, stepLab, THREE } from './support/headless-lab.mjs';

let lab;
before(async () => { lab = await createLab(); });
after(() => lab?.dispose());
const run = (seconds, fps = 60) => { for (let i = 0; i < Math.ceil(seconds * fps); i++) stepLab(lab, 1 / fps); };
function body(pose) {
  lab.player.input.clear(); setupDuel(lab);
  lab.idleNpcAnchor.position.set(-14, 0, -12); lab.idleNpcAnchor.updateMatrixWorld(true);
  lab.idleNpcAnchor.rotation.z = 0;
  lab.syncNpcPlayerBlocker(true); lab.player.teleport({ x: -14, y: .865, z: -13.05 }); run(.25);
  lab.stopNpcCombatGuardLayers(0); lab.idleNpcMixer.stopAllAction();
  lab.playNpcAnimation(pose === 'belly' ? 'stand-up-belly' : 'stand-up-back', false, 1, true);
  lab.npcCurrentAction.time = 0; lab.idleNpcMixer.update(0);
  lab.idleNpcAnchor.updateMatrixWorld(true); lab.npcMotionHistory.reset();
  const random = Math.random;
  try { Math.random = () => .5; lab.startNpcRagdoll('punch', new THREE.Vector3(0, 0, 1), 12, 'body'); }
  finally { Math.random = random; }
  lab.npcRagdoll.activeResponseScale = 0; lab.npcGroundKickRecoveryDelay = 100;
  run(4.5);
  for (let i = 0; i < 360 && !lab.npcRagdoll.traversalBody?.isEnabled(); i++) stepLab(lab);
  assert.ok(lab.npcRagdoll.traversalBody?.isEnabled(), 'body still moving before the stationary-contact trial');
  const target = new THREE.Vector3(); assert.ok(lab.resolveGroundKickTarget(target)); return target;
}

for (const pose of ['back', 'belly']) for (const distance of [0, .32, .65, .96]) for (const fps of [30, 60, 120]) {
  test(`a ${pose} body at ${distance} m receives one actual boot contact at ${fps} fps`, () => {
    const target = body(pose);
    lab.player.teleport({ x: target.x, y: .865, z: target.z - distance });
    lab.bodyYaw = 0; lab.updateAvatarTransform(0, true);
    assert.ok(lab.tryStartGroundKick(), 'near/underfoot target was discarded');
    const kick = lab.groundKick, health = lab.npcHealth;
    const impact = lab.npcRagdoll.applyGroundKickImpact;
    let impulses = 0, actualSurfaceError;
    lab.npcRagdoll.applyGroundKickImpact = function (...args) {
      impulses++;
      const point = args[3];
      actualSurfaceError = Math.min(...[...this.bodies.values()].flatMap(part => part.colliders.map(collider => {
        const projection = collider.projectPoint(point, false);
        return projection ? new THREE.Vector3().copy(projection.point).distanceTo(point) : Infinity;
      })));
      return impact.apply(this, args);
    };
    try {
      let events = 0, oldHealth = health, maxYaw = 0;
      for (let i = 0; i < Math.ceil(fps * 1.25); i++) {
        stepLab(lab, 1 / fps);
        if (lab.npcHealth !== oldHealth) { events++; oldHealth = lab.npcHealth; }
        maxYaw = Math.max(maxYaw, Math.abs(lab.bodyYaw - kick.startYaw));
        for (const bone of [lab.leftUpperLegBone, lab.rightUpperLegBone, lab.leftFootBone, lab.rightFootBone]) {
          assert.ok([...bone.quaternion].every(Number.isFinite));
        }
      }
      assert.equal(events, 1, JSON.stringify({ pose, distance, kind: kick.kind, point: kick.targetPoint.toArray() }));
      assert.equal(impulses, 1); assert.ok(actualSurfaceError < .065, `impact ${actualSurfaceError} m from the actual body`);
      assert.ok(maxYaw <= 22 * Math.PI / 180 + .001); assert.equal(lab.groundKick, null);
      assert.ok(lab.player.input.enabled);
    } finally { lab.npcRagdoll.applyGroundKickImpact = impact; }
  });
}

for (const lateral of [-.35, .35]) test(`diagonal ground strike uses the foot on the approach side at offset ${lateral}`, () => {
  const target = body('back');
  lab.player.teleport({ x: target.x - lateral, y: .865, z: target.z - .62 });
  lab.bodyYaw = 0; lab.updateAvatarTransform(0, true);
  assert.ok(lab.tryStartGroundKick());
  const kick = lab.groundKick;
  const left = lab.leftFootBone.getWorldPosition(new THREE.Vector3());
  const right = lab.rightFootBone.getWorldPosition(new THREE.Vector3());
  // The staggered boxing stance must not make the far leg cross over the
  // planted foot just because its hip is closer along the forward axis.
  const lateralDistance = p => Math.abs(kick.targetPoint.x - p.x);
  assert.equal(kick.side, lateralDistance(left) < lateralDistance(right) ? 'left' : 'right'); run(1.2);
  assert.ok(kick.impactApplied);
});

test('an unavailable physical floor target never falls through into a standing punch', () => {
  body('back');
  const ragdoll = lab.npcRagdoll, cast = ragdoll.getGroundKickSurface;
  ragdoll.getGroundKickSurface = () => false;
  try {
    assert.equal(lab.resolveGroundKickTarget(new THREE.Vector3()), null);
    lab.onCombatMouseDown({ button: 0, target: lab.renderer.domElement, preventDefault() {} });
    assert.equal(lab.combatAttack, null); assert.equal(lab.groundKick, null);
    assert.equal(lab.combatBufferedPunchSeconds, 0);
  } finally { ragdoll.getGroundKickSurface = cast; }
});
