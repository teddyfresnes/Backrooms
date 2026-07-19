import type { RoomKind, WorldPlan } from '../world/types';
import { fingerprintWorld } from '../world/generateWorld';

interface UIActions {
  enter(): void;
  regenerate(): void;
  toggleFullscreen(): void;
  submitConsole(value: string, mode: ConsoleMode): ConsoleSubmitResult;
  completeConsole(value: string, cycleIndex: number, mode: ConsoleMode): ConsoleCompletion | null;
  consoleVisibility(open: boolean): void;
}

export type ConsoleMode = 'command' | 'chat';

export interface ConsoleCompletion {
  value: string;
  hint: string;
  count: number;
}

export interface ConsoleSubmitResult {
  close: boolean;
  feedback: string;
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
  private readonly consoleInput: HTMLInputElement;
  private readonly consoleHint: HTMLElement;
  private readonly consoleModeLabel: HTMLElement;
  private readonly actions: UIActions;
  private readyState = false;
  private enteredOnce = false;
  private interactionLabel: string | null = null;
  private consoleMode: ConsoleMode = 'command';
  private completionSource = '';
  private completionIndex = 0;

  constructor(container: HTMLElement, plan: WorldPlan, actions: UIActions, displaySeed = plan.seed) {
    this.actions = actions;
    const fingerprint = fingerprintWorld(plan);
    const liveLights = plan.lights.filter((light) => !light.dead).length;
    const anomalies = plan.features.length;
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

          <div class="world-metrics" aria-label="Informations de génération">
            <div><span>${plan.rooms.length.toString().padStart(2, '0')}</span><small>secteurs</small></div>
            <div><span>${liveLights.toString().padStart(3, '0')}</span><small>néons actifs</small></div>
            <div><span>${anomalies.toString().padStart(2, '0')}</span><small>anomalies</small></div>
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
            <span data-ui="console-mode">COMMAND</span>
            <input data-ui="console-input" type="text" spellcheck="false" autocomplete="off" aria-label="Console" />
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
    this.consoleInput = this.query<HTMLInputElement>('[data-ui="console-input"]');
    this.consoleHint = this.query('[data-ui="console-hint"]');
    this.consoleModeLabel = this.query('[data-ui="console-mode"]');
    this.enterButton.addEventListener('click', actions.enter);
    this.query('[data-ui="regenerate"]').addEventListener('click', actions.regenerate);
    this.query('[data-ui="fullscreen"]').addEventListener('click', actions.toggleFullscreen);
    this.consoleInput.addEventListener('keydown', this.onConsoleKeyDown);
    this.consoleInput.addEventListener('input', this.resetCompletion);
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
    this.consoleModeLabel.textContent = mode === 'command' ? 'COMMAND' : 'CHAT';
    this.consoleInput.value = mode === 'command' ? '/' : '';
    this.consoleHint.textContent = mode === 'command'
      ? 'TAB complete /locate, ENTREE execute'
      : 'ENTREE envoie, /locate marche aussi ici';
    this.resetCompletion();
    this.root.classList.add('is-console-open');
    this.consolePanel.setAttribute('aria-hidden', 'false');
    this.actions.consoleVisibility(true);
    requestAnimationFrame(() => {
      this.consoleInput.focus();
      const end = this.consoleInput.value.length;
      this.consoleInput.setSelectionRange(end, end);
    });
  }

  closeConsole(): void {
    if (!this.isConsoleOpen) return;
    this.root.classList.remove('is-console-open');
    this.consolePanel.setAttribute('aria-hidden', 'true');
    this.consoleInput.blur();
    this.actions.consoleVisibility(false);
    this.resetCompletion();
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
    this.completionIndex = 0;
  };

  private readonly onConsoleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape') {
      event.preventDefault();
      this.closeConsole();
      return;
    }

    if (event.code === 'Tab') {
      event.preventDefault();
      if (this.completionSource === this.consoleInput.value) this.completionIndex += 1;
      else {
        this.completionSource = this.consoleInput.value;
        this.completionIndex = 0;
      }
      const completion = this.actions.completeConsole(
        this.completionSource,
        this.completionIndex,
        this.consoleMode,
      );
      if (!completion) {
        this.consoleHint.textContent = 'AUCUNE CIBLE /LOCATE DANS LES CHUNKS ACTIFS';
        return;
      }
      this.consoleInput.value = completion.value;
      this.consoleHint.textContent = `${completion.hint} [${(this.completionIndex % completion.count) + 1}/${completion.count}]`;
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
    const result = this.actions.submitConsole(value, this.consoleMode);
    this.consoleHint.textContent = result.feedback;
    if (result.close) this.closeConsole();
  };
}
