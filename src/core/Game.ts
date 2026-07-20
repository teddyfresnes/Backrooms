import * as THREE from 'three';
import { AudioSystem } from '../audio/AudioSystem';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { PlayerController } from '../player/PlayerController';
import { AdaptiveRenderScale, renderScaleLimits } from '../render/AdaptiveQuality';
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
  private pixelRatio: number;
  private readonly adaptiveRenderScale: AdaptiveRenderScale;
  private disposed = false;

  constructor(private readonly container: HTMLElement) {
    if (!document.createElement('canvas').getContext('webgl2')) {
      throw new Error('WebGL 2 est requis pour explorer cette archive.');
    }
    const renderScale = renderScaleLimits(
      window.innerWidth,
      window.innerHeight,
      window.devicePixelRatio,
      matchMedia('(pointer: coarse)').matches,
    );
    this.adaptiveRenderScale = new AdaptiveRenderScale(renderScale);
    this.pixelRatio = this.adaptiveRenderScale.value;
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
    // The composer performs several renderer calls. Reset once per presented
    // frame so debug draw/triangle counts cover the whole pipeline.
    this.renderer.info.autoReset = false;
    this.root.append(this.renderer.domElement);

    this.ui = new ExperienceUI(this.root, this.plan, {
      enter: () => this.enter(),
      regenerate: () => this.regenerate(),
      toggleFullscreen: () => void this.toggleFullscreen(),
      submitConsole: (value, mode) => this.submitConsole(value, mode),
      completeConsole: (value, mode) => this.completeConsole(value, mode),
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
    await this.worldStream.initialize();
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
    // Warm every composer target behind the opaque loading overlay. The
    // post-processing pipeline has its own shader/target allocation that
    // renderer.compileAsync cannot cover; priming several presented frames
    // prevents black frames when the player first dismisses the overlay.
    await this.warmupPostFX();
    this.ui.setLoading(0.98, 'STABILISATION DU SIGNAL');
    this.updateDebugState(true);
    this.ui.setReady();
    this.renderer.setAnimationLoop(this.frame);
  }

  private configureScene(): void {
    this.scene.background = new THREE.Color(0x45452d);
    this.scene.fog = new THREE.FogExp2(0x77754b, 0.0042);
    // Only the low-frequency bounced light is global. Direct fluorescent
    // pools are baked per chunk so they remain spatially stable and cheap.
    const hemisphere = new THREE.HemisphereLight(0xfff7d8, 0x282619, 0.17);
    hemisphere.name = 'liminal-ambient-field';
    this.scene.add(hemisphere);
    const fill = new THREE.AmbientLight(0xfff0c4, 0.018);
    fill.name = 'indirect-carpet-bounce';
    this.scene.add(fill);
    const directional = new THREE.DirectionalLight(0xfff5d8, 0.07);
    directional.name = 'fluorescent-directional-fill';
    directional.position.set(3.5, 8, 2.5);
    this.scene.add(directional);
  }

  private async warmupPostFX(): Promise<void> {
    if (!this.postFX) return;
    for (let frame = 0; frame < 3; frame += 1) {
      this.postFX.render(1 / 60);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    this.previousTime = performance.now();
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
    sessionStorage.removeItem('threshold-zero-auto-seed');
    sessionStorage.removeItem('threshold-zero-seed');
    url.searchParams.delete('seed');
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
    _mode: ConsoleMode,
  ): ConsoleCompletion | null {
    const trimmed = value.trimStart();
    if (!trimmed.startsWith('/')) return null;
    const commandSuggestions = [
      { value: '/help', label: '/help', detail: 'AFFICHE LES COMMANDES DISPONIBLES' },
      { value: '/locate ', label: '/locate <cible>', detail: 'TÉLÉPORTE VERS UNE CIBLE CHARGÉE' },
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
    if (!/^\/locate(?:\s|$)/i.test(trimmed)) return null;
    const query = this.locateQueryFromInput(trimmed);
    const matches = this.locateMatches(query);
    if (matches.length === 0) return null;
    return {
      hint: `${matches.length} CIBLE(S) CHARGÉE(S) · TAB POUR PARCOURIR`,
      suggestions: matches.map((target) => ({
        value: `/locate ${target.command}`,
        label: target.command,
        detail: `${target.label.toUpperCase()} · ${Math.round(target.distance)} M`,
      })),
    };
  }

  private submitConsole(value: string, mode: ConsoleMode): ConsoleSubmitResult {
    const trimmed = value.trim();
    if (trimmed.startsWith('/')) return this.executeCommand(trimmed);
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
      const feedback = '/locate <cible> — téléportation · C — chat local · H — commandes';
      return { close: false, feedback, messages: [echo, { kind: 'system', text: feedback }] };
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
        : 'AUCUNE CIBLE N’EST CHARGÉE';
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
    this.teleportToLocateTarget(target);
    const feedback = `TÉLÉPORTATION: ${target.label.toUpperCase()} · ${Math.round(target.distance)} M`;
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

  private teleportToLocateTarget(target: LocateTarget): void {
    if (!this.player || !this.worldStream) return;
    this.player.teleport(target.position);
    this.worldStream.update(this.elapsed, 1 / 60, this.player.position);
    this.updateDebugState(true);
  }

  private readonly onConsoleHotkey = (event: KeyboardEvent): void => {
    if (event.repeat || this.disposed || !this.player || Game.isEditableTarget(event.target)) return;
    if (event.code !== 'KeyH' && event.code !== 'KeyC') return;
    if (!this.player.isLocked) return;
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
    const measuredDelta = Math.max(0, (now - this.previousTime) / 1000);
    const rawDelta = Math.min(0.05, measuredDelta);
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

    // Keep simulation deltas bounded, but measure the real wall-clock frame.
    // Generation stalls must remain visible to both the HUD and quality loop.
    const instantaneousFps = measuredDelta > 0 ? 1 / measuredDelta : 60;
    this.fps = THREE.MathUtils.lerp(this.fps, instantaneousFps, 0.055);
    const nextPixelRatio = this.adaptiveRenderScale.update(this.fps, measuredDelta);
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
