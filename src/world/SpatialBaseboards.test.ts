import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSpatialBaseboards, BASEBOARD_DEPTH } from './SpatialBaseboards';
import { baseboardExclusions } from './BaseboardZones';
import { cleanSpatialWallJunctions } from './SpatialWallJunctions';
import { profilePrism, prismCollider } from './SpatialGeometry';
import { cutRects, type HeightProfile, type WalkableSurface } from './WalkableTopology';
import { createSpatialPrismBatch } from '../render/SpatialGeometry';
import { mountArchitectureBatch, prepareSpatialArchitecture } from '../render/SpatialArchitectureBuffers';
import type { Rect, WorldPlan } from './types';
import { generateInfiniteChunk, clearInfiniteWorldCaches } from './InfiniteWorld';
import { auditAxisPlaneTriangles } from '../../tests/support/geometry-audit';
import { auditFinishCoverage } from '../../tests/support/finish-audit';

const flat = (y: number): HeightProfile => ({ kind: 'flat', y });
const rect = (minX: number, maxX: number, minZ: number, maxZ: number): Rect => ({ minX, maxX, minZ, maxZ });
const floor = (bounds = rect(-8, 8, -8, 8), y = 0, id = 'floor'): WalkableSurface => ({
  id, roomId: id, ownerStory: 0, layer: 'test', role: 'floor', bounds, profile: flat(y), ceilingY: y + 3,
  thickness: .16, support: 'slab', access: 'open', edges: 'architecture',
});
const fixture = (boxes: { id: string; bounds: Rect; bottom?: number; top?: number }[], floors = [floor()]): WorldPlan => {
  const prisms = boxes.map(b => profilePrism(b.id, b.bounds, flat(b.bottom ?? 0), flat(b.top ?? 3)));
  return { version: 16, size: 112, seed: 'FINISH-FIXTURE', wallHeight: 3, rooms: [], walls: boxes.map(b => {
    const alongX = b.bounds.maxX - b.bounds.minX > b.bounds.maxZ - b.bounds.minZ;
    return { id: b.id, x: (b.bounds.minX + b.bounds.maxX) / 2, z: (b.bounds.minZ + b.bounds.maxZ) / 2,
      orientation: alongX ? 'x' : 'z', length: alongX ? b.bounds.maxX - b.bounds.minX : b.bounds.maxZ - b.bounds.minZ,
      thickness: alongX ? b.bounds.maxZ - b.bounds.minZ : b.bounds.maxX - b.bounds.minX, bottom: b.bottom ?? 0,
      height: (b.top ?? 3) - (b.bottom ?? 0), tint: 1, kind: 'wallpaper', collision: true };
  }), columns: [], solidMasses: [], lights: [], missingCeilingTiles: [], features: [], detailSockets: [],
  colliders: prisms.map(p => prismCollider(p)), floorRects: floors.map(s => s.bounds), spawn: { x: 0, y: 1, z: 0 },
  topology: { version: 2, ownerStory: 0, surfaces: floors, connections: [], volumes: [], diagnostics: [] },
  spatial: { version: 2, owner: { x: 0, z: 0, story: 0 }, cells: [], ceilings: [], prisms, dependencies: [], interfaces: [], landmarks: [] } };
};
const withMesh = (w: WorldPlan, check: (mesh: THREE.Mesh) => void) => {
  const g = createSpatialPrismBatch(createSpatialBaseboards(w)), m = new THREE.MeshBasicMaterial(), mesh = new THREE.Mesh(g, m); mesh.updateMatrixWorld();
  try { check(mesh); } finally { g.dispose(); m.dispose(); }
};
const hits = (mesh: THREE.Mesh, x: number, z: number, dx: number, dz: number, y = .06) =>
  new THREE.Raycaster(new THREE.Vector3(x, y, z), new THREE.Vector3(dx, 0, dz).normalize(), 0, .4).intersectObject(mesh);

