import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Optional previous source checkout, measured with the same geometric harness.
const baseline = process.argv[2] ? resolve(process.argv[2]) : undefined;
mkdirSync('.vertical-audit', { recursive: true });
const output = resolve('.vertical-audit/wall-finishes.mjs');
const file = (root, path) => JSON.stringify(resolve(root, path));
await build({ stdin: { resolveDir: resolve('.'), loader: 'ts', contents: `
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { generateInfiniteChunk, clearInfiniteWorldCaches } from ${file('.', 'src/world/InfiniteWorld.ts')};
import { cleanSpatialWallJunctions } from ${file('.', 'src/world/SpatialWallJunctions.ts')};
import { findSurface, surfaceY } from ${file('.', 'src/world/WalkableTopology.ts')};
import { pointInRect } from ${file('.', 'src/world/types.ts')};
import { prepareSpatialArchitecture, mountArchitectureBatch } from ${file('.', 'src/render/SpatialArchitectureBuffers.ts')};
import { auditAxisPlaneTriangles } from ${file('.', 'tests/support/geometry-audit.ts')};
import { auditFinishCoverage } from ${file('.', 'tests/support/finish-audit.ts')};
${baseline ? `import { generateInfiniteChunk as generateBefore, clearInfiniteWorldCaches as clearBefore } from ${file(baseline, 'src/world/InfiniteWorld.ts')};
import { prepareSpatialArchitecture as prepareBefore } from ${file(baseline, 'src/render/SpatialArchitectureBuffers.ts')};` : ''}
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const records = [], errors = [];
for (let i = 0; i < 24; i++) {
  const seed = 'WALL-FINISH-HOLDOUT-' + i, address = { x: i % 3 - 1, z: Math.floor(i / 3) % 3 - 1, story: i % 4 - 2 };
  clearInfiniteWorldCaches();
  const w = generateInfiniteChunk(seed, address);
  const before = ${baseline ? '(clearBefore(), generateBefore(seed, address))' : 'undefined'};
  const counts = p => Object.fromEntries([...new Set(p.features.map(f => f.kind))].sort().map(kind => [kind, p.features.filter(f => f.kind === kind).length]));
  const roomShape = p => p.rooms.map(r => [r.id, r.bounds, r.kind, r.floorY, r.ceilingHeight]);
  const row = { seed, address, spatial: !!w.spatial, walls: w.walls.length, rooms: w.rooms.length,
    bareRooms: w.rooms.filter(r => r.baseboards === false).length, features: counts(w),
    sourceFeaturesUnchanged: before ? hash(w.features) === hash(before.features) : undefined,
    roomShapesUnchanged: before ? hash(roomShape(w)) === hash(roomShape(before)) : undefined,
    lightingUnchanged: before ? hash([w.lights, w.unlitZones, w.surfaceStyle]) === hash([before.lights, before.unlitZones, before.surfaceStyle]) : undefined,
    openingsUnchanged: before ? hash([w.floorOpenings, w.ceilingOpenings]) === hash([before.floorOpenings, before.ceilingOpenings]) : undefined };
  if (before && hash(counts(w)) !== hash(counts(before))) errors.push({ seed, reason: 'feature counts changed', before: counts(before), after: counts(w) });
  if (w.spatial) {
    const prepared = prepareSpatialArchitecture(JSON.parse(JSON.stringify(w)));
    const batch = structuredClone(prepared, { transfer: prepared.flatMap(b => [b.position.buffer, b.normal.buffer, b.uv.buffer, b.color.buffer]) });
    const geometries = batch.map(b => ({ name: b.name, material: b.material, geometry: mountArchitectureBatch(b) }));
    const coverage = auditFinishCoverage(w, geometries); row.coverage = { ...coverage, errors: undefined };
    if (coverage.errors.length) errors.push({ seed, reason: 'final contour coverage', details: coverage.errors });
    ${baseline ? `if (before?.spatial) {
      const prior = prepareBefore(before).map(b => ({ material: b.material, geometry: mountArchitectureBatch(b) }));
      const checked = auditFinishCoverage(before, prior); row.beforeCoverage = { ...checked, errors: checked.errors.length };
      prior.forEach(b => b.geometry.dispose());
      const geometry = wall => [wall.x, wall.z, wall.orientation, wall.length, wall.thickness, wall.bottom, wall.height];
      const oldWalls = new Map(before.walls.map(w => [w.id, w]));
      row.wallCorrections = { removed: before.walls.filter(a => !w.walls.some(b => b.id === a.id)).length,
        changed: w.walls.filter(a => oldWalls.has(a.id) && hash(geometry(a)) !== hash(geometry(oldWalls.get(a.id)))).length,
        floorContacts: w.topology.surfaces.filter(s => s.id.includes('/contact-')).length };
    }` : ''}
    const audit = auditAxisPlaneTriangles(geometries); row.triangles = audit.triangleCount; row.batches = batch.length;
    row.baseboards = w.spatial.prisms.filter(p => p.material === 'baseboard').length;
    if (batch.length > 10) errors.push({ seed, reason: 'architecture batch budget exceeded', count: batch.length });
    if (audit.errors.length) errors.push({ seed, reason: 'overlapping axis-plane triangles', details: audit.errors });
    for (const b of batch) for (let n = 0; n < b.normal.length; n += 3) {
      const length = Math.hypot(b.normal[n], b.normal[n + 1], b.normal[n + 2]);
      if (!Number.isFinite(length) || Math.abs(length - 1) > .001) { errors.push({ seed, reason: 'invalid normal', batch: b.name, vertex: n / 3 }); break; }
    }
    const material = new THREE.MeshBasicMaterial(), meshes = geometries.map(b => { const m = new THREE.Mesh(b.geometry, material); m.updateMatrixWorld(); return m; });
    const walls = meshes.filter((_, j) => batch[j].material === 'wall' || batch[j].material === 'plaster');
    const boards = meshes.filter((_, j) => batch[j].material === 'baseboard');
    const roomMap = new Map(w.rooms.map(r => [r.id, r])); row.finishProbes = 0;
    const stride = Math.max(1, Math.floor(w.walls.length / 16));
    for (let j = i % stride; j < w.walls.length; j += stride) for (const side of [-1, 1]) {
      const wall = w.walls[j], alongX = wall.orientation === 'x';
      const fixed = (alongX ? wall.z : wall.x) + side * wall.thickness / 2;
      const x = alongX ? wall.x : fixed + side * .24, z = alongX ? fixed + side * .24 : wall.z;
      const contact = { x: alongX ? x : fixed + side * .015, z: alongX ? fixed + side * .015 : z };
      const query = { ...contact, referenceY: wall.bottom, maxAbove: Math.max(.05, wall.height - .3), maxBelow: .05 };
      const s = findSurface(w, query); if (!s) continue;
      const y = surfaceY(s, contact.x, contact.z), room = roomMap.get(s.roomId), datum = room?.floorY ?? y;
      if (room?.baseboards === false || (w.baseboardlessZones ?? []).some(b => (b.floorY === undefined || Math.abs(b.floorY - datum) < .05) && pointInRect(contact.x, contact.z, b))) continue;
      // The contour belongs to the union of solids. A face inside a
      // perpendicular guard/wall must never receive a decorative band.
      if (w.walls.some(other => other !== wall && other.bottom < y + .06 && other.bottom + other.height > y + .06
        && Math.abs(contact.x - other.x) < (other.orientation === 'x' ? other.length : other.thickness) / 2 - 1e-6
        && Math.abs(contact.z - other.z) < (other.orientation === 'z' ? other.length : other.thickness) / 2 - 1e-6)) continue;
      const ray = new THREE.Raycaster(new THREE.Vector3(x, y + .06, z), new THREE.Vector3(alongX ? 0 : -side, 0, alongX ? -side : 0), 0, .26);
      const hit = ray.intersectObjects(walls)[0];
      if (!hit || Math.abs((alongX ? hit.point.z : hit.point.x) - fixed) > .0001) continue;
      row.finishProbes++;
      const trim = ray.intersectObjects(boards).find(h => h.distance >= hit.distance - .04 && h.distance <= hit.distance + .001);
      // A horizontal probe can start inside the perpendicular trim at a
      // concave corner. Its actual top still has to cover the contact band.
      const down = new THREE.Raycaster(new THREE.Vector3(contact.x, y + .25, contact.z), new THREE.Vector3(0, -1, 0), .1, .2);
      if (!trim && !down.intersectObjects(boards).length) errors.push({ seed, reason: 'missing finish at exposed supported wall', wall: wall.id, side, point: contact, y });
    }
    material.dispose(); geometries.forEach(b => b.geometry.dispose());
    for (const wall of w.walls) {
      const prism = w.spatial.prisms.find(p => p.id === wall.id), collider = w.colliders.find(c => c.id === wall.id);
      if (!prism || !collider) { errors.push({ seed, reason: 'missing wall representation', id: wall.id }); continue; }
      if (collider.vertices && prism.vertices.some((v, j) => Math.abs(v - collider.vertices[j] - [collider.center.x, collider.center.y, collider.center.z][j % 3]) > 1e-6))
        errors.push({ seed, reason: 'collider vertex differs', id: wall.id });
    }
    const clone = structuredClone(w), original = hash(clone); cleanSpatialWallJunctions(clone);
    row.cleanupIdempotent = hash(clone) === original;
    if (!row.cleanupIdempotent) errors.push({ seed, reason: 'cleanup is not idempotent' });
  }
  records.push(row);
}
console.log(JSON.stringify({ baseline: ${JSON.stringify(baseline ?? null)}, records, errors,
  limitation: 'CPU geometry and plan audit. No screenshot seed was supplied; the image is represented by synthetic regression fixtures. No WebGL/GPU/FPS validation.' }, null, 2));
if (errors.length) process.exitCode = 1;
` }, outfile: output, bundle: true, platform: 'node', format: 'esm', packages: 'external' });
const child = spawnSync(process.execPath, [output], { stdio: 'inherit' });
process.exitCode = child.status ?? 1;
