import * as THREE from 'three';
import { AudioSystem } from '../audio/AudioSystem';
import { describeViewDirection, resolveDiagnosticsVisibility } from './Diagnostics';
import type { DiagnosticsSnapshot, PlayerDiagnostics, SystemDiagnostics } from './Diagnostics';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { PlayerController } from '../player/PlayerController';
import { AdaptiveRenderScale, renderScaleLimits } from '../render/AdaptiveQuality';
import type { RenderScaleLimits } from '../render/AdaptiveQuality';
import {
  BACKROOMS_ATMOSPHERE as ATMOSPHERE,
  BACKROOMS_LEGACY_ATMOSPHERE as LEGACY_ATMOSPHERE,
} from '../render/BackroomsAtmosphere';
import { MaterialLibrary } from '../render/MaterialLibrary';
import { PostFX } from '../render/PostFX';
import { ExperienceUI } from '../ui/ExperienceUI';
import type { ConsoleCompletion, ConsoleMode, ConsoleSubmitResult } from '../ui/ExperienceUI';
import { loadGameSettings, type GameSettings } from '../ui/settings';
import { createReadableSeed } from '../world/SeededRandom';
import { fingerprintWorld, validateWorldPlan } from '../world/generateWorld';
import {
  generateInfiniteChunk,
  getChunkWorldOffset,
} from '../world/InfiniteWorld';
import type { DoorOpenMode, VisualBiome, WorldPlan } from '../world/types';
import { streamChunkCoordAt, WorldStream } from './WorldStream';
import type { LocateTarget } from './WorldStream';
import {
  getGameSaveSummary,
  listGameSaves,
  writeGameSave,
  type BackroomsGameSave,
  type GameSaveKind,
  type GameSaveStorage,
} from './SaveHistory';

export type DebugExperience = DiagnosticsSnapshot;

declare global {
  interface Window {
    __BACKROOMS__?: DebugExperience;
  }
}

const resolveSeed = (): string => {
  const url = new URL(window.location.href);
  const supplied = url.searchParams.get('seed')?.trim();
  if (supplied) {
    return supplied.slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, '-');
  }
  sessionStorage.removeItem('threshold-zero-seed');
  sessionStorage.removeItem('threshold-zero-auto-seed');
  // Automatic sessions deliberately leave the URL untouched: refreshing or
  // reopening the game produces a new world. A manually supplied ?seed=...
  // remains the explicit reproducibility path.
  return createReadableSeed();
};

export interface GameOptions {
  onRequestContinue?(): void;
  onRequestNewGame?(): void;
  onRequestMainMenu?(): void;
  onRequestLoadGame?(id: string): void;
  launch?:
    | { readonly kind: 'new' }
    | { readonly kind: 'load'; readonly save: BackroomsGameSave };
  autosaveOnReady?: boolean;
  autoEnterOnReady?: boolean;
}

const AUTOSAVE_INTERVAL_SECONDS = 30;