describe('final exposed baseboard contours', () => {
  it('trims every exposed side of a non-BSP pillar and a low crawl wall, with exact mitres', () => {
    const w = fixture([{ id: 'pillar', bounds: rect(-1, 1, -1, 1) }, { id: 'crawl', bounds: rect(3, 5, -.2, .2), top: 1.26 }]);
    const p = createSpatialBaseboards(w);
    expect(p.every(p => !p.collision)).toBe(true);
    const pillar = p.filter(p => p.vertices.some((v, i) => i % 3 === 0 && v < 2));
    expect(Math.max(...pillar.flatMap(p => p.vertices.filter((_, i) => i % 3 === 0)))).toBeCloseTo(1 + BASEBOARD_DEPTH);
    expect(Math.min(...pillar.flatMap(p => p.vertices.filter((_, i) => i % 3 === 0)))).toBeCloseTo(-1 - BASEBOARD_DEPTH);
    withMesh(w, mesh => {
      for (const [x, z, dx, dz] of [[1.3, .13, -1, 0], [-1.3, .13, 1, 0], [.13, 1.3, 0, -1], [.13, -1.3, 0, 1], [4, .5, 0, -1]]) expect(hits(mesh, x!, z!, dx!, dz!)).toHaveLength(1);
      expect(hits(mesh, 1.22, 1.22, -1, -1).length).toBeGreaterThan(0);
    });
  });

  it('keeps an L corner continuous across different wall origins, without buried trim or intersecting triangles', () => {
    const w = fixture([{ id: 'bsp', bounds: rect(-4, .5, -.5, .5) }, { id: 'facade', bounds: rect(-.5, .5, .5, 4) }]);
    w.topology!.surfaces = cutRects([rect(-8, 8, -8, 8)], [rect(-4, .5, -.5, .5), rect(-.5, .5, .5, 4)]).map((b, i) => floor(b, 0, `floor-${i}`));
    withMesh(w, mesh => {
      expect(hits(mesh, -.72, .7, 1, 0)).toHaveLength(1);
      expect(hits(mesh, -.7, .72, 0, -1)).toHaveLength(1);
      expect(hits(mesh, .8, .25, -1, 0)).toHaveLength(1);
    });
    w.spatial!.prisms.push(...createSpatialBaseboards(w));
    const batches = prepareSpatialArchitecture(w).map(b => ({ name: b.name, geometry: mountArchitectureBatch(b) }));
    try { expect(auditAxisPlaneTriangles(batches).errors).toEqual([]); } finally { batches.forEach(b => b.geometry.dispose()); }
  });

  it('builds convex offsets when a narrow niche is smaller than two trim depths', () => {
    const boxes = [{ id: 'left', bounds: rect(-1, 0, -2, 1) }, { id: 'right', bounds: rect(.04, 1, -2, 1) }, { id: 'back', bounds: rect(0, .04, 0, 1) }];
    const w = fixture(boxes);
    w.topology!.surfaces = cutRects([rect(-8, 8, -8, 8)], boxes.map(b => b.bounds)).map((b, i) => floor(b, 0, `f-${i}`));
    w.spatial!.prisms.push(...createSpatialBaseboards(w));
    const batches = prepareSpatialArchitecture(w).map(b => ({ name: b.name, geometry: mountArchitectureBatch(b) }));
    try { expect(auditAxisPlaneTriangles(batches).errors).toEqual([]); } finally { batches.forEach(b => b.geometry.dispose()); }
  });

  it('clips only the bare face and interval, preserving the opposite room and endpoint contacts', () => {
    const w = fixture([{ id: 'shared-wall', bounds: rect(-3, 3, -.2, .2) }]);
    w.baseboardlessZones = [rect(0, 3, 0, 4), rect(-4, -3, -.4, .4)];
    withMesh(w, mesh => {
      expect(hits(mesh, 1, .5, 0, -1)).toHaveLength(0);
      for (const [x, z, dz] of [[-1, .5, -1], [1, -.5, 1], [-2.9, -.5, 1]]) expect(hits(mesh, x!, z!, 0, dz!)).toHaveLength(1);
    });
    expect(baseboardExclusions([rect(-2.998, 2, 0, 4)], 'x', .215, -3, 3)).toEqual([{ min: -3, max: 2 }]);
    expect(baseboardExclusions([rect(3, 4, 0, 4)], 'x', .215, -3, 3)).toEqual([]);
  });

  it('uses each side’s actual floor, including negative datums, raised landings and a sloping approach', () => {
    const ramp = { ...floor(rect(-3, 3, .2, 4)), profile: { kind: 'linear' as const, axis: 'x' as const, startY: 1, endY: 2 }, role: 'ramp' as const };
    const w = fixture([{ id: 'shared', bounds: rect(-3, 3, -.2, .2), bottom: -3, top: 5 }], [floor(rect(-3, 3, -4, -.2), -2), ramp]);
    withMesh(w, mesh => {
      expect(hits(mesh, 0, -.5, 0, 1, -1.94)).toHaveLength(1);
      expect(hits(mesh, 0, .5, 0, -1, 1.56)).toHaveLength(1);
      expect(hits(mesh, 0, .5, 0, -1, .06)).toHaveLength(0);
    });
  });

  it('recognises the union of floor tiles narrower than the trim, without bridging a true void', () => {
    const boxes = [{ id: 'wall', bounds: rect(-3, 3, -.2, .2) }];
    const w = fixture(boxes, [floor(rect(-3, 3, .2, .21)), floor(rect(-3, 3, .21, 4))]);
    withMesh(w, mesh => expect(hits(mesh, 0, .5, 0, -1)).toHaveLength(1));
    w.topology!.surfaces = [floor(rect(-3, 3, .2, .21))];
    expect(createSpatialBaseboards(w)).toEqual([]);
  });

  it('retains trim above a structural threshold that only touches its floor plane', () => {
    const w = fixture([{ id: 'wall', bounds: rect(-3, 3, -.2, .2) },
      { id: 'facade-threshold', bounds: rect(-3, 3, .2, .8), bottom: -.16, top: 0 }],
    [floor(rect(-3, 3, .2, 4))]);
    withMesh(w, mesh => expect(hits(mesh, 0, .5, 0, -1)).toHaveLength(1));
  });

  it('does not add automatic horizontal bands to individual stair treads', () => {
    const w = fixture([{ id: 'stair-cheek', bounds: rect(-3, 3, -.2, .2), top: 5 }],
      [{ ...floor(rect(-3, 3, .2, 4), 1), role: 'stair' }]);
    expect(createSpatialBaseboards(w)).toEqual([]);
  });

  it.each([true, false])('covers a complete mixed-source room perimeter with policy %s, including a pillar and doorway', baseboards => {
    const boxes = [{ id: 'bsp-west', bounds: rect(-4, -3.6, -4, 4) },
      { id: 'regional-north', bounds: rect(-4, 4, -4, -3.6) },
      { id: 'mass-east', bounds: rect(3.6, 4, -4, 4) },
      { id: 'south-left', bounds: rect(-4, -1, 3.6, 4) },
      { id: 'south-right', bounds: rect(1, 4, 3.6, 4) },
      { id: 'pillar', bounds: rect(-.7, .7, -.7, .7) }];
    const floors = cutRects([rect(-4, 4, -4, 4)], boxes.map(b => b.bounds)).map((b, i) => ({ ...floor(b, 0, `tile-${i}`), roomId: 'room' }));
    const w = fixture(boxes, floors);
    w.rooms = [{ id: 'room', bounds: rect(-4, 4, -4, 4), kind: 'office', level: 0, floorY: 0, ceilingHeight: 3, detailDensity: 0, baseboards }];
    w.spatial!.prisms.push(...createSpatialBaseboards(w));
    const prepared = prepareSpatialArchitecture(JSON.parse(JSON.stringify(w)) as WorldPlan);
    const batches = prepared.map(b => ({ ...b, geometry: mountArchitectureBatch(b) }));
    try {
      const audit = auditFinishCoverage(w, batches);
      expect(audit.errors).toEqual([]);
      expect(baseboards ? audit.equipped : audit.bare).toBeGreaterThan(20);
      if (baseboards) expect(audit.supportedMetres).toBeGreaterThan(30);
      expect(auditAxisPlaneTriangles(batches).errors).toEqual([]);
    } finally { batches.forEach(b => b.geometry.dispose()); }
  });

  it('joins translated ramp fragments by their affine plane and keeps their real slope', () => {
    const a = { ...floor(rect(40, 43, 30.2, 30.21)), profile: { kind: 'linear' as const, axis: 'x' as const, startY: 1, endY: 1.5 } };
    const b = { ...a, id: 'b', bounds: rect(40, 43, 30.21, 34) };
    const c = { ...a, id: 'c', bounds: rect(43, 46, 30.2, 34), profile: { ...a.profile, startY: 1.5, endY: 2 } };
    const w = fixture([{ id: 'wall', bounds: rect(40, 46, 29.8, 30.2), top: 5 }], [a, b, c]);
    expect(createSpatialBaseboards(w)).toHaveLength(1);
    withMesh(w, mesh => expect(hits(mesh, 44.5, 30.5, 0, -1, 1.81)).toHaveLength(1));
  });

  it('stops at a real floor opening and finishes the two jambs without spanning the doorway', () => {
    const w = fixture([{ id: 'left-jamb', bounds: rect(-4, -1, -.3, .3) }, { id: 'right-jamb', bounds: rect(1, 4, -.3, .3) }], [floor(rect(-4, -.5, .3, 4)), floor(rect(.5, 4, .3, 4))]);
    withMesh(w, mesh => {
      expect(hits(mesh, 0, .6, 0, -1)).toHaveLength(0);
      expect(hits(mesh, 2, .6, 0, -1)).toHaveLength(1);
    });
    const absent = fixture([{ id: 'floating', bounds: rect(-3, 3, -.2, .2), bottom: 1 }]);
    expect(createSpatialBaseboards(absent)).toEqual([]);
  });

  it('keeps whole-room finish policy at its own altitude while retaining explicit partial exclusions', () => {
    const bounds = rect(-3, 3, .2, 4), low = floor(bounds, 0, 'bare'), high = floor(bounds, 3, 'equipped');
    const w = fixture([{ id: 'two-level-wall', bounds: rect(-3, 3, -.2, .2), top: 6 }], [low, high]);
    w.rooms = [false, true].map((baseboards, i) => ({ id: i ? 'equipped' : 'bare', bounds, baseboards,
      kind: 'office', level: 0, ceilingHeight: i ? 6 : 3, floorY: i ? 3 : 0, detailDensity: 0 }));
    w.baseboardlessZones = [{ ...bounds, floorY: 0 }];
    withMesh(w, mesh => {
      expect(hits(mesh, 1, .5, 0, -1, .06)).toHaveLength(0);
      expect(hits(mesh, 1, .5, 0, -1, 3.06)).toHaveLength(1);
    });
    w.baseboardlessZones.push(rect(0, 3, 0, 4));
    withMesh(w, mesh => {
      expect(hits(mesh, 1, .5, 0, -1, 3.06)).toHaveLength(0);
      expect(hits(mesh, -1, .5, 0, -1, 3.06)).toHaveLength(1);
    });
  });

  it('resolves every adjacent room interval when a final floor spans several canonical rooms', () => {
    const w = fixture([{ id: 'mixed-wall', bounds: rect(-4, 4, -.2, .2) },
      { id: 'return-from-another-generator', bounds: rect(3.8, 4, .2, 4) }], [floor(rect(-4, 4, .2, 4), 0, 'bare')]);
    w.rooms = [false, true].map((baseboards, i) => ({ id: i ? 'equipped' : 'bare',
      bounds: rect(i ? 0 : -4, i ? 4 : 0, .2, 4), baseboards, kind: 'office', level: 0,
      floorY: 0, ceilingHeight: 3, detailDensity: 0 }));
    // A lower-maze/landing can be tiled before its BSP room IDs are resolved.
    // The single inherited ID must not erase the equipped half or its return.
    withMesh(w, mesh => {
      expect(hits(mesh, -2, .5, 0, -1)).toHaveLength(0);
      expect(hits(mesh, 2, .5, 0, -1)).toHaveLength(1);
      expect(hits(mesh, 3.5, 2, 1, 0)).toHaveLength(1);
    });
    w.topology!.surfaces[0]!.roomId = 'equipped';
    withMesh(w, mesh => expect(hits(mesh, -2, .5, 0, -1)).toHaveLength(0));
  });

  it('opens cut end caps on chunk seams and survives serialisation and worker transfer', () => {
    const w = fixture([{ id: 'continuation', bounds: rect(50, 56, -.2, .2) }], [floor(rect(49, 56, .2, 4))]);
    const trim = createSpatialBaseboards(w);
    expect(trim).toHaveLength(1); expect(trim[0]!.openFaces!.length).toBeGreaterThan(1);
    w.spatial!.prisms.push(...trim);
    const restored = JSON.parse(JSON.stringify(w)) as WorldPlan;
    const batches = prepareSpatialArchitecture(restored), board = batches.find(b => b.material === 'baseboard')!;
    const geometry = mountArchitectureBatch(board), pos = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
    try { for (let i = 0; i < pos.count; i++) if (Math.abs(normal.getX(i)) > .9) expect(pos.getX(i)).not.toBe(56); }
    finally { geometry.dispose(); }
  });

  it('retains a real inward-facing wall on the owner boundary and samples sloping blockers at the contact face', () => {
    const edge = fixture([{ id: 'real-boundary-wall', bounds: rect(56, 57, -3, 3) }], [floor(rect(52, 56, -3, 3))]);
    withMesh(edge, mesh => expect(hits(mesh, 55.7, 0, 1, 0)).toHaveLength(1));
    const w = fixture([{ id: 'wall', bounds: rect(-3, 3, -.2, .2) }]);
    w.spatial!.prisms.push(profilePrism('slope', rect(-1, 1, .2, 2), flat(-1), { kind: 'linear', axis: 'z', startY: .3, endY: -.5 }));
    withMesh(w, mesh => {
      expect(hits(mesh, 0, .5, 0, -1)).toHaveLength(0);
      expect(hits(mesh, 2, .5, 0, -1)).toHaveLength(1);
    });
  });
});

