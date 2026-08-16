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

  it('uses the Backrooms shell as the only launcher and routes history entries by experience', async () => {
    const { readFile } = await loadNodeFs();
    const main = await readFile(new URL('../main.ts', import.meta.url), 'utf8');

    expect(main).not.toContain('StartMenu');
    expect(main).not.toContain('Russian Stairwells');
    expect(main).toContain('<strong>Backrooms</strong>');
    expect(main).toContain("save.experienceId === 'backrooms'");
    expect(main).toContain("startStairwell({ kind: 'load', save })");
  });

  it('keeps the Backrooms identity and separates continue from save browsing', async () => {
    const { readFile } = await loadNodeFs();
    const [main, ui] = await Promise.all([
      readFile(new URL('../main.ts', import.meta.url), 'utf8'),
      readFile(new URL('../ui/ExperienceUI.ts', import.meta.url), 'utf8'),
    ]);

    expect(main).toContain('/favicon.svg');
    expect(ui).toContain('class="home-logo" src="/favicon.svg"');
    expect(ui).not.toContain('/assets/ui/');
    expect(ui).toContain('data-ui="enter" data-ui-main-continue');
    expect(ui).toContain('class="continue-more"');
    expect(ui).toContain('experienceLabelById[summary.experienceId]');
    expect(ui).toContain('Session précédente');
    expect(ui).not.toContain('Jouer la session actuelle');
  });

  it('autosaves only after a loaded level transition, never on a timer or page lifecycle', async () => {
    const { readFile } = await loadNodeFs();
    const [main, stairwell, backrooms] = await Promise.all([
      readFile(new URL('../main.ts', import.meta.url), 'utf8'),
      readFile(new URL('./RussianStairwellGame.ts', import.meta.url), 'utf8'),
      readFile(new URL('./Game.ts', import.meta.url), 'utf8'),
    ]);

    expect(main).toContain('autosaveOnReady');
    expect(backrooms).toContain("this.saveNow('autosave')");
    expect(backrooms).toContain('nextStory !== this.activeStory');
    expect(backrooms).toContain('await this.worldStream.prepareSavedChunk(chunk)');
    expect(backrooms).toContain('this.pendingAutosaveStory = nextStory');
    expect(backrooms).toContain('safeCoord.story !== pendingStory');
    expect(stairwell).not.toContain('AUTOSAVE_INTERVAL');
    expect(stairwell).not.toContain("addEventListener('pagehide'");
    expect(stairwell).not.toContain('if (document.hidden) this.saveNow');
    expect(stairwell).not.toContain('if (this.initialized) this.saveNow');
  });
});
