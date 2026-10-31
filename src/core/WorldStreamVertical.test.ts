import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
vi.mock('@dimforge/rapier3d', async () => import('../../node_modules/@dimforge/rapier3d/rapier.js'));
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { generateWorld } from '../world/generateWorld';
import { surfaceCollider, type WalkableSurface } from '../world/WalkableTopology';
import { WorldStream } from './WorldStream';
import { generateInfiniteChunk, getChunkWorldOffset, createChunkKey } from '../world/InfiniteWorld';
import type { BiomeMaterialSets, MaterialSet } from '../render/MaterialLibrary';
import type { ChunkCoord } from '../world/InfiniteWorld';
import type { WorldPlan } from '../world/types';
import { predictFallOwners } from './FallPrefetch';

it('mounts prepared real fall owners one per frame before their landing is reached', async () => {
  const plan=generateInfiniteChunk('REGIONAL-AUDIT-2',{x:0,z:0,story:0});
  const cell=plan.spatial!.cells.find(c=>c.mode==='gallery'&&c.atriumLower===-2)!;
  const position=new THREE.Vector3((cell.bounds.minX+cell.bounds.maxX)/2,cell.floorY+.865,(cell.bounds.minZ+cell.bounds.maxZ)/2-5),velocity=new THREE.Vector3(0,-22,0);
  const forecast=predictFallOwners(plan.seed,position,velocity);expect(forecast).toContainEqual({x:0,z:0,story:-2});
  const material=Object.fromEntries(['wall','plaster','floor','ceiling','baseboard','pitWall','pitBottom','metal','fixtureFrame','fixtureGlow','void']
    .map(name=>[name,name==='fixtureGlow'||name==='void'?new THREE.MeshBasicMaterial():new THREE.MeshStandardMaterial()])) as unknown as MaterialSet;
  const sets=Object.fromEntries(['yellow','red','white','dim'].map(k=>[k,material])) as BiomeMaterialSets;
  const physics=await PhysicsWorld.create({...plan,colliders:[]}),retained=physics.world.colliders.len();
  const stream=new WorldStream(plan.seed,plan,new THREE.Scene(),sets,physics);
  type Probe={initialized:boolean;worker:unknown;workerInFlight:unknown;mountChunk(plan:WorldPlan,coord:ChunkCoord):void;clearMountedChunks():void;
    preparedChunks:Map<string,{plan:WorldPlan}>;verticalPrefetchQueue:ChunkCoord[];enqueueVerticalPrefetch(c:ChunkCoord,priority:boolean):void};
  const probe=stream as unknown as Probe;probe.initialized=true;
  probe.mountChunk(plan,{x:0,z:0,story:0});
  for(const coord of forecast)probe.preparedChunks.set(createChunkKey(coord),{plan:generateInfiniteChunk(plan.seed,coord)});
  probe.worker={postMessage(){}};
  const mount=vi.spyOn(probe,'mountChunk');
  try {
    for(let i=0;i<forecast.length;i++){
      mount.mockClear();stream.update(i/60,1/60,position,new THREE.Vector3(0,-1,0),velocity);
      expect(mount.mock.calls.length).toBeLessThanOrEqual(1);
    }
    const target=generateInfiniteChunk(plan.seed,{x:0,z:0,story:-2}),offset=getChunkWorldOffset({x:0,z:0,story:-2});
    const surface=target.topology!.surfaces.find(s=>s.role==='floor'&&s.profile.kind==='flat'&&Math.abs(s.profile.y-cell.floorY)<.01&&s.bounds.minX>=cell.bounds.minX&&s.bounds.maxX<=cell.bounds.maxX&&s.bounds.minZ>=cell.bounds.minZ&&s.bounds.maxZ<=cell.bounds.maxZ)!;
    expect(surface).toBeDefined();const arrival={x:(surface.bounds.minX+surface.bounds.maxX)/2,y:cell.floorY+offset.y,z:(surface.bounds.minZ+surface.bounds.maxZ)/2};
    const hit=physics.world.castRay(new RAPIER.Ray({x:arrival.x,y:arrival.y+.5,z:arrival.z},{x:0,y:-1,z:0}),1,true,
      undefined,undefined,undefined,undefined,c=>physics.isEnvironmentCollider(c)&&physics.getEnvironmentKind(c)==='floor');
    expect(hit?.timeOfImpact).toBeCloseTo(.5,3);expect(offset.y).toBe(-10.8);
    expect(position.y-arrival.y).toBeGreaterThan(8);expect(stream.getDebugCounts().chunks).toBeLessThanOrEqual(21);
    probe.workerInFlight={};for(let i=1;i<40;i++)probe.enqueueVerticalPrefetch({x:0,z:0,story:-i},true);
    expect(probe.verticalPrefetchQueue.length).toBeLessThanOrEqual(8);
  } finally {
    probe.worker=undefined;probe.workerInFlight=undefined;probe.clearMountedChunks();
    expect(physics.world.colliders.len()).toBe(retained);physics.dispose();Object.values(material).forEach(m=>m.dispose());
  }
},30000);

