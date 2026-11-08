// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { loadGeometryGlb } from '../../tests/support/load-geometry-glb';
import { ArrivalCinematic } from './ArrivalCinematic';
import { loadEntryMotions } from './EntryMotion';
import { OBB } from 'three/addons/math/OBB.js';
import { createEntranceFacade } from './EntranceFacade';

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
  const callbacks = { onPOVBlend: vi.fn(), onComplete: vi.fn(), onDoorSound: vi.fn(), onPOVReveal: vi.fn(), onAmbienceBlend: vi.fn(), onKeypadPress:vi.fn(),onStopKeypad:vi.fn() };
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
  // Same light count before and after: no shader recompilation when control returns.
  const fill = s.scene.getObjectByName('arrival-cinematic-fill') as THREE.PointLight | undefined;
  expect(fill?.isPointLight).toBe(true); expect(fill!.intensity).toBe(0);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' })); expect(key).toHaveBeenCalledOnce(); window.removeEventListener('keydown', key);
});

it('keeps the pushing hand on the real handle, uses an opaque face close-up, and cuts to POV behind full occlusion', async () => {
  const s = await fixture(), camera = s.pov.clone();
  const hand = s.avatar.getObjectByName('mixamorigRightHand')!;
  const point = (suffix: string) => s.avatar.getObjectByName(`mixamorigRightHand${suffix}`)!.getWorldPosition(new THREE.Vector3());
  const grip = s.scene.getObjectByName('entrance-door-hand-contact')!;
  const pivot = s.scene.getObjectByName('entrance-right-leaf-hinge')!;
  for (const time of [1.9, 2.1, 2.4, 2.65, 2.8]) {
    cinematic.sample(7.5 + time, camera);
    const wrist = hand.getWorldPosition(new THREE.Vector3()), middle = point('Middle1');
    const fingers = middle.clone().sub(wrist).normalize();
    const normal = new THREE.Vector3().crossVectors(point('Index1').sub(point('Pinky1')), fingers).normalize();
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(pivot.getWorldQuaternion(new THREE.Quaternion()));
    const distance = wrist.lerp(middle, .62).distanceTo(grip.getWorldPosition(new THREE.Vector3()));
    expect(distance, `palm contact at ${time}s`).toBeLessThan(.035);
    expect(normal.dot(facing), `the back of the hand pushes the door at ${time}s`).toBeGreaterThan(.95);
    expect(fingers.y).toBeGreaterThan(.9);
  }
  cinematic.sample(6, camera);
  const head = s.avatar.getObjectByName('mixamorigHead')!.getWorldPosition(new THREE.Vector3());
  expect(camera.position.distanceTo(head)).toBeLessThan(.8); expect(camera.position.z).toBeGreaterThan(head.z);
  expect(document.querySelector('.arrival-code-caption')!.textContent).toContain('ce code');
  expect(document.querySelector('.arrival-code-caption')!.textContent).toContain('rentrer chez moi');
  cinematic.start(s.pov);
  for (let frame = 0; frame < 280; frame++) cinematic.update(.05, camera);
  expect(s.callbacks.onAmbienceBlend).toHaveBeenCalledOnce();
  for (let frame = 0; frame < 60; frame++) {
    cinematic.update(.025, camera);
    if (s.callbacks.onPOVReveal.mock.calls.length > 0) {
      expect(cinematic.root.visible).toBe(false);
      expect(camera.position.distanceTo(s.pov.position)).toBeLessThan(1e-8);
    }
  }
  expect(s.callbacks.onPOVReveal).toHaveBeenCalledOnce();
  let batches = 0; s.door.traverseVisible(object => { if ((object as THREE.Mesh).isMesh) batches++; });
  expect(batches).toBeLessThan(35);
});

it('keeps the authored duration on 100ms frames instead of stretching the whole entrance', async () => {
  const s = await fixture(), camera = s.pov.clone(); cinematic.start(s.pov);
  for (let frame = 0; frame < 160; frame++) cinematic.update(.1, camera);
  expect(s.callbacks.onComplete).toHaveBeenCalledOnce();
  expect(camera.position.distanceTo(s.pov.position)).toBeLessThan(1e-8);
});

it('holds the initial head pose without accumulating tilt across repeated render frames', async () => {
  const s = await fixture(), camera = s.pov.clone(), head = s.avatar.getObjectByName('mixamorigHead')!;
  cinematic.sample(0, camera); const rotation = head.quaternion.clone();
  for (let frame = 0; frame < 180; frame++) cinematic.sample(0, camera);
  expect(head.quaternion.angleTo(rotation)).toBeLessThan(1e-6);
  cinematic.sample(9.9, camera); const hand = s.avatar.getObjectByName('mixamorigRightHandIndex2')!;
  const position = hand.getWorldPosition(new THREE.Vector3());
  for (let frame = 0; frame < 120; frame++) cinematic.sample(9.9, camera);
  expect(hand.getWorldPosition(new THREE.Vector3()).distanceTo(position)).toBeLessThan(.001);
});

