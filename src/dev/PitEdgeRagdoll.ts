import type { MovementLabPitSpec, PitStairDirection } from './MovementLabPlan';

// Keep the detector close to the actual lip. The previous 48 cm halo made a
// normal controlled line beside a pit feel unsafe too early.
export const PIT_EDGE_RISK_RADIUS = 0.40;
// Losing balance now requires sustained evidence of clumsy motion instead of a
// brief brush with the edge.
export const PIT_EDGE_RAGDOLL_THRESHOLD = 0.82;
export const PIT_EDGE_RISK_DECAY_PER_SECOND = 2.6;
export const PIT_MIN_RAGDOLL_DROP = 1.6;

export type PitEdgeSide = 'north' | 'south' | 'west' | 'east';

export interface PitEdgeSample {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly velocityZ: number;
  readonly grounded: boolean;
  readonly falling: boolean;
  readonly fallDistance: number;
  readonly viewX: number;
  readonly viewZ: number;
  readonly viewPitchDegrees: number;
  readonly manualLean: number;
  readonly crouching: boolean;
  readonly lowPosture: boolean;
  /** Camera-relative movement axes before animation remapping. */
  readonly inputForward?: number;
  readonly inputRight?: number;
  /** Time left from an explicit jump/slide-jump. */
  readonly jumpGraceSeconds?: number;
  /** Short stateful grace after a clearly controlled pit approach. */
  readonly controlGraceSeconds?: number;
}

