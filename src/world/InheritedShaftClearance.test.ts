import { expect, it } from 'vitest';
import { generateLegacyInfiniteChunk, inheritedShaftOpeningsForChunk } from './InfiniteWorld';

it('keeps enclosure walls clear of every inherited shaft, including claims from other source stories', () => {
  // The relocated rift made the legacy audit reach this previously hidden case.
  const seed = 'SHAFT-AUDIT', coord = { x: -6, z: 0, story: -11 };
  const plan = generateLegacyInfiniteChunk(seed, coord), openings = inheritedShaftOpeningsForChunk(seed, coord);
  const walls = plan.walls.filter(w => w.id.includes('/inherited-shaft-enclosure-'));
  expect(walls.length).toBeGreaterThan(4);
  for (const wall of walls) {
    const hx = (wall.orientation === 'x' ? wall.length : wall.thickness) / 2;
    const hz = (wall.orientation === 'z' ? wall.length : wall.thickness) / 2;
    expect(openings.some(o => wall.x + hx > o.minX && wall.x - hx < o.maxX
      && wall.z + hz > o.minZ && wall.z - hz < o.maxZ), wall.id).toBe(false);
    expect(plan.colliders.some(c => c.id.endsWith(`/collider-${wall.id.split('/').at(-1)}`))).toBe(true);
  }
});
