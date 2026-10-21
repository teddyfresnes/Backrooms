import { stitchBspPartitions } from './BspConnectivity';
import { generateBspArchitecture, lightPanelOverlapsRect } from './generateWorld';
import type { Rect, SurfaceStyle, WorldPlan } from './types';
import { pointInRect, rectCenter, rectDepth, rectWidth } from './types';
import { ADDRESS_PITCH, regionalAtrium, regionalCellId, regionalDatum, regionalStyle, SPATIAL_CLEARANCE, spatialCellBounds } from './RegionalPlan';
import type { SpatialAddress, SpatialPrism } from './SpatialTypes';
import type { InfiniteEdgeGates } from './InfiniteWorld';
import { atriumCirculation, atriumGround, atriumGroundId, atriumTreads } from './SpatialConnectors';
import { endpointStairRun, offsetProfile, prismCollider, profilePrism, slabMeshCollider } from './SpatialGeometry';
import { classifySurfaceAccess, cutRects, findSurface, overlapRect, surfaceCollider, surfaceRange, surfaceY, TOPOLOGY_VERSION,
  type HeightProfile, type SurfaceConnection, type WalkableSurface } from './WalkableTopology';

const sides = ['north', 'east', 'south', 'west'] as const;
type Side = typeof sides[number];
const deltas: Record<Side, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const flat = (y: number): HeightProfile => ({ kind: 'flat', y });
const templates = new Map<string, WorldPlan>();
export const clearBspArchitectureCache = (): void => templates.clear();
const intersect = (a: Rect, b: Rect): Rect | undefined => {
  const r = { minX: Math.max(a.minX, b.minX), maxX: Math.min(a.maxX, b.maxX), minZ: Math.max(a.minZ, b.minZ), maxZ: Math.min(a.maxZ, b.maxZ) };
  return rectWidth(r) > .005 && rectDepth(r) > .005 ? r : undefined;
};
const expand = (r: Rect, d: number): Rect => ({ minX: r.minX - d, maxX: r.maxX + d, minZ: r.minZ - d, maxZ: r.maxZ + d });


/** Construct the regional surfaces first; walls and details consume that plan.
 * Every cell is addressed globally, so a chunk is just a bounded materialization.
 */
