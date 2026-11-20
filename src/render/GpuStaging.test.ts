import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { environmentFixture } from '../../tests/support/environment-fixture';
import { gpuStagingActive, releaseGpuStager, revealWhenPrepared, setGpuStager, type GpuStager } from './GpuStaging';
import { WorldView } from './WorldBuilder';
import type { MaterialSet } from './MaterialLibrary';

/** A stager whose preparations finish only when the test says so. */
const deferredStager = () => {
  const pending: { root: THREE.Object3D; done: () => void }[] = [];
  const stager: GpuStager = { prepare: root => new Promise<void>(resolve => pending.push({ root, done: resolve })) };
  return { stager, pending, flush: async () => { while (pending.length) pending.shift()!.done(); await new Promise(r => setTimeout(r, 0)); } };
};
const materials = (): MaterialSet => ({
  wall: new THREE.MeshStandardMaterial(), plaster: new THREE.MeshStandardMaterial(), floor: new THREE.MeshStandardMaterial(),
  ceiling: new THREE.MeshStandardMaterial(), baseboard: new THREE.MeshStandardMaterial(), pitWall: new THREE.MeshStandardMaterial(),
  pitBottom: new THREE.MeshStandardMaterial(), metal: new THREE.MeshStandardMaterial(), fixtureFrame: new THREE.MeshStandardMaterial(),
  fixtureGlow: new THREE.MeshBasicMaterial(), void: new THREE.MeshBasicMaterial(),
});
afterEach(() => setGpuStager(null));

describe('off-frame GPU staging of streamed content', () => {
  it('keeps content hidden until its programs are prepared, and is inert without a stager', async () => {
    const root = new THREE.Group();
    await revealWhenPrepared(root); expect(root.visible).toBe(true); expect(gpuStagingActive()).toBe(false);
    const { stager, pending, flush } = deferredStager(); setGpuStager(stager);
    const shown = revealWhenPrepared(root);
    expect(root.visible).toBe(false); expect(pending[0]!.root).toBe(root);
    await flush(); await shown; expect(root.visible).toBe(true);
    const disposed = new THREE.Group(), late = revealWhenPrepared(disposed, () => false);
    await flush(); await late; expect(disposed.visible).toBe(false);
  });
  it('only releases the stager that is still installed', () => {
    const first = deferredStager().stager, second = deferredStager().stager;
    setGpuStager(first); setGpuStager(second); releaseGpuStager(first);
    expect(gpuStagingActive()).toBe(true); releaseGpuStager(second); expect(gpuStagingActive()).toBe(false);
  });
  it('reveals promoted chunk details only once they are prepared', async () => {
    const plan = environmentFixture('flood');
    plan.missingCeilingTiles = [{ x: 0, z: 0, rotation: 0, hanging: false }];
    const view = new WorldView(plan, materials(), { architectureOnly: true });
    const { stager, flush } = deferredStager(); setGpuStager(stager);
    const ready = view.promoteDetails();
    const damage = view.group.getObjectByName('missing-ceiling-tiles')!;
    expect(damage.visible).toBe(false);
    await new Promise(r => setTimeout(r, 0)); await flush(); await ready;
    expect(damage.visible).toBe(true);
    view.dispose();
  });
});
