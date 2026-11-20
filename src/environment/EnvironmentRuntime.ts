import * as THREE from 'three';
import { EnvironmentAudio, alarmAudibility, ALARM_PERIOD, type EnvironmentSound, type EnvironmentVoice } from '../audio/EnvironmentAudio';
import type { AudioOutput } from '../monster/BacteriaAudio';
import { BacteriaActor } from '../monster/BacteriaActor';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { EnvironmentChunk, EnvironmentChunkObserver } from '../core/WorldStream';
import { createPropInstance, disposePropInstance } from '../render/WorldProps';
import { applyZonalLighting } from '../render/ZonalLighting';
import type { EnvironmentLighting } from '../render/EnvironmentLighting';
import { SeededRandom } from '../world/SeededRandom';
import { getPropAsset } from '../world/PropCatalog';
import { pointInRect, rectCenter } from '../world/types';
import type { StaticCollider, Vec3Data } from '../world/types';
import type { EnvironmentEventPlan } from '../world/EnvironmentEvents';
import { EnvironmentStateStore, TelephoneSequence, SurveillanceBehavior, apparitionFrame, type EventState, type PhoneCue } from './EnvironmentBehavior';
import { createEnvironmentModel, type EventModel } from './EnvironmentModels';
import { EnvironmentWater } from './EnvironmentWater';

export interface EnvironmentHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  physics: Pick<PhysicsWorld, 'addChunk' | 'removeChunk' | 'probeWalkableCell' | 'castEnvironmentRay'>;
  output(): AudioOutput | null;
  /** Standing capsule centre, normalized even while crouching. */
  playerPosition(): THREE.Vector3;
  canDiscover(): boolean;
  prepareChase(): void;
  startChase(): boolean;
  caption(text: string): void;
}
interface MountedEvents { chunk: EnvironmentChunk; root: THREE.Group; events: EventInstance[] }

/** Owns only mounted chunks. The ghost is a separate, non-physical actor; the
 * telephone borrows the real hunter through its host rather than duplicating AI. */
