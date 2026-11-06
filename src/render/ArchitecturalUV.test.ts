import { expect, it } from 'vitest';
import { createWalkableGeometry } from './WalkableGeometry';
import { createSpatialPrismGeometry } from './SpatialGeometry';
import { profilePrism } from '../world/SpatialGeometry';
import type { WalkableSurface } from '../world/WalkableTopology';
const floor: WalkableSurface = { id: 'floor', bounds: { minX: 0, maxX: 2.15, minZ: 0, maxZ: 2.15 }, profile: { kind: 'flat', y: 1.7 },
  ownerStory: 0, layer: 'test', role: 'floor', ceilingY: 4.44, thickness: .16, support: 'slab', access: 'open', edges: 'architecture' };

it('keeps the historical 2.15m carpet density and quarter-turn handedness', () => {
  for (const quarter of [false, true]) {
    const g = createWalkableGeometry(floor, 'top', 1, quarter), pos = g.getAttribute('position'), uv = g.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) {
      expect(uv.getX(i)).toBeCloseTo((quarter ? pos.getZ(i) : pos.getX(i)) / 2.15, 6);
      expect(uv.getY(i)).toBeCloseTo((quarter ? -pos.getX(i) : pos.getZ(i)) / 2.15, 6);
    }
    g.dispose();
  }
});

it('uses the same world texture phase after chunk translation and cropping', () => {
  const a = createWalkableGeometry(floor, 'top', 1, false, { x: 112, y: 5.4, z: -224 });
  const shifted = { ...floor, bounds: { minX: 112, maxX: 114.15, minZ: -224, maxZ: -221.85 } };
  const b = createWalkableGeometry(shifted, 'top');
  for (let i = 0; i < a.getAttribute('uv').count; i++) {
    expect(a.getAttribute('uv').getX(i)).toBeCloseTo(b.getAttribute('uv').getX(i), 5);
    expect(a.getAttribute('uv').getY(i)).toBeCloseTo(b.getAttribute('uv').getY(i), 5);
  }
  a.dispose(); b.dispose();
});

it('keeps nonzero UV area on both triangles of highly sloping structural caps', () => {
  const p = profilePrism('sloped', { minX: -7, maxX: 19, minZ: -5, maxZ: -4.2 },
    { kind: 'linear', axis: 'x', startY: -3, endY: 2 }, { kind: 'linear', axis: 'x', startY: -.2, endY: 4.8 });
  const g = createSpatialPrismGeometry(p), uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i += 3) {
    const area = (uv.getX(i + 1) - uv.getX(i)) * (uv.getY(i + 2) - uv.getY(i)) - (uv.getY(i + 1) - uv.getY(i)) * (uv.getX(i + 2) - uv.getX(i));
    expect(Math.abs(area), `triangle ${i / 3}`).toBeGreaterThan(.0001);
  }
  g.dispose();
});

it('keeps finish scales and rotations shared across the four chunks of a BSP district', async () => {
  const { generateInfiniteChunk } = await import('../world/InfiniteWorld');
  const a = generateInfiniteChunk('TEXTURE-SEAM-AUDIT', { x: -2, z: 0, story: -1 });
  const b = generateInfiniteChunk('TEXTURE-SEAM-AUDIT', { x: -1, z: 0, story: -1 });
  for (const name of ['floorPatternScale', 'floorQuarterTurn', 'wallPatternScale', 'ceilingPatternScale'] as const)
    expect(a.surfaceStyle![name]).toBe(b.surfaceStyle![name]);
});
