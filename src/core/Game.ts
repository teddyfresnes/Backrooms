import * as THREE from 'three';
import { AudioSystem } from '../audio/AudioSystem';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { PlayerController } from '../player/PlayerController';
import { MaterialLibrary } from '../render/MaterialLibrary';
import { PostFX } from '../render/PostFX';
import { ExperienceUI } from '../ui/ExperienceUI';
import type { ConsoleCompletion, ConsoleMode, ConsoleSubmitResult } from '../ui/ExperienceUI';
import { createReadableSeed } from '../world/SeededRandom';
import { fingerprintWorld, validateWorldPlan } from '../world/generateWorld';
import { generateInfiniteChunk } from '../world/InfiniteWorld';
import type { WorldPlan } from '../world/types';
import { WorldStream } from './WorldStream';
import type { LocateTarget } from './WorldStream';

export interface DebugExperience {
  ready: boolean;
  seed: string;
  fingerprint: string;
  rooms: number;
  lights: number;
  features: string[];
  player: { x: number; y: number; z: number };
  fps: number;
  pixelRatio: number;
  drawCalls: number;
  triangles: number;
  chunks: number;
  pendingChunks: number;
}

declare global {
  interface Window {
    __BACKROOMS__?: DebugExperience;
  }
}

const resolveSeed = (): string => {
  const url = new URL(window.location.href);
  const supplied = url.searchParams.get('seed')?.trim();
  if (supplied) return supplied.slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, '-');
  const stored = sessionStorage.getItem('threshold-zero-seed');
  const seed = stored || createReadableSeed();
  sessionStorage.setItem('threshold-zero-seed', seed);
  url.searchParams.set('seed', seed);
  history.replaceState(null, '', url);
  return seed;
};

export class Game {
  readonly plan: WorldPlan;
  private readonly seed: string;
  private readonly root: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(72, 1, 0.04, 150);
  private readonly ui: ExperienceUI;
  private readonly audio = new AudioSystem();
  private readonly lookDirection = new THREE.Vector3();
  private materials?: MaterialLibrary;
  private worldStream?: WorldStream;
  private physics?: PhysicsWorld;
  private player?: PlayerController;
  private postFX?: PostFX;
  private previousTime = performance.now();
  private accumulator = 0;
  private elapsed = 0;
  private fps = 60;
  private frameCounter = 0;
  private metricsTimer = 0;
  private qualityTimer = 0;
  private pixelRatio = 1;
  private disposed = false;

  constructor(private readonly container: HTMLElement) {
    if (!document.createElement('canvas').getContext('webgl2')) {
      throw new Error('WebGL 2 est requis pour explorer cette archive.');
    }
    this.seed = resolveSeed();
    this.plan = generateInfiniteChunk(this.seed, { x: 0, z: 0, story: 0 });
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
    this.root.append(this.renderer.domElement);

    this.ui = new ExperienceUI(this.root, this.plan, {
      enter: () => this.enter(),
      regenerate: () => this.regenerate(),
      toggleFullscreen: () => void this.toggleFullscreen(),
      submitConsole: (value, mode) => this.submitConsole(value, mode),
      completeConsole: (value, cycleIndex, mode) => this.completeConsole(value, cycleIndex, mode),
      consoleVisibility: (open) => this.setConsoleVisibility(open),
    }, this.seed);
    this.configureScene();
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onConsoleHotkey);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  async initialize(): Promise<void> {
    this.ui.setLoading(0.08, 'LECTURE DU PLAN');
    this.materials = await MaterialLibrary.load(this.renderer, (ratio) => {
      this.ui.setLoading(0.1 + ratio * 0.48, 'CHARGEMENT DES MATÉRIAUX PBR');
    });
    this.ui.setLoading(0.62, 'INITIALISATION DES COLLISIONS');
    this.physics = await PhysicsWorld.create(this.plan);
    this.ui.setLoading(0.7, 'GÉNÉRATION DES ZONES VOISINES');
    this.worldStream = new WorldStream(
      this.seed,
      this.plan,
      this.scene,
      this.materials.materials,
      this.physics,
    );
    this.worldStream.initialize();
    this.camera.rotation.set(0, -Math.PI * 0.22, 0, 'YXZ');
    this.player = new PlayerController(this.camera, this.renderer.domElement, this.physics, {
      onLockChange: (locked) => this.ui.setLocked(locked),
      onFootstep: (strength) => this.audio.footstep(strength),
      onInteract: () => this.tryInteract(),
      onLand: () => this.audio.impact(),
      onFallReset: () => {
        this.audio.impact();
        this.ui.showFall();
      },
    });
    // Mount every starting chunk before shader compilation so the first
    // interactive frame already contains the full visible architecture.
    this.worldStream.update(0, 0, this.player.position);

    this.ui.setLoading(0.84, 'CALIBRAGE OPTIQUE');
    this.postFX = new PostFX(this.renderer, this.scene, this.camera);
    this.resize();
    await this.renderer.compileAsync(this.scene, this.camera);
    // Compile the composer passes while the loading layer is still covering
    // the canvas, avoiding a hitch on the first interactive frame.
    this.postFX.render(0);
    this.ui.setLoading(0.98, 'STABILISATION DU SIGNAL');
    this.updateDebugState(true);
    this.ui.setReady();
    this.renderer.setAnimationLoop(this.frame);
  }

