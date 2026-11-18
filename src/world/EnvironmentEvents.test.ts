import { describe, expect, it } from 'vitest';
import { environmentFixture } from '../../tests/support/environment-fixture';
import { eventProposal, eventCellAccepted, ENVIRONMENT_EVENT_CONFIG, clearEventFootprint, ENVIRONMENT_EVENT_DEFINITIONS } from './EnvironmentEvents';
import type { EnvironmentEventKind } from './EnvironmentEvents';
import { generateInfiniteChunk } from './InfiniteWorld';
import { overlapRect } from './WalkableTopology';
import { rectCenter } from './types';
import { SeededRandom } from './SeededRandom';

const kinds = Object.keys(ENVIRONMENT_EVENT_CONFIG.probabilities) as EnvironmentEventKind[];
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
      if (e.apparition) expect(Math.hypot(e.apparition.end.x - e.apparition.start.x, e.apparition.end.z - e.apparition.start.z) / .57).toBeLessThan(1);
      if (e.chair) expect(clearEventFootprint(plan, { minX: -8, maxX: 8, minZ: -8, maxZ: 8 }, e.floorY)).toBe(true);
      if (e.drips) expect(e.drips.length).toBeGreaterThan(0);
    }
  });
  it('cuts shallow water around walls and holes rather than crossing them', () => {
    const plan = environmentFixture('flood'), room = plan.rooms[0]!, e = plan.environmentEvents![0]!;
    const obstacle = { minX: -1, maxX: 1, minZ: -6, maxZ: 6 }, hole = { minX: 4, maxX: 6, minZ: 4, maxZ: 6 };
    plan.colliders.push({ id: 'partition', kind: 'wall', center: { x: 0, y: 1.5, z: 0 }, halfExtents: { x: 1, y: 1.5, z: 6 } });
    plan.floorOpenings = [hole];
    ENVIRONMENT_EVENT_DEFINITIONS.flood.prepare(plan, e, room, new SeededRandom('water-test'), { ...ENVIRONMENT_EVENT_CONFIG, dripChance: 0 });
    expect(e.waterRects!.length).toBeGreaterThan(1);
    for (const r of e.waterRects!) { expect(overlapRect(r, obstacle)).toBe(false); expect(overlapRect(r, hole)).toBe(false); }
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
    expect(proposed).toBeGreaterThan(30); expect(proposed).toBeLessThan(130); expect(accepted.length).toBeGreaterThan(0);
    for (const [i, a] of accepted.entries()) for (const b of accepted.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThanOrEqual(ENVIRONMENT_EVENT_CONFIG.minSpacing + 16);
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
        expect(e.id).toMatch(/^chunk-/); expect(plan.rooms.some(r => r.id === e.roomId)).toBe(true);
        expect(e.lightIds.every(id => plan.lights.some(l => l.id === id))).toBe(true);
        if (e.mount) expect(plan.walls.some(w => w.id === e.mount!.wallId)).toBe(true);
        expect(plan.propPlacements?.some(p => p.roomId === e.roomId)).toBe(false);
        const c = rectCenter(e.bounds); expect(Number.isFinite(c.x + c.z + e.floorY)).toBe(true);
        expect(generateInfiniteChunk(seed, key as `${number}:${number}:${number}`).environmentEvents).toEqual(plan.environmentEvents);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    expect(found).toBeGreaterThan(0);
  });
});
