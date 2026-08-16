import * as THREE from 'three';
import { ImportedApartmentDoorInteraction } from '../apartment/ImportedApartmentDoorInteraction';
import { ImportedApartmentEnvironment } from '../apartment/ImportedApartmentEnvironment';
import { AudioSystem } from '../audio/AudioSystem';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { PlayerController } from '../player/PlayerController';
import {
  AdaptiveRenderScale,
  renderScaleLimits,
  type RenderScaleLimits,
} from '../render/AdaptiveQuality';
import { HallExitInteraction } from '../stairwell/HallExitInteraction';
import { StairwellEnvironment } from '../stairwell/StairwellEnvironment';
import { StairwellMaterials } from '../stairwell/StairwellMaterials';
import { createStairwellPlan } from '../stairwell/createStairwellPlan';
import { ExperienceUI } from '../ui/ExperienceUI';
import type { ConsoleCompletion, ConsoleMode, ConsoleSubmitResult } from '../ui/ExperienceUI';
import { loadGameSettings, type GameSettings } from '../ui/settings';
import type { GameSaveStorage } from './GameSave';
import {
  getGameSaveSummary,
  listGameSaves,
  writeGameSave,
  type GameSaveEntry,
  type GameSaveKind,
} from './SaveHistory';

type RussianStairwellHistorySave = Extract<
  GameSaveEntry,
  { readonly experienceId: 'russian-stairwell' }
>;

export type RussianStairwellLaunch =
  | { readonly kind: 'new' }
  | { readonly kind: 'load'; readonly save: RussianStairwellHistorySave };

export interface RussianStairwellGameCallbacks {
  onRequestNewGame(): void;
  onRequestLoadGame(id: string): void;
  onEnterBackrooms(): void;
}

const FIXED_STEP = 1 / 60;

