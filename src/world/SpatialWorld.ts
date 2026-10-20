import { SeededRandom } from './SeededRandom';
import type { Rect, SurfaceStyle, WorldPlan } from './types';
import { pointInRect, rectCenter, rectDepth, rectWidth } from './types';
import { ADDRESS_PITCH, regionalAtrium, regionalCellId, regionalDatum, SPATIAL_CLEARANCE, spatialCellBounds } from './RegionalPlan';
import type { SpatialAddress, SpatialPrism } from './SpatialTypes';
import type { InfiniteEdgeGates } from './InfiniteWorld';
import { endpointStairRun, offsetProfile, prismCollider, profilePrism } from './SpatialGeometry';
import { classifySurfaceAccess, cutRects, overlapRect, surfaceCollider, surfaceRange, surfaceY, TOPOLOGY_VERSION,
  type HeightProfile, type SurfaceConnection, type WalkableSurface } from './WalkableTopology';

const sides = ['north', 'east', 'south', 'west'] as const;
type Side = typeof sides[number];
const deltas: Record<Side, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const flat = (y: number): HeightProfile => ({ kind: 'flat', y });

/** Construct the regional surfaces first; walls and details consume that plan.
 * Every cell is addressed globally, so a chunk is just a bounded materialization.
 */
export const generateSpatialWorld = (seed: string, owner: SpatialAddress, style?: SurfaceStyle, boundaryGates?: InfiniteEdgeGates): WorldPlan => {
  const offset = { x: owner.x * 112, z: owner.z * 112 }, local = (b: Rect): Rect => ({ minX: b.minX - offset.x, maxX: b.maxX - offset.x, minZ: b.minZ - offset.z, maxZ: b.maxZ - offset.z });
  const world: WorldPlan = { version: 11, seed, size: 112, wallHeight: 3.05, rooms: [], walls: [], columns: [], solidMasses: [], lights: [], missingCeilingTiles: [],
    features: [], detailSockets: [], colliders: [], floorRects: [], floorOpenings: [], ceilingOpenings: [], stairCeilingOpenings: [], spawn: { x: 0, y: 0, z: 0 }, surfaceStyle: style,
    topology: { version: TOPOLOGY_VERSION, ownerStory: owner.story, surfaces: [], connections: [], volumes: [], diagnostics: [] },
    spatial: { version: 2, owner: { ...owner }, cells: [], ceilings: [], prisms: [], dependencies: [], landmarks: [] } };
  const topology = world.topology!, spatial = world.spatial!;
  const addSurface = (id: string, roomId: string, b: Rect, p: HeightProfile, role: WalkableSurface['role'] = 'floor', roof = true, ceiling?: number): WalkableSurface => {
    const ceilingProfile = ceiling === undefined ? offsetProfile(p, SPATIAL_CLEARANCE) : flat(ceiling);
    const s: WalkableSurface = { id, roomId, ownerStory: owner.story, layer: `regional/${owner.story}`, role, bounds: b, profile: p,
      ceilingY: ceiling ?? (p.kind === 'flat' ? p.y : Math.max(p.startY, p.endY)) + SPATIAL_CLEARANCE, ceilingProfile,
      thickness: .16, support: 'slab', access: 'open', edges: 'architecture', reachability: 'regional' };
    topology.surfaces.push(s);
    if (roof) spatial.ceilings.push({ ...s, id: `${id}/ceiling`, profile: offsetProfile(ceilingProfile, .03), thickness: .03 });
    return s;
  };
  const addPrism = (p: SpatialPrism) => { spatial.prisms.push(p); if (p.collision) world.colliders.push(prismCollider(p)); };
  const wall = (id: string, bounds: Rect, bottom: number, top: number) => {
    if (top <= bottom + .005 || rectWidth(bounds) < .005 || rectDepth(bounds) < .005) return;
    addPrism(profilePrism(id, bounds, flat(bottom), flat(top)));
    const alongX = rectWidth(bounds) > rectDepth(bounds), p = rectCenter(bounds);
    world.walls.push({ id, x: p.x, z: p.z, orientation: alongX ? 'x' : 'z', length: alongX ? rectWidth(bounds) : rectDepth(bounds), thickness: alongX ? rectDepth(bounds) : rectWidth(bounds),
      bottom, height: top - bottom, tint: 1, collision: true, kind: 'wallpaper' });
  };
  const dependency = (story: number, bounds: Rect, bottom: number, top: number, reason: 'atrium' | 'stairs' | 'drop' | 'view') => {
    if (story === owner.story) return;
    spatial.dependencies.push({ owner: { ...owner, story }, bounds, bottom, top, reason });
  };
  const connector = (id: string, roomId: string, bounds: Rect, axis: 'x' | 'z', a: number, b: number, roof = true, ceiling?: number) => {
    const run = axis === 'x' ? rectWidth(bounds) : rectDepth(bounds), difference = Math.abs(b - a);
    if (difference < .001) return [addSurface(id, roomId, bounds, flat(a), 'floor', roof, ceiling)];
    if (difference / run <= .3) return [addSurface(id, roomId, bounds, { kind: 'linear', axis, startY: a, endY: b }, 'ramp', roof, ceiling)];
    return endpointStairRun(bounds, axis, a, b).map(step => addSurface(`${id}/step-${step.index}`, roomId, step.bounds, step.profile, 'stair', roof, ceiling));
  };

  for (let iz = 0; iz < 4; iz++) for (let ix = 0; ix < 4; ix++) {
    const gx = owner.x * 4 + ix, gz = owner.z * 4 + iz, id = regionalCellId(gx, gz, owner.story), b = local(spatialCellBounds(gx, gz)), p = rectCenter(b);
    const datum = regionalDatum(seed, gx, gz), h = datum.y, atrium = regionalAtrium(seed, gx, gz, owner.story);
    const mode = !atrium ? 'rooms' : owner.story === atrium.owner ? 'gallery' : owner.story === atrium.lower ? 'lower-maze' : 'void';
    const roofY = atrium ? h + (atrium.owner - owner.story) * ADDRESS_PITCH + SPATIAL_CLEARANCE : h + SPATIAL_CLEARANCE;
    const roomId = `${id}/room`, rng = new SeededRandom(`${seed}:spatial-cell:v2:${gx}:${gz}:${owner.story}`);
    spatial.cells.push({ id, regionId: datum.id, bounds: b, floorY: h, mode, ...(atrium ? { atriumOwner: atrium.owner } : {}) });
    world.rooms.push({ id: roomId, bounds: b, kind: mode === 'lower-maze' ? 'lower-maze' : mode === 'gallery' ? 'pit-gallery' : 'office', level: 0,
      floorY: h, ceilingHeight: roofY, structuralCeilingY: roofY, detailDensity: mode === 'void' ? 0 : .25, access: 'open' });
    if (atrium) {
      for (let story = atrium.lower; story <= atrium.owner; story++) dependency(story, b, h + (atrium.lower - owner.story) * 5.4, roofY, 'atrium');
      const hole = { minX: b.minX + 3, maxX: b.maxX - 3, minZ: b.minZ + 3, maxZ: b.maxZ - 3 };
      if (mode !== 'lower-maze') world.floorOpenings!.push(mode === 'void' ? { ...b } : hole);
      if (mode !== 'gallery') world.ceilingOpenings!.push({ ...b });
      if (mode === 'gallery') {
        const lower = h - 10.8;
        const ring = cutRects([b], [hole]);
        ring.forEach((r, i) => addSurface(`${id}/gallery-${i}`, roomId, r, flat(h), 'balcony', false, roofY));
        // The bridge is supported at the real wall galleries at both ends.
        const bridge = { minX: hole.minX, maxX: hole.maxX, minZ: p.z - 1.6, maxZ: p.z + 1.6 };
        if (atrium.variant !== 'U') addSurface(`${id}/bridge`, roomId, bridge, flat(h), 'bridge', false, roofY);
        if (atrium.variant === 'L') addSurface(`${id}/return`, roomId, { minX: p.x - 1.6, maxX: p.x + 1.6, minZ: hole.minZ, maxZ: bridge.minZ }, flat(h), 'balcony', false, roofY);
        // One full-width stair fits against the east wall, outside the upper ring.
        if (atrium.stairs) {
          const stair = { minX: hole.maxX - 3.2, maxX: hole.maxX, minZ: hole.minZ, maxZ: hole.maxZ };
          const steps = connector(`${id}/atrium-stairs`, roomId, stair, 'z', h, lower, false, roofY);
          const end = steps.at(-1)!;
          topology.connections.push({ id: `${id}/stairs-exit`, from: end.id, to: `${regionalCellId(gx, gz, atrium.lower)}/floor`,
            at: { x: rectCenter(stair).x, z: stair.maxZ }, arrival: { x: rectCenter(stair).x, y: lower, z: stair.maxZ + .5 }, width: 3.2,
            kind: 'stairs', direction: 'both', access: 'open', toOwner: { ...owner, story: atrium.lower } });
          spatial.landmarks.push({ kind: 'escalier-regional', position: { x: rectCenter(stair).x, y: h + .865, z: stair.minZ - .5 }, destination: { x: rectCenter(stair).x, y: lower + .865, z: stair.maxZ + .5 }, owner: { ...owner, story: atrium.lower } });
        }
        spatial.ceilings.push({ id: `${id}/atrium-roof`, roomId, ownerStory: owner.story, layer: `regional/${owner.story}`, role: 'floor', bounds: b, profile: flat(roofY + .03),
          ceilingY: roofY, thickness: .03, support: 'slab', access: 'sealed', edges: 'architecture' });
        spatial.landmarks.push({ kind: `galerie-${atrium.variant.toLowerCase()}`, position: { x: p.x, y: h + .865, z: b.minZ + 1.5 } });
      } else if (mode === 'lower-maze') addSurface(`${id}/floor`, roomId, b, flat(h), 'floor', false, roofY);
      else {
        // The middle address contains four real window sills. They stop at the
        // void, with no reciprocal route and no invented ramp below them.
        for (const side of sides) {
          const axis = side === 'north' || side === 'south' ? 'z' : 'x', sign = side === 'north' || side === 'west' ? -1 : 1;
          const sill: Rect = axis === 'x' ? { minX: sign < 0 ? b.minX : b.maxX - 1.5, maxX: sign < 0 ? b.minX + 1.5 : b.maxX, minZ: p.z - 2, maxZ: p.z + 2 }
            : { minZ: sign < 0 ? b.minZ : b.maxZ - 1.5, maxZ: sign < 0 ? b.minZ + 1.5 : b.maxZ, minX: p.x - 2, maxX: p.x + 2 };
          const s = addSurface(`${id}/window-${side}`, roomId, sill, flat(h), 'landing', false, roofY);
          const arrival = { x: p.x + (axis === 'x' ? sign * 10 : 0), y: h - 5.4, z: p.z + (axis === 'z' ? sign * 10 : 0) };
          topology.connections.push({ id: `${id}/drop-${side}`, from: s.id, to: `${regionalCellId(gx, gz, atrium.lower)}/floor`, at: rectCenter(sill), arrival,
            width: 4, kind: 'drop', direction: 'forward', access: 'open', toOwner: { ...owner, story: atrium.lower } });
          spatial.landmarks.push({ kind: 'ouverture-haute', position: { ...rectCenter(sill), y: h + .865 }, destination: { ...arrival, y: arrival.y + .865 }, owner: { ...owner, story: atrium.lower } });
        }
      }
    } else {
      const branchCuts: Rect[] = [];
      for (const side of sides) {
        const [dx, dz] = deltas[side], other = regionalDatum(seed, gx + dx, gz + dz), y = (h + other.y) / 2;
        if (Math.abs(y - h) < .001) continue;
        const alongX = dx !== 0, reverse = dx < 0 || dz < 0;
        const corridor: Rect = alongX ? { minX: reverse ? b.minX : p.x + 3, maxX: reverse ? p.x - 3 : b.maxX, minZ: p.z - 2, maxZ: p.z + 2 }
          : { minZ: reverse ? b.minZ : p.z + 3, maxZ: reverse ? p.z - 3 : b.maxZ, minX: p.x - 2, maxX: p.x + 2 };
        branchCuts.push(corridor);
        const core = alongX ? (reverse ? corridor.maxX : corridor.minX) : reverse ? corridor.maxZ : corridor.minZ;
        const edge = alongX ? (reverse ? corridor.minX : corridor.maxX) : reverse ? corridor.minZ : corridor.maxZ;
        const part = (a: number, end: number): Rect => alongX ? { ...corridor, minX: Math.min(a, end), maxX: Math.max(a, end) } : { ...corridor, minZ: Math.min(a, end), maxZ: Math.max(a, end) };
        const sign = reverse ? -1 : 1, first = core + sign, last = edge - sign;
        const approach = addSurface(`${id}/${side}/approach`, roomId, part(core, first), flat(h));
        const route = connector(`${id}/${side}/route`, roomId, part(first, last), alongX ? 'x' : 'z', reverse ? y : h, reverse ? h : y);
        const seam = addSurface(`${id}/${side}/seam`, roomId, part(last, edge), flat(y), 'landing');
        // Side walls follow the exact connector envelope, rather than a solid
        // wedge extruded down to a forgotten ground datum.
        for (const s of [approach, ...route, seam]) for (const sideSign of [-1, 1]) {
          const r = s.bounds, sb = alongX ? { ...r, minZ: sideSign < 0 ? r.minZ - .16 : r.maxZ, maxZ: sideSign < 0 ? r.minZ : r.maxZ + .16 }
            : { ...r, minX: sideSign < 0 ? r.minX - .16 : r.maxX, maxX: sideSign < 0 ? r.minX : r.maxX + .16 };
          const corners = [[sb.minX, sb.minZ], [sb.minX, sb.maxZ], [sb.maxX, sb.maxZ], [sb.maxX, sb.minZ]];
          const bottoms = corners.map(([x, z]) => {
            const inside = alongX ? Math.abs(z! - (sideSign < 0 ? r.minZ : r.maxZ)) < .001 : Math.abs(x! - (sideSign < 0 ? r.minX : r.maxX)) < .001;
            return inside ? surfaceY(s, x!, z!) - .16 : h - .16;
          });
          // Each address owns a 5.4m sheared band. Both visible faces start at
          // their respective floor, and adjacent owners meet without overlap.
          const vertices = [ADDRESS_PITCH, 0].flatMap(d => corners.flatMap(([x, z], i) => [x!, bottoms[i]! + d, z!]));
          addPrism({ id: `${s.id}/side-${sideSign}`, vertices, material: 'wall', collision: true });
        }
        spatial.landmarks.push({ kind: route[0]?.role === 'stair' ? 'escalier-regional' : 'rampe-regionale', position: { ...rectCenter(corridor), y: (h + y) / 2 + .865 } });
      }
      cutRects([b], branchCuts).forEach((r, i) => addSurface(`${id}/floor${i ? `-${i}` : ''}`, roomId, r, flat(h)));
    }

    // Rooms are subdivisions of the already planned plateau. A free central
    // cross and offset doorways maintain long corridors and loops through them.
    if (mode === 'rooms' || mode === 'lower-maze') {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const cx = p.x + sx * 8, cz = p.z + sz * 8, room = `${id}/quarter-${sx}-${sz}`;
        world.rooms.push({ id: room, bounds: { minX: cx - 5.5, maxX: cx + 5.5, minZ: cz - 5.5, maxZ: cz + 5.5 }, kind: rng.pick(['office', 'nested', 'sparse']),
          level: 0, floorY: h, ceilingHeight: roofY, detailDensity: .3, access: 'open' });
        const split = rng.float(-1.8, 1.8), fixedX = p.x + sx * 2.6, fixedZ = p.z + sz * 2.6;
        // Two interrupted partitions frame each room, with real 2.4m doorways.
        for (const [lo, hi] of [[cz - 5.4, cz + split - 1.2], [cz + split + 1.2, cz + 5.4]]) wall(`${room}/x-${lo}`, { minX: fixedX - .08, maxX: fixedX + .08, minZ: lo!, maxZ: hi! }, h, h + 2.85);
        for (const [lo, hi] of [[cx - 5.4, cx + split - 1.2], [cx + split + 1.2, cx + 5.4]]) wall(`${room}/z-${lo}`, { minZ: fixedZ - .08, maxZ: fixedZ + .08, minX: lo!, maxX: hi! }, h, h + 2.85);
        const l = { x: cx, z: cz };
        world.lights.push({ id: `${room}/light`, ...l, ceilingY: mode === 'lower-maze' ? h + 2.85 : roofY, width: 1.25, rotation: rng.chance(.5) ? 0 : Math.PI / 2,
          intensity: rng.float(.65, 1), color: 0xffefb8, dead: rng.chance(.025), unstable: rng.chance(.07), phase: rng.float(0, 6.28), roomId: room, level: 0 });
      }
    } else if (mode === 'gallery') {
      for (const x of [b.minX + 1.5, b.maxX - 1.5]) for (const z of [b.minZ + 1.5, b.maxZ - 1.5])
        world.lights.push({ id: `${id}/high-light/${x}/${z}`, x, z, ceilingY: roofY, width: 1.3, rotation: 0, intensity: .95, color: 0xffefb8, dead: false, unstable: false, phase: 0, roomId, level: 0 });
    }

    // Each side owns its interior half of a common wall. At a district
    // boundary the vertical facade is partitioned by address, not stretched
    // once per room; its opening is at the actual shared connector datum.
    for (const side of sides) {
      const [dx, dz] = deltas[side], alongX = dz !== 0, otherH = regionalDatum(seed, gx + dx, gz + dz).y, portalY = (h + otherH) / 2;
      const min = alongX ? b.minX : b.minZ, max = alongX ? b.maxX : b.maxZ, mid = alongX ? p.x : p.z;
      const sideBounds = (lo: number, hi: number): Rect => alongX ? { minX: lo, maxX: hi, minZ: side === 'north' ? b.minZ : b.maxZ - .08, maxZ: side === 'north' ? b.minZ + .08 : b.maxZ }
        : { minZ: lo, maxZ: hi, minX: side === 'west' ? b.minX : b.maxX - .08, maxX: side === 'west' ? b.minX + .08 : b.maxX };
      const bottom = h - .16, top = h + ADDRESS_PITCH - .16;
      const outside = side === 'north' ? iz === 0 : side === 'south' ? iz === 3 : side === 'west' ? ix === 0 : ix === 3;
      const gates = outside && boundaryGates ? boundaryGates[side].filter(g => g.offset + g.width / 2 > min && g.offset - g.width / 2 < max)
        .map(g => ({ min: Math.max(min, g.offset - g.width / 2), max: Math.min(max, g.offset + g.width / 2), y: g.floorY })) : [{ min: mid - 2, max: mid + 2, y: portalY }];
      let cursor = min;
      for (const [i, g] of [...gates].sort((a, b) => a.min - b.min).entries()) {
        wall(`${id}/facade-${side}/part-${i}`, sideBounds(cursor, g.min), bottom, top);
        let vertical = [{ min: bottom, max: top }];
        for (let delta = -3; delta <= 3; delta++) {
          const lo = g.y + delta * ADDRESS_PITCH, hi = lo + SPATIAL_CLEARANCE;
          vertical = vertical.flatMap(v => hi <= v.min || lo >= v.max ? [v] : [{ min: v.min, max: Math.min(lo, v.max) }, { min: Math.max(hi, v.min), max: v.max }].filter(v => v.max - v.min > .005));
        }
        vertical.forEach((v, j) => wall(`${id}/facade-${side}/header-${i}-${j}`, sideBounds(g.min, g.max), v.min, v.max));
        cursor = g.max;
      }
      wall(`${id}/facade-${side}/last`, sideBounds(cursor, max), bottom, top);
    }
  }

  // Only exposed gallery edges receive parapets; keep the stair entry and exit
  // open. Subtract all same-height neighbours so bridges never get end barriers.
  for (const s of topology.surfaces.filter(s => s.role === 'balcony' || s.role === 'bridge')) {
    const b = s.bounds, y = surfaceRange(s)[0];
    for (const [axis, fixed, min, max] of [['x', b.minZ, b.minX, b.maxX], ['x', b.maxZ, b.minX, b.maxX], ['z', b.minX, b.minZ, b.maxZ], ['z', b.maxX, b.minZ, b.maxZ]] as const) {
      let intervals = [{ min, max }];
      for (const other of topology.surfaces) {
        if (s === other) continue; const r = other.bounds, lo = axis === 'x' ? r.minX : r.minZ, hi = axis === 'x' ? r.maxX : r.maxZ;
        const near = axis === 'x' ? [r.minZ, r.maxZ] : [r.minX, r.maxX]; if (!near.some(v => Math.abs(v - fixed) < .002)) continue;
        const along = (Math.max(lo, min) + Math.min(hi, max)) / 2;
        if (Math.abs(surfaceY(other, axis === 'x' ? along : fixed, axis === 'x' ? fixed : along) - y) > .19) continue;
        intervals = intervals.flatMap(g => hi <= g.min || lo >= g.max ? [g] : [{ min: g.min, max: Math.min(g.max, lo) }, { min: Math.max(g.min, hi), max: g.max }].filter(v => v.max - v.min > .04));
      }
      // A cell boundary is architectural, not a guard across the next room.
      const boundary = Math.abs((fixed + 56) / 28 - Math.round((fixed + 56) / 28)) < .0001; if (boundary) continue;
      intervals.forEach((g, i) => wall(`${s.id}/parapet/${axis}/${fixed}/${i}`, axis === 'x'
        ? { minX: g.min, maxX: g.max, minZ: fixed - .06, maxZ: fixed + .06 }
        : { minZ: g.min, maxZ: g.max, minX: fixed - .06, maxX: fixed + .06 }, y, y + 1.05));
    }
  }

  connectSpatialSurfaces(world);
  world.colliders.push(...topology.surfaces.map(surfaceCollider), ...spatial.ceilings.map(s => ({ ...surfaceCollider(s), id: s.id, kind: 'barrier' as const })));
  topology.volumes = topology.surfaces.flatMap(s => [{ id: `${s.id}/clearance`, surfaceId: s.id, bounds: s.bounds, bottom: surfaceRange(s)[0], top: s.ceilingY, purpose: 'clearance' as const, ownerStory: owner.story },
    { id: `${s.id}/structure`, surfaceId: s.id, bounds: s.bounds, bottom: surfaceRange(s)[0] - .16, top: surfaceRange(s)[1], purpose: 'structure' as const, ownerStory: owner.story }]);
  world.floorRects = topology.surfaces.map(s => s.bounds);
  const candidates = topology.surfaces.filter(s => s.role === 'floor' && s.profile.kind === 'flat' && rectWidth(s.bounds) > 2 && rectDepth(s.bounds) > 2)
    .map(s => ({ s, p: rectCenter(s.bounds) })).filter(({ s, p }) => !world.colliders.some(c => c.kind === 'wall' && Math.abs(c.center.x - p.x) < c.halfExtents.x + .4 && Math.abs(c.center.z - p.z) < c.halfExtents.z + .4 && c.center.y + c.halfExtents.y > surfaceY(s, p.x, p.z) + .1 && c.center.y - c.halfExtents.y < surfaceY(s, p.x, p.z) + 1.8))
    .sort((a, b) => Math.hypot(a.p.x, a.p.z) - Math.hypot(b.p.x, b.p.z));
  const spawn = candidates[0] ?? { s: topology.surfaces[0]!, p: rectCenter(topology.surfaces[0]!.bounds) };
  world.spawn = { ...spawn.p, y: surfaceY(spawn.s, spawn.p.x, spawn.p.z) + .865 };
  world.wallHeight = Math.max(...world.rooms.map(r => r.ceilingHeight));
  classifySurfaceAccess(world);
  return world;
};

