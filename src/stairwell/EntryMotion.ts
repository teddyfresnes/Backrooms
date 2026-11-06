import * as THREE from 'three';

interface PackedClip { name: string; duration: number; tracks: { name: string; type: string; times: string; values: string }[] }
export interface EntryMotionSource { clip: THREE.AnimationClip; hipsRest: number[] }
export interface EntryMotions { code: EntryMotionSource; door: EntryMotionSource }

const floats = (value: string): Float32Array => {
  const binary = atob(value), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
};

export async function loadEntryMotions(signal?: AbortSignal): Promise<EntryMotions> {
  const response = await fetch('/assets/cinematics/entry-motion.bin', { signal });
  if (!response.ok || !response.body) throw new Error('Les animations d’entrée sont indisponibles.');
  const data = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json() as {
    version: number; assets: Record<'code' | 'door', { clip: PackedClip; hipsRest: number[] }>;
  };
  signal?.throwIfAborted();
  if (data.version !== 1) throw new Error('Animations d’entrée invalides.');
  const parse = (id: 'code' | 'door'): EntryMotionSource => {
    const source = data.assets[id];
    const tracks = source.clip.tracks.map(track => {
      const Constructor = track.type === 'quaternion' ? THREE.QuaternionKeyframeTrack : track.type === 'vector' ? THREE.VectorKeyframeTrack : undefined;
      if (!Constructor) throw new Error('Piste d’animation non prise en charge.');
      return new Constructor(track.name, floats(track.times), floats(track.values));
    });
    const clip = new THREE.AnimationClip(source.clip.name, source.clip.duration, tracks);
    return { clip, hipsRest: source.hipsRest };
  };
  return { code: parse('code'), door: parse('door') };
}

/** Pose on the selected wardrobe rig; authored ground translation is sampled
 * separately so camera/door timing and the final physics spawn agree. */
export function retargetEntryMotion(source: EntryMotionSource, avatar: THREE.Object3D): {
  clip: THREE.AnimationClip; translation: (time: number, out: THREE.Vector3) => THREE.Vector3;
} {
  const hips = avatar.getObjectByName('mixamorigHips');
  if (!hips) throw new Error('Squelette du personnage incomplet.');
  const sourceTrack = source.clip.tracks.find(track => /hips\.position$/i.test(track.name));
  if (!sourceTrack) throw new Error('Trajectoire d’entrée absente.');
  const interpolant = new THREE.LinearInterpolant(sourceTrack.times, sourceTrack.values, 3);
  const origin = new THREE.Vector3().fromArray(interpolant.evaluate(0));
  const ratio = hips.position.y / source.hipsRest[1]!;
  const unit = avatar.scale.y * ratio;
  const tracks = source.clip.tracks.filter(track => avatar.getObjectByName(track.name.slice(0, track.name.lastIndexOf('.')))).map(track => {
    if (track !== sourceTrack) return track.clone();
    const values = new Float32Array(track.values.length);
    for (let i = 0; i < values.length; i += 3) {
      values[i] = hips.position.x; values[i + 1] = track.values[i + 1]! * ratio; values[i + 2] = hips.position.z;
    }
    return new THREE.VectorKeyframeTrack(track.name, track.times, values);
  });
  return {
    clip: new THREE.AnimationClip(source.clip.name, source.clip.duration, tracks),
    translation(time, out) {
      out.fromArray(interpolant.evaluate(Math.min(source.clip.duration, Math.max(0, time)))).sub(origin).multiplyScalar(unit);
      out.y = 0; return out;
    },
  };
}
