import RAPIER from '@dimforge/rapier3d';
import * as THREE from 'three';
import type { StaticCollider, Vec3Data, WorldPlan } from '../world/types';

const PLAYER_RADIUS = 0.32;
const STANDING_HALF_HEIGHT = 0.52;
const CROUCHED_HALF_HEIGHT = 0.22;
const CROUCH_CENTER_DROP = STANDING_HALF_HEIGHT - CROUCHED_HALF_HEIGHT;
const PLAYER_SKIN_WIDTH = 0.025;
const PLAYER_COLLISION_GROUP = 0x1000;
const MELEE_OPPONENT_COLLISION_GROUP = 0x2000;
const MELEE_OPPONENT_RADIUS = 0.34;
const MELEE_OPPONENT_HALF_HEIGHT = 0.50;
const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 };

const addStaticCollider = (
  world: RAPIER.World,
  body: RAPIER.RigidBody,
  source: StaticCollider,
): RAPIER.Collider => {
  const description = RAPIER.ColliderDesc.cuboid(
    source.halfExtents.x,
    source.halfExtents.y,
    source.halfExtents.z,
  )
    .setTranslation(source.center.x, source.center.y, source.center.z)
    .setFriction(source.kind === 'floor' || source.kind === 'step' ? 0.82 : 0.45)
    .setRestitution(0);
  if (source.rotation) description.setRotation(source.rotation);
  return world.createCollider(description, body);
};

export interface CharacterMotionResult {
  position: THREE.Vector3;
  grounded: boolean;
  moved: THREE.Vector3;
}

export class PhysicsWorld {
  readonly world: RAPIER.World;
  private readonly chunkBodies = new Map<string, RAPIER.RigidBody>();
  private readonly chunkColliders = new Map<string, Map<string, RAPIER.Collider>>();
  private readonly playerBody: RAPIER.RigidBody;
  private readonly playerCollider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private meleeOpponentBody?: RAPIER.RigidBody;
  private meleeOpponentCollider?: RAPIER.Collider;
  private readonly spawn = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private readonly movement = new THREE.Vector3();
  private crouched = false;
  private chunkMutationDepth = 0;
  private chunkSynchronizationPending = false;

  private constructor(plan: WorldPlan) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
    this.addChunk('origin', plan.colliders, { x: 0, y: 0, z: 0 });

