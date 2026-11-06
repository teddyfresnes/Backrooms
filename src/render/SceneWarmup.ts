import * as THREE from 'three';
import { CooperativeWork, yieldToBrowser } from '../core/CooperativeWork';

// Preparation submits GPU work; it does not need a displayed animation frame.
// rAF pauses in hidden tabs and imposed one full frame per texture on slow GPUs.
const pollGpu = () => new Promise<void>(resolve => setTimeout(resolve, 16));
const DATA_MAPS = new Set(['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap']);
const originalSources = new WeakMap<THREE.Texture, THREE.Texture['source']>();

export function restoreSceneDataMaps(scene: THREE.Object3D): void {
  scene.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.material) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) {
        const original = originalSources.get(value);
        if (!original) continue;
        value.dispose(); value.source = original; value.needsUpdate = true; originalSources.delete(value);
      }
    }
  });
}

/** Keep colour detail; secondary maps need a smaller working set on integrated GPUs.
 * A new Source is essential: Texture.clone() shares its Source with the wardrobe.
 */
export function compactSceneDataMaps(scene: THREE.Object3D, maxSize = 512): number {
  const data = new Set<THREE.Texture>(), colour = new Set<THREE.Texture>();
  scene.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.material) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const [role, value] of Object.entries(material)) if (value instanceof THREE.Texture)
        (DATA_MAPS.has(role) ? data : colour).add(value);
    }
  });
  const resized = new Map<object, THREE.Source<HTMLCanvasElement>>();
  let savedPixels = 0;
  for (const texture of data) {
    if (colour.has(texture) || texture instanceof THREE.DataTexture || texture instanceof THREE.CompressedTexture) continue;
    const source = texture.image as { width?: number; height?: number; data?: unknown } | undefined;
    if (!source || source.data || !source.width || !source.height || Math.max(source.width, source.height) <= maxSize) continue;
    let compactSource = resized.get(source);
    if (!compactSource) {
      const canvas = document.createElement('canvas');
      const ratio = maxSize / Math.max(source.width, source.height);
      canvas.width = Math.max(1, Math.round(source.width * ratio));
      canvas.height = Math.max(1, Math.round(source.height * ratio));
      const context = canvas.getContext('2d');
      if (!context) continue;
      context.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height);
      compactSource = new THREE.Source(canvas);
      resized.set(source, compactSource);
      savedPixels += source.width * source.height - canvas.width * canvas.height;
    }
    originalSources.set(texture, texture.source);
    texture.dispose(); texture.source = compactSource;
    texture.needsUpdate = true;
  }
  return savedPixels;
}

/** Wait for queued uploads/draws without gl.finish() or a blocking GPU readback. */
export async function waitForSceneGpu(
  gl: WebGL2RenderingContext, cancelled: () => boolean, yieldFrame = pollGpu,
): Promise<void> {
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!fence) return;
  try {
    gl.flush();
    const deadline = performance.now() + 15000;
    while (!cancelled()) {
      const status = gl.clientWaitSync(fence, 0, 0);
      if (gl.isContextLost() || status === gl.WAIT_FAILED) throw new Error('Préparation graphique interrompue.');
      if (status !== gl.TIMEOUT_EXPIRED) return;
      if (performance.now() >= deadline) throw new Error('La préparation graphique a expiré.');
      await yieldFrame();
    }
  } finally { gl.deleteSync(fence); }
}

type ProgramHandle = { getUniforms?(): unknown };
type CompilingRenderer = Pick<THREE.WebGLRenderer, 'compileAsync'> & Partial<Pick<THREE.WebGLRenderer,
  'compile' | 'properties' | 'extensions' | 'getRenderTarget' | 'setRenderTarget' | 'info'>>;

/** A real task (not scheduler.yield, whose continuations outrank timers and
 * paint): the loading view, timers and network run between compile slices. */
const browserTask = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

export interface ProgressiveCompileOptions {
  cancelled?(): boolean;
  onProgress?(value: number): void;
  pause?(): Promise<void>;
  /** The scene is drawn into an off-screen target (PostFX composer). Three's
   * program key depends on the bound target (output colour space): compiling
   * against the canvas built a variant the first real frame threw away and
   * compiled again, doubling a load already dominated by shader links. */
  offscreen?: boolean;
  onProgramCount?(count: number): void;
}

