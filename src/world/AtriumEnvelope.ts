import type { AtriumPlan } from './RegionalPlan';
import type { Rect } from './types';
import { rectCenter, rectDepth, rectWidth } from './types';
import { cutRects } from './WalkableTopology';

export const insetAtrium = (b: Rect, d: number): Rect => ({ minX: b.minX + d, maxX: b.maxX - d, minZ: b.minZ + d, maxZ: b.maxZ - d });
/** Each lower terrace advances towards the centre, leaving a real central room. */
export const atriumSection = (b: Rect, a: AtriumPlan, story: number) => {
  const depth = a.owner - a.lower, level = Math.min(depth - 1, a.owner - story);
  const outerInset = a.perimeter === 'stepped' && level > 0 ? a.ringWidth + (level - 1) * a.terraceWidth : 0;
  const innerInset = a.ringWidth + (a.perimeter === 'stepped' ? level * a.terraceWidth : 0);
  return { outer: insetAtrium(b, outerInset), hole: insetAtrium(b, innerInset), outerInset, innerInset };
};

/** Four-sided entrances continue through every bearing plinth. Their positions
 * match the canonical 28m facade gates, even in a 56m-wide room. */
export const atriumPassages = (b: Rect, a: AtriumPlan, story: number): Rect[] => {
  const { innerInset } = atriumSection(b, a, story), result: Rect[] = [];
  const distance = innerInset + (story === a.lower ? 1.2 : 0);
  for (const side of ['north', 'south', 'west', 'east'] as const) {
    const alongX = side === 'north' || side === 'south', span = alongX ? rectWidth(b) : rectDepth(b), start = alongX ? b.minX : b.minZ;
    for (let i = 0; i < Math.round(span / 28); i++) {
      const cross = start + (i + .5) * 28;
      result.push(alongX ? { minX: cross - 2, maxX: cross + 2, minZ: side === 'north' ? b.minZ : b.maxZ - distance, maxZ: side === 'north' ? b.minZ + distance : b.maxZ }
        : { minZ: cross - 2, maxZ: cross + 2, minX: side === 'west' ? b.minX : b.maxX - distance, maxX: side === 'west' ? b.minX + distance : b.maxX });
    }
  }
  return result;
};

export const atriumFloorBounds = (b: Rect, a: AtriumPlan, story: number): Rect[] => {
  const s = atriumSection(b, a, story);
  const main = story === a.lower ? [s.hole] : story === a.owner || a.perimeter === 'stepped' ? cutRects([s.outer], [s.hole]) : [];
  const result = [...main];
  for (const passage of atriumPassages(b, a, story)) result.push(...cutRects([passage], result));
  return result;
};

export interface AtriumSupportBand { bounds: Rect; bottom: number; top: number; tier: number; lintel: boolean }
/** Every owner supplies disjoint vertical bands of the same filled plinths.
 * Doorways are subtracted in volume, not painted onto their front face. */
export const atriumSupportBands = (b: Rect, a: AtriumPlan, story: number, datum: number, extraPassages: readonly Rect[] = []): AtriumSupportBand[] => {
  const result: AtriumSupportBand[] = [], cuts = [...atriumPassages(b, a, story), ...extraPassages];
  const tiers = a.perimeter === 'stepped' ? a.owner - a.lower : 1;
  for (let tier = 0; tier < tiers; tier++) {
    const level = a.owner - tier, section = atriumSection(b, a, level);
    const top = Math.min(datum + 5.24, datum + (level - story) * 5.4 - .16), bottom = datum - .16;
    if (top <= bottom + .001) continue;
    for (const ring of cutRects([section.outer], [section.hole])) {
      for (const bounds of cutRects([ring], cuts)) result.push({ bounds, bottom, top, tier, lintel: false });
      if (top > datum + 2.74) for (const passage of cuts) {
        const bounds = { minX: Math.max(ring.minX, passage.minX), maxX: Math.min(ring.maxX, passage.maxX), minZ: Math.max(ring.minZ, passage.minZ), maxZ: Math.min(ring.maxZ, passage.maxZ) };
        if (rectWidth(bounds) > .001 && rectDepth(bounds) > .001)
          result.push({ bounds, bottom: datum + 2.74, top, tier, lintel: true });
      }
    }
  }
  return result;
};

export const atriumRimPoints = (b: Rect, a: AtriumPlan, story: number) => {
  const { hole } = atriumSection(b, a, story), p = rectCenter(b);
  return [{ x: hole.minX, z: p.z, dx: 1, dz: 0 }, { x: hole.maxX, z: p.z, dx: -1, dz: 0 },
    { x: p.x, z: hole.minZ, dx: 0, dz: 1 }, { x: p.x, z: hole.maxZ, dx: 0, dz: -1 }];
};

export const atriumEntryLightPoints = (b: Rect, a: AtriumPlan) => {
  const result: { x: number; z: number }[] = [], depth = a.ringWidth / 2;
  for (const side of ['north', 'south', 'west', 'east'] as const) {
    const alongX = side === 'north' || side === 'south', span = alongX ? rectWidth(b) : rectDepth(b), start = alongX ? b.minX : b.minZ;
    for (let i = 0; i < Math.round(span / 28); i++) result.push(alongX
      ? { x: start + (i + .5) * 28, z: side === 'north' ? b.minZ + depth : b.maxZ - depth }
      : { z: start + (i + .5) * 28, x: side === 'west' ? b.minX + depth : b.maxX - depth });
  }
  return result;
};
