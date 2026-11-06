import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DashcamLook } from './DashcamLook';

const aim = (yaw: number, pitch = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
describe('dashcam presentation', () => {
  for (const fps of [30, 60, 120]) it(`carries a fast turn then settles without changing intent at ${fps} Hz`, () => {
    const camera = new DashcamLook(), output = new THREE.Quaternion(), target = aim(.8);
    camera.reset(aim(0)); camera.sample(target, 1 / fps, true, output);
    expect(output.angleTo(target)).toBeGreaterThan(.05); expect(output.angleTo(target)).toBeLessThan(.3);
    const first = output.clone(); camera.sample(target, 1 / fps, true, output);
    expect(output.angleTo(first)).toBeGreaterThan(.005);
    for (let frame = 0; frame < fps; frame++) camera.sample(target, 1 / fps, true, output);
    expect(output.angleTo(target)).toBeLessThan(.001); expect(Math.abs(camera.roll)).toBeLessThan(.001);
    expect(target.angleTo(aim(.8))).toBeLessThan(1e-7);
  });
  it('takes the short path across the yaw seam and disables immediately for reduced motion', () => {
    const camera = new DashcamLook(), output = new THREE.Quaternion(); camera.reset(aim(Math.PI - .05));
    camera.sample(aim(-Math.PI + .05), 1 / 60, true, output);
    expect(output.angleTo(aim(-Math.PI + .05))).toBeLessThan(.11);
    camera.sample(aim(-1, .4), 1 / 60, false, output);
    expect(output.angleTo(aim(-1, .4))).toBeLessThan(1e-7); expect(camera.roll).toBe(0);
  });
});
