import type { Rect, Vec3Data } from './types';

/** Three playground tube slides set in an ordinary wallpapered wall, each with
 * its own marker scrawl. `turn` sends the tube left, straight down or right
 * behind the wall, so the three never cross. */
export const SLIDE_CHOICES = [
  { key: 'this-way', label: 'THIS WAY', color: 0x2459e6, turn: -1 },
  { key: 'unknown', label: '???', color: 0xf2c61c, turn: 0 },
  { key: 'exit', label: 'EXIT :)', color: 0x25b04e, turn: 1 },
] as const;
export type SlideKey = typeof SLIDE_CHOICES[number]['key'];
export const SLIDE_KEYS: readonly SlideKey[] = SLIDE_CHOICES.map(s => s.key);
export interface SlideEntryPlan {
  id: string;
  key: SlideKey;
  label: string;
  color: number;
  turn: -1 | 0 | 1;
  /** Centre of the circular mouth, on the wall face. */
  position: Vec3Data;
  /** Local stand-in-front volume and stable transition key for the next experience. */
  trigger: Rect;
  transitionKey: string;
}
export interface SlidesStructureFeature {
  kind: 'slides-structure';
  id: string;
  roomId: string;
  bounds: Rect;
  floorY: number;
  ceilingY: number;
  /** South face of the slide wall; the tubes run behind it, toward -Z. */
  wallZ: number;
  approach: Vec3Data;
  entries: SlideEntryPlan[];
}
export interface SlideChoice {
  structureId: string;
  entryId: string;
  key: SlideKey;
  transitionKey: string;
}

export const SLIDES_APPROACH = { x: 0, y: .865, z: 12 } as const;
export const SLIDES_HALL_CEILING = 3.05;
export const SLIDE_WALL_Z = -10;
export const SLIDE_WALL_DEPTH = .3;
/** Inner bore, plastic shell and the hole cut through the wallpaper. */
export const SLIDE_BORE = .5;
export const SLIDE_SHELL = .045;
export const SLIDE_HOLE = SLIDE_BORE + SLIDE_SHELL + .02;
/** The lip stands a few centimetres proud of the wall. */
export const SLIDE_LIP = .07;
const MOUTH_Y = 1.12, SPACING = 3.6;

export const createSlidesFeature = (): SlidesStructureFeature => ({
  kind: 'slides-structure', id: 'northern/slides', roomId: 'slides-hall', floorY: 0, ceilingY: SLIDES_HALL_CEILING, wallZ: SLIDE_WALL_Z,
  bounds: { minX: -9, maxX: 9, minZ: -28, maxZ: SLIDE_WALL_Z + 2.6 }, approach: { ...SLIDES_APPROACH },
  entries: SLIDE_CHOICES.map((s, i) => {
    const x = (i - 1) * SPACING;
    return { key: s.key, label: s.label, color: s.color, turn: s.turn, id: `northern/slides/${s.key}`,
      position: { x, y: MOUTH_Y, z: SLIDE_WALL_Z },
      trigger: { minX: x - 1.3, maxX: x + 1.3, minZ: SLIDE_WALL_Z, maxZ: SLIDE_WALL_Z + 2.6 }, transitionKey: `backrooms-slide-${s.key}` };
  }),
});

export interface SlidePathPoint { x: number; y: number; z: number; tx: number; ty: number; tz: number; s: number }
/** Centre line of a tube, from its lip to the dark bend where it leaves sight.
 * Shared by the rendered bore and the first-person ride of the dive. */
