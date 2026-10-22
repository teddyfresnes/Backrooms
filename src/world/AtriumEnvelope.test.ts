import { expect, it, vi } from 'vitest';
vi.mock('@dimforge/rapier3d', async () => import('../../node_modules/@dimforge/rapier3d/rapier.js'));
import { regionalAtrium, regionalDatum, spatialCellBounds } from './RegionalPlan';
import { atriumSection, atriumSupportBands } from './AtriumEnvelope';
import { generateInfiniteChunk, getChunkWorldOffset } from './InfiniteWorld';
import { surfaceY, validateTopology } from './WalkableTopology';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import RAPIER from '@dimforge/rapier3d';
import { pointInRect, rectCenter } from './types';

it('varies room depth, footprint, perimeter and optional stairs while agreeing at every vertical address', () => {
  const depths = new Set<number>(), shapes = new Set<string>(), access = new Set<boolean>(), perimeters = new Set<string>(); let rooms = 0;
  for (let n = 0; n < 64; n++) for (let z = -4; z < 4; z++) for (let x = -4; x < 4; x++) {
    const seed = `ATRIUM-VARIATION-${n}`, a = regionalAtrium(seed, x, z, 0); if (!a || a.anchorX !== x || a.anchorZ !== z) continue;
    depths.add(a.owner - a.lower); shapes.add(`${a.cellsX}/${a.cellsZ}`); access.add(a.stairs); perimeters.add(a.perimeter); rooms++;
    for (let story = a.lower; story <= a.owner; story++) expect(regionalAtrium(seed, x, z, story)).toEqual(a);
    if (a.perimeter === 'stepped') expect(a.stairs).toBe(false);
  }
  expect(rooms).toBeGreaterThan(40); expect([...depths].sort()).toEqual([1, 2, 3]);
  expect(shapes.size).toBe(4); expect(access.size).toBe(2); expect(perimeters.size).toBe(2);
});

it('fills each gallery to the real bottom with disjoint bearing bands and increasingly central lower terraces', () => {
  let checked = 0;
  for (let n = 0; n < 64; n++) for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) {
    const seed = `ATRIUM-BEARING-${n}`, a = regionalAtrium(seed, x, z, 0); if (!a || a.anchorX !== x || a.anchorZ !== z) continue;
    const first = spatialCellBounds(x, z), last = spatialCellBounds(x + a.cellsX - 1, z + a.cellsZ - 1), b = { ...first, maxX: last.maxX, maxZ: last.maxZ };
    const h = regionalDatum(seed, x, z).y;
    let previous = 0;
    for (let level = a.owner; level > a.lower; level--) {
      const s = atriumSection(b, a, level);
      if (a.perimeter === 'stepped' && level < a.owner) expect(s.innerInset).toBeGreaterThan(previous);
      previous = s.innerInset;
      expect(s.hole.maxX - s.hole.minX).toBeGreaterThanOrEqual(7.99999);
      expect(s.hole.maxZ - s.hole.minZ).toBeGreaterThanOrEqual(7.99999);
      const p = { x: s.outer.minX + .6, z: s.outer.minZ + .6 }, bands: { low: number; high: number }[] = [];
      for (let story = a.lower; story <= a.owner; story++) for (const band of atriumSupportBands(b, a, story, h))
        if (band.tier === a.owner - level && pointInRect(p.x, p.z, band.bounds)) bands.push({ low: band.bottom + story * 5.4, high: band.top + story * 5.4 });
      bands.sort((a, b) => a.low - b.low);
      expect(bands[0]!.low).toBeCloseTo(h + a.lower * 5.4 - .16, 8);
      expect(bands.at(-1)!.high).toBeCloseTo(h + level * 5.4 - .16, 8);
      for (let i = 1; i < bands.length; i++) expect(bands[i]!.low).toBeCloseTo(bands[i - 1]!.high, 8);
      checked++;
      if (a.perimeter !== 'stepped') break;
    }
  }
  expect(checked).toBeGreaterThan(20);
});

