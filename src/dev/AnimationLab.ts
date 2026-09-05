import * as THREE from 'three';
import { GaitTransition, sampleGaitPhase, alignGaitPhase, createSlideSprintRecoveryClip } from './LocomotionBlend';
import { createCrouchLocomotionClips, CROUCH_LOCOMOTION_IDS, CROUCH_GAIT_REFERENCE_SPEED } from './CrouchLocomotion';
import { advanceStrikeClock, CombatImpactAudio } from './CombatFeel';
import { sweepCombatContact, combatChainReady, CombatBalance, stepCombatSpring } from './CombatContact';
import { solveCombatTwoBone, limitKneeLateralBend, easeCombat, CombatPoseHandoff, CombatMotionHistory, CombatProceduralPose } from './CombatRig';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { formatKeyLabel } from '../input/ControlBindings';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { RagdollSystem, type RagdollAnimationMotion, type RagdollImpactEvent } from '../physics/RagdollSystem';
import { PlayerController, type LandingImpact } from '../player/PlayerController';
import { MOVEMENT_TUNING } from '../player/MovementConfig';
import { BACKROOMS_ATMOSPHERE, BACKROOMS_LEGACY_ATMOSPHERE } from '../render/BackroomsAtmosphere';
import { loadGameSettings } from '../ui/settings';
import type { StaticCollider } from '../world/types';
import { createMovementLabPlan, MOVEMENT_LAB_IDLE_NPC, MOVEMENT_LAB_PITS, MOVEMENT_LAB_SPAWN } from './MovementLabPlan';
import {
  PIT_EDGE_RAGDOLL_THRESHOLD,
  analyzePitEdge,
  integratePitEdgeRisk,
  pitRagdollDamageForDrop,
  type PitEdgeAnalysis,
} from './PitEdgeRagdoll';
import { BloodDecalSystem } from './BloodDecalSystem';
import { BloodImpactGate } from './BloodImpactGate';
import { GetUpRecovery, captureGetUpPoseClip, copyGetUpPose } from './GetUpRecovery';
import { createGetUpMotionClip } from './GetUpMotion';
import { canGetUp, chooseGetUpSide, recoveryReadyForInput, shouldShowGetUpPrompt } from './GetUpRecoveryRules';
import { analyzeCombatStrikeSource, combatStrikeEnvelope, combatStrikeReachEnvelope, createCombatDodgeClip, createCombatLowerClip, createCombatStrikeUpperClip, createCombatUpperClip, createDirectionalLocomotionBlendClip, firstQuaternionForBone, type CombatStrikeSide } from './CombatAnimationLayers';
import {
  CombatHeavyTapDetector,
  MELEE_ATTACKS,
  combatAttackPlaybackRate,
  combatAttackTargetFacingAllowed,
  combatPhysicalContactDamage,
  combatLockOnFacingAllowed,
  combatMeleeSpacingForDistance,
  combatAttackRecoverySeconds,
  combatCounterFacingAllowed,
  combatHookCounterAllowed,
  combatNormalAttackAllowed,
  COMBAT_DODGE_COUNTER_BACK_SPEED,
  COMBAT_DODGE_COUNTER_DURATION_SECONDS,
  COMBAT_DODGE_COUNTER_MOVE_SECONDS,
  COMBAT_DODGE_COUNTER_SIDE_SPEED,
  COMBAT_DODGE_COUNTER_STRIKE_AT_SECONDS,
  COMBAT_MELEE_IDEAL_PUNCH_DISTANCE,
  COMBAT_MELEE_IDEAL_STEP_DISTANCE,
  COMBAT_MELEE_WHIF_FORWARD_METERS,
  COMBAT_MELEE_WHIF_DRIVE_SECONDS,
  hitReactionPlaybackRate,
  npcCounterWindowOpen,
  type CombatHitZone,
  type CombatMeleeSpacing,
  type MeleeAttackKind,
} from './CombatMeleeRules';
import { ForwardLateralAnimationGate, forwardDiagonalAnimation } from './DirectionalLocomotionRules';
import {
  GROUND_KICK_PROFILES,
  groundKickPose,
  groundKickKindForTarget,
  npcGroundRecoveryReady,
  type GroundKickKind,
} from './GroundKickRules';
import {
  COMBAT_HIT_GUARD_LATCH_SECONDS,
  MANUAL_GUARD_MOVEMENT_RELEASE_SECONDS,
  MANUAL_GUARD_RELEASE_SECONDS,
  combatEntryTransition,
  combatExitTransition,
  combatGuardBlocksSprint,
  combatGuardShouldPersist,
  combatLowerSelection,
  combatStrikeLowerSelection,
  combatTorsoCounterYaw,
  type CombatIdleResumeMode,
  type CombatLatchReason,
  type CombatLowerAnimation,
} from './CombatGuardRules';
import {
  bloodDecalSizeForImpact,
  damageVisualState,
  ragdollBodyImpactPart,
  ragdollDropIsFatal,
  ragdollImpactDamage,
  ragdollImpactNeedsBlood,
  ragdollImpactGuaranteesBlood,
  ragdollImpactPrefersBurst,
  type RagdollImpactSurface,
} from './DamageSystem';
import {
  THIRD_PERSON_LOOK_TUNING,
  canResetStrongTurnLatch,
  dampAngleRadians,
  rebaseAngleNear,
  residualLookDegrees,
  strongTurnDirection,
  updateTurnGate,
  wrapAngleRadians,
} from './ThirdPersonLook';
import {
  FIRST_PERSON_BODY_LOOK_TUNING,
  firstPersonIdleTurnCue,
  updateFirstPersonBodyFollow,
} from './FirstPersonLook';
import './AnimationLab.css';

const FIXED_DELTA = 1 / 60;
const MAX_ACCUMULATOR = 0.12;
const ASSET_ROOT = '/assets/animation-lab';
const AVATAR_HEIGHT_METERS = 1.76;
const FIRST_PERSON_VIEWMODEL_STAND_SCALE = 1.22;
const FIRST_PERSON_VIEWMODEL_CROUCH_SCALE = 0.84;
const FIRST_PERSON_VIEWMODEL_SCALE_RESPONSE = 12.0;
const FIRST_PERSON_PELVIS_BEHIND_CAMERA = -0.50;
const FIRST_PERSON_PELVIS_BELOW_CAMERA = 0.46;
const FIRST_PERSON_BODY_CLIP_ABOVE_HIPS = 0.76;
const FIRST_PERSON_LOWER_BODY_MASK_THRESHOLD = 0.28;
const FIRST_PERSON_COMBAT_ARM_MASK_THRESHOLD = 0.19;
const FIRST_PERSON_SOLE_CLEARANCE = 0.018;
const FIRST_PERSON_ARM_SCALE = 0.84;
const FIRST_PERSON_HAND_SCALE = 0.90;
const FIRST_PERSON_COMBAT_ARM_SCALE = 0.97;
const FIRST_PERSON_COMBAT_HAND_SCALE = 1.0;
const FIRST_PERSON_COMBAT_STRIKE_REACH_SCALE = 0.78;
const FIRST_PERSON_COMBAT_COUNTER_REACH_SCALE = 0.74;
// Never solve first-person camera penetration by discarding arm fragments: that
// creates visible holes/"transparent" limbs. Instead the render-only skeleton is
// kept physically in front of the eye with a small dynamic forward safety offset.
const FIRST_PERSON_HAND_SAFE_DEPTH = 0.28;
const FIRST_PERSON_FOREARM_SAFE_DEPTH = 0.29;
const FIRST_PERSON_ARM_SAFETY_MAX_FORWARD = 0.24;
const FIRST_PERSON_ARM_SAFETY_RELEASE_RESPONSE = 15.0;
// Move the render-only combat body farther *in front* of the eye. The previous
// negative offset left one leading fist almost inside the near camera plane.
const FIRST_PERSON_COMBAT_BODY_FORWARD_OFFSET = 0.30;
const FIRST_PERSON_COMBAT_BODY_UP_OFFSET = -0.165;
const FIRST_PERSON_COMBAT_BODY_OFFSET_RESPONSE = 12.0;
const FIRST_PERSON_COMBAT_LATERAL_MAX = 0.32;
const FIRST_PERSON_COMBAT_LATERAL_RESPONSE = 11.0;
// First-person combat is its own presentation layer. While the guard is active,
// sample the Fight Idle pelvis at the upper-body phase instead of inheriting the
// locomotion pelvis. This makes walking/strafe/reverse use the exact same guard
// pose as standing still, with no lateral hand drift and no stop/start snap.
const FIRST_PERSON_COMBAT_ROOT_RELEASE_SECONDS = 0.46;
// Keep the closest fist, not just the midpoint, safely away from the gameplay eye.
const FIRST_PERSON_COMBAT_NEAR_HAND_DEPTH_TARGET = 0.53;
const FIRST_PERSON_COMBAT_DEPTH_MAX_CORRECTION = 0.34;
const FIRST_PERSON_COMBAT_DEPTH_EFFECTIVE_MAX_FORWARD = 0.16;
const FIRST_PERSON_COMBAT_ATTACK_SAFETY_MAX_FORWARD = 0.075;
const FIRST_PERSON_COMBAT_DEPTH_RESPONSE = 9.5;
const FIRST_PERSON_COMBAT_HAND_Y_TARGET = -0.18;
const FIRST_PERSON_COMBAT_VISUAL_ARM_SCALE_BONUS = 0.0;
const FIRST_PERSON_COMBAT_VISUAL_HAND_SCALE_BONUS = 0.0;
const FIRST_PERSON_COMBAT_VISUAL_BODY_FORWARD_EXTRA = 0.0;
const FIRST_PERSON_COMBAT_VISUAL_BODY_UP_EXTRA = -0.055;
const FIRST_PERSON_COMBAT_VISUAL_NEAR_HAND_DEPTH_EXTRA = 0.0;
const FIRST_PERSON_COMBAT_VISUAL_HAND_Y_EXTRA = 0.06;
const FIRST_PERSON_COMBAT_VERTICAL_MAX_CORRECTION = 0.20;
const FIRST_PERSON_COMBAT_VERTICAL_RESPONSE = 10.0;
const FIRST_PERSON_COMBAT_FRAMING_SETTLE_SECONDS = 0.26;
const FIRST_PERSON_GUARD_WRIST_DEPTH = 0.36;
const FIRST_PERSON_GUARD_WRIST_LATERAL = 0.24;
const FIRST_PERSON_GUARD_WRIST_DROP = 0.22;
const FIRST_PERSON_COMBAT_PUNCH_FORWARD_PRESENTATION_SCALE = 0.22;
const COMBAT_STRIKE_AIM_CORRECTION_MAX = THREE.MathUtils.degToRad(38);
const COMBAT_STRIKE_AIM_CORRECTION_RESPONSE = 1.0;
const COMBAT_STRIKE_TORSO_AIM_SHARE = 0.34;
// Strikes should read as punches, not waist bends. The old 14-17.5° pitch made
// the avatar fold toward the floor while the fist barely travelled. Keep only a
// small shoulder-led commitment; the arm chain now does the actual target work.
const COMBAT_STRIKE_BODY_LEAN_NORMAL = THREE.MathUtils.degToRad(4.5);
const COMBAT_STRIKE_BODY_LEAN_HEAVY = THREE.MathUtils.degToRad(6.5);
const COMBAT_DODGE_THIRD_PERSON_ROLL = THREE.MathUtils.degToRad(11.5);
const COMBAT_DODGE_THIRD_PERSON_YAW = THREE.MathUtils.degToRad(8.0);
const COMBAT_DODGE_THIRD_PERSON_LEG_LOAD = THREE.MathUtils.degToRad(7.0);
const COMBAT_DODGE_THIRD_PERSON_COUNTER_TWIST = THREE.MathUtils.degToRad(10.0);
const COMBAT_DODGE_THIRD_PERSON_COUNTER_DRIVE = THREE.MathUtils.degToRad(5.5);
const COMBAT_COMPLETED_STRIKE_RANGE_PAD = 0.30;
const COMBAT_COMPLETED_STRIKE_MIN_FORWARD_DOT = 0.45;
const GROUND_KICK_MAX_START_YAW_ERROR = THREE.MathUtils.degToRad(50);
const GROUND_KICK_MAX_ROOT_TURN = THREE.MathUtils.degToRad(22);
const GROUND_KICK_ROOT_TURN_END_FRACTION = 0.24;
const COMBAT_LOCK_ON_MAX_DISTANCE = 6.25;
const COMBAT_LOCK_ON_LOS_HEAD_HEIGHT = 1.28;
const COMBAT_LOCK_ON_RESPONSE = 13.5;
const COMBAT_LOCK_ON_MAX_DEGREES_PER_SECOND = 255;
const COMBAT_ATTACK_LUNGE_MIN_DISTANCE = 0.92;
const COMBAT_ATTACK_LUNGE_MAX_DISTANCE = 2.45;
const COMBAT_GUARD_MOVE_SPEED_SCALE = 0.84;
const COMBAT_LOWER_IDLE_CROSSFADE_SECONDS = 0.42;
const COMBAT_LOWER_DIRECTION_CROSSFADE_SECONDS = 0.16;
// Strike footwork is allowed to pass through the gait it came from. A slightly
// longer directional crossfade preserves step phase while the physical drive
// curves into the punch, instead of snapping strafe/backpedal legs to forward.
const COMBAT_LOWER_STRIKE_CROSSFADE_SECONDS = 0.12;
const COMBAT_ATTACK_CHAIN_BLEND_SECONDS = 0.105;
// One short input buffer keeps rapid LMB mashing responsive without spawning
// impossible overlapping attacks. A click made during anticipation/contact is
// remembered until the current fist reaches its visible recoil chain window.
const COMBAT_PUNCH_INPUT_BUFFER_SECONDS = 0.32;
const COMBAT_PUNCH_BUFFER_CHAIN_MARGIN = 0.018;
// Repeated confirmed contacts must never disappear inside an already-playing
// reaction. Two quick hits retrigger a different reaction; the third committed
// hit (or a heavy re-hit) hands the accumulated momentum to ragdoll.
const NPC_REHIT_COMBO_RESET_SECONDS = 0.95;
const NPC_REHIT_RAGDOLL_HIT_COUNT = 3;
const PLAYER_REHIT_COMBO_RESET_SECONDS = NPC_REHIT_COMBO_RESET_SECONDS;
const PLAYER_REHIT_RAGDOLL_HIT_COUNT = NPC_REHIT_RAGDOLL_HIT_COUNT;
const NPC_COMBO_MAX_CHAIN = 3;
const NPC_COMBO_REQUEUE_MIN_DISTANCE = 0.48;
const NPC_COMBO_REQUEUE_MAX_DISTANCE = 2.34;
const COMBAT_GUARD_SPRINT_EXIT_BLEND_SECONDS = 0.26;
const COMBAT_GUARD_MOVE_RELEASE_BLEND_SECONDS = 0.14;
// Gameplay guard still releases after the 0.3 s movement grace, but the fists
// keep a separate upper-body fade so they lower naturally instead of collapsing
// in a tenth of a second while the legs resume ordinary locomotion.
const COMBAT_GUARD_MOVE_UPPER_RELEASE_BLEND_SECONDS = 0.38;
// When a moving guard drops, do not jump straight from the guarded walk cap to
// full sprint. Hold the guarded pace briefly, then release it smoothly.
const COMBAT_POST_GUARD_MOVE_HOLD_SECONDS = 0.26;
const COMBAT_POST_GUARD_MOVE_RECOVER_SECONDS = 0.24;
const COMBAT_POST_GUARD_MOVE_TOTAL_SECONDS = COMBAT_POST_GUARD_MOVE_HOLD_SECONDS + COMBAT_POST_GUARD_MOVE_RECOVER_SECONDS;
const FIRST_PERSON_SPRINT_ARM_SCALE = 0.72;
const FIRST_PERSON_SPRINT_HAND_SCALE = 0.86;
const FIRST_PERSON_ARM_SCALE_RESPONSE = 16.0;
const FIRST_PERSON_FREELOOK_RECENTER_FRACTION = 0.22;
const FIRST_PERSON_FREELOOK_RECENTER_MAX = 0.085;
const FIRST_PERSON_FREELOOK_RECENTER_RESPONSE = 12.0;
// Never move the gameplay camera for an animation. Action Idle instead shifts
// only the dedicated 1P render body, preserving the same camera/body relation
// as the desired right-side POV while the PlayerController eye stays exact.
// Keep only a tiny lateral correction: the authored Action Idle pose still needs a little room,
// but the eye/body relation should read centered rather than sitting on the avatar's flank.
const FIRST_PERSON_ACTION_IDLE_BODY_RIGHT_OFFSET = 0.05;
const FIRST_PERSON_ACTION_IDLE_BODY_FORWARD_OFFSET = -0.055;
const FIRST_PERSON_ACTION_IDLE_BODY_OFFSET_RESPONSE = 12.0;
const FIRST_PERSON_FOOT_LOCK_MAX_CORRECTION = 0.035;
const FIRST_PERSON_HIGH_FALL_FORWARD_PITCH = THREE.MathUtils.degToRad(38);
const FIRST_PERSON_HIGH_FALL_RESPONSE = 5.0;
const FIRST_PERSON_HIGH_FALL_PELVIS_BEHIND_CAMERA = -0.34;
const FIRST_PERSON_HIGH_FALL_PELVIS_BELOW_CAMERA = 0.27;
const FIRST_PERSON_DOWNED_PELVIS_BELOW_CAMERA = -0.04;
const UP = new THREE.Vector3(0, 1, 0);
const RESPAWN_DELAY_SECONDS = 5;
// Keep the post-mortem 1P camera physically outside the skull. The previous
// 16 cm offset was close enough that a fast head rotation could let the face
// cross the smoothed camera position for one or two frames.
const DEAD_CAMERA_FACE_FORWARD = 0.27;
const DEAD_CAMERA_FACE_UP = 0.075;
const DEAD_CAMERA_FACE_SAFE_FORWARD = 0.225;
const DEAD_CAMERA_NEAR_CLIP = 0.04;
const PLAYER_RESPAWN_CENTER_Y = 0.865;
const MAX_HEALTH = 100;
const HEALTH_REGEN_DELAY_SECONDS = 5.5;
const HEALTH_REGEN_PER_SECOND = 5.0;
const DAMAGE_OVERLAY_DECAY = 2.7;
const FIRST_PERSON_MELEE_HIT_KICK_SECONDS = 0.24;
const FIRST_PERSON_MELEE_HIT_BLOOD_DECAY = 8.2;
const FIRST_PERSON_MELEE_HIT_MAX_YAW = THREE.MathUtils.degToRad(4.6);
const FIRST_PERSON_MELEE_HIT_MAX_PITCH = THREE.MathUtils.degToRad(5.4);
const FIRST_PERSON_MELEE_HIT_MAX_ROLL = THREE.MathUtils.degToRad(3.4);
const IDLE_ACTION_WAIT_DELAY_SECONDS = 2.5;
const IDLE_SLEEPING_LOOK_INTERVAL_SECONDS = 5.0;
const IDLE_TO_STANDING_RATE = 0.72;
const RAGDOLL_LANDING_RECOVERY_BLEND_THRESHOLD = 0.34;
const RAGDOLL_LANDING_DAMAGE_THRESHOLD = 12;

const ANIMATIONS = [
  { id: 'idle', label: 'Idle · sleeping', file: 'idle.fbx' },
  { id: 'idle-action', label: 'Idle · action', file: 'idle-action.fbx' },
  { id: 'idle-looking', label: 'Idle · looking', file: 'looking.fbx' },
  { id: 'idle-looking-down', label: 'Idle · looking down', file: 'looking-down.fbx' },
  { id: 'idle-looking-behind', label: 'Idle · looking behind', file: 'looking-behind.fbx' },
  { id: 'idle-wait-1', label: 'Idle · wait 1', file: 'idle-action-wait-1.fbx' },
  { id: 'idle-wait-2', label: 'Idle · wait 2', file: 'idle-action-wait-2.fbx' },
  { id: 'idle-action-to-standing-idle', label: 'Action idle → sleeping idle', file: 'idle-action-to-standing-idle.fbx' },
  { id: 'walking', label: 'Walking', file: 'walking.fbx' },
  { id: 'running', label: 'Running', file: 'running.fbx' },
  { id: 'left-strafe-walking', label: 'Strafe gauche · walk', file: 'left-strafe-walking.fbx' },
  { id: 'right-strafe-walking', label: 'Strafe droite · walk', file: 'right-strafe-walking.fbx' },
  { id: 'walking-forward-left', label: 'Walking · diagonale avant gauche', generated: true },
  { id: 'walking-forward-right', label: 'Walking · diagonale avant droite', generated: true },
  { id: 'running-forward-left', label: 'Running · diagonale avant gauche', generated: true },
  { id: 'running-forward-right', label: 'Running · diagonale avant droite', generated: true },

  { id: 'crouch-idle', label: 'Crouch · idle', file: 'crouch-idle.fbx' },
  { id: 'crouch-walking', label: 'Crouch · marche', file: 'crouch-walking.fbx' },
  { id: 'crouch-backward', label: 'Crouch · marche arrière', generated: true },
  { id: 'crouch-strafe-left', label: 'Crouch · gauche', file: 'crouch-strafe-left.fbx' },
  { id: 'crouch-strafe-right', label: 'Crouch · droite', file: 'crouch-strafe-right.fbx' },
  { id: 'crouch-forward-left', label: 'Crouch · diagonale avant gauche', generated: true },
  { id: 'crouch-forward-right', label: 'Crouch · diagonale avant droite', generated: true },
  { id: 'crouch-backward-left', label: 'Crouch · diagonale arrière gauche', generated: true },
  { id: 'crouch-backward-right', label: 'Crouch · diagonale arrière droite', generated: true },
  { id: 'standing-to-crouched', label: 'Standing → crouched', file: 'standing-to-crouched.fbx' },
  { id: 'crouched-to-standing', label: 'Crouched → standing', file: 'crouched-to-standing.fbx' },

  { id: 'jumping-up', label: 'Jump · sur place', file: 'jumping-up.fbx' },
  { id: 'jump', label: 'Jump · mouvement', file: 'jump.fbx' },
  { id: 'running-jump', label: 'Jump · sprint', file: 'running-jump.fbx' },
  { id: 'jump-backward', label: 'Jump · arrière', file: 'jump-backward.fbx' },
  { id: 'running-slide', label: 'Running slide', file: 'running-slide.fbx' },
  { id: 'slide-to-running', label: 'Slide → sprint', generated: true },

  { id: 'fight-idle', label: 'Fight · bouncing idle', file: 'fight-idle.fbx' },
  { id: 'standing-idle-to-fight-idle', label: 'Standing idle → fight idle', file: 'standing-idle-to-fight-idle.fbx' },
  { id: 'action-idle-to-fight-idle', label: 'Action idle → fight idle', file: 'action-idle-to-fight-idle.fbx' },
  { id: 'fight-idle-to-action-idle', label: 'Fight idle → action idle', file: 'fight-idle-to-action-idle.fbx' },
  { id: 'fight-idle-to-standing-idle', label: 'Fight idle → standing idle', file: 'fight-idle-to-standing-idle.fbx' },
  { id: 'punching-1', label: 'Combat · punch 1', file: 'combat-punch-1.fbx' },
  { id: 'punching-2', label: 'Combat · punch 2', file: 'combat-punch-2.fbx' },
  { id: 'punching-3-clean', label: 'Combat · punch 3 clean', file: 'punching.fbx' },
  { id: 'punching-4-alt', label: 'Combat · punch 4 alt', file: 'punching-alt.fbx' },
  { id: 'hook-a', label: 'Combat · counter hook A', file: 'hook-a.fbx' },
  { id: 'hook-b', label: 'Combat · counter hook B', file: 'hook-b.fbx' },
  { id: 'hook-c', label: 'Combat · counter hook C', file: 'hook-c.fbx' },
  { id: 'hit-body', label: 'Hit · body', file: 'hit-body.fbx' },
  { id: 'hit-groin-a', label: 'Hit · groin A', file: 'hit-groin-a.fbx' },
  { id: 'hit-groin-b', label: 'Hit · groin B', file: 'hit-groin-b.fbx' },
  { id: 'hit-head-0', label: 'Hit · head 0', file: 'hit-head-0.fbx' },
  { id: 'hit-head-1', label: 'Hit · head 1', file: 'hit-head-1.fbx' },
  { id: 'hit-head-2', label: 'Hit · head 2', file: 'hit-head-2.fbx' },
  { id: 'hit-head-3', label: 'Hit · head 3', file: 'hit-head-3.fbx' },
  { id: 'hit-head-4', label: 'Hit · head 4', file: 'hit-head-4.fbx' },
  { id: 'hit-head-5', label: 'Hit · head 5', file: 'hit-head-5.fbx' },
  { id: 'hit-head-6', label: 'Hit · head 6', file: 'hit-head-6.fbx' },
  { id: 'hit-head-light', label: 'Hit · head light', file: 'hit-head-light.fbx' },
  { id: 'hit-head-medium-a', label: 'Hit · head medium A', file: 'hit-head-medium-a.fbx' },
  { id: 'hit-head-medium-b', label: 'Hit · head medium B', file: 'hit-head-medium-b.fbx' },
  { id: 'hit-head-big-a', label: 'Hit · head big A', file: 'hit-head-big-a.fbx' },
  { id: 'hit-head-big-b', label: 'Hit · head big B', file: 'hit-head-big-b.fbx' },
  { id: 'hit-head-big-c', label: 'Hit · head big C', file: 'hit-head-big-c.fbx' },

  { id: 'falling-idle', label: 'Fall · idle', file: 'falling-idle.fbx' },
  { id: 'falling-to-landing', label: 'Fall → landing', file: 'falling-to-landing.fbx' },
  { id: 'stand-up-back', label: 'Get up · back', file: 'stand-up-back.fbx' },
  { id: 'stand-up-belly', label: 'Get up · belly', file: 'stand-up-belly.fbx' },
  { id: 'falling-flat-impact', label: 'Fall · heavy impact', file: 'falling-flat-impact.fbx' },

  { id: 'idle-turn-left', label: 'Idle action · turn gauche', file: 'idle-turn-left.fbx' },
  { id: 'idle-turn-right', label: 'Idle action · turn droite', file: 'idle-turn-right.fbx' },
  { id: 'idle-big-turn-left', label: 'Idle action · BIG turn gauche', file: 'idle-big-turn-left.fbx' },
  { id: 'idle-big-turn-right', label: 'Idle action · BIG turn droite', file: 'idle-big-turn-right.fbx' },

  { id: 'left-turn', label: 'Sleeping idle · turn gauche', file: 'left-turn.fbx' },
  { id: 'right-turn', label: 'Sleeping idle · turn droite', file: 'right-turn.fbx' },
  { id: 'left-turn-90', label: 'Sleeping idle · turn gauche léger', file: 'left-turn-90.fbx' },
  { id: 'right-turn-90', label: 'Sleeping idle · turn droite léger', file: 'right-turn-90.fbx' },
] as const;

type AnimationId = typeof ANIMATIONS[number]['id'];
type PlaybackMode = 'auto' | 'forced';
type ViewMode = 'first-person' | 'third-person';
type RagdollMode = 'dead' | 'pit-fall';
type IdleResumeMode = 'action' | 'sleeping';
type IdleSequencePhase = 'sleeping' | 'sleeping-look' | 'action' | 'wait' | 'transition';

interface LoadedAnimation {
  clip: THREE.AnimationClip;
  action: THREE.AnimationAction;
}

interface CombatLayerPair {
  readonly clip: THREE.AnimationClip;
  readonly thirdPerson: THREE.AnimationAction;
  readonly firstPerson: THREE.AnimationAction;
}

type CombatPhase = 'none' | 'enter' | 'guard' | 'exit';
type CombatAttackAnimation =
  | 'jab-a' | 'cross-b' | 'long-a' | 'compact-b' | 'cross-a' | 'jab-b'
  | 'straight-c' | 'cross-d' | 'body-cross-a' | 'body-cross-b' | 'overhand-a' | 'overhand-b'
  | 'body-hook-a' | 'body-hook-b' | 'body-hook-c'
  | 'step-a' | 'step-b' | 'step-c' | 'step-d' | 'shove-a' | 'shove-b'
  | 'power-a' | 'power-b'
  | 'hook-a' | 'hook-b' | 'hook-c';
type HitAnimationId =
  | 'hit-body' | 'hit-groin-a' | 'hit-groin-b'
  | 'hit-head-0' | 'hit-head-1' | 'hit-head-2' | 'hit-head-3' | 'hit-head-4' | 'hit-head-5' | 'hit-head-6'
  | 'hit-head-light' | 'hit-head-medium-a' | 'hit-head-medium-b'
  | 'hit-head-big-a' | 'hit-head-big-b' | 'hit-head-big-c';

type CombatPunchSourceFamily = 'a' | 'b' | 'c' | 'd' | 'h';

interface CombatAttackVisualProfile {
  readonly source: AnimationId;
  readonly sourceFamily: CombatPunchSourceFamily;
  readonly character: 'jab' | 'cross' | 'long' | 'compact' | 'body' | 'overhand' | 'step' | 'shove' | 'power';
  readonly heavy: boolean;
  readonly tempoMultiplier: number;
  readonly reachMultiplier: number;
  readonly bodyMultiplier: number;
  readonly firstPersonForwardMeters: number;
  readonly styleYawDegrees: number;
  readonly headSlipDegrees: number;
  readonly lungeSpeed: number;
}

interface CombatAttackTimingProfile {
  readonly impactFraction: number;
  readonly contactStartFraction: number;
  readonly contactEndFraction: number;
  /** Runtime stops the additive strike here instead of waiting through a dead tail. */
  readonly finishFraction: number;
}

const COMBAT_ATTACK_TIMING: Readonly<Record<CombatAttackAnimation, CombatAttackTimingProfile>> = {
  // Tight authored beats: anticipation -> visible extension/contact -> short recoil.
  // finishFraction deliberately ends the action once the fists are visibly back
  // on the way to guard instead of waiting through unused source-clip tail.
  'jab-a':       { impactFraction: 0.405, contactStartFraction: 0.345, contactEndFraction: 0.475, finishFraction: 0.850 },
  'cross-b':     { impactFraction: 0.475, contactStartFraction: 0.400, contactEndFraction: 0.550, finishFraction: 0.890 },
  'long-a':      { impactFraction: 0.525, contactStartFraction: 0.445, contactEndFraction: 0.605, finishFraction: 0.915 },
  'compact-b':   { impactFraction: 0.430, contactStartFraction: 0.365, contactEndFraction: 0.500, finishFraction: 0.855 },
  'cross-a':     { impactFraction: 0.485, contactStartFraction: 0.410, contactEndFraction: 0.560, finishFraction: 0.895 },
  'jab-b':       { impactFraction: 0.410, contactStartFraction: 0.350, contactEndFraction: 0.480, finishFraction: 0.855 },
  'straight-c':  { impactFraction: 0.515, contactStartFraction: 0.435, contactEndFraction: 0.595, finishFraction: 0.910 },
  'cross-d':     { impactFraction: 0.495, contactStartFraction: 0.420, contactEndFraction: 0.570, finishFraction: 0.900 },
  'body-cross-a':{ impactFraction: 0.500, contactStartFraction: 0.425, contactEndFraction: 0.585, finishFraction: 0.900 },
  'body-cross-b':{ impactFraction: 0.510, contactStartFraction: 0.435, contactEndFraction: 0.595, finishFraction: 0.905 },
  'overhand-a':  { impactFraction: 0.555, contactStartFraction: 0.475, contactEndFraction: 0.635, finishFraction: 0.925 },
  'overhand-b':  { impactFraction: 0.565, contactStartFraction: 0.485, contactEndFraction: 0.645, finishFraction: 0.930 },
  'body-hook-a': { impactFraction: 0.455, contactStartFraction: 0.385, contactEndFraction: 0.535, finishFraction: 0.760 },
  'body-hook-b': { impactFraction: 0.465, contactStartFraction: 0.395, contactEndFraction: 0.545, finishFraction: 0.765 },
  'body-hook-c': { impactFraction: 0.475, contactStartFraction: 0.405, contactEndFraction: 0.555, finishFraction: 0.775 },
  'step-a':      { impactFraction: 0.555, contactStartFraction: 0.470, contactEndFraction: 0.635, finishFraction: 0.935 },
  'step-b':      { impactFraction: 0.545, contactStartFraction: 0.460, contactEndFraction: 0.625, finishFraction: 0.930 },
  'step-c':      { impactFraction: 0.565, contactStartFraction: 0.480, contactEndFraction: 0.645, finishFraction: 0.940 },
  'step-d':      { impactFraction: 0.560, contactStartFraction: 0.475, contactEndFraction: 0.640, finishFraction: 0.938 },
  'shove-a':     { impactFraction: 0.380, contactStartFraction: 0.315, contactEndFraction: 0.455, finishFraction: 0.660 },
  'shove-b':     { impactFraction: 0.390, contactStartFraction: 0.325, contactEndFraction: 0.465, finishFraction: 0.670 },
  'power-a':     { impactFraction: 0.575, contactStartFraction: 0.485, contactEndFraction: 0.655, finishFraction: 0.950 },
  'power-b':     { impactFraction: 0.585, contactStartFraction: 0.495, contactEndFraction: 0.665, finishFraction: 0.952 },
  'hook-a':      { impactFraction: 0.500, contactStartFraction: 0.420, contactEndFraction: 0.585, finishFraction: 0.805 },
  'hook-b':      { impactFraction: 0.515, contactStartFraction: 0.435, contactEndFraction: 0.600, finishFraction: 0.815 },
  'hook-c':      { impactFraction: 0.525, contactStartFraction: 0.445, contactEndFraction: 0.610, finishFraction: 0.825 },
};

const COMBAT_ATTACK_DESIRED_SIDE: Readonly<Record<CombatAttackAnimation, CombatStrikeSide>> = {
  // Deliberate L/R choreography. The source analyzer decides whether each FBX
  // must be mirrored to achieve this side, so exchanges alternate actual arms
  // rather than merely changing playback speed on the same punch.
  'jab-a': 'left', 'cross-b': 'right', 'long-a': 'right', 'compact-b': 'left',
  'cross-a': 'left', 'jab-b': 'right', 'straight-c': 'left', 'cross-d': 'right',
  'body-cross-a': 'left', 'body-cross-b': 'right', 'overhand-a': 'left', 'overhand-b': 'right',
  'body-hook-a': 'left', 'body-hook-b': 'right', 'body-hook-c': 'left',
  'step-a': 'left', 'step-b': 'right', 'step-c': 'left', 'step-d': 'right',
  'shove-a': 'left', 'shove-b': 'right', 'power-a': 'left', 'power-b': 'right',
  'hook-a': 'left', 'hook-b': 'right', 'hook-c': 'left',
};

const combatAttackTimingProfile = (animation: CombatAttackAnimation): CombatAttackTimingProfile =>
  COMBAT_ATTACK_TIMING[animation];

/**
 * Where the visible fist should actually travel on the opponent. Ordinary
 * straights are head-first; only compact clinch shots sit a little lower. This
 * is intentionally recomputed from live bones every frame so animation aim is
 * driven by the opponent's real pose instead of a fixed sternum reticle.
 */
const combatStrikeHeadAimWeight = (
  animation: CombatAttackAnimation,
  kind: MeleeAttackKind,
  spacing: CombatMeleeSpacing,
): number => {
  const character = combatAttackVisualProfile(animation)?.character;
  if (character === 'shove') return 0.38;
  if (character === 'body') return 0.34;
  if (character === 'overhand') return 0.97;
  if (kind === 'hook-counter') return 0.84;
  if (kind === 'big-punch') return 0.93;
  const base = character === 'jab' ? 0.95
    : character === 'cross' ? 0.91
      : character === 'long' ? 0.94
        : character === 'step' ? 0.93
          : character === 'compact' ? 0.73
            : 0.87;
  return THREE.MathUtils.clamp(base - (spacing === 'close' ? 0.08 : 0), 0.36, 0.96);
};

interface CombatStrikeAimProfile {
  readonly headWeight: number;
  readonly lateralMeters: number;
  readonly verticalMeters: number;
  readonly penetrationMeters: number;
}

/**
 * Small per-strike target offsets make an exchange read as authored choreography
 * while every fist still converges on the opponent's live body. These are
 * centimetre-scale offsets inside the head/upper-torso volume, never fake misses.
 */
const combatStrikeAimProfile = (
  animation: CombatAttackAnimation,
  kind: MeleeAttackKind,
  spacing: CombatMeleeSpacing,
  side: CombatStrikeSide,
): CombatStrikeAimProfile => {
  const character = combatAttackVisualProfile(animation)?.character;
  const sideSign = side === 'left' ? -1 : 1;
  const headWeight = combatStrikeHeadAimWeight(animation, kind, spacing);
  if (character === 'shove') {
    return { headWeight, lateralMeters: 0, verticalMeters: -0.055, penetrationMeters: 0.035 };
  }
  if (character === 'body') {
    return { headWeight, lateralMeters: sideSign * 0.045, verticalMeters: -0.080, penetrationMeters: 0.060 };
  }
  if (character === 'overhand') {
    return { headWeight, lateralMeters: sideSign * 0.035, verticalMeters: 0.045, penetrationMeters: 0.075 };
  }
  if (character === 'compact') {
    return { headWeight, lateralMeters: sideSign * 0.035, verticalMeters: -0.035, penetrationMeters: 0.050 };
  }
  if (character === 'jab') {
    return { headWeight, lateralMeters: sideSign * 0.018, verticalMeters: 0.020, penetrationMeters: 0.055 };
  }
  if (character === 'cross') {
    return { headWeight, lateralMeters: sideSign * 0.050, verticalMeters: 0.000, penetrationMeters: 0.065 };
  }
  if (character === 'long' || character === 'step') {
    return { headWeight, lateralMeters: sideSign * 0.026, verticalMeters: 0.025, penetrationMeters: 0.070 };
  }
  if (kind === 'big-punch') {
    return { headWeight, lateralMeters: sideSign * 0.045, verticalMeters: 0.015, penetrationMeters: 0.080 };
  }
  return { headWeight, lateralMeters: sideSign * 0.030, verticalMeters: 0.005, penetrationMeters: 0.060 };
};

const combatCloseRangeAimProfile = (
  profile: CombatStrikeAimProfile,
  distance: number,
): CombatStrikeAimProfile => {
  if (!Number.isFinite(distance)) return profile;
  const close = 1 - THREE.MathUtils.smoothstep(distance, 0.72, 1.04);
  if (close <= 1e-4) return profile;
  return {
    headWeight: THREE.MathUtils.lerp(profile.headWeight, Math.min(profile.headWeight, 0.72), close * 0.86),
    lateralMeters: profile.lateralMeters * (1 - close * 0.70),
    verticalMeters: profile.verticalMeters * (1 - close * 0.42) - 0.012 * close,
    penetrationMeters: profile.penetrationMeters + 0.026 * close,
  };
};


/**
 * Revised punch library: twelve authored light strikes (jab/cross/long/compact/body/overhand), four step-in variants and two power variants.
 * Normal attacks use only the four clean straight-punch references; hook FBXs are reserved for
 * dodge-counters. Left/right versions are generated by mirroring additive motion when needed, so
 * silhouette, torso commitment and actual striking side change across an exchange. The old Big Punch FBXs
 * are intentionally not loaded or sampled: double click keeps its gameplay
 * damage profile but gets a controlled power-straight visual instead.
 */
const COMBAT_ATTACK_VISUAL_PROFILES: Readonly<Record<
  Exclude<CombatAttackAnimation, 'hook-a' | 'hook-b' | 'hook-c'>,
  CombatAttackVisualProfile
>> = {
  'jab-a': {
    source: 'punching-1', sourceFamily: 'a', character: 'jab', heavy: false,
    tempoMultiplier: 0.84, reachMultiplier: 1.02, bodyMultiplier: 0.78, firstPersonForwardMeters: 0.145,
    styleYawDegrees: -2.0, headSlipDegrees: 1.5, lungeSpeed: 1.52,
  },
  'cross-b': {
    source: 'punching-2', sourceFamily: 'b', character: 'cross', heavy: false,
    tempoMultiplier: 0.98, reachMultiplier: 1.20, bodyMultiplier: 1.28, firstPersonForwardMeters: 0.205,
    styleYawDegrees: 13.0, headSlipDegrees: -8.0, lungeSpeed: 1.96,
  },
  'long-a': {
    source: 'punching-1', sourceFamily: 'a', character: 'long', heavy: false,
    tempoMultiplier: 1.08, reachMultiplier: 1.34, bodyMultiplier: 1.24, firstPersonForwardMeters: 0.245,
    styleYawDegrees: -9.5, headSlipDegrees: 6.5, lungeSpeed: 2.22,
  },
  'compact-b': {
    source: 'punching-2', sourceFamily: 'b', character: 'compact', heavy: false,
    tempoMultiplier: 0.92, reachMultiplier: 0.92, bodyMultiplier: 1.04, firstPersonForwardMeters: 0.115,
    styleYawDegrees: 7.5, headSlipDegrees: -4.5, lungeSpeed: 1.24,
  },
  'cross-a': {
    source: 'punching-1', sourceFamily: 'a', character: 'cross', heavy: false,
    tempoMultiplier: 1.00, reachMultiplier: 1.20, bodyMultiplier: 1.30, firstPersonForwardMeters: 0.210,
    styleYawDegrees: -14.0, headSlipDegrees: 8.5, lungeSpeed: 1.98,
  },
  'jab-b': {
    source: 'punching-2', sourceFamily: 'b', character: 'jab', heavy: false,
    tempoMultiplier: 0.86, reachMultiplier: 1.03, bodyMultiplier: 0.80, firstPersonForwardMeters: 0.150,
    styleYawDegrees: 2.5, headSlipDegrees: -1.5, lungeSpeed: 1.54,
  },
  'straight-c': {
    source: 'punching-3-clean', sourceFamily: 'c', character: 'long', heavy: false,
    tempoMultiplier: 1.06, reachMultiplier: 1.30, bodyMultiplier: 1.18, firstPersonForwardMeters: 0.232,
    styleYawDegrees: -5.5, headSlipDegrees: 5.5, lungeSpeed: 2.12,
  },
  'cross-d': {
    source: 'punching-4-alt', sourceFamily: 'd', character: 'cross', heavy: false,
    tempoMultiplier: 1.02, reachMultiplier: 1.24, bodyMultiplier: 1.34, firstPersonForwardMeters: 0.218,
    styleYawDegrees: 16.0, headSlipDegrees: -9.5, lungeSpeed: 2.05,
  },
  'body-cross-a': {
    source: 'punching-3-clean', sourceFamily: 'c', character: 'body', heavy: false,
    tempoMultiplier: 0.98, reachMultiplier: 1.18, bodyMultiplier: 1.22, firstPersonForwardMeters: 0.205,
    styleYawDegrees: -17.0, headSlipDegrees: 5.5, lungeSpeed: 1.92,
  },
  'body-cross-b': {
    source: 'punching-4-alt', sourceFamily: 'd', character: 'body', heavy: false,
    tempoMultiplier: 1.00, reachMultiplier: 1.18, bodyMultiplier: 1.22, firstPersonForwardMeters: 0.205,
    styleYawDegrees: 17.0, headSlipDegrees: -5.5, lungeSpeed: 1.92,
  },
  'overhand-a': {
    source: 'punching-3-clean', sourceFamily: 'c', character: 'overhand', heavy: false,
    tempoMultiplier: 1.10, reachMultiplier: 1.24, bodyMultiplier: 1.34, firstPersonForwardMeters: 0.235,
    styleYawDegrees: -20.0, headSlipDegrees: 9.0, lungeSpeed: 2.12,
  },
  'overhand-b': {
    source: 'punching-4-alt', sourceFamily: 'd', character: 'overhand', heavy: false,
    tempoMultiplier: 1.12, reachMultiplier: 1.24, bodyMultiplier: 1.34, firstPersonForwardMeters: 0.235,
    styleYawDegrees: 20.0, headSlipDegrees: -9.0, lungeSpeed: 2.12,
  },
  'body-hook-a': {
    source: 'hook-a', sourceFamily: 'h', character: 'compact', heavy: false,
    tempoMultiplier: 0.94, reachMultiplier: 0.96, bodyMultiplier: 1.20, firstPersonForwardMeters: 0.128,
    styleYawDegrees: -14.0, headSlipDegrees: 7.0, lungeSpeed: 1.48,
  },
  'body-hook-b': {
    source: 'hook-b', sourceFamily: 'h', character: 'compact', heavy: false,
    tempoMultiplier: 0.96, reachMultiplier: 0.98, bodyMultiplier: 1.22, firstPersonForwardMeters: 0.132,
    styleYawDegrees: 14.0, headSlipDegrees: -7.0, lungeSpeed: 1.50,
  },
  'body-hook-c': {
    source: 'hook-c', sourceFamily: 'h', character: 'compact', heavy: false,
    tempoMultiplier: 1.00, reachMultiplier: 1.00, bodyMultiplier: 1.25, firstPersonForwardMeters: 0.136,
    styleYawDegrees: -9.0, headSlipDegrees: 5.5, lungeSpeed: 1.52,
  },
  'step-a': {
    source: 'punching-1', sourceFamily: 'a', character: 'step', heavy: false,
    tempoMultiplier: 1.02, reachMultiplier: 1.48, bodyMultiplier: 1.36, firstPersonForwardMeters: 0.285,
    styleYawDegrees: -11.0, headSlipDegrees: 7.5, lungeSpeed: 3.20,
  },
  'step-b': {
    source: 'punching-2', sourceFamily: 'b', character: 'step', heavy: false,
    tempoMultiplier: 1.00, reachMultiplier: 1.46, bodyMultiplier: 1.34, firstPersonForwardMeters: 0.278,
    styleYawDegrees: 11.0, headSlipDegrees: -7.5, lungeSpeed: 3.16,
  },
  'step-c': {
    source: 'punching-3-clean', sourceFamily: 'c', character: 'step', heavy: false,
    tempoMultiplier: 1.05, reachMultiplier: 1.52, bodyMultiplier: 1.38, firstPersonForwardMeters: 0.295,
    styleYawDegrees: -6.0, headSlipDegrees: 6.5, lungeSpeed: 3.25,
  },
  'step-d': {
    source: 'punching-4-alt', sourceFamily: 'd', character: 'step', heavy: false,
    tempoMultiplier: 1.06, reachMultiplier: 1.50, bodyMultiplier: 1.40, firstPersonForwardMeters: 0.292,
    styleYawDegrees: 14.0, headSlipDegrees: -9.0, lungeSpeed: 3.22,
  },
  'shove-a': {
    source: 'hook-a', sourceFamily: 'h', character: 'shove', heavy: false,
    tempoMultiplier: 0.84, reachMultiplier: 0.84, bodyMultiplier: 1.28, firstPersonForwardMeters: 0.090,
    styleYawDegrees: -5.0, headSlipDegrees: 3.0, lungeSpeed: 0.62,
  },
  'shove-b': {
    source: 'hook-b', sourceFamily: 'h', character: 'shove', heavy: false,
    tempoMultiplier: 0.84, reachMultiplier: 0.84, bodyMultiplier: 1.28, firstPersonForwardMeters: 0.090,
    styleYawDegrees: 5.0, headSlipDegrees: -3.0, lungeSpeed: 0.62,
  },
  'power-a': {
    source: 'punching-3-clean', sourceFamily: 'c', character: 'power', heavy: true,
    tempoMultiplier: 1.02, reachMultiplier: 1.34, bodyMultiplier: 1.36, firstPersonForwardMeters: 0.230,
    styleYawDegrees: -10.0, headSlipDegrees: 7.0, lungeSpeed: 2.30,
  },
  'power-b': {
    source: 'punching-4-alt', sourceFamily: 'd', character: 'power', heavy: true,
    tempoMultiplier: 1.08, reachMultiplier: 1.32, bodyMultiplier: 1.34, firstPersonForwardMeters: 0.224,
    styleYawDegrees: 11.0, headSlipDegrees: -7.5, lungeSpeed: 2.28,
  },
};

const PUNCH_ATTACK_VARIANTS = [
  'jab-a', 'cross-b', 'long-a', 'compact-b', 'cross-a', 'jab-b',
  'straight-c', 'cross-d', 'body-cross-a', 'body-cross-b', 'overhand-a', 'overhand-b',
] as const satisfies readonly CombatAttackAnimation[];
const FAR_STEP_ATTACK_VARIANTS = ['step-a', 'step-b', 'step-c', 'step-d'] as const satisfies readonly CombatAttackAnimation[];
const CLOSE_RANGE_ATTACK_VARIANTS = ['compact-b', 'body-cross-a', 'body-cross-b', 'jab-b', 'jab-a', 'cross-a', 'cross-d'] as const satisfies readonly CombatAttackAnimation[];
const CLINCH_SHOVE_ATTACK_VARIANTS = ['shove-a', 'shove-b'] as const satisfies readonly CombatAttackAnimation[];

const SCRIPTED_MEDIUM_SEQUENCES: readonly (readonly CombatAttackAnimation[])[] = [
  ['jab-a', 'cross-b', 'body-cross-a', 'overhand-b', 'straight-c'],
  ['jab-b', 'cross-a', 'long-a', 'body-cross-b', 'overhand-a'],
  ['straight-c', 'cross-b', 'jab-a', 'overhand-b', 'body-cross-a'],
  ['compact-b', 'cross-d', 'body-cross-a', 'jab-b', 'long-a'],
  ['body-cross-b', 'cross-a', 'overhand-b', 'jab-a', 'straight-c'],
] as const;
const SCRIPTED_OUTER_SEQUENCES: readonly (readonly CombatAttackAnimation[])[] = [
  ['long-a', 'cross-d', 'straight-c', 'overhand-a', 'cross-b'],
  ['straight-c', 'cross-a', 'long-a', 'overhand-b', 'jab-b'],
  ['cross-b', 'overhand-a', 'long-a', 'cross-d', 'body-cross-b'],
  ['overhand-b', 'jab-a', 'straight-c', 'cross-a', 'long-a'],
] as const;

const ALL_STRAIGHT_ATTACK_VARIANTS = [
  ...PUNCH_ATTACK_VARIANTS,
  ...FAR_STEP_ATTACK_VARIANTS,
] as const satisfies readonly CombatAttackAnimation[];
// Medium-range selection uses a shuffle bag with source-family and gesture
// anti-repeat rules. This keeps exchanges varied without buffering or RNG spam.
const MEDIUM_ATTACK_VARIANTS = PUNCH_ATTACK_VARIANTS;
const BIG_PUNCH_ATTACK_VARIANTS = [
  'power-a', 'power-b',
] as const satisfies readonly CombatAttackAnimation[];
const HOOK_ATTACK_VARIANTS = [
  'hook-a', 'hook-b', 'hook-c',
] as const satisfies readonly CombatAttackAnimation[];

const COMBAT_ATTACK_SOURCE_ANIMATION: Readonly<Record<CombatAttackAnimation, AnimationId>> = {
  'jab-a': 'punching-1',
  'cross-b': 'punching-2',
  'long-a': 'punching-1',
  'compact-b': 'punching-2',
  'cross-a': 'punching-1',
  'jab-b': 'punching-2',
  'straight-c': 'punching-3-clean',
  'cross-d': 'punching-4-alt',
  'body-cross-a': 'punching-3-clean',
  'body-cross-b': 'punching-4-alt',
  'overhand-a': 'punching-3-clean',
  'overhand-b': 'punching-4-alt',
  'body-hook-a': 'hook-a',
  'body-hook-b': 'hook-b',
  'body-hook-c': 'hook-c',
  'step-a': 'punching-1',
  'step-b': 'punching-2',
  'step-c': 'punching-3-clean',
  'step-d': 'punching-4-alt',
  'shove-a': 'hook-a',
  'shove-b': 'hook-b',
  'power-a': 'punching-3-clean',
  'power-b': 'punching-4-alt',
  'hook-a': 'hook-a',
  'hook-b': 'hook-b',
  'hook-c': 'hook-c',
};

const combatAttackVisualProfile = (
  animation: CombatAttackAnimation,
): CombatAttackVisualProfile | null => {
  if (animation === 'hook-a' || animation === 'hook-b' || animation === 'hook-c') return null;
  return COMBAT_ATTACK_VISUAL_PROFILES[animation];
};

const combatAttackSourceFamily = (
  animation: CombatAttackAnimation,
): CombatPunchSourceFamily | null => combatAttackVisualProfile(animation)?.sourceFamily ?? null;

interface ActiveMeleeAttack {
  kind: MeleeAttackKind;
  readonly animation: CombatAttackAnimation;
  readonly spacing: CombatMeleeSpacing;
  readonly targetDistanceAtStart: number;
  readonly duration: number;
  readonly endTime: number;
  readonly impactTime: number;
  readonly impactFraction: number;
  readonly contactStartFraction: number;
  readonly contactEndFraction: number;
  readonly strikingSide: CombatStrikeSide;
  elapsed: number;
  impactApplied: boolean;
  sampledElapsed: number;
  aimPoint?: THREE.Vector3;
  contactPoint?: THREE.Vector3;
  compressionSeconds?: number;
}
interface ActiveCombatDodge {
  elapsed: number;
  readonly duration: number;
  readonly side: number;
  counterStarted: boolean;
}
interface ActiveGroundKick {
  readonly kind: GroundKickKind;
  readonly side: CombatStrikeSide;
  readonly duration: number;
  readonly impactTime: number;
  readonly startYaw: number;
  readonly targetYaw: number;
  readonly footStart: THREE.Vector3;
  readonly supportStart: THREE.Vector3;
  readonly supportRotation: THREE.Quaternion;
  pelvisDrop: number;
  readonly footRotation: THREE.Quaternion;
  readonly pelvisStart: THREE.Vector3;
  readonly targetPoint: THREE.Vector3;
  previousTarget: THREE.Vector3;
  sampledElapsed: number;
  elapsed: number;
  impactApplied: boolean;
  compressionSeconds: number;
  contactFoot?: THREE.Vector3;
  contactAge: number;
}

interface CombatSweepContact {
  readonly direction: THREE.Vector3;
  readonly distance: number;
  readonly fistSpeed: number;
  readonly fraction: number;
  readonly point: THREE.Vector3;
  readonly zone: CombatHitZone;
}
interface NpcBonePose {
  readonly position: THREE.Vector3;
  readonly rotation: THREE.Quaternion;
}
type NpcCombatPhase = 'idle' | 'guard' | 'attack' | 'hit' | 'down' | 'recover';

interface PersistentCorpse {
  readonly root: THREE.Group;
  readonly ragdoll: RagdollSystem;
}

interface RagdollBonePoseSample {
  readonly position: THREE.Vector3;
  readonly rotation: THREE.Quaternion;
}

interface LabMaterials {
  wall: THREE.MeshStandardMaterial;
  plaster: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
  ceiling: THREE.MeshStandardMaterial;
  baseboard: THREE.MeshStandardMaterial;
  step: THREE.MeshStandardMaterial;
  barrier: THREE.MeshStandardMaterial;
  column: THREE.MeshStandardMaterial;
  pitWall: THREE.MeshStandardMaterial;
  pitBottom: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  fixtureFrame: THREE.MeshStandardMaterial;
  fixtureGlow: THREE.MeshBasicMaterial;
  textures: THREE.Texture[];
}

const deterministicNoise = (x: number, y: number, seed: number): number => {
  const value = Math.sin(x * 12.9898 + y * 78.233 + seed * 19.19) * 43758.5453;
  return value - Math.floor(value);
};

const createPatternTexture = (kind: 'wall' | 'floor' | 'ceiling'): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D indisponible pour les textures du lab.');

  if (kind === 'wall') {
    context.fillStyle = '#d0c58e';
    context.fillRect(0, 0, 96, 96);
    context.strokeStyle = 'rgba(95,88,52,.22)';
    context.lineWidth = 1;
    for (let x = 4; x < 96; x += 12) {
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, 96); context.stroke();
      context.beginPath(); context.moveTo(x + 4, 0); context.lineTo(x + 4, 96); context.stroke();
    }
    for (let y = 5; y < 96; y += 9) {
      for (let x = 3; x < 96; x += 7) {
        if (deterministicNoise(x, y, 3) < 0.62) continue;
        const shade = 52 + Math.floor(deterministicNoise(x, y, 7) * 28);
        context.fillStyle = `rgba(${shade},${shade - 4},${Math.max(20, shade - 25)},.13)`;
        context.fillRect(x, y, 1, 1);
      }
    }
  } else if (kind === 'floor') {
    context.fillStyle = '#8f8967';
    context.fillRect(0, 0, 96, 96);
    for (let y = 0; y < 96; y += 2) {
      for (let x = 0; x < 96; x += 2) {
        const n = deterministicNoise(x, y, 11);
        const warm = Math.floor(96 + n * 42);
        context.fillStyle = `rgba(${warm},${Math.max(70, warm - 7)},${Math.max(45, warm - 30)},.22)`;
        context.fillRect(x, y, 1, 2);
      }
    }
    context.fillStyle = 'rgba(65,61,42,.12)';
    for (let x = 0; x < 96; x += 8) context.fillRect(x, 0, 1, 96);
  } else {
    context.fillStyle = '#c8c19a';
    context.fillRect(0, 0, 96, 96);
    context.strokeStyle = 'rgba(72,69,49,.18)';
    context.strokeRect(.5, .5, 95, 95);
    for (let y = 6; y < 96; y += 8) {
      for (let x = 7; x < 96; x += 8) {
        if (deterministicNoise(x, y, 17) < 0.38) continue;
        context.fillStyle = 'rgba(82,78,56,.13)';
        context.fillRect(x, y, 1, 1);
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
};

const configureLabTexture = (texture: THREE.Texture, color: boolean): THREE.Texture => {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

const createLabMaterials = (): LabMaterials => {
  // The fallback canvases keep the lab usable offline. `npm run dev` mirrors the
  // exact production textures from teddyfresnes/Backrooms before Vite starts;
  // once they load, these fallbacks are replaced in-place.
  const wallFallback = createPatternTexture('wall');
  const floorFallback = createPatternTexture('floor');
  const ceilingFallback = createPatternTexture('ceiling');
  const textures: THREE.Texture[] = [wallFallback, floorFallback, ceilingFallback];

  const wall = new THREE.MeshStandardMaterial({
    name: 'aged-wallpaper', map: wallFallback, color: 0xf3e7b7, emissive: 0x342f19,
    emissiveIntensity: 0.008, normalScale: new THREE.Vector2(0.3, 0.3),
    roughness: 0.94, metalness: 0, dithering: true,
  });
  const plaster = new THREE.MeshStandardMaterial({
    name: 'aged-painted-plaster', color: 0xeee0aa, emissive: 0x332e18,
    emissiveIntensity: 0.007, normalScale: new THREE.Vector2(0.36, 0.36),
    roughness: 0.96, metalness: 0, dithering: true,
  });
  const floor = new THREE.MeshStandardMaterial({
    name: 'damp-yellow-carpet', map: floorFallback, color: 0xddd8c4, emissive: 0x201f19,
    emissiveIntensity: 0.003, normalScale: new THREE.Vector2(0.34, 0.34),
    roughness: 0.98, metalness: 0, dithering: true,
  });
  const ceiling = new THREE.MeshStandardMaterial({
    name: 'office-drop-ceiling', map: ceilingFallback, color: 0xd2c58f, emissive: 0x3b371d,
    emissiveIntensity: 0.01, normalScale: new THREE.Vector2(0.42, 0.42),
    roughness: 0.97, metalness: 0, side: THREE.FrontSide, dithering: true,
  });
  const baseboard = new THREE.MeshStandardMaterial({
    name: 'yellowed-baseboard', color: 0xb9af7e, emissive: 0x302d1b,
    emissiveIntensity: 0.004, roughness: 0.9, metalness: 0, dithering: true,
  });
  const pitWall = new THREE.MeshStandardMaterial({
    name: 'pit-plaster', color: 0x8a7c4e, normalScale: new THREE.Vector2(0.5, 0.5),
    roughness: 1, metalness: 0, dithering: true,
  });

  const result: LabMaterials = {
    wall,
    plaster,
    floor,
    ceiling,
    baseboard,
    step: plaster.clone(),
    barrier: plaster.clone(),
    column: wall.clone(),
    pitWall,
    pitBottom: new THREE.MeshStandardMaterial({
      name: 'pit-carpet-floor', map: floorFallback, color: 0xd7d0b6, emissive: 0x201f19,
      emissiveIntensity: 0.004, normalScale: new THREE.Vector2(0.38, 0.38),
      roughness: 0.99, metalness: 0, dithering: true,
    }),
    metal: new THREE.MeshStandardMaterial({
      name: 'oxidized-trim', color: 0x4c4938, roughness: 0.68, metalness: 0.58,
    }),
    fixtureFrame: new THREE.MeshStandardMaterial({
      name: 'fluorescent-frame', color: 0xd6d2b3, roughness: 0.78, metalness: 0.03,
    }),
    fixtureGlow: new THREE.MeshBasicMaterial({
      name: 'fluorescent-diffuser', color: 0xfff4d1, toneMapped: true, fog: true,
      depthTest: true, depthWrite: true, side: THREE.DoubleSide,
    }),
    textures,
  };

  const loader = new THREE.TextureLoader();
  const load = (
    path: string,
    color: boolean,
    assign: (texture: THREE.Texture) => void,
  ): void => {
    loader.load(path, (loaded) => {
      const texture = configureLabTexture(loaded, color);
      textures.push(texture);
      assign(texture);
    }, undefined, () => {
      console.warn(`[movement-lab] texture Backrooms indisponible: ${path}; fallback local conservé.`);
    });
  };

  const base = '/assets/textures';
  load(`${base}/wallpaper/backrooms-wallpaper-seamless.webp`, true, (texture) => {
    wall.map = texture; result.column.map = texture; wall.needsUpdate = true; result.column.needsUpdate = true;
  });
  load(`${base}/plaster/plaster-color.webp`, true, (texture) => {
    plaster.map = texture; result.step.map = texture; result.barrier.map = texture; pitWall.map = texture;
    plaster.needsUpdate = true; result.step.needsUpdate = true; result.barrier.needsUpdate = true; pitWall.needsUpdate = true;
  });
  load(`${base}/plaster/plaster-normal-gl.webp`, false, (texture) => {
    wall.normalMap = texture; result.column.normalMap = texture; plaster.normalMap = texture; result.step.normalMap = texture;
    result.barrier.normalMap = texture; pitWall.normalMap = texture;
    wall.needsUpdate = true; result.column.needsUpdate = true; plaster.needsUpdate = true; result.step.needsUpdate = true;
    result.barrier.needsUpdate = true; pitWall.needsUpdate = true;
  });
  load(`${base}/plaster/plaster-arm.webp`, false, (texture) => {
    wall.roughnessMap = texture; result.column.roughnessMap = texture; plaster.roughnessMap = texture; result.step.roughnessMap = texture;
    result.barrier.roughnessMap = texture; pitWall.roughnessMap = texture;
    wall.needsUpdate = true; result.column.needsUpdate = true; plaster.needsUpdate = true; result.step.needsUpdate = true;
    result.barrier.needsUpdate = true; pitWall.needsUpdate = true;
  });
  load(`${base}/carpet/carpet-color-v2.webp`, true, (texture) => {
    floor.map = texture; result.pitBottom.map = texture;
    floor.needsUpdate = true; result.pitBottom.needsUpdate = true;
  });
  load(`${base}/carpet/carpet-normal-gl.webp`, false, (texture) => {
    floor.normalMap = texture; result.pitBottom.normalMap = texture;
    floor.needsUpdate = true; result.pitBottom.needsUpdate = true;
  });
  load(`${base}/carpet/carpet-arm.webp`, false, (texture) => {
    texture.channel = 0;
    floor.roughnessMap = texture; floor.aoMap = texture; floor.aoMapIntensity = 0.14;
    result.pitBottom.roughnessMap = texture; result.pitBottom.aoMap = texture; result.pitBottom.aoMapIntensity = 0.18;
    floor.needsUpdate = true; result.pitBottom.needsUpdate = true;
  });
  load(`${base}/ceiling/ceiling-color.webp`, true, (texture) => {
    ceiling.map = texture; ceiling.needsUpdate = true;
  });
  load(`${base}/ceiling/ceiling-normal-gl.webp`, false, (texture) => {
    ceiling.normalMap = texture; ceiling.needsUpdate = true;
  });
  load(`${base}/ceiling/ceiling-arm.webp`, false, (texture) => {
    texture.channel = 0; ceiling.roughnessMap = texture; ceiling.aoMap = texture; ceiling.aoMapIntensity = 0.46; ceiling.needsUpdate = true;
  });

  return result;
};

const materialForCollider = (collider: StaticCollider, materials: LabMaterials): THREE.Material => {
  if (collider.id.startsWith('pit-bottom-')) return materials.pitBottom;
  if (collider.id.startsWith('pit-wall-')) return materials.pitWall;
  if (collider.id.startsWith('pit-stair-')) return materials.floor;
  if (collider.id.startsWith('big-stair-')) return materials.step;
  if (collider.id.startsWith('impact-')) return materials.plaster;
  if (collider.id.includes('tunnel-ceiling')) return materials.ceiling;
  if (collider.kind === 'floor') return materials.floor;
  if (collider.kind === 'step') return materials.step;
  if (collider.kind === 'column') return materials.column;
  if (collider.kind === 'barrier') return materials.barrier;
  return materials.wall;
};

const applyPhysicalBoxUvs = (geometry: THREE.BoxGeometry, collider: StaticCollider): void => {
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const uvs = geometry.getAttribute('uv');
  const scale = collider.id.startsWith('pit-stair-') || collider.kind === 'floor' ? 1.45 : 1.25;
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    const nx = Math.abs(normals.getX(i));
    const ny = Math.abs(normals.getY(i));
    const nz = Math.abs(normals.getZ(i));
    if (ny >= nx && ny >= nz) {
      uvs.setXY(i, x / scale, z / scale);
    } else if (nx >= nz) {
      uvs.setXY(i, z / scale, y / scale);
    } else {
      uvs.setXY(i, x / scale, y / scale);
    }
  }
  uvs.needsUpdate = true;
};

const meshForCollider = (collider: StaticCollider, materials: LabMaterials): THREE.Mesh => {
  const geometry = new THREE.BoxGeometry(
    collider.halfExtents.x * 2,
    collider.halfExtents.y * 2,
    collider.halfExtents.z * 2,
  );
  applyPhysicalBoxUvs(geometry, collider);
  const mesh = new THREE.Mesh(geometry, materialForCollider(collider, materials));
  mesh.name = `animation-lab:${collider.id}`;
  mesh.position.set(collider.center.x, collider.center.y, collider.center.z);
  if (collider.rotation) mesh.quaternion.set(collider.rotation.x, collider.rotation.y, collider.rotation.z, collider.rotation.w);
  return mesh;
};

const createGrimeTexture = (): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D indisponible pour les traces du lab.');
  context.clearRect(0, 0, 256, 256);
  for (let i = 0; i < 70; i += 1) {
    const x = deterministicNoise(i, 2, 31) * 256;
    const y = deterministicNoise(i, 9, 37) * 256;
    const radius = 5 + deterministicNoise(i, 14, 43) * 32;
    const alpha = 0.012 + deterministicNoise(i, 22, 47) * 0.035;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(38,32,18,${alpha * 2.2})`);
    gradient.addColorStop(1, 'rgba(38,32,18,0)');
    context.fillStyle = gradient;
    context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
};

const addBackroomsLabDecor = (scene: THREE.Scene, materials: LabMaterials): void => {
  // Surface ceiling: same production ceiling material, but with a few missing
  // panels so the lab still reads as a rough mechanics test area rather than a
  // polished level slice.
  const ceilingGeometry = new THREE.PlaneGeometry(3, 3);
  const omitted = new Set(['-9,-9', '6,-6', '-12,9', '12,9']);
  for (let z = -13.5; z <= 13.5; z += 3) {
    for (let x = -16.5; x <= 16.5; x += 3) {
      if (omitted.has(`${x + 1.5},${z + 1.5}`)) continue;
      const tile = new THREE.Mesh(ceilingGeometry.clone(), materials.ceiling);
      tile.name = 'animation-lab:ceiling-tile';
      tile.position.set(x, 3.585, z);
      tile.rotation.x = Math.PI * 0.5;
      scene.add(tile);
    }
  }
  ceilingGeometry.dispose();

  const fixturePositions: Array<[number, number]> = [
    [-13.5, -12], [-7.5, -4.5], [0, -10.5], [7.5, -7.5], [13.5, -1.5],
    [-13.5, 3], [-4.5, 3], [4.5, 3], [13.5, 6], [-7.5, 12], [4.5, 12],
  ];
  const frameGeometry = new THREE.BoxGeometry(2.18, 0.08, 0.72);
  const glowGeometry = new THREE.PlaneGeometry(1.86, 0.46);
  for (const [x, z] of fixturePositions) {
    const frame = new THREE.Mesh(frameGeometry.clone(), materials.fixtureFrame);
    frame.name = 'animation-lab:fluorescent-frame';
    frame.position.set(x, 3.505, z);
    scene.add(frame);
    const glow = new THREE.Mesh(glowGeometry.clone(), materials.fixtureGlow);
    glow.name = 'animation-lab:fluorescent-diffuser';
    glow.position.set(x, 3.455, z);
    glow.rotation.x = Math.PI * 0.5;
    scene.add(glow);
  }
  frameGeometry.dispose();
  glowGeometry.dispose();

  // Yellowed skirting on the four outer walls, mirroring the production palette.
  const baseboardSpecs: Array<[number, number, number, number]> = [
    [0, 0.115, -14.84, 36], [0, 0.115, 14.84, 36],
  ];
  for (const [x, y, z, length] of baseboardSpecs) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(length, 0.23, 0.055), materials.baseboard);
    board.name = 'animation-lab:baseboard'; board.position.set(x, y, z); scene.add(board);
  }
  for (const x of [-17.84, 17.84]) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.23, 30), materials.baseboard);
    board.name = 'animation-lab:baseboard'; board.position.set(x, 0.115, 0); scene.add(board);
  }

  // Subtle grime cards keep the intentionally dirty test-space look while the
  // underlying wall/floor materials stay identical to the main repository.
  const grimeTexture = createGrimeTexture();
  materials.textures.push(grimeTexture);
  const grime = new THREE.MeshBasicMaterial({
    map: grimeTexture, transparent: true, depthWrite: false, opacity: 0.82,
    color: 0x73684d, toneMapped: true, polygonOffset: true, polygonOffsetFactor: -2,
  });
  const grimeSpecs: Array<[number, number, number, number, number]> = [
    [-17.87, 1.45, -7, Math.PI * 0.5, 2.8], [17.87, 1.1, 5, -Math.PI * 0.5, 2.3],
    [-10, 1.35, -14.87, 0, 3.2], [9, 1.15, 14.87, Math.PI, 2.6],
  ];
  for (const [x, y, z, yaw, size] of grimeSpecs) {
    const card = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 0.72), grime);
    card.name = 'animation-lab:grime'; card.position.set(x, y, z); card.rotation.y = yaw; scene.add(card);
  }
};

const expAlpha = (delta: number, response: number): number => 1 - Math.exp(-Math.max(0, delta) * response);
const followActionYaw = (current: number, target: number, delta: number, response: number, maxDegrees: number): number => {
  const limit = THREE.MathUtils.degToRad(maxDegrees) * Math.max(0, delta);
  return current + THREE.MathUtils.clamp(wrapAngleRadians(target - current) * expAlpha(delta, response), -limit, limit);
};

const isTurnAnimation = (id: AnimationId): boolean => id.includes('turn');
const isDiagonalLocomotion = (id: AnimationId): boolean =>
  id === 'walking-forward-left'
  || id === 'walking-forward-right'
  || id === 'running-forward-left'
  || id === 'running-forward-right';
// Cadence reference speeds for the in-place gait clips, independent of capsule speed caps.
const WALK_GAIT_REFERENCE_SPEED = 2.05;
const RUN_GAIT_REFERENCE_SPEED = 4.8;
const isCycleLocomotionAnimation = (id: AnimationId): boolean =>
  id === 'walking'
  || id === 'running'
  || id === 'left-strafe-walking'
  || id === 'right-strafe-walking'
  || id === 'walking-forward-left'
  || id === 'walking-forward-right'
  || id === 'running-forward-left'
  || id === 'running-forward-right'
  || id === 'crouch-walking'
  || id === 'crouch-backward'
  || id === 'crouch-strafe-left'
  || id === 'crouch-strafe-right'
  || id === 'crouch-forward-left'
  || id === 'crouch-forward-right'
  || id === 'crouch-backward-left'
  || id === 'crouch-backward-right';
const firstPersonFootLockGroup = (id: AnimationId): 'standing' | 'crouch' | null => {
  if (id === 'idle'
    || id === 'idle-action'
    || id === 'idle-looking'
    || id === 'idle-looking-down'
    || id === 'idle-looking-behind'
    || id === 'idle-wait-1'
    || id === 'idle-wait-2'
    || id === 'idle-action-to-standing-idle') return 'standing';
  if (id === 'crouch-idle') return 'crouch';
  return null;
};
const isActionIdleTurn = (id: AnimationId): boolean =>
  id === 'idle-turn-left'
  || id === 'idle-turn-right'
  || id === 'idle-big-turn-left'
  || id === 'idle-big-turn-right';
const usesFirstPersonActionIdleFraming = (id: AnimationId): boolean =>
  id === 'idle-action'
  || id === 'idle-wait-1'
  || id === 'idle-wait-2'
  || id === 'idle-action-to-standing-idle'
  || isActionIdleTurn(id);
const isSleepingIdleTurn = (id: AnimationId): boolean =>
  id === 'left-turn'
  || id === 'right-turn'
  || id === 'left-turn-90'
  || id === 'right-turn-90';
const isBigTurnAnimation = (id: AnimationId): boolean =>
  id === 'idle-big-turn-left'
  || id === 'idle-big-turn-right'
  || id === 'left-turn'
  || id === 'right-turn';
const ONE_SHOT_ANIMATIONS = new Set<AnimationId>([
  'idle-looking', 'idle-looking-down', 'idle-looking-behind',
  'idle-wait-1', 'idle-wait-2', 'idle-action-to-standing-idle',
  'standing-to-crouched', 'crouched-to-standing',
  'jumping-up', 'jump', 'running-jump', 'jump-backward',
  'running-slide', 'slide-to-running',
  'standing-idle-to-fight-idle', 'action-idle-to-fight-idle',
  'fight-idle-to-action-idle', 'fight-idle-to-standing-idle',
  'punching-1', 'punching-2', 'punching-3-clean', 'punching-4-alt',
  'hook-a', 'hook-b', 'hook-c',
  'hit-body', 'hit-groin-a', 'hit-groin-b',
  'hit-head-0', 'hit-head-1', 'hit-head-2', 'hit-head-3', 'hit-head-4', 'hit-head-5', 'hit-head-6',
  'hit-head-light', 'hit-head-medium-a', 'hit-head-medium-b',
  'hit-head-big-a', 'hit-head-big-b', 'hit-head-big-c',
  'falling-to-landing', 'falling-flat-impact',
  'stand-up-back', 'stand-up-belly',
  'idle-turn-left', 'idle-turn-right', 'idle-big-turn-left', 'idle-big-turn-right',
  'left-turn', 'right-turn', 'left-turn-90', 'right-turn-90',
]);
const isOneShotAnimation = (id: AnimationId): boolean => ONE_SHOT_ANIMATIONS.has(id);
const isPostureTransition = (id: AnimationId): boolean => id === 'standing-to-crouched' || id === 'crouched-to-standing';
const IDLE_LOOK_ANIMATIONS: readonly AnimationId[] = ['idle-looking', 'idle-looking-down', 'idle-looking-behind'];
const isIdleSequenceOneShot = (id: AnimationId): boolean =>
  IDLE_LOOK_ANIMATIONS.includes(id)
  || id === 'idle-wait-1'
  || id === 'idle-wait-2'
  || id === 'idle-action-to-standing-idle';
const needsHipVerticalMotion = (id: AnimationId): boolean =>
  isCycleLocomotionAnimation(id)
  || id.startsWith('crouch-')
  || isPostureTransition(id)
  || id === 'running-slide'
  || id === 'punching-1'
  || id === 'punching-2'
  || id.startsWith('hit-')
  || id === 'fight-idle'
  || id === 'standing-idle-to-fight-idle'
  || id === 'action-idle-to-fight-idle'
  || id === 'fight-idle-to-action-idle'
  || id === 'fight-idle-to-standing-idle'
  || id === 'falling-to-landing'
   || id === 'stand-up-back'
   || id === 'stand-up-belly'
  || id === 'falling-flat-impact';

interface HipVerticalRetarget {
  sourceBone: THREE.Bone;
  targetBone: THREE.Bone;
}

const findBoneBySuffix = (root: THREE.Object3D, suffix: string): THREE.Bone | undefined => {
  let found: THREE.Bone | undefined;
  root.traverse((object) => {
    if (found) return;
    const bone = object as THREE.Bone;
    if (!bone.isBone) return;
    const normalized = bone.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalized.endsWith(suffix)) found = bone;
  });
  return found;
};

const stabilizeQuaternionTrack = (
  track: THREE.KeyframeTrack,
  hipYawCorrectionRadians = 0,
  trimEndTime?: number,
): THREE.KeyframeTrack => {
  const next = track.clone();
  const values = next.values;
  const correctHips = Math.abs(hipYawCorrectionRadians) > 1e-6 && /hips\.quaternion$/i.test(next.name);
  const correction = new THREE.Quaternion().setFromAxisAngle(UP, hipYawCorrectionRadians);
  const q = new THREE.Quaternion();
  let previous: THREE.Quaternion | undefined;

  for (let i = 0; i + 3 < values.length; i += 4) {
    q.set(values[i]!, values[i + 1]!, values[i + 2]!, values[i + 3]!).normalize();
    if (correctHips) q.premultiply(correction).normalize();
    // q and -q encode the same orientation, but keeping one hemisphere across
    // successive keys prevents interpolation from visually taking a long spin.
    if (previous && previous.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    values[i] = q.x; values[i + 1] = q.y; values[i + 2] = q.z; values[i + 3] = q.w;
    previous = q.clone();
  }

  if (trimEndTime !== undefined) next.trim(0, trimEndTime);
  return next;
};

interface SlideRecoveryTiming {
  blendStart: number;
  trimEnd: number;
}

const slideRecoveryTiming = (source: THREE.AnimationClip): SlideRecoveryTiming => {
  const track = source.tracks.find((candidate) => /hips\.position$/i.test(candidate.name));
  if (!track || track.values.length < 12 || track.times.length < 4) {
    return {
      blendStart: source.duration * 0.73,
      trimEnd: source.duration * 0.94,
    };
  }

  let minIndex = 0;
  let minY = Number.POSITIVE_INFINITY;
  let earlyHighY = Number.NEGATIVE_INFINITY;
  const earlyEnd = Math.max(1, Math.floor(track.times.length * 0.28));
  for (let i = 0; i < track.times.length; i += 1) {
    const y = track.values[i * 3 + 1]!;
    if (i <= earlyEnd) earlyHighY = Math.max(earlyHighY, y);
    if (y < minY) {
      minY = y;
      minIndex = i;
    }
  }

  const crouchDepth = earlyHighY - minY;
  if (!Number.isFinite(crouchDepth) || crouchDepth <= 1e-4) {
    return {
      blendStart: source.duration * 0.73,
      trimEnd: source.duration * 0.94,
    };
  }

  // Keep the authored low/near-prone part of the slide. We only start blending
  // once the hips have *clearly* begun the authored stand-up recovery; the old
  // implementation cut on the first tiny rise and therefore froze a nearly
  // lying pose before snapping to Crouch Idle.
  const startThreshold = minY + crouchDepth * 0.15;
  const trimThreshold = minY + crouchDepth * 0.66;
  let blendStartIndex = -1;
  let trimEndIndex = -1;

  for (let i = minIndex + 1; i < track.times.length; i += 1) {
    const y = track.values[i * 3 + 1]!;
    const yNext = i + 1 < track.times.length ? track.values[(i + 1) * 3 + 1]! : y;
    const rising = yNext >= y - crouchDepth * 0.01;
    if (blendStartIndex < 0 && rising && y >= startThreshold) blendStartIndex = i;
    if (blendStartIndex >= 0 && y >= trimThreshold) {
      trimEndIndex = i;
      break;
    }
  }

  const fallbackStart = source.duration * 0.73;
  const rawStart = blendStartIndex >= 0 ? track.times[blendStartIndex]! : fallbackStart;
  const blendStart = THREE.MathUtils.clamp(rawStart, source.duration * 0.58, source.duration * 0.86);

  const fallbackEnd = Math.min(source.duration * 0.96, blendStart + Math.max(0.22, source.duration * 0.2));
  const rawEnd = trimEndIndex >= 0 ? track.times[trimEndIndex]! : fallbackEnd;
  const trimEnd = THREE.MathUtils.clamp(
    Math.max(rawEnd, blendStart + Math.min(0.16, source.duration * 0.12)),
    blendStart + 0.08,
    source.duration * 0.98,
  );

  return { blendStart, trimEnd };
};

const transitionFadeSeconds = (from: AnimationId, to: AnimationId): number => {
  if (from === 'stand-up-back' || from === 'stand-up-belly') return 0.36;
  if (from === 'crouch-idle' && isCycleLocomotionAnimation(to) && to.startsWith('crouch-')) return 0.50;
  if (to === 'crouch-idle' && isCycleLocomotionAnimation(from) && from.startsWith('crouch-')) return 0.50;
  if (from.startsWith('crouch-') && to.startsWith('crouch-')) return 0.26;
  if (from === 'running-slide' && to === 'slide-to-running') return 0.07;
  if (from === 'slide-to-running') return to === 'running' ? 0.10 : 0.22;
  if (from === 'running-slide' && to === 'crouch-idle') return 0.28;
  if (from === 'running' && (to === 'walking' || to === 'idle-action' || to === 'idle')) return 0.3;
  if (from === 'walking' && (to === 'idle-action' || to === 'idle')) return 0.24;
  if (isCycleLocomotionAnimation(from) && isCycleLocomotionAnimation(to)) return 0.22;
  if (isDiagonalLocomotion(from) || isDiagonalLocomotion(to)) return 0.22;
  if (to === 'standing-idle-to-fight-idle' || to === 'action-idle-to-fight-idle') return 0.10;
  if (to === 'fight-idle-to-action-idle' || to === 'fight-idle-to-standing-idle') return 0.10;
  if (from === 'standing-idle-to-fight-idle' || from === 'action-idle-to-fight-idle') return 0.12;
  if (from === 'falling-idle' && to === 'falling-to-landing') return 0.12;
  if (from === 'falling-idle' && to === 'falling-flat-impact') return 0.06;
  if (from === 'falling-to-landing') return 0.18;
  if (to === 'idle-action-to-standing-idle') return 0.42;
  if (from === 'idle-action-to-standing-idle' && to === 'idle') return 0.48;
  if (isIdleSequenceOneShot(from) || isIdleSequenceOneShot(to)) return 0.26;
  if (isPostureTransition(from) || isPostureTransition(to)) return 0.12;
  if (isTurnAnimation(from) || isTurnAnimation(to)) return 0.3;
  return 0.18;
};

const inPlaceClip = (
  source: THREE.AnimationClip,
  name: string,
  stripTurnRoot: boolean,
  hipVertical?: HipVerticalRetarget,
  hipYawCorrectionRadians = 0,
  trimEndTime?: number,
): THREE.AnimationClip => {
  // Rapier/PlayerController owns world translation. Quaternion tracks are kept
  // for body motion, but turn clips drop the Hips root rotation so a Mixamo
  // 90° clip cannot rotate the mesh independently from the controlled body yaw.
  const tracks: THREE.KeyframeTrack[] = source.tracks
    .filter((track) => track.name.endsWith('.quaternion'))
    .filter((track) => !(stripTurnRoot && /hips\.quaternion$/i.test(track.name)))
    .map((track) => stabilizeQuaternionTrack(track, hipYawCorrectionRadians, trimEndTime));

  // Crouch/slide clips need the Hips vertical channel to keep the feet near the
  // ground. Preserve Y only and retarget it to this mannequin's rest height; X/Z
  // root motion stays removed so physics remains authoritative.
  if (hipVertical) {
    const positionTrack = source.tracks.find((track) => /hips\.position$/i.test(track.name));
    if (positionTrack && positionTrack.values.length >= 3) {
      const sourceRestY = hipVertical.sourceBone.position.y;
      const targetRestY = hipVertical.targetBone.position.y;
      const scale = Math.abs(sourceRestY) > 1e-5 ? targetRestY / sourceRestY : 1;
      const values = new Float32Array(positionTrack.values.length);
      for (let i = 0; i + 2 < positionTrack.values.length; i += 3) {
        values[i] = hipVertical.targetBone.position.x;
        values[i + 1] = positionTrack.values[i + 1]! * scale;
        values[i + 2] = hipVertical.targetBone.position.z;
      }
      const verticalTrack = new THREE.VectorKeyframeTrack(`${hipVertical.targetBone.name}.position`, positionTrack.times, values);
      if (trimEndTime !== undefined) verticalTrack.trim(0, trimEndTime);
      tracks.push(verticalTrack);
    }
  }

  const clip = new THREE.AnimationClip(name, trimEndTime ?? source.duration, tracks);
  clip.optimize();
  return clip;
};

export class AnimationLab {
  private readonly root = document.createElement('main');
  private readonly scene = new THREE.Scene();
  private readonly thirdPersonCamera = new THREE.PerspectiveCamera(62, 1, 0.04, 140);
  private readonly firstPersonCamera = new THREE.PerspectiveCamera(72, 1, 0.01, 120);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance', logarithmicDepthBuffer: false });
  private readonly motionFx = document.createElement('div');
  private readonly damageFx = document.createElement('div');
  private readonly plan = createMovementLabPlan();
  private readonly authoredStairColliders = this.plan.colliders.filter((collider) => collider.kind === 'step');
  private readonly settings = loadGameSettings();
  private readonly labMaterials = createLabMaterials();
  private readonly bloodDecals = new BloodDecalSystem(this.scene);
  private readonly loader = new FBXLoader();
  private readonly avatarAnchor = new THREE.Group();
  // Dedicated render-only first-person rig. It shares animation state with the
  // world avatar but never feeds back into movement, aim, physics, or 3P pose.
  private readonly firstPersonAvatarAnchor = new THREE.Group();
  private readonly environmentMeshes: THREE.Mesh[] = [];
  private readonly cameraRaycaster = new THREE.Raycaster();
  private readonly feetPosition = new THREE.Vector3();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly desiredCameraPosition = new THREE.Vector3();
  private readonly horizontalForward = new THREE.Vector3(0, 0, -1);
  private readonly bodyForward = new THREE.Vector3(0, 0, -1);
  private readonly bodyRight = new THREE.Vector3(1, 0, 0);
  private readonly tempDirection = new THREE.Vector3();
  private readonly impactLocalPoint = new THREE.Vector3();
  private readonly impactClosestPoint = new THREE.Vector3();
  private readonly impactLocalNormal = new THREE.Vector3();
  private readonly impactWorldNormal = new THREE.Vector3();
  private readonly impactWorldPoint = new THREE.Vector3();
  private readonly impactColliderRotation = new THREE.Quaternion();
  private readonly impactColliderInverse = new THREE.Quaternion();
  private readonly corpsePlayerPosition = new THREE.Vector3();
  private readonly corpsePlayerVelocity = new THREE.Vector3();
  private readonly fallForwardAxis = new THREE.Vector3(0, 0, 1);
  private readonly fallRightAxis = new THREE.Vector3(1, 0, 0);
  private readonly tempQuaternionA = new THREE.Quaternion();
  private readonly tempQuaternionB = new THREE.Quaternion();
  private readonly tempQuaternionC = new THREE.Quaternion();
  private readonly tempQuaternionD = new THREE.Quaternion();
  private readonly combatStrikeRightAxis = new THREE.Vector3(1, 0, 0);
  private readonly combatStrikeForwardAxis = new THREE.Vector3(0, 0, 1);
  private readonly combatSweepLeftPrevious = new THREE.Vector3();
  private readonly combatSweepRightPrevious = new THREE.Vector3();
  private readonly combatSweepLeftCurrent = new THREE.Vector3();
  private readonly combatSweepRightCurrent = new THREE.Vector3();
  private readonly combatNpcHeadPoint = new THREE.Vector3();
  private readonly combatNpcChestPoint = new THREE.Vector3();
  private readonly combatNpcBodyPoint = new THREE.Vector3();
  private readonly combatPlayerHeadPoint = new THREE.Vector3();
  private readonly combatPlayerChestPoint = new THREE.Vector3();
  private readonly combatPlayerBodyPoint = new THREE.Vector3();
  private readonly npcSweepLeftPrevious = new THREE.Vector3();
  private readonly npcSweepRightPrevious = new THREE.Vector3();
  private readonly npcSweepLeftCurrent = new THREE.Vector3();
  private readonly npcSweepRightCurrent = new THREE.Vector3();
  private npcHandSweepReady = false;
  private readonly combatStrikeShoulderPoint = new THREE.Vector3();
  private readonly combatStrikeHandPoint = new THREE.Vector3();
  private readonly combatStrikeDesiredPoint = new THREE.Vector3();
  private readonly combatStrikeDesiredDir = new THREE.Vector3();
  private readonly animations = new Map<AnimationId, LoadedAnimation>();
  private readonly firstPersonAnimations = new Map<AnimationId, LoadedAnimation>();
  private readonly gaitTransition = new GaitTransition();
  private readonly gaitLandmarks = new Map<AnimationId, number>();
  private readonly crouchGaitReferenceSpeeds = new Map<AnimationId, number>();
  private readonly locomotionHeelLocal = [new THREE.Vector3(), new THREE.Vector3()];
  private visualRunning = false;
  private readonly locomotionPreviousVelocity = new THREE.Vector3();
  private locomotionPitch = 0;
  private locomotionRoll = 0;
  private readonly gaitFootPlants = [
    { point: new THREE.Vector3(), locked: false, weight: 0 },
    { point: new THREE.Vector3(), locked: false, weight: 0 },
  ];
  private combatUpperLayer?: CombatLayerPair;
  private readonly combatLowerLayers = new Map<CombatLowerAnimation, CombatLayerPair>();
  private readonly combatAttackLayers = new Map<CombatAttackAnimation, CombatLayerPair>();
  private readonly combatAttackStrikingSides = new Map<CombatAttackAnimation, CombatStrikeSide>();
  private combatDodgeLayer?: CombatLayerPair;
  private combatDodge: ActiveCombatDodge | null = null;
  private groundKick: ActiveGroundKick | null = null;
  private lastGroundKickSide: CombatStrikeSide = 'left';
  private readonly groundKickTargetPoint = new THREE.Vector3();
  private readonly groundKickTargetHead = new THREE.Vector3();
  private readonly groundKickTargetPelvis = new THREE.Vector3();
  private readonly groundKickFootPrevious = new THREE.Vector3();
  private readonly groundKickFootCurrent = new THREE.Vector3();
  private groundKickFootReady = false;
  private combatAttack: ActiveMeleeAttack | null = null;
  private combatAttackAction?: CombatLayerPair;
  private combatAttackAimYaw = 0;
  private combatAttackStartBodyYaw = 0;
  private combatGazeYaw: number | null = null;
  private actionFacingReturnActive = false;
  private actionFacingReturnSeconds = 0;
  private combatAttackEntryForwardSpeed = 0;
  private combatAttackEntryRightSpeed = 0;
  private combatAttackRecoverySeconds = 0;
  private combatBufferedPunchSeconds = 0;
  private readonly playerBalance = new CombatBalance();
  private readonly npcBalance = new CombatBalance();
  private readonly playerProceduralPose = new CombatProceduralPose();
  private readonly firstPersonProceduralPose = new CombatProceduralPose();
  private readonly npcProceduralPose = new CombatProceduralPose();
  private readonly playerHitHandoff = new CombatPoseHandoff();
  private readonly firstPersonHitHandoff = new CombatPoseHandoff();
  private readonly npcHitHandoff = new CombatPoseHandoff();
  private readonly npcMotionHistory = new CombatMotionHistory();
  private combatPreviousTargets: { player: THREE.Vector3[] | null; npc: THREE.Vector3[] | null } = { player: null, npc: null };
  private playerImpactPitch: [number, number] = [0, 0];
  private playerImpactRoll: [number, number] = [0, 0];
  private npcImpactPitch: [number, number] = [0, 0];
  private npcImpactRoll: [number, number] = [0, 0];
  private playerImpactZone: CombatHitZone = 'upper-body';
  private npcImpactZone: CombatHitZone = 'upper-body';
  private combatHandSweepReady = false;
  private combatLockOnActive = false;
  private combatLockOnDistance = Number.POSITIVE_INFINITY;
  private combatComboIndex = 0;
  private combatLastPunchFinishedAt = Number.NEGATIVE_INFINITY;
  private lastPunchVariant: CombatAttackAnimation | null = null;
  private lastBigPunchVariant: CombatAttackAnimation | null = null;
  private lastHookVariant: CombatAttackAnimation | null = null;
  private readonly punchVariantBag: CombatAttackAnimation[] = [];
  private readonly recentPunchVariants: CombatAttackAnimation[] = [];
  private readonly farPunchVariantBag: CombatAttackAnimation[] = [];
  private readonly closeShoveVariantBag: CombatAttackAnimation[] = [];
  private readonly bigPunchVariantBag: CombatAttackAnimation[] = [];
  private readonly hookVariantBag: CombatAttackAnimation[] = [];
  private lastPlayerHitReaction: HitAnimationId | null = null;
  private lastNpcHitReaction: HitAnimationId | null = null;
  private combatLeftPointerHeld = false;
  private combatHeldChainCount = 0;
  private combatBufferedFromHold = false;
  private combatHeldRestSeconds = 0;
  private readonly combatImpactAudio = new CombatImpactAudio();
  private combatLeftPressStart = 0;
  private combatLeftPressConsumed = false;
  private combatCounterModifierHeld = false;
  private readonly combatHeavyTapDetector = new CombatHeavyTapDetector();
  private readonly forwardLateralAnimationGate = new ForwardLateralAnimationGate();
  private visualMovementRightIntent = 0;
  private combatHeavyUpgradePending = false;
  private combatClock = 0;
  private combatHitReaction: HitAnimationId | null = null;
  private combatHitReactionDuration = 0;
  private combatHitReactionElapsed = 0;
  private combatCounterGuaranteedTarget = false;
  private combatCounterDodgeSide = 1;
  private combatLowerActive: CombatLowerAnimation | null = null;
  private combatLowerReverse = false;
  private combatPhase: CombatPhase = 'none';
  private combatPointerHeld = false;
  private combatLatchSeconds = 0;
  private combatLatchReason: CombatLatchReason = null;
  private combatPostGuardMoveSeconds = 0;
  private combatResumeMode: CombatIdleResumeMode = 'sleeping';
  private combatTransition: AnimationId | null = null;
  private readonly firstPersonClipUniforms: Array<{ clipY: { value: number }; combatIsolation: { value: number }; groundKick: { value: number } }> = [];
  private readonly firstPersonHipWorld = new THREE.Vector3();
  private readonly firstPersonHipTarget = new THREE.Vector3();
  private readonly firstPersonForward = new THREE.Vector3();
  private readonly firstPersonRight = new THREE.Vector3();
  private readonly firstPersonViewRight = new THREE.Vector3();
  private readonly firstPersonCombatHandCenter = new THREE.Vector3();
  private readonly firstPersonCombatHandA = new THREE.Vector3();
  private readonly firstPersonCombatHandB = new THREE.Vector3();
  private readonly firstPersonCombatDepthVectorA = new THREE.Vector3();
  private readonly firstPersonCombatDepthVectorB = new THREE.Vector3();
  private readonly firstPersonArmSafetyBonePosition = new THREE.Vector3();
  private readonly firstPersonArmSafetyViewForward = new THREE.Vector3();
  private firstPersonCombatFramingSettleSeconds = 0;
  private firstPersonCombatFramingLocked = false;
  private firstPersonCombatFramingWasVisible = false;
  private firstPersonCombatLateralOffset = 0;
  private firstPersonCombatDepthOffset = 0;
  private firstPersonCombatVerticalOffset = 0;
  private readonly firstPersonFootWorldA = new THREE.Vector3();
  private readonly firstPersonFootWorldB = new THREE.Vector3();
  private readonly firstPersonFootLockTarget = new THREE.Vector3();
  private readonly firstPersonFootLockCurrent = new THREE.Vector3();
  private readonly firstPersonFootLockCorrection = new THREE.Vector3();
  private readonly firstPersonBaseScale = new THREE.Vector3(1, 1, 1);
  private readonly animationButtons = new Map<AnimationId, HTMLButtonElement>();
  private readonly stats = new Map<string, HTMLElement>();
  private readonly viewButtons = new Map<ViewMode, HTMLButtonElement>();
  private physics?: PhysicsWorld;
  private player?: PlayerController;
  private mixer?: THREE.AnimationMixer;
  private firstPersonMixer?: THREE.AnimationMixer;
  private character?: THREE.Group;
  private firstPersonCharacter?: THREE.Group;
  private skeletonHelper?: THREE.SkeletonHelper;
  private upperSpineBone?: THREE.Bone;
  private combatSpineBone?: THREE.Bone;
  private combatSpine1Bone?: THREE.Bone;
  private combatSpine2Bone?: THREE.Bone;
  private firstPersonCombatSpineBone?: THREE.Bone;
  private firstPersonCombatSpine1Bone?: THREE.Bone;
  private firstPersonCombatSpine2Bone?: THREE.Bone;
  private readonly combatFightHipsReference = new THREE.Quaternion();
  private combatFightHipsReferenceReady = false;
  private combatFightHipsInterpolant?: THREE.Interpolant;
  private combatFightHipsDuration = 1;
  private readonly firstPersonCombatHipsSample = new THREE.Quaternion();
  private firstPersonCombatReleaseSeconds = 0;
  private neckBone?: THREE.Bone;
  private headBone?: THREE.Bone;
  private readonly combatHeadLocalForward = new THREE.Vector3(0, 0, 1);
  private hipsBone?: THREE.Bone;
  private firstPersonHipsBone?: THREE.Bone;
  private firstPersonLeftUpperLegBone?: THREE.Bone;
  private firstPersonRightUpperLegBone?: THREE.Bone;
  private firstPersonLeftLowerLegBone?: THREE.Bone;
  private firstPersonRightLowerLegBone?: THREE.Bone;
  private firstPersonLeftFootBone?: THREE.Bone;
  private firstPersonRightFootBone?: THREE.Bone;
  private readonly firstPersonShoulderBones: THREE.Bone[] = [];
  private readonly firstPersonUpperArmBones: THREE.Bone[] = [];
  private readonly firstPersonForearmBones: THREE.Bone[] = [];
  private readonly firstPersonHandBones: THREE.Bone[] = [];
  private firstPersonFootToSole = 0.075;
  private firstPersonViewmodelScale = FIRST_PERSON_VIEWMODEL_STAND_SCALE;
  private firstPersonHighFallBlend = 0;
  private firstPersonFreelookCenterOffset = 0;
  private firstPersonActionIdleBodyOffsetBlend = 0;
  private firstPersonCombatPoseBlend = 0;
  private firstPersonArmSafetyForwardOffset = 0;
  private firstPersonFootLockGroup: 'standing' | 'crouch' | null = null;
  private firstPersonFootLockBone?: THREE.Bone;
  private leftUpperArmBone?: THREE.Bone;
  private rightUpperArmBone?: THREE.Bone;
  private leftForearmBone?: THREE.Bone;
  private rightForearmBone?: THREE.Bone;
  private leftHandBone?: THREE.Bone;
  private rightHandBone?: THREE.Bone;
  private firstPersonLeftUpperArmBone?: THREE.Bone;
  private firstPersonRightUpperArmBone?: THREE.Bone;
  private firstPersonLeftForearmBone?: THREE.Bone;
  private firstPersonRightForearmBone?: THREE.Bone;
  private firstPersonLeftHandBone?: THREE.Bone;
  private firstPersonRightHandBone?: THREE.Bone;
  private leftUpperLegBone?: THREE.Bone;
  private rightUpperLegBone?: THREE.Bone;
  private leftLowerLegBone?: THREE.Bone;
  private rightLowerLegBone?: THREE.Bone;
  private leftFootBone?: THREE.Bone;
  private rightFootBone?: THREE.Bone;
  private readonly ragdollMotionBones: THREE.Bone[] = [];
  private ragdollMotionPrevious?: Map<string, RagdollBonePoseSample>;
  private ragdollMotionCurrent?: Map<string, RagdollBonePoseSample>;
  private ragdollMotionDelta = 0;
  private currentAction?: THREE.AnimationAction;
  private firstPersonCurrentAction?: THREE.AnimationAction;
  private ragdoll?: RagdollSystem;
  private ragdollMode: RagdollMode | null = null;
  private recovery: GetUpRecovery | null = null;
  private recoveryStandPosition: THREE.Vector3 | null = null;
  private recoveryGroundAvailable = false;
  private recoveryRequested = false;
  // Exact live capsule center captured immediately before a non-fatal ragdoll.
  // It is a reliable recovery fallback for combat knockdowns if the physical
  // body slides away from the NPC and the local clearance query is temporarily
  // blocked by dynamic bodies. Deep pit falls are still rejected by distance.
  private readonly recoveryEntryStandPosition = new THREE.Vector3();
  private recoveryEntryStandValid = false;
  private recoveryHandoffClip?: THREE.AnimationClip;
  private recoveryHandoffCleanup = 0;
  private recoveryCameraBlend = -1;
  private readonly recoveryCameraStartPosition = new THREE.Vector3();
  private readonly recoveryCameraStartRotation = new THREE.Quaternion();
  private readonly recoveryCameraTargetPosition = new THREE.Vector3();
  private readonly recoveryCameraTargetRotation = new THREE.Quaternion();
  private recoveryPrompt?: HTMLElement;
  private readonly recoveryRestHipsRotation = new THREE.Quaternion();
  private readonly recoveryPelvisRotation = new THREE.Quaternion();
  private readonly recoveryFront = new THREE.Vector3();
  private readonly recoveryWorldUp = new THREE.Vector3(0, 1, 0);
  private ragdollDamageApplied = false;
  private ragdollFallPeakY = 0;
  private ragdollFallDistance = 0;
  private ragdollElapsed = 0;
  private bloodDecalCooldown = 0;
  private readonly bloodImpactGate = new BloodImpactGate();
  private bloodImpactClock = 0;
  private pitEdgeRisk = 0;
  // Briefly remembers a clearly deliberate edge approach so crossing the lip or
  // releasing input for a moment does not instantly reclassify it as an accident.
  private pitControlGrace = 0;
  private activePitEdge: PitEdgeAnalysis | null = null;
  private readonly pitRagdollExtraVelocity = new THREE.Vector3();
  private activeCorpseRoot?: THREE.Group;
  private readonly corpses: PersistentCorpse[] = [];
  private respawnElapsed = 0;
  private idleNpcAnchor?: THREE.Group;
  private idleNpcCharacter?: THREE.Group;
  private idleNpcMixer?: THREE.AnimationMixer;
  private idleNpcHeadBone?: THREE.Bone;
  private idleNpcHipsBone?: THREE.Bone;
  private idleNpcSpineBone?: THREE.Bone;
  private idleNpcSpine1Bone?: THREE.Bone;
  private idleNpcSpine2Bone?: THREE.Bone;
  private idleNpcLeftUpperArmBone?: THREE.Bone;
  private idleNpcRightUpperArmBone?: THREE.Bone;
  private idleNpcLeftForearmBone?: THREE.Bone;
  private idleNpcRightForearmBone?: THREE.Bone;
  private idleNpcLeftHandBone?: THREE.Bone;
  private idleNpcRightHandBone?: THREE.Bone;
  private readonly idleNpcActions = new Map<AnimationId, THREE.AnimationAction>();
  private readonly idleNpcCombatAttackActions = new Map<CombatAttackAnimation, THREE.AnimationAction>();
  private idleNpcCombatUpperAction?: THREE.AnimationAction;
  private readonly idleNpcCombatLowerActions = new Map<CombatLowerAnimation, THREE.AnimationAction>();
  private npcCombatLowerActive: CombatLowerAnimation | null = null;
  private npcCombatLowerReverse = false;
  private lastNpcPunchVariant: CombatAttackAnimation | null = null;
  private lastNpcBigPunchVariant: CombatAttackAnimation | null = null;
  private readonly npcPunchVariantBag: CombatAttackAnimation[] = [];
  private readonly npcFarPunchVariantBag: CombatAttackAnimation[] = [];
  private readonly npcClosePunchVariantBag: CombatAttackAnimation[] = [];
  private readonly npcBigPunchVariantBag: CombatAttackAnimation[] = [];
  private readonly idleNpcBasePose = new Map<string, NpcBonePose>();
  private npcCombatButton?: HTMLButtonElement;
  private npcCombatEnabled = false;
  private npcCombatPhase: NpcCombatPhase = 'idle';
  private npcHealth = MAX_HEALTH;
  private npcCurrentAnimation: AnimationId = 'idle';
  private npcCurrentAction?: THREE.AnimationAction;
  private npcAttack: ActiveMeleeAttack | null = null;
  private npcAttackCooldown = 0;
  private npcAttackRecoverySeconds = 0;
  private npcBufferedPunchSeconds = 0;
  private npcComboChainCount = 0;
  private npcComboTargetLength = 1;
  private npcComboIndex = 0;
  private readonly npcRecentPunchVariants: CombatAttackAnimation[] = [];
  private npcChainQueuedForCurrentAttack = false;
  private npcHitReaction: HitAnimationId | null = null;
  private npcHitReactionDuration = 0;
  private npcHitReactionElapsed = 0;
  private npcConsecutivePlayerHits = 0;
  private npcLastPlayerHitAt = Number.NEGATIVE_INFINITY;
  private playerConsecutiveNpcHits = 0;
  private playerLastNpcHitAt = Number.NEGATIVE_INFINITY;
  private npcRagdoll?: RagdollSystem;
  private npcRecovery: GetUpRecovery | null = null;
  private npcDownElapsed = 0;
  private npcGroundKickRecoveryDelay = 0;
  private npcResumeCombatAfterRecovery = false;
  private readonly npcRecoveryRestHipsRotation = new THREE.Quaternion();
  private readonly npcRecoveryFront = new THREE.Vector3();
  private readonly npcToPlayer = new THREE.Vector3();
  private readonly npcBlockerCenter = new THREE.Vector3();
  private readonly npcHitDirection = new THREE.Vector3();
  private readonly npcSpacingPushDirection = new THREE.Vector3();
  private npcSpacingPushSeconds = 0;
  private npcSpacingPushSpeed = 0;
  private readonly meleeTargetPosition = new THREE.Vector3();
  private readonly meleeOrigin = new THREE.Vector3();
  private readonly meleeForward = new THREE.Vector3();
  private readonly deadHeadPosition = new THREE.Vector3();
  private readonly deadHeadRotation = new THREE.Quaternion();
  private readonly deadCameraHeadCorrection = new THREE.Quaternion();
  private readonly deadCameraHeadOffset = new THREE.Vector3();
  private readonly deadCameraTargetPosition = new THREE.Vector3();
  private readonly deadCameraLookOffset = new THREE.Quaternion();
  private readonly deadCameraForward = new THREE.Vector3();
  private readonly deadCameraUp = new THREE.Vector3();
  private readonly deadCameraFaceForwardLocal = new THREE.Vector3();
  private readonly deadCameraFaceForwardWorld = new THREE.Vector3();
  private readonly deadCameraRelative = new THREE.Vector3();
  private deadAimYaw = 0;
  private deadAimPitch = 0;
  private killButton?: HTMLButtonElement;
  private currentAnimation: AnimationId = 'idle';
  private currentAnimationElapsed = 0;
  private autoCandidate: AnimationId = 'idle';
  private autoCandidateElapsed = 0;
  private playbackMode: PlaybackMode = 'auto';
  private forcedAnimation: AnimationId = 'idle';
  private viewMode: ViewMode = 'third-person';
  private bodyTurning = false;
  private bodyTurnRate = 0;
  private headLookYaw = 0;
  private lookOffsetDegrees = 0;
  private continuousViewYaw = 0;
  private bodyYaw = 0;
  private postureStateInitialized = false;
  private wasLowVisual = false;
  private wasAirborne = false;
  private airborneAnimation: AnimationId | null = null;
  private airborneAnimationRate = 1;
  private autoOneShot: AnimationId | null = null;
  private pendingStrongTurn: AnimationId | null = null;
  private strongTurnLatched = false;
  private activeAuthoredTurn: AnimationId | null = null;
  // After a first-person Action-Idle turn, keep the final authored foot stance
  // instead of immediately forcing the canonical idle-action pose back under
  // the POV. The held stance remains valid while stationary/free-looking and
  // yields as soon as another real animation/state needs the mixer.
  private settledActionTurnPose: AnimationId | null = null;
  private activeTurnStartBodyYaw = 0;
  private activeTurnResumeMode: IdleResumeMode = 'action';
  private wasSliding = false;
  private slideVisualSettled = false;
  private slideRecoveryBlendStart = 0;
  private slideRecoverySource?: THREE.AnimationClip;
  private slideSprintExitPhase = 0;
  private idleResumeMode: IdleResumeMode = 'sleeping';
  private idleNeedsEntry = false;
  private idleSequencePhase: IdleSequencePhase = 'sleeping';
  private idleSequenceElapsed = 0;
  private idleSequenceOneShot: AnimationId | null = null;
  private lastIdleLookAnimation: AnimationId | null = null;
  private idleLookMovedThisFrame = false;
  private previousIdleLookPitchDegrees = 0;
  private previousLookActivitySerial = 0;
  private cameraDistance = 4.4;
  private cameraHeight = 1.55;
  private cameraBoomLength = Math.hypot(4.4, 1.55);
  private playbackSpeed = 1;
  private fallPoseBlend = 0;
  private landingVisualImpulse = 0;
  private landingAnimationPending: AnimationId | null = null;
  private severeImpactLocked = false;
  private previousTime = performance.now();
  private accumulator = 0;
  private fps = 60;
  private hudTimer = 0;
  private disposed = false;
  private ready = false;
  private panelVisible = true;
  private panel?: HTMLElement;
  private hint?: HTMLElement;
  private modeButton?: HTMLButtonElement;
  private animsButton?: HTMLButtonElement;
  private speedOutput?: HTMLElement;
  private health = MAX_HEALTH;
  private secondsSinceDamage = Number.POSITIVE_INFINITY;
  private damageFlash = 0;
  private firstPersonMeleeHitBloodFlash = 0;
  private firstPersonMeleeHitBloodSide = 0;
  private firstPersonMeleeHitKickElapsed = FIRST_PERSON_MELEE_HIT_KICK_SECONDS;
  private firstPersonMeleeHitKickYaw = 0;
  private firstPersonMeleeHitKickPitch = 0;
  private firstPersonMeleeHitKickRoll = 0;
  private readonly firstPersonMeleeHitKickEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly firstPersonMeleeHitKickQuaternion = new THREE.Quaternion();
  private landingAnimationRate = 1;
  private landingAnimationEndFraction = 1;

  constructor(private readonly container: HTMLElement) {
    this.root.className = 'animation-lab';
    this.renderer.domElement.className = 'animation-lab__canvas';
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Keep the movement lab on the exact renderer lighting policy used by Game.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = false;
    this.root.append(this.renderer.domElement);
    this.motionFx.className = 'animation-lab__motion-fx';
    this.root.append(this.motionFx);
    this.damageFx.className = 'animation-lab__damage-fx';
    this.root.append(this.damageFx);
    const recoveryPrompt = document.createElement('div');
    recoveryPrompt.className = 'interaction-prompt animation-lab__get-up-prompt';
    recoveryPrompt.setAttribute('role', 'status');
    recoveryPrompt.setAttribute('aria-hidden', 'true');
    recoveryPrompt.innerHTML = '<kbd>E</kbd><span>Se relever</span>';
    this.recoveryPrompt = recoveryPrompt;
    this.root.append(recoveryPrompt);
    this.container.append(this.root);
    this.avatarAnchor.name = 'AnimationLabAvatarAnchor';
    this.firstPersonAvatarAnchor.name = 'AnimationLabFirstPersonAvatarAnchor';
    this.firstPersonAvatarAnchor.visible = false;
    this.scene.add(this.avatarAnchor);
    this.scene.add(this.firstPersonAvatarAnchor);
    this.configureScene();
    this.createHud();
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onGlobalKeyDown);
    window.addEventListener('keyup', this.onGlobalKeyUp);
    window.addEventListener('mousedown', this.onCombatMouseDown);
    window.addEventListener('mouseup', this.onCombatMouseUp);
    window.addEventListener('blur', this.onCombatWindowBlur);
    this.renderer.domElement.addEventListener('contextmenu', this.onCombatContextMenu);
    this.renderer.domElement.addEventListener('click', this.onCanvasClick);
  }

  async initialize(): Promise<void> {
    const physics = await PhysicsWorld.create(this.plan);
    if (this.disposed) {
      physics.dispose();
      return;
    }
    this.physics = physics;

    this.firstPersonCamera.position.set(MOVEMENT_LAB_SPAWN.x, 1.6, MOVEMENT_LAB_SPAWN.z);
    this.firstPersonCamera.lookAt(-8, 1.35, -7);
    this.player = new PlayerController(this.firstPersonCamera, this.renderer.domElement, physics, {
      onLockChange: this.onPlayerLockChange,
      onFootstep: () => undefined,
      onInteract: () => undefined,
      onLand: (strength, impact) => this.handleLandingAnimation(strength, impact),
      onSafePosition: () => undefined,
      onFallReset: () => undefined,
    });
    this.player.setInputEnabled(false);
    this.player.setFieldOfView(this.settings.fieldOfView);
    this.player.setLookSensitivity(this.settings.lookSensitivity);
    this.player.setControlBindings(this.settings.controls);
    this.applyViewMode(true);

    this.updateAvatarTransform(0, true);
    this.updateThirdPersonCamera(0, true);
    this.renderer.setAnimationLoop(this.frame);
    this.updateHud();

    try {
      await this.loadCharacterAndAnimations();
      if (this.disposed) return;
      this.ready = true;
      this.playAnimation('idle', true);
      this.updateAvatarTransform(0, true);
      this.setStatus('PRÊT');
      if (this.hint) this.hint.innerHTML = '<strong>CLIQUER POUR JOUER</strong><span>ZQSD : déplacement · clic droit : garde · clic gauche en garde : frappe / maintenir : enchaîner · sans capture souris : clic droit maintenu pour regarder · Échap : pause</span>';
    } catch (error) {
      this.setStatus('ERREUR ASSET');
      if (this.hint) this.hint.innerHTML = `<strong>ERREUR DE CHARGEMENT</strong><span>${error instanceof Error ? error.message : String(error)}</span>`;
      throw error;
    }
  }

  private configureScene(): void {
    // These values intentionally mirror src/core/Game.ts in the real Backrooms
    // project. The production renderer keeps shadow maps disabled and relies on
    // broad fill + a soft shadowless key. The player intentionally has no
    // dedicated blob/contact shadow in this lab.
    const legacyLighting = this.settings.lighting === 'legacy';
    const atmosphere = (legacyLighting ? BACKROOMS_LEGACY_ATMOSPHERE : BACKROOMS_ATMOSPHERE).yellow;
    this.scene.background = new THREE.Color(atmosphere.background);
    this.scene.fog = new THREE.FogExp2(atmosphere.fog, legacyLighting ? 0.0042 : 0.0015);

    const hemisphere = new THREE.HemisphereLight(
      atmosphere.hemisphereSky,
      atmosphere.hemisphereGround,
      legacyLighting ? 0.17 : 0.14,
    );
    hemisphere.name = 'liminal-ambient-field';
    this.scene.add(hemisphere);

    const ambient = new THREE.AmbientLight(atmosphere.ambient, legacyLighting ? 0.018 : 0.055);
    ambient.name = 'indirect-carpet-bounce';
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(atmosphere.key, legacyLighting ? 0.07 : 0.22);
    key.name = 'soft-fluorescent-key';
    key.position.set(legacyLighting ? 3.5 : 4.5, legacyLighting ? 8 : 7.5, legacyLighting ? 2.5 : 3.2);
    key.castShadow = false;
    this.scene.add(key);

    for (const collider of this.plan.colliders) {
      const mesh = meshForCollider(collider, this.labMaterials);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.environmentMeshes.push(mesh);
      this.scene.add(mesh);
    }

    addBackroomsLabDecor(this.scene, this.labMaterials);
  }

  private createHud(): void {
    const controls = this.settings.controls;
    const panel = document.createElement('aside');
    panel.className = 'animation-lab__panel';
    panel.innerHTML = `
      <div class="animation-lab__title"><div><strong>MOVEMENT + ANIMATION LAB</strong><span>SAME PLAYERCONTROLLER · BODYCAM + THIRD PERSON</span></div></div>
      <div class="animation-lab__stats">
        <span>STATUS</span><b data-stat="status">CHARGEMENT…</b>
        <span>VUE</span><b data-stat="view">3RD PERSON</b>
        <span>MODE PANEL</span><b data-stat="playback">AUTO</b>
        <span>ANIMATION</span><b data-stat="animation">IDLE</b>
        <span>MOUVEMENT</span><b data-stat="movement">IDLE</b>
        <span>VITESSE</span><b data-stat="speed">0.00 m/s</b>
        <span>SANTÉ</span><b data-stat="health">100 / 100</b>
        <span>NPC</span><b data-stat="npc">100 / 100 · PASSIF</b>
        <span>CHUTE</span><b data-stat="fall">—</b>
        <span>BORD TROU</span><b data-stat="pit-risk">OK</b>
        <span>LOCAL BODY</span><b data-stat="local">F +0.00 · R +0.00</b>
        <span>REGARD / CORPS</span><b data-stat="look-offset">0°</b>
        <span>TURN CORPS</span><b data-stat="turn">0°/s</b>
        <span>FPS</span><b data-stat="fps">60</b>
      </div>
      <div class="animation-lab__toolbar">
        <button type="button" data-mode="auto" class="is-active">AUTO LOCOMOTION</button>
        <button type="button" data-action="rig">SQUELETTE: OFF</button>
      </div>
      <div class="animation-lab__range">
        <label><span>VITESSE ANIM</span><output data-output="speed">1.00×</output></label>
        <input data-range="speed" type="range" min="0.25" max="2" step="0.05" value="1">
      </div>
      <div class="animation-lab__range">
        <label><span>DISTANCE CAM 3RD</span><output data-output="distance">4.4 m</output></label>
        <input data-range="distance" type="range" min="2.4" max="7" step="0.1" value="4.4">
      </div>
      <div class="animation-lab__clips" data-clips></div>
      <p class="animation-lab__controls">
        ${formatKeyLabel(controls.forward)}${formatKeyLabel(controls.left)}${formatKeyLabel(controls.backward)}${formatKeyLabel(controls.right)} déplacement ·
        ${formatKeyLabel(controls.sprint)} sprint avant · diagonales Z+Q/Z+D · Q/D limités · ${formatKeyLabel(controls.jump)} saut · ${formatKeyLabel(controls.crouch)} crouch/slide · souris regard · A/E lean bodycam · clic droit garde + focus cible · clic gauche en garde frappe / maintenir pour enchaîner · double clic en garde coup appuyé · maintenir F + clic gauche face à une attaque = esquive/contre hook · E se relever au sol · P KILL · Échap panneau
      </p>
      <p class="animation-lab__note">AUTO : en 1ST, Action Idle garde beaucoup plus de marge à gauche qu’à droite avant le turn. Les turns Action et Sleeping utilisent chacun leurs propres appuis et suivent la rotation réelle de la POV. Le mouvement de tête remet le timer AFK à zéro tant qu’on est en Action Idle ; une fois en Sleeping Idle, on peut regarder et tourner sur place sans en sortir. Après 2,5 s totalement immobile → Wait aléatoire → transition ralentie → Sleeping Idle ; les Looking se jouent ensuite toutes les 5 s d’inactivité.</p>
    `;
    this.panel = panel;
    for (const element of panel.querySelectorAll<HTMLElement>('[data-stat]')) this.stats.set(element.dataset.stat!, element);

    const clips = panel.querySelector<HTMLElement>('[data-clips]')!;
    for (const entry of ANIMATIONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.animation = entry.id;
      button.textContent = entry.label;
      button.addEventListener('click', () => this.forceAnimation(entry.id));
      clips.append(button);
      this.animationButtons.set(entry.id, button);
    }

    this.modeButton = panel.querySelector<HTMLButtonElement>('[data-mode="auto"]')!;
    this.modeButton.addEventListener('click', () => this.enableAutoMode());
    panel.querySelector<HTMLButtonElement>('[data-action="rig"]')!.addEventListener('click', (event) => {
      if (!this.skeletonHelper) return;
      this.skeletonHelper.visible = !this.skeletonHelper.visible;
      (event.currentTarget as HTMLButtonElement).textContent = `SQUELETTE: ${this.skeletonHelper.visible ? 'ON' : 'OFF'}`;
    });

    const speedRange = panel.querySelector<HTMLInputElement>('[data-range="speed"]')!;
    this.speedOutput = panel.querySelector<HTMLElement>('[data-output="speed"]')!;
    speedRange.addEventListener('input', () => {
      this.playbackSpeed = Number(speedRange.value);
      this.speedOutput!.textContent = `${this.playbackSpeed.toFixed(2)}×`;
      if (this.playbackMode === 'forced' && this.currentAction) this.currentAction.setEffectiveTimeScale(this.playbackSpeed);
    });

    const distanceRange = panel.querySelector<HTMLInputElement>('[data-range="distance"]')!;
    const distanceOutput = panel.querySelector<HTMLElement>('[data-output="distance"]')!;
    distanceRange.addEventListener('input', () => {
      this.cameraDistance = Number(distanceRange.value);
      distanceOutput.textContent = `${this.cameraDistance.toFixed(1)} m`;
    });

    this.root.append(panel);

    const switcher = document.createElement('nav');
    switcher.className = 'animation-lab__switcher';
    switcher.innerHTML = `
      <button type="button" data-switch="anims" class="is-active">ANIMS</button>
      <button type="button" data-action="kill" class="animation-lab__kill" title="Mort physique instantanée (P)">KILL</button>
      <button type="button" data-action="npc-combat">NPC COMBAT: OFF</button>
      <button type="button" data-view="first-person">1ST PERSON</button>
      <button type="button" data-view="third-person" class="is-active">3RD PERSON</button>
    `;
    this.animsButton = switcher.querySelector<HTMLButtonElement>('[data-switch="anims"]')!;
    this.animsButton.addEventListener('click', () => this.setPanelVisible(!this.panelVisible));
    this.killButton = switcher.querySelector<HTMLButtonElement>('[data-action="kill"]')!;
    this.killButton.addEventListener('click', () => this.killPlayer());
    this.npcCombatButton = switcher.querySelector<HTMLButtonElement>('[data-action="npc-combat"]')!;
    this.npcCombatButton.addEventListener('click', () => this.toggleNpcCombat());
    for (const button of switcher.querySelectorAll<HTMLButtonElement>('[data-view]')) {
      const mode = button.dataset.view as ViewMode;
      this.viewButtons.set(mode, button);
      button.addEventListener('click', () => this.setViewMode(mode));
    }
    this.root.append(switcher);

    this.updateHealthUi();

    const hint = document.createElement('button');
    hint.type = 'button';
    hint.addEventListener('click', this.onCanvasClick);
    hint.className = 'animation-lab__hint';
    hint.innerHTML = '<strong>CHARGEMENT DU PERSONNAGE…</strong><span>Movement Lab + MakeHuman / Mixamo locomotion</span>';
    this.hint = hint;
    this.root.append(hint);
  }

  private setPanelVisible(visible: boolean): void {
    this.panelVisible = visible;
    this.panel?.classList.toggle('is-collapsed', !visible);
    this.animsButton?.classList.toggle('is-active', visible);
  }

  private setViewMode(mode: ViewMode): void {
    if (this.viewMode === mode) return;
    this.viewMode = mode;
    if (this.recoveryCameraBlend >= 0 && mode === 'third-person') {
      this.recoveryCameraBlend = -1;
      if (this.player) this.player.setInputEnabled(this.player.isLocked);
    }
    this.applyViewMode(false);
  }

  private applyViewMode(snap: boolean): void {
    const firstPerson = this.viewMode === 'first-person';
    for (const [mode, button] of this.viewButtons) button.classList.toggle('is-active', mode === this.viewMode);

    // The guard pitch limiter belongs exclusively to the live first-person combat POV.
    // Never let it leak into third person, ragdoll/get-up cameras or normal exploration.
    if (!firstPerson || this.ragdoll || this.recovery) this.player?.setCombatGuardLookConstraint(false);

    if (this.ragdoll || this.recovery) {
      // Death always renders the real world skeleton. The 1P presentation rig is
      // intentionally bypassed so the camera follows the same physical body seen
      // by third person instead of a second, non-physical copy.
      this.player?.setCameraMotionEnabled(false);
      // The physical corpse is a separate skeleton clone. Keep the reusable live
      // avatar hidden until the 5 s respawn so the old body can remain forever.
      this.avatarAnchor.visible = false;
      this.firstPersonAvatarAnchor.visible = false;
      if (firstPerson) this.updateDeadFirstPersonCamera(0, snap);
      else this.updateThirdPersonCamera(0, snap);
      return;
    }

    this.player?.setCameraMotionEnabled(firstPerson);
    // The world avatar is never modified for first person. 3P always sees the
    // original rig/pose, while 1P swaps to a second render-only skeleton.
    this.avatarAnchor.visible = !firstPerson;
    this.firstPersonAvatarAnchor.visible = firstPerson;
    if (firstPerson) this.updateFirstPersonBodyTransform(0, true);
    else this.updateThirdPersonCamera(0, snap);
  }

  private async loadCharacterAndAnimations(): Promise<void> {
    const character = await this.loader.loadAsync(`${ASSET_ROOT}/character.fbx`);
    const firstPersonCharacter = await this.loader.loadAsync(`${ASSET_ROOT}/character.fbx`);
    const idleNpcCharacter = await this.loader.loadAsync(`${ASSET_ROOT}/character.fbx`);
    if (this.disposed) return;
    character.name = 'AnimationLabCharacter';
    firstPersonCharacter.name = 'AnimationLabFirstPersonCharacter';
    idleNpcCharacter.name = 'AnimationLabIdleNpcCharacter';
    this.fitCharacterToMeters(character);
    this.fitCharacterToMeters(firstPersonCharacter);
    this.fitCharacterToMeters(idleNpcCharacter);
    // First-person is a presentation view-model, not a second world avatar.
    // Keep the fitted character scale as a stable base. Presentation scale is
    // applied dynamically: fuller while standing, much smaller while crouched.
    this.firstPersonBaseScale.copy(firstPersonCharacter.scale);
    this.firstPersonViewmodelScale = FIRST_PERSON_VIEWMODEL_STAND_SCALE;
    firstPersonCharacter.updateMatrixWorld(true);
    character.traverse((object) => {
      const normalizedName = object.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const bone = object as THREE.Bone;
      if (bone.isBone) this.ragdollMotionBones.push(bone);
      if (bone.isBone && normalizedName.endsWith('spine') && !normalizedName.endsWith('spine1') && !normalizedName.endsWith('spine2')) this.combatSpineBone = bone;
      if (bone.isBone && normalizedName.endsWith('spine1')) this.combatSpine1Bone = bone;
      if (bone.isBone && normalizedName.endsWith('spine2')) this.combatSpine2Bone = bone;
      if (bone.isBone && normalizedName.endsWith('spine1') && !this.upperSpineBone) this.upperSpineBone = bone;
      if (bone.isBone && normalizedName.endsWith('spine2')) this.upperSpineBone = bone;
      if (bone.isBone && normalizedName.endsWith('neck')) this.neckBone = bone;
      if (bone.isBone && normalizedName.endsWith('head')) this.headBone = bone;
      if (bone.isBone && normalizedName.endsWith('hips')) this.hipsBone = bone;
      if (bone.isBone && normalizedName.endsWith('leftarm')) this.leftUpperArmBone = bone;
      if (bone.isBone && normalizedName.endsWith('rightarm')) this.rightUpperArmBone = bone;
      if (bone.isBone && normalizedName.endsWith('leftforearm')) this.leftForearmBone = bone;
      if (bone.isBone && normalizedName.endsWith('rightforearm')) this.rightForearmBone = bone;
      if (bone.isBone && normalizedName.endsWith('lefthand')) this.leftHandBone = bone;
      if (bone.isBone && normalizedName.endsWith('righthand')) this.rightHandBone = bone;
      if (bone.isBone && normalizedName.endsWith('leftupleg')) this.leftUpperLegBone = bone;
      if (bone.isBone && normalizedName.endsWith('rightupleg')) this.rightUpperLegBone = bone;
      if (bone.isBone && normalizedName.endsWith('leftleg')) this.leftLowerLegBone = bone;
      if (bone.isBone && normalizedName.endsWith('rightleg')) this.rightLowerLegBone = bone;
      if (bone.isBone && normalizedName.endsWith('leftfoot')) this.leftFootBone = bone;
      if (bone.isBone && normalizedName.endsWith('rightfoot')) this.rightFootBone = bone;

      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      // Ragdoll bones can travel many metres away from the avatar root (deep
      // holes, stairs, wall contacts). Static skinned-mesh bounds would then
      // incorrectly cull the corpse, making it appear transparent/invisible.
      mesh.frustumCulled = false;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if ('roughness' in material && typeof material.roughness === 'number') material.roughness = Math.max(material.roughness, 0.62);
      }
    });


    firstPersonCharacter.traverse((object) => {
      const normalizedName = object.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const bone = object as THREE.Bone;
      if (bone.isBone && normalizedName.endsWith('hips')) {
        this.firstPersonHipsBone = bone;
      }
      if (bone.isBone && normalizedName.endsWith('spine') && !normalizedName.endsWith('spine1') && !normalizedName.endsWith('spine2')) this.firstPersonCombatSpineBone = bone;
      if (bone.isBone && normalizedName.endsWith('spine1')) this.firstPersonCombatSpine1Bone = bone;
      if (bone.isBone && normalizedName.endsWith('spine2')) this.firstPersonCombatSpine2Bone = bone;
      if (bone.isBone && normalizedName.endsWith('leftupleg')) this.firstPersonLeftUpperLegBone = bone;
      if (bone.isBone && normalizedName.endsWith('rightupleg')) this.firstPersonRightUpperLegBone = bone;
      if (bone.isBone && normalizedName.endsWith('leftleg')) this.firstPersonLeftLowerLegBone = bone;
      if (bone.isBone && normalizedName.endsWith('rightleg')) this.firstPersonRightLowerLegBone = bone;
      if (bone.isBone && normalizedName.endsWith('leftfoot')) this.firstPersonLeftFootBone = bone;
      if (bone.isBone && normalizedName.endsWith('rightfoot')) this.firstPersonRightFootBone = bone;
      if (bone.isBone && (
        normalizedName.endsWith('leftshoulder') || normalizedName.endsWith('rightshoulder')
        || normalizedName.includes('clavicle') || normalizedName.includes('collar')
      )) this.firstPersonShoulderBones.push(bone);
      if (bone.isBone && (normalizedName.endsWith('leftarm') || normalizedName.endsWith('rightarm'))) this.firstPersonUpperArmBones.push(bone);
      if (bone.isBone && normalizedName.endsWith('leftarm')) this.firstPersonLeftUpperArmBone = bone;
      if (bone.isBone && normalizedName.endsWith('rightarm')) this.firstPersonRightUpperArmBone = bone;
      if (bone.isBone && (normalizedName.endsWith('leftforearm') || normalizedName.endsWith('rightforearm'))) this.firstPersonForearmBones.push(bone);
      if (bone.isBone && normalizedName.endsWith('leftforearm')) this.firstPersonLeftForearmBone = bone;
      if (bone.isBone && normalizedName.endsWith('rightforearm')) this.firstPersonRightForearmBone = bone;
      if (bone.isBone && (normalizedName.endsWith('lefthand') || normalizedName.endsWith('righthand'))) this.firstPersonHandBones.push(bone);
      if (bone.isBone && normalizedName.endsWith('lefthand')) this.firstPersonLeftHandBone = bone;
      if (bone.isBone && normalizedName.endsWith('righthand')) this.firstPersonRightHandBone = bone;

      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      // The 1P view-model shows the lower body plus arms/hands. Non-skinned
      // helpers (eyes, teeth, etc.) are never useful here and are hidden
      // outright. Skinned geometry gets a per-vertex view-model mask instead
      // of moving vertices.
      const skinnedMesh = mesh as THREE.SkinnedMesh;
      if (!skinnedMesh.isSkinnedMesh) {
        mesh.visible = false;
        return;
      }
      if (!this.prepareFirstPersonLowerBodyMesh(skinnedMesh)) {
        mesh.visible = false;
        return;
      }
      // View-model body can sit very close to the near plane. Its rest-pose
      // bounds must not cull animated knees/feet while looking sharply down.
      mesh.frustumCulled = false;
      const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const clonedMaterials = sourceMaterials.map((material) => {
        const clone = material.clone();
        if ('roughness' in clone && typeof clone.roughness === 'number') clone.roughness = Math.max(clone.roughness, 0.62);
        this.installFirstPersonLowerBodyClip(clone);
        return clone;
      });
      mesh.material = Array.isArray(mesh.material) ? clonedMaterials : clonedMaterials[0]!;

    });

    // Calibrate ankle-to-sole distance in the rest pose. At runtime the 1P rig
    // can then lift itself only when a visible foot would sink below the real
    // PlayerController feet plane.
    firstPersonCharacter.updateMatrixWorld(true);
    if (this.firstPersonLeftFootBone && this.firstPersonRightFootBone) {
      const restBounds = new THREE.Box3().setFromObject(firstPersonCharacter);
      this.firstPersonLeftFootBone.getWorldPosition(this.firstPersonFootWorldA);
      this.firstPersonRightFootBone.getWorldPosition(this.firstPersonFootWorldB);
      const lowestFootBoneY = Math.min(this.firstPersonFootWorldA.y, this.firstPersonFootWorldB.y);
      this.firstPersonFootToSole = THREE.MathUtils.clamp(lowestFootBoneY - restBounds.min.y, 0.035, 0.18);
    }
    firstPersonCharacter.scale.copy(this.firstPersonBaseScale).multiplyScalar(this.firstPersonViewmodelScale);
    firstPersonCharacter.updateMatrixWorld(true);

    this.character = character;
    this.firstPersonCharacter = firstPersonCharacter;
    this.avatarAnchor.add(character);
    this.firstPersonAvatarAnchor.add(firstPersonCharacter);
    character.updateMatrixWorld(true);
    for (const [i, foot] of [this.leftFootBone, this.rightFootBone].entries()) {
      if (foot) this.locomotionHeelLocal[i]!.set(0, -this.firstPersonFootToSole, -0.055)
        .applyQuaternion(foot.getWorldQuaternion(new THREE.Quaternion()).invert());
    }
    if (this.headBone) {
      // Derive the face axis from the neutral rig, not from assumed FBX bone
      // axes. Shoulder twists may then be countered without flattening head tilt.
      this.combatHeadLocalForward.set(0, 0, 1)
        .applyQuaternion(this.avatarAnchor.getWorldQuaternion(new THREE.Quaternion()))
        .applyQuaternion(this.headBone.getWorldQuaternion(new THREE.Quaternion()).invert());
    }
    if (this.hipsBone) {
      this.recoveryRestHipsRotation.copy(this.hipsBone.getWorldQuaternion(new THREE.Quaternion()));
    }
    this.mixer = new THREE.AnimationMixer(character);
    this.firstPersonMixer = new THREE.AnimationMixer(firstPersonCharacter);

    this.skeletonHelper = new THREE.SkeletonHelper(character);
    this.skeletonHelper.visible = false;
    this.avatarAnchor.add(this.skeletonHelper);

    await Promise.all(ANIMATIONS.map(async (entry) => {
      if (!('file' in entry)) return;
      let source: THREE.Group;
      try {
        source = await this.loader.loadAsync(`${ASSET_ROOT}/${entry.file}`);
      } catch (error) {
        if ('optional' in entry && entry.optional) {
          console.warn(`[animation-lab] animation optionnelle indisponible: ${entry.file}; fallback landing normal.`);
          return;
        }
        throw error;
      }
      const sourceClip = source.animations[0];
      if (!sourceClip) {
        if ('optional' in entry && entry.optional) {
          console.warn(`[animation-lab] animation optionnelle sans clip: ${entry.file}; fallback landing normal.`);
          return;
        }
        throw new Error(`Aucun clip trouvé dans ${entry.file}`);
      }
      const sourceHips = needsHipVerticalMotion(entry.id) ? findBoneBySuffix(source, 'hips') : undefined;
      const hipVertical = sourceHips && this.hipsBone
        ? { sourceBone: sourceHips, targetBone: this.hipsBone }
        : undefined;
      const slideTiming = entry.id === 'running-slide' ? slideRecoveryTiming(sourceClip) : undefined;
      if (slideTiming) this.slideRecoveryBlendStart = slideTiming.blendStart;
      if (slideTiming) this.slideRecoverySource = inPlaceClip(sourceClip, 'Slide_FullRecovery', false, hipVertical);
      const trimEnd = slideTiming?.trimEnd;
      // This specific source FBX is authored 180° around its Hips compared with
      // the rest of the pack. Correct only its root orientation, not its motion.
      const hipYawCorrection = entry.id === 'crouch-strafe-right' ? Math.PI : 0;
      const clip = inPlaceClip(
        sourceClip,
        `AnimationLab_${entry.id}`,
        isTurnAnimation(entry.id),
        hipVertical,
        hipYawCorrection,
        trimEnd,
      );
      if (!clip.tracks.length) throw new Error(`Aucune piste quaternion exploitable dans ${entry.file}`);
      const action = this.mixer!.clipAction(clip);
      action.enabled = true;
      action.setEffectiveWeight(1);
      this.animations.set(entry.id, { clip, action });

      // Same processed clip, separate mixer/skeleton. This keeps timing and
      // transitions identical without letting the 1P view-model touch the 3P rig.
      const firstPersonAction = this.firstPersonMixer!.clipAction(clip);
      firstPersonAction.enabled = true;
      firstPersonAction.setEffectiveWeight(1);
      this.firstPersonAnimations.set(entry.id, { clip, action: firstPersonAction });
    }));

    if (this.slideRecoverySource) {
      const recovery = createSlideSprintRecoveryClip(
        this.slideRecoverySource, this.animations.get('running')!.clip, this.slideRecoveryBlendStart,
      );
      this.slideSprintExitPhase = recovery.runPhase;
      this.animations.set('slide-to-running', { clip: recovery.clip, action: this.mixer.clipAction(recovery.clip) });
      this.firstPersonAnimations.set('slide-to-running', { clip: recovery.clip, action: this.firstPersonMixer.clipAction(recovery.clip) });
    }
    this.prepareCrouchLocomotion();
    this.prepareGetUpAnimations();
    this.prepareGaitLandmarks();
    this.prepareDirectionalLocomotionAnimations();
    this.prepareGaitLandmarks();
    this.prepareCombatAnimationLayers();

    // The room NPC is now a real melee test opponent: it can enter guard, attack,
    // receive every supplied hit reaction, lose HP and fall into Rapier ragdoll.
    const idleNpcAnchor = new THREE.Group();
    idleNpcAnchor.name = 'AnimationLabIdleNpcAnchor';
    idleNpcAnchor.position.set(MOVEMENT_LAB_IDLE_NPC.x, MOVEMENT_LAB_IDLE_NPC.y, MOVEMENT_LAB_IDLE_NPC.z);
    idleNpcAnchor.rotation.y = THREE.MathUtils.degToRad(-125);
    idleNpcCharacter.traverse((object) => {
      const bone = object as THREE.Bone;
      if (bone.isBone) {
        const normalized = bone.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normalized.endsWith('head')) this.idleNpcHeadBone = bone;
        if (normalized.endsWith('hips')) this.idleNpcHipsBone = bone;
        if (normalized.endsWith('spine') && !normalized.endsWith('spine1') && !normalized.endsWith('spine2')) this.idleNpcSpineBone = bone;
        if (normalized.endsWith('spine1')) this.idleNpcSpine1Bone = bone;
        if (normalized.endsWith('spine2')) this.idleNpcSpine2Bone = bone;
        if (normalized.endsWith('leftarm') && !normalized.endsWith('leftforearm')) this.idleNpcLeftUpperArmBone = bone;
        if (normalized.endsWith('rightarm') && !normalized.endsWith('rightforearm')) this.idleNpcRightUpperArmBone = bone;
        if (normalized.endsWith('leftforearm')) this.idleNpcLeftForearmBone = bone;
        if (normalized.endsWith('rightforearm')) this.idleNpcRightForearmBone = bone;
        if (normalized.endsWith('lefthand')) this.idleNpcLeftHandBone = bone;
        if (normalized.endsWith('righthand')) this.idleNpcRightHandBone = bone;
        this.idleNpcBasePose.set(bone.name, {
          position: bone.position.clone(),
          rotation: bone.quaternion.clone(),
        });
      }
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const clones = materials.map((material) => {
        const clone = material.clone();
        if ('roughness' in clone && typeof clone.roughness === 'number') clone.roughness = Math.max(clone.roughness, 0.62);
        return clone;
      });
      mesh.material = Array.isArray(mesh.material) ? clones : clones[0]!;
    });
    idleNpcAnchor.add(idleNpcCharacter);
    this.scene.add(idleNpcAnchor);
    idleNpcAnchor.updateMatrixWorld(true);
    if (this.idleNpcHipsBone) {
      this.npcRecoveryRestHipsRotation.copy(
        this.idleNpcHipsBone.getWorldQuaternion(new THREE.Quaternion()),
      );
    }
    this.idleNpcAnchor = idleNpcAnchor;
    this.idleNpcCharacter = idleNpcCharacter;
    this.idleNpcMixer = new THREE.AnimationMixer(idleNpcCharacter);
    this.syncNpcPlayerBlocker(true);
    for (const [id, loaded] of this.animations) {
      const action = this.idleNpcMixer.clipAction(loaded.clip);
      action.enabled = true;
      action.setEffectiveWeight(1);
      this.idleNpcActions.set(id, action);
    }
    const npcFightClip = this.animations.get('fight-idle')?.clip;
    if (!npcFightClip) throw new Error('NPC Fight Idle unavailable.');
    // NPC uses the exact same layered guard architecture as the player: a
    // continuously-running upper Fight Idle plus an independent lower-body gait.
    // This prevents pursuit/step-in movement from dropping the hands to a normal
    // walking pose before every punch.
    if (this.combatUpperLayer) {
      this.idleNpcCombatUpperAction = this.idleNpcMixer.clipAction(this.combatUpperLayer.clip);
      this.idleNpcCombatUpperAction.enabled = true;
      this.idleNpcCombatUpperAction.setEffectiveWeight(1);
    }
    for (const [id, pair] of this.combatLowerLayers) {
      const action = this.idleNpcMixer.clipAction(pair.clip);
      action.enabled = true;
      action.setEffectiveWeight(1);
      this.idleNpcCombatLowerActions.set(id, action);
    }
    for (const [id, pair] of this.combatAttackLayers) {
      // Strike clips are bounded additive upper-body overlays. The NPC uses the
      // same rule as the player: Fight Idle keeps running underneath while a small
      // chest contribution gives the hit weight without importing raw FBX snaps.
      const action = this.idleNpcMixer.clipAction(pair.clip);
      action.enabled = true;
      action.setEffectiveWeight(1);
      this.idleNpcCombatAttackActions.set(id, action);
    }
    this.playNpcAnimation('idle', true, 1, true);
    this.updateNpcUi();
  }

  private prepareGetUpAnimations(): void {
    if (!this.character || !this.mixer || !this.firstPersonMixer) return;
    const standing = this.animations.get('idle')!.clip;
    for (const side of ['back', 'belly'] as const) {
      const id = side === 'back' ? 'stand-up-back' : 'stand-up-belly';
      const previous = this.animations.get(id)!;
      const clip = createGetUpMotionClip(this.character, previous.clip, standing, side);
      this.mixer.uncacheClip(previous.clip);
      this.firstPersonMixer.uncacheClip(previous.clip);
      this.animations.set(id, { clip, action: this.mixer.clipAction(clip) });
      this.firstPersonAnimations.set(id, { clip, action: this.firstPersonMixer.clipAction(clip) });
    }
  }

  private prepareCrouchLocomotion(): void {
    if (!this.character || !this.mixer || !this.firstPersonMixer) return;
    const motion = createCrouchLocomotionClips(this.character, this.firstPersonFootToSole,
      { idle: this.animations.get('crouch-idle')!.clip,
        forward: this.animations.get('crouch-walking')!.clip,
        left: this.animations.get('crouch-strafe-left')!.clip,
        right: this.animations.get('crouch-strafe-right')!.clip }, this.combatHeadLocalForward);
    const clips = motion.clips;
    for (const [id, speed] of motion.referenceSpeeds) this.crouchGaitReferenceSpeeds.set(id, speed);
    for (const id of CROUCH_LOCOMOTION_IDS) {
      const previous = this.animations.get(id)?.clip;
      const clip = clips.get(id)!;
      if (previous === clip) continue;
      if (previous) { this.mixer.uncacheClip(previous); this.firstPersonMixer.uncacheClip(previous); }
      this.animations.set(id, { clip, action: this.mixer.clipAction(clip) });
      this.firstPersonAnimations.set(id, { clip, action: this.firstPersonMixer.clipAction(clip) });
    }
  }

  private prepareGaitLandmarks(): void {
    if (!this.character) return;
    const sampleRig = cloneSkeleton(this.character);
    for (const [id, loaded] of this.animations) {
      if (isCycleLocomotionAnimation(id) && !this.gaitLandmarks.has(id)) {
        this.gaitLandmarks.set(id, sampleGaitPhase(sampleRig, loaded.clip));
      }
    }
  }

  private prepareDirectionalLocomotionAnimations(): void {
    if (!this.mixer || !this.firstPersonMixer) return;
    const specs: ReadonlyArray<readonly [AnimationId, AnimationId, AnimationId, number, number]> = [
      ['walking-forward-left', 'walking', 'left-strafe-walking', 0.50, 0.26],
      ['walking-forward-right', 'walking', 'right-strafe-walking', 0.50, 0.26],
      ['running-forward-left', 'running', 'left-strafe-walking', 0.38, 0.12],
      ['running-forward-right', 'running', 'right-strafe-walking', 0.38, 0.12],
    ];
    for (const [id, forwardId, lateralId, lowerBodyLateralWeight, upperBodyLateralWeight] of specs) {
      const forward = this.animations.get(forwardId)?.clip;
      const lateral = this.animations.get(lateralId)?.clip;
      if (!forward || !lateral) throw new Error(`Directional locomotion source unavailable: ${id}`);
      const forwardLandmark = this.gaitLandmarks.get(forwardId) ?? 0;
      const clip = createDirectionalLocomotionBlendClip(
        forward,
        lateral,
        `AnimationLab_${id}`,
        { lowerBodyLateralWeight, upperBodyLateralWeight, sampleCount: 49,
          lateralPhaseOffset: (this.gaitLandmarks.get(lateralId) ?? 0) - forwardLandmark },
      );
      const action = this.mixer.clipAction(clip);
      action.enabled = true;
      action.setEffectiveWeight(1);
      this.animations.set(id, { clip, action });

      const firstPersonAction = this.firstPersonMixer.clipAction(clip);
      firstPersonAction.enabled = true;
      firstPersonAction.setEffectiveWeight(1);
      this.firstPersonAnimations.set(id, { clip, action: firstPersonAction });
    }
  }

  private prepareCombatAnimationLayers(): void {
    if (!this.mixer || !this.firstPersonMixer) return;
    const fight = this.animations.get('fight-idle')?.clip;
    if (!fight) throw new Error('Fight Idle clip is required for combat mode.');
    const fightHipsReference = firstQuaternionForBone(fight, 'hips');
    if (fightHipsReference) {
      this.combatFightHipsReference.copy(fightHipsReference);
      this.combatFightHipsReferenceReady = true;
    }
    const fightHipsTrack = fight.tracks.find((track) =>
      track instanceof THREE.QuaternionKeyframeTrack && /hips\.quaternion$/i.test(track.name)
    ) as THREE.QuaternionKeyframeTrack | undefined;
    if (fightHipsTrack) {
      this.combatFightHipsDuration = Math.max(1e-5, fight.duration);
      this.combatFightHipsInterpolant = new THREE.QuaternionLinearInterpolant(fightHipsTrack.times, fightHipsTrack.values, 4, new Float32Array(4));
    }
    // Fight Idle is the canonical combat center. Do not rotate it toward normal
    // Idle: every strike is rebased to Fight Idle and must preserve that stance.


    const upperClip = createCombatUpperClip(fight, 'AnimationLab_CombatUpper');
    if (!upperClip.tracks.length) throw new Error('Fight Idle has no upper-body tracks.');
    this.combatUpperLayer = {
      clip: upperClip,
      thirdPerson: this.mixer.clipAction(upperClip),
      firstPerson: this.firstPersonMixer.clipAction(upperClip),
    };

    const crouch = this.animations.get('crouch-idle')?.clip;
    if (!crouch) throw new Error('Crouch Idle clip is required for the combat dodge.');
    // 1P can lower its render-only pelvis for the duck. In 3P the world avatar
    // must stay on the controller floor: only the legs/torso coil while the real
    // side/back impulse moves the character. This prevents the old dodge from
    // sinking the whole mesh through the ground.
    const dodgeThirdPersonClip = createCombatDodgeClip(crouch, fight, 'AnimationLab_CombatDodge3P', false);
    const dodgeFirstPersonClip = createCombatDodgeClip(crouch, fight, 'AnimationLab_CombatDodge1P', true);
    if (!dodgeThirdPersonClip.tracks.length || !dodgeFirstPersonClip.tracks.length) {
      throw new Error('Combat dodge clip has no lower-body/torso tracks.');
    }
    this.combatDodgeLayer = {
      clip: dodgeFirstPersonClip,
      thirdPerson: this.mixer.clipAction(dodgeThirdPersonClip),
      firstPerson: this.firstPersonMixer.clipAction(dodgeFirstPersonClip),
    };

    const lowerSources: ReadonlyArray<readonly [CombatLowerAnimation, AnimationId]> = [
      ['fight-idle', 'fight-idle'],
      ['walking', 'walking'],
      // Backward locomotion gets its own AnimationAction even though it samples
      // the authored walking clip in reverse. Sharing one action and flipping
      // timeScale forced a reset/pop whenever direction changed.
      ['walking-backward', 'walking'],
      ['walking-forward-left', 'walking-forward-left'],
      ['walking-forward-right', 'walking-forward-right'],
      ['left-strafe-walking', 'left-strafe-walking'],
      ['right-strafe-walking', 'right-strafe-walking'],
    ];
    for (const [id, sourceId] of lowerSources) {
      const source = this.animations.get(sourceId)?.clip;
      if (!source) throw new Error(`Combat lower-body source unavailable: ${sourceId}`);
      const clip = createCombatLowerClip(source, `AnimationLab_CombatLower_${id}`);
      if (!clip.tracks.length) throw new Error(`Combat lower-body source has no leg tracks: ${id}`);
      this.combatLowerLayers.set(id, {
        clip,
        thirdPerson: this.mixer.clipAction(clip),
        firstPerson: this.firstPersonMixer.clipAction(clip),
      });
    }

    // The combat library no longer replays any authored Big Punch clip. Eight clean
    // light strikes, four step-ins and two powers are synthesized from four clean
    // punch references. Each variant owns an explicit L/R side and contact beat;
    // source clips are mirrored only when necessary. Hook references are reserved
    // for dodge-counters, so ordinary punches cannot inherit their circular arm path.
    for (const attackId of [...ALL_STRAIGHT_ATTACK_VARIANTS, ...BIG_PUNCH_ATTACK_VARIANTS]) {
      const visual = combatAttackVisualProfile(attackId);
      if (!visual) continue;
      const source = this.animations.get(visual.source)?.clip;
      if (!source) throw new Error(`Combat punch source unavailable: ${visual.source}`);
      const sourceAnalysis = analyzeCombatStrikeSource(source);
      const timing = combatAttackTimingProfile(attackId);
      const desiredSide = COMBAT_ATTACK_DESIRED_SIDE[attackId];
      const mirror = sourceAnalysis.strikingSide !== desiredSide;
      this.combatAttackStrikingSides.set(attackId, desiredSide);
      const clip = createCombatStrikeUpperClip(
        source,
        fight,
        `AnimationLab_CombatAttack_${attackId}`,
        {
          heavy: visual.heavy,
          character: visual.character,
          strikingSide: desiredSide,
          impactFraction: timing.impactFraction,
          sourcePeakPhase: sourceAnalysis.sourcePeakPhase,
          mirror,
        },
      );
      if (!clip.tracks.length) throw new Error(`Combat punch variant has no upper-body tracks: ${attackId}`);
      this.combatAttackLayers.set(attackId, {
        clip,
        thirdPerson: this.mixer.clipAction(clip),
        firstPerson: this.firstPersonMixer.clipAction(clip),
      });
    }

    const hookSources = ['hook-a', 'hook-b', 'hook-c'] as const;
    for (const id of hookSources) {
      const source = this.animations.get(id)?.clip;
      if (!source) throw new Error(`Combat hook unavailable: ${id}`);
      const sourceAnalysis = analyzeCombatStrikeSource(source);
      const timing = combatAttackTimingProfile(id);
      const desiredSide = COMBAT_ATTACK_DESIRED_SIDE[id];
      const mirror = sourceAnalysis.strikingSide !== desiredSide;
      this.combatAttackStrikingSides.set(id, desiredSide);
      const clip = createCombatStrikeUpperClip(
        source, fight, `AnimationLab_CombatAttack_${id}`,
        {
          character: 'counter',
          strikingSide: desiredSide,
          impactFraction: timing.impactFraction,
          sourcePeakPhase: sourceAnalysis.sourcePeakPhase,
          mirror,
        },
      );
      if (!clip.tracks.length) throw new Error(`Combat hook has no upper-body tracks: ${id}`);
      this.combatAttackLayers.set(id, {
        clip,
        thirdPerson: this.mixer.clipAction(clip),
        firstPerson: this.firstPersonMixer.clipAction(clip),
      });
    }
  }

  private fitCharacterToMeters(character: THREE.Group): void {
    character.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(character);
    const height = Math.max(0.001, box.max.y - box.min.y);
    const scale = AVATAR_HEIGHT_METERS / height;
    character.scale.multiplyScalar(scale);
    character.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(character);
    const center = box.getCenter(new THREE.Vector3());
    character.position.x -= center.x;
    character.position.z -= center.z;
    character.position.y -= box.min.y;
    character.updateMatrixWorld(true);
  }

  private prepareFirstPersonLowerBodyMesh(mesh: THREE.SkinnedMesh): boolean {
    const geometry = mesh.geometry.clone();
    const skinIndex = geometry.getAttribute('skinIndex');
    const skinWeight = geometry.getAttribute('skinWeight');
    const position = geometry.getAttribute('position');
    if (!skinIndex || !skinWeight || !position || !mesh.skeleton) return false;

    const lowerBoneIndices = new Set<number>();
    const armBoneIndices = new Set<number>();
    const combatDistalArmBoneIndices = new Set<number>();
    const combatUpperArmBoneIndices = new Set<number>();
    mesh.skeleton.bones.forEach((bone, index) => {
      const name = bone.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (
        name.endsWith('hips') ||
        name.endsWith('leftupleg') || name.endsWith('rightupleg') ||
        name.endsWith('leftleg') || name.endsWith('rightleg') ||
        name.endsWith('leftfoot') || name.endsWith('rightfoot') ||
        name.includes('lefttoe') || name.includes('righttoe')
      ) lowerBoneIndices.add(index);
      if (
        name.endsWith('leftshoulder') || name.endsWith('rightshoulder') ||
        name.includes('clavicle') || name.includes('collar') ||
        name.endsWith('leftarm') || name.endsWith('rightarm') ||
        name.endsWith('leftforearm') || name.endsWith('rightforearm') ||
        name.endsWith('lefthand') || name.endsWith('righthand') ||
        name.includes('thumb') || name.includes('index') ||
        name.includes('middle') || name.includes('ring') ||
        name.includes('pinky')
      ) armBoneIndices.add(index);

      // Combat gets its own much stricter first-person mask. Shoulder/clavicle
      // influences are deliberately excluded because the single-piece body mesh
      // lets those bones drag chunks of chest/back into the camera when the guard
      // rig is moved forward. Forearms/hands are always eligible; only vertices
      // strongly owned by an upper arm may bridge the elbow back toward the sleeve.
      if (
        name.endsWith('leftforearm') || name.endsWith('rightforearm') ||
        name.endsWith('lefthand') || name.endsWith('righthand') ||
        name.includes('thumb') || name.includes('index') ||
        name.includes('middle') || name.includes('ring') ||
        name.includes('pinky')
      ) combatDistalArmBoneIndices.add(index);
      if (name.endsWith('leftarm') || name.endsWith('rightarm')) combatUpperArmBoneIndices.add(index);
    });
    if (!lowerBoneIndices.size) return false;

    const lowerMask = new Float32Array(position.count);
    const armMask = new Float32Array(position.count);
    const combatArmMask = new Float32Array(position.count);
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      let lowerWeight = 0;
      let armWeight = 0;
      let combatDistalWeight = 0;
      let combatUpperWeight = 0;
      const indices = [
        skinIndex.getX(vertex), skinIndex.getY(vertex), skinIndex.getZ(vertex), skinIndex.getW(vertex),
      ];
      const weights = [
        skinWeight.getX(vertex), skinWeight.getY(vertex), skinWeight.getZ(vertex), skinWeight.getW(vertex),
      ];
      for (let influence = 0; influence < 4; influence += 1) {
        const boneIndex = indices[influence]!;
        const weight = weights[influence]!;
        if (lowerBoneIndices.has(boneIndex)) lowerWeight += weight;
        if (armBoneIndices.has(boneIndex)) armWeight += weight;
        if (combatDistalArmBoneIndices.has(boneIndex)) combatDistalWeight += weight;
        if (combatUpperArmBoneIndices.has(boneIndex)) combatUpperWeight += weight;
      }
      lowerMask[vertex] = THREE.MathUtils.smoothstep(lowerWeight, 0.10, 0.62);
      armMask[vertex] = THREE.MathUtils.smoothstep(armWeight, 0.08, 0.58);
      const localX = Math.abs(position.getX(vertex));
      const localY = position.getY(vertex);
      const lateralSleeve = THREE.MathUtils.smoothstep(localX, 0.10, 0.22);
      const belowNeck = 1 - THREE.MathUtils.smoothstep(localY, 1.50, 1.74);
      // Keep a little more of the upper arm during combat so the silhouette reads
      // as a connected sleeve rather than a detached forearm, but still gate that
      // contribution to lateral, sub-neck vertices only so torso/back never bleed
      // into the first-person camera.
      const shoulderBridge = THREE.MathUtils.smoothstep(combatUpperWeight, 0.22, 0.68) * lateralSleeve * belowNeck;
      const combatArmWeight = Math.max(
        combatDistalWeight,
        Math.max(combatUpperWeight * 0.72, shoulderBridge * 0.94),
      );
      combatArmMask[vertex] = THREE.MathUtils.smoothstep(combatArmWeight, 0.10, 0.42);
    }
    geometry.setAttribute('fpLowerBodyMask', new THREE.Float32BufferAttribute(lowerMask, 1));
    geometry.setAttribute('fpArmMask', new THREE.Float32BufferAttribute(armMask, 1));
    geometry.setAttribute('fpCombatArmMask', new THREE.Float32BufferAttribute(combatArmMask, 1));

    // Keep whole triangles that belong clearly to either the lower body or an
    // arm/hand chain. This avoids interpolation spikes while allowing hands to
    // travel forward during authored jumps/falls/slides.
    const index = geometry.getIndex();
    if (index) {
      const kept: number[] = [];
      for (let i = 0; i + 2 < index.count; i += 3) {
        const a = index.getX(i);
        const b = index.getX(i + 1);
        const c = index.getX(i + 2);
        const visible = (v: number) => Math.max(lowerMask[v]!, armMask[v]!) >= FIRST_PERSON_LOWER_BODY_MASK_THRESHOLD;
        if (visible(a) && visible(b) && visible(c)) kept.push(a, b, c);
      }
      geometry.setIndex(kept);
    }

    mesh.geometry = geometry;
    return true;
  }

  private installFirstPersonLowerBodyClip(material: THREE.Material): void {
    const clipY = { value: 10_000 };
    const combatIsolation = { value: 0 };
    const groundKick = { value: 0 };
    this.firstPersonClipUniforms.push({ clipY, combatIsolation, groundKick });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.fpUpperClipY = clipY;
      shader.uniforms.fpCombatIsolation = combatIsolation;
      shader.uniforms.fpGroundKick = groundKick;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        '#include <common>\nattribute float fpLowerBodyMask;\nattribute float fpArmMask;\nattribute float fpCombatArmMask;\nvarying float vFpWorldY;\nvarying float vFpLowerBodyMask;\nvarying float vFpArmMask;\nvarying float vFpCombatArmMask;',
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvec4 fpWorldPosition = modelMatrix * vec4(transformed, 1.0);\nvFpWorldY = fpWorldPosition.y;\nvFpLowerBodyMask = fpLowerBodyMask;\nvFpArmMask = fpArmMask;\nvFpCombatArmMask = fpCombatArmMask;',
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        '#include <common>\nuniform float fpUpperClipY;\nuniform float fpCombatIsolation;\nuniform float fpGroundKick;\nvarying float vFpWorldY;\nvarying float vFpLowerBodyMask;\nvarying float vFpArmMask;\nvarying float vFpCombatArmMask;',
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>\nfloat fpExplorationMask = max(vFpLowerBodyMask, vFpArmMask);\nfloat fpCombatKickMask = max(vFpCombatArmMask, vFpLowerBodyMask);\nfloat fpCombatMask = mix(vFpCombatArmMask, fpCombatKickMask, fpGroundKick);\nfloat fpVisibleMask = mix(fpExplorationMask, fpCombatMask, fpCombatIsolation);\nfloat fpMaskThreshold = mix(${FIRST_PERSON_LOWER_BODY_MASK_THRESHOLD.toFixed(2)}, ${FIRST_PERSON_COMBAT_ARM_MASK_THRESHOLD.toFixed(2)}, fpCombatIsolation);\nif (fpVisibleMask < fpMaskThreshold) discard;\nif (fpCombatIsolation < 0.5 && vFpWorldY > fpUpperClipY && vFpArmMask < ${FIRST_PERSON_LOWER_BODY_MASK_THRESHOLD.toFixed(2)}) discard;`,
      );
    };
    material.customProgramCacheKey = () => 'animation-lab-first-person-viewmodel-v13-ground-kick';
    material.needsUpdate = true;
  }


  private applyFirstPersonArmTuning(delta: number): void {
    // The first-person rig keeps the authored pelvis motion. Only arm reach is
    // presentation-tuned, and only on this render-only skeleton. Sprint clips
    // shorten the arm chain a little more so fists cannot punch into the camera.
    const sprintArms = this.currentAnimation === 'running';
    const combatArms = this.combatAttack !== null
      || this.combatPhase === 'enter'
      || this.combatPhase === 'guard'
      || this.combatPhase === 'exit'
      || this.firstPersonCombatReleaseSeconds > 0;
    const targetArmScale = combatArms
      ? FIRST_PERSON_COMBAT_ARM_SCALE + FIRST_PERSON_COMBAT_VISUAL_ARM_SCALE_BONUS
      : sprintArms
        ? FIRST_PERSON_SPRINT_ARM_SCALE
        : FIRST_PERSON_ARM_SCALE;
    const targetHandScale = combatArms
      ? FIRST_PERSON_COMBAT_HAND_SCALE + FIRST_PERSON_COMBAT_VISUAL_HAND_SCALE_BONUS
      : sprintArms
        ? FIRST_PERSON_SPRINT_HAND_SCALE
        : FIRST_PERSON_HAND_SCALE;
    const alpha = expAlpha(delta, FIRST_PERSON_ARM_SCALE_RESPONSE);
    for (const bone of this.firstPersonUpperArmBones) {
      const scale = THREE.MathUtils.lerp(bone.scale.x, targetArmScale, alpha);
      bone.scale.setScalar(scale);
    }
    for (const bone of this.firstPersonForearmBones) {
      const scale = THREE.MathUtils.lerp(bone.scale.x, targetArmScale, alpha);
      bone.scale.setScalar(scale);
    }
    for (const bone of this.firstPersonHandBones) {
      const scale = THREE.MathUtils.lerp(bone.scale.x, targetHandScale, alpha);
      bone.scale.setScalar(scale);
    }
  }

  private updateFirstPersonBodyTransform(delta = 0, snapScale = false): void {
    if (!this.player || !this.firstPersonCharacter || !this.firstPersonHipsBone) return;
    // Dedicated CS/GTA-style legs view-model. The world avatar and gameplay POV
    // are untouched; only this second render rig is framed around the camera.
    const state = this.player.getDebugState();
    const lowView = state.crouching || state.lowPosture || state.sliding;
    const targetScale = lowView
      ? FIRST_PERSON_VIEWMODEL_CROUCH_SCALE
      : FIRST_PERSON_VIEWMODEL_STAND_SCALE;
    this.firstPersonViewmodelScale = snapScale
      ? targetScale
      : THREE.MathUtils.lerp(
          this.firstPersonViewmodelScale,
          targetScale,
          expAlpha(delta, FIRST_PERSON_VIEWMODEL_SCALE_RESPONSE),
        );
    this.firstPersonCharacter.scale
      .copy(this.firstPersonBaseScale)
      .multiplyScalar(this.firstPersonViewmodelScale);
    this.firstPersonCharacter.updateMatrixWorld(true);

    // Keep the same 1P framing for the whole Action-Idle family. Wait clips,
    // Action turns and the authored Action→Sleeping transition are still part
    // of the Action pose, so releasing the offset before true Sleeping Idle
    // makes the body visibly jump underneath a fixed gameplay camera.
    const actionIdleBodyOffsetTarget = usesFirstPersonActionIdleFraming(this.currentAnimation)
      && !state.incapacitated
      ? 1
      : 0;
    this.firstPersonActionIdleBodyOffsetBlend = snapScale
      ? actionIdleBodyOffsetTarget
      : THREE.MathUtils.lerp(
          this.firstPersonActionIdleBodyOffsetBlend,
          actionIdleBodyOffsetTarget,
          expAlpha(delta, FIRST_PERSON_ACTION_IDLE_BODY_OFFSET_RESPONSE),
        );

    // Combat presentation only: keep the real gameplay camera fixed. The
    // render-only body uses a conservative base offset, then a hand-midpoint
    // solver below keeps both fists visibly in front of and slightly below the
    // eye without letting guard/punch animation translate the gameplay camera.
    const combatPoseTarget = !state.incapacitated && (
      this.combatAttack !== null
      || this.combatPhase === 'enter'
      || this.combatPhase === 'guard'
      || this.combatPhase === 'exit'
      || this.firstPersonCombatReleaseSeconds > 0
      || this.groundKick !== null
    ) ? 1 : 0;
    // While the fists are up, keep enough downward look for stairs/feet awareness but
    // prevent the camera from pitching all the way into the forearms/body. The limiter
    // modifies the input look range only; animation still never moves the gameplay camera.
    this.player.setCombatGuardLookConstraint(combatPoseTarget > 0.001 && this.groundKick === null);
    this.firstPersonCombatPoseBlend = snapScale
      ? combatPoseTarget
      : THREE.MathUtils.lerp(
          this.firstPersonCombatPoseBlend,
          combatPoseTarget,
          expAlpha(delta, FIRST_PERSON_COMBAT_BODY_OFFSET_RESPONSE),
        );

    const highFallTarget = 0;
    this.firstPersonHighFallBlend = snapScale
      ? highFallTarget
      : THREE.MathUtils.lerp(
          this.firstPersonHighFallBlend,
          highFallTarget,
          expAlpha(delta, FIRST_PERSON_HIGH_FALL_RESPONSE),
        );

    // First-person free-look deliberately decouples the camera/head from the
    // pelvis. Small mouse turns leave the feet and lower body facing their
    // current direction; once the glance exceeds the allowed arc, bodyYaw is
    // advanced by updateAvatarTransform and this render rig follows it.
    // Downed/dead poses already keep bodyYaw locked for the same reason.
    // Both render rigs share the committed physical facing, including guard
    // and recoil. The gameplay camera remains free to look elsewhere.
    const rigBodyYaw = this.bodyYaw;
    this.firstPersonAvatarAnchor.rotation.set(
      FIRST_PERSON_HIGH_FALL_FORWARD_PITCH * this.firstPersonHighFallBlend,
      rigBodyYaw,
      0,
    );
    this.firstPersonAvatarAnchor.position.set(0, 0, 0);
    this.firstPersonAvatarAnchor.updateMatrixWorld(true);

    this.firstPersonHipsBone.getWorldPosition(this.firstPersonHipWorld);
    // Keep the presentation body physically under its own pelvis orientation.
    // The previous v31 framed the entire rig from viewYaw; during head-only
    // free-look that made the whole corpse/player body orbit around the camera.
    // Feet and pelvis now remain world-stable while the camera turns.
    const framingYaw = rigBodyYaw;
    this.firstPersonForward.set(Math.sin(framingYaw), 0, Math.cos(framingYaw));
    this.firstPersonRight.set(Math.cos(framingYaw), 0, -Math.sin(framingYaw));
    const pelvisBehindCamera = THREE.MathUtils.lerp(
      FIRST_PERSON_PELVIS_BEHIND_CAMERA,
      FIRST_PERSON_HIGH_FALL_PELVIS_BEHIND_CAMERA,
      this.firstPersonHighFallBlend,
    );
    this.firstPersonHipTarget
      .copy(this.firstPersonCamera.position)
      .addScaledVector(this.firstPersonForward, pelvisBehindCamera)
      // Action Idle framing is render-body-only. The camera remains exactly at
      // the PlayerController eye while the body moves to the opposite side,
      // producing the desired right-side POV without any camera drift.
      .addScaledVector(
        this.firstPersonRight,
        FIRST_PERSON_ACTION_IDLE_BODY_RIGHT_OFFSET * this.firstPersonActionIdleBodyOffsetBlend,
      )
      .addScaledVector(
        this.firstPersonForward,
        FIRST_PERSON_ACTION_IDLE_BODY_FORWARD_OFFSET * this.firstPersonActionIdleBodyOffsetBlend,
      )
      .addScaledVector(
        this.firstPersonForward,
        (FIRST_PERSON_COMBAT_BODY_FORWARD_OFFSET + FIRST_PERSON_COMBAT_VISUAL_BODY_FORWARD_EXTRA) * this.firstPersonCombatPoseBlend,
      );
    const fallingPelvisBelowCamera = THREE.MathUtils.lerp(
      FIRST_PERSON_PELVIS_BELOW_CAMERA,
      FIRST_PERSON_HIGH_FALL_PELVIS_BELOW_CAMERA,
      this.firstPersonHighFallBlend,
    );
    const pelvisBelowCamera = state.incapacitated
      ? FIRST_PERSON_DOWNED_PELVIS_BELOW_CAMERA
      : fallingPelvisBelowCamera;
    this.firstPersonHipTarget.y -= pelvisBelowCamera;
    this.firstPersonHipTarget.y += FIRST_PERSON_COMBAT_BODY_UP_OFFSET * this.firstPersonCombatPoseBlend;
    this.firstPersonHipTarget.y += FIRST_PERSON_COMBAT_VISUAL_BODY_UP_EXTRA * this.firstPersonCombatPoseBlend;

    this.firstPersonAvatarAnchor.position
      .copy(this.firstPersonHipTarget)
      .sub(this.firstPersonHipWorld);
    this.firstPersonAvatarAnchor.updateMatrixWorld(true);

    // Only a *small* deterministic free-look recenter is allowed. It is based
    // on the Hips origin (which does not breathe/sway with the upper-body idle)
    // instead of the animated abdomen. That avoids translating the entire rig
    // every time the chest breathes, and avoids the obvious orbit/glide from
    // v31 while still keeping extreme head-only glances readable in 1P.
    this.firstPersonViewRight.set(
      Math.cos(this.continuousViewYaw),
      0,
      -Math.sin(this.continuousViewYaw),
    );
    this.firstPersonHipsBone.getWorldPosition(this.firstPersonHipWorld);
    const pelvisViewLateral = this.tempDirection
      .copy(this.firstPersonHipWorld)
      .sub(this.firstPersonCamera.position)
      .dot(this.firstPersonViewRight);
    const freelookCenterTarget = state.incapacitated
      ? 0
      : THREE.MathUtils.clamp(
          -pelvisViewLateral * FIRST_PERSON_FREELOOK_RECENTER_FRACTION,
          -FIRST_PERSON_FREELOOK_RECENTER_MAX,
          FIRST_PERSON_FREELOOK_RECENTER_MAX,
        ) * (1 - this.firstPersonHighFallBlend);
    this.firstPersonFreelookCenterOffset = snapScale
      ? freelookCenterTarget
      : THREE.MathUtils.lerp(
          this.firstPersonFreelookCenterOffset,
          freelookCenterTarget,
          expAlpha(delta, FIRST_PERSON_FREELOOK_RECENTER_RESPONSE),
        );
    if (Math.abs(this.firstPersonFreelookCenterOffset) > 0.0001) {
      this.firstPersonAvatarAnchor.position.addScaledVector(
        this.firstPersonViewRight,
        this.firstPersonFreelookCenterOffset,
      );
      this.firstPersonAvatarAnchor.updateMatrixWorld(true);
    }

    // Do not let the oversized view-model sink below the physical body. Only
    // lift when the lower shoe/foot estimate crosses the real feet plane.
    if (!state.incapacitated && combatPoseTarget <= 0.001 && this.firstPersonLeftFootBone && this.firstPersonRightFootBone) {
      this.firstPersonLeftFootBone.getWorldPosition(this.firstPersonFootWorldA);
      this.firstPersonRightFootBone.getWorldPosition(this.firstPersonFootWorldB);
      const estimatedSoleY = Math.min(this.firstPersonFootWorldA.y, this.firstPersonFootWorldB.y)
        - this.firstPersonFootToSole * this.firstPersonViewmodelScale;
      const minimumSoleY = this.feetPosition.y + FIRST_PERSON_SOLE_CLEARANCE;
      if (estimatedSoleY < minimumSoleY) {
        this.firstPersonAvatarAnchor.position.y += minimumSoleY - estimatedSoleY;
        this.firstPersonAvatarAnchor.updateMatrixWorld(true);
      }
    }

    // Static 1P animations should breathe around a planted foot, not drag the
    // foot across the carpet. Lock one stance ankle in world space while the
    // player is grounded and truly stationary. Turn clips are intentionally
    // excluded so authored stepping remains visible. The lock survives the
    // Action -> Wait -> Sleeping idle sequence and is reacquired after a turn.
    const requestedFootLockGroup = !state.airborne
      && !state.incapacitated
      && state.horizontalSpeed < 0.08
      && !this.bodyTurning
      && this.activeAuthoredTurn === null
      && combatPoseTarget <= 0.001
      ? firstPersonFootLockGroup(this.currentAnimation)
      : null;
    if (requestedFootLockGroup && this.firstPersonLeftFootBone && this.firstPersonRightFootBone) {
      this.firstPersonLeftFootBone.getWorldPosition(this.firstPersonFootWorldA);
      this.firstPersonRightFootBone.getWorldPosition(this.firstPersonFootWorldB);
      if (this.firstPersonFootLockGroup !== requestedFootLockGroup || !this.firstPersonFootLockBone) {
        this.firstPersonFootLockGroup = requestedFootLockGroup;
        this.firstPersonFootLockBone = this.firstPersonFootWorldA.y <= this.firstPersonFootWorldB.y
          ? this.firstPersonLeftFootBone
          : this.firstPersonRightFootBone;
        this.firstPersonFootLockBone.getWorldPosition(this.firstPersonFootLockTarget);
      } else {
        this.firstPersonFootLockBone.getWorldPosition(this.firstPersonFootLockCurrent);
        this.firstPersonFootLockCorrection
          .copy(this.firstPersonFootLockTarget)
          .sub(this.firstPersonFootLockCurrent);
        const correctionLength = this.firstPersonFootLockCorrection.length();
        if (correctionLength > FIRST_PERSON_FOOT_LOCK_MAX_CORRECTION) {
          this.firstPersonFootLockCorrection.multiplyScalar(FIRST_PERSON_FOOT_LOCK_MAX_CORRECTION / correctionLength);
        }
        this.firstPersonAvatarAnchor.position.add(this.firstPersonFootLockCorrection);
        this.firstPersonAvatarAnchor.updateMatrixWorld(true);
      }
    } else {
      this.firstPersonFootLockGroup = null;
      this.firstPersonFootLockBone = undefined;
    }


    this.firstPersonHipsBone.getWorldPosition(this.firstPersonHipWorld);
    const clipY = this.firstPersonHipWorld.y + FIRST_PERSON_BODY_CLIP_ABOVE_HIPS;
    // Enter combat isolation immediately: the guard should never spend even a
    // transition frame showing the torso/back while the presentation rig moves
    // toward the fists. On release, keep the arms-only mask until the combat
    // framing has substantially settled, then hand control back to the normal
    // legs+arms exploration view-model.
    const combatIsolation = combatPoseTarget > 0.001
      ? 1
      : THREE.MathUtils.smoothstep(this.firstPersonCombatPoseBlend, 0.08, 0.72);
    for (const uniforms of this.firstPersonClipUniforms) {
      uniforms.clipY.value = clipY;
      uniforms.combatIsolation.value = combatIsolation;
      uniforms.groundKick.value = this.groundKick ? 1 : 0;
    }

  }

  private enableAutoMode(): void {
    if (this.ragdoll) return;
    this.playbackMode = 'auto';
    this.modeButton?.classList.add('is-active');
    this.autoCandidate = this.currentAnimation;
    this.autoCandidateElapsed = 0;
    this.autoOneShot = null;
    this.pendingStrongTurn = null;
    this.strongTurnLatched = false;
    this.activeAuthoredTurn = null;
    this.settledActionTurnPose = null;
    this.continuousViewYaw = this.avatarAnchor.rotation.y;
    this.bodyYaw = this.avatarAnchor.rotation.y;
    this.wasSliding = false;
    this.slideVisualSettled = false;
    this.airborneAnimation = null;
    this.airborneAnimationRate = 1;
    this.wasAirborne = false;
    this.idleResumeMode = 'sleeping';
    this.idleNeedsEntry = false;
    this.idleSequencePhase = 'sleeping';
    this.idleSequenceElapsed = 0;
    this.idleSequenceOneShot = null;
    this.postureStateInitialized = false;
    this.updateAnimationButtonState();
    this.updateAutoAnimation(0, true);
  }

  private forceAnimation(id: AnimationId): void {
    if (!this.ready || this.ragdoll) return;
    this.resetCombatState(true);
    this.playbackMode = 'forced';
    this.forcedAnimation = id;
    this.autoOneShot = null;
    this.activeAuthoredTurn = null;
    this.airborneAnimation = null;
    this.airborneAnimationRate = 1;
    this.modeButton?.classList.remove('is-active');
    this.playAnimation(id, !isOneShotAnimation(id), this.playbackSpeed, false, true);
    this.updateAnimationButtonState();
  }

  private playAnimation(
    id: AnimationId,
    loop: boolean,
    rate = 1,
    reverse = false,
    restart = false,
  ): void {
    const loaded = this.animations.get(id);
    const firstPersonLoaded = this.firstPersonAnimations.get(id);
    if (!loaded || !firstPersonLoaded || !this.mixer || !this.firstPersonMixer) return;
    if (this.settledActionTurnPose && (id !== this.settledActionTurnPose || restart)) {
      this.settledActionTurnPose = null;
    }
    const signedRate = Math.max(0.05, Math.abs(rate)) * (reverse ? -1 : 1);

    if (!restart && this.currentAnimation === id && this.currentAction === loaded.action) {
      loaded.action.setEffectiveTimeScale(signedRate);
      firstPersonLoaded.action.setEffectiveTimeScale(signedRate);
      return;
    }

    const previous = this.currentAction;
    const firstPersonPrevious = this.firstPersonCurrentAction;
    const previousAnimation = this.currentAnimation;
    const previousLoaded = this.animations.get(previousAnimation);
    const previousFirstPersonLoaded = this.firstPersonAnimations.get(previousAnimation);
    const preserveLocomotionPhase = loop
      && isCycleLocomotionAnimation(previousAnimation)
      && isCycleLocomotionAnimation(id)
      && !!previous
      && !!firstPersonPrevious;
    const previousPhase = preserveLocomotionPhase && previousLoaded
      ? ((previous.time % Math.max(1e-5, previousLoaded.clip.duration)) + previousLoaded.clip.duration)
        % previousLoaded.clip.duration / Math.max(1e-5, previousLoaded.clip.duration)
      : 0;
    const previousFirstPersonPhase = preserveLocomotionPhase && previousFirstPersonLoaded
      ? ((firstPersonPrevious.time % Math.max(1e-5, previousFirstPersonLoaded.clip.duration)) + previousFirstPersonLoaded.clip.duration)
        % previousFirstPersonLoaded.clip.duration / Math.max(1e-5, previousFirstPersonLoaded.clip.duration)
      : previousPhase;
    const next = loaded.action;
    const firstPersonNext = firstPersonLoaded.action;
    const resumeCrouchPhase = previousAnimation === 'crouch-idle' && id.startsWith('crouch-')
      && isCycleLocomotionAnimation(id) && next.isRunning() && next.getEffectiveWeight() > 0.02;
    const resumedTime = next.time, resumedFirstPersonTime = firstPersonNext.time;
    const gaitBlend = loop && previous === previousLoaded?.action
      && (isCycleLocomotionAnimation(previousAnimation) || previousAnimation === 'idle' || previousAnimation === 'idle-action' || previousAnimation === 'crouch-idle')
      && (isCycleLocomotionAnimation(id) || id === 'idle' || id === 'idle-action' || id === 'crouch-idle');
    if (gaitBlend) {
      const pairs = [...this.animations].map(([key, value]) => ({
        thirdPerson: value.action, firstPerson: this.firstPersonAnimations.get(key)!.action,
      }));
      let fade = transitionFadeSeconds(previousAnimation, id);
      if (previousAnimation.startsWith('crouch-') && id.startsWith('crouch-')) {
        const rest = this.animations.get('crouch-idle')!.action;
        const restWeight = rest.isScheduled() ? rest.getEffectiveWeight() : 0;
        // Reversing a sidestep during the initial rise must retain the longer
        // deep-rest handoff, rather than accelerate it into a direction fade.
        fade = Math.max(fade, 0.50 * Math.sqrt(Math.max(0, restWeight)));
      }
      this.gaitTransition.begin(pairs, next, fade);
    } else this.gaitTransition.release(id.startsWith('hit-') ? 0.035 : 0.12);
    const prepareAction = (action: THREE.AnimationAction, clip: THREE.AnimationClip): void => {
      action.reset();
      action.enabled = true;
      action.paused = false;
      action.clampWhenFinished = !loop;
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
      action.setEffectiveWeight(1);
      action.setEffectiveTimeScale(signedRate);
      if (reverse) action.time = Math.max(0, clip.duration - 1e-4);
      action.play();
    };
    prepareAction(next, loaded.clip);
    prepareAction(firstPersonNext, firstPersonLoaded.clip);
    if (preserveLocomotionPhase) {
      // Direction changes must continue the current step rather than restarting
      // the next FBX at frame zero. This is what prevents rapid Q/D or A/D
      // changes from visually freezing the knees while the capsule slides.
      const oldLandmark = this.gaitLandmarks.get(previousAnimation) ?? 0;
      const newLandmark = this.gaitLandmarks.get(id) ?? 0;
      next.time = alignGaitPhase(previousPhase, oldLandmark, newLandmark) * loaded.clip.duration;
      firstPersonNext.time = alignGaitPhase(previousFirstPersonPhase, oldLandmark, newLandmark) * firstPersonLoaded.clip.duration;
    } else if (resumeCrouchPhase) {
      // If input returns during braking, the outgoing step is still visible.
      // Rewinding that contributing action would snap the blended knees.
      next.time = resumedTime; firstPersonNext.time = resumedFirstPersonTime;
    }
    if (previousAnimation === 'slide-to-running' && id === 'running') {
      next.time = this.slideSprintExitPhase * loaded.clip.duration;
      firstPersonNext.time = this.slideSprintExitPhase * firstPersonLoaded.clip.duration;
    }

    // Hit reactions must read on the exact contact frame. A long locomotion-style
    // crossfade makes HP change first and the body react later, which feels like
    // delayed damage even when the fist sweep itself is synchronized.
    const transitionFade = id.startsWith('hit-')
      ? 0.035
      : this.viewMode === 'first-person'
        && (isTurnAnimation(this.currentAnimation) || isTurnAnimation(id))
        ? 0.17
        : transitionFadeSeconds(this.currentAnimation, id);
    if (gaitBlend) this.gaitTransition.update(0);
    else if (previous && previous !== next) next.crossFadeFrom(previous, transitionFade, false);
    if (!gaitBlend && firstPersonPrevious && firstPersonPrevious !== firstPersonNext) {
      firstPersonNext.crossFadeFrom(firstPersonPrevious, transitionFade, false);
    }

    this.currentAction = next;
    this.firstPersonCurrentAction = firstPersonNext;
    this.currentAnimation = id;
    this.currentAnimationElapsed = 0;
    this.updateAnimationButtonState();
  }

  private requestAutoAnimation(
    id: AnimationId,
    loop: boolean,
    rate: number,
    reverse: boolean,
    delta: number,
    force: boolean,
  ): void {
    if (force) {
      this.autoCandidate = id;
      this.autoCandidateElapsed = 0;
      this.playAnimation(id, loop, rate, reverse, true);
      return;
    }

    if (id === this.currentAnimation) {
      this.autoCandidate = id;
      this.autoCandidateElapsed = 0;
      const signedRate = Math.max(0.05, Math.abs(rate)) * (reverse ? -1 : 1);
      const smoothedRate = isCycleLocomotionAnimation(id) && this.currentAction
        ? THREE.MathUtils.lerp(this.currentAction.getEffectiveTimeScale(), signedRate, expAlpha(delta, 14))
        : signedRate;
      this.currentAction?.setEffectiveTimeScale(smoothedRate);
      this.firstPersonCurrentAction?.setEffectiveTimeScale(smoothedRate);
      return;
    }

    if (isCycleLocomotionAnimation(this.currentAnimation) && isCycleLocomotionAnimation(id)) {
      // Direction chatter is already filtered by the dedicated lateral gate.
      // Once a new gait is intentional, switch immediately at the preserved
      // step phase instead of waiting for a second generic debounce window.
      this.autoCandidate = id;
      this.autoCandidateElapsed = 0;
      this.playAnimation(id, loop, rate, reverse);
      return;
    }

    if (this.autoCandidate !== id) {
      this.autoCandidate = id;
      this.autoCandidateElapsed = 0;
      return;
    }
    this.autoCandidateElapsed += delta;

    if (this.autoCandidateElapsed < THIRD_PERSON_LOOK_TUNING.animationCandidateHoldSeconds) return;

    this.autoCandidateElapsed = 0;
    this.playAnimation(id, loop, rate, reverse);
  }

  private playAutoImmediate(id: AnimationId, loop: boolean, rate = 1, reverse = false): void {
    this.autoCandidate = id;
    this.autoCandidateElapsed = 0;
    if (this.currentAnimation === id && this.currentAction) {
      const signedRate = Math.max(0.05, Math.abs(rate)) * (reverse ? -1 : 1);
      this.currentAction.setEffectiveTimeScale(signedRate);
      this.firstPersonCurrentAction?.setEffectiveTimeScale(signedRate);
      return;
    }
    this.playAnimation(id, loop, rate, reverse, true);
  }

  private combatIsEligible(): boolean {
    if (!this.ready || !this.player || this.ragdoll || this.recovery || this.health <= 0) return false;
    const state = this.player.getDebugState();
    return this.player.isLocked
      && !state.incapacitated
      && state.grounded
      && !state.airborne
      && !state.crouching
      && !state.lowPosture
      && !state.sliding;
  }

  private combatDefensiveGuardActive(): boolean {
    return this.combatPointerHeld
      || this.combatCounterModifierHeld
      || this.combatLatchReason === 'manual'
      || this.combatLatchReason === 'hit';
  }

  private combatAttackGuardActive(): boolean {
    return (this.combatPhase === 'enter' || this.combatPhase === 'guard')
      && this.combatDefensiveGuardActive();
  }

  private inferCombatResumeMode(moving: boolean): CombatIdleResumeMode {
    if (moving) return 'action';
    if (
      this.currentAnimation === 'idle'
      || this.currentAnimation === 'left-turn'
      || this.currentAnimation === 'right-turn'
      || this.currentAnimation === 'left-turn-90'
      || this.currentAnimation === 'right-turn-90'
      || this.idleSequencePhase === 'sleeping'
      || this.idleSequencePhase === 'sleeping-look'
    ) return 'sleeping';
    return 'action';
  }

  private prepareCombatLayerAction(
    pair: CombatLayerPair,
    rate: number,
    reverse: boolean,
    fadeSeconds: number,
  ): void {
    const signedRate = Math.max(0.05, Math.abs(rate)) * (reverse ? -1 : 1);
    for (const action of [pair.thirdPerson, pair.firstPerson]) {
      action.reset();
      action.enabled = true;
      action.paused = false;
      action.clampWhenFinished = false;
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.setEffectiveWeight(1);
      action.setEffectiveTimeScale(signedRate);
      if (reverse) action.time = Math.max(0, pair.clip.duration - 1e-4);
      action.play();
      if (fadeSeconds > 0) action.fadeIn(fadeSeconds);
    }
  }

  private setCombatLowerLayer(
    id: CombatLowerAnimation,
    reverse: boolean,
    rate: number,
    committedStrikeStep = false,
  ): void {
    const next = this.combatLowerLayers.get(id);
    if (!next) return;
    if (this.combatLowerActive === id && this.combatLowerReverse === reverse) {
      const signedRate = Math.max(0.05, Math.abs(rate)) * (reverse ? -1 : 1);
      next.thirdPerson.setEffectiveTimeScale(signedRate);
      next.firstPerson.setEffectiveTimeScale(signedRate);
      return;
    }
    const previousId = this.combatLowerActive;
    const previous = previousId ? this.combatLowerLayers.get(previousId) : undefined;
    // Direction changes inside a strike preserve the current step phase. The
    // physics trajectory now performs the plant/arc itself, so resetting the
    // locomotion cycle every time it crosses strafe -> diagonal -> forward is
    // exactly what would make the feet pop and look robotic.
    const preserveStepPhase = !!previous
      && previousId !== null
      && previousId !== 'fight-idle'
      && id !== 'fight-idle';
    const thirdPersonPhase = preserveStepPhase
      ? ((previous.thirdPerson.time % Math.max(1e-5, previous.clip.duration)) + previous.clip.duration)
        % previous.clip.duration / Math.max(1e-5, previous.clip.duration)
      : 0;
    const firstPersonPhase = preserveStepPhase
      ? ((previous.firstPerson.time % Math.max(1e-5, previous.clip.duration)) + previous.clip.duration)
        % previous.clip.duration / Math.max(1e-5, previous.clip.duration)
      : thirdPersonPhase;
    const touchesIdle = previousId === 'fight-idle' || id === 'fight-idle';
    const fadeSeconds = committedStrikeStep
      ? COMBAT_LOWER_STRIKE_CROSSFADE_SECONDS
      : touchesIdle
        ? COMBAT_LOWER_IDLE_CROSSFADE_SECONDS
        : COMBAT_LOWER_DIRECTION_CROSSFADE_SECONDS;
    previous?.thirdPerson.fadeOut(fadeSeconds);
    previous?.firstPerson.fadeOut(fadeSeconds);
    this.prepareCombatLayerAction(next, rate, reverse, fadeSeconds);

    if (preserveStepPhase) {
      next.thirdPerson.time = thirdPersonPhase * Math.max(1e-5, next.clip.duration);
      next.firstPerson.time = firstPersonPhase * Math.max(1e-5, next.clip.duration);
    }

    // Fight Idle upper and lower clips come from the same source animation. When
    // returning from a walk, resume the lower half at the exact phase currently
    // used by the continuously-running upper half. Resetting Hips to frame zero
    // was the visible 1P fist/body teleport when the player stopped moving.
    if (id === 'fight-idle' && this.combatUpperLayer) {
      const duration = Math.max(1e-5, next.clip.duration);
      next.thirdPerson.time = this.combatUpperLayer.thirdPerson.time % duration;
      next.firstPerson.time = this.combatUpperLayer.firstPerson.time % duration;
    }
    this.combatLowerActive = id;
    this.combatLowerReverse = reverse;
  }

  private startCombatLayers(): void {
    if (!this.player || !this.combatUpperLayer) return;
    this.gaitTransition.release(0.16);
    const state = this.player.getDebugState();
    const intent = this.player.getMovementIntent();
    const moving = state.horizontalSpeed >= 0.20 || Math.abs(intent.forward) > 0.05 || Math.abs(intent.right) > 0.05;
    const lower = combatLowerSelection(intent.forward, this.visualMovementRightIntent, moving);
    const rate = lower.id === 'fight-idle'
      ? 1
      : THREE.MathUtils.clamp(Math.max(state.horizontalSpeed, 0.46) / MOVEMENT_TUNING.locomotion.walkSpeed, 0.62, 1.55);

    const previous = this.currentAction;
    const previousFirst = this.firstPersonCurrentAction;
    if (previous && previous !== this.combatUpperLayer.thirdPerson) previous.fadeOut(0.20);
    if (previousFirst && previousFirst !== this.combatUpperLayer.firstPerson) previousFirst.fadeOut(0.20);
    this.prepareCombatLayerAction(this.combatUpperLayer, 1, false, 0.20);
    this.player.setMovementSpeedScale(COMBAT_GUARD_MOVE_SPEED_SCALE);
    this.combatLowerActive = null;
    this.setCombatLowerLayer(lower.id, lower.reverse, rate);
    this.currentAction = this.combatUpperLayer.thirdPerson;
    this.firstPersonCurrentAction = this.combatUpperLayer.firstPerson;
    this.currentAnimation = 'fight-idle';
    this.currentAnimationElapsed = 0;
    this.combatPhase = 'guard';
    this.combatTransition = null;
    this.firstPersonCombatReleaseSeconds = 0;
    // Solve the first-person guard frame once, then keep that exact framing
    // through walk/strafe/stop changes. Locomotion must never drag the fists
    // toward/away from the gameplay eye.
    this.firstPersonCombatFramingLocked = false;
    this.firstPersonCombatFramingSettleSeconds = FIRST_PERSON_COMBAT_FRAMING_SETTLE_SECONDS;
    this.autoOneShot = null;
    this.pendingStrongTurn = null;
    this.clearAuthoredTurn();
    this.updateAnimationButtonState();
    this.setStatus('COMBAT · GARDE');
  }

  private stopCombatLayers(fadeSeconds = 0.12): void {
    const stop = (action: THREE.AnimationAction | undefined): void => {
      if (!action) return;
      if (fadeSeconds <= 0) action.stop();
      else action.fadeOut(fadeSeconds);
    };
    if (this.combatUpperLayer) {
      stop(this.combatUpperLayer.thirdPerson);
      stop(this.combatUpperLayer.firstPerson);
    }
    if (this.combatLowerActive) {
      const lower = this.combatLowerLayers.get(this.combatLowerActive);
      stop(lower?.thirdPerson);
      stop(lower?.firstPerson);
    }
    this.combatLowerActive = null;
    this.combatLowerReverse = false;
  }

  private requestCombatGuard(reason: Exclude<CombatLatchReason, null>): void {
    if (!this.combatIsEligible() || !this.player) return;
    const state = this.player.getDebugState();
    const intent = this.player.getMovementIntent();
    // RMB during a sprint is ignored. Guard may cancel a pre-existing guard via
    // sprint intent, but it must never be activated *from* a running state.
    if (
      reason === 'manual'
      && (state.sprinting || (this.player.isSprintRequested() && intent.forward >= MOVEMENT_TUNING.locomotion.sprintForwardMin))
    ) return;
    const moving = state.horizontalSpeed >= 0.20 || Math.abs(intent.forward) > 0.05 || Math.abs(intent.right) > 0.05;
    this.combatResumeMode = this.inferCombatResumeMode(moving);
    this.combatLatchReason = reason;
    this.player.setSprintSuppressed(true);
    this.player.setMovementSpeedScale(COMBAT_GUARD_MOVE_SPEED_SCALE);
    this.playbackMode = 'auto';
    this.modeButton?.classList.add('is-active');
    this.autoOneShot = null;
    this.pendingStrongTurn = null;
    this.clearAuthoredTurn();

    if (this.combatPhase === 'guard' || this.combatPhase === 'enter') return;
    if (moving) {
      this.startCombatLayers();
      return;
    }
    const transition = combatEntryTransition(this.combatResumeMode) as AnimationId;
    this.combatPhase = 'enter';
    this.combatTransition = transition;
    this.playAutoImmediate(transition, false, 1);
    this.setStatus('COMBAT · MONTER LA GARDE');
  }

  private applyCombatMovementRestriction(delta: number, guarding: boolean): void {
    if (!this.player) return;
    if (guarding) {
      this.combatPostGuardMoveSeconds = 0;
      this.player.setSprintSuppressed(true);
      this.player.setMovementSpeedScale(COMBAT_GUARD_MOVE_SPEED_SCALE);
      return;
    }

    if (this.combatPostGuardMoveSeconds > 0) {
      this.combatPostGuardMoveSeconds = Math.max(0, this.combatPostGuardMoveSeconds - Math.max(0, delta));
      const recoverRemaining = Math.min(COMBAT_POST_GUARD_MOVE_RECOVER_SECONDS, this.combatPostGuardMoveSeconds);
      const recoverBlend = COMBAT_POST_GUARD_MOVE_RECOVER_SECONDS > 0
        ? recoverRemaining / COMBAT_POST_GUARD_MOVE_RECOVER_SECONDS
        : 0;
      const speedScale = this.combatPostGuardMoveSeconds > COMBAT_POST_GUARD_MOVE_RECOVER_SECONDS
        ? COMBAT_GUARD_MOVE_SPEED_SCALE
        : THREE.MathUtils.lerp(1, COMBAT_GUARD_MOVE_SPEED_SCALE, recoverBlend);
      this.player.setSprintSuppressed(true);
      this.player.setMovementSpeedScale(speedScale);
      if (this.combatPostGuardMoveSeconds > 0) return;
    }

    this.player.setSprintSuppressed(false);
    this.player.setMovementSpeedScale(1);
  }

  private finishCombatImmediately(
    state: ReturnType<PlayerController['getDebugState']>,
    fadeSeconds = 0.22,
    preserveGuardMoveSpeed = false,
  ): void {
    this.beginActionFacingReturn();
    const intent = this.player?.getMovementIntent() ?? { forward: 0, right: 0, sprint: false, crouch: false };
    const moving = state.horizontalSpeed >= 0.20 || Math.abs(intent.forward) > 0.05 || Math.abs(intent.right) > 0.05;
    const movingManualRelease = preserveGuardMoveSpeed && moving && state.grounded && !state.crouching && !state.lowPosture && !state.sliding;

    // A moving manual guard has two independent visual jobs when it releases:
    // legs must immediately hand back to normal locomotion, while the fists need
    // a noticeably longer upper-body fade. Keeping those fades separate avoids
    // both skating feet and the old instant arm drop.
    let releaseLowerPair: CombatLayerPair | undefined;
    let releaseLowerAnimation: AnimationId | null = null;
    let releaseLowerRate = 1;
    if (movingManualRelease) {
      const selection = combatLowerSelection(intent.forward, this.visualMovementRightIntent, true);
      releaseLowerPair = this.combatLowerActive ? this.combatLowerLayers.get(this.combatLowerActive) : undefined;
      releaseLowerAnimation = selection.id === 'walking-backward' ? 'walking' : selection.id;
      releaseLowerRate = THREE.MathUtils.clamp(
        Math.max(state.horizontalSpeed, 0.46) / MOVEMENT_TUNING.locomotion.walkSpeed,
        0.62,
        1.55,
      );
      this.combatUpperLayer?.thirdPerson.fadeOut(COMBAT_GUARD_MOVE_UPPER_RELEASE_BLEND_SECONDS);
      this.combatUpperLayer?.firstPerson.fadeOut(COMBAT_GUARD_MOVE_UPPER_RELEASE_BLEND_SECONDS);
      if (releaseLowerPair && releaseLowerAnimation) {
        // Make the lower combat cycle the source of the normal locomotion
        // crossfade so its current step phase is preserved. The upper guard is
        // left running independently for its slower 0.38 s visual release.
        this.currentAction = releaseLowerPair.thirdPerson;
        this.firstPersonCurrentAction = releaseLowerPair.firstPerson;
        this.currentAnimation = releaseLowerAnimation;
      }
    } else {
      this.stopCombatLayers(fadeSeconds);
    }

    this.combatLowerActive = null;
    this.combatLowerReverse = false;
    this.firstPersonCombatReleaseSeconds = Math.max(
      this.firstPersonCombatReleaseSeconds,
      movingManualRelease
        ? FIRST_PERSON_COMBAT_ROOT_RELEASE_SECONDS
        : Math.max(0.18, Math.min(FIRST_PERSON_COMBAT_ROOT_RELEASE_SECONDS, fadeSeconds + 0.08)),
    );
    this.combatPhase = 'none';
    this.combatTransition = null;
    this.combatLatchSeconds = 0;
    this.combatLatchReason = null;
    this.combatHeavyTapDetector.cancel();
    this.combatHeavyUpgradePending = false;
    if (preserveGuardMoveSpeed) {
      this.combatPostGuardMoveSeconds = Math.max(this.combatPostGuardMoveSeconds, COMBAT_POST_GUARD_MOVE_TOTAL_SECONDS);
      this.applyCombatMovementRestriction(0, false);
    } else {
      this.combatPostGuardMoveSeconds = 0;
      this.player?.setSprintSuppressed(false);
      this.player?.setMovementSpeedScale(1);
    }
    this.setStatus('PRÊT');
    if (moving && state.grounded && !state.crouching && !state.lowPosture && !state.sliding) {
      const lower = combatLowerSelection(intent.forward, this.visualMovementRightIntent, true);
      const rate = movingManualRelease ? releaseLowerRate : THREE.MathUtils.clamp(Math.max(state.horizontalSpeed, 0.46) / MOVEMENT_TUNING.locomotion.walkSpeed, 0.62, 1.55);
      const animation: AnimationId = lower.id === 'walking-backward' ? 'walking' : lower.id;
      if (movingManualRelease && releaseLowerPair && releaseLowerAnimation === animation) {
        // restart=true bypasses playAutoImmediate's same-id shortcut: currentAction
        // is deliberately the lower-only guard cycle here, so we must actually
        // start the ordinary full-body clip while preserving the current step.
        this.autoCandidate = animation;
        this.autoCandidateElapsed = 0;
        this.playAnimation(animation, true, rate, lower.reverse, true);
      } else {
        this.playAutoImmediate(animation, true, rate, lower.reverse);
      }
    }
  }

  private beginCombatExit(immediate: boolean): void {
    if (!this.player || this.combatPhase === 'none') return;
    this.beginActionFacingReturn();
    const state = this.player.getDebugState();
    if (immediate) {
      this.finishCombatImmediately(state, COMBAT_GUARD_SPRINT_EXIT_BLEND_SECONDS);
      return;
    }
    this.stopCombatLayers(0.12);
    const transition = combatExitTransition(this.combatResumeMode) as AnimationId;
    this.combatPhase = 'exit';
    this.combatTransition = transition;
    this.playAutoImmediate(transition, false, 1);
    this.applyCombatMovementRestriction(0, false);
    this.setStatus('COMBAT · BAISSER LA GARDE');
  }

  private updateCombatGuard(delta: number): boolean {
    if (!this.player) return false;
    this.firstPersonCombatReleaseSeconds = Math.max(
      0,
      this.firstPersonCombatReleaseSeconds - Math.max(0, delta),
    );
    const state = this.player.getDebugState();
    const intent = this.player.getMovementIntent();
    const moving = state.horizontalSpeed >= 0.20 || Math.abs(intent.forward) > 0.05 || Math.abs(intent.right) > 0.05;
    const sprintRequested = this.player.isSprintRequested() && intent.forward > 0.10;
    const eligible = this.combatIsEligible();

    if (
      !this.combatPointerHeld
      && moving
      && this.combatLatchReason === 'manual'
      && this.combatLatchSeconds > MANUAL_GUARD_MOVEMENT_RELEASE_SECONDS
    ) {
      // Releasing RMB while moving should not leave the player skating around
      // in guard for the full stationary grace. Give the fists 0.3 s to blend
      // naturally, then hand locomotion back to the ordinary state machine.
      this.combatLatchSeconds = MANUAL_GUARD_MOVEMENT_RELEASE_SECONDS;
    }
    if (!this.combatPointerHeld && this.combatLatchSeconds > 0) {
      this.combatLatchSeconds = Math.max(0, this.combatLatchSeconds - Math.max(0, delta));
    }

    const persist = combatGuardShouldPersist({
      viewMode: this.viewMode,
      pointerHeld: this.combatPointerHeld || this.combatCounterModifierHeld,
      latchSeconds: this.combatLatchSeconds,
      latchReason: this.combatLatchReason,
      moving,
      eligible: eligible && !sprintRequested,
    });

    if (persist && this.combatPhase === 'none') this.requestCombatGuard(this.combatLatchReason ?? 'manual');
    if (persist && this.combatPhase === 'exit') {
      this.startCombatLayers();
    }
    if (!persist && (this.combatPhase === 'enter' || this.combatPhase === 'guard')) {
      const preserveGuardMoveSpeed = this.combatLatchReason === 'manual' && moving;
      if (sprintRequested || !eligible) this.finishCombatImmediately(state, COMBAT_GUARD_SPRINT_EXIT_BLEND_SECONDS, preserveGuardMoveSpeed);
      else if (moving) this.finishCombatImmediately(state, COMBAT_GUARD_MOVE_RELEASE_BLEND_SECONDS, preserveGuardMoveSpeed);
      else this.beginCombatExit(false);
    }
    if (this.combatPhase === 'exit' && moving) {
      this.finishCombatImmediately(state);
      return false;
    }

    const guarding = this.combatPhase === 'enter' || this.combatPhase === 'guard';
    this.applyCombatMovementRestriction(delta, combatGuardBlocksSprint(guarding));

    if (this.combatPhase === 'enter') {
      // Never keep a full-body Idle→Fight clip on the legs once movement starts:
      // that was the skating/levitation bug. Cross-fade into the layered guard
      // immediately so locomotion owns Hips/legs while the guard blends in.
      if (moving) {
        this.startCombatLayers();
        return true;
      }
      if (this.combatTransition && this.animationStillPlaying(this.combatTransition, 0.06)) return true;
      this.startCombatLayers();
      return true;
    }

    if (this.combatPhase === 'guard') {
      const selection = combatLowerSelection(intent.forward, this.visualMovementRightIntent, moving);
      const rate = selection.id === 'fight-idle'
        ? 1
        : THREE.MathUtils.clamp(Math.max(state.horizontalSpeed, 0.46) / MOVEMENT_TUNING.locomotion.walkSpeed, 0.62, 1.55);
      this.setCombatLowerLayer(selection.id, selection.reverse, rate);
      return true;
    }

    if (this.combatPhase === 'exit') {
      if (this.combatTransition && this.animationStillPlaying(this.combatTransition, 0.06)) return true;
      const idle: AnimationId = this.combatResumeMode === 'action' ? 'idle-action' : 'idle';
      this.combatPhase = 'none';
      this.combatTransition = null;
      this.combatLatchSeconds = 0;
      this.combatLatchReason = null;
      this.playAutoImmediate(idle, true, 1);
      this.setStatus('PRÊT');
      return false;
    }

    return false;
  }

  private resetCombatState(clearPointer = false): void {
    this.combatGazeYaw = null;
    this.actionFacingReturnActive = false;
    this.actionFacingReturnSeconds = 0;
    if (this.groundKick && !this.ragdoll && !this.recovery && !this.combatHitReaction) this.player?.setInputEnabled(this.player.isLocked);
    this.player?.cancelCombatLunge();
    this.stopCombatLayers(0);
    this.combatAttackAction?.thirdPerson.stop();
    this.combatAttackAction?.firstPerson.stop();
    this.combatDodgeLayer?.thirdPerson.stop();
    this.combatDodgeLayer?.firstPerson.stop();
    this.combatAttack = null;
    this.combatAttackAction = undefined;
    this.combatDodge = null;
    this.groundKick = null;
    this.groundKickFootReady = false;
    this.combatHandSweepReady = false;
    this.combatHitReaction = null;
    this.combatHitReactionElapsed = 0;
    this.combatHitReactionDuration = 0;
    this.combatPhase = 'none';
    this.combatTransition = null;
    this.combatLatchSeconds = 0;
    this.combatLatchReason = null;
    this.combatPostGuardMoveSeconds = 0;
    this.firstPersonCombatReleaseSeconds = 0;
    this.combatAttackRecoverySeconds = 0;
    this.combatBufferedPunchSeconds = 0;
    this.combatHeldChainCount = 0;
    this.combatBufferedFromHold = false;
    this.combatHeldRestSeconds = 0;
    this.combatLockOnActive = false;
    this.combatLockOnDistance = Number.POSITIVE_INFINITY;
    this.combatCounterGuaranteedTarget = false;
    this.combatHeavyTapDetector.cancel();
    this.combatHeavyUpgradePending = false;
    if (clearPointer) {
      this.combatPointerHeld = false;
      this.combatLeftPointerHeld = false;
      this.combatLeftPressConsumed = false;
      // Do not clear F here. A combat reset can happen while the physical key is
      // still held (hit reaction, counter exchange, view/state transition). If
      // we clear it in software, no new keydown arrives and the next LMB leaks
      // back into an offensive punch. Only KeyF keyup or window blur exits parry.
    }
    this.player?.setSprintSuppressed(false);
    this.player?.setMovementSpeedScale(1);
  }

  /** Future melee/enemy systems can call this on a real received hit. */
  notifyCombatHit(): void {
    if (this.viewMode !== 'third-person' || !this.combatIsEligible()) return;
    this.combatLatchSeconds = COMBAT_HIT_GUARD_LATCH_SECONDS;
    this.combatLatchReason = 'hit';
    this.requestCombatGuard('hit');
  }

  /** Backward-compatible generic hit entry point: treated as a normal punch. */
  receiveCombatHit(amount = 0): void {
    if (amount <= 0) return;
    this.receiveMeleeAttack('punch', { x: 0, y: 0, z: 1 }, amount);
  }

  /** Public integration point for future real enemies/network players. */
  receiveMeleeAttack(
    kind: 'punch' | 'big-punch',
    direction: Readonly<{ x: number; y: number; z: number }>,
    overrideDamage?: number,
  ): void {
    this.npcHitDirection.set(direction.x, direction.y, direction.z);
    this.receivePlayerMeleeHit(kind, this.npcHitDirection, overrideDamage);
  }

  private chooseCombatHitAnimation(
    kind: MeleeAttackKind, previous: HitAnimationId | null, hitZone: CombatHitZone = 'upper-body',
  ): HitAnimationId {
    const pool: readonly HitAnimationId[] = hitZone !== 'head' ? ['hit-body']
      : kind === 'big-punch' ? ['hit-head-big-a', 'hit-head-big-b', 'hit-head-big-c']
      : kind === 'hook-counter' ? ['hit-head-medium-a', 'hit-head-medium-b']
      : ['hit-head-light', 'hit-head-medium-a', 'hit-head-medium-b'];
    return pool[(pool.indexOf(previous!) + 1) % pool.length]!;
  }

  private drawCombatAttackVariant(
    pool: readonly CombatAttackAnimation[],
    bag: CombatAttackAnimation[],
    previous: CombatAttackAnimation | null,
  ): CombatAttackAnimation {
    const trackRecent = bag === this.punchVariantBag
      || bag === this.closeShoveVariantBag
      || bag === this.farPunchVariantBag
      || bag === this.bigPunchVariantBag
      || bag === this.hookVariantBag;
    const recent = trackRecent ? this.recentPunchVariants : [];
    // Context can swap pools as distance changes. Never keep stale entries from
    // the previous spacing bucket or the player can see an irrelevant repeat.
    if (bag.some((entry) => !pool.includes(entry))) bag.length = 0;
    if (bag.length === 0) {
      bag.push(...pool);
      for (let index = bag.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(Math.random() * (index + 1));
        [bag[index], bag[swap]] = [bag[swap]!, bag[index]!];
      }
      // The last element is drawn first. Avoid beginning a fresh bag with the
      // exact same strike that ended the previous bag.
      if (previous && bag.length > 1 && bag[bag.length - 1] === previous) {
        [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1]!, bag[0]!];
      }
    }

    // Light/power punch variants have an A/B source family. Prefer the opposite
    // family from the previous strike, so rapid clicking alternates the broad
    // anatomical gesture instead of playing two near-identical motions in a row.
    if (previous && bag.length > 1) {
      const previousFamily = combatAttackSourceFamily(previous);
      const previousCharacter = combatAttackVisualProfile(previous)?.character;
      const previousSide = COMBAT_ATTACK_DESIRED_SIDE[previous];
      if (previousFamily || previousCharacter) {
        let alternateIndex = -1;
        for (let index = bag.length - 1; index >= 0; index -= 1) {
          const candidate = bag[index]!;
          const candidateProfile = combatAttackVisualProfile(candidate);
          if (!recent.includes(candidate)
            && COMBAT_ATTACK_DESIRED_SIDE[candidate] !== previousSide
            && combatAttackSourceFamily(candidate) !== previousFamily
            && candidateProfile?.character !== previousCharacter) {
            alternateIndex = index;
            break;
          }
        }
        if (alternateIndex < 0) {
          for (let index = bag.length - 1; index >= 0; index -= 1) {
            const candidate = bag[index]!;
            if (!recent.includes(candidate) && COMBAT_ATTACK_DESIRED_SIDE[candidate] !== previousSide) { alternateIndex = index; break; }
          }
        }
        if (alternateIndex < 0) {
          for (let index = bag.length - 1; index >= 0; index -= 1) {
            if (!recent.includes(bag[index]!) && combatAttackSourceFamily(bag[index]!) !== previousFamily) { alternateIndex = index; break; }
          }
        }
        if (alternateIndex >= 0 && alternateIndex !== bag.length - 1) {
          [bag[alternateIndex], bag[bag.length - 1]] = [bag[bag.length - 1]!, bag[alternateIndex]!];
        }
      }
    }
    if (recent.length > 0 && bag.length > 1 && recent.includes(bag[bag.length - 1]!)) {
      const freshIndex = bag.findIndex((candidate) => !recent.includes(candidate));
      if (freshIndex >= 0 && freshIndex !== bag.length - 1) {
        [bag[freshIndex], bag[bag.length - 1]] = [bag[bag.length - 1]!, bag[freshIndex]!];
      }
    }
    const chosen = bag.pop()!;
    if (trackRecent) {
      this.recentPunchVariants.push(chosen);
      while (this.recentPunchVariants.length > 3) this.recentPunchVariants.shift();
    }
    return chosen;
  }

  private scriptedCombatSequenceVariant(
    sequences: readonly (readonly CombatAttackAnimation[])[],
  ): CombatAttackAnimation {
    const previous = this.lastPunchVariant;
    const previousSide = previous ? COMBAT_ATTACK_DESIRED_SIDE[previous] : null;
    const recent = this.recentPunchVariants;
    // Walk the choreography deterministically, but skip candidates that would
    // visibly repeat the same gesture/arm. This gives short GTA-like exchanges
    // rather than a random bag of nearly identical punches.
    const longestSequence = Math.max(...sequences.map((sequence) => sequence.length));
    for (let offset = 0; offset < sequences.length * longestSequence; offset += 1) {
      const absolute = this.combatComboIndex + offset;
      const sequenceIndex = Math.floor(absolute / longestSequence) % sequences.length;
      const sequence = sequences[sequenceIndex]!;
      const slot = absolute % longestSequence;
      const candidate = sequence[slot % sequence.length]!;
      if (candidate === previous) continue;
      if (recent.includes(candidate)) continue;
      if (previousSide && COMBAT_ATTACK_DESIRED_SIDE[candidate] === previousSide && offset < 2) continue;
      this.combatComboIndex += offset + 1;
      this.recentPunchVariants.push(candidate);
      while (this.recentPunchVariants.length > 3) this.recentPunchVariants.shift();
      this.lastPunchVariant = candidate;
      return candidate;
    }
    const fallback = this.drawCombatAttackVariant(MEDIUM_ATTACK_VARIANTS, this.punchVariantBag, previous);
    this.combatComboIndex += 1;
    this.lastPunchVariant = fallback;
    return fallback;
  }

  private chooseCombatAttackVariant(
    kind: MeleeAttackKind,
    spacing: CombatMeleeSpacing = 'medium',
    targetDistance = Number.POSITIVE_INFINITY,
  ): CombatAttackAnimation {
    if (kind === 'hook-counter') {
      const next = this.drawCombatAttackVariant(HOOK_ATTACK_VARIANTS, this.hookVariantBag, this.lastHookVariant);
      this.lastHookVariant = next;
      return next;
    }
    if (kind === 'big-punch') {
      const next = this.drawCombatAttackVariant(BIG_PUNCH_ATTACK_VARIANTS, this.bigPunchVariantBag, this.lastBigPunchVariant);
      this.lastBigPunchVariant = next;
      return next;
    }

    if (spacing === 'close') {
      // Chest-to-chest contact becomes a real shove. At the outer edge of close
      // range we can still throw a compact/body shot instead of repeating the
      // same two shove gestures every time.
      const clinched = Number.isFinite(targetDistance) && targetDistance <= 0.56;
      const pool = clinched ? CLINCH_SHOVE_ATTACK_VARIANTS : CLOSE_RANGE_ATTACK_VARIANTS;
      const bag = clinched ? this.closeShoveVariantBag : this.punchVariantBag;
      const next = this.drawCombatAttackVariant(pool, bag, this.lastPunchVariant);
      this.lastPunchVariant = next;
      return next;
    }
    if (spacing === 'far') {
      const next = this.drawCombatAttackVariant(
        FAR_STEP_ATTACK_VARIANTS,
        this.farPunchVariantBag,
        this.lastPunchVariant,
      );
      this.lastPunchVariant = next;
      return next;
    }
    if (spacing === 'out') {
      // No target / remote target uses the dedicated step-in family. The strike
      // still follows the reticle (never the distant opponent), but the whole
      // body commits with visible footwork instead of throwing a rooted arm-only
      // whiff. Alternation keeps repeated no-target punches from looking cloned.
      const next = this.drawCombatAttackVariant(
        FAR_STEP_ATTACK_VARIANTS,
        this.farPunchVariantBag,
        this.lastPunchVariant,
      );
      this.lastPunchVariant = next;
      return next;
    }

    // Medium range is choreographed rather than random. Outer range prefers a
    // long/cross sequence, inner range mixes compact->cross/jab->straight beats.
    // The sequence helper still rejects recent variants and same-arm repetition.
    const sequences = Number.isFinite(targetDistance) && targetDistance > 1.24
      ? SCRIPTED_OUTER_SEQUENCES
      : SCRIPTED_MEDIUM_SEQUENCES;
    return this.scriptedCombatSequenceVariant(sequences);
  }

  private startCombatAttackLayer(
    kind: MeleeAttackKind,
    animation?: CombatAttackAnimation,
    replaceCurrent = false,
    spacing: CombatMeleeSpacing = 'medium',
    targetDistanceAtStart = Number.POSITIVE_INFINITY,
  ): void {
    if (!this.combatIsEligible() || this.combatHitReaction) return;
    if (kind !== 'hook-counter' && !replaceCurrent && this.combatAttackRecoverySeconds > 0) return;
    if (this.combatAttack && !replaceCurrent) return;
    this.actionFacingReturnActive = false;
    this.actionFacingReturnSeconds = 0;
    const previousAttackPair = replaceCurrent ? this.combatAttackAction : undefined;
    if (replaceCurrent) {
      previousAttackPair?.thirdPerson.fadeOut(COMBAT_ATTACK_CHAIN_BLEND_SECONDS);
      previousAttackPair?.firstPerson.fadeOut(COMBAT_ATTACK_CHAIN_BLEND_SECONDS);
      this.combatAttack = null;
      this.combatAttackAction = undefined;
    }
    const attackAnimation = animation ?? this.chooseCombatAttackVariant(kind, spacing, targetDistanceAtStart);
    const pair = this.combatAttackLayers.get(attackAnimation);
    if (!pair) return;
    if (kind === 'punch') this.lastPunchVariant = attackAnimation;

    if (this.combatPhase !== 'guard' && this.player) {
      const state = this.player.getDebugState();
      const intent = this.player.getMovementIntent();
      const moving = state.horizontalSpeed >= 0.20 || Math.abs(intent.forward) > 0.05 || Math.abs(intent.right) > 0.05;
      this.combatResumeMode = this.inferCombatResumeMode(moving);
      this.startCombatLayers();
    }
    if (this.combatPhase !== 'guard') return;
    const profile = MELEE_ATTACKS[kind];
    const visualProfile = combatAttackVisualProfile(attackAnimation);
    // Fight Idle NEVER fades out for a strike. The attack clip is a bounded
    // additive upper-body delta whose first/last frames are identity. Each rebuilt
    // variant also carries its own tempo so a spammed sequence does not hit the
    // exact same cadence every time.
    const playbackRate = combatAttackPlaybackRate(
      kind,
      pair.clip.duration,
      visualProfile?.tempoMultiplier ?? 1,
    );
    for (const action of [pair.thirdPerson, pair.firstPerson]) {
      action.stop();
      action.reset();
      action.enabled = true;
      action.paused = false;
      action.clampWhenFinished = true;
      action.setLoop(THREE.LoopOnce, 1);
      action.setEffectiveWeight(1);
      action.setEffectiveTimeScale(playbackRate);
      action.play();
      if (replaceCurrent) action.fadeIn(COMBAT_ATTACK_CHAIN_BLEND_SECONDS);
    }
    const duration = Math.max(0.08, pair.clip.duration / Math.max(0.05, playbackRate));
    const timing = combatAttackTimingProfile(attackAnimation);
    const strikingSide = this.combatAttackStrikingSides.get(attackAnimation) ?? 'right';
    this.combatAttack = {
      kind,
      animation: attackAnimation,
      spacing,
      targetDistanceAtStart,
      duration,
      endTime: duration * timing.finishFraction,
      impactTime: duration * timing.impactFraction,
      impactFraction: timing.impactFraction,
      contactStartFraction: timing.contactStartFraction,
      contactEndFraction: timing.contactEndFraction,
      strikingSide,
      elapsed: 0,
      impactApplied: false,
      sampledElapsed: 0,
    };
    this.combatAttackAction = pair;
    this.combatHeldChainCount += 1;
    // Every strike owns a fresh physical-contact sweep. Never inherit the last
    // hand segment/pending hit across chain conversion or a new attack.
    this.combatHandSweepReady = false;
    this.currentAction = pair.thirdPerson;
    this.firstPersonCurrentAction = pair.firstPerson;
    this.currentAnimation = COMBAT_ATTACK_SOURCE_ANIMATION[attackAnimation];
    const lockedTarget = kind === 'hook-counter' && this.combatCounterGuaranteedTarget
      ? this.combatTargetDirection(this.tempDirection, false, false)
      : this.combatLockOnActive
        ? this.combatTargetDirection(this.tempDirection, true, true)
        : null;
    this.combatAttackAimYaw = lockedTarget
      ? Math.atan2(lockedTarget.direction.x, lockedTarget.direction.z)
      : this.player
        ? Math.PI + this.player.getContinuousAimYawRadians()
        : this.bodyYaw;

    // Capture how the body was actually travelling when the punch began. Root
    // yaw no longer snaps to the reticle on mouse-down: the hips turn into the
    // strike during anticipation while locomotion retains its own momentum.
    // This gives strafe/reverse/turn attacks distinct entries.
    this.combatAttackStartBodyYaw = this.bodyYaw;
    const entryState = this.player?.getDebugState();
    this.combatStrikeForwardAxis.set(
      Math.sin(this.combatAttackAimYaw),
      0,
      Math.cos(this.combatAttackAimYaw),
    ).normalize();
    this.combatStrikeRightAxis.set(
      Math.cos(this.combatAttackAimYaw),
      0,
      -Math.sin(this.combatAttackAimYaw),
    ).normalize();
    this.bodyRight.crossVectors(this.combatStrikeForwardAxis, UP).normalize();
    if (entryState) {
      this.tempDirection.set(entryState.velocity.x, 0, entryState.velocity.z);
      this.combatAttackEntryForwardSpeed = this.tempDirection.dot(this.combatStrikeForwardAxis);
      this.combatAttackEntryRightSpeed = this.tempDirection.dot(this.bodyRight);
    } else {
      this.combatAttackEntryForwardSpeed = 0;
      this.combatAttackEntryRightSpeed = 0;
    }
    this.bodyTurning = false;
    this.lookOffsetDegrees = 0;
    this.headLookYaw = 0;
    this.currentAnimationElapsed = 0;
    this.player?.setSprintSuppressed(true);
    this.applyCombatAttackLunge(attackAnimation, spacing, replaceCurrent ? 0.42 : 1, duration);
    this.setStatus(kind === 'big-punch' ? 'COMBAT · BIG PUNCH' : kind === 'hook-counter' ? 'COMBAT · CONTRE HOOK' : 'COMBAT · PUNCH');
  }

  private finishCombatAttackLayer(): void {
    const finished = this.combatAttack;
    const pair = this.combatAttackAction;
    // Runtime ends shortly after the useful recoil instead of waiting through
    // a dead clip tail. Fade the remaining additive pose back into Fight Idle so
    // the faster cadence never produces a wrist/shoulder snap.
    pair?.thirdPerson.fadeOut(0.075);
    pair?.firstPerson.fadeOut(0.075);
    this.combatAttack = null;
    this.combatAttackAction = undefined;
    this.combatHandSweepReady = false;
    this.combatCounterGuaranteedTarget = false;
    if (finished) {
      this.beginActionFacingReturn();
      this.combatAttackRecoverySeconds = Math.max(
        this.combatAttackRecoverySeconds,
        combatAttackRecoverySeconds(finished.kind),
      );
      if (finished.kind === 'punch' || finished.kind === 'big-punch') {
        this.combatLastPunchFinishedAt = this.combatClock;
      }
    }
    if (this.combatUpperLayer && this.combatPhase === 'guard') {
      this.currentAction = this.combatUpperLayer.thirdPerson;
      this.firstPersonCurrentAction = this.combatUpperLayer.firstPerson;
      this.currentAnimation = 'fight-idle';
      this.currentAnimationElapsed = 0;
    }
  }

  private setPlayerAimForward(target: THREE.Vector3): THREE.Vector3 {
    const aimYaw = this.player
      ? Math.PI + this.player.getContinuousAimYawRadians()
      : this.bodyYaw;
    target.set(Math.sin(aimYaw), 0, Math.cos(aimYaw));
    if (target.lengthSq() < 1e-8) target.set(0, 0, 1);
    return target.normalize();
  }

  /**
   * Forward axis captured by the current strike. Free-air / remote punches use
   * this instead of live camera-forward so the committed step stays straight if
   * the player keeps moving the mouse during the brief load/contact window.
   */
  private setCombatAttackForward(target: THREE.Vector3): THREE.Vector3 {
    target.set(
      Math.sin(this.combatAttackAimYaw),
      0,
      Math.cos(this.combatAttackAimYaw),
    );
    if (target.lengthSq() < 1e-8) target.set(0, 0, 1);
    return target.normalize();
  }

  private combatTargetDirection(
    target: THREE.Vector3,
    requireLockRange = true,
    requireAttackFacing = false,
  ): { direction: THREE.Vector3; distance: number } | null {
    if (!this.idleNpcAnchor || !this.idleNpcCharacter || this.npcRagdoll || this.npcRecovery || this.npcHealth <= 0) return null;
    if (this.idleNpcHeadBone) this.idleNpcHeadBone.getWorldPosition(this.meleeTargetPosition);
    else this.meleeTargetPosition.copy(this.idleNpcAnchor.position).add(new THREE.Vector3(0, COMBAT_LOCK_ON_LOS_HEAD_HEIGHT, 0));

    this.meleeOrigin.copy(this.avatarAnchor.position).add(new THREE.Vector3(0, 1.22, 0));
    target.copy(this.meleeTargetPosition).sub(this.meleeOrigin);
    const fullDistance = target.length();
    if (!Number.isFinite(fullDistance) || fullDistance < 0.05) return null;
    if (requireLockRange && fullDistance > COMBAT_LOCK_ON_MAX_DISTANCE) return null;

    this.cameraRaycaster.set(this.meleeOrigin, target.clone().multiplyScalar(1 / fullDistance));
    this.cameraRaycaster.near = 0.04;
    this.cameraRaycaster.far = Math.max(0.04, fullDistance - 0.18);
    if (this.cameraRaycaster.intersectObjects(this.environmentMeshes, false).length > 0) return null;

    target.y = 0;
    const horizontalDistance = target.length();
    if (horizontalDistance < 1e-5) return null;
    target.multiplyScalar(1 / horizontalDistance);
    if (requireAttackFacing) {
      this.setPlayerAimForward(this.meleeForward);
      if (!combatAttackTargetFacingAllowed(target.dot(this.meleeForward))) return null;
    }
    return { direction: target, distance: horizontalDistance };
  }

  private updateCombatLockOn(delta: number): void {
    if (!this.player || !this.combatPointerHeld || !this.combatIsEligible()) {
      this.combatLockOnActive = false;
      this.combatLockOnDistance = Number.POSITIVE_INFINITY;
      return;
    }
    const target = this.combatTargetDirection(this.tempDirection, true);
    if (!target) {
      this.combatLockOnActive = false;
      this.combatLockOnDistance = Number.POSITIVE_INFINITY;
      return;
    }
    this.setPlayerAimForward(this.meleeForward);
    const aimDot = target.direction.dot(this.meleeForward);
    if (!combatLockOnFacingAllowed(aimDot, this.combatLockOnActive)) {
      this.combatLockOnActive = false;
      this.combatLockOnDistance = Number.POSITIVE_INFINITY;
      return;
    }

    const targetBodyYaw = Math.atan2(target.direction.x, target.direction.z);
    this.player.focusCombatAimYaw(
      targetBodyYaw,
      Math.max(0, delta),
      COMBAT_LOCK_ON_RESPONSE,
      COMBAT_LOCK_ON_MAX_DEGREES_PER_SECOND,
    );
    this.combatLockOnActive = true;
    this.combatLockOnDistance = target.distance;
  }

  private applyCombatAttackLunge(
    animation: CombatAttackAnimation, spacing: CombatMeleeSpacing, scale = 1, attackDuration = 0.66,
  ): void {
    if (!this.player) return;
    const timing = combatAttackTimingProfile(animation);
    const target = this.combatTargetDirection(this.tempDirection, false, true);
    // Normal boxing distance is reached through the hips/shoulder and arm. A
    // click in range (or an air punch) must never move the capsule automatically.
    const missing = target && target.distance <= 1.50 ? Math.max(0, target.distance - 1.08) : 0;
    const step = Math.min(missing, spacing === 'far' ? 0.28 : spacing === 'close' ? 0 : 0.16) * Math.min(1, scale);
    if (step < 0.025) { this.player.cancelCombatLunge(); return; }
    this.setCombatAttackForward(this.meleeForward);
    const duration = Math.max(0.16, attackDuration * timing.contactStartFraction);
    this.player.applyCombatLunge(this.meleeForward, Math.min(1.25, step / (duration * 0.52)), duration, timing.impactFraction);
  }

  private updateCombatAttackEngagement(): void {
    const attack = this.combatAttack;
    if (!attack || !this.player) return;
    const target = this.combatTargetDirection(this.tempDirection, false, true);
    if (attack.elapsed / attack.duration >= attack.contactStartFraction || (target && target.distance < 1.04)) {
      this.player.cancelCombatLunge();
    }
  }

  private combatSweepTargetPoints(): boolean {
    if (!this.idleNpcAnchor || !this.idleNpcCharacter || this.npcRagdoll || this.npcRecovery || this.npcHealth <= 0) return false;
    if (this.idleNpcHeadBone) this.idleNpcHeadBone.getWorldPosition(this.combatNpcHeadPoint);
    else this.combatNpcHeadPoint.copy(this.idleNpcAnchor.position).add(new THREE.Vector3(0, 1.58, 0));
    if (this.idleNpcHipsBone) this.idleNpcHipsBone.getWorldPosition(this.combatNpcBodyPoint);
    else this.combatNpcBodyPoint.copy(this.idleNpcAnchor.position).add(new THREE.Vector3(0, 0.92, 0));
    this.combatNpcChestPoint.copy(this.combatNpcBodyPoint).lerp(this.combatNpcHeadPoint, 0.64);
    // The body sphere sits above the pelvis so a clean stomach/rib shot counts,
    // while a fist merely brushing a thigh does not.
    this.combatNpcBodyPoint.lerp(this.combatNpcHeadPoint, 0.34);
    return true;
  }

  private combatSweepLineOfSight(from: Readonly<THREE.Vector3>, to: Readonly<THREE.Vector3>): boolean {
    this.tempDirection.copy(to).sub(from);
    const distance = this.tempDirection.length();
    if (distance < 0.04) return true;
    this.tempDirection.multiplyScalar(1 / distance);
    this.cameraRaycaster.set(from, this.tempDirection);
    this.cameraRaycaster.near = 0.015;
    this.cameraRaycaster.far = Math.max(0.02, distance - 0.06);
    return this.cameraRaycaster.intersectObjects(this.environmentMeshes, false).length === 0;
  }

  private sampleCombatKnuckle(hand: THREE.Bone, out: THREE.Vector3): void {
    hand.updateWorldMatrix(true, true);
    const knuckle = hand.children.find(child => /middle1$/i.test(child.name))
      ?? hand.children.find(child => /index1$/i.test(child.name));
    if (knuckle) knuckle.getWorldPosition(out);
    else hand.getWorldPosition(out);
  }

  private findActorSweepContact(
    playerAttack: boolean, attack: ActiveMeleeAttack,
    previous: THREE.Vector3, current: THREE.Vector3, delta: number,
    targets: THREE.Vector3[], oldTargets: THREE.Vector3[],
  ): CombatSweepContact | null {
    const origin = playerAttack ? this.avatarAnchor : this.idleNpcAnchor;
    const victim = playerAttack ? this.idleNpcAnchor : this.avatarAnchor;
    if (!origin || !victim) return null;
    const distance = Math.hypot(victim.position.x - origin.position.x, victim.position.z - origin.position.z);
    if (distance > MELEE_ATTACKS[attack.kind].reach) return null;
    const before = attack.sampledElapsed / attack.duration;
    const now = attack.elapsed / attack.duration;
    const zones: readonly CombatHitZone[] = ['head', 'upper-body', 'body'];
    // Anatomical target volumes plus the actual fist volume; never enlarge for
    // counters/re-hits or add a sphere at an intended (but untouched) aim point.
    const radii = [0.235, 0.295, 0.285];
    let result: CombatSweepContact | null = null;
    for (let index = 0; index < zones.length; index += 1) {
      const contact = sweepCombatContact(previous, current, oldTargets[index]!, targets[index]!,
        radii[index]!, delta, before, now, attack.contactStartFraction, attack.contactEndFraction);
      if (!contact || (result && result.fraction <= contact.fraction)) continue;
      const point = new THREE.Vector3(contact.point.x, contact.point.y, contact.point.z);
      const shoulder = playerAttack
        ? (attack.strikingSide === 'left' ? this.leftUpperArmBone : this.rightUpperArmBone)
        : (attack.strikingSide === 'left' ? this.idleNpcLeftUpperArmBone : this.idleNpcRightUpperArmBone);
      const source = shoulder?.getWorldPosition(new THREE.Vector3()) ?? origin.position.clone().add(new THREE.Vector3(0, 1.25, 0));
      if (!this.combatSweepLineOfSight(source, point) || !this.combatSweepLineOfSight(previous, point)) continue;
      result = { direction: new THREE.Vector3(contact.direction.x, contact.direction.y, contact.direction.z),
        point, distance, fistSpeed: contact.speed, fraction: contact.fraction, zone: zones[index]! };
    }
    return result;
  }

  private commitPlayerSweepImpact(attack: ActiveMeleeAttack, contact: CombatSweepContact): void {
    if (this.combatAttack !== attack || attack.impactApplied || this.combatHitReaction
      || this.ragdoll || this.recovery || this.npcRagdoll || this.npcRecovery || this.npcHealth <= 0) return;
    const damage = combatPhysicalContactDamage(attack.kind, attack.spacing, contact.distance, contact.fistSpeed, contact.zone);
    if (damage <= 0) return;
    attack.impactApplied = true;
    attack.compressionSeconds = attack.kind === 'big-punch' ? 0.065 : 0.048;
    const contactHand = attack.strikingSide === 'left' ? this.leftHandBone : this.rightHandBone;
    attack.contactPoint = contactHand?.getWorldPosition(new THREE.Vector3());
    this.player?.cancelCombatLunge();
    this.combatImpactAudio.contact(attack.kind === 'big-punch', contact.zone === 'body');
    this.combatCounterGuaranteedTarget = false;
    const shove = combatAttackVisualProfile(attack.animation)?.character === 'shove';
    this.beginNpcSpacingPush(contact.direction, shove ? 0.26 : attack.kind === 'big-punch' ? 0.11 : 0.055);
    this.receiveNpcMeleeHit(attack.kind, contact.direction, damage, contact.zone, contact.point);
  }

  /** Evaluate both actors on the same pose time, then resolve the earliest real contact. */
  private resolveCombatContacts(delta: number): void {
    const playerValid = this.combatPlayerSweepTargetPoints();
    const npcValid = this.combatSweepTargetPoints();
    const playerTargets = playerValid ? [this.combatPlayerHeadPoint.clone(), this.combatPlayerChestPoint.clone(), this.combatPlayerBodyPoint.clone()] : null;
    const npcTargets = npcValid ? [this.combatNpcHeadPoint.clone(), this.combatNpcChestPoint.clone(), this.combatNpcBodyPoint.clone()] : null;
    const events: Array<{ player: boolean; attack: ActiveMeleeAttack; contact: CombatSweepContact }> = [];
    for (const player of [true, false]) {
      const attack = player ? this.combatAttack : this.npcAttack;
      const left = player ? this.leftHandBone : this.idleNpcLeftHandBone;
      const right = player ? this.rightHandBone : this.idleNpcRightHandBone;
      if (!left || !right) continue;
      const currentLeft = player ? this.combatSweepLeftCurrent : this.npcSweepLeftCurrent;
      const currentRight = player ? this.combatSweepRightCurrent : this.npcSweepRightCurrent;
      const previousLeft = player ? this.combatSweepLeftPrevious : this.npcSweepLeftPrevious;
      const previousRight = player ? this.combatSweepRightPrevious : this.npcSweepRightPrevious;
      this.sampleCombatKnuckle(left, currentLeft);
      this.sampleCombatKnuckle(right, currentRight);
      const ready = player ? this.combatHandSweepReady : this.npcHandSweepReady;
      const targets = player ? npcTargets : playerTargets;
      const oldTargets = player ? this.combatPreviousTargets.npc : this.combatPreviousTargets.player;
      if (attack && !attack.impactApplied && ready && targets && oldTargets) {
        const contact = this.findActorSweepContact(player, attack,
          attack.strikingSide === 'left' ? previousLeft : previousRight,
          attack.strikingSide === 'left' ? currentLeft : currentRight, delta, targets, oldTargets);
        if (contact) events.push({ player, attack, contact });
      }
      previousLeft.copy(currentLeft); previousRight.copy(currentRight);
      if (player) this.combatHandSweepReady = !!attack;
      else this.npcHandSweepReady = !!attack;
      if (attack) attack.sampledElapsed = attack.elapsed;
    }
    this.combatPreviousTargets = { player: playerTargets, npc: npcTargets };
    // Identity validation inside commit prevents an interrupted attack in this
    // event list from inflicting damage later in this very same frame.
    events.sort((a, b) => a.contact.fraction - b.contact.fraction || b.contact.fistSpeed - a.contact.fistSpeed);
    for (const event of events) {
      if (event.player) this.commitPlayerSweepImpact(event.attack, event.contact);
      else this.commitNpcSweepImpact(event.attack, event.contact);
    }
  }

  private beginNpcSpacingPush(direction: Readonly<THREE.Vector3>, distanceMeters = 0.42): void {
    if (!this.idleNpcAnchor || this.npcRagdoll || this.npcRecovery || this.npcHealth <= 0) return;
    this.npcSpacingPushDirection.set(direction.x, 0, direction.z);
    if (this.npcSpacingPushDirection.lengthSq() < 1e-6) return;
    this.npcSpacingPushDirection.normalize();
    const duration = 0.18;
    this.npcSpacingPushSeconds = duration;
    this.npcSpacingPushSpeed = THREE.MathUtils.clamp(distanceMeters / duration, 0.8, 3.2);
  }

  private updateNpcSpacingPush(delta: number): void {
    if (!this.idleNpcAnchor || this.npcRagdoll || this.npcSpacingPushSeconds <= 0) return;
    const dt = Math.min(Math.max(0, delta), this.npcSpacingPushSeconds);
    if (dt <= 0) return;
    let step = this.npcSpacingPushSpeed * dt;
    if (step <= 1e-5) {
      this.npcSpacingPushSeconds = Math.max(0, this.npcSpacingPushSeconds - dt);
      return;
    }

    // Keep the dummy's shove displacement wall/pit safe. This is deliberately a
    // small spacing correction, not a ragdoll impulse or teleport.
    this.meleeOrigin.copy(this.idleNpcAnchor.position).add(new THREE.Vector3(0, 1.0, 0));
    this.cameraRaycaster.set(this.meleeOrigin, this.npcSpacingPushDirection);
    this.cameraRaycaster.near = 0.03;
    this.cameraRaycaster.far = step + 0.40;
    const wallHit = this.cameraRaycaster.intersectObjects(this.environmentMeshes, false)[0];
    if (wallHit) step = Math.max(0, Math.min(step, wallHit.distance - 0.36));

    const nextX = this.idleNpcAnchor.position.x + this.npcSpacingPushDirection.x * step;
    const nextZ = this.idleNpcAnchor.position.z + this.npcSpacingPushDirection.z * step;
    const entersPit = MOVEMENT_LAB_PITS.some((pit) =>
      nextX > pit.minX - 0.42 && nextX < pit.maxX + 0.42
      && nextZ > pit.minZ - 0.42 && nextZ < pit.maxZ + 0.42
    );
    if (!entersPit && step > 0) {
      this.idleNpcAnchor.position.x = nextX;
      this.idleNpcAnchor.position.z = nextZ;
      this.syncNpcPlayerBlocker(true);
    }
    this.npcSpacingPushSeconds = Math.max(0, this.npcSpacingPushSeconds - dt);
    if (this.npcSpacingPushSeconds <= 0) this.npcSpacingPushSpeed = 0;
  }

  private playerFacesNpcForCounter(): boolean {
    if (!this.idleNpcAnchor || this.npcRagdoll || this.npcRecovery || this.npcHealth <= 0) return false;
    this.setPlayerAimForward(this.meleeForward);
    this.tempDirection.copy(this.idleNpcAnchor.position).sub(this.avatarAnchor.position);
    this.tempDirection.y = 0;
    const distanceSq = this.tempDirection.lengthSq();
    if (distanceSq < 1e-6) return true;
    this.tempDirection.multiplyScalar(1 / Math.sqrt(distanceSq));
    return combatCounterFacingAllowed(this.tempDirection.dot(this.meleeForward));
  }

  private npcCounterWindowIsOpen(): boolean {
    return !!this.npcAttack
      && this.npcCombatEnabled
      && this.npcCombatPhase === 'attack'
      && this.playerFacesNpcForCounter()
      && npcCounterWindowOpen(this.npcAttack.elapsed, this.npcAttack.impactTime);
  }

  private executeHookCounter(): void {
    if (!this.npcCounterWindowIsOpen() || !this.npcAttack || this.combatAttack || this.combatHitReaction || this.combatDodge) return;

    // GTA-style counter flow: first get the head/body out of the incoming line,
    // then rise into the counter. Cancelling the hostile hit here represents the
    // successful evade; the player's hook is deliberately delayed until the
    // visible duck has happened instead of firing on the same frame.
    const hostileAction = this.idleNpcCombatAttackActions.get(this.npcAttack.animation);
    hostileAction?.fadeOut(0.07);
    this.npcAttack = null;
    this.npcHandSweepReady = false;
    this.combatCounterGuaranteedTarget = true;
    this.npcAttackCooldown = 1.05;
    this.npcCombatPhase = 'guard';
    this.playNpcAnimation('fight-idle', true, 1, true);

    this.combatLatchReason = 'hit';
    this.combatLatchSeconds = Math.max(this.combatLatchSeconds, COMBAT_HIT_GUARD_LATCH_SECONDS);
    this.requestCombatGuard('hit');

    const dodge = this.combatDodgeLayer;
    if (dodge) {
      for (const action of [dodge.thirdPerson, dodge.firstPerson]) {
        action.stop();
        action.reset();
        action.enabled = true;
        action.paused = false;
        action.clampWhenFinished = true;
        action.setLoop(THREE.LoopOnce, 1);
        action.setEffectiveWeight(1);
        action.setEffectiveTimeScale(dodge.clip.duration / COMBAT_DODGE_COUNTER_DURATION_SECONDS);
        action.play();
        action.fadeIn(0.055);
      }
    }

    const target = this.combatTargetDirection(this.tempDirection, true, true);
    if (target && this.player) {
      const side = this.combatCounterDodgeSide;
      this.meleeForward.set(
        -target.direction.z * side * COMBAT_DODGE_COUNTER_SIDE_SPEED - target.direction.x * COMBAT_DODGE_COUNTER_BACK_SPEED,
        0,
        target.direction.x * side * COMBAT_DODGE_COUNTER_SIDE_SPEED - target.direction.z * COMBAT_DODGE_COUNTER_BACK_SPEED,
      );
      const dodgeSpeed = this.meleeForward.length();
      if (dodgeSpeed > 1e-5) {
        this.meleeForward.multiplyScalar(1 / dodgeSpeed);
        this.player.applyCombatLunge(this.meleeForward, dodgeSpeed, COMBAT_DODGE_COUNTER_MOVE_SECONDS, 0.48, 'impulse');
      }
      this.combatCounterDodgeSide *= -1;
    }

    this.combatDodge = {
      elapsed: 0,
      duration: COMBAT_DODGE_COUNTER_DURATION_SECONDS,
      side: this.combatCounterDodgeSide * -1,
      counterStarted: false,
    };
    this.setStatus('COMBAT · ESQUIVE');
  }

  private updateCombatDodgeCounter(delta: number): boolean {
    if (!this.combatDodge) return false;
    const dodge = this.combatDodge;
    dodge.elapsed += Math.max(0, delta);
    if (!dodge.counterStarted && dodge.elapsed >= COMBAT_DODGE_COUNTER_STRIKE_AT_SECONDS) {
      dodge.counterStarted = true;
      const target = this.combatTargetDirection(this.tempDirection, false, true);
      const distance = target?.distance ?? this.combatLockOnDistance;
      const spacing = combatMeleeSpacingForDistance(distance);
      this.startCombatAttackLayer('hook-counter', undefined, false, spacing, distance);
      this.setStatus('COMBAT · ESQUIVE + CONTRE');
    }
    if (dodge.elapsed < dodge.duration) return true;
    this.combatDodgeLayer?.thirdPerson.fadeOut(0.07);
    this.combatDodgeLayer?.firstPerson.fadeOut(0.07);
    this.combatDodge = null;
    return false;
  }

  private applyThirdPersonCombatDodgePose(): void {
    const dodge = this.combatDodge;
    if (!dodge) return;
    const normalized = THREE.MathUtils.clamp(dodge.elapsed / Math.max(1e-5, dodge.duration), 0, 1);
    const counterStart = THREE.MathUtils.clamp(
      COMBAT_DODGE_COUNTER_STRIKE_AT_SECONDS / Math.max(1e-5, dodge.duration),
      0.42,
      0.72,
    );
    const slipIn = THREE.MathUtils.smoothstep(normalized, 0.02, 0.18);
    const slipOut = 1 - THREE.MathUtils.smoothstep(normalized, counterStart - 0.035, Math.min(0.88, counterStart + 0.22));
    const slip = Math.min(slipIn, slipOut);
    const counterDrive = THREE.MathUtils.smoothstep(normalized, Math.max(0.30, counterStart - 0.035), Math.min(0.88, counterStart + 0.20))
      * (1 - THREE.MathUtils.smoothstep(normalized, 0.86, 0.995));
    if (slip <= 1e-4 && counterDrive <= 1e-4) return;

    const side = dodge.side >= 0 ? 1 : -1;
    const strikeSide = this.combatAttack?.kind === 'hook-counter'
      ? (this.combatAttack.strikingSide === 'left' ? -1 : 1)
      : -side;
    this.combatStrikeForwardAxis.set(
      Math.sin(this.bodyYaw),
      0,
      Math.cos(this.bodyYaw),
    ).normalize();
    this.combatStrikeRightAxis.set(
      Math.cos(this.bodyYaw),
      0,
      -Math.sin(this.bodyYaw),
    ).normalize();

    // Phase 1: planted slip. The real controller supplies the side/back step;
    // the skeleton bends through ankle/hip/chest without lowering the world root.
    this.applyWorldAxisOffset(
      this.combatSpineBone,
      this.combatStrikeForwardAxis,
      -side * COMBAT_DODGE_THIRD_PERSON_ROLL * slip * 0.34,
    );
    this.applyWorldAxisOffset(
      this.combatSpine1Bone,
      this.combatStrikeForwardAxis,
      -side * COMBAT_DODGE_THIRD_PERSON_ROLL * slip * 0.33,
    );
    this.applyWorldAxisOffset(
      this.combatSpine2Bone,
      this.combatStrikeForwardAxis,
      -side * COMBAT_DODGE_THIRD_PERSON_ROLL * slip * 0.33,
    );
    this.applyWorldYawOffset(this.combatSpine1Bone, side * COMBAT_DODGE_THIRD_PERSON_YAW * slip * 0.42);
    this.applyWorldYawOffset(this.combatSpine2Bone, side * COMBAT_DODGE_THIRD_PERSON_YAW * slip * 0.58);
    this.applyWorldAxisOffset(
      this.leftUpperLegBone,
      this.combatStrikeForwardAxis,
      side * COMBAT_DODGE_THIRD_PERSON_LEG_LOAD * slip,
    );
    this.applyWorldAxisOffset(
      this.rightUpperLegBone,
      this.combatStrikeForwardAxis,
      -side * COMBAT_DODGE_THIRD_PERSON_LEG_LOAD * slip * 0.72,
    );

    // Phase 2: rise through the counter instead of snapping from the low slip
    // directly into the hook clip. The loaded leg releases, the chest unwinds
    // toward the striking side and the torso comes slightly forward into contact.
    this.applyWorldYawOffset(
      this.combatSpine1Bone,
      strikeSide * COMBAT_DODGE_THIRD_PERSON_COUNTER_TWIST * counterDrive * 0.38,
    );
    this.applyWorldYawOffset(
      this.combatSpine2Bone,
      strikeSide * COMBAT_DODGE_THIRD_PERSON_COUNTER_TWIST * counterDrive * 0.62,
    );
    this.applyWorldAxisOffset(
      this.combatSpineBone,
      this.combatStrikeRightAxis,
      COMBAT_DODGE_THIRD_PERSON_COUNTER_DRIVE * counterDrive * 0.25,
    );
    this.applyWorldAxisOffset(
      this.combatSpine1Bone,
      this.combatStrikeRightAxis,
      COMBAT_DODGE_THIRD_PERSON_COUNTER_DRIVE * counterDrive * 0.32,
    );
    this.applyWorldAxisOffset(
      this.combatSpine2Bone,
      this.combatStrikeRightAxis,
      COMBAT_DODGE_THIRD_PERSON_COUNTER_DRIVE * counterDrive * 0.43,
    );
  }

  private resolveGroundKickTarget(target: THREE.Vector3): GroundKickKind | null {
    if (this.npcRecovery) {
      this.npcRecovery.getPelvisPosition(this.groundKickTargetPelvis);
      this.npcRecovery.getHeadPose(this.groundKickTargetHead, this.tempQuaternionA);
      target.copy(this.groundKickTargetPelvis).lerp(this.groundKickTargetHead, 0.42);
      return 'get-up-kick';
    }
    if (this.npcRagdoll) {
      if (this.npcRagdoll.getGroundKickSurface(this.avatarAnchor.position, target)) {
        const kind = this.groundKick?.kind ?? groundKickKindForTarget(
          Math.hypot(target.x - this.avatarAnchor.position.x, target.z - this.avatarAnchor.position.z),
          target.y - this.avatarAnchor.position.y,
        );
        if (kind === 'soccer-kick') this.npcRagdoll.getGroundKickSideSurface(this.avatarAnchor.position, target);
        return kind;
      }
      this.npcRagdoll.getPelvisPose(this.groundKickTargetPelvis, this.tempQuaternionA);
      this.npcRagdoll.getHeadPose(this.groundKickTargetHead, this.tempQuaternionB);
      target.copy(this.groundKickTargetPelvis).lerp(this.groundKickTargetHead, 0.30);
      return 'stomp';
    }
    return null;
  }

  private groundKickHasLineOfSight(target: Readonly<THREE.Vector3>): boolean {
    this.meleeOrigin.copy(this.avatarAnchor.position).add(new THREE.Vector3(0, 0.76, 0));
    this.tempDirection.copy(target).sub(this.meleeOrigin);
    const distance = this.tempDirection.length();
    if (distance < 1e-5) return true;
    this.tempDirection.multiplyScalar(1 / distance);
    this.cameraRaycaster.set(this.meleeOrigin, this.tempDirection);
    this.cameraRaycaster.near = 0.04;
    this.cameraRaycaster.far = Math.max(0.04, distance - 0.08);
    return this.cameraRaycaster.intersectObjects(this.environmentMeshes, false).length === 0;
  }

  private tryStartGroundKick(): boolean {
    if (!this.player || this.ragdoll || this.recovery || this.player.isIncapacitated || this.groundKick || this.combatHitReaction) return false;
    const kind = this.resolveGroundKickTarget(this.groundKickTargetPoint);
    if (!kind) return false;
    const profile = GROUND_KICK_PROFILES[kind];
    this.tempDirection.set(
      this.groundKickTargetPoint.x - this.avatarAnchor.position.x,
      0,
      this.groundKickTargetPoint.z - this.avatarAnchor.position.z,
    );
    const distance = this.tempDirection.length();
    if (distance > profile.maxTargetDistance || distance < 0.16 || !this.groundKickHasLineOfSight(this.groundKickTargetPoint)) return false;
    this.tempDirection.multiplyScalar(1 / distance);
    const desiredYaw = Math.atan2(this.tempDirection.x, this.tempDirection.z);
    const startYaw = this.bodyYaw;
    const startYawError = wrapAngleRadians(desiredYaw - startYaw);
    // A ground kick is a committed forward/diagonal action, not a turret. If the
    // downed body is far off to the side, do not rotate 90° (or chase a rolling
    // ragdoll through repeated wrap boundaries) just to manufacture contact.
    if (Math.abs(startYawError) > GROUND_KICK_MAX_START_YAW_ERROR) return false;
    const targetYaw = startYaw + THREE.MathUtils.clamp(
      startYawError,
      -GROUND_KICK_MAX_ROOT_TURN,
      GROUND_KICK_MAX_ROOT_TURN,
    );

    if (this.character) this.playerHitHandoff.capture(this.character, 0.18);
    if (this.firstPersonCharacter) this.firstPersonHitHandoff.capture(this.firstPersonCharacter, 0.18);
    this.resetCombatState(false);
    this.combatBufferedPunchSeconds = 0;
    this.combatHeavyTapDetector.cancel();
    const side: CombatStrikeSide = this.lastGroundKickSide === 'right' ? 'left' : 'right';
    this.lastGroundKickSide = side;
    const foot = side === 'left' ? this.leftFootBone : this.rightFootBone;
    const support = side === 'left' ? this.rightFootBone : this.leftFootBone;
    const upper = side === 'left' ? this.leftUpperLegBone : this.rightUpperLegBone;
    const lower = side === 'left' ? this.leftLowerLegBone : this.rightLowerLegBone;
    if (!foot || !support || !upper || !lower) return false;
    this.avatarAnchor.updateMatrixWorld(true);
    const hip = upper.getWorldPosition(new THREE.Vector3());
    const knee = lower.getWorldPosition(new THREE.Vector3());
    const ankle = foot.getWorldPosition(new THREE.Vector3());
    const legReach = (hip.distanceTo(knee) + knee.distanceTo(ankle)) * 0.96;
    const targetPoint = this.groundKickTargetPoint.clone().add(new THREE.Vector3(0, 0.055, 0));
    const horizontal = Math.hypot(targetPoint.x - hip.x - Math.sin(targetYaw) * 0.14,
      targetPoint.z - hip.z - Math.cos(targetYaw) * 0.14);
    const verticalReach = Math.sqrt(Math.max(0.01, legReach * legReach - horizontal * horizontal));
    this.groundKick = {
      footStart: ankle,
      supportStart: support.getWorldPosition(new THREE.Vector3()),
      supportRotation: support.getWorldQuaternion(new THREE.Quaternion()),
      pelvisDrop: THREE.MathUtils.clamp(hip.y - targetPoint.y - verticalReach, 0, 0.20),
      footRotation: foot.getWorldQuaternion(new THREE.Quaternion()),
      pelvisStart: this.hipsBone?.position.clone() ?? new THREE.Vector3(),
      targetPoint,
      previousTarget: this.groundKickTargetPoint.clone(),
      sampledElapsed: 0,
      kind,
      side,
      duration: profile.duration,
      impactTime: profile.duration * profile.impactFraction,
      startYaw,
      targetYaw,
      elapsed: 0,
      impactApplied: false,
      compressionSeconds: 0,
      contactAge: 0,
    };
    this.groundKickFootReady = false;
    this.combatLeftPressConsumed = true;
    this.bodyTurning = false;
    this.lookOffsetDegrees = 0;
    this.headLookYaw = 0;
    this.playAutoImmediate('fight-idle', true, 1);
    this.player.setInputEnabled(false, true);

    if (distance > 0.76) {
      const missing = Math.max(0, distance - 0.70);
      const speed = THREE.MathUtils.clamp(missing / 0.20, 0.45, 1.60);
      this.combatStrikeForwardAxis.set(Math.sin(targetYaw), 0, Math.cos(targetYaw)).normalize();
      this.player.applyCombatLunge(
        this.combatStrikeForwardAxis,
        speed,
        0.20,
        profile.impactFraction,
        'strike',
      );
    }
    this.setStatus(kind === 'get-up-kick' ? 'COMBAT · KICK D’INTERRUPTION'
      : kind === 'soccer-kick' ? 'COMBAT · FRAPPE AU SOL' : 'COMBAT · ÉCRASEMENT');
    return true;
  }

  private updateGroundKick(delta: number): boolean {
    const kick = this.groundKick;
    if (!kick || !this.player) return false;
    const liveKind = this.resolveGroundKickTarget(this.groundKickTargetPoint);
    if (!liveKind) this.player.cancelCombatLunge();
    this.tempDirection.set(
      this.groundKickTargetPoint.x - this.avatarAnchor.position.x,
      0,
      this.groundKickTargetPoint.z - this.avatarAnchor.position.z,
    );
    const distance = this.tempDirection.length();

    // Root yaw is authored once at kick start and can only turn through a small
    // bounded arc during the load. Never chase the live pelvis/head point: a
    // rolling ragdoll can cross behind the attacker and otherwise generate 90°
    // snaps or multiple full spins in a fraction of a second.
    const normalizedBeforeStep = kick.duration > 1e-5
      ? THREE.MathUtils.clamp(kick.elapsed / kick.duration, 0, 1)
      : 1;
    // A fallen body can still settle during the knee lift. Adjust the landing
    // point during that preparation only; once the leg drives, commit and allow
    // a real miss. Root orientation stays fixed and cannot chase a rolling body.
    if (liveKind && normalizedBeforeStep < 0.30) {
      const landing = this.groundKickTargetPoint.clone().add(new THREE.Vector3(0, 0.055, 0));
      if (landing.distanceTo(kick.targetPoint) < 0.40) {
        kick.targetPoint.lerp(landing, 1 - Math.exp(-Math.max(0, delta) * 24));
      }
    }
    const turnBlend = THREE.MathUtils.smoothstep(
      normalizedBeforeStep,
      0.01,
      GROUND_KICK_ROOT_TURN_END_FRACTION,
    );
    this.bodyYaw = kick.startYaw + wrapAngleRadians(kick.targetYaw - kick.startYaw) * turnBlend;
    this.avatarAnchor.rotation.y = this.bodyYaw;

    if (distance > 0.76 && normalizedBeforeStep < 0.22) {
      const missing = Math.max(0, distance - 0.70);
      const lockedForward = this.combatStrikeForwardAxis.set(
        Math.sin(kick.targetYaw), 0, Math.cos(kick.targetYaw),
      ).normalize();
      this.player.retargetCombatLunge(
        lockedForward,
        THREE.MathUtils.clamp(missing / Math.max(0.08, kick.impactTime - kick.elapsed), 0.35, 1.60),
      );
    }
    if (normalizedBeforeStep >= 0.24) this.player.cancelCombatLunge();
    const strikeClock = advanceStrikeClock(delta, kick.compressionSeconds);
    kick.compressionSeconds = strikeClock.remaining;
    kick.elapsed += strikeClock.step;
    if (kick.contactFoot) kick.contactAge += Math.max(0, delta);
    if (kick.elapsed < kick.duration) return true;
    this.player.cancelCombatLunge();
    this.groundKick = null;
    this.groundKickFootReady = false;
    this.beginActionFacingReturn();
    this.player.setInputEnabled(this.player.isLocked);
    if (this.combatPointerHeld) this.requestCombatGuard('manual');
    else this.setStatus('PRÊT');
    return false;
  }

  private applyGroundKickPose(): void {
    const kick = this.groundKick;
    if (!kick) return;
    const t = THREE.MathUtils.clamp(kick.elapsed / kick.duration, 0, 1);
    const pose = groundKickPose(t, kick.kind);
    const entryWeight = easeCombat(t / (kick.kind === 'get-up-kick' ? 0.10 : 0.20));
    const upper = kick.side === 'left' ? this.leftUpperLegBone : this.rightUpperLegBone;
    const lower = kick.side === 'left' ? this.leftLowerLegBone : this.rightLowerLegBone;
    const foot = kick.side === 'left' ? this.leftFootBone : this.rightFootBone;
    const supportUpper = kick.side === 'left' ? this.rightUpperLegBone : this.leftUpperLegBone;
    const supportLower = kick.side === 'left' ? this.rightLowerLegBone : this.leftLowerLegBone;
    const supportFoot = kick.side === 'left' ? this.rightFootBone : this.leftFootBone;
    if (!upper || !lower || !foot || !supportUpper || !supportLower || !supportFoot) return;
    if (kick.kind !== 'get-up-kick' && this.hipsBone) {
      // Keep the captured pelvis height while preparing the strike. Retain the
      // clip's hip/thigh rotations so the planted leg keeps its relaxed stance.
      const release = easeCombat((t - 0.80) / 0.20);
      this.hipsBone.position.lerpVectors(kick.pelvisStart, this.hipsBone.position.clone(), release);
      this.hipsBone.updateWorldMatrix(true, true);
    }
    const forward = new THREE.Vector3(Math.sin(kick.targetYaw), 0, Math.cos(kick.targetYaw));
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    // One short placement step during load; support is planted before extension.
    if (t <= 0.24) supportFoot.getWorldPosition(kick.supportStart);
    // Load the planted leg and move the pelvis over it before extending. A
    // fixed upright pelvis made the foot stop short at the leg's reach limit.
    // This is a bounded weight transfer, not extra limb length or target reach.
    if (this.hipsBone?.parent) {
      const pelvis = this.hipsBone.getWorldPosition(new THREE.Vector3());
      if (t < 0.30) {
        // The physical support may rise while stepping beside a fallen body.
        // Finish adjusting the stance during load, then commit its depth.
        const hip = upper.getWorldPosition(new THREE.Vector3());
        const knee = lower.getWorldPosition(new THREE.Vector3());
        const reach = (hip.distanceTo(knee) + knee.distanceTo(foot.getWorldPosition(new THREE.Vector3()))) * 0.96;
        const horizontal = Math.hypot(kick.targetPoint.x - hip.x - forward.x * 0.14,
          kick.targetPoint.z - hip.z - forward.z * 0.14);
        const vertical = Math.sqrt(Math.max(0.01, reach * reach - horizontal * horizontal));
        kick.pelvisDrop = THREE.MathUtils.clamp(hip.y - kick.targetPoint.y - vertical, 0, 0.22);
      }
      const supportOffset = kick.supportStart.clone().sub(pelvis).dot(right);
      // Ease the weight transfer out of the captured resting stance.
      const load = pose.supportLoad * entryWeight;
      const transfer = kick.kind === 'get-up-kick' ? 0.14 * load
        : 0.12 * load + 0.05 * pose.drive * entryWeight;
      pelvis.addScaledVector(forward, transfer);
      pelvis.addScaledVector(right, THREE.MathUtils.clamp(supportOffset, -0.07, 0.07) * load);
      // Keep both soles on the floor during the quiet preparation. Lower the
      // pelvis as the lifted leg takes over, when its IK has reached full weight.
      pelvis.y -= kick.pelvisDrop * pose.supportLoad
        * (kick.kind === 'get-up-kick' ? entryWeight : pose.lift);
      this.hipsBone.position.copy(this.hipsBone.parent.worldToLocal(pelvis));
      this.hipsBone.updateWorldMatrix(false, true);
    }
    const downward = kick.kind !== 'soccer-kick' && (kick.kind === 'stomp' || kick.targetPoint.y - this.avatarAnchor.position.y < 0.55);
    const chamber = kick.footStart.clone().lerp(kick.targetPoint, downward ? 1 : 0.65);
    chamber.y = Math.min(upper.getWorldPosition(new THREE.Vector3()).y - 0.12,
      Math.max(kick.footStart.y + 0.38, kick.targetPoint.y + 0.24));
    const target = new THREE.Vector3();
    if (kick.kind === 'stomp') {
      // Load first, lift without a pop, then accelerate the sole downwards.
      chamber.y = Math.min(upper.getWorldPosition(new THREE.Vector3()).y - 0.10,
        Math.max(kick.footStart.y + 0.54, kick.targetPoint.y + 0.40));
      if (t < 0.43) target.lerpVectors(kick.footStart, chamber, pose.lift);
      else if (t < 0.66) target.lerpVectors(chamber, kick.targetPoint, pose.strike);
      else {
        target.lerpVectors(kick.targetPoint, kick.footStart, pose.recover);
        target.y += Math.sin(Math.PI * pose.recover) * 0.12;
      }
    } else if (kick.kind === 'soccer-kick') {
      // A compact low strike driven from the hip, rather than a long football
      // backswing. The boot meets the flank and stops against its resistance.
      chamber.copy(kick.footStart).addScaledVector(forward, -0.10)
        .addScaledVector(right, kick.side === 'left' ? -0.035 : 0.035);
      chamber.y = Math.max(kick.footStart.y + 0.11, kick.targetPoint.y + 0.035);
      const through = kick.targetPoint.clone().addScaledVector(forward, 0.10);
      if (t < 0.38) target.lerpVectors(kick.footStart, chamber, pose.lift);
      else if (t < 0.66) {
        target.lerpVectors(chamber, through, pose.strike);
        target.y += Math.sin(Math.PI * pose.strike) * 0.035;
      } else {
        target.lerpVectors(through, kick.footStart, pose.recover);
        target.y += Math.sin(Math.PI * pose.recover) * 0.10;
      }
    } else if (t < 0.32) {
      target.lerpVectors(kick.footStart, chamber, easeCombat(t / 0.32));
      target.y += Math.sin(Math.PI * t / 0.32) * 0.09;
    } else if (t < 0.53) target.lerpVectors(chamber, kick.targetPoint, easeCombat((t - 0.32) / 0.21));
    else if (t < 0.60) target.copy(kick.targetPoint);
    else {
      const retract = easeCombat((t - 0.60) / 0.40);
      target.lerpVectors(kick.targetPoint, kick.footStart, retract);
      target.y += Math.sin(Math.PI * retract) * 0.13;
    }
    if (kick.contactFoot) {
      // Resistance begins only after the visible boot actually touches. Keep
      // the world running while the attacking leg absorbs the collision.
      target.lerp(kick.contactFoot, 1 - easeCombat(kick.contactAge / 0.11));
    }
    const weight = entryWeight * (1 - easeCombat((t - 0.85) / 0.15));
    // Preserve the support knee's authored bend plane rather than turning both
    // thighs toward the kick. Only the lifted leg follows the forward pole.
    solveCombatTwoBone(supportUpper, supportLower, supportFoot, kick.supportStart,
      weight, undefined, 0.997, THREE.MathUtils.degToRad(12));
    const maxReach = kick.kind === 'get-up-kick' ? 0.975 : 0.997;
    const kneePole = limitKneeLateralBend(upper, lower, foot, target, forward, maxReach);
    solveCombatTwoBone(upper, lower, foot, target, weight, kneePole, maxReach, THREE.MathUtils.degToRad(18));
    // Sole orientation is derived from the starting foot frame, never an Euler
    // accumulation. It stays level for a stomp and tilts at most 12 degrees.
    const worldFoot = kick.footRotation.clone().premultiply(new THREE.Quaternion().setFromAxisAngle(right,
      THREE.MathUtils.degToRad(downward ? 2 : kick.kind === 'soccer-kick' ? 6 : -10) * pose.drive));
    const parent = foot.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
    foot.quaternion.slerp(parent.multiply(worldFoot), weight).normalize();
    const supportParent = supportFoot.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
    supportFoot.quaternion.slerp(supportParent.multiply(kick.supportRotation), weight).normalize();
    const lean = kick.kind === 'get-up-kick' ? -5 * pose.supportLoad
      : (kick.kind === 'soccer-kick' ? 8 : 5) * pose.supportLoad + 8 * pose.drive;
    this.applyWorldAxisOffset(this.combatSpine1Bone, right, THREE.MathUtils.degToRad(lean));
    this.applyWorldAxisOffset(this.combatSpine2Bone, forward, THREE.MathUtils.degToRad(kick.side === 'left' ? -3 : 3) * pose.supportLoad);
    const side = kick.side === 'left' ? -1 : 1;
    const shoulderYaw = side * THREE.MathUtils.degToRad(9) * pose.chamber
      - side * THREE.MathUtils.degToRad(14) * pose.drive;
    this.applyWorldYawOffset(this.combatSpine2Bone, shoulderYaw);
    this.applyWorldYawOffset(this.headBone, -shoulderYaw * 0.85);
    this.applyWorldAxisOffset(this.leftUpperArmBone, forward, -0.08 * pose.supportLoad);
    this.applyWorldAxisOffset(this.rightUpperArmBone, forward, 0.08 * pose.supportLoad);
    this.avatarAnchor.updateMatrixWorld(true);
  }

  private resolveGroundKickImpact(delta: number): void {
    const kick = this.groundKick;
    if (!kick) return;
    const foot = kick.side === 'left' ? this.leftFootBone : this.rightFootBone;
    if (!foot) return;
    foot.getWorldPosition(this.groundKickFootCurrent);
    if (kick.kind === 'soccer-kick') {
      // Sweep the instep, not the ankle: the front half of the visible boot
      // reaches a low body before the ankle does, especially at full extension.
      const toe = foot.children.find(child => child.name.toLowerCase().includes('toe'));
      if (toe) this.groundKickFootCurrent.lerp(toe.getWorldPosition(new THREE.Vector3()), 0.55);
    }
    const targetKind = this.resolveGroundKickTarget(this.groundKickTargetPoint);
    if (this.groundKickFootReady && !kick.impactApplied && targetKind) {
      const profile = GROUND_KICK_PROFILES[kick.kind];
      const contact = sweepCombatContact(this.groundKickFootPrevious, this.groundKickFootCurrent,
        kick.previousTarget, this.groundKickTargetPoint, profile.contactRadius, delta,
        kick.sampledElapsed / kick.duration, kick.elapsed / kick.duration, profile.contactStartFraction, profile.contactEndFraction);
      if (contact && this.groundKickHasLineOfSight(this.groundKickTargetPoint)
        && this.combatSweepLineOfSight(this.groundKickFootPrevious, new THREE.Vector3(contact.point.x, contact.point.y, contact.point.z))) {
        kick.impactApplied = true;
        if (kick.kind !== 'get-up-kick') {
          kick.contactFoot = foot.getWorldPosition(new THREE.Vector3());
          kick.contactAge = 0;
          kick.compressionSeconds = kick.kind === 'stomp' ? 0.055 : 0.045;
        }
        this.combatImpactAudio.contact(true, true);
        this.applyGroundKickDamage(kick.kind, new THREE.Vector3(contact.point.x, contact.point.y, contact.point.z));
      }
    }
    this.groundKickFootReady = true;
    this.groundKickFootPrevious.copy(this.groundKickFootCurrent);
    kick.previousTarget.copy(this.groundKickTargetPoint);
    kick.sampledElapsed = kick.elapsed;
  }

  private applyGroundKickDamage(kind: GroundKickKind, point?: Readonly<THREE.Vector3>): void {
    const profile = GROUND_KICK_PROFILES[kind];
    this.tempDirection.set(
      this.groundKickTargetPoint.x - this.avatarAnchor.position.x,
      0,
      this.groundKickTargetPoint.z - this.avatarAnchor.position.z,
    );
    if (this.tempDirection.lengthSq() < 1e-8) this.tempDirection.set(0, 0, 1);
    else this.tempDirection.normalize();
    this.npcHealth = Math.max(0, this.npcHealth - profile.damage);
    const recovering = this.npcRecovery !== null;
    if (recovering) {
      this.interruptNpcRecoveryWithGroundKick(this.tempDirection, 1.16, point);
    } else if (this.npcRagdoll) {
      this.npcRagdoll.applyGroundKickImpact(this.tempDirection, profile.impulseStrength, false, point,
        kind === 'soccer-kick' ? 'soccer-kick' : 'stomp');
      this.npcDownElapsed = 0;
      this.npcGroundKickRecoveryDelay = 1.35;
      if (this.npcHealth <= 0) this.npcResumeCombatAfterRecovery = false;
    }
    this.updateNpcUi();
    this.setStatus(`${kind === 'get-up-kick' ? 'KICK DE RELEVÉ' : kind === 'soccer-kick' ? 'FRAPPE AU SOL' : 'ÉCRASEMENT'} · -${profile.damage} HP`);
  }

  private requestNormalCombatPunch(): void {
    this.combatBufferedFromHold = false;
    if (!this.combatIsEligible() || this.combatHitReaction) return;
    if (!combatNormalAttackAllowed(this.combatAttackGuardActive(), false)) return;
    if (this.combatDodge) return;

    const target = this.combatTargetDirection(this.tempDirection, false, true);
    const distance = target?.distance ?? Number.POSITIVE_INFINITY;
    const spacing = combatMeleeSpacingForDistance(distance);

    if (this.combatAttack) {
      // Rapid clicks are allowed to queue ONE next strike instead of being thrown
      // away. If recoil is already visible, chain immediately; otherwise hold a
      // short-lived buffer until the current fist has actually finished contact.
      const active = this.combatAttack;
      const normalized = active.duration > 1e-5 ? active.elapsed / active.duration : 1;
      const chainOpen = combatChainReady(active.elapsed, active.duration, active.contactEndFraction, active.impactFraction);
      if (active.kind === 'hook-counter') return;
      if (!chainOpen) {
        this.combatBufferedPunchSeconds = COMBAT_PUNCH_INPUT_BUFFER_SECONDS;
        return;
      }
      this.combatBufferedPunchSeconds = 0;
      const animation = this.chooseCombatAttackVariant('punch', spacing, distance);
      this.startCombatAttackLayer('punch', animation, true, spacing, distance);
      return;
    }
    if (this.combatAttackRecoverySeconds > 0) {
      this.combatBufferedPunchSeconds = COMBAT_PUNCH_INPUT_BUFFER_SECONDS;
      return;
    }
    this.combatBufferedPunchSeconds = 0;
    const animation = this.chooseCombatAttackVariant('punch', spacing, distance);
    this.startCombatAttackLayer('punch', animation, false, spacing, distance);
  }

  private confirmHeavyDoubleClick(): void {
    if (!this.combatIsEligible() || this.combatHitReaction) return;
    if (!combatNormalAttackAllowed(this.combatAttackGuardActive(), false)) {
      this.combatHeavyUpgradePending = false;
      return;
    }
    this.combatHeavyUpgradePending = false;
    const attack = this.combatAttack;
    if (!attack || attack.kind !== 'punch') return;
    const normalized = attack.duration > 1e-5 ? attack.elapsed / attack.duration : 1;
    if (attack.impactApplied || normalized >= attack.contactStartFraction) return;

    // Power is now an in-place upgrade of the SAME authored strike. Restarting
    // a separate power clip on the second click used to rewind the arm and move
    // the hit several frames away from the animation. Keeping the current clip
    // preserves hand trajectory/striking side; only commitment, damage and body
    // drive become heavier before the fist reaches contact.
    attack.kind = 'big-punch';
    // The second tap has been consumed as the heavy upgrade; it must not also
    // survive as a buffered normal punch behind the power strike.
    this.combatBufferedPunchSeconds = 0;
    this.applyCombatAttackLunge(attack.animation, attack.spacing, 1.12, attack.duration);
    this.setStatus('COMBAT · POWER STRIKE');
  }

  private updateCombatMelee(delta: number): boolean {
    this.combatHeldRestSeconds = Math.max(0, this.combatHeldRestSeconds - delta);
    // Holding LMB requests short contextual combinations. Release, being hit or
    // losing the opponent ends intent immediately; there is no queued auto-kick.
    const heldIntent = this.combatLeftPointerHeld && !this.combatLeftPressConsumed
      && !this.combatCounterModifierHeld && !this.combatHitReaction && !this.groundKick;
    if (heldIntent) {
      this.combatLatchSeconds = MANUAL_GUARD_RELEASE_SECONDS;
      const target = this.combatTargetDirection(this.tempDirection, false, true);
      if ((!target || target.distance > MELEE_ATTACKS.punch.reach) && this.combatBufferedFromHold) this.combatBufferedPunchSeconds = 0;
      if (target && target.distance <= MELEE_ATTACKS.punch.reach && this.combatHeldRestSeconds <= 0
        && this.combatClock - this.combatLeftPressStart > 0.16) {
        if (this.combatHeldChainCount < 3 && this.combatBufferedPunchSeconds <= 0) {
          this.combatBufferedPunchSeconds = COMBAT_PUNCH_INPUT_BUFFER_SECONDS;
          this.combatBufferedFromHold = true;
        }
        else if (this.combatHeldChainCount >= 3 && !this.combatAttack) { this.combatHeldChainCount = 0; this.combatHeldRestSeconds = 0.26; }
      }
    }
    this.combatAttackRecoverySeconds = Math.max(
      0,
      this.combatAttackRecoverySeconds - Math.max(0, delta),
    );
    this.combatBufferedPunchSeconds = Math.max(
      0,
      this.combatBufferedPunchSeconds - Math.max(0, delta),
    );
    if (this.combatHitReaction) {
      this.combatHitReactionElapsed += Math.max(0, delta);
      if (this.combatHitReactionElapsed < this.combatHitReactionDuration) return true;
      this.combatHitReaction = null;
      this.combatHitReactionElapsed = 0;
      this.combatHitReactionDuration = 0;
      if (this.player) this.player.setInputEnabled(this.player.isLocked);
      if (this.viewMode === 'third-person' && this.health > 0) this.notifyCombatHit();
      return this.updateCombatGuard(0);
    }

    const dodgeActive = this.updateCombatDodgeCounter(delta);

    // Incoming attacks do not steal ordinary LMB anymore. Only the explicit
    // F+LMB branch consumes/cancels punch input, so without F the player can
    // still throw a normal or double-click Big Punch while under pressure.
    if (this.combatHeavyTapDetector.update(this.combatClock)) {
      this.confirmHeavyDoubleClick();
    }

    if (!this.combatAttack) {
      if (
        this.combatBufferedPunchSeconds > 0
        && this.combatAttackRecoverySeconds <= 0
        && !dodgeActive
        && combatNormalAttackAllowed(this.combatAttackGuardActive(), false)
      ) {
        const target = this.combatTargetDirection(this.tempDirection, false, true);
        const distance = target?.distance ?? Number.POSITIVE_INFINITY;
        const spacing = combatMeleeSpacingForDistance(distance);
        const animation = this.chooseCombatAttackVariant('punch', spacing, distance);
        this.combatBufferedPunchSeconds = 0;
        this.startCombatAttackLayer('punch', animation, false, spacing, distance);
        if (this.combatAttack) return true;
      }
      return dodgeActive;
    }
    const activeStrike = this.combatAttack;
    const normalizedStrike = activeStrike.duration > 1e-5
      ? activeStrike.elapsed / activeStrike.duration
      : 1;
    if (
      this.combatBufferedPunchSeconds > 0
      && activeStrike.kind !== 'hook-counter'
      && this.combatAttackGuardActive()
      && combatChainReady(activeStrike.elapsed, activeStrike.duration, activeStrike.contactEndFraction, activeStrike.impactFraction)
    ) {
      const target = this.combatTargetDirection(this.tempDirection, false, true);
      const distance = target?.distance ?? Number.POSITIVE_INFINITY;
      const spacing = combatMeleeSpacingForDistance(distance);
      const animation = this.chooseCombatAttackVariant('punch', spacing, distance);
      this.combatBufferedPunchSeconds = 0;
      this.startCombatAttackLayer('punch', animation, true, spacing, distance);
      return true;
    }
    if (this.player) {
      // Lock-on may move the destination, but the hips rotate toward it over the
      // anticipation instead of teleporting to the final yaw. A large turn gets
      // most of its rotation done before contact, while a small correction melts
      // in almost immediately.
      const lockedTarget = this.combatLockOnActive
        ? this.combatTargetDirection(this.tempDirection, true, true)
        : null;
      if (lockedTarget && normalizedStrike < activeStrike.contactStartFraction) {
        this.combatAttackAimYaw = Math.atan2(lockedTarget.direction.x, lockedTarget.direction.z);
      }
      const yawDelta = Math.atan2(
        Math.sin(this.combatAttackAimYaw - this.combatAttackStartBodyYaw),
        Math.cos(this.combatAttackAimYaw - this.combatAttackStartBodyYaw),
      );
      const turnMagnitude = Math.abs(yawDelta) / Math.PI;
      const turnEnd = THREE.MathUtils.clamp(
        activeStrike.impactFraction * THREE.MathUtils.lerp(0.50, 0.82, Math.min(1, turnMagnitude * 2.2)),
        0.16,
        0.46,
      );
      const turnBlend = THREE.MathUtils.smoothstep(normalizedStrike, 0.015, turnEnd);
      this.bodyYaw = this.combatAttackStartBodyYaw + yawDelta * turnBlend;
      this.avatarAnchor.rotation.y = this.bodyYaw;
      this.bodyTurning = false;
      this.lookOffsetDegrees = 0;
      this.headLookYaw = 0;
    }
    const state = this.player?.getDebugState();
    const intent = this.player?.getMovementIntent();
    if (state && intent) {
      const visual = combatAttackVisualProfile(activeStrike.animation);
      const committedForwardStep = activeStrike.spacing !== 'close'
        && visual?.character !== 'compact'
        && normalizedStrike <= activeStrike.contactEndFraction + 0.05;

      // During the commitment, leg choice is driven from ACTUAL world velocity
      // expressed in the progressively turning body frame. That means a punch
      // launched from a strafe visibly goes strafe -> diagonal -> forward; a
      // backpedal can pass through a planted guard beat before stepping in.
      let lowerForward = intent.forward;
      let lowerRight = this.visualMovementRightIntent;
      let lowerMoving = state.horizontalSpeed >= 0.20
        || Math.abs(intent.forward) > 0.05
        || Math.abs(intent.right) > 0.05;
      if (committedForwardStep) {
        this.bodyForward.set(Math.sin(this.bodyYaw), 0, Math.cos(this.bodyYaw)).normalize();
        this.bodyRight.crossVectors(this.bodyForward, UP).normalize();
        this.tempDirection.set(state.velocity.x, 0, state.velocity.z);
        const speed = this.tempDirection.length();
        lowerMoving = speed >= 0.14;
        if (speed > 1e-5) {
          lowerForward = this.tempDirection.dot(this.bodyForward) / speed;
          lowerRight = this.tempDirection.dot(this.bodyRight) / speed;
        } else {
          lowerForward = 0;
          lowerRight = 0;
        }
      }
      const selection = combatStrikeLowerSelection(
        lowerForward,
        lowerRight,
        lowerMoving,
        committedForwardStep,
      );
      const rate = selection.id === 'fight-idle' ? 1
        : committedForwardStep
          ? THREE.MathUtils.clamp(
            0.72 + state.horizontalSpeed / Math.max(0.1, MOVEMENT_TUNING.locomotion.walkSpeed) * 0.42,
            0.72,
            1.24,
          )
          : THREE.MathUtils.clamp(Math.max(state.horizontalSpeed, 0.46) / MOVEMENT_TUNING.locomotion.walkSpeed, 0.62, 1.55);
      this.setCombatLowerLayer(selection.id, selection.reverse, rate, committedForwardStep);
    }
    const strikeClock = advanceStrikeClock(delta, this.combatAttack.compressionSeconds ?? 0);
    this.combatAttack.compressionSeconds = strikeClock.remaining;
    this.combatAttack.elapsed += strikeClock.step;
    this.updateCombatAttackEngagement();
    // Player damage is resolved after mixer evaluation from the real hand sweep.
    // impactTime remains only as authored timing metadata/NPC counter telegraph.
    if (this.combatAttack.elapsed < this.combatAttack.endTime) return true;
    this.finishCombatAttackLayer();
    return this.updateCombatGuard(0);
  }

  private receivePlayerMeleeHit(
    kind: MeleeAttackKind,
    direction: Readonly<THREE.Vector3>,
    overrideDamage?: number,
    hitZone: CombatHitZone = 'upper-body',
    contactPoint?: Readonly<THREE.Vector3>,
  ): void {
    if (!this.player || this.ragdoll || this.recovery || this.health <= 0) return;

    const incomingDamage = overrideDamage ?? MELEE_ATTACKS[kind].damage;
    if (!Number.isFinite(incomingDamage) || incomingDamage <= 0) return;
    if (this.character) this.playerHitHandoff.capture(this.character);
    if (this.firstPersonCharacter) this.firstPersonHitHandoff.capture(this.firstPersonCharacter);
    this.combatBufferedPunchSeconds = 0;
    this.combatHeavyTapDetector.cancel();
    this.combatHeavyUpgradePending = false;
    this.combatDodge = null;
    this.combatDodgeLayer?.thirdPerson.fadeOut(0.06);
    this.combatDodgeLayer?.firstPerson.fadeOut(0.06);
    this.player.cancelCombatLunge();
    this.combatLeftPressConsumed = true;
    this.combatHeldChainCount = 0;
    this.seedCombatImpact(false, direction, incomingDamage, hitZone);
    // First confirmed contact wins the exchange. Taking a hit immediately kills
    // any outgoing strike that has not already committed damage, including its
    // remembered contact and lunge. The victim still receives this incoming hit.
    if (this.combatAttack) {
      this.combatAttackAction?.thirdPerson.fadeOut(0.035);
      this.combatAttackAction?.firstPerson.fadeOut(0.035);
      this.combatAttack = null;
      this.combatAttackAction = undefined;
      this.combatHandSweepReady = false;
      this.combatBufferedPunchSeconds = 0;
      this.combatHeavyUpgradePending = false;
      this.player.cancelCombatLunge();
    }
    if (this.groundKick) {
      // Ground attacks obey the same no-trade rule as punches. If the attacker
      // is hit before the foot's impact, the kick is over immediately and its
      // lunge/foot sweep cannot keep dealing damage from a cancelled animation.
      this.groundKick = null;
      this.groundKickFootReady = false;
      this.player.cancelCombatLunge();
    }

    const profile = MELEE_ATTACKS[kind];
    const damage = Math.max(0, overrideDamage ?? profile.damage);
    this.health = THREE.MathUtils.clamp(this.health - damage, 0, MAX_HEALTH);
    this.secondsSinceDamage = 0;
    this.damageFlash = Math.max(this.damageFlash, THREE.MathUtils.clamp(0.38 + damage / 62, 0.4, 1));
    this.triggerFirstPersonMeleeHitFeedback(direction, damage, hitZone);
    this.updateHealthUi();

    const hitDuringReaction = this.combatHitReaction !== null;
    const sincePreviousHit = this.combatClock - this.playerLastNpcHitAt;
    if (!Number.isFinite(sincePreviousHit) || sincePreviousHit > PLAYER_REHIT_COMBO_RESET_SECONDS) {
      this.playerConsecutiveNpcHits = 0;
    }
    this.playerConsecutiveNpcHits += 1;
    this.playerLastNpcHitAt = this.combatClock;

    // Repeated force accumulates balance loss, with recovery between impacts.
    // Recent re-hits only scale the impulse after balance has actually failed.
    const rapidRehit = hitDuringReaction && sincePreviousHit <= PLAYER_REHIT_COMBO_RESET_SECONDS;
    const comboKnockdown = rapidRehit && (
      this.playerConsecutiveNpcHits >= PLAYER_REHIT_RAGDOLL_HIT_COUNT
      || kind === 'big-punch'
    );
    const balanceLoss = this.playerBalance.hit(this.combatClock, damage, hitZone, kind === 'big-punch');
    const ordinaryKnockdown = balanceLoss >= 37;
    if (this.health <= 0 || ordinaryKnockdown) {
      this.playerBalance.reset();
      this.combatHitReaction = null;
      this.resetCombatState(true);
      const knockbackDirection = new THREE.Vector3(direction.x, 0, direction.z);
      if (knockbackDirection.lengthSq() < 1e-6) knockbackDirection.set(0, 0, 1);
      knockbackDirection.normalize();
      const comboImpactScale = comboKnockdown
        ? THREE.MathUtils.clamp(1.08 + (this.playerConsecutiveNpcHits - 2) * 0.10, 1.08, 1.28)
        : 1;
      this.startRagdoll({
        fatal: this.health <= 0,
        addedVelocity: new THREE.Vector3(),
        addedYawRate: 0,
        status: 'COMBAT · KNOCKDOWN',
        meleeImpact: {
          direction: knockbackDirection,
          strength: comboImpactScale * (kind === 'big-punch' ? 1.12 : kind === 'hook-counter' ? 1.06 : 1),
          zone: hitZone,
          point: contactPoint,
        },
      });
      return;
    }

    const reaction = this.chooseCombatHitAnimation(
      hitZone === 'body' ? 'punch' : kind,
      this.lastPlayerHitReaction,
      hitZone === 'body' ? 'body' : hitZone,
    );
    this.lastPlayerHitReaction = reaction;
    const loaded = this.animations.get(reaction);
    if (!loaded) return;
    // Re-hits are allowed to replace the currently playing reaction. Reset only
    // the attack/guard state; the new animation immediately crossfades from the
    // evaluated pose so the bot can genuinely combo the player just like the
    // player can combo the bot.
    this.resetCombatState(true);
    const reactionRate = hitReactionPlaybackRate(kind, loaded.clip.duration);
    this.combatHitReaction = reaction;
    this.combatHitReactionElapsed = 0;
    this.combatHitReactionDuration = Math.max(0.18, loaded.clip.duration / reactionRate);
    this.player.setInputEnabled(false);
    this.player.setSprintSuppressed(true);
    this.playAutoImmediate(reaction, false, reactionRate);
    this.setStatus(`COMBAT · TOUCHÉ · -${damage} HP`);
  }

  private triggerFirstPersonMeleeHitFeedback(
    direction: Readonly<THREE.Vector3>,
    damage: number,
    hitZone: CombatHitZone,
  ): void {
    if (this.viewMode !== 'first-person' || !this.player) return;
    this.firstPersonRight.set(
      Math.cos(this.continuousViewYaw),
      0,
      -Math.sin(this.continuousViewYaw),
    );
    this.tempDirection.set(direction.x, 0, direction.z);
    if (this.tempDirection.lengthSq() < 1e-8) this.tempDirection.set(0, 0, 1);
    else this.tempDirection.normalize();
    const side = THREE.MathUtils.clamp(this.tempDirection.dot(this.firstPersonRight), -1, 1);
    const strength = THREE.MathUtils.clamp(0.54 + damage / 34, 0.58, 1.18);
    const headScale = hitZone === 'head' ? 1.18 : hitZone === 'body' ? 0.84 : 1;
    this.firstPersonMeleeHitKickYaw = side * FIRST_PERSON_MELEE_HIT_MAX_YAW * strength;
    this.firstPersonMeleeHitKickPitch = -FIRST_PERSON_MELEE_HIT_MAX_PITCH * strength * headScale;
    this.firstPersonMeleeHitKickRoll = -side * FIRST_PERSON_MELEE_HIT_MAX_ROLL * strength;
    this.firstPersonMeleeHitKickElapsed = 0;
    this.firstPersonMeleeHitBloodFlash = Math.max(
      this.firstPersonMeleeHitBloodFlash,
      THREE.MathUtils.clamp(0.58 + damage / 48 + (hitZone === 'head' ? 0.12 : 0), 0.62, 1),
    );
    this.firstPersonMeleeHitBloodSide = side;
  }

  private applyFirstPersonMeleeHitCameraFeedback(delta: number): void {
    if (this.viewMode !== 'first-person' || this.ragdoll || this.recovery) return;
    if (this.firstPersonMeleeHitKickElapsed >= FIRST_PERSON_MELEE_HIT_KICK_SECONDS) return;
    this.firstPersonMeleeHitKickElapsed = Math.min(
      FIRST_PERSON_MELEE_HIT_KICK_SECONDS,
      this.firstPersonMeleeHitKickElapsed + Math.max(0, delta),
    );
    const t = this.firstPersonMeleeHitKickElapsed / FIRST_PERSON_MELEE_HIT_KICK_SECONDS;
    const envelope = t < 0.16
      ? THREE.MathUtils.smoothstep(t, 0, 0.16)
      : 1 - THREE.MathUtils.smoothstep(t, 0.16, 1);
    if (envelope <= 1e-4) return;
    this.firstPersonMeleeHitKickEuler.set(
      this.firstPersonMeleeHitKickPitch * envelope,
      this.firstPersonMeleeHitKickYaw * envelope,
      this.firstPersonMeleeHitKickRoll * envelope,
      'YXZ',
    );
    this.firstPersonMeleeHitKickQuaternion.setFromEuler(this.firstPersonMeleeHitKickEuler);
    this.firstPersonCamera.quaternion.multiply(this.firstPersonMeleeHitKickQuaternion).normalize();
    this.firstPersonRight.set(
      Math.cos(this.continuousViewYaw),
      0,
      -Math.sin(this.continuousViewYaw),
    );
    this.firstPersonCamera.position.addScaledVector(
      this.firstPersonRight,
      this.firstPersonMeleeHitBloodSide * 0.012 * envelope,
    );
    this.firstPersonCamera.position.y += 0.006 * envelope;
  }

  private prepareNpcCombatLoopAction(
    action: THREE.AnimationAction,
    clip: THREE.AnimationClip,
    rate: number,
    reverse: boolean,
    fadeSeconds: number,
  ): void {
    const signedRate = Math.max(0.05, Math.abs(rate)) * (reverse ? -1 : 1);
    action.reset();
    action.enabled = true;
    action.paused = false;
    action.clampWhenFinished = false;
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(signedRate);
    if (reverse) action.time = Math.max(0, clip.duration - 1e-4);
    action.play();
    if (fadeSeconds > 0) action.fadeIn(fadeSeconds);
  }

  private setNpcCombatLowerLayer(
    id: CombatLowerAnimation,
    reverse: boolean,
    rate: number,
    committedStrikeStep = false,
    entryFadeSeconds?: number,
  ): void {
    const next = this.idleNpcCombatLowerActions.get(id);
    const pair = this.combatLowerLayers.get(id);
    if (!next || !pair) return;
    if (this.npcCombatLowerActive === id && this.npcCombatLowerReverse === reverse) {
      next.setEffectiveTimeScale(Math.max(0.05, Math.abs(rate)) * (reverse ? -1 : 1));
      return;
    }
    const previousId = this.npcCombatLowerActive;
    const previous = previousId ? this.idleNpcCombatLowerActions.get(previousId) : undefined;
    const previousPair = previousId ? this.combatLowerLayers.get(previousId) : undefined;
    const preserveStepPhase = !!previous && !!previousPair
      && previousId !== 'fight-idle' && id !== 'fight-idle';
    const phase = preserveStepPhase
      ? ((previous!.time % Math.max(1e-5, previousPair!.clip.duration)) + previousPair!.clip.duration)
        % previousPair!.clip.duration / Math.max(1e-5, previousPair!.clip.duration)
      : 0;
    const touchesIdle = previousId === 'fight-idle' || id === 'fight-idle';
    const fadeSeconds = entryFadeSeconds ?? (committedStrikeStep
      ? COMBAT_LOWER_STRIKE_CROSSFADE_SECONDS
      : touchesIdle ? COMBAT_LOWER_IDLE_CROSSFADE_SECONDS : COMBAT_LOWER_DIRECTION_CROSSFADE_SECONDS);
    previous?.fadeOut(fadeSeconds);
    this.prepareNpcCombatLoopAction(next, pair.clip, rate, reverse, fadeSeconds);
    if (preserveStepPhase) next.time = phase * Math.max(1e-5, pair.clip.duration);
    if (id === 'fight-idle' && this.idleNpcCombatUpperAction && this.combatUpperLayer) {
      next.time = this.idleNpcCombatUpperAction.time % Math.max(1e-5, pair.clip.duration);
    }
    this.npcCombatLowerActive = id;
    this.npcCombatLowerReverse = reverse;
  }

  private startNpcCombatGuardLayers(
    lower: CombatLowerAnimation = 'fight-idle',
    rate = 1,
    committedStrikeStep = false,
  ): void {
    const upper = this.idleNpcCombatUpperAction;
    const getUpHandoff = this.npcCurrentAnimation === 'stand-up-back' || this.npcCurrentAnimation === 'stand-up-belly';
    const entryFade = getUpHandoff ? 0.36 : 0.18;
    if (!upper || !this.combatUpperLayer) {
      this.playNpcAnimation(lower === 'fight-idle' ? 'fight-idle' : 'walking', true, rate);
      return;
    }
    if (this.npcCombatLowerActive === null) {
      this.npcCurrentAction?.fadeOut(entryFade);
      this.npcCurrentAction = undefined;
      upper.reset();
      upper.enabled = true;
      upper.paused = false;
      upper.clampWhenFinished = false;
      upper.setLoop(THREE.LoopRepeat, Infinity);
      upper.setEffectiveWeight(1);
      upper.setEffectiveTimeScale(1);
      upper.play();
      upper.fadeIn(entryFade);
    }
    this.setNpcCombatLowerLayer(lower, false, rate, committedStrikeStep, getUpHandoff ? entryFade : undefined);
    this.npcCurrentAnimation = 'fight-idle';
    if (this.npcCombatPhase !== 'attack') this.npcCombatPhase = 'guard';
  }

  private stopNpcCombatGuardLayers(fadeSeconds = 0.10): void {
    if (this.npcCombatLowerActive === null) return;
    this.idleNpcCombatUpperAction?.fadeOut(fadeSeconds);
    this.idleNpcCombatLowerActions.get(this.npcCombatLowerActive)?.fadeOut(fadeSeconds);
    this.npcCombatLowerActive = null;
    this.npcCombatLowerReverse = false;
  }

  private playNpcAnimation(id: AnimationId, loop: boolean, rate = 1, restart = false): void {
    const hadLayeredGuard = this.npcCombatLowerActive !== null;
    if (hadLayeredGuard) this.stopNpcCombatGuardLayers(id.startsWith('hit-') ? 0.035 : 0.10);
    const action = this.idleNpcActions.get(id);
    if (!action || !this.idleNpcMixer) return;
    if (!restart && this.npcCurrentAnimation === id && this.npcCurrentAction === action) {
      action.setEffectiveTimeScale(rate);
      return;
    }
    const previousAction = this.npcCurrentAction;
    const fadeSeconds = this.npcCurrentAnimation === 'stand-up-back' || this.npcCurrentAnimation === 'stand-up-belly'
      ? 0.36 : id.startsWith('hit-') ? 0.035 : 0.10;
    action.reset();
    action.enabled = true;
    action.paused = false;
    action.clampWhenFinished = !loop;
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(rate);
    action.play();
    if (hadLayeredGuard && !previousAction) action.fadeIn(id.startsWith('hit-') ? 0.035 : 0.10);
    if (previousAction && previousAction !== action) {
      action.crossFadeFrom(previousAction, fadeSeconds, false);
    }
    this.npcCurrentAction = action;
    this.npcCurrentAnimation = id;
  }

  /** Keep the live standing NPC solid to the player capsule. The blocker is
   * deliberately owned by PhysicsWorld and collides only with the player, so
   * it cannot fight the NPC's own ragdoll when the opponent goes down. */
  private syncNpcPlayerBlocker(enabled = true): void {
    if (!this.physics || !this.idleNpcAnchor) return;
    this.npcBlockerCenter.set(
      this.idleNpcAnchor.position.x,
      this.idleNpcAnchor.position.y + 0.84,
      this.idleNpcAnchor.position.z,
    );
    this.physics.setMeleeOpponentBlocker(
      this.npcBlockerCenter,
      enabled && !this.npcRagdoll && !this.npcRecovery && this.npcHealth > 0,
    );
  }

  private updateNpcUi(): void {
    const stat = this.stats.get('npc');
    const phase = this.npcRecovery ? 'SE RELÈVE' : this.npcRagdoll ? 'AU SOL' : this.npcCombatEnabled ? 'COMBAT' : 'PASSIF';
    if (stat) stat.textContent = `${Math.max(0, Math.round(this.npcHealth))} / ${MAX_HEALTH} · ${phase}`;
    if (this.npcCombatButton) {
      this.npcCombatButton.textContent = (this.npcRagdoll || this.npcRecovery)
        ? 'NPC RESET / COMBAT'
        : `NPC COMBAT: ${this.npcCombatEnabled ? 'ON' : 'OFF'}`;
      this.npcCombatButton.classList.toggle('is-active', this.npcCombatEnabled && !this.npcRagdoll && !this.npcRecovery);
    }
  }

  private resetNpcOpponent(enableCombat: boolean): void {
    this.npcBalance.reset(); this.playerBalance.reset();
    this.npcMotionHistory.reset(); this.npcHitHandoff.reset();
    this.combatPreviousTargets = { player: null, npc: null };
    this.npcImpactPitch = [0, 0]; this.npcImpactRoll = [0, 0];
    this.npcRecovery?.dispose();
    this.npcRecovery = null;
    this.npcRagdoll?.dispose();
    this.npcRagdoll = undefined;
    if (!this.idleNpcAnchor || !this.idleNpcCharacter || !this.idleNpcMixer) return;
    this.idleNpcMixer.stopAllAction();
    this.idleNpcMixer.timeScale = 1;
    this.idleNpcAnchor.position.set(MOVEMENT_LAB_IDLE_NPC.x, MOVEMENT_LAB_IDLE_NPC.y, MOVEMENT_LAB_IDLE_NPC.z);
    this.idleNpcAnchor.rotation.y = THREE.MathUtils.degToRad(-125);
    this.idleNpcCharacter.traverse((object) => {
      const bone = object as THREE.Bone;
      if (!bone.isBone) return;
      const pose = this.idleNpcBasePose.get(bone.name);
      if (!pose) return;
      bone.position.copy(pose.position);
      bone.quaternion.copy(pose.rotation);
    });
    this.idleNpcCharacter.updateMatrixWorld(true);
    this.npcHealth = MAX_HEALTH;
    this.npcAttack = null;
    this.npcHandSweepReady = false;
    this.npcHitReaction = null;
    this.npcHitReactionElapsed = 0;
    this.npcHitReactionDuration = 0;
    this.npcConsecutivePlayerHits = 0;
    this.npcLastPlayerHitAt = Number.NEGATIVE_INFINITY;
    this.npcAttackCooldown = 0.55;
    this.npcAttackRecoverySeconds = 0;
    this.npcBufferedPunchSeconds = 0;
    this.npcComboChainCount = 0;
    this.npcComboTargetLength = 1;
    this.npcComboIndex = 0;
    this.npcRecentPunchVariants.length = 0;
    this.npcChainQueuedForCurrentAttack = false;
    this.playerConsecutiveNpcHits = 0;
    this.playerLastNpcHitAt = Number.NEGATIVE_INFINITY;
    this.npcCombatLowerActive = null;
    this.npcCombatLowerReverse = false;
    this.npcSpacingPushSeconds = 0;
    this.npcSpacingPushSpeed = 0;
    this.npcDownElapsed = 0;
    this.npcGroundKickRecoveryDelay = 0;
    this.npcResumeCombatAfterRecovery = enableCombat;
    this.npcCombatEnabled = enableCombat;
    this.npcCombatPhase = enableCombat ? 'guard' : 'idle';
    if (enableCombat) this.startNpcCombatGuardLayers('fight-idle', 1);
    else this.playNpcAnimation('idle', true, 1, true);
    this.syncNpcPlayerBlocker(true);
    this.updateNpcUi();
  }

  private toggleNpcCombat(): void {
    if (!this.ready || !this.idleNpcCharacter) return;
    if (this.npcRagdoll || this.npcRecovery || this.npcHealth <= 0) {
      this.resetNpcOpponent(true);
      return;
    }
    this.npcCombatEnabled = !this.npcCombatEnabled;
    this.npcAttack = null;
    this.npcHandSweepReady = false;
    this.npcHitReaction = null;
    this.npcHitReactionElapsed = 0;
    this.npcHitReactionDuration = 0;
    this.npcConsecutivePlayerHits = 0;
    this.npcLastPlayerHitAt = Number.NEGATIVE_INFINITY;
    this.npcAttackCooldown = 0.45;
    this.npcAttackRecoverySeconds = 0;
    this.npcBufferedPunchSeconds = 0;
    this.npcComboChainCount = 0;
    this.npcComboTargetLength = 1;
    this.npcChainQueuedForCurrentAttack = false;
    this.playerConsecutiveNpcHits = 0;
    this.playerLastNpcHitAt = Number.NEGATIVE_INFINITY;
    this.npcCombatPhase = this.npcCombatEnabled ? 'guard' : 'idle';
    if (this.npcCombatEnabled) this.startNpcCombatGuardLayers('fight-idle', 1);
    else this.playNpcAnimation('idle', true, 1, true);
    this.updateNpcUi();
  }

  private combatPlayerSweepTargetPoints(): boolean {
    if (!this.player || this.ragdoll || this.recovery || this.health <= 0) return false;
    if (this.headBone) this.headBone.getWorldPosition(this.combatPlayerHeadPoint);
    else this.combatPlayerHeadPoint.copy(this.avatarAnchor.position).add(new THREE.Vector3(0, 1.58, 0));
    if (this.hipsBone) this.hipsBone.getWorldPosition(this.combatPlayerBodyPoint);
    else this.combatPlayerBodyPoint.copy(this.avatarAnchor.position).add(new THREE.Vector3(0, 0.92, 0));
    this.combatPlayerChestPoint.copy(this.combatPlayerBodyPoint).lerp(this.combatPlayerHeadPoint, 0.64);
    this.combatPlayerBodyPoint.lerp(this.combatPlayerHeadPoint, 0.34);
    return true;
  }

  private moveNpcCombatStep(direction: Readonly<THREE.Vector3>, requestedStep: number): number {
    if (!this.idleNpcAnchor || requestedStep <= 1e-5) return 0;
    let step = requestedStep;
    this.meleeOrigin.copy(this.idleNpcAnchor.position).add(new THREE.Vector3(0, 1.02, 0));
    this.tempDirection.set(direction.x, 0, direction.z);
    if (this.tempDirection.lengthSq() < 1e-8) return 0;
    this.tempDirection.normalize();
    this.cameraRaycaster.set(this.meleeOrigin, this.tempDirection);
    this.cameraRaycaster.near = 0.03;
    this.cameraRaycaster.far = step + 0.40;
    const wallHit = this.cameraRaycaster.intersectObjects(this.environmentMeshes, false)[0];
    if (wallHit) step = Math.max(0, Math.min(step, wallHit.distance - 0.34));

    const nextX = this.idleNpcAnchor.position.x + this.tempDirection.x * step;
    const nextZ = this.idleNpcAnchor.position.z + this.tempDirection.z * step;
    const entersPit = MOVEMENT_LAB_PITS.some((pit) =>
      nextX > pit.minX - 0.42 && nextX < pit.maxX + 0.42
      && nextZ > pit.minZ - 0.42 && nextZ < pit.maxZ + 0.42
    );
    if (entersPit || step <= 0) return 0;
    this.idleNpcAnchor.position.x = nextX;
    this.idleNpcAnchor.position.z = nextZ;
    this.syncNpcPlayerBlocker(true);
    return step;
  }

  private updateNpcAttackCommitment(delta: number): void {
    if (!this.npcAttack || !this.idleNpcAnchor || !this.player) return;
    this.npcToPlayer.set(
      this.avatarAnchor.position.x - this.idleNpcAnchor.position.x,
      0,
      this.avatarAnchor.position.z - this.idleNpcAnchor.position.z,
    );
    const distance = this.npcToPlayer.length();
    if (distance < 1e-5) return;
    this.npcToPlayer.multiplyScalar(1 / distance);
    const normalized = this.npcAttack.duration > 1e-5 ? this.npcAttack.elapsed / this.npcAttack.duration : 1;
    if (normalized >= this.npcAttack.contactStartFraction) return;

    // Clinch attacks are pushes: don't slide the NPC through the player.
    if (this.npcAttack.spacing === 'close') return;

    const desiredRange = this.npcAttack.spacing === 'far'
      ? COMBAT_MELEE_IDEAL_STEP_DISTANCE
      : COMBAT_MELEE_IDEAL_PUNCH_DISTANCE;
    const missing = Math.max(0, distance - desiredRange);
    if (missing <= 0.018) return;

    const visual = combatAttackVisualProfile(this.npcAttack.animation);
    const timeToImpact = Math.max(0.055, this.npcAttack.impactTime - this.npcAttack.elapsed);
    const natural = visual?.lungeSpeed ?? 1.5;
    const maxSpeed = this.npcAttack.spacing === 'far'
      ? 1.85
      : 1.65;
    const minSpeed = this.npcAttack.spacing === 'far'
      ? 0.35
      : 0.20;
    const speed = THREE.MathUtils.clamp(missing / timeToImpact, minSpeed, maxSpeed);
    const remainingStep = Math.max(0, (this.npcAttack.spacing === 'far' ? 0.48 : 0.22)
      - Math.max(0, this.npcAttack.targetDistanceAtStart - distance));
    const step = Math.min(missing, remainingStep, speed * Math.max(0, delta));
    const moved = this.moveNpcCombatStep(this.npcToPlayer, step);
    if (moved > 0.0005) {
      const walkRate = THREE.MathUtils.clamp(speed / MOVEMENT_TUNING.locomotion.walkSpeed, 0.76, 1.24);
      this.startNpcCombatGuardLayers('walking', walkRate, true);
    }
  }

  private applyNpcCombatStrikeAimCorrection(): void {
    const attack = this.npcAttack;
    if (!attack || !this.idleNpcAnchor || !this.combatPlayerSweepTargetPoints()) return;
    const normalized = attack.duration > 1e-5 ? attack.elapsed / attack.duration : 1;
    const heavy = attack.kind === 'big-punch';
    const envelope = combatStrikeEnvelope(normalized, heavy, attack.impactFraction);
    const reach = combatStrikeReachEnvelope(normalized, heavy, attack.impactFraction);
    if (envelope <= 1e-4 && reach <= 1e-4) return;
    const visual = combatAttackVisualProfile(attack.animation);

    this.npcToPlayer.set(
      this.avatarAnchor.position.x - this.idleNpcAnchor.position.x,
      0,
      this.avatarAnchor.position.z - this.idleNpcAnchor.position.z,
    );
    const distance = this.npcToPlayer.length();
    if (distance < 1e-5) return;
    this.npcToPlayer.multiplyScalar(1 / distance);
    this.combatStrikeRightAxis.set(this.npcToPlayer.z, 0, -this.npcToPlayer.x).normalize();
    const bodyScale = visual?.bodyMultiplier ?? 1;
    const character = visual?.character ?? 'cross';
    const bodyLean = reach * bodyScale
      * (heavy ? COMBAT_STRIKE_BODY_LEAN_HEAVY : COMBAT_STRIKE_BODY_LEAN_NORMAL)
      * (character === 'jab' ? 0.56 : character === 'overhand' ? 1.02 : 0.82);
    const styleBase = THREE.MathUtils.degToRad(visual?.styleYawDegrees ?? 0);
    const npcLoadStart = Math.max(0.02, attack.impactFraction - 0.34);
    const npcLoadEnd = Math.max(npcLoadStart + 0.04, attack.impactFraction - 0.11);
    const npcLoad = normalized <= npcLoadStart
      ? 0
      : normalized < npcLoadEnd
        ? THREE.MathUtils.smoothstep(normalized, npcLoadStart, npcLoadEnd)
        : normalized < attack.impactFraction
          ? 1 - THREE.MathUtils.smoothstep(normalized, npcLoadEnd, attack.impactFraction)
          : 0;
    const styleYaw = -styleBase * npcLoad * (character === 'jab' ? 0.16 : 0.36)
      + styleBase * reach * (character === 'jab' ? 0.28 : 0.58)
      + THREE.MathUtils.degToRad(attack.strikingSide === 'right' ? 30 : 0) * reach;
    // NPC uses the same restrained body language as the player: shoulders turn
    // into the shot, but the waist never folds toward the floor.
    this.applyWorldAxisOffset(this.idleNpcSpineBone, this.combatStrikeRightAxis, bodyLean * 0.24);
    this.applyWorldAxisOffset(this.idleNpcSpine1Bone, this.combatStrikeRightAxis, bodyLean * 0.30);
    this.applyWorldAxisOffset(this.idleNpcSpine2Bone, this.combatStrikeRightAxis, bodyLean * 0.34);
    this.applyWorldYawOffset(this.idleNpcSpineBone, styleYaw * 0.16);
    this.applyWorldYawOffset(this.idleNpcSpine1Bone, styleYaw * 0.31);
    this.applyWorldYawOffset(this.idleNpcSpine2Bone, styleYaw * 0.53);
    // Keep eyes/head on the opponent. The old per-strike downward head dip made
    // both fighters stare at the floor exactly when the punch should read best.
    if (this.idleNpcHeadBone && visual) {
      const headSlip = THREE.MathUtils.degToRad(visual.headSlipDegrees) * reach * 0.18;
      this.applyWorldYawOffset(this.idleNpcHeadBone, headSlip);
    }

    const leftUpper = this.idleNpcLeftUpperArmBone;
    const rightUpper = this.idleNpcRightUpperArmBone;
    const leftForearm = this.idleNpcLeftForearmBone;
    const rightForearm = this.idleNpcRightForearmBone;
    const leftHand = this.idleNpcLeftHandBone;
    const rightHand = this.idleNpcRightHandBone;
    const upper = attack.strikingSide === 'left' ? leftUpper : rightUpper;
    const forearm = attack.strikingSide === 'left' ? leftForearm : rightForearm;
    const hand = attack.strikingSide === 'left' ? leftHand : rightHand;
    if (!upper || !forearm || !hand) return;
    this.idleNpcAnchor.updateWorldMatrix(true, false);
    upper.updateWorldMatrix(true, false);
    upper.getWorldPosition(this.combatStrikeShoulderPoint);

    const aim = combatCloseRangeAimProfile(
      combatStrikeAimProfile(
        attack.animation, attack.kind, attack.spacing, attack.strikingSide,
      ),
      distance,
    );
    this.combatStrikeDesiredPoint
      .copy(this.combatPlayerChestPoint)
      .lerp(this.combatPlayerHeadPoint, aim.headWeight)
      .addScaledVector(this.combatStrikeRightAxis, aim.lateralMeters);
    this.combatStrikeDesiredPoint.y += aim.verticalMeters;
    if (visual?.character === 'overhand') {
      const beforeImpact = THREE.MathUtils.clamp((attack.impactFraction - normalized) / 0.28, 0, 1);
      this.combatStrikeDesiredPoint.y += 0.16 * beforeImpact * (1 - 0.35 * reach);
    }
    this.combatStrikeDesiredPoint.y = THREE.MathUtils.clamp(
      this.combatStrikeDesiredPoint.y,
      this.combatStrikeShoulderPoint.y - 0.16,
      this.combatStrikeShoulderPoint.y + 0.46,
    );
    this.combatStrikeDesiredDir
      .copy(this.combatStrikeDesiredPoint)
      .sub(this.combatStrikeShoulderPoint);
    if (this.combatStrikeDesiredDir.lengthSq() > 1e-8) {
      this.combatStrikeDesiredDir.normalize();
      this.combatStrikeDesiredPoint.addScaledVector(
        this.combatStrikeDesiredDir,
        aim.penetrationMeters * reach,
      );
    }
    if (attack.contactPoint) this.combatStrikeDesiredPoint.copy(attack.contactPoint);
    else if (attack.aimPoint && normalized >= attack.contactStartFraction) this.combatStrikeDesiredPoint.copy(attack.aimPoint);
    else attack.aimPoint = this.combatStrikeDesiredPoint.clone();
    this.solveCombatArmTowardTarget(
      upper,
      forearm,
      hand,
      this.combatStrikeDesiredPoint,
      reach,
      heavy,
      attack.kind === 'hook-counter',
    );
  }

  private commitNpcSweepImpact(attack: ActiveMeleeAttack, contact: CombatSweepContact): void {
    if (this.npcAttack !== attack || attack.impactApplied || this.npcHitReaction
      || this.npcRagdoll || this.npcRecovery || this.ragdoll || this.recovery || this.health <= 0) return;
    const damage = combatPhysicalContactDamage(attack.kind, attack.spacing, contact.distance, contact.fistSpeed, contact.zone);
    if (damage <= 0) return;
    attack.impactApplied = true;
    attack.compressionSeconds = attack.kind === 'big-punch' ? 0.065 : 0.048;
    const hand = attack.strikingSide === 'left' ? this.idleNpcLeftHandBone : this.idleNpcRightHandBone;
    attack.contactPoint = hand?.getWorldPosition(new THREE.Vector3());
    this.combatImpactAudio.contact(attack.kind === 'big-punch', contact.zone === 'body');
    this.receivePlayerMeleeHit(attack.kind, contact.direction, damage, contact.zone, contact.point);
  }

  private chooseNpcCombatAttackVariant(
    kind: MeleeAttackKind,
    spacing: CombatMeleeSpacing,
    targetDistance: number,
  ): CombatAttackAnimation {
    if (kind === 'hook-counter') {
      const next = this.drawCombatAttackVariant(HOOK_ATTACK_VARIANTS, this.npcPunchVariantBag, this.lastNpcPunchVariant);
      this.lastNpcPunchVariant = next;
      return next;
    }
    if (kind === 'big-punch') {
      const next = this.drawCombatAttackVariant(BIG_PUNCH_ATTACK_VARIANTS, this.npcBigPunchVariantBag, this.lastNpcBigPunchVariant);
      this.lastNpcBigPunchVariant = next;
      return next;
    }
    const previous = this.lastNpcPunchVariant;
    const previousSide = previous ? COMBAT_ATTACK_DESIRED_SIDE[previous] : null;
    let pool: readonly CombatAttackAnimation[];
    let bag: CombatAttackAnimation[];
    if (spacing === 'close') {
      const clinched = Number.isFinite(targetDistance) && targetDistance <= 0.56;
      pool = clinched ? CLINCH_SHOVE_ATTACK_VARIANTS : CLOSE_RANGE_ATTACK_VARIANTS;
      bag = clinched ? this.npcClosePunchVariantBag : this.npcPunchVariantBag;
    } else if (spacing === 'far' || spacing === 'out') {
      pool = FAR_STEP_ATTACK_VARIANTS;
      bag = this.npcFarPunchVariantBag;
    } else {
      const sequences = Number.isFinite(targetDistance) && targetDistance > 1.24
        ? SCRIPTED_OUTER_SEQUENCES
        : SCRIPTED_MEDIUM_SEQUENCES;
      const longest = Math.max(...sequences.map((sequence) => sequence.length));
      for (let offset = 0; offset < sequences.length * longest; offset += 1) {
        const absolute = this.npcComboIndex + offset;
        const sequence = sequences[Math.floor(absolute / longest) % sequences.length]!;
        const candidate = sequence[(absolute % longest) % sequence.length]!;
        if (candidate === previous || this.npcRecentPunchVariants.includes(candidate)) continue;
        if (previousSide && COMBAT_ATTACK_DESIRED_SIDE[candidate] === previousSide && offset < 2) continue;
        this.npcComboIndex += offset + 1;
        this.npcRecentPunchVariants.push(candidate);
        while (this.npcRecentPunchVariants.length > 3) this.npcRecentPunchVariants.shift();
        this.lastNpcPunchVariant = candidate;
        return candidate;
      }
      pool = MEDIUM_ATTACK_VARIANTS;
      bag = this.npcPunchVariantBag;
    }
    const next = this.drawCombatAttackVariant(pool, bag, previous);
    this.npcRecentPunchVariants.push(next);
    while (this.npcRecentPunchVariants.length > 3) this.npcRecentPunchVariants.shift();
    this.lastNpcPunchVariant = next;
    return next;
  }

  private startNpcAttack(
    kind: MeleeAttackKind,
    targetDistance: number,
    replaceCurrent = false,
  ): void {
    if (!this.npcCombatEnabled || this.npcRagdoll || this.npcRecovery || !this.idleNpcMixer || this.npcHitReaction) return;
    if (!replaceCurrent && (this.npcAttack || this.npcAttackRecoverySeconds > 0)) return;
    const spacing = combatMeleeSpacingForDistance(targetDistance);
    if (spacing === 'out') return;
    const variant = this.chooseNpcCombatAttackVariant(kind, spacing, targetDistance);
    const action = this.idleNpcCombatAttackActions.get(variant);
    const pair = this.combatAttackLayers.get(variant);
    if (!action || !pair) return;
    if (replaceCurrent && this.npcAttack) {
      this.idleNpcCombatAttackActions.get(this.npcAttack.animation)?.fadeOut(COMBAT_ATTACK_CHAIN_BLEND_SECONDS);
      this.npcAttack = null;
      this.npcHandSweepReady = false;
    }
    const visual = combatAttackVisualProfile(variant);
    const npcRate = combatAttackPlaybackRate(kind, pair.clip.duration, visual?.tempoMultiplier ?? 1);
    const duration = Math.max(0.08, pair.clip.duration / npcRate);
    const timing = combatAttackTimingProfile(variant);
    const strikingSide = this.combatAttackStrikingSides.get(variant) ?? 'right';
    if (replaceCurrent) {
      this.npcComboChainCount = Math.min(NPC_COMBO_MAX_CHAIN, this.npcComboChainCount + 1);
    } else {
      this.npcComboChainCount = 1;
      const second = Math.random() < 0.62 ? 1 : 0;
      const third = second && Math.random() < 0.42 ? 1 : 0;
      this.npcComboTargetLength = THREE.MathUtils.clamp(1 + second + third, 1, NPC_COMBO_MAX_CHAIN);
      this.npcBufferedPunchSeconds = 0;
    }
    this.npcAttack = {
      kind,
      animation: variant,
      spacing,
      targetDistanceAtStart: targetDistance,
      duration,
      endTime: duration * timing.finishFraction,
      impactTime: duration * timing.impactFraction,
      impactFraction: timing.impactFraction,
      contactStartFraction: timing.contactStartFraction,
      contactEndFraction: timing.contactEndFraction,
      strikingSide,
      elapsed: 0,
      impactApplied: false,
      sampledElapsed: 0,
    };
    this.npcHandSweepReady = false;
    this.npcChainQueuedForCurrentAttack = false;
    this.npcCombatPhase = 'attack';
    this.startNpcCombatGuardLayers('fight-idle', 1);
    action.stop();
    action.reset();
    action.enabled = true;
    action.paused = false;
    action.clampWhenFinished = true;
    action.setLoop(THREE.LoopOnce, 1);
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(npcRate);
    action.play();
    if (replaceCurrent) action.fadeIn(COMBAT_ATTACK_CHAIN_BLEND_SECONDS);
  }

  private startNpcRagdoll(
    kind: MeleeAttackKind,
    direction: Readonly<THREE.Vector3>,
    impactDamage = MELEE_ATTACKS[kind].damage,
    hitZone: CombatHitZone = 'upper-body',
    comboImpactScale = 1,
    contactPoint?: Readonly<THREE.Vector3>,
  ): void {
    if (!this.physics || !this.idleNpcCharacter || this.npcRagdoll || this.npcRecovery) return;
    this.npcResumeCombatAfterRecovery = this.npcCombatEnabled && this.npcHealth > 0;
    this.npcDownElapsed = 0;
    this.npcGroundKickRecoveryDelay = 0;
    this.physics.setMeleeOpponentBlockerEnabled(false);
    this.idleNpcMixer!.timeScale = 0;
    this.npcHitDirection.set(direction.x, 0, direction.z);
    if (this.npcHitDirection.lengthSq() < 1e-6) this.npcHitDirection.set(0, 0, 1);
    this.npcHitDirection.normalize();
    const nominal = Math.max(1, MELEE_ATTACKS[kind].damage);
    const energyScale = THREE.MathUtils.clamp(impactDamage / nominal, 0.62, 1.18);
    const comboScale = THREE.MathUtils.clamp(comboImpactScale, 1, 1.30);
    const animationMotion = this.npcMotionHistory.getMotion();
    const rootMotion = Object.entries(animationMotion?.bones ?? {}).find(([name]) => name.endsWith('hips'))?.[1];
    this.npcRagdoll = RagdollSystem.create(this.physics, this.idleNpcCharacter, {
      velocity: rootMotion?.linearVelocity ?? new THREE.Vector3(),
      yawRateRadians: THREE.MathUtils.clamp(rootMotion?.angularVelocity.y ?? 0, -2.5, 2.5),
      animationMotion,
      quietStart: false, tipScale: 0, variationScale: 0, activeResponseScale: 0.16,
    });
    this.npcRagdoll.applyMeleeImpact(this.npcHitDirection,
      energyScale * comboScale * (kind === 'big-punch' ? 1.3 : 1), hitZone, contactPoint);
    this.npcBalance.reset();
    this.npcAttack = null;
    this.npcCombatEnabled = false;
    this.npcCombatPhase = 'down';
    this.stopNpcCombatGuardLayers(0.04);
    this.npcHandSweepReady = false;
    this.npcAttackRecoverySeconds = 0;
    this.npcBufferedPunchSeconds = 0;
    this.npcComboChainCount = 0;
    this.npcComboTargetLength = 1;
    this.npcChainQueuedForCurrentAttack = false;
    this.npcHitReaction = null;
    this.updateNpcUi();
  }

  private startNpcGroundRecovery(): void {
    if (!this.physics || !this.idleNpcAnchor || !this.idleNpcCharacter || !this.idleNpcMixer || !this.npcRagdoll || this.npcRecovery || this.npcHealth <= 0) return;
    const ragdoll = this.npcRagdoll;
    const hipPose = ragdoll.getPelvisPose(new THREE.Vector3(), new THREE.Quaternion());
    const stand = this.physics.findStandingRecoveryPosition(
      hipPose.position,
      ragdoll.getOwnedBodyHandles(),
      true,
    );
    if (!stand) return;
    const anatomicalRotation = hipPose.rotation.clone()
      .multiply(this.npcRecoveryRestHipsRotation.clone().invert());
    this.npcRecoveryFront.set(0, 0, 1).applyQuaternion(anatomicalRotation);
    const side = chooseGetUpSide(this.npcRecoveryFront.dot(this.recoveryWorldUp));
    const clipId: AnimationId = side === 'back' ? 'stand-up-back' : 'stand-up-belly';
    const clip = this.animations.get(clipId)?.clip;
    if (!clip) return;
    let recovery: GetUpRecovery;
    try {
      recovery = new GetUpRecovery(this.idleNpcAnchor, this.idleNpcCharacter, clip, side, stand.y - 0.865);
      recovery.retargetStandingPosition(stand);
      recovery.start();
    } catch (error) {
      console.error('[npc-get-up] Unable to start recovery', error);
      return;
    }
    ragdoll.suspendForRecovery();
    this.npcRagdoll = undefined;
    this.npcRecovery = recovery;
    this.npcCombatPhase = 'recover';
    this.npcDownElapsed = 0;
    this.npcGroundKickRecoveryDelay = 0;
    this.idleNpcMixer.stopAllAction();
    this.idleNpcMixer.timeScale = 0;
    this.syncNpcPlayerBlocker(false);
    this.updateNpcUi();
  }

  private finishNpcGroundRecovery(): void {
    const recovery = this.npcRecovery;
    if (!recovery || !recovery.isFinished || !this.idleNpcMixer || !this.idleNpcCharacter) return;
    const handoff = captureGetUpPoseClip(this.idleNpcCharacter, 'NpcGetUp_FinalHandoff');
    recovery.dispose();
    this.npcRecovery = null;
    this.idleNpcMixer.stopAllAction();
    this.idleNpcMixer.timeScale = 1;
    const hold = this.idleNpcMixer.clipAction(handoff);
    hold.reset().setLoop(THREE.LoopOnce, 1);
    hold.clampWhenFinished = true;
    hold.play();
    this.idleNpcMixer.update(0);
    this.npcCurrentAction = hold;
    this.npcCurrentAnimation = recovery.side === 'back' ? 'stand-up-back' : 'stand-up-belly';
    this.npcCombatLowerActive = null;
    this.npcCombatLowerReverse = false;
    this.npcCombatEnabled = this.npcResumeCombatAfterRecovery && this.npcHealth > 0;
    this.npcCombatPhase = this.npcCombatEnabled ? 'guard' : 'idle';
    if (this.npcCombatEnabled) this.startNpcCombatGuardLayers('fight-idle', 1);
    else this.playNpcAnimation('idle', true, 1, true);
    this.syncNpcPlayerBlocker(true);
    this.updateNpcUi();
  }

  private interruptNpcRecoveryWithGroundKick(direction: Readonly<THREE.Vector3>, strength = 1, point?: Readonly<THREE.Vector3>): void {
    if (!this.physics || !this.idleNpcCharacter || !this.idleNpcMixer || !this.npcRecovery) return;
    this.npcRecovery.dispose();
    this.npcRecovery = null;
    this.idleNpcMixer.stopAllAction();
    this.idleNpcMixer.timeScale = 0;
    this.idleNpcCharacter.updateMatrixWorld(true);
    this.npcHitDirection.set(direction.x, 0, direction.z);
    if (this.npcHitDirection.lengthSq() < 1e-6) this.npcHitDirection.set(0, 0, 1);
    else this.npcHitDirection.normalize();
    const animationMotion = this.npcMotionHistory.getMotion();
    const rootMotion = Object.entries(animationMotion?.bones ?? {}).find(([name]) => name.endsWith('hips'))?.[1];
    const launch = rootMotion?.linearVelocity ?? new THREE.Vector3();
    this.npcRagdoll = RagdollSystem.create(this.physics, this.idleNpcCharacter, {
      velocity: launch,
      yawRateRadians: rootMotion?.angularVelocity.y ?? 0,
      animationMotion,
      quietStart: false,
      tipScale: 0,
      variationScale: 0,
      activeResponseScale: 0.18,
    });
    this.npcRagdoll.applyGroundKickImpact(this.npcHitDirection, strength, true, point);
    this.npcCombatEnabled = false;
    this.npcCombatPhase = 'down';
    this.npcDownElapsed = 0;
    this.npcGroundKickRecoveryDelay = 1.55;
    if (this.npcHealth <= 0) this.npcResumeCombatAfterRecovery = false;
    this.syncNpcPlayerBlocker(false);
    this.updateNpcUi();
  }

  private receiveNpcMeleeHit(
    kind: MeleeAttackKind,
    direction: Readonly<THREE.Vector3>,
    overrideDamage?: number,
    hitZone?: CombatHitZone,
    contactPoint?: Readonly<THREE.Vector3>,
  ): void {
    if (!this.idleNpcCharacter || this.npcRagdoll || this.npcRecovery || this.npcHealth <= 0) return;

    const incomingDamage = overrideDamage ?? MELEE_ATTACKS[kind].damage;
    if (!Number.isFinite(incomingDamage) || incomingDamage <= 0) return;
    this.npcHitHandoff.capture(this.idleNpcCharacter);
    this.npcBufferedPunchSeconds = 0;
    this.npcChainQueuedForCurrentAttack = false;
    this.seedCombatImpact(true, direction, incomingDamage, hitZone ?? 'upper-body');
    // Same no-trade rule for the bot: being hit cancels its unfinished outgoing
    // attack before HP/reaction processing, so a stored contact cannot fire later.
    if (this.npcAttack) {
      this.idleNpcCombatAttackActions.get(this.npcAttack.animation)?.fadeOut(0.035);
      this.npcAttack = null;
      this.npcHandSweepReady = false;
      this.npcAttackRecoverySeconds = 0;
      this.npcBufferedPunchSeconds = 0;
      this.npcChainQueuedForCurrentAttack = false;
    }

    const profile = MELEE_ATTACKS[kind];
    const damage = Math.max(0, overrideDamage ?? profile.damage);
    this.npcHealth = Math.max(0, this.npcHealth - damage);
    const hitDuringReaction = this.npcHitReaction !== null;
    const sincePreviousHit = this.combatClock - this.npcLastPlayerHitAt;
    if (!Number.isFinite(sincePreviousHit) || sincePreviousHit > NPC_REHIT_COMBO_RESET_SECONDS) {
      this.npcConsecutivePlayerHits = 0;
    }
    this.npcConsecutivePlayerHits += 1;
    this.npcLastPlayerHitAt = this.combatClock;

    // A confirmed fist contact is never swallowed just because a previous hit
    // reaction is still playing. The second quick hit interrupts into a new
    // reaction; a third committed hit (or a heavy re-hit) converts the existing
    // animation momentum into a ragdoll knockdown instead of ignoring the input.
    const rapidRehit = hitDuringReaction && sincePreviousHit <= NPC_REHIT_COMBO_RESET_SECONDS;
    const comboKnockdown = rapidRehit && (
      this.npcConsecutivePlayerHits >= NPC_REHIT_RAGDOLL_HIT_COUNT
      || kind === 'big-punch'
    );
    const balanceLoss = this.npcBalance.hit(this.combatClock, damage, hitZone ?? 'upper-body', kind === 'big-punch');
    const ordinaryKnockdown = balanceLoss >= 37;
    const knockdown = this.npcHealth <= 0 || ordinaryKnockdown;
    if (knockdown) {
      const comboImpactScale = comboKnockdown
        ? THREE.MathUtils.clamp(1.08 + (this.npcConsecutivePlayerHits - 2) * 0.10, 1.08, 1.28)
        : 1;
      this.startNpcRagdoll(kind, direction, damage, hitZone ?? 'upper-body', comboImpactScale, contactPoint);
      return;
    }
    const reaction = hitZone === 'body'
      ? this.chooseCombatHitAnimation('punch', this.lastNpcHitReaction, 'body')
      : this.chooseCombatHitAnimation(kind, this.lastNpcHitReaction, hitZone);
    this.lastNpcHitReaction = reaction;
    const loaded = this.animations.get(reaction);
    if (!loaded) return;
    this.npcAttack = null;
    this.npcHandSweepReady = false;
    this.npcAttackRecoverySeconds = 0;
    this.npcBufferedPunchSeconds = 0;
    this.npcComboChainCount = 0;
    this.npcComboTargetLength = 1;
    this.npcChainQueuedForCurrentAttack = false;
    const reactionRate = hitReactionPlaybackRate(kind, loaded.clip.duration);
    this.npcHitReaction = reaction;
    this.npcHitReactionElapsed = 0;
    this.npcHitReactionDuration = Math.max(0.18, loaded.clip.duration / reactionRate);
    this.npcCombatPhase = 'hit';
    this.playNpcAnimation(reaction, false, reactionRate, true);
    this.updateNpcUi();
  }

  private evaluateCombatMixers(delta: number, player = true): void {
    if (!this.npcRagdoll && !this.npcRecovery) {
      this.idleNpcMixer?.update(delta);
      const attack = this.npcAttack;
      if (attack) {
        const action = this.idleNpcCombatAttackActions.get(attack.animation);
        if (action) action.time = Math.min(action.getClip().duration, attack.elapsed / attack.duration * action.getClip().duration);
        this.idleNpcMixer?.update(0);
      }
      this.npcProceduralPose.capture(this.idleNpcCharacter);
      this.npcHitHandoff.apply(delta);
      this.idleNpcAnchor?.updateMatrixWorld(true);
    }
    if (!player) return;
    this.gaitTransition.update(delta);
    if (this.currentAction && isCycleLocomotionAnimation(this.currentAnimation)
      && this.currentAction === this.animations.get(this.currentAnimation)?.action) {
      const current = this.currentAction;
      const duration = current.getClip().duration;
      for (const [id, loaded] of this.animations) {
        if (loaded.action === current || !isCycleLocomotionAnimation(id) || !loaded.action.isRunning()) continue;
        const phase = alignGaitPhase(current.time / duration,
          this.gaitLandmarks.get(this.currentAnimation) ?? 0, this.gaitLandmarks.get(id) ?? 0);
        for (const action of [loaded.action, this.firstPersonAnimations.get(id)!.action]) {
          action.time = phase * loaded.clip.duration;
          action.setEffectiveTimeScale(current.getEffectiveTimeScale() * loaded.clip.duration / duration);
        }
      }
    }
    this.mixer?.update(delta);
    this.firstPersonMixer?.update(delta);
    if (this.combatAttack && this.combatAttackAction) {
      for (const action of [this.combatAttackAction.thirdPerson, this.combatAttackAction.firstPerson]) {
        action.time = Math.min(action.getClip().duration, this.combatAttack.elapsed / this.combatAttack.duration * action.getClip().duration);
      }
      this.mixer?.update(0); this.firstPersonMixer?.update(0);
    }
    this.playerProceduralPose.capture(this.character);
    this.firstPersonProceduralPose.capture(this.firstPersonCharacter);
    this.playerHitHandoff.apply(delta);
    this.firstPersonHitHandoff.apply(delta);
    this.avatarAnchor.updateMatrixWorld(true);
  }

  private applyCombatImpactResponse(delta: number): void {
    const apply = (npc: boolean): void => {
      const pitch = npc ? this.npcImpactPitch : this.playerImpactPitch;
      const roll = npc ? this.npcImpactRoll : this.playerImpactRoll;
      const p = stepCombatSpring(pitch[0], pitch[1], delta), r = stepCombatSpring(roll[0], roll[1], delta);
      if (npc) { this.npcImpactPitch = p; this.npcImpactRoll = r; }
      else { this.playerImpactPitch = p; this.playerImpactRoll = r; }
      const yaw = npc ? this.idleNpcAnchor?.rotation.y ?? 0 : this.bodyYaw;
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const spine = npc ? this.idleNpcSpine1Bone : this.combatSpine1Bone;
      const chest = npc ? this.idleNpcSpine2Bone : this.combatSpine2Bone;
      const head = npc ? this.idleNpcHeadBone : this.headBone;
      const zone = npc ? this.npcImpactZone : this.playerImpactZone;
      this.applyWorldAxisOffset(spine, right, p[0] * 0.35);
      this.applyWorldAxisOffset(chest, right, p[0] * 0.65);
      this.applyWorldAxisOffset(chest, forward, r[0]);
      if (zone === 'head') {
        this.applyWorldAxisOffset(head, right, p[0] * 0.45);
        this.applyWorldAxisOffset(head, forward, r[0] * 0.55);
      }
    };
    if (!this.ragdoll && !this.recovery) apply(false);
    if (!this.npcRagdoll && !this.npcRecovery) apply(true);
  }

  private seedCombatImpact(npc: boolean, direction: Readonly<THREE.Vector3>, damage: number, zone: CombatHitZone): void {
    const yaw = npc ? this.idleNpcAnchor?.rotation.y ?? 0 : this.bodyYaw;
    const forward = direction.x * Math.sin(yaw) + direction.z * Math.cos(yaw);
    const side = direction.x * Math.cos(yaw) - direction.z * Math.sin(yaw);
    const energy = THREE.MathUtils.clamp(damage / 12, 0.35, 1.8);
    const pitch = npc ? this.npcImpactPitch : this.playerImpactPitch;
    const roll = npc ? this.npcImpactRoll : this.playerImpactRoll;
    pitch[1] = THREE.MathUtils.clamp(pitch[1] + forward * energy * (zone === 'body' ? 1.9 : 3.8), -7, 7);
    roll[1] = THREE.MathUtils.clamp(roll[1] + side * energy * 3.4, -6, 6);
    if (npc) this.npcImpactZone = zone; else this.playerImpactZone = zone;
  }

  private copyCombatPoseToFirstPerson(): void {
    if (!this.combatAttack && !this.groundKick && !this.combatHitReaction) return;
    // The world strike owns the contact pose in both views. First-person guard
    // presentation is applied afterward, fading away before the striking hand
    // enters its contact window, then returning smoothly during recoil.
    if ((this.groundKick || this.combatAttack) && this.hipsBone && this.firstPersonHipsBone) {
      this.firstPersonHipsBone.position.copy(this.hipsBone.position);
      this.firstPersonHipsBone.quaternion.copy(this.hipsBone.quaternion);
    }
    const pairs = [
      [this.combatSpineBone, this.firstPersonCombatSpineBone],
      [this.combatSpine1Bone, this.firstPersonCombatSpine1Bone],
      [this.combatSpine2Bone, this.firstPersonCombatSpine2Bone],
      [this.leftUpperArmBone, this.firstPersonLeftUpperArmBone],
      [this.leftForearmBone, this.firstPersonLeftForearmBone],
      [this.leftHandBone, this.firstPersonLeftHandBone],
      [this.rightUpperArmBone, this.firstPersonRightUpperArmBone],
      [this.rightForearmBone, this.firstPersonRightForearmBone],
      [this.rightHandBone, this.firstPersonRightHandBone],
      [this.leftUpperLegBone, this.firstPersonLeftUpperLegBone],
      [this.leftLowerLegBone, this.firstPersonLeftLowerLegBone],
      [this.leftFootBone, this.firstPersonLeftFootBone],
      [this.rightUpperLegBone, this.firstPersonRightUpperLegBone],
      [this.rightLowerLegBone, this.firstPersonRightLowerLegBone],
      [this.rightFootBone, this.firstPersonRightFootBone],
    ];
    for (const [source, target] of pairs) if (source && target) target.quaternion.copy(source.quaternion);
  }

  private updateNpcCombat(delta: number): void {
    if (!this.idleNpcMixer || !this.idleNpcAnchor || !this.player) return;
    const dt = Math.max(0, delta);
    this.npcGroundKickRecoveryDelay = Math.max(0, this.npcGroundKickRecoveryDelay - dt);
    this.syncNpcPlayerBlocker(!this.npcRagdoll && !this.npcRecovery && this.npcHealth > 0);
    if (this.npcRecovery) {
      this.npcRecovery.update(dt);
      if (this.idleNpcCharacter) this.npcMotionHistory.capture(this.idleNpcCharacter, dt);
      this.idleNpcAnchor.updateMatrixWorld(true);
      if (this.npcRecovery.isFinished) this.finishNpcGroundRecovery();
      else this.updateNpcUi();
      return;
    }
    if (this.npcRagdoll) {
      this.npcDownElapsed += dt;
      this.npcRagdoll.setPlayerTraversalEnabled(true);
      if (npcGroundRecoveryReady(
        this.npcHealth > 0,
        this.npcRagdoll.isRecoveryReady,
        this.npcDownElapsed,
        this.npcGroundKickRecoveryDelay,
        this.groundKick !== null,
      )) this.startNpcGroundRecovery();
      this.updateNpcUi();
      return;
    }
    this.updateNpcSpacingPush(delta);
    // Mixer evaluation only changes local bone transforms. Refresh the NPC world
    // matrices immediately so player punches target the exact CURRENT hit-reaction
    // pose (leaning back/sideways), not the previous/rest pose that the renderer
    // would otherwise update later in the frame.
    this.idleNpcAnchor.updateMatrixWorld(true);
    this.npcAttackRecoverySeconds = Math.max(0, this.npcAttackRecoverySeconds - dt);
    this.npcBufferedPunchSeconds = Math.max(0, this.npcBufferedPunchSeconds - dt);

    // Hit reactions follow the same interruptible contract as the player's.
    // When a reaction finishes, restore the layered guard rather than snapping
    // back to a monolithic Fight Idle clip.
    if (this.npcHitReaction) {
      this.npcHitReactionElapsed += dt;
      if (this.npcHitReactionElapsed >= this.npcHitReactionDuration) {
        this.npcHitReaction = null;
        this.npcHitReactionElapsed = 0;
        this.npcHitReactionDuration = 0;
        this.npcCombatPhase = this.npcCombatEnabled ? 'guard' : 'idle';
        this.npcAttackCooldown = this.npcCombatEnabled ? 0.30 : 0;
        if (this.npcCombatEnabled) this.startNpcCombatGuardLayers('fight-idle', 1);
        else this.playNpcAnimation('idle', true, 1, true);
      }
      return;
    }
    if (!this.npcCombatEnabled || this.npcHealth <= 0) return;

    const playerState = this.player.getDebugState();
    this.npcToPlayer.set(
      this.avatarAnchor.position.x - this.idleNpcAnchor.position.x,
      0,
      this.avatarAnchor.position.z - this.idleNpcAnchor.position.z,
    );
    let distance = this.npcToPlayer.length();
    if (distance > 0.001 && this.npcCombatPhase !== 'hit'
      && (!this.npcAttack || this.npcAttack.elapsed / this.npcAttack.duration < this.npcAttack.contactStartFraction)) {
      this.npcToPlayer.multiplyScalar(1 / distance);
      const targetYaw = Math.atan2(this.npcToPlayer.x, this.npcToPlayer.z);
      this.idleNpcAnchor.rotation.y = followActionYaw(this.idleNpcAnchor.rotation.y, targetYaw, dt, 12, 240);
    }

    if (this.npcAttack) {
      const strikeClock = advanceStrikeClock(dt, this.npcAttack.compressionSeconds ?? 0);
      this.npcAttack.compressionSeconds = strikeClock.remaining;
      this.npcAttack.elapsed += strikeClock.step;
      this.updateNpcAttackCommitment(delta);
      this.idleNpcAnchor.updateMatrixWorld(true);

      const active = this.npcAttack;
      if (!active) return;
      const normalized = active.duration > 1e-5 ? active.elapsed / active.duration : 1;

      // AI decision feeds the same one-slot punch buffer used by the player.
      // It never overlaps attacks: it only remembers a follow-up until the
      // current fist has left the contact window, then chains with the same
      // short additive crossfade as player LMB buffering.
      if (
        !this.npcChainQueuedForCurrentAttack
        && this.npcComboChainCount < this.npcComboTargetLength
        && normalized >= Math.max(0.10, active.impactFraction - 0.055)
        && distance >= NPC_COMBO_REQUEUE_MIN_DISTANCE
        && distance <= NPC_COMBO_REQUEUE_MAX_DISTANCE
        && !playerState.incapacitated
        && !this.ragdoll
        && !this.recovery
        && this.health > 0
      ) {
        this.meleeOrigin.copy(this.idleNpcAnchor.position).add(new THREE.Vector3(0, 1.22, 0));
        this.meleeForward.copy(this.avatarAnchor.position).add(new THREE.Vector3(0, 1.22, 0)).sub(this.meleeOrigin);
        const losDistance = this.meleeForward.length();
        if (losDistance > 0.05) {
          this.meleeForward.multiplyScalar(1 / losDistance);
          this.cameraRaycaster.set(this.meleeOrigin, this.meleeForward);
          this.cameraRaycaster.near = 0.02;
          this.cameraRaycaster.far = Math.max(0.02, losDistance - 0.10);
          if (this.cameraRaycaster.intersectObjects(this.environmentMeshes, false).length === 0) {
            this.npcBufferedPunchSeconds = COMBAT_PUNCH_INPUT_BUFFER_SECONDS;
            this.npcChainQueuedForCurrentAttack = true;
          }
        }
      }

      if (
        this.npcBufferedPunchSeconds > 0
        && active.kind !== 'hook-counter'
        && combatChainReady(active.elapsed, active.duration, active.contactEndFraction, active.impactFraction)
      ) {
        this.npcBufferedPunchSeconds = 0;
        const chainKind: MeleeAttackKind = this.npcComboChainCount + 1 >= this.npcComboTargetLength
          && Math.random() < 0.18
          ? 'big-punch'
          : 'punch';
        this.startNpcAttack(chainKind, distance, true);
        return;
      }

      if (this.npcAttack && this.npcAttack.elapsed >= this.npcAttack.endTime) {
        const finished = this.npcAttack;
        this.idleNpcCombatAttackActions.get(finished.animation)?.fadeOut(0.075);
        this.npcAttack = null;
        this.npcHandSweepReady = false;
        this.npcAttackRecoverySeconds = Math.max(
          this.npcAttackRecoverySeconds,
          combatAttackRecoverySeconds(finished.kind),
        );
        this.npcCombatPhase = 'guard';
        this.startNpcCombatGuardLayers('fight-idle', 1);
        // Decision latency is separate from the physical recovery, just as a
        // human may pause before clicking again. It is much shorter than the old
        // 0.8-1.4 s hard combat cooldown so the bot can actually use combos.
        this.npcAttackCooldown = THREE.MathUtils.lerp(0.22, 0.52, Math.random());
        if (this.npcComboChainCount >= this.npcComboTargetLength) {
          this.npcBufferedPunchSeconds = 0;
          this.npcComboChainCount = 0;
          this.npcComboTargetLength = 1;
        }
      }
      return;
    }

    this.npcAttackCooldown = Math.max(0, this.npcAttackCooldown - dt);
    if (this.ragdoll || this.recovery || playerState.incapacitated || this.health <= 0) return;

    // A buffered follow-up that narrowly missed the in-strike chain boundary is
    // still consumed after the same tiny recovery gate as the player, rather
    // than being thrown away.
    if (
      this.npcBufferedPunchSeconds > 0
      && this.npcAttackRecoverySeconds <= 0
      && distance >= NPC_COMBO_REQUEUE_MIN_DISTANCE
      && distance <= NPC_COMBO_REQUEUE_MAX_DISTANCE
    ) {
      this.npcBufferedPunchSeconds = 0;
      this.startNpcAttack('punch', distance, false);
      if (this.npcAttack) return;
    }

    // Pursuit now keeps the same upper-body guard as standing combat while only
    // the lower-body layer walks. This matches the player's layered guard.
    if (distance > 1.35 && distance <= 6.0 && this.npcCombatPhase === 'guard') {
      this.meleeOrigin.copy(this.idleNpcAnchor.position).add(new THREE.Vector3(0, 1.10, 0));
      this.meleeForward.copy(this.avatarAnchor.position).add(new THREE.Vector3(0, 1.10, 0)).sub(this.meleeOrigin);
      const pathDistance = this.meleeForward.length();
      if (pathDistance > 0.05) {
        this.meleeForward.multiplyScalar(1 / pathDistance);
        this.cameraRaycaster.set(this.meleeOrigin, this.meleeForward);
        this.cameraRaycaster.near = 0.06;
        this.cameraRaycaster.far = Math.max(0.06, Math.min(pathDistance - 0.35, 1.25));
        const blocked = this.cameraRaycaster.intersectObjects(this.environmentMeshes, false).length > 0;
        if (!blocked) {
          const step = Math.min(Math.max(0, distance - 1.24), 1.42 * dt);
          if (this.moveNpcCombatStep(this.npcToPlayer, step) > 0) {
            this.startNpcCombatGuardLayers('walking', 0.96);
            return;
          }
        }
      }
      this.startNpcCombatGuardLayers('fight-idle', 1);
    } else if (this.npcCombatPhase === 'guard') {
      this.startNpcCombatGuardLayers('fight-idle', 1);
    }

    // Re-evaluate distance after pursuit movement.
    this.npcToPlayer.set(
      this.avatarAnchor.position.x - this.idleNpcAnchor.position.x,
      0,
      this.avatarAnchor.position.z - this.idleNpcAnchor.position.z,
    );
    distance = this.npcToPlayer.length();
    if (distance > 0.001) this.npcToPlayer.multiplyScalar(1 / distance);

    if (
      distance <= 1.55
      && this.npcAttackCooldown <= 0
      && this.npcAttackRecoverySeconds <= 0
      && distance > 0.05
    ) {
      this.meleeOrigin.copy(this.idleNpcAnchor.position).add(new THREE.Vector3(0, 1.25, 0));
      this.meleeForward.copy(this.avatarAnchor.position).add(new THREE.Vector3(0, 1.25, 0)).sub(this.meleeOrigin);
      const losDistance = this.meleeForward.length();
      if (losDistance > 0.05) {
        this.meleeForward.multiplyScalar(1 / losDistance);
        this.cameraRaycaster.set(this.meleeOrigin, this.meleeForward);
        this.cameraRaycaster.near = 0.02;
        this.cameraRaycaster.far = Math.max(0.02, losDistance - 0.10);
        if (this.cameraRaycaster.intersectObjects(this.environmentMeshes, false).length === 0) {
          this.startNpcAttack(Math.random() < 0.18 ? 'big-punch' : 'punch', distance);
        }
      }
    }
  }

  private startAuthoredTurn(id: AnimationId): void {
    const sleepingTurn = isSleepingIdleTurn(id);
    this.activeTurnResumeMode = sleepingTurn ? 'sleeping' : 'action';
    this.idleResumeMode = this.activeTurnResumeMode;
    this.idleNeedsEntry = false;
    this.idleSequencePhase = this.activeTurnResumeMode;
    this.idleSequenceElapsed = 0;
    this.idleSequenceOneShot = null;
    const restartFromSettledPose = this.settledActionTurnPose === id;
    this.settledActionTurnPose = null;
    this.activeAuthoredTurn = id;
    // Authored turns are visual only. PlayerController/body yaw remains the sole
    // world-rotation authority; the clip is just the matching footwork.
    this.activeTurnStartBodyYaw = this.bodyYaw;
    this.autoOneShot = id;

    const big = isBigTurnAnimation(id);
    const rate = this.viewMode === 'first-person'
      ? big ? 1.08 : 1.14
      : 1;
    if (restartFromSettledPose) {
      // The same turn direction may be requested again after a held final pose.
      // Restart from frame zero rather than resuming the paused end of the clip.
      this.autoCandidate = id;
      this.autoCandidateElapsed = 0;
      this.playAnimation(id, false, rate, false, true);
    } else {
      this.playAutoImmediate(id, false, rate);
    }

    // Do not jump into the middle of the authored turn. The previous lead-in
    // skip made the planted foot appear to teleport as soon as the body turn
    // committed. A very small trim keeps responsiveness while preserving the
    // actual preparation/contact frames.
    if (this.viewMode === 'first-person') {
      const loaded = this.animations.get(id);
      const firstLoaded = this.firstPersonAnimations.get(id);
      const startFraction = 0.01;
      if (loaded && this.currentAction) this.currentAction.time = loaded.clip.duration * startFraction;
      if (firstLoaded && this.firstPersonCurrentAction) {
        this.firstPersonCurrentAction.time = firstLoaded.clip.duration * startFraction;
      }
    }
  }

  private authoredTurnMustHold(): boolean {
    const id = this.activeAuthoredTurn;
    if (!id || this.currentAnimation !== id || !this.currentAction) {
      this.activeAuthoredTurn = null;
      return false;
    }
    const loaded = this.animations.get(id);
    if (!loaded) {
      this.activeAuthoredTurn = null;
      return false;
    }

    const big = isBigTurnAnimation(id);
    const firstPersonTurn = this.viewMode === 'first-person';
    if (firstPersonTurn) {
      // A committed 1P turn must keep its readable footwork until the footwork has become readable. Previously the
      // clip was discarded as soon as the procedural pelvis had nearly caught
      // the POV (often around 20% of the FBX), which looked like the legs
      // teleported between poses. Keep almost the whole useful clip and only
      // blend out the small authored tail.
      const playableFraction = big ? 0.90 : 0.88;
      const playableUntil = loaded.clip.duration * playableFraction;
      return this.currentAction.time < playableUntil;
    }

    const minimumSeconds = big
      ? THIRD_PERSON_LOOK_TUNING.authoredBigTurnMinSeconds
      : THIRD_PERSON_LOOK_TUNING.authoredTurnMinSeconds;
    const minimumBodyDegrees = big
      ? THIRD_PERSON_LOOK_TUNING.authoredBigTurnMinBodyDegrees
      : THIRD_PERSON_LOOK_TUNING.authoredTurnMinBodyDegrees;
    const minimumClipFraction = THIRD_PERSON_LOOK_TUNING.authoredTurnMinClipFraction;
    const bodyProgressDegrees = Math.abs(THREE.MathUtils.radToDeg(
      this.bodyYaw - this.activeTurnStartBodyYaw,
    ));
    const bodyHasTurned = bodyProgressDegrees >= minimumBodyDegrees
      || Math.abs(this.lookOffsetDegrees) <= THIRD_PERSON_LOOK_TUNING.authoredTurnResetDegrees;
    const clipHasAdvanced = this.currentAction.time >= loaded.clip.duration * minimumClipFraction;
    const failSafe = this.currentAnimationElapsed >= Math.max(1.15, minimumSeconds * 2.1);
    return !failSafe && (
      this.currentAnimationElapsed < minimumSeconds
      || !clipHasAdvanced
      || !bodyHasTurned
    );
  }

  private clearAuthoredTurn(): void {
    this.activeAuthoredTurn = null;
  }

  private holdSettledActionTurnPose(id: AnimationId): void {
    if (this.viewMode !== 'first-person' || !isActionIdleTurn(id)) return;
    this.settledActionTurnPose = id;
    // Freeze exactly where the readable turn phase finished. This preserves the
    // two-foot turn stance instead of snapping/crossfading straight back to the
    // one-leg-forward idle-action pose while the POV is already comfortable.
    if (this.currentAction) this.currentAction.paused = true;
    if (this.firstPersonCurrentAction) this.firstPersonCurrentAction.paused = true;
  }

  private currentAutoOneShotStillPlaying(): boolean {
    const id = this.autoOneShot;
    if (!id || this.currentAnimation !== id || !this.currentAction) {
      this.autoOneShot = null;
      this.clearAuthoredTurn();
      return false;
    }
    const loaded = this.animations.get(id);
    if (!loaded) {
      this.autoOneShot = null;
      this.clearAuthoredTurn();
      return false;
    }
    const blendLead = isPostureTransition(id) ? 0.14 : isTurnAnimation(id) ? 0.16 : 0.08;
    if (this.currentAction.time < Math.max(0.05, loaded.clip.duration - blendLead)) return true;
    this.autoOneShot = null;
    if (isTurnAnimation(id)) this.clearAuthoredTurn();
    return false;
  }

  private animationStillPlaying(id: AnimationId, blendLead = 0.08): boolean {
    if (this.currentAnimation !== id || !this.currentAction) return false;
    const loaded = this.animations.get(id);
    if (!loaded) return false;
    return this.currentAction.time < Math.max(0.04, loaded.clip.duration - blendLead);
  }

  private markStandingIdleResume(mode: IdleResumeMode): void {
    this.idleResumeMode = mode;
    this.idleNeedsEntry = true;
    this.idleSequencePhase = mode === 'sleeping' ? 'sleeping' : 'action';
    this.idleSequenceElapsed = 0;
    this.idleSequenceOneShot = null;
  }

  private pickIdleLookAnimation(): AnimationId {
    const candidates = IDLE_LOOK_ANIMATIONS.filter((id) => id !== this.lastIdleLookAnimation);
    const pool = candidates.length > 0 ? candidates : IDLE_LOOK_ANIMATIONS;
    const id = pool[Math.floor(Math.random() * pool.length)] ?? 'idle-looking';
    this.lastIdleLookAnimation = id;
    return id;
  }

  private updateStandingIdleSequence(delta: number, force: boolean): void {
    // Looking around is activity only for the Action/Wait/transition AFK bridge:
    // every real mouse movement resets the 2.5 s countdown there. Once Sleeping
    // Idle has been reached, head movement and in-place body turns must NOT wake
    // the character back into Action Idle. They only postpone/cancel the automatic
    // 5 s Looking loop so the Sleeping pose and its dedicated turn clips remain active.
    const sleepingPhase = this.idleSequencePhase === 'sleeping' || this.idleSequencePhase === 'sleeping-look';
    if (this.idleLookMovedThisFrame) {
      this.idleSequenceElapsed = 0;
      if (sleepingPhase) {
        if (this.idleSequencePhase === 'sleeping-look') {
          this.idleSequencePhase = 'sleeping';
          this.idleSequenceOneShot = null;
          this.playAutoImmediate('idle', true, 1);
        }
      } else if (this.idleSequencePhase !== 'action' || this.idleNeedsEntry) {
        this.idleResumeMode = 'action';
        this.idleNeedsEntry = false;
        this.idleSequencePhase = 'action';
        this.idleSequenceOneShot = null;
        this.playAutoImmediate('idle-action', true, 1);
        return;
      }
    }

    if (this.idleNeedsEntry) {
      this.idleNeedsEntry = false;
      this.idleSequenceElapsed = 0;
      this.idleSequenceOneShot = null;
      if (this.idleResumeMode === 'sleeping') {
        this.idleSequencePhase = 'sleeping';
        this.playAutoImmediate('idle', true, 1);
        return;
      }
      this.idleSequencePhase = 'action';
      this.playAutoImmediate('idle-action', true, 1);
      return;
    }

    if (this.idleSequencePhase === 'sleeping') {
      this.idleSequenceElapsed += delta;
      this.requestAutoAnimation('idle', true, 1, false, delta, force);
      if (this.idleSequenceElapsed < IDLE_SLEEPING_LOOK_INTERVAL_SECONDS) return;

      const lookId = this.pickIdleLookAnimation();
      this.idleSequencePhase = 'sleeping-look';
      this.idleSequenceElapsed = 0;
      this.idleSequenceOneShot = lookId;
      this.playAutoImmediate(lookId, false, 1);
      return;
    }

    if (this.idleSequencePhase === 'sleeping-look') {
      const lookId = this.idleSequenceOneShot;
      if (lookId && this.animationStillPlaying(lookId, 0.1)) return;

      this.idleSequencePhase = 'sleeping';
      this.idleSequenceElapsed = 0;
      this.idleSequenceOneShot = null;
      this.playAutoImmediate('idle', true, 1);
      return;
    }

    if (this.idleSequencePhase === 'action') {
      this.idleSequenceElapsed += delta;
      const holdingTurnStance = this.settledActionTurnPose !== null
        && this.currentAnimation === this.settledActionTurnPose;
      if (!holdingTurnStance) {
        this.settledActionTurnPose = null;
        this.requestAutoAnimation('idle-action', true, 1, false, delta, force);
      }
      if (this.idleSequenceElapsed < IDLE_ACTION_WAIT_DELAY_SECONDS) return;

      // AFK bridge: choose either of the original Wait clips at random. Any
      // mouse/head movement above resets this timer and cancels the bridge.
      const waitId: AnimationId = Math.random() < 0.5 ? 'idle-wait-1' : 'idle-wait-2';
      this.idleSequencePhase = 'wait';
      this.idleSequenceElapsed = 0;
      this.idleSequenceOneShot = waitId;
      this.playAutoImmediate(waitId, false, 1);
      return;
    }

    if (this.idleSequencePhase === 'wait') {
      const waitId = this.idleSequenceOneShot;
      if (waitId && this.animationStillPlaying(waitId, 0.1)) return;

      this.idleSequencePhase = 'transition';
      this.idleSequenceElapsed = 0;
      this.idleSequenceOneShot = 'idle-action-to-standing-idle';
      this.playAutoImmediate('idle-action-to-standing-idle', false, IDLE_TO_STANDING_RATE);
      return;
    }

    if (this.idleSequencePhase === 'transition') {
      if (this.animationStillPlaying('idle-action-to-standing-idle', 0.08)) return;
      this.idleSequencePhase = 'sleeping';
      this.idleSequenceElapsed = 0;
      this.idleSequenceOneShot = null;
      this.playAutoImmediate('idle', true, 1);
    }
  }

  private spawnSevereLandingBlood(impact: LandingImpact): void {
    if (!this.player || impact.fallDistance < 4.7) return;
    const state = this.player.getDebugState();
    const footOffset = state.crouching || state.lowPosture ? 0.565 : 0.865;
    const feetY = state.position.y - footOffset;
    let best: StaticCollider | null = null;
    let bestDistance = 0.88;
    for (const collider of this.plan.colliders) {
      if (collider.kind !== 'floor' && collider.kind !== 'step') continue;
      if (state.position.x < collider.center.x - collider.halfExtents.x - 0.22
        || state.position.x > collider.center.x + collider.halfExtents.x + 0.22
        || state.position.z < collider.center.z - collider.halfExtents.z - 0.22
        || state.position.z > collider.center.z + collider.halfExtents.z + 0.22) continue;
      const top = collider.center.y + collider.halfExtents.y;
      const distance = Math.abs(top - feetY);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = collider;
      }
    }
    if (!best) return;
    const top = best.center.y + best.halfExtents.y;
    this.bloodDecals.spawnBurst(
      this.impactWorldPoint.set(state.position.x, top, state.position.z),
      this.impactWorldNormal.set(0, 1, 0),
      THREE.MathUtils.clamp(0.72 + (impact.fallDistance - 5.5) * 0.07, 0.72, 1.18),
      1,
      THREE.MathUtils.clamp(1.38 + (impact.fallDistance - 5.5) * 0.14, 1.38, 2.55),
      { impactVelocity: new THREE.Vector3(state.velocity.x, state.velocity.y, state.velocity.z) },
    );
    this.bloodDecalCooldown = 0.18;
  }

  private handleLandingAnimation(strength: number, impact?: LandingImpact): void {
    this.landingVisualImpulse = Math.max(this.landingVisualImpulse, strength);
    if (!impact) return;

    if (impact.severe) {
      this.resetCombatState(true);
      this.spawnSevereLandingBlood(impact);
      this.health = 0;
      this.damageFlash = 1;
      this.secondsSinceDamage = 0;
      this.updateHealthUi();
      this.severeImpactLocked = true;
      this.landingAnimationPending = null;
      this.landingAnimationRate = 1;
      this.landingAnimationEndFraction = 1;
      this.player?.setIncapacitated(true);
      this.autoOneShot = null;
      this.pendingStrongTurn = null;
      this.clearAuthoredTurn();
      // A gameplay impact must own the animation pipeline even if a clip was
      // manually forced in the lab. Otherwise that forced clip can keep playing
      // through the landing and the later ragdoll handoff starts from nonsense.
      this.playbackMode = 'auto';
      this.modeButton?.classList.add('is-active');
      return;
    }

    const damage = this.calculateFallDamage(impact);
    if (damage > 0) this.applyDamage(damage);
    if (this.health <= 0 || this.ragdoll) return;

    const needsRecovery = impact.fallDistance >= MOVEMENT_TUNING.locomotion.landingRecoveryMinDistance
      || impact.impactSpeed >= MOVEMENT_TUNING.locomotion.landingRecoveryMinImpactSpeed;
    if (!needsRecovery) return;

    // A real fall landing owns both locomotion and animation for a short phase.
    // This prevents Falling Idle from continuing while the capsule walks away.
    // Normalize from the point where a landing actually becomes heavy, not
    // from zero. This keeps a 1-2 m drop near the fast end of the curve instead
    // of giving it a disproportionate fraction of the lethal recovery time.
    const distanceRecoveryBlend = THREE.MathUtils.clamp(
      (impact.fallDistance - MOVEMENT_TUNING.locomotion.landingRecoveryMinDistance)
        / Math.max(0.01, MOVEMENT_TUNING.locomotion.highFallImpactDistance - MOVEMENT_TUNING.locomotion.landingRecoveryMinDistance),
      0,
      1,
    );
    const speedRecoveryBlend = THREE.MathUtils.clamp(
      (impact.impactSpeed - MOVEMENT_TUNING.locomotion.landingRecoveryMinImpactSpeed)
        / Math.max(0.01, MOVEMENT_TUNING.locomotion.highFallImpactSpeed - MOVEMENT_TUNING.locomotion.landingRecoveryMinImpactSpeed),
      0,
      1,
    );
    const recoveryBlend = Math.max(distanceRecoveryBlend, speedRecoveryBlend);
    const recoverySeconds = THREE.MathUtils.lerp(
      MOVEMENT_TUNING.locomotion.landingRecoveryMinSeconds,
      MOVEMENT_TUNING.locomotion.landingRecoveryMaxSeconds,
      Math.pow(recoveryBlend, 0.82),
    );
    const ragdollLanding = damage >= RAGDOLL_LANDING_DAMAGE_THRESHOLD
      || recoveryBlend >= RAGDOLL_LANDING_RECOVERY_BLEND_THRESHOLD;
    if (ragdollLanding) {
      // Hard Landing was visually unstable. Medium/heavy landings now hand the
      // already-evaluated pose straight to the living ragdoll, while genuinely
      // small falls still keep Falling Idle -> Falling To Landing.
      const landedState = this.player?.getDebugState();
      const horizontalSpeed = landedState
        ? Math.hypot(landedState.velocity.x, landedState.velocity.z)
        : 0;
      const knock = landedState
        ? new THREE.Vector3(
            landedState.velocity.x * 0.10,
            -THREE.MathUtils.clamp(0.75 + impact.impactSpeed * 0.045, 0.9, 1.65),
            landedState.velocity.z * 0.10,
          )
        : new THREE.Vector3(0, -1.0, 0);
      this.startRagdoll({
        fatal: false,
        addedVelocity: knock,
        addedYawRate: THREE.MathUtils.clamp(horizontalSpeed * 0.08, 0, 0.55),
        status: 'RAGDOLL · RÉCEPTION LOURDE',
      });
      return;
    }

    const landingId: AnimationId = 'falling-to-landing';
    const landingClipDuration = this.animations.get(landingId)?.clip.duration ?? recoverySeconds;
    this.landingAnimationRate = THREE.MathUtils.clamp(landingClipDuration / recoverySeconds, 0.9, 6.0);
    // Small falls keep the authored landing, but trim its settled tail so control
    // returns quickly instead of turning an ordinary drop into a knockdown.
    this.landingAnimationEndFraction = THREE.MathUtils.lerp(0.68, 0.98, Math.pow(recoveryBlend, 0.72));
    const effectiveLandingSeconds = (landingClipDuration * this.landingAnimationEndFraction)
      / Math.max(0.01, this.landingAnimationRate);
    this.landingAnimationPending = landingId;
    this.player?.beginLandingRecovery(Math.max(0.08, effectiveLandingSeconds), Math.max(0.28, strength));
    this.autoOneShot = null;
    this.pendingStrongTurn = null;
    this.clearAuthoredTurn();
    this.playbackMode = 'auto';
    this.modeButton?.classList.add('is-active');
  }

  private calculateFallDamage(impact: LandingImpact): number {
    const distanceRange = Math.max(
      0.01,
      MOVEMENT_TUNING.locomotion.highFallImpactDistance - MOVEMENT_TUNING.locomotion.fallDamageStartDistance,
    );
    const speedRange = Math.max(
      0.01,
      MOVEMENT_TUNING.locomotion.highFallImpactSpeed - MOVEMENT_TUNING.locomotion.fallDamageStartImpactSpeed,
    );
    const distanceBlend = THREE.MathUtils.clamp(
      (impact.fallDistance - MOVEMENT_TUNING.locomotion.fallDamageStartDistance) / distanceRange,
      0,
      1,
    );
    const speedBlend = THREE.MathUtils.clamp(
      (impact.impactSpeed - MOVEMENT_TUNING.locomotion.fallDamageStartImpactSpeed) / speedRange,
      0,
      1,
    );
    const blend = Math.max(distanceBlend, speedBlend);
    if (blend <= 0) return 0;
    return Math.round(5 + Math.pow(blend, 1.35) * 67);
  }

  private applyDamage(amount: number): void {
    if (amount <= 0 || this.ragdoll || !this.player || this.player.isIncapacitated) return;
    this.health = THREE.MathUtils.clamp(this.health - amount, 0, MAX_HEALTH);
    this.secondsSinceDamage = 0;
    this.damageFlash = Math.max(this.damageFlash, THREE.MathUtils.clamp(0.34 + amount / 68, 0, 1));
    this.updateHealthUi();
    if (this.health > 0) return;
    this.resetCombatState(true);

    // Health depletion on a landing reuses the proven heavy-impact pipeline so
    // the corpse is created from the authored floor pose instead of ragdolling
    // violently from a half-finished Falling Idle frame.
    this.severeImpactLocked = true;
    this.landingAnimationPending = null;
    this.landingAnimationRate = 1;
    this.landingAnimationEndFraction = 1;
    this.player.setIncapacitated(true);
    this.autoOneShot = null;
    this.pendingStrongTurn = null;
    this.clearAuthoredTurn();
    this.playbackMode = 'auto';
    this.modeButton?.classList.add('is-active');
  }

  private updateHealth(delta: number): void {
    this.damageFlash *= Math.exp(-Math.max(0, delta) * DAMAGE_OVERLAY_DECAY);
    this.firstPersonMeleeHitBloodFlash *= Math.exp(-Math.max(0, delta) * FIRST_PERSON_MELEE_HIT_BLOOD_DECAY);
    const canRegenerate = !this.ragdoll && !!this.player && !this.player.isIncapacitated;
    if (canRegenerate) {
      this.secondsSinceDamage += delta;
      if (this.health < MAX_HEALTH && this.secondsSinceDamage >= HEALTH_REGEN_DELAY_SECONDS) {
        this.health = Math.min(MAX_HEALTH, this.health + HEALTH_REGEN_PER_SECOND * delta);
      }
    }

    // Injury presentation is HP-threshold based instead of timer based. Blood
    // and desaturation therefore stay on screen until regeneration has actually
    // crossed back above their thresholds. The short flash is only the fresh hit.
    const firstPersonDamagePresentation = this.viewMode === 'first-person';
    const thirdPersonDead = this.health <= 0 && !firstPersonDamagePresentation;
    const visual = damageVisualState(
      thirdPersonDead ? MAX_HEALTH : this.health,
      MAX_HEALTH,
      firstPersonDamagePresentation,
    );
    // Fresh hits still punch briefly, but the persistent layer is driven by HP.
    // Keep the flash dark/subtle; the old bright-red full-screen overlay read as
    // an arcade damage shader rather than blood on the lens/face.
    const flashBlood = Math.max(
      this.damageFlash * 0.18,
      this.firstPersonMeleeHitBloodFlash * 0.34,
    );
    const opacity = firstPersonDamagePresentation
      ? Math.max(visual.bloodOpacity, flashBlood)
      : 0;
    this.damageFx.style.setProperty('--damage-opacity', opacity.toFixed(3));
    this.damageFx.style.setProperty('--blood-scale', visual.bloodScale.toFixed(3));
    this.damageFx.style.setProperty(
      '--hit-blood-opacity',
      (firstPersonDamagePresentation ? this.firstPersonMeleeHitBloodFlash * 0.78 : 0).toFixed(3),
    );
    this.damageFx.style.setProperty('--hit-blood-side', this.firstPersonMeleeHitBloodSide.toFixed(3));
    this.root.style.setProperty('--injury-gray', visual.grayscale.toFixed(3));
    this.root.style.setProperty('--injury-saturation', visual.saturation.toFixed(3));
    this.root.style.setProperty('--injury-vignette', visual.vignette.toFixed(3));
    this.root.style.setProperty('--injury-contrast', visual.contrast.toFixed(3));
    this.root.style.setProperty('--injury-brightness', visual.brightness.toFixed(3));
    this.root.style.setProperty('--death-veil', visual.deathVeil.toFixed(3));
    this.updateHealthUi();
  }

  private updateHealthUi(): void {
    const rounded = Math.round(this.health);
    const stat = this.stats.get('health');
    if (stat) stat.textContent = `${rounded} / ${MAX_HEALTH}`;
  }

  private chooseAirborneAnimation(speed: number, forwardSpeed: number, verticalSpeed: number): AnimationId {
    // A real upward take-off may use Jumping Up. Walking off a ledge must not:
    // that used to play an ascent animation while the capsule was already
    // descending. Ledge drops start from the generic/running jump base and the
    // procedural fall layer progressively takes over on long descents.
    if (verticalSpeed <= 0.75) {
      return speed > MOVEMENT_TUNING.locomotion.walkSpeed * 1.35 ? 'running-jump' : 'jump';
    }
    // Jump choice is captured once at take-off and kept for the whole airborne
    // phase, so slowing near the apex cannot swap Running Jump -> Jumping Up.
    if (speed < 0.68) return 'jumping-up';
    if (forwardSpeed < -0.48) return 'jump-backward';
    if (speed > MOVEMENT_TUNING.locomotion.walkSpeed * 1.45) return 'running-jump';
    return 'jump';
  }

  private updateAutoAnimation(delta: number, force = false): void {
    if (!this.player || !this.ready || this.playbackMode !== 'auto') return;
    const state = this.player.getDebugState();
    const intent = this.player.getMovementIntent();
    this.visualMovementRightIntent = this.forwardLateralAnimationGate.update(
      intent.forward,
      intent.right,
      delta,
    );
    const velocity = new THREE.Vector3(state.velocity.x, 0, state.velocity.z);
    const speed = state.horizontalSpeed;

    if (this.severeImpactLocked || state.incapacitated) {
      const impactId: AnimationId = 'falling-flat-impact';
      if (this.currentAnimation !== impactId) {
        this.playAutoImmediate(impactId, false, 1);
        return;
      }
      if (this.animationStillPlaying(impactId, 0.018)) return;

      // The authored heavy-impact clip has already placed the body on the floor.
      // Hand that exact terminal pose to a quiet ragdoll: no extra death kick,
      // no artificial tipping, only gravity for any genuinely unsupported limb.
      this.killPlayer({ quietStart: true });
      return;
    }

    if (this.landingAnimationPending) {
      const landingId = this.landingAnimationPending;
      if (this.currentAnimation !== landingId) this.playAutoImmediate(landingId, false, this.landingAnimationRate);
      const landingClip = this.animations.get(landingId)?.clip;
      const landingCutoff = landingClip
        ? Math.max(0.04, landingClip.duration * this.landingAnimationEndFraction)
        : 0;
      if (this.currentAnimation === landingId && this.currentAction && this.currentAction.time < landingCutoff) return;
      this.landingAnimationPending = null;
      this.landingAnimationRate = 1;
      this.landingAnimationEndFraction = 1;
      this.markStandingIdleResume('action');
    }

    if (this.updateGroundKick(delta)) return;
    if (this.updateCombatMelee(delta)) return;
    if (this.updateCombatGuard(delta)) return;

    this.bodyForward.set(Math.sin(this.avatarAnchor.rotation.y), 0, Math.cos(this.avatarAnchor.rotation.y)).normalize();
    this.bodyRight.crossVectors(this.bodyForward, UP).normalize();
    const forwardSpeed = velocity.dot(this.bodyForward);
    const rightSpeed = velocity.dot(this.bodyRight);

    // Treat slide/low posture as the same low silhouette for edge detection.
    // That prevents a slide ending into low posture from incorrectly
    // firing Standing -> Crouched after the slide animation.
    const lowVisual = state.crouching || state.lowPosture || state.sliding;
    let enteredLow = false;
    let exitedLow = false;
    if (!this.postureStateInitialized) {
      this.postureStateInitialized = true;
      this.wasLowVisual = lowVisual;
    } else {
      enteredLow = lowVisual && !this.wasLowVisual;
      exitedLow = !lowVisual && this.wasLowVisual;
      this.wasLowVisual = lowVisual;
    }

    // Highest priority: keep the authored low/near-prone slide intact. Only
    // when the source Hips have clearly entered their stand-up recovery do we
    // begin a real crossfade to Crouch Idle. This avoids both failure modes:
    // no early frozen prone pose, and no fully-standing terminal FBX frame.
    if (state.sliding) {
      this.markStandingIdleResume('action');
      this.wasAirborne = false;
      this.airborneAnimation = null;
      this.airborneAnimationRate = 1;
      this.autoOneShot = null;
      this.clearAuthoredTurn();
      this.pendingStrongTurn = null;
      if (!this.wasSliding) {
        this.wasSliding = true;
        this.slideVisualSettled = false;
      }
      const slideClip = this.animations.get('running-slide')?.clip;
      const continueSprint = this.player.isSprintRequested()
        && intent.forward >= MOVEMENT_TUNING.posture.sprintRiseForwardThreshold;
      const rate = slideClip
        ? THREE.MathUtils.clamp((continueSprint ? this.slideRecoveryBlendStart : slideClip.duration) / MOVEMENT_TUNING.slide.duration, 0.78, 1.55)
        : 1;
      if (!this.slideVisualSettled && this.currentAnimation === 'running-slide' && this.currentAction) {
        const blendStart = this.slideRecoveryBlendStart > 0
          ? this.slideRecoveryBlendStart
          : (slideClip?.duration ?? 1) * 0.73;
        if (!continueSprint && this.currentAction.time >= blendStart) this.slideVisualSettled = true;
      }
      if (this.slideVisualSettled) this.playAutoImmediate('crouch-idle', true, 1);
      else this.playAutoImmediate('running-slide', false, rate);
      return;
    }
    if (this.wasSliding) {
      this.wasSliding = false;
      this.slideVisualSettled = false;
      if (state.grounded && this.player.isSprintRequested()
        && intent.forward >= MOVEMENT_TUNING.posture.sprintRiseForwardThreshold
        && !state.crouching && this.slideRecoverySource) {
        this.autoOneShot = 'slide-to-running';
        this.playAutoImmediate('slide-to-running', false, 1);
        return;
      }
    }

    if (state.airborne) {
      const enteringAirborne = !this.wasAirborne;
      const highFallRagdoll = state.falling && (
        state.fallDistance >= MOVEMENT_TUNING.locomotion.highFallAnimationStartDistance
        || state.verticalSpeed <= -MOVEMENT_TUNING.locomotion.highFallAnimationStartSpeed
      );
      if (highFallRagdoll) {
        // The old Fall High clip is intentionally gone. Once a descent reaches
        // that former threshold, physics owns the body and the existing living
        // ragdoll impact/damage/get-up pipeline takes over.
        this.wasAirborne = false;
        this.airborneAnimation = null;
        this.airborneAnimationRate = 1;
        this.autoOneShot = null;
        this.clearAuthoredTurn();
        this.pendingStrongTurn = null;
        this.startRagdoll({ fatal: false, status: 'RAGDOLL · CHUTE IMPORTANTE' });
        return;
      }

      const regularFallVisual = state.falling
        && state.fallDistance >= MOVEMENT_TUNING.locomotion.fallAnimationStartDistance;

      let airborneId: AnimationId;
      let airborneLoop = false;
      if (regularFallVisual) {
        airborneId = 'falling-idle';
        airborneLoop = true;
        this.airborneAnimationRate = 1;
      } else {
        airborneId = (enteringAirborne || !this.airborneAnimation || this.airborneAnimation === 'falling-idle')
          ? this.chooseAirborneAnimation(speed, forwardSpeed, state.verticalSpeed)
          : this.airborneAnimation;
      }

      if (enteringAirborne) {
        // Normal jumps keep their authored jump clip. Only a real descent that
        // exceeds the fall threshold switches into Falling Idle / Falling.
        this.markStandingIdleResume(airborneId === 'jumping-up' ? 'sleeping' : 'action');
        const loadedJump = this.animations.get(airborneId);
        this.airborneAnimationRate = airborneId === 'running-jump' ? 1.08 : 1;
        if (airborneId === 'jumping-up' && loadedJump) {
          const gravity = MOVEMENT_TUNING.locomotion.gravity;
          const launchVerticalSpeed = Math.max(0.1, state.verticalSpeed + gravity * delta);
          const expectedAirSeconds = Math.max(0.34, (2 * launchVerticalSpeed) / gravity);
          this.airborneAnimationRate = THREE.MathUtils.clamp(
            loadedJump.clip.duration / expectedAirSeconds,
            0.72,
            2.8,
          );
        }
      }

      this.airborneAnimation = airborneId;
      this.wasAirborne = true;
      this.autoOneShot = null;
      this.clearAuthoredTurn();
      this.pendingStrongTurn = null;
      this.playAutoImmediate(airborneId, airborneLoop, this.airborneAnimationRate);
      return;
    }
    this.wasAirborne = false;
    this.airborneAnimation = null;
    this.airborneAnimationRate = 1;

    // Dedicated posture transitions are useful when the player changes stance
    // while nearly stationary. Crouch always arms Action Idle for when the
    // player later returns to a standing rest state.
    if (enteredLow && speed < 1.05 && !state.sliding) {
      this.markStandingIdleResume('action');
      this.autoOneShot = 'standing-to-crouched';
      this.playAutoImmediate('standing-to-crouched', false, 1.08);
      return;
    }
    if (exitedLow && speed < 1.05 && state.grounded) {
      this.markStandingIdleResume('action');
      this.autoOneShot = 'crouched-to-standing';
      this.playAutoImmediate('crouched-to-standing', false, 1.1);
      return;
    }
    // A stationary turn request owns the animation slot immediately. Idle waits,
    // looking clips and the Action->Sleeping bridge must not keep playing while
    // body-follow is already rotating the pelvis, otherwise a gentle mouse sweep
    // visibly slides the feet until that unrelated one-shot happens to finish.
    if (this.pendingStrongTurn && this.autoOneShot && !isTurnAnimation(this.autoOneShot)) {
      this.autoOneShot = null;
      this.idleSequenceOneShot = null;
    }

    if (this.autoOneShot && isTurnAnimation(this.autoOneShot) && (Math.abs(intent.forward) > 0.05 || Math.abs(intent.right) > 0.05)) {
      // Movement input owns the body immediately. A stationary turn-in-place
      // must never keep playing over a forward launch, otherwise the capsule can
      // move correctly while the avatar still looks sideways/backwards.
      this.autoOneShot = null;
      this.clearAuthoredTurn();
    }
    if (this.autoOneShot) {
      if (this.autoOneShot === 'slide-to-running') {
        if (!state.crouching && !state.lowPosture && this.animationStillPlaying('slide-to-running', 0)) return;
        this.autoOneShot = null;
      }
      if (this.autoOneShot && isTurnAnimation(this.autoOneShot)) {
        // A turn may not be cut immediately by new movement input. First let
        // the clip reach its readable turning phase and let the physical body
        // yaw cover a minimum angle; after that locomotion may take over.
        if (this.authoredTurnMustHold()) return;
        const mayFinishNaturally = speed < 0.3 && !state.crouching && !state.lowPosture;
        // 1P turns are synchronized to the procedural body yaw: once the POV
        // has been recovered and a readable amount of footwork has played, fade
        // out immediately instead of waiting through a long FBX tail.
        if (this.viewMode !== 'first-person' && mayFinishNaturally && this.currentAutoOneShotStillPlaying()) return;
        const finishedTurn = this.autoOneShot;
        const resumeMode = this.activeTurnResumeMode;
        this.autoOneShot = null;
        this.clearAuthoredTurn();
        if (
          this.viewMode === 'first-person'
          && resumeMode === 'action'
          && finishedTurn !== null
          && isActionIdleTurn(finishedTurn)
          && !this.bodyTurning
          && Math.abs(this.lookOffsetDegrees) <= FIRST_PERSON_BODY_LOOK_TUNING.idleActionTurnStopDegrees + 0.5
          && speed < 0.3
          && !state.crouching
          && !state.lowPosture
        ) {
          // Do not mechanically restore idle-action after a successful turn. If
          // the POV is already inside the allowed free-look arc, the final turn
          // stance is a perfectly valid stationary Action-Idle pose.
          this.holdSettledActionTurnPose(finishedTurn);
        }
        if (resumeMode === 'sleeping') this.idleLookMovedThisFrame = false;
      } else if (this.autoOneShot) {
        const mayHold = speed < 1.45;
        if (mayHold && this.currentAutoOneShotStillPlaying()) return;
        this.autoOneShot = null;
      }
    }

    if (state.crouching || state.lowPosture) {
      this.markStandingIdleResume('action');
      this.pendingStrongTurn = null;
      let id: AnimationId = 'crouch-idle';
      let rate = 1;
      const crouchMoveIntent = Math.abs(intent.forward) > 0.05 || Math.abs(intent.right) > 0.05;
      const continuingStep = isCycleLocomotionAnimation(this.currentAnimation) && this.currentAnimation.startsWith('crouch-');
      if (crouchMoveIntent && speed < 0.06 && continuingStep) {
        // Velocity crosses zero during an intentional reversal. Retain the
        // placement phase through that crossing instead of entering idle and
        // resetting a still-visible gait on the very next physics tick.
        this.requestAutoAnimation(this.currentAnimation, true, 0.16,
          (this.currentAction?.getEffectiveTimeScale() ?? 1) < 0, delta, force);
        return;
      }
      if ((crouchMoveIntent || continuingStep) && speed >= 0.06
        && Math.abs(forwardSpeed) > 0.12 && Math.abs(rightSpeed) > Math.abs(forwardSpeed) * 0.30
        && Math.abs(rightSpeed) < Math.abs(forwardSpeed) * 1.35) {
        id = forwardSpeed > 0
          ? (rightSpeed > 0 ? 'crouch-forward-right' : 'crouch-forward-left')
          : (rightSpeed > 0 ? 'crouch-backward-right' : 'crouch-backward-left');
      } else if ((crouchMoveIntent || continuingStep) && speed >= 0.06 && Math.abs(rightSpeed) > Math.max(0.06, Math.abs(forwardSpeed) * 1.15)) {
        id = rightSpeed > 0 ? 'crouch-strafe-right' : 'crouch-strafe-left';
      } else if ((crouchMoveIntent || continuingStep) && speed >= 0.06) {
        id = forwardSpeed < -0.18 ? 'crouch-backward' : 'crouch-walking';
      }
      if (id !== 'crouch-idle') rate = THREE.MathUtils.clamp(speed
        / (this.crouchGaitReferenceSpeeds.get(id) ?? CROUCH_GAIT_REFERENCE_SPEED), 0.16, 1.65);
      if (crouchMoveIntent && speed >= 0.06 && this.currentAnimation === 'crouch-idle') {
        // Begin a double-support placement immediately at low cadence. The
        // 300 ms complete-pose blend includes idle and can be interrupted.
        this.playAutoImmediate(id, true, rate, false);
      } else this.requestAutoAnimation(id, true, rate, false, delta, force);
      return;
    }

    const standingMoveIntent = Math.abs(intent.forward) > 0.05 || Math.abs(intent.right) > 0.05;
    if (speed < 0.08 && !standingMoveIntent) {
      // New Action-Idle turns are AUTO-only for genuine reorientation. Normal
      // and Big variants are selected from the look angle in ThirdPersonLook.
      // Root rotation is stripped: PlayerController/body yaw stays authoritative.
      if (this.pendingStrongTurn) {
        const turnId = this.pendingStrongTurn;
        this.pendingStrongTurn = null;
        this.startAuthoredTurn(turnId);
        return;
      }
      this.updateStandingIdleSequence(delta, force);
      return;
    }

    // Any real standing locomotion arms Action Idle for the next stop and
    // interrupts waits/idle transitions immediately.
    this.markStandingIdleResume('action');
    this.pendingStrongTurn = null;
    this.clearAuthoredTurn();

    let id: AnimationId;
    let rate = 1;
    let reverse = false;
    // Feet follow the actual travel vector through acceleration, braking and
    // reversals. Run entry has speed hysteresis, so pressing Shift at rest
    // cannot instantly play a full sprint over a nearly stationary capsule.
    const bodyViewOffsetDegrees = Math.abs(THREE.MathUtils.radToDeg(
      wrapAngleRadians(this.continuousViewYaw - this.bodyYaw),
    ));
    const bodyCatchupActive = bodyViewOffsetDegrees > 24;
    const travelForward = speed > 0.32 ? forwardSpeed / speed : intent.forward;
    const travelRight = speed > 0.32 ? rightSpeed / speed : this.visualMovementRightIntent;
    const lateralIntent = Math.abs(travelRight) > 0.54;
    this.visualRunning = speed > (this.visualRunning ? 3.10 : 3.75) && forwardSpeed > 0.25;
    const diagonalIntent = forwardDiagonalAnimation(
      travelForward,
      travelRight,
      this.visualRunning,
    );
    const sprintFacingReady = this.visualRunning && bodyViewOffsetDegrees <= 62;

    if (sprintFacingReady && diagonalIntent?.startsWith('running-forward-')) {
      // Z+Q / Z+D gets its own generated run cycle: forward run cadence remains
      // dominant while the lower body borrows enough strafe motion to read as
      // a real diagonal rather than snapping between "straight" and "sideways".
      id = diagonalIntent;
      rate = THREE.MathUtils.clamp(speed / RUN_GAIT_REFERENCE_SPEED, 0.35, 1.45);
    } else if (sprintFacingReady) {
      // Once the torso is reasonably aligned, sprint uses the authored forward
      // run. Before that point, backward/strafe walk cycles keep the feet honest
      // while the body turns toward the camera-relative travel direction.
      id = 'running';
      rate = THREE.MathUtils.clamp(speed / RUN_GAIT_REFERENCE_SPEED, 0.35, 1.45);
    } else if (!bodyCatchupActive && diagonalIntent?.startsWith('walking-forward-')) {
      id = diagonalIntent;
      rate = THREE.MathUtils.clamp(speed / WALK_GAIT_REFERENCE_SPEED, 0.16, 1.45);
    } else if (lateralIntent) {
      const strafeRight = travelRight > 0;
      id = strafeRight ? 'right-strafe-walking' : 'left-strafe-walking';
      rate = THREE.MathUtils.clamp(speed / WALK_GAIT_REFERENCE_SPEED, 0.16, 1.6);
    } else if (state.sprinting && bodyCatchupActive) {
      id = 'walking';
      reverse = forwardSpeed < -0.12;
      rate = THREE.MathUtils.clamp(speed / WALK_GAIT_REFERENCE_SPEED, 0.16, 1.65);
    } else if (speed > MOVEMENT_TUNING.locomotion.walkSpeed * 1.38) {
      id = 'running';
      reverse = forwardSpeed < -0.2;
      rate = THREE.MathUtils.clamp(speed / RUN_GAIT_REFERENCE_SPEED, 0.35, 1.45);
    } else {
      id = 'walking';
      reverse = forwardSpeed < -0.12;
      rate = THREE.MathUtils.clamp(speed / WALK_GAIT_REFERENCE_SPEED, 0.16, 1.45);
    }

    if (this.currentAnimation === 'slide-to-running') {
      // The recovery ends on the next foot phase; do not hold its final frame
      // through the ordinary locomotion candidate debounce.
      this.playAutoImmediate(id, true, rate, reverse);
    } else if (standingMoveIntent && speed < 0.24 && !isCycleLocomotionAnimation(this.currentAnimation)) {
      // Begin a slow placement step immediately; cadence grows with speed.
      // Repeated input frames must not bypass the rate smoothing below.
      this.playAutoImmediate(id, true, rate, reverse);
    } else {
      this.requestAutoAnimation(id, true, rate, reverse, delta, force);
    }
  }

  private applyLocomotionWeightShift(delta: number): void {
    if (!this.player) return;
    const state = this.player.getDebugState();
    const velocity = new THREE.Vector3(state.velocity.x, 0, state.velocity.z);
    const acceleration = velocity.clone().sub(this.locomotionPreviousVelocity).divideScalar(Math.max(delta, 1 / 240));
    this.locomotionPreviousVelocity.copy(velocity);
    const gait = isCycleLocomotionAnimation(this.currentAnimation) || this.currentAnimation === 'idle-action' || this.currentAnimation === 'crouch-idle';
    const active = gait && state.grounded && this.combatPhase === 'none' && !this.combatHitReaction && !this.groundKick;
    const forward = new THREE.Vector3(Math.sin(this.bodyYaw), 0, Math.cos(this.bodyYaw));
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    const pitch = active ? THREE.MathUtils.clamp(acceleration.dot(forward) * 0.004, -0.065, 0.075) : 0;
    const roll = active ? THREE.MathUtils.clamp(-acceleration.dot(right) * 0.0035, -0.055, 0.055) : 0;
    this.locomotionPitch = THREE.MathUtils.lerp(this.locomotionPitch, pitch, expAlpha(delta, 9));
    this.locomotionRoll = THREE.MathUtils.lerp(this.locomotionRoll, roll, expAlpha(delta, 9));
    if (!active) return;
    for (const [lower, upper] of [[this.combatSpineBone, this.combatSpine1Bone],
      [this.firstPersonCombatSpineBone, this.firstPersonCombatSpine1Bone]]) {
      this.applyWorldAxisOffset(lower, right, this.locomotionPitch * 0.45);
      this.applyWorldAxisOffset(upper, right, this.locomotionPitch * 0.55);
      this.applyWorldAxisOffset(lower, forward, this.locomotionRoll * 0.45);
      this.applyWorldAxisOffset(upper, forward, this.locomotionRoll * 0.55);
    }
  }

  private applyLocomotionFootPlants(delta: number): void {
    const state = this.player?.getDebugState();
    const postureGait = this.currentAnimation === 'standing-to-crouched' || this.currentAnimation === 'crouched-to-standing';
    const authoredCrouch = this.currentAnimation === 'crouch-idle' || this.currentAnimation === 'crouch-walking'
      || this.currentAnimation === 'crouch-backward';
    const crouchGait = (this.currentAnimation.startsWith('crouch-') && !authoredCrouch) || postureGait;
    const active = state?.grounded && (state.horizontalSpeed > 0.12 || crouchGait) && this.combatPhase === 'none'
      && (isCycleLocomotionAnimation(this.currentAnimation) || this.currentAnimation === 'crouch-idle' || postureGait)
      && !authoredCrouch && !this.groundKick && !this.combatHitReaction;
    if (!active) {
      for (const plant of this.gaitFootPlants) { plant.locked = false; plant.weight = 0; }
      return;
    }
    const legs = [[this.leftUpperLegBone, this.leftLowerLegBone, this.leftFootBone],
      [this.rightUpperLegBone, this.rightLowerLegBone, this.rightFootBone]];
    const firstLegs = [[this.firstPersonLeftUpperLegBone, this.firstPersonLeftLowerLegBone, this.firstPersonLeftFootBone],
      [this.firstPersonRightUpperLegBone, this.firstPersonRightLowerLegBone, this.firstPersonRightFootBone]];
    const forward = new THREE.Vector3(Math.sin(this.bodyYaw), 0, Math.cos(this.bodyYaw));
    this.avatarAnchor.updateMatrixWorld(true);
    const contactTargets: Array<{ point: THREE.Vector3; rotation: THREE.Quaternion; weight: number } | undefined> = [];
    for (let i = 0; i < legs.length; i++) {
      const [upper, lower, foot] = legs[i]!;
      if (!upper || !lower || !foot) continue;
      const plant = this.gaitFootPlants[i]!;
      const ankle = foot.getWorldPosition(new THREE.Vector3());
      const height = ankle.y - this.avatarAnchor.position.y;
      const hip = upper.getWorldPosition(new THREE.Vector3());
      const knee = lower.getWorldPosition(new THREE.Vector3());
      const reach = hip.distanceTo(knee) + knee.distanceTo(ankle);
      if (plant.locked && (height > (crouchGait ? 0.115 : 0.155) || hip.distanceTo(plant.point) > reach * 0.997
        || Math.abs(plant.point.y - ankle.y) > 0.10
        || (crouchGait && Math.hypot(plant.point.x - ankle.x, plant.point.z - ankle.z) > 0.09))) plant.locked = false;
      if (!plant.locked && plant.weight < 0.02 && height < 0.105) {
        plant.point.copy(ankle); plant.locked = true;
      }
      const plantResponse = crouchGait ? (plant.locked ? 28 : 18) : (plant.locked ? 40 : 26);
      plant.weight = THREE.MathUtils.lerp(plant.weight, plant.locked ? 1 : 0, expAlpha(delta, plantResponse));
      if (!crouchGait && plant.weight < 0.002) continue;
      const rotation = foot.getWorldQuaternion(new THREE.Quaternion());
      // Loaded walking knees approach extension more closely than striking
      // knees; retain a small bend without shortening the supporting leg.
      // A deep knee bend cannot fade through quaternion space without its ankle
      // tracing an arc below the floor. Fade the contact point instead, then
      // solve the crouched chain onto that continuous, supported trajectory.
      const target = crouchGait ? ankle.clone().lerp(plant.point, plant.weight) : plant.point;
      if (crouchGait) {
        // A rolling foot lifts its ankle while its sole stays on the plane.
        // Horizontal planting must not cancel that lift and bury the toes.
        target.y = ankle.y;
        const toe = findBoneBySuffix(foot, 'toeend');
        const toeY = toe?.getWorldPosition(new THREE.Vector3()).y ?? ankle.y;
        if (postureGait) {
          // A valid baked pose can still sink or float during its crossfade
          // from standing. Re-solve the blended sole, including a rolling heel.
          const heelY = ankle.y + this.locomotionHeelLocal[i]!.clone().applyQuaternion(rotation).y;
          target.y += this.avatarAnchor.position.y + 0.002 - Math.min(toeY, heelY);
        } else target.y += Math.max(0, this.avatarAnchor.position.y + 0.004 - toeY,
          this.avatarAnchor.position.y + this.firstPersonFootToSole - ankle.y);
      }
      contactTargets[i] = { point: target, rotation, weight: crouchGait ? 1 : plant.weight };
    }
    const a = contactTargets[0], b = contactTargets[1];
    if (crouchGait && a && b) {
      const axis = a.point.clone().sub(b.point); axis.y = 0;
      const distance = axis.length();
      if (distance < 0.145) {
        if (distance > 1e-5) axis.divideScalar(distance);
        else axis.copy(forward);
        // Crossfading two valid steps can still sweep one shoe through the
        // other. Keep the loaded foot and route the recovering foot around it.
        const leftFree = 1 - this.gaitFootPlants[0]!.weight + Math.max(0, a.point.y - b.point.y) * 8;
        const rightFree = 1 - this.gaitFootPlants[1]!.weight + Math.max(0, b.point.y - a.point.y) * 8;
        const share = (leftFree + 0.05) / (leftFree + rightFree + 0.10);
        a.point.addScaledVector(axis, (0.145 - distance) * share);
        b.point.addScaledVector(axis, -(0.145 - distance) * (1 - share));
      }
    }
    for (let i = 0; i < legs.length; i++) {
      const [upper, lower, foot] = legs[i]!, target = contactTargets[i];
      if (!upper || !lower || !foot || !target) continue;
      solveCombatTwoBone(upper, lower, foot, target.point, target.weight, crouchGait ? undefined : forward, 0.997,
        crouchGait ? 0 : Math.PI);
      const parent = foot.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
      foot.quaternion.copy(parent.multiply(target.rotation)).normalize();
      // Both views use the same lower-body solve and preserve the animated sole.
      for (let joint = 0; joint < 3; joint++) {
        firstLegs[i]![joint]?.quaternion.copy(legs[i]![joint]!.quaternion);
      }
    }
    this.avatarAnchor.updateMatrixWorld(true);
  }

  private beginActionFacingReturn(): void {
    this.actionFacingReturnActive = true;
    this.actionFacingReturnSeconds = 0;
    this.pendingStrongTurn = null;
    this.strongTurnLatched = false;
    this.clearAuthoredTurn();
    if (this.headBone) {
      const face = this.combatHeadLocalForward.clone()
        .applyQuaternion(this.headBone.getWorldQuaternion(new THREE.Quaternion()));
      this.combatGazeYaw = Math.atan2(face.x, face.z);
    }
  }

  private updateAvatarTransform(delta: number, snap = false): void {
    if (!this.physics || !this.player) return;
    if (snap) this.physics.getFeetPosition(this.feetPosition);
    else this.player.getRenderedFeetPosition(this.feetPosition);
    const state = this.player.getDebugState();
    // PointerLockControls yaw is the sole aiming authority. Convert its continuous
    // camera-space yaw to the avatar convention (+Z = 0, default -Z = π). Body
    // turns and authored FBX clips may chase this value but never feed back into it.
    const aimBodyYaw = Math.PI + this.player.getContinuousAimYawRadians();
    this.horizontalForward.set(Math.sin(aimBodyYaw), 0, Math.cos(aimBodyYaw));

    this.avatarAnchor.position.copy(this.feetPosition);
    if (state.incapacitated && !snap) {
      this.bodyTurning = false;
      this.bodyTurnRate = 0;
      this.pendingStrongTurn = null;
      this.clearAuthoredTurn();
      // The impact pose owns the body yaw permanently. The player's clamped
      // pointer-lock look only feeds the neck/head layer while downed.
      this.continuousViewYaw = aimBodyYaw;
      const downedLookOffset = this.continuousViewYaw - this.bodyYaw;
      this.headLookYaw = dampAngleRadians(
        this.headLookYaw,
        THREE.MathUtils.clamp(downedLookOffset, -THREE.MathUtils.degToRad(24), THREE.MathUtils.degToRad(24)),
        expAlpha(delta, 10),
      );
      this.lookOffsetDegrees = THREE.MathUtils.radToDeg(downedLookOffset);
      this.avatarAnchor.rotation.y = this.bodyYaw;
      return;
    }
    if (snap) {
      this.actionFacingReturnActive = false;
      this.actionFacingReturnSeconds = 0;
      this.continuousViewYaw = aimBodyYaw;
      this.bodyYaw = aimBodyYaw;
      this.avatarAnchor.rotation.y = this.bodyYaw;
      this.bodyTurning = false;
      this.bodyTurnRate = 0;
      this.headLookYaw = 0;
      this.lookOffsetDegrees = 0;
      this.idleLookMovedThisFrame = false;
      this.previousIdleLookPitchDegrees = state.view.pitch;
      this.previousLookActivitySerial = this.player.getLookActivitySerial();
      this.pendingStrongTurn = null;
      this.strongTurnLatched = false;
      this.clearAuthoredTurn();
      return;
    }

    // This value is already unbounded and continuous at the input source; no
    // atan2/Euler unwrap is needed here, so repeated authored turns cannot flip
    // the sign of the player's mouse yaw at a ±π boundary. Keep the exact POV
    // delta as well: once a 1P body turn is committed, that delta is fed directly
    // into the pelvis so the body rotates in the same instant as the mouse.
    const previousContinuousViewYaw = this.continuousViewYaw;
    this.continuousViewYaw = aimBodyYaw;
    const firstPersonViewYawDelta = this.continuousViewYaw - previousContinuousViewYaw;
    const pitchDeltaDegrees = state.view.pitch - this.previousIdleLookPitchDegrees;
    this.previousIdleLookPitchDegrees = state.view.pitch;

    // AFK timing is driven by the raw pointer-lock input itself, not only by a
    // frame-to-frame yaw/pitch estimate. That guarantees that even a tiny mouse
    // movement on the exact frame the 2.5 s timer expires cancels Wait1/Wait2
    // and restarts the idle countdown from zero.
    const lookActivitySerial = this.player.getLookActivitySerial();
    const rawPointerLookMoved = lookActivitySerial !== this.previousLookActivitySerial;
    this.previousLookActivitySerial = lookActivitySerial;
    this.idleLookMovedThisFrame = rawPointerLookMoved || (
      Math.abs(THREE.MathUtils.radToDeg(firstPersonViewYawDelta)) > 0.035
      || Math.abs(pitchDeltaDegrees) > 0.035
    );

    const intent = this.player.getMovementIntent();
    const movementIntentActive = Math.abs(intent.forward) > 0.05 || Math.abs(intent.right) > 0.05;
    const moving = movementIntentActive || state.horizontalSpeed > 0.28;
    const sprinting = state.sprinting;

    if (this.actionFacingReturnActive && !this.combatAttack && !this.groundKick) {
      // A completed action hands back its last facing, not the accumulated
      // mouse delta. Follow the shortest arc in both views while the player can
      // keep looking and moving; ordinary free-look resumes after convergence.
      this.actionFacingReturnSeconds += Math.max(0, delta);
      const previousYaw = this.bodyYaw;
      this.bodyYaw = followActionYaw(this.bodyYaw, this.continuousViewYaw, delta, 10, 240);
      // A shortest-arc turn may finish at an equivalent angle one revolution
      // away from the continuous input. Rebase before normal 1P free-look takes
      // over so that it never interprets that equivalent pose as a 360° debt.
      this.bodyYaw = rebaseAngleNear(this.continuousViewYaw, this.bodyYaw);
      const offset = wrapAngleRadians(this.continuousViewYaw - this.bodyYaw);
      this.avatarAnchor.rotation.y = this.bodyYaw;
      this.bodyTurning = Math.abs(offset) > 0.025;
      this.bodyTurnRate = delta > 0 ? THREE.MathUtils.radToDeg(wrapAngleRadians(this.bodyYaw - previousYaw)) / delta : 0;
      this.lookOffsetDegrees = THREE.MathUtils.radToDeg(offset);
      this.headLookYaw = dampAngleRadians(this.headLookYaw,
        this.combatPhase === 'guard' || this.combatPhase === 'enter' ? 0 : THREE.MathUtils.clamp(offset, -0.65, 0.65),
        expAlpha(delta, 8));
      if (this.actionFacingReturnSeconds >= 0.5 && Math.abs(offset) < 0.025
        && Math.abs(firstPersonViewYawDelta) < 0.035 && Math.abs(this.headLookYaw) < 0.035) {
        this.actionFacingReturnActive = false;
      }
      return;
    }

    if (this.autoOneShot === 'slide-to-running' && !state.crouching && !state.airborne) {
      // Lift in the direction of the slide first. Once the hips are upright,
      // smoothly recover the camera direction instead of pivoting on the floor.
      const progress = (this.currentAction?.time ?? 0) / Math.max(0.001, this.currentAction?.getClip().duration ?? 1);
      if (progress > 0.66) this.bodyYaw = followActionYaw(this.bodyYaw, this.continuousViewYaw, delta, 8, 210);
      this.avatarAnchor.rotation.y = this.bodyYaw;
      this.bodyTurning = false;
      this.bodyTurnRate = 0;
      this.lookOffsetDegrees = THREE.MathUtils.radToDeg(wrapAngleRadians(this.continuousViewYaw - this.bodyYaw));
      this.headLookYaw = dampAngleRadians(this.headLookYaw,
        THREE.MathUtils.clamp(wrapAngleRadians(this.continuousViewYaw - this.bodyYaw), -0.7, 0.7), expAlpha(delta, 8));
      this.pendingStrongTurn = null;
      this.clearAuthoredTurn();
      return;
    }

    const combatFacingActive = this.combatAttack !== null
      || this.groundKick !== null
      || this.combatPhase === 'enter'
      || this.combatPhase === 'guard';
    if (combatFacingActive) {
      // Guard catches up at a bounded rate. Strikes and ground kicks own their
      // root yaw for the duration of the move; camera/body follow must not fight
      // that yaw every frame or a moving/downed target can create violent spins.
      if (!this.combatAttack && !this.groundKick) {
        this.bodyYaw = followActionYaw(this.bodyYaw, this.continuousViewYaw, delta, 10, 240);
      }
      this.avatarAnchor.rotation.y = this.bodyYaw;
      this.bodyTurning = false;
      this.bodyTurnRate = 0;
      this.lookOffsetDegrees = 0;
      this.headLookYaw = dampAngleRadians(this.headLookYaw, 0, expAlpha(delta, 18));
      this.pendingStrongTurn = null;
      this.strongTurnLatched = false;
      this.clearAuthoredTurn();
      return;
    }

    if (this.viewMode === 'first-person') {
      // 1P stays visually synced to the POV, but keeps a modest natural glance
      // arc before the pelvis/feet rotate. When that stationary turn commits,
      // pair the procedural yaw with an authored idle-action foot turn: the
      // user-provided LOW clips handle small corrections and the full clips
      // handle large reorientations. Movement never uses these idle turns.
      const signedPreFollowOffsetDegrees = THREE.MathUtils.radToDeg(this.continuousViewYaw - this.bodyYaw);
      const wasBodyTurning = this.bodyTurning;
      const idlePose: IdleResumeMode = this.idleSequencePhase === 'sleeping'
        || this.idleSequencePhase === 'sleeping-look'
        || this.activeTurnResumeMode === 'sleeping' && !!this.activeAuthoredTurn
        ? 'sleeping'
        : 'action';
      if (moving) {
        this.pendingStrongTurn = null;
        this.strongTurnLatched = false;
        this.clearAuthoredTurn();
      } else if (!this.activeAuthoredTurn && !(this.autoOneShot && isTurnAnimation(this.autoOneShot))) {
        // Keep asking for the light cue while a gentle procedural body turn is
        // already underway. This catches slow mouse sweeps that crossed the
        // turn threshold while another idle one-shot occupied the mixer.
        const cue = firstPersonIdleTurnCue(
          signedPreFollowOffsetDegrees,
          false,
          false,
          idlePose,
          wasBodyTurning,
          THREE.MathUtils.radToDeg(firstPersonViewYawDelta),
        );
        if (idlePose === 'sleeping') {
          // Sleeping Idle keeps its own footwork and never jumps back to Action
          // Idle merely because the player turned their head/body.
          if (cue === 'low-left') this.pendingStrongTurn = 'left-turn-90';
          else if (cue === 'low-right') this.pendingStrongTurn = 'right-turn-90';
          else if (cue === 'big-left') this.pendingStrongTurn = 'left-turn';
          else if (cue === 'big-right') this.pendingStrongTurn = 'right-turn';
        } else {
          if (cue === 'low-left') this.pendingStrongTurn = 'idle-turn-left';
          else if (cue === 'low-right') this.pendingStrongTurn = 'idle-turn-right';
          else if (cue === 'big-left') this.pendingStrongTurn = 'idle-big-turn-left';
          else if (cue === 'big-right') this.pendingStrongTurn = 'idle-big-turn-right';
        }
      }
      const follow = updateFirstPersonBodyFollow(
        this.continuousViewYaw,
        this.bodyYaw,
        delta,
        moving,
        sprinting,
        this.bodyTurning,
        firstPersonViewYawDelta,
        idlePose,
      );
      this.bodyYaw = follow.bodyYaw;
      this.bodyTurning = follow.turning;
      this.bodyTurnRate = THREE.MathUtils.lerp(
        this.bodyTurnRate,
        follow.turnRateDegreesPerSecond,
        expAlpha(delta, follow.turning ? 14 : 9),
      );
      this.avatarAnchor.rotation.y = this.bodyYaw;
      this.lookOffsetDegrees = THREE.MathUtils.radToDeg(follow.lookOffsetRadians);
      this.headLookYaw = dampAngleRadians(
        this.headLookYaw,
        THREE.MathUtils.clamp(
          follow.lookOffsetRadians,
          -THREE.MathUtils.degToRad(idlePose === 'action' ? 32 : 42),
          THREE.MathUtils.degToRad(idlePose === 'action' ? 66 : 42),
        ),
        expAlpha(delta, 12),
      );
      return;
    }

    // Movement immediately cancels stationary authored turns, but it must NOT
    // teleport the rendered pelvis to the camera yaw. When the player looks
    // behind them and starts walking, the physical motion remains camera-relative
    // while the body catches up at the normal moving turn rate. The locomotion
    // selector below can therefore show backward/strafe footwork during the
    // catch-up instead of snapping 180 degrees and briefly dropping to idle.
    if (movementIntentActive) {
      this.pendingStrongTurn = null;
      this.strongTurnLatched = false;
      this.clearAuthoredTurn();
    }

    // Rotations separated by whole 360° turns are the same physical body pose.
    // Rebase the numeric body yaw near the continuous camera yaw before measuring
    // the anatomical offset, otherwise several full mouse spins can accumulate a
    // multi-revolution catch-up debt and make the mesh lag/twist later.
    this.bodyYaw = rebaseAngleNear(this.continuousViewYaw, this.bodyYaw);
    let lookOffset = this.continuousViewYaw - this.bodyYaw;
    const signedOffsetDegrees = THREE.MathUtils.radToDeg(lookOffset);
    const absoluteOffsetDegrees = Math.abs(signedOffsetDegrees);

    if (canResetStrongTurnLatch(absoluteOffsetDegrees)) this.strongTurnLatched = false;
    const thirdPersonIdlePose: IdleResumeMode = this.idleSequencePhase === 'sleeping'
      || this.idleSequencePhase === 'sleeping-look'
      || this.activeTurnResumeMode === 'sleeping' && !!this.activeAuthoredTurn
      ? 'sleeping'
      : 'action';
    const strongDirection = strongTurnDirection(
      signedOffsetDegrees,
      this.strongTurnLatched,
      moving,
      state.crouching || state.lowPosture,
    );
    if (strongDirection) {
      let turnId: AnimationId;
      if (thirdPersonIdlePose === 'sleeping') {
        // Mouse-only reorientation is still Sleeping Idle activity. Use the
        // dedicated sleeping footwork and let startAuthoredTurn() preserve the
        // sleeping resume mode when the clip finishes. Only locomotion/gameplay
        // actions are allowed to arm Action Idle.
        if (strongDirection === 'left') turnId = 'left-turn-90';
        else if (strongDirection === 'right') turnId = 'right-turn-90';
        else if (strongDirection === 'big-left') turnId = 'left-turn';
        else turnId = 'right-turn';
      } else {
        if (strongDirection === 'left') turnId = 'idle-turn-left';
        else if (strongDirection === 'right') turnId = 'idle-turn-right';
        else if (strongDirection === 'big-left') turnId = 'idle-big-turn-left';
        else turnId = 'idle-big-turn-right';
      }
      this.pendingStrongTurn = turnId;
      this.strongTurnLatched = true;
    }
    // During an authored strong turn, do NOT use the ordinary stationary
    // residual (~64°). That old rule was the real reason movement could resume
    // while the avatar still faced far sideways. A committed turn must bring the
    // body close to the mouse direction while the authored turn remains active.
    const authoredTurnActive = this.activeAuthoredTurn !== null;
    this.bodyTurning = authoredTurnActive
      ? absoluteOffsetDegrees > THIRD_PERSON_LOOK_TUNING.authoredTurnStopDegrees
      : updateTurnGate(absoluteOffsetDegrees, this.bodyTurning, moving, sprinting);

    let instantaneousTurnRate = 0;
    if (this.bodyTurning && delta > 0) {
      // Once the pelvis has committed to a turn, inherit the live mouse yaw on
      // this same frame. The response term below only consumes the free-look
      // residual. This keeps continuous 360° spins synchronized instead of
      // leaving the body one or more revolutions behind the camera.
      this.bodyYaw += firstPersonViewYawDelta;
      this.bodyYaw = rebaseAngleNear(this.continuousViewYaw, this.bodyYaw);
      lookOffset = this.continuousViewYaw - this.bodyYaw;
      const residualDegrees = authoredTurnActive
        ? THIRD_PERSON_LOOK_TUNING.authoredTurnResidualDegrees
        : residualLookDegrees(moving, sprinting);
      const residual = THREE.MathUtils.degToRad(residualDegrees) * Math.sign(lookOffset || 1);
      const bodyTargetYaw = this.continuousViewYaw - residual;
      const bodyError = bodyTargetYaw - this.bodyYaw;
      const response = authoredTurnActive
        ? THIRD_PERSON_LOOK_TUNING.authoredTurnBodyResponse
        : sprinting
          ? THIRD_PERSON_LOOK_TUNING.sprintBodyResponse
          : moving
            ? THIRD_PERSON_LOOK_TUNING.movingBodyResponse
            : THIRD_PERSON_LOOK_TUNING.idleBodyResponse;
      const maxRateDegrees = authoredTurnActive
        ? THIRD_PERSON_LOOK_TUNING.authoredTurnMaxDegreesPerSecond
        : sprinting
          ? THIRD_PERSON_LOOK_TUNING.sprintMaxTurnDegreesPerSecond
          : moving
            ? THIRD_PERSON_LOOK_TUNING.movingMaxTurnDegreesPerSecond
            : THIRD_PERSON_LOOK_TUNING.idleMaxTurnDegreesPerSecond;
      const proposedStep = bodyError * expAlpha(delta, response);
      const maxStep = THREE.MathUtils.degToRad(maxRateDegrees) * delta;
      const step = THREE.MathUtils.clamp(proposedStep, -maxStep, maxStep);
      this.bodyYaw += step;
      this.avatarAnchor.rotation.y = this.bodyYaw;
      instantaneousTurnRate = THREE.MathUtils.radToDeg(step / delta);
      lookOffset = this.continuousViewYaw - this.bodyYaw;
    }

    this.avatarAnchor.rotation.y = this.bodyYaw;

    this.bodyTurnRate = THREE.MathUtils.lerp(
      this.bodyTurnRate,
      instantaneousTurnRate,
      expAlpha(delta, this.bodyTurning ? 14 : 9),
    );
    this.lookOffsetDegrees = THREE.MathUtils.radToDeg(lookOffset);
    const headTarget = THREE.MathUtils.clamp(
      lookOffset,
      -THREE.MathUtils.degToRad(THIRD_PERSON_LOOK_TUNING.headLimitDegrees),
      THREE.MathUtils.degToRad(THIRD_PERSON_LOOK_TUNING.headLimitDegrees),
    );
    this.headLookYaw = dampAngleRadians(
      this.headLookYaw,
      headTarget,
      expAlpha(delta, THIRD_PERSON_LOOK_TUNING.headResponse),
    );
  }

  private quaternionTwistYaw(quaternion: Readonly<THREE.Quaternion>): number {
    const length = Math.hypot(quaternion.y, quaternion.w);
    if (length < 1e-7) return 0;
    const y = quaternion.y / length;
    const w = quaternion.w / length;
    let angle = 2 * Math.atan2(y, w);
    if (angle > Math.PI) angle -= Math.PI * 2;
    if (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
  }

  /** Bounded analytic arm solve over the authored anticipation and recoil. */
  private solveCombatArmTowardTarget(
    upper: THREE.Bone | undefined, forearm: THREE.Bone | undefined, hand: THREE.Bone | undefined,
    target: Readonly<THREE.Vector3>, reach: number, _heavy: boolean, _counter = false, reachScale = 1,
  ): void {
    if (!upper || !forearm || !hand) return;
    solveCombatTwoBone(upper, forearm, hand, target, Math.min(0.96, reach * reachScale));
  }

  private applyCombatStrikeAimCorrection(): void {
    const attack = this.combatAttack;
    if (!attack) return;
    const normalized = attack.duration > 1e-5
      ? attack.elapsed / attack.duration
      : 1;
    const heavy = attack.kind === 'big-punch';
    const visualProfile = combatAttackVisualProfile(attack.animation);
    const envelope = combatStrikeEnvelope(normalized, heavy, attack.impactFraction);
    const reachEnvelope = combatStrikeReachEnvelope(normalized, heavy, attack.impactFraction);
    if (envelope <= 1e-4 && reachEnvelope <= 1e-4) return;

    // Every rebuilt punch owns a slightly different reach/body profile. The
    // differences are deliberately subtle: enough to make a loop of punches read
    // as a sequence instead of one repeated GIF, but still all travel toward the
    // reticle rather than turning into hooks or sideways noodle motion.
    this.combatStrikeForwardAxis.set(
      Math.sin(this.combatAttackAimYaw),
      0,
      Math.cos(this.combatAttackAimYaw),
    ).normalize();
    this.combatStrikeRightAxis.set(
      Math.cos(this.combatAttackAimYaw),
      0,
      -Math.sin(this.combatAttackAimYaw),
    ).normalize();
    const targetDistance = attack.targetDistanceAtStart;
    const contactReachBoost = Number.isFinite(targetDistance)
      ? THREE.MathUtils.lerp(0.98, 1.20, THREE.MathUtils.smoothstep(targetDistance, 0.82, 1.82))
      : 1.08;
    const reachScale = (visualProfile?.reachMultiplier ?? 1) * contactReachBoost;
    const bodyScale = visualProfile?.bodyMultiplier ?? 1;
    const character = visualProfile?.character ?? 'cross';
    const styleBase = THREE.MathUtils.degToRad(visualProfile?.styleYawDegrees ?? 0);
    const impact = attack.impactFraction;
    const loadStart = Math.max(0.02, impact - 0.34);
    const loadEnd = Math.max(loadStart + 0.04, impact - 0.11);
    const load = normalized <= loadStart
      ? 0
      : normalized < loadEnd
        ? THREE.MathUtils.smoothstep(normalized, loadStart, loadEnd)
        : normalized < impact
          ? 1 - THREE.MathUtils.smoothstep(normalized, loadEnd, impact)
          : 0;
    // Load slightly away from the strike, then rotate through the target. This
    // weight transfer is what makes a cross/overhand read as a real punch rather
    // than the same arm animation played faster.
    const styleYaw = -styleBase * load * (character === 'jab' ? 0.18 : 0.42)
      + styleBase * reachEnvelope * (character === 'jab' ? 0.34 : character === 'compact' ? 0.44 : 0.72);
    const bodyLean = reachEnvelope
      * reachScale
      * bodyScale
      * (heavy ? COMBAT_STRIKE_BODY_LEAN_HEAVY : COMBAT_STRIKE_BODY_LEAN_NORMAL)
      * (character === 'jab' ? 0.62 : character === 'overhand' ? 1.12 : character === 'body' ? 0.90 : 1);

    // Load through the hips, then transfer body weight over the planted feet.
    // This advances the shoulder naturally instead of stretching the arm or
    // giving every click the same floating, arm-only extension.
    if (this.hipsBone?.parent) {
      const feet = [
        [this.leftUpperLegBone, this.leftLowerLegBone, this.leftFootBone],
        [this.rightUpperLegBone, this.rightLowerLegBone, this.rightFootBone],
      ].filter((chain): chain is THREE.Bone[] => chain.every(Boolean)).map(chain => ({
        chain, point: chain[2]!.getWorldPosition(new THREE.Vector3()),
        rotation: chain[2]!.getWorldQuaternion(new THREE.Quaternion()),
      }));
      const pelvis = this.hipsBone.getWorldPosition(new THREE.Vector3());
      // Fight Idle begins with the pelvis behind the feet/shoulders. Transfer
      // weight onto the front support instead of sliding the entire capsule.
      // Crowded punches stay compact; full range uses the available stance.
      const stanceReach = Number.isFinite(targetDistance)
        ? THREE.MathUtils.lerp(0.45, 1, THREE.MathUtils.smoothstep(targetDistance, 0.65, 1.05))
        : 0.75;
      const commitment = (character === 'jab' ? 0.19 : heavy ? 0.25 : 0.22)
        * stanceReach * reachEnvelope - 0.024 * load;
      pelvis.addScaledVector(this.combatStrikeForwardAxis, commitment);
      pelvis.y -= 0.028 * load;
      this.hipsBone.position.copy(this.hipsBone.parent.worldToLocal(pelvis));
      this.hipsBone.updateWorldMatrix(false, true);
      const stanceWeight = easeCombat(THREE.MathUtils.clamp((Math.abs(commitment) + 0.028 * load) / 0.025, 0, 1));
      for (const { chain, point, rotation } of feet) {
        // Keep strafe/guard knee direction and thigh rotation. The small IK
        // correction carries the weight shift without forcing a pinched stance.
        solveCombatTwoBone(chain[0]!, chain[1]!, chain[2]!, point, stanceWeight,
          undefined, 0.997, THREE.MathUtils.degToRad(12));
        const parent = chain[2]!.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
        chain[2]!.quaternion.copy(parent.multiply(rotation)).normalize();
      }
    }

    // Let the punch react to the locomotion it came from. A lateral entry coils
    // the torso against that momentum then unwinds through contact; a backward
    // entry has a slightly deeper load before the body comes forward. These are
    // small procedural offsets layered on top of the authored strike, not a new
    // canned animation, so every approach direction produces a different beat.
    const walkSpeed = Math.max(0.1, MOVEMENT_TUNING.locomotion.walkSpeed);
    const entryForward01 = THREE.MathUtils.clamp(this.combatAttackEntryForwardSpeed / walkSpeed, -1, 1);
    const entryRight01 = THREE.MathUtils.clamp(this.combatAttackEntryRightSpeed / walkSpeed, -1, 1);
    const motionYaw = THREE.MathUtils.degToRad(-entryRight01 * 5.5) * load
      + THREE.MathUtils.degToRad(entryRight01 * 2.0) * reachEnvelope;
    const motionRoll = THREE.MathUtils.degToRad(-entryRight01 * 4.2)
      * (load * 0.78 + reachEnvelope * 0.28);
    const backwardCoil = THREE.MathUtils.degToRad(Math.max(0, -entryForward01) * 3.8) * load;
    const forwardCarry = THREE.MathUtils.degToRad(Math.max(0, entryForward01) * 1.6) * reachEnvelope;
    const motionPitch = forwardCarry - backwardCoil;
    // The rear shoulder must advance during a right cross; aiming only the elbow
    // leaves the entire right-hand family a few centimetres short of the target.
    const rearShoulderDrive = THREE.MathUtils.degToRad(attack.strikingSide === 'right' ? 30 : 0) * reachEnvelope;
    const resolvedStyleYaw = styleYaw + motionYaw + rearShoulderDrive;

    const alignRig = (
      anchor: THREE.Object3D,
      spine: THREE.Bone | undefined,
      spine1: THREE.Bone | undefined,
      chest: THREE.Bone | undefined,
      strikingUpperArm: THREE.Bone | undefined,
    ): void => {
      if (!chest || !strikingUpperArm) return;
      anchor.updateWorldMatrix(true, false);
      chest.updateWorldMatrix(true, false);
      anchor.getWorldQuaternion(this.tempQuaternionA).invert();
      chest.getWorldQuaternion(this.tempQuaternionB);
      this.tempQuaternionC.copy(this.tempQuaternionA).multiply(this.tempQuaternionB).normalize();
      const chestYawFromLook = THREE.MathUtils.clamp(
        this.quaternionTwistYaw(this.tempQuaternionC),
        -COMBAT_STRIKE_AIM_CORRECTION_MAX,
        COMBAT_STRIKE_AIM_CORRECTION_MAX,
      );
      const fullCorrection = -chestYawFromLook * envelope * COMBAT_STRIKE_AIM_CORRECTION_RESPONSE;
      const torsoCorrection = fullCorrection * COMBAT_STRIKE_TORSO_AIM_SHARE * bodyScale;
      const armCorrection = (fullCorrection - torsoCorrection) * THREE.MathUtils.lerp(0.94, 1.08, Math.min(1, reachScale - 0.80));

      this.applyWorldYawOffset(spine1, torsoCorrection * 0.42);
      this.applyWorldYawOffset(chest, torsoCorrection * 0.58);
      // Variant-specific torso commitment makes jab/cross/long/compact strikes
      // visibly different while the compensating arm correction keeps the fist
      // travelling toward the locked target instead of swinging sideways.
      this.applyWorldYawOffset(spine, resolvedStyleYaw * 0.14);
      this.applyWorldYawOffset(spine1, resolvedStyleYaw * 0.32);
      this.applyWorldYawOffset(chest, resolvedStyleYaw * 0.54);
      this.applyWorldAxisOffset(spine, this.combatStrikeRightAxis, bodyLean * 0.30 + motionPitch * 0.24);
      this.applyWorldAxisOffset(spine1, this.combatStrikeRightAxis, bodyLean * 0.34 + motionPitch * 0.34);
      this.applyWorldAxisOffset(chest, this.combatStrikeRightAxis, bodyLean * 0.36 + motionPitch * 0.42);
      this.applyWorldAxisOffset(spine, this.combatStrikeForwardAxis, motionRoll * 0.20);
      this.applyWorldAxisOffset(spine1, this.combatStrikeForwardAxis, motionRoll * 0.32);
      this.applyWorldAxisOffset(chest, this.combatStrikeForwardAxis, motionRoll * 0.48);
      this.applyWorldYawOffset(strikingUpperArm, armCorrection - resolvedStyleYaw * 0.62);
    };

    alignRig(
      this.avatarAnchor,
      this.combatSpineBone,
      this.combatSpine1Bone,
      this.combatSpine2Bone,
      attack.strikingSide === 'left' ? this.leftUpperArmBone : this.rightUpperArmBone,
    );


    // Target-driven melee: the opponent's live head/chest pose owns the fist
    // destination. The authored clip supplies anticipation/recovery; a bounded
    // two-bone solve supplies the final marked extension toward the opponent.
    const target = this.combatTargetDirection(
      this.tempDirection,
      false,
      !(attack.kind === 'hook-counter' && this.combatCounterGuaranteedTarget),
    );
    const hasTarget = !!target
      && target.distance <= Math.max(2.30, MELEE_ATTACKS[attack.kind].reach + 0.64)
      && this.combatSweepTargetPoints();
    this.setPlayerAimForward(this.meleeForward);
    if (target && hasTarget) this.meleeForward.copy(target.direction);

    const aimStrikingArm = (
      leftUpper: THREE.Bone | undefined,
      leftForearm: THREE.Bone | undefined,
      leftHand: THREE.Bone | undefined,
      rightUpper: THREE.Bone | undefined,
      rightForearm: THREE.Bone | undefined,
      rightHand: THREE.Bone | undefined,
    ): void => {
      const upper = attack.strikingSide === 'left' ? leftUpper : rightUpper;
      const forearm = attack.strikingSide === 'left' ? leftForearm : rightForearm;
      const hand = attack.strikingSide === 'left' ? leftHand : rightHand;
      if (!upper || !forearm || !hand) return;
      upper.updateWorldMatrix(true, false);
      hand.updateWorldMatrix(true, false);
      upper.getWorldPosition(this.combatStrikeShoulderPoint);

      if (hasTarget) {
        const baseAim = combatCloseRangeAimProfile(
          combatStrikeAimProfile(
            attack.animation, attack.kind, attack.spacing, attack.strikingSide,
          ),
          target?.distance ?? Number.POSITIVE_INFINITY,
        );
        // While the opponent is recoiling, target the body that is actually on
        // screen NOW. Reduce stylistic lateral offset and give the arm solver a
        // little extra authority so a leaned-back/sideways reaction cannot make
        // the next punch aim at the pose's eventual return-to-idle location.
        const reactionTracking = this.npcHitReaction !== null;
        const aim = reactionTracking
          ? {
              ...baseAim,
              lateralMeters: baseAim.lateralMeters * 0.28,
              penetrationMeters: baseAim.penetrationMeters + 0.018,
            }
          : baseAim;
        this.combatStrikeDesiredPoint
          .copy(this.combatNpcChestPoint)
          .lerp(this.combatNpcHeadPoint, aim.headWeight)
          .addScaledVector(this.combatStrikeRightAxis, aim.lateralMeters);
        this.combatStrikeDesiredPoint.y += aim.verticalMeters;
        this.combatStrikeDesiredPoint.y = THREE.MathUtils.clamp(
          this.combatStrikeDesiredPoint.y,
          this.combatStrikeShoulderPoint.y - 0.16,
          this.combatStrikeShoulderPoint.y + 0.46,
        );
        if (visualProfile?.character === 'overhand') {
          // Overhand enters from above and settles onto the live jaw at impact.
          // The wrist is still untouched; only the shoulder/elbow target path arcs.
          const beforeImpact = THREE.MathUtils.clamp((attack.impactFraction - normalized) / 0.28, 0, 1);
          this.combatStrikeDesiredPoint.y += 0.18 * beforeImpact * (1 - 0.35 * reachEnvelope);
        }
        // Aim a few centimetres through the live target so the visible knuckles
        // actually enter the head/upper torso at full extension.
        this.combatStrikeDesiredDir
          .copy(this.combatStrikeDesiredPoint)
          .sub(this.combatStrikeShoulderPoint);
        if (this.combatStrikeDesiredDir.lengthSq() > 1e-8) {
          this.combatStrikeDesiredDir.normalize();
          this.combatStrikeDesiredPoint.addScaledVector(
            this.combatStrikeDesiredDir,
            aim.penetrationMeters * reachEnvelope,
          );
        }
      } else {
        // A whiff is still a full straight punch along the look axis, not a
        // downward shrug. Aim slightly above the striking shoulder so the fist
        // reads as travelling at face height even without a target.
        this.combatStrikeDesiredPoint
          .copy(this.combatStrikeShoulderPoint)
          .addScaledVector(this.meleeForward, 1.02 + 0.25 * reachScale);
        this.combatStrikeDesiredPoint.y += 0.06;
      }

      if (attack.contactPoint) this.combatStrikeDesiredPoint.copy(attack.contactPoint);
      else if (attack.aimPoint && normalized >= attack.contactStartFraction) this.combatStrikeDesiredPoint.copy(attack.aimPoint);
      else attack.aimPoint = this.combatStrikeDesiredPoint.clone();
      this.solveCombatArmTowardTarget(
        upper,
        forearm,
        hand,
        this.combatStrikeDesiredPoint,
        reachEnvelope,
        heavy,
        attack.kind === 'hook-counter',
        upper === this.firstPersonLeftUpperArmBone || upper === this.firstPersonRightUpperArmBone
          ? (attack.kind === 'hook-counter'
            ? FIRST_PERSON_COMBAT_COUNTER_REACH_SCALE
            : FIRST_PERSON_COMBAT_STRIKE_REACH_SCALE)
          : this.npcHitReaction ? 1.10 : 1,
      );
    };

    aimStrikingArm(
      this.leftUpperArmBone,
      this.leftForearmBone,
      this.leftHandBone,
      this.rightUpperArmBone,
      this.rightForearmBone,
      this.rightHandBone,
    );

  }


  private applyFirstPersonCombatRootStabilization(): void {
    if (!this.firstPersonHipsBone || !this.combatUpperLayer) return;
    const hardGuard = this.combatAttack !== null || this.combatPhase === 'guard';
    const releaseBlend = THREE.MathUtils.clamp(
      this.firstPersonCombatReleaseSeconds / FIRST_PERSON_COMBAT_ROOT_RELEASE_SECONDS,
      0,
      1,
    );
    const strength = hardGuard ? 1 : releaseBlend;
    if (strength <= 1e-4) return;

    if (this.combatFightHipsInterpolant) {
      const duration = Math.max(1e-5, this.combatFightHipsDuration);
      const time = ((this.combatUpperLayer.firstPerson.time % duration) + duration) % duration;
      const sample = this.combatFightHipsInterpolant.evaluate(time);
      this.firstPersonCombatHipsSample.set(
        Number(sample[0] ?? 0),
        Number(sample[1] ?? 0),
        Number(sample[2] ?? 0),
        Number(sample[3] ?? 1),
      ).normalize();
    } else if (this.combatFightHipsReferenceReady) {
      this.firstPersonCombatHipsSample.copy(this.combatFightHipsReference);
    } else {
      return;
    }

    // Crucial 1P rule: locomotion may animate the world/3P pelvis, but it must
    // never drag the first-person guard left/right. The upper guard is evaluated
    // against the Fight Idle pelvis at the same phase it has while standing still.
    this.firstPersonHipsBone.quaternion.slerp(this.firstPersonCombatHipsSample, strength).normalize();
    this.firstPersonHipsBone.updateMatrix();
    this.firstPersonHipsBone.updateWorldMatrix(false, true);
  }

  private applyCombatGuardTorsoAlignment(): void {
    if (
      this.combatPhase !== 'guard'
      || this.combatLowerActive === null
      || !this.combatFightHipsReferenceReady
    ) return;

    const fightYaw = this.quaternionTwistYaw(this.combatFightHipsReference);
    const alignRig = (
      hips: THREE.Bone | undefined,
      spine: THREE.Bone | undefined,
      spine1: THREE.Bone | undefined,
      spine2: THREE.Bone | undefined,
    ): void => {
      if (!hips) return;
      const pelvisYaw = this.quaternionTwistYaw(hips.quaternion);
      const counterYaw = combatTorsoCounterYaw(fightYaw, pelvisYaw);
      // Keep the locomotion pelvis and legs completely untouched. Importantly,
      // keep this correction active even after the *new* lower state becomes
      // Fight Idle: the previous strafe action is still fading for several
      // frames, and dropping the correction on state-switch was the one-frame
      // sideways body/fist snap seen when movement stopped in guard.
      this.applyWorldYawOffset(spine, counterYaw * 0.52);
      this.applyWorldYawOffset(spine1, counterYaw * 0.30);
      this.applyWorldYawOffset(spine2, counterYaw * 0.18);
    };

    alignRig(this.hipsBone, this.combatSpineBone, this.combatSpine1Bone, this.combatSpine2Bone);
    alignRig(
      this.firstPersonHipsBone,
      this.firstPersonCombatSpineBone,
      this.firstPersonCombatSpine1Bone,
      this.firstPersonCombatSpine2Bone,
    );
  }

  private applyWorldYawOffset(bone: THREE.Bone | undefined, radians: number): void {
    if (!bone || Math.abs(radians) < 1e-6) return;
    bone.updateWorldMatrix(true, false);
    bone.getWorldQuaternion(this.tempQuaternionA);
    this.tempQuaternionB.setFromAxisAngle(UP, radians);
    this.tempQuaternionB.multiply(this.tempQuaternionA);
    if (bone.parent) {
      bone.parent.getWorldQuaternion(this.tempQuaternionC).invert();
      bone.quaternion.copy(this.tempQuaternionC.multiply(this.tempQuaternionB)).normalize();
    } else {
      bone.quaternion.copy(this.tempQuaternionB).normalize();
    }
    bone.updateMatrix();
    bone.updateWorldMatrix(false, true);
  }

  private applyWorldAxisOffset(bone: THREE.Bone | undefined, axis: THREE.Vector3, radians: number): void {
    if (!bone || Math.abs(radians) < 1e-6 || axis.lengthSq() < 1e-8) return;
    bone.updateWorldMatrix(true, false);
    bone.getWorldQuaternion(this.tempQuaternionA);
    this.tempQuaternionB.setFromAxisAngle(axis.clone().normalize(), radians);
    this.tempQuaternionB.multiply(this.tempQuaternionA);
    if (bone.parent) {
      bone.parent.getWorldQuaternion(this.tempQuaternionC).invert();
      bone.quaternion.copy(this.tempQuaternionC.multiply(this.tempQuaternionB)).normalize();
    } else {
      bone.quaternion.copy(this.tempQuaternionB).normalize();
    }
    bone.updateMatrix();
    bone.updateWorldMatrix(false, true);
  }

  private applyWorldQuaternionOffset(
    bone: THREE.Bone | undefined,
    worldOffset: Readonly<THREE.Quaternion>,
    strength = 1,
  ): void {
    if (!bone || strength <= 1e-5) return;
    const t = THREE.MathUtils.clamp(strength, 0, 1);
    this.tempQuaternionD.identity().slerp(worldOffset, t);
    bone.updateWorldMatrix(true, false);
    bone.getWorldQuaternion(this.tempQuaternionA);
    this.tempQuaternionB.copy(this.tempQuaternionD).multiply(this.tempQuaternionA).normalize();
    if (bone.parent) {
      bone.parent.getWorldQuaternion(this.tempQuaternionC).invert();
      bone.quaternion.copy(this.tempQuaternionC.multiply(this.tempQuaternionB)).normalize();
    } else {
      bone.quaternion.copy(this.tempQuaternionB).normalize();
    }
    bone.updateMatrix();
    bone.updateWorldMatrix(false, true);
  }

  private applyFirstPersonCombatFraming(delta: number): void {
    if (!this.firstPersonCharacter || !this.player) return;
    const combatVisible = this.viewMode === 'first-person' && !this.player.isIncapacitated && (
      this.combatAttack !== null
      || this.combatPhase === 'enter'
      || this.combatPhase === 'guard'
      || this.combatPhase === 'exit'
      || this.firstPersonCombatReleaseSeconds > 0
      || this.groundKick !== null
    );

    // The fight-idle guard gets ONE framing solve when it becomes active. After
    // that, the exact same lateral/depth/height correction is held through
    // walking, strafing and the return to idle. The old continuously-running
    // solver chased the animated hands during locomotion, which made the fists
    // drift forward while walking and then snap back toward the eye on stop.
    if (combatVisible && !this.firstPersonCombatFramingWasVisible) {
      this.firstPersonCombatFramingLocked = false;
      this.firstPersonCombatFramingSettleSeconds = FIRST_PERSON_COMBAT_FRAMING_SETTLE_SECONDS;
    } else if (!combatVisible) {
      this.firstPersonCombatFramingLocked = false;
      this.firstPersonCombatFramingSettleSeconds = 0;
    }
    this.firstPersonCombatFramingWasVisible = combatVisible;

    let lateralTarget = combatVisible ? this.firstPersonCombatLateralOffset : 0;
    let depthTarget = combatVisible ? this.firstPersonCombatDepthOffset : 0;
    let verticalTarget = combatVisible ? this.firstPersonCombatVerticalOffset : 0;

    const guardHandsAvailable = combatVisible
      && this.combatPhase === 'guard'
      && !this.combatAttack
      && this.firstPersonHandBones.length >= 2;
    const canSolveGuardFrame = combatVisible
      && this.combatPhase === 'guard'
      && !this.combatAttack
      && !this.firstPersonCombatFramingLocked
      && this.firstPersonHandBones.length >= 2;
    let guardRawLateral: number | null = null;

    if (guardHandsAvailable) {
      this.firstPersonHandBones[0]!.getWorldPosition(this.firstPersonCombatHandA);
      this.firstPersonHandBones[1]!.getWorldPosition(this.firstPersonCombatHandB);
      this.firstPersonCombatHandCenter
        .copy(this.firstPersonCombatHandA)
        .add(this.firstPersonCombatHandB)
        .multiplyScalar(0.5);
      this.firstPersonViewRight.set(
        Math.cos(this.continuousViewYaw),
        0,
        -Math.sin(this.continuousViewYaw),
      );
      guardRawLateral = this.tempDirection
        .copy(this.firstPersonCombatHandCenter)
        .sub(this.firstPersonCamera.position)
        .dot(this.firstPersonViewRight);
    }

    if (canSolveGuardFrame) {
      this.firstPersonForward.set(
        Math.sin(this.continuousViewYaw),
        0,
        Math.cos(this.continuousViewYaw),
      );

      const fromCamera = this.tempDirection
        .copy(this.firstPersonCombatHandCenter)
        .sub(this.firstPersonCamera.position);
      const lateral = guardRawLateral ?? fromCamera.dot(this.firstPersonViewRight);
      const vertical = fromCamera.y;
      // Do not mutate the cached hand positions while measuring depth; they are
      // reused by diagnostics and the second subtraction used to make one hand
      // appear to jump when the solver resumed after locomotion.
      const nearDepth = Math.min(
        this.firstPersonCombatDepthVectorA.copy(this.firstPersonCombatHandA).sub(this.firstPersonCamera.position).dot(this.firstPersonForward),
        this.firstPersonCombatDepthVectorB.copy(this.firstPersonCombatHandB).sub(this.firstPersonCamera.position).dot(this.firstPersonForward),
      );

      lateralTarget = THREE.MathUtils.clamp(
        -lateral,
        -FIRST_PERSON_COMBAT_LATERAL_MAX,
        FIRST_PERSON_COMBAT_LATERAL_MAX,
      ) * this.firstPersonCombatPoseBlend;
      depthTarget = THREE.MathUtils.clamp(
        FIRST_PERSON_COMBAT_NEAR_HAND_DEPTH_TARGET - nearDepth,
        -FIRST_PERSON_COMBAT_DEPTH_MAX_CORRECTION,
        FIRST_PERSON_COMBAT_DEPTH_MAX_CORRECTION,
      ) * this.firstPersonCombatPoseBlend;
      depthTarget += FIRST_PERSON_COMBAT_VISUAL_NEAR_HAND_DEPTH_EXTRA * this.firstPersonCombatPoseBlend;
      // Guard framing may correct the fists, but it must never drag the whole
      // render body far out in front of the eye. Keep a hard presentation budget.
      depthTarget = Math.min(depthTarget, FIRST_PERSON_COMBAT_DEPTH_EFFECTIVE_MAX_FORWARD);
      verticalTarget = THREE.MathUtils.clamp(
        FIRST_PERSON_COMBAT_HAND_Y_TARGET - vertical,
        -FIRST_PERSON_COMBAT_VERTICAL_MAX_CORRECTION,
        FIRST_PERSON_COMBAT_VERTICAL_MAX_CORRECTION,
      ) * this.firstPersonCombatPoseBlend;
      verticalTarget += FIRST_PERSON_COMBAT_VISUAL_HAND_Y_EXTRA * this.firstPersonCombatPoseBlend;

      this.firstPersonCombatFramingSettleSeconds = Math.max(
        0,
        this.firstPersonCombatFramingSettleSeconds - Math.max(0, delta),
      );
      if (
        this.firstPersonCombatFramingSettleSeconds <= 0
        && this.firstPersonCombatPoseBlend >= 0.92
      ) {
        this.firstPersonCombatFramingLocked = true;
      }
    }

    // The 1P pelvis is stabilized separately against the Fight Idle phase, so
    // no extra screen-space strafe compensation is needed here. Holding this
    // framing offset untouched avoids the old stop/start hand teleport.

    this.firstPersonCombatLateralOffset = THREE.MathUtils.lerp(
      this.firstPersonCombatLateralOffset,
      lateralTarget,
      expAlpha(delta, FIRST_PERSON_COMBAT_LATERAL_RESPONSE),
    );
    this.firstPersonCombatDepthOffset = THREE.MathUtils.lerp(
      this.firstPersonCombatDepthOffset,
      depthTarget,
      expAlpha(delta, FIRST_PERSON_COMBAT_DEPTH_RESPONSE),
    );
    this.firstPersonCombatVerticalOffset = THREE.MathUtils.lerp(
      this.firstPersonCombatVerticalOffset,
      verticalTarget,
      expAlpha(delta, FIRST_PERSON_COMBAT_VERTICAL_RESPONSE),
    );

    if (Math.abs(this.firstPersonCombatLateralOffset) > 0.0001) {
      this.firstPersonAvatarAnchor.position.addScaledVector(
        this.firstPersonViewRight,
        this.firstPersonCombatLateralOffset,
      );
    }
    if (Math.abs(this.firstPersonCombatDepthOffset) > 0.0001) {
      this.firstPersonAvatarAnchor.position.addScaledVector(
        this.firstPersonForward,
        this.firstPersonCombatDepthOffset,
      );
    }
    if (Math.abs(this.firstPersonCombatVerticalOffset) > 0.0001) {
      this.firstPersonAvatarAnchor.position.y += this.firstPersonCombatVerticalOffset;
    }

    // First-person punch readability: move the render-only upper body a few
    // centimeters farther along view-forward around impact. This is presentation
    // only (the gameplay camera/collider never moves), and because the offset uses
    // the same bell envelope as torso drive it returns to the exact guard frame.
    if (this.combatAttack) {
      const strikeNormalized = this.combatAttack.duration > 1e-5
        ? this.combatAttack.elapsed / this.combatAttack.duration
        : 1;
      const strikeVisual = combatAttackVisualProfile(this.combatAttack.animation);
      const strikeForward = strikeVisual?.firstPersonForwardMeters ?? 0;
      const strikeReach = combatStrikeReachEnvelope(
        strikeNormalized,
        this.combatAttack.kind === 'big-punch',
        this.combatAttack.impactFraction,
      );
      if (strikeForward > 0 && strikeReach > 1e-4) {
        const startDistance = this.combatAttack.targetDistanceAtStart;
        const contactReachBoost = Number.isFinite(startDistance)
          ? THREE.MathUtils.lerp(0.98, 1.22, THREE.MathUtils.smoothstep(startDistance, 0.82, 1.82))
          : 1.08;
        this.firstPersonAvatarAnchor.position.addScaledVector(
          this.firstPersonForward,
          strikeForward * strikeReach * contactReachBoost * FIRST_PERSON_COMBAT_PUNCH_FORWARD_PRESENTATION_SCALE,
        );
      }
    }
    this.firstPersonAvatarAnchor.updateMatrixWorld(true);
  }

  private applyFirstPersonArmCameraSafety(delta: number): void {
    if (!this.firstPersonCharacter || !this.player || this.viewMode !== 'first-person') return;
    this.firstPersonCamera.getWorldDirection(this.firstPersonArmSafetyViewForward).normalize();
    const combatVisible = !this.player.isIncapacitated && (
      this.combatAttack !== null
      || this.combatPhase === 'enter'
      || this.combatPhase === 'guard'
      || this.firstPersonCombatPoseBlend > 0.01
    );

    let targetForwardOffset = 0;
    if (combatVisible && this.combatAttack !== null) {
      const requireDepth = (bones: readonly THREE.Bone[], safeDepth: number): void => {
        for (const bone of bones) {
          bone.getWorldPosition(this.firstPersonArmSafetyBonePosition);
          const depth = this.firstPersonArmSafetyBonePosition
            .sub(this.firstPersonCamera.position)
            .dot(this.firstPersonArmSafetyViewForward);
          targetForwardOffset = Math.max(targetForwardOffset, safeDepth - depth);
        }
      };

      requireDepth(this.firstPersonHandBones, FIRST_PERSON_HAND_SAFE_DEPTH);
      requireDepth(this.firstPersonForearmBones, FIRST_PERSON_FOREARM_SAFE_DEPTH);
      // Shoulders/clavicles and most proximal upper-arm geometry are hidden by
      // the combat-only view mask. Do not let invisible bones push the entire
      // guard rig forward, which was the source of the huge back/torso in POV.
      targetForwardOffset = THREE.MathUtils.clamp(
        targetForwardOffset,
        0,
        Math.min(FIRST_PERSON_ARM_SAFETY_MAX_FORWARD, FIRST_PERSON_COMBAT_ATTACK_SAFETY_MAX_FORWARD),
      );
    }

    // Penetration correction is immediate so the camera never spends a frame
    // inside the arm. Releasing the offset is smoothed so guard/punch recovery
    // cannot make the whole view-model pop backward.
    if (targetForwardOffset > this.firstPersonArmSafetyForwardOffset) {
      this.firstPersonArmSafetyForwardOffset = targetForwardOffset;
    } else {
      this.firstPersonArmSafetyForwardOffset = THREE.MathUtils.lerp(
        this.firstPersonArmSafetyForwardOffset,
        targetForwardOffset,
        expAlpha(delta, FIRST_PERSON_ARM_SAFETY_RELEASE_RESPONSE),
      );
    }

    if (this.firstPersonArmSafetyForwardOffset > 0.0001) {
      this.firstPersonAvatarAnchor.position.addScaledVector(
        this.firstPersonArmSafetyViewForward,
        this.firstPersonArmSafetyForwardOffset,
      );
      this.firstPersonAvatarAnchor.updateMatrixWorld(true);
    }
  }

  private applyFirstPersonGuardPose(): void {
    if (this.viewMode !== 'first-person' || this.combatPhase !== 'guard'
      || this.combatHitReaction || this.groundKick
      || this.combatDodge || this.player?.isIncapacitated) return;
    // First-person guard is a presentation pose: each wrist sits below/to the
    // side of the sight line. Centering the pair left the rear fist at the eye.
    // Keep actual limb lengths and authored wrist/finger rotations; contact
    // poses still come from the authoritative world rig during a strike.
    const cameraRotation = this.firstPersonCamera.getWorldQuaternion(new THREE.Quaternion());
    const chains = [
      [this.firstPersonLeftUpperArmBone, this.firstPersonLeftForearmBone, this.firstPersonLeftHandBone],
      [this.firstPersonRightUpperArmBone, this.firstPersonRightForearmBone, this.firstPersonRightHandBone],
    ];
    for (let side = 0; side < chains.length; side++) {
      const [upper, forearm, hand] = chains[side]!;
      if (!upper || !forearm || !hand) continue;
      const attack = this.combatAttack;
      let guardWeight = this.firstPersonCombatPoseBlend;
      if (attack && attack.strikingSide === (side === 0 ? 'left' : 'right')) {
        const phase = attack.elapsed / Math.max(1e-5, attack.duration);
        const release = easeCombat(THREE.MathUtils.smoothstep(phase, 0.015, attack.contactStartFraction - 0.045));
        const returnToGuard = easeCombat(THREE.MathUtils.smoothstep(
          phase, attack.contactEndFraction + 0.06,
          Math.min(attack.endTime / attack.duration - 0.02, attack.contactEndFraction + 0.24),
        ));
        guardWeight *= 1 - release * (1 - returnToGuard);
      }
      if (guardWeight < 1e-6) continue;
      const target = new THREE.Vector3(
        (side === 0 ? -1 : 1) * FIRST_PERSON_GUARD_WRIST_LATERAL,
        -FIRST_PERSON_GUARD_WRIST_DROP - (side === 0 ? 0 : 0.035),
        -FIRST_PERSON_GUARD_WRIST_DEPTH - (side === 0 ? 0.045 : 0),
      ).applyQuaternion(cameraRotation).add(this.firstPersonCamera.position);
      const handRotation = hand.getWorldQuaternion(new THREE.Quaternion());
      solveCombatTwoBone(upper, forearm, hand, target, guardWeight, undefined, 0.94);
      hand.quaternion.copy(hand.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(handRotation)).normalize();
      hand.updateWorldMatrix(false, true);
    }
  }

  private applyFallMotion(delta: number): void {
    if (!this.player) return;
    const state = this.player.getDebugState();
    const velocityBlend = THREE.MathUtils.clamp(Math.max(0, -state.verticalSpeed - 2.2) / 10, 0, 1);
    const distanceBlend = THREE.MathUtils.clamp((state.fallDistance - 0.18) / 3.8, 0, 1);
    const authoredFallActive = this.currentAnimation === 'falling-idle'
      || this.currentAnimation === 'falling-flat-impact';
    const targetFall = state.falling && !authoredFallActive ? Math.max(velocityBlend, distanceBlend) : 0;
    this.fallPoseBlend = THREE.MathUtils.lerp(
      this.fallPoseBlend,
      targetFall,
      expAlpha(delta, targetFall > this.fallPoseBlend ? 5.2 : 9.5),
    );
    this.landingVisualImpulse *= Math.exp(-Math.max(0, delta) * 7.8);

    const yaw = this.avatarAnchor.rotation.y;
    this.fallForwardAxis.set(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
    this.fallRightAxis.set(Math.cos(yaw), 0, -Math.sin(yaw)).normalize();

    const fall = this.fallPoseBlend;
    if (fall > 0.002) {
      // Long falls loosen the silhouette instead of replaying a jump pose forever:
      // torso pitches into the drop, arms open for balance, legs separate slightly.
      this.applyWorldAxisOffset(this.upperSpineBone, this.fallRightAxis, -0.085 * fall);
      this.applyWorldAxisOffset(this.leftUpperArmBone, this.fallForwardAxis, 0.42 * fall);
      this.applyWorldAxisOffset(this.rightUpperArmBone, this.fallForwardAxis, -0.42 * fall);
      this.applyWorldAxisOffset(this.leftUpperArmBone, this.fallRightAxis, -0.1 * fall);
      this.applyWorldAxisOffset(this.rightUpperArmBone, this.fallRightAxis, -0.1 * fall);
      this.applyWorldAxisOffset(this.leftUpperLegBone, this.fallRightAxis, 0.1 * fall);
      this.applyWorldAxisOffset(this.rightUpperLegBone, this.fallRightAxis, -0.07 * fall);
    }

    const landing = this.severeImpactLocked
      ? 0
      : this.landingVisualImpulse * (state.crouching || state.lowPosture ? 0.55 : 1);
    if (landing > 0.002) {
      // Small post-impact compression layered over whichever locomotion clip wins
      // next. It decays quickly, so landing never locks the player in a new state.
      this.applyWorldAxisOffset(this.upperSpineBone, this.fallRightAxis, 0.07 * landing);
      this.applyWorldAxisOffset(this.leftUpperLegBone, this.fallRightAxis, -0.17 * landing);
      this.applyWorldAxisOffset(this.rightUpperLegBone, this.fallRightAxis, -0.17 * landing);
    }
  }

  private applyHeadLook(delta: number): void {
    // Mixer animation is evaluated first each frame, then the look is layered.
    // A downed player is different: the impact pose must stay frozen, so only
    // neck/head receive the small remaining look cone (no spine/body twist).
    if (this.player?.isIncapacitated) {
      this.applyWorldYawOffset(this.neckBone, this.headLookYaw * 0.36);
      this.applyWorldYawOffset(this.headBone, this.headLookYaw * 0.64);
      return;
    }
    // Sharing the yaw across three joints makes the wide ±85° stationary look
    // natural in both standing and crouch poses. The mixer rewrites the base
    // pose next frame, so this never accumulates.
    this.applyWorldYawOffset(this.upperSpineBone, this.headLookYaw * 0.16);
    this.applyWorldYawOffset(this.neckBone, this.headLookYaw * 0.34);
    this.applyWorldYawOffset(this.headBone, this.headLookYaw * 0.5);

    if (this.headBone && (this.combatAttack || this.combatPhase === 'guard' || this.actionFacingReturnActive || this.combatGazeYaw !== null)
      && !this.combatHitReaction && !this.groundKick && !this.combatDodge) {
      // The chest must rotate into a punch; the face must keep watching the
      // opponent. Apply a world-space counter-yaw through neck/head, leaving the
      // authored chin tuck, pitch, roll and positional weight shift intact.
      const facing = this.combatAttack ? this.combatAttackAimYaw : this.continuousViewYaw;
      const target = this.combatTargetDirection(new THREE.Vector3(), false, true);
      const targetYaw = target ? Math.atan2(target.direction.x, target.direction.z) : facing;
      const gazeOffset = Math.atan2(Math.sin(targetYaw - facing), Math.cos(targetYaw - facing));
      const face = this.combatHeadLocalForward.clone()
        .applyQuaternion(this.headBone.getWorldQuaternion(new THREE.Quaternion()));
      const faceYaw = Math.atan2(face.x, face.z);
      const combatGazeActive = this.combatAttack || this.combatPhase === 'guard';
      const desiredGazeYaw = combatGazeActive ? facing + THREE.MathUtils.clamp(gazeOffset, -0.55, 0.55) : faceYaw;
      // Keep the final strike gaze when returning to guard, then let the eyes
      // and head catch the new view. A newly sampled camera yaw is not a pose.
      this.combatGazeYaw = followActionYaw(this.combatGazeYaw ?? faceYaw, desiredGazeYaw, delta, 14, 300);
      const counterYaw = THREE.MathUtils.clamp(
        wrapAngleRadians(this.combatGazeYaw - faceYaw),
        -THREE.MathUtils.degToRad(75), THREE.MathUtils.degToRad(75),
      );
      this.applyWorldYawOffset(this.neckBone, counterYaw * 0.45);
      this.applyWorldYawOffset(this.headBone, counterYaw * 0.55);
      if (!combatGazeActive && !this.actionFacingReturnActive && Math.abs(counterYaw) < 0.012) this.combatGazeYaw = null;
    } else this.combatGazeYaw = null;

    // Forward+strafe uses the authored strafe feet, but its head pose should
    // read as a diagonal advance rather than a full sideways crab-walk. Counter
    // part of the clip's lateral face turn only while BOTH forward and side are
    // held. Q/D alone deliberately keeps the original pure-strafe silhouette.
    if (this.viewMode === 'third-person' && this.player) {
      const intent = this.player.getMovementIntent();
      const diagonalStrafe = intent.forward > 0.15 && Math.abs(intent.right) > 0.15;
      const strafeClip = this.currentAnimation === 'left-strafe-walking'
        || this.currentAnimation === 'right-strafe-walking';
      if (diagonalStrafe && strafeClip) {
        const strength = Math.min(1, intent.forward) * Math.min(1, Math.abs(intent.right));
        const correction = -Math.sign(intent.right)
          * THREE.MathUtils.degToRad(THIRD_PERSON_LOOK_TUNING.diagonalStrafeHeadCorrectionDegrees)
          * strength;
        this.applyWorldYawOffset(this.neckBone, correction * 0.4);
        this.applyWorldYawOffset(this.headBone, correction * 0.6);
      }
    }
  }

  private updateThirdPersonCamera(delta: number, snap = false): void {
    if (!this.player) return;
    const state = this.player.getDebugState();
    const aimBodyYaw = Math.PI + this.player.getContinuousAimYawRadians();
    this.horizontalForward.set(Math.sin(aimBodyYaw), 0, Math.cos(aimBodyYaw));

    if (this.ragdoll || this.recovery) {
      (this.recovery ?? this.ragdoll)!.getPelvisPosition(this.cameraTarget);
      this.cameraTarget.y += 0.26;
    } else {
      this.cameraTarget.copy(this.avatarAnchor.position).add(new THREE.Vector3(0, 1.08, 0));
    }
    this.desiredCameraPosition
      .copy(this.cameraTarget)
      .addScaledVector(this.horizontalForward, -this.cameraDistance)
      .add(new THREE.Vector3(0, this.cameraHeight, 0));

    // Critical aiming invariant: the camera orbit azimuth must follow the mouse
    // immediately. World-space XYZ lerping lets the camera cut across the orbit
    // after a 120-180° turn; once it crosses the player's side, left/right input
    // appears inverted even though PointerLockControls is still correct. Smooth
    // only the boom length (collision recovery), never the yaw-bearing direction.
    this.tempDirection.copy(this.desiredCameraPosition).sub(this.cameraTarget);
    const nominalBoomLength = this.tempDirection.length();
    let targetBoomLength = nominalBoomLength;
    if (nominalBoomLength > 0.001) {
      this.tempDirection.multiplyScalar(1 / nominalBoomLength);
      this.cameraRaycaster.set(this.cameraTarget, this.tempDirection);
      this.cameraRaycaster.near = 0.18;
      this.cameraRaycaster.far = nominalBoomLength;
      const hit = this.cameraRaycaster.intersectObjects(this.environmentMeshes, false)[0];
      if (hit) targetBoomLength = Math.max(0.55, hit.distance - 0.22);
    } else {
      this.tempDirection.set(0, 0, 1);
    }

    if (snap || !Number.isFinite(this.cameraBoomLength)) {
      this.cameraBoomLength = targetBoomLength;
    } else if (targetBoomLength < this.cameraBoomLength) {
      // Pull in immediately so a wall can never sit between player and camera.
      this.cameraBoomLength = targetBoomLength;
    } else {
      // Ease back out after obstruction clears; scalar-only smoothing preserves
      // exact mouse left/right orientation through any number of full turns.
      this.cameraBoomLength = THREE.MathUtils.lerp(
        this.cameraBoomLength,
        targetBoomLength,
        expAlpha(delta, 9.5),
      );
    }
    this.cameraBoomLength = THREE.MathUtils.clamp(this.cameraBoomLength, 0.55, Math.max(0.55, nominalBoomLength));
    this.thirdPersonCamera.position.copy(this.cameraTarget).addScaledVector(this.tempDirection, this.cameraBoomLength);

    const pitch = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(state.view.pitch, -50, 50));
    const lookAhead = this.cameraTarget.clone().addScaledVector(this.horizontalForward, 0.45);
    lookAhead.y += Math.sin(pitch) * 1.15;
    this.thirdPersonCamera.lookAt(lookAhead);
  }

  private resetRagdollMotionHistory(): void {
    this.ragdollMotionPrevious = undefined;
    this.ragdollMotionCurrent = undefined;
    this.ragdollMotionDelta = 0;
  }

  private captureRagdollMotionFrame(delta: number): void {
    if (!this.character || this.ragdollMotionBones.length === 0) return;
    this.avatarAnchor.updateMatrixWorld(true);
    this.character.updateMatrixWorld(true);

    const next = new Map<string, RagdollBonePoseSample>();
    for (const bone of this.ragdollMotionBones) {
      const name = bone.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      next.set(name, {
        position: bone.getWorldPosition(new THREE.Vector3()),
        rotation: bone.getWorldQuaternion(new THREE.Quaternion()).normalize(),
      });
    }

    if (this.ragdollMotionCurrent) {
      this.ragdollMotionPrevious = this.ragdollMotionCurrent;
      this.ragdollMotionDelta = THREE.MathUtils.clamp(delta, 1 / 240, 1 / 15);
    }
    this.ragdollMotionCurrent = next;
  }

  private quaternionAngularVelocity(
    previous: THREE.Quaternion,
    current: THREE.Quaternion,
    delta: number,
    target: THREE.Vector3,
  ): THREE.Vector3 {
    const inversePrevious = this.tempQuaternionA.copy(previous).invert();
    const rotationDelta = this.tempQuaternionB.copy(current).multiply(inversePrevious).normalize();
    // q and -q encode the same orientation. Force the shortest arc so a sign
    // flip in an FBX quaternion never becomes a fake 360-degree angular spike.
    if (rotationDelta.w < 0) {
      rotationDelta.set(-rotationDelta.x, -rotationDelta.y, -rotationDelta.z, -rotationDelta.w);
    }
    const sinHalf = Math.hypot(rotationDelta.x, rotationDelta.y, rotationDelta.z);
    if (sinHalf < 1e-7 || delta <= 1e-6) return target.set(0, 0, 0);
    const angle = 2 * Math.atan2(sinHalf, THREE.MathUtils.clamp(rotationDelta.w, -1, 1));
    target.set(rotationDelta.x, rotationDelta.y, rotationDelta.z)
      .multiplyScalar(angle / (sinHalf * delta));
    const maxSampleAngularSpeed = 18;
    if (target.lengthSq() > maxSampleAngularSpeed * maxSampleAngularSpeed) {
      target.setLength(maxSampleAngularSpeed);
    }
    return target;
  }

  private buildRagdollAnimationMotion(): RagdollAnimationMotion | undefined {
    const previous = this.ragdollMotionPrevious;
    const current = this.ragdollMotionCurrent;
    const delta = this.ragdollMotionDelta;
    if (!previous || !current || delta <= 0) return undefined;

    const bones: Record<string, {
      linearVelocity: THREE.Vector3;
      angularVelocity: THREE.Vector3;
    }> = {};
    for (const [name, currentPose] of current) {
      const previousPose = previous.get(name);
      if (!previousPose) continue;
      const linearVelocity = currentPose.position.clone().sub(previousPose.position).divideScalar(delta);
      // A teleport/reset should never leak into a corpse. Ordinary authored limb
      // motion stays far below this cap, while a bad blend still keeps its direction.
      if (linearVelocity.lengthSq() > 18 * 18) linearVelocity.setLength(18);
      const angularVelocity = this.quaternionAngularVelocity(
        previousPose.rotation,
        currentPose.rotation,
        delta,
        new THREE.Vector3(),
      );
      bones[name] = { linearVelocity, angularVelocity };
    }
    return Object.keys(bones).length > 0 ? { bones } : undefined;
  }

  private playerHasAuthoredStairProtection(state: ReturnType<PlayerController['getDebugState']>): boolean {
    const footOffset = state.crouching || state.lowPosture ? 0.565 : 0.865;
    const feetY = state.position.y - footOffset;
    for (const stair of this.authoredStairColliders) {
      const top = stair.center.y + stair.halfExtents.y;
      if (state.position.x < stair.center.x - stair.halfExtents.x - 0.20
        || state.position.x > stair.center.x + stair.halfExtents.x + 0.20
        || state.position.z < stair.center.z - stair.halfExtents.z - 0.20
        || state.position.z > stair.center.z + stair.halfExtents.z + 0.20) continue;
      const heightAbove = feetY - top;
      if (heightAbove < -0.34 || heightAbove > 1.30) continue;
      if (state.grounded || state.fallDistance < 1.15) return true;
    }
    return false;
  }

  private updatePitEdgeRisk(delta: number): void {
    if (!this.player || this.ragdoll) return;
    const state = this.player.getDebugState();
    this.pitControlGrace = Math.max(0, this.pitControlGrace - Math.max(0, delta));
    if (
      !state.pointerLocked
      || state.noclip
      || state.traversing
      || state.incapacitated
    ) {
      this.activePitEdge = null;
      this.pitEdgeRisk = integratePitEdgeRisk(this.pitEdgeRisk, null, delta);
      this.pitControlGrace = 0;
      return;
    }

    const intent = this.player.getPitControlIntent();
    if (this.playerHasAuthoredStairProtection(state)) {
      // Landing on or jumping along authored stairs is deliberate navigation,
      // never an edge-stumble signal. Keep a short grace while the capsule
      // transitions between individual treads.
      this.pitControlGrace = Math.max(this.pitControlGrace, 0.82);
    }
    const analysis = analyzePitEdge({
      x: state.position.x,
      y: state.position.y,
      z: state.position.z,
      velocityX: state.velocity.x,
      velocityY: state.velocity.y,
      velocityZ: state.velocity.z,
      grounded: state.grounded,
      falling: state.falling,
      fallDistance: state.fallDistance,
      viewX: state.view.direction.x,
      viewZ: state.view.direction.z,
      viewPitchDegrees: state.view.pitch,
      manualLean: state.manualLean,
      crouching: state.crouching,
      lowPosture: state.lowPosture,
      inputForward: intent.forward,
      inputRight: intent.right,
      jumpGraceSeconds: intent.jumpGraceSeconds,
      controlGraceSeconds: this.pitControlGrace,
    }, MOVEMENT_LAB_PITS);
    this.activePitEdge = analysis;
    if (analysis?.refreshControlGrace) {
      // Long enough to carry a deliberate step/jump across the lip, short enough
      // that genuinely losing control shortly afterwards can still tumble.
      this.pitControlGrace = Math.max(
        this.pitControlGrace,
        intent.jumpGraceSeconds > 0 ? intent.jumpGraceSeconds : 0.75,
      );
    }
    this.pitEdgeRisk = integratePitEdgeRisk(this.pitEdgeRisk, analysis, delta);
    if (!analysis || this.pitEdgeRisk < PIT_EDGE_RAGDOLL_THRESHOLD) return;
    this.beginPitRagdoll(analysis);
  }

  private beginPitRagdoll(analysis: PitEdgeAnalysis): void {
    if (!this.player || this.ragdoll) return;
    const state = this.player.getDebugState();
    const horizontalSpeed = Math.hypot(state.velocity.x, state.velocity.z);
    // A stumble should carry the player into the opening, not launch them like a
    // scripted knockback. Real locomotion remains the dominant inherited motion.
    const inwardKick = analysis.immediate
      ? THREE.MathUtils.clamp(0.55 + horizontalSpeed * 0.08, 0.55, 0.9)
      : THREE.MathUtils.clamp(0.85 + horizontalSpeed * 0.16, 0.85, 1.45);
    this.pitRagdollExtraVelocity.set(
      analysis.inwardX * inwardKick,
      analysis.immediate ? -0.35 : -0.62,
      analysis.inwardZ * inwardKick,
    );
    this.pitEdgeRisk = 0;
    this.pitControlGrace = 0;
    this.activePitEdge = analysis;
    this.startRagdoll({
      fatal: false,
      addedVelocity: this.pitRagdollExtraVelocity,
      status: analysis.immediate ? 'RAGDOLL · CHUTE' : 'RAGDOLL · PERTE D’ÉQUILIBRE',
    });
  }

  private resolveRagdollImpactSurface(event: RagdollImpactEvent): {
    position: THREE.Vector3;
    normal: THREE.Vector3;
    surface: RagdollImpactSurface;
    collider: StaticCollider;
  } | null {
    let bestDistance = 0.50;
    let best: {
      position: THREE.Vector3;
      normal: THREE.Vector3;
      surface: RagdollImpactSurface;
      collider: StaticCollider;
    } | null = null;

    for (const collider of this.plan.colliders) {
      const rotation = this.impactColliderRotation;
      if (collider.rotation) {
        rotation.set(collider.rotation.x, collider.rotation.y, collider.rotation.z, collider.rotation.w).normalize();
      } else rotation.identity();
      this.impactColliderInverse.copy(rotation).invert();
      this.impactLocalPoint
        .copy(event.position)
        .sub(this.tempDirection.set(collider.center.x, collider.center.y, collider.center.z))
        .applyQuaternion(this.impactColliderInverse);
      const half = collider.halfExtents;
      const inside = Math.abs(this.impactLocalPoint.x) <= half.x
        && Math.abs(this.impactLocalPoint.y) <= half.y
        && Math.abs(this.impactLocalPoint.z) <= half.z;
      this.impactClosestPoint.set(
        THREE.MathUtils.clamp(this.impactLocalPoint.x, -half.x, half.x),
        THREE.MathUtils.clamp(this.impactLocalPoint.y, -half.y, half.y),
        THREE.MathUtils.clamp(this.impactLocalPoint.z, -half.z, half.z),
      );

      if (inside) {
        const faceX = half.x - Math.abs(this.impactLocalPoint.x);
        const faceY = half.y - Math.abs(this.impactLocalPoint.y);
        const faceZ = half.z - Math.abs(this.impactLocalPoint.z);
        if (faceX <= faceY && faceX <= faceZ) {
          const sign = this.impactLocalPoint.x === 0 ? -Math.sign(event.velocityBefore.x || 1) : Math.sign(this.impactLocalPoint.x);
          this.impactClosestPoint.x = sign * half.x;
          this.impactLocalNormal.set(sign, 0, 0);
        } else if (faceY <= faceZ) {
          const sign = this.impactLocalPoint.y === 0 ? 1 : Math.sign(this.impactLocalPoint.y);
          this.impactClosestPoint.y = sign * half.y;
          this.impactLocalNormal.set(0, sign, 0);
        } else {
          const sign = this.impactLocalPoint.z === 0 ? -Math.sign(event.velocityBefore.z || 1) : Math.sign(this.impactLocalPoint.z);
          this.impactClosestPoint.z = sign * half.z;
          this.impactLocalNormal.set(0, 0, sign);
        }
      } else {
        this.impactLocalNormal.copy(this.impactLocalPoint).sub(this.impactClosestPoint);
        if (this.impactLocalNormal.lengthSq() < 1e-8) continue;
        this.impactLocalNormal.normalize();
      }

      const distance = this.impactLocalPoint.distanceTo(this.impactClosestPoint);
      if (distance > bestDistance) continue;
      this.impactWorldPoint
        .copy(this.impactClosestPoint)
        .applyQuaternion(rotation)
        .add(this.tempDirection.set(collider.center.x, collider.center.y, collider.center.z));
      this.impactWorldNormal.copy(this.impactLocalNormal).applyQuaternion(rotation).normalize();
      const surface: RagdollImpactSurface = collider.kind === 'step' || collider.id.includes('stair')
        ? 'step'
        : collider.kind === 'floor' || this.impactWorldNormal.y > 0.58
          ? 'floor'
          : Math.abs(this.impactWorldNormal.y) < 0.58
            ? 'wall'
            : 'other';
      bestDistance = distance;
      best = {
        position: this.impactWorldPoint.clone(),
        normal: this.impactWorldNormal.clone(),
        surface,
        collider,
      };
    }
    return best;
  }

  private markRagdollDead(status: string): void {
    this.health = 0;
    this.damageFlash = 1;
    this.secondsSinceDamage = 0;
    this.ragdollMode = 'dead';
    this.respawnElapsed = 0;
    if (this.killButton) this.killButton.textContent = 'DEAD';
    this.updateHealthUi();
    this.updateHealth(0);
    this.setStatus(status);
  }

  private applyRagdollDamage(amount: number, status: string): void {
    if (!this.ragdoll || amount <= 0 || this.ragdollMode === 'dead') return;
    this.health = THREE.MathUtils.clamp(this.health - amount, 0, MAX_HEALTH);
    this.secondsSinceDamage = 0;
    this.damageFlash = Math.max(
      this.damageFlash,
      THREE.MathUtils.clamp(0.26 + amount / 58, 0.28, 1),
    );
    this.updateHealthUi();
    this.updateHealth(0);
    if (this.health <= 0) this.markRagdollDead(status);
  }

  private refreshRagdollFallDistance(): void {
    if (!this.ragdoll || this.ragdollMode !== 'pit-fall') return;
    const pelvis = this.ragdoll.getPelvisPosition(this.cameraTarget);
    this.ragdollFallPeakY = Math.max(this.ragdollFallPeakY, pelvis.y);
    this.ragdollFallDistance = Math.max(
      this.ragdollFallDistance,
      this.ragdollFallPeakY - pelvis.y,
    );
  }

  private processRagdollImpactEvents(delta: number): void {
    this.bloodDecalCooldown = Math.max(0, this.bloodDecalCooldown - Math.max(0, delta));
    if (!this.ragdoll) return;
    this.refreshRagdollFallDistance();

    for (const event of this.ragdoll.drainImpactEvents()) {
      if (!this.ragdoll) return;
      const hit = this.resolveRagdollImpactSurface(event);
      if (!hit) continue;
      const incomingSpeed = Math.max(0, -event.velocityBefore.dot(hit.normal));
      if (incomingSpeed < 2.4) continue;

      const part = ragdollBodyImpactPart(event.bodyId);
      const floorLike = hit.surface === 'floor' || hit.surface === 'step';
      const alreadyDead = this.ragdollMode === 'dead';
      let damage = ragdollImpactDamage(part, incomingSpeed, hit.surface);
      let landingDamage = 0;
      let fatalDrop = false;

      if (!alreadyDead && this.ragdollMode === 'pit-fall' && floorLike
        && !this.ragdollDamageApplied && incomingSpeed >= 3.25
        && (part === 'head' || part === 'core' || part === 'upper-leg'
          || part === 'lower-leg' || incomingSpeed >= 7.2)) {
        this.ragdollDamageApplied = true;
        const drop = this.ragdollFallDistance;
        fatalDrop = ragdollDropIsFatal(drop);
        if (fatalDrop) damage = Math.max(damage, this.health);
        else {
          landingDamage = pitRagdollDamageForDrop(drop);
          damage = Math.max(damage, landingDamage);
        }
      }

      const impactKills = !alreadyDead && damage >= this.health;
      const guaranteesBlood = ragdollImpactGuaranteesBlood(
        part, incomingSpeed, damage, hit.surface, landingDamage, fatalDrop, impactKills,
      );
      const needsBlood = guaranteesBlood || ragdollImpactNeedsBlood(part, incomingSpeed, damage);
      const prefersBurst = ragdollImpactPrefersBurst(
        part, incomingSpeed, damage, hit.surface, landingDamage, fatalDrop, impactKills,
      );
      if (needsBlood && this.bloodImpactGate.accept({
        bodyId: event.bodyId, surface: hit.surface, position: hit.position,
        speed: incomingSpeed, time: this.bloodImpactClock,
      })) {
        const size = bloodDecalSizeForImpact(part, damage);
        if (prefersBurst) {
          this.bloodDecals.spawnBurst(
            hit.position, hit.normal,
            fatalDrop
              ? THREE.MathUtils.clamp(0.82 + (this.ragdollFallDistance - 8.25) * 0.055, 0.82, 1.20)
              : THREE.MathUtils.clamp(size * (part === 'head' ? 1.18 : 1.12), 0.34, 1.20),
            1,
            fatalDrop
              ? THREE.MathUtils.clamp(1.85 + (this.ragdollFallDistance - 8.25) * 0.14, 1.85, 2.85)
              : part === 'head' ? (impactKills ? 2.30 : 1.88)
                : impactKills ? 1.85 : 1.45,
            { impactVelocity: event.velocityBefore },
          );
        } else {
          this.bloodDecals.spawn(
            hit.position, hit.normal, size,
            THREE.MathUtils.clamp(damage / 48, 0.26, 1),
          );
        }
        this.bloodDecalCooldown = part === 'head' ? 0.018 : 0.04;
      }

      // Death does not stop physical contact telemetry. Wall -> floor and
      // stair -> head impacts remain independent blood opportunities, but HP is
      // committed only while living. Never kill twice or reset the respawn timer.
      if (alreadyDead) continue;
      if (fatalDrop) {
        // A lethal high-fall landing gets its own passive settling path. This
        // keeps the body fully dynamic through the collapse while preventing
        // late ragdoll helpers from continuously re-injecting rotation.
        this.ragdoll.beginFatalFallSettling(incomingSpeed);
        this.markRagdollDead(`RAGDOLL · IMPACT MORTEL · ${this.ragdollFallDistance.toFixed(1)} m`);
        continue;
      }
      if (damage <= 0) continue;
      this.applyRagdollDamage(
        damage,
        `RAGDOLL · IMPACT ${part === 'head' ? 'TÊTE' : part === 'core' ? 'TORSE' : 'MEMBRE'} · ${incomingSpeed.toFixed(1)} m/s`,
      );
      if (this.health <= 0) continue;
      this.setStatus(
        `${landingDamage > 0 ? 'CHUTE' : 'IMPACT'} · -${damage} HP · ${incomingSpeed.toFixed(1)} m/s`,
      );
    }
  }

  private updateRagdollFallDamage(): void {
    if (!this.ragdoll || this.ragdollMode !== 'pit-fall') return;
    this.refreshRagdollFallDistance();
    if (this.ragdollDamageApplied || !this.ragdoll.isSettled) return;

    // Safety fallback only. Normal gameplay commits fall damage on the actual
    // ground contact in processRagdollImpactEvents(). This path exists for an
    // extremely rare missed contact telemetry case and must not be the normal
    // source of a delayed death.
    const fatalDrop = ragdollDropIsFatal(this.ragdollFallDistance);
    const damage = fatalDrop
      ? Math.max(1, Math.ceil(this.health))
      : pitRagdollDamageForDrop(this.ragdollFallDistance);
    this.ragdollDamageApplied = true;

    if (fatalDrop || damage >= 44) {
      const pelvis = this.ragdoll.getPelvisPosition(this.cameraTarget);
      const fakeImpact: RagdollImpactEvent = {
        bodyId: 'core',
        position: pelvis.clone(),
        velocityBefore: new THREE.Vector3(0, -Math.sqrt(19.62 * Math.max(0, this.ragdollFallDistance)), 0),
        velocityAfter: new THREE.Vector3(),
        velocityChange: 8,
      };
      const floorHit = this.resolveRagdollImpactSurface(fakeImpact);
      if (floorHit && (floorHit.surface === 'floor' || floorHit.surface === 'step')) {
        if (fatalDrop) {
          this.bloodDecals.spawnBurst(
            floorHit.position,
            floorHit.normal,
            THREE.MathUtils.clamp(0.92 + (this.ragdollFallDistance - 8.25) * 0.05, 0.92, 1.20),
            1,
            THREE.MathUtils.clamp(1.85 + (this.ragdollFallDistance - 8.25) * 0.13, 1.85, 2.85),
            { impactVelocity: fakeImpact.velocityBefore },
          );
        } else {
          this.bloodDecals.spawnBurst(
            floorHit.position, floorHit.normal, 0.78, 1,
            THREE.MathUtils.clamp(1.18 + (damage - 44) * 0.018, 1.18, 1.62),
            { impactVelocity: fakeImpact.velocityBefore },
          );
        }
        this.bloodDecalCooldown = fatalDrop ? 0.035 : 0.05;
      }
    }

    if (fatalDrop) {
      this.markRagdollDead(`RAGDOLL · CHUTE MORTELLE · ${this.ragdollFallDistance.toFixed(1)} m`);
      return;
    }

    this.applyRagdollDamage(
      damage,
      `RAGDOLL · CHUTE · ${this.ragdollFallDistance.toFixed(1)} m`,
    );
    if (this.health <= 0) return;
    if (this.killButton) this.killButton.textContent = 'DOWN';
    this.setStatus(`AU SOL · -${damage} HP · ${this.ragdollFallDistance.toFixed(1)} m`);
  }

  private refreshRecoveryAvailability(wideSearch = false): void {
    this.recoveryStandPosition = null;
    this.recoveryGroundAvailable = false;
    // Always evaluate a nearby standing spot for a living ragdoll. Prompt
    // visibility is intentionally independent from the sleep state so combat
    // knockdowns can never hide the E affordance forever because one limb keeps
    // Rapier awake.
    if (this.ragdollMode !== 'pit-fall' || !this.ragdoll || !this.physics
      || this.health <= 0 || this.recovery) {
      this.updateRecoveryPrompt();
      return;
    }
    const pelvis = this.ragdoll.getPelvisPosition(new THREE.Vector3());
    const ignoredBodies = this.ragdoll.getOwnedBodyHandles();
    this.recoveryStandPosition = this.physics.findStandingRecoveryPosition(
      pelvis, ignoredBodies, wideSearch,
    );

    // A combat knockdown starts from a known-good live capsule. The body can be
    // projected farther than the old 1.45 m fallback radius, and an NPC can
    // temporarily block the immediate pelvis ring. Retry around the exact entry
    // capsule while it is still on the same floor. The vertical cap prevents a
    // real pit fall from teleporting back to the rim.
    if (!this.recoveryStandPosition && this.recoveryEntryStandValid) {
      const dx = this.recoveryEntryStandPosition.x - pelvis.x;
      const dz = this.recoveryEntryStandPosition.z - pelvis.z;
      const horizontalDistance = Math.hypot(dx, dz);
      const verticalDistance = Math.abs(this.recoveryEntryStandPosition.y - pelvis.y);
      if (horizontalDistance <= 3.25 && verticalDistance <= 1.45) {
        this.recoveryStandPosition = this.physics.findStandingRecoveryPosition(
          this.recoveryEntryStandPosition, ignoredBodies, true,
        );
      }
    }

    this.recoveryGroundAvailable = this.recoveryStandPosition !== null;
    this.updateRecoveryPrompt();
  }

  private canStartRecovery(): boolean {
    return canGetUp({
      alive: this.health > 0,
      ragdollMode: this.ragdollMode,
      settled: recoveryReadyForInput(this.ragdoll?.isRecoveryReady ?? false, this.ragdollElapsed),
      recovering: this.recovery !== null,
      groundAvailable: this.recoveryGroundAvailable,
      inputEnabled: this.ready,
    });
  }

  private updateRecoveryPrompt(): void {
    if (!this.recoveryPrompt) return;
    const visible = shouldShowGetUpPrompt({
      alive: this.health > 0,
      ragdollMode: this.ragdollMode,
      recovering: this.recovery !== null,
      inputEnabled: this.ready,
    });
    const key = this.recoveryPrompt.querySelector('kbd');
    if (key) key.textContent = formatKeyLabel(this.settings.controls.interact);
    this.recoveryPrompt.classList.toggle('visible', visible);
    this.recoveryPrompt.setAttribute('aria-hidden', String(!visible));
  }

  private disposeTransientCorpse(root: THREE.Group): void {
    this.scene.remove(root);
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      // The clone shares geometry/textures with the reusable player. Only the
      // materials made for this transient corpse are owned by it.
      for (const material of materials) material.dispose();
    });
  }

  private startGetUp(): void {
    if (!this.canStartRecovery() || !this.ragdoll || !this.physics
      || !this.player || !this.activeCorpseRoot || !this.character) return;
    const ragdoll = this.ragdoll;
    const root = this.activeCorpseRoot;
    const character = root.children[0] as THREE.Group | undefined;
    if (!character) return;
    const hipPose = ragdoll.getPelvisPose(new THREE.Vector3(), new THREE.Quaternion());
    const anatomicalRotation = hipPose.rotation.clone()
      .multiply(this.recoveryRestHipsRotation.clone().invert());
    this.recoveryFront.set(0, 0, 1).applyQuaternion(anatomicalRotation);
    const side = chooseGetUpSide(this.recoveryFront.dot(this.recoveryWorldUp));
    const clipId: AnimationId = side === 'back' ? 'stand-up-back' : 'stand-up-belly';
    const clip = this.animations.get(clipId)?.clip;
    if (!clip) {
      this.setStatus('ANIMATION DE RELEVÉ INDISPONIBLE');
      return;
    }

    const initialStand = this.recoveryStandPosition?.clone();
    if (!initialStand) {
      this.setStatus('AU SOL · AUCUNE POSITION DE RELEVÉ');
      return;
    }
    let recovery: GetUpRecovery;
    try {
      recovery = new GetUpRecovery(root, character, clip, side, initialStand.y - 0.865);
      // IMPORTANT: `initialStand` is the capsule center already validated by
      // PhysicsWorld. Do not re-run clearance around the FBX-derived target: the
      // supplied get-up clips have their own lying root offsets and that second
      // query could reject a perfectly valid recovery after E was pressed.
      // Retarget the authored animation to the reserved safe center instead.
      recovery.retargetStandingPosition(initialStand);
    } catch (error) {
      console.error('[get-up] Unable to prepare recovery', error);
      this.setStatus('ERREUR ANIMATION DE RELEVÉ');
      return;
    }

    // Start the animation mixer before destroying the physical ragdoll. This is
    // synchronous, so physics cannot fight the pose for a frame; more importantly,
    // an unexpected animation setup error leaves the still-living ragdoll intact
    // instead of stranding the player with input disabled and no recovery state.
    try {
      recovery.start();
    } catch (error) {
      recovery.dispose();
      console.error('[get-up] Unable to start recovery', error);
      this.setStatus('ERREUR ANIMATION DE RELEVÉ');
      return;
    }

    // Do not remove an articulated ragdoll body-by-body here. Rapier 0.19.3's
    // JS removal path enumerates attached impulse joints through a wasm callback;
    // in Vite this can invalidate the wasm binding (`wasm is undefined`) and
    // freeze every subsequent physics access. Disable the complete articulated
    // rig instead, then let World.free() reclaim it with the rest of the world.
    // The get-up animation owns the visual skeleton from this point onward.
    ragdoll.suspendForRecovery();
    this.recoveryRequested = false;
    this.ragdoll = undefined;
    this.ragdollMode = null;
    this.ragdollElapsed = 0;
    this.ragdollDamageApplied = false;
    this.recovery = recovery;
    this.recoveryStandPosition = initialStand.clone();
    this.recoveryGroundAvailable = false;
    this.player.setInputEnabled(false);
    this.player.setCameraMotionEnabled(false);
    this.setStatus(`SE RELEVER · ${side === 'back' ? 'SUR LE DOS' : 'SUR LE VENTRE'}`);
    this.updateRecoveryPrompt();
    this.applyViewMode(true);
  }

  private finishGetUp(): void {
    if (!this.recovery || !this.recovery.isFinished || !this.physics || !this.player
      || !this.character || !this.firstPersonCharacter || !this.mixer || !this.firstPersonMixer) return;
    const recovery = this.recovery;
    // Recheck with the released ragdoll gone. Never reactivate a standing capsule
    // through a wall, ceiling, another corpse or over an unsupported pit lip.
    const revalidatedSafe = this.physics.findStandingRecoveryPosition(recovery.standingPosition);
    // The destination was already validated before the physical ragdoll was
    // released. A transient dynamic blocker (most often the combat NPC) must
    // never leave the player permanently frozen at the final get-up frame.
    // Prefer a fresh clearance result, but fall back to the reserved nearby
    // standing center that was validated at recovery start.
    const safe = revalidatedSafe ?? this.recoveryStandPosition?.clone() ?? recovery.standingPosition.clone();

    const source = recovery.root.children[0] as THREE.Group;
    this.mixer.stopAllAction();
    this.firstPersonMixer.stopAllAction();
    copyGetUpPose(source, this.character);
    copyGetUpPose(source, this.firstPersonCharacter);
    const handoff = captureGetUpPoseClip(this.character, 'GetUp_FinalHandoff');
    this.recoveryHandoffClip = handoff;
    this.recoveryHandoffCleanup = 0.65;
    const hold = this.mixer.clipAction(handoff);
    const firstPersonHold = this.firstPersonMixer.clipAction(handoff);
    for (const action of [hold, firstPersonHold]) {
      action.reset().setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
    }
    this.mixer.update(0);
    this.firstPersonMixer.update(0);

    this.currentAction = hold;
    this.firstPersonCurrentAction = firstPersonHold;
    this.currentAnimation = recovery.side === 'back' ? 'stand-up-back' : 'stand-up-belly';

    const lastRecoveryCameraPosition = this.firstPersonCamera.position.clone();
    const lastRecoveryCameraRotation = this.firstPersonCamera.quaternion.clone();

    // Preserve HP and damage history: recovery is not a respawn.
    this.physics.setPlayerColliderEnabled(true);
    this.player.teleport(safe);
    this.player.setIncapacitated(false);
    this.player.setCameraMotionEnabled(this.viewMode === 'first-person');
    this.firstPersonCamera.near = 0.01;
    this.firstPersonCamera.updateProjectionMatrix();
    this.bodyYaw = recovery.root.rotation.y;
    this.avatarAnchor.rotation.y = this.bodyYaw;
    this.mixer.timeScale = 1;
    this.firstPersonMixer.timeScale = 1;

    recovery.dispose();
    this.disposeTransientCorpse(recovery.root);
    this.recovery = null;
    this.activeCorpseRoot = undefined;
    this.recoveryStandPosition = null;
    this.recoveryGroundAvailable = false;
    this.recoveryRequested = false;
    this.recoveryEntryStandValid = false;
    this.ragdollFallPeakY = 0;
    this.ragdollFallDistance = 0;
    this.ragdollDamageApplied = false;
    this.pitEdgeRisk = 0;
    this.pitControlGrace = 0;
    this.activePitEdge = null;
    this.severeImpactLocked = false;
    this.landingVisualImpulse = 0;
    this.landingAnimationPending = null;
    this.landingAnimationRate = 1;
    this.landingAnimationEndFraction = 1;
    this.fallPoseBlend = 0;
    this.autoCandidate = 'idle';
    this.autoCandidateElapsed = 0;
    this.autoOneShot = null;
    this.pendingStrongTurn = null;
    this.strongTurnLatched = false;
    this.activeAuthoredTurn = null;
    this.airborneAnimation = null;
    this.airborneAnimationRate = 1;
    this.wasAirborne = false;
    this.wasSliding = false;
    this.slideVisualSettled = false;
    this.postureStateInitialized = false;
    this.wasLowVisual = false;
    this.idleResumeMode = 'sleeping';
    this.idleNeedsEntry = false;
    this.idleSequencePhase = 'sleeping';
    this.idleSequenceElapsed = 0;
    this.idleSequenceOneShot = null;
    this.playbackMode = 'auto';
    this.modeButton?.classList.add('is-active');
    this.playAnimation('idle', true, 1, false, true);
    this.resetRagdollMotionHistory();
    this.player.setInputEnabled(false);
    // Keep the actual recovery orientation. Snapping the transform here used
    // to erase it and instantly face the player's saved mouse direction.
    this.continuousViewYaw = Math.PI + this.player.getContinuousAimYawRadians();
    this.headLookYaw = 0;
    this.beginActionFacingReturn();
    this.updateAvatarTransform(0);
    this.applyViewMode(true);
    if (this.viewMode === 'first-person') {
      this.recoveryCameraBlend = 0;
      this.recoveryCameraStartPosition.copy(lastRecoveryCameraPosition);
      this.recoveryCameraStartRotation.copy(lastRecoveryCameraRotation);
      this.player.setCameraMotionEnabled(false);
    } else {
      this.recoveryCameraBlend = -1;
      this.player.setInputEnabled(this.player.isLocked);
    }
    this.killButton?.removeAttribute('disabled');
    if (this.killButton) this.killButton.textContent = 'KILL';
    this.accumulator = 0;
    this.setStatus('DEBOUT');
    this.updateRecoveryPrompt();
    this.updateHud();
  }

  private killPlayer(options: { quietStart?: boolean } = {}): void {
    this.startRagdoll({ fatal: true, quietStart: options.quietStart });
  }

  private startRagdoll(options: {
    fatal: boolean;
    quietStart?: boolean;
    addedVelocity?: Readonly<THREE.Vector3>;
    addedYawRate?: number;
    status?: string;
    meleeImpact?: {
      direction: Readonly<THREE.Vector3>;
      strength: number;
      zone: CombatHitZone;
      point?: Readonly<THREE.Vector3>;
    };
  }): void {
    if (!this.ready || this.ragdoll || this.recovery || this.recoveryCameraBlend >= 0 || !this.physics || !this.player || !this.character) return;
    if (options.fatal) {
      this.health = 0;
      this.damageFlash = Math.max(this.damageFlash, 0.92);
    }
    this.secondsSinceDamage = 0;
    this.updateHealthUi();

    // Capture gameplay motion before disabling input: this includes horizontal
    // locomotion plus the current jump/fall vertical speed, regardless of the
    // animation or posture currently displayed. Edge tumbles add only a small
    // inward/downward component so the body naturally commits into the opening.
    const state = this.player.getDebugState();
    // Preserve the exact valid live capsule center before the collider is
    // disabled. This gives living combat knockdowns a deterministic recovery
    // anchor even if the ragdoll slides against the NPC or a nearby step.
    this.physics.getStandingPosition(this.recoveryEntryStandPosition);
    this.recoveryEntryStandValid = !options.fatal;
    const quietStart = options.quietStart === true;
    const animationMotion = quietStart ? undefined : this.buildRagdollAnimationMotion();
    const inheritedVelocity = quietStart
      ? new THREE.Vector3(0, 0, 0)
      : new THREE.Vector3(state.velocity.x, state.velocity.y, state.velocity.z);
    if (!quietStart && options.addedVelocity) inheritedVelocity.add(options.addedVelocity);
    const yawRate = THREE.MathUtils.clamp(
      THREE.MathUtils.degToRad(this.bodyTurnRate) + (options.addedYawRate ?? 0),
      -4.5,
      4.5,
    );

    // Clone the *evaluated* world rig at the exact hand-off frame. The clone
    // becomes the physical body while the original rig stays reusable for a
    // future respawn/recovery implementation.
    this.avatarAnchor.updateMatrixWorld(true);
    this.character.updateMatrixWorld(true);
    const corpseRoot = new THREE.Group();
    corpseRoot.name = `AnimationLabCorpseRoot_${this.corpses.length + 1}`;
    corpseRoot.position.copy(this.avatarAnchor.position);
    corpseRoot.quaternion.copy(this.avatarAnchor.quaternion);
    corpseRoot.scale.copy(this.avatarAnchor.scale);
    const corpseCharacter = cloneSkeleton(this.character) as THREE.Group;
    corpseCharacter.name = `AnimationLabCorpse_${this.corpses.length + 1}`;
    corpseCharacter.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.visible = true;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const corpseMaterials = sourceMaterials.map((sourceMaterial) => sourceMaterial.clone());
      for (const material of corpseMaterials) {
        material.transparent = false;
        material.opacity = 1;
        material.depthTest = true;
        material.depthWrite = true;
        material.needsUpdate = true;
      }
      mesh.material = Array.isArray(mesh.material) ? corpseMaterials : corpseMaterials[0]!;
    });
    corpseRoot.add(corpseCharacter);
    this.scene.add(corpseRoot);
    corpseRoot.updateMatrixWorld(true);

    this.physics.setPlayerColliderEnabled(false);
    try {
      this.ragdoll = RagdollSystem.create(this.physics, corpseCharacter, {
        velocity: inheritedVelocity,
        yawRateRadians: quietStart ? 0 : yawRate,
        animationMotion,
        quietStart,
        // Pit falls should look like a balance loss, not a synthetic death kick.
        // The coherent bias remains enabled so inherited movement carries the
        // torso and legs into the opening as one believable fall.
        tipScale: quietStart || options.meleeImpact ? 0 : (options.fatal
          ? (this.playbackMode === 'forced' ? 0.35 : 1)
          : 0.82),
        variationScale: quietStart || options.meleeImpact || this.playbackMode === 'forced'
          ? 0
          : (options.fatal ? 1 : 0.32),
        // A living pit fall gets the full short reflex window. Fatal ragdolls
        // keep a softer version so running/walking inertia can still continue
        // without making a death look consciously controlled for too long.
        activeResponseScale: quietStart ? 0 : options.meleeImpact ? 0.16 : (options.fatal ? 0.76 : 1),
      });
      if (options.meleeImpact) {
        this.ragdoll.applyMeleeImpact(
          options.meleeImpact.direction,
          options.meleeImpact.strength,
          options.meleeImpact.zone,
          options.meleeImpact.point,
        );
      }
      this.activeCorpseRoot = corpseRoot;
      this.ragdollMode = options.fatal ? 'dead' : 'pit-fall';
      this.recoveryStandPosition = null;
      this.recoveryGroundAvailable = false;
      this.recoveryRequested = false;
      this.recoveryCameraBlend = -1;
      this.updateRecoveryPrompt();
      this.ragdollDamageApplied = options.fatal;
      const pelvis = this.ragdoll.getPelvisPosition(this.cameraTarget);
      this.ragdollFallPeakY = pelvis.y;
      this.ragdollFallDistance = 0;
      this.ragdollElapsed = 0;
      this.bloodDecalCooldown = 0;
      this.bloodImpactGate.reset();
    } catch (error) {
      this.physics.setPlayerColliderEnabled(true);
      this.ragdoll = undefined;
      this.ragdollMode = null;
      this.ragdollElapsed = 0;
      this.scene.remove(corpseRoot);
      this.setStatus('ERREUR RAGDOLL');
      console.error(error);
      return;
    }

    // The corpse clone now owns the exact evaluated combat/locomotion pose.
    // Combat layers can be cleared on the reusable avatar without changing the physical hand-off.
    this.resetCombatState(true);

    // From this point on the kinematic capsule is no longer stepped. The
    // physical skeleton owns the fall and remains on the ground when non-lethal.
    this.mixer!.timeScale = 0;
    this.firstPersonMixer!.timeScale = 0;
    this.player.setInputEnabled(false);
    this.player.setCameraMotionEnabled(false);

    const headPose = this.ragdoll.getHeadPose(this.deadHeadPosition, this.deadHeadRotation);
    const inverseHead = headPose.rotation.clone().invert();
    this.deadCameraHeadCorrection
      .copy(inverseHead)
      .multiply(this.firstPersonCamera.quaternion)
      .normalize();

    this.deadCameraUp
      .set(0, 1, 0)
      .applyQuaternion(headPose.rotation)
      .normalize();
    this.deadCameraForward
      .set(0, 0, -1)
      .applyQuaternion(this.firstPersonCamera.quaternion)
      .addScaledVector(
        this.deadCameraUp,
        -this.deadCameraForward.dot(this.deadCameraUp),
      );
    if (this.deadCameraForward.lengthSq() < 1e-5) {
      this.deadCameraForward
        .set(Math.sin(this.bodyYaw), 0, Math.cos(this.bodyYaw))
        .addScaledVector(
          this.deadCameraUp,
          -this.deadCameraForward.dot(this.deadCameraUp),
        );
    }
    this.deadCameraForward.normalize();
    this.deadCameraFaceForwardLocal
      .copy(this.deadCameraForward)
      .applyQuaternion(inverseHead)
      .normalize();
    this.deadCameraHeadOffset
      .copy(this.deadCameraForward)
      .multiplyScalar(DEAD_CAMERA_FACE_FORWARD)
      .addScaledVector(this.deadCameraUp, DEAD_CAMERA_FACE_UP)
      .applyQuaternion(inverseHead);
    this.firstPersonCamera.near = DEAD_CAMERA_NEAR_CLIP;
    this.firstPersonCamera.updateProjectionMatrix();
    this.deadAimYaw = this.player.getContinuousAimYawRadians();
    this.deadAimPitch = state.view.pitch;
    this.respawnElapsed = 0;

    this.killButton?.setAttribute('disabled', '');
    if (this.killButton) this.killButton.textContent = options.fatal ? 'DEAD' : 'DOWN';
    this.setStatus(options.status ?? 'RAGDOLL');
    this.motionFx.style.setProperty('--motion-blur', '0px');
    this.motionFx.style.setProperty('--motion-opacity', '0');
    this.accumulator = 0;
    this.applyViewMode(true);
    this.updateHud();
  }

  private chooseRespawnPoint(): THREE.Vector3 {
    const candidates = [
      new THREE.Vector3(MOVEMENT_LAB_SPAWN.x, PLAYER_RESPAWN_CENTER_Y, MOVEMENT_LAB_SPAWN.z),
      new THREE.Vector3(MOVEMENT_LAB_SPAWN.x + 3, PLAYER_RESPAWN_CENTER_Y, MOVEMENT_LAB_SPAWN.z),
      new THREE.Vector3(MOVEMENT_LAB_SPAWN.x, PLAYER_RESPAWN_CENTER_Y, MOVEMENT_LAB_SPAWN.z + 3),
      new THREE.Vector3(MOVEMENT_LAB_SPAWN.x + 3, PLAYER_RESPAWN_CENTER_Y, MOVEMENT_LAB_SPAWN.z + 3),
    ];
    for (const candidate of candidates) {
      const blocked = this.corpses.some(({ ragdoll }) => {
        const pelvis = ragdoll.getPelvisPosition(this.tempDirection);
        return Math.abs(pelvis.y - candidate.y) < 1.8
          && Math.hypot(pelvis.x - candidate.x, pelvis.z - candidate.z) < 1.25;
      });
      if (!blocked) return candidate;
    }
    return candidates[0]!;
  }

  private respawnPlayer(): void {
    if (!this.ragdoll || !this.activeCorpseRoot || !this.physics || !this.player) return;

    // Keep the dead body and all its Rapier bodies/joints alive. Once it becomes
    // a persistent corpse, let the live character controller treat it as a low
    // dynamic obstacle eligible for autostep instead of a waist-high blocker.
    this.ragdoll.setPlayerTraversalEnabled(true);
    this.corpses.push({ root: this.activeCorpseRoot, ragdoll: this.ragdoll });
    this.ragdoll = undefined;
    this.ragdollMode = null;
    this.ragdollElapsed = 0;
    this.recoveryStandPosition = null;
    this.recoveryGroundAvailable = false;
    this.recoveryRequested = false;
    this.recoveryEntryStandValid = false;
    this.updateRecoveryPrompt();
    this.ragdollDamageApplied = false;
    this.ragdollFallPeakY = 0;
    this.ragdollFallDistance = 0;
    this.bloodDecalCooldown = 0;
    this.pitEdgeRisk = 0;
    this.pitControlGrace = 0;
    this.activePitEdge = null;
    this.activeCorpseRoot = undefined;
    this.respawnElapsed = 0;
    this.health = MAX_HEALTH;
    this.secondsSinceDamage = Number.POSITIVE_INFINITY;
    this.damageFlash = 0;
    this.updateHealthUi();

    // A severe landing owns several state machines outside PlayerController.
    // Clear every one of them BEFORE the new player is stepped/rendered; merely
    // teleporting the controller is not enough because severeImpactLocked used
    // to survive the respawn and immediately re-enter Falling Flat Impact.
    this.severeImpactLocked = false;
    this.landingVisualImpulse = 0;
    this.landingAnimationPending = null;
    this.landingAnimationRate = 1;
    this.landingAnimationEndFraction = 1;
    this.fallPoseBlend = 0;

    this.physics.setPlayerColliderEnabled(true);
    this.player.teleport(this.chooseRespawnPoint());
    this.player.setIncapacitated(false);
    this.player.setInputEnabled(this.player.isLocked);
    this.player.setCameraMotionEnabled(this.viewMode === 'first-person');
    this.firstPersonCamera.near = 0.01;
    this.firstPersonCamera.updateProjectionMatrix();

    if (this.mixer) this.mixer.timeScale = 1;
    if (this.firstPersonMixer) this.firstPersonMixer.timeScale = 1;
    this.playbackMode = 'auto';
    this.modeButton?.classList.add('is-active');

    // Respawn is always a clean standing idle, never a continuation of the
    // one-shot/impact/airborne animation that killed the previous body.
    this.autoCandidate = 'idle';
    this.autoCandidateElapsed = 0;
    this.autoOneShot = null;
    this.pendingStrongTurn = null;
    this.strongTurnLatched = false;
    this.activeAuthoredTurn = null;
    this.airborneAnimation = null;
    this.airborneAnimationRate = 1;
    this.wasAirborne = false;
    this.wasSliding = false;
    this.slideVisualSettled = false;
    this.postureStateInitialized = false;
    this.wasLowVisual = false;
    this.idleResumeMode = 'sleeping';
    this.idleNeedsEntry = false;
    this.idleSequencePhase = 'sleeping';
    this.idleSequenceElapsed = 0;
    this.idleSequenceOneShot = null;
    this.playAnimation('idle', true, 1, false, true);
    this.resetRagdollMotionHistory();

    this.updateAvatarTransform(0, true);
    this.applyViewMode(true);
    this.killButton?.removeAttribute('disabled');
    if (this.killButton) this.killButton.textContent = 'KILL';
    this.setStatus('PRÊT');
    this.accumulator = 0;
    this.updateHud();
  }

  private updateDeadFirstPersonCamera(delta: number, snap = false): void {
    if ((!this.ragdoll && !this.recovery) || !this.player) return;
    const headPose = (this.recovery ?? this.ragdoll)!.getHeadPose(this.deadHeadPosition, this.deadHeadRotation);
    this.deadCameraTargetPosition
      .copy(this.deadCameraHeadOffset)
      .applyQuaternion(headPose.rotation)
      .add(headPose.position);

    // Follow the head tightly, but keep a little smoothing so ragdoll contacts do
    // not turn into camera micro-jitter.
    const positionAlpha = snap ? 1 : expAlpha(delta, 30);
    this.firstPersonCamera.position.lerp(this.deadCameraTargetPosition, positionAlpha);

    // Smoothing is allowed to lag, but it is NEVER allowed to lag through the
    // face. Clamp the camera to a plane in front of the current head orientation
    // every frame. This is what prevents the nose/eyes/skull from flashing across
    // the screen during the first violent head rotation after KILL.
    this.deadCameraFaceForwardWorld
      .copy(this.deadCameraFaceForwardLocal)
      .applyQuaternion(headPose.rotation)
      .normalize();
    const forwardDistance = this.deadCameraRelative
      .copy(this.firstPersonCamera.position)
      .sub(headPose.position)
      .dot(this.deadCameraFaceForwardWorld);
    if (forwardDistance < DEAD_CAMERA_FACE_SAFE_FORWARD) {
      this.firstPersonCamera.position.addScaledVector(
        this.deadCameraFaceForwardWorld,
        DEAD_CAMERA_FACE_SAFE_FORWARD - forwardDistance,
      );
    }

    // Keep only a small post-mortem look cone. Mouse input still feeds the
    // PlayerController's look authority, but never rotates or moves the corpse.
    const yawOffset = THREE.MathUtils.clamp(
      this.player.getContinuousAimYawRadians() - this.deadAimYaw,
      -THREE.MathUtils.degToRad(16),
      THREE.MathUtils.degToRad(16),
    );
    const pitchOffset = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(
      this.player.getDebugState().view.pitch - this.deadAimPitch,
      -11,
      11,
    ));
    this.deadCameraLookOffset.setFromEuler(new THREE.Euler(pitchOffset, yawOffset, 0, 'YXZ'));
    const targetRotation = this.tempQuaternionA
      .copy(headPose.rotation)
      .multiply(this.deadCameraHeadCorrection)
      .multiply(this.deadCameraLookOffset)
      .normalize();
    this.firstPersonCamera.quaternion.slerp(targetRotation, snap ? 1 : expAlpha(delta, 20));

    const targetFov = this.settings.fieldOfView;
    const nextFov = snap
      ? targetFov
      : THREE.MathUtils.lerp(this.firstPersonCamera.fov, targetFov, expAlpha(delta, 5));
    if (Math.abs(nextFov - this.firstPersonCamera.fov) > 0.001) {
      this.firstPersonCamera.fov = nextFov;
      this.firstPersonCamera.updateProjectionMatrix();
    }
  }

  private readonly onCombatMouseDown = (event: MouseEvent): void => {
    if (!this.ready || !this.player?.isLocked || event.target !== this.renderer.domElement) return;
    if (this.ragdoll || this.recovery || this.player.isIncapacitated || this.combatHitReaction) return;
    if (event.button === 2) {
      event.preventDefault();
      const state = this.player.getDebugState();
      const intent = this.player.getMovementIntent();
      if (
        state.sprinting
        || (this.player.isSprintRequested() && intent.forward >= MOVEMENT_TUNING.locomotion.sprintForwardMin)
      ) {
        this.combatPointerHeld = false;
        return;
      }
      this.combatPointerHeld = true;
      this.combatLatchReason = 'manual';
      this.combatLatchSeconds = MANUAL_GUARD_RELEASE_SECONDS;
      this.requestCombatGuard('manual');
      return;
    }
    if (event.button !== 0) return;
    if (!this.combatAttackGuardActive()) {
      // Reject the whole press before ground kicks, counters or tap buffering.
      // Raising guard later must never resurrect an unguarded click.
      this.combatLeftPointerHeld = false;
      this.combatLeftPressConsumed = true;
      this.combatBufferedPunchSeconds = 0;
      this.combatBufferedFromHold = false;
      this.combatHeavyTapDetector.cancel();
      this.combatHeavyUpgradePending = false;
      return;
    }
    this.combatImpactAudio.unlock();

    // A downed/recovering opponent turns LMB into a contextual kick before the
    // ordinary punch/counter classifier runs. This prevents a useless standing
    // punch from playing over a body on the floor.
    if (this.tryStartGroundKick()) {
      event.preventDefault();
      this.combatLeftPointerHeld = true;
      this.combatLeftPressConsumed = true;
      this.combatHeavyUpgradePending = false;
      return;
    }

    // F+LMB is a defensive counter input only. It never becomes a normal or
    // heavy punch: holding F and mashing the mouse outside a real incoming
    // strike window therefore does absolutely nothing. A single click inside the
    // telegraphed front-facing window cancels the hostile hit and plays one Hook counter.
    if (this.combatCounterModifierHeld) {
      event.preventDefault();
      this.combatLeftPointerHeld = true;
      this.combatLeftPressConsumed = true;
      this.combatHeavyTapDetector.cancel();
      this.combatHeavyUpgradePending = false;
      if (combatHookCounterAllowed(true, this.npcCounterWindowIsOpen())) this.executeHookCounter();
      return;
    }

    if (this.combatLatchReason === 'manual' && this.combatPhase !== 'none') {
      // Attacking from guard keeps the fists up for a fresh 1.5 s after the
      // click, unless locomotion shortens that grace to the 0.3 s move release.
      this.combatLatchSeconds = MANUAL_GUARD_RELEASE_SECONDS;
    }
    this.combatLeftPointerHeld = true;
    this.combatLeftPressStart = this.combatClock;
    this.combatLeftPressConsumed = false;
    // LMB must feel immediate: the light punch starts on press, not on release.
    // Mouse-up is now used only to classify the tap for a possible exact
    // double-click heavy upgrade.
    this.requestNormalCombatPunch();
  };

  private readonly onCombatMouseUp = (event: MouseEvent): void => {
    if (event.button === 2) {
      this.combatPointerHeld = false;
      if (this.combatPhase !== 'none') {
        // Releasing RMB keeps the guard readable for 1.5 s in either view. A
        // quick re-press or a punch from guard refreshes the same grace.
        this.combatLatchSeconds = MANUAL_GUARD_RELEASE_SECONDS;
        if (this.combatLatchReason !== 'hit') this.combatLatchReason = 'manual';
      }
      return;
    }
    if (event.button !== 0) return;
    this.combatLeftPointerHeld = false;
    if (this.combatBufferedFromHold) this.combatBufferedPunchSeconds = 0;
    this.combatBufferedFromHold = false;
    this.combatHeldChainCount = 0;
    if (this.combatLeftPressConsumed || !this.combatIsEligible() || this.combatHitReaction) {
      this.combatLeftPressConsumed = false;
      return;
    }
    if (!combatNormalAttackAllowed(this.combatAttackGuardActive(), false)) return;

    const held = Math.max(0, this.combatClock - this.combatLeftPressStart);
    const heavyTap = this.combatHeavyTapDetector.tap(this.combatClock, held);
    if (heavyTap.cancelledBySpam) this.combatHeavyUpgradePending = false;
    else if (heavyTap.pendingHeavy) {
      // Confirm on the second release itself. Waiting another confirmation delay
      // could push the heavy conversion past the visible impact frame. A third
      // mash click is already rejected by active/recovery anti-spam.
      this.combatHeavyUpgradePending = false;
      this.confirmHeavyDoubleClick();
      this.combatHeavyTapDetector.cancel();
    }
  };

  private readonly onCombatContextMenu = (event: MouseEvent): void => {
    if (this.player?.isLocked) event.preventDefault();
  };

  private readonly onCombatWindowBlur = (): void => {
    if (this.character) this.playerHitHandoff.capture(this.character);
    if (this.firstPersonCharacter) this.firstPersonHitHandoff.capture(this.firstPersonCharacter);
    this.resetCombatState(true);
    this.combatPointerHeld = false;
    this.combatLeftPointerHeld = false;
    this.combatLeftPressConsumed = false;
    this.combatCounterModifierHeld = false;
    this.combatCounterGuaranteedTarget = false;
    this.combatHeavyTapDetector.cancel();
    this.combatHeavyUpgradePending = false;
    this.combatLatchSeconds = 0;
    this.combatLatchReason = null;
    this.combatPostGuardMoveSeconds = 0;
    this.combatAttackRecoverySeconds = 0;
    this.combatBufferedPunchSeconds = 0;
    this.combatHeldChainCount = 0;
    this.combatBufferedFromHold = false;
    this.combatHeldRestSeconds = 0;
    this.combatLockOnActive = false;
    this.combatLockOnDistance = Number.POSITIVE_INFINITY;
    this.player?.setSprintSuppressed(false);
    this.player?.setMovementSpeedScale(1);
  };

  private readonly onGlobalKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || event.defaultPrevented || !this.ready) return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;

    if (event.code === 'KeyF') {
      this.combatCounterModifierHeld = true;
      this.combatHeavyTapDetector.cancel();
      this.combatHeavyUpgradePending = false;
      if (this.combatLeftPointerHeld) this.combatLeftPressConsumed = true;
      // F is a held defensive stance, not a one-shot modifier. Raising it keeps
      // the fight guard alive until the physical key is released; LMB while F is
      // held remains counter-only and can never leak into an ordinary attack.
      if (this.combatIsEligible()) {
        this.combatLatchReason = 'manual';
        this.combatLatchSeconds = MANUAL_GUARD_RELEASE_SECONDS;
        this.requestCombatGuard('manual');
      }
      return;
    }

    // Recovery is deliberately available even if pointer lock was lost during
    // the fall. The E prompt must remain useful whenever the living body is down.
    if (event.code === this.settings.controls.interact && this.recovery?.isFinished) {
      event.preventDefault();
      this.finishGetUp();
      return;
    }
    if (event.code === this.settings.controls.interact && this.ragdollMode !== null && this.ragdollMode !== 'dead') {
      event.preventDefault();
      // E is a request, not a one-frame eligibility check. If the body still
      // needs a fraction of a second to settle or the nearby NPC temporarily
      // blocks the capsule, keep the request armed and start automatically as
      // soon as the already-visible get-up affordance becomes actionable.
      this.recoveryRequested = true;
      this.refreshRecoveryAvailability(true);
      if (!this.canStartRecovery()) {
        this.setStatus(this.recoveryGroundAvailable
          ? 'AU SOL · RELEVÉ EN ATTENTE DE STABILISATION'
          : 'AU SOL · RELEVÉ EN ATTENTE D’UN ESPACE LIBRE');
        return;
      }
      this.startGetUp();
      return;
    }

    if (!this.player?.isLocked) return;
    if (event.code !== 'KeyP' || this.recovery || this.recoveryCameraBlend >= 0) return;
    event.preventDefault();
    this.killPlayer();
  };

  private readonly onGlobalKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'KeyF') {
      this.combatCounterModifierHeld = false;
      if (!this.combatPointerHeld && this.combatLatchReason === 'manual') {
        this.combatLatchSeconds = Math.min(this.combatLatchSeconds, 0.24);
      }
    }
  };

  private readonly onPlayerLockChange = (locked: boolean): void => {
    if (!locked) this.resetCombatState(true);
    this.player?.setInputEnabled(this.ragdoll || this.recovery || this.recoveryCameraBlend >= 0 ? false : locked);
    this.updateRecoveryPrompt();
    this.hint?.classList.toggle('is-hidden', locked);
    this.previousTime = performance.now();
    this.accumulator = 0;
  };

  private readonly onCanvasClick = (): void => {
    if (!this.ready) return;
    this.combatImpactAudio.unlock();
    if (!this.player?.isLocked) this.player?.lock();
  };

  private updateRecoveryCameraBlend(delta: number): void {
    if (this.recoveryCameraBlend < 0 || !this.player) return;
    if (this.viewMode !== 'first-person') {
      this.recoveryCameraBlend = -1;
      this.player.setCameraMotionEnabled(false);
      this.player.setInputEnabled(this.player.isLocked);
      return;
    }
    // PlayerController has already calculated the ordinary gameplay camera.
    this.recoveryCameraTargetPosition.copy(this.firstPersonCamera.position);
    this.recoveryCameraTargetRotation.copy(this.firstPersonCamera.quaternion);
    this.recoveryCameraBlend = Math.min(1, this.recoveryCameraBlend + Math.max(0, delta) / 0.24);
    const t = THREE.MathUtils.smoothstep(this.recoveryCameraBlend, 0, 1);
    this.firstPersonCamera.position.copy(this.recoveryCameraStartPosition)
      .lerp(this.recoveryCameraTargetPosition, t);
    this.firstPersonCamera.quaternion.copy(this.recoveryCameraStartRotation)
      .slerp(this.recoveryCameraTargetRotation, t);
    if (this.recoveryCameraBlend >= 1) {
      this.recoveryCameraBlend = -1;
      this.player.setCameraMotionEnabled(true);
      this.player.setInputEnabled(this.player.isLocked);
    }
  }

  private readonly frame = (now: number): void => {
    this.playerProceduralPose.restore(!this.ragdoll && !this.recovery);
    this.firstPersonProceduralPose.restore(!this.ragdoll && !this.recovery);
    this.npcProceduralPose.restore(!this.npcRagdoll && !this.npcRecovery);
    if (this.disposed || !this.player) return;
    const measuredDelta = Math.max(0, (now - this.previousTime) / 1000);
    const rawDelta = Math.min(0.05, measuredDelta);
    this.previousTime = now;
    this.bloodImpactClock += rawDelta;
    this.combatClock += rawDelta;
    this.currentAnimationElapsed += rawDelta;
    this.updateNpcCombat(rawDelta);
    this.updateHealth(rawDelta);
    if (this.ragdoll || this.recovery) this.evaluateCombatMixers(rawDelta, false);

    if (this.recovery) {
      this.accumulator = Math.min(this.accumulator + rawDelta, MAX_ACCUMULATOR);
      while (this.accumulator >= FIXED_DELTA) {
        this.physics?.stepDynamics(FIXED_DELTA);
        for (const corpse of this.corpses) corpse.ragdoll.passiveUpdate(FIXED_DELTA);
        this.npcRagdoll?.passiveUpdate(FIXED_DELTA);
        this.accumulator -= FIXED_DELTA;
      }
      this.recovery.update(rawDelta);
      if (this.recovery.isFinished) this.finishGetUp();
      if (this.recovery) {
        if (this.viewMode === 'first-person') this.updateDeadFirstPersonCamera(rawDelta);
        else this.updateThirdPersonCamera(rawDelta);
        this.updateMotionFx();
        this.bloodDecals.update(rawDelta);
        this.renderer.render(
          this.scene,
          this.viewMode === 'first-person' ? this.firstPersonCamera : this.thirdPersonCamera,
        );
        return;
      }
    }

    if (this.ragdoll) {
      // Corpse physics must continue even when pointer lock is released. The
      // PlayerController is deliberately not stepped after KILL.
      this.accumulator = Math.min(this.accumulator + rawDelta, MAX_ACCUMULATOR);
      while (this.accumulator >= FIXED_DELTA) {
        this.ragdoll.fixedUpdate(FIXED_DELTA);
        this.processRagdollImpactEvents(FIXED_DELTA);
        this.npcRagdoll?.passiveUpdate(FIXED_DELTA);
        this.accumulator -= FIXED_DELTA;
      }
      this.ragdollElapsed += rawDelta;
      this.updateRagdollFallDamage();
      this.refreshRecoveryAvailability(this.recoveryRequested);
      if (this.recoveryRequested && this.canStartRecovery()) this.startGetUp();
      if (this.viewMode === 'first-person') this.updateDeadFirstPersonCamera(rawDelta);
      else this.updateThirdPersonCamera(rawDelta);
      if (this.ragdollMode === 'dead') {
        this.respawnElapsed += rawDelta;
        if (this.respawnElapsed >= RESPAWN_DELAY_SECONDS) this.respawnPlayer();
      } else {
        // Surviving pit tumbles deliberately stay down until authored get-up
        // animations are supplied; do not silently respawn a living player.
        this.respawnElapsed = 0;
      }
      this.updateMotionFx();

      const instantaneousFps = measuredDelta > 0 ? 1 / measuredDelta : 60;
      this.fps = THREE.MathUtils.lerp(this.fps, instantaneousFps, 0.055);
      this.hudTimer += rawDelta;
      if (this.hudTimer >= 0.1) {
        this.hudTimer = 0;
        this.updateHud();
      }
      this.bloodDecals.update(rawDelta);
      this.renderer.render(this.scene, this.viewMode === 'first-person' ? this.firstPersonCamera : this.thirdPersonCamera);
      return;
    }

    if (this.player.isLocked || this.corpses.length > 0 || this.npcRagdoll) {
      this.accumulator = Math.min(this.accumulator + rawDelta, MAX_ACCUMULATOR);
      while (this.accumulator >= FIXED_DELTA) {
        if (this.player.isLocked) {
          this.player.fixedUpdate(FIXED_DELTA);
          if (this.corpses.length > 0 && this.physics) {
            const diagnostics = this.player.getDebugState();
            this.physics.getPosition(this.corpsePlayerPosition);
            this.corpsePlayerVelocity.set(
              diagnostics.velocity.x, diagnostics.velocity.y, diagnostics.velocity.z,
            );
            for (const corpse of this.corpses) {
              corpse.ragdoll.nudgeFromPlayer(this.corpsePlayerPosition, this.corpsePlayerVelocity);
            }
          }
        } else this.physics?.stepDynamics(FIXED_DELTA);
        for (const corpse of this.corpses) corpse.ragdoll.passiveUpdate(FIXED_DELTA);
        this.npcRagdoll?.passiveUpdate(FIXED_DELTA);
        this.accumulator -= FIXED_DELTA;
      }
      if (this.player.isLocked) this.player.renderUpdate(rawDelta, this.accumulator / FIXED_DELTA);
    } else {
      this.accumulator = 0;
    }

    // Guard lock-on updates the pointer-lock yaw before the avatar/body follow is
    // evaluated, so camera, torso and locomotion all agree on the same target in
    // this frame rather than chasing it one frame apart.
    this.updateCombatLockOn(rawDelta);
    this.updateAvatarTransform(rawDelta);
    if (this.viewMode === 'third-person') this.updateThirdPersonCamera(rawDelta);
    if (this.playbackMode === 'auto') this.updateAutoAnimation(rawDelta);
    else {
      this.currentAction?.setEffectiveTimeScale(this.playbackSpeed);
      this.firstPersonCurrentAction?.setEffectiveTimeScale(this.playbackSpeed);
    }
    this.evaluateCombatMixers(rawDelta);
    this.applyLocomotionWeightShift(rawDelta);
    this.applyLocomotionFootPlants(rawDelta);
    this.applyFirstPersonCombatRootStabilization();
    this.applyCombatGuardTorsoAlignment();
    this.applyThirdPersonCombatDodgePose();
    this.applyNpcCombatStrikeAimCorrection();
    this.applyCombatStrikeAimCorrection();
    this.applyGroundKickPose();
    this.resolveGroundKickImpact(rawDelta);
    // Sample the final evaluated fists after additive strike + procedural aim.
    // Damage now follows the actual swept hand path instead of an animation timer.
    this.captureRagdollMotionFrame(rawDelta);
    if (this.idleNpcCharacter && !this.npcRagdoll && !this.npcRecovery) this.npcMotionHistory.capture(this.idleNpcCharacter, rawDelta);
    this.resolveCombatContacts(rawDelta);
    this.applyCombatImpactResponse(rawDelta);
    this.copyCombatPoseToFirstPerson();
    if (this.recoveryHandoffClip) {
      this.recoveryHandoffCleanup -= rawDelta;
      if (this.recoveryHandoffCleanup <= 0) {
        this.mixer?.uncacheClip(this.recoveryHandoffClip);
        this.firstPersonMixer?.uncacheClip(this.recoveryHandoffClip);
        this.recoveryHandoffClip = undefined;
      }
    }
    this.applyFirstPersonArmTuning(rawDelta);
    this.applyFallMotion(rawDelta);
    this.applyHeadLook(rawDelta);
    this.updatePitEdgeRisk(rawDelta);
    if (this.ragdoll) {
      // The ragdoll cloned the fully evaluated animation pose above. Render the
      // physical hand-off immediately; physics starts advancing next frame.
      this.updateMotionFx();
      this.bloodDecals.update(rawDelta);
      this.renderer.render(
        this.scene,
        this.viewMode === 'first-person' ? this.firstPersonCamera : this.thirdPersonCamera,
      );
      return;
    }
    if (this.viewMode === 'first-person') {
      this.updateFirstPersonBodyTransform(rawDelta);
      this.applyFirstPersonCombatFraming(rawDelta);
      this.applyFirstPersonArmCameraSafety(rawDelta);
      this.applyFirstPersonGuardPose();
    }
    this.updateRecoveryCameraBlend(rawDelta);
    this.applyFirstPersonMeleeHitCameraFeedback(rawDelta);
    this.updateMotionFx();
    this.bloodDecals.update(rawDelta);

    const instantaneousFps = measuredDelta > 0 ? 1 / measuredDelta : 60;
    this.fps = THREE.MathUtils.lerp(this.fps, instantaneousFps, 0.055);
    this.hudTimer += rawDelta;
    if (this.hudTimer >= 0.1) {
      this.hudTimer = 0;
      this.updateHud();
    }
    this.renderer.render(this.scene, this.viewMode === 'first-person' ? this.firstPersonCamera : this.thirdPersonCamera);
  };

  private updateMotionFx(): void {
    if (this.ragdoll || !this.player || !this.settings.cameraMotion || this.viewMode !== 'first-person') {
      this.motionFx.style.setProperty('--motion-blur', '0px');
      this.motionFx.style.setProperty('--motion-opacity', '0');
      return;
    }
    const state = this.player.getDebugState();
    if (!state.sprinting) {
      // Walking keeps natural bob/inertia but no speed blur. This is deliberately
      // keyed to sprinting, not raw velocity, so ordinary walking stays crisp.
      this.motionFx.style.setProperty('--motion-blur', '0px');
      this.motionFx.style.setProperty('--motion-opacity', '0');
      return;
    }
    const sprintBlend = THREE.MathUtils.clamp(
      (state.horizontalSpeed - MOVEMENT_TUNING.locomotion.walkSpeed)
        / Math.max(0.001, MOVEMENT_TUNING.locomotion.sprintSpeed - MOVEMENT_TUNING.locomotion.walkSpeed),
      0,
      1,
    );
    const accelerationBlend = THREE.MathUtils.clamp(Math.max(0, state.horizontalAcceleration) / 16, 0, 1);
    const blur = 0.1 + sprintBlend * 0.42 + accelerationBlend * 0.12;
    const opacity = THREE.MathUtils.clamp(0.12 + sprintBlend * 0.34 + accelerationBlend * 0.1, 0, 0.58);
    this.motionFx.style.setProperty('--motion-blur', `${blur.toFixed(2)}px`);
    this.motionFx.style.setProperty('--motion-opacity', opacity.toFixed(3));
  }

  private updateHud(): void {
    if (!this.player) return;
    const state = this.player.getDebugState();
    this.bodyForward.set(Math.sin(this.avatarAnchor.rotation.y), 0, Math.cos(this.avatarAnchor.rotation.y)).normalize();
    this.bodyRight.crossVectors(this.bodyForward, UP).normalize();
    const velocity = new THREE.Vector3(state.velocity.x, 0, state.velocity.z);
    const localForward = velocity.dot(this.bodyForward);
    const localRight = velocity.dot(this.bodyRight);
    this.stats.get('view')!.textContent = this.viewMode === 'first-person' ? '1ST PERSON' : '3RD PERSON';
    this.stats.get('playback')!.textContent = this.playbackMode.toUpperCase();
    this.stats.get('animation')!.textContent = this.currentAnimation.toUpperCase().replaceAll('-', ' ');
    this.stats.get('movement')!.textContent = this.ragdoll ? 'RAGDOLL' : state.movementMode.toUpperCase();
    this.stats.get('speed')!.textContent = this.ragdoll ? 'PHYSICS' : `${state.horizontalSpeed.toFixed(2)} m/s`;
    this.stats.get('health')!.textContent = `${Math.round(this.health)} / ${MAX_HEALTH}`;
    this.stats.get('fall')!.textContent = this.ragdoll
      ? (this.ragdoll.isSettled ? 'RAGDOLL · STABLE' : 'RAGDOLL · PHYSICS')
      : state.incapacitated
        ? 'HEAVY IMPACT · DOWN'
        : state.airborne
          ? `${state.falling ? 'FALL' : 'AIR'} · ${state.fallDistance.toFixed(2)} m · ${state.verticalSpeed.toFixed(1)} m/s`
          : 'GROUND';
    this.stats.get('pit-risk')!.textContent = this.ragdollMode === 'pit-fall'
      ? `RAGDOLL · ${this.ragdollFallDistance.toFixed(1)} m`
      : this.activePitEdge?.controlledApproach
        ? `CONTROL · ${this.activePitEdge.pit.id.toUpperCase()}`
        : this.activePitEdge
          ? `${Math.round((this.pitEdgeRisk / PIT_EDGE_RAGDOLL_THRESHOLD) * 100)}% · ${this.activePitEdge.pit.id.toUpperCase()}`
          : 'OK';
    this.stats.get('local')!.textContent = `F ${localForward >= 0 ? '+' : ''}${localForward.toFixed(2)} · R ${localRight >= 0 ? '+' : ''}${localRight.toFixed(2)}`;
    this.stats.get('look-offset')!.textContent = `${this.lookOffsetDegrees >= 0 ? '+' : ''}${Math.round(this.lookOffsetDegrees)}°${this.bodyTurning ? ' · TURN' : ' · HEAD'}`;
    this.stats.get('turn')!.textContent = `${Math.round(this.bodyTurnRate)}°/s`;
    this.stats.get('fps')!.textContent = `${Math.round(this.fps)}`;
  }

  private setStatus(value: string): void {
    const element = this.stats.get('status');
    if (element) element.textContent = value;
  }

  private updateAnimationButtonState(): void {
    for (const [id, button] of this.animationButtons) {
      button.classList.toggle('is-active', id === this.currentAnimation);
      button.classList.toggle('is-forced', this.playbackMode === 'forced' && id === this.forcedAnimation);
    }
  }

  private readonly resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    for (const camera of [this.thirdPersonCamera, this.firstPersonCamera]) {
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    }
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.combatImpactAudio.dispose();
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onGlobalKeyDown);
    window.removeEventListener('keyup', this.onGlobalKeyUp);
    window.removeEventListener('mousedown', this.onCombatMouseDown);
    window.removeEventListener('mouseup', this.onCombatMouseUp);
    window.removeEventListener('blur', this.onCombatWindowBlur);
    this.renderer.domElement.removeEventListener('contextmenu', this.onCombatContextMenu);
    this.renderer.domElement.removeEventListener('click', this.onCanvasClick);
    this.ragdoll?.dispose();
    this.npcRagdoll?.dispose();
    this.npcRecovery?.dispose();
    this.recovery?.dispose();
    this.recovery = null;
    for (const corpse of this.corpses) corpse.ragdoll.dispose();
    this.corpses.length = 0;
    this.player?.dispose();
    this.physics?.dispose();
    this.mixer?.stopAllAction();
    this.firstPersonMixer?.stopAllAction();
    this.idleNpcMixer?.stopAllAction();
    this.bloodDecals.dispose();
    this.scene.traverse((object) => {
      const renderable = object as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
      renderable.geometry?.dispose();
      if (!renderable.material) return;
      const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
      for (const material of materials) material.dispose();
    });
    this.labMaterials.textures.forEach((texture) => texture.dispose());
    this.renderer.dispose();
    this.root.remove();
  }
}
