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
    expect(stairwell).toContain("this.renderer.setAnimationLoop(this.frame);\n    this.saveNow('autosave');\n    this.enter(true);");
    expect(main).toContain("await import('./core/Game')");
    expect(main).toContain("import { OpeningIntro } from './ui/OpeningIntro'");
    expect(main).toContain('onEnterBackrooms: () => queueMicrotask');
  });

  it('prebundles shared Three.js helpers before switching dynamic experiences', async () => {
    const { readFile } = await loadNodeFs();
    const [viteConfig, stairwell, wardrobeAnimation, wardrobeManager] = await Promise.all([
      readFile(new URL('../../vite.config.ts', import.meta.url), 'utf8'),
      readFile(new URL('../stairwell/StairwellEnvironment.ts', import.meta.url), 'utf8'),
      readFile(new URL('../wardrobe/studio/character/IdleAnimation.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../wardrobe/studio/character/WardrobeManager.tsx', import.meta.url), 'utf8'),
    ]);

    expect(viteConfig).toContain('optimizeDeps');
    for (const helper of [
      'three/addons/loaders/FBXLoader.js',
      'three/addons/loaders/GLTFLoader.js',
      'three/addons/utils/SkeletonUtils.js',
    ]) expect(viteConfig).toContain(helper);
    expect(stairwell).toContain("from 'three/addons/loaders/GLTFLoader.js'");
    expect(wardrobeAnimation).toContain("from 'three/addons/loaders/FBXLoader.js'");
    expect(wardrobeManager).toContain("from 'three/addons/utils/SkeletonUtils.js'");
  });

  it('plays the opening sequence once while the menu runtime loads behind it', async () => {
    const { readFile } = await loadNodeFs();
    const [main, intro, styles] = await Promise.all([
      readFile(new URL('../main.ts', import.meta.url), 'utf8'),
      readFile(new URL('../ui/OpeningIntro.ts', import.meta.url), 'utf8'),
      readFile(new URL('../styles.css', import.meta.url), 'utf8'),
    ]);

    expect(main).toContain('const openingIntro = new OpeningIntro()');
    expect(main).toContain('Promise.all([startInitialExperience(), openingIntro.minimumDuration])');
    expect(intro).toContain('PHOTOSENSIBILITÉ');
    expect(intro).toContain('UTILISEZ UN CASQUE');
    expect(intro).toContain('Made by');
    expect(intro).toContain('teddyfresnes');
    expect(intro).not.toContain('creatorIcon');
    expect(intro).not.toContain('Une création originale');
    expect(intro).toContain('Backrooms');
    expect(intro).toContain('Random story');
    expect(intro).not.toContain('animateIntoTarget');
    expect(intro).not.toContain('getBoundingClientRect');
    expect(styles).toContain('.opening-intro.is-running .opening-warning');
    expect(styles).toContain('.opening-intro.is-leaving .opening-curtain');
    expect(styles).toContain('@keyframes opening-text-glitch');
    expect(styles).toContain('@keyframes opening-audio-meter');
    expect(styles).toContain('@keyframes opening-brand-static');
    expect(styles).toContain('@keyframes opening-mark-interference');
    expect(styles).toContain('.opening-intro.is-running .opening-warning::after');
    expect(styles).toContain('animation: opening-brand-arrive .52s 4.84s steps(1, end) both;');
    expect(styles).not.toContain('.opening-credit .opening-card-copy > strong { animation:');
    expect(styles).toContain('animation: opening-brand-out .18s ease-out both;');
    expect(styles).not.toContain('15% { opacity: .12; transform: translate3d(13px, 0, 0); }');
    expect(styles).not.toContain('45% { opacity: .7; filter: brightness(2.4) contrast(2); }');
    expect(styles).toMatch(/\.opening-intro \{[\s\S]*?cursor: default;/);
  });

  it('uses the Backrooms shell as the only launcher and routes history entries by experience', async () => {
    const { readFile } = await loadNodeFs();
    const main = await readFile(new URL('../main.ts', import.meta.url), 'utf8');

    expect(main).not.toContain('StartMenu');
    expect(main).not.toContain('Russian Stairwells');
    expect(main).toContain('<p>Backrooms</p><h1>Random Story</h1>');
    expect(main).toContain("save.experienceId === 'backrooms'");
    expect(main).toContain("startStairwell({ kind: 'load', save })");
    expect(main).toContain("await startBackrooms({ kind: 'new' }, false, true)");
    expect(main).toContain('onRequestContinue: menuBackground');
    expect(main).toContain('continueFromMainMenu()');
    expect(main).toContain('autoEnterOnReady: !menuBackground');
    expect(main).toContain("launch.kind === 'load' ? 'Chargement de la sauvegarde'");
    expect(main).toContain("? 'Initialisation du menu'");
    expect(main).toContain("<div class=\"boot-wordmark\"><p>Backrooms</p><h1>Random Story</h1></div>");
    expect(main).not.toContain('boot-loading-heading');
    expect(main).not.toContain('boot-loading-foot');
    expect(main).toContain('class="boot-percent"');
    expect(main).toContain('class="boot-percent-tape"');
    expect(main).toContain('aria-valuenow="0"');
    expect(main).toContain('requestAnimationFrame(tick)');
    expect(main).toContain('Math.min(0.985');
    expect(main).toContain(': 0.011;');
    expect(main).toContain('Math.min(5, Math.max(0');
    expect(main).toContain('duration: remaining * 1000');
    expect(main).toContain('easing: `steps(${remaining}, end)`');
    expect(main).toContain('game.initialize((progress) => boot.setProgress');
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
    expect(ui).toContain('class="home-logo" src="/favicon.svg"');
    expect(ui).not.toContain('/assets/ui/');
    expect(ui).toContain('data-ui="enter" data-ui-main-continue');
    expect(ui).toContain('class="continue-more"');
    expect(ui).toContain('<p>Backrooms</p>');
    expect(ui).toContain('<h2 id="home-title">Random Story</h2>');
    expect(ui).not.toContain('Backrooms<span>.</span>');
    expect(ui).toContain('class="home-wordmark"');
    expect(ui).not.toContain('class="home-brand"');
    expect(styles).not.toContain('border-left: 2px solid rgba(251, 247, 229, 0.68)');
    expect(styles).toMatch(/\.experience-ui\.is-main-menu\[data-menu-page='home'\] \.home-title \{[\s\S]*?display: flex;/);
    expect(styles).toContain(".experience-ui.is-main-menu[data-menu-page='home'] .menu-action::after");
    expect(styles).not.toContain(".experience-ui.is-main-menu[data-menu-page='home'] .menu-action.primary:not(:disabled)");
    expect(styles).toMatch(/\.experience-ui \.text-button \{[\s\S]*?min-height: 42px;[\s\S]*?border-color: rgba\(229, 211, 108, \.28\);/);
    expect(ui).toContain('data-ui="main-menu"');
    expect(ui).toContain('data-ui="confirmation"');
    expect(ui).toContain('this.showConfirmation(');
    expect(ui).toContain('<span>Charger</span>');
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
    expect(backrooms).toContain('if (this.options.autoEnterOnReady) this.enter(true);');
    expect(backrooms).toContain('await audioReady;');
    expect(stairwell).toContain('await audioReady;');
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
    expect(stairwell).toContain('this.ui.beginGameplay(immediate);');
    expect(backrooms).toContain('this.ui.beginGameplay(immediate);');
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
