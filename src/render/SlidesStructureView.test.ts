import * as THREE from 'three';
import { describe,expect,it } from 'vitest';
import { SlidesStructureView } from './SlidesStructureView';
import { createSlidesFeature,slidePath,slideTubeMesh,SLIDE_HOLE } from '../world/SlidesStructure';

describe('three tube slides in the wallpapered wall',()=>{
  it('builds three coloured tubes, a holed wall in the borrowed wallpaper, finite meshes and bounded draw calls',()=>{
    const f=createSlidesFeature(),wallpaper=new THREE.MeshStandardMaterial({vertexColors:true});
    const view=new SlidesStructureView(f,'SLIDES-ART',null,{material:wallpaper,origin:{x:0,y:0,z:-560},scale:1});let meshes=0,vertices=0;
    const mouths=view.group.children.filter(o=>o.name.startsWith('slide-mouth-'));
    expect(mouths.map(m=>m.userData.label)).toEqual(['THIS WAY','???','EXIT :)']);
    for(const mouth of mouths)expect(mouth.children.some(m=>m.name.endsWith('-tube'))).toBe(true);
    view.group.traverse(o=>{if(o instanceof THREE.Mesh){meshes++;const p=o.geometry.getAttribute('position');vertices+=p.count;expect(Array.from(p.array).every(Number.isFinite)).toBe(true);}});
    expect(meshes).toBeLessThan(16);expect(vertices).toBeLessThan(120000);
    // The wall is the chunk's own wallpaper, with world UVs and a real hole at each mouth.
    const wall=view.group.getObjectByName('slides-wallpaper-wall') as THREE.Mesh;expect(wall.material).toBe(wallpaper);
    const positions=wall.geometry.getAttribute('position');
    for(const e of f.entries){
      const near=Array.from({length:positions.count},(_,i)=>Math.hypot(positions.getX(i)-e.position.x,positions.getY(i)-e.position.y));
      expect(Math.min(...near)).toBeGreaterThan(SLIDE_HOLE-1e-3);
    }
    view.dispose();
  });
  it('lines each bore inward, keeps the three tubes apart behind the wall and darkens them toward the bend',()=>{
    const f=createSlidesFeature(),paths=f.entries.map(e=>slidePath(e));
    for(const [i,e] of f.entries.entries()){
      const path=paths[i]!,m=slideTubeMesh(e,'inner'),p=(k:number)=>new THREE.Vector3().fromArray(m.positions,k*3);
      // The first triangle's normal points to the centre line: the bore is seen from inside.
      const [a,b,c]=m.indices.slice(0,3).map(p),normal=b!.clone().sub(a!).cross(c!.clone().sub(a!));
      const axis=new THREE.Vector3(path[0]!.x,path[0]!.y,path[0]!.z);
      expect(normal.dot(axis.clone().sub(a!))).toBeGreaterThan(0);
      expect(m.shade[0]).toBeGreaterThan(.5);expect(m.shade.at(-1)).toBeLessThan(.25);
      // Everything after the lip runs behind the wall face.
      expect(path.slice(4).every(q=>q.z<f.wallZ)).toBe(true);
    }
    // Centre lines stay further apart than two bores: the tubes never cross.
    for(let i=0;i<paths.length;i++)for(let j=i+1;j<paths.length;j++)for(const a of paths[i]!)for(const b of paths[j]!)
      expect(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)).toBeGreaterThan(1.1);
  });
  it('releases every owned GPU resource and leaves the borrowed wallpaper alive',()=>{
    const wallpaper=new THREE.MeshStandardMaterial(),view=new SlidesStructureView(createSlidesFeature(),'SLIDES-GPU',null,{material:wallpaper,origin:{x:0,y:0,z:0},scale:1});
    let expected=0,disposed=0,wallpaperDisposed=false;wallpaper.addEventListener('dispose',()=>{wallpaperDisposed=true;});
    view.group.traverse(o=>{if(o instanceof THREE.Mesh){expected++;o.geometry.addEventListener('dispose',()=>disposed++);}});
    for(const m of view.materials){expected++;m.addEventListener('dispose',()=>disposed++);}
    const texture=(view.materials.find(m=>m instanceof THREE.MeshStandardMaterial) as THREE.MeshStandardMaterial).map!;
    expected++;texture.addEventListener('dispose',()=>disposed++);
    view.dispose();view.dispose();expect(disposed).toBe(expected);expect(view.group.children).toHaveLength(0);expect(wallpaperDisposed).toBe(false);
  });
});
