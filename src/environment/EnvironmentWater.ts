import * as THREE from 'three';
import { SeededRandom } from '../world/SeededRandom';
import { pointInRect, rectCenter, rectDepth, rectWidth } from '../world/types';
import type { Vec3Data, WorldPlan } from '../world/types';
import type { EnvironmentEventPlan } from '../world/EnvironmentEvents';
import { LIGHT_DISTURBANCE, LIGHT_DISTURBANCE_GLSL } from '../render/LightDisturbance';

export class EnvironmentWater {
  readonly root = new THREE.Group();
  readonly material: THREE.MeshPhysicalMaterial;
  private readonly time = { value: 0 };
  private readonly offset = { value: new THREE.Vector3() };
  private readonly rings = Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -100, 0));
  private cursor = 0;
  private readonly drops: { mesh: THREE.Mesh; source: Vec3Data; next: number; falling: number; random: SeededRandom }[] = [];
  constructor(readonly event: EnvironmentEventPlan, plan: WorldPlan) {
    this.root.name = 'shallow-water';
    this.material = new THREE.MeshPhysicalMaterial({ name: 'shallow-animated-water', color: 0x716d48, roughness: .16,
      metalness: .18, clearcoat: 1, clearcoatRoughness: .13, transparent: true, opacity: .48, depthWrite: false });
    const lamps = plan.lights.filter(l => event.lightIds.includes(l.id)).slice(0, 8).map(l => new THREE.Vector4(l.x, l.ceilingY - .03, l.z, l.intensity));
    while (lamps.length < 8) lamps.push(new THREE.Vector4(0, 0, 0, 0));
    this.material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, { waterTime: this.time, waterOffset: this.offset, waterRings: { value: this.rings }, waterLamps: { value: lamps } });
      shader.uniforms.lightDisturbCenter = LIGHT_DISTURBANCE.center;
      shader.uniforms.lightDisturbState = LIGHT_DISTURBANCE.state;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWaterWorld;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vWaterWorld;
        uniform float waterTime;
        uniform vec3 waterOffset;
        uniform vec4 waterRings[8];
        uniform vec4 waterLamps[8];
        ${LIGHT_DISTURBANCE_GLSL}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          vec2 w = vWaterWorld.xz;
          vec2 slope = vec2(cos(w.x*3.1+waterTime*.72)*.012, sin(w.y*4.2-waterTime*.55)*.012);
          for (int i = 0; i < 8; i++) {
            vec4 r = waterRings[i];
            float age = waterTime-r.z;
            vec2 d = w-r.xy; float dist = length(d);
            float wave = sin(dist*34.0-age*15.0) * exp(-abs(dist-age*.95)*13.0) * exp(-age*1.7);
            slope += normalize(d+vec2(.0001)) * wave * r.w * .055 * step(0.0,age) * step(age,2.5);
          }
          normal = normalize(normal + (viewMatrix * vec4(slope.x, 0.0, slope.y, 0.0)).xyz);`)
        .replace('#include <opaque_fragment>', `
          vec3 nWorld = inverseTransformDirection(normal, viewMatrix);
          vec3 reflected = reflect(normalize(vWaterWorld-cameraPosition), nWorld);
          float sheen = pow(1.0-max(0.0,dot(normalize(cameraPosition-vWaterWorld), nWorld)), 3.0);
          for (int i = 0; i < 8; i++) {
            vec4 lamp = waterLamps[i];
            vec3 lampWorld = lamp.xyz + waterOffset;
            float ray = (lampWorld.y-vWaterWorld.y)/max(.001, reflected.y);
            vec2 delta = (vWaterWorld+reflected*ray-lampWorld).xz;
            float panel = exp(-pow(abs(delta.x)/.95, 8.0)-pow(abs(delta.y)/.48, 8.0));
            outgoingLight += vec3(.95,.91,.72) * panel * sheen * .55 * step(.01, reflected.y) * step(.01,lamp.w);
          }
          outgoingLight *= lightDisturbSurface(vWaterWorld);
          #include <opaque_fragment>`);
    };
    this.material.customProgramCacheKey = () => 'shallow-water-reflections-v1';
    for (const b of event.waterRects ?? []) {
      const c = rectCenter(b), mesh = new THREE.Mesh(new THREE.PlaneGeometry(rectWidth(b), rectDepth(b)).rotateX(-Math.PI / 2), this.material);
      mesh.position.set(c.x, event.floorY + .035, c.z); mesh.renderOrder = 2; this.root.add(mesh);
    }
    for (const [i, source] of (event.drips ?? []).entries()) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(.009, 5, 4), new THREE.MeshBasicMaterial({ color: 0xa7b7ad, transparent: true, opacity: .58 }));
      mesh.scale.y = 3; mesh.visible = false; this.root.add(mesh);
      const random = new SeededRandom(event.seed).fork(`drip-${i}`);
      this.drops.push({ mesh, source, next: random.float(.5, 3.7), falling: -1, random });
    }
  }
  contains(local: Vec3Data): boolean {
    // The controller position is the capsule centre, .865m above the feet.
    return Math.abs(local.y - .865 - this.event.floorY) < .18 && (this.event.waterRects ?? []).some(b => pointInRect(local.x, local.z, b));
  }
  ripple(local: Vec3Data, time: number, strength = 1, offset: Vec3Data = { x: 0, y: 0, z: 0 }): void {
    this.rings[this.cursor++ % this.rings.length]!.set(local.x + offset.x, local.z + offset.z, time, strength);
  }
  update(delta: number, time: number, nearby: boolean, offset: Vec3Data, impact: (p: Vec3Data) => void): void {
    this.time.value = time;
    this.offset.value.copy(offset);
    for (const d of this.drops) {
      d.next -= delta;
      if (!nearby) { d.mesh.visible = false; d.falling = -1; if (d.next < 0) d.next = d.random.float(1, 4); continue; }
      if (d.falling < 0 && d.next <= 0) { d.falling = 0; d.mesh.visible = true; }
      if (d.falling < 0) continue;
      d.falling += delta;
      const y = d.source.y - 4.905 * d.falling * d.falling;
      d.mesh.position.set(d.source.x, y, d.source.z);
      if (y <= this.event.floorY + .035) {
        const p = { x: d.source.x, y: this.event.floorY + .035, z: d.source.z };
        this.ripple(p, time, .6, offset); impact(p);
        d.mesh.visible = false; d.falling = -1; d.next = d.random.float(.8, 5.5);
      }
    }
  }
  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    for (const d of this.drops) (d.mesh.material as THREE.Material).dispose();
    this.material.dispose(); this.root.clear();
  }
}
