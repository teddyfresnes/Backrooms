import type { Rect, WallSegment, WorldPlan } from './types';
import { rectCenter, rectDepth, rectWidth } from './types';
import { findSurface, overlapRect, surfaceY, type WalkableSurface } from './WalkableTopology';

const wallBounds = (w: WallSegment): Rect => ({
  minX: w.x - (w.orientation === 'x' ? w.length : w.thickness) / 2, maxX: w.x + (w.orientation === 'x' ? w.length : w.thickness) / 2,
  minZ: w.z - (w.orientation === 'z' ? w.length : w.thickness) / 2, maxZ: w.z + (w.orientation === 'z' ? w.length : w.thickness) / 2,
});

/** Cropped BSP corners can leave a slit that connects floor polygons but
 * cannot pass a capsule. Widen only actual opposing ordinary partitions;
 * a thin strip beside open floor is just tessellation and stays untouched. */
const widenBspPinches = (world: WorldPlan, carve: (wall: WallSegment, aperture: Rect) => void): boolean => {
  let changed = false;
  const exits = new Map<string, { x: number; z: number }[]>();
  for (const c of world.topology!.connections) if (!c.toOwner && c.kind === 'walk') {
    for (const id of [c.from, c.to]) { const points = exits.get(id) ?? []; points.push(c.at); exits.set(id, points); }
  }
  for (const s of world.topology!.surfaces) {
    if (s.role !== 'floor' || s.profile.kind !== 'flat') continue;
    const b = s.bounds, alongZ = rectWidth(b) < rectDepth(b), width = alongZ ? rectWidth(b) : rectDepth(b);
    if (width >= .949 || width < .08 || Math.max(rectWidth(b), rectDepth(b)) < 1) continue;
    const points = exits.get(s.id)?.map(p => alongZ ? p.z : p.x) ?? [];
    if (points.length < 2 || Math.max(...points) - Math.min(...points) < .68) continue;
    const min = alongZ ? b.minX : b.minZ, max = alongZ ? b.maxX : b.maxZ, y = s.profile.y;
    const walls = world.walls.filter(w => w.bottom < y + .1 && w.bottom + w.height > y + 1.75)
      .map(w => ({ w, b: wallBounds(w) }));
    for (const sign of [-1, 1]) {
      const near = walls.filter(p => Math.abs((alongZ ? sign < 0 ? p.b.maxX : p.b.minX : sign < 0 ? p.b.maxZ : p.b.minZ) - (sign < 0 ? min : max)) < .005);
      const opposite = walls.filter(p => Math.abs((alongZ ? sign < 0 ? p.b.minX : p.b.maxX : sign < 0 ? p.b.minZ : p.b.maxZ) - (sign < 0 ? max : min)) < .005);
      for (const p of near) {
        if (p.w.orientation !== (alongZ ? 'z' : 'x') || !p.w.id.includes('/bsp/') || p.w.detail || p.w.junctionRole) continue;
        const lo = Math.max(alongZ ? b.minZ : b.minX, alongZ ? p.b.minZ : p.b.minX);
        const hi = Math.min(alongZ ? b.maxZ : b.maxX, alongZ ? p.b.maxZ : p.b.maxX);
        if (hi <= lo || !opposite.some(q => Math.max(lo, alongZ ? q.b.minZ : q.b.minX) - Math.min(hi, alongZ ? q.b.maxZ : q.b.maxX) < .68)) continue;
        const low = sign < 0 ? max - .95 : min - .02, high = sign < 0 ? max + .02 : min + .95;
        const aperture: Rect = alongZ ? { minX: low, maxX: high, minZ: lo - .02, maxZ: hi + .02 }
          : { minZ: low, maxZ: high, minX: lo - .02, maxX: hi + .02 };
        if (Math.max(Math.abs(aperture.minX), Math.abs(aperture.maxX), Math.abs(aperture.minZ), Math.abs(aperture.maxZ)) > world.size / 2 - .08) continue;
        if (world.spatial?.transitions?.some(t => overlapRect(t.bounds, aperture)) || world.features.some(f => overlapRect(f.bounds, aperture))
          || world.floorOpenings?.some(r => overlapRect(r, aperture))) continue;
        const blockers = world.colliders.filter(c => c.kind === 'wall' && c.center.y - c.halfExtents.y < y + 1.75 && c.center.y + c.halfExtents.y > y + .1
          && overlapRect(aperture, { minX: c.center.x - c.halfExtents.x, maxX: c.center.x + c.halfExtents.x, minZ: c.center.z - c.halfExtents.z, maxZ: c.center.z + c.halfExtents.z }));
        const partitions = blockers.map(c => world.walls.find(w => w.id === c.id));
        if (!partitions.length || partitions.some(w => !w || !w.id.includes('/bsp/') || w.detail || w.junctionRole)) continue;
        for (const w of partitions) carve(w!, aperture);
        changed = true;
        break;
      }
    }
  }
  return changed;
};

/** Join genuine cropped BSP pockets through the smallest intervening ordinary
 * partition. Never carve an atrium, a regional facade, a ramp support or a door.
 * Rebuild from the original floor footprints after each bounded repair pass. */
