/** Pure helpers used by PlayerController and by the movement smoke tests. */
export interface Vector2Like { x: number; z: number }

export const moveTowards2D = (
  currentX: number,
  currentZ: number,
  targetX: number,
  targetZ: number,
  maxDelta: number,
): Vector2Like => {
  const dx = targetX - currentX;
  const dz = targetZ - currentZ;
  const distance = Math.hypot(dx, dz);
  if (distance <= maxDelta || distance < 1e-8) return { x: targetX, z: targetZ };
  const scale = Math.max(0, maxDelta) / distance;
  return { x: currentX + dx * scale, z: currentZ + dz * scale };
};

/** 0 = same heading, 0.5 = perpendicular, 1 = full reversal. */
export const directionChangeSeverity = (
  currentX: number,
  currentZ: number,
  targetX: number,
  targetZ: number,
): number => {
  const currentLength = Math.hypot(currentX, currentZ);
  const targetLength = Math.hypot(targetX, targetZ);
  if (currentLength < 1e-6 || targetLength < 1e-6) return 0;
  const dot = (currentX * targetX + currentZ * targetZ) / (currentLength * targetLength);
  return (1 - Math.max(-1, Math.min(1, dot))) * 0.5;
};


/**
 * Keeps inertia in speed while making heading authoritative. This is used for
 * camera-forward movement and sprinting so an old velocity vector can never
 * keep skating sideways after the player has already changed aim direction.
 */
export const moveSpeedAlongDirection2D = (
  currentX: number,
  currentZ: number,
  directionX: number,
  directionZ: number,
  targetSpeed: number,
  maxDelta: number,
): Vector2Like => {
  const directionLength = Math.hypot(directionX, directionZ);
  if (directionLength < 1e-8) return { x: currentX, z: currentZ };
  const unitX = directionX / directionLength;
  const unitZ = directionZ / directionLength;

  // Preserve only momentum that is already travelling toward the new input.
  // Keeping the full old speed magnitude and snapping it onto a new heading made
  // 90-180 degree mouse turns feel like a teleport/reversal. Sideways and
  // backwards momentum is traction loss, not useful forward speed.
  const alignedSpeed = Math.max(0, currentX * unitX + currentZ * unitZ);
  const clampedTarget = Math.max(0, targetSpeed);
  const step = Math.max(0, maxDelta);
  const nextSpeed = alignedSpeed < clampedTarget
    ? Math.min(clampedTarget, alignedSpeed + step)
    : Math.max(clampedTarget, alignedSpeed - step);
  return { x: unitX * nextSpeed, z: unitZ * nextSpeed };
};

/**
 * Horizontal movement basis derived from the same unbounded pointer yaw used by
 * third-person body following. It deliberately ignores pitch/roll/bodycam FX so
 * a held forward key cannot change sign or become lateral at Euler branch cuts.
 */
export const movementBasisFromYaw = (yawRadians: number): { forward: Vector2Like; right: Vector2Like } => ({
  forward: { x: -Math.sin(yawRadians), z: -Math.cos(yawRadians) },
  right: { x: Math.cos(yawRadians), z: -Math.sin(yawRadians) },
});


/**
 * Bias only forward+side input toward camera-forward. Side-only and every
 * backward combination stay untouched, so authored pure strafes keep their
 * original travel direction while diagonal advance feels less crab-like.
 */
export const forwardBiasedDiagonalAxes = (
  forward: number,
  right: number,
  lateralScale: number,
): { forward: number; right: number } => {
  if (forward <= 1e-6 || Math.abs(right) <= 1e-6) return { forward, right };
  const scale = Math.max(0, Math.min(1, lateralScale));
  return { forward, right: right * scale };
};

export const expSmoothing = (delta: number, response: number): number =>
  1 - Math.exp(-Math.max(0, delta) * Math.max(0, response));

export const normalizedSpeed = (speed: number, walkSpeed: number, maxSpeed: number): number => {
  if (maxSpeed <= walkSpeed) return 0;
  return Math.max(0, Math.min(1, (speed - walkSpeed) / (maxSpeed - walkSpeed)));
};

/** Dedicated body lean axis: A = -1 (left), E = +1 (right). */
export const manualLeanAxis = (leftPressed: boolean, rightPressed: boolean): number =>
  Number(rightPressed) - Number(leftPressed);
