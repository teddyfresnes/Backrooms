import { appendOpeningWall, type ArchitecturalOpening, type LiminalArchitectureFeature, type OpeningWall } from './ArchitecturalOpenings';
import { SeededRandom } from './SeededRandom';
import { findSurface, overlapRect, type WalkableSurface } from './WalkableTopology';
import { rectCenter, rectDepth, rectWidth, type Rect, type WorldPlan } from './types';

export type PassagePattern = 'single' | 'rhythm' | 'right-cluster' | 'two-clusters' | 'mixed' | 'high-windows' | 'rect-rhythm' | 'wide-and-small' | 'mixed-levels';
export const passageRow = (rng: SeededRandom, min: number, max: number, floor: number, roof: number,
  pattern: PassagePattern, access: ArchitecturalOpening['access'] = 'walk'): ArchitecturalOpening[] => {
  const span = max - min, highOnly = pattern === 'high-windows';
  const count = pattern === 'single' ? 1 : pattern === 'wide-and-small' ? span >= 16 ? 3 : 2 : Math.max(2, Math.min(6, Math.floor(span / 3.6), rng.int(2, 6)));
  const pitch = Math.min(span / (count + 1), rng.float(2.8, 4.5));
  const start = pattern === 'right-cluster' ? max - count * pitch - .7 : min + (span - (count - 1) * pitch) / 2;
  const wide = Math.min(span * .38, rng.fork('wide-bay').float(4, 6)), small = Math.min(2.3, (span - wide - 2) / (count - 1));
  const total = wide + (count - 1) * (small + .9), wideStart = min + (span - total) / 2;
  return Array.from({ length: count }, (_, i): ArchitecturalOpening => {
    const local = rng.fork(`opening-${i}`), raised = highOnly || pattern === 'mixed-levels' && i % 2 === 1;
    const shape = pattern === 'mixed' && i % 2 === 0 || raised || pattern === 'rect-rhythm' ? 'rect' : 'arch';
    const first = Math.ceil(count / 2), group = i < first ? 0 : 1, n = group ? count - first : first, localIndex = group ? i - first : i;
    const groupPitch = span * .28 / Math.max(1, n - 1);
    const center = pattern === 'wide-and-small' ? wideStart + (i === 0 ? wide / 2 : wide + .9 + (i - 1) * (small + .9) + small / 2)
      : pattern === 'two-clusters' ? min + span * (group ? .72 : .28) + (localIndex - (n - 1) / 2) * groupPitch
      : pattern === 'single' ? (min + max) / 2 : start + i * pitch;
    const width = pattern === 'wide-and-small' ? i === 0 ? wide : small : Math.min(pattern === 'single' ? local.float(3.2, 6) : local.float(1.8, 2.8), pattern === 'single' ? span - .8 : pattern === 'two-clusters' ? groupPitch - .65 : pitch - .65, 2 * Math.min(center - min, max - center) - .4);
    const bottom = raised ? floor + Math.min(1.4, roof - floor - 1.2) : floor;
    const height = raised ? Math.min(1.1, roof - bottom - .12) : Math.min(local.float(2.55, 3.4), roof - floor - .12);
    return { min: center - width / 2, max: center + width / 2, bottom, height, shape,
      rise: shape === 'arch' ? Math.min(local.float(.35, .9), height - 2.15) : 0, segments: local.int(6, 10), access: raised ? 'view' : access };
  }).filter(o => o.max - o.min >= 1.6 && o.height >= 1);
};

