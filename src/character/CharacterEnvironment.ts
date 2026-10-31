import RAPIER from '@dimforge/rapier3d';
import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { StaticCollider } from '../world/types';

export type PitStairDirection = 'x+' | 'x-' | 'z+' | 'z-';
/** World-space opening; bottom is relative to rimY. */
export interface CharacterPit {
  id: string;
  minX: number; maxX: number; minZ: number; maxZ: number;
  bottom: number;
  rimY?: number;
  stairs?: PitStairDirection;
}
export interface EnvironmentHit {
  distance: number;
  point: THREE.Vector3;
  face: { normal: THREE.Vector3 };
}

export interface EnvironmentSphereHit {
  readonly center: THREE.Vector3;
  readonly normal: THREE.Vector3;
}

/** The host's real collision world, including chunks, doors and apartment meshes. */
export class CharacterEnvironment {
  private readonly queryShape = new RAPIER.Cuboid(3, 3, 3);
  private readonly sphere = new RAPIER.Ball(.1);
  private readonly sweepVelocity = new THREE.Vector3();
  private readonly overlapOrigin = new THREE.Vector3();
  private readonly overlapNormal = new THREE.Vector3();
  constructor(private readonly physics: PhysicsWorld) {}
  raycast(raycaster: THREE.Raycaster): EnvironmentHit[] {
    const near = Math.max(0, raycaster.near);
    const origin = raycaster.ray.at(near, new THREE.Vector3());
    const hit = this.physics.world.castRayAndGetNormal(
      new RAPIER.Ray(origin, raycaster.ray.direction), Math.max(0, raycaster.far - near), true,
      undefined, undefined, undefined, undefined, this.physics.isEnvironmentCollider,
    );
    if (!hit) return [];
    const distance = near + hit.timeOfImpact;
    return [{ distance, point: raycaster.ray.at(distance, new THREE.Vector3()),
      face: { normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z) } }];
  }
  /** Sweep an actual hand/arm volume through the host's mounted collision world.
   * The result is the sphere centre, not a surface point. Reuse caller storage.
   */
  sweepSphere(from: Readonly<THREE.Vector3>, to: Readonly<THREE.Vector3>, radius: number, out: EnvironmentSphereHit): boolean {
    this.sphere.radius = Math.max(.001, radius);
    this.sweepVelocity.copy(to).sub(from);
    const hit = this.physics.world.castShape(from, { x: 0, y: 0, z: 0, w: 1 }, this.sweepVelocity,
      this.sphere, 0, 1, true, undefined, undefined, undefined, undefined, this.physics.isEnvironmentCollider);
    if (!hit) return false;
    out.center.copy(from).addScaledVector(this.sweepVelocity, hit.time_of_impact);
    out.normal.set(hit.normal1.x, hit.normal1.y, hit.normal1.z).normalize();
    return true;
  }
  /** Recover a query volume already touching a floor, corner or moving door.
   * Resolve the deepest real contact, then query again; never push a body. */
  resolveSphereOverlap(center: THREE.Vector3, radius: number, maxCorrection = .45): boolean {
    this.sphere.radius = radius;
    this.overlapOrigin.copy(center);
    for (let iteration = 0; iteration < 8; iteration++) {
      let depth = 0;
      this.physics.world.intersectionsWithShape(center, { x: 0, y: 0, z: 0, w: 1 }, this.sphere, collider => {
        const contact = collider.contactShape(this.sphere, center, { x: 0, y: 0, z: 0, w: 1 }, .002);
        if (contact && -contact.distance > depth) {
          depth = -contact.distance;
          this.overlapNormal.set(contact.normal1.x, contact.normal1.y, contact.normal1.z);
        }
        return true;
      }, undefined, undefined, undefined, undefined, this.physics.isEnvironmentCollider);
      if (depth < .0001) return true;
      center.addScaledVector(this.overlapNormal, depth + .002);
      if (center.distanceToSquared(this.overlapOrigin) > maxCorrection * maxCorrection) return false;
    }
    return false;
  }
  /** Find a supported place on this floor, with a clear path from the player. */
  findPartnerSpawn(origin: THREE.Vector3, facing: THREE.Vector3): THREE.Vector3 | null {
    const forward = facing.clone().setY(0).normalize();
    if (forward.lengthSq() < 0.5) forward.set(0, 0, -1);
    const shape = new RAPIER.Capsule(0.5, 0.34);
    for (const radius of [2.2, 3, 4]) for (const angle of [0.5, -0.5, 1, -1, 1.7, -1.7]) {
      const candidate = origin.clone().addScaledVector(forward.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, angle), radius);
      const groundRay = new THREE.Raycaster(candidate.clone().add(new THREE.Vector3(0, 0.5, 0)), new THREE.Vector3(0, -1, 0), 0, 2.2);
      const ground = this.raycast(groundRay)[0];
      if (!ground || ground.face.normal.y < 0.8 || Math.abs(ground.point.y - (origin.y - 0.865)) > 0.35) continue;
      candidate.y = ground.point.y;
      let blocked = false;
      this.physics.world.intersectionsWithShape({ x: candidate.x, y: candidate.y + 0.9, z: candidate.z },
        { x: 0, y: 0, z: 0, w: 1 }, shape, () => { blocked = true; return false; },
        undefined, undefined, undefined, undefined, this.physics.isEnvironmentCollider);
      if (blocked) continue;
      const start = origin.clone().add(new THREE.Vector3(0, 0.4, 0));
      const path = candidate.clone().add(new THREE.Vector3(0, 1.2, 0)).sub(start);
      if (this.raycast(new THREE.Raycaster(start, path.clone().normalize(), 0, path.length())).length) continue;
      return candidate;
    }
    return null;
  }
  nearbyBoxes(position: THREE.Vector3): StaticCollider[] {
    const result: StaticCollider[] = [];
    this.physics.world.intersectionsWithShape(position, { x: 0, y: 0, z: 0, w: 1 }, this.queryShape, collider => {
      const shape = collider.shape;
      if (shape instanceof RAPIER.Cuboid) result.push({ id: `physics-${collider.handle}`,
        center: { ...collider.translation() }, halfExtents: { ...shape.halfExtents },
        rotation: { ...collider.rotation() }, kind: this.physics.getEnvironmentKind(collider) });
      return true;
    }, undefined, undefined, undefined, undefined, this.physics.isEnvironmentCollider);
    return result;
  }
}
