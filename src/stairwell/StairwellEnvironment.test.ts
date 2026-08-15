import { describe, expect, it } from 'vitest';

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
});
