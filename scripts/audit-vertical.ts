import { performance } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { WorldView } from '../src/render/WorldBuilder';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import type { MaterialSet } from '../src/render/MaterialLibrary';
import type { WorldPlan } from '../src/world/types';
import { generateWorld, validateWorldPlan } from '../src/world/generateWorld';
import { generateInfiniteChunk } from '../src/world/InfiniteWorld';
import { pointInRect, rectCenter } from '../src/world/types';

const seeds = Array.from({ length: 24 }, (_, i) => `VERTICAL-PROMPT-AUDIT-${i}`);
const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * .95) - 1] };
};
const materialsForAudit = () => Object.fromEntries(['wall', 'plaster', 'floor', 'ceiling', 'baseboard', 'pitWall', 'pitBottom', 'metal', 'fixtureFrame', 'fixtureGlow', 'void']
  .map(name => [name, name === 'fixtureGlow' || name === 'void' ? new THREE.MeshBasicMaterial() : new THREE.MeshStandardMaterial()])) as unknown as MaterialSet;
const heightAt = (s: NonNullable<WorldPlan['topology']>['surfaces'][number], x: number, z: number) => s.profile.kind === 'flat' ? s.profile.y
  : s.profile.startY + (s.profile.endY - s.profile.startY) * (s.profile.axis === 'x'
    ? (x - s.bounds.minX) / (s.bounds.maxX - s.bounds.minX) : (z - s.bounds.minZ) / (s.bounds.maxZ - s.bounds.minZ));

