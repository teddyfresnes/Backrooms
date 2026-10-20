import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
vi.mock('@dimforge/rapier3d', async () => import('../../node_modules/@dimforge/rapier3d/rapier.js'));
import RAPIER from '@dimforge/rapier3d';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { createWalkableGeometry } from '../render/WalkableGeometry';
import { generateWorld, validateWorldPlan } from './generateWorld';
import { findSurface, surfaceCollider, surfaceY, type WalkableSurface } from './WalkableTopology';
import { pointInRect, rectCenter, rectDepth, rectWidth } from './types';

describe('integrated vertical topology', () => {
  it('produces regional slopes, variable-rise stairs, galleries, bridges and directed relations in normal generation', () => {
    const families = new Set<string>(); let nonzero = 0, corridor = 0, stairs = 0, drops = 0, jumps = 0;
    for (let i = 0; i < 64; i++) {
      const w = generateWorld(`VERTICAL-PROMPT-AUDIT-${i}`);
      expect(validateWorldPlan(w), w.seed).toEqual([]); expect(structuredClone(w)).toEqual(w);
      for (const l of w.spatial!.landmarks) if (l.kind.startsWith('galerie-')) families.add(l.kind);
      for (const s of w.topology!.surfaces) {
        if (s.role === 'stair') stairs++;
        if (s.profile.kind === 'linear') {
          if (s.profile.startY !== 0 && s.profile.endY !== 0) nonzero++;
          const p = rectCenter(s.bounds); if (w.rooms.some(r => r.kind === 'corridor' && pointInRect(p.x, p.z, r.bounds))) corridor++;
        }
        expect(s.reachability).not.toBe('isolated');
      }
      drops += w.topology!.connections.filter(c => c.kind === 'drop' && c.direction === 'forward').length;
      jumps += w.topology!.connections.filter(c => c.kind === 'jump').length;
    }
    expect(nonzero).toBeGreaterThan(30); expect(corridor).toBeGreaterThan(0); expect(stairs).toBeGreaterThan(100);
    expect(drops).toBeGreaterThan(0); expect(jumps).toBeGreaterThan(0);
    expect(families).toEqual(new Set(['galerie-l', 'galerie-u', 'galerie-bridge']));
  });

  it('keeps the reported 1.64 m headroom seed safe at every slope corner and midpoint', () => {
    const w = generateWorld('VERTICAL-PROMPT-AUDIT-3');
    for (const s of w.topology!.surfaces.filter(s => s.profile.kind === 'linear' && s.locomotion !== 'crouch')) {
      for (const x of [s.bounds.minX, rectCenter(s.bounds).x, s.bounds.maxX]) for (const z of [s.bounds.minZ, rectCenter(s.bounds).z, s.bounds.maxZ]) {
        const ceiling = s.ceilingProfile ? surfaceY({ ...s, profile: s.ceilingProfile }, x, z) : s.ceilingY;
        expect(ceiling - surfaceY(s, x, z)).toBeGreaterThanOrEqual(2.498);
      }
    }
  });

  it('sweeps real standing/crouched capsules across all useful slope widths and matches rendered profiles', async () => {
    for (const i of [2, 3, 5, 11, 17, 50]) {
      const w = generateWorld(`VERTICAL-PROMPT-AUDIT-${i}`), physics = await PhysicsWorld.create(w);
      try {
        for (const s of w.topology!.surfaces.filter(s => s.profile.kind === 'linear')) {
          const p = s.profile; if (p.kind !== 'linear') continue;
          const b = s.bounds, width = p.axis === 'x' ? rectDepth(b) : rectWidth(b);
          const geometry = createWalkableGeometry(s), material = new THREE.MeshBasicMaterial(), mesh = new THREE.Mesh(geometry, material); mesh.updateMatrixWorld();
          for (const t of [.05, .25, .5, .75, .95]) for (const across of [.35 / width, .5, 1 - .35 / width]) {
            const x = b.minX + rectWidth(b) * (p.axis === 'x' ? t : across), z = b.minZ + rectDepth(b) * (p.axis === 'z' ? t : across), y = surfaceY(s, x, z), crouch = s.locomotion === 'crouch';
            const hit = new THREE.Raycaster(new THREE.Vector3(x, y + .5, z), new THREE.Vector3(0, -1, 0)).intersectObject(mesh)[0];
            expect(hit?.point.y).toBeCloseTo(y, 4);
            const blocked = physics.world.intersectionWithShape({ x, y: y + (crouch ? .65 : .91), z }, { x: 0, y: 0, z: 0, w: 1 },
              new RAPIER.Capsule(crouch ? .22 : .52, .32), undefined, undefined, undefined, undefined, physics.isEnvironmentCollider);
            expect(blocked, `${w.seed} ${s.id} ${x},${z}`).toBeNull();
          }
          geometry.dispose(); material.dispose();
        }
      } finally { physics.dispose(); }
    }
  });

  it('walks, sprints, stops, reverses and crouches across two nonzero datums without changing controller settings', async () => {
    const w = generateWorld('VERTICAL-MOVEMENT');
    const ramp: WalkableSurface = { id: 'ramp', ownerStory: 0, layer: 'ground', role: 'ramp', bounds: { minX: -4, maxX: 4, minZ: -2, maxZ: 2 },
      profile: { kind: 'linear', axis: 'x', startY: -.8, endY: .9 }, ceilingY: 4, thickness: .16, support: 'slab', access: 'open', edges: 'drop' };
    const left: WalkableSurface = { ...ramp, id: 'left', role: 'floor', bounds: { ...ramp.bounds, minX: -20, maxX: -4 }, profile: { kind: 'flat', y: -.8 } };
    const right: WalkableSurface = { ...ramp, id: 'right', role: 'floor', bounds: { ...ramp.bounds, minX: 4, maxX: 20 }, profile: { kind: 'flat', y: .9 } };
    w.colliders = [left, ramp, right].map(surfaceCollider); w.spawn = { x: -6, y: .1, z: 0 };
    const physics = await PhysicsWorld.create(w);
    try {
      for (const speed of [.08, .13]) {
        physics.teleport(w.spawn); for (let i = 0; i < 30; i++) physics.move({ x: 0, y: -.035, z: 0 }); let p = { ...w.spawn };
        for (let i = 0; i < 350 && p.x < 6; i++) p = { ...physics.move({ x: speed, y: -.035, z: 0 }).position };
        expect(p.x).toBeGreaterThanOrEqual(6); expect(p.y).toBeCloseTo(.9 + .865, 1);
        for (let i = 0; i < 350 && p.x > -6; i++) p = { ...physics.move({ x: -speed, y: -.035, z: 0 }).position };
        expect(p.x).toBeLessThanOrEqual(-6); expect(p.y).toBeCloseTo(-.8 + .865, 1);
      }
      physics.teleport({ x: 0, y: .95, z: 0 }); for (let i = 0; i < 60; i++) physics.move({ x: 0, y: -.035, z: 0 });
      const stopped = physics.move({ x: 0, y: -.035, z: 0 }).position.clone(); expect(Math.abs(stopped.x)).toBeLessThan(.04);
      physics.setCrouched(true); expect(physics.move({ x: 0, y: -.035, z: 0 }).position.y).toBeLessThan(stopped.y);
      physics.setCrouched(false); physics.teleport({ x: 6, y: 1.765, z: 0 });
      expect(physics.move({ x: 0, y: -.035, z: 0 }).position.y).toBeGreaterThan(1.7);
    } finally { physics.dispose(); }
  });
});
