import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// Exact environment textures used by github.com/teddyfresnes/Backrooms.
// They are mirrored locally before dev/build so the lab uses the same source
// material set without cross-origin texture requests during play.
const REPO_RAW = 'https://raw.githubusercontent.com/teddyfresnes/Backrooms/main';
const paths = [
  'public/assets/textures/wallpaper/backrooms-wallpaper-seamless.webp',
  'public/assets/textures/plaster/plaster-color.webp',
  'public/assets/textures/plaster/plaster-normal-gl.webp',
  'public/assets/textures/plaster/plaster-arm.webp',
  'public/assets/textures/carpet/carpet-color-v2.webp',
  'public/assets/textures/carpet/carpet-normal-gl.webp',
  'public/assets/textures/carpet/carpet-arm.webp',
  'public/assets/textures/ceiling/ceiling-color.webp',
  'public/assets/textures/ceiling/ceiling-normal-gl.webp',
  'public/assets/textures/ceiling/ceiling-arm.webp',
];

const hasFile = async (path) => {
  try { return (await stat(path)).size > 1024; } catch { return false; }
};

const mirror = async (relativePath) => {
  const output = resolve(relativePath);
  if (await hasFile(output)) return;
  await mkdir(dirname(output), { recursive: true });
  try {
    const response = await fetch(`${REPO_RAW}/${relativePath}`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength < 1024) throw new Error('asset too small');
    await writeFile(output, bytes);
    console.log(`[backrooms-assets] saved ${relativePath}`);
  } catch (error) {
    console.warn(`[backrooms-assets] unavailable ${relativePath}; runtime keeps lab fallback (${error instanceof Error ? error.message : String(error)}).`);
  }
};

// Keep offline startup bounded: all independent texture requests share the same
// timeout window instead of potentially waiting 8 s ten times in sequence.
await Promise.all(paths.map(mirror));
