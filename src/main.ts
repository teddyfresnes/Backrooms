import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';
import './ui/ModernUI.css';
import { LoadingScreen } from './ui/LoadingScreen';
import { loadRussianStairwellGame } from './core/GameSave';
import {
  listGameSaves,
  loadGameSave,
  writeGameSave,
  type BackroomsGameSave,
  type GameSaveEntry,
} from './core/SaveHistory';
import type { RussianStairwellLaunch } from './core/RussianStairwellGame';
import { siteAudio } from './audio/SiteAudio';
import { OpeningIntro } from './ui/OpeningIntro';
import { NewGameIntro } from './ui/NewGameIntro';
import { ApartmentPreload } from './apartment/ApartmentPreload';
import { APARTMENT_MODEL_URL } from './apartment/ApartmentAsset';
import { loadGameSettings } from './ui/settings';
import { preloadEntryAssets } from './core/EntryAssetPreload';
import { afterBrowserPaint } from './core/CooperativeWork';
import { LoadProgress, type LoadProgressCallback } from './core/LoadProgress';
import { withLoadDeadline } from './core/LoadDeadline';

const appElement = document.querySelector<HTMLElement>('#app');
if (!appElement) throw new Error('Application mount point not found.');
const app = appElement;
siteAudio.setMasterVolume(loadGameSettings().masterVolume);
const syncSiteAudioVisibility = (): void => siteAudio.syncVisibility();
document.addEventListener('visibilitychange', syncSiteAudioVisibility);

interface GameRuntime {
  initialize(onProgress?: LoadProgressCallback): Promise<void>;
  suspendForTransition(): void;
  dispose(): void;
}

interface BootView {
  readonly element: HTMLElement;
  setProgress(progress: number, phase?: string): void;
}

let activeGame: GameRuntime | null = null;
let activeNewGameIntro: NewGameIntro | null = null;
let activeApartmentPreload: ApartmentPreload | null = null;
let transitionId = 0;
let openingFinished = false;
let preparingStairwell: number | undefined;
let activePreparationAbort: AbortController | undefined;

const readHistory = (): readonly GameSaveEntry[] => {
  try {
    const history = listGameSaves(window.localStorage);
    if (history.length > 0) return history;

    // Import the newest compatible v1 stairwell snapshot once. The old slots
    // remain untouched so a failed migration never destroys recoverable data.
    const legacy = loadRussianStairwellGame(window.localStorage);
    if (!legacy) return history;
    writeGameSave(window.localStorage, {
      experienceId: 'russian-stairwell',
      kind: 'manual',
      levelId: 'building',
      levelLabel: 'Immeuble',
      playTimeSeconds: legacy.playTimeSeconds,
      payload: {
        safePosition: legacy.player.safePosition,
        quaternion: legacy.player.quaternion,
        entranceDoor: legacy.entranceDoor,
        apartmentLightOn: false,
      },
    }, new Date(legacy.savedAt));
    return listGameSaves(window.localStorage);
  } catch {
    return [];
  }
};

const readSave = (id: string): GameSaveEntry | null => {
  try {
    return loadGameSave(window.localStorage, id);
  } catch {
    return null;
  }
};

const clearRuntime = (): void => {
  activePreparationAbort?.abort(); activePreparationAbort = undefined;
  activeApartmentPreload?.dispose();
  activeApartmentPreload = null;
  activeNewGameIntro?.dispose();
  activeNewGameIntro = null;
  activeGame?.dispose();
  activeGame = null;
  app.replaceChildren();
  app.inert = false;
};

const createBoot = (detail: string): BootView => {
  const loading = new LoadingScreen(detail); loading.element.classList.add('boot-shell');
  app.append(loading.element);
  return { element: loading.element, setProgress: (progress, phase) => loading.setProgress(progress, phase) };
};

const showBootError = (error: unknown, retryAction: () => void): void => {
  app.inert = false;
  const shell = document.createElement('div');
  shell.className = 'boot-error';
  const title = document.createElement('strong');
  title.textContent = 'Chargement interrompu';
  const detail = document.createElement('span');
  detail.textContent = 'Impossible de préparer la partie. Réessayez.';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Réessayer';
  retry.addEventListener('click', retryAction, { once: true });
  const back = document.createElement('button');
  back.type = 'button'; back.textContent = 'Retour au menu';
  back.addEventListener('click', () => void startInitialExperience(), { once: true });
  shell.append(title, detail, retry, back);
  app.append(shell);
  retry.focus();
  console.error('[launch]', error);
};

