import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';

/** Worn camcorder look, 0 (clean) .. 1 (violent): RGB split, line jitter,
 * scanlines, snow, tracking bands and dropouts. It samples neighbours, so it
 * owns its own EffectPass (one small program). */
const fragmentShader = /* glsl */ `
uniform float vhsIntensity;
uniform float vhsTime;
uniform vec2 vhsResolution;

float vhsHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void mainUv(inout vec2 uv) {
  float i = vhsIntensity;
  float frame = floor(vhsTime * 24.0);
  // Fine per-line wobble, always a little present.
  uv.x += (vhsHash(vec2(floor(uv.y * vhsResolution.y * 0.5), frame)) - 0.5) * (0.0009 + 0.006 * i);
  // Torn bands: a few rows slide sideways, more and wider as it worsens.
  float row = floor(uv.y * 36.0 + floor(vhsTime * 7.0));
  float torn = step(0.985 - 0.2 * i * i, vhsHash(vec2(row, frame)));
  uv.x += torn * (vhsHash(vec2(frame, row)) - 0.5) * 0.12 * i;
  // A violent picture rolls vertically for a moment.
  uv.y += i * i * 0.035 * step(0.93, vhsHash(vec2(frame * 0.37, 2.0))) * sin(vhsTime * 31.0);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float i = vhsIntensity;
  float frame = floor(vhsTime * 24.0);
  float shift = 0.0011 + 0.014 * i * i;
  vec3 color = vec3(
    texture2D(inputBuffer, uv + vec2(shift, 0.0)).r,
    inputColor.g,
    texture2D(inputBuffer, uv - vec2(shift * 1.3, 0.0)).b
  );
  // Tape bleed: slightly washed, cold.
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(color, vec3(luma) * vec3(0.94, 1.0, 1.04), 0.12 + 0.3 * i);
  // Scanlines.
  color *= 1.0 - (0.05 + 0.2 * i) * (0.5 + 0.5 * sin(uv.y * vhsResolution.y * 3.14159));
  // Snow.
  color += (vhsHash(uv * vhsResolution + frame * 17.0) - 0.5) * (0.03 + 0.3 * i);
  // A bright tracking line crawling up, and black dropouts when it is bad.
  float crawl = fract(vhsTime * 0.11);
  color += smoothstep(0.012, 0.0, abs(uv.y - crawl)) * (0.05 + 0.4 * i);
  float dropout = step(0.997 - 0.02 * i, vhsHash(vec2(floor(uv.y * 120.0), frame)));
  color = mix(color, vec3(0.0), dropout * i);
  outputColor = vec4(max(color, 0.0), inputColor.a);
}
`;

export class VhsEffect extends Effect {
  constructor() {
    super('VhsEffect', fragmentShader, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['vhsIntensity', new THREE.Uniform(0)],
        ['vhsTime', new THREE.Uniform(0)],
        ['vhsResolution', new THREE.Uniform(new THREE.Vector2(1, 1))],
      ]),
    });
  }

  set intensity(value: number) { this.uniforms.get('vhsIntensity')!.value = THREE.MathUtils.clamp(value, 0, 1); }
  get intensity(): number { return this.uniforms.get('vhsIntensity')!.value as number; }

  advance(delta: number): void { this.uniforms.get('vhsTime')!.value = ((this.uniforms.get('vhsTime')!.value as number) + delta) % 1000; }

  override setSize(width: number, height: number): void {
    (this.uniforms.get('vhsResolution')!.value as THREE.Vector2).set(Math.max(1, width), Math.max(1, height));
  }
}
