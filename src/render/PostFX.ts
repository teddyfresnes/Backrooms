import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  BrightnessContrastEffect,
  EffectComposer,
  EffectPass,
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
      normalPass = new NormalPass(scene, camera, { resolutionScale: 0.6 });
      this.composer.addPass(normalPass);
    }
    this.composer.addPass(new RenderPass(scene, camera));

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
    if (normalPass) {
      const ssao = new SSAOEffect(camera, normalPass.texture, {
        blendFunction: BlendFunction.MULTIPLY,
        samples: 13,
        rings: 7,
        // Keep AO as a true contact shadow. The previous 0.09 radius sampled
        // far enough across a room to paint broad bands on walls and ceilings.
        radius: 0.018,
        intensity: 0.46,
        bias: 0.04,
        fade: 0.14,
        luminanceInfluence: 0.82,
        worldProximityThreshold: 0.18,
        worldProximityFalloff: 0.22,
        color: new THREE.Color(0x292916),
        resolutionScale: 0.82,
      });
      this.composer.addPass(new EffectPass(camera, ssao));
    }
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
