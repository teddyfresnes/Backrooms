// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { loadGeometryGlb } from '../../tests/support/load-geometry-glb';
import { ArrivalCinematic } from './ArrivalCinematic';
import { loadEntryMotions } from './EntryMotion';

const file = async (name: string): Promise<Uint8Array> => {
  // @ts-expect-error Node builtins are test-only.
  const { readFile } = await import('node:fs/promises');
  return new Uint8Array(await readFile(new URL('../../public/' + name, import.meta.url)));
};
let cinematic: ArrivalCinematic;
beforeEach(() => vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(() => new THREE.Texture()));
afterEach(() => { cinematic?.dispose(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function fixture() {
  const bytes = await file('assets/character/character.fbx');
  const avatar = new FBXLoader().parse(bytes.buffer as ArrayBuffer, '');
  avatar.updateMatrixWorld(true);
  let avatarBox = new THREE.Box3().setFromObject(avatar);
  avatar.scale.multiplyScalar(1.8 / (avatarBox.max.y - avatarBox.min.y)); avatar.updateMatrixWorld(true);
  avatarBox = new THREE.Box3().setFromObject(avatar);
  const avatarCenter = avatarBox.getCenter(new THREE.Vector3());
  avatar.position.x -= avatarCenter.x; avatar.position.z -= avatarCenter.z; avatar.position.y -= avatarBox.min.y;
  const door = await loadGeometryGlb(await file('assets/stairwell-hall-door/double_doors_with_windows.glb'));
  const size = new THREE.Box3().setFromObject(door).getSize(new THREE.Vector3());
  door.scale.set(2.3 / size.x, 2.66 / size.y, 2.3 / size.x); door.updateMatrixWorld(true);
  const center = new THREE.Box3().setFromObject(door).getCenter(new THREE.Vector3());
  door.position.set(-center.x, 1.33 - center.y, -6.1 - center.z); door.updateMatrixWorld(true);
  const packed = await file('assets/cinematics/entry-motion.bin');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(packed.buffer as ArrayBuffer)));
  const motions = await loadEntryMotions(), scene = new THREE.Scene(); scene.add(door);
  const callbacks = { onPOVBlend: vi.fn(), onComplete: vi.fn(), onDoorSound: vi.fn() };
  cinematic = new ArrivalCinematic(scene, document.body, avatar, motions.code.clip, motions, door, callbacks);
  const pov = new THREE.PerspectiveCamera(70, 1.7, .04, 160);
  pov.position.copy(cinematic.finalStandingPosition).add(new THREE.Vector3(0, .73, 0)); pov.lookAt(pov.position.clone().add(new THREE.Vector3(0, 0, 1)));
  return { scene, door, avatar, motions, callbacks, pov };
}

it('uses both full animations on the real rig/door, touches the keypad, then reaches the exact playable POV', async () => {
  const s = await fixture();
  expect(s.motions.code.clip.duration).toBe(7.5); expect(s.motions.door.clip.duration).toBeCloseTo(6.3666668);
  expect(s.motions.code.clip.tracks).toHaveLength(53); expect(s.motions.door.clip.tracks).toHaveLength(53);
  const camera = s.pov.clone(); cinematic.sample(3.6, camera);
  const finger = s.avatar.getObjectByName('mixamorigLeftHandIndex3')!.getWorldPosition(new THREE.Vector3());
  const panel = s.scene.getObjectByName('entrance-code-keypad')!.getWorldPosition(new THREE.Vector3());
  expect(panel.y).toBeGreaterThan(1.05); expect(panel.y).toBeLessThan(1.7);
  expect(Math.abs(finger.x - panel.x)).toBeLessThan(.01); expect(Math.abs(finger.y - panel.y)).toBeLessThan(.01);
  expect(panel.z - finger.z).toBeCloseTo(.032, 3);
  expect(cinematic.finalStandingPosition.z).toBeGreaterThan(-5.8); expect(cinematic.finalStandingPosition.z).toBeLessThan(-4.3);
  cinematic.start(s.pov);
  for (let i = 0; i < 850; i++) cinematic.update(1 / 60, camera);
  expect(s.callbacks.onComplete).not.toHaveBeenCalled(); expect(s.callbacks.onPOVBlend).not.toHaveBeenCalled();
  for (let i = 0; i < 120; i++) cinematic.update(1 / 60, camera);
  expect(s.callbacks.onPOVBlend).toHaveBeenCalledOnce(); expect(s.callbacks.onComplete).toHaveBeenCalledOnce();
  expect(camera.position.distanceTo(s.pov.position)).toBeLessThan(1e-8); expect(camera.quaternion.angleTo(s.pov.quaternion)).toBeLessThan(1e-7);
  expect(camera.fov).toBe(70); expect(cinematic.isShowing).toBe(false);
});

it('blocks movement keys, gives skip a short safe POV transition, and disposes without changing source geometry', async () => {
  const s = await fixture(), camera = s.pov.clone(), key = vi.fn();
  cinematic.start(s.pov); window.addEventListener('keydown', key);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', cancelable: true })); expect(key).not.toHaveBeenCalled();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
  for (let i = 0; i < 60; i++) cinematic.update(1 / 60, camera);
  expect(s.callbacks.onComplete).toHaveBeenCalledOnce(); expect(camera.position.distanceTo(s.pov.position)).toBeLessThan(1e-8);
  cinematic.dispose(); expect(document.querySelector('.arrival-cinematic')).toBeNull();
  expect(s.scene.getObjectByName('entrance-code-keypad')).toBeUndefined();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' })); expect(key).toHaveBeenCalledOnce(); window.removeEventListener('keydown', key);
});
