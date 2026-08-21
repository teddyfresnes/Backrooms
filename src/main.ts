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
import { OpeningIntro } from './ui/OpeningIntro';

const appElement = document.querySelector<HTMLElement>('#app');
if (!appElement) throw new Error('Application mount point not found.');
const app = appElement;

interface GameRuntime {
  initialize(): Promise<void>;
  dispose(): void;
}

let activeGame: GameRuntime | null = null;
let transitionId = 0;

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

const createBoot = (detail: string): HTMLElement => {
  const boot = document.createElement('div');
  boot.className = 'boot-shell';
  boot.innerHTML = `
    <div class="boot-brand"><img src="/favicon.svg" alt="" /><div><strong>Backrooms</strong><small>${detail}</small></div></div>
    <div class="boot-track" role="progressbar" aria-label="Chargement de l’environnement"><i></i></div>
  `;
  app.append(boot);
  return boot;
};

const showBootError = (error: unknown, retryAction: () => void): void => {
  const shell = document.createElement('div');
  shell.className = 'boot-error';
  const title = document.createElement('strong');
  title.textContent = 'ÉCHEC DU CHARGEMENT';
  const detail = document.createElement('span');
  detail.textContent = error instanceof Error ? error.message : String(error);
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Réessayer';
  retry.addEventListener('click', retryAction, { once: true });
  shell.append(title, detail, retry);
  app.append(shell);
};

const loadFromHistory = (id: string): void => {
  const save = readSave(id);
  if (save) void startSavedExperience(save);
};

async function startStairwell(launch: RussianStairwellLaunch): Promise<void> {
  const id = ++transitionId;
  clearRuntime();
  const boot = createBoot('random story');
  let game: GameRuntime | null = null;
  try {
    const { RussianStairwellGame } = await import('./core/RussianStairwellGame');
    if (id !== transitionId) return;
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
    await game.initialize();
    if (id !== transitionId) {
      game.dispose();
      return;
    }
    boot.remove();
  } catch (error) {
    if (activeGame === game) activeGame = null;
    game?.dispose();
    if (id !== transitionId) return;
    boot.remove();
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
  clearRuntime();
  const boot = createBoot('random story');
  let game: GameRuntime | null = null;
  try {
    // Give the transition overlay one frame before the synchronous origin
    // chunk generation inherited from the previous Backrooms runtime.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (id !== transitionId) return;
    const { Game } = await import('./core/Game');
    if (id !== transitionId) return;
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
    await game.initialize();
    if (id !== transitionId) {
      game.dispose();
      return;
    }
    boot.remove();
  } catch (error) {
    if (activeGame === game) activeGame = null;
    game?.dispose();
    if (id !== transitionId) return;
    boot.remove();
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
    .then(() => openingIntro.finish())
    .catch((error) => {
      openingIntro.dispose();
      console.error(error);
    });
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    transitionId += 1;
    openingIntro.dispose();
    clearRuntime();
  });
}
