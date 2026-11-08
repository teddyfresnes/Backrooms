import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Compass, CompassNeedle } from './Compass';
import { FuseBox, FUSE_BOX_MOUNT } from './FuseBox';
import { GiftParcel } from '../stairwell/GiftParcel';
import { EscapeStreet } from '../stairwell/EscapeStreet';
import { gripForItem, heldItemFrame, HeldItemPose } from '../character/HeldItemPose';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
// @ts-expect-error Node builtins are restricted to tests.
import { readFileSync } from 'node:fs';
import { BackroomsBelow, BELOW_TOP_Y } from '../monster/BackroomsBelow';

const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

it('settles the needle on north when calm and loses it near the creature', () => {
  const calm = new CompassNeedle();
  for (let i = 0; i < 400; i++) calm.step(1 / 60, 1.2, 0);
  expect(Math.abs(wrap(calm.angle - 1.2))).toBeLessThan(0.02);
  const mad = new CompassNeedle();
  let worst = 0;
  for (let i = 0; i < 400; i++) { mad.step(1 / 60, 1.2, 1); if (i > 120) worst = Math.max(worst, Math.abs(wrap(mad.angle - 1.2))); }
  expect(worst).toBeGreaterThan(1);
});

it('points the red tip of the held compass toward world north whatever the case heading', () => {
  const scene = new THREE.Scene(), compass = new Compass(scene), camera = new THREE.PerspectiveCamera();
  const palm = { position: new THREE.Vector3(1, 1, 1), quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.9) };
  for (let i = 0; i < 300; i++) compass.update(camera, palm, true, 0, 1 / 60);
  const needle = compass.model.getObjectByName('compass-needle')!;
  const tip = new THREE.Vector3(0, 0, -1).applyQuaternion(needle.getWorldQuaternion(new THREE.Quaternion()));
  expect(tip.z).toBeLessThan(-0.99);
  compass.update(camera, undefined, false, 0, 1 / 60);
  expect(compass.model.visible).toBe(false);
  compass.dispose();
  expect(scene.children).toHaveLength(0);
});

it.each(['compass', 'torch'] as const)('brings the real right hand to a %s fixed in the view', kind => {
  const bytes = readFileSync('public/assets/character/character.fbx');
  const root = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  root.updateMatrixWorld(true);
  const bone = (suffix: string) => { let found: THREE.Bone | undefined; root.traverse(o => { if (!found && (o as THREE.Bone).isBone && o.name.toLowerCase().replace(/[^a-z0-9]/g, '').endsWith(suffix)) found = o as THREE.Bone; }); return found!; };
  const upper = bone('rightarm'), lower = bone('rightforearm'), hand = bone('righthand'), head = bone('head');
  // The character faces +Z: an eye camera at the head looking the same way.
  const eye = head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.08, 0.1));
  const camera = new THREE.PerspectiveCamera(); camera.position.copy(eye); camera.lookAt(eye.clone().add(new THREE.Vector3(0, -0.15, 1))); camera.updateMatrixWorld(true);
  const view = camera.matrixWorld.clone(), aim = eye.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(12));
  const frame = heldItemFrame(kind, view, aim, true, { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() });
  // In the lower right of the view, in front of the eye.
  const local = frame.position.clone().applyMatrix4(view.clone().invert());
  expect(local.z).toBeLessThan(-0.2); expect(local.x).toBeGreaterThan(0); expect(local.y).toBeLessThan(0);
  const right = new THREE.Vector3().setFromMatrixColumn(view, 0), up = new THREE.Vector3().setFromMatrixColumn(view, 1);
  const grip = { palm: new THREE.Vector3(), normal: new THREE.Vector3(), fingers: new THREE.Vector3(), pole: new THREE.Vector3(), curl: 0 };
  grip.curl = gripForItem(kind, frame, right, up, grip);
  const pose = new HeldItemPose();
  for (let i = 0; i < 80; i++) pose.advance(true, 1 / 30);
  pose.apply([upper, lower, hand], grip);
  root.updateMatrixWorld(true);
  const p = (b: THREE.Bone) => b.getWorldPosition(new THREE.Vector3());
  const f = p(bone('righthandmiddle1')).sub(p(hand)).normalize(), t = p(bone('righthandindex1')).sub(p(bone('righthandpinky1')));
  const normal = new THREE.Vector3().crossVectors(t, f).normalize();
  expect(normal.dot(grip.normal)).toBeGreaterThan(0.9);
  const palm = p(hand).lerp(p(bone('righthandmiddle1')), 0.62);
  expect(palm.distanceTo(grip.palm)).toBeLessThan(0.05);
  if (kind === 'torch') {
    // Fingers closed: the middle fingertip has come round toward the palm side.
    const tip = p(bone('righthandmiddle3')).sub(p(bone('righthandmiddle1')));
    expect(tip.dot(grip.normal)).toBeGreaterThan(0.01);
  }
});

