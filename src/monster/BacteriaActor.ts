import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type BacteriaMotion = 'idle' | 'stalk' | 'run' | 'bang' | 'lunge' | 'crouch' | 'feed' | 'carry';

const MODEL_URL = '/assets/bacteria/bacteria.glb';

/** Top of the skull once scaled: towering, yet hunched enough for the flights. */
const TARGET_HEIGHT = 2.42;

interface MotionProfile {
  /** Gait cycles per second (0 = standing). */
  readonly cadence: number;
  /** Forward bend spread over the spine (rad). */
  readonly hunch: number;
  /** Ear-to-shoulder tilt of the head: the "broken neck". */
  readonly tilt: number;
  readonly stride: number;
  readonly knee: number;
  readonly armSwing: number;
  readonly jaw: number;
  readonly twitch: number;
  /** [min gap, max gap, min hold, max hold] seconds of stop-motion freezes. */
  readonly stutter: readonly [number, number, number, number] | null;
  readonly bob: number;
}

const PROFILES: Readonly<Record<BacteriaMotion, MotionProfile>> = {
  idle: { cadence: 0, hunch: 0.16, tilt: 0.42, stride: 0, knee: 0.08, armSwing: 0.04, jaw: 0.06, twitch: 0.8, stutter: null, bob: 0 },
  crouch: { cadence: 0, hunch: 0.62, tilt: 0.62, stride: 0, knee: 0.42, armSwing: 0.06, jaw: 0.28, twitch: 0.65, stutter: null, bob: 0 },
  stalk: { cadence: 0.78, hunch: 0.34, tilt: 0.58, stride: 0.34, knee: 0.55, armSwing: 0.22, jaw: 0.12, twitch: 1.05, stutter: [0.5, 1.3, 0.18, 0.45], bob: 0.05 },
  run: { cadence: 2.15, hunch: 0.58, tilt: 0.24, stride: 0.72, knee: 1.15, armSwing: 0.95, jaw: 0.42, twitch: 1.3, stutter: [0.42, 1.0, 0.04, 0.08], bob: 0.13 },
  bang: { cadence: 0, hunch: 0.42, tilt: 0.36, stride: 0, knee: 0.3, armSwing: 0, jaw: 0.35, twitch: 1.6, stutter: [0.2, 0.55, 0.04, 0.09], bob: 0 },
  lunge: { cadence: 0, hunch: 0.5, tilt: 0.2, stride: 0, knee: 0.25, armSwing: 0, jaw: 1.05, twitch: 2.6, stutter: [0.05, 0.12, 0.02, 0.05], bob: 0 },
  // Back turned, folded over something on the floor, shoulders heaving.
  feed: { cadence: 0, hunch: 0.95, tilt: 0.5, stride: 0, knee: 0.5, armSwing: 0.05, jaw: 0.55, twitch: 1.15, stutter: [0.6, 1.6, 0.25, 0.7], bob: 0 },
  // Cradling the television against its chest, swaying, mesmerised.
  carry: { cadence: 0, hunch: 0.42, tilt: 0.7, stride: 0, knee: 0.2, armSwing: 0, jaw: 0.3, twitch: 0.55, stutter: [1.2, 2.6, 0.3, 0.8], bob: 0 },
};

/** Small deterministic generator for runtime jitter (no Math.random()). */
const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

interface Side { shoulder: THREE.Bone; arm: THREE.Bone; foreArm: THREE.Bone; fingers: THREE.Bone[]; pelvis: THREE.Bone; thigh: THREE.Bone; shin: THREE.Bone }
interface Rig {
  spine: THREE.Bone[]; neck: THREE.Bone; head: THREE.Bone; jaw: THREE.Bone; skull: THREE.Bone;
  plates: THREE.Bone[]; strings: THREE.Bone[]; left: Side; right: Side;
}

const BASE_EMISSIVE = new THREE.Color(0x0a0807);
const STROBE_EMISSIVE = new THREE.Color(0x6b3a2c);

// Root-space axes: the creature faces +Z, its up is +Y, X is lateral.
const LATERAL = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);

