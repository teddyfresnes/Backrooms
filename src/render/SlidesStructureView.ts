import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SeededRandom } from '../world/SeededRandom';
import { slideFacadeMesh, slideTubeMesh, type SlideMeshData, type SlidesStructureFeature } from '../world/SlidesStructure';
import { applyZonalLighting, type ZonalLightingContext } from './ZonalLighting';

/** Deliberately blunt, architectural stencil lettering. Meshes, not sprites:
 * metre-high text remains readable from either camera and casts no font fetch. */
const GLYPHS: Record<string,string[]> = {
  A:['01110','11011','11011','11111','11011','11011','11011'],
  D:['11110','11011','11011','11011','11011','11011','11110'],
  E:['11111','11000','11000','11110','11000','11000','11111'],
  F:['11111','11000','11000','11110','11000','11000','11000'],
  G:['01111','11000','11000','11011','11011','11011','01111'],
  H:['11011','11011','11011','11111','11011','11011','11011'],
  M:['11011','11111','11111','11011','11011','11011','11011'],
  N:['11011','11111','11111','11111','11011','11011','11011'],
  O:['01110','11011','11011','11011','11011','11011','01110'],
  R:['11110','11011','11011','11110','11100','11010','11011'],
  T:['11111','01110','00100','00100','00100','00100','00100'],
  U:['11011','11011','11011','11011','11011','11011','01110'],
  ':':['00000','00100','00100','00000','00100','00100','00000'],
  ')':['01000','00100','00010','00010','00010','00100','01000'],
  ' ':['000','000','000','000','000','000','000'],
};
const meshDataGeometry = (m: SlideMeshData): THREE.BufferGeometry => {
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(m.positions,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(m.uv,2));
  g.setAttribute('color',new THREE.Float32BufferAttribute(m.shade.flatMap(v=>[v,v,v]),3));g.setIndex(m.indices);g.computeVertexNormals();return g;
};

/** Four authored entrances, merged per material/entry. Owns all GPU resources;
 * safe to build for an architecture-only neighbour and replace lighting modes. */
