import * as THREE from 'three';
import type { WorldPlan } from '../world/types';

/** Separate holders from the hunter's disturbance: simultaneous events never
 * overwrite global lighting or a neighbouring room's lamps, in either mode. */
export class EnvironmentLighting {
  readonly offset = { value: new THREE.Vector3() };
  readonly slots: { id: string; bounds: THREE.Vector4; height: THREE.Vector4; lamp: THREE.Vector4 }[];
  private readonly decorated = new WeakSet<THREE.Material>();
  constructor(plan: WorldPlan) {
    this.slots = (plan.environmentEvents ?? []).filter(e => e.kind === 'flicker' || e.kind === 'fire-alarm').map(e => ({
      id: e.id, bounds: new THREE.Vector4(e.bounds.minX, e.bounds.minZ, e.bounds.maxX, e.bounds.maxZ),
      // z circuit level, w red pulse. min/max Y clip the actual room volume.
      height: new THREE.Vector4(e.floorY - .08, e.ceilingY + .08, 1, 0),
      lamp: new THREE.Vector4(e.mount?.position.x ?? 0, e.mount?.position.y ?? 0, e.mount?.position.z ?? 0, 7),
    }));
  }
  set(id: string, level: number, red = 0): void {
    const slot = this.slots.find(s => s.id === id);
    if (slot) { slot.height.z = level; slot.height.w = red; }
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
      Object.assign(shader.uniforms, { envOffset: this.offset,
        envBounds: { value: this.slots.map(s => s.bounds) }, envHeight: { value: this.slots.map(s => s.height) },
        envLamps: { value: this.slots.map(s => s.lamp) } });
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
        uniform vec4 envBounds[${this.slots.length}];
        uniform vec4 envHeight[${this.slots.length}];
        uniform vec4 envLamps[${this.slots.length}];`)
        .replace('#include <opaque_fragment>', `
          vec3 ep = vEnvironmentWorld - envOffset;
          for (int i = 0; i < ${this.slots.length}; i++) {
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
    material.customProgramCacheKey = () => `${key()}|environment-light-v1-${this.slots.length}`;
    material.needsUpdate = true;
  }
}