describe('post-cut wall cleanup', () => {
  it('preserves structural roles, non-box intrados and protected hole lips through serialisation', () => {
    const w = fixture([{ id: 'host', bounds: rect(-4, 4, -.5, .5) },
      { id: 'column', bounds: rect(-1, 1, -.3, .503) }, { id: 'intrados', bounds: rect(2, 3, -.3, .503) },
      { id: 'hole-lip', bounds: rect(-3, -2, -.3, .503) }]);
    w.walls.find(w => w.id === 'column')!.junctionRole = 'column';
    w.spatial!.prisms.find(p => p.id === 'intrados')!.vertices[1] = 2.8;
    w.floorOpenings = [rect(-3, -2, .503, 2)];
    const restored = JSON.parse(JSON.stringify(w)) as WorldPlan, before = structuredClone(restored);
    expect(cleanSpatialWallJunctions(restored)).toBe(false);
    expect(restored).toEqual(before);
  });
  it('closes an almost aligned post-cut continuation and its sub-centimetre end gap', () => {
    const w = fixture([{ id: 'bsp', bounds: rect(-4, 0, -.5, .5) },
      { id: 'facade', bounds: rect(.003, 2, -.497, .503) }]);
    cleanSpatialWallJunctions(w);
    const p = w.spatial!.prisms.find(p => p.id === 'facade')!;
    expect(Math.min(...p.vertices.filter((_, i) => i % 3 === 0))).toBe(0);
    expect(Math.max(...p.vertices.filter((_, i) => i % 3 === 2))).toBe(.5);
    expect(w.colliders.find(c => c.id === p.id)).toEqual(prismCollider(p));
  });

  it.each([.8, 1.3])('closes a final L with unequal thickness %s, leaving a real butt joint', thickness => {
    const w = fixture([{ id: 'horizontal', bounds: rect(-4, 0, -.5, .5) },
      { id: 'vertical', bounds: rect(-thickness / 2, thickness / 2, .003, 4) }]);
    cleanSpatialWallJunctions(w);
    const horizontal = w.walls.find(w => w.id === 'horizontal')!, vertical = w.walls.find(w => w.id === 'vertical')!;
    expect(horizontal.x + horizontal.length / 2).toBeCloseTo(thickness / 2);
    expect(vertical.z - vertical.length / 2).toBeCloseTo(.5);
    const once = structuredClone(w); cleanSpatialWallJunctions(w); expect(w).toEqual(once);
    for (const p of w.spatial!.prisms) expect(w.colliders.find(c => c.id === p.id)).toEqual(prismCollider(p));
  });

  it('closes a thin T return against a taller facade without flattening a real niche or a door', () => {
    const w = fixture([{ id: 'host', bounds: rect(3.5, 4.5, -4, 4), top: 5 },
      { id: 'near-T', bounds: rect(0, 3.497, -.2, .2) },
      { id: 'niche', bounds: rect(0, 3.2, 1.8, 2.2) },
      { id: 'door-jamb', bounds: rect(0, 3.497, -2.2, -1.8) }]);
    w.features = [{ kind: 'interactive-door', bounds: rect(3.4, 3.6, -2.3, -1.7) } as WorldPlan['features'][number]];
    const originals = structuredClone(w.walls);
    cleanSpatialWallJunctions(w);
    const t = w.walls.find(w => w.id === 'near-T')!;
    expect(t.x + t.length / 2).toBeCloseTo(3.5, 6);
    expect(w.walls.find(w => w.id === 'niche')).toEqual(originals[2]);
    expect(w.walls.find(w => w.id === 'door-jamb')).toEqual(originals[3]);
  });
  it('absorbs a millimetre pilaster residue, retaining a readable bay and matching prism/collision data', () => {
    const w = fixture([{ id: 'host', bounds: rect(-4, 4, -.5, .5) }, { id: 'strip', bounds: rect(-1, 1, -.3, .503) }, { id: 'bay', bounds: rect(2, 3, -.2, 1) }]);
    cleanSpatialWallJunctions(w);
    expect(w.walls.map(w => w.id)).toEqual(['host', 'bay']);
    expect(w.spatial!.prisms.map(w => w.id)).toEqual(['host', 'bay']);
    expect(w.colliders.map(w => w.id)).toEqual(['host', 'bay']);
    const once = structuredClone(w); cleanSpatialWallJunctions(w); expect(w).toEqual(once);
  });

  it('aligns touching ordinary faces while preserving boundaries, thin details and intentional gaps', () => {
    const w = fixture([{ id: 'long', bounds: rect(-4, 0, -.5, .5) }, { id: 'short', bounds: rect(0, 2, -.497, .503) },
      { id: 'seam', bounds: rect(54, 56, -.497, .503) }, { id: 'gap', bounds: rect(2.1, 3, -.49, .51) }]);
    const seam = structuredClone(w.walls[2]), gap = structuredClone(w.walls[3]);
    cleanSpatialWallJunctions(w);
    expect(w.walls.find(w => w.id === 'short')!.z).toBe(0);
    expect(w.walls.find(w => w.id === 'seam')).toEqual(seam); expect(w.walls.find(w => w.id === 'gap')).toEqual(gap);
    for (const wall of w.walls) {
      const p = w.spatial!.prisms.find(p => p.id === wall.id)!, c = w.colliders.find(c => c.id === wall.id)!;
      expect(c).toEqual(prismCollider(p));
    }
  });
});

