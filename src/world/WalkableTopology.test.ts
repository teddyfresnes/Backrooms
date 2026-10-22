import { expect, it, vi } from 'vitest';
vi.mock('@dimforge/rapier3d', async () => import('../../node_modules/@dimforge/rapier3d/rapier.js'));
import RAPIER from '@dimforge/rapier3d';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { createWalkableGeometry } from '../render/WalkableGeometry';
import { generateWorld } from './generateWorld';
import { findSurface, surfaceCollider, surfaceY, validateTopology, type WalkableSurface } from './WalkableTopology';

it('keeps arbitrary signed slopes and overlapping layers identical to real Rapier hulls', async () => {
  for (const axis of ['x', 'z'] as const) for (const [startY, endY] of [[.9, 1.6], [-.8, .4], [1.1, 0], [0, -1.1]]) {
    const s: WalkableSurface = { id: 'ramp', layer: 'upper', ownerStory: 0, role: 'ramp',
      bounds: axis === 'x' ? { minX: -4, maxX: 4, minZ: -1.1, maxZ: 1.1 } : { minX: -1.1, maxX: 1.1, minZ: -4, maxZ: 4 },
      profile: { kind: 'linear', axis, startY: startY!, endY: endY! }, ceilingY: Math.max(startY!, endY!) + 2.6,
      thickness: .16, support: 'slab', access: 'open', edges: 'drop' };
    const w = generateWorld('VERTICAL-HULL-FIXTURE');
    const lower: WalkableSurface = { ...s, id: 'lower', layer: 'lower', role: 'floor', profile: { kind: 'flat', y: -3 }, ceilingY: -.5 };
    w.colliders = [surfaceCollider(s), surfaceCollider(lower)]; w.spawn = { x: 40, y: 1, z: 40 };
    w.topology = { version: 1, ownerStory: 0, surfaces: [s, lower], connections: [], volumes: [], diagnostics: [] };
    const physics = await PhysicsWorld.create(w);
    try {
      for (const t of [0, .1, .25, .5, .75, .9, 1]) for (const side of [-.9, 0, .9]) {
        const x = axis === 'x' ? -4 + t * 8 : side, z = axis === 'z' ? -4 + t * 8 : side, y = surfaceY(s, x, z);
        const hit = physics.world.castRay(new RAPIER.Ray({ x, y: y + .5, z }, { x: 0, y: -1, z: 0 }), 1, true,
          undefined, undefined, undefined, undefined, physics.isEnvironmentCollider);
        expect(hit).not.toBeNull(); expect(Math.abs(hit!.timeOfImpact - .5)).toBeLessThan(.002);
        expect(findSurface(w, { x, z, referenceY: -3 })?.id).toBe(lower.id);
      }
      w.topology.surfaces = [{ ...s, ceilingY: Math.max(startY!, endY!) + 1.64 }];
      expect(validateTopology(w).some(x => x.includes('insufficient clearance'))).toBe(true);
    } finally { physics.dispose(); }
  }
});

it('keeps nondegenerate texture coordinates on every top, underside and retaining face', () => {
  const surface: WalkableSurface = { id: 'uv', ownerStory: 0, layer: 'ground', role: 'ramp', bounds: { minX: -3, maxX: 3, minZ: -1, maxZ: 1 },
    profile: { kind: 'linear', axis: 'x', startY: -.8, endY: .9 }, ceilingY: 4, thickness: .16, support: 'solid', supportBottom: -1,
    access: 'open', edges: 'architecture' };
  for (const face of ['top', 'underside', 'sides'] as const) {
    const geometry = createWalkableGeometry(surface, face), uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i += 3) {
      const area = Math.abs((uv.getX(i + 1) - uv.getX(i)) * (uv.getY(i + 2) - uv.getY(i)) - (uv.getY(i + 1) - uv.getY(i)) * (uv.getX(i + 2) - uv.getX(i)));
      expect(area, `${face} triangle ${i / 3}`).toBeGreaterThan(.00001);
    }
    geometry.dispose();
  }
});
