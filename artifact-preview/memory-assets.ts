import * as THREE from 'three';

let assets: Record<string, any> = {};
export const setMemoryAssets = (value: Record<string, any>) => {
  assets = value;
  THREE.FileLoader.prototype.load = function(url, onLoad, _onProgress, onError) {
    const source = assets[String(url)];
    if (source?.json) {
      const json = structuredClone(source.json);
      for (const track of json.tracks ?? []) {
        track.times = Array.from(typed(track.times));
        track.values = Array.from(typed(track.values));
      }
      queueMicrotask(() => onLoad?.(json));
    } else queueMicrotask(() => onError?.(new Error(`Asset indisponible : ${String(url)}`)));
    return undefined;
  };
};
const typed = (value: {type: string; binary: string}) => {
  const bytes = Uint8Array.from(atob(value.binary), character => character.charCodeAt(0));
  return new (globalThis as any)[value.type](bytes.buffer);
};
const hydrateClips = (clips: any[]) => clips.map(source => {
  const json = structuredClone(source);
  for (const track of json.tracks) {
    track.times = Array.from(typed(track.times));
    track.values = Array.from(typed(track.values));
  }
  return THREE.AnimationClip.parse(json);
});
const hierarchy = (source: any): THREE.Object3D => {
  const object = source.bone ? new THREE.Bone() : new THREE.Group();
  object.name = source.name;
  object.position.fromArray(source.p);
  object.quaternion.fromArray(source.q);
  object.scale.fromArray(source.s);
  for (const child of source.children) object.add(hierarchy(child));
  return object;
};
export class FBXLoader {
  async loadAsync(url: string): Promise<THREE.Group> {
    const asset = assets[url];
    if (!asset) throw new Error(`Animation indisponible : ${url.split('/').at(-1)}`);
    if (asset.model) {
      const model = structuredClone(asset.model);
      for (const geometry of model.geometries ?? []) {
        for (const attribute of Object.values(geometry.data?.attributes ?? {}) as any[]) {
          if (attribute.packed) { attribute.array = Array.from(typed(attribute.packed)); delete attribute.packed; }
        }
        const index = geometry.data?.index;
        if (index?.packed) { index.array = Array.from(typed(index.packed)); delete index.packed; }
      }
      return await new THREE.ObjectLoader().parseAsync(model) as THREE.Group;
    }
    const object = hierarchy(asset.hierarchy) as THREE.Group;
    object.animations = hydrateClips(asset.clips);
    return object;
  }
}
