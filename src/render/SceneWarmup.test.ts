import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { compileSceneProgressively, compactSceneDataMaps, restoreSceneDataMaps, waitForSceneGpu, warmSceneForPlay, uploadSceneGeometry } from './SceneWarmup';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const gpu = () => ({ SYNC_GPU_COMMANDS_COMPLETE: 1, TIMEOUT_EXPIRED: 2,
  fenceSync: vi.fn(() => ({})), flush: vi.fn(), clientWaitSync: vi.fn((_sync?: unknown, _flags?: number, _timeout?: number) => 3),
  isContextLost: () => false, deleteSync: vi.fn() });

describe('preparation before gameplay', () => {
  it('warms real viewpoints with hidden static interiors and restores the camera after a failed draw', async () => {
    const scene = new THREE.Scene(), interior = new THREE.Group(); interior.visible = false; scene.add(interior);
    const camera = new THREE.PerspectiveCamera(); camera.position.set(1, 2, 3); camera.lookAt(0, 0, 0);
    const before = camera.quaternion.clone(), renderer = { initTexture() {}, compileAsync: async () => {} };
    await expect(warmSceneForPlay({ scene, camera, renderer: renderer as unknown as THREE.WebGLRenderer,
      staticRoots: [interior], viewpoints: [{ position: new THREE.Vector3(8, 9, 10), target: new THREE.Vector3() }],
      cancelled: () => false, yieldFrame: async () => {}, render() {
        expect(interior.visible).toBe(true); expect(interior.frustumCulled).toBe(true);
        if (camera.position.x === 8) throw new Error('draw failed');
      } })).rejects.toThrow('draw failed');
    expect(interior.visible).toBe(false); expect(camera.position.toArray()).toEqual([1, 2, 3]);
    expect(camera.quaternion.equals(before)).toBe(true);
  });
  it('batches texture uploads and keeps offscreen static geometry culled while warming actors', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const scene = new THREE.Scene(), actor = new THREE.Group(); actor.visible = false;
    const geometry = new THREE.BoxGeometry();
    const textures = Array.from({ length: 64 }, () => new THREE.Texture());
    const materials = textures.map(map => new THREE.MeshBasicMaterial({ map }));
    for (const material of materials) scene.add(new THREE.Mesh(geometry, material));
    const actorMesh = new THREE.Mesh(geometry, materials[0]); actor.add(actorMesh); scene.add(actor);
    const renderer = { render: vi.fn(), initTexture: vi.fn(), compileAsync: vi.fn(async () => {}), getContext: () => gpu() };
    const pause = vi.fn(async () => {}), phases: string[] = [];
    await warmSceneForPlay({ scene, camera: new THREE.PerspectiveCamera(), renderer: renderer as unknown as THREE.WebGLRenderer,
      roots: [actor], cancelled: () => false, yieldFrame: pause,
      onProgress: (_value, phase) => { if (phase) phases.push(phase); },
      render: () => {
        expect(scene.children.slice(0, 64).every(object => object.frustumCulled)).toBe(true);
        expect(actorMesh.frustumCulled).toBe(!actor.visible);
      } });
    expect(renderer.initTexture).toHaveBeenCalledTimes(64);
    // Eight upload batches, one compilation handoff and two render handoffs.
    expect(pause).toHaveBeenCalledTimes(12);
    expect(phases).toContain('Compilation des shaders');
    expect(actor.visible).toBe(false); expect(actorMesh.frustumCulled).toBe(true);
    geometry.dispose(); materials.forEach(material => material.dispose()); textures.forEach(texture => texture.dispose());
  });

  it('prepares resources without requiring animation frames from a foreground tab', async () => {
    const animationFrame = vi.fn(() => { throw new Error('background tab'); });
    vi.stubGlobal('requestAnimationFrame', animationFrame);
    const scene = new THREE.Scene();
    const gl = gpu(); gl.clientWaitSync.mockReturnValueOnce(2).mockReturnValueOnce(3);
    const renderer = { render() {}, initTexture() {}, compileAsync: async () => {}, getContext: () => gl };
    await warmSceneForPlay({ scene, camera: new THREE.PerspectiveCamera(), renderer: renderer as unknown as THREE.WebGLRenderer,
      cancelled: () => false, render() {} });
    expect(animationFrame).not.toHaveBeenCalled(); expect(gl.deleteSync).toHaveBeenCalledOnce();
  });

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
    const renderer = { render: vi.fn(), initTexture: vi.fn(), compileAsync: vi.fn(async () => {}), getContext: () => gl };
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
    const renderer = { render() {}, initTexture() {}, compileAsync: vi.fn(async () => { throw new Error('context'); }) };
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

  it('submits hidden geometry in bounded zero-draw batches and shares exact buffers with future instances', async () => {
    const scene=new THREE.Scene(), root=new THREE.Group();root.visible=false;scene.add(root);
    const geometry=new THREE.BoxGeometry(), material=new THREE.MeshStandardMaterial();geometry.setDrawRange(3,12);
    for(let i=0;i<10;i++)root.add(new THREE.Mesh(geometry.clone(),material));
    const instance=new THREE.InstancedMesh(geometry,material,3);root.add(instance);
    const submitted:THREE.Object3D[][]=[];const renderer={sortObjects:true,render:(batch:THREE.Scene)=>{
      expect(renderer.sortObjects).toBe(false);submitted.push([...batch.children]);
      for(const proxy of batch.children){expect((proxy as THREE.Mesh).geometry.drawRange).toEqual({start:0,count:0});expect(proxy.frustumCulled).toBe(false);}
    }};
    const pause=vi.fn(async()=>{});
    await uploadSceneGeometry({scene,camera:new THREE.PerspectiveCamera(),renderer:renderer as unknown as THREE.WebGLRenderer,cancelled:()=>false,render(){},yieldFrame:pause},()=>{});
    expect(submitted.map(batch=>batch.length)).toEqual([8,3]);expect(pause).toHaveBeenCalledTimes(2);
    expect((submitted.flat().find(o=>(o as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh).instanceMatrix).toBe(instance.instanceMatrix);
    expect(renderer.sortObjects).toBe(true);expect(root.visible).toBe(false);expect(geometry.drawRange).toEqual({start:3,count:12});
    root.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose();});material.dispose();
  });

  it('restores draw ranges and sorting after a failed buffer submission',async()=>{
    const scene=new THREE.Scene(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshBasicMaterial();scene.add(new THREE.Mesh(geometry,material));
    const renderer={sortObjects:true,render:()=>{throw Error('context lost');}};
    await expect(uploadSceneGeometry({scene,camera:new THREE.PerspectiveCamera(),renderer:renderer as unknown as THREE.WebGLRenderer,cancelled:()=>false,render(){}},()=>{})).rejects.toThrow('context lost');
    expect(geometry.drawRange).toEqual({start:0,count:Infinity});expect(renderer.sortObjects).toBe(true);geometry.dispose();material.dispose();
  });

  it('expires a stalled GPU by elapsed time and releases its fence', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(15001);
    const gl = gpu(); gl.clientWaitSync.mockReturnValue(2);
    await expect(waitForSceneGpu(gl as unknown as WebGL2RenderingContext, () => false)).rejects.toThrow('expiré');
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
  it('submits every program before waiting for any link, with yields, when the browser cannot compile in parallel', async () => {
    const scene = new THREE.Scene(), shared = new THREE.MeshStandardMaterial(), other = new THREE.MeshBasicMaterial();
    const geometry = new THREE.BoxGeometry();
    scene.add(new THREE.Mesh(geometry, shared), new THREE.Mesh(geometry, shared), new THREE.Mesh(geometry, other));
    const linked: THREE.Material[] = [], programs = new Map<THREE.Material, { currentProgram: { getUniforms(): void } }>();
    const renderer = {
      extensions: { has: () => false }, compileAsync: vi.fn(async () => {}),
      bound: null as THREE.WebGLRenderTarget | null,
      getRenderTarget() { return this.bound; }, setRenderTarget(target: THREE.WebGLRenderTarget | null) { this.bound = target; },
      compile: vi.fn((object: THREE.Object3D, _camera: THREE.Camera, target: THREE.Object3D) => {
        expect(target).toBe(scene);
        // Same program variant as the composer's off-screen scene pass.
        expect(renderer.bound).toBeInstanceOf(THREE.WebGLRenderTarget);
        const material = (object as THREE.Mesh).material as THREE.Material;
        expect(linked).toHaveLength(0); // no link is awaited between submissions
        programs.set(material, { currentProgram: { getUniforms: () => { linked.push(material); } } });
        return new Set([material]);
      }),
      properties: { get: (material: THREE.Material) => programs.get(material)! },
    };
    let now = 0; vi.spyOn(performance, 'now').mockImplementation(() => (now += 20));
    const pause = vi.fn(async () => {}), progress: number[] = [];
    await compileSceneProgressively(renderer as never, scene, new THREE.PerspectiveCamera(), { onProgress: value => progress.push(value), pause });
    expect(renderer.bound).toBeNull();
    expect(renderer.compileAsync).not.toHaveBeenCalled();
    expect(linked).toEqual([shared, other]);
    expect(pause).toHaveBeenCalledTimes(4); expect(progress.at(-1)).toBe(1);
    renderer.extensions.has = (() => true) as never;
    await compileSceneProgressively(renderer as never, scene, new THREE.PerspectiveCamera());
    expect(renderer.compileAsync).toHaveBeenCalledOnce();
    geometry.dispose(); shared.dispose(); other.dispose();
  });
});
