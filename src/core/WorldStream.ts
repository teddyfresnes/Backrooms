import * as THREE from 'three';
import type {
  LookTargetDiagnostics,
  StreamingDiagnostics,
  WorldDiagnostics,
} from './Diagnostics';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { bakeLightMapData } from '../render/BakedLighting';
import type { BakedLightMapData } from '../render/BakedLighting';
import type { LightingMode } from '../render/LightingMode';
import type { BiomeMaterialSets } from '../render/MaterialLibrary';
import { unlitZoneInfluence } from '../render/ZonalLighting';
import { WorldView } from '../render/WorldBuilder';
import type { DoorWorldInteraction, WorldInteraction } from '../render/WorldBuilder';
import {
  EPIC_STRUCTURE_DEFINITIONS,
  getEpicLocateDestination,
  getEpicStructureDefinition,
  getNearestEpicStructureCoord,
  isInsideEpicStoryVolume,
} from '../world/EpicStructures';
import {
  INFINITE_CHUNK_SIZE,
  INFINITE_STORY_PITCH,
  attachInfiniteChunkMetadata,
  createChunkKey,
  generateInfiniteChunk,
  getChunkWorldOffset,
  getInfiniteChunkMetadata,
  parseChunkKey,
} from '../world/InfiniteWorld';
import type {
  ChunkCoord,
  ChunkKey,
} from '../world/InfiniteWorld';
import type {
  RaisedZoneFeature,
  Rect,
  RoomKind,
  Vec3Data,
  VisualBiome,
  WorldPlan,
  DoorOpenMode,
} from '../world/types';
import { pointInRect, rectArea, rectCenter, rectDepth, rectWidth } from '../world/types';

const ACTIVE_RADIUS = 1;
const HALF_CHUNK_SIZE = INFINITE_CHUNK_SIZE * 0.5;
interface ActiveChunk {
  key: ChunkKey;
  coord: Readonly<ChunkCoord>;
  plan: WorldPlan;
  lightMaps?: BakedLightMapData;
  lightingMode: LightingMode;
  view: WorldView;
  offset: THREE.Vector3;
}

interface WorkerResponse {
  id: number;
  key: ChunkKey;
  plan?: WorldPlan;
  lightMaps?: BakedLightMapData;
  error?: string;
}

interface LightingWorkerResponse {
  id: number;
  lightMaps?: BakedLightMapData;
  error?: string;
}

interface PreparedChunk {
  plan: WorldPlan;
  lightMaps?: BakedLightMapData;
}

export interface WorldLightingContext {
  readonly biome: VisualBiome;
  readonly darkness: number;
}

export interface WorldStreamDebugCounts extends StreamingDiagnostics {}

export interface WorldStreamDiagnostics {
  world: WorldDiagnostics;
  target: LookTargetDiagnostics | null;
  streaming: WorldStreamDebugCounts;
}

export interface LightingTransitionProgress {
  readonly completed: number;
  readonly total: number;
}

export interface LocateTarget {
  command: string;
  label: string;
  aliases: readonly string[];
  position: Vec3Data;
  distance: number;
  chunkKey: ChunkKey;
}

/** Chunks that must already be visible when a locate teleport completes. */
export const locateWarmupCoords = (target: Pick<LocateTarget, 'chunkKey' | 'command'>): ChunkCoord[] => {
  const owner = parseChunkKey(target.chunkKey);
  if (target.command !== 'epic1') return [owner];
  // epic1's locate point faces the north entrance. Mounting that neighbour
  // before teleporting turns the short through-corridor into a real maze view
  // instead of exposing the scene background for one or more frames.
  return [owner, { x: owner.x, z: owner.z - 1, story: owner.story }];
};

const stableFloor = (value: number): number => {
  const nearestInteger = Math.round(value);
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(value)) * 8;
  return Math.abs(value - nearestInteger) <= tolerance
    ? nearestInteger
    : Math.floor(value);
};

export const streamChunkCoordAt = (position: Pick<THREE.Vector3, 'x' | 'y' | 'z'>): ChunkCoord => ({
  x: stableFloor((position.x + HALF_CHUNK_SIZE) / INFINITE_CHUNK_SIZE),
  z: stableFloor((position.z + HALF_CHUNK_SIZE) / INFINITE_CHUNK_SIZE),
  // Floors live at integer multiples of the story pitch. Switching halfway
  // through the inter-storey shaft ensures the destination chunk is mounted
  // before the player can reach its floor.
  story: stableFloor((position.y + INFINITE_STORY_PITCH * 0.5) / INFINITE_STORY_PITCH),
});

export const streamedCoordsAround = (center: ChunkCoord): ChunkCoord[] => {
  const coords: ChunkCoord[] = [];
  for (let deltaZ = -ACTIVE_RADIUS; deltaZ <= ACTIVE_RADIUS; deltaZ += 1) {
    for (let deltaX = -ACTIVE_RADIUS; deltaX <= ACTIVE_RADIUS; deltaX += 1) {
      coords.push({ x: center.x + deltaX, z: center.z + deltaZ, story: center.story });
    }
  }
  return coords.sort((left, right) => {
    const leftDistance = Math.abs(left.x - center.x) + Math.abs(left.z - center.z);
    const rightDistance = Math.abs(right.x - center.x) + Math.abs(right.z - center.z);
    return leftDistance - rightDistance || left.z - right.z || left.x - right.x;
  });
};

export const streamedCoordsAroundLongitudinalEpic = (
  center: ChunkCoord,
): ChunkCoord[] => streamedCoordsAround(center).filter((coord) => coord.x === center.x);

export const shouldDeferStoryTransition = (
  current: ChunkCoord,
  observed: ChunkCoord,
  destinationReady: boolean,
  workerAvailable: boolean,
): boolean =>
  workerAvailable && observed.story !== current.story && !destinationReady;

export const nextEpicAbyssPrefetchCoord = (coord: ChunkCoord): ChunkCoord => ({
  x: coord.x,
  z: coord.z,
  story: coord.story - 1,
});

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const distanceToRect = (x: number, z: number, rect: Rect): number => {
  const deltaX = Math.max(rect.minX - x, 0, x - rect.maxX);
  const deltaZ = Math.max(rect.minZ - z, 0, z - rect.maxZ);
  return Math.hypot(deltaX, deltaZ);
};

const worldPoint = (
  local: Vec3Data,
  offset: THREE.Vector3,
): Vec3Data => ({
  x: local.x + offset.x,
  y: local.y + offset.y,
  z: local.z + offset.z,
});

const approachPointForRect = (
  rect: Rect,
  bounds: Rect,
  y: number,
): Vec3Data => {
  const center = rectCenter(rect);
  const margin = 0.95;
  const northSpace = rect.minZ - bounds.minZ;
  const southSpace = bounds.maxZ - rect.maxZ;
  const westSpace = rect.minX - bounds.minX;
  const eastSpace = bounds.maxX - rect.maxX;
  const side = [
    { axis: 'z' as const, value: rect.minZ - margin, room: northSpace },
    { axis: 'z' as const, value: rect.maxZ + margin, room: southSpace },
    { axis: 'x' as const, value: rect.minX - margin, room: westSpace },
    { axis: 'x' as const, value: rect.maxX + margin, room: eastSpace },
  ].sort((a, b) => b.room - a.room)[0]!;
  if (side.axis === 'x') {
    return {
      x: clamp(side.value, bounds.minX + 0.7, bounds.maxX - 0.7),
      y,
      z: clamp(center.z, bounds.minZ + 0.7, bounds.maxZ - 0.7),
    };
  }
  return {
    x: clamp(center.x, bounds.minX + 0.7, bounds.maxX - 0.7),
    y,
    z: clamp(side.value, bounds.minZ + 0.7, bounds.maxZ - 0.7),
  };
};

