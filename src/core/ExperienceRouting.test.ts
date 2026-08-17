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
    expect(stairwell).toContain("this.renderer.setAnimationLoop(this.frame);\n    this.saveNow('autosave');\n    this.enter();");
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
    expect(main).toContain("await startBackrooms({ kind: 'new' }, false, true)");
    expect(main).toContain('onRequestContinue: menuBackground');
    expect(main).toContain('continueFromMainMenu()');
    expect(main).toContain('autoEnterOnReady: !menuBackground');
    expect(main.match(/createBoot\('random story'\)/g)).toHaveLength(2);
    expect(main).toContain('showBootError(error, () => void startStairwell(launch))');
    expect(main).toContain('showBootError(error, () => void startBackrooms(launch, autosaveOnReady, menuBackground))');
  });

  it('keeps the Backrooms identity and separates continue from save browsing', async () => {
    const { readFile } = await loadNodeFs();
    const [main, ui, styles] = await Promise.all([
      readFile(new URL('../main.ts', import.meta.url), 'utf8'),
      readFile(new URL('../ui/ExperienceUI.ts', import.meta.url), 'utf8'),
      readFile(new URL('../styles.css', import.meta.url), 'utf8'),
    ]);

    expect(main).toContain('/favicon.svg');
    expect(ui).toContain('class="home-logo main-menu-only" src="/favicon.svg"');
    expect(ui).not.toContain('/assets/ui/');
    expect(ui).toContain('data-ui="enter" data-ui-main-continue');
    expect(ui).toContain('class="continue-more"');
    expect(ui).toContain('<h2 id="home-title">Backrooms</h2>');
    expect(ui).not.toContain('Backrooms<span>.</span>');
    expect(ui).toContain('class="home-wordmark"');
    expect(ui).not.toContain('class="home-brand"');
    expect(ui).toContain('<p>Random story</p>');
    expect(styles).not.toContain('border-left: 2px solid rgba(251, 247, 229, 0.68)');
    expect(styles).toMatch(/\.experience-ui \.home-logo \{[\s\S]*?position: fixed;[\s\S]*?top:[\s\S]*?left:/);
    expect(ui).toContain('data-ui="main-menu"');
    expect(ui).toContain('data-ui="confirmation"');
    expect(ui).toContain('this.showConfirmation(');
    expect(ui).not.toContain('<span>Charger</span>');
    expect(ui).not.toContain('this.continueButton.focus');
    expect(ui).not.toContain('target?.focus({ preventScroll: true })');
    expect(styles).toMatch(/\.experience-ui \.confirmation-layer \{[\s\S]*?pointer-events: auto;/);
    expect(main.match(/onRequestMainMenu:/g)).toHaveLength(2);
    expect(ui).toContain('experienceLabelById[summary.experienceId]');
    expect(ui).toContain('Session précédente');
    expect(ui).not.toContain('Jouer la session actuelle');
  });

  it('keeps the active session current through startup, periodic and lifecycle autosaves', async () => {
    const { readFile } = await loadNodeFs();
    const [main, stairwell, backrooms] = await Promise.all([
      readFile(new URL('../main.ts', import.meta.url), 'utf8'),
      readFile(new URL('./RussianStairwellGame.ts', import.meta.url), 'utf8'),
      readFile(new URL('./Game.ts', import.meta.url), 'utf8'),
    ]);

    expect(main).toContain('autosaveOnReady');
    expect(main).toContain("startBackrooms({ kind: 'load', save }, true)");
    expect(backrooms).toContain('if (this.options.autoEnterOnReady) this.enter();');
    expect(backrooms).toContain("this.saveNow('autosave')");
    expect(backrooms).toContain('nextStory !== this.activeStory');
    expect(backrooms).toContain('await this.worldStream.prepareSavedChunk(chunk)');
    expect(backrooms).toContain('this.pendingAutosaveStory = nextStory');
    expect(backrooms).toContain('safeCoord.story !== pendingStory');
    expect(stairwell).toContain('AUTOSAVE_INTERVAL_SECONDS = 30');
    expect(backrooms).toContain('AUTOSAVE_INTERVAL_SECONDS = 30');
    expect(stairwell).toContain("window.addEventListener('pagehide', this.onPageHide)");
    expect(backrooms).toContain("window.addEventListener('pagehide', this.onPageHide)");
    expect(stairwell).toContain("if (document.hidden) this.saveNow('autosave')");
    expect(backrooms).toContain("if (document.hidden && !this.options.onRequestContinue) this.saveNow('autosave')");
    expect(stairwell).toContain('this.ui.beginGameplay();');
    expect(backrooms).toContain('this.ui.beginGameplay();');
  });

  it('uses the Backrooms lighting pipeline and live lighting setting in the stairwell', async () => {
    const { readFile } = await loadNodeFs();
    const [stairwell, backrooms, atmosphere, environment] = await Promise.all([
      readFile(new URL('./RussianStairwellGame.ts', import.meta.url), 'utf8'),
      readFile(new URL('./Game.ts', import.meta.url), 'utf8'),
      readFile(new URL('../render/BackroomsAtmosphere.ts', import.meta.url), 'utf8'),
      readFile(new URL('../stairwell/StairwellEnvironment.ts', import.meta.url), 'utf8'),
    ]);

    expect(backrooms).toContain('BACKROOMS_ATMOSPHERE as ATMOSPHERE');
    expect(stairwell).toContain('new PostFX(');
    expect(stairwell).toContain('{ bloom: false }');
    expect(stairwell).toContain('this.postFX?.setLightingMode(settings.lighting)');
    expect(stairwell).toContain('this.postFX?.render(delta)');
    expect(stairwell).toContain('this.postFX?.dispose()');
    expect(stairwell).toContain('BACKROOMS_LEGACY_ATMOSPHERE');
    expect(stairwell).toContain('ApartmentLightSwitchInteraction');
    expect(stairwell).toContain('ApartmentWindowBlindsInteraction');
    expect(stairwell).toContain('apartmentLightOn: this.apartment.areInteriorLightsEnabled');
    expect(stairwell).toContain('windowBlindsOpen: this.windowBlinds?.getState()');
    expect(atmosphere).toContain('hemisphereSky: 0xfffbef');
    expect(environment).not.toContain('stairwell-night-ambient');
    expect(environment).not.toContain('stairwell-night-fill');
    expect(environment).not.toContain('south-facade-moonlight');
  });
});