    this.spawn.set(plan.spawn.x, 0.865, plan.spawn.z);
    this.playerBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(this.spawn.x, this.spawn.y, this.spawn.z)
        .lockRotations(),
    );
    this.playerCollider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(STANDING_HALF_HEIGHT, PLAYER_RADIUS)
        .setFriction(0)
        .setRestitution(0)
        // Keep the live character on its own membership bit. Active ragdolls ignore
        // it; persistent corpses opt into this bit only after respawn so the KCC
        // can treat a settled body as a small dynamic step instead of a hard wall.
        .setCollisionGroups((PLAYER_COLLISION_GROUP << 16) | 0xffff),
      this.playerBody,
    );
    this.controller = this.world.createCharacterController(PLAYER_SKIN_WIDTH);
    this.controller.setSlideEnabled(true);
    this.controller.enableAutostep(0.38, 0.10, true);
    this.controller.enableSnapToGround(0.32);
    this.controller.setMaxSlopeClimbAngle((48 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((54 * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    // Deliberately lighter than a real 70-80 kg character: a corpse should move
    // a little when walked into, not get launched across the room.
    this.controller.setCharacterMass(18);
    this.syncPosition();
  }

  static async create(plan: WorldPlan): Promise<PhysicsWorld> { return new PhysicsWorld(plan); }
  hasChunk(key: string): boolean { return this.chunkBodies.has(key); }

  addChunk(key: string, colliders: readonly StaticCollider[], offset: Vec3Data): void {
    if (!key) throw new Error('Physics chunk keys cannot be empty.');
    if (this.chunkBodies.has(key)) throw new Error(`Physics chunk already exists: ${key}`);
    this.assertFiniteVector(offset, `offset for chunk ${key}`);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(offset.x, offset.y, offset.z),
    );
    try {
      const indexedColliders = new Map<string, RAPIER.Collider>();
      for (const collider of colliders) {
        if (indexedColliders.has(collider.id)) throw new Error(`Duplicate collider id in chunk ${key}: ${collider.id}`);
        indexedColliders.set(collider.id, addStaticCollider(this.world, body, collider));
      }
      this.chunkBodies.set(key, body);
      this.chunkColliders.set(key, indexedColliders);
      this.requestChunkSynchronization();
    } catch (error) {
      this.world.removeRigidBody(body);
      throw error;
    }
  }

  addTrimeshChunk(key: string, meshes: readonly THREE.Mesh[]): void {
    if (!key) throw new Error('Physics chunk keys cannot be empty.');
    if (this.chunkBodies.has(key)) throw new Error(`Physics chunk already exists: ${key}`);
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const vertex = new THREE.Vector3();
    try {
      for (const mesh of meshes) {
        mesh.updateWorldMatrix(true, false);
        const geometry = mesh.geometry;
        const position = geometry.getAttribute('position');
        if (!position || position.itemSize < 3 || position.count < 3) continue;
        const vertices = new Float32Array(position.count * 3);
        for (let index = 0; index < position.count; index += 1) {
          vertex.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
          vertices[index * 3] = vertex.x;
          vertices[index * 3 + 1] = vertex.y;
          vertices[index * 3 + 2] = vertex.z;
        }
        let indices: Uint32Array;
        if (geometry.index) {
          indices = new Uint32Array(geometry.index.count);
          for (let index = 0; index < geometry.index.count; index += 1) indices[index] = geometry.index.getX(index);
        } else {
          const triangleVertexCount = Math.floor(position.count / 3) * 3;
          indices = new Uint32Array(triangleVertexCount);
          for (let index = 0; index < triangleVertexCount; index += 1) indices[index] = index;
        }
        if (indices.length < 3) continue;
        this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(0.58).setRestitution(0), body);
      }
      this.chunkBodies.set(key, body);
      this.chunkColliders.set(key, new Map());
      this.requestChunkSynchronization();
    } catch (error) {
      this.world.removeRigidBody(body);
      throw error;
    }
  }

  removeChunk(key: string): boolean {
    const body = this.chunkBodies.get(key);
    if (!body) return false;
    this.world.removeRigidBody(body);
    this.chunkBodies.delete(key);
    this.chunkColliders.delete(key);
    this.requestChunkSynchronization();
    return true;
  }
  setChunkColliderEnabled(key: string, colliderId: string, enabled: boolean): boolean {
    const collider = this.chunkColliders.get(key)?.get(colliderId);
    if (!collider) return false;
    collider.setEnabled(enabled);
    return true;
  }
  setChunkOffset(key: string, offset: Vec3Data): boolean {
    const body = this.chunkBodies.get(key);
    if (!body) return false;
    this.assertFiniteVector(offset, `offset for chunk ${key}`);
    body.setTranslation(offset, true);
    this.world.propagateModifiedBodyPositionsToColliders();
    this.requestChunkSynchronization();
    return true;
  }
  rebaseChunks(delta: Vec3Data): void {
    this.assertFiniteVector(delta, 'chunk rebase delta');
    for (const body of this.chunkBodies.values()) {
      const current = body.translation();
      body.setTranslation({ x: current.x + delta.x, y: current.y + delta.y, z: current.z + delta.z }, true);
    }
    this.world.propagateModifiedBodyPositionsToColliders();
    this.requestChunkSynchronization();
  }
  batchChunkChanges<T>(operation: () => T): T {
    this.chunkMutationDepth += 1;
    try { return operation(); }
    finally {
      this.chunkMutationDepth -= 1;
      if (this.chunkMutationDepth === 0 && this.chunkSynchronizationPending) {
        this.chunkSynchronizationPending = false;
        this.synchronizeChunkChanges();
      }
    }
  }

  /**
   * Solid kinematic capsule used by the live melee opponent. The collider only
   * interacts with the player capsule: ragdolls and other dynamics ignore it,
   * which prevents an invisible standing blocker from fighting the NPC ragdoll.
   * Updating it with an immediate translation keeps the character controller
   * from tunnelling through a visually moved opponent between render frames.
   */
  setMeleeOpponentBlocker(position: Vec3Data, enabled = true): void {
    this.assertFiniteVector(position, 'melee opponent blocker position');
    if (!this.meleeOpponentBody || !this.meleeOpponentCollider) {
      this.meleeOpponentBody = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(position.x, position.y, position.z)
          .lockRotations(),
      );
      this.meleeOpponentCollider = this.world.createCollider(
        RAPIER.ColliderDesc.capsule(MELEE_OPPONENT_HALF_HEIGHT, MELEE_OPPONENT_RADIUS)
          .setFriction(0)
          .setRestitution(0)
          .setCollisionGroups((MELEE_OPPONENT_COLLISION_GROUP << 16) | PLAYER_COLLISION_GROUP),
        this.meleeOpponentBody,
      );
    }
    this.meleeOpponentCollider.setEnabled(enabled);
    if (!enabled) return;
    this.meleeOpponentBody.setTranslation(position, true);
    this.meleeOpponentBody.setNextKinematicTranslation(position);
    this.world.propagateModifiedBodyPositionsToColliders();
  }

  setMeleeOpponentBlockerEnabled(enabled: boolean): void {
    this.meleeOpponentCollider?.setEnabled(enabled);
  }

  move(desiredDelta: Vec3Data): CharacterMotionResult {
    this.controller.computeColliderMovement(this.playerCollider, desiredDelta);
    const allowed = this.controller.computedMovement();
    const current = this.playerBody.translation();
    this.playerBody.setNextKinematicTranslation({ x: current.x + allowed.x, y: current.y + allowed.y, z: current.z + allowed.z });
    this.world.step();
    this.syncPosition();
    this.movement.set(allowed.x, allowed.y, allowed.z);
    return { position: this.position, grounded: this.controller.computedGrounded(), moved: this.movement };
  }

  stepDynamics(delta: number): void {
    const previousTimestep = this.world.timestep;
    try {
      this.world.timestep = Math.max(1 / 240, Math.min(1 / 30, delta));
      this.world.step();
    } finally {
      this.world.timestep = previousTimestep;
    }
  }

  setCrouched(requested: boolean): boolean {
    if (requested === this.crouched) return this.crouched;
    const current = this.playerBody.translation();
    if (!requested) {
      const standingCenter = { x: current.x, y: current.y + CROUCH_CENTER_DROP, z: current.z };
      const obstruction = this.world.intersectionWithShape(
        standingCenter, IDENTITY_ROTATION, new RAPIER.Capsule(STANDING_HALF_HEIGHT, PLAYER_RADIUS),
        undefined, 0x00010001, this.playerCollider, this.playerBody,
      );
      if (obstruction) return true;
      this.playerCollider.setShape(new RAPIER.Capsule(STANDING_HALF_HEIGHT, PLAYER_RADIUS));
      this.playerBody.setTranslation(standingCenter, true);
      this.playerBody.setNextKinematicTranslation(standingCenter);
      this.crouched = false;
    } else {
      const crouchedCenter = { x: current.x, y: current.y - CROUCH_CENTER_DROP, z: current.z };
      this.playerCollider.setShape(new RAPIER.Capsule(CROUCHED_HALF_HEIGHT, PLAYER_RADIUS));
      this.playerBody.setTranslation(crouchedCenter, true);
      this.playerBody.setNextKinematicTranslation(crouchedCenter);
      this.crouched = true;
    }
    this.world.propagateModifiedBodyPositionsToColliders();
    this.syncPosition();
    return this.crouched;
  }


  /**
   * Finds a nearby supported, unobstructed standing capsule for a recovering
   * character. It never changes the world or enables the live player collider.
   */
  findStandingRecoveryPosition(
    pelvis: Readonly<Vec3Data>,
    ignoredBodyHandles: ReadonlySet<number> = new Set<number>(),
    wideSearch = false,
  ): THREE.Vector3 | null {
    const nearOffsets = [
      [0, 0], [0.24, 0], [-0.24, 0], [0, 0.24], [0, -0.24],
      [0.40, 0.20], [-0.40, -0.20], [0.40, -0.20], [-0.40, 0.20],
      [0.58, 0], [-0.58, 0], [0, 0.58], [0, -0.58],
      [0.50, 0.42], [-0.50, -0.42], [0.50, -0.42], [-0.50, 0.42],
    ] as const;
    const wideOffsets = [
      [0.82, 0], [-0.82, 0], [0, 0.82], [0, -0.82],
      [0.72, 0.58], [-0.72, -0.58], [0.72, -0.58], [-0.72, 0.58],
      [1.05, 0], [-1.05, 0], [0, 1.05], [0, -1.05],
    ] as const;
    const offsets: ReadonlyArray<readonly [number, number]> = wideSearch
      ? [...nearOffsets, ...wideOffsets]
      : nearOffsets;
    const sampleOffsets = [[0, 0], [0.16, 0], [-0.16, 0], [0, 0.16], [0, -0.16]] as const;
    const rayOriginY = pelvis.y + 1.15;
    const rayLength = 3.5;
    const groundAt = (x: number, z: number): number | null => {
      const hit = this.world.castRayAndGetNormal(
        new RAPIER.Ray({ x, y: rayOriginY, z }, { x: 0, y: -1, z: 0 }),
        rayLength,
        true,
        RAPIER.QueryFilterFlags.ONLY_FIXED,
      );
      if (!hit || hit.normal.y < 0.70) return null;
      const y = rayOriginY - hit.timeOfImpact;
      return y <= pelvis.y + 0.72 && y >= pelvis.y - 1.75 ? y : null;
    };
    for (const [dx, dz] of offsets) {
      const x = pelvis.x + dx;
      const z = pelvis.z + dz;
      const ground = groundAt(x, z);
      if (ground === null) continue;
      if (sampleOffsets.some(([sx, sz]) => {
        const sample = groundAt(x + sx, z + sz);
        return sample === null || Math.abs(sample - ground) > 0.30;
      })) continue;
      const center = new THREE.Vector3(x, ground + 0.865, z);
      const blocked = this.world.intersectionWithShape(
        center,
        IDENTITY_ROTATION,
        new RAPIER.Capsule(STANDING_HALF_HEIGHT, PLAYER_RADIUS),
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        this.playerCollider,
        this.playerBody,
        (collider) => {
          const body = collider.parent();
          // Quarantined ragdolls remain allocated for wasm-safe teardown.
          // Rapier scene queries can still enumerate these disabled shapes.
          if (!collider.isEnabled() || (body && !body.isEnabled())) return false;
          return !body || !ignoredBodyHandles.has(body.handle);
        },
      );
      if (!blocked) return center;
    }
    return null;
  }

  get isCrouched(): boolean { return this.crouched; }
  setPlayerColliderEnabled(enabled: boolean): void { this.playerCollider.setEnabled(enabled); }
  getStandingPosition(target = new THREE.Vector3()): THREE.Vector3 {
    target.copy(this.position);
    if (this.crouched) target.y += CROUCH_CENTER_DROP;
    return target;
  }
  getFeetPosition(target = new THREE.Vector3()): THREE.Vector3 {
    this.getStandingPosition(target);
    target.y -= STANDING_HALF_HEIGHT + PLAYER_RADIUS + PLAYER_SKIN_WIDTH;
    return target;
  }
  reset(): void {
    this.playerBody.setTranslation(this.spawn, true);
    this.playerBody.setNextKinematicTranslation(this.spawn);
    this.world.step();
    this.syncPosition();
  }
  teleport(position: Vec3Data): void {
    this.playerBody.setTranslation(position, true);
    this.playerBody.setNextKinematicTranslation(position);
    this.world.step();
    this.syncPosition();
  }
  getPosition(target = new THREE.Vector3()): THREE.Vector3 { return target.copy(this.position); }
  private syncPosition(): void {
    const translation = this.playerBody.translation();
    this.position.set(translation.x, translation.y, translation.z);
  }
  private assertFiniteVector(vector: Vec3Data, label: string): void {
    if (!Number.isFinite(vector.x) || !Number.isFinite(vector.y) || !Number.isFinite(vector.z)) {
      throw new Error(`Invalid ${label}: expected finite coordinates.`);
    }
  }
  private synchronizeChunkChanges(): void { this.world.step(); }
  private requestChunkSynchronization(): void {
    if (this.chunkMutationDepth > 0) { this.chunkSynchronizationPending = true; return; }
    this.synchronizeChunkChanges();
  }
  dispose(): void {
    this.controller.free();
    this.chunkBodies.clear();
    this.world.free();
  }
}
