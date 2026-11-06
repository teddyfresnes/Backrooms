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
  const callbacks = { onPOVBlend: vi.fn(), onComplete: vi.fn(), onDoorSound: vi.fn(), onPOVReveal: vi.fn(), onAmbienceBlend: vi.fn() };
  cinematic = new ArrivalCinematic(scene, document.body, avatar, motions.code.clip, motions, door, callbacks);
  const pov = new THREE.PerspectiveCamera(70, 1.7, .04, 160);
  pov.position.copy(cinematic.finalStandingPosition).add(new THREE.Vector3(0, .73, 0)); pov.lookAt(pov.position.clone().add(new THREE.Vector3(0, 0, 1)));
  return { scene, door, avatar, motions, callbacks, pov };
}

it('reports authored entrance contact samples', async () => {
 const s=await fixture(), camera=s.pov.clone(), rows: unknown[]=[];
 for(const t of [0,1,1.5,1.9,2.4,2.8,3.2,3.6,4,4.4,4.8,5.2,5.6,6,6.3666668]) {
 cinematic.sample(7.5+t,camera);
 const point=(name:string)=>s.avatar.getObjectByName(name)!.getWorldPosition(new THREE.Vector3()).toArray().map(x=>+x.toFixed(3));
 rows.push({t,root:cinematic.root.position.toArray(),hand:point('mixamorigRightHandIndex2'),left:point('mixamorigLeftHandIndex3'),grip:s.scene.getObjectByName('entrance-door-hand-contact')!.getWorldPosition(new THREE.Vector3()).toArray(),camera:camera.position.toArray()});
 }
 // @ts-expect-error Node builtins are test-only.
 const {mkdir,writeFile}=await import("node:fs/promises");
 await mkdir('tmp',{recursive:true});
 await writeFile('tmp/arrival-probe.json',JSON.stringify(rows));
});
