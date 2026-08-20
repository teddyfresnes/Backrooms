import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// All sources below are CC0 OpenGameArt assets. They are fetched before dev /
// build so the game never depends on cross-origin image loading during play.
const assets = [
  {
    output: 'public/assets/blood/blood-overlay.png',
    urls: [
      'https://opengameart.org/sites/default/files/BloodOverlay_0.png',
    ],
  },
  {
    output: 'public/assets/blood/blood-decal-a.png',
    urls: [
      'https://opengameart.org/sites/default/files/blood_0.png',
    ],
  },
  {
    output: 'public/assets/blood/blood-decal-b.png',
    urls: [
      'https://opengameart.org/sites/default/files/blood_splat.png',
    ],
  },
  {
    output: 'public/assets/blood/blood-decal-c.png',
    urls: [
      'https://opengameart.org/sites/default/files/oga-textures/77840/blood_splatter_01_base.png',
    ],
  },
];

const hasFile = async (path) => {
  try { return (await stat(path)).size > 512; } catch { return false; }
};

for (const asset of assets) {
  const output = resolve(asset.output);
  if (await hasFile(output)) continue;
  await mkdir(dirname(output), { recursive: true });
  let saved = false;
  for (const url of asset.urls) {
    try {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(3500) });
      if (!response.ok) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength < 512) continue;
      await writeFile(output, bytes);
      console.log(`[blood-assets] saved ${asset.output}`);
      saved = true;
      break;
    } catch {
      // Offline development is supported: runtime keeps procedural fallbacks.
    }
  }
  if (!saved) console.warn(`[blood-assets] CC0 source unavailable for ${asset.output}; using runtime fallback.`);
}
