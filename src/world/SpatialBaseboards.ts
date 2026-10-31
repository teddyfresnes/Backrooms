import { baseboardExclusions, subtractTrimIntervals, type TrimInterval } from './BaseboardZones';
import { RectIndex } from './RectIndex';
import { createSpatialFinishResolver } from './SpatialFinishPolicy';
import type { SpatialPrism } from './SpatialTypes';
import type { WalkableSurface } from './WalkableTopology';
import type { Rect, WorldPlan } from './types';

const EPS = 1e-6;
export const BASEBOARD_HEIGHT = .12;
export const BASEBOARD_DEPTH = .03;
interface Solid { prism: SpatialPrism; bounds: Rect }
interface Face extends TrimInterval { axis: 'x' | 'z'; fixed: number; sign: -1 | 1; solid: Solid; a: number; b: number }
interface Run extends TrimInterval { axis: 'x' | 'z'; fixed: number; sign: -1 | 1; floor: WalkableSurface }
const boundsOf = (p: SpatialPrism): Rect => {
  const xs = p.vertices.filter((_, i) => i % 3 === 0), zs = p.vertices.filter((_, i) => i % 3 === 2);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
};
const strip = (axis: 'x' | 'z', fixed: number, min: number, max: number, depth: number): Rect => axis === 'x'
  ? { minX: min, maxX: max, minZ: fixed - depth, maxZ: fixed + depth }
  : { minZ: min, maxZ: max, minX: fixed - depth, maxX: fixed + depth };
