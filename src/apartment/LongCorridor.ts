import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { MaterialSet } from '../render/MaterialLibrary';
import { createWallGeometry, createFloorGeometry, createCeilingGeometry } from '../render/WorldBuilder';
import { createFluorescentPanelGeometry } from '../render/FluorescentFixture';
import { applyMatteSurface } from '../render/MatteSurface';
import type { StaticCollider } from '../world/types';
import { CORRIDOR_LENGTH, CORRIDOR_LAMPS, CORRIDOR_SPACING, corridorLampDistance } from '../story/CorridorProgress';

/** A real Level 0 hallway: narrow, low drop ceiling, recessed troffers. */
export const CORRIDOR_WIDTH = 3.05;
export const CORRIDOR_HEIGHT = 2.74;
/** Dark side openings (lamp index, side), a few metres deep, never lit by the wave. */
/** Straight hallway: no side openings. */
export const CORRIDOR_ALCOVES: readonly { readonly at: number; readonly side: -1 | 1 }[] = [];
const ALCOVE_WIDTH = 1.3, ALCOVE_DEPTH = 2.6, ALCOVE_HEIGHT = 2.18;
/** The fogged continuation behind the creature, and its tubes racing away. */
const VISTA_LENGTH = 420;
const VISTA_LAMPS = Math.floor(VISTA_LENGTH / CORRIDOR_SPACING) - 1;
const VISTA_STEP = .045;
/** Peak additive halo around a fully lit troffer. */
const HALO_STRENGTH = .34;
/** Soft rectangular glare (rounded falloff, brightest just off the panel edge), no canvas needed. */
function createHaloTexture(size=64):THREE.DataTexture{
  const data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=Math.abs((x+.5)/size*2-1),v=Math.abs((y+.5)/size*2-1);
    // Distance outside the panel's footprint (≈55 % x 40 % of the halo).
    const dx=Math.max(0,u-.55)/.45,dy=Math.max(0,v-.4)/.6,d=Math.min(1,Math.hypot(dx,dy));
    const inside=u<.55&&v<.4?.55:1;
    const a=Math.round(255*Math.pow(1-d,2.2)*inside),i=(y*size+x)*4;
    data[i]=data[i+1]=data[i+2]=255;data[i+3]=a;
  }
  const texture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);
  texture.name='corridor-troffer-halo';texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearFilter;texture.needsUpdate=true;
  return texture;
}
/** Every tube holds steady once lit, like the generated levels. */
const BAD_TUBES = new Set<number>();

export interface CorridorDoorway { closedBox:THREE.Box3;frameBox:THREE.Box3;outward:THREE.Vector3 }

/**
 * The post-outage hallway behind the apartment door. Surfaces reuse the Level 0
 * materials; the light comes from one shared per-lamp level array evaluated
 * analytically in the shader (no Three.js light, constant program), so each
 * troffer can strike, stutter and die on its own.
 */
