import RAPIER from '@dimforge/rapier3d';
import * as THREE from 'three';
import type { StaticCollider, Vec3Data, WorldPlan } from '../world/types';

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
  private readonly playerBody: RAPIER.RigidBody;
  private readonly playerCollider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly spawn = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private readonly movement = new THREE.Vector3();
  private chunkMutationDepth = 0;
  private chunkSynchronizationPending = false;

  private constructor(plan: WorldPlan) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
    this.addChunk('origin', plan.colliders, { x: 0, y: 0, z: 0 });

    // Capsule half-height (0.52 + 0.32) plus the controller offset (0.025).
    this.spawn.set(plan.spawn.x, 0.865, plan.spawn.z);
    this.playerBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(this.spawn.x, this.spawn.y, this.spawn.z)
        .lockRotations(),
    );
    this.playerCollider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.52, 0.32)
        .setFriction(0)
        .setRestitution(0)
        .setCollisionGroups(0x00010001),
      this.playerBody,
    );
    this.controller = this.world.createCharacterController(0.025);
    this.controller.setSlideEnabled(true);
    this.controller.enableAutostep(0.26, 0.14, false);
    this.controller.enableSnapToGround(0.32);
    this.controller.setMaxSlopeClimbAngle((48 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((54 * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.syncPosition();
  }

  static async create(plan: WorldPlan): Promise<PhysicsWorld> {
    return new PhysicsWorld(plan);
  }

  hasChunk(key: string): boolean {
    return this.chunkBodies.has(key);
  }

  addChunk(key: string, colliders: readonly StaticCollider[], offset: Vec3Data): void {
    if (!key) throw new Error('Physics chunk keys cannot be empty.');
    if (this.chunkBodies.has(key)) throw new Error(`Physics chunk already exists: ${key}`);
    this.assertFiniteVector(offset, `offset for chunk ${key}`);

    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(offset.x, offset.y, offset.z),
    );
    try {
      colliders.forEach((collider) => addStaticCollider(this.world, body, collider));
      this.chunkBodies.set(key, body);
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
    this.requestChunkSynchronization();
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

  /**
   * Adds the supplied translation to every loaded static chunk. The caller is
   * responsible for applying the same origin shift to the player and visuals.
   */
  rebaseChunks(delta: Vec3Data): void {
    this.assertFiniteVector(delta, 'chunk rebase delta');
    for (const body of this.chunkBodies.values()) {
      const current = body.translation();
      body.setTranslation(
        {
          x: current.x + delta.x,
          y: current.y + delta.y,
          z: current.z + delta.z,
        },
        true,
      );
    }
    this.world.propagateModifiedBodyPositionsToColliders();
    this.requestChunkSynchronization();
  }

  /**
   * Groups several stream mutations behind one Rapier broad-phase refresh.
   * This is especially important when all nine chunks change story at once.
   */
  batchChunkChanges<T>(operation: () => T): T {
    this.chunkMutationDepth += 1;
    try {
      return operation();
    } finally {
      this.chunkMutationDepth -= 1;
      if (this.chunkMutationDepth === 0 && this.chunkSynchronizationPending) {
        this.chunkSynchronizationPending = false;
        this.synchronizeChunkChanges();
      }
    }
  }

  move(desiredDelta: Vec3Data): CharacterMotionResult {
    this.controller.computeColliderMovement(this.playerCollider, desiredDelta);
    const allowed = this.controller.computedMovement();
    const current = this.playerBody.translation();
    this.playerBody.setNextKinematicTranslation({
      x: current.x + allowed.x,
      y: current.y + allowed.y,
      z: current.z + allowed.z,
    });
    this.world.step();
    this.syncPosition();
    this.movement.set(allowed.x, allowed.y, allowed.z);
    return {
      position: this.position,
      grounded: this.controller.computedGrounded(),
      moved: this.movement,
    };
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

  getPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.position);
  }

  private syncPosition(): void {
    const translation = this.playerBody.translation();
    this.position.set(translation.x, translation.y, translation.z);
  }

  private assertFiniteVector(vector: Vec3Data, label: string): void {
    if (!Number.isFinite(vector.x) || !Number.isFinite(vector.y) || !Number.isFinite(vector.z)) {
      throw new Error(`Invalid ${label}: expected finite coordinates.`);
    }
  }

  private synchronizeChunkChanges(): void {
    // Rapier updates its broad phase only during a simulation step. Without
    // this synchronization, a character query immediately following a chunk
    // load or rebase still sees the previous collider positions for one tick.
    this.world.step();
  }

  private requestChunkSynchronization(): void {
    if (this.chunkMutationDepth > 0) {
      this.chunkSynchronizationPending = true;
      return;
    }
    this.synchronizeChunkChanges();
  }

  dispose(): void {
    this.controller.free();
    this.chunkBodies.clear();
    this.world.free();
  }
}