export const generateSpatialWorld = (seed: string, owner: SpatialAddress, style?: SurfaceStyle, boundaryGates?: InfiniteEdgeGates): WorldPlan => {
  const offset = { x: owner.x * 112, z: owner.z * 112 }, local = (b: Rect): Rect => ({ minX: b.minX - offset.x, maxX: b.maxX - offset.x, minZ: b.minZ - offset.z, maxZ: b.maxZ - offset.z });
  const world: WorldPlan = { version: 12, seed, size: 112, wallHeight: 3.05, rooms: [], walls: [], columns: [], solidMasses: [], lights: [], missingCeilingTiles: [],
    features: [], detailSockets: [], colliders: [], floorRects: [], floorOpenings: [], ceilingOpenings: [], stairCeilingOpenings: [], spawn: { x: 0, y: 0, z: 0 }, surfaceStyle: style, edgeGates: boundaryGates,
    topology: { version: TOPOLOGY_VERSION, ownerStory: owner.story, surfaces: [], connections: [], volumes: [], diagnostics: [] },
    spatial: { version: 2, owner: { ...owner }, cells: [], ceilings: [], prisms: [], dependencies: [], interfaces: [], landmarks: [] } };
  const topology = world.topology!, spatial = world.spatial!;
  const mx = Math.floor(owner.x / 2), mz = Math.floor(owner.z / 2);
  const templateKey = `${seed}:bsp-district:v1:${mx}:${mz}:${owner.story}`;
  let template = templates.get(templateKey);
  if (!template) { template = generateBspArchitecture(templateKey); templates.set(templateKey, template); if (templates.size > 32) templates.delete(templates.keys().next().value!); }
  // One canonical BSP spans 2x2 chunks. Cropping it never introduces a wall at
  // a 28m planning-cell edge or at the source chunk edge.
  const shift = { x: mx * 224 + 56 - offset.x, z: mz * 224 + 56 - offset.z };
  const move = (r: Rect): Rect => ({ minX: r.minX + shift.x, maxX: r.maxX + shift.x, minZ: r.minZ + shift.z, maxZ: r.maxZ + shift.z });

  const addSurface = (id: string, roomId: string, b: Rect, p: HeightProfile, role: WalkableSurface['role'] = 'floor', roof = true, ceiling?: number): WalkableSurface => {
    const ceilingProfile = ceiling === undefined ? offsetProfile(p, SPATIAL_CLEARANCE) : flat(ceiling);
    const s: WalkableSurface = { id, roomId, ownerStory: owner.story, layer: `regional/${owner.story}`, role, bounds: b, profile: p,
      ceilingY: ceiling ?? (p.kind === 'flat' ? p.y : Math.max(p.startY, p.endY)) + SPATIAL_CLEARANCE, ceilingProfile,
      thickness: .16, support: 'slab', access: 'open', edges: 'architecture', reachability: 'regional' };
    topology.surfaces.push(s);
    if (roof) spatial.ceilings.push({ ...s, id: `${id}/ceiling`, profile: offsetProfile(ceilingProfile, .03), thickness: .03 });
    return s;
  };
  // A five-metre vestibule lets a standing body turn past a thick partition
  // when a monument's inherited doorway is offset from the regional cell grid.
  const boundaryClearances = boundaryGates ? sides.flatMap(side => boundaryGates[side].map(g => ({
    bounds: side === 'east' || side === 'west'
      ? { minX: side === 'west' ? -56 : 51, maxX: side === 'west' ? -51 : 56, minZ: g.offset - g.width / 2, maxZ: g.offset + g.width / 2 }
      : { minZ: side === 'north' ? -56 : 51, maxZ: side === 'north' ? -51 : 56, minX: g.offset - g.width / 2, maxX: g.offset + g.width / 2 },
    bottom: g.floorY - .16, top: g.floorY + SPATIAL_CLEARANCE,
  }))) : [];
  const addPrism = (p: SpatialPrism) => { spatial.prisms.push(p); if (p.collision) world.colliders.push(prismCollider(p)); };
  const wall = (id: string, bounds: Rect, bottom: number, top: number, tint = 1) => {
    if (top <= bottom + .005 || rectWidth(bounds) < .005 || rectDepth(bounds) < .005) return;
    const apertures = boundaryClearances.filter(c => c.bottom < top && c.top > bottom && overlapRect(c.bounds, bounds));
    const parts = cutRects([bounds], apertures.map(a => a.bounds)).map(b => ({ bounds: b, bottom, top }));
    for (const a of apertures) if (top > a.top + .005) parts.push({ bounds: { minX: Math.max(bounds.minX, a.bounds.minX), maxX: Math.min(bounds.maxX, a.bounds.maxX), minZ: Math.max(bounds.minZ, a.bounds.minZ), maxZ: Math.min(bounds.maxZ, a.bounds.maxZ) }, bottom: Math.max(bottom, a.top), top });
    for (const [i, part] of parts.entries()) {
      const b = part.bounds, name = apertures.length ? `${id}/aperture-${i}` : id;
      addPrism({ ...profilePrism(name, b, flat(part.bottom), flat(part.top)), tint });
      const alongX = rectWidth(b) > rectDepth(b), p = rectCenter(b);
      world.walls.push({ id: name, x: p.x, z: p.z, orientation: alongX ? 'x' : 'z', length: alongX ? rectWidth(b) : rectDepth(b), thickness: alongX ? rectDepth(b) : rectWidth(b),
        bottom: part.bottom, height: part.top - part.bottom, tint, collision: true, kind: 'wallpaper' });
    }
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
    const { family, wallHalf } = regionalStyle(seed, datum.id);
    const mode = !atrium ? 'rooms' : owner.story === atrium.owner ? 'gallery' : owner.story === atrium.lower ? 'lower-maze' : 'void';
    const roofY = atrium ? h + (atrium.owner - owner.story) * ADDRESS_PITCH + SPATIAL_CLEARANCE : h + SPATIAL_CLEARANCE;
    const roomId = `${id}/room`;
    spatial.cells.push({ id, regionId: datum.id, bounds: b, floorY: h, mode, ...(atrium ? { atriumOwner: atrium.owner } : {}) });
    world.rooms.push({ id: roomId, bounds: b, kind: mode === 'lower-maze' ? 'lower-maze' : mode === 'gallery' ? 'pit-gallery' : family === 'maze' ? 'corridor' : 'open-hall', level: 0,
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
        const circulation = atriumCirculation(b, h, atrium), bridge = circulation.bridge;
        if (atrium.variant === 'L') {
          const gap = b.minX + 9;
          const west = addSurface(`${id}/bridge/jump-west`, roomId, { ...bridge, maxX: gap - .7 }, flat(h), 'bridge', false, roofY);
          const east = addSurface(`${id}/bridge/jump-east`, roomId, { ...bridge, minX: gap + .7 }, flat(h), 'bridge', false, roofY);
          west.openEdges = ['east']; east.openEdges = ['west'];
          const at = { x: gap - 1.3, z: rectCenter(bridge).z }, arrival = { x: gap + 1.3, y: h, z: at.z };
          topology.connections.push({ id: `${id}/bridge-jump`, from: west.id, to: east.id, at, arrival, width: 3.2, kind: 'jump', direction: 'both', access: 'open' });
          spatial.landmarks.push({ kind: 'saut-passerelle', position: { ...at, y: h + .865 }, destination: { ...arrival, y: h + .865 } });
        } else if (atrium.variant === 'bridge') addSurface(`${id}/bridge`, roomId, bridge, flat(h), 'bridge', false, roofY);
        if (atrium.variant === 'L') addSurface(`${id}/return`, roomId, { minX: p.x - 1.6, maxX: p.x + 1.6, minZ: hole.minZ, maxZ: bridge.minZ }, flat(h), 'balcony', false, roofY);
        // One full-width stair fits against the east wall, outside the upper ring.
        if (atrium.stairs) {
          const runs = circulation.legs.map(leg => endpointStairRun(leg.bounds, leg.axis, leg.startY, leg.endY).map(step => addSurface(`${id}/atrium-stairs/${leg.name}/step-${step.index}`, roomId, step.bounds, step.profile, 'stair', false, roofY)));
          if (circulation.landing) addSurface(`${id}/atrium-stairs/landing`, roomId, circulation.landing.bounds, flat(circulation.landing.y), 'landing', false, roofY).edges = 'guarded';
          const lowRun = runs.at(-1)!, lastLeg = circulation.legs.at(-1)!, end = lastLeg.startY < lastLeg.endY ? lowRun[0]! : lowRun.at(-1)!;
          const exit = circulation.exit, lowerId = regionalCellId(gx, gz, atrium.lower);
          topology.connections.push({ id: `${id}/stairs-exit`, from: end.id, to: atriumGroundId(lowerId, b, lower, atrium, exit.x, exit.z),
            at: rectCenter(end.bounds), arrival: exit, width: 3.2, kind: 'stairs', direction: 'both', access: 'open', toOwner: { ...owner, story: atrium.lower } });
          spatial.landmarks.push({ kind: `escalier-${atrium.variant.toLowerCase()}`, position: { x: rectCenter(circulation.legs[0]!.bounds).x, y: h + .865, z: circulation.legs[0]!.bounds.minZ - .5 }, destination: { ...exit, y: exit.y + .865 }, owner: { ...owner, story: atrium.lower } });

        }
        spatial.ceilings.push({ id: `${id}/atrium-roof`, roomId, ownerStory: owner.story, layer: `regional/${owner.story}`, role: 'floor', bounds: b, profile: flat(roofY + .03),
          ceilingY: roofY, thickness: .03, support: 'slab', access: 'sealed', edges: 'architecture' });
        spatial.landmarks.push({ kind: `galerie-${atrium.variant.toLowerCase()}`, position: { x: p.x, y: h + .865, z: b.minZ + 1.5 } });
        const viewAt = { x: b.minX + 1.5, z: p.z };
        topology.connections.push({ id: `${id}/overlook`, from: `${id}/gallery-0`, to: atriumGroundId(regionalCellId(gx, gz, atrium.lower), b, lower, atrium, viewAt.x, viewAt.z), at: viewAt,
          arrival: { ...viewAt, y: lower }, width: 3, kind: 'view', direction: 'forward', access: 'open', toOwner: { ...owner, story: atrium.lower } });

      } else if (mode === 'lower-maze') {
        atriumGround(b, h, atrium).forEach((part, i) => addSurface(`${id}/floor${i ? `-${i}` : ''}`, roomId, part.bounds, flat(h), 'floor', false, part.ceilingY));
        for (const [i, step] of atriumTreads(b, h + 10.8, atrium).entries()) {
          const y = step.profile.kind === 'flat' ? step.profile.y : Math.min(step.profile.startY, step.profile.endY);
          if (y - .16 - h < 2.5 && y - .16 > h) addPrism(profilePrism(`${id}/enclosed-stair-support-${i}`, step.bounds, flat(h - .16), flat(y - .16)));
        }
      }
      else {
        // The middle address contains four real window sills. They stop at the
        // void, with no reciprocal route and no invented ramp below them.
        for (const side of sides) {
          const axis = side === 'north' || side === 'south' ? 'z' : 'x', sign = side === 'north' || side === 'west' ? -1 : 1;
          const sill: Rect = axis === 'x' ? { minX: sign < 0 ? b.minX : b.maxX - 1.5, maxX: sign < 0 ? b.minX + 1.5 : b.maxX, minZ: p.z - 2, maxZ: p.z + 2 }
            : { minZ: sign < 0 ? b.minZ : b.maxZ - 1.5, maxZ: sign < 0 ? b.minZ + 1.5 : b.maxZ, minX: p.x - 2, maxX: p.x + 2 };
          const s = addSurface(`${id}/window-${side}`, roomId, sill, flat(h), 'landing', false, roofY);
          const arrival = { x: p.x + (axis === 'x' ? sign * 10 : 0), y: h - 5.4, z: p.z + (axis === 'z' ? sign * 10 : 0) };
          topology.connections.push({ id: `${id}/drop-${side}`, from: s.id, to: atriumGroundId(regionalCellId(gx, gz, atrium.lower), b, h - 5.4, atrium, arrival.x, arrival.z), at: rectCenter(sill), arrival,
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

    // Restore the actual BSP shapes, opening distributions and architectural
    // details. The regional plan supplies final datums and protected routes.
    if (mode === 'rooms' || mode === 'lower-maze') {
      const protectedRoutes: Rect[] = [];
      if (mode === 'lower-maze') {
        protectedRoutes.push({ ...b, minX: p.x - 2.2, maxX: p.x + 2.2 }, { ...b, minZ: p.z - 2.2, maxZ: p.z + 2.2 });
        if (atrium?.stairs) {
          const circulation = atriumCirculation(b, h + 10.8, atrium);
          protectedRoutes.push(...circulation.legs.map(l => expand(l.bounds, .5)));
          protectedRoutes.push(expand({ minX: circulation.exit.x - 1.6, maxX: circulation.exit.x + 1.6, minZ: circulation.exit.z - 1.6, maxZ: circulation.exit.z + 1.6 }, .4));
        }
        for (const floor of topology.surfaces.filter(s => s.roomId === roomId && s.role === 'floor')) {
          const c = rectCenter(floor.bounds); protectedRoutes.push({ minX: c.x - .6, maxX: c.x + .6, minZ: c.z - .6, maxZ: c.z + .6 });
        }
      } else for (const side of sides) {
        const [dx, dz] = deltas[side];
        if (Math.abs(regionalDatum(seed, gx + dx, gz + dz).y - h) < .001) continue;
        protectedRoutes.push(dx ? { ...b, minX: dx < 0 ? b.minX : p.x - 3, maxX: dx < 0 ? p.x + 3 : b.maxX, minZ: p.z - 3.2, maxZ: p.z + 3.2 }
          : { ...b, minZ: dz < 0 ? b.minZ : p.z - 3, maxZ: dz < 0 ? p.z + 3 : b.maxZ, minX: p.x - 3.2, maxX: p.x + 3.2 });
      }
      const normal = family === 'maze' || mode === 'lower-maze';
      const parts = normal ? template.rooms.flatMap(r => { const bounds = intersect(move(r.bounds), b); return bounds ? [{ source: r, bounds, id: `${id}/bsp/${r.id}` }] : []; })
        : [{ source: { ...world.rooms.at(-1)!, kind: 'open-hall' as const, ceilingHeight: 2.74, id: 'hall' }, bounds: b, id: `${id}/hall` }];
      world.rooms = world.rooms.filter(r => r.id !== roomId);
      for (const part of parts) world.rooms.push({ ...part.source, id: part.id, bounds: part.bounds, floorY: h,
        ceilingHeight: mode === 'lower-maze' ? roofY : h + part.source.ceilingHeight, structuralCeilingY: mode === 'lower-maze' ? roofY : h + part.source.ceilingHeight, access: 'open' });
      const roomAt = (x: number, z: number) => parts.find(r => pointInRect(x, z, r.bounds, -.001));
      const addArchitecture = (name: string, bounds: Rect, height: number, bottom = 0, tint = 1) => {
        for (const [i, piece] of cutRects([bounds], protectedRoutes).entries()) wall(`${id}/bsp/${name}/${i}`, piece, h + bottom, h + height, tint);
      };
      if (normal) {
        for (const w of template.walls) {
          const bounds = intersect(move({ minX: w.x - (w.orientation === 'x' ? w.length : w.thickness) / 2, maxX: w.x + (w.orientation === 'x' ? w.length : w.thickness) / 2,
            minZ: w.z - (w.orientation === 'z' ? w.length : w.thickness) / 2, maxZ: w.z + (w.orientation === 'z' ? w.length : w.thickness) / 2 }), b);
          if (!bounds) continue;
          const adjacent = parts.filter(r => overlapRect(expand(bounds, .02), r.bounds));
          const top = w.bottom < .1 && w.height < 2.64 ? w.bottom + w.height : Math.max(2.74, ...adjacent.map(r => Math.min(mode === 'lower-maze' ? 2.74 : 4.35, r.source.ceilingHeight)));
          addArchitecture(w.id, bounds, top, w.bottom, w.tint);
        }
        if (mode === 'rooms') {
          for (const [i, mass] of template.solidMasses.entries()) { const r = intersect(move(mass.bounds), b); if (r) addArchitecture(`mass-${i}`, r, roomAt(rectCenter(r).x, rectCenter(r).z)?.source.ceilingHeight ?? 2.74); }
          for (const [i, c] of template.columns.entries()) { const r = intersect(move({ minX: c.x - c.width / 2, maxX: c.x + c.width / 2, minZ: c.z - c.depth / 2, maxZ: c.z + c.depth / 2 }), b); if (r) addArchitecture(`column-${i}`, r, Math.min(c.height, 4.35)); }
        }
      } else if (family === 'pillars') for (const sx of [-1, 1]) for (const sz of [-1, 1]) addArchitecture(`pillar-${sx}-${sz}`, { minX: p.x + sx * 7 - .7, maxX: p.x + sx * 7 + .7, minZ: p.z + sz * 7 - .7, maxZ: p.z + sz * 7 + .7 }, 2.74);

      if (mode === 'rooms') {
        const old = topology.surfaces.filter(s => s.id.startsWith(`${id}/floor`));
        topology.surfaces = topology.surfaces.filter(s => !old.includes(s));
        spatial.ceilings = spatial.ceilings.filter(s => !old.some(o => s.id === `${o.id}/ceiling`));
        for (const [i, base] of old.entries()) for (const [j, r] of parts.entries()) {
          const bounds = intersect(base.bounds, r.bounds); if (bounds) addSurface(`${id}/floor-${i}/bsp-${j}`, r.id, bounds, flat(h), 'floor', true, h + r.source.ceilingHeight);
        }
      }
      const lightBlocked = (x: number, z: number) => world.walls.some(w => w.bottom <= h + .1 && w.height > 1.8 && Math.abs(w.x - x) < (w.orientation === 'x' ? w.length : w.thickness) / 2 + .8 && Math.abs(w.z - z) < (w.orientation === 'z' ? w.length : w.thickness) / 2 + .8);
      if (mode === 'rooms') {
        for (const l of template.lights) {
          const x = l.x + shift.x, z = l.z + shift.z, room = roomAt(x, z);
          if (!room || !pointInRect(x, z, b, -.001) || lightBlocked(x, z) || protectedRoutes.some(r => pointInRect(x, z, r, -.1))) continue;
          world.lights.push({ ...l, id: `${id}/${l.id}`, x, z, roomId: room.id, ceilingY: h + (normal ? l.ceilingY : 2.74) });
        }
        for (const socket of template.detailSockets) {
          const x = socket.position.x + shift.x, z = socket.position.z + shift.z, room = roomAt(x, z);
          if (room && !protectedRoutes.some(r => pointInRect(x, z, r))) world.detailSockets.push({ ...socket, id: `${id}/${socket.id}`, roomId: room.id, position: { x, z, y: h } });
        }
        for (const f of normal ? template.features : []) if (f.kind === 'interactive-door') {
          const bounds = move(f.bounds), x = f.position.x + shift.x, z = f.position.z + shift.z, room = roomAt(x, z);
          if (!room || !pointInRect(x, z, b, .9) || protectedRoutes.some(r => overlapRect(r, bounds))) continue;
          const source = parts.find(r => r.source.id === f.sourceRoomId), target = parts.find(r => r.source.id === f.targetRoomId); if (!source || !target) continue;
          const feature = { ...f, id: `${id}/${f.id}`, colliderId: `${id}/${f.colliderId}`, bounds, position: { x, z, y: h }, sourceRoomId: source.id, targetRoomId: target.id };
          world.features.push(feature);
          world.colliders.push({ id: feature.colliderId, kind: 'wall', center: { x, z, y: h + f.height / 2 }, halfExtents: { x: f.orientation === 'x' ? f.width / 2 : .06, y: f.height / 2, z: f.orientation === 'z' ? f.width / 2 : .06 } });
        }
      } else {
        // Wall-to-wall beams are anchored in the atrium facades, with their
        // entire envelope excluded from the full stair circulation.
        for (const sz of [-1, 1]) {
          const beam = { ...b, minZ: p.z + sz * 8 - .12, maxZ: p.z + sz * 8 + .12 };
          if (protectedRoutes.filter(r => rectWidth(r) < 10 && rectDepth(r) > 10).some(r => overlapRect(r, beam) && atrium?.stairs && atriumCirculation(b, h + 10.8, atrium).legs.some(l => overlapRect(l.bounds, beam)))) continue;
          addPrism(profilePrism(`${id}/fixture-beam-${sz}`, beam, flat(h + 2.74), flat(h + 2.96), 'plaster'));
          for (const sx of [-1, 1]) { const x = p.x + sx * 8, z = p.z + sz * 8, room = roomAt(x, z); if (room && !lightBlocked(x, z)) world.lights.push({ id: `${id}/lower-light-${sx}-${sz}`, x, z, roomId: room.id, ceilingY: h + 2.74, width: 1.55, rotation: 0, intensity: 1.08, color: 0xffffe4, dead: false, unstable: false, phase: 0, level: 0 }); }
        }
      }
    } else if (mode === 'gallery') {
      for (const x of [b.minX + 1.5, b.maxX - 1.5]) for (const z of [b.minZ + 1.5, b.maxZ - 1.5])
        world.lights.push({ id: `${id}/high-light/${x}/${z}`, x, z, ceilingY: roofY, width: 1.55, rotation: 0, intensity: 1.08, color: 0xffffe4, dead: false, unstable: false, phase: 0, roomId, level: 0 });
    }

    // Each side owns its interior half of a common wall. At a district
    // boundary the vertical facade is partitioned by address, not stretched
    // once per room; its opening is at the actual shared connector datum.
    for (const side of sides) {
      const [dx, dz] = deltas[side], alongX = dz !== 0, otherH = regionalDatum(seed, gx + dx, gz + dz).y, portalY = (h + otherH) / 2;
      const neighborAtrium = regionalAtrium(seed, gx + dx, gz + dz, owner.story);
      if (mode === 'rooms' && !neighborAtrium && regionalDatum(seed, gx + dx, gz + dz).id === datum.id) continue;
      const min = alongX ? b.minX : b.minZ, max = alongX ? b.maxX : b.maxZ, mid = alongX ? p.x : p.z;
      const sideBounds = (lo: number, hi: number): Rect => alongX ? { minX: lo, maxX: hi, minZ: side === 'north' ? b.minZ : b.maxZ - wallHalf, maxZ: side === 'north' ? b.minZ + wallHalf : b.maxZ }
        : { minZ: lo, maxZ: hi, minX: side === 'west' ? b.minX : b.maxX - wallHalf, maxX: side === 'west' ? b.minX + wallHalf : b.maxX };
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

  const carve = (source: typeof world.walls[number], aperture: Rect) => {
    if (!world.walls.includes(source)) return;
    const bounds = { minX: source.x - (source.orientation === 'x' ? source.length : source.thickness) / 2, maxX: source.x + (source.orientation === 'x' ? source.length : source.thickness) / 2,
      minZ: source.z - (source.orientation === 'z' ? source.length : source.thickness) / 2, maxZ: source.z + (source.orientation === 'z' ? source.length : source.thickness) / 2 };
    world.walls = world.walls.filter(w => w !== source); world.colliders = world.colliders.filter(c => c.id !== source.id); spatial.prisms = spatial.prisms.filter(p => p.id !== source.id);
    cutRects([bounds], [aperture]).forEach((b, i) => wall(`${source.id}/regional-door-${i}`, b, source.bottom, source.bottom + source.height, source.tint));
  };

  for (const surface of [...topology.surfaces, ...spatial.ceilings]) {
    if (world.rooms.some(r => r.id === surface.roomId)) continue;
    const p = rectCenter(surface.bounds), room = world.rooms.find(r => pointInRect(p.x, p.z, r.bounds, -.001) && Math.abs((r.floorY ?? 0) - surfaceRange(surface)[0]) < 12);
    if (room) surface.roomId = room.id;
  }
  const rawSurfaces = topology.surfaces;
  const rebuildFloors = () => {
    const floorCuts = world.walls.filter(w => w.height > 1.8).map(w => ({ bounds: { minX: w.x - (w.orientation === 'x' ? w.length : w.thickness) / 2, maxX: w.x + (w.orientation === 'x' ? w.length : w.thickness) / 2,
      minZ: w.z - (w.orientation === 'z' ? w.length : w.thickness) / 2, maxZ: w.z + (w.orientation === 'z' ? w.length : w.thickness) / 2 }, bottom: w.bottom, top: w.bottom + w.height }));
    topology.surfaces = rawSurfaces.flatMap(s => !s.id.includes('/bsp-') || s.role !== 'floor' ? [s] : cutRects([s.bounds], floorCuts.filter(c => c.bottom < surfaceRange(s)[0] + .05 && c.top > surfaceRange(s)[0] + .1).map(c => c.bounds))
      .map((bounds, i) => ({ ...s, id: `${s.id}/clear-${i}`, bounds })));
    topology.connections = topology.connections.filter(c => !c.id.startsWith('join/'));
  };
  stitchBspPartitions(world, rebuildFloors, () => connectSpatialSurfaces(world), carve);
  rebuildFloors();

  world.unlitZones = [];
  for (const zone of template.unlitZones ?? []) {
    const moved = move(zone);
    for (const cell of spatial.cells.filter(c => c.mode === 'rooms')) { const bounds = intersect(moved, cell.bounds); if (bounds) world.unlitZones.push(bounds); }
  }
  for (const light of world.lights) if (world.unlitZones.some(r => pointInRect(light.x, light.z, r))) light.dead = true;

  world.baseboardlessZones = (template.baseboardlessZones ?? []).map(move);
  for (const w of world.walls.filter(w => w.id.includes('/bsp/') && w.height > 1.8)) {
    const room = world.rooms.find(r => pointInRect(w.x, w.z, r.bounds, -.001));
    if (!room || w.bottom > (room.floorY ?? 0) + .05 || world.baseboardlessZones.some(z => pointInRect(w.x, w.z, z))) continue;
    const alongX = w.orientation === 'x', y = room.floorY ?? w.bottom;
    for (const side of [-1, 1]) {
      const cross = (alongX ? w.z : w.x) + side * (w.thickness / 2 + .015);
      const bounds = alongX ? { minX: w.x - w.length / 2, maxX: w.x + w.length / 2, minZ: cross - .015, maxZ: cross + .015 }
        : { minZ: w.z - w.length / 2, maxZ: w.z + w.length / 2, minX: cross - .015, maxX: cross + .015 };
      addPrism({ ...profilePrism(`${w.id}/baseboard-${side}`, bounds, flat(y), flat(y + .12), 'baseboard'), collision: false, tint: w.tint });
    }
  }

  world.lights = world.lights.filter(light => !world.walls.some(w => w.bottom < light.ceilingY + .12 && w.bottom + w.height > light.ceilingY - .25
    && lightPanelOverlapsRect(light, { minX: w.x - (w.orientation === 'x' ? w.length : w.thickness) / 2, maxX: w.x + (w.orientation === 'x' ? w.length : w.thickness) / 2,
      minZ: w.z - (w.orientation === 'z' ? w.length : w.thickness) / 2, maxZ: w.z + (w.orientation === 'z' ? w.length : w.thickness) / 2 })));

  // Only exposed gallery edges receive parapets; keep the stair entry and exit
  // open. Subtract all same-height neighbours so bridges never get end barriers.
  for (const s of topology.surfaces.filter(s => s.role === 'balcony' || s.role === 'bridge' || s.edges === 'guarded')) {
    const b = s.bounds, y = surfaceRange(s)[0];
    for (const [edgeName, axis, fixed, min, max] of [['north', 'x', b.minZ, b.minX, b.maxX], ['south', 'x', b.maxZ, b.minX, b.maxX], ['west', 'z', b.minX, b.minZ, b.maxZ], ['east', 'z', b.maxX, b.minZ, b.maxZ]] as const) {
      if (s.openEdges?.includes(edgeName)) continue;
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
      const rail = fixed + (edgeName === 'north' || edgeName === 'west' ? .06 : -.06);
      intervals.forEach((g, i) => wall(`${s.id}/parapet/${axis}/${fixed}/${i}`, axis === 'x'
        ? { minX: g.min, maxX: g.max, minZ: rail - .06, maxZ: rail + .06 }
        : { minZ: g.min, maxZ: g.max, minX: rail - .06, maxX: rail + .06 }, y, y + 1.05));
    }
  }

  for (const s of topology.surfaces) {
    const roofs = topology.surfaces.filter(o => (o.role === 'bridge' || o.role === 'balcony') && o !== s && overlapRect(o.bounds, s.bounds) && surfaceRange(o)[0] > surfaceRange(s)[1] + .2);
    if (roofs.length) { const y = Math.min(...roofs.map(o => surfaceRange(o)[0] - o.thickness)); s.ceilingY = Math.min(s.ceilingY, y); s.ceilingProfile = flat(s.ceilingY); }
  }
  if (boundaryGates) for (const side of sides) for (const gate of boundaryGates[side]) {
    const [dx, dz] = deltas[side], alongX = dx !== 0;
    const position = { x: alongX ? dx * 56 : gate.offset, y: gate.floorY, z: alongX ? gate.offset : dz * 56 };
    const inside = { x: position.x - dx * .02, z: position.z - dz * .02, referenceY: position.y, maxAbove: .2, maxBelow: .2 };
    const support = findSurface(world, inside); if (!support) { topology.diagnostics.push({ id: `interface/${side}/${gate.offset}`, reason: 'missing boundary support' }); continue; }
    const node = `interface/${Math.round((position.x + offset.x) * 1000)}/${Math.round((position.z + offset.z) * 1000)}/${owner.story}`;
    const neighbor = { x: owner.x + dx, z: owner.z + dz, story: owner.story };
    spatial.interfaces.push({ id: node, side, surfaceId: support.id, position, width: gate.width, neighbor });
    topology.connections.push({ id: `${support.id}/external-${side}`, from: support.id, to: node, at: { x: inside.x, z: inside.z }, width: gate.width, kind: 'walk', direction: 'both', access: 'open',
      targetKind: 'portal', toOwner: neighbor, arrival: { x: position.x + dx * .1, y: position.y, z: position.z + dz * .1 } });
  }
  connectSpatialSurfaces(world);
  world.colliders.push(...topology.surfaces.map(s => s.role === 'floor' ? slabMeshCollider(s) : surfaceCollider(s)), ...spatial.ceilings.map(s => ({ ...surfaceCollider(s), id: s.id, kind: 'barrier' as const })));
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
    const lo = Math.max(a.min, b.min), hi = Math.min(a.max, b.max); if (hi - lo < .08) continue;
    const p = a.axis === 'x' ? { x: (lo + hi) / 2, z: a.fixed } : { z: (lo + hi) / 2, x: a.fixed };
    const delta = Math.abs(surfaceY(a.s, p.x, p.z) - surfaceY(b.s, p.x, p.z)); if (delta > .19) continue;
    // The rectangles are a tessellation, not separate rooms with solid
    // corners. Erode real walls below, not artificial slab endpoints: doing
    // both isolated valid floor around T-junctions after BSP clipping.
    let gaps = [{ min: lo, max: hi }];
    const foot = Math.max(surfaceY(a.s, p.x, p.z), surfaceY(b.s, p.x, p.z));
    for (const c of world.colliders) {
      if (c.kind !== 'wall' || c.center.y + c.halfExtents.y < foot + .05 || c.center.y - c.halfExtents.y > foot + 1.75) continue;
      const cross = a.axis === 'x' ? c.center.z : c.center.x, crossHalf = a.axis === 'x' ? c.halfExtents.z : c.halfExtents.x;
      if (Math.abs(cross - a.fixed) > crossHalf + .34) continue;
      const along = a.axis === 'x' ? c.center.x : c.center.z, half = (a.axis === 'x' ? c.halfExtents.x : c.halfExtents.z) + .34;
      gaps = gaps.flatMap(g => along + half <= g.min || along - half >= g.max ? [g] : [{ min: g.min, max: Math.min(g.max, along - half) }, { min: Math.max(g.min, along + half), max: g.max }].filter(g => g.max - g.min > .08));
    }
    for (const [k, g] of gaps.entries()) {
      const at = a.axis === 'x' ? { x: (g.min + g.max) / 2, z: a.fixed } : { z: (g.min + g.max) / 2, x: a.fixed };
      const kind = delta > .002 || a.s.role === 'stair' || b.s.role === 'stair' ? 'stairs'
        : a.s.locomotion === 'crouch' || b.s.locomotion === 'crouch' ? 'crouch'
        : a.s.profile.kind === 'linear' || b.s.profile.kind === 'linear' ? 'ramp' : 'walk';
      links.push({ id: `join/${a.s.id}/${b.s.id}/${k}`, from: a.s.id, to: b.s.id, at, width: g.max - g.min + .68, kind, direction: 'both', access: 'open' });
    }
  }
  for (const door of world.features) if (door.kind === 'interactive-door') {
    const alongX = door.orientation === 'x', d = (alongX ? door.bounds.maxZ - door.bounds.minZ : door.bounds.maxX - door.bounds.minX) / 2 + .4;
    const ends = [-1, 1].map(sign => findSurface(world, { x: door.position.x + (alongX ? 0 : sign * d), z: door.position.z + (alongX ? sign * d : 0), referenceY: door.position.y, maxAbove: .05, maxBelow: .05 }));
    if (ends[0] && ends[1] && ends[0] !== ends[1]) links.push({ id: `join/door/${door.id}`, from: ends[0].id, to: ends[1].id,
      at: { x: door.position.x, z: door.position.z }, width: door.width, kind: 'walk', direction: 'both', access: 'open', requiresDoorId: door.id });
  }
  t.connections.push(...links);
};