/** Without KHR_parallel_shader_compile (Firefox), compileAsync resolves at once
 * and every program links synchronously inside the next render: one frozen
 * task of tens of seconds. Link one material's programs per slice instead. */
export async function compileSceneProgressively(
  renderer: CompilingRenderer, scene: THREE.Object3D, camera: THREE.Camera, options: ProgressiveCompileOptions = {},
): Promise<void> {
  const { cancelled = () => false, onProgress, pause = browserTask, offscreen = true } = options;
  const canBind = offscreen && renderer.getRenderTarget && renderer.setRenderTarget;
  const target = canBind ? new THREE.WebGLRenderTarget(1, 1) : undefined, previous = canBind ? renderer.getRenderTarget!() : null;
  const bind = () => { if (target) renderer.setRenderTarget!(target); };
  const unbind = () => { if (target) renderer.setRenderTarget!(previous); };
  const before = renderer.info?.programs?.length ?? 0;
  try {
    // has() checks silently; get() logs "extension not supported" on Firefox.
    const parallel = renderer.extensions?.has?.('KHR_parallel_shader_compile');
    if (parallel || !renderer.compile || !renderer.properties) {
      bind(); const ready = renderer.compileAsync(scene, camera); unbind();
      await ready; onProgress?.(1); return;
    }
    const representatives = new Map<string, THREE.Object3D>();
    scene.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.material || !(mesh.isMesh || (object as THREE.Points).isPoints || (object as THREE.Line).isLine || (object as THREE.Sprite).isSprite)) return;
      const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh, instanced = (mesh as THREE.InstancedMesh).isInstancedMesh;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        // Object traits change the program; the material alone does not.
        const key = `${material.uuid}:${object.type}:${skinned ? 1 : 0}:${instanced ? 1 : 0}:${mesh.geometry?.morphAttributes?.position ? 1 : 0}:${mesh.geometry?.attributes.color ? 1 : 0}`;
        if (!representatives.has(key)) representatives.set(key, object);
      }
    });
    const objects = [...new Set(representatives.values())];
    // Pass 1 submits every compile/link without querying it. Firefox runs WebGL
    // in a separate GPU process: these are queued commands, so its compiler
    // works through them while this thread stays free. Querying each program
    // right after submitting it (the previous approach) serialized every link.
    const submitted = new Set<THREE.Material>();
    let sliceStart = performance.now();
    for (let i = 0; i < objects.length; i++) {
      if (cancelled()) return;
      bind();
      try { for (const material of renderer.compile(objects[i]!, camera, scene as THREE.Scene)) submitted.add(material); }
      finally { unbind(); }
      onProgress?.((i + 1) / objects.length * .2);
      if (performance.now() - sliceStart >= 12) { await pause(); sliceStart = performance.now(); }
    }
    // Pass 2: getUniforms() is Three's first use and waits for that one link.
    const programs = [...new Set([...submitted].map(material =>
      (renderer.properties!.get(material) as { currentProgram?: ProgramHandle }).currentProgram).filter(Boolean))] as ProgramHandle[];
    for (let i = 0; i < programs.length; i++) {
      if (cancelled()) return;
      programs[i]!.getUniforms?.();
      onProgress?.(.2 + (i + 1) / programs.length * .8);
      if (performance.now() - sliceStart >= 12) { await pause(); sliceStart = performance.now(); }
    }
    onProgress?.(1);
  } finally {
    target?.dispose();
    options.onProgramCount?.((renderer.info?.programs?.length ?? 0) - before);
  }
}

export interface SceneWarmupOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  render(): void;
  roots?: readonly THREE.Object3D[];
  staticRoots?: readonly THREE.Object3D[];
  viewpoints?: readonly { position: THREE.Vector3; target: THREE.Vector3 }[];
  cancelled(): boolean;
  onProgress?(value: number, phase?: string): void;
  onTiming?(phase: string, durationMs: number): void;
  yieldFrame?(): Promise<void>;
}

/** compileAsync only prepares programs; offscreen geometry is NOT uploaded.
 * Project small batches with zero draw ranges to initialize Three's resident
 * buffers without drawing the entire city/interior or changing authored data.
 * Instancing attributes are shared with their real object, never copied.
 */
