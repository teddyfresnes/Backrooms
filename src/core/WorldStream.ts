import * as THREE from 'three';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import type { MaterialSet } from '../render/MaterialLibrary';
import { WorldView } from '../render/WorldBuilder';
import type { WorldInteraction } from '../render/WorldBuilder';
import {
  INFINITE_CHUNK_SIZE,
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
  error?: string;
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

const chunkCoordAt = (position: THREE.Vector3): ChunkCoord => ({
  x: Math.floor((position.x + HALF_CHUNK_SIZE) / INFINITE_CHUNK_SIZE),
  z: Math.floor((position.z + HALF_CHUNK_SIZE) / INFINITE_CHUNK_SIZE),
  story: 0,
});

const desiredCoordsAround = (center: ChunkCoord): ChunkCoord[] => {
  const coords: ChunkCoord[] = [];
  for (let deltaZ = -ACTIVE_RADIUS; deltaZ <= ACTIVE_RADIUS; deltaZ += 1) {
    for (let deltaX = -ACTIVE_RADIUS; deltaX <= ACTIVE_RADIUS; deltaX += 1) {
      coords.push({ x: center.x + deltaX, z: center.z + deltaZ, story: 0 });
    }
  }
  return coords.sort((left, right) => {
    const leftDistance = Math.abs(left.x - center.x) + Math.abs(left.z - center.z);
    const rightDistance = Math.abs(right.x - center.x) + Math.abs(right.z - center.z);
    return leftDistance - rightDistance || left.z - right.z || left.x - right.x;
  });
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

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
  private workerInFlight?: { id: number; key: ChunkKey; coord: Readonly<ChunkCoord> };
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

  initialize(): void {
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

    this.physics.removeChunk('origin');
    try {
      for (const coord of desiredCoordsAround(originMetadata.coord)) {
        const key = createChunkKey(coord);
        const plan = key === originMetadata.key
          ? this.originPlan
          : generateInfiniteChunk(this.seed, key);
        this.mountChunk(plan, coord);
      }
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

    this.centerCoord = chunkCoordAt(playerPosition);
    const desiredCoords = desiredCoordsAround(this.centerCoord);
    const desiredKeys = new Set(desiredCoords.map(createChunkKey));
    let sourcesChanged = false;

    for (const key of [...this.chunks.keys()]) {
      if (desiredKeys.has(key)) continue;
      this.unmountChunk(key);
      sourcesChanged = true;
    }

    const missing = desiredCoords.filter((coord) => !this.chunks.has(createChunkKey(coord)));
    this.pendingChunks = missing.length;
    const next = missing.find((coord) => createChunkKey(coord) !== this.workerInFlight?.key);
    if (next && !this.workerInFlight) {
      const key = createChunkKey(next);
      if (this.worker) {
        const id = ++this.workerRequestId;
        this.workerInFlight = { id, key, coord: next };
        this.worker.postMessage({ id, seed: this.seed, key });
      } else {
        this.mountChunk(generateInfiniteChunk(this.seed, key), next);
        this.pendingChunks = Math.max(0, this.pendingChunks - 1);
        sourcesChanged = true;
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
        y: point.y,
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
      y,
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
          const drop = feature.holes.find((hole) => hole.kind !== 'void') ?? feature.holes[0];
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
          addTarget(
            runtime,
            'breach',
            'breche trop etroite',
            ['breche', 'breach', 'fissure', 'slit', 'petite-breche', 'petit-passage'],
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
            { x: center.x, y: 0.865, z: center.z },
          );
        }
        if (room.kind === 'sparse') {
          addTarget(
            runtime,
            'empty-room',
            'piece vide',
            ['empty', 'empty-room', 'piece-vide', 'salle-vide', 'vide'],
            { x: center.x, y: 0.865, z: center.z },
          );
        }
        if (room.kind === 'corridor' && Math.max(rectWidth(room.bounds), rectDepth(room.bounds)) > 12) {
          addTarget(
            runtime,
            'long-corridor',
            'long couloir',
            ['corridor', 'couloir', 'long-corridor', 'long-couloir'],
            { x: center.x, y: 0.865, z: center.z },
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
    this.clearMountedChunks();
    this.sourceCount = 0;
    this.pendingChunks = 0;
  }

  private mountChunk(plan: WorldPlan, coordOverride?: Readonly<ChunkCoord>): void {
    const metadata = getInfiniteChunkMetadata(plan);
    const coord = coordOverride ?? metadata?.coord;
    if (!coord) throw new Error('Cannot mount an InfiniteWorld chunk without coordinates.');
    const key = createChunkKey(coord);
    if (coord.story !== 0) {
      throw new Error(`WorldStream only mounts story 0 plans for now; received ${key}.`);
    }
    if (this.chunks.has(key)) return;

    const worldOffset = getChunkWorldOffset(coord);
    const offset = new THREE.Vector3(worldOffset.x, 0, worldOffset.z);
    const view = new WorldView(plan, this.materials, { createLightRig: false });
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
    for (const key of [...this.chunks.keys()]) this.unmountChunk(key);
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
    return this.chunks.get(createChunkKey(chunkCoordAt(position)));
  }

  private readonly onWorkerMessage = (event: MessageEvent<WorkerResponse>): void => {
    if (this.disposed || !this.workerInFlight || event.data.id !== this.workerInFlight.id) return;
    const request = this.workerInFlight;
    this.workerInFlight = undefined;
    if (event.data.error || !event.data.plan) {
      this.disableWorker();
      return;
    }
    const desired = new Set(desiredCoordsAround(this.centerCoord).map(createChunkKey));
    if (!desired.has(request.key)) return;
    this.mountChunk(event.data.plan, request.coord);
    this.refreshLightSources();
    this.pendingChunks = Math.max(0, this.pendingChunks - 1);
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
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('WorldStream has already been disposed.');
  }
}
