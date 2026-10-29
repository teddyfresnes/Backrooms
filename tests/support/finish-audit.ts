import * as THREE from 'three';
import { RectIndex } from '../../src/world/RectIndex';
import { pointInRect, type WorldPlan, type Rect } from '../../src/world/types';
import { surfaceY } from '../../src/world/WalkableTopology';

/** Independent audit of the transferred render buffers. Samples every interval
 * delimited by floors, rooms and neighbouring solids, then at most 2 m apart.
 * Expected policy comes from architectural rooms, not generated trim runs. */
export const auditFinishCoverage = (world: WorldPlan, batches: { material: string; geometry: THREE.BufferGeometry }[]) => {
  const errors: { reason: string; id: string; point: number[] }[] = [];
  let equipped = 0, bare = 0, supportedMetres = 0, missingMetres = 0, floating = 0;
  if (!world.spatial || !world.topology) return { errors, equipped, bare, supportedMetres, missingMetres, floating };
  const material = new THREE.MeshBasicMaterial();
  const meshes = batches.map(b => { const m = new THREE.Mesh(b.geometry, material); m.updateMatrixWorld(); return m; });
  const walls = meshes.filter((_, i) => ['wall', 'plaster'].includes(batches[i]!.material));
  const trims = meshes.filter((_, i) => batches[i]!.material === 'baseboard');
  const floors = world.topology.surfaces, floorIndex = new RectIndex(floors, s => s.bounds);
  const roomIndex = new RectIndex(world.rooms, r => r.bounds), roomMap = new Map(world.rooms.map(r => [r.id, r]));
  const boundsOf = (w: WorldPlan['walls'][number]): Rect => ({
    minX: w.x - (w.orientation === 'x' ? w.length : w.thickness) / 2, maxX: w.x + (w.orientation === 'x' ? w.length : w.thickness) / 2,
    minZ: w.z - (w.orientation === 'z' ? w.length : w.thickness) / 2, maxZ: w.z + (w.orientation === 'z' ? w.length : w.thickness) / 2,
  });
  const solidIndex = new RectIndex(world.walls, boundsOf);
  const ray = new THREE.Raycaster();
  try {
    for (const w of world.walls) for (const axis of ['x', 'z']) for (const sign of [-1, 1]) {
      const b = boundsOf(w), alongX = axis === 'x';
      const fixed = alongX ? sign < 0 ? b.minZ : b.maxZ : sign < 0 ? b.minX : b.maxX;
      if (Math.abs(fixed - sign * world.size / 2) < 1e-6) continue;
      const min = alongX ? b.minX : b.minZ, max = alongX ? b.maxX : b.maxZ;
      const band = alongX ? { minX: min, maxX: max, minZ: fixed - .031, maxZ: fixed + .031 }
        : { minZ: min, maxZ: max, minX: fixed - .031, maxX: fixed + .031 };
      const nearby = floorIndex.query(band), rooms = roomIndex.query(band);
      const bounds = [...nearby.map(s => s.bounds), ...rooms.map(r => r.bounds), ...solidIndex.query(band).map(boundsOf)];
      const events = [...new Set([min, max, ...bounds.flatMap(b => alongX ? [b.minX, b.maxX] : [b.minZ, b.maxZ])])]
        .filter(n => n >= min && n <= max).sort((a, b) => a - b);
      for (let i = 1; i < events.length; i++) {
        const lo = events[i - 1]!, hi = events[i]!, count = Math.max(1, Math.ceil((hi - lo) / 2));
        if (hi - lo <= 1e-6) continue;
        for (let j = 0; j < count; j++) {
          const at = lo + (hi - lo) * (j + .5) / count;
          const x = alongX ? at : fixed + sign * .015, z = alongX ? fixed + sign * .015 : at;
          const outerX = alongX ? at : fixed + sign * .029, outerZ = alongX ? fixed + sign * .029 : at;
          const levels = new Set<number>();
          for (const floor of nearby) {
            if (floor.role === 'stair' || !pointInRect(x, z, floor.bounds)) continue;
            const y = surfaceY(floor, x, z);
            if (y < w.bottom - 1e-6 || y + .14 > w.bottom + w.height + 1e-6 || levels.has(Math.round(y * 1e6))) continue;
            if (!nearby.some(s => pointInRect(outerX, outerZ, s.bounds) && Math.abs(surfaceY(s, outerX, outerZ) - surfaceY(floor, outerX, outerZ)) < 1e-6)) continue;
            const origin = new THREE.Vector3(alongX ? at : fixed + sign * .24, y + .06, alongX ? fixed + sign * .24 : at);
            ray.set(origin, new THREE.Vector3(alongX ? 0 : -sign, 0, alongX ? -sign : 0)); ray.near = 0; ray.far = .241;
            const hit = ray.intersectObjects(walls)[0];
            if (!hit || Math.abs((alongX ? hit.point.z : hit.point.x) - fixed) > .0001) continue;
            levels.add(Math.round(y * 1e6));
            const source = floor.roomId ? roomMap.get(floor.roomId) : undefined;
            const localRooms = rooms.filter(r => pointInRect(x, z, r.bounds));
            const datum = floor.profile.kind === 'flat' && localRooms.some(r => Math.abs((r.floorY ?? 0) - y) < .05) ? y : source?.floorY ?? y;
            const room = localRooms.filter(r => Math.abs((r.floorY ?? 0) - datum) < .05).sort((a, b) =>
              (a.bounds.maxX - a.bounds.minX) * (a.bounds.maxZ - a.bounds.minZ) - (b.bounds.maxX - b.bounds.minX) * (b.bounds.maxZ - b.bounds.minZ) || a.id.localeCompare(b.id))[0] ?? source;
            const enabled = room?.baseboards !== false && !(world.baseboardlessZones ?? []).some(b =>
              (b.floorY === undefined || Math.abs(b.floorY - (room?.floorY ?? datum)) < .05) && pointInRect(x, z, b));
            const trim = ray.intersectObjects(trims).some(h => h.distance >= .2 && h.distance <= .2401);
            // At an inside corner the horizontal ray can begin inside the
            // perpendicular strip; its top must still cover the contact band.
            ray.set(new THREE.Vector3(x, y + .25, z), new THREE.Vector3(0, -1, 0)); ray.near = .1; ray.far = .2;
            const covered = trim || ray.intersectObjects(trims).length > 0;
            if (enabled) { equipped++; supportedMetres += (hi - lo) / count; }
            else bare++;
            if (covered !== enabled) {
              if (enabled) missingMetres += (hi - lo) / count;
              errors.push({ reason: enabled ? 'missing equipped contour' : 'trim in bare room', id: w.id, point: [x, y, z] });
            }
          }
        }
      }
    }
    for (const p of world.spatial.prisms.filter(p => p.material === 'baseboard')) {
      const center = [0, 1, 2].map(axis => [4, 5, 6, 7].reduce((sum, i) => sum + p.vertices[i * 3 + axis]!, 0) / 4);
      const [x, y, z] = center as [number, number, number];
      if (!floorIndex.query({ minX: x - 1e-6, maxX: x + 1e-6, minZ: z - 1e-6, maxZ: z + 1e-6 }).some(s => pointInRect(x, z, s.bounds, -1e-6) && Math.abs(surfaceY(s, x, z) - y) < .00001)) {
        floating++; errors.push({ reason: 'unsupported trim over void', id: p.id, point: center });
      }
    }
  } finally { material.dispose(); }
  return { errors, equipped, bare, supportedMetres, missingMetres, floating };
};
