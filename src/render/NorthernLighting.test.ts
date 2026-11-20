import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { environmentFixture } from '../../tests/support/environment-fixture';
import { findEventWallMount } from '../world/EnvironmentEvents';
import { NorthernLighting } from './NorthernLighting';
import { applyZonalLighting, createZonalLightingContext } from './ZonalLighting';
import { createEnvironmentModel } from '../environment/EnvironmentModels';

describe('local mains supply with a working flashlight', () => {
  it('removes native spotlights before ambient processing, adds them back after blackout, and darkens fog/fixtures', () => {
    const plan = environmentFixture('telephone');
    plan.northern = { kind: 'red-zone', circuits: [{ id:'circuit',roomId:'room',bounds:{minX:-5,maxX:5,minZ:-5,maxZ:5},floorY:0,ceilingY:3.05,mode:'repair' }] };
    const lights = new NorthernLighting(plan), context = createZonalLightingContext(plan);
    for (const material of [new THREE.MeshStandardMaterial(), new THREE.MeshBasicMaterial()]) {
      if (material instanceof THREE.MeshStandardMaterial) applyZonalLighting(material, context);
      lights.apply(material); const key = material.customProgramCacheKey(); lights.apply(material); expect(material.customProgramCacheKey()).toBe(key);
      const source = material instanceof THREE.MeshStandardMaterial ? THREE.ShaderLib.physical : THREE.ShaderLib.basic;
      const shader = { vertexShader:source.vertexShader,fragmentShader:source.fragmentShader,uniforms:{} };
      material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
      expect(shader.fragmentShader).toContain('fogColor * northernTint * mainsPower');
      expect(shader.vertexShader).toContain('modelMatrix * instanceMatrix');
      expect(shader.fragmentShader).toContain('outgoingLight = outgoingLight * northernTint * mainsPower');
      if (material instanceof THREE.MeshStandardMaterial) {
        expect(shader.fragmentShader).toContain('reflectedLight.directDiffuse = northernBeforeDiffuse');
        expect(shader.fragmentShader).toContain('+ northernTorch');
        expect(shader.fragmentShader.indexOf('northernTorch =')).toBeLessThan(shader.fragmentShader.indexOf('outgoingLight ='));
      } else expect(shader.fragmentShader).not.toContain('northernTorch');
      material.dispose();
    }
    lights.set('circuit', false); expect(lights.powerAt(0,1.5,0)).toBe(0);
    expect(lights.powerAt(6,1.5,0)).toBe(1); expect(lights.powerAt(0,5,0)).toBe(1);
    lights.set('circuit',true); expect(lights.powerAt(0,1.5,0)).toBe(1); context.lightField.dispose();
  });
  it('compiles a diffuser shared by two red chunks with one injection', () => {
    const plan = environmentFixture('telephone'); plan.northern = { kind: 'red-zone', circuits: [] };
    const shared = new THREE.MeshBasicMaterial({ name: 'fluorescent-diffuser' });
    new NorthernLighting(plan).apply(shared); new NorthernLighting(plan).apply(shared);
    const shader = { vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader, uniforms: {} };
    shared.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader.split('varying vec3 vNorthernWorld;')).toHaveLength(2);
    expect(shader.fragmentShader.split('varying vec3 vNorthernWorld;')).toHaveLength(2);
    expect(new NorthernLighting(plan).active).toBe(true); shared.dispose();
  });
  it('builds a non-emissive wall lever with owned GPU resources', () => {
    const model = createEnvironmentModel('circuit-breaker','CIRCUIT'), geometry = new Set<THREE.BufferGeometry>(); let disposed = 0;
    expect(model.lever?.name).toBe('circuit-breaker-lever');
    model.root.traverse(o => { if (o instanceof THREE.Mesh) {
      if (!geometry.has(o.geometry)) { geometry.add(o.geometry); o.geometry.addEventListener('dispose',()=>disposed++); }
      expect((o.material as THREE.MeshStandardMaterial).emissiveIntensity * (o.material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(0);
    } });
    expect(findEventWallMount(environmentFixture('telephone'),environmentFixture('telephone').rooms[0]!,false)).toBeDefined();
    model.dispose(); expect(disposed).toBe(geometry.size);
  });
});
