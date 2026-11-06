import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { readMotionAssets, type MotionAssetData } from './MotionAssetData';

interface Hierarchy {
  name: string;
  bone: boolean;
  p: [number, number, number];
  q: [number, number, number, number];
  s: [number, number, number];
  children: Hierarchy[];
}
type ClipJson = Parameters<typeof THREE.AnimationClip.parse>[0];
export interface EmoteAsset { sourceHipRestY: number; clip: ClipJson }
let pending: Promise<Record<string, MotionAssetData>> | undefined;

async function motionAssets(): Promise<Record<string, MotionAssetData>> {
  if (!pending) {
    pending = typeof Worker === 'undefined' ? readMotionAssets() : new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./motion-assets.worker.ts', import.meta.url), { type: 'module' });
      const timeout = setTimeout(() => { worker.terminate(); reject(new Error('Préparation des animations interrompue.')); }, 120000);
      const close = () => { clearTimeout(timeout); worker.terminate(); };
      worker.onmessage = event => {
        close();
        if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.assets);
      };
      worker.onerror = error => { close(); reject(new Error(error.message)); };
    });
    void pending.catch(() => { pending = undefined; });
  }
  return pending;
}

function buildHierarchy(source: Hierarchy): THREE.Group | THREE.Bone {
  const object = source.bone ? new THREE.Bone() : new THREE.Group();
  object.name = source.name;
  object.position.fromArray(source.p);
  object.quaternion.fromArray(source.q);
  object.scale.fromArray(source.s);
  for (const child of source.children) object.add(buildHierarchy(child));
  return object;
}

/** The visible character remains the original FBX; only unused animation meshes are omitted. */
export class CharacterAssetLoader {
  private readonly fbx = new FBXLoader();

  async loadAsync(url: string): Promise<THREE.Group> {
    if (url === '/assets/character/character.fbx') {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Personnage indisponible : ${url}`);
      const bytes = await response.arrayBuffer();
      // The authored mesh has a few 5+ influence vertices; Three keeps the four
      // strongest (the intended runtime result) and warned on every load.
      const warn = console.warn;
      console.warn = (...args: unknown[]) => {
        if (typeof args[0] === 'string' && args[0].includes('more than 4 skinning weights')) return;
        warn(...args);
      };
      try { return this.fbx.parse(bytes, url.slice(0, url.lastIndexOf('/') + 1)); }
      finally { console.warn = warn; }
    }
    const asset = (await motionAssets())[url];
    if (!asset?.hierarchy || !asset.clips) throw new Error(`Animation indisponible : ${url}`);
    const object = buildHierarchy(asset.hierarchy) as THREE.Group;
    object.animations = asset.clips.map(clip => THREE.AnimationClip.parse({
      ...clip,
      tracks: clip.tracks.map(track => ({
        ...track, times: track.times, values: track.values,
      })),
    } as unknown as ClipJson));
    return object;
  }
}

export async function loadCharacterEmote(url: string): Promise<EmoteAsset> {
  const data = (await motionAssets())[url]?.json;
  if (!data) throw new Error(`Emote indisponible : ${url}`);
  return structuredClone(data) as EmoteAsset;
}
