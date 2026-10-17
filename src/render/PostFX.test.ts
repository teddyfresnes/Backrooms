import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

const state = vi.hoisted(() => ({ aa: [] as Array<{ weightsMaterial: { searchTexture: unknown; areaTexture: unknown }; dispatchEvent(event: unknown): void }>,
  fxaa: 0, composers: [] as Array<{ dispose: ReturnType<typeof vi.fn> }> }));
vi.mock('postprocessing', async () => {
  const three = await import('three');
  class Effect extends three.EventDispatcher {
    blendMode = { opacity: { value: 0 } };
  }
  class SMAA extends Effect {
    weightsMaterial = { searchTexture: null as unknown, areaTexture: null as unknown };
    constructor() { super(); state.aa.push(this); }
  }
  class FXAA extends Effect { constructor() { super(); state.fxaa++; } }
  class Composer {
    dispose = vi.fn(); setSize = vi.fn(); addPass = vi.fn(); render = vi.fn();
    constructor() { state.composers.push(this); }
  }
  return { BlendFunction: { SCREEN: 0, MULTIPLY: 1, SOFT_LIGHT: 2 }, ToneMappingMode: { AGX: 0 },
    EffectComposer: Composer, SMAAEffect: SMAA, FXAAEffect: FXAA, BloomEffect: Effect, BrightnessContrastEffect: Effect,
    EffectPass: Effect, HueSaturationEffect: Effect, NoiseEffect: Effect, NormalPass: Effect, RenderPass: Effect,
    SSAOEffect: Effect, ToneMappingEffect: Effect, VignetteEffect: Effect };
});
import { PostFX } from './PostFX';

const create = (antialias?: 'smaa' | 'fxaa') => new PostFX({ extensions: { has: () => true } } as unknown as THREE.WebGLRenderer,
  new THREE.Scene(), new THREE.PerspectiveCamera(), 'modern', { bloom: false, antialias });
beforeEach(() => { state.aa.length = state.composers.length = 0; state.fxaa = 0;
  vi.stubGlobal('matchMedia', () => ({ matches: false })); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('post-processing readiness', () => {
  it('uses the inexpensive stairwell filter without creating async SMAA resources', async () => {
    const fx = create('fxaa'); await fx.waitUntilReady();
    expect(state.fxaa).toBe(1); expect(state.aa).toHaveLength(0); fx.dispose();
  });

  it('does not release loading before SMAA lookup images are ready', async () => {
    const fx = create(), aa = state.aa[0]!; let ready = false;
    const pending = fx.waitUntilReady().then(() => { ready = true; });
    await Promise.resolve(); expect(ready).toBe(false);
    aa.weightsMaterial.searchTexture = {}; aa.weightsMaterial.areaTexture = {}; aa.dispatchEvent({ type: 'load' });
    await pending; expect(ready).toBe(true); fx.dispose();
  });

  it('falls back if lookup images fail to arrive and cancels pending work when disposed', async () => {
    vi.useFakeTimers();
    const fx = create(), pending = fx.waitUntilReady();
    await vi.advanceTimersByTimeAsync(4000); await pending;
    expect(state.composers).toHaveLength(2); expect(state.composers[0]!.dispose).toHaveBeenCalledOnce();
    expect(state.aa).toHaveLength(1); fx.dispose();
    const other = create(), cancelled = other.waitUntilReady(), before = state.composers.length;
    other.dispose(); await cancelled;
    expect(state.composers).toHaveLength(before); expect(vi.getTimerCount()).toBe(0);
  });
});
