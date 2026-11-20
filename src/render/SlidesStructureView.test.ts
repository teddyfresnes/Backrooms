import * as THREE from 'three';
import { describe,expect,it } from 'vitest';
import { SlidesStructureView } from './SlidesStructureView';
import { createSlidesFeature,slideFacadeMesh } from '../world/SlidesStructure';
import { NorthernLighting } from './NorthernLighting';
import { environmentFixture } from '../../tests/support/environment-fixture';

describe('authored four-slide landmark',()=>{
  it('builds exactly four distinct mouths, large geometry labels/arrows, finite meshes and bounded draw calls',()=>{
    const f=createSlidesFeature(),view=new SlidesStructureView(f,'SLIDES-ART',null);let meshes=0,vertices=0;
    const mouths=view.group.children.filter(o=>o.name.startsWith('slide-mouth-'));
    expect(mouths.map(m=>m.userData.label)).toEqual(['HOME','FUN :)','DEATH','DANGER']);
    for(const mouth of mouths){
      expect(mouth.children.some(m=>(m as THREE.Mesh).material&&(m as THREE.Mesh<THREE.BufferGeometry,THREE.Material>).material.name.endsWith('-arrow'))).toBe(true);
      expect(mouth.children.some(m=>(m as THREE.Mesh<THREE.BufferGeometry,THREE.Material>).material.name==='slides-ivory-letters')).toBe(true);
    }
    view.group.traverse(o=>{if(o instanceof THREE.Mesh){meshes++;const p=o.geometry.getAttribute('position');vertices+=p.count;expect(Array.from(p.array).every(Number.isFinite)).toBe(true);}});
    expect(meshes).toBeLessThan(40);expect(vertices).toBeLessThan(180000);
    const bounds=new THREE.Box3().setFromObject(view.group);expect(bounds.max.y).toBeLessThan(4.85);expect(bounds.max.x).toBeLessThan(20);
    // Front panels face the approaching player, with exact rectangular corners.
    const m=slideFacadeMesh(f.entries[0]!),a=m.indices.slice(0,3).map(i=>new THREE.Vector3().fromArray(m.positions,i*3));
    expect(a[1]!.sub(a[0]!).cross(a[2]!.sub(a[0]!)).z).toBeGreaterThan(0);
    expect(m.positions.some((x,i)=>i%3===0&&Math.abs(x-(f.entries[0]!.position.x+3.8))<1e-6&&Math.abs(m.positions[i+1]!-4.6)<1e-6)).toBe(true);
    view.dispose();
  });
  it('preserves identifying enamel colours under red lighting and releases every owned GPU resource',()=>{
    const plan=environmentFixture('telephone');plan.northern={kind:'red-zone',circuits:[]};
    const lighting=new NorthernLighting(plan),view=new SlidesStructureView(createSlidesFeature(),'SLIDES-GPU',null);
    lighting.decorate(view.group);
    for(const material of view.materials.filter(m=>m.name.endsWith('-enamel'))){
      const shader={...THREE.ShaderLib.physical,uniforms:{}};material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms,{} as THREE.WebGLRenderer);
      expect((shader.uniforms as Record<string,{value:THREE.Vector3}>).northernTint!.value.toArray()).toEqual([1,1,1]);
      expect(shader.fragmentShader).toContain('totalEmissiveRadiance *= vColor');
    }
    let expected=0,disposed=0;
    view.group.traverse(o=>{if(o instanceof THREE.Mesh){expected++;o.geometry.addEventListener('dispose',()=>disposed++);}});
    for(const m of view.materials){expected++;m.addEventListener('dispose',()=>disposed++);}
    const texture=(view.materials.find(m=>m instanceof THREE.MeshStandardMaterial) as THREE.MeshStandardMaterial).map!;
    expected++;texture.addEventListener('dispose',()=>disposed++);
    view.dispose();view.dispose();expect(disposed).toBe(expected);expect(view.group.children).toHaveLength(0);
  });
});
