import { InventoryState, FLASHLIGHT_ID } from '../apartment/InventoryState';
import { InventoryHUD } from '../ui/InventoryHUD';
import { EquipmentInput } from '../input/EquipmentInput';
import { formatKeyLabel } from '../input/ControlBindings';
import { MaterialLibrary } from '../render/MaterialLibrary';
import { SprintHint } from '../ui/SprintHint';
import { Flashlight } from '../apartment/Flashlight';
import { LongCorridor } from '../apartment/LongCorridor';
import { CorridorReaction } from '../apartment/CorridorReaction';
import { BACTERIA_REVEAL_LAMP, CorridorStory, CORRIDOR_SPACING } from '../story/CorridorProgress';
import { CharacterRuntime } from '../character/CharacterRuntime';
import { viewmodelCommand, VIEWMODEL_COMPLETION } from '../character/ViewmodelCommand';
import * as THREE from 'three';
import { ApartmentLightSwitchInteraction } from '../apartment/ApartmentLightSwitchInteraction';
import { ApartmentWindowBlindsInteraction } from '../apartment/ApartmentWindowBlindsInteraction';
import { ImportedApartmentDoorInteraction } from '../apartment/ImportedApartmentDoorInteraction';
import { ImportedApartmentEnvironment } from '../apartment/ImportedApartmentEnvironment';
import { DoorPeephole } from '../apartment/DoorPeephole';
import { APARTMENT_BOUNDS } from '../apartment/layout';
import {
  AudioSystem,
  interiorRainGainForDistance,
  interiorRainRoomBleedGain,
  rainExposureForBlindClosure,
  type AudioSurface,
} from '../audio/AudioSystem';
import { siteAudio } from '../audio/SiteAudio';
import { distanceToRainOpening, rainOpeningFromBlind, type RainOpening } from '../audio/RainAcoustics';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { PlayerController } from '../player/PlayerController';
import {
  AdaptiveRenderScale,
  type RenderScaleLimits,
} from '../render/AdaptiveQuality';
import { stairwellPipelineFeatures, stairwellRenderScaleLimits } from '../render/StairwellQuality';
import {
  BACKROOMS_ATMOSPHERE,
  BACKROOMS_LEGACY_ATMOSPHERE,
} from '../render/BackroomsAtmosphere';
import { PostFX } from '../render/PostFX';
import { resolveLightingBrightness } from '../render/LightingBrightness';
import { compactSceneDataMaps, restoreSceneDataMaps, warmSceneForPlay, waitForSceneGpu } from '../render/SceneWarmup';
import { HallExitInteraction } from '../stairwell/HallExitInteraction';
import { HallArrivalStory, MAIL_STAIR_GATE, MAIL_SECOND_FLIGHT_GATE, MAIL_SAFE_LANDING } from '../stairwell/HallArrivalStory';
import { ArrivalCinematic } from '../stairwell/ArrivalCinematic';
import { prepareSadArrivalExpression } from '../stairwell/ArrivalExpression';
import { loadEntryMotions } from '../stairwell/EntryMotion';
import { LoadProgress, type LoadProgressCallback } from './LoadProgress';
import { APARTMENT_MODEL_URL } from '../apartment/ApartmentAsset';
import { ApartmentPreload } from '../apartment/ApartmentPreload';
import { NarrativeCaption } from '../ui/NarrativeCaption';
import { LetterReader } from '../ui/LetterReader';
import { QuestTracker } from '../ui/QuestTracker';
import { ApartmentQuest, hasEnteredApartment } from '../story/ApartmentQuest';
import { ComputerDesktop } from '../ui/desktop/ComputerDesktop';
import { ApartmentComputerInteraction } from '../apartment/ApartmentComputerInteraction';
import { NeighborDoorInteraction } from '../stairwell/NeighborDoorInteraction';
import { ComputerChair } from '../apartment/ComputerChair';
import { ComputerUseSequence } from '../apartment/ComputerUseSequence';
import { ApartmentFixtures } from '../apartment/ApartmentFixtures';
import { ClosetHide } from '../apartment/ClosetHide';
import { ApartmentObjectInteraction } from '../apartment/ApartmentObjectInteraction';
import { ApartmentDevices, apartmentDevicePositions } from '../apartment/ApartmentDevices';
import { ApartmentDeviceAudio } from '../audio/ApartmentDeviceAudio';
import { NeighborVoice } from '../audio/NeighborVoice';
import { SampledDoorAudio } from '../audio/SampledDoorAudio';
import { KeypadAudio } from '../audio/KeypadAudio';
import { setDoorAudioListener } from '../audio/SpatialDoorAudio';
import type { DoorOpenMode } from '../world/types';
import { useCharacterState } from '../wardrobe/studio/state/CharacterState';
import { resolveCharacterVoice } from '../audio/VoiceCatalog';
import { StairwellEnvironment } from '../stairwell/StairwellEnvironment';
import { StairwellMaterials } from '../stairwell/StairwellMaterials';
import { BacteriaActor } from '../monster/BacteriaActor';
import { BacteriaAudio } from '../monster/BacteriaAudio';
import { BacteriaEncounter } from '../monster/BacteriaEncounter';
import { BackroomsCorridor } from '../monster/BackroomsCorridor';
import { FACADE_OUTER_Z } from '../monster/BacteriaLayout';
import { EntranceDoorMotion } from '../stairwell/EntranceDoorMotion';
import { NeighborGunfire } from '../stairwell/NeighborGunfire';
import { matchesControlAction } from '../input/ControlBindings';
import type { StaticCollider } from '../world/types';
import { StoryHud } from '../ui/StoryHud';
import { createStairwellPlan } from '../stairwell/createStairwellPlan';
import { STAIRWELL_SPAWN, STAIRWELL_LEVEL_COUNT, floorY, midLandingY } from '../stairwell/layout';
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
import { captureGameSavePreview } from './SavePreview';

type RussianStairwellHistorySave = Extract<
  GameSaveEntry,
  { readonly experienceId: 'russian-stairwell' }
>;

export type RussianStairwellLaunch =
  | { readonly kind: 'new' }
  | { readonly kind: 'load'; readonly save: RussianStairwellHistorySave };

export interface RussianStairwellGameCallbacks {
  onRequestNewGame(): void;
  onRequestMainMenu(): void;
  onRequestLoadGame(id: string): void;
  onEnterBackrooms(): void;
}

const AUTOSAVE_INTERVAL_SECONDS = 30;

