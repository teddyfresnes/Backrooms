import type { ChunkEdge, EdgeGate, InfiniteEdgeGates } from './InfiniteWorld';
import type { Rect, WorldPlan } from './types';
import { overlapRect, type WalkableSurface } from './WalkableTopology';
import { clipVerticalArchitecture } from './VerticalPlanner';

export const getVerticalGateApproach = (size: number, edge: ChunkEdge, gate: EdgeGate): Rect => {
  const half = size / 2, lo = gate.offset - gate.width / 2, hi = gate.offset + gate.width / 2;
  return edge === 'north' ? { minX: lo, maxX: hi, minZ: -half, maxZ: -half + 8.4 }
    : edge === 'south' ? { minX: lo, maxX: hi, minZ: half - 8.4, maxZ: half }
    : edge === 'west' ? { minZ: lo, maxZ: hi, minX: -half, maxX: -half + 8.4 }
    : { minZ: lo, maxZ: hi, minX: half - 8.4, maxX: half };
};
export const applyVerticalBoundaries = (world: WorldPlan, gates: InfiniteEdgeGates): void => {
  const topology = world.topology; if (!topology) return;
  const half = world.size / 2;
  const cuts: Rect[] = [];
  for (const edge of ['north', 'south', 'west', 'east'] as const) for (const [i, gate] of gates[edge].entries()) {
    const approach = getVerticalGateApproach(world.size, edge, gate), y = gate.floorY ?? 0;
    cuts.push(approach);
    const axis = edge === 'north' || edge === 'south' ? 'z' : 'x', reverse = edge === 'south' || edge === 'east';
    const coordinate = (distance: number) => reverse ? half - distance : -half + distance;
    const rect = (a: number, b: number): Rect => axis === 'x' ? { ...approach, minX: Math.min(coordinate(a), coordinate(b)), maxX: Math.max(coordinate(a), coordinate(b)) }
      : { ...approach, minZ: Math.min(coordinate(a), coordinate(b)), maxZ: Math.max(coordinate(a), coordinate(b)) };
    const base: Omit<WalkableSurface, 'id' | 'bounds' | 'profile' | 'role'> = { ownerStory: topology.ownerStory, layer: 'ground', ceilingY: Math.max(y, 0) + 2.65,
      thickness: gate.slabThickness ?? .16, support: 'solid', supportBottom: Math.min(y, 0) - .16, access: 'open', edges: 'architecture' };
    topology.surfaces.push({ ...base, id: `vertical/seam-${edge}-${i}/landing`, role: 'landing', bounds: rect(0, 1.2), profile: { kind: 'flat', y } },
      { ...base, id: `vertical/seam-${edge}-${i}/ramp`, role: 'ramp', bounds: rect(1.2, 7.2), profile: { kind: 'linear', axis, startY: reverse ? 0 : y, endY: reverse ? y : 0 } },
      { ...base, id: `vertical/seam-${edge}-${i}/arrival`, role: 'landing', bounds: rect(7.2, 8.4), profile: { kind: 'flat', y: 0 } });
    for (const r of world.rooms.filter(r => r.level === 0 && overlapRect(r.bounds, approach))) r.ceilingHeight = Math.max(r.ceilingHeight, base.ceilingY);
  }
  for (const w of world.walls.filter(w => w.detail === 'biome-boundary-skin' || w.detail === 'biome-boundary-band')) {
    for (const s of topology.surfaces.filter(s => s.id.startsWith('vertical/seam-'))) {
      const b = s.bounds, halfX = (w.orientation === 'x' ? w.length : w.thickness) / 2, halfZ = (w.orientation === 'z' ? w.length : w.thickness) / 2;
      if (!overlapRect(b, { minX: w.x - halfX, maxX: w.x + halfX, minZ: w.z - halfZ, maxZ: w.z + halfZ }, .03)) continue;
      const low = s.profile.kind === 'flat' ? s.profile.y : Math.min(s.profile.startY, s.profile.endY), bottom = Math.min(w.bottom, low);
      w.height += w.bottom - bottom; w.bottom = bottom;
    }
  }
  clipVerticalArchitecture(world, cuts, w => !w.id.startsWith('inherited-') && !w.id.startsWith('regional-enclosure/') && w.detail !== 'biome-boundary-skin' && w.detail !== 'biome-boundary-band');
};
