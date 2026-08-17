import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { MaterialSet } from './MaterialLibrary';
import {
  applyZonalLighting,
  createFluorescentLightField,
  createZonalLightingContext,
  createZonalMaterialSet,
  shaderUnlitZones,
  signedDistanceInsideRect,
  unlitZoneInfluence,
} from './ZonalLighting';
import type { Rect, WorldPlan } from '../world/types';

const zone: Rect = { minX: -4, minZ: -3, maxX: 6, maxZ: 5 };

const planWithZones = (zones: Rect[], visualBiome: WorldPlan['visualBiome'] = 'yellow'): WorldPlan => ({
  version: 1,
  seed: 'ZONAL-LIGHTING-AUDIT',
  size: 112,
  wallHeight: 2.74,
  rooms: [],
  walls: [],
  columns: [],
  solidMasses: [],
  lights: [],
  missingCeilingTiles: [],
  features: [],
  detailSockets: [],
  colliders: [],
  floorRects: [{ minX: -56, minZ: -56, maxX: 56, maxZ: 56 }],
  spawn: { x: 0, y: 0.865, z: 0 },
  unlitZones: zones,
  visualBiome,
});

const testMaterials = (): MaterialSet => ({
  wall: new THREE.MeshStandardMaterial(),
  plaster: new THREE.MeshStandardMaterial(),
  floor: new THREE.MeshStandardMaterial(),
  ceiling: new THREE.MeshStandardMaterial(),
  baseboard: new THREE.MeshStandardMaterial(),
  pitWall: new THREE.MeshStandardMaterial(),
  pitBottom: new THREE.MeshStandardMaterial(),
  metal: new THREE.MeshStandardMaterial(),
  fixtureFrame: new THREE.MeshStandardMaterial(),
  fixtureGlow: new THREE.MeshBasicMaterial(),
  void: new THREE.MeshBasicMaterial(),
});

describe('zonal blackout field', () => {
  it('uses a continuous signed distance at room edges', () => {
    expect(signedDistanceInsideRect(0, 0, zone)).toBe(3);
    expect(signedDistanceInsideRect(-4, 0, zone)).toBe(0);
    expect(signedDistanceInsideRect(-5.5, 0, zone)).toBe(-1.5);

    expect(unlitZoneInfluence([zone], 0, 0)).toBe(1);
    expect(unlitZoneInfluence([zone], -4, 0)).toBeCloseTo(0.5, 6);
    expect(unlitZoneInfluence([zone], -5, 0)).toBe(0);
    expect(unlitZoneInfluence([zone], -3.64, 0)).toBeGreaterThan(0.5);
    expect(unlitZoneInfluence([zone], -4.36, 0)).toBeLessThan(0.5);
  });

  it('unions adjoining dark rooms without a bright seam', () => {
    const adjoining = { minX: 6, minZ: -3, maxX: 12, maxZ: 5 };
    expect(unlitZoneInfluence([zone, adjoining], 5.9, 0)).toBeGreaterThan(0.7);
    expect(unlitZoneInfluence([zone, adjoining], 6, 0)).toBeCloseTo(0.75, 6);
    expect(unlitZoneInfluence([zone, adjoining], 6.1, 0)).toBeGreaterThan(0.5);
  });

  it('caps the shader field to its fixed WebGL uniform budget', () => {
    const zones = Array.from({ length: 12 }, (_, index) => ({
      minX: index,
      minZ: index,
      maxX: index + 1,
      maxZ: index + 1,
    }));
    expect(shaderUnlitZones(zones)).toHaveLength(8);
  });
});

