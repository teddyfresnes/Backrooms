import * as THREE from 'three';
import { compileSceneProgressively } from './SceneWarmup';

/** Prepares content streamed in during play before it is ever drawn. */
export interface GpuStager { prepare(root: THREE.Object3D, alive?: () => boolean): Promise<void> }
let active: GpuStager | null = null;

/** Installed by the running game; tests and tools keep the immediate behaviour. */
export const setGpuStager = (stager: GpuStager | null): void => { active = stager; };
/** Removes `stager` only if it is still the installed one (a newer game may own it). */
export const releaseGpuStager = (stager: GpuStager): void => { if (active === stager) active = null; };
export const gpuStagingActive = (): boolean => active !== null;

/** Resolves once `root`'s textures, shader programs and buffers are resident. */
export const prepareForDisplay = (root: THREE.Object3D, alive: () => boolean = () => true): Promise<void> =>
  active ? active.prepare(root, alive).catch(error => { console.warn('[gpu] preparation incomplete', error); }) : Promise.resolve();

/** Hides `root` until it is prepared, so first sight never compiles or uploads
 * inside a gameplay frame. `alive` stops the reveal of disposed content. */
export const revealWhenPrepared = (root: THREE.Object3D, alive: () => boolean = () => true): Promise<void> => {
  if (!active) return Promise.resolve();
  root.visible = false;
  return prepareForDisplay(root, alive).then(() => { if (alive()) root.visible = true; });
};

const pause = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

/** One preparation at a time, each sliced into short tasks between frames.
 * Firefox has no parallel shader compilation: a program first linked inside a
 * frame froze it for hundreds of milliseconds at every new chunk or story. */
export class GpuStagingQueue implements GpuStager {
  private chain: Promise<void> = Promise.resolve();
  private readonly uploadMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  private readonly uploadTarget = new THREE.WebGLRenderTarget(1, 1);
  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly cancelled: () => boolean,
    private readonly settleMs = 160,
  ) {}

  /** Content unmounted while waiting its turn is skipped (its buffers are freed). */
  prepare(root: THREE.Object3D, alive: () => boolean = () => true): Promise<void> {
    const run = () => this.cancelled() || !alive() ? Promise.resolve() : this.stage(root);
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  dispose(): void { this.uploadMaterial.dispose(); this.uploadTarget.dispose(); }

  private async stage(root: THREE.Object3D): Promise<void> {
    const textures = new Set<THREE.Texture>(), meshes: THREE.Mesh[] = [], geometries = new Set<THREE.BufferGeometry>();
    root.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      if ((mesh as THREE.InstancedMesh).isInstancedMesh || !geometries.has(mesh.geometry)) { geometries.add(mesh.geometry); meshes.push(mesh); }
    });
    let slice = performance.now();
    for (const texture of textures) {
      if (this.cancelled()) return;
      this.renderer.initTexture(texture);
      if (performance.now() - slice >= 6) { await pause(); slice = performance.now(); }
    }
    await compileSceneProgressively(this.renderer, root, this.camera, { targetScene: this.scene, cancelled: this.cancelled, settleMs: this.settleMs });
    await this.uploadGeometry(meshes);
  }

  /** Zero draw ranges into a private 1x1 target: buffers become resident without
   * drawing anything, and the visible canvas is never touched between frames. */
  private async uploadGeometry(meshes: THREE.Mesh[]): Promise<void> {
    const staging = new THREE.Scene();
    for (let cursor = 0; cursor < meshes.length;) {
      if (this.cancelled()) return;
      const ranges = new Map<THREE.BufferGeometry, { start: number; count: number }>();
      for (let count = 0; count < 12 && cursor < meshes.length; count++) {
        const source = meshes[cursor++]!, geometry = source.geometry;
        if (!ranges.has(geometry)) { ranges.set(geometry, { ...geometry.drawRange }); geometry.setDrawRange(0, 0); }
        let proxy: THREE.Mesh;
        if ((source as THREE.InstancedMesh).isInstancedMesh) {
          const original = source as THREE.InstancedMesh, instance = new THREE.InstancedMesh(geometry, this.uploadMaterial, 0);
          instance.instanceMatrix = original.instanceMatrix; instance.instanceColor = original.instanceColor;
          instance.boundingSphere = new THREE.Sphere(); proxy = instance;
        } else proxy = new THREE.Mesh(geometry, this.uploadMaterial);
        proxy.frustumCulled = false; staging.add(proxy);
      }
      const previous = this.renderer.getRenderTarget(), sorting = this.renderer.sortObjects;
      try { this.renderer.sortObjects = false; this.renderer.setRenderTarget(this.uploadTarget); this.renderer.render(staging, this.camera); }
      finally {
        this.renderer.setRenderTarget(previous); this.renderer.sortObjects = sorting;
        for (const [geometry, range] of ranges) geometry.setDrawRange(range.start, range.count);
        staging.clear();
      }
      await pause();
    }
  }
}
