import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { WorldStream } from '../core/WorldStream';
import { generateInfiniteChunk } from '../world/InfiniteWorld';
import { resolveLightingBrightness } from './LightingBrightness';
import { createFluorescentDiffuser } from './FluorescentFixture';
import type { MaterialSet } from './MaterialLibrary';
import type { WorldView } from './WorldBuilder';
import type { WorldPlan } from '../world/types';

const gate = vi.hoisted(() => ({ holdNext: false, release: undefined as (() => void) | undefined }));
vi.mock('./WorldProps', async () => {
  const three = await import('three');
  return { WorldPropLayer: class {
    group = new three.Group(); count = 0; ready: Promise<void>;
    constructor() {
      this.ready = gate.holdNext ? new Promise(resolve => { gate.release = resolve; }) : Promise.resolve();
      gate.holdNext = false;
    }
    dispose() { this.group.removeFromParent(); }
  } };
});

const setup = () => {
  const plan = generateInfiniteChunk('BRIGHTNESS-STREAM', { x: 0, z: 0, story: 0 }); plan.propPlacements = [];
  const materials = Object.fromEntries(['wall','plaster','floor','ceiling','baseboard','pitWall','pitBottom','metal','fixtureFrame','fixtureGlow','void']
    .map(n => [n, n === 'fixtureGlow' ? createFluorescentDiffuser() : n === 'void' ? new THREE.MeshBasicMaterial() : new THREE.MeshStandardMaterial({ name: n })])) as unknown as MaterialSet;
  materials.floor.userData.matteRoughness = [.82, .98];
  const physics = { addChunk() {}, removeChunk() {}, batchChunkChanges(run: () => void) { run(); } };
  const stream = new WorldStream(plan.seed, plan, new THREE.Scene(), Object.fromEntries(['yellow','dim','red','white'].map(b => [b, materials])) as never, physics as never);
  const probe = stream as unknown as { mountChunk(world: WorldPlan): void; chunks: Map<string, { view: WorldView }> };
  const cleanup = () => { gate.release?.(); gate.release = undefined; gate.holdNext = false; stream.dispose(); Object.values(materials).forEach(m => m.dispose()); };
  return { stream, probe, plan, materials, cleanup };
};
const floor = (view: WorldView) => (view.group.getObjectByName('regional-carpet-floors') as THREE.Mesh).material as THREE.MeshStandardMaterial;
const compile = (material: THREE.Material) => {
  const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer); return shader;
};

it('updates mounted and future previews without remounting architecture, changing plans or touching HDR fixtures', async () => {
  const { stream, probe, plan, materials, cleanup } = setup(), original = JSON.stringify(plan);
  try {
    probe.mountChunk(plan); const view = probe.chunks.get('0:0:0')!.view; await view.ready;
    const meshes = view.group.children.map(o => o.uuid), m = floor(view), shader = compile(m), version = m.version;
    expect(shader.fragmentShader).toContain('roughnessFactor = mix');
    const glow = materials.fixtureGlow.color.toArray();
    for (const value of [0, 100, 50, 0]) {
      stream.setBrightness(value);
      expect(shader.uniforms.lightPoolMin!.value).toBeCloseTo(resolveLightingBrightness(value).pool.min);
      expect(view.group.children.map(o => o.uuid)).toEqual(meshes); expect(m.version).toBe(version);
      expect(materials.fixtureGlow.color.toArray()).toEqual(glow);
    }
    const far = generateInfiniteChunk(plan.seed, { x: 1, z: 0, story: 0 }); far.propPlacements = [];
    probe.mountChunk(far); const preview = probe.chunks.get('1:0:0')!.view;
    expect(preview.architectureOnly).toBe(true);
    expect(compile(floor(preview)).uniforms.lightPoolMax!.value).toBeCloseTo(1.42);
    await preview.promoteDetails(); expect(compile(floor(preview)).uniforms.lightPoolMax!.value).toBeCloseTo(1.42);
    expect(JSON.stringify(plan)).toBe(original);
  } finally { cleanup(); }
});

it('retains the latest slider value when an asynchronous lighting-mode replacement completes', async () => {
  const { stream, probe, plan, cleanup } = setup();
  try {
    probe.mountChunk(plan); await stream.waitForVisualAssets(); stream.setBrightness(0);
    gate.holdNext = true; const replacement = stream.setLightingMode('legacy');
    await vi.waitFor(() => expect(gate.release).toBeTypeOf('function'));
    stream.setBrightness(100); gate.release!(); await replacement;
    const view = probe.chunks.get('0:0:0')!.view, m = floor(view), lightMap = m.lightMap, version = m.version;
    expect(m.lightMapIntensity).toBeCloseTo(.7);
    stream.setBrightness(0); expect(m.lightMapIntensity).toBeCloseTo(.7 * resolveLightingBrightness(0).relativeGain);
    stream.setBrightness(100); expect(m.lightMapIntensity).toBeCloseTo(.7);
    expect(m.lightMap).toBe(lightMap); expect(m.version).toBe(version);
    await stream.setLightingMode('modern');
    expect(compile(floor(probe.chunks.get('0:0:0')!.view)).uniforms.lightPoolMin!.value).toBeCloseTo(.72);
  } finally { cleanup(); }
});