describe('zonal fluorescent materials', () => {
  it('builds compact exposure and structural-contact fields', () => {
    const plan = planWithZones([]);
    plan.walls.push({
      id: 'contact-wall',
      x: 0,
      z: 0,
      length: 10,
      orientation: 'z',
      bottom: 0,
      height: plan.wallHeight,
      thickness: 0.24,
      tint: 1,
      collision: true,
      kind: 'wallpaper',
    });
    plan.lights.push({
      id: 'test-light',
      x: 0,
      ceilingY: plan.wallHeight,
      z: 0,
      rotation: 0,
      width: 1.55,
      intensity: 1.1,
      color: 0xfff4d1,
      dead: false,
      unstable: false,
      phase: 0,
      roomId: 'test-room',
      level: 0,
    });
    const field = createFluorescentLightField(plan);
    plan.visualBiome = 'dim';
    const dimField = createFluorescentLightField(plan);
    const pixels = field.image.data as Uint8Array;
    const dimPixels = dimField.image.data as Uint8Array;
    const exposure = pixels.filter((_, index) => index % 2 === 0);
    const dimExposure = dimPixels.filter((_, index) => index % 2 === 0);
    const contact = pixels.filter((_, index) => index % 2 === 1);
    expect(field.image.width).toBe(96);
    expect(field.image.height).toBe(96);
    expect(field.format).toBe(THREE.RGFormat);
    expect(Math.max(...exposure)).toBeGreaterThan(Math.min(...exposure));
    expect(Math.max(...exposure)).toBeGreaterThan(Math.max(...dimExposure));
    expect(Math.max(...contact)).toBeGreaterThan(Math.min(...contact));
    expect(field.generateMipmaps).toBe(false);
    field.dispose();
    dimField.dispose();
  });

  it('removes lightmaps and installs a world-anchored, story-gated shader', () => {
    const source = testMaterials();
    const created = createZonalMaterialSet(source, planWithZones([zone], 'red'));
    const wall = created.materials.wall;
    expect(wall).not.toBe(source.wall);
    expect(wall.lightMap).toBeNull();
    expect(wall.name).toBe('-zonal');
    expect(wall.userData.zonalLighting).toMatchObject({ zoneCount: 1 });
    expect(wall.customProgramCacheKey()).toContain('zonal-fluorescent-lighting');

    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <opaque_fragment>',
    } as Parameters<typeof wall.onBeforeCompile>[0];
    wall.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain('vZonalWorldPosition');
    expect(shader.fragmentShader).toContain('chunkWorldOffset');
    expect(shader.fragmentShader).toContain('storyMask');
    expect(shader.fragmentShader).toContain('blackoutInfluence');
    expect(shader.fragmentShader).not.toContain('lightMapTexel');
    expect(shader.fragmentShader).toContain('mix(lightPoolMin, lightPoolMax, localExposure)');
    expect((shader.uniforms.lightPoolMin as THREE.IUniform<number>).value).toBeCloseTo(0.5);
    expect((shader.uniforms.lightPoolMax as THREE.IUniform<number>).value).toBeCloseTo(1.42);
    expect((shader.uniforms.litGain as THREE.IUniform<number>).value).toBeCloseTo(1.02);
    expect((shader.uniforms.verticalRelief as THREE.IUniform<number>).value).toBeCloseTo(0.12);

    created.ownedMaterials.forEach((material) => material.dispose());
    Object.values(source).forEach((material) => material.dispose());
  });

  it('preserves the previous darker modern calibration in the rare dim biome', () => {
    const source = testMaterials();
    const created = createZonalMaterialSet(source, planWithZones([], 'dim'));
    const wall = created.materials.wall;
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <opaque_fragment>',
    } as Parameters<typeof wall.onBeforeCompile>[0];
    wall.onBeforeCompile(shader, {} as THREE.WebGLRenderer);

    expect((shader.uniforms.lightPoolMin as THREE.IUniform<number>).value).toBeCloseTo(0.56);
    expect((shader.uniforms.lightPoolMax as THREE.IUniform<number>).value).toBeCloseTo(1.05);
    expect((shader.uniforms.litGain as THREE.IUniform<number>).value).toBeCloseTo(0.96);
    expect((shader.uniforms.fluorescentLift as THREE.IUniform<number>).value).toBeCloseTo(0.009);

    created.ownedMaterials.forEach((material) => material.dispose());
    Object.values(source).forEach((material) => material.dispose());
  });

  it('shares a mutable chunk origin across every material', () => {
    const context = createZonalLightingContext(planWithZones([zone]));
    context.worldOffset.set(112, 5.4, -224);
    expect(context.worldOffset.toArray()).toEqual([112, 5.4, -224]);
    expect(context.zoneMinY).toBeLessThan(0);
    expect(context.zoneMaxY).toBeGreaterThan(2.74);
  });

  it('decorates basic materials used by graffiti without requiring normals', () => {
    const context = createZonalLightingContext(planWithZones([zone]));
    const material = new THREE.MeshBasicMaterial();
    applyZonalLighting(material, context);
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <opaque_fragment>',
    } as Parameters<typeof material.onBeforeCompile>[0];
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).not.toContain('objectNormal');
    expect(shader.fragmentShader).toContain('blackoutInfluence');
    expect(material.customProgramCacheKey()).toContain('basic');
    material.dispose();
  });
});
