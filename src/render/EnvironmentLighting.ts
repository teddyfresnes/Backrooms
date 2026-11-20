import * as THREE from 'three';
import type { WorldPlan } from '../world/types';

/** Light sources per chunk (events are 36 m apart: a chunk holds a few at most). */
export const ENVIRONMENT_LIGHT_SLOTS = 8;
interface EnvironmentLightSlot { id: string; primary: boolean; bounds: THREE.Vector4; height: THREE.Vector4; lamp: THREE.Vector4 }
/** Separate holders from the hunter's disturbance: simultaneous events never
 * overwrite global lighting or a neighbouring room's lamps, in either mode. */
export class EnvironmentLighting {
  readonly offset = { value: new THREE.Vector3() };
  /** One slot per light source: each alarm unit adds its own red pulse. */
  readonly slots: EnvironmentLightSlot[];
  private readonly decorated = new WeakSet<THREE.Material>();
  constructor(plan: WorldPlan) {
    this.slots = (plan.environmentEvents ?? []).filter(e => e.kind === 'flicker' || e.kind === 'fire-alarm').flatMap(e => {
      const lamps = e.kind === 'fire-alarm' && e.mount ? [e.mount, ...(e.extraMounts ?? [])] : [e.mount];
      return lamps.map((m, i) => ({
        id: e.id, primary: i === 0, bounds: new THREE.Vector4(e.bounds.minX, e.bounds.minZ, e.bounds.maxX, e.bounds.maxZ),
        // z circuit level, w red pulse. min/max Y clip the actual room volume.
        height: new THREE.Vector4(e.floorY - .08, e.ceilingY + .08, 1, 0),
        lamp: new THREE.Vector4(m?.position.x ?? 0, m?.position.y ?? 0, m?.position.z ?? 0, 7),
      }));
    }).slice(0, ENVIRONMENT_LIGHT_SLOTS);
    // Fixed-size arrays and a count uniform: every decorated chunk shares one
    // program, whatever its number of events (no compile when one is found).
    const pad = (pick: (s: EnvironmentLightSlot) => THREE.Vector4) =>
      Array.from({ length: ENVIRONMENT_LIGHT_SLOTS }, (_, i) => this.slots[i] ? pick(this.slots[i]) : new THREE.Vector4());
    this.uniforms = { envOffset: this.offset, envCount: { value: this.slots.length },
      envBounds: { value: pad(s => s.bounds) }, envHeight: { value: pad(s => s.height) }, envLamps: { value: pad(s => s.lamp) } };
  }
  private readonly uniforms: Record<string, THREE.IUniform>;
  /** Whether this chunk's materials receive any local event lighting. */
  get active(): boolean { return this.slots.length > 0; }
  /** The circuit level dims the zone once (first slot); every unit pulses red. */
  set(id: string, level: number, red = 0): void {
    for (const slot of this.slots) if (slot.id === id) { slot.height.z = slot.primary ? level : 1; slot.height.w = red; }
  }
  decorate(root: THREE.Object3D): void {
    if (!this.slots.length) return;
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) this.apply(material);
    });
  }
  apply(material: THREE.Material): void {
    if (!this.slots.length || this.decorated.has(material)) return;
    if (!(material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshBasicMaterial)) return;
    this.decorated.add(material);
    const before = material.onBeforeCompile.bind(material), key = material.customProgramCacheKey.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
      before(shader, renderer);
      // Safety for a material shared by two chunk views: inject once, never twice.
      if (shader.vertexShader.includes('vEnvironmentWorld')) return;
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vEnvironmentWorld;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vEnvironmentWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          #else
            vEnvironmentWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
          #endif`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vEnvironmentWorld;
        uniform vec3 envOffset;
        uniform int envCount;
        uniform vec4 envBounds[${ENVIRONMENT_LIGHT_SLOTS}];
        uniform vec4 envHeight[${ENVIRONMENT_LIGHT_SLOTS}];
        uniform vec4 envLamps[${ENVIRONMENT_LIGHT_SLOTS}];`)
        .replace('#include <opaque_fragment>', `
          vec3 ep = vEnvironmentWorld - envOffset;
          for (int i = 0; i < ${ENVIRONMENT_LIGHT_SLOTS}; i++) {
            if (i >= envCount) break;
            vec4 b = envBounds[i], h = envHeight[i], lamp = envLamps[i];
            float edge = min(min(ep.x-b.x, b.z-ep.x), min(ep.z-b.y, b.w-ep.z));
            float mask = smoothstep(-0.015, 0.06, edge) * step(h.x, ep.y) * step(ep.y, h.y);
            outgoingLight *= mix(1.0, h.z, mask);
            float d = distance(ep, lamp.xyz);
            float red = (1.0-smoothstep(lamp.w*.5, lamp.w, d)) / (1.0+d*d*.18);
            outgoingLight += vec3(.95, .008, .002) * h.w * red * mask;
          }
          #include <opaque_fragment>`);
    };
    material.customProgramCacheKey = () => `${key()}|environment-light-v2`;
    material.needsUpdate = true;
  }
}