/**
 * The Bacteria entity. The export deforms on its own creature rig (split skull,
 * floor-length arms, stilt legs) — the Mixamo bones in the file drive nothing
 * once Blender's constraints are gone — so every pose is procedural. Rotations
 * are expressed about the creature's own axes, independent of the bone frames,
 * and layered: a gait, a hunch, a dislocated head, twitches and stop-motion
 * freezes that make it move wrong.
 */
export class BacteriaActor {
  readonly root = new THREE.Group();
  readonly warmupRoots: readonly THREE.Object3D[];
  private readonly facing = new THREE.Group();
  private readonly rig: Rig;
  private readonly rest = new Map<THREE.Bone, THREE.Quaternion>();
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly random = createRandom(0x0bac7e41);
  private readonly headHeight: number;
  private facingBaseY = 0;
  private motion: BacteriaMotion = 'idle';
  private profile: MotionProfile = PROFILES.idle;
  private readonly blended: { -readonly [K in Exclude<keyof MotionProfile, 'stutter'>]: number } = {
    cadence: 0, hunch: PROFILES.idle.hunch, tilt: PROFILES.idle.tilt, stride: 0, knee: PROFILES.idle.knee,
    armSwing: PROFILES.idle.armSwing, jaw: PROFILES.idle.jaw, twitch: PROFILES.idle.twitch, bob: 0,
  };
  private time = 0;
  private gait = 0;
  private stutterTimer = 1;
  private holdTimer = 0;
  private lurchTimer = 0;
  private twitchTimer = 0.6;
  private readonly twitchTarget = new THREE.Vector3();
  private readonly twitch = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private hasLookTarget = false;
  private readonly look = new THREE.Vector2();
  private headSnap = 0;
  /** Extra head yaw about the creature's own up axis, beyond any natural limit. */
  private twistTarget = 0;
  private twist = 0;
  private twistRate = 3;
  private readonly parentQuaternion = new THREE.Quaternion();
  private readonly rootQuaternion = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3();
  private readonly step = new THREE.Quaternion();
  private readonly local = new THREE.Vector3();
  private readonly inverse = new THREE.Matrix4();
  private disposed = false;

