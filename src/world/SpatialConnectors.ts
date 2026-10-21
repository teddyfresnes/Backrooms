import type { Rect } from './types';
import { rectCenter, rectDepth, rectWidth } from './types';
import type { AtriumPlan } from './RegionalPlan';
import { endpointStairRun } from './SpatialGeometry';
import { cutRects, overlapRect, type HeightProfile } from './WalkableTopology';

export interface SpatialStairLeg { name: string; bounds: Rect; axis: 'x' | 'z'; startY: number; endY: number; kind: 'ramp' | 'stairs' }
export interface AtriumCirculation { legs: SpatialStairLeg[]; landing?: { bounds: Rect; y: number }; exit: { x: number; y: number; z: number }; bridge: Rect }
export const atriumHole = (b: Rect, a: AtriumPlan): Rect => ({ minX: b.minX + a.ringWidth, maxX: b.maxX - a.ringWidth,
  minZ: b.minZ + a.ringWidth, maxZ: b.maxZ - a.ringWidth });
export const legTreads = (leg: SpatialStairLeg): { bounds: Rect; profile: HeightProfile; index: number }[] => leg.kind === 'ramp'
  ? [{ bounds: leg.bounds, profile: { kind: 'linear', axis: leg.axis, startY: leg.startY, endY: leg.endY }, index: 0 }]
  : endpointStairRun(leg.bounds, leg.axis, leg.startY, leg.endY);

/** Upper route, underside clearance and lower reservations consume this layout. */
export const atriumCirculation = (b: Rect, upper: number, a: AtriumPlan): AtriumCirculation => {
  const h = atriumHole(b, a), p = rectCenter(b), lower = upper - (a.owner - a.lower) * 5.4;
  const w = a.routeWidth, mid = upper + (lower - upper) * a.midFraction;
  const leg = (name: string, bounds: Rect, axis: 'x' | 'z', startY: number, endY: number): SpatialStairLeg => ({
    name, bounds, axis, startY, endY, kind: a.routeKind === 'ramp' && Math.abs(endY - startY) / (axis === 'x' ? rectWidth(bounds) : rectDepth(bounds)) <= .4 ? 'ramp' : 'stairs' });
  const bridgeZ = a.variant === 'bridge' ? rectDepth(h) >= rectWidth(h) ? h.minZ + rectDepth(h) * .8 : p.z : h.maxZ - w * 1.7;
  const bridge = { minX: h.minX, maxX: h.maxX, minZ: bridgeZ - w / 2, maxZ: bridgeZ + w / 2 };
  if (a.variant === 'bridge') {
    const alongX = rectWidth(h) > rectDepth(h);
    const bounds = alongX ? { minX: h.minX, maxX: h.maxX, minZ: h.maxZ - w, maxZ: h.maxZ }
      : { minX: h.maxX - w, maxX: h.maxX, minZ: h.minZ, maxZ: h.maxZ };
    return { legs: [leg('straight', bounds, alongX ? 'x' : 'z', upper, lower)],
      exit: alongX ? { x: h.maxX + .5, y: lower, z: h.maxZ - w / 2 } : { x: h.maxX - w / 2, y: lower, z: h.maxZ + .5 }, bridge };
  }
  const first = { minX: h.maxX - w, maxX: h.maxX, minZ: h.minZ, maxZ: h.maxZ - w };
  if (a.variant === 'U') return { legs: [leg('outbound', first, 'z', upper, mid),
    leg('return', { minX: h.maxX - 2 * w - .4, maxX: h.maxX - w - .4, minZ: h.minZ, maxZ: h.maxZ - w }, 'z', lower, mid)],
    landing: { bounds: { minX: h.maxX - 2 * w - .4, maxX: h.maxX, minZ: h.maxZ - w, maxZ: h.maxZ }, y: mid },
    exit: { x: h.maxX - 1.5 * w - .4, y: lower, z: h.minZ - .5 }, bridge };
  return { legs: [leg('outbound', first, 'z', upper, mid),
    leg('turn', { minX: h.minX, maxX: h.maxX - w, minZ: h.maxZ - w, maxZ: h.maxZ }, 'x', lower, mid)],
    landing: { bounds: { minX: h.maxX - w, maxX: h.maxX, minZ: h.maxZ - w, maxZ: h.maxZ }, y: mid },
    exit: { x: h.minX - .5, y: lower, z: h.maxZ - w / 2 }, bridge };
};