it('keeps raised support in its owner story, restores both layers and releases an unsupported fall', async () => {
  const plan = generateWorld('VERTICAL-STREAM-SAVE');
  const lower: WalkableSurface = { id: 'test/lower', ownerStory: 0, layer: 'lower', role: 'floor', bounds: { minX: -4, maxX: 4, minZ: -4, maxZ: 4 },
    profile: { kind: 'flat', y: -.9 }, ceilingY: 2.04, support: 'slab', thickness: .16, access: 'open', edges: 'architecture' };
  const upper: WalkableSurface = { ...lower, id: 'test/upper', layer: 'upper', role: 'balcony', profile: { kind: 'flat', y: 2.2 }, ceilingY: 4.85 };
  plan.features = []; plan.spawn = { x: 0, y: -.035, z: 0 };
  plan.topology = { version: 1, ownerStory: 0, surfaces: [lower, upper], connections: [], volumes: [], diagnostics: [] };
  plan.colliders = [lower, upper].map(surfaceCollider); const physics = await PhysicsWorld.create(plan);
  const stream = new WorldStream(plan.seed, plan, new THREE.Scene(), {} as never, physics);
  // Render mounting is covered separately; these production queries use real physics.
  const chunks = (stream as unknown as { chunks: Map<string, unknown> }).chunks;
  chunks.set('0:0:0', { plan, coord: { x: 0, z: 0, story: 0 }, offset: new THREE.Vector3() });
  try {
    const above = { x: 0, y: 3.065, z: 0 }, below = { x: 0, y: -.035, z: 0 };
    expect(stream.supportedCoordAt(above).story).toBe(0); expect(stream.supportedCoordAt(below).story).toBe(0);
    const highAnchor = stream.surfaceAnchorAt(above), lowAnchor = stream.surfaceAnchorAt(below);
    expect(highAnchor?.id).toBe(upper.id); expect(lowAnchor?.id).toBe(lower.id);
    expect(stream.restoreSurfacePosition({ ...above, y: 3.1 }, highAnchor).y).toBeCloseTo(above.y);
    expect(stream.restoreSurfacePosition({ ...below, y: -.1 }, lowAnchor).y).toBeCloseTo(below.y);
    expect(stream.supportedCoordAt({ x: 0, y: -4, z: 0 }).story).toBe(-1);
    physics.addChunk('obstructed-save', [{ id: 'obstacle', kind: 'barrier', center: { x: 0, y: 3, z: 0 }, halfExtents: { x: 1, y: .5, z: 1 } }], { x: 0, y: 0, z: 0 });
    expect(stream.restoreSurfacePosition(above, highAnchor)).toEqual(plan.spawn);
  } finally { chunks.clear(); physics.dispose(); }
});

