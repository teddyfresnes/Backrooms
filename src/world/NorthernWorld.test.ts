import { describe, expect, it } from 'vitest';
import { generateInfiniteChunk, getCanonicalEdgeGates, getNeighborChunkKey } from './InfiniteWorld';
import { isRedZoneRow, isSlidesStructureCoord, nearestSlidesCoord, NORTHERN_LAYOUT } from './NorthernLayout';
import { clearEventFootprint } from './EnvironmentEvents';
import { rectCenter, rectDepth, rectWidth } from './types';
import { findSurface, surfaceY } from './WalkableTopology';

describe('guaranteed red-zone slides and small lighting circuits', () => {
  it('reserves one unique owner per transverse sector exclusively inside red', () => {
    for(let x=-40;x<40;x++)for(const story of[-6,0,5]){
      const c=nearestSlidesCoord({x,story});expect(isRedZoneRow(c.z)).toBe(true);expect(isSlidesStructureCoord(c)).toBe(true);
      expect(Math.abs(c.x-x)).toBeLessThanOrEqual(2);expect(c.story).toBe(story);
    }
    for(const z of[-100,-6,-4,-3,0,10])expect(isSlidesStructureCoord({x:0,z})).toBe(false);
    expect(nearestSlidesCoord({x:1.6,story:0}).x).toBe(0);expect(nearestSlidesCoord({x:2.4,story:0}).x).toBe(4);
  });
  it('generates exactly four labelled entrances with prefixed IDs and walkable compass/locate approaches',()=>{
    for(const seed of['SLIDES-ONE','SLIDES-TWO'])for(const x of[-4,0,8])for(const story of[-2,1]){
      const owner={x,z:-5,story},p=generateInfiniteChunk(seed,owner),f=p.features.find(f=>f.kind==='slides-structure');
      expect(f?.kind).toBe('slides-structure');if(f?.kind!=='slides-structure')throw new Error('Missing landmark');
      expect(p.visualBiome).toBe('red');expect(f.entries.map(e=>e.label)).toEqual(['HOME','FUN :)','DEATH','DANGER']);
      expect(new Set(f.entries.map(e=>e.color)).size).toBe(4);expect(f.id).toBe(p.northern!.slides!.id);
      expect(f.entries.every(e=>e.id.startsWith(`chunk-${x}:-5:${story}/`))).toBe(true);
      expect(new Set(f.entries.map(e=>e.transitionKey)).size).toBe(4);
      const s=findSurface(p,{...f.approach,referenceY:0,maxAbove:.01,maxBelow:.01});expect(s?.access).toBe('open');expect(surfaceY(s!,0,12)).toBe(0);
      expect(p.spatial!.landmarks.find(l=>l.kind==='slides')?.position).toEqual(f.approach);
      expect(p.propPlacements?.some(p=>p.roomId===f.roomId)).toBe(false);
      expect(structuredClone(p)).toEqual(p);
      for(const side of['north','south','east','west'] as const){const opposite={north:'south',south:'north',east:'west',west:'east'} as const;
        const gates=getCanonicalEdgeGates(seed,owner,side);expect(gates.length).toBeGreaterThan(0);
        expect(gates).toEqual(getCanonicalEdgeGates(seed,getNeighborChunkKey(owner,side),opposite[side]));expect(gates.every(g=>g.floorY===0)).toBe(true);
      }
    }
  },90000);
  it('keeps normal red circuits between landmarks and never generates slides outside the reserved band',()=>{
    for(const z of[-6,-5,-4,0])for(const x of[-1,0,1]){
      const p=generateInfiniteChunk('SLIDES-ONLY-RED',{x,z,story:0});
      expect(p.features.some(f=>f.kind==='slides-structure')).toBe(isSlidesStructureCoord({x,z}));
      if(isRedZoneRow(z)&&!isSlidesStructureCoord({x,z})){
        expect(p.northern!.circuits.length).toBeGreaterThan(0);
        for(const c of p.northern!.circuits){expect(c.mount).toBeDefined();expect(rectWidth(c.bounds)).toBeLessThanOrEqual(10.00001);expect(rectDepth(c.bounds)).toBeLessThanOrEqual(10.00001);}
      }
      if(!isRedZoneRow(z))expect(p.northern?.slides).toBeUndefined();
    }
  },90000);
  it('keeps small occasional pre-rift dark patches without gating the route',()=>{
    let patches=0;
    for(let i=0;i<12;i++)for(const c of generateInfiniteChunk(`AMBIENT-NORTH-${i}`,{x:0,z:0,story:0}).northern!.circuits){
      patches++;expect(c.mode).toBe('ambient');expect(c.mount).toBeUndefined();expect(rectWidth(c.bounds)).toBeLessThanOrEqual(6.00001);expect(rectDepth(c.bounds)).toBeLessThanOrEqual(6.00001);
      const p=generateInfiniteChunk(`AMBIENT-NORTH-${i}`,{x:0,z:0,story:0}),m=rectCenter(c.bounds);
      expect(clearEventFootprint(p,{minX:m.x-.3,maxX:m.x+.3,minZ:m.z-.3,maxZ:m.z+.3},c.floorY)).toBe(true);
    }
    expect(patches).toBeGreaterThan(0);expect(patches).toBeLessThan(12);expect(NORTHERN_LAYOUT.riftRow).toBe(-3);
  },90000);
});
