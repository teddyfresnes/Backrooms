import { expect, it } from 'vitest';
import { predictFallOwners } from './FallPrefetch';
import { regionalOwnerAt } from '../world/RegionalPlan';

it('predicts real datum-relative owners from pelvis motion with a bounded horizon', () => {
  const p = { x: 54, y: 18, z: -56 }, v = { x: 15, y: -28, z: -5 };
  const owners = predictFallOwners('REGIONAL-AUDIT-2', p, v);
  expect(owners.length).toBeGreaterThan(0); expect(owners.length).toBeLessThanOrEqual(3);
  const samples = [.12, .24, .36, .48, .6].map(t => regionalOwnerAt('REGIONAL-AUDIT-2', p.x + v.x * t, p.y + v.y * t - 5.7 * t * t, p.z + v.z * t));
  for (const owner of owners) expect(samples).toContainEqual(owner);
  expect(owners.some(c=>c.x===1)).toBe(true); expect(owners[0]!.z).toBe(-1);
  expect(new Set(owners.map(c => `${c.x}/${c.z}/${c.story}`)).size).toBe(owners.length);
});

it('does not prefetch a column when grounded, rising or given invalid motion', () => {
  for (const v of [undefined, {x:0,y:0,z:0},{x:0,y:6,z:0},{x:NaN,y:-20,z:0}])
    expect(predictFallOwners('PREFETCH', {x:0,y:0,z:0}, v)).toEqual([]);
});
