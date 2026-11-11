import * as THREE from 'three';
import type { SeededRandom } from '../world/SeededRandom';
import type { Vec3Data } from '../world/types';

/**
 * The lamps around the creature misbehave. Two shared uniform holders reach
 * every zonal surface shader and every fluorescent diffuser: writing them
 * never adds, removes or hides a Three.js light, so no shader recompiles.
 * Surfaces stutter patch by patch inside the radius; each tube follows one of
 * two ballasts (A/B), and a few die outright while it is close.
 */
export const LIGHT_DISTURBANCE = {
  /** xyz world centre, w radius (m). */
  center: { value: new THREE.Vector4(0, -1e5, 0, 1) },
  /** x amplitude 0..1, y ballast A level, z ballast B level, w seconds. */
  state: { value: new THREE.Vector4(0, 1, 1, 0) },
};

export const LIGHT_DISTURBANCE_GLSL = /* glsl */ `
uniform vec4 lightDisturbCenter;
uniform vec4 lightDisturbState;
float lightDisturbHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float lightDisturbNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = lightDisturbHash(i), b = lightDisturbHash(i + vec2(1.0, 0.0));
  float c = lightDisturbHash(i + vec2(0.0, 1.0)), d = lightDisturbHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float lightDisturbReach(vec3 p) {
  vec3 d = p - lightDisturbCenter.xyz;
  return lightDisturbState.x
    * (1.0 - smoothstep(lightDisturbCenter.w * 0.4, lightDisturbCenter.w, length(d.xz)))
    * (1.0 - smoothstep(3.0, 5.0, abs(d.y)));
}
float lightDisturbLevel(vec2 p) {
  return mix(lightDisturbState.y, lightDisturbState.z, smoothstep(0.3, 0.7, lightDisturbNoise(p * 0.28)));
}
float lightDisturbSurface(vec3 p) {
  if (lightDisturbState.x <= 0.0005) return 1.0;
  float reach = lightDisturbReach(p);
  return mix(1.0, lightDisturbLevel(p.xz), reach);
}
float lightDisturbTube(vec3 p, vec3 tube) {
  if (lightDisturbState.x <= 0.0005) return 1.0;
  float reach = lightDisturbReach(p);
  float dead = step(lightDisturbHash(floor(tube.xz * 0.5) + 0.37), 0.2 * reach);
  return mix(1.0, lightDisturbLevel(tube.xz) * (1.0 - dead), reach);
}
`;

/** Program cache key suffix: materials decorated with the disturbance. */
export const LIGHT_DISTURBANCE_KEY = 'light-disturbance-v1';

/** Fluorescent diffusers (instanced panels and merged previews): their own tube flickers. */
export const applyFixtureDisturbance = (material: THREE.MeshBasicMaterial): void => {
  const previous = material.onBeforeCompile.bind(material);
  const key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.uniforms.lightDisturbCenter = LIGHT_DISTURBANCE.center;
    shader.uniforms.lightDisturbState = LIGHT_DISTURBANCE.state;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vDisturbWorld;
        varying vec3 vDisturbTube;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vDisturbWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vDisturbTube = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #else
          vDisturbWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vDisturbTube = vDisturbWorld;
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vDisturbWorld;
        varying vec3 vDisturbTube;
        ${LIGHT_DISTURBANCE_GLSL}`)
      .replace('#include <opaque_fragment>', `outgoingLight *= lightDisturbTube(vDisturbWorld, vDisturbTube);
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => `${key()}|${LIGHT_DISTURBANCE_KEY}`;
  material.needsUpdate = true;
};

interface Ballast { level: number; target: number; timer: number; off: boolean }

/**
 * CPU side: two ballasts that stutter, dip and cut harder the closer the
 * creature gets (amplitude). Seeded; `clacks` counts the strikes to sound.
 */
export class LightFlicker {
  amplitude = 0;
  time = 0;
  /** Ballast strikes since the last `takeClacks`. */
  private clacks = 0;
  private readonly ballasts: Ballast[] = [
    { level: 1, target: 1, timer: 0.3, off: false },
    { level: 1, target: 1, timer: 0.7, off: false },
  ];

  constructor(private readonly random: SeededRandom) {}

  get levelA(): number { return this.ballasts[0]!.level; }
  get levelB(): number { return this.ballasts[1]!.level; }

  takeClacks(): number { const count = this.clacks; this.clacks = 0; return count; }

  update(delta: number, target: number): void {
    const dt = Math.max(0, Math.min(0.1, delta));
    this.time = (this.time + dt) % 1000;
    const wanted = Math.max(0, Math.min(1, target));
    this.amplitude += (wanted - this.amplitude) * (1 - Math.exp(-dt * (wanted > this.amplitude ? 2.5 : 0.8)));
    const amplitude = this.amplitude;
    for (const ballast of this.ballasts) {
      ballast.timer -= dt;
      if (amplitude < 0.02) { ballast.target = 1; ballast.off = false; }
      else if (ballast.timer <= 0) {
        if (ballast.off) {
          ballast.off = false;
          ballast.target = 1;
          ballast.timer = this.random.float(0.12, 1.4) * (1.25 - amplitude);
        } else if (this.random.chance(0.35 + 0.55 * amplitude)) {
          ballast.off = true;
          ballast.target = this.random.float(0.03, 0.5) * (1 - 0.6 * amplitude);
          ballast.timer = this.random.float(0.03, 0.16) + (amplitude > 0.75 && this.random.chance(0.18) ? this.random.float(0.5, 1.6) : 0);
          if (amplitude > 0.2) this.clacks += 1;
        } else {
          ballast.target = 1 - this.random.float(0, 0.25) * amplitude;
          ballast.timer = this.random.float(0.1, 0.6);
        }
      }
      ballast.level += (ballast.target - ballast.level) * (1 - Math.exp(-dt * 60));
    }
  }

  /** Writes the shared uniforms around `center` (radius grows with the amplitude). */
  apply(center: Readonly<Vec3Data>): void {
    const radius = 9 + 5 * this.amplitude;
    LIGHT_DISTURBANCE.center.value.set(center.x, center.y, center.z, radius);
    LIGHT_DISTURBANCE.state.value.set(this.amplitude, this.levelA, this.levelB, this.time);
  }

  /** Lamps back to normal everywhere. */
  static clear(): void {
    LIGHT_DISTURBANCE.center.value.set(0, -1e5, 0, 1);
    LIGHT_DISTURBANCE.state.value.set(0, 1, 1, 0);
  }
}
