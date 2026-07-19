import type { Rect, RoomRecord, StairSocketFeature, WorldFeature } from './types';
import { rectArea, rectCenter, rectDepth, rectWidth } from './types';
import { SeededRandom } from './SeededRandom';

export interface FeatureContext {
  rooms: RoomRecord[];
  seed: string;
  worldBounds: Rect;
  reservedRoomIds: Set<string>;
}

export interface FeatureDefinition<T extends WorldFeature = WorldFeature> {
  id: string;
  weight: number;
  minimumRoomSize: { width: number; depth: number };
  propose(context: FeatureContext, rng: SeededRandom): T | null;
}

export class FeatureRegistry {
  private readonly definitions = new Map<string, FeatureDefinition>();

  register<T extends WorldFeature>(definition: FeatureDefinition<T>): this {
    this.definitions.set(definition.id, definition as FeatureDefinition);
    return this;
  }

  get(id: string): FeatureDefinition | undefined {
    return this.definitions.get(id);
  }

  list(): FeatureDefinition[] {
    return [...this.definitions.values()];
  }
}

export const createDefaultFeatureRegistry = (): FeatureRegistry => {
  const registry = new FeatureRegistry();

  registry.register({
    id: 'stair-socket',
    weight: 0.35,
    minimumRoomSize: { width: 12, depth: 12 },
    propose(context, rng): StairSocketFeature | null {
      const candidates = context.rooms.filter(
        (room) =>
          !context.reservedRoomIds.has(room.id) &&
          room.kind !== 'corridor' &&
          room.kind !== 'open-hall' &&
          room.kind !== 'pit-gallery' &&
          rectWidth(room.bounds) >= 12 &&
          rectDepth(room.bounds) >= 12,
      );
      if (candidates.length === 0) return null;
      const room = rng.pick(candidates);
      const center = rectCenter(room.bounds);
      const width = Math.min(8, rectWidth(room.bounds) - 4);
      const depth = Math.min(5, rectDepth(room.bounds) - 4);
      return {
        kind: 'stair-socket',
        id: `stair-socket-${room.id}`,
        roomId: room.id,
        bounds: {
          minX: center.x - width * 0.5,
          maxX: center.x + width * 0.5,
          minZ: center.z - depth * 0.5,
          maxZ: center.z + depth * 0.5,
        },
        heading: rng.pick(['x+', 'x-', 'z+', 'z-'] as const),
      };
    },
  });

  // Planned modules use the same contract: shallow pits, deep voids, giant atria,
  // detail rooms and stairs can be registered without touching the BSP generator.
  void rectArea;
  return registry;
};
