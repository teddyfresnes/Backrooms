import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from './support/rapier-headless.mjs';
import { sweepGroundKickVolumes } from './support/ground-volume-contact.mjs';
import { groundKickKindForTarget } from '../.movement-test-dist/dev/GroundKickRules.js';
const v = (x, y, z) => new THREE.Vector3(x, y, z);
const volume = (shape, rotation = new THREE.Quaternion(), position = v(0, .30, 0)) => ({ id: 1, shape, position, rotation });
const sweep = (before, now, previous, current, phaseBefore = .49, phaseNow = .61) =>
  sweepGroundKickVolumes(before, now, previous, current, .095, .04, phaseBefore, phaseNow, .49, .63);
test('a propped-up torso selects a compact forward kick while a flat body retains ground contact', () => {
  assert.equal(groundKickKindForTarget(.96, .75), 'get-up-kick');
  assert.equal(groundKickKindForTarget(.96, .30), 'soccer-kick');
  assert.equal(groundKickKindForTarget(.32, .30), 'stomp');
});
for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI]) {
  test(`continuous sole contact uses the actual torso collider rotated by ${angle} radians`, () => {
    const body = volume(new RAPIER.Cuboid(.24, .17, .43), new THREE.Quaternion().setFromAxisAngle(v(0, 0, 1), angle));
    const result = sweep(v(0, .85, 0), v(0, .35, 0), [body], [body]);
    assert.ok(result);
    const point = body.shape.projectPoint(body.position, body.rotation, result.point, false).point;
    assert.ok(v(point.x, point.y, point.z).distanceTo(result.point) < .004);
    assert.ok(result.fraction >= 0 && result.fraction <= 1);
  });
}
test('a moving flank is hit even when the old aim point is outside the actual boot path', () => {
  const previous = volume(new RAPIER.Capsule(.22, .16), new THREE.Quaternion().setFromAxisAngle(v(0, 0, 1), Math.PI / 2), v(.2, .3, 0));
  const current = { ...previous, position: v(.18, .3, 0) };
  assert.ok(sweep(v(-.28, .3, 0), v(.1, .3, 0), [previous], [current]));
});
test('a torso rolling into the drive is swept without depending on a ray-selected surface point', () => {
  const previous = volume(new RAPIER.Cuboid(.24, .17, .43));
  const current = { ...previous, rotation: new THREE.Quaternion().setFromAxisAngle(v(0, 0, 1), .22) };
  assert.ok(sweep(v(.12, .85, 0), v(.12, .35, 0), [previous], [current]));
});
test('a withdrawing boot, stationary overlap and target teleport cause no damage', () => {
  const body = volume(new RAPIER.Cuboid(.24, .17, .43));
  assert.equal(sweep(v(0, .52, 0), v(0, .9, 0), [body], [body]), null);
  assert.equal(sweep(v(0, .52, 0), v(0, .52, 0), [body], [body]), null);
  assert.equal(sweep(v(0, .85, 0), v(0, .35, 0), [body], [{ ...body, position: v(3, .3, 0) }]), null);
});
test('no collider, a high miss and a contact outside the drive window remain misses', () => {
  const body = volume(new RAPIER.Cuboid(.24, .17, .43));
  assert.equal(sweep(v(0, .85, 0), v(0, .35, 0), [], []), null);
  assert.equal(sweep(v(0, 1.2, 0), v(0, 1, 0), [body], [body]), null);
  assert.equal(sweep(v(0, .85, 0), v(0, .35, 0), [body], [body], .20, .30), null);
});
