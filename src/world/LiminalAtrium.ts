import { appendOpeningWall, type ArchitecturalOpening, type LiminalArchitectureFeature, type OpeningWall } from './ArchitecturalOpenings';
import { passageRow } from './LiminalArchitecture';
import { insetAtrium } from './AtriumEnvelope';
import { regionalCellId, type AtriumPlan } from './RegionalPlan';
import { SeededRandom } from './SeededRandom';
import { endpointStairRun } from './SpatialGeometry';
import { cutRects, findSurface, overlapRect, type HeightProfile, type WalkableSurface } from './WalkableTopology';
import { rectCenter, rectDepth, rectWidth, type Rect, type WorldPlan } from './types';

const sides = ['north', 'east', 'south', 'west'] as const;
type Side = typeof sides[number];
const flat = (y: number): HeightProfile => ({ kind: 'flat', y });
const union = (rects: readonly Rect[]): Rect[] => { const result: Rect[] = []; for (const r of rects) result.push(...cutRects([r], result)); return result; };
const sideRect = (inner: Rect, side: Side, min: number, max: number, from: number, to: number): Rect => side === 'north' || side === 'south'
  ? { minX: min, maxX: max, minZ: side === 'north' ? inner.minZ + from : inner.maxZ - to, maxZ: side === 'north' ? inner.minZ + to : inner.maxZ - from }
  : { minZ: min, maxZ: max, minX: side === 'west' ? inner.minX + from : inner.maxX - to, maxX: side === 'west' ? inner.minX + to : inner.maxX - from };
const sidePoint = (inner: Rect, side: Side, along: number, depth: number) => side === 'north' || side === 'south'
  ? { x: along, z: side === 'north' ? inner.minZ + depth : inner.maxZ - depth }
  : { z: along, x: side === 'west' ? inner.minX + depth : inner.maxX - depth };

export const liminalGallerySides = (a: AtriumPlan): Side[] => {
  const l = a.liminal!;
  return [sides[l.side]!, ...(l.layout === 'opposed' ? [sides[(l.side + 2) % 4]!] : l.layout === 'corner' ? [sides[(l.side + 1) % 4]!] : [])];
};
export const liminalGalleryPresent = (a: AtriumPlan, story: number) => story > a.lower && (story === a.owner || a.liminal!.midGallery);
const cornerTowardMax = (a: AtriumPlan, side: Side): boolean => {
  const other = liminalGallerySides(a).find(s => s !== side);
  return side === 'north' || side === 'south' ? other === 'east' : other === 'south';
};
export const liminalPlatform = (b: Rect, a: AtriumPlan, story: number, side: Side): Rect => {
  const inner = insetAtrium(b, a.ringWidth), l = a.liminal!, alongX = side === 'north' || side === 'south';
  const min = alongX ? inner.minX : inner.minZ, max = alongX ? inner.maxX : inner.maxZ;
  const fraction = l.layout === 'end' ? .94 : side === sides[l.side] ? l.length : Math.max(.44, 1.12 - l.length);
  const span = Math.min(max - min, Math.max((max - min) * fraction, l.layout === 'corner' ? 10.8 : 0));
  const offset = l.layout === 'corner' ? cornerTowardMax(a, side) ? 1 : 0 : .5;
  const start = min + (max - min - span) * offset;
  return sideRect(inner, side, start, start + span, 0, (l.layout === 'end' ? 3.2 : 2.2) + (a.owner - story) * 2.4);
};
const frontDepth = (a: AtriumPlan, story: number): number => {
  for (let s = story; s <= a.owner; s++) if (liminalGalleryPresent(a, s)) return (a.liminal!.layout === 'end' ? 3.2 : 2.2) + (a.owner - s) * 2.4;
  return 0;
};
const targetStory = (a: AtriumPlan, source: number) => {
  for (let s = source - 1; s > a.lower; s--) if (liminalGalleryPresent(a, s)) return s;
  return a.lower;
};
type Add = (id: string, b: Rect, p: HeightProfile, role: WalkableSurface['role'], ceiling: number) => WalkableSurface;

/** Inner facades hide service circulation. Only selected galleries face the
 * room; canonical outer gates still lead to true connected corridors. */
