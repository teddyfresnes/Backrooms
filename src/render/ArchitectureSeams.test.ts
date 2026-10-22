import { expect, it } from 'vitest';
import * as THREE from 'three';
import { generateInfiniteChunk } from '../world/InfiniteWorld';
import { profilePrism } from '../world/SpatialGeometry';
import { slabVertices, type WalkableSurface } from '../world/WalkableTopology';
import { createFaceExposure } from './FaceExposure';
import { createWalkableBatch } from './WalkableGeometry';
import { createSpatialPrismBatch } from './SpatialGeometry';
import { mountArchitectureBatch, prepareSpatialArchitecture } from './SpatialArchitectureBuffers';

const flat = (y: number) => ({ kind: 'flat' as const, y });
const slab: WalkableSurface = { id: 'slab', ownerStory: 0, layer: 'room', role: 'floor', bounds: { minX: 0, maxX: 6, minZ: 0, maxZ: 4 },
  profile: flat(3), ceilingY: 6, thickness: .16, support: 'slab', access: 'open', edges: 'architecture' };

it('owns the floor/lintel seam once and removes the internal wall/slab interface without opening a hole', () => {
  const lintel = profilePrism('lintel', { minX: 4, maxX: 7, minZ: 0, maxZ: 4 }, flat(2), flat(3));
  const wall = profilePrism('support', { minX: 0, maxX: 2, minZ: 0, maxZ: 4 }, flat(0), flat(2.84));
  const exposure = createFaceExposure([{ source: slab, vertices: slabVertices(slab) }, ...[lintel, wall].map(source => ({ source, vertices: source.vertices }))]);
  const geometries = [createWalkableBatch([slab], 'top', 1, false, undefined, true, exposure), createWalkableBatch([slab], 'underside', 1, false, undefined, true, exposure),
    createSpatialPrismBatch([lintel, wall], 1, undefined, exposure)];
  const material = new THREE.MeshBasicMaterial(), meshes = geometries.map(g => { const m = new THREE.Mesh(g, material); m.updateMatrixWorld(); return m; });
  try {
    for (const x of [1.137, 3.137, 5.137, 6.137]) {
      const hits = new THREE.Raycaster(new THREE.Vector3(x, 4, 1.317), new THREE.Vector3(0, -1, 0), 0, 1.01).intersectObjects(meshes);
      expect(hits).toHaveLength(1); expect(hits[0]!.point.y).toBeCloseTo(3);
    }
    const underside = new THREE.Raycaster(new THREE.Vector3(1.137, 2.5, 1.317), new THREE.Vector3(0, 1, 0), 0, .4).intersectObjects(meshes);
    expect(underside).toHaveLength(0); // Inside the solid support: neither internal face survives.
  } finally { geometries.forEach(g => g.dispose()); material.dispose(); }
});

it('clips a trapezoidal ramp cheek against its neighbouring ceiling and retains the exact slope and UV phase', () => {
  const ramp: WalkableSurface = { ...slab, id: 'roof-ramp', profile: { kind: 'linear', axis: 'x', startY: 3, endY: 5 } };
  const neighbor = profilePrism('roof-lintel', { minX: 4, maxX: 7, minZ: 0, maxZ: 4 }, flat(4.5), flat(5));
  const exposure = createFaceExposure([{ source: ramp, vertices: slabVertices(ramp) }, { source: neighbor, vertices: neighbor.vertices }]);
  const g = createSpatialPrismBatch([neighbor], 1, { x: 224, y: 10.8, z: -112 }, exposure);
  const material = new THREE.MeshBasicMaterial(), mesh = new THREE.Mesh(g, material); mesh.updateMatrixWorld();
  try {
    // On the north cheek the sloping ceiling and lintel overlap only a thin
    // trapezoid. AABB clipping would incorrectly delete this exposed point.
    const hits = new THREE.Raycaster(new THREE.Vector3(4.137, 4.85, -1), new THREE.Vector3(0, 0, 1), 0, 1.01).intersectObject(mesh);
    expect(hits).toHaveLength(1); expect(hits[0]!.uv!.x).toBeCloseTo((4.137 + 224) / 2.05, 4);
    expect(exposure(neighbor, 5)).toBeDefined();
  } finally { g.dispose(); material.dispose(); }
});

