import { CharacterRuntime } from '../character/CharacterRuntime';
import { viewmodelCommand, VIEWMODEL_COMPLETION } from '../character/ViewmodelCommand';
import * as THREE from 'three';
import { AudioSystem } from '../audio/AudioSystem';
import { siteAudio } from '../audio/SiteAudio';
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
import { MODERN_BACKROOMS_RIG } from '../render/FluorescentFixture';
import { resolveLightingBrightness } from '../render/LightingBrightness';
import { MaterialLibrary } from '../render/MaterialLibrary';
import { PostFX } from '../render/PostFX';
import { compileSceneProgressively, waitForSceneGpu } from '../render/SceneWarmup';
import { FrameHitchMonitor } from '../render/FrameHitchMonitor';
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
import { captureGameSavePreview } from './SavePreview';
import { prepareOriginPlan } from './PrepareOriginPlan';
import { yieldToBrowser } from './CooperativeWork';
import { COMPASS_ID, FLASHLIGHT_ID, InventoryState, freshInventory, type InventoryProgress } from '../apartment/InventoryState';
import { Compass } from '../apartment/Compass';
import { Flashlight } from '../apartment/Flashlight';
import type { PalmFrame } from '../character/HeldItemPose';
import { EquipmentInput } from '../input/EquipmentInput';
import { formatKeyLabel } from '../input/ControlBindings';
import { InventoryHUD } from '../ui/InventoryHUD';
import { compassIcon } from '../ui/InventoryIcons';
import { NarrativeCaption } from '../ui/NarrativeCaption';
import { QuestTracker } from '../ui/QuestTracker';
import { StoryHud } from '../ui/StoryHud';
import { BalanceMeter } from '../ui/BalanceMeter';
import { RiftAudio } from '../audio/RiftAudio';
import { BacteriaActor } from '../monster/BacteriaActor';
import { BacteriaAudio } from '../monster/BacteriaAudio';
import { RiftEncounter } from './RiftEncounter';
import type { RiftProgress } from '../story/RiftProgress';
import { RIFT_LINES } from '../story/RiftJourney';

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
    | { readonly kind: 'new'; readonly inventory?: InventoryProgress }
    | { readonly kind: 'load'; readonly save: BackroomsGameSave };
  autosaveOnReady?: boolean;
  autoEnterOnReady?: boolean;
  /** Fell in from the street: alone, lying on the ground, free to get up. */
  arrivedByFall?: boolean;
  preparedOrigin?: { seed: string; plan: WorldPlan };
}

const AUTOSAVE_INTERVAL_SECONDS = 30;
/** The rift's own dark: fog and sky fade to it near the void so its ends never show. */
const RIFT_DARK = 0x0f0c06;
const RIFT_FOG_DENSITY = 0.0125;

/**
 * Torch and compass are never lost on the way down: an older Backrooms save
 * (or an arrival without a snapshot) still carries both.
 */
const carriedInventory = (saved?: InventoryProgress): InventoryState => {
  const inventory = new InventoryState(saved ?? freshInventory());
  if (!inventory.hasLamp) inventory.acquireLamp();
  if (!inventory.hasCompass) inventory.acquireCompass();
  if (!saved) inventory.state.selected = inventory.state.items.findIndex((item) => item.id === COMPASS_ID);
  return inventory;
};

