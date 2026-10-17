import type { Vec3Data } from '../world/types';

/** Fixed world-space aperture, independent of the animated blind or view ray. */
export interface RainOpening {
  readonly min: Readonly<Vec3Data>;
  readonly max: Readonly<Vec3Data>;
}

export function rainOpeningAt(center: Readonly<Vec3Data>, width: number, height: number): RainOpening {
  return {
    min: { x: center.x - width * .5, y: center.y - height * .5, z: center.z },
    max: { x: center.x + width * .5, y: center.y + height * .5, z: center.z },
  };
}

export function rainOpeningFromBlind(bounds: RainOpening, closedScaleY: number): RainOpening {
  return {
    min: { x: bounds.min.x, y: bounds.max.y - (bounds.max.y - bounds.min.y) * closedScaleY, z: bounds.min.z },
    max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
  };
}

export function distanceToRainOpening(position: Readonly<Vec3Data>, opening: RainOpening): number {
  const dx = Math.max(opening.min.x - position.x, 0, position.x - opening.max.x);
  const dy = Math.max(opening.min.y - position.y, 0, position.y - opening.max.y);
  const dz = Math.max(opening.min.z - position.z, 0, position.z - opening.max.z);
  return Math.hypot(dx, dy, dz);
}
