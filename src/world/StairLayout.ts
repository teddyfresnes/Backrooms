import type {
  QuaternionData,
  Rect,
  StairSocketFeature,
  Vec3Data,
} from './types';
import { rectCenter, rectDepth, rectWidth } from './types';

export const STAIR_STORY_RISE = 5.4;
export const STAIR_STEPS_PER_FLIGHT = 15;

export interface StairSlab {
  bounds: Rect;
  bottom: number;
  top: number;
  kind: 'step' | 'mid-landing' | 'top-landing';
}

export interface StairCollisionShape {
  center: Vec3Data;
  halfExtents: Vec3Data;
  rotation?: QuaternionData;
  kind: 'flight-ramp' | 'mid-landing' | 'top-landing';
}

/**
 * Produces a compact U-shaped stair: two parallel flights of fifteen 18 cm
 * risers, a half-storey landing, then an upper landing exactly 5.4 m higher.
 */
export const getStairSlabs = (stairs: StairSocketFeature): StairSlab[] => {
  const alongX = stairs.heading.startsWith('x');
  const positive = stairs.heading.endsWith('+');
  const longMin = alongX ? stairs.bounds.minX : stairs.bounds.minZ;
  const longMax = alongX ? stairs.bounds.maxX : stairs.bounds.maxZ;
  const crossMin = alongX ? stairs.bounds.minZ : stairs.bounds.minX;
  const crossMax = alongX ? stairs.bounds.maxZ : stairs.bounds.maxX;
  const longSpan = longMax - longMin;
  const crossSpan = crossMax - crossMin;
  const landingDepth = Math.min(1.05, Math.max(0.72, longSpan * 0.13));
  const flightRun = Math.max(2.8, longSpan - landingDepth * 2);
  const stepRun = flightRun / STAIR_STEPS_PER_FLIGHT;
  const rise = STAIR_STORY_RISE / (STAIR_STEPS_PER_FLIGHT * 2);
  const gap = Math.min(0.28, crossSpan * 0.08);
  const laneWidth = Math.max(1.12, (crossSpan - gap) * 0.5);
  const crossCenter = (crossMin + crossMax) * 0.5;
  const firstCross = crossCenter - (laneWidth + gap) * 0.5;
  const secondCross = crossCenter + (laneWidth + gap) * 0.5;
  const baseY = stairs.baseY ?? 0;
  const startLong = positive ? longMin + landingDepth : longMax - landingDepth;
  const direction = positive ? 1 : -1;
  const slabs: StairSlab[] = [];
  const rectFor = (longCenter: number, length: number, cross: number, width: number): Rect =>
    alongX
      ? {
          minX: longCenter - length * 0.5,
          maxX: longCenter + length * 0.5,
          minZ: cross - width * 0.5,
          maxZ: cross + width * 0.5,
        }
      : {
          minX: cross - width * 0.5,
          maxX: cross + width * 0.5,
          minZ: longCenter - length * 0.5,
          maxZ: longCenter + length * 0.5,
        };

  for (let index = 0; index < STAIR_STEPS_PER_FLIGHT; index += 1) {
    const longCenter = startLong + direction * stepRun * (index + 0.5);
    slabs.push({
      bounds: rectFor(longCenter, stepRun, firstCross, laneWidth),
      bottom: baseY,
      top: baseY + rise * (index + 1),
      kind: 'step',
    });
  }

  const farLandingCenter = positive ? longMax - landingDepth * 0.5 : longMin + landingDepth * 0.5;
  slabs.push({
    bounds: rectFor(farLandingCenter, landingDepth, crossCenter, crossSpan),
    bottom: baseY,
    top: baseY + STAIR_STORY_RISE * 0.5,
    kind: 'mid-landing',
  });

  const secondStart = positive ? longMax - landingDepth : longMin + landingDepth;
  for (let index = 0; index < STAIR_STEPS_PER_FLIGHT; index += 1) {
    const longCenter = secondStart - direction * stepRun * (index + 0.5);
    slabs.push({
      bounds: rectFor(longCenter, stepRun, secondCross, laneWidth),
      bottom: baseY,
      top: baseY + STAIR_STORY_RISE * 0.5 + rise * (index + 1),
      kind: 'step',
    });
  }

  const topLandingCenter = positive ? longMin + landingDepth * 0.5 : longMax - landingDepth * 0.5;
  slabs.push({
    bounds: rectFor(topLandingCenter, landingDepth, secondCross, laneWidth),
    bottom: baseY,
    top: baseY + STAIR_STORY_RISE,
    kind: 'top-landing',
  });
  return slabs;
};

/**
 * Uses two shallow invisible ramps for locomotion while the renderer keeps the
 * thirty visible treads. This avoids capsule snagging on a riser edge at the
 * flight/landing joins.
 */