export class EnvironmentRuntime implements EnvironmentChunkObserver {
  readonly audio: EnvironmentAudio;
  readonly forward = new THREE.Vector3(0, 0, -1);
  readonly up = new THREE.Vector3(0, 1, 0);
  readonly chunks = new Map<string, MountedEvents>();
  private readonly projection = new THREE.Matrix4();
  private readonly frustum = new THREE.Frustum();
  private readonly sphere = new THREE.Sphere();
  private readonly point = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly abort = new AbortController();
  private ghost?: BacteriaActor;
  private ghostLoading = false;
  private ghostOwner?: string;
  private phoneOwner?: string;
  private disposed = false;
  exertion = 0;
  constructor(readonly host: EnvironmentHost, readonly states: EnvironmentStateStore) { this.audio = new EnvironmentAudio(host.output); }
  async load(): Promise<void> { await this.audio.load(); await this.ready(); }
  async ready(): Promise<void> { await Promise.all([...this.chunks.values()].flatMap(c => c.events.map(e => e.ready))); }
  mount(chunk: EnvironmentChunk): void {
    if (this.disposed) return;
    const previous = this.chunks.get(chunk.key);
    if (previous) { previous.chunk = chunk; for (const e of previous.events) e.rebind(chunk); return; }
    if (!chunk.plan.environmentEvents?.length) return;
    const root = new THREE.Group(); root.name = `environment-${chunk.key}`; root.position.copy(chunk.offset); this.host.scene.add(root);
    const events = chunk.plan.environmentEvents.map(plan => new EventInstance(this, chunk, root, plan));
    this.chunks.set(chunk.key, { chunk, root, events });
  }
  unmount(key: string): void {
    const mounted = this.chunks.get(key); if (!mounted) return;
    mounted.events.forEach(e => e.dispose()); mounted.root.removeFromParent(); mounted.root.clear(); this.chunks.delete(key);
  }
  update(delta: number, exertion = 0): void {
    if (this.disposed) return;
    this.exertion = exertion;
    const camera = this.host.camera; camera.updateMatrixWorld(true); camera.getWorldDirection(this.forward);
    this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    this.audio.updateListener(camera.position, this.forward, this.up);
    for (const mounted of this.chunks.values()) for (const event of mounted.events) event.update(Math.min(.1, Math.max(0, delta)));
  }
  /** Conservative frustum and five sight samples: even a partly visible chair stays put. */
  visible(position: Vec3Data, radius = .6, ignoredChunk?: string): boolean {
    const camera = this.host.camera; camera.updateMatrixWorld(true);
    this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    this.sphere.center.copy(position); this.sphere.radius = radius;
    if (!this.frustum.intersectsSphere(this.sphere)) return false;
    for (const [dx, dy, dz] of [[0, 0, 0], [radius, 0, 0], [-radius, 0, 0], [0, radius, 0], [0, 0, radius], [0, 0, -radius]]) {
      this.point.set(position.x + dx!, position.y + dy!, position.z + dz!);
      if (this.clearSight(camera.position, this.point, ignoredChunk)) return true;
    }
    return false;
  }
  clearSight(from: Vec3Data, to: Vec3Data, ignoredChunk?: string): boolean {
    this.direction.set(to.x - from.x, to.y - from.y, to.z - from.z);
    const distance = this.direction.length(); if (distance < .05) return true;
    this.direction.multiplyScalar(1 / distance);
    return !this.host.physics.castEnvironmentRay(from, this.direction, Math.max(0, distance - .08), ignoredChunk);
  }
  getInteraction(): { label: string; event: EventInstance } | null {
    let best: { label: string; event: EventInstance; distance: number } | null = null;
    for (const chunk of this.chunks.values()) for (const e of chunk.events) {
      const distance = e.interactionDistance();
      if (distance !== null && (!best || distance < best.distance)) best = { label: 'Décrocher le téléphone', event: e, distance };
    }
    return best;
  }
  interact(): boolean { const hit = this.getInteraction(); if (!hit) return false; hit.event.answer(); return true; }
  get inWater(): boolean { return this.waterAtPlayer() !== undefined; }
  footstep(strength: number): boolean { const event = this.waterAtPlayer(); if (!event) return false; event.splash(strength); return true; }
  private waterAtPlayer(): EventInstance | undefined {
    for (const chunk of this.chunks.values()) for (const e of chunk.events) if (e.isPlayerInWater()) return e;
    return undefined;
  }
  acquirePhone(id: string): boolean { if (this.phoneOwner) return false; this.phoneOwner = id; return true; }
  releasePhone(id: string): void { if (this.phoneOwner === id) this.phoneOwner = undefined; }
  get blocksSaving(): boolean { return !!this.phoneOwner; }
  prepareGhost(): void {
    if (this.ghost || this.ghostLoading || this.disposed) return;
    this.ghostLoading = true;
    void BacteriaActor.load(this.abort.signal).then(actor => {
      if (this.disposed) { actor.dispose(); return; }
      this.ghost = actor; actor.setVisible(false); actor.setMotion('stalk'); actor.setPace(.55); this.host.scene.add(actor.root);
    }).catch(error => { if (!this.disposed) console.warn('Apparition Bacteria indisponible', error); });
  }
  acquireGhost(id: string): BacteriaActor | undefined {
    if (!this.ghost || (this.ghostOwner && this.ghostOwner !== id)) return;
    this.ghostOwner = id; return this.ghost;
  }
  releaseGhost(id: string): void { if (this.ghostOwner === id) { this.ghost?.setVisible(false); this.ghostOwner = undefined; } }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.abort.abort();
    for (const key of this.chunks.keys()) this.unmount(key);
    this.ghost?.dispose(); this.audio.dispose();
  }
}