export const slidePath = (entry: SlideEntryPlan, samples = 72): SlidePathPoint[] => {
  const t = entry.turn, p = entry.position;
  // Relative to the mouth: a short level throat, then a falling, banking bend.
  const control: [number, number, number][] = t === 0
    ? [[0, 0, SLIDE_LIP + .5], [0, 0, SLIDE_LIP], [0, -.05, -.9], [0, -.45, -2.1], [.15, -1.2, -3.1], [.5, -2, -3.5], [.9, -2.55, -3.1], [1.2, -2.8, -2.7]]
    : [[0, 0, SLIDE_LIP + .5], [0, 0, SLIDE_LIP], [0, -.03, -.95], [t * .35, -.32, -2.2], [t * 1.3, -.95, -3.35], [t * 2.7, -1.55, -3.85], [t * 4, -2.05, -3.3], [t * 4.6, -2.25, -2.6]];
  const points = control.map(([x, y, z]) => ({ x: p.x + x, y: p.y + y, z: p.z + z }));
  // Centripetal Catmull-Rom between the inner control points (first/last are guides).
  const result: SlidePathPoint[] = [];
  const segments = points.length - 3;
  for (let i = 0; i <= samples; i++) {
    const u = i / samples * segments, k = Math.min(segments - 1, Math.floor(u)), f = u - k;
    const [a, b, c, d] = [points[k]!, points[k + 1]!, points[k + 2]!, points[k + 3]!];
    const axis = (A: number, B: number, C: number, D: number) => .5 * (2 * B + (-A + C) * f + (2 * A - 5 * B + 4 * C - D) * f * f + (-A + 3 * B - 3 * C + D) * f * f * f);
    const slope = (A: number, B: number, C: number, D: number) => .5 * ((-A + C) + 2 * (2 * A - 5 * B + 4 * C - D) * f + 3 * (-A + 3 * B - 3 * C + D) * f * f);
    const tx = slope(a.x, b.x, c.x, d.x), ty = slope(a.y, b.y, c.y, d.y), tz = slope(a.z, b.z, c.z, d.z), n = Math.hypot(tx, ty, tz) || 1;
    result.push({ x: axis(a.x, b.x, c.x, d.x), y: axis(a.y, b.y, c.y, d.y), z: axis(a.z, b.z, c.z, d.z), tx: tx / n, ty: ty / n, tz: tz / n, s: 0 });
  }
  for (let i = 1; i < result.length; i++) {
    const a = result[i - 1]!, b = result[i]!;
    b.s = a.s + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return result;
};

export interface SlideMeshData { positions: number[]; indices: number[]; uv: number[]; shade: number[] }
/** Rotation-minimising rings along the centre line: no twist in the bend.
 * `inner` faces the bore (the visible slide); the outer skin only exists where
 * the lip stands proud of the wall. The bore darkens as it leaves the room. */
export const slideTubeMesh = (entry: SlideEntryPlan, part: 'inner' | 'lip' = 'inner'): SlideMeshData => {
  const positions: number[] = [], indices: number[] = [], uv: number[] = [], shade: number[] = [];
  const sides = 40, path = part === 'inner' ? slidePath(entry) : [
    { x: entry.position.x, y: entry.position.y, z: entry.position.z + SLIDE_LIP, tx: 0, ty: 0, tz: -1, s: 0 },
    { x: entry.position.x, y: entry.position.y, z: entry.position.z - SLIDE_WALL_DEPTH * .5, tx: 0, ty: 0, tz: -1, s: SLIDE_LIP + SLIDE_WALL_DEPTH * .5 }];
  const radius = part === 'inner' ? SLIDE_BORE : SLIDE_BORE + SLIDE_SHELL;
  let nx = 0, ny = 1, nz = 0;
  for (const [r, p] of path.entries()) {
    // Project the previous normal onto this section's plane.
    const d = nx * p.tx + ny * p.ty + nz * p.tz;
    nx -= d * p.tx; ny -= d * p.ty; nz -= d * p.tz;
    const n = Math.hypot(nx, ny, nz) || 1; nx /= n; ny /= n; nz /= n;
    const bx = p.ty * nz - p.tz * ny, by = p.tz * nx - p.tx * nz, bz = p.tx * ny - p.ty * nx;
    const depth = Math.max(0, p.s - SLIDE_LIP);
    for (let j = 0; j <= sides; j++) {
      const a = j / sides * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      positions.push(p.x + (nx * c + bx * s) * radius, p.y + (ny * c + by * s) * radius, p.z + (nz * c + bz * s) * radius);
      uv.push(j / sides * 4, p.s / 1.2);
      // The floor of the bore catches the room light; the crown is in shadow.
      const lit = part === 'lip' ? 1 : Math.max(.015, Math.exp(-depth / 2.1) * (.8 - .2 * c));
      shade.push(lit);
    }
    if (r === path.length - 1) break;
  }
  for (let r = 0; r < path.length - 1; r++) for (let j = 0; j < sides; j++) {
    const a = r * (sides + 1) + j, b = a + sides + 1, c = b + 1, d = a + 1;
    // [a,c,b] winds outward (+N at angle 0): the bore is seen from inside.
    indices.push(...(part === 'inner' ? [a, b, c, a, c, d] : [a, c, b, a, d, c]));
  }
  return { positions, indices, uv, shade };
};
