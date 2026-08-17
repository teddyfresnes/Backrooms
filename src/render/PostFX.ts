import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  BrightnessContrastEffect,
  EffectComposer,
  EffectPass,
  type Effect,
  HueSaturationEffect,
  NoiseEffect,
  NormalPass,
  RenderPass,
  SMAAEffect,
  SSAOEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import type { LightingMode } from './LightingMode';

export interface PostFXOptions {
  readonly bloom?: boolean;
}

export class PostFX {
  private composer: EffectComposer;
  private vignette?: VignetteEffect;
  private noise?: NoiseEffect;
  private grading?: HueSaturationEffect;
  private width = 1;
  private height = 1;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private lightingMode: LightingMode = 'modern',
    private readonly options: PostFXOptions = {},
  ) {
    this.composer = this.createComposer(lightingMode);
  }

  getLightingMode(): LightingMode {
    return this.lightingMode;
  }

  setLightingMode(mode: LightingMode): void {
    if (mode === this.lightingMode) return;
    const previous = this.composer;
    this.lightingMode = mode;
    this.composer = this.createComposer(mode);
    this.composer.setSize(this.width, this.height);
    previous.dispose();
  }

  private createComposer(mode: LightingMode): EffectComposer {
    this.vignette = undefined;
    this.noise = undefined;
    this.grading = undefined;
    const supportsHdrTargets = this.renderer.extensions.has('EXT_color_buffer_float');
    const coarsePointer = matchMedia('(pointer: coarse)').matches;
    const composer = new EffectComposer(this.renderer, {
      depthBuffer: true,
      stencilBuffer: false,
      multisampling: 0,
      frameBufferType: supportsHdrTargets ? THREE.HalfFloatType : THREE.UnsignedByteType,
    });

    if (mode === 'legacy') {
      let normalPass: NormalPass | undefined;
      if (!coarsePointer) {
        normalPass = new NormalPass(this.scene, this.camera, { resolutionScale: 0.5 });
        composer.addPass(normalPass);
      }
      composer.addPass(new RenderPass(this.scene, this.camera));
      const vignette = new VignetteEffect({
        eskil: false,
        offset: 0.5,
        darkness: 0.072,
      });
      const grading = new HueSaturationEffect({ hue: 0.005, saturation: -0.018 });
      const contrast = new BrightnessContrastEffect({ brightness: -0.006, contrast: 0.058 });
      const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
      const effects: Effect[] = [];
      if (normalPass) {
        effects.push(new SSAOEffect(this.camera, normalPass.texture, {
          blendFunction: BlendFunction.MULTIPLY,
          samples: 7,
          rings: 5,
          radius: 0.01,
          intensity: 0.34,
          bias: 0.034,
          fade: 0.15,
          luminanceInfluence: 0.82,
          color: new THREE.Color(0x494632),
          resolutionScale: 0.58,
        }));
      }
      if (this.options.bloom !== false && supportsHdrTargets && !coarsePointer) {
        effects.push(new BloomEffect({
          blendFunction: BlendFunction.SCREEN,
          intensity: 0.18,
          luminanceThreshold: 0.86,
          luminanceSmoothing: 0.18,
          mipmapBlur: true,
          radius: 0.52,
          levels: 3,
        }));
      }
      effects.push(toneMapping, grading, contrast, vignette);
      if (!coarsePointer) effects.push(new SMAAEffect());
      composer.addPass(new EffectPass(this.camera, ...effects));
      return composer;
    }

    composer.addPass(new RenderPass(this.scene, this.camera));
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
    const contrast = new BrightnessContrastEffect({ brightness: -0.01, contrast: 0.075 });
    const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    const effects: Effect[] = [];
    if (this.options.bloom !== false && supportsHdrTargets && !coarsePointer) {
      effects.push(new BloomEffect({
        blendFunction: BlendFunction.SCREEN,
        intensity: 0.14,
        luminanceThreshold: 0.9,
        luminanceSmoothing: 0.16,
        mipmapBlur: true,
        radius: 0.48,
        levels: 2,
      }));
    }
    effects.push(toneMapping, this.grading, contrast, this.noise, this.vignette);
    if (!coarsePointer) effects.push(new SMAAEffect());
    composer.addPass(new EffectPass(this.camera, ...effects));
    return composer;
  }

  setDarkness(value: number): void {
    if (!this.vignette || !this.noise || !this.grading) return;
    const darkness = THREE.MathUtils.clamp(value, 0, 1);
    this.vignette.darkness = THREE.MathUtils.lerp(0.09, 0.24, darkness);
    this.vignette.offset = THREE.MathUtils.lerp(0.47, 0.39, darkness);
    this.noise.blendMode.opacity.value = THREE.MathUtils.lerp(0.018, 0.04, darkness);
    this.grading.saturation = THREE.MathUtils.lerp(-0.025, -0.1, darkness);
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.composer.setSize(width, height);
  }

  render(delta: number): void {
    this.composer.render(delta);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
