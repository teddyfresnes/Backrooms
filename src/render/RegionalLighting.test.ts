import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { applyRegionalLighting, bakeRegionalLightData, createRegionalLightField, setRegionalLightNeighbor } from './RegionalLighting';
import { createFluorescentLightField, createZonalMaterialSet } from './ZonalLighting';
import { generateWorld } from '../world/generateWorld';
import { WorldView } from './WorldBuilder';
import type { MaterialSet } from './MaterialLibrary';
import type { WalkableSurface } from '../world/WalkableTopology';

const sourceMaterials = () => Object.fromEntries(['wall', 'plaster', 'floor', 'ceiling', 'baseboard', 'pitWall', 'pitBottom', 'metal', 'fixtureFrame', 'fixtureGlow', 'void']
  .map(name => [name, name === 'fixtureGlow' || name === 'void' ? new THREE.MeshBasicMaterial() : new THREE.MeshStandardMaterial()])) as unknown as MaterialSet;
const base: WalkableSurface = { id: 'lower', ownerStory: 0, layer: 'lower', role: 'floor', bounds: { minX: -12, maxX: 12, minZ: -12, maxZ: 12 },
  profile: { kind: 'flat', y: -5 }, ceilingY: -2, ceilingProfile: { kind: 'flat', y: -2 }, thickness: .16, support: 'slab', access: 'open', edges: 'architecture' };
const disposeField = (field: ReturnType<typeof createRegionalLightField>) => { field.texture.dispose(); field.lighting.dispose(); };

it('keeps historical exposure in its volume and supports more than three overlapping floors', () => {
  const plan = generateWorld('REGIONAL-LIGHT-STACK');
  plan.topology!.surfaces = Array.from({ length: 5 }, (_, i) => ({ ...base, id: `floor-${i}`, layer: `layer-${i}`, profile: { kind: 'flat' as const, y: -5 + i * 6 }, ceilingY: -2 + i * 6, ceilingProfile: { kind: 'flat' as const, y: -2 + i * 6 } }));
  plan.walls = []; plan.columns = []; plan.solidMasses = []; plan.unlitZones = [];
  plan.lights = [{ id: 'lamp', x: 0, z: 0, ceilingY: 22, width: 1.55, rotation: 0, intensity: 1.08, color: 0xffefb8, dead: false, unstable: false, phase: 0, roomId: 'fixture', level: 0 }];
  const field = createRegionalLightField(plan), values = field.lighting.image.data as Uint8Array;
  expect(field.layers).toBe(5);
  const at = (layer: number) => values[((layer * 98 + 49) * 98 + 49) * 4]!;
  for (let i = 0; i < 4; i++) expect(at(i)).toBe(Math.round(.22 * 255));
  const reference = createFluorescentLightField(plan);
  expect(at(4)).toBe((reference.image.data as Uint8Array)[(48 * 96 + 48) * 2]);
  expect(at(4)).toBeGreaterThan(190);
  reference.dispose(); disposeField(field);
});

it('preserves exposure and contact fields when a complete room is translated vertically', () => {
  const plan = generateWorld('TRANSLATED-LIGHT'); plan.unlitZones = []; plan.columns = []; plan.solidMasses = [];
  const fields = [-12, 0, 7].map(y => {
    plan.topology!.surfaces = [{ ...base, profile: { kind: 'flat', y }, ceilingY: y + 2.74, ceilingProfile: { kind: 'flat', y: y + 2.74 } }];
    plan.lights = [{ id: 'lamp', x: 0, z: 0, ceilingY: y + 2.74, width: 1.55, rotation: 0, intensity: 1.08, color: 0xffffe4, dead: false, unstable: false, phase: 0, roomId: 'fixture', level: 0 }];
    plan.walls = [{ id: 'wall', x: -8, z: 0, length: 20, orientation: 'z', thickness: 1.4, bottom: y, height: 2.74, tint: 1, collision: true, kind: 'wallpaper' }];
    return createRegionalLightField(plan);
  });
  try { expect(fields[0]!.lighting.image.data).toEqual(fields[1]!.lighting.image.data); expect(fields[2]!.lighting.image.data).toEqual(fields[1]!.lighting.image.data); }
  finally { fields.forEach(disposeField); }
});

