import { SeededRandom } from './SeededRandom';
import { clearEventFootprint, findEventWallMount, type WallMount } from './EnvironmentEvents';
import { isRedZoneRow, isSlidesRow, NORTHERN_LAYOUT } from './NorthernLayout';
import { pointInRect, rectArea, rectCenter, rectDepth, rectWidth, type Rect, type Vec3Data, type WorldPlan } from './types';

export interface LightingCircuitPlan {
  id: string;
  roomId: string;
  bounds: Rect;
  floorY: number;
  ceilingY: number;
  mode: 'ambient' | 'repair';
  mount?: WallMount;
}
export interface NorthernWorldPlan {
  kind: 'approach' | 'red-zone' | 'slides-approach';
  circuits: LightingCircuitPlan[];
  /** A real, empty, walkable approach reserved for the next structure generator. */
  slides?: { id: string; kind: 'slides'; roomId: string; bounds: Rect; position: Vec3Data };
}
const inset = (b: Rect, n: number): Rect => ({ minX: b.minX+n, maxX: b.maxX-n, minZ: b.minZ+n, maxZ: b.maxZ-n });

const reserveSlides = (plan: WorldPlan, owner: { x: number; z: number; story: number }, roomId: string, bounds: Rect, position: Vec3Data): void => {
  plan.northern!.slides = { id: 'northern/slides', kind: 'slides', roomId, bounds: { ...bounds }, position };
  plan.spatial!.landmarks.push({ kind: 'slides', position: { ...position, y: position.y + .865 }, owner: { ...owner } });
};

/** Consume FINAL BSP floors/walls; no obstacles, doors or passages are altered. */
export const populateNorthernWorld = (plan: WorldPlan, seed: string, owner: { x: number; z: number; story: number }): void => {
  if (!plan.spatial) return;
  const red = isRedZoneRow(owner.z), slides = isSlidesRow(owner.z), before = owner.z > NORTHERN_LAYOUT.riftRow;
  if (!red && !slides && !before) return;
  const rng = new SeededRandom(`${seed}:northern-v1:${owner.x}:${owner.z}:${owner.story}`);
  plan.northern = { kind: red ? 'red-zone' : slides ? 'slides-approach' : 'approach', circuits: [] };
  // Replace historical large blackouts on this progression with small circuits.
  for (const l of plan.lights) if ((plan.unlitZones ?? []).some(b => pointInRect(l.x, l.z, b))) l.dead = false;
  plan.unlitZones = [];
  const rooms = rng.shuffle(plan.rooms.filter(r => r.access !== 'sealed' && r.access !== 'secret' && r.ceilingHeight - (r.floorY ?? 0) >= 2.6
    && !plan.features.some(f => 'roomId' in f && f.roomId === r.id)
    && !plan.topology?.surfaces.some(s => s.roomId === r.id && (s.profile.kind !== 'flat' || s.access !== 'open'))));
  if (slides) {
    // A stable destination on actual supporting geometry, not an arbitrary point
    // that could be inside a wall/shaft. The detailed slides plug into this hook.
    for (const r of rooms.slice().sort((a,b) => {
      const a0=rectCenter(a.bounds), b0=rectCenter(b.bounds); return Math.hypot(a0.x,a0.z)-Math.hypot(b0.x,b0.z);
    })) {
      const c = rectCenter(r.bounds), floor = r.floorY ?? 0;
      if (!clearEventFootprint(plan, { minX:c.x-.9,maxX:c.x+.9,minZ:c.z-.9,maxZ:c.z+.9 },floor)) continue;
      reserveSlides(plan, owner, r.id, r.bounds, { ...c, y: floor });
      break;
    }
    // Unusual regional galleries can have no eligible BSP room. Use an open
    // supporting slab instead; a missing decorative room must not drop a main
    // destination. Keep the exact approach clear for the future generator.
    if (!plan.northern.slides) for (const s of plan.topology?.surfaces ?? []) {
      if (!s.roomId || s.access !== 'open' || s.profile.kind !== 'flat' || rectWidth(s.bounds) < 1.8 || rectDepth(s.bounds) < 1.8
        || plan.rooms.some(r => r.id === s.roomId && (r.access === 'sealed' || r.access === 'secret'))) continue;
      const c = rectCenter(s.bounds), b = { minX: c.x - .65, maxX: c.x + .65, minZ: c.z - .65, maxZ: c.z + .65 };
      if (!clearEventFootprint(plan, b, s.profile.y)) continue;
      reserveSlides(plan, owner, s.roomId, s.bounds, { ...c, y: s.profile.y });
      break;
    }
    return;
  }
  if (before && !rng.chance(.42)) return;
  for (const r of rooms) {
    if (plan.northern.circuits.length >= (red ? 2 : 1)) break;
    if (rectArea(r.bounds) < 16 || rectWidth(r.bounds)<3.6 || rectDepth(r.bounds)<3.6) continue;
    const floor = r.floorY ?? 0;
    const mount = findEventWallMount(plan,r,false);
    if (!mount) continue;
    const normal = { x:Math.sin(mount.yaw),z:Math.cos(mount.yaw) };
    const roomBounds = inset(r.bounds,.04);
    let bounds: Rect | undefined;
    // Fit the existing room and slab: large patches can cross a BSP pillar or
    // an adjacent datum even when the wall-mounted switch itself is reachable.
    for (const span of red ? [10, 8, 6] : [6, 4]) {
      const center = { x:mount.position.x+normal.x*span*.46,z:mount.position.z+normal.z*span*.46 };
      const candidate = {minX:Math.max(roomBounds.minX,center.x-span/2),maxX:Math.min(roomBounds.maxX,center.x+span/2),
        minZ:Math.max(roomBounds.minZ,center.z-span/2),maxZ:Math.min(roomBounds.maxZ,center.z+span/2)};
      if (rectWidth(candidate)>=3 && rectDepth(candidate)>=3 && clearEventFootprint(plan,inset(candidate,.35),floor)) { bounds = candidate; break; }
    }
    if (!bounds) continue;
    const center = rectCenter(bounds);
    if (plan.northern.circuits.some(c => Math.hypot(rectCenter(c.bounds).x-center.x,rectCenter(c.bounds).z-center.z)<14)) continue;
    plan.northern.circuits.push({id:`northern/circuit/${r.id}`,roomId:r.id,bounds,floorY:floor,ceilingY:r.ceilingHeight,
      mode:red?'repair':'ambient',...(red?{mount}: {})});
  }
};
