import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { StairwellDetails } from './StairwellDetails';
import type { StairwellMaterialSet } from './StairwellMaterials';
import { batchStaticMeshes, disposeObject3D } from './geometry';
import { floorY, STAIRWELL_FLIGHT_COUNT, STAIRWELL_STEP_DEPTH, STAIRWELL_STEP_RISE, STAIRWELL_STEPS_PER_FLIGHT } from './layout';

const materials = Object.fromEntries(['upperPlaster', 'lowerPaint', 'landingTerrazzo', 'stairTerrazzo', 'slabUnderside',
  'ceiling', 'railing', 'doorSteel', 'doorInset', 'frameMetal', 'galvanized', 'glass', 'windowFrame', 'fixtureBody',
  'fixtureGlow', 'rubber', 'pipe'].map(name => [name, new THREE.MeshStandardMaterial({ name })])) as unknown as StairwellMaterialSet;
const instances: StairwellDetails[] = [];
const create = () => { const details = new StairwellDetails(materials, new THREE.Texture()); instances.push(details); return details; };
afterEach(() => { for (const details of instances.splice(0)) { disposeObject3D(details.group); details.dispose(); } });

describe('inhabited stairwell details with a bounded rendering cost', () => {
  it('batches all detail into at most eleven opaque draws and twelve thousand triangles, without lights or shadows', () => {
    const details = create();
    expect(details.group.getObjectByName('entrance-noticeboard')).toBeDefined();
    expect(details.group.getObjectByName('resident-plant-pot')).toBeDefined();
    expect(details.group.getObjectByName('electrical-cabinet-2')).toBeDefined();
    batchStaticMeshes(details.group);
    let meshes = 0, triangles = 0, lights = 0;
    details.group.traverse(object => {
      if ((object as THREE.Light).isLight) lights++;
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      meshes++; triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3;
      expect(mesh.castShadow).toBe(false);
      expect(Array.isArray(mesh.material)).toBe(false);
      expect((mesh.material as THREE.Material).transparent).toBe(false);
      const positions = mesh.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) expect(Number.isFinite(positions.getX(i) + positions.getY(i) + positions.getZ(i))).toBe(true);
    });
    expect(meshes).toBeLessThanOrEqual(11);
    expect(triangles).toBeLessThan(12000);
    expect(lights).toBe(0);
  });

  it('keeps solid detail outside both stair lanes, the turn and the apartment/entrance routes', () => {
    const { colliders } = create();
    expect(colliders.length).toBeGreaterThan(12);
    for (const collider of colliders) {
      expect(collider.halfExtents.x).toBeGreaterThan(0);
      expect(collider.halfExtents.y).toBeGreaterThan(0);
      expect(collider.halfExtents.z).toBeGreaterThan(0);
      const { center: c, halfExtents: h } = collider;
      const hit = (x: number, z: number, footY = 0) => Math.abs(c.x - x) < h.x + .33
        && Math.abs(c.z - z) < h.z + .33 && Math.abs(c.y - (footY + .865)) < h.y + .86;
      for (let step = 0; step < 8; step++) {
        const z = -1.05 + step * .3;
        expect(hit(-1.05, z), collider.id).toBe(false);
        expect(hit(1.05, z), collider.id).toBe(false);
      }
      for (let x = -1.05; x <= 1.05; x += .3) expect(hit(x, 2.25), collider.id).toBe(false);
      for (let x = -1.5; x <= 1.5; x += .3) expect(hit(x, -2.712), collider.id).toBe(false);
      for (let z = -6; z <= -1.3; z += .3) expect(hit(0, z), collider.id).toBe(false);
    }
  });

  it('aligns every tread accent with its real step and keeps it below the auto-step threshold', () => {
    const { group } = create();
    for (let level = 0; level < STAIRWELL_FLIGHT_COUNT; level++) for (const side of [-1, 1]) {
      for (let step = 0; step < STAIRWELL_STEPS_PER_FLIGHT; step++) {
        const nose = group.getObjectByName(`stair-nosing-${level}-${side}-${step}`)!;
        const base = floorY(level) + (side > 0 ? 1.44 : 0);
        const expectedTop = base + (step + 1) * STAIRWELL_STEP_RISE;
        const bounds = new THREE.Box3().setFromObject(nose);
        expect(bounds.max.y - expectedTop).toBeGreaterThan(.002);
        expect(bounds.max.y - expectedTop).toBeLessThan(.005);
        const leadingEdge = side * (1.2 - STAIRWELL_STEP_DEPTH * step);
        if (side < 0) {
          expect(bounds.min.z).toBeLessThan(leadingEdge - .005);
          expect(bounds.max.z).toBeGreaterThan(leadingEdge);
        } else {
          expect(bounds.max.z).toBeGreaterThan(leadingEdge + .005);
          expect(bounds.min.z).toBeLessThan(leadingEdge);
        }
      }
    }
  });

  it('uses repeatable variation and releases the atlas/materials without disposing shared scene materials', () => {
    const a = create(), b = create();
    expect(a.colliders).toEqual(b.colliders);
    const atlas = new THREE.Texture();
    const atlasDispose = vi.spyOn(atlas, 'dispose');
    const sharedDispose = vi.spyOn(materials.upperPlaster, 'dispose');
    const owned = new StairwellDetails(materials, atlas);
    const labels = owned.group.getObjectByName('entrance-noticeboard') as THREE.Mesh;
    const labelDispose = vi.spyOn(labels.material as THREE.Material, 'dispose');
    owned.dispose(); disposeObject3D(owned.group);
    expect(atlasDispose).toHaveBeenCalledOnce();
    expect(labelDispose).toHaveBeenCalledOnce();
    expect(sharedDispose).not.toHaveBeenCalled();
    sharedDispose.mockRestore();
  });
});
