import * as THREE from 'three';

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
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
  gl: WebGL2RenderingContext, cancelled: () => boolean, yieldFrame = nextFrame,
): Promise<void> {
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!fence) return;
  try {
    gl.flush();
    for (let frame = 0; frame < 300 && !cancelled(); frame++) {
      const status = gl.clientWaitSync(fence, 0, 0);
      if (status !== gl.TIMEOUT_EXPIRED || gl.isContextLost()) return;
      await yieldFrame();
    }
  } finally { gl.deleteSync(fence); }
}

export interface SceneWarmupOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  render(): void;
  roots?: readonly THREE.Object3D[];
  cancelled(): boolean;
  onProgress?(value: number): void;
  yieldFrame?(): Promise<void>;
}

/** Resource preparation belongs behind the loading screen, without advancing gameplay. */
export async function warmSceneForPlay(options: SceneWarmupOptions): Promise<void> {
  const { renderer, scene, camera, cancelled } = options;
  if (cancelled()) return;
  const yieldFrame = options.yieldFrame ?? nextFrame;
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
  for (let i = 0; i < textureList.length; i++) {
    if (cancelled()) return;
    renderer.initTexture(textureList[i]!);
    if (i % 3 === 2) { options.onProgress?.((i + 1) / Math.max(1, textureList.length) * .55); await yieldFrame(); }
  }
  const visibility = new Map((options.roots ?? []).map(root => [root, root.visible]));
  const culling = new Map<THREE.Object3D, boolean>();
  try {
    for (const root of visibility.keys()) root.visible = true;
    scene.traverse(object => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) return;
      culling.set(object, object.frustumCulled); object.frustumCulled = false;
      if (object instanceof THREE.SkinnedMesh && object.boundingSphere === null) object.computeBoundingSphere();
    });
    await renderer.compileAsync(scene, camera);
    for (let frame = 0; frame < 2 && !cancelled(); frame++) {
      options.render(); options.onProgress?.(.65 + frame * .1); await yieldFrame();
    }
  } finally {
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
  const context = renderer.getContext();
  if ('fenceSync' in context) await waitForSceneGpu(context, cancelled, yieldFrame);
  options.onProgress?.(1);
}
