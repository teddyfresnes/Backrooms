import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';
import { Game } from './core/Game';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Application mount point not found.');

try {
  const game = new Game(app);
  void game.initialize().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const fallback = document.createElement('div');
    fallback.className = 'boot-error';
    fallback.innerHTML = `<strong>ÉCHEC DE SYNCHRONISATION</strong><span>${message}</span>`;
    app.append(fallback);
    console.error(error);
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  app.innerHTML = `<div class="boot-error"><strong>ARCHIVE INACCESSIBLE</strong><span>${message}</span></div>`;
  console.error(error);
}