export async function uploadSceneGeometry(options: SceneWarmupOptions, onProgress: (value: number) => void): Promise<void> {
  const { renderer, scene, camera, cancelled } = options;
  const pause = options.yieldFrame ?? yieldToBrowser;
  const geometrySet = new Set<THREE.BufferGeometry>();
  const entries: Array<{ mesh: THREE.Mesh; bytes: number }> = [];
  scene.traverse(object => {
    const source = object as THREE.Mesh;
    if (!source.geometry || (!source.isMesh && !(source as unknown as THREE.Line).isLine && !(source as unknown as THREE.Points).isPoints)) return;
    const instanced = source as THREE.InstancedMesh;
    if (!instanced.isInstancedMesh && geometrySet.has(source.geometry)) return;
    let bytes = 0;
    if (!geometrySet.has(source.geometry)) {
      geometrySet.add(source.geometry);
      const arrays = new Set<ArrayBufferView>();
      for (const attribute of Object.values(source.geometry.attributes)) arrays.add(attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.array : attribute.array);
      if (source.geometry.index) arrays.add(source.geometry.index.array);
      for (const attributes of Object.values(source.geometry.morphAttributes)) for (const attribute of attributes ?? []) arrays.add(attribute.array);
      bytes = [...arrays].reduce((sum, array) => sum + array.byteLength, 0);
    }
    if (instanced.isInstancedMesh) bytes += instanced.instanceMatrix.array.byteLength + (instanced.instanceColor?.array.byteLength ?? 0);
    entries.push({ mesh: source, bytes });
  });
  const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const staging = new THREE.Scene(), material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  let completed = 0, cursor = 0;
  try {
    while (cursor < entries.length && !cancelled()) {
      const ranges = new Map<THREE.BufferGeometry, { start: number; count: number }>();
      let batchBytes = 0, count = 0;
      while (cursor < entries.length && count < 8 && (count === 0 || batchBytes < 4 * 1024 * 1024)) {
        const entry = entries[cursor++]!, source = entry.mesh, geometry = source.geometry;
        if (!ranges.has(geometry)) { ranges.set(geometry, { ...geometry.drawRange }); geometry.setDrawRange(0, 0); }
        let proxy: THREE.Mesh;
        if ((source as THREE.InstancedMesh).isInstancedMesh) {
          const original = source as THREE.InstancedMesh, instance = new THREE.InstancedMesh(geometry, material, 0);
          instance.instanceMatrix = original.instanceMatrix; instance.instanceColor = original.instanceColor;
          instance.boundingSphere = new THREE.Sphere(); proxy = instance;
        } else proxy = new THREE.Mesh(geometry, material);
        proxy.frustumCulled = false; staging.add(proxy); batchBytes += entry.bytes; count++;
      }
      const sorting = renderer.sortObjects;
      try { renderer.sortObjects = false; renderer.render(staging, camera); }
      finally {
        renderer.sortObjects = sorting;
        for (const [geometry, range] of ranges) geometry.setDrawRange(range.start, range.count);
        staging.clear();
      }
      completed += batchBytes; onProgress(total ? completed / total : 1); await pause();
    }
  } finally { material.dispose(); staging.clear(); }
}

