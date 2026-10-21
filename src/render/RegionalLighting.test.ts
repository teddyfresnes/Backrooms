import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { applyRegionalLighting, bakeRegionalLightData, createRegionalLightField } from './RegionalLighting';
import { createFluorescentLightField, createZonalMaterialSet } from './ZonalLighting';
import { generateWorld } from '../world/generateWorld';
import { WorldView } from './WorldBuilder';
import type { MaterialSet } from './MaterialLibrary';
import type { WalkableSurface } from '../world/WalkableTopology';

const sourceMaterials = () => Object.fromEntries(['wall', 'plaster', 'floor', 'ceiling', 'baseboard', 'pitWall', 'pitBottom', 'metal', 'fixtureFrame', 'fixtureGlow', 'void']
  .map(name => [name, name === 'fixtureGlow' || name === 'void' ? new THREE.MeshBasicMaterial() : new THREE.MeshStandardMaterial()])) as unknown as MaterialSet;
const base: WalkableSurface = { id: 'lower', ownerStory: 0, layer: 'lower', role: 'floor', bounds: { minX: -12, maxX: 12, minZ: -12, maxZ: 12 },
  profile: { kind: 'flat', y: -5 }, ceilingY: -2, ceilingProfile: { kind: 'flat', y: -2 }, thickness: .16, support: 'slab', access: 'open', edges: 'architecture' };
const disposeField = (field: ReturnType<typeof createRegionalLightField>) => { field.texture.dispose(); field.lighting.dispose(); };

it('keeps historical exposure in its volume and supports more than three overlapping floors', () => {
  const plan = generateWorld('REGIONAL-LIGHT-STACK');
  plan.topology!.surfaces = Array.from({ length: 5 }, (_, i) => ({ ...base, id: `floor-${i}`, layer: `layer-${i}`, profile: { kind: 'flat' as const, y: -5 + i * 6 }, ceilingY: -2 + i * 6, ceilingProfile: { kind: 'flat' as const, y: -2 + i * 6 } }));
  plan.walls = []; plan.columns = []; plan.solidMasses = []; plan.unlitZones = [];
  plan.lights = [{ id: 'lamp', x: 0, z: 0, ceilingY: 22, width: 1.55, rotation: 0, intensity: 1.08, color: 0xffefb8, dead: false, unstable: false, phase: 0, roomId: 'fixture', level: 0 }];
  const field = createRegionalLightField(plan), values = field.lighting.image.data as Uint8Array;
  expect(field.layers).toBe(5);
  const at = (layer: number) => values[((layer * 96 + 48) * 96 + 48) * 4]!;
  for (let i = 0; i < 4; i++) expect(at(i)).toBe(Math.round(.22 * 255));
  const reference = createFluorescentLightField(plan);
  expect(at(4)).toBe((reference.image.data as Uint8Array)[(48 * 96 + 48) * 2]);
  expect(at(4)).toBeGreaterThan(190);
  reference.dispose(); disposeField(field);
});

it('preserves exposure and contact fields when a complete room is translated vertically', () => {
  const plan = generateWorld('TRANSLATED-LIGHT'); plan.unlitZones = []; plan.columns = []; plan.solidMasses = [];
  const fields = [-12, 0, 7].map(y => {
    plan.topology!.surfaces = [{ ...base, profile: { kind: 'flat', y }, ceilingY: y + 2.74, ceilingProfile: { kind: 'flat', y: y + 2.74 } }];
    plan.lights = [{ id: 'lamp', x: 0, z: 0, ceilingY: y + 2.74, width: 1.55, rotation: 0, intensity: 1.08, color: 0xffffe4, dead: false, unstable: false, phase: 0, roomId: 'fixture', level: 0 }];
    plan.walls = [{ id: 'wall', x: -8, z: 0, length: 20, orientation: 'z', thickness: 1.4, bottom: y, height: 2.74, tint: 1, collision: true, kind: 'wallpaper' }];
    return createRegionalLightField(plan);
  });
  try { expect(fields[0]!.lighting.image.data).toEqual(fields[1]!.lighting.image.data); expect(fields[2]!.lighting.image.data).toEqual(fields[1]!.lighting.image.data); }
  finally { fields.forEach(disposeField); }
});

it('replaces the zonal sample without multiplying exposure a second time', () => {
  const plan = generateWorld('REGIONAL-SHADER'), source = sourceMaterials(), zonal = createZonalMaterialSet(source, plan), field = createRegionalLightField(plan);
  try {
    const m = zonal.materials.wall; applyRegionalLighting(m, field);
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('blackout = localLighting.b');
    expect(shader.fragmentShader).toContain('(zonalChunkPosition.y - localVolume.x) / wallHeight');
    expect(shader.fragmentShader).not.toContain('mix(0.35, 1.14');
    expect(shader.fragmentShader).not.toContain('texture2D(lightField, lightFieldUv).rg');
  } finally { disposeField(field); zonal.context.lightField.dispose(); zonal.ownedMaterials.forEach(m => m.dispose()); Object.values(source).forEach(m => m.dispose()); }
});

it('constructs both modes, keeps classic baking and releases both modern volume textures', async () => {
  const dispose = vi.spyOn(THREE.DataTexture.prototype, 'dispose'), source = sourceMaterials();
  try {
    for (const lightingMode of ['modern', 'legacy'] as const) {
      const plan = generateWorld('REGIONAL-RENDER-MODES'); plan.features = []; plan.propPlacements = [];
      const view = new WorldView(plan, source, { lightingMode }); await view.ready;
      const floor = view.group.getObjectByName('regional-carpet-floors') as THREE.Mesh;
      expect(floor.geometry.getAttribute('position').count).toBeGreaterThan(0);
      expect(floor.material instanceof THREE.Material && floor.material.customProgramCacheKey().includes('regional-zonal')).toBe(lightingMode === 'modern');
      view.dispose();
    }
    for (const name of ['regional-volume-bounds', 'regional-fluorescent-field']) expect(dispose.mock.contexts.filter(t => (t as THREE.Texture).name === name)).toHaveLength(1);
  } finally { dispose.mockRestore(); Object.values(source).forEach(m => m.dispose()); }
});

it('mounts the exact structured-cloned worker light buffers without a second bake', () => {
  const plan = generateWorld('REGIONAL-WORKER-LIGHT');
  const data = structuredClone(bakeRegionalLightData(plan));
  const field = createRegionalLightField(plan, data);
  expect(field.texture.image.data).toBe(data.bounds); expect(field.lighting.image.data).toBe(data.lighting);
  disposeField(field);
});
