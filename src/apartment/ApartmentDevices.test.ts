import {reachPowerCut,gasTarget,gasOrigin} from '../../tests/support/gas-journey';
import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
vi.mock('@dimforge/rapier3d', async () => { const rapier = await import('@dimforge/rapier3d-compat'); await rapier.init(); return rapier; });
import { ImportedApartmentEnvironment } from './ImportedApartmentEnvironment';
import { ApartmentDevices, gasControlBounds } from './ApartmentDevices';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { createStairwellPlan } from '../stairwell/createStairwellPlan';
import { loadApartmentModel } from '../../tests/support/load-apartment-model';
import { ApartmentQuest, RENT_MAIL_ID } from '../story/ApartmentQuest';
import type { ApartmentDeviceAudio } from '../audio/ApartmentDeviceAudio';
const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(fn => fn()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function fixture() {
  const context = new Proxy({ createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }) }, { get: (target, key) => key in target ? target[key as 'createImageData'] : () => {} });
  vi.stubGlobal('Image',class {src='';onload=null;onerror=null;});
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context }) });
  const environment = new (ImportedApartmentEnvironment as unknown as { new(model: THREE.Object3D): ImportedApartmentEnvironment })(await loadApartmentModel());
  const physics = await PhysicsWorld.create(createStairwellPlan()); cleanup.push(() => physics.dispose()); cleanup.push(() => environment.dispose());
  physics.addTrimeshChunk('apartment', environment.shellColliderMeshes); physics.addChunk('furniture', environment.furnitureColliders, { x: 0, y: 0, z: 0 });
  const camera = new THREE.PerspectiveCamera(), quest = new ApartmentQuest(), sound = { sync: vi.fn(), unlock: vi.fn(), radioStatic: vi.fn(), moveRadio: vi.fn(), televisionSwitch: vi.fn(), buttonClick: vi.fn() };
  const devices = new ApartmentDevices(environment, physics, camera, { setInteraction() {} }, quest, sound as unknown as ApartmentDeviceAudio);
  cleanup.push(() => devices.dispose()); return { environment, quest, devices, sound, camera };
}
it('keeps each screen/dial and its local light independent of the apartment circuit, with food already in the original pan', async () => {
  const { environment, quest, devices } = await fixture();
  expect(environment.pan?.getObjectByName('apartment-pan-food')?.children).toHaveLength(14);
  quest.setGas(true); quest.setTelevision(true); quest.setRadio(true); quest.useComputer(); devices.update(.1, true, false);
  environment.setInteriorLightsEnabled(false); environment.setPowerAvailable(false);
  const light = (name: string) => (environment.group.getObjectByName(name) as THREE.PointLight).intensity;
  expect(light('imported-apartment-main-ceiling-light')).toBe(0);
  expect(light('apartment-tv-light')).toBeGreaterThan(1); expect(light('apartment-radio-light')).toBeGreaterThan(.1);
  expect(light('apartment-pc-light')).toBeGreaterThan(1); expect(light('apartment-gas-flame-light')).toBeGreaterThan(.1);
  devices.update(0, false, false); expect(light('apartment-pc-light')).toBeGreaterThan(1);
  quest.setTelevision(false); devices.update(0, true, false); expect(light('apartment-tv-light')).toBe(0);
});
it('uses the actual TV target and makes radio clicks produce only static after the unique outage', async () => {
  const { environment, quest, devices, sound, camera } = await fixture();
  // The evening order: gas first, then the TV may be switched on.
  quest.reachHome(); quest.setLight(true); quest.setGas(true);
  camera.position.set(-9.53, 9.85, -1.2); camera.lookAt(-9.53, 9.85, -.1); expect(devices.interact()).toBe(true); expect(quest.devices.tvOn).toBe(true);
  quest.setRadio(true); quest.readMail(RENT_MAIL_ID); quest.checkBank(); quest.finishGame('lost'); quest.nextThought();
  reachPowerCut(quest);
  environment.setInteriorLightsEnabled(true); environment.setPowerAvailable(false); devices.update(0, true, false);
  expect(environment.areInteriorLightsEnabled).toBe(true); expect((environment.lightSwitch.userData.rocker as THREE.Mesh).rotation.z).toBe(.16);
  camera.position.set(-5.72, 9.7, -4.8); camera.lookAt(-5.72, 9.7, -5.87);
  expect(devices.interact(false)).toBe(false);
  expect(devices.interact()).toBe(true); expect(sound.radioStatic).toHaveBeenCalledOnce(); expect(quest.devices.radioOn).toBe(true);
  camera.position.set(-9.53, 9.85, -1.2); camera.lookAt(-9.53, 9.85, -.1);
  expect(devices.interact()).toBe(true); expect(quest.devices.tvOn).toBe(false);
  expect(sound.sync).toHaveBeenLastCalledWith(quest.devices, true, 0);
  const screen = environment.television!.getObjectByName('90sTV_mat_screen_0') as THREE.Mesh, uv = screen.geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) { expect(uv.getX(i)).toBeGreaterThanOrEqual(0); expect(uv.getX(i)).toBeLessThanOrEqual(1); expect(uv.getY(i)).toBeGreaterThanOrEqual(0); expect(uv.getY(i)).toBeLessThanOrEqual(1); }
});
it('shows a persistent lit blue failure screen on the existing monitor after the outage',async()=>{
  const {environment,quest,devices}=await fixture();quest.reachHome();quest.setLight(true);quest.setGas(true);quest.setTelevision(true);quest.setRadio(true);quest.readMail(RENT_MAIL_ID);quest.checkBank();quest.useComputer();quest.finishGame('won');quest.nextThought();reachPowerCut(quest);
  devices.update(0,true,false);const screen=environment.group.getObjectByName('apartment-pc-powered-screen') as THREE.Mesh,light=environment.group.getObjectByName('apartment-pc-light') as THREE.PointLight;
  expect(((screen.material as THREE.MeshBasicMaterial).map?.image as HTMLCanvasElement).width).toBe(256);expect((screen.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xffffff);expect(light.color.getHex()).toBe(0x467dff);expect(light.intensity).toBeGreaterThan(.1);
  devices.update(0,false,false);expect(light.intensity).toBeGreaterThan(.1);expect(quest.isComputerBlocked).toBe(true);
});

it('targets all four original physical gas knobs without adding a mesh, and rejects the cooktop and through-wall clicks',async()=>{
  const {environment,devices,camera,quest}=await fixture();
  expect(environment.group.getObjectByName('apartment-gas-control')).toBeUndefined();
  const controls=gasControlBounds(environment.stove);expect(controls).toHaveLength(4);
  for(const box of controls){const center=box.getCenter(new THREE.Vector3());camera.position.set(center.x,center.y+.18,center.z-.7);camera.lookAt(center);const before=quest.devices.gasOn;expect(devices.interact()).toBe(true);expect(quest.devices.gasOn).toBe(!before);}
  const stove=new THREE.Box3().setFromObject(environment.stove!,true),center=stove.getCenter(new THREE.Vector3());
  camera.position.copy(center).add(new THREE.Vector3(0,1,0));camera.lookAt(center);expect(devices.interact()).toBe(false);
  camera.position.set(center.x,9.7,1.1);camera.lookAt(controls[0]!.getCenter(new THREE.Vector3()));expect(devices.interact()).toBe(false);
});
it('keeps every apartment light visible when the interior model is culled from the landing', async () => {
  const { environment } = await fixture();
  const count = () => { let lights = 0; environment.group.traverseVisible(object => { if ((object as THREE.Light).isLight) lights += 1; }); return lights; };
  const before = count();
  // A light that disappears with the model changes Three's light count and recompiles every lit shader.
  (environment as unknown as { model: THREE.Object3D }).model.visible = false;
  expect(count()).toBe(before);
});
