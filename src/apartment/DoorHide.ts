import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { matchesControlAction, formatKeyLabel, type ControlBindings } from '../input/ControlBindings';
import { HOLD_OPEN_SHARE, HOLD_STEP_SHARE } from './ClosetHide';

export interface DoorHideHost {
  position(): THREE.Vector3;
  pose(position: THREE.Vector3, confined: boolean): void;
  presentation(active: boolean): void;
  active(active: boolean): void;
  playing(): boolean;
  bindings(): ControlBindings;
}

export interface DoorHideLayout {
  /** Physics key of the leaf's kinematic collider. */
  readonly key: string;
  /** Prompt shown when the leaf is aimed at. */
  readonly label: string;
  /** Hinge pivot (rotation.y = 0 is the authored closed leaf). */
  readonly pivot: THREE.Object3D;
  /** World AABB of the closed leaf (its collider). */
  readonly leafBox: THREE.Box3;
  /** Pivot angle when fully open (sign gives the swing side). */
  readonly openAngle: number;
  /** Confined capsule centre inside, standing capsule centre in front, eye inside. */
  readonly inside: THREE.Vector3;
  readonly outside: THREE.Vector3;
  readonly eye: THREE.Vector3;
}

type Phase = 'idle' | 'opening' | 'aligning' | 'entering' | 'hiding' | 'hidden'
  | 'opening-exit' | 'exiting' | 'closing' | 'held-exit' | 'burst';
const EXIT_OPEN_RATE = 1.2, EXIT_STEP_SECONDS = 1.25, EXIT_CLOSE_RATE = 1.6;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Hiding behind an ordinary single-leaf door (entry closet, bathroom), with the
 * wardrobe's contract: scripted entry, a look-around while hidden, the same
 * hold-driven careful exit and the same burst when the key is let go.
 */
export class DoorHide {
  private readonly saved = new THREE.PerspectiveCamera();
  private readonly from = new THREE.Vector3();
  private readonly ray = new THREE.Ray();
  private readonly direction = new THREE.Vector3();
  private readonly target: THREE.Box3;
  private readonly outwardYaw: number;
  private readonly hingeWorld = new THREE.Vector3();
  private readonly pivotQuaternion = new THREE.Quaternion();
  private phase: Phase = 'idle';
  private phaseTime = 0;
  private progress = 0;
  private held = 0;
  private prompted = false;
  private yaw = 0;
  private pitch = 0;
  private exitRequested = false;
  private targetedOverride = false;
  private disposed = false;
  /** While a scripted scene owns the hiding (the Bacteria hunt), E does not let the player out. */
  exitLocked = false;

  constructor(private readonly layout: DoorHideLayout, private readonly physics: PhysicsWorld,
    private readonly camera: THREE.PerspectiveCamera, private readonly ui: { setInteraction(label: string | null): void },
    private readonly host: DoorHideHost) {
    this.target = layout.leafBox.clone().expandByScalar(.04);
    const out = layout.outside.clone().sub(layout.inside).setY(0).normalize();
    this.outwardYaw = Math.atan2(-out.x, -out.z);
    layout.pivot.updateWorldMatrix(true, false);
    layout.pivot.getWorldPosition(this.hingeWorld);
    const center = layout.leafBox.getCenter(new THREE.Vector3()).sub(this.hingeWorld);
    const half = layout.leafBox.getSize(new THREE.Vector3()).multiplyScalar(.5);
    physics.addKinematicChunk(layout.key, [{ id: layout.key, kind: 'barrier',
      center: { x: center.x, y: center.y, z: center.z },
      halfExtents: { x: Math.max(.012, half.x), y: half.y, z: Math.max(.012, half.z) } }]);
    this.syncDoor();
    window.addEventListener('keydown', this.onKey, true);
    document.addEventListener('mousemove', this.onMouse, true);
  }

  get isActive(): boolean { return this.phase !== 'idle'; }
  get isTargeted(): boolean { return !this.isActive && this.targeted(); }
  get doorProgress(): number { return this.progress; }
  get debugState() { return { phase: this.phase, progress: this.progress }; }

