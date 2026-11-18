import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { environmentFixture } from '../../tests/support/environment-fixture';
import { EnvironmentLighting } from './EnvironmentLighting';
import { applyZonalLighting, createZonalLightingContext } from './ZonalLighting';
import { EnvironmentWater } from '../environment/EnvironmentWater';
import { createEnvironmentModel } from '../environment/EnvironmentModels';

const shaderFor = (material: THREE.Material) => {
  const source = material instanceof THREE.MeshBasicMaterial ? THREE.ShaderLib.basic : THREE.ShaderLib.physical;
  const shader = { vertexShader: source.vertexShader, fragmentShader: source.fragmentShader, uniforms: {} };
  material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer); return shader;
};
describe('environmental GPU contracts', () => {
  it('composes room-bounded flicker with existing zonal lighting without changing another chunk', () => {
    const plan = environmentFixture('flicker'), lights = new EnvironmentLighting(plan), other = new EnvironmentLighting(plan);
    const context = createZonalLightingContext(plan), material = new THREE.MeshStandardMaterial();
    applyZonalLighting(material, context); lights.apply(material);
    lights.offset.value.set(224, -10.8, 336); lights.set(plan.environmentEvents![0]!.id, 0);
    const shader = shaderFor(material);
    expect(shader.fragmentShader).toContain('lightDisturbSurface');
    expect(shader.fragmentShader).toContain('ep = vEnvironmentWorld - envOffset');
    expect(shader.fragmentShader).toContain('step(h.x, ep.y) * step(ep.y, h.y)');
    expect(shader.vertexShader).toContain('instanceMatrix');
    expect(lights.slots[0]!.height.z).toBe(0); expect(other.slots[0]!.height.z).toBe(1);
    expect(shader.uniforms).toHaveProperty('envBounds');
    material.dispose(); context.lightField.dispose();
  });
  it('keeps water highlights and contact ripples after event lighting decoration', () => {
    const plan = environmentFixture('flood'), water = new EnvironmentWater(plan.environmentEvents![0]!, plan);
    const shader = shaderFor(water.material);
    expect(shader.fragmentShader).toContain('waterRings[8]');
    expect(shader.fragmentShader).toContain('lamp.xyz + waterOffset');
    expect(shader.fragmentShader).toContain('abs(delta.x)');
    water.update(.016, 40, true, { x: 224, y: -10.8, z: 336 }, () => undefined);
    expect(water.root.children.length).toBeLessThan(36); water.dispose();
  });
  it('builds detailed correctly oriented wall devices with a complete disposal path', () => {
    for (const kind of ['fire-alarm', 'telephone', 'surveillance'] as const) {
      const model = createEnvironmentModel(kind, 'MODEL-CONTRACT'), bounds = new THREE.Box3().setFromObject(model.root);
      expect(bounds.min.z).toBeGreaterThan(-.01); expect(bounds.max.z).toBeLessThan(.75);
      const geometries = new Set<THREE.BufferGeometry>(); let disposed = 0;
      model.root.traverse(o => { if (o instanceof THREE.Mesh && !geometries.has(o.geometry)) { geometries.add(o.geometry); o.geometry.addEventListener('dispose', () => disposed++); } });
      expect(geometries.size).toBeGreaterThan(10);
      if (kind === 'telephone') expect(model.receiver?.name).toBe('telephone-handset');
      if (kind === 'surveillance') expect(model.head?.name).toBe('surveillance-gimbal');
      model.dispose(); expect(disposed).toBe(geometries.size); expect(model.root.children).toHaveLength(0);
    }
  });
});
