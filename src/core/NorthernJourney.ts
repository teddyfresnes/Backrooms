import * as THREE from 'three';
import type { EnvironmentAudio, EnvironmentVoice } from '../audio/EnvironmentAudio';
import { EnvironmentStateStore, type EventState } from '../environment/EnvironmentBehavior';
import { createEnvironmentModel, type EventModel } from '../environment/EnvironmentModels';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { applyZonalLighting } from '../render/ZonalLighting';
import { NorthernProgression, type NorthernProgress } from '../story/NorthernProgress';
import { NORTHERN_LAYOUT, redZoneEntryZ } from '../world/NorthernLayout';
import type { LightingCircuitPlan } from '../world/NorthernWorld';
import { pointInRect } from '../world/types';
import type { EnvironmentChunk, EnvironmentChunkObserver } from './WorldStream';

export interface NorthernHost {
  scene: THREE.Scene;
  camera: THREE.Camera;
  physics: Pick<PhysicsWorld, 'addChunk' | 'removeChunk' | 'castEnvironmentRay'>;
  audio: EnvironmentAudio;
  position(): THREE.Vector3;
  owner(): { x: number; story: number };
  available(): boolean;
  riftResolved(): boolean;
  compassVisible(): boolean;
  caption(text: string): void;
  revealCompass(): void;
  checkpoint(): void;
}
interface MountedNorth { chunk: EnvironmentChunk; circuits: Circuit[] }

/** Narrative and streamed circuit ownership share the existing world observer
 * lifecycle, sparse environmental storage, audio bus and normal interaction. */
export class NorthernJourney implements EnvironmentChunkObserver {
  readonly progression: NorthernProgression;
  private readonly chunks = new Map<string, MountedNorth>();
  private readonly heading = new THREE.Vector3(0, 0, -1);
  private readonly destination = new THREE.Vector3();
  private disposed = false;
  constructor(readonly host: NorthernHost, readonly states: EnvironmentStateStore, saved?: NorthernProgress) {
    this.progression = new NorthernProgression(saved);
  }
  mount(chunk: EnvironmentChunk): void {
    if (this.disposed || !chunk.plan.northern) return;
    const previous = this.chunks.get(chunk.key);
    if (previous) { previous.chunk = chunk; previous.circuits.forEach(c => c.rebind(chunk)); return; }
    this.chunks.set(chunk.key, { chunk, circuits: chunk.plan.northern.circuits.filter(c => c.mode === 'repair').map(c => new Circuit(this, chunk, c)) });
  }
  unmount(key: string): void { const m = this.chunks.get(key); if (m) { m.circuits.forEach(c => c.dispose()); this.chunks.delete(key); } }
  update(delta: number): void {
    if (this.disposed) return;
    const position = this.host.position(), available = this.host.available();
    for (const m of this.chunks.values()) for (const c of m.circuits) c.update(available);
    const step = this.progression.step({ delta, z: position.z, redEntryZ: redZoneEntryZ, available,
      riftResolved: this.host.riftResolved(), compassVisible: this.host.compassVisible(), owner: this.host.owner() });
    if (step.comment) { this.host.caption('Putain… la boussole vibre.'); if (!this.host.compassVisible()) this.host.revealCompass(); }
    const s = this.progression.state;
    let changed = step.changed;
    if (available && s.target && s.stage !== 'slides-ready' && s.target.story !== this.host.owner().story) {
      s.target.story = this.host.owner().story; changed = true;
    }
    if (available && s.stage === 'slides' && this.targetPosition() && position.distanceTo(this.destination) < 4) {
      s.stage = 'slides-ready'; changed = true;
      this.host.caption('L’aiguille s’arrête ici… Il doit y avoir un passage.');
    }
    if (changed) this.host.checkpoint();
  }
  /** Refine the stable owner address to an actual walkable approach as soon as
   * streaming mounts it. All X columns and stories reserve this destination. */
  private targetPosition(): boolean {
    const target = this.progression.state.target;
    if (!target) return false;
    this.destination.set(target.x * NORTHERN_LAYOUT.chunkSize, 0, NORTHERN_LAYOUT.slidesRow * NORTHERN_LAYOUT.chunkSize);
    for (const { chunk } of this.chunks.values()) {
      const north = chunk.plan.northern, owner = chunk.plan.spatial?.owner;
      if (north?.slides && owner?.x === target.x && owner.story === target.story) {
        this.destination.copy(north.slides.position).add(chunk.offset); this.destination.y += .865;
        return true;
      }
    }
    return false;
  }
  get compassDirection(): THREE.Vector3 {
    this.targetPosition();
    if (!this.progression.state.target) return this.heading.set(0, 0, -1);
    const p = this.host.position(); this.heading.set(this.destination.x - p.x, 0, this.destination.z - p.z);
    if (this.heading.lengthSq() < .04) this.heading.set(0, 0, -1);
    return this.heading.normalize();
  }
  get anomaly(): number { return this.progression.anomaly; }
  get snapshot(): NorthernProgress { return this.progression.snapshot; }
  get questText(): { text: string; urgent: false } | null {
    let text = this.progression.quest;
    if (!['inspect-compass', 'compass-glitch'].includes(this.progression.state.stage)) {
      for (const m of this.chunks.values()) if (m.circuits.some(c => c.off && c.containsPlayer())) { text = 'Rétablir la lumière : trouver le boîtier mural'; break; }
    }
    return text ? { text, urgent: false } : null;
  }
  getInteraction(): { label: string; circuit: Circuit } | null {
    if (!this.host.available()) return null;
    let best: Circuit | undefined, distance = Infinity;
    for (const m of this.chunks.values()) for (const c of m.circuits) {
      const d = c.interactionDistance(); if (d !== null && d < distance) { best = c; distance = d; }
    }
    return best ? { label: 'Rétablir la lumière', circuit: best } : null;
  }
  interact(): boolean { const hit = this.getInteraction(); if (!hit) return false; hit.circuit.restore(); return true; }
  dispose(): void { this.disposed = true; for (const key of this.chunks.keys()) this.unmount(key); }
}

