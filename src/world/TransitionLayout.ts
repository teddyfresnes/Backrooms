import { SeededRandom } from './SeededRandom';
import type { Rect } from './types';
import { rectDepth, rectWidth } from './types';
import { endpointStairRun, offsetProfile, profileY } from './SpatialGeometry';
import type { HeightProfile } from './WalkableTopology';

export type TransitionSide = 'north' | 'east' | 'south' | 'west';
export interface TransitionLayout {
  id: string; roomId: string; bounds: Rect; axis: 'x' | 'z';
  startY: number; endY: number; width: number; wallThickness: number;
  enclosure: 'open' | 'wall' | 'chamber'; wallSide?: -1 | 1; kind: 'ramp' | 'stairs';
  /** A retained room roof, the real next owner's flight slab, or an enclosed roof. */
  roofPolicy: 'room' | 'upper-slab' | 'flight';
  roomRoofJoin?: { bottom: number; top: number };
  /** Canonical full connection; its two clipped halves are one flight. */
  linkId: string; composition: 'single' | 'landing'; clearance: number;
  approach: { bounds: Rect; y: number }; landing: { bounds: Rect; y: number };
  run: Rect; profile: HeightProfile; roof: HeightProfile;
  approachCeilingY: number; landingCeilingY: number;
}

/** The two halves share their width and landing datum. Length, pitch and
 * risers are solved before BSP reservations, rather than carved into a room. */
export const planRegionalTransition = (seed: string, gx: number, gz: number, _story: number,
  side: TransitionSide, bounds: Rect, floorY: number, neighborY: number, id: string): TransitionLayout => {
  const axis = side === 'east' || side === 'west' ? 'x' : 'z';
  const reverse = side === 'west' || side === 'north';
  const dx = side === 'east' ? 1 : side === 'west' ? -1 : 0;
  const dz = side === 'south' ? 1 : side === 'north' ? -1 : 0;
  const pair = [`${gx}:${gz}`, `${gx + dx}:${gz + dz}`].sort().join('/');
  const rng = new SeededRandom(`${seed}:transition-chamber:v1:${pair}`);
  let width = rng.pick([4, 4.8, 5.6]);
  const landingY = (floorY + neighborY) / 2;
  const difference = Math.abs(landingY - floorY);
  const center = axis === 'x' ? (bounds.minX + bounds.maxX) / 2 : (bounds.minZ + bounds.maxZ) / 2;
  const edge = axis === 'x' ? reverse ? bounds.minX : bounds.maxX : reverse ? bounds.minZ : bounds.maxZ;
  const available = Math.abs(edge - center);
  const approachDepth = 2.2;
  const composition = difference > 5.5 || rng.fork('composition').chance(.8) ? 'single' : 'landing';
  const seamDepth = composition === 'single' ? 0 : 2.2;
  const clearance = 3.05;
  if (difference > 6) width = 4;
  const minimumRun = Math.max(2.6, difference / .94);
  const inner = Math.min(rng.float(3.6, 7.8), available - approachDepth - seamDepth - minimumRun);
  const sign = reverse ? -1 : 1;
  const core = center + sign * Math.max(width / 2 + .55, inner);
  const first = core + sign * approachDepth, last = edge - sign * seamDepth;
  const cross = axis === 'x' ? (bounds.minZ + bounds.maxZ) / 2 : (bounds.minX + bounds.maxX) / 2;
  const rect = (a: number, b: number): Rect => axis === 'x'
    ? { minX: Math.min(a, b), maxX: Math.max(a, b), minZ: cross - width / 2, maxZ: cross + width / 2 }
    : { minZ: Math.min(a, b), maxZ: Math.max(a, b), minX: cross - width / 2, maxX: cross + width / 2 };
  const run = rect(first, last), startY = reverse ? landingY : floorY, endY = reverse ? floorY : landingY;
  const grade = difference / (axis === 'x' ? rectWidth(run) : rectDepth(run));
  const kind = grade <= .4 && rng.fork('finish').chance(.82) ? 'ramp' : 'stairs';
  const profile: HeightProfile = { kind: 'linear', axis, startY, endY };
  return { id, roomId: `${id}/chamber`, bounds: rect(core, edge), axis, startY, endY, width,
    linkId: `transition/${pair}/${_story}`, composition, clearance,
    wallThickness: rng.pick([.6, .8, 1.05]), enclosure: 'open', roofPolicy: 'flight', kind,
    approach: { bounds: rect(core, first), y: floorY }, landing: { bounds: rect(last, edge), y: landingY },
    run, profile, roof: offsetProfile(profile, clearance), approachCeilingY: floorY + clearance, landingCeilingY: landingY + clearance };
};

