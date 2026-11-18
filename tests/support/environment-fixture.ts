import type { WorldPlan, RoomRecord, StaticCollider } from '../../src/world/types';
import { rectCenter } from '../../src/world/types';
import type { EnvironmentEventKind, EnvironmentEventPlan } from '../../src/world/EnvironmentEvents';
import { ENVIRONMENT_EVENT_CONFIG, ENVIRONMENT_EVENT_DEFINITIONS } from '../../src/world/EnvironmentEvents';
import { SeededRandom } from '../../src/world/SeededRandom';
import { surfaceCollider } from '../../src/world/WalkableTopology';

/** A real closed room with a 2m doorway, slab and three working panels. */
export const environmentFixture = (kind: EnvironmentEventKind, floorY = 0): WorldPlan => {
  const bounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
  const room: RoomRecord = { id: 'room', bounds, kind: 'open-hall', level: 0, floorY, ceilingHeight: floorY + 3.05, detailDensity: 0, access: 'open' };
  const surface = { id: 'slab', roomId: room.id, ownerStory: 0, layer: 'floor', role: 'floor' as const, bounds,
    profile: { kind: 'flat' as const, y: floorY }, ceilingY: floorY + 3.05, thickness: .16, support: 'slab' as const, access: 'open' as const, edges: 'architecture' as const };
  const walls: WorldPlan['walls'] = [
    { id: 'north', x: 0, z: -10, length: 20, orientation: 'x' }, { id: 'east', x: 10, z: 0, length: 20, orientation: 'z' },
    { id: 'west', x: -10, z: 0, length: 20, orientation: 'z' }, { id: 'south-l', x: -5.5, z: 10, length: 9, orientation: 'x' },
    { id: 'south-r', x: 5.5, z: 10, length: 9, orientation: 'x' },
  ].map(w => ({ ...w, bottom: floorY, height: 3.05, thickness: .22, tint: 1, collision: true, kind: 'wallpaper' as const } as WorldPlan['walls'][number]));
  const colliders: StaticCollider[] = [surfaceCollider(surface), ...walls.map(w => ({ id: w.id, kind: 'wall' as const,
    center: { x: w.x, y: floorY + 1.525, z: w.z }, halfExtents: { x: (w.orientation === 'x' ? w.length : w.thickness) / 2, y: 1.525, z: (w.orientation === 'z' ? w.length : w.thickness) / 2 } }))];
  const plan: WorldPlan = { version: 21, seed: 'ENVIRONMENT-FIXTURE', size: 112, wallHeight: 3.05, rooms: [room], walls, columns: [], solidMasses: [],
    lights: [-6, 0, 6].map((z, i) => ({ id: `lamp-${i}`, x: 0, z, ceilingY: floorY + 3.05, rotation: 0, width: 1, intensity: 1, color: 0xffffff, dead: false, unstable: false, phase: 0, roomId: room.id, level: 0 })),
    missingCeilingTiles: [], features: [], detailSockets: [], propPlacements: [], colliders, floorRects: [bounds], floorOpenings: [],
    topology: { version: 2, ownerStory: 0, surfaces: [surface], connections: [], volumes: [], diagnostics: [] }, spawn: { x: 0, y: floorY + .865, z: 8 } };
  const event: EnvironmentEventPlan = { id: `event-${kind}`, kind, roomId: room.id, bounds, floorY, ceilingY: floorY + 3.05, seed: 'EVENT-FIXTURE', lightIds: plan.lights.map(l => l.id) };
  const definition = ENVIRONMENT_EVENT_DEFINITIONS[kind];
  if (!definition.eligible(room) || !definition.prepare(plan, event, room, new SeededRandom(event.seed), { ...ENVIRONMENT_EVENT_CONFIG, dripChance: 1 })) throw new Error(`Invalid ${kind} fixture at ${JSON.stringify(rectCenter(bounds))}`);
  plan.environmentEvents = [event];
  return plan;
};
