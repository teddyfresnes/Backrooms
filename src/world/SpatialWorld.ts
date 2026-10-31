import { completeCeilingEnvelope } from './CeilingEnvelope';
import { installLiminalAtrium } from './LiminalAtrium';
import { installOrdinaryArchitecture, connectArchitecturalOpenings } from './LiminalArchitecture';
import { createSpatialBaseboards } from './SpatialBaseboards';
import { cleanSpatialWallJunctions } from './SpatialWallJunctions';
import { closeSpatialFloorContacts } from './SpatialFloorContacts';
import { spatialTemplate, clearSpatialTemplates, transitionHost } from './SpatialTemplates';
import { applySpatialRelief } from './SpatialRelief';
import { reconcileStructuralSupports } from './StructuralSupports';
import { atriumEntryLightPoints, atriumSection, atriumSupportBands } from './AtriumEnvelope';
import { installSteppedAtrium } from './SteppedAtrium';
import { clearSpatialFeatureCache, planSpatialFeature, installSpatialFeature, connectSpatialFeatures, type SpatialFeatureSlice } from './SpatialFeatures';
import { planRegionalTransition, fitTransitionEnvironment, transitionRoofBounds, restrictProfile } from './TransitionLayout';
import { completeOpenTransitionEnvelope } from './OpenTransitionEnvelope';
import { transitionSurfaces } from './TransitionSurfaces';
import { stitchBspPartitions } from './BspConnectivity';
import { lightPanelOverlapsRect } from './generateWorld';
import type { Rect, SurfaceStyle, WallSegment, WorldPlan } from './types';
import { pointInRect, rectCenter, rectDepth, rectWidth } from './types';
import { ADDRESS_PITCH, hasRegionalTransition, regionalAtrium, regionalCellId, regionalDatum, regionalStyle, SPATIAL_CLEARANCE, spatialCellBounds } from './RegionalPlan';
import type { SpatialAddress, SpatialPrism } from './SpatialTypes';
import type { InfiniteEdgeGates } from './InfiniteWorld';
import { atriumCirculation, atriumGround, atriumGroundId, atriumTreads, atriumStairPocket, enclosedAtriumLanding, legTreads, atriumLandingPads, atriumArrival } from './SpatialConnectors';
import { endpointStairRun, offsetProfile, prismCollider, profilePrism, slabMeshCollider } from './SpatialGeometry';
import { classifySurfaceAccess, cutRects, findSurface, overlapRect, surfaceCollider, surfaceRange, surfaceY, TOPOLOGY_VERSION,
  type HeightProfile, type SurfaceConnection, type WalkableSurface } from './WalkableTopology';