it('mounts four real levels with clear entrance tunnels, supported rings and valid irreversible landings', async () => {
  let seed = '';
  for (let n = 0; n < 256 && !seed; n++) for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) {
    const candidate = `REGIONAL-AUDIT-${n}`, a = regionalAtrium(candidate, x, z, 0);
    if (a?.perimeter === 'stepped' && a.owner === 0 && a.lower === -3) seed = candidate;
  }
  expect(seed).not.toBe('');
  const source = generateInfiniteChunk(seed, { x: 0, z: 0, story: 0 });
  const cell = source.spatial!.cells.find(c => c.atriumPerimeter === 'stepped' && c.atriumOwner === 0 && c.atriumLower === -3)!;
  expect(cell).toBeDefined();
  const a = regionalAtrium(seed, Math.floor((cell.bounds.minX + 56) / 28), Math.floor((cell.bounds.minZ + 56) / 28), 0)!;
  const plans = Array.from({ length: 4 }, (_, n) => generateInfiniteChunk(seed, { x: 0, z: 0, story: -n }));
  const physics = await PhysicsWorld.create({ ...source, colliders: [] });
  try {
    for (const w of plans) { expect(validateTopology(w), `${w.seed}/${w.spatial!.owner.story}`).toEqual([]); physics.addChunk(String(w.spatial!.owner.story), w.colliders, getChunkWorldOffset(w.spatial!.owner)); }
    for (const w of plans) {
      const story = w.spatial!.owner.story, section = atriumSection(cell.bounds, a, story), offset = getChunkWorldOffset(w.spatial!.owner);
      const p = story === 0 ? { x: cell.bounds.minX + 1.8, z: cell.bounds.minZ + 1.8 }
        : story > -3 ? { x: section.outer.minX + a.terraceWidth / 2, z: section.outer.minZ + a.terraceWidth / 2 } : rectCenter(section.hole);
      expect(physics.canStandAt({ ...p, y: cell.floorY + offset.y + .865 }), `ring ${story}`).toBe(true);
      // Every exterior opening crosses the mass at its own actual height.
      const start = { x: cell.bounds.minX + 1.4, z: cell.bounds.minZ + 14, y: cell.floorY + offset.y + .865 };
      physics.teleport(start); let at = start;
      for (let i = 0; i < 180 && at.x < cell.bounds.minX + section.innerInset - .7; i++) at = { ...physics.move({ x: .06, y: -.035, z: 0 }).position };
      expect(at.x, `entry ${story}`).toBeGreaterThan(cell.bounds.minX + section.innerInset - .8);
      if (story < 0) {
        const entries = w.lights.filter(l => l.id.includes('/entry-light/') && pointInRect(l.x, l.z, cell.bounds));
        expect(entries.length).toBeGreaterThanOrEqual(4);
        for (const lamp of entries) {
          const hit = physics.world.castRay(new RAPIER.Ray({ x: lamp.x, y: lamp.ceilingY + offset.y - .05, z: lamp.z }, { x: 0, y: 1, z: 0 }), .2, true);
          expect(hit?.timeOfImpact, lamp.id).toBeCloseTo(.05, 3);
        }
      }
      for (const link of w.topology!.connections.filter(c => c.id.includes('/tier-drop-'))) {
        const target = plans.find(p => p.spatial!.owner.story === link.toOwner!.story)!;
        const surface = target.topology!.surfaces.find(s => s.id === link.to)!;
        expect(surface).toBeDefined();
        const y = link.arrival!.y + (story - target.spatial!.owner.story) * 5.4;
        expect(surfaceY(surface, link.arrival!.x, link.arrival!.z)).toBeCloseTo(y, 8);
        if (link.id.endsWith('/tier-drop-0')) {
          let at = { ...link.at, y: cell.floorY + offset.y + .865 }, vy = -.9; physics.teleport(at);
          for (let tick = 0; tick < 160; tick++) {
            vy = Math.max(-32, vy - 18 * (1 / 60));
            const moved = physics.move({ x: at.x < link.arrival!.x ? .05 : 0, y: vy / 60, z: 0 });
            at = { ...moved.position }; if (moved.grounded) vy = -.9;
          }
          expect(at.y, `drop ${story}`).toBeCloseTo(link.arrival!.y + offset.y + .865, 1);
        }
      }
    }
  } finally { physics.dispose(); }
});
