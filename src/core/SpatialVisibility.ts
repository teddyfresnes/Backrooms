import { ADDRESS_PITCH, SPATIAL_CHUNK_SIZE } from '../world/RegionalPlan';
import type { SpatialAddress } from '../world/SpatialTypes';
import type { Vec3Data, WorldPlan } from '../world/types';

export const selectSpatialVisibleOwners = (sources: readonly { coord: SpatialAddress; plan: WorldPlan }[], position: Vec3Data,
  options: { direction?: Vec3Data; mounted?: ReadonlySet<string>; base?: ReadonlySet<string>; limit?: number } = {}): SpatialAddress[] => {
  const targets = new Map<string, { coord: SpatialAddress; priority: number; score: number }>();
  const direction = options.direction, norm = direction ? Math.hypot(direction.x, direction.y, direction.z) : 0;
  for (const { coord, plan } of sources) for (const d of plan.spatial?.dependencies ?? []) {
    const key = `${d.owner.x}:${d.owner.z}:${d.owner.story}`; if (options.base?.has(key)) continue;
    const ox = coord.x * SPATIAL_CHUNK_SIZE, oz = coord.z * SPATIAL_CHUNK_SIZE, oy = coord.story * ADDRESS_PITCH;
    const x = Math.max(d.bounds.minX + ox, Math.min(d.bounds.maxX + ox, position.x));
    const z = Math.max(d.bounds.minZ + oz, Math.min(d.bounds.maxZ + oz, position.z));
    const y = Math.max(d.bottom + oy, Math.min(d.top + oy, position.y));
    const horizontal = Math.hypot(x - position.x, z - position.z), vertical = Math.abs(y - position.y);
    if (horizontal > (d.reason === 'view' ? 72 : 36) || vertical > 20) continue;
    const dx = x - position.x, dz = z - position.z, dy = y - position.y, distance = Math.hypot(dx, dy, dz);
    const dot = norm > .001 && distance > .01 ? (dx * direction!.x + dy * direction!.y + dz * direction!.z) / (norm * distance) : 1;
    const retained = options.mounted?.has(key) ?? false;
    const physical = d.reason !== 'view' && horizontal <= 6;
    if (!physical && dot < -.35 && !retained) continue;
    const priority = physical ? 0 : 1;
    const score = horizontal + vertical * .3 + (1 - dot) * 28 - (retained ? 4 : 0);
    const previous = targets.get(key);
    if (!previous || priority < previous.priority || priority === previous.priority && score < previous.score)
      targets.set(key, { coord: { ...d.owner }, priority, score });
  }
  return [...targets.values()].sort((a, b) => a.priority - b.priority || a.score - b.score || a.coord.story - b.coord.story
    || a.coord.x - b.coord.x || a.coord.z - b.coord.z).slice(0, options.limit ?? 12).map(t => t.coord);
};