export class Game {
  static async create(container: HTMLElement, options: GameOptions, signal?: AbortSignal): Promise<Game> {
    const seed = options.launch?.kind === 'load' ? options.launch.save.payload.seed : resolveSeed();
    const plan = await prepareOriginPlan(seed, signal);
    await yieldToBrowser(); signal?.throwIfAborted();
    return new Game(container, { ...options, preparedOrigin: { seed, plan } });
  }
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
    MODERN_BACKROOMS_RIG.hemisphere.lit,
  );
  private readonly ambientFill = new THREE.AmbientLight(ATMOSPHERE.yellow.ambient, MODERN_BACKROOMS_RIG.ambient.lit);
  private readonly directionalKey = new THREE.DirectionalLight(ATMOSPHERE.yellow.key, MODERN_BACKROOMS_RIG.key.lit);
  private readonly atmosphereTargetColor = new THREE.Color();
  private readonly ui: ExperienceUI;
  private readonly audio = new AudioSystem();
  private readonly lookDirection = new THREE.Vector3();
  private readonly streamingVelocity = new THREE.Vector3();
  private readonly lastSafePosition = new THREE.Vector3();
  private readonly drawingBufferSize = new THREE.Vector2();
  private readonly cinematicPosition = new THREE.Vector3();
  private readonly cinematicEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly originFingerprint: string;
  private readonly cinematicPhase: number;
  private readonly systemDiagnostics: SystemDiagnostics;
  private readonly renderScale: RenderScaleLimits;
  private settings: GameSettings;
  private brightnessProfile = resolveLightingBrightness();
  private readonly storage: GameSaveStorage | null;
  private materials?: MaterialLibrary;
  private worldStream?: WorldStream;
  private physics?: PhysicsWorld;
  private player?: PlayerController;
  private character?: CharacterRuntime;
  private readonly playerCamera = this.camera.clone();
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
  private transitionSuspended = false;
  // The walk after the fall (absent from the menu background).
  private readonly journey: boolean;
  private readonly inventory?: InventoryState;
  private inventoryHUD?: InventoryHUD;
  private equipmentInput?: EquipmentInput;
  private flashlight?: Flashlight;
  private compass?: Compass;
  private caption?: NarrativeCaption;
  private questTracker?: QuestTracker;
  private storyHud?: StoryHud;
  private balanceMeter?: BalanceMeter;
  private readonly riftAudio = new RiftAudio(() => this.audio.getOutput());
  private readonly creatureAudio = new BacteriaAudio(() => this.audio.getOutput());
  private creature?: BacteriaActor;
  private rift?: RiftEncounter;
  private readonly savedRift?: RiftProgress;
  private readonly palm: PalmFrame = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  private readonly equipmentHand = new THREE.Vector3();
  private readonly riftDark = new THREE.Color(RIFT_DARK);

  constructor(
    private readonly container: HTMLElement,
    private readonly options: GameOptions = {},
  ) {
    this.settings = loadGameSettings();
    this.brightnessProfile = resolveLightingBrightness(this.settings.brightness);
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
    this.seed = this.options.preparedOrigin?.seed ?? (this.options.launch?.kind === 'load'
      ? this.options.launch.save.payload.seed
      : resolveSeed());
    this.plan = this.options.preparedOrigin?.plan ?? generateInfiniteChunk(this.seed, { x: 0, z: 0, story: 0 });
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
      enter: event => this.enter(false, event),
      pause: () => { this.player?.unlock(); this.onPlayerLockChange(false); },
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
    this.journey = !this.options.onRequestContinue;
    if (this.journey) {
      const launch = this.options.launch;
      const saved = launch?.kind === 'load' ? launch.save.payload : undefined;
      this.inventory = carriedInventory(launch?.kind === 'new' ? launch.inventory : saved?.inventory);
      this.savedRift = saved?.rift;
      this.inventoryHUD = new InventoryHUD(this.root);
      this.inventoryHUD.setQuestIcon(COMPASS_ID, compassIcon());
      this.questTracker = new QuestTracker(this.root);
      this.caption = new NarrativeCaption(this.root);
      this.storyHud = new StoryHud(this.root);
      this.balanceMeter = new BalanceMeter(this.root);
      this.equipmentInput = new EquipmentInput(() => this.settings.controls, () => this.canUseEquipment(), () => {
        if (this.inventory?.toggleLamp()) { this.inventoryHUD?.reveal(); this.audio.lightSwitch(this.inventory.state.lampOn); }
      }, () => undefined);
      this.renderer.domElement.addEventListener('wheel', this.onInventoryWheel, { passive: false });
    }
    this.configureScene();
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onConsoleHotkey);
    window.addEventListener('pagehide', this.onPageHide);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  async initialize(onProgress: (progress: number, phase?: string) => void = () => undefined): Promise<void> {
    let phase = 'Textures';
    let visualProgress = 0;
    let audioProgress = this.options.onRequestContinue ? 1 : 0;
    const emitProgress = (): void => onProgress(
      Math.min(1, visualProgress * 0.8 + audioProgress * 0.2), phase,
    );
    const setVisualProgress = (progress: number, nextPhase: string): void => {
      phase = nextPhase;
      visualProgress = Math.max(visualProgress, progress);
      emitProgress();
    };
    const audioReady = this.options.onRequestContinue
      ? Promise.resolve()
      : this.audio.start((progress) => {
        audioProgress = progress;
        emitProgress();
      });
    if (!this.options.onRequestContinue) await this.audio.setSuspended(true);
    emitProgress();
    // What followed down the hole: at the rift, then hunting the far bank.
    const creatureReady = this.journey
      ? BacteriaActor.load().catch((error) => { console.warn('[rift] creature unavailable', error); return undefined; })
      : Promise.resolve(undefined);

    const materials = await MaterialLibrary.load(this.renderer);
    if (this.disposed) {
      materials.dispose();
      return;
    }
    this.materials = materials;
    setVisualProgress(0.16, 'Préparation de la physique');

    const physics = await PhysicsWorld.create(this.plan);
    if (this.disposed) {
      physics.dispose();
      return;
    }
    this.physics = physics;
    if (this.journey) {
      // Carried, never on a desk here: the model only shows in the hand.
      this.flashlight = new Flashlight(this.scene, physics);
      this.compass = new Compass(this.scene);
      this.inventoryHUD?.setObjectSources([], this.flashlight.model);
    }
    setVisualProgress(0.24, 'Création de la scène');
    this.worldStream = new WorldStream(
      this.seed,
      this.plan,
      this.scene,
      this.materials.materialSets,
      this.physics,
      this.settings.lighting,
      this.settings.brightness,
    );
    await this.worldStream.initialize();
    if (this.disposed) return;
    setVisualProgress(0.5, 'Téléchargement des ressources');
    await this.worldStream.waitForVisualAssets();
    if (this.disposed) return;
    setVisualProgress(0.62, 'Préparation de l’éclairage');
    if (this.worldStream.getLightingMode() !== this.settings.lighting) {
      await this.worldStream.setLightingMode(this.settings.lighting);
      if (this.disposed) return;
    }
    setVisualProgress(0.68, 'Restauration de la partie');
    this.camera.rotation.set(0, -Math.PI * 0.22, 0, 'YXZ');
    this.camera.fov = this.settings.fieldOfView;
    this.camera.updateProjectionMatrix();
    this.playerCamera.copy(this.camera);
    this.player = new PlayerController(this.playerCamera, this.renderer.domElement, this.physics, {
      onLockChange: (locked) => this.onPlayerLockChange(locked),
      onPointerCaptureChange: captured => this.ui.setPointerCaptureRequired(!captured),
      onFootstep: (strength) => this.audio.footstep('backrooms-carpet', strength),
      onMovementAudioState: (state) => this.audio.setMovementState('backrooms-carpet', state),
      onInteract: (mode) => this.tryInteract(mode),
      onLand: (impactSpeed, impact) => {
        this.audio.land('backrooms-carpet', impactSpeed);
        this.character?.handleLanding(impactSpeed, impact);
      },
      onSafePosition: (position) => {
        this.lastSafePosition.set(position.x, position.y, position.z);
        this.worldStream?.protectRecoveryPosition(position);
        this.flushPendingLevelAutosave();
      },
      onFallReset: () => {
        if (this.player) this.worldStream?.ensurePositionMounted(this.player.position);
        this.audio.land('backrooms-carpet', 18);
        this.ui.showFall();
      },
    });
    if (this.options.launch?.kind === 'load') {
      const { chunk, localPosition, quaternion, surface } = this.options.launch.save.payload;
      const offset = getChunkWorldOffset(chunk);
      const restoredPosition = {
        x: offset.x + localPosition.x,
        y: offset.y + localPosition.y,
        z: offset.z + localPosition.z,
      };
      const destinationReady = await this.worldStream.prepareSavedChunk(chunk);
      if (this.disposed) return;
      if (!destinationReady) throw new Error('Impossible de préparer la sauvegarde sélectionnée.');
      this.player.teleport(this.worldStream.restoreSurfacePosition(restoredPosition, surface, chunk));
      this.player.setLookQuaternion(quaternion);
      this.playableSeconds = this.options.launch.save.playTimeSeconds;
    }
    setVisualProgress(0.76, 'Préparation du niveau');
    this.lastSafePosition.copy(this.player.position);

    // Mount every starting chunk before shader compilation so the first
    // interactive frame already contains the full visible architecture.
    this.worldStream.update(0, 0, this.player.position);
    this.activeStory = this.worldStream.getCenterCoord().story;
    if (this.options.launch?.kind === 'load') {
      await this.worldStream.waitForVisualAssets();
      if (this.disposed) return;
    }
    setVisualProgress(0.82, 'Préparation du personnage');

    this.player.setFieldOfView(this.settings.fieldOfView);
    this.player.setLookSensitivity(this.settings.lookSensitivity);
    this.player.setCameraMotionEnabled(this.settings.cameraMotion);
    this.player.setControlBindings(this.settings.controls);
    this.cinematicPosition.copy(this.camera.position);
    this.cinematicEuler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.audio.setMasterVolume(this.settings.masterVolume);
    siteAudio.setMasterVolume(this.settings.masterVolume);

    if (!this.options.onRequestContinue) {
      this.character = new CharacterRuntime({
        container: this.root, canvas: this.renderer.domElement, scene: this.scene,
        playerCamera: this.playerCamera, renderCamera: this.camera,
        physics: this.physics, player: this.player, settings: this.settings, seed: this.seed,
        isPlaying: () => !!this.player?.isLocked && !this.ui.isPaused && !document.hidden && !this.ui.isConsoleOpen,
        getPits: () => this.worldStream?.getCharacterPits() ?? [],
        ensurePositionMounted: position => this.worldStream?.ensurePositionMounted(position),
      });
      await this.character.initialize();
      if (this.disposed) return;
      if (this.options.arrivedByFall) {
        if (!this.character.collapseOnArrival()) throw new Error('Impossible de préparer l’arrivée au sol.');
      } else if (!this.journey) this.character.spawnNearbyPartner();
      this.character.setActive(false);
    } else this.camera.copy(this.playerCamera);
    if (this.journey) {
      this.creature = await creatureReady;
      if (this.disposed) { this.creature?.dispose(); return; }
      if (this.creature) { this.creature.setVisible(false); this.scene.add(this.creature.root); }
      this.rift = this.createRiftEncounter();
    }

    this.postFX = new PostFX(this.renderer, this.scene, this.camera, this.settings.lighting);
    this.resize();
    await this.postFX.waitUntilReady();
    const characterWarmup = [
      ...(this.character?.renderWarmupRoots ?? []), ...(this.creature?.warmupRoots ?? []), ...(this.rift?.warmupRoots ?? []),
    ].map(root => ({ root, visible: root.visible }));
    for (const { root } of characterWarmup) root.visible = true;
    try { await compileSceneProgressively(this.renderer, this.scene, this.camera, { cancelled: () => this.disposed }); }
    finally { for (const { root, visible } of characterWarmup) root.visible = visible; }
    if (this.disposed) return;
    setVisualProgress(0.92, 'Préparation de l’affichage');
    // Warm every composer target behind the opaque loading overlay. The
    // post-processing pipeline has its own shader/target allocation that
    // renderer.compileAsync cannot cover; priming the pipeline at low resolution
    // prevents black frames when the player first dismisses the overlay.
    await this.warmupPostFX();
    if (this.disposed) return;
    setVisualProgress(0.98, 'Préparation du son');
    await audioReady.catch(error => console.warn('[audio] preparation incomplete', error));
    if (this.disposed) return;
    if (this.creature) await this.creatureAudio.load();
    if (this.disposed) return;
    setVisualProgress(1, 'Prêt');
    this.updateDebugState(true);
    this.syncSaveHistory();
    this.ui.setSessionStarted(true);
    this.ui.setReady();
    this.renderer.setAnimationLoop(this.frame);
    if (this.options.autosaveOnReady) this.saveNow('autosave');
    if (this.options.autoEnterOnReady) this.enter(true);
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

  private updateJourneyHud(delta: number, playing: boolean): void {
    if (!this.journey || !this.inventory) return;
    this.updateEquipment(playing ? delta : 0);
    const visible = playing && !this.ui.isConsoleOpen;
    this.caption?.update(delta, playing);
    this.storyHud?.setPlaying(playing);
    this.storyHud?.update(playing ? delta : 0);
    const quest = this.rift?.questText ?? null;
    // Urgent orders take the centre of the screen; the calm objective stays top left.
    this.storyHud?.setQuest(quest?.urgent ? quest.text : null, 'urgent');
    this.questTracker?.update(quest && !quest.urgent ? quest.text : null, visible && !!quest && !quest.urgent && !this.rift?.ownsCharacter);
    this.questTracker?.tick(delta, playing, !this.settings.cameraMotion);
    this.inventoryHUD?.update(this.inventory, delta, visible && !this.rift?.ownsCharacter, playing, '', '', !this.settings.cameraMotion);
  }

  private updateAtmosphere(delta: number): void {
    if (!this.worldStream || !this.player) return;
    const context = this.worldStream.getLightingContext(this.player.position);
    const blend = 1 - Math.exp(-Math.max(0, delta) * 1.6);
    this.riftAmount = this.journey ? this.rift?.atmosphereAt(this.camera.position) ?? 0 : 0;
    this.applyAtmosphere(context.biome, blend);
    const legacy = this.settings.lighting === 'legacy';
    const darknessRate = context.darkness > this.darkness ? 1.25 : 2;
    const darknessBlend = 1 - Math.exp(-Math.max(0, delta) * darknessRate);
    this.darkness = THREE.MathUtils.lerp(this.darkness, context.darkness, darknessBlend);
    if (legacy) {
      this.hemisphere.intensity = 0.17 * this.brightnessProfile.relativeGain;
      this.ambientFill.intensity = 0.018 * this.brightnessProfile.relativeGain;
      this.directionalKey.intensity = 0.07 * this.brightnessProfile.relativeGain;
      this.postFX?.setDarkness(0);
      return;
    }
    this.hemisphere.intensity = THREE.MathUtils.lerp(this.brightnessProfile.rig.hemisphere, MODERN_BACKROOMS_RIG.hemisphere.dark, this.darkness);
    this.ambientFill.intensity = THREE.MathUtils.lerp(this.brightnessProfile.rig.ambient, MODERN_BACKROOMS_RIG.ambient.dark, this.darkness);
    this.directionalKey.intensity = THREE.MathUtils.lerp(this.brightnessProfile.rig.key, MODERN_BACKROOMS_RIG.key.dark, this.darkness);
    this.postFX?.setDarkness(this.darkness);
  }

  private riftAmount = 0;

  private applyAtmosphere(biome: VisualBiome, blend: number): void {
    const legacy = this.settings.lighting === 'legacy';
    const target = (legacy ? LEGACY_ATMOSPHERE : ATMOSPHERE)[biome];
    // Near the rift both fade to its dark, so its far ends and its depth dissolve.
    const rift = this.riftAmount;
    this.backgroundColor.lerp(this.atmosphereTargetColor.setHex(target.background).lerp(this.riftDark, rift), blend);
    this.fog.color.lerp(this.atmosphereTargetColor.setHex(target.fog).lerp(this.riftDark, rift), blend);
    this.hemisphere.color.lerp(this.atmosphereTargetColor.setHex(target.hemisphereSky), blend);
    this.hemisphere.groundColor.lerp(
      this.atmosphereTargetColor.setHex(target.hemisphereGround),
      blend,
    );
    this.ambientFill.color.lerp(this.atmosphereTargetColor.setHex(target.ambient), blend);
    this.directionalKey.color.lerp(this.atmosphereTargetColor.setHex(target.key), blend);
    this.fog.density = THREE.MathUtils.lerp(legacy ? 0.0042 : 0.0015, RIFT_FOG_DENSITY, rift);
    this.directionalKey.position.set(legacy ? 3.5 : 4.5, legacy ? 8 : 7.5, legacy ? 2.5 : 3.2);
    if (legacy) {
      this.hemisphere.intensity = 0.17 * this.brightnessProfile.relativeGain;
      this.ambientFill.intensity = 0.018 * this.brightnessProfile.relativeGain;
      this.directionalKey.intensity = 0.07 * this.brightnessProfile.relativeGain;
    } else {
      this.hemisphere.intensity = THREE.MathUtils.lerp(this.brightnessProfile.rig.hemisphere, MODERN_BACKROOMS_RIG.hemisphere.dark, this.darkness);
      this.ambientFill.intensity = THREE.MathUtils.lerp(this.brightnessProfile.rig.ambient, MODERN_BACKROOMS_RIG.ambient.dark, this.darkness);
      this.directionalKey.intensity = THREE.MathUtils.lerp(this.brightnessProfile.rig.key, MODERN_BACKROOMS_RIG.key.dark, this.darkness);
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
    this.brightnessProfile = resolveLightingBrightness(next.brightness);
    this.worldStream?.setBrightness(next.brightness);
    this.camera.fov = next.fieldOfView;
    this.camera.updateProjectionMatrix();
    this.player?.setFieldOfView(next.fieldOfView);
    this.player?.setLookSensitivity(next.lookSensitivity);
    this.player?.setCameraMotionEnabled(next.cameraMotion);
    this.character?.setSettings(this.settings);
    this.player?.setControlBindings(next.controls);
    this.audio.setMasterVolume(next.masterVolume);
    siteAudio.setMasterVolume(next.masterVolume);

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
    if (this.disposed || this.transitionSuspended) {
      if (locked) queueMicrotask(() => this.player?.unlock());
      return;
    }
    this.ui.setLocked(locked);
    this.player?.setInputEnabled(locked && !this.ui.isConsoleOpen);
    this.character?.setActive(locked && !this.ui.isConsoleOpen, true);
    if (this.rift?.locksInput) this.player?.setInputEnabled(false);
    void this.audio.setSuspended(!locked || document.hidden);
    this.previousTime = performance.now();
    this.accumulator = 0;
  };

  private async warmupPostFX(): Promise<void> {
    if (!this.postFX) return;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(320, 180, false);
    this.postFX.setSize(320, 180);
    try {
      for (let frame = 0; frame < 2; frame += 1) {
        if (this.disposed || !this.postFX) return;
        this.postFX.render(1 / 60);
        await yieldToBrowser();
      }
    } finally {
      if (!this.disposed) this.resize();
    }
    if (this.disposed || !this.postFX) return;
    // Allocate and populate the final targets once before revealing the scene.
    this.postFX.render(1 / 60);
    const context = this.renderer.getContext();
    if ('fenceSync' in context) await waitForSceneGpu(context, () => this.disposed);
    this.previousTime = performance.now();
  }

  private enter(immediate = false, event?: MouseEvent): void {
    if (this.disposed || this.transitionSuspended) return;
    if (this.options.onRequestContinue) {
      this.options.onRequestContinue();
      return;
    }
    this.ui.beginGameplay(immediate);
    siteAudio.setMenuActive(false);
    this.player?.lock(event);
    void this.audio.start();
  }

  private createRiftEncounter(): RiftEncounter | undefined {
    if (!this.player || !this.physics || !this.storyHud || !this.balanceMeter) return undefined;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    return new RiftEncounter({
      scene: this.scene,
      renderCamera: this.camera,
      player: this.player,
      physics: this.physics,
      character: this.character,
      hud: this.storyHud,
      balanceMeter: this.balanceMeter,
      sound: this.riftAudio,
      creatureSound: this.creatureAudio,
      seed: this.seed,
      creature: () => this.creature,
      baseFieldOfView: () => this.settings.fieldOfView,
      reducedMotion: () => !this.settings.cameraMotion || reduced.matches,
      keyLabel: (action) => formatKeyLabel(this.settings.controls[action]),
      say: (text) => {
        this.caption?.say(text);
        // "J'ai encore la lampe… et la boussole": the rail shows them.
        if (text === RIFT_LINES.items) this.inventoryHUD?.reveal();
      },
      captionBusy: () => !!this.caption?.isActive,
      onProgress: () => { this.saveNow('autosave'); },
    }, this.savedRift, !!this.options.arrivedByFall);
  }

  private canUseEquipment(): boolean {
    return !!this.player?.isLocked && !this.disposed && !document.hidden && !this.ui.isConsoleOpen && !this.ui.isPaused
      && !this.ui.isMainMenuOpen && !this.character?.isBusy && !this.rift?.blocksEquipment;
  }

  private readonly onInventoryWheel = (event: WheelEvent): void => {
    if (!this.inventory || !this.canUseEquipment() || event.deltaY === 0) return;
    event.preventDefault();
    this.inventory.select(event.deltaY);
    this.inventoryHUD?.reveal();
  };

  /** The torch and Chloé's compass in the right hand, exactly as in the stairwell. */
  private updateEquipment(delta: number): void {
    const inventory = this.inventory;
    if (!inventory || !this.flashlight || !this.compass) return;
    const hidden = !!this.rift?.ownsCharacter;
    const free = !hidden && !this.character?.isBusy;
    const torch = inventory.hasLamp && inventory.equipped?.id === FLASHLIGHT_ID && free;
    const reading = inventory.equipped?.id === COMPASS_ID && free;
    this.character?.setHeldItem(reading ? 'compass' : torch ? 'torch' : null);
    const frame = (reading || torch) && this.character?.getHeldItemFrame(this.palm) ? this.palm : undefined;
    const hand = this.character?.getEquipmentHandPosition(this.equipmentHand) ? this.equipmentHand : undefined;
    this.flashlight.update(this.camera, hand, inventory.hasLamp, torch, inventory.state.lampOn, delta,
      !this.settings.cameraMotion, torch && !reading ? frame : undefined);
    this.compass.update(this.camera, reading ? frame : undefined, reading && (!!frame || !this.character),
      this.rift?.creatureProximity ?? 0, delta);
  }

  private tryInteract(mode: DoorOpenMode): void {
    if (this.rift?.handleInteract()) return;
    if (!this.player || !this.worldStream || this.character?.isBusy || this.player.isTraversing || this.player.isNoclipEnabled) return;
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
    // Never in the middle of the rift: the edge shot, the plank, the creature.
    if (this.rift?.blocksSaving) return false;
    const chunk = this.worldStream.supportedCoordAt(this.lastSafePosition);
    const offset = getChunkWorldOffset(chunk);
    const look = this.player.getLookQuaternion();
    this.postFX?.render(0);
    const previewImage = captureGameSavePreview(this.renderer.domElement);
    const result = writeGameSave(this.storage, {
      experienceId: 'backrooms',
      kind,
      levelId: `backrooms-${chunk.story}`,
      levelLabel: `Niveau ${chunk.story} · Backrooms`,
      playTimeSeconds: this.playableSeconds,
      ...(previewImage ? { previewImage } : {}),
      payload: {
        seed: this.seed,
        chunk,
        ...(this.worldStream.surfaceAnchorAt(this.lastSafePosition) ? { surface: this.worldStream.surfaceAnchorAt(this.lastSafePosition) } : {}),
        localPosition: {
          x: this.lastSafePosition.x - offset.x,
          y: this.lastSafePosition.y - offset.y,
          z: this.lastSafePosition.z - offset.z,
        },
        quaternion: { x: look.x, y: look.y, z: look.z, w: look.w },
        ...(this.inventory ? { inventory: this.inventory.snapshot() } : {}),
        ...(this.rift ? { rift: this.rift.snapshot } : {}),
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
    const safeCoord = this.worldStream?.supportedCoordAt(this.lastSafePosition) ?? streamChunkCoordAt(this.lastSafePosition);
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
    this.player?.setInputEnabled(!open && !!this.player?.isLocked);
    this.character?.setActive(!open && !!this.player?.isLocked);
    if (this.rift?.locksInput) this.player?.setInputEnabled(false);
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
      VIEWMODEL_COMPLETION,
      { value: '/logs', label: '/logs', detail: 'AFFICHE OU MASQUE LE PANNEAU TECHNIQUE' },
      { value: '/geometry ', label: '/geometry uv|volumes|off', detail: 'DIAGNOSTIC DES TEXTURES ET VOLUMES' },
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
    if (normalizedCommand === 'viewmodel') return viewmodelCommand(this.character, args);
    if (normalizedCommand === 'help') {
      if (args.length > 0) {
        const feedback = 'SYNTAXE: /help';
        return { close: false, feedback, messages: [echo, { kind: 'error', text: feedback }] };
      }
      const feedback = '/viewmodel - première / troisième personne · /save - sauvegarder · /locate <cible> - teleportation · /noclip [on|off] - vol libre · /logs [on|off] - diagnostic · /geometry uv|volumes|off - textures et volumes';
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
    if (normalizedCommand === 'geometry') {
      const mode = args[0]?.toLowerCase();
      if (args.length !== 1 || !['off', 'uv', 'volumes'].includes(mode ?? '')) {
        const feedback = 'SYNTAXE: /geometry uv|volumes|off';
        return { close: false, feedback, messages: [echo, { kind: 'error', text: feedback }] };
      }
      this.worldStream?.setArchitectureDebug(mode as 'off' | 'uv' | 'volumes');
      const feedback = `DIAGNOSTIC ARCHITECTURE : ${mode!.toUpperCase()}`;
      return { close: true, feedback, messages: [echo, { kind: 'system', text: feedback }] };
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

  private hitches?: FrameHitchMonitor;
  private readonly perf = { time: 0, frames: 0, worst: 0, calls: 0, triangles: 0 };
  /** A slow stretch of play names its cost: frame times, draws and GPU resources. */
  private recordPerf(delta: number): void {
    const perf = this.perf, info = this.renderer.info;
    perf.time += delta; perf.frames += 1; perf.worst = Math.max(perf.worst, delta);
    perf.calls = Math.max(perf.calls, info.render.calls); perf.triangles = Math.max(perf.triangles, info.render.triangles);
    if (perf.time < 5) return;
    const average = perf.time / perf.frames * 1000;
    if (average > 22) {
      const clock = new Date().toLocaleTimeString('fr-FR', { hour12: false });
      console.info(`${clock} [perf] ${Math.round(perf.frames / perf.time)} fps (avg ${average.toFixed(1)} ms, worst ${Math.round(perf.worst * 1000)} ms), up to ${perf.calls} draws / ${Math.round(perf.triangles / 1000)}k triangles, ${info.programs?.length ?? 0} programs, ${info.memory.geometries} geometries, ${info.memory.textures} textures, pixel ratio ${this.pixelRatio.toFixed(2)}`);
    }
    perf.time = 0; perf.frames = 0; perf.worst = 0; perf.calls = 0; perf.triangles = 0;
  }

  private readonly frame = (now: number): void => {
    if (this.disposed || this.transitionSuspended || !this.player || !this.worldStream || !this.postFX) return;
    const frameStart = performance.now();
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
      // The rift scripts the player before the rig steps, and frames the shot after it.
      this.rift?.update(rawDelta);
      if (!this.rift?.ownsCharacter) this.character?.update(rawDelta);
      this.rift?.applyCamera();
      const partner = this.character?.getInteractionPartnerPosition();
      if (partner && (partner.distanceTo(this.player.position) > 45 || Math.abs(partner.y - this.player.position.y) > 8)) {
        this.character?.setInteractionPartner(null);
      }
      this.player.getViewDirection(this.lookDirection);
      this.worldStream.update(this.elapsed, rawDelta, this.character?.getWorldPosition() ?? this.player.position, this.lookDirection,
        this.character?.getWorldVelocity(this.streamingVelocity));
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
    this.updateJourneyHud(rawDelta, playing);
    this.player.getViewDirection(this.lookDirection);
    const interaction = !playing || this.character?.isBusy || this.player.isTraversing || this.player.isNoclipEnabled
      || this.rift?.ownsCharacter
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
    if (playing) {
      this.hitches ??= new FrameHitchMonitor(this.renderer, this.scene);
      this.hitches.check(frameStart, this.camera.position);
      this.recordPerf(measuredDelta);
    }
    this.frameCounter += 1;
    this.metricsTimer += rawDelta;
    if (this.metricsTimer >= 0.35) {
      this.metricsTimer = 0;
      this.ui.update(room, this.fps);
      this.updateDebugState(true);
    }
  };

  private readonly resize = (): void => {
    if (this.transitionSuspended) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.postFX?.setSize(width, height);
  };

  private readonly onVisibilityChange = (): void => {
    if (this.transitionSuspended) return;
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
    // Firefox deprecated WEBGL_debug_renderer_info and already unmasks RENDERER.
    const firefox = /firefox/i.test(navigator.userAgent);
    const extension = firefox ? null : gl.getExtension('WEBGL_debug_renderer_info') as {
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
      gpu: String(gl.getParameter(extension ? extension.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
      gpuVendor: String(gl.getParameter(extension ? extension.UNMASKED_VENDOR_WEBGL : gl.VENDOR)),
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

  /** One-way handoff: stop work now, release scene/GPU resources after photos. */
  suspendForTransition(): void {
    if (this.disposed || this.transitionSuspended) return;
    this.transitionSuspended = true;
    this.renderer.setAnimationLoop(null);
    this.root.style.display = 'none';
    this.worldStream?.suspendForTransition();
    this.player?.setInputEnabled(false);
    this.player?.unlock();
    this.character?.setActive(false);
    void this.audio.setSuspended(true);
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
    this.renderer.domElement.removeEventListener('wheel', this.onInventoryWheel);
    // The rift releases its scripted pose, plank collider and shot before the rig goes.
    this.rift?.dispose();
    this.creature?.dispose();
    this.creatureAudio.dispose();
    this.riftAudio.dispose();
    this.flashlight?.dispose();
    this.compass?.dispose();
    this.equipmentInput?.dispose();
    this.inventoryHUD?.dispose();
    this.caption?.dispose();
    this.questTracker?.dispose();
    this.storyHud?.dispose();
    this.balanceMeter?.dispose();
    this.character?.dispose();
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
