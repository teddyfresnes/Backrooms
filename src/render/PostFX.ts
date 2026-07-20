import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  BrightnessContrastEffect,
  EffectComposer,
  EffectPass,
  type Effect,
  HueSaturationEffect,
  NormalPass,
  RenderPass,
  SMAAEffect,
  SSAOEffect,
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
    let normalPass: NormalPass | undefined;
    if (!coarsePointer) {
      normalPass = new NormalPass(scene, camera, { resolutionScale: 0.5 });
      this.composer.addPass(normalPass);
    }
    this.composer.addPass(new RenderPass(scene, camera));

    const vignette = new VignetteEffect({
      eskil: false,
      offset: 0.5,
      darkness: 0.072,
    });
    const grading = new HueSaturationEffect({ hue: 0.005, saturation: -0.018 });
    const contrast = new BrightnessContrastEffect({ brightness: -0.006, contrast: 0.058 });
    const toneMapping = new ToneMappingEffect({
      mode: ToneMappingMode.AGX,
    });
    const effects: Effect[] = [];
    if (normalPass) {
      const ssao = new SSAOEffect(camera, normalPass.texture, {
        blendFunction: BlendFunction.MULTIPLY,
        samples: 7,
        rings: 5,
        // The bake already carries the broad fluorescent penumbra. SSAO only
        // restores tight geometric contact, avoiding a second dark band along
        // every wall while costing substantially fewer texture samples.
        radius: 0.01,
        intensity: 0.34,
        bias: 0.034,
        fade: 0.15,
        luminanceInfluence: 0.82,
        color: new THREE.Color(0x494632),
        resolutionScale: 0.58,
      });
      effects.push(ssao);
    }
    // Bloom is only worthwhile on an HDR target. Three mip levels retain a
    // soft fluorescent halo without paying for the former full five-level chain.
    if (supportsHdrTargets && !coarsePointer) {
      const bloom = new BloomEffect({
        blendFunction: BlendFunction.SCREEN,
        intensity: 0.18,
        luminanceThreshold: 0.86,
        luminanceSmoothing: 0.18,
        mipmapBlur: true,
        radius: 0.52,
        levels: 3,
      });
      effects.push(bloom);
    }
    effects.push(toneMapping, grading, contrast, vignette);
    if (!coarsePointer) effects.push(new SMAAEffect());
    // postprocessing fuses compatible effects into one shader. SSAO and bloom
    // keep their reduced-resolution internal buffers, while their composites,
    // grading and SMAA now share one full-resolution draw and buffer swap.
    this.composer.addPass(new EffectPass(camera, ...effects));
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
