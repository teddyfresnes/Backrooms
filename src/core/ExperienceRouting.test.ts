import { describe, expect, it } from 'vitest';

const loadNodeFs = async () => {
  // Test-only builtin; the browser tsconfig intentionally omits Node globals.
  // @ts-expect-error Node typings are not a production dependency.
  return import('node:fs/promises');
};

describe('experience routing', () => {
  it('routes the Russian hall exit to the previous procedural Backrooms runtime', async () => {
    const { readFile } = await loadNodeFs();
    const [main, stairwell] = await Promise.all([
      readFile(new URL('../main.ts', import.meta.url), 'utf8'),
      readFile(new URL('./RussianStairwellGame.ts', import.meta.url), 'utf8'),
    ]);

    expect(stairwell).toContain('HallExitInteraction');
    expect(stairwell).toContain('this.callbacks.onEnterBackrooms()');
    expect(main).toContain("await import('./core/Game')");
    expect(main).toContain('onEnterBackrooms: () => queueMicrotask');
  });
});