export const atriumTreads = (b: Rect, upper: number, a: AtriumPlan): { bounds: Rect; profile: HeightProfile }[] => {
  if (!a.stairs) return [];
  const route = atriumCirculation(b, upper, a);
  return [...route.legs.flatMap(legTreads), ...(route.landing ? [{ bounds: route.landing.bounds, profile: { kind: 'flat' as const, y: route.landing.y } }] : [])];
};
export interface GroundPatch { bounds: Rect; ceilingY: number; ceilingProfile?: HeightProfile }
export const atriumGround = (b: Rect, lower: number, a: AtriumPlan): GroundPatch[] => {
  let result: GroundPatch[] = [{ bounds: b, ceilingY: lower + (a.owner - a.lower) * 5.4 + 3.05 }];
  for (const step of atriumTreads(b, lower + (a.owner - a.lower) * 5.4, a)) {
    if (step.profile.kind === 'linear') {
      result = result.flatMap(p => cutRects([p.bounds], [step.bounds]).map(bounds => ({ ...p, bounds })));
      continue;
    }
    const floorProfile = step.profile;
    // Solid ramps own their filled footprint. Open stairs retain real usable
    // ground below the closed .27m treads.
    const ceiling = floorProfile.y - .27;
    result = result.flatMap(p => {
      if (!overlapRect(p.bounds, step.bounds)) return [p];
      const outside = cutRects([p.bounds], [step.bounds]).map(bounds => ({ bounds, ceilingY: p.ceilingY }));
      if (ceiling - lower < 2.5) return outside;
      return [...outside, { bounds: { minX: Math.max(p.bounds.minX, step.bounds.minX), maxX: Math.min(p.bounds.maxX, step.bounds.maxX),
        minZ: Math.max(p.bounds.minZ, step.bounds.minZ), maxZ: Math.min(p.bounds.maxZ, step.bounds.maxZ) }, ceilingY: Math.min(p.ceilingY, ceiling) }];
    });
  }
  return result;
};
export interface AtriumLandingPad { bounds: Rect; point: { x: number; z: number }; index: number }
export const atriumLandingPads = (b: Rect, lower: number, a: AtriumPlan): AtriumLandingPad[] => {
  const upper = lower + (a.owner - a.lower) * 5.4, center = rectCenter(b);
  const desired = [{ x: b.minX + 1.5, z: center.z }];
  if (a.stairs) desired.push(atriumCirculation(b, upper, a).exit);
  if (a.owner - a.lower > 1) for (const side of ['north', 'south', 'west', 'east']) {
    const alongX = side === 'east' || side === 'west', sign = side === 'north' || side === 'west' ? -1 : 1;
    const min = alongX ? b.minZ : b.minX, span = alongX ? rectDepth(b) : rectWidth(b);
    for (let i = 0; i < Math.round(span / 28); i++) {
      const cross = min + (i + .5) * 28;
      desired.push(alongX ? { x: sign < 0 ? b.minX + 6.75 : b.maxX - 6.75, z: cross }
        : { x: cross, z: sign < 0 ? b.minZ + 6.75 : b.maxZ - 6.75 });
    }
  }
  const ground = atriumGround(b, lower, a).filter(p => rectWidth(p.bounds) >= 1.7 && rectDepth(p.bounds) >= 1.7);
  const pads: AtriumLandingPad[] = [];
  for (const at of desired) {
    const candidates = ground.map(p => ({ x: Math.max(p.bounds.minX + .85, Math.min(p.bounds.maxX - .85, at.x)),
      z: Math.max(p.bounds.minZ + .85, Math.min(p.bounds.maxZ - .85, at.z)) }));
    candidates.sort((p, q) => Math.hypot(p.x - at.x, p.z - at.z) - Math.hypot(q.x - at.x, q.z - at.z));
    const point = candidates[0]; if (!point) continue;
    const bounds = { minX: point.x - .8, maxX: point.x + .8, minZ: point.z - .8, maxZ: point.z + .8 };
    if (pads.some(p => overlapRect(p.bounds, bounds, .01))) continue;
    pads.push({ bounds, point, index: pads.length });
  }
  return pads;
};
export const atriumArrival = (b: Rect, lower: number, a: AtriumPlan, x: number, z: number): AtriumLandingPad => {
  const pads = atriumLandingPads(b, lower, a);
  return pads.sort((p, q) => Math.hypot(p.point.x - x, p.point.z - z) - Math.hypot(q.point.x - x, q.point.z - z))[0]!;
};
export const atriumGroundId = (id: string, b: Rect, lower: number, a: AtriumPlan, x: number, z: number): string =>
  `${id}/arrival-${atriumArrival(b, lower, a, x, z).index}`;