export class RussianStairwellGame {
  private readonly root = document.createElement('main');
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(70, 1, 0.04, 160);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly ui: ExperienceUI;
  private readonly audio = new AudioSystem('interior');
  private readonly storage: GameSaveStorage | null;
  private readonly viewDirection = new THREE.Vector3();
  private readonly lastSafePosition = new THREE.Vector3();
  private readonly renderScale: RenderScaleLimits;
  private readonly adaptiveScale: AdaptiveRenderScale;
  private renderRequested = true;
  private readonly hemisphere = new THREE.HemisphereLight();
  private readonly ambientFill = new THREE.AmbientLight();
  private readonly directionalKey = new THREE.DirectionalLight();
  private readonly apartmentRainOpenings: RainOpening[] = [];
  private settings: GameSettings;
  private physics?: PhysicsWorld;
  private player?: PlayerController;
  private character?: CharacterRuntime;
  private readonly playerCamera = this.camera.clone();
  private materials?: StairwellMaterials;
  private environment?: StairwellEnvironment;
  private apartment?: ImportedApartmentEnvironment;
  private door?: ImportedApartmentDoorInteraction;
  private peephole?: DoorPeephole;
  private keypadAudio?: KeypadAudio;
  private lightSwitch?: ApartmentLightSwitchInteraction;
  private windowBlinds?: ApartmentWindowBlindsInteraction;
  private hallExit?: HallExitInteraction;
  private arrivalStory?: HallArrivalStory;
  private arrivalCinematic?: ArrivalCinematic;
  private arrivalCompleted = false;
  private arrivalAudioElapsed?: number;
  private letterReader?: LetterReader;
  private readonly quest: ApartmentQuest;
  private readonly questTracker: QuestTracker;
  private computerDesktop?: ComputerDesktop;
  private computer?: ApartmentComputerInteraction;
  private mailGateMounted = false;
  private mailRecoil = 0;
  private neighbors?: NeighborDoorInteraction;
  private objects?: ApartmentObjectInteraction;
  private devices?: ApartmentDevices;
  private pcUse?: ComputerUseSequence;
  private readonly inventory:InventoryState;
  private readonly inventoryHUD:InventoryHUD;
  private readonly equipmentInput:EquipmentInput;
  private readonly corridorStory:CorridorStory;
  private flashlight?:Flashlight;
  private corridor?:LongCorridor;
  private reaction?:CorridorReaction;
  private corridorMounted=false;
  private exitReminderArmed=true;
  private lastLampCount=0;
  private readonly equipmentHand=new THREE.Vector3();
  private fixtures?: ApartmentFixtures;
  private closet?: ClosetHide;
  private deviceAudio?: ApartmentDeviceAudio;
  private storyCaption?: NarrativeCaption;
  private sprintHint?:SprintHint;
  private corridorMaterials?:MaterialLibrary;
  private gasPosition?:{x:number;y:number;z:number};
  private readonly neighborVoice = new NeighborVoice();
  private readonly doorAudio = new SampledDoorAudio();
  private neighborCaption?: NarrativeCaption;
  private savePreview?: string;
  private encounter?: BacteriaEncounter;
  /** Level 0 hallway behind the hall door: the way out at the end of the escape. */
  private escapeCorridor?: BackroomsCorridor;
  private escapeDoor?: EntranceDoorMotion;
  private escapeDoorOpen = -1;
  private stairwellColliders: readonly StaticCollider[] = [];
  /** The cage is back behind the apartment door (after the hiding, or on a later load). */
  private stairwellRestored = false;
  private postOutageSettled = false;
  /** Seconds before the corridor troffers die once the door gave way (-1 = lit). */
  private corridorBlackout = -1;
  private sprintHeld = false;
  private gunfire?: NeighborGunfire;
  /** Shot by a neighbour: scripted fall, death card, then back on the landing. */
  private shotDeath?: { time: number; from: THREE.Vector3; quaternion: THREE.Quaternion; floor: number; direction: THREE.Vector3; respawn: THREE.Vector3 };
  private readonly playerVelocity = new THREE.Vector3();
  private readonly previousPlayerPosition = new THREE.Vector3();
  private readonly bacteriaAudio = new BacteriaAudio(() => this.audio.getOutput());
  private readonly storyHud: StoryHud;
  private questHold = 0;
  private readonly loadingAbort = new AbortController();
  private postFX?: PostFX;
  private pixelRatio: number;
  private accumulator = 0;
  private elapsed = 0;
  private playableSeconds = 0;
  private autosaveElapsed = 0;
  private previousTime = performance.now();
  private fps = 60;
  private saveErrorShown = false;
  private initialized = false;
  private disposed = false;
  private transitionSuspended = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly launch: RussianStairwellLaunch,
    private readonly callbacks: RussianStairwellGameCallbacks,
    private readonly options: { deferEntry?: boolean; apartmentPreload?: ApartmentPreload; loadProgress?: LoadProgress; skipArrival?: () => boolean } = {},
  ) {
    this.settings = loadGameSettings();
    try {
      this.storage = window.localStorage;
    } catch {
      this.storage = null;
    }
    this.renderScale = stairwellRenderScaleLimits(
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
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = false;
    this.root.append(this.renderer.domElement);
    this.renderer.domElement.addEventListener('click', this.onCanvasClick);
    this.renderer.domElement.addEventListener('mousedown', this.onWorldMouseDown, true);
    this.renderer.domElement.addEventListener('wheel', this.onObjectWheel, { passive: false });
    document.addEventListener('mousemove', this.onObjectMouseMove, true);
    document.addEventListener('mouseup', this.onObjectMouseUp, true);
    this.ui = new ExperienceUI(this.root, {
      enter: event => this.enter(false, event),
      pause: () => this.pause(),
      regenerate: () => this.callbacks.onRequestNewGame(),
      returnToMainMenu: () => {
        this.saveNow('autosave');
        this.callbacks.onRequestMainMenu();
      },
      saveGame: () => this.saveNow('manual'),
      loadGame: (id) => this.callbacks.onRequestLoadGame(id),
      toggleFullscreen: () => void this.toggleFullscreen(),
      settingsChanged: (settings) => this.applySettings(settings),
      submitConsole: (value, mode) => this.submitConsole(value, mode),
      completeConsole: (value, mode) => this.completeConsole(value, mode),
      consoleVisibility: (open) => {
        this.player?.setInputEnabled(!open && !!this.player?.isLocked && !this.pcUse?.isActive && !this.corridorStory?.modal);
        this.character?.setActive(!open && !!this.player?.isLocked && !this.pcUse?.isActive && !this.corridorStory?.modal);
      },
    }, this.settings, 'russian-stairwell');
    this.quest = new ApartmentQuest(this.launch.kind === 'load' ? this.launch.save.payload.computer : undefined, () => {
      if (this.initialized) this.saveNow('autosave');
    }, this.launch.kind === 'load' ? this.launch.save.payload.apartmentLightOn : false);
    this.questTracker = new QuestTracker(this.root);
    const saved=this.launch.kind==='load'?this.launch.save.payload:undefined;
    this.inventory=new InventoryState(saved?.inventory);this.corridorStory=new CorridorStory(saved?.corridor);
    this.inventoryHUD=new InventoryHUD(this.root);
    this.equipmentInput=new EquipmentInput(()=>this.settings.controls,()=>this.canUseEquipment(),()=>{
      if(!this.objects?.isHolding&&this.inventory.toggleLamp()){this.inventoryHUD.reveal();this.deviceAudio?.fixtureClick(this.camera.position);this.saveNow('autosave');}
    },()=>this.storeEquipment());
    this.storyHud = new StoryHud(this.root);
    this.scene.background = new THREE.Color(0x090d11);
    this.scene.fog = new THREE.Fog(0x10161c, 16, 52);
    this.configureBackroomsLighting();
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onConsoleHotkey);
    window.addEventListener('keydown', this.onSprintKey, true);
    window.addEventListener('keyup', this.onSprintKey, true);
    window.addEventListener('blur', this.onSprintBlur);
    window.addEventListener('pagehide', this.onPageHide);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  async initialize(onProgress: LoadProgressCallback = () => undefined): Promise<void> {
    const progress = this.options.loadProgress ?? new LoadProgress();
    progress.subscribe(onProgress);
    const preload = this.options.apartmentPreload ?? new ApartmentPreload(APARTMENT_MODEL_URL, event => {
      progress.apartment(event);
    });
    progress.start('audio');
    if (this.options.deferEntry) this.audio.setInteriorMix(0);
    const audioReady = this.audio.start(value => progress.report('audio', value * .7));
    void audioReady.catch(() => undefined);
    await this.audio.setSuspended(true);
    const bacteriaReady = BacteriaActor.load(this.loadingAbort.signal).catch(error => {
      if (!this.disposed) console.warn('Rencontre Bacteria indisponible.', error);
      return null;
    });
    const escapeReady = BackroomsCorridor.load(this.renderer).catch(error => {
      if (!this.disposed) console.warn('Couloir de fuite indisponible.', error);
      return null;
    });
    void this.bacteriaAudio.load();

    const plan = createStairwellPlan();
    this.stairwellColliders = plan.colliders;
    const materialsReady = progress.measure('materials', () => StairwellMaterials.load(this.renderer));
    progress.start('physics');
    const environmentReady = materialsReady.then(materials => StairwellEnvironment.load(materials.materials, this.loadingAbort.signal));
    const [physicsResult, materialsResult, apartmentResult, environmentResult] = await Promise.allSettled([
      PhysicsWorld.create(plan).then(physics => { progress.end('physics'); progress.report('physics', .25); return physics; }), materialsReady,
      ImportedApartmentEnvironment.load(this.loadingAbort.signal, preload, progress).then(apartment => { progress.complete('scene'); return apartment; }), environmentReady,
    ]);
    if (physicsResult.status === 'rejected' || materialsResult.status === 'rejected'
      || apartmentResult.status === 'rejected' || environmentResult.status === 'rejected') {
      if (physicsResult.status === 'fulfilled') physicsResult.value.dispose();
      if (materialsResult.status === 'fulfilled') materialsResult.value.dispose();
      if (apartmentResult.status === 'fulfilled') apartmentResult.value.dispose();
      if (environmentResult.status === 'fulfilled') environmentResult.value.dispose();
      const failure = [physicsResult, materialsResult, apartmentResult, environmentResult].find(result => result.status === 'rejected') as PromiseRejectedResult;
      throw failure.reason;
    }
    const physics = physicsResult.value;
    const materials = materialsResult.value;
    const apartment = apartmentResult.value;
    if (this.disposed) {
      physics.dispose();
      materials.dispose();
      apartment.dispose();
      environmentResult.value.dispose();
      return;
    }
    this.materials = materials;
    this.physics = physics;
    this.apartment = apartment;
    const environment = environmentResult.value;
    if (this.disposed) {
      environment.dispose();
      return;
    }
    environment.setLightingMode(this.settings.lighting);
    environment.setBrightness(this.settings.brightness);
    apartment.setBrightness(this.settings.brightness);
    this.environment = environment;
    progress.start('physics');
    this.scene.add(environment.group, apartment.group);
    if (environment.furnitureColliders.length > 0) {
      physics.addChunk(
        'stairwell-furniture',
        environment.furnitureColliders,
        { x: 0, y: 0, z: 0 },
      );
    }
    apartment.group.updateMatrixWorld(true);
    await physics.addTrimeshChunkAsync('imported-apartment-shell', apartment.shellColliderMeshes, this.loadingAbort.signal);
    if (apartment.furnitureColliders.length > 0) {
      physics.addChunk(
        'imported-apartment-furniture',
        apartment.furnitureColliders,
        { x: 0, y: 0, z: 0 },
      );
    }
    progress.complete('physics');

    this.camera.fov = this.settings.fieldOfView;
    this.camera.updateProjectionMatrix();
    this.playerCamera.copy(this.camera);
    this.player = new PlayerController(this.playerCamera, this.renderer.domElement, physics, {
      onLockChange: (locked) => this.onPlayerLockChange(locked),
      onPointerCaptureChange: captured => this.ui.setPointerCaptureRequired(!captured),
      onFootstep: (strength) => this.audio.footstep(this.currentSurface(), strength),
      onMovementAudioState: (state) => this.audio.setMovementState(this.currentSurface(), state),
      onInteract: mode => this.tryInteract(mode),
      onLand: (impactSpeed, impact) => {
        this.audio.land(this.currentSurface(), impactSpeed);
        this.character?.handleLanding(impactSpeed, impact);
      },
      onSafePosition: () => physics.getStandingPosition(this.lastSafePosition),
      onFallReset: () => {
        this.audio.land(this.currentSurface(), 18);
        this.ui.showFall();
      },
    });
    this.player.setFieldOfView(this.settings.fieldOfView);
    this.player.setLookSensitivity(this.settings.lookSensitivity);
    this.player.setCameraMotionEnabled(this.settings.cameraMotion);
    this.player.setControlBindings(this.settings.controls);
    this.player.setMovementCapabilities({ sprint: false, jump: false });
    this.audio.setMasterVolume(this.settings.masterVolume);
    siteAudio.setMasterVolume(this.settings.masterVolume);
    this.neighborVoice.setVolume(this.settings.masterVolume);
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
        beforeOpen:()=>this.allowEntranceOpening(),
        closedAngle: apartment.entryDoor.closedAngle,
        openAngle: apartment.entryDoor.openAngle,
        lockTarget: apartment.doorLock,
        onLockChange: (locked) => apartment.setEntryDoorLocked(locked),
        onSound: (sound) => {
          if (sound === 'lock' || sound === 'unlock') {
            this.audio.lock(sound === 'lock');
          } else {
            this.audio.door(sound);
          }
        },
        onPush: (delta) => this.player?.queueExternalMotion(delta),
      },
    );
    this.lightSwitch = new ApartmentLightSwitchInteraction(
      apartment.lightSwitch,
      this.ui,
      () => this.quest.devices.lightOn,
      (enabled) => {
        this.quest.setLight(enabled);
        apartment.setInteriorLightsEnabled(this.quest.devices.lightOn);
      },
      2.2,
      (enabled) => this.audio.lightSwitch(enabled),
    );
    this.windowBlinds = new ApartmentWindowBlindsInteraction(
      apartment.windowBlinds,
      this.ui,
      2.8,
      (opening) => this.audio.blinds(opening),
    );
    // Cache the full fixed window extents while both imported blinds are open,
    // before restoring a save. Never measure the moving blind during playback.
    for (const blind of apartment.windowBlinds) {
      blind.blind.updateWorldMatrix(true, true);
      this.apartmentRainOpenings.push(rainOpeningFromBlind(
        new THREE.Box3().setFromObject(blind.blind), blind.closedScaleY,
      ));
    }
    if (!environment.hallEntranceDoor) {
      throw new Error('La porte du hall d’escalier est absente.');
    }
    this.hallExit = new HallExitInteraction(
      environment.hallEntranceDoor,
      this.ui,
      () => this.callbacks.onEnterBackrooms(),
    );
    if (!environment.entranceMailbox) throw new Error('Les boîtes aux lettres du hall sont indisponibles.');
    const config = useCharacterState.getState().config;
    const voice = resolveCharacterVoice(config.voiceId, config.body.gender);
    const voiceReady = siteAudio.prepareVoice(voice).catch(() => undefined);
    
    this.sprintHint=new SprintHint(this.root);
    this.letterReader = new LetterReader(this.root, () => {
      this.neighbors?.suspend();
      this.player?.setInputEnabled(false); this.player?.unlock();
      this.character?.setActive(false); this.ui.setInteraction(null);
    }, event => {
      // Never resume under the pause menu or the console; the closing click
      // itself requests pointer capture, and look stays frozen until granted.
      if (this.disposed || this.ui.isPaused || this.ui.isConsoleOpen) return;
      this.enter(true, event);
    });
    this.computerDesktop = new ComputerDesktop(this.root, this.quest, () => {
      this.root.classList.add('is-using-computer');
      this.objects?.release(); this.neighbors?.suspend();
      this.questTracker.update(this.currentObjective(), true);
      this.player?.unlock(); this.player?.setInputEnabled(false); this.character?.setActive(false);
      this.ui.setPointerCaptureRequired(false); this.ui.setInteraction(null);
      void this.audio.setSuspended(document.hidden);
    }, () => {
      this.root.classList.remove('is-using-computer');
      if(this.pcUse?.isActive)this.pcUse.close();
      else if (!this.disposed) this.enter(true);
    }, () => { this.deviceAudio?.unlock(); this.deviceAudio?.click(); });
    if (apartment.computer) this.computer = new ApartmentComputerInteraction(apartment.computer, this.camera, physics, this.ui, () => this.pcUse?.start(), () => this.quest.isComputerBlocked, () => this.quest.isComputerAvailable);
    const narrative = new NarrativeCaption(this.root);
    this.arrivalStory = new HallArrivalStory(
      environment.entranceMailbox, this.ui, narrative,
      this.launch.kind === 'new' ? 'approach' : this.launch.save.payload.arrivalState ?? 'done',
      cue => siteAudio.playVoice(voice, cue),
      () => { this.autosaveElapsed = AUTOSAVE_INTERVAL_SECONDS; this.syncMailGate(); if (this.initialized) this.saveNow('autosave'); },
      { showLetter: onVisible => this.letterReader!.open(onVisible), mailGaspPlayed: this.launch.kind === 'load' ? this.launch.save.payload.mailGaspPlayed : false },
    );
    this.syncMailGate();
    this.neighborCaption = new NarrativeCaption(this.root);
    this.neighbors = new NeighborDoorInteraction(apartment.group, this.ui, {
      sound: (kind, position, id) => this.doorAudio.play(kind, position, id),
      say: text => this.neighborCaption?.say(text, true),
      speak: (id, actor, cue, position,delivery) => this.neighborVoice.play(id, actor, cue, position,delivery),
      voiceDuration: (actor,cue) => this.neighborVoice.duration(actor,cue),
      stopVoice: () => { this.neighborVoice.stop();this.doorAudio.stop(); }, hideCaption: () => this.neighborCaption?.clear(),
      subtitles: () => this.settings.subtitles !== false, soundCaptions: () => this.settings.soundCaptions === true,
      changed: () => { if (this.initialized) this.saveNow('autosave'); },
      gunfire: (id, leaf, center) => this.gunfire?.fire(id, leaf, center),
    }, environment.doorbells, this.launch.kind === 'load' ? this.launch.save.payload.neighbors : undefined, voice,apartment.entryDoor.leaf);
    const bus = this.audio.spatialBus!;
    this.gunfire = new NeighborGunfire({
      scene: this.scene, physics,
      audio: () => this.audio.getOutput(),
      playerCenter: out => out.copy(this.player!.position),
      playerVelocity: out => out.copy(this.playerVelocity),
      listener: out => { out.position.copy(this.camera.position); this.camera.getWorldDirection(this.viewDirection); out.right.crossVectors(this.viewDirection, new THREE.Vector3(0, 1, 0)).normalize(); },
      doorSound: (kind, position, id) => { if (kind === 'slam') this.doorAudio.play('slam', position, id); else this.audio.door('open'); },
      flash: level => this.storyHud.pulseFlash(level),
      shake: () => undefined,
      onPlayerHit: direction => this.startShotDeath(direction),
    });
    this.keypadAudio=new KeypadAudio(bus);
    this.peephole=new DoorPeephole(apartment.entryDoor.leaf,apartment.entryDoor.pivot,apartment.entryDoor.closedBox,
      this.camera,this.root,this.ui,()=>this.settings.controls,active=>{
        if(active)this.objects?.release();
        const resume=!active&&!this.disposed&&!this.transitionSuspended&&!!this.player?.isLocked&&!this.ui.isConsoleOpen;
        this.player?.setInputEnabled(resume);
        this.character?.setActive(resume);
      });
    this.deviceAudio = new ApartmentDeviceAudio(bus, { ...apartmentDevicePositions(apartment), panel: { x: -2.45, y: apartment.floorY + 1.9, z: -2.2 } }, () => this.quest.setRadioTrack(this.quest.devices.radioTrack + 1));
    this.devices = new ApartmentDevices(apartment, physics, this.camera, this.ui, this.quest, this.deviceAudio);
    await this.devices.prepare();
    if(this.disposed)return;
    this.storyCaption = new NarrativeCaption(this.root);
    const neighborAudioReady = Promise.all([this.neighborVoice.prepare(bus, this.neighbors.voices), this.doorAudio.prepare(bus)]);
    void neighborAudioReady.catch(() => undefined);
    this.objects = new ApartmentObjectInteraction(physics, this.scene, apartment.pickables, this.camera, this.ui,
      (position, kind, audible) => { if(audible!==false){if(kind==='pot'||kind==='ceramic')this.deviceAudio?.ceramic(position);else this.deviceAudio?.glass(position);}if(kind==='whisky')this.quest.breakWhisky(); }, this.quest.devices.whiskyBroken, this.launch.kind === 'load' ? this.launch.save.payload.objects : undefined);
    this.objects.setStored(this.inventory.storedIds);
    this.gasPosition=apartmentDevicePositions(apartment).gas;
    this.flashlight=new Flashlight(this.scene,physics,apartment.group.getObjectByName('Desk'));
    this.inventoryHUD.setObjectSources(apartment.pickables,this.flashlight.model);
    this.corridorMaterials=await MaterialLibrary.load(this.renderer,undefined,'yellow');
    if(this.disposed){this.corridorMaterials.dispose();return;}
    this.corridor=new LongCorridor(apartment.corridorDoorway,apartment.corridorFloorY,this.corridorMaterials.materials,physics);
    this.scene.add(this.corridor.group);
    await this.corridor.prepare();
    if(this.disposed)return;
    this.player.setMovementConstraint((position,movement)=>this.constrainExit(position,movement));
    this.fixtures = new ApartmentFixtures(apartment, physics, this.objects, this.camera, this.ui, this.deviceAudio,
      () => !this.quest.devices.outageTriggered||this.corridorStory.state.apartmentRelit, this.launch.kind === 'load' ? this.launch.save.payload.fixtures : undefined);
    this.fixtures.setBrightness(this.settings.brightness);

    if (this.launch.kind === 'load') {
      this.door.restoreState(this.launch.save.payload.entranceDoor);
      apartment.setInteriorLightsEnabled(this.quest.devices.lightOn);
      this.windowBlinds.restoreState(this.launch.save.payload.windowBlindsOpen ?? [true, true]);
      this.player.teleport(this.launch.save.payload.safePosition);
      this.player.setLookQuaternion(this.launch.save.payload.quaternion);
      this.playableSeconds = this.launch.save.playTimeSeconds;
    } else {
      this.player.teleport(STAIRWELL_SPAWN);
      this.player.setLookQuaternion(new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 1),
      ));
    }
    this.applyApartmentPower();
    this.lastSafePosition.copy(this.player.position);
    if (this.arrivalStory.blocksStairs && this.player.position.y > MAIL_SAFE_LANDING.y + .2) {
      this.player.teleport(MAIL_SAFE_LANDING); this.lastSafePosition.copy(this.player.position);
    }

    progress.start('character');
    this.character = new CharacterRuntime({
      container: this.root, canvas: this.renderer.domElement, scene: this.scene,
      playerCamera: this.playerCamera, renderCamera: this.camera,
      physics: this.physics!, player: this.player, settings: this.settings, seed: 'apartment',
      isPlaying: () => !!this.player?.isLocked && !this.ui.isPaused && !document.hidden && !this.ui.isConsoleOpen && !this.computerDesktop?.isOpen && !this.letterReader?.isOpen && !this.pcUse?.isActive && !this.corridorStory?.modal,
      beforePhysicsStep: delta => {
        if (this.character?.isBusy) this.objects?.release();
        else this.objects?.beforePhysicsStep();
        const stairwell = !this.corridorMounted && this.currentSurface() === 'stairwell-concrete';
        this.player!.setMovementCapabilities({ sprint: !stairwell || !!this.encounter?.isActive, jump: !stairwell });
        this.player!.getViewDirection(this.viewDirection);
        const intent = this.player!.getMovementIntent();
        if (this.arrivalStory?.tryStairs(this.player!.position,
          intent.forward * this.viewDirection.z + intent.right * this.viewDirection.x)) {
          this.mailRecoil = .18; this.player!.setInputEnabled(false);
        }
        if (this.mailRecoil > 0) {
          this.mailRecoil = Math.max(0, this.mailRecoil - delta);
          this.player!.queueExternalMotion({ x: 0, y: 0, z: -Math.min(1.1 * delta, Math.max(0, this.player!.position.z - MAIL_SAFE_LANDING.z)) });
          if (this.mailRecoil === 0) this.player!.setInputEnabled(!this.ui.isConsoleOpen && !(this.letterReader?.isOpen || this.computerDesktop?.isOpen) && !this.character?.isBusy);
        }
        this.door?.update(delta, this.player!.position, this.viewDirection, !this.character?.isBusy);
      },
    });
    await this.character.initialize();
    if (this.disposed) return;
    this.character.setActive(false);
    this.closet = new ClosetHide(apartment, physics, this.camera, this.ui, {
      position: () => this.player!.position,
      pose: (position, confined) => this.player?.setScriptedPose(position, confined),
      presentation: active => this.character?.setExternalCameraPresentation(active),
      active: active => {
        if(active)this.objects?.release();
        const resume = !active && !this.disposed && !this.transitionSuspended && !!this.player?.isLocked && !this.ui.isConsoleOpen;
        this.player?.setInputEnabled(resume); this.character?.setActive(resume);
      },
      playing: () => !this.disposed && !this.transitionSuspended && !!this.player?.isLocked && !this.ui.isConsoleOpen && !document.hidden,
      bindings: () => this.settings.controls,
    }, this.launch.kind === 'load' ? this.launch.save.payload.fixtures?.closetDoor : undefined);

    if(!apartment.computerChair)throw Error('La chaise du PC est absente.');
    this.pcUse=new ComputerUseSequence(new ComputerChair(apartment.computerChair,apartment.group,physics),physics,this.camera,{
      position:()=>this.player!.position,
      pose:(position,confined,shape)=>this.player?.setScriptedPose(position,confined,shape),
      begin:()=>{this.player?.prepareScriptedStanding();this.character?.beginComputerPresentation();},
      sample:(sample,firstPerson)=>this.character!.sampleComputerPresentation(sample,firstPerson),
      end:firstPerson=>{this.player?.setLookQuaternion(this.camera.quaternion);this.character?.endComputerPresentation(firstPerson);return this.camera.clone();},
      modal:active=>{
        this.root.classList.toggle('is-using-pc-sequence',active);
        if(!active&&!this.disposed&&this.player)this.physics?.getStandingPosition(this.lastSafePosition);
        if(active){this.objects?.release();this.neighbors?.suspend();this.ui.setInteraction(null);}
        const resume=!active&&!this.disposed&&!this.transitionSuspended&&!!this.player?.isLocked&&!this.ui.isConsoleOpen;
        this.player?.setInputEnabled(resume);this.character?.setActive(resume);
      },
      openDesktop:()=>this.computerDesktop?.open(),
      closeDesktop:()=>{this.computerDesktop?.interrupt();this.root.classList.remove('is-using-computer');},
      resume:()=>{if(!this.disposed&&!this.transitionSuspended)this.enter(true);},
      blocked:()=>this.quest.isComputerBlocked,
      hint:text=>this.ui.setInteraction(text),
      chairSound:()=>this.deviceAudio?.chairMotion({x:-6.97,y:9.14,z:-4.49}),
      changed:()=>{this.renderRequested=true;},
      reducedMotion:()=>!this.settings.cameraMotion||matchMedia('(prefers-reduced-motion: reduce)').matches,
    },this.launch.kind==='load'?this.launch.save.payload.pcUse:undefined);
    if(this.launch.kind==='load'&&this.launch.save.payload.pcUse){
      const saved=this.launch.save.payload.pcUse;
      if(!['standing','blocked'].includes(saved.phase)){
        const safe=this.physics!.canStandAt(saved.safePosition)?saved.safePosition:{x:-6.25,y:9.5363203,z:-3.65};
        this.player.setScriptedPose(safe,false);this.lastSafePosition.copy(safe);
      }
    }

    if (this.options.deferEntry && this.launch.kind === 'new' && !this.options.skipArrival?.()) {
      const motions = await loadEntryMotions(this.loadingAbort.signal);
      if (this.disposed) return;
      const selected = this.character.createArrivalAvatar();
      const releaseExpression = await prepareSadArrivalExpression(selected.avatar, this.loadingAbort.signal);
      if (this.disposed) { releaseExpression(); return; }
      this.arrivalCinematic = new ArrivalCinematic(this.scene, this.root, selected.avatar, selected.idle, motions, environment.hallEntranceDoor!, {
        onAmbienceBlend: () => { this.arrivalAudioElapsed ??= 0; void this.audio.setSuspended(false); },
        onPOVBlend: () => {},
        onPOVReveal: () => this.character?.setArrivalPresentation(false),
        onDispose: releaseExpression,
        onComplete: () => {
          this.root.classList.remove('is-arrival-cinematic');
          this.character?.setArrivalPresentation(false);
          this.arrivalCompleted = true;
          this.physics?.getStandingPosition(this.lastSafePosition);
          this.enter(true);
          this.saveNow('autosave');
        },
        onDoorSound: opening => this.audio.door(opening ? 'open' : 'close'),
        onKeypadPress: position => this.keypadAudio?.click(position),
        onStopKeypad: () => this.keypadAudio?.stop(),
      });
      this.player.teleport(this.arrivalCinematic.finalStandingPosition);
      this.lastSafePosition.copy(this.player.position);
    }

    const [bacteria, escapeCorridor] = await Promise.all([bacteriaReady, escapeReady]);
    if (this.disposed) {
      bacteria?.dispose();
      escapeCorridor?.dispose();
      return;
    }
    if (escapeCorridor) {
      this.escapeCorridor = escapeCorridor;
      this.scene.add(escapeCorridor.group);
    }
    this.stairwellRestored = !!this.corridorStory.state.bacteriaSurvived;
    if (bacteria) {
      this.encounter = new BacteriaEncounter({
        scene: this.scene,
        renderCamera: this.camera,
        eyeCamera: this.playerCamera,
        player: this.player,
        threshold: this.corridor.threshold,
        door: this.door,
        hideSpot: {
          canHide: () => !!this.closet && this.closet.isTargeted,
          hide: () => { if (!this.closet) return; this.closet.exitLocked = true; if (!this.closet.isActive) this.closet.enterNow(); },
          release: () => this.closet?.requestExit(),
          forceOut: () => this.closet?.forceFinish(),
        },
        television: apartment.television,
        audio: this.audio,
        hud: this.storyHud,
        setPrompt: (label) => this.ui.setInteraction(label),
        baseFieldOfView: () => this.settings.fieldOfView,
        sprintKeyLabel: () => formatKeyLabel(this.settings.controls.sprint),
        isSprintHeld: () => this.sprintHeld,
        setAvatarHidden: (hidden) => this.character?.setArrivalPresentation(hidden),
        canStartReveal: () => this.corridorMounted && this.inventory.hasLamp && !this.character?.isBusy
          && this.corridorStory.canStartBacteria(this.player!.position, this.corridor!.threshold),
        isRevealLampLit: () => this.corridorStory.litCount > BACTERIA_REVEAL_LAMP && (this.corridor?.lampLevel(BACTERIA_REVEAL_LAMP) ?? 1) > .5,
        isTelevisionOn: () => this.quest.devices.tvOn,
        onReveal: () => {
          this.objects?.release();
          this.storyCaption?.hide();
          this.ui.setInteraction(null);
        },
        onBreach: () => { this.corridorBlackout = .85; },
        restoreStairwell: () => this.restoreStairwell(),
        openEscape: () => this.openEscape(),
        onRetry: (checkpoint) => {
          if (checkpoint === 'corridor') {
            this.corridorBlackout = -1;
            this.corridorStory.rewindBacteria();
            this.lastSafePosition.copy(this.player!.position);
            this.saveNow('autosave');
          }
        },
        onEscaped: () => this.escapeToBackrooms(),
      }, bacteria, this.bacteriaAudio);
      if (this.stairwellRestored) this.encounter.resumeAftermath();
    }

    this.character.beginComputerPresentation();this.character.endComputerPresentation(false);
    this.syncCorridor();
    this.reaction=new CorridorReaction(this.scene,this.corridorStory,this.character,this.player,this.camera,apartment.doorCenter,apartment.corridorFloorY);
    progress.complete('character');
    progress.start('gpu');
    this.postFX = new PostFX(
      this.renderer,
      this.scene,
      this.camera,
      this.settings.lighting,
      { bloom: false, antialias: 'fxaa' },
    );
    this.applyRenderFeatures(0);
    this.resize();
    if (this.settings.renderQuality !== 'quality') compactSceneDataMaps(this.scene);
    await this.postFX.waitUntilReady();
    if (this.disposed) return;
    this.renderer.setPixelRatio(1); this.renderer.setSize(320, 180, false); this.postFX.setSize(320, 180);
    await warmSceneForPlay({
      renderer: this.renderer, scene: this.scene, camera: this.camera,
      roots: [
        ...this.character.renderWarmupRoots,
        this.corridor.group,
        ...(this.arrivalCinematic?.warmupRoots ?? []),
        ...(bacteria?.warmupRoots ?? []),
        ...(this.escapeCorridor ? [this.escapeCorridor.group] : []),
        ...(this.gunfire?.warmupRoots ?? []),
      ],
      staticRoots: [apartment.renderWarmupRoot],
      viewpoints: [
        ...Array.from({ length: STAIRWELL_LEVEL_COUNT }, (_, level) => ({
          position: new THREE.Vector3(-.7, floorY(level) + 1.6, -2.5),
          target: new THREE.Vector3(-.7, floorY(level) + 1.8, 1),
        })),
        ...Array.from({ length: STAIRWELL_LEVEL_COUNT - 1 }, (_, level) => ({
          position: new THREE.Vector3(.7, midLandingY(level) + 1.6, 2.3),
          target: new THREE.Vector3(.7, floorY(level + 1) + 1.3, -2),
        })),
        { position: apartment.entrySpawn.clone().add(new THREE.Vector3(0, .65, 0)),
          target: new THREE.Vector3((APARTMENT_BOUNDS.minX + APARTMENT_BOUNDS.maxX) / 2,
            apartment.floorY + 1.5, (APARTMENT_BOUNDS.minZ + APARTMENT_BOUNDS.maxZ) / 2) },
      ],
      cancelled: () => this.disposed,
      render: () => this.postFX?.render(1 / 60),
      onProgress: (value, phase) => progress.report('gpu', value * .95, phase),
      onTiming: (phase, ms) => progress.recordOperation(`gpu.${phase}`, ms),
    });
    if (this.disposed) return;
    this.resize();
    progress.report('gpu', .96, 'Préparation de la résolution de jeu');
    this.postFX.render(0);
    const finalContext=this.renderer.getContext();
    if('fenceSync' in finalContext)await waitForSceneGpu(finalContext, () => this.disposed);
    if(this.disposed)return;
    this.savePreview = this.launch.kind === 'load' ? this.launch.save.previewImage : captureGameSavePreview(this.renderer.domElement);
    progress.complete('gpu');
    progress.start('audio');
    await Promise.all([audioReady, voiceReady, neighborAudioReady]);
    progress.complete('audio');
    if (this.disposed) return;
    this.initialized = true;
    this.syncSaveHistory();
    this.ui.setSessionStarted(true);
    this.previousTime = performance.now();
    this.saveNow('autosave');
    this.ui.setReady();
    progress.finish();
    this.previousTime = performance.now();
    // The cinematic owns the screen: retain the warmed frame without running
    // a hidden 3D render/physics loop throughout the six photographic shots.
    if (!this.options.deferEntry) {
      this.renderer.setAnimationLoop(this.frame);
      this.enter(true);
    }
  }

  enterAfterIntro(): void {
    if (!this.initialized || this.disposed || this.transitionSuspended) return;
    this.arrivalCinematic?.dispose(); this.arrivalCinematic = undefined;
    this.character?.setArrivalPresentation(false);
    siteAudio.stopStoryMusic();
    this.audio.setInteriorMix(1);
    this.previousTime = performance.now();
    this.accumulator = 0;
    this.arrivalCompleted = true;
    this.renderer.setAnimationLoop(this.frame);
    this.enter(true);
  }

  startArrivalCinematic(): void {
    if (!this.initialized || this.disposed || this.transitionSuspended) return;
    if (!this.arrivalCinematic) { this.enterAfterIntro(); return; }
    this.ui.beginGameplay(true);
    this.root.classList.add('is-arrival-cinematic');
    this.player?.setInputEnabled(false);
    const pov = this.camera.clone();
    this.character?.getArrivalPOV(pov);
    this.character?.setArrivalPresentation(true);
    this.arrivalCinematic.start(pov);
    this.arrivalCinematic.sample(0, this.camera);
    this.postFX?.render(0);
    this.previousTime = performance.now(); this.accumulator = 0;
    void this.audio.start().catch(() => undefined);
    this.renderer.setAnimationLoop(this.frame);
  }

  private enter(immediate = false, event?: MouseEvent): void {
    if (this.disposed || this.transitionSuspended) return;
    this.ui.beginGameplay(immediate);
    siteAudio.setMenuActive(false);
    this.computerDesktop?.setPaused(false); this.letterReader?.setPaused(false);
    if (!(this.computerDesktop?.isOpen || this.letterReader?.isOpen || this.arrivalCinematic?.isShowing)) this.player?.lock(event);
    this.previousTime = performance.now(); this.accumulator = 0;
    this.deviceAudio?.sync(this.quest.devices, !document.hidden);
    if (this.arrivalAudioElapsed !== undefined) siteAudio.setStoryMusicPaused(document.hidden);
    void this.audio.start().catch(() => {
      this.ui.showConsoleMessage({ kind: 'error', text: 'AUDIO INDISPONIBLE' });
    });
  }

  private pause(): void {
    if (this.disposed || this.transitionSuspended) return;
    this.ui.setLocked(false);
    this.computerDesktop?.setPaused(true); this.letterReader?.setPaused(true);
    this.player?.unlock(); this.onPlayerLockChange(false);
  }

  private tryInteract(mode: DoorOpenMode = 'fast'): void {
    if(this.pcUse?.isActive||this.corridorStory?.modal||this.shotDeath)return;
    if (!this.player || !this.door || this.character?.isBusy || (this.letterReader?.isOpen || this.computerDesktop?.isOpen) || this.mailRecoil > 0) return;
    if (this.closet?.isActive) { this.closet.interact(); return; }
    this.camera.getWorldDirection(this.viewDirection);
    if (this.encounter?.isActive || this.encounter?.isHidden) {
      if (!this.player.isLocked || this.ui.isConsoleOpen) return;
      if (this.encounter.interact(this.player.position, this.viewDirection) || this.encounter.locksInput) return;
      this.door.interact(this.player.position, this.viewDirection, true);
      return;
    }
    if(this.player.isLocked&&!this.ui.isConsoleOpen&&this.pickupFlashlight())return;
    if(this.player.isLocked&&!this.ui.isConsoleOpen&&this.peephole?.interact())return;
    if (this.player.isLocked && !this.ui.isConsoleOpen && !this.objects?.isHolding && (this.fixtures?.interact() || this.closet?.interact())) return;
    if (this.player.isLocked && !this.ui.isConsoleOpen && !this.objects?.isHolding && this.devices?.interact()) return;
    if (this.player.isLocked && !this.ui.isConsoleOpen && !this.objects?.isHolding && this.computer?.interact()) return;
    if (this.player.isLocked && !this.ui.isConsoleOpen && this.objects?.interact()) return;
    if (this.arrivalStory?.interact(this.player.position, this.viewDirection, this.player.isLocked && !this.ui.isConsoleOpen)) {
      this.player.setInputEnabled(false); return;
    }
    if (this.neighbors?.interact(this.player.position, this.viewDirection, this.player.isLocked && !this.ui.isConsoleOpen, mode, this.camera.position)) return;
    if (this.lightSwitch?.interact(
      this.player.position,
      this.viewDirection,
      this.player.isLocked,
    )) return;
    if (this.windowBlinds?.interact(
      this.player.position,
      this.viewDirection,
      this.player.isLocked,
    )) return;
    if (!this.corridorMounted && this.hallExit?.interact(
      this.player.position,
      this.viewDirection,
      this.player.isLocked,
    )) return;
    this.door.interact(this.player.position, this.viewDirection, this.player.isLocked && !this.character?.isBusy);
  }

  private currentObjective():string|null {
    return this.corridorStory?.state.active?this.corridorStory.objective(this.inventory.hasLamp):this.quest.objective(this.arrivalStory?.getState()??'done');
  }
  private canUseEquipment():boolean {
    return !!this.player?.isLocked&&!this.disposed&&!document.hidden&&!this.ui.isConsoleOpen&&!this.ui.isPaused&&!this.ui.isMainMenuOpen
      &&!this.encounter?.isActive&&!this.encounter?.isHidden&&!this.pcUse?.isActive&&!this.computerDesktop?.isOpen&&!this.letterReader?.isOpen&&!this.closet?.isActive&&!this.peephole?.isActive&&!this.arrivalCinematic?.isShowing&&!this.corridorStory?.modal&&!this.character?.isBusy;
  }
  private pickupFlashlight():boolean {
    if(this.inventory.hasLamp||this.objects?.isHolding||!this.flashlight?.isTargeted(this.camera))return false;
    this.inventory.acquireLamp();this.inventoryHUD.reveal();this.deviceAudio?.fixtureClick(this.camera.position);this.ui.setInteraction(null);this.saveNow('autosave');return true;
  }
  private storeEquipment():void {
    if(this.objects?.isHolding){
      const item=this.objects.heldInventoryItem;
      if(!item){this.ui.setCarryHint('Cet objet se porte à la main.');return;}
      if(!this.inventory.store(item)){this.ui.setCarryHint('Inventaire plein.');return;}
      this.objects.setStored(this.inventory.storedIds);
    }else{
      const item=this.inventory.equipped;if(!item||item.id===FLASHLIGHT_ID)return;
      if(!this.objects?.takeStored(item.id)){this.ui.setInteraction('Pas assez de place pour le prendre.');return;}
      this.inventory.takeSelected();
    }
    this.inventoryHUD.reveal();this.saveNow('autosave');
  }
  private needsFlashlight():boolean{return !!this.quest.devices.outageTriggered&&!this.inventory.hasLamp&&!this.pcUse?.isActive;}
  private allowEntranceOpening():boolean {
    // A legacy post-outage save may be outside. Keep the return trip possible.
    if(this.needsFlashlight()&&this.player&&this.apartment&&this.player.position.x<this.apartment.doorCenter.x){this.hesitateAtExit();return false;}
    return true;
  }
  private hesitateAtExit():void {
    if(!this.exitReminderArmed)return;this.exitReminderArmed=false;
    this.storyCaption?.say('Hmm… je devrais peut-être prendre la lampe sur mon bureau.');
  }
  private constrainExit(position:THREE.Vector3,movement:THREE.Vector3):void {
    this.encounter?.constrainMovement(position,movement);
    if(!this.needsFlashlight()||!this.apartment)return;
    const door=this.apartment.doorCenter,limit=door.x-.38;
    if(Math.abs(position.y-this.apartment.floorY-.865)>.7||Math.abs(position.z-door.z)>1.05)return;
    if(movement.x>0&&position.x+movement.x>limit){
      this.hesitateAtExit();movement.x=Math.max(0,limit-position.x);
    }
  }
  private syncCorridor():void {
    if(this.stairwellRestored&&this.quest.devices.outageTriggered&&!this.postOutageSettled){
      // After the hiding the cage is back, still without power; the neighbours stay silent.
      this.postOutageSettled=true;this.corridorStory.activate();this.neighbors?.suspend();this.applyApartmentPower();
    }
    if(this.corridorMounted||this.stairwellRestored||!this.quest.devices.outageTriggered||this.pcUse?.isActive||!this.corridor||!this.physics||!this.environment||!this.apartment)return;
    this.corridorStory.activate();this.corridorMounted=true;
    this.physics.batchChunkChanges(()=>{
      this.corridor!.activate(this.scene);this.physics!.removeChunk('origin');this.physics!.removeChunk('stairwell-furniture');
    });
    this.environment.showPostOutage();this.environment.hideExterior();this.neighbors?.suspend();
    this.apartment.group.traverse(o=>{if(/(?:west|east|north)-neighbor-door-/.test(o.name))o.visible=false;});
    // Far enough that the long-lens reveal at ~94 m is never veiled.
    this.scene.fog=new THREE.Fog(0x080b09,130,340);this.scene.background=new THREE.Color(0x080b09);this.camera.far=360;this.playerCamera.far=360;
    this.camera.updateProjectionMatrix();this.playerCamera.updateProjectionMatrix();this.applyApartmentPower();
    this.lastLampCount=this.corridorStory.litCount;this.corridor.setLights(this.lastLampCount,resolveLightingBrightness(this.settings.brightness).relativeGain,this.corridorStory.firstLamp,false);
    if(this.initialized)this.saveNow('autosave');
  }
  /** The corridor was never there: the stairwell returns behind the broken door. */
  private restoreStairwell():void {
    if(this.stairwellRestored||!this.physics||!this.environment||!this.apartment)return;
    this.stairwellRestored=true;this.postOutageSettled=true;
    const physics=this.physics,environment=this.environment;
    physics.batchChunkChanges(()=>{
      this.corridor?.deactivate();
      if(!physics.hasChunk('origin'))physics.addChunk('origin',this.stairwellColliders,{x:0,y:0,z:0});
      if(!physics.hasChunk('stairwell-furniture')&&environment.furnitureColliders.length)physics.addChunk('stairwell-furniture',environment.furnitureColliders,{x:0,y:0,z:0});
    });
    this.corridorMounted=false;
    environment.restoreStructure();
    this.apartment.group.traverse(o=>{if(/(?:west|east|north)-neighbor-door-/.test(o.name))o.visible=true;});
    this.scene.fog=new THREE.Fog(0x080a0c,10,44);this.scene.background=new THREE.Color(0x06080a);
  }
  /** Hall door open on a lit Level 0 hallway, its light spilling into the dark hall. */
  private openEscape():void {
    const environment=this.environment;
    if(!environment)return;
    if(this.escapeCorridor){
      this.escapeCorridor.setVisible(true);this.escapeCorridor.setAll(true,true);
      environment.setExteriorClearance(this.escapeCorridor.clearance);environment.setRainExclusion(this.escapeCorridor.clearance);
    }
    if(!this.escapeDoor&&environment.hallEntranceDoor&&!this.arrivalCinematic){
      try{this.escapeDoor=new EntranceDoorMotion(environment.hallEntranceDoor);}catch(error){console.warn('Porte du hall immobile.',error);}
    }
    if(this.escapeDoorOpen<0)this.escapeDoorOpen=0;
    environment.setEscapeGlow(1.6,{x:0,y:2.2,z:FACADE_OUTER_Z+.9});
  }
  private updateEscapeDoor(delta:number):void {
    if(this.escapeDoorOpen<0)return;
    if(this.escapeDoorOpen<1){
      // The leaf swings open on its own, slowly at first.
      this.escapeDoorOpen=Math.min(1,this.escapeDoorOpen+delta*.7);
      const t=this.escapeDoorOpen;this.escapeDoor?.setOpen(t*t*(3-2*t));
    }
    this.escapeCorridor?.update(delta,null);
  }
  private startShotDeath(direction:THREE.Vector3):void {
    if(this.shotDeath||!this.player)return;
    this.objects?.release();this.ui.setInteraction(null);this.neighbors?.suspend();
    this.player.setInputEnabled(false);this.player.setLookLocked(true);
    const flat=direction.clone().setY(0);if(flat.lengthSq()<1e-6)flat.set(0,0,1);
    this.shotDeath={time:0,from:this.camera.position.clone(),quaternion:this.camera.quaternion.clone(),floor:this.player.position.y-.865,direction:flat.normalize(),respawn:this.lastSafePosition.clone()};
    this.storyHud.pulseFlash(1);
  }
  /** Hit in the chest: thrown back along the shot, legs gone, the view slumps to the floor. */
  private updateShotDeath(delta:number):void {
    const death=this.shotDeath!;death.time+=delta;const t=death.time,fall=Math.min(1,t/.7),ease=fall*fall*(3-2*fall);
    this.camera.position.copy(death.from).addScaledVector(death.direction,.42*Math.sqrt(fall));
    this.camera.position.y=THREE.MathUtils.lerp(death.from.y,death.floor+.2,ease);
    this.camera.quaternion.copy(death.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-.55*ease,.2*ease,1.3*ease)));
    if(t>.95&&t-delta<=.95)this.storyHud.showDeath(true,'Le voisin a tiré. Reprise sur le palier…');
    if(t<4.2||!this.player)return;
    this.storyHud.showDeath(false);this.player.teleport(death.respawn);
    this.player.setLookLocked(false);this.player.setInputEnabled(!!this.player.isLocked&&!this.ui.isConsoleOpen);
    this.shotDeath=undefined;
  }
  private escapeToBackrooms():void {
    if(this.disposed)return;
    this.corridorStory.completeBacteria();
    this.callbacks.onEnterBackrooms();
  }
  private updateEquipment(delta:number):void {
    const owned=this.inventory.hasLamp,equipped=owned&&this.inventory.equipped?.id===FLASHLIGHT_ID&&!this.objects?.isHolding&&!this.pcUse?.isActive&&!this.closet?.isActive&&!this.peephole?.isActive&&!this.character?.isBusy;
    const hand=this.character?.getEquipmentHandPosition(this.equipmentHand)?this.equipmentHand:undefined;
    const small=this.inventory.equipped;
    const showSmall=small&&small.id!==FLASHLIGHT_ID&&!this.objects?.isHolding&&!this.pcUse?.isActive&&!this.closet?.isActive&&!this.peephole?.isActive&&!this.character?.isBusy;
    this.objects?.presentEquipped(showSmall?small.id:undefined,hand,this.camera.quaternion);
    this.flashlight?.update(this.camera,hand,owned,!!equipped,this.inventory.state.lampOn,delta,!this.settings.cameraMotion);
  }

  private currentSurface(): AudioSurface {
    const position = this.player?.position;
    if (
      position &&
      position.x >= APARTMENT_BOUNDS.minX &&
      position.x <= APARTMENT_BOUNDS.maxX &&
      position.z >= APARTMENT_BOUNDS.minZ &&
      position.z <= APARTMENT_BOUNDS.maxZ
    ) return 'apartment-wood';
    return 'stairwell-concrete';
  }

  private syncMailGate(): void {
    const blocked = !!this.arrivalStory?.blocksStairs;
    if (!this.physics || blocked === this.mailGateMounted) return;
    if (blocked) this.physics.addChunk('arrival-mail-stairs-gate', [MAIL_STAIR_GATE, MAIL_SECOND_FLIGHT_GATE], { x: 0, y: 0, z: 0 });
    else this.physics.removeChunk('arrival-mail-stairs-gate');
    this.mailGateMounted = blocked;
  }

  private interiorRainGain(surface: AudioSurface): number {
    // After the power cut the outside is gone: no rain at any window, no rain noise.
    if (this.quest.devices.outageTriggered) { this.environment?.setWeather(false); return 0; }
    if (!this.apartment || !this.environment || !this.player) {
      return interiorRainGainForDistance(surface, Number.POSITIVE_INFINITY);
    }
    let strongestGain = interiorRainGainForDistance(surface, Number.POSITIVE_INFINITY);
    if (surface === 'apartment-wood') {
      const closure = this.windowBlinds?.getClosureProgress() ?? [0, 0];
      const exposures = closure.map((progress) => rainExposureForBlindClosure(progress));
      strongestGain = Math.max(strongestGain, interiorRainRoomBleedGain(Math.max(...exposures)));
      for (let index = 0; index < this.apartmentRainOpenings.length; index += 1) {
        const distance = distanceToRainOpening(this.player.position, this.apartmentRainOpenings[index]!);
        const exposure = exposures[index]!;
        const gain = interiorRainGainForDistance(surface, distance, exposure);
        strongestGain = Math.max(strongestGain, gain);
      }
      return strongestGain;
    }
    for (const opening of this.environment.rainAudioOpenings) {
      const distance = distanceToRainOpening(this.player.position, opening);
      const gain = interiorRainGainForDistance(surface, distance);
      strongestGain = Math.max(strongestGain, gain);
    }
    return strongestGain;
  }

  private onPlayerLockChange(locked: boolean): void {
    if (this.disposed || this.transitionSuspended) {
      if (locked) queueMicrotask(() => this.player?.unlock());
      return;
    }
    this.renderRequested = true;
    if(!locked)this.peephole?.close();
    this.questTracker.update(this.currentObjective(), !this.ui.isPaused && (locked || !!this.computerDesktop?.isOpen) && !this.letterReader?.isOpen);
    this.deviceAudio?.sync(this.quest.devices, !this.ui.isPaused && !document.hidden && (locked || !!this.computerDesktop?.isOpen));
    if (!locked) this.objects?.setRotating(false);
    if (!this.ui.isPaused && (this.letterReader?.isOpen || this.computerDesktop?.isOpen)) {
      this.neighbors?.suspend();
      // Browser capture can resolve after the computer was opened. Wait for
      // PointerLockControls to update its flag, then free the desktop cursor.
      if (locked) queueMicrotask(() => {
        if (!this.disposed && (this.computerDesktop?.isOpen || this.letterReader?.isOpen)) this.player?.unlock();
      });
      this.player?.setInputEnabled(false); this.character?.setActive(false); return;
    }
    this.ui.setLocked(locked);
    this.player?.setInputEnabled(locked && !this.ui.isConsoleOpen && !this.closet?.isActive && !this.pcUse?.isActive && !this.corridorStory?.modal && !this.encounter?.locksInput);
    this.character?.setActive(locked && !this.ui.isConsoleOpen && !this.closet?.isActive && !this.pcUse?.isActive && !this.corridorStory?.modal, true);
    if(this.closet?.isActive)this.character?.setExternalCameraPresentation(true);
    if (this.arrivalStory?.isTakingLetter) this.player?.setInputEnabled(false);
    if (!locked) { this.arrivalStory?.suspend(); siteAudio.stopVoice(); this.neighbors?.suspend(); }
    if (this.arrivalAudioElapsed !== undefined) siteAudio.setStoryMusicPaused((!locked && !this.arrivalCinematic?.isShowing) || document.hidden);
    this.storyHud.setPlaying(locked);
    const ambiencePlaying=!this.ui.isPaused&&(locked||!!this.computerDesktop?.isOpen);
    void this.audio.setSuspended(!ambiencePlaying || document.hidden);
    this.previousTime = performance.now();
    this.accumulator = 0;
  }

  private applySettings(settings: GameSettings): void {
    this.renderRequested = true;
    const previousLighting = this.settings.lighting;
    const previousQuality = this.settings.renderQuality;
    this.settings = { ...settings };
    this.neighborVoice.setVolume(settings.masterVolume);
    this.player?.setFieldOfView(settings.fieldOfView);
    this.player?.setLookSensitivity(settings.lookSensitivity);
    this.player?.setCameraMotionEnabled(settings.cameraMotion);
    this.character?.setSettings(this.settings);
    this.player?.setControlBindings(settings.controls);
    this.audio.setMasterVolume(settings.masterVolume);
    siteAudio.setMasterVolume(settings.masterVolume);
    if (previousQuality !== settings.renderQuality) {
      if (settings.renderQuality === 'quality') restoreSceneDataMaps(this.scene);
      else compactSceneDataMaps(this.scene);
    }
    this.applyRenderFeatures(0);
    const ratio = this.pixelRatioForQuality(settings.renderQuality);
    if (ratio !== this.pixelRatio) {
      this.pixelRatio = ratio;
      this.resize();
    }
    if (previousLighting !== settings.lighting) {
      this.postFX?.setLightingMode(settings.lighting);
      this.environment?.setLightingMode(settings.lighting);
    }
    this.environment?.setBrightness(settings.brightness);
    this.apartment?.setBrightness(settings.brightness);
    this.fixtures?.setBrightness(settings.brightness);
    if(this.closet?.isActive)this.character?.setExternalCameraPresentation(true);
    this.applyBackroomsLighting();
  }

  private configureBackroomsLighting(): void {
    this.hemisphere.name = 'liminal-ambient-field';
    this.ambientFill.name = 'indirect-carpet-bounce';
    this.directionalKey.name = 'soft-fluorescent-key';
    this.directionalKey.castShadow = false;
    this.scene.add(this.hemisphere, this.ambientFill, this.directionalKey);
    this.applyBackroomsLighting();
  }

  private applyBackroomsLighting(): void {
    const legacy = this.settings.lighting === 'legacy';
    const palette = (legacy ? BACKROOMS_LEGACY_ATMOSPHERE : BACKROOMS_ATMOSPHERE).yellow;
    this.hemisphere.color.setHex(palette.hemisphereSky);
    this.hemisphere.groundColor.setHex(palette.hemisphereGround);
    this.ambientFill.color.setHex(palette.ambient);
    this.directionalKey.color.setHex(palette.key);
    // This runtime is nocturnal. It reuses the Backrooms colour rig and
    // post-processing modes, but relies on local fixtures for readable spaces
    // instead of globally filling the exterior and the apartment.
    const gain = resolveLightingBrightness(this.settings.brightness).relativeGain;
    this.hemisphere.intensity = (legacy ? 0.04 : 0.1) * gain;
    this.ambientFill.intensity = (legacy ? 0.008 : 0.025) * gain;
    this.directionalKey.intensity = (legacy ? 0.025 : 0.09) * gain;
    this.directionalKey.position.set(legacy ? 3.5 : 4.5, legacy ? 8 : 7.5, legacy ? 2.5 : 3.2);
  }

  private pixelRatioForQuality(quality: GameSettings['renderQuality']): number {
    if (quality === 'performance') return this.renderScale.min;
    if (quality === 'quality') return this.renderScale.max;
    return this.adaptiveScale.value;
  }

  private submitConsole(value: string, mode: ConsoleMode): ConsoleSubmitResult {
    const trimmed = value.trim();
    if (!value.startsWith('/')) {
      return mode === 'chat'
        ? { close: true, feedback: 'MESSAGE LOCAL', messages: [{ kind: 'chat', text: `me: ${trimmed}` }] }
        : { close: false, feedback: 'UTILISE /help', messages: [{ kind: 'error', text: 'UTILISE /help' }] };
    }
    const [command, ...args] = trimmed.slice(1).split(/\s+/);
    if (command?.toLowerCase() === 'viewmodel') return viewmodelCommand(this.character, args);
    if (trimmed.toLowerCase() === '/save') {
      const saved = this.saveNow('manual');
      const text = saved ? 'PARTIE SAUVEGARDÉE' : 'ÉCHEC DE LA SAUVEGARDE';
      return { close: true, feedback: text, messages: [{ kind: saved ? 'system' : 'error', text }] };
    }
    const text = trimmed.toLowerCase() === '/help'
      ? '/viewmodel - première / troisième personne · /save - sauvegarder maintenant'
      : 'COMMANDE INCONNUE. UTILISE /help.';
    return { close: false, feedback: text, messages: [{ kind: 'system', text }] };
  }

  private completeConsole(value: string, _mode: ConsoleMode): ConsoleCompletion | null {
    if (!value.startsWith('/')) return null;
    const options = [
      { value: '/help', label: '/help', detail: 'AFFICHE LES COMMANDES' },
      { value: '/save', label: '/save', detail: 'SAUVEGARDE MAINTENANT' },
      VIEWMODEL_COMPLETION,
    ].filter((item) => item.value.startsWith(value.trim()));
    return options.length > 0 ? { hint: `${options.length} COMMANDE(S)`, suggestions: options } : null;
  }

  private saveNow(kind: GameSaveKind): boolean {
    if (this.options.deferEntry && !this.arrivalCompleted) return false;
    if (!this.initialized || !this.player || !this.door || !this.apartment) return false;
    // A save in the middle of the encounter would resume a half-played scene.
    // The story stays at "home" until it is survived, so a load replays it whole.
    if (this.encounter?.isActive || this.encounter?.isHidden || this.shotDeath) return false;
    if (!this.storage) {
      if (!this.saveErrorShown) {
        this.saveErrorShown = true;
        this.ui.showConsoleMessage({ kind: 'error', text: 'SAUVEGARDE LOCALE INDISPONIBLE' });
      }
      return false;
    }
    const look = this.player.getLookQuaternion();
    if (kind === 'manual') {
      this.postFX?.render(0);
      this.savePreview = captureGameSavePreview(this.renderer.domElement) ?? this.savePreview;
    }
    const previewImage = this.savePreview;
    const result = writeGameSave(this.storage, {
      experienceId: 'russian-stairwell',
      kind,
      levelId: 'building',
      levelLabel: 'Immeuble',
      playTimeSeconds: this.playableSeconds,
      ...(previewImage ? { previewImage } : {}),
      payload: {
        safePosition: this.lastSafePosition,
        quaternion: { x: look.x, y: look.y, z: look.z, w: look.w },
        entranceDoor: this.door.getState(),
        apartmentLightOn: this.quest.devices.lightOn,
        windowBlindsOpen: this.windowBlinds?.getState() ?? [true, true],
        arrivalState: this.arrivalStory?.getState() ?? 'done',
        mailGaspPlayed: this.arrivalStory?.hasPlayedMailGasp ?? true,
        neighbors: this.neighbors?.getProgress() ?? { specialDoorConsumed: false, attempts: {} },
        computer: this.quest.snapshot(),
        inventory:this.inventory.snapshot(),corridor:this.corridorStory.snapshot(),objective:this.currentObjective(),
        ...(this.objects ? { objects: this.objects.getProgress() } : {}),
        ...(this.pcUse ? { pcUse:this.pcUse.getProgress() } : {}),
        ...(this.fixtures ? { fixtures: {...this.fixtures.getProgress(), closetDoor: this.closet?.doorProgress ?? 0} } : {}),
      },
    });
    if (!result.ok && !this.saveErrorShown) {
      this.saveErrorShown = true;
      this.ui.showConsoleMessage({ kind: 'error', text: 'SAUVEGARDE LOCALE INDISPONIBLE' });
    }
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

  private applyApartmentPower(): void {
    const state = this.quest.devices;
    this.apartment?.setInteriorLightsEnabled(state.lightOn);
    this.apartment?.setPowerAvailable(!state.outageTriggered||this.corridorStory?.state.apartmentRelit);
    this.environment?.setPowerAvailable(!state.outageTriggered);
    this.root.classList.toggle('has-power-outage', state.outageTriggered);
    this.renderRequested = true;
  }

  private updateApartmentStory(delta: number, playing: boolean): void {
    const caption=this.storyCaption;if(!caption)return;
        this.deviceAudio?.setNarrationActive?.(false);
    if(!playing){caption.hide();return;}
    const state=this.quest.devices;
    if(!state.firstGameFinished&&this.neighborCaption?.isActive){caption.hide();return;}
    if(state.firstGameFinished&&!state.outageTriggered){
      if(!state.spoken.includes('mines')){
        const thought=this.quest.nextThought();
        if(thought)caption.say(thought.text);
      }
      caption.update(delta,true);
      this.quest.advanceNarration(delta,!caption.isActive);
      if(this.quest.requestQuickRise())this.pcUse?.riseQuickly();
      const free=!this.pcUse?.isActive&&!this.computerDesktop?.isOpen&&!this.closet?.isActive&&!this.peephole?.isActive&&!this.character?.isBusy;
      if(this.gasPosition&&this.player&&this.quest.advanceOutage(this.player.position,this.gasPosition,free)){
        this.neighborCaption?.clear();this.neighbors?.suspend();this.arrivalStory?.suspend();siteAudio.stopVoice();
        this.applyApartmentPower();this.deviceAudio?.powerCut();this.devices?.update(0,true,false);
        caption.say('Merde… une coupure.');
        this.saveNow('autosave');
      }
      return;
    }
    if(!caption.isActive&&!state.outageTriggered){const thought=this.quest.nextThought();if(thought)caption.say(thought.text);}
    caption.update(delta,true);
  }

  get apartmentStoryState(){return{computerPhase:this.pcUse?.state??'standing',computerBlocked:this.quest.isComputerBlocked,firstGameFinished:this.quest.devices.firstGameFinished,narrationElapsed:this.quest.devices.outageLeadSeconds,outageConsumed:this.quest.devices.outageTriggered,journey:this.quest.devices.journey};}

  private stepPassivePhysics(delta: number): void {
    if (!this.physics) return;
    this.accumulator = Math.min(.1, this.accumulator + delta);
    while(this.accumulator >= 1/60) { this.physics.stepDynamics(1/60); this.accumulator -= 1/60; }
    this.objects?.update(false, delta);
  }
  /** Physical state of the sprint key, read by scripted holds even while movement is locked. */
  private readonly onSprintKey = (event: KeyboardEvent): void => {
    if (matchesControlAction(event, this.settings.controls, 'sprint')) this.sprintHeld = event.type === 'keydown';
  };
  private readonly onSprintBlur = (): void => { this.sprintHeld = false; };

  private readonly frame = (now: number): void => {
    if (this.disposed || this.transitionSuspended || !this.player || !this.environment || !this.door) return;
    const measuredDelta = Math.max(0, (now - this.previousTime) / 1000);
    const delta = Math.min(0.05, measuredDelta);
    this.previousTime = now;
    const cinematic = !!this.arrivalCinematic?.isShowing;
    if (this.ui.isPaused || document.hidden) {
      this.accumulator = 0;
      this.storyCaption?.hide();this.sprintHint?.update(0,false);
      this.deviceAudio?.sync(this.quest.devices, false);
      this.questTracker.update(this.currentObjective(), false);
      this.inventoryHUD.update(this.inventory, 0, false, false, '', '');
      if (this.renderRequested && !document.hidden) { this.postFX?.render(0); this.renderRequested = false; }
      return;
    }
    const active = !cinematic && (!!this.computerDesktop?.isOpen || (this.player.isLocked && !this.ui.isConsoleOpen));
    // Input hand-offs at the power cut may temporarily release pointer lock.
    // Weather shares the gameplay clock, independently of electrical devices.
    if(active)void this.audio.setSuspended(false);
    const inEncounter = !!(this.encounter?.isActive || this.encounter?.isHidden);
    if (active && !inEncounter && !this.arrivalStory?.blocksStairs && this.apartment
      && hasEnteredApartment(this.player.position, this.apartment.doorCenter, this.apartment.floorY)) this.quest.reachHome();
    this.questTracker.tick(delta,active,!this.settings.cameraMotion);
    this.questTracker.update(this.currentObjective(),active&&!cinematic&&!inEncounter&&this.questHold<=0);
    this.inventoryHUD.update(this.inventory,delta,active&&!this.pcUse?.isActive&&!this.computerDesktop?.isOpen&&!this.closet?.isActive&&!this.peephole?.isActive&&!this.corridorStory.modal,active,formatKeyLabel(this.equipmentInput.storeKey),formatKeyLabel(this.equipmentInput.torchKey),!this.settings.cameraMotion);
    this.sprintHint?.update(delta,active);
    this.updateApartmentStory(delta, active);
    this.syncCorridor();
    if(active&&this.corridorMounted&&!this.pcUse?.isActive&&!this.closet?.isActive&&!this.peephole?.isActive&&!this.character?.isBusy){
      this.player.getViewDirection(this.viewDirection);
      if(this.corridorStory.observe(this.player.position,{x:this.apartment!.doorCenter.x,y:this.apartment!.corridorFloorY,z:this.apartment!.doorCenter.z},this.inventory.hasLamp,Math.atan2(this.viewDirection.x,this.viewDirection.z))){
        this.objects?.release();this.neighbors?.suspend();
        this.deviceAudio?.corridorImpact(this.apartment!.doorCenter);this.applyApartmentPower();this.saveNow('autosave');
      }
      if(this.corridorStory.consumeEntry()){
        this.sprintHint?.show(this.settings.controls);
        const text='Putain… c’est quoi ce bordel ? C’est pas chez moi.';
        this.storyCaption?.say(text);this.saveNow('autosave');
      }
    }
    const reacting=this.corridorStory.modal;
    // Hold the far lamps until the player is in place for the reveal.
    const advanceWave = !this.encounter || !this.corridorStory.bacteriaPending || inEncounter
      || this.corridorStory.litCount > BACTERIA_REVEAL_LAMP;
    const returned=this.corridorStory.update(delta,active && advanceWave);
    if(this.corridorBlackout>0&&active){
      // Behind the burst door, every troffer dies at once with the mains.
      this.corridorBlackout=Math.max(0,this.corridorBlackout-delta);
      if(this.corridorBlackout===0&&this.corridorMounted)this.audio.impact('power-cut');
    }
    this.corridor?.setLights(this.corridorBlackout===0?0:this.corridorStory.litCount,resolveLightingBrightness(this.settings.brightness).relativeGain,this.corridorStory.firstLamp);
    if(active&&this.corridorMounted)this.corridor?.update(delta);
    if(this.corridorStory.litCount!==this.lastLampCount){
      if (this.corridorStory.litCount > this.lastLampCount && this.corridorMounted && this.corridor) {
        // Each troffer strikes where it hangs; the far ones stay faintly audible.
        const position=new THREE.Vector3();
        for(let index=this.lastLampCount;index<this.corridorStory.litCount;index++)this.deviceAudio?.corridorBallast(this.corridor.lampPosition(index,position),index);
      }
      this.lastLampCount=this.corridorStory.litCount;
      if(this.corridorStory.finished)this.saveNow('autosave');
    }
    if(reacting){
      if(active)this.reaction?.update(!this.settings.cameraMotion||matchMedia('(prefers-reduced-motion: reduce)').matches);
      if(active){this.stepPassivePhysics(delta);this.elapsed+=delta;this.playableSeconds+=delta;this.autosaveElapsed+=delta;if(this.autosaveElapsed>=AUTOSAVE_INTERVAL_SECONDS)this.saveNow('autosave');}
      this.apartment?.updateVisibility(this.camera.position,true);this.fixtures?.update(delta,active,false);this.devices?.update(delta,active,false);
      this.environment.update(this.elapsed);this.audio.updateInteriorGain(this.interiorRainGain(this.currentSurface()));
      this.camera.getWorldDirection(this.viewDirection);setDoorAudioListener(this.audio.spatialBus,this.camera.position,this.viewDirection);
      this.deviceAudio?.sync(this.quest.devices,active);this.updateEquipment(delta);
      if(!document.hidden&&(active||this.renderRequested)){this.postFX?.render(active?delta:0);this.renderRequested=false;}
      if(returned){this.player.setInputEnabled(active);this.character?.setActive(active);this.saveNow('autosave');}
      return;
    }
    this.deviceAudio?.setListenerPosition(this.camera.position);
    this.deviceAudio?.sync(this.quest.devices, active);
    if(this.pcUse?.isActive){
      this.updateEquipment(0);
      this.pcUse.update(delta,active,!!this.computerDesktop?.isOpen&&this.pcUse.isUsing);
      if(active){this.stepPassivePhysics(delta);this.elapsed+=delta;this.playableSeconds+=delta;this.autosaveElapsed+=delta;if(this.autosaveElapsed>=AUTOSAVE_INTERVAL_SECONDS)this.saveNow('autosave');}
      else this.accumulator=0;
      this.fixtures?.update(delta,active,false);this.devices?.update(delta,active,false);
      this.environment.update(this.elapsed);this.apartment?.updateVisibility(this.camera.position,true);
      this.audio.updateInteriorGain(this.interiorRainGain(this.currentSurface()));
      this.camera.getWorldDirection(this.viewDirection);setDoorAudioListener(this.audio.spatialBus,this.camera.position,this.viewDirection);this.deviceAudio?.setListenerPosition(this.camera.position);
      this.questTracker.update(this.currentObjective(),active);
      if(!document.hidden&&((active&&!this.computerDesktop?.isOpen)||this.renderRequested)){this.postFX?.render(active?delta:0);this.renderRequested=false;}
      return;
    }
    if (this.computerDesktop?.isOpen) {
      if(active)this.stepPassivePhysics(delta); else this.accumulator=0;
      this.fixtures?.update(delta,active,false);
      this.questTracker.update(this.currentObjective(), !document.hidden);
      this.devices?.update(delta, active, false);
      if (active) {
        this.elapsed+=delta;this.environment.update(this.elapsed);this.audio.updateInteriorGain(this.interiorRainGain(this.currentSurface()));
        this.playableSeconds += delta; this.autosaveElapsed += delta;
        if (this.autosaveElapsed >= AUTOSAVE_INTERVAL_SECONDS) this.saveNow('autosave');
      }
      if (this.renderRequested && !document.hidden) { this.postFX?.render(0); this.renderRequested = false; }
      return;
    }
    if (document.hidden || (!this.player.isLocked && !this.renderRequested && !cinematic)) return;
    this.elapsed += delta;
    if(this.closet?.isActive){
      this.closet.update(delta,active); if(active)this.stepPassivePhysics(delta); else this.accumulator=0;
      // Hidden from the creature: the hunt goes on around the wardrobe.
      if(active&&(this.encounter?.isActive||this.encounter?.isHidden)){this.encounter.update(delta);this.encounter.applyCamera();this.updateEncounterHud(delta);}
      this.fixtures?.update(delta,active,false); this.devices?.update(delta,active,false);
      this.environment.update(this.elapsed);this.apartment?.updateVisibility(this.camera.position,true);
      this.camera.getWorldDirection(this.viewDirection);setDoorAudioListener(this.audio.spatialBus,this.camera.position,this.viewDirection);
    } else if(this.peephole?.isActive){
      if(active)this.stepPassivePhysics(delta);else this.accumulator=0;
      this.fixtures?.update(delta,active,false);this.devices?.update(delta,active,false);
      this.peephole.updateView(delta);this.environment.update(this.elapsed);
      this.apartment?.updateVisibility(this.camera.position,true);
      this.camera.getWorldDirection(this.viewDirection);
      setDoorAudioListener(this.audio.spatialBus,this.camera.position,this.viewDirection);
      this.neighbors?.update(delta,this.player.position,this.viewDirection,!this.ui.isConsoleOpen,this.camera.position);
      this.neighborCaption?.update(delta,!this.ui.isConsoleOpen);
      this.ui.setInteraction(null);
    } else if (cinematic) {
      this.arrivalCinematic!.update(Math.min(.25, measuredDelta), this.camera);
      this.camera.getWorldDirection(this.viewDirection);
      setDoorAudioListener(this.audio.spatialBus,this.camera.position,this.viewDirection);
      this.environment.update(this.elapsed);
      this.apartment?.updateVisibility(this.camera.position,this.corridorMounted);
    } else if (this.player.isLocked) {
      this.playableSeconds += delta;
      this.autosaveElapsed += delta;
      if (this.autosaveElapsed >= AUTOSAVE_INTERVAL_SECONDS) this.saveNow('autosave');
      // Before the rig copies its camera: scripted looks must drive the body too.
      if (this.shotDeath) this.updateShotDeath(delta);
      else {
        if (!this.ui.isConsoleOpen) this.encounter?.update(delta);
        this.character?.update(delta);
        this.encounter?.applyCamera();
      }
      this.gunfire?.update(delta);
      if (delta > 0) this.playerVelocity.subVectors(this.player.position, this.previousPlayerPosition).divideScalar(delta);
      this.previousPlayerPosition.copy(this.player.position);
      this.updateEscapeDoor(delta);
      this.environment.update(this.elapsed);
      this.apartment?.updateVisibility(this.camera.position,this.corridorMounted);
      this.camera.getWorldDirection(this.viewDirection);
      setDoorAudioListener(this.audio.spatialBus, this.camera.position, this.viewDirection);
      const canInteract = !this.ui.isConsoleOpen && !this.character?.isBusy && !this.shotDeath && !this.gunfire?.isActive;
      const chaseOwnsInteraction = !!(this.encounter?.isActive || this.encounter?.isHidden);
      const freeInteraction = canInteract && !chaseOwnsInteraction;
      this.door.update(0, this.player.position, this.viewDirection, canInteract && !this.encounter?.locksInput);
      if(!this.corridorMounted)this.hallExit?.update(this.player.position, this.viewDirection, freeInteraction);
      this.lightSwitch?.update(this.player.position, this.viewDirection, freeInteraction);
      this.windowBlinds?.update(delta, this.player.position, this.viewDirection, freeInteraction);
      this.arrivalStory?.update(delta, this.player.position, this.viewDirection, freeInteraction);
      if(!this.corridorMounted&&!this.stairwellRestored)this.neighbors?.update(delta, this.player.position, this.viewDirection, freeInteraction, this.camera.position);
      this.neighborCaption?.update(delta, freeInteraction);
      this.objects?.restoreReleasedCollision(this.player.position);
      this.objects?.update(freeInteraction, delta);
      if(this.objects?.heldInventoryItem)this.ui.setCarryHint(`${formatKeyLabel(this.equipmentInput.storeKey)} — Ranger · Molette — Distance`);
      this.computer?.update(delta, freeInteraction && !this.objects?.isHolding);
      this.devices?.update(delta, active, freeInteraction && !this.objects?.isHolding);
      this.fixtures?.update(delta,active,freeInteraction&&!this.objects?.isHolding);
      this.closet?.update(delta,freeInteraction&&!this.objects?.isHolding);
      this.peephole?.updatePrompt(freeInteraction&&!this.objects?.isHolding);
      if(freeInteraction&&!this.inventory.hasLamp&&this.flashlight?.isTargeted(this.camera)&&!this.objects?.isHolding)this.ui.setInteraction('Prendre la lampe torche');
      if(this.apartment&&this.player.position.distanceTo(this.apartment.doorCenter)>2)this.exitReminderArmed=true;
      if (chaseOwnsInteraction && canInteract) this.encounter?.updatePrompt(this.player.position, this.viewDirection);
      this.updateEncounterHud(delta);
    } else {
      this.accumulator = 0;
      this.fixtures?.update(0,false,false);
      this.arrivalStory?.suspend();
      this.ui.setInteraction(null);
    }
    if (cinematic || this.player.isLocked) {
      if (this.arrivalAudioElapsed !== undefined) {
        this.arrivalAudioElapsed = Math.min(8, this.arrivalAudioElapsed + Math.min(.25, measuredDelta));
        const mix = this.arrivalAudioElapsed / 8;
        siteAudio.setStoryMusicMix(mix === 1 ? 0 : Math.cos(mix * Math.PI / 2));
        this.audio.setInteriorMix(Math.sin(mix * Math.PI / 2));
        if (mix === 1) this.arrivalAudioElapsed = undefined;
      }
      this.audio.updateInteriorGain(this.interiorRainGain(this.currentSurface()));
    }
    this.updateEquipment(delta);
    const instantaneousFps = measuredDelta > 0 ? 1 / measuredDelta : 60;
    this.fps = THREE.MathUtils.lerp(this.fps, instantaneousFps, 0.045);
    if (this.player.isLocked || cinematic) this.applyRenderFeatures(measuredDelta);
    if (this.settings.renderQuality === 'auto') {
      const nextRatio = this.adaptiveScale.update(this.fps, measuredDelta);
      if (nextRatio !== null && nextRatio !== this.pixelRatio) {
        this.pixelRatio = nextRatio;
        this.resize();
      }
    }
    this.renderer.info.reset();
    this.renderRequested = false;
    this.postFX?.render(delta);
  };

  private updateEncounterHud(delta: number): void {
    this.storyHud.update(delta);
    if (this.questHold > 0) {
      this.questHold -= delta;
      if (this.questHold <= 0) this.storyHud.setQuest(null);
      return;
    }
    const objective = this.encounter?.isActive || this.encounter?.isHidden ? this.encounter.questText : null;
    this.storyHud.setQuest(objective?.text ?? null, objective?.tone);
  }

  private applyRenderFeatures(_delta: number): void {
    // Auto adjusts resolution while playing; its shader pipeline stays warm.
    // Explicit preference/lighting changes happen from the settings menu.
    const { compact, shadows } = stairwellPipelineFeatures(this.settings.renderQuality, this.settings.lighting);
    this.postFX?.setPerformanceMode(compact);
    if (this.renderer.shadowMap.enabled !== shadows) {
      this.renderer.shadowMap.enabled = shadows;
      this.scene.traverse(object => {
        const light = object as THREE.Light & { shadow?: THREE.LightShadow };
        if (light.shadow) light.shadow.needsUpdate = true;
      });
    }
  }

  private readonly resize = (): void => {
    if (this.transitionSuspended) return;
    this.renderRequested = true;
    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.postFX?.setSize(width, height);
  };

  private async toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await this.root.requestFullscreen();
  }

  private readonly onVisibilityChange = (): void => {
    if (this.transitionSuspended) return;
    if (document.hidden) { this.sprintHint?.update(0,false);this.peephole?.close();this.keypadAudio?.stop();this.arrivalStory?.suspend(); siteAudio.stopVoice(); this.neighbors?.suspend(); }
    if (document.hidden) this.saveNow('autosave');
    const cinematic = !!this.arrivalCinematic?.isShowing;
    this.deviceAudio?.sync(this.quest.devices, !this.ui.isPaused && !document.hidden && (!!this.player?.isLocked || !!this.computerDesktop?.isOpen));
    void this.audio.setSuspended(this.ui.isPaused || document.hidden || (!this.player?.isLocked && !cinematic && !(this.letterReader?.isOpen || this.computerDesktop?.isOpen)));
    if (this.options.deferEntry) siteAudio.setStoryMusicPaused(this.ui.isPaused || document.hidden || (!this.player?.isLocked && !cinematic));
    this.previousTime = performance.now();
    this.accumulator = 0;
  };

  private readonly onWorldMouseDown = (event: MouseEvent): void => {
    if(this.player?.isLocked&&!this.player.isPointerCaptured&&!this.ui.isPaused&&!this.ui.isConsoleOpen){
      this.player.lock(event);event.preventDefault();event.stopImmediatePropagation();return;
    }
    if (!this.player?.isPointerCaptured || this.ui.isPaused || this.ui.isConsoleOpen || this.character?.isBusy || (this.letterReader?.isOpen || this.computerDesktop?.isOpen)) return;
    let consumed = false;
    if(this.shotDeath||this.encounter?.isActive||this.encounter?.isHidden||this.pcUse?.isActive||this.corridorStory.modal||this.peephole?.isActive||this.closet?.isActive){event.preventDefault();event.stopImmediatePropagation();return;}
    if (event.button === 2) consumed = this.objects?.setRotating(true) ?? false;
    if (event.button === 0) {
      this.camera.getWorldDirection(this.viewDirection);
      consumed=this.pickupFlashlight();
      if(!consumed)consumed=this.peephole?.interact()??false;
      if(!consumed&&!this.objects?.isHolding)consumed=!!(this.fixtures?.interact()||this.closet?.interact());
      if(!consumed)consumed = !this.objects?.isHolding && (this.devices?.interact(this.quest.devices.outageTriggered && !event.shiftKey) ?? false);
      if (!consumed) consumed = !this.objects?.isHolding && (this.computer?.interact() ?? false);
      if (!consumed) consumed = this.objects?.interact(true) ?? false;
      if (!consumed) consumed = this.neighbors?.interact(this.player.position, this.viewDirection, true, 'fast', this.camera.position,true) ?? false;
    }
    if (consumed) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  private readonly onObjectMouseMove = (event: MouseEvent): void => {
    if (this.player?.isPointerCaptured && !this.ui.isPaused && this.objects?.rotate(event.movementX, event.movementY)) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  };
  private readonly onObjectMouseUp = (event: MouseEvent): void => { if (event.button === 2) this.objects?.setRotating(false); };
  private readonly onObjectWheel = (event: WheelEvent): void => {
    if(!this.canUseEquipment()||event.deltaY===0)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(this.objects?.isHolding)this.objects.adjustDistance(event.deltaY);
    else{this.inventory.select(event.deltaY);this.inventoryHUD.reveal();}
  };
  private readonly onCanvasClick = (): void => {
    if (this.arrivalCinematic?.isShowing || (this.letterReader?.isOpen || this.computerDesktop?.isOpen)) return;
    if (!this.player?.isLocked && !this.ui.isPaused && !this.ui.isMainMenuOpen) this.enter();
  };

  private readonly onPageHide = (): void => {
    this.saveNow('autosave');
  };

  private readonly onConsoleHotkey = (event: KeyboardEvent): void => {
    if (this.encounter?.isActive||this.encounter?.isHidden||this.pcUse?.isActive||this.corridorStory.modal||this.closet?.isActive||this.peephole?.isActive||this.arrivalStory?.isTakingLetter || (this.letterReader?.isOpen || this.computerDesktop?.isOpen)) return;
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

  /** Do not destroy the old WebGL scene while the next photo film is playing. */
  suspendForTransition(): void {
    if (this.disposed || this.transitionSuspended) return;
    this.transitionSuspended = true;
    this.renderer.setAnimationLoop(null);
    this.root.style.display = 'none';
    this.player?.setInputEnabled(false);
    this.player?.unlock();
    this.character?.setActive(false);
    this.peephole?.close();this.keypadAudio?.stop();
    this.arrivalStory?.suspend(); this.neighbors?.suspend();
    this.deviceAudio?.sync(this.quest.devices, false); this.storyCaption?.hide();
    siteAudio.stopVoice(); siteAudio.stopStoryMusic();
    void this.audio.setSuspended(true);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loadingAbort.abort();
    this.options.apartmentPreload?.dispose();
    // Before the cinematic and environment: it restores their lights and door.
    this.encounter?.dispose();
    this.bacteriaAudio.dispose();
    this.storyHud.dispose();
    this.arrivalCinematic?.dispose();
    this.letterReader?.dispose();
    this.computer?.dispose(); this.computerDesktop?.dispose(); this.questTracker.dispose();
    this.peephole?.dispose();this.keypadAudio?.dispose();
    this.neighbors?.dispose(); this.neighborVoice.dispose(); this.doorAudio.dispose(); this.neighborCaption?.dispose();
    if (this.options.deferEntry && !this.transitionSuspended) siteAudio.stopStoryMusic();
    this.arrivalStory?.dispose();
    siteAudio.stopVoice();
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onConsoleHotkey);
    window.removeEventListener('keydown', this.onSprintKey, true);
    window.removeEventListener('keyup', this.onSprintKey, true);
    window.removeEventListener('blur', this.onSprintBlur);
    window.removeEventListener('pagehide', this.onPageHide);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.renderer.domElement.removeEventListener('click', this.onCanvasClick);
    this.renderer.domElement.removeEventListener('mousedown', this.onWorldMouseDown, true);
    this.renderer.domElement.removeEventListener('wheel', this.onObjectWheel);
    document.removeEventListener('mousemove', this.onObjectMouseMove, true);
    document.removeEventListener('mouseup', this.onObjectMouseUp, true);
    this.equipmentInput.dispose();this.inventoryHUD.dispose();this.flashlight?.dispose();this.corridor?.dispose();
    this.gunfire?.dispose();this.escapeDoor?.dispose();if(this.escapeCorridor){this.escapeCorridor.dispose();this.environment?.setExteriorClearance(null);this.environment?.setRainExclusion(null);}this.reaction?.dispose();
    this.sprintHint?.dispose();this.corridorMaterials?.dispose();
    this.pcUse?.dispose();this.closet?.dispose(); this.fixtures?.dispose();
    this.objects?.dispose();
    this.devices?.dispose(); this.deviceAudio?.dispose(); this.storyCaption?.dispose();
    this.door?.dispose();
    this.lightSwitch?.dispose();
    this.windowBlinds?.dispose();
    this.hallExit?.dispose();
    this.character?.dispose();
    this.player?.dispose();
    this.apartment?.dispose();
    this.environment?.dispose();
    this.materials?.dispose();
    this.physics?.dispose();
    this.postFX?.dispose();
    this.audio.dispose();
    this.ui.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.root.remove();
  }
}
