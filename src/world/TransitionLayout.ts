import { SeededRandom } from './SeededRandom';
import type { Rect } from './types';
import { endpointStairRun, offsetProfile, profileY, RAMP_MAX_GRADE, STAIR_TREAD, stairStepCount } from './SpatialGeometry';
import type { HeightProfile } from './WalkableTopology';

export type TransitionSide = 'north' | 'east' | 'south' | 'west';

export interface TransitionLayout {
  id: string; roomId: string; bounds: Rect; axis: 'x' | 'z';
  startY: number; endY: number; width: number; wallThickness: number;
  enclosure: 'open' | 'wall' | 'chamber'; wallSide?: -1 | 1; kind: 'ramp' | 'stairs';
  /** Canonical full connection; its two clipped halves are one flight. */
  linkId: string; composition: 'single' | 'landing'; clearance: number;
  approach: { bounds: Rect; y: number }; landing: { bounds: Rect; y: number };
  /** The roof is parallel to the steps, `HEADROOM` above them: it starts at each
   * district's own ceiling height on the flat approach and reaches the shared
   * landing datum at the seam. A flat roof at the upper district's height gave
   * the lower half a ceiling up to 2 m above its rooms, and a deep bulkhead. */
  run: Rect; profile: HeightProfile; roof: HeightProfile;
  approachCeilingY: number; landingCeilingY: number;
  /** Risers of this half (0 for a ramp) and their exact height. */
  steps: number; riser: number;
}

/** District floors differ by whole quanta: see `regionalDatum`. */
export const DATUM_QUANTUM = .9;
const HEADROOM = 3.05;

/** The pitch is fixed first; the footprint follows from the rise. Both halves
 * share width, finish, enclosure and landing datum, and each stays between its
 * own floor slab and the next one: nothing is cut through. */
export const planRegionalTransition = (seed: string, gx: number, gz: number, _story: number,
  side: TransitionSide, bounds: Rect, floorY: number, neighborY: number, id: string): TransitionLayout => {
  const axis = side === 'east' || side === 'west' ? 'x' : 'z';
  const reverse = side === 'west' || side === 'north';
  const dx = side === 'east' ? 1 : side === 'west' ? -1 : 0;
  const dz = side === 'south' ? 1 : side === 'north' ? -1 : 0;
  const pair = [`${gx}:${gz}`, `${gx + dx}:${gz + dz}`].sort().join('/');
  const rng = new SeededRandom(`${seed}:regional-threshold:v2:${pair}`);
  const width = rng.pick([4, 4.8, 5.6]);
  const landingY = (floorY + neighborY) / 2;
  const rise = Math.abs(landingY - floorY), total = rise * 2;
  const edge = axis === 'x' ? reverse ? bounds.minX : bounds.maxX : reverse ? bounds.minZ : bounds.maxZ;
  // A gentle rise may be a 1:8 ramp; anything taller is a flight.
  const kind = rise <= DATUM_QUANTUM + .001 && rng.fork('finish').chance(rise <= DATUM_QUANTUM / 2 + .001 ? .45 : .3) ? 'ramp' : 'stairs';
  const steps = kind === 'stairs' ? stairStepCount(rise) : 0;
  const runLength = kind === 'stairs' ? steps * STAIR_TREAD : rise / RAMP_MAX_GRADE;
  const composition = kind === 'stairs' && rise >= DATUM_QUANTUM - .001 && rng.fork('composition').chance(.3) ? 'landing' : 'single';
  const seamDepth = composition === 'landing' ? 1.6 : 0, approachDepth = 2.2;
  // More than two quanta of total rise would not fit under a flat ceiling.
  const tall = total > DATUM_QUANTUM * 2 + .001;
  const enclosure = tall ? 'chamber' as const : rng.fork('enclosure').weighted([
    { value: 'open' as const, weight: .4 }, { value: 'wall' as const, weight: .25 }, { value: 'chamber' as const, weight: .35 }]);
  const wallSide = rng.fork('wall-side').chance(.5) ? -1 as const : 1 as const;
  const sign = reverse ? -1 : 1;
  const last = edge - sign * seamDepth, first = last - sign * runLength, core = first - sign * approachDepth;
  const cross = axis === 'x' ? (bounds.minZ + bounds.maxZ) / 2 : (bounds.minX + bounds.maxX) / 2;
  const rect = (a: number, b: number): Rect => axis === 'x'
    ? { minX: Math.min(a, b), maxX: Math.max(a, b), minZ: cross - width / 2, maxZ: cross + width / 2 }
    : { minZ: Math.min(a, b), maxZ: Math.max(a, b), minX: cross - width / 2, maxX: cross + width / 2 };
  const run = rect(first, last), startY = reverse ? landingY : floorY, endY = reverse ? floorY : landingY;
  const profile: HeightProfile = { kind: 'linear', axis, startY, endY };
  const approachCeilingY = floorY + HEADROOM, landingCeilingY = landingY + HEADROOM;
  return { id, roomId: `${id}/chamber`, bounds: rect(core, edge), axis, startY, endY, width,
    linkId: `transition/${pair}/${_story}`, composition, kind, steps, riser: steps ? rise / steps : 0,
    wallThickness: rng.pick([.6, .8, 1.05]), enclosure, ...(enclosure === 'wall' ? { wallSide } : {}),
    approach: { bounds: rect(core, first), y: floorY }, landing: { bounds: rect(last, edge), y: landingY },
    run, profile, roof: offsetProfile(profile, HEADROOM), approachCeilingY, landingCeilingY, clearance: HEADROOM };
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
