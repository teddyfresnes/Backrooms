import { describe, expect, it } from 'vitest';
import { generateInfiniteChunk } from './InfiniteWorld';
import { epicStructureIndexForCoord } from './EpicStructures';
import { isRedZoneRow, NORTHERN_LAYOUT } from './NorthernLayout';
import { clearEventFootprint } from './EnvironmentEvents';
import { rectCenter, rectDepth, rectWidth } from './types';
import { findSurface, surfaceY } from './WalkableTopology';
import { populateNorthernWorld } from './NorthernWorld';
import { environmentFixture } from '../../tests/support/environment-fixture';

describe('guaranteed northern progression bands', () => {
  it('keeps the main destination when only a low open gallery is available', () => {
    const plan = environmentFixture('telephone'); plan.environmentEvents = [];
    plan.rooms[0]!.ceilingHeight = 2.5;
    plan.spatial = { version:2,owner:{x:7,z:-6,story:3},cells:[],ceilings:[],prisms:[],dependencies:[],interfaces:[],landmarks:[],transitions:[] };
    populateNorthernWorld(plan, 'GALLERY-FALLBACK', plan.spatial.owner);
    expect(plan.northern?.slides?.position).toEqual({x:0,y:0,z:0});
    expect(plan.spatial.landmarks[0]?.position.y).toBe(.865);
  });
  it('reserves both red rows and the slides approach in every transverse column and story', () => {
    for (const seed of ['NORTH-ONE', 'NORTH-TWO', 'NORTH-THREE']) for (const x of [-9, 0, 8]) for (const z of [-4, -5, -6]) {
      const owner = { x, z, story: x % 3 }, plan = generateInfiniteChunk(seed, owner), north = plan.northern!;
      expect(epicStructureIndexForCoord(seed, owner)).toBeNull();
      expect(north, `${seed}/${JSON.stringify(owner)}`).toBeDefined();
      expect(north.kind).toBe(isRedZoneRow(z) ? 'red-zone' : 'slides-approach');
      expect(plan.environmentEvents).toHaveLength(0);
      if (isRedZoneRow(z)) {
        expect(plan.visualBiome).toBe('red');
        expect(north.circuits.length, `${seed}/${x}/${z} rooms=${plan.rooms.length}`).toBeGreaterThan(0);
        expect(north.circuits.length).toBeLessThanOrEqual(2);
        for (const c of north.circuits) {
          expect(rectWidth(c.bounds)).toBeLessThanOrEqual(10.000001); expect(rectDepth(c.bounds)).toBeLessThanOrEqual(10.000001);
          expect(c.id).toMatch(new RegExp(`^chunk-${x}:${z}:${owner.story}/`));
          expect(plan.walls.some(w => w.id === c.mount?.wallId)).toBe(true);
          const m = c.mount!, p = { x:m.position.x+Math.sin(m.yaw)*.9,z:m.position.z+Math.cos(m.yaw)*.9 };
          expect(clearEventFootprint(plan,{minX:p.x-.35,maxX:p.x+.35,minZ:p.z-.35,maxZ:p.z+.35},c.floorY)).toBe(true);
          expect(plan.propPlacements?.some(p => p.roomId === c.roomId)).toBe(false);
        }
      } else {
        expect(north.slides, `${seed}/${x} rooms=${plan.rooms.length}`).toBeDefined();
        const p = north.slides!.position, s = findSurface(plan,{x:p.x,z:p.z,referenceY:p.y+.1,maxAbove:.05,maxBelow:.25});
        expect(s?.access).toBe('open'); expect(surfaceY(s!,p.x,p.z)).toBeCloseTo(p.y);
        expect(plan.spatial!.landmarks.some(l => l.kind === 'slides')).toBe(true);
        expect(plan.propPlacements?.some(p => p.roomId === north.slides!.roomId)).toBe(false);
      }
    }
  }, 90000);
  it('restores small occasional pre-rift dark patches without gating the route', () => {
    let patches = 0;
    for (let i = 0; i < 12; i++) {
      const plan = generateInfiniteChunk(`AMBIENT-NORTH-${i}`, { x: 0, z: 0, story: 0 });
      for (const c of plan.northern!.circuits) {
        patches++; expect(c.mode).toBe('ambient'); expect(c.mount).toBeUndefined();
        expect(rectWidth(c.bounds)).toBeLessThanOrEqual(6.000001); expect(rectDepth(c.bounds)).toBeLessThanOrEqual(6.000001);
        expect(clearEventFootprint(plan, { minX:rectCenter(c.bounds).x-.3,maxX:rectCenter(c.bounds).x+.3,minZ:rectCenter(c.bounds).z-.3,maxZ:rectCenter(c.bounds).z+.3 }, c.floorY)).toBe(true);
      }
    }
    expect(patches).toBeGreaterThan(0); expect(patches).toBeLessThan(12);
    expect(NORTHERN_LAYOUT.riftRow).toBe(-3);
  }, 90000);
});
