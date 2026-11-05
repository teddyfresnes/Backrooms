import {expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {MaterialLibrary} from '../render/MaterialLibrary';
import {LongCorridor} from './LongCorridor';
import type {PhysicsWorld} from '../physics/PhysicsWorld';
it('uses the actual yellow Backrooms maps, UV scales and HDR panels with a fixed resource budget throughout the wave',async()=>{
  const load=vi.spyOn(THREE.TextureLoader.prototype,'loadAsync').mockImplementation(async()=>new THREE.Texture());
  const library=await MaterialLibrary.load({capabilities:{getMaxAnisotropy:()=>8}}as THREE.WebGLRenderer);load.mockRestore();
  const corridor=new LongCorridor({closedBox:new THREE.Box3(new THREE.Vector3(-2.07,8.68,-3.16),new THREE.Vector3(-1.96,10.86,-2.26)),frameBox:new THREE.Box3(new THREE.Vector3(-2.086,8.68,-3.192),new THREE.Vector3(-1.951,10.93,-2.232)),outward:new THREE.Vector3(1,0,0)},8.64,library.materials,{}as PhysicsWorld);
  try{
    const wall=corridor.group.getObjectByName('corridor-wall-1')as THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>;
    const floor=corridor.group.getObjectByName('corridor-floor')as THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>;
    expect(wall.material.map).toBe(library.materials.wall.map);expect(wall.material.normalMap).toBe(library.materials.wall.normalMap);expect(wall.material.color.equals(library.materials.wall.color)).toBe(true);
    expect(floor.material.map).toBe(library.materials.floor.map);const uv=wall.geometry.getAttribute('uv'),pos=wall.geometry.getAttribute('position');
    expect(Math.abs(uv.getX(16)-uv.getX(17))*2.05).toBeCloseTo(Math.abs(pos.getX(16)-pos.getX(17)),3);
    const panel=corridor.group.getObjectByName('instanced-luminous-ceiling-tiles')as THREE.InstancedMesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>;
    expect(panel.material.color.r).toBe(2);expect(panel.material.toneMapped).toBe(true);expect(panel.geometry.getAttribute('position').count).toBe(4);
    const matrices=panel.instanceMatrix.array,colors=panel.instanceColor!.array,version=wall.material.version,children=corridor.group.children.length;
    corridor.setLights(6,1,4);const color=new THREE.Color();panel.getColorAt(4,color);expect(color.r).toBe(1);panel.getColorAt(0,color);expect(color.r).toBeLessThan(.01);panel.getColorAt(6,color);expect(color.r).toBeLessThan(.01);
    for(let i=6;i<=42;i++)corridor.setLights(i,1,4);
    expect(panel.instanceMatrix.array).toBe(matrices);expect(panel.instanceColor!.array).toBe(colors);expect(wall.material.version).toBe(version);expect(corridor.group.children).toHaveLength(children);
    let lights=0;corridor.group.traverse(o=>{if(o instanceof THREE.Light)lights++;});expect(lights).toBe(0);
  }finally{corridor.dispose();library.dispose();}
});
