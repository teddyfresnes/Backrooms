import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';
import {
  getRussianStairwellSaveMetadata,
  loadRussianStairwellGame,
  type RussianStairwellSave,
} from './core/GameSave';
import type { RussianStairwellLaunch } from './core/RussianStairwellGame';
import { StartMenu } from './ui/StartMenu';

const appElement = document.querySelector<HTMLElement>('#app');
if (!appElement) throw new Error('Application mount point not found.');
const app = appElement;

interface GameRuntime {
  initialize(): Promise<void>;
  dispose(): void;
}

let activeGame: GameRuntime | null = null;
let activeMenu: StartMenu | null = null;
let transitionId = 0;

const readSave = (): RussianStairwellSave | null => {
  try {
    return loadRussianStairwellGame(window.localStorage);
  } catch {
    return null;
  }
};

const clearRuntime = (): void => {
  activeGame?.dispose();
  activeGame = null;
  activeMenu?.dispose();
  activeMenu = null;
  app.replaceChildren();
};

const createBoot = (mark: string, brand: string, detail: string): HTMLElement => {
  const boot = document.createElement('div');
  boot.className = 'boot-shell';
  boot.innerHTML = `
    <div class="boot-brand"><span>${mark}</span><div><strong>${brand}</strong><small>${detail}</small></div></div>
    <div class="boot-track" role="progressbar" aria-label="Chargement de l’environnement"><i></i></div>
  `;
  app.append(boot);
  return boot;
};

const showLauncher = async (): Promise<void> => {
  const id = ++transitionId;
  clearRuntime();
  const initialSave = readSave();
  const menu = new StartMenu(
    app,
    initialSave ? getRussianStairwellSaveMetadata(initialSave) : null,
  );
  activeMenu = menu;

  while (id === transitionId) {
    const choice = await menu.waitForChoice();
    if (id !== transitionId) return;
    const save = choice === 'load' ? readSave() : null;
    if (choice === 'load' && !save) {
      menu.setSave(null);
      menu.setBusy(false);
      continue;
    }
    menu.setBusy(true);
    void startStairwell(save ? { kind: 'load', save } : { kind: 'new' });
    return;
  }
};

const showBootError = (error: unknown): void => {
  const shell = document.createElement('div');
  shell.className = 'boot-error';
  const title = document.createElement('strong');
  title.textContent = 'ÉCHEC DU CHARGEMENT';
  const detail = document.createElement('span');
  detail.textContent = error instanceof Error ? error.message : String(error);
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Retour à l’accueil';
  retry.addEventListener('click', () => void showLauncher(), { once: true });
  shell.append(title, detail, retry);
  app.append(shell);
};

async function startStairwell(launch: RussianStairwellLaunch): Promise<void> {
  const id = ++transitionId;
  clearRuntime();
  const boot = createBoot('RS', 'Russian Stairwells', 'Chargement de l’immeuble');
  let game: GameRuntime | null = null;
  try {
    const { RussianStairwellGame } = await import('./core/RussianStairwellGame');
    if (id !== transitionId) return;
    game = new RussianStairwellGame(app, launch, {
      onRequestNewGame: () => void startStairwell({ kind: 'new' }),
      onRequestLoadGame: () => {
        const save = readSave();
        if (save) void startStairwell({ kind: 'load', save });
        else void showLauncher();
      },
      // Finish the current input/frame stack before disposing the stairwell
      // runtime that detected the E interaction.
      onEnterBackrooms: () => queueMicrotask(() => void startBackrooms()),
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
    showBootError(error);
    console.error(error);
  }
}

async function startBackrooms(): Promise<void> {
  const id = ++transitionId;
  clearRuntime();
  const boot = createBoot('BR', 'Backrooms', 'Génération du labyrinthe');
  let game: GameRuntime | null = null;
  try {
    // Give the transition overlay one frame before the synchronous origin
    // chunk generation inherited from the previous Backrooms runtime.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (id !== transitionId) return;
    const { Game } = await import('./core/Game');
    if (id !== transitionId) return;
    game = new Game(app, {
      onRequestNewGame: () => queueMicrotask(() => void startBackrooms()),
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
    showBootError(error);
    console.error(error);
  }
}

requestAnimationFrame(() => void showLauncher());

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    transitionId += 1;
    clearRuntime();
  });
}
