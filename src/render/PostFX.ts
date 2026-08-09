import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  EffectComposer,
  EffectPass,
  type Effect,
  HueSaturationEffect,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';

export class PostFX {
  private readonly composer: EffectComposer;
  private readonly vignette: VignetteEffect;
  private readonly noise: NoiseEffect;
  private readonly grading: HueSaturationEffect;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    const supportsHdrTargets = renderer.extensions.has('EXT_color_buffer_float');
    const coarsePointer = matchMedia('(pointer: coarse)').matches;
    this.composer = new EffectComposer(renderer, {
      depthBuffer: true,
      stencilBuffer: false,
      multisampling: 0,
      frameBufferType: supportsHdrTargets ? THREE.HalfFloatType : THREE.UnsignedByteType,
    });
    this.composer.addPass(new RenderPass(scene, camera));

    this.vignette = new VignetteEffect({
      eskil: false,
      offset: 0.47,
      darkness: 0.09,
    });
    this.grading = new HueSaturationEffect({ hue: 0.004, saturation: -0.025 });
    this.noise = new NoiseEffect({
      blendFunction: BlendFunction.SOFT_LIGHT,
      premultiply: true,
    });
    this.noise.blendMode.opacity.value = 0.018;
    const toneMapping = new ToneMappingEffect({
      mode: ToneMappingMode.AGX,
    });
    const effects: Effect[] = [];
    // Bloom is only worthwhile on an HDR target. Two mip levels retain a soft
    // fluorescent halo without turning neighbouring surfaces into contrast bands.
    if (supportsHdrTargets && !coarsePointer) {
      const bloom = new BloomEffect({
        blendFunction: BlendFunction.SCREEN,
        intensity: 0.14,
        luminanceThreshold: 0.9,
        luminanceSmoothing: 0.16,
        mipmapBlur: true,
        radius: 0.48,
        levels: 2,
      });
      effects.push(bloom);
    }
    effects.push(toneMapping, this.grading, this.noise, this.vignette);
    if (!coarsePointer) effects.push(new SMAAEffect());
    // Compatible effects are fused into one full-resolution shader. Only bloom
    // and SMAA keep their own small internal buffers.
    this.composer.addPass(new EffectPass(camera, ...effects));
  }

  setDarkness(value: number): void {
    const darkness = THREE.MathUtils.clamp(value, 0, 1);
    this.vignette.darkness = THREE.MathUtils.lerp(0.09, 0.24, darkness);
    this.vignette.offset = THREE.MathUtils.lerp(0.47, 0.39, darkness);
    this.noise.blendMode.opacity.value = THREE.MathUtils.lerp(0.018, 0.04, darkness);
    this.grading.saturation = THREE.MathUtils.lerp(-0.025, -0.1, darkness);
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }

  render(delta: number): void {
    this.composer.render(delta);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
