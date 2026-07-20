import type { RoomKind, WorldPlan } from '../world/types';
import { fingerprintWorld } from '../world/generateWorld';

interface UIActions {
  enter(): void;
  regenerate(): void;
  toggleFullscreen(): void;
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

const roomLabels: Record<RoomKind, string> = {
  office: 'Bureaux partitionnés',
  corridor: 'Couloir de liaison',
  'open-hall': 'Hall à piliers',
  nested: 'Salles imbriquées',
  threshold: 'Galerie de seuils',
  sparse: 'Zone silencieuse',
  'pit-gallery': 'Quadrillage inférieur',
  'lower-maze': 'Sous-niveau moquetté',
  'vista-hall': 'Hall à plafond démesuré',
};

export class ExperienceUI {
  private readonly root: HTMLElement;
  private readonly loadingLabel: HTMLElement;
  private readonly loadingFill: HTMLElement;
  private readonly enterButton: HTMLButtonElement;
  private readonly overlay: HTMLElement;
  private readonly roomLabel: HTMLElement;
  private readonly fpsLabel: HTMLElement;
  private readonly fallFlash: HTMLElement;
  private readonly interactionPrompt: HTMLElement;
  private readonly consolePanel: HTMLElement;
  private readonly consoleHistory: HTMLElement;
  private readonly consoleMessages: HTMLElement;
  private readonly consoleSuggestions: HTMLElement;
  private readonly consoleInput: HTMLInputElement;
  private readonly consoleHint: HTMLElement;
  private readonly consoleModeLabel: HTMLElement;
  private readonly actions: UIActions;
  private readyState = false;
  private enteredOnce = false;
  private interactionLabel: string | null = null;
  private consoleMode: ConsoleMode = 'command';
  private completionSource = '';
  private completionIndex = -1;
  private completionSuggestions: ConsoleSuggestion[] = [];
  private readonly submittedInputs: string[] = [];
  private historyIndex = 0;
  private historyDraft = '';
  private chatFadeTimer?: number;

  constructor(container: HTMLElement, plan: WorldPlan, actions: UIActions, displaySeed = plan.seed) {
    this.actions = actions;
    const fingerprint = fingerprintWorld(plan);
    this.root = document.createElement('div');
    this.root.className = 'experience-ui';
    this.root.innerHTML = `
      <div class="atmosphere-overlay" aria-hidden="true">
        <div class="scanlines"></div>
        <div class="noise-layer"></div>
        <div class="edge-shadow"></div>
      </div>

      <section class="entry-overlay" data-ui="overlay" aria-label="Menu principal">
        <div class="entry-card">
          <header class="entry-header">
            <div class="archive-mark" aria-hidden="true"><span></span><span></span><span></span></div>
            <p class="eyebrow">ARCHIVE L–0 <i></i> SESSION ${fingerprint.toUpperCase()}</p>
          </header>
          <div class="title-lockup">
            <p class="pretitle">THRESHOLD</p>
            <h1>ZERO</h1>
            <p class="level-index">LEVEL <strong>0</strong></p>
          </div>
          <p class="manifesto">Un espace de bureaux qui ne se souvient plus de son plan. Aucun objectif. Aucun témoin. Seulement la lumière et la moquette humide.</p>

          <div class="world-metrics" aria-label="Propriétés du monde infini">
            <div><span>∞</span><small>étendue explorable</small></div>
            <div><span>SEED</span><small>topologie persistante</small></div>
            <div><span>LIVE</span><small>génération continue</small></div>
          </div>

          <div class="loading-block" data-ui="loading">
            <div class="loading-row"><span data-ui="loading-label">INITIALISATION DU SIGNAL</span><b>WEBGL / PBR</b></div>
            <div class="loading-track"><i data-ui="loading-fill"></i></div>
          </div>

          <div class="controls-strip" aria-label="Commandes">
            <span><kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd> marcher</span>
            <span><kbd>⇧</kbd> accélérer</span>
            <span><kbd>CTRL</kbd> s'accroupir</span>
            <span><kbd>E</kbd> interagir</span>
            <span><kbd>C</kbd> chat</span>
            <span><kbd>H</kbd> console</span>
            <span><span class="mouse-icon">◉</span> regarder</span>
          </div>

          <button class="enter-button" type="button" data-ui="enter" disabled>
            <span data-ui="enter-copy">CHARGEMENT</span>
            <i aria-hidden="true">→</i>
          </button>
          <div class="entry-actions">
            <button type="button" data-ui="regenerate">Nouvelle dérive</button>
            <button type="button" data-ui="fullscreen">Plein écran</button>
            <code>${displaySeed}</code>
          </div>
          <p class="entry-note">Casque recommandé · Échap libère la souris · Aucun monstre dans cette version</p>
        </div>
      </section>

      <section class="hud" data-ui="hud" aria-hidden="true">
        <div class="hud-status">
          <span class="signal-dot"></span>
          <div><small>LOCALISATION APPROX.</small><strong data-ui="room">SEUIL INCONNU</strong></div>
        </div>
        <div class="hud-seed"><small>SEED</small><code>${displaySeed}</code></div>
        <div class="reticle" aria-hidden="true"><i></i><b></b><span></span><em></em></div>
        <div class="interaction-prompt" data-ui="interaction" aria-hidden="true"><kbd>E</kbd><span></span></div>
        <section class="command-console" data-ui="console" aria-hidden="true">
          <div class="console-shell">
            <div class="chat-history" data-ui="chat-history" aria-live="polite">
              <div class="chat-messages" data-ui="chat-messages"></div>
            </div>
            <div class="console-suggestions" data-ui="console-suggestions" aria-label="Suggestions de commandes"></div>
            <div class="console-input-row">
              <span data-ui="console-mode">/</span>
              <input data-ui="console-input" type="text" spellcheck="false" autocomplete="off" maxlength="180" aria-label="Chat et commandes" />
            </div>
            <small data-ui="console-hint"></small>
          </div>
        </section>
        <div class="hud-bottom">
          <span>THRESHOLD ZERO // BUILD 0.${plan.version}</span>
          <span data-ui="fps">-- FPS</span>
          <span>ÉCHAP — PAUSE</span>
        </div>
      </section>

      <div class="fall-flash" data-ui="fall"><span>PERDU DANS LE VIDE</span></div>
      <div class="fatal-error" data-ui="error" role="alert"></div>
    `;
    container.append(this.root);

    this.loadingLabel = this.query('[data-ui="loading-label"]');
    this.loadingFill = this.query('[data-ui="loading-fill"]');
    this.enterButton = this.query<HTMLButtonElement>('[data-ui="enter"]');
    this.overlay = this.query('[data-ui="overlay"]');
    this.roomLabel = this.query('[data-ui="room"]');
    this.fpsLabel = this.query('[data-ui="fps"]');
    this.fallFlash = this.query('[data-ui="fall"]');
    this.interactionPrompt = this.query('[data-ui="interaction"]');
    this.consolePanel = this.query('[data-ui="console"]');
    this.consoleHistory = this.query('[data-ui="chat-history"]');
    this.consoleMessages = this.query('[data-ui="chat-messages"]');
    this.consoleSuggestions = this.query('[data-ui="console-suggestions"]');
    this.consoleInput = this.query<HTMLInputElement>('[data-ui="console-input"]');
    this.consoleHint = this.query('[data-ui="console-hint"]');
    this.consoleModeLabel = this.query('[data-ui="console-mode"]');
    this.enterButton.addEventListener('click', actions.enter);
    this.query('[data-ui="regenerate"]').addEventListener('click', actions.regenerate);
    this.query('[data-ui="fullscreen"]').addEventListener('click', actions.toggleFullscreen);
    this.consoleInput.addEventListener('keydown', this.onConsoleKeyDown);
    this.consoleInput.addEventListener('input', this.onConsoleInput);
  }

