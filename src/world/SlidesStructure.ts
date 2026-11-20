import type { Rect, Vec3Data } from './types';

export const SLIDE_CHOICES = [
  { key: 'home', label: 'HOME', color: 0x72e6ca, bend: 4.8 },
  { key: 'fun', label: 'FUN :)', color: 0xffd638, bend: 5.2 },
  { key: 'death', label: 'DEATH', color: 0x9764d7, bend: 5.5 },
  { key: 'danger', label: 'DANGER', color: 0xff791e, bend: 5 },
] as const;
export type SlideKey = typeof SLIDE_CHOICES[number]['key'];
export interface SlideEntryPlan {
  id: string;
  key: SlideKey;
  label: string;
  color: number;
  bend: number;
  position: Vec3Data;
  /** Local walk-up volume and stable transition key for the next experience. */
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
export const createSlidesFeature = (): SlidesStructureFeature => ({
  kind: 'slides-structure', id: 'northern/slides', roomId: 'slides-hall', floorY: 0, ceilingY: 4.85,
  bounds: { minX: -20, maxX: 20, minZ: -23, maxZ: -5.4 }, approach: { ...SLIDES_APPROACH },
  entries: SLIDE_CHOICES.map((s, i) => {
    const x = (i - 1.5) * 7.6;
    return { ...s, id: `northern/slides/${s.key}`, position: { x, y: 1.5, z: -7 },
      trigger: { minX: x - 1.05, maxX: x + 1.05, minZ: -7.3, maxZ: -4.8 }, transitionKey: `backrooms-slide-${s.key}` };
  }),
});

export interface SlideMeshData { positions: number[]; indices: number[]; uv: number[]; shade: number[] }
/** Pure shared mesh data: Three renders the same rings Rapier collides with.
 * Parallel sections make the intentionally skewed bends vanish into the wall. */
export const slideTubeMesh = (entry: SlideEntryPlan, outer = false): SlideMeshData => {
  const positions: number[] = [], indices: number[] = [], uv: number[] = [], shade: number[] = [];
  const rings = 28, sides = 40;
  for (let r = 0; r <= rings; r++) {
    const t = r / rings, bend = Math.max(0, (t - .18) / .82), radius = (t < .32 ? 1.34 - .12 * t / .32 : 1.22 - .22 * (t - .32) / .68) + (outer ? .085 : 0);
    const x = entry.position.x + entry.bend * bend * bend, y = entry.position.y - .3 * t;
    for (let j = 0; j <= sides; j++) {
      const a = j / sides * Math.PI * 2;
      positions.push(x + Math.cos(a) * radius, y + Math.sin(a) * radius, entry.position.z - 14.8 * t);
      uv.push(j / sides * 3, t * 7);
      shade.push(outer ? 1 : Math.max(.015, Math.pow(1 - t, 3)));
    }
  }
  for (let r = 0; r < rings; r++) for (let j = 0; j < sides; j++) {
    const a = r * (sides + 1) + j, b = a + sides + 1, c = b + 1, d = a + 1;
    indices.push(...(outer ? [a,b,c,a,c,d] : [a,c,b,a,d,c]));
  }
  return { positions, indices, uv, shade };
};

/** A rectangular concrete panel with a real circular aperture, front AND back. */
export const slideFacadeMesh = (entry: SlideEntryPlan): SlideMeshData => {
  const positions: number[] = [], indices: number[] = [], uv: number[] = [], shade: number[] = [];
  const x = entry.position.x, y = entry.position.y, radius = 1.35;
  const corners=[[-3.8,-y],[3.8,-y],[-3.8,4.6-y],[3.8,4.6-y]].map(([dx,dy])=>(Math.atan2(dy!,dx!)+Math.PI*2)%(Math.PI*2));
  const angles=[...Array.from({length:40},(_,j)=>j/40*Math.PI*2),...corners,Math.PI*2].sort((a,b)=>a-b),sides=angles.length-1;
  for (const z of [-10, -10.7]) for (const a of angles) {
    const dx = Math.cos(a), dy = Math.sin(a);
    const distance = Math.min(3.8 / Math.max(.00001, Math.abs(dx)), (dy >= 0 ? 4.6-y : y) / Math.max(.00001, Math.abs(dy)));
    for (const d of [radius, distance]) { positions.push(x+dx*d,y+dy*d,z); uv.push((x+dx*d)/3,(y+dy*d)/3); shade.push(1); }
  }
  const stride = (sides+1)*2;
  for (let j = 0; j < sides; j++) {
    const a=j*2,b=a+2;
    indices.push(a,a+1,b,b,a+1,b+1, a+stride,b+stride,a+1+stride,b+stride,b+1+stride,a+1+stride);
    indices.push(a,b,a+stride,b,b+stride,a+stride);
  }
  return { positions, indices, uv, shade };
};
