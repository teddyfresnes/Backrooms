import type {
  QuaternionData,
  Rect,
  StairSocketFeature,
  Vec3Data,
} from './types';
import { rectCenter, rectDepth, rectWidth } from './types';

export const STAIR_STORY_RISE = 5.4;
export const STAIR_STEPS_PER_FLIGHT = 15;
export const STAIR_TOTAL_STEPS = STAIR_STEPS_PER_FLIGHT * 2;

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

export interface StairCageWall {
  bounds: Rect;
  bottom: number;
  top: number;
  kind: 'outer' | 'divider';
}

const switchbackGap = (stairs: StairSocketFeature, crossSpan: number): number =>
  (stairs.switchbackJoin ?? 'joined') === 'divider'
    ? Math.min(0.22, crossSpan * 0.06)
    : 0;

/**
 * Produces either a compact U-shaped stair or one continuous flight. Both
 * variants use thirty 18 cm risers and reach the next 5.4 m storey exactly.
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
  const crossCenter = (crossMin + crossMax) * 0.5;
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

  if ((stairs.layout ?? 'switchback') === 'straight') {
    const stepRun = flightRun / STAIR_TOTAL_STEPS;
    const rise = STAIR_STORY_RISE / STAIR_TOTAL_STEPS;
    const flightWidth = crossSpan;
    for (let index = 0; index < STAIR_TOTAL_STEPS; index += 1) {
      const longCenter = startLong + direction * stepRun * (index + 0.5);
      slabs.push({
        bounds: rectFor(longCenter, stepRun, crossCenter, flightWidth),
        bottom: baseY,
        top: baseY + rise * (index + 1),
        kind: 'step',
      });
    }
    const topLandingCenter = positive
      ? longMax - landingDepth * 0.5
      : longMin + landingDepth * 0.5;
    slabs.push({
      bounds: rectFor(topLandingCenter, landingDepth, crossCenter, flightWidth),
      bottom: baseY,
      top: baseY + STAIR_STORY_RISE,
      kind: 'top-landing',
    });
    return slabs;
  }

  const stepRun = flightRun / STAIR_STEPS_PER_FLIGHT;
  const rise = STAIR_STORY_RISE / STAIR_TOTAL_STEPS;
  const gap = switchbackGap(stairs, crossSpan);
  const laneWidth = Math.max(1.12, (crossSpan - gap) * 0.5);
  const firstCross = crossCenter - (laneWidth + gap) * 0.5;
  const secondCross = crossCenter + (laneWidth + gap) * 0.5;
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

export const getStairCageWalls = (
  stairs: StairSocketFeature,
  lowerCeilingHeight: number,
): StairCageWall[] => {
  const alongX = stairs.heading.startsWith('x');
  const positive = stairs.heading.endsWith('+');
  const baseY = stairs.baseY ?? 0;
  const wallThickness = 0.16;
  const upperFloorY = baseY + STAIR_STORY_RISE;
  const lowerCeilingY = Math.min(
    upperFloorY,
    baseY + Math.max(0, lowerCeilingHeight),
  );
  const endWall = (
    positiveEnd: boolean,
    bottom: number,
    top: number,
  ): StairCageWall => ({
    bounds: alongX
      ? {
          minX: positiveEnd ? stairs.bounds.maxX : stairs.bounds.minX - wallThickness,
          maxX: positiveEnd ? stairs.bounds.maxX + wallThickness : stairs.bounds.minX,
          minZ: stairs.bounds.minZ - wallThickness,
          maxZ: stairs.bounds.maxZ + wallThickness,
        }
      : {
          minX: stairs.bounds.minX - wallThickness,
          maxX: stairs.bounds.maxX + wallThickness,
          minZ: positiveEnd ? stairs.bounds.maxZ : stairs.bounds.minZ - wallThickness,
          maxZ: positiveEnd ? stairs.bounds.maxZ + wallThickness : stairs.bounds.minZ,
        },
    bottom,
    top,
    kind: 'outer',
  });
  const walls: StairCageWall[] = alongX
    ? [
        {
          bounds: {
            minX: stairs.bounds.minX,
            maxX: stairs.bounds.maxX,
            minZ: stairs.bounds.minZ - wallThickness,
            maxZ: stairs.bounds.minZ,
          },
          bottom: baseY,
          top: baseY + STAIR_STORY_RISE,
          kind: 'outer',
        },
        {
          bounds: {
            minX: stairs.bounds.minX,
            maxX: stairs.bounds.maxX,
            minZ: stairs.bounds.maxZ,
            maxZ: stairs.bounds.maxZ + wallThickness,
          },
          bottom: baseY,
          top: baseY + STAIR_STORY_RISE,
          kind: 'outer',
        },
      ]
    : [
        {
          bounds: {
            minX: stairs.bounds.minX - wallThickness,
            maxX: stairs.bounds.minX,
            minZ: stairs.bounds.minZ,
            maxZ: stairs.bounds.maxZ,
          },
          bottom: baseY,
          top: baseY + STAIR_STORY_RISE,
          kind: 'outer',
        },
        {
          bounds: {
            minX: stairs.bounds.maxX,
            maxX: stairs.bounds.maxX + wallThickness,
            minZ: stairs.bounds.minZ,
            maxZ: stairs.bounds.maxZ,
          },
          bottom: baseY,
          top: baseY + STAIR_STORY_RISE,
          kind: 'outer',
        },
      ];

  if ((stairs.layout ?? 'switchback') === 'switchback') {
    walls.push(endWall(positive, baseY, upperFloorY));

    if ((stairs.switchbackJoin ?? 'joined') === 'divider') {
      const longMin = alongX ? stairs.bounds.minX : stairs.bounds.minZ;
      const longMax = alongX ? stairs.bounds.maxX : stairs.bounds.maxZ;
      const longSpan = longMax - longMin;
      const crossMin = alongX ? stairs.bounds.minZ : stairs.bounds.minX;
      const crossMax = alongX ? stairs.bounds.maxZ : stairs.bounds.maxX;
      const crossCenter = (crossMin + crossMax) * 0.5;
      const landingDepth = Math.min(1.05, Math.max(0.72, longSpan * 0.13));
      const gap = switchbackGap(stairs, crossMax - crossMin);
      walls.push({
        bounds: alongX
          ? {
              minX: longMin + landingDepth,
              maxX: longMax - landingDepth,
              minZ: crossCenter - gap * 0.5,
              maxZ: crossCenter + gap * 0.5,
            }
          : {
              minX: crossCenter - gap * 0.5,
              maxX: crossCenter + gap * 0.5,
              minZ: longMin + landingDepth,
              maxZ: longMax - landingDepth,
            },
        bottom: baseY,
        top: baseY + STAIR_STORY_RISE,
        kind: 'divider',
      });
    }
  }
  if (lowerCeilingY < upperFloorY - 1e-4) {
    // Entry/exit openings only belong to the rooms on either floor. Close the
    // otherwise exposed plenum between the lower drop ceiling and upper slab,
    // while keeping the walkable doorway volumes themselves unobstructed.
    walls.push(endWall(!positive, lowerCeilingY, upperFloorY));
    if ((stairs.layout ?? 'switchback') === 'straight') {
      walls.push(endWall(positive, lowerCeilingY, upperFloorY));
    }
  }
  return walls;
};

/**
 * Uses shallow invisible ramps for locomotion while the renderer keeps the
 * thirty visible treads. This avoids capsule snagging on riser edges.
 */
