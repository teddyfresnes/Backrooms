import { SeededRandom } from '../world/SeededRandom';
import { CooperativeWork } from '../core/CooperativeWork';
import RAPIER from '@dimforge/rapier3d';
import * as THREE from 'three';
import type { QuaternionData, StaticCollider, Vec3Data, WorldPlan } from '../world/types';

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
  const description = (source.vertices && source.indices ? RAPIER.ColliderDesc.trimesh(new Float32Array(source.vertices), new Uint32Array(source.indices)) : source.vertices ? RAPIER.ColliderDesc.convexHull(new Float32Array(source.vertices))! : RAPIER.ColliderDesc.cuboid(
    source.halfExtents.x,
    source.halfExtents.y,
    source.halfExtents.z,
  ))
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
  private readonly gameplayRandom: SeededRandom;
  private randomSequence = 0;
  createRandom(label: string): SeededRandom { return this.gameplayRandom.fork(`${label}:${this.randomSequence++}`); }
  readonly world: RAPIER.World;
  private readonly environmentBodies = new Set<number>();
  private readonly environmentKinds = new Map<number, StaticCollider['kind']>();
  // Runs inside Rapier queries: it must never throw back into wasm (see
  // CharacterEnvironment.nearbyBoxes), so stale or missing colliders are rejected.
  isEnvironmentCollider = (collider: RAPIER.Collider): boolean => {
    try {
      const body = collider?.parent();
      return !!body && this.environmentBodies.has(body.handle) && collider.isEnabled() && !collider.isSensor();
    } catch { return false; }
  };
  isInteractionObstacle = (collider: RAPIER.Collider): boolean => this.isEnvironmentCollider(collider)
    || (!collider.isSensor() && ((collider.collisionGroups() >>> 16) & 0x4000) !== 0);
  getEnvironmentKind(collider: RAPIER.Collider): StaticCollider['kind'] {
    return this.environmentKinds.get(collider.handle) ?? 'wall';
  }
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
  private disposed = false;
  private confinedPlayer = false;
  private scriptedCapsuleKey = '';
  private readonly beforeStepObservers = new Set<(delta: number) => void>();
  onBeforeStep(observer: (delta: number) => void): () => void {
    this.beforeStepObservers.add(observer); return () => { this.beforeStepObservers.delete(observer); };
  }
  private notifyBeforeStep(): void { for (const observer of this.beforeStepObservers) observer(this.world.timestep); }
  private readonly stepObservers = new Set<(delta: number) => void>();
  /** Contact consumers share the host's fixed tick; they never step Rapier. */
  onAfterStep(observer: (delta: number) => void): () => void {
    this.stepObservers.add(observer); return () => { this.stepObservers.delete(observer); };
  }
  private notifyStep(): void { for (const observer of this.stepObservers) observer(this.world.timestep); }
  private readonly disposeAbort = new AbortController();
  private chunkMutationDepth = 0;
  private chunkSynchronizationPending = false;
  private emptyChunkIndexPending = false;

  private constructor(plan: WorldPlan) {
    this.gameplayRandom = new SeededRandom(plan.seed).fork('physics-gameplay');
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
    this.addChunk('origin', plan.colliders, { x: 0, y: 0, z: 0 });

    this.spawn.set(plan.spawn.x, plan.spawn.y, plan.spawn.z);
    this.playerBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(this.spawn.x, this.spawn.y, this.spawn.z)
        .lockRotations(),
    );
    this.playerCollider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(STANDING_HALF_HEIGHT, PLAYER_RADIUS)
        .setFriction(0)
        .setRestitution(0)
        // Ragdoll limbs ignore the player. A settled torso exposes one stable,
        // rounded support surface on a separate collision membership.
        .setCollisionGroups((PLAYER_COLLISION_GROUP << 16) | 0xffff),
      this.playerBody,
    );
    this.controller = this.world.createCharacterController(PLAYER_SKIN_WIDTH);
    this.controller.setSlideEnabled(true);
    // Accept the short support strip remaining on an oblique stair approach.
    this.controller.enableAutostep(0.38, 0.04, false);
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
  canStandAt(center: Vec3Data): boolean {
    return !this.world.intersectionWithShape(center, IDENTITY_ROTATION,
      new RAPIER.Capsule(STANDING_HALF_HEIGHT, PLAYER_RADIUS), undefined, undefined,
      this.playerCollider, this.playerBody, this.isEnvironmentCollider);
  }
  hasChunk(key: string): boolean { return this.chunkBodies.has(key); }
  /** First static environment surface along a ray (distance and surface normal), or null. */
  castEnvironmentRay(origin: Vec3Data, direction: Vec3Data, maxDistance: number): { distance: number; normal: Vec3Data } | null {
    const hit = this.world.castRayAndGetNormal(new RAPIER.Ray(origin, direction), maxDistance, true,
      undefined, undefined, undefined, undefined, this.isEnvironmentCollider);
    return hit ? { distance: hit.timeOfImpact, normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z } } : null;
  }

  private readonly navRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private readonly navBody = new RAPIER.Cuboid(0.22, 0.7, 0.22);
  private readonly navPoint = { x: 0, y: 0, z: 0 };
  /**
   * Floor height of a creature-sized cell centred on (x, z) near `floorY`, or
   * NaN: its body (0.5..1.9 m above the floor) must be clear of the
   * environment and a floor within `maxStep` of the datum must lie under it.
   * Reuses its query objects (called many times per second by the hunter).
   */
  probeWalkableCell(x: number, z: number, floorY: number, maxStep = 0.42): number {
    const point = this.navPoint;
    point.x = x; point.y = floorY + 1.2; point.z = z;
    if (this.world.intersectionWithShape(point, IDENTITY_ROTATION, this.navBody,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, undefined, this.isEnvironmentCollider)) return Number.NaN;
    const ray = this.navRay;
    ray.origin.x = x; ray.origin.y = floorY + 0.5; ray.origin.z = z;
    const hit = this.world.castRayAndGetNormal(ray, 0.5 + maxStep + 0.05, true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, undefined, this.isEnvironmentCollider);
    if (!hit || hit.normal.y < 0.7) return Number.NaN;
    const y = floorY + 0.5 - hit.timeOfImpact;
    return Math.abs(y - floorY) <= maxStep ? y : Number.NaN;
  }

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
        const created = addStaticCollider(this.world, body, collider);
        indexedColliders.set(collider.id, created);
        this.environmentKinds.set(created.handle, collider.kind);
      }
      this.chunkBodies.set(key, body);
      this.environmentBodies.add(body.handle);
      this.chunkColliders.set(key, indexedColliders);
      this.requestChunkSynchronization();
    } catch (error) {
      for (let i = 0; i < body.numColliders(); i++) this.environmentKinds.delete(body.collider(i).handle);
      this.environmentBodies.delete(body.handle);
      this.world.removeRigidBody(body);
      throw error;
    }
  }

  addKinematicChunk(key: string, colliders: readonly StaticCollider[]): void {
    if (!key) throw new Error('Physics chunk keys cannot be empty.');
    if (this.chunkBodies.has(key)) throw new Error(`Physics chunk already exists: ${key}`);

    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    try {
      const indexedColliders = new Map<string, RAPIER.Collider>();
      for (const collider of colliders) {
        if (indexedColliders.has(collider.id)) {
          throw new Error(`Duplicate collider id in chunk ${key}: ${collider.id}`);
        }
        const created = addStaticCollider(this.world, body, collider);
        indexedColliders.set(collider.id, created);
        this.environmentKinds.set(created.handle, collider.kind);
      }
      this.chunkBodies.set(key, body);
      this.environmentBodies.add(body.handle);
      this.chunkColliders.set(key, indexedColliders);
      this.requestChunkSynchronization();
    } catch (error) {
      for (let i = 0; i < body.numColliders(); i++) this.environmentKinds.delete(body.collider(i).handle);
      this.environmentBodies.delete(body.handle);
      this.world.removeRigidBody(body);
      throw error;
    }
  }

  getChunkCollider(key: string, colliderId: string): RAPIER.Collider | undefined { return this.chunkColliders.get(key)?.get(colliderId); }
  setKinematicChunkTransform(
    key: string,
    translation: Vec3Data,
    rotation: QuaternionData,
  ): boolean {
    const body = this.chunkBodies.get(key);
    if (!body || !body.isKinematic()) return false;
    this.assertFiniteVector(translation, `translation for chunk ${key}`);
    if (!Number.isFinite(rotation.x)
      || !Number.isFinite(rotation.y)
      || !Number.isFinite(rotation.z)
      || !Number.isFinite(rotation.w)) {
      throw new Error(`Invalid rotation for chunk ${key}: expected finite coordinates.`);
    }
    body.setTranslation(translation, true);
    body.setRotation(rotation, true);
    body.setNextKinematicTranslation(translation);
    body.setNextKinematicRotation(rotation);
    this.world.propagateModifiedBodyPositionsToColliders();
    return true;
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
      this.environmentBodies.add(body.handle);
      this.chunkColliders.set(key, new Map());
      this.requestChunkSynchronization();
    } catch (error) {
      for (let i = 0; i < body.numColliders(); i++) this.environmentKinds.delete(body.collider(i).handle);
      this.environmentBodies.delete(body.handle);
      this.world.removeRigidBody(body);
      throw error;
    }
  }

  async addTrimeshChunkAsync(key: string, meshes: readonly THREE.Mesh[], signal?: AbortSignal): Promise<void> {
    const work = new CooperativeWork(AbortSignal.any([this.disposeAbort.signal, ...(signal ? [signal] : [])]));
    await work.checkpoint(true);
    if (!key) throw new Error('Physics chunk keys cannot be empty.');
    if (this.chunkBodies.has(key)) throw new Error(`Physics chunk already exists: ${key}`);
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const vertex = new THREE.Vector3();
    try {
      for (const mesh of meshes) {
        await work.checkpoint();
        mesh.updateWorldMatrix(true, false);
        const geometry = mesh.geometry;
        const position = geometry.getAttribute('position');
        if (!position || position.itemSize < 3 || position.count < 3) continue;
        const vertices = new Float32Array(position.count * 3);
        for (let index = 0; index < position.count; index += 1) {
          if (index % 4096 === 0) await work.checkpoint();
          vertex.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
          vertices[index * 3] = vertex.x;
          vertices[index * 3 + 1] = vertex.y;
          vertices[index * 3 + 2] = vertex.z;
        }
        let indices: Uint32Array;
        if (geometry.index) {
          indices = new Uint32Array(geometry.index.count);
          for (let index = 0; index < geometry.index.count; index += 1) {
            if (index % 12288 === 0) await work.checkpoint();
            indices[index] = geometry.index.getX(index);
          }
        } else {
          const triangleVertexCount = Math.floor(position.count / 3) * 3;
          indices = new Uint32Array(triangleVertexCount);
          for (let index = 0; index < triangleVertexCount; index += 1) {
            if (index % 12288 === 0) await work.checkpoint();
            indices[index] = index;
          }
        }
        if (indices.length < 3) continue;
        this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(0.58).setRestitution(0), body);
      }
      this.chunkBodies.set(key, body);
      this.environmentBodies.add(body.handle);
      this.chunkColliders.set(key, new Map());
      this.requestChunkSynchronization();
    } catch (error) {
      if (this.disposed) throw error;
      for (let i = 0; i < body.numColliders(); i++) this.environmentKinds.delete(body.collider(i).handle);
      this.environmentBodies.delete(body.handle);
      this.world.removeRigidBody(body);
      throw error;
    }
  }

  removeChunk(key: string): boolean {
    const body = this.chunkBodies.get(key);
    if (!body) return false;
    for (let i = 0; i < body.numColliders(); i++) this.environmentKinds.delete(body.collider(i).handle);
    this.environmentBodies.delete(body.handle);
    // A failed removal must not abort the caller's teardown (menu return);
    // World.free() reclaims the body with the rest of the world.
    try { this.world.removeRigidBody(body); }
    catch (error) { console.warn('[physics] chunk body left for world teardown', key, error); }
    if (this.environmentKinds.size === 0) this.emptyChunkIndexPending = true;
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

  /** Read-only full-animation clearance, including limbs, root path and floor. */
  hasAnimationSpace(feet: Vec3Data, yaw: number, bounds: THREE.Box3, groundPoints: readonly THREE.Vector3[], ignoredBodies: ReadonlySet<number> = new Set<number>()): boolean {
    const rotation = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    const center = bounds.getCenter(new THREE.Vector3()).applyQuaternion(rotation).add(feet);
    const half = bounds.getSize(new THREE.Vector3()).multiplyScalar(.5);
    const solid = (collider: RAPIER.Collider): boolean => collider.isEnabled()
      && (collider.parent()?.isEnabled() ?? true) && !ignoredBodies.has(collider.parent()?.handle ?? -1);
    if (this.world.intersectionWithShape(center, rotation, new RAPIER.Cuboid(half.x, half.y, half.z),
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.playerCollider, this.playerBody, solid)) return false;
    const point = new THREE.Vector3();
    const supported = (x: number, z: number): boolean => {
      const hit = this.world.castRayAndGetNormal(new RAPIER.Ray({ x, y: feet.y + .45, z }, { x: 0, y: -1, z: 0 }),
        .7, true, RAPIER.QueryFilterFlags.ONLY_FIXED | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined, this.playerCollider, this.playerBody, solid);
      return !!hit && hit.normal.y > .92 && Math.abs(.45 - hit.timeOfImpact) < .10;
    };
    for (const root of groundPoints) {
      point.copy(root).applyQuaternion(rotation).add(feet);
      for (const [dx, dz] of [[0, 0], [.22, 0], [-.22, 0], [0, .22], [0, -.22]]) {
        if (!supported(point.x + dx!, point.z + dz!)) return false;
      }
    }
    for (const x of [bounds.min.x, bounds.max.x]) for (const z of [bounds.min.z, bounds.max.z]) {
      point.set(x, 0, z).applyQuaternion(rotation).add(feet);
      if (!supported(point.x, point.z)) return false;
    }
    return true;
  }

  /** Floor under a prone body; this does not require enough height to stand. */
  findAnimationGround(pelvis: Vec3Data): THREE.Vector3 | null {
    const rayY = pelvis.y + .45;
    const hit = this.world.castRayAndGetNormal(new RAPIER.Ray({ x: pelvis.x, y: rayY, z: pelvis.z }, { x: 0, y: -1, z: 0 }),
      2.2, true, RAPIER.QueryFilterFlags.ONLY_FIXED | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    if (!hit || hit.normal.y < .92 || hit.timeOfImpact < .3) return null;
    return new THREE.Vector3(pelvis.x, rayY - hit.timeOfImpact, pelvis.z);
  }

  move(desiredDelta: Vec3Data): CharacterMotionResult {
    // KCC shape casts do not inherit the capsule's simulation collision groups.
    // Pass them explicitly or every articulated limb still blocks the player.
    this.controller.computeColliderMovement(this.playerCollider, desiredDelta,
      undefined, this.playerCollider.collisionGroups());
    let allowed = this.controller.computedMovement();
    let grounded = this.controller.computedGrounded();
    const requestedHorizontal = Math.hypot(desiredDelta.x, desiredDelta.z);
    // A capsule already resting within the floor skin can get a zero-time
    // downward hit and lose all tangential recoil. Retry that horizontal sweep
    // separately, through the same KCC and collision groups, never by teleport.
    if (grounded && desiredDelta.y <= 0 && requestedHorizontal > 0.005
      && Math.hypot(allowed.x, allowed.z) < requestedHorizontal * 0.25
      && this.controller.numComputedCollisions() > 0) {
      let floorOnly = true;
      for (let i = 0; i < this.controller.numComputedCollisions(); i++) {
        if ((this.controller.computedCollision(i)?.normal1.y ?? 0) < 0.99) { floorOnly = false; break; }
      }
      if (floorOnly) {
        const floorY = allowed.y;
        this.controller.computeColliderMovement(this.playerCollider,
          { x: desiredDelta.x, y: 0, z: desiredDelta.z }, undefined, this.playerCollider.collisionGroups());
        const horizontal = this.controller.computedMovement();
        allowed = { x: horizontal.x, y: floorY + horizontal.y, z: horizontal.z };
        grounded ||= this.controller.computedGrounded();
      }
    }
    // Pressed against a wall or railing on stairs, the part of the request that
    // points into the wall makes Rapier's autostep fail on every riser. Retry
    // once with that component removed (pure tangent along the wall).
    if (requestedHorizontal > 0.005 && Math.hypot(allowed.x, allowed.z) < requestedHorizontal * 0.6
      && this.controller.numComputedCollisions() > 0) {
      let x = desiredDelta.x, z = desiredDelta.z, walls = 0;
      for (let i = 0; i < this.controller.numComputedCollisions(); i++) {
        const normal = this.controller.computedCollision(i)?.normal1;
        if (!normal || Math.abs(normal.y) > 0.3) continue;
        const length = Math.hypot(normal.x, normal.z);
        if (length < 1e-4) continue;
        const nx = normal.x / length, nz = normal.z / length, into = x * nx + z * nz;
        if (into < 0) { x -= nx * into; z -= nz * into; walls++; }
      }
      const tangent = Math.hypot(x, z);
      // Only grazing contacts: a head-on riser or wall leaves no tangent to follow.
      if (walls > 0 && tangent > requestedHorizontal * 0.3 && tangent < requestedHorizontal * 0.999) {
        this.controller.computeColliderMovement(this.playerCollider,
          { x, y: desiredDelta.y, z }, undefined, this.playerCollider.collisionGroups());
        const retry = this.controller.computedMovement();
        if (Math.hypot(retry.x, retry.z) > Math.hypot(allowed.x, allowed.z) + 1e-5) {
          allowed = { x: retry.x, y: retry.y, z: retry.z };
          grounded = this.controller.computedGrounded();
        }
      }
    }
    const current = this.playerBody.translation();
    this.playerBody.setNextKinematicTranslation({ x: current.x + allowed.x, y: current.y + allowed.y, z: current.z + allowed.z });
    this.notifyBeforeStep();
    this.world.step();
    this.notifyStep();
    this.syncPosition();
    this.movement.set(allowed.x, allowed.y, allowed.z);
    return { position: this.position, grounded, moved: this.movement };
  }

  stepDynamics(delta: number): void {
    const previousTimestep = this.world.timestep;
    try {
      this.world.timestep = Math.max(1 / 240, Math.min(1 / 30, delta));
      this.notifyBeforeStep();
      this.world.step();
      this.notifyStep();
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
        0x00010001,
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
  /** Shape changes move the capsule center, never its supporting feet. */
  get crouchCenterOffset(): number { return this.crouched ? CROUCH_CENTER_DROP : 0; }
  get crouchedCenterDrop(): number { return CROUCH_CENTER_DROP; }
  setScriptedPlayerPose(position: Vec3Data, confined: boolean, shape?: {halfHeight:number;radius:number}): void {
    this.assertFiniteVector(position, 'scripted player pose');
    const halfHeight=shape?.halfHeight??(confined?.42:this.crouched?CROUCHED_HALF_HEIGHT:STANDING_HALF_HEIGHT),radius=shape?.radius??(confined?.23:PLAYER_RADIUS);
    const key=`${halfHeight.toFixed(4)}:${radius.toFixed(4)}`;
    if(this.confinedPlayer!==confined||this.scriptedCapsuleKey!==key){
      this.confinedPlayer=confined;this.scriptedCapsuleKey=key;
      this.playerCollider.setShape(new RAPIER.Capsule(halfHeight,radius));
    }
    this.playerBody.setTranslation(position, true); this.playerBody.setNextKinematicTranslation(position);
    this.world.propagateModifiedBodyPositionsToColliders(); this.syncPosition();
  }
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
  private synchronizeChunkChanges(): void {
    if (this.emptyChunkIndexPending) {
      this.emptyChunkIndexPending = false;
      if (this.environmentKinds.size === 0) {
        // No environment leaf survives. Start a fresh query tree instead of
        // retaining Rapier's empty BVH across complete streamed scene reloads.
        // Controllers retain this wrapper. Replace only its owned raw tree.
        const broadPhase = this.world.broadPhase;
        const RawBroadPhase = broadPhase.raw.constructor as new () => typeof broadPhase.raw;
        broadPhase.free(); broadPhase.raw = new RawBroadPhase();
        this.world.colliders.forEach(c => { const enabled = c.isEnabled(); if (enabled) { c.setEnabled(false); c.setEnabled(true); } });
      }
    }
    // Rapier refreshes its query BVH during step(). A stream mount is not a
    // gameplay tick: advancing 1/60 here accelerated every active ragdoll once
    // more whenever a layer appeared. A zero-time synchronization only updates
    // the collision structures; the fixed-step driver owns elapsed time.
    const previousTimestep = this.world.timestep;
    try { this.world.timestep = 0; this.world.step(); }
    finally { this.world.timestep = previousTimestep; }
  }
  private requestChunkSynchronization(): void {
    if (this.chunkMutationDepth > 0) { this.chunkSynchronizationPending = true; return; }
    this.synchronizeChunkChanges();
  }
  dispose(): void {
    this.stepObservers.clear(); this.beforeStepObservers.clear();
    this.disposed = true;
    this.disposeAbort.abort();
    this.controller.free();
    this.chunkBodies.clear();
    this.chunkColliders.clear();
    this.environmentBodies.clear();
    this.environmentKinds.clear();
    this.world.free();
  }
}