  private constructor(model: THREE.Object3D) {
    this.root.name = 'bacteria-entity';
    this.facing.name = 'bacteria-facing';
    this.root.add(this.facing);
    this.facing.add(model);

    const bones = new Map<string, THREE.Bone>();
    model.traverse((object) => {
      if ((object as THREE.Bone).isBone) bones.set(object.name.replace(/_\d+$/, ''), object as THREE.Bone);
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      // The export ships a flat yellow stage plane under the creature.
      if (materials.some(material => material.name === 'Material')) { mesh.visible = false; return; }
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.material = this.prepareMaterial(materials[0]!);
      this.geometries.push(mesh.geometry);
    });
    const bone = (name: string): THREE.Bone => {
      const found = bones.get(name);
      if (!found) throw new Error(`Squelette de Bacteria incomplet (${name}).`);
      return found;
    };
    const side = (s: 'L' | 'R'): Side => ({
      shoulder: bone(`Shoulder_${s}`), arm: bone(`Arm_${s}`), foreArm: bone(`ForeArm_${s}`),
      fingers: ['Thumb', 'Middle', 'Pinky', 'Thumb_2'].map(n => bones.get(`${n}_${s}`)).filter((b): b is THREE.Bone => !!b),
      // The export names the thigh "Leg" and the long shin "Thigh".
      pelvis: bone(`Pelvis_${s}`), thigh: bones.get(`Leg_${s}_`) ?? bone(`Leg_${s}`), shin: bone(`Thigh_${s}`),
    });
    this.rig = {
      spine: ['Spine', 'Spine_1', 'Spine_2', 'Spine_3', 'Spine_4'].map(bone),
      neck: bone('Neck'), head: bone('Head'),
      jaw: bone('Head_Clamp_L'), skull: bone('Head_Clamp_R'),
      plates: ['Shoulder_Plate', 'Shoulder_Plate_2', 'Shoulder_Plate_3'].map(n => bones.get(n)).filter((b): b is THREE.Bone => !!b),
      strings: ['StringLoop_L', 'StringLoop_R'].map(n => bones.get(n)).filter((b): b is THREE.Bone => !!b),
      left: side('L'), right: side('R'),
    };
    for (const each of bones.values()) this.rest.set(each, each.quaternion.clone());

    // Orient the mouth along +Z, stand the feet on y = 0, pelvis on the axis.
    model.updateMatrixWorld(true);
    const neck = this.rig.neck.getWorldPosition(new THREE.Vector3());
    const mouth = (bones.get('UpperTooth') ?? this.rig.head).getWorldPosition(new THREE.Vector3());
    const forward = mouth.sub(neck).setY(0);
    if (forward.lengthSq() > 1e-8) this.facing.rotation.y = -Math.atan2(forward.x, forward.z);
    this.root.updateMatrixWorld(true);
    const top = Math.max(...['HeadPlate', 'UpperTooth', 'Head'].map(n => bones.get(n)?.getWorldPosition(new THREE.Vector3()).y ?? -Infinity));
    let floor = Infinity;
    for (const [name, each] of bones) if (/^(ToeEnd|FootHeel)/.test(name)) floor = Math.min(floor, each.getWorldPosition(new THREE.Vector3()).y);
    if (!Number.isFinite(floor)) floor = 0;
    const scale = TARGET_HEIGHT / Math.max(0.1, top - floor);
    this.facing.scale.setScalar(scale);
    this.facing.position.y = this.facingBaseY = -floor * scale;
    this.root.updateMatrixWorld(true);
    const pelvis = this.rig.spine[0]!.getWorldPosition(new THREE.Vector3());
    this.facing.position.x -= pelvis.x;
    this.facing.position.z -= pelvis.z;
    this.root.updateMatrixWorld(true);
    this.headHeight = this.rig.head.getWorldPosition(new THREE.Vector3()).y;
    this.warmupRoots = [this.root];
  }

  static async load(signal?: AbortSignal): Promise<BacteriaActor> {
    const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
    signal?.throwIfAborted();
    return new BacteriaActor(gltf.scene);
  }