export class WorldStream {
  private readonly chunks = new Map<ChunkKey, ActiveChunk>();
  private readonly localPlayer = new THREE.Vector3();
  private readonly runtimeOffset = new THREE.Vector3();
  private readonly diagnosticsRaycaster = new THREE.Raycaster();
  private centerCoord: ChunkCoord = { x: 0, z: 0, story: 0 };
  private pendingChunks = 0;
  private sourceCount = 0;
  private worker?: Worker;
  private workerRequestId = 0;
  private workerInFlight?: {
    id: number;
    key: ChunkKey;
    coord: Readonly<ChunkCoord>;
    prefetch: boolean;
  };
  private readonly preparedChunks = new Map<ChunkKey, PreparedChunk>();
  private readonly verticalPrefetchQueue: ChunkCoord[] = [];
  private readonly priorityVerticalPrefetchKeys = new Set<ChunkKey>();
  private readonly preparationWorkers = new Map<Worker, (reason?: unknown) => void>();
  private readonly lightingWorkers = new Map<Worker, (reason?: unknown) => void>();
  private pendingStoryKey?: ChunkKey;
  private recoveryChunkKey?: ChunkKey;
  private recoveryChunk?: { key: ChunkKey; prepared: PreparedChunk };
  private initialized = false;
  private disposed = false;
  private lightingRevision = 0;

  constructor(
    private readonly seed: string,
    private readonly originPlan: WorldPlan,
    private readonly scene: THREE.Scene,
    private readonly materials: BiomeMaterialSets,
    private readonly physics: PhysicsWorld,
    private lightingMode: LightingMode = 'modern',
  ) {
    if (typeof Worker !== 'undefined') {
      this.worker = new Worker(new URL('../world/infinite.worker.ts', import.meta.url), { type: 'module' });
      this.worker.addEventListener('message', this.onWorkerMessage);
      this.worker.addEventListener('error', this.onWorkerError);
    }
  }

  async initialize(): Promise<void> {
    this.assertUsable();
    if (this.initialized) return;

    const originMetadata = getInfiniteChunkMetadata(this.originPlan);
    if (!originMetadata) {
      throw new Error('WorldStream originPlan must come from generateInfiniteChunk().');
    }
    if (
      originMetadata.coord.x !== 0 ||
      originMetadata.coord.z !== 0 ||
      originMetadata.coord.story !== 0
    ) {
      throw new Error('WorldStream currently requires the 0:0:0 chunk as its origin plan.');
    }

    const initialCoords = streamedCoordsAround(originMetadata.coord);
    const neighbourCoords = initialCoords.filter(
      (coord) => createChunkKey(coord) !== originMetadata.key,
    );
    const workerPreparation = this.worker
      ? this.prepareInitialChunks(neighbourCoords)
      : Promise.resolve(new Map<ChunkKey, PreparedChunk>());
    // The origin is already generated, so bake it locally while temporary
    // workers prepare the eight neighbours in parallel.
    const originLightMaps = this.lightingMode === 'legacy'
      ? bakeLightMapData(this.originPlan)
      : undefined;
    let prepared = new Map<ChunkKey, PreparedChunk>();
    try {
      prepared = await workerPreparation;
    } catch {
      this.disableWorker();
      prepared.clear();
    }

    try {
      this.physics.batchChunkChanges(() => {
        this.physics.removeChunk('origin');
        for (const coord of initialCoords) {
          const key = createChunkKey(coord);
          const ready = prepared.get(key);
          const plan = key === originMetadata.key
            ? this.originPlan
            : ready?.plan ?? generateInfiniteChunk(this.seed, key);
          this.mountChunk(
            plan,
            coord,
            key === originMetadata.key ? originLightMaps : ready?.lightMaps,
          );
        }
      });
      this.centerCoord = { x: 0, z: 0, story: 0 };
      this.initialized = true;
      this.pendingChunks = 0;
      this.refreshLightSources();
    } catch (error) {
      this.clearMountedChunks();
      if (!this.physics.hasChunk('origin')) {
        this.physics.addChunk('origin', this.originPlan.colliders, { x: 0, y: 0, z: 0 });
      }
      throw error;
    }
  }

