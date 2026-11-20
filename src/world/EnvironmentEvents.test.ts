import { describe, expect, it } from 'vitest';
import { environmentFixture } from '../../tests/support/environment-fixture';
import { eventProposal, eventCellAccepted, ENVIRONMENT_EVENT_CONFIG, clearEventFootprint, ENVIRONMENT_EVENT_DEFINITIONS, eventZones, zoneEnclosed,
  lonelyHallCell, lonelyHallRoomId, MAX_ROOM_DRIFT } from './EnvironmentEvents';
import type { EnvironmentEventKind } from './EnvironmentEvents';
import { generateInfiniteChunk } from './InfiniteWorld';
import { overlapRect } from './WalkableTopology';
import { pointInRect, rectCenter, rectDepth, rectWidth } from './types';
import { SeededRandom } from './SeededRandom';
import type { WorldPlan } from './types';

const kinds = Object.keys(ENVIRONMENT_EVENT_CONFIG.probabilities) as EnvironmentEventKind[];
const wall = (id: string, x: number, z: number, length: number, orientation: 'x' | 'z'): WorldPlan['walls'][number] =>
  ({ id, x, z, length, orientation, thickness: .2, bottom: 0, height: 3.05, tint: 1, collision: true, kind: 'wallpaper' });
const findHall = (): { seed: string; x: number; z: number } => {
  for (let i = 0; i < 40; i++) for (let z = -14; z < 14; z++) for (let x = -14; x < 14; x++)
    if (lonelyHallCell(`LONELY-HALL-${i}`, x, z, 0)) return { seed: `LONELY-HALL-${i}`, x, z };
  throw new Error('no lonely hall in the sampled seeds');
};
describe('procedural environmental events', () => {
  it('builds six complete serializable plans on actual compatible room geometry', () => {
    for (const kind of kinds) {
      const plan = environmentFixture(kind, -2.4), e = plan.environmentEvents![0]!;
      expect(structuredClone(e)).toEqual(e);
      expect(e.floorY).toBe(-2.4);
      if (e.mount) {
        const normal = { x: Math.sin(e.mount.yaw), z: Math.cos(e.mount.yaw) };
        expect(clearEventFootprint(plan, { minX: e.mount.position.x + normal.x * .9 - .4, maxX: e.mount.position.x + normal.x * .9 + .4,
          minZ: e.mount.position.z + normal.z * .9 - .4, maxZ: e.mount.position.z + normal.z * .9 + .4 }, e.floorY)).toBe(true);
      }
      for (const m of e.extraMounts ?? []) expect(Math.hypot(m.position.x - e.mount!.position.x, m.position.z - e.mount!.position.z)).toBeGreaterThanOrEqual(10);
      if (e.apparition) expect(Math.hypot(e.apparition.end.x - e.apparition.start.x, e.apparition.end.z - e.apparition.start.z) / .57).toBeLessThan(1);
      if (e.chair) {
        expect(e.chair.positions.length).toBeGreaterThan(2);
        for (const [i, p] of e.chair.positions.entries()) {
          expect(pointInRect(p.x, p.z, e.bounds, 5.9)).toBe(true);
          if (i) expect(Math.hypot(p.x - e.chair.positions[i - 1]!.x, p.z - e.chair.positions[i - 1]!.z)).toBeGreaterThan(1.5);
        }
      }
      if (e.drips) expect(e.drips.length).toBeGreaterThan(0);
    }
  });
  it('gives a long fire alarm zone a second synchronized unit far from the first', () => {
    const plan = environmentFixture('fire-alarm'), e = plan.environmentEvents![0]!;
    expect(e.extraMounts).toHaveLength(1);
    expect(e.extraMounts![0]!.wallId).not.toBe(e.mount!.wallId);
  });
  it('cuts shallow water around walls and holes rather than crossing them', () => {
    const plan = environmentFixture('flood'), room = plan.rooms[0]!, e = plan.environmentEvents![0]!;
    const obstacle = { minX: -1, maxX: 1, minZ: -6, maxZ: 6 }, hole = { minX: 4, maxX: 6, minZ: 4, maxZ: 6 };
    plan.colliders.push({ id: 'partition', kind: 'wall', center: { x: 0, y: 1.5, z: 0 }, halfExtents: { x: 1, y: 1.5, z: 6 } });
    plan.floorOpenings = [hole];
    const zone = { room, roomIds: [room.id], bounds: room.bounds, floorY: 0, ceilingY: 3.05 };
    ENVIRONMENT_EVENT_DEFINITIONS.flood.prepare(plan, e, zone, new SeededRandom('water-test'), { ...ENVIRONMENT_EVENT_CONFIG, dripChance: 0 });
    expect(e.waterRects!.length).toBeGreaterThan(1);
    for (const r of e.waterRects!) { expect(overlapRect(r, obstacle)).toBe(false); expect(overlapRect(r, hole)).toBe(false); }
  });
  it('merges the cell fragments of one physical room, never across a wall, and rejects open sides', () => {
    const base = environmentFixture('flood');
    const room = (id: string, minX: number, maxX: number) => ({ ...base.rooms[0]!, id, bounds: { minX, maxX, minZ: -5, maxZ: 5 }, floorY: 0, ceilingHeight: 3.05 });
    const plan: WorldPlan = { ...base, rooms: [room('cell/0/0/0/bsp/room-A', -10, 0), room('cell/1/0/0/bsp/room-A', 0, 10), room('cell/1/0/0/bsp/room-B', 10, 16)],
      walls: [wall('n', 0, -5, 20, 'x'), wall('s', 0, 5, 20, 'x'), wall('w', -10, 0, 10, 'z'), wall('e', 10, 0, 10, 'z')] };
    const merged = eventZones(plan).find(z => z.roomIds.length === 2)!;
    expect(merged.bounds).toEqual({ minX: -10, maxX: 10, minZ: -5, maxZ: 5 });
    expect(zoneEnclosed(plan, merged.bounds, 0)).toBe(true);
    // The fragment alone would draw its darkness or water across an open seam.
    expect(zoneEnclosed(plan, plan.rooms[0]!.bounds, 0)).toBe(false);
    plan.walls.push(wall('seam', 0, 0, 10, 'z'));
    expect(eventZones(plan).every(z => z.roomIds.length === 1)).toBe(true);
  });
  it('keeps rarity and hard spacing deterministic across negative cells and vertical owners', () => {
    const accepted: ReturnType<typeof eventProposal>[] = [];
    let proposed = 0;
    for (let story = -8; story <= 8; story++) for (let z = -6; z <= 6; z++) for (let x = -6; x <= 6; x++) {
      const c = { x, z, story }, p = eventProposal('ENVIRONMENT-SPACING', c);
      if (!p.kind) continue;
      proposed++;
      expect(eventProposal('ENVIRONMENT-SPACING', c)).toEqual(p);
      if (eventCellAccepted('ENVIRONMENT-SPACING', c)) accepted.push(p);
    }
    expect(proposed).toBeGreaterThan(30); expect(proposed).toBeLessThan(130); expect(accepted.length).toBeGreaterThan(proposed / 4);
    for (const [i, a] of accepted.entries()) for (const b of accepted.slice(i + 1)) {
      if (Math.abs(a.y - b.y) >= ENVIRONMENT_EVENT_CONFIG.verticalSeparation) continue;
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(ENVIRONMENT_EVENT_CONFIG.minSpacing + MAX_ROOM_DRIFT * 2);
    }
  });
  it('generates prefixed deterministic events on real infinite plans without changing monument contracts', () => {
    const seed = 'ENVIRONMENT-INTEGRATION';
    let checked = 0, found = 0;
    // Only materialize accepted proposals: this checks real BSP geometry while
    // keeping a naturally rare feature test independent of a huge seed sweep.
    const owners = new Set<string>();
    for (let z = -24; z < 24 && owners.size < 18; z++) for (let x = -24; x < 24 && owners.size < 18; x++) {
      if (eventCellAccepted(seed, { x, z, story: 0 })) owners.add(`${Math.floor(x / 4)}:${Math.floor(z / 4)}:0`);
    }
    for (const key of owners) {
      const plan = generateInfiniteChunk(seed, key as `${number}:${number}:${number}`);
      for (const e of plan.environmentEvents ?? []) {
        found++;
        expect(e.id).toMatch(/^chunk-/); expect(e.roomIds).toContain(e.roomId);
        for (const id of e.roomIds) expect(plan.rooms.some(r => r.id === id)).toBe(true);
        expect(e.lightIds.every(id => plan.lights.some(l => l.id === id))).toBe(true);
        for (const m of [e.mount, ...(e.extraMounts ?? [])]) if (m) expect(plan.walls.some(w => w.id === m.wallId)).toBe(true);
        expect(plan.propPlacements?.some(p => e.roomIds.includes(p.roomId))).toBe(false);
        if (ENVIRONMENT_EVENT_DEFINITIONS[e.kind].enclosed) expect(zoneEnclosed(plan, e.bounds, e.floorY)).toBe(true);
        const c = rectCenter(e.bounds); expect(Number.isFinite(c.x + c.z + e.floorY)).toBe(true);
        expect(generateInfiniteChunk(seed, key as `${number}:${number}:${number}`).environmentEvents).toEqual(plan.environmentEvents);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    expect(found).toBeGreaterThan(0);
  });
  it('builds the lonely chair hall into the geometry: one empty, walled, connected, ordinarily lit cell', () => {
    const { seed, x, z } = findHall(), key = `${Math.floor(x / 4)}:${Math.floor(z / 4)}:0` as const;
    const plan = generateInfiniteChunk(seed, key), prefix = `chunk-${key}/`;
    const hall = plan.rooms.find(r => r.id === `${prefix}${lonelyHallRoomId(x, z, 0)}`)!;
    expect(hall).toBeDefined();
    expect(rectWidth(hall.bounds)).toBeCloseTo(28); expect(rectDepth(hall.bounds)).toBeCloseTo(28);
    const floor = hall.floorY ?? 0, inner = { minX: hall.bounds.minX + 1.35, maxX: hall.bounds.maxX - 1.35, minZ: hall.bounds.minZ + 1.35, maxZ: hall.bounds.maxZ - 1.35 };
    // Nothing stands inside: no partition, column, mass, door, relief or furniture.
    expect(clearEventFootprint(plan, inner, floor)).toBe(true);
    expect(plan.propPlacements?.some(p => p.roomId === hall.id)).toBe(false);
    expect(plan.detailSockets.some(s => s.roomId === hall.id)).toBe(false);
    expect(zoneEnclosed(plan, hall.bounds, floor)).toBe(true);
    // Each facade keeps its central gate, and the hall joins the walkable graph.
    const hallSurfaces = new Set(plan.topology!.surfaces.filter(s => s.roomId === hall.id).map(s => s.id));
    expect(plan.topology!.connections.some(c => hallSurfaces.has(c.from) !== hallSurfaces.has(c.to) && (hallSurfaces.has(c.from) || hallSurfaces.has(c.to)))).toBe(true);
    const lights = plan.lights.filter(l => l.roomId === hall.id);
    expect(lights.length).toBeGreaterThanOrEqual(4); expect(lights.every(l => !l.dead)).toBe(true);
    const event = plan.environmentEvents!.find(e => e.kind === 'lonely-chair')!;
    expect(event.roomId).toBe(hall.id);
    expect(event.chair!.positions[0]).toEqual({ ...rectCenter(hall.bounds), y: floor });
    expect(generateInfiniteChunk(seed, key).environmentEvents).toEqual(plan.environmentEvents);
  });
});
