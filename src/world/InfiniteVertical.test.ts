import { expect, it, vi } from 'vitest';
vi.mock('@dimforge/rapier3d', async () => import('../../node_modules/@dimforge/rapier3d/rapier.js'));
import RAPIER from '@dimforge/rapier3d';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { generateLegacyInfiniteChunk, clearInfiniteWorldCaches, generateInfiniteChunk, getCanonicalEdgeGates, getChunkWorldOffset } from './InfiniteWorld';
import { validateTopology, findSurface, surfaceY, surfaceNormal } from './WalkableTopology';
import { rectCenter, rectDepth, rectWidth } from './types';
import { generateLegacyWorld as generateWorld } from './generateWorld';

it('reproduces the exact reported BSP room through the real infinite seed route', () => {
  const finite = generateWorld('VERTICAL-PROMPT-AUDIT-3');
  const infinite = generateInfiniteChunk('RAW_LOCAL_VERTICAL-PROMPT-AUDIT-3', { x: 0, z: 0, story: 0 });
  expect(infinite.rooms.find(r => r.id.endsWith('/room-WTBBLT'))?.bounds).toEqual(finite.rooms.find(r => r.id === 'room-WTBBLT')?.bounds);
  expect(validateTopology(infinite)).toEqual([]);
});

it('retains legacy tall-volume templates across stories with the same owner and envelope in both generation orders', () => {
  const seed = 'VERTICAL-PROMPT-AUDIT-40', coord = { x: -1, z: 1, story: 0 };
  clearInfiniteWorldCaches(); const upper = generateLegacyInfiniteChunk(seed, coord);
  expect(upper.topology!.reservations!.length).toBeGreaterThan(0);
  for (const reservation of upper.topology!.reservations!) {
    const owner = generateLegacyInfiniteChunk(seed, { ...coord, story: reservation.ownerStory });
    const roomId = reservation.id.split('/').at(-1), room = owner.rooms.find(r => r.id.endsWith(`/${roomId}`))!;
    expect(room.bounds).toEqual(reservation.bounds);
    expect(room.ceilingHeight + reservation.ownerStory * 5.4 + .03).toBeCloseTo(reservation.top, 5);
    const p = { x: (room.bounds.minX + room.bounds.maxX) / 2, z: (room.bounds.minZ + room.bounds.maxZ) / 2 };
    if (reservation.top > -.158) expect(findSurface(upper, { ...p, referenceY: 0 })).toBeUndefined();
  }
  const previous = JSON.stringify(upper); clearInfiniteWorldCaches();
  generateLegacyInfiniteChunk(seed, { ...coord, story: -1 });
  expect(JSON.stringify(generateLegacyInfiniteChunk(seed, coord))).toBe(previous);
}, 30000);

it('publishes identical nonzero interfaces on every orientation, including a negative four-chunk corner', () => {
  for (const c of [{ x: -1, z: -1, story: -1 }, { x: 0, z: 0, story: 0 }]) {
    expect(getCanonicalEdgeGates('VERTICAL-SEAMS', c, 'east')).toEqual(getCanonicalEdgeGates('VERTICAL-SEAMS', { ...c, x: c.x + 1 }, 'west'));
    expect(getCanonicalEdgeGates('VERTICAL-SEAMS', c, 'south')).toEqual(getCanonicalEdgeGates('VERTICAL-SEAMS', { ...c, z: c.z + 1 }, 'north'));
    expect(getCanonicalEdgeGates('VERTICAL-SEAMS', c, 'east').some(g => g.floorY !== 0)).toBe(true);
  }
});

it('keeps sunken floor structures above the preceding story ceiling, including thin ceiling tiles', () => {
  for (const index of [0, 2, 5, 11, 19, 40]) {
    const seed = `VERTICAL-PROMPT-AUDIT-${index}`, coord = { x: -1, z: 1, story: 0 };
    const lower = generateInfiniteChunk(seed, coord), upper = generateInfiniteChunk(seed, { ...coord, story: 1 });
    if (!lower.topology || !upper.topology) continue;
    const roofs = lower.spatial!.ceilings.map(s => ({ id: s.id, center: { x: rectCenter(s.bounds).x, z: rectCenter(s.bounds).z, y: surfaceY(s, rectCenter(s.bounds).x, rectCenter(s.bounds).z) }, halfExtents: { x: rectWidth(s.bounds) / 2, z: rectDepth(s.bounds) / 2, y: 0 } }));
    expect(roofs.length).toBeGreaterThan(0);
    for (const surface of upper.topology.surfaces.filter(s => s.layer.includes('regional/'))) {
      const x = (surface.bounds.minX + surface.bounds.maxX) / 2, z = (surface.bounds.minZ + surface.bounds.maxZ) / 2;
      const bottom = 5.4 + surfaceY(surface, x, z) - surface.thickness / surfaceNormal(surface).y;
      for (const roof of roofs.filter(c => Math.abs(c.center.x - x) < c.halfExtents.x - .002 && Math.abs(c.center.z - z) < c.halfExtents.z - .002)) {
        expect(roof.center.y + roof.halfExtents.y, `${seed} ${surface.id} / ${roof.id}`).toBeLessThanOrEqual(bottom + .002);
      }
    }
  }
}, 30000);

