import type { SeededRandom } from '../world/SeededRandom';
import RAPIER from '@dimforge/rapier3d';
import * as THREE from 'three';
import { combatKnockoutEnvelope } from './CombatKnockoutMotion';
import { PhysicsWorld } from './PhysicsWorld';
import type { GroundKickVolume } from './GroundKickContact';
import { activeRagdollAnimationCarry, activeRagdollEnvelope, activeRagdollProfile } from './ActiveRagdollMotion';
import type { ActiveRagdollProfile } from './ActiveRagdollMotion';
import type { StaticCollider } from '../world/types';
import {
  FINAL_SETTLE_RELEASE_THRESHOLD,
  FATAL_FALL_TERMINAL_REST_HOLD_SECONDS,
  ragdollTerminalRestEligible,
  ragdollFinalRelaxationEnvelope,
  ragdollFinalSupportRelease,
  ragdollLegScissorClosure,
} from './RagdollFinalSettling';

const WORLD_GROUP = 0x0001;
// Every visible ragdoll part gets its own collision bit. This lets non-adjacent
// pieces collide with each other instead of allowing whole limbs/core sections
// to ghost through one another because they shared one broad collision group.
const PELVIS_GROUP = 0x0002;
const TORSO_GROUP = 0x0004;
const HEAD_GROUP = 0x0008;
const LEFT_UPPER_ARM_GROUP = 0x0010;
const LEFT_FOREARM_GROUP = 0x0020;
const RIGHT_UPPER_ARM_GROUP = 0x0040;
const RIGHT_FOREARM_GROUP = 0x0080;
const LEFT_UPPER_LEG_GROUP = 0x0100;
const LEFT_LOWER_LEG_GROUP = 0x0200;
const RIGHT_UPPER_LEG_GROUP = 0x0400;
const RIGHT_LOWER_LEG_GROUP = 0x0800;
const PLAYER_COLLISION_GROUP = 0x1000;

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const DOWN_AXIS = new THREE.Vector3(0, -1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const BASE_LINEAR_DAMPING = 0.11;
const BASE_ANGULAR_DAMPING = 1.05;
const RAGDOLL_GRAVITY_SCALE = 1.16;
const MIN_SETTLE_TIME = 1.75;
const SELF_COLLISION_DELAY = 0.24;
const COHERENCE_DURATION = 0.30;
const RAGDOLL_SUBSTEPS = 5;
const BALLISTIC_SUBSTEPS = 2;
const ANATOMY_SOFT_ZONE = 0.72;
// Animation inertia is intentionally a little under 1:1. It should make a
// swinging arm / stepping leg continue naturally into physics, but malformed
// source keys or a sharp crossfade must never become a ragdoll catapult.
const ANIMATION_LINEAR_INERTIA_SCALE = 0.94;
const ANIMATION_ANGULAR_INERTIA_SCALE = 0.90;
const MAX_ANIMATION_RELATIVE_LINEAR_SPEED = 6.1;
const MAX_ANIMATION_RELATIVE_ANGULAR_SPEED = 8.4;
const HIP_LATERAL_LIMIT_DEGREES = 18;
const ARM_SUPPORT_RELEASE_ANGULAR_SPEED = 0.16;
const FINAL_SETTLE_HOLD_SECONDS = 0.72;
const FINAL_SETTLE_CORE_GRAVITY_SCALE = 1.62;
const FINAL_SETTLE_ARM_FRICTION = 0.34;
const FINAL_SETTLE_LEG_FRICTION = 0.38;
const FINAL_RELAX_HEAD_GRAVITY_SCALE = 1.48;
const FINAL_RELAX_HEAD_ANGULAR_DAMPING = 0.48;
const FINAL_RELAX_HEAD_HOLD_SECONDS = 0.52;
const FINAL_RELAX_LEG_FRICTION = 0.58;
const FINAL_RELAX_HIP_ACCELERATION = 1.9;
// A lethal high-fall impact is already an energetic full-body event. After the
// impact we let contacts finish naturally, then progressively remove residual
// spin. Nothing is hard-locked: unsupported limbs remain dynamic until Rapier
// has genuinely brought the complete body to rest.
const FATAL_FALL_AWAKE_GRACE_SECONDS = 0.52;
const FATAL_FALL_SETTLE_GUARD_SECONDS = 0.90;
const FATAL_FALL_DAMPING_DELAY_SECONDS = 0.18;
const FATAL_FALL_DAMPING_RAMP_SECONDS = 0.92;
const FATAL_FALL_LINEAR_DAMPING = 0.62;
const FATAL_FALL_ANGULAR_DAMPING = 2.65;

const makeCollisionGroups = (membership: number, filter: number): number => (
  ((membership & 0xffff) << 16) | (filter & 0xffff)
);

// Full all-vs-all ragdoll self-collision creates many unnecessary contact loops.
// Keep only the pairs that visibly matter: distal limbs against the core/head,
// opposite distal limbs against each other, and everything against the world.
// Proximal limbs are already kept anatomical by their direct joints and limits.
const desiredCollisionFilter = (membership: number): number => {
  const distalArms = LEFT_FOREARM_GROUP | RIGHT_FOREARM_GROUP;
  const distalLegs = LEFT_LOWER_LEG_GROUP | RIGHT_LOWER_LEG_GROUP;
  const distal = distalArms | distalLegs;
  switch (membership) {
    case PELVIS_GROUP:
      return WORLD_GROUP | HEAD_GROUP | distal;
    case TORSO_GROUP:
      return WORLD_GROUP | HEAD_GROUP | distal;
    case HEAD_GROUP:
      return WORLD_GROUP | PELVIS_GROUP | TORSO_GROUP | distal;
    case LEFT_UPPER_ARM_GROUP:
    case RIGHT_UPPER_ARM_GROUP:
    case LEFT_UPPER_LEG_GROUP:
    case RIGHT_UPPER_LEG_GROUP:
      // Proximal parts share an anatomical joint with the core. Let the hard
      // joint limits, not a collider pair at the socket itself, keep them out
      // of impossible poses. This avoids hip/shoulder contact wedging.
      return WORLD_GROUP;
    case LEFT_FOREARM_GROUP:
      return WORLD_GROUP | PELVIS_GROUP | TORSO_GROUP | HEAD_GROUP
        | RIGHT_FOREARM_GROUP | distalLegs;
    case RIGHT_FOREARM_GROUP:
      return WORLD_GROUP | PELVIS_GROUP | TORSO_GROUP | HEAD_GROUP
        | LEFT_FOREARM_GROUP | distalLegs;
    case LEFT_LOWER_LEG_GROUP:
      return WORLD_GROUP | PELVIS_GROUP | TORSO_GROUP | HEAD_GROUP
        | RIGHT_LOWER_LEG_GROUP | distalArms;
    case RIGHT_LOWER_LEG_GROUP:
      return WORLD_GROUP | PELVIS_GROUP | TORSO_GROUP | HEAD_GROUP
        | LEFT_LOWER_LEG_GROUP | distalArms;
    default:
      return WORLD_GROUP;
  }
};

interface RagdollBody {
  readonly id: string;
  readonly body: RAPIER.RigidBody;
  readonly membership: number;
  readonly desiredCollisionGroups: number;
  readonly colliders: RAPIER.Collider[];
  lastLinearSpeed: number;
  lastAngularSpeed: number;
  readonly preStepVelocity: THREE.Vector3;
  impactCooldown: number;
}

interface BoneBinding {
  readonly bone: THREE.Bone;
  readonly body: RagdollBody;
  readonly bodyToBoneRotation: THREE.Quaternion;
  readonly bodyToBonePosition?: THREE.Vector3;
}

interface AngularLimit {
  readonly parent: RagdollBody;
  readonly child: RagdollBody;
  readonly initialRelative: THREE.Quaternion;
  // Swing and axial twist are limited separately. A single spherical cone lets
  // an arm/head spin around its own long axis, which is exactly how a visually
  // 'reversed' limb can still remain inside a nominal total-angle limit.
  readonly maxSwing: number;
  readonly maxTwist: number;
}

interface HingeLimit {
  readonly parent: RagdollBody;
  readonly child: RagdollBody;
  readonly bendSign: number;
  readonly maxFlex: number;
  readonly maxHyperextension: number;
}

interface JointLink {
  readonly parent: RagdollBody;
  readonly child: RagdollBody;
}

interface GravityRelease {
  readonly parent: RagdollBody;
  readonly child: RagdollBody;
  readonly parentAnchorLocal: THREE.Vector3;
  readonly nudgeAxisParentLocal: THREE.Vector3;
  readonly mode: 'raised' | 'support';
  released: boolean;
}

interface SegmentSpec {
  readonly id: string;
  readonly start: THREE.Bone;
  readonly end: THREE.Bone;
  readonly radius: number;
  readonly density: number;
  readonly membership: number;
  readonly xHint: THREE.Vector3;
  readonly fallbackHint: THREE.Vector3;
  readonly startInset?: number;
  readonly endInset?: number;
  readonly endCapRadius?: number;
}

export interface RagdollInitialMotion {
  readonly velocity: Readonly<THREE.Vector3>;
  readonly yawRateRadians: number;
  /**
   * Bone-space motion measured from the last two rendered animation poses.
   * Values are world-space velocities. RagdollSystem removes the sampled root
   * motion and re-adds the authoritative PlayerController velocity/yaw, so the
   * limb inertia is preserved without double-counting locomotion.
   */
  readonly animationMotion?: RagdollAnimationMotion;
  /** Quiet hand-off for an authored impact pose that is already on the ground. */
  readonly quietStart?: boolean;
  /** Scales the coherent whole-body fall bias without changing inherited speed. */
  readonly tipScale?: number;
  /** Scales tiny random death variation impulses. */
  readonly variationScale?: number;
  /**
   * Scales the short active-fall reflex window. 0 keeps a completely passive
   * hand-off; 1 lets gait carry / protective arm reactions decay naturally.
   */
  readonly activeResponseScale?: number;
}


export interface RagdollImpactEvent {
  readonly bodyId: string;
  readonly position: THREE.Vector3;
  readonly velocityBefore: THREE.Vector3;
  readonly velocityAfter: THREE.Vector3;
  readonly velocityChange: number;
  /** Actual fixed-world contact; absent only for externally authored events. */
  readonly normal?: THREE.Vector3;
  readonly contactKind?: StaticCollider['kind'];
}

export interface RagdollBoneMotion {
  readonly linearVelocity: Readonly<THREE.Vector3>;
  readonly angularVelocity: Readonly<THREE.Vector3>;
}

export interface RagdollAnimationMotion {
  readonly bones: Readonly<Record<string, RagdollBoneMotion>>;
}

const normalizeName = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const bodyRotation = (body: RAPIER.RigidBody, target = new THREE.Quaternion()): THREE.Quaternion => {
  const value = body.rotation();
  return target.set(value.x, value.y, value.z, value.w).normalize();
};

const bodyPosition = (body: RAPIER.RigidBody, target = new THREE.Vector3()): THREE.Vector3 => {
  const value = body.translation();
  return target.set(value.x, value.y, value.z);
};

const inverseAngularInertiaAlong = (body: RAPIER.RigidBody, axis: THREE.Vector3): number => {
  const inertia = body.effectiveWorldInvInertia();
  return axis.x * (inertia.m11 * axis.x + inertia.m12 * axis.y + inertia.m13 * axis.z)
    + axis.y * (inertia.m21 * axis.x + inertia.m22 * axis.y + inertia.m23 * axis.z)
    + axis.z * (inertia.m31 * axis.x + inertia.m32 * axis.y + inertia.m33 * axis.z);
};

const wrapAngle = (angle: number): number => {
  let wrapped = angle;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  while (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
};

/**
 * Runtime physical ragdoll for the Animation Lab character.
 *
 * The live PlayerController remains kinematic and untouched. On death its
 * collider is disabled and the evaluated visual pose is handed to a separate
 * articulated rigid-body rig. Elbows/knees are true one-axis hinges; the
 * remaining joints use conservative cone limits plus selective self-collision.
 */
export class RagdollSystem {
  private readonly random: SeededRandom;
  private readonly bodies = new Map<string, RagdollBody>();
  private readonly bindings: BoneBinding[] = [];
  private readonly limits: AngularLimit[] = [];
  private readonly hingeLimits: HingeLimit[] = [];
  private readonly links: JointLink[] = [];
  private readonly gravityReleases: GravityRelease[] = [];
  private readonly ownedBodies: RAPIER.RigidBody[] = [];
  private readonly ownedJoints: RAPIER.ImpulseJoint[] = [];
  private readonly jointFrameBodies: RAPIER.RigidBody[] = [];
  private readonly impactEvents: RagdollImpactEvent[] = [];
  private readonly flightQuery = new RAPIER.Cuboid(1, 1, 1);
  private readonly flightQueryCenter = new THREE.Vector3();
  private sharedWorldActive = false;
  private readonly markSharedWorldActive = (body: RAPIER.RigidBody): void => {
    if (this.sharedWorldActive || !body.isEnabled()) return;
    if (body.isDynamic()) { this.sharedWorldActive = !body.isSleeping(); return; }
    if (!body.isKinematic()) return;
    if (body.isMoving()) { this.sharedWorldActive = true; return; }
    const p=body.translation(),next=body.nextTranslation(),q=body.rotation(),r=body.nextRotation();
    this.sharedWorldActive = p.x!==next.x || p.y!==next.y || p.z!==next.z || q.x!==r.x || q.y!==r.y || q.z!==r.z || q.w!==r.w;
  };
  private combatKnockoutStartedAt = -Infinity;
  private combatKnockoutCurl = 0;
  private combatKnockoutSide = 0;
  private combatKnockoutArmHeight = .12;
  private readonly combatKnockoutHandAnchors = new Map<string, THREE.Vector3>();
  private readonly tempPositionA = new THREE.Vector3();
  private readonly tempPositionB = new THREE.Vector3();
  private readonly tempPositionC = new THREE.Vector3();
  private readonly tempPositionD = new THREE.Vector3();
  private readonly tempPositionE = new THREE.Vector3();
  private readonly tempQuaternionA = new THREE.Quaternion();
  private readonly tempQuaternionB = new THREE.Quaternion();
  private readonly tempQuaternionC = new THREE.Quaternion();
  private readonly tempQuaternionD = new THREE.Quaternion();
  private readonly tempQuaternionE = new THREE.Quaternion();
  private readonly tempQuaternionF = new THREE.Quaternion();
  private readonly tempQuaternionG = new THREE.Quaternion();
  private readonly tempMatrix = new THREE.Matrix4();
  private readonly tempX = new THREE.Vector3();
  private readonly tempY = new THREE.Vector3();
  private readonly tempZ = new THREE.Vector3();
  private readonly tempAngularA = new THREE.Vector3();
  private readonly tempAngularB = new THREE.Vector3();
  private readonly tempAngularC = new THREE.Vector3();
  private readonly hips: THREE.Bone;
  private readonly head: THREE.Bone;
  private readonly initialMotionOrigin = new THREE.Vector3();
  private linearSpeedCap = 15;
  private angularSpeedCap = 7.6;
  private settledElapsed = 0;
  private elapsed = 0;
  private settled = false;
  private selfCollisionsEnabled = false;
  private initialVerticalSpeed = 0;
  private quietStart = false;
  private tipScale = 1;
  private variationScale = 1;
  private activeResponseScale = 1;
  private activeProfile?: ActiveRagdollProfile;
  private readonly activeForward = new THREE.Vector3();
  private readonly activeRight = new THREE.Vector3();
  private activeGaitPhase = 0;
  private activeArmPhase = 0;
  private activeAsymmetrySign = 1;
  private activeRecoveryFootSign = 1;
  private animationMotion?: RagdollAnimationMotion;
  private playerNudgeCooldown = 0;
  private playerTraversalEnabled = false;
  private traversalBody?: RAPIER.RigidBody;
  private traversalCollider?: RAPIER.Collider;
  private readonly traversalCorePosition = new THREE.Vector3();
  private traversalQuietSeconds = 0;
  private finalSettleReleaseStrength = 0;
  private finalSettleReleaseHold = 0;
  private readonly finalNeckAnchorCoreLocal = new THREE.Vector3();
  private finalHeadRelaxTriggered = false;
  private finalHeadRelaxHold = 0;
  private finalLegClosureStrength = 0;
  private fatalFallImpactElapsed = -1;
  private fatalFallImpactStrength = 0;
  private fatalFallSupportRestored = false;
  private groundRestHold = 0;
  private groundRestCandidate = false;
  private lastExternalImpactAt = -Infinity;

  private constructor(
    private readonly physics: PhysicsWorld,
    private readonly character: THREE.Group,
    hips: THREE.Bone,
    head: THREE.Bone,
  ) {
    this.random = physics.createRandom('ragdoll');
    this.hips = hips;
    this.head = head;
  }

  static create(
    physics: PhysicsWorld,
    character: THREE.Group,
    motion: RagdollInitialMotion,
  ): RagdollSystem {
    character.updateMatrixWorld(true);
    const bones = new Map<string, THREE.Bone>();
    character.traverse((object) => {
      const bone = object as THREE.Bone;
      if (bone.isBone) bones.set(normalizeName(bone.name), bone);
    });

    const find = (suffix: string): THREE.Bone => {
      const normalizedSuffix = normalizeName(suffix);
      for (const [name, bone] of bones) {
        if (name.endsWith(normalizedSuffix)) return bone;
      }
      throw new Error(`Ragdoll: os requis introuvable (${suffix}).`);
    };

    const hips = find('hips');
    const spine = find('spine');
    const spine1 = find('spine1');
    const spine2 = find('spine2');
    const neck = find('neck');
    const head = find('head');
    const headTop = find('headtopend');
    const leftArm = find('leftarm');
    const leftForeArm = find('leftforearm');
    const leftHand = find('lefthand');
    const rightArm = find('rightarm');
    const rightForeArm = find('rightforearm');
    const rightHand = find('righthand');
    const leftUpLeg = find('leftupleg');
    const leftLeg = find('leftleg');
    const leftFoot = find('leftfoot');
    const rightUpLeg = find('rightupleg');
    const rightLeg = find('rightleg');
    const rightFoot = find('rightfoot');

    const ragdoll = new RagdollSystem(physics, character, hips, head);
    ragdoll.build(
      {
        hips, spine, spine1, spine2, neck, head, headTop,
        leftArm, leftForeArm, leftHand, rightArm, rightForeArm, rightHand,
        leftUpLeg, leftLeg, leftFoot, rightUpLeg, rightLeg, rightFoot,
      },
      motion,
    );
    ragdoll.syncSkeleton();
    return ragdoll;
  }

  get isSettled(): boolean { return this.settled; }

  /**
   * Recovery should not depend on every fingertip/foot rigid body entering
   * Rapier sleep. A living player may request get-up once the core has been
   * down long enough and is no longer moving violently. The standing-space
   * query in AnimationLab still prevents mid-air / pit-lip recovery.
   */
  get isRecoveryReady(): boolean {
    if (this.settled) return true;
    if (this.elapsed < 1.05) return false;
    // A distal limb can keep a Rapier island microscopically awake forever.
    // After a short grace period we let the standing-space test be the final
    // authority, guaranteeing that a living player is never stranded on floor.
    if (this.elapsed >= 2.5) return true;
    const core = this.bodies.get('core');
    if (!core || !core.body.isValid()) return false;
    const linear = core.body.linvel();
    const angular = core.body.angvel();
    const linearSpeed = Math.hypot(linear.x, linear.y, linear.z);
    const angularSpeed = Math.hypot(angular.x, angular.y, angular.z);
    return linearSpeed <= 1.15 && angularSpeed <= 2.4;
  }

  drainImpactEvents(): RagdollImpactEvent[] {
    if (this.impactEvents.length === 0) return [];
    return this.impactEvents.splice(0, this.impactEvents.length);
  }

  /**
   * Called only when an already-airborne pit ragdoll receives the floor/step
   * impact that makes a large drop fatal. The old late pose helpers were useful
   * for gentle deaths, but after a violent landing they could repeatedly wake
   * the core and bias the hips, feeding the curled/rolling loop seen on lethal
   * falls. This switches that corpse to a passive, progressively damped settle.
   */
  beginFatalFallSettling(impactSpeed: number): void {
    if (this.fatalFallImpactElapsed >= 0) return;
    this.fatalFallImpactElapsed = 0;
    this.fatalFallImpactStrength = THREE.MathUtils.clamp((impactSpeed - 6.5) / 8.5, 0, 1);
    this.fatalFallSupportRestored = false;
    this.resetGroundRestAfterImpact();

    // A lethal floor impact must never keep the generic anti-perch state alive:
    // lowering limb friction / increasing core gravity can turn the first hand
    // or foot that touches down into a pivot and make the whole corpse orbit it.
    // Restore ordinary passive support immediately. From here on we do not
    // rewrite individual limb velocities: Rapier owns the collapse until a
    // grounded/stable detector proves the whole body is genuinely down.
    this.restoreFatalFallSupportState();

    // No reflex or cosmetic hip/head motor is allowed to add energy after the
    // lethal landing. Reset any late-relaxation state that may have opened while
    // a long fall was in progress.
    this.activeResponseScale = 0;
    this.finalHeadRelaxTriggered = true;
    this.restoreFinalPoseRelaxation();

    // Make sure the impact gets a real physical follow-through. We intentionally
    // wake bodies here instead of sleeping/freezing them; gravity and contacts
    // remain authoritative during the post-impact grace period.
    for (const body of this.ownedBodies) {
      if (body.isValid()) body.wakeUp();
    }
  }

  fixedUpdate(delta: number): void {
    const safeDelta = Math.max(0, delta);
    if (safeDelta <= 0) return;
    if (this.settled) {
      // This ragdoll is the shared world's driver, even while its own island
      // sleeps. NPCs and previous corpses must still advance exactly once.
      if (this.ownedBodies.every(body => !body.isValid() || body.isSleeping())) {
        this.sharedWorldActive = false;
        // Rapier's active-island iterator is refreshed by step(), so it omits
        // a newly created/woken actor until that first step. Inspect the small
        // body set (not the thousands of static colliders) and pending kinematics.
        this.physics.world.forEachRigidBody(this.markSharedWorldActive);
        if (this.sharedWorldActive) this.physics.stepDynamics(safeDelta);
        return;
      }
      // Removing a support or another physical body hitting the island may wake
      // it without going through a gameplay impulse. Resume the physical fall.
      this.settled = false;
      this.resetGroundRestAfterImpact();
    }
    this.elapsed += safeDelta;
    if (this.fatalFallImpactElapsed >= 0) this.fatalFallImpactElapsed += safeDelta;

    if (!this.selfCollisionsEnabled && this.elapsed >= SELF_COLLISION_DELAY) {
      this.enableSelfCollisions();
    }

    // Smaller ragdoll substeps make the articulated contacts much harder to
    // destabilise than one large 60 Hz solve. The world timestep is restored
    // immediately afterwards so the live PlayerController keeps its contract.
    const previousTimestep = this.physics.world.timestep;
    const substeps = this.ballisticStepIsClear(safeDelta) ? BALLISTIC_SUBSTEPS : RAGDOLL_SUBSTEPS;
    const substep = safeDelta / substeps;
    try {
      this.physics.world.timestep = substep;
      for (let index = 0; index < substeps; index += 1) {
        // At the start of a death, damp only *relative* angular motion. This
        // keeps the silhouette coherent without forcing it toward an animation.
        this.applyEarlyCoherence();
        this.applyActiveFallReactions(substep);
        this.applyCombatKnockoutContraction(substep);
        if (this.fatalFallImpactElapsed >= 0) {
          // High-fall deaths are purely passive after impact. In particular,
          // never run the generic support-release helper here: on a violent
          // landing a planted distal limb can become its temporary pivot. Do
          // not project per-body velocities either; that fights the joints and
          // can itself create the "orbit around an invisible point" artefact.
          // Let Rapier collapse the body naturally, using damping only.
          this.restoreFatalFallSupportState();
          this.applyFatalFallSettling();
        } else if (!this.groundRestCandidate) {
          this.applyFinalSupportRelease(substep);
          if (!Number.isFinite(this.combatKnockoutStartedAt)) this.applyFinalPoseRelaxation(substep);
        }
        this.captureImpactPreStep(substep);
        this.physics.world.step();
        this.collectImpactEvents();
        this.enforceSafetyLimits(substep);
      }
    } finally {
      this.physics.world.timestep = previousTimestep;
    }

    if (!this.quietStart && !this.groundRestCandidate && this.fatalFallImpactElapsed < 0) this.releaseUnstableBalances();
    const rested = this.updateGroundTerminalRest(safeDelta);
    this.syncSkeleton();
    if (!rested) this.updateSettling();
  }

  /** Conservatively bound every limb and its possible travel this tick. The
   * hand-off, self-collision activation and all nearby contacts keep 300 Hz.
   * Only an empty swept volume uses 120 Hz; CCD/solver settings stay intact. */
  private ballisticStepIsClear(delta: number): boolean {
    if (this.elapsed < .4 || this.fatalFallImpactElapsed >= 0 || this.groundRestCandidate) return false;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity, speed = 0;
    for (const part of this.bodies.values()) {
      const p = part.body.translation(), v = part.body.linvel();
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); minZ = Math.min(minZ, p.z);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); maxZ = Math.max(maxZ, p.z);
      speed = Math.max(speed, Math.hypot(v.x, v.y, v.z));
    }
    const margin = .6 + speed * delta + 12 * delta * delta;
    this.flightQueryCenter.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    this.flightQuery.halfExtents.x = (maxX - minX) / 2 + margin;
    this.flightQuery.halfExtents.y = (maxY - minY) / 2 + margin;
    this.flightQuery.halfExtents.z = (maxZ - minZ) / 2 + margin;
    return !this.physics.world.intersectionWithShape(this.flightQueryCenter, { x: 0, y: 0, z: 0, w: 1 }, this.flightQuery,
      undefined, undefined, undefined, undefined, this.physics.isEnvironmentCollider);
  }

  private captureImpactPreStep(delta: number): void {
    for (const ragdollBody of this.bodies.values()) {
      ragdollBody.impactCooldown = Math.max(0, ragdollBody.impactCooldown - delta);
      const velocity = ragdollBody.body.linvel();
      ragdollBody.preStepVelocity.set(velocity.x, velocity.y, velocity.z);
    }
  }

  private collectImpactEvents(): void {
    for (const ragdollBody of this.bodies.values()) {
      if (ragdollBody.impactCooldown > 0 || !ragdollBody.body.isValid()) continue;
      const before = ragdollBody.preStepVelocity;
      const afterRaw = ragdollBody.body.linvel();
      const afterX = afterRaw.x;
      const afterY = afterRaw.y;
      const afterZ = afterRaw.z;
      const beforeSpeed = before.length();
      if (beforeSpeed < 2.8) continue;
      const changeX = before.x - afterX;
      const changeY = before.y - afterY;
      const changeZ = before.z - afterZ;
      const velocityChange = Math.hypot(changeX, changeY, changeZ);
      if (velocityChange < 1.15) continue;
      // Joint impulses and self contacts are not impacts against architecture.
      // Keep the strongest real manifold instead of guessing nearby AABBs and
      // raycasting seven directions again in CharacterRuntime.
      let incoming = 0, point: RAPIER.Vector | undefined, normal: THREE.Vector3 | undefined, contactKind: StaticCollider['kind'] | undefined;
      for (const collider of ragdollBody.colliders) this.physics.world.contactPairsWith(collider, other => {
        if (!this.physics.isEnvironmentCollider(other)) return;
        this.physics.world.contactPair(collider, other, (manifold, flipped) => {
          const n = manifold.normal(), sign = flipped ? 1 : -1;
          const approach = -(before.x * n.x + before.y * n.y + before.z * n.z) * sign;
          if (approach <= incoming) return;
          for (let i = 0; i < manifold.numSolverContacts(); i++) {
            if (manifold.solverContactDist(i) > .03) continue;
            incoming = approach; point = manifold.solverContactPoint(i);
            normal = new THREE.Vector3(n.x * sign, n.y * sign, n.z * sign);
            contactKind = this.physics.getEnvironmentKind(other);
            break;
          }
        });
      });
      if (!point || !normal || incoming < 2.4) continue;
      this.impactEvents.push({
        bodyId: ragdollBody.id,
        position: new THREE.Vector3(point.x, point.y, point.z), normal, contactKind,
        velocityBefore: before.clone(),
        velocityAfter: new THREE.Vector3(afterX, afterY, afterZ),
        velocityChange,
      });
      ragdollBody.impactCooldown = 0.085;
      if (this.impactEvents.length > 16) this.impactEvents.shift();
    }
  }

  /**
   * Update a corpse whose shared Rapier world has already been stepped by the
   * live PlayerController. This is used after respawn: old bodies stay physical
   * and pushable without stepping the whole world once per corpse.
   */
  passiveUpdate(delta: number): void {
    if (!this.ownedBodies.length) return;
    const safeDelta = Math.max(0, delta);
    this.playerNudgeCooldown = Math.max(0, this.playerNudgeCooldown - safeDelta);
    const core = this.bodies.get('core')?.body;
    const linear = core?.linvel(), angular = core?.angvel();
    // Joint constraint impulses can keep angular velocity noisy even with a
    // torso resting in place. A slow core translation is the support criterion;
    // its frozen proxy is discarded if the real core subsequently moves 9 cm.
    const quietCore = linear && angular && Math.hypot(linear.x, linear.y, linear.z) < 0.12
      && Math.hypot(angular.x, angular.y, angular.z) < 1.5;
    this.traversalQuietSeconds = quietCore ? this.traversalQuietSeconds + safeDelta : 0;
    const anyAwake = this.ownedBodies.some((body) => body.isValid() && !body.isSleeping());
    if (anyAwake) {
      if (this.settled) this.resetGroundRestAfterImpact();
      this.settled = false;
      this.elapsed += safeDelta;
      if (this.fatalFallImpactElapsed >= 0) this.fatalFallImpactElapsed += safeDelta;
      if (!this.selfCollisionsEnabled && this.elapsed >= SELF_COLLISION_DELAY) {
        this.enableSelfCollisions();
      }
    }
    if (!this.settled && safeDelta > 0) {
      // The shared world advances NPCs and persistent corpses externally.
      // Use the same brief KO response as the player-owned ragdoll solver.
      this.applyCombatKnockoutContraction(safeDelta);
      if (this.fatalFallImpactElapsed >= 0) {
        this.restoreFatalFallSupportState();
        this.applyFatalFallSettling();
      } else if (!this.groundRestCandidate && !this.quietStart) {
        this.applyFinalSupportRelease(safeDelta);
        this.releaseUnstableBalances();
      }
      this.enforceSafetyLimits(safeDelta);
      if (!this.updateGroundTerminalRest(safeDelta)) this.updateSettling();
    }
    this.updateTraversalSupport();
    this.syncSkeleton();
  }

  /**
   * A single rounded, stationary support represents the settled torso to the
   * character controller. Articulated limbs remain physical for the world and
   * impacts, but cannot push the capsule that is trying to stand on them.
   */
  setPlayerTraversalEnabled(enabled: boolean): void {
    this.playerTraversalEnabled = enabled;
    if (!enabled) this.traversalBody?.setEnabled(false);
    else this.updateTraversalSupport();
  }

  private updateTraversalSupport(): void {
    const core = this.bodies.get('core');
    if (!this.playerTraversalEnabled || !core?.body.isValid()) return;
    const center = core.body.translation();
    if (this.traversalBody?.isEnabled()) {
      if (this.traversalCorePosition.distanceTo(center) < 0.09) return;
      this.traversalBody.setEnabled(false);
    }
    if (!this.settled && this.traversalQuietSeconds < 0.40) return;
    const ray = new RAPIER.Ray({ x: center.x, y: center.y + 0.4, z: center.z }, { x: 0, y: -1, z: 0 });
    const floor = this.physics.world.castRayAndGetNormal(ray, 1.3, true,
      RAPIER.QueryFilterFlags.ONLY_FIXED, 0x00010001);
    if (!floor || floor.normal.y < 0.8) return;
    const groundY = ray.origin.y - floor.timeOfImpact;
    // Never bridge a pit or turn a hanging body into an invisible platform.
    if (center.y - groundY > 0.48) return;
    const height = THREE.MathUtils.clamp(center.y - groundY + 0.04, 0.14, 0.22);
    // A shallow bevel is walkable from every direction. A small cuboid has
    // vertical sides and can be too narrow for Rapier's autostep clearance.
    const vertices = new Float32Array(16 * 2 * 3);
    for (let ring = 0; ring < 2; ring++) for (let i = 0; i < 16; i++) {
      const angle = i / 16 * Math.PI * 2, offset = (ring * 16 + i) * 3;
      vertices[offset] = Math.cos(angle) * (ring ? 0.20 : 0.47);
      vertices[offset + 1] = (ring ? 0.5 : -0.5) * height;
      vertices[offset + 2] = Math.sin(angle) * (ring ? 0.34 : 0.62);
    }
    const head = this.getHeadPose().position;
    const yaw = Math.atan2(head.x - center.x, head.z - center.z);
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    for (let i = 0; i < 16; i += 2) {
      const edge = new THREE.Vector3(vertices[i * 3]!, 0, vertices[i * 3 + 2]!).applyQuaternion(rotation);
      const support = this.physics.world.castRayAndGetNormal(new RAPIER.Ray(
        { x: center.x + edge.x, y: center.y + 0.4, z: center.z + edge.z },
        { x: 0, y: -1, z: 0 }), 1.3, true, RAPIER.QueryFilterFlags.ONLY_FIXED, 0x00010001);
      if (!support || support.normal.y < 0.8 || Math.abs(support.timeOfImpact - floor.timeOfImpact) > 0.08) return;
    }
    const position = { x: center.x, y: groundY + height * 0.5, z: center.z };
    if (!this.traversalBody) {
      this.traversalBody = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      this.traversalCollider = this.physics.world.createCollider(
        RAPIER.ColliderDesc.convexHull(vertices)!
          .setFriction(0).setRestitution(0)
          .setCollisionGroups(makeCollisionGroups(0x4000, PLAYER_COLLISION_GROUP)),
        this.traversalBody,
      );
    } else {
      this.traversalCollider?.setShape(new RAPIER.ConvexPolyhedron(vertices));
    }
    this.traversalBody.setTranslation(position, false);
    this.traversalBody.setRotation(rotation, false);
    this.traversalBody.setEnabled(true);
    this.traversalCorePosition.copy(center);
    this.physics.world.propagateModifiedBodyPositionsToColliders();
  }

  /**
   * Lightweight GTA-style corpse interaction. The live kinematic capsule does
   * not collide with ragdolls (so it never autosteps/levitates on them); walking
   * through a nearby body instead gives the closest physical segment a small,
   * horizontal impulse. No vertical impulse is introduced, which avoids waking a
   * settled corpse into a bounce loop.
   */
  nudgeFromPlayer(
    playerPosition: Readonly<THREE.Vector3>,
    playerVelocity: Readonly<THREE.Vector3>,
  ): void {
    if (!this.ownedBodies.length || this.playerNudgeCooldown > 0 || this.traversalBody?.isEnabled()) return;
    const horizontalSpeed = Math.hypot(playerVelocity.x, playerVelocity.z);
    if (horizontalSpeed < 0.22) return;

    let closest: RagdollBody | undefined;
    let closestDistanceSq = Number.POSITIVE_INFINITY;
    for (const ragdollBody of this.bodies.values()) {
      const position = ragdollBody.body.translation();
      if (Math.abs(position.y - playerPosition.y) > 1.05) continue;
      const dx = position.x - playerPosition.x;
      const dz = position.z - playerPosition.z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < closestDistanceSq) {
        closestDistanceSq = distanceSq;
        closest = ragdollBody;
      }
    }

    const interactionRadius = 0.72;
    if (!closest || closestDistanceSq > interactionRadius * interactionRadius) return;

    const distance = Math.sqrt(Math.max(closestDistanceSq, 1e-8));
    const moveX = playerVelocity.x / horizontalSpeed;
    const moveZ = playerVelocity.z / horizontalSpeed;
    const closestPosition = closest.body.translation();
    let awayX = (closestPosition.x - playerPosition.x) / distance;
    let awayZ = (closestPosition.z - playerPosition.z) / distance;
    if (!Number.isFinite(awayX) || !Number.isFinite(awayZ)) {
      awayX = moveX;
      awayZ = moveZ;
    }
    let directionX = moveX * 0.78 + awayX * 0.22;
    let directionZ = moveZ * 0.78 + awayZ * 0.22;
    const directionLength = Math.hypot(directionX, directionZ);
    if (directionLength > 1e-6) {
      directionX /= directionLength;
      directionZ /= directionLength;
    }

    const proximity = THREE.MathUtils.clamp(1 - distance / interactionRadius, 0, 1);
    const impulse = THREE.MathUtils.clamp(
      horizontalSpeed * (0.027 + proximity * 0.012),
      0.04,
      0.24,
    );
    closest.body.applyImpulse({
      x: directionX * impulse,
      y: 0,
      z: directionZ * impulse,
    }, true);
    this.playerNudgeCooldown = 0.075;
    this.settled = false;
    this.resetGroundRestAfterImpact();
  }

  syncSkeleton(): void {
    // Hips translation is the only animated bone translation that must follow a
    // rigid body. Descendants retain authored bone lengths, preventing stretch.
    const hipsBinding = this.bindings.find((binding) => binding.bone === this.hips);
    if (hipsBinding?.bodyToBonePosition) {
      const rotation = bodyRotation(hipsBinding.body.body, this.tempQuaternionA);
      const worldPosition = bodyPosition(hipsBinding.body.body, this.tempPositionA)
        .add(this.tempPositionB.copy(hipsBinding.bodyToBonePosition).applyQuaternion(rotation));
      this.setBoneWorldPosition(this.hips, worldPosition);
    }

    for (const binding of this.bindings) {
      const bodyWorldRotation = bodyRotation(binding.body.body, this.tempQuaternionA);
      const targetWorldRotation = this.tempQuaternionB
        .copy(bodyWorldRotation)
        .multiply(binding.bodyToBoneRotation)
        .normalize();
      this.setBoneWorldRotation(binding.bone, targetWorldRotation);
    }
    this.character.updateMatrixWorld(true);
  }

  getHeadPose(
    position = new THREE.Vector3(),
    rotation = new THREE.Quaternion(),
  ): { position: THREE.Vector3; rotation: THREE.Quaternion } {
    this.head.updateWorldMatrix(true, false);
    this.head.getWorldPosition(position);
    this.head.getWorldQuaternion(rotation);
    return { position, rotation };
  }

  getHeadCollisionCenter(target: THREE.Vector3): THREE.Vector3 {
    const head = this.bodies.get('head');
    return head ? target.copy(head.body.translation()) : this.getHeadPose(target).position;
  }

  getVelocity(target: THREE.Vector3): THREE.Vector3 {
    const core = this.bodies.get('core');
    return core ? target.copy(core.body.linvel()) : target.set(0, 0, 0);
  }

  getOwnedBodyHandles(): ReadonlySet<number> {
    const handles = new Set(this.ownedBodies.filter((body) => body.isValid()).map((body) => body.handle));
    if (this.traversalBody?.isValid()) handles.add(this.traversalBody.handle);
    return handles;
  }

  /** Closest reachable top surface of the actual torso, for a downward stomp. */
  captureGroundKickVolumes(): GroundKickVolume[] {
    return [...this.bodies.values()].flatMap(part => part.colliders.filter(collider => collider.isValid())
      .map(collider => ({ id: collider.handle, shape: collider.shape,
        position: new THREE.Vector3().copy(collider.translation()),
        rotation: new THREE.Quaternion(collider.rotation().x, collider.rotation().y, collider.rotation().z, collider.rotation().w) })));
  }

  getGroundKickSurface(from: Readonly<THREE.Vector3>, target: THREE.Vector3): boolean {
    const core = this.bodies.get('core');
    if (!core) return false;
    let closest = Infinity;
    for (const collider of core.colliders) {
      const center = collider.translation();
      const dx = from.x - center.x, dz = from.z - center.z;
      const length = Math.hypot(dx, dz);
      // Aim just inside the near edge, rather than through the center of mass.
      for (const offset of [0.12, 0]) {
        const origin = { x: center.x + dx / Math.max(length, 1e-5) * offset,
          y: center.y + 0.75, z: center.z + dz / Math.max(length, 1e-5) * offset };
        const toi = collider.castRay(new RAPIER.Ray(origin, { x: 0, y: -1, z: 0 }), 1.5, true);
        if (toi === null || !Number.isFinite(toi) || toi < 0) continue;
        const distance = Math.hypot(origin.x - from.x, origin.z - from.z);
        if (distance < closest) {
          closest = distance;
          target.set(origin.x, origin.y - toi, origin.z);
        }
      }
    }
    return Number.isFinite(closest);
  }

  /** Near side of the actual torso, so a low swing contacts its flank rather
   * than aiming at the top like a stomp. Each ray crosses the collider's center height. */
  getGroundKickSideSurface(from: Readonly<THREE.Vector3>, target: THREE.Vector3): boolean {
    const core = this.bodies.get('core');
    if (!core) return false;
    let closest = Infinity;
    for (const collider of core.colliders) {
      const center = collider.translation();
      const dx = center.x - from.x, dz = center.z - from.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 1e-5) continue;
      const origin = { x: from.x, y: center.y, z: from.z };
      const direction = { x: dx / distance, y: 0, z: dz / distance };
      const toi = collider.castRay(new RAPIER.Ray(origin, direction), distance + 0.65, true);
      if (toi === null || !Number.isFinite(toi) || toi < 0 || toi >= closest) continue;
      closest = toi;
      target.set(origin.x + direction.x * toi, origin.y, origin.z + direction.z * toi);
    }
    return Number.isFinite(closest);
  }

  getPelvisPose(
    position = new THREE.Vector3(),
    rotation = new THREE.Quaternion(),
  ): { position: THREE.Vector3; rotation: THREE.Quaternion } {
    this.hips.updateWorldMatrix(true, false);
    return {
      position: this.hips.getWorldPosition(position),
      rotation: this.hips.getWorldQuaternion(rotation),
    };
  }

  getPelvisPosition(target = new THREE.Vector3()): THREE.Vector3 {
    const pelvis = this.bodies.get('core');
    if (!pelvis) return this.hips.getWorldPosition(target);
    return bodyPosition(pelvis.body, target);
  }

  /** Apply impulse at the real contact lever arm; Rapier supplies mass/inertia response. */
  private applyContactImpulse(id: string, impulse: THREE.Vector3, point?: Readonly<THREE.Vector3>): void {
    const part = this.bodies.get(id);
    if (!part || !part.body.isValid()) return;
    this.traversalBody?.setEnabled(false);
    this.traversalQuietSeconds = 0;
    const center = part.body.worldCom();
    const application = point ? new THREE.Vector3().copy(point) : new THREE.Vector3(center.x, center.y, center.z);
    // The torso is one compound rigid body. Bound a stale/off-body contact lever
    // to its volume so a get-up transition cannot inject a giant angular impulse.
    const lever = application.sub(center).clampLength(0, id === 'head' ? 0.13 : 0.38);
    application.set(center.x + lever.x, center.y + lever.y, center.z + lever.z);
    part.body.applyImpulseAtPoint(impulse, application, true);
    this.settled = false;
    this.settledElapsed = 0;
    this.resetGroundRestAfterImpact();
    for (const body of this.ownedBodies) if (body.isValid()) body.wakeUp();
  }

  applyMeleeImpact(
    direction: Readonly<THREE.Vector3>, strength = 1,
    zone: 'head' | 'upper-body' | 'body' = 'upper-body',
    contactPoint?: Readonly<THREE.Vector3>,
  ): void {
    if (!Number.isFinite(direction.x + direction.y + direction.z + strength)) return;
    const vector = new THREE.Vector3().copy(direction);
    if (vector.lengthSq() < 1e-8) return;
    vector.y = THREE.MathUtils.clamp(vector.y, -0.22, 0.12);
    vector.normalize();
    const impulse = vector.multiplyScalar(THREE.MathUtils.clamp(strength, 0.35, 1.65) * 25);
    if (zone === 'head') {
      this.applyContactImpulse('head', impulse.clone().multiplyScalar(0.28), contactPoint);
      this.applyContactImpulse('core', impulse.clone().multiplyScalar(0.72), contactPoint);
    } else this.applyContactImpulse('core', impulse, contactPoint);
    // A KO loses balance and muscle tone. Do not keep the conscious windmill /
    // recovery-step reflexes used for an ordinary accidental fall.
    this.activeResponseScale = 0;
    this.combatKnockoutStartedAt = this.elapsed;
    this.combatKnockoutCurl = THREE.MathUtils.clamp(strength, .45, 1.3) * (zone === 'body' ? 1 : .72);
    this.combatKnockoutArmHeight = zone === 'body' ? .04 : .12;
    this.combatKnockoutSide = 0;
    const head = this.bodies.get('head'), core = this.bodies.get('core');
    if (core) {
      const orientation = core.body.rotation();
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion().copy(orientation));
      // An already horizontal body is a passive impact target. Do not ask its
      // arms to close as if it were still standing over its feet.
      this.combatKnockoutCurl *= THREE.MathUtils.smoothstep(Math.abs(up.y), .35, .75);
    }
    if (head && core && zone === 'head') {
      const forward = impulse.clone().normalize(), right = new THREE.Vector3(forward.z, 0, -forward.x).normalize();
      const center = head.body.worldCom();
      const lever = contactPoint ? new THREE.Vector3().copy(contactPoint).sub(center) : new THREE.Vector3();
      this.combatKnockoutSide = THREE.MathUtils.clamp(lever.dot(right) / .10, -1, 1);
      // Equal/opposite neck impulses create head recoil without inventing
      // whole-body angular momentum. The existing neck limits bound the snap.
      const torque = right.multiplyScalar(.055 * THREE.MathUtils.clamp(strength, .45, 1.3));
      torque.y += this.combatKnockoutSide * .038 * Math.min(1.3, strength);
      head.body.applyTorqueImpulse(torque, true);
      core.body.applyTorqueImpulse(torque.clone().negate(), true);
    }
  }

  private applyCombatKnockoutContraction(delta: number): void {
    const envelope = combatKnockoutEnvelope(this.elapsed - this.combatKnockoutStartedAt);
    if (envelope <= 0 || this.combatKnockoutCurl <= 0 || this.fatalFallImpactElapsed >= 0) return;
    const core = this.bodies.get('core');
    if (!core) return;
    const center = core.body.worldCom(), velocity = core.body.linvel(), spin = core.body.angvel();
    const orientation = core.body.rotation();
    const rotation = new THREE.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w);
    for (const side of [-1, 1]) {
      const arm = this.bodies.get(side < 0 ? 'left-forearm' : 'right-forearm');
      if (!arm) continue;
      const position = arm.body.worldCom(), speed = arm.body.linvel(), angular = arm.body.angvel();
      const anchor = this.combatKnockoutHandAnchors.get(arm.id);
      const handPoint = anchor ? anchor.clone().applyQuaternion(new THREE.Quaternion().copy(arm.body.rotation()))
        .add(new THREE.Vector3().copy(arm.body.translation())) : new THREE.Vector3().copy(position);
      const lever = handPoint.clone().sub(position);
      const offset = handPoint.clone().sub(center);
      const target = new THREE.Vector3(side * .105, this.combatKnockoutArmHeight + .035, .17).applyQuaternion(rotation).add(center);
      const carried = new THREE.Vector3(velocity.x, velocity.y, velocity.z)
        .add(new THREE.Vector3(spin.x, spin.y, spin.z).cross(offset));
      const relative = new THREE.Vector3(speed.x, speed.y, speed.z)
        .add(new THREE.Vector3(angular.x, angular.y, angular.z).cross(lever)).sub(carried);
      const wanted = target.sub(handPoint).multiplyScalar(7).clampLength(0, 1.7);
      const asymmetry = 1 + side * this.combatKnockoutSide * .14;
      const impulse = wanted.sub(relative).clampLength(0, 2)
        .multiplyScalar(arm.body.mass() * Math.min(1, delta * 14 * envelope * this.combatKnockoutCurl * asymmetry));
      // Pull the wrist in: this also flexes the physical elbow, rather than
      // dragging a rigid forearm sideways with the hand still sticking out.
      // Use a short lever so the brief reflex cannot become a violent arm spin.
      const application = new THREE.Vector3().copy(position).addScaledVector(lever, .55);
      arm.body.applyImpulseAtPoint(impulse, application, true);
      // The same application point preserves net linear AND angular momentum.
      core.body.applyImpulseAtPoint(impulse.clone().negate(), application, true);
    }
  }

  applyGroundKickImpact(
    direction: Readonly<THREE.Vector3>, strength = 1, recovering = false,
    contactPoint?: Readonly<THREE.Vector3>,
    style: 'stomp' | 'soccer-kick' = 'stomp',
  ): void {
    if (!Number.isFinite(direction.x + direction.y + direction.z + strength)) return;
    const horizontal = recovering || style === 'soccer-kick' ? 1 : 0.16;
    const vector = new THREE.Vector3(direction.x * horizontal,
      recovering ? -0.55 : style === 'soccer-kick' ? 0.08 : -1, direction.z * horizontal).normalize();
    const impulse = vector.multiplyScalar(THREE.MathUtils.clamp(strength, 0.4, 1.5)
      * (recovering ? 28 : style === 'soccer-kick' ? 32 : 30));
    let id = 'core';
    if (contactPoint) {
      let closest = Infinity;
      for (const part of this.bodies.values()) {
        if (!part.body.isValid()) continue;
        const center = part.body.worldCom();
        const distance = Math.hypot(center.x - contactPoint.x, center.y - contactPoint.y, center.z - contactPoint.z);
        if (distance < closest) { closest = distance; id = part.id; }
      }
    }
    this.applyContactImpulse(id, impulse, contactPoint);
  }

  /**
   * Handoff path used by a living get-up.
   *
   * Rapier's `World.removeRigidBody()` walks all attached impulse joints through
   * a generated wasm callback. With @dimforge/rapier3d 0.19.3 under Vite that
   * removal path can fail with `wasm is undefined` while dismantling an active
   * articulated ragdoll. Unlink our explicitly owned joints first: the faulty
   * attached-joint callback is never entered when removing the now-unlinked
   * bodies. No disabled physics allocations accumulate after repeated get-ups.
   */
  suspendForRecovery(): void {
    this.dispose();
  }

  dispose(): void {
    this.disableOwnedBodies();
    for (const joint of this.ownedJoints) if (joint.isValid()) this.physics.world.removeImpulseJoint(joint, false);
    this.ownedJoints.length = 0;
    for (const body of this.ownedBodies) if (body.isValid()) this.physics.world.removeRigidBody(body);
    if (this.traversalBody?.isValid()) this.physics.world.removeRigidBody(this.traversalBody);
    this.releaseRuntimeReferences();
  }

  private createOwnedJoint(data: RAPIER.JointData, parent: RAPIER.RigidBody, child: RAPIER.RigidBody, wakeUp: boolean): RAPIER.ImpulseJoint {
    const joint = this.physics.world.createImpulseJoint(data, parent, child, wakeUp);
    this.ownedJoints.push(joint); return joint;
  }

  private disableOwnedBodies(): void {
    if (this.traversalBody?.isValid()) this.traversalBody.setEnabled(false);
    const zero = { x: 0, y: 0, z: 0 };
    for (const body of this.ownedBodies) {
      if (!body.isValid()) continue;
      body.setLinvel(zero, false);
      body.setAngvel(zero, false);
      body.setEnabled(false);
    }
  }

  private releaseRuntimeReferences(): void {
    this.traversalBody = undefined;
    this.traversalCollider = undefined;
    this.ownedBodies.length = 0;
    this.jointFrameBodies.length = 0;
    this.bodies.clear();
    this.bindings.length = 0;
    this.limits.length = 0;
    this.hingeLimits.length = 0;
    this.links.length = 0;
    this.gravityReleases.length = 0;
    this.impactEvents.length = 0;
  }

  private build(
    bones: {
      hips: THREE.Bone; spine: THREE.Bone; spine1: THREE.Bone; spine2: THREE.Bone;
      neck: THREE.Bone; head: THREE.Bone; headTop: THREE.Bone;
      leftArm: THREE.Bone; leftForeArm: THREE.Bone; leftHand: THREE.Bone;
      rightArm: THREE.Bone; rightForeArm: THREE.Bone; rightHand: THREE.Bone;
      leftUpLeg: THREE.Bone; leftLeg: THREE.Bone; leftFoot: THREE.Bone;
      rightUpLeg: THREE.Bone; rightLeg: THREE.Bone; rightFoot: THREE.Bone;
    },
    motion: RagdollInitialMotion,
  ): void {
    const { velocity, yawRateRadians } = motion;
    this.initialVerticalSpeed = velocity.y;
    this.quietStart = motion.quietStart === true;
    this.tipScale = THREE.MathUtils.clamp(motion.tipScale ?? 1, 0, 1);
    this.variationScale = THREE.MathUtils.clamp(motion.variationScale ?? 1, 0, 1);
    this.activeResponseScale = THREE.MathUtils.clamp(motion.activeResponseScale ?? 1, 0, 1);
    this.animationMotion = this.quietStart ? undefined : motion.animationMotion;
    this.linearSpeedCap = Math.max(15, velocity.length() + 6);
    this.angularSpeedCap = Math.max(7.6, Math.abs(yawRateRadians) + 4.6);

    const characterRotation = this.character.getWorldQuaternion(new THREE.Quaternion());
    const rightHint = X_AXIS.clone().applyQuaternion(characterRotation).normalize();
    const forwardHint = Z_AXIS.clone().applyQuaternion(characterRotation).normalize();

    // Derive the elbow/knee hinge axis from the actual evaluated death pose.
    // When a limb is bent, cross(upper, lower) gives an axis perpendicular to
    // both segments, so both Rapier bodies start with exactly the same hinge
    // axis in world-space. Near a straight pose we fall back to the anatomical
    // character frame. This avoids the violent "joint reorientation" that can
    // make an elbow or knee appear to turn inside-out on the first contacts.
    const leftUpperArmDir = this.segmentDirection(bones.leftArm, bones.leftForeArm, new THREE.Vector3());
    const leftForeArmDir = this.segmentDirection(bones.leftForeArm, bones.leftHand, new THREE.Vector3());
    const rightUpperArmDir = this.segmentDirection(bones.rightArm, bones.rightForeArm, new THREE.Vector3());
    const rightForeArmDir = this.segmentDirection(bones.rightForeArm, bones.rightHand, new THREE.Vector3());
    const leftThighDir = this.segmentDirection(bones.leftUpLeg, bones.leftLeg, new THREE.Vector3());
    const leftShinDir = this.segmentDirection(bones.leftLeg, bones.leftFoot, new THREE.Vector3());
    const rightThighDir = this.segmentDirection(bones.rightUpLeg, bones.rightLeg, new THREE.Vector3());
    const rightShinDir = this.segmentDirection(bones.rightLeg, bones.rightFoot, new THREE.Vector3());

    const leftElbowFallback = this.limbHingeFrame(leftUpperArmDir, rightHint, forwardHint, 1);
    const rightElbowFallback = this.limbHingeFrame(rightUpperArmDir, rightHint, forwardHint, 1);
    const leftKneeFallback = this.limbHingeFrame(leftThighDir, rightHint, forwardHint, -1);
    const rightKneeFallback = this.limbHingeFrame(rightThighDir, rightHint, forwardHint, -1);
    const leftElbowAxis = this.deriveHingeAxis(leftUpperArmDir, leftForeArmDir, leftElbowFallback.axis);
    const rightElbowAxis = this.deriveHingeAxis(rightUpperArmDir, rightForeArmDir, rightElbowFallback.axis);
    const leftKneeAxis = this.deriveHingeAxis(leftThighDir, leftShinDir, leftKneeFallback.axis);
    const rightKneeAxis = this.deriveHingeAxis(rightThighDir, rightShinDir, rightKneeFallback.axis);

    const pelvisPosition = bones.hips.getWorldPosition(new THREE.Vector3());
    this.initialMotionOrigin.copy(pelvisPosition);
    const leftHip = bones.leftUpLeg.getWorldPosition(new THREE.Vector3());
    const rightHip = bones.rightUpLeg.getWorldPosition(new THREE.Vector3());
    const hipWidth = THREE.MathUtils.clamp(leftHip.distanceTo(rightHip), 0.24, 0.42);

    // Mixamo bone-local axes are authored for skinning, not for collision shapes.
    // Driving the pelvis cuboid directly from Hips.quaternion can therefore make
    // the physical pelvis look twisted even though the rendered death pose is
    // correct. Build a clean anatomical frame instead: Y follows the lower
    // spine, X follows the character's right direction, and Z is their normal.
    // bindBone() below still preserves the exact visible Hips orientation.
    const pelvisUp = bones.spine.getWorldPosition(new THREE.Vector3()).sub(pelvisPosition);
    if (pelvisUp.lengthSq() < 1e-7) pelvisUp.copy(Y_AXIS).applyQuaternion(characterRotation);
    pelvisUp.normalize();
    const pelvisRight = rightHint.clone().addScaledVector(pelvisUp, -rightHint.dot(pelvisUp));
    if (pelvisRight.lengthSq() < 1e-7) pelvisRight.copy(rightHip).sub(leftHip);
    pelvisRight.normalize();
    const pelvisForward = new THREE.Vector3().crossVectors(pelvisRight, pelvisUp).normalize();
    pelvisRight.crossVectors(pelvisUp, pelvisForward).normalize();
    const pelvisMatrix = new THREE.Matrix4().makeBasis(pelvisRight, pelvisUp, pelvisForward);
    const pelvisRotation = new THREE.Quaternion().setFromRotationMatrix(pelvisMatrix).normalize();
    // One physical core for pelvis + rib cage. The rendered Hips/Spine bones
    // keep their exact evaluated relative pose through body-to-bone bindings,
    // but the solver no longer has a pelvis/torso joint that can buckle, twist,
    // or balance the corpse on an artificial constraint.
    const core = this.createCoreBody(
      bones.hips, pelvisPosition, pelvisRotation, hipWidth, bones.spine, bones.neck,
      rightHint, forwardHint, velocity, yawRateRadians,
    );
    const head = this.createHeadBody(bones.head, bones.headTop, velocity, yawRateRadians);
    const leftUpperArm = this.createSegmentBody({
      id: 'left-upper-arm', start: bones.leftArm, end: bones.leftForeArm, radius: 0.055, density: 520,
      membership: LEFT_UPPER_ARM_GROUP, xHint: leftElbowAxis, fallbackHint: leftElbowFallback.flexDirection,
      startInset: 0.045,
    }, velocity, yawRateRadians);
    const leftForeArm = this.createSegmentBody({
      id: 'left-forearm', start: bones.leftForeArm, end: bones.leftHand, radius: 0.049, density: 520,
      membership: LEFT_FOREARM_GROUP, xHint: leftElbowAxis, fallbackHint: leftElbowFallback.flexDirection,
      startInset: 0.01, endCapRadius: 0.056,
    }, velocity, yawRateRadians);
    const rightUpperArm = this.createSegmentBody({
      id: 'right-upper-arm', start: bones.rightArm, end: bones.rightForeArm, radius: 0.055, density: 520,
      membership: RIGHT_UPPER_ARM_GROUP, xHint: rightElbowAxis, fallbackHint: rightElbowFallback.flexDirection,
      startInset: 0.045,
    }, velocity, yawRateRadians);
    const rightForeArm = this.createSegmentBody({
      id: 'right-forearm', start: bones.rightForeArm, end: bones.rightHand, radius: 0.049, density: 520,
      membership: RIGHT_FOREARM_GROUP, xHint: rightElbowAxis, fallbackHint: rightElbowFallback.flexDirection,
      startInset: 0.01, endCapRadius: 0.056,
    }, velocity, yawRateRadians);
    this.combatKnockoutHandAnchors.set('left-forearm', this.worldPointToBodyLocal(
      leftForeArm, bones.leftHand.getWorldPosition(new THREE.Vector3()), new THREE.Vector3()));
    this.combatKnockoutHandAnchors.set('right-forearm', this.worldPointToBodyLocal(
      rightForeArm, bones.rightHand.getWorldPosition(new THREE.Vector3()), new THREE.Vector3()));
    const leftUpperLeg = this.createSegmentBody({
      id: 'left-upper-leg', start: bones.leftUpLeg, end: bones.leftLeg, radius: 0.079, density: 720,
      membership: LEFT_UPPER_LEG_GROUP, xHint: leftKneeAxis, fallbackHint: leftKneeFallback.flexDirection,
      startInset: 0.056,
    }, velocity, yawRateRadians);
    const leftLowerLeg = this.createSegmentBody({
      id: 'left-lower-leg', start: bones.leftLeg, end: bones.leftFoot, radius: 0.064, density: 680,
      membership: LEFT_LOWER_LEG_GROUP, xHint: leftKneeAxis, fallbackHint: leftKneeFallback.flexDirection,
      startInset: 0.012, endCapRadius: 0.071,
    }, velocity, yawRateRadians);
    const rightUpperLeg = this.createSegmentBody({
      id: 'right-upper-leg', start: bones.rightUpLeg, end: bones.rightLeg, radius: 0.079, density: 720,
      membership: RIGHT_UPPER_LEG_GROUP, xHint: rightKneeAxis, fallbackHint: rightKneeFallback.flexDirection,
      startInset: 0.056,
    }, velocity, yawRateRadians);
    const rightLowerLeg = this.createSegmentBody({
      id: 'right-lower-leg', start: bones.rightLeg, end: bones.rightFoot, radius: 0.064, density: 680,
      membership: RIGHT_LOWER_LEG_GROUP, xHint: rightKneeAxis, fallbackHint: rightKneeFallback.flexDirection,
      startInset: 0.012, endCapRadius: 0.071,
    }, velocity, yawRateRadians);

    this.bindBone(bones.hips, core, true);
    this.bindBone(bones.spine, core);
    this.bindBone(bones.spine1, core);
    this.bindBone(bones.spine2, core);
    this.bindBone(bones.neck, head);
    this.bindBone(bones.head, head);
    this.bindBone(bones.leftArm, leftUpperArm);
    this.bindBone(bones.leftForeArm, leftForeArm);
    this.bindBone(bones.rightArm, rightUpperArm);
    this.bindBone(bones.rightForeArm, rightForeArm);
    this.bindBone(bones.leftUpLeg, leftUpperLeg);
    this.bindBone(bones.leftLeg, leftLowerLeg);
    this.bindBone(bones.rightUpLeg, rightUpperLeg);
    this.bindBone(bones.rightLeg, rightLowerLeg);

    // For neck/shoulders/hips we use a tiny COLLIDER-LESS dynamic joint frame
    // fixed to the parent, then a native Rapier revolute joint to the limb.
    // Unlike the old kinematic proxies this cannot inject energy: the frame is
    // part of the same dynamic island. It also gives us a real hard angular stop
    // instead of a post-solver "soft cone" that could remain outside its limit.
    const neckAnchor = bones.neck.getWorldPosition(new THREE.Vector3());
    this.finalNeckAnchorCoreLocal.copy(
      this.worldPointToBodyLocal(core, neckAnchor, new THREE.Vector3()),
    );
    this.connectFramedUniversal(
      'neck-frame', core, head, neckAnchor,
      X_AXIS, -24, 25, Z_AXIS, -15, 15,
      29, 28, true,
    );
    this.attachNeckGuard(head, neckAnchor, bodyPosition(head.body, new THREE.Vector3()));

    const leftShoulderAnchor = bones.leftArm.getWorldPosition(new THREE.Vector3());
    this.connectFramedUniversal(
      'left-shoulder-frame', core, leftUpperArm, leftShoulderAnchor,
      Z_AXIS, -48, 52, X_AXIS, -58, 58,
      62, 8,
    );

    const rightShoulderAnchor = bones.rightArm.getWorldPosition(new THREE.Vector3());
    this.connectFramedUniversal(
      'right-shoulder-frame', core, rightUpperArm, rightShoulderAnchor,
      Z_AXIS, -48, 52, X_AXIS, -58, 58,
      62, 8,
    );

    const leftHipAnchor = bones.leftUpLeg.getWorldPosition(new THREE.Vector3());
    this.connectFramedUniversal(
      'left-hip-frame', core, leftUpperLeg, leftHipAnchor,
      X_AXIS, -46, 56, Z_AXIS, -HIP_LATERAL_LIMIT_DEGREES, HIP_LATERAL_LIMIT_DEGREES,
      52, 7,
    );

    const rightHipAnchor = bones.rightUpLeg.getWorldPosition(new THREE.Vector3());
    this.connectFramedUniversal(
      'right-hip-frame', core, rightUpperLeg, rightHipAnchor,
      X_AXIS, -46, 56, Z_AXIS, -HIP_LATERAL_LIMIT_DEGREES, HIP_LATERAL_LIMIT_DEGREES,
      52, 7,
    );

    // Elbows/knees are true one-axis hinges, then duplicated by a geometry-level
    // safety limit below. Hyperextension is intentionally tiny: impacts may bend
    // a limb, but can never reverse the elbow or knee through itself.
    const leftElbowPose = this.signedSegmentBend(leftUpperArmDir, leftForeArmDir, leftElbowAxis);
    const rightElbowPose = this.signedSegmentBend(rightUpperArmDir, rightForeArmDir, rightElbowAxis);
    const leftKneePose = this.signedSegmentBend(leftThighDir, leftShinDir, leftKneeAxis);
    const rightKneePose = this.signedSegmentBend(rightThighDir, rightShinDir, rightKneeAxis);
    const elbowBendSignLeft = Math.abs(leftElbowPose) > THREE.MathUtils.degToRad(2)
      ? Math.sign(leftElbowPose) : this.preferredBendSign(leftUpperArmDir, leftElbowAxis, leftElbowFallback.flexDirection);
    const elbowBendSignRight = Math.abs(rightElbowPose) > THREE.MathUtils.degToRad(2)
      ? Math.sign(rightElbowPose) : this.preferredBendSign(rightUpperArmDir, rightElbowAxis, rightElbowFallback.flexDirection);
    const kneeBendSignLeft = Math.abs(leftKneePose) > THREE.MathUtils.degToRad(2)
      ? Math.sign(leftKneePose) : this.preferredBendSign(leftThighDir, leftKneeAxis, leftKneeFallback.flexDirection);
    const kneeBendSignRight = Math.abs(rightKneePose) > THREE.MathUtils.degToRad(2)
      ? Math.sign(rightKneePose) : this.preferredBendSign(rightThighDir, rightKneeAxis, rightKneeFallback.flexDirection);

    this.connectHinge(
      leftUpperArm, leftForeArm, bones.leftForeArm.getWorldPosition(new THREE.Vector3()),
      elbowBendSignLeft, 134, 1.25,
    );
    this.connectHinge(
      rightUpperArm, rightForeArm, bones.rightForeArm.getWorldPosition(new THREE.Vector3()),
      elbowBendSignRight, 134, 1.25,
    );
    this.connectHinge(
      leftUpperLeg, leftLowerLeg, bones.leftLeg.getWorldPosition(new THREE.Vector3()),
      kneeBendSignLeft, 128, 1.5,
    );
    this.connectHinge(
      rightUpperLeg, rightLowerLeg, bones.rightLeg.getWorldPosition(new THREE.Vector3()),
      kneeBendSignRight, 128, 1.5,
    );

    this.initializeActiveFallReactions(velocity);

    if (this.tipScale > 0) this.applyCoherentFallBias(velocity, this.tipScale);

    // Keep the variation small enough that it changes the silhouette without
    // ever becoming a visible kick/twitch or supplying meaningful lift. Forced
    // animation hand-offs and finished heavy impacts can explicitly disable it.
    if (this.variationScale > 0) {
      this.applyDeathVariation(head, 0.014 * this.variationScale);
      this.applyDeathVariation(leftForeArm, 0.018 * this.variationScale);
      this.applyDeathVariation(rightForeArm, 0.018 * this.variationScale);
    }

    // The terminal heavy-impact frame is already an authored, believable pose
    // resting on the floor. Do not immediately re-solve it as a fresh falling
    // ragdoll: approximate capsules can be a few millimetres inside the ground,
    // and the solver's depenetration then lifts the legs / rolls the pelvis.
    // Start the articulated corpse asleep in the *exact captured pose*. It is
    // still a fully dynamic ragdoll and wakes normally when the respawned player
    // pushes it, but there is no second fake impact after the animation ends.
    if (this.quietStart) this.sleepExactCapturedPose();
  }

  private sleepExactCapturedPose(): void {
    for (const body of this.ownedBodies) {
      if (!body.isValid()) continue;
      body.setLinvel({ x: 0, y: 0, z: 0 }, false);
      body.setAngvel({ x: 0, y: 0, z: 0 }, false);
      body.sleep();
    }
    for (const ragdollBody of this.bodies.values()) {
      ragdollBody.lastLinearSpeed = 0;
      ragdollBody.lastAngularSpeed = 0;
    }
    this.settledElapsed = MIN_SETTLE_TIME;
    this.settled = true;
  }

  private createCoreBody(
    hipsBone: THREE.Bone,
    pelvisPosition: THREE.Vector3,
    pelvisRotation: THREE.Quaternion,
    hipWidth: number,
    spine: THREE.Bone,
    neck: THREE.Bone,
    rightHint: THREE.Vector3,
    forwardHint: THREE.Vector3,
    velocity: Readonly<THREE.Vector3>,
    yawRate: number,
  ): RagdollBody {
    const coreLinearVelocity = this.inheritedPointVelocity(
      hipsBone,
      pelvisPosition,
      velocity,
      yawRate,
      new THREE.Vector3(),
    );
    const coreAngularVelocity = this.inheritedAngularVelocity(
      hipsBone,
      yawRate,
      new THREE.Vector3(),
    );
    const core = this.createBody(
      'core', pelvisPosition, pelvisRotation, PELVIS_GROUP, velocity, yawRate,
      coreLinearVelocity, coreAngularVelocity,
    );

    const pelvisCollider = RAPIER.ColliderDesc.cuboid(hipWidth * 0.43, 0.095, 0.105)
      .setDensity(720)
      .setFriction(0.82)
      .setRestitution(0)
      .setContactSkin(0.0008);
    this.attachCollider(core, pelvisCollider);

    const torsoStart = spine.getWorldPosition(new THREE.Vector3());
    const torsoEnd = neck.getWorldPosition(new THREE.Vector3());
    const torsoDirection = torsoEnd.clone().sub(torsoStart);
    const torsoLength = Math.max(0.16, torsoDirection.length());
    torsoDirection.normalize();
    const startInset = Math.min(0.018, torsoLength * 0.08);
    const endInset = Math.min(0.046, torsoLength * 0.18);
    const colliderStart = torsoStart.clone().addScaledVector(torsoDirection, startInset);
    const colliderEnd = torsoEnd.clone().addScaledVector(torsoDirection, -endInset);
    const colliderCenter = colliderStart.clone().lerp(colliderEnd, 0.5);
    const torsoRotation = this.segmentRotation(torsoStart, torsoEnd, rightHint, forwardHint);
    const coreRotationInv = pelvisRotation.clone().invert();
    const localRotation = coreRotationInv.clone().multiply(torsoRotation).normalize();
    const localCenter = colliderCenter.clone().sub(pelvisPosition).applyQuaternion(coreRotationInv);

    // A capsule has a circular cross-section, so a corpse can be perfectly stable
    // at any arbitrary 30-50 degree roll: visually this looks like half the back
    // floating above the floor. A shallow rib-cage box gives the torso real broad
    // front/back and side support faces. Gravity therefore settles it naturally
    // toward back, belly or one side without adding any pose motor or corrective
    // torque that could destabilise the ragdoll on stairs.
    const halfTorsoHeight = Math.max(0.07, colliderStart.distanceTo(colliderEnd) * 0.5);
    const halfTorsoWidth = THREE.MathUtils.clamp(hipWidth * 0.46, 0.125, 0.17);
    const halfTorsoDepth = THREE.MathUtils.clamp(torsoLength * 0.15, 0.065, 0.09);
    const torsoCollider = RAPIER.ColliderDesc.cuboid(halfTorsoWidth, halfTorsoHeight, halfTorsoDepth)
      .setTranslation(localCenter.x, localCenter.y, localCenter.z)
      .setRotation({ x: localRotation.x, y: localRotation.y, z: localRotation.z, w: localRotation.w })
      .setDensity(620)
      .setFriction(0.8)
      .setRestitution(0)
      .setContactSkin(0.0008);
    this.attachCollider(core, torsoCollider);
    return core;
  }

  private createHeadBody(
    headBone: THREE.Bone,
    headTop: THREE.Bone,
    velocity: Readonly<THREE.Vector3>,
    yawRate: number,
  ): RagdollBody {
    const headPosition = headBone.getWorldPosition(new THREE.Vector3());
    const topPosition = headTop.getWorldPosition(new THREE.Vector3());
    const center = headPosition.clone().lerp(topPosition, 0.46);
    const radius = THREE.MathUtils.clamp(headPosition.distanceTo(topPosition) * 0.56, 0.105, 0.126);
    const rotation = headBone.getWorldQuaternion(new THREE.Quaternion());
    const headVelocity = this.inheritedPointVelocity(
      headBone, headPosition, velocity, yawRate, new THREE.Vector3(),
    ).lerp(
      this.inheritedPointVelocity(headTop, topPosition, velocity, yawRate, new THREE.Vector3()),
      0.46,
    );
    const headAngularVelocity = this.inheritedAngularVelocity(
      headBone, yawRate, new THREE.Vector3(),
    );
    const body = this.createBody(
      'head', center, rotation, HEAD_GROUP, velocity, yawRate,
      headVelocity, headAngularVelocity,
    );
    const collider = RAPIER.ColliderDesc.ball(radius)
      .setDensity(560)
      .setFriction(0.76)
      .setRestitution(0)
      .setContactSkin(0.0008);
    this.attachCollider(body, collider);
    return body;
  }

  private createCuboidBody(
    id: string,
    center: THREE.Vector3,
    rotation: THREE.Quaternion,
    halfExtents: THREE.Vector3,
    density: number,
    membership: number,
    velocity: Readonly<THREE.Vector3>,
    yawRate: number,
  ): RagdollBody {
    const body = this.createBody(id, center, rotation, membership, velocity, yawRate);
    const collider = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setDensity(density)
      .setFriction(0.8)
      .setRestitution(0)
      .setContactSkin(0.001);
    this.attachCollider(body, collider);
    return body;
  }

  private createSegmentBody(
    spec: SegmentSpec,
    velocity: Readonly<THREE.Vector3>,
    yawRate: number,
  ): RagdollBody {
    const start = spec.start.getWorldPosition(new THREE.Vector3());
    const end = spec.end.getWorldPosition(new THREE.Vector3());
    const length = Math.max(0.08, start.distanceTo(end));
    const radius = Math.min(spec.radius, length * 0.255);
    const center = start.clone().lerp(end, 0.5);
    const rotation = this.segmentRotation(start, end, spec.xHint, spec.fallbackHint);
    const startVelocity = this.inheritedPointVelocity(
      spec.start, start, velocity, yawRate, new THREE.Vector3(),
    );
    const endVelocity = this.inheritedPointVelocity(
      spec.end, end, velocity, yawRate, new THREE.Vector3(),
    );
    const segmentVelocity = startVelocity.clone().add(endVelocity).multiplyScalar(0.5);
    const segmentAngularVelocity = this.segmentInheritedAngularVelocity(
      spec.start, start, end, startVelocity, endVelocity, yawRate,
    );
    const body = this.createBody(
      spec.id, center, rotation, spec.membership, velocity, yawRate,
      segmentVelocity, segmentAngularVelocity,
    );

    const direction = end.clone().sub(start).normalize();
    const maxInset = Math.max(0, length * 0.34);
    const startInset = THREE.MathUtils.clamp(spec.startInset ?? 0, 0, maxInset);
    const endInset = THREE.MathUtils.clamp(spec.endInset ?? 0, 0, maxInset);
    const colliderStart = start.clone().addScaledVector(direction, startInset);
    const colliderEnd = end.clone().addScaledVector(direction, -endInset);
    const colliderLength = Math.max(radius * 2 + 0.018, colliderStart.distanceTo(colliderEnd));
    const colliderCenterWorld = colliderStart.clone().lerp(colliderEnd, 0.5);
    const colliderCenterLocal = this.worldPointToBodyLocal(body, colliderCenterWorld, new THREE.Vector3());
    const halfHeight = Math.max(0.009, colliderLength * 0.5 - radius);
    // Arms should not act like rigid crutches under a dead torso. Slightly lower
    // contact friction lets a planted forearm/hand slide and fold under weight,
    // while legs keep the grippier value needed for believable floor/stair rest.
    const isArm = spec.membership === LEFT_UPPER_ARM_GROUP
      || spec.membership === LEFT_FOREARM_GROUP
      || spec.membership === RIGHT_UPPER_ARM_GROUP
      || spec.membership === RIGHT_FOREARM_GROUP;
    const contactFriction = isArm ? 0.64 : 0.78;
    const collider = RAPIER.ColliderDesc.capsule(halfHeight, radius)
      .setTranslation(colliderCenterLocal.x, colliderCenterLocal.y, colliderCenterLocal.z)
      .setDensity(spec.density)
      .setFriction(contactFriction)
      .setRestitution(0)
      .setContactSkin(0.0008);
    this.attachCollider(body, collider);

    if (spec.endCapRadius) {
      const localEnd = this.worldPointToBodyLocal(body, end, new THREE.Vector3());
      const endCap = RAPIER.ColliderDesc.ball(spec.endCapRadius)
        .setTranslation(localEnd.x, localEnd.y, localEnd.z)
        .setDensity(spec.density * 0.7)
        .setFriction(contactFriction)
        .setRestitution(0)
        .setContactSkin(0.001);
      this.attachCollider(body, endCap);
    }
    return body;
  }

  private animationSampleForBone(bone: THREE.Bone): RagdollBoneMotion | undefined {
    return this.animationMotion?.bones[normalizeName(bone.name)];
  }

  private clampVectorMagnitude(vector: THREE.Vector3, maxLength: number): THREE.Vector3 {
    const lengthSq = vector.lengthSq();
    if (lengthSq > maxLength * maxLength) vector.multiplyScalar(maxLength / Math.sqrt(lengthSq));
    return vector;
  }

  private inheritedRootAngularVelocity(yawRate: number, target: THREE.Vector3): THREE.Vector3 {
    const rootSample = this.animationSampleForBone(this.hips);
    if (!rootSample) return target.set(0, yawRate, 0);

    // The controller owns the character's world yaw, while the evaluated Hips
    // can still carry authored pitch/roll and a little local yaw. Blend rather
    // than adding the two, otherwise a turn animation would be counted twice.
    target.set(
      THREE.MathUtils.clamp(rootSample.angularVelocity.x * 0.62, -3.2, 3.2),
      THREE.MathUtils.lerp(yawRate, rootSample.angularVelocity.y, 0.28),
      THREE.MathUtils.clamp(rootSample.angularVelocity.z * 0.62, -3.2, 3.2),
    );
    return this.clampVectorMagnitude(target, this.angularSpeedCap);
  }

  private inheritedPointVelocity(
    bone: THREE.Bone,
    worldPoint: THREE.Vector3,
    playerVelocity: Readonly<THREE.Vector3>,
    yawRate: number,
    target: THREE.Vector3,
  ): THREE.Vector3 {
    const offset = this.tempPositionC.copy(worldPoint).sub(this.initialMotionOrigin);
    const rootAngular = this.inheritedRootAngularVelocity(yawRate, this.tempAngularA);
    target
      .set(playerVelocity.x, playerVelocity.y, playerVelocity.z)
      .add(this.tempPositionB.crossVectors(rootAngular, offset));

    const sample = this.animationSampleForBone(bone);
    const rootSample = this.animationSampleForBone(this.hips);
    if (!sample || !rootSample) return target;

    // Remove translation + rotation of the sampled skeleton root. What remains
    // is the actual authored limb motion (arm swing, stepping leg, head turn...).
    // Then re-add the authoritative gameplay root motion above.
    const sampledRootAngular = this.tempAngularB.set(
      rootSample.angularVelocity.x,
      rootSample.angularVelocity.y,
      rootSample.angularVelocity.z,
    );
    const rootTangential = this.tempPositionA.crossVectors(sampledRootAngular, offset);
    const relativeAnimation = this.tempX.set(
      sample.linearVelocity.x - rootSample.linearVelocity.x,
      sample.linearVelocity.y - rootSample.linearVelocity.y,
      sample.linearVelocity.z - rootSample.linearVelocity.z,
    ).sub(rootTangential);
    this.clampVectorMagnitude(relativeAnimation, MAX_ANIMATION_RELATIVE_LINEAR_SPEED)
      .multiplyScalar(ANIMATION_LINEAR_INERTIA_SCALE);
    target.add(relativeAnimation);
    return target;
  }

  private inheritedAngularVelocity(
    bone: THREE.Bone,
    yawRate: number,
    target: THREE.Vector3,
  ): THREE.Vector3 {
    const rootAngular = this.inheritedRootAngularVelocity(yawRate, target);
    const sample = this.animationSampleForBone(bone);
    const rootSample = this.animationSampleForBone(this.hips);
    if (!sample || !rootSample || bone === this.hips) return rootAngular;

    const relative = this.tempAngularC.set(
      sample.angularVelocity.x - rootSample.angularVelocity.x,
      sample.angularVelocity.y - rootSample.angularVelocity.y,
      sample.angularVelocity.z - rootSample.angularVelocity.z,
    );
    this.clampVectorMagnitude(relative, MAX_ANIMATION_RELATIVE_ANGULAR_SPEED)
      .multiplyScalar(ANIMATION_ANGULAR_INERTIA_SCALE);
    rootAngular.add(relative);
    return this.clampVectorMagnitude(rootAngular, this.angularSpeedCap);
  }

  private segmentInheritedAngularVelocity(
    startBone: THREE.Bone,
    start: THREE.Vector3,
    end: THREE.Vector3,
    startVelocity: THREE.Vector3,
    endVelocity: THREE.Vector3,
    yawRate: number,
  ): THREE.Vector3 {
    const segment = this.tempPositionA.copy(end).sub(start);
    const lengthSq = Math.max(segment.lengthSq(), 1e-6);
    const direction = this.tempPositionB.copy(segment).normalize();
    const velocityDifference = this.tempPositionC.copy(endVelocity).sub(startVelocity);

    // For a rigid segment dv = omega x r. r x dv / |r|^2 recovers the swing
    // component perpendicular to the limb. The bone's measured angular motion
    // supplies only the missing twist component along the limb axis.
    const swing = this.tempAngularA.crossVectors(segment, velocityDifference).divideScalar(lengthSq);
    const preferredAngular = this.inheritedAngularVelocity(startBone, yawRate, this.tempAngularB);
    const twistAmount = preferredAngular.dot(direction);
    const twist = this.tempAngularC.copy(direction).multiplyScalar(twistAmount);
    return this.clampVectorMagnitude(swing.add(twist), this.angularSpeedCap).clone();
  }

  private createBody(
    id: string,
    center: THREE.Vector3,
    rotation: THREE.Quaternion,
    membership: number,
    velocity: Readonly<THREE.Vector3>,
    yawRate: number,
    linearVelocityOverride?: Readonly<THREE.Vector3>,
    angularVelocityOverride?: Readonly<THREE.Vector3>,
  ): RagdollBody {
    // If the player was turning at death, every point has tangential velocity
    // around the pelvis. Supplying it avoids a first-frame joint correction.
    const offsetX = center.x - this.initialMotionOrigin.x;
    const offsetZ = center.z - this.initialMotionOrigin.z;
    const inheritedX = linearVelocityOverride?.x ?? (velocity.x + yawRate * offsetZ);
    const inheritedY = linearVelocityOverride?.y ?? velocity.y;
    const inheritedZ = linearVelocityOverride?.z ?? (velocity.z - yawRate * offsetX);
    const inheritedAngularX = angularVelocityOverride?.x ?? 0;
    const inheritedAngularY = angularVelocityOverride?.y ?? yawRate;
    const inheritedAngularZ = angularVelocityOverride?.z ?? 0;
    const rigidBody = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(center.x, center.y, center.z)
        .setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w })
        .setLinvel(inheritedX, inheritedY, inheritedZ)
        .setAngvel({ x: inheritedAngularX, y: inheritedAngularY, z: inheritedAngularZ })
        .setGravityScale(RAGDOLL_GRAVITY_SCALE)
        .setLinearDamping(BASE_LINEAR_DAMPING)
        .setAngularDamping(BASE_ANGULAR_DAMPING)
        .setCcdEnabled(true)
        .setCanSleep(true)
        .setAdditionalSolverIterations(10),
    );
    rigidBody.setSoftCcdPrediction(0.03);
    const desiredFilter = desiredCollisionFilter(membership);
    const result: RagdollBody = {
      id,
      body: rigidBody,
      membership,
      desiredCollisionGroups: makeCollisionGroups(membership, desiredFilter),
      colliders: [],
      lastLinearSpeed: Math.hypot(inheritedX, inheritedY, inheritedZ),
      lastAngularSpeed: Math.hypot(inheritedAngularX, inheritedAngularY, inheritedAngularZ),
      preStepVelocity: new THREE.Vector3(inheritedX, inheritedY, inheritedZ),
      impactCooldown: 0,
    };
    this.bodies.set(id, result);
    this.ownedBodies.push(rigidBody);
    return result;
  }

  private attachNeckGuard(
    headBody: RagdollBody,
    neckAnchor: THREE.Vector3,
    headCenter: THREE.Vector3,
  ): void {
    // The skull sphere alone leaves the small neck/root area uncovered. This
    // light guard plugs that hole so the neck anchor physically cannot dive
    // through the upper chest when the head hits a wall or the floor.
    const direction = headCenter.clone().sub(neckAnchor);
    if (direction.lengthSq() < 1e-8) direction.set(0, 1, 0);
    else direction.normalize();
    const guardCenter = neckAnchor.clone().addScaledVector(direction, 0.03);
    const localCenter = this.worldPointToBodyLocal(headBody, guardCenter, new THREE.Vector3());
    const guard = RAPIER.ColliderDesc.ball(0.067)
      .setTranslation(localCenter.x, localCenter.y, localCenter.z)
      .setDensity(180)
      .setFriction(0.76)
      .setRestitution(0)
      .setContactSkin(0.0008);
    this.attachCollider(headBody, guard);
  }

  private attachCollider(body: RagdollBody, description: RAPIER.ColliderDesc): RAPIER.Collider {
    // Self-collision is delayed briefly. Exact animation poses may begin with a
    // hand grazing the chest or a thigh near the pelvis; enabling all those
    // contacts on the very first solver tick can create a penetration impulse.
    // World collision is active immediately, while direct anatomical neighbours
    // remain protected by their joint's contactsEnabled(false) setting.
    let initialFilter = WORLD_GROUP;
    if (body.membership === HEAD_GROUP) initialFilter |= PELVIS_GROUP;
    if (body.membership === PELVIS_GROUP) initialFilter |= HEAD_GROUP;
    description.setCollisionGroups(makeCollisionGroups(body.membership, initialFilter));
    const collider = this.physics.world.createCollider(description, body.body);
    body.colliders.push(collider);
    return collider;
  }

  private enableSelfCollisions(): void {
    this.selfCollisionsEnabled = true;
    for (const ragdollBody of this.bodies.values()) {
      for (const collider of ragdollBody.colliders) {
        collider.setCollisionGroups(ragdollBody.desiredCollisionGroups);
      }
    }
  }

  private bindBone(bone: THREE.Bone, body: RagdollBody, bindPosition = false): void {
    bone.updateWorldMatrix(true, false);
    const boneRotation = bone.getWorldQuaternion(new THREE.Quaternion());
    const bodyRotationValue = bodyRotation(body.body, new THREE.Quaternion());
    const bodyToBoneRotation = bodyRotationValue.clone().invert().multiply(boneRotation).normalize();
    let bodyToBonePosition: THREE.Vector3 | undefined;
    if (bindPosition) {
      bodyToBonePosition = this.worldPointToBodyLocal(
        body,
        bone.getWorldPosition(new THREE.Vector3()),
        new THREE.Vector3(),
      );
    }
    this.bindings.push({ bone, body, bodyToBoneRotation, bodyToBonePosition });
  }

  private connectFixed(
    parent: RagdollBody,
    child: RagdollBody,
    worldAnchor: THREE.Vector3,
  ): void {
    const anchor1 = this.worldPointToBodyLocal(parent, worldAnchor, new THREE.Vector3());
    const anchor2 = this.worldPointToBodyLocal(child, worldAnchor, new THREE.Vector3());
    const parentRotation = bodyRotation(parent.body, new THREE.Quaternion());
    const childRotation = bodyRotation(child.body, new THREE.Quaternion());

    // Use the parent's current world frame as the shared fixed-joint frame.
    // This preserves the exact evaluated death pose with zero first-tick snap.
    const frame1 = new THREE.Quaternion();
    const frame2 = childRotation.clone().invert().multiply(parentRotation).normalize();
    const joint = this.createOwnedJoint(
      RAPIER.JointData.fixed(
        { x: anchor1.x, y: anchor1.y, z: anchor1.z },
        { x: frame1.x, y: frame1.y, z: frame1.z, w: frame1.w },
        { x: anchor2.x, y: anchor2.y, z: anchor2.z },
        { x: frame2.x, y: frame2.y, z: frame2.z, w: frame2.w },
      ),
      parent.body,
      child.body,
      true,
    );
    joint.setContactsEnabled(false);
    this.links.push({ parent, child });
  }

  private connectFramedUniversal(
    id: string,
    parent: RagdollBody,
    child: RagdollBody,
    worldAnchor: THREE.Vector3,
    firstAxisLocal: THREE.Vector3,
    firstMinDegrees: number,
    firstMaxDegrees: number,
    secondAxisLocal: THREE.Vector3,
    secondMinDegrees: number,
    secondMaxDegrees: number,
    maxSwingDegrees: number,
    maxTwistDegrees: number,
    allowTwist = false,
  ): void {
    const parentRotation = bodyRotation(parent.body, new THREE.Quaternion());
    const childRotation = bodyRotation(child.body, new THREE.Quaternion());
    const parentPosition = bodyPosition(parent.body, new THREE.Vector3());
    const parentLinearRaw = parent.body.linvel();
    const parentAngularRaw = parent.body.angvel();
    const parentAngular = new THREE.Vector3(parentAngularRaw.x, parentAngularRaw.y, parentAngularRaw.z);
    const radius = worldAnchor.clone().sub(parentPosition);
    const pointVelocity = new THREE.Vector3(
      parentLinearRaw.x, parentLinearRaw.y, parentLinearRaw.z,
    ).add(new THREE.Vector3().crossVectors(parentAngular, radius));

    const createFrame = (): RAPIER.RigidBody => {
      // These bodies are constraint carriers only: no collider and no gravity.
      // A modest explicit inertia keeps the two-axis gimbal numerically stable
      // without adding fake weight that could make an arm/leg hover or tug the core.
      const frame = this.physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(worldAnchor.x, worldAnchor.y, worldAnchor.z)
          .setRotation({ x: childRotation.x, y: childRotation.y, z: childRotation.z, w: childRotation.w })
          .setLinvel(pointVelocity.x, pointVelocity.y, pointVelocity.z)
          .setAngvel({ x: parentAngularRaw.x, y: parentAngularRaw.y, z: parentAngularRaw.z })
          .setGravityScale(0)
          .setLinearDamping(BASE_LINEAR_DAMPING)
          .setAngularDamping(BASE_ANGULAR_DAMPING)
          .setAdditionalMassProperties(
            0.18,
            { x: 0, y: 0, z: 0 },
            { x: 0.0035, y: 0.0035, z: 0.0035 },
            { x: 0, y: 0, z: 0, w: 1 },
          )
          .setCanSleep(true)
          .setAdditionalSolverIterations(10),
      );
      this.ownedBodies.push(frame);
      this.jointFrameBodies.push(frame);
      return frame;
    };

    // Root frame is welded to the parent in the child's evaluated orientation.
    // This preserves the exact death pose while giving both revolute stages a
    // common anatomical frame. Unlike the old kinematic proxies, every stage is
    // dynamic and belongs to the same solver island, so it cannot inject energy.
    const rootFrame = createFrame();
    const swingFrame = createFrame();
    const twistFrame = allowTwist ? createFrame() : undefined;
    const parentAnchor = this.worldPointToBodyLocal(parent, worldAnchor, new THREE.Vector3());
    const parentFrame = parentRotation.clone().invert().multiply(childRotation).normalize();
    const identity = new THREE.Quaternion();
    const fixed = this.createOwnedJoint(
      RAPIER.JointData.fixed(
        { x: parentAnchor.x, y: parentAnchor.y, z: parentAnchor.z },
        { x: parentFrame.x, y: parentFrame.y, z: parentFrame.z, w: parentFrame.w },
        { x: 0, y: 0, z: 0 },
        { x: identity.x, y: identity.y, z: identity.z, w: identity.w },
      ),
      parent.body,
      rootFrame,
      true,
    );
    fixed.setContactsEnabled(false);

    // Stage 1 + stage 2 form a constrained universal joint. Limbs get the two
    // swing directions gravity needs while their long-axis twist stays locked.
    // The neck alone adds a bounded yaw stage below.
    const axis1 = firstAxisLocal.clone().normalize();
    const first = this.createOwnedJoint(
      RAPIER.JointData.revolute(
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: axis1.x, y: axis1.y, z: axis1.z },
      ),
      rootFrame,
      swingFrame,
      true,
    ) as RAPIER.RevoluteImpulseJoint;
    first.setContactsEnabled(false);
    first.setLimits(
      THREE.MathUtils.degToRad(firstMinDegrees),
      THREE.MathUtils.degToRad(firstMaxDegrees),
    );

    const childAnchor = this.worldPointToBodyLocal(child, worldAnchor, new THREE.Vector3());
    const axis2 = secondAxisLocal.clone().normalize();
    const second = this.createOwnedJoint(
      RAPIER.JointData.revolute(
        { x: 0, y: 0, z: 0 },
        twistFrame ? { x: 0, y: 0, z: 0 } : { x: childAnchor.x, y: childAnchor.y, z: childAnchor.z },
        { x: axis2.x, y: axis2.y, z: axis2.z },
      ),
      swingFrame,
      twistFrame ?? child.body,
      true,
    ) as RAPIER.RevoluteImpulseJoint;
    second.setContactsEnabled(false);
    second.setLimits(
      THREE.MathUtils.degToRad(secondMinDegrees),
      THREE.MathUtils.degToRad(secondMaxDegrees),
    );
    if (twistFrame) {
      // Cervical yaw is real articulation, separate from pitch and lateral
      // flexion. Shoulders and hips retain their existing two-axis frames.
      const twist = this.createOwnedJoint(
        RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 },
          { x: childAnchor.x, y: childAnchor.y, z: childAnchor.z }, { x: 0, y: 1, z: 0 }),
        twistFrame, child.body, true,
      ) as RAPIER.RevoluteImpulseJoint;
      twist.setContactsEnabled(false);
      twist.setLimits(-THREE.MathUtils.degToRad(maxTwistDegrees), THREE.MathUtils.degToRad(maxTwistDegrees));
    }

    // Native revolute limits are the hard stops. This additional cone/twist
    // guard is dissipative only and starts braking before a combined two-axis
    // rotation reaches a visually impossible diagonal extreme.
    const initialRelative = parentRotation.clone().invert().multiply(childRotation).normalize();
    this.limits.push({
      parent,
      child,
      initialRelative,
      maxSwing: THREE.MathUtils.degToRad(maxSwingDegrees),
      maxTwist: THREE.MathUtils.degToRad(maxTwistDegrees),
    });
    this.links.push({ parent, child });

    // A perfectly upright limb can become a numerically balanced inverted
    // pendulum (especially after a freeze-frame animation). Keep a one-shot,
    // tiny symmetry breaker so gravity can finish the fall instead of leaving
    // an arm/head/thigh pointing into the air. This does not drive the joint.
    const nudgeAxisWorld = firstAxisLocal.clone().normalize().applyQuaternion(childRotation);
    const nudgeAxisParentLocal = nudgeAxisWorld
      .applyQuaternion(parentRotation.clone().invert())
      .normalize();
    this.gravityReleases.push({
      parent,
      child,
      parentAnchorLocal: parentAnchor.clone(),
      nudgeAxisParentLocal,
      mode: 'raised',
      released: false,
    });

    // A dead straight arm can otherwise become a perfect structural column:
    // elbow hard-stop + shoulder hard-stop + floor friction may numerically hold
    // the whole rib cage above the ground forever. Add one *tiny*, one-shot
    // shoulder symmetry breaker only for that downward support case. It does not
    // seek a pose and cannot keep injecting energy; it merely removes the exact
    // singular balance so gravity can fold/slide the arm naturally.
    if (id.includes('shoulder')) {
      this.gravityReleases.push({
        parent,
        child,
        parentAnchorLocal: parentAnchor.clone(),
        nudgeAxisParentLocal: nudgeAxisParentLocal.clone(),
        mode: 'support',
        released: false,
      });
    }
  }

  private connectSpherical(
    parent: RagdollBody,
    child: RagdollBody,
    worldAnchor: THREE.Vector3,
    maxSwingDegrees: number,
    maxTwistDegrees: number,
  ): void {
    const anchor1 = this.worldPointToBodyLocal(parent, worldAnchor, new THREE.Vector3());
    const anchor2 = this.worldPointToBodyLocal(child, worldAnchor, new THREE.Vector3());
    const joint = this.createOwnedJoint(
      RAPIER.JointData.spherical(
        { x: anchor1.x, y: anchor1.y, z: anchor1.z },
        { x: anchor2.x, y: anchor2.y, z: anchor2.z },
      ),
      parent.body,
      child.body,
      true,
    );
    joint.setContactsEnabled(false);

    const parentRotation = bodyRotation(parent.body, new THREE.Quaternion());
    const childRotation = bodyRotation(child.body, new THREE.Quaternion());
    const initialRelative = parentRotation.clone().invert().multiply(childRotation).normalize();
    this.limits.push({
      parent,
      child,
      initialRelative,
      maxSwing: THREE.MathUtils.degToRad(maxSwingDegrees),
      maxTwist: THREE.MathUtils.degToRad(maxTwistDegrees),
    });
    this.links.push({ parent, child });
  }

  private connectHinge(
    parent: RagdollBody,
    child: RagdollBody,
    worldAnchor: THREE.Vector3,
    preferredBendSign: number,
    maxFlexDegrees: number,
    hyperExtensionDegrees: number,
  ): void {
    const anchor1 = this.worldPointToBodyLocal(parent, worldAnchor, new THREE.Vector3());
    const anchor2 = this.worldPointToBodyLocal(child, worldAnchor, new THREE.Vector3());
    const joint = this.createOwnedJoint(
      RAPIER.JointData.revolute(
        { x: anchor1.x, y: anchor1.y, z: anchor1.z },
        { x: anchor2.x, y: anchor2.y, z: anchor2.z },
        { x: 1, y: 0, z: 0 },
      ),
      parent.body,
      child.body,
      true,
    ) as RAPIER.RevoluteImpulseJoint;
    joint.setContactsEnabled(false);

    const parentRotation = bodyRotation(parent.body, new THREE.Quaternion());
    const childRotation = bodyRotation(child.body, new THREE.Quaternion());
    const relative = parentRotation.clone().invert().multiply(childRotation).normalize();
    let currentAngle = wrapAngle(2 * Math.atan2(relative.x, relative.w));

    // The imported joint coordinate can have the opposite sign from the visual
    // anatomical bend. Keep those two concepts separate: Rapier gets the sign
    // that matches its current revolute coordinate, while the independent
    // geometry guard keeps the actual elbow/knee bend direction anatomical.
    const anatomicalBendSign = preferredBendSign >= 0 ? 1 : -1;
    let jointBendSign = anatomicalBendSign;
    if (Math.abs(currentAngle) > THREE.MathUtils.degToRad(12)) {
      jointBendSign = Math.sign(currentAngle) || anatomicalBendSign;
    }

    const maxFlex = THREE.MathUtils.degToRad(maxFlexDegrees);
    const hyper = THREE.MathUtils.degToRad(hyperExtensionDegrees);
    let min = jointBendSign > 0 ? -hyper : -maxFlex;
    let max = jointBendSign > 0 ? maxFlex : hyper;

    // The exact pose-at-death is always legal, even if an authored animation is
    // a few degrees outside our nominal envelope.
    const poseMargin = THREE.MathUtils.degToRad(3);
    min = Math.min(min, currentAngle - poseMargin);
    max = Math.max(max, currentAngle + poseMargin);
    joint.setLimits(min, max);

    // Independently verify the physical segment directions every substep. This
    // protects against any FBX/local-axis convention mismatch in the revolute
    // coordinate itself and makes backwards knees/elbows impossible.
    const geometricPose = this.currentHingeFlex(parent, child, anatomicalBendSign);
    const geometricMargin = THREE.MathUtils.degToRad(2);
    const safeMaxFlex = Math.max(maxFlex, geometricPose > 0 ? geometricPose + geometricMargin : maxFlex);
    const safeHyper = Math.max(hyper, geometricPose < 0 ? -geometricPose + geometricMargin : hyper);
    this.hingeLimits.push({
      parent,
      child,
      bendSign: anatomicalBendSign,
      maxFlex: safeMaxFlex,
      maxHyperextension: safeHyper,
    });
    this.links.push({ parent, child });

    // Also let a nearly straight elbow buckle once if the forearm itself is the
    // vertical support. The signed local X axis follows the anatomical flex
    // direction, so this can only start bending the elbow the human way; the
    // native revolute limits still prevent any backwards fold.
    if (parent.id.includes('upper-arm') && child.id.includes('forearm')) {
      this.gravityReleases.push({
        parent,
        child,
        parentAnchorLocal: anchor1.clone(),
        nudgeAxisParentLocal: X_AXIS.clone().multiplyScalar(anatomicalBendSign),
        mode: 'support',
        released: false,
      });
    }
  }

  private initializeActiveFallReactions(velocity: Readonly<THREE.Vector3>): void {
    if (this.quietStart || this.activeResponseScale <= 0) return;

    const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
    this.activeProfile = activeRagdollProfile(
      horizontalSpeed,
      velocity.y,
      this.animationMotion !== undefined,
      this.random.float(),
    );
    this.activeAsymmetrySign = this.random.float() < 0.5 ? -1 : 1;
    this.activeArmPhase = this.random.float() * Math.PI * 2;
    this.activeRecoveryFootSign = this.activeAsymmetrySign;

    if (horizontalSpeed > 0.18) {
      this.activeForward.set(velocity.x, 0, velocity.z).normalize();
    } else {
      const characterRotation = this.character.getWorldQuaternion(this.tempQuaternionA);
      this.activeForward.copy(Z_AXIS).applyQuaternion(characterRotation).setY(0);
      if (this.activeForward.lengthSq() < 1e-6) this.activeForward.set(0, 0, 1);
      else this.activeForward.normalize();
    }
    this.activeRight.set(this.activeForward.z, 0, -this.activeForward.x).normalize();

    // Start the synthetic continuation on the same half-step the captured
    // animation was already performing. This avoids a visible phase reversal
    // exactly when a walk/run is handed to physics.
    const left = this.bodies.get('left-upper-leg')?.body.linvel();
    const right = this.bodies.get('right-upper-leg')?.body.linvel();
    if (left && right) {
      const leftAlong = left.x * this.activeForward.x + left.z * this.activeForward.z;
      const rightAlong = right.x * this.activeForward.x + right.z * this.activeForward.z;
      this.activeGaitPhase = leftAlong >= rightAlong ? Math.PI * 0.5 : -Math.PI * 0.5;
      this.activeRecoveryFootSign = leftAlong >= rightAlong ? 1 : -1;
    } else {
      this.activeGaitPhase = this.activeAsymmetrySign > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
    }
  }

  private addActiveVelocity(
    id: string,
    linearDelta?: THREE.Vector3,
    angularDelta?: THREE.Vector3,
  ): void {
    const part = this.bodies.get(id);
    if (!part?.body.isValid()) return;

    if (linearDelta && linearDelta.lengthSq() > 0) {
      const raw = part.body.linvel();
      this.tempX.set(raw.x, raw.y, raw.z).add(linearDelta);
      this.clampVectorMagnitude(this.tempX, this.linearSpeedCap);
      part.body.setLinvel({ x: this.tempX.x, y: this.tempX.y, z: this.tempX.z }, true);
    }
    if (angularDelta && angularDelta.lengthSq() > 0) {
      const raw = part.body.angvel();
      this.tempAngularC.set(raw.x, raw.y, raw.z).add(angularDelta);
      this.clampVectorMagnitude(this.tempAngularC, this.angularSpeedCap);
      part.body.setAngvel(
        { x: this.tempAngularC.x, y: this.tempAngularC.y, z: this.tempAngularC.z },
        true,
      );
    }
  }

  /**
   * Very short active-ragdoll reflex window. We never seek an authored pose:
   * instead, tiny decaying velocity changes continue the interrupted gait and
   * let the arms reach into the fall. Rapier contacts/joint limits remain fully
   * authoritative, so a hand that reaches the floor can brace while a hand over
   * open air simply keeps falling with the body.
   */
  private applyActiveFallReactions(delta: number): void {
    const profile = this.activeProfile;
    if (!profile || this.quietStart || this.elapsed >= profile.duration) return;
    const envelope = activeRagdollEnvelope(this.elapsed, profile.duration) * this.activeResponseScale;
    if (envelope <= 0.0005) return;

    const normalized = THREE.MathUtils.clamp(this.elapsed / profile.duration, 0, 1);
    const animationCarry = activeRagdollAnimationCarry(this.elapsed);
    const phase = this.activeGaitPhase
      + this.elapsed * profile.gaitFrequencyHz * Math.PI * 2;
    const gaitWave = Math.sin(phase);
    const lowerLegWave = Math.sin(phase + Math.PI * 0.58);
    // Let the captured FBX velocity dominate the first few hundred ms. The
    // synthetic cycle then takes over just enough to finish the interrupted
    // step rather than immediately replacing it with a generic flail.
    const gait = profile.gaitStrength * envelope * (0.82 + animationCarry * 0.28);

    if (gait > 0.01) {
      // Continue one or two interrupted walk/run cycles. Running has visibly
      // larger scissor motion, while a walking hand-off retains a smaller pendulum.
      const legLinearAccel = 2.05 * gait;
      const thighAngularAccel = 6.6 * gait;
      const shinAngularAccel = 4.8 * gait;
      const leftLegLinear = this.tempPositionA.copy(this.activeForward)
        .multiplyScalar(gaitWave * legLinearAccel * delta);
      const rightLegLinear = this.tempPositionB.copy(leftLegLinear).multiplyScalar(-1);
      const leftThighAngular = this.tempAngularA.copy(this.activeRight)
        .multiplyScalar(gaitWave * thighAngularAccel * delta);
      const rightThighAngular = this.tempAngularB.copy(leftThighAngular).multiplyScalar(-1);
      const leftShinAngular = this.tempPositionC.copy(this.activeRight)
        .multiplyScalar(-lowerLegWave * shinAngularAccel * delta);
      const rightShinAngular = this.tempY.copy(leftShinAngular).multiplyScalar(-1);

      this.addActiveVelocity('left-upper-leg', leftLegLinear, leftThighAngular);
      this.addActiveVelocity('right-upper-leg', rightLegLinear, rightThighAngular);
      this.addActiveVelocity('left-lower-leg', undefined, leftShinAngular);
      this.addActiveVelocity('right-lower-leg', undefined, rightShinAngular);

      // Preserve the arm counter-swing while the previous locomotion still
      // reads. It progressively yields to emergency balance / bracing below.
      const armSwingScale = profile.style === 'scramble' ? 0.86 : 0.48;
      const armAngular = 4.0 * gait * armSwingScale * (0.72 + animationCarry * 0.45) * delta;
      this.addActiveVelocity(
        'left-upper-arm',
        undefined,
        this.tempZ.copy(this.activeRight).multiplyScalar(-gaitWave * armAngular),
      );
      this.addActiveVelocity(
        'right-upper-arm',
        undefined,
        this.tempZ.copy(this.activeRight).multiplyScalar(gaitWave * armAngular),
      );
    }

    // One leg often makes a desperate extra step when balance is lost. This is
    // not a locomotion force: the forward/down pulse is applied only to one limb
    // and has no matching core impulse, so the foot can find a floor if one is
    // there while simply missing it over open air.
    const recoveryPulse = Math.sin(Math.min(1, normalized / 0.62) * Math.PI);
    const recovery = profile.recoveryStepStrength * recoveryPulse * envelope;
    if (recovery > 0.01) {
      const leftActive = this.activeRecoveryFootSign > 0;
      const upperId = leftActive ? 'left-upper-leg' : 'right-upper-leg';
      const lowerId = leftActive ? 'left-lower-leg' : 'right-lower-leg';
      const stepLinear = this.tempPositionA
        .copy(this.activeForward).multiplyScalar(0.92)
        .addScaledVector(DOWN_AXIS, 0.34)
        .normalize()
        .multiplyScalar(1.65 * recovery * delta);
      const upperAngular = this.tempAngularA.copy(this.activeRight)
        .multiplyScalar(4.8 * recovery * delta);
      const lowerAngular = this.tempAngularB.copy(this.activeRight)
        .multiplyScalar(-3.4 * recovery * delta);
      this.addActiveVelocity(upperId, stepLinear, upperAngular);
      this.addActiveVelocity(lowerId, undefined, lowerAngular);
    }

    // Emergency arm circles. Humans commonly windmill the arms when the centre
    // of mass escapes the base of support. Two slightly phase-shifted circles
    // avoid the mirrored "T-pose flail" look, and the effect starts only after
    // the captured animation has had a moment to carry through.
    const windmillDelay = THREE.MathUtils.smoothstep(normalized, 0.06, 0.2);
    const windmill = profile.armWindmillStrength
      * envelope
      * windmillDelay
      * (1 - animationCarry * 0.34);
    if (windmill > 0.008 && profile.style !== 'brace') {
      const windmillHz = profile.style === 'scramble' ? 1.72 : 1.38;
      const baseCircle = this.activeArmPhase + this.elapsed * windmillHz * Math.PI * 2;
      const leftCircle = baseCircle;
      const rightCircle = baseCircle + Math.PI * (profile.style === 'asymmetric' ? 0.64 : 0.92);

      const applyArmCircle = (
        upperId: string,
        forearmId: string,
        angle: number,
        sideSign: number,
        strengthScale: number,
      ): void => {
        const forwardWave = Math.sin(angle);
        const sideWave = Math.cos(angle);
        const upperAngular = this.tempAngularA
          .copy(this.activeRight)
          .multiplyScalar(-forwardWave * 7.4 * windmill * strengthScale * delta)
          .addScaledVector(
            this.activeForward,
            sideWave * sideSign * 4.6 * windmill * strengthScale * delta,
          );
        const forearmAngular = this.tempAngularB
          .copy(this.activeRight)
          .multiplyScalar(-Math.sin(angle + 0.48) * 5.3 * windmill * strengthScale * delta)
          .addScaledVector(
            this.activeForward,
            Math.cos(angle + 0.48) * sideSign * 3.2 * windmill * strengthScale * delta,
          );
        const forearmLinear = this.tempPositionC
          .copy(this.activeForward).multiplyScalar(forwardWave * 0.72)
          .addScaledVector(Y_AXIS, sideWave * 0.58)
          .addScaledVector(this.activeRight, sideSign * 0.34)
          .multiplyScalar(1.35 * windmill * strengthScale * delta);
        this.addActiveVelocity(upperId, undefined, upperAngular);
        this.addActiveVelocity(forearmId, forearmLinear, forearmAngular);
      };

      const asymmetry = profile.style === 'asymmetric' ? 0.34 : 0.1;
      applyArmCircle(
        'left-upper-arm', 'left-forearm', leftCircle, -1,
        THREE.MathUtils.clamp(1 - this.activeAsymmetrySign * asymmetry, 0.58, 1.34),
      );
      applyArmCircle(
        'right-upper-arm', 'right-forearm', rightCircle, 1,
        THREE.MathUtils.clamp(1 + this.activeAsymmetrySign * asymmetry, 0.58, 1.34),
      );
    }

    // Protective reach takes over as the fall becomes committed. It is a
    // velocity request, never a pose motor: on solid ground the forearm/hand
    // collider catches load and the elbow folds; above a hole it simply keeps
    // reaching through empty space with the rest of the falling body.
    const braceWindow = THREE.MathUtils.smoothstep(normalized, 0.14, 0.42)
      * (1 - THREE.MathUtils.smoothstep(normalized, 0.78, 1));
    const brace = profile.armBraceStrength * braceWindow * envelope;
    if (brace > 0.008) {
      const asymmetry = profile.style === 'asymmetric' ? 0.4 : 0.1;
      const leftScale = THREE.MathUtils.clamp(
        1 - this.activeAsymmetrySign * asymmetry,
        0.46,
        1.38,
      );
      const rightScale = THREE.MathUtils.clamp(
        1 + this.activeAsymmetrySign * asymmetry,
        0.46,
        1.38,
      );
      const forwardWeight = profile.style === 'scramble' ? 0.78 : 0.96;
      const downWeight = profile.style === 'brace' ? 0.62 : 0.48;

      const leftReach = this.tempPositionA
        .copy(this.activeForward).multiplyScalar(forwardWeight)
        .addScaledVector(DOWN_AXIS, downWeight)
        .addScaledVector(this.activeRight, -0.28)
        .normalize()
        .multiplyScalar(3.05 * brace * leftScale * delta);
      const rightReach = this.tempPositionB
        .copy(this.activeForward).multiplyScalar(forwardWeight)
        .addScaledVector(DOWN_AXIS, downWeight)
        .addScaledVector(this.activeRight, 0.28)
        .normalize()
        .multiplyScalar(3.05 * brace * rightScale * delta);
      const leftUpperReach = this.tempPositionC.copy(leftReach).multiplyScalar(0.68);
      const rightUpperReach = this.tempY.copy(rightReach).multiplyScalar(0.68);

      this.addActiveVelocity('left-forearm', leftReach);
      this.addActiveVelocity('right-forearm', rightReach);
      this.addActiveVelocity(
        'left-upper-arm',
        leftUpperReach,
        this.tempAngularA.copy(this.activeRight).multiplyScalar(-3.8 * brace * leftScale * delta),
      );
      this.addActiveVelocity(
        'right-upper-arm',
        rightUpperReach,
        this.tempAngularB.copy(this.activeRight).multiplyScalar(-3.8 * brace * rightScale * delta),
      );
    }

    // Upper-body counter-balancing: pelvis/rib cage fight the fall while the
    // head tries to remain readable. It is intentionally angular only, so these
    // reflexes never create lift or turn a pit stumble into a knockback.
    const counter = profile.counterBalanceStrength * envelope;
    const torso = profile.torsoResponseStrength * envelope;
    if (counter > 0.008 || torso > 0.008) {
      const sway = Math.sin(phase * 0.47 + this.activeAsymmetrySign * 0.76);
      const urgentRock = Math.sin(Math.min(1, normalized / 0.55) * Math.PI);
      const coreDelta = this.tempAngularA
        .copy(this.activeRight)
        .multiplyScalar(-(1.12 * counter + 0.42 * torso * urgentRock) * delta)
        .addScaledVector(this.activeForward, sway * 0.76 * counter * delta);
      const headDelta = this.tempAngularB
        .copy(this.activeForward)
        .multiplyScalar(-sway * 0.42 * counter * delta)
        .addScaledVector(this.activeRight, 0.34 * torso * urgentRock * delta);
      this.addActiveVelocity('core', undefined, coreDelta);
      this.addActiveVelocity('head', undefined, headDelta);
    }
  }

  private applyEarlyCoherence(): void {
    if (this.elapsed >= COHERENCE_DURATION) return;
    const phase = THREE.MathUtils.clamp(this.elapsed / COHERENCE_DURATION, 0, 1);
    // When a real animation velocity sample is available, keep more of that
    // relative limb momentum during the first few solver ticks. We still retain
    // substantial coherence so the articulated body cannot instantly "unzip".
    const coherenceStrength = this.animationMotion ? 0.34 : 0.80;
    const blend = coherenceStrength * (1 - phase) * (1 - phase);
    if (blend <= 0.001) return;

    for (const link of this.links) {
      const parentAngularRaw = link.parent.body.angvel();
      const childAngularRaw = link.child.body.angvel();
      this.tempAngularA.set(parentAngularRaw.x, parentAngularRaw.y, parentAngularRaw.z);
      this.tempAngularB.set(childAngularRaw.x, childAngularRaw.y, childAngularRaw.z);

      this.tempX.copy(this.tempAngularB).sub(this.tempAngularA).multiplyScalar(blend * 0.5);
      this.tempAngularA.add(this.tempX);
      this.tempAngularB.sub(this.tempX);
      link.parent.body.setAngvel(
        { x: this.tempAngularA.x, y: this.tempAngularA.y, z: this.tempAngularA.z },
        false,
      );
      link.child.body.setAngvel(
        { x: this.tempAngularB.x, y: this.tempAngularB.y, z: this.tempAngularB.z },
        false,
      );
    }
  }

  private enforceSafetyLimits(delta: number): void {
    // These guards are deliberately DISSIPATIVE ONLY. They are allowed to
    // remove outward angular velocity, but never to create an inward corrective
    // velocity. A previous version tried to push joints back inside their
    // anatomical cone after an impact; on floors/stairs that correction fought
    // the contact solver and could relaunch the corpse forever.
    for (const limit of this.limits) {
      const parentRotationValue = bodyRotation(limit.parent.body, this.tempQuaternionA);
      const childRotationValue = bodyRotation(limit.child.body, this.tempQuaternionB);
      const currentRelative = this.tempQuaternionC
        .copy(parentRotationValue)
        .invert()
        .multiply(childRotationValue)
        .normalize();
      const deltaRotation = this.tempQuaternionD
        .copy(limit.initialRelative)
        .invert()
        .multiply(currentRelative)
        .normalize();
      if (deltaRotation.w < 0) {
        deltaRotation.set(-deltaRotation.x, -deltaRotation.y, -deltaRotation.z, -deltaRotation.w);
      }

      const twistRotation = this.tempQuaternionE.set(0, deltaRotation.y, 0, deltaRotation.w);
      const twistNorm = Math.hypot(twistRotation.y, twistRotation.w);
      if (twistNorm < 1e-7) twistRotation.identity();
      else {
        twistRotation.y /= twistNorm;
        twistRotation.w /= twistNorm;
        if (twistRotation.w < 0) {
          twistRotation.y = -twistRotation.y;
          twistRotation.w = -twistRotation.w;
        }
      }
      const signedTwist = wrapAngle(2 * Math.atan2(twistRotation.y, twistRotation.w));
      const swingRotation = this.tempQuaternionF
        .copy(deltaRotation)
        .multiply(this.tempQuaternionG.copy(twistRotation).invert())
        .normalize();
      if (swingRotation.w < 0) {
        swingRotation.set(-swingRotation.x, -swingRotation.y, -swingRotation.z, -swingRotation.w);
      }
      const swingAngle = 2 * Math.acos(THREE.MathUtils.clamp(swingRotation.w, -1, 1));
      const referenceWorld = this.tempQuaternionG
        .copy(parentRotationValue)
        .multiply(limit.initialRelative)
        .normalize();

      if (swingAngle > 1e-6) {
        const sinHalf = Math.sqrt(Math.max(1e-8, 1 - swingRotation.w * swingRotation.w));
        this.tempX.set(
          swingRotation.x / sinHalf,
          swingRotation.y / sinHalf,
          swingRotation.z / sinHalf,
        ).applyQuaternion(referenceWorld).normalize();
        this.enforceAngularStop(
          limit.parent, limit.child, this.tempX, swingAngle, limit.maxSwing, delta,
        );
      }

      if (Math.abs(signedTwist) > 1e-6) {
        this.tempY
          .copy(Y_AXIS)
          .applyQuaternion(swingRotation)
          .applyQuaternion(referenceWorld)
          .normalize();
        this.enforceAngularStop(
          limit.parent, limit.child, this.tempY, signedTwist, limit.maxTwist, delta,
        );
      }
    }

    // Elbows/knees already have native Rapier revolute limits. This independent
    // geometry check only brakes motion that is still travelling farther toward
    // a forbidden direction. It never "springs" the joint back.
    for (const limit of this.hingeLimits) {
      const parentRotationValue = bodyRotation(limit.parent.body, this.tempQuaternionA);
      const childRotationValue = bodyRotation(limit.child.body, this.tempQuaternionB);
      const parentAxis = this.tempX.copy(X_AXIS).applyQuaternion(parentRotationValue).normalize();
      const childAxis = this.tempZ.copy(X_AXIS).applyQuaternion(childRotationValue).normalize();
      if (parentAxis.dot(childAxis) < 0) childAxis.multiplyScalar(-1);
      const hingeAxis = parentAxis.add(childAxis);
      if (hingeAxis.lengthSq() < 1e-8) hingeAxis.copy(parentAxis);
      hingeAxis.normalize();

      const parentDirection = this.tempY.copy(Y_AXIS).applyQuaternion(parentRotationValue).normalize();
      const childDirection = this.tempPositionA.copy(Y_AXIS).applyQuaternion(childRotationValue).normalize();
      const cross = this.tempPositionB.crossVectors(parentDirection, childDirection);
      const signedRaw = Math.atan2(
        hingeAxis.dot(cross),
        THREE.MathUtils.clamp(parentDirection.dot(childDirection), -1, 1),
      );
      const flex = signedRaw * limit.bendSign;

      const parentAngularRaw = limit.parent.body.angvel();
      const childAngularRaw = limit.child.body.angvel();
      this.tempAngularA.set(parentAngularRaw.x, parentAngularRaw.y, parentAngularRaw.z);
      this.tempAngularB.set(childAngularRaw.x, childAngularRaw.y, childAngularRaw.z);
      const flexSpeed = this.tempAngularB.sub(this.tempAngularA).dot(hingeAxis) * limit.bendSign;

      const maxSoft = limit.maxFlex * 0.82;
      const hyperSoft = -limit.maxHyperextension * 0.35;
      if (flex > maxSoft && flexSpeed > 0) {
        const zone = THREE.MathUtils.clamp(
          (flex - maxSoft) / Math.max(limit.maxFlex - maxSoft, 1e-5), 0, 1,
        );
        const retained = THREE.MathUtils.lerp(0.5, 0.0, zone);
        this.setRelativeAngularSpeed(
          limit.parent, limit.child, hingeAxis,
          flexSpeed * retained * limit.bendSign, 3.6,
        );
      } else if (flex < hyperSoft && flexSpeed < 0) {
        const zone = THREE.MathUtils.clamp(
          (hyperSoft - flex) / Math.max(limit.maxHyperextension + hyperSoft, 1e-5), 0, 1,
        );
        const retained = THREE.MathUtils.lerp(0.35, 0.0, zone);
        this.setRelativeAngularSpeed(
          limit.parent, limit.child, hingeAxis,
          flexSpeed * retained * limit.bendSign, 3.6,
        );
      }
    }

    // Last-resort kinetic clamps only REMOVE energy. In particular, once the
    // initial airborne part of the death is over, a floor/stair contact cannot
    // turn a nearly-resting limb into a multi-m/s upward launch.
    const inheritedUpward = Math.max(0, this.initialVerticalSpeed);
    const handoffUpwardCap = this.quietStart
      ? 0.08
      : Math.max(0.42, inheritedUpward + 0.45);
    const maxUpwardSpeed = this.quietStart
      ? (this.elapsed < 0.50 ? 0.12 : 0.48)
      : this.elapsed < 0.22
        ? handoffUpwardCap
        : this.elapsed < 0.48
          ? Math.max(0.72, inheritedUpward + 0.25)
          : this.elapsed < 0.8
            ? 1.05
            : 0.62;
    for (const ragdollBody of this.bodies.values()) {
      const body = ragdollBody.body;
      let linear = body.linvel();
      if (linear.y > maxUpwardSpeed) {
        body.setLinvel({ x: linear.x, y: maxUpwardSpeed, z: linear.z }, false);
        linear = body.linvel();
      }

      // A severe authored landing is already in its final floor pose. During
      // the first few tenths, allow gravity to settle unsupported hands/feet but
      // never let solver depenetration turn that hand-off into a second impact.
      if (this.quietStart && this.elapsed < 0.36) {
        const quietLinearCap = ragdollBody.id === 'core' ? 0.42 : 0.95;
        const currentSpeed = Math.hypot(linear.x, linear.y, linear.z);
        if (currentSpeed > quietLinearCap && currentSpeed > 1e-6) {
          const scale = quietLinearCap / currentSpeed;
          body.setLinvel({ x: linear.x * scale, y: linear.y * scale, z: linear.z * scale }, false);
          linear = body.linvel();
        }
        const currentAngular = body.angvel();
        const quietAngularCap = ragdollBody.id === 'core' ? 0.55 : 1.35;
        const currentAngularSpeed = Math.hypot(currentAngular.x, currentAngular.y, currentAngular.z);
        if (currentAngularSpeed > quietAngularCap && currentAngularSpeed > 1e-6) {
          const scale = quietAngularCap / currentAngularSpeed;
          body.setAngvel({
            x: currentAngular.x * scale,
            y: currentAngular.y * scale,
            z: currentAngular.z * scale,
          }, false);
        }
      }

      linear = body.linvel();
      const linearSpeed = Math.hypot(linear.x, linear.y, linear.z);
      const growthAllowance = ragdollBody.lastLinearSpeed < 0.8 ? 0.14 : 0.48;
      const spikeCap = Math.min(
        this.linearSpeedCap,
        Math.max(1.6, ragdollBody.lastLinearSpeed + growthAllowance),
      );
      if (linearSpeed > spikeCap && linearSpeed > 1e-6) {
        const scale = spikeCap / linearSpeed;
        body.setLinvel({ x: linear.x * scale, y: linear.y * scale, z: linear.z * scale }, false);
      }

      let angular = body.angvel();
      const angularSpeed = Math.hypot(angular.x, angular.y, angular.z);
      const growthAngular = ragdollBody.lastAngularSpeed < 1.2 ? 0.34 : 0.9;
      const angularCap = Math.min(
        this.angularSpeedCap,
        Math.max(2.4, ragdollBody.lastAngularSpeed + growthAngular),
      );
      if (angularSpeed > angularCap && angularSpeed > 1e-6) {
        const scale = angularCap / angularSpeed;
        body.setAngvel({ x: angular.x * scale, y: angular.y * scale, z: angular.z * scale }, false);
        angular = body.angvel();
      }

      const finalLinear = body.linvel();
      const finalAngular = body.angvel();
      ragdollBody.lastLinearSpeed = Math.hypot(finalLinear.x, finalLinear.y, finalLinear.z);
      ragdollBody.lastAngularSpeed = Math.hypot(finalAngular.x, finalAngular.y, finalAngular.z);
    }
  }

  private enforceAngularStop(
    parent: RagdollBody,
    child: RagdollBody,
    axisWorld: THREE.Vector3,
    signedAngle: number,
    maxAngle: number,
    _delta: number,
  ): void {
    const angle = Math.abs(signedAngle);
    const softAngle = maxAngle * ANATOMY_SOFT_ZONE;
    if (angle <= softAngle) return;

    const sign = signedAngle >= 0 ? 1 : -1;
    const parentAngularRaw = parent.body.angvel();
    const childAngularRaw = child.body.angvel();
    this.tempAngularA.set(parentAngularRaw.x, parentAngularRaw.y, parentAngularRaw.z);
    this.tempAngularB.set(childAngularRaw.x, childAngularRaw.y, childAngularRaw.z);
    const outwardSpeed = this.tempAngularB
      .clone()
      .sub(this.tempAngularA)
      .dot(axisWorld) * sign;
    if (outwardSpeed <= 0) return;

    const zone = THREE.MathUtils.clamp(
      (angle - softAngle) / Math.max(maxAngle - softAngle, 1e-5), 0, 1,
    );
    const retained = THREE.MathUtils.lerp(0.62, 0.0, zone);
    this.setRelativeAngularSpeed(
      parent, child, axisWorld, outwardSpeed * retained * sign, 3.8,
    );
  }

  private setRelativeAngularSpeed(
    parent: RagdollBody,
    child: RagdollBody,
    axisWorld: THREE.Vector3,
    targetRelativeSpeed: number,
    maxVelocityChange: number,
  ): void {
    const parentRaw = parent.body.angvel();
    const childRaw = child.body.angvel();
    this.tempAngularA.set(parentRaw.x, parentRaw.y, parentRaw.z);
    this.tempAngularB.set(childRaw.x, childRaw.y, childRaw.z);
    const parentAlong = this.tempAngularA.dot(axisWorld);
    const childAlong = this.tempAngularB.dot(axisWorld);
    const current = childAlong - parentAlong;
    if (Math.abs(current) < 1e-6) return;

    // Never cross through zero or request a larger relative speed. This makes
    // the operation a brake, not a hidden motor.
    let target = targetRelativeSpeed;
    if (current * target < 0) target = 0;
    if (Math.abs(target) > Math.abs(current)) target = current;
    const requestedChange = THREE.MathUtils.clamp(
      target - current, -maxVelocityChange, maxVelocityChange,
    );
    const limitedTarget = current + requestedChange;
    if (Math.abs(limitedTarget - current) < 1e-6) return;

    // Equal velocity changes are not a brake for unequal inertias: the light
    // limb's spin was transferred to the much heavier torso, adding energy and
    // angular momentum. Solve an equal/opposite torque impulse with the full
    // world-space inverse inertia tensors instead. This conserves momentum and
    // can only remove relative rotational energy, including on tilted bodies.
    const inverseInertia = inverseAngularInertiaAlong(parent.body, axisWorld)
      + inverseAngularInertiaAlong(child.body, axisWorld);
    if (!Number.isFinite(inverseInertia) || inverseInertia <= 1e-8) return;
    const impulse = (limitedTarget - current) / inverseInertia;
    const torque = { x: axisWorld.x * impulse, y: axisWorld.y * impulse, z: axisWorld.z * impulse };
    child.body.applyTorqueImpulse(torque, false);
    parent.body.applyTorqueImpulse({ x: -torque.x, y: -torque.y, z: -torque.z }, false);
  }

  private applyFinalSupportRelease(delta: number): void {
    if (this.quietStart) return;
    const core = this.bodies.get('core');
    if (!core?.body.isValid()) return;

    const bodyYs: number[] = [];
    let maxLinearSpeed = 0;
    for (const ragdollBody of this.bodies.values()) {
      if (!ragdollBody.body.isValid()) continue;
      bodyYs.push(ragdollBody.body.translation().y);
      const velocity = ragdollBody.body.linvel();
      maxLinearSpeed = Math.max(maxLinearSpeed, Math.hypot(velocity.x, velocity.y, velocity.z));
    }

    const corePosition = core.body.translation();
    const coreLinear = core.body.linvel();
    const coreAngular = core.body.angvel();
    const head = this.bodies.get('head');
    const readY = (id: string): number => this.bodies.get(id)?.body.translation().y ?? Number.NaN;
    const knockoutAge = this.elapsed - this.combatKnockoutStartedAt;
    const earlyKnockout = this.combatKnockoutCurl > 0 && knockoutAge >= .55
      && this.fatalFallImpactElapsed < 0;
    let requested = ragdollFinalSupportRelease({
      // A KO's brief muscle contraction has already ended. Its dead arms must
      // not act as crutches for another second before grip starts to release.
      elapsed: this.elapsed + (earlyKnockout ? 1 : 0),
      coreY: corePosition.y,
      headY: head?.body.translation().y ?? Number.NaN,
      forearmYs: [readY('left-forearm'), readY('right-forearm')],
      lowerLegYs: [readY('left-lower-leg'), readY('right-lower-leg')],
      allBodyYs: bodyYs,
      coreLinearSpeed: Math.hypot(coreLinear.x, coreLinear.y, coreLinear.z),
      coreAngularSpeed: Math.hypot(coreAngular.x, coreAngular.y, coreAngular.z),
      maxLinearSpeed,
    });
    if (earlyKnockout && head && Math.hypot(coreLinear.x, coreLinear.y, coreLinear.z) < .72
      && Math.hypot(coreAngular.x, coreAngular.y, coreAngular.z) < 1.05 && maxLinearSpeed < 1.22) {
      // The pelvis can already be low while bent elbows hold the rib cage up.
      // The generic pelvis/limb detector misses this partially seated bridge.
      const lowest = Math.min(...bodyYs);
      const headY = head.body.translation().y;
      const torsoRaise = THREE.MathUtils.smoothstep(headY - corePosition.y, .34, .58);
      const bodySpan = THREE.MathUtils.smoothstep(headY - lowest, .48, .85);
      requested = Math.max(requested, .70 * torsoRaise * bodySpan);
    }

    if (requested >= FINAL_SETTLE_RELEASE_THRESHOLD) {
      this.finalSettleReleaseHold = FINAL_SETTLE_HOLD_SECONDS;
      this.finalSettleReleaseStrength = Math.max(this.finalSettleReleaseStrength, requested);
    } else if (this.finalSettleReleaseHold > 0) {
      this.finalSettleReleaseHold = Math.max(0, this.finalSettleReleaseHold - delta);
      // Once an absurd equilibrium has broken, keep the low-grip/extra-core-
      // weight state briefly while the body actually slides off the support.
      // Otherwise the first centimetre of motion can restore full friction and
      // catch the same stair edge again immediately.
      this.finalSettleReleaseStrength = Math.max(0.38, this.finalSettleReleaseStrength * Math.exp(-delta * 0.9));
    } else {
      this.finalSettleReleaseStrength *= Math.exp(-delta * 5.2);
      if (this.finalSettleReleaseStrength < 0.015) this.finalSettleReleaseStrength = 0;
    }

    const strength = THREE.MathUtils.clamp(this.finalSettleReleaseStrength, 0, 1);
    core.body.setGravityScale(
      THREE.MathUtils.lerp(RAGDOLL_GRAVITY_SCALE, FINAL_SETTLE_CORE_GRAVITY_SCALE, strength),
      strength > 0.02,
    );

    const applyLimbFriction = (ragdollBody: RagdollBody): void => {
      const isArm = ragdollBody.id.includes('arm') || ragdollBody.id.includes('forearm');
      const isLeg = ragdollBody.id.includes('leg');
      if (!isArm && !isLeg) return;
      const base = isArm ? 0.64 : 0.78;
      const released = isArm ? FINAL_SETTLE_ARM_FRICTION : FINAL_SETTLE_LEG_FRICTION;
      const friction = THREE.MathUtils.lerp(base, released, strength);
      for (const collider of ragdollBody.colliders) collider.setFriction(friction);
    };
    for (const ragdollBody of this.bodies.values()) applyLimbFriction(ragdollBody);

    if (strength > 0.02) {
      // Do not pose or rotate anything. Waking the heavy core is enough for the
      // altered weight/friction balance to be solved by Rapier itself. This is
      // specifically what lets a pelvis hanging below stair-caught legs keep
      // descending instead of being accepted as a sleeping corpse.
      core.body.wakeUp();
    }
  }

  private applyFinalPoseRelaxation(delta: number): void {
    if (this.quietStart) return;
    const core = this.bodies.get('core');
    const head = this.bodies.get('head');
    const leftUpperLeg = this.bodies.get('left-upper-leg');
    const rightUpperLeg = this.bodies.get('right-upper-leg');
    const leftLowerLeg = this.bodies.get('left-lower-leg');
    const rightLowerLeg = this.bodies.get('right-lower-leg');
    if (!core?.body.isValid() || !head?.body.isValid()) return;

    let maxLinearSpeed = 0;
    for (const ragdollBody of this.bodies.values()) {
      if (!ragdollBody.body.isValid()) continue;
      const velocity = ragdollBody.body.linvel();
      maxLinearSpeed = Math.max(maxLinearSpeed, Math.hypot(velocity.x, velocity.y, velocity.z));
    }
    const coreLinear = core.body.linvel();
    const coreAngular = core.body.angvel();
    const coreLinearSpeed = Math.hypot(coreLinear.x, coreLinear.y, coreLinear.z);
    const coreAngularSpeed = Math.hypot(coreAngular.x, coreAngular.y, coreAngular.z);
    const relaxation = ragdollFinalRelaxationEnvelope({
      elapsed: this.elapsed,
      coreLinearSpeed,
      coreAngularSpeed,
      maxLinearSpeed,
    });

    // A fresh impact always wins. Late relaxation must disappear immediately
    // instead of fighting a body that has started moving again.
    if (maxLinearSpeed > 0.96 || coreLinearSpeed > 0.52 || coreAngularSpeed > 0.86) {
      this.finalHeadRelaxHold = 0;
      this.finalLegClosureStrength = 0;
    }

    const coreRotation = bodyRotation(core.body, this.tempQuaternionA);
    const corePosition = bodyPosition(core.body, this.tempPositionA);
    const headPosition = bodyPosition(head.body, this.tempPositionB);
    const neckAnchorWorld = this.tempPositionC
      .copy(this.finalNeckAnchorCoreLocal)
      .applyQuaternion(coreRotation)
      .add(corePosition);
    const neckToHead = this.tempY.copy(headPosition).sub(neckAnchorWorld);
    const neckLength = neckToHead.length();
    const gravityLever = neckLength > 1e-5
      ? THREE.MathUtils.clamp(1 - Math.abs(neckToHead.y / neckLength), 0, 1)
      : 0;
    const headDroopNeed = relaxation
      * THREE.MathUtils.smoothstep(gravityLever, 0.22, 0.84);

    if (!this.finalHeadRelaxTriggered && headDroopNeed > 0.14) {
      this.finalHeadRelaxTriggered = true;
      this.finalHeadRelaxHold = FINAL_RELAX_HEAD_HOLD_SECONDS;
    }
    if (this.finalHeadRelaxHold > 0) {
      this.finalHeadRelaxHold = Math.max(0, this.finalHeadRelaxHold - delta);
      // This is not a target pose. We simply let the real head weight win for
      // half a second by reducing neck/skull angular damping and slightly
      // increasing gravity. When the skull reaches the floor, contacts decide
      // the final angle exactly as they would on a fully passive body.
      head.body.wakeUp();
      core.body.wakeUp();
    }
    const heldHeadRelax = this.finalHeadRelaxHold > 0 ? 0.42 : 0;
    const effectiveHeadRelax = Math.max(headDroopNeed, heldHeadRelax);
    head.body.setGravityScale(
      THREE.MathUtils.lerp(RAGDOLL_GRAVITY_SCALE, FINAL_RELAX_HEAD_GRAVITY_SCALE, effectiveHeadRelax),
      false,
    );
    head.body.setAngularDamping(
      THREE.MathUtils.lerp(BASE_ANGULAR_DAMPING, FINAL_RELAX_HEAD_ANGULAR_DAMPING, effectiveHeadRelax),
    );

    this.finalLegClosureStrength = 0;
    if (!leftUpperLeg?.body.isValid() || !rightUpperLeg?.body.isValid() || relaxation <= 0) return;
    // A support-release (body hanging from stairs/limbs) has priority. The leg
    // closure is only for an otherwise calm body already reaching its final pose.
    if (this.finalSettleReleaseStrength > 0.08 || this.finalSettleReleaseHold > 0) return;

    const coreForward = this.tempZ.copy(Z_AXIS).applyQuaternion(coreRotation).normalize();
    const leftPosition = bodyPosition(leftUpperLeg.body, this.tempPositionB);
    const rightPosition = bodyPosition(rightUpperLeg.body, this.tempPositionC);
    const leftForwardOffset = leftPosition.sub(corePosition).dot(coreForward);
    const rightForwardOffset = rightPosition.sub(corePosition).dot(coreForward);
    const leftLowerForwardOffset = leftLowerLeg?.body.isValid()
      ? bodyPosition(leftLowerLeg.body, this.tempPositionD).sub(corePosition).dot(coreForward)
      : leftForwardOffset;
    const rightLowerForwardOffset = rightLowerLeg?.body.isValid()
      ? bodyPosition(rightLowerLeg.body, this.tempPositionE).sub(corePosition).dot(coreForward)
      : rightForwardOffset;
    const closure = ragdollLegScissorClosure(
      leftForwardOffset,
      rightForwardOffset,
      leftLowerForwardOffset,
      rightLowerForwardOffset,
      relaxation,
    );
    this.finalLegClosureStrength = closure.strength;
    if (closure.strength <= 0.02) return;

    const coreRight = this.tempX.copy(X_AXIS).applyQuaternion(coreRotation).normalize();
    this.driveLateHipClosure(core, leftUpperLeg, coreRight, closure.leftAngularSpeed, delta);
    this.driveLateHipClosure(core, rightUpperLeg, coreRight, closure.rightAngularSpeed, delta);

    // A little less carpet/stair grip is enough for the feet to follow the hip
    // relaxation rather than pinning an extreme split forever. It is still much
    // grippier than the anti-perch release used for a genuinely hanging corpse.
    const legFriction = THREE.MathUtils.lerp(0.78, FINAL_RELAX_LEG_FRICTION, closure.strength);
    for (const leg of [leftUpperLeg, rightUpperLeg, leftLowerLeg, rightLowerLeg]) {
      if (!leg) continue;
      for (const collider of leg.colliders) collider.setFriction(legFriction);
    }

    if (closure.strength > 0.07) {
      core.body.wakeUp();
      leftUpperLeg.body.wakeUp();
      rightUpperLeg.body.wakeUp();
      leftLowerLeg?.body.wakeUp();
      rightLowerLeg?.body.wakeUp();
    }
  }

  private driveLateHipClosure(
    core: RagdollBody,
    thigh: RagdollBody,
    axisWorld: THREE.Vector3,
    targetRelativeSpeed: number,
    delta: number,
  ): void {
    const coreRaw = core.body.angvel();
    const thighRaw = thigh.body.angvel();
    this.tempAngularA.set(coreRaw.x, coreRaw.y, coreRaw.z);
    this.tempAngularB.set(thighRaw.x, thighRaw.y, thighRaw.z);
    const currentRelative = this.tempAngularB.dot(axisWorld) - this.tempAngularA.dot(axisWorld);
    const requestedChange = THREE.MathUtils.clamp(
      targetRelativeSpeed - currentRelative,
      -FINAL_RELAX_HIP_ACCELERATION * delta,
      FINAL_RELAX_HIP_ACCELERATION * delta,
    );
    if (Math.abs(requestedChange) < 1e-5) return;

    // The core is much heavier than one thigh. Give it only a small reaction
    // share so the correction reads as two relaxed hips, not a torso twist.
    this.tempAngularA.addScaledVector(axisWorld, -requestedChange * 0.14);
    this.tempAngularB.addScaledVector(axisWorld, requestedChange * 0.86);
    core.body.setAngvel(
      { x: this.tempAngularA.x, y: this.tempAngularA.y, z: this.tempAngularA.z }, false,
    );
    thigh.body.setAngvel(
      { x: this.tempAngularB.x, y: this.tempAngularB.y, z: this.tempAngularB.z }, false,
    );
  }

  private applyFatalFallSettling(): void {
    if (this.fatalFallImpactElapsed < 0) return;

    const time = this.fatalFallImpactElapsed;
    const dampingT = THREE.MathUtils.clamp(
      (time - FATAL_FALL_DAMPING_DELAY_SECONDS) / FATAL_FALL_DAMPING_RAMP_SECONDS,
      0,
      1,
    );
    // Stronger impacts get slightly more rotational damping, but the ramp starts
    // only after contacts have had time to fold the body onto the floor. This is
    // damping, not a velocity zero: the corpse can still roll/slide as required.
    const impactBias = 0.82 + this.fatalFallImpactStrength * 0.18;
    const linearDamping = THREE.MathUtils.lerp(
      BASE_LINEAR_DAMPING,
      FATAL_FALL_LINEAR_DAMPING * impactBias,
      dampingT,
    );
    const angularDamping = THREE.MathUtils.lerp(
      BASE_ANGULAR_DAMPING,
      FATAL_FALL_ANGULAR_DAMPING * impactBias,
      dampingT,
    );

    // Apply impact damping only to the real anatomical rigid bodies. The
    // auxiliary zero-gravity joint-frame bodies are constraint carriers; heavy
    // damping on those internal frames can behave like a hidden drag anchor and
    // visually recreate the exact "rotate around one point" failure.
    for (const ragdollBody of this.bodies.values()) {
      const body = ragdollBody.body;
      if (!body.isValid()) continue;
      body.setLinearDamping(linearDamping);
      body.setAngularDamping(angularDamping);
      if (time <= FATAL_FALL_AWAKE_GRACE_SECONDS) body.wakeUp();
    }
  }

  private resetGroundRestAfterImpact(): void {
    this.groundRestHold = 0;
    this.groundRestCandidate = false;
    this.lastExternalImpactAt = this.elapsed;
  }

  /** Real floor/step contacts, including the offset rib-cage collider.
   * Walls, ceilings and other limbs are not fixed support. */
  private fixedSupportHeight(part: RagdollBody): number | null {
    let height: number | null = null;
    for (const collider of part.colliders) {
      this.physics.world.contactPairsWith(collider, other => {
        if (!other.parent()?.isFixed() || other.isSensor()) return;
        this.physics.world.contactPair(collider, other, (manifold, flipped) => {
          const upwardNormal = manifold.normal().y * (flipped ? 1 : -1);
          if (upwardNormal < 0.56) return;
          for (let index = 0; index < manifold.numSolverContacts(); index += 1) {
            if (manifold.solverContactDist(index) > 0.025) continue;
            const y = manifold.solverContactPoint(index).y;
            height = height === null ? y : Math.min(height, y);
          }
        });
      });
    }
    return height;
  }

  private coreCloseToFixedSupport(core: RagdollBody): boolean {
    // A horizontal torso may rest on its elbows or thigh rather than touch the
    // floor itself. Allow that small anatomical clearance only when three other
    // parts have real fixed contacts. Sample both pelvis AND rib cage, since a
    // pelvis-only ray misses a body spanning several stair treads.
    return core.colliders.some(collider => {
      const position = collider.translation();
      const hit = this.physics.world.castRayAndGetNormal(new RAPIER.Ray(
        { x: position.x, y: position.y + 0.018, z: position.z },
        { x: 0, y: -1, z: 0 },
      ), 0.46, true, RAPIER.QueryFilterFlags.ONLY_FIXED);
      return !!hit && hit.normal.y >= 0.56;
    });
  }

  private updateGroundTerminalRest(delta: number): boolean {
    if (delta <= 0 || this.settled) return this.settled;
    if (this.fatalFallImpactElapsed < 0 && this.elapsed < MIN_SETTLE_TIME) return false;

    const parts = [...this.bodies.values()].filter((part) => part.body.isValid());
    if (parts.length < 3) {
      this.groundRestHold = 0;
      this.groundRestCandidate = false;
      return false;
    }

    const center = this.tempPositionA.set(0, 0, 0);
    const meanVelocity = this.tempPositionB.set(0, 0, 0);
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxLinearSpeed = 0;
    let maxAngularSpeed = 0;
    let maxAbsVerticalSpeed = 0;
    let totalMass = 0;

    for (const part of parts) {
      const position = part.body.worldCom();
      const linear = part.body.linvel();
      const angular = part.body.angvel();
      const mass = part.body.mass();
      totalMass += mass;
      center.addScaledVector(this.tempPositionC.set(position.x, position.y, position.z), mass);
      meanVelocity.addScaledVector(this.tempPositionD.set(linear.x, linear.y, linear.z), mass);
      minY = Math.min(minY, position.y);
      maxY = Math.max(maxY, position.y);
      maxLinearSpeed = Math.max(maxLinearSpeed, Math.hypot(linear.x, linear.y, linear.z));
      maxAngularSpeed = Math.max(maxAngularSpeed, Math.hypot(angular.x, angular.y, angular.z));
      maxAbsVerticalSpeed = Math.max(maxAbsVerticalSpeed, Math.abs(linear.y));
    }
    if (totalMass <= 1e-6) return false;
    center.multiplyScalar(1 / totalMass);
    meanVelocity.multiplyScalar(1 / totalMass);

    // Coherent angular velocity is used only as a detector. Unlike the removed
    // anti-orbit pass, this never rewrites per-part velocities while the body is
    // still moving: joints and contacts remain fully authoritative until rest.
    const coherentOmega = this.tempAngularC.set(0, 0, 0);
    let radiusSquaredSum = 0;
    for (const part of parts) {
      const position = part.body.worldCom();
      const velocity = part.body.linvel();
      const radius = this.tempPositionC.set(position.x, position.y, position.z).sub(center);
      const relativeVelocity = this.tempPositionD
        .set(velocity.x, velocity.y, velocity.z)
        .sub(meanVelocity);
      const mass = part.body.mass();
      coherentOmega.addScaledVector(this.tempPositionE.crossVectors(radius, relativeVelocity), mass);
      radiusSquaredSum += radius.lengthSq() * mass;
    }
    if (radiusSquaredSum > 1e-5) coherentOmega.multiplyScalar(1 / radiusSquaredSum);
    else coherentOmega.set(0, 0, 0);

    let supportCount = 0;
    let coreSupported = false;
    let lowestSupport = Infinity;
    let highestSupport = -Infinity;
    for (const part of parts) {
      const supportHeight = this.fixedSupportHeight(part);
      if (supportHeight === null) continue;
      supportCount += 1;
      lowestSupport = Math.min(lowestSupport, supportHeight);
      highestSupport = Math.max(highestSupport, supportHeight);
      if (part.id === 'core') coreSupported = true;
    }

    const core = this.bodies.get('core');
    const coreUprightness = core?.body.isValid()
      ? Math.abs(this.tempY.copy(this.finalNeckAnchorCoreLocal).normalize()
        .applyQuaternion(bodyRotation(core.body, this.tempQuaternionA)).y)
      : 1;
    if (!coreSupported && supportCount >= 3 && core?.body.isValid()) {
      coreSupported = this.coreCloseToFixedSupport(core);
    }
    const eligible = ragdollTerminalRestEligible({
      elapsedSinceImpact: Math.min(
        this.fatalFallImpactElapsed >= 0 ? this.fatalFallImpactElapsed : this.elapsed,
        this.elapsed - this.lastExternalImpactAt,
      ),
      coreSupported,
      supportCount,
      coreUprightness,
      supportHeightSpan: supportCount > 0 ? highestSupport - lowestSupport : 0,
      verticalSpan: Math.max(0, maxY - minY),
      meanHorizontalSpeed: Math.hypot(meanVelocity.x, meanVelocity.z),
      meanVerticalSpeed: meanVelocity.y,
      maxAbsVerticalSpeed,
      maxLinearSpeed,
      maxAngularSpeed,
      coherentAngularSpeed: coherentOmega.length(),
    });

    if (!eligible) {
      // Drop the hold quickly if any limb starts falling again. This is the key
      // protection against the old "freeze before the body reaches the floor"
      // failure: support + low vertical motion must be continuous.
      this.groundRestHold = 0;
      this.groundRestCandidate = false;
      return false;
    }

    if (!this.groundRestCandidate) {
      // Once already down, late anti-perch/hip/head helpers must not wake the
      // body during its rest hold. A new fall or external impulse cancels this
      // candidate and returns full control to the dynamic solver.
      this.groundRestCandidate = true;
      this.restoreFinalSupportRelease();
      this.restoreFinalPoseRelaxation();
      this.finalHeadRelaxTriggered = true;
    }
    this.groundRestHold += delta;
    if (this.groundRestHold < FATAL_FALL_TERMINAL_REST_HOLD_SECONDS) return false;

    // The corpse is now demonstrably down. Put the entire articulated solver
    // island to sleep in one operation so no joint-frame or distal limb remains
    // awake and starts the late spiral again. Zeroing happens only at this final
    // validated rest point, never during the actual collapse.
    for (const body of this.ownedBodies) {
      if (!body.isValid()) continue;
      body.setLinvel({ x: 0, y: 0, z: 0 }, false);
      body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    }
    for (const body of this.ownedBodies) {
      if (body.isValid()) body.sleep();
    }
    for (const part of parts) {
      part.lastLinearSpeed = 0;
      part.lastAngularSpeed = 0;
      part.preStepVelocity.set(0, 0, 0);
    }
    this.restoreFinalPoseRelaxation();
    this.settled = true;
    return true;
  }

  private restoreFatalFallSupportState(): void {
    if (this.fatalFallSupportRestored) return;
    this.fatalFallSupportRestored = true;
    this.restoreFinalSupportRelease();
  }

  private restoreFinalSupportRelease(): void {
    this.finalSettleReleaseStrength = 0;
    this.finalSettleReleaseHold = 0;

    const core = this.bodies.get('core');
    if (core?.body.isValid()) core.body.setGravityScale(RAGDOLL_GRAVITY_SCALE, false);
    for (const ragdollBody of this.bodies.values()) {
      const isArm = ragdollBody.id.includes('arm') || ragdollBody.id.includes('forearm');
      const isLeg = ragdollBody.id.includes('leg');
      if (!isArm && !isLeg) continue;
      const friction = isArm ? 0.64 : 0.78;
      for (const collider of ragdollBody.colliders) collider.setFriction(friction);
    }
  }

  private restoreFinalPoseRelaxation(): void {
    const head = this.bodies.get('head');
    if (head?.body.isValid()) {
      head.body.setGravityScale(RAGDOLL_GRAVITY_SCALE, false);
      head.body.setAngularDamping(BASE_ANGULAR_DAMPING);
    }
    for (const ragdollBody of this.bodies.values()) {
      const isArm = ragdollBody.id.includes('arm') || ragdollBody.id.includes('forearm');
      const isLeg = ragdollBody.id.includes('leg');
      if (!isArm && !isLeg) continue;
      const friction = isArm ? 0.64 : 0.78;
      for (const collider of ragdollBody.colliders) collider.setFriction(friction);
    }
    this.finalHeadRelaxHold = 0;
    this.finalLegClosureStrength = 0;
  }

  private releaseUnstableBalances(): void {
    if (this.elapsed < 0.32 || this.elapsed > 2.4) return;

    for (const release of this.gravityReleases) {
      if (release.released) continue;
      const parentRotationValue = bodyRotation(release.parent.body, this.tempQuaternionA);
      const parentPositionValue = bodyPosition(release.parent.body, this.tempPositionA);
      const anchorWorld = this.tempPositionB
        .copy(release.parentAnchorLocal)
        .applyQuaternion(parentRotationValue)
        .add(parentPositionValue);
      const childPositionValue = bodyPosition(release.child.body, this.tempPositionC);
      const lever = this.tempY.copy(childPositionValue).sub(anchorWorld);
      const leverLength = lever.length();
      if (leverLength < 1e-5) {
        release.released = true;
        continue;
      }
      const upward = lever.y / leverLength;
      if (release.mode === 'raised') {
        if (upward < 0.58) continue;
      } else {
        // Only intervene when an upper arm is genuinely hanging below the
        // shoulder like a support post. Horizontal/resting arms are untouched.
        if (upward > -0.48) continue;
        if (this.elapsed < 0.58) continue;
      }

      const angular = release.child.body.angvel();
      const linear = release.child.body.linvel();
      if (Math.hypot(angular.x, angular.y, angular.z) > 0.55) continue;
      if (Math.hypot(linear.x, linear.y, linear.z) > 0.8) continue;
      if (release.mode === 'support') {
        const parentAngular = release.parent.body.angvel();
        const parentLinear = release.parent.body.linvel();
        if (Math.hypot(parentAngular.x, parentAngular.y, parentAngular.z) > 0.5) continue;
        if (Math.hypot(parentLinear.x, parentLinear.y, parentLinear.z) > 0.7) continue;
      }

      const axisWorld = this.tempX
        .copy(release.nudgeAxisParentLocal)
        .applyQuaternion(parentRotationValue);
      const leverDirection = lever.multiplyScalar(1 / leverLength);
      axisWorld.addScaledVector(leverDirection, -axisWorld.dot(leverDirection));
      if (axisWorld.lengthSq() < 1e-6) axisWorld.crossVectors(leverDirection, Z_AXIS);
      if (axisWorld.lengthSq() < 1e-6) axisWorld.crossVectors(leverDirection, X_AXIS);
      axisWorld.normalize();

      // Raised limbs need only the old 0.12 rad/s symmetry break. A planted
      // straight arm gets a still-small 0.16 rad/s fold bias: enough to stop it
      // behaving like a load-bearing crutch, but far below a visible kick and
      // still bounded by the same shoulder/elbow hard stops.
      const releaseSpeed = release.mode === 'support'
        ? ARM_SUPPORT_RELEASE_ANGULAR_SPEED
        : 0.12;
      release.child.body.setAngvel({
        x: angular.x + axisWorld.x * releaseSpeed,
        y: angular.y + axisWorld.y * releaseSpeed,
        z: angular.z + axisWorld.z * releaseSpeed,
      }, true);
      release.released = true;
    }
  }

  private updateSettling(): void {
    if (this.elapsed < MIN_SETTLE_TIME) return;
    // A long fall may already have exceeded MIN_SETTLE_TIME before the fatal
    // landing. Give that landing its own grace period so the ragdoll cannot be
    // declared finished on a transient contact/sleep state before it has folded
    // fully onto the ground.
    if (this.fatalFallImpactElapsed >= 0
      && this.fatalFallImpactElapsed < FATAL_FALL_SETTLE_GUARD_SECONDS) return;

    // Never freeze a merely slow pose. That was the source of half-standing
    // corpses: a raised limb could be velocity-damped, then hard-locked before
    // gravity had finished lowering it. Rapier may mark the ragdoll settled only
    // when the complete dynamic island has entered its native sleeping state.
    // No translations/rotations are locked here, so unsupported parts always
    // remain free to continue falling.
    if (!this.ownedBodies.length) return;
    // A corpse being actively released from a limb-supported perch must never
    // be accepted as settled just because Rapier briefly put the island to sleep.
    if (this.finalSettleReleaseStrength > 0.02 || this.finalSettleReleaseHold > 0) return;
    if (this.finalHeadRelaxHold > 0 || this.finalLegClosureStrength > 0.07) return;
    const allSleeping = this.ownedBodies.every((body) => body.isValid() && body.isSleeping());
    if (!allSleeping) return;
    this.restoreFinalPoseRelaxation();
    this.settled = true;
    this.syncSkeleton();
  }

  private applyCoherentFallBias(inheritedVelocity: Readonly<THREE.Vector3>, scale = 1): void {
    const horizontal = this.tempPositionA.set(inheritedVelocity.x, 0, inheritedVelocity.z);
    const horizontalSpeed = horizontal.length();
    let fallDirection: THREE.Vector3;
    if (horizontalSpeed > 0.3) {
      fallDirection = horizontal.normalize().clone();
      const side = this.tempPositionB.set(-fallDirection.z, 0, fallDirection.x);
      fallDirection.addScaledVector(side, (this.random.float() * 2 - 1) * 0.10).normalize();
    } else {
      const angle = this.random.float() * Math.PI * 2;
      fallDirection = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    }

    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const ragdollBody of this.bodies.values()) {
      const y = ragdollBody.body.translation().y;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const verticalSpan = Number.isFinite(minY) && Number.isFinite(maxY) ? maxY - minY : 1.3;
    // Full-body tipping is useful for an idle upright death, but it is harmful
    // for crouch/slide/extreme animation poses already close to the floor.
    const postureFactor = THREE.MathUtils.clamp((verticalSpan - 0.62) / 0.72, 0, 1);
    const airborneFactor = Math.abs(inheritedVelocity.y) > 0.65 ? 0.28 : 1;

    const tipAxis = this.tempPositionB.copy(Y_AXIS).cross(fallDirection).normalize();
    const baseTipSpeed = horizontalSpeed > 0.3
      ? THREE.MathUtils.clamp(0.20 + horizontalSpeed * 0.035, 0.22, 0.48)
      : 0.40 + this.random.float() * 0.07;
    const tipSpeed = baseTipSpeed * postureFactor * airborneFactor * THREE.MathUtils.clamp(scale, 0, 1);
    if (tipSpeed < 0.025) return;
    const omega = this.tempAngularA.copy(tipAxis).multiplyScalar(tipSpeed);

    for (const ragdollBody of this.bodies.values()) {
      const position = bodyPosition(ragdollBody.body, this.tempPositionC);
      const offset = position.clone().sub(this.initialMotionOrigin);
      const deltaVelocity = new THREE.Vector3().crossVectors(omega, offset);
      const linear = ragdollBody.body.linvel();
      ragdollBody.body.setLinvel({
        x: linear.x + deltaVelocity.x,
        y: linear.y + deltaVelocity.y,
        z: linear.z + deltaVelocity.z,
      }, false);
      const angular = ragdollBody.body.angvel();
      ragdollBody.body.setAngvel({
        x: angular.x + omega.x,
        y: angular.y + omega.y,
        z: angular.z + omega.z,
      }, false);
      const finalLinear = ragdollBody.body.linvel();
      const finalAngular = ragdollBody.body.angvel();
      ragdollBody.lastLinearSpeed = Math.hypot(finalLinear.x, finalLinear.y, finalLinear.z);
      ragdollBody.lastAngularSpeed = Math.hypot(finalAngular.x, finalAngular.y, finalAngular.z);
    }
  }

  private applyDeathVariation(target: RagdollBody, strength: number): void {
    const randomDirection = this.tempPositionA.set(
      this.random.float() * 2 - 1,
      this.random.float() * 0.28 - 0.2,
      this.random.float() * 2 - 1,
    ).normalize().multiplyScalar(strength * (0.55 + this.random.float() * 0.45));
    target.body.applyImpulse(
      { x: randomDirection.x, y: randomDirection.y, z: randomDirection.z },
      true,
    );
    target.body.applyTorqueImpulse({
      x: (this.random.float() * 2 - 1) * strength * 0.06,
      y: (this.random.float() * 2 - 1) * strength * 0.04,
      z: (this.random.float() * 2 - 1) * strength * 0.06,
    }, true);
  }

  private segmentDirection(start: THREE.Bone, end: THREE.Bone, target: THREE.Vector3): THREE.Vector3 {
    const startPosition = start.getWorldPosition(this.tempPositionA);
    const endPosition = end.getWorldPosition(this.tempPositionB);
    return target.copy(endPosition).sub(startPosition).normalize();
  }

  private limbHingeFrame(
    upperSegmentDirection: THREE.Vector3,
    characterRight: THREE.Vector3,
    characterForward: THREE.Vector3,
    flexForwardSign: number,
  ): { axis: THREE.Vector3; flexDirection: THREE.Vector3 } {
    const transport = new THREE.Quaternion().setFromUnitVectors(DOWN_AXIS, upperSegmentDirection);
    const axis = characterRight.clone().applyQuaternion(transport);
    axis.addScaledVector(upperSegmentDirection, -axis.dot(upperSegmentDirection));
    if (axis.lengthSq() < 1e-6) {
      axis.copy(characterForward).cross(upperSegmentDirection);
    }
    axis.normalize();

    const flexDirection = characterForward.clone()
      .multiplyScalar(flexForwardSign >= 0 ? 1 : -1)
      .applyQuaternion(transport);
    flexDirection.addScaledVector(upperSegmentDirection, -flexDirection.dot(upperSegmentDirection));
    if (flexDirection.lengthSq() < 1e-6) {
      flexDirection.crossVectors(axis, upperSegmentDirection);
    }
    flexDirection.normalize();
    return { axis, flexDirection };
  }

  private deriveHingeAxis(
    proximalDirection: THREE.Vector3,
    distalDirection: THREE.Vector3,
    fallbackAxis: THREE.Vector3,
  ): THREE.Vector3 {
    const axis = new THREE.Vector3().crossVectors(proximalDirection, distalDirection);
    if (axis.lengthSq() > 1e-5) {
      axis.normalize();
      if (axis.dot(fallbackAxis) < 0) axis.multiplyScalar(-1);
      return axis;
    }

    // Straight limbs do not define a bend plane. Project the anatomical fallback
    // onto the plane perpendicular to the shared long axis so it is a valid local
    // X axis for both capsules.
    const longAxis = proximalDirection.clone().add(distalDirection);
    if (longAxis.lengthSq() < 1e-6) longAxis.copy(proximalDirection);
    longAxis.normalize();
    axis.copy(fallbackAxis).addScaledVector(longAxis, -fallbackAxis.dot(longAxis));
    if (axis.lengthSq() < 1e-6) {
      axis.copy(Math.abs(longAxis.y) < 0.9 ? Y_AXIS : Z_AXIS).cross(longAxis);
    }
    return axis.normalize();
  }

  private signedSegmentBend(
    proximalDirection: THREE.Vector3,
    distalDirection: THREE.Vector3,
    hingeAxis: THREE.Vector3,
  ): number {
    const cross = new THREE.Vector3().crossVectors(proximalDirection, distalDirection);
    return Math.atan2(
      hingeAxis.dot(cross),
      THREE.MathUtils.clamp(proximalDirection.dot(distalDirection), -1, 1),
    );
  }

  private currentHingeFlex(parent: RagdollBody, child: RagdollBody, bendSign: number): number {
    const parentRotationValue = bodyRotation(parent.body, new THREE.Quaternion());
    const childRotationValue = bodyRotation(child.body, new THREE.Quaternion());
    const parentAxis = X_AXIS.clone().applyQuaternion(parentRotationValue).normalize();
    const childAxis = X_AXIS.clone().applyQuaternion(childRotationValue).normalize();
    if (parentAxis.dot(childAxis) < 0) childAxis.multiplyScalar(-1);
    const axis = parentAxis.add(childAxis);
    if (axis.lengthSq() < 1e-8) axis.copy(parentAxis);
    axis.normalize();
    const parentDirection = Y_AXIS.clone().applyQuaternion(parentRotationValue).normalize();
    const childDirection = Y_AXIS.clone().applyQuaternion(childRotationValue).normalize();
    return this.signedSegmentBend(parentDirection, childDirection, axis) * bendSign;
  }

  private preferredBendSign(
    parentDirection: THREE.Vector3,
    hingeAxisWorld: THREE.Vector3,
    desiredDirection: THREE.Vector3,
  ): number {
    const plus = parentDirection.clone().applyAxisAngle(hingeAxisWorld, 0.24);
    const minus = parentDirection.clone().applyAxisAngle(hingeAxisWorld, -0.24);
    return plus.dot(desiredDirection) >= minus.dot(desiredDirection) ? 1 : -1;
  }

  private segmentRotation(
    start: THREE.Vector3,
    end: THREE.Vector3,
    xHintWorld: THREE.Vector3,
    fallbackHintWorld: THREE.Vector3,
  ): THREE.Quaternion {
    const y = this.tempY.copy(end).sub(start).normalize();
    let x = this.tempX.copy(xHintWorld);
    x.addScaledVector(y, -x.dot(y));
    if (x.lengthSq() < 1e-6) {
      x.copy(fallbackHintWorld);
      x.addScaledVector(y, -x.dot(y));
    }
    if (x.lengthSq() < 1e-6) {
      x.copy(Math.abs(y.y) < 0.9 ? Y_AXIS : Z_AXIS);
      x.addScaledVector(y, -x.dot(y));
    }
    x.normalize();
    const z = this.tempZ.crossVectors(x, y).normalize();
    x.crossVectors(y, z).normalize();
    this.tempMatrix.makeBasis(x, y, z);
    return new THREE.Quaternion().setFromRotationMatrix(this.tempMatrix).normalize();
  }

  private worldPointToBodyLocal(body: RagdollBody, worldPoint: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
    const center = bodyPosition(body.body, this.tempPositionC);
    const rotation = bodyRotation(body.body, this.tempQuaternionC).invert();
    return target.copy(worldPoint).sub(center).applyQuaternion(rotation);
  }

  private setBoneWorldPosition(bone: THREE.Bone, worldPosition: THREE.Vector3): void {
    const parent = bone.parent;
    if (!parent) {
      bone.position.copy(worldPosition);
      bone.updateMatrix();
      bone.updateMatrixWorld(true);
      return;
    }
    parent.updateWorldMatrix(true, false);
    bone.position.copy(parent.worldToLocal(worldPosition.clone()));
    bone.updateMatrix();
    bone.updateMatrixWorld(true);
  }

  private setBoneWorldRotation(bone: THREE.Bone, worldRotation: THREE.Quaternion): void {
    const parent = bone.parent;
    if (!parent) {
      bone.quaternion.copy(worldRotation).normalize();
      bone.updateMatrix();
      bone.updateMatrixWorld(true);
      return;
    }
    parent.updateWorldMatrix(true, false);
    const parentRotation = parent.getWorldQuaternion(this.tempQuaternionC).invert();
    bone.quaternion.copy(parentRotation.multiply(worldRotation)).normalize();
    bone.updateMatrix();
    bone.updateMatrixWorld(true);
  }
}
