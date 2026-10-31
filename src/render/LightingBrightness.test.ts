import { expect, it } from 'vitest';
import * as THREE from 'three';
import { normalizeBrightness, resolveLightingBrightness } from './LightingBrightness';
import { applyMatteSurface } from './MatteSurface';
import { createFluorescentDiffuser } from './FluorescentFixture';
import { applyZonalLighting, createZonalMaterialSet, setZonalBrightness } from './ZonalLighting';
import { generateInfiniteChunk } from '../world/InfiniteWorld';
import type { MaterialSet } from './MaterialLibrary';

it('matches both historical modern calibrations, their midpoint, and a continuous monotone response', () => {
  expect(resolveLightingBrightness(0).rig).toEqual({ hemisphere: .14, ambient: .055, key: .22 });
  expect(resolveLightingBrightness(100).rig).toEqual({ hemisphere: .32, ambient: .1, key: .34 });
  expect(resolveLightingBrightness(0).pool).toEqual({ min: .5, max: 1.42 });
  expect(resolveLightingBrightness(100).pool).toEqual({ min: .72, max: 1.85 });
  expect(resolveLightingBrightness().rig.hemisphere).toBeCloseTo(.23);
  expect(resolveLightingBrightness().pool.min).toBeCloseTo(.61);
  let previous = 0;
  for (let n = 0; n <= 100; n++) { const p = resolveLightingBrightness(n); expect(p.relativeGain).toBeGreaterThan(previous); previous = p.relativeGain; }
  expect(previous).toBeCloseTo(1); expect(normalizeBrightness(0)).toBe(0);
  for (const value of [undefined, NaN, Infinity, null, '50']) expect(normalizeBrightness(value)).toBe(50);
});

it('updates live and later-created shader uniforms while retaining fields, contacts and HDR emitters', () => {
  const plan = generateInfiniteChunk('BRIGHTNESS-CONTRACT', { x: 0, z: 0, story: 0 });
  const source = Object.fromEntries(['wall','plaster','floor','ceiling','baseboard','pitWall','pitBottom','metal','fixtureFrame','fixtureGlow','void']
    .map(n => [n, n === 'fixtureGlow' ? createFluorescentDiffuser() : n === 'void' ? new THREE.MeshBasicMaterial() : new THREE.MeshStandardMaterial()])) as unknown as MaterialSet;
  const set = createZonalMaterialSet(source, plan), decor = new THREE.MeshStandardMaterial();
  const compile = (material: THREE.Material) => {
    const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer); return shader;
  };
  try {
    const shader = compile(set.materials.wall), version = set.materials.wall.version, texture = set.context.lightField, glow = source.fixtureGlow.color.toArray();
    for (const value of [0, 50, 100, 0]) {
      setZonalBrightness(set.context, value);
      expect(shader.uniforms.lightPoolMin!.value).toBeCloseTo(resolveLightingBrightness(value).pool.min);
      expect(shader.uniforms.darkFloor!.value).toBe(.045); expect(shader.uniforms.verticalRelief!.value).toBe(.12);
      expect(source.fixtureGlow.color.toArray()).toEqual(glow); expect(Math.min(...glow)).toBeGreaterThan(1.8);
      expect(set.materials.wall.version).toBe(version); expect(set.context.lightField).toBe(texture);
    }
    applyZonalLighting(decor, set.context);
    const future = compile(decor); expect(future.uniforms.lightPoolMin).toBe(shader.uniforms.lightPoolMin);
    setZonalBrightness(set.context, 100); expect(future.uniforms.lightPoolMax!.value).toBe(1.85);
  } finally { decor.dispose(); set.ownedMaterials.forEach(m => m.dispose()); set.context.lightField.dispose(); Object.values(source).forEach(m => m.dispose()); }
});

it('remaps textured roughness after sampling, composes lighting hooks and survives a clone without changing maps', () => {
  const map = new THREE.Texture(), material = new THREE.MeshStandardMaterial({ roughness: .86, roughnessMap: map });
  material.onBeforeCompile = shader => { shader.fragmentShader += '\n// preceding lighting decorator'; };
  applyMatteSurface(material, [.82, .98]); applyMatteSurface(material);
  const clone = material.clone(); applyMatteSurface(clone);
  try {
    for (const m of [material, clone]) {
      const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
      m.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
      expect(shader.fragmentShader.match(/roughnessFactor = mix/g)).toHaveLength(1);
      expect(shader.fragmentShader.indexOf('roughnessFactor = mix')).toBeGreaterThan(shader.fragmentShader.indexOf('#include <roughnessmap_fragment>'));
      expect(shader.fragmentShader.indexOf('roughnessFactor = mix')).toBeLessThan(shader.fragmentShader.indexOf('#include <lights_physical_fragment>'));
      expect(m.roughnessMap).toBe(map); expect(m.metalness).toBe(0);
    }
    const shader = { uniforms: {}, vertexShader: '', fragmentShader: '#include <roughnessmap_fragment>' };
    material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('preceding lighting decorator');
  } finally { material.dispose(); clone.dispose(); map.dispose(); }
});
