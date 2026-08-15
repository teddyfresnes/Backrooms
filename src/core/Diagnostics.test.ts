import { describe, expect, it } from 'vitest';
import { describeViewDirection, resolveDiagnosticsVisibility } from './Diagnostics';

describe('diagnostic view directions', () => {
  it.each([
    [{ x: 0, y: 0, z: -1 }, 0, 'N'],
    [{ x: 1, y: 0, z: -1 }, 45, 'NE'],
    [{ x: 1, y: 0, z: 0 }, 90, 'E'],
    [{ x: 0, y: 0, z: 1 }, 180, 'S'],
    [{ x: -1, y: 0, z: 0 }, 270, 'W'],
  ] as const)('maps %o to yaw %d° and %s', (direction, yaw, cardinal) => {
    const result = describeViewDirection(direction);
    expect(result.yaw).toBeCloseTo(yaw, 8);
    expect(result.cardinal).toBe(cardinal);
    expect(result.pitch).toBeCloseTo(0, 8);
    expect(Math.hypot(
      result.direction.x,
      result.direction.y,
      result.direction.z,
    )).toBeCloseTo(1, 8);
  });

  it('reports vertical pitch independently from yaw', () => {
    const result = describeViewDirection({ x: 0, y: 1, z: -1 });
    expect(result.yaw).toBeCloseTo(0, 8);
    expect(result.pitch).toBeCloseTo(45, 8);
    expect(result.cardinal).toBe('N');
  });

  it('uses a stable north-facing fallback for a zero vector', () => {
    expect(describeViewDirection({ x: 0, y: 0, z: 0 })).toEqual({
      direction: { x: 0, y: 0, z: -1 },
      yaw: 0,
      pitch: 0,
      cardinal: 'N',
    });
  });
});

describe('/logs visibility modes', () => {
  it('toggles by default and accepts explicit states', () => {
    expect(resolveDiagnosticsVisibility(false, [])).toBe(true);
    expect(resolveDiagnosticsVisibility(true, ['toggle'])).toBe(false);
    expect(resolveDiagnosticsVisibility(false, ['on'])).toBe(true);
    expect(resolveDiagnosticsVisibility(true, ['off'])).toBe(false);
    expect(resolveDiagnosticsVisibility(false, ['oui'])).toBe(true);
    expect(resolveDiagnosticsVisibility(true, ['non'])).toBe(false);
  });

  it('rejects unknown or extra arguments', () => {
    expect(resolveDiagnosticsVisibility(false, ['sometimes'])).toBeNull();
    expect(resolveDiagnosticsVisibility(false, ['on', 'now'])).toBeNull();
  });
});