export const getStairCollisionShapes = (
  stairs: StairSocketFeature,
): StairCollisionShape[] => {
  const slabs = getStairSlabs(stairs);
  const alongX = stairs.heading.startsWith('x');
  const positive = stairs.heading.endsWith('+');
  const baseY = stairs.baseY ?? 0;
  const halfThickness = 0.06;
  const treadOffset = 0.09;
  const flightShape = (
    flight: readonly StairSlab[],
    bottomY: number,
    riseDirection: 1 | -1,
    rise: number,
  ): StairCollisionShape => {
    const bounds: Rect = {
      minX: Math.min(...flight.map((slab) => slab.bounds.minX)),
      maxX: Math.max(...flight.map((slab) => slab.bounds.maxX)),
      minZ: Math.min(...flight.map((slab) => slab.bounds.minZ)),
      maxZ: Math.max(...flight.map((slab) => slab.bounds.maxZ)),
    };
    const run = alongX ? rectWidth(bounds) : rectDepth(bounds);
    const cross = alongX ? rectDepth(bounds) : rectWidth(bounds);
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
  const topLanding = slabs.at(-1)!;
  if ((stairs.layout ?? 'switchback') === 'straight') {
    return [
      flightShape(
        slabs.slice(0, STAIR_TOTAL_STEPS),
        baseY,
        firstRiseDirection,
        STAIR_STORY_RISE,
      ),
      landingShape(topLanding, 'top-landing'),
    ];
  }

  const firstFlight = slabs.slice(0, STAIR_STEPS_PER_FLIGHT);
  const midLanding = slabs[STAIR_STEPS_PER_FLIGHT]!;
  const secondFlight = slabs.slice(
    STAIR_STEPS_PER_FLIGHT + 1,
    STAIR_TOTAL_STEPS + 1,
  );
  return [
    flightShape(firstFlight, baseY, firstRiseDirection, STAIR_STORY_RISE * 0.5),
    landingShape(midLanding, 'mid-landing'),
    flightShape(
      secondFlight,
      baseY + STAIR_STORY_RISE * 0.5,
      -firstRiseDirection as 1 | -1,
      STAIR_STORY_RISE * 0.5,
    ),
    landingShape(topLanding, 'top-landing'),
  ];
};

export const getStairFloorOpening = (stairs: StairSocketFeature): Rect => ({
  ...stairs.bounds,
});

export const getStairLandingClearance = (stairs: StairSocketFeature): Rect => {
  const alongX = stairs.heading.startsWith('x');
  const positive = stairs.heading.endsWith('+');
  const center = rectCenter(stairs.bounds);
  const extension = 2.2;
  if ((stairs.layout ?? 'switchback') === 'straight') {
    return alongX
      ? {
          minX: stairs.bounds.minX - extension,
          maxX: stairs.bounds.maxX + extension,
          minZ: stairs.bounds.minZ - 0.45,
          maxZ: stairs.bounds.maxZ + 0.45,
        }
      : {
          minX: stairs.bounds.minX - 0.45,
          maxX: stairs.bounds.maxX + 0.45,
          minZ: stairs.bounds.minZ - extension,
          maxZ: stairs.bounds.maxZ + extension,
        };
  }
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
