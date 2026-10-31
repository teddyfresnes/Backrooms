import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
const { propCounts } = vi.hoisted(() => ({ propCounts: [] as number[] }));
vi.mock('./WorldProps', async () => {
  const three = await import('three');
  return { WorldPropLayer: class {
    group = new three.Group(); ready = Promise.resolve(); count = 0;
    constructor(w: { propPlacements?: unknown[] }) { this.count = w.propPlacements?.length ?? 0; propCounts.push(this.count); }
    dispose() { this.group.removeFromParent(); }
  } };
});
import { WorldView } from './WorldBuilder';
import { generateInfiniteChunk } from '../world/InfiniteWorld';
import type { MaterialSet } from './MaterialLibrary';

it('renders real architecture, roof, fixtures and lighting immediately, then promotes details without rebuilding them', async () => {
  const plan = generateInfiniteChunk('PREVIEW-DETAILS', { x: 0, z: 0, story: 0 });
  // A real non-empty detail input protects against a vacuous empty seed.
  plan.propPlacements = [{ id: 'preview-detail', assetId: 'preview-test-asset', roomId: plan.rooms[0]!.id,
    position: { ...plan.spawn }, rotationY: 0, scale: 1, bounds: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 }, kind: 'room', tone: 1 }];
  const materials = Object.fromEntries(['wall', 'plaster', 'floor', 'ceiling', 'baseboard', 'pitWall', 'pitBottom', 'metal', 'fixtureFrame', 'fixtureGlow', 'void']
    .map(name => [name, name === 'fixtureGlow' || name === 'void' ? new THREE.MeshBasicMaterial() : new THREE.MeshStandardMaterial()])) as unknown as MaterialSet;
  const view = new WorldView(plan, materials, { architectureOnly: true });
  try {
    await view.ready; expect(view.architectureOnly).toBe(true); expect(propCounts).toEqual([0]);
    const architecture = view.group.children.filter(o => o.name.startsWith('regional-'));
    expect(architecture.length).toBeGreaterThan(3);
    const ids = architecture.map(o => o.uuid), lightField = (view as unknown as { regionalLightField: unknown }).regionalLightField;
    await view.promoteDetails(); await view.promoteDetails();
    expect(view.architectureOnly).toBe(false); expect(propCounts).toEqual([0, plan.propPlacements?.length ?? 0]);
    expect(view.group.children.filter(o => o.name.startsWith('regional-')).map(o => o.uuid)).toEqual(ids);
    expect((view as unknown as { regionalLightField: unknown }).regionalLightField).toBe(lightField);
  } finally { view.dispose(); Object.values(materials).forEach(m => m.dispose()); }
});

it('mounts distant same-story neighbours as real architecture previews while keeping nearby details', async () => {
  const { WorldStream } = await import('../core/WorldStream'); propCounts.length = 0;
  const near=generateInfiniteChunk('PREVIEW-DETAILS',{x:0,z:0,story:0}),far=generateInfiniteChunk('PREVIEW-DETAILS',{x:1,z:0,story:0});
  expect(far.spatial).toBeDefined();
  for(const plan of [near,far])plan.propPlacements=[{id:'detail',assetId:'preview-test-asset',roomId:plan.rooms[0]!.id,position:{...plan.spawn},rotationY:0,scale:1,bounds:{minX:0,maxX:1,minZ:0,maxZ:1},kind:'room',tone:1}];
  const materials=Object.fromEntries(['wall','plaster','floor','ceiling','baseboard','pitWall','pitBottom','metal','fixtureFrame','fixtureGlow','void']
    .map(name=>[name,name==='fixtureGlow'||name==='void'?new THREE.MeshBasicMaterial():new THREE.MeshStandardMaterial()])) as unknown as MaterialSet;
  const physics={addChunk(){},removeChunk(){},batchChunkChanges(run:()=>void){run();}};
  const stream=new WorldStream('PREVIEW-DETAILS',near,new THREE.Scene(),Object.fromEntries(['yellow','dim','red','white'].map(b=>[b,materials])) as never,physics as never);
  const probe=stream as unknown as {mountChunk:(plan:typeof near)=>void;chunks:Map<string,{view:WorldView}>};
  try {
    probe.mountChunk(near);probe.mountChunk(far);await stream.waitForVisualAssets();
    expect(probe.chunks.get('0:0:0')!.view.architectureOnly).toBe(false);
    const preview=probe.chunks.get('1:0:0')!.view;expect(preview.architectureOnly).toBe(true);expect(propCounts).toEqual([1,0]);
    expect(preview.group.getObjectByName('regional-carpet-floors')).toBeDefined();
    await preview.promoteDetails();expect(propCounts).toEqual([1,0,1]);
  } finally {stream.dispose();Object.values(materials).forEach(m=>m.dispose());}
});
