import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeApartmentWindowGlassTransparent } from './ImportedApartmentEnvironment';

const loadNodeFs = async () => {
  // Test-only builtin; the browser tsconfig intentionally omits Node globals.
  // @ts-expect-error Node typings are not a production dependency.
  return import('node:fs/promises');
};

interface SerializedObject {
  name?: string;
  children?: SerializedObject[];
}

const objectNames = (root: SerializedObject): string[] => [
  root.name ?? '',
  ...(root.children ?? []).flatMap(objectNames),
];

describe('imported apartment integration', () => {
  it('ships the attributed apartment without unlicensed editor additions', async () => {
    const { readFile } = await loadNodeFs();
    const file = new URL('../../public/assets/imported-apartment/apartment.json', import.meta.url);
    const data = JSON.parse(await readFile(file, 'utf8')) as { object: SerializedObject };
    const names = objectNames(data.object);

    expect(data.object.name).toBe('ImportedApartmentScene_v1.19.2');
    expect(data.object.children?.map((child) => child.name)).toEqual([
      'Sketchfab_model_v1.19.1_EDITABLE',
    ]);
    expect(names).toEqual(expect.arrayContaining([
      'DOOR',
      'Doorframe',
      'bathroom_door',
      'closet_door',
      'Base',
    ]));
    expect(names).not.toContain('world');
  });

  it('keeps imported frame stabilization and only the entrance interactive', async () => {
    const { readFile } = await loadNodeFs();
    const environment = await readFile(
      new URL('./ImportedApartmentEnvironment.ts', import.meta.url),
      'utf8',
    );
    const runtime = await readFile(
      new URL('../core/RussianStairwellGame.ts', import.meta.url),
      'utf8',
    );

    expect(environment).toContain('forceOpaqueTwoSided(entryLeaf)');
    expect(environment).toContain('stabilizeDoorFrame(entryFrame)');
    expect(environment).toContain('clone.polygonOffset = true');
    expect(environment).toContain("'imported-bathroom-door-static'");
    expect(environment).toContain("'imported-closet-door-static'");
    expect(runtime).toContain("chunkKey: 'imported-apartment-entry-door'");
    expect(runtime).not.toContain("chunkKey: 'imported-bathroom-door'");
  });

  it('replaces only the apartment window panes with clear glass', () => {
    const root = new THREE.Group();
    const pane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: 0x000000 }),
    );
    pane.name = 'polySurface16_M_MainParts_0';
    const frame = pane.clone();
    frame.name = 'polySurface15_M_MainParts_0';
    root.add(pane, frame);

    makeApartmentWindowGlassTransparent(root);

    const glass = pane.material as unknown as THREE.MeshBasicMaterial;
    expect(glass.name).toBe('apartment-window-clear-glass');
    expect(glass.transparent).toBe(true);
    expect(glass.opacity).toBe(0.02);
    expect(glass.depthWrite).toBe(false);
    expect(glass.toneMapped).toBe(false);
    expect(frame.material).not.toBe(glass);
  });
});