it('keeps all ordinary infinite surfaces comfortable after biome, shaft and boundary passes', () => {
  for (let i = 0; i < 64; i++) {
    const w = generateInfiniteChunk(`VERTICAL-PROMPT-AUDIT-${i}`, { x: -1, z: 1, story: 0 });
    expect(validateTopology(w), w.seed).toEqual([]); expect(structuredClone(w)).toEqual(w);
    expect(w.topology?.surfaces.filter(s => s.access === 'open' && s.role !== 'floor' && s.locomotion !== 'crouch' && s.reachability === 'isolated').map(s => s.id), w.seed).toEqual([]);
    expect(w.colliders.some(c => /\/floor-\d+$/.test(c.id) && !c.id.includes('/cell/'))).toBe(false);
    expect(w.edgeGates).toBeDefined();
  }
}, 60000);

it('keeps negative corner plans independent of generation order and cache temperature', () => {
  const coords = [{ x: -1, z: -1, story: -1 }, { x: 0, z: -1, story: -1 }, { x: -1, z: 0, story: -1 }, { x: 0, z: 0, story: -1 }];
  const seed = 'VERTICAL-CORNER-ORDER'; clearInfiniteWorldCaches();
  const first = coords.map(c => JSON.stringify(generateInfiniteChunk(seed, c)));
  clearInfiniteWorldCaches(); const second = [...coords].reverse().map(c => JSON.stringify(generateInfiniteChunk(seed, c))).reverse();
  expect(second).toEqual(first); expect(coords.map(c => JSON.stringify(generateInfiniteChunk(seed, c)))).toEqual(first);
}, 30000);

it('sweeps actual infinite slope bodies across their complete useful width', async () => {
  for (const i of [0, 2, 5, 11, 19, 41]) {
    const w = generateInfiniteChunk(`VERTICAL-PROMPT-AUDIT-${i}`, { x: -1, z: 1, story: 0 }), physics = await PhysicsWorld.create(w);
    try {
      for (const s of w.topology!.surfaces) {
        const p = s.profile; if (p.kind !== 'linear') continue;
        const b = s.bounds, width = p.axis === 'x' ? rectDepth(b) : rectWidth(b);
        for (const t of [.05, .25, .5, .75, .95]) for (const across of [.35 / width, .5, 1 - .35 / width]) {
          const x = b.minX + rectWidth(b) * (p.axis === 'x' ? t : across), z = b.minZ + rectDepth(b) * (p.axis === 'z' ? t : across), crouch = s.locomotion === 'crouch';
          const blocked = physics.world.intersectionWithShape({ x, y: surfaceY(s, x, z) + (crouch ? .65 : .91), z }, { x: 0, y: 0, z: 0, w: 1 },
            new RAPIER.Capsule(crouch ? .22 : .52, .32), undefined, undefined, undefined, undefined, physics.isEnvironmentCollider);
          expect(blocked, `${w.seed} ${s.id} ${x},${z}`).toBeNull();
        }
      }
    } finally { physics.dispose(); }
  }
}, 30000);

it('walks a real shared seam after eight collider unload/reload cycles without losing support', async () => {
  const seed = 'VERTICAL-STREAM-SEAM', sourceCoord = { x: -1, z: 0, story: 0 }, destinationCoord = { x: 0, z: 0, story: 0 };
  const source = generateInfiniteChunk(seed, sourceCoord), destination = generateInfiniteChunk(seed, destinationCoord);
  const gate = source.edgeGates!.east[0]!, offset = getChunkWorldOffset(sourceCoord), x = 52, z = gate.offset;
  const surface = findSurface(source, { x, z, referenceY: gate.floorY })!;
  const spawn = { x: offset.x + x, y: surfaceY(surface, x, z) + .9, z };
  const physics = await PhysicsWorld.create({ ...source, colliders: [], spawn });
  try {
    for (let cycle = 0; cycle < 8; cycle++) {
      physics.batchChunkChanges(() => { physics.addChunk('source', source.colliders, offset); physics.addChunk('destination', destination.colliders, getChunkWorldOffset(destinationCoord)); });
      physics.teleport(spawn); for (let i = 0; i < 30; i++) physics.move({ x: 0, y: -.035, z: 0 });
      let p = { ...spawn }; for (let i = 0; i < 180 && p.x < -51; i++) p = { ...physics.move({ x: .08, y: -.035, z: 0 }).position };
      expect(p.x).toBeGreaterThan(-51.1);
      const target = findSurface(destination, { x: p.x, z: p.z, referenceY: p.y - .865 }); expect(target).toBeDefined();
      expect(Math.abs(p.y - .865 - surfaceY(target!, p.x, p.z))).toBeLessThan(.2);
      physics.batchChunkChanges(() => { physics.removeChunk('source'); physics.removeChunk('destination'); });
      expect(physics.world.colliders.len()).toBe(1);
    }
  } finally { physics.dispose(); }
}, 30000);