export const installLiminalAtrium = (w: WorldPlan, id: string, roomId: string, b: Rect, a: AtriumPlan, h: number, add: Add): void => {
  const story = w.spatial!.owner.story, l = a.liminal!, inner = insetAtrium(b, a.ringWidth), active = liminalGallerySides(a);
  const roof = h + (a.owner - story) * 5.4 + 3.05, root = new SeededRandom(`${w.seed}:liminal-atrium:v1:${a.anchorX}:${a.anchorZ}:${a.owner}`);
  const feature: LiminalArchitectureFeature = { kind: 'liminal-architecture', id: `${id}/liminal`, roomId, bounds: b,
    family: 'partial-gallery', composition: l.layout, walls: [], floorLevels: [h], visibleSides: active, stairCount: 0 };
  const addWall = (wall: OpeningWall) => { appendOpeningWall(w, wall); feature.walls.push(wall); };
  const rows = (s: number, side: Side): ArchitecturalOpening[] => {
    const y = h + (s - story) * 5.4, p = liminalPlatform(b, a, s, side), alongX = side === 'north' || side === 'south';
    let min = (alongX ? p.minX : p.minZ) + .65, max = (alongX ? p.maxX : p.maxZ) - .65;
    if (l.layout === 'corner') {
      // Keep actual doorways and their lower landing pads outside the solid
      // support of the perpendicular arm. The visible L itself stays joined.
      const margin = frontDepth(a, s) + .95;
      if (cornerTowardMax(a, side)) max = Math.min(max, (alongX ? inner.maxX : inner.maxZ) - margin);
      else min = Math.max(min, (alongX ? inner.minX : inner.minZ) + margin);
    }
    const pattern = root.fork(`rhythm/${side}`).pick(['single', 'rhythm', 'right-cluster', 'mixed', 'rect-rhythm', 'wide-and-small'] as const);
    return passageRow(root.fork(`row/${s}/${side}`), min, max, y, y + 2.74, max - min < 7 ? 'single' : pattern);
  };
  const destination = (s: number, side: Side, index: number, along: number) => {
    const target = targetStory(a, s), point = sidePoint(inner, side, along, frontDepth(a, s) + .95);
    return { owner: { ...w.spatial!.owner, story: target }, surfaceId: `${regionalCellId(a.anchorX, a.anchorZ, target)}/liminal-drop-${s}-${side}-${index}`,
      position: { ...point, y: h + (target - story) * 5.4 } };
  };
  const arrivals: { id: string; bounds: Rect }[] = [];
  for (let s = story + 1; s <= a.owner; s++) if (targetStory(a, s) === story) for (const side of active) for (const [index, o] of rows(s, side).entries()) {
    const d = destination(s, side, index, (o.min + o.max) / 2), p = d.position;
    arrivals.push({ id: d.surfaceId, bounds: { minX: p.x - .82, maxX: p.x + .82, minZ: p.z - .82, maxZ: p.z + .82 } });
  }
  const corridorOuter = insetAtrium(b, 1.3), corridorInner = insetAtrium(b, a.ringWidth - .45);
  const service = cutRects([corridorOuter], [corridorInner]), spokes: Rect[] = [];
  for (const side of sides) {
    const alongX = side === 'north' || side === 'south', min = alongX ? b.minX : b.minZ, length = alongX ? rectWidth(b) : rectDepth(b);
    for (let n = 0; n < Math.round(length / 28); n++) {
      const cross = min + (n + .5) * 28;
      spokes.push(sideRect(b, side, cross - 2, cross + 2, 0, 1.31));
    }
  }
  const bases = union([...service, ...spokes]), thresholds: Rect[] = [], bearings: Rect[] = [];
  for (let s = story + 1; s <= a.owner; s++) if (liminalGalleryPresent(a, s)) for (const side of active) {
    const base = liminalPlatform(b, a, s, side);
    for (const piece of cutRects([base], bearings)) {
      addWall({ id: `${id}/bearing-${s}-${side}-${bearings.length}`, bounds: piece, axis: side === 'north' || side === 'south' ? 'x' : 'z',
        bottom: h - .16, top: h + 5.24, openings: rows(story, side) });
      bearings.push(piece);
    }
  }
  for (const side of sides) {
    const alongX = side === 'north' || side === 'south', min = (alongX ? inner.minX : inner.minZ) - .45, max = (alongX ? inner.maxX : inner.maxZ) + .45;
    const selected = active.includes(side), windows = !selected && root.fork(`windows/${story}/${side}`).chance(.28);
    const openings = selected ? rows(story, side) : windows ? passageRow(root.fork(`window-profile/${story}/${side}`), min + 2, max - 2, h, h + 2.74, 'high-windows') : [];
    const wall: OpeningWall = { id: `${id}/inner-${side}`, bounds: sideRect(inner, side, min, max, -.45, 0), axis: alongX ? 'x' : 'z', bottom: h - .16,
      top: Math.min(h + 5.24, roof), openings };
    addWall(wall);
    for (const [index, o] of openings.entries()) {
      const front = selected ? frontDepth(a, story) : 0;
      const threshold = sideRect(inner, side, o.min, o.max, -.45, front);
      if (o.bottom > h + .1) {
        const sill = add(`${id}/high-sill-${side}-${index}`, threshold, flat(o.bottom), 'landing', o.bottom + o.height);
        sill.access = 'sealed';
        const p = rectCenter(inner);
        o.destination = { owner: { ...w.spatial!.owner, story: a.lower }, surfaceId: `${regionalCellId(a.anchorX, a.anchorZ, a.lower)}/liminal-arrival`,
          position: { ...p, y: h + (a.lower - story) * 5.4 } };
      } else thresholds.push(threshold);
      if (selected && story > a.lower && !liminalGalleryPresent(a, story)) {
        const facade = [...feature.walls].reverse().find(p => p.id.includes('/bearing-') && p.axis === wall.axis && overlapRect(p.bounds, threshold));
        const ownerWall = facade ?? wall, profile = ownerWall.openings[index];
        if (profile) { profile.access = 'drop'; profile.destination = destination(story, side, index, (o.min + o.max) / 2); }
      }
    }
  }
  const platformRects = liminalGalleryPresent(a, story) ? active.flatMap(side => cutRects([liminalPlatform(b, a, story, side)], bearings)) : [];
  const terraceCuts: Rect[] = [];
  if (story === a.lower && l.terrace > 0) {
    const size = Math.min(4.2, Math.min(rectWidth(inner), rectDepth(inner)) * .19), center = rectCenter(inner);
    const positions = root.fork('terrace-position').shuffle([[.26, .26], [.74, .26], [.26, .74], [.74, .74]]);
    const base = positions.map(([x, z]) => ({ minX: inner.minX + rectWidth(inner) * x! - size / 2, maxX: inner.minX + rectWidth(inner) * x! + size / 2,
      minZ: inner.minZ + rectDepth(inner) * z! - size / 2, maxZ: inner.minZ + rectDepth(inner) * z! + size / 2 }))
      .find(r => ![...bearings, ...arrivals.map(a => a.bounds), { minX: center.x - 1.5, maxX: center.x + 1.5, minZ: center.z - 1.5, maxZ: center.z + 1.5 }].some(p => overlapRect(r, p, .35)));
    if (base) {
      const platform = add(`${id}/fractional-terrace`, base, flat(h + l.terrace), 'landing', roof);
      platform.support = 'solid'; platform.supportBottom = h - .16; terraceCuts.push(base); feature.floorLevels.push(h + l.terrace);
      if (l.terraceStairs) {
        const run = Math.max(4, l.terrace * 4.5), z = (base.minZ + base.maxZ) / 2;
        const options = [{ minX: base.minX - run, maxX: base.minX, minZ: z - .95, maxZ: z + .95 },
          { minX: base.maxX, maxX: base.maxX + run, minZ: z - .95, maxZ: z + .95 }];
        const stair = options.find(r => r.minX > inner.minX + .2 && r.maxX < inner.maxX - .2 && r.minZ > inner.minZ + .2 && r.maxZ < inner.maxZ - .2
          && ![...bearings, ...arrivals.map(a => a.bounds)].some(p => overlapRect(r, p, .3)));
        if (stair) {
          const rising = stair.maxX === base.minX;
          for (const step of endpointStairRun(stair, 'x', h + (rising ? 0 : l.terrace), h + (rising ? l.terrace : 0))) {
            const s = add(`${id}/fractional-stair-${step.index}`, step.bounds, step.profile, 'stair', roof); s.support = 'solid'; s.supportBottom = h - .16;
          }
          terraceCuts.push(stair); feature.stairCount = 1;
        }
      }
    }
  }
  const occupied: Rect[] = [];
  const floors = (rects: Rect[], name: string, role: WalkableSurface['role'], ceiling: number) => {
    for (const [i, r] of union(rects).entries()) for (const [j, bounds] of cutRects([r], [...occupied, ...terraceCuts]).entries()) {
      const s = add(`${id}/${name}-${i}-${j}`, bounds, flat(h), role, ceiling); occupied.push(bounds);
      if (role === 'balcony') s.openEdges = ['north', 'south', 'east', 'west'];
    }
  };
  for (const arrival of arrivals) { add(arrival.id, arrival.bounds, flat(h), 'landing', roof); occupied.push(arrival.bounds); }
  if (story === a.lower) {
    const p = rectCenter(inner), landing = { minX: p.x - 1.2, maxX: p.x + 1.2, minZ: p.z - 1.2, maxZ: p.z + 1.2 };
    add(`${id}/liminal-arrival`, landing, flat(h), 'landing', roof); occupied.push(landing);
    floors(cutRects([inner], bearings), 'liminal-floor', 'floor', roof);
  }
  floors(bases, 'service', 'landing', h + 2.74);
  floors(thresholds, 'throat', 'landing', h + 2.74);
  floors(platformRects, 'visible-gallery', 'balcony', roof);
  if (story !== a.lower) w.floorOpenings!.push(...cutRects([b], occupied));
  if (story !== a.owner) w.ceilingOpenings!.push(inner);
  const ceiling = (bounds: Rect, y: number, name: string) => w.spatial!.ceilings.push({ id: `${id}/${name}`, roomId, ownerStory: story, layer: `regional/${story}`, role: 'floor',
    bounds, profile: flat(y + .03), ceilingY: y, thickness: .03, support: 'slab', access: 'sealed', edges: 'architecture' });
  union(bases).forEach((r, i) => ceiling(r, h + 2.74, `service-roof-${i}`));
  if (story === a.owner) ceiling(corridorInner, roof, 'liminal-roof');
  for (const [i, side] of sides.entries()) {
    const p = sidePoint(b, side, side === 'north' || side === 'south' ? rectCenter(b).x : rectCenter(b).z, (1.3 + a.ringWidth - .45) / 2);
    w.lights.push({ id: `${id}/service-light-${i}`, roomId, ...p, ceilingY: h + 2.74, width: 1.55, rotation: side === 'east' || side === 'west' ? Math.PI / 2 : 0,
      intensity: 1.08, color: 0xffffe4, dead: false, unstable: false, phase: 0, level: 0 });
  }
  if (story === a.owner) for (const sign of [-1, 1]) {
    const p = rectCenter(inner); w.lights.push({ id: `${id}/room-light-${sign}`, roomId, x: p.x + sign * rectWidth(inner) * .22, z: p.z, ceilingY: roof,
      width: 1.55, rotation: 0, intensity: 1.08, color: 0xffffe4, dead: false, unstable: false, phase: 0, level: 0 });
  }
  if (liminalGalleryPresent(a, story)) for (const side of active) for (const [index, o] of rows(story, side).entries()) {
    const depth = frontDepth(a, story), along = (o.min + o.max) / 2, source = sidePoint(inner, side, along, depth - .3);
    const s = findSurface(w, { ...source, referenceY: h, maxAbove: .01, maxBelow: .01 });
    if (s) { const d = destination(story, side, index, along); w.topology!.connections.push({ id: `${id}/gallery-drop-${side}-${index}`, from: s.id, to: d.surfaceId,
      at: source, arrival: d.position, width: o.max - o.min, kind: 'drop', direction: 'forward', access: 'open', toOwner: d.owner }); }
  }
  for (let s = a.lower; s <= a.owner; s++) if (s !== story) w.spatial!.dependencies.push({ owner: { ...w.spatial!.owner, story: s }, bounds: b,
    bottom: h + (a.lower - story) * 5.4, top: roof, reason: 'atrium' });
  for (const [side, dx, dz] of [['north', 0, -1], ['east', 1, 0], ['south', 0, 1], ['west', -1, 0]] as const) {
    const boundary = side === 'north' ? b.minZ : side === 'south' ? b.maxZ : side === 'west' ? b.minX : b.maxX;
    if (Math.abs(Math.abs(boundary) - 56) > .001) continue;
    const bounds = dx ? { ...b, minX: boundary - .3, maxX: boundary + .3 } : { ...b, minZ: boundary - .3, maxZ: boundary + .3 };
    for (let s = a.lower; s <= a.owner; s++) w.spatial!.dependencies.push({ owner: { x: w.spatial!.owner.x + dx, z: w.spatial!.owner.z + dz, story: s },
      bounds, bottom: h + (s - story) * 5.4, top: h + (s - story) * 5.4 + 2.74, reason: 'view' });
  }
  w.features.push(feature);
  w.spatial!.landmarks.push({ kind: `salle-liminale-${l.layout}`, position: { ...rectCenter(inner), y: h + .865 } });
};