const point = (r: Pick<Run, 'axis' | 'fixed'>, at: number) => r.axis === 'x' ? { x: at, z: r.fixed } : { x: r.fixed, z: at };
// Unlike navigation's clamped surfaceY, the affine plane can be compared across
// tiled ramp fragments and evaluated at their tiny mitre extensions.
const heightAt = (s: WalkableSurface, x: number, z: number): number => {
  const p = s.profile; if (p.kind === 'flat') return p.y;
  const min = p.axis === 'x' ? s.bounds.minX : s.bounds.minZ, max = p.axis === 'x' ? s.bounds.maxX : s.bounds.maxZ;
  return p.startY + (p.endY - p.startY) * ((p.axis === 'x' ? x : z) - min) / (max - min);
};
const y = (r: Run, at: number) => { const p = point(r, at); return heightAt(r.floor, p.x, p.z); };
const faceY = (f: Face, at: number, bottom: boolean): number => {
  const v = f.solid.prism.vertices, a = (f.a + (bottom ? 4 : 0)) * 3, b = (f.b + (bottom ? 4 : 0)) * 3;
  const start = v[a + (f.axis === 'x' ? 0 : 2)]!, end = v[b + (f.axis === 'x' ? 0 : 2)]!;
  return v[a + 1]! + (v[b + 1]! - v[a + 1]!) * (at - start) / (end - start);
};
const clipPositive = (r: TrimInterval, value: (at: number) => number): TrimInterval[] => {
  const a = value(r.min), b = value(r.max);
  if (a >= -EPS && b >= -EPS) return [r];
  if (a < -EPS && b < -EPS) return [];
  const root = r.min + (r.max - r.min) * a / (a - b);
  return [{ min: a < -EPS ? root : r.min, max: b < -EPS ? root : r.max }].filter(p => p.max - p.min > EPS);
};
const facesOf = (solid: Solid): Face[] => {
  const result: Face[] = [], v = solid.prism.vertices;
  for (let a = 0; a < 4; a++) {
    const b = (a + 1) % 4, ax = v[a * 3]!, az = v[a * 3 + 2]!, bx = v[b * 3]!, bz = v[b * 3 + 2]!;
    // Only actual vertical, axis-aligned faces. Never replace a sloping or
    // sheared cheek with its bounding box.
    if ([a, b].some(i => Math.abs(v[i * 3]! - v[(i + 4) * 3]!) > EPS || Math.abs(v[i * 3 + 2]! - v[(i + 4) * 3 + 2]!) > EPS)) continue;
    const axis = Math.abs(az - bz) < EPS ? 'x' : Math.abs(ax - bx) < EPS ? 'z' : undefined;
    if (!axis) continue;
    const min = Math.min(axis === 'x' ? ax : az, axis === 'x' ? bx : bz), max = Math.max(axis === 'x' ? ax : az, axis === 'x' ? bx : bz);
    if (max - min <= EPS) continue;
    const fixed = axis === 'x' ? az : ax, midpoint = axis === 'x' ? (solid.bounds.minZ + solid.bounds.maxZ) / 2 : (solid.bounds.minX + solid.bounds.maxX) / 2;
    result.push({ axis, fixed, min, max, sign: fixed < midpoint ? -1 : 1, solid, a, b });
  }
  return result;
};
const planeKey = (r: Run): string => {
  const p = point(r, 0), h = heightAt(r.floor, p.x, p.z), dx = heightAt(r.floor, p.x + 1, p.z) - h, dz = heightAt(r.floor, p.x, p.z + 1) - h;
  return [r.axis, r.sign, r.fixed, h, dx, dz].map(n => typeof n === 'number' ? Math.round(n * 1e6) : n).join('/');
};
const convexContour = (points: { x: number; z: number }[]) => {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (a: typeof points[number], b: typeof a, c: typeof a) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const half = (list: typeof points) => {
    const hull: typeof points = [];
    for (const p of list) { while (hull.length > 1 && cross(hull.at(-2)!, hull.at(-1)!, p) <= 1e-12) hull.pop(); hull.push(p); }
    return hull.slice(0, -1);
  };
  const hull = [...half(sorted), ...half([...sorted].reverse())];
  // A notch narrower than twice the trim depth can make the two mitres cross.
  // Its solid offset is the convex envelope, never a self-intersecting quad.
  while (hull.length < 4) hull.push(hull.at(-1)!);
  return hull;
};
const floorSupport = (r: Run, nearby: readonly WalkableSurface[]): TrimInterval[] => {
  const outer = r.fixed + r.sign * BASEBOARD_DEPTH, low = Math.min(r.fixed, outer), high = Math.max(r.fixed, outer);
  const b = r.floor.bounds, ownLow = r.axis === 'x' ? b.minZ : b.minX, ownHigh = r.axis === 'x' ? b.maxZ : b.maxX;
  if (low >= ownLow - EPS && high <= ownHigh + EPS) return [r];
  const p = point(r, (r.min + r.max) / 2);
  const matching = nearby.filter(s => [[p.x, p.z], [p.x + 1, p.z], [p.x, p.z + 1]].every(([x, z]) =>
    Math.abs(heightAt(s, x!, z!) - heightAt(r.floor, x!, z!)) < EPS));
  const events = [...new Set([r.min, r.max, ...matching.flatMap(s => r.axis === 'x' ? [s.bounds.minX, s.bounds.maxX] : [s.bounds.minZ, s.bounds.maxZ])])]
    .filter(n => n >= r.min && n <= r.max).sort((a, b) => a - b);
  const result: TrimInterval[] = [];
  for (let i = 1; i < events.length; i++) {
    const min = events[i - 1]!, max = events[i]!, at = (min + max) / 2;
    const spans = matching.filter(s => at >= (r.axis === 'x' ? s.bounds.minX : s.bounds.minZ) - EPS && at <= (r.axis === 'x' ? s.bounds.maxX : s.bounds.maxZ) + EPS)
      .map(s => ({ min: r.axis === 'x' ? s.bounds.minZ : s.bounds.minX, max: r.axis === 'x' ? s.bounds.maxZ : s.bounds.maxX })).sort((a, b) => a.min - b.min);
    let covered = low;
    for (const span of spans) if (span.min <= covered + EPS) covered = Math.max(covered, span.max);
    if (max - min > EPS && covered >= high - EPS) result.push({ min, max });
  }
  return result;
};

/** Final exposed contours, independent of wall IDs/origins. The floor's actual
 * profile supplies each vertex height, including ramps and raised landings. */
