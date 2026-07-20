import * as THREE from 'three';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import type { MaterialSet } from '../render/MaterialLibrary';
import { bakeLightMapData } from '../render/BakedLighting';
import type { BakedLightMapData } from '../render/BakedLighting';
import { WorldView } from '../render/WorldBuilder';
import type { WorldInteraction } from '../render/WorldBuilder';
import {
  INFINITE_CHUNK_SIZE,
  INFINITE_STORY_PITCH,
  attachInfiniteChunkMetadata,
  createChunkKey,
  generateInfiniteChunk,
  getChunkWorldOffset,
  getInfiniteChunkMetadata,
} from '../world/InfiniteWorld';
import type {
  ChunkCoord,
  ChunkKey,
} from '../world/InfiniteWorld';
import type { Rect, RoomKind, Vec3Data, WorldPlan } from '../world/types';
import { rectArea, rectCenter, rectDepth, rectWidth } from '../world/types';

const ACTIVE_RADIUS = 1;
const HALF_CHUNK_SIZE = INFINITE_CHUNK_SIZE * 0.5;
interface ActiveChunk {
  key: ChunkKey;
  coord: Readonly<ChunkCoord>;
  plan: WorldPlan;
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

interface PreparedChunk {
  plan: WorldPlan;
  lightMaps?: BakedLightMapData;
}

export interface WorldStreamDebugCounts {
  chunks: number;
  views: number;
  physicsChunks: number;
  rooms: number;
  lights: number;
  lightSources: number;
  colliders: number;
  pendingChunks: number;
}

export interface LocateTarget {
  command: string;
  label: string;
  aliases: readonly string[];
  position: Vec3Data;
  distance: number;
  chunkKey: ChunkKey;
}

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

export const shouldDeferStoryTransition = (
  current: ChunkCoord,
  observed: ChunkCoord,
  destinationReady: boolean,
  workerAvailable: boolean,
): boolean =>
  workerAvailable && observed.story !== current.story && !destinationReady;

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
  private pendingStoryKey?: ChunkKey;
  private initialized = false;
  private disposed = false;

  constructor(
    private readonly seed: string,
    private readonly originPlan: WorldPlan,
    private readonly scene: THREE.Scene,
    private readonly materials: MaterialSet,
    private readonly physics: PhysicsWorld,
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
    // Let the temporary workers run while the origin lightmap is baked. The
    // loading screen remains opaque, but startup no longer serializes nine
    // one-second light transports on the main thread.
    const originLightMaps = bakeLightMapData(this.originPlan);
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
    let nextCenter = observedCenter;
    const observedKey = createChunkKey(observedCenter);
    if (shouldDeferStoryTransition(
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
    const desiredCoords = streamedCoordsAround(this.centerCoord);
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
    // is stable. Near a known deep void, queue its complete vertical chain in
    // advance so consecutive midpoints never wait behind horizontal jobs.
    const localStoryY = playerPosition.y - this.centerCoord.story * INFINITE_STORY_PITCH;
    if (this.worker && missing.length === 0 && localStoryY < 1.1) {
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
        if (feature.kind !== 'grid-pit') continue;
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
        this.worker.postMessage({ id, seed: this.seed, key });
      }
    }

    if (sourcesChanged) this.refreshLightSources();

    for (const runtime of this.chunks.values()) {
      this.localPlayer.copy(playerPosition).sub(runtime.offset);
      runtime.view.update(time, this.localPlayer, delta);
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
    return {
      ...interaction,
      path: interaction.path.map((point) => ({
        x: point.x + runtime.offset.x,
        y: point.y + runtime.offset.y,
        z: point.z + runtime.offset.z,
      })),
    };
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

  getLocateTargets(playerPosition: THREE.Vector3): LocateTarget[] {
    if (!this.initialized || this.disposed) return [];
    const bestByCommand = new Map<string, LocateTarget>();
    const addTarget = (
      runtime: ActiveChunk,
      command: string,
      label: string,
      aliases: readonly string[],
      localPosition: Vec3Data,
    ): void => {
      const position = worldPoint(localPosition, runtime.offset);
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
        chunkKey: runtime.key,
      });
    };

    for (const runtime of this.chunks.values()) {
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
            addTarget(
              runtime,
              command,
              hole.kind === 'void' ? 'trou profond mortel' : 'trou simple',
              hole.kind === 'void'
                ? ['void', 'abyss', 'abysse', 'deep-hole', 'trou-profond']
                : ['hole', 'holes', 'trou', 'trous', 'pit'],
              approachPointForRect(hole, feature.bounds, 0.865),
            );
          }
          const drop = feature.holes.find((hole) => hole.kind !== 'void');
          if (drop) {
            const center = rectCenter(drop);
            addTarget(
              runtime,
              'lower-maze',
              'sous-niveau infini',
              ['lower', 'lower-maze', 'bas', 'sous-niveau', 'niveau-bas'],
              { x: center.x, y: feature.lowerFloorY + 0.865, z: center.z },
            );
          }
        } else if (feature.kind === 'squeeze-view') {
          const center = rectCenter(feature.bounds);
          const narrow = feature.apertureWidth < 0.8;
          addTarget(
            runtime,
            narrow ? 'squeeze' : 'breach',
            narrow ? 'trou mural ou se faufiler' : 'breche monumentale et grand couloir',
            narrow
              ? ['squeeze', 'crawl', 'faufiler', 'trou-mur', 'passage-etroit', 'petite-breche']
              : ['breche', 'breach', 'fissure', 'grand-couloir', 'trou-mural'],
            feature.axis === 'x'
              ? { x: feature.bounds.minX - 1.05, y: 0.865, z: center.z }
              : { x: center.x, y: 0.865, z: feature.bounds.minZ - 1.05 },
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
            ['vista', 'grand-hall', 'hall-geant', 'petite-entree'],
            feature.destination,
          );
        }
      }