  requestExit(): void { this.exitLocked = false; this.exitRequested = true; if (this.phase === 'hidden') this.change('opening-exit'); }
  forceFinish(): void {
    if (!this.isActive) return;
    this.exitLocked = false; this.progress = 0; this.syncDoor(); this.host.pose(this.layout.outside, false); this.finish();
  }
  enterNow(): void { if (this.isActive) return; this.targetedOverride = true; this.interact(); this.targetedOverride = false; }
  holdExit(progress: number): void {
    if (!['hidden', 'hiding', 'held-exit'].includes(this.phase)) return;
    if (this.phase !== 'held-exit') this.change('held-exit');
    this.held = clamp01(progress);
  }
  burstOut(): void {
    if (!['hidden', 'hiding', 'held-exit', 'opening-exit', 'exiting'].includes(this.phase)) return;
    this.exitLocked = false; this.change('burst');
  }

  interact(): boolean {
    if (this.isActive) {
      if (this.exitLocked) return true;
      this.exitRequested = true; if (this.phase === 'hidden') this.change('opening-exit'); return true;
    }
    if (!this.targetedOverride && !this.targeted()) return false;
    this.saved.copy(this.camera); this.from.copy(this.host.position()); this.exitRequested = false; this.yaw = 0; this.pitch = 0;
    this.host.active(true); this.host.presentation(true); this.change('opening'); this.ui.setInteraction(null);
    return true;
  }