export const createSpatialBaseboards = (world: WorldPlan): SpatialPrism[] => {
  if (!world.spatial || !world.topology) return [];
  const solids = world.spatial.prisms.filter(p => p.collision && (p.material === 'wall' || p.material === 'plaster')).map(prism => ({ prism, bounds: boundsOf(prism) }));
  const floorIndex = new RectIndex(world.topology.surfaces, s => s.bounds), solidIndex = new RectIndex(solids, s => s.bounds);
  const finish = createSpatialFinishResolver(world);
  const faceCache = new Map(solids.map(s => [s, facesOf(s)]));
  const groups = new Map<string, Run[]>(), half = world.size / 2, depth = BASEBOARD_DEPTH;
  for (const solid of solids) for (const face of faceCache.get(solid)!) {
    if (Math.abs(face.fixed - face.sign * half) < EPS) continue; // outward cut boundary, not an architectural end
    const nearby = floorIndex.query(strip(face.axis, face.fixed, face.min, face.max, depth + .002));
    for (const floor of nearby) {
      // Tread-by-tread horizontal bands are not a stair skirting profile.
      // Keep the actual sloping ramp finish and the flat landing's own datum.
      if (floor.role === 'stair') continue;
      const b = floor.bounds, low = face.axis === 'x' ? b.minZ : b.minX, high = face.axis === 'x' ? b.maxZ : b.maxX;
      const touching = face.fixed + face.sign * EPS * 2;
      if (touching < low - EPS || touching > high + EPS) continue;
      const min = Math.max(face.min, face.axis === 'x' ? b.minX : b.minZ), max = Math.min(face.max, face.axis === 'x' ? b.maxX : b.maxZ);
      if (max - min <= EPS) continue;
      const run: Run = { axis: face.axis, fixed: face.fixed, sign: face.sign, min, max, floor };
      let ranges = floorSupport(run, nearby).flatMap(r => clipPositive(r, at => y(run, at) - faceY(face, at, true)));
      ranges = ranges.flatMap(r => clipPositive(r, at => faceY(face, at, false) - y(run, at) - BASEBOARD_HEIGHT - .02));
      ranges = finish(run, floor).flatMap(policy => {
        const clipped = ranges.map(r => ({ min: Math.max(r.min, policy.min), max: Math.min(r.max, policy.max) })).filter(r => r.max - r.min > EPS);
        const zones = (world.baseboardlessZones ?? []).filter(z => z.floorY === undefined || Math.abs(z.floorY - policy.datum) < .05);
        return subtractTrimIntervals(clipped, baseboardExclusions(zones, face.axis, face.fixed + face.sign * depth / 2, policy.min, policy.max));
      });
      // Floors in balconies/landings can extend underneath a solid. Resolve
      // occlusion in the actual vertical band, never by the wall centre.
      for (const other of solidIndex.query(strip(face.axis, face.fixed, min, max, depth))) {
        if (other === solid || !ranges.length) continue;
        const r = other.bounds, crossMin = face.axis === 'x' ? r.minZ : r.minX, crossMax = face.axis === 'x' ? r.maxZ : r.maxX;
        const sample = face.fixed + face.sign * EPS * 4;
        if (sample <= crossMin + EPS || sample >= crossMax - EPS) continue;
        const lo = Math.max(min, face.axis === 'x' ? r.minX : r.minZ), hi = Math.min(max, face.axis === 'x' ? r.maxX : r.maxZ);
        if (hi - lo <= EPS) continue;
        const crossFaces = faceCache.get(other)!.filter(f => f.axis === face.axis);
        // A sheared solid has no matching vertical face: retain its exact
        // geometry rather than infer an occluder from an AABB.
        if (!crossFaces.length) continue;
        const f = crossFaces[0]!, g = crossFaces[1];
        const otherY = (at: number, bottom: boolean) => {
          const a = faceY(f, at, bottom);
          return g ? a + (faceY(g, at, bottom) - a) * (sample - f.fixed) / (g.fixed - f.fixed) : a;
        };
        // clipPositive admits numerical equality. Require strictly positive
        // vertical overlap here: a facade threshold ending on the floor must
        // not erase the neighbouring wall's entire skirting interval.
        let cuts = clipPositive({ min: lo, max: hi }, at => y(run, at) + BASEBOARD_HEIGHT - otherY(at, true) - 2 * EPS);
        cuts = cuts.flatMap(c => clipPositive(c, at => otherY(at, false) - y(run, at) - 2 * EPS));
        ranges = subtractTrimIntervals(ranges, cuts);
      }
      const key = planeKey(run), list = groups.get(key) ?? [];
      list.push(...ranges.map(r => ({ ...run, ...r }))); groups.set(key, list);
    }
  }
  const runs: Run[] = [];
  for (const [, list] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    list.sort((a, b) => a.min - b.min || a.max - b.max);
    for (const r of list) {
      const previous = runs.at(-1);
      if (previous && planeKey(previous) === planeKey(r) && r.min <= previous.max + EPS) previous.max = Math.max(previous.max, r.max);
      else runs.push({ ...r });
    }
  }
  const joints = new Map<string, { run: Run; at: number }[]>();
  const jointKey = (r: Run, at: number) => { const p = point(r, at); return [p.x, p.z, y(r, at)].map(n => Math.round(n * 1e6)).join('/'); };
  for (const r of runs) for (const at of [r.min, r.max]) {
    const key = jointKey(r, at), list = joints.get(key) ?? []; list.push({ run: r, at }); joints.set(key, list);
  }
  return runs.map((r, i) => {
    const start = point(r, r.min), end = point(r, r.max);
    const joined = new Set<number>();
    const outer = (at: number) => {
      const p = point(r, at); if (r.axis === 'x') p.z += r.sign * depth; else p.x += r.sign * depth;
      const peers = joints.get(jointKey(r, at))!;
      const peer = peers.length === 2 ? peers.find(p => p.run.axis !== r.axis)?.run : undefined;
      if (peer) {
        const corner = { ...p }; if (peer.axis === 'x') corner.z += peer.sign * depth; else corner.x += peer.sign * depth;
        const supported = floorIndex.query({ minX: corner.x - EPS, maxX: corner.x + EPS, minZ: corner.z - EPS, maxZ: corner.z + EPS }).some(s =>
          corner.x >= s.bounds.minX - EPS && corner.x <= s.bounds.maxX + EPS && corner.z >= s.bounds.minZ - EPS && corner.z <= s.bounds.maxZ + EPS
          && Math.abs(heightAt(s, corner.x, corner.z) - heightAt(r.floor, corner.x, corner.z)) < EPS);
        if (supported && Math.abs(heightAt(peer.floor, corner.x, corner.z) - heightAt(r.floor, corner.x, corner.z)) < EPS) { joined.add(at); return corner; }
      }
      return p;
    };
    const outerEnd = outer(r.max), outerStart = outer(r.min);
    let polygon = convexContour([start, end, outerEnd, outerStart]);
    const area = polygon.reduce((n, p, j) => { const q = polygon[(j + 1) % 4]!; return n + p.x * q.z - q.x * p.z; }, 0);
    if (area > 0) polygon = polygon.reverse();
    const vertices = [BASEBOARD_HEIGHT, 0].flatMap(offset => polygon.flatMap(p => [p.x, heightAt(r.floor, p.x, p.z) + offset, p.z]));
    // The back rests inside its real wall and the underside on its real floor.
    // Exact mitres share their caps. Do not send these invisible interfaces
    // through the worker's general polygon subtraction or emit their triangles.
    const openFaces = [1, ...polygon.flatMap((p, j) => {
      const q = polygon[(j + 1) % 4]!;
      const inner = (p === start && q === end || p === end && q === start);
      const joint = joined.has(r.min) && (p === start && q === outerStart || q === start && p === outerStart)
        || joined.has(r.max) && (p === end && q === outerEnd || q === end && p === outerEnd);
      const seam = r.axis === 'x' ? Math.abs(Math.abs(p.x) - half) < EPS && Math.abs(p.x - q.x) < EPS
        : Math.abs(Math.abs(p.z) - half) < EPS && Math.abs(p.z - q.z) < EPS;
      return inner || joint || seam ? [j + 2] : [];
    })];
    return { id: `baseboard/contour-${i}`, vertices, material: 'baseboard', collision: false, tint: 1, ...(openFaces.length ? { openFaces } : {}) };
  });
};
