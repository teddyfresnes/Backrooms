import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';

/** Worn camcorder look, 0 (clean) .. 1 (violent): RGB split, line jitter,
 * scanlines, snow, tracking bands and dropouts. It samples neighbours, so it
 * owns its own EffectPass (one small program). */
const fragmentShader = /* glsl */ `
uniform float vhsIntensity;
uniform float vhsTime;
uniform vec2 vhsResolution;
uniform float vhsRain;

float vhsHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Rain on the lens: one layer of cells, some holding a drop that beads,
// swells and slides down before it clears. Returns the refraction offset.
vec2 vhsDrops(vec2 uv, float scale, float speed, float seed, out float mask) {
  vec2 p = uv * vec2(vhsResolution.x / vhsResolution.y, 1.0) * scale;
  vec2 cell = floor(p);
  vec2 f = fract(p) - 0.5;
  float h = vhsHash(cell + seed);
  float h2 = vhsHash(cell + seed + 7.31);
  float life = fract(vhsTime * speed * (0.6 + 0.8 * h2) + h);
  float present = step(0.52, vhsHash(cell + seed + 3.17));
  vec2 center = (vec2(h, h2) - 0.5) * 0.5;
  center.y -= life * life * 0.55;
  float radius = 0.1 + 0.16 * h2;
  vec2 d = f - center;
  float dist = length(d * vec2(1.0, 0.8));
  mask = smoothstep(radius, radius * 0.55, dist) * present * smoothstep(0.0, 0.08, life) * smoothstep(1.0, 0.75, life);
  return d / radius * mask;
}

// The UV distortion lives here, not in a UV hook: postprocessing refuses an
// effect that both transforms UVs and samples neighbours (convolution).
vec2 vhsDistort(vec2 uv) {
  float i = vhsIntensity;
  float i2 = i * i;
  float frame = floor(vhsTime * 24.0);
  // Per-line wobble: invisible at rest, grows with the disturbance.
  uv.x += (vhsHash(vec2(floor(gl_FragCoord.y * 0.5), frame)) - 0.5) * 0.007 * i2;
  // Torn bands: a few rows slide sideways, only once it gets bad.
  float row = floor(uv.y * 36.0 + floor(vhsTime * 7.0));
  float torn = step(1.0 - 0.2 * i2, vhsHash(vec2(row, frame))) * smoothstep(0.25, 0.5, i);
  uv.x += torn * (vhsHash(vec2(frame, row)) - 0.5) * 0.12 * i;
  // A violent picture rolls vertically for a moment.
  uv.y += i2 * 0.035 * step(0.93, vhsHash(vec2(frame * 0.37, 2.0))) * sin(vhsTime * 31.0) * smoothstep(0.4, 0.7, i);
  return clamp(uv, 0.0, 1.0);
}

// At the passive level (~0.1) only a fine colour-preserving grain and a hair
// of chroma fringing remain: no desaturation, no band, no scanline moire.
void mainImage(const in vec4 inputColor, const in vec2 baseUv, out vec4 outputColor) {
  float i = vhsIntensity;
  float i2 = i * i;
  float frame = floor(vhsTime * 24.0);
  vec2 uv = vhsDistort(baseUv);
  float drop = 0.0;
  if (vhsRain > 0.001) {
    float near, far;
    vec2 bend = vhsDrops(baseUv, 7.0, 0.09, 0.0, near) + vhsDrops(baseUv, 13.0, 0.14, 19.7, far) * 0.7;
    drop = max(near, far) * vhsRain;
    // A drop is a little lens: it shows the scene flipped and pulled in.
    uv = clamp(uv - bend * vhsRain * 0.028, 0.0, 1.0);
  }
  float shift = 0.0006 + 0.014 * i2;
  vec3 color = vec3(
    texture2D(inputBuffer, clamp(uv + vec2(shift, 0.0), 0.0, 1.0)).r,
    texture2D(inputBuffer, uv).g,
    texture2D(inputBuffer, clamp(uv - vec2(shift * 1.3, 0.0), 0.0, 1.0)).b
  );
  // The buffer is linear: damage it in display space, or grain and snow crush
  // the shadows (a few thousandths in linear is most of a dark pixel).
  color = pow(max(color, 0.0), vec3(1.0 / 2.2));
  // Wet glass: drops read slightly brighter at the core, dark at the rim.
  color *= 1.0 + drop * 0.12 - drop * drop * 0.2;
  // Tape bleed: washed and cold, only when disturbed.
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(color, vec3(luma) * vec3(0.94, 1.0, 1.04), 0.4 * i2);
  // Scanlines on real pixel rows (no moire), only when disturbed.
  color *= 1.0 - 0.22 * i2 * mod(floor(gl_FragCoord.y), 2.0);
  // Grain keeps the colour; grey snow only when disturbed.
  float grain = vhsHash(gl_FragCoord.xy + frame * 17.0) - 0.5;
  color *= 1.0 + grain * 0.04;
  color += grain * 0.32 * i2;
  // A bright tracking line crawling up, and black dropouts, when it is bad.
  float crawl = fract(vhsTime * 0.11);
  color += smoothstep(0.012, 0.0, abs(uv.y - crawl)) * 0.4 * smoothstep(0.3, 0.6, i);
  float dropout = step(0.997 - 0.02 * i, vhsHash(vec2(floor(uv.y * 120.0), frame)));
  color = mix(color, vec3(0.0), dropout * smoothstep(0.3, 0.6, i));
  outputColor = vec4(pow(max(color, 0.0), vec3(2.2)), inputColor.a);
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
        ['vhsRain', new THREE.Uniform(0)],
      ]),
    });
  }

  set intensity(value: number) { this.uniforms.get('vhsIntensity')!.value = THREE.MathUtils.clamp(value, 0, 1); }
  get intensity(): number { return this.uniforms.get('vhsIntensity')!.value as number; }

  /** Rain beading on the lens, 0 (dry) .. 1 (out in the downpour). */
  set rain(value: number) { this.uniforms.get('vhsRain')!.value = THREE.MathUtils.clamp(value, 0, 1); }
  get rain(): number { return this.uniforms.get('vhsRain')!.value as number; }

  advance(delta: number): void { this.uniforms.get('vhsTime')!.value = ((this.uniforms.get('vhsTime')!.value as number) + delta) % 1000; }

  override setSize(width: number, height: number): void {
    (this.uniforms.get('vhsResolution')!.value as THREE.Vector2).set(Math.max(1, width), Math.max(1, height));
  }
}
