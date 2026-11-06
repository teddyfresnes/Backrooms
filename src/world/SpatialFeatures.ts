import { restrictProfile } from './TransitionLayout';
import { proposeLiminalPit } from './LiminalPits';
import { buildGridPit, proposeSpatialCrawl } from './generateWorld';
import { SeededRandom } from './SeededRandom';
import { regionalAtrium, regionalCellId, regionalDatum } from './RegionalPlan';
import { profilePrism, offsetProfile } from './SpatialGeometry';
import { cutRects, findSurface, overlapRect, surfaceRange, type WalkableSurface } from './WalkableTopology';
import { rectCenter, rectDepth, type GridPitFeature, type LiminalPitFeature, type Rect, type SqueezeViewFeature, type WallSegment, type WorldPlan } from './types';
import type { SpatialPrism } from './SpatialTypes';

export interface SpatialFeatureSlice {
  id: string; sourceStory: number; targetStory: number; phase: 'source' | 'through' | 'landing';
  reservation: Rect; holes: Rect[]; void: boolean;
  feature: GridPitFeature | SqueezeViewFeature | LiminalPitFeature; walls: WallSegment[]; floorY: number;
}
const flat = (y: number) => ({ kind: 'flat' as const, y });
const memo = new Map<string, SpatialFeatureSlice | undefined>();
export const clearSpatialFeatureCache = () => memo.clear();

/** Bounded vertical ownership is derived without reading any generated neighbour.
 * Void shafts reach 54m, below the existing 48m unbroken-fall recovery. */
