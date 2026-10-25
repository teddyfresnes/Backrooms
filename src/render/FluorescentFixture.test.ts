import {expect,it} from 'vitest';
import * as THREE from 'three';
import {createFluorescentDiffuser,MODERN_BACKROOMS_RIG} from './FluorescentFixture';
import {createZonalMaterialSet,createFluorescentLightField,unlitZoneInfluence} from './ZonalLighting';
import type{MaterialSet}from './MaterialLibrary';
import {generateWorld} from '../world/generateWorld';

it('produces a neutral HDR white emitter independently of bloom and leaves coloured biome intent available',()=>{
  const normal=createFluorescentDiffuser(),red=createFluorescentDiffuser('red',0xff6657),white=createFluorescentDiffuser('white',0xf5fbff);
  try {
    const rgb=normal.color.toArray();expect(Math.min(...rgb)).toBeGreaterThan(1.8);expect(Math.max(...rgb)-Math.min(...rgb)).toBeLessThan(.001);
    expect(normal).toBeInstanceOf(THREE.MeshBasicMaterial);expect(normal.map).toBeNull();expect(normal.fog).toBe(true);expect(normal.depthTest).toBe(true);
    expect(red.color.r).toBeGreaterThan(red.color.g*2);expect(white.color.b).toBeGreaterThan(1.8);
  } finally{normal.dispose();red.dispose();white.dispose();}
});

it('lifts actual lit-room field/rig throughput while preserving the exact blackout and contact settings',()=>{
  const plan=generateWorld('LIT-ROOM-CALIBRATION');plan.unlitZones=[];
  const source=Object.fromEntries(['wall','plaster','floor','ceiling','baseboard','pitWall','pitBottom','metal','fixtureFrame','fixtureGlow','void'].map(n=>[n,n==='fixtureGlow'||n==='void'?new THREE.MeshBasicMaterial():new THREE.MeshStandardMaterial()])) as unknown as MaterialSet;
  const field=createFluorescentLightField(plan),set=createZonalMaterialSet(source,plan);
  try{
    const m=set.materials.wall,shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
    m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms,{} as THREE.WebGLRenderer);
    const uniforms=shader.uniforms as Record<string,THREE.IUniform<number>>,min=uniforms.lightPoolMin!.value,max=uniforms.lightPoolMax!.value;
    const values=field.image.data as Uint8Array,irradiance=MODERN_BACKROOMS_RIG.hemisphere.lit+MODERN_BACKROOMS_RIG.ambient.lit+MODERN_BACKROOMS_RIG.key.lit;
    let measured=0;
    for(let i=0;i<values.length;i+=2)if(values[i]!>180){const exposure=values[i]!/255,newLight=irradiance*(min+(max-min)*exposure),oldLight=(.14+.055+.22)*(.5+(1.42-.5)*exposure);expect(newLight/oldLight).toBeGreaterThan(2);measured++;}
    expect(measured).toBeGreaterThan(10);expect(uniforms.darkFloor!.value).toBe(.045);expect(uniforms.verticalRelief!.value).toBe(.12);
    expect(MODERN_BACKROOMS_RIG.hemisphere.dark).toBe(.07);expect(MODERN_BACKROOMS_RIG.ambient.dark).toBe(.018);expect(MODERN_BACKROOMS_RIG.key.dark).toBe(.08);
    expect(unlitZoneInfluence([{minX:-10,maxX:10,minZ:-10,maxZ:10}],0,0)).toBe(1);
  }finally{field.dispose();set.context.lightField.dispose();set.ownedMaterials.forEach(m=>m.dispose());Object.values(source).forEach(m=>m.dispose());}
});