  /**
   * Streams a 3x3 horizontal neighborhood. Initial loading is eager; after
   * that, at most one missing chunk is generated and mounted per frame.
   */
  update(
    time: number,
    delta: number,
    playerPosition: THREE.Vector3,
  ): void {
    if (!this.initialized || this.disposed) return;

    const observedCenter = streamChunkCoordAt(playerPosition);
    const epicPinnedCoord = this.getEpicPinnedCoord(playerPosition);
    const epicStoryPinned = epicPinnedCoord !== undefined;
    let nextCenter = observedCenter;
    const observedKey = createChunkKey(observedCenter);
    if (epicStoryPinned) {
      // Tall epic volumes belong to their mounted source plan even when their
      // local height crosses many ordinary logical stories. epic1 is excluded
      // by its feature contract so its passages use the normal pit hand-off.
      nextCenter = { ...epicPinnedCoord };
      this.pendingStoryKey = undefined;
    } else if (shouldDeferStoryTransition(
      this.centerCoord,
      observedCenter,
      this.chunks.has(observedKey) || this.preparedChunks.has(observedKey),
      this.worker !== undefined,
    )) {
      // Keep the compact preview and its colliders alive while the worker
      // completes the destination. This turns a former synchronous 10 s
      // freeze into a normal background transition at the landing.
      this.pendingStoryKey = observedKey;
      this.enqueueVerticalPrefetch(observedCenter, true);
      this.pumpVerticalPrefetch();
      nextCenter = this.centerCoord;
    } else {
      this.pendingStoryKey = undefined;
    }
    const storyChanged = nextCenter.story !== this.centerCoord.story;
    this.centerCoord = nextCenter;
    const desiredCoords = this.desiredCoordsAroundCenter();
    const desiredKeys = new Set(desiredCoords.map(createChunkKey));
    let sourcesChanged = false;

    // The destination is already prepared whenever workers are available. A
    // synchronous fallback remains only for environments without Worker.
    const centerKey = createChunkKey(this.centerCoord);
    this.physics.batchChunkChanges(() => {
      if (storyChanged && !this.chunks.has(centerKey)) {
        const prepared = this.preparedChunks.get(centerKey);
        this.mountChunk(
          prepared?.plan ?? generateInfiniteChunk(this.seed, centerKey),
          this.centerCoord,
          prepared?.lightMaps,
        );
        this.preparedChunks.delete(centerKey);
        sourcesChanged = true;
      }

      for (const key of [...this.chunks.keys()]) {
        if (desiredKeys.has(key)) continue;
        this.unmountChunk(key);
        sourcesChanged = true;
      }
    });

    let missing = desiredCoords.filter((coord) => !this.chunks.has(createChunkKey(coord)));
    const readyCoord = missing.find((coord) => this.preparedChunks.has(createChunkKey(coord)));
    if (readyCoord) {
      const readyKey = createChunkKey(readyCoord);
      const ready = this.preparedChunks.get(readyKey)!;
      this.preparedChunks.delete(readyKey);
      this.mountChunk(ready.plan, readyCoord, ready.lightMaps);
      sourcesChanged = true;
      missing = desiredCoords.filter((coord) => !this.chunks.has(createChunkKey(coord)));
    }
    this.pendingChunks = missing.length + (this.pendingStoryKey ? 1 : 0);
    // Prepare the ordinary destination as soon as the current neighbourhood
    // is stable. Near a known multi-storey shaft, queue its complete vertical chain in
    // advance so consecutive midpoints never wait behind horizontal jobs.
    const localStoryY = playerPosition.y - this.centerCoord.story * INFINITE_STORY_PITCH;
    if (this.worker && !epicStoryPinned && missing.length === 0 && localStoryY < 1.1) {
      this.enqueueVerticalPrefetch({
        x: this.centerCoord.x,
        z: this.centerCoord.z,
        story: this.centerCoord.story - 1,
      });
    }
    const activeRuntime = this.runtimeAt(playerPosition);
    if (this.worker && activeRuntime) {
      const localX = playerPosition.x - activeRuntime.offset.x;
      const localZ = playerPosition.z - activeRuntime.offset.z;
      for (const feature of activeRuntime.plan.features) {
        if (feature.kind === 'grid-pit') {
          for (const hole of feature.holes) {
            if (distanceToRect(localX, localZ, hole) > 16) continue;
            const stories = Math.max(1, hole.stories ?? 1);
            for (let distance = 1; distance <= stories; distance += 1) {
              this.enqueueVerticalPrefetch({
                x: activeRuntime.coord.x,
                z: activeRuntime.coord.z,
                story: activeRuntime.coord.story - distance,
              });
            }
          }
        } else if (
          feature.kind === 'epic-structure' &&
          feature.variant === 'endless-abyss' &&
          feature.voidBounds &&
          distanceToRect(localX, localZ, feature.voidBounds) <= 22
        ) {
          // Only prepare the immediately reachable story. It is urgent enough
          // to overtake horizontal background jobs; once mounted, that story
          // schedules the next one. This avoids generating three complete
          // epic chunks in one burst as the player crosses a ledge.
          this.enqueueVerticalPrefetch(nextEpicAbyssPrefetchCoord(activeRuntime.coord), true);
        } else if (
          feature.kind === 'stair-socket' &&
          !feature.inherited &&
          distanceToRect(localX, localZ, feature.bounds) <= 18
        ) {
          this.enqueueVerticalPrefetch({
            x: activeRuntime.coord.x,
            z: activeRuntime.coord.z,
            story: activeRuntime.coord.story + 1,
          });
        }
      }
    }
    this.pumpVerticalPrefetch();

    const next = missing.find((coord) => createChunkKey(coord) !== this.workerInFlight?.key);
    if (next && !this.workerInFlight) {
      const key = createChunkKey(next);
      if (!this.worker) {
        this.mountChunk(generateInfiniteChunk(this.seed, key), next);
        this.pendingChunks = Math.max(0, this.pendingChunks - 1);
        sourcesChanged = true;
      } else {
        const id = ++this.workerRequestId;
        this.workerInFlight = { id, key, coord: next, prefetch: false };
        this.worker.postMessage({ id, seed: this.seed, key, lightingMode: this.lightingMode });
      }
    }

    if (sourcesChanged) this.refreshLightSources();

    for (const runtime of this.chunks.values()) {
      this.localPlayer.copy(playerPosition).sub(runtime.offset);
      runtime.view.update(time, this.localPlayer, delta);
      for (const colliderId of runtime.view.consumePassableDoorColliderIds()) {
        this.physics.setChunkColliderEnabled(runtime.key, colliderId, false);
      }
    }
  }

  getInteraction(
    playerPosition: THREE.Vector3,
    lookDirection: THREE.Vector3,
  ): WorldInteraction | null {
    if (!this.initialized || this.disposed) return null;
    const runtime = this.runtimeAt(playerPosition);
    if (!runtime) return null;

    this.localPlayer.copy(playerPosition).sub(runtime.offset);
    const interaction = runtime.view.getInteraction(this.localPlayer, lookDirection);
    if (!interaction) return null;
    if (interaction.kind === 'door') return interaction;
    return {
      ...interaction,
      path: interaction.path.map((point) => ({
        x: point.x + runtime.offset.x,
        y: point.y + runtime.offset.y,
        z: point.z + runtime.offset.z,
      })),
    };
  }

  openDoor(
    playerPosition: THREE.Vector3,
    interaction: DoorWorldInteraction,
    mode: DoorOpenMode,
  ): boolean {
    if (!this.initialized || this.disposed) return false;
    const runtime = this.runtimeAt(playerPosition);
    if (!runtime) return false;
    const colliderId = runtime.view.openDoor(interaction.doorId, mode);
    return colliderId !== null;
  }

  findRoomAt(x: number, y: number, z: number): RoomKind {
    if (!this.initialized || this.disposed) return 'threshold';
    this.runtimeOffset.set(x, y, z);
    const runtime = this.runtimeAt(this.runtimeOffset);
    if (!runtime) return 'threshold';
    return runtime.view.findRoomAt(
      x - runtime.offset.x,
      y - runtime.offset.y,
      z - runtime.offset.z,
    );
  }

  getLightingMode(): LightingMode {
    return this.lightingMode;
  }

  getCenterCoord(): Readonly<ChunkCoord> {
    return { ...this.centerCoord };
  }

  async setLightingMode(
    mode: LightingMode,
    onProgress?: (progress: LightingTransitionProgress) => void,
  ): Promise<void> {
    this.assertUsable();
    const targets = [...this.chunks.values()].filter(
      (runtime) => runtime.lightingMode !== mode,
    );
    if (mode === this.lightingMode && targets.length === 0) return;

    this.lightingMode = mode;
    const revision = ++this.lightingRevision;
    let completed = 0;
    const report = (): void => {
      try {
        onProgress?.({ completed, total: targets.length });
      } catch {
        // A presentation callback must never interrupt the renderer transition.
      }
    };
    report();
    if (targets.length === 0) return;

    const queue = [...targets];
    const run = async (): Promise<void> => {
      while (queue.length > 0) {
        const runtime = queue.shift();
        if (!runtime) return;
        let lightMaps = runtime.lightMaps;
        if (mode === 'legacy' && !lightMaps) {
          lightMaps = await this.bakeLegacyLightMaps(runtime.plan);
        }
        if (
          this.disposed ||
          this.lightingRevision !== revision ||
          this.lightingMode !== mode
        ) return;
        await this.replaceChunkView(runtime, mode, lightMaps, revision);
        completed += 1;
        report();
      }
    };
    const concurrency = Math.min(3, targets.length);
    await Promise.all(Array.from({ length: concurrency }, () => run()));
  }

  getLightingContext(playerPosition: THREE.Vector3): WorldLightingContext {
    const runtime = this.runtimeAt(playerPosition);
    if (!runtime) return { biome: 'yellow', darkness: 0 };
    const localY = playerPosition.y - runtime.offset.y;
    const storyIsAffected = localY >= -0.55 && localY <= runtime.plan.wallHeight + 0.55;
    return {
      biome: runtime.plan.visualBiome ?? 'yellow',
      darkness: this.lightingMode === 'modern' && storyIsAffected
        ? unlitZoneInfluence(
            runtime.plan.unlitZones ?? [],
            playerPosition.x - runtime.offset.x,
            playerPosition.z - runtime.offset.z,
            1.35,
          )
        : 0,
    };
  }

