import { performance } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { bakeRegionalLightData } from '../src/render/RegionalLighting';
import { WorldView } from '../src/render/WorldBuilder';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import type { MaterialSet } from '../src/render/MaterialLibrary';
import type { WorldPlan } from '../src/world/types';
import { generateWorld, validateWorldPlan } from '../src/world/generateWorld';
import { generateInfiniteChunk, getChunkWorldOffset, getCanonicalEdgeGates, clearInfiniteWorldCaches } from '../src/world/InfiniteWorld';
import { regionalDatum, regionalStyle } from '../src/world/RegionalPlan';
import { surfaceY } from '../src/world/WalkableTopology';
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
  const bakeStart = performance.now(), regionalLightData = world.spatial ? bakeRegionalLightData(world) : undefined;
  const regionalBakeMs = performance.now() - bakeStart;
  const materials = materialsForAudit(), start = performance.now(), view = new WorldView({ ...world, propPlacements: [] }, materials, { regionalLightData }); await view.ready;
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
  return { prepareMs, regionalBakeMs, physicsMountMs, triangles, materialBatches, heap };
};
const measure = async (infinite: boolean, warm = false) => {
  const regionalBakeMs: number[] = [];
  const times: number[] = [], bytes: number[] = [], colliders: number[] = [], cloneMs: number[] = [], prepareMs: number[] = [], physicsMountMs: number[] = [], triangles: number[] = [], materialBatches: number[] = [], heaps: number[] = [];
  (globalThis as { gc?: () => void }).gc?.(); const heapBefore = getHeapStatistics().used_heap_size;
  for (const seed of seeds) {
    if (infinite && !warm) clearInfiniteWorldCaches();
    if (infinite && warm) generateInfiniteChunk(seed, { x: -1, z: 1, story: 0 });
    const start = performance.now(), world = infinite ? generateInfiniteChunk(seed, { x: -1, z: 1, story: 0 }) : generateWorld(seed);
    times.push(performance.now() - start);
    const cloneStart = performance.now(); structuredClone(world); cloneMs.push(performance.now() - cloneStart);
    bytes.push(Buffer.byteLength(JSON.stringify(world))); colliders.push(world.colliders.length);
    const metrics = await architecturalMetrics(world); prepareMs.push(metrics.prepareMs); regionalBakeMs.push(metrics.regionalBakeMs); physicsMountMs.push(metrics.physicsMountMs);
    triangles.push(metrics.triangles); materialBatches.push(metrics.materialBatches); heaps.push(metrics.heap);
  }
  (globalThis as { gc?: () => void }).gc?.();
  return { generationMs: summary(times), cloneMs: summary(cloneMs), architecturalPrepareMs: summary(prepareMs), regionalBakeMs: summary(regionalBakeMs), physicsMountMs: summary(physicsMountMs),
    jsonBytes: summary(bytes), colliders: summary(colliders), triangles: summary(triangles), materialBatches: summary(materialBatches), sampledHeapPeakBytes: Math.max(...heaps), retainedHeapDeltaBytes: getHeapStatistics().used_heap_size - heapBefore };
};
/** Acceptance thresholds are declared before collecting the normal-seed sample. */
const distributionGoals = {
  regionalHeightRangeAtLeast: 12, zeroAreaFractionBelow: .1,
  plateauCellsAtLeast: 20, plateauChunkOwnersAtLeast: 3,
  eachFamilyInAtLeastSeeds: 3, ordinaryClearanceAtLeast: 2.498,
  accidentalIsolation: 0, mismatchedSeams: 0,
};
const diversity = () => {
  const families: Record<string, Set<string>> = {}, kinds: Record<string, number> = {}, modes: Record<string, number> = {}, styles: Record<string, number> = {};
  const examples: any[] = [], errors: any[] = [], heights = new Map<number, number>(), runs = new Map<string, { min: number; max: number; length: number }>();
  const plans = new Map<string, WorldPlan>();
  const get = (seed: string, coord: { x: number; z: number; story: number }) => {
    const key = `${seed}/${coord.x}/${coord.z}/${coord.story}`;
    if (!plans.has(key)) plans.set(key, generateInfiniteChunk(seed, coord));
    return plans.get(key)!;
  };
  let area = 0, zeroArea = 0, low = 0, accidentalIsolation = 0, overlappingCells = 0, oneWay = 0, views = 0, centerlineLength = 0, ordinary = 0, monuments = 0;
  const addFamily = (family: string, seed: string, world: WorldPlan, data: any) => {
    (families[family] ??= new Set()).add(seed);
    if (!examples.some(e => e.family === family)) examples.push({ family, seed, owner: world.spatial!.owner, ...data });
  };
  const scan = (seed: string, coord: { x: number; z: number; story: number }, collectFamilies = false) => {
    const world = get(seed, coord); if (!world.spatial) { monuments++; return; } ordinary++;
    const issues = validateWorldPlan(world); if (issues.length) errors.push({ seed, coord, issues });
    const offset = getChunkWorldOffset(coord), surfaces = new Map(world.topology!.surfaces.map(s => [s.id, s]));
    for (const c of world.spatial.cells) {
      modes[c.mode] = (modes[c.mode] ?? 0) + 1;
      const style = regionalStyle(seed, c.regionId).family; styles[style] = (styles[style] ?? 0) + 1;
      if (c.mode === 'gallery') {
        const lower = get(seed, { ...coord, story: c.atriumOwner! - 2 });
        if (lower.spatial?.cells.some(l => l.mode === 'lower-maze' && l.bounds.minX === c.bounds.minX && l.bounds.minZ === c.bounds.minZ)) overlappingCells++;
      }
    }
    for (const s of surfaces.values()) {
      const p = rectCenter(s.bounds), a = (s.bounds.maxX - s.bounds.minX) * (s.bounds.maxZ - s.bounds.minZ), h = surfaceY(s, p.x, p.z);
      area += a; if (Math.abs(h) < .025) zeroArea += a;
      const bin = Math.floor(h); heights.set(bin, (heights.get(bin) ?? 0) + a);
      for (const x of [s.bounds.minX, s.bounds.maxX]) for (const z of [s.bounds.minZ, s.bounds.maxZ]) {
        const ceiling = s.ceilingProfile ? surfaceY({ ...s, profile: s.ceilingProfile }, x, z) : s.ceilingY;
        if (s.access === 'open' && s.locomotion !== 'crouch' && ceiling - surfaceY(s, x, z) < distributionGoals.ordinaryClearanceAtLeast) low++;
      }
      if (s.reachability === 'isolated' && s.access === 'open') accidentalIsolation++;
      if (s.id.includes('/step-')) {
        const key = `${seed}/${s.id.replace(/\/step-\d+$/, '')}`, range = runs.get(key) ?? { min: h, max: h, length: 0 };
        range.min = Math.min(range.min, h); range.max = Math.max(range.max, h);
        range.length += Math.max(s.bounds.maxX - s.bounds.minX, s.bounds.maxZ - s.bounds.minZ) === s.bounds.maxX - s.bounds.minX
          ? s.bounds.maxZ - s.bounds.minZ : s.bounds.maxX - s.bounds.minX;
        runs.set(key, range);
      }
      if (collectFamilies && s.profile.kind === 'linear') addFamily('nonzero-ramp', seed, world, { position: { x: p.x + offset.x, y: h + offset.y + .865, z: p.z + offset.z }, profile: s.profile });
    }
    for (const c of world.topology!.connections) {
      kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
      if (c.kind === 'drop') oneWay++; if (c.kind === 'view') views++;
      const a = surfaces.get(c.from), b = surfaces.get(c.to);
      if (a && b && c.kind !== 'view') {
        const p = rectCenter(a.bounds), q = rectCenter(b.bounds);
        centerlineLength += Math.hypot(p.x - q.x, p.z - q.z, surfaceY(a, p.x, p.z) - surfaceY(b, q.x, q.z));
      }
      if (c.toOwner && c.targetKind !== 'portal') {
        const target = get(seed, c.toOwner);
        if (!target.topology?.surfaces.some(s => s.id === c.to)) errors.push({ seed, coord, brokenTarget: c.to });
      }
    }
    if (collectFamilies) for (const l of world.spatial.landmarks) addFamily(l.kind, seed, world, {
      position: { x: l.position.x + offset.x, y: l.position.y + offset.y, z: l.position.z + offset.z },
      destination: l.destination && { x: l.destination.x + offset.x, y: l.destination.y + offset.y, z: l.destination.z + offset.z }, destinationOwner: l.owner,
    });
  };
  // Distribution: 128 ordinary global seeds at the same address, without forcing features.
  for (let i = 0; i < 128; i++) scan(`VERTICAL-PROMPT-AUDIT-${i}`, { x: -1, z: 1, story: 0 }, true);
  // Extent and continuity: eight independent 5x5 neighborhoods (560m per side).
  const regions = new Map<string, { seed: string; id: string; y: number; cells: number; chunks: Set<string>; minX: number; maxX: number; minZ: number; maxZ: number }>();
  let seams = 0, nonzeroSeams = 0, seamErrors = 0;
  for (let i = 0; i < 8; i++) {
    const seed = `REGIONAL-AUDIT-${i}`;
    for (let z = -2; z <= 2; z++) for (let x = -2; x <= 2; x++) {
      const coord = { x, z, story: 0 }; scan(seed, coord);
      for (let dz = 0; dz < 4; dz++) for (let dx = 0; dx < 4; dx++) {
        const gx = x * 4 + dx, gz = z * 4 + dz, datum = regionalDatum(seed, gx, gz), key = `${seed}/${datum.id}`;
        if (datum.id === 'monument-interface') continue;
        const r = regions.get(key) ?? { seed, id: datum.id, y: datum.y, cells: 0, chunks: new Set<string>(), minX: gx, maxX: gx, minZ: gz, maxZ: gz };
        r.cells++; r.chunks.add(`${x}:${z}`); r.minX = Math.min(r.minX, gx); r.maxX = Math.max(r.maxX, gx); r.minZ = Math.min(r.minZ, gz); r.maxZ = Math.max(r.maxZ, gz); regions.set(key, r);
      }
      for (const side of ['east', 'south'] as const) {
        if ((side === 'east' ? x : z) === 2) continue;
        const other = { ...coord, x: x + Number(side === 'east'), z: z + Number(side === 'south') };
        const a = getCanonicalEdgeGates(seed, coord, side), b = getCanonicalEdgeGates(seed, other, side === 'east' ? 'west' : 'north');
        seams += a.length; nonzeroSeams += a.filter(g => g.floorY !== 0).length;
        if (JSON.stringify(a) !== JSON.stringify(b)) { seamErrors++; errors.push({ seed, coord, side, mismatch: true }); }
      }
    }
  }
  const regional = [...regions.values()].map(r => ({ ...r, chunks: [...r.chunks], width: (r.maxX - r.minX + 1) * 28, depth: (r.maxZ - r.minZ + 1) * 28, sampledArea: r.cells * 28 * 28 })).sort((a, b) => b.cells - a.cells);
  const ys = regional.map(r => r.y), familyCounts = Object.fromEntries(Object.entries(families).map(([k, v]) => [k, v.size]));
  const required = ['escalier-l', 'escalier-u', 'escalier-bridge', 'ouverture-haute', 'saut-passerelle', 'galerie-l', 'galerie-u', 'galerie-bridge', 'rampe-regionale', 'escalier-regional'];
  const failures: string[] = [];
  if (Math.max(...ys) - Math.min(...ys) < distributionGoals.regionalHeightRangeAtLeast) failures.push('regional-height-range');
  if (zeroArea / area >= distributionGoals.zeroAreaFractionBelow) failures.push('privileged-zero');
  if (!regional.some(r => r.cells >= distributionGoals.plateauCellsAtLeast && r.chunks.length >= distributionGoals.plateauChunkOwnersAtLeast)) failures.push('regional-extent');
  for (const f of required) if ((familyCounts[f] ?? 0) < distributionGoals.eachFamilyInAtLeastSeeds) failures.push(`missing-normal-family:${f}`);
  if (low || accidentalIsolation || seamErrors || errors.length) failures.push('invalid-geometry-or-ownership');
  return { goals: distributionGoals, failures, normalDistributionSeeds: 128, neighborhoodSeeds: 8, neighborhoodChunksPerSeed: 25, sampledOrdinaryPlans: ordinary, sampledMonuments: monuments,
    familyWorldCounts: familyCounts, modes, styles, connectionCounts: kinds, oneWayLinks: oneWay, visibilityOnlyLinks: views, overlappingPlayableCells: overlappingCells,
    walkableArea: area, zeroAreaFraction: zeroArea / area, areaWeightedHeightBins: [...heights].sort((a, b) => a[0] - b[0]).map(([minY, area]) => ({ minY, maxY: minY + 1, area, fraction: area / [...heights.values()].reduce((a, b) => a + b, 0) })),
    regionalDatumRange: [Math.min(...ys), Math.max(...ys)], largestObservedRegions: regional.slice(0, 12),
    stairRuns: runs.size, stairHeightSpans: summary([...runs.values()].map(r => r.max - r.min)), graphCenterlineLength: centerlineLength,
    clearanceViolations: low, accidentalIsolation, checkedSeamPortals: seams, nonzeroSeamFraction: nonzeroSeams / seams, seamErrors, topologyErrors: errors.slice(0, 50),
    generationFallbacks: { ordinaryRegionalPlan: 0, note: 'Constructive ordinary planner has no flattening fallback; monuments and RAW_LOCAL use the explicit legacy path.' }, landmarks: examples };
};
const result = process.argv.includes('--diversity') ? diversity() : { node: process.version, seeds,
  limitations: 'Headless architecture without prop meshes, graffiti, textures or GPU. Physics includes the generated colliders. Material batches are not measured draw calls. JS heap excludes WASM/GPU memory.',
  reproductionGeometry: await reproduction(), finite: await measure(false), infiniteCold: await measure(true), infiniteWarm: await measure(true, true) };
if ('failures' in result && result.failures.length) process.exitCode = 1;
console.log(JSON.stringify(result, null, 2));
