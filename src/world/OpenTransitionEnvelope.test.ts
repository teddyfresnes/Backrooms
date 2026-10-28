import { expect, it } from 'vitest';
import * as THREE from 'three';
import { generateInfiniteChunk } from './InfiniteWorld';
import { fitTransitionEnvironment, planRegionalTransition } from './TransitionLayout';
import { hasRegionalTransition, openRoomComposition, regionalDatum, regionalStyle, spatialCellBounds } from './RegionalPlan';
import { prepareSpatialArchitecture, mountArchitectureBatch } from '../render/SpatialArchitectureBuffers';
import { createSpatialPrismGeometry } from '../render/SpatialGeometry';
import { rectCenter } from './types';
import { pointInRect } from './types';
import { surfaceY } from './WalkableTopology';
import { transitionSurfaces } from './TransitionSurfaces';
import { createWalkableBatch } from '../render/WalkableGeometry';

it('retains a fitting high room, opens the real slab otherwise, and reserves a private roof for an enclosure', () => {
  const make = () => planRegionalTransition('OPEN-ROOF', 0, 0, 0, 'east', spatialCellBounds(0, 0), 0, 1, 'test');
  const high = make(); fitTransitionEnvironment(high, 4, 5, [0, 0]);
  expect(high.roofPolicy).toBe('room'); expect(high.roof).toEqual({kind:'flat',y:4});
  expect(high.roomRoofJoin).toEqual({bottom:4.03,top:5});
  const overlapping = make();fitTransitionEnvironment(overlapping,4,4.02,[0,0]);expect(overlapping.roomRoofJoin).toBeUndefined();
  const low = make(); fitTransitionEnvironment(low, 2.74, 3.74, [0, 0]);
  expect(low.roofPolicy).toBe('upper-slab'); expect(low.enclosure).toBe('open'); expect(low.clearance).toBeGreaterThan(5);
  const enclosed = make(); fitTransitionEnvironment(enclosed, 2.74, 3.74, [.8, .8]);
  expect(enclosed.roofPolicy).toBe('flight'); expect(enclosed.enclosure).toBe('chamber');
  const material=new THREE.MeshBasicMaterial();
  try {
    for(const t of [high,low,enclosed]) {
      const geometry=transitionSurfaces(t,0); expect(geometry.ceilings.length>0).toBe(t.roofPolicy==='flight');
      if(t.roofPolicy!=='flight')continue;
      const under=createWalkableBatch(geometry.ceilings,'underside'),mesh=new THREE.Mesh(under,material);mesh.updateMatrixWorld();
      try {for(const sf of geometry.route){const p=rectCenter(sf.bounds),foot=surfaceY(sf,p.x,p.z),hit=new THREE.Raycaster(new THREE.Vector3(p.x,foot+.1,p.z),new THREE.Vector3(0,1,0),0,8).intersectObject(mesh)[0];
        expect(hit).toBeDefined();expect(hit!.point.y-foot).toBeGreaterThan(2.5);}}
      finally {under.dispose();}
    }
  } finally {material.dispose();}
});

it('mounts the final worker buffers with an opaque front-facing roof supplied by the correct actual owner', () => {
  const material = new THREE.MeshBasicMaterial(), policies = new Set<string>(); let probes = 0;
  try {
    for (let n = 0; n < 12; n++) {
      const w = generateInfiniteChunk(`REGIONAL-AUDIT-${n}`, {x:0,z:0,story:0});
      const upper = generateInfiniteChunk(w.seed, {x:0,z:0,story:1});
      const meshes = [w,upper].flatMap((plan, i) => prepareSpatialArchitecture(plan).map(batch => {
        const mesh = new THREE.Mesh(mountArchitectureBatch(batch), material); mesh.position.y = i * 5.4; mesh.updateMatrixWorld(); return mesh;
      }));
      try {
        for (const t of w.spatial!.transitions!) {
          policies.add(t.roofPolicy);
          expect(w.spatial!.ceilings.some(c=>c.id===t.id+'/roof')).toBe(t.roofPolicy==='flight');
          if (t.roofPolicy === 'upper-slab') expect(w.spatial!.dependencies.some(d=>d.owner.story===1 && d.reason==='stairs' && pointInRect(rectCenter(t.run).x,rectCenter(t.run).z,d.bounds))).toBe(true);
          for (const sf of w.topology!.surfaces.filter(s=>s.id===t.id || s.id.startsWith(t.id+'/step-')).filter((_,i,a)=>i===0 || i===a.length-1 || i===Math.floor(a.length/2))) {
            const p = rectCenter(sf.bounds), foot = surfaceY(sf,p.x,p.z), expected = surfaceY({...sf,profile:sf.ceilingProfile!},p.x,p.z);
            const ray = new THREE.Raycaster(new THREE.Vector3(p.x,foot+.2,p.z),new THREE.Vector3(0,1,0),0,8);
            const hit = ray.intersectObjects(meshes)[0]; expect(hit, `${w.seed}/${t.id}`).toBeDefined();
            expect(hit!.point.y, `${w.seed}/${t.id}/${sf.id}`).toBeCloseTo(expected,3); expect(expected-foot).toBeGreaterThan(2.5); probes++;
          }
        }
      } finally { meshes.forEach(m=>m.geometry.dispose()); }
    }
    expect(material.side).toBe(THREE.FrontSide); expect(material.transparent).toBe(false); expect(material.depthWrite).toBe(true);
    expect(policies.has('upper-slab')).toBe(true); expect(probes).toBeGreaterThan(20);
  } finally { material.dispose(); }
},30000);