export class LongCorridor {
  readonly group=new THREE.Group();
  readonly colliders:StaticCollider[]=[];
  readonly threshold:THREE.Vector3;
  /** A tube strikes (index ≥ CORRIDOR_LAMPS: far vista tubes). Sound hook. */
  onLampStrike?:(index:number,level:number)=>void;
  private readonly ownedMaterials:THREE.Material[]=[];
  private readonly geometries=new Set<THREE.BufferGeometry>();
  private readonly levels=new Array<number>(CORRIDOR_LAMPS).fill(0);
  private readonly targets=new Array<number>(CORRIDOR_LAMPS).fill(0);
  private readonly strike=new Array<number>(CORRIDOR_LAMPS).fill(0);
  private readonly uniforms={levels:{value:this.levels},origin:{value:new THREE.Vector3()},axis:{value:new THREE.Vector3()},gain:{value:1},floorY:{value:0}};
  private readonly panels:THREE.InstancedMesh;
  private readonly halos:THREE.InstancedMesh;
  private readonly ownedTextures:THREE.Texture[]=[];
  private readonly vista=new THREE.Group();
  private readonly vistaMaterials:{material:THREE.MeshBasicMaterial;base:THREE.Color}[]=[];
  private vistaPanels?:THREE.InstancedMesh;
  private vistaHalos?:THREE.InstancedMesh;
  /** Seconds since the last playable tube lit (-1 = dark), and far tubes on. */
  private vistaTime=-1;
  private vistaLit=0;
  private readonly panelColor=new THREE.Color();
  private readonly panelMatrix=new THREE.Matrix4();
  private seed=0x7a11c0;
  private time=0;
  private mounted=false;
  private prepared=false;
  private dirty=true;
  constructor(door:CorridorDoorway,readonly floorY:number,materials:MaterialSet,private readonly physics:PhysicsWorld){
    this.threshold=door.closedBox.getCenter(new THREE.Vector3());this.threshold.y=floorY;
    this.group.name='post-outage-long-corridor';this.group.visible=false;this.group.position.copy(this.threshold);
    this.group.rotation.y=Math.atan2(-door.outward.z,door.outward.x);this.group.updateMatrixWorld(true);
    this.uniforms.origin.value.copy(this.threshold);this.uniforms.axis.value.copy(door.outward);this.uniforms.floorY.value=floorY;
    const localBox=(box:THREE.Box3)=>{
      const b=new THREE.Box3();for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])b.expandByPoint(this.group.worldToLocal(new THREE.Vector3(x,y,z)));return b;
    };
    const leaf=localBox(door.closedBox),frame=localBox(door.frameBox),entry=frame.max.x-.008;
    // The reveal starts on the exterior of the imported frame, clear of the
    // apartment's switch, bolt and hardware. Its aperture overlaps the frame.
    const openingMin=leaf.min.z-.012,openingMax=leaf.max.z+.012,openingTop=frame.max.y-.025;
    const wall=this.litMaterial(materials.wall,'wall'),floor=this.litMaterial(materials.floor,'floor'),ceiling=this.litMaterial(materials.ceiling,'ceiling'),baseboard=this.litMaterial(materials.baseboard,'trim');
    const mesh=(name:string,g:THREE.BufferGeometry,m:THREE.Material)=>{this.geometries.add(g);const o=new THREE.Mesh(g,m);o.name=name;this.group.add(o);return o;};
    const collider=(id:string,c:THREE.Vector3,size:THREE.Vector3,kind:StaticCollider['kind'])=>{const center=c.applyMatrix4(this.group.matrixWorld),q=this.group.quaternion;this.colliders.push({id,center:{x:center.x,y:center.y,z:center.z},halfExtents:{x:size.x/2,y:size.y/2,z:size.z/2},rotation:{x:q.x,y:q.y,z:q.z,w:q.w},kind});};
    const panelGeoForVista=createFluorescentPanelGeometry();this.geometries.add(panelGeoForVista);
    const W=CORRIDOR_WIDTH,L=CORRIDOR_LENGTH,H=CORRIDOR_HEIGHT,bounds={minX:entry,maxX:L,minZ:-W/2,maxZ:W/2};
    const floorRects=[bounds,{minX:frame.min.x-.09,maxX:entry,minZ:openingMin,maxZ:openingMax}];
    const ceilingRects=[bounds];
    for(const [index,alcove] of CORRIDOR_ALCOVES.entries()){
      const r={minX:alcove.at-ALCOVE_WIDTH/2,maxX:alcove.at+ALCOVE_WIDTH/2,minZ:alcove.side>0?W/2:-W/2-ALCOVE_DEPTH,maxZ:alcove.side>0?W/2+ALCOVE_DEPTH:-W/2};
      floorRects.push(r);ceilingRects.push(r);
      collider(`corridor-alcove-floor-${index}`,new THREE.Vector3(alcove.at,-.13,(r.minZ+r.maxZ)/2),new THREE.Vector3(ALCOVE_WIDTH+.2,.26,ALCOVE_DEPTH+.1),'floor');
    }
    mesh('corridor-floor',createFloorGeometry(floorRects),floor);
    collider('corridor-floor',new THREE.Vector3((entry+L)/2,-.13,0),new THREE.Vector3(L-entry,.26,W+.2),'floor');
    collider('corridor-threshold',new THREE.Vector3((frame.min.x-.09+entry)/2,-.13,(openingMin+openingMax)/2),new THREE.Vector3(entry-frame.min.x+.09,.26,openingMax-openingMin),'floor');
    mesh('corridor-ceiling',createCeilingGeometry(bounds,H),ceiling);
    collider('corridor-ceiling',new THREE.Vector3((entry+L)/2,H+.09,0),new THREE.Vector3(L-entry,.18,W+.2),'wall');
    const wallBox=(name:string,x:number,z:number,length:number,orientation:'x'|'z',bottom:number,height:number,thickness=.2,mat=wall,collide=true)=>{
      if(length<=.01||height<=.01)return;
      mesh(name,createWallGeometry({id:name,x,z,length,orientation,bottom,height,thickness,tint:1,collision:collide,kind:'wallpaper'}),mat);
      if(collide)collider(name,new THREE.Vector3(x,bottom+height/2,z),new THREE.Vector3(orientation==='x'?length:thickness,height,orientation==='x'?thickness:length),'wall');
    };
    for(const side of [-1,1] as const){
      // Side walls are split around their alcove openings.
      const cuts=CORRIDOR_ALCOVES.filter(a=>a.side===side).map(a=>a.at).sort((a,b)=>a-b);
      let from=entry;
      const segment=(to:number,index:number)=>{
        wallBox(`corridor-wall-${side}-${index}`,(from+to)/2,side*(W/2+.1),to-from,'x',0,H);
        wallBox(`corridor-skirting-${side}-${index}`,(from+to)/2,side*(W/2-.02),to-from,'x',0,.13,.04,baseboard,false);
      };
      for(const [index,at] of cuts.entries()){
        const a=at-ALCOVE_WIDTH/2,b=at+ALCOVE_WIDTH/2;
        segment(a,index);
        wallBox(`corridor-alcove-lintel-${side}-${index}`,at,side*(W/2+.1),ALCOVE_WIDTH,'x',ALCOVE_HEIGHT,H-ALCOVE_HEIGHT);
        const back=side*(W/2+ALCOVE_DEPTH+.1),mid=side*(W/2+ALCOVE_DEPTH/2);
        wallBox(`corridor-alcove-back-${side}-${index}`,at,back,ALCOVE_WIDTH+.4,'x',0,ALCOVE_HEIGHT);
        wallBox(`corridor-alcove-left-${side}-${index}`,a-.1,mid,ALCOVE_DEPTH+.2,'z',0,ALCOVE_HEIGHT);
        wallBox(`corridor-alcove-right-${side}-${index}`,b+.1,mid,ALCOVE_DEPTH+.2,'z',0,ALCOVE_HEIGHT);
        const roof=new THREE.PlaneGeometry(ALCOVE_WIDTH,ALCOVE_DEPTH).rotateX(Math.PI/2);
        mesh(`corridor-alcove-ceiling-${side}-${index}`,roof,ceiling).position.set(at,ALCOVE_HEIGHT,mid);
        from=b;
      }
      segment(L,cuts.length);
    }
    wallBox('corridor-entry-return-left',entry+.1,(-W/2+openingMin)/2,openingMin+W/2,'z',0,H);
    wallBox('corridor-entry-return-right',entry+.1,(W/2+openingMax)/2,W/2-openingMax,'z',0,H);
    wallBox('corridor-entry-lintel',entry+.1,(openingMin+openingMax)/2,openingMax-openingMin,'z',openingTop,H-openingTop);
    // No dead end: past the playable 168 m the hallway runs on into the haze
    // behind the creature. Only an invisible barrier stops the player.
    collider('corridor-end',new THREE.Vector3(L+.1,H/2,0),new THREE.Vector3(.2,H,W+.4),'wall');
    // Exactly the generated levels' fixture: a flush luminous panel, no housing.
    const panelGeo=panelGeoForVista;
    const diffuser=materials.fixtureGlow.clone();this.ownedMaterials.push(diffuser);
    this.panels=new THREE.InstancedMesh(panelGeo,diffuser,CORRIDOR_LAMPS);this.panels.name='instanced-luminous-ceiling-tiles';this.panels.renderOrder=12;
    const m=new THREE.Matrix4();for(let i=0;i<CORRIDOR_LAMPS;i++){
      this.panels.setMatrixAt(i,m.makeScale(0,0,0));this.panels.setColorAt(i,this.panelColor.setScalar(1));
    }
    this.panels.frustumCulled=false;this.group.add(this.panels);
    // Every slot keeps its fixture: a thin grey frame and a frosted diffuser,
    // lit by the corridor field like the tiles, so a dead tube blends into the
    // grid instead of leaving bare ceiling. A lit panel covers it from below.
    const housing=(name:string,color:number,scale:number,y:number)=>{
      const material=this.litMaterial(materials.ceiling,'ceiling');material.map=null;material.color.setHex(color);material.roughness=.62;
      const mesh=new THREE.InstancedMesh(panelGeo,material,CORRIDOR_LAMPS);mesh.name=name;
      for(let i=0;i<CORRIDOR_LAMPS;i++)mesh.setMatrixAt(i,m.makeScale(scale,1,scale).setPosition(corridorLampDistance(i),y,0));
      mesh.frustumCulled=false;mesh.instanceMatrix.needsUpdate=true;this.group.add(mesh);
    };
    // No oversized grey frame: around a lit panel it read as a dirty outline.
    housing('corridor-fixture-diffusers',0xd9d6ca,1,CORRIDOR_HEIGHT-.0022);
    // Without bloom in this pipeline the panels looked flat. An additive halo
    // on the tiles around each tube carries the glare; its instance colour
    // follows the lamp level, so a dead or stuttering tube loses it too.
    const haloGeo=new THREE.PlaneGeometry(4.1,2.9).rotateX(Math.PI*.5);this.geometries.add(haloGeo);
    const haloMap=createHaloTexture();
    const halo=new THREE.MeshBasicMaterial({name:'corridor-troffer-halo',map:haloMap,color:0xfff1c8,transparent:true,blending:THREE.AdditiveBlending,
      depthWrite:false,toneMapped:false,fog:false,side:THREE.DoubleSide});
    this.ownedMaterials.push(halo);this.ownedTextures.push(haloMap);
    this.halos=new THREE.InstancedMesh(haloGeo,halo,CORRIDOR_LAMPS);this.halos.name='corridor-troffer-halos';this.halos.renderOrder=13;
    for(let i=0;i<CORRIDOR_LAMPS;i++){this.halos.setMatrixAt(i,m.makeTranslation(corridorLampDistance(i),CORRIDOR_HEIGHT-.006,0));this.halos.setColorAt(i,this.panelColor.setScalar(0));}
    this.halos.frustumCulled=false;this.group.add(this.halos);
    this.buildVista(materials,W,L,H,panelGeo);
    this.group.updateMatrixWorld(true);
  }
  /** Unlit, fogged continuation: cheap programs, no analytic field, no colliders. */
  private buildVista(materials:MaterialSet,W:number,L:number,H:number,panelGeo:THREE.BufferGeometry):void{
    const vista=this.vista;vista.name='corridor-vista';this.group.add(vista);
    const basic=(source:THREE.MeshStandardMaterial)=>{
      const material=new THREE.MeshBasicMaterial({name:`${source.name}-vista`,map:source.map,color:source.color.clone()});
      this.ownedMaterials.push(material);this.vistaMaterials.push({material,base:source.color.clone()});return material;
    };
    const far={minX:L,maxX:L+VISTA_LENGTH,minZ:-W/2,maxZ:W/2};
    const add=(name:string,geometry:THREE.BufferGeometry,material:THREE.Material)=>{this.geometries.add(geometry);const o=new THREE.Mesh(geometry,material);o.name=name;o.frustumCulled=false;vista.add(o);};
    add('corridor-vista-floor',createFloorGeometry([far]),basic(materials.floor));
    add('corridor-vista-ceiling',createCeilingGeometry(far,H),basic(materials.ceiling));
    const wall=basic(materials.wall);
    for(const side of [-1,1] as const)add(`corridor-vista-wall-${side}`,createWallGeometry({id:`corridor-vista-wall-${side}`,x:L+VISTA_LENGTH/2,z:side*(W/2+.1),
      length:VISTA_LENGTH,orientation:'x',bottom:0,height:H,thickness:.2,tint:1,collision:false,kind:'wallpaper'}),wall);
    const glow=(this.panels.material as THREE.Material);
    this.vistaPanels=new THREE.InstancedMesh(panelGeo,glow,VISTA_LAMPS);this.vistaPanels.name='corridor-vista-panels';this.vistaPanels.renderOrder=12;
    this.vistaHalos=new THREE.InstancedMesh(this.halos.geometry,this.halos.material,VISTA_LAMPS);this.vistaHalos.name='corridor-vista-halos';this.vistaHalos.renderOrder=13;
    const m=new THREE.Matrix4();
    for(let i=0;i<VISTA_LAMPS;i++){
      const x=L+2+i*CORRIDOR_SPACING;
      this.vistaPanels.setMatrixAt(i,m.makeTranslation(x,H-.003,0));this.vistaPanels.setColorAt(i,this.panelColor.setScalar(0));
      this.vistaHalos.setMatrixAt(i,m.makeTranslation(x,H-.006,0));this.vistaHalos.setColorAt(i,this.panelColor.setScalar(0));
    }
    for(const mesh of [this.vistaPanels,this.vistaHalos]){mesh.frustumCulled=false;vista.add(mesh);}
    this.applyVista(0);
  }
  /** `lit` far tubes on; the far surfaces take a dim reflected level. */
  private applyVista(lit:number):void{
    const reflected=lit>0?.5:.035;
    for(const {material,base} of this.vistaMaterials)material.color.copy(base).multiplyScalar(reflected*this.uniforms.gain.value);
    for(let i=0;i<VISTA_LAMPS;i++){
      const on=i<lit?1:0;
      this.vistaPanels!.setColorAt(i,this.panelColor.setScalar(on));this.vistaHalos!.setColorAt(i,this.panelColor.setScalar(on*HALO_STRENGTH));
    }
    for(const mesh of [this.vistaPanels!,this.vistaHalos!])if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
  }
  private litMaterial(source:THREE.MeshStandardMaterial,surface:'wall'|'floor'|'ceiling'|'trim'|'end'):THREE.MeshStandardMaterial {
    const material=source.clone(),u=this.uniforms;
    material.emissive.setHex(0);
    const grime='0.0';
    material.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,{corridorLevels:u.levels,corridorOrigin:u.origin,corridorAxis:u.axis,corridorGain:u.gain,corridorFloorY:u.floorY});
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vCorridorPosition;').replace('#include <project_vertex>',`#include <project_vertex>
        vec4 corridorVertex=vec4(transformed,1.0);
        #ifdef USE_INSTANCING
        corridorVertex=instanceMatrix*corridorVertex;
        #endif
        vCorridorPosition=(modelMatrix*corridorVertex).xyz;`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
        varying vec3 vCorridorPosition;
        uniform float corridorLevels[${CORRIDOR_LAMPS}];
        uniform vec3 corridorOrigin; uniform vec3 corridorAxis; uniform float corridorGain; uniform float corridorFloorY;
        float corridorHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float corridorNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
          return mix(mix(corridorHash(i),corridorHash(i+vec2(1,0)),f.x),mix(corridorHash(i+vec2(0,1)),corridorHash(i+vec2(1,1)),f.x),f.y);}`)
        .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
        vec3 corridorRelative=vCorridorPosition-corridorOrigin;
        float corridorAlong=dot(corridorRelative,corridorAxis);
        float corridorAcross=dot(corridorRelative,vec3(-corridorAxis.z,0.0,corridorAxis.x));
        float corridorHeight=vCorridorPosition.y-corridorFloorY;
        float corridorBelow=max(0.0,${CORRIDOR_HEIGHT.toFixed(3)}-corridorHeight);
        int corridorNearest=int(floor((corridorAlong-2.0)/${(CORRIDOR_LENGTH/CORRIDOR_LAMPS).toFixed(1)}+.5));
        float corridorPool=0.0,corridorWash=0.0;
        for(int k=-2;k<=2;k++){
          int index=clamp(corridorNearest+k,0,${CORRIDOR_LAMPS-1});
          float level=corridorLevels[index]*step(abs(float(corridorNearest+k-index)),.5);
          float dx=corridorAlong-(2.0+float(index)*${(CORRIDOR_LENGTH/CORRIDOR_LAMPS).toFixed(1)});
          // A tight pool under each troffer and a faint wash that carries down the hall.
          corridorPool+=level*exp(-dx*dx*.5);
          corridorWash+=level*.11/(1.0+dx*dx*.09);
        }
        float corridorRise=clamp(corridorHeight/${CORRIDOR_HEIGHT.toFixed(3)},0.0,1.0);
        float corridorSide=smoothstep(0.0,${(CORRIDOR_WIDTH/2).toFixed(3)},abs(corridorAcross));
        float corridorField=${surface==='floor'?'corridorPool*.95*(1.0-.38*corridorSide)+corridorWash'
          :surface==='ceiling'?'corridorPool*.42+corridorWash*.85'
          // The dead end is the backdrop of the long-lens reveal: once the
          // wave reaches it, it glows evenly so the creature stands out in silhouette.
          :surface==='end'?`corridorLevels[${CORRIDOR_LAMPS-1}]*.95+corridorWash`
          :'corridorPool*(.38+.62*corridorRise*corridorRise)+corridorWash'};
        // Openings stay dark: the light dies a metre past the wall line.
        corridorField*=1.0-smoothstep(${(CORRIDOR_WIDTH/2-.05).toFixed(3)},${(CORRIDOR_WIDTH/2+1.2).toFixed(3)},abs(corridorAcross));
        // Contact darkening where floor, walls and ceiling meet.
        float corridorEdge=${(CORRIDOR_WIDTH/2).toFixed(3)}-abs(corridorAcross);
        float corridorContact=(1.0-smoothstep(0.0,.32,corridorHeight))*.28+(1.0-smoothstep(0.0,.22,corridorBelow))*.18+(1.0-smoothstep(0.0,.28,max(corridorEdge,0.0)))*.2;
        // Damp, uneven stains: stronger near the floor, never a regular pattern.
        float corridorStain=corridorNoise(vec2(corridorAlong*.55,corridorHeight*.9+corridorAcross*.4))*.6+corridorNoise(vec2(corridorAlong*2.3,corridorHeight*3.1))*.4;
        float corridorDamp=smoothstep(.55,.95,corridorStain)*(.35+.65*(1.0-smoothstep(0.0,1.1,corridorHeight)))*${grime};
        vec3 corridorTint=mix(vec3(1.0,.985,.9),vec3(.84,.8,.6),corridorDamp);
        diffuseColor.rgb*=mix(1.0,.72,corridorDamp);
        totalEmissiveRadiance+=diffuseColor.rgb*corridorTint*corridorField*(1.0-clamp(corridorContact,0.0,.45))*corridorGain;`);
    };material.customProgramCacheKey=()=>`long-corridor-level0-field-v5-${surface}`;applyMatteSurface(material);this.ownedMaterials.push(material);return material;
  }
  async prepare():Promise<void>{
    if(this.prepared)return;this.physics.addChunk('post-outage-corridor',this.colliders,{x:0,y:0,z:0});
    for(const c of this.colliders)this.physics.setChunkColliderEnabled('post-outage-corridor',c.id,false);this.prepared=true;
  }
  get isMounted():boolean{return this.mounted;}
  activate(scene:THREE.Scene):void{
    if(this.mounted)return;this.mounted=true;this.group.visible=true;scene.add(this.group);
    if(!this.prepared){this.physics.addChunk('post-outage-corridor',this.colliders,{x:0,y:0,z:0});this.prepared=true;}
    else for(const c of this.colliders)this.physics.setChunkColliderEnabled('post-outage-corridor',c.id,true);
  }
  /** Back to the resident, disabled state (the stairwell returns). */
  deactivate():void{
    if(!this.mounted)return;this.mounted=false;this.group.visible=false;this.group.removeFromParent();
    for(const c of this.colliders)this.physics.setChunkColliderEnabled('post-outage-corridor',c.id,false);
  }
  /** World position of a troffer, just below the diffuser. */
  lampPosition(index:number,out=new THREE.Vector3()):THREE.Vector3{
    return out.set(corridorLampDistance(index),CORRIDOR_HEIGHT-.12,0).applyMatrix4(this.group.matrixWorld);
  }
  /** Lamps [start, count) are powered. A newly powered lamp strikes with a stutter. */
  setLights(count:number,gain=1,start=0,animate=true):void {
    this.uniforms.gain.value=gain;
    for(let i=0;i<CORRIDOR_LAMPS;i++){
      const on=i>=start&&i<count?1:0;
      if(on===this.targets[i])continue;
      this.targets[i]=on;
      if(on&&this.mounted&&animate){this.strike[i]=BAD_TUBES.has(i)?.75:.32;this.onLampStrike?.(i,1);}
      else{this.strike[i]=0;this.levels[i]=on;}
      this.dirty=true;
    }
  }
  /** Brightness 0..1 of one troffer as currently drawn (stutter included). */
  lampLevel(index:number):number{return this.levels[index]??0;}
  update(delta:number):void{
    const dt=Math.max(0,Math.min(.05,delta));this.time+=dt;
    for(let i=0;i<CORRIDOR_LAMPS;i++){
      const target=this.targets[i]!;let level=this.levels[i]!;
      if(this.strike[i]!>0){
        this.strike[i]=Math.max(0,this.strike[i]!-dt);
        level=this.strike[i]===0?target:this.noise()>.5?target*(.55+this.noise()*.45):.02;
      }else if(target>0&&BAD_TUBES.has(i)){
        // A dying tube: long holds, then a short sag or blink.
        level=this.noise()<.012?.08+this.noise()*.3:THREE.MathUtils.lerp(level,target*.9,1-Math.exp(-dt*24));
      }else level=target;
      if(Math.abs(level-this.levels[i]!)>1e-4){this.levels[i]=level;this.dirty=true;}
    }
    // Once the last playable tube holds, the far ones strike in a fast cascade.
    if(this.levels[CORRIDOR_LAMPS-1]!>.5)this.vistaTime=this.vistaTime<0?0:this.vistaTime+dt;else this.vistaTime=-1;
    const vistaLit=this.vistaTime<0?0:Math.min(VISTA_LAMPS,Math.floor(this.vistaTime/VISTA_STEP)+1);
    if(vistaLit!==this.vistaLit){
      if(vistaLit>this.vistaLit&&this.vistaLit<VISTA_LAMPS)this.onLampStrike?.(CORRIDOR_LAMPS+this.vistaLit,1);
      this.vistaLit=vistaLit;this.applyVista(vistaLit);
    }
    if(!this.dirty)return;this.dirty=false;
    // An unlit panel is hidden: the dead fixture beneath shows. A lit one
    // sits flush in the grid, just below the diffuser.
    for(let i=0;i<CORRIDOR_LAMPS;i++){
      const level=this.levels[i]!;
      this.panels.setMatrixAt(i,level>.03?this.panelMatrix.makeTranslation(corridorLampDistance(i),CORRIDOR_HEIGHT-.003,0):this.panelMatrix.makeScale(0,0,0));
      this.panels.setColorAt(i,this.panelColor.setScalar(Math.min(1,level)));
      this.halos.setColorAt(i,this.panelColor.setScalar(Math.min(1,level)*HALO_STRENGTH));
    }
    this.panels.instanceMatrix.needsUpdate=true;
    if(this.panels.instanceColor)this.panels.instanceColor.needsUpdate=true;
    if(this.halos.instanceColor)this.halos.instanceColor.needsUpdate=true;
  }
  private noise():number{this.seed=(this.seed*1664525+1013904223)>>>0;return this.seed/4294967296;}
  dispose():void{if(this.prepared)this.physics.removeChunk('post-outage-corridor');this.group.removeFromParent();for(const g of this.geometries)g.dispose();for(const m of this.ownedMaterials)m.dispose();for(const t of this.ownedTextures)t.dispose();}
}
