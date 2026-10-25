import { writeFileSync } from 'node:fs';
import { generateInfiniteChunk, clearInfiniteWorldCaches } from '../src/world/InfiniteWorld';
import { validateTopology, surfaceY, surfaceUndersideY } from '../src/world/WalkableTopology';
import { createSpatialPrismBatch } from '../src/render/SpatialGeometry';
import { prismExposure } from '../src/render/PrismExposure';
import { rectDepth, rectWidth } from '../src/world/types';
import type { WorldPlan } from '../src/world/types';

const quantiles = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  return { min: s[0], median: s[Math.floor(s.length / 2)], p95: s[Math.ceil(s.length * .95) - 1], max: s.at(-1) };
};
const enclosures: Record<string, number> = {}, headrooms: number[] = [];
const compositions: Record<string, number> = {}, moundAccess: Record<string, number> = {};
const atriumRooms = { withStairs: 0, withoutStairs: 0, stepped: 0, levels: {} as Record<string, number>, footprints: {} as Record<string, number> };
const errors: unknown[] = [], families: Record<string, number> = {}, examples: Record<string, unknown> = {};
const lengths: number[] = [], widths: number[] = [], grades: number[] = [], rises: number[] = [], roomShapes = new Set<string>();
let externalLinks = 0, sourceHoles = 0, ordinary = 0, hall = 0, reliefs = 0, uvTriangles = 0, voidSources = 0;
const seeds = [...Array.from({ length: 64 }, (_, i) => `REGIONAL-AUDIT-${i}`), ...Array.from({ length: 32 }, (_, i) => `TRANSITION-HOLDOUT-${i}`)];
for (const [index, seed] of seeds.entries()) {
  clearInfiniteWorldCaches();
  const owner = index < 64 ? { x: 0, z: 0, story: 0 } : { x: -1, z: -1, story: -1 };
  const plans = new Map<string, WorldPlan>();
  const get = (coord: typeof owner) => { const key = JSON.stringify(coord); let w = plans.get(key); if (!w) { w = generateInfiniteChunk(seed, coord); plans.set(key, w); } return w; };
  const w = get(owner);
  for (const issue of validateTopology(w)) errors.push({ seed, issue });
  for (const room of w.rooms.filter(r => r.id.includes('/bsp/') || r.id.endsWith('/hall'))) {
    const area = rectWidth(room.bounds) * rectDepth(room.bounds);
    if (room.kind === 'open-hall') hall += area; else ordinary += area;
  }
  for (const cell of w.spatial!.cells.filter(c => c.mode === 'gallery')) {
    roomShapes.add(`${rectWidth(cell.bounds)}x${rectDepth(cell.bounds)}x${(owner.story - cell.atriumLower!) * 5.4}`);
    const stairs = w.topology!.surfaces.some(s => s.id.startsWith(cell.id + '/atrium-stairs/'));
    atriumRooms[stairs ? 'withStairs' : 'withoutStairs']++;
    if (cell.atriumPerimeter === 'stepped') atriumRooms.stepped++;
    const levels = String(cell.atriumOwner! - cell.atriumLower! + 1), shape = `${rectWidth(cell.bounds)}x${rectDepth(cell.bounds)}`;
    atriumRooms.levels[levels] = (atriumRooms.levels[levels] ?? 0) + 1;
    atriumRooms.footprints[shape] = (atriumRooms.footprints[shape] ?? 0) + 1;
  }
  for (const t of w.spatial!.transitions!) {
    enclosures[t.enclosure] = (enclosures[t.enclosure] ?? 0) + 1;
    const roof = w.spatial!.ceilings.find(s => s.id === `${t.id}/roof`)!;
    for (const step of w.topology!.surfaces.filter(s => s.id === t.id || s.id.startsWith(`${t.id}/step-`)))
      for (const x of [step.bounds.minX, step.bounds.maxX]) for (const z of [step.bounds.minZ, step.bounds.maxZ]) {
        const height = surfaceUndersideY(roof, x, z) - surfaceY(step, x, z); headrooms.push(height);
        if (height < 2.5 - .0001) errors.push({ seed, issue: 'rendered flight headroom below standing contract', id: t.id, height });
      }
    compositions[t.composition] = (compositions[t.composition] ?? 0) + 1;
    const length = t.axis === 'x' ? rectWidth(t.run) : rectDepth(t.run);
    lengths.push(length); widths.push(t.width); rises.push(Math.abs(t.endY - t.startY)); grades.push(Math.abs(t.endY - t.startY) / length);
    if (w.spatial!.ceilings.filter(c => c.id === `${t.id}/roof`).length !== 1) errors.push({ seed, issue: 'flight roof multiplicity', id: t.id });
  }
  reliefs += w.spatial!.reliefs?.length ?? 0;
  for (const r of w.spatial!.reliefs ?? []) if (r.kind === 'mound') moundAccess[r.access!] = (moundAccess[r.access!] ?? 0) + 1;
  for (const f of w.features) {
    const kind = f.kind === 'squeeze-view' ? `${f.kind}/${f.passageStyle}/${f.breachProfile ?? 'network'}` : f.kind;
    families[kind] = (families[kind] ?? 0) + 1;
    if (f.kind === 'grid-pit' || f.kind === 'squeeze-view') {
      sourceHoles += f.holes?.length ?? 0;
      if (f.holes?.some(h => h.kind === 'void')) voidSources++;
    }
  }
  for (const l of w.spatial!.landmarks) examples[l.kind] ??= { seed, owner, position: l.position, destination: l.destination };
  for (const c of w.topology!.connections.filter(c => c.toOwner)) {
    externalLinks++;
    const other = get(c.toOwner!);
    const surface = other.topology!.surfaces.find(s => s.id === c.to);
    const okay = c.targetKind === 'portal' ? other.spatial!.interfaces.some(p => p.id === c.to) : surface !== undefined;
    if (!okay) errors.push({ seed, issue: 'missing destination', id: c.id, to: c.to });
    if (surface && c.arrival) {
      const x = c.arrival.x - (c.toOwner!.x - owner.x) * 112, z = c.arrival.z - (c.toOwner!.z - owner.z) * 112;
      const y = c.arrival.y - (c.toOwner!.story - owner.story) * 5.4;
      if (x < surface.bounds.minX - .002 || x > surface.bounds.maxX + .002 || z < surface.bounds.minZ - .002 || z > surface.bounds.maxZ + .002 || Math.abs(surfaceY(surface, x, z) - y) > .19)
        errors.push({ seed, issue: 'arrival outside its actual destination', id: c.id, to: c.to });
    }
  }
  const geometry = createSpatialPrismBatch(w.spatial!.prisms, 1, undefined, prismExposure(w.spatial!.prisms)), p = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
  for (let i = 0; i < p.count; i += 3) {
    const ax = p.getX(i + 1) - p.getX(i), ay = p.getY(i + 1) - p.getY(i), az = p.getZ(i + 1) - p.getZ(i);
    const bx = p.getX(i + 2) - p.getX(i), by = p.getY(i + 2) - p.getY(i), bz = p.getZ(i + 2) - p.getZ(i);
    const area3 = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
    const areaUv = (uv.getX(i + 1) - uv.getX(i)) * (uv.getY(i + 2) - uv.getY(i)) - (uv.getY(i + 1) - uv.getY(i)) * (uv.getX(i + 2) - uv.getX(i));
    if (area3 > .00001 && (!Number.isFinite(areaUv) || Math.abs(areaUv) < 1e-10)) errors.push({ seed, issue: 'collapsed UV triangle', triangle: i / 3 });
    uvTriangles++;
  }
  geometry.dispose();
}
const report = { planVersion: 16, enclosures, standingHeadroom: quantiles(headrooms), atriumRooms, compositions, moundAccess, seeds, corpus: { fixed: 64, holdout: 32 }, families, examples, roomShapes: [...roomShapes].sort(),
  transitionLength: quantiles(lengths), transitionWidth: quantiles(widths), transitionGrade: quantiles(grades), transitionRise: quantiles(rises),
  ordinaryBspRoomFootprintShare: ordinary / (ordinary + hall), externalLinks, sourceHoles, voidSources, reliefs, uvTriangles, errors };
writeFileSync(process.argv[2] ?? 'docs/validation/ceiling-integration.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ seeds: seeds.length, externalLinks, sourceHoles, reliefs, uvTriangles, errors: errors.length }));
if (errors.length) process.exitCode = 1;