it('replaces the zonal sample without multiplying exposure a second time', () => {
  const plan = generateWorld('REGIONAL-SHADER'), source = sourceMaterials(), zonal = createZonalMaterialSet(source, plan), field = createRegionalLightField(plan);
  try {
    const m = zonal.materials.wall; applyRegionalLighting(m, field);
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('blackout = localLighting.b');
    expect(shader.fragmentShader).toContain('(zonalChunkPosition.y - localVolume.x) / wallHeight');
    expect(shader.fragmentShader).not.toContain('mix(0.35, 1.14');
    expect(shader.fragmentShader).not.toContain('texture2D(lightField, lightFieldUv).rg');
  } finally { disposeField(field); zonal.context.lightField.dispose(); zonal.ownedMaterials.forEach(m => m.dispose()); Object.values(source).forEach(m => m.dispose()); }
});

it('constructs both modes, keeps classic baking and releases both modern volume textures', async () => {
  const dispose = vi.spyOn(THREE.DataTexture.prototype, 'dispose'), source = sourceMaterials();
  try {
    for (const lightingMode of ['modern', 'legacy'] as const) {
      const plan = generateWorld('REGIONAL-RENDER-MODES'); plan.features = []; plan.propPlacements = [];
      const view = new WorldView(plan, source, { lightingMode }); await view.ready;
      const floor = view.group.getObjectByName('regional-carpet-floors') as THREE.Mesh;
      expect(floor.geometry.getAttribute('position').count).toBeGreaterThan(0);
      expect(floor.material instanceof THREE.Material && floor.material.customProgramCacheKey().includes('regional-zonal')).toBe(lightingMode === 'modern');
      view.dispose();
    }
    for (const name of ['regional-volume-bounds', 'regional-fluorescent-field']) expect(dispose.mock.contexts.filter(t => (t as THREE.Texture).name === name)).toHaveLength(1);
  } finally { dispose.mockRestore(); Object.values(source).forEach(m => m.dispose()); }
});

it('mounts the exact structured-cloned worker light buffers without a second bake', () => {
  const plan = generateWorld('REGIONAL-WORKER-LIGHT');
  const data = structuredClone(bakeRegionalLightData(plan));
  const field = createRegionalLightField(plan, data);
  expect(field.data.bounds).toBe(data.bounds); expect(field.data.lighting).toBe(data.lighting);
  const encoded = field.texture.image.data as Float32Array | Uint16Array, value = encoded[(49 * 98 + 49) * 4]!;
  expect(encoded instanceof Uint16Array ? THREE.DataUtils.fromHalfFloat(value) : value).toBeCloseTo(data.bounds[(48 * 96 + 48) * 4]!, 2);
  disposeField(field);
});

// Numeric reference for the shader's four texel fetches, using the actual bake.
// Resolve each tap independently before interpolating, rather than choosing an
// atlas row at the fragment and filtering unrelated layers across that row.
const sampleAtlas = (data: ReturnType<typeof bakeRegionalLightData>, x: number, y: number, z: number) => {
  const px = (x / data.size + .5) * 96 - .5, pz = (z / data.size + .5) * 96 - .5, bx = Math.floor(px), bz = Math.floor(pz);
  const wx = px - bx, wz = pz - bz; let exposure = 0, coverage = 0;
  for (const [dx, dz, weight] of [[0, 0, (1-wx)*(1-wz)], [1, 0, wx*(1-wz)], [0, 1, (1-wx)*wz], [1, 1, wx*wz]]) {
    const pixel = Math.max(0, Math.min(95, bx + dx!)) + Math.max(0, Math.min(95, bz + dz!)) * 96;
    let best = Infinity, selected = -1;
    for (let layer = 0; layer < data.layers; layer++) {
      const i = (layer * 96 * 96 + pixel) * 4, floor = data.bounds[i]!, ceiling = data.bounds[i + 1]!;
      if (floor > ceiling) continue;
      const distance = Math.abs(y - Math.max(floor, Math.min(ceiling, y))), score = distance * 10000 + Math.abs(y - floor);
      if (score < best) { best = score; selected = i; }
    }
    if (selected >= 0) { exposure += data.lighting[selected]! / 255 * weight!; coverage += weight!; }
  }
  return coverage > .00001 ? exposure / coverage : .22;
};