  /** Prepares and mounts the destination collider before Game teleports. */
  async prepareLocateTarget(target: LocateTarget): Promise<boolean> {
    return this.prepareAndMountCoords(locateWarmupCoords(target));
  }

  /** Prepares an exact saved chunk before restoring the player into it. */
  async prepareSavedChunk(coord: ChunkCoord): Promise<boolean> {
    return this.prepareAndMountCoords([coord]);
  }

  private async prepareAndMountCoords(warmupCoords: readonly ChunkCoord[]): Promise<boolean> {
    if (!this.initialized || this.disposed) return false;
    const prepared = await Promise.all(warmupCoords.map(async (coord) => {
      const key = createChunkKey(coord);
      if (this.chunks.has(key)) return { coord, key, prepared: undefined };
      const cached = this.preparedChunks.get(key);
      if (cached) return { coord, key, prepared: cached };
      const generated = typeof Worker !== 'undefined'
        ? await this.prepareChunkWithWorker(key)
        : (() => {
            const plan = generateInfiniteChunk(this.seed, key);
            const lightMaps = this.lightingMode === 'legacy'
              ? bakeLightMapData(plan)
              : undefined;
            return { plan, lightMaps };
          })();
      return { coord, key, prepared: generated };
    }));
    if (this.disposed) return false;
    this.physics.batchChunkChanges(() => {
      for (const ready of prepared) {
        if (!ready.prepared) continue;
        this.mountChunk(ready.prepared.plan, ready.coord, ready.prepared.lightMaps);
      }
    });
    for (const ready of prepared) this.preparedChunks.delete(ready.key);
    this.refreshLightSources();
    return warmupCoords.every((coord) => this.chunks.has(createChunkKey(coord)));
  }

  /** Marks the grounded chunk whose CPU snapshot must survive a later unmount. */
  protectRecoveryPosition(position: Pick<THREE.Vector3, 'x' | 'y' | 'z'>): void {
    if (!this.initialized || this.disposed) return;
    this.runtimeOffset.set(position.x, position.y, position.z);
    const owner = this.getEpicPinnedCoord(this.runtimeOffset) ?? streamChunkCoordAt(position);
    const key = createChunkKey(owner);
    if (key === this.recoveryChunkKey) return;
    this.recoveryChunkKey = key;
    if (this.recoveryChunk?.key !== key) this.recoveryChunk = undefined;
  }

  /** Restores a collider immediately when a deep-fall watchdog returns home. */
  ensurePositionMounted(position: Pick<THREE.Vector3, 'x' | 'y' | 'z'>): void {
    if (!this.initialized || this.disposed) return;
    this.runtimeOffset.set(position.x, position.y, position.z);
    const coord = this.getEpicPinnedCoord(this.runtimeOffset) ?? streamChunkCoordAt(position);
    const key = createChunkKey(coord);
    if (this.chunks.has(key)) return;
    if (this.recoveryChunk?.key === key) {
      this.physics.batchChunkChanges(() => {
        this.mountChunk(
          this.recoveryChunk!.prepared.plan,
          coord,
          this.recoveryChunk!.prepared.lightMaps,
        );
      });
      this.refreshLightSources();
      return;
    }
    const prepared = this.preparedChunks.get(key);
    if (!prepared && this.worker) {
      this.enqueueVerticalPrefetch(coord, true);
      this.pumpVerticalPrefetch(true);
      return;
    }
    this.physics.batchChunkChanges(() => {
      const plan = prepared?.plan ?? generateInfiniteChunk(this.seed, key);
      this.mountChunk(plan, coord, prepared?.lightMaps);
    });
    this.preparedChunks.delete(key);
    this.refreshLightSources();
  }