  private configureScene(): void {
    this.scene.background = new THREE.Color(0x786b3d);
    this.scene.fog = new THREE.FogExp2(0x9b8a4f, 0.0049);
    // Only the low-frequency bounced light is global. Direct fluorescent
    // pools are baked per chunk so they remain spatially stable and cheap.
    const hemisphere = new THREE.HemisphereLight(0xffe9ad, 0x4e4023, 0.4);
    hemisphere.name = 'liminal-ambient-field';
    this.scene.add(hemisphere);
    const fill = new THREE.AmbientLight(0xffdda0, 0.065);
    fill.name = 'indirect-carpet-bounce';
    this.scene.add(fill);
    const directional = new THREE.DirectionalLight(0xffedbd, 0.18);
    directional.name = 'fluorescent-directional-fill';
    directional.position.set(3.5, 8, 2.5);
    this.scene.add(directional);
  }

  private enter(): void {
    this.player?.lock();
    void this.audio.start();
  }

  private tryInteract(): void {
    if (!this.player || !this.worldStream || this.player.isTraversing) return;
    this.player.getViewDirection(this.lookDirection);
    const interaction = this.worldStream.getInteraction(this.player.position, this.lookDirection);
    if (!interaction) return;
    if (this.player.beginTraversal(
      interaction.path,
      interaction.duration,
      interaction.duckDepth,
    )) this.ui.setInteraction(null);
  }

  private regenerate(): void {
    const url = new URL(window.location.href);
    const seed = createReadableSeed();
    sessionStorage.setItem('threshold-zero-seed', seed);
    url.searchParams.set('seed', seed);
    window.location.assign(url.toString());
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
    cycleIndex: number,
    _mode: ConsoleMode,
  ): ConsoleCompletion | null {
    const trimmed = value.trimStart();
    if (trimmed === '/') {
      return { value: '/locate ', hint: 'COMMANDE LOCATE', count: 1 };
    }
    if (!trimmed.toLowerCase().startsWith('/locate')) return null;
    const query = this.locateQueryFromInput(trimmed);
    const matches = this.locateMatches(query);
    if (matches.length === 0) return null;
    const target = matches[((cycleIndex % matches.length) + matches.length) % matches.length]!;
    return {
      value: `/locate ${target.command}`,
      hint: `${target.label.toUpperCase()} - ${Math.round(target.distance)}M`,
      count: matches.length,
    };
  }

  private submitConsole(value: string, mode: ConsoleMode): ConsoleSubmitResult {
    const trimmed = value.trim();
    if (trimmed.startsWith('/')) return this.executeCommand(trimmed);
    return {
      close: true,
      feedback: mode === 'chat' ? 'MESSAGE LOCAL ENREGISTRE' : 'ENTREE IGNORER',
    };
  }

  private executeCommand(input: string): ConsoleSubmitResult {
    const [command = '', ...args] = input.slice(1).trim().split(/\s+/);
    if (command.toLowerCase() !== 'locate') {
      return { close: false, feedback: `COMMANDE INCONNUE: /${command || '?'}` };
    }

    const query = args.join(' ').toLowerCase();
    if (!query) {
      const commands = this.locateMatches('').map((target) => target.command).join(', ');
      return {
        close: false,
        feedback: commands ? `TAB POUR CHOISIR: ${commands}` : 'AUCUNE CIBLE CHARGEE',
      };
    }

    const matches = this.locateMatches(query);
    if (matches.length === 0) {
      return { close: false, feedback: `AUCUNE CIBLE POUR: ${query}` };
    }
    const exact = matches.find((target) =>
      [target.command, ...target.aliases].some((alias) => alias.toLowerCase() === query),
    );
    const target = exact ?? matches[0]!;
    this.teleportToLocateTarget(target);
    return { close: true, feedback: `TP: ${target.label.toUpperCase()}` };
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

  private teleportToLocateTarget(target: LocateTarget): void {
    if (!this.player || !this.worldStream) return;
    this.player.teleport(target.position);
    this.worldStream.update(this.elapsed, 1 / 60, this.player.position);
    this.updateDebugState(true);
  }

  private readonly onConsoleHotkey = (event: KeyboardEvent): void => {
    if (event.repeat || this.disposed || !this.player || Game.isEditableTarget(event.target)) return;
    if (event.code !== 'KeyH' && event.code !== 'KeyC') return;
    event.preventDefault();
    if (this.ui.isConsoleOpen) {
      this.ui.closeConsole();
      if (event.code === 'KeyH') return;
    }
    this.ui.openConsole(event.code === 'KeyH' ? 'command' : 'chat');
  };

  private static isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || target.isContentEditable;
  }

