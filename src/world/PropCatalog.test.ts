import { describe, expect, it } from 'vitest';
import { PROP_ASSETS } from './PropCatalog';

const loadNodeFs = async () => {
  // Test-only builtin; the browser tsconfig intentionally omits Node globals.
  // @ts-expect-error Node typings are not a production dependency.
  return import('node:fs/promises');
};

describe('curated prop catalog', () => {
  it('uses only the downloaded Kenney and Poly Haven model roots', () => {
    expect(PROP_ASSETS.length).toBeGreaterThan(45);
    expect(new Set(PROP_ASSETS.map((definition) => definition.id)).size)
      .toBe(PROP_ASSETS.length);
    expect(PROP_ASSETS.every((definition) =>
      definition.path.startsWith('/assets/textures/kenney/') ||
      definition.path.startsWith('/assets/textures/polyhaven/')
    )).toBe(true);
    expect(PROP_ASSETS.some((definition) => definition.id.startsWith('polyhaven:'))).toBe(true);
    expect(PROP_ASSETS.some((definition) => definition.id.startsWith('kenney-'))).toBe(true);
  });

  it('points every entry at a real local model file', async () => {
    const { access } = await loadNodeFs();
    await expect(Promise.all(PROP_ASSETS.map((definition) =>
      access(new URL(`../../public${definition.path}`, import.meta.url))
    ))).resolves.toHaveLength(PROP_ASSETS.length);
  });

  it('keeps every external Poly Haven buffer and texture beside its glTF', async () => {
    const { access, readFile, stat } = await loadNodeFs();
    for (const definition of PROP_ASSETS) {
      const modelUrl = new URL(`../../public${definition.path}`, import.meta.url);
      expect((await stat(modelUrl)).size).toBeGreaterThan(128);
      if (!definition.path.endsWith('.gltf')) continue;
      const document = JSON.parse(await readFile(modelUrl, 'utf8')) as {
        buffers?: Array<{ uri?: string }>;
        images?: Array<{ uri?: string }>;
      };
      const uris = [
        ...(document.buffers ?? []).map((buffer) => buffer.uri),
        ...(document.images ?? []).map((image) => image.uri),
      ].filter((uri): uri is string => Boolean(uri) && !uri!.startsWith('data:'));
      await expect(Promise.all(uris.map((uri) => access(new URL(uri, modelUrl)))))
        .resolves.toHaveLength(uris.length);
    }
  });

  it('keeps normalized envelopes and collision fractions physically plausible', () => {
    for (const definition of PROP_ASSETS) {
      for (const extent of Object.values(definition.size)) {
        expect(extent).toBeGreaterThan(0.04);
        expect(extent).toBeLessThanOrEqual(2.2);
      }
      for (const fraction of Object.values(definition.colliderScale)) {
        expect(fraction).toBeGreaterThanOrEqual(0.6);
        expect(fraction).toBeLessThanOrEqual(0.95);
      }
    }
  });

  it('does not retain the discarded low-poly showroom categories', () => {
    const ids = PROP_ASSETS.map((definition) => definition.id).join('\n');
    expect(ids).not.toMatch(/bike:|bed|bathtub|toilet|washer|fridge|stove/);
    expect(ids).not.toMatch(/^furniture:|^retro:/m);
  });
});