  getLocateTargets(playerPosition: THREE.Vector3): LocateTarget[] {
    if (!this.initialized || this.disposed) return [];
    const bestByCommand = new Map<string, LocateTarget>();
    const addWorldTarget = (
      chunkKey: ChunkKey,
      command: string,
      label: string,
      aliases: readonly string[],
      position: Vec3Data,
    ): void => {
      const distance = Math.hypot(
        position.x - playerPosition.x,
        position.y - playerPosition.y,
        position.z - playerPosition.z,
      );
      const existing = bestByCommand.get(command);
      if (existing && existing.distance <= distance) return;
      bestByCommand.set(command, {
        command,
        label,
        aliases,
        position,
        distance,
        chunkKey,
      });
    };
    const addTarget = (
      runtime: ActiveChunk,
      command: string,
      label: string,
      aliases: readonly string[],
      localPosition: Vec3Data,
    ): void => addWorldTarget(
      runtime.key,
      command,
      label,
      aliases,
      worldPoint(localPosition, runtime.offset),
    );

    for (const runtime of this.chunks.values()) {
      const propGroups = new Map<string, Rect>();
      for (const placement of runtime.plan.propPlacements ?? []) {
        const key = placement.sceneId ?? placement.id;
        const existing = propGroups.get(key);
        propGroups.set(key, existing
          ? {
              minX: Math.min(existing.minX, placement.bounds.minX),
              minZ: Math.min(existing.minZ, placement.bounds.minZ),
              maxX: Math.max(existing.maxX, placement.bounds.maxX),
              maxZ: Math.max(existing.maxZ, placement.bounds.maxZ),
            }
          : { ...placement.bounds });
        const room = runtime.plan.rooms.find((candidate) => candidate.id === placement.roomId);
        if (!room) continue;
        if (
          placement.assetId === 'polyhaven:television_01' ||
          placement.assetId === 'polyhaven:television_02'
        ) {
          addTarget(
            runtime,
            'crt-tv',
            'television cathodique',
            ['crt', 'tv', 'television', 'télévision', 'television-cathodique'],
            approachPointForRect(placement.bounds, room.bounds, 0.865),
          );
        }
      }
      for (const bounds of propGroups.values()) {
        const center = rectCenter(bounds);
        const room = runtime.plan.rooms.find((candidate) =>
          pointInRect(center.x, center.z, candidate.bounds)
        );
        if (!room) continue;
        addTarget(
          runtime,
          'objects',
          'objets abandonnes',
          ['object', 'objects', 'objet', 'objets', 'props', 'scene', 'scène'],
          approachPointForRect(bounds, room.bounds, 0.865),
        );
      }
      for (const feature of runtime.plan.features) {
        if (feature.kind === 'grid-pit') {
          const largest = [...feature.holes].sort((a, b) => rectArea(b) - rectArea(a))[0];
          if (largest) {
            addTarget(
              runtime,
              'holes',
              `trous en grille ${feature.pattern}`,
              ['hole', 'holes', 'trou', 'trous', 'pit', 'grille'],
              approachPointForRect(largest, feature.bounds, 0.865),
            );
            addTarget(
              runtime,
              'large-hole',
              'grand trou',
              ['grand-trou', 'big-hole', 'large-hole', 'hole-large'],
              approachPointForRect(largest, feature.bounds, 0.865),
            );
          }
          for (const hole of feature.holes) {
            const command = hole.kind === 'void' ? 'void' : 'hole';
            const stories = Math.max(1, hole.stories ?? 1);
            addTarget(
              runtime,
              command,
              hole.kind === 'void'
                ? 'trou profond mortel'
                : `puits de ${stories} etage${stories > 1 ? 's' : ''}`,
              hole.kind === 'void'
                ? ['void', 'abyss', 'abysse', 'deep-hole', 'trou-profond']
                : ['hole', 'holes', 'trou', 'trous', 'pit'],
              approachPointForRect(hole, feature.bounds, 0.865),
            );
          }
          const drop = feature.holes.find((hole) => hole.kind !== 'void');
          if (drop) {
            const center = rectCenter(drop);
            const stories = Math.max(1, drop.stories ?? 1);
            addTarget(
              runtime,
              'lower-maze',
              `palier inferieur (${stories} etage${stories > 1 ? 's' : ''})`,
              ['lower', 'lower-maze', 'bas', 'sous-niveau', 'niveau-bas'],
              {
                x: center.x,
                y: feature.lowerFloorY - (stories - 1) * INFINITE_STORY_PITCH + 0.865,
                z: center.z,
              },
            );
          }
        } else if (feature.kind === 'epic-structure') {
          const definition = getEpicStructureDefinition(feature.index);
          addTarget(
            runtime,
            definition.command,
            definition.label,
            definition.aliases,
            feature.destination,
          );
        } else if (feature.kind === 'squeeze-view') {
          const center = rectCenter(feature.bounds);
          const crouchOnly = (feature.clearanceHeight ?? this.originPlan.wallHeight) < 1.6;
          const entrance = feature.axis === 'x'
            ? { x: feature.bounds.minX - 1.05, y: 0.865, z: center.z }
            : { x: center.x, y: 0.865, z: feature.bounds.minZ - 1.05 };
          addTarget(
            runtime,
            crouchOnly ? 'crawl-passage' : 'breach',
            crouchOnly
              ? `passage bas ${feature.layout ?? 'through'}`
              : 'breche monumentale et grand couloir',
            crouchOnly
              ? [
                  'crawl',
                  'crawl-passage',
                  'accroupi',
                  'faufiler',
                  'passage-bas',
                  'passage-etroit',
                ]
              : ['breche', 'breach', 'fissure', 'grand-couloir', 'trou-mural'],
            entrance,
          );
          addTarget(
            runtime,
            'hidden-hall',
            crouchOnly ? 'passage bas vers reseau cache' : 'breche vers hall cache',
            [
              'hidden-hall',
              'crawl-hall',
              'giant-room',
              'small-hole',
              'grosse-salle',
              'grande-salle',
              'salle-cachee',
              'petit-trou',
              'trou-e',
            ],
            entrance,
          );
        } else if (feature.kind === 'raised-zone') {
          const ramp = (feature.ramps ?? [feature.ramp])[0]!;
          const center = rectCenter(ramp.bounds);
          const baseAlong = ramp.riseDirection > 0
            ? ramp.axis === 'x' ? ramp.bounds.minX : ramp.bounds.minZ
            : ramp.axis === 'x' ? ramp.bounds.maxX : ramp.bounds.maxZ;
          const entrance = ramp.axis === 'x'
            ? { x: baseAlong, y: 0.865, z: center.z }
            : { x: center.x, y: 0.865, z: baseAlong };
          addTarget(
            runtime,
            feature.elevation < 0 ? 'sunken-zone' : 'raised-zone',
            feature.elevation < 0 ? 'rampe vers secteur encaisse' : 'rampe vers secteur sureleve',
            feature.elevation < 0
              ? ['sunken', 'sunken-zone', 'lower-zone', 'bas', 'pente-bas', 'rampe-bas']
              : ['raised', 'raised-zone', 'upper-zone', 'haut', 'pente', 'slope', 'rampe'],
            entrance,
          );
        } else if (feature.kind === 'stair-socket') {
          const center = rectCenter(feature.bounds);
          addTarget(
            runtime,
            'stairs',
            'escalier',
            ['stairs', 'stair', 'escalier', 'escaliers'],
            { x: center.x, y: 0.865, z: center.z },
          );
        } else if (feature.kind === 'impossible-vista') {
          addTarget(
            runtime,
            'vista',
            'hall impossible',
            [
              'vista',
              'grand-hall',
              'hall-geant',
              'petite-entree',
              'giant-room',
              'grosse-salle',
              'grande-salle',
              'small-hole',
              'petit-trou',
              'trou-e',
            ],
            feature.destination,
          );
        }
      }

      const epicRoomIds = new Set(
        runtime.plan.features
          .filter((feature) => feature.kind === 'epic-structure')
          .map((feature) => feature.roomId),
      );
      for (const room of runtime.plan.rooms) {
        if (room.access === 'sealed') continue;
        // Epic rooms have dedicated, stable commands. Their base plan was
        // intentionally replaced, so biome/generic labels would be false.
        if (epicRoomIds.has(room.id)) continue;
        const center = rectCenter(room.bounds);
        const safeFloor = runtime.plan.floorRects
          .map((floor): Rect | null => {
            const clipped: Rect = {
              minX: Math.max(floor.minX, room.bounds.minX),
              minZ: Math.max(floor.minZ, room.bounds.minZ),
              maxX: Math.min(floor.maxX, room.bounds.maxX),
              maxZ: Math.min(floor.maxZ, room.bounds.maxZ),
            };
            return rectWidth(clipped) > 0.8 && rectDepth(clipped) > 0.8 ? clipped : null;
          })
          .filter((floor): floor is Rect => floor !== null)
          .sort((left, right) => rectArea(right) - rectArea(left))[0];
        const safeCenter = safeFloor ? rectCenter(safeFloor) : center;
        const raisedZone = runtime.plan.features.find(
          (feature): feature is RaisedZoneFeature =>
            feature.kind === 'raised-zone' &&
            (feature.roomIds ?? [feature.roomId]).includes(room.id) &&
            (feature.platformRects ?? [feature.platformBounds]).some((platform) =>
              pointInRect(safeCenter.x, safeCenter.z, platform)
            ),
        );
        const safePosition = {
          x: safeCenter.x,
          y: 0.865 + (raisedZone?.elevation ?? 0),
          z: safeCenter.z,
        };
        const roomLights = runtime.plan.lights.filter(
          (light) => light.level >= 0 && light.roomId === room.id,
        );
        const missingLights = roomLights.filter((light) => light.dead);
        if (roomLights.length > 0 && missingLights.length === roomLights.length) {
          const fixture = missingLights[0]!;
          addTarget(
            runtime,
            'dark-room',
            'piece plongee dans le noir',
            ['dark', 'dark-room', 'blackout', 'noir', 'piece-noire', 'sans-lumiere'],
            { x: fixture.x, y: safePosition.y, z: fixture.z },
          );
        } else if (missingLights.length > 0) {
          const fixture = missingLights[0]!;
          addTarget(
            runtime,
            'missing-lights',
            'salle aux lampes manquantes',
            ['missing-light', 'missing-lights', 'lampes', 'panne', 'partial-blackout'],
            { x: fixture.x, y: safePosition.y, z: fixture.z },
          );
        }
        if (room.ceilingHeight > runtime.plan.wallHeight + 0.1) {
          addTarget(
            runtime,
            'high-ceiling',
            'atrium a plafond monumental',
            ['high-ceiling', 'grand-plafond', 'plafond-haut', 'atrium'],
            safePosition,
          );
        }
        if (
          room.kind === 'open-hall' &&
          getInfiniteChunkMetadata(runtime.plan)?.biome === 'symmetric-gallery'
        ) {
          addTarget(
            runtime,
            'symmetric-gallery',
            'longue galerie symetrique a sorties paralleles',
            ['symmetric', 'symetrie', 'galerie', 'sorties-paralleles', 'couloir-symetrique'],
            safePosition,
          );
        }
        if (room.kind === 'open-hall') {
          const hasColumns = runtime.plan.columns.some((column) =>
            column.x >= room.bounds.minX &&
            column.x <= room.bounds.maxX &&
            column.z >= room.bounds.minZ &&
            column.z <= room.bounds.maxZ,
          );
          addTarget(
            runtime,
            hasColumns ? 'pillar-hall' : 'open-hall',
            hasColumns ? 'hall a piliers' : 'grand hall vide',
            hasColumns
              ? ['pillar', 'pillars', 'piliers', 'hall-piliers', 'pillar-hall']
              : ['open-hall', 'grand-hall', 'grande-salle'],
            safePosition,
          );
        }
        if (room.kind === 'sparse') {
          addTarget(
            runtime,
            'empty-room',
            'piece vide',
            ['empty', 'empty-room', 'piece-vide', 'salle-vide', 'vide'],
            safePosition,
          );
        }
        if (room.kind === 'corridor' && Math.max(rectWidth(room.bounds), rectDepth(room.bounds)) > 12) {
          addTarget(
            runtime,
            'long-corridor',
            'long couloir',
            ['corridor', 'couloir', 'long-corridor', 'long-couloir'],
            safePosition,
          );
        }
      }
    }

    // Ordinary targets remain local to mounted chunks. Epics are resolved
    // analytically so /locate stays useful now that monuments are genuinely rare.
    for (const definition of EPIC_STRUCTURE_DEFINITIONS) {
      const coord = getNearestEpicStructureCoord(this.seed, definition.index, this.centerCoord);
      const key = createChunkKey(coord);
      const offset = getChunkWorldOffset(coord);
      const local = getEpicLocateDestination(this.seed, coord, definition.index);
      addWorldTarget(
        key,
        definition.command,
        definition.label,
        definition.aliases,
        {
          x: offset.x + local.x,
          y: offset.y + local.y,
          z: offset.z + local.z,
        },
      );
    }

    return [...bestByCommand.values()].sort(
      (a, b) => a.distance - b.distance || a.command.localeCompare(b.command),
    );
  }

