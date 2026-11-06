import { readMotionAssets } from './MotionAssetData';

void readMotionAssets().then(assets => {
  const buffers: ArrayBuffer[] = [];
  for (const asset of Object.values(assets)) for (const clip of asset.clips ?? []) for (const track of clip.tracks) {
    for (const data of [track.times, track.values]) if (typeof data !== 'string') buffers.push(data.buffer as ArrayBuffer);
  }
  self.postMessage({ assets }, { transfer: buffers });
}).catch(error => self.postMessage({ error: String(error) }));