/** Resource preparation belongs behind the loading screen, without advancing gameplay. */
export async function warmSceneForPlay(options: SceneWarmupOptions): Promise<void> {
  const { renderer, scene, camera, cancelled } = options;
  if (cancelled()) return;
  const yieldFrame = options.yieldFrame ?? yieldToBrowser;
  let stageStart = performance.now();
  const timing = (phase: string): void => { const now = performance.now(); options.onTiming?.(phase, now - stageStart); stageStart = now; };
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  scene.updateMatrixWorld(true);
  scene.traverse(object => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    if (mesh.isSkinnedMesh) skeletons.add(mesh.skeleton);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
  });
  // Render sorting asks for skinned bounds even with frustumCulled=false.
  // Compute the bone textures and bounds before the first player-controlled frame.
  for (const skeleton of skeletons) { skeleton.update(); if (!skeleton.boneTexture) skeleton.computeBoneTexture(); }
  const textureList = [...textures];
  let batchStart = performance.now();
  for (let i = 0; i < textureList.length; i++) {
    if (cancelled()) return;
    renderer.initTexture(textureList[i]!);
    options.onProgress?.((i + 1) / Math.max(1, textureList.length) * .35, 'Transfert des textures');
    // Bound each batch by both work and time, rather than paying one display
    // frame for every (often small or already shared) texture.
    if ((i + 1) % 8 === 0 || performance.now() - batchStart >= 4) {
      await yieldFrame(); batchStart = performance.now();
    }
  }
  timing('textures');
  options.onProgress?.(.35, 'Transfert des géométries');
  await uploadSceneGeometry(options, value => options.onProgress?.(.35 + value * .20, 'Transfert des géométries'));
  timing('geometry');
  if (cancelled()) return;
  const visibility = new Map([...(options.roots ?? []), ...(options.staticRoots ?? [])].map(root => [root, root.visible]));
  const culling = new Map<THREE.Object3D, boolean>();
  const originalPosition = camera.position.clone(), originalQuaternion = camera.quaternion.clone();
  try {
    for (const root of visibility.keys()) root.visible = true;
    const renderables: THREE.Object3D[] = [];
    scene.traverse(object => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) return;
      renderables.push(object);
    });
    const work = new CooperativeWork();
    const vertex = new THREE.Vector3();
    const actorRenderables = new Set<THREE.Object3D>();
    for (const root of options.roots ?? []) root.traverse(object => actorRenderables.add(object));
    for (const object of renderables) {
      if (cancelled()) return;
      // Warm all actor views, but keep normal culling for static architecture.
      // Drawing the entire imported interior/city here made startup GPU-bound.
      if (actorRenderables.has(object)) {
        culling.set(object, object.frustumCulled); object.frustumCulled = false;
      }
      if (object instanceof THREE.SkinnedMesh && object.boundingSphere === null) {
        const box = new THREE.Box3();
        const count = object.geometry.getAttribute('position').count;
        for (let i = 0; i < count; i++) {
          box.expandByPoint(object.getVertexPosition(i, vertex));
          if (i % 128 === 0) await work.checkpoint();
        }
        object.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
      }
      await work.checkpoint();
    }
    timing('actorBounds');
    options.onProgress?.(.55, 'Compilation des shaders');
    await yieldFrame();
    if (cancelled()) return;
    await compileSceneProgressively(renderer, scene, camera, { cancelled,
      onProgress: value => options.onProgress?.(.55 + value * .1, 'Compilation des shaders'),
      ...(options.yieldFrame ? { pause: options.yieldFrame } : {}),
      onProgramCount: count => options.onTiming?.('programsCompiled(count)', count) });
    timing('shaders');
    for (let frame = 0; frame < 2 && !cancelled(); frame++) {
      options.render(); options.onProgress?.(.65 + frame * .1, 'Préparation des premières images'); await yieldFrame();
    }
    // Draw a bounded set of real views at loading resolution. This primes
    // renderer state for newly revealed landings/interior without moving actors.
    for (const view of options.viewpoints ?? []) {
      if (cancelled()) return;
      camera.position.copy(view.position); camera.lookAt(view.target); camera.updateMatrixWorld(true);
      options.render(); await yieldFrame();
    }
  } finally {
    camera.position.copy(originalPosition); camera.quaternion.copy(originalQuaternion); camera.updateMatrixWorld(true);
    for (const [root, visible] of visibility) root.visible = visible;
    for (const [object, culled] of culling) object.frustumCulled = culled;
    // A temporarily visible avatar must never remain in a cached exterior shadow.
    scene.traverse(object => {
      const light = object as THREE.Light & { shadow?: THREE.LightShadow };
      if (light.shadow) light.shadow.needsUpdate = true;
    });
  }
  if (cancelled()) return;
  options.render();
  timing('firstFrames');
  options.onProgress?.(.85, 'Finalisation de l’affichage');
  const context = renderer.getContext();
  if ('fenceSync' in context) await waitForSceneGpu(context, cancelled, options.yieldFrame);
  timing('gpuFence');
  options.onProgress?.(1);
}