  private prepareMaterial(source: THREE.Material): THREE.Material {
    const material = source.clone();
    const skin = material as THREE.MeshStandardMaterial;
    if (skin.isMeshStandardMaterial) {
      // Wet, near-black hide. A faint self-glow and a warm sheen keep the
      // silhouette readable in the dim cage without ever looking lit.
      skin.color.setHex(0x14110f);
      skin.emissive.copy(BASE_EMISSIVE);
      skin.roughness = 0.3;
      skin.metalness = 0;
      const physical = skin as THREE.MeshPhysicalMaterial;
      if (physical.isMeshPhysicalMaterial) {
        physical.sheen = 0.8;
        physical.sheenColor.setHex(0x6a5546);
        physical.sheenRoughness = 0.35;
      }
      skin.side = THREE.FrontSide;
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const) {
        const texture = skin[key];
        if (texture) this.textures.push(texture);
      }
    }
    this.materials.push(material);
    source.dispose();
    return material;
  }

  get currentMotion(): BacteriaMotion { return this.motion; }

  setMotion(motion: BacteriaMotion): void {
    if (motion === this.motion) return;
    this.motion = motion;
    this.profile = PROFILES[motion];
    this.holdTimer = 0;
    this.stutterTimer = this.profile.stutter ? this.range(this.profile.stutter[0], this.profile.stutter[1]) : 1;
  }

  /** World point the head keeps turning toward (the player's eyes), or null. */
  setLookTarget(target: THREE.Vector3 | null): void {
    this.hasLookTarget = !!target;
    if (target) this.lookTarget.copy(target);
  }

  /**
   * Turns the head about the neck far beyond a human range (radians, + = to its
   * left). `rate` is the follow speed: slow for the dread, high for a snap.
   */
  setHeadTwist(angle: number, rate = 3): void { this.twistTarget = angle; this.twistRate = rate; }
  get headTwist(): number { return this.twist; }

  /** Point between both hands in world space (what it carries hangs there). */
  getHoldPosition(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    const hand = (side: Side): THREE.Vector3 => (side.fingers[1] ?? side.fingers[0] ?? side.foreArm).getWorldPosition(new THREE.Vector3());
    return out.copy(hand(this.rig.left)).add(hand(this.rig.right)).multiplyScalar(0.5);
  }

  /** A violent, immediate head snap (the moment it notices you). */
  snapHead(): void { this.headSnap = 1; this.twitch.set(0.45, 0.2, -0.55); this.twitchTarget.set(0, 0, 0); }

  setPlacement(position: Readonly<THREE.Vector3Like>, yaw: number): void {
    this.root.position.set(position.x, position.y, position.z);
    this.root.rotation.y = yaw;
  }

  getHeadPosition(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return this.rig.head.getWorldPosition(out);
  }

  /** Centre of the split face, for the jumpscare framing. */
  getFacePosition(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    const a = this.rig.jaw.getWorldPosition(out);
    const b = this.rig.skull.getWorldPosition(this.local);
    return a.add(b).multiplyScalar(0.5);
  }

  update(delta: number): void {
    if (this.disposed) return;
    const dt = Math.min(0.05, Math.max(0, delta));
    const profile = this.profile;
    const blend = 1 - Math.exp(-dt * 6);
    for (const key of ['cadence', 'hunch', 'tilt', 'stride', 'knee', 'armSwing', 'jaw', 'twitch', 'bob'] as const) {
      this.blended[key] = THREE.MathUtils.lerp(this.blended[key], profile[key], blend);
    }
    // Stop-motion: the body freezes mid-gesture, then lurches to catch up.
    let rate = 1;
    if (profile.stutter) {
      if (this.holdTimer > 0) {
        this.holdTimer -= dt;
        rate = 0;
        if (this.holdTimer <= 0) this.lurchTimer = 0.13;
      } else {
        this.stutterTimer -= dt;
        if (this.stutterTimer <= 0) {
          this.holdTimer = this.range(profile.stutter[2], profile.stutter[3]);
          this.stutterTimer = this.range(profile.stutter[0], profile.stutter[1]);
        }
      }
      if (this.lurchTimer > 0) { this.lurchTimer -= dt; rate = 2.7; }
    }
    this.time += dt * (rate === 0 ? 0.08 : 1);
    this.gait += dt * rate * this.blended.cadence * Math.PI * 2;
    this.pose(dt, rate === 0);
  }

  private pose(dt: number, frozen: boolean): void {
    const { rig, blended: b } = this;
    for (const [bone, rest] of this.rest) bone.quaternion.copy(rest);
    this.root.updateMatrixWorld(true);
    this.root.getWorldQuaternion(this.rootQuaternion);
    const t = this.time;
    const phase = this.gait;

    // Twitches: a sharp snap to a random offset, held, then a slow drift back.
    if (!frozen) {
      this.twitchTimer -= dt;
      if (this.twitchTimer <= 0) {
        const amount = b.twitch;
        this.twitchTimer = this.range(0.2, 1.3) / Math.max(0.4, amount);
        this.twitchTarget.set(this.range(-0.35, 0.35) * amount, this.range(-0.6, 0.6) * amount, this.range(-0.55, 0.55) * amount);
      }
      this.twitch.lerp(this.twitchTarget, 1 - Math.exp(-dt * 36));
      this.twitchTarget.multiplyScalar(Math.exp(-dt * 2.4));
    }
    const tremor = Math.sin(t * 61) * 0.014 + Math.sin(t * 43.7) * 0.01;
    const breath = Math.sin(t * 1.6);

    // Gait: stilt strides, knees snapping high, a lurching torso.
    const swing = Math.sin(phase);
    const counter = Math.sin(phase + Math.PI);
    const lift = (value: number): number => Math.max(0, value);
    this.facing.position.y = this.facingBaseY - Math.abs(Math.cos(phase)) * b.bob * 0.6 + b.bob * 0.3;

    // Torso: hunched forward, rolling with each stride, a bit crooked.
    const sway = Math.sin(phase) * 0.09 * Math.min(1, b.stride * 2);
    rig.spine.forEach((bone, index) => {
      const share = index === 0 ? 0.25 : 1;
      this.turn(bone, LATERAL, (b.hunch * 0.26 + breath * 0.012) * share);
      this.turn(bone, FORWARD, (sway + 0.025) * share * 0.5);
    });
    this.turn(rig.spine[1]!, UP, Math.sin(phase) * 0.16 * Math.min(1, b.stride * 2));

    // Head: kept up toward its prey despite the hunch, cocked sideways, twitching.
    let yaw = 0, pitch = 0;
    if (this.hasLookTarget) {
      const target = this.local.copy(this.lookTarget).applyMatrix4(this.inverse.copy(this.root.matrixWorld).invert());
      yaw = THREE.MathUtils.clamp(Math.atan2(target.x, Math.max(0.05, target.z)), -1.3, 1.3);
      pitch = THREE.MathUtils.clamp(Math.atan2(target.y - this.headHeight, Math.hypot(target.x, target.z)), -0.9, 0.8);
    }
    const follow = 1 - Math.exp(-dt * (this.headSnap > 0 ? 40 : 4.5));
    this.look.x = THREE.MathUtils.lerp(this.look.x, yaw, follow);
    this.look.y = THREE.MathUtils.lerp(this.look.y, pitch, follow);
    this.headSnap = Math.max(0, this.headSnap - dt * 3);
    const raise = -b.hunch * 0.85 - this.look.y;
    this.turn(rig.neck, LATERAL, raise * 0.5 + this.twitch.x * 0.4);
    this.turn(rig.neck, UP, this.look.x * 0.5 + this.twitch.y * 0.4);
    this.turn(rig.head, LATERAL, raise * 0.5 + this.twitch.x * 0.6 + tremor);
    this.turn(rig.head, UP, this.look.x * 0.5 + this.twitch.y * 0.6);
    this.twist += (this.twistTarget - this.twist) * (1 - Math.exp(-dt * this.twistRate));
    if (Math.abs(this.twist) > 1e-3) {
      // Mostly in the neck, the skull finishes the turn: an owl, not a person.
      this.turn(rig.neck, UP, this.twist * 0.45);
      this.turn(rig.head, UP, this.twist * 0.55);
    }
    this.turn(rig.head, FORWARD, b.tilt + this.twitch.z + tremor * 2);
    // The split skull: the lower half drops open, the upper half rears.
    const chatter = Math.max(0, Math.sin(t * 17)) * 0.08 * b.twitch;
    this.turn(rig.jaw, LATERAL, b.jaw * 0.9 + chatter);
    this.turn(rig.skull, LATERAL, -b.jaw * 0.35);
    for (const [index, string] of rig.strings.entries()) this.turn(string, LATERAL, Math.sin(t * 2.3 + index) * 0.2);
    for (const [index, plate] of rig.plates.entries()) this.turn(plate, LATERAL, breath * 0.04 + tremor * (index + 1));

    // Limbs. Left and right are mirrored on the lateral axis.
    for (const [sign, s] of [[1, rig.left], [-1, rig.right]] as const) {
      const legPhase = sign > 0 ? swing : counter;
      const armPhase = sign > 0 ? counter : swing;
      // Legs swing forward on a negative lateral turn (they hang downward).
      this.turn(s.thigh, LATERAL, -legPhase * b.stride - b.knee * 0.35);
      this.turn(s.shin, LATERAL, b.knee * (0.45 + lift(Math.sin((sign > 0 ? phase : phase + Math.PI) + 1.2)) * 0.9));
      // Shoulders hunched up and lopsided; floor-length arms dragged and flung.
      this.turn(s.shoulder, FORWARD, sign * (0.06 + b.hunch * 0.1) + (sign > 0 ? 0.08 : -0.02) + tremor);
      this.turn(s.arm, LATERAL, -0.12 - armPhase * b.armSwing - b.hunch * 0.35);
      this.turn(s.arm, FORWARD, sign * -(0.1 + Math.abs(armPhase) * b.armSwing * 0.2));
      this.turn(s.foreArm, LATERAL, -0.22 - lift(-armPhase) * b.armSwing * 0.7 + tremor * 3);
      for (const finger of s.fingers) this.turn(finger, LATERAL, -0.45 - Math.sin(t * 21 + sign) * 0.08);
    }

    if (this.motion === 'bang') {
      // Both arms rear up and slam forward against the door, out of step.
      for (const [index, s] of [rig.left, rig.right].entries()) {
        const blow = Math.pow(Math.max(0, Math.sin(t * 8.6 + index * 1.7)), 3);
        this.turn(s.arm, LATERAL, -1.9 + blow * 1.25);
        this.turn(s.foreArm, LATERAL, -0.6 + blow * 0.5);
      }
      this.turn(rig.spine[3]!, LATERAL, 0.18 * Math.pow(Math.max(0, Math.sin(t * 8.6)), 3));
    }
    if (this.motion === 'feed') {
      // Both forearms work at something below it, out of step, the head buried.
      for (const [index, s] of [rig.left, rig.right].entries()) {
        const tear = Math.pow(Math.max(0, Math.sin(t * 3.1 + index * 2.3)), 2);
        this.turn(s.arm, LATERAL, -0.75 - tear * 0.35);
        this.turn(s.foreArm, LATERAL, -0.9 + tear * 0.6);
      }
      this.turn(rig.neck, LATERAL, 0.45 + Math.sin(t * 2.2) * 0.06);
      this.turn(rig.head, LATERAL, 0.3);
      this.turn(rig.spine[2]!, LATERAL, Math.max(0, Math.sin(t * 1.4)) * 0.08);
    }
    if (this.motion === 'carry') {
      // Long arms folded up under the load, held against the chest.
      for (const [sign, s] of [[1, rig.left], [-1, rig.right]] as const) {
        this.turn(s.arm, LATERAL, -0.6);
        this.turn(s.arm, FORWARD, sign * 0.25);
        this.turn(s.foreArm, LATERAL, -1.1);
        this.turn(s.foreArm, UP, sign * -0.3);
      }
      this.turn(rig.spine[0]!, FORWARD, Math.sin(t * 0.9) * 0.05);
      this.turn(rig.neck, LATERAL, 0.28);
    }
    if (this.motion === 'lunge') {
      // Arms flung forward and wide at the viewer, head thrust in, skull split.
      for (const [sign, s] of [[1, rig.left], [-1, rig.right]] as const) {
        this.turn(s.arm, LATERAL, -1.55);
        this.turn(s.arm, FORWARD, sign * -0.75);
        this.turn(s.foreArm, LATERAL, -0.35);
      }
      this.turn(rig.neck, LATERAL, 0.35);
    }
  }

  /** Rotates a bone about one of the creature's own axes, whatever its bone frame. */
  private turn(bone: THREE.Bone, rootAxis: THREE.Vector3, angle: number): void {
    if (!angle) return;
    const parent = bone.parent;
    if (!parent) return;
    parent.getWorldQuaternion(this.parentQuaternion).invert();
    this.axis.copy(rootAxis).applyQuaternion(this.rootQuaternion).applyQuaternion(this.parentQuaternion);
    bone.quaternion.premultiply(this.step.setFromAxisAngle(this.axis, angle));
    bone.updateMatrixWorld(true);
  }

  private range(min: number, max: number): number { return min + (max - min) * this.random(); }

  setVisible(visible: boolean): void { this.root.visible = visible; }

  /** 0 = its usual near-black hide, 1 = blown out by a strobe (the jumpscare). */
  setExposure(level: number): void {
    const amount = THREE.MathUtils.clamp(level, 0, 1);
    for (const material of this.materials) {
      const skin = material as THREE.MeshStandardMaterial;
      if (!skin.isMeshStandardMaterial) continue;
      skin.emissive.copy(BASE_EMISSIVE).lerp(STROBE_EMISSIVE, amount);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
  }
}
