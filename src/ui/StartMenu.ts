import type { RussianStairwellSaveMetadata } from '../core/GameSave';

export type StartMenuChoice = 'new' | 'load';

const formatDuration = (seconds: number): string => {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? `${hours} h ${String(remainder).padStart(2, '0')} min` : `${minutes} min`;
};

const formatSaveDetail = (save: RussianStairwellSaveMetadata | null): string => {
  if (!save) return 'Aucune sauvegarde compatible';
  const date = new Date(save.savedAt);
  const dateLabel = Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
    : 'date inconnue';
  return `${dateLabel} · ${formatDuration(save.playTimeSeconds)}`;
};

/** Lightweight launcher shown before the 3D scene and its heavy apartment load. */
export class StartMenu {
  private readonly root: HTMLElement;
  private readonly loadButton: HTMLButtonElement;
  private readonly loadDetail: HTMLElement;
  private hasSave = false;
  private resolveChoice?: (choice: StartMenuChoice) => void;

  constructor(container: HTMLElement, save: RussianStairwellSaveMetadata | null) {
    this.root = document.createElement('main');
    this.root.className = 'start-menu';
    this.root.innerHTML = `
      <div class="start-menu__grain" aria-hidden="true"></div>
      <section class="start-menu__panel" aria-labelledby="start-title">
        <p class="start-menu__eyebrow">RUSSIAN STAIRWELLS · V23</p>
        <h1 id="start-title">Backrooms<span>.</span></h1>
        <p class="start-menu__subtitle">Une cage d’escalier soviétique, quatre niveaux et un appartement oublié.</p>
        <div class="start-menu__actions">
          <button class="start-menu__action primary" type="button" data-choice="new">
            <strong>Nouvelle partie</strong><small>Commencer devant l’appartement</small>
          </button>
          <button class="start-menu__action" type="button" data-choice="load">
            <strong>Charger</strong><small data-load-detail></small>
          </button>
        </div>
        <p class="start-menu__note">La progression est sauvegardée automatiquement sur cet appareil.</p>
      </section>
    `;
    container.append(this.root);
    this.loadButton = this.query<HTMLButtonElement>('[data-choice="load"]');
    this.loadDetail = this.query('[data-load-detail]');
    this.setSave(save);
    this.query('[data-choice="new"]').addEventListener('click', () => this.choose('new'));
    this.loadButton.addEventListener('click', () => this.choose('load'));
  }

  waitForChoice(): Promise<StartMenuChoice> {
    return new Promise((resolve) => {
      this.resolveChoice = resolve;
    });
  }

  setSave(save: RussianStairwellSaveMetadata | null): void {
    this.hasSave = save !== null;
    this.loadButton.disabled = save === null;
    this.loadDetail.textContent = formatSaveDetail(save);
  }

  setBusy(busy: boolean): void {
    this.root.classList.toggle('is-busy', busy);
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('button')) {
      button.disabled = busy || (button === this.loadButton && !this.hasSave);
    }
  }

  dispose(): void {
    this.resolveChoice = undefined;
    this.root.remove();
  }

  private choose(choice: StartMenuChoice): void {
    if (!this.resolveChoice) return;
    const resolve = this.resolveChoice;
    this.resolveChoice = undefined;
    resolve(choice);
  }

  private query<T extends HTMLElement = HTMLElement>(selector: string): T {
    const result = this.root.querySelector<T>(selector);
    if (!result) throw new Error(`Missing start-menu element: ${selector}`);
    return result;
  }
}