it('re-arms every breaker one after another, then trips them all back once', () => {
  const ui = { setInteraction: vi.fn() }, flip = vi.fn(), trip = vi.fn(), click = vi.fn();
  const box = new FuseBox(8.64, { ui, flip, trip, click });
  const scene = new THREE.Scene(); scene.add(box.group); scene.updateMatrixWorld(true);
  const eye = new THREE.Vector3(FUSE_BOX_MOUNT.wallX + FUSE_BOX_MOUNT.facing * 0.8, 8.64 + FUSE_BOX_MOUNT.height, FUSE_BOX_MOUNT.z), look = new THREE.Vector3(-FUSE_BOX_MOUNT.facing, 0, 0);
  expect(box.interact(eye, look, false)).toBe(false);
  box.updatePrompt(eye, look, true);
  expect(ui.setInteraction).toHaveBeenLastCalledWith('Ouvrir le tableau électrique');
  expect(box.interact(eye, look, true)).toBe(true);
  expect(click).toHaveBeenCalledOnce();
  for (let i = 0; i < 60; i++) box.update(1 / 60);
  scene.updateMatrixWorld(true);
  box.updatePrompt(eye, look, true);
  expect(ui.setInteraction).toHaveBeenLastCalledWith('Réarmer les disjoncteurs');
  expect(box.interact(eye, look, true)).toBe(true);
  expect(box.locksMovement).toBe(true);
  let tripped = 0;
  for (let i = 0; i < 400; i++) {
    if (box.update(1 / 60) === 'tripped') tripped++;
    if (flip.mock.calls.length === 20) expect(box.locksMovement).toBe(false);
    else expect(box.locksMovement).toBe(true);
    if (flip.mock.calls.length === 20 && !tripped) expect(box.isBusy).toBe(true);
  }
  expect(tripped).toBe(1); expect(trip).toHaveBeenCalledOnce(); expect(flip).toHaveBeenCalledTimes(20);
  expect(box.collider.halfExtents.x).toBeGreaterThan(0.02);
  box.dispose();
});

it('opens Chloé’s parcel once and hands over the compass', () => {
  const ui = { setInteraction: vi.fn() };
  const gift = new GiftParcel({ x: -1.66, y: 8.64, z: -3.64 }, 0.32, false, ui);
  const scene = new THREE.Scene(); scene.add(gift.group); scene.updateMatrixWorld(true);
  const eye = new THREE.Vector3(-0.9, 10.2, -3.64), look = new THREE.Vector3(-1.66, 8.75, -3.64).sub(eye).normalize();
  expect(gift.isTargeted(eye, look)).toBe(true);
  expect(gift.open()).toBe(true); expect(gift.open()).toBe(false);
  let finished = 0;
  for (let i = 0; i < 120; i++) if (gift.update(1 / 60)) finished++;
  expect(finished).toBe(1); expect(gift.isOpened).toBe(true); expect(gift.isTargeted(eye, look)).toBe(false);
  gift.dispose();
  const restored = new GiftParcel({ x: 0, y: 0, z: 0 }, 0, true, ui);
  expect(restored.isOpened).toBe(true); restored.dispose();
});

it('lays a verge far wider than the run, and an open landing cell under the fall', () => {
  const street = new EscapeStreet({ halfWidth: 3.2, floorY: 0, nearZ: -6.36, endZ: -32 });
  const ground = street.group.getObjectByName('escape-verge-ground') as THREE.Mesh;
  ground.geometry.computeBoundingBox();
  expect(ground.geometry.boundingBox!.max.x - ground.geometry.boundingBox!.min.x).toBeGreaterThan(100);
  expect(ground.position.z + ground.geometry.boundingBox!.max.z).toBeLessThanOrEqual(-6.36);
  const tufts = street.group.getObjectByName('escape-verge-tufts') as THREE.InstancedMesh;
  expect(tufts.count).toBeGreaterThan(1500);
  street.dispose();
  const below = new BackroomsBelow();
  below.placeUnder(0.5, -20);
  const walls = below.group.children.find(child => (child as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh;
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
  for (let i = 0; i < walls.count; i++) {
    walls.getMatrixAt(i, matrix); position.setFromMatrixPosition(matrix);
    expect(Math.max(Math.abs(position.x), Math.abs(position.z))).toBeGreaterThan(5);
  }
  expect(below.group.position.y).toBe(BELOW_TOP_Y);
  below.dispose();
});