  setLoading(progress: number, label: string): void {
    this.loadingLabel.textContent = label.toUpperCase();
    this.loadingFill.style.transform = `scaleX(${Math.min(1, Math.max(0.025, progress))})`;
  }

  setReady(): void {
    this.readyState = true;
    this.setLoading(1, 'SIGNAL STABLE');
    this.enterButton.disabled = false;
    this.query('[data-ui="enter-copy"]').textContent = 'ENTRER DANS LE LEVEL 0';
    this.root.classList.add('is-ready');
  }

  setLocked(locked: boolean): void {
    if (!locked) this.closeConsole();
    if (locked) this.enteredOnce = true;
    this.root.classList.toggle('is-playing', locked);
    this.overlay.setAttribute('aria-hidden', String(locked));
    if (!locked && this.readyState && this.enteredOnce) {
      this.query('[data-ui="enter-copy"]').textContent = 'REPRENDRE L’EXPLORATION';
      this.root.classList.add('is-paused');
    } else if (locked) {
      this.root.classList.remove('is-paused');
    }
  }

  update(room: RoomKind, fps: number): void {
    this.roomLabel.textContent = roomLabels[room].toUpperCase();
    this.fpsLabel.textContent = `${Math.round(fps).toString().padStart(2, '0')} FPS`;
  }

  setInteraction(label: string | null): void {
    if (label === this.interactionLabel) return;
    this.interactionLabel = label;
    const visible = Boolean(label);
    this.interactionPrompt.classList.toggle('visible', visible);
    this.interactionPrompt.setAttribute('aria-hidden', String(!visible));
    this.interactionPrompt.querySelector('span')!.textContent = label ?? '';
  }

  get isConsoleOpen(): boolean {
    return this.root.classList.contains('is-console-open');
  }

  openConsole(mode: ConsoleMode): void {
    this.consoleMode = mode;
    this.consolePanel.dataset.mode = mode;
    this.consoleModeLabel.textContent = mode === 'command' ? '/' : 'me:';
    this.consoleInput.value = mode === 'command' ? '/' : '';
    this.consoleHint.textContent = mode === 'command'
      ? 'ÉCRIS /HELP OU /LOCATE · TAB COMPLÈTE · ↑↓ HISTORIQUE'
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
    else if (this.completionSource.trimStart().startsWith('/')) {
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

  showError(message: string): void {
    const error = this.query('[data-ui="error"]');
    error.textContent = message;
    error.classList.add('visible');
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
    if (this.historyIndex === this.submittedInputs.length) {
      this.historyDraft = this.consoleInput.value;
    }
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
      if (suggestion.value.endsWith(' ')) {
        this.updateSuggestions();
      } else {
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
    if (result.close) {
      this.closeConsole();
    } else {
      this.consoleInput.focus();
      this.consoleInput.select();
      this.updateSuggestions();
      this.consoleHint.textContent = result.feedback;
    }
  };
}
