import * as THREE from 'three';
import type { WorldPlan } from '../world/types';

/** Switchable local mains supply. Native spotlights (the carried flashlight)
 * are separated before the ambient shaders, then added back in white. */
export class NorthernLighting {
  readonly offset = { value: new THREE.Vector3() };
  readonly tint: { value: THREE.Vector3 };
  readonly slots: { id: string; bounds: THREE.Vector4; height: THREE.Vector3 }[];
  private readonly decorated = new WeakSet<THREE.Material>();
  constructor(plan: WorldPlan) {
    this.tint = { value: plan.northern?.kind === 'red-zone' ? new THREE.Vector3(1, .028, .012) : new THREE.Vector3(1, 1, 1) };
    this.slots = (plan.northern?.circuits ?? []).map(c => ({ id: c.id,
      bounds: new THREE.Vector4(c.bounds.minX, c.bounds.minZ, c.bounds.maxX, c.bounds.maxZ),
      height: new THREE.Vector3(c.floorY - .08, c.ceilingY + .08, c.mode === 'ambient' ? 0 : 1) }));
  }
  /** Whether this chunk's materials receive local mains power or the red tint. */
  get active(): boolean { return this.slots.length > 0 || this.tint.value.y !== 1; }
  set(id: string, on: boolean): void { const s = this.slots.find(s => s.id === id); if (s) s.height.z = on ? 1 : 0; }
  powerAt(x: number, y: number, z: number): number {
    return this.slots.some(s => s.height.z === 0 && x >= s.bounds.x && x <= s.bounds.z && z >= s.bounds.y && z <= s.bounds.w
      && y >= s.height.x && y <= s.height.y) ? 0 : 1;
  }
  decorate(root: THREE.Object3D): void {
    root.traverse(o => { if (o instanceof THREE.Mesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) this.apply(m); });
  }
  apply(material: THREE.Material): void {
    if ((!this.slots.length && this.tint.value.y === 1) || this.decorated.has(material)
      || !(material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshBasicMaterial)) return;
    this.decorated.add(material);
    const before = material.onBeforeCompile.bind(material), key = material.customProgramCacheKey.bind(material);
    const standard = material instanceof THREE.MeshStandardMaterial, count = this.slots.length;
    // Authored slide enamel/signs keep their identifying colours in the red
    // hall, while retaining the same local mains and carried-spotlight logic.
    const tint = material.userData.northernPreserveColor ? { value: new THREE.Vector3(1,1,1) } : this.tint;
    material.onBeforeCompile = (shader, renderer) => {
      before(shader, renderer);
      // Safety for a material shared by two chunk views: inject once, never twice.
      if (shader.vertexShader.includes('vNorthernWorld')) return;
      Object.assign(shader.uniforms, { northernOffset: this.offset, northernTint: tint,
        ...(count ? { northernBounds: { value: this.slots.map(s => s.bounds) }, northernHeight: { value: this.slots.map(s => s.height) } } : {}) });
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vNorthernWorld;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vNorthernWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.)).xyz;
          #else
            vNorthernWorld = (modelMatrix * vec4(transformed, 1.)).xyz;
          #endif`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vNorthernWorld;
        uniform vec3 northernOffset;
        uniform vec3 northernTint;
        ${count ? `uniform vec4 northernBounds[${count}]; uniform vec3 northernHeight[${count}];` : ''}`);
      if (standard) {
        const lights = THREE.ShaderChunk.lights_fragment_begin
          .replace('#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )', `
            vec3 northernBeforeDiffuse = reflectedLight.directDiffuse;
            vec3 northernBeforeSpecular = reflectedLight.directSpecular;
            #if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )`)
          .replace('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )', `
            vec3 northernTorch = max(vec3(0.), reflectedLight.directDiffuse + reflectedLight.directSpecular - northernBeforeDiffuse - northernBeforeSpecular);
            reflectedLight.directDiffuse = northernBeforeDiffuse;
            reflectedLight.directSpecular = northernBeforeSpecular;
            #if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )`);
        shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', lights);
      }
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
        vec3 np = vNorthernWorld - northernOffset;
        float mainsPower = 1.;
        ${count ? `for (int i = 0; i < ${count}; i++) {
          vec4 b = northernBounds[i]; vec3 h = northernHeight[i];
          float inside = step(b.x, np.x) * step(np.x, b.z) * step(b.y, np.z) * step(np.z, b.w) * step(h.x, np.y) * step(np.y, h.y);
          mainsPower *= mix(1., h.z, inside);
        }` : ''}
        outgoingLight = outgoingLight * northernTint * mainsPower ${standard ? '+ northernTorch' : ''};
        #include <opaque_fragment>`);
      // Fog must not add the warm ambient colour back into a dead sector.
      shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', THREE.ShaderChunk.fog_fragment.replace('fogColor,', 'fogColor * northernTint * mainsPower,'));
    };
    material.customProgramCacheKey = () => `${key()}|northern-light-v1-${count}`;
    material.needsUpdate = true;
  }
}
