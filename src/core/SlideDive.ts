import * as THREE from 'three';
import type { SlideDiveFrame, SlideDiveSample } from '../character/SlideDivePose';
import { slidePath, SLIDE_LIP, type SlideEntryPlan, type SlidePathPoint } from '../world/SlidesStructure';

export interface SlideDiveRequest {
  entry: SlideEntryPlan;
  structureId: string;
  owner: { x: number; z: number; story: number };
  /** World offset of the owner chunk; the entry is in its local coordinates. */
  offset: THREE.Vector3;
  floorY: number;
}
export interface SlideDiveHost {
  readonly camera: THREE.PerspectiveCamera;
  character(): {
    beginSlideDive(): boolean; sampleSlideDive(s: SlideDiveSample): SlideDiveFrame | null;
    setExternalCameraPresentation(active: boolean): void;
  } | undefined;
  /** Feet of the player when the dive is chosen. */
  feet(): THREE.Vector3;
  baseFieldOfView(): number;
  reducedMotion(): boolean;
  setFade(level: number): void;
  /** Fully black: move the body to its arrival and resolve when it is ready. */
  land(request: SlideDiveRequest): Promise<void>;
}

const smooth = (t: number): number => { const x = THREE.MathUtils.clamp(t, 0, 1); return x * x * (3 - 2 * x); };
const CROUCH = .24, LEAP = 1.05, RIDE = 1.75, FADE = .6;
/** Seconds of the walk-up for a distance: never a sprint, never a pause. */
const walkSeconds = (distance: number): number => THREE.MathUtils.clamp(distance / 1.45, .35, 1.3);

/**
 * Choosing a slide: the character walks to the mouth and dives in head first
 * (one exterior shot from behind), then the camera rides the real bore into
 * the dark. Game steps it before the rig and frames the shot after it, like
 * the rift; the body is not simulated meanwhile.
 */
export class SlideDive {
  private time = 0;
  private readonly start = new THREE.Vector3();
  private readonly stand = new THREE.Vector3();
  private readonly mouth = new THREE.Vector3();
  private readonly fromPosition = new THREE.Vector3();
  private readonly fromQuaternion = new THREE.Quaternion();
  // Cameras, not plain objects: lookAt must aim their -Z at the target.
  private readonly shot = new THREE.PerspectiveCamera();
  private readonly ride = new THREE.PerspectiveCamera();
  private readonly path: SlidePathPoint[];
  private readonly walk: number;
  private readonly side: number;
  private posed = false;
  private landing?: Promise<void>;
  private finished = false;
  private hidden = false;
  constructor(private readonly host: SlideDiveHost, readonly request: SlideDiveRequest) {
    const { entry, offset, floorY } = request;
    this.start.copy(host.feet());
    this.mouth.set(entry.position.x, entry.position.y, entry.position.z).add(offset);
    this.stand.set(entry.position.x, floorY, entry.position.z + 1.3).add(offset);
    this.walk = walkSeconds(Math.hypot(this.stand.x - this.start.x, this.stand.z - this.start.z));
    // Watch from the hall side of the mouth, never from a corner of the room.
    this.side = entry.position.x > .5 ? -1 : 1;
    this.path = slidePath(entry).map(p => ({ ...p, x: p.x + offset.x, y: p.y + offset.y, z: p.z + offset.z }));
    this.fromPosition.copy(host.camera.position); this.fromQuaternion.copy(host.camera.quaternion);
    this.posed = !!host.character()?.beginSlideDive();
  }
  get active(): boolean { return !this.finished; }
  /** The rig must not run: the shot owns camera and body. */
  get ownsCharacter(): boolean { return !this.finished; }
  private get cut(): number { return this.walk + CROUCH + LEAP; }
  get done(): boolean { return this.finished; }

  /** Before the rig: pose the avatar for this instant of the dive. */
  update(delta: number): void {
    if (this.finished) return;
    this.time += Math.max(0, Math.min(.05, delta));
    const t = this.time, character = this.host.character();
    if (t < this.cut && this.posed && character) {
      character.sampleSlideDive(this.sampleAt(t));
    } else if (!this.hidden) {
      this.hidden = true; character?.setExternalCameraPresentation(true);
    }
    if (t >= this.cut + RIDE && !this.landing) {
      this.landing = this.host.land(this.request).catch(() => undefined).then(() => { this.finished = true; });
    }
  }

