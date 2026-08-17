import { describe, expect, it } from 'vitest';
import { STAIRWELL_LIGHTING_PROFILES } from './StairwellEnvironment';

const loadNodeFs = async () => {
  // Test-only builtin; the browser tsconfig intentionally omits Node globals.
  // @ts-expect-error Node typings are not a production dependency.
  return import('node:fs/promises');
};

describe('Russian stairwell render integration', () => {
  it('uses the imported apartment leaf and frame on neighboring landings', async () => {
    const { readFile } = await loadNodeFs();
    const stairwell = await readFile(new URL('./StairwellEnvironment.ts', import.meta.url), 'utf8');
    const apartment = await readFile(
      new URL('../apartment/ImportedApartmentEnvironment.ts', import.meta.url),
      'utf8',
    );

    expect(stairwell).not.toContain('this.buildStaticDoors();');
    expect(stairwell).toContain("addApartmentDoorWall('west', level)");
    expect(stairwell).toContain("addApartmentDoorWall('east', level)");
    expect(stairwell).toContain('this.hallEntranceDoor = hallDoor');
    expect(stairwell).toContain('this.markHierarchyNoBatch(hallDoor)');
    expect(stairwell).toContain('paintOpeningMinZ');
    expect(apartment).toContain("const entryFrame = requireObject(this.model, 'Doorframe')");
    expect(apartment).toContain('this.addNeighborApartmentDoors(entryLeaf, entryFrame)');
    expect(apartment).toContain('const sourceAbsX = Math.abs(sourceCenter.x)');
  });

  it('keeps all visual variation on the deterministic random source', async () => {
    const { readFile } = await loadNodeFs();
    const stairwell = await readFile(new URL('./StairwellEnvironment.ts', import.meta.url), 'utf8');
    expect(stairwell).not.toContain('Math.random');
    expect(stairwell).toContain('SeededRandom');
  });

  it('keeps the exterior rain muted against the night sky', async () => {
    const { readFile } = await loadNodeFs();
    const stairwell = await readFile(new URL('./StairwellEnvironment.ts', import.meta.url), 'utf8');

    expect(stairwell).toContain('color: 0x8296a8');
    expect(stairwell).toContain('opacity: 0.24');
    expect(stairwell).not.toContain('material.color.set(0xc7d2d8)');
    expect(stairwell).not.toContain('material.opacity = 0.3');
  });

  it('adds a physical collider for the second-floor window table', async () => {
    const { readFile } = await loadNodeFs();
    const [stairwell, runtime] = await Promise.all([
      readFile(new URL('./StairwellEnvironment.ts', import.meta.url), 'utf8'),
      readFile(new URL('../core/RussianStairwellGame.ts', import.meta.url), 'utf8'),
    ]);

    expect(stairwell).toContain("colliderFromVisibleObject('second-floor-window-table', table)");
    expect(runtime).toContain("'stairwell-furniture'");
    expect(runtime).toContain('environment.furnitureColliders');
  });

  it('uses nearly clear alpha glass so the rainy exterior remains visible', async () => {
    const { readFile } = await loadNodeFs();
    const stairwell = await readFile(new URL('./StairwellEnvironment.ts', import.meta.url), 'utf8');

    expect(stairwell).toContain('color: 0x000000');
    expect(stairwell).toContain('opacity: 0.004');
    expect(stairwell).toContain('depthWrite: false');
    expect(stairwell).toContain('maxX: -10.24');
    expect(stairwell).toContain("'apartment-window-view-building-silhouette'");
    expect(stairwell).toContain("'apartment-window-view-background-silhouette'");
    expect(stairwell).toContain("'apartment-view-building-black'");
    expect(stairwell).toContain('[-21.6, 7.75, 3.2]');
    expect(stairwell).toContain('[4.2, 19, 140]');
    expect(stairwell).toContain('[-29, 9.5, 18]');
    expect(stairwell).not.toContain('apartment-window-view-building-window-');
  });

  it('forbids PBR reflections and procedural light glints on hall windows', async () => {
    const { readFile } = await loadNodeFs();
    const stairwell = await readFile(new URL('./StairwellEnvironment.ts', import.meta.url), 'utf8');

    expect(stairwell).toContain('`${name}-reflection-free-glass`');
    expect(stairwell).toContain('return this.createExtraBasicMaterial');
    expect(stairwell).not.toContain('this.installWindowRainShader(clone');
    expect(stairwell).not.toContain('clone.roughness = 0.02;');
    expect(stairwell).not.toContain("'exterior-lamp-glow'");
  });

  it('renders the exterior as a shadowed night scene', async () => {
    const { readFile } = await loadNodeFs();
    const [stairwell, runtime] = await Promise.all([
      readFile(new URL('./StairwellEnvironment.ts', import.meta.url), 'utf8'),
      readFile(new URL('../core/RussianStairwellGame.ts', import.meta.url), 'utf8'),
    ]);

    expect(runtime).toContain('this.renderer.shadowMap.enabled = true');
    expect(runtime).toContain('THREE.PCFSoftShadowMap');
    expect(stairwell).toContain("moon.name = 'exterior-night-moon-key'");
    expect(stairwell).toContain('moon.castShadow = true');
    expect(stairwell).toContain('new THREE.SpotLight(');
    expect(stairwell).toContain('streetLamp.castShadow = true');
    expect(stairwell).toContain('configureExteriorShadowCasters');
    expect(stairwell).toContain('color: 0x2d3943');
  });

  it('uses source-focused modern lights instead of the flat classic profile', async () => {
    const { readFile } = await loadNodeFs();
    const runtime = await readFile(new URL('../core/RussianStairwellGame.ts', import.meta.url), 'utf8');
    const modern = STAIRWELL_LIGHTING_PROFILES.modern;
    const legacy = STAIRWELL_LIGHTING_PROFILES.legacy;

    expect(modern.mainIntensity).toBeGreaterThan(legacy.mainIntensity);
    expect(modern.wallIntensity).toBeGreaterThan(legacy.wallIntensity);
    expect(modern.corridorFillIntensity).toBeLessThan(legacy.corridorFillIntensity);
    expect(modern.stairWashIntensity).toBeLessThan(legacy.stairWashIntensity);
    expect(modern.mainColor).not.toBe(legacy.mainColor);
    expect(runtime).toContain('environment.setLightingMode(this.settings.lighting)');
    expect(runtime).toContain('this.environment?.setLightingMode(settings.lighting)');
    expect(runtime).toContain('{ bloom: false }');
  });
});