export interface PitEdgeAnalysis {
  readonly pit: MovementLabPitSpec;
  readonly inside: boolean;
  readonly distance: number;
  readonly side: PitEdgeSide;
  readonly inwardX: number;
  readonly inwardZ: number;
  readonly riskRate: number;
  readonly immediate: boolean;
  readonly safeStairEntry: boolean;
  readonly leanExposure: number;
  /** True while the player is demonstrably handling the edge on purpose. */
  readonly controlledApproach: boolean;
  /** Fresh deliberate control, excluding grace inherited from earlier frames. */
  readonly refreshControlGrace: boolean;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const stairEntrySide = (direction: PitStairDirection): PitEdgeSide => {
  if (direction === 'z+') return 'south';
  if (direction === 'z-') return 'north';
  if (direction === 'x+') return 'east';
  return 'west';
};

const stairCrossHalfWidth = (pit: MovementLabPitSpec): number => {
  const width = pit.maxX - pit.minX;
  const depth = pit.maxZ - pit.minZ;
  const alongX = pit.stairs.startsWith('x');
  const crossLength = alongX ? depth : width;
  const stairWidth = Math.min(2.25, Math.max(1.55, crossLength - 1.25));
  return stairWidth * 0.5 + 0.18;
};

const sideNormal = (side: PitEdgeSide): readonly [number, number] => {
  switch (side) {
    case 'north': return [0, 1];
    case 'south': return [0, -1];
    case 'west': return [1, 0];
    case 'east': return [-1, 0];
  }
};

const pointInsidePit = (x: number, z: number, pit: MovementLabPitSpec, inset = 0): boolean => (
  x > pit.minX + inset
  && x < pit.maxX - inset
  && z > pit.minZ + inset
  && z < pit.maxZ - inset
);

const nearestSideInside = (x: number, z: number, pit: MovementLabPitSpec): PitEdgeSide => {
  const distances: Array<[PitEdgeSide, number]> = [
    ['west', x - pit.minX],
    ['east', pit.maxX - x],
    ['north', z - pit.minZ],
    ['south', pit.maxZ - z],
  ];
  distances.sort((a, b) => a[1] - b[1]);
  return distances[0]![0];
};

const nearestOutside = (
  x: number,
  z: number,
  pit: MovementLabPitSpec,
): { distance: number; side: PitEdgeSide; inwardX: number; inwardZ: number } => {
  const clampedX = Math.min(pit.maxX, Math.max(pit.minX, x));
  const clampedZ = Math.min(pit.maxZ, Math.max(pit.minZ, z));
  const dx = clampedX - x;
  const dz = clampedZ - z;
  const distance = Math.hypot(dx, dz);

  let side: PitEdgeSide;
  if (x < pit.minX && z >= pit.minZ && z <= pit.maxZ) side = 'west';
  else if (x > pit.maxX && z >= pit.minZ && z <= pit.maxZ) side = 'east';
  else if (z < pit.minZ && x >= pit.minX && x <= pit.maxX) side = 'north';
  else if (z > pit.maxZ && x >= pit.minX && x <= pit.maxX) side = 'south';
  else if (Math.abs(dx) >= Math.abs(dz)) side = dx >= 0 ? 'west' : 'east';
  else side = dz >= 0 ? 'north' : 'south';

  if (distance > 1e-6) return { distance, side, inwardX: dx / distance, inwardZ: dz / distance };
  const [inwardX, inwardZ] = sideNormal(side);
  return { distance: 0, side, inwardX, inwardZ };
};

const isSafeStairEntry = (
  sample: PitEdgeSample,
  pit: MovementLabPitSpec,
  side: PitEdgeSide,
): boolean => {
  if (!sample.grounded || sample.falling || side !== stairEntrySide(pit.stairs)) return false;
  const centerX = (pit.minX + pit.maxX) * 0.5;
  const centerZ = (pit.minZ + pit.maxZ) * 0.5;
  const halfWidth = stairCrossHalfWidth(pit);
  return pit.stairs.startsWith('x')
    ? Math.abs(sample.z - centerZ) <= halfWidth
    : Math.abs(sample.x - centerX) <= halfWidth;
};


const stairSurfaceTopAt = (sample: PitEdgeSample, pit: MovementLabPitSpec): number | null => {
  if (!pointInsidePit(sample.x, sample.z, pit, -0.04)) return null;
  const width = pit.maxX - pit.minX;
  const depth = pit.maxZ - pit.minZ;
  const alongX = pit.stairs.startsWith('x');
  const positive = pit.stairs.endsWith('+');
  const centerX = (pit.minX + pit.maxX) * 0.5;
  const centerZ = (pit.minZ + pit.maxZ) * 0.5;
  const cross = alongX ? Math.abs(sample.z - centerZ) : Math.abs(sample.x - centerX);
  if (cross > stairCrossHalfWidth(pit) + 0.14) return null;
  const along = alongX ? sample.x : sample.z;
  const min = alongX ? pit.minX : pit.minZ;
  const max = alongX ? pit.maxX : pit.maxZ;
  const run = Math.max(0.1, (max - min) - 0.72);
  const distanceFromLowEnd = positive ? along - min : max - along;
  const progress = clamp01((distanceFromLowEnd - 0.24) / run);
  return pit.bottom + Math.abs(pit.bottom) * progress;
};

const isProtectedPitStairLane = (sample: PitEdgeSample, pit: MovementLabPitSpec): boolean => {
  const stairTop = stairSurfaceTopAt(sample, pit);
  if (stairTop === null) return false;
  // Debug position is the capsule centre. A normal jump onto/along the staircase
  // must remain protected while its feet are still close to the authored steps.
  const capsuleFootOffset = sample.crouching || sample.lowPosture ? 0.565 : 0.865;
  const feetY = sample.y - capsuleFootOffset;
  const heightAboveSteps = feetY - stairTop;
  const explicitJump = (sample.jumpGraceSeconds ?? 0) > 0;
  const controlledAir = sample.fallDistance < 1.15 && heightAboveSteps > -0.30 && heightAboveSteps < 1.35;
  return sample.grounded || explicitJump || controlledAir;
};

const leanExposure = (sample: PitEdgeSample, pit: MovementLabPitSpec): number => {
  // Looking down is awareness, not instability. Only a real manual body lean
  // that carries the upper body over the void contributes to balance loss.
  const viewLength = Math.hypot(sample.viewX, sample.viewZ);
  if (viewLength < 1e-6) return 0;
  const forwardX = sample.viewX / viewLength;
  const forwardZ = sample.viewZ / viewLength;
  const rightX = -forwardZ;
  const rightZ = forwardX;
  const leanAmount = Math.abs(sample.manualLean);
  if (leanAmount <= 0.42) return 0;
  const leanReach = 0.08 + leanAmount * 0.16;
  const leanSign = Math.sign(sample.manualLean);
  if (!pointInsidePit(
    sample.x + rightX * leanReach * leanSign,
    sample.z + rightZ * leanReach * leanSign,
    pit,
    0.015,
  )) return 0;
  return clamp01((leanAmount - 0.42) / 0.58);
};

const movementControl = (
  sample: PitEdgeSample,
  inwardX: number,
  inwardZ: number,
  horizontalSpeed: number,
  towardSpeed: number,
  tangentSpeed: number,
  distance: number,
  exposed: number,
): {
  deliberateControl: boolean;
  controlledApproach: boolean;
  clumsyFactor: number;
} => {
  const viewLength = Math.hypot(sample.viewX, sample.viewZ);
  const forwardX = viewLength > 1e-6 ? sample.viewX / viewLength : 0;
  const forwardZ = viewLength > 1e-6 ? sample.viewZ / viewLength : -1;
  const rightX = -forwardZ;
  const rightZ = forwardX;

  const inputForward = sample.inputForward ?? 0;
  const inputRight = sample.inputRight ?? 0;
  const inputLength = Math.hypot(inputForward, inputRight);
  let intentX = 0;
  let intentZ = 0;
  if (inputLength > 1e-5) {
    intentX = (forwardX * inputForward + rightX * inputRight) / inputLength;
    intentZ = (forwardZ * inputForward + rightZ * inputRight) / inputLength;
  }

  let velocityX = 0;
  let velocityZ = 0;
  if (horizontalSpeed > 1e-5) {
    velocityX = sample.velocityX / horizontalSpeed;
    velocityZ = sample.velocityZ / horizontalSpeed;
  }

  const velocityIntentAlignment = inputLength > 0.12 && horizontalSpeed > 0.22
    ? velocityX * intentX + velocityZ * intentZ
    : 1;
  const viewVelocityAlignment = horizontalSpeed > 0.22
    ? velocityX * forwardX + velocityZ * forwardZ
    : 1;
  const viewTowardPit = forwardX * inwardX + forwardZ * inwardZ;
  const intentTowardPit = inputLength > 0.12 ? intentX * inwardX + intentZ * inwardZ : 0;
  const lookingDown = clamp01((-sample.viewPitchDegrees - 10) / 30);
  const stableIntent = inputLength >= 0.28 && velocityIntentAlignment >= 0.68;

  // A player intentionally approaching a drop while visibly checking below is
  // treated as controlled. Holding a coherent path parallel to the lip also
  // counts as controlled unless they are actually drifting inward.
  const awareDescent = stableIntent
    && towardSpeed >= 0.12
    && intentTowardPit >= 0.18
    && viewTowardPit >= 0.12
    && lookingDown >= 0.22;
  const stableSkim = stableIntent
    && distance >= 0.065
    && tangentSpeed >= 0.30
    && towardSpeed <= 0.16
    && Math.abs(intentTowardPit) <= 0.36
    && exposed < 0.35;
  const deliberateControl = awareDescent || stableSkim;
  const explicitJump = (sample.jumpGraceSeconds ?? 0) > 0;
  const inheritedGrace = (sample.controlGraceSeconds ?? 0) > 0;
  const controlledApproach = deliberateControl || explicitJump || inheritedGrace;

  // Poor agreement between input and actual velocity indicates a skid/correction.
  // Moving into the void while looking elsewhere is also deliberately weighted as
  // clumsy, while clean forward motion remains nearly risk-free.
  const intentLoss = inputLength < 0.12
    ? (horizontalSpeed > 0.55 ? 0.85 : 0)
    : clamp01((0.70 - velocityIntentAlignment) / 0.85);
  const blindToward = towardSpeed > 0.18
    ? clamp01((0.28 - viewTowardPit) / 0.9) * (1 - lookingDown * 0.65)
    : 0;
  const sidewaysBlind = tangentSpeed > 0.55
    ? clamp01((0.35 - viewVelocityAlignment) / 0.9)
    : 0;
  const clumsyFactor = clamp01(Math.max(intentLoss, blindToward, sidewaysBlind));

  return { deliberateControl, controlledApproach, clumsyFactor };
};

export const analyzePitEdge = (
  sample: PitEdgeSample,
  pits: readonly MovementLabPitSpec[],
): PitEdgeAnalysis | null => {
  let best: PitEdgeAnalysis | null = null;
  for (const pit of pits) {
    const depth = -pit.bottom;
    if (depth < PIT_MIN_RAGDOLL_DROP) continue;
    const inside = pointInsidePit(sample.x, sample.z, pit);
    let distance = 0;
    let side: PitEdgeSide;
    let inwardX: number;
    let inwardZ: number;

    if (inside) {
      side = nearestSideInside(sample.x, sample.z, pit);
      const centerX = (pit.minX + pit.maxX) * 0.5;
      const centerZ = (pit.minZ + pit.maxZ) * 0.5;
      const toCenterX = centerX - sample.x;
      const toCenterZ = centerZ - sample.z;
      const centerDistance = Math.hypot(toCenterX, toCenterZ);
      if (centerDistance > 1e-6) {
        inwardX = toCenterX / centerDistance;
        inwardZ = toCenterZ / centerDistance;
      } else {
        [inwardX, inwardZ] = sideNormal(side);
      }
    } else {
      const nearest = nearestOutside(sample.x, sample.z, pit);
      distance = nearest.distance;
      side = nearest.side;
      inwardX = nearest.inwardX;
      inwardZ = nearest.inwardZ;
    }

    if (!inside && distance > PIT_EDGE_RISK_RADIUS) continue;
    if (!inside && sample.y < 0.35) continue;

    const safeStairEntry = (!inside && isSafeStairEntry(sample, pit, side))
      || (inside && isProtectedPitStairLane(sample, pit));
    const horizontalSpeed = Math.hypot(sample.velocityX, sample.velocityZ);
    const towardSpeed = Math.max(0, sample.velocityX * inwardX + sample.velocityZ * inwardZ);
    const tangentSpeed = Math.sqrt(Math.max(0, horizontalSpeed * horizontalSpeed - towardSpeed * towardSpeed));
    const proximity = inside ? 1 : clamp01((PIT_EDGE_RISK_RADIUS - distance) / PIT_EDGE_RISK_RADIUS);
    const movingStrength = clamp01((horizontalSpeed - 0.45) / 2.8);
    const tangentStrength = clamp01((tangentSpeed - 0.25) / 1.65);
    const towardStrength = clamp01((towardSpeed - 0.10) / 1.55);
    const exposed = safeStairEntry ? 0 : leanExposure(sample, pit);
    const control = movementControl(
      sample,
      inwardX,
      inwardZ,
      horizontalSpeed,
      towardSpeed,
      tangentSpeed,
      distance,
      exposed,
    );
    const controlledApproach = safeStairEntry || control.controlledApproach;

    const supportedInsidePit = inside && sample.grounded;
    const canBuildRisk = !safeStairEntry && !supportedInsidePit && !controlledApproach;

    // Parallel motion now only becomes dangerous when it also looks uncontrolled.
    // This preserves the "messing around on the lip" accident without punishing a
    // clean deliberate line beside the opening.
    const strideRisk = canBuildRisk
      ? Math.pow(proximity, 2.15)
        * movingStrength
        * tangentStrength
        * (0.18 + control.clumsyFactor * 0.82)
        * 0.95
      : 0;
    // Walking toward a hole without checking it remains the strongest pre-fall
    // signal, but a deliberate looked-at descent or explicit jump suppresses it.
    const towardRisk = canBuildRisk
      ? Math.pow(proximity, 1.55)
        * towardStrength
        * (0.32 + control.clumsyFactor * 1.18)
        * 1.15
      : 0;
    // Manual lean is intentionally slow-burn; a brief peek should not floor the
    // player, while hanging the torso far over the lip can still end badly.
    const postureRisk = canBuildRisk
      ? Math.pow(proximity, 2.0) * Math.pow(exposed, 1.55) * 0.82
      : 0;

    // Do not ragdoll merely because the capsule crossed the opening. A controlled
    // jump/descent stays animated. Only an unprotected fall with a meaningful drop
    // becomes an immediate physical tumble.
    const immediate = inside && !sample.grounded && !controlledApproach && (
      sample.fallDistance >= 0.28
      || (sample.falling && sample.velocityY < -1.9 && sample.y < 0.56)
    );
    const riskRate = immediate ? 99 : strideRisk + towardRisk + postureRisk;

    const analysis: PitEdgeAnalysis = {
      pit,
      inside,
      distance,
      side,
      inwardX,
      inwardZ,
      riskRate,
      immediate,
      safeStairEntry,
      leanExposure: exposed,
      controlledApproach,
      refreshControlGrace: safeStairEntry || control.deliberateControl || (sample.jumpGraceSeconds ?? 0) > 0,
    };
    if (!best || analysis.immediate || analysis.riskRate > best.riskRate) best = analysis;
  }
  return best;
};

export const integratePitEdgeRisk = (
  current: number,
  analysis: PitEdgeAnalysis | null,
  delta: number,
): number => {
  const safeDelta = Math.max(0, delta);
  if (analysis?.immediate) return PIT_EDGE_RAGDOLL_THRESHOLD;
  if (!analysis || analysis.controlledApproach || analysis.riskRate <= 0) {
    return Math.max(0, current - PIT_EDGE_RISK_DECAY_PER_SECOND * safeDelta);
  }
  return Math.min(
    PIT_EDGE_RAGDOLL_THRESHOLD,
    Math.max(0, current + analysis.riskRate * safeDelta),
  );
};

export const pitRagdollDamageForDrop = (dropMeters: number): number => {
  const drop = Math.max(0, dropMeters);
  // A clumsy edge tumble should hurt without being an automatic death. The
  // curve only becomes lethal for genuinely deep shafts.
  if (drop <= 0.45) return 4;
  if (drop <= 2) return Math.round(6 + ((drop - 0.45) / 1.55) * 14);
  if (drop <= 4.5) return Math.round(20 + ((drop - 2) / 2.5) * 35);
  if (drop <= 7) return Math.round(55 + ((drop - 4.5) / 2.5) * 34);
  return Math.round(89 + Math.min(22, (drop - 7) * 8));
};