class Circuit {
  private readonly model: EventModel;
  private readonly state: EventState;
  private readonly direction = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly base = new Map<THREE.Material, { before: THREE.Material['onBeforeCompile']; key: THREE.Material['customProgramCacheKey'] }>();
  private boundView?: EnvironmentChunk['view'];
  private readonly voices = new Set<EnvironmentVoice>();
  private readonly colliderKey: string;
  constructor(private readonly owner: NorthernJourney, private chunk: EnvironmentChunk, readonly plan: LightingCircuitPlan) {
    this.state = owner.states.read(plan.id);
    this.model = createEnvironmentModel('circuit-breaker', plan.id);
    const mount = plan.mount!;
    this.model.root.position.copy(mount.position).add(chunk.offset); this.model.root.rotation.y = mount.yaw;
    owner.host.scene.add(this.model.root);
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), mount.yaw);
    this.colliderKey = `northern-collider:${plan.id}`;
    owner.host.physics.addChunk(this.colliderKey, [{ id: this.colliderKey, kind: 'wall',
      center: { x: mount.position.x + Math.sin(mount.yaw) * .08, y: mount.position.y, z: mount.position.z + Math.cos(mount.yaw) * .08 },
      halfExtents: { x: .18, y: .25, z: .09 }, rotation }], chunk.offset);
    this.rebind(chunk);
  }
  get off(): boolean { return this.state.circuit === 'off'; }
  rebind(chunk: EnvironmentChunk): void {
    this.chunk = chunk;
    chunk.view.northernLighting.set(this.plan.id, !this.off);
    this.model.lever!.rotation.x = this.off ? .75 : -.75;
    if (this.boundView === chunk.view) return;
    this.boundView = chunk.view;
    this.model.root.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
        let base = this.base.get(material);
        if (!base) { base = { before: material.onBeforeCompile, key: material.customProgramCacheKey }; this.base.set(material, base); }
        material.onBeforeCompile = base.before; material.customProgramCacheKey = base.key;
        if (material instanceof THREE.MeshStandardMaterial && chunk.view.decorLightingContext) applyZonalLighting(material, chunk.view.decorLightingContext);
        chunk.view.northernLighting.apply(material); material.needsUpdate = true;
      }
    });
  }
  containsPlayer(): boolean {
    const p = this.owner.host.position(), o = this.chunk.offset;
    return pointInRect(p.x - o.x, p.z - o.z, this.plan.bounds) && Math.abs(p.y - o.y - this.plan.floorY - .865) < .9;
  }
  update(available: boolean): void {
    if (available && this.state.circuit === undefined && this.containsPlayer()) {
      this.state.circuit = 'off'; this.owner.states.write(this.plan.id, this.state);
      this.chunk.view.northernLighting.set(this.plan.id, false); this.model.lever!.rotation.x = .75;
      this.click();
    }
  }
  private click(): void {
    const voice = this.owner.host.audio.play('click', this.model.root.position, .6);
    if (voice) { this.voices.add(voice); voice.source.addEventListener('ended', () => this.voices.delete(voice), { once: true }); }
  }
  interactionDistance(): number | null {
    if (!this.off) return null;
    const camera = this.owner.host.camera, p = this.model.root.position;
    const reach = p.distanceTo(this.owner.host.position()), d = p.distanceTo(camera.position);
    if (reach > 2.15 || d < .01 || d > 8) return null;
    this.direction.copy(p).sub(camera.position).multiplyScalar(1 / d);
    if (this.direction.dot(camera.getWorldDirection(this.forward)) < .91
      || this.owner.host.physics.castEnvironmentRay(camera.position, this.direction, Math.max(0, d - .08), this.colliderKey)) return null;
    return reach;
  }
  restore(): void {
    this.state.circuit = 'restored'; this.owner.states.write(this.plan.id, this.state);
    this.chunk.view.northernLighting.set(this.plan.id, true); this.model.lever!.rotation.x = -.75; this.click();
  }
  dispose(): void {
    for (const v of this.voices) v.stop(this.owner.host.audio.time, 0);
    this.voices.clear(); this.owner.host.physics.removeChunk(this.colliderKey); this.model.dispose(); this.base.clear();
  }
}
