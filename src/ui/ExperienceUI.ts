import type { DiagnosticsSnapshot } from '../core/Diagnostics';
import type { GameSaveExperienceId, GameSaveSummary } from '../core/SaveHistory';
import {
  controlCodeFromKeyboardEvent,
  controlActions,
  defaultControlBindings,
  detectKeyboardPreset,
  formatKeyLabel,
  isBindableCode,
  remapControlBinding,
  type ControlAction,
  type KeyboardPreset,
} from '../input/ControlBindings';
import {
  defaultGameSettings,
  saveGameSettings,
  type GameSettings,
} from './settings';

interface UIActions {
  enter(): void;
  regenerate(): void;
  returnToMainMenu(): void;
  saveGame?(): boolean | Promise<boolean>;
  loadGame?(id: string): void;
  toggleFullscreen(): void;
  settingsChanged(settings: GameSettings): void | Promise<void>;
  submitConsole(value: string, mode: ConsoleMode): ConsoleSubmitResult;
  completeConsole(value: string, mode: ConsoleMode): ConsoleCompletion | null;
  consoleVisibility(open: boolean): void;
}

export type ConsoleMode = 'command' | 'chat';

export interface ConsoleCompletion {
  hint: string;
  suggestions: ConsoleSuggestion[];
}

export interface ConsoleSuggestion {
  value: string;
  label: string;
  detail: string;
}

export interface ConsoleMessage {
  kind: 'chat' | 'command' | 'system' | 'error';
  text: string;
}

export interface ConsoleSubmitResult {
  close: boolean;
  feedback: string;
  messages: ConsoleMessage[];
}

type MenuPage = 'home' | 'saves' | 'settings';
type SettingsCategory = 'graphics' | 'audio' | 'game' | 'controls';

const experienceLabelById: Readonly<Record<GameSaveExperienceId, string>> = {
  backrooms: 'Backrooms',
  'russian-stairwell': 'Immeuble',
};

const bindingLabels: Readonly<Record<ControlAction, string>> = {
  forward: 'Avancer',
  backward: 'Reculer',
  left: 'Aller à gauche',
  right: 'Aller à droite',
  sprint: 'Courir',
  jump: 'Sauter',
  crouch: 'S’accroupir',
  interact: 'Interagir',
};

const titleCase = (value: string): string => value
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replaceAll('_', ' ')
  .replace(/^./, (character) => character.toUpperCase());

const formatSaveDuration = (seconds: number): string => {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours > 0) return `${hours} h ${String(remainder).padStart(2, '0')} min`;
  return minutes === 0 ? 'Moins d’une minute' : `${minutes} min`;
};

const formatSaveDate = (savedAt: string): string => {
  const date = new Date(savedAt);
  if (!Number.isFinite(date.getTime())) return 'Date inconnue';
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
};

const formatDiagnosticValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'oui' : 'non';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value);
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—';
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, nested]) => `${key} ${formatDiagnosticValue(nested)}`)
      .join(' · ');
  }
  return String(value);
};

export class ExperienceUI {
  private readonly root: HTMLElement;
  private readonly enterButtons: readonly HTMLButtonElement[];
  private readonly saveButton: HTMLButtonElement;
  private readonly saveHistoryList: HTMLElement;
  private readonly saveHistoryEmpty: HTMLElement;
  private readonly saveStatus: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly confirmation: HTMLElement;
  private readonly confirmationTitle: HTMLElement;
  private readonly confirmationMessage: HTMLElement;
  private readonly confirmationAccept: HTMLButtonElement;
  private readonly confirmationCancel: HTMLButtonElement;
  private readonly interactionPrompt: HTMLElement;
  private readonly fallFlash: HTMLElement;
  private readonly consolePanel: HTMLElement;
  private readonly consoleHistory: HTMLElement;
  private readonly consoleMessages: HTMLElement;
  private readonly consoleSuggestions: HTMLElement;
  private readonly consoleInput: HTMLInputElement;
  private readonly consoleHint: HTMLElement;
  private readonly diagnosticsPanel: HTMLElement;
  private readonly diagnosticsContent: HTMLElement;
  private readonly actions: UIActions;
  private settings: GameSettings;
  private activePage: MenuPage = 'home';
  private activeSettingsCategory: SettingsCategory = 'graphics';
  private saveHistory: readonly GameSaveSummary[] = [];
  private readyState = false;
  private enteredOnce = false;
  private mainMenuState = true;
  private interactionLabel: string | null = null;
  private consoleMode: ConsoleMode = 'command';
  private completionSource = '';
  private completionIndex = -1;
  private completionSuggestions: ConsoleSuggestion[] = [];
  private readonly submittedInputs: string[] = [];
  private historyIndex = 0;
  private historyDraft = '';
  private chatFadeTimer?: number;
  private saveStatusTimer?: number;
  private pendingBinding?: ControlAction;
  private pendingBindingButton?: HTMLButtonElement;
  private pendingConfirmation?: () => void;