export const stitchBspPartitions = (world: WorldPlan, rebuild: () => void, connect: () => void,
  carve: (wall: WallSegment, aperture: Rect) => void): void => {
  const floorHeight = (s: WalkableSurface) => s.profile.kind === 'flat' ? s.profile.y : Infinity;
  for (let pass = 0; pass < 8; pass++) {
    rebuild(); connect();
    if (pass === 0 && widenBspPinches(world, carve)) { rebuild(); connect(); }
    const surfaces = world.topology!.surfaces, graph = new Map<string, string[]>();
    const add = (a: string, b: string) => graph.set(a, [...(graph.get(a) ?? []), b]);
    for (const c of world.topology!.connections) if (!c.toOwner && c.kind !== 'view' && c.kind !== 'drop' && c.kind !== 'jump') {
      add(c.from, c.to); if (c.direction === 'both') add(c.to, c.from);
    }
    const anchors = world.topology!.connections.filter(c => c.toOwner && c.kind !== 'view').map(c => c.from);
    if (world.edgeGates) for (const side of ['north', 'south', 'east', 'west'] as const) for (const gate of world.edgeGates[side]) {
      const s = findSurface(world, { x: side === 'west' ? -55.99 : side === 'east' ? 55.99 : gate.offset,
        z: side === 'north' ? -55.99 : side === 'south' ? 55.99 : gate.offset, referenceY: gate.floorY });
      if (s) anchors.push(s.id);
    }
    if (!anchors.length) {
      const largest = [...surfaces].sort((a, b) => rectWidth(b.bounds) * rectDepth(b.bounds) - rectWidth(a.bounds) * rectDepth(a.bounds))[0];
      if (largest) anchors.push(largest.id);
    }
    // Two pockets having different exits does not make them mutually reachable.
    // Start once per datum, then actually join the other BSP components to it.
    // Different datums may legitimately connect through an external owner.
    const roots = new Map<number, string>();
    const byId = new Map(surfaces.map(s => [s.id, s]));
    for (const id of anchors) {
      const s = byId.get(id); if (!s) continue;
      const p = rectCenter(s.bounds), y = Math.round(surfaceY(s, p.x, p.z) * 1000);
      if (!roots.has(y)) roots.set(y, id);
    }
    for (const s of surfaces.filter(s => s.role === 'floor' && s.profile.kind === 'flat')) {
      const y = Math.round(floorHeight(s) * 1000);
      if (!roots.has(y)) roots.set(y, s.id);
    }
    const queue = [...roots.values()], seen = new Set(queue);
    for (let i = 0; i < queue.length; i++) for (const to of graph.get(queue[i]!) ?? []) if (!seen.has(to)) { seen.add(to); queue.push(to); }
    const floors = surfaces.filter(s => s.role === 'floor' && s.profile.kind === 'flat');
    const pockets = floors.filter(s => !seen.has(s.id) && rectWidth(s.bounds) > 1 && rectDepth(s.bounds) > 1);
    if (!pockets.length) return;
    let opened = 0;
    for (const s of pockets) {
      if (seen.has(s.id)) continue;
      const p = s.bounds, y = floorHeight(s);
      let choice: { distance: number; aperture: Rect; blockers: WallSegment[] } | undefined;
      for (const t of floors) {
        if (!seen.has(t.id) || Math.abs(y - floorHeight(t)) > .03) continue;
        const q = t.bounds;
        for (const axis of ['x', 'z'] as const) {
          const min = Math.max(axis === 'x' ? p.minZ : p.minX, axis === 'x' ? q.minZ : q.minX);
          const max = Math.min(axis === 'x' ? p.maxZ : p.maxX, axis === 'x' ? q.maxZ : q.maxX);
          if (max - min < .95) continue;
          const a = axis === 'x' ? p.minX > q.maxX ? q.maxX : p.maxX : p.minZ > q.maxZ ? q.maxZ : p.maxZ;
          const b = axis === 'x' ? p.minX > q.maxX ? p.minX : q.minX : p.minZ > q.maxZ ? p.minZ : q.minZ;
          const distance = b - a;
          if (distance < .005 || distance > 4.2 || choice && distance >= choice.distance) continue;
          // The middle of a shared span can face a protected chamber wall.
          // Try bounded offsets and door-sized apertures before rejecting it.
          for (const half of [Math.min(1.2, (max - min) / 2 - .05), .475]) for (const fraction of [.5, .2, .8, 0, 1]) {
            if (half * 2 > max - min - .02) continue;
            const center = min + half + .01 + (max - min - 2 * half - .02) * fraction;
            const aperture = axis === 'x' ? { minX: a - .02, maxX: b + .02, minZ: center - half, maxZ: center + half }
              : { minZ: a - .02, maxZ: b + .02, minX: center - half, maxX: center + half };
            const solids = world.colliders.filter(c => c.kind === 'wall' && c.center.y - c.halfExtents.y < y + 1.8 && c.center.y + c.halfExtents.y > y + .1 && overlapRect(aperture,
              { minX: c.center.x - c.halfExtents.x, maxX: c.center.x + c.halfExtents.x, minZ: c.center.z - c.halfExtents.z, maxZ: c.center.z + c.halfExtents.z }));
            if (!solids.length || solids.some(c => !c.id.includes('/bsp/'))) continue;
            const blockers = world.walls.filter(w => solids.some(c => c.id === w.id));
            if (blockers.length !== solids.length) continue;
            choice = { distance, aperture, blockers };
            break;
          }
        }
      }
      if (choice) {
        for (const w of choice.blockers) carve(w, choice.aperture);
        opened++;
        // One doorway joins the whole component. Do not punch another door
        // for every rectangle of the same tessellated room in this pass.
        const joined = [s.id]; seen.add(s.id);
        for (let i = 0; i < joined.length; i++) for (const to of graph.get(joined[i]!) ?? [])
          if (!seen.has(to)) { seen.add(to); joined.push(to); }
      }
    }
    if (!opened) return;
  }
  rebuild(); connect();
};