it('inherits whole-room bare zones across canonical chunks, independent of load order', () => {
  const addresses = [{ x: 0, z: 0, story: 0 }, { x: 1, z: 0, story: 0 }];
  const first = addresses.map(a => generateInfiniteChunk('BASEBOARD-ZONE-SEAMS', a));
  clearInfiniteWorldCaches();
  const reverse = [...addresses].reverse().map(a => generateInfiniteChunk('BASEBOARD-ZONE-SEAMS', a)).reverse();
  expect(reverse).toEqual(first);
  for (const w of first) {
    expect(w.baseboardlessZones).toEqual(w.rooms.filter(r => r.baseboards === false).map(r => ({ ...r.bounds, floorY: r.floorY ?? 0 })));
    expect(w.spatial!.prisms.some(p => p.material === 'baseboard')).toBe(true);
  }
  const trace = (w: WorldPlan, x: number) => [...new Set(w.spatial!.prisms.filter(p => p.material === 'baseboard'
    && p.vertices.some((v, i) => i % 3 === 0 && Math.abs(v - x) < 1e-6)
    && p.vertices.some((v, i) => i % 3 === 0 && Math.abs(v - x) > 1e-6))
    .flatMap(p => [0, 1, 2, 3, 4, 5, 6, 7].filter(i => Math.abs(p.vertices[i * 3]! - x) < 1e-6)
      .map(i => [p.vertices[i * 3 + 1], p.vertices[i * 3 + 2]].map(v => Math.round(v! * 1e6)).join('/'))))].sort();
  expect(trace(first[0]!, 56).length).toBeGreaterThan(4);
  expect(trace(first[0]!, 56)).toEqual(trace(first[1]!, -56));
  // Full unload, cold regeneration and remount use the same worker buffers.
  const initial = prepareSpatialArchitecture(first[0]!);
  clearInfiniteWorldCaches();
  expect(prepareSpatialArchitecture(generateInfiniteChunk('BASEBOARD-ZONE-SEAMS', addresses[0]!))).toEqual(initial);
});
