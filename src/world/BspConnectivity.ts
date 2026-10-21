import type { Rect, WallSegment, WorldPlan } from './types';
import { rectDepth, rectWidth } from './types';
import { findSurface, overlapRect, surfaceY, type WalkableSurface } from './WalkableTopology';

/** Join genuine cropped BSP pockets through the smallest intervening ordinary
 * partition. Never carve an atrium, a regional facade, a ramp support or a door.
 * Rebuild from the original floor footprints after each bounded repair pass. */
export const stitchBspPartitions = (world: WorldPlan, rebuild: () => void, connect: () => void,
  carve: (wall: WallSegment, aperture: Rect) => void): void => {
  const floorHeight = (s: WalkableSurface) => s.profile.kind === 'flat' ? s.profile.y : Infinity;
  for (let pass = 0; pass < 8; pass++) {
    rebuild(); connect();
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
    const seen = new Set(anchors), queue = [...anchors];
    for (let i = 0; i < queue.length; i++) for (const to of graph.get(queue[i]!) ?? []) if (!seen.has(to)) { seen.add(to); queue.push(to); }
    const floors = surfaces.filter(s => s.role === 'floor' && s.profile.kind === 'flat');
    const pockets = floors.filter(s => !seen.has(s.id) && rectWidth(s.bounds) > 1 && rectDepth(s.bounds) > 1);
    if (!pockets.length) return;
    let opened = 0;
    for (const s of pockets) {
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
      if (choice) { for (const w of choice.blockers) carve(w, choice.aperture); opened++; }
    }
    if (!opened) return;
  }
  rebuild(); connect();
};
