// Run after scripts/test-character.mjs has built its headless entry points.
// CPU timings only: the real FBX and Rapier run without a WebGL renderer.
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import { createLab, stepLab, THREE } from '../tests/character/support/headless-character.mjs';
import { generateInfiniteChunk, getChunkWorldOffset } from '../.character-test-dist/regional-world.js';

const seed = 'REGIONAL-AUDIT-2';
const plans = [0, -1, -2].map(story => generateInfiniteChunk(seed, { x: 0, z: 0, story }));
const cell = plans[0].spatial.cells.find(c => c.mode === 'gallery' && c.atriumPerimeter === 'gallery' && c.atriumLower === -2);
if (!cell) throw new Error('The declared regional fall fixture changed.');
const start = { x: (cell.bounds.minX + cell.bounds.maxX) / 2, y: cell.floorY + .865, z: (cell.bounds.minZ + cell.bounds.maxZ) / 2 - 5 };
const lowerY = cell.floorY - 10.8;
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { n: values.length, median: sorted[Math.floor(sorted.length * .5)] ?? 0,
    p95: sorted[Math.floor(sorted.length * .95)] ?? 0, p99: sorted[Math.floor(sorted.length * .99)] ?? 0,
    max: sorted.at(-1) ?? 0, total: values.reduce((a, b) => a + b, 0) };
};
const runs = [];
// Warm the WASM module, loaders and JIT before recording comparable runs.
const warm = await createLab(); warm.setInteractionPartner(null); warm.startRagdoll({ fatal: false });
for (let i = 0; i < 180; i++) stepLab(warm);
warm.dispose();
for (const fps of [30, 60, 120]) {
  const lab = await createLab(); lab.setInteractionPartner(null);
  const physics = lab.physics, world = physics.world;
  const mounts = [];
  physics.batchChunkChanges(() => {
    physics.removeChunk('origin');
    for (const [index, plan] of plans.entries()) {
      const t = performance.now();
      physics.addChunk(`regional-${index}`, plan.colliders, getChunkWorldOffset(plan.spatial.owner));
      mounts.push(performance.now() - t);
    }
  });
  lab.player.teleport(start);
  lab.avatarAnchor.position.set(start.x, start.y - .865, start.z);
  lab.avatarAnchor.updateMatrixWorld(true);
  lab.player.controls.isLocked = true;
  lab.viewMode = 'first-person'; lab.applyViewMode(true);
  let current;
  const wrap = (object, name, bucket) => {
    const original = object[name].bind(object);
    object[name] = (...args) => {
      const t = performance.now();
      try { return original(...args); }
      finally { if (current) { current[bucket] = (current[bucket] ?? 0) + performance.now() - t; current[`${bucket}Calls`] = (current[`${bucket}Calls`] ?? 0) + 1; } }
    };
  };
  wrap(world, 'step', 'physics');
  for (const name of ['castRay', 'castRayAndGetNormal', 'castShape', 'intersectionsWithShape', 'intersectionWithShape']) if (typeof world[name] === 'function') wrap(world, name, 'queries');
  wrap(lab, 'resolveRagdollImpactSurface', 'impactSearch');
  wrap(lab, 'refreshRecoveryAvailability', 'recoverySearch');
  current = {};
  const memoryBefore = getHeapStatistics().used_heap_size, t = performance.now();
  lab.startRagdoll({ fatal: false, addedVelocity: new THREE.Vector3(0, -1, 0) });
  const activation = { cpu: performance.now() - t, ...current };
  const frames = [];
  let reachedLowerAt = Infinity, touched = false, maxAwake = 0, maxContacts = 0;
  for (let i = 0; i < fps * 6; i++) {
    const pelvis = lab.ragdoll?.getPelvisPosition(new THREE.Vector3());
    if (pelvis && pelvis.y < lowerY + 1.5 && reachedLowerAt === Infinity) reachedLowerAt = i / fps;
    current = { phase: i / fps < reachedLowerAt ? 'fall' : i / fps < reachedLowerAt + .7 ? 'impact' : 'rest', physics: 0, physicsCalls: 0, queries: 0, queriesCalls: 0, impactSearch: 0, impactSearchCalls: 0, recoverySearch: 0, recoverySearchCalls: 0 };
    const began = performance.now(); stepLab(lab, 1 / fps); current.cpu = performance.now() - began;
    frames.push(current); current = undefined;
    if (i % Math.max(1, fps / 10) === 0 && lab.ragdoll) {
      let awake = 0, contacts = 0;
      for (const part of lab.ragdoll.bodies.values()) {
        if (!part.body.isSleeping()) awake++;
        for (const collider of part.colliders) world.contactPairsWith(collider, other => {
          if (!physics.isEnvironmentCollider(other)) return;
          world.contactPair(collider, other, manifold => { contacts += manifold.numSolverContacts(); });
        });
      }
      maxAwake = Math.max(maxAwake, awake); maxContacts = Math.max(maxContacts, contacts); touched ||= contacts > 0;
    }
  }
  const phases = Object.fromEntries(['fall', 'impact', 'rest'].map(phase => {
    const f = frames.filter(f => f.phase === phase);
    return [phase, Object.fromEntries(['cpu', 'physics', 'physicsCalls', 'queries', 'queriesCalls', 'impactSearch', 'impactSearchCalls', 'recoverySearch', 'recoverySearchCalls'].map(k => [k, stats(f.map(f => f[k] ?? 0))]))];
  }));
  runs.push({ fps, activation, mounts, lowerY, reachedLowerAt, touched, maxAwake, maxContacts,
    finalPelvis: lab.ragdoll?.getPelvisPosition(new THREE.Vector3()).toArray(),
    heapDeltaBytes: getHeapStatistics().used_heap_size - memoryBefore, phases, frames });
  lab.dispose();
}
const output = process.argv[2] ?? '.fall-audit/regional-profile.json';
writeFileSync(output, JSON.stringify({ schema: 1, seed, start, owners: [0, -1, -2], seconds: 6, renderer: 'none', node: process.version, runs }, null, 2));
console.log(JSON.stringify({ output, runs: runs.map(({ frames, phases, ...r }) => ({ ...r, phases })) }));
