import { writeFileSync } from 'node:fs';
import { generateInfiniteChunk, clearInfiniteWorldCaches } from '../src/world/InfiniteWorld';
import { validateWorldPlan } from '../src/world/generateWorld';
import { regionalStyle, regionalAtrium } from '../src/world/RegionalPlan';
import { prepareSpatialArchitecture, mountArchitectureBatch } from '../src/render/SpatialArchitectureBuffers';
import { auditAxisPlaneTriangles } from '../tests/support/geometry-audit';
import { pointInRect, rectArea, rectCenter, type WorldPlan } from '../src/world/types';
import { findSurface, surfaceY } from '../src/world/WalkableTopology';

const n = Number(process.env.LIMINAL_SAMPLE ?? 320), out = process.argv[2];
if (!Number.isInteger(n) || n < 1 || n > 2048) throw new Error('LIMINAL_SAMPLE must be an integer from 1 to 2048.');
const errors: unknown[] = [], examples: Record<string, unknown> = {}, records: unknown[] = [];
const add = (counts: Record<string, number>, name: string, amount = 1) => counts[name] = (counts[name] ?? 0) + amount;
const geometryAudit = (w: WorldPlan) => {
  const batch = prepareSpatialArchitecture(w), geometry = batch.map(b => ({ name: b.name, geometry: mountArchitectureBatch(b) }));
  const audit = auditAxisPlaneTriangles(geometry);
  if (audit.errors.length) errors.push({ seed: w.seed, owner: w.spatial!.owner, reason: 'coplanar faces', issues: audit.errors });
  for (const b of batch) {
    for (const attr of [b.position, b.uv, b.color]) if (attr.some(v => !Number.isFinite(v))) errors.push({ seed: w.seed, reason: 'nonfinite buffer', batch: b.name });
    for (let j = 0; j < b.normal.length; j += 3) if (Math.abs(Math.hypot(b.normal[j]!, b.normal[j + 1]!, b.normal[j + 2]!) - 1) > .001) {
      errors.push({ seed: w.seed, reason: 'invalid normal', batch: b.name }); break;
    }
  }
  geometry.forEach(g => g.geometry.dispose()); return { triangles: audit.triangleCount, batches: batch.length };
};
for (const [corpus, count] of [['ORDINARY', n], ['HOLDOUT', Math.ceil(n / 2)]] as const) {
  const families: Record<string, number> = {}, modes: Record<string, number> = {}, styles: Record<string, number> = {};
  const compositions: Record<string, number> = {}, stairs: Record<string, number> = {}, depths: Record<string, number> = {};
  const widths: number[] = [], heights: number[] = [], levels: number[] = [];
  const stackStairs: Record<string, number> = {}, stackLevels: number[] = [], seenStacks = new Set<string>();
  let spatial = 0, quiet = 0, inspected = 0, triangles = 0, maxBatches = 0, destinations = 0, stackOwners = 0, bspArea = 0, walkableArea = 0;
  for (let i = 0; i < count; i++) {
    const seed = `LIMINAL-${corpus}-${i}`, address = { x: i % 3 - 1, z: Math.floor(i / 3) % 3 - 1, story: i % 5 - 2 };
    clearInfiniteWorldCaches(); const w = generateInfiniteChunk(seed, address);
    if (!w.spatial) continue; spatial++;
    const issues = validateWorldPlan(w); if (issues.length) errors.push({ seed, address, issues });
    const features = w.features.filter(f => f.kind === 'liminal-architecture' || f.kind === 'liminal-pit');
    if (!features.length) quiet++;
    for (const s of w.topology!.surfaces) { const area = rectArea(s.bounds); walkableArea += area; if (s.roomId?.includes('/bsp/')) bspArea += area; }
    for (const c of w.spatial.cells) { add(modes, c.mode); add(styles, regionalStyle(seed, c.regionId).family); }
    for (const f of features) {
      add(families, f.family);
      const key = f.kind === 'liminal-pit' ? f.family : f.family === 'partial-gallery' ? `gallery-${f.composition}` : f.composition;
      const floor = w.rooms.find(r => r.id === f.roomId)?.floorY ?? 0, center = rectCenter(f.bounds);
      const wall = f.kind === 'liminal-architecture' ? f.walls.find(w => w.openings.length) : undefined, opening = wall?.openings[0];
      const probes = f.kind === 'liminal-architecture' && f.family === 'partial-gallery' ? [{ x: f.bounds.minX + 14, z: f.bounds.minZ + .8 }]
        : wall && opening ? [wall.axis === 'x' ? { x: (opening.min + opening.max) / 2, z: wall.bounds.minZ - .8 }
          : { z: (opening.min + opening.max) / 2, x: wall.bounds.minX - .8 }]
        : [{ x: f.bounds.minX + .8, z: center.z }, { x: f.bounds.maxX - .8, z: center.z }, { x: center.x, z: f.bounds.minZ + .8 }, { x: center.x, z: f.bounds.maxZ - .8 }];
      const probe = probes.find(p => findSurface(w, { ...p, referenceY: floor, maxAbove: .05, maxBelow: .05 })) ?? center;
      if (!examples[key]) examples[key] = { seed, address, id: f.id,
        position: { x: probe.x + address.x * 112, z: probe.z + address.z * 112, y: floor + address.story * 5.4 + .865 },
        bounds: f.bounds, ...(f.kind === 'liminal-pit' ? { depth: f.depth, holes: f.holes } : { sides: f.visibleSides, levels: f.floorLevels, stairs: f.stairCount }) };
      if (f.kind === 'liminal-pit') add(depths, String(f.depth));
      else {
        add(compositions, f.composition); if (f.family === 'partial-gallery') add(stairs, String(f.stairCount));
        levels.push(...f.floorLevels.slice(1).map(h => h - f.floorLevels[0]!));
        for (const wall of f.walls) for (const o of wall.openings) { widths.push(o.max - o.min); heights.push(o.height); }
        if (f.family === 'partial-gallery') {
          const m = /cell\/(-?\d+)\/(-?\d+)\//.exec(f.id)!, a = regionalAtrium(seed, +m[1]!, +m[2]!, address.story)!, stackKey = `${seed}/${a.anchorX}/${a.anchorZ}/${a.owner}`;
          if (!seenStacks.has(stackKey)) {
            seenStacks.add(stackKey);
            for (let story = a.lower; story <= a.owner; story++) {
              const slice = generateInfiniteChunk(seed, { ...address, story }), feature = slice.features.find(p => p.kind === 'liminal-architecture' && p.family === 'partial-gallery' && p.bounds.minX === f.bounds.minX && p.bounds.minZ === f.bounds.minZ);
              if (feature?.kind !== 'liminal-architecture') { errors.push({ seed, story, reason: 'missing vertical composition' }); continue; }
              stackOwners++; add(stackStairs, String(feature.stairCount)); stackLevels.push(...feature.floorLevels.slice(1).map(h => h - feature.floorLevels[0]!));
              if (feature.stairCount && !examples['fractional-stair']) examples['fractional-stair'] = { seed, address: { ...address, story }, id: feature.id, levels: feature.floorLevels,
                positions: slice.topology!.surfaces.filter(s => s.id.startsWith(feature.id.replace(/\/liminal$/, '/fractional-stair-'))).filter((_, i, all) => i === 0 || i === all.length - 1)
                  .map(s => { const p = rectCenter(s.bounds); return { x: p.x + address.x * 112, z: p.z + address.z * 112, y: surfaceY(s, p.x, p.z) + story * 5.4 + .865 }; }) };
              const issues = validateWorldPlan(slice); if (issues.length) errors.push({ seed, story, reason: 'vertical slice', issues });
              geometryAudit(slice);
              if (story === a.lower && (examples[key] as { id: string }).id === f.id) {
                (examples[key] as Record<string, unknown>).lowerPosition = { x: center.x + address.x * 112, z: center.z + address.z * 112, y: floor + story * 5.4 + .865 };
                (examples[key] as Record<string, unknown>).lowerOwner = { ...address, story };
              }
            }
          }
        }
      }
    }
    if (features.length) {
      const audit = geometryAudit(w); inspected++; triangles += audit.triangles; maxBatches = Math.max(maxBatches, audit.batches);
      const targets = new Map<string, WorldPlan>();
      for (const c of w.topology!.connections.filter(c => c.toOwner && (c.id.includes('/liminal') || c.id.includes('/gallery-drop-')))) {
        const owner = c.toOwner!, key = JSON.stringify(owner);
        let other = targets.get(key); if (!other) { other = generateInfiniteChunk(seed, owner); targets.set(key, other); }
        const target = other.topology!.surfaces.find(s => s.id === c.to), p = c.arrival!;
        const local = { x: p.x - (owner.x - address.x) * 112, z: p.z - (owner.z - address.z) * 112,
          referenceY: p.y - (owner.story - address.story) * 5.4, maxAbove: .05, maxBelow: .05 };
        if (c.targetKind === 'portal' ? !other.spatial?.interfaces.some(p => p.id === c.to) || !findSurface(other, local)
          : !target || !pointInRect(local.x, local.z, target.bounds) || !findSurface(other, local))
          errors.push({ seed, address, reason: 'invalid actual destination', connection: c, target: target?.bounds });
        destinations++;
      }
    }
    if (i % 16 === 15 && out) writeFileSync(`${out}.progress`, `${corpus} ${i + 1}/${count}\n`);
  }
  const range = (a: number[]) => a.length ? { min: Math.min(...a), max: Math.max(...a) } : null;
  records.push({ corpus, requested: count, spatial, quietOwners: quiet, modes, styles, families, compositions, stairs, depths, bspArea, walkableArea,
    openingWidths: range(widths), openingHeights: range(heights), fractionalElevations: range(levels), geometryOwnersInspected: inspected,
    trianglesAudited: triangles, maxMaterialBatches: maxBatches, actualDestinations: destinations, completeGalleryStacks: seenStacks.size, stackOwners, stackStairs, stackFractionalElevations: range(stackLevels) });
}
const report = { records, examples, errors, limits: 'CPU plans, render buffers and actual destination surfaces. Rapier traversal is covered by tests. No observed WebGL FPS or screenshots.' };
if (out) writeFileSync(out, JSON.stringify(report, null, 2)); else console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