it('frames the entrance from outside the facade before orbiting into the face close-up', async () => {
  const s = await fixture(), camera = s.pov.clone(), material = new THREE.MeshBasicMaterial();
  const facade = createEntranceFacade(material); facade.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  for (const time of [0, .5, 1, 2, 4, 6]) {
    cinematic.sample(time, camera); camera.updateMatrixWorld(true);
    ray.setFromCamera(new THREE.Vector2(), camera);
    expect(ray.intersectObject(facade, true), `masonry blocks the ${time}s shot`).toHaveLength(0);
  }
  cinematic.sample(0, camera);
  const head = s.avatar.getObjectByName('mixamorigHead')!.getWorldPosition(new THREE.Vector3());
  expect(camera.position.z).toBeLessThan(head.z - 1);
  facade.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); }); material.dispose();
});

it('closes with the left-hand gesture on screen and keeps the body outside the sweeping leaf', async () => {
  const s = await fixture(), camera = s.pov.clone(), pivot = s.scene.getObjectByName('entrance-right-leaf-hinge')!;
  cinematic.sample(7.5, camera);
  const closed = new THREE.Box3().setFromObject(pivot), hinge = pivot.getWorldPosition(new THREE.Vector3());
  const center = closed.getCenter(new THREE.Vector3()), half = closed.getSize(new THREE.Vector3()).multiplyScalar(.5);
  const matrix = new THREE.Matrix4(), obb = new OBB(), body = new THREE.Sphere(undefined, .32);
  let previous = Infinity;
  for (let time = 4.8; time <= 6.3; time += 1 / 60) {
    cinematic.sample(7.5 + time, camera);
    if (time >= 5) { expect(pivot.rotation.y).toBeLessThanOrEqual(previous + .00001); previous = pivot.rotation.y; }
    matrix.makeRotationY(pivot.rotation.y); obb.center.copy(center).sub(hinge).applyMatrix4(matrix).add(hinge);
    obb.halfSize.copy(half); obb.rotation.setFromMatrix4(matrix); body.center.copy(cinematic.root.position); body.center.y = 1;
    expect(obb.intersectsSphere(body), `body intersects door at ${time}s`).toBe(false);
  }
  cinematic.sample(7.5 + 5.15, camera);
  const wrist = s.avatar.getObjectByName('mixamorigLeftHand')!.getWorldPosition(new THREE.Vector3());
  const middle = s.avatar.getObjectByName('mixamorigLeftHandMiddle1')!.getWorldPosition(new THREE.Vector3());
  const hand = wrist.lerp(middle, .62);
  const contact = s.scene.getObjectByName('entrance-door-closing-contact')!.getWorldPosition(new THREE.Vector3());
  expect(hand.distanceTo(contact)).toBeLessThan(.025);
  expect(camera.position.z).toBeGreaterThan(cinematic.root.position.z); // door remains behind the actor in view
  cinematic.sample(7.5 + 5.9, camera); expect(pivot.rotation.y).toBe(0);
  expect(cinematic.finalStandingPosition.z).toBeGreaterThan(-4.8);
});

it('emits one spatial click per visible finger press, never from sampling, skipping or a disposed session',async()=>{
 const s=await fixture(),camera=s.pov.clone();
 for(const time of [0,3.03,3.37,3.8,4.23,4.5,4.93,0])cinematic.sample(time,camera);
 expect(s.callbacks.onKeypadPress).not.toHaveBeenCalled();cinematic.start(s.pov);
 for(let frame=0;frame<200;frame++)cinematic.update(.05,camera);
 expect(s.callbacks.onKeypadPress).toHaveBeenCalledTimes(6);
 const panel=s.scene.getObjectByName('entrance-code-keypad')!.getWorldPosition(new THREE.Vector3());
 for(const [position] of s.callbacks.onKeypadPress.mock.calls)expect(position.distanceTo(panel)).toBeLessThan(.001);
 cinematic.dispose();for(let frame=0;frame<100;frame++)cinematic.update(.05,camera);
 expect(s.callbacks.onKeypadPress).toHaveBeenCalledTimes(6);
 const next=await fixture();cinematic.start(next.pov);
 for(let frame=0;frame<76;frame++)cinematic.update(.05,camera);
 const count=next.callbacks.onKeypadPress.mock.calls.length;expect(count).toBe(1);
 window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',cancelable:true}));
 for(let frame=0;frame<200;frame++)cinematic.update(.05,camera);
 expect(next.callbacks.onKeypadPress).toHaveBeenCalledTimes(count);expect(next.callbacks.onStopKeypad).toHaveBeenCalled();
});