it('does not draw a bright/dark straight seam where an overlapping lower floor ends below a continuous upper room', () => {
  const plan = generateWorld('ATLAS-LAYER-SEAM'); plan.rooms = []; plan.walls = []; plan.columns = []; plan.solidMasses = []; plan.unlitZones = [];
  plan.topology!.surfaces = [
    { ...base, id: 'lower-half', bounds: { minX: -12, maxX: 0, minZ: -12, maxZ: 12 }, profile: { kind: 'flat', y: 0 }, ceilingY: 3, ceilingProfile: { kind: 'flat', y: 3 } },
    { ...base, id: 'upper-continuous', profile: { kind: 'flat', y: 6 }, ceilingY: 9, ceilingProfile: { kind: 'flat', y: 9 } },
  ];
  plan.lights = [{ id: 'lower-lamp', x: -1, z: 0, ceilingY: 3, width: 1.55, rotation: 0, intensity: 1.08, color: 0xffefb8, dead: false, unstable: false, phase: 0, roomId: 'lower-half', level: 0 }];
  const atlas = bakeRegionalLightData(plan), samples = [-1, -.58, -.01, -.00001, .00001, .01, .58, 1].map(x => sampleAtlas(atlas, x, 6.001, .137));
  expect(atlas.layers).toBe(2); expect(Math.max(...samples) - Math.min(...samples)).toBeLessThan(.00001);
  expect(samples[0]).toBeCloseTo(56 / 255, 5);
  expect(sampleAtlas(atlas, -1, .001, .137)).toBeGreaterThan(.8);
});

it('renormalizes missing shaft texels and prefers the closest real floor inside a tall atrium', () => {
  const data = { size: 112, layers: 2, bounds: new Float32Array(96 * 96 * 8), lighting: new Uint8Array(96 * 96 * 8) };
  for (let i = 0; i < data.bounds.length; i += 4) { data.bounds[i] = 1e6; data.bounds[i + 1] = -1e6; }
  for (const layer of [0, 1]) for (const z of [47, 48]) {
    const i = (layer * 96 * 96 + z * 96 + 47) * 4;
    data.bounds[i] = layer * 6; data.bounds[i + 1] = 18;
    data.lighting[i] = layer ? 204 : 56;
  }
  expect(sampleAtlas(data, -.01, 6.001, 0)).toBeCloseTo(.8, 6);
  expect(sampleAtlas(data, .4, 6.001, 0)).toBeCloseTo(.8, 6);
  expect(sampleAtlas(data, -.01, .001, 0)).toBeCloseTo(56 / 255, 6);
});