const sides = ['north', 'east', 'south', 'west'] as const;
type Side = typeof sides[number];
const deltas: Record<Side, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const flat = (y: number): HeightProfile => ({ kind: 'flat', y });
export const clearBspArchitectureCache = (): void => { clearSpatialTemplates(); clearSpatialFeatureCache(); };
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
  const world: WorldPlan = { version: 18, seed, size: 112, wallHeight: 3.05, rooms: [], walls: [], columns: [], solidMasses: [], lights: [], missingCeilingTiles: [],
    features: [], detailSockets: [], colliders: [], floorRects: [], floorOpenings: [], ceilingOpenings: [], stairCeilingOpenings: [], spawn: { x: 0, y: 0, z: 0 }, surfaceStyle: style, edgeGates: boundaryGates,
    topology: { version: TOPOLOGY_VERSION, ownerStory: owner.story, surfaces: [], connections: [], volumes: [], diagnostics: [] },
    spatial: { version: 2, owner: { ...owner }, cells: [], ceilings: [], prisms: [], dependencies: [], interfaces: [], landmarks: [], transitions: [] } };
  const topology = world.topology!, spatial = world.spatial!;
  const featureSlices: SpatialFeatureSlice[] = [];
  const mx = Math.floor(owner.x / 2), mz = Math.floor(owner.z / 2);
  const template = spatialTemplate(seed, owner.x, owner.z, owner.story);
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
  const wall = (id: string, bounds: Rect, bottom: number, top: number, tint = 1, detail?: WallSegment['detail'], junctionRole?: WallSegment['junctionRole']) => {
    if (top <= bottom + .005 || rectWidth(bounds) < .005 || rectDepth(bounds) < .005) return;
    const apertures = boundaryClearances.filter(c => c.bottom < top && c.top > bottom && overlapRect(c.bounds, bounds));
    const parts = cutRects([bounds], apertures.map(a => a.bounds)).map(b => ({ bounds: b, bottom, top }));
    for (const a of apertures) if (top > a.top + .005) parts.push({ bounds: { minX: Math.max(bounds.minX, a.bounds.minX), maxX: Math.min(bounds.maxX, a.bounds.maxX), minZ: Math.max(bounds.minZ, a.bounds.minZ), maxZ: Math.min(bounds.maxZ, a.bounds.maxZ) }, bottom: Math.max(bottom, a.top), top });
    for (const [i, part] of parts.entries()) {
      const b = part.bounds, name = apertures.length ? `${id}/aperture-${i}` : id;
      addPrism({ ...profilePrism(name, b, flat(part.bottom), flat(part.top)), tint });
      const alongX = rectWidth(b) > rectDepth(b), p = rectCenter(b);
      world.walls.push({ id: name, x: p.x, z: p.z, orientation: alongX ? 'x' : 'z', length: alongX ? rectWidth(b) : rectDepth(b), thickness: alongX ? rectDepth(b) : rectWidth(b),
        bottom: part.bottom, height: part.top - part.bottom, tint, collision: true, kind: 'wallpaper', ...(detail ? { detail } : {}), ...(junctionRole ? { junctionRole } : {}) });
    }
  };
  const dependency = (story: number, bounds: Rect, bottom: number, top: number, reason: 'atrium' | 'stairs' | 'drop' | 'view') => {
    if (story === owner.story) return;
    spatial.dependencies.push({ owner: { ...owner, story }, bounds, bottom, top, reason });
  };

  const processedAtria = new Set<string>();
  for (let iz = 0; iz < 4; iz++) for (let ix = 0; ix < 4; ix++) {
    let gx = owner.x * 4 + ix, gz = owner.z * 4 + iz;
    const datum = regionalDatum(seed, gx, gz), h = datum.y, atrium = regionalAtrium(seed, gx, gz, owner.story);
    let b = local(spatialCellBounds(gx, gz));
    if (atrium) {
      gx = atrium.anchorX; gz = atrium.anchorZ;
      const key = `${gx}/${gz}`; if (processedAtria.has(key)) continue; processedAtria.add(key);
      const first = spatialCellBounds(gx, gz), last = spatialCellBounds(gx + atrium.cellsX - 1, gz + atrium.cellsZ - 1);
      b = local({ minX: first.minX, minZ: first.minZ, maxX: last.maxX, maxZ: last.maxZ });
    }
    const id = regionalCellId(gx, gz, owner.story), p = rectCenter(b);
    const { family, wallHalf } = regionalStyle(seed, datum.id);
    const mode = !atrium ? 'rooms' : owner.story === atrium.owner ? 'gallery' : owner.story === atrium.lower ? 'lower-maze' : atrium.perimeter === 'stepped' ? 'terrace' : 'void';
    const roofY = atrium ? h + (atrium.owner - owner.story) * ADDRESS_PITCH + SPATIAL_CLEARANCE : h + SPATIAL_CLEARANCE;
    const roomId = `${id}/room`;
    spatial.cells.push({ id, regionId: datum.id, bounds: b, floorY: h, mode, ...(atrium ? { atriumOwner: atrium.owner, atriumLower: atrium.lower, atriumPerimeter: atrium.perimeter } : {}) });
    world.rooms.push({ id: roomId, bounds: b, kind: mode === 'lower-maze' ? 'lower-maze' : mode === 'gallery' ? 'pit-gallery' : family === 'maze' ? 'corridor' : 'open-hall', level: 0,
      floorY: h, ceilingHeight: roofY, structuralCeilingY: roofY, baseboards: true, detailDensity: mode === 'void' ? 0 : .25, access: 'open' });
    const heritage = !atrium ? planSpatialFeature(seed, gx, gz, owner.story, b) : undefined;
    if (heritage) featureSlices.push(heritage);
    const routeReservations: Rect[] = heritage ? [expand(heritage.reservation, .8)] : [];
    if (atrium?.liminal) {
      installLiminalAtrium(world, id, roomId, b, atrium, h, (name, bounds, profile, role, ceiling) => addSurface(name, roomId, bounds, profile, role, false, ceiling));
    } else if (atrium) {
      for (let story = atrium.lower; story <= atrium.owner; story++) dependency(story, b, h + (atrium.lower - owner.story) * 5.4, roofY, 'atrium');
      const hole = atriumSection(b, atrium, owner.story).hole;
      const pockets = owner.story === atrium.lower ? atriumStairPocket(b, h + (atrium.owner - owner.story) * 5.4, atrium) : [];
      for (const [i, band] of atriumSupportBands(b, atrium, owner.story, h, pockets).entries())
        wall(`${id}/tier-support-${band.tier}/${i}`, band.bounds, band.bottom, band.top);
      const enclosedLanding = enclosedAtriumLanding(b, h + (atrium.owner - owner.story) * 5.4, atrium);
      if (enclosedLanding) wall(`${id}/filled-ramp-landing`, enclosedLanding.bounds, h - .16, Math.min(h + 5.24, enclosedLanding.y - .27));
      // Open facade entries reveal real neighbouring columns at every level.
      for (const side of sides) {
        const [dx, dz] = deltas[side];
        const boundary = side === 'west' ? b.minX : side === 'east' ? b.maxX : side === 'north' ? b.minZ : b.maxZ;
        if (Math.abs(Math.abs(boundary) - 56) > .001) continue;
        const bounds = dx ? { ...b, minX: boundary - .3, maxX: boundary + .3 } : { ...b, minZ: boundary - .3, maxZ: boundary + .3 };
        for (let story = atrium.lower; story <= atrium.owner; story++) spatial.dependencies.push({ owner: { x: owner.x + dx, z: owner.z + dz, story },
          bounds, bottom: h + (story - owner.story) * 5.4, top: h + (story - owner.story) * 5.4 + 3.05, reason: 'view' });
      }
      if (mode !== 'lower-maze') world.floorOpenings!.push(mode === 'void' ? { ...b } : hole);
      if (mode !== 'gallery') world.ceilingOpenings!.push({ ...b });
      if (atrium.perimeter === 'stepped' && mode !== 'lower-maze') {
        installSteppedAtrium(world, id, roomId, b, atrium, h, addSurface);
      } else if (mode === 'gallery') {
        const lower = h - (atrium.owner - atrium.lower) * ADDRESS_PITCH;
        const ring = cutRects([b], [hole]);
        ring.forEach((r, i) => addSurface(`${id}/gallery-${i}`, roomId, r, flat(h), 'balcony', false, roofY));
        // The bridge is supported at the real wall galleries at both ends.
        const circulation = atriumCirculation(b, h, atrium), bridge = circulation.bridge;
        if (atrium.variant === 'L' && atrium.owner - atrium.lower > 1) {
          const gap = b.minX + rectWidth(b) * .32;
          const west = addSurface(`${id}/bridge/jump-west`, roomId, { ...bridge, maxX: gap - .7 }, flat(h), 'bridge', false, roofY);
          const east = addSurface(`${id}/bridge/jump-east`, roomId, { ...bridge, minX: gap + .7 }, flat(h), 'bridge', false, roofY);
          west.openEdges = ['east']; east.openEdges = ['west'];
          const at = { x: gap - 1.3, z: rectCenter(bridge).z }, arrival = { x: gap + 1.3, y: h, z: at.z };
          topology.connections.push({ id: `${id}/bridge-jump`, from: west.id, to: east.id, at, arrival, width: 3.2, kind: 'jump', direction: 'both', access: 'open' });
          spatial.landmarks.push({ kind: 'saut-passerelle', position: { ...at, y: h + .865 }, destination: { ...arrival, y: h + .865 } });
        } else if (atrium.variant === 'bridge') addSurface(`${id}/bridge`, roomId, bridge, flat(h), 'bridge', false, roofY);
        if (atrium.variant === 'L' && atrium.owner - atrium.lower > 1) addSurface(`${id}/return`, roomId, { minX: p.x - 1.6, maxX: p.x + 1.6, minZ: hole.minZ, maxZ: bridge.minZ }, flat(h), 'balcony', false, roofY);
        // One full-width stair fits against the east wall, outside the upper ring.
        if (atrium.stairs) {
          const runs = circulation.legs.map(leg => legTreads(leg).map(step => {
            const sf = addSurface(`${id}/atrium-stairs/${leg.name}/step-${step.index}`, roomId, step.bounds, step.profile, leg.kind === 'ramp' ? 'ramp' : 'stair', false, roofY);
            sf.thickness = .27;
            if (leg.kind === 'ramp') { sf.support = 'solid'; sf.supportBottom = lower - .16; }
            return sf;
          }));
          if (circulation.landing) addSurface(`${id}/atrium-stairs/landing`, roomId, circulation.landing.bounds, flat(circulation.landing.y), 'landing', false, roofY).edges = 'guarded';
          const lowRun = runs.at(-1)!, lastLeg = circulation.legs.at(-1)!, end = lastLeg.startY < lastLeg.endY ? lowRun[0]! : lowRun.at(-1)!;
          const pad = atriumArrival(b, lower, atrium, circulation.exit.x, circulation.exit.z);
          const exit = { ...pad.point, y: lower }, lowerId = regionalCellId(gx, gz, atrium.lower);
          topology.connections.push({ id: `${id}/stairs-exit`, from: end.id, to: atriumGroundId(lowerId, b, lower, atrium, exit.x, exit.z),
            at: rectCenter(end.bounds), arrival: exit, width: 3.2, kind: 'stairs', direction: 'both', access: 'open', toOwner: { ...owner, story: atrium.lower } });
          const entry = circulation.legs[0]!, middle = rectCenter(entry.bounds);
          spatial.landmarks.push({ kind: `escalier-${atrium.variant.toLowerCase()}`, position: { x: entry.axis === 'x' ? entry.bounds.minX - .5 : middle.x,
            y: h + .865, z: entry.axis === 'z' ? entry.bounds.minZ - .5 : middle.z }, destination: { ...exit, y: exit.y + .865 }, owner: { ...owner, story: atrium.lower } });

        }
        spatial.ceilings.push({ id: `${id}/atrium-roof`, roomId, ownerStory: owner.story, layer: `regional/${owner.story}`, role: 'floor', bounds: b, profile: flat(roofY + .03),
          ceilingY: roofY, thickness: .03, support: 'slab', access: 'sealed', edges: 'architecture' });
        spatial.landmarks.push({ kind: `galerie-${atrium.variant.toLowerCase()}`, position: { x: p.x, y: h + .865, z: b.minZ + 1.5 } });
        const viewAt = { x: b.minX + 1.5, z: p.z }, viewArrival = atriumArrival(b, lower, atrium, viewAt.x, viewAt.z).point;
        topology.connections.push({ id: `${id}/overlook`, from: `${id}/gallery-0`, to: atriumGroundId(regionalCellId(gx, gz, atrium.lower), b, lower, atrium, viewAt.x, viewAt.z), at: viewAt,
          arrival: { ...viewArrival, y: lower }, width: 3, kind: 'view', direction: 'forward', access: 'open', toOwner: { ...owner, story: atrium.lower } });

      } else if (mode === 'lower-maze') {
        const pads = atriumLandingPads(b, h, atrium);
        atriumGround(b, h, atrium).forEach((part, i) => cutRects([part.bounds], pads.map(p => p.bounds)).forEach((bounds, j) =>
          addSurface(`${id}/floor${i ? `-${i}` : ''}/pad-cut-${j}`, roomId, bounds, flat(h), 'floor', false, part.ceilingY)));
        for (const pad of pads) {
          const ground = atriumGround(b, h, atrium).find(p => pointInRect(pad.point.x, pad.point.z, p.bounds, -.001));
          addSurface(`${id}/arrival-${pad.index}`, roomId, pad.bounds, flat(h), 'landing', false, ground?.ceilingY ?? roofY);
        }
        for (const [i, step] of atriumTreads(b, h + (atrium.owner - atrium.lower) * ADDRESS_PITCH, atrium).entries()) {
          if (step.profile.kind !== 'flat') continue;
          const y = step.profile.y;
          if (y - .27 - h < 2.5 && y - .27 > h) addPrism(profilePrism(`${id}/enclosed-stair-support-${i}`, step.bounds, flat(h - .16), flat(y - .27)));
        }
      }
      else {
        // The middle address contains four real window sills. They stop at the
        // void, with no reciprocal route and no invented ramp below them.
        for (const side of sides) {
          const axis = side === 'north' || side === 'south' ? 'z' : 'x', sign = side === 'north' || side === 'west' ? -1 : 1;
          const span = axis === 'x' ? rectDepth(b) : rectWidth(b), start = axis === 'x' ? b.minZ : b.minX;
          for (let i = 0; i < Math.round(span / 28); i++) {
            const cross = start + (i + .5) * 28;
            const depth = atrium.ringWidth;
            const sill: Rect = axis === 'x' ? { minX: sign < 0 ? b.minX : b.maxX - depth, maxX: sign < 0 ? b.minX + depth : b.maxX, minZ: cross - 2, maxZ: cross + 2 }
              : { minZ: sign < 0 ? b.minZ : b.maxZ - depth, maxZ: sign < 0 ? b.minZ + depth : b.maxZ, minX: cross - 2, maxX: cross + 2 };
            const suffix = `${i ? `${i}/` : ''}${side}`;
            const sf = addSurface(`${id}/window-${suffix}`, roomId, sill, flat(h), 'landing', false, h + 2.74);
            const from = { x: axis === 'x' ? sign < 0 ? sill.maxX - .85 : sill.minX + .85 : cross, z: axis === 'z' ? sign < 0 ? sill.maxZ - .85 : sill.minZ + .85 : cross };
            const desired = { x: from.x - (axis === 'x' ? sign * 2 : 0), z: from.z - (axis === 'z' ? sign * 2 : 0) }, lower = h - (owner.story - atrium.lower) * 5.4;
            const arrival = { ...atriumArrival(b, lower, atrium, desired.x, desired.z).point, y: lower };
            topology.connections.push({ id: `${id}/drop-${suffix}`, from: sf.id, to: atriumGroundId(regionalCellId(gx, gz, atrium.lower), b, lower, atrium, arrival.x, arrival.z), at: from, arrival,
              width: 4, kind: 'drop', direction: 'forward', access: 'open', toOwner: { ...owner, story: atrium.lower } });
            spatial.landmarks.push({ kind: 'ouverture-haute', position: { ...from, y: h + .865 }, destination: { ...arrival, y: arrival.y + .865 }, owner: { ...owner, story: atrium.lower } });
          }
        }
      }
    } else {
      const branchCuts: Rect[] = [];
      for (const side of sides) {
        const [dx, dz] = deltas[side], other = regionalDatum(seed, gx + dx, gz + dz);
        if (Math.abs(other.y - h) < .001 || !hasRegionalTransition(seed, gx, gz, side)) continue;
        const t = planRegionalTransition(seed, gx, gz, owner.story, side, b, h, other.y, `${id}/${side}/route`);
        const opposite = { north: 'south', south: 'north', east: 'west', west: 'east' } as const;
        const peer = planRegionalTransition(seed, gx + dx, gz + dz, owner.story, opposite[side], local(spatialCellBounds(gx + dx, gz + dz)), other.y, h, `${id}/peer`);
        const host = transitionHost(seed, gx, gz, owner.story, t, offset), target = transitionHost(seed, gx + dx, gz + dz, owner.story, peer, offset);
        fitTransitionEnvironment(t, host.ceilingY, target.ceilingY, host.walls.map((v, i) => Math.min(v, target.walls[i]!)), host.uniformRoof && target.uniformRoof);
        spatial.transitions!.push(t);
        branchCuts.push(t.bounds);
        routeReservations.push(expand(t.bounds, t.wallThickness + .9));
        world.rooms.push({ id: t.roomId, bounds: transitionRoofBounds(t), kind: 'corridor', level: 0,
          floorY: Math.min(t.startY, t.endY), ceilingHeight: Math.max(t.approachCeilingY, t.landingCeilingY),
          structuralCeilingY: Math.max(t.approachCeilingY, t.landingCeilingY), detailDensity: .1, access: 'open' });
        const geometry = transitionSurfaces(t, owner.story);
        topology.surfaces.push(...geometry.surfaces); spatial.ceilings.push(...geometry.ceilings);
        // Vertical piers and full-height side walls bear on the host floor or
        // the lower flight. No diagonal bottom leaves a hanging outer corner.
        for (const [name, bounds] of [['run', t.run], ['landing', t.landing.bounds]] as const) {
          if (rectWidth(bounds) < .005 || rectDepth(bounds) < .005) continue;
          for (const sign of t.enclosure === 'chamber' ? [-1, 1] : t.enclosure === 'wall' ? [t.wallSide!] : []) {
            const alongX = t.axis === 'x', width = t.wallThickness;
            const sideBounds = alongX ? { ...bounds, minZ: sign < 0 ? bounds.minZ - width : bounds.maxZ, maxZ: sign < 0 ? bounds.minZ : bounds.maxZ + width }
              : { ...bounds, minX: sign < 0 ? bounds.minX - width : bounds.maxX, maxX: sign < 0 ? bounds.minX : bounds.maxX + width };
            const r = sideBounds, corners = [[r.minX, r.minZ], [r.minX, r.maxZ], [r.maxX, r.maxZ], [r.maxX, r.minZ]];
            // A supported wall is a column, shared by disjoint owner bands.
            // The approach stays in the host room, without separate piers.
            const vertices = [true, false].flatMap(top => corners.flatMap(([x, z]) => [x!, top ? h + ADDRESS_PITCH - .16 : h - .16, z!]));
            addPrism({ id: `${t.id}/${name}/side-${sign}/0`, vertices, material: 'wall', collision: true });
          }
        }
        const low = Math.min(t.startY, t.endY), high = Math.max(t.approachCeilingY, t.landingCeilingY);
        for (let delta = Math.floor((low - h) / ADDRESS_PITCH); delta <= Math.floor((high - h + .19) / ADDRESS_PITCH); delta++)
          dependency(owner.story + delta, expand(t.bounds, t.wallThickness), low - .16, high + .03, 'stairs');
        // An open side reveals the real flight/rooms below. Keep their owner
        // available rather than adding a fake floor across the vertical route.
        if (t.enclosure !== 'chamber') dependency(owner.story - 1, expand(t.bounds, .6), low - ADDRESS_PITCH - .16, high - ADDRESS_PITCH, 'view');
        if (t.roofPolicy === 'upper-slab') dependency(owner.story + 1, expand(t.bounds, .6), low + ADDRESS_PITCH - .27, high + .16, 'stairs');
        const center = rectCenter(t.roofPolicy === 'upper-slab' && t.kind === 'stairs' ? t.approach.bounds : t.run);
        const middle = topology.surfaces.find(s => s.roomId === t.roomId && pointInRect(center.x, center.z, s.bounds))!;
        const roof = surfaceY({ bounds: middle.bounds, profile: middle.ceilingProfile! } as WalkableSurface, center.x, center.z);
        world.lights.push({ id: `${t.id}/light`, x: center.x, z: center.z, roomId: t.roomId, ceilingY: roof,
          width: 1.55, rotation: t.axis === 'x' ? 0 : Math.PI / 2, intensity: 1.08, color: 0xffffe4,
          dead: false, unstable: false, phase: 0, level: 0 });
        spatial.landmarks.push({ kind: t.kind === 'stairs' ? 'escalier-regional' : 'rampe-regionale',
          position: { ...center, y: surfaceY({ bounds: t.run, profile: t.profile } as WalkableSurface, center.x, center.z) + .865 } });
      }
      cutRects([b], branchCuts).forEach((r, i) => addSurface(`${id}/floor${i ? `-${i}` : ''}`, roomId, r, flat(h)));
    }

    // Restore the actual BSP shapes, opening distributions and architectural
    // details. The regional plan supplies final datums and protected routes.
    if ((mode === 'rooms' || mode === 'lower-maze') && !atrium?.liminal) {
      const protectedRoutes: Rect[] = [];
      if (mode === 'lower-maze') {
        for (let x = b.minX + 14; x < b.maxX; x += 28) protectedRoutes.push({ ...b, minX: x - 2.2, maxX: x + 2.2 });
        for (let z = b.minZ + 14; z < b.maxZ; z += 28) protectedRoutes.push({ ...b, minZ: z - 2.2, maxZ: z + 2.2 });
        if (atrium) protectedRoutes.push(...atriumLandingPads(b, h, atrium).map(p => expand(p.bounds, .5)));
        if (atrium?.stairs) {
          const circulation = atriumCirculation(b, h + (atrium.owner - atrium.lower) * ADDRESS_PITCH, atrium);
          protectedRoutes.push(...circulation.legs.map(l => expand(l.bounds, .5)));
          protectedRoutes.push(expand({ minX: circulation.exit.x - 1.6, maxX: circulation.exit.x + 1.6, minZ: circulation.exit.z - 1.6, maxZ: circulation.exit.z + 1.6 }, .4));
        }
        for (const floor of topology.surfaces.filter(s => s.roomId === roomId && s.role === 'floor')) {
          const c = rectCenter(floor.bounds); protectedRoutes.push({ minX: c.x - .6, maxX: c.x + .6, minZ: c.z - .6, maxZ: c.z + .6 });
        }
      } else protectedRoutes.push(...routeReservations);
      const normal = mode === 'lower-maze' ? !atrium?.openLower : family === 'maze';
      const parts = normal ? template.rooms.flatMap(r => { const bounds = intersect(move(r.bounds), b); return bounds ? [{ source: r, bounds, id: `${id}/bsp/${r.id}` }] : []; })
        : [{ source: { ...world.rooms.find(r => r.id === roomId)!, kind: 'open-hall' as const, ceilingHeight: 2.74, id: 'hall' }, bounds: b, id: `${id}/hall` }];
      world.rooms = world.rooms.filter(r => r.id !== roomId);
      for (const part of parts) world.rooms.push({ ...part.source, id: part.id, bounds: part.bounds, floorY: h,
        ceilingHeight: mode === 'lower-maze' ? roofY : h + part.source.ceilingHeight, structuralCeilingY: mode === 'lower-maze' ? roofY : h + part.source.ceilingHeight, baseboards: part.source.baseboards ?? true, access: 'open' });
      const roomAt = (x: number, z: number) => parts.find(r => pointInRect(x, z, r.bounds, -.001));
      const addArchitecture = (name: string, bounds: Rect, height: number, bottom = 0, tint = 1, detail?: WallSegment['detail'], role?: WallSegment['junctionRole']) => {
        for (const [i, piece] of cutRects([bounds], protectedRoutes).entries()) wall(`${id}/bsp/${name}/${i}`, piece, h + bottom, h + height, tint, detail, role);
      };
      if (normal) {
        for (const w of template.walls) {
          const bounds = intersect(move({ minX: w.x - (w.orientation === 'x' ? w.length : w.thickness) / 2, maxX: w.x + (w.orientation === 'x' ? w.length : w.thickness) / 2,
            minZ: w.z - (w.orientation === 'z' ? w.length : w.thickness) / 2, maxZ: w.z + (w.orientation === 'z' ? w.length : w.thickness) / 2 }), b);
          if (!bounds) continue;
          const adjacent = parts.filter(r => overlapRect(expand(bounds, .02), r.bounds));
          const top = w.bottom < .1 && w.height < 2.64 ? w.bottom + w.height : Math.max(2.74, ...adjacent.map(r => Math.min(mode === 'lower-maze' ? 2.74 : 4.35, r.source.ceilingHeight)));
          addArchitecture(w.id, bounds, top, w.bottom, w.tint, w.detail);
        }
        if (mode === 'rooms') {
          for (const [i, mass] of template.solidMasses.entries()) { const r = intersect(move(mass.bounds), b); if (r) addArchitecture(`mass-${i}`, r, roomAt(rectCenter(r).x, rectCenter(r).z)?.source.ceilingHeight ?? 2.74, 0, 1, undefined, 'mass'); }
          for (const [i, c] of template.columns.entries()) { const r = intersect(move({ minX: c.x - c.width / 2, maxX: c.x + c.width / 2, minZ: c.z - c.depth / 2, maxZ: c.z + c.depth / 2 }), b); if (r) addArchitecture(`column-${i}`, r, Math.min(c.height, 4.35), 0, 1, undefined, c.kind === 'pilaster' ? undefined : 'column'); }
        }
      } else if (family === 'pillars') for (const sx of [-1, 1]) for (const sz of [-1, 1]) addArchitecture(`pillar-${sx}-${sz}`, { minX: p.x + sx * 7 - .7, maxX: p.x + sx * 7 + .7, minZ: p.z + sz * 7 - .7, maxZ: p.z + sz * 7 + .7 }, 2.74, 0, 1, undefined, 'column');

      if (mode === 'rooms') {
        const old = topology.surfaces.filter(s => s.id.startsWith(`${id}/floor`));
        topology.surfaces = topology.surfaces.filter(s => !old.includes(s));
        spatial.ceilings = spatial.ceilings.filter(s => !old.some(o => s.id === `${o.id}/ceiling`));
        for (const [i, base] of old.entries()) for (const [j, r] of parts.entries()) {
          const bounds = intersect(base.bounds, r.bounds); if (bounds) addSurface(`${id}/floor-${i}/bsp-${j}`, r.id, bounds, flat(h), 'floor', true, h + r.source.ceilingHeight);
        }
        // Branch floors are carved before BSP restoration. A flight contained
        // in an existing high room retains that room's complete flat ceiling.
        for (const t of spatial.transitions!.filter(t => t.roofPolicy === 'room' && t.roomId.startsWith(id + '/')))
          for (const [j, r] of parts.entries()) {
            const bounds = intersect(t.bounds, r.bounds); if (!bounds) continue;
            spatial.ceilings.push({ id: `${t.id}/retained-room-roof-${j}`, roomId: r.id, ownerStory: owner.story,
              layer: `regional/${owner.story}`, bounds, profile: flat(h + r.source.ceilingHeight + .03),
              ceilingY: h + r.source.ceilingHeight, thickness: .03, role: 'floor', support: 'slab', access: 'sealed', edges: 'architecture' });
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
          if (protectedRoutes.filter(r => rectWidth(r) < 10 && rectDepth(r) > 10).some(r => overlapRect(r, beam) && atrium?.stairs && atriumCirculation(b, h + (atrium.owner - atrium.lower) * ADDRESS_PITCH, atrium).legs.some(l => overlapRect(l.bounds, beam)))) continue;
          addPrism(profilePrism(`${id}/fixture-beam-${sz}`, beam, flat(h + 2.74), flat(h + 2.96), 'plaster'));
          for (const sx of [-1, 1]) { const x = p.x + sx * 8, z = p.z + sz * 8, room = roomAt(x, z); if (room && !lightBlocked(x, z)) world.lights.push({ id: `${id}/lower-light-${sx}-${sz}`, x, z, roomId: room.id, ceilingY: h + 2.74, width: 1.55, rotation: 0, intensity: 1.08, color: 0xffffe4, dead: false, unstable: false, phase: 0, level: 0 }); }
        }
      }
    } else if (mode === 'gallery' && !atrium?.liminal) {
      for (const x of [b.minX + 1.5, b.maxX - 1.5]) for (const z of [b.minZ + 1.5, b.maxZ - 1.5])
        world.lights.push({ id: `${id}/high-light/${x}/${z}`, x, z, ceilingY: roofY, width: 1.55, rotation: 0, intensity: 1.08, color: 0xffffe4, dead: false, unstable: false, phase: 0, roomId, level: 0 });
    }
    if (atrium && !atrium.liminal && mode !== 'gallery') for (const [i, point] of atriumEntryLightPoints(b, atrium).entries()) {
      const room = world.rooms.find(r => pointInRect(point.x, point.z, r.bounds, -.001) && Math.abs((r.floorY ?? 0) - h) < .01);
      world.lights.push({ id: `${id}/entry-light/${i}`, ...point, ceilingY: h + 2.74, roomId: room?.id ?? roomId, width: 1.55, rotation: 0,
        intensity: 1.08, color: 0xffffe4, dead: false, unstable: false, phase: 0, level: 0 });
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
      const outside = side === 'north' ? Math.abs(b.minZ + 56) < .001 : side === 'south' ? Math.abs(b.maxZ - 56) < .001 : side === 'west' ? Math.abs(b.minX + 56) < .001 : Math.abs(b.maxX - 56) < .001;
      const changingHeight = Math.abs(otherH - h) > .001;
      const connection = changingHeight && hasRegionalTransition(seed, gx, gz, side)
        ? planRegionalTransition(seed, gx, gz, owner.story, side, b, h, otherH, 'facade') : undefined;
      const gates = changingHeight && !connection ? [] : outside && boundaryGates ? boundaryGates[side].filter(g => g.offset + g.width / 2 > min && g.offset - g.width / 2 < max)
        .map(g => ({ min: Math.max(min, g.offset - (connection?.width ?? g.width) / 2), max: Math.min(max, g.offset + (connection?.width ?? g.width) / 2), y: g.floorY })) : Array.from({ length: Math.round((max - min) / 28) }, (_, i) => ({ min: min + (i + .5) * 28 - (connection?.width ?? 4) / 2, max: min + (i + .5) * 28 + (connection?.width ?? 4) / 2, y: portalY }));
      let cursor = min;
      for (const [i, g] of [...gates].sort((a, b) => a.min - b.min).entries()) {
        wall(`${id}/facade-${side}/part-${i}`, sideBounds(cursor, g.min), bottom, top);
        let vertical = connection ? [] : [{ min: bottom, max: top }];
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

  for (const slice of featureSlices) installSpatialFeature(world, slice, {
    surface: (id, roomId, bounds, y, ceiling, role = 'floor') => addSurface(id, roomId, bounds, flat(y), role, false, ceiling),
    prism: addPrism, wall,
  });

  applySpatialRelief(world, featureSlices.map(s => s.reservation));

  const carve = (source: typeof world.walls[number], aperture: Rect) => {
    if (!world.walls.includes(source)) return;
    const bounds = { minX: source.x - (source.orientation === 'x' ? source.length : source.thickness) / 2, maxX: source.x + (source.orientation === 'x' ? source.length : source.thickness) / 2,
      minZ: source.z - (source.orientation === 'z' ? source.length : source.thickness) / 2, maxZ: source.z + (source.orientation === 'z' ? source.length : source.thickness) / 2 };
    world.walls = world.walls.filter(w => w !== source); world.colliders = world.colliders.filter(c => c.id !== source.id); spatial.prisms = spatial.prisms.filter(p => p.id !== source.id);
    cutRects([bounds], [aperture]).forEach((b, i) => wall(`${source.id}/regional-door-${i}`, b, source.bottom, source.bottom + source.height, source.tint, source.detail, source.junctionRole));
  };

  // A door crosses the thickness of its host wall. BSP room bounds can stop
  // on opposite wall faces, so explicitly own both halves of its real threshold.
  for (const door of world.features.filter(f => f.kind === 'interactive-door')) {
    const alongX = door.orientation === 'x', x = door.position.x, z = door.position.z, h = door.position.y;
    const aperture: Rect = alongX ? { minX: x - door.width / 2, maxX: x + door.width / 2, minZ: z - 1.6, maxZ: z + 1.6 }
      : { minX: x - 1.6, maxX: x + 1.6, minZ: z - door.width / 2, maxZ: z + door.width / 2 };
    for (const source of [...world.walls]) {
      if (!source.id.includes('/bsp/') || source.bottom > h + .05) continue;
      const bounds = { minX: source.x - (source.orientation === 'x' ? source.length : source.thickness) / 2,
        maxX: source.x + (source.orientation === 'x' ? source.length : source.thickness) / 2,
        minZ: source.z - (source.orientation === 'z' ? source.length : source.thickness) / 2,
        maxZ: source.z + (source.orientation === 'z' ? source.length : source.thickness) / 2 };
      const clipped = intersect(bounds, aperture); if (!clipped) continue;
      carve(source, aperture);
      wall(`${source.id}/door-lintel`, clipped, h + door.height, source.bottom + source.height, source.tint);
    }
    topology.surfaces = topology.surfaces.flatMap(sf => sf.profile.kind !== 'flat' || Math.abs(surfaceRange(sf)[0] - h) > .01 || !overlapRect(sf.bounds, aperture) ? [sf]
      : cutRects([sf.bounds], [aperture]).map((bounds, i) => ({ ...sf, id: `${sf.id}/door-cut-${i}`, bounds })));
    spatial.ceilings = spatial.ceilings.flatMap(sf => !overlapRect(sf.bounds, aperture) ? [sf]
      : cutRects([sf.bounds], [aperture]).map((bounds, i) => ({ ...sf, id: `${sf.id}/door-cut-${i}`, bounds })));
    const roof = Math.max(h + 2.5, Math.min(...world.rooms.filter(r => r.id === door.sourceRoomId || r.id === door.targetRoomId).map(r => r.ceilingHeight)));
    for (const sign of [-1, 1]) {
      const bounds = alongX ? { ...aperture, minZ: sign < 0 ? aperture.minZ : z, maxZ: sign < 0 ? z : aperture.maxZ }
        : { ...aperture, minX: sign < 0 ? aperture.minX : x, maxX: sign < 0 ? x : aperture.maxX };
      addSurface(`${door.id}/threshold-${sign}`, sign < 0 ? door.sourceRoomId : door.targetRoomId, bounds, flat(h), 'landing', true, roof);
    }
  }

  for (const surface of [...topology.surfaces, ...spatial.ceilings]) {
    if (world.rooms.some(r => r.id === surface.roomId)) continue;
    const p = rectCenter(surface.bounds), room = world.rooms.find(r => pointInRect(p.x, p.z, r.bounds, -.001) && Math.abs((r.floorY ?? 0) - surfaceRange(surface)[0]) < 12);
    if (room) surface.roomId = room.id;
  }
  const chamberCuts = spatial.transitions!.filter(t => t.roofPolicy !== 'room').flatMap(t => [t.approach.bounds, transitionRoofBounds(t, t.run),
    ...(rectWidth(t.landing.bounds) > .005 && rectDepth(t.landing.bounds) > .005 ? [transitionRoofBounds(t, t.landing.bounds)] : [])].map(bounds => ({ room: t.roomId, bounds })));
  spatial.ceilings = spatial.ceilings.flatMap(s => {
    const cuts = chamberCuts.filter(c => c.room !== s.roomId && overlapRect(c.bounds, s.bounds));
    if (!cuts.length) return [s];
    return cutRects([s.bounds], cuts.map(c => c.bounds)).map((bounds, i) => ({ ...s, id: `${s.id}/cage-cut-${i}`, bounds, profile: restrictProfile(s.bounds, s.profile, bounds) }));
  });
  // Keep feature selection on its existing reserved floor shapes. Final L/T
  // ownership is resolved after authored openings and gallery guards exist.
  cleanSpatialWallJunctions(world, false);
  const rawSurfaces = topology.surfaces;
  const rebuildFloors = () => {
    const doors = new Set(world.features.filter(f => f.kind === 'interactive-door').map(f => f.colliderId));
    const floorCuts = world.colliders.filter(c => c.kind === 'wall' && !doors.has(c.id)).map(c => ({
      bounds: { minX: c.center.x - c.halfExtents.x, maxX: c.center.x + c.halfExtents.x, minZ: c.center.z - c.halfExtents.z, maxZ: c.center.z + c.halfExtents.z },
      bottom: c.center.y - c.halfExtents.y, top: c.center.y + c.halfExtents.y }));
    topology.surfaces = rawSurfaces.flatMap(s => s.role !== 'floor' ? [s] : cutRects([s.bounds], floorCuts.filter(c => c.bottom < surfaceRange(s)[0] + .05 && c.top > surfaceRange(s)[0] + .1).map(c => c.bounds))
      .map((bounds, i) => ({ ...s, id: `${s.id}/clear-${i}`, bounds })));
    topology.connections = topology.connections.filter(c => !c.id.startsWith('join/'));
  };
  stitchBspPartitions(world, rebuildFloors, () => connectSpatialSurfaces(world), carve);
  rebuildFloors();
  reconcileStructuralSupports(world, (id, b, bottom, top, tint, detail) => wall(id, b, bottom, top, tint, detail, 'support'));
  completeCeilingEnvelope(world, addPrism);
  completeOpenTransitionEnvelope(world, addPrism);
  const wallCount = world.walls.length;
  installOrdinaryArchitecture(world, featureSlices.map(s => s.reservation));
  if (world.walls.length !== wallCount) rebuildFloors();

  world.unlitZones = [];
  for (const zone of template.unlitZones ?? []) {
    const moved = move(zone);
    for (const cell of spatial.cells.filter(c => c.mode === 'rooms')) { const bounds = intersect(moved, cell.bounds); if (bounds) world.unlitZones.push(bounds); }
  }
  for (const light of world.lights) if (world.unlitZones.some(r => pointInRect(light.x, light.z, r))) light.dead = true;

  // Room policy comes from the canonical BSP room, including its fragments on
  // neighbouring cells/chunks. Open halls and atria keep their coherent trim.
  world.baseboardlessZones = world.rooms.filter(r => r.baseboards === false).map(r => ({ ...r.bounds, floorY: r.floorY ?? 0 }));

  world.lights = world.lights.filter(light => !world.walls.some(w => w.bottom < light.ceilingY - .02 && w.bottom + w.height > light.ceilingY - .25
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

  // Supports and gallery parapets can bury a last ordinary fragment. Resolve
  // those final solids before their finish, and rebuild the physical floor.
  if (cleanSpatialWallJunctions(world)) rebuildFloors();
  closeSpatialFloorContacts(world);
  spatial.prisms.push(...createSpatialBaseboards(world));

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
  connectSpatialFeatures(world, featureSlices);
  connectSpatialSurfaces(world);
  connectArchitecturalOpenings(world);
  world.colliders.push(...topology.surfaces.map(s => s.role === 'floor' ? slabMeshCollider(s) : surfaceCollider(s)), ...spatial.ceilings.map(s => ({ ...surfaceCollider(s), id: s.id, kind: 'barrier' as const })));
  topology.volumes = topology.surfaces.flatMap(s => [{ id: `${s.id}/clearance`, surfaceId: s.id, bounds: s.bounds, bottom: surfaceRange(s)[0], top: s.ceilingY, purpose: 'clearance' as const, ownerStory: owner.story },
    { id: `${s.id}/structure`, surfaceId: s.id, bounds: s.bounds, bottom: s.support === 'solid' ? s.supportBottom ?? surfaceRange(s)[0] - .16 : surfaceRange(s)[0] - .16, top: surfaceRange(s)[1], purpose: 'structure' as const, ownerStory: owner.story }]);
  world.floorRects = topology.surfaces.map(s => s.bounds);
  const candidates = topology.surfaces.filter(s => s.role === 'floor' && s.locomotion !== 'crouch' && s.profile.kind === 'flat' && rectWidth(s.bounds) > 2 && rectDepth(s.bounds) > 2)
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
    const headroom = a.s.locomotion === 'crouch' || b.s.locomotion === 'crouch' ? 1.26 : 1.75;
    for (const c of world.colliders) {
      if (c.kind !== 'wall' || c.center.y + c.halfExtents.y < foot + .05 || c.center.y - c.halfExtents.y > foot + headroom) continue;
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
    // Link the actual threshold halves on their common door plane.
    const alongX = door.orientation === 'x', d = .04;
    const ends = [-1, 1].map(sign => findSurface(world, { x: door.position.x + (alongX ? 0 : sign * d), z: door.position.z + (alongX ? sign * d : 0), referenceY: door.position.y, maxAbove: .05, maxBelow: .05 }));
    if (ends[0] && ends[1] && ends[0] !== ends[1]) links.push({ id: `join/door/${door.id}`, from: ends[0].id, to: ends[1].id,
      at: { x: door.position.x, z: door.position.z }, width: door.width, kind: 'walk', direction: 'both', access: 'open', requiresDoorId: door.id });
  }
  t.connections.push(...links);
};