it('keeps exposed slab returns visible in raw geometry and after FaceExposure from within the flight', () => {
  const material = new THREE.MeshBasicMaterial(); let tested = 0;
  try {
    for (let n=0;n<8;n++) {
      const w=generateInfiniteChunk(`REGIONAL-AUDIT-${n}`,{x:0,z:0,story:0});
      const final=prepareSpatialArchitecture(w).map(b=>{const m=new THREE.Mesh(mountArchitectureBatch(b),material);m.updateMatrixWorld();return m;});
      try {
        for (const p of w.spatial!.prisms.filter(p=>p.id.includes('/open-slab-return-'))) {
          const raw = createSpatialPrismGeometry(p), mesh = new THREE.Mesh(raw,material); mesh.updateMatrixWorld();
          try {
            const positions=raw.getAttribute('position'), normals=raw.getAttribute('normal');
            for(let face=2;face<6;face++) {
              const at=face*6, normal=new THREE.Vector3().fromBufferAttribute(normals,at);
              const point=new THREE.Vector3().fromBufferAttribute(positions,at).multiplyScalar(.23)
                .addScaledVector(new THREE.Vector3().fromBufferAttribute(positions,at+1),.31)
                .addScaledVector(new THREE.Vector3().fromBufferAttribute(positions,at+2),.46);
              const from=point.clone().addScaledVector(normal,.025);
              const flight=w.spatial!.transitions!.find(t=>t.roofPolicy==='upper-slab' && pointInRect(from.x,from.z,t.run)
                && from.y>surfaceY({bounds:t.run,profile:t.profile} as never,from.x,from.z)+.3
                && from.y<surfaceY({bounds:t.run,profile:t.roof} as never,from.x,from.z)-.3);
              if(!flight)continue;
              const ray=new THREE.Raycaster(from,normal.clone().negate(),0,.055);
              expect(ray.intersectObject(mesh)[0]).toBeDefined(); expect(ray.intersectObjects(final)[0],p.id).toBeDefined(); tested++;
            }
          } finally {raw.dispose();}
        }
      } finally {final.forEach(m=>m.geometry.dispose());}
    }
    expect(tested).toBeGreaterThan(10);
  } finally {material.dispose();}
},30000);

it('budgets reliefs and canonical links per connected hall across every owner fragment', () => {
  let halls=0;
  for(const n of [4,7,12,16,23,29,31,40,47]) {
    const seed=`REGIONAL-AUDIT-${n}`, origin=generateInfiniteChunk(seed,{x:0,z:0,story:0});
    for(const region of new Set(origin.spatial!.cells.map(c=>c.regionId))) {
      if(!region.startsWith('district/') || regionalStyle(seed,region).family==='maze')continue;
      halls++;
      const composition=openRoomComposition(seed,region), [_,rx,rz]=region.split('/');
      const selected=new Set<string>();
      for(let z=(+rz!-1)*6;z<(+rz!+2)*6;z++)for(let x=(+rx!-1)*6;x<(+rx!+2)*6;x++) {
        if(regionalDatum(seed,x,z).id!==region)continue;
        for(const [side,ax,az,axis]of [['east',x,z,'x'],['west',x-1,z,'x'],['south',x,z,'z'],['north',x,z-1,'z']]as const)
          if(hasRegionalTransition(seed,x,z,side))selected.add(`${ax}/${az}/${axis}`);
      }
      expect(selected.size).toBeLessThanOrEqual(2);
      for(const id of selected)expect(composition.links).toContain(id);
      const p=composition.relief;if(!p)continue;
      const at={x:Math.floor(p.x/4),z:Math.floor(p.z/4),story:0},w=generateInfiniteChunk(seed,at);
      const regionReliefs=(w.spatial!.reliefs??[]).filter(r=>w.spatial!.cells.find(c=>r.id.startsWith(c.id+'/'))?.regionId===region);
      expect(regionReliefs.length).toBeLessThanOrEqual(1);
      expect(w.rooms.some(r=>r.bounds.maxX-r.bounds.minX>=28 && r.kind==='open-hall')).toBe(true);
    }
  }
  expect(halls).toBeGreaterThan(5);
},30000);
