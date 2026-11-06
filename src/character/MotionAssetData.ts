export interface MotionHierarchy {
  name: string; bone: boolean;
  p: [number, number, number]; q: [number, number, number, number]; s: [number, number, number];
  children: MotionHierarchy[];
}
interface MotionTrack {
  name: string; type: string; times: string | Float32Array; values: string | Float32Array;
}
export interface MotionAssetData {
  hierarchy?: MotionHierarchy;
  clips?: Array<{ name: string; duration: number; tracks: MotionTrack[]; blendMode?: number }>;
  json?: { sourceHipRestY: number; clip: unknown };
}

const floats = (encoded: string): Float32Array => {
  const binary = atob(encoded), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
};

/** Decompression, JSON parsing and base64 conversion all execute in the worker. */
export async function readMotionAssets(): Promise<Record<string, MotionAssetData>> {
  const response = await fetch('/assets/character-motion.bin');
  if (!response.ok || !response.body) throw new Error('Téléchargement des animations interrompu.');
  const pack = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json() as {
    version: number; assets: Record<string, MotionAssetData>;
  };
  if (pack.version !== 1 || !pack.assets) throw new Error('Pack d’animations invalide.');
  for (const asset of Object.values(pack.assets)) for (const clip of asset.clips ?? []) for (const track of clip.tracks) {
    if (typeof track.times === 'string') track.times = floats(track.times);
    if (typeof track.values === 'string') track.values = floats(track.values);
  }
  return pack.assets;
}