/** Independent district vocabulary and a two-per-owner budget preserve quiet ordinary stretches. */
export const installOrdinaryArchitecture = (w: WorldPlan, avoid: readonly Rect[]): void => {
  const candidates: { surface: WalkableSurface; id: string; rng: SeededRandom; rank: number }[] = [];
  for (const cell of w.spatial!.cells.filter(c => c.mode === 'rooms')) {
    const district = new SeededRandom(`${w.seed}:liminal-vocabulary:v1:${cell.regionId}`), rng = new SeededRandom(`${w.seed}:liminal-room:v1:${cell.id}`);
    if (!rng.fork('presence').chance(district.chance(.22) ? .5 : .035)) continue;
    if (avoid.some(b => overlapRect(b, cell.bounds)) || w.spatial!.transitions?.some(t => overlapRect(t.bounds, cell.bounds))) continue;
    const floors = w.topology!.surfaces.filter(s => s.role === 'floor' && s.profile.kind === 'flat'
      && s.bounds.minX >= cell.bounds.minX && s.bounds.maxX <= cell.bounds.maxX && s.bounds.minZ >= cell.bounds.minZ && s.bounds.maxZ <= cell.bounds.maxZ
      && Math.max(rectWidth(s.bounds), rectDepth(s.bounds)) >= 9 && Math.min(rectWidth(s.bounds), rectDepth(s.bounds)) >= 6.4)
      .sort((a, b) => rectWidth(b.bounds) * rectDepth(b.bounds) - rectWidth(a.bounds) * rectDepth(a.bounds));
    if (floors[0]) candidates.push({ surface: floors[0], rng, id: `${cell.id}/liminal-wall`, rank: rng.fork('budget').float(0, 1) });
  }
  for (const { surface: s, id, rng } of candidates.sort((a, b) => a.rank - b.rank).slice(0, 2)) {
    const b = s.bounds, h = s.profile.kind === 'flat' ? s.profile.y : 0, alongX = rectWidth(b) >= rectDepth(b), axis = alongX ? 'x' : 'z';
    const pattern = rng.fork('composition').pick(['single', 'rhythm', 'right-cluster', 'two-clusters', 'mixed', 'high-windows', 'rect-rhythm', 'wide-and-small', 'mixed-levels'] as const);
    const crossMin = alongX ? b.minZ : b.minX, crossMax = alongX ? b.maxZ : b.maxX;
    const fixed = crossMin + (crossMax - crossMin) * rng.fork('gallery-depth').float(.35, .65), thick = rng.fork('thickness').float(.65, 1.15);
    const min = alongX ? b.minX : b.minZ, max = (alongX ? b.maxX : b.maxZ) - (pattern === 'high-windows' ? 2.2 : 0);
    const bounds = alongX ? { minX: min, maxX: max, minZ: fixed - thick / 2, maxZ: fixed + thick / 2 }
      : { minZ: min, maxZ: max, minX: fixed - thick / 2, maxX: fixed + thick / 2 };
    if (w.features.some(f => f.kind !== 'impossible-vista' && overlapRect(f.bounds, bounds, .8))) continue;
    const wall: OpeningWall = { id: `${id}/wall`, bounds, axis, bottom: h - .16, top: s.ceilingY,
      openings: passageRow(rng.fork('profile'), min + .4, max - .4, h, s.ceilingY, pattern) };
    if (!wall.openings.length) continue;
    appendOpeningWall(w, wall);
    const feature: LiminalArchitectureFeature = { kind: 'liminal-architecture', id, roomId: s.roomId!, bounds,
      family: ['high-windows', 'mixed', 'rect-rhythm', 'mixed-levels', 'wide-and-small'].includes(pattern) ? 'grouped-passages' : 'arcade', composition: pattern, walls: [wall], floorLevels: [h], visibleSides: [], stairCount: 0 };
    w.features.push(feature);
    const p = rectCenter(bounds), inspect = { x: p.x + (alongX ? 0 : -2), z: p.z + (alongX ? -2 : 0), y: h + .865 };
    w.spatial!.landmarks.push({ kind: pattern === 'high-windows' ? 'ouvertures-hautes' : `arches-${pattern}`, position: inspect });
  }
};

/** Resolve after all physical cuts. A view never enters repair as a walk route. */
export const connectArchitecturalOpenings = (w: WorldPlan): void => {
  for (const feature of w.features) if (feature.kind === 'liminal-architecture') for (const wall of feature.walls) for (const [i, o] of wall.openings.entries()) {
    const alongX = wall.axis === 'x', crossMin = alongX ? wall.bounds.minZ : wall.bounds.minX, crossMax = alongX ? wall.bounds.maxZ : wall.bounds.maxX;
    const at = (o.min + o.max) / 2, floor = feature.floorLevels[0]!;
    const a = { x: alongX ? at : crossMin - .2, z: alongX ? crossMin - .2 : at }, b = { x: alongX ? at : crossMax + .2, z: alongX ? crossMax + .2 : at };
    const from = findSurface(w, { ...a, referenceY: floor, maxAbove: .05, maxBelow: .05 }), to = findSurface(w, { ...b, referenceY: floor, maxAbove: .05, maxBelow: .05 });
    if (o.destination) {
      const source = from ?? to; if (!source) continue;
      w.topology!.connections.push({ id: `${wall.id}/opening-${i}`, from: source.id, to: o.destination.surfaceId, at: from ? a : b,
        arrival: o.destination.position, width: o.max - o.min, kind: o.access === 'view' ? 'view' : 'drop', direction: 'forward', access: 'open', toOwner: o.destination.owner });
    } else if (from && to && (o.access === 'view' || o.access === 'drop' || o.access === 'jump')) w.topology!.connections.push({ id: `${wall.id}/opening-${i}`, from: from.id, to: to.id, at: a, arrival: { ...b, y: floor },
      width: o.max - o.min, kind: o.access, direction: o.access === 'view' || o.access === 'drop' ? 'forward' : 'both', access: 'open' });
    // Walk/crouch links already cross the actual adjoining threshold pieces in
    // connectSpatialSurfaces; a remote shortcut would skip that shared boundary.
  }
};