it('prepares real visible owners, restores an irreversible landing and releases repeated mounted layers', async () => {
  let origin: WorldPlan | undefined;
  for (let i = 0; i < 32; i++) {
    const w = generateInfiniteChunk(`REGIONAL-AUDIT-${i}`, { x: 0, z: 0, story: 0 });
    if (w.spatial?.landmarks.some(l => l.kind === 'ouverture-haute')) { origin = w; break; }
  }
  expect(origin).toBeDefined();
  const plan = origin!, drop = plan.topology!.connections.find(c => c.kind === 'drop')!;
  const position = { ...drop.arrival!, y: drop.arrival!.y + .865 };
  const source = Object.fromEntries(['wall', 'plaster', 'floor', 'ceiling', 'baseboard', 'pitWall', 'pitBottom', 'metal', 'fixtureFrame', 'fixtureGlow', 'void']
    .map(name => [name, name === 'fixtureGlow' || name === 'void' ? new THREE.MeshBasicMaterial() : new THREE.MeshStandardMaterial()])) as unknown as MaterialSet;
  const sets = Object.fromEntries(['yellow', 'red', 'white', 'dim'].map(k => [k, source])) as BiomeMaterialSets;
  const physics = await PhysicsWorld.create({ ...plan, colliders: [] });
  const scene = new THREE.Scene(), retainedColliders = physics.world.colliders.len();
  type Probe = { initialized: boolean; mountChunk(plan: WorldPlan, coord: ChunkCoord): void; clearMountedChunks(): void;
    spatialVisibleCoords(sources: { coord: ChunkCoord; plan: WorldPlan }[], position: typeof plan.spawn): ChunkCoord[] };
  const stream = new WorldStream(plan.seed, plan, scene, sets, physics), probe = stream as unknown as Probe;
  probe.initialized = true;
  try {
    const opening = plan.spatial!.landmarks.find(l => l.kind === 'ouverture-haute')!;
    const visible = probe.spatialVisibleCoords([{ coord: plan.spatial!.owner, plan }], opening.position);
    expect(visible).toContainEqual(drop.toOwner); expect(visible.length).toBeLessThanOrEqual(12);
    for (let cycle = 0; cycle < 3; cycle++) {
      probe.mountChunk(plan, plan.spatial!.owner);
      expect(await stream.prepareSavedChunk(plan.spatial!.owner)).toBe(true);
      await stream.waitForVisualAssets();
      const low = generateInfiniteChunk(plan.seed, drop.toOwner!), offset = getChunkWorldOffset(drop.toOwner!);
      expect(stream.getDebugCounts().chunks).toBeGreaterThanOrEqual(3);
      expect(stream.supportedCoordAt(position)).toEqual(drop.toOwner);
      const anchor = stream.surfaceAnchorAt(position); expect(anchor?.id).toBe(drop.to);
      expect(stream.restoreSurfacePosition(position, anchor, drop.toOwner)).toEqual(position);
      const migrated = stream.restoreSurfacePosition({ ...position, y: position.y + 8 }, { version: 1, id: 'obsolete', layer: 'obsolete' }, drop.toOwner);
      expect(migrated).toEqual(position);
      expect(physics.canStandAt(migrated)).toBe(true);
      expect(low.topology!.surfaces.some(s => s.id === anchor!.id)).toBe(true);
      expect(stream.getCharacterPits().every(p => p.bottom < 0)).toBe(true);
      expect(offset.y).toBe(drop.toOwner!.story * 5.4);
      expect(createChunkKey(stream.supportedCoordAt(position))).toBe(createChunkKey(drop.toOwner!));
      probe.clearMountedChunks();
      expect(physics.world.colliders.len()).toBe(retainedColliders);
      expect(scene.children).toHaveLength(0);
    }
  } finally { stream.dispose(); physics.dispose(); Object.values(source).forEach(m => m.dispose()); }
});