  private readonly frame = (now: number): void => {
    if (this.disposed || !this.player || !this.worldStream || !this.postFX) return;
    const rawDelta = Math.min(0.05, Math.max(0, (now - this.previousTime) / 1000));
    this.previousTime = now;
    this.elapsed += rawDelta;
    this.accumulator = Math.min(this.accumulator + rawDelta, 0.12);
    const fixedDelta = 1 / 60;
    while (this.accumulator >= fixedDelta) {
      this.player.fixedUpdate(fixedDelta);
      this.accumulator -= fixedDelta;
    }
    this.player.renderUpdate(rawDelta, this.accumulator / fixedDelta);

    this.worldStream.update(this.elapsed, rawDelta, this.player.position);
    this.player.getViewDirection(this.lookDirection);
    const interaction = this.player.isTraversing
      ? null
      : this.worldStream.getInteraction(this.player.position, this.lookDirection);
    this.ui.setInteraction(this.player.isLocked ? interaction?.label ?? null : null);
    const room = this.worldStream.findRoomAt(
      this.player.position.x,
      this.player.position.y,
      this.player.position.z,
    );
    this.audio.update(room);
    this.postFX.render(rawDelta);

    const instantaneousFps = rawDelta > 0 ? 1 / rawDelta : 60;
    this.fps = THREE.MathUtils.lerp(this.fps, instantaneousFps, 0.055);
    this.frameCounter += 1;
    this.metricsTimer += rawDelta;
    this.qualityTimer += rawDelta;
    if (this.metricsTimer >= 0.35) {
      this.metricsTimer = 0;
      this.ui.update(room, this.fps);
      this.updateDebugState(true);
    }
    if (this.qualityTimer >= 2) {
      this.qualityTimer = 0;
      this.adaptQuality();
    }
  };

  private adaptQuality(): void {
    const maxRatio = Math.min(window.devicePixelRatio, 1.1);
    let next = this.pixelRatio;
    if (this.fps < 57) next = Math.max(0.7, this.pixelRatio - 0.08);
    else if (this.fps > 59.5) next = Math.min(maxRatio, this.pixelRatio + 0.025);
    if (Math.abs(next - this.pixelRatio) >= 0.024) {
      this.pixelRatio = next;
      this.resize();
    }
  }

  private readonly resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.pixelRatio = this.pixelRatio || Math.min(window.devicePixelRatio, 1.25);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.postFX?.setSize(width, height);
  };

  private readonly onVisibilityChange = (): void => {
    void this.audio.setSuspended(document.hidden);
    this.previousTime = performance.now();
    this.accumulator = 0;
  };

  private updateDebugState(ready: boolean): void {
    const player = this.player?.position ?? new THREE.Vector3(this.plan.spawn.x, this.plan.spawn.y, this.plan.spawn.z);
    const stream = this.worldStream?.getDebugCounts();
    window.__BACKROOMS__ = {
      ready,
      seed: this.seed,
      fingerprint: fingerprintWorld(this.plan),
      rooms: stream?.rooms ?? this.plan.rooms.length,
      lights: stream?.lights ?? this.plan.lights.length,
      features: this.plan.features.map((feature) => feature.kind),
      player: { x: player.x, y: player.y, z: player.z },
      fps: this.fps,
      pixelRatio: this.pixelRatio,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      chunks: stream?.chunks ?? 1,
      pendingChunks: stream?.pendingChunks ?? 0,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onConsoleHotkey);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.player?.dispose();
    this.worldStream?.dispose();
    this.physics?.dispose();
    this.postFX?.dispose();
    this.materials?.dispose();
    this.audio.dispose();
    this.renderer.dispose();
  }
}
