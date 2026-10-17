import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { compactSceneDataMaps, restoreSceneDataMaps, waitForSceneGpu, warmSceneForPlay } from './SceneWarmup';

afterEach(() => vi.unstubAllGlobals());
const gpu = () => ({ SYNC_GPU_COMMANDS_COMPLETE: 1, TIMEOUT_EXPIRED: 2,
  fenceSync: vi.fn(() => ({})), flush: vi.fn(), clientWaitSync: vi.fn((_sync?: unknown, _flags?: number, _timeout?: number) => 3),
  isContextLost: () => false, deleteSync: vi.fn() });

describe('preparation before gameplay', () => {
  it('uploads hidden resources, prepares all actor bounds and restores visibility/culling before presentation', async () => {
    const scene = new THREE.Scene(), hidden = new THREE.Group(); hidden.visible = false;
    const texture = new THREE.Texture();
    const bone = new THREE.Bone(), geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 0, 1, 0, 0], 3));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(12).fill(0), 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial({ map: texture }));
    mesh.add(bone); mesh.bind(new THREE.Skeleton([bone])); hidden.add(mesh); scene.add(hidden);
    const shadow = new THREE.DirectionalLight(); shadow.shadow.autoUpdate = false; shadow.shadow.needsUpdate = false; scene.add(shadow);
    const gl = gpu(), frames: Array<[boolean, boolean]> = [];
    const renderer = { initTexture: vi.fn(), compileAsync: vi.fn(async () => {}), getContext: () => gl };
    await warmSceneForPlay({ scene, camera: new THREE.PerspectiveCamera(), renderer: renderer as unknown as THREE.WebGLRenderer,
      roots: [hidden], cancelled: () => false, yieldFrame: async () => {}, render: () => { frames.push([hidden.visible, mesh.frustumCulled]); } });
    expect(renderer.initTexture).toHaveBeenCalledWith(texture);
    expect(mesh.skeleton.boneTexture).not.toBeNull(); expect(mesh.boundingSphere).not.toBeNull();
    expect(frames).toEqual([[true, false], [true, false], [false, true]]);
    expect(hidden.visible).toBe(false); expect(mesh.frustumCulled).toBe(true);
    expect(shadow.shadow.needsUpdate).toBe(true); expect(gl.deleteSync).toHaveBeenCalledOnce();
    mesh.skeleton.dispose(); geometry.dispose(); (mesh.material as THREE.Material).dispose(); texture.dispose();
  });

  it('restores the scene if compilation fails or loading is cancelled', async () => {
    const scene = new THREE.Scene(), root = new THREE.Group(); root.visible = false;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); root.add(mesh); scene.add(root);
    const renderer = { initTexture() {}, compileAsync: vi.fn(async () => { throw new Error('context'); }) };
    await expect(warmSceneForPlay({ scene, camera: new THREE.PerspectiveCamera(), renderer: renderer as unknown as THREE.WebGLRenderer,
      roots: [root], cancelled: () => false, render() {}, yieldFrame: async () => {} })).rejects.toThrow('context');
    expect(root.visible).toBe(false); expect(mesh.frustumCulled).toBe(true);
    renderer.compileAsync.mockClear();
    await warmSceneForPlay({ scene, camera: new THREE.PerspectiveCamera(), renderer: renderer as unknown as THREE.WebGLRenderer,
      roots: [root], cancelled: () => true, render() {} });
    expect(renderer.compileAsync).not.toHaveBeenCalled(); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
  });

  it('waits asynchronously for the GPU fence, with no blocking finish/readback', async () => {
    const gl = gpu(); gl.clientWaitSync.mockReturnValueOnce(2).mockReturnValueOnce(2).mockReturnValueOnce(3);
    const yieldFrame = vi.fn(async () => {});
    await waitForSceneGpu(gl as unknown as WebGL2RenderingContext, () => false, yieldFrame);
    expect(yieldFrame).toHaveBeenCalledTimes(2);
    expect(gl.clientWaitSync.mock.calls.every(args => args[1] === 0 && args[2] === 0)).toBe(true);
    expect(gl.deleteSync).toHaveBeenCalledOnce();
  });

  it('shrinks only secondary maps and does not mutate the wardrobe shared Source or colour detail', () => {
    const drawImage = vi.fn();
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage }) }) });
    const original = new THREE.Texture({ width: 1024, height: 1024 } as unknown as HTMLImageElement);
    const normal = original.clone(), roughness = original.clone();
    const colour = new THREE.Texture({ width: 2048, height: 2048 } as unknown as HTMLImageElement);
    const sharedSource = original.source;
    const scene = new THREE.Group(), material = new THREE.MeshStandardMaterial({ map: colour, bumpMap: colour, normalMap: normal, roughnessMap: roughness });
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
    expect(compactSceneDataMaps(scene)).toBe(1024 ** 2 - 512 ** 2);
    expect(normal.image.width).toBe(512); expect(roughness.source).toBe(normal.source);
    expect(original.source).toBe(sharedSource); expect(original.image.width).toBe(1024);
    expect(colour.image.width).toBe(2048); expect(drawImage).toHaveBeenCalledOnce();
    restoreSceneDataMaps(scene);
    expect(normal.source).toBe(sharedSource); expect(roughness.source).toBe(sharedSource);
    expect(normal.image.width).toBe(1024); expect(compactSceneDataMaps(scene)).toBe(1024 ** 2 - 512 ** 2);
    scene.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    for (const texture of [original, normal, roughness, colour]) texture.dispose(); material.dispose();
  });
});