export const getStairCollisionShapes = (
  stairs: StairSocketFeature,
): StairCollisionShape[] => {
  const slabs = getStairSlabs(stairs);
  const firstFlight = slabs.slice(0, STAIR_STEPS_PER_FLIGHT);
  const midLanding = slabs[STAIR_STEPS_PER_FLIGHT]!;
  const secondFlight = slabs.slice(
    STAIR_STEPS_PER_FLIGHT + 1,
    STAIR_STEPS_PER_FLIGHT * 2 + 1,
  );
  const topLanding = slabs.at(-1)!;
  const alongX = stairs.heading.startsWith('x');
  const positive = stairs.heading.endsWith('+');
  const baseY = stairs.baseY ?? 0;
  const halfThickness = 0.06;
  const treadOffset = 0.09;
  const flightShape = (
    flight: readonly StairSlab[],
    bottomY: number,
    riseDirection: 1 | -1,
  ): StairCollisionShape => {
    const bounds: Rect = {
      minX: Math.min(...flight.map((slab) => slab.bounds.minX)),
      maxX: Math.max(...flight.map((slab) => slab.bounds.maxX)),
      minZ: Math.min(...flight.map((slab) => slab.bounds.minZ)),
      maxZ: Math.max(...flight.map((slab) => slab.bounds.maxZ)),
    };
    const run = alongX ? rectWidth(bounds) : rectDepth(bounds);
    const cross = alongX ? rectDepth(bounds) : rectWidth(bounds);
    const rise = STAIR_STORY_RISE * 0.5;
    const signedAngle = Math.atan2(rise, run) * riseDirection;
    const center = rectCenter(bounds);
    return {
      center: {
        x: center.x,
        y: bottomY + rise * 0.5 + treadOffset - Math.cos(signedAngle) * halfThickness,
        z: center.z,
      },
      halfExtents: alongX
        ? { x: Math.hypot(run, rise) * 0.5, y: halfThickness, z: cross * 0.5 }
        : { x: cross * 0.5, y: halfThickness, z: Math.hypot(run, rise) * 0.5 },
      rotation: alongX
        ? {
            x: 0,
            y: 0,
            z: Math.sin(signedAngle * 0.5),
            w: Math.cos(signedAngle * 0.5),
          }
        : {
            x: Math.sin(-signedAngle * 0.5),
            y: 0,
            z: 0,
            w: Math.cos(signedAngle * 0.5),
          },
      kind: 'flight-ramp',
    };
  };
  const landingShape = (
    slab: StairSlab,
    kind: 'mid-landing' | 'top-landing',
  ): StairCollisionShape => ({
    center: {
      x: rectCenter(slab.bounds).x,
      y: slab.top - treadOffset,
      z: rectCenter(slab.bounds).z,
    },
    halfExtents: {
      x: rectWidth(slab.bounds) * 0.5,
      y: treadOffset,
      z: rectDepth(slab.bounds) * 0.5,
    },
    kind,
  });
  const firstRiseDirection = (positive ? 1 : -1) as 1 | -1;
  return [
    flightShape(firstFlight, baseY, firstRiseDirection),
    landingShape(midLanding, 'mid-landing'),
    flightShape(secondFlight, baseY + STAIR_STORY_RISE * 0.5, -firstRiseDirection as 1 | -1),
    landingShape(topLanding, 'top-landing'),
  ];
};

export const getStairFloorOpening = (stairs: StairSocketFeature): Rect => ({
  minX: stairs.bounds.minX + 0.08,
  minZ: stairs.bounds.minZ + 0.08,
  maxX: stairs.bounds.maxX - 0.08,
  maxZ: stairs.bounds.maxZ - 0.08,
});

export const getStairLandingClearance = (stairs: StairSocketFeature): Rect => {
  const alongX = stairs.heading.startsWith('x');
  const positive = stairs.heading.endsWith('+');
  const center = rectCenter(stairs.bounds);
  const extension = 2.2;
  if (alongX) {
    return {
      minX: stairs.bounds.minX - (positive ? extension : 0.45),
      maxX: stairs.bounds.maxX + (positive ? 0.45 : extension),
      minZ: center.z - rectDepth(stairs.bounds) * 0.5 - 0.45,
      maxZ: center.z + rectDepth(stairs.bounds) * 0.5 + 0.45,
    };
  }
  return {
    minX: center.x - rectWidth(stairs.bounds) * 0.5 - 0.45,
    maxX: center.x + rectWidth(stairs.bounds) * 0.5 + 0.45,
    minZ: stairs.bounds.minZ - (positive ? extension : 0.45),
    maxZ: stairs.bounds.maxZ + (positive ? 0.45 : extension),
  };
};
