import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';
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
import { loadGameSettings } from './ui/settings';

const appElement = document.querySelector<HTMLElement>('#app');
if (!appElement) throw new Error('Application mount point not found.');
const app = appElement;
siteAudio.setMasterVolume(loadGameSettings().masterVolume);
const syncSiteAudioVisibility = (): void => siteAudio.syncVisibility();
document.addEventListener('visibilitychange', syncSiteAudioVisibility);

interface GameRuntime {
  initialize(onProgress?: (progress: number) => void): Promise<void>;
  dispose(): void;
}

interface BootView {
  readonly element: HTMLElement;
  setProgress(progress: number): void;
}

let activeGame: GameRuntime | null = null;
let transitionId = 0;
let openingFinished = false;

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
  activeGame?.dispose();
  activeGame = null;
  app.replaceChildren();
};

const createBoot = (detail: string): BootView => {
  const boot = document.createElement('div');
  boot.className = 'boot-shell';
  boot.setAttribute('role', 'status');
  boot.setAttribute('aria-live', 'polite');
  boot.innerHTML = `
    <div class="boot-content">
      <header class="boot-brand">
        <img src="/favicon.svg" alt="" />
        <div class="boot-wordmark"><p>Backrooms</p><h1>Random Story</h1></div>
      </header>
      <div class="boot-loading">
        <div class="boot-track" role="progressbar" aria-label="${detail}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
        <output class="boot-percent" aria-live="off" aria-label="0%">
          <span class="boot-percent-tape" aria-hidden="true">
            ${Array.from({ length: 101 }, (_, percent) => `<span>${percent}%</span>`).join('')}
          </span>
        </output>
      </div>
    </div>
  `;
  app.append(boot);
  const track = boot.querySelector<HTMLElement>('.boot-track')!;
  const fill = boot.querySelector<HTMLElement>('.boot-track i')!;
  const output = boot.querySelector<HTMLOutputElement>('.boot-percent')!;
  const percentTape = boot.querySelector<HTMLElement>('.boot-percent-tape')!;
  let target = 0;
  let displayed = 0;
  let previousTime = performance.now();
  let counterStart = 0;
  let counterStartedAt = previousTime;
  let counterAnimation: Animation | undefined;
  const counterPercentAt = (time = performance.now()): number => Math.min(
    99,
    counterStart + Math.floor(Math.max(0, time - counterStartedAt) / 1000),
  );
  const startCounter = (requestedPercent: number, force = false): void => {
    const now = performance.now();
    const current = counterPercentAt(now);
    const percent = Math.min(100, Math.max(0, Math.round(requestedPercent)));
    if (!force && percent <= current) {
      output.setAttribute('aria-label', `${current}%`);
      return;
    }
    counterAnimation?.cancel();
    counterStart = percent;
    counterStartedAt = now;
    percentTape.style.transform = `translate3d(0, -${percent}em, 0)`;
    output.setAttribute('aria-label', `${percent}%`);
    if (percent >= 99 || typeof percentTape.animate !== 'function') return;
    const remaining = 99 - percent;
    counterAnimation = percentTape.animate([
      { transform: `translate3d(0, -${percent}em, 0)` },
      { transform: 'translate3d(0, -99em, 0)' },
    ], {
      duration: remaining * 1000,
      easing: `steps(${remaining}, end)`,
      fill: 'forwards',
    });
  };
  const renderProgress = (): void => {
    const percent = Math.round(displayed * 100);
    fill.style.transform = `scaleX(${displayed})`;
    const visiblePercent = percent >= 100 ? 100 : Math.max(percent, counterPercentAt());
    track.setAttribute('aria-valuenow', String(visiblePercent));
    startCounter(percent, percent >= 100);
  };
  const tick = (time: number): void => {
    if (!boot.isConnected) return;
    // Preserve a few seconds of elapsed wall time after a main-thread-heavy
    // task so the percentage catches up instead of appearing frozen.
    const delta = Math.min(5, Math.max(0, (time - previousTime) / 1000));
    previousTime = time;
    if (target < 1) {
      // Some browser/Three/Rapier operations expose no granular progress.
      // Keep the indicator alive between real milestones. Even near the end it
      // advances by at least one visible percentage point per second; 100%
      // remains reserved for actual readiness.
      const base = Math.max(displayed, target);
      const idleRate = base < 0.15
        ? 0.026
        : base < 0.45 ? 0.018
          : base < 0.72 ? 0.014 : 0.011;
      displayed = Math.min(0.985, Math.max(target, displayed + idleRate * delta));
      renderProgress();
      requestAnimationFrame(tick);
    }
  };
  startCounter(0, true);
  requestAnimationFrame(tick);
  return {
    element: boot,
    setProgress(progress: number): void {
      target = Math.max(target, Math.min(1, Math.max(0, progress)));
      if (target >= 1) {
        displayed = 1;
      } else {
        displayed = Math.max(displayed, target);
      }
      renderProgress();
    },
  };
};