export class RussianStairwellGame {
  private readonly root = document.createElement('main');
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(70, 1, 0.04, 160);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly ui: ExperienceUI;
  private readonly audio = new AudioSystem();
  private readonly storage: GameSaveStorage | null;
  private readonly viewDirection = new THREE.Vector3();
  private readonly lastSafePosition = new THREE.Vector3();
  private readonly renderScale: RenderScaleLimits;
  private readonly adaptiveScale: AdaptiveRenderScale;
  private settings: GameSettings;
  private physics?: PhysicsWorld;
  private player?: PlayerController;
  private materials?: StairwellMaterials;
  private environment?: StairwellEnvironment;
  private apartment?: ImportedApartmentEnvironment;
  private door?: ImportedApartmentDoorInteraction;
  private hallExit?: HallExitInteraction;
  private pixelRatio: number;
  private accumulator = 0;
  private elapsed = 0;
  private playableSeconds = 0;
  private previousTime = performance.now();
  private fps = 60;
  private saveErrorShown = false;
  private initialized = false;
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly launch: RussianStairwellLaunch,
    private readonly callbacks: RussianStairwellGameCallbacks,
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
    this.adaptiveScale = new AdaptiveRenderScale(this.renderScale);
    this.pixelRatio = this.pixelRatioForQuality(this.settings.renderQuality);
    this.root.className = 'experience-root russian-stairwell-root';
    this.container.append(this.root);
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.domElement.className = 'world-canvas';
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.93;
    this.renderer.shadowMap.enabled = false;
    this.root.append(this.renderer.domElement);
    this.ui = new ExperienceUI(this.root, {
      enter: () => this.enter(),
      regenerate: () => this.callbacks.onRequestNewGame(),
      saveGame: () => this.saveNow('manual'),
      loadGame: (id) => this.callbacks.onRequestLoadGame(id),
      toggleFullscreen: () => void this.toggleFullscreen(),
      settingsChanged: (settings) => this.applySettings(settings),
      submitConsole: (value, mode) => this.submitConsole(value, mode),
      completeConsole: (value, mode) => this.completeConsole(value, mode),
      consoleVisibility: (open) => this.player?.setInputEnabled(!open),
    }, this.settings, 'russian-stairwell');
    this.scene.background = new THREE.Color(0x090d11);
    this.scene.fog = new THREE.Fog(0x10161c, 16, 52);
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onConsoleHotkey);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  async initialize(): Promise<void> {
    const plan = createStairwellPlan();
    const physics = await PhysicsWorld.create(plan);
    this.physics = physics;
    const [materialsResult, apartmentResult] = await Promise.allSettled([
      StairwellMaterials.load(this.renderer),
      ImportedApartmentEnvironment.load(),
    ]);
    if (materialsResult.status === 'rejected' || apartmentResult.status === 'rejected') {
      if (materialsResult.status === 'fulfilled') materialsResult.value.dispose();
      if (apartmentResult.status === 'fulfilled') apartmentResult.value.dispose();
      throw materialsResult.status === 'rejected'
        ? materialsResult.reason
        : apartmentResult.status === 'rejected'
          ? apartmentResult.reason
          : new Error('Chargement incomplet de Russian Stairwells.');
    }
    const materials = materialsResult.value;
    const apartment = apartmentResult.value;
    if (this.disposed) {
      materials.dispose();
      apartment.dispose();
      return;
    }
    this.materials = materials;
    this.apartment = apartment;
    const environment = await StairwellEnvironment.load(materials.materials);
    if (this.disposed) {
      environment.dispose();
      return;
    }
    this.environment = environment;
    this.scene.add(environment.group, apartment.group);
    apartment.group.updateMatrixWorld(true);
    physics.addTrimeshChunk('imported-apartment-shell', apartment.shellColliderMeshes);
    if (apartment.furnitureColliders.length > 0) {
      physics.addChunk(
        'imported-apartment-furniture',
        apartment.furnitureColliders,
        { x: 0, y: 0, z: 0 },
      );
    }

    this.camera.fov = this.settings.fieldOfView;
    this.camera.updateProjectionMatrix();
    this.player = new PlayerController(this.camera, this.renderer.domElement, physics, {
      onLockChange: (locked) => this.onPlayerLockChange(locked),
      onFootstep: (strength) => this.audio.footstep(strength),
      onInteract: () => this.tryInteract(),
      onLand: () => this.audio.impact(),
      onSafePosition: () => physics.getStandingPosition(this.lastSafePosition),
      onFallReset: () => {
        this.audio.impact();
        this.ui.showFall();
      },
    });
    this.player.setFieldOfView(this.settings.fieldOfView);
    this.player.setLookSensitivity(this.settings.lookSensitivity);
    this.player.setCameraMotionEnabled(this.settings.cameraMotion);
    this.player.setControlBindings(this.settings.controls);
    this.audio.setMasterVolume(this.settings.masterVolume);
    this.door = new ImportedApartmentDoorInteraction(
      apartment.entryDoor.pivot,
      apartment.entryDoor.leaf,
      apartment.entryDoor.closedBox,
      apartment.createDoorCollider(
        'imported-apartment-entry-door-closed',
        apartment.entryDoor.closedBox,
      ),
      physics,
      this.ui,
      {
        chunkKey: 'imported-apartment-entry-door',
        closedAngle: apartment.entryDoor.closedAngle,
        openAngle: apartment.entryDoor.openAngle,
      },
    );
    if (!environment.hallEntranceDoor) {
      throw new Error('La porte du hall d’escalier est absente.');
    }
    this.hallExit = new HallExitInteraction(
      environment.hallEntranceDoor,
      this.ui,
      () => this.callbacks.onEnterBackrooms(),
    );

    if (this.launch.kind === 'load') {
      this.door.restoreState(this.launch.save.payload.entranceDoor);
      this.player.teleport(this.launch.save.payload.safePosition);
      this.player.setLookQuaternion(this.launch.save.payload.quaternion);
      this.playableSeconds = this.launch.save.playTimeSeconds;
    } else {
      this.player.teleport(apartment.entrySpawn);
      const towardDoor = apartment.doorCenter.clone().sub(apartment.entrySpawn);
      towardDoor.y = 0;
      if (towardDoor.lengthSq() > 1e-8) {
        this.player.setLookQuaternion(new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 0, -1),
          towardDoor.normalize(),
        ));
      }
    }
    this.lastSafePosition.copy(this.player.position);

    this.resize();
    await this.renderer.compileAsync(this.scene, this.camera);
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
    this.initialized = true;
    this.syncSaveHistory();
    this.ui.setSessionStarted(true);
    this.ui.setReady();
    this.previousTime = performance.now();
    this.renderer.setAnimationLoop(this.frame);
  }

  private enter(): void {
    this.player?.lock();
    void this.audio.start().catch(() => {
      this.ui.showConsoleMessage({ kind: 'error', text: 'AUDIO INDISPONIBLE' });
    });
  }

  private tryInteract(): void {
    if (!this.player || !this.door) return;
    this.player.getViewDirection(this.viewDirection);
    if (this.hallExit?.interact(
      this.player.position,
      this.viewDirection,
      this.player.isLocked,
    )) return;
    this.door.interact(this.player.position, this.viewDirection, this.player.isLocked);
  }

  private onPlayerLockChange(locked: boolean): void {
    this.ui.setLocked(locked);
    this.player?.setInputEnabled(locked && !this.ui.isConsoleOpen);
    void this.audio.setSuspended(!locked || document.hidden);
    this.previousTime = performance.now();
    this.accumulator = 0;
  }

  private applySettings(settings: GameSettings): void {
    this.settings = { ...settings };
    this.player?.setFieldOfView(settings.fieldOfView);
    this.player?.setLookSensitivity(settings.lookSensitivity);
    this.player?.setCameraMotionEnabled(settings.cameraMotion);
    this.player?.setControlBindings(settings.controls);
    this.audio.setMasterVolume(settings.masterVolume);
    const ratio = this.pixelRatioForQuality(settings.renderQuality);
    if (ratio !== this.pixelRatio) {
      this.pixelRatio = ratio;
      this.resize();
    }
  }

  private pixelRatioForQuality(quality: GameSettings['renderQuality']): number {
    if (quality === 'performance') return this.renderScale.min;
    if (quality === 'quality') return this.renderScale.max;
    return this.adaptiveScale.value;
  }

  private submitConsole(value: string, mode: ConsoleMode): ConsoleSubmitResult {
    const trimmed = value.trim();
    if (!trimmed.startsWith('/')) {
      return mode === 'chat'
        ? { close: true, feedback: 'MESSAGE LOCAL', messages: [{ kind: 'chat', text: `me: ${trimmed}` }] }
        : { close: false, feedback: 'UTILISE /help', messages: [{ kind: 'error', text: 'UTILISE /help' }] };
    }
    if (trimmed.toLowerCase() === '/save') {
      const saved = this.saveNow('manual');
      const text = saved ? 'PARTIE SAUVEGARDÉE' : 'ÉCHEC DE LA SAUVEGARDE';
      return { close: true, feedback: text, messages: [{ kind: saved ? 'system' : 'error', text }] };
    }
    const text = trimmed.toLowerCase() === '/help'
      ? '/save - sauvegarder maintenant'
      : 'COMMANDE INCONNUE. UTILISE /help.';
    return { close: false, feedback: text, messages: [{ kind: 'system', text }] };
  }

  private completeConsole(value: string, _mode: ConsoleMode): ConsoleCompletion | null {
    if (!value.trimStart().startsWith('/')) return null;
    const options = [
      { value: '/help', label: '/help', detail: 'AFFICHE LES COMMANDES' },
      { value: '/save', label: '/save', detail: 'SAUVEGARDE MAINTENANT' },
    ].filter((item) => item.value.startsWith(value.trim()));
    return options.length > 0 ? { hint: `${options.length} COMMANDE(S)`, suggestions: options } : null;
  }

  private saveNow(kind: GameSaveKind): boolean {
    if (!this.initialized || !this.player || !this.door) return false;
    if (!this.storage) {
      if (!this.saveErrorShown) {
        this.saveErrorShown = true;
        this.ui.showConsoleMessage({ kind: 'error', text: 'SAUVEGARDE LOCALE INDISPONIBLE' });
      }
      return false;
    }
    const look = this.player.getLookQuaternion();
    const result = writeGameSave(this.storage, {
      experienceId: 'russian-stairwell',
      kind,
      levelId: 'building',
      levelLabel: 'Immeuble',
      playTimeSeconds: this.playableSeconds,
      payload: {
        safePosition: this.lastSafePosition,
        quaternion: { x: look.x, y: look.y, z: look.z, w: look.w },
        entranceDoor: this.door.getState(),
      },
    });
    if (!result.ok && !this.saveErrorShown) {
      this.saveErrorShown = true;
      this.ui.showConsoleMessage({ kind: 'error', text: 'SAUVEGARDE LOCALE INDISPONIBLE' });
    }
    if (result.ok) this.syncSaveHistory();
    return result.ok;
  }

  private syncSaveHistory(): void {
    const summaries = this.storage
      ? listGameSaves(this.storage).map(getGameSaveSummary)
      : [];
    this.ui.setSaveHistory(summaries);
  }

  private readonly frame = (now: number): void => {
    if (this.disposed || !this.player || !this.environment || !this.door) return;
    const measuredDelta = Math.max(0, (now - this.previousTime) / 1000);
    const delta = Math.min(0.05, measuredDelta);
    this.previousTime = now;
    this.elapsed += delta;
    if (this.player.isLocked) {
      this.playableSeconds += delta;
      this.accumulator = Math.min(this.accumulator + delta, FIXED_STEP * 5);
      while (this.accumulator >= FIXED_STEP) {
        this.player.fixedUpdate(FIXED_STEP);
        this.accumulator -= FIXED_STEP;
      }
      this.player.renderUpdate(delta, this.accumulator / FIXED_STEP);
      this.environment.update(this.elapsed);
      this.player.getViewDirection(this.viewDirection);
      this.door.update(delta, this.player.position, this.viewDirection, true);
      this.hallExit?.update(this.player.position, this.viewDirection, true);
    } else {
      this.accumulator = 0;
      this.ui.setInteraction(null);
    }
    const instantaneousFps = measuredDelta > 0 ? 1 / measuredDelta : 60;
    this.fps = THREE.MathUtils.lerp(this.fps, instantaneousFps, 0.045);
    if (this.settings.renderQuality === 'auto') {
      const nextRatio = this.adaptiveScale.update(this.fps, measuredDelta);
      if (nextRatio !== null && nextRatio !== this.pixelRatio) {
        this.pixelRatio = nextRatio;
        this.resize();
      }
    }
    this.renderer.render(this.scene, this.camera);
  };

  private readonly resize = (): void => {
    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  private async toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await this.root.requestFullscreen();
  }

  private readonly onVisibilityChange = (): void => {
    void this.audio.setSuspended(document.hidden || !this.player?.isLocked);
    this.previousTime = performance.now();
    this.accumulator = 0;
  };

  private readonly onConsoleHotkey = (event: KeyboardEvent): void => {
    if (event.repeat || this.disposed || !this.player || RussianStairwellGame.isEditableTarget(event.target)) return;
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

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onConsoleHotkey);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.door?.dispose();
    this.hallExit?.dispose();
    this.player?.dispose();
    this.apartment?.dispose();
    this.environment?.dispose();
    this.materials?.dispose();
    this.physics?.dispose();
    this.audio.dispose();
    this.ui.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.root.remove();
  }
}