it('uses identical samples across chunk gutters despite different layer counts, and restores them when a neighbour leaves', () => {
  const constant = (floors: number[], values: number[]) => {
    const data = { size: 112, layers: floors.length, bounds: new Float32Array(96*96*4*floors.length), lighting: new Uint8Array(96*96*4*floors.length) };
    for (let layer=0;layer<floors.length;layer++) for(let pixel=0;pixel<96*96;pixel++) {
      const i=(layer*96*96+pixel)*4;data.bounds[i]=floors[layer]!;data.bounds[i+1]=floors[layer]!+3;data.lighting[i]=values[layer]!;data.lighting[i+3]=255;
    }
    return data;
  };
  const plan=generateWorld('CHUNK-LIGHT-GUTTER'), aData=constant([0,6,12,18,24],[30,70,110,150,190]), bData=constant([18],[230]);
  const a=createRegionalLightField(plan,aData),b=createRegionalLightField(plan,bData),before=aData.bounds.slice();
  const at = (field: typeof a,x:number,y:number,z:number) => {
    const px=(x/112+.5)*96-.5,pz=(z/112+.5)*96-.5,ix=Math.floor(px),iz=Math.floor(pz),wx=px-ix,wz=pz-iz;
    const bounds=field.texture.image.data as Float32Array|Uint16Array, read=(i:number)=>bounds instanceof Uint16Array?THREE.DataUtils.fromHalfFloat(bounds[i]!):bounds[i]!, light=field.lighting.image.data as Uint8Array;let sum=0;
    for(const [dx,dz,w] of [[0,0,(1-wx)*(1-wz)],[1,0,wx*(1-wz)],[0,1,(1-wx)*wz],[1,1,wx*wz]]) {
      let best=Infinity,value=0;
      for(let layer=0;layer<field.layers;layer++) {
        const i=(layer*98*98+(iz+dz!+1)*98+ix+dx!+1)*4,floor=read(i),ceiling=read(i+1);
        const score=Math.abs(y-Math.max(floor,Math.min(ceiling,y)))*10000+Math.abs(y-floor);
        if(floor<=ceiling&&score<best){best=score;value=light[i]!;}
      }
      sum+=value*w!;
    }
    return sum;
  };
  try {
    setRegionalLightNeighbor(a,1,0,bData);setRegionalLightNeighbor(b,-1,0,aData);
    expect(at(a,56-.000001,18.001,.137)).toBeCloseTo(at(b,-56+.000001,18.001,.137),3);
    expect(at(b,-56,18.001,.137)).toBeCloseTo(190,5); // A's floor 18, never A's layer zero.
    setRegionalLightNeighbor(b,-1,0);expect(at(b,-56,18.001,.137)).toBeCloseTo(230,5);
    expect(aData.bounds).toEqual(before); // Cached CPU originals never accumulate neighbour edits.
  } finally {disposeField(a);disposeField(b);}
});

it('keeps the one-layer path to two filtered main-fragment reads with premultiplied valid heights', () => {
  const plan=generateWorld('SINGLE-LAYER-LIGHT-FAST-PATH');plan.rooms=[];plan.topology!.surfaces=[base];
  const data=bakeRegionalLightData(plan),field=createRegionalLightField(plan,data),source=sourceMaterials(),zonal=createZonalMaterialSet(source,plan,field);
  try {
    expect(field.layers).toBe(1);expect(field.texture.type).toBe(THREE.HalfFloatType);expect(field.texture.magFilter).toBe(THREE.LinearFilter);
    expect(field.lighting.magFilter).toBe(THREE.LinearFilter);
    const encoded=field.texture.image.data as Uint16Array;
    const inside=(49*98+49)*4;expect(THREE.DataUtils.fromHalfFloat(encoded[inside]!)).toBe(-5);expect(THREE.DataUtils.fromHalfFloat(encoded[inside+3]!)).toBe(1);
    expect(encoded[0]).toBe(0);expect(encoded[3]).toBe(0); // Empty premultiplied height, never an invalid sentinel.
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
    zonal.materials.wall.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms,{} as THREE.WebGLRenderer);
    const main=shader.fragmentShader.slice(shader.fragmentShader.indexOf('void main()'));
    expect(main.match(/texture2D\(regional/g)).toHaveLength(2);expect(main).not.toContain('regionalTap(');
    expect(main).toContain('heightSample.xy / heightSample.a');expect(main).toContain('fract(dot(vZonalWorldPosition.xz');
  } finally {disposeField(field);zonal.context.lightField.dispose();zonal.ownedMaterials.forEach(m=>m.dispose());Object.values(source).forEach(m=>m.dispose());}
});
