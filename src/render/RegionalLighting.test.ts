import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createRegionalLightField } from './RegionalLighting';
import { generateWorld } from '../world/generateWorld';
import { WorldView } from './WorldBuilder';
import type { MaterialSet } from './MaterialLibrary';
import type { WalkableSurface } from '../world/WalkableTopology';

it('keeps a light in its actual circulation volume across two overlapping floors', () => {
  const plan = generateWorld('REGIONAL-LIGHT-STACK'), base: WalkableSurface = { id: 'lower', ownerStory: 0, layer: 'lower', role: 'floor', bounds: { minX: -12, maxX: 12, minZ: -12, maxZ: 12 },
    profile: { kind: 'flat', y: -5 }, ceilingY: -2, ceilingProfile: { kind: 'flat', y: -2 }, thickness: .16, support: 'slab', access: 'open', edges: 'architecture' };
  plan.topology!.surfaces = [base, { ...base, id: 'upper', layer: 'upper', profile: { kind: 'flat', y: 1 }, ceilingY: 4, ceilingProfile: { kind: 'flat', y: 4 } }];
  plan.unlitZones = [];
  for (const ceilingY of [4, -2]) {
    plan.lights = [{ id: 'lamp', x: 0, z: 0, ceilingY, width: 1.3, rotation: 0, intensity: 1, color: 0xffefb8, dead: false, unstable: false, phase: 0, roomId: 'fixture', level: 0 }];
    const field = createRegionalLightField(plan), values = field.texture.image.data as Float32Array;
    const at = (layer: number, channel: number) => values[((layer * 64 + 32) * 64 + 32) * 4 + channel]!;
    expect(at(0, 0)).toBe(-5); expect(at(1, 0)).toBe(1);
    expect(at(ceilingY === 4 ? 0 : 1, 2)).toBeCloseTo(.18, 5);
    expect(at(ceilingY === 4 ? 1 : 0, 2)).toBeGreaterThan(.65);
    field.texture.dispose();
  }
});

it('constructs both render modes and releases their layered exposure textures', async () => {
  const dispose = vi.spyOn(THREE.DataTexture.prototype, 'dispose');
  const source = Object.fromEntries(['wall', 'plaster', 'floor', 'ceiling', 'baseboard', 'pitWall', 'pitBottom', 'metal', 'fixtureFrame', 'fixtureGlow', 'void']
    .map(name => [name, name === 'fixtureGlow' || name === 'void' ? new THREE.MeshBasicMaterial() : new THREE.MeshStandardMaterial()])) as unknown as MaterialSet;
  try {
    for (const lightingMode of ['modern', 'legacy'] as const) {
      const plan = generateWorld('REGIONAL-RENDER-MODES'); plan.features = []; plan.propPlacements = [];
      const view = new WorldView(plan, source, { lightingMode }); await view.ready;
      const floor = view.group.getObjectByName('regional-carpet-floors') as THREE.Mesh;
      expect(floor.geometry.getAttribute('position').count).toBeGreaterThan(0);
      view.dispose();
    }
    expect(dispose.mock.contexts.filter(t => (t as THREE.Texture).name === 'regional-layer-exposure')).toHaveLength(2);
  } finally { dispose.mockRestore(); Object.values(source).forEach(m => m.dispose()); }
});