export class SlidesStructureView {
  readonly group=new THREE.Group();
  readonly materials: THREE.Material[]=[];
  private readonly textures:THREE.Texture[]=[];
  private disposed=false;
  constructor(feature:SlidesStructureFeature,seed:string,context:ZonalLightingContext|null){
    this.group.name=feature.id;this.group.userData.structureKind='slides';
    const rng=new SeededRandom(seed).fork('slides-enamel-v1');
    const bytes=new Uint8Array(64*64*4);
    for(let i=0;i<bytes.length;i+=4){const n=rng.int(186,255);bytes[i]=bytes[i+1]=bytes[i+2]=n;bytes[i+3]=255;}
    const patina=new THREE.DataTexture(bytes,64,64);patina.wrapS=patina.wrapT=THREE.RepeatWrapping;patina.needsUpdate=true;this.textures.push(patina);
    const standard=(name:string,color:number,preserve=false,emission=0):THREE.MeshStandardMaterial=>{
      const m=new THREE.MeshStandardMaterial({name,color,roughness:.71,metalness:.08,map:patina,emissive:color,emissiveIntensity:emission,vertexColors:true});
      m.userData.northernPreserveColor=preserve;
      if(!preserve&&context)applyZonalLighting(m,context);
      if(preserve){
        const before=m.onBeforeCompile.bind(m),key=m.customProgramCacheKey.bind(m);
        m.onBeforeCompile=(shader,renderer)=>{before(shader,renderer);shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
          #ifdef USE_COLOR
            totalEmissiveRadiance *= vColor;
          #endif`);};
        m.customProgramCacheKey=()=>`${key()}|slide-enamel-v1`;
      }
      this.materials.push(m);return m;
    };
    const basic=(name:string,color:number):THREE.MeshBasicMaterial=>{
      const m=new THREE.MeshBasicMaterial({name,color,toneMapped:true});m.userData.northernPreserveColor=true;this.materials.push(m);return m;
    };
    const concrete=standard('slides-aged-concrete',0x93947d),steel=standard('slides-tarnished-steel',0x434c48),black=basic('slides-unlit-depth',0x000000);
    const board=standard('slides-charcoal-signs',0x141c1a,true,.18),letters=basic('slides-ivory-letters',0xfff3cf);
    const batches=new Map<string,{parent:THREE.Group;material:THREE.Material;geometries:THREE.BufferGeometry[]}>();
    const add=(geometry:THREE.BufferGeometry,material:THREE.Material,at:THREE.Vector3Like={x:0,y:0,z:0},parent=this.group,rz=0):void=>{
      geometry.rotateZ(rz);geometry.translate(at.x,at.y,at.z);
      let g=geometry;if(g.index){g=g.toNonIndexed();geometry.dispose();}
      if(!g.getAttribute('color'))g.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count*3).fill(1),3));
      const key=`${parent.uuid}/${material.uuid}`,batch=batches.get(key)??{parent,material,geometries:[]};batch.geometries.push(g);batches.set(key,batch);
    };
    const box=(w:number,h:number,d:number,m:THREE.Material,x:number,y:number,z:number,parent=this.group,rz=0)=>add(new THREE.BoxGeometry(w,h,d),m,{x,y,z},parent,rz);
    const arrow=(material:THREE.Material,x:number,parent:THREE.Group)=>{
      const s=new THREE.Shape();s.moveTo(-.12,.43);s.lineTo(.12,.43);s.lineTo(.12,.04);s.lineTo(.43,.04);s.lineTo(0,-.46);s.lineTo(-.43,.04);s.lineTo(-.12,.04);s.closePath();
      add(new THREE.ExtrudeGeometry(s,{depth:.045,bevelEnabled:true,bevelSize:.015,bevelThickness:.01,bevelSegments:1,steps:1}),material,{x,y:3.06,z:-6.83},parent);
    };
    const text=(label:string,x:number,parent:THREE.Group)=>{
      const unit=.135,width=Array.from(label).reduce((n,c)=>n+(GLYPHS[c]?.[0]?.length??5)+1,0)-1;
      let column=-width/2;
      for(const c of label){const glyph=GLYPHS[c];if(!glyph)throw new Error(`Missing slide glyph: ${c}`);
        glyph.forEach((row,j)=>{let start=-1;for(let i=0;i<=row.length;i++){
          if(row[i]==='1'&&start<0)start=i;
          if(row[i]!=='1'&&start>=0){box((i-start)*unit,unit,.065,letters,x+(column+(start+i)/2)*unit,4.02+(3-j)*unit,-6.82,parent);start=-1;}
        }});column+=glyph[0]!.length+1;
      }
    };
    for(const e of feature.entries){
      const entry=new THREE.Group();entry.name=`slide-mouth-${e.key}`;entry.userData={entryId:e.id,label:e.label,transitionKey:e.transitionKey};this.group.add(entry);
      const enamel=standard(`slide-${e.key}-enamel`,e.color,true,.32),trim=standard(`slide-${e.key}-trim`,e.key==='death'?0x10151a:0xe2d9b9,true,.1);
      const arrowMaterial=basic(`slide-${e.key}-arrow`,e.color);
      add(meshDataGeometry(slideFacadeMesh(e)),concrete);
      add(meshDataGeometry(slideTubeMesh(e)),enamel,undefined,entry);
      add(meshDataGeometry(slideTubeMesh(e,true)),enamel,undefined,entry);
      for(const [z,r]of[[-7,1.39],[-8.4,1.36],[-9.8,1.32]] as const)add(new THREE.TorusGeometry(r,.075,8,48),trim,{x:e.position.x,y:1.5,z},entry);
      // Round, dark physical cap behind the bend. It shows no exit or scenery.
      add(new THREE.CircleGeometry(1.05,40),black,{x:e.position.x+e.bend,y:1.2,z:-21.8},entry);
      box(6.8,1.18,.22,board,e.position.x,4.02,-6.99,entry);
      box(7.15,.16,3.15,steel,e.position.x,4.61,-8.5,entry);
      for(const dx of[-3.5,3.5])box(.12,1.3,3.15,steel,e.position.x+dx,3.98,-8.5,entry);
      text(e.label,e.position.x,entry);arrow(arrowMaterial,e.position.x,entry);
      // Painted choice lanes extend from each lip onto the carpet, without a
      // fake step/collider across the player's feet.
      for(const dx of[-1.7,1.7])box(.085,.006,3.3,arrowMaterial,e.position.x+dx,.008,-5.2,entry);
      for(let j=0;j<12;j++){
        const a=j*Math.PI/6;add(new THREE.CylinderGeometry(.025,.025,.035,6).rotateX(Math.PI/2),steel,
          {x:e.position.x+Math.cos(a)*1.52,y:1.5+Math.sin(a)*1.52,z:-7.03},entry);
      }
      if(e.key==='home'){
        box(1.15,.1,.12,trim,e.position.x+1.98,2.4,-7.16,entry,.5);box(1.15,.1,.12,trim,e.position.x+2.82,2.4,-7.16,entry,-.5);
      }else if(e.key==='fun'){
        for(let j=0;j<9;j++)add(new THREE.SphereGeometry(.065,8,6),j%2?letters:arrowMaterial,{x:e.position.x-1.1+j*.275,y:.14,z:-6.5},entry);
      }else if(e.key==='death'){
        for(let j=0;j<14;j++){const a=j*Math.PI*2/14;add(new THREE.ConeGeometry(.09,.22,3),trim,{x:e.position.x+Math.sin(a)*1.5,y:1.5+Math.cos(a)*1.5,z:-7.05},entry,-a);}
      }else{
        for(const dx of[-2.1,2.1]){
          box(.5,2.55,.15,trim,e.position.x+dx,1.4,-7.1,entry);
          for(let j=0;j<7;j++)box(.53,.12,.02,arrowMaterial,e.position.x+dx,.35+j*.33,-7,entry,-.65);
          add(new THREE.SphereGeometry(.12,12,8),arrowMaterial,{x:e.position.x+dx,y:2.93,z:-7},entry);
        }
      }
    }
    // Large bolts/seams and service ribs make the concrete read as an old
    // installed machine rather than four loose cylinders in an empty room.
    for(const x of[-15.2,-7.6,0,7.6,15.2])box(.07,4.55,.06,steel,x,2.3,-9.96);
    for(const {parent,material,geometries}of batches.values()){
      const merged=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());
      if(!merged)throw new Error('Cannot merge slide structure geometry');
      merged.computeBoundingBox();merged.computeBoundingSphere();const mesh=new THREE.Mesh(merged,material);mesh.name=material.name;parent.add(mesh);
    }
  }
  dispose():void{
    if(this.disposed)return;this.disposed=true;this.group.removeFromParent();
    this.group.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose();});
    this.materials.forEach(m=>m.dispose());this.textures.forEach(t=>t.dispose());this.group.clear();
  }
}
