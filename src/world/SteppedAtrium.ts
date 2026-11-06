import { atriumFloorBounds, atriumRimPoints, atriumSection } from './AtriumEnvelope';
import type { AtriumPlan } from './RegionalPlan';
import { regionalCellId } from './RegionalPlan';
import { atriumArrival, atriumLandingPads } from './SpatialConnectors';
import { cutRects, findSurface, type HeightProfile, type WalkableSurface } from './WalkableTopology';
import { pointInRect, rectCenter, type Rect, type WorldPlan } from './types';

type AddSurface = (id: string, roomId: string, b: Rect, p: HeightProfile, role?: WalkableSurface['role'], roof?: boolean, ceiling?: number) => WalkableSurface;
/** Walkable rings, entry tunnels and directed drops share one canonical layout.
 * The bearing plinths are installed separately as disjoint owner bands. */
export const installSteppedAtrium = (w: WorldPlan, id: string, roomId: string, b: Rect, a: AtriumPlan, h: number, add: AddSurface): void => {
  const story = w.spatial!.owner.story, roofY = h + (a.owner - story) * 5.4 + 3.05;
  const section = atriumSection(b, a, story), pads = atriumLandingPads(b, h, a, story), rims = atriumRimPoints(b, a, story);
  const ledges = rims.map(p => p.dx ? { minX: Math.min(p.x, p.x - p.dx * 1.8), maxX: Math.max(p.x, p.x - p.dx * 1.8), minZ: p.z - 1.2, maxZ: p.z + 1.2 }
    : { minZ: Math.min(p.z, p.z - p.dz * 1.8), maxZ: Math.max(p.z, p.z - p.dz * 1.8), minX: p.x - 1.2, maxX: p.x + 1.2 });
  const ceiling = (bounds: Rect) => story < a.owner && !pointInRect(rectCenter(bounds).x, rectCenter(bounds).z, section.outer, -.001) ? h + 2.74 : roofY;
  atriumFloorBounds(b, a, story).forEach((base, i) => cutRects([base], [...pads.map(p => p.bounds), ...ledges]).forEach((bounds, j) =>
    add(`${id}/tier-${i}-${j}`, roomId, bounds, { kind: 'flat', y: h }, pointInRect(rectCenter(bounds).x, rectCenter(bounds).z, section.outer, -.001) ? 'balcony' : 'landing', false, ceiling(bounds))));
  for (const pad of pads) add(`${id}/arrival-${pad.index}`, roomId, pad.bounds, { kind: 'flat', y: h }, 'landing', false, ceiling(pad.bounds));
  ledges.forEach((base, i) => cutRects([base], pads.map(p => p.bounds)).forEach((bounds, j) => add(`${id}/ledge-${i}-${j}`, roomId, bounds, { kind: 'flat', y: h }, 'landing', false, roofY)));
  for (const [i, rim] of rims.entries()) {
    const at = { x: rim.x - rim.dx * .85, z: rim.z - rim.dz * .85 }, source = findSurface(w, { ...at, referenceY: h });
    if (!source) continue;
    const targetStory = story - 1, targetY = h - 5.4;
    const pad = atriumArrival(b, targetY, a, rim.x + rim.dx * .95, rim.z + rim.dz * .95, targetStory);
    const arrival = { ...pad.point, y: targetY }, targetId = regionalCellId(a.anchorX, a.anchorZ, targetStory);
    w.topology!.connections.push({ id: `${id}/tier-drop-${i}`, from: source.id, to: `${targetId}/arrival-${pad.index}`, at, arrival,
      width: 2.4, kind: 'drop', direction: 'forward', access: 'open', toOwner: { ...w.spatial!.owner, story: targetStory } });
  }
  w.spatial!.landmarks.push({ kind: 'galerie-en-gradins', position: { x: b.minX + section.outerInset + 1.2, y: h + .865, z: rectCenter(b).z } });
  if (story === a.owner) w.spatial!.ceilings.push({ id: `${id}/atrium-roof`, roomId, ownerStory: story, layer: `regional/${story}`, role: 'floor', bounds: b,
    profile: { kind: 'flat', y: roofY + .03 }, ceilingY: roofY, thickness: .03, support: 'slab', access: 'sealed', edges: 'architecture' });
};
