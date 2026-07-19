import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  BrightnessContrastEffect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';

export class PostFX {
  private readonly composer: EffectComposer;

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
    // Do not add screen-space ambient occlusion here. In these low-ceiling,
    // wall-heavy rooms its depth halo becomes a thick stripe on ceilings and
    // doubles the baked corner shadows instead of reading as contact shading.

    const vignette = new VignetteEffect({
      eskil: false,
      offset: 0.5,
      darkness: 0.06,
    });
    const grading = new HueSaturationEffect({ hue: 0.005, saturation: -0.018 });
    const contrast = new BrightnessContrastEffect({ brightness: -0.004, contrast: 0.035 });
    const toneMapping = new ToneMappingEffect({
      mode: ToneMappingMode.AGX,
    });
    // Bloom is only worthwhile on an HDR target. Three mip levels retain a
    // soft fluorescent halo without paying for the former full five-level chain.
    if (supportsHdrTargets && !coarsePointer) {
      const bloom = new BloomEffect({
        blendFunction: BlendFunction.SCREEN,
        intensity: 0.15,
        luminanceThreshold: 0.86,
        luminanceSmoothing: 0.18,
        mipmapBlur: true,
        radius: 0.52,
        levels: 3,
      });
      this.composer.addPass(new EffectPass(camera, bloom));
    }
    this.composer.addPass(
      new EffectPass(
        camera,
        toneMapping,
        grading,
        contrast,
        vignette,
      ),
    );
    if (!coarsePointer) this.composer.addPass(new EffectPass(camera, new SMAAEffect()));
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
