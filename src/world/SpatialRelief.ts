import { SeededRandom } from './SeededRandom';
import { regionalAtrium, regionalStyle } from './RegionalPlan';
import { cutRects, overlapRect, surfaceRange, type HeightProfile, type WalkableSurface } from './WalkableTopology';
import { rectCenter, rectDepth, rectWidth, type Rect, type WorldPlan } from './types';

export interface SpatialReliefRecord {
  id: string; roomId: string; kind: 'mound' | 'terraces'; bounds: Rect; baseY: number; peakY: number; surfaceIds: string[]; access?: 'single' | 'opposed' | 'terraced';
}
export const applySpatialRelief = (w: WorldPlan, avoid: readonly Rect[]): void => {
  const spatial = w.spatial!, topology = w.topology!;
  spatial.reliefs = [];
  for (const cell of spatial.cells) {
    if (!['rooms', 'lower-maze'].includes(cell.mode)) continue;
    const match = /cell\/(-?\d+)\/(-?\d+)\//.exec(cell.id)!;
    const gx = Number(match[1]), gz = Number(match[2]), atrium = regionalAtrium(w.seed, gx, gz, spatial.owner.story);
    if (atrium?.liminal) continue;
    const rng = new SeededRandom(`${w.seed}:solid-relief:v1:${gx}:${gz}:${spatial.owner.story}`);
    const ordinary = cell.mode === 'rooms';
    if (ordinary ? regionalStyle(w.seed, cell.regionId).family === 'maze' || !rng.chance(.65)
      : !atrium?.openLower || atrium.composition === 'gallery') continue;
    if (spatial.transitions?.some(t => overlapRect(t.bounds, cell.bounds)) || avoid.some(b => overlapRect(b, cell.bounds))) continue;
    const floor = topology.surfaces.filter(s => s.role === 'floor' && s.profile.kind === 'flat' &&
      s.bounds.minX >= cell.bounds.minX && s.bounds.maxX <= cell.bounds.maxX && s.bounds.minZ >= cell.bounds.minZ && s.bounds.maxZ <= cell.bounds.maxZ &&
      rectWidth(s.bounds) >= 15 && rectDepth(s.bounds) >= 15).sort((a, b) => rectWidth(b.bounds) * rectDepth(b.bounds) - rectWidth(a.bounds) * rectDepth(a.bounds))[0];
    if (!floor) continue;
    const b = floor.bounds, p = rectCenter(b), h = surfaceRange(floor)[0], alongX = rectWidth(b) >= rectDepth(b);
    const room = w.rooms.find(r => r.id === floor.roomId) ?? w.rooms.find(r => p.x >= r.bounds.minX && p.x <= r.bounds.maxX && p.z >= r.bounds.minZ && p.z <= r.bounds.maxZ && Math.abs((r.floorY ?? 0) - h) < .01);
    if (!room) continue;
    floor.roomId = room.id;
    const length = (alongX ? rectWidth(b) : rectDepth(b)) - 5;
    const width = Math.min(rng.float(5, 9), (alongX ? rectDepth(b) : rectWidth(b)) - 6);
    const peak = ordinary ? rng.float(.4, 1.2) : Math.min(rng.float(.7, 3.6), length * .12);
    const kind = atrium && !ordinary ? atrium.composition === 'terraces' ? 'terraces' : 'mound' : rng.pick(['mound', 'terraces'] as const);
    const start = (alongX ? p.x : p.z) - length / 2;
    const rect = (from: number, to: number): Rect => alongX
      ? { minX: from, maxX: to, minZ: p.z - width / 2, maxZ: p.z + width / 2 }
      : { minZ: from, maxZ: to, minX: p.x - width / 2, maxX: p.x + width / 2 };
    const footprint = rect(start, start + length);
    const blocked = w.walls.some(wall => wall.bottom < h + peak + .1 && wall.bottom + wall.height > h + .05 && overlapRect(footprint, {
      minX: wall.x - (wall.orientation === 'x' ? wall.length : wall.thickness) / 2, maxX: wall.x + (wall.orientation === 'x' ? wall.length : wall.thickness) / 2,
      minZ: wall.z - (wall.orientation === 'z' ? wall.length : wall.thickness) / 2, maxZ: wall.z + (wall.orientation === 'z' ? wall.length : wall.thickness) / 2 }, .35));
    if (blocked) continue;
    const roof = Math.max(floor.ceilingY, h + peak + 2.74), id = `${cell.id}/relief`, made: WalkableSurface[] = [];
    const add = (name: string, bounds: Rect, profile: HeightProfile) => {
      made.push({ ...floor, id: `${id}/${name}`, bounds, profile, role: profile.kind === 'linear' ? 'ramp' : 'landing', ceilingY: roof,
        ceilingProfile: { kind: 'flat', y: roof }, support: 'solid', supportBottom: h - .16, thickness: .16, edges: 'architecture' });
    };
    const access = kind === 'mound' ? rng.fork('access').chance(.65) ? 'single' : 'opposed' : 'terraced';
    if (kind === 'mound') {
      const run = length * .34, reverse = access === 'single' && rng.fork('entrance-end').chance(.5);
      if (reverse) {
        add('platform', rect(start, start + length - run), { kind: 'flat', y: h + peak });
        add('down', rect(start + length - run, start + length), { kind: 'linear', axis: alongX ? 'x' : 'z', startY: h + peak, endY: h });
      } else {
        add('up', rect(start, start + run), { kind: 'linear', axis: alongX ? 'x' : 'z', startY: h, endY: h + peak });
        add('platform', rect(start + run, start + length - (access === 'opposed' ? run : 0)), { kind: 'flat', y: h + peak });
        if (access === 'opposed') add('down', rect(start + length - run, start + length), { kind: 'linear', axis: alongX ? 'x' : 'z', startY: h + peak, endY: h });
      }
    } else {
      const count = rng.int(3, 5), segment = length / (count * 2);
      for (let i = 0; i < count; i++) {
        add(`ramp-${i}`, rect(start + 2 * i * segment, start + (2 * i + 1) * segment),
          { kind: 'linear', axis: alongX ? 'x' : 'z', startY: h + peak * i / count, endY: h + peak * (i + 1) / count });
        add(`terrace-${i}`, rect(start + (2 * i + 1) * segment, start + (2 * i + 2) * segment), { kind: 'flat', y: h + peak * (i + 1) / count });
      }
    }
    topology.surfaces = topology.surfaces.flatMap(s => s === floor
      ? cutRects([s.bounds], [footprint]).map((bounds, i) => ({ ...s, id: `${s.id}/relief-cut-${i}`, bounds, ceilingY: roof, ceilingProfile: { kind: 'flat' as const, y: roof } })) : [s]);
    topology.surfaces.push(...made);
    if (ordinary) {
      for (const r of w.rooms) if (r.id === floor.roomId && Math.abs((r.floorY ?? 0) - h) < .01) { r.ceilingHeight = roof; r.structuralCeilingY = roof; }
      for (const sf of topology.surfaces) if (sf.roomId === floor.roomId && surfaceRange(sf)[0] >= h - .01 && surfaceRange(sf)[1] <= h + peak + .01) {
        sf.ceilingY = roof; sf.ceilingProfile = { kind: 'flat', y: roof };
      }
      for (const ceiling of spatial.ceilings) if (ceiling.roomId === floor.roomId) {
        ceiling.profile = { kind: 'flat', y: roof + ceiling.thickness }; ceiling.ceilingY = roof; ceiling.ceilingProfile = { kind: 'flat', y: roof };
      }
      for (const column of w.walls.filter(wall => wall.id.startsWith(`${cell.id}/bsp/pillar-`))) {
        column.height = roof - column.bottom;
        const prism = spatial.prisms.find(p => p.id === column.id);
        if (prism) for (let i = 0; i < 4; i++) prism.vertices[i * 3 + 1] = roof;
        const collider = w.colliders.find(c => c.id === column.id);
        if (collider) {
          collider.center.y = (roof + column.bottom) / 2; collider.halfExtents.y = (roof - column.bottom) / 2;
          if (prism && collider.vertices) collider.vertices = prism.vertices.map((n, i) => n - (i % 3 === 0 ? collider.center.x : i % 3 === 1 ? collider.center.y : collider.center.z));
        }
      }
      for (const l of w.lights) if (l.roomId === floor.roomId) l.ceilingY = roof;
    }
    spatial.reliefs.push({ id, roomId: floor.roomId!, kind, bounds: footprint, baseY: h, peakY: h + peak, access, surfaceIds: made.map(s => s.id) });
    const flats = made.filter(s => s.profile.kind === 'flat'), ramps = made.filter(s => s.profile.kind === 'linear').map(s => ({ bounds: s.bounds,
      axis: s.profile.kind === 'linear' ? s.profile.axis : 'x' as const, riseDirection: (s.profile.kind === 'linear' && s.profile.endY < s.profile.startY ? -1 : 1) as -1 | 1 }));
    w.features.push({ kind: 'raised-zone', id, roomId: floor.roomId!, roomIds: [floor.roomId!], bounds: footprint,
      platformBounds: flats.at(-1)!.bounds, platformRects: flats.map(s => s.bounds), elevation: h + peak, ramp: ramps[0]!, ramps });
    const first = made.find(s => s.profile.kind === 'linear')!, point = rectCenter(first.bounds);
    spatial.landmarks.push({ kind: kind === 'mound' ? 'monticule-massif' : 'salle-en-gradins', position: { ...point, y: h + peak / (kind === 'mound' ? 2 : made.length) + .865 } });
  }
};