// Independent triangle intersection audit on the emitted Float32 buffers,
// including all material batches. Shared edges have zero area.
type Triangle = { xy: number[][]; bounds: number[]; name: string };
const intersectArea = (a: number[][], b: number[][]) => {
  let p = a;
  const cross = (u: number[], v: number[], w: number[]) => (v[0]!-u[0]!)*(w[1]!-u[1]!) - (v[1]!-u[1]!)*(w[0]!-u[0]!);
  const orientation = Math.sign(cross(b[0]!, b[1]!, b[2]!));
  for (let k = 0; k < 3 && p.length; k++) {
    const u = b[k]!, v = b[(k+1)%3]!, q: number[][] = [];
    for (let i = 0; i < p.length; i++) {
      const x = p[i]!, y = p[(i+1)%p.length]!, dx = cross(u,v,x)*orientation, dy = cross(u,v,y)*orientation;
      if (dx >= -1e-8) q.push(x);
      if ((dx > 0) !== (dy > 0)) { const t = dx/(dx-dy); q.push(x.map((s,j) => s+(y[j]!-s)*t)); }
    }
    p = q;
  }
  return Math.abs(p.reduce((s,v,i) => { const w=p[(i+1)%p.length]!; return s+v[0]!*w[1]!-w[0]!*v[1]!; },0))/2;
};

it('emits no overlapping axis-plane triangles across floors, roofs and structure in normal rooms and atrium/stair entrances', () => {
  let triangleCount = 0; const errors: string[] = [];
  for (let n = 0; n < 16; n++) {
    const plan = generateInfiniteChunk(`REGIONAL-AUDIT-${n}`, { x: 0, z: 0, story: 0 }), bins = new Map<string, Triangle[]>();
    for (const batch of prepareSpatialArchitecture(plan)) {
      const g = mountArchitectureBatch(batch), p = g.getAttribute('position'), normal = g.getAttribute('normal');
      for (let i = 0; i < p.count; i += 3) {
        const coords = [0,1,2].map(a => [0,1,2].map(j => p.getComponent(i+j,a)));
        const fixed = coords.findIndex(c => Math.max(...c)-Math.min(...c)<.00001); if (fixed<0) continue;
        const axes = [0,1,2].filter(a => a!==fixed), xy = [0,1,2].map(j => axes.map(a => coords[a]![j]!));
        const bounds = [Math.min(...xy.map(v=>v[0]!)), Math.max(...xy.map(v=>v[0]!)), Math.min(...xy.map(v=>v[1]!)), Math.max(...xy.map(v=>v[1]!))];
        if (bounds[1]!-bounds[0]!<.00001||bounds[3]!-bounds[2]!<.00001) continue;
        const key = `${fixed}/${Math.sign(normal.getComponent(i,fixed))}/${Math.round(coords[fixed]![0]!*10000)}`, bin = bins.get(key)??[];
        bin.push({ xy,bounds,name:batch.name }); bins.set(key,bin); triangleCount++;
      }
      g.dispose();
    }
    for (const [key, triangles] of bins) {
      triangles.sort((a,b)=>a.bounds[0]!-b.bounds[0]!);
      for (let i=0;i<triangles.length;i++) for(let j=i+1;j<triangles.length;j++) {
        const a=triangles[i]!,b=triangles[j]!;
        if(b.bounds[0]!>=a.bounds[1]!-.00001)break;
        if(b.bounds[2]!>=a.bounds[3]!-.00001||b.bounds[3]!<=a.bounds[2]!+.00001)continue;
        const overlap=intersectArea(a.xy,b.xy);
        if(overlap>.0001 && errors.length<12)errors.push(`${n}/${key}: ${a.name}/${b.name} area=${overlap}`);
      }
    }
  }
  expect(triangleCount).toBeGreaterThan(100000); expect(errors).toEqual([]);
}, 30000);