const reproduction = async () => {
  const world = generateWorld('VERTICAL-PROMPT-AUDIT-3'), point = { x: -44, z: -2.5 };
  const candidates = world.topology?.surfaces.filter(s => pointInRect(point.x, point.z, s.bounds)) ?? [];
  candidates.sort((a, b) => Math.abs(heightAt(a, point.x, point.z) - 1.1) - Math.abs(heightAt(b, point.x, point.z) - 1.1));
  const footY = candidates[0] ? heightAt(candidates[0], point.x, point.z) : 1.1;
  const materials = materialsForAudit(), view = new WorldView({ ...world, propPlacements: [] }, materials); await view.ready;
  const physics = await PhysicsWorld.create(world); view.group.updateMatrixWorld(true);
  const hit = new THREE.Raycaster(new THREE.Vector3(point.x, footY + .2, point.z), new THREE.Vector3(0, 1, 0), 0, 10).intersectObject(view.group, true)[0];
  const blocked = physics.world.intersectionWithShape({ ...point, y: footY + .91 }, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Capsule(.52, .32),
    undefined, undefined, undefined, undefined, physics.isEnvironmentCollider);
  const result = { point, footY, mesh: hit?.object.name, meshCeilingY: hit?.point.y, meshClearance: hit ? hit.point.y - footY : null, standingCapsuleBlocked: blocked !== null };
  physics.dispose(); view.dispose(); Object.values(materials).forEach(m => m.dispose()); return result;
};
const architecturalMetrics = async (world: WorldPlan) => {
  const materials = materialsForAudit(), start = performance.now(), view = new WorldView({ ...world, propPlacements: [] }, materials); await view.ready;
  const prepareMs = performance.now() - start; let triangles = 0, materialBatches = 0;
  view.group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const count = object.geometry.index?.count ?? object.geometry.getAttribute('position')?.count ?? 0;
    triangles += count / 3 * (object instanceof THREE.InstancedMesh ? object.count : 1);
    if (count > 0) materialBatches += Math.max(1, object.geometry.groups.length);
  });
  const mountStart = performance.now(), physics = await PhysicsWorld.create({ ...world, propPlacements: [] });
  const physicsMountMs = performance.now() - mountStart, heap = getHeapStatistics().used_heap_size;
  physics.dispose(); view.dispose(); Object.values(materials).forEach(m => m.dispose());
  return { prepareMs, physicsMountMs, triangles, materialBatches, heap };
};
const measure = async (infinite: boolean, warm = false) => {
  const times: number[] = [], bytes: number[] = [], colliders: number[] = [], cloneMs: number[] = [], prepareMs: number[] = [], physicsMountMs: number[] = [], triangles: number[] = [], materialBatches: number[] = [], heaps: number[] = [];
  (globalThis as { gc?: () => void }).gc?.(); const heapBefore = getHeapStatistics().used_heap_size;
  for (const seed of seeds) {
    if (infinite && warm) generateInfiniteChunk(seed, { x: -1, z: 1, story: 0 });
    const start = performance.now(), world = infinite ? generateInfiniteChunk(seed, { x: -1, z: 1, story: 0 }) : generateWorld(seed);
    times.push(performance.now() - start);
    const cloneStart = performance.now(); structuredClone(world); cloneMs.push(performance.now() - cloneStart);
    bytes.push(Buffer.byteLength(JSON.stringify(world))); colliders.push(world.colliders.length);
    const metrics = await architecturalMetrics(world); prepareMs.push(metrics.prepareMs); physicsMountMs.push(metrics.physicsMountMs);
    triangles.push(metrics.triangles); materialBatches.push(metrics.materialBatches); heaps.push(metrics.heap);
  }
  (globalThis as { gc?: () => void }).gc?.();
  return { generationMs: summary(times), cloneMs: summary(cloneMs), architecturalPrepareMs: summary(prepareMs), physicsMountMs: summary(physicsMountMs),
    jsonBytes: summary(bytes), colliders: summary(colliders), triangles: summary(triangles), materialBatches: summary(materialBatches), sampledHeapPeakBytes: Math.max(...heaps), retainedHeapDeltaBytes: getHeapStatistics().used_heap_size - heapBefore };
};
const diversity = () => {
  const families: Record<string, number> = {}, unreachableKinds: Record<string, number> = {}, examples: any[] = [], errors: any[] = [];
  let ordinarySurfaces = 0, crouchSurfaces = 0, ordinaryLowSurfaces = 0, ordinaryArea = 0, crouchArea = 0, monumentChunks = 0;
  const unreachableVertical: any[] = [];
  for (let i = 0; i < 128; i++) {
    const seed = `VERTICAL-PROMPT-AUDIT-${i}`, world = generateInfiniteChunk(seed, { x: -1, z: 1, story: 0 }), produced = new Set<string>();
    if (!world.topology) { monumentChunks++; continue; }
    const issues = validateWorldPlan(world); if (issues.length) errors.push({ seed, issues });
    for (const s of world.topology!.surfaces) {
      const p = rectCenter(s.bounds), profile = s.profile, range = profile.kind === 'flat' ? [profile.y, profile.y] : [Math.min(profile.startY, profile.endY), Math.max(profile.startY, profile.endY)];
      const area = (s.bounds.maxX - s.bounds.minX) * (s.bounds.maxZ - s.bounds.minZ);
      if (s.locomotion === 'crouch') { crouchSurfaces++; crouchArea += area; } else { ordinarySurfaces++; ordinaryArea += area; }
      if (s.access === 'open' && s.locomotion !== 'crouch' && s.ceilingY - range[1]! < 2.498) ordinaryLowSurfaces++;
      if (s.access === 'open' && !s.reachable) {
        const kind = s.id.includes('/residual-') ? 'residual' : s.id.includes('/crawl/') ? 'legacy-crawl' : s.role;
        unreachableKinds[kind] = (unreachableKinds[kind] ?? 0) + 1;
        if (s.role !== 'floor' && s.locomotion !== 'crouch') unreachableVertical.push({ seed, id: s.id, role: s.role, room: s.roomId });
      }
      const tags = [s.role === 'bridge' ? 'bridge' : s.role === 'balcony' ? 'balcony' : undefined,
        s.id.includes('/return') ? 'U' : s.id.includes('/ascending') ? 'L' : undefined,
        profile.kind === 'linear' && s.layer.endsWith('ground') && profile.startY !== 0 && profile.endY !== 0 ? 'nonzero-transition' : undefined,
        profile.kind === 'linear' && world.rooms.some(r => r.kind === 'corridor' && pointInRect(p.x, p.z, r.bounds)) ? 'corridor-ramp' : undefined,
        profile.kind === 'flat' && profile.y < -.3 && s.role === 'floor' ? 'sunken-district' : undefined,
        s.id.includes('/underpass') && profile.kind === 'flat' ? 'underpass' : undefined].filter((x): x is string => !!x);
      for (const family of tags) {
        produced.add(family);
        if (!examples.some(x => x.family === family)) examples.push({ family, seed, chunk: { x: -1, z: 1, story: 0 }, surfaceId: s.id,
          profile, bounds: s.bounds, localCenter: p, worldCenter: { x: p.x - 112, z: p.z + 112 }, heightRange: range, clearance: s.ceilingY - range[1]! });
      }
    }
    for (const family of produced) families[family] = (families[family] ?? 0) + 1;
  }
  return { seeds: 128, ordinaryChunks: 128 - monumentChunks, monumentChunks, chunk: { x: -1, z: 1, story: 0 }, familyWorldCounts: families, ordinarySurfaces, crouchSurfaces, crouchAreaFraction: crouchArea / (ordinaryArea + crouchArea), ordinaryLowSurfaces, unreachableKinds, unreachableVertical, topologyErrors: errors, landmarks: examples };
};
const result = process.argv.includes('--diversity') ? diversity() : { node: process.version, seeds,
  limitations: 'Headless architecture without prop meshes, graffiti, textures or GPU. Physics includes the generated colliders. Material batches are not measured draw calls. JS heap excludes WASM/GPU memory.',
  reproductionGeometry: await reproduction(), finite: await measure(false), infiniteCold: await measure(true), infiniteWarm: await measure(true, true) };
if ('topologyErrors' in result && (result.topologyErrors.length || result.ordinaryLowSurfaces || result.unreachableVertical.length || ['bridge', 'balcony', 'underpass', 'L', 'U', 'nonzero-transition', 'corridor-ramp', 'sunken-district'].some(f => !result.familyWorldCounts[f]))) process.exitCode = 1;
console.log(JSON.stringify(result, null, 2));