      for (const room of runtime.plan.rooms) {
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
        const safePosition = { x: safeCenter.x, y: 0.865, z: safeCenter.z };
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
            { x: fixture.x, y: 0.865, z: fixture.z },
          );
        } else if (missingLights.length > 0) {
          const fixture = missingLights[0]!;
          addTarget(
            runtime,
            'missing-lights',
            'salle aux lampes manquantes',
            ['missing-light', 'missing-lights', 'lampes', 'panne', 'partial-blackout'],
            { x: fixture.x, y: 0.865, z: fixture.z },
          );
        }
        if (room.ceilingHeight > runtime.plan.wallHeight + 0.1) {
          addTarget(
            runtime,
            'high-ceiling',
            'atrium a plafond monumental',
            ['high-ceiling', 'grand-plafond', 'plafond-haut', 'atrium', 'vertical-atrium'],
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

    return [...bestByCommand.values()].sort(
      (a, b) => a.distance - b.distance || a.command.localeCompare(b.command),
    );
  }

  getDebugCounts(): WorldStreamDebugCounts {
    let rooms = 0;
    let lights = 0;
    let colliders = 0;
    for (const runtime of this.chunks.values()) {
      rooms += runtime.plan.rooms.length;
      lights += runtime.plan.lights.length;
      colliders += runtime.plan.colliders.length;
    }
    return {
      chunks: this.chunks.size,
      views: this.chunks.size,
      physicsChunks: this.chunks.size,
      rooms,
      lights,
      lightSources: this.sourceCount,
      colliders,
      pendingChunks: this.pendingChunks,
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
    this.preparedChunks.clear();
    this.verticalPrefetchQueue.length = 0;
    this.pendingStoryKey = undefined;
    this.clearMountedChunks();
    this.sourceCount = 0;
    this.pendingChunks = 0;
  }

  private mountChunk(
    plan: WorldPlan,
    coordOverride?: Readonly<ChunkCoord>,
    bakedLightMaps?: BakedLightMapData,
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
    const view = new WorldView(plan, this.materials, {
      createLightRig: false,
      bakedLightMaps,
    });
    view.group.position.copy(offset);
    try {
      this.physics.addChunk(key, plan.colliders, offset);
      this.scene.add(view.group);
      this.chunks.set(key, {
        key,
        coord,
        plan,
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
    const observed = streamChunkCoordAt(position);
    const exact = this.chunks.get(createChunkKey(observed));
    if (exact) return exact;
    // During a deferred story hand-off the player is physically inside the
    // small preview owned by the previous story.
    return this.chunks.get(createChunkKey({ ...observed, story: this.centerCoord.story }));
  }

  private readonly onWorkerMessage = (event: MessageEvent<WorkerResponse>): void => {
    if (this.disposed || !this.workerInFlight || event.data.id !== this.workerInFlight.id) return;
    const request = this.workerInFlight;
    this.workerInFlight = undefined;
    if (event.data.error || !event.data.plan) {
      this.disableWorker();
      return;
    }
    const desired = new Set(streamedCoordsAround(this.centerCoord).map(createChunkKey));
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
            worker.postMessage({ id, seed: this.seed, key });
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

  private enqueueVerticalPrefetch(coord: ChunkCoord, priority = false): void {
    const key = createChunkKey(coord);
    if (
      this.chunks.has(key) ||
      this.preparedChunks.has(key) ||
      this.workerInFlight?.key === key ||
      this.verticalPrefetchQueue.some((candidate) => createChunkKey(candidate) === key)
    ) return;
    if (priority) this.verticalPrefetchQueue.unshift(coord);
    else this.verticalPrefetchQueue.push(coord);
  }

  private pumpVerticalPrefetch(): void {
    if (!this.worker || this.workerInFlight) return;
    while (this.verticalPrefetchQueue.length > 0) {
      const coord = this.verticalPrefetchQueue.shift()!;
      const key = createChunkKey(coord);
      if (this.chunks.has(key) || this.preparedChunks.has(key)) continue;
      const id = ++this.workerRequestId;
      this.workerInFlight = { id, key, coord, prefetch: true };
      this.worker.postMessage({ id, seed: this.seed, key });
      return;
    }
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('WorldStream has already been disposed.');
  }
}