const loadFromHistory = (id: string): void => {
  const save = readSave(id);
  if (save) void startSavedExperience(save);
};

async function startStairwell(launch: RussianStairwellLaunch): Promise<void> {
  if (preparingStairwell === transitionId) return;
  const id = ++transitionId;
  preparingStairwell = id;
  const preparation = new AbortController();
  siteAudio.setMenuActive(false);
  // Release the previous film before the next one records the underlay state.
  activeNewGameIntro?.dispose();
  // A stopped loop keeps the old scene inert without destroying GPU resources
  // under the photographs. Its full teardown belongs to the loading phase.
  activeGame?.suspendForTransition();
  // Mount the response in the input handler, before disposal, imports or WebGL.
  const intro = launch.kind === 'new' ? new NewGameIntro(app) : null;
  activeNewGameIntro = intro;
  let preload: ApartmentPreload | undefined;
  const boot = createBoot(
    launch.kind === 'load' ? 'Chargement de la sauvegarde' : 'Préparation du niveau',
  );
  boot.element.hidden = !!intro;
  if (intro) boot.element.style.display = 'none';
  const loadProgress = new LoadProgress();
  loadProgress.subscribe((progress, phase) => {
    boot.setProgress(progress, phase); intro?.setProgress(progress, phase);
  });
  let game: GameRuntime | null = null;
  let releasePreloads = () => {};
  try {
    await afterBrowserPaint();
    if (id !== transitionId) { intro?.dispose(); return; }
    activePreparationAbort?.abort(); activePreparationAbort = undefined;
    activePreparationAbort = preparation;
    activeApartmentPreload?.dispose(); activeApartmentPreload = null;
    releasePreloads = intro ? preloadEntryAssets() : () => {};
    loadProgress.start('network');
    preload = new ApartmentPreload(APARTMENT_MODEL_URL, event => {
      if (id !== transitionId) return;
      loadProgress.apartment(event);
    });
    activeApartmentPreload = preload ?? null;
    // During photos: network only. No module evaluation, JSON decompression,
    // renderer, character, physics, scene mounting or old-scene destruction.
    // finish() paints the shared loader after the last photo (or Skip).
    if (intro) await intro.finished;
    if (id !== transitionId) return;
    await afterBrowserPaint();
    if (id !== transitionId) return;
    activeGame?.dispose(); activeGame = null;
    for (const child of [...app.children]) if (child !== boot.element) child.remove();
    app.inert = !!intro;
    const { RussianStairwellGame } = await import('./core/RussianStairwellGame');
    if (id !== transitionId) return;

    const stairwell = new RussianStairwellGame(app, launch, {
      onRequestNewGame: () => queueMicrotask(() => void startStairwell({ kind: 'new' })),
      onRequestMainMenu: () => queueMicrotask(() => void startInitialExperience()),
      onRequestLoadGame: loadFromHistory,
      // Finish the current input/frame stack before disposing the stairwell
      // runtime that detected the E interaction.
      onEnterBackrooms: () => queueMicrotask(() => void startBackrooms(
        { kind: 'new' },
        true,
      )),
    }, { deferEntry: !!intro, apartmentPreload: preload, loadProgress, skipArrival: () => !!intro?.wasSkipped });
    game = stairwell;
    activeGame = game;
    await withLoadDeadline(game.initialize((progress, phase) => {
      if (id !== transitionId) return;
      boot.setProgress(progress, phase);
      intro?.setProgress(progress, phase);
    }), preparation.signal);
    if (id !== transitionId) {
      game.dispose();
      return;
    }
    boot.setProgress(1);
    intro?.setSceneReady();
    if (intro) {
      boot.element.remove();
      // Skip applies to the whole prologue, including its subsequent 3D shot.
      await intro.reveal(() => {
        app.inert = false;
        if (intro.wasSkipped) stairwell.enterAfterIntro();
        else stairwell.startArrivalCinematic();
      }, { continueMusic: !intro.wasSkipped });
      if (activeNewGameIntro === intro) activeNewGameIntro = null;
      return;
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    boot.element.remove();
  } catch (error) {
    preload?.dispose();
    if (activeApartmentPreload === preload) activeApartmentPreload = null;
    if (activeNewGameIntro === intro) { intro?.dispose(); activeNewGameIntro = null; }
    if (activeGame === game) { game?.dispose(); activeGame = null; }
    if (id !== transitionId) return;
    boot.element.remove();
    showBootError(error, () => void startStairwell(launch));
    console.error(error);
  } finally {
    loadProgress.dispose();
    releasePreloads();
    if (preparingStairwell === id) preparingStairwell = undefined;
    if (activePreparationAbort === preparation) activePreparationAbort = undefined;
  }
}

async function startBackrooms(
  launch: { readonly kind: 'new' } | { readonly kind: 'load'; readonly save: BackroomsGameSave },
  autosaveOnReady = false,
  menuBackground = false,
): Promise<void> {
  const id = ++transitionId;
  siteAudio.setMenuActive(false);
  clearRuntime();
  const preparation = new AbortController(); activePreparationAbort = preparation;
  const boot = createBoot(
    launch.kind === 'load'
      ? 'Chargement de la sauvegarde'
      : menuBackground
        ? 'Initialisation du menu'
        : 'Génération des Backrooms',
  );
  let game: GameRuntime | null = null;
  try {
    // Paint the overlay before importing the runtime and generating its origin in the worker.
    await afterBrowserPaint();
    if (id !== transitionId) return;
    const { Game } = await import('./core/Game');
    if (id !== transitionId) return;

    boot.setProgress(0, 'Génération du niveau');
    game = await Game.create(app, {
      launch,
      autosaveOnReady,
      autoEnterOnReady: !menuBackground,
      onRequestContinue: menuBackground
        ? () => queueMicrotask(() => continueFromMainMenu())
        : undefined,
      onRequestNewGame: () => queueMicrotask(() => void startStairwell({ kind: 'new' })),
      onRequestMainMenu: () => queueMicrotask(() => void startInitialExperience()),
      onRequestLoadGame: loadFromHistory,
    }, preparation.signal);
    if (id !== transitionId) { game.dispose(); return; }
    activeGame = game;
    await withLoadDeadline(game.initialize((progress, phase) => boot.setProgress(0.08 + progress * 0.92, phase)), preparation.signal);
    if (id !== transitionId) {
      game.dispose();
      return;
    }
    boot.setProgress(1);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    boot.element.remove();
    if (menuBackground && openingFinished) siteAudio.setMenuActive(true);
  } catch (error) {
    if (activeGame === game) activeGame = null;
    game?.dispose();
    if (id !== transitionId) return;
    boot.element.remove();
    showBootError(error, () => void startBackrooms(launch, autosaveOnReady, menuBackground));
    console.error(error);
  } finally {
    if (activePreparationAbort === preparation) activePreparationAbort = undefined;
  }
}

async function startSavedExperience(save: GameSaveEntry): Promise<void> {
  if (save.experienceId === 'backrooms') {
    await startBackrooms({ kind: 'load', save }, true);
    return;
  }
  await startStairwell({ kind: 'load', save });
}

function continueFromMainMenu(): void {
  const latest = readHistory()[0];
  if (latest) {
    void startSavedExperience(latest);
    return;
  }
  void startStairwell({ kind: 'new' });
}

async function startInitialExperience(): Promise<void> {
  // The launcher is always a fresh Level 0 Backrooms scene. It is only a
  // cinematic menu background: Continue loads history (or a fresh stairwell),
  // while New Game always starts at the Russian stairwell.
  await startBackrooms({ kind: 'new' }, false, true);
}

const menuReady = startInitialExperience();
const openingIntro = new OpeningIntro(menuReady);
requestAnimationFrame(() => {
  void Promise.all([menuReady, openingIntro.minimumDuration])
    .then(async () => {
      await openingIntro.finish();
      openingFinished = true;
      siteAudio.setMenuActive(true);
    })
    .catch((error) => {
      openingIntro.dispose();
      console.error(error);
    });
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    transitionId += 1;
    document.removeEventListener('visibilitychange', syncSiteAudioVisibility);
    openingIntro.dispose();
    clearRuntime();
    siteAudio.dispose();
  });
}
