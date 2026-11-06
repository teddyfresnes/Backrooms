// CPU-only characterization on the shipped model and real Rapier. No renderer,
// image decoding, GPU timing, network timing or claim of in-game frame times.
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { decodeApartmentBinary } from '../src/apartment/ApartmentBinary';
import { transferredGeometry } from '../src/apartment/TransferredGeometry';
import { ImportedApartmentEnvironment } from '../src/apartment/ImportedApartmentEnvironment';
import { ImportedApartmentDoorInteraction } from '../src/apartment/ImportedApartmentDoorInteraction';
import { ApartmentObjectInteraction } from '../src/apartment/ApartmentObjectInteraction';
import { LongCorridor } from '../src/apartment/LongCorridor';
import { StairwellEnvironment } from '../src/stairwell/StairwellEnvironment';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { createStairwellPlan } from '../src/stairwell/createStairwellPlan';
import type { StairwellMaterialSet } from '../src/stairwell/StairwellMaterials';

await RAPIER.init();
const gradient = { addColorStop() {} };
const context = new Proxy({ createLinearGradient: () => gradient, createRadialGradient: () => gradient },
  { get: (target, key) => Reflect.get(target, key) ?? (() => undefined) });
Object.assign(globalThis, { document: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } });
const metrics: Record<string, unknown> = { limitation: 'CPU only, real shipped geometry/material definitions and Rapier; inert images/2D canvas; no WebGL, network or full character runtime.' };
const measure = <T>(name: string, fn: () => T): T => { const start = performance.now(); const result = fn(); metrics[name] = performance.now() - start; return result; };
const samples = (name: string, count: number, fn: (i: number) => void) => {
  const times: number[] = [];
  for (let i = 0; i < count; i++) { const t = performance.now(); fn(i); times.push(performance.now() - t); }
  const sorted = times.slice(1).sort((a, b) => a - b);
  metrics[name] = { firstMs: times[0], repeatP95Ms: sorted[Math.floor(.95 * (sorted.length - 1))], maxMs: Math.max(...times), count };
};
const manifest = JSON.parse(readFileSync('public/assets/imported-apartment/apartment.runtime.parts.json', 'utf8'));
const compressed = Buffer.concat(manifest.parts.map((p: { file: string }) => readFileSync('public/assets/imported-apartment/' + p.file)));
metrics.apartmentCompressedBytes = compressed.length;
const bytes = measure('decompressionCpuMs', () => gunzipSync(compressed));
const data = measure('binaryDecodeCpuMs', () => decodeApartmentBinary(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
const model = measure('objectAssemblyCpuMs', () => {
  const loader = new THREE.ObjectLoader(), geometries = {}, materialLoader = new THREE.MaterialLoader();
  for (const source of data.geometries ?? []) { const g = transferredGeometry(source); if (g) geometries[g.uuid] = g; }
  const textures: Record<string, THREE.Texture> = {};
  for (const texture of (data.textures ?? []) as { uuid: string }[]) textures[texture.uuid] = new THREE.Texture();
  materialLoader.setTextures(textures);
  const materials = Object.fromEntries((data.materials as THREE.MaterialJSON[]).map(m => [m.uuid, materialLoader.parse(m)]));
  return loader.parseObject(data.object, geometries, materials, {});
});
const apartment = measure('apartmentConstructCpuMs', () => new (ImportedApartmentEnvironment as unknown as { new(m: THREE.Object3D): ImportedApartmentEnvironment })(model));
const start = performance.now(); let maxTaskGap = 0, previous = start;
const watchdog = setInterval(() => { const now = performance.now(); maxTaskGap = Math.max(maxTaskGap, now - previous); previous = now; }, 0);
await (apartment as unknown as { prepareRuntime(): Promise<void> }).prepareRuntime();
clearInterval(watchdog); metrics.apartmentPrepareWallMs = performance.now() - start; metrics.apartmentPrepareMaxTaskGapMs = maxTaskGap;
const material = new THREE.MeshStandardMaterial(), materials = new Proxy({}, { get: () => material }) as StairwellMaterialSet;
const environment = measure('stairwellConstructCpuMs', () => new StairwellEnvironment(materials));
const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x10161c, 16, 52); scene.add(environment.group, apartment.group);
const physics = await PhysicsWorld.create(createStairwellPlan());
measure('shellCollidersCpuMs', () => physics.addTrimeshChunk('shell', apartment.shellColliderMeshes));
measure('furnitureCollidersCpuMs', () => physics.addChunk('furniture', apartment.furnitureColliders, { x: 0, y: 0, z: 0 }));
const camera = new THREE.PerspectiveCamera(), ui = { setInteraction() {}, setCarryHint() {} };
const objects = measure('allPropsMountCpuMs', () => new ApartmentObjectInteraction(physics, scene, apartment.pickables, camera, ui));
const corridor = measure('corridorConstructCpuMs', () => new LongCorridor(apartment.corridorDoorway, apartment.corridorFloorY, new Proxy({}, {get:()=>materials.upperPlaster}) as import('../src/render/MaterialLibrary').MaterialSet, physics)); scene.add(corridor.group);
// prepare() is intentionally optional to compare the original and repaired code.
if ('prepare' in corridor) await (corridor as unknown as { prepare(): Promise<void> }).prepare();
const door = new ImportedApartmentDoorInteraction(apartment.entryDoor.pivot, apartment.entryDoor.leaf, apartment.entryDoor.closedBox,
  apartment.createDoorCollider('door', apartment.entryDoor.closedBox), physics, ui,
  { chunkKey: 'door', openAngle: apartment.entryDoor.openAngle, closedAngle: apartment.entryDoor.closedAngle });
const position = new THREE.Vector3(-1.1, apartment.floorY + .865, apartment.doorCenter.z);
const direction = new THREE.Vector3(-1, 0, 0);
samples('doorOpeningCpu', 150, i => {
  if (i % 75 === 0) door.restoreState({ progress: 0, targetProgress: 1 });
  door.update(1 / 60, position, direction, true); apartment.updateVisibility(position); physics.stepDynamics(1 / 60);
});
samples('stairClimbCpu', 240, i => {
  if (i % 120 === 0) physics.teleport({ x: -1.05, y: .865, z: -1.7 });
  physics.move({ x: 0, y: -.015, z: 2.8/60 }); environment.update(i / 60);
});
const stairEnd=new THREE.Vector3();physics.getPosition(stairEnd);metrics.stairClimbEnd=stairEnd.toArray();
if(stairEnd.y<2.25||stairEnd.z<2.1)throw Error('The profile did not climb the actual flight: '+JSON.stringify(stairEnd));
const bottle = apartment.pickables.find(i => i.kind === 'whisky')!;
objects.update(false);
const bottleCenter = new THREE.Box3().setFromObject(bottle.parts[0]!, true).getCenter(new THREE.Vector3());
let reachable = false;
for (const offset of [[0, .08, -.4], [.4, .08, 0], [-.4, .08, 0], [0, .4, 0], [0, .08, .4]]) {
  camera.position.copy(bottleCenter).add(new THREE.Vector3(...offset)); camera.lookAt(bottleCenter); camera.updateMatrixWorld(true);
  if ((objects as unknown as { findTarget(): { id: string } | undefined }).findTarget()?.id === bottle.id) { reachable = true; break; }
}
metrics.whiskyReachable = reachable;
samples('whiskyTargetCpu', 60, () => objects.update(true, .11));
samples('whiskyGrabCpu', 2, () => { const taken = objects.interact(); if (!taken) {
  console.log({ bottleCenter, camera: camera.position, visible: bottle.parts[0]!.visible,
    target: (objects as unknown as { findTarget(): unknown }).findTarget(), broken: (objects as unknown as { broken: unknown }).broken });
  throw new Error('Whisky unreachable');
} objects.release(); });
objects.interact();
samples('whiskyCarriedTickCpu', 90, () => { objects.beforePhysicsStep(); physics.stepDynamics(1 / 60); objects.update(false, 1 / 60); }); objects.release();
const counts = () => { const lights: Record<string, number> = {}; scene.traverseVisible(o => { if ((o as THREE.Light).isLight) lights[o.type] = (lights[o.type] ?? 0) + 1; }); return lights; };
metrics.lightTopologyBefore = counts();
measure('outageSwapCpuMs', () => {
  apartment.setPowerAvailable(false); environment.setPowerAvailable(false);
  const swap = () => { corridor.activate(scene); physics.removeChunk('origin'); physics.removeChunk('stairwell-furniture'); };
  if ('prepare' in corridor) physics.batchChunkChanges(swap); else swap();
  if ('showPostOutage' in environment) (environment as unknown as { showPostOutage(): void }).showPostOutage(); else environment.group.visible = false;
});
metrics.lightTopologyAfter = counts();
samples('corridorLightAnimationCpu', 240, i => corridor.setLights(Math.min(42, Math.floor(i / 4)), 1));
// Real ray/side/material probes. Include the complete stairwell and both sides
// of the doorway, rather than testing an isolated interior for opaque screens.
environment.group.visible = true;
const rays = [], ray = new THREE.Raycaster();
for (const angle of [-.15, -.7, apartment.entryDoor.openAngle]) for (const x of [-.8, -1.4, -3.2]) for (const z of [-.22, 0, .22]) {
  apartment.entryDoor.pivot.rotation.y = angle; apartment.group.updateMatrixWorld(true);
  const viewer = new THREE.Vector3(x, apartment.floorY + 1.6, apartment.doorCenter.z + z); apartment.updateVisibility(viewer);
  ray.set(viewer, new THREE.Vector3(x > -2 ? -1 : 1, 0, 0)); ray.far = 4;
  const meshes: THREE.Mesh[] = []; scene.traverseVisible(o => { if (o instanceof THREE.Mesh && o !== corridor.group && !o.name.startsWith('corridor-') && !o.isInstancedMesh) meshes.push(o); });
  const hits = ray.intersectObjects(meshes, false).filter(h => { const m = (h.object as THREE.Mesh).material; return !Array.isArray(m) && (!m.transparent || m.opacity > .1); });
  rays.push({ angle, x, z, hits: hits.slice(0, 2).map(h => ({ name: h.object.name, distance: h.distance, material: ((h.object as THREE.Mesh).material as THREE.Material).type })) });
}
metrics.doorRays = rays;
let geometryBytes=0;const seenGeometry=new Set<THREE.BufferGeometry>();
scene.traverse(o=>{const m=o as THREE.Mesh;if(!m.geometry||seenGeometry.has(m.geometry))return;seenGeometry.add(m.geometry);for(const a of Object.values(m.geometry.attributes))geometryBytes+=(a as THREE.BufferAttribute).array?.byteLength??0;geometryBytes+=m.geometry.index?.array.byteLength??0;});
metrics.geometryBufferBytes=geometryBytes;
metrics.blindMaterials = apartment.windowBlinds.map(b => { const entries = []; b.blind.traverse(o => { const mesh = o as THREE.Mesh; if (!mesh.isMesh) return; for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) entries.push({ type: m.type, name: m.name, emissive: (m as THREE.MeshStandardMaterial).emissive?.getHex(), intensity: (m as THREE.MeshStandardMaterial).emissiveIntensity }); }); return entries; });
objects.dispose(); door.dispose(); corridor.dispose(); physics.dispose(); apartment.dispose(); environment.dispose(); material.dispose();
const target = process.argv[2]; if (target) writeFileSync(target, JSON.stringify(metrics, null, 2) + '\n');
console.log(JSON.stringify(metrics, null, 2));