class EventInstance {
  readonly ready: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly state: EventState;
  private readonly random: SeededRandom;
  private readonly phase: number;
  private readonly voices = new Set<EnvironmentVoice>();
  private readonly position = new THREE.Vector3();
  private readonly local = new THREE.Vector3();
  private readonly ear = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private model?: EventModel;
  private chair?: THREE.Object3D;
  private water?: EnvironmentWater;
  private readonly phone = new TelephoneSequence();
  private readonly surveillance = new SurveillanceBehavior();
  private loop?: EnvironmentVoice;
  private breath?: EnvironmentVoice;
  private speech?: EnvironmentVoice;
  private flickerTime = -1;
  private time = 0;
  private lastOcclusion = 0;
  private alarmOcclusion = .5;
  private chairAway = 0;
  private pendingChase = 0;
  private disposed = false;
  private readonly baseHooks = new Map<THREE.Material, { before: THREE.Material['onBeforeCompile']; key: THREE.Material['customProgramCacheKey'] }>();
  private readonly bindings = new WeakMap<THREE.Material, EnvironmentLighting>();
  constructor(private readonly owner: EnvironmentRuntime, private chunk: EnvironmentChunk, parent: THREE.Group, readonly plan: EnvironmentEventPlan) {
    this.random = new SeededRandom(plan.seed); this.phase = this.random.float(0, ALARM_PERIOD);
    this.state = owner.states.read(plan.id); this.root.name = plan.id; parent.add(this.root);
    if (plan.mount && (plan.kind === 'fire-alarm' || plan.kind === 'telephone' || plan.kind === 'surveillance')) {
      this.model = createEnvironmentModel(plan.kind, plan.seed);
      this.model.root.position.copy(plan.mount.position); this.model.root.rotation.y = plan.mount.yaw; this.root.add(this.model.root);
      this.mountCollider();
    }
    if (plan.kind === 'surveillance') { this.surveillance.yaw = this.state.cameraYaw ?? 0; this.surveillance.pitch = this.state.cameraPitch ?? 0; }
    if (plan.kind === 'flood') { this.water = new EnvironmentWater(plan, chunk.plan); this.root.add(this.water.root); }
    this.ready = plan.chair ? this.loadChair() : Promise.resolve();
    // Streamed chunks do not await optional models. Observe a failed request
    // here as well, so it cannot become an unhandled promise after unmount.
    if (plan.chair) void this.ready.catch(error => { if (!this.disposed) console.warn('Chaise environnementale indisponible', error); });
    this.rebind(chunk);
  }
  private async loadChair(): Promise<void> {
    const p = this.plan.chair!, index = this.state.chairMoved ? 1 : 0, position = p.positions[index]!;
    const model = await createPropInstance({ id: this.plan.id, assetId: 'polyhaven:painted_wooden_chair_01', roomId: this.plan.roomId,
      position, rotationY: p.yaws[index]!, scale: 1, bounds: this.plan.bounds, kind: 'room', tone: .84 }, this.chunk.plan.visualBiome ?? 'yellow');
    if (this.disposed) { disposePropInstance(model); return; }
    this.chair = model; this.root.add(model); this.placeChair(); this.rebind(this.chunk);
  }
  rebind(chunk: EnvironmentChunk): void {
    this.chunk = chunk;
    this.root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (this.bindings.get(material) === chunk.view.environmentLighting) continue;
        let base = this.baseHooks.get(material);
        if (!base) { base = { before: material.onBeforeCompile, key: material.customProgramCacheKey }; this.baseHooks.set(material, base); }
        material.onBeforeCompile = base.before; material.customProgramCacheKey = base.key;
        if (material instanceof THREE.MeshStandardMaterial && material !== this.water?.material && chunk.view.decorLightingContext) applyZonalLighting(material, chunk.view.decorLightingContext);
        chunk.view.environmentLighting.apply(material); chunk.view.northernLighting.apply(material); material.needsUpdate = true;
        this.bindings.set(material, chunk.view.environmentLighting);
      }
    });
    // View replacement preserves the current circuit level instead of replaying discovery.
    if (this.plan.kind === 'flicker' && this.flickerTime >= 0) chunk.view.environmentLighting.set(this.plan.id, apparitionFrame(this.flickerTime).level);
  }
  private save(): void { this.owner.states.write(this.plan.id, this.state); }
  private world(local: Vec3Data, out = this.position): THREE.Vector3 { return out.copy(local).add(this.chunk.offset); }
  private emitter(): THREE.Vector3 { return this.world(this.plan.mount?.position ?? { ...rectCenter(this.plan.bounds), y: this.plan.floorY + .1 }); }
  private sound(kind: EnvironmentSound, local: Vec3Data, gain = .4, loop = false, offset = 0, reference = 1.5, rate = 1): EnvironmentVoice | undefined {
    const voice = this.owner.audio.play(kind, this.world(local), gain, loop, offset, reference, rate);
    if (voice) { this.voices.add(voice); voice.source.addEventListener('ended', () => this.voices.delete(voice), { once: true }); }
    return voice;
  }
  update(delta: number): void {
    if (this.disposed) return;
    this.time += delta;
    this.local.copy(this.owner.host.playerPosition()).sub(this.chunk.offset);
    switch (this.plan.kind) {
      case 'fire-alarm': this.updateAlarm(); break;
      case 'flicker': this.updateFlicker(delta); break;
      case 'flood': this.water!.update(delta, this.owner.audio.time, this.emitter().distanceTo(this.owner.host.camera.position) < 32, this.chunk.offset, p => this.sound('drip', p, .25)); break;
      case 'telephone': this.updatePhone(delta); break;
      case 'lonely-chair': this.updateChair(delta); break;
      case 'surveillance': this.updateSurveillance(delta); break;
    }
    if (this.loop && this.plan.kind !== 'fire-alarm' && this.time - this.lastOcclusion > .45) {
      this.lastOcclusion = this.time;
      this.loop.muffle(this.owner.clearSight(this.owner.host.camera.position, this.emitter(), `environment-collider:${this.plan.id}`) ? 0 : .85, this.owner.audio.time);
    }
  }
  private updateAlarm(): void {
    const time = this.owner.audio.time + this.phase, pulse = this.owner.audio.alarmLevel(time);
    const emitter = this.emitter(), listener = this.owner.host.camera.position, d = emitter.distanceTo(listener);
    // Real local floor datum, never the chunk's story address or camera height.
    const floorDelta = this.owner.host.playerPosition().y - this.chunk.offset.y - .865 - this.plan.floorY;
    // A continuous source starts silent; crossing a radius never restarts it.
    this.loop ??= this.sound('alarm', this.plan.mount!.position, 0, true, time, 6);
    if (alarmAudibility(d, floorDelta) > 0 && this.time - this.lastOcclusion > .12) {
      this.lastOcclusion = this.time;
      let clear = 0;
      for (const [x,z] of [[0,0],[.45,0],[-.45,0],[0,.45],[0,-.45]]) {
        this.ear.copy(listener); this.ear.x += x!; this.ear.z += z!;
        if (this.owner.clearSight(this.ear, emitter, `environment-collider:${this.plan.id}`)) clear++;
      }
      this.alarmOcclusion = 1 - clear / 5;
    }
    this.loop?.setGain(alarmAudibility(d, floorDelta, this.alarmOcclusion), this.owner.audio.time, .12);
    this.loop?.muffle(this.alarmOcclusion * .4, this.owner.audio.time);
    this.chunk.view.environmentLighting.set(this.plan.id, 1, pulse * 2.2);
    this.model!.lens!.color.setRGB(.18 + pulse * 3, .003 + pulse * .012, .001);
  }
  private updateFlicker(delta: number): void {
    const a = this.plan.apparition!;
    const distance = this.world(a.start).distanceTo(this.owner.host.camera.position);
    if (!this.state.consumed && distance < 48) this.owner.prepareGhost();
    if (!this.state.consumed && this.owner.host.canDiscover() && distance > 6 && distance < 24
      && this.owner.visible(this.world({ ...a.start, y: a.start.y + 1.3 }), 1.2) && this.owner.acquireGhost(this.plan.id)) {
      this.state.consumed = true; this.save(); this.flickerTime = 0;
      this.sound('ballast', { ...rectCenter(this.plan.bounds), y: this.plan.ceilingY - .2 }, .38);
    }
    let level: number;
    if (this.flickerTime >= 0) {
      this.flickerTime += delta;
      const f = apparitionFrame(this.flickerTime), ghost = this.owner.acquireGhost(this.plan.id);
      level = f.level;
      if (ghost) {
        ghost.setPlacement(this.world({ x: THREE.MathUtils.lerp(a.start.x, a.end.x, f.progress), y: a.start.y, z: THREE.MathUtils.lerp(a.start.z, a.end.z, f.progress) }), Math.atan2(a.end.x - a.start.x, a.end.z - a.start.z));
        ghost.setVisible(f.visible); if (f.visible) ghost.update(delta);
      }
      if (this.flickerTime > 2.1) { this.owner.releaseGhost(this.plan.id); this.flickerTime = -1; }
    } else {
      const t = this.owner.audio.time + this.phase * 7, cycle = t % 13.7;
      const noise = Math.sin(t * 38.7) * Math.sin(t * 19.13 + .7);
      level = cycle < 1.7 ? (noise > .16 ? .95 : noise < -.52 ? .045 : .32) : .94 + Math.sin(t * 31) * .045;
    }
    this.chunk.view.environmentLighting.set(this.plan.id, level);
  }
  interactionDistance(): number | null {
    if (this.plan.kind !== 'telephone' || this.state.consumed || !this.owner.host.canDiscover()) return null;
    const point = this.emitter(), camera = this.owner.host.camera, d = point.distanceTo(camera.position);
    const reach = point.distanceTo(this.owner.host.playerPosition());
    if (reach > 2.15 || d > 8 || d < .01) return null;
    this.local.copy(point).sub(camera.position).multiplyScalar(1 / d);
    if (this.local.dot(camera.getWorldDirection(this.right)) < .91 || !this.owner.clearSight(camera.position, point, `environment-collider:${this.plan.id}`)) return null;
    return reach;
  }
  answer(): void {
    if (this.state.consumed || !this.owner.acquirePhone(this.plan.id)) return;
    this.state.consumed = true; this.save(); this.stopLoop();
    this.phoneCues(this.phone.answer());
  }
  private phoneEar(): THREE.Vector3 {
    const camera = this.owner.host.camera;
    this.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    return this.ear.copy(camera.position).addScaledVector(this.right, -.16).addScaledVector(this.owner.up, -.07);
  }
  private phoneCues(cues: PhoneCue[]): void {
    for (const cue of cues) {
      if (cue === 'silence' || cue === 'hangup' || cue === 'interrupt') { this.breath?.stop(this.owner.audio.time); this.breath = undefined; }
      if (cue === 'breath' || cue === 'decision') {
        this.breath = this.sound('breath', this.plan.mount!.position, cue === 'decision' ? .15 : .3, true, this.owner.audio.time, 1.5, 1 + this.owner.exertion * .35);
        this.breath?.setPosition(this.phoneEar(), this.owner.audio.time); this.breath?.muffle(.8, this.owner.audio.time);
      }
      if (cue === 'warning') {
        this.speech = this.sound('warning', this.plan.mount!.position, .85); this.speech?.setPosition(this.phoneEar(), this.owner.audio.time); this.speech?.muffle(.8, this.owner.audio.time);
        this.owner.host.caption('Ne te retourne pas.');
      }
      if (cue === 'turned') this.pendingChase = 4;
      if (cue === 'step') {
        const camera = this.owner.host.camera, forward = this.owner.forward;
        const p = { x: camera.position.x - forward.x * 1.4, y: this.owner.host.playerPosition().y - .865, z: camera.position.z - forward.z * 1.4 };
        const floor = this.owner.host.physics.probeWalkableCell(p.x, p.z, p.y);
        if (Number.isFinite(floor)) this.sound('step', { x: p.x - this.chunk.offset.x, y: floor - this.chunk.offset.y + .05, z: p.z - this.chunk.offset.z }, .5);
      }
      if (cue === 'hangup' || cue === 'interrupt') {
        for (const voice of this.voices) voice.stop(this.owner.audio.time, .03);
        this.sound('hangup', this.plan.mount!.position, .55);
        this.owner.releasePhone(this.plan.id);
      }
    }
  }
  private updatePhone(delta: number): void {
    const d = this.emitter().distanceTo(this.owner.host.playerPosition());
    if (!this.state.consumed) {
      if (d < 24 && !this.loop) this.loop = this.sound('ring', this.plan.mount!.position, .7, true, this.owner.audio.time + this.phase, 3);
      if (d > 36) this.stopLoop(.4);
    }
    if (this.phone.phase !== 'idle' && this.phone.phase !== 'done') {
      if (d > 5.5 || !this.owner.host.canDiscover()) this.phoneCues(this.phone.interrupt());
      else {
        this.owner.host.prepareChase();
        this.phoneCues(this.phone.update(delta, this.owner.forward, this.owner.audio.warningDuration));
        this.breath?.setPosition(this.phoneEar(), this.owner.audio.time);
        this.speech?.setPosition(this.phoneEar(), this.owner.audio.time);
        if (this.phone.phase === 'decision') this.breath?.setGain(.15 + this.phone.time / 10 * .6, this.owner.audio.time);
      }
    }
    if (this.model?.receiver) {
      const off = this.phone.phase !== 'idle' && this.phone.phase !== 'done' ? 1 : 0;
      this.model.receiver.rotation.z = THREE.MathUtils.damp(this.model.receiver.rotation.z, -.6 * off, 9, delta);
      this.model.receiver.position.y = THREE.MathUtils.damp(this.model.receiver.position.y, .145 - off * .17, 9, delta);
    }
    if (this.pendingChase > 0) {
      this.pendingChase -= delta;
      if (this.owner.host.startChase()) this.pendingChase = 0;
    }
  }
  private placeChair(): void {
    const p = this.plan.chair!, index = this.state.chairMoved ? 1 : 0, position = p.positions[index]!, yaw = p.yaws[index]!;
    if (this.chair) { this.chair.position.copy(position); this.chair.position.y += .006; this.chair.rotation.y = yaw; }
    const asset = getPropAsset('polyhaven:painted_wooden_chair_01');
    this.setCollider({ id: this.plan.id, center: { ...position, y: position.y + asset.size.y * .43 }, halfExtents: { x: asset.size.x * .4, y: asset.size.y * .43, z: asset.size.z * .4 }, kind: 'barrier', rotation: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) } });
  }
  private updateChair(delta: number): void {
    const b = this.plan.bounds;
    if (pointInRect(this.local.x, this.local.z, b) && Math.abs(this.local.y - .865 - this.plan.floorY) < .6) {
      if (!this.state.visited) { this.state.visited = true; this.save(); }
      this.chairAway = 0; return;
    }
    if (!this.state.visited || this.state.chairMoved) return;
    const distance = Math.hypot(Math.max(b.minX - this.local.x, 0, this.local.x - b.maxX), Math.max(b.minZ - this.local.z, 0, this.local.z - b.maxZ),
      Math.max(this.plan.floorY - this.local.y, 0, this.local.y - this.plan.ceilingY));
    if (distance < 12 || this.owner.visible(this.world({ ...this.plan.chair!.positions[0]!, y: this.plan.floorY + .55 }), 1, `environment-collider:${this.plan.id}`)) { this.chairAway = 0; return; }
    this.chairAway += delta;
    if (this.chairAway >= 1.5) { this.state.chairMoved = true; this.save(); this.placeChair(); }
  }
  private updateSurveillance(delta: number): void {
    const mount = this.plan.mount!, point = this.emitter();
    const target = this.ear.copy(this.owner.host.playerPosition()); target.y += .75;
    this.local.copy(target).sub(point);
    const distance = this.local.length(), yaw = Math.atan2(this.local.x, this.local.z) - mount.yaw;
    const localYaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    const visible = this.owner.visible(point, .35, `environment-collider:${this.plan.id}`), detected = this.owner.clearSight(point, target, `environment-collider:${this.plan.id}`);
    const result = this.surveillance.update(delta, { distance, yaw: localYaw, pitch: -Math.atan2(this.local.y, Math.hypot(this.local.x, this.local.z)), visible, detected });
    const head = this.model!.head!; head.rotation.y = this.surveillance.yaw; head.rotation.x = this.surveillance.pitch;
    if (result.click) this.sound('click', mount.position, .35);
    if (result.moving && !this.loop) this.loop = this.sound('servo', mount.position, .35, true, this.owner.audio.time);
    if (!result.moving) this.stopLoop(.025);
  }
  private stopLoop(fade = .06): void { this.loop?.stop(this.owner.audio.time, fade); this.loop = undefined; }
  private setCollider(collider: StaticCollider): void {
    const key = `environment-collider:${this.plan.id}`;
    this.owner.host.physics.removeChunk(key); this.owner.host.physics.addChunk(key, [collider], this.chunk.offset);
  }
  private mountCollider(): void {
    const m = this.plan.mount!, camera = this.plan.kind === 'surveillance', d = camera ? .3 : .11;
    this.setCollider({ id: this.plan.id, center: { x: m.position.x + Math.sin(m.yaw) * d, y: m.position.y, z: m.position.z + Math.cos(m.yaw) * d },
      halfExtents: { x: camera ? .16 : .18, y: camera ? .17 : .26, z: camera ? .32 : .11 }, kind: 'barrier',
      rotation: { x: 0, y: Math.sin(m.yaw / 2), z: 0, w: Math.cos(m.yaw / 2) } });
  }
  isPlayerInWater(): boolean { this.local.copy(this.owner.host.playerPosition()).sub(this.chunk.offset); return this.water?.contains(this.local) ?? false; }
  splash(strength: number): void {
    if (!this.water) return;
    this.local.copy(this.owner.host.playerPosition()).sub(this.chunk.offset); this.local.y = this.plan.floorY + .035;
    this.water.ripple(this.local, this.owner.audio.time, strength, this.chunk.offset);
    this.sound('splash', this.local, .35 + Math.min(1, strength) * .35, false, 0, 1.5, this.random.float(.85, 1.15));
  }
  dispose(): void {
    if (this.disposed) return;
    if (this.plan.kind === 'lonely-chair') { this.local.copy(this.owner.host.playerPosition()).sub(this.chunk.offset); this.updateChair(2); }
    if (this.plan.kind === 'surveillance') { this.state.cameraYaw = this.surveillance.yaw; this.state.cameraPitch = this.surveillance.pitch; this.save(); }
    this.disposed = true; this.owner.releasePhone(this.plan.id); this.owner.releaseGhost(this.plan.id);
    for (const voice of this.voices) voice.stop(this.owner.audio.time, .06);
    this.voices.clear(); this.owner.host.physics.removeChunk(`environment-collider:${this.plan.id}`);
    this.model?.dispose(); this.water?.dispose(); if (this.chair) disposePropInstance(this.chair);
    this.baseHooks.clear(); this.root.removeFromParent(); this.root.clear();
  }
}
