import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { MaterialSet } from '../render/MaterialLibrary';
import { createWallGeometry, createFloorGeometry, createCeilingGeometry } from '../render/WorldBuilder';
import { createFluorescentPanelGeometry } from '../render/FluorescentFixture';
import { applyMatteSurface } from '../render/MatteSurface';
import type { StaticCollider } from '../world/types';
import { CORRIDOR_LENGTH, CORRIDOR_LAMPS, CORRIDOR_SPACING } from '../story/CorridorProgress';

export const CORRIDOR_WIDTH=4.6;
export interface CorridorDoorway { closedBox:THREE.Box3;frameBox:THREE.Box3;outward:THREE.Vector3 }
/** Shared Backrooms surfaces/fixtures, with one resident analytical light field. */
export class LongCorridor {
  readonly group=new THREE.Group();
  readonly colliders:StaticCollider[]=[];
  readonly threshold:THREE.Vector3;
  private readonly ownedMaterials:THREE.Material[]=[];
  private readonly geometries=new Set<THREE.BufferGeometry>();
  private readonly uniforms={count:{value:0},start:{value:0},origin:{value:new THREE.Vector3()},axis:{value:new THREE.Vector3()},gain:{value:1}};
  private readonly panels:THREE.InstancedMesh;
  private readonly onColor=new THREE.Color(1,1,1);
  private readonly offColor=new THREE.Color(.006,.006,.006);
  private previousKey='';
  private mounted=false;
  private prepared=false;
  constructor(door:CorridorDoorway,readonly floorY:number,materials:MaterialSet,private readonly physics:PhysicsWorld){
    this.threshold=door.closedBox.getCenter(new THREE.Vector3());this.threshold.y=floorY;
    this.group.name='post-outage-long-corridor';this.group.visible=false;this.group.position.copy(this.threshold);
    this.group.rotation.y=Math.atan2(-door.outward.z,door.outward.x);this.group.updateMatrixWorld(true);
    this.uniforms.origin.value.copy(this.threshold);this.uniforms.axis.value.copy(door.outward);
    const localBox=(box:THREE.Box3)=>{
      const b=new THREE.Box3();for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])b.expandByPoint(this.group.worldToLocal(new THREE.Vector3(x,y,z)));return b;
    };
    const leaf=localBox(door.closedBox),frame=localBox(door.frameBox),entry=frame.max.x-.008;
    // The reveal starts on the exterior of the imported frame, clear of the
    // apartment's switch, bolt and hardware. Its aperture overlaps the frame.
    const openingMin=leaf.min.z-.012,openingMax=leaf.max.z+.012,openingTop=frame.max.y-.025;
    const wall=this.litMaterial(materials.wall),floor=this.litMaterial(materials.floor),ceiling=this.litMaterial(materials.ceiling),baseboard=this.litMaterial(materials.baseboard);
    const mesh=(name:string,g:THREE.BufferGeometry,m:THREE.Material)=>{this.geometries.add(g);const o=new THREE.Mesh(g,m);o.name=name;this.group.add(o);return o;};
    const collider=(id:string,c:THREE.Vector3,size:THREE.Vector3,kind:StaticCollider['kind'])=>{const center=c.applyMatrix4(this.group.matrixWorld),q=this.group.quaternion;this.colliders.push({id,center:{x:center.x,y:center.y,z:center.z},halfExtents:{x:size.x/2,y:size.y/2,z:size.z/2},rotation:{x:q.x,y:q.y,z:q.z,w:q.w},kind});};
    const W=CORRIDOR_WIDTH,L=CORRIDOR_LENGTH,H=3.2,bounds={minX:entry,maxX:L,minZ:-W/2,maxZ:W/2};
    mesh('corridor-floor',createFloorGeometry([bounds,{minX:frame.min.x-.09,maxX:entry,minZ:openingMin,maxZ:openingMax}]),floor);
    collider('corridor-floor',new THREE.Vector3((entry+L)/2,-.13,0),new THREE.Vector3(L-entry,.26,W+.2),'floor');
    collider('corridor-threshold',new THREE.Vector3((frame.min.x-.09+entry)/2,-.13,(openingMin+openingMax)/2),new THREE.Vector3(entry-frame.min.x+.09,.26,openingMax-openingMin),'floor');
    mesh('corridor-ceiling',createCeilingGeometry(bounds,H),ceiling);
    collider('corridor-ceiling',new THREE.Vector3((entry+L)/2,H+.09,0),new THREE.Vector3(L-entry,.18,W+.2),'wall');
    const wallBox=(name:string,x:number,z:number,length:number,orientation:'x'|'z',bottom:number,height:number,thickness=.2,mat=wall,collide=true)=>{
      mesh(name,createWallGeometry({id:name,x,z,length,orientation,bottom,height,thickness,tint:1,collision:collide,kind:'wallpaper'}),mat);
      if(collide)collider(name,new THREE.Vector3(x,bottom+height/2,z),new THREE.Vector3(orientation==='x'?length:thickness,height,orientation==='x'?thickness:length),'wall');
    };
    for(const side of [-1,1]){
      wallBox(`corridor-wall-${side}`,(entry+L)/2,side*(W/2+.1),L-entry,'x',0,H);
      wallBox(`corridor-skirting-${side}`,(entry+L)/2,side*(W/2-.02),L-entry,'x',0,.13,.04,baseboard,false);
    }
    wallBox('corridor-entry-return-left',entry+.1,(-W/2+openingMin)/2,openingMin+W/2,'z',0,H);
    wallBox('corridor-entry-return-right',entry+.1,(W/2+openingMax)/2,W/2-openingMax,'z',0,H);
    wallBox('corridor-entry-lintel',entry+.1,(openingMin+openingMax)/2,openingMax-openingMin,'z',openingTop,H-openingTop);
    wallBox('corridor-end',L+.1,0,W+.4,'z',0,H);
    const frameGeo=new THREE.BoxGeometry(2.34,.07,1.26),panelGeo=createFluorescentPanelGeometry();
    this.geometries.add(frameGeo);this.geometries.add(panelGeo);
    const frameMaterial=this.litMaterial(materials.fixtureFrame),diffuser=materials.fixtureGlow.clone();this.ownedMaterials.push(diffuser);
    const frames=new THREE.InstancedMesh(frameGeo,frameMaterial,CORRIDOR_LAMPS);
    this.panels=new THREE.InstancedMesh(panelGeo,diffuser,CORRIDOR_LAMPS);this.panels.name='instanced-luminous-ceiling-tiles';
    const m=new THREE.Matrix4();for(let i=0;i<CORRIDOR_LAMPS;i++){
      const x=2+i*CORRIDOR_SPACING;frames.setMatrixAt(i,m.makeTranslation(x,H-.035,0));this.panels.setMatrixAt(i,m.makeTranslation(x,H-.074,0));this.panels.setColorAt(i,this.offColor);
    }
    frames.computeBoundingSphere();this.panels.computeBoundingSphere();this.group.add(frames,this.panels);this.group.updateMatrixWorld(true);
  }
  private litMaterial(source:THREE.MeshStandardMaterial):THREE.MeshStandardMaterial {
    const material=source.clone(),u=this.uniforms;
    material.emissive.setHex(0);
    material.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,{corridorLitCount:u.count,corridorStart:u.start,corridorOrigin:u.origin,corridorAxis:u.axis,corridorGain:u.gain});
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vCorridorPosition;').replace('#include <project_vertex>',`#include <project_vertex>
        vec4 corridorVertex=vec4(transformed,1.0);
        #ifdef USE_INSTANCING
        corridorVertex=instanceMatrix*corridorVertex;
        #endif
        vCorridorPosition=(modelMatrix*corridorVertex).xyz;`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vCorridorPosition; uniform float corridorLitCount; uniform float corridorStart; uniform vec3 corridorOrigin; uniform vec3 corridorAxis; uniform float corridorGain;').replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
        vec3 relative=vCorridorPosition-corridorOrigin;
        float axial=dot(relative,corridorAxis);
        float across=dot(relative,vec3(-corridorAxis.z,0.0,corridorAxis.x));
        float fixtureIndex=clamp(floor((axial-2.0)/4.0+.5),corridorStart,max(corridorStart,corridorLitCount-1.0));
        float dx=axial-(2.0+fixtureIndex*4.0);
        float field=step(.5,corridorLitCount)*.82/(1.0+.19*dx*dx+.12*across*across);
        totalEmissiveRadiance+=diffuseColor.rgb*vec3(1.0,.985,.90)*field*corridorGain;`);
    };material.customProgramCacheKey=()=> 'long-corridor-backrooms-fixture-field-v2';applyMatteSurface(material);this.ownedMaterials.push(material);return material;
  }
  async prepare():Promise<void>{
    if(this.prepared)return;this.physics.addChunk('post-outage-corridor',this.colliders,{x:0,y:0,z:0});
    for(const c of this.colliders)this.physics.setChunkColliderEnabled('post-outage-corridor',c.id,false);this.prepared=true;
  }
  activate(scene:THREE.Scene):void{
    if(this.mounted)return;this.mounted=true;this.group.visible=true;scene.add(this.group);
    if(!this.prepared){this.physics.addChunk('post-outage-corridor',this.colliders,{x:0,y:0,z:0});this.prepared=true;}
    else for(const c of this.colliders)this.physics.setChunkColliderEnabled('post-outage-corridor',c.id,true);
  }
  setLights(count:number,gain=1,start=0):void {
    this.uniforms.gain.value=gain;this.uniforms.count.value=count;this.uniforms.start.value=start;
    const key=`${start}:${count}`;if(key===this.previousKey)return;this.previousKey=key;
    for(let i=0;i<CORRIDOR_LAMPS;i++)this.panels.setColorAt(i,i>=start&&i<count?this.onColor:this.offColor);
    if(this.panels.instanceColor)this.panels.instanceColor.needsUpdate=true;
  }
  dispose():void{if(this.prepared)this.physics.removeChunk('post-outage-corridor');this.group.removeFromParent();for(const g of this.geometries)g.dispose();for(const m of this.ownedMaterials)m.dispose();}
}