  private sampleAt(t: number): SlideDiveSample {
    const yaw = Math.PI, feet = new THREE.Vector3();
    if (t < this.walk) {
      const k = smooth(t / this.walk);
      feet.lerpVectors(this.start, this.stand, k);
      const travelled = this.start.distanceTo(this.stand) * k;
      const face = Math.atan2(this.stand.x - this.start.x, this.stand.z - this.start.z);
      const heading = this.start.distanceTo(this.stand) > .2 ? face : yaw;
      // Turn toward the mouth over the last steps.
      const turn = heading + Math.atan2(Math.sin(yaw - heading), Math.cos(yaw - heading)) * smooth((t / this.walk - .45) / .55);
      return { feet, yaw: turn, pitch: 0, walking: Math.sin(Math.PI * Math.min(1, t / this.walk)) * .9 + .1, gaitDistance: travelled, leap: 0, leapTime: 0, time: t };
    }
    const crouch = t - this.walk;
    if (crouch < CROUCH) {
      const k = crouch / CROUCH;
      return { feet: feet.copy(this.stand), yaw, pitch: .18 * smooth(k), walking: 0, gaitDistance: 0, leap: smooth(k), leapTime: .18 * k, time: t };
    }
    // Head first, the pelvis climbs to the mouth then follows the body inside.
    const u = (crouch - CROUCH) / LEAP, m = this.mouth;
    const hips = new THREE.Vector3();
    const takeoff = new THREE.Vector3(m.x, this.stand.y + .98, this.stand.z), apex = new THREE.Vector3(m.x, m.y + .32, m.z + .78);
    const inside = new THREE.Vector3(m.x, m.y - .02, m.z - .55), deep = new THREE.Vector3(m.x, m.y - .14, m.z - 2.4);
    if (u < .4) hips.lerpVectors(takeoff, apex, smooth(u / .4));
    else if (u < .7) hips.lerpVectors(apex, inside, smooth((u - .4) / .3));
    else hips.lerpVectors(inside, deep, smooth((u - .7) / .3));
    return { feet: feet.copy(this.stand), yaw, pitch: THREE.MathUtils.lerp(.18, 1.5, smooth(u / .45)), hips, walking: 0, gaitDistance: 0,
      leap: 1, leapTime: THREE.MathUtils.lerp(.18, .62, Math.min(1, u / .8)), time: t };
  }

  /** After the rig: the exterior shot, then the ride down the bore. */
  applyCamera(): void {
    if (this.finished) return;
    const camera = this.host.camera, base = this.host.baseFieldOfView(), t = this.time, m = this.mouth;
    if (t < this.cut) {
      // Behind and above his shoulder, the mouth and its scrawl in frame.
      const leap = smooth((t - this.walk - CROUCH) / LEAP);
      this.shot.position.set(m.x + this.side * THREE.MathUtils.lerp(1.15, .75, leap), m.y + THREE.MathUtils.lerp(.78, .52, leap), m.z + THREE.MathUtils.lerp(3.5, 2.5, leap));
      this.shot.lookAt(m.x - this.side * .12, m.y - .12, m.z - .2);
      const enter = smooth(t / Math.min(.65, this.walk));
      camera.position.lerpVectors(this.fromPosition, this.shot.position, enter);
      camera.quaternion.slerpQuaternions(this.fromQuaternion, this.shot.quaternion, enter);
      this.setFov(THREE.MathUtils.lerp(base, Math.min(base, 60), enter));
      this.host.setFade(0);
      return;
    }
    // Riding the centre line: slow at the lip, then the drop takes him.
    const r = Math.min(1, (t - this.cut) / RIDE), length = this.path.at(-1)!.s * .93;
    const s = SLIDE_LIP * .5 + length * (.18 * r + .82 * r * r);
    const p = this.pointAt(s), ahead = this.pointAt(Math.min(this.path.at(-1)!.s, s + .9));
    this.ride.position.set(p.x, p.y + .12 * (1 - r), p.z);
    this.ride.lookAt(ahead.x, ahead.y - .05, ahead.z);
    const motion = this.host.reducedMotion() ? 0 : 1;
    const roll = -this.request.entry.turn * .32 * smooth((r - .25) / .5) * motion;
    this.ride.rotateZ(roll + Math.sin(t * 31) * .012 * r * motion);
    camera.position.copy(this.ride.position); camera.quaternion.copy(this.ride.quaternion);
    this.setFov(base + 16 * smooth(r) * motion, .02);
    this.host.setFade(smooth((t - this.cut - (RIDE - FADE)) / FADE));
  }

  private setFov(fov: number, near?: number): void {
    const camera = this.host.camera;
    if (Math.abs(camera.fov - fov) < 1e-3 && (near === undefined || camera.near === near)) return;
    camera.fov = fov; if (near !== undefined) camera.near = near; camera.updateProjectionMatrix();
  }

  private pointAt(s: number): SlidePathPoint {
    const path = this.path;
    let i = 1; while (i < path.length - 1 && path[i]!.s < s) i++;
    const a = path[i - 1]!, b = path[i]!, k = THREE.MathUtils.clamp((s - a.s) / Math.max(1e-6, b.s - a.s), 0, 1);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, tx: b.tx, ty: b.ty, tz: b.tz, s };
  }
}