export const planSpatialFeature = (seed: string, gx: number, gz: number, story: number, b: Rect): SpatialFeatureSlice | undefined => {
  const phase = new SeededRandom(`${seed}:legacy-column:v1:${gx}:${gz}`).int(0, 15);
  const sourceStory = Math.floor((story - phase + 15) / 16) * 16 + phase;
  const key = `${seed}/${gx}/${gz}/${sourceStory}`;
  let proposal: SpatialFeatureSlice | undefined;
  if (memo.has(key)) proposal = memo.get(key);
  else {
    const rng = new SeededRandom(`${key}:legacy-features:v1`), datum = regionalDatum(seed, gx, gz);
    const stable = datum.id !== 'monument-interface' && [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .every(([dx, dz]) => regionalDatum(seed, gx + dx!, gz + dz!).id === datum.id);
    if (stable && rng.chance(.9)) {
      const id = `${regionalCellId(gx, gz, sourceStory)}/heritage`, p = rectCenter(b);
      const grid = rng.chance(.15), breach = !grid && rng.chance(.4);
      const halfX = grid || breach ? rng.float(8.8, 10.5) : rng.float(9, 11);
      const halfZ = grid || breach ? rng.float(8.8, 10.5) : rng.float(4.3, 6);
      const room = { id: `${id}/room`, bounds: { minX: p.x - halfX, maxX: p.x + halfX, minZ: p.z - halfZ, maxZ: p.z + halfZ },
        kind: 'office' as const, level: 0 as const, floorY: 0, ceilingHeight: 2.74, detailDensity: .1, access: 'open' as const };
      const depth = rng.weighted([{ value: 1, weight: .55 }, { value: 2, weight: .22 }, { value: 3, weight: .12 }, { value: 4, weight: .07 }, { value: 5, weight: .04 }]);
      const raw = grid ? { feature: buildGridPit(room, rng.fork('grid'), room.bounds, depth), walls: [] }
        : proposeSpatialCrawl(room, `${key}:crawl`, breach);
      if (raw) {
        const feature = { ...raw.feature, id, roomId: room.id };
        if (feature.kind === 'squeeze-view' && feature.hump) feature.clearanceHeight = Math.max(feature.clearanceHeight ?? 1.42, feature.hump.elevation + 1.3);
        const holes = feature.holes ?? [];
        const isVoid = holes.length > 0 && rng.fork('void').chance(.035);
        const reach = isVoid ? 10 : holes.length ? depth : 0;
        const compatible = Array.from({ length: reach + 1 }, (_, i) => sourceStory - i)
          .every(s => !regionalAtrium(seed, gx, gz, s));
        if (compatible) {
          for (const hole of holes) { hole.kind = isVoid ? 'void' : 'drop'; hole.stories = reach; hole.depth = reach * 5.4; }
          if (feature.kind === 'grid-pit') { feature.depth = reach * 5.4; feature.lowerFloorY = datum.y - 5.4; feature.lowerCeilingY = datum.y - 2.66; }
          proposal = { id, sourceStory, targetStory: sourceStory - reach, phase: 'source', reservation: room.bounds,
            holes: holes.map(({ minX, maxX, minZ, maxZ }) => ({ minX, maxX, minZ, maxZ })), void: isVoid, feature, walls: raw.walls, floorY: datum.y };
        }
      }
    }
    // Fallback only: historical grids and passages keep their exact proposals.
    if (!proposal && stable) {
      const extra = new SeededRandom(`${key}:liminal-shaft:v1`);
      if (extra.chance(.45)) {
        const p = rectCenter(b), reservation = { minX: p.x - 9.4, maxX: p.x + 9.4, minZ: p.z - 9.4, maxZ: p.z + 9.4 };
        const id = `${regionalCellId(gx, gz, sourceStory)}/liminal-pit`, feature = proposeLiminalPit(key, id, reservation, datum.y);
        const isVoid = extra.fork('void').chance(.08), reach = isVoid ? 10 : extra.fork('depth').weighted([
          { value: 1, weight: .35 }, { value: 2, weight: .3 }, { value: 3, weight: .2 }, { value: 5, weight: .15 }]);
        if (Array.from({ length: reach + 1 }, (_, i) => sourceStory - i).every(s => !regionalAtrium(seed, gx, gz, s))) {
          for (const hole of feature.holes) { hole.kind = isVoid ? 'void' : 'drop'; hole.stories = reach; hole.depth = reach * 5.4; }
          feature.depth = reach * 5.4;
          feature.lowerFloorY = datum.y - reach * 5.4; feature.lowerCeilingY = feature.lowerFloorY + 2.74;
          proposal = { id, sourceStory, targetStory: sourceStory - reach, phase: 'source', reservation,
            holes: feature.holes.map(({ minX, maxX, minZ, maxZ }) => ({ minX, maxX, minZ, maxZ })),
            void: isVoid, feature, walls: [], floorY: datum.y };
        }
      }
    }
    memo.set(key, proposal); if (memo.size > 256) memo.delete(memo.keys().next().value!);
  }
  if (!proposal || story < proposal.targetStory || story > proposal.sourceStory) return;
  return { ...proposal, phase: story === proposal.sourceStory ? 'source' : story === proposal.targetStory ? 'landing' : 'through' };
};

export interface FeatureInstaller {
  surface: (id: string, room: string, b: Rect, y: number, ceiling: number, role?: WalkableSurface['role']) => WalkableSurface;
  prism: (p: SpatialPrism) => void;
  wall: (id: string, b: Rect, bottom: number, top: number, tint?: number) => void;
}
/** Installs only canonical regional geometry. Legacy preview meshes/colliders
 * remain proposals and cannot create an extra floor at zero. */
export const installSpatialFeature = (w: WorldPlan, p: SpatialFeatureSlice, hooks: FeatureInstaller): void => {
  const t = w.topology!, spatial = w.spatial!, owner = spatial.owner, h = p.floorY;
  const rid = `${p.id}/room/${owner.story}`, delta = (p.sourceStory - owner.story) * 5.4;
  w.rooms.push({ id: rid, bounds: p.reservation, floorY: h, ceilingHeight: h + 2.74, structuralCeilingY: h + 2.74,
    kind: p.feature.kind !== 'squeeze-view' ? 'pit-gallery' : 'office', level: 0, access: 'open', detailDensity: .1 });
  const cut = (surfaces: WalkableSurface[], cuts: readonly Rect[], label: string) => surfaces.flatMap(s => {
    if (Math.abs(surfaceRange(s)[0] - h) > .001 || s.profile.kind !== 'flat' || !cuts.some(b => overlapRect(b, s.bounds))) return [s];
    return cutRects([s.bounds], cuts).map((bounds, i) => ({ ...s, id: `${s.id}/${label}-${i}`, bounds }));
  });
  const roofCut = (cuts: readonly Rect[]) => { spatial.ceilings = spatial.ceilings.flatMap(s => !cuts.some(b => overlapRect(b, s.bounds)) ? [s] :
    cutRects([s.bounds], cuts).map((bounds, i) => ({ ...s, id: `${s.id}/heritage-${i}`, bounds, profile: s.profile.kind === 'flat' ? s.profile : offsetProfile(s.profile, 0) }))); };
  const enclosure = { minX: Math.min(...p.holes.map(b => b.minX)) - .4, maxX: Math.max(...p.holes.map(b => b.maxX)) + .4,
    minZ: Math.min(...p.holes.map(b => b.minZ)) - .4, maxZ: Math.max(...p.holes.map(b => b.maxZ)) + .4 };
  const closed = p.phase === 'through' || p.phase === 'landing' && p.void;
  if (closed) {
    t.surfaces = cut(t.surfaces, [enclosure], `${p.id}/shaft`); roofCut([enclosure]);
    w.floorOpenings!.push(enclosure); w.ceilingOpenings!.push(enclosure);
    const thickness = .6;
    for (const [name, b] of [['north', { ...enclosure, minZ: enclosure.minZ - thickness, maxZ: enclosure.minZ }],
      ['south', { ...enclosure, minZ: enclosure.maxZ, maxZ: enclosure.maxZ + thickness }],
      ['west', { ...enclosure, minX: enclosure.minX - thickness, maxX: enclosure.minX }],
      ['east', { ...enclosure, minX: enclosure.maxX, maxX: enclosure.maxX + thickness }]] as const)
      hooks.wall(`${p.id}/enclosure/${owner.story}/${name}`, b, h - .16, h + 5.24);
  } else if (p.phase === 'landing') {
    t.surfaces = cut(t.surfaces, p.holes, `${p.id}/arrival`); roofCut(p.holes); w.ceilingOpenings!.push(...p.holes);
    p.holes.forEach((b, i) => hooks.surface(`${p.id}/landing-${i}`, rid, b, h, h + 2.74, 'landing'));
  } else {
    w.features.push({ ...p.feature, roomId: rid });
    t.surfaces = cut(t.surfaces, p.holes, `${p.id}/open`); w.floorOpenings!.push(...p.holes);
    for (const [i, wall] of p.walls.entries()) {
      const alongX = wall.orientation === 'x';
      hooks.wall(`${p.id}/wall-${i}`, { minX: wall.x - (alongX ? wall.length : wall.thickness) / 2, maxX: wall.x + (alongX ? wall.length : wall.thickness) / 2,
        minZ: wall.z - (alongX ? wall.thickness : wall.length) / 2, maxZ: wall.z + (alongX ? wall.thickness : wall.length) / 2 }, h + wall.bottom, h + wall.bottom + wall.height, wall.tint);
    }
    if (p.feature.kind === 'squeeze-view') {
      const feature = p.feature, passages = feature.passageRects ?? [feature.bounds], clearance = feature.clearanceHeight ?? 1.42;
      t.surfaces = cut(t.surfaces, passages, `${p.id}/crawl`); roofCut(passages);
      for (const [i, b] of passages.entries()) {
        hooks.prism(profilePrism(`${p.id}/low-roof-${i}`, b, flat(h + clearance), flat(h + 2.74), 'ceiling'));
        cutRects([b], p.holes).forEach((bounds, j) => {
          const sf = hooks.surface(`${p.id}/crawl-${i}-${j}`, rid, bounds, h, h + clearance);
          sf.locomotion = 'crouch';
        });
      }
      if (feature.hump) {
        const hump = feature.hump;
        const pieces = [{ bounds: hump.platformBounds, profile: flat(h + hump.elevation) }, ...hump.ramps.map(ramp => ({ bounds: ramp.bounds,
          profile: { kind: 'linear' as const, axis: ramp.axis, startY: h + (ramp.riseDirection > 0 ? 0 : hump.elevation), endY: h + (ramp.riseDirection > 0 ? hump.elevation : 0) } }))];
        t.surfaces = cut(t.surfaces, pieces.map(p => p.bounds), `${p.id}/hump-cut`);
        pieces.forEach((piece, i) => cutRects([piece.bounds], p.holes).forEach((bounds, j) => {
          const sf = hooks.surface(`${p.id}/hump-${i}-${j}`, rid, bounds, h, h + clearance, piece.profile.kind === 'linear' ? 'ramp' : 'landing');
          sf.profile = restrictProfile(piece.bounds, piece.profile, bounds); sf.support = 'solid'; sf.supportBottom = h - .16; sf.locomotion = 'crouch';
        }));
      }
    }
    spatial.landmarks.push({ kind: p.feature.kind === 'grid-pit' ? 'trous-historiques' : p.feature.kind === 'liminal-pit' ? `fosse-${p.feature.family}` : p.feature.passageStyle === 'wall-breach' ? 'passage-mural' : 'passage-accroupi',
      position: { x: p.reservation.minX + .8, y: h + .865, z: rectCenter(p.reservation).z } });
  }
  // Remove walls' footprints from the source/arrival floor too; crawl lintels
  // start above the floor and therefore keep their actual passage underneath.
  t.surfaces = t.surfaces.flatMap(s => {
    const y = surfaceRange(s)[0];
    const cuts = w.walls.filter(wall => wall.id.startsWith(p.id) && wall.bottom < y + .05 && wall.bottom + wall.height > y + .1).map(wall => ({
      minX: wall.x - (wall.orientation === 'x' ? wall.length : wall.thickness) / 2, maxX: wall.x + (wall.orientation === 'x' ? wall.length : wall.thickness) / 2,
      minZ: wall.z - (wall.orientation === 'z' ? wall.length : wall.thickness) / 2, maxZ: wall.z + (wall.orientation === 'z' ? wall.length : wall.thickness) / 2 }));
    if (!cuts.some(b => overlapRect(b, s.bounds))) return [s];
    return cutRects([s.bounds], cuts).map((bounds, i) => ({ ...s, id: `${s.id}/heritage-clear-${i}`, bounds, profile: restrictProfile(s.bounds, s.profile, bounds) }));
  });
  for (let story = p.targetStory; story <= p.sourceStory; story++) if (story !== owner.story) spatial.dependencies.push({ owner: { ...owner, story },
    bounds: p.reservation, bottom: h - (owner.story - p.targetStory) * 5.4, top: h + delta + 2.74, reason: 'drop' });
  if (!closed) {
    const center = rectCenter(p.reservation);
    // A fixture on the ordinary roof beside the holes, outside low crawl roofs.
    w.lights.push({ id: `${p.id}/lamp/${owner.story}`, roomId: rid, x: p.reservation.minX + .8, z: center.z,
      ceilingY: h + 2.74, width: 1.55, rotation: Math.PI / 2, intensity: 1.08, color: 0xffffe4, dead: false, unstable: false, phase: 0, level: 0 });
  }
};

/** Resolve source IDs after final BSP clipping and connectivity repairs. */
export const connectSpatialFeatures = (w: WorldPlan, slices: readonly SpatialFeatureSlice[]): void => {
  for (const p of slices) if (p.phase === 'source' && !p.void) for (const [i, b] of p.holes.entries()) {
    const center = rectCenter(b), h = p.floorY;
    const edge = [{ x: b.minX - .25, z: center.z }, { x: b.maxX + .25, z: center.z },
      { x: center.x, z: b.minZ - .25 }, { x: center.x, z: b.maxZ + .25 }]
      .map(at => ({ at, from: findSurface(w, { ...at, referenceY: h, maxAbove: .01, maxBelow: .01 }) })).find(v => v.from);
    if (!edge?.from) { w.topology!.diagnostics.push({ id: p.id, reason: 'shaft has no usable source edge' }); continue; }
    w.topology!.connections.push({ id: `${p.id}/drop-${i}`, from: edge.from.id, to: `${p.id}/landing-${i}`, at: edge.at,
      width: Math.min(rectDepth(b), b.maxX - b.minX), kind: 'drop', direction: 'forward', access: 'open',
      toOwner: { ...w.spatial!.owner, story: p.targetStory }, arrival: { ...center, y: h - (p.sourceStory - p.targetStory) * 5.4 } });
  }
};
