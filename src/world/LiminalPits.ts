import { SeededRandom } from './SeededRandom';
import type { LiminalPitFeature, PitHole, Rect } from './types';
import { rectCenter, rectDepth, rectWidth } from './types';

/** Independent fallback vocabulary. The historical grid generator is untouched. */
export const proposeLiminalPit = (seed: string, id: string, reservation: Rect, floorY: number): LiminalPitFeature => {
  const rng = new SeededRandom(`${seed}:liminal-pit-shape:v1`), p = rectCenter(reservation);
  const family = rng.pick(['offset-well', 'fault', 'paired-wells', 'sunken-court'] as const);
  const alongX = rng.chance(.5), width = rectWidth(reservation), depth = rectDepth(reservation);
  const holes: PitHole[] = [];
  const add = (b: Rect) => holes.push({ ...b, depth: 5.4, kind: 'drop', stories: 1 });
  if (family === 'sunken-court') {
    const walkway = rng.float(2.6, 4), edge = .25;
    add({ minX: reservation.minX + (alongX ? walkway : edge), maxX: reservation.maxX - edge,
      minZ: reservation.minZ + (alongX ? edge : walkway), maxZ: reservation.maxZ - edge });
  } else if (family === 'fault') {
    const length = (alongX ? width : depth) - rng.float(3.8, 5.2), narrow = rng.float(2, 3.8), shift = rng.float(-2, 2);
    add(alongX ? { minX: p.x - length / 2, maxX: p.x + length / 2, minZ: p.z + shift - narrow / 2, maxZ: p.z + shift + narrow / 2 }
      : { minZ: p.z - length / 2, maxZ: p.z + length / 2, minX: p.x + shift - narrow / 2, maxX: p.x + shift + narrow / 2 });
  } else if (family === 'paired-wells') {
    const size = rng.float(2.8, 4.2), gap = rng.float(2.2, 3.2);
    for (const sign of [-1, 1]) {
      const x = p.x + (alongX ? sign * (size + gap) / 2 : 0), z = p.z + (alongX ? 0 : sign * (size + gap) / 2);
      add({ minX: x - size / 2, maxX: x + size / 2, minZ: z - size / 2, maxZ: z + size / 2 });
    }
  } else {
    const sizeX = rng.float(3.5, 6.4), sizeZ = rng.float(3.5, 6.4), x = p.x + rng.float(-2.5, 2.5), z = p.z + rng.float(-2.5, 2.5);
    add({ minX: x - sizeX / 2, maxX: x + sizeX / 2, minZ: z - sizeZ / 2, maxZ: z + sizeZ / 2 });
  }
  return { kind: 'liminal-pit', id, roomId: `${id}/room`, bounds: reservation, family, holes, depth: 5.4,
    lowerBounds: { ...reservation }, lowerFloorY: floorY - 5.4, lowerCeilingY: floorY - 2.66 };
};