  constructor(
    container: HTMLElement,
    actions: UIActions,
    settings: GameSettings,
    experienceId: GameSaveExperienceId = 'backrooms',
  ) {
    this.actions = actions;
    this.settings = { ...settings };
    const bindingRows = controlActions.map((action) => `
      <button class="binding-row" type="button" data-binding="${action}">
        <span>${bindingLabels[action]}</span>
        <kbd data-binding-value>${formatKeyLabel(settings.controls[action])}</kbd>
      </button>
    `).join('');
    this.root = document.createElement('div');
    this.root.className = 'experience-ui is-main-menu';
    this.root.dataset.menuPage = 'home';
    this.root.setAttribute('aria-busy', 'true');
    this.root.innerHTML = `
      <div class="atmosphere-overlay" aria-hidden="true">
        <div class="menu-shade"></div>
        <div class="film-grain"></div>
        <div class="edge-shadow"></div>
      </div>

      <section class="menu-overlay" data-ui="overlay" role="dialog" aria-modal="true" aria-label="Menu principal" aria-hidden="true" inert>
        <div class="menu-panel">
          <div class="menu-content">
            <section class="menu-page active" data-page="home" aria-labelledby="home-title">
              <img class="home-logo main-menu-only" src="/favicon.svg" alt="" />
              <div class="home-stage">
                <header class="home-title">
                  <div class="home-wordmark">
                    <h2 id="home-title">Backrooms</h2>
                    <p>Random story</p>
                  </div>
                </header>
                <div class="menu-actions" aria-label="Actions principales">
                  <div class="continue-action main-menu-only">
                    <button class="menu-action primary" type="button" data-ui="enter" data-ui-main-continue disabled>
                      <span>Continuer</span>
                    </button>
                    <button class="continue-more" type="button" data-open-page="saves" aria-label="Ouvrir les sauvegardes">+</button>
                  </div>
                  <button class="menu-action main-menu-only" type="button" data-ui="regenerate">
                    <span>Nouvelle partie</span>
                  </button>
                  <button class="menu-action main-menu-only" type="button" data-open-page="settings">
                    <span>Paramètres</span>
                  </button>

                  <div class="continue-action pause-only" hidden>
                    <button class="menu-action primary" type="button" data-ui="enter" disabled>
                      <span>Continuer</span>
                    </button>
                    <button class="continue-more" type="button" data-open-page="saves" aria-label="Ouvrir les sauvegardes">+</button>
                  </div>
                  <button class="menu-action pause-only" type="button" data-ui="save-game" hidden>
                    <span>Sauvegarder</span>
                  </button>
                  <button class="menu-action pause-only" type="button" data-open-page="settings" hidden>
                    <span>Paramètres</span>
                  </button>
                  <button class="menu-action pause-only danger" type="button" data-ui="main-menu" hidden>
                    <span>Retour au menu principal</span>
                  </button>
                </div>
                <p class="save-status" data-ui="save-status" role="status" aria-live="polite" hidden></p>
              </div>
            </section>

            <section class="menu-page" data-page="saves" aria-labelledby="saves-title" aria-hidden="true">
              <header class="page-heading">
                <div>
                  <button class="text-button" type="button" data-back>Retour</button>
                  <h2 id="saves-title">Sauvegardes</h2>
                </div>
              </header>
              <div class="save-browser">
                <button class="save-entry current-session-action" type="button" data-ui="enter" disabled>
                  <span class="save-entry-heading">
                    <strong>Session précédente</strong>
                    <small>${experienceLabelById[experienceId]} · Session chargée</small>
                  </span>
                  <span class="save-entry-details"><small>Continuer</small></span>
                </button>
                <div class="save-history" data-ui="save-history" aria-label="Historique des sauvegardes"></div>
                <p class="save-history-empty" data-ui="save-history-empty">Aucune sauvegarde pour le moment.</p>
              </div>
            </section>

            <section class="menu-page" data-page="settings" aria-labelledby="settings-title" aria-hidden="true">
              <header class="page-heading">
                <div>
                  <button class="text-button" type="button" data-back>Retour</button>
                  <h2 id="settings-title">Paramètres</h2>
                </div>
                <button class="reset-settings" type="button" data-ui="reset-settings">Réinitialiser</button>
              </header>

              <div class="settings-layout">
                <nav class="settings-categories" aria-label="Catégories de paramètres" role="tablist">
                  <button id="settings-tab-graphics" class="active" type="button" role="tab" aria-controls="settings-panel-graphics" aria-selected="true" data-settings-category="graphics">Graphismes</button>
                  <button id="settings-tab-audio" type="button" role="tab" aria-controls="settings-panel-audio" aria-selected="false" data-settings-category="audio">Audio</button>
                  <button id="settings-tab-game" type="button" role="tab" aria-controls="settings-panel-game" aria-selected="false" data-settings-category="game">Jeu</button>
                  <button id="settings-tab-controls" type="button" role="tab" aria-controls="settings-panel-controls" aria-selected="false" data-settings-category="controls">Commandes</button>
                </nav>

                <div class="settings-list">
                  <fieldset id="settings-panel-graphics" class="settings-card active" data-settings-panel="graphics" role="tabpanel" aria-labelledby="settings-tab-graphics">
                    <legend>Graphismes</legend>
                    <label class="setting-row">
                      <strong>Éclairage</strong>
                      <select data-setting="lighting" aria-label="Système d’éclairage">
                        <option value="modern">Moderne</option>
                        <option value="legacy">Classique</option>
                      </select>
                    </label>
                    <label class="setting-row">
                      <strong>Qualité</strong>
                      <select data-setting="renderQuality" aria-label="Qualité de rendu">
                        <option value="auto">Automatique</option>
                        <option value="performance">Performance</option>
                        <option value="quality">Qualité</option>
                      </select>
                    </label>
                    <label class="setting-row range-row">
                      <strong>Champ de vision</strong>
                      <span class="range-control"><input data-setting="fieldOfView" type="range" min="60" max="100" step="1" /><output data-output="fieldOfView"></output></span>
                    </label>
                    <div class="setting-row">
                      <strong>Plein écran</strong>
                      <button class="setting-button" type="button" data-ui="fullscreen"><span data-ui="fullscreen-label">Activer</span></button>
                    </div>
                  </fieldset>

                  <fieldset id="settings-panel-audio" class="settings-card" data-settings-panel="audio" role="tabpanel" aria-labelledby="settings-tab-audio" hidden>
                    <legend>Audio</legend>
                    <label class="setting-row range-row">
                      <strong>Volume général</strong>
                      <span class="range-control"><input data-setting="masterVolume" type="range" min="0" max="1" step="0.01" /><output data-output="masterVolume"></output></span>
                    </label>
                  </fieldset>

                  <fieldset id="settings-panel-game" class="settings-card" data-settings-panel="game" role="tabpanel" aria-labelledby="settings-tab-game" hidden>
                    <legend>Jeu</legend>
                    <label class="setting-row range-row">
                      <strong>Sensibilité souris</strong>
                      <span class="range-control"><input data-setting="lookSensitivity" type="range" min="0.3" max="2" step="0.05" /><output data-output="lookSensitivity"></output></span>
                    </label>
                    <label class="setting-row toggle-row">
                      <strong>Réticule</strong>
                      <input data-setting="crosshair" type="checkbox" role="switch" />
                    </label>
                    <label class="setting-row toggle-row">
                      <strong>Mouvements de caméra</strong>
                      <input data-setting="cameraMotion" type="checkbox" role="switch" />
                    </label>
                    <label class="setting-row toggle-row">
                      <strong>Animation du menu</strong>
                      <input data-setting="menuMotion" type="checkbox" role="switch" />
                    </label>
                  </fieldset>

                  <fieldset id="settings-panel-controls" class="settings-card controls-settings" data-settings-panel="controls" role="tabpanel" aria-labelledby="settings-tab-controls" hidden>
                    <legend>Commandes</legend>
                    <div class="keyboard-presets" aria-label="Disposition du clavier">
                      <button type="button" data-control-preset="azerty">AZERTY</button>
                      <button type="button" data-control-preset="qwerty">QWERTY</button>
                    </div>
                    <p class="binding-help" data-ui="binding-help">Sélectionnez une commande, puis appuyez sur une touche.</p>
                    <div class="bindings-grid">${bindingRows}</div>
                  </fieldset>
                </div>
              </div>

              <div class="settings-progress" data-ui="settings-progress" aria-hidden="true">
                <div><span data-ui="settings-progress-label">Application</span><b data-ui="settings-progress-value">0%</b></div>
                <div class="loading-track"><i data-ui="settings-progress-fill"></i></div>
              </div>
            </section>
          </div>
        </div>
        <p class="menu-hint"><kbd>Échap</kbd><span data-ui="escape-hint">Retour</span></p>
      </section>

      <section class="confirmation-layer" data-ui="confirmation" role="dialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-message" aria-hidden="true" hidden>
        <div class="confirmation-card">
          <small>CONFIRMATION</small>
          <h2 id="confirmation-title" data-ui="confirmation-title"></h2>
          <p id="confirmation-message" data-ui="confirmation-message"></p>
          <div class="confirmation-actions">
            <button type="button" data-ui="confirmation-cancel">Annuler</button>
            <button class="danger" type="button" data-ui="confirmation-accept"></button>
          </div>
        </div>
      </section>

      <section class="hud" data-ui="hud" aria-hidden="true">
        <div class="reticle" aria-hidden="true"><i></i><b></b><span></span><em></em></div>
        <div class="interaction-prompt" data-ui="interaction" aria-hidden="true"><kbd>E</kbd><span></span></div>
        <section class="command-console" data-ui="console" aria-hidden="true">
          <div class="console-shell">
            <div class="chat-history" data-ui="chat-history" aria-live="polite">
              <div class="chat-messages" data-ui="chat-messages"></div>
            </div>
            <div class="console-suggestions" data-ui="console-suggestions" aria-label="Suggestions de commandes"></div>
            <div class="console-input-row">
              <input data-ui="console-input" type="text" spellcheck="false" autocomplete="off" maxlength="180" aria-label="Chat et commandes" />
            </div>
            <small data-ui="console-hint"></small>
          </div>
        </section>
      </section>

      <aside class="diagnostics-panel" data-ui="diagnostics" aria-hidden="true" aria-label="Informations techniques">
        <header><span>LOGS</span><small>capture de diagnostic</small></header>
        <div class="diagnostics-content" data-ui="diagnostics-content"></div>
        <footer><code>/logs</code><span>masquer</span></footer>
      </aside>

      <div class="fall-flash" data-ui="fall"><span>Retour au dernier point sûr</span></div>
      <div class="fatal-error" data-ui="error" role="alert"></div>
    `;
    container.append(this.root);

    this.enterButtons = [...this.root.querySelectorAll<HTMLButtonElement>('[data-ui="enter"]')];
    this.saveButton = this.query<HTMLButtonElement>('[data-ui="save-game"]');
    this.saveHistoryList = this.query('[data-ui="save-history"]');
    this.saveHistoryEmpty = this.query('[data-ui="save-history-empty"]');
    this.saveStatus = this.query('[data-ui="save-status"]');
    this.overlay = this.query('[data-ui="overlay"]');
    this.confirmation = this.query('[data-ui="confirmation"]');
    this.confirmationTitle = this.query('[data-ui="confirmation-title"]');
    this.confirmationMessage = this.query('[data-ui="confirmation-message"]');
    this.confirmationAccept = this.query<HTMLButtonElement>('[data-ui="confirmation-accept"]');
    this.confirmationCancel = this.query<HTMLButtonElement>('[data-ui="confirmation-cancel"]');
    this.interactionPrompt = this.query('[data-ui="interaction"]');
    this.fallFlash = this.query('[data-ui="fall"]');
    this.consolePanel = this.query('[data-ui="console"]');
    this.consoleHistory = this.query('[data-ui="chat-history"]');
    this.consoleMessages = this.query('[data-ui="chat-messages"]');
    this.consoleSuggestions = this.query('[data-ui="console-suggestions"]');
    this.consoleInput = this.query<HTMLInputElement>('[data-ui="console-input"]');
    this.consoleHint = this.query('[data-ui="console-hint"]');
    this.diagnosticsPanel = this.query('[data-ui="diagnostics"]');
    this.diagnosticsContent = this.query('[data-ui="diagnostics-content"]');

    for (const button of this.enterButtons) button.addEventListener('click', actions.enter);
    this.query('[data-ui="regenerate"]').addEventListener('click', this.requestNewGame);
    this.query('[data-ui="main-menu"]').addEventListener('click', this.requestMainMenu);
    this.confirmationCancel.addEventListener('click', this.closeConfirmation);
    this.confirmationAccept.addEventListener('click', this.acceptConfirmation);
    this.saveButton.addEventListener('click', this.requestSave);
    this.saveButton.disabled = actions.saveGame === undefined;
    this.query('[data-ui="fullscreen"]').addEventListener('click', actions.toggleFullscreen);
    this.query('[data-ui="reset-settings"]').addEventListener('click', this.resetSettings);
    for (const button of this.root.querySelectorAll<HTMLElement>('[data-open-page]')) {
      button.addEventListener('click', () => this.showPage(button.dataset.openPage as MenuPage));
    }
    for (const button of this.root.querySelectorAll<HTMLElement>('[data-back]')) {
      button.addEventListener('click', () => this.showPage('home'));
    }
    for (const control of this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]')) {
      const eventName = control instanceof HTMLInputElement && control.type === 'range'
        ? 'input'
        : 'change';
      control.addEventListener(eventName, this.onSettingInput);
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-binding]')) {
      button.addEventListener('click', () => {
        this.startBinding(button.dataset.binding as ControlAction, button);
      });
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-control-preset]')) {
      button.addEventListener('click', () => {
        this.applyControlPreset(button.dataset.controlPreset as KeyboardPreset);
      });
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-settings-category]')) {
      button.addEventListener('click', () => {
        this.showSettingsCategory(button.dataset.settingsCategory as SettingsCategory);
      });
      button.addEventListener('keydown', this.onSettingsCategoryKeyDown);
    }
    this.consoleInput.addEventListener('keydown', this.onConsoleKeyDown);
    this.consoleInput.addEventListener('input', this.onConsoleInput);
    document.addEventListener('keydown', this.onMenuKeyDown);
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    this.syncMenuContext();
    this.showSettingsCategory(this.activeSettingsCategory);
    this.renderSaveHistory();
    this.syncSettingsControls();
    this.applySettingsPresentation();
  }

  get isMainMenuOpen(): boolean {
    return this.mainMenuState && !this.root.classList.contains('is-playing');
  }

  get isPaused(): boolean {
    return this.enteredOnce && !this.mainMenuState && !this.root.classList.contains('is-playing');
  }

  setReady(): void {
    this.readyState = true;
    for (const button of this.enterButtons) button.disabled = false;
    this.root.classList.add('is-ready');
    this.root.setAttribute('aria-busy', 'false');
    this.overlay.setAttribute('aria-hidden', 'false');
    this.overlay.inert = false;
  }

  setSaveHistory(summaries: readonly GameSaveSummary[]): void {
    this.saveHistory = [...summaries];
    this.renderSaveHistory();
  }

  setSessionStarted(started: boolean): void {
    this.root.classList.toggle('has-session', started);
  }

  beginGameplay(): void {
    this.enteredOnce = true;
    this.mainMenuState = false;
    this.root.classList.add('is-playing');
    this.root.classList.remove('is-paused', 'is-main-menu');
    this.overlay.setAttribute('aria-hidden', 'true');
    this.overlay.inert = true;
    this.query('[data-ui="hud"]').setAttribute('aria-hidden', 'false');
    this.syncMenuContext();
  }

  setLocked(locked: boolean): void {
    if (!locked) this.closeConsole();
    if (locked) {
      this.beginGameplay();
      return;
    }
    this.root.classList.remove('is-playing');
    this.overlay.setAttribute('aria-hidden', 'false');
    this.overlay.inert = false;
    this.query('[data-ui="hud"]').setAttribute('aria-hidden', 'true');
    if (this.readyState && this.enteredOnce) {
      this.mainMenuState = false;
      this.root.classList.add('is-paused');
      this.root.classList.remove('is-main-menu');
      this.overlay.setAttribute('aria-label', 'Menu pause');
      this.syncMenuContext();
      this.showPage('home');
    }
  }

  update(_room: unknown, _fps: number): void {
    // The regular HUD is intentionally silent. Runtime details live behind /logs.
  }

  setInteraction(label: string | null): void {
    if (label === this.interactionLabel) return;
    this.interactionLabel = label;
    const visible = Boolean(label);
    this.interactionPrompt.classList.toggle('visible', visible);
    this.interactionPrompt.setAttribute('aria-hidden', String(!visible));
    this.interactionPrompt.querySelector('span')!.textContent = label ?? '';
  }

  setDiagnosticsVisible(visible: boolean): void {
    this.root.classList.toggle('has-diagnostics', visible);
    this.diagnosticsPanel.setAttribute('aria-hidden', String(!visible));
  }

  updateDiagnostics(snapshot: DiagnosticsSnapshot): void {
    const fragment = document.createDocumentFragment();
    const ignored = new Set(['ready', 'updatedAt']);
    for (const [sectionName, rawSection] of Object.entries(snapshot)) {
      if (ignored.has(sectionName) || typeof rawSection !== 'object' || rawSection === null) continue;
      const section = document.createElement('section');
      const heading = document.createElement('h2');
      heading.textContent = titleCase(sectionName);
      const list = document.createElement('dl');
      for (const [key, value] of Object.entries(rawSection as Record<string, unknown>)) {
        const row = document.createElement('div');
        const term = document.createElement('dt');
        const description = document.createElement('dd');
        term.textContent = titleCase(key);
        description.textContent = formatDiagnosticValue(value);
        row.append(term, description);
        list.append(row);
      }
      section.append(heading, list);
      fragment.append(section);
    }
    this.diagnosticsContent.replaceChildren(fragment);
  }

  setSettingsProgress(progress: number | null, label = 'Application'): void {
    const panel = this.query('[data-ui="settings-progress"]');
    const visible = progress !== null;
    panel.classList.toggle('visible', visible);
    panel.setAttribute('aria-hidden', String(!visible));
    this.query<HTMLSelectElement>('[data-setting="lighting"]').disabled = visible;
    this.query<HTMLButtonElement>('[data-ui="reset-settings"]').disabled = visible;
    if (!visible) return;
    const normalized = Math.min(1, Math.max(0, progress));
    this.query('[data-ui="settings-progress-label"]').textContent = label;
    this.query('[data-ui="settings-progress-value"]').textContent = `${Math.round(normalized * 100)}%`;
    this.query<HTMLElement>('[data-ui="settings-progress-fill"]').style.transform = `scaleX(${normalized})`;
  }

  get isConsoleOpen(): boolean {
    return this.root.classList.contains('is-console-open');
  }

  openConsole(mode: ConsoleMode): void {
    this.consoleMode = mode;
    this.consolePanel.dataset.mode = mode;
    this.consoleInput.value = mode === 'command' ? '/' : '';
    this.consoleHint.textContent = mode === 'command'
      ? 'ÉCRIS /HELP · TAB COMPLÈTE · ↑↓ HISTORIQUE'
      : 'ENTRÉE ENVOIE · / EXÉCUTE AUSSI UNE COMMANDE';
    this.resetCompletion();
    this.historyIndex = this.submittedInputs.length;
    this.historyDraft = '';
    this.root.classList.add('is-console-open');
    this.consolePanel.setAttribute('aria-hidden', 'false');
    this.actions.consoleVisibility(true);
    this.updateSuggestions();
    requestAnimationFrame(() => {
      this.consoleInput.focus();
      const end = this.consoleInput.value.length;
      this.consoleInput.setSelectionRange(end, end);
      this.consoleHistory.scrollTop = this.consoleHistory.scrollHeight;
    });
  }

  closeConsole(): void {
    if (!this.isConsoleOpen) return;
    this.root.classList.remove('is-console-open');
    this.consolePanel.setAttribute('aria-hidden', 'true');
    this.consoleInput.blur();
    this.consoleInput.value = '';
    this.consoleSuggestions.replaceChildren();
    this.actions.consoleVisibility(false);
    this.resetCompletion();
    if (this.root.classList.contains('has-chat-message')) {
      if (this.chatFadeTimer !== undefined) window.clearTimeout(this.chatFadeTimer);
      this.chatFadeTimer = window.setTimeout(() => {
        this.chatFadeTimer = undefined;
        this.root.classList.remove('has-chat-message');
      }, 6500);
    }
  }

  private showPage(page: MenuPage): void {
    this.cancelBinding();
    this.activePage = page;
    this.root.dataset.menuPage = page;
    for (const section of this.root.querySelectorAll<HTMLElement>('[data-page]')) {
      const active = section.dataset.page === page;
      section.classList.toggle('active', active);
      section.setAttribute('aria-hidden', String(!active));
    }
    this.query('[data-ui="escape-hint"]').textContent = page === 'home'
      ? (this.root.classList.contains('is-paused') ? 'Reprendre' : 'Retour')
      : 'Retour';
  }

  private syncMenuContext(): void {
    const paused = this.root.classList.contains('is-paused');
    for (const element of this.root.querySelectorAll<HTMLElement>('.main-menu-only')) {
      element.hidden = paused;
    }
    for (const element of this.root.querySelectorAll<HTMLElement>('.pause-only')) {
      element.hidden = !paused;
    }
  }

  private showSettingsCategory(category: SettingsCategory): void {
    this.cancelBinding();
    this.activeSettingsCategory = category;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-settings-category]')) {
      const active = button.dataset.settingsCategory === category;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    }
    for (const panel of this.root.querySelectorAll<HTMLElement>('[data-settings-panel]')) {
      const active = panel.dataset.settingsPanel === category;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
      panel.setAttribute('aria-hidden', String(!active));
    }
  }

  private readonly onSettingsCategoryKeyDown = (event: KeyboardEvent): void => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      return;
    }
    const buttons = [...this.root.querySelectorAll<HTMLButtonElement>('[data-settings-category]')];
    const current = buttons.indexOf(event.currentTarget as HTMLButtonElement);
    if (current < 0) return;
    event.preventDefault();
    const backwards = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (current + (backwards ? -1 : 1) + buttons.length) % buttons.length;
    const next = buttons[nextIndex];
    if (!next) return;
    this.showSettingsCategory(next.dataset.settingsCategory as SettingsCategory);
    next.focus();
  };

  private renderSaveHistory(): void {
    const fragment = document.createDocumentFragment();
    for (const summary of this.saveHistory) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'save-entry';
      button.dataset.saveId = summary.id;
      button.disabled = this.actions.loadGame === undefined;
      button.setAttribute(
        'aria-label',
        `${summary.levelLabel}, ${summary.kind === 'manual' ? 'sauvegarde manuelle' : 'sauvegarde automatique'}, ${formatSaveDate(summary.savedAt)}`,
      );

      const heading = document.createElement('span');
      heading.className = 'save-entry-heading';
      const level = document.createElement('strong');
      level.textContent = summary.levelLabel;
      const kind = document.createElement('small');
      kind.textContent = `${experienceLabelById[summary.experienceId]} · ${
        summary.kind === 'manual' ? 'Sauvegarde manuelle' : 'Sauvegarde auto'
      }`;
      heading.append(level, kind);

      const details = document.createElement('span');
      details.className = 'save-entry-details';
      const date = document.createElement('time');
      date.dateTime = summary.savedAt;
      date.textContent = formatSaveDate(summary.savedAt);
      const duration = document.createElement('small');
      duration.textContent = formatSaveDuration(summary.playTimeSeconds);
      details.append(date, duration);

      button.append(heading, details);
      button.addEventListener('click', () => this.actions.loadGame?.(summary.id));
      fragment.append(button);
    }
    this.saveHistoryList.replaceChildren(fragment);
    const empty = this.saveHistory.length === 0;
    this.saveHistoryList.hidden = empty;
    this.saveHistoryEmpty.hidden = !empty;
  }

  private readonly requestSave = async (): Promise<void> => {
    if (!this.actions.saveGame) return;
    this.saveButton.disabled = true;
    this.setSaveStatus('Sauvegarde en cours…', 'pending');
    let saved = false;
    try {
      saved = await this.actions.saveGame();
    } catch {
      saved = false;
    } finally {
      this.saveButton.disabled = false;
    }
    this.setSaveStatus(
      saved ? 'Partie sauvegardée' : 'Impossible de sauvegarder',
      saved ? 'success' : 'error',
      2400,
    );
  };

  private setSaveStatus(
    message: string,
    state: 'pending' | 'success' | 'error',
    clearAfter = 0,
  ): void {
    if (this.saveStatusTimer !== undefined) window.clearTimeout(this.saveStatusTimer);
    this.saveStatusTimer = undefined;
    this.saveStatus.textContent = message;
    this.saveStatus.dataset.state = state;
    this.saveStatus.hidden = false;
    if (clearAfter <= 0) return;
    this.saveStatusTimer = window.setTimeout(() => {
      this.saveStatusTimer = undefined;
      this.saveStatus.textContent = '';
      delete this.saveStatus.dataset.state;
      this.saveStatus.hidden = true;
    }, clearAfter);
  }

  private syncSettingsControls(): void {
    for (const control of this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]')) {
      const key = control.dataset.setting as keyof GameSettings;
      const value = this.settings[key];
      if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = Boolean(value);
      else control.value = String(value);
    }
    this.query<HTMLOutputElement>('[data-output="fieldOfView"]').value = `${Math.round(this.settings.fieldOfView)}°`;
    this.query<HTMLOutputElement>('[data-output="lookSensitivity"]').value = `${Math.round(this.settings.lookSensitivity * 100)}%`;
    this.query<HTMLOutputElement>('[data-output="masterVolume"]').value = `${Math.round(this.settings.masterVolume * 100)}%`;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-binding]')) {
      const action = button.dataset.binding as ControlAction;
      const key = button.querySelector<HTMLElement>('[data-binding-value]');
      if (key) key.textContent = formatKeyLabel(this.settings.controls[action]);
      button.setAttribute('aria-label', `${bindingLabels[action]} : ${formatKeyLabel(this.settings.controls[action])}`);
    }
    const preset = detectKeyboardPreset(this.settings.controls);
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-control-preset]')) {
      const active = button.dataset.controlPreset === preset;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    this.interactionPrompt.querySelector('kbd')!.textContent = formatKeyLabel(this.settings.controls.interact);
  }

  private applySettingsPresentation(): void {
    this.root.classList.toggle('menu-motion-disabled', !this.settings.menuMotion);
    this.root.classList.toggle('crosshair-disabled', !this.settings.crosshair);
  }

  private commitSettings(): void {
    saveGameSettings(this.settings);
    this.applySettingsPresentation();
    this.root.classList.add('is-applying-settings');
    void Promise.resolve(this.actions.settingsChanged({ ...this.settings }))
      .catch(() => {
        this.setSettingsProgress(0, 'Impossible d’appliquer ce réglage');
        window.setTimeout(() => this.setSettingsProgress(null), 2400);
      })
      .finally(() => this.root.classList.remove('is-applying-settings'));
  }

  private readonly onSettingInput = (event: Event): void => {
    const control = event.currentTarget as HTMLInputElement | HTMLSelectElement;
    const key = control.dataset.setting as keyof GameSettings;
    if (key === 'menuMotion' || key === 'cameraMotion' || key === 'crosshair') {
      this.settings = { ...this.settings, [key]: (control as HTMLInputElement).checked };
    } else if (key === 'fieldOfView' || key === 'lookSensitivity' || key === 'masterVolume') {
      this.settings = { ...this.settings, [key]: Number(control.value) };
    } else {
      this.settings = { ...this.settings, [key]: control.value } as GameSettings;
    }
    this.syncSettingsControls();
    this.commitSettings();
  };

  private readonly resetSettings = (): void => {
    this.cancelBinding();
    this.settings = defaultGameSettings();
    this.syncSettingsControls();
    this.commitSettings();
  };

  private readonly onMenuKeyDown = (event: KeyboardEvent): void => {
    if (this.overlay.getAttribute('aria-hidden') === 'true' || this.isConsoleOpen) return;
    if (!this.confirmation.hidden) {
      if (event.code === 'Escape') {
        event.preventDefault();
        this.closeConfirmation();
        return;
      }
      if (event.key === 'Tab') {
        const first = this.confirmationCancel;
        const last = this.confirmationAccept;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
      return;
    }
    if (this.pendingBinding) {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === 'Escape') {
        this.cancelBinding();
        return;
      }
      const code = controlCodeFromKeyboardEvent(event);
      if (event.repeat || !isBindableCode(code)) return;
      this.commitBinding(code);
      return;
    }
    if (event.key === 'Tab') {
      const focusable = [...this.root.querySelectorAll<HTMLElement>(
        `[data-page="${this.activePage}"] button:not(:disabled):not([hidden]), ` +
        `[data-page="${this.activePage}"] select:not(:disabled), ` +
        `[data-page="${this.activePage}"] input:not(:disabled)`,
      )].filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (event.code !== 'Escape') return;
    if (this.activePage !== 'home') {
      event.preventDefault();
      this.showPage('home');
      return;
    }
    if (this.root.classList.contains('is-paused') && this.readyState) {
      event.preventDefault();
      this.actions.enter();
    }
  };

  private readonly requestNewGame = (): void => {
    this.showConfirmation(
      'Commencer une nouvelle partie ?',
      'Toute progression non sauvegardée dans la partie actuelle sera perdue.',
      'Nouvelle partie',
      this.actions.regenerate,
    );
  };

  private readonly requestMainMenu = (): void => {
    this.showConfirmation(
      'Retourner au menu principal ?',
      'La progression actuelle sera sauvegardée avant de quitter la partie.',
      'Quitter la partie',
      this.actions.returnToMainMenu,
    );
  };

  private showConfirmation(
    title: string,
    message: string,
    acceptLabel: string,
    action: () => void,
  ): void {
    this.pendingConfirmation = action;
    this.confirmationTitle.textContent = title;
    this.confirmationMessage.textContent = message;
    this.confirmationAccept.textContent = acceptLabel;
    this.confirmation.hidden = false;
    this.confirmation.setAttribute('aria-hidden', 'false');
    this.root.classList.add('confirmation-open');
    this.overlay.inert = true;
    requestAnimationFrame(() => this.confirmationCancel.focus({ preventScroll: true }));
  }

  private readonly closeConfirmation = (): void => {
    this.pendingConfirmation = undefined;
    this.confirmation.hidden = true;
    this.confirmation.setAttribute('aria-hidden', 'true');
    this.root.classList.remove('confirmation-open');
    this.overlay.inert = false;
  };

  private readonly acceptConfirmation = (): void => {
    const action = this.pendingConfirmation;
    this.closeConfirmation();
    action?.();
  };

  private startBinding(action: ControlAction, button: HTMLButtonElement): void {
    this.cancelBinding();
    this.pendingBinding = action;
    this.pendingBindingButton = button;
    button.classList.add('listening');
    button.setAttribute('aria-pressed', 'true');
    const key = button.querySelector<HTMLElement>('[data-binding-value]');
    if (key) key.textContent = '…';
    this.query('[data-ui="binding-help"]').textContent = `Nouvelle touche pour « ${bindingLabels[action]} »`;
  }

  private cancelBinding(): void {
    if (!this.pendingBinding) return;
    this.pendingBindingButton?.classList.remove('listening');
    this.pendingBindingButton?.removeAttribute('aria-pressed');
    this.pendingBinding = undefined;
    this.pendingBindingButton = undefined;
    this.query('[data-ui="binding-help"]').textContent = 'Sélectionnez une commande, puis appuyez sur une touche.';
    this.syncSettingsControls();
  }

  private commitBinding(code: string): void {
    const action = this.pendingBinding;
    if (!action) return;
    const remapped = remapControlBinding(this.settings.controls, action, code);
    this.settings = { ...this.settings, controls: remapped.bindings };
    this.pendingBindingButton?.classList.remove('listening');
    this.pendingBindingButton?.removeAttribute('aria-pressed');
    this.pendingBinding = undefined;
    this.pendingBindingButton = undefined;
    this.query('[data-ui="binding-help"]').textContent = remapped.swappedAction
      ? 'Touches échangées pour éviter un conflit.'
      : 'Commande mise à jour.';
    this.syncSettingsControls();
    this.commitSettings();
  }

  private applyControlPreset(preset: KeyboardPreset): void {
    this.cancelBinding();
    this.settings = { ...this.settings, controls: defaultControlBindings(preset) };
    this.syncSettingsControls();
    this.commitSettings();
  }

  private readonly onFullscreenChange = (): void => {
    const label = this.query('[data-ui="fullscreen-label"]');
    label.textContent = document.fullscreenElement ? 'Désactiver' : 'Activer';
  };

  private appendMessages(messages: readonly ConsoleMessage[]): void {
    if (messages.length === 0) return;
    for (const message of messages) {
      const line = document.createElement('p');
      line.className = `chat-message ${message.kind}`;
      line.textContent = message.text;
      this.consoleMessages.append(line);
    }
    while (this.consoleMessages.childElementCount > 80) {
      this.consoleMessages.firstElementChild?.remove();
    }
    this.consoleHistory.scrollTop = this.consoleHistory.scrollHeight;
    this.root.classList.add('has-chat-message');
    if (this.chatFadeTimer !== undefined) window.clearTimeout(this.chatFadeTimer);
    this.chatFadeTimer = window.setTimeout(() => {
      this.chatFadeTimer = undefined;
      if (!this.isConsoleOpen) this.root.classList.remove('has-chat-message');
    }, 6500);
  }

  private renderSuggestions(selectedIndex = -1): void {
    this.consoleSuggestions.replaceChildren();
    for (const [index, suggestion] of this.completionSuggestions.entries()) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'console-suggestion';
      row.classList.toggle('selected', index === selectedIndex);
      const command = document.createElement('code');
      command.textContent = suggestion.label;
      const detail = document.createElement('span');
      detail.textContent = suggestion.detail;
      row.append(command, detail);
      row.addEventListener('mousedown', (event) => {
        event.preventDefault();
        this.consoleInput.value = suggestion.value;
        this.completionIndex = index;
        if (suggestion.value.endsWith(' ')) this.updateSuggestions();
        else {
          this.renderSuggestions(index);
          this.consoleHint.textContent = suggestion.detail;
        }
        this.consoleInput.focus();
        this.consoleInput.setSelectionRange(suggestion.value.length, suggestion.value.length);
      });
      this.consoleSuggestions.append(row);
    }
    this.consoleSuggestions.classList.toggle('visible', this.completionSuggestions.length > 0);
  }

  private updateSuggestions(): void {
    this.completionSource = this.consoleInput.value;
    this.completionIndex = -1;
    const completion = this.actions.completeConsole(this.completionSource, this.consoleMode);
    this.completionSuggestions = completion?.suggestions ?? [];
    if (completion) this.consoleHint.textContent = completion.hint;
    else if (this.completionSource.startsWith('/')) {
      this.consoleHint.textContent = 'AUCUNE COMMANDE OU CIBLE NE CORRESPOND';
    } else {
      this.consoleHint.textContent = this.consoleMode === 'chat'
        ? 'ENTRÉE ENVOIE LE MESSAGE SOUS LA FORME me: message'
        : 'UNE COMMANDE DOIT COMMENCER PAR /';
    }
    this.renderSuggestions();
  }

  showFall(): void {
    this.fallFlash.classList.remove('visible');
    void this.fallFlash.offsetWidth;
    this.fallFlash.classList.add('visible');
  }

  showConsoleMessage(message: ConsoleMessage): void {
    this.appendMessages([message]);
  }

  showError(message: string): void {
    const error = this.query('[data-ui="error"]');
    error.textContent = message;
    error.classList.add('visible');
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onMenuKeyDown);
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    if (this.chatFadeTimer !== undefined) window.clearTimeout(this.chatFadeTimer);
    if (this.saveStatusTimer !== undefined) window.clearTimeout(this.saveStatusTimer);
    this.root.remove();
  }

  private query<T extends HTMLElement = HTMLElement>(selector: string): T {
    const result = this.root.querySelector<T>(selector);
    if (!result) throw new Error(`Missing UI element: ${selector}`);
    return result;
  }

  private readonly resetCompletion = (): void => {
    this.completionSource = '';
    this.completionIndex = -1;
    this.completionSuggestions = [];
  };

  private readonly onConsoleInput = (): void => {
    this.historyIndex = this.submittedInputs.length;
    this.historyDraft = this.consoleInput.value;
    this.updateSuggestions();
  };

  private navigateInputHistory(direction: -1 | 1): void {
    if (this.submittedInputs.length === 0) return;
    if (this.historyIndex === this.submittedInputs.length) this.historyDraft = this.consoleInput.value;
    this.historyIndex = Math.min(
      this.submittedInputs.length,
      Math.max(0, this.historyIndex + direction),
    );
    this.consoleInput.value = this.historyIndex === this.submittedInputs.length
      ? this.historyDraft
      : this.submittedInputs[this.historyIndex]!;
    this.updateSuggestions();
    const end = this.consoleInput.value.length;
    this.consoleInput.setSelectionRange(end, end);
  }

  private readonly onConsoleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape') {
      event.preventDefault();
      this.closeConsole();
      return;
    }
    if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
      event.preventDefault();
      this.navigateInputHistory(event.code === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (event.code === 'Tab') {
      event.preventDefault();
      if (this.completionSuggestions.length === 0) this.updateSuggestions();
      if (this.completionSuggestions.length === 0) {
        this.consoleHint.textContent = 'AUCUNE SUGGESTION POUR CETTE SAISIE';
        return;
      }
      this.completionIndex = (this.completionIndex + 1) % this.completionSuggestions.length;
      const suggestion = this.completionSuggestions[this.completionIndex]!;
      this.consoleInput.value = suggestion.value;
      if (suggestion.value.endsWith(' ')) this.updateSuggestions();
      else {
        this.consoleHint.textContent = `${suggestion.detail} [${this.completionIndex + 1}/${this.completionSuggestions.length}]`;
        this.renderSuggestions(this.completionIndex);
      }
      const end = this.consoleInput.value.length;
      this.consoleInput.setSelectionRange(end, end);
      return;
    }
    if (event.code !== 'Enter') return;
    event.preventDefault();
    const value = this.consoleInput.value.trim();
    if (value.length === 0) {
      this.closeConsole();
      return;
    }
    this.submittedInputs.push(value);
    if (this.submittedInputs.length > 60) this.submittedInputs.shift();
    this.historyIndex = this.submittedInputs.length;
    const result = this.actions.submitConsole(value, this.consoleMode);
    this.appendMessages(result.messages);
    this.consoleHint.textContent = result.feedback;
    if (result.close) this.closeConsole();
    else {
      this.consoleInput.focus();
      this.consoleInput.select();
      this.updateSuggestions();
      this.consoleHint.textContent = result.feedback;
    }
  };
}
