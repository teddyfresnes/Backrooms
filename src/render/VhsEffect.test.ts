import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EffectPass } from 'postprocessing';
import { VhsEffect } from './VhsEffect';

describe('VhsEffect', () => {
  it('builds inside a real EffectPass (convolution effects may not declare a UV hook)', () => {
    const pass = new EffectPass(new THREE.PerspectiveCamera(), new VhsEffect());
    expect(() => (pass as unknown as { updateMaterial(): void }).updateMaterial()).not.toThrow();
    pass.dispose();
  });

  it('clamps its intensity', () => {
    const effect = new VhsEffect();
    effect.intensity = 3;
    expect(effect.intensity).toBe(1);
    effect.intensity = -1;
    expect(effect.intensity).toBe(0);
  });
});
