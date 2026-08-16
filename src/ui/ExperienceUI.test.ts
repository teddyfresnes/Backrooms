import { describe, expect, it } from 'vitest';

const loadNodeFs = async () => {
  // Test-only builtin; the browser tsconfig intentionally omits Node globals.
  // @ts-expect-error Node typings are not a production dependency.
  return import('node:fs/promises');
};

describe('console presentation and command entry', () => {
  it('uses one real input and keeps transparent diagnostics behind chat', async () => {
    const { readFile } = await loadNodeFs();
    const [ui, styles] = await Promise.all([
      readFile(new URL('./ExperienceUI.ts', import.meta.url), 'utf8'),
      readFile(new URL('../styles.css', import.meta.url), 'utf8'),
    ]);

    expect(ui).not.toContain('data-ui="console-mode"');
    expect(ui).toContain("this.consoleInput.value = mode === 'command' ? '/' : '';");
    expect(styles).toMatch(/\.command-console \{[\s\S]*?z-index: 18;/);
    expect(styles).toMatch(/\.diagnostics-panel \{[\s\S]*?z-index: 4;[\s\S]*?background: transparent;/);
  });

  it('offers and executes commands only when slash is the first character', async () => {
    const { readFile } = await loadNodeFs();
    const [ui, backrooms, stairwell] = await Promise.all([
      readFile(new URL('./ExperienceUI.ts', import.meta.url), 'utf8'),
      readFile(new URL('../core/Game.ts', import.meta.url), 'utf8'),
      readFile(new URL('../core/RussianStairwellGame.ts', import.meta.url), 'utf8'),
    ]);

    expect(ui).toContain("this.completionSource.startsWith('/')");
    expect(backrooms.match(/value\.startsWith\('\/'\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(stairwell.match(/value\.startsWith\('\/'\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(backrooms).not.toContain("value.trimStart().startsWith('/')");
    expect(stairwell).not.toContain("value.trimStart().startsWith('/')");
  });
});
