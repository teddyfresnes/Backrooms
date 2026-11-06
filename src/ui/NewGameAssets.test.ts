import { expect, it } from 'vitest';
import { NEW_GAME_SHOTS } from './NewGameIntro';

it('ships six complete WebP frames with the supplied sentence order and recorded hashes', async () => {
  // @ts-expect-error Node builtins are test-only, outside browser typings.
  const { readFile } = await import('node:fs/promises');
  // @ts-expect-error Node builtins are test-only, outside browser typings.
  const { createHash } = await import('node:crypto');
  const manifest = JSON.parse(await readFile(new URL('../../docs/validation/new-game-intro-assets.json', import.meta.url), 'utf8')) as {
    total_bytes: number; shots: { runtime: string; runtime_sha256: string; bytes: number; subtitle: string }[];
  };
  expect(manifest.shots).toHaveLength(6);
  let bytes = 0;
  for (const [i, shot] of manifest.shots.entries()) {
    const image: Uint8Array = await readFile(new URL(`../../${shot.runtime}`, import.meta.url));
    expect(image.byteLength).toBe(shot.bytes); expect(image.byteLength).toBeGreaterThan(50000);
    expect(new TextDecoder().decode(image.subarray(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(image.subarray(8, 16))).toBe('WEBPVP8 ');
    const data = new DataView(image.buffer, image.byteOffset, image.byteLength);
    expect([data.getUint16(26, true) & 0x3fff, data.getUint16(28, true) & 0x3fff]).toEqual([1672, 941]);
    expect(createHash('sha256').update(image).digest('hex')).toBe(shot.runtime_sha256);
    expect(shot.subtitle).toBe(NEW_GAME_SHOTS[i]!.text);
    bytes += image.byteLength;
  }
  expect(bytes).toBe(manifest.total_bytes); expect(bytes).toBeLessThan(500000);
});
