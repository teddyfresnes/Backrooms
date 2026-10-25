import { expect, it } from 'vitest';
import { fitTransitionEnvironment, planRegionalTransition, transitionTreads } from './TransitionLayout';
import { generateInfiniteChunk } from './InfiniteWorld';
import { spatialCellBounds } from './RegionalPlan';
import { surfaceY } from './WalkableTopology';
import { rectCenter } from './types';
import { transitionHost } from './SpatialTemplates';

it('joins the actual two endpoint roofs at the same canonical midpoint in all directions', () => {
  for (const [side,dx,dz,opposite] of [['east',1,0,'west'],['west',-1,0,'east'],['north',0,-1,'south'],['south',0,1,'north']] as const) {
    const a=planRegionalTransition('ROOF-ENDPOINTS',0,0,0,side,spatialCellBounds(0,0),-3.7,2.4,'a');
    const b=planRegionalTransition('ROOF-ENDPOINTS',dx,dz,0,opposite,spatialCellBounds(dx,dz),2.4,-3.7,'b');
    fitTransitionEnvironment(a,-3.7+2.74,2.4+4.35,[0,0]);fitTransitionEnvironment(b,2.4+4.35,-3.7+2.74,[0,0]);
    expect(a.approachCeilingY).toBeCloseTo(-.96,7);expect(b.approachCeilingY).toBeCloseTo(6.75,7);expect(a.landingCeilingY).toBeCloseTo(b.landingCeilingY,7);
    const p=rectCenter(a.landing.bounds),q=rectCenter(b.landing.bounds);
    expect(surfaceY({bounds:a.run,profile:a.roof} as never,p.x,p.z)).toBeCloseTo(a.landingCeilingY,7);
    expect(surfaceY({bounds:b.run,profile:b.roof} as never,q.x,q.z)).toBeCloseTo(a.landingCeilingY,7);
    for(const t of [a,b])for(const s of transitionTreads(t))for(const x of [s.bounds.minX,s.bounds.maxX])for(const z of [s.bounds.minZ,s.bounds.maxZ])
      expect(surfaceY({bounds:t.run,profile:t.roof} as never,x,z)-surfaceY(s as never,x,z)).toBeGreaterThanOrEqual(2.56);
  }
});

it('uses a chamber only for a genuinely supported pair of sides, a single backed side or a fully open flight', () => {
  const t=planRegionalTransition('ENCLOSURE',0,0,0,'east',spatialCellBounds(0,0),0,3,'t');
  fitTransitionEnvironment(t,2.74,5.74,[0,0]);expect(t.enclosure).toBe('open');
  fitTransitionEnvironment(t,2.74,5.74,[.65,.05]);expect(t.enclosure).toBe('wall');expect(t.wallSide).toBe(-1);
  fitTransitionEnvironment(t,2.74,5.74,[.05,.65]);expect(t.enclosure).toBe('wall');expect(t.wallSide).toBe(1);
  fitTransitionEnvironment(t,2.74,5.74,[.65,.65]);expect(t.enclosure).toBe('chamber');expect(t.wallSide).toBeUndefined();
});

it('samples real canonical BSP ceilings and keeps enclosure columns stable through adjacent owners', () => {
  let flights=0,open=0,backed=0;
  for(let n=0;n<16;n++) {
    const w=generateInfiniteChunk(`REGIONAL-AUDIT-${n}`,{x:0,z:0,story:0});
    for(const t of w.spatial!.transitions!) {
      const cell=w.spatial!.cells.find(c=>t.roomId.startsWith(c.id+'/'))!,m=/cell\/(-?\d+)\/(-?\d+)\//.exec(cell.id)!;
      const host=transitionHost(w.seed,+m[1]!,+m[2]!,0,t,{x:0,z:0});
      expect(t.approachCeilingY).toBeCloseTo(Math.max(host.ceilingY,cell.floorY+2.74),7);
      if(t.enclosure==='open')open++;else backed++;flights++;
      const upper=generateInfiniteChunk(w.seed,{x:0,z:0,story:1});
      const other=upper.spatial!.transitions!.find(p=>p.bounds.minX===t.bounds.minX&&p.bounds.minZ===t.bounds.minZ&&p.axis===t.axis)!;
      expect(other).toBeDefined();expect(other.enclosure).toBe(t.enclosure);expect(other.wallSide).toBe(t.wallSide);expect(other.bounds).toEqual(t.bounds);
    }
  }
  expect(flights).toBeGreaterThan(10);expect(open).toBeGreaterThan(0);expect(backed).toBeGreaterThan(0);
},30000);

it('leaves the real stair treads and sloping fixtures below the resolved roof with standing clearance', async()=>{
  const THREE=await import('three'),{ceilingFixturePose}=await import('../render/CeilingFixture');let checked=0;
  for(let n=0;n<32;n++) {
    const w=generateInfiniteChunk(`REGIONAL-AUDIT-${n}`,{x:0,z:0,story:0});
    for(const t of w.spatial!.transitions!) {
      const slot=w.lights.find(l=>l.id===`${t.id}/light`);if(!slot)continue;
      const p=new THREE.Vector3(),q=new THREE.Quaternion();ceilingFixturePose(w,slot,p,q);
      for(const x of [-slot.width/2,slot.width/2])for(const z of [-.5,.5]) {
        const corner=new THREE.Vector3(x,0,z).applyQuaternion(q).add(p);
        const floor=w.topology!.surfaces.find(s=>(s.id===t.id||s.id.startsWith(`${t.id}/step-`))&&corner.x>=s.bounds.minX&&corner.x<=s.bounds.maxX&&corner.z>=s.bounds.minZ&&corner.z<=s.bounds.maxZ)!;
        expect(floor).toBeDefined();expect(corner.y-surfaceY(floor,corner.x,corner.z),`${w.seed}/${t.id}`).toBeGreaterThanOrEqual(2.5);checked++;
      }
      if(t.enclosure!=='chamber')expect(w.spatial!.dependencies.some(d=>d.owner.story===-1&&d.reason==='view'&&d.bounds.minX<=t.bounds.minX&&d.bounds.maxX>=t.bounds.maxX)).toBe(true);
    }
  }
  expect(checked).toBeGreaterThan(40);
},30000);
