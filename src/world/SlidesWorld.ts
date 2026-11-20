import type { InfiniteEdgeGates } from './InfiniteWorld';
import { isSlidesStructureCoord } from './NorthernLayout';
import { createSlidesFeature, slideFacadeMesh, slideTubeMesh, type SlideMeshData } from './SlidesStructure';
import type { SpatialAddress } from './SpatialTypes';
import { connectSpatialSurfaces, SPATIAL_PLAN_VERSION } from './SpatialWorld';
import { profilePrism, prismCollider } from './SpatialGeometry';
import { cutRects, findSurface, surfaceCollider, type WalkableSurface } from './WalkableTopology';
import { rectCenter, rectDepth, rectWidth, type Rect, type StaticCollider, type SurfaceStyle, type WorldPlan } from './types';

/** A sparse, authored monumental owner. Its flat datum and gates are shared
 * analytically with regional neighbours; it never edits a generated neighbour. */
export const generateSlidesWorld = (seed: string, owner: SpatialAddress, style: SurfaceStyle, gates: InfiniteEdgeGates): WorldPlan => {
  if (!isSlidesStructureCoord(owner)) throw new Error('Slides structures belong only to their reserved red-zone owners.');
  const feature = createSlidesFeature();
  const world: WorldPlan = { version: SPATIAL_PLAN_VERSION, seed, size:112,wallHeight:4.85,surfaceStyle:style,visualBiome:'red',
    rooms:[],walls:[],columns:[],solidMasses:[],lights:[],missingCeilingTiles:[],features:[feature],detailSockets:[],colliders:[],floorRects:[],floorOpenings:[],unlitZones:[],
    spawn:{...feature.approach}, topology:{version:2,ownerStory:owner.story,surfaces:[],connections:[],volumes:[],diagnostics:[]},
    spatial:{version:2,owner:{...owner},cells:[],ceilings:[],prisms:[],dependencies:[],interfaces:[],landmarks:[],transitions:[]} };
  const solids: Rect[] = [];
  const wall = (id: string, b: Rect, height: number): void => {
    if (rectWidth(b)<.01 || rectDepth(b)<.01) return;
    const prism=profilePrism(id,b,{kind:'flat',y:0},{kind:'flat',y:height});
    world.spatial!.prisms.push(prism);world.colliders.push(prismCollider(prism));solids.push(b);
    const c=rectCenter(b), alongX=rectWidth(b)>rectDepth(b);
    world.walls.push({id,x:c.x,z:c.z,length:alongX?rectWidth(b):rectDepth(b),thickness:alongX?rectDepth(b):rectWidth(b),orientation:alongX?'x':'z',bottom:0,height,tint:.9,collision:true,kind:'wallpaper'});
  };
  for (const side of ['north','south','west','east'] as const) {
    const alongX=side==='north'||side==='south', fixed=side==='north'||side==='west'?-55.8:55.8;
    const b=alongX?{minX:-56,maxX:56,minZ:fixed-.2,maxZ:fixed+.2}:{minX:fixed-.2,maxX:fixed+.2,minZ:-56,maxZ:56};
    const openings=gates[side].map(g=>alongX?{minX:g.offset-g.width/2,maxX:g.offset+g.width/2,minZ:-57,maxZ:57}:{minX:-57,maxX:57,minZ:g.offset-g.width/2,maxZ:g.offset+g.width/2});
    cutRects([b],openings).forEach((part,i)=>wall(`slides/boundary/${side}/${i}`,part,3.05));
  }
  for (const z of [-28,28]) for (const [i,b] of [{minX:-24,maxX:-4,minZ:z-.25,maxZ:z+.25},{minX:4,maxX:24,minZ:z-.25,maxZ:z+.25}].entries()) wall(`slides/hall/z/${z}/${i}`,b,4.85);
  for (const x of [-24,24]) for (const [i,b] of [{minX:x-.25,maxX:x+.25,minZ:-28,maxZ:-3},{minX:x-.25,maxX:x+.25,minZ:3,maxZ:28}].entries()) wall(`slides/hall/x/${x}/${i}`,b,4.85);
  const rooms = [
    {id:'slides-hall',bounds:{minX:-24,maxX:24,minZ:-28,maxZ:28},height:4.85},
    {id:'slides/south',bounds:{minX:-56,maxX:56,minZ:28,maxZ:56},height:3.05},
    {id:'slides/north',bounds:{minX:-56,maxX:56,minZ:-56,maxZ:-28},height:3.05},
    {id:'slides/west',bounds:{minX:-56,maxX:-24,minZ:-28,maxZ:28},height:3.05},
    {id:'slides/east',bounds:{minX:24,maxX:56,minZ:-28,maxZ:28},height:3.05},
  ];
  for (const r of rooms) {
    world.rooms.push({id:r.id,bounds:r.bounds,kind:'open-hall',level:0,floorY:0,ceilingHeight:r.height,structuralCeilingY:r.height,detailDensity:0,access:'open'});
    for (const [i,bounds] of cutRects([r.bounds],solids).entries()) {
      const s:WalkableSurface={id:`${r.id}/floor/${i}`,roomId:r.id,ownerStory:owner.story,layer:`regional/${owner.story}`,role:'floor',bounds,
        profile:{kind:'flat',y:0},ceilingY:r.height,thickness:.16,support:'slab',access:'open',edges:'architecture',reachability:'regional'};
      world.topology!.surfaces.push(s);world.floorRects.push(bounds);world.colliders.push(surfaceCollider(s));
      world.topology!.volumes.push({id:`${s.id}/volume`,surfaceId:s.id,bounds,bottom:0,top:r.height,purpose:'clearance',ownerStory:owner.story});
    }
    const roof:WalkableSurface={id:`${r.id}/ceiling`,roomId:r.id,ownerStory:owner.story,layer:`regional/${owner.story}`,role:'floor',bounds:r.bounds,
      profile:{kind:'flat',y:r.height},ceilingY:r.height+.16,thickness:.03,support:'slab',access:'open',edges:'architecture'};
    world.spatial!.ceilings.push(roof);world.colliders.push(surfaceCollider(roof));
    for (let z=r.bounds.minZ+7;z<r.bounds.maxZ;z+=10) for(let x=r.bounds.minX+7;x<r.bounds.maxX;x+=10) {
      if (x>-18&&x<18&&z<-4&&z>-24) continue;
      world.lights.push({id:`${r.id}/light/${x}/${z}`,roomId:r.id,x,z,ceilingY:r.height,width:1.5,rotation:0,intensity:1.25,color:0xff170c,dead:false,unstable:false,phase:0,level:0});
    }
  }
  // The façade and curved inner walls use exact triangle meshes, not solid
  // cuboids across the circular mouths. Caps hide the destination physically.
  const meshCollider=(id:string,m:SlideMeshData):StaticCollider=>({id,kind:'wall',center:{x:0,y:0,z:0},halfExtents:{x:18,y:5,z:24},vertices:m.positions,indices:m.indices});
  for(const e of feature.entries){
    world.colliders.push(meshCollider(`${e.id}/facade`,slideFacadeMesh(e)),meshCollider(`${e.id}/tube`,slideTubeMesh(e)));
    world.colliders.push({id:`${e.id}/end`,kind:'wall',center:{x:e.position.x+e.bend,y:1.2,z:-21.85},halfExtents:{x:1.1,y:1.1,z:.04}});
  }
  // Hidden backs/sides are solid too; leave the front aperture geometry alone.
  wall('slides/body/back',{minX:-20,maxX:20,minZ:-23,maxZ:-22.7},4.6);
  for(const x of [-19.85,19.85]) wall(`slides/body/side/${x}`,{minX:x-.15,maxX:x+.15,minZ:-23,maxZ:-10},4.6);
  for(const b of [{minX:-20,maxX:-15.2,minZ:-10.7,maxZ:-10},{minX:15.2,maxX:20,minZ:-10.7,maxZ:-10}])wall(`slides/body/front/${b.minX}`,b,4.6);
  const lid=profilePrism('slides/body/lid',{minX:-20,maxX:20,minZ:-23,maxZ:-10},{kind:'flat',y:4.4},{kind:'flat',y:4.6},'plaster');
  world.spatial!.prisms.push(lid);world.colliders.push(prismCollider(lid));
  connectSpatialSurfaces(world);
  for(const side of ['north','south','east','west'] as const) for(const [i,g] of gates[side].entries()){
    const p=side==='north'?{x:g.offset,z:-55.5}:side==='south'?{x:g.offset,z:55.5}:side==='west'?{x:-55.5,z:g.offset}:{x:55.5,z:g.offset};
    const s=findSurface(world,{...p,referenceY:0,maxAbove:.01,maxBelow:.01});if(!s)continue;
    const neighbor={...owner,x:owner.x+Number(side==='east')-Number(side==='west'),z:owner.z+Number(side==='south')-Number(side==='north')};
    world.spatial!.interfaces.push({id:`slides/interface/${side}/${i}`,side,surfaceId:s.id,position:{...p,y:0},width:g.width,neighbor});
  }
  return world;
};