export class Game {
  readonly plan: WorldPlan;
  private readonly seed: string;
  private readonly root: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(72, 1, 0.04, 180);
  private readonly backgroundColor = new THREE.Color(ATMOSPHERE.yellow.background);
  private readonly fog = new THREE.FogExp2(ATMOSPHERE.yellow.fog, 0.0015);
  private readonly hemisphere = new THREE.HemisphereLight(
    ATMOSPHERE.yellow.hemisphereSky,
    ATMOSPHERE.yellow.hemisphereGround,
    0.14,
  );
  private readonly ambientFill = new THREE.AmbientLight(ATMOSPHERE.yellow.ambient, 0.055);
  private readonly directionalKey = new THREE.DirectionalLight(ATMOSPHERE.yellow.key, 0.22);
  private readonly atmosphereTargetColor = new THREE.Color();
  private readonly ui: ExperienceUI;
  private readonly audio = new AudioSystem();
  private readonly lookDirection = new THREE.Vector3();
  private readonly lastSafePosition = new THREE.Vector3();
  private readonly drawingBufferSize = new THREE.Vector2();
  private readonly cinematicPosition = new THREE.Vector3();
  private readonly cinematicEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly originFingerprint: string;
  private readonly cinematicPhase: number;
  private readonly systemDiagnostics: SystemDiagnostics;
  private readonly renderScale: RenderScaleLimits;
  private settings: GameSettings;
  private readonly storage: GameSaveStorage | null;
  private materials?: MaterialLibrary;
  private worldStream?: WorldStream;
  private physics?: PhysicsWorld;
  private player?: PlayerController;
  private postFX?: PostFX;
  private previousTime = performance.now();
  private accumulator = 0;
  private elapsed = 0;
  private playableSeconds = 0;
  private autosaveElapsed = 0;
  private activeStory = 0;
  private pendingAutosaveStory?: number;
  private fps = 60;
  private frameTimeMs = 1000 / 60;
  private frameCounter = 0;
  private metricsTimer = 0;
  private darkness = 0;
  private pixelRatio: number;
  private readonly adaptiveRenderScale: AdaptiveRenderScale;
  private cinematicStartedAt = 0;
  private wasMainMenuOpen = false;
  private locateRequestId = 0;
  private diagnosticsVisible = false;
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: GameOptions = {},
  ) {
    this.settings = loadGameSettings();
    try {
      this.storage = window.localStorage;
    } catch {
      this.storage = null;
    }
    this.renderScale = renderScaleLimits(
      window.innerWidth,
      window.innerHeight,
      window.devicePixelRatio,
      matchMedia('(pointer: coarse)').matches,
    );
    this.adaptiveRenderScale = new AdaptiveRenderScale(this.renderScale);
    this.pixelRatio = this.pixelRatioForQuality(this.settings.renderQuality);
    this.seed = this.options.launch?.kind === 'load'
      ? this.options.launch.save.payload.seed
      : resolveSeed();
    this.plan = generateInfiniteChunk(this.seed, { x: 0, z: 0, story: 0 });
    this.originFingerprint = fingerprintWorld(this.plan);
    this.cinematicPhase = [...this.originFingerprint]
      .reduce((value, character) => (value * 31 + character.charCodeAt(0)) % 628, 0) / 100;
    const issues = validateWorldPlan(this.plan);
    if (issues.length > 0) throw new Error(`Plan invalide : ${issues.join(' ')}`);

    this.root = document.createElement('main');
    this.root.className = 'experience-root';
    this.container.append(this.root);
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: false,
    });
    this.renderer.domElement.className = 'world-canvas';
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = false;
    this.renderer.debug.checkShaderErrors = true;
    // The composer performs several renderer calls. Reset once per presented
    // frame so debug draw/triangle counts cover the whole pipeline.
    this.renderer.info.autoReset = false;
    this.systemDiagnostics = this.readSystemDiagnostics();
    this.root.append(this.renderer.domElement);
    this.renderer.domElement.addEventListener('click', this.onCanvasClick);

    this.ui = new ExperienceUI(this.root, {
      enter: () => this.enter(),
      regenerate: () => this.regenerate(),
      returnToMainMenu: () => {
        if (!this.options.onRequestContinue) this.saveNow('autosave');
        this.options.onRequestMainMenu?.();
      },
      saveGame: () => this.saveNow('manual'),
      loadGame: (id) => this.options.onRequestLoadGame?.(id),
      toggleFullscreen: () => void this.toggleFullscreen(),
      settingsChanged: (settings) => this.applySettings(settings),
      submitConsole: (value, mode) => this.submitConsole(value, mode),
      completeConsole: (value, mode) => this.completeConsole(value, mode),
      consoleVisibility: (open) => this.setConsoleVisibility(open),
    }, this.settings, 'backrooms');
    this.configureScene();
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onConsoleHotkey);
    window.addEventListener('pagehide', this.onPageHide);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  async initialize(): Promise<void> {
    const materials = await MaterialLibrary.load(this.renderer);
    if (this.disposed) {
      materials.dispose();
      return;
    }
    this.materials = materials;

    const physics = await PhysicsWorld.create(this.plan);
    if (this.disposed) {
      physics.dispose();
      return;
    }
    this.physics = physics;
    this.worldStream = new WorldStream(
      this.seed,
      this.plan,
      this.scene,
      this.materials.materialSets,
      this.physics,
      this.settings.lighting,
    );
    await this.worldStream.initialize();
    if (this.disposed) return;
    await this.worldStream.waitForVisualAssets();
    if (this.disposed) return;
    if (this.worldStream.getLightingMode() !== this.settings.lighting) {
      await this.worldStream.setLightingMode(this.settings.lighting);
      if (this.disposed) return;
    }
    this.camera.rotation.set(0, -Math.PI * 0.22, 0, 'YXZ');
    this.camera.fov = this.settings.fieldOfView;
    this.camera.updateProjectionMatrix();
    this.player = new PlayerController(this.camera, this.renderer.domElement, this.physics, {
      onLockChange: (locked) => this.onPlayerLockChange(locked),
      onFootstep: (strength) => this.audio.footstep(strength),
      onInteract: (mode) => this.tryInteract(mode),
      onLand: () => this.audio.impact(),
      onSafePosition: (position) => {
        this.lastSafePosition.set(position.x, position.y, position.z);
        this.worldStream?.protectRecoveryPosition(position);
        this.flushPendingLevelAutosave();
      },
      onFallReset: () => {
        if (this.player) this.worldStream?.ensurePositionMounted(this.player.position);
        this.audio.impact();
        this.ui.showFall();
      },
    });
    if (this.options.launch?.kind === 'load') {
      const { chunk, localPosition, quaternion } = this.options.launch.save.payload;
      const offset = getChunkWorldOffset(chunk);
      const restoredPosition = {
        x: offset.x + localPosition.x,
        y: offset.y + localPosition.y,
        z: offset.z + localPosition.z,
      };
      const destinationReady = await this.worldStream.prepareSavedChunk(chunk);
      if (this.disposed) return;
      if (!destinationReady) throw new Error('Impossible de préparer la sauvegarde sélectionnée.');
      this.player.teleport(restoredPosition);
      this.player.setLookQuaternion(quaternion);
      this.playableSeconds = this.options.launch.save.playTimeSeconds;
    }
    this.lastSafePosition.copy(this.player.position);

    // Mount every starting chunk before shader compilation so the first
    // interactive frame already contains the full visible architecture.
    this.worldStream.update(0, 0, this.player.position);
    this.activeStory = this.worldStream.getCenterCoord().story;
    if (this.options.launch?.kind === 'load') {
      await this.worldStream.waitForVisualAssets();
      if (this.disposed) return;
    }

    this.player.setFieldOfView(this.settings.fieldOfView);
    this.player.setLookSensitivity(this.settings.lookSensitivity);
    this.player.setCameraMotionEnabled(this.settings.cameraMotion);
    this.player.setControlBindings(this.settings.controls);
    this.cinematicPosition.copy(this.camera.position);
    this.cinematicEuler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.audio.setMasterVolume(this.settings.masterVolume);

    this.postFX = new PostFX(this.renderer, this.scene, this.camera, this.settings.lighting);
    this.resize();
    await this.renderer.compileAsync(this.scene, this.camera);
    if (this.disposed) return;
    // Warm every composer target behind the opaque loading overlay. The
    // post-processing pipeline has its own shader/target allocation that
    // renderer.compileAsync cannot cover; priming several presented frames
    // prevents black frames when the player first dismisses the overlay.
    await this.warmupPostFX();
    if (this.disposed) return;
    this.updateDebugState(true);
    this.syncSaveHistory();
    this.ui.setSessionStarted(true);
    this.ui.setReady();
    this.renderer.setAnimationLoop(this.frame);
    if (this.options.autosaveOnReady) this.saveNow('autosave');
    if (this.options.autoEnterOnReady) this.enter();
  }

  private configureScene(): void {
    this.scene.background = this.backgroundColor;
    this.scene.fog = this.fog;
    // Broad fill preserves visibility while a soft shadowless key lets PBR
    // normals reveal corners. Spatial blackouts stay in each chunk's shader.
    this.hemisphere.name = 'liminal-ambient-field';
    this.scene.add(this.hemisphere);
    this.ambientFill.name = 'indirect-carpet-bounce';
    this.scene.add(this.ambientFill);
    this.directionalKey.name = 'soft-fluorescent-key';
    this.directionalKey.position.set(4.5, 7.5, 3.2);
    this.directionalKey.castShadow = false;
    this.scene.add(this.directionalKey);
    this.applyAtmosphere(this.plan.visualBiome ?? 'yellow', 1);
  }

  private updateAtmosphere(delta: number): void {
    if (!this.worldStream || !this.player) return;
    const context = this.worldStream.getLightingContext(this.player.position);
    const blend = 1 - Math.exp(-Math.max(0, delta) * 1.6);
    this.applyAtmosphere(context.biome, blend);
    const legacy = this.settings.lighting === 'legacy';
    const darknessRate = context.darkness > this.darkness ? 1.25 : 2;
    const darknessBlend = 1 - Math.exp(-Math.max(0, delta) * darknessRate);
    this.darkness = THREE.MathUtils.lerp(this.darkness, context.darkness, darknessBlend);
    if (legacy) {
      this.hemisphere.intensity = 0.17;
      this.ambientFill.intensity = 0.018;
      this.directionalKey.intensity = 0.07;
      this.postFX?.setDarkness(0);
      return;
    }
    this.hemisphere.intensity = THREE.MathUtils.lerp(0.14, 0.07, this.darkness);
    this.ambientFill.intensity = THREE.MathUtils.lerp(0.055, 0.018, this.darkness);
    this.directionalKey.intensity = THREE.MathUtils.lerp(0.22, 0.08, this.darkness);
    this.postFX?.setDarkness(this.darkness);
  }

  private applyAtmosphere(biome: VisualBiome, blend: number): void {
    const legacy = this.settings.lighting === 'legacy';
    const target = (legacy ? LEGACY_ATMOSPHERE : ATMOSPHERE)[biome];
    this.backgroundColor.lerp(this.atmosphereTargetColor.setHex(target.background), blend);
    this.fog.color.lerp(this.atmosphereTargetColor.setHex(target.fog), blend);
    this.hemisphere.color.lerp(this.atmosphereTargetColor.setHex(target.hemisphereSky), blend);
    this.hemisphere.groundColor.lerp(
      this.atmosphereTargetColor.setHex(target.hemisphereGround),
      blend,
    );
    this.ambientFill.color.lerp(this.atmosphereTargetColor.setHex(target.ambient), blend);
    this.directionalKey.color.lerp(this.atmosphereTargetColor.setHex(target.key), blend);
    this.fog.density = legacy ? 0.0042 : 0.0015;
    this.directionalKey.position.set(legacy ? 3.5 : 4.5, legacy ? 8 : 7.5, legacy ? 2.5 : 3.2);
    if (legacy) {
      this.hemisphere.intensity = 0.17;
      this.ambientFill.intensity = 0.018;
      this.directionalKey.intensity = 0.07;
    } else {
      this.hemisphere.intensity = THREE.MathUtils.lerp(0.14, 0.07, this.darkness);
      this.ambientFill.intensity = THREE.MathUtils.lerp(0.055, 0.018, this.darkness);
      this.directionalKey.intensity = THREE.MathUtils.lerp(0.22, 0.08, this.darkness);
    }
  }

  private pixelRatioForQuality(quality: GameSettings['renderQuality']): number {
    if (quality === 'performance') return this.renderScale.min;
    if (quality === 'quality') return this.renderScale.max;
    return this.adaptiveRenderScale.value;
  }

  private async applySettings(next: GameSettings): Promise<void> {
    const previousLighting = this.settings.lighting;
    this.settings = { ...next };
    this.camera.fov = next.fieldOfView;
    this.camera.updateProjectionMatrix();
    this.player?.setFieldOfView(next.fieldOfView);
    this.player?.setLookSensitivity(next.lookSensitivity);
    this.player?.setCameraMotionEnabled(next.cameraMotion);
    this.player?.setControlBindings(next.controls);
    this.audio.setMasterVolume(next.masterVolume);

    const nextPixelRatio = this.pixelRatioForQuality(next.renderQuality);
    if (nextPixelRatio !== this.pixelRatio) {
      this.pixelRatio = nextPixelRatio;
      this.resize();
    }
    if (previousLighting === next.lighting || !this.worldStream || !this.postFX) {
      this.applyAtmosphere(this.worldStream?.getLightingContext(this.player?.position ?? this.camera.position).biome ?? 'yellow', 1);
      return;
    }

    this.ui.setSettingsProgress(0, 'Préparation de l’éclairage');
    this.postFX.setLightingMode(next.lighting);
    const biome = this.worldStream.getLightingContext(this.player?.position ?? this.camera.position).biome;
    this.applyAtmosphere(biome, 1);
    try {
      await this.worldStream.setLightingMode(next.lighting, ({ completed, total }) => {
        const progress = total === 0 ? 1 : completed / total;
        this.ui.setSettingsProgress(progress, next.lighting === 'legacy'
          ? 'Calcul de l’éclairage classique'
          : 'Restauration de l’éclairage moderne');
      });
      this.ui.setSettingsProgress(1, 'Éclairage appliqué');
      await new Promise<void>((resolve) => window.setTimeout(resolve, 180));
    } finally {
      this.ui.setSettingsProgress(null);
    }
    this.updateDebugState(true);
  }

  private readonly onPlayerLockChange = (locked: boolean): void => {
    this.ui.setLocked(locked);
    this.player?.setInputEnabled(locked);
    void this.audio.setSuspended(!locked || document.hidden);
    this.previousTime = performance.now();
    this.accumulator = 0;
  };

  private async warmupPostFX(): Promise<void> {
    if (!this.postFX) return;
    for (let frame = 0; frame < 3; frame += 1) {
      if (this.disposed || !this.postFX) return;
      this.postFX.render(1 / 60);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    this.previousTime = performance.now();
  }

  private enter(): void {
    if (this.options.onRequestContinue) {
      this.options.onRequestContinue();
      return;
    }
    this.ui.beginGameplay();
    this.player?.lock();
    void this.audio.start();
  }

  private tryInteract(mode: DoorOpenMode): void {
    if (!this.player || !this.worldStream || this.player.isTraversing || this.player.isNoclipEnabled) return;
    this.player.getViewDirection(this.lookDirection);
    const interaction = this.worldStream.getInteraction(this.player.position, this.lookDirection);
    if (!interaction) return;
    if (interaction.kind === 'door') {
      if (this.worldStream.openDoor(this.player.position, interaction, mode)) {
        this.ui.setInteraction(null);
      }
      return;
    }
    if (this.player.beginTraversal(
      interaction.path,
      interaction.duration,
      interaction.duckDepth,
    )) this.ui.setInteraction(null);
  }

  private regenerate(): void {
    if (this.options.onRequestNewGame) {
      this.options.onRequestNewGame();
      return;
    }
    const url = new URL(window.location.href);
    sessionStorage.removeItem('threshold-zero-auto-seed');
    sessionStorage.removeItem('threshold-zero-seed');
    url.searchParams.delete('seed');
    window.location.assign(url.toString());
  }

  private saveNow(kind: GameSaveKind): boolean {
    if (!this.storage || !this.player || !this.worldStream) return false;
    const chunk = this.worldStream.getCenterCoord();
    const offset = getChunkWorldOffset(chunk);
    const look = this.player.getLookQuaternion();
    const result = writeGameSave(this.storage, {
      experienceId: 'backrooms',
      kind,
      levelId: `backrooms-${chunk.story}`,
      levelLabel: `Niveau ${chunk.story} · Backrooms`,
      playTimeSeconds: this.playableSeconds,
      payload: {
        seed: this.seed,
        chunk,
        localPosition: {
          x: this.lastSafePosition.x - offset.x,
          y: this.lastSafePosition.y - offset.y,
          z: this.lastSafePosition.z - offset.z,
        },
        quaternion: { x: look.x, y: look.y, z: look.z, w: look.w },
      },
    });
    if (result.ok) {
      if (kind === 'autosave') this.autosaveElapsed = 0;
      this.syncSaveHistory();
    }
    return result.ok;
  }

  private syncSaveHistory(): void {
    const summaries = this.storage
      ? listGameSaves(this.storage).map(getGameSaveSummary)
      : [];
    this.ui.setSaveHistory(summaries);
  }

  private flushPendingLevelAutosave(): void {
    const pendingStory = this.pendingAutosaveStory;
    if (pendingStory === undefined || !this.worldStream) return;
    const center = this.worldStream.getCenterCoord();
    const safeCoord = streamChunkCoordAt(this.lastSafePosition);
    if (
      center.story !== pendingStory
      || safeCoord.story !== pendingStory
      || safeCoord.x !== center.x
      || safeCoord.z !== center.z
    ) return;
    this.pendingAutosaveStory = undefined;
    this.saveNow('autosave');
  }

  private async toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await this.root.requestFullscreen();
  }

  private setConsoleVisibility(open: boolean): void {
    this.player?.setInputEnabled(!open);
    if (open) this.ui.setInteraction(null);
  }

  private completeConsole(
    value: string,
    _mode: ConsoleMode,
  ): ConsoleCompletion | null {
    if (!value.startsWith('/')) return null;
    const trimmed = value.trim();
    const commandSuggestions = [
      { value: '/help', label: '/help', detail: 'AFFICHE LES COMMANDES DISPONIBLES' },
      { value: '/save', label: '/save', detail: 'SAUVEGARDE MAINTENANT' },
      { value: '/logs', label: '/logs', detail: 'AFFICHE OU MASQUE LE PANNEAU TECHNIQUE' },
      { value: '/noclip', label: '/noclip', detail: 'ACTIVE OU DESACTIVE LE VOL LIBRE' },
      { value: '/locate ', label: '/locate <cible>', detail: 'TÉLÉPORTE VERS UNE CIBLE CONNUE' },
    ];
    if (!trimmed.includes(' ')) {
      const normalized = trimmed.toLowerCase();
      const suggestions = commandSuggestions.filter((suggestion) =>
        suggestion.value.trim().startsWith(normalized),
      );
      return suggestions.length > 0
        ? { hint: `${suggestions.length} COMMANDE(S) DISPONIBLE(S)`, suggestions }
        : null;
    }
    if (/^\/logs(?:\s|$)/i.test(trimmed)) {
      const query = trimmed.replace(/^\/logs\s*/i, '').toLowerCase();
      const modes = [
        { value: '/logs on', label: 'on', detail: 'AFFICHE LE PANNEAU TECHNIQUE' },
        { value: '/logs off', label: 'off', detail: 'MASQUE LE PANNEAU TECHNIQUE' },
        { value: '/logs toggle', label: 'toggle', detail: 'BASCULE LE PANNEAU TECHNIQUE' },
      ].filter((suggestion) => suggestion.label.startsWith(query));
      return modes.length > 0
        ? { hint: 'CHOISIS UN ÉTAT · TAB POUR PARCOURIR', suggestions: modes }
        : null;
    }
    if (!/^\/locate(?:\s|$)/i.test(trimmed)) return null;
    const query = this.locateQueryFromInput(trimmed);
    const matches = this.locateMatches(query);
    if (matches.length === 0) return null;
    return {
      hint: `${matches.length} CIBLE(S) CONNUE(S) · TAB POUR PARCOURIR`,
      suggestions: matches.map((target) => ({
        value: `/locate ${target.command}`,
        label: target.command,
        detail: `${target.label.toUpperCase()} · ${Math.round(target.distance)} M`,
      })),
    };
  }

  private submitConsole(value: string, mode: ConsoleMode): ConsoleSubmitResult {
    const trimmed = value.trim();
    if (value.startsWith('/')) return this.executeCommand(trimmed);
    if (mode === 'command') {
      const feedback = 'UNE COMMANDE DOIT COMMENCER PAR /';
      return {
        close: false,
        feedback,
        messages: [{ kind: 'error', text: feedback }],
      };
    }
    return {
      close: true,
      feedback: 'MESSAGE ENVOYÉ',
      messages: [{ kind: 'chat', text: `me: ${trimmed}` }],
    };
  }

  private executeCommand(input: string): ConsoleSubmitResult {
    const [command = '', ...args] = input.slice(1).trim().split(/\s+/);
    const echo = { kind: 'command' as const, text: `> ${input}` };
    const normalizedCommand = command.toLowerCase();
    if (normalizedCommand === 'help') {
      if (args.length > 0) {
        const feedback = 'SYNTAXE: /help';
        return { close: false, feedback, messages: [echo, { kind: 'error', text: feedback }] };
      }
      const feedback = '/save - sauvegarder · /locate <cible> - teleportation · /noclip [on|off] - vol libre · /logs [on|off] - diagnostic';
      return { close: false, feedback, messages: [echo, { kind: 'system', text: feedback }] };
    }
    if (normalizedCommand === 'save') {
      const saved = args.length === 0 && this.saveNow('manual');
      const feedback = saved ? 'PARTIE SAUVEGARDÉE' : 'ÉCHEC DE LA SAUVEGARDE';
      return {
        close: saved,
        feedback,
        messages: [echo, { kind: saved ? 'system' : 'error', text: feedback }],
      };
    }
    if (normalizedCommand === 'logs') {
      const visible = resolveDiagnosticsVisibility(this.diagnosticsVisible, args);
      if (visible === null) {
        const feedback = 'SYNTAXE: /logs [on|off|toggle]';
        return { close: false, feedback, messages: [echo, { kind: 'error', text: feedback }] };
      }
      this.diagnosticsVisible = visible;
      this.ui.setDiagnosticsVisible(visible);
      this.updateDebugState(true);
      const feedback = visible ? 'PANNEAU TECHNIQUE AFFICHE' : 'PANNEAU TECHNIQUE MASQUE';
      return { close: true, feedback, messages: [echo, { kind: 'system', text: feedback }] };
    }
    if (normalizedCommand === 'noclip') {
      if (!this.player) {
        const feedback = 'JOUEUR NON PRET';
        return { close: false, feedback, messages: [echo, { kind: 'error', text: feedback }] };
      }
      const mode = args[0]?.toLowerCase();
      const enabled = args.length === 0 || mode === 'toggle'
        ? this.player.toggleNoclip()
        : ['on', '1', 'true', 'yes', 'oui'].includes(mode ?? '')
          ? this.player.setNoclipEnabled(true)
          : ['off', '0', 'false', 'no', 'non'].includes(mode ?? '')
            ? this.player.setNoclipEnabled(false)
            : null;
      if (args.length > 1 || enabled === null) {
        const feedback = 'SYNTAXE: /noclip [on|off]';
        return { close: false, feedback, messages: [echo, { kind: 'error', text: feedback }] };
      }
      const feedback = enabled
        ? 'NOCLIP ACTIVE: ZQSD/WASD + ESPACE/CTRL, SHIFT POUR ALLER PLUS VITE'
        : 'NOCLIP DESACTIVE';
      return { close: true, feedback, messages: [echo, { kind: 'system', text: feedback }] };
    }
    if (normalizedCommand !== 'locate') {
      const feedback = command
        ? `COMMANDE INCONNUE: /${command}. UTILISE /help.`
        : 'COMMANDE INCOMPLÈTE. UTILISE /help.';
      return { close: false, feedback, messages: [echo, { kind: 'error', text: feedback }] };
    }

    const query = args.join(' ').toLowerCase();
    if (!query) {
      const commands = this.locateMatches('').map((target) => target.command).join(', ');
      const feedback = commands
        ? `ARGUMENT MANQUANT. SYNTAXE: /locate <cible>. CIBLES: ${commands}`
        : 'AUCUNE CIBLE N’EST DISPONIBLE';
      return {
        close: false,
        feedback,
        messages: [echo, { kind: 'error', text: feedback }],
      };
    }

    const targets = this.locateMatches('');
    const target = targets.find((candidate) =>
      [candidate.command, ...candidate.aliases].some((alias) => alias.toLowerCase() === query),
    );
    if (!target) {
      const suggestions = this.locateMatches(query).slice(0, 5).map((candidate) => candidate.command);
      const feedback = suggestions.length > 0
        ? `CIBLE INVALIDE: ${query}. VOULAIS-TU DIRE: ${suggestions.join(', ')} ?`
        : `CIBLE INCONNUE: ${query}. UTILISE TAB APRÈS /locate.`;
      return { close: false, feedback, messages: [echo, { kind: 'error', text: feedback }] };
    }
    void this.teleportToLocateTarget(target);
    const feedback = `PRÉPARATION: ${target.label.toUpperCase()} · ${Math.round(target.distance)} M`;
    return { close: true, feedback, messages: [echo, { kind: 'system', text: feedback }] };
  }

  private locateQueryFromInput(value: string): string {
    return value.replace(/^\/locate\s*/i, '').trim().toLowerCase();
  }

  private locateMatches(query: string): LocateTarget[] {
    if (!this.worldStream || !this.player) return [];
    const normalized = query.trim().toLowerCase();
    const targets = this.worldStream.getLocateTargets(this.player.position);
    const scored = targets
      .map((target) => {
        const fields = [target.command, target.label, ...target.aliases].map((field) => field.toLowerCase());
        const exact = fields.some((field) => field === normalized);
        const starts = fields.some((field) => field.startsWith(normalized));
        const includes = fields.some((field) => field.includes(normalized));
        if (normalized && !exact && !starts && !includes) return null;
        return {
          target,
          score: exact ? 0 : starts ? 1 : includes ? 2 : 3,
        };
      })
      .filter((entry): entry is { target: LocateTarget; score: number } => entry !== null);
    scored.sort(
      (a, b) =>
        a.score - b.score ||
        a.target.distance - b.target.distance ||
        a.target.command.localeCompare(b.target.command),
    );
    return scored.map((entry) => entry.target);
  }

  private async teleportToLocateTarget(target: LocateTarget): Promise<void> {
    const player = this.player;
    const worldStream = this.worldStream;
    if (!player || !worldStream) return;
    const requestId = ++this.locateRequestId;
    try {
      const ready = await worldStream.prepareLocateTarget(target);
      if (
        !ready ||
        this.disposed ||
        requestId !== this.locateRequestId ||
        player !== this.player ||
        worldStream !== this.worldStream
      ) return;
      player.teleport(target.position);
      worldStream.update(this.elapsed, 1 / 60, player.position);
      this.updateDebugState(true);
      this.ui.showConsoleMessage({
        kind: 'system',
        text: `TÉLÉPORTATION: ${target.label.toUpperCase()} · ${Math.round(target.distance)} M`,
      });
    } catch {
      if (this.disposed || requestId !== this.locateRequestId) return;
      this.ui.showConsoleMessage({
        kind: 'error',
        text: `ÉCHEC DU CHARGEMENT: ${target.label.toUpperCase()}`,
      });
    }
  }

  private readonly onConsoleHotkey = (event: KeyboardEvent): void => {
    if (event.repeat || this.disposed || !this.player || Game.isEditableTarget(event.target)) return;
    const slash = event.key === '/';
    if (event.code !== 'KeyH' && event.code !== 'KeyC' && !slash) return;
    if (!this.player.isLocked) return;
    event.preventDefault();
    if (this.ui.isConsoleOpen) {
      this.ui.closeConsole();
      if (event.code === 'KeyH' || slash) return;
    }
    this.ui.openConsole(event.code === 'KeyC' ? 'chat' : 'command');
  };

  private static isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || target.isContentEditable;
  }

  private updateMenuCinematic(): void {
    this.camera.position.copy(this.cinematicPosition);
    this.camera.rotation.copy(this.cinematicEuler);
    if (!this.settings.menuMotion) return;
    const time = Math.max(0, this.elapsed - this.cinematicStartedAt);
    const slowTime = time + this.cinematicPhase;
    this.camera.position.x += Math.sin(slowTime * 0.17) * 0.09;
    this.camera.position.y += Math.sin(slowTime * 0.23) * 0.025;
    this.camera.position.z += Math.cos(slowTime * 0.14) * 0.09;
    this.camera.rotation.set(
      this.cinematicEuler.x + Math.sin(slowTime * 0.13) * 0.014,
      this.cinematicEuler.y + Math.sin(slowTime * 0.09) * 0.24,
      0,
      'YXZ',
    );
  }

  private readonly frame = (now: number): void => {
    if (this.disposed || !this.player || !this.worldStream || !this.postFX) return;
    const measuredDelta = Math.max(0, (now - this.previousTime) / 1000);
    const rawDelta = Math.min(0.05, measuredDelta);
    this.previousTime = now;
    this.elapsed += rawDelta;
    const playing = this.player.isLocked;
    const mainMenuOpen = this.ui.isMainMenuOpen;
    if (mainMenuOpen && !this.wasMainMenuOpen) {
      this.cinematicPosition.copy(this.camera.position);
      this.cinematicEuler.setFromQuaternion(this.camera.quaternion, 'YXZ');
      this.cinematicStartedAt = this.elapsed;
    }
    this.wasMainMenuOpen = mainMenuOpen;

    if (playing) {
      this.playableSeconds += rawDelta;
      this.autosaveElapsed += rawDelta;
      if (this.autosaveElapsed >= AUTOSAVE_INTERVAL_SECONDS) this.saveNow('autosave');
      this.accumulator = Math.min(this.accumulator + rawDelta, 0.12);
      const fixedDelta = 1 / 60;
      while (this.accumulator >= fixedDelta) {
        this.player.fixedUpdate(fixedDelta);
        this.accumulator -= fixedDelta;
      }
      this.player.renderUpdate(rawDelta, this.accumulator / fixedDelta);
      this.worldStream.update(this.elapsed, rawDelta, this.player.position);
      const nextStory = this.worldStream.getCenterCoord().story;
      if (nextStory !== this.activeStory) {
        this.activeStory = nextStory;
        this.pendingAutosaveStory = nextStory;
        this.flushPendingLevelAutosave();
      }
    } else {
      this.accumulator = 0;
      this.ui.setInteraction(null);
      if (mainMenuOpen) this.updateMenuCinematic();
    }
    this.updateAtmosphere(rawDelta);
    this.player.getViewDirection(this.lookDirection);
    const interaction = !playing || this.player.isTraversing || this.player.isNoclipEnabled
      ? null
      : this.worldStream.getInteraction(this.player.position, this.lookDirection);
    this.ui.setInteraction(interaction?.label ?? null);
    const room = this.worldStream.findRoomAt(
      this.player.position.x,
      this.player.position.y,
      this.player.position.z,
    );
    this.audio.update(room);

    // Keep simulation deltas bounded, but measure the real wall-clock frame.
    // Generation stalls must remain visible to both the HUD and quality loop.
    const instantaneousFps = measuredDelta > 0 ? 1 / measuredDelta : 60;
    this.fps = THREE.MathUtils.lerp(this.fps, instantaneousFps, 0.055);
    if (measuredDelta > 0) {
      this.frameTimeMs = THREE.MathUtils.lerp(this.frameTimeMs, measuredDelta * 1000, 0.055);
    }
    const nextPixelRatio = this.settings.renderQuality === 'auto'
      ? this.adaptiveRenderScale.update(this.fps, measuredDelta)
      : null;
    if (nextPixelRatio !== null && nextPixelRatio !== this.pixelRatio) {
      this.pixelRatio = nextPixelRatio;
      this.resize();
    }
    // Resize, when required, happens before the normal presentation so a
    // quality step still fills fresh HDR targets with a single rendered frame.
    this.renderer.info.reset();
    this.postFX.render(rawDelta);
    this.frameCounter += 1;
    this.metricsTimer += rawDelta;
    if (this.metricsTimer >= 0.35) {
      this.metricsTimer = 0;
      this.ui.update(room, this.fps);
      this.updateDebugState(true);
    }
  };

  private readonly resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.postFX?.setSize(width, height);
  };

  private readonly onVisibilityChange = (): void => {
    if (document.hidden && !this.options.onRequestContinue) this.saveNow('autosave');
    void this.audio.setSuspended(document.hidden || !this.player?.isLocked);
    this.previousTime = performance.now();
    this.accumulator = 0;
  };

  private readonly onCanvasClick = (): void => {
    if (!this.player?.isLocked && !this.ui.isPaused && !this.ui.isMainMenuOpen) this.enter();
  };

  private readonly onPageHide = (): void => {
    if (!this.options.onRequestContinue) this.saveNow('autosave');
  };

  private readSystemDiagnostics(): SystemDiagnostics {
    const gl = this.renderer.getContext();
    const extension = gl.getExtension('WEBGL_debug_renderer_info') as {
      UNMASKED_RENDERER_WEBGL: number;
      UNMASKED_VENDOR_WEBGL: number;
    } | null;
    const deviceNavigator = navigator as Navigator & { deviceMemory?: number };
    return {
      browser: navigator.userAgent,
      platform: navigator.platform || 'unknown',
      language: navigator.language,
      cpuThreads: navigator.hardwareConcurrency || null,
      deviceMemoryGb: deviceNavigator.deviceMemory ?? null,
      gpu: extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : 'unavailable',
      gpuVendor: extension ? String(gl.getParameter(extension.UNMASKED_VENDOR_WEBGL)) : 'unavailable',
      webgl: gl.getParameter(gl.VERSION) as string,
      maxTextureSize: this.renderer.capabilities.maxTextureSize,
    };
  }

  private updateDebugState(ready: boolean): void {
    const spawn = { x: this.plan.spawn.x, y: this.plan.spawn.y, z: this.plan.spawn.z };
    const player: PlayerDiagnostics = this.player?.getDebugState() ?? {
      ...spawn,
      position: spawn,
      velocity: { x: 0, y: 0, z: 0 },
      horizontalSpeed: 0,
      verticalSpeed: 0,
      grounded: true,
      moving: false,
      sprinting: false,
      crouching: false,
      noclip: false,
      traversing: false,
      pointerLocked: false,
      view: describeViewDirection({ x: 0, y: 0, z: -1 }),
    };
    if (this.player && this.diagnosticsVisible) this.player.getViewDirection(this.lookDirection);
    else this.lookDirection.set(0, 0, 0);
    const runtime = this.worldStream?.getDiagnostics(
      this.player?.position ?? this.camera.position,
      this.camera.position,
      this.lookDirection,
    );
    const streaming = runtime?.streaming ?? {
      chunks: 1,
      views: 0,
      physicsChunks: this.physics ? 1 : 0,
      rooms: this.plan.rooms.length,
      lights: this.plan.lights.length,
      lightSources: this.plan.lights.filter((light) => !light.dead).length,
      colliders: this.plan.colliders.length,
      props: this.plan.propPlacements?.length ?? 0,
      pendingChunks: 0,
      preparedChunks: 0,
      verticalPrefetch: 0,
      priorityVerticalPrefetch: 0,
      workerMode: 'main-thread' as const,
      workerInFlight: null,
      pendingStory: null,
      recoveryChunk: null,
    };
    const world = runtime?.world ?? {
      room: 'threshold' as const,
      chunkKey: null,
      chunk: null,
      centerChunkKey: '0:0:0' as const,
      localPosition: { ...player.position },
      planSeed: this.plan.seed,
      planVersion: this.plan.version,
      biome: null,
      visualBiome: this.plan.visualBiome ?? null,
      featureKinds: [...new Set(this.plan.features.map((feature) => feature.kind))],
      featureIds: this.plan.features.map((feature) => feature.id),
      darkness: this.darkness,
    };
    world.darkness = this.darkness;
    this.renderer.getDrawingBufferSize(this.drawingBufferSize);
    const safeDeviceRatio = Math.max(0.01, window.devicePixelRatio || 1);
    const memory = performance as Performance & {
      memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
    };
    const bytesPerMegabyte = 1024 * 1024;
    const snapshot: DiagnosticsSnapshot = {
      ready,
      updatedAt: Date.now(),
      session: {
        title: 'Backrooms: Random story',
        seed: this.seed,
        originFingerprint: this.originFingerprint,
        generatorVersion: this.plan.version,
        originFeatures: this.plan.features.map((feature) => feature.kind),
      },
      player,
      world,
      target: runtime?.target ?? null,
      performance: {
        fps: this.fps,
        frameTimeMs: this.frameTimeMs,
        frame: this.frameCounter,
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
        geometries: this.renderer.info.memory.geometries,
        textures: this.renderer.info.memory.textures,
        programs: this.renderer.info.programs?.length ?? 0,
        jsHeapUsedMb: memory.memory?.usedJSHeapSize
          ? memory.memory.usedJSHeapSize / bytesPerMegabyte
          : null,
        jsHeapLimitMb: memory.memory?.jsHeapSizeLimit
          ? memory.memory.jsHeapSizeLimit / bytesPerMegabyte
          : null,
      },
      quality: {
        preset: this.settings.renderQuality,
        pixelRatio: this.pixelRatio,
        devicePixelRatio: safeDeviceRatio,
        renderScalePercent: this.pixelRatio / safeDeviceRatio * 100,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        renderBuffer: {
          width: this.drawingBufferSize.x,
          height: this.drawingBufferSize.y,
        },
        antialias: this.renderer.getContextAttributes().antialias ?? false,
        shadows: this.renderer.shadowMap.enabled,
        lightingMode: this.worldStream?.getLightingMode() ?? 'modern',
      },
      streaming,
      system: this.systemDiagnostics,
      seed: this.seed,
      fingerprint: this.originFingerprint,
      rooms: streaming.rooms,
      lights: streaming.lights,
      props: streaming.props,
      features: this.plan.features.map((feature) => feature.kind),
      fps: this.fps,
      pixelRatio: this.pixelRatio,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      chunks: streaming.chunks,
      pendingChunks: streaming.pendingChunks,
      noclip: player.noclip,
      darkness: this.darkness,
    };
    window.__BACKROOMS__ = snapshot;
    if (this.diagnosticsVisible) this.ui.updateDiagnostics(snapshot);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onConsoleHotkey);
    window.removeEventListener('pagehide', this.onPageHide);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.renderer.domElement.removeEventListener('click', this.onCanvasClick);
    this.player?.dispose();
    this.worldStream?.dispose();
    this.physics?.dispose();
    this.postFX?.dispose();
    this.materials?.dispose();
    this.audio.dispose();
    this.ui.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.root.remove();
    if (window.__BACKROOMS__) delete window.__BACKROOMS__;
  }
}