/** Join physical shared edges, retaining stair risers and directed external links.
 * Axis bins avoid a quadratic all-surfaces search across an entire chunk.
 */
export const connectSpatialSurfaces = (world: WorldPlan): void => {
  const t = world.topology!, groups = new Map<string, { s: WalkableSurface; min: number; max: number; fixed: number; axis: 'x' | 'z' }[]>();
  for (const s of t.surfaces) {
    const b = s.bounds;
    for (const [axis, fixed, min, max] of [['x', b.minZ, b.minX, b.maxX], ['x', b.maxZ, b.minX, b.maxX], ['z', b.minX, b.minZ, b.maxZ], ['z', b.maxX, b.minZ, b.maxZ]] as const) {
      const key = `${axis}/${Math.round(fixed * 1000)}`, values = groups.get(key) ?? []; values.push({ s, min, max, fixed, axis }); groups.set(key, values);
    }
  }
  const links: SurfaceConnection[] = [];
  for (const entries of groups.values()) for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    const a = entries[i]!, b = entries[j]!; if (a.s.id === b.s.id) continue;
    const lo = Math.max(a.min, b.min), hi = Math.min(a.max, b.max); if (hi - lo < .7) continue;
    const p = a.axis === 'x' ? { x: (lo + hi) / 2, z: a.fixed } : { z: (lo + hi) / 2, x: a.fixed };
    const delta = Math.abs(surfaceY(a.s, p.x, p.z) - surfaceY(b.s, p.x, p.z)); if (delta > .19) continue;
    links.push({ id: `join/${a.s.id}/${b.s.id}`, from: a.s.id, to: b.s.id, at: p, width: hi - lo, kind: delta > .002 ? 'stairs' : 'walk', direction: 'both', access: 'open' });
  }
  t.connections.push(...links);
};
