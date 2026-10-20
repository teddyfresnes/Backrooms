import type { Rect } from './types';
import { pointInRect, rectCenter } from './types';
import type { AtriumPlan } from './RegionalPlan';
import { endpointStairRun } from './SpatialGeometry';
import { cutRects, overlapRect, type HeightProfile } from './WalkableTopology';

export interface SpatialStairLeg { name: string; bounds: Rect; axis: 'x' | 'z'; startY: number; endY: number }
export interface AtriumCirculation { legs: SpatialStairLeg[]; landing?: { bounds: Rect; y: number }; exit: { x: number; y: number; z: number }; bridge: Rect }
/** One canonical route is read by upper construction, lower floor cuts,
 * support volumes, navigation and the streaming dependencies. */
export const atriumCirculation = (b: Rect, upper: number, a: AtriumPlan): AtriumCirculation => {
  const h = { minX: b.minX + 3, maxX: b.maxX - 3, minZ: b.minZ + 3, maxZ: b.maxZ - 3 }, p = rectCenter(b), lower = upper - 10.8;
  const bridgeZ = a.variant === 'bridge' ? p.z : p.z + 3.6;
  const bridge = { minX: h.minX, maxX: h.maxX, minZ: bridgeZ - 1.6, maxZ: bridgeZ + 1.6 };
  if (a.variant === 'bridge') return { legs: [{ name: 'straight', bounds: { minX: h.maxX - 3.2, maxX: h.maxX, minZ: h.minZ, maxZ: h.maxZ }, axis: 'z', startY: upper, endY: lower }],
    exit: { x: h.maxX - 1.6, y: lower, z: h.maxZ + .5 }, bridge };
  const first = { minX: h.maxX - 3.2, maxX: h.maxX, minZ: h.minZ, maxZ: h.maxZ - 3.2 };
  if (a.variant === 'U') return { legs: [{ name: 'outbound', bounds: first, axis: 'z', startY: upper, endY: upper - 5.4 },
    { name: 'return', bounds: { minX: h.maxX - 6.8, maxX: h.maxX - 3.6, minZ: h.minZ, maxZ: h.maxZ - 3.2 }, axis: 'z', startY: lower, endY: upper - 5.4 }],
    landing: { bounds: { minX: h.maxX - 6.8, maxX: h.maxX, minZ: h.maxZ - 3.2, maxZ: h.maxZ }, y: upper - 5.4 },
    exit: { x: h.maxX - 5.2, y: lower, z: h.minZ - .5 }, bridge };
  return { legs: [{ name: 'outbound', bounds: first, axis: 'z', startY: upper, endY: upper - 5.4 },
    { name: 'turn', bounds: { minX: h.minX, maxX: h.maxX - 3.2, minZ: h.maxZ - 3.2, maxZ: h.maxZ }, axis: 'x', startY: lower, endY: upper - 5.4 }],
    landing: { bounds: { minX: h.maxX - 3.2, maxX: h.maxX, minZ: h.maxZ - 3.2, maxZ: h.maxZ }, y: upper - 5.4 },
    exit: { x: h.minX - .5, y: lower, z: h.maxZ - 1.6 }, bridge };
};

export const atriumTreads = (b: Rect, upper: number, a: AtriumPlan): { bounds: Rect; profile: HeightProfile }[] => {
  if (!a.stairs) return [];
  const route = atriumCirculation(b, upper, a);
  return [...route.legs.flatMap(l => endpointStairRun(l.bounds, l.axis, l.startY, l.endY)),
    ...(route.landing ? [{ bounds: route.landing.bounds, profile: { kind: 'flat' as const, y: route.landing.y } }] : [])];
};
export interface GroundPatch { bounds: Rect; ceilingY: number }
export const atriumGround = (b: Rect, lower: number, a: AtriumPlan): GroundPatch[] => {
  let result: GroundPatch[] = [{ bounds: b, ceilingY: lower + 13.85 }];
  for (const step of atriumTreads(b, lower + 10.8, a)) {
    const ceiling = (step.profile.kind === 'flat' ? step.profile.y : Math.min(step.profile.startY, step.profile.endY)) - .16;
    result = result.flatMap(p => {
      if (!overlapRect(p.bounds, step.bounds)) return [p];
      const outside = cutRects([p.bounds], [step.bounds]).map(bounds => ({ bounds, ceilingY: p.ceilingY }));
      if (ceiling - lower < 2.5) return outside;
      return [...outside, { bounds: { minX: Math.max(p.bounds.minX, step.bounds.minX), maxX: Math.min(p.bounds.maxX, step.bounds.maxX), minZ: Math.max(p.bounds.minZ, step.bounds.minZ), maxZ: Math.min(p.bounds.maxZ, step.bounds.maxZ) }, ceilingY: Math.min(p.ceilingY, ceiling) }];
    });
  }
  return result;
};
export const atriumGroundId = (id: string, b: Rect, lower: number, a: AtriumPlan, x: number, z: number): string => {
  const i = atriumGround(b, lower, a).findIndex(p => pointInRect(x, z, p.bounds, -.001));
  return `${id}/floor${i > 0 ? `-${i}` : ''}`;
};