  update(dt: number, playing: boolean): void {
    if (!this.isActive) {
      if (playing && this.targeted()) { this.ui.setInteraction(this.layout.label); this.prompted = true; }
      else if (this.prompted) { this.ui.setInteraction(null); this.prompted = false; }
      return;
    }
    this.host.presentation(true); if (!playing) return;
    this.phaseTime += dt; this.camera.near = .025;
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, 62, 8, dt); this.camera.updateProjectionMatrix();
    const { inside, outside } = this.layout;
    switch (this.phase) {
      case 'opening': this.progress = Math.min(1, this.progress + dt * 3.4); if (this.progress === 1) { this.from.copy(this.host.position()); this.change('aligning'); } break;
      case 'aligning': this.move(this.from, outside, Math.min(1, this.phaseTime / .3), 'keep'); if (this.phaseTime >= .3) this.change('entering'); break;
      case 'entering': this.move(outside, inside, Math.min(1, this.phaseTime / .6), 'turn-out'); if (this.phaseTime >= .6) this.change('hiding'); break;
      case 'hiding': this.progress = Math.max(0, this.progress - dt * 3); this.hiddenView(); if (this.progress === 0) this.change(this.exitRequested ? 'opening-exit' : 'hidden'); break;
      case 'hidden': this.hiddenView(); if (!this.exitLocked) this.ui.setInteraction(`${formatKeyLabel(this.host.bindings().interact)} · Sortir`); break;
      case 'opening-exit': this.hiddenView(); this.progress = Math.min(1, this.progress + dt * EXIT_OPEN_RATE); if (this.progress === 1) this.change('exiting'); break;
      case 'exiting': this.move(inside, outside, Math.min(1, this.phaseTime / EXIT_STEP_SECONDS), 'out'); if (this.phaseTime >= EXIT_STEP_SECONDS) { this.host.pose(outside, false); this.change('closing'); } break;
      case 'held-exit': {
        const step = clamp01((this.held - HOLD_OPEN_SHARE) / HOLD_STEP_SHARE);
        this.progress = Math.max(this.progress, clamp01(this.held / HOLD_OPEN_SHARE));
        if (step > 0) this.move(inside, outside, step, 'out'); else this.hiddenView();
        if (this.held >= 1) { this.host.pose(outside, false); this.change('closing'); }
        break;
      }
      case 'burst': {
        this.progress = Math.min(1, this.progress + dt * 9);
        const t = clamp01((this.phaseTime - .08) / .32);
        if (t > 0) this.move(inside, outside, t, 'out'); else this.hiddenView();
        if (this.phaseTime >= .4) { this.host.pose(outside, false); this.syncDoor(); this.finish(); return; }
        break;
      }
      case 'closing': this.progress = Math.max(0, this.progress - dt * EXIT_CLOSE_RATE); if (this.progress === 0) this.finish(); break;
    }
    this.syncDoor();
  }

  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    window.removeEventListener('keydown', this.onKey, true); document.removeEventListener('mousemove', this.onMouse, true);
    if (this.isActive) { this.host.pose(this.layout.outside, false); this.finish(); }
    this.progress = 0; this.layout.pivot.rotation.y = 0; this.layout.pivot.updateMatrixWorld(true);
    this.physics.removeChunk(this.layout.key);
  }

  private targeted(): boolean {
    const position = this.host.position();
    if (position.distanceTo(this.layout.outside) > 1.4) return false;
    this.camera.getWorldDirection(this.direction); this.ray.set(this.camera.position, this.direction);
    const hit = this.ray.intersectBox(this.target, new THREE.Vector3());
    return !!hit && hit.distanceTo(this.camera.position) < 1.85;
  }

  private change(phase: Phase): void { this.phase = phase; this.phaseTime = 0; }

  private syncDoor(): void {
    const pivot = this.layout.pivot;
    pivot.rotation.y = this.layout.openAngle * smooth(this.progress);
    pivot.updateMatrixWorld(true);
    pivot.getWorldQuaternion(this.pivotQuaternion);
    this.physics.setKinematicChunkTransform(this.layout.key, this.hingeWorld, this.pivotQuaternion);
  }

  /** Scripted capsule motion; the eye follows from standing height to the crouched hide. */
  private move(from: THREE.Vector3, to: THREE.Vector3, t: number, view: 'keep' | 'turn-out' | 'out'): void {
    const ease = smooth(t), p = new THREE.Vector3().lerpVectors(from, to, ease);
    this.host.pose(p, true);
    const standing = this.saved.position.y - this.from.y, hidden = this.layout.eye.y - this.layout.inside.y;
    const offset = view === 'keep' ? standing : view === 'turn-out' ? THREE.MathUtils.lerp(standing, hidden, ease) : THREE.MathUtils.lerp(hidden, standing, ease);
    this.camera.position.copy(p).add(new THREE.Vector3(0, offset, 0));
    const outward = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.outwardYaw, 0, 'YXZ'));
    if (view === 'keep') this.camera.quaternion.copy(this.saved.quaternion);
    else if (view === 'turn-out') this.camera.quaternion.slerpQuaternions(this.saved.quaternion, outward, ease);
    else this.camera.quaternion.copy(outward);
  }

  private hiddenView(): void {
    this.camera.position.copy(this.layout.eye);
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.outwardYaw + this.yaw, 0, 'YXZ'));
  }

  private finish(): void {
    const aspect = this.camera.aspect;
    this.camera.copy(this.saved); this.camera.aspect = aspect; this.camera.updateProjectionMatrix();
    // Leave facing out of the hiding place, not back at its door.
    if (this.phase === 'burst' || this.phase === 'closing') {
      this.camera.position.copy(this.layout.outside).add(new THREE.Vector3(0, this.saved.position.y - this.from.y, 0));
      this.camera.quaternion.setFromEuler(new THREE.Euler(0, this.outwardYaw, 0, 'YXZ'));
    }
    this.phase = 'idle'; this.host.presentation(false); this.host.active(false); this.ui.setInteraction(null);
  }

  private onKey = (event: KeyboardEvent): void => {
    if (!this.isActive || !this.host.playing() || event.ctrlKey || event.metaKey || event.altKey || event.code === 'Escape' || event.code === 'F11') return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!event.repeat && matchesControlAction(event, this.host.bindings(), 'interact')) this.interact();
  };

  private onMouse = (event: MouseEvent): void => {
    if (!this.isActive || !this.host.playing() || !document.pointerLockElement || document.hidden) return;
    event.stopImmediatePropagation();
    this.yaw = THREE.MathUtils.clamp(this.yaw - event.movementX * .0018, -.6, .6);
    this.pitch = THREE.MathUtils.clamp(this.pitch - event.movementY * .0018, -.45, .35);
  };
}