const showBootError = (error: unknown, retryAction: () => void): void => {
  const shell = document.createElement('div');
  shell.className = 'boot-error';
  const brand = document.createElement('div');
  brand.className = 'boot-error-brand';
  brand.innerHTML = '<img src="/favicon.svg" alt=""><span><small>Backrooms</small><strong>Random Story</strong></span>';
  const title = document.createElement('strong');
  title.textContent = 'ÉCHEC DU CHARGEMENT';
  const detail = document.createElement('span');
  detail.textContent = error instanceof Error ? error.message : String(error);
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Réessayer';
  retry.addEventListener('click', retryAction, { once: true });
  shell.append(brand, title, detail, retry);
  app.append(shell);
};

const loadFromHistory = (id: string): void => {
  const save = readSave(id);
  if (save) void startSavedExperience(save);
};

async function startStairwell(launch: RussianStairwellLaunch): Promise<void> {
  const id = ++transitionId;
  siteAudio.setMenuActive(false);
  clearRuntime();
  const boot = createBoot(
    launch.kind === 'load' ? 'Chargement de la sauvegarde' : 'Préparation du niveau',
  );
  boot.setProgress(0.02);
  let game: GameRuntime | null = null;
  try {
    const { RussianStairwellGame } = await import('./core/RussianStairwellGame');
    if (id !== transitionId) return;
    boot.setProgress(0.08);
    game = new RussianStairwellGame(app, launch, {
      onRequestNewGame: () => queueMicrotask(() => void startStairwell({ kind: 'new' })),
      onRequestMainMenu: () => queueMicrotask(() => void startInitialExperience()),
      onRequestLoadGame: loadFromHistory,
      // Finish the current input/frame stack before disposing the stairwell
      // runtime that detected the E interaction.
      onEnterBackrooms: () => queueMicrotask(() => void startBackrooms(
        { kind: 'new' },
        true,
      )),
    });
    activeGame = game;
    await game.initialize((progress) => boot.setProgress(0.08 + progress * 0.92));
    if (id !== transitionId) {
      game.dispose();
      return;
    }
    boot.setProgress(1);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    boot.element.remove();
  } catch (error) {
    if (activeGame === game) activeGame = null;
    game?.dispose();
    if (id !== transitionId) return;
    boot.element.remove();
    showBootError(error, () => void startStairwell(launch));
    console.error(error);
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
  const boot = createBoot(
    launch.kind === 'load'
      ? 'Chargement de la sauvegarde'
      : menuBackground
        ? 'Initialisation du menu'
        : 'Génération des Backrooms',
  );
  boot.setProgress(0.02);
  let game: GameRuntime | null = null;
  try {
    // Give the transition overlay one frame before the synchronous origin
    // chunk generation inherited from the previous Backrooms runtime.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (id !== transitionId) return;
    const { Game } = await import('./core/Game');
    if (id !== transitionId) return;
    boot.setProgress(0.08);
    game = new Game(app, {
      launch,
      autosaveOnReady,
      autoEnterOnReady: !menuBackground,
      onRequestContinue: menuBackground
        ? () => queueMicrotask(() => continueFromMainMenu())
        : undefined,
      onRequestNewGame: () => queueMicrotask(() => void startStairwell({ kind: 'new' })),
      onRequestMainMenu: () => queueMicrotask(() => void startInitialExperience()),
      onRequestLoadGame: loadFromHistory,
    });
    activeGame = game;
    await game.initialize((progress) => boot.setProgress(0.08 + progress * 0.92));
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

const openingIntro = new OpeningIntro();
requestAnimationFrame(() => {
  void Promise.all([startInitialExperience(), openingIntro.minimumDuration])
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