  getDiagnostics(
    playerPosition: THREE.Vector3,
    viewOrigin: THREE.Vector3,
    lookDirection: THREE.Vector3,
  ): WorldStreamDiagnostics {
    const runtime = this.initialized && !this.disposed
      ? this.runtimeAt(playerPosition)
      : undefined;
    const metadata = runtime ? getInfiniteChunkMetadata(runtime.plan) : undefined;
    const featureKinds = runtime
      ? [...new Set(runtime.plan.features.map((feature) => feature.kind))]
      : [];
    const localPosition = runtime
      ? {
          x: playerPosition.x - runtime.offset.x,
          y: playerPosition.y - runtime.offset.y,
          z: playerPosition.z - runtime.offset.z,
        }
      : null;
    const world: WorldDiagnostics = {
      room: runtime && localPosition
        ? runtime.view.findRoomAt(localPosition.x, localPosition.y, localPosition.z)
        : 'threshold',
      chunkKey: runtime?.key ?? null,
      chunk: runtime ? { ...runtime.coord } : null,
      centerChunkKey: createChunkKey(this.centerCoord),
      localPosition,
      planSeed: runtime?.plan.seed ?? null,
      planVersion: runtime?.plan.version ?? null,
      biome: metadata?.biome ?? null,
      visualBiome: runtime?.plan.visualBiome ?? null,
      featureKinds,
      featureIds: runtime?.plan.features.map((feature) => feature.id) ?? [],
      darkness: this.getLightingContext(playerPosition).darkness,
    };
    return {
      world,
      target: this.getLookTarget(viewOrigin, lookDirection),
      streaming: this.getDebugCounts(),
    };
  }

  private getLookTarget(
    viewOrigin: THREE.Vector3,
    lookDirection: THREE.Vector3,
  ): LookTargetDiagnostics | null {
    if (!this.initialized || this.disposed || lookDirection.lengthSq() < 1e-8) return null;
    this.diagnosticsRaycaster.near = 0.04;
    this.diagnosticsRaycaster.far = 96;
    this.diagnosticsRaycaster.set(viewOrigin, lookDirection.clone().normalize());

    let nearest:
      | { runtime: ActiveChunk; hit: THREE.Intersection<THREE.Object3D> }
      | undefined;
    for (const runtime of this.chunks.values()) {
      const hit = this.diagnosticsRaycaster
        .intersectObject(runtime.view.group, true)
        .find((candidate) => WorldStream.isEffectivelyVisible(candidate.object));
      if (hit && (!nearest || hit.distance < nearest.hit.distance)) nearest = { runtime, hit };
    }
    if (!nearest) return null;

    const path: string[] = [];
    let node: THREE.Object3D | null = nearest.hit.object;
    while (node) {
      if (node.name) path.push(node.name);
      if (node === nearest.runtime.view.group) break;
      node = node.parent;
    }
    path.reverse();
    const object = nearest.hit.object.name || nearest.hit.object.type || 'Object3D';
    const mesh = nearest.hit.object instanceof THREE.Mesh ? nearest.hit.object : null;
    const materials = mesh
      ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
      : [];
    const material = materials.length > 0
      ? materials.map((entry) => entry.name || entry.type).join(', ')
      : null;
    return {
      chunkKey: nearest.runtime.key,
      object,
      path,
      material,
      instanceId: nearest.hit.instanceId ?? null,
      distance: nearest.hit.distance,
      point: {
        x: nearest.hit.point.x,
        y: nearest.hit.point.y,
        z: nearest.hit.point.z,
      },
    };
  }

