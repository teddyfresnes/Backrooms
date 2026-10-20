import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
vi.mock('@dimforge/rapier3d', async () => import('../../node_modules/@dimforge/rapier3d/rapier.js'));
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { generateWorld } from '../world/generateWorld';
import { surfaceCollider, type WalkableSurface } from '../world/WalkableTopology';
import { WorldStream } from './WorldStream';

it('keeps raised support in its owner story, restores both layers and releases an unsupported fall', async () => {
  const plan = generateWorld('VERTICAL-STREAM-SAVE');
  const lower: WalkableSurface = { id: 'test/lower', ownerStory: 0, layer: 'lower', role: 'floor', bounds: { minX: -4, maxX: 4, minZ: -4, maxZ: 4 },
    profile: { kind: 'flat', y: -.9 }, ceilingY: 2.04, support: 'slab', thickness: .16, access: 'open', edges: 'architecture' };
  const upper: WalkableSurface = { ...lower, id: 'test/upper', layer: 'upper', role: 'balcony', profile: { kind: 'flat', y: 2.2 }, ceilingY: 4.85 };
  plan.features = []; plan.spawn = { x: 0, y: -.035, z: 0 };
  plan.topology = { version: 1, ownerStory: 0, surfaces: [lower, upper], connections: [], volumes: [], diagnostics: [] };
  plan.colliders = [lower, upper].map(surfaceCollider); const physics = await PhysicsWorld.create(plan);
  const stream = new WorldStream(plan.seed, plan, new THREE.Scene(), {} as never, physics);
  // Render mounting is covered separately; these production queries use real physics.
  const chunks = (stream as unknown as { chunks: Map<string, unknown> }).chunks;
  chunks.set('0:0:0', { plan, coord: { x: 0, z: 0, story: 0 }, offset: new THREE.Vector3() });
  try {
    const above = { x: 0, y: 3.065, z: 0 }, below = { x: 0, y: -.035, z: 0 };
    expect(stream.supportedCoordAt(above).story).toBe(0); expect(stream.supportedCoordAt(below).story).toBe(0);
    const highAnchor = stream.surfaceAnchorAt(above), lowAnchor = stream.surfaceAnchorAt(below);
    expect(highAnchor?.id).toBe(upper.id); expect(lowAnchor?.id).toBe(lower.id);
    expect(stream.restoreSurfacePosition({ ...above, y: 3.1 }, highAnchor).y).toBeCloseTo(above.y);
    expect(stream.restoreSurfacePosition({ ...below, y: -.1 }, lowAnchor).y).toBeCloseTo(below.y);
    expect(stream.supportedCoordAt({ x: 0, y: -4, z: 0 }).story).toBe(-1);
    physics.addChunk('obstructed-save', [{ id: 'obstacle', kind: 'barrier', center: { x: 0, y: 3, z: 0 }, halfExtents: { x: 1, y: .5, z: 1 } }], { x: 0, y: 0, z: 0 });
    expect(stream.restoreSurfacePosition(above, highAnchor)).toEqual(plan.spawn);
  } finally { chunks.clear(); physics.dispose(); }
});