/** Match both endpoint rooms. The midpoint is shared by the two canonical
 * halves; varying headroom does not change the flight footprint or its rise. */
export const fitTransitionEnvironment = (t: TransitionLayout, sourceCeilingY: number, targetCeilingY: number, coverage: readonly number[], uniformRoomRoofs = true): void => {
  const targetFloor = 2 * t.landing.y - t.approach.y;
  const sourceHeadroom = Math.max(2.74, sourceCeilingY - t.approach.y), targetHeadroom = Math.max(2.74, targetCeilingY - targetFloor);
  t.approachCeilingY = t.approach.y + sourceHeadroom;
  t.landingCeilingY = t.landing.y + (sourceHeadroom + targetHeadroom) / 2;
  const sourceAtMin = t.axis === 'x' ? t.approach.bounds.maxX <= t.run.minX + .001 : t.approach.bounds.maxZ <= t.run.minZ + .001;
  t.roof = { kind: 'linear', axis: t.axis, startY: sourceAtMin ? t.approachCeilingY : t.landingCeilingY, endY: sourceAtMin ? t.landingCeilingY : t.approachCeilingY };
  t.clearance = Math.min(sourceHeadroom, (sourceHeadroom + targetHeadroom) / 2);
  t.enclosure = Math.min(...coverage) >= .5 ? 'chamber' : Math.max(...coverage) >= .35 ? 'wall' : 'open';
  if (t.enclosure === 'wall') t.wallSide = coverage[0]! >= coverage[1]! ? -1 : 1; else delete t.wallSide;
  t.roofPolicy = 'flight';
  delete t.roomRoofJoin;
  if (t.enclosure === 'chamber') return;
  if (uniformRoomRoofs && sourceCeilingY >= Math.max(t.approach.y, t.landing.y) + 2.74
    && targetCeilingY >= Math.max(targetFloor, t.landing.y) + 2.74) {
    t.roofPolicy = 'room';
    t.approachCeilingY = t.landingCeilingY = sourceCeilingY;
    t.roof = { kind: 'flat', y: sourceCeilingY };
    t.clearance = sourceCeilingY - Math.max(t.startY, t.endY);
    if (Math.abs(sourceCeilingY - targetCeilingY) > .001)
      t.roomRoofJoin = { bottom: Math.min(sourceCeilingY, targetCeilingY) + .03, top: Math.max(sourceCeilingY, targetCeilingY) };
  } else {
    // Open through the actual next slab, not a separate diagonal ceiling tile.
    // Both owners have the exact same flight/tread footprint, shifted by 5.4 m.
    t.roofPolicy = 'upper-slab';
    const normalY = 1 / Math.hypot(1, (t.endY - t.startY) / (t.axis === 'x' ? rectWidth(t.run) : rectDepth(t.run)));
    const underside = t.kind === 'stairs' ? .27 : .16 / normalY;
    t.roof = offsetProfile(t.profile, 5.4 - underside);
    t.approachCeilingY = t.approach.y + 5.24; t.landingCeilingY = t.landing.y + 5.24;
    t.clearance = 5.4 - underside;
  }
};

/** A wall-backed flight reserves only that side's real wall thickness. */
export const transitionRoofBounds = (t: TransitionLayout, bounds: Rect = t.bounds): Rect => {
  const b = { ...bounds }, sides = t.enclosure === 'chamber' ? [-1, 1] : t.enclosure === 'wall' ? [t.wallSide!] : [];
  for (const side of sides) if (t.axis === 'x') { if (side < 0) b.minZ -= t.wallThickness; else b.maxZ += t.wallThickness; }
  else { if (side < 0) b.minX -= t.wallThickness; else b.maxX += t.wallThickness; }
  return b;
};

export const restrictProfile = (bounds: Rect, profile: HeightProfile, part: Rect): HeightProfile => profile.kind === 'flat'
  ? { ...profile } : { ...profile, startY: profileY(bounds, profile, part.minX, part.minZ), endY: profileY(bounds, profile, part.maxX, part.maxZ) };

export const transitionTreads = (t: TransitionLayout): { bounds: Rect; profile: HeightProfile; index: number }[] =>
  t.kind === 'ramp' ? [{ bounds: t.run, profile: t.profile, index: 0 }]
    : endpointStairRun(t.run, t.axis, t.startY, t.endY);
