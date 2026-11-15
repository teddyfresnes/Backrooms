import {afterEach,expect,it,vi} from 'vitest';
vi.mock('@dimforge/rapier3d',async()=>{const r=await import('@dimforge/rapier3d-compat');await r.init();return r;});
import {PhysicsWorld} from '../physics/PhysicsWorld';
import type {StaticCollider,WorldPlan} from '../world/types';
import {NavGrid} from './BackroomsNav';
import {BackroomsHunter} from './BackroomsHunter';
import {SeededRandom} from '../world/SeededRandom';
const worlds:PhysicsWorld[]=[];
afterEach(()=>worlds.splice(0).forEach(p=>p.dispose()));
const slab=(id:string,a:number,b:number,y:number):StaticCollider=>({id,kind:'floor',center:{x:(a+b)/2,y:y-.1,z:0},halfExtents:{x:(b-a)/2,y:.1,z:2}});
async function setup(kind:'ramp'|'stairs'){
  const top=kind==='ramp'?3:3.2,end=kind==='ramp'?10:8;
  const colliders:StaticCollider[]=[slab('lower',-8,0,0),slab('upper',end,16,top),slab('under-upper',end,16,0)];
  if(kind==='stairs')for(let i=0;i<16;i++)colliders.push(slab(`tread-${i}`,i*.5,(i+1)*.5,(i+1)*.2));
  else{const angle=Math.atan(.3);colliders.push({id:'ramp',kind:'floor',center:{x:5,y:1.5-.1/Math.cos(angle),z:0},halfExtents:{x:5/Math.cos(angle),y:.1,z:2},rotation:{x:0,y:0,z:Math.sin(angle/2),w:Math.cos(angle/2)}});}
  const physics=await PhysicsWorld.create({version:1,seed:'hunter-vertical',size:64,wallHeight:2.74,rooms:[],walls:[],columns:[],solidMasses:[],lights:[],missingCeilingTiles:[],features:[],detailSockets:[],colliders,floorRects:[],spawn:{x:40,y:.865,z:40}} as WorldPlan);worlds.push(physics);
  const nav=new NavGrid((x,z,y)=>physics.probeWalkableCell(x,z,y),64);
  nav.follow(4,0,top);nav.seed(-4,0,0);nav.computeField(12,0,1e5,192,top);
  return{nav,top,physics};
}
for(const kind of ['ramp','stairs'] as const)for(const descending of [false,true])it(`pursues ${descending?'down':'up'} physical ${kind} while retaining stacked floors and recentered cells`,async()=>{
  const {nav,top,physics}=await setup(kind);
  const from=descending?{x:12,y:top,z:0}:{x:-4,y:0,z:0},target=descending?{x:-4,y:0,z:0}:{x:12,y:top,z:0};
  nav.computeField(target.x,target.z,1e5,192,target.y);
  expect(Number.isFinite(nav.distanceAt(from.x,from.z,from.y))).toBe(true);
  const hunter=new BackroomsHunter(nav,new SeededRandom(`vertical-${kind}`));hunter.adopt(from,Math.PI/2,'chase');
  if(kind==='ramp')expect(nav.floorAlong(.25,0,9.75,0,.075)).toBeGreaterThan(2.8);
  let maxY=from.y,last={...from},distance=0;
  for(let t=0;t<15&&Math.hypot(hunter.position.x-target.x,hunter.position.z-target.z)>1;t+=1/30){
    nav.follow((hunter.position.x+target.x)/2,0,target.y,1);
    hunter.update(1/30,{feet:target,sees:true,seen:false,stared:false,noise:0,speed:0,cinematic:false});
    maxY=Math.max(maxY,hunter.position.y);distance+=Math.hypot(hunter.position.x-last.x,hunter.position.z-last.z);
    expect(Math.abs(hunter.position.y-last.y)).toBeLessThanOrEqual(.361);
    expect(Math.abs(physics.probeWalkableCell(hunter.position.x,hunter.position.z,hunter.position.y)-hunter.position.y)).toBeLessThan(.2);
    expect(hunter.state).toBe('chase');last={...hunter.position};
  }
  expect(distance).toBeGreaterThan(13);expect(Math.abs(hunter.position.x-target.x)).toBeLessThan(1.1);
  expect(hunter.position.y).toBeCloseTo(target.y,1);expect(maxY).toBeGreaterThan(top-.1);
  // The two surfaces occupy exactly the same X/Z; they are distinct nodes.
  expect(nav.floorAt(12,0,0)).toBeCloseTo(0,2);expect(nav.floorAt(12,0,top)).toBeCloseTo(top,2);
  expect(nav.indexAt(12,0,0)).not.toBe(nav.indexAt(12,0,top));
  expect(nav.clearLine(12,0,12,0,Infinity,.18,0,top)).toBe(false);
});