  private static isEffectivelyVisible(object: THREE.Object3D): boolean {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (!current.visible) return false;
      current = current.parent;
    }
    return true;
  }

  getDebugCounts(): WorldStreamDebugCounts {
    let rooms = 0;
    let lights = 0;
    let colliders = 0;
    let props = 0;
    for (const runtime of this.chunks.values()) {
      rooms += runtime.plan.rooms.length;
      lights += runtime.plan.lights.length;
      colliders += runtime.plan.colliders.length;
      props += runtime.plan.propPlacements?.length ?? 0;
    }
    return {
      chunks: this.chunks.size,
      views: this.chunks.size,
      physicsChunks: this.chunks.size,
      rooms,
      lights,
      lightSources: this.sourceCount,
      colliders,
      props,
      pendingChunks: this.pendingChunks,
      preparedChunks: this.preparedChunks.size,
      verticalPrefetch: this.verticalPrefetchQueue.length,
      priorityVerticalPrefetch: this.priorityVerticalPrefetchKeys.size,
      workerMode: this.worker ? 'worker' : 'main-thread',
      workerInFlight: this.workerInFlight?.key ?? null,
      pendingStory: this.pendingStoryKey ?? null,
      recoveryChunk: this.recoveryChunkKey ?? this.recoveryChunk?.key ?? null,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker?.removeEventListener('message', this.onWorkerMessage);
    this.worker?.removeEventListener('error', this.onWorkerError);
    this.worker?.terminate();
    this.worker = undefined;
    this.workerInFlight = undefined;
    for (const [worker, reject] of this.preparationWorkers) {
      reject(new Error('WorldStream disposed during chunk preparation.'));
      worker.terminate();
    }
    this.preparationWorkers.clear();
    for (const [worker, reject] of this.lightingWorkers) {
      reject(new Error('WorldStream disposed during lighting transition.'));
      worker.terminate();
    }
    this.lightingWorkers.clear();
    this.preparedChunks.clear();
    this.verticalPrefetchQueue.length = 0;
    this.priorityVerticalPrefetchKeys.clear();
    this.pendingStoryKey = undefined;
    this.recoveryChunkKey = undefined;
    this.recoveryChunk = undefined;
    this.clearMountedChunks();
    this.sourceCount = 0;
    this.pendingChunks = 0;
  }

  async waitForVisualAssets(): Promise<void> {
    await Promise.all([...this.chunks.values()].map((runtime) => runtime.view.ready));
  }

  private async bakeLegacyLightMaps(plan: WorldPlan): Promise<BakedLightMapData> {
    if (typeof Worker === 'undefined') return bakeLightMapData(plan);
    let worker: Worker | undefined;
    try {
      worker = new Worker(
        new URL('../render/baked-lighting.worker.ts', import.meta.url),
        { type: 'module' },
      );
      const id = ++this.workerRequestId;
      return await new Promise<BakedLightMapData>((resolve, reject) => {
        this.lightingWorkers.set(worker!, reject);
        const cleanup = (): void => {
          worker!.removeEventListener('message', onMessage);
          worker!.removeEventListener('error', onError);
          this.lightingWorkers.delete(worker!);
        };
        const onMessage = (event: MessageEvent<LightingWorkerResponse>): void => {
          if (event.data.id !== id) return;
          cleanup();
          if (event.data.error || !event.data.lightMaps) {
            reject(new Error(event.data.error ?? 'Lighting worker returned no light maps.'));
          } else {
            resolve(event.data.lightMaps);
          }
        };
        const onError = (event: ErrorEvent): void => {
          cleanup();
          reject(event.error ?? new Error(event.message));
        };
        worker!.addEventListener('message', onMessage);
        worker!.addEventListener('error', onError);
        worker!.postMessage({ id, plan });
      });
    } catch (error) {
      if (this.disposed) throw error;
      // Workers can be blocked by restrictive embeds. Preserve the setting
      // with the deterministic main-thread baker as the compatibility path.
      return bakeLightMapData(plan);
    } finally {
      if (worker) {
        this.lightingWorkers.delete(worker);
        worker.terminate();
      }
    }
  }

  private async replaceChunkView(
    runtime: ActiveChunk,
    mode: LightingMode,
    lightMaps: BakedLightMapData | undefined,
    revision: number,
  ): Promise<void> {
    if (this.chunks.get(runtime.key) !== runtime) return;
    const view = new WorldView(
      runtime.plan,
      this.materials[runtime.plan.visualBiome ?? 'yellow'],
      { lightingMode: mode, bakedLightMaps: mode === 'legacy' ? lightMaps : undefined },
    );
    view.group.position.copy(runtime.offset);
    view.setWorldOffset(runtime.offset);
    await view.ready;
    if (
      this.disposed ||
      this.lightingRevision !== revision ||
      this.lightingMode !== mode ||
      this.chunks.get(runtime.key) !== runtime
    ) {
      view.dispose();
      return;
    }
    view.restoreDoorStates(runtime.view.getDoorStates());
    this.scene.add(view.group);
    runtime.view.dispose();
    runtime.view = view;
    runtime.lightingMode = mode;
    if (lightMaps) runtime.lightMaps = lightMaps;
  }

  private mountChunk(
    plan: WorldPlan,
    coordOverride?: Readonly<ChunkCoord>,
    suppliedLightMaps?: BakedLightMapData,
  ): void {
    let metadata = getInfiniteChunkMetadata(plan);
    if (!metadata && coordOverride) {
      metadata = attachInfiniteChunkMetadata(this.seed, plan, coordOverride);
    }
    const coord = coordOverride ?? metadata?.coord;
    if (!coord) throw new Error('Cannot mount an InfiniteWorld chunk without coordinates.');
    const key = createChunkKey(coord);
    if (this.chunks.has(key)) return;

    const worldOffset = getChunkWorldOffset(coord);
    const offset = new THREE.Vector3(worldOffset.x, worldOffset.y, worldOffset.z);
    const lightMaps = this.lightingMode === 'legacy'
      ? suppliedLightMaps ?? bakeLightMapData(plan)
      : suppliedLightMaps;
    const view = new WorldView(
      plan,
      this.materials[plan.visualBiome ?? 'yellow'],
      { lightingMode: this.lightingMode, bakedLightMaps: lightMaps },
    );
    view.group.position.copy(offset);
    view.setWorldOffset(offset);
    try {
      this.physics.addChunk(key, plan.colliders, offset);
      this.scene.add(view.group);
      this.chunks.set(key, {
        key,
        coord,
        plan,
        lightMaps,
        lightingMode: this.lightingMode,
        view,
        offset,
      });
    } catch (error) {
      view.dispose();
      throw error;
    }
  }

  private unmountChunk(key: ChunkKey): void {
    const runtime = this.chunks.get(key);
    if (!runtime) return;
    if (!this.disposed && key === this.recoveryChunkKey) {
      // Retain CPU data only. Keeping the complete source WorldView mounted
      // would overlap epic1's stacked previews with the real lower stories.
      this.recoveryChunk = {
        key,
        prepared: { plan: runtime.plan, lightMaps: runtime.lightMaps },
      };
    }
    this.physics.removeChunk(key);
    runtime.view.dispose();
    this.chunks.delete(key);
  }

  private clearMountedChunks(): void {
    this.physics.batchChunkChanges(() => {
      for (const key of [...this.chunks.keys()]) this.unmountChunk(key);
    });
    this.chunks.clear();
  }

  private refreshLightSources(): void {
    let count = 0;
    for (const runtime of this.chunks.values()) {
      count += runtime.plan.lights.filter((light) => !light.dead).length;
    }
    this.sourceCount = count;
  }

  private runtimeAt(position: THREE.Vector3): ActiveChunk | undefined {
    const epicOwner = this.epicRuntimeAt(position);
    if (epicOwner) return epicOwner;
    const observed = streamChunkCoordAt(position);
    const exact = this.chunks.get(createChunkKey(observed));
    if (exact) return exact;
    // During a deferred story hand-off the player is physically inside the
    // small preview owned by the previous story.
    return this.chunks.get(createChunkKey({ ...observed, story: this.centerCoord.story }));
  }

  private getEpicPinnedCoord(playerPosition: THREE.Vector3): Readonly<ChunkCoord> | undefined {
    return this.epicRuntimeAt(playerPosition)?.coord;
  }

  private epicRuntimeAt(playerPosition: THREE.Vector3): ActiveChunk | undefined {
    for (const runtime of this.chunks.values()) {
      this.localPlayer.copy(playerPosition).sub(runtime.offset);
      if (runtime.plan.features.some(
        (feature) =>
          feature.kind === 'epic-structure' &&
          isInsideEpicStoryVolume(feature, this.localPlayer),
      )) return runtime;
    }
    return undefined;
  }

  private desiredCoordsAroundCenter(): ChunkCoord[] {
    const coords = streamedCoordsAround(this.centerCoord);
    const center = this.chunks.get(createChunkKey(this.centerCoord));
    const ownsLongFissure = center?.plan.features.some(
      (feature) =>
        feature.kind === 'epic-structure' &&
        feature.variant === 'ascending-passages' &&
        rectWidth(feature.bounds) > INFINITE_CHUNK_SIZE,
    ) ?? false;
    // The source plan itself contains the whole longitudinal fissure. Loading
    // x-neighbours would put ordinary walls and colliders through it at ±56 m.
    return ownsLongFissure
      ? streamedCoordsAroundLongitudinalEpic(this.centerCoord)
      : coords;
  }

  private readonly onWorkerMessage = (event: MessageEvent<WorkerResponse>): void => {
    if (this.disposed || !this.workerInFlight || event.data.id !== this.workerInFlight.id) return;
    const request = this.workerInFlight;
    this.workerInFlight = undefined;
    if (event.data.error || !event.data.plan) {
      this.disableWorker();
      return;
    }
    const desired = new Set(this.desiredCoordsAroundCenter().map(createChunkKey));
    if (!desired.has(request.key)) {
      if (request.prefetch) {
        this.preparedChunks.set(request.key, {
          plan: event.data.plan,
          lightMaps: event.data.lightMaps,
        });
        if (this.preparedChunks.size > 12) {
          const oldest = this.preparedChunks.keys().next().value;
          if (oldest !== undefined) this.preparedChunks.delete(oldest);
        }
      }
      this.pumpVerticalPrefetch();
      return;
    }
    this.mountChunk(event.data.plan, request.coord, event.data.lightMaps);
    this.refreshLightSources();
    this.pendingChunks = Math.max(0, this.pendingChunks - 1);
    this.pumpVerticalPrefetch();
  };

  private readonly onWorkerError = (): void => {
    this.workerInFlight = undefined;
    this.disableWorker();
  };

  private disableWorker(): void {
    this.worker?.removeEventListener('message', this.onWorkerMessage);
    this.worker?.removeEventListener('error', this.onWorkerError);
    this.worker?.terminate();
    this.worker = undefined;
    this.verticalPrefetchQueue.length = 0;
    this.priorityVerticalPrefetchKeys.clear();
  }

  private async prepareInitialChunks(
    coords: readonly ChunkCoord[],
  ): Promise<Map<ChunkKey, PreparedChunk>> {
    const queue = [...coords];
    const prepared = new Map<ChunkKey, PreparedChunk>();
    const workerCount = Math.min(3, queue.length);
    const run = async (): Promise<void> => {
      const worker = new Worker(new URL('../world/infinite.worker.ts', import.meta.url), { type: 'module' });
      try {
        while (queue.length > 0) {
          const coord = queue.shift();
          if (!coord) return;
          const key = createChunkKey(coord);
          const id = ++this.workerRequestId;
          const response = await new Promise<WorkerResponse>((resolve, reject) => {
            const onMessage = (event: MessageEvent<WorkerResponse>): void => {
              if (event.data.id !== id) return;
              worker.removeEventListener('message', onMessage);
              worker.removeEventListener('error', onError);
              resolve(event.data);
            };
            const onError = (event: ErrorEvent): void => {
              worker.removeEventListener('message', onMessage);
              worker.removeEventListener('error', onError);
              reject(event.error ?? new Error(event.message));
            };
            worker.addEventListener('message', onMessage);
            worker.addEventListener('error', onError);
            worker.postMessage({ id, seed: this.seed, key, lightingMode: this.lightingMode });
          });
          if (response.error || !response.plan) {
            throw new Error(response.error ?? `Worker returned no plan for ${key}.`);
          }
          prepared.set(key, { plan: response.plan, lightMaps: response.lightMaps });
        }
      } finally {
        worker.terminate();
      }
    };
    await Promise.all(Array.from({ length: workerCount }, () => run()));
    return prepared;
  }

  private async prepareChunkWithWorker(key: ChunkKey): Promise<PreparedChunk> {
    const worker = new Worker(new URL('../world/infinite.worker.ts', import.meta.url), { type: 'module' });
    const id = ++this.workerRequestId;
    try {
      const response = await new Promise<WorkerResponse>((resolve, reject) => {
        this.preparationWorkers.set(worker, reject);
        const onMessage = (event: MessageEvent<WorkerResponse>): void => {
          if (event.data.id !== id) return;
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
          this.preparationWorkers.delete(worker);
          resolve(event.data);
        };
        const onError = (event: ErrorEvent): void => {
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
          this.preparationWorkers.delete(worker);
          reject(event.error ?? new Error(event.message));
        };
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        worker.postMessage({ id, seed: this.seed, key, lightingMode: this.lightingMode });
      });
      if (response.error || !response.plan) {
        throw new Error(response.error ?? `Worker returned no plan for ${key}.`);
      }
      return { plan: response.plan, lightMaps: response.lightMaps };
    } finally {
      this.preparationWorkers.delete(worker);
      worker.terminate();
    }
  }

  private enqueueVerticalPrefetch(coord: ChunkCoord, priority = false): void {
    const key = createChunkKey(coord);
    if (
      this.chunks.has(key) ||
      this.preparedChunks.has(key) ||
      this.workerInFlight?.key === key
    ) return;
    const queuedIndex = this.verticalPrefetchQueue.findIndex(
      (candidate) => createChunkKey(candidate) === key,
    );
    if (queuedIndex >= 0) {
      if (priority) {
        const [queued] = this.verticalPrefetchQueue.splice(queuedIndex, 1);
        this.priorityVerticalPrefetchKeys.add(key);
        this.verticalPrefetchQueue.unshift(queued!);
      }
      return;
    }
    if (priority) {
      this.priorityVerticalPrefetchKeys.add(key);
      this.verticalPrefetchQueue.unshift(coord);
    } else {
      this.verticalPrefetchQueue.push(coord);
    }
  }

  private pumpVerticalPrefetch(force = false): void {
    if (!this.worker || this.workerInFlight) return;
    const horizontalNeighborhoodIncomplete = this.desiredCoordsAroundCenter().some((coord) => {
      const key = createChunkKey(coord);
      return !this.chunks.has(key) && !this.preparedChunks.has(key);
    });
    // Fill the visible neighborhood first. A real story hand-off remains
    // urgent and is allowed to overtake horizontal background work.
    const priorityWaiting = this.verticalPrefetchQueue.some((coord) =>
      this.priorityVerticalPrefetchKeys.has(createChunkKey(coord))
    );
    if (!force && horizontalNeighborhoodIncomplete && !this.pendingStoryKey && !priorityWaiting) return;
    while (this.verticalPrefetchQueue.length > 0) {
      const coord = this.verticalPrefetchQueue.shift()!;
      const coordKey = createChunkKey(coord);
      this.priorityVerticalPrefetchKeys.delete(coordKey);
      // A queued abyss or stair chain belongs to the horizontal column the
      // player was exploring. After a horizontal teleport/move, discard the
      // stale tail so it cannot starve the new 3x3 neighborhood.
      if (coord.x !== this.centerCoord.x || coord.z !== this.centerCoord.z) continue;
      const key = coordKey;
      if (this.chunks.has(key) || this.preparedChunks.has(key)) continue;
      const id = ++this.workerRequestId;
      this.workerInFlight = { id, key, coord, prefetch: true };
      this.worker.postMessage({ id, seed: this.seed, key, lightingMode: this.lightingMode });
      return;
    }
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('WorldStream has already been disposed.');
  }
}
