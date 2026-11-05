import { expect, it, vi } from 'vitest';
vi.mock('@dimforge/rapier3d', async () => import('../../node_modules/@dimforge/rapier3d/rapier.js'));
import RAPIER from '@dimforge/rapier3d';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { generateInfiniteChunk, getChunkWorldOffset } from './InfiniteWorld';
import { rectCenter, rectDepth, rectWidth } from './types';
import { surfaceRange } from './WalkableTopology';

it('keeps real low passages crouchable through their generated roofs and supports the legacy humps', async () => {
  let checked = 0, humps = 0;
  for (let i = 0; i < 24 && checked < 5; i++) {
    const w = generateInfiniteChunk(`REGIONAL-AUDIT-${i}`, { x: 0, z: 0, story: 0 });
    const floors = w.topology!.surfaces.filter(s => s.locomotion === 'crouch' && s.profile.kind === 'flat' && rectWidth(s.bounds) > 1.1 && rectDepth(s.bounds) > 1.1);
    if (!floors.length) continue;
    const physics = await PhysicsWorld.create(w);
    try {
      for (const s of floors) {
        const p = rectCenter(s.bounds), y = surfaceRange(s)[0];
        const blocker = physics.world.intersectionWithShape({ ...p, y: y + .59 }, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Capsule(.22, .32),
          undefined, undefined, undefined, undefined, physics.isEnvironmentCollider);
        expect(blocker, `${w.seed}/${s.id}`).toBeNull();
      }
      for (const f of w.features) if (f.kind === 'squeeze-view' && f.hump) {
        const h = w.rooms.find(r => r.id === f.roomId)!.floorY!;
        const up = w.topology!.surfaces.filter(s => s.id.includes(`${f.id}/hump-`));
        expect(up.length).toBeGreaterThan(0); expect(Math.max(...up.map(s => surfaceRange(s)[1]))).toBeCloseTo(h + f.hump.elevation, 5); humps++;
      }
      checked++;
    } finally { physics.dispose(); }
  }
  expect(checked).toBeGreaterThanOrEqual(2); expect(humps).toBeGreaterThan(0);
}, 30000);

it('falls through a retained grid pit into its actual multi-owner arrival', async () => {
  const w = generateInfiniteChunk('REGIONAL-AUDIT-17', { x: 0, z: 0, story: 0 });
  const feature = w.features.find(f => f.kind === 'grid-pit'); expect(feature?.kind).toBe('grid-pit');
  if (feature?.kind !== 'grid-pit') return;
  const hole = feature.holes.find(h => h.kind !== 'void')!, stories = hole.stories!;
  const p = rectCenter(hole), h = w.rooms.find(r => r.id === feature.roomId)!.floorY!;
  const physics = await PhysicsWorld.create({ ...w, colliders: [] });
  try {
    physics.batchChunkChanges(() => {
      for (let story = -stories; story <= 0; story++) {
        const coord = { x: 0, z: 0, story }, plan = generateInfiniteChunk(w.seed, coord);
        physics.addChunk(String(story), plan.colliders, getChunkWorldOffset(coord));
      }
    });
    physics.teleport({ ...p, y: h + .865 }); let velocity = 0, at = { ...p, y: h + .865 };
    for (let tick = 0; tick < 300; tick++) {
      velocity = Math.max(-50, velocity - 22 / 60);
      const r = physics.move({ x: 0, y: velocity / 60, z: 0 }); at = { ...r.position }; if (r.grounded) velocity = -.9;
    }
    expect(stories).toBeGreaterThanOrEqual(2);
    expect(at.y).toBeCloseTo(h - stories * 5.4 + .865, 1);
  } finally { physics.dispose(); }
}, 30000);
