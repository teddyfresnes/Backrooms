/** Continuous contact in relative space. No timer, range fallback or deferred hit. */
export interface ContactVector { readonly x: number; readonly y: number; readonly z: number }
export interface SweptContact {
  readonly fraction: number;
  readonly speed: number;
  readonly point: ContactVector;
  readonly direction: ContactVector;
}
const mix = (a: ContactVector, b: ContactVector, t: number): ContactVector => ({
  x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t,
});
const finite = (v: ContactVector): boolean => Number.isFinite(v.x + v.y + v.z);

export function sweepCombatContact(
  handBefore: ContactVector, handNow: ContactVector,
  targetBefore: ContactVector, targetNow: ContactVector,
  radius: number, delta: number,
  phaseBefore: number, phaseNow: number, activeStart: number, activeEnd: number,
): SweptContact | null {
  if (![handBefore, handNow, targetBefore, targetNow].every(finite)
    || ![radius, delta, phaseBefore, phaseNow, activeStart, activeEnd].every(Number.isFinite)
    || radius <= 0 || delta <= 0 || delta > 0.12 || phaseNow <= phaseBefore
    || phaseNow < activeStart || phaseBefore > activeEnd) return null;
  const lo = Math.max(0, (activeStart - phaseBefore) / (phaseNow - phaseBefore));
  const hi = Math.min(1, (activeEnd - phaseBefore) / (phaseNow - phaseBefore));
  if (hi < lo) return null;
  const p = { x: handBefore.x - targetBefore.x, y: handBefore.y - targetBefore.y, z: handBefore.z - targetBefore.z };
  const v = {
    x: handNow.x - targetNow.x - p.x,
    y: handNow.y - targetNow.y - p.y,
    z: handNow.z - targetNow.z - p.z,
  };
  const a = v.x * v.x + v.y * v.y + v.z * v.z;
  const speed = Math.sqrt(a) / delta;
  // Reject idle penetration, teleports and pure recovery motion. A target that
  // moves into a committed fist still has relative momentum and can be struck.
  if (speed < 0.35 || speed > 22) return null;
  const b = 2 * (p.x * v.x + p.y * v.y + p.z * v.z);
  const c = p.x * p.x + p.y * p.y + p.z * p.z - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const enter = (-b - Math.sqrt(discriminant)) / (2 * a);
  const leave = (-b + Math.sqrt(discriminant)) / (2 * a);
  const fraction = Math.max(lo, enter);
  if (fraction > hi + 1e-8 || fraction > leave || b + 2 * a * fraction >= -1e-8) return null;
  const point = mix(handBefore, handNow, fraction);
  const length = Math.sqrt(a);
  return { fraction, speed, point, direction: { x: v.x / length, y: v.y / length, z: v.z / length } };
}

/** A buffered follow-up waits until the fist has actually begun its recoil. */
export function combatChainReady(elapsed: number, duration: number, contactEnd: number, impact: number): boolean {
  return duration > 0 && elapsed / duration >= Math.max(contactEnd + 0.075, impact + 0.23);
}

/** Decaying balance loss replaces random falls and fixed three-hit knockdowns. */
export class CombatBalance {
  private load = 0;
  private time = -Infinity;
  reset(): void { this.load = 0; this.time = -Infinity; }
  hit(now: number, damage: number, zone: 'head' | 'upper-body' | 'body', heavy: boolean): number {
    if (!Number.isFinite(now) || !Number.isFinite(damage) || damage <= 0) return this.load;
    this.load *= Math.exp(-Math.max(0, now - this.time) / 1.15);
    this.time = now;
    this.load += damage * (zone === 'head' ? 1.35 : zone === 'body' ? 0.82 : 1) * (heavy ? 1.18 : 1);
    return this.load;
  }
}

/** Exact critically damped spring; the result is independent of render rate. */
export function stepCombatSpring(position: number, velocity: number, delta: number, frequency = 18): [number, number] {
  const dt = Math.max(0, Math.min(0.1, delta));
  const decay = Math.exp(-frequency * dt);
  const c = velocity + frequency * position;
  return [(position + c * dt) * decay, (velocity - frequency * c * dt) * decay];
}
